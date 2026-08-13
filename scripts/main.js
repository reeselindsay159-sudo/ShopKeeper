import { MODULE_ID, SETTINGS } from "./constants.js";
import { registerSettings } from "./shop-data.js";
import { initSocket } from "./socket.js";
import { MarketApp } from "./apps/market-app.js";
import { ShopApp } from "./apps/shop-app.js";
import { ShopEditApp } from "./apps/shop-edit-app.js";

Hooks.once("init", () => {
  registerSettings();

  const templatePaths = [
    `modules/${MODULE_ID}/templates/market.hbs`,
    `modules/${MODULE_ID}/templates/shop.hbs`,
    `modules/${MODULE_ID}/templates/shop-edit.hbs`
  ];
  foundry.applications.handlebars.loadTemplates(templatePaths);
});

Hooks.once("ready", () => {
  initSocket();
});

// Keep any open Shopkeeper windows (Market, Shop, Edit Shops) in sync when the
// underlying shop data or the chosen market theme changes on any client.
const WATCHED_SETTINGS = new Set([
  `${MODULE_ID}.${SETTINGS.SHOPS}`,
  `${MODULE_ID}.${SETTINGS.THEME}`
]);

Hooks.on("updateSetting", setting => {
  if (!WATCHED_SETTINGS.has(setting.key)) return;
  for (const app of foundry.applications.instances.values()) {
    if (app.isShopkeeperApp) app.render(false);
  }
});

Hooks.on("getSceneControlButtons", controls => {
  controls[MODULE_ID] = {
    name: MODULE_ID,
    title: "SHOPKEEPER.Controls.Category",
    icon: "fa-solid fa-shop",
    order: Object.keys(controls).length,
    tools: {
      openShop: {
        name: "openShop",
        title: "SHOPKEEPER.Controls.OpenShop",
        icon: "fa-solid fa-store",
        button: true,
        visible: true,
        onChange: () => MarketApp.openOrFocus()
      },
      editShop: {
        name: "editShop",
        title: "SHOPKEEPER.Controls.EditShop",
        icon: "fa-solid fa-screwdriver-wrench",
        button: true,
        visible: game.user?.isGM ?? false,
        onChange: () => ShopEditApp.openOrFocus()
      }
    }
  };
});

// Expose a small API for macros / other modules.
Hooks.once("ready", () => {
  game.modules.get(MODULE_ID).api = { MarketApp, ShopApp, ShopEditApp };
});
