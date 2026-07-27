// Reading-experience regression for the per-model overspend finding.
//
// Every assertion drives the shipped markup — src/evolution.html parsed by the
// same harness the import-flow suite uses — and the real contract payload, so
// what is pinned is what a leader can actually do: read one answer without
// opening anything, open the rows only when they want them, see those rows add
// up to the number above them, rename an opaque org unit once and have it stick
// everywhere, and be told in words when a number is withheld rather than shown a
// fabricated zero.
//
// The degraded and unavailable payloads are built by the contract's own builder
// from rows authored here, not hand-written to match the view: a fixture the
// test wrote to please the renderer proves nothing.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHtml, pressEnter, pressKey, pressSpace, tabSequence, textOf } from "./support/browser.js";
import { buildModelOverspendFinding } from "../src/model-overspend-finding.js";
import { ORG_UNIT_LABEL_STORAGE_KEY, writeOrgUnitLabel } from "../src/org-unit-labels.js";
import {
  clearModelOverspendFinding, renderModelOverspendFinding,
} from "../src/model-overspend-finding-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const FIXTURE = new URL("../src/model-overspend-finding-fixture.json", import.meta.url);

const money = (minor) => `${(Math.round(minor) / 100).toFixed(2)} USD`;

async function page() {
  return parseHtml(await readFile(PAGE, "utf8"));
}

async function okFinding() {
  return JSON.parse(await readFile(FIXTURE, "utf8")).finding;
}

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => { values.set(key, String(value)); },
    removeItem: (key) => { values.delete(key); },
    values,
  };
}

/** Mount the panel the way the page mounts it. */
async function mount(finding, store = storage()) {
  const doc = await page();
  // The results section is authored hidden and revealed once an analysis is on
  // screen; the panel lives inside it, so a tab-order assertion is only honest
  // with the surrounding stage in the state the page puts it in.
  doc.getElementById("local-results").hidden = false;
  renderModelOverspendFinding(doc, finding, { storage: store });
  return { doc, store };
}

const toggle = (doc) => doc.getElementById("model-overspend-evidence-toggle");
const panel = (doc) => doc.getElementById("model-overspend-evidence-panel");
const rows = (doc) => doc.querySelectorAll(".model-overspend-row");

function open(doc) {
  toggle(doc).focus();
  pressEnter(doc);
  return panel(doc);
}

// --- the rows the degraded shapes are built from ----------------------------

const ROW = Object.freeze({
  period: "2026-06",
  segmentId: "seg-atlas",
  segmentLabel: "Atlas Platform",
  model: "syn-large-1",
  requests: 40000,
  spendMinor: 800000,
  observedDays: 30,
  daysInPeriod: 30,
  rowCount: 30,
});
const COLUMNS = Object.freeze({
  period: "Usage month", segment: "Workspace", model: "Model",
  requests: "Requests", spend: "Cost (USD)",
});
const row = (over) => ({ ...ROW, ...over });

function noRequestCounts() {
  return buildModelOverspendFinding({
    columns: { ...COLUMNS, requests: null },
    rows: [row({ requests: null }), row({ model: "syn-small-1", requests: null, spendMinor: 300000 })],
  });
}

function unavailable() {
  return buildModelOverspendFinding({
    columns: COLUMNS,
    rows: [row({}), row({ segmentId: "seg-borealis", segmentLabel: "Borealis Research", requests: 12000, spendMinor: 360000 })],
  });
}

function unrecognizedModels() {
  return buildModelOverspendFinding({
    columns: COLUMNS,
    rows: [row({ model: "unknown" }),
      row({ model: "n/a", segmentId: "seg-borealis", segmentLabel: "Borealis Research" })],
  });
}

// --- A. headline first ------------------------------------------------------

test("the first screen is the question, the number, and the action — the rows are closed", async () => {
  const { doc } = await mount(await okFinding());
  const section = doc.getElementById("model-overspend");
  assert.equal(section.hidden, false);
  assert.match(textOf(doc.getElementById("model-overspend-question")), /^In 2026-06, where am I paying/);
  assert.match(textOf(doc.querySelectorAll(".model-overspend-headline")[0]), /Atlas Platform spent 8000\.00 USD/);
  assert.equal(textOf(doc.querySelectorAll(".model-overspend-metric-value")[0]), "6030.77 USD");
  assert.match(textOf(doc.querySelectorAll(".model-overspend-action-text")[0]), /^Route Atlas Platform's/);

  assert.equal(toggle(doc).getAttribute("aria-expanded"), "false");
  assert.equal(toggle(doc).getAttribute("aria-controls"), "model-overspend-evidence-panel");
  assert.equal(panel(doc).hidden, true);
  // Not merely hidden: the per-model rows are not in the document at all until
  // a reader asks for them.
  assert.equal(doc.querySelectorAll(".model-overspend-table").length, 0);
  assert.equal(rows(doc).length, 0);
});

test("the disclosure opens and closes from the keyboard and never drops focus", async () => {
  const { doc } = await mount(await okFinding());
  const control = toggle(doc);
  control.focus();
  assert.equal(doc.activeElement, control);
  pressEnter(doc);
  assert.equal(toggle(doc).getAttribute("aria-expanded"), "true");
  assert.equal(panel(doc).hidden, false);
  // The panel was repainted; focus is back on the control that owns it, not
  // dropped to the top of the document.
  assert.equal(doc.activeElement, toggle(doc));
  assert.match(textOf(toggle(doc)), /^Hide the per-model evidence \(4 rows\)/);

  toggle(doc).focus();
  pressSpace(doc);
  assert.equal(toggle(doc).getAttribute("aria-expanded"), "false");
  assert.equal(doc.activeElement, toggle(doc));
  assert.match(textOf(toggle(doc)), /^Show the per-model evidence/);
});

// --- B. evidence rows that reconcile ---------------------------------------

test("the evidence is a real table with column headers, a caption, and a named scroll region", async () => {
  const { doc } = await mount(await okFinding());
  open(doc);
  const table = doc.querySelectorAll(".model-overspend-table")[0];
  assert.ok(table, "the table is painted once the disclosure is open");
  assert.equal(table.tagName, "TABLE");
  const caption = table.querySelectorAll("caption");
  assert.equal(caption.length, 1);
  assert.ok(caption[0].classList.contains("visually-hidden"));
  const headers = table.querySelectorAll("thead")[0].querySelectorAll("th");
  assert.deepEqual(headers.map((cell) => textOf(cell)),
    ["Model", "Org unit", "Calls", "Current spend", "Proposed tier", "Counted toward this finding"]);
  assert.ok(headers.every((cell) => cell.getAttribute("scope") === "col"));
  // Each row names its own model as a row header, so table navigation announces
  // which model a cell belongs to.
  assert.ok(rows(doc).every((tr) => tr.querySelectorAll("th")[0].getAttribute("scope") === "row"));

  const scroll = doc.querySelectorAll(".model-overspend-scroll")[0];
  assert.equal(scroll.getAttribute("tabindex"), "0");
  assert.equal(scroll.getAttribute("role"), "group");
  assert.match(scroll.getAttribute("aria-label"), /evidence table/);
});

test("the counted deltas sum to the headline figure, formatted the same way", async () => {
  const finding = await okFinding();
  const { doc } = await mount(finding);
  open(doc);
  const counted = rows(doc).filter((tr) => tr.querySelectorAll(".model-overspend-cell-delta")[0]
    .getAttribute("data-counted") === "true");
  assert.equal(counted.length, 1);
  const countedMinor = finding.evidence.rows.filter((entry) => entry.isHeadline)
    .reduce((sum, entry) => sum + entry.overspendMinor, 0);
  assert.equal(countedMinor, finding.metric.amountMinor);

  const total = textOf(doc.querySelectorAll(".model-overspend-total-value")[0]);
  assert.equal(total, money(finding.metric.amountMinor));
  assert.equal(total, textOf(counted[0].querySelectorAll(".model-overspend-delta-value")[0]));
  // The same string as the headline metric above the table, from the same
  // minor-unit source, rounded once at display time.
  assert.equal(total, textOf(doc.querySelectorAll(".model-overspend-metric-value")[0]));
  assert.equal(doc.querySelectorAll(".model-overspend-total-mismatch").length, 0);
  assert.equal(doc.querySelectorAll("tfoot").length, 1);
});

test("a row that is not counted says so and keeps its own estimate visible", async () => {
  const { doc } = await mount(await okFinding());
  open(doc);
  const uncounted = rows(doc).filter((tr) => tr.querySelectorAll(".model-overspend-cell-delta")[0]
    .getAttribute("data-counted") === "false");
  assert.equal(uncounted.length, 3);
  const notes = uncounted.map((tr) => textOf(tr.querySelectorAll(".model-overspend-cell-note")[0]));
  assert.ok(notes.some((note) => /its own estimate is 3009\.23 USD/.test(note)),
    `a candidate row keeps its estimate: ${JSON.stringify(notes)}`);
  assert.ok(notes.some((note) => /No cheaper model clears eligibility/.test(note)));
  // Numeric columns are right-aligned and tabular through one shared class.
  const numeric = rows(doc)[0].querySelectorAll(".numeric");
  assert.equal(numeric.length, 3);
});

// --- C. local org-unit labels ----------------------------------------------

test("a rename typed at one site applies at every other site, and keeps the raw id", async () => {
  const { doc, store } = await mount(await okFinding());
  open(doc);
  const trigger = doc.getElementById("model-overspend-rename-headline");
  assert.equal(trigger.getAttribute("aria-label"), "Rename org unit seg-atlas");
  assert.ok(tabSequence(doc).includes(trigger), "the rename control is in the tab order");
  trigger.focus();
  pressEnter(doc);

  const input = doc.getElementById("model-overspend-rename-input");
  assert.equal(doc.activeElement, input, "focus moves into the field that opened");
  assert.equal(doc.querySelectorAll(".model-overspend-rename-input").length, 1,
    "only the site the reader activated becomes an editor");
  input.value = "Payments platform";
  pressEnter(doc);

  // Site 1: the headline metric line. Site 2: the evidence table row. Site 3:
  // the sentence the contract composed. All three from the one lookup.
  const chips = doc.querySelectorAll(".org-unit").filter((node) => node.dataset.orgUnitId === "seg-atlas");
  assert.ok(chips.length >= 2, `renamed unit is drawn at several sites: ${chips.length}`);
  assert.ok(chips.every((chip) => /Payments platform/.test(textOf(chip))));
  assert.ok(chips.every((chip) => /seg-atlas/.test(textOf(chip))), "the raw id stays visible");
  assert.ok(chips.every((chip) => /seg-atlas/.test(chip.title)));
  assert.match(textOf(doc.querySelectorAll(".model-overspend-headline")[0]),
    /^Payments platform spent 8000\.00 USD/);
  assert.match(textOf(doc.querySelectorAll(".model-overspend-action-text")[0]),
    /^Route Payments platform's/);
  // Borealis was not renamed and is untouched.
  assert.ok(doc.querySelectorAll(".org-unit")
    .some((node) => node.dataset.orgUnitId === "seg-borealis"
      && textOf(node).includes("Borealis Research")));

  assert.equal(doc.activeElement, doc.getElementById("model-overspend-rename-headline"),
    "focus returns to the control that opened the editor");
  assert.match(textOf(doc.getElementById("model-overspend-live")),
    /Org unit seg-atlas is now labelled Payments platform everywhere it appears\./);
  assert.deepEqual(JSON.parse(store.values.get(ORG_UNIT_LABEL_STORAGE_KEY)),
    { "seg-atlas": "Payments platform" });
});

test("a label survives a reload and is cleared by the page's existing reset", async () => {
  const store = storage();
  writeOrgUnitLabel(store, "seg-atlas", "Payments platform");
  const finding = await okFinding();

  // A reload is a fresh document reading the same browser store.
  const reloaded = await mount(finding, store);
  assert.match(textOf(reloaded.doc.querySelectorAll(".model-overspend-metric-where")[0]),
    /Payments platform/);

  // The reset the page already had, not a second button of this panel's own.
  clearModelOverspendFinding(reloaded.doc, { storage: store });
  assert.equal(reloaded.doc.getElementById("model-overspend").hidden, true);
  assert.equal(textOf(reloaded.doc.getElementById("model-overspend-question")), "—");
  assert.equal(store.values.has(ORG_UNIT_LABEL_STORAGE_KEY), false);

  const after = await mount(finding, store);
  assert.match(textOf(after.doc.querySelectorAll(".model-overspend-metric-where")[0]),
    /Atlas Platform/);
});

test("an empty label reverts the unit, and Escape abandons a rename", async () => {
  const store = storage();
  writeOrgUnitLabel(store, "seg-atlas", "Payments platform");
  const { doc } = await mount(await okFinding(), store);
  const trigger = () => doc.getElementById("model-overspend-rename-headline");

  trigger().focus();
  pressEnter(doc);
  doc.getElementById("model-overspend-rename-input").value = "Something else";
  pressKey(doc, "Escape");
  assert.equal(doc.getElementById("model-overspend-rename-input"), null, "the editor closed");
  assert.equal(doc.activeElement, trigger(), "focus returns to the trigger on cancel");
  assert.match(textOf(doc.querySelectorAll(".model-overspend-metric-where")[0]), /Payments platform/);
  assert.match(textOf(doc.getElementById("model-overspend-live")), /Rename cancelled/);

  trigger().focus();
  pressEnter(doc);
  doc.getElementById("model-overspend-rename-input").value = "   ";
  pressEnter(doc);
  assert.match(textOf(doc.querySelectorAll(".model-overspend-metric-where")[0]), /Atlas Platform/);
  assert.match(textOf(doc.getElementById("model-overspend-live")), /shows its own identifier again/);
  assert.deepEqual(JSON.parse(store.values.get(ORG_UNIT_LABEL_STORAGE_KEY)), {});
});

test("an org unit the analysis never named renders as its raw identifier", async () => {
  const finding = buildModelOverspendFinding({
    columns: COLUMNS,
    rows: [
      row({ period: "2026-05" }),
      row({ period: "2026-05", model: "syn-small-1", requests: 55000, spendMinor: 275000 }),
      row({ segmentId: "4f2a", segmentLabel: "4f2a", observedDays: 20 }),
      row({ segmentId: "4f2a", segmentLabel: "4f2a", model: "syn-small-1", requests: 60000, spendMinor: 300000 }),
    ],
  });
  const { doc } = await mount(finding);
  open(doc);
  // Nothing renamed and nothing to fall back on: the identifier is the label,
  // shown once rather than doubled up as its own secondary text.
  const opaque = doc.querySelectorAll(".org-unit").filter((node) => node.dataset.orgUnitId === "4f2a");
  assert.ok(opaque.length >= 2, `drawn at several sites: ${opaque.length}`);
  assert.ok(opaque.every((node) => textOf(node) === "4f2a"));
  assert.ok(opaque.every((node) => node.title === "Org unit 4f2a"));
  assert.ok(opaque.every((node) => node.dataset.renamed === "false"));
  // A prorated month is a further render site, and the contract gives it the id
  // with no name at all — the one place a unit is drawn from an id alone.
  const proration = doc.querySelectorAll(".model-overspend-proration-months")[0];
  assert.ok(proration, "the prorated month is listed");
  assert.match(textOf(proration), /20 of 30 days observed/);
  assert.ok(proration.querySelectorAll(".org-unit")
    .every((node) => textOf(node) === "4f2a"));
});

// --- D. confidence and provenance ------------------------------------------

test("confidence, its reason, and provenance are readable without opening anything", async () => {
  const { doc } = await mount(await okFinding());
  assert.equal(panel(doc).hidden, true, "still collapsed");
  const confidence = doc.querySelectorAll(".model-overspend-confidence")[0];
  assert.equal(confidence.dataset.level, "medium");
  // Not colour alone: a word and a shape ship with the level.
  assert.match(textOf(confidence), /Confidence: medium/);
  assert.equal(confidence.querySelectorAll(".status-shape")[0].getAttribute("aria-hidden"), "true");
  // The reason is in view, not behind a link or a tooltip.
  assert.match(textOf(confidence), /pooled from more than one segment/);
  assert.match(textOf(confidence), /Confidence lowered one level\./);
  assert.equal(confidence.querySelectorAll("a").length, 0);

  const provenance = doc.querySelectorAll(".model-overspend-provenance")[0];
  assert.match(textOf(provenance), /requests: Requests/);
  assert.match(textOf(provenance), /182 source rows became 6 analysis rows/);
  assert.match(textOf(provenance), /No month was prorated\./);
  // The status of the whole finding is also a word, not a tint.
  assert.match(textOf(doc.querySelectorAll(".model-overspend-state")[0]), /Complete result/);
  // The one benchmark ships with its scope.
  assert.match(textOf(doc.querySelectorAll(".model-overspend-benchmark")[0]),
    /No peer or industry comparison exists in this file\./);
});

// --- E. degraded and unavailable -------------------------------------------

test("a file with no request counts shows the contract's sentences, never a zero", async () => {
  const finding = noRequestCounts();
  assert.equal(finding.status, "degraded_no_request_counts");
  const { doc } = await mount(finding);
  const section = doc.getElementById("model-overspend");
  assert.equal(section.dataset.status, "degraded_no_request_counts");
  assert.match(textOf(doc.querySelectorAll(".model-overspend-state")[0]), /no request counts/);
  assert.equal(textOf(doc.querySelectorAll(".model-overspend-metric-withheld")[0]), "Not available");
  assert.match(textOf(doc.querySelectorAll(".model-overspend-metric-reason")[0]),
    /^This file carries no request count/);
  assert.equal(doc.querySelectorAll(".model-overspend-metric-value").length, 0);
  // The part that is still trustworthy — the exact spend — is still shown.
  assert.match(textOf(doc.querySelectorAll(".model-overspend-headline")[0]),
    /largest block of model spend/);
  assert.match(textOf(doc.querySelectorAll(".model-overspend-action")[0]),
    /Why there is no action yet/);
  assert.match(textOf(doc.querySelectorAll(".model-overspend-action-text")[0]),
    /^Re-import with the request-count column mapped/);

  open(doc);
  assert.equal(rows(doc).length, 2, "the spend rows are still there");
  const total = doc.querySelectorAll(".model-overspend-total-withheld")[0];
  assert.match(textOf(total), /No total/);
  assert.match(textOf(total), /no cost per request exists/);
  assert.equal(doc.querySelectorAll(".model-overspend-total-value").length, 0);
  assert.equal(textOf(rows(doc)[0].querySelectorAll(".model-overspend-cell-spend")[0]), "8000.00 USD");
  assert.match(textOf(rows(doc)[0].querySelectorAll(".model-overspend-cell-calls")[0]),
    /No request count in this file/);
  // A standalone 0.00 anywhere would be the fabricated figure this shape is
  // supposed to refuse; 8000.00 and 3000.00 are real and stay.
  assert.equal(/(^|[^\d.])0\.00 USD/.test(textOf(panel(doc))), false,
    "no fabricated zero anywhere in the panel");
});

test("an unavailable metric names the gate that failed rather than emptying the panel", async () => {
  const finding = unavailable();
  assert.equal(finding.status, "unavailable");
  const { doc } = await mount(finding);
  assert.match(textOf(doc.querySelectorAll(".model-overspend-state")[0]),
    /No overspend metric available/);
  assert.match(textOf(doc.querySelectorAll(".model-overspend-metric-reason")[0]),
    /No cheaper model clears eligibility/);
  assert.match(textOf(doc.querySelectorAll(".model-overspend-headline")[0]),
    /The largest block of spend is/);
  assert.equal(doc.querySelectorAll(".model-overspend-confidence")[0].dataset.level, "low");
  assert.match(textOf(doc.querySelectorAll(".model-overspend-confidence")[0]),
    /Confidence: low/);
  open(doc);
  assert.equal(rows(doc).length, 2);
  assert.match(textOf(doc.querySelectorAll(".model-overspend-total-withheld")[0]), /No total/);
});

test("a file whose models are all placeholders reports the unattributed spend, not an empty grid", async () => {
  const finding = unrecognizedModels();
  assert.equal(finding.status, "degraded_unrecognized_models");
  const { doc } = await mount(finding);
  assert.match(textOf(doc.querySelectorAll(".model-overspend-headline")[0]),
    /16000\.00 USD of spend in 2026-06 carries no recognizable model identifier/);
  open(doc);
  assert.equal(rows(doc).length, 0);
  assert.match(textOf(doc.querySelectorAll(".model-overspend-empty")[0]),
    /nothing to rank/);
  const unattributed = doc.querySelectorAll(".model-overspend-unattributed-list")[0];
  assert.ok(unattributed, "the spend the file does show is listed");
  assert.equal(unattributed.querySelectorAll("li").length, 2);
  assert.match(textOf(unattributed), /8000\.00 USD/);
  assert.match(textOf(unattributed), /placeholder_identifier/);
  // Render site: unattributed rows go through the same org-unit lookup.
  assert.ok(unattributed.querySelectorAll(".org-unit").length >= 2);
});

// --- F. the surface never writes anything home ------------------------------

test("nothing about a label leaves this browser", async () => {
  const view = await readFile(new URL("../src/model-overspend-finding-view.js", import.meta.url), "utf8");
  const labels = await readFile(new URL("../src/org-unit-labels.js", import.meta.url), "utf8");
  for (const [name, source] of [["view", view], ["labels", labels]]) {
    assert.equal(/fetch\(|XMLHttpRequest|sendBeacon|navigator\./.test(source), false,
      `${name} makes no request`);
    assert.equal(/innerHTML|outerHTML|insertAdjacentHTML/.test(source), false,
      `${name} assigns no markup`);
  }
  // The page clears the labels through the reset it already had.
  const pageSource = await readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8");
  assert.match(pageSource, /clearModelOverspendFinding\(document, \{ storage: labelStorage\(\) \}\)/);
});
