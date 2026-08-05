// The five facts a visitor declares with no file in hand, and the three
// sentences they get back (#1103).
//
// WHAT THIS MODULE DOES NOT DO. It does not estimate anything. Every figure the
// intake renders comes out of `finops-declared-fact-estimate.js`: this module
// maps five control values into that estimator's documented input shape and
// turns the result it hands back into sentences. There is no coefficient, no
// quartile boundary, and no arithmetic here — a weight that moves there moves
// here with it, and the two can never publish different numbers for one org.
//
// DECLARED VALUES ARE UNTRUSTED. A control value is a string somebody handed
// us: a visitor, a browser that ignored the option list, or a test harness whose
// select accepts anything. The three enumerated facts are matched against the
// published enumerations and DROPPED when they do not appear in one; the two
// numbers are read with `Number()` and dropped unless finite. A dropped fact is
// never substituted silently — the estimator degrades its own confidence tier
// and withholds what depended on it, which is what the reader is then told.
//
// NO DECLARED STRING IS EVER RETURNED. Everything below is a sentence authored
// here or a figure the estimator computed, so nothing a visitor types can reach
// the page through this module even if a surface were careless with it.
//
// Nothing leaves the browser: no fetch, no storage, no cookie, no clock. The
// same five answers produce the same three sentences on every run.

import {
  DEFAULT_PROVIDER_MIX, estimateMoney,
} from "./finops-declared-fact-estimate.js";
import { EXAMPLE_DECLARED_FACTS } from "./finops-declared-fact-fixtures.js";
import { HEADCOUNT_SOURCE } from "./hris-headcount-roster.js";
import {
  ORG_SIZE_BAND, ORG_SIZE_BAND_LABEL, PEER_INDUSTRY, PEER_INDUSTRY_LABEL,
} from "./peer-cost-cohorts.js";
import { COST_BAND, COST_BAND_DIRECTION } from "./peer-cost-position.js";

/** The ids the intake owns. Nothing else writes them. */
export const INTAKE_IDS = Object.freeze({
  form: "finops-intake",
  legend: "finops-intake-legend",
  spend: "finops-intake-spend",
  mix: "finops-intake-mix",
  engineers: "finops-intake-engineers",
  size: "finops-intake-size",
  industry: "finops-intake-industry",
  roster: "finops-intake-roster",
  rosterExpectation: "finops-intake-roster-expectation",
  rosterRefused: "finops-intake-roster-refused",
  rosterStatus: "finops-intake-roster-status",
  submit: "finops-intake-submit",
  clear: "finops-intake-clear",
  answer: "finops-intake-answer",
  headline: "finops-intake-headline",
  recoverable: "finops-intake-recoverable",
  action: "finops-intake-action",
  live: "finops-intake-live",
});

/** The words on the group, authored once and asserted against the markup. */
export const INTAKE_LEGEND = "Estimate from five facts you already know";

const percent = (share) => `${Math.round(share * 100)}%`;

/**
 * One offered provider mix.
 *
 * The shares ARE the declared fact — they are an input to the estimator, not a
 * weight it applies — so naming three blends here duplicates no arithmetic. The
 * label is composed from the shares rather than typed beside them, because a
 * label that disagrees with the mix it names is the one defect a reader cannot
 * see.
 */
const mixChoice = (value, name, mix) => Object.freeze({
  value,
  name,
  mix: Object.freeze({ ...mix }),
  label: `${name} · frontier ${percent(mix.frontier)} · standard ${percent(mix.standard)}`
    + ` · economy ${percent(mix.economy)}`,
});

/**
 * Three blends, weakest assumption last.
 *
 * The first is the bundled example's own declared mix, so the state a visitor
 * lands on and the state the clear control restores are the same five answers
 * the region was already estimating from. The middle one is the estimator's
 * published default, imported rather than retyped.
 */
export const MIX_CHOICES = Object.freeze([
  mixChoice("frontier_led", "Mostly frontier models", EXAMPLE_DECLARED_FACTS.providerMix),
  mixChoice("balanced", "Balanced across tiers", DEFAULT_PROVIDER_MIX),
  mixChoice("economy_led", "Mostly economy models",
    { frontier: 0.1, standard: 0.35, economy: 0.55 }),
]);

/** The two cohort attributes, offered with the published table's own labels. */
export const SIZE_CHOICES = Object.freeze(Object.values(ORG_SIZE_BAND)
  .map((value) => Object.freeze({ value, label: ORG_SIZE_BAND_LABEL[value] })));
export const INDUSTRY_CHOICES = Object.freeze(Object.values(PEER_INDUSTRY)
  .map((value) => Object.freeze({ value, label: PEER_INDUSTRY_LABEL[value] })));

/** The offered mix whose shares are these, or null. Used to fill the control. */
export const mixChoiceFor = (mix) => MIX_CHOICES.find((choice) => mix
  && Object.keys(choice.mix).every((tier) => choice.mix[tier] === mix[tier]))?.value ?? null;

const publishedIn = (value, choices) =>
  (choices.some((choice) => choice.value === value) ? value : undefined);

/** A finite number, or undefined. An empty field is a missing fact, not a zero. */
const declaredNumber = (raw) => {
  if (raw === null || raw === undefined || String(raw).trim() === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
};

/**
 * Five control values in, the estimator's documented input shape out.
 *
 * Every unpublished value becomes `undefined` HERE rather than at the estimator,
 * so a control that accepted something outside its own option list cannot put an
 * unread string in front of the arithmetic. The estimator's own range clamping
 * is left to the estimator: this reads facts, it does not judge them.
 */
export function readDeclaredFacts(values = {}) {
  const choice = MIX_CHOICES.find((option) => option.value === values.mixChoice);
  return {
    monthlySpendUsd: declaredNumber(values.monthlySpendUsd),
    engineers: declaredNumber(values.engineers),
    providerMix: choice ? choice.mix : undefined,
    sizeBand: publishedIn(values.sizeBand, SIZE_CHOICES),
    industry: publishedIn(values.industry, INDUSTRY_CHOICES),
  };
}

/**
 * WHICH FACTS THE REGION IS CURRENTLY ESTIMATING FROM.
 *
 * The estimate block has two writers — the region's own repaint, which runs
 * whenever the bundled example is (re)loaded, and this intake — and a repaint
 * that reverted to the example while the answer spine still showed a visitor's
 * five facts would put two estimates for two different companies on one screen.
 * One value, read by both, is what makes that impossible. It holds declared
 * facts only: no file, no import, nothing measured, and nothing persisted.
 */
let declared = EXAMPLE_DECLARED_FACTS;

export const currentDeclaredFacts = () => declared;

/**
 * WHERE THE HEADCOUNT CAME FROM (#1105).
 *
 * `estimated` while the headcount is a number somebody typed, `supplied` once it
 * was counted out of a roster the reader chose in this tab. Never `verified`:
 * accepting a file is not authenticating one, and the roster contract says so in
 * the same words. It is a second value beside the facts rather than a field on
 * them because the estimator's own provenance is its to assign, and the estimate
 * as a whole is still modelled — only the denominator stopped being a guess.
 */
let headcountSource = HEADCOUNT_SOURCE.estimated;

export const currentHeadcountSource = () => headcountSource;

/** Adopt a headcount source. Anything but the two published words is refused. */
export function setHeadcountSource(source) {
  headcountSource = source === HEADCOUNT_SOURCE.supplied
    ? HEADCOUNT_SOURCE.supplied : HEADCOUNT_SOURCE.estimated;
  return headcountSource;
}

/** What the status line says before any file has been chosen. */
export const ROSTER_UNCHOSEN = "No roster chosen. The headcount above is the one you typed.";

/** Adopt a set of declared facts, or fall back to the bundled example's. */
export function setDeclaredFacts(facts) {
  declared = facts && typeof facts === "object" ? facts : EXAMPLE_DECLARED_FACTS;
  return declared;
}

/**
 * The one action each position implies, weakest position first.
 *
 * Exactly one is ever rendered. The two above the bands are not advice about
 * spend at all — an estimate missing its numerator or its cohort has no
 * defensible next move except supplying what is missing, and saying so is more
 * use than ranking a figure that is not there.
 */
export const NEXT_ACTION = Object.freeze({
  noFigure: "Next: declare a monthly AI bill and an engineer headcount. Without both there is"
    + " nothing to divide, so this estimate has no figure to act on.",
  noCohort: "Next: declare a company size and an industry, so this estimate can be placed"
    + " against a published cohort instead of standing on its own.",
  [COST_BAND.bottom]: "Next: move one month of standard-tier traffic that does not need the"
    + " tier to a cheaper one, then check the invoice against this estimate before booking"
    + " anything.",
  [COST_BAND.middle]: "Next: find the one team with the highest spend per successful task and"
    + " review its routing before any budget moves.",
  [COST_BAND.top]: "Next: hold the routing you have and re-check this estimate against a real"
    + " provider export before anyone treats the position as proven.",
});

/**
 * The headline: the figure, its quartile, and which way is better, in one
 * sentence a leader can repeat.
 *
 * It opens on the word "Estimated" in every state, including both states where
 * there is no figure, because the sentence has to survive being quoted without
 * the marker beside it.
 */
export function intakeHeadline(estimate) {
  const cost = estimate?.costPerSuccessfulTask;
  if (!cost?.available) {
    return `Estimated: no position yet. ${cost?.reason ?? "No declared facts to estimate from."}`;
  }
  const quartile = estimate.quartile;
  if (!quartile?.available) {
    return `Estimated: we spend ${cost.display} per successful AI task, against no published`
      + ` cohort. ${quartile?.reason ?? ""}`.trimEnd();
  }
  return `Estimated: we spend ${cost.display} per successful AI task — ${quartile.label},`
    + ` the ${quartile.meaning}. ${COST_BAND_DIRECTION}`;
}

/** The modelled recoverable amount, and what it is not. */
export function intakeRecoverable(estimate) {
  const recoverable = estimate?.recoverableMonthlyUsd;
  if (!recoverable?.available) {
    return `Estimated recoverable: none published. ${recoverable?.reason ?? ""}`.trimEnd();
  }
  return `Estimated recoverable: ${estimateMoney(recoverable.low)} to`
    + ` ${estimateMoney(recoverable.high)} a month, modelled from these five declared facts —`
    + " not a measured, invoiced, or realized saving.";
}

/** Exactly one next action, chosen by the estimator's own verdict. */
export function intakeNextAction(estimate) {
  if (!estimate?.costPerSuccessfulTask?.available) return NEXT_ACTION.noFigure;
  if (!estimate?.quartile?.available) return NEXT_ACTION.noCohort;
  return NEXT_ACTION[estimate.quartile.band] ?? NEXT_ACTION.noCohort;
}

/**
 * THIS ESTIMATE AS A PERIOD ENTRY, so a later real import can be scored against
 * it (#1106).
 *
 * The month is the one the reader declared IN — `capturedAt` is a period-shaped
 * string the caller supplies and the series parses the month off, so no clock is
 * read on either side of this call. The spend is the reader's own declared
 * monthly figure as the estimator clamped and accepted it, never the raw control
 * value, and the recoverable figure is the LOW end of the modelled band: an
 * entry that is going to be compared against a bill states the conservative end
 * of a range rather than its best case.
 *
 * Null when the estimator withheld a figure. An estimate that could not be made
 * is not a period, and writing one would put a zero on the record.
 */
export function estimatedPeriodFacts(estimate, capturedAt) {
  const spendUsd = estimate?.inputs?.monthlySpendUsd;
  if (!estimate?.costPerSuccessfulTask?.available || !Number.isFinite(spendUsd)) return null;
  const recoverable = estimate?.recoverableMonthlyUsd;
  return {
    period: capturedAt,
    capturedAt,
    spendUsd,
    recoverableUsd: recoverable?.available ? recoverable.low : 0,
    confidence: estimate?.confidence?.label ?? null,
  };
}
