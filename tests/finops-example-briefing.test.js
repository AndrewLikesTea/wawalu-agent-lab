// The hand-off from the bundled AI FinOps example to the executive briefing.
//
// THREE CLAIMS, AND THEY ARE THE WHOLE POINT OF THE FEATURE.
//
//   1. The link is readable both ways. What the CTA writes into the address bar
//      is what the briefing page reads back out of it, and nothing else pins the
//      example — a stray parameter, a typo, or a missing search must not put
//      invented figures in front of a reader who asked for their own.
//
//   2. It is the SAME example. The briefing's recoverable share and its
//      scenario figure are re-derived from the bundled dataset through the same
//      contract the landing brief uses, so the two surfaces cannot quote
//      different numbers under the same word "example". This file pins that
//      equality directly, against both composed results.
//
//   3. It is labelled as invented, everywhere it could be mistaken for a
//      measurement, and it says which figures were deliberately left out.
//
// Nothing here is committed as a fixture: every period is derived in the test
// from the shipped dataset, exactly as the page derives it.

import test from "node:test";
import assert from "node:assert/strict";
import {
  EXAMPLE_BRIEFING_CTA, EXAMPLE_BRIEFING_DATASET, EXAMPLE_BRIEFING_HREF,
  EXAMPLE_BRIEFING_MONTHS, EXAMPLE_BRIEFING_NOTICE, EXAMPLE_BRIEFING_ORIGIN,
  EXAMPLE_BRIEFING_PROVENANCE_NOTE, EXAMPLE_BRIEFING_SYNTHETIC, EXAMPLE_CONTEXT_PARAM,
  EXAMPLE_CONTEXT_VALUE, EXAMPLE_RETURN_HREF, exampleBriefingPeriods, readExampleContext,
} from "../src/finops-example-briefing.js";
import { buildFirstRunResult, SAMPLE_LABEL } from "../src/finops-first-run.js";
import {
  buildExecutiveBriefing, validateExecutiveBriefing,
} from "../src/executive-finops-briefing.js";
import { FINOPS_PERIOD_FIELDS } from "../src/finops-workspace-contract.js";

// Labelled fixture for the executive claims a prospect can repeat. These are
// intentionally exact: a changed number must be reviewed as a changed result,
// not waved through because the new arithmetic remains internally consistent.
// Confidence has no blended weight: the contract takes the weakest applicable
// evidence level, and the synthetic-dataset rule caps an otherwise high-coverage
// result at low because an invented company cannot evidence a buyer's decision.
const EXPECTED_BUNDLED_DECISION = Object.freeze({
  reportingPeriod: "2026-06",
  analyzedSpendMinor: 15_450_000,
  recoverableScenarioMinor: 5_125_400,
  recoverableSharePpm: 331_741,
  baselineSharePpm: 310_477,
  benchmarkStanding: "more_recoverable_than_baseline",
  priorPeriods: Object.freeze(["2026-04", "2026-05"]),
  action: "pilot_routing",
  accountableRole: "Platform Engineering Lead",
  periodConfidence: "high",
  displayedConfidence: "low",
  confidenceCeilingReason: "dataset_is_not_your_import",
});

/* ------------------------------- the link --------------------------------- */

test("the CTA's href is the parameter the briefing page reads back", () => {
  assert.equal(EXAMPLE_BRIEFING_HREF,
    `/executive-briefing.html?${EXAMPLE_CONTEXT_PARAM}=${EXAMPLE_CONTEXT_VALUE}`);
  const search = EXAMPLE_BRIEFING_HREF.slice(EXAMPLE_BRIEFING_HREF.indexOf("?"));
  assert.equal(readExampleContext(search).pinned, true);
  // And from a location-shaped object, which is what the page actually hands it.
  assert.equal(readExampleContext({ search }).pinned, true);
  assert.equal(readExampleContext(new URLSearchParams(search.slice(1))).pinned, true);
});

test("nothing but the declared value pins the example", () => {
  const cases = [
    undefined, null, "", "?", "?other=1", "?example=", "?example=user",
    "?example=ai-finops-bundled-x", { search: "" }, { search: "?example=sample" }, 42,
  ];
  for (const value of cases) {
    assert.equal(readExampleContext(value).pinned, false,
      `${JSON.stringify(value)} must not pin the example`);
  }
  // A reader who asked for something this build does not know still gets their
  // own briefing, and the unread value travels so the page could say so.
  assert.equal(readExampleContext("?example=sample").value, "sample");
});

test("a repeated parameter takes the first value rather than guessing", () => {
  const read = readExampleContext(`?${EXAMPLE_CONTEXT_PARAM}=${EXAMPLE_CONTEXT_VALUE}`
    + `&${EXAMPLE_CONTEXT_PARAM}=user`);
  assert.equal(read.pinned, true);
  assert.equal(read.value, EXAMPLE_CONTEXT_VALUE);
});

test("the return link points at the region the CTA is authored in", () => {
  assert.equal(EXAMPLE_RETURN_HREF, "/evolution.html#finops-first-run");
  assert.equal(EXAMPLE_BRIEFING_NOTICE.returnHref, EXAMPLE_RETURN_HREF);
});

/* ------------------------------ the periods -------------------------------- */

test("the derivation produces gapless, contract-shaped example periods", () => {
  const periods = exampleBriefingPeriods();
  assert.equal(periods.length, EXAMPLE_BRIEFING_MONTHS);

  for (const period of periods) {
    // Nothing outside the retained-period contract's own field list: these
    // records are handed to the same builder a stored workspace period is.
    for (const field of Object.keys(period)) {
      assert.ok(FINOPS_PERIOD_FIELDS.includes(field), `${field} is not a retained-period field`);
    }
    assert.equal(period.dataset, EXAMPLE_BRIEFING_DATASET);
    assert.equal(period.periodId, `${EXAMPLE_BRIEFING_DATASET}:${period.period}`);
    assert.ok(period.analyzedSpendMinor > 0);
    assert.ok(period.recoverableScenarioMinor > 0);
  }

  // Consecutive calendar months, oldest first — a trailing baseline over a gap
  // is a comparison of two different things.
  const months = periods.map((period) => period.period);
  assert.deepEqual(months, [...months].sort());
  for (let index = 1; index < months.length; index += 1) {
    const previous = new Date(`${months[index - 1]}-01T00:00:00Z`);
    previous.setUTCMonth(previous.getUTCMonth() + 1);
    assert.equal(months[index], previous.toISOString().slice(0, 7),
      `${months[index - 1]} and ${months[index]} are not consecutive`);
  }
});

test("the same dataset produces the same periods on every call — no clock, no random", () => {
  assert.deepEqual(exampleBriefingPeriods(), exampleBriefingPeriods());
  for (const period of exampleBriefingPeriods()) {
    // `derivedAt` is the period's own window close, not the moment the page ran.
    assert.match(period.derivedAt, /^\d{4}-\d{2}-\d{2}T09:00:00\.000Z$/);
    assert.ok(period.derivedAt.startsWith(nextMonth(period.period)),
      `${period.period} was stamped ${period.derivedAt} rather than at its window close`);
  }
});

function nextMonth(month) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return date.toISOString().slice(0, 10);
}

/* ------------------------- the same example, twice -------------------------- */

test("the briefing quotes the landing brief's own recoverable share and scenario", () => {
  const briefing = buildExecutiveBriefing(exampleBriefingPeriods());
  assert.equal(validateExecutiveBriefing(briefing).valid, true);

  const first = buildFirstRunResult();
  assert.equal(first.presentation.state, "ready");

  // The share, to the whole percent the landing brief prints.
  const briefedShare = Math.round(briefing.recoverable.sharePpm / 10_000);
  assert.equal(`${briefedShare}% of analyzed AI spend`, first.benchmark.value);

  // And the scenario figure, to the dollar.
  const briefedUsd = briefing.recoverable.valueMinor / 100;
  assert.match(first.impact.value, /^\$[\d,]+ in the reporting period$/);
  assert.equal(first.impact.value,
    `${new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD", maximumFractionDigits: 0,
    }).format(briefedUsd)} in the reporting period`);

  // Same reporting month, so the two sheets are not a period apart.
  assert.ok(first.benchmark.detail.includes(`${briefing.reportingPeriod.period}-01`),
    `the landing brief's window (${first.benchmark.detail}) is not `
    + `${briefing.reportingPeriod.period}`);
});

test("the labelled bundled decision reproduces every executive claim exactly", () => {
  const briefing = buildExecutiveBriefing(exampleBriefingPeriods());
  assert.deepEqual({
    reportingPeriod: briefing.reportingPeriod.period,
    analyzedSpendMinor: briefing.recoverable.analyzedSpendMinor,
    recoverableScenarioMinor: briefing.recoverable.valueMinor,
    recoverableSharePpm: briefing.recoverable.sharePpm,
    baselineSharePpm: briefing.benchmark.baselineSharePpm,
    benchmarkStanding: briefing.benchmark.standing,
    priorPeriods: briefing.benchmark.priorPeriods,
    action: briefing.nextAction.id,
    accountableRole: briefing.nextAction.accountableRole,
    periodConfidence: briefing.confidence.periodConfidence,
    displayedConfidence: briefing.confidence.level,
    confidenceCeilingReason: briefing.confidence.ceilingReason,
  }, EXPECTED_BUNDLED_DECISION);
  assert.match(briefing.confidence.rule[0], /weakest/i);
});

test("the sheet carries the contract's own example caveats rather than new wording", () => {
  const briefing = buildExecutiveBriefing(exampleBriefingPeriods());
  // The dataset is not the reader's import, so the contract lowers its own
  // ceiling and adds its own limitation. Neither is written by this feature.
  assert.equal(briefing.confidence.ceiling, "low");
  assert.equal(briefing.confidence.ceilingReason, "dataset_is_not_your_import");
  const codes = briefing.limitations.map((limitation) => limitation.code);
  assert.ok(codes.includes("example_dataset"));
  assert.ok(codes.includes("scenario_not_realized_saving"));
  // A benchmark that is the example's own trailing history, never a peer cohort.
  assert.equal(briefing.benchmark.kind, "own_trailing_baseline");
  assert.equal(briefing.benchmark.priorPeriodCount, EXAMPLE_BRIEFING_MONTHS - 1);
});

/* ------------------------------ the labelling ------------------------------- */

test("the hand-off says invented, and says it in the landing brief's own words", () => {
  assert.equal(EXAMPLE_BRIEFING_SYNTHETIC.label, SAMPLE_LABEL.badge);
  assert.equal(EXAMPLE_BRIEFING_SYNTHETIC.disclosure, SAMPLE_LABEL.statement);
  assert.match(EXAMPLE_BRIEFING_SYNTHETIC.disclosure, /not your spend/);

  assert.match(EXAMPLE_BRIEFING_ORIGIN, /invented/i);
  assert.match(EXAMPLE_BRIEFING_ORIGIN, /[Nn]ot your spend/);
  assert.match(EXAMPLE_BRIEFING_PROVENANCE_NOTE, /No clock, no random value, no network request/);
});

test("the notice states what was left out, not only what is shown", () => {
  assert.equal(EXAMPLE_BRIEFING_NOTICE.code, "ai_finops_bundled_example");
  assert.match(EXAMPLE_BRIEFING_NOTICE.statement, /invented/i);
  assert.match(EXAMPLE_BRIEFING_NOTICE.statement, /not your spend/i);
  assert.match(EXAMPLE_BRIEFING_NOTICE.statement, /not a realized saving/i);
  // The reader's own retained periods were skipped on purpose, and a reader
  // whose browser holds some is entitled to be told that rather than left to
  // wonder whether their months were quietly mixed in.
  assert.match(EXAMPLE_BRIEFING_NOTICE.remedy, /left out/i);
  assert.match(EXAMPLE_BRIEFING_NOTICE.remedy, /without the example link/i);
});

test("the CTA names the destination and whose figures are on the other end", () => {
  assert.match(EXAMPLE_BRIEFING_CTA.label, /executive briefing/i);
  assert.match(EXAMPLE_BRIEFING_CTA.label, /example/i);
  assert.match(EXAMPLE_BRIEFING_CTA.note, /not your spend/i);
  assert.match(EXAMPLE_BRIEFING_CTA.note, /not read, uploaded, or stored|uploaded/i);
  // A heading, so the block has a place in the region's outline rather than
  // being a link floating under the two choices.
  assert.ok(EXAMPLE_BRIEFING_CTA.heading.length > 0);
});
