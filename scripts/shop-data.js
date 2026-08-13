import { MODULE_ID, SETTINGS } from "./constants.js";

/**
 * Register the world-scoped setting that stores every shop.
 * World-scope settings can only be written by a GM client, which is why all
 * mutation helpers below are only ever invoked from GM contexts (the Edit
 * Shops app, and the GM-side socket handler that processes purchases).
 */
export function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.SHOPS, {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });
}

/** @returns {Record<string, object>} the raw shops map, keyed by shop id */
export function getShops() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS.SHOPS) ?? {});
}

/** @returns {object[]} all shops as an array, sorted by name */
export function getShopsArray() {
  return Object.values(getShops()).sort((a, b) => a.name.localeCompare(b.name));
}

/** @returns {object[]} shops flagged visible, sorted by name (what players see) */
export function getVisibleShopsArray() {
  return getShopsArray().filter(s => s.visible);
}

/** @param {string} id @returns {object|undefined} */
export function getShop(id) {
  return getShops()[id];
}

async function saveShops(shops) {
  await game.settings.set(MODULE_ID, SETTINGS.SHOPS, shops);
}

/**
 * Create a new, empty shop. GM only.
 * @param {{name?: string, description?: string, img?: string}} data
 * @returns {Promise<object>} the created shop
 */
export async function createShop(data = {}) {
  if (!game.user.isGM) throw new Error("Only a GM may create shops.");
  const shops = getShops();
  const id = foundry.utils.randomID();
  const shop = {
    id,
    name: data.name?.trim() || "New Shop",
    description: data.description?.trim() || "",
    img: data.img || "icons/svg/shop.svg",
    visible: false,
    inventory: []
  };
  shops[id] = shop;
  await saveShops(shops);
  return shop;
}

/**
 * Merge an update into an existing shop's top-level fields (name, description,
 * img, visible). GM only.
 */
export async function updateShop(id, data = {}) {
  if (!game.user.isGM) throw new Error("Only a GM may update shops.");
  const shops = getShops();
  if (!shops[id]) throw new Error(`Shop ${id} does not exist.`);
  foundry.utils.mergeObject(shops[id], data, { inplace: true });
  await saveShops(shops);
  return shops[id];
}

/** Delete a shop entirely. GM only. */
export async function deleteShop(id) {
  if (!game.user.isGM) throw new Error("Only a GM may delete shops.");
  const shops = getShops();
  delete shops[id];
  await saveShops(shops);
}

/** Replace a shop's inventory array wholesale. GM only. */
export async function setShopInventory(id, inventory) {
  if (!game.user.isGM) throw new Error("Only a GM may edit shop inventory.");
  const shops = getShops();
  if (!shops[id]) throw new Error(`Shop ${id} does not exist.`);
  shops[id].inventory = inventory;
  await saveShops(shops);
  return shops[id];
}

/**
 * Directly persist the full shops map. Used by the GM-side purchase handler
 * after it has computed new stock quantities. GM only.
 */
export async function saveShopsRaw(shops) {
  if (!game.user.isGM) throw new Error("Only a GM may write shop data.");
  await saveShops(shops);
}
