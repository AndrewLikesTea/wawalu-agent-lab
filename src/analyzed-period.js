// The calendar span the bundled example's analyzed figures actually cover.
//
// THE PROBLEM THIS SOLVES. The homepage takeaway is forwardable by design — it
// exists so a prospect can paste one line to a finance lead. Pasted, "$51,254 of
// $154,500 in analyzed AI spend is recoverable (33%)" draws exactly one reply:
// over what period? The line could not answer it, and neither could the person
// who forwarded it.
//
// The answer is not authorable. It is a property of the months
// `example-dataset.js` cuts its provider exports into, and the analyzed totals
// are summed over the LAST of them — the reporting period, the only window the
// analysis scores. So the months live here, the dataset imports them, and the
// window is built by the same `nextMonth` that stamps `period_end` on the export
// the analysis reads. Take a month off the bundled data and the sentence on the
// homepage moves with it, because it is the same list.
//
// NOTHING IS IMPORTED HERE, on purpose. The homepage first screen has to name
// this span without loading the analysis graph that composes the figures beside
// it; that graph is the reason the takeaway's other four claims are authored
// prose pinned by test rather than composed at runtime. A span is small enough
// to compute for real, so it is computed for real.

/** Six consecutive complete calendar months; the last one is the reporting period. */
export const EXAMPLE_MONTHS = Object.freeze([
  "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
]);

const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** `2026-12` → `2027-01`. Null rather than a rolled-over guess for anything else. */
export function nextMonth(yearMonth) {
  const match = MONTH_KEY.exec(String(yearMonth ?? "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

/**
 * The half-open window the analyzed totals are summed over.
 *
 * The reporting period is the last complete month in the export set — the one
 * `loadExampleDatasetInputs()` attaches the query sample to and the only one
 * `analysis.spendUsd` covers. Null when the set names no usable month, so a
 * caller gets nothing to print rather than a window with a hole in it.
 */
export function reportingWindow(months = EXAMPLE_MONTHS) {
  const usable = (Array.isArray(months) ? months : [])
    .filter((month) => MONTH_KEY.test(String(month ?? "").trim()));
  const last = usable.at(-1);
  const end = last ? nextMonth(last) : null;
  return end ? `${last}-01 to ${end}-01` : null;
}

const MONTH_NAMES = Object.freeze(["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"]);

const WINDOW = /^(\d{4})-(\d{2})-01 to (\d{4})-(\d{2})-01$/;

/**
 * A half-open window in plain calendar words a non-engineer reads without a
 * legend.
 *
 *   "2026-06-01 to 2026-07-01" → "June 2026"
 *   "2026-01-01 to 2026-07-01" → "January–June 2026"
 *   "2025-11-01 to 2026-02-01" → "November 2025–January 2026"
 *
 * Null for anything it cannot name that way, and never a partial phrase: a
 * takeaway that reads "recoverable (33%) across " or "across undefined" is worse
 * than one that says nothing about the period, so the caller drops the clause
 * instead of printing an ISO string or a gap. The window is END-EXCLUSIVE, so
 * the last month it covers is the one before its end.
 */
export function analyzedPeriodPhrase(period) {
  const match = WINDOW.exec(String(period ?? "").trim());
  if (!match) return null;
  const startYear = Number(match[1]);
  const startMonth = Number(match[2]);
  const endYear = Number(match[3]);
  const endMonth = Number(match[4]);
  const lastMonth = endMonth === 1 ? 12 : endMonth - 1;
  const lastYear = endMonth === 1 ? endYear - 1 : endYear;
  const first = MONTH_NAMES[startMonth - 1];
  const last = MONTH_NAMES[lastMonth - 1];
  if (!first || !last) return null;
  const span = (lastYear - startYear) * 12 + (lastMonth - startMonth);
  if (span < 0) return null;
  if (span === 0) return `${first} ${startYear}`;
  return startYear === lastYear
    ? `${first}–${last} ${startYear}`
    : `${first} ${startYear}–${last} ${lastYear}`;
}
