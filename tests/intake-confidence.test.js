import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { scoreIntakeConfidence, INTAKE_CONFIDENCE_RUBRIC,
  INTAKE_CONFIDENCE_VERSION } from "../src/intake-confidence.js";
import { renderIntakeConfidence } from "../src/intake-confidence-view.js";
import { createElement, first } from "./support/dom.js";

const labelled = JSON.parse(await readFile(
  new URL("fixtures/intake-confidence.json", import.meta.url), "utf8"));

function input(changes = {}) {
  const snapshot = {
    source_instance_id: "psn_synthetic_source", sequence: 1,
    generated_at: "2026-08-02T00:00:00Z", period_start: "2026-07-01",
    period_end: "2026-08-01", completeness: "complete", omitted_record_count: 0, issues: [],
    ...Object.fromEntries(Object.entries(changes).filter(([key]) =>
      ["period_start", "period_end", "completeness", "omitted_record_count"].includes(key))),
  };
  const record = { usage_date: changes.usage_date ?? "2026-07-02",
    org_unit_id: changes.org_unit_id ?? "psn_synthetic_group", provider: "openai",
    service_category: "text-generation", usage: { quantity: 10, unit: "tokens" },
    cost: { amount_minor: 50, currency: "USD", status: "final" } };
  const evidence = changes.sourceRows === undefined ? null : {
    rowCounts: { source: changes.sourceRows, analyzed: changes.analyzedRows },
  };
  return { document: { snapshot, records: changes.emptyRecords ? [] : [record] },
    importEvidence: evidence, origin: changes.origin ?? "locally_selected_file" };
}

test("labelled intake fixtures pin all four factors and invalid reversed bounds", () => {
  assert.equal(labelled.contract, INTAKE_CONFIDENCE_VERSION);
  for (const fixture of labelled.fixtures) {
    const result = scoreIntakeConfidence(input(fixture.changes));
    assert.equal(result.status, fixture.expected.status, fixture.label);
    assert.equal(result.grade, fixture.expected.grade, fixture.label);
    assert.equal(result.score, fixture.expected.score, fixture.label);
    if (fixture.expected.remediation) {
      assert.match(result.remediation, new RegExp(fixture.expected.remediation, "i"), fixture.label);
    }
    if (fixture.expected.provenance) {
      assert.equal(result.provenance.label, fixture.expected.provenance, fixture.label);
    }
  }
});

// A top grade is where an over-claim does the damage: nothing is flagged, so the
// one line a leader reads has to admit that the period factor is the provider's
// own word. Two records, one attested and one measured, must not read alike.
test("a perfect score still discloses what the period factor never verified", () => {
  const result = scoreIntakeConfidence(input());
  assert.equal(result.score, 100);
  assert.match(result.explanation, /Declared period completeness 100% × 25%/);
  assert.match(result.remediation, /provider's own declaration and was not independently verified/);
});

test("non-scores name the export they rejected and never publish a grade", () => {
  for (const changes of [{ emptyRecords: true }, { usage_date: "2026-08-02" }]) {
    const result = scoreIntakeConfidence(input(changes));
    assert.equal(result.score, null);
    assert.deepEqual(result.components, []);
    assert.equal(result.period, "2026-07-01 to 2026-08-01");
  }
  // Bounds that cannot be read cannot name a period either, so the field is
  // absent rather than echoing an unparsable string back as fact.
  assert.equal(scoreIntakeConfidence(input({ period_end: "2026-07-01" })).period, null);
});

test("identical normalized inputs yield identical grades and explanations", () => {
  const first = scoreIntakeConfidence(input({ sourceRows: 4, analyzedRows: 3 }));
  const cloned = JSON.parse(JSON.stringify(input({ sourceRows: 4, analyzedRows: 3 })));
  const second = scoreIntakeConfidence(cloned);
  assert.equal(first.grade, second.grade);
  assert.equal(first.explanation, second.explanation);
  assert.deepEqual(first, second);
});

test("rubric weights are complete and explanations expose every weighted factor", () => {
  assert.equal(Object.values(INTAKE_CONFIDENCE_RUBRIC.weights).reduce((a, b) => a + b), 100);
  const result = scoreIntakeConfidence(input());
  for (const component of result.components) {
    assert.match(result.explanation, new RegExp(`${component.label}.*${component.weight}%`));
  }
  assert.deepEqual(result.provenance,
    { kind: "locally_selected_file", label: "Locally selected file" });
});

test("missing or unparsable bounds are non-scores and never calculate coverage", () => {
  for (const period_start of [undefined, "not-a-date", "2026-02-30"]) {
    const candidate = input();
    candidate.document.snapshot.period_start = period_start;
    const result = scoreIntakeConfidence(candidate);
    assert.equal(result.status, "invalid_period");
    assert.equal(result.score, null);
    assert.deepEqual(result.components, []);
    assert.match(result.explanation, /Coverage was not calculated/);
  }
});

test("confidence view renders only concise result fields", () => {
  const root = createElement("section");
  const doc = { createElement, getElementById: (id) => id === "intake-confidence" ? root : null };
  const result = scoreIntakeConfidence(input());
  renderIntakeConfidence(doc, result);
  assert.equal(root.hidden, false);
  assert.equal(root.dataset.status, "scored");
  assert.equal(first(root, "intake-confidence-grade").textContent, "Grade A · 100/100");
  assert.match(root.textContent, /Locally selected file/);
  // The verdict has to name the export it judged: several provider files leave
  // one finding on screen, and an unlabelled one belongs to any of them.
  assert.match(root.textContent, /2026-07-01 to 2026-08-01/);
  assert.equal(first(root, "intake-confidence-remediation").textContent, result.remediation);
  renderIntakeConfidence(doc, scoreIntakeConfidence(input({ origin: "bundled_example" })));
  assert.match(root.textContent, /Bundled synthetic example/);
  assert.doesNotMatch(root.textContent, /Locally selected file/);
});

test("AI FinOps intake imports, scores, and renders selected normalized providers", async () => {
  const [html, page] = await Promise.all([
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="intake-confidence"/);
  assert.match(page, /scoreIntakeConfidence\(\{ document: parsed\.document/);
  assert.equal((page.match(/paintIntakeConfidence\(parsed\)/g) ?? []).length, 2);
  // The bundled example earns its own finding under its own provenance, and the
  // panel is cleared first so a reader's own verdict cannot sit under invented
  // figures — the one confusion this surface exists to prevent.
  assert.match(page, /clearIntakeConfidence\(document\);\n    try \{\n      const inputs = loadExampleDatasetInputs/);
  assert.match(page, /paintIntakeConfidence\(latest, "bundled_example"\)/);
});

test("the bundled example scores under its own provenance without a stale verdict", async () => {
  const { loadExampleDatasetInputs } = await import("../src/example-dataset.js");
  const latest = loadExampleDatasetInputs().providers.at(-1);
  const result = scoreIntakeConfidence({ document: latest.document,
    importEvidence: latest.importEvidence, origin: "bundled_example" });
  assert.equal(result.provenance.kind, "bundled_example");
  assert.equal(result.status, "scored");
  assert.equal(result.period, `${latest.document.snapshot.period_start} to `
    + `${latest.document.snapshot.period_end}`);
});
