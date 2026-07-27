// Reproducibility coverage for the browser-local export normalizer.
//
// Every input here is one of Anya's synthetic compatibility fixtures, loaded
// through the compatibility manifest, so the suite proves the pipeline against
// the reviewed contract rather than against hand-rolled shapes. The adverse
// cases assert the specific structured code Mina's workflow will render, not
// merely that something went wrong.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ANALYSIS_INPUT_SCHEMA_VERSION,
  createFinopsAnalysisSource,
  NORMALIZATION_CODE_CATALOG,
  NORMALIZATION_CODES,
  NORMALIZATION_SEVERITIES,
  normalize,
  normalizeFinopsExports,
  parseExports,
  RATING_RULES,
} from "../src/finops-export-normalization.js";
import { FINOPS_RUBRIC, scoreFinopsFixture } from "../src/finops-evaluation.js";
import { renderFinopsEvaluationPanel } from "../src/finops-evaluation-view.js";
import { byClass, installDocument } from "./support/dom.js";

installDocument();

const ROOT = new URL("../", import.meta.url);
const MANIFEST = JSON.parse(await readFile(
  new URL("contracts/integrations/browser-compatibility/v1/manifest.json", ROOT), "utf8",
));
const SAMPLE_TEXT = await readFile(
  new URL("src/finops-evaluation-fixtures.json", ROOT), "utf8",
);
const SAMPLE_PAYLOAD = JSON.parse(SAMPLE_TEXT);
const NORMALIZER_SOURCE = await readFile(
  new URL("src/finops-export-normalization.js", ROOT), "utf8",
);

/** Anya publishes fixture locations in the manifest; consume them, do not guess. */
const FIXTURE_URLS = Object.fromEntries(MANIFEST.fixtures.map((entry) => [
  entry.scenario, { provider: entry.provider_url, hris: entry.hris_url },
]));

async function fixtureDocuments(scenario, contract) {
  const path = FIXTURE_URLS[scenario][contract].replace(/^\//, "");
  const parsed = JSON.parse(await readFile(new URL(path, ROOT), "utf8"));
  // Some scenarios ship an array: that is two deliveries of one envelope, which
  // reaches the browser as two selected files.
  return Array.isArray(parsed) ? parsed : [parsed];
}

/** Build the `{name, mediaType, text}` records the page boundary hands over. */
async function selection(scenario, contract, prefix) {
  const documents = await fixtureDocuments(scenario, contract);
  return documents.map((document, index) => ({
    name: `${prefix ?? `${contract}-${scenario}`}${documents.length > 1 ? `-${index + 1}` : ""}.json`,
    mediaType: "application/json",
    text: JSON.stringify(document, null, 2),
  }));
}

const VALID_REFERENCE = "2026-07-25T18:00:00Z";

async function validSelection() {
  return [
    ...await selection("valid", "provider"),
    ...await selection("valid", "hris"),
  ];
}

function codes(result) {
  return result.outcomes.map((item) => item.code);
}

test("the code catalog is a closed, displayable contract", () => {
  const declared = new Set(Object.values(NORMALIZATION_CODES));
  assert.equal(declared.size, Object.values(NORMALIZATION_CODES).length);
  assert.deepEqual(Object.keys(NORMALIZATION_CODE_CATALOG).sort(), [...declared].sort());
  for (const entry of Object.values(NORMALIZATION_CODE_CATALOG)) {
    assert.ok(NORMALIZATION_SEVERITIES.includes(entry.severity), entry.code);
    assert.match(entry.message, /\S/);
    assert.match(entry.recovery, /\S/);
    if (entry.manifestReason) {
      assert.ok(MANIFEST.validation_reasons[entry.manifestReason], entry.code);
    }
  }
  // Every criterion the rubric scores has exactly four one-point requirements.
  assert.deepEqual(RATING_RULES.map((rule) => rule.key),
    FINOPS_RUBRIC.criteria.map((criterion) => criterion.key));
  for (const rule of RATING_RULES) {
    assert.equal(rule.requirements.length, FINOPS_RUBRIC.scale.max);
  }
});

test("a manifest this normalizer was not built against rejects every file", async () => {
  const drifted = { ...MANIFEST, manifest_version: "2.0" };
  const result = normalizeFinopsExports(await validSelection(), drifted,
    { referenceTimestamp: VALID_REFERENCE });
  assert.equal(result.ok, false);
  assert.equal(result.status, "rejected");
  assert.equal(result.analysisInput, null);
  assert.deepEqual(codes(result), [NORMALIZATION_CODES.UNSUPPORTED_MANIFEST]);
  assert.match(result.outcomes[0].message, /2\.0/);
});

test("valid fixtures normalize into the scoring model's input, with provenance and flags", async () => {
  const result = normalizeFinopsExports(await validSelection(), MANIFEST,
    { referenceTimestamp: VALID_REFERENCE });

  assert.equal(result.ok, true);
  assert.equal(result.status, "accepted");
  assert.deepEqual(codes(result), []);

  const input = result.analysisInput;
  assert.equal(input.schemaVersion, ANALYSIS_INPUT_SCHEMA_VERSION);
  assert.equal(input.schemaVersion, SAMPLE_PAYLOAD.schemaVersion);
  assert.equal(input.origin, "local_import");
  assert.equal(input.provenance.processing, "browser_local_ephemeral");
  assert.equal(input.fixtures.length, 1);

  const [fixture] = input.fixtures;
  assert.equal(fixture.id, "local-psn-unit-demo-00000002");
  assert.match(fixture.id, /^[a-z0-9][a-z0-9-]{0,63}$/);
  assert.equal(fixture.department, "Department 00000002");
  assert.deepEqual(fixture.ratings, {
    recommendationQuality: 4, costEvidence: 4, uncertainty: 4,
    privacySafety: 4, departmentAttribution: 4,
  });
  for (const criterion of FINOPS_RUBRIC.criteria) {
    assert.match(fixture.evidence[criterion.key], /requirements met\./);
  }

  // Provenance traces the scored figure back to the record it came from.
  assert.equal(fixture.provenance.unitId, "psn_unit_demo_00000002");
  assert.equal(fixture.provenance.observedSpendUsd, 12.34);
  // Same rows, same arithmetic as the local projection: 1,234 minor over 420,000
  // tokens is above the premium floor, repriced at the reference rate to 630 minor.
  assert.equal(fixture.provenance.recoverableScenarioUsd, 6.04);
  // The scored figure carries the rule that produced it, not a bare share.
  assert.equal(fixture.provenance.downRouting.recoverableUsd, 6.04);
  assert.equal(fixture.provenance.downRouting.ruleVersion, "down-routing-candidate/1.0.0");
  assert.ok(fixture.provenance.downRouting.workedExample.length > 0,
    "an executive-facing figure must arrive with the arithmetic behind it");
  assert.deepEqual(fixture.provenance.providerRecords.map((record) => [
    record.recordId, record.revision, record.amountMinor, record.exportId, record.file,
  ]), [[
    "psn_aggregate_demo_0001", 2, 1234,
    "30000000-0000-4000-8000-000000000001", "provider-valid.json",
  ]]);
  assert.equal(fixture.provenance.hrisSource.recordId, "psn_unit_demo_00000002");
  assert.equal(fixture.provenance.hrisSource.file, "hris-valid.json");

  // Quality flags survive into the analysis input rather than being dropped.
  assert.deepEqual(fixture.quality.flags, []);
  assert.equal(fixture.quality.coverageState, "complete");
  assert.equal(fixture.quality.freshnessState, "fresh");
  assert.equal(input.coverage.state, "complete");
  assert.equal(input.coverage.acceptedProviderRecords, 1);
  assert.equal(input.coverage.unattributedProviderRecords, 0);
  assert.match(input.coverage.cannotAnswer.join(" "), /No peer benchmark/);
  assert.match(input.coverage.cannotAnswer.join(" "), /only one provider period/);

  // The payload is exactly what the existing scoring model and panel consume.
  const scored = scoreFinopsFixture(fixture);
  assert.equal(scored.score, 100);
  assert.equal(scored.label, "approved");
  assert.equal(scored.rubricVersion, FINOPS_RUBRIC.version);
  const panel = renderFinopsEvaluationPanel(input);
  assert.equal(byClass(panel, "evaluation-result").length, 1);
  assert.equal(byClass(panel, "evaluation-unavailable").length, 0);
});

test("malformed input is rejected safely and the valid sources beside it still normalize", async () => {
  const malformedOnly = normalizeFinopsExports([
    ...await selection("malformed", "provider"),
    ...await selection("valid", "hris"),
  ], MANIFEST, { referenceTimestamp: VALID_REFERENCE });
  assert.equal(malformedOnly.ok, false);
  assert.equal(malformedOnly.status, "rejected");
  assert.equal(malformedOnly.analysisInput, null);
  assert.deepEqual(codes(malformedOnly), [
    NORMALIZATION_CODES.MISSING_PROVIDER_EXPORT,
    NORMALIZATION_CODES.SCHEMA_OR_PRIVACY_VIOLATION,
  ]);
  const violation = malformedOnly.outcomes.find((item) =>
    item.code === NORMALIZATION_CODES.SCHEMA_OR_PRIVACY_VIOLATION);
  assert.equal(violation.severity, "error");
  assert.equal(violation.source.file, "provider-malformed.json");
  assert.equal(violation.manifestReason, "malformed");
  assert.equal(MANIFEST.validation_reasons.malformed.code, violation.code);

  // Partial acceptance is a decision, not an accident: it is on by default and
  // can be switched off at the call boundary.
  const mixed = [
    ...await selection("malformed", "provider"),
    ...await selection("valid", "provider"),
    ...await selection("valid", "hris"),
  ];
  const accepted = normalizeFinopsExports(mixed, MANIFEST,
    { referenceTimestamp: VALID_REFERENCE });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.status, "partially_accepted");
  assert.equal(accepted.analysisInput.fixtures.length, 1);
  assert.equal(accepted.analysisInput.coverage.rejectedSourceCount, 1);
  assert.match(accepted.analysisInput.coverage.cannotAnswer.join(" "), /1 selected file was rejected/);

  const atomic = normalizeFinopsExports(mixed, MANIFEST,
    { referenceTimestamp: VALID_REFERENCE, allowPartialAcceptance: false });
  assert.equal(atomic.ok, false);
  assert.equal(atomic.analysisInput, null);
});

test("partial coverage becomes an explicit limits descriptor, not a confident number", async () => {
  const result = normalizeFinopsExports([
    ...await selection("valid", "provider"),
    ...await selection("partial", "provider"),
    ...await selection("valid", "hris"),
  ], MANIFEST, { referenceTimestamp: VALID_REFERENCE });

  assert.equal(result.ok, true);
  assert.equal(result.status, "partially_accepted");
  const partial = result.outcomes.filter((item) =>
    item.code === NORMALIZATION_CODES.PARTIAL_EXPORT);
  assert.equal(partial.length, 1);
  assert.equal(partial[0].severity, "warning");
  assert.equal(partial[0].source.exportId, "30000000-0000-4000-8000-000000000002");
  assert.equal(partial[0].source.field, "snapshot.completeness");
  assert.equal(partial[0].manifestReason, "partial");
  assert.equal(MANIFEST.validation_reasons.partial.code, partial[0].code);

  const coverage = result.analysisInput.coverage;
  assert.equal(coverage.state, "partial");
  assert.equal(coverage.providerCompleteness, "partial");
  assert.equal(coverage.providerOmittedRecordCount, 3);
  assert.equal(coverage.declaredIssueCount, 1);
  assert.match(coverage.cannotAnswer.join(" "), /3 provider and 0 HRIS records were declared omitted/);

  // The missing coverage costs rating points instead of being hidden.
  const [fixture] = result.analysisInput.fixtures;
  assert.equal(fixture.ratings.costEvidence, 3);
  assert.equal(fixture.ratings.uncertainty, 3);
  assert.deepEqual(fixture.quality.requirements.costEvidence.unmet, ["complete_provider_coverage"]);
  assert.deepEqual(fixture.quality.requirements.uncertainty.unmet, ["complete_sources"]);
});

test("stale sources are flagged against the injected reference timestamp only", async () => {
  const files = [
    ...await selection("valid", "provider"),
    ...await selection("stale", "provider"),
    ...await selection("valid", "hris"),
  ];
  const result = normalizeFinopsExports(files, MANIFEST,
    { referenceTimestamp: VALID_REFERENCE, freshnessMaxAgeDays: 3 });

  const stale = result.outcomes.filter((item) => item.code === NORMALIZATION_CODES.STALE_EXPORT);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].severity, "warning");
  assert.equal(stale[0].source.exportId, "30000000-0000-4000-8000-000000000003");
  assert.equal(stale[0].source.field, "snapshot.generated_at");
  assert.equal(stale[0].manifestReason, "stale");
  assert.equal(MANIFEST.validation_reasons.stale.code, stale[0].code);
  assert.match(stale[0].message, /5\.3 days before 2026-07-25T18:00:00Z/);
  assert.equal(result.analysisInput.coverage.freshness.state, "stale");
  assert.equal(result.analysisInput.coverage.freshness.maxAgeDays, 3);
  assert.equal(result.analysisInput.fixtures[0].ratings.uncertainty, 3);

  // A wider target from the manifest's own quarantine window accepts the same file.
  const fresh = normalizeFinopsExports(files, MANIFEST, { referenceTimestamp: VALID_REFERENCE });
  assert.equal(fresh.analysisInput.coverage.freshness.maxAgeDays,
    MANIFEST.privacy.raw_quarantine_max_days);
  assert.equal(fresh.analysisInput.coverage.freshness.state, "fresh");

  // Without an injected timestamp the module refuses to guess; it reads no clock.
  const unevaluated = normalizeFinopsExports(files, MANIFEST);
  assert.ok(codes(unevaluated).includes(NORMALIZATION_CODES.FRESHNESS_NOT_EVALUATED));
  assert.equal(unevaluated.analysisInput.coverage.freshness.state, "not_evaluated");
  assert.equal(unevaluated.analysisInput.coverage.freshness.referenceTimestamp, null);
  assert.match(unevaluated.analysisInput.coverage.cannotAnswer.join(" "), /No freshness claim/);
});

test("duplicate deliveries collapse once under the documented identity rule", async () => {
  const result = normalizeFinopsExports([
    ...await selection("duplicated", "provider"),
    ...await selection("valid", "hris"),
  ], MANIFEST, { referenceTimestamp: VALID_REFERENCE });

  assert.equal(result.ok, true);
  const duplicates = result.outcomes.filter((item) =>
    item.code === NORMALIZATION_CODES.DUPLICATE_DELIVERY);
  assert.equal(duplicates.length, 2);
  assert.equal(duplicates[0].manifestReason, "duplicated");
  assert.equal(MANIFEST.validation_reasons.duplicated.code, duplicates[0].code);
  // One repeated envelope, one repeated record inside the retained envelope.
  assert.deepEqual(duplicates.map((item) => item.source.field).sort(),
    ["export_id", "records[].aggregate_id"]);
  const repeatedSource = duplicates.find((item) => item.source.field === "export_id");
  assert.equal(repeatedSource.source.file, "provider-duplicated-2.json");
  assert.match(repeatedSource.message, /provider-duplicated-1\.json/);
  const repeatedRecord = duplicates.find((item) => item.source.field === "records[].aggregate_id");
  assert.equal(repeatedRecord.source.recordId, "psn_aggregate_demo_0001");
  assert.equal(repeatedRecord.source.row, null);

  // Four delivered copies of one aggregate score exactly once.
  assert.equal(result.analysisInput.coverage.acceptedProviderRecords, 1);
  assert.equal(result.analysisInput.fixtures[0].provenance.observedSpendUsd, 13);
  assert.equal(result.analysisInput.fixtures[0].provenance.providerRecords.length, 1);
});

test("reordering files and rows changes nothing — no warning and no different figure", async () => {
  const base = [
    ...await selection("valid", "provider"),
    ...await selection("reordered", "provider"),
    ...await selection("valid", "hris"),
  ];
  const straight = normalizeFinopsExports(base, MANIFEST,
    { referenceTimestamp: VALID_REFERENCE });

  // A deterministic permutation: reverse the file order, and reverse the record
  // array inside every file.
  const shuffled = [...base].reverse().map((file) => {
    const document = JSON.parse(file.text);
    return { ...file, text: JSON.stringify({ ...document, records: [...document.records].reverse() }, null, 2) };
  });
  const permuted = normalizeFinopsExports(shuffled, MANIFEST,
    { referenceTimestamp: VALID_REFERENCE });

  assert.deepEqual(permuted.analysisInput, straight.analysisInput);
  assert.deepEqual(permuted.outcomes, straight.outcomes);
  assert.equal(JSON.stringify(permuted.analysisInput), JSON.stringify(straight.analysisInput));
  assert.deepEqual(permuted.analysisInput.fixtures.map(scoreFinopsFixture),
    straight.analysisInput.fixtures.map(scoreFinopsFixture));

  // Reordering is resolved silently: greatest revision wins, no ordering code.
  assert.deepEqual(codes(straight), []);
  assert.equal(straight.analysisInput.fixtures[0].provenance.providerRecords[0].revision, 4);
  assert.equal(straight.analysisInput.fixtures[0].provenance.observedSpendUsd, 13);
});

test("provider spend with no active HRIS unit is excluded, never defaulted", async () => {
  const result = normalizeFinopsExports([
    ...await selection("valid", "provider"),
    ...await selection("partial", "hris"),
  ], MANIFEST, { referenceTimestamp: VALID_REFERENCE });

  assert.equal(result.ok, false);
  assert.equal(result.analysisInput, null);
  assert.ok(codes(result).includes(NORMALIZATION_CODES.UNATTRIBUTED_PROVIDER_RECORD));
  assert.ok(codes(result).includes(NORMALIZATION_CODES.NO_SCOREABLE_UNIT));
  const unattributed = result.outcomes.find((item) =>
    item.code === NORMALIZATION_CODES.UNATTRIBUTED_PROVIDER_RECORD);
  assert.equal(unattributed.source.recordId, "psn_aggregate_demo_0001");
  assert.equal(unattributed.source.field, "records[].org_unit_id");

  const noHris = normalizeFinopsExports(await selection("valid", "provider"), MANIFEST,
    { referenceTimestamp: VALID_REFERENCE });
  assert.deepEqual(codes(noHris), [NORMALIZATION_CODES.MISSING_HRIS_MAPPING]);
});

test("the bundled sample stays the default until an import explicitly completes", async () => {
  const source = createFinopsAnalysisSource(SAMPLE_PAYLOAD);
  assert.equal(source.current().mode, "sample");
  assert.deepEqual(source.current().analysisInput, JSON.parse(SAMPLE_TEXT));
  assert.equal(JSON.stringify(source.current().analysisInput), JSON.stringify(JSON.parse(SAMPLE_TEXT)));

  // A rejected import never promotes and never blends.
  const failed = normalizeFinopsExports(await selection("malformed", "provider"), MANIFEST,
    { referenceTimestamp: VALID_REFERENCE });
  source.completeImport(failed);
  assert.equal(source.current().mode, "sample");
  assert.deepEqual(source.current().analysisInput, JSON.parse(SAMPLE_TEXT));
  assert.equal(source.current().failure.retainedMode, "sample");

  // A completed import is a single explicit transition.
  const imported = normalizeFinopsExports(await validSelection(), MANIFEST,
    { referenceTimestamp: VALID_REFERENCE });
  source.completeImport(imported);
  assert.equal(source.current().mode, "local");
  assert.equal(source.current().analysisInput, imported.analysisInput);
  assert.equal(source.current().failure, null);

  // A later failure surfaces; it does not silently restore sample numbers.
  source.completeImport(failed);
  assert.equal(source.current().mode, "local");
  assert.equal(source.current().analysisInput, imported.analysisInput);
  assert.equal(source.current().failure.retainedMode, "local");

  // Only the explicit reset returns to the untouched sample payload.
  source.reset();
  assert.equal(source.current().mode, "sample");
  assert.deepEqual(source.current().analysisInput, JSON.parse(SAMPLE_TEXT));
});

test("the module has no network, storage, credential, or clock path", async () => {
  for (const pattern of [
    /\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /localStorage/, /sessionStorage/,
    /indexedDB/, /document\.cookie/, /new WebSocket/, /EventSource/, /navigator\./,
    /\bimport\s*\(/, /require\s*\(/, /Date\.now|new Date\(/, /Math\.random/,
    /writeFile|readFile/,
  ]) {
    assert.doesNotMatch(NORMALIZER_SOURCE, pattern, `module must not reference ${pattern}`);
  }

  const files = await validSelection();
  const before = JSON.parse(JSON.stringify(files));
  const result = normalizeFinopsExports(files, MANIFEST, { referenceTimestamp: VALID_REFERENCE });
  assert.deepEqual(files, before);
  assert.doesNotThrow(() => JSON.stringify(result.analysisInput));
  assert.throws(() => {
    result.analysisInput.fixtures[0].ratings.costEvidence = 0;
  }, TypeError);
  assert.throws(() => {
    result.analysisInput.coverage.cannotAnswer.push("no");
  }, TypeError);
});

test("parseExports is total and reports the offending file for every rejection", async () => {
  const parsed = parseExports([
    { name: "usage.csv", mediaType: "text/csv", text: "a,b" },
    { name: "broken.json", mediaType: "application/json", text: "{" },
    { name: "repeated.json", mediaType: "application/json", text: '{"kind":"a","kind":"b"}' },
    { name: "empty.json", mediaType: "application/json" },
    ...await selection("valid", "provider"),
  ], MANIFEST);

  assert.deepEqual(codes(parsed).sort(), [
    NORMALIZATION_CODES.DUPLICATE_JSON_KEY,
    NORMALIZATION_CODES.INVALID_JSON,
    NORMALIZATION_CODES.UNSUPPORTED_FILE_FORMAT,
    NORMALIZATION_CODES.UNSUPPORTED_FILE_FORMAT,
  ]);
  for (const outcome of parsed.outcomes) assert.match(outcome.source.file, /\S/);
  assert.equal(parsed.sources.length, 1);
  assert.equal(parsed.sources[0].contract, "provider_export");
  assert.match(
    parsed.outcomes.find((item) => item.source.file === "usage.csv").message,
    /unsupported format/,
  );

  // Non-array input and an empty selection are answers, not exceptions.
  assert.equal(parseExports(undefined, MANIFEST).ok, false);
  assert.equal(normalize(parseExports([], MANIFEST)).status, "rejected");
});
