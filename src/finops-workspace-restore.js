// What a returning visitor gets back without opening a file.
//
// WHY THIS EXISTS
// ---------------
// The workspace store could already be written to and inspected, but nothing
// read it back into the surfaces the figures came from. A visitor who granted
// consent, imported June, and came back a week later saw an empty AI FinOps
// page and had to re-upload the same export to see the same number. Retention
// that only shows up on the retention page is bookkeeping, not memory.
//
// This module answers, from the store alone, the three questions those surfaces
// ask on a return visit:
//
//   BRIEFING       what did this browser last derive, and how sure was it?
//   TREND          what moved between the retained months?
//   RECONCILIATION what did we commit to, and what did the period it was sized
//                  from actually say?
//
// It reads. It does not write, fetch, re-derive, or grade: every figure below
// was selected by the briefing contract at derivation time and by the
// commitment contract at approval time, and is carried here unchanged. A second
// opinion computed on a return visit would be a second answer to a question
// that was already answered, which is the drift this file refuses to introduce.
//
// CONSENT IS THE FIRST GATE, NOT A FILTER
// ---------------------------------------
// Without a granted consent this returns `available: false` and nothing else.
// There is no "read anyway" path: the store is not supposed to hold anything in
// that state, and a reader that coped gracefully with figures being there
// anyway would be a reader that made a broken writer invisible.

import { FINOPS_CONSENT, readFinopsDocument } from "./finops-workspace.js";
import { FINOPS_WORKSPACE_KEY } from "./finops-workspace-contract.js";

/** Why there is nothing to restore. One reason, in the words the page shows. */
export const RESTORE_UNAVAILABLE = Object.freeze({
  storage_unavailable: "This browser did not let the page read its local storage, so nothing could "
    + "be restored from an earlier visit.",
  unsupported: "This browser holds a FinOps workspace written by a newer version of this page. It "
    + "was left untouched and nothing was restored from it.",
  unreadable: "The text stored under the FinOps key is not a workspace document this page can "
    + "read, so nothing was restored from it.",
  not_granted: "This browser has not been asked — or was told not — to remember FinOps figures, so "
    + "there is nothing to restore. Analyses still run in the tab you open them in.",
  empty: "This browser is set to remember FinOps figures and is holding none yet. The next import "
    + "is kept here and comes back on your next visit.",
});

const usd = (minor) => `${(Math.round(Number(minor)) / 100).toLocaleString("en-US", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})} USD`;

const plural = (count, noun) => `${count} ${count === 1 ? noun : `${noun}s`}`;

const dayOf = (instant) => (typeof instant === "string" ? instant.slice(0, 10) : null);

/* -------------------------------- briefing --------------------------------- */

/**
 * The newest retained period, said as the briefing it was derived from.
 *
 * `figure` is absent rather than zero when the analysis selected no material
 * metric: the reason it was absent then is the reason it is absent now.
 */
export function restoredBriefing(periods) {
  const current = periods.at(-1);
  if (!current) return null;
  const hasFigure = current.materialMetricId !== null && current.materialMetricMinor !== null;
  const coveragePercent = Math.round((Number(current.coverageRatioPpm) || 0) / 10_000);
  return Object.freeze({
    periodId: current.periodId,
    period: current.period,
    dataset: current.dataset,
    derivedOn: dayOf(current.derivedAt),
    contractVersion: current.briefingContractVersion,
    sourceFingerprint: current.sourceFingerprint,
    figure: hasFigure ? usd(current.materialMetricMinor) : null,
    metricId: hasFigure ? current.materialMetricId : null,
    confidence: current.confidence,
    coveragePercent,
    analyzedSpend: usd(current.analyzedSpendMinor ?? 0),
    statement: hasFigure
      ? `${usd(current.materialMetricMinor)} for ${current.period}, derived on `
        + `${dayOf(current.derivedAt) ?? "an unrecorded date"} from `
        + `${plural(current.recordsAnalyzed, "analyzed record")} and kept in this browser since. `
        + "The file it came from was never stored and is not needed to read this."
      : `${current.period} was retained without a material figure, so there is nothing to `
        + "headline from it. Importing that month again is what would replace it.",
  });
}

/* ---------------------------------- trend ---------------------------------- */

/**
 * The movement between the two newest retained months.
 *
 * Deliberately a comparison of the analyzed spend the two periods each reported
 * — not a saving, not a forecast, and not a claim that the two months were
 * measured the same way. Two periods derived under different briefing contract
 * versions are reported as not comparable rather than subtracted.
 */
export function restoredTrend(periods) {
  if (periods.length < 2) {
    return Object.freeze({
      available: false,
      reason: "one_period",
      statement: periods.length === 1
        ? `Only ${periods[0].period} is retained here, so there is a figure but no movement. `
          + "Importing the month before it gives this one something to be compared with."
        : "No period is retained here yet, so there is no movement to show.",
      months: Object.freeze(periods.map((period) => period.period)),
    });
  }
  const current = periods.at(-1);
  const prior = periods.at(-2);
  if (current.briefingContractVersion !== prior.briefingContractVersion) {
    return Object.freeze({
      available: false,
      reason: "contract_changed",
      statement: `${prior.period} was derived against ${prior.briefingContractVersion} and `
        + `${current.period} against ${current.briefingContractVersion}. Two figures selected `
        + "under different rules are not a movement, so none is shown.",
      months: Object.freeze([prior.period, current.period]),
    });
  }
  const currentMinor = Number(current.analyzedSpendMinor);
  const priorMinor = Number(prior.analyzedSpendMinor);
  if (!Number.isFinite(currentMinor) || !Number.isFinite(priorMinor) || priorMinor === 0) {
    return Object.freeze({
      available: false,
      reason: "no_baseline",
      statement: `${prior.period} carries no analyzed spend to compare ${current.period} against.`,
      months: Object.freeze([prior.period, current.period]),
    });
  }
  const changeMinor = currentMinor - priorMinor;
  const direction = changeMinor > 0 ? "up" : (changeMinor < 0 ? "down" : "flat");
  const percent = Math.round((changeMinor / priorMinor) * 1000) / 10;
  return Object.freeze({
    available: true,
    reason: null,
    direction,
    changeMinor,
    percent,
    months: Object.freeze([prior.period, current.period]),
    periodCount: periods.length,
    statement: direction === "flat"
      ? `Analyzed AI spend was unchanged between ${prior.period} and ${current.period} at `
        + `${usd(currentMinor)}.`
      : `Analyzed AI spend went ${direction} ${usd(Math.abs(changeMinor))} `
        + `(${Math.abs(percent)}%) between ${prior.period} (${usd(priorMinor)}) and `
        + `${current.period} (${usd(currentMinor)}). Both figures are this browser's own `
        + `retained analyses, ${plural(periods.length, "month")} in total.`,
  });
}

/* ------------------------------ reconciliation ----------------------------- */

/**
 * Every retained commitment beside the retained period it was sized from.
 *
 * The comparison is explicitly *plan against scenario*, not plan against
 * realized savings: this store holds no measurement of what a routing change
 * actually did, and a variance that quietly implied one would be the single
 * most misleading number on the page. `status` says which of the two it is.
 */
export function restoredReconciliation({ periods, commitments }) {
  const byId = new Map(periods.map((period) => [period.periodId, period]));
  const rows = commitments.map((commitment) => {
    const period = commitment.periodId ? byId.get(commitment.periodId) ?? null : null;
    const plannedMinor = Number(commitment.claim?.monthlySavingsMinor);
    const scenarioMinor = period ? Number(period.recoverableScenarioMinor) : NaN;
    const comparable = Number.isFinite(plannedMinor) && Number.isFinite(scenarioMinor);
    const varianceMinor = comparable ? plannedMinor - scenarioMinor : null;
    return Object.freeze({
      commitmentId: commitment.commitmentId,
      decisionId: commitment.decisionId ?? null,
      recordedOn: dayOf(commitment.recordedAt),
      periodId: commitment.periodId ?? null,
      period: period?.period ?? commitment.claim?.period ?? null,
      plannedMonthlySavingsMinor: Number.isFinite(plannedMinor) ? plannedMinor : null,
      scenarioMinor: comparable ? scenarioMinor : null,
      varianceMinor,
      status: comparable ? "compared" : "period_not_retained",
      statement: comparable
        ? `${commitment.commitmentId}: ${usd(plannedMinor)} a month committed on `
          + `${dayOf(commitment.recordedAt)}, against ${usd(scenarioMinor)} of recoverable spend `
          + `the retained ${period.period} analysis identified — a difference of `
          + `${usd(Math.abs(varianceMinor))}. Neither figure is a measured saving.`
        : `${commitment.commitmentId}: ${Number.isFinite(plannedMinor) ? usd(plannedMinor) : "an "
          + "unstated amount"} a month committed on ${dayOf(commitment.recordedAt)}. The period it `
          + "was sized from is not retained in this browser, so there is nothing here to compare "
          + "it with.",
    });
  });
  const compared = rows.filter((row) => row.status === "compared");
  return Object.freeze({
    available: rows.length > 0,
    rows: Object.freeze(rows),
    comparedCount: compared.length,
    statement: rows.length === 0
      ? "No commitment has been approved in this browser yet, so there is nothing to reconcile."
      : `${plural(rows.length, "approved commitment")} kept in this browser, `
        + `${compared.length} of them beside the retained period it was sized from. Every amount `
        + "is a plan or a scenario; no realized saving is stored here.",
  });
}

/* --------------------------------- the read -------------------------------- */

/**
 * Restore what this browser kept, for the briefing, trend, and reconciliation
 * surfaces to paint on a return visit.
 *
 * @param storage this browser's `localStorage`, or a stand-in.
 * @param options.now the instant to stamp the read with, injectable for tests.
 * @returns a frozen model. Total: it never throws, and every reason it can have
 *   nothing to say arrives as a sentence rather than as an empty object.
 */
export function restoreFinopsWorkspace(storage, { now = new Date() } = {}) {
  const { access, document, migratedFrom, dropped } = readFinopsDocument(storage);
  const unavailable = (reason) => Object.freeze({
    available: false,
    reason,
    detail: RESTORE_UNAVAILABLE[reason],
    checkedAt: now.toISOString(),
    briefing: null,
    trend: null,
    reconciliation: null,
    provenance: Object.freeze([]),
  });

  if (access === "unavailable") return unavailable("storage_unavailable");
  if (access === "unsupported") return unavailable("unsupported");
  if (access === "unreadable") return unavailable("unreadable");
  if (document.consent.state !== FINOPS_CONSENT.granted) return unavailable("not_granted");
  if (document.periods.length === 0 && document.commitments.length === 0) return unavailable("empty");

  const briefing = restoredBriefing(document.periods);
  const trend = restoredTrend(document.periods);
  const reconciliation = restoredReconciliation(document);

  const provenance = [
    {
      term: "Source",
      detail: `This browser's local storage, under “${FINOPS_WORKSPACE_KEY}”. `
        + `${plural(document.periods.length, "retained period")} and `
        + `${plural(document.commitments.length, "approved commitment")}. No file was reopened and `
        + "no request was made to restore them.",
    },
    {
      term: "Consent",
      detail: `Granted on ${dayOf(document.consent.decidedAt) ?? "an unrecorded date"} against `
        + `${document.consent.grantedAgainst ?? "an unrecorded version"}. Withdrawing it on the `
        + "workspace page drops every figure below.",
    },
    {
      term: "Figures",
      detail: "Carried unchanged from the analysis that derived them and the commitment that was "
        + "approved. Nothing on this panel is recomputed on a return visit.",
    },
  ];
  if (migratedFrom) {
    provenance.push({
      term: "Migrated",
      detail: `This store was written as ${migratedFrom} and was read forward to `
        + `${document.schemaVersion}. The stored text is rewritten at the new version the next `
        + "time something is retained.",
    });
  }
  if (dropped > 0) {
    provenance.push({
      term: "Not restored",
      detail: `${plural(dropped, "stored entry")} did not match the record shape this build reads `
        + "and was left out of everything above.",
    });
  }

  return Object.freeze({
    available: true,
    reason: null,
    detail: null,
    checkedAt: now.toISOString(),
    migratedFrom,
    dropped,
    briefing,
    trend,
    reconciliation,
    provenance: Object.freeze(provenance.map((row) => Object.freeze(row))),
  });
}
