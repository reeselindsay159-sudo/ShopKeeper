/**
 * Automatic price generation for magic items.
 *
 * ---------------------------------------------------------------------------
 * TO CHANGE PRICING, EDIT THE TABLE BELOW. Nothing else needs to be touched.
 * ---------------------------------------------------------------------------
 *
 * Each entry is a pair of dice formulas evaluated with Foundry's Roll class, so
 * anything valid in a Foundry roll works here ("2d10 * 1000", "(1d4+1) * 10000",
 * and so on). `item` is used for permanent magic items; `consumable` is used
 * when the item's document type is "consumable" (potions, scrolls, ammunition).
 *
 * `common` through `veryRare` are the values Reese specified. `legendary` and
 * `artifact` continue the same x10 progression — they were not specified, and
 * are included only so that legendary loot never lands in a shop at 0 gp
 * (which would make it free). Adjust or remove them freely.
 */
export const RARITY_PRICING = {
  common:    { item: "1d4 * 50",     consumable: "1d4 * 25" },
  uncommon:  { item: "1d6 * 100",    consumable: "1d6 * 50" },
  rare:      { item: "1d6 * 1000",   consumable: "1d6 * 500" },
  veryRare:  { item: "1d6 * 10000",  consumable: "1d6 * 5000" },
  legendary: { item: "1d6 * 100000", consumable: "1d6 * 50000" },
  artifact:  { item: "1d6 * 100000", consumable: "1d6 * 50000" }
};

/** dnd5e document types that should use the "consumable" column. */
const CONSUMABLE_TYPES = new Set(["consumable"]);

/**
 * Read a normalized rarity key off stored item data.
 * dnd5e leaves `system.rarity` as an empty string on mundane gear, which is how
 * we distinguish "magic item with no price" from "ordinary rope".
 * @param {object} itemData
 * @returns {string|null}
 */
export function getRarity(itemData) {
  const raw = itemData?.system?.rarity;
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  if (!key) return null;
  // Tolerate stored variants like "very rare" / "Very Rare" from older data or
  // third-party content that did not use the canonical camelCase key.
  const normalized = key.replace(/[\s_-]+/g, "").toLowerCase();
  const match = Object.keys(RARITY_PRICING).find(k => k.toLowerCase() === normalized);
  return match ?? null;
}

/** @returns {boolean} whether this item should be priced on the consumable column */
export function isConsumable(itemData) {
  return CONSUMABLE_TYPES.has(itemData?.type);
}

/**
 * Roll a price for a single item.
 * @param {object} itemData  a stored dnd5e item object
 * @returns {Promise<{price:number, rarity:string, consumable:boolean}|null>}
 *          null when the item has no usable rarity (i.e. it is not a magic item)
 */
export async function rollPriceFor(itemData) {
  const rarity = getRarity(itemData);
  if (!rarity) return null;

  const tier = RARITY_PRICING[rarity];
  if (!tier) return null;

  const consumable = isConsumable(itemData);
  const formula = consumable ? tier.consumable : tier.item;

  const roll = await new Roll(formula).evaluate();
  return {
    price: Math.max(0, Math.round(roll.total)),
    rarity,
    consumable
  };
}

/**
 * Fill in prices for every inventory entry that is unpriced or priced at 0.
 * Mutates the entries in place.
 *
 * @param {object[]} inventory
 * @returns {Promise<{priced: number, skipped: object[], unchanged: number}>}
 *          `skipped` lists entries that stayed at 0 gp because they carry no
 *          magic-item rarity — the caller should warn about these, since a
 *          0 gp item is free to buy.
 */
export async function generateMissingPrices(inventory) {
  const skipped = [];
  let priced = 0;
  let unchanged = 0;

  for (const entry of inventory) {
    const current = Number(entry.price) || 0;
    if (current > 0) {
      unchanged++;
      continue;
    }

    const result = await rollPriceFor(entry.itemData);
    if (!result) {
      skipped.push(entry);
      continue;
    }

    entry.price = result.price;
    priced++;
  }

  return { priced, skipped, unchanged };
}
