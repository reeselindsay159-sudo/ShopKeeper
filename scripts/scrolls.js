/**
 * Turning spells rolled off a table into sellable spell scrolls.
 *
 * In dnd5e a spell IS an Item (type "spell"), so a spell landing on a loot
 * table would otherwise drop into a shop as a raw spell — unpriceable, and
 * useless in a player's inventory. Instead we convert it to a spell scroll.
 */

/**
 * ---------------------------------------------------------------------------
 * BASE SCROLL PRICE BY SPELL LEVEL, in gp. Edit freely.
 * ---------------------------------------------------------------------------
 * These are the DMG's suggested *purchase* prices for consumable spell scrolls
 * (DMG p.135: a consumable is worth about half the equivalent permanent item),
 * taken at the midpoint of each rarity band. They are what a scroll sells for
 * in a shop, which is what we want here.
 *
 * Xanathar's crafting-cost table is the other common choice — cheaper at low
 * level, far more expensive at high level. To use it instead, swap these
 * numbers for: 0:15, 1:25, 2:250, 3:500, 4:2500, 5:5000, 6:15000, 7:25000,
 * 8:50000, 9:250000.
 *
 * The spell's material component cost is added on top of whichever base is
 * used — see materialCostOf().
 */
export const SCROLL_BASE_PRICE = {
  0: 50,      // cantrip
  1: 50,
  2: 250,
  3: 250,
  4: 2500,
  5: 2500,
  6: 25000,
  7: 25000,
  8: 25000,
  9: 50000
};

/** Rarity dnd5e assigns a scroll of each level, used when the system does not. */
export const SCROLL_RARITY = {
  0: "common", 1: "common", 2: "uncommon", 3: "uncommon",
  4: "rare", 5: "rare", 6: "veryRare", 7: "veryRare",
  8: "veryRare", 9: "legendary"
};

/** @returns {boolean} whether this document/data is a dnd5e spell */
export function isSpell(doc) {
  return doc?.type === "spell";
}

/**
 * Cost in gp of a spell's material components.
 *
 * dnd5e stores this on `system.materials.cost`. Only consumed components are
 * a real expense per scroll, but an uncomsumed focus still has to be supplied
 * once, so both are counted — that matches how most tables price scrolls.
 *
 * @param {object} spellData
 * @returns {number}
 */
export function materialCostOf(spellData) {
  const cost = Number(spellData?.system?.materials?.cost);
  return Number.isFinite(cost) && cost > 0 ? cost : 0;
}

/** @returns {number} the spell's level, clamped into the 0-9 table */
export function spellLevelOf(spellData) {
  const level = Number(spellData?.system?.level);
  if (!Number.isFinite(level)) return 0;
  return Math.min(9, Math.max(0, Math.floor(level)));
}

/**
 * Price for a scroll of this spell: base cost for its level, plus the cost of
 * any material components the spell requires.
 *
 * @param {object} spellData
 * @returns {{price:number, base:number, materials:number, level:number}}
 */
export function priceScrollFor(spellData) {
  const level = spellLevelOf(spellData);
  const base = SCROLL_BASE_PRICE[level] ?? 0;
  const materials = materialCostOf(spellData);
  return { price: base + materials, base, materials, level };
}

/**
 * Convert a spell into a spell scroll item.
 *
 * Prefers the dnd5e system's own `Item5e.createScrollFromSpell`, so the scroll
 * carries the correct description, activities, save DC and attack bonus for its
 * level. Falls back to a hand-built consumable if that API is missing or fails,
 * so a table roll never silently drops a result.
 *
 * @param {Item} spell
 * @returns {Promise<{name:string, img:string, itemData:object, pricing:object}|null>}
 */
export async function makeScrollFromSpell(spell) {
  const spellData = spell?.toObject?.() ?? spell;
  if (!isSpell(spellData)) return null;

  const pricing = priceScrollFor(spellData);
  let scrollData = null;

  try {
    const Item5e = CONFIG?.Item?.documentClass;
    if (typeof Item5e?.createScrollFromSpell === "function") {
      const scroll = await Item5e.createScrollFromSpell(spell, {}, { dialog: false });
      // The system returns either an Item or raw data depending on version.
      scrollData = scroll?.toObject?.() ?? scroll ?? null;
    }
  } catch (err) {
    console.warn("shopkeeper | createScrollFromSpell failed, using fallback", err);
  }

  if (!scrollData) scrollData = buildFallbackScroll(spellData, pricing.level);

  // The system does not price scrolls, so set ours.
  foundry.utils.setProperty(scrollData, "system.price.value", pricing.price);
  foundry.utils.setProperty(scrollData, "system.price.denomination", "gp");
  if (!foundry.utils.getProperty(scrollData, "system.rarity")) {
    foundry.utils.setProperty(scrollData, "system.rarity", SCROLL_RARITY[pricing.level]);
  }
  delete scrollData._id;

  return {
    name: scrollData.name,
    img: scrollData.img,
    itemData: scrollData,
    pricing
  };
}

/**
 * Minimal spell scroll built by hand, for when the system API is unavailable.
 * @param {object} spellData
 * @param {number} level
 */
function buildFallbackScroll(spellData, level) {
  const levelLabel = level === 0 ? "Cantrip" : `Level ${level}`;
  return {
    name: `Spell Scroll (${spellData.name})`,
    type: "consumable",
    img: spellData.img || "icons/sundries/scrolls/scroll-bound-brown-tan.webp",
    system: {
      description: {
        value: `<p>A spell scroll bearing the words of <strong>${spellData.name}</strong> (${levelLabel}).</p>`
                + (spellData.system?.description?.value ?? "")
      },
      type: { value: "scroll" },
      rarity: SCROLL_RARITY[level],
      quantity: 1,
      price: { value: 0, denomination: "gp" },
      uses: { spent: 0, max: "1", autoDestroy: true }
    },
    flags: {}
  };
}
