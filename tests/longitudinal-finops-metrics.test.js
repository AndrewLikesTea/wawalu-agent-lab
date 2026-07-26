import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import longitudinalFixture from "../src/longitudinal-finops-fixture.json" with {
  type: "json",
};
import {
  BENCHMARK_INELIGIBILITY_REASONS,
  CONFIDENCE_LEVELS,
  LONGITUDINAL_FINOPS_SCHEMA_VERSION,
  MINIMUM_BENCHMARK_PERIODS,
  REQUIRED_PROVENANCE_FIELDS,
  compareActionPriority,
  compareDepartmentFindings,
  createLongitudinalFinopsFindings,
  describeFinding,
  renderProvenance,
} from "../src/longitudinal-finops-metrics.js";

const fixtureText = await readFile(
  new URL("../src/longitudinal-finops-fixture.json", import.meta.url), "utf8",
);
const moduleText = await readFile(
  new URL("../src/longitudinal-finops-metrics.js", import.meta.url), "utf8",
);

const result = createLongitudinalFinopsFindings(longitudinalFixture);

function createFixture(records) {
  return { ...structuredClone(longitudinalFixture), records };
}

function findingFor(departmentId) {
  const finding = result.findings.find((item) => item.departmentId === departmentId);
  assert.ok(finding, `${departmentId} must be present in the findings`);
  return finding;
}

function recordsFor(departmentId) {
  return structuredClone(longitudinalFixture.records)
    .filter((record) => record.departmentId === departmentId);
}

test("the fixture covers the department-period shapes the contract must decide on", () => {
  assert.equal(longitudinalFixture.schemaVersion, LONGITUDINAL_FINOPS_SCHEMA_VERSION);
  assert.deepEqual(result.periodWindow,
    { firstPeriod: "2026-04", lastPeriod: "2026-07", periodCount: 4 });
  assert.equal(result.departmentCount, 7);

  // At least two departments with three consecutive periods, and at least one
  // with fewer than three so the non-comparability path runs on real data.
  const eligible = result.findings.filter((finding) => finding.benchmark.eligible);
  assert.ok(eligible.length >= 2);
  for (const finding of eligible) {
    assert.ok(finding.periodCount >= MINIMUM_BENCHMARK_PERIODS);
  }
  assert.equal(findingFor("syn-dept-charlie").periodCount, 2);
  for (const record of longitudinalFixture.records) {
    assert.equal(record.currency, "USD");
    assert.ok(Array.isArray(record.provenance.derivedFromFields));
  }
});

test("definition 1 — trend is the change across the two newest adjacent periods", () => {
  // Normal case: an increase is positive, a decrease is negative, one decimal.
  const alpha = findingFor("syn-dept-alpha").trend;
  assert.equal(alpha.state, "available");
  assert.deepEqual(alpha.comparisonWindow, ["2026-05", "2026-06"]);
  assert.equal(alpha.changeUsd, 4400);
  assert.equal(alpha.changePercent, 10);
  assert.equal(alpha.direction, "increase");

  const bravo = findingFor("syn-dept-bravo").trend;
  assert.equal(bravo.changeUsd, -6600);
  assert.equal(bravo.changePercent, -12);
  assert.equal(bravo.direction, "decrease");

  // A gapped history still trends on its two newest adjacent periods; the
  // rounding rule is exercised by 1000/21000 = 4.7619%.
  assert.equal(findingFor("syn-dept-delta").trend.changePercent, 4.8);

  // Edge: a zero earlier period has no defined denominator. The absolute change
  // survives, the percentage is null, and the reason code is explicit.
  const foxtrot = findingFor("syn-dept-foxtrot").trend;
  assert.equal(foxtrot.state, "unavailable");
  assert.equal(foxtrot.reasonCode, "zero_prior_period_spend");
  assert.equal(foxtrot.changePercent, null);
  assert.equal(foxtrot.changeUsd, 9000);

  // Edge: a null in the window is never coerced to zero.
  assert.equal(findingFor("syn-dept-echo").trend.reasonCode,
    "null_spend_in_comparison_window");

  // Edge: one period cannot establish a change.
  const single = createLongitudinalFinopsFindings(
    createFixture(recordsFor("syn-dept-alpha").slice(0, 1)),
  );
  assert.equal(single.findings[0].trend.reasonCode, "insufficient_history");
});

test("definition 1 — the percentage rounds half away from zero in both directions", () => {
  // 102/8000 = 1.275%, exactly on the half. Both signs must round to |1.3|, or a
  // rise and a fall of the same size would print different magnitudes.
  const template = recordsFor("syn-dept-alpha").slice(0, 2);
  const rise = structuredClone(template);
  rise[0].spendUsd = 8000;
  rise[1].spendUsd = 8102;
  const fall = structuredClone(template);
  fall[0].spendUsd = 8000;
  fall[1].spendUsd = 7898;

  assert.equal(
    createLongitudinalFinopsFindings(createFixture(rise)).findings[0].trend.changePercent,
    1.3,
  );
  assert.equal(
    createLongitudinalFinopsFindings(createFixture(fall)).findings[0].trend.changePercent,
    -1.3,
  );
});

test("definition 2 — departments rank by current-period spend, ties by department id", () => {
  // Normal case: descending current-period spend.
  assert.deepEqual(result.findings.map((finding) => finding.departmentId), [
    "syn-dept-alpha", "syn-dept-bravo", "syn-dept-golf", "syn-dept-delta",
    "syn-dept-charlie", "syn-dept-foxtrot", "syn-dept-echo",
  ]);
  assert.deepEqual(result.findings.map((finding) => finding.comparison.rank),
    [1, 2, 3, 4, 5, 6, 7]);

  // Tie: alpha and bravo both close at 48400, so the deterministic tiebreak is
  // the ascending department id.
  const alpha = findingFor("syn-dept-alpha");
  const bravo = findingFor("syn-dept-bravo");
  assert.equal(alpha.currentSpendUsd, bravo.currentSpendUsd);
  assert.equal(compareDepartmentFindings(alpha, bravo), -1);
  assert.equal(compareDepartmentFindings(bravo, alpha), 1);
  assert.equal(compareDepartmentFindings(alpha, alpha), 0);

  // Edge: a null current period is ranked last and labelled, never dropped.
  const echo = findingFor("syn-dept-echo");
  assert.equal(echo.comparison.comparable, false);
  assert.equal(echo.comparison.reasonCode, "null_current_period_spend");
  assert.equal(echo.comparison.rank, result.findings.length);
  assert.equal(compareDepartmentFindings(echo, findingFor("syn-dept-foxtrot")), 1);
});

test("definition 3 — benchmark eligibility is a predicate with an explicit refusal", () => {
  // Normal case: three gapless non-null periods earn a trailing baseline.
  const alpha = findingFor("syn-dept-alpha").benchmark;
  assert.equal(alpha.eligible, true);
  assert.equal(alpha.basis, "own_trailing_mean");
  assert.deepEqual(alpha.baselinePeriods, ["2026-04", "2026-05"]);
  assert.equal(alpha.baselineUsd, 42000);
  assert.equal(alpha.varianceUsd, 6400);
  assert.equal(alpha.variancePercent, 15.2);
  assert.equal(findingFor("syn-dept-bravo").benchmark.variancePercent, -15.8);

  // Ineligible: each reason code is reached by real fixture data, and every one
  // of them yields an explicit result rather than a zero or a missing row.
  const ineligible = {
    "syn-dept-charlie": "insufficient_history",
    "syn-dept-delta": "period_gap",
    "syn-dept-echo": "null_spend",
  };
  for (const [departmentId, reasonCode] of Object.entries(ineligible)) {
    const benchmark = findingFor(departmentId).benchmark;
    assert.equal(benchmark.eligible, false, departmentId);
    assert.equal(benchmark.reasonCode, reasonCode, departmentId);
    assert.ok(BENCHMARK_INELIGIBILITY_REASONS.includes(benchmark.reasonCode));
    assert.equal(benchmark.baselineUsd, null, "an ineligible benchmark is never zero");
    assert.equal(benchmark.varianceUsd, null);
    assert.match(benchmark.reason, /\S/);
  }

  // Edge: a zero baseline is eligible but has no defined proportional distance.
  const zeroBaseline = recordsFor("syn-dept-alpha");
  zeroBaseline[0].spendUsd = 0;
  zeroBaseline[1].spendUsd = 0;
  const zeroed = createLongitudinalFinopsFindings(createFixture(zeroBaseline))
    .findings[0].benchmark;
  assert.equal(zeroed.eligible, true);
  assert.equal(zeroed.baselineUsd, 0);
  assert.equal(zeroed.varianceUsd, 48400);
  assert.equal(zeroed.variancePercent, null);
  assert.equal(zeroed.varianceReasonCode, "zero_benchmark_baseline");
});

test("definition 4 — every record resolves to exactly one ordered confidence level", () => {
  assert.deepEqual(CONFIDENCE_LEVELS, ["none", "low", "medium", "high"]);

  const expected = {
    "syn-dept-alpha": "high",
    "syn-dept-bravo": "high",
    "syn-dept-golf": "medium",
    "syn-dept-foxtrot": "medium",
    "syn-dept-charlie": "low",
    "syn-dept-delta": "low",
    "syn-dept-echo": "none",
  };
  for (const [departmentId, level] of Object.entries(expected)) {
    const confidence = findingFor(departmentId).confidence;
    assert.equal(confidence.level, level, departmentId);
    assert.equal(confidence.rank, CONFIDENCE_LEVELS.indexOf(level));
    assert.ok(confidence.basis.length > 0);
  }

  // Every fixture record belongs to exactly one finding, so every record maps to
  // exactly one level. No record is unclassified and none is classified twice.
  const departments = result.findings.map((finding) => finding.departmentId);
  assert.equal(new Set(departments).size, departments.length);
  const classified = result.findings.reduce(
    (total, finding) => total + finding.periodCount, 0,
  );
  assert.equal(classified, longitudinalFixture.records.length);
  for (const finding of result.findings) {
    assert.equal(CONFIDENCE_LEVELS.filter(
      (level) => level === finding.confidence.level,
    ).length, 1);
  }

  // Edge: an eligible benchmark whose trend or provenance is missing is capped
  // at medium; it never inherits high from the benchmark alone.
  assert.equal(findingFor("syn-dept-foxtrot").trend.state, "unavailable");
  assert.equal(findingFor("syn-dept-golf").provenance.complete, false);
});

test("definition 5 — a finding states which local fields support it, or says it cannot", () => {
  // Normal case: every contributing record declares every required field.
  const alpha = findingFor("syn-dept-alpha").provenance;
  assert.equal(alpha.complete, true);
  assert.deepEqual(alpha.supportingFields, [...REQUIRED_PROVENANCE_FIELDS].sort());
  assert.deepEqual(alpha.missingFields, []);
  assert.equal(alpha.contributingPeriodCount, 3);
  assert.match(alpha.statement, /Derived from/);

  // Edge: one contributing record omits a field, so the intersection loses it
  // and the finding must say so instead of presenting a bare number.
  const golf = findingFor("syn-dept-golf").provenance;
  assert.equal(golf.complete, false);
  assert.deepEqual(golf.missingFields, ["local.hris_export.org_unit_id"]);
  assert.match(golf.statement, /local\.hris_export\.org_unit_id/);
  assert.match(golf.statement, /not fully supported/);
  assert.match(describeFinding(findingFor("syn-dept-golf")),
    /not declared by every contributing record/);

  // Intersection, not union: a union would let one complete period vouch for a
  // period that declared nothing.
  const union = renderProvenance([
    { derivedFromFields: [...REQUIRED_PROVENANCE_FIELDS] },
    { derivedFromFields: ["local.hris_export.org_unit_id"] },
  ]);
  assert.deepEqual(union.supportingFields, ["local.hris_export.org_unit_id"]);
  assert.equal(union.complete, false);

  // Every rendered finding carries its provenance sentence with the number.
  for (const finding of result.findings) {
    const sentence = describeFinding(finding);
    assert.ok(sentence.includes(finding.provenance.statement), finding.departmentId);
  }
});

test("definition 6 — action priority is deterministic down to the last tiebreak", () => {
  // Normal case: confidence first, then benchmark variance, then spend, then id.
  assert.deepEqual(result.actionQueue.map((entry) => entry.departmentId), [
    "syn-dept-alpha", "syn-dept-bravo", "syn-dept-golf", "syn-dept-foxtrot",
    "syn-dept-delta", "syn-dept-charlie", "syn-dept-echo",
  ]);
  assert.equal(result.topAction.departmentId, "syn-dept-alpha");
  assert.equal(result.topAction.priorityRank, 1);
  assert.equal(result.topAction.blocked, false);
  assert.match(result.topAction.action, /Review syn-dept-alpha/);

  // The same fixture always yields the same top action.
  assert.equal(
    createLongitudinalFinopsFindings(structuredClone(longitudinalFixture))
      .topAction.departmentId,
    "syn-dept-alpha",
  );

  // Tie: golf and foxtrot are both medium with a +1500 variance, so the queue
  // falls through to current-period spend.
  const golf = findingFor("syn-dept-golf");
  const foxtrot = findingFor("syn-dept-foxtrot");
  assert.equal(golf.confidence.rank, foxtrot.confidence.rank);
  assert.equal(golf.benchmark.varianceUsd, foxtrot.benchmark.varianceUsd);
  assert.ok(golf.currentSpendUsd > foxtrot.currentSpendUsd);
  assert.ok(compareActionPriority(golf, foxtrot) < 0);
  assert.ok(compareActionPriority(foxtrot, golf) > 0);

  // Full tie: identical inputs fall through to the ascending department id.
  const twin = { ...foxtrot, departmentId: "syn-dept-zulu", currentSpendUsd: golf.currentSpendUsd };
  assert.ok(compareActionPriority(golf, twin) < 0);
  assert.ok(compareActionPriority(twin, golf) > 0);

  // A null variance never sorts as zero; it goes last within its level.
  assert.equal(findingFor("syn-dept-delta").benchmark.varianceUsd, null);
  assert.ok(compareActionPriority(golf, findingFor("syn-dept-delta")) < 0);

  // A blocked finding keeps its rank but is given a data-resolution action.
  const golfAction = result.actionQueue.find(
    (entry) => entry.departmentId === "syn-dept-golf",
  );
  assert.equal(golfAction.blocked, true);
  assert.equal(golfAction.blockedReasonCode, "provenance_incomplete");
  assert.match(golfAction.action, /Resolve provenance_incomplete/);
  const deltaAction = result.actionQueue.find(
    (entry) => entry.departmentId === "syn-dept-delta",
  );
  assert.equal(deltaAction.blockedReasonCode, "period_gap");
});

test("invariant a — insufficient or unsupported history is never null, zero, or dropped", () => {
  const departments = new Set(longitudinalFixture.records.map(
    (record) => record.departmentId,
  ));
  assert.equal(result.findings.length, departments.size, "no department row is dropped");
  assert.equal(result.actionQueue.length, departments.size, "no department loses its action");

  for (const finding of result.findings) {
    assert.ok(departments.has(finding.departmentId));
    // Every refusal is machine-readable and carries prose a leader can act on.
    if (!finding.benchmark.eligible) {
      assert.ok(BENCHMARK_INELIGIBILITY_REASONS.includes(finding.benchmark.reasonCode));
      assert.notEqual(finding.benchmark.baselineUsd, 0);
      assert.match(finding.benchmark.reason, /\S/);
    }
    if (finding.trend.state !== "available") {
      assert.match(finding.trend.reasonCode, /^[a-z_]+$/);
      assert.equal(finding.trend.changePercent, null);
      assert.match(finding.trend.reason, /\S/);
    }
    if (!finding.comparison.comparable) {
      assert.equal(finding.comparison.reasonCode, "null_current_period_spend");
      assert.match(finding.comparison.reason, /\S/);
    }
    assert.ok(CONFIDENCE_LEVELS.includes(finding.confidence.level));
  }

  // A department with only one period is still reported, with reasons.
  const single = createLongitudinalFinopsFindings(
    createFixture(recordsFor("syn-dept-charlie").slice(0, 1)),
  ).findings[0];
  assert.equal(single.benchmark.reasonCode, "insufficient_history");
  assert.equal(single.trend.reasonCode, "insufficient_history");
  assert.equal(single.confidence.level, "none");
});

test("invariant b — imported records stay browser-local for the session", () => {
  // The module has no transport, storage, credential, or clock path, so a record
  // cannot leave the tab or outlive the session through this contract.
  for (const pattern of [
    /\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /localStorage/, /sessionStorage/,
    /indexedDB/, /document\.cookie/, /new WebSocket/, /EventSource/,
    /\bimport\s*\(/, /require\s*\(/, /Date\.now|new Date\(/,
  ]) {
    assert.doesNotMatch(moduleText, pattern, `module must not reference ${pattern}`);
  }
  assert.match(result.locality.processing, /^browser_local_ephemeral$/);
  assert.match(result.locality.statement, /no network transmission/);

  // The projection is frozen, serializable, and never mutates its input.
  const before = structuredClone(longitudinalFixture);
  createLongitudinalFinopsFindings(longitudinalFixture);
  assert.deepEqual(longitudinalFixture, before);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.throws(() => {
    result.findings[0].benchmark.baselineUsd = 1;
  }, TypeError);
  assert.throws(() => {
    result.actionQueue[0].priorityRank = 9;
  }, TypeError);
});

test("the fixture stays synthetic, with no credentials, identities, or free text", () => {
  const forbidden = [
    [/[\w.+-]+@[\w-]+\.[a-z]{2,}/i, "an email address"],
    [/https?:\/\//i, "a live URL"],
    [/\b(?:sk|pk|ghp|xox[bp])[-_][A-Za-z0-9]{8,}/, "a credential-shaped token"],
    [/\b(?:api[_-]?key|secret|password|bearer|authorization|token)\b/i, "a credential field"],
    [/\b(?:openai|anthropic|aws|azure|gcp|snowflake|databricks|workday|okta)\b/i,
      "a live provider name"],
    [/\b\d{3}-\d{2}-\d{4}\b/, "a government identifier"],
    [/\b(?:prompt|userId|user_id|employee|name|email)\b/i, "an identity or prompt field"],
  ];
  for (const [pattern, label] of forbidden) {
    assert.equal(pattern.test(fixtureText), false, `fixture must not contain ${label}`);
  }
  // The record shape carries no free-text field at all: the only strings are a
  // synthetic slug, an ISO month, a currency code, and enumerated field paths.
  for (const record of longitudinalFixture.records) {
    assert.match(record.departmentId, /^syn-dept-[a-z]+$/);
    assert.match(record.periodLabel, /^\d{4}-\d{2}$/);
    assert.match(record.provenance.source, /synthetic/i);
    assert.deepEqual(Object.keys(record).sort(),
      ["currency", "departmentId", "periodLabel", "provenance", "spendUsd"]);
  }
});

test("malformed department-period records are refused before any metric is computed", () => {
  const cases = [
    [{ schemaVersion: "longitudinal-finops/0.9.0" }, /schemaVersion/],
    [{ records: [] }, /must be a non-empty array/],
  ];
  for (const [overrides, pattern] of cases) {
    assert.throws(
      () => createLongitudinalFinopsFindings({ ...longitudinalFixture, ...overrides }),
      pattern,
    );
  }

  const mutate = (change) => {
    const records = recordsFor("syn-dept-alpha");
    change(records);
    return () => createLongitudinalFinopsFindings(createFixture(records));
  };
  assert.throws(mutate((records) => { records[0].currency = "EUR"; }),
    /does not convert currency/);
  assert.throws(mutate((records) => { records[0].periodLabel = "2026-13"; }),
    /ISO year-month/);
  assert.throws(mutate((records) => { records[0].departmentId = "Finance"; }),
    /syn- prefixed synthetic slug/);
  assert.throws(mutate((records) => { records[0].spendUsd = -1; }),
    /non-negative safe integer/);
  assert.throws(mutate((records) => { records[0].note = "free text"; }),
    /undeclared field "note"/);
  assert.throws(mutate((records) => {
    records[0].provenance.derivedFromFields = ["local.unknown_export.field"];
  }), /LOCAL_FIELD_CATALOG/);
  assert.throws(mutate((records) => { records[1].periodLabel = records[0].periodLabel; }),
    /unique within a period label/);
  assert.throws(mutate((records) => { records[0].spendUsd = null; }),
    /must not claim an amount field when spend is null/);
});
