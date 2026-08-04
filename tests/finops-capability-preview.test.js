// The capability preview (#1065): which figure families an export earns, said
// before the analysis runs — and held to what the analysis then actually does.
//
// THE ONE ASSERTION THAT MATTERS is agreement. A preview is not a description of
// a rule; it is a PROMISE, and the only way it fails a reader is by disagreeing
// with the brief they get thirty seconds later. So the fixtures below do not
// compare the preview against a hand-written expectation of itself. Each one:
//
//   1. runs `preflight` on the export's own bytes and previews that verdict; and
//   2. runs the SAME bytes all the way through the real import path — the
//      adapter, `normalizeLocalFinopsHistory`, the in-file period series, and
//      `scoreBriefCompleteness` — and reads which families the produced brief
//      actually shows;
//
// and then asserts the two sets are EQUAL over the previewed families: nothing
// promised that is withheld, nothing withheld that is shown. An export the
// import path refuses shows no family at all, which is a brief too.
//
// Fixtures are generated here rather than checked in, from one row builder, so
// the only difference between two fixtures is the completeness being tested.
//
// The rendering assertions are on COUNTS and ATTRIBUTES. This harness models no
// layout and reads text straight through a closed disclosure, so "the preview is
// behind the breakdown" is held on the node's ancestry and on the absence of the
// `open` attribute, never on whether text is visible.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { parseExportText } from "../src/browser-compat-eligibility.js";
import { adaptParsedExport, preflight } from "../src/hyperscaler-export-adapters.js";
import { normalizeLocalFinopsHistory } from "../src/local-finops.js";
import {
  importedPeriodSeries, periodMovement,
} from "../src/finops-imported-period-series.js";
import {
  DRILL_DOWN_SLOT_ID, TREND_SLOT_ID, scoreBriefCompleteness,
} from "../src/finops-brief-completeness.js";
import {
  PREVIEW_FAMILY_ORDER, PREVIEW_INPUTS, PREVIEW_INPUT_ORDER, capabilityPreview, rankMissingInputs,
} from "../src/finops-capability-preview.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(await readFile(
  new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

// --- fixtures, generated -----------------------------------------------------

const ACCOUNT = "lineItem/UsageAccountId";
const HEADER = ["lineItem/UsageStartDate", "product/model_id", "lineItem/UsageAmount",
  "lineItem/UnblendedCost", "lineItem/CurrencyCode", ACCOUNT, "lineItem/UsageType"];
const CELL = { "lineItem/UsageStartDate": null, "product/model_id": "anthropic.claude-sonnet",
  "lineItem/UsageAmount": "120000", "lineItem/UnblendedCost": "4.80",
  "lineItem/CurrencyCode": "USD", [ACCOUNT]: "000000000001",
  "lineItem/UsageType": "USE1-InputTokenCount" };

/** One export, over the named columns and the named billing days. */
const exportOf = (columns, days) => [columns.join(","),
  ...days.map((day) => columns.map((column) =>
    (column === "lineItem/UsageStartDate" ? day : CELL[column])).join(",")),
].join("\n") + "\n";

const JULY = ["2026-07-20", "2026-07-21", "2026-07-22"];
const JUNE_AND_JULY = ["2026-06-20", "2026-06-21", "2026-06-22", ...JULY];

const FIXTURES = Object.freeze([
  {
    name: "two calendar months, fully labelled",
    text: exportOf(HEADER, JUNE_AND_JULY),
  },
  {
    name: "one calendar month, fully labelled",
    text: exportOf(HEADER, JULY),
  },
  {
    // The case the issue names: one period, billing columns only, no unit or
    // tag column anywhere in the file.
    name: "single-period billing-only export",
    text: exportOf(HEADER.filter((column) => column !== ACCOUNT), JULY),
  },
  {
    name: "a file no published contract claims",
    text: "posting_date,gl_account,amount\n2026-07-20,6100-software,482.10\n",
  },
]);

// --- the ground truth: which families the produced brief actually shows -------

/**
 * Run one export the whole way and report the families the brief shows.
 *
 * Every step is the shipping one. The movement is the in-file period series the
 * page hands to the scorer, not a re-derivation: a preview that agreed with a
 * different movement than the page paints would be agreeing with nothing.
 */
function familiesTheBriefShows(text, name) {
  const adapted = adaptParsedExport(parseExportText(text, name));
  if (adapted.status !== "projected") return new Set();
  let analysis = null;
  try {
    analysis = normalizeLocalFinopsHistory({ providers: [adapted.document] });
  } catch {
    return new Set();
  }
  const movement = periodMovement(importedPeriodSeries([adapted.document]));
  const score = scoreBriefCompleteness(analysis, { movement });
  return new Set(score.slots.filter((slot) => slot.satisfied).map((slot) => slot.id)
    .filter((id) => PREVIEW_FAMILY_ORDER.includes(id)));
}

const previewOf = (fixture) =>
  capabilityPreview(preflight(parseExportText(fixture.text, fixture.name)));

const familyOf = (preview, id) => preview.families.find((family) => family.id === id);

// --- 1. agreement -----------------------------------------------------------

test("for every fixture the preview's earnable set is exactly what the brief shows", () => {
  assert.ok(FIXTURES.length >= 3, "agreement needs exports of differing completeness");
  for (const fixture of FIXTURES) {
    const preview = previewOf(fixture);
    const shown = familiesTheBriefShows(fixture.text, fixture.name);
    assert.deepEqual([...preview.earnable].sort(), [...shown].sort(),
      `${fixture.name}: the preview promised a different set than the brief showed`);
    // And the other side of the same coin, stated separately so a preview that
    // simply dropped a family cannot pass: every previewed family is in exactly
    // one of the two lists.
    assert.deepEqual([...preview.withheld].sort(),
      PREVIEW_FAMILY_ORDER.filter((id) => !shown.has(id)).sort(),
      `${fixture.name}: a withheld family disagreed with the brief`);
    assert.equal(preview.earnable.length + preview.withheld.length, PREVIEW_FAMILY_ORDER.length);
  }
});

test("a two-month export earns every previewed family and a one-month export does not", () => {
  const complete = previewOf(FIXTURES[0]);
  assert.deepEqual([...complete.earnable].sort(), [...PREVIEW_FAMILY_ORDER].sort());
  assert.deepEqual(complete.missingInputs, []);

  const single = previewOf(FIXTURES[1]);
  assert.deepEqual(single.withheld, [TREND_SLOT_ID]);
  assert.equal(familyOf(single, TREND_SLOT_ID).missingInput, PREVIEW_INPUTS.MULTIPLE_PERIODS);
  assert.equal(familyOf(single, DRILL_DOWN_SLOT_ID).earnable, true);
});

test("a single-period billing-only export names both missing inputs, each on its own family", () => {
  const preview = previewOf(FIXTURES[2]);
  assert.deepEqual([...preview.earnable], []);
  const movement = familyOf(preview, TREND_SLOT_ID);
  const departments = familyOf(preview, DRILL_DOWN_SLOT_ID);
  assert.equal(movement.earnable, false);
  assert.equal(departments.earnable, false);
  // Each names the input ITS family is waiting on, beside the billing columns
  // every family is waiting on. Naming only the shared blocker would tell a
  // reader who fixed it that they were done, and they would not be.
  assert.ok(movement.missingInputs.includes(PREVIEW_INPUTS.MULTIPLE_PERIODS),
    "the movement figure must name multiple periods");
  assert.ok(departments.missingInputs.includes(PREVIEW_INPUTS.UNIT_OR_TAG_LABELS),
    "the department breakdown must name unit or tag labels");
  assert.ok(!movement.missingInputs.includes(PREVIEW_INPUTS.UNIT_OR_TAG_LABELS),
    "the movement figure does not need labels and must not ask for them");
  assert.ok(!departments.missingInputs.includes(PREVIEW_INPUTS.MULTIPLE_PERIODS));
});

test("a null verdict withholds every family rather than guessing one", () => {
  const preview = capabilityPreview(null);
  assert.deepEqual([...preview.earnable], []);
  assert.deepEqual([...preview.withheld].sort(), [...PREVIEW_FAMILY_ORDER].sort());
});

// --- 2. the ordering rule ---------------------------------------------------

test("missing inputs rank by how many withheld families each one blocks", () => {
  const preview = previewOf(FIXTURES[2]);
  // billing columns block all three; the other two block one family each and
  // tie, so the declared input order decides — labels before periods.
  assert.deepEqual(preview.missingInputs.map((input) => [input.id, input.unblocks]), [
    [PREVIEW_INPUTS.BILLING_COLUMNS, 3],
    [PREVIEW_INPUTS.UNIT_OR_TAG_LABELS, 1],
    [PREVIEW_INPUTS.MULTIPLE_PERIODS, 1],
  ]);
  // The rank is a count of the lines a reader can see, so it is checkable
  // against them: no input claims to block more families than are withheld.
  for (const input of preview.missingInputs) {
    assert.equal(input.unblocks,
      preview.families.filter((family) => family.missingInputs.includes(input.id)).length);
  }
});

test("the tie-break is the declared input order and nothing else", () => {
  const tied = [
    { id: "a", earnable: false, missingInputs: [PREVIEW_INPUTS.MULTIPLE_PERIODS] },
    { id: "b", earnable: false, missingInputs: [PREVIEW_INPUTS.UNIT_OR_TAG_LABELS] },
  ];
  assert.deepEqual(rankMissingInputs(tied).map((input) => input.id),
    [PREVIEW_INPUTS.UNIT_OR_TAG_LABELS, PREVIEW_INPUTS.MULTIPLE_PERIODS]);
  // Reversing the families cannot reverse the answer: object order is not a rule.
  assert.deepEqual(rankMissingInputs(tied.slice().reverse()).map((input) => input.id),
    [PREVIEW_INPUTS.UNIT_OR_TAG_LABELS, PREVIEW_INPUTS.MULTIPLE_PERIODS]);
  assert.deepEqual([...PREVIEW_INPUT_ORDER], [PREVIEW_INPUTS.BILLING_COLUMNS,
    PREVIEW_INPUTS.USAGE_ROWS, PREVIEW_INPUTS.UNIT_OR_TAG_LABELS,
    PREVIEW_INPUTS.MULTIPLE_PERIODS]);
  // An earnable family contributes nothing to the ranking.
  assert.deepEqual(rankMissingInputs([{ id: "c", earnable: true, missingInputs: [] }]), []);
});

test("reading order leads with what the export WILL earn, then the worst blocker", () => {
  const single = previewOf(FIXTURES[1]);
  assert.deepEqual(single.families.map((family) => family.earnable), [true, true, false]);
  const blocked = previewOf(FIXTURES[2]);
  // Every family is withheld here, so order is the rank of the input each one
  // leads with — all three lead with the billing columns, and the declared
  // family order (the brief's own reading order) settles it.
  assert.deepEqual(blocked.families.map((family) => family.id), [...PREVIEW_FAMILY_ORDER]);
});

// --- 3. no scoring math -----------------------------------------------------

test("the preview publishes states and named inputs, never a score", () => {
  const preview = previewOf(FIXTURES[2]);
  const banned = /score|grade|weight|confidence|tier|percent|total/i;
  for (const family of preview.families) {
    for (const key of Object.keys(family)) {
      assert.ok(!banned.test(key), `a figure family must not publish ${key}`);
    }
    assert.equal(typeof family.earnable, "boolean");
  }
  // The completeness score of the same export is byte-identical whether or not
  // it was previewed: this module reads the scorer and writes nothing back.
  const before = JSON.stringify(scoreBriefCompleteness(null));
  capabilityPreview(preflight(parseExportText(FIXTURES[0].text, FIXTURES[0].name)));
  assert.equal(JSON.stringify(scoreBriefCompleteness(null)), before);
});

// --- 4. the panel -----------------------------------------------------------

async function openFinopsTab() {
  const page = await loadPage(PAGE, {
    storage: {},
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

const checkZone = (document) => document.getElementById("finops-export-check");

function checkExport(document, name, text) {
  const input = document.getElementById("finops-export-check-file");
  input.files = [{ name, type: "text/csv", text: async () => text }];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

test("the checked panel lists the earnable and withheld figures inside its one disclosure", async () => {
  const { document } = await openFinopsTab();
  checkExport(document, "bedrock-one-month.csv", FIXTURES[1].text);
  await waitFor(() => document.getElementById("finops-export-check-figure-list")
    .querySelectorAll("li").length > 0, "the figure preview to be painted");

  const figures = document.getElementById("finops-export-check-figure-list");
  const rows = figures.querySelectorAll("li");
  assert.equal(rows.length, PREVIEW_FAMILY_ORDER.length);
  assert.deepEqual([...rows].map((row) => row.dataset.state), ["present", "present", "missing"]);

  // Behind the SAME disclosure the column breakdown is behind — not a second
  // one, and not a second detail line beside the verdict. Held on ancestry and
  // on the details count, because this harness reads through a closed one.
  assert.equal(checkZone(document).querySelectorAll("details").length, 1);
  const disclosure = document.getElementById("finops-export-check-columns");
  assert.equal(disclosure.hasAttribute("open"), false);
  let ancestor = figures.parentNode;
  let inside = false;
  while (ancestor && ancestor.nodeType === 1) {
    if (ancestor.tagName === "DETAILS") inside = true;
    ancestor = ancestor.parentNode;
  }
  assert.equal(inside, true, "the figure preview must live inside the existing disclosure");
  // The verdict above it is untouched: one answer, one detail, one action.
  assert.equal(document.getElementById("finops-export-check-detail").hidden, false);
  assert.equal(document.getElementById("finops-export-check-continue").hidden, false);
  assert.equal(document.getElementById("finops-export-check-guidance").hidden, true);
  // And the column breakdown still holds only columns.
  assert.equal(document.getElementById("finops-export-check-column-list")
    .querySelectorAll("li").length, 7);
});

test("the panel names the highest-value missing input first, and no number but a count", async () => {
  const { document } = await openFinopsTab();
  checkExport(document, "billing-only.csv", FIXTURES[2].text);
  await waitFor(() => document.getElementById("finops-export-check-figure-list")
    .querySelectorAll("li").length > 0, "the figure preview to be painted");

  const lede = textOf(document.getElementById("finops-export-check-figures-lede"));
  const preview = previewOf(FIXTURES[2]);
  assert.match(lede, new RegExp(`add ${preview.missingInputs[0].label} first`));
  assert.match(lede, /3 of the withheld figures/);
  // Every withheld line names an input, so no line reads "withheld" alone.
  const rows = [...document.getElementById("finops-export-check-figure-list")
    .querySelectorAll("li")];
  assert.equal(rows.filter((row) => row.dataset.state === "missing").length,
    PREVIEW_FAMILY_ORDER.length);
  for (const row of rows) assert.match(textOf(row), /Withheld — needs \S/);
  // No grade, no score, no percentage reaches this block.
  assert.doesNotMatch(lede, /\bscore|\bgrade|%|points/i);
});
