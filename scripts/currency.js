import { CP_PER_DENOMINATION, DENOMINATION_ORDER } from "./constants.js";

/**
 * Convert an actor's system.currency object into a total number of copper pieces.
 * @param {object} currency  e.g. {pp, gp, ep, sp, cp}
 * @returns {number}
 */
export function currencyToCopper(currency = {}) {
  return DENOMINATION_ORDER.reduce((total, denom) => {
    const amount = Number(currency?.[denom]) || 0;
    return total + amount * CP_PER_DENOMINATION[denom];
  }, 0);
}

/**
 * Convert a gp value (may be fractional, e.g. item priced at 2.5 gp) into whole copper pieces.
 * @param {number} gp
 * @returns {number}
 */
export function gpToCopper(gp) {
  return Math.round((Number(gp) || 0) * CP_PER_DENOMINATION.gp);
}

/**
 * Convert a copper total into a gp value (for display / comparisons).
 * @param {number} cp
 * @returns {number}
 */
export function copperToGp(cp) {
  return (Number(cp) || 0) / CP_PER_DENOMINATION.gp;
}

/**
 * Decompose a total copper amount back into denominations, greedily maximizing
 * higher-value coins first (pp -> gp -> ep -> sp -> cp).
 * @param {number} totalCopper
 * @returns {{pp:number, gp:number, ep:number, sp:number, cp:number}}
 */
export function copperToCurrency(totalCopper) {
  let remaining = Math.max(0, Math.round(Number(totalCopper) || 0));
  const result = {};
  for (const denom of DENOMINATION_ORDER) {
    const value = CP_PER_DENOMINATION[denom];
    result[denom] = Math.floor(remaining / value);
    remaining -= result[denom] * value;
  }
  return result;
}
