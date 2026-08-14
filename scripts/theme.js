import { DEFAULT_ACCENT } from "./constants.js";
import { applyFramingVars, clampFraming } from "./framing.js";

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;

/**
 * Apply per-row CSS custom properties to every themed shop row inside `root`:
 *   --img      the shop artwork
 *   --accent   the shop's accent colour
 *   --sk-b*    the banner zoom/pan framing
 *
 * Doing this in JS rather than via an inline `style="..."` attribute in the
 * Handlebars template matters: Foundry image paths routinely contain spaces and
 * may contain quotes, which would otherwise terminate the attribute early. Here
 * the value never passes through HTML parsing at all.
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

    // Framing may be supplied by id (Market) or inline (theme picker preview).
    const shopId = row.dataset.shopId;
    const inline = row.dataset.shopFraming ? safeParse(row.dataset.shopFraming) : null;
    const framing = inline ?? framings[shopId]?.banner ?? null;
    applyFramingVars(row, clampFraming(framing), "sk-b");
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
