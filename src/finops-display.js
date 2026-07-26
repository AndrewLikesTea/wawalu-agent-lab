// Display trust boundary for executive metrics. The calculation layer owns the
// arithmetic; this layer decides whether a result is plausible enough to show
// as a fact.
const LIMITS = Object.freeze({
  score: [0, 100],
  spendUsd: [0, 1_000_000_000_000],
  queries: [0, 1_000_000_000],
  headcount: [0, 10_000_000],
  departments: [0, 100_000],
  share: [0, 1],
  percentile: [0, 100],
});

export function metricState(value, kind, { integer = false } = {}) {
  const limits = LIMITS[kind];
  const plausible = Boolean(limits) && Number.isFinite(value)
    && value >= limits[0] && value <= limits[1]
    && (!integer || Number.isInteger(value));
  return { plausible, value: plausible ? value : null,
    label: plausible ? "Available" : "Needs review" };
}

export function headlineTrust(totals, organization = {}) {
  const spend = metricState(totals?.spendUsd, "spendUsd");
  const measuredRecoverable = metricState(totals?.recoverableUsd, "spendUsd");
  const recoverablePlausible = measuredRecoverable.plausible && spend.plausible
    && measuredRecoverable.value <= spend.value;
  return {
    score: metricState(totals?.score, "score"),
    spend,
    recoverable: {
      plausible: recoverablePlausible,
      value: recoverablePlausible ? measuredRecoverable.value : null,
      label: recoverablePlausible ? "Available" : "Needs review",
    },
    highValue: metricState(totals?.mix?.highValue, "share"),
    queries: metricState(totals?.queries, "queries", { integer: true }),
    headcount: metricState(totals?.headcount, "headcount", { integer: true }),
    departments: metricState(totals?.departments, "departments", { integer: true }),
    percentile: metricState(organization?.peerPercentile, "percentile"),
  };
}
