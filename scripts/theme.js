import { DEFAULT_ACCENT } from "./constants.js";

const HEX_COLOR = /^#[0-9a-f]{3,8}$/i;

/**
 * Apply per-row CSS custom properties (--img, --accent) to every themed shop
 * row inside `root`.
 *
 * Doing this in JS rather than via an inline `style="..."` attribute in the
 * Handlebars template matters: Foundry image paths routinely contain spaces and
 * may contain quotes, which would otherwise terminate the attribute early. Here
 * the value never passes through HTML parsing at all.
 *
 * @param {HTMLElement} root
 */
export function applyRowVars(root) {
  if (!root) return;
  for (const row of root.querySelectorAll(".sk-row[data-shop-img]")) {
    const img = row.dataset.shopImg;
    if (img) {
      // Escape characters that would terminate the CSS url("...") token.
      const safe = img.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      row.style.setProperty("--img", `url("${safe}")`);
    }

    const accent = row.dataset.shopAccent;
    row.style.setProperty("--accent", HEX_COLOR.test(accent) ? accent : DEFAULT_ACCENT);
  }
}
