// The briefing file: contract shape, determinism, re-derivability, partial
// attribution, and what must never be in it.
//
// The fixtures here are analysis envelopes built in this file rather than
// checked in, so a change to the envelope's shape shows up as a compile-time
// obvious edit instead of a stale JSON blob nobody re-reads. The example
// dataset is used where a *real* envelope matters — the round trip through the
// #392 reader — because that is the one assertion a hand-built fixture could
// pass while the shipped path fails.

import test from "node:test";
import assert from "node:assert/strict";

import {
  BRIEFING_FILE_VERSION,
  BriefingContentError,
  briefingFile,
  buildBriefing,
  scanBriefingPayload,
  serializeBriefing,
  validateBriefingPayload,
} from "../src/finops-briefing-export.js";
import {
  buildFinopsBriefing, CONTRACT_VERSION, validateBriefing,
} from "../src/finops-briefing-contract.js";
import { DOWN_ROUTING_RULE_VERSION } from "../src/down-routing-candidates.js";
import { parseSavedBriefing } from "../src/finops-briefing-restore.js";
import { loadExampleDataset } from "../src/example-dataset.js";

const EXPORTED_AT = "2026-07-27T09:30:00Z";

/**
 * A department the way the analysis publishes one, reduced to the fields the
 * briefing reads. Overrides are applied last so a test can bend exactly one.
 */
function department(id, { spendUsd, recoverableUsd, records = 40, previousSpendUsd = null, ...rest } = {}) {
  return {
    id,
    name: `Department …${id}`,
    unit: { source: "org_unit", value: id },
    spendUsd,
    recoverableUsd,
    records,
    previousSpendUsd,
    trendAvailable: previousSpendUsd !== null,
    downRouting: {
      ruleVersion: DOWN_ROUTING_RULE_VERSION,
      decisionCode: "candidate_flagged",
      decisionReason: "Observed blended price sits above the premium-tier floor.",
      unitLabel: `Department …${id}`,
      flagged: true,
      routableSpendUsd: spendUsd,
      candidateSpendUsd: spendUsd,
      recoverableUsd,
      candidateTokens: 9_000_000,
      requests: 4_000,
      tokensPerCall: 1_200,
      observedMinorPerMillionTokens: 2_400,
      referenceMinorPerMillionTokens: 1_500,
      confidence: { level: "High", reasons: [] },
    },
    ...rest,
  };
}

/**
 * A finished analysis. `joinedRecords`/`quarantinedRecords` drive the contract's
 * coverage, and `attribution.rankedRecoverable.coverage` drives the attributed
 * share; the two are independent on purpose, because they are the two ways a
 * briefing can be less than complete.
 */
function analysisFixture({
  joinedRecords = 120,
  quarantinedRecords = 0,
  attributedSpend = 24_000,
  unattributedSpend = 0,
  departments = [
    department("atlas0", { spendUsd: 16_000, recoverableUsd: 3_200, previousSpendUsd: 12_000 }),
    department("borealis1", { spendUsd: 8_000, recoverableUsd: 1_050, previousSpendUsd: 7_600 }),
  ],
  ...rest
} = {}) {
  const spendUsd = departments.reduce((sum, entry) => sum + entry.spendUsd, 0);
  const recoverableUsd = departments.reduce((sum, entry) => sum + entry.recoverableUsd, 0);
  return {
    schemaVersion: "local-finops-history/1.0.0",
    generatedAt: "2026-07-01T00:00:00.000Z",
    period: "2026-06-01 to 2026-07-01",
    spendUsd,
    recoverableUsd,
    rankedDepartments: departments,
    topDepartment: departments[0] ?? null,
    confidence: "Medium",
    action: `Pilot lower-cost routing for text-generation in ${departments[0]?.name ?? "the top unit"}; `
      + `cap the pilot at ${recoverableUsd.toFixed(2)} USD and verify against a like-for-like period.`,
    attribution: {
      version: "attribution-unit/1.0.0",
      rankedRecoverable: {
        coverage: { attributedSpend, unattributedSpend, attributedShare: null },
        totalSpendUsd: attributedSpend + unattributedSpend,
        recoverableUsd,
        threshold: { state: "graded", tier: "high", reason: { code: "sufficient_coverage", floor: 0.8 } },
        unattributedRecoverableUsd: 0,
      },
    },
    quality: {
      providerCompleteness: "complete",
      hrisCompleteness: "complete",
      joinedRecords,
      quarantinedRecords,
      quarantine: [],
      warnings: [],
    },
    history: {
      state: "available",
      message: "Adjacent calendar-month exports use the same provider source.",
      periodCount: 2,
      previousPeriod: "2026-05-01 to 2026-06-01",
      currentPeriod: "2026-06-01 to 2026-07-01",
      organizationTrendAvailable: true,
      organizationSpendChangePercent: 22,
      periods: [
        { period: "2026-05-01 to 2026-06-01", spendUsd: 19_600, recoverableUsd: 3_400, completeness: "complete" },
        { period: "2026-06-01 to 2026-07-01", spendUsd, recoverableUsd, completeness: "complete" },
      ],
    },
    ...rest,
  };
}

// --- the contract shape ----------------------------------------------------

test("the generated briefing satisfies the contract and stamps the contract's own version", () => {
  const payload = buildBriefing(analysisFixture(), { dataset: "user", exportedAt: EXPORTED_AT });

  assert.equal(payload.briefingContractVersion, CONTRACT_VERSION);
  assert.equal(payload.briefing.contractVersion, CONTRACT_VERSION);
  assert.equal(payload.briefingFileVersion, BRIEFING_FILE_VERSION);
  assert.equal(validateBriefing(payload.briefing).valid, true,
    JSON.stringify(validateBriefing(payload.briefing).violations));
  assert.equal(validateBriefingPayload(payload).valid, true,
    JSON.stringify(validateBriefingPayload(payload).violations));

  // The version is the module's, not a literal re-typed here: if the contract
  // moved and this file had hardcoded the old string, this would still pass —
  // so the check that matters is that the two constants are the same object's.
  assert.equal(payload.briefing.rubricVersion, DOWN_ROUTING_RULE_VERSION);
  assert.equal(payload.scenario.ruleVersion, DOWN_ROUTING_RULE_VERSION);
});

test("the generator reads nothing ambient: the written date is the caller's or absent", () => {
  const analysis = analysisFixture();
  assert.equal(buildBriefing(analysis, { dataset: "user", exportedAt: EXPORTED_AT }).exportedAt, EXPORTED_AT);
  // Omitted rather than invented. A generator with no clock cannot stamp one.
  assert.equal("exportedAt" in buildBriefing(analysis, { dataset: "user" }), false);
});

test("provenance rides on the contract's own slot rather than a second key", () => {
  const payload = buildBriefing(analysisFixture(), { dataset: "user", exportedAt: EXPORTED_AT });
  assert.equal(payload.briefing.provenance.displayOnly, true);
  assert.match(payload.briefing.provenance.text, /browser/i);
  assert.equal("provenance" in payload, false, "a second provenance key would be a fork of the first");
});

// --- determinism -----------------------------------------------------------

test("two generations from the same analysis serialize to identical bytes", () => {
  const analysis = analysisFixture();
  const first = serializeBriefing(buildBriefing(analysis, { dataset: "user", exportedAt: EXPORTED_AT }));
  const second = serializeBriefing(buildBriefing(analysis, { dataset: "user", exportedAt: EXPORTED_AT }));
  assert.equal(first, second);
});

test("key insertion order in the analysis does not change the file's bytes", () => {
  const analysis = analysisFixture();
  // The same values, rebuilt with every object's keys inserted in reverse order.
  // Without a sorted-key replacer these two would serialize differently while
  // being the same analysis, which is exactly the bug this test exists for.
  const reversed = reverseKeyOrder(analysis);
  assert.notEqual(JSON.stringify(analysis), JSON.stringify(reversed),
    "the fixture must actually differ in key order, or this test proves nothing");
  assert.deepEqual(reversed, analysis, "reversing key order must not change any value");

  assert.equal(
    serializeBriefing(buildBriefing(reversed, { dataset: "user", exportedAt: EXPORTED_AT })),
    serializeBriefing(buildBriefing(analysis, { dataset: "user", exportedAt: EXPORTED_AT })));
});

test("the serialized file has every object's keys in sorted order", () => {
  const text = serializeBriefing(buildBriefing(analysisFixture(), { dataset: "user", exportedAt: EXPORTED_AT }));
  walkObjects(JSON.parse(text), (value, path) => {
    const keys = Object.keys(value);
    assert.deepEqual(keys, [...keys].sort(), `keys out of order at ${path || "<root>"}`);
  });
});

test("ranked departments are ordered by their rank field, whatever order they arrive in", () => {
  const analysis = analysisFixture();
  const payload = buildBriefing(analysis, { dataset: "user", exportedAt: EXPORTED_AT });
  const ranks = payload.results.rankedDepartments.map((entry) => entry.rank);
  assert.deepEqual(ranks, [1, 2]);
  assert.deepEqual(
    payload.figures.recoverableSpend.inputs.perDepartmentRecoverableUsd.map((entry) => entry.rank),
    [1, 2]);
  // The rank is the analysis's published order, and the top department is the
  // rank-1 entry rather than whichever object happened to be first.
  assert.equal(payload.results.topDepartment.id, payload.results.rankedDepartments[0].id);
  assert.equal(payload.results.rankedDepartments[0].rank, 1);
});

/** Rebuild a value with every object's keys inserted in reverse order. */
function reverseKeyOrder(value) {
  if (Array.isArray(value)) return value.map(reverseKeyOrder);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).reverse()) out[key] = reverseKeyOrder(value[key]);
  return out;
}

function walkObjects(value, visit, path = "") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkObjects(item, visit, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  visit(value, path);
  for (const [key, child] of Object.entries(value)) {
    walkObjects(child, visit, path ? `${path}.${key}` : key);
  }
}

// --- re-derivability -------------------------------------------------------

test("the recoverable-spend headline is re-derivable from the file's own operands", () => {
  const payload = buildBriefing(analysisFixture(), { dataset: "user", exportedAt: EXPORTED_AT });
  const figure = payload.figures.recoverableSpend;

  // Sum the operands the file carries. Nothing here reads the analysis.
  const summed = figure.inputs.perDepartmentRecoverableUsd
    .reduce((total, entry) => total + entry.recoverableUsd, 0);
  assert.ok(Math.abs(summed - figure.value) < 1e-9,
    `per-department amounts sum to ${summed}, headline says ${figure.value}`);
  assert.equal(figure.inputs.rankedDepartmentCount, figure.inputs.perDepartmentRecoverableUsd.length);

  // And the share the page states is that figure over the analyzed spend.
  const share = Math.round((figure.value / figure.inputs.analyzedSpendUsd) * 1e6) / 1e6;
  assert.equal(share, figure.inputs.recoverableShareOfAnalyzedSpend);
  assert.equal(figure.value, payload.results.recoverableUsd);
  assert.equal(figure.inputs.analyzedSpendUsd, payload.results.spendUsd);
});

test("the attributed share is re-derivable as amounts and as counts", () => {
  const payload = buildBriefing(
    analysisFixture({ attributedSpend: 18_000, unattributedSpend: 6_000, joinedRecords: 96, quarantinedRecords: 24 }),
    { dataset: "user", exportedAt: EXPORTED_AT });
  const { inputs, value } = payload.figures.attributedShare;

  const derived = inputs.attributedSpendUsd / (inputs.attributedSpendUsd + inputs.unattributedSpendUsd);
  assert.equal(Math.round(derived * 1e6) / 1e6, value);
  assert.equal(value, 0.75);
  assert.equal(inputs.totalSpendUsd, inputs.attributedSpendUsd + inputs.unattributedSpendUsd);

  // The record-count denominator is carried too, and it is the contract's.
  assert.equal(inputs.analyzedRecords + inputs.excludedRecords, inputs.totalRecords);
  assert.equal(inputs.analyzedRecords / inputs.totalRecords, payload.briefing.coverage.coverageRatio);
});

test("every figure carries a provenance record, keyed to the figure it explains", () => {
  const payload = buildBriefing(
    analysisFixture({ attributedSpend: 18_000, unattributedSpend: 6_000, joinedRecords: 96, quarantinedRecords: 24 }),
    { dataset: "user", exportedAt: EXPORTED_AT });

  for (const [key, figure] of Object.entries(payload.figures)) {
    const record = figure.provenance;
    assert.ok(record, `figures.${key} publishes a value with no provenance behind it`);
    // KEYED, NOT POSITIONAL: the record names the figure it sits under, so a
    // reader never has to match by order.
    assert.equal(record.figure, key,
      `figures.${key}.provenance claims to explain ${record.figure}`);

    // All four field groups, on every record.
    assert.ok(Array.isArray(record.inputs) && record.inputs.length > 0,
      `figures.${key} names no inputs`);
    assert.ok(Number.isInteger(record.samples.count) && record.samples.count > 0,
      `figures.${key} reports no sample count`);
    assert.ok(record.samples.unit, `figures.${key} counts its sample in no unit`);
    assert.ok(record.method.aggregation && record.method.rule && record.method.label,
      `figures.${key} names no method`);
    assert.equal(record.computedAt, new Date(EXPORTED_AT).toISOString(),
      `figures.${key} was not stamped with the caller's clock`);

    // The inputs are the figure's OWN operand keys, so they cannot drift from
    // the operands beside them, and they are names rather than values.
    assert.deepEqual(record.inputs, Object.keys(figure.inputs).sort(),
      `figures.${key}.provenance.inputs is not the operand list beside it`);
  }

  // The two records name different samples in different units: one is records,
  // the other departments, and a shared record shape must not blur them.
  assert.equal(payload.figures.attributedShare.samples, undefined);
  assert.equal(payload.figures.attributedShare.provenance.samples.count,
    payload.briefing.coverage.recordsAnalyzed);
  assert.equal(payload.figures.recoverableSpend.provenance.samples.count,
    payload.figures.recoverableSpend.inputs.rankedDepartmentCount);
  assert.notEqual(payload.figures.attributedShare.provenance.samples.unit,
    payload.figures.recoverableSpend.provenance.samples.unit);
  assert.equal(payload.figures.recoverableSpend.provenance.method.rule, DOWN_ROUTING_RULE_VERSION);

  // A file written with no clock reports no computation time rather than one it
  // invented — the module still has none of its own.
  const undated = buildBriefing(analysisFixture(), { dataset: "user" });
  assert.equal(undated.figures.recoverableSpend.provenance.computedAt, null);
});

test("the scenario carries the rule's numeric parameters, not a formula about them", () => {
  const payload = buildBriefing(analysisFixture(), { dataset: "user", exportedAt: EXPORTED_AT });
  const byName = new Map(payload.scenario.parameters.map((entry) => [entry.name, entry]));

  assert.equal(byName.get("premium_tier_floor_minor_per_million_tokens").value, 2000);
  assert.equal(byName.get("standard_tier_reference_minor_per_million_tokens").value, 1500);
  assert.equal(byName.get("short_call_max_tokens_per_call").value, 2000);
  assert.equal(byName.get("min_candidate_requests").value, 1000);
  // Each threshold arrives with the assumption it encodes, and the pairing is
  // the rule module's own text rather than a restatement of it.
  for (const parameter of payload.scenario.parameters) {
    assert.equal(typeof parameter.assumption, "string");
    assert.match(parameter.assumption, /NO SOURCE/);
    assert.equal(typeof parameter.unit, "string");
  }
  assert.ok(payload.scenario.qualifications.length > 0);
});

// --- partial attribution ---------------------------------------------------

test("a partially attributed analysis never presents its headline as complete", () => {
  const payload = buildBriefing(
    analysisFixture({ joinedRecords: 60, quarantinedRecords: 60, attributedSpend: 14_400, unattributedSpend: 9_600 }),
    { dataset: "user", exportedAt: EXPORTED_AT });

  assert.equal(payload.briefing.coverage.coverageRatio, 0.5);
  assert.ok(payload.briefing.coverage.coverageRatio < 1);
  assert.equal(payload.briefing.coverage.confidence, "low");

  for (const key of ["recoverableSpend", "attributedShare"]) {
    const { completeness } = payload.figures[key];
    assert.equal(completeness.complete, false, `${key} must not read as complete`);
    assert.equal(completeness.confidence, "low");
    assert.equal(completeness.attributedShare, 0.6);
    assert.match(completeness.qualifier, /^Partial: /);
    assert.match(completeness.qualifier, /50\.0% of the analyzed records/);
    assert.match(completeness.qualifier, /60\.0% of the analyzed spend/);
  }
});

test("full record coverage with partial attribution is still not complete", () => {
  // The case the completeness rule exists for: every record joined, but a fifth
  // of the money sits outside the departments the rubric scored.
  const payload = buildBriefing(
    analysisFixture({ joinedRecords: 120, quarantinedRecords: 0, attributedSpend: 19_200, unattributedSpend: 4_800 }),
    { dataset: "user", exportedAt: EXPORTED_AT });

  assert.equal(payload.briefing.coverage.coverageRatio, 1);
  assert.equal(payload.briefing.coverage.confidence, "high");
  assert.equal(payload.figures.recoverableSpend.completeness.complete, false);
  assert.equal(payload.figures.recoverableSpend.completeness.attributedShare, 0.8);
  assert.match(payload.figures.recoverableSpend.completeness.qualifier, /80\.0% of the analyzed spend/);
});

test("a fully covered, fully attributed analysis does read as complete", () => {
  const payload = buildBriefing(analysisFixture(), { dataset: "user", exportedAt: EXPORTED_AT });
  assert.equal(payload.briefing.coverage.confidence, "high");
  assert.equal(payload.figures.recoverableSpend.completeness.complete, true);
  assert.equal(payload.figures.recoverableSpend.completeness.qualifier, null);
});

test("an analysis that was never run produces a briefing that says so, not a zero", () => {
  const payload = buildBriefing(null, { dataset: "user", exportedAt: EXPORTED_AT });
  assert.equal(payload.briefing.materialMetric, null);
  assert.match(payload.briefing.absent.materialMetric.statement, /No analysis has been computed/);
  assert.equal(payload.figures.recoverableSpend.completeness.complete, false);
  assert.equal(validateBriefing(payload.briefing).valid, true);
});

// --- forbidden content -----------------------------------------------------

/**
 * An analysis carrying every category the briefing must strip: prompt text and
 * conversation content, per-row HRIS detail with names and salaries, a provider
 * API key, and a raw provider response body. A clean fixture would let the
 * stripping assertions pass without stripping anything.
 */
function leakyAnalysis() {
  const analysis = analysisFixture();
  analysis.quality.quarantine = [
    {
      employeeName: "Dana Okafor",
      employeeId: "emp-40021",
      email: "dana.okafor@example.com",
      annualSalaryUsd: 148_000,
      org_unit_id: "atlas0",
      costMinor: 41_200,
    },
  ];
  analysis.literacy = {
    available: true,
    sample: {
      total: 2,
      excerpts: [
        { promptText: "Summarise the Q2 reconciliation for the exec deck", classification: "analysis" },
        { conversationId: "conv-9", messages: [{ role: "user", content: "why is our bill so high" }] },
      ],
    },
  };
  analysis.provider = {
    apiKey: "sk-live-4Kd93jflsMzz1Qa8",
    authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
    rawResponseBody: '{"object":"list","data":[{"prompt":"draft the board memo","ip_address":"10.4.19.220"}]}',
  };
  analysis.rankedDepartments[0].hrisRows = [
    { fullName: "Priya Raman", userId: "u-8812", salaryUsd: 132_000 },
  ];
  return analysis;
}

test("nothing forbidden survives into the file, from an analysis that actually carries it", () => {
  const analysis = leakyAnalysis();
  // The fixture must really be dirty, or the assertions below are vacuous.
  const source = JSON.stringify(analysis);
  for (const marker of ["Dana Okafor", "dana.okafor@example.com", "sk-live-", "Bearer ey",
    "Summarise the Q2 reconciliation", "why is our bill so high", "Priya Raman", "148000"]) {
    assert.ok(source.includes(marker), `the fixture must carry ${marker} for this test to prove anything`);
  }

  const payload = buildBriefing(analysis, { dataset: "user", exportedAt: EXPORTED_AT });
  const text = serializeBriefing(payload);

  // No value from any forbidden category reaches the bytes.
  for (const marker of ["Dana Okafor", "dana.okafor", "emp-40021", "148000", "sk-live-", "Bearer ey",
    "Summarise the Q2 reconciliation", "why is our bill so high", "Priya Raman", "u-8812",
    "10.4.19.220", "rawResponseBody", "board memo"]) {
    assert.ok(!text.includes(marker), `forbidden value leaked into the file: ${marker}`);
  }

  // Nor does any forbidden *key*, at any depth, under any spelling.
  for (const key of ["quarantine", "literacy", "provider", "hrisRows", "apiKey", "authorization",
    "promptText", "messages", "excerpts", "email", "annualSalaryUsd"]) {
    assert.ok(!text.includes(`"${key}"`), `forbidden key leaked into the file: ${key}`);
  }

  // And the scanner agrees, which is the check the generator itself runs.
  assert.equal(scanBriefingPayload(payload).valid, true,
    JSON.stringify(scanBriefingPayload(payload).violations));

  // The analysis is still usable: stripping did not empty the briefing.
  assert.ok(payload.figures.recoverableSpend.value > 0);
  assert.equal(payload.results.rankedDepartments.length, 2);
});

test("the leak assertions would fail if the projection stopped stripping", () => {
  // The guard on the guard: a payload assembled the way the old raw dump did it
  // must be caught, so a green suite above means the allowlist did the work.
  const smuggled = buildBriefing(analysisFixture(), { dataset: "user", exportedAt: EXPORTED_AT });
  const outcome = scanBriefingPayload({
    ...smuggled,
    results: { ...smuggled.results, quarantine: leakyAnalysis().quality.quarantine },
  });
  assert.equal(outcome.valid, false);
  const codes = new Set(outcome.violations.map((violation) => violation.code));
  assert.ok(codes.has("forbidden_field"), JSON.stringify(outcome.violations));
  assert.ok(codes.has("email_address"), JSON.stringify(outcome.violations));
});

test("a department whose own label carries an address is withheld rather than written", () => {
  const analysis = analysisFixture();
  analysis.rankedDepartments[0].name = "owner dana.okafor@example.com";
  assert.throws(
    () => buildBriefing(analysis, { dataset: "user", exportedAt: EXPORTED_AT }),
    (error) => error instanceof BriefingContentError
      && error.violations.some((violation) => violation.code === "email_address"));
});

// --- the file, and the reader on the other side of it ----------------------

test("the file the button hands out is the one the reopen reader accepts", () => {
  const file = briefingFile(loadExampleDataset(), { dataset: "example", exportedAt: EXPORTED_AT });
  assert.equal(file.fileName, "example-finops-briefing.json");
  assert.equal(file.mediaType, "application/json");

  const outcome = parseSavedBriefing(file.text, { byteSize: file.text.length });
  assert.equal(outcome.ok, true, `${outcome.code}: ${outcome.message}`);
  assert.equal(outcome.saved.dataset, "example");
  assert.equal(outcome.saved.savedOn, "2026-07-27");
  assert.equal(outcome.saved.rubricVersion, DOWN_ROUTING_RULE_VERSION);
});

test("the reopened briefing is the briefing that was saved, not a different selection", () => {
  // The projection is only correct if the reader, rebuilding from `results`,
  // reaches the same three slots the file recorded. If a field the contract
  // reads were dropped from the allowlist, this is the test that fails.
  const payload = buildBriefing(loadExampleDataset(), { dataset: "example", exportedAt: EXPORTED_AT });
  const reopened = buildFinopsBriefing(JSON.parse(serializeBriefing(payload)).results);
  assert.deepEqual(JSON.parse(JSON.stringify(reopened)), JSON.parse(JSON.stringify(payload.briefing)));
});

test("an example-data file says so, and a user file does not claim to be one", () => {
  const example = buildBriefing(analysisFixture(), { dataset: "example", exportedAt: EXPORTED_AT });
  assert.equal(example.dataset, "example");
  assert.match(example.datasetNotice, /^EXAMPLE DATA/);

  const user = buildBriefing(analysisFixture(), { dataset: "user", exportedAt: EXPORTED_AT });
  assert.equal(user.dataset, "user");
  assert.equal("datasetNotice" in user, false);
  // Anything that is not the word "example" reads as the reader's own data: a
  // file must never be able to disclaim ownership by accident.
  assert.equal(buildBriefing(analysisFixture(), { dataset: "Example" }).dataset, "user");
});

test("the same analysis produces the same bytes on a second page load", async () => {
  // A fresh module instance, as a reload would give: no cached state, no
  // counter, no memoized clock. The bytes must not move.
  const analysis = analysisFixture();
  const first = briefingFile(analysis, { dataset: "user", exportedAt: EXPORTED_AT }).text;
  const reloaded = await import(`../src/finops-briefing-export.js?reload=${encodeURIComponent(EXPORTED_AT)}`);
  const second = reloaded.briefingFile(analysis, { dataset: "user", exportedAt: EXPORTED_AT }).text;
  assert.equal(first, second);
});
