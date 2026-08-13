import { MODULE_ID, MARKET_THEMES, ANIMATED_THEMES, DEFAULT_ACCENT } from "../constants.js";
import {
  getShopsArray, getShop, createShop, updateShop, deleteShop, setShopInventory,
  getTheme, setTheme
} from "../shop-data.js";
import { applyRowVars } from "../theme.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function getFilePickerClass() {
  return foundry.applications?.apps?.FilePicker?.implementation
    ?? foundry.applications?.apps?.FilePicker
    ?? globalThis.FilePicker;
}

function getTextEditorClass() {
  return foundry.applications?.ux?.TextEditor?.implementation
    ?? foundry.applications?.ux?.TextEditor
    ?? globalThis.TextEditor;
}

export class ShopEditApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static APP_ID = "shopkeeper-edit";

  constructor(options) {
    super(options);
    this.isShopkeeperApp = true;
    /** @type {"shops"|"theme"} which panel the main area is showing */
    this.mode = "shops";
    this.selectedShopId = null;
    /** In-memory copy of the selected shop being edited, saved explicitly. */
    this._draft = null;
  }

  static DEFAULT_OPTIONS = {
    id: ShopEditApp.APP_ID,
    classes: ["shopkeeper", "shopkeeper-edit-app"],
    tag: "div",
    window: {
      title: "SHOPKEEPER.Edit.Title",
      icon: "fa-solid fa-screwdriver-wrench",
      resizable: true
    },
    position: { width: 1020, height: 760 },
    actions: {
      selectShop: ShopEditApp.#onSelectShop,
      newShop: ShopEditApp.#onNewShop,
      deleteShop: ShopEditApp.#onDeleteShop,
      browseImage: ShopEditApp.#onBrowseImage,
      removeItem: ShopEditApp.#onRemoveItem,
      save: ShopEditApp.#onSave,
      showThemes: ShopEditApp.#onShowThemes,
      showShops: ShopEditApp.#onShowShops,
      pickTheme: ShopEditApp.#onPickTheme
    }
  };

  static PARTS = {
    content: {
      template: `modules/${MODULE_ID}/templates/shop-edit.hbs`,
      scrollable: [".shopkeeper-edit-shop-list", ".shopkeeper-edit-main"]
    }
  };

  /** @override */
  async _prepareContext(_options) {
    if (!game.user.isGM) {
      ui.notifications.warn("Only the GM can edit shops.");
      this.close();
      return { shops: [] };
    }

    const shops = getShopsArray();

    if (this.selectedShopId && !shops.find(s => s.id === this.selectedShopId)) {
      this.selectedShopId = null;
      this._draft = null;
    }

    if (this.selectedShopId && !this._draft) {
      this._draft = foundry.utils.deepClone(getShop(this.selectedShopId));
    }

    const activeTheme = getTheme();

    // Sample content for the theme gallery: use a real shop where possible so
    // the GM previews their own art, not a placeholder.
    const sample = shops[0] ?? null;
    const themes = Object.values(MARKET_THEMES).map(theme => ({
      id: theme.id,
      label: game.i18n.localize(theme.label),
      hint: game.i18n.localize(theme.hint),
      usesAccent: theme.accent,
      animated: ANIMATED_THEMES.has(theme.id),
      active: theme.id === activeTheme,
      sampleName: sample?.name ?? game.i18n.localize("SHOPKEEPER.Themes.SampleName"),
      sampleDesc: sample?.description || game.i18n.localize("SHOPKEEPER.Themes.SampleDesc"),
      sampleImg: sample?.img ?? "icons/svg/shop.svg",
      sampleAccent: sample?.accent ?? DEFAULT_ACCENT,
      sampleSigil: (sample?.name?.trim()?.[0] ?? "S").toUpperCase()
    }));

    return {
      shops,
      hasShops: shops.length > 0,
      selectedShopId: this.selectedShopId,
      draft: this._draft,
      hasInventory: !!this._draft?.inventory?.length,
      mode: this.mode,
      showingThemes: this.mode === "theme",
      themes,
      activeTheme
    };
  }

  /** @override */
  _onRender(context, options) {
    super._onRender?.(context, options);

    const dropzone = this.element.querySelector(".shopkeeper-dropzone");
    if (dropzone) {
      dropzone.addEventListener("dragover", event => event.preventDefault());
      dropzone.addEventListener("drop", this._onDropItem.bind(this));
    }

    // Live-update the image preview and accent swatch as the GM edits.
    const accentInput = this.element.querySelector('[name="shop-accent"]');
    if (accentInput) {
      accentInput.addEventListener("input", event => {
        if (this._draft) this._draft.accent = event.target.value;
      });
    }

    applyRowVars(this.element);
  }

  /* -------------------------------------------- */
  /*  Draft helpers                               */
  /* -------------------------------------------- */

  /** Read any uncontrolled form inputs currently on screen into this._draft. */
  _syncFormIntoDraft() {
    if (!this._draft) return;
    const root = this.element;

    const nameInput = root.querySelector('[name="shop-name"]');
    if (nameInput) this._draft.name = nameInput.value;

    const descInput = root.querySelector('[name="shop-description"]');
    if (descInput) this._draft.description = descInput.value;

    const visibleInput = root.querySelector('[name="shop-visible"]');
    if (visibleInput) this._draft.visible = visibleInput.checked;

    const accentInput = root.querySelector('[name="shop-accent"]');
    if (accentInput) this._draft.accent = accentInput.value;

    root.querySelectorAll(".shopkeeper-edit-inventory-row").forEach(row => {
      const entryId = row.dataset.entryId;
      const entry = this._draft.inventory.find(i => i.id === entryId);
      if (!entry) return;
      const priceInput = row.querySelector("[data-price-input]");
      const qtyInput = row.querySelector("[data-qty-input]");
      const unlimitedInput = row.querySelector("[data-unlimited-input]");
      if (priceInput) entry.price = Math.max(0, Number(priceInput.value) || 0);
      if (unlimitedInput?.checked) entry.quantity = -1;
      else if (qtyInput) entry.quantity = Math.max(0, Math.floor(Number(qtyInput.value) || 0));
    });
  }

  async _onDropItem(event) {
    event.preventDefault();
    if (!this._draft) return;
    const TextEditorImpl = getTextEditorClass();
    let data;
    try {
      data = TextEditorImpl.getDragEventData(event);
    } catch (err) {
      return;
    }
    if (data?.type !== "Item") {
      ui.notifications.warn("Only items can be dropped into a shop's inventory.");
      return;
    }
    const item = await fromUuid(data.uuid);
    if (!item) {
      ui.notifications.warn("Could not resolve the dropped item.");
      return;
    }

    this._syncFormIntoDraft();
    this._draft.inventory.push({
      id: foundry.utils.randomID(),
      name: item.name,
      img: item.img,
      price: Number(item.system?.price?.value) || 0,
      quantity: 1,
      itemData: item.toObject()
    });
    this.render();
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onShowThemes(_event, _target) {
    if (this._draft) this._syncFormIntoDraft();
    this.mode = "theme";
    this.render();
  }

  static #onShowShops(_event, _target) {
    this.mode = "shops";
    this.render();
  }

  static async #onPickTheme(_event, target) {
    const themeId = target.closest("[data-theme-id]")?.dataset.themeId;
    if (!themeId || themeId === getTheme()) return;
    await setTheme(themeId);
    this.render();
    // Any open Market windows refresh via the updateSetting hook in main.js.
  }

  static #onSelectShop(_event, target) {
    const id = target.closest("[data-shop-id]")?.dataset.shopId;
    if (!id) return;
    if (id === this.selectedShopId && this.mode === "shops") return;
    this.mode = "shops";
    this.selectedShopId = id;
    this._draft = null;
    this.render();
  }

  static async #onNewShop(_event, _target) {
    const shop = await createShop({});
    this.mode = "shops";
    this.selectedShopId = shop.id;
    this._draft = foundry.utils.deepClone(shop);
    this.render();
  }

  static async #onDeleteShop(event, target) {
    event.stopPropagation();
    const id = target.closest("[data-shop-id]")?.dataset.shopId;
    if (!id) return;
    const shop = getShop(id);
    const DialogV2 = foundry.applications.api.DialogV2;
    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize("SHOPKEEPER.Edit.DeleteShopConfirmTitle") },
      content: game.i18n.format("SHOPKEEPER.Edit.DeleteShopConfirmBody", { name: shop?.name ?? "" })
    });
    if (!confirmed) return;
    await deleteShop(id);
    if (this.selectedShopId === id) {
      this.selectedShopId = null;
      this._draft = null;
    }
    this.render();
  }

  static #onBrowseImage(_event, _target) {
    if (!this._draft) return;
    this._syncFormIntoDraft();
    const FilePickerImpl = getFilePickerClass();
    const fp = new FilePickerImpl({
      type: "image",
      current: this._draft.img,
      callback: path => {
        this._draft.img = path;
        this.render();
      }
    });
    fp.browse();
  }

  static #onRemoveItem(_event, target) {
    const entryId = target.closest("[data-entry-id]")?.dataset.entryId;
    if (!entryId || !this._draft) return;
    this._syncFormIntoDraft();
    this._draft.inventory = this._draft.inventory.filter(i => i.id !== entryId);
    this.render();
  }

  static async #onSave(_event, _target) {
    if (!this._draft || !this.selectedShopId) return;
    this._syncFormIntoDraft();
    await updateShop(this.selectedShopId, {
      name: this._draft.name?.trim() || "Unnamed Shop",
      description: this._draft.description ?? "",
      img: this._draft.img || "icons/svg/shop.svg",
      accent: this._draft.accent || DEFAULT_ACCENT,
      visible: !!this._draft.visible
    });
    await setShopInventory(this.selectedShopId, this._draft.inventory);
    ui.notifications.info(game.i18n.localize("SHOPKEEPER.Edit.Saved"));
    this.render();
  }

  static openOrFocus() {
    const existing = foundry.applications.instances.get(ShopEditApp.APP_ID);
    if (existing) return existing.bringToFront();
    return new ShopEditApp().render(true);
  }
}
