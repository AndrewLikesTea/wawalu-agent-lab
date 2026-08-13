// ONE ORDERED LOOP FROM A HEDGED CEILING TO A DEFENSIBLE CLAIM (#1483).
//
// THE PROBLEM. Three surfaces on this page each name a reason the recoverable
// figure is not yet a claim a director could take to a budget meeting: the
// readiness benchmark names the evidence categories that fall short (#1465),
// the pricing provenance names the destinations still priced at the published
// list (#1481), and the graded floor names the spend the rubric has not scored
// (#1482). Each is correct and each is read on its own, so a lead who wants to
// know "what do I do first, and what does doing it buy me?" has to read three
// regions, hold three verdicts in their head, and invent the ordering itself.
//
// SO THIS MODULE ORDERS THEM AND NOTHING ELSE. It is a projection, not a fourth
// opinion: every step it lists is one of the readiness contract's OWN evidence
// categories, in the readiness contract's own order, and whether a step is
// done is decided by the module that owns that question and by no rule here.
//
//   • applicable pricing   → src/finops-declared-rate-contract.js's
//                            `recomputeProvenance`. Done when the card it built
//                            covers every destination this analysis prices, i.e.
//                            when that module's own label reads "Declared".
//   • workload scoring     → src/finops-stand.js's `gradedRecoverableFloor`.
//                            Done when that record says `publishable` — the
//                            coverage bar is FLOOR_PUBLISH_BAR, imported rather
//                            than restated, so moving the tier table moves this
//                            loop's step with it.
//   • everything else      → the readiness contract's own `sufficient` flag.
//
// NO FIGURE IS COMPUTED HERE. No dollar amount, no score, no percentage is
// derived in this file: the only arithmetic is counting how many steps are done.
// A loop that re-derived the money it is guiding a reader toward would be a
// second answer to the question the page already answers, which is the defect
// #1020 closed one layer up.
import { PROVENANCE_LABELS, recomputeProvenance } from "./finops-declared-rate-contract.js";
import { FLOOR_PUBLISH_BAR, gradedRecoverableFloor } from "./finops-stand.js";

/** Bump when a step, its order, or what "done" means for one of them changes. */
export const READINESS_LOOP_VERSION = "finops-readiness-loop/1.0.0";

/** The one question the top of this loop is held to. */
export const LOOP_QUESTION = "What checks support the recoverable AI spend answer?";

/** The label the declared-rate contract uses for a fully covered card. */
const DECLARED = PROVENANCE_LABELS[2];

/**
 * Per evidence category: who decides whether it is done, and the one action a
 * reader can take to clear it.
 *
 * The `owner` is the whole point. A category listed here without one is decided
 * by the readiness contract, which is the module that raised it; a category with
 * one is decided by the module named, which is the module that can see whether
 * the work has actually landed. Nothing in this file decides either way.
 */
const STEP_OWNERS = Object.freeze({
  usage_cost: Object.freeze({
    owner: "readiness",
    action: "Analyze a provider export so the per-department spend under this figure is yours.",
  }),
  workload_classification: Object.freeze({
    owner: "graded-floor",
    action: "Score more of the analyzed spend against the prompt-literacy rubric, so a graded "
      + "floor can be published beside the modelled ceiling.",
  }),
  applicable_pricing: Object.freeze({
    owner: "declared-rate",
    action: "Declare the contracted input and output rates for the destinations still priced at "
      + "the published list, in the rate form below.",
  }),
  observed_validation: Object.freeze({
    owner: "readiness",
    action: "Re-import the export for a period after the routing change, so the modelled "
      + "reduction can be checked against what was actually billed.",
  }),
});

const percent = (ratio) => (Number.isFinite(ratio) ? `${Math.round(ratio * 100)}%` : null);

/**
 * What the declared-rate module currently says, in one sentence, plus its
 * verdict on whether this step is done. Every word of it comes from that
 * module's own record.
 */
function pricingStep(provenance) {
  const done = provenance?.label === DECLARED;
  const outstanding = provenance?.fallback ?? [];
  return {
    done,
    state: `Pricing provenance is ${provenance?.label ?? "not scored"} · `
      + `${provenance?.ratingLabel ?? "unrated"} (${provenance?.score ?? 0}/100).`,
    blocker: done ? null
      : `${outstanding.length || "Every"} destination model${outstanding.length === 1 ? " is" : "s are"}`
        + " still priced at the published list, so the figure is a ceiling rather than a price.",
    source: "finops-declared-rate-contract.js · recomputeProvenance",
  };
}

/** The same, for the graded floor. The bar quoted is that module's own. */
function floorStep(floor) {
  const done = floor?.publishable === true;
  const covered = percent(floor?.coverage);
  const bar = percent(FLOOR_PUBLISH_BAR);
  return {
    done,
    state: floor?.scored
      ? `The rubric has scored ${covered ?? "an unknown share"} of analyzed spend against a `
        + `${bar} publishing bar.`
      : (floor?.reason ?? "No graded floor has been taken for this analysis."),
    blocker: done ? null
      : `A graded floor is not published below ${bar} coverage, so the only figure on screen is `
        + "the modelled ceiling taken over all analyzed spend.",
    source: "finops-stand.js · gradedRecoverableFloor",
  };
}

/** And for a category the readiness contract decides on its own. */
function readinessStep(category) {
  return {
    done: category.sufficient === true,
    state: category.sufficient
      ? `Held, at evidence reliability ${category.reliability.toFixed(2)}.`
      : category.present
        ? `Held only at evidence reliability ${category.reliability.toFixed(2)}, below the 0.75 `
          + "an organization-specific claim needs."
        : "Not carried by the analyzed dataset at all.",
    blocker: category.sufficient ? null : `Reduces ${category.reduces}; enables ${category.enables}.`,
    source: "finops-analysis-readiness.js · evidenceHeld",
  };
}

/**
 * The ordered loop.
 *
 * @param readiness an `analysisReadinessForDataset` record, or null.
 * @param floor a `gradedRecoverableFloor` record. Passed in when the page has
 *   already taken it — the headline carries it — so the figure this loop reports
 *   on and the figure the page painted can never be two computations.
 * @param analysis the envelope to take the floor from when no record is passed.
 * @param declaration a `parseRateDeclaration` result, or null.
 * @param asOf the analysis date, ISO `YYYY-MM-DD`, never read off a clock.
 * @returns a frozen record. `steps` is always the full ordered set, done and
 *   not-done alike, because a loop that hid its cleared steps would leave a
 *   reader unable to see what the last one bought them.
 */
export function readinessLoop({
  readiness = null, floor = null, analysis = null,
  declaration = null, asOf = null, destinations,
} = {}) {
  const provenance = recomputeProvenance({
    declaration, asOf, ...(destinations ? { destinations } : {}),
  });
  const graded = floor ?? gradedRecoverableFloor(analysis);
  const categories = readiness?.categories ?? [];
  const steps = Object.freeze(categories.map((category, index) => {
    const owner = STEP_OWNERS[category.id] ?? { owner: "readiness", action: null };
    const decided = owner.owner === "declared-rate" ? pricingStep(provenance)
      : owner.owner === "graded-floor" ? floorStep(graded)
        : readinessStep(category);
    return Object.freeze({
      id: category.id,
      ordinal: index + 1,
      label: category.label,
      owner: owner.owner,
      action: owner.action,
      ...decided,
    });
  }));
  const completed = steps.filter((step) => step.done).length;
  const remaining = steps.length - completed;
  const next = steps.find((step) => !step.done) ?? null;
  return Object.freeze({
    version: READINESS_LOOP_VERSION,
    question: LOOP_QUESTION,
    steps,
    total: steps.length,
    completed,
    remaining,
    /** True when there is nothing left to do. The loop stops rather than nagging. */
    settled: steps.length > 0 && remaining === 0,
    next,
    /** The ONE metric the top of the loop shows. Counting, and no other arithmetic. */
    metric: steps.length === 0
      ? "No readiness benchmark has been taken for this analysis yet."
      : `${completed} of ${steps.length} steps done · ${remaining} still open`,
    /** The ONE prioritized next action, or the stop sentence. */
    nextAction: steps.length === 0
      ? "Nothing to guide yet: no analysis has been read."
      : next
        ? `Step ${next.ordinal} of ${steps.length} — ${next.action ?? next.blocker}`
        : "Nothing is outstanding. Every category this page checks is sufficient, the card is "
          + "declared, and the graded floor is published: the claim above is defensible as it "
          + "stands.",
    /** What the loop is currently claiming, for the announcement and the region state. */
    verdict: steps.length === 0 ? "unavailable" : remaining === 0 ? "defensible" : "hedged",
  });
}
