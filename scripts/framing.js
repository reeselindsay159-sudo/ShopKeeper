/**
 * Per-shop image framing: zoom and pan.
 *
 * A shop stores two independent framings of the same source image, because the
 * two places it appears have very different shapes:
 *   - `shop`   the tall image on the individual shop page
 *   - `banner` the wide row in the Market
 *
 * The transform used everywhere is:
 *     transform: translate(x%, y%) scale(zoom)
 *
 * CSS applies a transform list right-to-left, so the scale happens first and
 * the translate is then resolved against the element's *untransformed* box.
 * That makes the percentages easy to reason about: the element always fills its
 * frame, so at zoom Z the image overflows each edge by exactly (Z - 1) / 2 of
 * the frame, and that is precisely the maximum pan. See clampFraming().
 */

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 0.05;

export const FRAME_KEYS = ["shop", "banner"];

/** @returns {{zoom:number,x:number,y:number}} a fresh identity framing */
export function defaultFraming() {
  return { zoom: 1, x: 0, y: 0 };
}

/** @returns {{shop:object, banner:object}} a fresh framing set */
export function defaultFramingSet() {
  return { shop: defaultFraming(), banner: defaultFraming() };
}

/**
 * Coerce arbitrary stored data into a valid framing, clamping pan so the image
 * can never be dragged past its own edge (which would show empty background).
 * @param {any} framing
 * @returns {{zoom:number,x:number,y:number}}
 */
export function clampFraming(framing) {
  const zoom = clampNumber(framing?.zoom, ZOOM_MIN, ZOOM_MAX, 1);
  // At zoom 1 the image exactly fills the frame, so no panning is possible.
  const limit = ((zoom - 1) / 2) * 100;
  return {
    zoom,
    x: clampNumber(framing?.x, -limit, limit, 0),
    y: clampNumber(framing?.y, -limit, limit, 0)
  };
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  // Avoid accumulating float noise in stored data.
  return Math.round(n * 1000) / 1000;
}

/** Normalize a whole framing set, filling in anything missing. */
export function normalizeFramingSet(framing) {
  const out = {};
  for (const key of FRAME_KEYS) out[key] = clampFraming(framing?.[key]);
  return out;
}

/** How far the image may be panned at this zoom, in percent. */
export function panLimit(zoom) {
  return ((clampNumber(zoom, ZOOM_MIN, ZOOM_MAX, 1) - 1) / 2) * 100;
}

/**
 * Write a framing onto an element as CSS custom properties.
 * @param {HTMLElement} el
 * @param {object} framing
 * @param {string} prefix  e.g. "sk-b" for banner, "sk-s" for the shop page
 */
export function applyFramingVars(el, framing, prefix) {
  if (!el) return;
  const { zoom, x, y } = clampFraming(framing);
  el.style.setProperty(`--${prefix}z`, String(zoom));
  el.style.setProperty(`--${prefix}x`, `${x}%`);
  el.style.setProperty(`--${prefix}y`, `${y}%`);
}

/**
 * Make a framing preview interactive: drag to pan, wheel to zoom.
 *
 * @param {HTMLElement} surface  the clipping box the user drags inside
 * @param {object} initial       starting framing (mutated copy is returned via onChange)
 * @param {(framing:object)=>void} onChange  called on every change
 * @returns {{destroy:()=>void, set:(f:object)=>void, get:()=>object}}
 */
export function makeFramer(surface, initial, onChange) {
  let framing = clampFraming(initial);
  let dragging = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startFrameX = 0;
  let startFrameY = 0;

  const emit = () => {
    framing = clampFraming(framing);
    onChange?.(framing);
  };

  const onPointerDown = event => {
    // Only pan when zoomed in; at 1x there is nothing to reveal.
    if (framing.zoom <= ZOOM_MIN) return;
    if (event.button !== 0) return;
    dragging = true;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startFrameX = framing.x;
    startFrameY = framing.y;
    surface.setPointerCapture?.(pointerId);
    surface.classList.add("is-panning");
    event.preventDefault();
  };

  const onPointerMove = event => {
    if (!dragging || event.pointerId !== pointerId) return;
    const rect = surface.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // Convert pixel drag into percent-of-frame, matching the translate units.
    framing.x = startFrameX + ((event.clientX - startX) / rect.width) * 100;
    framing.y = startFrameY + ((event.clientY - startY) / rect.height) * 100;
    emit();
    event.preventDefault();
  };

  const endDrag = event => {
    if (!dragging || (event && event.pointerId !== pointerId)) return;
    dragging = false;
    if (pointerId !== null) surface.releasePointerCapture?.(pointerId);
    pointerId = null;
    surface.classList.remove("is-panning");
  };

  const onWheel = event => {
    event.preventDefault();
    const direction = event.deltaY > 0 ? -1 : 1;
    framing.zoom = framing.zoom + direction * (ZOOM_STEP * 2);
    emit();
  };

  surface.addEventListener("pointerdown", onPointerDown);
  surface.addEventListener("pointermove", onPointerMove);
  surface.addEventListener("pointerup", endDrag);
  surface.addEventListener("pointercancel", endDrag);
  surface.addEventListener("wheel", onWheel, { passive: false });

  return {
    destroy() {
      surface.removeEventListener("pointerdown", onPointerDown);
      surface.removeEventListener("pointermove", onPointerMove);
      surface.removeEventListener("pointerup", endDrag);
      surface.removeEventListener("pointercancel", endDrag);
      surface.removeEventListener("wheel", onWheel);
    },
    set(next) {
      framing = clampFraming(next);
      emit();
    },
    get() {
      return { ...framing };
    }
  };
}
