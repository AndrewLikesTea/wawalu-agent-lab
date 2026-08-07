// The evidence grade beside the planned figure (#1289).
//
// TWO CLAIMS ARE MADE ON THE PAGE, and this file is where they are proved:
//
//   1. SCOPE-INSENSITIVITY. Section 3 takes each labelled plan, raises every
//      move's claimed share to 100% and changes nothing else, then asserts the
//      serialised grade is byte-identical while the plan's dollar total moves.
//      A grade that could be bought with a claim would fail there.
//   2. DETERMINISM. Section 4 scores the same fixture twice and compares the two
//      serialisations byte for byte, which only holds with stable key order and
//      a blocker order that is declared rather than inherited from insertion.
//
// The rest guards the things a rubric quietly loses: a weight that stopped
// summing to the scale, a blocker with no statement of what would clear it or no
// assumption behind its weight, a bare letter reaching the page with nothing
// accounting for it, lead-entered text reaching the rubric or the rendered page,
// and the analysis's own confidence claim being disturbed by any of it.
//
// The labelled plans live in tests/fixtures/plan-evidence-grades.json so the
// expectations are data a reviewer can read, not assertions buried in code.
//
// HARNESS NOTES. Equality is never asserted against an element node — it walks
// the whole parsed page and hangs. Descendant selectors are rejected, so the
// disclosure's rows are found by walking `children`, and "is this node outside
// every disclosure" is answered by walking `parentNode`.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadExampleDataset } from "../src/example-dataset.js";
import {
  EVIDENCE_RULES, EVIDENCE_RULES_ORDERED, GRADE_BANDS, MAX_SCORE, RULE_WEIGHTS,
  evidenceFacts, gradePlanEvidence, planEvidence,
} from "../src/plan-evidence-grade.js";
import { planMoveKey, planScope } from "../src/plan-scope.js";
import {
  PLAN_EVIDENCE_DETAIL_ID, PLAN_EVIDENCE_DETAIL_SUMMARY, PLAN_EVIDENCE_GRADE_ID, applyPlanScope,
} from "../src/plan-scope-view.js";
import { routingSlate } from "../src/routing-slate.js";
import { loadPage, textOf } from "./support/browser.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

const FIXTURES = JSON.parse(await readFile(
  new URL("./fixtures/plan-evidence-grades.json", import.meta.url), "utf8"));

/** One labelled plan, as `planScope()`'s own model. Never a second plan shape. */
const planFor = (fixture, { commitments = fixture.commitments } = {}) =>
  planScope(fixture.slate, { commitments });

const fixtureNamed = (id) => {
  const found = FIXTURES.plans.find((plan) => plan.id === id);
  assert.ok(found, `the fixture file must still carry the plan ${id}`);
  return found;
};

/** Every move committed at 100% of its traffic, and nothing else touched. */
const atFullScope = (commitments) =>
  commitments.map((commitment) => ({ ...commitment, reroutedSharePct: 100 }));

/** Every element under a node, without the universal selector the harness rejects. */
function descendants(node, out = []) {
  for (const child of node?.children ?? []) {
    out.push(child);
    descendants(child, out);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. The labelled fixtures, pinned to their grade and their whole blocker list.
// ---------------------------------------------------------------------------

test("every labelled plan scores exactly the grade and blockers it is pinned to", () => {
  assert.ok(FIXTURES.plans.length >= 4, "at least four labelled plans must ship");
  for (const fixture of FIXTURES.plans) {
    const verdict = gradePlanEvidence(planFor(fixture), fixture.evidence);
    const where = `fixture ${fixture.id}`;
    assert.equal(verdict.graded, fixture.expected.graded, where);
    assert.equal(verdict.letter, fixture.expected.letter, where);
    assert.equal(verdict.score, fixture.expected.score, where);
    assert.equal(verdict.committedCount, fixture.expected.committedCount, where);
    assert.deepEqual([...verdict.clearedRuleIds], fixture.expected.clearedRuleIds, where);
    assert.deepEqual(
      verdict.blockers.map((blocker) => ({
        ruleId: blocker.ruleId, weight: blocker.weight, movesOutstanding: blocker.movesOutstanding,
      })),
      fixture.expected.blockers,
      `${where}: the whole blocker list, in the declared order`);
  }
});

test("every blocker says what would clear it and the assumption behind its weight", () => {
  for (const fixture of FIXTURES.plans) {
    const verdict = gradePlanEvidence(planFor(fixture), fixture.evidence);
    for (const blocker of verdict.blockers) {
      const rule = EVIDENCE_RULES.find((entry) => entry.id === blocker.ruleId);
      assert.ok(rule, `${blocker.ruleId} must be a declared rule`);
      // One sentence, and it must be an instruction to the lead rather than a
      // restatement of the failure.
      assert.equal(blocker.statement, rule.statement);
      assert.ok(blocker.statement.trim().endsWith("."), blocker.statement);
      assert.equal(blocker.assumption, rule.assumption);
      assert.ok(blocker.assumption.length > 40, `${blocker.ruleId} states no assumption`);
      assert.equal(blocker.name, rule.name);
    }
  }
});

test("a high-scope, evidence-poor plan never outgrades a low-scope, evidenced one", () => {
  const poor = fixtureNamed("high-scope-evidence-poor");
  const rich = fixtureNamed("fully-evidenced-low-scope");
  const poorPlan = planFor(poor);
  const richPlan = planFor(rich);
  // The dollars run the OTHER way, which is the whole point of the comparison.
  assert.ok(poorPlan.plannedMonthlyUsd > richPlan.plannedMonthlyUsd,
    "the evidence-poor plan must claim the larger total for this test to mean anything");
  const poorVerdict = gradePlanEvidence(poorPlan, poor.evidence);
  const richVerdict = gradePlanEvidence(richPlan, rich.evidence);
  assert.ok(poorVerdict.score < richVerdict.score);
  assert.equal(poorVerdict.letter, "D");
  assert.equal(richVerdict.letter, "A");
  assert.ok(poorVerdict.blockers.length > richVerdict.blockers.length);
});

test("nothing committed is an absence stated in words, not a zero and not a pass", () => {
  const fixture = fixtureNamed("nothing-committed");
  const verdict = gradePlanEvidence(planFor(fixture), fixture.evidence);
  assert.equal(verdict.graded, false);
  assert.equal(verdict.letter, null);
  assert.equal(verdict.blockers.length, 0);
  assert.ok(verdict.summary.length > 40, "the absence must be explained in words");
  assert.ok(!/\bA\b|\bD\b/.test(verdict.letter ?? ""), "no letter is invented");
});

// ---------------------------------------------------------------------------
// 2. The weights, and the scale they have to keep adding up to.
// ---------------------------------------------------------------------------

test("the weights are declared in one place and sum to the scale", () => {
  const declared = Object.values(RULE_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  assert.equal(declared, MAX_SCORE);
  assert.equal(EVIDENCE_RULES.reduce((sum, rule) => sum + rule.weight, 0), MAX_SCORE);
  const ids = EVIDENCE_RULES.map((rule) => rule.id);
  assert.equal(new Set(ids).size, ids.length, "two rules may not share an id");
  assert.equal(EVIDENCE_RULES.length, 4, "the four evidence signals, and no fifth");
  for (const rule of EVIDENCE_RULES) {
    assert.ok(Object.values(RULE_WEIGHTS).includes(rule.weight),
      `${rule.id} carries a weight that is not one of the declared constants`);
  }
  // The top band is the whole scale, so an A cannot be earned with a gap in it.
  assert.equal(GRADE_BANDS[0].minScore, MAX_SCORE);
  assert.equal(GRADE_BANDS.at(-1).minScore, 0, "every score must land in a band");
});

test("blockers come back heaviest first, ties broken on rule id ascending", () => {
  for (const fixture of FIXTURES.plans) {
    const verdict = gradePlanEvidence(planFor(fixture), fixture.evidence);
    for (const [index, blocker] of verdict.blockers.entries()) {
      if (index === 0) continue;
      const before = verdict.blockers[index - 1];
      assert.ok(before.weight >= blocker.weight, `${fixture.id}: blockers are out of weight order`);
      if (before.weight === blocker.weight) {
        assert.ok(before.ruleId < blocker.ruleId, `${fixture.id}: a tie broke on insertion order`);
      }
    }
  }
  assert.deepEqual(EVIDENCE_RULES_ORDERED.map((rule) => rule.id),
    ["rate-card-declared", "baseline-observed", "exclusions-named", "refusals-recorded"]);
});

// ---------------------------------------------------------------------------
// 3. SCOPE-INSENSITIVITY. The headline claim.
// ---------------------------------------------------------------------------

test("raising every move's claimed share to 100% moves the total and not one point of the grade",
  () => {
    const fixture = fixtureNamed("partial-evidence");
    const low = planFor(fixture);
    const high = planFor(fixture, { commitments: atFullScope(fixture.commitments) });

    // The dollars DO move — otherwise this test proves nothing about the grade.
    assert.ok(high.plannedMonthlyUsd > low.plannedMonthlyUsd,
      "raising the claimed share must raise the plan total");
    assert.equal(high.committedCount, low.committedCount);

    const lowGrade = JSON.stringify(gradePlanEvidence(low, fixture.evidence));
    const highGrade = JSON.stringify(gradePlanEvidence(high, fixture.evidence));
    assert.equal(highGrade, lowGrade,
      "the grade and the whole blocker list must be byte-identical at any claimed scope");
  });

test("no labelled plan's grade moves when every one of its moves is claimed at 100%", () => {
  for (const fixture of FIXTURES.plans) {
    const low = planFor(fixture);
    const high = planFor(fixture, { commitments: atFullScope(fixture.commitments) });
    assert.equal(
      JSON.stringify(gradePlanEvidence(high, fixture.evidence)),
      JSON.stringify(gradePlanEvidence(low, fixture.evidence)),
      `fixture ${fixture.id}: claimed scope reached the grade`);
  }
});

test("the rubric reads no dollar and no lever value at all", () => {
  const fixture = fixtureNamed("partial-evidence");
  const plan = planFor(fixture);
  const facts = evidenceFacts(plan, fixture.evidence);
  // The whole of what the rules see: counts and presence, no money.
  assert.deepEqual(Object.keys(facts).sort(), [
    "baselineObserved", "committedCount", "exclusionsOutstanding", "rateCardDeclared",
    "refusalsOutstanding",
  ]);
  for (const value of Object.values(facts)) {
    assert.ok(typeof value === "number" || typeof value === "boolean", String(value));
  }
  const serialised = JSON.stringify(gradePlanEvidence(plan, fixture.evidence));
  assert.ok(!serialised.includes(String(plan.plannedMonthlyUsd)) || plan.plannedMonthlyUsd === 0,
    "the plan's dollars must not appear in the grade");
});

// ---------------------------------------------------------------------------
// 4. DETERMINISM. The second headline claim.
// ---------------------------------------------------------------------------

test("scoring the same fixture twice serialises byte-identically", () => {
  for (const fixture of FIXTURES.plans) {
    const first = JSON.stringify(gradePlanEvidence(planFor(fixture), fixture.evidence));
    const second = JSON.stringify(gradePlanEvidence(planFor(fixture), fixture.evidence));
    assert.equal(second, first, `fixture ${fixture.id} did not reproduce`);
  }
});

test("the result's key order is fixed, so a serialised grade can be diffed", () => {
  const fixture = fixtureNamed("no-evidence");
  const verdict = gradePlanEvidence(planFor(fixture), fixture.evidence);
  assert.deepEqual(Object.keys(verdict), [
    "version", "graded", "letter", "label", "score", "maxScore", "committedCount",
    "clearedRuleIds", "blockers", "summary", "blockerOrder",
  ]);
  assert.deepEqual(Object.keys(verdict.blockers[0]), [
    "ruleId", "name", "weight", "movesOutstanding", "statement", "assumption",
  ]);
});

test("the commitment order a caller happens to use does not reorder anything", () => {
  const fixture = fixtureNamed("partial-evidence");
  const forwards = gradePlanEvidence(planFor(fixture), fixture.evidence);
  const backwards = gradePlanEvidence(
    planFor(fixture, { commitments: [...fixture.commitments].reverse() }), fixture.evidence);
  assert.equal(JSON.stringify(backwards), JSON.stringify(forwards));
});

// ---------------------------------------------------------------------------
// 5. Lead-entered text is untrusted, and never reaches the rubric or the page.
// ---------------------------------------------------------------------------

test("markup in a move name changes no rule and appears nowhere in the result", () => {
  const fixture = fixtureNamed("no-evidence");
  const hostile = {
    rules: [{
      rank: 1,
      source: "<script>alert('x')</script>",
      unit: "\"><img onerror=steal()>",
      targetTier: "standard",
      expectedMonthlyUsd: 4000,
    }],
  };
  const rule = hostile.rules[0];
  const plan = planScope(hostile, {
    commitments: [{ move: planMoveKey(rule), reroutedSharePct: 10, eligibleTeams: 1 }],
  });
  const verdict = gradePlanEvidence(plan, fixture.evidence);
  const serialised = JSON.stringify(verdict);
  for (const needle of ["script", "onerror", "alert", "img"]) {
    assert.ok(!serialised.includes(needle), `${needle} reached the grade's own output`);
  }
  // And the hostile plan grades exactly as the clean one with the same evidence.
  assert.equal(serialised, JSON.stringify(gradePlanEvidence(planFor(fixture), fixture.evidence)));
});

// ---------------------------------------------------------------------------
// 6. The two analysis-level signals.
// ---------------------------------------------------------------------------

test("a rate card counts as declared only at the shipped ladder's declared tier", () => {
  const declared = planEvidence({
    analysis: { modelRouting: { rateCardConfidence: { tier: "declared" } }, period: "June 2026" },
    imported: true,
  });
  assert.equal(declared.rateCardDeclared, true);
  const listPrices = planEvidence({
    analysis: { modelRouting: { rateCardConfidence: { tier: "illustrative" } } },
    imported: true,
  });
  assert.equal(listPrices.rateCardDeclared, false);
  assert.equal(planEvidence().rateCardDeclared, false, "silence is not a declaration");
});

test("the bundled example's period is not an observed baseline", () => {
  const example = loadExampleDataset();
  assert.ok(typeof example.period === "string" && example.period.length > 0);
  assert.equal(planEvidence({ analysis: example, imported: false }).baselineObserved, false,
    "an invented month is not a measured one");
  assert.equal(planEvidence({ analysis: example, imported: true }).baselineObserved, true);
  assert.equal(planEvidence({ analysis: { period: "  " }, imported: true }).baselineObserved,
    false);
});

// ---------------------------------------------------------------------------
// 7. On the shipped page.
// ---------------------------------------------------------------------------

/** The section, painted from the bundled slate, with whatever a caller seeds. */
async function paint({ commitments = [], evidence = {} } = {}) {
  const page = await loadPage(PAGE, { scripts: false });
  const slate = routingSlate(loadExampleDataset());
  const model = applyPlanScope(page.document, slate, { commitments, evidence });
  return { ...page, slate, model };
}

/** A commitment for the slate's top move, stating whatever is passed in. */
const topMove = (slate, stated = {}) =>
  ({ move: planMoveKey(slate.rules[0]), reroutedSharePct: 40, eligibleTeams: 1, ...stated });

test("with nothing committed the page states the absence instead of showing a number",
  async () => {
    const page = await paint();
    try {
      const line = page.document.getElementById(PLAN_EVIDENCE_GRADE_ID);
      assert.ok(line, "the plan must carry an evidence grade line");
      assert.equal(line.dataset.grade, "absent");
      const text = textOf(line);
      assert.ok(text.includes("Evidence grade: none yet"), text);
      assert.ok(text.includes("nothing to grade"), text);
      assert.ok(!/\b\d+ of 100\b/.test(text), `a bare score reached an ungraded plan: ${text}`);
    } finally {
      page.restore();
    }
  });

test("a committed move earns a letter, and its top blockers are named outside the disclosure",
  async () => {
    const page = await paint({ commitments: [topMove(page0Slate())] });
    try {
      const line = page.document.getElementById(PLAN_EVIDENCE_GRADE_ID);
      assert.equal(line.dataset.grade, "D");
      assert.equal(line.dataset.score, "0");
      assert.equal(line.dataset.blockers, "4");
      const text = textOf(line);
      assert.ok(text.includes("Evidence grade D"), text);
      assert.ok(text.includes("0 of 100 points"), text);
      // Named in the OPEN, because a closed disclosure is dropped from the
      // accessibility tree in a real browser even though the harness reads in.
      assert.ok(text.includes("Declared rate card"), text);
      assert.ok(text.includes("Observed baseline period"), text);
      for (let node = line.parentNode; node; node = node.parentNode) {
        assert.notEqual(node.tagName, "DETAILS", "the named blockers sit inside a disclosure");
      }
    } finally {
      page.restore();
    }
  });

test("every rule behind the letter is accounted for in the grade's own disclosure", async () => {
  const page = await paint({
    commitments: [topMove(page0Slate(), { excludedWorkloads: 2, refusingTeams: 0 })],
    evidence: { rateCardDeclared: true, baselineObserved: false },
  });
  try {
    const line = page.document.getElementById(PLAN_EVIDENCE_GRADE_ID);
    assert.equal(line.dataset.grade, "B");
    assert.equal(line.dataset.score, "75");
    const detail = page.document.getElementById(PLAN_EVIDENCE_DETAIL_ID);
    assert.ok(detail, "the grade must carry its own disclosure");
    const rows = descendants(detail).filter((node) => node.dataset?.rule !== undefined);
    assert.equal(rows.length, 4, "every rule is listed, cleared ones included");
    assert.deepEqual(rows.map((row) => row.dataset.cleared),
      ["true", "false", "true", "true"], "only the unstated baseline may read as not cleared");
    for (const row of rows) {
      const text = textOf(row);
      assert.ok(text.includes(`rule ${row.dataset.rule}`), text);
      assert.ok(text.includes("To clear it:"), text);
      assert.ok(text.includes("Assumption behind this weight:"), text);
    }
    // The summary has to say what is behind it while it is still closed.
    const summary = descendants(detail).find((node) => node.tagName === "SUMMARY");
    assert.equal(textOf(summary), PLAN_EVIDENCE_DETAIL_SUMMARY);
    assert.ok(textOf(detail).includes("75 of 100"), "the letter must be accounted for");
  } finally {
    page.restore();
  }
});

test("the plan's own confidence line and the analysis confidence claim are untouched",
  async () => {
    const page = await loadPage(PAGE, { scripts: false });
    try {
      const analysisBefore = textOf(page.document.getElementById("finops-answer-confidence"));
      const slate = routingSlate(loadExampleDataset());
      applyPlanScope(page.document, slate, { commitments: [topMove(slate)] });
      assert.equal(textOf(page.document.getElementById("finops-answer-confidence")),
        analysisBefore, "the analysis-level confidence claim must not move");
      // Two labels, two words. The shipped plan-confidence line still reads as it
      // did, and the new one never calls itself confidence.
      const planConfidence = textOf(page.document.getElementById("plan-scope-grade"));
      assert.ok(planConfidence.startsWith("Plan confidence:"), planConfidence);
      const evidence = textOf(page.document.getElementById(PLAN_EVIDENCE_GRADE_ID));
      assert.ok(!evidence.toLowerCase().includes("confidence"), evidence);
      assert.ok(!planConfidence.includes("Evidence grade"), planConfidence);
    } finally {
      page.restore();
    }
  });

test("a hostile move name reaches neither the grade line nor its disclosure", async () => {
  const page = await loadPage(PAGE, { scripts: false });
  try {
    const hostile = { rules: [{
      rank: 1,
      source: "<script>alert('x')</script>",
      unit: "Support",
      targetTier: "standard",
      expectedMonthlyUsd: 4000,
    }] };
    applyPlanScope(page.document, hostile, { commitments: [topMove(hostile)] });
    const text = textOf(page.document.getElementById(PLAN_EVIDENCE_GRADE_ID))
      + textOf(page.document.getElementById(PLAN_EVIDENCE_DETAIL_ID));
    for (const needle of ["script", "alert"]) {
      assert.ok(!text.includes(needle), `${needle} was rendered into the grade`);
    }
  } finally {
    page.restore();
  }
});

/** The bundled slate, for the seeded commitments above. */
function page0Slate() {
  return routingSlate(loadExampleDataset());
}
