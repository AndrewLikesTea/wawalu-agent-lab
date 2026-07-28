// The savings-commitment contract, its arithmetic, and the preview that renders it.
//
// Two things are pinned here above everything else:
//
//   1. THE ARITHMETIC IS REPRODUCIBLE. Every money figure is integer USD minor
//      units and the one saving rule is max(0, baseline - projected) over the
//      identical workload and month. A candidate whose two sides name different
//      scopes or months is rejected, not reconciled.
//   2. AN INCOMPLETE COMMITMENT IS REFUSED, not rendered with the gaps filled
//      in. The invalid table below is the list of ways a commitment can be
//      incomplete or ambiguous, and each one must throw.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { byClass, installDocument, tags } from "./support/dom.js";

installDocument();

const {
  CONFIDENCE_SCALE,
  SAVINGS_COMMITMENT_QUESTION,
  SAVINGS_COMMITMENT_VERSION,
  SavingsCommitmentValidationError,
  buildSavingsCommitment,
  confidenceBand,
  loadSavingsCommitment,
  projectedMonthlySavingsMinor,
  validateSavingsCommitment,
} = await import("../src/savings-commitment.js");
const {
  renderSavingsCommitment, renderSavingsCommitmentError,
} = await import("../src/savings-commitment-view.js");

const FIXTURE_URL = new URL("../src/savings-commitment-fixture.json", import.meta.url);
const FIXTURE = JSON.parse(await readFile(FIXTURE_URL, "utf8"));

const analysis = () => structuredClone(FIXTURE);
const candidate = (input, id) => input.candidates.find((item) => item.candidateId === id);
const throws = (fn) => assert.throws(fn, SavingsCommitmentValidationError);

/* ------------------------------ the arithmetic ----------------------------- */

test("projected monthly savings is baseline minus projected, floored at zero", () => {
  assert.equal(projectedMonthlySavingsMinor(4820000, 1690000), 3130000);
  assert.equal(projectedMonthlySavingsMinor(1240000, 1240000), 0);
  // A projection above its own baseline is not a negative saving; it is no saving.
  assert.equal(projectedMonthlySavingsMinor(1000000, 1750000), 0);
  assert.equal(projectedMonthlySavingsMinor(0, 0), 0);
});

test("money is integer minor units; a float dollar amount is refused, never rounded", () => {
  throws(() => projectedMonthlySavingsMinor(4820.5, 100));
  throws(() => projectedMonthlySavingsMinor(-1, 0));
  const input = analysis();
  candidate(input, "syn-commit-support-triage").baseline.monthlyCostMinor = 48200.5;
  throws(() => buildSavingsCommitment(input));
});

test("confidence bands are derived from the integer percent at the stated thresholds", () => {
  assert.equal(CONFIDENCE_SCALE.min, 0);
  assert.equal(CONFIDENCE_SCALE.max, 100);
  assert.deepEqual([0, 49, 50, 74, 75, 100].map(confidenceBand),
    ["low", "low", "medium", "medium", "high", "high"]);
});

/* --------------------------- the one commitment ---------------------------- */

test("the bundled analysis yields exactly one prioritized commitment, fully specified", () => {
  const preview = buildSavingsCommitment(analysis());

  assert.equal(preview.schemaVersion, SAVINGS_COMMITMENT_VERSION);
  assert.equal(preview.question, SAVINGS_COMMITMENT_QUESTION);
  assert.equal(preview.status, "ok");
  assert.equal(preview.designation, "fixture");

  const { commitment } = preview;
  assert.equal(commitment.rank, 1);
  assert.equal(commitment.commitmentId, "syn-commit-support-triage");
  // Every field the question needs answered, in one object.
  assert.equal(commitment.department.departmentId, "syn-dept-customer-operations");
  assert.equal(commitment.accountableOwner.role, "Synthetic Director of Customer Operations");
  assert.equal(commitment.routing.currentRoute.modelId, "syn-model-frontier-a");
  assert.equal(commitment.routing.proposedRoute.modelId, "syn-model-mid-b");
  assert.equal(commitment.baseline.monthlyCostMinor, 4820000);
  assert.equal(commitment.projectedMonthlySavings.amountMinor, 3130000);
  assert.equal(commitment.projectedMonthlySavings.amountUsd, 31300);
  assert.equal(commitment.confidence.percent, 72);
  assert.equal(commitment.confidence.value, 0.72);
  assert.equal(commitment.confidence.band, "medium");
  assert.equal(commitment.provenance.sourceId, "syn-finops-analysis-2026-06");
  assert.equal(commitment.provenance.importedAt, "2026-07-08T14:20:00Z");
  assert.deepEqual([...commitment.provenance.recordIds],
    ["syn-rec-support-triage-frontier", "syn-rec-support-triage-mid"]);
  assert.equal(commitment.provenance.designation, "fixture");
  assert.match(commitment.projectedMonthlySavings.formula,
    /max\(0, 4820000 - 1690000\) = 3130000 minor units, for syn-workload-support-triage in 2026-06/);
});

test("the loser and the zero-saving candidate are set aside, each with the reason it lost", () => {
  const preview = buildSavingsCommitment(analysis());
  assert.equal(preview.consideredCount, 3);
  assert.equal(preview.eligibleCount, 2);
  assert.deepEqual(preview.excluded.map((item) => item.candidateId),
    ["syn-commit-batch-summaries", "syn-commit-code-review"]);
  assert.match(preview.excluded[0].reason, /A larger monthly saving is proposed first.*\$10,850\.00/);
  assert.match(preview.excluded[1].reason, /projects no monthly cost reduction/);
});

test("ranking is savings, then confidence, then id — and is order-independent", () => {
  const input = analysis();
  const reversed = { ...input, candidates: [...input.candidates].reverse() };
  assert.deepEqual(buildSavingsCommitment(reversed), buildSavingsCommitment(input));

  // Tie the savings exactly: batch now also saves 3,130,000, at 81% against
  // support triage's 72%, so the higher confidence takes the tie.
  const tied = analysis();
  const batch = candidate(tied, "syn-commit-batch-summaries");
  batch.baseline.monthlyCostMinor = 3130000;
  batch.projected.monthlyCostMinor = 0;
  assert.equal(buildSavingsCommitment(tied).commitment.commitmentId, "syn-commit-batch-summaries");
});

test("an analysis where nothing beats its own baseline answers plainly instead of at zero", () => {
  const input = analysis();
  for (const item of input.candidates) {
    item.projected.monthlyCostMinor = item.baseline.monthlyCostMinor;
  }
  const preview = buildSavingsCommitment(input);
  assert.equal(preview.status, "no_commitment");
  assert.equal(preview.commitment, null);
  assert.equal(preview.eligibleCount, 0);
  assert.match(preview.reason, /nothing to commit to yet/);
});

test("the built preview is deeply frozen, so two reads of one analysis cannot disagree", () => {
  const preview = buildSavingsCommitment(analysis());
  assert.ok(Object.isFrozen(preview.commitment.projectedMonthlySavings));
  assert.ok(Object.isFrozen(preview.commitment.provenance.recordIds));
  assert.throws(() => { preview.commitment.confidence.percent = 99; }, TypeError);
});

test("the downstream action implementation is documented as depending on this contract", () => {
  const { downstream } = buildSavingsCommitment(analysis());
  assert.equal(downstream.dependsOnContract, SAVINGS_COMMITMENT_VERSION);
  assert.equal(downstream.implemented, false);
  assert.equal(downstream.documentation, "docs/savings-commitment-contract.md");
  assert.ok(downstream.requiredFieldsForDownstream.includes("commitment.provenance"));
  assert.ok(downstream.requiredFieldsForDownstream.includes("commitment.baseline.monthlyCostMinor"));
});

/* ------------------------- incomplete and ambiguous ------------------------ */

// Each row is one way a commitment is incomplete or ambiguous. None may build.
const INVALID = [
  ["a missing accountable department id", (input) => {
    delete candidate(input, "syn-commit-support-triage").department.departmentId;
  }],
  ["a department identifier read off a UI label rather than the import", (input) => {
    candidate(input, "syn-commit-support-triage").department.departmentId = "Customer Operations";
  }],
  ["a placeholder department identifier", (input) => {
    candidate(input, "syn-commit-support-triage").department.departmentId = "unassigned";
  }],
  ["a missing accountable owner", (input) => {
    delete candidate(input, "syn-commit-support-triage").accountableOwner;
  }],
  ["a missing routing recommendation", (input) => {
    delete candidate(input, "syn-commit-support-triage").routing;
  }],
  ["a proposed route identical to the current route", (input) => {
    candidate(input, "syn-commit-support-triage").routing.proposedRoute.modelId
      = "syn-model-frontier-a";
  }],
  ["routing evidence with no records behind it", (input) => {
    candidate(input, "syn-commit-support-triage").routing.evidence = [];
  }],
  ["routing evidence omitted from the commitment provenance", (input) => {
    candidate(input, "syn-commit-support-triage").recordIds
      = ["syn-rec-support-triage-frontier"];
  }],
  ["a routing recommendation scoped to a different workload", (input) => {
    candidate(input, "syn-commit-support-triage").routing.workloadId = "syn-workload-code-review";
  }],
  ["a projection measured against a different workload than its baseline", (input) => {
    candidate(input, "syn-commit-support-triage").projected.workloadId = "syn-workload-code-review";
  }],
  ["a projection measured against a different month than its baseline", (input) => {
    candidate(input, "syn-commit-support-triage").projected.period = "2026-05";
  }],
  ["a missing baseline", (input) => {
    delete candidate(input, "syn-commit-support-triage").baseline;
  }],
  ["a confidence outside the declared 0-100 range", (input) => {
    candidate(input, "syn-commit-support-triage").confidence.percent = 101;
  }],
  ["a fractional confidence, which two engineers would round differently", (input) => {
    candidate(input, "syn-commit-support-triage").confidence.percent = 72.5;
  }],
  ["a confidence with no stated basis", (input) => {
    delete candidate(input, "syn-commit-support-triage").confidence.basis;
  }],
  ["a hand-asserted confidence band", (input) => {
    candidate(input, "syn-commit-support-triage").confidence.band = "high";
  }],
  ["a commitment citing a record the analysis does not contain", (input) => {
    candidate(input, "syn-commit-support-triage").recordIds = ["syn-rec-not-in-this-import"];
  }],
  ["a commitment citing no records at all", (input) => {
    candidate(input, "syn-commit-support-triage").recordIds = [];
  }],
  ["a commitment repeating a provenance record", (input) => {
    candidate(input, "syn-commit-support-triage").recordIds
      = ["syn-rec-support-triage-frontier", "syn-rec-support-triage-frontier"];
  }],
  ["provenance with no import timestamp", (input) => { delete input.source.importedAt; }],
  ["provenance with no source identifier", (input) => { delete input.source.sourceId; }],
  ["an undeclared fixture-or-import designation", (input) => {
    input.source.designation = "production";
  }],
  ["a unit this contract does not carry", (input) => { input.source.unit = "usd"; }],
  ["a currency this contract does not carry", (input) => { input.source.currency = "EUR"; }],
  ["an unversioned analysis", (input) => { delete input.schemaVersion; }],
  ["two candidates claiming the same id", (input) => {
    input.candidates[1].candidateId = "syn-commit-support-triage";
  }],
  ["an analysis with no candidates", (input) => { input.candidates = []; }],
  ["a smuggled credential field", (input) => {
    candidate(input, "syn-commit-support-triage").providerApiKey = "syn-value";
  }],
  ["a smuggled prompt body", (input) => {
    candidate(input, "syn-commit-support-triage").routing.promptExcerpt = "syn text";
  }],
  ["a credential hiding in an innocently named field", (input) => {
    candidate(input, "syn-commit-support-triage").routing.rationale
      = "Authorization: Bearer abcdefghijklmnop";
  }],
];

for (const [description, mutate] of INVALID) {
  test(`rejects ${description}`, () => {
    const input = analysis();
    mutate(input);
    throws(() => buildSavingsCommitment(input));
  });
}

test("output validation catches a payload edited after it was built", () => {
  const preview = structuredClone(buildSavingsCommitment(analysis()));
  preview.commitment.projectedMonthlySavings.amountMinor = 9999999;
  throws(() => validateSavingsCommitment(preview));

  const twoAnswers = structuredClone(buildSavingsCommitment(analysis()));
  twoAnswers.reason = "and also there is nothing to do";
  throws(() => validateSavingsCommitment(twoAnswers));

  const undeclared = structuredClone(buildSavingsCommitment(analysis()));
  undeclared.annualizedSavingsUsd = 375600;
  throws(() => validateSavingsCommitment(undeclared));
});

/* --------------------------------- the preview ----------------------------- */

test("the preview answers the six questions in the order a leader asks them", () => {
  const view = renderSavingsCommitment(buildSavingsCommitment(analysis()));

  assert.match(tags(view, "H2")[0].textContent,
    /Route first-pass support ticket triage from syn-model-frontier-a to syn-model-mid-b, saving \$31,300\.00 a month against a \$48,200\.00 2026-06 baseline\./);
  assert.match(byClass(view, "commit-kicker")[0].textContent,
    /Proposed commitment 1 of 1 · What should we commit to now\?/);
  assert.equal(byClass(view, "commit-designation")[0].dataset.designation, "fixture");

  assert.deepEqual(tags(byClass(view, "commit-owner")[0], "DT").map((node) => node.textContent),
    ["Accountable department", "Accountable owner", "Workload scope"]);
  assert.match(byClass(view, "commit-owner")[0].textContent,
    /Synthetic Customer Operations.*syn-dept-customer-operations.*Synthetic Director of Customer Operations/s);

  assert.equal(byClass(view, "commit-route")[0].textContent,
    "syn-model-frontier-a → syn-model-mid-b");

  assert.deepEqual(tags(byClass(view, "commit-metrics")[0], "DT").map((node) => node.textContent),
    ["Projected monthly savings", "Baseline monthly cost (2026-06)", "Projected monthly cost",
      "Confidence"]);
  assert.match(byClass(view, "commit-metrics")[0].textContent,
    /\$31,300\.00.*\$48,200\.00.*\$16,900\.00.*72% · medium/s);
});

test("provenance and the set-aside candidates are progressively disclosed, not headline", () => {
  const view = renderSavingsCommitment(buildSavingsCommitment(analysis()));
  const details = tags(view, "DETAILS");
  assert.equal(details.length, 1);
  assert.match(tags(view, "SUMMARY")[0].textContent, /Inspect provenance and what was set aside/);

  const body = byClass(view, "commit-provenance-body")[0];
  assert.match(body.textContent, /syn-finops-analysis-2026-06/);
  assert.match(body.textContent, /2026-07-08T14:20:00Z/);
  assert.match(body.textContent, /syn-rec-support-triage-frontier, syn-rec-support-triage-mid/);
  assert.match(body.textContent, /designated fixture/);
  assert.equal(tags(byClass(view, "commit-excluded")[0], "LI").length, 2);
  assert.match(body.textContent, new RegExp(SAVINGS_COMMITMENT_VERSION));

  // The headline half of the card must not carry the record ids.
  assert.doesNotMatch(byClass(view, "commit-header")[0].textContent, /syn-rec-/);
});

test("the preview states what it does not do, so the missing button is not a bug", () => {
  const view = renderSavingsCommitment(buildSavingsCommitment(analysis()));
  const note = byClass(view, "commit-boundaries")[0];
  assert.match(note.textContent, /Nothing here is saved, sent, or acted on/);
  assert.match(note.textContent, /no credential, no prompt text, no customer record/);
  // No control offers to commit: the downstream action is not built.
  assert.equal(tags(view, "BUTTON").length, 0);
  assert.equal(tags(view, "FORM").length, 0);
});

test("an analysis with nothing to commit to renders a sentence, not an empty panel", () => {
  const input = analysis();
  for (const item of input.candidates) {
    item.projected.monthlyCostMinor = item.baseline.monthlyCostMinor;
  }
  const view = renderSavingsCommitment(buildSavingsCommitment(input));
  assert.equal(view.getAttribute("role"), "status");
  assert.match(view.textContent, /Nothing to commit to from this analysis/);
  assert.match(view.textContent, /3 candidate\(s\) considered/);
});

test("an unreadable or invalid analysis withholds the commitment and says so", () => {
  const view = renderSavingsCommitmentError();
  assert.equal(view.getAttribute("role"), "alert");
  assert.match(view.textContent, /An incomplete or ambiguous commitment is withheld/);
});

/* ---------------------------- the local boundary --------------------------- */

test("the browser boundary reads one same-origin fixture and persists nothing", async () => {
  const requested = [];
  const preview = await loadSavingsCommitment(async (url, options) => {
    requested.push([url, options]);
    return { ok: true, json: async () => analysis() };
  });
  assert.deepEqual(requested,
    [["/savings-commitment-fixture.json", { cache: "no-store", credentials: "omit" }]]);
  assert.equal(preview.commitment.commitmentId, "syn-commit-support-triage");

  await assert.rejects(
    loadSavingsCommitment(async () => ({ ok: false })),
    /could not be loaded/,
  );
});

test("no storage, clock, or off-origin request exists in the contract or its view", async () => {
  for (const file of ["savings-commitment.js", "savings-commitment-view.js",
    "savings-commitment-page.js"]) {
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    // Comments describe these; code must not use them. Strip comments first.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of [/localStorage/, /sessionStorage/, /indexedDB/, /document\.cookie/,
      /Date\.now/, /new Date/, /https?:\/\//]) {
      assert.doesNotMatch(code, forbidden, `${file} reaches for ${forbidden}`);
    }
  }
});

test("the shipped fixture is synthetic and carries no credential or contact detail", async () => {
  const raw = await readFile(FIXTURE_URL, "utf8");
  for (const forbidden of [/@[a-z0-9.-]+\.[a-z]{2,}/i, /https?:\/\//, /-----BEGIN/,
    /\b(sk|pk|ghp)[-_][A-Za-z0-9]{12,}/]) {
    assert.doesNotMatch(raw, forbidden);
  }
  // Every owner is a role, not a person, and every id is declared synthetic.
  for (const item of FIXTURE.candidates) {
    assert.match(item.accountableOwner.role, /^Synthetic /);
    assert.match(item.department.departmentId, /^syn-/);
    assert.match(item.candidateId, /^syn-/);
  }
  assert.equal(FIXTURE.source.designation, "fixture");
});
