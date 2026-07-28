// From imported briefings to one projected-versus-realized claim.
//
// WHAT THIS IS FOR
// ----------------
// The Savings Action Center could previously only say what a bundled fixture
// said. That is a demonstration, not a review: the figures were never the
// visitor's own. This module is the seam that lets the same page answer the same
// question — "did the savings we projected actually show up?" — from briefing
// files the visitor exported from the AI FinOps page and reopened here.
//
// It reads files and nothing else. No provider, no credential, no storage, no
// clock, no network. The one instant it needs — the moment an export is written
// — is supplied by the caller, because this module has no clock of its own.
//
// WHERE THE OBSERVED FIGURE COMES FROM
// ------------------------------------
// A saved briefing's `results` projection deliberately carries no per-model
// routing detail; the one per-model figure in the file is the commitment block,
// which states what the leading workload's current route cost in that month.
// That is exactly the observation the verification needs, so a later month is
// presented to the check as the single route row its own commitment block
// documents. Two consequences, both stated on screen rather than hidden:
//
//   * A later month whose leading workload is a different department does not
//     observe the committed route, and is reported as such rather than counted.
//   * No figure here is re-derived. The baseline is the earliest briefing's own,
//     and each observed cost is a later briefing's own.
//
// THE DEMO STAYS
// --------------
// With no file open the page falls back to the bundled fixtures it always used,
// labelled as demonstration data. Imported evidence replaces the demo claim; it
// never merges with it, because a single panel mixing a visitor's month with a
// fixture month would be the one number nobody could trace.

import {
  COMMITMENT_STATUS,
  calendarMonth,
  commitmentLines,
} from "./finops-briefing-commitment.js";
import { RESTORE_REJECTION, parseSavedBriefing } from "./finops-briefing-restore.js";
import {
  SUSTAINED_UNAVAILABLE_REASON,
  SUSTAINED_VERIFICATION_QUESTION,
  VERIFICATION_STATUS,
  sustainedLines,
  verifySustainedCommitment,
} from "./commitment-verification.js";

/** The reopenable file this page writes. One version, stated in the file. */
export const SAVINGS_EVIDENCE_BUNDLE_VERSION = "savings-evidence-bundle/1.0.0";
export const SAVINGS_EVIDENCE_BUNDLE_NAME = "shiplog-savings-evidence.json";
export const SAVINGS_EVIDENCE_MEDIA_TYPE = "application/json";

/** Where a claim's figures came from. There is no third source. */
export const EVIDENCE_SOURCE = Object.freeze({ imported: "imported", demo: "demo" });

/** Ceilings for a bundle, applied before its briefings are read. */
export const MAX_BUNDLE_BRIEFINGS = 24;

const USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 2,
});

const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

/** "2026-07" as "July 2026", for a heading. Ids stay canonical everywhere else. */
export function monthLabel(month) {
  return typeof month === "string" && /^\d{4}-\d{2}$/.test(month)
    ? MONTH.format(new Date(`${month}-01T00:00:00Z`))
    : "an unreadable month";
}

const money = (usd) => USD.format(usd);

/* ------------------------------- reading files ----------------------------- */

/**
 * Read one opened file: a saved briefing, or a bundle this page wrote earlier.
 *
 * @param file `{ name, text, byteSize }` as a file input supplies it.
 * @returns `{ opened: [...], rejected: [...] }`. Total: it never throws, and a
 *   file that cannot be read becomes a rejection with the reader's own sentence
 *   rather than a caught surprise.
 */
export function readEvidenceFile({ name = "file", text = "", byteSize = null } = {}) {
  const bundle = bundleBriefings(text);
  if (bundle) {
    const opened = [];
    const rejected = [];
    bundle.forEach((entry, index) => {
      const read = readBriefingText(`${name} · briefing ${index + 1}`, entry);
      (read.ok ? opened : rejected).push(read.value);
    });
    return { opened, rejected };
  }
  const read = readBriefingText(name, text, byteSize);
  return read.ok ? { opened: [read.value], rejected: [] } : { opened: [], rejected: [read.value] };
}

/** Every opened file, deduplicated by the month each one observes. */
export function readEvidenceFiles(files = []) {
  const opened = [];
  const rejected = [];
  for (const file of Array.isArray(files) ? files : []) {
    const result = readEvidenceFile(file);
    opened.push(...result.opened);
    rejected.push(...result.rejected);
  }
  return { opened, rejected };
}

function readBriefingText(name, text, byteSize = null) {
  const parsed = parseSavedBriefing(text, { byteSize });
  if (!parsed.ok) {
    return {
      ok: false,
      value: { name, code: parsed.code, message: parsed.message ?? RESTORE_REJECTION.unreadable },
    };
  }
  const { saved } = parsed;
  const periodText = `${saved.period.startDate} to ${saved.period.endDate}`;
  return {
    ok: true,
    value: Object.freeze({
      name,
      text,
      month: calendarMonth(periodText),
      periodText,
      dataset: saved.dataset,
      savedOn: saved.savedOn,
      commitment: saved.savingsCommitment,
    }),
  };
}

/** The briefing texts a bundle carries, or null when this is not a bundle. */
function bundleBriefings(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || raw.schemaVersion !== SAVINGS_EVIDENCE_BUNDLE_VERSION) {
    return null;
  }
  if (!Array.isArray(raw.briefings)) return [];
  return raw.briefings.slice(0, MAX_BUNDLE_BRIEFINGS)
    .map((entry) => (typeof entry === "string" ? entry : JSON.stringify(entry)));
}

/**
 * Write the opened evidence back out as one reopenable file.
 *
 * Each briefing is carried verbatim, as its own text, so reopening the bundle
 * puts every file through the same reader that accepted it the first time. This
 * module re-states nothing it was given.
 *
 * @param exportedAt an ISO-8601 instant supplied by the caller.
 */
export function savingsEvidenceBundle(opened = [], { exportedAt = null } = {}) {
  const payload = {
    schemaVersion: SAVINGS_EVIDENCE_BUNDLE_VERSION,
    ...(typeof exportedAt === "string" && exportedAt ? { exportedAt } : {}),
    months: opened.map((entry) => entry.month).filter(Boolean).sort(),
    briefings: opened.map((entry) => JSON.parse(entry.text)),
  };
  return Object.freeze({
    fileName: SAVINGS_EVIDENCE_BUNDLE_NAME,
    mediaType: SAVINGS_EVIDENCE_MEDIA_TYPE,
    text: `${JSON.stringify(payload, null, 2)}\n`,
  });
}

/* ------------------------------- the claim --------------------------------- */

/**
 * The one observation row a saved briefing supports, in the envelope shape the
 * verification already reads. Nothing is invented: the unit, the model, and the
 * cost are the file's own commitment block.
 */
function observationEnvelope(entry) {
  const block = entry.commitment;
  if (!block || block.status !== COMMITMENT_STATUS.ok) return null;
  const { commitment } = block;
  return {
    period: entry.periodText,
    modelRouting: {
      ranked: [{
        unitId: commitment.department.departmentId,
        candidates: [{
          model: commitment.routing.currentRoute.modelId,
          currentSpendUsd: commitment.baseline.monthlyCostUsd,
        }],
        excludedModels: [],
      }],
      insufficientData: [],
    },
  };
}

function fact(label, value) {
  return { label, value };
}

/**
 * A claim with no commitment in it: the state the page shows when the files that
 * were opened carry no commitment to check.
 */
function noCommitmentClaim(opened, notes) {
  const months = opened.map((entry) => entry.month).filter(Boolean).sort();
  return Object.freeze({
    source: EVIDENCE_SOURCE.imported,
    question: SUSTAINED_VERIFICATION_QUESTION,
    status: VERIFICATION_STATUS.unavailable,
    reason: SUSTAINED_UNAVAILABLE_REASON.noCommitment,
    headline: "None of the briefings that were opened proposes a commitment, so there is nothing "
      + "here to check a later month against. Open a briefing whose analysis proposes one.",
    metric: null,
    nextAction: Object.freeze({
      label: "Open a month that proposes a commitment",
      rationale: "A commitment names the department, the route, and the projected monthly saving "
        + "this check compares a later month against. Without one there is no plan of record.",
    }),
    facts: Object.freeze([
      fact("Months opened", months.length ? months.map(monthLabel).join(", ") : "None"),
      fact("Commitment", "No opened briefing carries one"),
    ]),
    calculation: Object.freeze({ rows: Object.freeze([]), versions: Object.freeze([]) }),
    notes: Object.freeze(notes),
    months: Object.freeze([]),
    exportable: opened.length > 0,
  });
}

/**
 * Build the page's claim from the opened files.
 *
 * The earliest opened month that proposes a commitment is the plan of record;
 * every later month is an observation. Pure: two calls on the same files return
 * equal claims.
 */
export function importedSavingsClaim(opened = []) {
  const sorted = [...opened].filter((entry) => entry.month)
    .sort((left, right) => left.month.localeCompare(right.month));
  const notes = [];
  const unreadable = opened.length - sorted.length;
  if (unreadable > 0) {
    notes.push(`${unreadable} opened file${unreadable === 1 ? "" : "s"} observed a window that is `
      + "not one calendar month and named no month to count.");
  }
  const baselineIndex = sorted.findIndex(
    (entry) => entry.commitment?.status === COMMITMENT_STATUS.ok,
  );
  if (baselineIndex < 0) return noCommitmentClaim(opened, notes);

  const baseline = sorted[baselineIndex];
  const laterEntries = sorted.slice(baselineIndex + 1);
  const observations = laterEntries.map(observationEnvelope).filter(Boolean);
  const unobserved = laterEntries.length - observations.length;
  if (unobserved > 0) {
    notes.push(`${unobserved} later month${unobserved === 1 ? "" : "s"} carried no per-route figure `
      + "for its own leading workload, so it could not be read as an observation.");
  }
  const result = verifySustainedCommitment(baseline.commitment, observations);
  const lines = sustainedLines(result);
  const commitment = baseline.commitment.commitment;

  for (const duplicate of result.duplicatePeriods) {
    notes.push(`${monthLabel(duplicate.period)} was opened ${duplicate.copies} times and counts as `
      + `one month${duplicate.agreed ? "" : ", and its copies disagree, so it counts as none"}.`);
  }
  for (const ignored of result.ignored) {
    notes.push(`${ignored.period ? monthLabel(ignored.period) : "One opened file"}: ${ignored.statement}`);
  }
  if (baseline.dataset === "example") {
    notes.push("The baseline briefing is the AI FinOps example dataset, so these figures describe "
      + "the example rather than your own spend.");
  }

  return Object.freeze({
    source: EVIDENCE_SOURCE.imported,
    question: lines.question,
    status: result.status,
    reason: result.reason,
    verdict: result.verdict,
    headline: lines.headline,
    metric: lines.metric,
    monthsCounted: result.monthsCounted,
    monthsRequired: result.monthsRequired,
    nextAction: Object.freeze(nextImportedAction(result, baseline)),
    facts: Object.freeze([
      fact("Accountable department",
        `${commitment.department.name} · ${commitment.accountableOwner.role}`),
      fact("Expected effect",
        `${money(commitment.projectedMonthlySavings.amountUsd)} a month by routing `
        + `${commitment.routing.currentRoute.modelId} to ${commitment.routing.proposedRoute.modelId}`),
      fact("Confidence",
        `${commitment.confidence.percent}% · ${commitment.confidence.band} · ${commitment.confidence.basis}`),
      fact("Provenance",
        `${commitment.provenance.recordCount} imported record`
        + `${commitment.provenance.recordCount === 1 ? "" : "s"} from ${baseline.name}, `
        + `${baseline.dataset === "example" ? "example dataset" : "your own import"}, `
        + `written ${baseline.savedOn}`),
    ]),
    calculation: Object.freeze({
      rows: Object.freeze([
        fact("Baseline month",
          `${monthLabel(commitment.baseline.period)} · ${money(commitment.baseline.monthlyCostUsd)} on `
          + `${commitment.routing.currentRoute.modelId}`),
        fact("Projected monthly saving",
          `${money(commitment.projectedMonthlySavings.amountUsd)} · ${commitment.projectedMonthlySavings.formula}`),
        ...result.months.map((month) => fact(`Observed ${monthLabel(month.observedPeriod)}`,
          `${money(month.realized.monthlyCostUsd)} on the committed route · `
          + `${money(month.realized.monthlySavingsUsd)} realized · ${month.verdictStatement}`)),
        ...(result.totals ? [fact("Sustained total", result.totals.formula)] : []),
        fact("Months counted",
          `${result.monthsCounted} of ${result.monthsRequired} needed · `
          + result.assumptions.deduplication.rule),
      ]),
      caveat: lines.caveat,
      versions: Object.freeze([
        result.schemaVersion, result.monthVerificationVersion, result.contractVersion,
      ]),
    }),
    notes: Object.freeze(notes),
    months: Object.freeze(result.months.map((month) => Object.freeze({
      period: month.observedPeriod,
      label: monthLabel(month.observedPeriod),
      verdict: month.verdict,
      realized: money(month.realized.monthlySavingsUsd),
      variance: money(month.variance.amountUsd),
    }))),
    commitmentHeadline: commitmentLines(baseline.commitment).headline,
    exportable: true,
  });
}

/** The one thing to do next, decided by the state rather than by the reader. */
function nextImportedAction(result, baseline) {
  const nextMonth = result.months.length
    ? monthLabel(nextMonthAfter(result.months.at(-1).observedPeriod))
    : monthLabel(nextMonthAfter(baseline.month));
  if (result.status !== VERIFICATION_STATUS.ok) {
    return {
      label: `Import ${nextMonth} to reach a verified saving`,
      rationale: `${result.monthsCounted} of ${result.monthsRequired} months needed are counted. `
        + "Distinct consecutive months are what a verified saving is made of; reopening a month "
        + "already counted adds nothing to it.",
    };
  }
  if (result.verdict === "verified") {
    return {
      label: "Bank the saving and keep the run going",
      rationale: "Every counted month met the plan. Export this evidence for the accountable owner "
        + "and keep importing months, because a verified run is only verified through its last month.",
    };
  }
  return {
    label: "Review the months that missed the plan with the accountable owner",
    rationale: "At least one counted month realized less than the commitment projected, so the "
      + "route change is not yet a repeatable saving. The per-month figures are in the calculation "
      + "detail below.",
  };
}

function nextMonthAfter(month) {
  if (typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) return null;
  const [year, index] = month.split("-").map(Number);
  return index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, "0")}`;
}
