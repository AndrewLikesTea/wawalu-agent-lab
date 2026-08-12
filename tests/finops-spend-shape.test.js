// The spend shape beside the headline recoverable figure (#1512).
//
// WHAT THESE ASSERTIONS ARE FOR. A chart is the easiest place on a page for a
// number to quietly stop being the number. It has its own arithmetic, its own
// copy, and a rendering path no assertion normally reaches — so a stale figure
// in a bar survives every test that guards the text beside it.
//
//   1. CANONICAL AGREEMENT. The three parts are the canonical figures, and the
//      module renders what it is FED rather than a figure of its own: a
//      deliberately wrong record renders wrong, which is what makes the positive
//      case worth anything.
//   2. THE TEXT ALTERNATIVE, WITHOUT A CANVAS. `getContext` returning null is
//      the accessibility guarantee, so it is asserted with drawing removed
//      entirely.
//   3. THREE CARRIERS. Each part records a distinct pattern and a distinct
//      label, so a change that collapsed the encoding to colour alone fails.
//   4. NARROW VIEWPORTS. The layout is recomputed from a MEASURED width, and no
//      label is dropped or laid on top of another one at 200 css px.
//   5. THE GOLDEN DRAW LOG. This harness cannot rasterise, so the ordered
//      primitive calls — device geometry, pattern ids, label text and positions
//      — are compared against tests/fixtures/finops-spend-shape-draw-log.json.
//      It is the deterministic stand-in for a golden pixel comparison.
//   6. DEVICE PIXELS. The backing store is css x dpr, the css box is set
//      separately, and the context is scaled exactly once.
//   7. THE PAGE. The served bytes and the render state the same three figures,
//      and a reload restores them from the canonical record rather than from
//      anything the previous visit drew.
//
// No clock, no network, no sleeps.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import { loadExampleDataset } from "../src/example-dataset.js";
import { getRecoverableSpend, getSpendShape } from "../src/finops-answer-contract.js";
import {
  BAR_HEIGHT, SPEND_SHAPE_IDS, SPEND_SHAPE_INK, canvasDrawTarget, drawSpendShape, labelWidth,
  mountSpendShape, renderSpendShape, spendShapeLayout,
} from "../src/finops-spend-shape-view.js";

const GOLDEN = JSON.parse(await readFile(
  new URL("./fixtures/finops-spend-shape-draw-log.json", import.meta.url), "utf8"));

// #1667 CUT THIS CHART OFF THE AI FINOPS FIRST SCREEN. It stated three annual
// totals between a monthly headline and the move that headline implies, which is
// three answers to the page's one question. The MODULE is unchanged and still
// held to every rule below — the canonical figures, the text alternative, the
// geometry, the golden draw log — against a host fragment built here rather than
// against /evolution.html, so this file no longer asserts a surface the product
// deliberately no longer has. Mounting it on another surface needs this markup
// and nothing else.
const SOURCE = `<!doctype html><html><body>
  <div class="spend-shape" id="finops-spend-shape" data-available="true" data-drawn="false">
    <canvas class="spend-shape-canvas" id="finops-spend-shape-canvas" width="520" height="30" aria-hidden="true"></canvas>
    <p class="visually-hidden" id="finops-spend-shape-text"></p>
  </div>
</body></html>`;

const DATASET = loadExampleDataset();
const RECORD = getRecoverableSpend(DATASET);
const SHAPE = getSpendShape(DATASET, RECORD);

/** A draw target that records instead of painting. One object, four methods —
 *  the same seam the page's canvas target implements. */
function recordingTarget() {
  const log = [];
  return {
    log,
    begin: (frame) => log.push({ op: "begin", ...frame }),
    segment: (op) => log.push({ op: "segment", ...op }),
    label: (op) => log.push({ op: "label", ...op }),
    end: () => log.push({ op: "end" }),
  };
}

const region = (document) => document.getElementById(SPEND_SHAPE_IDS.region);
const part = (shape, key) => shape.segments.find((segment) => segment.key === key);

// ---------------------------------------------------------------------------
// 1. Canonical agreement, and the negative case that gives it meaning.
// ---------------------------------------------------------------------------

test("the three parts are the canonical figures and add up to the annual spend", () => {
  assert.equal(SHAPE.available, true);
  assert.equal(part(SHAPE, "recoverable").value, RECORD.annualised,
    "the recoverable part must BE the canonical headline, annualised — not a second derivation");
  assert.equal(SHAPE.annualSpendUsd, DATASET.spendUsd * 12,
    "the bar is the export's own analyzed total, annualised by the same x12");
  assert.equal(SHAPE.segments.reduce((sum, segment) => sum + segment.value, 0),
    SHAPE.annualSpendUsd, "the three parts must sum to the bar exactly");
  assert.equal(part(SHAPE, "unscored").value, 0,
    "every department in the bundled dataset carries a completed score");
  assert.equal(part(SHAPE, "recoverable").display, RECORD.annualisedDisplay,
    "one currency formatter, shared with the headline record");
});

test("the chart records the values it was fed, not a figure of its own", () => {
  const document = parseHtml(SOURCE);
  renderSpendShape(document, SHAPE);
  assert.equal(region(document).dataset.recoverable, String(RECORD.annualised));
  assert.equal(region(document).dataset.total, String(SHAPE.annualSpendUsd));
  assert.equal(region(document).dataset.unscored, "0");

  // THE NEGATIVE CASE. Fed a deliberately stale record, the chart must render
  // the stale figure — a module that quietly reached for the canonical headline
  // instead would pass the assertion above while drawing a number nobody chose.
  const stale = parseHtml(SOURCE);
  renderSpendShape(stale, {
    ...SHAPE,
    annualSpendUsd: 999_999,
    segments: SHAPE.segments.map((segment) => ({ ...segment, value: 111_111 })),
    textAlternative: "a deliberately stale sentence",
  });
  assert.equal(region(stale).dataset.recoverable, "111111");
  assert.equal(region(stale).dataset.total, "999999");
  assert.notEqual(region(stale).dataset.recoverable, String(RECORD.annualised));
  assert.equal(textOf(stale.getElementById(SPEND_SHAPE_IDS.text)), "a deliberately stale sentence");
});

test("a dataset with an unscored department moves spend into the unscored part", () => {
  const rows = DATASET.rankedDepartments.map((row, index) =>
    (index === 1 ? { ...row, scored: false } : row));
  const shape = getSpendShape({ ...DATASET, rankedDepartments: rows });
  assert.equal(part(shape, "unscored").value, 24_500 * 12,
    "an unscored department's annualised spend is the part the headline makes no claim about");
  assert.equal(shape.segments.reduce((sum, segment) => sum + segment.value, 0),
    shape.annualSpendUsd, "the three parts still sum to the bar");
});

test("a total smaller than the parts withholds the shape rather than clamping it", () => {
  const shape = getSpendShape({ ...DATASET, spendUsd: 100 });
  assert.equal(shape.available, false);
  assert.equal(shape.segments.length, 0);
  assert.match(shape.textAlternative, /No spend shape is drawn/);
});

// ---------------------------------------------------------------------------
// 2. The text alternative, with drawing removed.
// ---------------------------------------------------------------------------

test("with getContext returning null the three values are still in the DOM", () => {
  const document = parseHtml(SOURCE);
  const canvas = document.getElementById(SPEND_SHAPE_IDS.canvas);
  let asked = 0;
  canvas.getContext = () => { asked += 1; return null; };

  const result = renderSpendShape(document, SHAPE);
  assert.equal(asked, 1, "the canvas was asked for a context and answered null");
  assert.equal(result.layout, null, "nothing was drawn");
  assert.equal(region(document).dataset.drawn, "false");

  const sentence = textOf(document.getElementById(SPEND_SHAPE_IDS.text));
  for (const segment of SHAPE.segments) {
    assert.ok(sentence.includes(segment.display),
      `${segment.key} (${segment.display}) is missing from the text alternative`);
  }
  assert.ok(sentence.includes(SHAPE.annualSpendDisplay),
    "the current annual spend is missing from the text alternative");
});

test("the canvas is hidden from assistive technology and adds no tab stop", () => {
  const document = parseHtml(SOURCE);
  const canvas = document.getElementById(SPEND_SHAPE_IDS.canvas);
  assert.equal(canvas.getAttribute("aria-hidden"), "true",
    "the sentence carries the values; an empty graphic beside it would say them twice");
  assert.equal(canvas.hasAttribute("tabindex"), false,
    "this screen has no spare tab stop, and a chart with a text alternative needs none");
  assert.equal(document.getElementById(SPEND_SHAPE_IDS.text).classList.contains("visually-hidden"),
    true);
});

// ---------------------------------------------------------------------------
// 3. Three carriers, not one.
// ---------------------------------------------------------------------------

test("each part carries a distinct fill, a distinct pattern and a distinct label", () => {
  const layout = spendShapeLayout(SHAPE, { width: 900, scale: 1 });
  assert.equal(layout.segments.length, 3);
  for (const channel of ["fill", "pattern"]) {
    const values = layout.segments.map((segment) => segment[channel]);
    assert.equal(new Set(values).size, 3,
      `two parts share a ${channel}, so the encoding has collapsed to fewer than three carriers`);
  }
  const labels = layout.segments.map((segment) => segment.label.text);
  assert.equal(new Set(labels).size, 3);
  for (const segment of layout.segments) {
    assert.ok(SHAPE.segments.some((canonical) => canonical.label === segment.label.text),
      "a label must be the canonical one, money first");
    assert.equal(segment.pattern, SPEND_SHAPE_INK[segment.key].pattern);
  }
  assert.ok(labels.some((label) => label.startsWith("$0")),
    "a zero part still states its money rather than disappearing with its segment");
});

// ---------------------------------------------------------------------------
// 4. Narrow viewports.
// ---------------------------------------------------------------------------

test("at 200 css px every label survives and none overlaps another", () => {
  const layout = spendShapeLayout(SHAPE, { width: 200, scale: 1 });
  assert.equal(layout.cssWidth, 200, "the layout is computed from the measured width");
  assert.equal(layout.deviceWidth, 200);
  assert.equal(layout.segments.length, 3, "no part is dropped when there is no room for it");

  const rows = new Map();
  for (const segment of layout.segments) {
    const { label } = segment;
    assert.ok(label.text.length > 0);
    assert.ok(label.x >= 0, `${segment.key} label starts off the left edge`);
    assert.ok(label.x + labelWidth(label.text) <= layout.deviceWidth + 1,
      `${segment.key} label runs off the right edge`);
    if (label.placement === "inside") {
      assert.ok(label.x >= segment.x
        && label.x + labelWidth(label.text) <= segment.x + segment.width,
      `${segment.key} label claims to be inside a segment it does not fit in`);
      continue;
    }
    assert.equal(rows.has(label.y), false,
      `two labels share the row at y=${label.y}, so they overlap`);
    rows.set(label.y, segment.key);
  }
  assert.ok(layout.cssHeight > BAR_HEIGHT,
    "labels pushed under the bar must grow the element rather than paint outside it");

  // A label wider than the whole bar falls back to the money alone. The value
  // survives the trade; the word that names the part is still spoken, because
  // the text alternative is never abbreviated.
  const compact = layout.segments.filter((segment) => segment.label.compact);
  assert.ok(compact.length > 0, "at 200px at least one label cannot fit in full");
  for (const segment of compact) {
    assert.equal(segment.label.text, part(SHAPE, segment.key).display);
    assert.ok(SHAPE.textAlternative.includes(part(SHAPE, segment.key).label),
      "the unabbreviated label must still be in the text alternative");
  }
  assert.equal(spendShapeLayout(SHAPE, { width: 900, scale: 1 })
    .segments.some((segment) => segment.label.compact), false,
  "nothing is abbreviated when there is room for the whole label");
});

test("the bar tiles exactly at every width — no seam, no drift", () => {
  for (const width of [160, 200, 333, 520, 981]) {
    for (const scale of [1, 2, 3]) {
      const layout = spendShapeLayout(SHAPE, { width, scale });
      let edge = 0;
      for (const segment of layout.segments) {
        assert.equal(segment.x, edge, `a gap or an overlap at ${width}px @${scale}x`);
        edge += segment.width;
      }
      assert.equal(edge, layout.deviceWidth,
        `the parts do not fill the bar at ${width}px @${scale}x`);
    }
  }
});

test("a width below the floor still lays out rather than collapsing", () => {
  const layout = spendShapeLayout(SHAPE, { width: 20, scale: 1 });
  assert.equal(layout.cssWidth, 160);
  assert.equal(layout.segments.length, 3);
});

// ---------------------------------------------------------------------------
// 5. The golden draw log.
// ---------------------------------------------------------------------------

test("the ordered primitive calls match the committed golden log", () => {
  const target = recordingTarget();
  drawSpendShape(target, spendShapeLayout(SHAPE, {
    width: GOLDEN.input.cssWidth, scale: GOLDEN.input.scale,
  }));
  assert.deepEqual(target.log, GOLDEN.log);
});

test("rectangles are drawn before labels, so no label is painted over", () => {
  const target = recordingTarget();
  drawSpendShape(target, spendShapeLayout(SHAPE, { width: 900, scale: 2 }));
  const kinds = target.log.map((entry) => entry.op);
  assert.equal(kinds[0], "begin");
  assert.equal(kinds.at(-1), "end");
  assert.ok(kinds.lastIndexOf("segment") < kinds.indexOf("label"));
  assert.equal(kinds.filter((kind) => kind === "label").length, 3,
    "every part contributes a label, including the one with no rectangle");
  assert.equal(kinds.filter((kind) => kind === "segment").length, 2,
    "the zero part contributes no rectangle");
});

// ---------------------------------------------------------------------------
// 6. Device pixels.
// ---------------------------------------------------------------------------

/** A 2d context that records the calls a crispness bug shows up in. */
function recordingContext() {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  return {
    calls,
    set fillStyle(value) { calls.push(["fillStyle", value]); },
    set strokeStyle(value) { calls.push(["strokeStyle", value]); },
    set lineWidth(value) { calls.push(["lineWidth", value]); },
    set globalAlpha(value) { calls.push(["globalAlpha", value]); },
    set font(value) { calls.push(["font", value]); },
    set textBaseline(value) { calls.push(["textBaseline", value]); },
    scale: record("scale"), setTransform: record("setTransform"), fillRect: record("fillRect"),
    fillText: record("fillText"), save: record("save"), restore: record("restore"),
    beginPath: record("beginPath"), rect: record("rect"), clip: record("clip"),
    moveTo: record("moveTo"), lineTo: record("lineTo"), stroke: record("stroke"),
    arc: record("arc"), fill: record("fill"),
  };
}

test("the backing store is device pixels, the box is css pixels, and scale is applied once", () => {
  const document = parseHtml(SOURCE);
  const canvas = document.getElementById(SPEND_SHAPE_IDS.canvas);
  const ctx = recordingContext();
  canvas.getContext = () => ctx;

  const { layout } = renderSpendShape(document, SHAPE, { width: 520, scale: 2 });
  assert.equal(layout.scale, 2);
  assert.equal(canvas.width, 1040, "the backing store must be css width x dpr");
  assert.equal(canvas.height, 140);
  assert.equal(canvas.style.width, "520px", "the css box is set separately from the backing store");
  assert.equal(canvas.style.height, "70px");

  const scales = ctx.calls.filter(([name]) => name === "scale");
  assert.deepEqual(scales, [["scale", 2, 2]], "the context is scaled exactly once");

  // Every rectangle reaches the scaled context in css pixels — the device
  // geometry divided by the ratio — which is what makes a snapped device edge
  // land on a whole device pixel instead of half of one.
  const rects = ctx.calls.filter(([name]) => name === "fillRect");
  assert.deepEqual(rects[0], ["fillRect", 0, 0, 172.5, 30]);
  assert.equal(region(document).dataset.drawn, "true");
});

test("a missing devicePixelRatio is 1, never 0 or NaN", () => {
  for (const scale of [undefined, 0, Number.NaN, -2]) {
    assert.equal(spendShapeLayout(SHAPE, { width: 300, scale }).scale, 1);
  }
  assert.equal(spendShapeLayout(SHAPE, { width: 300, scale: 1.5 }).scale, 1.5);
});

test("the patterns are canvas primitives, not an image asset", () => {
  const canvas = { style: {}, getContext: () => ctx };
  const ctx = recordingContext();
  const target = canvasDrawTarget(canvas);
  drawSpendShape(target, spendShapeLayout(SHAPE, { width: 900, scale: 1 }));
  const names = new Set(ctx.calls.map(([name]) => name));
  assert.ok(names.has("stroke"), "the hatch is stroked lines");
  assert.ok(names.has("clip"), "a pattern is clipped to its own segment");
  assert.equal(names.has("drawImage"), false, "no image asset is involved");
  assert.equal(canvasDrawTarget({ getContext: () => null }), null,
    "a browser with no 2d context yields no target, which leaves the text standing alone");
  assert.equal(canvasDrawTarget(null), null);
});

test("a coalesced redraw does no work when the measured width has not moved", async () => {
  const document = parseHtml(SOURCE);
  const canvas = document.getElementById(SPEND_SHAPE_IDS.canvas);
  let contexts = 0;
  canvas.getContext = () => { contexts += 1; return recordingContext(); };

  const mounted = mountSpendShape(document, SHAPE, { width: 520, scale: 2 });
  assert.equal(contexts, 1, "one draw on mount");
  mounted.redraw();
  mounted.redraw();
  mounted.redraw();
  await new Promise((resolve) => { queueMicrotask(resolve); });
  await new Promise((resolve) => { queueMicrotask(resolve); });
  assert.equal(contexts, 1,
    "three resize events at an unchanged width must coalesce into no drawing at all");
});

// ---------------------------------------------------------------------------
// 7. The AI FinOps page, which no longer mounts this.
// ---------------------------------------------------------------------------

test("the AI FinOps first screen carries no spend shape at all (#1667)", async () => {
  const page = await readFile(
    new URL("../src/evolution.html", import.meta.url), "utf8");
  const document = parseHtml(page);
  for (const id of Object.values(SPEND_SHAPE_IDS)) {
    assert.equal(document.querySelectorAll(`#${id}`).length, 0,
      `${id} is still on the first screen`);
  }
  // Two renders of the same record from the same accessor, so the text
  // alternative is still pinned to the canonical headline wherever it is used.
  const painted = parseHtml(SOURCE);
  renderSpendShape(painted, SHAPE);
  assert.equal(region(painted).dataset.recoverable, String(RECORD.annualised));
  assert.equal(textOf(painted.getElementById(SPEND_SHAPE_IDS.text)), SHAPE.textAlternative);
});
