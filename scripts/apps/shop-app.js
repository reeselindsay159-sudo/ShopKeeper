import { MODULE_ID } from "../constants.js";
import { getShop } from "../shop-data.js";
import { attachFramedImage } from "../framing.js";
import { requestPurchase } from "../socket.js";
import { currencyToCopper, copperToGp } from "../currency.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ShopApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /** @param {{shopId: string}} options */
  constructor(options) {
    super({ ...options, id: options.id ?? `shopkeeper-shop-${options.shopId}` });
    this.shopId = options.shopId;
    /** @type {Map<string, number>} entryId -> qty in cart */
    this.cart = new Map();
    this.isShopkeeperApp = true;
  }

  static DEFAULT_OPTIONS = {
    classes: ["shopkeeper", "shopkeeper-shop"],
    tag: "div",
    window: {
      icon: "fa-solid fa-store",
      resizable: true
    },
    position: { width: 720, height: 780 },
    actions: {
      addToCart: ShopApp.#onAddToCart,
      cartIncrease: ShopApp.#onCartIncrease,
      cartDecrease: ShopApp.#onCartDecrease,
      cartRemove: ShopApp.#onCartRemove,
      checkout: ShopApp.#onCheckout
    }
  };

  static PARTS = {
    content: {
      template: `modules/${MODULE_ID}/templates/shop.hbs`,
      // These must name the elements that actually scroll, so Foundry restores
      // their positions across re-renders. .shopkeeper-inventory-list is the
      // <tbody>, which is not the scrolling box.
      scrollable: [".shopkeeper-shop-inventory", ".shopkeeper-cart-list"]
    }
  };

  /** Apply the GM's zoom/pan framing to the shop portrait. @override */
  async _onRender(context, options) {
    super._onRender?.(context, options);
    this._framingHandle?.destroy();
    const portrait = this.element.querySelector("[data-shop-framing]");
    if (portrait && this._shop) {
      this._framingHandle = await attachFramedImage(portrait, {
        src: this._shop.img,
        framing: this._shop.framing?.shop,
        prefix: "sk-s"
      });
    }
  }

  /** @override */
  _onClose(options) {
    this._framingHandle?.destroy();
    this._framingHandle = null;
    return super._onClose?.(options);
  }

  get title() {
    return this._shop?.name || "Shop";
  }

  /** @override */
  async _prepareContext(_options) {
    const shop = getShop(this.shopId);
    if (!shop) {
      ui.notifications.warn("This shop no longer exists.");
      this.close();
      return { shop: null, inventory: [], hasInventory: false, cartLines: [], hasCart: false, total: 0 };
    }
    this._shop = shop;

    const actor = game.user.character;

    const inventory = shop.inventory.map(entry => {
      const limited = entry.quantity >= 0;
      return {
        ...entry,
        limited,
        outOfStock: limited && entry.quantity <= 0,
        stockLabel: limited
          ? game.i18n.format("SHOPKEEPER.Shop.InStock", { qty: entry.quantity })
          : ""
      };
    });

    const cartLines = [];
    for (const [entryId, qty] of this.cart.entries()) {
      const entry = shop.inventory.find(i => i.id === entryId);
      if (!entry) continue;
      cartLines.push({ entryId, name: entry.name, img: entry.img, price: entry.price, qty, lineTotal: entry.price * qty });
    }
    const total = cartLines.reduce((sum, l) => sum + l.lineTotal, 0);

    return {
      shop,
      inventory,
      hasInventory: inventory.length > 0,
      cartLines,
      hasCart: cartLines.length > 0,
      total,
      hasActor: !!actor,
      checkingOut: !!this.checkingOut
    };
  }

  // ---------------------------------------------------------------------
  // Cart helpers
  // ---------------------------------------------------------------------

  _maxAllowed(entry) {
    // A negative quantity (-1) marks unlimited stock.
    return entry.quantity >= 0 ? entry.quantity : Infinity;
  }

  _addToCart(entryId, qty) {
    const shop = getShop(this.shopId);
    const entry = shop?.inventory.find(i => i.id === entryId);
    if (!entry) return;
    const current = this.cart.get(entryId) || 0;
    const next = Math.min(current + qty, this._maxAllowed(entry));
    if (next <= 0) this.cart.delete(entryId);
    else this.cart.set(entryId, next);
    this.render();
  }

  _adjustCart(entryId, delta) {
    const shop = getShop(this.shopId);
    const entry = shop?.inventory.find(i => i.id === entryId);
    const current = this.cart.get(entryId) || 0;
    let next = current + delta;
    if (entry) next = Math.min(next, this._maxAllowed(entry));
    if (next <= 0) this.cart.delete(entryId);
    else this.cart.set(entryId, next);
    this.render();
  }

  _removeFromCart(entryId) {
    this.cart.delete(entryId);
    this.render();
  }

  // ---------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------

  static #onAddToCart(_event, target) {
    const row = target.closest("[data-entry-id]");
    const entryId = row?.dataset.entryId;
    if (!entryId) return;
    const input = row.querySelector("[data-qty-input]");
    const qty = Math.max(1, parseInt(input?.value, 10) || 1);
    this._addToCart(entryId, qty);
  }

  static #onCartIncrease(_event, target) {
    const entryId = target.closest("[data-entry-id]")?.dataset.entryId;
    if (entryId) this._adjustCart(entryId, 1);
  }

  static #onCartDecrease(_event, target) {
    const entryId = target.closest("[data-entry-id]")?.dataset.entryId;
    if (entryId) this._adjustCart(entryId, -1);
  }

  static #onCartRemove(_event, target) {
    const entryId = target.closest("[data-entry-id]")?.dataset.entryId;
    if (entryId) this._removeFromCart(entryId);
  }

  static async #onCheckout(_event, _target) {
    await this._checkout();
  }

  async _checkout() {
    if (this.checkingOut || !this.cart.size) return;

    const actor = game.user.character;
    if (!actor) {
      return showInfoDialog(
        game.i18n.localize("SHOPKEEPER.Shop.NoActorTitle"),
        game.i18n.localize("SHOPKEEPER.Shop.NoActorBody")
      );
    }

    const shop = getShop(this.shopId);
    if (!shop) return;

    const cart = [];
    let total = 0;
    for (const [entryId, qty] of this.cart.entries()) {
      const entry = shop.inventory.find(i => i.id === entryId);
      if (!entry) continue;
      cart.push({ entryId, qty });
      total += entry.price * qty;
    }
    if (!cart.length) return;

    const haveGp = copperToGp(currencyToCopper(actor.system.currency));
    if (haveGp < total) {
      return showInfoDialog(
        game.i18n.localize("SHOPKEEPER.Shop.NotEnoughCoinTitle"),
        game.i18n.format("SHOPKEEPER.Shop.NotEnoughCoinBody", {
          cost: total.toLocaleString(),
          have: haveGp.toLocaleString()
        })
      );
    }

    if (!game.users.activeGM) {
      return showInfoDialog(
        game.i18n.localize("SHOPKEEPER.Shop.NoGMTitle"),
        game.i18n.localize("SHOPKEEPER.Shop.NoGMBody")
      );
    }

    this.checkingOut = true;
    this.render();

    const result = await requestPurchase({ shopId: this.shopId, actorId: actor.id, cart });

    this.checkingOut = false;

    if (result.success) {
      this.cart.clear();
      ui.notifications.info(`Purchased for ${result.data.total.toLocaleString()} gp.`);
      this.render();
      return;
    }

    await this._handleFailure(result);
    this.render();
  }

  async _handleFailure(result) {
    switch (result.reason) {
      case "insufficient-coin":
        return showInfoDialog(
          game.i18n.localize("SHOPKEEPER.Shop.NotEnoughCoinTitle"),
          game.i18n.format("SHOPKEEPER.Shop.NotEnoughCoinBody", {
            cost: result.data.cost.toLocaleString(),
            have: result.data.have.toLocaleString()
          })
        );
      case "insufficient-stock":
        return showInfoDialog(
          game.i18n.localize("SHOPKEEPER.Shop.NotEnoughStockTitle"),
          game.i18n.format("SHOPKEEPER.Shop.NotEnoughStockBody", { name: result.data?.name ?? "" })
        );
      case "no-gm":
        return showInfoDialog(
          game.i18n.localize("SHOPKEEPER.Shop.NoGMTitle"),
          game.i18n.localize("SHOPKEEPER.Shop.NoGMBody")
        );
      case "timeout":
        return showInfoDialog(
          game.i18n.localize("SHOPKEEPER.Shop.PurchaseFailedTitle"),
          game.i18n.localize("SHOPKEEPER.Shop.PurchaseTimeout")
        );
      default:
        return showInfoDialog(
          game.i18n.localize("SHOPKEEPER.Shop.PurchaseFailedTitle"),
          "<p>Something went wrong processing this purchase. Please try again.</p>"
        );
    }
  }

  static openOrFocus(shopId) {
    const existing = foundry.applications.instances.get(`shopkeeper-shop-${shopId}`);
    if (existing) return existing.bringToFront();
    return new ShopApp({ shopId }).render(true);
  }
}

async function showInfoDialog(title, content) {
  const DialogV2 = foundry.applications.api.DialogV2;
  return DialogV2.prompt({
    window: { title },
    content,
    ok: { label: "OK" }
  });
}
