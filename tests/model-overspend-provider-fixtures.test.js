import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseLocalFinopsFile } from "../src/local-finops.js";
import {
  MODEL_OVERSPEND_SOURCE_COLUMNS, projectModelOverspendFinding,
} from "../src/provider-export-projection.js";
import {
  MODEL_OVERSPEND_PROVIDER_FIXTURES,
} from "../src/model-overspend-provider-fixtures.js";
import { renderModelOverspendFinding } from "../src/model-overspend-finding-view.js";
import { parseHtml, textOf } from "./support/browser.js";

const pathFor = (fixture) => new URL(`../src${fixture.url}`, import.meta.url);

async function execute(fixture, mutate = (document) => document) {
  const text = await readFile(pathFor(fixture), "utf8");
  const parsed = parseLocalFinopsFile(text, fixture.url, "application/json");
  return projectModelOverspendFinding(mutate(structuredClone(parsed.document)));
}

for (const fixture of MODEL_OVERSPEND_PROVIDER_FIXTURES) {
  test(`provider routing fixture: ${fixture.id}`, async () => {
    const result = await execute(fixture);
    assert.ok(fixture.assumption.length >= 100, "each gate states its policy assumption");
    assert.equal(result.finding.metric.available, fixture.expected.metricAvailable);
    assert.equal(result.finding.metric.amountMinor ?? null, fixture.expected.amountMinor ?? null);
    assert.equal(result.confidence, fixture.expected.confidence);
    assert.deepEqual(result.withholding.map(({ code }) => code), fixture.expected.withholding);
    assert.equal(result.provenance.processing, "in_browser_memory_only");
    assert.deepEqual(result.provenance.columns, MODEL_OVERSPEND_SOURCE_COLUMNS);

    const source = JSON.parse(await readFile(pathFor(fixture), "utf8"));
    assert.equal(source.privacy.direct_identifiers_included, false);
    assert.equal(source.privacy.content_included, false);
    assert.doesNotMatch(JSON.stringify(source), /prompt|response|customer|credential|api[_ -]?key/i);
  });
}

test("eligible arithmetic, provenance, confidence weights, and sorting are reproducible", async () => {
  const fixture = MODEL_OVERSPEND_PROVIDER_FIXTURES[0];
  const result = await execute(fixture);
  const { finding } = result;
  assert.deepEqual({ observed: finding.metric.observedSpendMinor,
    projected: finding.metric.projectedSpendMinor, recoverable: finding.metric.amountMinor },
  { observed: 310000, projected: 77500, recoverable: 232500 });
  assert.equal(finding.metric.observedSpendMinor - finding.metric.projectedSpendMinor,
    finding.metric.amountMinor);
  assert.equal(finding.metric.formula,
    "projected = round(31000 requests x 77500 minor / 31000 requests) = 77500 minor; overspend = 310000 - 77500 = 232500 minor");
  assert.deepEqual(finding.confidence.reasons.map(({ code, effect }) => [code, effect]), [
    ["single_period", "lowered one level"],
    ["prorated_partial_month", "lowered one level"],
  ]);
  assert.deepEqual(finding.evidence.rows.map(({ model }) => model),
    ["synthetic-premium", "synthetic-economy"]);

  const reversed = await execute(fixture, (document) =>
    ({ ...document, records: [...document.records].reverse() }));
  assert.deepEqual(reversed, result, "source order cannot change a score or tie-break");
});

test("the rendered eligible finding makes no unsupported quality claim", async () => {
  const result = await execute(MODEL_OVERSPEND_PROVIDER_FIXTURES[0]);
  const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
  const doc = parseHtml(html);
  renderModelOverspendFinding(doc, result.finding);
  const rendered = textOf(doc.getElementById("model-overspend"));
  assert.match(rendered, /evidences routing candidacy, not equivalence/i);
  assert.doesNotMatch(rendered, /(same|equal|maintains?|preserves?) quality/i);
});

test("the shipped analysis example names the provider fixture and production import path", async () => {
  const entry = await readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8");
  assert.match(entry, /JSON\.stringify\(payload\.provider_export\)/);
  assert.match(entry, /parseLocalFinopsFile\(text,/);
  assert.match(entry, /projectModelOverspendFinding\(parsed\.document\)\.finding/);
  assert.match(entry, /renderModelOverspendFinding\(document, overspendFinding/);

  const specimen = JSON.parse(await readFile(
    new URL("../src/model-overspend-finding-fixture.json", import.meta.url), "utf8"));
  const canonical = JSON.parse(await readFile(pathFor(MODEL_OVERSPEND_PROVIDER_FIXTURES[0]), "utf8"));
  assert.deepEqual(specimen.provider_export, canonical,
    "the rendered envelope must remain byte-for-byte equivalent to the labelled fixture");
});
