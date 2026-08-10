// The spend shape beside the headline: one bar, three parts, drawn in device
// pixels (#1512).
//
// IT DERIVES NOTHING. Every figure and every word below is a field of the
// `getSpendShape` record, which reads the canonical headline off
// `getRecoverableSpend` and never recomputes it. This module owns geometry and
// ink, and no arithmetic about money at all.
//
// THE TEXT IS THE CHART; THE CANVAS IS AN ENHANCEMENT. The three values go into
// the DOM first, as a visually-hidden sentence, and the drawing happens after —
// so a browser with no canvas, a `getContext` that returns null, and a reader
// using assistive technology all get the same three numbers. Nothing is encoded
// only in pixels. The canvas is `aria-hidden` for the same reason: it would
// otherwise announce as an empty graphic beside a sentence that already said it.
//
// THREE CARRIERS PER SEGMENT, NEVER ONE. Fill, pattern and in-place label. A
// reader who sees no hue still separates the parts by the hatch and the dots,
// and a reader who sees neither still reads the money on the segment. The fills
// are this page's existing tokens — no new hue is introduced — and each is
// measured against the page background rather than eyeballed:
//
//   defensible recoverable  #315f50 (--import-accent)   6.45:1 on #f3f1eb
//   not recoverable         #6f6f69 (--ink-muted)       4.48:1
//   not yet scored          #614a12 (--state-warn-ink)  7.45:1
//
// all far over the 3:1 a non-text carrier needs, with white labels on them at
// 7.28:1, 5.06:1 and 8.41:1 — over the 4.5:1 body text needs.
//
// DEVICE PIXELS, SNAPPED ONCE. The backing store is cssWidth x dpr by
// cssHeight x dpr, the CSS size is set separately, and the context is scaled
// once. Segment edges are computed as CUMULATIVE device-pixel positions and
// rounded there, so the parts tile the bar exactly: no half-pixel seam between
// two segments, and no rounding drift that would make three widths fail to sum
// to the bar. `devicePixelRatio` is read defensively, because a Node harness and
// a print preview both have none.
//
// THE DRAW SEAM. Drawing is routed through one injected object with four
// methods, so a test can record the ordered primitive calls — device geometry,
// pattern id, label text and position — and compare them against a committed
// log. That is one seam, not an abstraction layer: `canvasDrawTarget` is the
// only implementation the page ships and it is 30 lines of `ctx`.
//
// FRAME COST. There is no animation loop and adding one would be a regression.
// The bar is drawn once per data change and once per resize, and resizes are
// coalesced into a single animation frame, so a drag across a viewport paints
// once per frame at most and does no work at all when the measured width has
// not changed.

/** The three slots this chart occupies. Authored in evolution.html. */
export const SPEND_SHAPE_IDS = Object.freeze({
  region: "finops-spend-shape",
  canvas: "finops-spend-shape-canvas",
  text: "finops-spend-shape-text",
});

/** Fill, pattern and label ink per part. The pattern id is published because it
 *  is a carrier in its own right, and a change that collapsed the three to one
 *  fill would otherwise be invisible to a test. */
export const SPEND_SHAPE_INK = Object.freeze({
  recoverable: Object.freeze({ fill: "#315f50", pattern: "solid", ink: "#ffffff" }),
  notRecoverable: Object.freeze({ fill: "#6f6f69", pattern: "hatch", ink: "#ffffff" }),
  unscored: Object.freeze({ fill: "#614a12", pattern: "dots", ink: "#ffffff" }),
});

export const BAR_HEIGHT = 30;
export const LABEL_SIZE = 12;
export const LABEL_ROW = 17;
export const LABEL_PAD = 7;
/** What a chart with nothing to measure itself against draws at. */
export const FALLBACK_WIDTH = 520;
/** Below this the bar is still drawn; every label simply moves under it. */
export const MIN_WIDTH = 160;

/**
 * Advance width of a label, estimated rather than measured.
 *
 * `measureText` would be more faithful, and it would also make the layout
 * depend on a font that has loaded, which is not true on the first paint and is
 * not true at all in a test. So the labels are drawn in the page's monospace
 * role and estimated at a fixed advance, which is exact for a monospace face and
 * is padded below by `LABEL_PAD` on both sides. The cost is that a label can be
 * moved under the bar when it would in fact have fitted inside it by a few
 * pixels; the benefit is that the same input lays out identically everywhere.
 */
const ADVANCE = 0.62;
export const labelWidth = (text) => Math.ceil(String(text).length * LABEL_SIZE * ADVANCE);

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

/** `devicePixelRatio`, defensively. A ratio of 0, NaN or absent is 1. */
export const deviceRatio = (value = globalThis.devicePixelRatio) =>
  (Number.isFinite(value) && value > 0 ? value : 1);

/**
 * Where every rectangle and every label goes, in DEVICE pixels.
 *
 * Pure: no DOM, no canvas, no clock. The one input that varies at runtime is the
 * measured width, which is why it is an argument rather than something read in
 * here — a narrow viewport is then a value a test passes, not a browser it needs.
 *
 * @param shape a `finops-spend-shape/1.0.0` record.
 * @param width the element's MEASURED css width. Not a constant: the caller
 *   reads it off the element on every draw.
 * @param scale device pixels per css pixel.
 * @returns `{ scale, cssWidth, cssHeight, deviceWidth, deviceHeight, segments }`.
 *   Every segment carries its geometry, its pattern, its label and where the
 *   label went — `inside` when it fits on the segment, `below` when it does not.
 *   A zero-value part still carries all of it and is simply not drawn.
 */
export function spendShapeLayout(shape, { width = FALLBACK_WIDTH, scale = 1 } = {}) {
  const cssWidth = Math.max(Math.round(Number.isFinite(width) && width > 0 ? width : FALLBACK_WIDTH),
    MIN_WIDTH);
  const ratio = deviceRatio(scale);
  const deviceWidth = Math.round(cssWidth * ratio);
  const total = shape?.segments?.reduce((sum, segment) => sum + segment.value, 0) ?? 0;
  const parts = total > 0 ? shape.segments : [];

  // Cumulative edges, rounded in device space. Rounding each WIDTH instead would
  // let three rounded widths miss the bar by a pixel or overlap by one, which is
  // the seam a reader sees as a hairline crack between two fills.
  let running = 0;
  const placed = parts.map((segment) => {
    const from = Math.round(deviceWidth * running / total);
    running += segment.value;
    const to = Math.round(deviceWidth * running / total);
    return { segment, x: from, width: to - from };
  });

  let below = 0;
  const segments = placed.map(({ segment, x, width: deviceSegment }) => {
    const ink = SPEND_SHAPE_INK[segment.key];
    // THE COMPACT LABEL IS A TRADE, AND IT KEEPS THE VALUE. On a phone the full
    // label is wider than the whole bar, and a label wider than the element it
    // sits in is a label that has been drawn off the edge — dropped, in every
    // way that matters. So below that width the money alone is drawn, which is
    // the part a reader cannot reconstruct; the word that names the part is
    // still in the text alternative, unabbreviated, for every reader.
    const full = segment.label;
    const text = Math.round(labelWidth(full) * ratio) > deviceWidth ? segment.display : full;
    const advance = Math.round(labelWidth(text) * ratio);
    const pad = Math.round(LABEL_PAD * ratio);
    const inside = deviceSegment >= advance + pad * 2;
    const row = inside ? -1 : below++;
    return Object.freeze({
      key: segment.key, value: segment.value, pattern: ink.pattern, fill: ink.fill,
      x, width: deviceSegment, y: 0, height: Math.round(BAR_HEIGHT * ratio),
      drawn: deviceSegment > 0,
      label: Object.freeze({
        text, compact: text !== full,
        ink: inside ? ink.ink : "#171713", placement: inside ? "inside" : "below",
        // Baseline, not box top: `fillText` measures from the baseline, and a
        // label positioned by its box would sit a descender low.
        x: inside ? x + pad : clamp(x, 0, Math.max(deviceWidth - advance, 0)),
        y: inside
          ? Math.round((BAR_HEIGHT / 2 + LABEL_SIZE * 0.36) * ratio)
          : Math.round((BAR_HEIGHT + 6 + row * LABEL_ROW + LABEL_SIZE) * ratio),
      }),
    });
  });

  const cssHeight = BAR_HEIGHT + (below > 0 ? 6 + below * LABEL_ROW : 0);
  return Object.freeze({
    scale: ratio, cssWidth, cssHeight, deviceWidth,
    deviceHeight: Math.round(cssHeight * ratio),
    segments: Object.freeze(segments),
  });
}

/**
 * Play a layout at a draw target, in one order, every time.
 *
 * Bar rectangles first and all of them, then labels — so no label is ever
 * painted under the neighbouring segment's fill. A zero-width part contributes
 * no rectangle and still contributes its label, because "$0 not yet scored" is
 * the one fact a bar cannot draw.
 */
export function drawSpendShape(target, layout) {
  if (!target || !layout) return null;
  target.begin({
    deviceWidth: layout.deviceWidth, deviceHeight: layout.deviceHeight, scale: layout.scale,
  });
  for (const segment of layout.segments) {
    if (!segment.drawn) continue;
    target.segment({
      key: segment.key, pattern: segment.pattern, fill: segment.fill,
      x: segment.x, y: segment.y, width: segment.width, height: segment.height,
    });
  }
  for (const segment of layout.segments) {
    target.label({ key: segment.key, ...segment.label });
  }
  target.end();
  return layout;
}

/** Diagonal hatch and dot grid, in css px, inside a clip of the segment. Both
 *  are canvas primitives on purpose: an image asset would be a second file to
 *  serve and would not scale with the ratio. */
function paintPattern(ctx, pattern, x, y, width, height) {
  if (pattern === "solid") return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.globalAlpha = 0.55;
  if (pattern === "hatch") {
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let offset = -height; offset < width + height; offset += 8) {
      ctx.moveTo(x + offset, y + height);
      ctx.lineTo(x + offset + height, y);
    }
    ctx.stroke();
  } else {
    ctx.fillStyle = "#ffffff";
    for (let row = 5; row < height; row += 9) {
      for (let column = 5; column < width; column += 9) {
        ctx.beginPath();
        ctx.arc(x + column, y + row, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

/**
 * The one draw target the page ships: a 2d context, sized in device pixels and
 * scaled once so every coordinate below is css pixels.
 *
 * @returns the target, or null when this browser has no 2d context — which is
 *   the signal the caller uses to leave the text alternative standing alone.
 */
export function canvasDrawTarget(canvas) {
  const ctx = typeof canvas?.getContext === "function" ? canvas.getContext("2d") : null;
  if (!ctx) return null;
  let scale = 1;
  const css = (value) => value / scale;
  return {
    begin(frame) {
      scale = frame.scale;
      // The backing store in device pixels, the box in css pixels, and one
      // scale. Assigning width/height also clears the surface.
      canvas.width = frame.deviceWidth;
      canvas.height = frame.deviceHeight;
      canvas.style.width = `${css(frame.deviceWidth)}px`;
      canvas.style.height = `${css(frame.deviceHeight)}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(scale, scale);
      ctx.font = `700 ${LABEL_SIZE}px ui-monospace,monospace`;
      ctx.textBaseline = "alphabetic";
    },
    segment(op) {
      ctx.fillStyle = op.fill;
      ctx.fillRect(css(op.x), css(op.y), css(op.width), css(op.height));
      paintPattern(ctx, op.pattern, css(op.x), css(op.y), css(op.width), css(op.height));
    },
    label(op) {
      ctx.fillStyle = op.ink;
      ctx.fillText(op.text, css(op.x), css(op.y));
    },
    end() {},
  };
}

/** The element's own width. A layout-free harness reports none, which is what
 *  the fallback is for — never a fixed constant on a browser that can measure. */
function measuredWidth(node) {
  const box = typeof node?.getBoundingClientRect === "function"
    ? node.getBoundingClientRect() : null;
  if (Number.isFinite(box?.width) && box.width > 0) return box.width;
  return Number.isFinite(node?.clientWidth) && node.clientWidth > 0
    ? node.clientWidth : FALLBACK_WIDTH;
}

/**
 * Put the three values in the DOM, then draw them.
 *
 * @param doc the document holding `#finops-spend-shape`.
 * @param shape a `finops-spend-shape/1.0.0` record, or null when the analysis
 *   did not load.
 * @param options.target a draw target, for a test recording the primitive calls.
 * @param options.width a measured css width, for a test driving a narrow one.
 * @param options.scale a device-pixel ratio, defaulting to this browser's.
 * @returns `{ region, layout }` — `layout` is null when nothing was drawn, which
 *   is the state a canvas-less browser is legitimately in.
 */
export function renderSpendShape(doc, shape, options = {}) {
  const region = doc.getElementById(SPEND_SHAPE_IDS.region);
  if (!region) return { region: null, layout: null };

  // TEXT FIRST, ALWAYS. Everything below this point can fail without costing a
  // reader a number.
  const text = doc.getElementById(SPEND_SHAPE_IDS.text);
  if (text) text.textContent = shape?.textAlternative ?? "";
  region.dataset.available = shape?.available ? "true" : "false";
  region.dataset.total = String(shape?.annualSpendUsd ?? 0);
  for (const segment of shape?.segments ?? []) {
    region.dataset[segment.key] = String(segment.value);
  }

  const canvas = doc.getElementById(SPEND_SHAPE_IDS.canvas);
  const target = options.target ?? canvasDrawTarget(canvas);
  if (!target || !shape?.available) {
    region.dataset.drawn = "false";
    return { region, layout: null };
  }
  const layout = spendShapeLayout(shape, {
    width: options.width ?? measuredWidth(region),
    scale: options.scale ?? deviceRatio(),
  });
  drawSpendShape(target, layout);
  region.dataset.drawn = "true";
  region.dataset.width = String(layout.cssWidth);
  return { region, layout };
}

/**
 * Render once and keep the bar honest as the viewport moves.
 *
 * COALESCED, NOT PER EVENT. A resize fires a stream of events; drawing on each
 * one would burn a paint per event for a picture that only changes once per
 * frame. So a redraw is requested at most once per animation frame, and is
 * skipped entirely when the measured width has not moved — a vertical-only
 * resize does no drawing work at all.
 *
 * @returns `{ region, layout, redraw }` — `redraw` is the coalesced entry point,
 *   exported so a test can drive it without a real resize event.
 */
export function mountSpendShape(doc, shape, options = {}) {
  const first = renderSpendShape(doc, shape, options);
  let pending = false;
  let lastWidth = first.layout?.cssWidth ?? null;
  const frame = typeof globalThis.requestAnimationFrame === "function"
    ? globalThis.requestAnimationFrame.bind(globalThis)
    : (callback) => queueMicrotask(callback);

  const redraw = () => {
    if (pending || !first.region) return;
    pending = true;
    frame(() => {
      pending = false;
      const width = options.width ?? measuredWidth(first.region);
      if (Math.round(width) === lastWidth) return;
      lastWidth = renderSpendShape(doc, shape, options).layout?.cssWidth ?? lastWidth;
    });
  };

  globalThis.window?.addEventListener?.("resize", redraw);
  return { ...first, redraw };
}
