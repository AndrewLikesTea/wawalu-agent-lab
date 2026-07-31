// The canonical AI FinOps decision contract.
//
// What is pinned here is the product rule, not the shape of an object: the page
// asks one question, answers it in exactly one place, defines every metric in
// that answer precisely enough that two engineers compute the same number, and
// never carries anything that could only have come from outside the bundled
// synthetic dataset.
//
// The four groups below are the four ways that rule fails:
//
//   1. A record ships missing a field a leader needs, and the page renders an
//      incomplete decision as if it were a complete one.
//   2. A metric drifts — a share rounded differently, a window that is not the
//      window the impact was measured over, a confidence score outside its own
//      scale, a band that disagrees with the briefing contract's thresholds.
//   3. Something real gets into a demo artifact: an address, a token, a live
//      endpoint, a stored prompt.
//   4. A second region starts answering the question on its own, and a reader
//      meets two "the" answers with no way to tell which one to act on.
//
// The fixture is also held against the derivation it was authored from, so a
// contract change under the bundled dataset fails here rather than leaving a
// stale number on the landing surface.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHtml } from "./support/browser.js";
import {
  confidenceBand, confidenceScore, deriveDecisionRecord,
  DECISION_CONTRACT_VERSION, DECISION_QUESTION, IMPACT_KIND,
  loadCanonicalDecision, privacyViolations, recoverableShare, REQUIRED_FIELDS,
  roundHalfUp, SUMMARY_ATTRIBUTE, SUMMARY_ROLE, SYNTHETIC_SOURCE,
  validateDecisionRecord,
} from "../src/finops-decision-contract.js";
// The single-summary rule is no longer decided here: src/finops-answer-spine.js
// names the one region with role `answer`, and `completeSummaries` is the only
// caller that supplies those ids to the contract's referee.
import { answerRegionId, completeSummaries } from "../src/finops-answer-spine.js";
import { loadExampleDataset } from "../src/example-dataset.js";
import { buildFinopsBriefing, BRIEFING_CONFIDENCE } from "../src/finops-briefing-contract.js";
import { buildFirstRunResult } from "../src/finops-first-run.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

/** A deep clone, so a mutation test cannot leak into the next one. */
const clone = (value) => JSON.parse(JSON.stringify(value));

const canonical = loadCanonicalDecision();

// ---------------------------------------------------------------------------
// 1. The record is complete, or it is not a decision.
// ---------------------------------------------------------------------------

test("the shipped fixture satisfies its own contract", () => {
  assert.deepEqual(canonical.errors, [], "canonical fixture failed validation");
  assert.equal(canonical.valid, true);
  assert.equal(canonical.decision.contractVersion, DECISION_CONTRACT_VERSION);
});

test("the question is the canonical one, and a record cannot ask a different one", () => {
  assert.equal(canonical.decision.question, "Are we wasting money?");
  const drifted = clone(canonical.decision);
  drifted.question = "How is our AI spend trending?";
  const result = validateDecisionRecord(drifted);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.startsWith("question:")));
});

test("every required field is required", () => {
  assert.equal(REQUIRED_FIELDS.length, 7);
  for (const field of REQUIRED_FIELDS) {
    const missing = clone(canonical.decision);
    delete missing[field];
    const result = validateDecisionRecord(missing);
    assert.equal(result.valid, false, `dropping ${field} still validated`);
    assert.ok(result.errors.includes(`${field}: missing`), `no missing-field error for ${field}`);
  }
});

test("required decision fields must be structured records, not merely present", () => {
  for (const field of REQUIRED_FIELDS.filter((name) => name !== "question")) {
    const malformed = clone(canonical.decision);
    malformed[field] = "present but unstructured";
    const result = validateDecisionRecord(malformed);
    assert.equal(result.valid, false, `${field} accepted a string`);
    assert.ok(result.errors.includes(`${field}: must be an object`),
      `${field} did not report its invalid shape`);
  }
});

test("a malformed input is a list of errors, never a throw", () => {
  for (const input of [null, undefined, 7, "record", [], true]) {
    const result = validateDecisionRecord(input);
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  }
});

test("the prioritized action is one ranked intervention with a named accountable role", () => {
  const action = canonical.decision.prioritizedAction;
  assert.equal(action.rank, 1);
  assert.ok(action.statement.trim().length > 0);
  assert.ok(action.accountableRole.trim().length > 0);
  // A role, never a person: the demo must not name anybody, invented or not.
  assert.ok(!/\b(?:Ms|Mr|Mx|Dr)\.\s/.test(action.accountableRole));

  const ranked = clone(canonical.decision);
  ranked.prioritizedAction.rank = 2;
  assert.equal(validateDecisionRecord(ranked).valid, false);

  const unowned = clone(canonical.decision);
  delete unowned.prioritizedAction.accountableRole;
  assert.equal(validateDecisionRecord(unowned).valid, false);
});

test("evidence is progressive disclosure and may not restate the summary", () => {
  const evidence = canonical.decision.evidence;
  assert.equal(evidence.disclosure, "progressive");
  assert.ok(evidence.entries.length > 0);

  const restated = clone(canonical.decision);
  restated.evidence.entries.push({
    term: "Recommended action",
    detail: canonical.decision.prioritizedAction.statement,
  });
  const result = validateDecisionRecord(restated);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("restates the summary")));

  const notDistinct = clone(canonical.decision);
  notDistinct.evidence.distinctFromSummary = false;
  assert.equal(validateDecisionRecord(notDistinct).valid, false);
});

// ---------------------------------------------------------------------------
// 2. Metric constraints: two engineers compute the same number.
// ---------------------------------------------------------------------------

test("half-up rounding is half-up, not banker's", () => {
  assert.equal(roundHalfUp(0.845, 2), 0.85);
  assert.equal(roundHalfUp(0.125, 2), 0.13);
  assert.equal(roundHalfUp(2.5, 0), 3);
  assert.equal(roundHalfUp(Number.NaN, 2), null);
});

test("the benchmark comparison is observed ÷ baseline, to four places", () => {
  assert.equal(recoverableShare(51254, 154500), 0.3317);
  assert.equal(recoverableShare(1, 3), 0.3333);
  assert.equal(recoverableShare(0, 100), 0);
});

test("a share of nothing is unknown, never zero", () => {
  for (const baseline of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, null, undefined, "100"]) {
    assert.equal(recoverableShare(50, baseline), null, `baseline ${baseline} produced a share`);
  }
  assert.equal(recoverableShare(-1, 100), null);
});

test("a stated comparison share must equal the one the operands produce", () => {
  const drifted = clone(canonical.decision);
  drifted.benchmark.comparisonShare = 0.4;
  const result = validateDecisionRecord(drifted);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.startsWith("benchmark.comparisonShare:")));
});

test("the measurement window is half-open UTC, and start precedes end", () => {
  const window = canonical.decision.benchmark.window;
  assert.equal(window.endExclusive, true);
  assert.ok(window.start < window.end);

  const inverted = clone(canonical.decision);
  inverted.benchmark.window.start = "2026-08-01T00:00:00Z";
  assert.equal(validateDecisionRecord(inverted).valid, false);

  const inclusive = clone(canonical.decision);
  inclusive.benchmark.window.endExclusive = false;
  assert.equal(validateDecisionRecord(inclusive).valid, false);

  const local = clone(canonical.decision);
  local.benchmark.window.start = "2026-06-01T00:00:00";
  assert.equal(validateDecisionRecord(local).valid, false);
});

test("impact and benchmark must cover the same window, or they are not comparable", () => {
  assert.deepEqual(
    canonical.decision.impact.period,
    canonical.decision.benchmark.window,
  );
  const split = clone(canonical.decision);
  split.impact.period.end = "2026-08-01T00:00:00Z";
  const result = validateDecisionRecord(split);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.startsWith("impact.period:")));
});

test("impact is an estimate in a stated currency, with its calculation basis", () => {
  const impact = canonical.decision.impact;
  assert.equal(impact.kind, IMPACT_KIND);
  assert.equal(impact.currency, "USD");
  assert.equal(impact.realized, false);
  assert.ok(impact.calculationBasis.includes("not a realized"));

  const claimed = clone(canonical.decision);
  claimed.impact.realized = true;
  assert.equal(validateDecisionRecord(claimed).valid, false, "a realized saving validated");

  const unpriced = clone(canonical.decision);
  delete unpriced.impact.currency;
  assert.equal(validateDecisionRecord(unpriced).valid, false);

  const unexplained = clone(canonical.decision);
  delete unexplained.impact.calculationBasis;
  assert.equal(validateDecisionRecord(unexplained).valid, false);
});

test("the confidence score is bounded, penalised, and rounded to two places", () => {
  assert.equal(confidenceScore({ coverageRatio: 1 }), 1);
  assert.equal(confidenceScore({ coverageRatio: 1, unverifiedReasons: 1 }), 0.85);
  assert.equal(confidenceScore({ coverageRatio: 1, missingInputs: 2 }), 0.7);
  assert.equal(confidenceScore({ coverageRatio: 1, missingInputs: 2, unverifiedReasons: 1 }), 0.55);
  // Neither penalty may push the score off its own scale.
  assert.equal(confidenceScore({ coverageRatio: 0.2, missingInputs: 4 }), 0);
  assert.equal(confidenceScore({ coverageRatio: 5 }), 1);
  assert.equal(confidenceScore({}), 0);
});

test("the confidence band reads off the briefing contract's own thresholds", () => {
  assert.equal(confidenceBand(1), BRIEFING_CONFIDENCE.high);
  assert.equal(confidenceBand(0.9), BRIEFING_CONFIDENCE.high);
  assert.equal(confidenceBand(0.85), BRIEFING_CONFIDENCE.moderate);
  assert.equal(confidenceBand(0.6), BRIEFING_CONFIDENCE.moderate);
  assert.equal(confidenceBand(0.59), BRIEFING_CONFIDENCE.low);
  assert.equal(confidenceBand(0), BRIEFING_CONFIDENCE.insufficient);
});

test("a score outside [0,1], or one with no stated basis, is not a confidence", () => {
  for (const score of [-0.1, 1.1, Number.NaN, "0.9"]) {
    const bad = clone(canonical.decision);
    bad.confidence.score = score;
    assert.equal(validateDecisionRecord(bad).valid, false, `score ${score} validated`);
  }
  const unexplained = clone(canonical.decision);
  delete unexplained.confidence.basis;
  const result = validateDecisionRecord(unexplained);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("confidence.basis: missing"));

  const mislabelled = clone(canonical.decision);
  mislabelled.confidence.band = BRIEFING_CONFIDENCE.high;
  assert.equal(validateDecisionRecord(mislabelled).valid, false);
});

test("provenance names a synthetic local source and a clock-free generated-at", () => {
  const provenance = canonical.decision.provenance;
  assert.equal(provenance.source, SYNTHETIC_SOURCE);
  assert.ok(provenance.datasetId.trim().length > 0);
  assert.ok(provenance.generator.trim().length > 0);
  assert.match(provenance.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.ok(provenance.generatedAtBasis.includes("static"));

  const live = clone(canonical.decision);
  live.provenance.source = "provider-api";
  const result = validateDecisionRecord(live);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.startsWith("provenance.source:")));
});

test("the demo is reproducible: no figure in the record depends on the clock", () => {
  const first = loadCanonicalDecision().decision;
  const second = loadCanonicalDecision().decision;
  assert.deepEqual(first, second);
  assert.equal(first.provenance.generatedAt, second.provenance.generatedAt);
});

// ---------------------------------------------------------------------------
// 3. The privacy boundary.
// ---------------------------------------------------------------------------

test("the shipped fixture crosses no privacy boundary", () => {
  assert.deepEqual(privacyViolations(canonical.decision), []);
});

test("a credential, an address, a stored prompt, or a live endpoint each fails the record", () => {
  const cases = [
    ["apiKey", "sk-live-4a9f2c7d1e"],
    ["providerToken", "ghp-aaaabbbbccccdddd"],
    ["customerName", "Northwind Traders"],
    ["promptText", "summarise this ticket"],
    ["contactEmail", "ops@example.com"],
    ["sessionId", "abc123"],
  ];
  for (const [key, value] of cases) {
    const leaked = clone(canonical.decision);
    leaked.evidence[key] = value;
    const result = validateDecisionRecord(leaked);
    assert.equal(result.valid, false, `${key} validated`);
    assert.ok(result.errors.some((error) => error.includes(key)), `no error named ${key}`);
  }
});

test("a value that looks like a credential or a remote endpoint fails even under an innocent key", () => {
  const cases = [
    ["https://api.example.com/v1/usage", "remote_endpoint"],
    ["http://10.0.0.4/metrics", "remote_endpoint"],
    ["finance-lead@example.com", "email_address"],
    ["sk-abcdefgh12345678", "bearer_token"],
    ["Bearer eyJhbGciOiJIUzI1NiJ9", "authorization_header"],
  ];
  for (const [value, code] of cases) {
    const leaked = clone(canonical.decision);
    leaked.evidence.entries.push({ term: "Source", detail: value });
    const result = validateDecisionRecord(leaked);
    assert.equal(result.valid, false, `${value} validated`);
    assert.ok(result.errors.some((error) => error.endsWith(code)), `expected ${code} for ${value}`);
  }
});

test("the boundary walk survives a cycle rather than hanging on one", () => {
  const cyclic = { question: DECISION_QUESTION };
  cyclic.self = cyclic;
  assert.deepEqual(privacyViolations(cyclic), []);
});

// ---------------------------------------------------------------------------
// 4. The fixture is the derivation, not a copy of it that has stopped agreeing.
// ---------------------------------------------------------------------------

test("the fixture still matches what the bundled dataset derives today", () => {
  const analysis = loadExampleDataset();
  const derived = deriveDecisionRecord(analysis, buildFinopsBriefing(analysis));
  const validation = validateDecisionRecord(derived);
  assert.deepEqual(validation.errors, []);

  const fixture = canonical.decision;
  assert.equal(derived.benchmark.baselineUsd, fixture.benchmark.baselineUsd);
  assert.equal(derived.benchmark.observedUsd, fixture.benchmark.observedUsd);
  assert.equal(derived.benchmark.comparisonShare, fixture.benchmark.comparisonShare);
  assert.deepEqual(derived.benchmark.window, fixture.benchmark.window);
  assert.equal(derived.impact.value, fixture.impact.value);
  assert.deepEqual(derived.impact.period, fixture.impact.period);
  assert.equal(derived.prioritizedAction.statement, fixture.prioritizedAction.statement);
  assert.equal(derived.prioritizedAction.accountableRole, fixture.prioritizedAction.accountableRole);
  assert.equal(derived.confidence.score, fixture.confidence.score);
  assert.equal(derived.confidence.band, fixture.confidence.band);
  assert.deepEqual(derived.confidence.limits, fixture.confidence.limits);
});

test("the stated confidence basis is the arithmetic the derivation actually did", () => {
  const analysis = loadExampleDataset();
  const briefing = buildFinopsBriefing(analysis);
  const derived = deriveDecisionRecord(analysis, briefing);
  const expected = confidenceScore({
    coverageRatio: briefing.coverage.coverageRatio,
    missingInputs: briefing.coverage.missingInputs.length,
    unverifiedReasons: derived.confidence.limits.length,
  });
  assert.equal(derived.confidence.score, expected);
  // The bundled example is fully covered and fully supplied, so anything below
  // 1.00 has to be explained by a named limit rather than by rounding.
  assert.equal(briefing.coverage.coverageRatio, 1);
  assert.equal(briefing.coverage.missingInputs.length, 0);
  assert.equal(derived.confidence.limits.length, 1);
  assert.ok(derived.confidence.limits[0].code.trim().length > 0);
  assert.ok(derived.confidence.limits[0].detail.trim().length > 0);
});

test("an unreadable analysis derives an invalid record rather than a confident one", () => {
  const derived = deriveDecisionRecord(null, buildFinopsBriefing(null));
  const result = validateDecisionRecord(derived);
  assert.equal(result.valid, false);
  assert.equal(derived.benchmark.comparisonShare, null);
});

// ---------------------------------------------------------------------------
// 5. The single-summary rule, against the shipped markup.
// ---------------------------------------------------------------------------

const html = await readFile(PAGE, "utf8");

test("the initial FinOps view presents exactly one complete decision summary", () => {
  const document = parseHtml(html);
  const summaries = completeSummaries(document);
  assert.equal(summaries.visible, 1,
    `expected one visible complete summary, found ${summaries.visibleIds.join(", ") || "none"}`);
  assert.deepEqual(summaries.visibleIds, [answerRegionId()]);
});

test("every other decision-bearing region declares itself as evidence", () => {
  const document = parseHtml(html);
  const marked = Array.from(document.querySelectorAll(`[${SUMMARY_ATTRIBUTE}]`));
  assert.ok(marked.length > 1, "no regions declared a summary role");
  for (const region of marked) {
    const role = region.getAttribute(SUMMARY_ATTRIBUTE);
    assert.ok(Object.values(SUMMARY_ROLE).includes(role),
      `#${region.id} declared an unknown role "${role}"`);
    assert.ok(region.id, "a region declared a summary role without an id");
  }
  const evidence = marked.filter((region) =>
    region.getAttribute(SUMMARY_ATTRIBUTE) === SUMMARY_ROLE.evidence);
  assert.ok(evidence.length >= 3, "the supporting panels are not declared as evidence");
});

// A region used to become "the" summary by setting `data-decision-summary` to
// `complete` on itself, and four regions had. The referee no longer reads the
// markup's opinion of itself: the authorization comes from the answer spine.
test("a competing full summary is a failure, not a layout choice", () => {
  const document = parseHtml(html);
  const rival = document.createElement("section");
  rival.id = "rival-summary";
  rival.setAttribute(SUMMARY_ATTRIBUTE, SUMMARY_ROLE.complete);
  document.body.append(rival);
  const summaries = completeSummaries(document);
  assert.equal(summaries.visible, 1);
  assert.ok(!summaries.visibleIds.includes("rival-summary"),
    "a region promoted itself to the complete summary by editing one attribute");
});

test("the reader's own result supports the answer rather than becoming a second one", () => {
  const document = parseHtml(html);
  const front = document.getElementById("finops-first-run");
  const guided = document.getElementById("guided-result");
  // Both are evidence now: the answer the page opens with is the spine's answer
  // region, and these two are the example decision and the reader's own result
  // beneath it.
  assert.equal(front.getAttribute(SUMMARY_ATTRIBUTE), SUMMARY_ROLE.evidence);
  assert.equal(guided.getAttribute(SUMMARY_ATTRIBUTE), SUMMARY_ROLE.evidence);

  // What the page does once a real result exists: the example is superseded and
  // the reader's own headline is revealed. Still exactly one complete summary,
  // and it is neither of them.
  front.dataset.superseded = "true";
  front.hidden = true;
  guided.hidden = false;
  const summaries = completeSummaries(document);
  assert.equal(summaries.visible, 1);
  assert.deepEqual(summaries.visibleIds, [answerRegionId()]);
});

// ---------------------------------------------------------------------------
// 6. The front door consumes the contract.
// ---------------------------------------------------------------------------

test("the front-door region asks the canonical question and carries its confidence", () => {
  const result = buildFirstRunResult();
  assert.equal(result.question, DECISION_QUESTION);
  assert.equal(result.decision.contractVersion, DECISION_CONTRACT_VERSION);
  assert.equal(result.confidence.available, true);
  assert.equal(result.confidence.value, "0.85 of 1.00 · moderate");
  assert.equal(result.confidence.detail, canonical.decision.confidence.basis);
});

test("an unvalidatable decision leaves the confidence labelled, not blank or bare", () => {
  const result = buildFirstRunResult(loadExampleDataset, () => ({ decision: null, valid: false, errors: ["x"] }));
  assert.equal(result.confidence.available, false);
  assert.equal(result.confidence.value, "Unavailable");
  assert.ok(result.confidence.detail.includes("none is claimed"));
  // The rest of the answer still stands: a missing score is not a missing page.
  assert.equal(result.benchmark.available, true);
});

test("a throwing fixture loader cannot take down the independent example analysis", () => {
  const result = buildFirstRunResult(loadExampleDataset, () => {
    throw new Error("fixture unavailable");
  });
  assert.equal(result.presentation.state, "ready");
  assert.equal(result.benchmark.available, true);
  assert.equal(result.action.available, true);
  assert.equal(result.confidence.available, false);
});

test("the authored heading already asks the question, before any script runs", () => {
  const document = parseHtml(html);
  const heading = document.getElementById("finops-first-run-title");
  assert.equal(heading.textContent.trim(), DECISION_QUESTION);
});
