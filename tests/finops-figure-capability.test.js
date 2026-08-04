// The capability preview (#1065): which figure families an export can earn,
// answered from the preflight verdict alone, before any analysis runs.
//
// THE AGREEMENT CHECK IS THE POINT OF THIS FILE. Every fixture below is run
// twice — once through `previewFigureCapability`, and once through the SHIPPING
// analysis path (adapt, normalize, headline, period series, unit naming) — and
// the two verdicts are compared family by family. A preview that promised a
// figure the analysis then withheld fails here, which is the only place it can
// be caught before a reader meets it.
//
// Every export is built in this file rather than committed, so the exact bytes
// behind each expectation are readable beside the expectation.

import assert from "node:assert/strict";
import test from "node:test";

import {
  FIGURE_FAMILIES, FIGURE_FAMILY_RANKING, FIGURE_STATE, previewFigureCapability,
} from "../src/finops-figure-capability.js";
import { adaptParsedExport, preflight } from "../src/hyperscaler-export-adapters.js";
import { parseExportText } from "../src/browser-compat-eligibility.js";
import { normalizeLocalFinopsHistory } from "../src/local-finops.js";
import { importedHeadline } from "../src/finops-imported-headline.js";
import { importedPeriodSeries, periodMovement } from "../src/finops-imported-period-series.js";
import { deriveOrgUnitNames } from "../src/finops-export-unit-names.js";
import {
  EXPORT_CHECK_IDS, mountExportCheck, renderExportCheck,
} from "../src/finops-export-check.js";
import { parseHtml } from "./support/browser.js";

// --- the exports, three completeness levels of the same shape ---------------

const csv = (header, rows) => `${[header, ...rows].map((row) => row.join(",")).join("\n")}\n`;

const BEDROCK_HEADER = ["lineItem/UsageStartDate", "product/model_id", "lineItem/UsageAmount",
  "lineItem/UnblendedCost", "lineItem/CurrencyCode", "lineItem/UsageAccountId",
  "lineItem/UsageType"];

const bedrockRow = (date, units, cost, account = "000000000001") => [date,
  "anthropic.claude-3-5-sonnet", units, cost, "USD", account, "USE1-InputTokenCount"];

/** One billing month of billing-only columns: the case the issue is named for. */
const SINGLE_MONTH = csv(BEDROCK_HEADER, [
  bedrockRow("2026-07-05", "1200000", "48.00"),
  bedrockRow("2026-07-14", "450000", "18.00"),
  bedrockRow("2026-07-22", "980000", "39.20", "000000000002"),
]);

/** Two billing months, still billing-only: movement is earned, names are not. */
const TWO_MONTHS = csv(BEDROCK_HEADER, [
  bedrockRow("2026-06-08", "800000", "32.00"),
  bedrockRow("2026-06-19", "300000", "12.00", "000000000002"),
  bedrockRow("2026-07-05", "1200000", "48.00"),
  bedrockRow("2026-07-22", "980000", "39.20", "000000000002"),
]);

/** Two months plus a recognized tag column, so every family is earnable. */
const LABELLED_HEADER = [...BEDROCK_HEADER, "tag:team"];
const labelledRow = (date, units, cost, account, team) =>
  [...bedrockRow(date, units, cost, account), team];
const TWO_MONTHS_LABELLED = csv(LABELLED_HEADER, [
  labelledRow("2026-06-08", "800000", "32.00", "000000000001", "Platform Engineering"),
  labelledRow("2026-06-19", "300000", "12.00", "000000000002", "Data Science"),
  labelledRow("2026-07-05", "1200000", "48.00", "000000000001", "Platform Engineering"),
  labelledRow("2026-07-22", "980000", "39.20", "000000000002", "Data Science"),
]);

/**
 * The labelled fixtures, with the state each family is LABELLED with by hand.
 * Adding an entry here adds it to the agreement sweep, the ordering check, and
 * the ranking check without touching any of them.
 */
const FIXTURES = Object.freeze([
  Object.freeze({
    id: "single-month-billing-only",
    text: SINGLE_MONTH,
    expected: Object.freeze({
      spend_headline: FIGURE_STATE.earnable,
      movement: FIGURE_STATE.withheld,
      department_rows: FIGURE_STATE.earnable,
      department_names: FIGURE_STATE.withheld,
    }),
  }),
  Object.freeze({
    id: "two-month-billing-only",
    text: TWO_MONTHS,
    expected: Object.freeze({
      spend_headline: FIGURE_STATE.earnable,
      movement: FIGURE_STATE.earnable,
      department_rows: FIGURE_STATE.earnable,
      department_names: FIGURE_STATE.withheld,
    }),
  }),
  Object.freeze({
    id: "two-month-with-tag-labels",
    text: TWO_MONTHS_LABELLED,
    expected: Object.freeze({
      spend_headline: FIGURE_STATE.earnable,
      movement: FIGURE_STATE.earnable,
      department_rows: FIGURE_STATE.earnable,
      department_names: FIGURE_STATE.earnable,
    }),
  }),
]);

const check = (text) => {
  const parsed = parseExportText(text, "bedrock-cur.csv");
  const verdict = preflight(parsed);
  const fieldNames = parsed.fieldNames.map(String);
  return {
    parsed, verdict, fieldNames,
    preview: previewFigureCapability(verdict, { fieldNames }),
  };
};

/**
 * What the produced brief ACTUALLY contains for this export, family by family,
 * read off the shipping modules rather than restated. Each line is the withhold
 * predicate the analysis itself applies:
 *
 *   spend_headline    the headline contract's own `supported` flag
 *   movement          `periodMovement(...).available` over the in-file series
 *   department_rows   a ranked department row carrying a name
 *   department_names  a name derived under the checked-in derivation contract
 */
function briefStates({ parsed, verdict }) {
  const adapted = adaptParsedExport(parsed);
  if (adapted.status !== "projected") {
    return {
      spend_headline: FIGURE_STATE.withheld,
      movement: FIGURE_STATE.withheld,
      department_rows: FIGURE_STATE.withheld,
      department_names: FIGURE_STATE.withheld,
    };
  }
  const analysis = normalizeLocalFinopsHistory({ providers: [adapted.parsed] });
  const headline = importedHeadline(analysis);
  const spendSlot = headline.slots.find((slot) => slot.id === "recoverable_spend");
  const movement = periodMovement(importedPeriodSeries([adapted.parsed]));
  const ranked = analysis.rankedDepartments.filter((entry) =>
    typeof entry?.name === "string" && entry.name.trim() !== "");
  const naming = deriveOrgUnitNames({
    columns: parsed.fieldNames.map(String),
    rows: parsed.records,
    unitColumn: verdict.scopeColumn,
  });
  const state = (earned) => (earned ? FIGURE_STATE.earnable : FIGURE_STATE.withheld);
  return {
    spend_headline: state(spendSlot.supported),
    movement: state(movement.available),
    department_rows: state(ranked.length > 0),
    department_names: state(naming.derivedCount > 0),
  };
}

// --- agreement --------------------------------------------------------------

test("the preview agrees, family by family, with the brief the same export produces", () => {
  for (const fixture of FIXTURES) {
    const read = check(fixture.text);
    const actual = briefStates(read);
    for (const family of read.preview.families) {
      assert.equal(family.state, fixture.expected[family.id],
        `${fixture.id}: ${family.id} was labelled ${fixture.expected[family.id]}`);
      assert.equal(family.state, actual[family.id],
        `${fixture.id}: the preview says ${family.id} is ${family.state}, the brief says `
        + `${actual[family.id]}`);
    }
    assert.equal(read.preview.families.length, FIGURE_FAMILIES.length, fixture.id);
  }
});

test("every labelled fixture covers every declared family, so a new family cannot ship untested", () => {
  for (const fixture of FIXTURES) {
    assert.deepEqual(Object.keys(fixture.expected).sort(),
      [...FIGURE_FAMILY_RANKING].sort(), fixture.id);
  }
});

// --- the named case ---------------------------------------------------------

test("one month of billing-only data withholds movement and department names, and says why", () => {
  const { preview, verdict } = check(SINGLE_MONTH);
  assert.equal(verdict.monthCount, 1);
  const byId = Object.fromEntries(preview.families.map((family) => [family.id, family]));

  assert.equal(byId.movement.state, FIGURE_STATE.withheld);
  assert.equal(byId.movement.missing,
    "needs more than one billing period — this export covers one month");

  assert.equal(byId.department_names.state, FIGURE_STATE.withheld);
  assert.equal(byId.department_names.missing,
    "needs a unit or tag column — one of project, tag, description, cost center");

  // The two families this export DOES earn are named too: a preview that only
  // listed losses would read as a refusal, which this export is not.
  assert.equal(byId.spend_headline.state, FIGURE_STATE.earnable);
  assert.equal(byId.department_rows.state, FIGURE_STATE.earnable);
  assert.equal(preview.earnableCount, 2);
  assert.equal(preview.withheldCount, 2);
});

test("a file no published contract claims earns nothing, and every family says the same one thing", () => {
  const { preview } = check("alpha,beta\n1,2\n");
  assert.equal(preview.earnableCount, 0);
  assert.equal(preview.withheldCount, FIGURE_FAMILIES.length);
  for (const family of preview.families) {
    assert.equal(family.state, FIGURE_STATE.withheld);
    assert.equal(family.missing, "needs an export from a console this build reads");
  }
});

test("a malformed or absent verdict reads as an export that earns nothing, and never throws", () => {
  for (const value of [null, undefined, {}, { reason: "ready" }]) {
    const preview = previewFigureCapability(value);
    assert.equal(preview.families.length, FIGURE_FAMILIES.length);
    assert.equal(typeof preview.summary, "string");
  }
});

// --- ordering ---------------------------------------------------------------

test("withheld families are listed by the declared ranking, highest-value input first", () => {
  assert.deepEqual(FIGURE_FAMILY_RANKING,
    ["spend_headline", "movement", "department_rows", "department_names"]);
  // The rank field is the ranking, not the array index it happens to sit at.
  FIGURE_FAMILIES.forEach((family, index) => {
    assert.equal(family.rank, index + 1, family.id);
    assert.equal(typeof family.assumption, "string");
    assert.ok(family.assumption.length > 40, `${family.id} must state its assumption`);
  });

  const { preview } = check(SINGLE_MONTH);
  const withheld = preview.families.filter((family) => family.state === FIGURE_STATE.withheld);
  assert.deepEqual(withheld.map((family) => family.id), ["movement", "department_names"]);
  // Movement outranks the names, so it is the one the summary line names.
  assert.equal(preview.topMissing.id, "movement");
  assert.ok(preview.summary.includes("Month-on-month movement"));
  assert.ok(preview.summary.startsWith("2 of 4 figure families are earnable"));
});

test("nothing withheld says so, rather than leaving the summary line to be read as a silence", () => {
  const { preview } = check(TWO_MONTHS_LABELLED);
  assert.equal(preview.withheldCount, 0);
  assert.equal(preview.topMissing, null);
  assert.equal(preview.summary,
    "All 4 figure families are earnable from this export. Nothing is withheld.");
});

// --- rendering --------------------------------------------------------------

const PAGE = "<html><body><main><section id=\"provider-readiness\"></section></main></body></html>";

function paint(text) {
  const doc = parseHtml(PAGE);
  assert.equal(mountExportCheck(doc, {}), true);
  const read = check(text);
  renderExportCheck(doc, read.verdict, read.fieldNames, "bedrock-cur.csv", read.preview);
  return { doc, ...read };
}

const ancestorIds = (node) => {
  const ids = [];
  for (let walk = node?.parentNode; walk; walk = walk.parentNode) {
    if (walk.id) ids.push(walk.id);
  }
  return ids;
};

test("the summary line is outside the fold and the family breakdown is inside it", () => {
  const { doc, preview } = paint(SINGLE_MONTH);

  const line = doc.getElementById(EXPORT_CHECK_IDS.figures);
  assert.equal(line.hidden, false);
  assert.equal(line.textContent, preview.summary);
  // Outside: no disclosure anywhere above it, so a reader who opens nothing
  // still reads the headcount and the top missing input.
  assert.equal(ancestorIds(line).includes(EXPORT_CHECK_IDS.disclosure), false);
  assert.equal(ancestorIds(line).includes(EXPORT_CHECK_IDS.zone), true);

  // Inside: the per-family rows, one per declared family, in the panel's one
  // existing fold rather than a second one this change invented.
  const list = doc.getElementById(EXPORT_CHECK_IDS.figureList);
  assert.equal(ancestorIds(list).includes(EXPORT_CHECK_IDS.disclosure), true);
  assert.equal(list.hidden, false);
  assert.equal(list.querySelectorAll("li").length, FIGURE_FAMILIES.length);
  assert.equal(list.querySelectorAll("[data-state=\"missing\"]").length, preview.withheldCount);
  assert.equal(list.querySelectorAll("[data-state=\"present\"]").length, preview.earnableCount);
  assert.equal(doc.getElementById(EXPORT_CHECK_IDS.zone)
    .querySelectorAll("details").length, 1);
});

test("a refused export paints no capability preview, and a later standby clears the one it had", () => {
  const { doc } = paint("alpha,beta\n1,2\n");
  assert.equal(doc.getElementById(EXPORT_CHECK_IDS.figures).hidden, true);
  const list = doc.getElementById(EXPORT_CHECK_IDS.figureList);
  assert.equal(list.hidden, true);
  assert.equal(list.querySelectorAll("li").length, 0);
});

test("a hostile column name is escaped and clamped rather than interpolated into the panel", () => {
  // Angle brackets, a quote, and a backtick. Not a double quote: that is the
  // CSV reader's own escape and it refuses the file long before this module.
  const hostile = "tag:<img src=x onerror=alert('1')`>";
  const header = [...BEDROCK_HEADER, hostile];
  const hostileExport = csv(header, [
    [...bedrockRow("2026-06-08", "800000", "32.00"), "Platform"],
    [...bedrockRow("2026-07-05", "1200000", "48.00"), "Platform"],
  ]);
  const { doc, preview } = paint(hostileExport);

  const names = preview.families.find((family) => family.id === "department_names");
  assert.equal(names.state, FIGURE_STATE.earnable);
  // The characters markup is made of are removed, not encoded, on the shared
  // `quoteFromExport` path — so nothing downstream has to re-decode them.
  assert.equal(/[<>"'`&]/.test(names.detail), false, names.detail);

  const list = doc.getElementById(EXPORT_CHECK_IDS.figureList);
  assert.equal(list.textContent.includes("<img"), false);
  assert.equal(list.textContent.includes("onerror"), true, "the words survive; the markup does not");
  // No element was created from the reader's string, on the panel or anywhere.
  assert.equal(doc.querySelectorAll("img").length, 0);
  assert.equal(doc.querySelectorAll("script").length, 0);
});
