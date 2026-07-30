// What the AI FinOps briefing feeds the journey-state contract.
//
// Two sources, in this order, and the surface says which one it drew:
//
//   1. the reader's own retained monthly action, when this browser holds one —
//      the same record the recurring review already resumes;
//   2. the bundled synthetic journey fixture, when it does not.
//
// Pure: no storage, no DOM, no clock. The caller reads the records and passes
// them in, exactly as `selectNextStep` takes `now` as an argument.
//
// THE MAPPING IS DELIBERATELY NARROW. A retained action carries a priced
// baseline, a target, a deadline and the period it was decided in — and nothing
// about whether anyone later measured the effect. So `verifiedOutcome` is null
// rather than assumed, which is what puts a lead in front of VERIFICATION_DUE
// once the deadline has passed. Nothing here invents a field: a record that
// cannot fill a required input is handed over with the gap intact, and the
// contract refuses it by name.

import { calendarDate, leapYear } from "./calendar-date.js";
import { JOURNEY_STATE_CONTRACT } from "./finops-next-step.js";
import { EXAMPLE_JOURNEY_STATE } from "./finops-next-step-fixtures.js";

export const JOURNEY_SOURCE = Object.freeze({ local: "local", example: "example" });

export const SAMPLE_LABEL = Object.freeze({
  [JOURNEY_SOURCE.example]:
    "◇ Bundled synthetic example — invented review, action, and verification records for an invented company. Not your spend and not realized savings.",
  [JOURNEY_SOURCE.local]:
    "◇ Your own retained records — read in this tab from what this browser already holds. Nothing was uploaded or fetched to build this.",
});

const MONTH_LENGTHS = Object.freeze([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);

/** The last day of a `YYYY-MM` month, as a calendar date. */
function endOfMonth(month) {
  if (typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) return null;
  const index = Number(month.slice(5, 7)) - 1;
  if (index < 0 || index > 11) return null;
  const length = index === 1 && leapYear(Number(month.slice(0, 4))) ? 29 : MONTH_LENGTHS[index];
  return calendarDate(`${month}-${String(length).padStart(2, "0")}`);
}

/** The civil day an ISO timestamp names, without consulting a clock. */
const dayOf = (value) => (typeof value === "string" ? calendarDate(value.slice(0, 10)) : null);

/**
 * One retained monthly action, as a journey state.
 *
 * @param retainedAction a `monthly-department-action/1.0.0` record.
 * @param capturedOn the day the local evidence behind it was captured.
 * @returns a journey state, or null when there is no retained action to read.
 */
export function journeyStateFromRetainedAction(retainedAction, capturedOn) {
  if (!retainedAction) return null;
  const reviewPeriod = retainedAction.reviewPeriod ?? retainedAction.baseline?.period ?? null;
  const reviewId = `review-${reviewPeriod}`;
  const baselinePeriod = retainedAction.baseline?.period ?? null;
  return Object.freeze({
    contract: JOURNEY_STATE_CONTRACT,
    source: {
      name: `retained monthly action ${retainedAction.actionId ?? "unnamed"}`,
      capturedOn: dayOf(capturedOn) ?? dayOf(retainedAction.committedAt),
    },
    reviews: [{
      id: reviewId,
      periodStart: reviewPeriod ? calendarDate(`${reviewPeriod}-01`) : null,
      periodEnd: endOfMonth(reviewPeriod),
      // Committing an action is what completes the review that produced it.
      completedAt: dayOf(retainedAction.committedAt),
    }],
    actions: [{
      id: retainedAction.actionId ?? null,
      reviewId,
      label: retainedAction.actionLabel ?? null,
      owner: retainedAction.ownerLabel ?? null,
      // An owner committed it, which is the acknowledgement this contract means.
      acknowledgedDisposition: "accepted",
      expectedEffectOn: dayOf(retainedAction.target?.deadline),
      // Never assumed. Nothing local records whether the effect was measured.
      verifiedOutcome: null,
      impactBasis: "recorded_amounts",
      evidenceBoundary:
        `Covers ${retainedAction.department ?? "the tracked department"} only, over ${baselinePeriod ?? "the baseline period"}; every other department, service, and period this browser holds is outside it.`,
      lineItems: [{
        id: `${retainedAction.actionId ?? "action"}-baseline-to-target`,
        currency: retainedAction.baseline?.unit === "USD/month" ? "USD" : null,
        currentMonthlyCostUsd: retainedAction.baseline?.value ?? null,
        projectedMonthlyCostUsd: retainedAction.target?.value ?? null,
        observationStart: baselinePeriod ? calendarDate(`${baselinePeriod}-01`) : null,
        observationEnd: endOfMonth(baselinePeriod),
      }],
    }],
  });
}

/**
 * The journey state this briefing should read, and which source it came from.
 * The bundled fixture is the fallback, never a silent one: the caller paints
 * `SAMPLE_LABEL[source]` beside the figures either way.
 */
export function chooseJourneyState({ retainedAction = null, capturedOn = null } = {}) {
  const local = journeyStateFromRetainedAction(retainedAction, capturedOn);
  return local
    ? Object.freeze({ source: JOURNEY_SOURCE.local, journeyState: local })
    : Object.freeze({ source: JOURNEY_SOURCE.example, journeyState: EXAMPLE_JOURNEY_STATE });
}
