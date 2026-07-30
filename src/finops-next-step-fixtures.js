// Local journey-state fixtures for the AI FinOps briefing's next step.
//
// Invented records for an invented company, held in this bundle. No credential,
// no network call, no customer or provider row, and nothing that came from
// outside this file. One fixture per journey state, plus the three degraded
// shapes the contract has to refuse: a missing required field, a capture stale
// past ninety days, and an observation window shorter than a calendar month.
//
// `REFERENCE_DAY` is the day these were authored against. It is never read as a
// clock — `selectNextStep` takes `now` as an argument — it is the day a caller
// passes to reproduce the documented outcome.

import { JOURNEY_STATE_CONTRACT } from "./finops-next-step.js";

export const REFERENCE_DAY = "2026-07-15";

const item = (id, current, projected, start = "2026-06-01", end = "2026-06-30") => ({
  id,
  currency: "USD",
  currentMonthlyCostUsd: current,
  projectedMonthlyCostUsd: projected,
  observationStart: start,
  observationEnd: end,
});

const action = (overrides) => ({
  id: "a-route-support",
  reviewId: "r-2026-06",
  label: "Route short support summaries to the standard model",
  owner: "Platform lead",
  acknowledgedDisposition: "accepted",
  expectedEffectOn: null,
  verifiedOutcome: null,
  impactBasis: "recorded_amounts",
  evidenceBoundary:
    "Covers the two chat-completion services in this fixture only; batch embedding spend and the two smallest accounts are outside it.",
  lineItems: [item("li-support-chat", 4200, 3120), item("li-support-summaries", 900, 720)],
  ...overrides,
});

const review = (overrides) => ({
  id: "r-2026-06",
  periodStart: "2026-06-01",
  periodEnd: "2026-06-30",
  completedAt: "2026-07-02",
  ...overrides,
});

const journey = (overrides) => Object.freeze({
  contract: JOURNEY_STATE_CONTRACT,
  source: { name: "finops-journey-june-2026", capturedOn: "2026-07-01" },
  reviews: [review({})],
  actions: [action({})],
  ...overrides,
});

/** The smaller of the two tracked actions, so ranking has something to rank. */
const smaller = (overrides) => action({
  id: "a-cache-embeddings",
  label: "Cache repeated embedding requests",
  lineItems: [item("li-embeddings", 1100, 700)],
  ...overrides,
});

export const JOURNEY_FIXTURES = Object.freeze({
  // A tracked action's expected effect has arrived and nothing recorded what
  // happened. Two candidates, so the impact ranking and its tiebreak are live.
  VERIFICATION_DUE: journey({
    actions: [
      action({ expectedEffectOn: "2026-07-10" }),
      smaller({ expectedEffectOn: "2026-07-05" }),
    ],
  }),

  // July was opened and never finished. June is done, so nothing earlier wins.
  REVIEW_IN_PROGRESS: journey({
    reviews: [review({}), review({ id: "r-2026-07", periodStart: "2026-07-01", periodEnd: "2026-07-31", completedAt: null })],
    actions: [
      action({ id: "a-batch-eval", reviewId: "r-2026-07", label: "Batch the nightly evaluation run", acknowledgedDisposition: null }),
      action({ verifiedOutcome: "held", expectedEffectOn: "2026-06-28" }),
    ],
  }),

  // The most recent review is complete, but no owner has accepted or declined
  // what it produced, so the month's findings are sitting unowned.
  ACTIONS_PENDING: journey({
    reviews: [review({ id: "r-2026-07", periodStart: "2026-07-01", periodEnd: "2026-07-31", completedAt: "2026-07-12" })],
    actions: [
      action({ reviewId: "r-2026-07", acknowledgedDisposition: null }),
      smaller({ reviewId: "r-2026-07", acknowledgedDisposition: null }),
    ],
  }),

  // June is closed out end to end and July has no review at all.
  NO_CURRENT_REVIEW: journey({
    actions: [action({ expectedEffectOn: "2026-07-05", verifiedOutcome: "held at 3,120 USD/month" })],
  }),

  // No rate table ships in this product, so a non-USD amount is a missing
  // required input rather than something to convert.
  EVIDENCE_INSUFFICIENT: journey({
    actions: [action({
      expectedEffectOn: "2026-07-10",
      lineItems: [{ ...item("li-support-chat", 4200, 3120), currency: "EUR" }],
    })],
  }),
});

export const DEGRADED_FIXTURES = Object.freeze({
  // The impact basis is gone, so nothing states whether the figure was measured
  // here or borrowed from a published benchmark.
  missingRequiredField: journey({
    actions: [(({ impactBasis, ...rest }) => rest)(action({ expectedEffectOn: "2026-07-10" }))],
  }),

  // Captured 136 days before the reference day: past ninety, so `low`.
  staleCapture: journey({
    source: { name: "finops-journey-february-2026", capturedOn: "2026-03-01" },
    actions: [action({ expectedEffectOn: "2026-07-10" })],
  }),

  // Twenty days of observation. Never prorated, never extrapolated: excluded,
  // named, and the whole recommendation drops to the conservative one.
  subMonthObservationWindow: journey({
    actions: [action({
      expectedEffectOn: "2026-07-10",
      lineItems: [item("li-support-chat", 4200, 3120, "2026-06-01", "2026-06-20")],
    })],
  }),
});

/**
 * What the briefing shows a reader whose browser holds no journey records of
 * their own. Labelled as a bundled synthetic example wherever it is drawn.
 */
export const EXAMPLE_JOURNEY_STATE = JOURNEY_FIXTURES.VERIFICATION_DUE;
