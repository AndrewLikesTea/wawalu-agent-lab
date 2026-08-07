// "How much is this plan actually worth, and where did each dollar of it come
// from?" — the plan-level recoverable total, over the committed moves only (#1287).
//
// THE DEFECT THIS CLOSES. #1286 asks a lead which moves they are committing to
// and at what scope, and states the empty-set answer. What it did not publish is
// the DERIVATION of one move's dollars: a reader met a figure with the exclusions
// and refusals described beside it in prose, and no way to check that the number
// had actually been reduced by them. This module makes the four steps data, so
// the page renders the arithmetic rather than a claim about it.
//
// ---------------------------------------------------------------------------
// THE FOUR STEPS, in the order they are reported, for one move
// ---------------------------------------------------------------------------
//
//   rateCardBasis   whose prices priced this move — the lead's declared rate
//                   card, or the published list. READ, NEVER DECIDED HERE.
//   modelledMove    the move's own modelled monthly dollars, already priced at
//                   that basis by the down-routing path. Not recomputed here.
//   appliedScope    the fraction of that move a commitment actually reaches,
//                   0..1, computed from #1286's three levers by #1286.
//   contribution    modelledMove x appliedScope. Nothing else multiplies it.
//
// The plan total is the sum of `contribution` over EXACTLY the in-plan moves. A
// move nobody committed contributes nothing and does not appear in the list at
// all — it is not a zero row, because a zero row reads as a decision somebody
// made about a move rather than as the absence of one.
//
// IT PRICES NOTHING. There is one pricing path in this repository —
// `priceDestination`/`resolveRateCard`, applied by `down-routing-candidates.js`
// before either the slate or this module sees a dollar — and `modelledMove` is
// its output. A second one here would let this page state a total the ranked
// slate above it disagrees with. `rateCardBasis` is therefore a REPORT of what
// that path used, taken off the slate's own `pricing` record: declared when the
// lead declared a card, and the published list otherwise. Saying "declared" over
// a list-priced figure is the specific dishonesty #1286 named, and `basisFor` is
// the only place the word is chosen.
//
// EXCLUSIONS AND REFUSALS ARE ARITHMETIC, NOT ANNOTATION. An excluded workload
// or a refusing team reaches this module only as a smaller `appliedScope`, so it
// has already shrunk `contribution` before anything is rendered. A move whose
// feasible scope is zero contributes EXACTLY 0 — and is still listed, at $0,
// because "we committed to this and it is currently worth nothing" is a fact a
// plan owes its reader.
//
// ROUNDED ONCE, AT PRESENTATION. Every `contribution` is exact. The total is the
// unrounded sum, rounded once, at the end; per-move figures are never rounded
// and re-added, which is how a rendered column stops matching its own total.
//
// PURE. No DOM, no clock, no storage, no network, no credential, no randomness.

/** Bump when a step, the total's definition, or the basis rule changes. */
export const PLAN_TOTAL_VERSION = "plan-total/1.0.0";

/** What the plan-level figure is called wherever it is rendered. */
export const PLAN_TOTAL_LABEL = "Recoverable from the committed moves";

/** The two bases a move can be priced at. There is no third. */
export const RATE_CARD_BASIS = Object.freeze({
  DECLARED: "declared-rate-card",
  LIST: "published-list",
});

/**
 * The four steps, declared once and in order, so every surface renders the same
 * derivation in the same sequence. `key` is the field on a move record.
 */
export const PLAN_TOTAL_STEPS = Object.freeze([
  Object.freeze({
    key: "rateCardBasis",
    label: "Declared rate card",
    question: "Whose prices is this move priced at?",
  }),
  Object.freeze({
    key: "modelledMove",
    label: "Modelled move",
    question: "What is the whole move worth at those prices, before any scope?",
  }),
  Object.freeze({
    key: "appliedScope",
    label: "Applied scope",
    question: "What fraction of it is committed, after excluded workloads and refusing teams?",
  }),
  Object.freeze({
    key: "contribution",
    label: "Contribution",
    question: "So what does this move put into the plan total?",
  }),
]);

/**
 * The sentence stating the basis. The list-price case says LIST PRICE in plain
 * words rather than going quiet: silence beside a dollar figure reads as a
 * declared rate to every reader who did not write this file.
 */
export function rateCardBasisText(basis) {
  if (basis?.source !== RATE_CARD_BASIS.DECLARED) {
    return "No rate card has been declared, so this move is priced at published list prices — "
      + "a ceiling, not your contract.";
  }
  return "Priced at the rate card this lead declared"
    + `${basis.cardId ? ` (${basis.cardId})` : ""}`
    + `${basis.discountApplied ? ", committed-use discount applied" : ""}.`;
}

/**
 * What priced this plan, read off the slate's own pricing record and nothing
 * else. A slate that carries no record at all is the undeclared case — the
 * analysis still had prices, they were the published list.
 */
function basisFor(pricing) {
  const declared = pricing?.rateSource === "declared";
  return Object.freeze({
    source: declared ? RATE_CARD_BASIS.DECLARED : RATE_CARD_BASIS.LIST,
    cardId: declared && pricing.cardId ? String(pricing.cardId) : null,
    discountApplied: declared && Boolean(pricing.discountApplied),
  });
}

/** A fraction in 0..1. Anything unreadable is zero: unstated scope is never all of it. */
function scopeOf(value) {
  const share = Number(value);
  if (!Number.isFinite(share) || share <= 0) return 0;
  return Math.min(1, share);
}

/** Modelled dollars as stated, or 0 for a figure this module cannot read. */
function modelledOf(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : 0;
}

/**
 * One move's dollars. Zero scope short-circuits to an exact 0 rather than
 * multiplying: `0 * x` is already exact for every finite x, but the guard also
 * keeps a negative modelled figure from producing -0, which formats as "-$0".
 */
function contributionOf(modelled, scope) {
  return scope === 0 ? 0 : modelled * scope;
}

/** The unrounded sum, rounded once, to the whole dollars this page renders in. */
function roundOnce(total) {
  const rounded = Math.round(total);
  // `Math.round(-0)` is -0, which formats as "-$0". A plan is never worth minus nothing.
  return rounded === 0 ? 0 : rounded;
}

/**
 * The plan total, and the derivation of every dollar in it.
 *
 * @param {object} input
 * @param {Array<{leverId: string, inPlan: boolean, appliedScope: number,
 *   modelledMove: number}>} input.moves Every modelled move, in-plan or not,
 *   with the scope fraction #1286's levers resolved to. A move whose `inPlan` is
 *   anything but exactly `true` is dropped here and counted nowhere: an absent
 *   flag is an uncommitted move, never a defaulted-in one.
 * @param {{rateSource?: string, cardId?: string, discountApplied?: boolean}|null}
 *   [input.pricing] The slate's own pricing record — what the one pricing path
 *   used. Absent means no declaration, which is the published list.
 * @returns a frozen record: the basis, one derivation per in-plan move, the
 *   unrounded sum and the figure to render.
 */
export function planTotal({ moves = [], pricing = null } = {}) {
  const basis = basisFor(pricing);
  const derived = (Array.isArray(moves) ? moves : [])
    .filter((move) => move?.inPlan === true)
    .map((move) => {
      const modelledMove = modelledOf(move.modelledMove);
      const appliedScope = scopeOf(move.appliedScope);
      // The four steps, in the declared order, as data. A surface renders them;
      // no surface re-derives them, and none of them is a sentence here.
      return Object.freeze({
        leverId: String(move.leverId ?? ""),
        rateCardBasis: basis,
        modelledMove,
        appliedScope,
        contribution: contributionOf(modelledMove, appliedScope),
      });
    });
  const unroundedTotalUsd = derived.reduce((sum, move) => sum + move.contribution, 0);
  return Object.freeze({
    version: PLAN_TOTAL_VERSION,
    label: PLAN_TOTAL_LABEL,
    basis,
    basisText: rateCardBasisText(basis),
    steps: PLAN_TOTAL_STEPS,
    moves: Object.freeze(derived),
    moveCount: derived.length,
    /** The exact sum. Kept so a caller can check the rounding rather than trust it. */
    unroundedTotalUsd,
    /** The rendered figure: the unrounded sum above, rounded exactly once. */
    totalRecoverableUsd: roundOnce(unroundedTotalUsd),
  });
}
