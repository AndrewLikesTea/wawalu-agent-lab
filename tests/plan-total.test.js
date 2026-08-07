// The plan-level recoverable total, over the committed moves only (#1287).
//
// What this file exists to catch:
//
//   * a total that counts a move nobody committed, or that lists one.
//   * an exclusion or a refusal rendered BESIDE the figure instead of inside it
//     — the levers have to shrink the dollars, not annotate them.
//   * a committed move with no feasible scope quietly dropped, or arriving as a
//     near-zero float instead of an exact 0.
//   * per-move figures rounded and then added, so the parts stop matching the
//     total. The rule is one rounding, at the end, from the unrounded sum.
//   * a list-priced figure described as a declared rate.
//   * a module nothing renders: every plan below is asserted twice, once on the
//     computation and once on the real markup in src/evolution.html.
//
// The three plans — none committed, partial scope, full scope — are built here
// rather than committed as a file, and the expected contribution of every move
// is written out so the arithmetic can be checked by hand.

import assert from "node:assert/strict";
import test from "node:test";

import { formatUsd } from "../src/evolution.js";
import { planMoveKey, planScope } from "../src/plan-scope.js";
import { PLAN_TOTAL_WORKING_SUMMARY, applyPlanScope } from "../src/plan-scope-view.js";
import { PLAN_TOTAL_STEPS, RATE_CARD_BASIS, planTotal } from "../src/plan-total.js";
import { loadPage, textOf } from "./support/browser.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

/** Four modelled moves, in the slate's own shape. Whole dollars, so the sums are checkable. */
const RULES = [
  { rank: 1, source: "gpt-premium", targetTier: "standard", unit: "Atlas Platform", expectedMonthlyUsd: 4000 },
  { rank: 2, source: "gpt-premium", targetTier: "standard", unit: "Beacon Data", expectedMonthlyUsd: 2500 },
  { rank: 3, source: "claude-premium", targetTier: "standard", unit: "Corex", expectedMonthlyUsd: 999 },
  { rank: 4, source: "gpt-premium", targetTier: "standard", unit: "Delta Labs", expectedMonthlyUsd: 5000 },
];

const slateOf = (pricing = null) => ({ rules: RULES, pricing });
const commit = (index, scope) => ({ move: planMoveKey(RULES[index]), owner: "A lead", ...scope });

/**
 * The three plans, with every expected figure spelled out.
 *
 * `contributions` is one entry per IN-PLAN move, in slate order. `unrounded` is
 * the exact sum; `total` is that sum rounded once. The partial plan is chosen so
 * the two rounding rules disagree: 750 + 312.5 + 62.4375 + 0 = 1124.9375 rounds
 * to 1125, while truncating each row first would give 1124.
 */
const PLANS = [
  {
    name: "none committed",
    commitments: [],
    contributions: [],
    unrounded: 0,
    total: 0,
  },
  {
    name: "partial scope",
    commitments: [
      // 4000 x 50% x (3/4 workloads) x (1/2 teams) = 750
      commit(0, { reroutedSharePct: 50, eligibleWorkloads: 4, excludedWorkloads: 1, eligibleTeams: 2, refusingTeams: 1 }),
      // 2500 x 100% x (1/4) x (1/2) = 312.5
      commit(1, { reroutedSharePct: 100, eligibleWorkloads: 4, excludedWorkloads: 3, eligibleTeams: 2, refusingTeams: 1 }),
      // 999 x 25% x (2/8) = 62.4375
      commit(2, { reroutedSharePct: 25, eligibleWorkloads: 8, excludedWorkloads: 6 }),
      // Every eligible workload excluded: no feasible scope, so exactly 0.
      commit(3, { reroutedSharePct: 100, eligibleWorkloads: 3, excludedWorkloads: 3 }),
    ],
    contributions: [750, 312.5, 62.4375, 0],
    unrounded: 1124.9375,
    total: 1125,
  },
  {
    name: "full scope",
    commitments: [
      commit(0, { reroutedSharePct: 100, excludedWorkloads: 0, refusingTeams: 0 }),
    ],
    contributions: [4000],
    unrounded: 4000,
    total: 4000,
  },
];

const modelFor = (plan, pricing = null) =>
  planScope(slateOf(pricing), { commitments: plan.commitments });

// ---------------------------------------------------------------------------
// 1. The computation.
// ---------------------------------------------------------------------------

for (const plan of PLANS) {
  test(`the ${plan.name} plan totals its committed moves and nothing else`, () => {
    const model = modelFor(plan);
    assert.deepEqual(model.total.moves.map((move) => move.contribution), plan.contributions);
    assert.equal(model.total.unroundedTotalUsd, plan.unrounded);
    assert.equal(model.total.totalRecoverableUsd, plan.total);
    // The section's one figure is that figure: not a second arithmetic beside it.
    assert.equal(model.plannedMonthlyUsd, plan.total);
    // Exactly the in-plan moves are listed, and they are the committed ones.
    assert.equal(model.total.moveCount, plan.commitments.length);
    assert.deepEqual(model.total.moves.map((move) => move.leverId),
      model.moves.filter((move) => move.committed).map((move) => move.key));
  });
}

test("a move that is not in the plan is in neither the list nor the total", () => {
  const plan = PLANS[2];
  const model = modelFor(plan);
  const uncommitted = model.moves.filter((move) => !move.committed);
  assert.ok(uncommitted.length > 0, "the fixture must leave a modelled move uncommitted");
  for (const move of uncommitted) {
    assert.equal(move.plannedMonthlyUsd, 0);
    assert.equal(model.total.moves.some((entry) => entry.leverId === move.key), false,
      `${move.key} is not in the plan but appears in its derivation`);
  }
  // And its modelled dollars are not hiding in the sum.
  assert.equal(model.total.unroundedTotalUsd, plan.unrounded);
});

test("the four steps are published as data, in the declared order", () => {
  const [entry] = modelFor(PLANS[1]).total.moves;
  assert.deepEqual(Object.keys(entry),
    ["leverId", "rateCardBasis", "modelledMove", "appliedScope", "contribution"]);
  assert.deepEqual(PLAN_TOTAL_STEPS.map((step) => step.key),
    ["rateCardBasis", "modelledMove", "appliedScope", "contribution"]);
  assert.equal(entry.modelledMove, 4000);
  assert.equal(entry.appliedScope, 0.1875);
  assert.equal(entry.contribution, 750);
  assert.equal(typeof entry.rateCardBasis.source, "string");
});

test("excluded workloads and refusing teams shrink the number, not a note beside it", () => {
  const rule = RULES[0];
  const unreduced = planScope(slateOf(), {
    commitments: [commit(0, { reroutedSharePct: 50 })],
  });
  const reduced = planScope(slateOf(), {
    commitments: [commit(0, {
      reroutedSharePct: 50, eligibleWorkloads: 4, excludedWorkloads: 1,
      eligibleTeams: 2, refusingTeams: 1,
    })],
  });
  assert.equal(unreduced.total.moves[0].contribution, rule.expectedMonthlyUsd * 0.5);
  assert.equal(reduced.total.moves[0].contribution, rule.expectedMonthlyUsd * 0.5 * 0.75 * 0.5);
  assert.ok(reduced.plannedMonthlyUsd < unreduced.plannedMonthlyUsd,
    "an exclusion and a refusal left the figure unchanged");
});

test("a committed move with no feasible scope contributes exactly 0 and is still listed", () => {
  const model = modelFor(PLANS[1]);
  const zero = model.total.moves.at(-1);
  assert.equal(zero.leverId, planMoveKey(RULES[3]));
  assert.equal(zero.appliedScope, 0);
  assert.ok(Object.is(zero.contribution, 0),
    `a zero-scope move contributed ${zero.contribution}, not an exact 0`);
  assert.equal(formatUsd(zero.contribution), "$0");
  // Its whole modelled figure is real and is still not in the total.
  assert.equal(zero.modelledMove, 5000);
  assert.equal(model.total.unroundedTotalUsd, PLANS[1].unrounded);
});

test("the total is rounded once, from the unrounded sum", () => {
  const model = modelFor(PLANS[1]);
  const perMoveTruncated = model.total.moves
    .reduce((sum, move) => sum + Math.trunc(move.contribution), 0);
  assert.equal(perMoveTruncated, 1124);
  assert.equal(model.total.totalRecoverableUsd, 1125,
    "the total was summed from pre-rounded per-move figures");
  assert.equal(model.total.unroundedTotalUsd, 1124.9375);
});

test("pricing is reported, never re-decided, and silence is called list price", () => {
  const listed = modelFor(PLANS[2]);
  assert.equal(listed.total.basis.source, RATE_CARD_BASIS.LIST);
  assert.match(listed.total.basisText, /published list prices/);
  assert.doesNotMatch(listed.total.basisText, /Priced at the rate card/);

  const declared = modelFor(PLANS[2], {
    rateSource: "declared", cardId: "acme-2026", discountApplied: true,
  });
  assert.equal(declared.total.basis.source, RATE_CARD_BASIS.DECLARED);
  assert.equal(declared.total.basis.cardId, "acme-2026");
  assert.match(declared.total.basisText, /declared \(acme-2026\), committed-use discount applied/);
  // The card changes what the figure is CALLED, never what it is: this module
  // multiplies a figure the one pricing path already priced.
  assert.equal(declared.total.unroundedTotalUsd, listed.total.unroundedTotalUsd);
});

test("planTotal counts only what is flagged in-plan", () => {
  const result = planTotal({
    moves: [
      { leverId: "in", inPlan: true, appliedScope: 0.5, modelledMove: 100 },
      { leverId: "out", inPlan: false, appliedScope: 1, modelledMove: 900 },
      { leverId: "silent", inPlan: undefined, appliedScope: 1, modelledMove: 700 },
      { leverId: "unreadable", inPlan: true, appliedScope: "half", modelledMove: 400 },
    ],
  });
  assert.deepEqual(result.moves.map((move) => move.leverId), ["in", "unreadable"]);
  // An unreadable scope is zero, never all of it.
  assert.deepEqual(result.moves.map((move) => move.contribution), [50, 0]);
  assert.equal(result.totalRecoverableUsd, 50);
});

// ---------------------------------------------------------------------------
// 2. The page renders it. The markup is the shipped src/evolution.html.
// ---------------------------------------------------------------------------

const rowsOf = (document) => document.getElementById("plan-scope-contributions")
  .querySelectorAll("li").filter((node) => node.dataset.planMove);

for (const plan of PLANS) {
  test(`the plan section renders the ${plan.name} total and every move in it`, async () => {
    const { document } = await loadPage(PAGE, { scripts: false });
    const model = applyPlanScope(document, slateOf(), { commitments: plan.commitments });
    assert.equal(model.plannedMonthlyUsd, plan.total);

    const figure = textOf(document.getElementById("plan-scope-figure"));
    assert.ok(figure.includes(`${formatUsd(plan.total)} planned`), figure);
    assert.ok(textOf(document.getElementById("plan-scope-status"))
      .includes(`${formatUsd(plan.total)} planned`));

    const list = document.getElementById("plan-scope-contributions");
    assert.equal(list.dataset.moveCount, String(plan.contributions.length));
    const rows = rowsOf(document);
    assert.equal(rows.length, plan.contributions.length);
    for (const [index, contribution] of plan.contributions.entries()) {
      assert.equal(rows[index].dataset.contribution, String(contribution));
      assert.ok(textOf(rows[index]).includes(`${formatUsd(contribution)} a month`),
        textOf(rows[index]));
    }
  });
}

test("the empty plan states $0 and an empty list rather than disappearing", async () => {
  const { document } = await loadPage(PAGE, { scripts: false });
  applyPlanScope(document, slateOf(), { commitments: [] });
  const list = document.getElementById("plan-scope-contributions");
  assert.equal(list.dataset.moveCount, "0");
  assert.equal(rowsOf(document).length, 0);
  const empty = list.querySelectorAll("li").filter((node) => node.dataset.planEmpty);
  assert.equal(empty.length, 1, "nothing states that the plan is empty");
  assert.match(textOf(empty[0]), /recoverable total is \$0/);
  assert.ok(textOf(document.getElementById("plan-scope-figure")).includes("$0 planned"));
});

test("every rendered move carries the four-step derivation, in the pattern the page uses",
  async () => {
    const { document } = await loadPage(PAGE, { scripts: false });
    applyPlanScope(document, slateOf(), { commitments: PLANS[1].commitments });
    const rows = rowsOf(document);
    for (const row of rows) {
      const details = row.querySelectorAll("details");
      assert.equal(details.length, 1, "a move states its derivation twice, or not at all");
      assert.equal(details[0].hasAttribute("open"), false,
        "the derivation ships open, so the working arrives before the figure");
      assert.ok(details[0].className.includes("figure-source"),
        "the derivation forks the disclosure silhouette the page already ships");
      const summary = details[0].querySelectorAll("summary");
      assert.equal(summary.length, 1);
      assert.equal(textOf(summary[0]).replace(/[▸▾\s]+/g, " ").trim(),
        PLAN_TOTAL_WORKING_SUMMARY);
      assert.equal(summary[0].getAttribute("aria-expanded"), "false");
      assert.deepEqual(details[0].querySelectorAll("dt").map((node) => textOf(node).trim()),
        PLAN_TOTAL_STEPS.map((step) => step.label));
      assert.equal(details[0].querySelectorAll("dd").length, PLAN_TOTAL_STEPS.length);
    }

    // The first move's working, checkable by hand: 4000 x 18.75% = 750.
    const first = textOf(rows[0].querySelectorAll("dl")[0]);
    assert.match(first, /published list prices/);
    assert.match(first, /\$4,000/);
    assert.match(first, /18\.75%/);
    assert.match(first, /\$750 a month, exactly 750/);

    // And the zero-scope move says why it is worth nothing rather than showing a blank.
    const zero = textOf(rows[3].querySelectorAll("dl")[0]);
    assert.match(zero, /No feasible scope is left/);
    assert.match(zero, /\$0 a month, exactly 0/);
  });

test("with no declared card no move's derivation implies a declared rate", async () => {
  const { document } = await loadPage(PAGE, { scripts: false });
  applyPlanScope(document, slateOf(), { commitments: PLANS[2].commitments });
  const text = textOf(document.getElementById("plan-scope-contributions"));
  assert.match(text, /No rate card has been declared/);
  assert.doesNotMatch(text, /Priced at the rate card/);

  const declared = await loadPage(PAGE, { scripts: false });
  applyPlanScope(declared.document, slateOf({ rateSource: "declared", cardId: "acme-2026" }),
    { commitments: PLANS[2].commitments });
  assert.match(textOf(declared.document.getElementById("plan-scope-contributions")),
    /Priced at the rate card this lead declared \(acme-2026\)/);
});
