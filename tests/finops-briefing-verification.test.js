// Check the math: the recomputation, its three verdicts, and the golden figures.
//
// The goldens in tests/fixtures/briefing-verification/golden-briefings.json are
// drift tripwires. They assert a structured object of named figures rather than
// a rendered string, so a failure says which figure moved and by how much
// instead of printing two paragraphs and leaving the reader to diff them.
//
// The view is driven from the same model the fixtures assert, through the same
// function, because a view with its own arithmetic is the exact failure this
// whole surface exists to prevent.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseHtml, textOf } from "./support/browser.js";
import {
  VERDICT_STATEMENT,
  VERIFICATION_VERDICT,
  statedRubricVersion,
  verifiedFigures,
  verifyAnalysisMath,
  verifyBriefingMath,
} from "../src/finops-briefing-verification.js";
import { renderBriefingVerification } from "../src/finops-briefing-verification-view.js";
import { applyRestoredBriefing } from "../src/local-import-flow.js";
import { parseSavedBriefing } from "../src/finops-briefing-restore.js";
import { briefingFile } from "../src/finops-briefing-export.js";
import { DOWN_ROUTING_RULE_VERSION } from "../src/down-routing-candidates.js";
import { loadExampleDataset } from "../src/example-dataset.js";

const GOLDENS = new URL("./fixtures/briefing-verification/golden-briefings.json", import.meta.url);
const PAGE = new URL("../src/evolution.html", import.meta.url);

async function goldens() {
  return JSON.parse(await readFile(GOLDENS, "utf8"));
}

/** A deep clone, so a test that bends one operand cannot bend the next test's. */
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// ---------------------------------------------------------------------------
// The goldens.
// ---------------------------------------------------------------------------

test("golden briefings reproduce their stated figures exactly", async () => {
  const { fixtures } = await goldens();
  assert.equal(fixtures.length, 3, "the three declared cases must all be present");

  for (const fixture of fixtures) {
    const verification = verifyBriefingMath(fixture.payload);
    const { perDepartmentRecoverableUsd, ...expected } = fixture.expected;
    // One structured comparison per fixture: a failure names the figure that
    // drifted, its expected value, and what came back.
    assert.deepEqual(verifiedFigures(verification), expected, `fixture ${fixture.id}`);
    assert.deepEqual(
      verification.departments.map((department) => department.recomputedRecoverableUsd),
      perDepartmentRecoverableUsd,
      `fixture ${fixture.id}: per-department recoverable figures`);
  }
});

test("the full-coverage golden says every dollar was attributed", async () => {
  const { fixtures } = await goldens();
  const full = fixtures.find((fixture) => fixture.id === "full-coverage");
  const verification = verifyBriefingMath(full.payload);
  assert.equal(verification.verdict, VERIFICATION_VERDICT.reproduced);
  assert.equal(verification.attribution.full, true);
  assert.match(verification.attribution.statement, /Full attribution/);
});

test("the partial-attribution golden names the fraction of spend it covered", async () => {
  const { fixtures } = await goldens();
  const partial = fixtures.find((fixture) => fixture.id === "partial-attribution");
  const verification = verifyBriefingMath(partial.payload);
  // Reproducing exactly and covering only part of the spend are different
  // facts, and a partial briefing has to state the second one on this view.
  assert.equal(verification.verdict, VERIFICATION_VERDICT.reproduced);
  assert.equal(verification.attribution.full, false);
  assert.match(verification.attribution.statement, /Partial attribution: 70\.0% of analyzed spend/);
  assert.match(verification.attribution.statement, /2700\.00 USD is unattributed/);
});

test("the older-rubric golden cannot be reproduced, however well its arithmetic adds up", async () => {
  const { fixtures } = await goldens();
  const older = fixtures.find((fixture) => fixture.id === "older-rubric-version");
  const verification = verifyBriefingMath(older.payload);
  assert.equal(verification.verdict, VERIFICATION_VERDICT.rubricDrift);
  assert.equal(verification.rubric.stated, "down-routing-candidate/0.9.0");
  assert.equal(verification.rubric.current, DOWN_ROUTING_RULE_VERSION);
  assert.equal(verification.rubric.drifted, true);
  // Every figure it published still recomputes from its own operands. Drift is
  // reported anyway, because "the old rubric was self-consistent" is not the
  // same claim as "this build reproduces it".
  for (const figure of Object.values(verification.figures)) {
    assert.equal(figure.matches, true, `${figure.name} should still agree with itself`);
  }
});

// ---------------------------------------------------------------------------
// The verdicts that are not "fine".
// ---------------------------------------------------------------------------

test("a stored figure that disagrees with its own operands is reported as a defect", async () => {
  const { fixtures } = await goldens();
  const payload = clone(fixtures.find((fixture) => fixture.id === "full-coverage").payload);
  payload.results.recoverableUsd = 3400;

  const verification = verifyBriefingMath(payload);
  assert.equal(verification.verdict, VERIFICATION_VERDICT.mismatch);
  assert.deepEqual(verification.disagreeingFigures, ["recoverable_spend_usd"]);
  assert.equal(verification.figures.recoverableSpendUsd.stated, 3400);
  assert.equal(verification.figures.recoverableSpendUsd.recomputed, 3100);
  assert.equal(verification.figures.recoverableSpendUsd.delta, -300);
  assert.match(verification.statement, /Does not match/);
});

test("a grade that contradicts its own record counts is reported as a defect", async () => {
  const { fixtures } = await goldens();
  const payload = clone(fixtures.find((fixture) => fixture.id === "partial-attribution").payload);
  payload.briefing.coverage.confidence = "high";

  const verification = verifyBriefingMath(payload);
  assert.equal(verification.verdict, VERIFICATION_VERDICT.mismatch);
  assert.deepEqual(verification.disagreeingFigures, ["grade"]);
  assert.equal(verification.figures.grade.stated, "high");
  assert.equal(verification.figures.grade.recomputed, "moderate");
});

test("a missing operand is a cannot-reproduce state, never a look at the source data", async () => {
  const { fixtures } = await goldens();
  const payload = clone(fixtures.find((fixture) => fixture.id === "full-coverage").payload);
  delete payload.results.rankedDepartments[0].downRouting.candidateTokens;

  const verification = verifyBriefingMath(payload);
  assert.equal(verification.verdict, VERIFICATION_VERDICT.cannotReproduce);
  assert.deepEqual(verification.missingOperands, ["candidate_tokens"]);
  assert.equal(verification.departments[0].recomputedRecoverableUsd, null);
  assert.match(verification.statement, /Nothing was read from the source data/);
});

test("a briefing that names no rubric version cannot be confirmed", async () => {
  const { fixtures } = await goldens();
  const payload = clone(fixtures.find((fixture) => fixture.id === "full-coverage").payload);
  for (const department of payload.results.rankedDepartments) delete department.downRouting.ruleVersion;

  assert.equal(statedRubricVersion(payload), null);
  assert.equal(verifyBriefingMath(payload).verdict, VERIFICATION_VERDICT.cannotReproduce);
});

test("nothing at all analyzed is a cannot-reproduce state rather than a zero", () => {
  const verification = verifyBriefingMath({ results: { rankedDepartments: [] }, briefing: {} });
  assert.equal(verification.verdict, VERIFICATION_VERDICT.cannotReproduce);
  assert.equal(verification.figures.grade.recomputed, "insufficient");
});

// ---------------------------------------------------------------------------
// Every weight and threshold arrives with its assumption.
// ---------------------------------------------------------------------------

test("each price and volume threshold carries the assumption behind it", async () => {
  const { fixtures } = await goldens();
  const verification = verifyBriefingMath(
    fixtures.find((fixture) => fixture.id === "full-coverage").payload);

  assert.deepEqual(verification.parameters.map((parameter) => parameter.name), [
    "premium_tier_floor_minor_per_million_tokens",
    "standard_tier_reference_minor_per_million_tokens",
    "short_call_max_tokens_per_call",
    "min_candidate_requests",
  ]);
  for (const parameter of verification.parameters) {
    assert.ok(Number.isFinite(parameter.value), `${parameter.name} needs a value`);
    assert.ok(parameter.assumption && parameter.assumption.length > 20,
      `${parameter.name} needs a stated assumption, not a bare number`);
  }
});

test("each grade threshold carries the assumption behind it", async () => {
  const { fixtures } = await goldens();
  const verification = verifyBriefingMath(
    fixtures.find((fixture) => fixture.id === "full-coverage").payload);

  assert.deepEqual(verification.thresholds.map((threshold) => threshold.name), [
    "high_coverage_ratio", "moderate_coverage_ratio", "low_coverage_ratio", "zero_denominator_rule",
  ]);
  assert.equal(verification.thresholds[0].value, 0.9);
  assert.equal(verification.thresholds[1].value, 0.6);
  for (const threshold of verification.thresholds) {
    assert.ok(threshold.assumption && threshold.assumption.length > 20,
      `${threshold.name} needs a stated assumption`);
  }
});

test("a briefing with no scenario block says whose parameters are being shown", async () => {
  const { fixtures } = await goldens();
  const payload = clone(fixtures.find((fixture) => fixture.id === "full-coverage").payload);
  delete payload.scenario;
  for (const parameter of verifyBriefingMath(payload).parameters) {
    assert.match(parameter.source, /this build/);
  }
});

// ---------------------------------------------------------------------------
// The real writer, and the real reader.
// ---------------------------------------------------------------------------

test("the shipped export path reproduces exactly over the bundled example dataset", async () => {
  const analysis = loadExampleDataset();
  const verification = verifyAnalysisMath(analysis, { dataset: "example" });

  assert.equal(verification.verdict, VERIFICATION_VERDICT.reproduced,
    `example dataset should reproduce; disagreeing: ${verification.disagreeingFigures.join(", ")}`);
  assert.equal(verification.figures.recoverableSpendUsd.recomputed, analysis.recoverableUsd);
  assert.equal(verification.rubric.stated, DOWN_ROUTING_RULE_VERSION);
});

test("a reopened briefing carries the same verification a freshly generated one does", async () => {
  const analysis = loadExampleDataset();
  const file = briefingFile(analysis, { dataset: "example", exportedAt: "2026-07-27T09:30:00Z" });

  const reopened = parseSavedBriefing(file.text);
  assert.equal(reopened.ok, true, reopened.message ?? "");
  assert.deepEqual(
    verifiedFigures(reopened.saved.verification),
    verifiedFigures(verifyAnalysisMath(analysis, { dataset: "example" })));
});

test("verifyAnalysisMath is absent, not half-drawn, with nothing analyzed", () => {
  assert.equal(verifyAnalysisMath(null, { dataset: "user" }), null);
});

// ---------------------------------------------------------------------------
// The view. Same model, no arithmetic of its own, legible without colour.
// ---------------------------------------------------------------------------

async function view(fixtureId) {
  const { fixtures } = await goldens();
  const fixture = fixtures.find((entry) => entry.id === fixtureId);
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const verification = verifyBriefingMath(fixture.payload);
  return { document, verification, node: renderBriefingVerification(verification, { doc: document }) };
}

test("the view states the verdict in words, not only in an attribute", async () => {
  const { node } = await view("older-rubric-version");
  const text = textOf(node);
  assert.match(text, /Check the math — Cannot reproduce — rubric version drift/);
  assert.ok(text.includes(VERDICT_STATEMENT[VERIFICATION_VERDICT.rubricDrift]),
    "the verdict sentence itself has to be on the page");
  assert.equal(node.dataset.verdict, VERIFICATION_VERDICT.rubricDrift);
  // Both versions named, so a reader can see which rubric they are arguing with.
  assert.match(text, /down-routing-candidate\/0\.9\.0/);
  assert.match(text, new RegExp(DOWN_ROUTING_RULE_VERSION.replace("/", "\\/")));
});

test("the view shows every arithmetic step with its operation and its result", async () => {
  const { node } = await view("full-coverage");
  const steps = node.querySelectorAll("li.verification-step");
  const ids = [...steps].map((step) => step.dataset.step);
  assert.deepEqual(ids, [
    "candidate_spend", "projected_spend", "department_recoverable",
    "organization_recoverable", "recoverable_share",
    "coverage_ratio", "required_inputs", "threshold_ladder",
  ]);
  const text = textOf(node);
  // The intermediate values, not only the headline: a reader redoing the sum
  // needs the per-department figures and the cheaper-tier cost as well.
  assert.match(text, /round\(100000000 × 1500 ÷ 1,000,000\) = 1500\.00 USD/);
  assert.match(text, /unit-a: 2500\.00 USD/);
  assert.match(text, /Result: 3100\.00 USD/);
  assert.match(text, /Result: 15\.5% of analyzed spend/);
  assert.match(text, /760 records analyzed ÷ 800 records handed to the analysis/);
  assert.match(text, /graded high/);
});

test("the view prints the assumption beside every weight and threshold", async () => {
  const { node, verification } = await view("full-coverage");
  const text = textOf(node);
  for (const entry of [...verification.parameters, ...verification.thresholds]) {
    assert.ok(text.includes(entry.name), `${entry.name} should be named on the view`);
    assert.ok(text.includes(entry.assumption.slice(0, 60)),
      `${entry.name} should carry its assumption on the view`);
  }
});

test("the view states partial attribution where there is any", async () => {
  const { node } = await view("partial-attribution");
  assert.match(textOf(node), /Partial attribution: 70\.0% of analyzed spend/);
});

test("the view is a labelled region whose steps are ordered lists", async () => {
  const { node } = await view("full-coverage");
  assert.equal(node.getAttribute("role"), "region");
  const headingId = node.getAttribute("aria-labelledby");
  assert.ok(headingId && node.querySelector(`#${headingId}`), "the region names its own heading");
  assert.equal(node.querySelector("p.verification-verdict").getAttribute("role"), "status");
  assert.ok(node.querySelectorAll("ol.verification-steps").length >= 2);
});

test("the view repeats the model's figures and never recomputes one", async () => {
  const { node, verification } = await view("full-coverage");
  const figures = [...node.querySelectorAll("li.verification-figure")];
  assert.deepEqual(figures.map((item) => item.dataset.figure),
    Object.values(verification.figures).map((figure) => figure.name));
  for (const item of figures) assert.equal(item.dataset.matches, "true");
});

test("a restored briefing reaches the check-the-math region on the shipped page", async () => {
  const analysis = loadExampleDataset();
  const file = briefingFile(analysis, { dataset: "example", exportedAt: "2026-07-27T09:30:00Z" });
  const document = parseHtml(await readFile(PAGE, "utf8"));

  const reopened = parseSavedBriefing(file.text);
  applyRestoredBriefing(document, { saved: reopened.saved, delta: null });
  const region = document.getElementById("restored-briefing-verification");
  assert.equal(region.hidden, false);
  assert.equal(region.dataset.verdict, VERIFICATION_VERDICT.reproduced);
  assert.match(textOf(region), /Check the math — Reproduced exactly/);

  // Closing the restored briefing takes the arithmetic with it: a verification
  // left behind would describe a briefing that is no longer on screen.
  applyRestoredBriefing(document, null);
  assert.equal(region.hidden, true);
  assert.equal(textOf(region), "");
});
