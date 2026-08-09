// A closed, local-only comparison of retained monthly analysis aggregates and
// retained commitments. No storage, network, clock, raw import, or prompt is in
// this module's input contract.

export const RETAINED_PERIOD_COMPARISON_VERSION = "retained-period-comparison/1.0.0";

const freeze = Object.freeze;
const action = (id, statement, reason) => freeze({ rank: 1, id, statement, reason });
const minor = (value) => Number.isSafeInteger(value) && value >= 0 ? value : null;
const month = (value) => /^\d{4}-(?:0[1-9]|1[0-2])$/.test(String(value)) ? String(value) : null;

function unavailable(reason, periods = [], commitmentId = null) {
  const next = reason === "missing_prior_period"
    ? action("retain_prior_period", "Retain the immediately preceding month, then compare again.", reason)
    : reason === "missing_commitment_baseline"
      ? action("record_comparable_commitment", "Record a savings commitment for the baseline month, then compare again.", reason)
      : action("repair_local_evidence", "Retain complete, comparable local evidence, then compare again.", reason);
  const [baseline, current] = periods.length >= 2 ? periods.slice(-2) : [null, periods.at(-1) ?? null];
  return freeze({
    schemaVersion: RETAINED_PERIOD_COMPARISON_VERSION,
    state: "unavailable",
    unavailableReason: reason,
    periods: freeze({ baseline: baseline?.period ?? null, current: current?.period ?? null }),
    savings: freeze({ state: "unavailable", projectedMinor: null, realizedMinor: null, varianceMinor: null }),
    confidence: freeze({ state: "unavailable", score: null, band: "insufficient" }),
    provenance: freeze({
      source: "browser_local_retained_records",
      periodIds: freeze([baseline?.periodId, current?.periodId].filter(Boolean)),
      commitmentId,
    }),
    priorAction: freeze({ status: "unavailable", commitmentId }),
    nextAction: next,
  });
}

function matchingCommitment(commitments, prior) {
  return commitments.filter((item) => item && typeof item === "object"
    && (item.periodId === prior.periodId || item.claim?.period === prior.period))
    .sort((left, right) => String(right.recordedAt).localeCompare(String(left.recordedAt))
      || String(left.commitmentId).localeCompare(String(right.commitmentId)))[0] ?? null;
}

/** Build exactly one comparison and exactly one deterministically ranked action. */
export function buildRetainedPeriodComparison({ periods = [], commitments = [] } = {}) {
  const ordered = (Array.isArray(periods) ? periods : [])
    .filter((item) => item && month(item.period))
    .sort((left, right) => left.period.localeCompare(right.period))
    .slice(-2);
  if (ordered.length < 2) return unavailable("missing_prior_period", ordered);
  const [prior, current] = ordered;
  const commitment = matchingCommitment(Array.isArray(commitments) ? commitments : [], prior);
  if (!commitment) return unavailable("missing_commitment_baseline", ordered);

  const projected = minor(commitment.claim?.monthlySavingsMinor);
  const committedBaseline = minor(commitment.claim?.baselineMonthlyCostMinor);
  const priorSpend = minor(prior.analyzedSpendMinor);
  const currentSpend = minor(current.analyzedSpendMinor);
  const coverage = [prior.coverageRatioPpm, current.coverageRatioPpm]
    .every((value) => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000);
  const commitmentConfidence = Number.isInteger(commitment.confidence?.percent)
    && commitment.confidence.percent >= 0 && commitment.confidence.percent <= 100
    ? commitment.confidence.percent : null;
  if (projected === null || committedBaseline === null || priorSpend === null
    || committedBaseline !== priorSpend || currentSpend === null || !coverage
    || commitmentConfidence === null || prior.dataset !== current.dataset) {
    return unavailable("incomplete_local_evidence", ordered, commitment.commitmentId ?? null);
  }

  // A spend increase realizes zero savings. It remains visible in variance and
  // can never be turned into a negative or fabricated savings claim.
  const realized = Math.max(0, priorSpend - currentSpend);
  const variance = realized - projected;
  const score = Math.min(commitmentConfidence,
    Math.round(Math.min(prior.coverageRatioPpm, current.coverageRatioPpm) / 10_000));
  const status = realized >= projected ? "met" : "missed";
  return freeze({
    schemaVersion: RETAINED_PERIOD_COMPARISON_VERSION,
    state: "available",
    unavailableReason: null,
    periods: freeze({ baseline: prior.period, current: current.period }),
    savings: freeze({ state: "available", projectedMinor: projected, realizedMinor: realized, varianceMinor: variance }),
    confidence: freeze({ state: "available", score, band: score >= 85 ? "high" : score >= 65 ? "medium" : "low" }),
    provenance: freeze({
      source: "browser_local_retained_records",
      periodIds: freeze([prior.periodId, current.periodId]),
      commitmentId: commitment.commitmentId,
    }),
    priorAction: freeze({ status, commitmentId: commitment.commitmentId }),
    nextAction: status === "missed"
      ? action("revise_missed_commitment", "Revise the missed commitment before the next review.", "realized_below_projected")
      : action("verify_and_close_commitment", "Verify scope, then close or extend the met commitment.", "realized_met_projection"),
  });
}
