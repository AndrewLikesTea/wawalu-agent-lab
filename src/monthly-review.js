export const MONTHLY_REVIEW_VERSION = "finops-monthly-review/1.0.0";

const OPERATORS = Object.freeze({
  "<=": (value, target) => value <= target,
  "<": (value, target) => value < target,
  ">=": (value, target) => value >= target,
  ">": (value, target) => value > target,
  "=": (value, target) => value === target,
});

const finite = (value) => typeof value === "number" && Number.isFinite(value);

/** Compose the three executive decisions. No UI code computes these values. */
export function monthlyReview(fixture) {
  if (fixture?.schemaVersion !== "finops-monthly-review-fixture/1.0.0"
    || fixture.synthetic !== true || fixture.periods?.length !== 2) {
    throw new TypeError("A versioned synthetic two-period monthly review fixture is required");
  }
  const [prior, current] = fixture.periods;
  if (!finite(prior.observedRecoverableSpendUsd) || !finite(current.observedRecoverableSpendUsd)) {
    throw new TypeError("Both periods require finite observed recoverable spend values");
  }
  const commitment = fixture.priorCommitment;
  const compare = OPERATORS[commitment?.operator];
  if (!compare || !finite(commitment.target) || commitment.metricId !== fixture.metric.id) {
    throw new TypeError("The commitment requires a supported operator, target, and matching metric");
  }
  const prioritizedAction = [...(fixture.actions ?? [])].sort((left, right) =>
    left.rank - right.rank || left.id.localeCompare(right.id))[0];
  if (!prioritizedAction || !Number.isInteger(prioritizedAction.rank)) {
    throw new TypeError("At least one explicitly ranked action is required");
  }
  const change = current.observedRecoverableSpendUsd - prior.observedRecoverableSpendUsd;
  const achieved = compare(current.observedRecoverableSpendUsd, commitment.target);
  return Object.freeze({
    schemaVersion: MONTHLY_REVIEW_VERSION,
    fixtureId: fixture.fixtureId,
    questionOrder: Object.freeze([
      "What changed since last month?",
      "Did the prior commitment work?",
      "What single action should be prioritized next?",
    ]),
    change: Object.freeze({
      value: change,
      unit: fixture.metric.unit,
      priorValue: prior.observedRecoverableSpendUsd,
      currentValue: current.observedRecoverableSpendUsd,
      priorPeriod: prior.id,
      currentPeriod: current.id,
      definition: "current-period observed value minus prior-period observed value",
      numerator: fixture.metric.numerator,
      denominator: fixture.metric.denominator,
    }),
    commitment: Object.freeze({
      id: commitment.id,
      statement: commitment.statement,
      operator: commitment.operator,
      target: commitment.target,
      observed: current.observedRecoverableSpendUsd,
      unit: fixture.metric.unit,
      outcome: achieved ? "achieved" : "not_achieved",
      definition: "Achieved only when the current-period observed value satisfies the fixture's declared operator against its target.",
    }),
    confidence: fixture.confidence,
    prioritizedAction: Object.freeze({ ...prioritizedAction,
      rankingRule: "Lowest numeric rank first; ties resolve by ascending action id." }),
    finding: `${fixture.metric.label} changed by ${change} ${fixture.metric.unit}; the prior commitment was ${achieved ? "achieved" : "not achieved"}; ${prioritizedAction.id} is rank 1.`,
    provenance: fixture.provenance,
  });
}
