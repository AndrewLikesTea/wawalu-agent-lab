// The one leading finding a local analysis supports.
//
// The import panel already renders a full decision brief. What it never said
// first was the thing a leader actually opens it to ask: *why did spend move
// last month, and what do I do about it?* This module answers exactly that, and
// nothing else, from an already-computed analysis envelope. It adds no data
// source and no second analysis; every number it names is read out of the
// envelope, so an example dataset and a real import produce it identically.
//
// The definitions below are the contract. Two engineers reading them must get
// the same number:
//
//   Reporting period   the most recent complete calendar month in the dataset,
//                      i.e. the newest accepted provider period. Prior period is
//                      the immediately preceding one.
//   Total spend        the analyzed spend for that period — the sum of every
//                      line item's cost whose usage date falls in the month, in
//                      the dataset's single currency (the contract admits USD
//                      only). No proration, no amortization, no credits netting:
//                      the v1 envelope carries no net-cost field.
//   Change             total_spend(reporting) − total_spend(prior), as an
//                      absolute amount and as a percentage of the prior total.
//                      A zero prior total suppresses the percentage outright.
//   Top driver         the department with the largest positive per-department
//                      delta. Ties break on higher reporting spend, then on
//                      department name ascending, then on unit id.
//   Contribution       the driver's delta over the total change, suppressed when
//                      the total change is zero or negative.
//
// Full precision is kept on the model; rounding happens only in the rendered
// strings, at the two-decimal USD and one-decimal percent conventions the
// import panel already uses.

import { formatSignedUsd } from "./evolution.js";
// The reader's own name for the driver, resolved through the one resolver that
// owns that decision. This module composes the sentence the name appears in, so
// it asks; it never reads the label map itself.
import { orgUnitDisplayName } from "./org-unit-display-label.js";

const MONTH_NAMES = Object.freeze([
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]);

/** "2026-06-01 to 2026-07-01" → "June 2026". The period string is the envelope's. */
function monthLabel(period) {
  const match = /^(\d{4})-(\d{2})/.exec(String(period ?? ""));
  if (!match) return null;
  const month = MONTH_NAMES[Number(match[2]) - 1];
  return month ? `${month} ${match[1]}` : null;
}

// Money is rendered, never re-derived: `formatSignedUsd` is the repo's own
// helper beside `formatUsd`, so "+$34,500" here is the same string the rest of
// the page prints. The MODEL still carries full precision — this is the render
// boundary and the only thing that rounds.
const signedUsd = formatSignedUsd;
const percent = (value) => `${Math.round(value * 10) / 10}%`;
const signedPercent = (value) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${percent(Math.abs(value))}`;

function unavailable(reason, reportingLabel) {
  return Object.freeze({
    available: false,
    reason,
    reportingPeriod: null,
    reportingLabel: reportingLabel ?? null,
    priorPeriod: null,
    priorLabel: null,
    totalSpendUsd: null,
    priorTotalSpendUsd: null,
    changeUsd: null,
    changePercent: null,
    driver: null,
    driverContributionPercent: null,
    question: reportingLabel
      ? `How did spend move in ${reportingLabel}?`
      : "How did spend move last month?",
    metric: "Unavailable",
    driverSentence: reason,
    action: Object.freeze({ available: false, text: reason }),
  });
}

/**
 * Rank the departments that grew. Every comparator step is total, so the winner
 * is the same on every machine and in every input order.
 */
function positiveDrivers(departments) {
  return departments
    .map((department) => ({
      id: department.id,
      name: department.name,
      spendUsd: department.spendUsd,
      previousSpendUsd: department.previousSpendUsd ?? 0,
      deltaUsd: department.spendUsd - (department.previousSpendUsd ?? 0),
      recoverableUsd: department.recoverableUsd,
    }))
    .filter((department) => department.deltaUsd > 0)
    .sort((left, right) => right.deltaUsd - left.deltaUsd
      || right.spendUsd - left.spendUsd
      || String(left.name).localeCompare(String(right.name))
      || String(left.id).localeCompare(String(right.id)));
}

/**
 * @param {object} result an envelope from `normalizeLocalFinopsHistory`.
 * @param {{labels?: object}} [options] the reader's own org-unit names, from
 *   page state. Absent or empty leaves every sentence exactly as it is today.
 * @returns the leading question, the one number that answers it, and the
 *   highest-ranked recommendation that names the same driver.
 */
export function leadingFinding(result, { labels = null } = {}) {
  const history = result?.history ?? null;
  const periods = Array.isArray(history?.periods) ? history.periods : [];
  const reportingLabel = monthLabel(history?.currentPeriod ?? result?.period);
  if (!history) return unavailable("No analyzed period is available.", reportingLabel);
  if (periods.length < 2 || history.state !== "available") {
    return unavailable(history.message
      ?? "Add the immediately preceding provider period to calculate a change.", reportingLabel);
  }

  const reporting = periods.at(-1);
  const prior = periods.at(-2);
  const priorLabel = monthLabel(prior.period);
  const totalSpendUsd = reporting.spendUsd;
  const priorTotalSpendUsd = prior.spendUsd;
  const changeUsd = totalSpendUsd - priorTotalSpendUsd;
  // A zero prior total has no percentage. It is not 0%, not infinity, and not
  // NaN%; it is a number that does not exist, so nothing is printed for it.
  const changePercent = priorTotalSpendUsd === 0
    ? null : (changeUsd / priorTotalSpendUsd) * 100;

  const drivers = positiveDrivers(result.rankedDepartments ?? []);
  const driver = drivers[0] ?? null;
  // Sharing a *fall* or a flat month between departments would be arithmetic
  // theatre, so the share is only printed when there is a rise to divide.
  const driverContributionPercent = driver && changeUsd > 0
    ? (driver.deltaUsd / changeUsd) * 100 : null;

  const direction = changeUsd > 0 ? "rise" : changeUsd < 0 ? "fall" : "flat";
  const question = direction === "rise"
    ? `Why did spend rise in ${reportingLabel ?? "the reporting month"}?`
    : direction === "fall"
      ? `Why did spend fall in ${reportingLabel ?? "the reporting month"}?`
      : `Why was spend flat in ${reportingLabel ?? "the reporting month"}?`;
  const versus = priorLabel ? ` versus ${priorLabel}` : "";
  const metric = changePercent === null
    ? `${signedUsd(changeUsd)}${versus} · no percentage: the prior month has no spend to divide by`
    : `${signedUsd(changeUsd)} (${signedPercent(changePercent)})${versus}`;

  // The prioritized action is the analysis's own top-ranked recommendation. It
  // is only offered here when it names this driver; a recommendation about some
  // other department is not an answer to this question, and saying so is more
  // useful than quietly pairing a driver with an unrelated action.
  const topRanked = result.rankedDepartments?.[0] ?? null;
  // One resolver, three sentences. Every unit reference below is this call, so
  // a name a reader typed cannot reach the driver sentence and miss the action.
  const named = (unit) => orgUnitDisplayName(labels, unit?.id, unit?.name);
  const actionNamesDriver = Boolean(driver && topRanked && topRanked.id === driver.id);
  const action = Object.freeze(actionNamesDriver && result.action
    ? { available: true, text: result.action }
    : {
      available: false,
      text: driver && topRanked
        ? `The highest-ranked recommendation names ${named(topRanked)}, not the driver of the change. `
          + "Open the department evidence before choosing an action."
        : "No department grew, so no driver action is prioritized.",
    });

  const driverSentence = driver
    ? `${named(driver)} contributed ${signedUsd(driver.deltaUsd)} of the `
      + `${signedUsd(changeUsd)} change`
      + (driverContributionPercent === null ? "." : ` (${percent(driverContributionPercent)} of it).`)
    : "No department increased its spend against the prior month.";

  return Object.freeze({
    available: true,
    reason: null,
    reportingPeriod: reporting.period,
    reportingLabel,
    priorPeriod: prior.period,
    priorLabel,
    totalSpendUsd,
    priorTotalSpendUsd,
    changeUsd,
    changePercent,
    driver: driver ? Object.freeze(driver) : null,
    driverContributionPercent,
    question,
    metric,
    driverSentence,
    action,
  });
}
