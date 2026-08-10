// "Is that recoverable figure big because the waste is big, or because the lead
// declared flattering prices?" — one sub-score, from banded metadata (#1266).
//
// THE DEFECT THIS CLOSES. Since #1263 a FinOps lead may declare their own rate
// card, and since #1274 the recoverable headline, the ranked actions and the
// commitments are all repriced against it. Every one of those numbers therefore
// moves with a figure the reader typed. An evaluator looking at the recoverable
// headline cannot tell a contracted price from a hopeful one, and the existing
// surfaces do not help: the #1262 ladder grades WHICH INPUTS ARE DECLARED and #1186 grades the
// SHARE OF SPEND SCORED. Neither grades where the prices came from.
//
// ---------------------------------------------------------------------------
// THE ONE PROPERTY THIS MODULE EXISTS TO HAVE
// ---------------------------------------------------------------------------
//
// NO DECLARED RATE, DISCOUNT PERCENTAGE OR DOLLAR FIGURE MAY MOVE THIS SCORE.
// Every criterion below reads metadata only — where the prices came from, how
// many required fields are filled in, how old the card is, how much of the
// analysis it covers. Multiply every rate on a card by a thousand and this
// sub-score, all four band labels and all four reason strings are byte-identical.
// tests/finops-pricing-provenance.test.js asserts exactly that, and it is the
// assertion the whole file is arranged around: a lead cannot flatter the grade by
// declaring favourable prices, because the grade never reads the prices.
//
// Two consequences that look like omissions and are not:
//
//   * WELL-FORMED MEANS PRESENT AND OF THE RIGHT TYPE — not within the range
//     RATE_CARD_FIELDS publishes. A range test is a test of the magnitude, and no
//     magnitude may move this score. A rate outside the contract's range is a
//     PRICING problem, refused by `validateRateCard` where the money is computed;
//     it is not a provenance problem.
//   * `validateRateCard()` IS NOT CONSULTED for banding, for the same reason: its
//     verdict turns on those ranges. This module reads the card's SHAPE.
//
// ---------------------------------------------------------------------------
// THE SCALE, and how it sits beside the rubric that already exists
// ---------------------------------------------------------------------------
//
// The sub-score is 0–100, the same points scale `scoreFinopsFixture` totals its
// five weighted dimensions on, and it is also reported as a 0–4 rating in
// FINOPS_RUBRIC's own scale words so the two read alike beside each other.
//
// IT IS NOT AVERAGED INTO THE RECOMMENDATION SCORE, deliberately. Folding it in
// would let a strong recommendation launder a self-declared price into one
// number nobody can take apart, and it would silently restate every score this
// repository has ever published. So provenance is reported BESIDE the money, on
// its own axis, and the pre-existing dimensions and grade bands are untouched —
// pinned as constants in the no-regression test so a future edit fails loudly.
//
// UNTRUSTED INPUT. A rate card can carry reader-typed text: the citation beside a
// contracted card, and destination identifiers that came out of a provider
// export. The ONLY declaration text this module ever renders is the citation and
// the identifiers of destinations the card does not cover, and both pass through
// the rubric's own `sanitizeFinopsRecommendation` and a hard length cap first. No
// other free text reaches a reason string, a judge prompt or the DOM.
//
// PURE. No clock, no I/O, no DOM, no randomness. `asOf` is passed in — a caller
// that supplies none gets the age criterion's `undated` band and a reason saying
// so, not a different answer on a different day.

import { loadExampleDataset } from "./example-dataset.js";
import { FINOPS_RUBRIC, sanitizeFinopsRecommendation } from "./finops-evaluation.js";
import { DEFAULT_REFERENCE_CARD, RATE_CARD_FIELDS, isCalendarDate } from "./finops-rate-card-contract.js";

/** Bump when a weight, a band boundary, or what a band means changes. Copy may be reworded. */
export const PRICING_PROVENANCE_VERSION = "finops-pricing-provenance/1.0.0";

/**
 * The destinations this page's analysis actually prices, read off the reference
 * card because #1263 made that the one place a destination is written down. A
 * caller analyzing something else passes its own list.
 */
export const PRICED_DESTINATIONS = Object.freeze(
  DEFAULT_REFERENCE_CARD.models.map((model) => model.model));

/** The longest a rendered reason may be. It sits beside money, not in an essay. */
export const PROVENANCE_REASON_MAX_CHARS = 160;

/** The longest reader-supplied fragment any reason may carry, after sanitizing. */
const QUOTED_TEXT_MAX_CHARS = 48;

/**
 * The 0–4 rating words. They are FINOPS_RUBRIC's own scale anchors, first word
 * each, so a provenance band and a rubric dimension are read in one vocabulary.
 */
export const PROVENANCE_RATING_LABEL = Object.freeze({
  0: "Absent", 1: "Weak", 2: "Partial", 3: "Adequate", 4: "Strong",
});

/**
 * Sub-score floors for each rating, best first, each set against a case rather
 * than by taste. ASSUMPTION: 85 sits above 73.0, which is what a card that is
 * complete, current and fully covering scores from an UNCITED contract, so Strong
 * is reachable only with a citable source. ASSUMPTION: 70 sits above 66.8, which
 * is what the published-list reference card scores, so "we priced at list" reads
 * as Partial and never as Adequate. 45 and 20 divide what is left: half the
 * destinations covered with half the fields filled in lands in Weak.
 */
export const RATING_FLOORS = Object.freeze([
  Object.freeze({ rating: 4, floor: 85 }),
  Object.freeze({ rating: 3, floor: 70 }),
  Object.freeze({ rating: 2, floor: 45 }),
  Object.freeze({ rating: 1, floor: 20 }),
  Object.freeze({ rating: 0, floor: 0 }),
]);

// ---------------------------------------------------------------------------
// Staleness, in months, with the cut points stated.
// ---------------------------------------------------------------------------

/**
 * ASSUMPTION: provider list prices and negotiated commitments are renegotiated on
 * roughly annual cycles, so a card inside 6 months has not crossed a renewal and
 * is current; one inside 12 months has crossed at most one price review and is
 * merely aging. 12 months is the staleness cut because past one full cycle the
 * card is, more likely than not, describing a contract that has been replaced.
 */
export const CURRENT_AGE_MONTHS = 6;
export const STALENESS_AGE_MONTHS = 12;

/**
 * ASSUMPTION: past two renewal cycles a declaration is not evidence about today's
 * prices at all, so it scores as if undated rather than as a weak dated card.
 */
export const EXPIRED_AGE_MONTHS = 24;

// ---------------------------------------------------------------------------
// The four criteria. Weights sum to 1 and each states what a director disputing
// this sub-score would have to argue with.
// ---------------------------------------------------------------------------

const SOURCE_BANDS = Object.freeze([
  // ASSUMPTION: a contract a reader can name is the only input here that a third
  // party could go and check, so it is the only one that scores full marks.
  Object.freeze({ band: "contracted-cited", label: "Contracted, cited", points: 1 }),
  // ASSUMPTION: a published list price is checkable by anyone but is not YOUR
  // price, so it supports a ceiling and not a saving — high, and short of full.
  Object.freeze({ band: "reference-published", label: "Published list", points: 0.75 }),
  // ASSUMPTION: a contracted rate with no source named is a claim, not evidence;
  // it still beats an unmarked card because it at least states what it claims.
  Object.freeze({ band: "contracted-uncited", label: "Contracted, uncited", points: 0.4 }),
  // ASSUMPTION: a figure blended from two provenances is only as checkable as its
  // weaker half, and nothing on the page says which destination came from which.
  Object.freeze({ band: "mixed-source", label: "Mixed sources", points: 0.25 }),
  // ASSUMPTION: rates typed with no source at all are the case this whole
  // sub-score exists to expose, so they score barely above having no card.
  Object.freeze({ band: "self-declared-unmarked", label: "Self-declared", points: 0.1 }),
  // ASSUMPTION: no readable declaration is no evidence, and zero is the honest
  // score for it. It is not an error: the page still prices at the reference card.
  Object.freeze({ band: "undeclared", label: "No declaration", points: 0 }),
]);

const COVERAGE_BANDS = Object.freeze([
  Object.freeze({ band: "full", label: "Full coverage", points: 1 }),
  Object.freeze({ band: "most", label: "Most destinations", points: 0.65 }),
  Object.freeze({ band: "partial", label: "Partial coverage", points: 0.35 }),
  Object.freeze({ band: "minimal", label: "Minimal coverage", points: 0.1 }),
  Object.freeze({ band: "none", label: "No coverage", points: 0 }),
]);

const COMPLETENESS_BANDS = Object.freeze([
  Object.freeze({ band: "complete", label: "Complete", points: 1 }),
  Object.freeze({ band: "substantial", label: "Substantial", points: 0.7 }),
  Object.freeze({ band: "partial", label: "Partial", points: 0.4 }),
  Object.freeze({ band: "sparse", label: "Sparse", points: 0.15 }),
  Object.freeze({ band: "empty", label: "Nothing declared", points: 0 }),
]);

const AGE_BANDS = Object.freeze([
  Object.freeze({ band: "current", label: "Current", points: 1 }),
  Object.freeze({ band: "aging", label: "Aging", points: 0.7 }),
  Object.freeze({ band: "stale", label: "Stale", points: 0.3 }),
  Object.freeze({ band: "expired", label: "Expired", points: 0 }),
  Object.freeze({ band: "future", label: "Not yet in effect", points: 0 }),
  Object.freeze({ band: "undated", label: "Undated", points: 0 }),
]);

/** The fractions the two ratio criteria band on, best first. Shared so they cannot drift. */
const RATIO_BANDS = Object.freeze([1, 0.75, 0.5, 0]);

/** Band a ratio in [0, 1] against RATIO_BANDS: exactly 1, then >=, then >0, then 0. */
function bandRatio(ratio, bands) {
  if (ratio >= RATIO_BANDS[0]) return bands[0].band;
  if (ratio >= RATIO_BANDS[1]) return bands[1].band;
  if (ratio >= RATIO_BANDS[2]) return bands[2].band;
  if (ratio > RATIO_BANDS[3]) return bands[3].band;
  return bands[4].band;
}

const PERCENT = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });
const percent = (ratio) => PERCENT.format(ratio);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The criteria, in the order they are reported. An ordered array and not an
 * object, so the reason list is a fixed sequence rather than a key-iteration
 * order, and every rendered list is the same list every time.
 */
export const PROVENANCE_CRITERIA = Object.freeze([
  Object.freeze({
    key: "source",
    label: "Price source",
    // ASSUMPTION: provenance is the question this sub-score was added to answer,
    // and it is the only criterion a self-declaration cannot satisfy by being
    // tidy. The largest weight, but under half, so a cited contract with nothing
    // else declared still cannot reach Strong on its own.
    weight: 0.45,
    assumption: "Where a price came from decides whether anyone but its author can check it.",
    weightReason: "Largest weight because a complete, current, fully covering card is still "
      + "unverifiable if nobody outside this browser can see where its numbers came from.",
    bands: SOURCE_BANDS,
    run: (observed) => ({
      band: observed.sourceBand,
      reason: SOURCE_REASON[observed.sourceBand](observed),
    }),
  }),
  Object.freeze({
    key: "destinationCoverage",
    label: "Destination coverage",
    // ASSUMPTION: coverage outranks completeness because an UNCOVERED destination
    // is silently priced at the reference card while the page reports a declared
    // card, which misstates provenance; an INCOMPLETE field only leaves a declared
    // destination priced with less of the reader's own contract than it could be.
    // A wrong label is worse than a coarse one.
    weight: 0.25,
    assumption: "A destination the card does not name is priced from the reference card, "
      + "whatever the card says elsewhere.",
    weightReason: "Weighted above field completeness because an uncovered destination makes the "
      + "declaration's label wrong, while a missing field only makes it coarse.",
    bands: COVERAGE_BANDS,
    run: (observed) => ({
      band: bandRatio(observed.coverage, COVERAGE_BANDS),
      reason: coverageReason(observed),
    }),
  }),
  Object.freeze({
    key: "fieldCompleteness",
    label: "Field completeness",
    // ASSUMPTION: the six fields RATE_CARD_FIELDS publishes are the declaration,
    // so the fraction filled in is how much of it exists. Below coverage and
    // above staleness: a card missing fields is still about the right prices.
    weight: 0.2,
    assumption: "The declaration is the six fields the #1263 contract publishes; a fraction of "
      + "them is a fraction of a declaration.",
    weightReason: "Third weight: missing fields coarsen a figure the page can still label "
      + "correctly, so they cost less than a mislabelled one.",
    bands: COMPLETENESS_BANDS,
    run: (observed) => ({
      band: bandRatio(observed.completeness, COMPLETENESS_BANDS),
      reason: completenessReason(observed),
    }),
  }),
  Object.freeze({
    key: "effectiveDateAge",
    label: "Effective-date age",
    // ASSUMPTION: age is real evidence about whether the contract still holds, but
    // it is the one criterion whose worst case — a card a year out of date — is
    // usually still closer to the truth than no card at all. Smallest weight, and
    // small enough that an undated card is never the largest deduction on a card
    // whose source is also unproven: the source is the more consequential fact and
    // it is the one the sentence beside the figure should be about.
    weight: 0.1,
    assumption: "A price is evidence about the period it was in effect for, not about every "
      + "period since.",
    weightReason: "Smallest weight because a card that has aged past a renewal is still a "
      + "better description of a lead's prices than the published list is.",
    bands: AGE_BANDS,
    run: (observed) => ({ band: observed.ageBand, reason: ageReason(observed) }),
  }),
]);

// ---------------------------------------------------------------------------
// Reading the card. Metadata only — see the header. Nothing below this line
// reads a rate, a discount percentage or any other number off the card.
// ---------------------------------------------------------------------------

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Reader text, on its way into a sentence somebody will read.
 *
 * Three passes, and each one is load-bearing: the rubric's OWN sanitizer, so this
 * module cannot be the one place with a weaker rule than the judge prompts;
 * markup and quote characters out, because a reason string is quoted inside
 * another sentence and may be copied into a prompt or a brief; then a hard cap,
 * because a citation is a reference, not a paragraph. The DOM is written with
 * textContent regardless — this is what keeps the STRING clean, not the page.
 */
const quoted = (value) => sanitizeFinopsRecommendation(String(value ?? ""))
  .replace(/[<>"'`\\{}]/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, QUOTED_TEXT_MAX_CHARS)
  .trim();

/**
 * Present and of the declared type. NOT in range — the header says why. `kind`
 * comes from RATE_CARD_FIELDS, so adding a field to the contract adds it here.
 */
function wellFormed(kind, value) {
  if (value === null || value === undefined) return false;
  if (kind === "number") return typeof value === "number" && Number.isFinite(value);
  if (kind === "boolean") return typeof value === "boolean";
  if (kind === "currency-code") return typeof value === "string" && /^[A-Z]{3}$/.test(value);
  if (kind === "calendar-date") return isCalendarDate(value);
  return false;
}

/** Whole months from an effective date to the analysis date, never negative-rounded. */
function monthsBetween(from, to) {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  const months = (toYear - fromYear) * 12 + (toMonth - fromMonth);
  return toDay < fromDay ? months - 1 : months;
}

/** Which of the four source bands a card's marks put it in. */
function sourceBandOf(card, covered) {
  if (!card || covered.length === 0) return "undeclared";
  const marks = covered.map((model) => model.source ?? card.source ?? null);
  if (marks.every((mark) => mark === "published-list")) return "reference-published";
  if (marks.every((mark) => mark === "contracted")) {
    return quoted(card.sourceLabel) === "" ? "contracted-uncited" : "contracted-cited";
  }
  if (marks.every((mark) => mark === null)) return "self-declared-unmarked";
  return "mixed-source";
}

/** Which age band the STALEST covered effective date puts the card in. */
function ageBandOf(dates, asOf) {
  if (!isCalendarDate(asOf) || dates.length === 0) return { ageBand: "undated", ageMonths: null };
  // The stalest line, because a card is only as current as the oldest rate on it.
  const oldest = [...dates].sort()[0];
  const ageMonths = monthsBetween(oldest, asOf);
  if (ageMonths < 0) return { ageBand: "future", ageMonths };
  if (ageMonths <= CURRENT_AGE_MONTHS) return { ageBand: "current", ageMonths };
  if (ageMonths <= STALENESS_AGE_MONTHS) return { ageBand: "aging", ageMonths };
  if (ageMonths <= EXPIRED_AGE_MONTHS) return { ageBand: "stale", ageMonths };
  return { ageBand: "expired", ageMonths };
}

/**
 * Everything the criteria read, taken once. Counts and labels, never a rate.
 *
 * A card this module cannot read — null, a string, an object with no models — is
 * a card the analysis did not get, which is the reference-price case, not a throw.
 */
function observe(card, asOf, pricedDestinations) {
  const priced = (Array.isArray(pricedDestinations) ? pricedDestinations : [])
    .filter((id) => typeof id === "string" && id.trim() !== "");
  const models = isRecord(card) && Array.isArray(card.models)
    ? card.models.filter(isRecord) : [];
  const covered = priced
    .map((id) => models.find((model) => model.model === id) ?? null)
    .filter((model) => model !== null);
  const uncovered = priced.filter((id) => !models.some((model) => model.model === id));
  const fields = RATE_CARD_FIELDS.length;
  const declaredFields = covered.reduce((total, model) => total
    + RATE_CARD_FIELDS.filter((field) => wellFormed(field.kind, model[field.field])).length, 0);
  const requiredFields = covered.length * fields;
  const dates = covered.map((model) => model.effectiveDate)
    .filter((date) => isCalendarDate(date));
  return Object.freeze({
    /** True when a readable card covering at least one priced destination arrived. */
    declared: covered.length > 0,
    priced: priced.length,
    covered: covered.length,
    /** Sanitized and sorted, so a reason naming them is deterministic and safe. */
    uncovered: Object.freeze(uncovered.map(quoted).filter(Boolean).sort()),
    coverage: priced.length === 0 ? 0 : covered.length / priced.length,
    fieldsPerDestination: fields,
    declaredFields,
    requiredFields,
    completeness: requiredFields === 0 ? 0 : declaredFields / requiredFields,
    sourceBand: sourceBandOf(isRecord(card) ? card : null, covered),
    citation: isRecord(card) ? quoted(card.sourceLabel) : "",
    asOf: isCalendarDate(asOf) ? asOf : null,
    ...ageBandOf(dates, asOf),
  });
}

// ---------------------------------------------------------------------------
// The reasons. Generated from the observation, one sentence each, naming the
// band and the input that put the card in it. No hand-written copy per case.
// ---------------------------------------------------------------------------

const SOURCE_REASON = Object.freeze({
  "contracted-cited": (observed) =>
    `Rates are declared as contracted and cite a source, "${observed.citation}".`,
  "reference-published": () =>
    "Rates come from the published-list reference card, which is a checkable ceiling, not your contract.",
  "contracted-uncited": () =>
    "Rates are declared as contracted but cite no source, so nobody outside this browser can check them.",
  "mixed-source": (observed) =>
    `The ${plural(observed.covered, "declared destination is", "declared destinations are")} priced `
    + "from more than one kind of source, so the figure blends two provenances.",
  "self-declared-unmarked": () =>
    "The card states no source for its rates, so these are self-declared prices with nothing behind them.",
  undeclared: () =>
    "No declared rate covers a destination this analysis prices, so every one of them is priced "
    + "at the published-list reference card.",
});

function coverageReason(observed) {
  if (observed.coverage >= 1) {
    return `The declaration covers all ${plural(observed.priced, "destination", "destinations")} `
      + "this analysis prices.";
  }
  const named = observed.uncovered.length > 0 && observed.uncovered.length <= 2
    ? ` Not covered: ${observed.uncovered.join(", ")}.` : "";
  return `The declaration covers ${observed.covered} of the ${observed.priced} destinations this `
    + `analysis prices, so ${percent(1 - observed.coverage)} is priced from the reference card.${named}`;
}

function completenessReason(observed) {
  if (!observed.declared) {
    return `None of the ${observed.fieldsPerDestination} declaration fields are stated, because no `
      + "card covers a destination this analysis prices.";
  }
  return `${observed.declaredFields} of the ${observed.requiredFields} required declaration fields `
    + `are present and well-formed across ${plural(observed.covered, "destination", "destinations")}.`;
}

function ageReason(observed) {
  if (observed.ageBand === "undated") {
    return observed.asOf === null
      ? "No analysis date was supplied to compare the declaration's effective date against."
      : "The declaration states no effective date, so how old these prices are is unknown.";
  }
  if (observed.ageBand === "future") {
    return `The declaration takes effect ${plural(-observed.ageMonths, "month", "months")} from the `
      + "analysis date, so it prices nothing today.";
  }
  const age = `The declared card is ${plural(observed.ageMonths, "month", "months")} old, `;
  if (observed.ageBand === "current") {
    return `${age}inside the ${CURRENT_AGE_MONTHS}-month current band.`;
  }
  if (observed.ageBand === "aging") {
    return `${age}past the ${CURRENT_AGE_MONTHS}-month current band and short of the `
      + `${STALENESS_AGE_MONTHS}-month staleness threshold.`;
  }
  if (observed.ageBand === "stale") {
    return `${age}past the ${STALENESS_AGE_MONTHS}-month staleness threshold.`;
  }
  return `${age}past the ${EXPIRED_AGE_MONTHS} months after which a declaration stops being `
    + "evidence about today's prices.";
}

// ---------------------------------------------------------------------------
// The sub-score.
// ---------------------------------------------------------------------------

const ratingFor = (subScore) =>
  RATING_FLOORS.find((entry) => subScore >= entry.floor)?.rating ?? 0;

/**
 * Score one declaration's provenance. One sub-score out, always.
 *
 * @param card the lead's declared rate card. ABSENT CARD ⇒ REFERENCE CARD, the
 *   same rule `resolveRateCard` prices by: an analysis with no declaration is not
 *   an analysis with no prices, it is one priced at the published list, and that
 *   is the provenance this must report. A card that is present but unreadable is
 *   scored on what it does say, never a throw.
 * @param asOf the analysis date the effective dates are compared against, ISO
 *   `YYYY-MM-DD`. Passed in, never read off a clock: omit it and the age criterion
 *   reports `undated` with a reason saying so.
 * @param pricedDestinations the destinations the analysis actually prices.
 * @returns a frozen record: the sub-score, the rating on the rubric's own scale,
 *   the four banded criteria with their reasons, and what was observed.
 */
export function scorePricingProvenance(
  { card = null, asOf = null, pricedDestinations = PRICED_DESTINATIONS } = {}) {
  const observed = observe(card ?? DEFAULT_REFERENCE_CARD, asOf, pricedDestinations);
  const criteria = PROVENANCE_CRITERIA.map((criterion) => {
    const { band, reason } = criterion.run(observed);
    const definition = criterion.bands.find((entry) => entry.band === band);
    const contribution = definition.points * criterion.weight * 100;
    return Object.freeze({
      key: criterion.key,
      label: criterion.label,
      weight: criterion.weight,
      band: definition.band,
      bandLabel: definition.label,
      points: definition.points,
      contribution,
      reason,
      assumption: criterion.assumption,
      weightReason: criterion.weightReason,
      arithmetic: `${definition.points} × ${(criterion.weight * 100).toFixed(0)} = `
        + `${contribution.toFixed(2)}`,
    });
  });
  const unrounded = criteria.reduce((sum, item) => sum + item.contribution, 0);
  const subScore = Math.round(unrounded * 10) / 10;
  const rating = ratingFor(subScore);
  // THE BINDING CRITERION — the one the sentence beside the money is about.
  //
  // The rule: the criterion losing the most points, with ties broken on the
  // declared order above so the sentence is deterministic — EXCEPT that a source
  // below its best band always binds. ASSUMPTION: "whose prices are these?" is the
  // question this sub-score was added to answer, and a reader told about missing
  // fields while the prices themselves are unsourced has been told the smaller
  // thing. A card clean on all four says so through its source.
  const lost = (item) => (1 - item.points) * item.weight;
  const worstOther = criteria.slice(1).reduce((worst, item) =>
    (lost(item) > lost(worst) ? item : worst));
  const binding = lost(criteria[0]) > 0 || lost(worstOther) === 0 ? criteria[0] : worstOther;
  return Object.freeze({
    version: PRICING_PROVENANCE_VERSION,
    subScore,
    scaleMaximum: 100,
    rating,
    ratingLabel: PROVENANCE_RATING_LABEL[rating],
    ratingScaleMaximum: FINOPS_RUBRIC.scale.max,
    declared: observed.declared,
    observed,
    criteria: Object.freeze(criteria),
    binding: binding.key,
    summary: binding.reason,
    arithmetic: `${criteria.map((item) => item.contribution.toFixed(2)).join(" + ")} = `
      + `${unrounded.toFixed(2)}; rounded = ${subScore.toFixed(1)}`,
  });
}

/** The headline fact, beside the figure: a word and a number, never a colour alone. */
export const pricingProvenanceChip = (verdict) =>
  `Pricing provenance: ${verdict?.ratingLabel ?? PROVENANCE_RATING_LABEL[0]} `
  + `(${(verdict?.subScore ?? 0).toFixed(0)}/100)`;

/** The one sentence under the figure: why the sub-score is not higher. */
export const pricingProvenanceSummary = (verdict) =>
  verdict?.summary ?? SOURCE_REASON.undeclared();

/**
 * The four bands, one press away, GENERATED from the records above. Plain
 * language: no criterion key, no band key and no version string reaches a reader.
 */
export function pricingProvenanceDetail(verdict) {
  const scored = verdict ?? scorePricingProvenance({});
  return `Pricing provenance scores ${scored.subScore.toFixed(1)} of 100 — ${scored.ratingLabel} — `
    + "from four banded checks on the rate declaration, never on the rates themselves. "
    + scored.criteria
      .map((item) => `${item.label} — ${item.bandLabel}: ${item.reason}`)
      .join(" ");
}

/**
 * The analysis date, read off an analysis's own period rather than a clock.
 *
 * A period is stated on this page as "2026-06-01 to 2026-07-01", and the date a
 * declaration is judged against is the LAST one in it: a card that took effect
 * after the spend it is pricing is a card that did not price that spend.
 * Anything this cannot read returns null, which is the `undated` band.
 */
export function analysisDateOf(period) {
  const dates = String(period ?? "").match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  const last = dates.at(-1) ?? null;
  return last !== null && isCalendarDate(last) ? last : null;
}

/** The bundled example's period, or null. A fixture this browser could not read is a state. */
function bundledPeriod() {
  try {
    return loadExampleDataset()?.period ?? null;
  } catch {
    return null;
  }
}

/**
 * The provenance the bundled example carries, evaluated once, on the one path.
 *
 * The build seeds the served document from this and the page paints from it, so
 * the served bytes and the render cannot state two different sub-scores. With no
 * declared card the analysis prices at the reference card, which is what this is.
 */
export const BUNDLED_PRICING_PROVENANCE = scorePricingProvenance({
  card: DEFAULT_REFERENCE_CARD,
  asOf: analysisDateOf(bundledPeriod()),
});
