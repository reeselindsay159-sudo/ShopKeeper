import { MODULE_ID } from "../constants.js";
import { getShopsArray } from "../shop-data.js";
import { ShopApp } from "./shop-app.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class MarketApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static APP_ID = "shopkeeper-market";

  isShopkeeperApp = true;

  static DEFAULT_OPTIONS = {
    id: MarketApp.APP_ID,
    classes: ["shopkeeper", "shopkeeper-market"],
    tag: "div",
    window: {
      title: "SHOPKEEPER.Market.Title",
      icon: "fa-solid fa-shop",
      resizable: true
    },
    position: { width: 560, height: 680 },
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
    const shops = getShopsArray().filter(s => isGM || s.visible);
    return {
      isGM,
      shops,
      hasShops: shops.length > 0
    };
  }

  static #onOpenShop(_event, target) {
    const shopId = target.closest("[data-shop-id]")?.dataset.shopId;
    if (!shopId) return;
    new ShopApp({ shopId }).render(true);
  }

  /** Open the Market, or bring an already-open one to the front. */
  static openOrFocus() {
    const existing = foundry.applications.instances.get(MarketApp.APP_ID);
    if (existing) return existing.bringToFront();
    return new MarketApp().render(true);
  }
}
