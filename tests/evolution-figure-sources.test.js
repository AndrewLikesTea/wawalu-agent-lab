// Which figures in the bundled example brief were read, derived, or are absent
// from the example's export files (#1025).
//
// These tests assert rendered structure and declared values, never a screenshot,
// and they are deliberately careful about one harness property: `textOf` reads
// THROUGH a shut `details`, so text presence alone proves nothing about what a
// reader can see. Every visibility claim below is made on an attribute — `open`,
// `data-disclosure`, `aria-expanded`, `hidden` — and the text assertions only
// prove the working exists once the structure has said it is collapsed.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, parseHtml, textOf } from "./support/browser.js";
import { FIGURE_SOURCE, PROVENANCE_MARKERS } from "../src/finops-brief-provenance.js";
import {
  applyExampleFigureSources, bindExampleFigureSources, EXAMPLE_FIGURE_SOURCES,
  EXAMPLE_ONLY_SOURCE_IDS, EXAMPLE_SOURCE, EXAMPLE_SOURCE_MARKERS,
  exampleFigureSource, exampleFiguresInState, FIGURE_SOURCE_DISCLOSURE,
  FIGURE_SOURCE_LEGEND, FIGURE_SOURCE_TERMS, figureSourceText,
} from "../src/finops-example-figure-sources.js";
import { applyFirstRunResult, applyFirstRunSupersession } from "../src/finops-first-run-view.js";
import { buildFirstRunResult } from "../src/finops-first-run.js";
import { scoreBriefCompleteness } from "../src/finops-brief-completeness.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const CSS = new URL("../src/evolution.css", import.meta.url);

const html = await readFile(PAGE, "utf8");
const css = await readFile(CSS, "utf8");

/** Every element in the tree, in document order. The harness rejects descendant
 *  selectors, so subtree questions are answered by walking. */
function walk(node, found = []) {
  for (const child of node.children ?? []) {
    if (child.nodeType === 1) {
      found.push(child);
      walk(child, found);
    }
  }
  return found;
}

const withClass = (root, name) =>
  walk(root).filter((node) => node.classList?.contains?.(name));

/** Walk up to the nearest ancestor carrying `id`. `parentNode`, never "details #id". */
function ancestorWithId(node, id) {
  for (let held = node?.parentNode; held; held = held.parentNode) {
    if (held.id === id) return held;
  }
  return null;
}

// --- the vocabulary ---------------------------------------------------------

test("three states, and the two marked ones reuse the shipped chip silhouettes", () => {
  assert.deepEqual(Object.keys(EXAMPLE_SOURCE), ["direct", "derived", "missing"]);

  const derived = EXAMPLE_SOURCE_MARKERS[EXAMPLE_SOURCE.derived];
  const missing = EXAMPLE_SOURCE_MARKERS[EXAMPLE_SOURCE.missing];
  const direct = EXAMPLE_SOURCE_MARKERS[EXAMPLE_SOURCE.direct];

  // No new silhouette and no new tone: both are values `.brief-provenance`
  // already ships for the imported brief. A drift here is a new token entering
  // the page through the side door.
  const shipped = new Set(Object.values(PROVENANCE_MARKERS)
    .map((marker) => `${marker.silhouette}/${marker.tone}`));
  assert.ok(shipped.has(`${derived.silhouette}/${derived.tone}`));
  assert.ok(shipped.has(`${missing.silhouette}/${missing.tone}`));

  // And the filled wash stays reserved for the reader's own file.
  assert.equal(PROVENANCE_MARKERS[FIGURE_SOURCE.file].silhouette, "filled");
  assert.notEqual(derived.silhouette, "filled");
  assert.notEqual(missing.silhouette, "filled");

  // The words are the whole meaning on their own — the three are distinguishable
  // with the silhouette, the tint, and every mark stripped away.
  const labels = [direct.label, derived.label, missing.label];
  assert.equal(new Set(labels).size, 3);
  for (const label of labels) assert.ok(label.length > 0);

  // Direct is a first-class member of the vocabulary that draws no chip.
  assert.equal(direct.marked, false);
  assert.equal(derived.marked, true);
  assert.equal(missing.marked, true);

  // An unknown state reads as the absence, never as a reading.
  assert.equal(exampleFigureSource("no-such-figure"), null);
});

test("every published figure in the region declares a state, and both marked states are used", () => {
  assert.equal(EXAMPLE_FIGURE_SOURCES.length, 8);
  assert.equal(new Set(EXAMPLE_FIGURE_SOURCES.map((entry) => entry.host)).size, 8);
  assert.ok(exampleFiguresInState(EXAMPLE_SOURCE.derived).length >= 1);
  assert.equal(exampleFiguresInState(EXAMPLE_SOURCE.missing).length, 1);

  for (const entry of EXAMPLE_FIGURE_SOURCES) {
    assert.ok(entry.qualifies.length > 0, `${entry.id} has no figure label`);
    assert.ok(entry.value.length > 0, `${entry.id} has no figure value`);
    // Where it came from, and what it moves. Never one without the other, and
    // the decision line is not allowed to be a restatement of the figure.
    assert.ok(entry.origin.length > 40, `${entry.id} has no derivation`);
    assert.ok(entry.decision.length > 40, `${entry.id} says nothing about what it moves`);
    assert.notEqual(entry.origin, entry.decision);
  }
});

test("the accessible name states which figure, what it says, and which state it is in", () => {
  const role = exampleFigureSource("role");
  const spoken = figureSourceText(role);
  assert.match(spoken, /Accountable role for the recommended action/);
  assert.match(spoken, /Platform Engineering Lead/);
  assert.match(spoken, /Not in these files/);
  assert.match(spoken, new RegExp(FIGURE_SOURCE_DISCLOSURE.collapsed));
  assert.match(figureSourceText(role, { expanded: true }),
    new RegExp(FIGURE_SOURCE_DISCLOSURE.expanded));
});

// --- the authored page ------------------------------------------------------

test("the marker and its working are authored on the page, shut, before any script runs", () => {
  const document = parseHtml(html);

  for (const entry of EXAMPLE_FIGURE_SOURCES) {
    const host = document.getElementById(entry.host);
    assert.ok(host, `${entry.id} has no authored marker`);
    assert.equal(host.tagName.toLowerCase(), "details",
      `${entry.id}'s marker is not a native disclosure, so it is not keyboard-operable`);
    // COLLAPSED IS THE DEFAULT. `textOf` would happily report the working here
    // whether or not a browser draws it, so the claim is made on the attributes.
    assert.notEqual(host.open, true, `${entry.id} ships open`);
    assert.equal(host.dataset.disclosure, "collapsed");
    assert.equal(host.dataset.source, entry.source);

    const summary = document.getElementById(`${entry.host}-summary`);
    assert.ok(summary, `${entry.id} has no summary`);
    assert.equal(summary.tagName.toLowerCase(), "summary");
    assert.equal(summary.getAttribute("aria-expanded"), "false");
    assert.equal(summary.getAttribute("aria-controls"), `${entry.host}-detail`);
    // The summary IS the control. A button inside it would take Enter and Space
    // off the browser and move the focus ring.
    assert.equal(walk(summary).filter((node) =>
      ["button", "a", "input"].includes(node.tagName.toLowerCase())).length, 0);

    // The accessible name names the figure and its value, then the state.
    const spoken = textOf(summary);
    assert.ok(spoken.includes(entry.qualifies),
      `${entry.id}'s marker does not say which figure it belongs to`);
    assert.ok(spoken.includes(entry.value),
      `${entry.id}'s marker does not say what that figure says`);
    assert.ok(spoken.includes(EXAMPLE_SOURCE_MARKERS[entry.source].label),
      `${entry.id}'s marker does not say which state it is in`);

    // The working, both terms, in order.
    const list = document.getElementById(`${entry.host}-detail`);
    assert.ok(list, `${entry.id} discloses nothing`);
    assert.deepEqual(walk(list).filter((node) => node.tagName.toLowerCase() === "dt")
      .map((node) => textOf(node)),
    [FIGURE_SOURCE_TERMS.origin, FIGURE_SOURCE_TERMS.decision]);
    const disclosed = textOf(list);
    assert.ok(disclosed.includes(entry.origin), `${entry.id} does not disclose its derivation`);
    assert.ok(disclosed.includes(entry.decision), `${entry.id} does not say what it moves`);
  }
});

test("one derived figure and one missing figure, each with its working, on the page", () => {
  const document = parseHtml(html);

  // DERIVED: the headline share. Its working names the operands and the rule.
  const derived = document.getElementById("finops-first-run-answer-source");
  assert.equal(derived.dataset.source, EXAMPLE_SOURCE.derived);
  const derivedChip = withClass(derived, "brief-provenance")[0];
  assert.equal(derivedChip.dataset.silhouette, "outline");
  assert.equal(textOf(withClass(derived, "brief-provenance-label")[0]), "Derived here");
  assert.match(textOf(document.getElementById("finops-first-run-answer-source-detail")),
    /\$51,254 of recoverable spend over \$154,500/);

  // MISSING: the accountable role. Its working names the columns that are absent.
  const missing = document.getElementById("finops-first-run-role-source");
  assert.equal(missing.dataset.source, EXAMPLE_SOURCE.missing);
  const missingChip = withClass(missing, "brief-provenance")[0];
  assert.equal(missingChip.dataset.silhouette, "dashed");
  assert.equal(textOf(withClass(missing, "brief-provenance-label")[0]), "Not in these files");
  assert.match(textOf(document.getElementById("finops-first-run-role-source-detail")),
    /no owner, team-lead, or cost-centre column/);

  // The two marked states are told apart with every mark and every tint removed:
  // different words, and different silhouettes on the chip.
  assert.notEqual(derivedChip.dataset.silhouette, missingChip.dataset.silhouette);
});

test("the marker sits with the figure it qualifies, in reading order, inside the example region", () => {
  const document = parseHtml(html);
  const region = document.getElementById("finops-first-run");

  for (const entry of EXAMPLE_FIGURE_SOURCES) {
    const host = document.getElementById(entry.host);
    assert.ok(ancestorWithId(host, "finops-first-run"),
      `${entry.id}'s marker is outside the example region`);
  }

  // No positive tabindex anywhere in the region: the focus order is the document
  // order, which is what keeps a marker from being reached before its number.
  for (const node of walk(region)) {
    const index = Number(node.getAttribute("tabindex"));
    assert.ok(!(index > 0), `${node.id || node.tagName} takes a positive tabindex`);
  }

  // In document order, every marker follows the figure it belongs to.
  const order = walk(region).map((node) => node.id).filter(Boolean);
  const after = (marker, figure) => assert.ok(order.indexOf(marker) > order.indexOf(figure),
    `${marker} is reachable before ${figure}`);
  after("finops-first-run-answer-source", "finops-first-run-answer");
  after("finops-first-run-benchmark-source", "finops-first-run-benchmark-value");
  after("finops-first-run-role-source", "finops-first-run-role");
  after("finops-first-run-confidence-source", "finops-first-run-confidence-value");
  // And the legend is above the first marked figure below it rather than at the
  // very top: the answer keeps the first screen.
  assert.ok(order.indexOf("finops-first-run-source-legend") > order.indexOf("finops-first-run-answer"));
  assert.ok(order.indexOf("finops-first-run-source-legend")
    < order.indexOf("finops-first-run-benchmark-value"));
});

test("the legend makes an unmarked figure a claim rather than a gap", () => {
  const document = parseHtml(html);
  const legend = document.getElementById("finops-first-run-source-legend");
  assert.equal(textOf(legend), FIGURE_SOURCE_LEGEND);
  // It names what is unmarked. "Unmarked means direct" with nothing after it
  // leaves a reader guessing which words on screen that covers.
  assert.match(FIGURE_SOURCE_LEGEND, /unmarked/i);
  assert.match(FIGURE_SOURCE_LEGEND, /read straight out of the example's export files/);
  assert.match(FIGURE_SOURCE_LEGEND, /department names/);
});

// --- the painted page -------------------------------------------------------

test("the module repaints the authored markers into the same words, still shut", async () => {
  const page = await loadPage(PAGE);
  try {
    const { document } = page;
    const painted = applyExampleFigureSources(document);
    assert.equal(painted.length, EXAMPLE_FIGURE_SOURCES.length);
    for (const entry of EXAMPLE_FIGURE_SOURCES) {
      const host = document.getElementById(entry.host);
      assert.notEqual(host.open, true, `repainting opened ${entry.id}`);
      assert.equal(host.dataset.disclosure, "collapsed");
      assert.equal(host.dataset.source, entry.source);
      const summary = document.getElementById(`${entry.host}-summary`);
      assert.equal(summary.getAttribute("aria-expanded"), "false");
      const spoken = textOf(summary);
      assert.ok(spoken.includes(entry.qualifies) && spoken.includes(entry.value));
      assert.ok(textOf(document.getElementById(`${entry.host}-detail`)).includes(entry.origin));
    }
    // Repainting twice leaves one marker, not two. Counted before and after
    // rather than against the table's own length: the region also carries the
    // estimated-position marker from #1102, which is not one of these figures
    // and is painted by its own module.
    const region = document.getElementById("finops-first-run");
    const before = withClass(region, "figure-source-summary").length;
    assert.ok(before >= EXAMPLE_FIGURE_SOURCES.length);
    applyExampleFigureSources(document);
    assert.equal(withClass(region, "figure-source-summary").length, before);
  } finally {
    page.restore();
  }
});

test("opening a marker moves its exposed state and its visible word, and nothing else", async () => {
  const page = await loadPage(PAGE);
  try {
    const { document } = page;
    bindExampleFigureSources(document);
    const host = document.getElementById("finops-first-run-role-source");
    const summary = document.getElementById("finops-first-run-role-source-summary");

    assert.equal(host.dataset.disclosure, "collapsed");
    assert.match(textOf(host.querySelector(".figure-source-state")),
      new RegExp(FIGURE_SOURCE_DISCLOSURE.collapsed));

    host.open = true;
    host.dispatchEvent({ type: "toggle" });
    assert.equal(host.dataset.disclosure, "expanded");
    assert.equal(summary.getAttribute("aria-expanded"), "true");
    assert.match(textOf(host.querySelector(".figure-source-state")),
      new RegExp(FIGURE_SOURCE_DISCLOSURE.expanded));

    host.open = false;
    host.dispatchEvent({ type: "toggle" });
    assert.equal(host.dataset.disclosure, "collapsed");
    assert.equal(summary.getAttribute("aria-expanded"), "false");
  } finally {
    page.restore();
  }
});

test("the whole example result paints its markers, and an import withholds the ones that only speak for it", async () => {
  const page = await loadPage(PAGE);
  try {
    const { document } = page;
    applyFirstRunResult(document, buildFirstRunResult());
    for (const entry of EXAMPLE_FIGURE_SOURCES) {
      assert.equal(document.getElementById(entry.host)?.dataset.source, entry.source);
    }

    // The headline is repainted with the reader's own drill-down, so a marker
    // left visible beside it would describe the example's derivation over
    // somebody else's number.
    applyFirstRunSupersession(document, true, {
      ownData: {
        available: true, grouping: { id: "department" }, headline: "Your own top unit",
        detail: "From your export.", rows: [],
      },
    });
    for (const id of EXAMPLE_ONLY_SOURCE_IDS) {
      assert.equal(document.getElementById(id)?.hidden, true,
        `${id} survives an import that replaced the figure it describes`);
    }
  } finally {
    page.restore();
  }
});

// --- reconciliation ---------------------------------------------------------

test("the example's figure states change nothing on the reader's own completeness surface", () => {
  // ONE VALUE, ONE STATUS, STATED ONCE. `#finops-brief-completeness` scores the
  // slots a DROPPED EXPORT did or did not satisfy; every figure in this table is
  // a bundled-example figure. So no figure appears in both, and the count the
  // completeness surface publishes is untouched by anything here.
  const empty = scoreBriefCompleteness(null);
  const slots = new Set(empty.slots.map((slot) => slot.id));
  for (const entry of EXAMPLE_FIGURE_SOURCES) {
    assert.ok(!slots.has(entry.id),
      `${entry.id} is stated by both the example markers and the completeness score`);
  }

  // And the one figure marked absent here names its own resolution in its own
  // working, rather than adding a row to a panel somewhere else on the page.
  const document = parseHtml(html);
  const missing = exampleFiguresInState(EXAMPLE_SOURCE.missing)[0];
  assert.match(textOf(document.getElementById(`${missing.host}-detail`)),
    /Check this role against your own org chart/);
});

// --- the stylesheet ---------------------------------------------------------

test("the marker is focusable with the page's own ring and composes only shipped tokens", () => {
  const rule = (selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const found = css.match(new RegExp(`(?:^|[,}])\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
    assert.ok(found, `no rule for ${selector}`);
    return found[1];
  };

  // The site's existing focus treatment, not a new one.
  assert.match(rule(".figure-source>summary:focus-visible"),
    /outline:3px solid var\(--focus-ring\)/);

  // Every colour the marker draws is a declared token. A literal hex here is a
  // new value entering the page.
  for (const selector of [".figure-source>summary:hover", ".figure-source-state",
    ".figure-source-detail", ".figure-source-detail dt", ".figure-source-detail dd",
    ".figure-source-legend", '.figure-source[data-source="missing"] .figure-source-detail']) {
    const body = rule(selector);
    assert.ok(!/#[0-9a-f]{3,8}\b/i.test(body),
      `${selector} declares a literal colour instead of a token: ${body}`);
  }

  // Caption scale, so the marker never competes with the figure above it.
  for (const size of [rule(".figure-source-state"), rule(".figure-source-detail dd")]) {
    const found = /font(?:-size)?:[^;]*?(\d+(?:\.\d+)?)px/.exec(size);
    assert.ok(found && Number(found[1]) <= 12.5, `a marker is set at ${found?.[1]}px`);
  }
});
