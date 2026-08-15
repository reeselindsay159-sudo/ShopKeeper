/**
 * Populating a shop's inventory by rolling on a RollTable.
 */
import { isSpell, makeScrollFromSpell } from "./scrolls.js";

/** @returns {{id:string,name:string}[]} world RollTables, sorted by name */
export function getWorldTables() {
  return game.tables.contents
    .map(t => ({ id: t.id, name: t.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Resolve a TableResult into an Item document.
 *
 * The stored shape of a table result has changed across Foundry versions:
 * v13+ carries a `documentUuid`, while older data carries a
 * `documentCollection` + `documentId` pair. We deliberately do not branch on
 * `result.type`, which changed from a numeric enum to a string and is the
 * least stable part of this schema.
 *
 * @param {TableResult} result
 * @returns {Promise<Item|null>} null for text results or broken references
 */
export async function resolveResultToItem(result) {
  let uuid = result?.documentUuid ?? null;

  if (!uuid) {
    const collection = result?.documentCollection;
    const id = result?.documentId;
    if (collection && id) {
      uuid = collection === "Item" ? `Item.${id}` : `Compendium.${collection}.${id}`;
    }
  }

  if (!uuid) return null;

  let doc = null;
  try {
    doc = await fromUuid(uuid);
  } catch (err) {
    return null;
  }

  return doc?.documentName === "Item" ? doc : null;
}

/**
 * Roll on a table until `count` Items have been gathered.
 *
 * Uses `RollTable#roll()` rather than `draw()`/`drawMany()` on purpose: `roll()`
 * does not flag results as drawn, so sampling a table here never mutates the
 * GM's table document. `recursive` lets nested tables resolve normally.
 *
 * Because a single roll can yield several results (or none, on a gappy table),
 * we keep rolling until we have enough Items, bounded by an attempt limit so a
 * text-only or misconfigured table can't spin forever.
 *
 * @param {RollTable} table
 * @param {number} count
 * @returns {Promise<{items: Item[], attempts: number, nonItems: number, emptyRolls: number}>}
 */
export async function rollItemsFromTable(table, count) {
  const wanted = Math.max(1, Math.floor(count) || 1);
  const items = [];
  const maxAttempts = wanted * 10 + 20;

  let attempts = 0;
  let nonItems = 0;
  let emptyRolls = 0;
  let spells = 0;

  while (items.length < wanted && attempts < maxAttempts) {
    attempts++;

    let draw = null;
    try {
      draw = await table.roll({ recursive: true });
    } catch (err) {
      console.warn("shopkeeper | table roll failed", err);
      emptyRolls++;
      continue;
    }

    const results = draw?.results ?? [];
    if (!results.length) {
      emptyRolls++;
      continue;
    }

    for (const result of results) {
      if (items.length >= wanted) break;
      const item = await resolveResultToItem(result);
      if (item) {
        if (isSpell(item)) spells++;
        items.push(item);
      } else nonItems++;
    }
  }

  return { items, attempts, nonItems, emptyRolls, spells };
}

/**
 * Convert an Item document into a shop inventory entry.
 * @param {Item} item
 * @returns {object}
 */
export function makeInventoryEntry(item) {
  return {
    id: foundry.utils.randomID(),
    name: item.name,
    img: item.img,
    price: Number(item.system?.price?.value) || 0,
    quantity: 1,
    sourceUuid: item.uuid ?? null,
    itemData: item.toObject()
  };
}

/**
 * Convert an Item into an inventory entry, turning spells into spell scrolls.
 *
 * A spell is an Item in dnd5e, so without this a spell rolled off a loot table
 * would land in the shop as a raw spell: no price, and nothing a player can
 * actually buy and use.
 *
 * @param {Item} item
 * @returns {Promise<object>}
 */
export async function makeInventoryEntryAsync(item) {
  if (!isSpell(item)) return makeInventoryEntry(item);

  const scroll = await makeScrollFromSpell(item);
  if (!scroll) return makeInventoryEntry(item);

  return {
    id: foundry.utils.randomID(),
    name: scroll.name,
    img: scroll.img,
    price: scroll.pricing.price,
    quantity: 1,
    // Keyed to the source spell so repeat rolls stack onto one scroll row.
    sourceUuid: item.uuid ?? null,
    fromSpell: true,
    itemData: scroll.itemData
  };
}

/**
 * Merge rolled items into an existing inventory, stacking repeats rather than
 * creating duplicate rows.
 *
 * @param {object[]} inventory  mutated in place
 * @param {Item[]} items
 * @returns {{added: number, stacked: number}}
 */
export async function mergeItemsIntoInventory(inventory, items) {
  let added = 0;
  let stacked = 0;
  let scrolls = 0;

  for (const item of items) {
    const uuid = item.uuid ?? null;
    // Match on source uuid where available, falling back to name so that
    // entries added before sourceUuid existed still stack sensibly.
    const existing = inventory.find(entry =>
      (uuid && entry.sourceUuid === uuid) || (!entry.sourceUuid && entry.name === item.name)
    );

    if (existing) {
      // Leave unlimited stock (-1) alone; it is already effectively infinite.
      if (existing.quantity >= 0) existing.quantity += 1;
      stacked++;
    } else {
      const entry = await makeInventoryEntryAsync(item);
      if (entry.fromSpell) scrolls++;
      inventory.push(entry);
      added++;
    }
  }

  return { added, stacked, scrolls };
}
