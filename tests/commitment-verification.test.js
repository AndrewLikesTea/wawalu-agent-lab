// Checking a commitment against the month after it.
//
// The labelled fixtures in `tests/fixtures/commitment-verification/paired-periods.js`
// carry the expected outcome of every pair. This file asserts those outcomes
// exactly — realized, variance, attainment, verdict, reason — and then attacks
// the two properties a disputed score stands on: that the same inputs always
// produce the same number, and that no number is produced at all when the
// evidence cannot say which row it came from.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  COMMITMENT_VERIFICATION_QUESTION,
  COMMITMENT_VERIFICATION_VERSION,
  VERIFICATION_METRIC_RULES,
  VERIFICATION_STATUS,
  VERIFICATION_UNAVAILABLE_REASON,
  VERIFICATION_UNAVAILABLE_STATEMENT,
  VERIFICATION_VERDICT,
  VERIFICATION_VERDICT_RULE,
  VERIFICATION_VERDICT_STATEMENT,
  nextCalendarMonth,
  verificationLines,
  verifyCommitment,
} from "../src/commitment-verification.js";
import { COMMITMENT_STATUS, deriveBriefingCommitment } from "../src/finops-briefing-commitment.js";
import { SAVINGS_COMMITMENT_VERSION } from "../src/savings-commitment.js";
import {
  AMBIGUOUS_OBSERVED_UNITS,
  PAIRED_PERIOD_CASES,
  ambiguousObservedMonth,
  monthEnvelope,
  observedMonth,
  referenceBaseline,
  usageRow,
} from "./fixtures/commitment-verification/paired-periods.js";

/** The commitment a baseline month proposes, asserted to exist before it is used. */
function commitmentFrom(baseline) {
  const block = deriveBriefingCommitment(baseline(), { dataset: "user" });
  assert.equal(block.status, COMMITMENT_STATUS.ok, "the fixture baseline proposed no commitment");
  return block;
}

/** Present the same analysis with every published list reversed. */
function reversedListings(analysis) {
  const routing = analysis.modelRouting;
  return {
    ...analysis,
    rankedDepartments: [...analysis.rankedDepartments].reverse(),
    modelRouting: {
      ...routing,
      ranked: [...routing.ranked].reverse().map((unit) => ({
        ...unit,
        candidates: [...unit.candidates].reverse(),
        excludedModels: [...unit.excludedModels].reverse(),
      })),
      insufficientData: [...routing.insufficientData].reverse().map((unit) => ({
        ...unit,
        candidates: [...unit.candidates].reverse(),
        excludedModels: [...unit.excludedModels].reverse(),
      })),
    },
  };
}

// ---------------------------------------------------------------------------
// The labelled fixtures, asserted exactly.
// ---------------------------------------------------------------------------

for (const fixture of PAIRED_PERIOD_CASES) {
  test(`paired period: ${fixture.label}`, () => {
    const block = commitmentFrom(fixture.baseline);
    const result = verifyCommitment(block, fixture.observed());
    const { expected } = fixture;

    assert.equal(result.schemaVersion, COMMITMENT_VERIFICATION_VERSION);
    assert.equal(result.contractVersion, SAVINGS_COMMITMENT_VERSION);
    assert.equal(result.question, COMMITMENT_VERIFICATION_QUESTION);
    assert.equal(result.status, expected.status, fixture.why);

    if (expected.status === VERIFICATION_STATUS.unavailable) {
      assert.equal(result.reason, expected.reason);
      assert.equal(result.statement, VERIFICATION_UNAVAILABLE_STATEMENT[expected.reason]);
      // The whole point of the unavailable path: no figure and no verdict is
      // carried beside the reason, so nothing downstream can read one out.
      assert.equal(result.verdict, null);
      assert.equal(result.verdictStatement, null);
      assert.equal(result.realized, null);
      assert.equal(result.variance, null);
      assert.equal(result.projected, null);
      assert.deepEqual(result.evidence, []);
      if (expected.scope) {
        assert.equal(result.detail.scope, expected.scope);
        assert.equal(result.detail.identifier, expected.identifier);
        assert.equal(result.detail.matchCount, expected.matchCount);
      }
      return;
    }

    assert.equal(result.reason, null);
    assert.equal(result.verdict, expected.verdict);
    assert.equal(result.verdictStatement, VERIFICATION_VERDICT_STATEMENT[expected.verdict]);
    assert.equal(result.observedPeriod, expected.observedPeriod);
    assert.equal(result.baselinePeriod, "2026-06");
    assert.equal(result.realized.monthlyCostMinor, expected.realizedCostMinor);
    assert.equal(result.realized.monthlySavingsMinor, expected.realizedSavingsMinor);
    assert.equal(result.projected.monthlySavingsMinor, expected.projectedSavingsMinor);
    assert.equal(result.variance.amountMinor, expected.varianceMinor);
    assert.equal(result.variance.attainmentPercent, expected.attainmentPercent);
    // Dollars are a rendering of the minor units, never a second figure.
    assert.equal(result.realized.monthlySavingsUsd, expected.realizedSavingsMinor / 100);
    assert.equal(result.variance.amountUsd, expected.varianceMinor / 100);
    // The arithmetic reproduces from its own stated inputs.
    assert.equal(
      result.projected.baselineMonthlyCostMinor - result.realized.monthlyCostMinor,
      result.realized.monthlySavingsMinor,
    );
    assert.equal(
      result.realized.monthlySavingsMinor - result.projected.monthlySavingsMinor,
      result.variance.amountMinor,
    );
  });
}

test("the fixture set labels every verdict and covers both unavailable families", () => {
  const verdicts = new Set(PAIRED_PERIOD_CASES.map((entry) => entry.expected.verdict).filter(Boolean));
  assert.deepEqual([...verdicts].sort(), Object.values(VERIFICATION_VERDICT).sort());
  const reasons = new Set(PAIRED_PERIOD_CASES.map((entry) => entry.expected.reason).filter(Boolean));
  assert.ok(reasons.has(VERIFICATION_UNAVAILABLE_REASON.ambiguousObservation));
  assert.ok(reasons.has(VERIFICATION_UNAVAILABLE_REASON.routeNotObserved));
  assert.ok(reasons.has(VERIFICATION_UNAVAILABLE_REASON.departmentNotObserved));
  for (const fixture of PAIRED_PERIOD_CASES) {
    assert.ok(fixture.why.length > 40, `${fixture.label} states no assumption`);
  }
});

// ---------------------------------------------------------------------------
// The blocker: a canonical-id collision is never resolved by picking a row.
// ---------------------------------------------------------------------------

test("reordering colliding org units produces the identical unavailable result", () => {
  const block = commitmentFrom(() => monthEnvelope({ modelUsage: [usageRow({ orgUnitId: "atlas-one" })] }));
  const forward = verifyCommitment(block, ambiguousObservedMonth(AMBIGUOUS_OBSERVED_UNITS));
  const reversed = verifyCommitment(block, ambiguousObservedMonth([...AMBIGUOUS_OBSERVED_UNITS].reverse()));
  // And once more with the published lists themselves reversed, which is the
  // order a hand-edited or re-serialized file can arrive in — the case the
  // analysis's own sort would otherwise hide.
  const relisted = verifyCommitment(block, reversedListings(ambiguousObservedMonth()));

  for (const result of [forward, reversed, relisted]) {
    assert.equal(result.status, VERIFICATION_STATUS.unavailable);
    assert.equal(result.reason, VERIFICATION_UNAVAILABLE_REASON.ambiguousObservation);
    assert.equal(result.detail.scope, "department");
    assert.equal(result.detail.matchCount, 2);
    assert.equal(result.detail.distinctRawIdentifierCount, 2);
  }
  assert.equal(JSON.stringify(forward), JSON.stringify(reversed));
  assert.equal(JSON.stringify(forward), JSON.stringify(relisted));
});

test("the colliding units would have produced two different verdicts on their own", () => {
  // Without this, the reorder test above proves nothing: it would pass just as
  // well if both rows happened to carry the same number. Each unit is checked in
  // isolation, and they disagree — so an order-dependent selection between them
  // is the difference between telling a director they hit the plan and telling
  // them they missed it by 60%.
  const block = commitmentFrom(() => monthEnvelope({ modelUsage: [usageRow({ orgUnitId: "atlas-one" })] }));
  const verdicts = AMBIGUOUS_OBSERVED_UNITS.map((unit) => verifyCommitment(block, observedMonth({
    modelUsage: [usageRow({ orgUnitId: "atlas-one", spendMinor: unit.spendMinor })],
    unitIds: ["atlas-one"],
  })).verdict);
  assert.deepEqual(verdicts, [VERIFICATION_VERDICT.achieved, VERIFICATION_VERDICT.underRealized]);
});

test("reordering colliding model rows produces the identical unavailable result", () => {
  const block = commitmentFrom(referenceBaseline);
  const rows = [
    usageRow({ model: "Vendor-Large-2026", spendMinor: 12_000 }),
    usageRow({ model: "vendor large 2026", spendMinor: 24_000 }),
  ];
  const forward = verifyCommitment(block, observedMonth({ modelUsage: rows }));
  const reversed = verifyCommitment(block, observedMonth({ modelUsage: [...rows].reverse() }));
  const relisted = verifyCommitment(block, reversedListings(observedMonth({ modelUsage: rows })));

  for (const result of [forward, reversed, relisted]) {
    assert.equal(result.reason, VERIFICATION_UNAVAILABLE_REASON.ambiguousObservation);
    assert.equal(result.detail.scope, "model");
    assert.equal(result.detail.identifier, "vendor-large-2026");
    assert.equal(result.realized, null);
  }
  assert.equal(JSON.stringify(forward), JSON.stringify(reversed));
  assert.equal(JSON.stringify(forward), JSON.stringify(relisted));
});

test("an ambiguous observation never leaks one matching unit's figures", () => {
  const block = commitmentFrom(() => monthEnvelope({ modelUsage: [usageRow({ orgUnitId: "atlas-one" })] }));
  const serialized = JSON.stringify(verifyCommitment(block, ambiguousObservedMonth()));
  // 12000 and 24000 are the two colliding units' observed spends, and 18000 and
  // 6000 the realized savings either one would have produced. None of the four
  // may appear anywhere in an unavailable result.
  for (const figure of ["12000", "24000", "18000", "6000", "120.00", "240.00"]) {
    assert.ok(!serialized.includes(figure), `an ambiguous result carried ${figure}`);
  }
});

// ---------------------------------------------------------------------------
// Reproducibility.
// ---------------------------------------------------------------------------

test("the same commitment and the same later month always produce the same result", () => {
  const block = commitmentFrom(referenceBaseline);
  const first = verifyCommitment(block, observedMonth({ modelUsage: [usageRow({ spendMinor: 24_000 })] }));
  const second = verifyCommitment(block, observedMonth({ modelUsage: [usageRow({ spendMinor: 24_000 })] }));
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test("the check touches no network, no clock, and no random source", () => {
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  const originalRandom = Math.random;
  const trap = () => { throw new Error("the verification reached ambient state"); };
  globalThis.fetch = trap;
  Date.now = trap;
  Math.random = trap;
  try {
    const block = commitmentFrom(referenceBaseline);
    const result = verifyCommitment(block, observedMonth({ modelUsage: [usageRow({ spendMinor: 12_000 })] }));
    assert.equal(result.verdict, VERIFICATION_VERDICT.achieved);
    // Both periods are the imports' own, never this run's.
    assert.equal(result.baselinePeriod, "2026-06");
    assert.equal(result.observedPeriod, "2026-07");
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
    Math.random = originalRandom;
  }
});

test("the check reads no credential, no live rate card, and no prompt text", () => {
  const block = commitmentFrom(referenceBaseline);
  const clean = verifyCommitment(block, observedMonth({ modelUsage: [usageRow({ spendMinor: 24_000 })] }));

  const polluted = observedMonth({ modelUsage: [usageRow({ spendMinor: 24_000 })] });
  polluted.apiKey = "sk-livekeymustnevertravel00";
  polluted.authorization = "Bearer livetokenmustnevertravel";
  polluted.storedPrompts = [{ promptText: "summarize the quarterly board pack" }];
  polluted.liveRateCard = { url: "https://provider.example/pricing", premiumMinorPerMillion: 9_999 };
  polluted.rankedDepartments[0].name = "<script>alert(1)</script>";

  const result = verifyCommitment(block, polluted);
  assert.equal(JSON.stringify(result), JSON.stringify(clean));
  const serialized = JSON.stringify(result);
  for (const leak of ["sk-live", "Bearer", "quarterly board pack", "provider.example", "<script"]) {
    assert.ok(!serialized.includes(leak), `the verification carried ${leak}`);
  }
});

test("evidence cites the observed row and the commitment's own baseline records", () => {
  const block = commitmentFrom(referenceBaseline);
  const result = verifyCommitment(block, observedMonth({ modelUsage: [usageRow({ spendMinor: 24_000 })] }));
  const observed = result.evidence.filter((item) => item.side === "observed");
  const baseline = result.evidence.filter((item) => item.side === "baseline");
  assert.equal(observed.length, 1);
  // Period-qualified, because the same unit and model in two months are two
  // different observations.
  assert.equal(observed[0].recordId,
    "observation-2026-07-psn-example-unit-atlas0-vendor-large-2026");
  assert.deepEqual(baseline.map((item) => item.recordId), block.commitment.provenance.recordIds);
  for (const item of result.evidence) assert.ok(item.statement.length > 20);
});

// ---------------------------------------------------------------------------
// Insufficient evidence, and a commitment that cannot be checked at all.
// ---------------------------------------------------------------------------

test("every unavailable reason carries an authored statement", () => {
  for (const reason of Object.values(VERIFICATION_UNAVAILABLE_REASON)) {
    const statement = VERIFICATION_UNAVAILABLE_STATEMENT[reason];
    assert.equal(typeof statement, "string", `${reason} has no statement`);
    assert.ok(statement.length > 60 && statement.length <= 400, `${reason} statement is the wrong size`);
  }
});

test("every verdict carries a statement and the rule that produced it", () => {
  for (const verdict of Object.values(VERIFICATION_VERDICT)) {
    assert.ok(VERIFICATION_VERDICT_STATEMENT[verdict].length > 40);
    assert.match(VERIFICATION_VERDICT_RULE[verdict], /Minor|minor/);
  }
});

test("every metric rule states the assumption behind it", () => {
  const rules = Object.entries(VERIFICATION_METRIC_RULES);
  assert.ok(rules.length >= 7);
  for (const [name, entry] of rules) {
    assert.ok(entry.rule.length > 40, `${name} has no stated rule`);
    assert.ok(entry.assumption.length > 60, `${name} states no assumption`);
  }
  // The one assumption a reader must not miss: the realized figure is an upper
  // bound, because no import can name what the traffic moved to.
  assert.match(VERIFICATION_METRIC_RULES.realizedCost.assumption, /UPPER BOUND/);
});

test("no commitment, a withheld figure, and an unreadable window each name themselves", () => {
  const block = commitmentFrom(referenceBaseline);
  const cases = [
    [verifyCommitment(null, observedMonth()), VERIFICATION_UNAVAILABLE_REASON.noCommitment],
    [verifyCommitment({ status: "no_commitment", commitment: null }, observedMonth()),
      VERIFICATION_UNAVAILABLE_REASON.noCommitment],
    [verifyCommitment(block, observedMonth(), { attributionWithheld: true }),
      VERIFICATION_UNAVAILABLE_REASON.attributionWithheld],
    [verifyCommitment(block, observedMonth({ period: "2026-07-01 to 2026-07-15" })),
      VERIFICATION_UNAVAILABLE_REASON.observationPeriodUnreadable],
  ];
  for (const [result, reason] of cases) {
    assert.equal(result.status, VERIFICATION_STATUS.unavailable);
    assert.equal(result.reason, reason);
    assert.equal(result.statement, VERIFICATION_UNAVAILABLE_STATEMENT[reason]);
    assert.equal(result.verdict, null);
  }
});

test("a tampered commitment is refused rather than checked against", () => {
  const block = commitmentFrom(referenceBaseline);
  const broken = [
    { department: { departmentId: "Atlas Platform" } },
    { baseline: { period: "June 2026", monthlyCostMinor: 30_000 } },
    { projectedMonthlySavings: { amountMinor: 0 } },
    { projectedMonthlySavings: { amountMinor: 150.5 } },
    { routing: { currentRoute: { modelId: "" } } },
  ];
  for (const patch of broken) {
    const tampered = { ...block.commitment, ...patch };
    const result = verifyCommitment(tampered, observedMonth());
    assert.equal(result.reason, VERIFICATION_UNAVAILABLE_REASON.commitmentNotVerifiable,
      `${JSON.stringify(patch)} was accepted`);
  }
});

test("a bare commitment, a briefing block, and a built preview are all accepted", () => {
  const block = commitmentFrom(referenceBaseline);
  const observed = () => observedMonth({ modelUsage: [usageRow({ spendMinor: 24_000 })] });
  const fromBlock = verifyCommitment(block, observed());
  const fromBare = verifyCommitment(block.commitment, observed());
  assert.equal(JSON.stringify(fromBlock), JSON.stringify(fromBare));
});

test("nextCalendarMonth rolls the year over and refuses everything that is not a month", () => {
  assert.equal(nextCalendarMonth("2026-06"), "2026-07");
  assert.equal(nextCalendarMonth("2026-12"), "2027-01");
  assert.equal(nextCalendarMonth("2026-13"), null);
  assert.equal(nextCalendarMonth("2026-6"), null);
  assert.equal(nextCalendarMonth(null), null);
});

test("a December baseline pairs with the following January", () => {
  const block = commitmentFrom(() => monthEnvelope({
    period: "2026-12-01 to 2027-01-01", generatedAt: "2027-01-02T09:15:00.000Z",
  }));
  const result = verifyCommitment(block, monthEnvelope({
    period: "2027-01-01 to 2027-02-01",
    generatedAt: "2027-02-02T09:15:00.000Z",
    modelUsage: [usageRow({ spendMinor: 24_000 })],
  }));
  assert.equal(result.status, VERIFICATION_STATUS.ok);
  assert.equal(result.baselinePeriod, "2026-12");
  assert.equal(result.observedPeriod, "2027-01");
});

// ---------------------------------------------------------------------------
// The published contract, checked against the code that implements it.
// ---------------------------------------------------------------------------

test("the contract doc names this version and every code the module can emit", async () => {
  const doc = await readFile(new URL("../docs/savings-commitment-verification.md", import.meta.url),
    "utf8");
  assert.ok(doc.includes(COMMITMENT_VERIFICATION_VERSION),
    "docs/savings-commitment-verification.md does not name this contract version");
  assert.ok(doc.includes(COMMITMENT_VERIFICATION_QUESTION),
    "docs/savings-commitment-verification.md does not state the question");
  for (const reason of Object.values(VERIFICATION_UNAVAILABLE_REASON)) {
    assert.ok(doc.includes(`\`${reason}\``),
      `docs/savings-commitment-verification.md does not document ${reason}`);
  }
  for (const verdict of Object.values(VERIFICATION_VERDICT)) {
    assert.ok(doc.includes(`\`${verdict}\``),
      `docs/savings-commitment-verification.md does not document ${verdict}`);
  }
  for (const name of Object.keys(VERIFICATION_METRIC_RULES)) {
    assert.ok(doc.includes(`\`${name}\``),
      `docs/savings-commitment-verification.md does not state the assumption behind ${name}`);
  }
});

// ---------------------------------------------------------------------------
// What a surface paints.
// ---------------------------------------------------------------------------

test("every state paints a question and a headline, so no slot renders empty", () => {
  const block = commitmentFrom(referenceBaseline);
  const states = [
    verifyCommitment(block, observedMonth({ modelUsage: [usageRow({ spendMinor: 24_000 })] })),
    verifyCommitment(block, null),
    verifyCommitment(null, null),
    null,
  ];
  for (const result of states) {
    const lines = verificationLines(result);
    assert.ok(lines.question.trim().endsWith("?"));
    assert.ok(lines.headline.trim().length > 0, "an empty headline reads as a blank box");
    assert.ok(lines.detail === null || lines.detail.trim().length > 0);
  }
});

test("a stated verdict is painted with its figures and its caveat, never bare", () => {
  const block = commitmentFrom(referenceBaseline);
  const lines = verificationLines(
    verifyCommitment(block, observedMonth({ modelUsage: [usageRow({ spendMinor: 24_000 })] })),
  );
  assert.match(lines.headline, /Under-realized/);
  assert.match(lines.detail, /60\.00 USD realized against 150\.00 USD projected/);
  assert.match(lines.detail, /-90\.00 USD variance \(40% of plan\)/);
  assert.match(lines.detail, /2026-06 baseline against 2026-07 observed/);
  assert.equal(lines.caveat, VERIFICATION_METRIC_RULES.realizedCost.assumption);
});
