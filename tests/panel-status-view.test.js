// The shared status treatment for executive panels.
//
// Every assertion here is on something a reader can perceive, in one of the four
// channels the treatment ships in: the word, the glyph, the chip silhouette, and
// the tone. The tone is never asserted alone, because a page that only passes in
// colour is the page this block exists to replace.
//
// The second half drives the real evolution.html with the real entry module, so
// a treatment that reads correctly in isolation and wrecks the page's tab order
// still fails.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, parseHtml, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  PANEL_STATUS, PROVENANCE_LIMITS, applyPanelStatus, applyPanelStatuses,
  panelProvenance, panelStatusPresentation,
} from "../src/panel-status-view.js";
import { EXECUTIVE_PANELS, PANEL_FACTS, panelStates } from "../src/finops-panel-contract.js";
import { applyPanelContract, panelStatusFor } from "../src/finops-panel-contract-view.js";

const STATUSES = Object.values(PANEL_STATUS);

const panelDoc = (inner = "") => parseHtml(
  `<section id="demo-panel"><p class="eyebrow">Decision 1</p><h2>Which team?</h2>`
  + `<div id="demo-figure">42</div>${inner}</section>`);

const block = (document) => document.getElementById("demo-panel-status");
const chipOf = (document) => document.querySelector(".panel-status-chip");

// ---------------------------------------------------------------------------
// The vocabulary.
// ---------------------------------------------------------------------------

test("every status is distinguishable without colour: a distinct word and a distinct glyph", () => {
  const words = new Set();
  const shapes = new Set();
  for (const status of STATUSES) {
    const presentation = panelStatusPresentation(status);
    assert.equal(presentation.status, status);
    assert.ok(presentation.word.length > 2, `${status} needs a word a reader can read`);
    assert.equal(words.has(presentation.word), false, `${presentation.word} labels two states`);
    assert.equal(shapes.has(presentation.shape), false, `${presentation.shape} marks two states`);
    words.add(presentation.word);
    shapes.add(presentation.shape);
  }
  assert.equal(words.size, STATUSES.length);
  assert.equal(shapes.size, STATUSES.length);
});

test("the chip silhouette follows the foundations rule: fill signals, outline classifies", () => {
  // design-system/claude-design/review-08-foundations.html — "filled wash =
  // dynamic signal, outline = static classification".
  const filled = ["loading", "partial", "error"];
  const outline = ["computed", "unavailable", "empty"];
  for (const status of filled) {
    assert.equal(panelStatusPresentation(status).silhouette, "filled",
      `${status} moves while the reader watches or acts, so it is a signal`);
  }
  for (const status of outline) {
    assert.equal(panelStatusPresentation(status).silhouette, "outline",
      `${status} classifies this panel against this import, so it is not a signal`);
  }
});

test("an unavailable panel is never drawn in the error tone, and only error alerts", () => {
  for (const status of ["unavailable", "empty", "loading"]) {
    const presentation = panelStatusPresentation(status);
    assert.notEqual(presentation.tone, "error",
      `${status} means "waiting", and a reader who reads "broken" stops trusting the panels beside it`);
    assert.notEqual(presentation.role, "alert",
      `${status} must not interrupt a screen-reader user who has done nothing wrong`);
  }
  assert.equal(panelStatusPresentation("error").tone, "error");
  assert.equal(panelStatusPresentation("error").role, "alert");
  assert.equal(panelStatusPresentation("unavailable").role, "note");
  assert.equal(panelStatusPresentation("loading").role, "status");
});

test("the unavailable word describes the missing file, not a broken product", () => {
  const word = panelStatusPresentation("unavailable").word;
  assert.match(word, /awaiting|pending|needs/i);
  assert.doesNotMatch(word, /unavailable|error|failed|broken|no data/i);
});

test("an unknown status falls back to waiting rather than to failure", () => {
  assert.equal(panelStatusPresentation("wat").status, PANEL_STATUS.unavailable);
  assert.equal(panelStatusPresentation(undefined).status, PANEL_STATUS.unavailable);
});

// ---------------------------------------------------------------------------
// Provenance, and the extremes it refuses to print as fact.
// ---------------------------------------------------------------------------

test("provenance surfaces count, period, coverage, and confidence, each under its own label", () => {
  const provenance = panelProvenance({
    records: 12480, unit: "row", period: "2026-05-01 – 2026-05-31",
    coverage: 0.82, confidence: "medium", detail: "Joined against the roster you imported.",
  });
  assert.deepEqual(provenance.facts.map((fact) => fact.key),
    ["records", "period", "coverage", "confidence"]);
  assert.equal(provenance.facts[0].value, "12,480 rows");
  assert.equal(provenance.facts[2].value, "82% of dollars attributed");
  assert.equal(provenance.facts[3].value, "Medium");
  assert.equal(provenance.implausible, false);
  assert.equal(provenance.caveats.length, 0);
  assert.equal(provenance.detail, "Joined against the roster you imported.");
});

test("a single record is not pluralised, and a panel that knows one fact shows one fact", () => {
  assert.equal(panelProvenance({ records: 1, unit: "classified prompt" }).facts[0].value,
    "1 classified prompt");
  const sparse = panelProvenance({ records: 9 });
  assert.equal(sparse.facts.length, 1, "a blank in a provenance row reads as a zero");
});

test("a coverage outside [0,1] is clamped, marked, and caveated rather than printed", () => {
  const provenance = panelProvenance({ coverage: 1.37 });
  const coverage = provenance.facts.find((fact) => fact.key === "coverage");
  assert.equal(coverage.value, "100% of dollars attributed");
  assert.equal(coverage.implausible, true);
  assert.equal(provenance.implausible, true);
  assert.match(provenance.caveats[0], /137%/);
  assert.match(provenance.caveats[0], /should not be quoted/);
});

test("a negative record count is withheld; an impossible one is shown and disowned", () => {
  const negative = panelProvenance({ records: -4, unit: "row" });
  assert.equal(negative.facts.length, 0, "a negative count is not a count");
  assert.match(negative.caveats[0], /negative/);

  const huge = panelProvenance({ records: PROVENANCE_LIMITS.maxRecords + 1, unit: "row" });
  assert.equal(huge.facts[0].implausible, true);
  assert.match(huge.caveats[0], /unverified/);
});

test("an impossible period is flagged against the date column that produced it", () => {
  const provenance = panelProvenance({ period: "1970 – 2026", periodDays: 20_400 });
  assert.equal(provenance.facts[0].implausible, true);
  assert.match(provenance.caveats[0], /date column mapping/);
  assert.equal(panelProvenance({ period: "2026-05", periodDays: 31 }).implausible, false);
});

test("an unrecognised confidence reads as unstated rather than as a blank", () => {
  assert.equal(panelProvenance({ confidence: "vibes" }).facts[0].value, "Unstated");
  assert.equal(panelProvenance({ confidence: "HIGH" }).facts[0].value, "High");
  assert.equal(panelProvenance({}).facts.length, 0);
});

// ---------------------------------------------------------------------------
// Painting one panel.
// ---------------------------------------------------------------------------

test("the block is read after the heading and before the figure it qualifies", () => {
  const document = panelDoc();
  applyPanelStatus(document, { panelId: "demo-panel", status: PANEL_STATUS.computed });
  const panel = document.getElementById("demo-panel");
  const order = panel.childElements.map((node) => node.id || node.tagName);
  assert.deepEqual(order, ["P", "H2", "demo-panel-status", "demo-figure"]);
});

test("the chip ships a word and an aria-hidden glyph, so it is never read twice", () => {
  const document = panelDoc();
  applyPanelStatus(document, { panelId: "demo-panel", status: PANEL_STATUS.unavailable });
  const chip = chipOf(document);
  assert.equal(chip.dataset.silhouette, "outline");
  assert.equal(document.querySelector(".panel-status-shape").getAttribute("aria-hidden"), "true");
  assert.equal(textOf(document.querySelector(".panel-status-word")), "Awaiting input");
});

test("only a loading panel is busy, and only an error panel alerts", () => {
  const document = panelDoc();
  const panel = document.getElementById("demo-panel");

  applyPanelStatus(document, { panelId: "demo-panel", status: PANEL_STATUS.loading });
  assert.equal(panel.getAttribute("aria-busy"), "true");
  assert.equal(document.querySelector(".panel-status-line").getAttribute("role"), "status");

  applyPanelStatus(document, { panelId: "demo-panel", status: PANEL_STATUS.unavailable });
  assert.equal(panel.getAttribute("aria-busy"), null,
    "an unanswerable panel is finished, not working; a reader must not wait for it");
  assert.equal(document.querySelector(".panel-status-line").getAttribute("role"), "note");

  applyPanelStatus(document, { panelId: "demo-panel", status: PANEL_STATUS.error });
  assert.equal(document.querySelector(".panel-status-line").getAttribute("role"), "alert");
  assert.equal(panel.dataset.panelStatus, "error");
});

test("secondary detail is disclosed, and the disclosure is the last thing in the block", () => {
  const document = panelDoc();
  applyPanelStatus(document, {
    panelId: "demo-panel",
    status: PANEL_STATUS.computed,
    provenance: panelProvenance({ records: 12, unit: "row", detail: "Summed over the imported rows." }),
  });
  const children = block(document).childElements;
  assert.equal(children.at(-1).tagName, "DETAILS");
  assert.equal(textOf(children.at(-1).querySelector("summary")), "How this panel was derived");
  assert.match(textOf(children.at(-1).querySelector("p")), /Summed over the imported rows/);
});

test("a caveat is printed above the disclosure, never behind a control nobody presses", () => {
  const document = panelDoc();
  applyPanelStatus(document, {
    panelId: "demo-panel",
    status: PANEL_STATUS.partial,
    provenance: panelProvenance({ coverage: 4, detail: "How the join ran." }),
  });
  const children = block(document).childElements;
  const caveat = children.findIndex((node) => node.className === "panel-status-caveat");
  const disclosure = children.findIndex((node) => node.tagName === "DETAILS");
  assert.ok(caveat >= 0 && caveat < disclosure, "a figure that must not be quoted cannot be hidden");
  assert.equal(block(document).dataset.implausible, "true");
  // The mark is in the value's own text as well as in the rule beneath it.
  const coverage = document.querySelector('[data-fact="coverage"]');
  assert.match(textOf(coverage.querySelector("dd")), /check this/);
});

test("a repaint reuses the block rather than replacing it, so focus and tab order hold", () => {
  const document = panelDoc();
  const first = applyPanelStatus(document, { panelId: "demo-panel", status: PANEL_STATUS.loading });
  const second = applyPanelStatus(document, { panelId: "demo-panel", status: PANEL_STATUS.computed });
  assert.equal(first, second, "the block was replaced, which drops a reader's focus");
  assert.equal(document.querySelectorAll(".panel-status").length, 1);
});

test("exactly one waiting panel is handed the page's next action", () => {
  const document = parseHtml(
    "<section id=\"a\"><div id=\"af\"></div></section><section id=\"b\"><div id=\"bf\"></div></section>"
    + "<section id=\"c\"><div id=\"cf\"></div></section>");
  applyPanelStatuses(document, [
    { panelId: "a", status: PANEL_STATUS.computed, action: { text: "Nothing to do." } },
    { panelId: "b", status: PANEL_STATUS.unavailable, action: { text: "Add a query sample." } },
    { panelId: "c", status: PANEL_STATUS.unavailable, action: { text: "Add a roster." } },
  ]);
  const priorities = document.querySelectorAll(".panel-status-next")
    .map((node) => node.dataset.priority);
  assert.deepEqual(priorities, ["secondary", "primary", "secondary"]);
  assert.match(textOf(document.querySelector('[data-priority="primary"]')), /Start here/);
});

// ---------------------------------------------------------------------------
// The contract's two-valued answer, read in six states.
// ---------------------------------------------------------------------------

test("an available panel is computed, partly attributed, or empty — read off provenance", () => {
  const available = { available: true };
  assert.equal(panelStatusFor(available), PANEL_STATUS.computed);
  assert.equal(panelStatusFor(available, { records: 0 }), PANEL_STATUS.empty);
  assert.equal(panelStatusFor(available, { coverage: 0.4 }), PANEL_STATUS.partial);
  assert.equal(panelStatusFor(available, { coverage: 1 }), PANEL_STATUS.computed);
  assert.equal(panelStatusFor({ available: false }), PANEL_STATUS.unavailable);
  // A panel that is mid-read or that threw says so ahead of anything else.
  assert.equal(panelStatusFor(available, { status: "loading" }), PANEL_STATUS.loading);
  assert.equal(panelStatusFor({ available: false }, { status: "error" }), PANEL_STATUS.error);
});

// ---------------------------------------------------------------------------
// The real page.
// ---------------------------------------------------------------------------

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

async function openFinopsTab() {
  const page = await loadPage(PAGE, {
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  return page;
}

/**
 * Open one workspace destination by its own door.
 *
 * #1328: /evolution.html is a workspace and shows ONE destination at a time. A
 * closed destination's regions carry `hidden`, so they are out of the
 * accessibility tree and out of the tab order — which a `display:none` rule
 * already did in a browser and this harness could not see. A test that measures
 * the keyboard path through a panel has to stand in the destination that panel
 * belongs to first, exactly as a reader does.
 */
function openDestination(document, key) {
  document.getElementById("finops-workspace-nav-list")
    .querySelector(`[data-destination-key="${key}"]`).click();
}

test("every declared panel on the shipped page carries a state a reader can see", async () => {
  const { document } = await openFinopsTab();
  for (const panel of EXECUTIVE_PANELS) {
    const status = document.getElementById(`${panel.elementId}-status`);
    assert.ok(status, `${panel.id} has no status block`);
    assert.ok(STATUSES.includes(status.dataset.status), `${panel.id} invented a state`);
    // The panel's own question is the summary, so a reader scanning only the
    // chips still meets every question the page claims to answer.
    assert.ok(textOf(status).includes(panel.question),
      `${panel.id} dropped its question from the at-a-glance line`);
  }
});

test("painting an answerable page adds no tab stop and moves none of its controls", async () => {
  const { document } = await openFinopsTab();
  const path = (nodes) => nodes.map((node) => node.id || node.tagName);
  const before = path(tabSequence(document));
  // Every panel answerable, so nothing is hidden and the only difference the
  // keyboard could see is the treatment itself. It sees none: the block holds a
  // chip, a definition list, and — only when a panel publishes secondary detail
  // — a native `details`, and none of them carries a tabindex.
  const answered = Object.fromEntries(Object.keys(PANEL_FACTS).map((fact) => [fact, 1000]));
  applyPanelContract(document, panelStates(answered));
  assert.deepEqual(path(tabSequence(document)), before,
    "the status treatment changed the keyboard path through the page");
});

test("an unanswerable panel's controls leave together, and the survivors keep their order", async () => {
  const { document } = await openFinopsTab();
  // The savings portfolio and its filters belong to Act and verify, so both
  // readings are taken standing in that destination.
  openDestination(document, "act-and-verify");
  const before = tabSequence(document);
  applyPanelContract(document, panelStates({}));
  const after = tabSequence(document);
  // Hiding an unanswerable panel's figures is the contract's own behaviour, and
  // it does take that panel's controls out of the tab sequence — a filter over a
  // list that is not on screen is a dead end. What must not happen is a
  // reordering: everything still reachable is reachable in the same order, so a
  // reader's muscle memory for this page survives an import.
  // Compared over the SURVIVORS in both directions. #1328 hides a closed
  // destination's regions, and a contract repaint may legitimately bring one of
  // its panels back; an arrival is not a reordering, and the property this test
  // exists for is that nothing still reachable moved past anything else.
  assert.deepEqual(after.filter((node) => before.includes(node)),
    before.filter((node) => after.includes(node)));
  assert.ok(after.length < before.length, "an unanswerable portfolio still offered its filters");
});

test("with nothing imported, one panel says start here and the rest wait quietly", async () => {
  const { document } = await openFinopsTab();
  applyPanelContract(document, panelStates({}));
  const primary = document.querySelectorAll("[data-next-action=\"primary\"]");
  assert.equal(primary.length, 1, "two 'start here' labels mean a reader starts at neither");
  assert.equal(primary[0].id, EXECUTIVE_PANELS[0].elementId,
    "priority is contract order: the first unanswered question is the one to answer");
  assert.match(textOf(document.getElementById("hero-grade-unavailable")), /Start here/);
  // No other unanswerable panel repeats the ranking.
  assert.equal(document.querySelectorAll(".panel-unavailable-priority").length, 1);
});

test("a failed bundled fetch draws every panel as failed, not as awaiting a file", async () => {
  const page = await loadPage(PAGE, {
    // The one fixture the executive panels are drawn from never arrives.
    routes: { "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES },
  });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  await waitFor(() => document.getElementById("finops-load-state")?.dataset.state === "error",
    "the load state to give up");

  for (const panel of EXECUTIVE_PANELS) {
    const status = document.getElementById(`${panel.elementId}-status`);
    assert.ok(status, `${panel.id} has no status block after a failed load`);
    assert.equal(status.dataset.status, PANEL_STATUS.error,
      `${panel.id} told the reader to go and find a file that would not fix a failed fetch`);
  }
  // One announcement, not nine: the page's load-state region owns the retry and
  // the interruption. Every panel block is read in place.
  assert.equal(document.querySelectorAll(".panel-status-line")
    .filter((node) => node.getAttribute("role") === "alert").length, 0);
});

test("a panel's provenance rides along with the contract without the contract owning it", async () => {
  const { document } = await openFinopsTab();
  applyPanelContract(document, panelStates({}), {
    provenance: {
      "spend-and-recovery": {
        records: 4210, unit: "row", period: "2026-05", coverage: 0.63, confidence: "low",
        detail: "Summed over cost.amount_minor on the rows that carried one.",
      },
    },
  });
  const status = document.getElementById("kpi-row-status");
  const said = textOf(status);
  assert.match(said, /4,210 rows/);
  assert.match(said, /2026-05/);
  assert.match(said, /63% of dollars attributed/);
  assert.match(said, /Low/);
  // The contract still says unavailable; provenance did not overrule it.
  assert.equal(document.getElementById("kpi-row").dataset.panelState, "unavailable");
  assert.equal(status.dataset.status, PANEL_STATUS.unavailable);
});
