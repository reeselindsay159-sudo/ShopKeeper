/**
 * Per-shop image framing: zoom and pan.
 *
 * A shop stores two independent framings:
 *   - `shop`   the square crop, used by BOTH the shop page portrait and the
 *              thumbnail in the Market row (same picture, same shape)
 *   - `banner` the wide crop, used by themes that bleed art across the whole
 *              row. It may use its own image (`shop.bannerImg`) or fall back to
 *              the shop image.
 *
 * ---------------------------------------------------------------------------
 * HOW THE RENDERING WORKS, AND WHY IT IS NOT THE OBVIOUS THING
 *
 * The obvious approach — leave the image at frame size with `object-fit: cover`
 * and move it with a transform — is broken, and was the cause of "pan up and
 * the top of the image is missing". `cover` crops the image *to the element's
 * box*, and a transform is applied to the result of that crop. So translating
 * does not reveal more picture; it slides the already-cropped strip out of the
 * frame and leaves empty space behind it.
 *
 * Instead, the image element is sized to the FULL cover-rendered dimensions
 * (which are larger than the frame on at least one axis), centred on the frame,
 * and then translated. Now the extra picture genuinely exists inside the
 * element, so translation moves real content into view and the frame's
 * `overflow: hidden` does the cropping.
 *
 * Sizes are expressed as multiples of the frame:
 *
 *     kx = zoom * max(1, imgAspect / frameAspect)   // element width  / frame width
 *     ky = zoom * max(1, frameAspect / imgAspect)   // element height / frame height
 *
 * These depend only on the two aspect ratios, never on pixel size, so they can
 * be written as CSS percentages and survive the window being resized. The
 * element's own aspect always works out to the image's aspect, so nothing is
 * ever stretched.
 *
 * Pan is stored NORMALIZED in [-1, 1]: the fraction of the available slack on
 * that axis. 0 is centred, ±1 brings that edge of the image exactly to the
 * matching edge of the frame. Storing it this way means a crop still means the
 * same thing if the row is a different size on someone else's screen.
 * ---------------------------------------------------------------------------
 */

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 4;
export const ZOOM_STEP = 0.05;

export const FRAME_KEYS = ["shop", "banner"];

/**
 * Storage format version.
 * v1 stored pan as a percentage of the frame, under the broken model above.
 * Those numbers have no meaning in the current model, so v1 data is migrated by
 * keeping the zoom and resetting the pan to centre.
 */
export const FRAMING_VERSION = 2;

/** Fit modes: fill the frame (cropping), or show the whole image (letterboxed). */
export const FIT_FILL = "fill";
export const FIT_CONTAIN = "contain";

/** @returns {object} a fresh identity framing */
export function defaultFraming() {
  return { zoom: 1, x: 0, y: 0, fit: FIT_FILL };
}

/** @returns {object} a fresh framing set, version-stamped */
export function defaultFramingSet() {
  return { v: FRAMING_VERSION, shop: defaultFraming(), banner: defaultFraming() };
}

/** Coerce one framing into range. Pan is normalized, so [-1, 1]. */
export function sanitizeFraming(framing) {
  return {
    zoom: clampNumber(framing?.zoom, ZOOM_MIN, ZOOM_MAX, 1),
    x: clampNumber(framing?.x, -1, 1, 0),
    y: clampNumber(framing?.y, -1, 1, 0),
    fit: framing?.fit === FIT_CONTAIN ? FIT_CONTAIN : FIT_FILL
  };
}

/**
 * Normalize a whole framing set, migrating pre-v2 data.
 * @param {any} set
 * @returns {object}
 */
export function normalizeFramingSet(set) {
  const isCurrent = Number(set?.v) === FRAMING_VERSION;
  const out = { v: FRAMING_VERSION };

  for (const key of FRAME_KEYS) {
    const raw = set?.[key];
    out[key] = isCurrent
      ? sanitizeFraming(raw)
      // Legacy: keep the zoom the GM chose, drop pan units that no longer mean
      // anything rather than reinterpreting them into a wrong crop.
      : { zoom: clampNumber(raw?.zoom, ZOOM_MIN, ZOOM_MAX, 1), x: 0, y: 0, fit: FIT_FILL };
  }

  return out;
}

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.round(n * 10000) / 10000;
}

/* -------------------------------------------- */
/*  Geometry                                    */
/* -------------------------------------------- */

/**
 * Size of the image element relative to its frame, per axis.
 *
 * `fill` (default) covers the frame, so one axis overflows and gets cropped —
 * that overflow is what panning explores. `contain` fits the whole image inside
 * the frame instead, so nothing is ever cropped; one axis then falls short of
 * the frame, which is why contain mode also paints a blurred backdrop rather
 * than leaving bare letterbox bars.
 *
 * @returns {{kx:number, ky:number}} multiples of frame width / height
 */
export function computeScale({ frameAspect, imgAspect, zoom, fit = FIT_FILL }) {
  const z = clampNumber(zoom, ZOOM_MIN, ZOOM_MAX, 1);
  if (!(frameAspect > 0) || !(imgAspect > 0)) return { kx: z, ky: z };

  const ratio = imgAspect / frameAspect;
  if (fit === FIT_CONTAIN) {
    return { kx: z * Math.min(1, ratio), ky: z * Math.min(1, 1 / ratio) };
  }
  return { kx: z * Math.max(1, ratio), ky: z * Math.max(1, 1 / ratio) };
}

/** @deprecated kept as an alias so older call sites keep working */
export const computeCoverScale = computeScale;

/**
 * Maximum pan for one axis, as a percentage of the IMAGE ELEMENT's own size.
 * (translate() percentages resolve against the element, not the frame.)
 *
 * slack = (k - 1) * frame, half of it per side, expressed over the element (k * frame):
 *     ((k - 1) / 2) / k  =  (k - 1) / (2k)
 *
 * @param {number} k
 * @returns {number} percent, 0 when the axis has no slack
 */
export function maxPanPercent(k) {
  return k > 1 ? ((k - 1) / (2 * k)) * 100 : 0;
}

/** Slack on one axis in pixels — used to convert a pixel drag into pan units. */
export function panSlackPx(k, framePx) {
  return k > 1 ? ((k - 1) * framePx) / 2 : 0;
}

/* -------------------------------------------- */
/*  Measurement                                 */
/* -------------------------------------------- */

/** Local copy of the url() escaper so framing.js has no import cycle. */
function cssUrlLocal(path) {
  const safe = String(path).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `url("${safe}")`;
}

const sizeCache = new Map();

/**
 * Natural pixel dimensions of an image, cached per src.
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
 * Write the computed layout onto an element as CSS custom properties.
 *
 * @param {HTMLElement} el
 * @param {object} spec
 * @param {object} spec.framing   normalized framing
 * @param {number} spec.kx
 * @param {number} spec.ky
 * @param {string} spec.prefix    e.g. "sk-b"
 */
export function writeFramingVars(el, { framing, kx, ky, prefix }) {
  if (!el) return;
  const f = sanitizeFraming(framing);
  el.style.setProperty(`--${prefix}w`, `${kx * 100}%`);
  el.style.setProperty(`--${prefix}h`, `${ky * 100}%`);
  el.style.setProperty(`--${prefix}x`, `${f.x * maxPanPercent(kx)}%`);
  el.style.setProperty(`--${prefix}y`, `${f.y * maxPanPercent(ky)}%`);
}

/**
 * Measure, compute and apply framing for one image, and keep it correct if the
 * frame is later resized (which changes the frame's aspect ratio, and therefore
 * the layout).
 *
 * @param {HTMLElement} varTarget  element the CSS variables are written to
 * @param {object} spec
 * @param {string} spec.src
 * @param {object} spec.framing
 * @param {string} spec.prefix
 * @param {HTMLElement} [spec.frameEl]  the clipping box; defaults to varTarget
 * @returns {Promise<{destroy:()=>void}>}
 */
export async function attachFramedImage(varTarget, { src, framing, prefix, frameEl }) {
  const frame = frameEl ?? varTarget;
  // Prefer the real <img> already in the DOM over a separate probe: its
  // naturalWidth is authoritative and costs nothing.
  const domImg = varTarget.querySelector?.("img") ?? null;
  let size = measureImgElement(domImg) ?? (await getImageSize(src));

  const paint = () => {
    const f = sanitizeFraming(framing);
    varTarget.classList.toggle("is-fit", f.fit === FIT_CONTAIN);
    if (src) varTarget.style.setProperty("--sk-src", cssUrlLocal(src));

    size ??= measureImgElement(domImg);

    const rect = frame.getBoundingClientRect();
    const frameAspect = rect.height > 0 && rect.width > 0 ? rect.width / rect.height : 0;
    const imgAspect = size && size.h > 0 && size.w > 0 ? size.w / size.h : 0;

    // If either measurement is unusable — a collapsed <details>, a hidden tab,
    // an image that has not decoded yet — DO NOT write a guessed layout. The
    // old fallback (kx = ky = zoom) silently produced a square element for a
    // wide picture, which object-fit then cropped, leaving part of the image
    // permanently unreachable no matter how far you panned. Clearing the vars
    // instead falls back to the plain CSS default until a real measurement
    // arrives.
    if (!frameAspect || !imgAspect) {
      clearFramingVars(varTarget, prefix);
      return false;
    }

    const { kx, ky } = computeScale({ frameAspect, imgAspect, zoom: f.zoom, fit: f.fit });
    writeFramingVars(varTarget, { framing: f, kx, ky, prefix });
    return true;
  };

  const painted = paint();

  // Retry paths for each way the first measurement can legitimately fail.
  const retry = () => paint();
  if (!painted) requestAnimationFrame(retry);
  if (domImg && !domImg.complete) domImg.addEventListener("load", retry, { once: true });

  let observer = null;
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(retry);
    observer.observe(frame);
    if (frame !== varTarget) observer.observe(varTarget);
  }

  return {
    destroy() {
      observer?.disconnect();
      domImg?.removeEventListener("load", retry);
    }
  };
}

/** @returns {{w:number,h:number}|null} natural size of a loaded <img>, if usable */
export function measureImgElement(img) {
  if (!img) return null;
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  return w > 0 && h > 0 ? { w, h } : null;
}

/** Remove framing vars so the element falls back to its plain CSS default. */
export function clearFramingVars(el, prefix) {
  if (!el) return;
  for (const suffix of ["w", "h", "x", "y"]) {
    el.style.removeProperty(`--${prefix}${suffix}`);
  }
}

/* -------------------------------------------- */
/*  Interactive editing                         */
/* -------------------------------------------- */

/**
 * Make a framing preview interactive: drag to pan, wheel to zoom.
 *
 * @param {HTMLElement} surface   the clipping box the user drags inside
 * @param {object} initial
 * @param {(zoom:number)=>{kx:number, ky:number, frameW:number, frameH:number}} getGeometry
 * @param {(framing:object)=>void} onChange
 */
export function makeFramer(surface, initial, getGeometry, onChange) {
  let framing = sanitizeFraming(initial);
  let dragging = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let startPanX = 0;
  let startPanY = 0;

  const emit = () => {
    framing = sanitizeFraming(framing);
    onChange?.(framing);
  };

  const canPan = () => {
    const g = getGeometry(framing.zoom);
    return panSlackPx(g.kx, g.frameW) > 0.5 || panSlackPx(g.ky, g.frameH) > 0.5;
  };

  const onPointerDown = event => {
    if (event.button !== 0 || !canPan()) return;
    dragging = true;
    pointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    startPanX = framing.x;
    startPanY = framing.y;
    surface.setPointerCapture?.(pointerId);
    surface.classList.add("is-panning");
    event.preventDefault();
  };

  const onPointerMove = event => {
    if (!dragging || event.pointerId !== pointerId) return;
    const g = getGeometry(framing.zoom);
    const slackX = panSlackPx(g.kx, g.frameW);
    const slackY = panSlackPx(g.ky, g.frameH);

    // Convert the pixel drag into normalized pan units. Normalized ±1 equals
    // exactly `slack` pixels of travel (see maxPanPercent), so dividing by the
    // slack makes the image track the cursor 1:1. Dividing by 2*slack — as this
    // did originally — moved the image at half cursor speed and made panning
    // feel broken.
    if (slackX > 0) framing.x = startPanX + (event.clientX - startX) / slackX;
    if (slackY > 0) framing.y = startPanY + (event.clientY - startY) / slackY;

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
    framing.zoom = clampNumber(framing.zoom + direction * (ZOOM_STEP * 2), ZOOM_MIN, ZOOM_MAX, 1);
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
      framing = sanitizeFraming(next);
      emit();
    },
    get() {
      return { ...framing };
    },
    canPan
  };
}
