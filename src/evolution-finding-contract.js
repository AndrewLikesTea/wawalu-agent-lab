// The page-level finding contract for /evolution.html.
//
// This is intentionally narrower than a FinOps model: it decides the one
// question, benchmark and action the first screen is allowed to present. The
// existing analysis supplies the inputs; this contract adds no metric.

import { getRecoverableSpend } from "./finops-answer-contract.js";
import { FRONT_DOOR_QUESTION, prioritizedDestination } from "./finops-destinations.js";

export const EVOLUTION_FINDING_VERSION = "evolution-finding/1.0.0";
/** The question this page answers, owned by src/finops-destinations.js. */
export const CTO_QUESTION = FRONT_DOOR_QUESTION;
export const BENCHMARK_ID = "modelled_recoverable_spend_usd_per_month";

// The ids the first screen must keep folded into "How we know this". They are
// supporting context for the one benchmark, not rival answers to the question,
// and tests/evolution-finding-contract.test.js walks the served markup to hold
// them there.
export const DISCLOSURE_ONLY_IDS = Object.freeze([
  "finops-recoverable-trust",
  "finops-recoverable-marker",
  "finops-recoverable-provenance",
  "finops-recoverable-grade",
  "finops-recoverable-confidence",
]);

/**
 * Build the only finding /evolution.html may headline.
 *
 * Metric definition: sum `recoverableUsd` for every department row the FinOps
 * rubric scored, rounded half-up once to whole USD. Unscored departments
 * contribute zero and are never extrapolated to. The unit is USD per reporting
 * month and the time basis is the dataset's half-open period [start, end). It
 * is modelled potential at the stated prices, not a reduction observed in an
 * invoice. Realized savings are not available on this product.
 *
 * NOTHING HERE IS RANKED A SECOND TIME. The next action is the prioritized
 * destination record — the same one the destination pages, the workspace nav
 * and the front-door markup read, with its own selection rule and its own pin
 * test. A contract that re-ranked departments here would render an action
 * sentence naming one department while every other surface named another; that
 * silent disagreement is the duplication this page is being cleared of, not a
 * second opinion worth having.
 */
export function buildEvolutionFinding(dataset) {
  const recoverable = getRecoverableSpend(dataset);
  const destination = prioritizedDestination();
  const available = Number.isFinite(recoverable.monthly);

  return Object.freeze({
    version: EVOLUTION_FINDING_VERSION,
    question: CTO_QUESTION,
    primaryBenchmark: Object.freeze({
      id: BENCHMARK_ID,
      available,
      amount: available ? recoverable.monthly : null,
      display: available ? recoverable.monthlyDisplay : "Not stated",
      currency: "USD",
      unit: "USD/month",
      period: recoverable.periodLabel,
      scope: recoverable.scopeSentence,
      scoredDepartments: recoverable.scoredDepartments,
      totalDepartments: recoverable.totalDepartments,
      modeled: true,
      realized: false,
      definition: "Sum recoverableUsd over scored departments for the reporting month; "
        + "round half-up once to whole USD. Unscored departments contribute zero and are not extrapolated.",
    }),
    nextAction: destination ? Object.freeze({
      rank: 1,
      statement: destination.nextAction,
      href: destination.href,
      basis: "The prioritized destination: the largest recoverable spend that is actionable "
        + "at the stated effort. Read from src/finops-destinations.js, not re-ranked here.",
    }) : null,
    // THE DISTINCTION THE FIRST SCREEN MUST DRAW, as data rather than as a
    // sentence a view can quietly stop printing. `modeled` above and `available`
    // here are what the rendered line is written from.
    realizedSavings: Object.freeze({
      available: false,
      amount: null,
      statement: "Modelled potential, not realized savings.",
      reason: "This product models recoverable spend; it does not read invoices after an intervention.",
    }),
    disclosureOnlyIds: DISCLOSURE_ONLY_IDS,
  });
}
