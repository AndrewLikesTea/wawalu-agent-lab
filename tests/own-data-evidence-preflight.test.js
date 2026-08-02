import assert from "node:assert/strict";
import test from "node:test";
import {
  assessOwnDataEvidence, BUNDLED_OWN_DATA_EVIDENCE, EVIDENCE_PREFLIGHT_OUTCOME,
  requiredSpendCoverage,
} from "../src/own-data-evidence-preflight.js";
import {
  OWN_DATA_VIEW_STATE, bindOwnDataEvidencePreflight, renderOwnDataEvidencePreflight,
  renderOwnDataEvidenceState,
} from "../src/own-data-evidence-preflight-view.js";
import { createElement } from "./support/dom.js";

const row = (classification = "Engineering", costAmount = 10) => ({ classification, costAmount });

// The stub is built from the ids the shipped page actually carries, so an id
// renamed on one side and not the other fails here instead of blanking a
// region in the browser.
async function pageDocument() {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
  const nodes = Object.fromEntries([...page.matchAll(/id="(own-data-[a-z-]+)"/g)]
    .map(([, id]) => [id, createElement("p")]));
  return {
    page,
    nodes,
    document: {
      createElement,
      createTextNode: (text) => { const n = createElement("#text"); n.textContent = text; return n; },
      getElementById: (id) => nodes[id] ?? null,
    },
  };
}

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

test("the view fills every region the shipped page provides", async () => {
  const { nodes, document } = await pageDocument();
  const assessment = assessOwnDataEvidence(BUNDLED_OWN_DATA_EVIDENCE);
  assert.equal(renderOwnDataEvidencePreflight(document, assessment), true);
  assert.equal(nodes["own-data-evidence-preflight"].dataset.outcome, assessment.outcome);
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

test("loading and validation errors are announced without publishing a stale classification", async () => {
  const { nodes, document } = await pageDocument();

  assert.equal(renderOwnDataEvidenceState(document, OWN_DATA_VIEW_STATE.LOADING), true);
  assert.equal(nodes["own-data-evidence-preflight"].dataset.outcome, "loading");
  assert.equal(nodes["own-data-evidence-preflight"].getAttribute("aria-busy"), "true");
  assert.match(nodes["own-data-preflight-status"].textContent, /Not yet classified.*local.*No file.*retained/i);
  assert.match(nodes["own-data-preflight-benchmark"].textContent, /Not evaluated/);

  assert.equal(renderOwnDataEvidenceState(document, OWN_DATA_VIEW_STATE.VALIDATION_ERROR), true);
  assert.equal(nodes["own-data-evidence-preflight"].focused, 1);
  assert.equal(nodes["own-data-evidence-preflight"].getAttribute("tabindex"), "-1");
  assert.match(nodes["own-data-preflight-confidence"].textContent, /Not classified/);
  assert.match(nodes["own-data-preflight-action"].textContent, /choose the export again/i);
  // Every reserved state restates the local boundary, not only the first one a
  // reader happens to see: a rejected file is the moment they most want to know
  // the bytes were read in this tab and dropped.
  assert.match(nodes["own-data-preflight-status"].textContent, /local/i);

  // Recovering from the error releases what the error state took: the busy
  // flag, the outcome, and the container's programmatic focus stop, so the
  // region is not left holding a focus target for a state that has passed.
  renderOwnDataEvidencePreflight(document, assessOwnDataEvidence(BUNDLED_OWN_DATA_EVIDENCE));
  assert.equal(nodes["own-data-evidence-preflight"].getAttribute("tabindex"), null);
  assert.equal(nodes["own-data-evidence-preflight"].getAttribute("aria-busy"), "false");
  assert.match(nodes["own-data-preflight-status"].textContent, /local/i);
});

// The whole region exists to separate a supported result from an
// evidence-limited one, so the supported result cannot carry the limited one's
// caveat. The bundled example has corroborating query rows and says so two
// lines below in its provenance; a blanket "incomplete query evidence"
// sentence would contradict the verdict it sits beside.
test("a supported result does not carry the evidence-limited query caveat", async () => {
  const { nodes, document } = await pageDocument();
  const supported = assessOwnDataEvidence(BUNDLED_OWN_DATA_EVIDENCE);
  assert.equal(supported.outcome, EVIDENCE_PREFLIGHT_OUTCOME.COMPLETE);
  assert.equal(renderOwnDataEvidencePreflight(document, supported), true);
  assert.match(nodes["own-data-preflight-confidence"].textContent, /^Supported ·/);
  assert.doesNotMatch(nodes["own-data-preflight-confidence"].textContent,
    /Incomplete query evidence/i);
  assert.match(nodes["own-data-preflight-provenance"].textContent, /corroborate/i);

  // The state that is genuinely short of query evidence still says so.
  const limited = assessOwnDataEvidence({ providerRows: BUNDLED_OWN_DATA_EVIDENCE.providerRows });
  assert.equal(limited.outcome, EVIDENCE_PREFLIGHT_OUTCOME.PROVIDER_EXPORT_ONLY);
  assert.equal(renderOwnDataEvidencePreflight(document, limited), true);
  assert.match(nodes["own-data-preflight-confidence"].textContent,
    /^Provider export only · .*Incomplete query evidence limits classification confidence\.$/);
});

// A second file lands on a region the first one filled. The headline, benchmark
// and confidence are all retired by the reserved states — but provenance is the
// figure a reader expands to check, and it is per-evidence, so it has to be
// retired with them. Leaving it behind attributes the last accepted export's
// row counts to a file that was never read.
test("a reserved state retires the previous export's provenance", async () => {
  const { nodes, document } = await pageDocument();
  renderOwnDataEvidencePreflight(document, assessOwnDataEvidence(BUNDLED_OWN_DATA_EVIDENCE));
  assert.equal(nodes["own-data-preflight-provenance"].children.length, 2);
  assert.match(nodes["own-data-preflight-provenance"].textContent, /10 spend rows/);

  for (const state of [OWN_DATA_VIEW_STATE.LOADING, OWN_DATA_VIEW_STATE.VALIDATION_ERROR]) {
    renderOwnDataEvidenceState(document, state);
    const provenance = nodes["own-data-preflight-provenance"];
    assert.equal(provenance.children.length, 1, `${state} states one provenance line`);
    assert.equal(provenance.firstChild.dataset.available, "false");
    assert.doesNotMatch(provenance.textContent, /10 spend rows/,
      `${state} must not inherit the last export's accepted rows`);
  }
  // The boundary is the static contract, identical on every render, so it is
  // not stale and stays put rather than blinking out under the reader.
  assert.equal(nodes["own-data-preflight-boundary"].children.length,
    assessOwnDataEvidence(BUNDLED_OWN_DATA_EVIDENCE).boundary.length);
});

// Both renderers return a boolean the page branches on: `evolution-page.js`
// paints the validation-error state when the projection render reports false.
// A missing node has to reach that branch as `false`, not as a TypeError that
// surfaces to the reader as "your file is broken".
test("a page missing a preflight node reports false instead of throwing", async () => {
  const { nodes, document } = await pageDocument();
  const assessment = assessOwnDataEvidence(BUNDLED_OWN_DATA_EVIDENCE);
  for (const id of ["own-data-preflight-status", "own-data-preflight-benchmark",
    "own-data-preflight-action"]) {
    const held = nodes[id];
    delete nodes[id];
    assert.equal(renderOwnDataEvidencePreflight(document, assessment), false, id);
    assert.equal(renderOwnDataEvidenceState(document, OWN_DATA_VIEW_STATE.LOADING), false, id);
    nodes[id] = held;
  }
  assert.equal(renderOwnDataEvidencePreflight(document, assessment), true);
});

test("provenance uses one native keyboard disclosure and mirrors its announced state", async () => {
  const { readFile } = await import("node:fs/promises");
  const page = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
  assert.match(page, /<details class="own-data-preflight-disclosure"/);
  assert.match(page, /<summary id="own-data-preflight-disclosure-summary" aria-expanded="false"/);
  assert.match(page, /Incomplete query evidence limits classification confidence/);

  const disclosure = createElement("details");
  const summary = createElement("summary");
  const state = createElement("span");
  const document = { getElementById: (id) => ({
    "own-data-preflight-disclosure": disclosure,
    "own-data-preflight-disclosure-summary": summary,
    "own-data-preflight-disclosure-state": state,
  }[id] ?? null) };
  assert.equal(bindOwnDataEvidencePreflight(document), true);
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  disclosure.open = true;
  disclosure.dispatch("toggle");
  assert.equal(summary.getAttribute("aria-expanded"), "true");
  assert.equal(state.textContent, "Hide");
  assert.equal(bindOwnDataEvidencePreflight(document), false, "binding is idempotent");
});

test("narrow and wide layouts retain source order and use only existing state tokens", async () => {
  const { readFile } = await import("node:fs/promises");
  const [page, css] = await Promise.all([
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution.css", import.meta.url), "utf8"),
  ]);
  const order = ["own-data-preflight-question", "own-data-preflight-finding",
    "own-data-preflight-benchmark", "own-data-preflight-confidence",
    "own-data-preflight-action", "own-data-preflight-disclosure"];
  assert.deepEqual([...order].sort((a, b) => page.indexOf(a) - page.indexOf(b)), order);
  assert.match(css, /own-data-preflight-measures[^}]*grid-template-columns:repeat\(2/);
  assert.match(css, /@media\(max-width:640px\).*own-data-preflight-measures.*grid-template-columns:1fr/);
  const rules = css.slice(css.indexOf(".own-data-preflight {"), css.indexOf(".local-import-heading"));
  assert.doesNotMatch(rules, /#[0-9a-f]{3,8}/i, "the component introduces no color literals");
  for (const token of ["--import-accent", "--import-wash", "--state-warn-line",
    "--state-error-line", "--focus-ring"]) assert.match(rules, new RegExp(token));
});
