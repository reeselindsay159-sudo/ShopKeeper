/**
 * Per-shop image framing: zoom and pan.
 *
 * A shop stores two independent framings of the same source image:
 *   - `shop`   the square crop, used by BOTH the shop page portrait and the
 *              shop thumbnail in the Market row (they are the same picture in
 *              the same shape, so they share one framing)
 *   - `banner` the wide crop, used only by themes that bleed the artwork across
 *              the whole Market row (Cinematic, Purple Haze)
 *
 * The transform used everywhere is:
 *     transform: translate(x%, y%) scale(zoom)
 *
 * CSS applies a transform list right-to-left, so the scale happens first and
 * the translate is then resolved against the element's *untransformed* box —
 * i.e. against the frame. That makes the pan units easy: x is a percentage of
 * the frame width, y a percentage of the frame height.
 *
 * ---------------------------------------------------------------------------
 * Pan limits are aspect-aware, and this is the subtle part.
 *
 * The image is laid out with `cover`, so at zoom 1 it already overflows the
 * frame on one axis whenever their aspect ratios differ — a square image in a
 * 5:1 banner is scaled to the frame's width and then stands five times taller
 * than the frame. Treating "zoom 1" as "no overflow, no panning" would strand
 * the GM on a fixed middle band of their own artwork, unable to reach the top
 * or bottom of it. So the limits are derived from the real rendered size:
 *
 *     renderedSize = imageSize * max(frameW/imgW, frameH/imgH) * zoom
 *     overflow     = max(0, rendered - frame)
 *     limit%       = overflow / (2 * frame) * 100
 *
 * That is exactly far enough to bring each edge of the image to the matching
 * edge of the frame, and no further — so the whole picture is reachable and
 * empty space is still impossible.
 * ---------------------------------------------------------------------------
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
 * Coerce arbitrary stored data into a structurally valid framing.
 *
 * This deliberately does NOT clamp pan: the valid pan range depends on the
 * image and frame dimensions, which are not known at the storage layer.
 * Clamping happens in clampToLimits() once those are measured.
 */
export function sanitizeFraming(framing) {
  return {
    zoom: clampNumber(framing?.zoom, ZOOM_MIN, ZOOM_MAX, 1),
    x: roundNumber(framing?.x, 0),
    y: roundNumber(framing?.y, 0)
  };
}

/** Normalize a whole framing set, filling in anything missing. */
export function normalizeFramingSet(framing) {
  const out = {};
  for (const key of FRAME_KEYS) out[key] = sanitizeFraming(framing?.[key]);
  return out;
}

/**
 * How far the image may be panned, in percent of the frame, per axis.
 *
 * @param {object} spec
 * @param {number} spec.frameW  frame width in px
 * @param {number} spec.frameH  frame height in px
 * @param {number} spec.imgW    image natural width in px
 * @param {number} spec.imgH    image natural height in px
 * @param {number} spec.zoom
 * @returns {{x:number, y:number}}
 */
export function computePanLimits({ frameW, frameH, imgW, imgH, zoom }) {
  const z = clampNumber(zoom, ZOOM_MIN, ZOOM_MAX, 1);

  // Without real measurements, fall back to the aspect-agnostic estimate.
  if (!(frameW > 0 && frameH > 0 && imgW > 0 && imgH > 0)) {
    const generic = ((z - 1) / 2) * 100;
    return { x: generic, y: generic };
  }

  const coverScale = Math.max(frameW / imgW, frameH / imgH) * z;
  const renderedW = imgW * coverScale;
  const renderedH = imgH * coverScale;

  return {
    x: Math.max(0, ((renderedW - frameW) / (2 * frameW)) * 100),
    y: Math.max(0, ((renderedH - frameH) / (2 * frameH)) * 100)
  };
}

/** Clamp a framing's pan into the given per-axis limits. */
export function clampToLimits(framing, limits) {
  const f = sanitizeFraming(framing);
  const lx = Math.max(0, Number(limits?.x) || 0);
  const ly = Math.max(0, Number(limits?.y) || 0);
  return {
    zoom: f.zoom,
    x: clampNumber(f.x, -lx, lx, 0),
    y: clampNumber(f.y, -ly, ly, 0)
  };
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.round(n * 1000) / 1000;
}

function roundNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(n * 1000) / 1000;
}

/* -------------------------------------------- */
/*  Measurement                                 */
/* -------------------------------------------- */

const sizeCache = new Map();

/**
 * Natural pixel dimensions of an image, cached per src.
 * @param {string} src
 * @returns {Promise<{w:number,h:number}|null>} null if it cannot be loaded
 */
export function getImageSize(src) {
  if (!src) return Promise.resolve(null);
  if (sizeCache.has(src)) return sizeCache.get(src);

  const promise = new Promise(resolve => {
    const probe = new Image();
    probe.onload = () => resolve({ w: probe.naturalWidth, h: probe.naturalHeight });
    probe.onerror = () => resolve(null);
    probe.src = src;
  });

  sizeCache.set(src, promise);
  return promise;
}

/* -------------------------------------------- */
/*  Applying framing                            */
/* -------------------------------------------- */

/**
 * Write a framing onto an element as CSS custom properties.
 * @param {HTMLElement} el
 * @param {object} framing
 * @param {string} prefix  e.g. "sk-b" for banner, "sk-s" for the square crop
 */
export function applyFramingVars(el, framing, prefix) {
  if (!el) return;
  const { zoom, x, y } = sanitizeFraming(framing);
  el.style.setProperty(`--${prefix}z`, String(zoom));
  el.style.setProperty(`--${prefix}x`, `${x}%`);
  el.style.setProperty(`--${prefix}y`, `${y}%`);
}

/**
 * Apply a framing, re-clamping it against the element's real dimensions once
 * the image has been measured.
 *
 * The vars are written twice on purpose: immediately with the stored values so
 * there is no unpositioned flash, then again after measurement. The second pass
 * can only tighten the pan, so in the common case nothing visibly moves.
 *
 * @param {HTMLElement} varTarget  element the CSS variables are written to
 * @param {object} spec
 * @param {string} spec.src        image URL, for natural-size measurement
 * @param {object} spec.framing
 * @param {string} spec.prefix
 * @param {HTMLElement} [spec.frameEl]  the clipping box; defaults to varTarget
 * @returns {Promise<object>} the clamped framing actually applied
 */
export async function applyFramedImage(varTarget, { src, framing, prefix, frameEl }) {
  const initial = sanitizeFraming(framing);
  applyFramingVars(varTarget, initial, prefix);

  const size = await getImageSize(src);
  if (!size) return initial;

  const box = (frameEl ?? varTarget).getBoundingClientRect();
  const limits = computePanLimits({
    frameW: box.width,
    frameH: box.height,
    imgW: size.w,
    imgH: size.h,
    zoom: initial.zoom
  });

  const clamped = clampToLimits(initial, limits);
  applyFramingVars(varTarget, clamped, prefix);
  return clamped;
}

/* -------------------------------------------- */
/*  Interactive editing                         */
/* -------------------------------------------- */

/**
 * Make a framing preview interactive: drag to pan, wheel to zoom.
 *
 * @param {HTMLElement} surface  the clipping box the user drags inside
 * @param {object} initial       starting framing
 * @param {(zoom:number)=>{x:number,y:number}} getLimits  current pan limits
 * @param {(framing:object)=>void} onChange
 * @returns {{destroy:()=>void, set:(f:object)=>void, get:()=>object}}
 */
export function makeFramer(surface, initial, getLimits, onChange) {
  let framing = clampToLimits(initial, getLimits(sanitizeFraming(initial).zoom));
  let dragging = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startFrameX = 0;
  let startFrameY = 0;

  const settle = () => {
    framing = clampToLimits(framing, getLimits(framing.zoom));
    onChange?.(framing);
  };

  /** Can this axis be panned at all right now? Drives the grab cursor. */
  const canPan = () => {
    const limits = getLimits(framing.zoom);
    return limits.x > 0.01 || limits.y > 0.01;
  };

  const onPointerDown = event => {
    if (event.button !== 0) return;
    if (!canPan()) return;
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
    // Pixel drag -> percent of frame, matching the translate units exactly.
    framing.x = startFrameX + ((event.clientX - startX) / rect.width) * 100;
    framing.y = startFrameY + ((event.clientY - startY) / rect.height) * 100;
    settle();
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
    framing.zoom = clampNumber(framing.zoom + direction * (ZOOM_STEP * 2), ZOOM_MIN, ZOOM_MAX, 1);
    settle();
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
      framing = sanitizeFraming(next);
      settle();
    },
    get() {
      return { ...framing };
    },
    canPan
  };
}
