// Where do I start this month?
//
// One question, one answer, one next step. A FinOps lead opens the AI FinOps
// briefing once a month and needs to know what to do first — and, if they
// challenge it, why that one and how much is actually known. This module owns
// the second half of that: it reads the locally available review, evidence,
// action, and verification records and derives exactly one recommendation.
//
// It decides nothing about presentation. It reads no clock, touches no DOM,
// opens no storage, and makes no network call: the current time arrives as the
// injected `now` argument and nothing else in here can observe time. That is
// what makes the same input always produce the same recommendation, which is
// the only reason a leader can be asked to trust it twice.
//
// ---------------------------------------------------------------------------
// METRIC DEFINITIONS — write these down before any widget
// ---------------------------------------------------------------------------
// Two engineers must compute these identically, so each is stated as an
// instruction rather than as an intent.
//
// monthly_impact_usd
//   Sum, over the candidate's line items, of
//     current_monthly_cost_usd − projected_monthly_cost_usd
//   evaluated in USD only. A line item carrying any other currency is not
//   converted — no rate table ships here — it is a missing required input.
//   Rounding is half-up to whole dollars ONCE, at the final sum, never per
//   item: rounding each item and adding the results is a different number and
//   two engineers who each picked one would disagree by dollars.
//   If the observation window backing a line item is shorter than one full
//   calendar month, the item is INCOMPLETE. It is not prorated and not
//   extrapolated — a nineteen-day window multiplied up to a month is an
//   invented figure — it is excluded from the sum, its id is reported, and the
//   exclusion is named in the evidence boundary. A window is complete when its
//   inclusive end day is on or after one calendar month after its start day,
//   less one day, so 2026-06-01..2026-06-30 and 2026-02-01..2026-02-28 both
//   qualify and 2026-06-01..2026-06-20 does not.
//
// annualized_impact_usd
//   monthly_impact_usd × 12. Nothing else. No compounding, no growth
//   assumption, no adoption ramp, no partial-year proration.
//
// confidence
//   An enum, never a float and never a percentage, because a leader acts on a
//   word and a decimal point only invites an argument about the third digit.
//     high   — every required input present, the source was captured 35 days
//              or fewer before `now`, and impact is derived from locally
//              recorded amounts.
//     medium — every required input present, but either the capture age is
//              36–90 days inclusive, or impact is derived from a published
//              benchmark ratio rather than from recorded amounts.
//     low    — any required input missing or unparseable, or capture age
//              greater than 90 days, or any line item excluded as incomplete.
//   `low` always resolves to EVIDENCE_INSUFFICIENT. That is not a coincidence
//   of the ordering below; it is the ordering's purpose.
//
// provenance
//   The named local source of the numbers plus its capture date, rendered as
//   "local fixture `<name>`, captured YYYY-MM-DD". Never "internal data".
//
// evidence_boundary
//   One sentence naming what the figure does NOT cover — which accounts,
//   services, or period sit outside the fixture, or which published benchmark
//   stands in for measurement, or which line items were excluded as
//   incomplete.
//
// ---------------------------------------------------------------------------
// PRIORITY — a total order, evaluated top-down, first match wins
// ---------------------------------------------------------------------------
//   1. EVIDENCE_INSUFFICIENT   2. VERIFICATION_DUE   3. REVIEW_IN_PROGRESS
//   4. ACTIONS_PENDING         5. NO_CURRENT_REVIEW
//
// Sufficiency is checked FIRST, deliberately. Every other branch ends in a
// figure and a confident sentence; if a degraded input could reach one of them
// it would be dressed up as a recommendation the evidence does not support.
// Checking it last would be the same code with the opposite meaning.
//
// Within a state, when several records qualify, they are ranked by descending
// monthly_impact_usd and then by ascending record id. The id tiebreak is not
// cosmetic: without it a shuffled input order changes the answer, and a
// recommendation that moves when nothing moved is not a recommendation.

import { calendarDate, calendarDayDifference, isCalendarDate } from "./calendar-date.js";
import { roundHalfUp } from "./finops-decision-contract.js";

export const NEXT_STEP_CONTRACT = "finops-next-step/1.0.0";
export const JOURNEY_STATE_CONTRACT = "finops-journey-state/1.0.0";

export const JOURNEY_STATE = Object.freeze({
  evidenceInsufficient: "EVIDENCE_INSUFFICIENT",
  verificationDue: "VERIFICATION_DUE",
  reviewInProgress: "REVIEW_IN_PROGRESS",
  actionsPending: "ACTIONS_PENDING",
  noCurrentReview: "NO_CURRENT_REVIEW",
});

/** The total order. Exported so a test pins the rule, not a reading of it. */
export const STATE_PRIORITY = Object.freeze([
  JOURNEY_STATE.evidenceInsufficient,
  JOURNEY_STATE.verificationDue,
  JOURNEY_STATE.reviewInProgress,
  JOURNEY_STATE.actionsPending,
  JOURNEY_STATE.noCurrentReview,
]);

export const CONFIDENCE = Object.freeze({ high: "high", medium: "medium", low: "low" });

/** Capture-age thresholds, in whole days, inclusive at both named bounds. */
export const CAPTURE_AGE_DAYS = Object.freeze({ high: 35, medium: 90 });

/** The only four things this screen ever asks a lead to do. */
export const PRIMARY_ACTION = Object.freeze({
  startReview: "start_review",
  resumeReview: "resume_review",
  verifyAction: "verify_action",
  collectEvidence: "collect_evidence",
});

/** The rule that made each state win, in the words the disclosure shows. */
export const PRIORITY_RULE = Object.freeze({
  [JOURNEY_STATE.evidenceInsufficient]:
    "Evidence sufficiency is checked before every other state, so a degraded input cannot be presented as a confident recommendation.",
  [JOURNEY_STATE.verificationDue]:
    "A tracked action whose expected effect has arrived outranks any review work: it is the only step that closes a loop already opened.",
  [JOURNEY_STATE.reviewInProgress]:
    "An unfinished review outranks pending dispositions and starting a new month, because finishing it is what produces those dispositions.",
  [JOURNEY_STATE.actionsPending]:
    "The most recent review is complete but its actions have no owner-acknowledged disposition, which outranks opening a new month's review.",
  [JOURNEY_STATE.noCurrentReview]:
    "Nothing earlier in the order is outstanding, so the next step is the review for the month that has none.",
});

const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const isFilledString = (value) => typeof value === "string" && value.trim().length > 0;
const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const freeze = Object.freeze;

/* ------------------------------- calendar --------------------------------- */

/**
 * The injected clock, reduced to the civil day it names.
 *
 * A `Date`, an ISO timestamp, or a bare calendar date are all accepted, and all
 * three collapse to `YYYY-MM-DD` before anything reads them. `Date.now()` is
 * never called here — that is the whole point of the argument.
 */
export function asOfDay(now) {
  if (now instanceof Date) {
    return Number.isFinite(now.getTime()) ? calendarDate(now.toISOString().slice(0, 10)) : null;
  }
  if (typeof now === "string") return calendarDate(now.slice(0, 10));
  return null;
}

/** The calendar month a day falls in, as `YYYY-MM`. */
const monthOf = (day) => (isCalendarDate(day) ? day.slice(0, 7) : null);

/** The last day of the calendar month `day` starts in, clamped for February. */
function addOneCalendarMonth(day) {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  // Clamp the day, so 2026-01-31 plus a month is 2026-02-28 rather than March.
  let candidate = null;
  for (let attempt = date; attempt >= 1 && candidate === null; attempt -= 1) {
    candidate = calendarDate(
      `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}-${String(attempt).padStart(2, "0")}`,
    );
  }
  return candidate;
}

/**
 * Does an inclusive observation window cover at least one full calendar month?
 * See the `monthly_impact_usd` definition above; this is that sentence in code.
 */
export function coversFullCalendarMonth(start, end) {
  if (!isCalendarDate(start) || !isCalendarDate(end)) return false;
  const oneMonthOn = addOneCalendarMonth(start);
  if (!oneMonthOn) return false;
  return calendarDayDifference(end, oneMonthOn) <= 1;
}

/** Whole days from a capture date to `now`; negative when captured in future. */
export const captureAgeDays = (capturedOn, day) => calendarDayDifference(capturedOn, day);

/* -------------------------------- metrics --------------------------------- */

/**
 * `monthly_impact_usd`, and the ids of every item excluded for an incomplete
 * observation window. Rounded half-up to whole dollars once, at the sum.
 */
export function monthlyImpactUsd(lineItems = []) {
  const excluded = [];
  let total = 0;
  let counted = 0;
  for (const item of lineItems) {
    if (!isRecord(item)) continue;
    if (!coversFullCalendarMonth(item.observationStart, item.observationEnd)) {
      excluded.push(String(item.id ?? "unnamed line item"));
      continue;
    }
    total += item.currentMonthlyCostUsd - item.projectedMonthlyCostUsd;
    counted += 1;
  }
  return freeze({
    monthlyUsd: counted > 0 ? roundHalfUp(total, 0) : null,
    excludedItemIds: freeze(excluded.sort()),
    countedItems: counted,
  });
}

/** `annualized_impact_usd`. Twelve times the month. Nothing else. */
export const annualizedImpactUsd = (monthlyUsd) =>
  (isFiniteNumber(monthlyUsd) ? monthlyUsd * 12 : null);

/* ------------------------------- validation -------------------------------- */

const IMPACT_BASIS = freeze(["recorded_amounts", "published_benchmark"]);

/**
 * Every required input, named. A returned string is the specific thing a lead
 * has to go and collect, which is what the conservative action asks for — the
 * screen never says "evidence is insufficient" without saying which evidence.
 */
export function missingInputs(journeyState) {
  const gaps = [];
  if (!isRecord(journeyState)) return freeze(["the journey-state record itself"]);
  if (journeyState.contract !== JOURNEY_STATE_CONTRACT) {
    gaps.push(`a journey-state record on contract ${JOURNEY_STATE_CONTRACT}`);
  }
  const source = journeyState.source;
  if (!isRecord(source) || !isFilledString(source.name)) gaps.push("the name of the local source");
  if (!isRecord(source) || !isCalendarDate(source.capturedOn)) {
    gaps.push("a readable capture date for the local source");
  }
  if (!Array.isArray(journeyState.reviews)) gaps.push("the local review records");
  if (!Array.isArray(journeyState.actions)) gaps.push("the local tracked-action records");

  for (const review of journeyState.reviews ?? []) {
    const label = isFilledString(review?.id) ? `review ${review.id}` : "an unnamed review";
    if (!isFilledString(review?.id)) gaps.push("an id on every review record");
    if (!isCalendarDate(review?.periodStart) || !isCalendarDate(review?.periodEnd)) {
      gaps.push(`a readable review period on ${label}`);
    }
    if (review?.completedAt !== null && !isCalendarDate(review?.completedAt)) {
      gaps.push(`a completion date or an explicit null on ${label}`);
    }
  }

  for (const action of journeyState.actions ?? []) {
    const label = isFilledString(action?.id) ? `action ${action.id}` : "an unnamed tracked action";
    if (!isFilledString(action?.id)) gaps.push("an id on every tracked action");
    if (!isFilledString(action?.label)) gaps.push(`a description on ${label}`);
    if (!IMPACT_BASIS.includes(action?.impactBasis)) gaps.push(`a stated impact basis on ${label}`);
    if (!isFilledString(action?.evidenceBoundary)) gaps.push(`an evidence boundary on ${label}`);
    if (action?.expectedEffectOn !== null && !isCalendarDate(action?.expectedEffectOn)) {
      gaps.push(`a readable expected-effect date on ${label}`);
    }
    if (!Array.isArray(action?.lineItems) || action.lineItems.length === 0) {
      gaps.push(`the priced line items behind ${label}`);
      continue;
    }
    for (const item of action.lineItems) {
      const named = isFilledString(item?.id) ? `line item ${item.id}` : `a line item on ${label}`;
      if (!isFiniteNumber(item?.currentMonthlyCostUsd)
        || !isFiniteNumber(item?.projectedMonthlyCostUsd)) {
        gaps.push(`both monthly amounts on ${named}`);
      }
      // No rate table ships here, so a non-USD amount is a missing input rather
      // than a conversion. Saying so is cheaper than being wrong in dollars.
      if (item?.currency !== "USD") gaps.push(`a USD amount on ${named}`);
      if (!isCalendarDate(item?.observationStart) || !isCalendarDate(item?.observationEnd)) {
        gaps.push(`a readable observation window on ${named}`);
      }
    }
  }
  return freeze([...new Set(gaps)]);
}

/* -------------------------------- ranking ---------------------------------- */

/** Descending monthly impact, then ascending id. Total, so shuffling is inert. */
function rank(candidates) {
  return [...candidates].sort((left, right) => {
    const leftImpact = left.impact.monthlyUsd ?? Number.NEGATIVE_INFINITY;
    const rightImpact = right.impact.monthlyUsd ?? Number.NEGATIVE_INFINITY;
    if (leftImpact !== rightImpact) return rightImpact - leftImpact;
    return String(left.id).localeCompare(String(right.id));
  });
}

const withImpact = (action) => ({ ...action, impact: monthlyImpactUsd(action.lineItems) });

/** The most recent review: latest period start, then id, so ties are stable. */
function mostRecentReview(reviews) {
  return [...reviews].sort((left, right) => {
    if (left.periodStart !== right.periodStart) {
      return String(right.periodStart).localeCompare(String(left.periodStart));
    }
    return String(left.id).localeCompare(String(right.id));
  })[0] ?? null;
}

/* ----------------------------- recommendation ------------------------------ */

function boundaryFor(action, excludedItemIds) {
  const stated = action?.evidenceBoundary ?? null;
  if (!excludedItemIds?.length) return stated;
  const names = excludedItemIds.join(", ");
  return `${stated} Excluded as incomplete, and not prorated: ${names}.`;
}

function provenanceOf(source) {
  if (!isRecord(source) || !isFilledString(source.name) || !isCalendarDate(source.capturedOn)) {
    return "Local source not named, so these figures cannot be attributed.";
  }
  return `local fixture \`${source.name}\`, captured ${source.capturedOn}`;
}

function recommendation({
  state, headline, primaryAction, subject = null, impact = null, confidence,
  provenance, evidenceBoundary, unknowns = [], outranked = 0, outrankedStates = [],
}) {
  const monthlyUsd = impact?.monthlyUsd ?? null;
  return freeze({
    contract: NEXT_STEP_CONTRACT,
    question: "Where do I start this month?",
    state,
    headline,
    primaryAction: freeze({ ...primaryAction }),
    subject: subject ? freeze({ ...subject }) : null,
    impact: freeze({
      // `stated:false` is the load-bearing field. A screen may print a figure
      // only when this is true; EVIDENCE_INSUFFICIENT never sets it.
      stated: state !== JOURNEY_STATE.evidenceInsufficient && isFiniteNumber(monthlyUsd),
      monthlyUsd: state === JOURNEY_STATE.evidenceInsufficient ? null : monthlyUsd,
      annualizedUsd: state === JOURNEY_STATE.evidenceInsufficient
        ? null : annualizedImpactUsd(monthlyUsd),
      currency: "USD",
      excludedItemIds: freeze([...(impact?.excludedItemIds ?? [])]),
    }),
    confidence,
    provenance,
    evidenceBoundary,
    unknowns: freeze([...unknowns]),
    rationale: freeze({
      matchedState: state,
      rule: PRIORITY_RULE[state],
      priorityOrder: STATE_PRIORITY,
      outrankedCandidates: outranked,
      outrankedStates: freeze([...outrankedStates]),
    }),
  });
}

/**
 * Everything the degraded path is allowed to say: what is missing, what to go
 * and collect, and no figure at all.
 */
function insufficient({ gaps, provenance, boundary, confidenceReason }) {
  const first = gaps[0] ?? "the required local evidence";
  return recommendation({
    state: JOURNEY_STATE.evidenceInsufficient,
    headline: `Start by collecting ${first}. Until it is here, this briefing has no supported figure to give you.`,
    primaryAction: freeze({
      kind: PRIMARY_ACTION.collectEvidence,
      label: `Collect ${first}`,
      collect: freeze([...gaps]),
    }),
    confidence: CONFIDENCE.low,
    provenance,
    evidenceBoundary: boundary,
    unknowns: [...gaps, confidenceReason].filter(Boolean),
    outranked: 0,
    outrankedStates: STATE_PRIORITY.filter((key) => key !== JOURNEY_STATE.evidenceInsufficient),
  });
}

/**
 * The one thing to do next, and everything a leader needs to challenge it.
 *
 * @param {object} journeyState locally available review, evidence, action and
 *   verification records on `finops-journey-state/1.0.0`.
 * @param {Date|string} now the injected clock. Nothing else in this module can
 *   observe time, so the same pair of arguments always produces the same object.
 * @returns {object} one frozen `finops-next-step/1.0.0` recommendation.
 */
export function selectNextStep(journeyState, now) {
  const day = asOfDay(now);
  const source = isRecord(journeyState) ? journeyState.source : null;
  const provenance = provenanceOf(source);

  // ---- 1. EVIDENCE_INSUFFICIENT ------------------------------------------
  const gaps = [...missingInputs(journeyState)];
  if (!day) gaps.unshift("a readable current date for this briefing");

  const actions = (isRecord(journeyState) && Array.isArray(journeyState.actions)
    ? journeyState.actions : []).map(withImpact);
  const excluded = actions.flatMap((action) => action.impact.excludedItemIds);
  if (excluded.length) {
    gaps.push(`a full calendar month of observation for ${excluded.join(", ")}`);
  }

  const age = day && isRecord(source) ? captureAgeDays(source.capturedOn, day) : null;
  const stale = isFiniteNumber(age) && age > CAPTURE_AGE_DAYS.medium;
  if (stale) {
    gaps.push(`a capture newer than ${CAPTURE_AGE_DAYS.medium} days (this one is ${age} days old)`);
  }

  if (gaps.length) {
    return insufficient({
      gaps,
      provenance,
      boundary: excluded.length
        ? `No figure is stated: ${excluded.join(", ")} rest on less than one full calendar month and are never prorated.`
        : "No figure is stated, because the inputs it would rest on are not all present and readable here.",
      confidenceReason: stale ? `capture age ${age} days` : null,
    });
  }

  const reviews = journeyState.reviews;
  const confidenceFor = (action) => (age > CAPTURE_AGE_DAYS.high
    || action?.impactBasis === "published_benchmark" ? CONFIDENCE.medium : CONFIDENCE.high);
  const boundaryOf = (action) => boundaryFor(action, action.impact.excludedItemIds);
  const later = (state) => STATE_PRIORITY.slice(STATE_PRIORITY.indexOf(state) + 1);

  // ---- 2. VERIFICATION_DUE ------------------------------------------------
  const due = rank(actions.filter((action) => isCalendarDate(action.expectedEffectOn)
    && calendarDayDifference(action.expectedEffectOn, day) >= 0
    && (action.verifiedOutcome ?? null) === null));
  if (due.length) {
    const [winner, ...rest] = due;
    return recommendation({
      state: JOURNEY_STATE.verificationDue,
      headline: `Verify “${winner.label}”. Its expected effect was due on ${winner.expectedEffectOn} and no outcome has been recorded.`,
      primaryAction: freeze({
        kind: PRIMARY_ACTION.verifyAction,
        label: `Verify “${winner.label}”`,
        actionId: winner.id,
      }),
      subject: { kind: "action", id: winner.id, label: winner.label },
      impact: winner.impact,
      confidence: confidenceFor(winner),
      provenance,
      evidenceBoundary: boundaryOf(winner),
      outranked: rest.length,
      outrankedStates: later(JOURNEY_STATE.verificationDue),
    });
  }

  // ---- 3. REVIEW_IN_PROGRESS ---------------------------------------------
  const open = [...reviews].filter((review) => review.completedAt === null)
    .sort((left, right) => String(left.periodStart).localeCompare(String(right.periodStart))
      || String(left.id).localeCompare(String(right.id)));
  if (open.length) {
    const winner = open[0];
    // The review's own actions carry its figures; an open review with none is a
    // review whose worth is not yet known, and it says so rather than showing 0.
    const owned = rank(actions.filter((action) => action.reviewId === winner.id));
    const lead = owned[0] ?? null;
    return recommendation({
      state: JOURNEY_STATE.reviewInProgress,
      headline: `Resume the ${monthOf(winner.periodStart)} review. It was opened and never completed.`,
      primaryAction: freeze({
        kind: PRIMARY_ACTION.resumeReview,
        label: `Resume the ${monthOf(winner.periodStart)} review`,
        reviewId: winner.id,
      }),
      subject: { kind: "review", id: winner.id, label: `${monthOf(winner.periodStart)} review` },
      impact: lead?.impact ?? null,
      confidence: confidenceFor(lead),
      provenance,
      evidenceBoundary: lead
        ? boundaryOf(lead)
        : "No figure is carried: this review has no priced line items yet, so its worth is not measured here.",
      outranked: Math.max(0, open.length - 1) + Math.max(0, owned.length - 1),
      outrankedStates: later(JOURNEY_STATE.reviewInProgress),
    });
  }

  // ---- 4. ACTIONS_PENDING -------------------------------------------------
  const latest = mostRecentReview(reviews);
  const pending = latest
    ? rank(actions.filter((action) => action.reviewId === latest.id
      && (action.acknowledgedDisposition ?? null) === null))
    : [];
  if (latest && pending.length) {
    const [winner, ...rest] = pending;
    return recommendation({
      state: JOURNEY_STATE.actionsPending,
      headline: `Resume the ${monthOf(latest.periodStart)} review and have an owner accept or decline “${winner.label}”. Nothing has been dispositioned.`,
      primaryAction: freeze({
        kind: PRIMARY_ACTION.resumeReview,
        label: `Resume the ${monthOf(latest.periodStart)} review to disposition “${winner.label}”`,
        reviewId: latest.id,
        actionId: winner.id,
      }),
      subject: { kind: "action", id: winner.id, label: winner.label },
      impact: winner.impact,
      confidence: confidenceFor(winner),
      provenance,
      evidenceBoundary: boundaryOf(winner),
      outranked: rest.length,
      outrankedStates: later(JOURNEY_STATE.actionsPending),
    });
  }

  // ---- 5. NO_CURRENT_REVIEW ----------------------------------------------
  // The terminal branch, and it is reached two ways that call for one step: no
  // review covers the calendar month containing `now`, or the review that does
  // is complete, dispositioned and verified. Either way nothing is waiting on
  // the lead, and the next thing to do is open the review for this month.
  const month = monthOf(day);
  const covering = reviews.some((review) =>
    monthOf(review.periodStart) <= month && monthOf(review.periodEnd) >= month);
  return recommendation({
    state: JOURNEY_STATE.noCurrentReview,
    headline: covering
      ? `Start the review for the month after ${month}. Everything tracked in ${month} is dispositioned and verified.`
      : `Start the ${month} review. No local review covers this month yet.`,
    primaryAction: freeze({
      kind: PRIMARY_ACTION.startReview,
      label: `Start the ${month} review`,
      month,
    }),
    subject: { kind: "month", id: month, label: `${month} review` },
    impact: null,
    confidence: age > CAPTURE_AGE_DAYS.high ? CONFIDENCE.medium : CONFIDENCE.high,
    provenance,
    evidenceBoundary:
      `No figure is carried: ${month} has no priced line items here yet, so nothing outside this fixture's accounts and services is measured either.`,
    outranked: reviews.length,
    outrankedStates: [],
  });
}
