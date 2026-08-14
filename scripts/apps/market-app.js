import { MODULE_ID, DEFAULT_ACCENT } from "../constants.js";
import { getShopsArray, getTheme } from "../shop-data.js";
import { ShopApp } from "./shop-app.js";
import { applyRowVars } from "../theme.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class MarketApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static APP_ID = "shopkeeper-market";

  isShopkeeperApp = true;

  static DEFAULT_OPTIONS = {
    id: MarketApp.APP_ID,
    classes: ["shopkeeper", "shopkeeper-market-app"],
    tag: "div",
    window: {
      title: "SHOPKEEPER.Market.Title",
      icon: "fa-solid fa-shop",
      resizable: true
    },
    position: { width: 620, height: 700 },
    actions: {
      openShop: MarketApp.#onOpenShop
    }
  };

  static PARTS = {
    content: {
      template: `modules/${MODULE_ID}/templates/market.hbs`,
      scrollable: [".shopkeeper-market-list"]
    }
  };

  /** @override */
  async _prepareContext(_options) {
    const isGM = game.user.isGM;
    const shops = getShopsArray()
      .filter(s => isGM || s.visible)
      .map(shop => ({
        ...shop,
        accent: shop.accent || DEFAULT_ACCENT,
        // Used by the heraldic-banner theme's shield badge.
        sigil: (shop.name?.trim()?.[0] ?? "?").toUpperCase()
      }));

    return {
      isGM,
      shops,
      hasShops: shops.length > 0,
      theme: getTheme()
    };
  }

  /**
   * Themes read the shop image and accent colour from CSS custom properties.
   * We set them here rather than in the template so that image paths containing
   * quotes or spaces can't break out of the inline style attribute.
   * @override
   */
  _onRender(context, options) {
    super._onRender?.(context, options);
    const framings = Object.fromEntries((context.shops ?? []).map(s => [s.id, s.framing]));
    applyRowVars(this.element, framings);
  }

  static #onOpenShop(_event, target) {
    const shopId = target.closest("[data-shop-id]")?.dataset.shopId;
    if (!shopId) return;
    ShopApp.openOrFocus(shopId);
  }

  /** Open the Market, or bring an already-open one to the front. */
  static openOrFocus() {
    const existing = foundry.applications.instances.get(MarketApp.APP_ID);
    if (existing) return existing.bringToFront();
    return new MarketApp().render(true);
  }
}
