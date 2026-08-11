import { evaluateTwoPeriodCommitment } from "./two-period-commitment-evaluator.js";
import { TWO_PERIOD_COMMITMENT_FIXTURES } from "./two-period-commitment-fixtures.js";

const usd = (minor) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 2,
}).format(minor / 100);

/** Paint one checked synthetic verdict in Trends; no browser data is persisted. */
export function renderTwoPeriodCommitmentExample(doc) {
  const root = doc?.getElementById("two-period-commitment-example");
  if (!root) return null;
  const result = evaluateTwoPeriodCommitment(TWO_PERIOD_COMMITMENT_FIXTURES.verified);
  root.dataset.verdict = result.verdict.code;
  root.querySelector("[data-two-period-verdict]").textContent =
    `${result.verdict.code}. ${usd(result.movement.savingMinor)} realized against ${usd(result.benchmark.committedSavingMinor)} committed.`;
  root.querySelector("[data-two-period-movement]").textContent =
    `${result.movement.fromPeriod} → ${result.movement.toPeriod}: ${result.movement.percentOfBenchmark}% of benchmark.`;
  root.querySelector("[data-two-period-confidence]").textContent =
    `Confidence: ${result.confidence.level}. ${result.confidence.rationale}`;
  root.querySelector("[data-two-period-threshold]").textContent =
    `Evidence threshold: ${result.evidenceThreshold.observedPeriodCount}/${result.evidenceThreshold.requiredPeriodCount} periods. ${result.evidenceThreshold.rationale}`;
  return result;
}

