// An ESTIMATED cost-per-successful-task position, from facts a leader already
// knows, before any file is imported (#1102).
//
// THE PROBLEM THIS SOLVES. Everything else on this page that places an
// organization against a cohort needs a task ledger: spend attributed to org
// units, and terminal task outcomes to divide it by. A leader arriving with no
// export in hand has none of that — but they do already know their monthly AI
// bill, roughly how many engineers use it, and roughly how their traffic splits
// across model tiers. This module turns those declared facts into the same
// metric the measured path publishes, and labels it `estimated` so nobody can
// quote it as the measured one.
//
// ---------------------------------------------------------------------------
// THE RULES THIS MODULE ENFORCES
// ---------------------------------------------------------------------------
//
// 1. EVERY WEIGHT IS A NAMED CONSTANT WITH ITS ASSUMPTION BESIDE IT. There is
//    no number in the arithmetic below that a director cannot point at, read
//    the assumption for, and dispute in one place. Changing one of them changes
//    every figure and every pinned fixture, which is the point.
//
// 2. IT CANNOT SAY `verified`. Every figure carries `PROVENANCE`, which has one
//    member. Results are built through `estimatedFigure()` and frozen, the
//    declared facts are read through an allowlist rather than spread, and no
//    caller-supplied key reaches the output. `verified` in this product means an
//    imported dataset whose attributed coverage cleared the floor in
//    `finops-guided-result.js`; nothing on this path can reach that state.
//
// 3. IT DEGRADES INSTEAD OF GUESSING. A missing headcount or a zero bill does
//    not produce a confident-looking number over a substituted input: it drops
//    the tier and withholds the figure. A missing provider mix or an unplaceable
//    cohort does not fail the whole estimate: it drops the tier and withholds
//    only the part that depended on it.
//
// 4. DECLARED FACTS ARE UNTRUSTED INPUT. Numbers are range-checked and clamped;
//    the two cohort attributes are matched against the published enumerations
//    and are otherwise dropped. No declared string is ever returned, so no
//    surface can interpolate one — every word this module emits is authored
//    here or in the published cohort table.
//
// ---------------------------------------------------------------------------
// THE CONFIDENCE TIER LADDER
// ---------------------------------------------------------------------------
//
//   modelled      every declared fact was present, in range, and used as given,
//                 and the org placed uniquely in one published cohort. The
//                 model's assumptions are still assumptions — this is the
//                 ceiling for an estimate, not a measurement.
//   directional   the figure stands, but at least one input was substituted,
//                 clamped, or unusable for the quartile: no declared provider
//                 mix (the default mix was used), a spend or headcount outside
//                 the plausible range (clamped to the boundary), or no unique
//                 cohort (the quartile is withheld). Read the direction, not the
//                 digits.
//   insufficient  no figure at all. Triggered by a missing, zero, negative, or
//                 non-finite monthly spend, or a missing, non-positive, or
//                 non-finite engineer headcount — the numerator and the
//                 denominator of the metric. The quartile and the recoverable
//                 range are withheld with the estimate.
//
// A tier only ever moves DOWN: `demote()` takes the weaker of the two, so no
// later rule can restore confidence an earlier one removed.
//
// No clock, no storage, no request, no DOM, no credential. Pure arithmetic over
// its argument, so the same facts produce the same figures on every run.

import {
  ORG_SIZE_BAND, ORG_SIZE_BAND_LABEL, PEER_COST_SNAPSHOT_ID, PEER_INDUSTRY,
  PEER_INDUSTRY_LABEL,
} from "./peer-cost-cohorts.js";
import {
  bandFor, COST_BAND_DIRECTION, COST_BAND_LABEL, COST_BAND_MEANING, displayCostPerSuccessfulTask,
  matchingCostCohorts,
} from "./peer-cost-position.js";

/** Bump when a constant, a tier, or what one means changes. */
export const DECLARED_FACT_ESTIMATE_VERSION = "finops-declared-fact-estimate/1.0.0";

// ---------------------------------------------------------------------------
// THE VOCABULARY. One member on purpose — see rule 2 above.
// ---------------------------------------------------------------------------

/**
 * The only provenance this module can emit.
 *
 * `supplied` (the reader typed it), `derived` (this page computed it from a
 * file), and `verified` (an import whose coverage cleared the floor) are the
 * other three states this product uses. An estimate from declared facts is none
 * of them: nothing was read out of a file, so there is nothing to verify.
 */
export const PROVENANCE = Object.freeze({ estimated: "estimated" });

/** The words beside the marker, so no surface writes its own. */
export const ESTIMATE_MARKER = Object.freeze({
  provenance: PROVENANCE.estimated,
  label: "Estimated, not measured",
  /** Dashed outline and the warn tone: the silhouettes this page already ships. */
  silhouette: "dashed",
  tone: "warn",
});

export const CONFIDENCE_TIER = Object.freeze({
  modelled: "modelled",
  directional: "directional",
  insufficient: "insufficient",
});

/** Weakest first. `demote()` reads the index, so order is meaning here. */
const TIER_RANK = Object.freeze([
  CONFIDENCE_TIER.insufficient, CONFIDENCE_TIER.directional, CONFIDENCE_TIER.modelled,
]);

export const CONFIDENCE_TIER_LABEL = Object.freeze({
  [CONFIDENCE_TIER.modelled]: "Modelled · every declared fact used as given",
  [CONFIDENCE_TIER.directional]: "Directional · read the direction, not the digits",
  [CONFIDENCE_TIER.insufficient]: "Insufficient · no estimate published",
});

/** Wire values: reword a sentence freely, changing a code is a version bump. */
export const ESTIMATE_NOTE = Object.freeze({
  noSpend: "no_declared_monthly_spend",
  noHeadcount: "no_declared_engineer_headcount",
  defaultMix: "default_provider_mix_substituted",
  clampedSpend: "declared_spend_clamped_to_plausible_range",
  clampedHeadcount: "declared_headcount_clamped_to_plausible_range",
  missingCohortAttributes: "missing_declared_cohort_attributes",
  noMatchingCohort: "no_matching_published_cohort",
  ambiguousCohort: "ambiguous_published_cohort_match",
});

export const ESTIMATE_NOTE_SENTENCE = Object.freeze({
  [ESTIMATE_NOTE.noSpend]:
    "No estimate: no plausible monthly AI spend was declared, and spend is the numerator.",
  [ESTIMATE_NOTE.noHeadcount]:
    "No estimate: no plausible engineer headcount was declared, and headcount is what the "
    + "denominator is built from.",
  [ESTIMATE_NOTE.defaultMix]:
    "No provider mix was declared, so the published default mix was used instead.",
  [ESTIMATE_NOTE.clampedSpend]:
    "The declared monthly spend sits outside the plausible range and was clamped to its boundary.",
  [ESTIMATE_NOTE.clampedHeadcount]:
    "The declared engineer headcount sits outside the plausible range and was clamped to its "
    + "boundary.",
  [ESTIMATE_NOTE.missingCohortAttributes]:
    "No quartile: this organization declared no published size band and industry.",
  [ESTIMATE_NOTE.noMatchingCohort]:
    "No quartile: no published cohort matches the declared size band and industry.",
  [ESTIMATE_NOTE.ambiguousCohort]:
    "No quartile: more than one published cohort matches the declared size band and industry.",
});

// ---------------------------------------------------------------------------
// THE WEIGHTS. Each one is the assumption it encodes, plus where that
// assumption comes from, on the line above it. A director disputing this score
// disputes one of these five.
// ---------------------------------------------------------------------------

/**
 * ASSUMPTION: an engineer with AI tooling starts about 49 terminal AI-assisted
 * tasks in a reporting month (~2.2 per working day over ~22 working days).
 * BASIS: the bundled synthetic ledger in `example-dataset.js` publishes 4,900
 * terminal tasks — 4,000 succeeded, 660 failed, 240 abandoned — for an invented
 * org that declares 100 engineers. Non-terminal (running) tasks are excluded
 * there and are excluded from this rate.
 * WHO DISPUTES IT: a director whose teams batch work into fewer, larger tasks;
 * their attempts-per-engineer is lower and their cost per task is higher than
 * this estimate says.
 */
export const TASKS_ATTEMPTED_PER_ENGINEER_MONTH = 49;

/**
 * ASSUMPTION: the share of attempted tasks that end in success depends on which
 * model tier served them — a frontier model completes more of what it is asked
 * than an economy one, which is what makes a cheap mix not automatically a
 * cheap result.
 * BASIS: the same bundled ledger's observed terminal success share (4,000 of
 * 4,900 ≈ 82%) sits between these three rates at the example's declared mix.
 * These are the model's calibration points, not a measurement of any provider.
 * WHO DISPUTES IT: anyone whose task mix is harder or easier than the ledger's;
 * a lower success rate raises cost per successful task proportionally.
 */
export const PROVIDER_TIER_SUCCESS_RATE = Object.freeze({
  frontier: 0.86,
  standard: 0.78,
  economy: 0.62,
});

/**
 * ASSUMPTION: an organization that has not declared its provider mix looks like
 * a half-standard, roughly-third-frontier, small-economy split.
 * BASIS: the published tier vocabulary above, weighted to the middle of it
 * rather than to either extreme, so a substituted mix cannot flatter or punish
 * an undeclared organization. Shares sum to 1 and are checked at load.
 * WHO DISPUTES IT: a frontier-only shop — which is why substituting this mix
 * caps the result at `directional` rather than leaving it `modelled`.
 */
export const DEFAULT_PROVIDER_MIX = Object.freeze({
  frontier: 0.34, standard: 0.5, economy: 0.16,
});

/**
 * ASSUMPTION: of the spend sitting above the cohort's cheap boundary, between
 * a quarter and three fifths is actually recoverable inside one reporting
 * period; the rest is work that genuinely needs the tier it is on.
 * BASIS: the routing scenario the measured path publishes for the bundled
 * example recovers $51,254 of $154,500 — near the top of this band at that
 * org's headroom — and the low end is the share left if only the clearly
 * over-tiered traffic moves. It is a MODELLED band, never a realized saving.
 * WHO DISPUTES IT: a finance lead who has already routed the easy traffic;
 * their remaining recoverable share is below the low end of this band.
 */
export const RECOVERABLE_SHARE_BAND = Object.freeze({ low: 0.25, high: 0.6 });

/**
 * ASSUMPTION: the quartile boundaries an estimate is placed against are the
 * SAME published boundaries the measured path uses, so an estimate and a later
 * import cannot be graded on two different ramps.
 * BASIS: `PEER_COST_COHORTS` in `peer-cost-cohorts.js` — a checked-in literal
 * table of p25/p75 pairs per size band and industry, fixed at publication,
 * identical for every visitor, and reached only from module scope. This module
 * takes no cohort argument and performs no fetch.
 * WHO DISPUTES IT: anyone who thinks the cohort is wrong for them — which is an
 * argument with that table, in one place, and not with this arithmetic.
 */
export const COHORT_BOUNDARY_SOURCE = Object.freeze({
  module: "peer-cost-cohorts.js",
  snapshotId: PEER_COST_SNAPSHOT_ID,
});

/**
 * The ranges outside which a declared number is treated as a typo rather than a
 * fact: a $12 monthly bill and a 400,000-engineer org are both far more likely
 * to be a mis-keyed field than a real declaration. Out-of-range values are
 * clamped to the boundary and drop the tier; they are never silently used.
 */
export const PLAUSIBLE_MONTHLY_SPEND_USD = Object.freeze({ min: 100, max: 5_000_000 });
export const PLAUSIBLE_ENGINEER_HEADCOUNT = Object.freeze({ min: 1, max: 50_000 });

/** How far a declared mix's shares may sum from 1 before the default replaces it. */
export const PROVIDER_MIX_TOLERANCE = 0.02;

// ---------------------------------------------------------------------------
// Reading the declared facts. Allowlist, never a spread.
// ---------------------------------------------------------------------------

const clamp = (value, { min, max }) => Math.min(Math.max(value, min), max);

const demote = (tier, floor) =>
  (TIER_RANK.indexOf(floor) < TIER_RANK.indexOf(tier) ? floor : tier);

/** A published enumeration member, or null. Anything else is dropped, unread. */
const published = (value, enumeration) =>
  (typeof value === "string" && Object.values(enumeration).includes(value) ? value : null);

/**
 * The declared mix, normalized, or null when there is nothing usable to read.
 *
 * A mix whose shares do not sum to 1 within tolerance is refused rather than
 * renormalized: a reader who typed 0.5/0.5/0.5 meant something this module
 * cannot recover, and scaling it to sum to 1 would invent an answer.
 */
function readProviderMix(mix) {
  if (!mix || typeof mix !== "object") return null;
  const tiers = Object.keys(PROVIDER_TIER_SUCCESS_RATE);
  const read = {};
  let total = 0;
  for (const tier of tiers) {
    const share = mix[tier];
    if (share === undefined || share === null) continue;
    if (!Number.isFinite(share) || share < 0 || share > 1) return null;
    read[tier] = share;
    total += share;
  }
  if (Object.keys(read).length === 0) return null;
  if (Math.abs(total - 1) > PROVIDER_MIX_TOLERANCE) return null;
  return Object.freeze(Object.fromEntries(tiers.map((tier) => [tier, read[tier] ?? 0])));
}

/** The mix-weighted success rate: the one place the mix enters the arithmetic. */
export function mixSuccessRate(mix) {
  return Object.entries(PROVIDER_TIER_SUCCESS_RATE)
    .reduce((rate, [tier, tierRate]) => rate + (mix[tier] ?? 0) * tierRate, 0);
}

// ---------------------------------------------------------------------------
// The figures. Everything a caller receives is built here, so there is exactly
// one place a provenance value is assigned.
// ---------------------------------------------------------------------------

const estimatedFigure = (fields) =>
  Object.freeze({ ...fields, provenance: PROVENANCE.estimated });

const withheld = (note) => Object.freeze({
  available: false,
  note,
  reason: ESTIMATE_NOTE_SENTENCE[note] ?? null,
  provenance: PROVENANCE.estimated,
});

/**
 * Estimate a cost-per-successful-task position from declared facts.
 *
 * @param {{monthlySpendUsd?: number, engineers?: number,
 *          providerMix?: {frontier?: number, standard?: number, economy?: number},
 *          sizeBand?: string, industry?: string}} facts declared, untrusted.
 * @returns a frozen result. Never throws, never returns null, never `verified`.
 */
export function estimateFromDeclaredFacts(facts = {}) {
  const source = facts && typeof facts === "object" ? facts : {};
  const notes = [];
  let tier = CONFIDENCE_TIER.modelled;

  // The numerator and the denominator's seed. Either one missing is the whole
  // estimate missing — there is no defensible substitute for a company's own
  // bill or its own headcount.
  const declaredSpend = source.monthlySpendUsd;
  const declaredEngineers = source.engineers;
  const spendUsable = Number.isFinite(declaredSpend) && declaredSpend > 0;
  const engineersUsable = Number.isFinite(declaredEngineers) && declaredEngineers > 0;
  if (!spendUsable) notes.push(ESTIMATE_NOTE.noSpend);
  if (!engineersUsable) notes.push(ESTIMATE_NOTE.noHeadcount);

  const declaredMix = readProviderMix(source.providerMix);
  if (!declaredMix) notes.push(ESTIMATE_NOTE.defaultMix);
  const mix = declaredMix ?? DEFAULT_PROVIDER_MIX;
  if (!declaredMix) tier = demote(tier, CONFIDENCE_TIER.directional);

  const sizeBand = published(source.sizeBand, ORG_SIZE_BAND);
  const industry = published(source.industry, PEER_INDUSTRY);

  if (!spendUsable || !engineersUsable) {
    return Object.freeze({
      version: DECLARED_FACT_ESTIMATE_VERSION,
      provenance: PROVENANCE.estimated,
      confidence: Object.freeze({
        tier: CONFIDENCE_TIER.insufficient,
        label: CONFIDENCE_TIER_LABEL[CONFIDENCE_TIER.insufficient],
      }),
      notes: Object.freeze(notes),
      inputs: Object.freeze({
        monthlySpendUsd: null, engineers: null, providerMix: null, sizeBand, industry,
      }),
      costPerSuccessfulTask: withheld(
        spendUsable ? ESTIMATE_NOTE.noHeadcount : ESTIMATE_NOTE.noSpend),
      quartile: withheld(
        spendUsable ? ESTIMATE_NOTE.noHeadcount : ESTIMATE_NOTE.noSpend),
      recoverableMonthlyUsd: withheld(
        spendUsable ? ESTIMATE_NOTE.noHeadcount : ESTIMATE_NOTE.noSpend),
      workings: Object.freeze([]),
    });
  }

  const spendUsd = clamp(declaredSpend, PLAUSIBLE_MONTHLY_SPEND_USD);
  if (spendUsd !== declaredSpend) {
    notes.push(ESTIMATE_NOTE.clampedSpend);
    tier = demote(tier, CONFIDENCE_TIER.directional);
  }
  const engineers = Math.round(clamp(declaredEngineers, PLAUSIBLE_ENGINEER_HEADCOUNT));
  if (engineers !== declaredEngineers) {
    notes.push(ESTIMATE_NOTE.clampedHeadcount);
    tier = demote(tier, CONFIDENCE_TIER.directional);
  }

  // THE ARITHMETIC, in the order the disclosure prints it.
  const successRate = mixSuccessRate(mix);
  const attempted = engineers * TASKS_ATTEMPTED_PER_ENGINEER_MONTH;
  // Tasks are countable, so the denominator is rounded to whole tasks once,
  // here, and every figure below divides by the same integer a reader can
  // reproduce with a calculator.
  const successfulTasks = Math.round(attempted * successRate);
  const costPerTask = spendUsd / successfulTasks;

  const cohorts = sizeBand && industry ? matchingCostCohorts(sizeBand, industry) : [];
  let cohortNote = null;
  if (!sizeBand || !industry) cohortNote = ESTIMATE_NOTE.missingCohortAttributes;
  else if (cohorts.length === 0) cohortNote = ESTIMATE_NOTE.noMatchingCohort;
  else if (cohorts.length > 1) cohortNote = ESTIMATE_NOTE.ambiguousCohort;
  const cohort = cohortNote ? null : cohorts[0];
  if (cohortNote) {
    notes.push(cohortNote);
    tier = demote(tier, CONFIDENCE_TIER.directional);
  }

  const band = cohort ? bandFor(costPerTask, cohort) : null;
  // The recoverable range is headroom to the cohort's CHEAP boundary, banded.
  // With no cohort there is no boundary, so there is no range — an estimate
  // with no reference point is a guess, and this module does not publish one.
  const headroomUsd = cohort ? Math.max(spendUsd - cohort.p25 * successfulTasks, 0) : null;

  return Object.freeze({
    version: DECLARED_FACT_ESTIMATE_VERSION,
    provenance: PROVENANCE.estimated,
    confidence: Object.freeze({ tier, label: CONFIDENCE_TIER_LABEL[tier] }),
    notes: Object.freeze(notes),
    inputs: Object.freeze({
      monthlySpendUsd: spendUsd,
      engineers,
      providerMix: mix,
      providerMixDeclared: Boolean(declaredMix),
      sizeBand,
      industry,
    }),
    costPerSuccessfulTask: estimatedFigure({
      available: true,
      value: costPerTask,
      display: displayCostPerSuccessfulTask(costPerTask),
      successfulTasks,
      unit: "USD per successful task",
    }),
    quartile: cohort
      ? estimatedFigure({
        available: true,
        band,
        label: COST_BAND_LABEL[band],
        meaning: COST_BAND_MEANING[band],
        direction: COST_BAND_DIRECTION,
        cohortId: cohort.cohortId,
        cohortLabel: cohort.label,
        p25: cohort.p25,
        p75: cohort.p75,
        snapshotId: cohort.snapshotId,
      })
      : withheld(cohortNote),
    recoverableMonthlyUsd: cohort
      ? estimatedFigure({
        available: true,
        low: Math.round(headroomUsd * RECOVERABLE_SHARE_BAND.low),
        high: Math.round(headroomUsd * RECOVERABLE_SHARE_BAND.high),
        headroomUsd: Math.round(headroomUsd),
        unit: "USD per month, modelled",
      })
      : withheld(cohortNote),
    workings: Object.freeze(workingsFor({
      spendUsd, engineers, mix, successRate, attempted, successfulTasks, costPerTask, cohort,
      headroomUsd,
    })),
  });
}

const money = (value) => `$${Math.round(value).toLocaleString("en-US")}`;

/**
 * The workings' own money format, exported so a surface that prints one of the
 * figures above prints the same dollars this module's sentences do rather than
 * rounding it a second way.
 */
export const estimateMoney = (value) => money(value);
const share = (value) => `${Math.round(value * 100)}%`;
// The blended rate is printed to a tenth of a percent, because a reader redoing
// `attempted × rate` with a whole percent lands on a different task count than
// the one above it — a rounding that makes the working un-reconstructable.
const blendedShare = (value) => `${(value * 100).toFixed(1)}%`;

/**
 * The arithmetic as sentences a reader can redo by hand, in the order it ran.
 *
 * Every value here is a number this module computed or a label from the
 * published cohort table. No declared string is quoted, so nothing a reader
 * typed can reach a surface through this array.
 */
function workingsFor({
  spendUsd, engineers, mix, successRate, attempted, successfulTasks, costPerTask, cohort,
  headroomUsd,
}) {
  const mixWords = Object.keys(PROVIDER_TIER_SUCCESS_RATE)
    .map((tier) => `${tier} ${share(mix[tier] ?? 0)}`).join(" · ");
  const lines = [
    Object.freeze({
      term: "Inputs used",
      detail: `${money(spendUsd)} declared monthly AI spend · ${engineers.toLocaleString("en-US")}`
        + ` declared engineers · provider mix ${mixWords}`
        + `${cohort ? ` · cohort ${cohort.label}` : ""}.`,
    }),
    // The arithmetic is written in words rather than in operators: the
    // multiplication sign is a policed glyph on this page (it means "removed"
    // in the workspace rails), and a mark that means one thing in a rail and
    // another in a sum is a mark a reader has to disambiguate.
    Object.freeze({
      term: "Tasks attempted",
      detail: `${engineers.toLocaleString("en-US")} engineers at`
        + ` ${TASKS_ATTEMPTED_PER_ENGINEER_MONTH} attempted tasks each per month =`
        + ` ${attempted.toLocaleString("en-US")} attempted tasks.`,
    }),
    Object.freeze({
      term: "Tasks that succeed",
      detail: `The declared mix weights the published tier success rates`
        + ` (frontier ${share(PROVIDER_TIER_SUCCESS_RATE.frontier)},`
        + ` standard ${share(PROVIDER_TIER_SUCCESS_RATE.standard)},`
        + ` economy ${share(PROVIDER_TIER_SUCCESS_RATE.economy)}) to`
        + ` ${blendedShare(successRate)}.`
        + ` ${attempted.toLocaleString("en-US")} attempted at ${blendedShare(successRate)} =`
        + ` ${successfulTasks.toLocaleString("en-US")} successful tasks, rounded once to whole`
        + ` tasks.`,
    }),
    Object.freeze({
      term: "Cost per successful task",
      detail: `${money(spendUsd)} ÷ ${successfulTasks.toLocaleString("en-US")} successful tasks =`
        + ` ${displayCostPerSuccessfulTask(costPerTask)}.`,
    }),
  ];
  if (!cohort) return lines;
  return [...lines, Object.freeze({
    term: "Cohort basis",
    detail: `Published cohort ${cohort.cohortId} (${cohort.label}), snapshot`
      + ` ${cohort.snapshotId}: p25 ${displayCostPerSuccessfulTask(cohort.p25)},`
      + ` p75 ${displayCostPerSuccessfulTask(cohort.p75)}. ${COST_BAND_DIRECTION}`,
  }), Object.freeze({
    term: "Recoverable range",
    detail: `Headroom to the cohort's cheap boundary is ${money(spendUsd)} less the`
      + ` ${displayCostPerSuccessfulTask(cohort.p25)} p25 rate over`
      + ` ${successfulTasks.toLocaleString("en-US")} successful tasks`
      + ` = ${money(headroomUsd)}. At ${share(RECOVERABLE_SHARE_BAND.low)}–`
      + `${share(RECOVERABLE_SHARE_BAND.high)} of that headroom:`
      + ` ${money(headroomUsd * RECOVERABLE_SHARE_BAND.low)}–`
      + `${money(headroomUsd * RECOVERABLE_SHARE_BAND.high)} a month, modelled.`,
  })];
}

// ---------------------------------------------------------------------------
// The two lines a surface renders. Built here so the region and its tests
// cannot hold two versions of the same sentence.
// ---------------------------------------------------------------------------

/** The value line: what the estimate says, with the word "Estimated" first. */
export function estimateHeadline(estimate) {
  const cost = estimate?.costPerSuccessfulTask;
  if (!cost?.available) {
    return `Estimated · unavailable · ${estimate?.notes?.length
      ? ESTIMATE_NOTE_SENTENCE[estimate.notes[0]] : "no declared facts to estimate from."}`;
  }
  const quartile = estimate.quartile?.available ? ` · ${estimate.quartile.label}` : "";
  return `Estimated · ${cost.display} per successful task${quartile}`;
}

/** The detail line: the tier, the range, and what the figure is not. */
export function estimateDetail(estimate) {
  const parts = [];
  const recoverable = estimate?.recoverableMonthlyUsd;
  if (recoverable?.available) {
    parts.push(`Modelled recoverable range ${money(recoverable.low)}–${money(recoverable.high)}`
      + " a month");
  }
  if (estimate?.quartile?.available) {
    parts.push(`against ${estimate.quartile.cohortLabel} (${estimate.quartile.meaning})`);
  } else if (estimate?.quartile?.reason) {
    parts.push(estimate.quartile.reason);
  }
  const tier = estimate?.confidence?.label ?? CONFIDENCE_TIER_LABEL[CONFIDENCE_TIER.insufficient];
  // One full stop between clauses: a withheld reason already ends in one, and a
  // sentence reading "…numerator.. Insufficient" reads as a typo in the figure.
  const lead = parts.join(" ").replace(/\.$/, "");
  return `${lead}${lead ? ". " : ""}${tier}. `
    + "Estimated from declared facts and published assumptions — not measured from your usage, "
    + "not verified against an invoice, and not a realized saving.";
}

/** The labels for the two declared cohort attributes, from the published table. */
export const declaredCohortWords = (estimate) => Object.freeze({
  sizeBand: estimate?.inputs?.sizeBand ? ORG_SIZE_BAND_LABEL[estimate.inputs.sizeBand] : null,
  industry: estimate?.inputs?.industry ? PEER_INDUSTRY_LABEL[estimate.inputs.industry] : null,
});
