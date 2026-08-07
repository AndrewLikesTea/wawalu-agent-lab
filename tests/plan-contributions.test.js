// The plan total, and the arithmetic a reader can redo by hand (#1287).
//
// WHAT THIS FILE EXISTS TO CATCH:
//
//   * a move that is NOT in the plan contributing anything, at any scope.
//   * a scope applied as a rounded band rather than at the stated fraction —
//     40% must be 40% of the modelled figure, not "about half".
//   * a plan quoting list prices when a rate card has been declared.
//   * a feasible scope of zero rendered as a near-zero. Every such assertion
//     below is an EXACT `0`, and `-0` fails it (`Object.is(-0, 0)` is false).
//   * a hidden floor, cap, confidence haircut or round-up sneaking into the sum.
//   * a module with no consumer: the last section drives the real markup from
//     src/evolution.html and asserts the page RENDERS these totals.
//
// THE FIXTURES ARE WRITTEN OUT, NOT GENERATED. Three plans, with every modelled
// figure, every lever and every expected contribution stated as a literal, so a
// reviewer recomputes the column with a calculator and no imports.
//
// HARNESS CAVEAT, and why the disclosure assertions look the way they do: the
// test double reads text straight through a shut disclosure element, which a
// real browser hides. So the "how we know this" assertions check the disclosure
// ATTRIBUTES — `aria-expanded`, `data-disclosure`, `hidden` as a property — as
// well as the words.

import assert from "node:assert/strict";
import test from "node:test";

import {
  PLAN_ROUNDING_MODE, PLAN_ROUNDING_RULE, ZERO_REASONS, moveContribution, planContributions,
  planRateBasis, statedScopePct,
} from "../src/plan-contributions.js";
import { analyzeModelRouting } from "../src/down-routing-candidates.js";
import { DEFAULT_REFERENCE_CARD } from "../src/finops-rate-card-contract.js";
import { planMoveKey, planScope } from "../src/plan-scope.js";
import { PLAN_SCOPE_BASIS_ID, applyPlanScope, planWorkingId } from "../src/plan-scope-view.js";
import { routingSlate } from "../src/routing-slate.js";
import { loadPage, textOf } from "./support/browser.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

// ---------------------------------------------------------------------------
// The fixture. Three modelled moves, priced once, reused by every plan below.
// ---------------------------------------------------------------------------

/** The slate's own rule shape, reduced to what the plan reads off it. */
const RULES = Object.freeze([
  Object.freeze({
    rank: 1, source: "Atlas Platform", unit: "Atlas Platform", targetTier: "standard",
    expectedMonthlyUsd: 10_000,
  }),
  Object.freeze({
    rank: 2, source: "premium-alpha", unit: "Borealis Data", targetTier: "standard",
    expectedMonthlyUsd: 4_000,
  }),
  Object.freeze({
    rank: 3, source: "Cygnus Support", unit: "Cygnus Support", targetTier: "standard",
    expectedMonthlyUsd: 999,
  }),
]);

const KEYS = RULES.map((rule) => planMoveKey(rule));

/** A slate carrying those rules and a stated pricing provenance. */
const slateOf = (pricing) => Object.freeze({ rules: RULES, pricing });

const REFERENCE_PRICING = Object.freeze({
  rateSource: "reference", cardId: "published-list-reference", discountApplied: false,
});
const DECLARED_PRICING = Object.freeze({
  rateSource: "declared", cardId: "acme-2026-contract", discountApplied: true,
});

/**
 * A commitment in #1286's own shape. `eligibleTeams: 1` is that module's stated
 * fact about a slate rule — one rule names one org unit — so a single refusal
 * removes the whole move.
 */
const commit = (index, { sharePct = null, refusing = null, eligibleWorkloads = null,
  excludedWorkloads = null } = {}) => ({
  move: KEYS[index],
  reroutedSharePct: sharePct,
  eligibleTeams: 1,
  refusingTeams: refusing,
  eligibleWorkloads,
  excludedWorkloads,
});

/**
 * THE THREE PINNED PLANS. Every number here is written down rather than derived,
 * and the arithmetic is in the comment beside it.
 */
const PLANS = Object.freeze([
  Object.freeze({
    name: "none committed",
    commitments: Object.freeze([]),
    // Nothing is in the plan, so the sum is over an empty set.
    contributions: Object.freeze([0, 0, 0]),
    total: 0,
  }),
  Object.freeze({
    name: "partial scope",
    // Rank 1 at 40%, rank 2 at 100%, rank 3 left out of the plan entirely.
    commitments: Object.freeze([commit(0, { sharePct: 40 }), commit(1, { sharePct: 100 })]),
    //  10,000 x 0.40 = 4,000
    //   4,000 x 1.00 = 4,000
    //     999 — not in the plan =     0
    //                             ------
    //                              8,000
    contributions: Object.freeze([4_000, 4_000, 0]),
    total: 8_000,
  }),
  Object.freeze({
    name: "full scope",
    commitments: Object.freeze([
      commit(0, { sharePct: 100 }), commit(1, { sharePct: 100 }), commit(2, { sharePct: 100 }),
    ]),
    //  10,000 + 4,000 + 999 = 14,999
    contributions: Object.freeze([10_000, 4_000, 999]),
    total: 14_999,
  }),
]);

const ledgerFor = (plan, pricing = REFERENCE_PRICING) =>
  planScope(slateOf(pricing), { commitments: plan.commitments }).ledger;

// ---------------------------------------------------------------------------
// 1. The pure function: three plans, per-move contributions and one total.
// ---------------------------------------------------------------------------

for (const plan of PLANS) {
  test(`the ${plan.name} plan pins every contribution and its total`, () => {
    const ledger = ledgerFor(plan);
    assert.equal(ledger.contributions.length, RULES.length,
      "every modelled move keeps a row, in or out of the plan");
    assert.deepEqual(
      ledger.contributions.map((row) => row.contributionMonthlyUsd),
      [...plan.contributions],
      "a per-move contribution moved away from the pinned arithmetic");
    assert.equal(ledger.totalMonthlyUsd, plan.total);
    // The total is the sum of the rendered column and nothing else.
    assert.equal(
      ledger.contributions.filter((row) => row.inPlan)
        .reduce((sum, row) => sum + row.contributionMonthlyUsd, 0),
      plan.total);
    assert.equal(ledger.inPlanCount, plan.commitments.length);
  });
}

test("with nothing committed the total is exactly zero, not a near-zero", () => {
  const ledger = ledgerFor(PLANS[0]);
  assert.equal(ledger.totalMonthlyUsd, 0);
  assert.equal(Object.is(ledger.totalMonthlyUsd, -0), false, "the empty plan totalled -0");
  for (const row of ledger.contributions) {
    assert.equal(row.contributionMonthlyUsd, 0);
    assert.equal(row.feasibleScope, 0);
    assert.equal(row.zeroReason, ZERO_REASONS.not_in_plan);
  }
});

test("a move out of the plan contributes nothing at any scope, including 100%", () => {
  for (const sharePct of [0, 1, 40, 99, 100]) {
    const row = moveContribution({
      key: "k", name: "a move", modelledMonthlyUsd: 10_000, inPlan: false,
      reroutedSharePct: sharePct, eligibleTeams: 1,
    });
    assert.equal(row.contributionMonthlyUsd, 0, `a move out of the plan paid at ${sharePct}%`);
    assert.equal(row.feasibleScope, 0);
    // The lever the lead stated is still REPORTED — the row goes quiet, not blank.
    assert.equal(row.sharePct, sharePct);
  }
});

test("a stated scope is applied at exactly its fraction, not a rounded band", () => {
  // 10,000 at each whole percent is that percent of the modelled figure.
  for (const [sharePct, expected] of [[1, 100], [17, 1_700], [40, 4_000], [99, 9_900]]) {
    const ledger = planScope(slateOf(REFERENCE_PRICING), {
      commitments: [commit(0, { sharePct })],
    }).ledger;
    assert.equal(ledger.totalMonthlyUsd, expected, `${sharePct}% of 10,000`);
  }
});

// ---------------------------------------------------------------------------
// 2. A feasible scope of zero is an exact zero.
// ---------------------------------------------------------------------------

test("a refusing team takes the whole move to exactly $0", () => {
  const ledger = planScope(slateOf(REFERENCE_PRICING), {
    commitments: [commit(0, { sharePct: 100, refusing: 1 }), commit(1, { sharePct: 100 })],
  }).ledger;
  const [refused] = ledger.contributions;
  assert.equal(refused.teamFactor, 0);
  assert.equal(refused.feasibleScope, 0);
  assert.equal(refused.contributionMonthlyUsd, 0);
  assert.equal(Object.is(refused.contributionMonthlyUsd, -0), false);
  assert.equal(refused.zeroReason, ZERO_REASONS.all_teams_refused);
  // And it is subtracted from the plan, not annotated onto it.
  assert.equal(ledger.totalMonthlyUsd, 4_000);
});

test("excluded workloads reduce the scope arithmetically once a base is declared", () => {
  // Two of five eligible workloads excluded: 10,000 x 1.00 x 0.6 = 6,000.
  const reduced = planScope(slateOf(REFERENCE_PRICING), {
    commitments: [commit(0, { sharePct: 100, eligibleWorkloads: 5, excludedWorkloads: 2 })],
  }).ledger;
  assert.equal(reduced.contributions[0].workloadFactor, 0.6);
  assert.equal(reduced.totalMonthlyUsd, 6_000);

  // All five excluded: an exact zero, and the reason names the cause.
  const emptied = planScope(slateOf(REFERENCE_PRICING), {
    commitments: [commit(0, { sharePct: 100, eligibleWorkloads: 5, excludedWorkloads: 5 })],
  }).ledger;
  assert.equal(emptied.contributions[0].workloadFactor, 0);
  assert.equal(emptied.totalMonthlyUsd, 0);
  assert.equal(emptied.contributions[0].zeroReason, ZERO_REASONS.all_workloads_excluded);

  // Excluding MORE than the declared base contradicts itself: nothing planned,
  // never a negative saving that would credit the plan for the contradiction.
  const overdrawn = planScope(slateOf(REFERENCE_PRICING), {
    commitments: [commit(0, { sharePct: 100, eligibleWorkloads: 5, excludedWorkloads: 9 })],
  }).ledger;
  assert.equal(overdrawn.totalMonthlyUsd, 0);
});

test("with no declared eligible base the workload factor is 1 and the row says so", () => {
  // #1286's rule, unchanged: nothing on this page knows how many workloads a
  // move is eligible for, so naming one cannot honestly shrink the dollars.
  const ledger = planScope(slateOf(REFERENCE_PRICING), {
    commitments: [commit(0, { sharePct: 100, excludedWorkloads: 3 })],
  }).ledger;
  assert.equal(ledger.contributions[0].workloadFactor, 1);
  assert.equal(ledger.contributions[0].workloadBaseDeclared, false);
  assert.equal(ledger.totalMonthlyUsd, 10_000);
});

// ---------------------------------------------------------------------------
// 3. No floor, no cap, no haircut, and one rounding at one place.
// ---------------------------------------------------------------------------

test("the rounding rule is truncation, stated in the returned data", () => {
  const ledger = ledgerFor(PLANS[1]);
  assert.equal(ledger.rounding.mode, PLAN_ROUNDING_MODE);
  assert.equal(ledger.rounding.rule, PLAN_ROUNDING_RULE);
  assert.equal(ledger.rounding.unit, "whole USD per month");
  for (const row of ledger.contributions) assert.equal(row.rounding, PLAN_ROUNDING_MODE);
});

test("a fractional contribution is truncated toward zero, never rounded up", () => {
  // 999 x 0.40 = 399.6 → 399. A round-half-up would pay 400.
  const ledger = planScope(slateOf(REFERENCE_PRICING), {
    commitments: [commit(2, { sharePct: 40 })],
  }).ledger;
  const row = ledger.contributions[2];
  assert.equal(row.exactMonthlyUsd, 399.6);
  assert.equal(row.contributionMonthlyUsd, 399);
  assert.equal(ledger.totalMonthlyUsd, 399);
});

test("a scope that recovers under a dollar contributes nothing rather than one", () => {
  // 999 x 0.001 is not reachable through the levers (whole percents only), so
  // the boundary is tested at the smallest one that is: 1% of 99 is 0.99.
  const row = moveContribution({
    key: "k", name: "a small move", modelledMonthlyUsd: 99, inPlan: true,
    reroutedSharePct: 1, eligibleTeams: 1,
  });
  assert.equal(row.exactMonthlyUsd, 0.99);
  assert.equal(row.contributionMonthlyUsd, 0);
  assert.equal(row.zeroReason, ZERO_REASONS.below_one_dollar);
});

test("the plan total is the sum of the rows and carries no minimum", () => {
  // Three moves each truncating to 0 sum to 0, not to a floor of anything.
  const ledger = planScope(slateOf(REFERENCE_PRICING), {
    commitments: KEYS.map((_, index) => commit(index, { sharePct: 0 })),
  }).ledger;
  assert.equal(ledger.inPlanCount, 3);
  assert.equal(ledger.totalMonthlyUsd, 0);
  assert.match(ledger.reconciliation, /^0 \+ 0 \+ 0 = 0$/);
});

test("the reconciliation writes the sum out for a hand check", () => {
  assert.equal(ledgerFor(PLANS[1]).reconciliation, "4000 + 4000 = 8000");
  assert.equal(ledgerFor(PLANS[2]).reconciliation, "10000 + 4000 + 999 = 14999");
  assert.match(ledgerFor(PLANS[0]).reconciliation, /empty set = 0$/);
});

// ---------------------------------------------------------------------------
// 4. The range check lives here, not at the control.
// ---------------------------------------------------------------------------

test("an out-of-range or fractional scope is refused, and refused as no scope", () => {
  for (const value of [-1, 101, 1_000, 40.5, Number.NaN, Number.POSITIVE_INFINITY, "40"]) {
    const read = statedScopePct(value);
    assert.equal(read.stated, false, `${value} was accepted as a stated scope`);
    assert.equal(read.pct, 0);
  }
  // A harness select accepts any value, so the refusal is proved through the
  // module: a 400% commitment plans nothing rather than quadrupling the move.
  const ledger = planScope(slateOf(REFERENCE_PRICING), {
    commitments: [commit(0, { sharePct: 400 })],
  }).ledger;
  assert.equal(ledger.totalMonthlyUsd, 0);
  assert.equal(ledger.contributions[0].scopeRefused, true);
  assert.equal(ledger.contributions[0].zeroReason, ZERO_REASONS.scope_out_of_range);
});

// ---------------------------------------------------------------------------
// 5. Pricing goes through the repriced path, and never quotes list prices.
// ---------------------------------------------------------------------------

test("a declared card is named on the plan and on every row", () => {
  const ledger = ledgerFor(PLANS[1], DECLARED_PRICING);
  assert.equal(ledger.rateBasis.declared, true);
  assert.equal(ledger.rateBasis.rateSource, "declared");
  assert.equal(ledger.rateBasis.cardId, "acme-2026-contract");
  assert.match(ledger.rateBasis.statement, /acme-2026-contract/);
  assert.match(ledger.rateBasis.statement, /committed-use discounts applied/);
  for (const row of ledger.contributions) {
    assert.equal(row.rateSource, "declared");
    assert.equal(row.rateCardId, "acme-2026-contract");
  }
});

test("a card claimed without being named resolves DOWN to reference, never up", () => {
  const basis = planRateBasis({ rateSource: "declared", cardId: null, discountApplied: true });
  assert.equal(basis.declared, false);
  assert.equal(basis.rateSource, "reference");
  assert.equal(basis.discountApplied, false, "an unnamed card cannot claim a discount");
  assert.match(basis.statement, /list-price ceiling/);
});

test("the plan reads the repriced figure the analysis produced, not a list price", () => {
  // The same usage, priced twice: once with no card (reference list rates) and
  // once with a contracted card at 20% off the standard tier. The plan total has
  // to MOVE, which it can only do if the repriced path reached it.
  const usage = {
    orgUnitId: "unit-atlas",
    model: "premium-alpha",
    provider: "openai",
    inputTokens: 3_000_000_000,
    outputTokens: 1_000_000_000,
    tokens: 4_000_000_000,
    requests: 4_000_000,
    spendMinor: 10_000_000,
    estimated: false,
    sourceRows: 12,
  };
  const declaredCard = {
    contractVersion: DEFAULT_REFERENCE_CARD.contractVersion,
    cardId: "acme-2026-contract",
    source: "contracted",
    models: [
      { model: "premium-text", label: "the premium text tier", contractedInputRate: 12,
        contractedOutputRate: 36, currency: "USD", effectiveDate: "2026-01-01",
        committedUseDiscountPct: 15, permitted: true },
      { model: "standard-text", label: "the standard text tier", contractedInputRate: 4,
        contractedOutputRate: 8, currency: "USD", effectiveDate: "2026-01-01",
        committedUseDiscountPct: 20, permitted: true },
    ],
  };
  const slateFor = (rateCard) => routingSlate({
    period: "2026-06-01 to 2026-06-30",
    rankedDepartments: [],
    modelRouting: analyzeModelRouting({ modelUsage: [usage], unitIds: ["unit-atlas"], rateCard }),
  });

  const listed = slateFor(null);
  const contracted = slateFor(declaredCard);
  const planFor = (slate) => planScope(slate, {
    commitments: [{ move: planMoveKey(slate.rules[0]), reroutedSharePct: 100, eligibleTeams: 1 }],
  }).ledger;
  const listedPlan = planFor(listed);
  const contractedPlan = planFor(contracted);

  assert.equal(listedPlan.rateBasis.rateSource, "reference");
  assert.equal(contractedPlan.rateBasis.rateSource, "declared");
  assert.equal(contractedPlan.rateBasis.cardId, "acme-2026-contract");
  // Each plan is 100% of its own slate's modelled figure — repriced, not relisted.
  assert.equal(listedPlan.totalMonthlyUsd, listed.rules[0].expectedMonthlyUsd);
  assert.equal(contractedPlan.totalMonthlyUsd, contracted.rules[0].expectedMonthlyUsd);
  assert.notEqual(contractedPlan.totalMonthlyUsd, listedPlan.totalMonthlyUsd,
    "the declared card did not change the plan, so it was priced off the list");
});

// ---------------------------------------------------------------------------
// 6. The four-step derivation, and the disclosure it sits behind.
// ---------------------------------------------------------------------------

const STEPS = ["declared rate card", "modelled move", "applied scope", "contribution"];

test("every row derives its contribution in four steps, in one order", () => {
  const ledger = ledgerFor(PLANS[1], DECLARED_PRICING);
  for (const row of ledger.contributions) {
    assert.deepEqual(row.derivation.map((step) => step.step), STEPS);
    for (const step of row.derivation) {
      assert.ok(step.expression.length > 0, `${step.step} states no expression`);
      assert.ok(String(step.value).length > 0, `${step.step} states no value`);
    }
  }
  // The steps chain: the card, then the modelled figure, then the scope applied
  // to it, then the truncation that yields the number on the row.
  const [first] = ledger.contributions;
  assert.equal(first.derivation[0].value, "acme-2026-contract");
  assert.match(first.derivation[1].value, /^10000 USD a month$/);
  assert.match(first.derivation[2].expression, /40% share/);
  assert.equal(first.derivation[3].expression, "truncate(10000 × 0.4)");
  assert.equal(first.derivation[3].value, "4000 USD a month");
});

// ---------------------------------------------------------------------------
// 7. The page renders these totals. A module with no consumer ships nothing.
// ---------------------------------------------------------------------------

for (const plan of PLANS) {
  test(`the page renders the ${plan.name} plan's total and every contribution`, async () => {
    const { document } = await loadPage(PAGE, { scripts: false });
    const model = applyPlanScope(document, slateOf(REFERENCE_PRICING),
      { commitments: [...plan.commitments] });
    assert.equal(model.plannedMonthlyUsd, plan.total, "the painted model is not the pinned plan");

    // The figure a reader sees, as words.
    const figure = document.getElementById("plan-scope-figure");
    const rendered = textOf(figure);
    assert.ok(rendered.includes(`$${plan.total.toLocaleString("en-US")}`),
      `the figure reads "${rendered}" for a ${plan.total} plan`);

    // Each move's own contribution, on its own row.
    const rows = document.getElementById("plan-scope-body").querySelectorAll("li")
      .filter((node) => node.dataset?.move);
    assert.equal(rows.length, RULES.length);
    assert.deepEqual(rows.map((node) => node.dataset.contribution),
      plan.contributions.map(String));

    // And the line that lets a reader add the column up.
    const basis = textOf(document.getElementById(PLAN_SCOPE_BASIS_ID));
    assert.ok(basis.includes(model.ledger.reconciliation),
      `the total's basis line does not carry the sum: ${basis}`);
    assert.ok(basis.includes("truncated toward zero"), basis);
  });
}

test("the plan's own basis line names the declared card outside every disclosure", async () => {
  const { document } = await loadPage(PAGE, { scripts: false });
  applyPlanScope(document, slateOf(DECLARED_PRICING), { commitments: [...PLANS[1].commitments] });
  const basis = document.getElementById(PLAN_SCOPE_BASIS_ID);
  assert.equal(basis.dataset.rateSource, "declared");
  assert.equal(basis.dataset.rounding, PLAN_ROUNDING_MODE);
  assert.match(textOf(basis), /acme-2026-contract/);
  // Outside every disclosure: a reader must not have to open something to learn
  // which rates priced the figure they were just shown.
  for (let walk = basis.parentNode; walk; walk = walk.parentNode) {
    assert.notEqual(walk.tagName, "DETAILS", "the rate basis was folded into a disclosure");
  }
});

test("each in-plan move exposes a collapsed how-we-know working with all four steps",
  async () => {
    const { document } = await loadPage(PAGE, { scripts: false });
    applyPlanScope(document, slateOf(DECLARED_PRICING), { commitments: [...PLANS[1].commitments] });

    // Ranks 1 and 2 are in the plan; rank 3 is not, so its working is hidden
    // rather than filled with a derivation of a move nobody committed.
    for (const [index, inPlan] of [[0, true], [1, true], [2, false]]) {
      const working = document.getElementById(planWorkingId(index));
      assert.equal(working.tagName, "DETAILS", "the working is not a native disclosure");
      // PROPERTY, not attribute: this harness reflects neither to the other.
      assert.equal(working.hidden, !inPlan, `working ${index} is the wrong visibility`);
      assert.equal(working.dataset.moveInPlan, String(inPlan));
      // COLLAPSED, and saying so twice — the harness reads text straight through
      // a shut disclosure, so the attributes are what prove this is folded.
      assert.equal(working.hasAttribute("open"), false);
      assert.equal(working.dataset.disclosure, "collapsed");
      const summary = working.querySelectorAll("summary")[0];
      assert.equal(summary.getAttribute("aria-expanded"), "false");
      assert.equal(summary.getAttribute("aria-controls"), `${working.id}-detail`);
      assert.ok(textOf(summary).includes("How we know this"), textOf(summary));

      const terms = working.querySelectorAll("dt").map((node) => textOf(node).trim());
      assert.deepEqual(terms, STEPS, `working ${index} states different steps`);
      assert.equal(working.querySelectorAll("dd").length, STEPS.length);
    }

    // The in-plan working carries the arithmetic, not a paraphrase of it.
    const first = textOf(document.getElementById(planWorkingId(0)));
    assert.ok(first.includes("acme-2026-contract"), first);
    assert.ok(first.includes("truncate(10000 × 0.4) = 4000 USD a month"), first);
  });

test("opening a working mirrors its state into what a screen reader is told", async () => {
  const { document } = await loadPage(PAGE, { scripts: false });
  applyPlanScope(document, slateOf(REFERENCE_PRICING), { commitments: [...PLANS[2].commitments] });
  const working = document.getElementById(planWorkingId(0));
  working.setAttribute("open", "");
  working.dispatchEvent({ type: "toggle", bubbles: false });
  assert.equal(working.dataset.disclosure, "expanded");
  assert.equal(working.querySelectorAll("summary")[0].getAttribute("aria-expanded"), "true");
});

test("the working reuses the shipped pattern's classes and adds no stylesheet rule", async () => {
  const { document } = await loadPage(PAGE, { scripts: false });
  applyPlanScope(document, slateOf(REFERENCE_PRICING), { commitments: [...PLANS[2].commitments] });
  const working = document.getElementById(planWorkingId(0));
  assert.ok(working.className.includes("figure-source"),
    "the working forks the shipped disclosure silhouette");
  assert.ok(working.className.includes("how-we-know"));
  const summary = working.querySelectorAll("summary")[0];
  assert.ok(summary.className.includes("figure-source-summary"));
  // The control stays the browser's: no button inside the summary, no tabindex.
  assert.equal(summary.querySelectorAll("button").length, 0);
  assert.equal(summary.getAttribute("tabindex"), null);
});
