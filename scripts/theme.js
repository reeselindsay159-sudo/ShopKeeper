import { DEFAULT_ACCENT } from "./constants.js";
import { applyFramedImage, normalizeFramingSet } from "./framing.js";

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;

/**
 * Apply per-row CSS custom properties to every themed shop row inside `root`:
 *   --img      the shop artwork
 *   --accent   the shop's accent colour
 *   --sk-s*    the SHOP framing, driving the square thumbnail (.sk-thumb)
 *   --sk-b*    the BANNER framing, driving the full-bleed layer (.sk-bg)
 *
 * The two framings are applied to different elements on purpose. The thumbnail
 * is the same square picture the shop page shows, so it follows the shop
 * framing; only the artwork that bleeds across the whole row uses the wide
 * banner framing.
 *
 * Values are set from JS rather than an inline `style="..."` attribute in the
 * template because Foundry image paths routinely contain spaces and may contain
 * quotes, which would otherwise terminate the attribute early.
 *
 * @param {HTMLElement} root
 * @param {Record<string, object>} [framings]  shopId -> framing set
 */
export function applyRowVars(root, framings = {}) {
  if (!root) return;

  for (const row of root.querySelectorAll(".sk-row[data-shop-img]")) {
    const img = row.dataset.shopImg;
    if (img) row.style.setProperty("--img", cssUrl(img));

    const accent = row.dataset.shopAccent;
    row.style.setProperty("--accent", HEX_COLOR.test(accent) ? accent : DEFAULT_ACCENT);

    // Framing may arrive by shop id (Market) or inline as JSON (theme gallery).
    const inline = row.dataset.shopFraming ? safeParse(row.dataset.shopFraming) : null;
    const set = normalizeFramingSet(inline ?? framings[row.dataset.shopId] ?? null);

    // Square thumbnail — measured against its own clip box.
    const thumb = row.querySelector(".sk-thumb");
    if (thumb && img) {
      applyFramedImage(thumb, { src: img, framing: set.shop, prefix: "sk-s" });
    }

    // Full-bleed layer — .sk-bg is inset:0 on the row, so the row is its frame.
    // Measuring the row also works while .sk-bg is display:none for themes that
    // do not use it, which would otherwise report a zero-sized box.
    const bg = row.querySelector(".sk-bg");
    if (bg && img) {
      applyFramedImage(bg, { src: img, framing: set.banner, prefix: "sk-b", frameEl: row });
    }
  }
}

/** Build a CSS url() token that cannot be broken by quotes in the path. */
export function cssUrl(path) {
  const safe = String(path).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `url("${safe}")`;
}

function safeParse(json) {
  try {
    return JSON.parse(json);
  } catch (err) {
    return null;
  }
}
