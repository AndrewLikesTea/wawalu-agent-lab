import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BLANK_GROUP_PSEUDONYM } from "../src/attribution-units.js";
import { MAX_IMPORT_BYTES } from "../src/import-limits.js";
import { EVIDENCE_PREFLIGHT_OUTCOME } from "../src/own-data-evidence-preflight.js";
import {
  parseProviderExport, projectProviderExport, providerExportPreflight,
  PROVIDER_EXPORT_ERROR, PROVIDER_EXPORT_PROJECTION_VERSION,
} from "../src/provider-export-projection.js";
import { renderProviderExportProjection } from "../src/provider-export-projection-view.js";
import { createElement } from "./support/dom.js";

const contract = (name) => new URL(
  `../contracts/integrations/provider-usage-billing/v1/fixtures/${name}.json`, import.meta.url,
);

async function fixture(name) {
  return JSON.parse(await readFile(contract(name), "utf8"));
}

const provider = () => fixture("valid");

test("a valid provider export has deterministic spend, coverage, confidence, and one action", async () => {
  const document = await provider();
  document.schema_version = "1.1";
  Object.assign(document.records[0], {
    model_raw: "gpt-4o", model_tier: "premium", request_count: 12,
    input_tokens: 300000, output_tokens: 120000,
  });
  const text = JSON.stringify(document);
  const parsed = parseProviderExport({
    text, fileName: "provider.json", mediaType: "application/json", byteSize: text.length,
  });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.result.version, PROVIDER_EXPORT_PROJECTION_VERSION);
  assert.deepEqual(parsed.result.spend, { amountMinor: 1234, amountUsd: 12.34, currency: "USD" });
  assert.equal(parsed.result.departmentCoverage.rowRatio, 1);
  assert.equal(parsed.result.classificationEvidence.ratio, 1);
  assert.equal(parsed.result.classificationEvidence.queryLevelCertainty, "not_claimed");
  assert.equal(parsed.result.provenance.processing, "in_browser_memory_only");
  assert.equal(parsed.result.confidence.level, "bounded");
  assert.deepEqual(parsed.result.confidence.limitations, []);
  assert.equal(parsed.result.actions.length, 1);
  assert.equal(parsed.result.actions[0].code, "collect_query_corroboration");
  // A billing export can never reach the preflight's `complete` outcome; that
  // one requires query-sample corroboration this input cannot supply.
  assert.equal(parsed.result.preflightOutcome,
    EVIDENCE_PREFLIGHT_OUTCOME.PROVIDER_EXPORT_ONLY);
  assert.deepEqual(projectProviderExport(document), parsed.result);

  const duplicate = structuredClone(document.records[0]);
  duplicate.revision = 1;
  duplicate.cost.amount_minor = 9999;
  const reordered = { ...document, records: [duplicate, document.records[0]] };
  const projected = projectProviderExport(reordered);
  assert.deepEqual(projected.spend, parsed.result.spend,
    "an older duplicate revision cannot change the projection");
  assert.equal(projected.provenance.supersededRows, 1);
  assert.equal(projected.provenance.conflictingRevisions, 0);
});

test("missing department attribution is counted in rows and dollars and prioritized first", async () => {
  const document = await provider();
  const unattributed = structuredClone(document.records[0]);
  unattributed.aggregate_id = "psn_aggregate_demo_0002";
  unattributed.org_unit_id = BLANK_GROUP_PSEUDONYM;
  unattributed.cost.amount_minor = 366;
  document.records.push(unattributed);

  const result = projectProviderExport(document);
  assert.equal(result.ok, true);
  assert.deepEqual(result.spend, { amountMinor: 1600, amountUsd: 16, currency: "USD" });
  assert.deepEqual(result.departmentCoverage, {
    attributedRows: 1, totalRows: 2, rowRatio: 0.5,
    attributedSpendUsd: 12.34, totalSpendUsd: 16, spendRatio: 1234 / 1600,
  });
  assert.equal(result.confidence.level, "limited");
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].code, "collect_department_attribution");
  assert.equal(result.preflightOutcome, EVIDENCE_PREFLIGHT_OUTCOME.INSUFFICIENT);
});

test("provider-only v1 evidence never claims query-level classification certainty", async () => {
  const result = projectProviderExport(await provider());
  assert.equal(result.classificationEvidence.completeRows, 0);
  assert.equal(result.classificationEvidence.ratio, 0);
  assert.equal(result.classificationEvidence.queryLevelCertainty, "not_claimed");
  assert.match(result.classificationEvidence.limitation, /do not establish query-level/i);
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].code, "collect_classification_evidence");
});

test("an export that declares itself partial cannot be presented as a whole total", async () => {
  const [document, partial] = await Promise.all([provider(), fixture("partial")]);
  document.snapshot = partial.snapshot;

  const result = projectProviderExport(document);
  assert.equal(result.ok, true);
  // The total still adds up the rows that are present; nothing is inferred for
  // the three the export says it withheld.
  assert.equal(result.spend.amountMinor, 1234);
  assert.deepEqual(result.completeness, {
    declared: "partial", omittedRecordCount: 3,
    issueCodes: ["group_suppressed"], complete: false,
  });
  assert.equal(result.confidence.level, "limited");
  assert.equal(result.actions[0].code, "collect_complete_export");
  assert.equal(result.preflightOutcome, EVIDENCE_PREFLIGHT_OUTCOME.INSUFFICIENT,
    "full row attribution must not clear the benchmark for a partial export");
  assert.match(result.confidence.limitations[0], /3 omitted records/);
});

test("an export with zero declared issues but omitted records is still incomplete", async () => {
  const document = await provider();
  document.snapshot = { ...document.snapshot, omitted_record_count: 2 };
  const result = projectProviderExport(document);
  assert.equal(result.completeness.complete, false);
  assert.equal(result.actions[0].code, "collect_complete_export");
});

test("estimated charges are summed, named, and claim the action once nothing else is missing", async () => {
  const document = await provider();
  document.schema_version = "1.1";
  Object.assign(document.records[0], {
    model_raw: "gpt-4o", model_tier: "premium", request_count: 12,
    input_tokens: 300000, output_tokens: 120000,
  });
  document.records[0].cost.status = "estimated";

  const result = projectProviderExport(document);
  assert.deepEqual(result.costBasis, {
    basis: "mixed_estimated", finalRows: 0, estimatedRows: 1, estimatedSpendUsd: 12.34,
  });
  assert.equal(result.spend.amountMinor, 1234, "an estimated row is counted, not dropped");
  assert.equal(result.confidence.level, "limited");
  assert.equal(result.actions[0].code, "collect_final_costs");
});

test("two rows sharing an aggregate and a revision are reported, not silently merged", async () => {
  const document = await provider();
  const conflicting = structuredClone(document.records[0]);
  conflicting.cost.amount_minor = 4321;
  document.records.push(conflicting);

  const result = projectProviderExport(document);
  assert.equal(result.provenance.conflictingRevisions, 1);
  assert.equal(result.provenance.recordCount, 1);
  assert.equal(result.confidence.level, "limited");
  assert.equal(result.actions[0].code, "collect_complete_export");
  // Deterministic across input order: the same pair projects to the same winner.
  assert.deepEqual(projectProviderExport({ ...document, records: [...document.records].reverse() }),
    result);
});

test("malformed, oversized, and unsupported files return stable safe errors", async () => {
  const hris = await readFile(new URL(
    "../contracts/integrations/hris-org/v1/fixtures/valid.json", import.meta.url,
  ), "utf8");
  const cases = [
    [parseProviderExport({ text: "{private contents", fileName: "bad.json" }),
      PROVIDER_EXPORT_ERROR.MALFORMED],
    [parseProviderExport({ text: "", fileName: "large.json", byteSize: MAX_IMPORT_BYTES + 1 }),
      PROVIDER_EXPORT_ERROR.OVERSIZED],
    [parseProviderExport({ text: "a,b", fileName: "billing.csv", mediaType: "text/csv" }),
      PROVIDER_EXPORT_ERROR.UNSUPPORTED],
    [parseProviderExport({ text: hris, fileName: "roster.json" }),
      PROVIDER_EXPORT_ERROR.UNSUPPORTED],
  ];
  for (const [result, code] of cases) {
    assert.equal(result.ok, false);
    assert.equal(result.error.code, code);
    assert.deepEqual(Object.keys(result.error).sort(), ["code", "message", "recovery"]);
    assert.doesNotMatch(`${result.error.message} ${result.error.recovery}`, /private contents|aggregate/i);
  }
});

test("unsafe and unreadable record fields fail closed instead of publishing a number", async () => {
  const document = await provider();
  const second = structuredClone(document.records[0]);
  document.records[0].cost.amount_minor = Number.MAX_SAFE_INTEGER;
  second.aggregate_id = "psn_aggregate_demo_0002";
  second.cost.amount_minor = 1;
  document.records.push(second);
  assert.equal(projectProviderExport(document).error.code, PROVIDER_EXPORT_ERROR.MALFORMED);

  // `projectProviderExport` is exported for callers holding a validated
  // document, but a caller that is wrong about that gets an error, not a throw.
  const unreadable = await provider();
  unreadable.records[0].cost.amount_minor = "1234";
  assert.equal(projectProviderExport(unreadable).error.code, PROVIDER_EXPORT_ERROR.MALFORMED);
  assert.equal(projectProviderExport({ ...unreadable, snapshot: undefined }).error.code,
    PROVIDER_EXPORT_ERROR.UNSUPPORTED);
});

test("the selected-provider projection paints the shipped preflight region", async () => {
  const page = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
  const nodes = Object.fromEntries([...page.matchAll(/id="(own-data-[a-z-]+)"/g)]
    .map(([, id]) => [id, createElement("p")]));
  const document = {
    createElement,
    createTextNode: (text) => { const node = createElement("#text"); node.textContent = text; return node; },
    getElementById: (id) => nodes[id] ?? null,
  };
  const result = projectProviderExport(await provider());
  assert.equal(renderProviderExportProjection(document, result), true);

  // The region is styled from a closed vocabulary; a projection-only word here
  // would leave a below-benchmark export looking like a passing one.
  assert.equal(nodes["own-data-evidence-preflight"].dataset.outcome,
    EVIDENCE_PREFLIGHT_OUTCOME.PROVIDER_EXPORT_ONLY);
  assert.ok(Object.values(EVIDENCE_PREFLIGHT_OUTCOME)
    .includes(nodes["own-data-evidence-preflight"].dataset.outcome));
  assert.match(nodes["own-data-preflight-finding"].textContent, /\$12\.34/);
  assert.match(nodes["own-data-preflight-confidence"].textContent, /query-level classification/i);
  assert.equal(nodes["own-data-preflight-provenance"].children.length, 3);
  assert.equal(nodes["own-data-preflight-boundary"].children.length, 5);
  assert.match(nodes["own-data-preflight-action"].textContent, /query sample/i);
  assert.equal(renderProviderExportProjection(document, { ok: false }), false);
});

test("the preflight restatement never contradicts the projection it restates", async () => {
  const document = await provider();
  const unattributed = structuredClone(document.records[0]);
  unattributed.aggregate_id = "psn_aggregate_demo_0002";
  unattributed.org_unit_id = BLANK_GROUP_PSEUDONYM;
  document.records.push(unattributed);

  const result = projectProviderExport(document);
  const assessment = providerExportPreflight(result);
  assert.equal(assessment.outcome, EVIDENCE_PREFLIGHT_OUTCOME.INSUFFICIENT);
  assert.equal(assessment.sufficient, false);
  assert.equal(assessment.verdict, "Insufficient evidence");
  assert.equal(assessment.coverage.coveredRows, result.departmentCoverage.attributedRows);
  assert.equal(assessment.coverage.totalRows, result.departmentCoverage.totalRows);
  assert.equal(assessment.nextAction, result.actions[0].text);
  assert.equal(assessment.provenance.at(-1).available, false,
    "no query evidence is ever reported as present from a billing export");
});

test("the live workspace wires JSON and mapped provider exports into the projection", async () => {
  const entry = await readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8");
  assert.match(entry, /import\("\/provider-export-projection\.js"\)/);
  assert.match(entry, /const projection = projectProviderExport\(providerDocument\)/);
  assert.match(entry, /renderProviderExportProjection\(document, projection\)/);
  assert.equal((entry.match(/await paintProviderProjection\(parsed\.document\)/g) ?? []).length, 3);
});
