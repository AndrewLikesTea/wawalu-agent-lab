import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  localFinopsJsonExport,
  localFinopsMeetingSummary,
  normalizeLocalFinops,
  normalizeLocalFinopsHistory,
  parseLocalFinopsFile,
} from "../src/local-finops.js";

const FIXTURES = new URL("../contracts/integrations/", import.meta.url);

async function fixture(path) {
  return JSON.parse(await readFile(new URL(path, FIXTURES), "utf8"));
}

async function validPair() {
  return {
    provider: {
      document: await fixture("provider-usage-billing/v1/fixtures/valid.json"),
    },
    hris: {
      document: await fixture("hris-org/v1/fixtures/valid.json"),
    },
  };
}

test("local parser accepts only the manifest-declared JSON contract envelopes", async () => {
  const provider = await fixture("provider-usage-billing/v1/fixtures/valid.json");
  const parsed = parseLocalFinopsFile(JSON.stringify(provider), "billing.json", "application/json");
  assert.equal(parsed.type, "provider");
  assert.deepEqual(parsed.document, provider);

  assert.throws(() => parseLocalFinopsFile("a,b", "billing.csv", "text/csv"),
    (error) => error.code === "unsupported_format" && /CSV/.test(error.message));
  assert.throws(() => parseLocalFinopsFile("{}", "billing.json", "application/json"),
    (error) => error.code === "missing_field");
  assert.throws(() => parseLocalFinopsFile(JSON.stringify({ ...provider, prompt: "secret" }), "bad.json"),
    (error) => error.code === "unknown_field");
  assert.throws(() => parseLocalFinopsFile('{"kind":"first","kind":"second"}', "duplicate.json"),
    (error) => error.code === "duplicate_key");
});

test("privacy and nested unknown-field violations fail closed", async () => {
  const provider = await fixture("provider-usage-billing/v1/fixtures/valid.json");
  assert.throws(() => parseLocalFinopsFile(JSON.stringify({
    ...provider,
    privacy: { ...provider.privacy, content_included: true },
  }), "content.json"), (error) => error.code === "privacy_violation");
  assert.throws(() => parseLocalFinopsFile(JSON.stringify({
    ...provider,
    records: [{
      ...provider.records[0],
      cost: { ...provider.records[0].cost, converted_by: "remote-rate-service" },
    }],
  }), "unknown.json"), (error) => error.code === "unknown_field");
  assert.throws(() => parseLocalFinopsFile(JSON.stringify({
    ...provider,
    records: [{ ...provider.records[0], cost: { ...provider.records[0].cost, currency: "EUR" } }],
  }), "eur.json"), (error) => error.code === "unsupported_currency");
});

test("normalization joins exact active units and produces a bounded ranked action", async () => {
  const pair = await validPair();
  const result = normalizeLocalFinops(pair);

  assert.equal(result.spendUsd, 12.34);
  assert.equal(result.recoverableUsd, 2.47);
  assert.equal(result.topDepartment.id, "psn_unit_demo_00000002");
  assert.equal(result.topDepartment.name, "Department …000002");
  assert.equal(result.confidence, "Low");
  assert.match(result.action, /Pilot lower-cost routing/);
  assert.match(result.assumptions.join(" "), /20%/);
  assert.match(result.limits.join(" "), /No benchmark.*No trend.*No prompt-quality/s);
  assert.equal(result.quality.joinedRecords, 1);
  assert.equal(result.quality.quarantinedRecords, 0);
});

test("unmatched, partial, and estimated data remain explicit quality context", async () => {
  const pair = await validPair();
  pair.provider.document = structuredClone(pair.provider.document);
  pair.provider.document.snapshot.completeness = "partial";
  pair.provider.document.snapshot.omitted_record_count = 2;
  pair.provider.document.records[0].org_unit_id = "psn_unit_missing_000001";
  pair.provider.document.records[0].cost.status = "estimated";
  const result = normalizeLocalFinops(pair);

  assert.equal(result.spendUsd, 0);
  assert.equal(result.recoverableUsd, 0);
  assert.equal(result.topDepartment, null);
  assert.equal(result.quality.quarantinedRecords, 1);
  assert.match(result.warnings.join(" "), /quarantined.*partial/s);
  assert.match(result.action, /Resolve data-quality gaps/);
});

test("local history derives a same-source equal-period organization and department trend", async () => {
  const pair = await validPair();
  const previous = structuredClone(pair.provider);
  const current = structuredClone(pair.provider);
  previous.document.export_id = "11111111-1111-4111-8111-111111111111";
  previous.document.snapshot.period_start = "2026-05-01";
  previous.document.snapshot.period_end = "2026-06-01";
  previous.document.records[0].cost.amount_minor = 1000;
  current.document.export_id = "22222222-2222-4222-8222-222222222222";
  current.document.snapshot.period_start = "2026-06-01";
  current.document.snapshot.period_end = "2026-07-02";
  current.document.records[0].cost.amount_minor = 1250;

  const result = normalizeLocalFinopsHistory({
    providers: [current, previous],
    hris: pair.hris,
  });
  assert.equal(result.history.state, "available");
  assert.equal(result.history.organizationSpendChangePercent, 25);
  assert.equal(result.topDepartment.spendChangePercent, 25);
  assert.equal(result.history.periodCount, 2);
  assert.equal(result.benchmark.state, "unavailable");
  assert.match(result.benchmark.message, /no compatible peer cohort/);
});

test("missing history and incompatible periods are explicit and never flattened", async () => {
  const pair = await validPair();
  const single = normalizeLocalFinopsHistory({
    providers: [pair.provider], hris: pair.hris,
  });
  assert.equal(single.history.state, "missing");
  assert.equal(single.history.organizationSpendChangePercent, null);

  const prior = structuredClone(pair.provider);
  const current = structuredClone(pair.provider);
  prior.document.export_id = "11111111-1111-4111-8111-111111111111";
  prior.document.snapshot.period_start = "2026-04-01";
  prior.document.snapshot.period_end = "2026-05-01";
  current.document.export_id = "22222222-2222-4222-8222-222222222222";
  current.document.snapshot.period_start = "2026-06-01";
  current.document.snapshot.period_end = "2026-07-01";
  const incompatible = normalizeLocalFinopsHistory({
    providers: [prior, current], hris: pair.hris,
  });
  assert.equal(incompatible.history.state, "incompatible");
  assert.equal(incompatible.history.organizationTrendAvailable, false);
  assert.match(incompatible.history.message, /not contiguous/);

  current.document.snapshot.source_instance_id = "another-source";
  assert.throws(() => normalizeLocalFinopsHistory({
    providers: [prior, current], hris: pair.hris,
  }), (error) => error.code === "incompatible_periods");
});

test("exports contain decision results, provenance, quality, limits, and privacy context", async () => {
  const result = normalizeLocalFinops(await validPair());
  const json = JSON.parse(localFinopsJsonExport(result));
  assert.equal(json.results.recoverableUsd, 2.47);
  assert.deepEqual(json.results.quality.warnings, result.warnings);
  assert.match(json.results.provenance, /Browser-local projection/);

  const summary = localFinopsMeetingSummary(result);
  assert.match(summary, /Recoverable scenario: 2\.47 USD/);
  assert.match(summary, /Confidence: Low/);
  assert.match(summary, /Data quality:/);
  assert.match(summary, /Limits: No benchmark/);
  assert.match(summary, /no upload, credentials, network transfer, or persistence after refresh/);
});

test("the page exposes an accessible local workflow and progressive disclosures", async () => {
  const [page, script, styles] = await Promise.all([
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /type="file" accept="\.json,application\/json" multiple/);
  assert.match(page, /role="status" aria-live="polite"/);
  assert.match(page, /No upload · no credentials · no network transfer · no browser storage/);
  for (const label of [
    "Period-level detail", "Mapping assumptions", "Data-quality warnings", "Benchmark and trend limits",
    "Recommendation evidence",
  ]) assert.match(page, new RegExp(`<summary>${label}`));
  assert.match(page, /<ol id="local-department-list".*aria-label="Departments ordered by recoverable scenario"/);
  assert.match(page, /id="local-trend-state"/);
  assert.match(page, /id="local-benchmark-state"/);
  assert.match(page, /id="export-local-json"/);
  assert.match(page, /id="export-local-summary"/);

  // The finding face leads with the decision, then impact, department,
  // benchmark, and provenance before supporting trend evidence.
  const finding = page.slice(page.indexOf('<article class="local-finding"'),
    page.indexOf('<div class="local-state-grid"'));
  for (const label of [
    "Recommended department action", "Quantified impact", "Department", "Benchmark", "Data provenance",
  ]) assert.match(finding, new RegExp(label));
  assert.ok(finding.indexOf("Recommended department action") < finding.indexOf("Quantified impact"));
  assert.ok(finding.indexOf("Quantified impact") < finding.indexOf("Benchmark"));
  assert.ok(finding.indexOf("Benchmark") < finding.indexOf("Data provenance"));

  // Trend and benchmark have programmatic names and descriptions; glyphs are
  // hidden accelerators beside equivalent visible words and values.
  assert.match(page, /id="local-trend-state" aria-labelledby="local-trend-title" aria-describedby="local-trend-why"/);
  assert.match(page, /id="local-benchmark-state" aria-labelledby="local-benchmark-title" aria-describedby="local-benchmark-why"/);
  assert.match(page, /id="local-trend-shape" aria-hidden="true"/);
  assert.match(script, /↑ Increase.*↓ Decrease.*→ No change/s);

  // Every department disclosure is keyboard-native and exposes its changing
  // state, controlled region, and understandable action.
  assert.match(script, /button\.setAttribute\("aria-expanded"/);
  assert.match(script, /button\.setAttribute\("aria-controls", panelId\)/);
  assert.match(script, /panel\.setAttribute\("role", "region"\)/);
  assert.match(script, /finding for \$\{department\.name\}/);
  assert.match(styles, /\.local-import button:focus-visible/);
  assert.match(styles, /@media\(max-width:640px\)[\s\S]*\.local-finding-facts\s*\{\s*grid-template-columns:1fr/);
});

test("local findings draw loading, empty, error, and implausible-value states", async () => {
  const [page, script, styles] = await Promise.all([
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution.css", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Reading files in this tab|Ready for local files/);
  assert.match(page, /id="local-result-notice" role="status" aria-live="polite" hidden/);
  assert.match(script, /No department finding available/);
  assert.match(script, /This file was not analyzed/);
  assert.match(script, /MAX_DISPLAY_USD = 1_000_000_000_000/);
  assert.match(script, /Needs review · value withheld/);
  assert.match(script, /recoverable spend exceeds observed spend/);
  assert.match(styles, /\.local-result-notice\[data-state="error"\]/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|indexedDB/);
});
