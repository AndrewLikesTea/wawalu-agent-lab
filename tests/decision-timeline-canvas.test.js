// The drawing layer of the release-outcome figure.
//
// WHAT THIS HARNESS CAN AND CANNOT SEE. The shared element stub
// (tests/support/dom.js) has no canvas: `document.createElement("canvas")`
// returns the same plain object every other tag returns, with no `getContext` on
// it at all. It also reflects nothing — `canvas.width = 44` stores a JavaScript
// property and `getAttribute("width")` still answers null — and it models no
// layout, so no viewport, no clientWidth, and no media query means anything
// here. Two consequences shape every assertion below:
//
//   1. The default path in this file is the NO-CANVAS path, and it is the one
//      that must be complete. Nothing is asserted about painting unless a 2D
//      context was explicitly stood up for that test.
//   2. The backing-store size is read back with getAttribute, and the view sets
//      it with setAttribute. That is not a workaround for the stub: width and
//      height are content attributes, and a store sized by property assignment
//      alone is a number that never reaches the markup a browser ships.
//
// Painting is observed through a recording context — every call and the fill
// colour in force when it was made — because "it drew once" and "it drew the
// same strip twice" are indistinguishable from any state left behind on a node.
import test from "node:test";
import assert from "node:assert/strict";
import { initDecisionLog } from "../src/app.js";
import { MAX_TIMELINE_STRIPS, stripGeometry, decisionOutcomes } from "../src/decision-timeline.js";
import { TIMELINE_EMPTY_LINE, renderDecisionTimelines } from "../src/decision-timeline-view.js";
import { createHistoryHarness } from "./support/decision-log.js";
import { createElement, installDocument, walk } from "./support/dom.js";

installDocument();

const NOW = Date.parse("2026-06-30T12:00:00.000Z");

const decision = (id, createdAt, status = "accepted", links = []) => ({
  type: "decision", id, title: `Decision ${id}`, status, createdAt, links,
});
const release = (id, createdAt) => ({ type: "release", id, title: id, createdAt });
const shipped = (id, createdAt, releaseId, label) => decision(id, createdAt, "accepted", [
  { type: "release", id: releaseId, label },
]);

// A 2D context that records what it was asked to paint, and the fill in force at
// the moment of the call — the colour is state, so a recorder that logs only the
// rectangle cannot tell a track from a mark.
function recordingCanvas(built) {
  const node = createElement("canvas");
  const calls = [];
  const context = {
    fillStyle: "",
    clearRect: (...args) => calls.push(["clearRect", ...args]),
    fillRect: (...args) => calls.push(["fillRect", context.fillStyle, ...args]),
    beginPath: () => calls.push(["beginPath"]),
    arc: (...args) => calls.push(["arc", context.fillStyle, ...args]),
    fill: () => calls.push(["fill"]),
  };
  node.style = {};
  node.calls = calls;
  node.getContext = (kind) => (kind === "2d" ? context : null);
  built.push(node);
  return node;
}

/**
 * Give this document a canvas for the duration of one call, and hand back every
 * canvas it built. Installed per test rather than globally: the interesting
 * default in this file is a document that has none.
 */
function withCanvas(run) {
  const built = [];
  const create = globalThis.document.createElement;
  globalThis.document.createElement = (tagName) => (
    String(tagName).toLowerCase() === "canvas" ? recordingCanvas(built) : create(tagName)
  );
  try {
    return { result: run(), built };
  } finally {
    globalThis.document.createElement = create;
  }
}

const figures = (node) => walk(node, (candidate) => candidate.getAttribute?.("data-timeline") !== null
  && candidate.getAttribute?.("data-timeline") !== undefined);
const captionOf = (figure) => walk(figure, (candidate) => candidate.tagName === "FIGCAPTION")[0]?.textContent ?? "";
const canvasesIn = (node) => walk(node, (candidate) => candidate.tagName === "CANVAS");

const twelve = [
  release("r1", "2026-06-20T00:00:00.000Z"),
  ...Array.from({ length: 12 }, (unused, index) => shipped(
    `d${String(index + 1).padStart(2, "0")}`,
    `2026-06-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
    "r1",
    "v2.1",
  )),
];

/* ------------------------- the path with no canvas -------------------------- */

test("with no drawing surface the panel is complete text and holds no empty box", () => {
  const node = createElement("div");
  const result = renderDecisionTimelines(node, {
    records: [
      release("r1", "2026-06-12T00:00:00.000Z"),
      shipped("d1", "2026-06-01T00:00:00.000Z", "r1", "v2.1"),
      decision("d2", "2026-06-02T00:00:00.000Z"),
    ],
    now: NOW,
  });

  assert.equal(result.drawn, 0, "nothing can be painted without a context, and nothing pretends it was");
  assert.equal(canvasesIn(node).length, 0, "no canvas is appended, so no blank box takes up space");
  assert.equal(result.figures, 2);
  // The answer is entirely in the captions: both dates, the status, the release,
  // and the span, for every decision.
  assert.deepEqual(figures(node).map(captionOf), [
    "“Decision d2” — recorded Jun 2, 2026, accepted, no release linked yet, open 28 days.",
    "“Decision d1” — recorded Jun 1, 2026, accepted, shipped in v2.1 on Jun 12, 2026, 11 days from recorded to release.",
  ]);
  // The note about the middle mark is not said when there is no mark to explain.
  assert.equal(/midpoint of the span/.test(node.textContent), false);
});

test("a view with no outcome says so rather than rendering an empty panel", () => {
  const node = createElement("div");
  const result = renderDecisionTimelines(node, {
    records: [decision("d1", "2026-06-01T00:00:00.000Z", "proposed")],
    now: NOW,
  });
  assert.equal(result.figures, 0);
  assert.equal(result.total, 0);
  assert.match(node.textContent, new RegExp(TIMELINE_EMPTY_LINE));
});

test("the panel adds no tab stop to the page", () => {
  const node = createElement("div");
  withCanvas(() => renderDecisionTimelines(node, { records: twelve, now: NOW, ratio: 2 }));
  // Taken literally: the criterion is that the existing tab order is unchanged,
  // so this panel contributes no control and no tabindex — not a disclosure, not
  // a link, and not a focusable canvas.
  const focusable = walk(node, (candidate) => ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA", "SUMMARY", "DETAILS"]
    .includes(candidate.tagName) || candidate.getAttribute?.("tabindex") !== null);
  assert.deepEqual(focusable.map((candidate) => candidate.tagName), []);
});

/* --------------------------- the path that paints --------------------------- */

test("the backing store is sized in device pixels and the element in CSS pixels", () => {
  const node = createElement("div");
  const { built } = withCanvas(() => renderDecisionTimelines(node, {
    records: [release("r1", "2026-06-12T00:00:00.000Z"), shipped("d1", "2026-06-01T00:00:00.000Z", "r1", "v2.1")],
    now: NOW,
    ratio: 2,
  }));

  const [canvas] = built;
  // Read back as attributes because that is how they were written, and because
  // a store sized as a property alone never reaches the shipped markup.
  assert.equal(canvas.getAttribute("width"), "640");
  assert.equal(canvas.getAttribute("height"), "56");
  // The element still occupies its 320x28 CSS box: the pair is what makes the
  // strip sharp on a 2x display instead of twice the size.
  assert.deepEqual({ width: canvas.style.width, height: canvas.style.height }, { width: "320px", height: "28px" });
  assert.equal(canvas.getAttribute("role"), "img");
});

test("the accessible name repeats the visible caption exactly", () => {
  const node = createElement("div");
  const { built } = withCanvas(() => renderDecisionTimelines(node, {
    records: [decision("d2", "2026-06-02T00:00:00.000Z")],
    now: NOW,
    ratio: 1,
  }));
  const caption = captionOf(figures(node)[0]);
  assert.equal(built[0].getAttribute("aria-label"), `Timeline: ${caption}`);
  assert.match(caption, /open 28 days\.$/);
});

test("strips are drawn once per render and capped, and a still resize redraws nothing", () => {
  const node = createElement("div");
  const first = withCanvas(() => renderDecisionTimelines(node, { records: twelve, now: NOW, ratio: 2 }));

  // Capped: twelve decisions have an outcome, five strips are drawn, and the
  // summary says which five and how many were left out.
  assert.equal(first.result.total, 12);
  assert.equal(first.result.figures, MAX_TIMELINE_STRIPS);
  assert.equal(first.result.drawn, MAX_TIMELINE_STRIPS);
  assert.equal(first.built.length, MAX_TIMELINE_STRIPS, "one canvas per strip, and no canvas built for a capped-out row");
  assert.match(node.textContent, /Showing the 5 most recently recorded of 12 decisions with a release outcome\./);

  // Once each: a strip that clears twice has been painted twice, and at five
  // strips a redraw storm is the difference between one frame and several.
  for (const canvas of first.built) {
    assert.equal(canvas.calls.filter(([name]) => name === "clearRect").length, 1);
  }

  // A resize that did not move the strip to another display: same records, same
  // ratio. Nothing is repainted, no canvas is built, and the DOM is not touched.
  const still = withCanvas(() => renderDecisionTimelines(node, { records: twelve, now: NOW, ratio: 2 }));
  assert.equal(still.result.redrawn, false);
  assert.equal(still.result.drawn, 0);
  assert.equal(still.built.length, 0, "a still resize does not even build a canvas");
  assert.equal(canvasesIn(node).length, MAX_TIMELINE_STRIPS, "and the strips already on screen are still there");

  // A resize onto a display with a different ratio does repaint, at the new one.
  const moved = withCanvas(() => renderDecisionTimelines(node, { records: twelve, now: NOW, ratio: 1 }));
  assert.equal(moved.result.drawn, MAX_TIMELINE_STRIPS);
  assert.equal(moved.built[0].getAttribute("width"), "320");
});

test("every painted rectangle is inside the store, at the geometry's own coordinates", () => {
  const node = createElement("div");
  const records = [release("r1", "2026-06-12T00:00:00.000Z"), shipped("d1", "2026-06-01T00:00:00.000Z", "r1", "v2.1")];
  const { built } = withCanvas(() => renderDecisionTimelines(node, { records, now: NOW, ratio: 2 }));
  const geometry = stripGeometry(decisionOutcomes(records, { now: NOW }).shown[0], { ratio: 2 });

  const rects = built[0].calls.filter(([name]) => name === "fillRect");
  assert.deepEqual(rects[0].slice(2), [geometry.track.x, geometry.track.y, geometry.track.width, geometry.track.height]);
  for (const [, , x, y, width, height] of rects) {
    assert.ok(x >= 0 && y >= 0, `a rectangle starts off the store at ${x},${y}`);
    assert.ok(x + width <= geometry.deviceWidth, `a rectangle runs past the right edge at ${x + width}`);
    assert.ok(y + height <= geometry.deviceHeight, `a rectangle runs past the bottom edge at ${y + height}`);
  }
});

test("an open strip is told from a shipped one by shape, not by colour alone", () => {
  const node = createElement("div");
  const { built } = withCanvas(() => renderDecisionTimelines(node, {
    records: [
      release("r1", "2026-06-12T00:00:00.000Z"),
      decision("open", "2026-06-02T00:00:00.000Z"),
      shipped("done", "2026-06-01T00:00:00.000Z", "r1", "v2.1"),
    ],
    now: NOW,
    ratio: 1,
  }));

  assert.deepEqual(figures(node).map((figure) => figure.getAttribute("data-timeline")), ["open", "shipped"]);
  const [openStrip, shippedStrip] = built;
  const rectsOf = (canvas) => canvas.calls.filter(([name]) => name === "fillRect");
  // The shipped strip: a full-width rule and an end cap. The open one: a rule
  // that stops halfway, no end cap, and three dashes carrying on past it. The
  // difference survives with every fill set to the same colour.
  assert.deepEqual(rectsOf(shippedStrip).map(([, , x, , width]) => [x, width]), [[10, 300], [10, 2], [308, 2]]);
  assert.deepEqual(rectsOf(openStrip).map(([, , x, , width]) => [x, width]),
    [[10, 150], [163, 4], [170, 4], [177, 4], [10, 2]]);
  // Both carry exactly one status dot, drawn as a circle rather than a bar.
  for (const canvas of built) assert.equal(canvas.calls.filter(([name]) => name === "arc").length, 1);
});

test("the one prioritized next action sits above the strips and names the longest wait", () => {
  const node = createElement("div");
  renderDecisionTimelines(node, {
    records: [
      release("r1", "2026-06-20T00:00:00.000Z"),
      decision("recent", "2026-06-25T00:00:00.000Z"),
      decision("oldest", "2026-06-02T00:00:00.000Z"),
      shipped("done", "2026-06-01T00:00:00.000Z", "r1", "v2.1"),
    ],
    now: NOW,
  });

  const action = walk(node, (candidate) => candidate.getAttribute?.("data-timeline-action") !== null
    && candidate.getAttribute?.("data-timeline-action") !== undefined);
  assert.equal(action.length, 1, "one action, not one per open decision");
  assert.equal(action[0].getAttribute("data-timeline-action"), "oldest");
  assert.match(action[0].textContent, /^Settle “Decision oldest” — accepted, recorded Jun 2, 2026, and open 28 days,/);
  // Above the strips, and above the summary line that counts them.
  assert.equal(node.children[0], action[0]);
});

/* ------------------------------- the wiring -------------------------------- */

const demo = {
  decisions: [
    { id: "queue", title: "Adopt a durable queue", context: "Retries", owner: "Kai", status: "approved", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "cache", title: "Approve edge cache", context: "Latency", owner: "Mina", status: "accepted", createdAt: "2026-03-01T00:00:00.000Z" },
  ],
  releases: [
    { id: "r-1-3-0", version: "v1.3.0", title: "Throughput", status: "completed", owner: "Kai", createdAt: "2026-04-01T00:00:00.000Z", decisionIds: ["queue"] },
  ],
};

test("the history view draws the panel from the same filtered set as the list", async () => {
  const harness = createHistoryHarness(demo);
  await initDecisionLog(harness.root, harness.storage, { announceDelay: 0, seed: demo });
  const panel = harness.elements["#history-timelines"];

  // The shipped decision's span is read off the release it links to, and the
  // legacy "approved" status is read as "accepted" here as it is everywhere.
  assert.match(panel.textContent, /“Adopt a durable queue” — recorded Jan 1, 2026, accepted, shipped in v1\.3\.0 on Apr 1, 2026, 90 days from recorded to release\./);
  // The accepted decision no release carries is open, and it is the callout.
  assert.match(panel.textContent, /Settle “Approve edge cache” — accepted, recorded Mar 1, 2026, and open \d+ days/);

  // Filtering to the release hides the unshipped decision from the list, and the
  // panel follows the same selection rather than keeping its own.
  harness.chooseRelease("r-1-3-0");
  assert.equal(/Approve edge cache/.test(panel.textContent), false);
  // The release row itself is filtered away too, and the span it dated survives.
  assert.match(panel.textContent, /shipped in v1\.3\.0 on Apr 1, 2026, 90 days from recorded to release\./);
});

test("the page carries the panel between the trend and the list", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
  assert.match(page, /<div id="history-timelines"><\/div>/);
  assert.ok(page.indexOf('id="history-trend"') < page.indexOf('id="history-timelines"'));
  assert.ok(page.indexOf('id="history-timelines"') < page.indexOf('id="decision-list"'));
});
