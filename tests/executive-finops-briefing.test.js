import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import fixture from "../src/executive-finops-briefing-fixture.json" with { type: "json" };
import {
  BENCHMARK_MATERIAL_VARIANCE_PPM, BENCHMARK_STANDING, BRIEFING_QUESTIONS, CONFIDENCE_MEANING,
  DISCLOSURE_LEVELS, EXECUTIVE_ABSENCE_REASON, EXECUTIVE_ABSENCE_STATEMENT,
  EXECUTIVE_BRIEFING_VERSION, FORBIDDEN_LINK_PATTERN, LIMITATION, NEXT_ACTION,
  PRESENTATION_REQUIREMENTS, buildExecutiveBriefing, recoverableSharePpm,
  roundHalfAwayFromZero, validateExecutiveBriefing,
} from "../src/executive-finops-briefing.js";
import { scanRetainedContent } from "../src/finops-workspace.js";

const CANONICAL = fixture.input.retainedPeriods;

/** A retained period, defaulted to the canonical shape so a test states only what it varies. */
function period(overrides = {}) {
  const label = overrides.period ?? "2026-06";
  return {
    periodId: `user:${label}`,
    period: label,
    dataset: "user",
    briefingContractVersion: "finops-briefing/1.0.0",
    derivedAt: "2026-07-02T09:14:00Z",
    sourceFingerprint: "c1daf8d2",
    analyzedSpendMinor: 4_000_000,
    attributedSpendMinor: 3_800_000,
    recoverableScenarioMinor: 480_000,
    recordsTotal: 1600,
    recordsAnalyzed: 1536,
    coverageRatioPpm: 960_000,
    confidence: "high",
    missingInputs: [],
    materialMetricId: "recoverable_scenario",
    materialMetricMinor: 480_000,
    topDepartmentId: "syn-support-triage",
    ...overrides,
  };
}

/** Three gapless periods ending at 2026-06, so the benchmark is eligible by default. */
function history(overrides = {}) {
  return [
    period({ period: "2026-04", derivedAt: "2026-05-02T09:00:00Z" }),
    period({ period: "2026-05", derivedAt: "2026-06-02T09:00:00Z" }),
    period({ period: "2026-06", ...overrides }),
  ];
}

/* --------------------------- the canonical fixture -------------------------- */

test("the canonical fixture is exactly what the contract builds from its own input", () => {
  const built = buildExecutiveBriefing(CANONICAL);
  assert.deepEqual(JSON.parse(JSON.stringify(built)), fixture.briefing);
  assert.equal(built.contractVersion, EXECUTIVE_BRIEFING_VERSION);
});

test("the canonical fixture passes the contract's own validator", () => {
  const verdict = validateExecutiveBriefing(fixture.briefing);
  assert.deepEqual(verdict.violations, []);
  assert.equal(verdict.valid, true);
});

test("the fixture declares it is synthetic and carries no imported material", () => {
  const { metadata } = fixture;
  assert.equal(metadata.synthetic, true);
  assert.equal(metadata.containsImportedRecords, false);
  assert.equal(metadata.containsPrompts, false);
  assert.equal(metadata.containsCustomerData, false);
  assert.equal(metadata.liveProviderReferences, false);
  assert.match(metadata.determinism, /deep-equals/);
});

test("the fixture embeds the print and export requirements verbatim", () => {
  assert.deepEqual(fixture.metadata.presentation, JSON.parse(JSON.stringify(PRESENTATION_REQUIREMENTS)));
  assert.equal(fixture.metadata.presentation.export.shareableLink, false);
  for (const slot of ["limitations", "provenance", "method", "contractVersions"]) {
    assert.ok(fixture.metadata.presentation.print.mustAppearSomewhere.includes(slot));
  }
  for (const slot of ["primaryFinding", "recoverable", "benchmark", "nextAction", "confidence"]) {
    assert.ok(fixture.metadata.presentation.print.firstPageMustContain.includes(slot));
  }
});

/* --------------------------- deterministic selection ------------------------ */

test("exactly one primary finding and exactly one next action are selected", () => {
  const briefing = buildExecutiveBriefing(history());
  assert.equal(typeof briefing.primaryFinding.orgUnitId, "string");
  assert.ok(!Array.isArray(briefing.primaryFinding));
  assert.ok(!Array.isArray(briefing.nextAction));
  assert.equal(briefing.primaryFinding.periodId, briefing.reportingPeriod.periodId);
  assert.equal(briefing.nextAction.id, "pilot_routing");
});

test("input order cannot change the selection", () => {
  const forward = buildExecutiveBriefing(CANONICAL);
  const reversed = buildExecutiveBriefing([...CANONICAL].reverse());
  const rotated = buildExecutiveBriefing([CANONICAL[1], CANONICAL[2], CANONICAL[0]]);
  assert.deepEqual(reversed, forward);
  assert.deepEqual(rotated, forward);
});

test("the newest period wins before any other comparison does", () => {
  const briefing = buildExecutiveBriefing([
    period({ period: "2026-05", recoverableScenarioMinor: 9_000_000, analyzedSpendMinor: 9_500_000 }),
    period({ period: "2026-06", recoverableScenarioMinor: 480_000 }),
  ]);
  assert.equal(briefing.reportingPeriod.period, "2026-06");
  assert.equal(briefing.selection.tieBreakApplied, "period_descending");
});

test("a re-derived month breaks on the larger recoverable scenario", () => {
  const briefing = buildExecutiveBriefing([
    { ...period(), periodId: "user:2026-06#a", recoverableScenarioMinor: 480_000 },
    { ...period(), periodId: "user:2026-06#b", recoverableScenarioMinor: 620_000 },
  ]);
  assert.equal(briefing.reportingPeriod.periodId, "user:2026-06#b");
  assert.equal(briefing.selection.tieBreakApplied, "recoverable_scenario_descending");
});

test("a total tie is decided by periodId ascending, whichever order it arrives in", () => {
  const left = { ...period(), periodId: "user:2026-06#a" };
  const right = { ...period(), periodId: "user:2026-06#b" };
  const forward = buildExecutiveBriefing([left, right]);
  const backward = buildExecutiveBriefing([right, left]);
  assert.equal(forward.reportingPeriod.periodId, "user:2026-06#a");
  assert.deepEqual(backward, forward);
  assert.equal(forward.selection.tieBreakApplied, "period_id_ascending");
});

test("ineligible periods never found a finding", () => {
  const cases = [
    period({ recoverableScenarioMinor: 0 }),
    period({ analyzedSpendMinor: 0 }),
    period({ topDepartmentId: "" }),
    period({ confidence: "insufficient" }),
    period({ absenceReason: "no_attributed_spend" }),
  ];
  for (const entry of cases) {
    const briefing = buildExecutiveBriefing([entry]);
    assert.equal(briefing.primaryFinding, null, JSON.stringify(entry.periodId));
    assert.equal(briefing.absent.primaryFinding.reason, EXECUTIVE_ABSENCE_REASON.noEligiblePeriod);
  }
});

/* ---------------------------- metric semantics ------------------------------ */

test("recoverable share is a rounded integer share of analyzed spend, in ppm", () => {
  assert.equal(recoverableSharePpm(612_000, 4_300_000), 142_326);
  assert.equal(recoverableSharePpm(1, 8), 125_000);
  // Half away from zero, so a rise and a fall of equal magnitude round alike.
  assert.equal(roundHalfAwayFromZero(2.5), 3);
  assert.equal(roundHalfAwayFromZero(-2.5), -3);
  // A share nobody can compute is null, never zero.
  assert.equal(recoverableSharePpm(500, 0), null);
  assert.equal(recoverableSharePpm(500, undefined), null);
});

test("the headline figure is read off the retained record, not recomputed", () => {
  const briefing = buildExecutiveBriefing(CANONICAL);
  const source = CANONICAL.at(-1);
  assert.equal(briefing.recoverable.valueMinor, source.recoverableScenarioMinor);
  assert.equal(briefing.recoverable.analyzedSpendMinor, source.analyzedSpendMinor);
  assert.equal(briefing.recoverable.currency, "USD");
  assert.equal(briefing.recoverable.unit, "usd_minor");
  assert.equal(
    briefing.recoverable.sharePpm,
    recoverableSharePpm(source.recoverableScenarioMinor, source.analyzedSpendMinor),
  );
});

/* --------------------------- benchmark semantics ---------------------------- */

test("the benchmark is the workspace's own trailing baseline", () => {
  const briefing = buildExecutiveBriefing(CANONICAL);
  const priors = CANONICAL.slice(0, 2).map(
    (entry) => recoverableSharePpm(entry.recoverableScenarioMinor, entry.analyzedSpendMinor),
  );
  const baseline = roundHalfAwayFromZero((priors[0] + priors[1]) / 2);
  assert.equal(briefing.benchmark.kind, "own_trailing_baseline");
  assert.equal(briefing.benchmark.baselineSharePpm, baseline);
  assert.equal(briefing.benchmark.varianceSharePpm, briefing.recoverable.sharePpm - baseline);
  assert.deepEqual(briefing.benchmark.priorPeriods, ["2026-04", "2026-05"]);
});

test("standing is in line inside the material band and named outside it", () => {
  const baseline = recoverableSharePpm(480_000, 4_000_000); // 120000 ppm in both priors
  const atBand = Math.round((baseline + BENCHMARK_MATERIAL_VARIANCE_PPM) * 4_000_000 / 1e6);
  const overBand = atBand + 41; // one ppm past the band, in minor units
  const standingFor = (recoverable) => buildExecutiveBriefing(
    history({ recoverableScenarioMinor: recoverable }),
  ).benchmark;

  assert.equal(standingFor(480_000).standing, BENCHMARK_STANDING.inLine);
  assert.equal(standingFor(atBand).varianceSharePpm, BENCHMARK_MATERIAL_VARIANCE_PPM);
  assert.equal(standingFor(atBand).standing, BENCHMARK_STANDING.inLine);
  assert.ok(standingFor(overBand).varianceSharePpm > BENCHMARK_MATERIAL_VARIANCE_PPM);
  assert.equal(standingFor(overBand).standing, BENCHMARK_STANDING.more);
  assert.equal(standingFor(200_000).standing, BENCHMARK_STANDING.less);
});

test("too short a history has no benchmark, and says which", () => {
  const briefing = buildExecutiveBriefing([
    period({ period: "2026-05", derivedAt: "2026-06-02T09:00:00Z" }),
    period({ period: "2026-06" }),
  ]);
  assert.equal(briefing.benchmark.eligible, false);
  assert.equal(briefing.benchmark.reason, "insufficient_history");
  assert.equal(briefing.benchmark.baselineSharePpm, null);
  assert.ok(briefing.limitations.some((entry) => entry.code === LIMITATION.benchmarkUnavailable));
});

test("a gap in the month sequence disqualifies the baseline rather than averaging over it", () => {
  const briefing = buildExecutiveBriefing([
    period({ period: "2026-03", derivedAt: "2026-04-02T09:00:00Z" }),
    period({ period: "2026-05", derivedAt: "2026-06-02T09:00:00Z" }),
    period({ period: "2026-06" }),
  ]);
  assert.equal(briefing.benchmark.eligible, false);
  assert.equal(briefing.benchmark.reason, "period_gap");
});

test("another dataset's periods are excluded from the baseline and the exclusion is stated", () => {
  const briefing = buildExecutiveBriefing([
    ...history(),
    { ...period({ period: "2026-05" }), periodId: "example:2026-05", dataset: "example" },
  ]);
  assert.deepEqual(briefing.benchmark.priorPeriods, ["2026-04", "2026-05"]);
  assert.ok(briefing.provenance.periodIds.every((id) => id.startsWith("user:")));
  assert.ok(briefing.limitations.some((entry) => entry.code === LIMITATION.mixedDatasetHistory));
});

/* --------------------------- confidence semantics --------------------------- */

test("confidence is the weakest of the period's own level and the contract's ceilings", () => {
  const eligible = buildExecutiveBriefing(history());
  assert.equal(eligible.confidence.level, "high");
  assert.equal(eligible.confidence.ceiling, null);
  assert.equal(eligible.confidence.meaning, CONFIDENCE_MEANING.high);

  const noBenchmark = buildExecutiveBriefing([period()]);
  assert.equal(noBenchmark.confidence.level, "moderate");
  assert.equal(noBenchmark.confidence.ceilingReason, "benchmark_ineligible");

  const demo = buildExecutiveBriefing(history().map(
    (entry) => ({ ...entry, dataset: "example", periodId: `example:${entry.period}` }),
  ));
  assert.equal(demo.confidence.level, "low");
  assert.equal(demo.confidence.ceilingReason, "dataset_is_not_your_import");
  assert.ok(demo.limitations.some((entry) => entry.code === LIMITATION.exampleDataset));

  const weakPeriod = buildExecutiveBriefing(history({ confidence: "moderate" }));
  assert.equal(weakPeriod.confidence.level, "moderate");
  assert.equal(weakPeriod.confidence.periodConfidence, "moderate");
});

/* ------------------------------ the next action ----------------------------- */

test("the next action comes from the closed catalog, by precedence", () => {
  assert.deepEqual(NEXT_ACTION.map((action) => action.rank), [1, 2, 3]);

  const thin = buildExecutiveBriefing(history({ attributedSpendMinor: 1_000_000 }));
  assert.equal(thin.nextAction.id, "improve_attribution");
  assert.equal(thin.nextAction.capMinor, null);

  const incomplete = buildExecutiveBriefing(history({ missingInputs: ["provider_completeness"] }));
  assert.equal(incomplete.nextAction.id, "improve_attribution");
  assert.ok(incomplete.limitations.some((entry) => entry.code === LIMITATION.missingInputs));

  const shrinking = buildExecutiveBriefing(history({ recoverableScenarioMinor: 200_000 }));
  assert.equal(shrinking.benchmark.standing, BENCHMARK_STANDING.less);
  assert.equal(shrinking.nextAction.id, "verify_prior_change");

  const pilot = buildExecutiveBriefing(history());
  assert.equal(pilot.nextAction.id, "pilot_routing");
  assert.equal(pilot.nextAction.capMinor, pilot.recoverable.valueMinor);
  assert.equal(pilot.nextAction.capCurrency, "USD");
  assert.ok(pilot.nextAction.evidence.length >= 3);
});

/* --------------------------- required structure ----------------------------- */

test("the three questions ship in the order a leader asks them", () => {
  const briefing = buildExecutiveBriefing(CANONICAL);
  assert.deepEqual(briefing.questions.map((entry) => entry.order), [1, 2, 3]);
  assert.deepEqual(briefing.questions.map((entry) => entry.id), BRIEFING_QUESTIONS.map((q) => q.id));
  for (const entry of briefing.questions) assert.match(entry.question, /\?$/);
});

test("progressive disclosure declares three levels and keeps the headline uncollapsible", () => {
  assert.deepEqual(DISCLOSURE_LEVELS.map((level) => level.level), [1, 2, 3]);
  assert.equal(DISCLOSURE_LEVELS[0].collapsible, false);
  const headline = new Set(DISCLOSURE_LEVELS[0].fields);
  for (const level of DISCLOSURE_LEVELS.slice(1)) {
    for (const field of level.fields) assert.equal(headline.has(field), false, field);
  }
  const briefing = buildExecutiveBriefing(CANONICAL);
  for (const field of ["primaryFinding", "recoverable", "nextAction"]) {
    assert.notEqual(briefing[field], undefined);
  }
});

test("every briefing carries a method note, its operations, and its provenance", () => {
  const briefing = buildExecutiveBriefing(CANONICAL);
  assert.match(briefing.method.note, /recomputed/i);
  assert.ok(briefing.method.operations.length >= 4);
  assert.ok(briefing.method.readFields.includes("recoverableScenarioMinor"));
  assert.equal(briefing.method.derivedFromBriefingContract, "finops-briefing/1.0.0");
  assert.equal(briefing.provenance.sourceFingerprint, "c1daf8d2");
  assert.equal(briefing.provenance.retainedPeriodCount, 3);
  assert.equal(briefing.provenance.recordsAnalyzed, 1766);
});

test("an empty workspace states what is absent instead of showing a zero", () => {
  const briefing = buildExecutiveBriefing([]);
  assert.equal(briefing.recoverable, null);
  assert.equal(briefing.primaryFinding, null);
  assert.equal(briefing.nextAction, null);
  assert.equal(briefing.benchmark, null);
  assert.equal(briefing.absent.primaryFinding.reason, EXECUTIVE_ABSENCE_REASON.noRetainedPeriods);
  assert.equal(
    briefing.absent.primaryFinding.statement,
    EXECUTIVE_ABSENCE_STATEMENT[EXECUTIVE_ABSENCE_REASON.noRetainedPeriods],
  );
  assert.equal(briefing.confidence.level, "insufficient");
  assert.deepEqual(validateExecutiveBriefing(briefing).violations, []);
});

/* -------------------------------- safety ------------------------------------ */

test("every briefing states its data residency and refuses shareable links", () => {
  for (const input of [[], CANONICAL]) {
    const briefing = buildExecutiveBriefing(input);
    assert.equal(briefing.safety.dataResidency, "browser_local_derived_workspace_records");
    assert.equal(briefing.safety.readsImportedRecords, false);
    assert.equal(briefing.safety.readsLiveProviderEndpoints, false);
    assert.equal(briefing.safety.shareableLinkSupported, false);
    assert.match(briefing.safety.statement, /browser/i);
    assert.match(briefing.safety.statement, /shareable link/i);
    assert.ok(briefing.limitations.some((entry) => entry.code === LIMITATION.noShareableLink));
    assert.ok(briefing.limitations.some((entry) => entry.code === LIMITATION.browserLocalOnly));
    assert.ok(briefing.limitations.some((entry) => entry.code === LIMITATION.scenarioNotRealized));
  }
});

test("the fixture file itself carries no prompt, identity, credential, or link", () => {
  const raw = readFileSync(new URL("../src/executive-finops-briefing-fixture.json", import.meta.url), "utf8");
  assert.equal(FORBIDDEN_LINK_PATTERN.test(raw.replace(/"mustNotCarry"[\s\S]*?\]/, "")), false);
  const scan = scanRetainedContent(fixture.input);
  assert.deepEqual(scan.violations, []);
  assert.deepEqual(scanRetainedContent(fixture.briefing).violations, []);
});

test("a briefing that smuggles a link or weakens its safety block is rejected", () => {
  const withLink = {
    ...fixture.briefing,
    provenance: { ...fixture.briefing.provenance, sourceFingerprint: "https://example.test/x" },
  };
  const linkVerdict = validateExecutiveBriefing(withLink);
  assert.equal(linkVerdict.valid, false);
  assert.ok(linkVerdict.violations.some((entry) => entry.code === "shareable_link"));

  const weakened = { ...fixture.briefing, safety: { ...fixture.briefing.safety, shareableLinkSupported: true } };
  assert.ok(validateExecutiveBriefing(weakened).violations.some(
    (entry) => entry.code === "safety_statement_missing_or_weakened",
  ));

  const stripped = { ...fixture.briefing, limitations: [] };
  assert.ok(validateExecutiveBriefing(stripped).violations.some(
    (entry) => entry.code === "limitations_absent",
  ));
});

test("a rewritten action, a forked share, or a contradicted standing is rejected", () => {
  const rewritten = {
    ...fixture.briefing,
    nextAction: { ...fixture.briefing.nextAction, statement: "Cut the AI budget in half." },
  };
  assert.ok(validateExecutiveBriefing(rewritten).violations.some(
    (entry) => entry.code === "action_statement_rewritten",
  ));

  const forked = {
    ...fixture.briefing,
    recoverable: { ...fixture.briefing.recoverable, sharePpm: 200_000 },
  };
  assert.ok(validateExecutiveBriefing(forked).violations.some(
    (entry) => entry.code === "share_not_computed_from_aggregates",
  ));

  const contradicted = {
    ...fixture.briefing,
    benchmark: { ...fixture.briefing.benchmark, standing: BENCHMARK_STANDING.less },
  };
  assert.ok(validateExecutiveBriefing(contradicted).violations.some(
    (entry) => entry.code === "standing_contradicts_variance",
  ));
});
