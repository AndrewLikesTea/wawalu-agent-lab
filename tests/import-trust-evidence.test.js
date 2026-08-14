import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { importTrustEvidence, resultWithTrustEvidence } from "../src/import-trust-evidence.js";
import { renderImportTrustEvidence } from "../src/import-trust-evidence-view.js";
import { projectProviderExport } from "../src/provider-export-projection.js";
import { parseHtml, textOf } from "./support/browser.js";

const page = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
const fixtureUrl = new URL(
  "../contracts/integrations/provider-usage-billing/v1/fixtures/valid.json", import.meta.url,
);

async function evidence(mutator = () => {}) {
  const input = JSON.parse(await readFile(fixtureUrl, "utf8"));
  mutator(input);
  return importTrustEvidence({ projection: projectProviderExport(input), intakeConfidence: {
    status: "scored", score: 90, grade: "A",
  } });
}

test("one result model owns readiness, recognition, mapping, compatibility, and provenance", async () => {
  const trust = await evidence();
  assert.equal(trust.version, "import-trust-evidence/1.0.0");
  assert.deepEqual(trust.facts.map((fact) => fact.id),
    ["readiness", "recognition", "mapping", "compatibility", "provenance"]);
  assert.equal(trust.outcome, "provider-export-only");
  assert.equal(Object.isFrozen(trust), true);
  const result = resultWithTrustEvidence({ period: "June" }, trust);
  assert.equal(result.trustEvidence, trust);
  assert.equal(Object.isFrozen(result), true);
});

test("incomplete and spend-only exports remain partial results with truthful limits", async () => {
  const partial = await evidence((input) => {
    input.snapshot.completeness = "partial";
    input.snapshot.omitted_record_count = 2;
  });
  assert.equal(partial.state, "partial");
  assert.match(partial.facts[0].detail, /Insufficient evidence/);
  assert.match(partial.limitations.join(" "), /omitted/);

  const spendOnly = await evidence((input) => {
    for (const row of input.records) row.org_unit_id = "";
  });
  assert.equal(spendOnly.state, "partial");
  assert.equal(spendOnly.outcome, "spend-only");
  assert.match(spendOnly.nextAction, /grouping/i);
});

test("the shipped result has one keyboard-native trust disclosure and reset clears it", async () => {
  const doc = parseHtml(page);
  const authored = doc.getElementById("local-trust-evidence");
  assert.ok(authored);
  assert.ok(page.indexOf('id="local-trust-evidence"') > page.indexOf('id="local-results"'));
  assert.equal(doc.querySelectorAll("summary").filter((node) =>
    /How far to trust this result/.test(textOf(node))).length, 1);
  assert.equal(doc.getElementById("own-data-evidence-preflight").hidden, true,
    "superseded pre-result trust presentation must remain unavailable");
  const trust = await evidence();
  assert.equal(renderImportTrustEvidence(doc, trust), true);
  const details = doc.getElementById("local-trust-evidence");
  const summary = doc.getElementById("local-trust-evidence-summary");
  assert.equal(details.hidden, false);
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  details.open = true;
  details.dispatchEvent({ type: "toggle" });
  assert.equal(summary.getAttribute("aria-expanded"), "true");
  assert.match(textOf(doc.getElementById("local-trust-evidence-facts")), /Parser readiness/);

  renderImportTrustEvidence(doc, null);
  assert.equal(details.hidden, true);
  assert.equal(details.open, false);
  assert.equal(textOf(doc.getElementById("local-trust-evidence-facts")), "");
});

test("rejected projections have no result-associated trust evidence", () => {
  assert.equal(importTrustEvidence({ projection: { ok: false } }), null);
  assert.deepEqual(resultWithTrustEvidence({ period: "June" }, null), { period: "June" });
});
