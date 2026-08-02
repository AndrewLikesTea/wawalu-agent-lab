import assert from "node:assert/strict";
import test from "node:test";
import {
  assessOwnDataEvidence, BUNDLED_OWN_DATA_EVIDENCE, EVIDENCE_PREFLIGHT_OUTCOME,
  requiredSpendCoverage,
} from "../src/own-data-evidence-preflight.js";
import { renderOwnDataEvidencePreflight } from "../src/own-data-evidence-preflight-view.js";
import { createElement } from "./support/dom.js";

const row = (classification = "Engineering", costAmount = 10) => ({ classification, costAmount });

test("required spend coverage counts rows by one precise rule", () => {
  const coverage = requiredSpendCoverage([
    row(), row("", 5), row("Finance", -1), row("Product", Number.POSITIVE_INFINITY),
    row("Support", "12"), row("  Legal  ", 0),
  ]);
  assert.deepEqual(coverage, { coveredRows: 2, totalRows: 6, ratio: 1 / 3, percent: (1 / 3) * 100 });
  assert.deepEqual(requiredSpendCoverage([]), { coveredRows: 0, totalRows: 0, ratio: 0, percent: 0 });
});

test("complete: sufficient provider rows plus optional query evidence permits a scoped decision", () => {
  const result = assessOwnDataEvidence({
    providerRows: Array.from({ length: 10 }, () => row()),
    querySampleRows: [{ classification: "Engineering" }],
  });
  assert.equal(result.outcome, EVIDENCE_PREFLIGHT_OUTCOME.COMPLETE);
  assert.equal(result.sufficient, true);
  assert.equal(result.coverage.ratio, 1);
  assert.match(result.confidence, /decision-ready within the supplied export/i);
  assert.equal(result.provenance[1].available, true);
  assert.ok(result.nextAction);
});

test("provider-export-only: coverage at the benchmark is bounded without query corroboration", () => {
  const result = assessOwnDataEvidence({
    providerRows: [...Array.from({ length: 9 }, () => row()), row("")],
  });
  assert.equal(result.outcome, EVIDENCE_PREFLIGHT_OUTCOME.PROVIDER_EXPORT_ONLY);
  assert.equal(result.coverage.ratio, 0.9);
  assert.match(result.confidence, /limited to fields present in the provider export/i);
  assert.match(result.provenance[1].detail, /no lookup is attempted/i);
  assert.match(result.nextAction, /one optional query sample/i);
});

test("insufficient: thin or empty provider evidence refuses a trustworthy claim", () => {
  for (const providerRows of [
    [...Array.from({ length: 8 }, () => row()), row(""), row("")],
    [],
  ]) {
    const result = assessOwnDataEvidence({ providerRows, querySampleRows: [row()] });
    assert.equal(result.outcome, EVIDENCE_PREFLIGHT_OUTCOME.INSUFFICIENT);
    assert.equal(result.sufficient, false);
    assert.match(result.confidence, /no trustworthy department-spend decision/i);
    assert.match(result.nextAction, /at least 90%/i);
  }
});

test("query rows without a usable classification corroborate nothing", () => {
  const providerRows = Array.from({ length: 10 }, () => row());
  for (const querySampleRows of [[{}], [null], [{ classification: "  " }], [{ classification: "" }]]) {
    const result = assessOwnDataEvidence({ providerRows, querySampleRows });
    assert.equal(result.outcome, EVIDENCE_PREFLIGHT_OUTCOME.PROVIDER_EXPORT_ONLY);
    assert.equal(result.provenance[1].available, false);
    assert.match(result.provenance[1].detail, /no lookup is attempted/i);
  }
  const corroborated = assessOwnDataEvidence({
    providerRows, querySampleRows: [{ classification: "Engineering" }, {}],
  });
  assert.equal(corroborated.outcome, EVIDENCE_PREFLIGHT_OUTCOME.COMPLETE);
  assert.match(corroborated.provenance[1].detail, /^1 query-sample rows/);
});

test("a coverage figure below the benchmark never prints as the benchmark", () => {
  const result = assessOwnDataEvidence({
    providerRows: [...Array.from({ length: 1799 }, () => row()),
      ...Array.from({ length: 201 }, () => row(""))],
  });
  assert.equal(result.coverage.ratio, 0.8995);
  assert.equal(result.outcome, EVIDENCE_PREFLIGHT_OUTCOME.INSUFFICIENT);
  assert.match(result.finding, /89\.9%/);
  assert.doesNotMatch(result.finding, /(^|[^.\d])90%/);
});

test("every assessment carries the static-demo boundary it renders", () => {
  const { boundary } = assessOwnDataEvidence({ providerRows: [row()] });
  assert.ok(boundary.length > 0);
  const stated = boundary.join(" ");
  for (const term of [/credential/i, /persist/i, /prompt content/i, /HRIS/i]) {
    assert.match(stated, term);
  }
});

// The stub is built from the ids the shipped page actually carries, so an id
// renamed on one side and not the other fails here instead of blanking a
// region in the browser.
test("the view fills every region the shipped page provides", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
  const nodes = Object.fromEntries([...page.matchAll(/id="(own-data-[a-z-]+)"/g)]
    .map(([, id]) => [id, createElement("p")]));
  const document = {
    createElement,
    createTextNode: (text) => { const n = createElement("#text"); n.textContent = text; return n; },
    getElementById: (id) => nodes[id] ?? null,
  };
  const assessment = assessOwnDataEvidence(BUNDLED_OWN_DATA_EVIDENCE);
  assert.equal(renderOwnDataEvidencePreflight(document, assessment), true);
  assert.equal(nodes["own-data-evidence-preflight"].dataset.outcome, assessment.outcome);
  assert.equal(nodes["own-data-evidence-preflight"].dataset.source, "bundled-example");
  assert.match(nodes["own-data-preflight-source"].textContent, /bundled local example/);
  assert.equal(nodes["own-data-preflight-boundary"].children.length, assessment.boundary.length);
  assert.match(nodes["own-data-preflight-boundary"].textContent, /No credentials/);
  assert.equal(nodes["own-data-preflight-provenance"].children.length, 2);
  assert.match(nodes["own-data-preflight-action"].textContent, /\S/);
});

test("the shipped page wires one preflight question, finding, benchmark, provenance, and action", async () => {
  const { readFile } = await import("node:fs/promises");
  const [page, entry] = await Promise.all([
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8"),
  ]);
  assert.match(page, /id="own-data-evidence-preflight"/);
  assert.match(page, /Can this export support a trustworthy department-spend decision\?/);
  assert.equal((page.match(/id="own-data-preflight-action"/g) ?? []).length, 1);
  assert.match(entry, /renderOwnDataEvidencePreflight\(document, assessOwnDataEvidence/);
  // The boundary ships empty and is filled from the contract, so the page
  // cannot state a boundary the module no longer honours.
  assert.match(page, /<ul id="own-data-preflight-boundary"><\/ul>/);
});
