/**
 * Executive decision contract for retained FinOps history.
 *
 * Questions, in reading order:
 *  1. Is the retained evidence sufficient to judge last month's commitment?
 *  2. How did the monthly savings commitment move versus the prior complete month?
 *  3. What is the single next action?
 *
 * A complete month is one retained period with finite analyzed spend and one
 * retained commitment for the same periodId whose claim has finite baseline,
 * projected-cost and monthly-savings minor units in USD. Comparisons never
 * cross the dataset prefix of periodId. The two newest complete months in one
 * workspace are used; "preceding" means preceding in that complete retained
 * sequence, not an invented value for an absent calendar month.
 *
 * Deliberately excluded: forecasts, causal attribution, raw rows, prompt text,
 * credentials, and customer identifiers. This contract consumes only the
 * already-allowlisted retained workspace document.
 */

export const FINOPS_DECISION_QUESTION =
  "Is retained evidence sufficient to judge last month’s commitment?";

export const PORTABLE_RECORD_AVAILABILITY = Object.freeze({
  available: "available",
  unavailable: "unavailable",
});

/**
 * Two values, and nothing else, normalized once.
 *
 * Anything unrecognized — `true`, `"yes"`, a typo — reads as `unavailable`,
 * because the default has to be the state that asks for less. It is normalized
 * here rather than compared inline so the returned contract reports the value
 * the ordering actually used instead of echoing back an input no branch read.
 */
const availabilityOf = (value) => value === PORTABLE_RECORD_AVAILABILITY.available
  ? PORTABLE_RECORD_AVAILABILITY.available
  : PORTABLE_RECORD_AVAILABILITY.unavailable;

const money = (minor) => `${(minor / 100).toLocaleString("en-US", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})} USD`;

const workspaceOf = (periodId) => {
  const split = typeof periodId === "string" ? periodId.lastIndexOf(":") : -1;
  return split > 0 ? periodId.slice(0, split) : null;
};

const completeClaim = (commitment) => {
  const claim = commitment?.claim;
  return claim?.currency === "USD"
    && claim?.unit === "usd_minor"
    && [claim.baselineMonthlyCostMinor, claim.projectedMonthlyCostMinor,
      claim.monthlySavingsMinor].every(Number.isFinite);
};

function completeMonths(document) {
  const commitments = new Map();
  for (const commitment of document?.commitments ?? []) {
    if (completeClaim(commitment) && typeof commitment.periodId === "string") {
      commitments.set(commitment.periodId, commitment);
    }
  }
  return (document?.periods ?? [])
    .filter((period) => Number.isFinite(period?.analyzedSpendMinor)
      && commitments.has(period?.periodId) && workspaceOf(period.periodId))
    .map((period) => Object.freeze({
      period: period.period,
      periodId: period.periodId,
      workspace: workspaceOf(period.periodId),
      spendMinor: period.analyzedSpendMinor,
      commitment: commitments.get(period.periodId),
    }))
    .sort((left, right) => left.period.localeCompare(right.period));
}

function verdict(prior, latest) {
  const baseline = prior.commitment.claim.baselineMonthlyCostMinor;
  const target = prior.commitment.claim.projectedMonthlyCostMinor;
  const observed = latest.spendMinor;
  const code = observed <= target ? "achieved" : observed < baseline
    ? "under_realized" : "not_realized";
  const label = {
    achieved: "Achieved",
    under_realized: "Under-realized",
    not_realized: "Not realized",
  }[code];
  return Object.freeze({
    code, label, baselineMinor: baseline, targetMinor: target, observedMinor: observed,
    statement: `${label}: ${latest.period} analyzed spend was ${money(observed)}, against the `
      + `${money(target)} target committed in ${prior.period}.`,
    formula: `achieved when observed <= target; under-realized when target < observed < baseline; `
      + `not-realized when observed >= baseline. Values: ${observed}, ${target}, ${baseline} minor units.`,
  });
}

function movement(prior, latest) {
  const priorMinor = prior.commitment.claim.monthlySavingsMinor;
  const latestMinor = latest.commitment.claim.monthlySavingsMinor;
  const absoluteMinor = latestMinor - priorMinor;
  const percentage = priorMinor === 0 ? null : (absoluteMinor / priorMinor) * 100;
  const percentLabel = percentage === null ? "Undefined (prior commitment is zero)"
    : `${Math.abs(percentage).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
  const direction = absoluteMinor === 0 ? "unchanged"
    : absoluteMinor > 0 ? "increased" : "decreased";
  return Object.freeze({
    priorPeriod: prior.period,
    latestPeriod: latest.period,
    priorMinor,
    latestMinor,
    absoluteMinor,
    percentage,
    percentageLabel: percentLabel,
    statement: absoluteMinor === 0
      ? `Monthly savings commitment was unchanged at ${money(latestMinor)} from ${prior.period} to ${latest.period} (0%).`
      : `Monthly savings commitment ${direction} by ${money(Math.abs(absoluteMinor))} (${percentLabel}) `
        + `from ${money(priorMinor)} in ${prior.period} to ${money(latestMinor)} in ${latest.period}.`,
    formula: "absolute = latest monthlySavingsMinor - prior monthlySavingsMinor; percentage = absolute / prior * 100; percentage is undefined when prior is zero.",
  });
}

/** Build the product-consumed decision state from retained, closed records. */
export function finopsWorkspaceDecision({
  document,
  portableRecordAvailability = PORTABLE_RECORD_AVAILABILITY.unavailable,
} = {}) {
  const availability = availabilityOf(portableRecordAvailability);
  const retainedCount = document?.periods?.length ?? 0;
  const grouped = Map.groupBy(completeMonths(document), (month) => month.workspace);
  const candidates = [...grouped.values()].filter((months) => months.length >= 2)
    .sort((left, right) => right.at(-1).period.localeCompare(left.at(-1).period));
  const pair = candidates[0]?.slice(-2) ?? null;
  const sufficient = pair !== null;

  // The order is the contract, so each action carries the sentence that says why
  // it outranks the one below it. A reader shown a prioritized action and no
  // reason for the priority has been given an instruction, not a decision. The
  // two sufficient-evidence actions carry no `reason`: there is nothing left to
  // outrank, and the verdict and movement statements are the reason.
  let action;
  if (!sufficient && availability === PORTABLE_RECORD_AVAILABILITY.available) {
    action = { code: "import_portable_record", label: "Import your portable record", href: "/evolution.html#local-lead-portability-import",
      reason: "A record you already hold comes first: importing it can close several months of the gap in one action, where adding a month closes one." };
  } else if (!sufficient && retainedCount > 0) {
    action = { code: "add_month", label: "Add a month", href: "/evolution.html#local-import",
      reason: "There is no portable record to import, so the gap closes one month at a time." };
  } else if (!sufficient) {
    action = { code: "start_fresh", label: "Start fresh", href: "/evolution.html#local-import",
      reason: "Nothing is retained here and no portable record was declared, so the first month is the first action." };
  } else {
    const scored = verdict(pair[0], pair[1]);
    action = scored.code === "achieved"
      ? { code: "commit_next_action", label: "Commit to the next action", href: "/savings-commitment.html" }
      : { code: "review_commitment", label: "Review the commitment", href: "/savings-commitment.html" };
  }

  return Object.freeze({
    question: FINOPS_DECISION_QUESTION,
    sufficient,
    evidence: Object.freeze({
      retainedPeriodCount: retainedCount,
      completeComparablePeriodCount: pair ? grouped.get(pair[0].workspace).length : 0,
      requiredCompleteComparablePeriods: 2,
      workspace: pair?.[0].workspace ?? null,
      periods: Object.freeze(pair?.map((month) => month.period) ?? []),
      statement: sufficient
        ? `Sufficient: ${pair[0].period} and ${pair[1].period} are complete retained months for the same workspace.`
        : `Insufficient: two complete retained months for the same workspace are required; ${retainedCount} retained ${retainedCount === 1 ? "period is" : "periods are"} on file.`,
    }),
    movement: sufficient ? movement(pair[0], pair[1]) : null,
    verdict: sufficient ? verdict(pair[0], pair[1]) : null,
    portableRecordAvailability: availability,
    primaryAction: Object.freeze(action),
    limitations: Object.freeze([
      "The verdict compares retained analyzed spend with the prior month’s stored target; it does not prove causation or realized invoice savings.",
      "Only complete retained records in one workspace are compared. Missing calendar months are not estimated.",
    ]),
  });
}
