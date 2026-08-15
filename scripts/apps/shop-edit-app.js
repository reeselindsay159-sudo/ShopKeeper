import { MODULE_ID, MARKET_THEMES, ANIMATED_THEMES, DEFAULT_ACCENT } from "../constants.js";
import {
  getShopsArray, getShop, createShop, updateShop, deleteShop, setShopInventory,
  getTheme, setTheme, bannerImageFor
} from "../shop-data.js";
import { applyRowVars, cssUrl } from "../theme.js";
import {
  getWorldTables, rollItemsFromTable, mergeItemsIntoInventory, makeInventoryEntryAsync
} from "../tables.js";
import { generateMissingPrices, getRarity } from "../pricing.js";
import {
  makeFramer, writeFramingVars, sanitizeFraming, defaultFraming, normalizeFramingSet,
  computeScale, getImageSize, measureImgElement, clearFramingVars, FIT_FILL, FIT_CONTAIN,
  ZOOM_MIN, ZOOM_MAX, ZOOM_STEP
} from "../framing.js";

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

/** Keep the "how many to roll" input inside sane bounds. */
export function clampCount(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 100);
}

/** Human-readable rarity label, preferring the system's own localization. */
export function labelForRarity(rarity) {
  if (!rarity) return null;
  const fromSystem = CONFIG?.DND5E?.itemRarity?.[rarity];
  if (typeof fromSystem === "string" && fromSystem) return fromSystem;
  if (fromSystem?.label) return fromSystem.label;
  // Fall back to splitting camelCase: "veryRare" -> "Very Rare"
  return rarity.replace(/([A-Z])/g, " $1").replace(/^./, c => c.toUpperCase()).trim();
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
    /** True when the draft has changes that have not been written to the world. */
    this._dirty = false;
    /** Remembered table-load settings, so they survive a re-render. */
    this._tableId = null;
    this._tableCount = 5;
    /** Live framing controllers, torn down and rebuilt on each render. */
    this._framers = [];
    this._framingOpen = false;
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
      pickTheme: ShopEditApp.#onPickTheme,
      loadFromTable: ShopEditApp.#onLoadFromTable,
      generatePrices: ShopEditApp.#onGeneratePrices,
      clearShop: ShopEditApp.#onClearShop,
      resetFraming: ShopEditApp.#onResetFraming,
      browseBannerImage: ShopEditApp.#onBrowseBannerImage,
      clearBannerImage: ShopEditApp.#onClearBannerImage
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
      sampleSigil: (sample?.name?.trim()?.[0] ?? "S").toUpperCase(),
      // So the gallery previews the shop's actual crops, not the raw image.
      sampleBannerImg: sample ? bannerImageFor(sample) : "icons/svg/shop.svg",
      sampleFraming: JSON.stringify(normalizeFramingSet(sample?.framing))
    }));

    // Decorate inventory rows for display: rarity badge, and a flag for rows
    // sitting at 0 gp (which would be free for players to take).
    const inventory = (this._draft?.inventory ?? []).map(entry => ({
      ...entry,
      rarity: getRarity(entry.itemData),
      rarityLabel: labelForRarity(getRarity(entry.itemData)),
      isFree: !(Number(entry.price) > 0)
    }));

    const worldTables = getWorldTables();
    if (this._tableId && !worldTables.some(t => t.id === this._tableId)) this._tableId = null;
    this._tableId ??= worldTables[0]?.id ?? null;

    return {
      shops,
      hasShops: shops.length > 0,
      selectedShopId: this.selectedShopId,
      draft: this._draft,
      inventory,
      hasInventory: inventory.length > 0,
      freeCount: inventory.filter(e => e.isFree).length,
      mode: this.mode,
      showingThemes: this.mode === "theme",
      themes,
      activeTheme,
      dirty: this._dirty,
      tables: worldTables.map(t => ({ ...t, selected: t.id === this._tableId })),
      hasTables: worldTables.length > 0,
      tableCount: this._tableCount,
      frames: this._frameContext(),
      framingOpen: this._framingOpen,
      zoomMin: ZOOM_MIN,
      zoomMax: ZOOM_MAX,
      zoomStep: ZOOM_STEP
    };
  }

  /** Build the two framing panes (shop portrait and market banner). */
  _frameContext() {
    if (!this._draft) return [];
    const framing = normalizeFramingSet(this._draft.framing);
    this._draft.framing = framing;
    return [
      {
        key: "shop",
        label: game.i18n.localize("SHOPKEEPER.Framing.ShopImage"),
        hint: game.i18n.localize("SHOPKEEPER.Framing.ShopImageHint"),
        shapeClass: "shopkeeper-frame-square",
        src: this._draft.img,
        canHaveOwnImage: false,
        isContain: framing.shop.fit === FIT_CONTAIN,
        zoom: framing.shop.zoom,
        zoomLabel: `${framing.shop.zoom.toFixed(2)}x`
      },
      {
        key: "banner",
        label: game.i18n.localize("SHOPKEEPER.Framing.Banner"),
        hint: game.i18n.localize("SHOPKEEPER.Framing.BannerHint"),
        shapeClass: "shopkeeper-frame-wide",
        src: bannerImageFor(this._draft),
        canHaveOwnImage: true,
        hasOwnImage: !!this._draft.bannerImg,
        isContain: framing.banner.fit === FIT_CONTAIN,
        zoom: framing.banner.zoom,
        zoomLabel: `${framing.banner.zoom.toFixed(2)}x`
      }
    ];
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

    // Any edit inside the shop form marks the draft as unsaved.
    const form = this.element.querySelector(".shopkeeper-edit-form");
    if (form) {
      form.addEventListener("input", event => {
        if (event.target.closest(".shopkeeper-tools")) return; // tool inputs aren't shop data
        this._markDirty();
      });
    }

    // Remember tool selections across re-renders.
    const tableSelect = this.element.querySelector('[name="table-id"]');
    if (tableSelect) {
      tableSelect.addEventListener("change", event => { this._tableId = event.target.value; });
    }
    const countInput = this.element.querySelector('[name="table-count"]');
    if (countInput) {
      countInput.addEventListener("change", event => {
        this._tableCount = clampCount(event.target.value);
      });
    }

    this._setupFraming();
    applyRowVars(this.element);
  }

  /* -------------------------------------------- */
  /*  Image framing                               */
  /* -------------------------------------------- */

  /**
   * Wire up the drag-to-pan / scroll-to-zoom preview boxes.
   * Rebuilt on every render, so old controllers must be torn down first or we
   * would leak a listener set per render.
   */
  async _setupFraming() {
    for (const framer of this._framers) framer.destroy();
    this._framers = [];
    if (!this._draft) return;

    // Each pane can have its own image: the banner may override the shop art.
    const sources = {
      shop: this._draft.img,
      banner: bannerImageFor(this._draft)
    };

    for (const box of this.element.querySelectorAll(".shopkeeper-frame-box[data-frame]")) {
      const key = box.dataset.frame;
      const stored = sanitizeFraming(this._draft.framing?.[key] ?? defaultFraming());
      const size = await getImageSize(sources[key]);

      // Geometry depends on the frame's aspect and the zoom, so it is
      // recomputed on demand rather than captured once.
      const geometry = (zoom, fit) => {
        const rect = box.getBoundingClientRect();
        const frameAspect = rect.height > 0 ? rect.width / rect.height : 0;
        const imgAspect = size && size.h > 0 ? size.w / size.h : 0;
        const useFit = fit ?? this._draft.framing?.[key]?.fit ?? FIT_FILL;
        const { kx, ky } = computeScale({ frameAspect, imgAspect, zoom, fit: useFit });
        return { kx, ky, frameW: rect.width, frameH: rect.height };
      };

      // Read-only mirrors of this framing elsewhere in the form, kept in sync
      // without their own framer so there is one writer per framing key.
      const mirrors = this.element.querySelectorAll(`[data-frame-preview="${key}"]`);

      const applyTo = (el, framing) => {
        el.classList.toggle("is-fit", framing.fit === FIT_CONTAIN);
        if (sources[key]) el.style.setProperty("--sk-src", cssUrl(sources[key]));

        // Take the natural size from the element's own <img> when the shared
        // probe has not resolved yet.
        size ??= measureImgElement(el.querySelector("img"));

        const rect = el.getBoundingClientRect();
        const fa = rect.height > 0 && rect.width > 0 ? rect.width / rect.height : 0;
        const ia = size && size.h > 0 && size.w > 0 ? size.w / size.h : 0;

        // Never write a guessed layout — see the comment in framing.js. The
        // framing panel starts collapsed, so this box genuinely measures 0x0 on
        // the first paint, and guessing there is what made part of the picture
        // unreachable.
        if (!fa || !ia) {
          clearFramingVars(el, "sk-f");
          return null;
        }

        const { kx, ky } = computeScale({ frameAspect: fa, imgAspect: ia, zoom: framing.zoom, fit: framing.fit });
        writeFramingVars(el, { framing, kx, ky, prefix: "sk-f" });
        return { kx, ky };
      };

      const paint = framing => {
        const g = applyTo(box, framing);
        for (const mirror of mirrors) applyTo(mirror, framing);
        box.classList.toggle("is-pannable", !!g && (g.kx > 1.001 || g.ky > 1.001));
        return !!g;
      };

      if (!paint(stored)) requestAnimationFrame(() => paint(this._draft.framing?.[key] ?? stored));

      // The <img> may not have decoded on first paint.
      const boxImg = box.querySelector("img");
      if (boxImg && !boxImg.complete) {
        boxImg.addEventListener("load", () => paint(this._draft.framing?.[key] ?? stored), { once: true });
      }

      // Opening the collapsed framing panel is a size change from 0, so this
      // also covers the first real measurement.
      const details = this.element.querySelector(".shopkeeper-framing");
      if (details) {
        details.addEventListener("toggle", () => paint(this._draft.framing?.[key] ?? stored));
      }

      // Keep the preview correct if the GM resizes the Edit Shops window: the
      // frame's aspect feeds the layout, so a stale value would show a crop
      // that no longer matches what players will see.
      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver(() => paint(this._draft.framing?.[key] ?? stored));
        observer.observe(box);
        this._framers.push({ destroy: () => observer.disconnect() });
      }

      const slider = this.element.querySelector(`[data-zoom-slider][data-frame="${key}"]`);
      const readout = this.element.querySelector(`[data-zoom-readout="${key}"]`);

      const framer = makeFramer(box, stored, geometry, framing => {
        this._draft.framing[key] = framing;
        paint(framing);
        if (slider && Number(slider.value) !== framing.zoom) slider.value = String(framing.zoom);
        if (readout) readout.textContent = `${framing.zoom.toFixed(2)}x`;
        this._markDirty();
      });

      if (slider) {
        slider.addEventListener("input", event => {
          framer.set({ ...framer.get(), zoom: Number(event.target.value) });
        });
      }

      const fitToggle = this.element.querySelector(`[data-fit-toggle][data-frame="${key}"]`);
      if (fitToggle) {
        fitToggle.addEventListener("change", event => {
          // Contain mode has no crop to explore, so recentre the pan with it.
          const fit = event.target.checked ? FIT_CONTAIN : FIT_FILL;
          framer.set({ ...framer.get(), fit, x: 0, y: 0 });
        });
      }

      this._framers.push(framer);
    }
  }

  /** @override */
  _onClose(options) {
    for (const framer of this._framers) framer.destroy();
    this._framers = [];
    return super._onClose?.(options);
  }

  /** Flag unsaved changes and refresh just the Save button's state. */
  _markDirty() {
    if (this._dirty) return;
    this._dirty = true;
    this.element?.querySelector(".shopkeeper-edit-save-row")?.classList.add("is-dirty");
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
    // Dropping a RollTable populates the shop from that table.
    if (data?.type === "RollTable") {
      const table = await fromUuid(data.uuid);
      if (!table) {
        ui.notifications.warn(game.i18n.localize("SHOPKEEPER.Tools.TableMissing"));
        return;
      }
      this._syncFormIntoDraft();
      await this._loadFromTable(table, this._tableCount);
      return;
    }

    if (data?.type !== "Item") {
      ui.notifications.warn(game.i18n.localize("SHOPKEEPER.Tools.DropOnlyItems"));
      return;
    }
    const item = await fromUuid(data.uuid);
    if (!item) {
      ui.notifications.warn("Could not resolve the dropped item.");
      return;
    }

    this._syncFormIntoDraft();
    this._draft.inventory.push(await makeInventoryEntryAsync(item));
    this._markDirty();
    this.render();
  }

  /* -------------------------------------------- */
  /*  Bulk inventory tools                        */
  /* -------------------------------------------- */

  /**
   * Roll `count` items off `table` and merge them into the current draft.
   * Never mutates the table document (see tables.js).
   */
  async _loadFromTable(table, count) {
    if (!this._draft) return;

    const wanted = clampCount(count);
    let outcome;

    try {
      outcome = await rollItemsFromTable(table, wanted);
    } catch (err) {
      console.error("shopkeeper |", err);
      ui.notifications.error(game.i18n.localize("SHOPKEEPER.Tools.TableFailed"));
      return;
    }

    const { items, nonItems, emptyRolls } = outcome;

    if (!items.length) {
      ui.notifications.warn(game.i18n.format("SHOPKEEPER.Tools.TableNoItems", { table: table.name }));
      return;
    }

    const { added, stacked, scrolls } = await mergeItemsIntoInventory(this._draft.inventory, items);
    this._markDirty();
    this.render();

    let message = game.i18n.format("SHOPKEEPER.Tools.TableLoaded", {
      count: items.length,
      table: table.name,
      added,
      stacked
    });
    if (scrolls) {
      message += " " + game.i18n.format("SHOPKEEPER.Tools.ScrollsMade", { count: scrolls });
    }
    if (items.length < wanted) {
      message += " " + game.i18n.format("SHOPKEEPER.Tools.TableShort", { wanted });
    }
    ui.notifications.info(message);

    if (nonItems || emptyRolls) {
      console.log(`shopkeeper | table load: ${nonItems} non-item results, ${emptyRolls} empty rolls`);
    }
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  static #onBrowseBannerImage(event, _target) {
    event.stopPropagation();
    if (!this._draft) return;
    this._syncFormIntoDraft();
    const FilePickerImpl = getFilePickerClass();
    const fp = new FilePickerImpl({
      type: "image",
      current: this._draft.bannerImg || this._draft.img,
      callback: path => {
        this._draft.bannerImg = path;
        // A different image means the old crop is meaningless.
        this._draft.framing.banner = defaultFraming();
        this._markDirty();
        this.render();
      }
    });
    fp.browse();
  }

  static #onClearBannerImage(event, _target) {
    event.stopPropagation();
    if (!this._draft) return;
    this._syncFormIntoDraft();
    this._draft.bannerImg = "";
    this._draft.framing.banner = defaultFraming();
    this._markDirty();
    this.render();
  }

  static #onResetFraming(event, target) {
    event.stopPropagation();
    const key = target.dataset.frame;
    if (!key || !this._draft) return;
    this._draft.framing[key] = defaultFraming();
    this._markDirty();
    this.render();
  }

  static async #onLoadFromTable(_event, _target) {
    if (!this._draft) return;
    const select = this.element.querySelector('[name="table-id"]');
    const countInput = this.element.querySelector('[name="table-count"]');
    const tableId = select?.value || this._tableId;
    this._tableCount = clampCount(countInput?.value ?? this._tableCount);

    if (!tableId) {
      ui.notifications.warn(game.i18n.localize("SHOPKEEPER.Tools.NoTables"));
      return;
    }
    const table = game.tables.get(tableId);
    if (!table) {
      ui.notifications.warn(game.i18n.localize("SHOPKEEPER.Tools.TableMissing"));
      return;
    }

    this._syncFormIntoDraft();
    await this._loadFromTable(table, this._tableCount);
  }

  static async #onGeneratePrices(_event, _target) {
    if (!this._draft) return;
    this._syncFormIntoDraft();

    const inventory = this._draft.inventory;
    if (!inventory.length) {
      ui.notifications.warn(game.i18n.localize("SHOPKEEPER.Tools.NothingToPrice"));
      return;
    }

    const { priced, skipped, unchanged } = await generateMissingPrices(inventory);

    if (priced) this._markDirty();
    this.render();

    if (!priced && !skipped.length) {
      ui.notifications.info(game.i18n.format("SHOPKEEPER.Tools.AllPriced", { count: unchanged }));
      return;
    }

    ui.notifications.info(game.i18n.format("SHOPKEEPER.Tools.PricesGenerated", { priced, unchanged }));

    // A 0 gp item is free at checkout, so make unpriceable items impossible to miss.
    if (skipped.length) {
      const names = skipped.slice(0, 10).map(e => e.name).join(", ");
      const more = skipped.length > 10 ? ` (+${skipped.length - 10} more)` : "";
      ui.notifications.warn(
        game.i18n.format("SHOPKEEPER.Tools.PricesSkipped", { count: skipped.length, names: names + more }),
        { permanent: true }
      );
    }
  }

  static async #onClearShop(_event, _target) {
    if (!this._draft) return;
    this._syncFormIntoDraft();

    const count = this._draft.inventory.length;
    if (!count) {
      ui.notifications.info(game.i18n.localize("SHOPKEEPER.Tools.AlreadyEmpty"));
      return;
    }

    const DialogV2 = foundry.applications.api.DialogV2;
    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize("SHOPKEEPER.Tools.ClearConfirmTitle") },
      content: game.i18n.format("SHOPKEEPER.Tools.ClearConfirmBody", {
        count,
        name: this._draft.name ?? ""
      })
    });
    if (!confirmed) return;

    this._draft.inventory = [];
    this._markDirty();
    this.render();
    ui.notifications.info(game.i18n.format("SHOPKEEPER.Tools.Cleared", { count }));
  }

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

  static async #onSelectShop(_event, target) {
    const id = target.closest("[data-shop-id]")?.dataset.shopId;
    if (!id) return;
    if (id === this.selectedShopId && this.mode === "shops") return;

    if (!(await this.#confirmDiscardChanges())) return;

    this.mode = "shops";
    this.selectedShopId = id;
    this._draft = null;
    this._dirty = false;
    this.render();
  }

  /**
   * Bulk tools can change a lot of inventory at once, and none of it is written
   * until Save. Switching shops would silently throw that away, so confirm.
   * @returns {Promise<boolean>} true to proceed
   */
  async #confirmDiscardChanges() {
    if (!this._dirty || !this._draft) return true;
    const DialogV2 = foundry.applications.api.DialogV2;
    return DialogV2.confirm({
      window: { title: game.i18n.localize("SHOPKEEPER.Edit.UnsavedTitle") },
      content: game.i18n.format("SHOPKEEPER.Edit.UnsavedBody", { name: this._draft.name ?? "" })
    });
  }

  static async #onNewShop(_event, _target) {
    if (!(await this.#confirmDiscardChanges())) return;
    const shop = await createShop({});
    this.mode = "shops";
    this.selectedShopId = shop.id;
    this._draft = foundry.utils.deepClone(shop);
    this._dirty = false;
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
      bannerImg: this._draft.bannerImg || "",
      framing: normalizeFramingSet(this._draft.framing),
      visible: !!this._draft.visible
    });
    await setShopInventory(this.selectedShopId, this._draft.inventory);
    this._dirty = false;
    ui.notifications.info(game.i18n.localize("SHOPKEEPER.Edit.Saved"));
    this.render();
  }

  static openOrFocus() {
    const existing = foundry.applications.instances.get(ShopEditApp.APP_ID);
    if (existing) return existing.bringToFront();
    return new ShopEditApp().render(true);
  }
}
