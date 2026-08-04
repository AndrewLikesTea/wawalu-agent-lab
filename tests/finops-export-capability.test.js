// The capability preview (#1065), held to the brief it predicts.
//
// This file is the agreement claim, and it is the deliverable. A preview that
// says a figure is earnable is a promise about a brief nobody has run yet, so
// every fixture below is run through BOTH sides — the preview from the preflight
// verdict, and the real brief from the real import path — and the two derived
// SETS are compared mechanically. Nothing here hand-writes an expected brief:
// a hand-written expectation can agree with a wrong preview.
//
// The brief side is the production path with nothing stubbed:
//
//     export text -> parseExportText -> adaptParsedExport
//                 -> normalizeLocalFinopsHistory -> scoreBriefCompleteness
//
// with the movement summary derived exactly the way /evolution.html derives it
// (`importedPeriodSeries` over the parsed export, then `periodMovement`), rather
// than from the envelope's one-entry period list — a brief scored with the wrong
// movement would let a wrong preview pass.
//
// Every fixture is named for what it is LABELLED as, so a disputed preview can
// be traced back to one by name.

import test from "node:test";
import assert from "node:assert/strict";

import { parseExportText } from "../src/browser-compat-eligibility.js";
import { adaptParsedExport, preflight } from "../src/hyperscaler-export-adapters.js";
import { normalizeLocalFinopsHistory } from "../src/local-finops.js";
import { importedPeriodSeries, periodMovement } from "../src/finops-imported-period-series.js";
import { scoreBriefCompleteness } from "../src/finops-brief-completeness.js";
import {
  CAPABILITY_INPUTS, CAPABILITY_STATE, FAMILY_ORDER, INPUT_NAMES, ROLE_INPUT_NAMES,
  capabilityCounts, previewEarnableFigures,
} from "../src/finops-export-capability.js";
import { FIELD_ROLES } from "../src/browser-compat-contracts.js";

// --- the exports, built here rather than committed ---------------------------

const csv = (header, rows) => `${[header, ...rows].map((row) => row.join(",")).join("\n")}\n`;

const BEDROCK_HEADER = ["lineItem/UsageStartDate", "product/model_id", "lineItem/UsageAmount",
  "lineItem/UnblendedCost", "lineItem/CurrencyCode", "lineItem/UsageAccountId",
  "lineItem/UsageType"];

const row = (date, units, cost, account) => [date, "anthropic.claude-sonnet", units, cost,
  "USD", account, "USE1-InputTokenCount"];

/** The header with one column taken out, and the same rows minus that cell. */
function without(column, rows) {
  const index = BEDROCK_HEADER.indexOf(column);
  return csv(BEDROCK_HEADER.filter((name) => name !== column),
    rows.map((cells) => cells.filter((_, at) => at !== index)));
}

const ONE_MONTH = [
  row("2026-07-02", "120000", "48.00", "000000000001"),
  row("2026-07-11", "45000", "19.90", "000000000002"),
  row("2026-07-19", "98000", "39.20", "000000000001"),
];

const TWO_MONTHS = [
  ...ONE_MONTH,
  row("2026-08-03", "131000", "52.40", "000000000001"),
  row("2026-08-14", "51000", "20.60", "000000000002"),
];

/**
 * (a) single-period, billing-only: one billing month of dates, amounts and
 *     meters, and no column saying WHOSE spend any row is. The export the issue
 *     names — and the one that established that the label column is a
 *     recognition signature rather than a per-figure input, because dropping it
 *     does not leave a recognized export missing a column: it leaves a file no
 *     published contract claims.
 */
const FIXTURE_SINGLE_PERIOD_BILLING_ONLY = {
  name: "single-period billing-only export (one month, no unit or tag label column)",
  text: without("lineItem/UsageAccountId", ONE_MONTH),
};

/** (b) multi-period, still with no unit or tag label column. */
const FIXTURE_MULTI_PERIOD_UNLABELLED = {
  name: "multi-period unlabelled export (two months, no unit or tag label column)",
  text: without("lineItem/UsageAccountId", TWO_MONTHS),
};

/** (c) one month, labelled: everything but the period-over-period comparison. */
const FIXTURE_SINGLE_PERIOD_LABELLED = {
  name: "single-period labelled export (one month, account labels present)",
  text: csv(BEDROCK_HEADER, ONE_MONTH),
};

/**
 * (d) recognized, one month, and missing one required column that is NOT a
 *     signature — the currency. Two different missing inputs are in play at
 *     once, which is what the ordering rule exists to resolve.
 */
const FIXTURE_SINGLE_PERIOD_NO_CURRENCY = {
  name: "single-period export missing the currency column (recognized, not analyzable)",
  text: without("lineItem/CurrencyCode", ONE_MONTH),
};

/** (e) complete: two labelled months, so every family has its inputs. */
const FIXTURE_COMPLETE = {
  name: "complete export (two months, account labels present)",
  text: csv(BEDROCK_HEADER, TWO_MONTHS),
};

const FIXTURES = [FIXTURE_SINGLE_PERIOD_BILLING_ONLY, FIXTURE_MULTI_PERIOD_UNLABELLED,
  FIXTURE_SINGLE_PERIOD_LABELLED, FIXTURE_SINGLE_PERIOD_NO_CURRENCY, FIXTURE_COMPLETE];

// --- the two sides -----------------------------------------------------------

const previewOf = (fixture) =>
  previewEarnableFigures(preflight(parseExportText(fixture.text, "bedrock-usage.csv")));

const entryFor = (preview, id) => preview.find((entry) => entry.id === id);

/**
 * The families the REAL brief earned for this export, as a set of ids.
 *
 * An export the adapter refuses produces no brief at all, so every family is
 * withheld — which is the honest answer and not an empty result to be skipped.
 */
function briefFamilies(fixture) {
  const parsed = parseExportText(fixture.text, "bedrock-usage.csv");
  const adapted = adaptParsedExport(parsed);
  if (adapted.status !== "projected") return new Set();
  const analysis = normalizeLocalFinopsHistory({ providers: [adapted.parsed] });
  const movement = periodMovement(importedPeriodSeries([adapted.parsed]));
  return new Set(scoreBriefCompleteness(analysis, { movement })
    .slots.filter((slot) => slot.satisfied).map((slot) => slot.id));
}

const previewFamilies = (preview, state) => new Set(preview
  .filter((entry) => entry.state === state).map((entry) => entry.id));

// --- agreement ---------------------------------------------------------------

for (const fixture of FIXTURES) {
  test(`preview and brief agree on ${fixture.name}`, () => {
    const preview = previewOf(fixture);
    const earned = briefFamilies(fixture);
    const earnable = previewFamilies(preview, CAPABILITY_STATE.earnable);
    const withheld = previewFamilies(preview, CAPABILITY_STATE.withheld);

    // Both directions, over the derived sets rather than a written-down brief.
    assert.deepEqual([...earnable].filter((id) => !earned.has(id)), [],
      "the preview called a family earnable that the brief did not earn");
    assert.deepEqual([...withheld].filter((id) => earned.has(id)), [],
      "the preview called a family withheld that the brief earned");
    // And the preview covers every family the brief scores, in both states.
    assert.equal(earnable.size + withheld.size, FAMILY_ORDER.length);
  });
}

// --- the fixture the issue names explicitly ----------------------------------

test("single-period billing-only: movement and the department figures are withheld, each on a named input",
  () => {
    const preview = previewOf(FIXTURE_SINGLE_PERIOD_BILLING_ONLY);
    assert.equal(capabilityCounts(preview).earnable, 0);

    // The movement AND the three department families, each asserted on the
    // string a reader is shown rather than on the state alone. It is the same
    // string for all four here, and that is the finding: an export with no unit
    // or tag label column is not a recognized export missing one figure's input,
    // it is a file no console contract claims, so every figure is waiting on the
    // export itself. Telling this reader to go and fetch a second billing period
    // would send them after something that unlocks nothing.
    for (const id of ["trend_movement", "top_department", "rank_1_action", "drill_down"]) {
      const family = entryFor(preview, id);
      assert.equal(family.state, CAPABILITY_STATE.withheld, `${id} should be withheld`);
      assert.equal(family.missingInput, INPUT_NAMES.unrecognized);
    }
    assert.equal(entryFor(preview, "recoverable_spend").missingInput, INPUT_NAMES.unrecognized);
  });

test("a labelled single-period export withholds the movement alone, and names its own input", () => {
  const preview = previewOf(FIXTURE_SINGLE_PERIOD_LABELLED);
  const movement = entryFor(preview, "trend_movement");
  assert.equal(movement.state, CAPABILITY_STATE.withheld);
  assert.equal(movement.missingInput, "a second billing period");
  assert.deepEqual(capabilityCounts(preview), { earnable: FAMILY_ORDER.length - 1, withheld: 1 });
});

// --- ordering ----------------------------------------------------------------

test("the input that unlocks the most withheld figures is ranked first", () => {
  // Two different missing inputs are in play here: the currency column, which
  // this export is recognized without and cannot be projected without (six
  // families), and a second billing period (one). The rule is defended rather
  // than incidental — the currency column must lead whatever order the families
  // were declared in, and the movement must not lead merely because a
  // family-specific input reads more specific.
  const preview = previewOf(FIXTURE_SINGLE_PERIOD_NO_CURRENCY);
  const withheld = preview.filter((entry) => entry.state === CAPABILITY_STATE.withheld);
  const inputs = withheld.map((entry) => entry.missingInputId);
  assert.equal(inputs.filter((id) => id === CAPABILITY_INPUTS.analyzable).length, 6);
  assert.equal(inputs.filter((id) => id === CAPABILITY_INPUTS.secondPeriod).length, 1);
  assert.equal(inputs[0], CAPABILITY_INPUTS.analyzable);
  assert.equal(withheld[0].missingInput, ROLE_INPUT_NAMES[FIELD_ROLES.CURRENCY]);
  // The second-period entry is behind all six, not merely after the first.
  assert.ok(inputs.lastIndexOf(CAPABILITY_INPUTS.analyzable)
    < inputs.indexOf(CAPABILITY_INPUTS.secondPeriod));

  // Ties break on the brief's declared family order, so equal-unlock families
  // always come out the same way for the same export.
  const tied = withheld
    .filter((entry) => entry.missingInputId === CAPABILITY_INPUTS.analyzable)
    .map((entry) => entry.id);
  assert.deepEqual(tied, [...tied].sort(
    (left, right) => FAMILY_ORDER.indexOf(left) - FAMILY_ORDER.indexOf(right)));
});

test("earnable families are listed before withheld ones, in the brief's own order", () => {
  const preview = previewOf(FIXTURE_SINGLE_PERIOD_LABELLED);
  const states = preview.map((entry) => entry.state);
  assert.equal(states.lastIndexOf(CAPABILITY_STATE.earnable),
    states.indexOf(CAPABILITY_STATE.withheld) - 1);
  const earnable = preview
    .filter((entry) => entry.state === CAPABILITY_STATE.earnable).map((entry) => entry.id);
  assert.deepEqual(earnable, [...earnable].sort(
    (left, right) => FAMILY_ORDER.indexOf(left) - FAMILY_ORDER.indexOf(right)));
});

// --- the other exports, on their own terms -----------------------------------

test("the complete export earns every family, and names nothing missing", () => {
  const preview = previewOf(FIXTURE_COMPLETE);
  assert.deepEqual(capabilityCounts(preview), { earnable: FAMILY_ORDER.length, withheld: 0 });
  assert.deepEqual(preview.map((entry) => entry.missingInput), preview.map(() => ""));
});

test("a second month does not unlock the movement while the export cannot analyze", () => {
  // Two months are in this file and it still earns nothing. The point of the
  // fixture is that the movement is NOT reported earnable off its own month
  // count: an input met inside a file nothing can read is not an input met.
  const preview = previewOf(FIXTURE_MULTI_PERIOD_UNLABELLED);
  assert.equal(capabilityCounts(preview).earnable, 0);
  assert.equal(entryFor(preview, "trend_movement").missingInput, INPUT_NAMES.unrecognized);
});

test("the label column is a recognition signature, not a per-figure input", () => {
  // The finding this module's shape rests on, pinned so a later contract change
  // that makes the column merely required shows up here as a red test rather
  // than as a preview quietly naming the wrong errand.
  const verdict = preflight(
    parseExportText(FIXTURE_SINGLE_PERIOD_BILLING_ONLY.text, "a.csv"));
  assert.equal(verdict.provider, null);
  assert.deepEqual([...verdict.missingRoles], []);
  // And the role's plain-language name is published for the day it can happen.
  assert.equal(ROLE_INPUT_NAMES[FIELD_ROLES.SCOPE], "a department or unit label column");
});

test("a file no published contract claims is waiting on the export, not on a column", () => {
  const ledger = csv(["posting_date", "gl_account", "amount"],
    [["2026-07-20", "6100-software", "482.10"]]);
  const preview = previewEarnableFigures(preflight(parseExportText(ledger, "ledger.csv")));
  assert.equal(capabilityCounts(preview).earnable, 0);
  // Not "a second billing period": a spreadsheet no console published has no
  // billing period to be short of, and sending a reader to fetch one is worse
  // than saying nothing.
  for (const entry of preview) assert.equal(entry.missingInput, INPUT_NAMES.unrecognized);
});

test("a null verdict is every family withheld rather than a throw", () => {
  const preview = previewEarnableFigures(null);
  assert.equal(preview.length, FAMILY_ORDER.length);
  assert.equal(capabilityCounts(preview).withheld, FAMILY_ORDER.length);
});

// --- the preview reads the brief's families, and adds no score ---------------

test("the families and their labels are the brief's own", () => {
  const brief = scoreBriefCompleteness(null);
  assert.deepEqual([...FAMILY_ORDER], brief.slots.map((slot) => slot.id));
  const preview = previewOf(FIXTURE_COMPLETE);
  for (const slot of brief.slots) {
    assert.equal(entryFor(preview, slot.id).label, slot.label);
  }
});

test("no preview record carries a weight, a total, a tier or a grade", () => {
  const preview = previewOf(FIXTURE_SINGLE_PERIOD_LABELLED);
  for (const entry of preview) {
    assert.deepEqual(Object.keys(entry).sort(),
      ["id", "label", "missingInput", "missingInputId", "state"]);
  }
});

// --- the verdict fields the preview reads ------------------------------------

test("preflight states the billing months, not just the dated days", () => {
  const oneMonth = preflight(parseExportText(FIXTURE_SINGLE_PERIOD_LABELLED.text, "a.csv"));
  assert.equal(oneMonth.periodCount, 3);
  assert.equal(oneMonth.monthCount, 1);
  const twoMonths = preflight(parseExportText(FIXTURE_COMPLETE.text, "a.csv"));
  assert.equal(twoMonths.periodCount, 5);
  assert.equal(twoMonths.monthCount, 2);
});

test("preflight names the role of the one column it already named", () => {
  const verdict = preflight(
    parseExportText(FIXTURE_SINGLE_PERIOD_NO_CURRENCY.text, "a.csv"));
  assert.equal(verdict.namedColumn, "lineItem/CurrencyCode");
  assert.equal(verdict.namedColumnRole, FIELD_ROLES.CURRENCY);
  assert.deepEqual([...verdict.missingRoles], [FIELD_ROLES.CURRENCY]);
});
