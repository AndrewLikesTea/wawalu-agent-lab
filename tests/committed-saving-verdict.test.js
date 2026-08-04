// Scoring a stored commitment against the movement the period series measured.
//
// What is pinned here is the rubric, not an object shape:
//
//   1. FOUR GRADES, EXHAUSTIVE AND NON-OVERLAPPING. Every delta lands in exactly
//      one band, and each boundary is asserted on both sides so a figure exactly
//      on a line lands where the band's own `boundary` sentence says it does.
//   2. EVIDENCE BEATS ARITHMETIC. Every abstention precondition is asserted with
//      a fixture that WOULD have graded `met` had it been checked second.
//   3. THE FIGURES ARE TRACEABLE. Provenance names the two periods, the
//      commitment, and for each figure whether it was supplied or derived.
//   4. THE SAME INPUTS GIVE THE SAME VERDICT — scored twice, and shuffled.
//
// Fixtures are built in-test from one labelled table rather than committed as
// JSON: the whole grid is nine follow-up months against one commitment, and a
// checked-in file would only hide which number moves the grade.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { FINOPS_WORKSPACE_KEY, FINOPS_WORKSPACE_VERSION } from "../src/finops-workspace-contract.js";
import {
  ABSTENTION_REASON,
  COMMITTED_SAVING_VERDICT_VERSION,
  MET_BAND_PERCENT,
  MISSED_FLOOR_PERCENT,
  VERDICT_BANDS,
  VERDICT_GRADE,
  gradeFor,
  scoreCommittedSaving,
} from "../src/committed-saving-verdict.js";

/* --------------------------------- fixtures -------------------------------- */

/** The commitment under test: $1,000.00 a month, committed from 2026-06. */
const COMMITTED_MINOR = 100_000;

/** Spend in the committed month, in minor units. Movement is measured from it. */
const COMMITTED_MONTH_MINOR = 5_000_000;

function commitment(overrides = {}) {
  return {
    schemaVersion: "shiplog-finops-commitment/1.0.0",
    commitmentId: "finops-commitment-atlas-vendor-large",
    claim: {
      baselineMonthlyCostMinor: COMMITTED_MONTH_MINOR,
      projectedMonthlyCostMinor: COMMITTED_MONTH_MINOR - COMMITTED_MINOR,
      monthlySavingsMinor: COMMITTED_MINOR,
      currency: "USD",
      unit: "usd_minor",
      period: "2026-06",
    },
    confidence: { percent: 80, band: "high" },
    provenance: { designation: "imported", analysisPeriod: "2026-06", recordCount: 2 },
    recommendedAction: {
      workloadId: "atlas-vendor-large",
      departmentId: "atlas-platform",
      fromModelId: "vendor-large-2026",
      toModelId: "standard-tier-reference",
    },
    recordedAt: "2026-07-02T09:00:00.000Z",
    status: "recorded",
    decisionId: null,
    periodId: "user:2026-06",
    ...overrides,
  };
}

/**
 * A three-month series whose follow-up month realizes exactly `realizedMinor`.
 * Stating the fixture in terms of the realized figure is what keeps the table
 * below readable: the dollar total is arithmetic, the realized figure is the
 * case.
 */
function series(realizedMinor, { followUp = "2026-07" } = {}) {
  return [
    { period: "2026-05", total: 51_000 },
    { period: "2026-06", total: COMMITTED_MONTH_MINOR / 100 },
    { period: followUp, total: (COMMITTED_MONTH_MINOR - realizedMinor) / 100 },
  ];
}

const score = (realizedMinor, options = {}) => scoreCommittedSaving({
  series: series(realizedMinor, options),
  commitment: commitment(options.commitment ?? {}),
  followUpPeriod: options.followUpPeriod ?? "2026-07",
  seriesScope: "seriesScope" in options ? options.seriesScope : "user",
});

/* --------------------------------- the rubric ------------------------------ */

test("the bands are exhaustive, non-overlapping, and each states its assumption", () => {
  assert.deepEqual(VERDICT_BANDS.map((band) => band.grade),
    [VERDICT_GRADE.met, VERDICT_GRADE.partiallyMet, VERDICT_GRADE.missed]);
  for (const band of VERDICT_BANDS) {
    assert.ok(band.assumption.length > 80, `${band.grade} states no assumption`);
    assert.match(band.boundary, /inclusive|exclusive/i);
  }
  // The bands meet at the two stated percentages and share no interior point.
  assert.equal(VERDICT_BANDS[0].fromPercent, MET_BAND_PERCENT);
  assert.equal(VERDICT_BANDS[1].toPercent, MET_BAND_PERCENT);
  assert.equal(VERDICT_BANDS[1].fromPercent, MISSED_FLOOR_PERCENT);
  assert.equal(VERDICT_BANDS[2].toPercent, MISSED_FLOOR_PERCENT);
  assert.ok(MISSED_FLOOR_PERCENT < MET_BAND_PERCENT);

  // And every delta a series can produce maps to exactly one grade.
  const grades = new Set();
  for (let percent = -50; percent <= 200; percent += 1) {
    grades.add(gradeFor(Math.round((COMMITTED_MINOR * percent) / 100), COMMITTED_MINOR));
  }
  assert.deepEqual([...grades].sort(),
    [VERDICT_GRADE.met, VERDICT_GRADE.missed, VERDICT_GRADE.partiallyMet]);
});

/* --------------------------- one fixture per grade ------------------------- */

const LABELLED = [
  ["met, favourable side: the month beat the commitment by a tenth", 110_000, VERDICT_GRADE.met],
  ["met, unfavourable side: four points short, inside the 5-point band", 96_000, VERDICT_GRADE.met],
  ["partially met: directionally right, well short of the band", 60_000, VERDICT_GRADE.partiallyMet],
  ["missed: a tenth of the committed saving, below the floor", 10_000, VERDICT_GRADE.missed],
  ["missed: the month did not move at all", 0, VERDICT_GRADE.missed],
  ["missed, wrong direction: spend rose by twice the commitment", -200_000, VERDICT_GRADE.missed],
];

for (const [label, realizedMinor, grade] of LABELLED) {
  test(`grade — ${label}`, () => {
    const verdict = score(realizedMinor);
    assert.equal(verdict.grade, grade, verdict.explanation);
    assert.equal(verdict.realizedSavingMinor, realizedMinor);
    assert.equal(verdict.committedSavingMinor, COMMITTED_MINOR);
    assert.equal(verdict.deltaMinor, realizedMinor - COMMITTED_MINOR);
    assert.equal(verdict.realizedSavingUsd, realizedMinor / 100);
    assert.equal(verdict.relativeDeltaPercent,
      Math.round(((realizedMinor - COMMITTED_MINOR) * 100) / COMMITTED_MINOR));
    assert.deepEqual(verdict.reasons, []);
    // The explanation names both months, both figures, and the rule applied.
    assert.match(verdict.explanation, /2026-06/);
    assert.match(verdict.explanation, /2026-07/);
    assert.match(verdict.explanation, /1,000 USD monthly saving/);
    assert.equal(verdict.explanation.includes(verdict.gradeRule), true);
  });
}

test("wrong-direction movement is a missed commitment, never a saving of zero", () => {
  const verdict = score(-200_000);
  assert.equal(verdict.realizedSavingMinor, -200_000);
  assert.match(verdict.explanation, /rose 2,000 USD/);
});

/* ------------------------------ the boundaries ----------------------------- */

test("a figure exactly on a band edge lands on the documented side", () => {
  // 95% exactly: the met band is inclusive at its floor.
  assert.equal(score(95_000).grade, VERDICT_GRADE.met);
  // One cent below it is not met. Both sides of the same line, asserted.
  assert.equal(score(94_999).grade, VERDICT_GRADE.partiallyMet);
  // 25% exactly: the missed floor is inclusive at its ceiling.
  assert.equal(score(25_000).grade, VERDICT_GRADE.missed);
  assert.equal(score(25_001).grade, VERDICT_GRADE.partiallyMet);
});

test("the grade is decided on integers, so a rounded percent cannot move it", () => {
  // 94,999 minor rounds to 95% for display and is still not in the met band.
  const verdict = score(94_999);
  assert.equal(verdict.realizedPercentOfCommitted, 95);
  assert.equal(verdict.grade, VERDICT_GRADE.partiallyMet);
});

/* ------------------------------- abstentions ------------------------------- */

test("abstention — the follow-up period is absent from the series", () => {
  const verdict = scoreCommittedSaving({
    series: [{ period: "2026-05", total: 51_000 }, { period: "2026-06", total: 50_000 }],
    commitment: commitment(),
    followUpPeriod: "2026-07",
    seriesScope: "user",
  });
  assert.equal(verdict.grade, VERDICT_GRADE.notEnoughEvidence);
  assert.deepEqual(verdict.reasons, [ABSTENTION_REASON.followUpPeriodMissing]);
  assert.match(verdict.explanation, /follow_up_period_missing/);
  assert.match(verdict.explanation, /2026-05, 2026-06/);
  assert.equal(verdict.realizedSavingMinor, null);
  // The committed figure survives: it is what the reader committed to.
  assert.equal(verdict.committedSavingMinor, COMMITTED_MINOR);
});

test("abstention — the gap is not the expected one-period step, in either direction", () => {
  const cases = [
    ["too long: a month was skipped", "2026-08"],
    ["too short: the follow-up is the committed month itself", "2026-06"],
    ["backwards: the follow-up precedes the commitment", "2026-05"],
  ];
  for (const [label, followUp] of cases) {
    const verdict = scoreCommittedSaving({
      series: [...series(110_000), { period: "2026-08", total: 48_900 }],
      commitment: commitment(),
      followUpPeriod: followUp,
      seriesScope: "user",
    });
    assert.equal(verdict.grade, VERDICT_GRADE.notEnoughEvidence, label);
    assert.deepEqual(verdict.reasons, [ABSTENTION_REASON.periodGapNotOneStep], label);
    assert.match(verdict.explanation, /period_gap_not_one_step/);
    assert.equal(verdict.provenance.comparedPeriods.expectedFollowUp, "2026-07");
  }
});

test("abstention — the series was read under a different scope than the commitment", () => {
  const verdict = score(110_000, { seriesScope: "example" });
  assert.equal(verdict.grade, VERDICT_GRADE.notEnoughEvidence);
  assert.deepEqual(verdict.reasons, [ABSTENTION_REASON.scopeMismatch]);
  assert.match(verdict.explanation, /scope_mismatch/);
  assert.equal(verdict.provenance.scope.matched, false);
  assert.equal(verdict.provenance.scope.series, "example");
  assert.equal(verdict.provenance.scope.commitment, "user");

  // An unstated scope is not a matching scope either.
  assert.deepEqual(score(110_000, { seriesScope: null }).reasons,
    [ABSTENTION_REASON.scopeMismatch]);
});

test("abstention — a commitment with no readable month or figure is not scored", () => {
  for (const claim of [{ monthlySavingsMinor: 0 }, { period: "not-a-month" }]) {
    const verdict = score(110_000, {
      commitment: { claim: { ...commitment().claim, ...claim } },
    });
    assert.equal(verdict.grade, VERDICT_GRADE.notEnoughEvidence);
    assert.equal(verdict.reasons.includes(ABSTENTION_REASON.commitmentUnreadable), true);
    assert.equal(verdict.committedSavingMinor, null);
  }
});

test("the preconditions beat a numeric grade when both would apply", () => {
  // Every one of these realizes 110% of the commitment: graded on the figures
  // alone, each would be `met`. None of them is graded at all.
  const wouldBeMet = [
    ["scope", { seriesScope: "example" }],
    ["gap", { followUp: "2026-08", followUpPeriod: "2026-08" }],
    ["committed month absent", { commitment: { claim: { ...commitment().claim, period: "2026-09" } } }],
  ];
  for (const [label, options] of wouldBeMet) {
    const verdict = score(110_000, options);
    assert.equal(verdict.grade, VERDICT_GRADE.notEnoughEvidence, label);
    assert.equal(verdict.realizedSavingMinor, null, label);
    assert.equal(verdict.deltaMinor, null, label);
    assert.ok(verdict.reasons.length > 0, label);
  }
});

test("every abstention reason that fired is named, in the stated order", () => {
  const verdict = scoreCommittedSaving({
    series: [{ period: "2026-05", total: 51_000 }],
    commitment: commitment({ periodId: "example:2026-06" }),
    followUpPeriod: "2026-09",
    seriesScope: "user",
  });
  assert.deepEqual(verdict.reasons, [
    ABSTENTION_REASON.scopeMismatch,
    ABSTENTION_REASON.periodGapNotOneStep,
    ABSTENTION_REASON.committedPeriodMissing,
    ABSTENTION_REASON.followUpPeriodMissing,
  ]);
  for (const reason of verdict.reasons) assert.match(verdict.explanation, new RegExp(reason));
});

/* -------------------------------- provenance ------------------------------- */

test("provenance names the periods, the commitment, and what each figure is", () => {
  const { provenance, schemaVersion } = score(110_000);
  assert.equal(schemaVersion, COMMITTED_SAVING_VERDICT_VERSION);
  assert.equal(provenance.commitmentId, "finops-commitment-atlas-vendor-large");
  assert.deepEqual(provenance.comparedPeriods,
    { committedFrom: "2026-06", followUp: "2026-07", expectedFollowUp: "2026-07", claimedFollowUp: "2026-07" });
  assert.deepEqual(provenance.seriesPeriods, ["2026-05", "2026-06", "2026-07"]);
  assert.equal(provenance.scope.matched, true);
  assert.deepEqual(provenance.missing, []);

  const supplied = provenance.figures.filter((figure) => figure.origin === "supplied");
  const derived = provenance.figures.filter((figure) => figure.origin === "derived");
  assert.deepEqual(supplied.map((figure) => figure.name),
    ["committedSavingMinor", "committedPeriodSpendMinor", "followUpPeriodSpendMinor"]);
  // A supplied figure says where it was read from; a derived one says what from.
  assert.equal(supplied[0].source, "commitment.claim.monthlySavingsMinor");
  assert.equal(supplied[1].source, "series[2026-06].total");
  assert.deepEqual(derived.map((figure) => figure.name),
    ["realizedSavingMinor", "deltaMinor", "relativeDeltaPercent"]);
  assert.deepEqual(derived[0].derivedFrom,
    ["committedPeriodSpendMinor", "followUpPeriodSpendMinor"]);
  assert.deepEqual(derived[1].derivedFrom, ["realizedSavingMinor", "committedSavingMinor"]);
  for (const figure of derived) assert.ok(figure.rule.length > 10, figure.name);
});

test("an abstention carries provenance too: what was found, and what was missing", () => {
  const verdict = scoreCommittedSaving({
    series: [{ period: "2026-06", total: 50_000 }],
    commitment: commitment(),
    followUpPeriod: "2026-07",
    seriesScope: "user",
  });
  const { provenance } = verdict;
  assert.deepEqual(provenance.missing, [ABSTENTION_REASON.followUpPeriodMissing]);
  assert.deepEqual(provenance.seriesPeriods, ["2026-06"]);
  assert.equal(provenance.comparedPeriods.committedFrom, "2026-06");
  assert.equal(provenance.comparedPeriods.followUp, null);
  // The evidence that WAS found is still named, and nothing was derived from it.
  assert.deepEqual(provenance.figures.map((figure) => figure.name),
    ["committedSavingMinor", "committedPeriodSpendMinor"]);
  assert.equal(provenance.figures.every((figure) => figure.origin === "supplied"), true);
});

/* ------------------------------- determinism ------------------------------- */

test("the same fixture scores to a deeply-equal verdict, twice and shuffled", () => {
  assert.deepEqual(score(60_000), score(60_000));

  const ordered = scoreCommittedSaving({
    series: series(60_000), commitment: commitment(),
    followUpPeriod: "2026-07", seriesScope: "user",
  });
  const shuffled = scoreCommittedSaving({
    series: [...series(60_000)].reverse(), commitment: commitment(),
    followUpPeriod: "2026-07", seriesScope: "user",
  });
  assert.deepEqual(shuffled, ordered);
  // And a repeated month sums, exactly as the series module already keys it.
  assert.equal(Object.isFrozen(ordered), true);
});

test("the scorer reads no clock, no storage, no network, and writes no markup", async () => {
  const source = await (await import("node:fs/promises"))
    .readFile(new URL("../src/committed-saving-verdict.js", import.meta.url), "utf8");
  for (const forbidden of [
    "new Date", "Date.now", "Math.random", "fetch(", "localStorage", "document.", "innerHTML",
    "globalThis",
  ]) {
    assert.equal(source.includes(forbidden), false,
      `the scorer must not reference ${forbidden}: a verdict is reproducible or it is nothing`);
  }
});

/* ------------------------------- on the page ------------------------------- */

const PAGE = new URL("../src/savings-commitment.html", import.meta.url);
const FIXTURE_URL = new URL("../src/savings-commitment-fixture.json", import.meta.url);

/** One retained period, in the shape this browser's workspace stores. */
function retainedPeriod(month, analyzedMinor, dataset = "user") {
  return {
    periodId: `${dataset}:${month}`,
    period: month,
    dataset,
    briefingContractVersion: "finops-briefing/1.0.0",
    derivedAt: "2026-08-02T09:00:00.000Z",
    sourceFingerprint: `fp-${month}`,
    analyzedSpendMinor: analyzedMinor,
    attributedSpendMinor: analyzedMinor,
    recoverableScenarioMinor: 750_000,
    recordsTotal: 200,
    recordsAnalyzed: 200,
    coverageRatioPpm: 960_000,
    confidence: "high",
    missingInputs: [],
    materialMetricId: "recoverable_scenario",
    materialMetricMinor: 750_000,
    topDepartmentId: "atlas-platform",
  };
}

function workspace(periods) {
  return JSON.stringify({
    schemaVersion: FINOPS_WORKSPACE_VERSION,
    consent: {
      state: "granted",
      decidedAt: "2026-07-01T10:00:00.000Z",
      grantedAgainst: "finops-workspace/1.1.0",
    },
    periods,
    commitments: [commitment()],
    meta: { lastWriteAt: "2026-08-02T10:00:00.000Z" },
  });
}

async function openPage(t, periods) {
  const fixture = JSON.parse(await (await import("node:fs/promises"))
    .readFile(FIXTURE_URL, "utf8"));
  const page = await loadPage(PAGE, {
    storage: { [FINOPS_WORKSPACE_KEY]: workspace(periods) },
    routes: { "/savings-commitment-fixture.json": fixture },
  });
  t.after(() => page.restore());
  await importPageModule("/savings-commitment-page.js");
  const region = page.document.getElementById("commit-verdict");
  await waitFor(() => region.getAttribute("aria-busy") === "false", "the verdict to paint");
  return { document: page.document, region };
}

test("the page grades the stored commitment against the months it kept", async (t) => {
  const { document, region } = await openPage(t, [
    retainedPeriod("2026-06", COMMITTED_MONTH_MINOR),
    retainedPeriod("2026-07", COMMITTED_MONTH_MINOR - 110_000),
  ]);
  const text = textOf(region);
  assert.match(text, /Met/);
  assert.match(text, /\$1,100\.00 realized against \$1,000\.00 committed/);
  assert.match(text, /\+10% realized against the commitment/);
  assert.match(text, /2026-06/);
  assert.match(text, /2026-07/);
  // The grade is announced: the live region is the container, and the grade is
  // not folded into the disclosure below it.
  assert.equal(region.getAttribute("aria-live"), "polite");
  assert.equal(region.querySelectorAll("details").length, 1);
  const [chip] = region.querySelectorAll(".commit-kicker");
  assert.equal(chip.dataset.grade, "met");
  let node = chip;
  while (node && node !== region) {
    assert.notEqual(node.tagName, "DETAILS", "the grade must not sit inside a disclosure");
    node = node.parentNode;
  }
  // Provenance is inspectable on the page: both periods, the commitment id, and
  // the supplied-versus-derived classification of every figure.
  const provenance = textOf(region.querySelector("details"));
  assert.match(provenance, /finops-commitment-atlas-vendor-large/);
  assert.match(provenance, /2026-06 → 2026-07/);
  assert.match(provenance, /committedSavingMinor/);
  assert.match(provenance, /supplied/);
  assert.match(provenance, /realizedSavingMinor/);
  assert.match(provenance, /derived/);
  assert.equal(document.getElementById("commit-verdict-heading").tagName, "H2");
});

test("the page renders not-enough-evidence as an outcome with its reason", async (t) => {
  // The browser kept the committed month and one two months later: the pair on
  // hand is not this commitment's pair, and the page says so rather than
  // printing a zero.
  const { region } = await openPage(t, [
    retainedPeriod("2026-06", COMMITTED_MONTH_MINOR),
    retainedPeriod("2026-08", COMMITTED_MONTH_MINOR - 110_000),
  ]);
  const text = textOf(region);
  assert.match(text, /Not enough evidence/);
  assert.match(text, /period_gap_not_one_step/);
  assert.match(text, /\$1,000\.00 a month committed/);
  assert.doesNotMatch(text, /\$0\.00 realized/);
  assert.equal(region.querySelectorAll(".commit-kicker")[0].dataset.grade, "not_enough_evidence");
  // It takes no rank, because it is the absence of a grade rather than a worse
  // one, and the only figure it has is the committed one.
  assert.match(textOf(region.querySelector(".commit-kicker")),
    /^Not enough evidence not graded · committed figure only, nothing realized$/);
});

test("a browser holding no retained months scores nothing, and says which is missing", async (t) => {
  const { region } = await openPage(t, []);
  const text = textOf(region);
  assert.match(text, /Not enough evidence/);
  assert.match(text, /committed_period_missing/);
  assert.match(text, /follow_up_period_missing/);
  // An empty store has no books to disagree with, so it is not reported as a
  // scope mismatch on top of the months it does not have.
  assert.doesNotMatch(text, /scope_mismatch/);
});

/* --------------- realized, modelled and committed, told apart -------------- */
//
// The one confusion this surface cannot recover from: a modelled ceiling read
// as money that was saved, or a committed promise read as a measurement. The
// distinction is carried in a WORD beside every figure, so it survives a
// monochrome print, a colour vision deficiency, and a screen reader alike.
// These tests assert the word, never the tint.

const GRADED = [
  retainedPeriod("2026-06", COMMITTED_MONTH_MINOR),
  retainedPeriod("2026-07", COMMITTED_MONTH_MINOR - 110_000),
];

/** Every basis chip under a node, as `[data-basis, its text]` pairs. */
const chips = (node) => node.querySelectorAll(".commit-figure-basis")
  .map((chip) => [chip.dataset.basis, textOf(chip)]);

test("every figure on the page names which of the three kinds of figure it is", async (t) => {
  const { document, region } = await openPage(t, GRADED);
  await waitFor(() => document.querySelectorAll(".commit-benchmark-figure").length === 2,
    "the commitment card and the scored verdict");

  // 1. The header summary figure — a projection, said in a word rather than
  //    inferred from the basis sentence four lines below it. It follows the
  //    verdict in the DOM, which is the reading order the page paints.
  const headline = document.querySelectorAll(".commit-benchmark-figure");
  assert.match(textOf(headline[1]), /^\$31,300\.00 a month modelled$/);

  // 2. The verdict's own figures — one qualifier per value, not one sentence
  //    in which the two words happen to appear.
  assert.deepEqual(chips(headline[0]), [
    ["realized", "realized"], ["committed", "committed"], ["realized", "realized"],
  ]);

  // 3. The badge, and the rows behind it. Nothing is left unqualified: every
  //    money and movement figure the page paints carries exactly one of three.
  for (const [basis, words] of chips(document.body)) {
    assert.ok(["realized", "modelled", "committed"].includes(basis), `unknown basis ${basis}`);
    // The qualifier is in the accessible text, not only in a class or an
    // attribute — a class name is read by nobody.
    assert.ok(words.includes(basis), `"${words}" does not say ${basis} in its own text`);
  }
  // The supporting rows are qualified too: the two supplied month totals and the
  // derived movement are measurements, the commitment's own figure is not.
  const provenance = chips(region.querySelector("details")).map(([basis]) => basis);
  assert.deepEqual(provenance,
    ["committed", "realized", "realized", "realized", "realized", "realized"]);
});

test("the qualifiers are readable, not tabbable, and wrap rather than truncate", async (t) => {
  const { document } = await openPage(t, GRADED);
  for (const chip of document.querySelectorAll(".commit-figure-basis")) {
    // Informational: a badge nobody can operate must not be one more stop
    // between a keyboard reader and the one control on this page.
    assert.equal(chip.tagName, "SPAN");
    assert.equal(chip.getAttribute("tabindex"), null);
    assert.equal(chip.getAttribute("role"), null);
    // …and not hidden from the assistive tree either: readable, not decorative.
    assert.equal(chip.getAttribute("aria-hidden"), null);
    assert.ok(textOf(chip).length > 0);
  }
  const css = await readFile(new URL("../src/savings-commitment.css", import.meta.url), "utf8");
  const rule = /\n\.commit-figure-basis \{([^}]*)\}/.exec(css)[1];
  // Inline, so it wraps under its value at 200% zoom; no fixed column, no
  // truncation, and no rule that would keep it on the value's line.
  assert.match(rule, /display:inline-block/);
  assert.doesNotMatch(rule, /white-space:nowrap|position:absolute|text-overflow|width:/);
  assert.match(/\.commit-kicker\[data-grade\] \{([^}]*)\}/.exec(css)[1], /flex-wrap:wrap/);
});

test("the four grades read in rank order, at AA contrast, without colour", async (t) => {
  // Rank is in the label: "Met" over "Missed" is an order a reader must already
  // know, "grade 1 of 3" is one they can read. The fourth outcome takes no rank
  // because it is the absence of a grade, not a worse one.
  const { region } = await openPage(t, GRADED);
  assert.match(textOf(region.querySelector(".commit-kicker")),
    /^Met grade 1 of 3 · realized against committed$/);

  // Each grade's text against the background it is actually painted on. The
  // ratios are computed from the stylesheet's own values rather than trusted.
  const css = await readFile(new URL("../src/savings-commitment.css", import.meta.url), "utf8");
  const paint = (grade) => {
    const rule = new RegExp(`\\.commit-kicker\\[data-grade="${grade}"\\] \\{([^}]*)\\}`).exec(css)[1];
    const value = (name) => /var\(--commit-mint\)|#[0-9a-f]{6}/
      .exec(new RegExp(`${name}:([^;]+);`).exec(rule)[1])[0].replace("var(--commit-mint)", "#dff4ee");
    return { ink: value("color"), background: value("background") };
  };
  const relative = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((total, channel, index) => total + [0.2126, 0.7152, 0.0722][index] * channel, 0);
  const ratio = (a, b) => (Math.max(relative(a), relative(b)) + 0.05)
    / (Math.min(relative(a), relative(b)) + 0.05);

  for (const grade of ["met", "partially_met", "missed", "not_enough_evidence"]) {
    const { ink, background } = paint(grade);
    assert.ok(ratio(ink, background) >= 4.5,
      `${grade} paints ${ink} on ${background}: ${ratio(ink, background).toFixed(2)}:1`);
  }
  // An absent grade is not a failure and is not a warning: it is neutral ink on
  // the neutral surface, and it shares no value with the missed badge.
  const neutral = paint("not_enough_evidence");
  assert.deepEqual(neutral, { ink: "#4d4d47", background: "#f7f6f2" });
  const missed = paint("missed");
  assert.notEqual(neutral.ink, missed.ink);
  assert.notEqual(neutral.background, missed.background);
});

test("the verdict is announced once, by one live region outside every disclosure", async (t) => {
  const { document, region } = await openPage(t, GRADED);
  assert.equal(region.getAttribute("aria-live"), "polite");
  // (a) One region, not two. Nothing inside it announces on its own, so a
  //     repainted grade is spoken once rather than once per nested region.
  assert.equal(region.querySelectorAll("[aria-live]").length, 0);
  assert.equal(region.querySelectorAll("[role]").length, 0);
  // (b) And no ancestor is a collapsed disclosure. The harness reads text
  //     through a shut details element, so this is asserted structurally: a
  //     live region a real browser hides from the accessibility tree announces
  //     nothing, and the test would never notice.
  let node = region.parentNode;
  let regions = 0;
  while (node && typeof node.getAttribute === "function") {
    assert.notEqual(node.tagName, "DETAILS", "the announcement must not sit inside a disclosure");
    assert.equal(node.getAttribute("hidden"), null);
    if (node.getAttribute("aria-live") !== null) regions += 1;
    node = node.parentNode;
  }
  assert.equal(regions, 0, "a second live region above the verdict would announce it twice");
  // The heading before it, and the working after it, keep the reading order:
  // the grade is read before the disclosure that explains it.
  const order = document.querySelectorAll(".commit-benchmark");
  assert.equal(order.length, 2);
  assert.equal(textOf(order[0].querySelector("h3")), "Your stored commitment, scored");
});
