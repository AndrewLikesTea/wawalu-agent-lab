// Every period inside an imported export, as one series, plus the movement
// between its newest two (#977).
//
// WHAT THIS FIXES. The analysis envelope keys a period to a FILE: one accepted
// provider export is one entry in `history.periods`, because that is what the
// reconciler compares. A reader who exports twelve months in one file therefore
// imported twelve months and was told there was only one period, so no change
// could be computed. The months were in the file the whole time — on the rows,
// in `usage_date` — and nothing read them.
//
// So this module reads them. It is a pure derivation with no DOM, no storage,
// no clock and no network: a raw export in, a sorted series out, and a movement
// summary derived from that series. The renderer beside it paints what these
// functions return and decides nothing.
//
// THE THREE RULES, stated once here so a reader does not have to infer them.
//
//  1. THE CANONICAL KEY IS THE CALENDAR MONTH, `YYYY-MM`. A row's `usage_date`
//     and an envelope's period string ("2026-06-01 to 2026-07-01") both reduce
//     to it, which is what lets a retained period and an in-file period be
//     compared at all. Sorting is on that key, never on file order.
//
//  2. A REPEATED PERIOD IS SUMMED, never last-wins. This is not a new rule: the
//     single-period path already sums every reconciled row in a window into one
//     total, and the multi-provider intake already folds several providers
//     covering one window into one period before any total is computed. Two
//     rows, two files or two providers landing in 2026-07 are 2026-07's spend.
//     Last-wins would silently discard billed spend, which is the one outcome a
//     cost figure may never have.
//
//  3. ROWS ARE RECONCILED BEFORE THEY ARE SUMMED, through the SAME
//     `reconcileRecords` the analysis uses: latest revision per aggregate wins,
//     a repeated revision is dropped. A second summation rule here would put a
//     series total on screen that disagrees with the headline total above it.
//     For the same reason `acceptedExportIds` exists: when the caller knows
//     which exports the reconciler accepted, the series is built from those and
//     an export the analysis quarantined cannot re-enter through this door.

import { LOCAL_KINDS, reconcileRecords } from "./local-finops.js";

/** Bump when a key, a sum rule, or a movement field changes meaning. */
export const PERIOD_SERIES_VERSION = "finops-imported-period-series/1.0.0";

/**
 * How many distinct billing months a period-over-period figure needs.
 *
 * Two, and it is not a threshold anybody tuned: a movement IS a comparison of
 * one month against the one before it, so a series of one has nothing to
 * subtract. It is named and exported because two surfaces enforce it — this
 * module withholds the figure, and a pre-analysis preview reports that it will
 * be withheld — and a second `>= 2` written out on the preview side is exactly
 * how the two come to disagree about the same export.
 */
export const MOVEMENT_MINIMUM_PERIODS = 2;

/** The predicate itself, so both callers ask the same question. */
export const comparablePeriodCount = (count) =>
  Number(count) >= MOVEMENT_MINIMUM_PERIODS;

/** The three directions. "flat" is a finding, not a missing one. */
export const MOVEMENT_DIRECTION = Object.freeze({
  increase: "increase", decrease: "decrease", flat: "flat",
});

const MONTH = /^(\d{4})-(\d{2})/;

/** The month names this page prints, indexed by month number minus one. */
const MONTH_NAMES = Object.freeze([
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]);

const list = (value) => (Array.isArray(value) ? value : []);

const round = (value) => Math.round(value * 100) / 100;

/** Money in the page's existing shape: whole units, grouped, then the code. */
export const formatUsd = (value) =>
  `${Math.round(Number(value) || 0).toLocaleString("en-US")} USD`;

/**
 * The canonical period key for any period-shaped string this page holds.
 *
 * Accepts a row date ("2026-07-14"), an envelope window ("2026-07-01 to
 * 2026-08-01", keyed by its START, which is the month being billed) and a key
 * that is already canonical ("2026-07"). Anything else is null rather than a
 * guess: an unparseable period must not become a bucket.
 */
export function canonicalPeriod(value) {
  const match = MONTH.exec(typeof value === "string" ? value.trim() : "");
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return `${match[1]}-${match[2]}`;
}

const entryOf = (period, minor, recordCount) => Object.freeze({
  period, total: round(minor / 100), spendUsd: round(minor / 100), recordCount,
});

/** Sorted on the canonical key, so file order and object order cannot matter. */
const sorted = (entries) => Object.freeze([...entries]
  .sort((left, right) => left.period.localeCompare(right.period)));

function accumulate(bucket, period, minor, records) {
  const held = bucket.get(period) ?? { minor: 0, recordCount: 0 };
  held.minor += minor;
  held.recordCount += records;
  bucket.set(period, held);
}

const drain = (bucket) => sorted([...bucket.entries()]
  .map(([period, held]) => entryOf(period, held.minor, held.recordCount)));

/**
 * Every distinct calendar month inside one or more raw imported exports.
 *
 * @param input a parsed export (`{ document }`), a raw provider document, or an
 *   array of either. A non-provider document contributes nothing.
 * @param acceptedExportIds when supplied, only these export IDs are read — the
 *   reconciler's own accepted list, so this series covers exactly the exports
 *   the analysis on screen was computed from.
 * @returns a frozen array of `{ period, total, spendUsd, recordCount }`, sorted
 *   ascending on the canonical period key, one entry per distinct month.
 */
export function importedPeriodSeries(input, { acceptedExportIds = null } = {}) {
  const entries = Array.isArray(input) ? input : [input];
  const accepted = acceptedExportIds ? new Set(list(acceptedExportIds)) : null;
  const bucket = new Map();
  for (const entry of entries) {
    const document = entry?.document ?? entry;
    if (!document || document.kind !== LOCAL_KINDS.provider) continue;
    if (accepted && !accepted.has(document.export_id)) continue;
    const { records } = reconcileRecords(
      list(document.records), "aggregate_id", document.export_id);
    for (const record of records) {
      const period = canonicalPeriod(record?.usage_date);
      const minor = Number(record?.cost?.amount_minor);
      if (period === null || !Number.isFinite(minor)) continue;
      accumulate(bucket, period, minor, 1);
    }
  }
  return drain(bucket);
}

/**
 * The same series shape, from period totals that were already summed.
 *
 * This is the retained side: `finops-briefing-retention.js` keeps one figure per
 * analyzed month, and the envelope publishes the same under `history.periods`.
 * Repeats sum here too, for rule 2 above — one rule, both doors.
 *
 * @param periods `[{ period, spendUsd | total }]` in any order.
 */
export function periodSeriesFromTotals(periods) {
  const bucket = new Map();
  for (const entry of list(periods)) {
    const period = canonicalPeriod(entry?.period);
    const amount = Number(entry?.total ?? entry?.spendUsd);
    if (period === null || !Number.isFinite(amount)) continue;
    accumulate(bucket, period, amount * 100, Number(entry?.recordCount) || 0);
  }
  return drain(bucket);
}

/**
 * Merge retained history with the current file, keyed by canonical period.
 *
 * IN-FILE WINS, whole. A period present on both sides is the file's entry and
 * not a sum of the two, because the retained figure is an earlier capture of
 * the same billed month rather than additional spend in it — summing them would
 * double a month every time a reader re-imports. The merge is a keyed map for
 * exactly this reason: concatenating and sorting leaves both copies, and the
 * movement is then computed between one month and itself.
 *
 * @returns a frozen sorted series with one entry per distinct period.
 */
export function mergePeriodSeries(retained, current) {
  const merged = new Map();
  for (const entry of periodSeriesFromTotals(retained)) merged.set(entry.period, entry);
  for (const entry of periodSeriesFromTotals(current)) merged.set(entry.period, entry);
  return sorted([...merged.values()]);
}

const movement = (fields) => Object.freeze({
  version: PERIOD_SERIES_VERSION,
  available: false,
  periodCount: 0,
  latestPeriod: null,
  priorPeriod: null,
  latestTotal: null,
  priorTotal: null,
  delta: null,
  direction: null,
  onlyPeriod: null,
  ...fields,
});

/**
 * Latest against prior, over a series of any length.
 *
 * Pure and total: every input returns a frozen summary, including the empty and
 * single-period ones, and the caller never has to test for a null. The series is
 * re-sorted here rather than trusted, so a shuffled array derives the same
 * movement as an ordered one.
 *
 * @returns `{ latestPeriod, priorPeriod, latestTotal, priorTotal, delta,
 *   direction }` when two or more periods are present; `{ onlyPeriod }` with
 *   `available: false` when exactly one is.
 */
export function periodMovement(series) {
  const entries = periodSeriesFromTotals(series);
  if (entries.length === 0) return movement({});
  const latest = entries.at(-1);
  if (!comparablePeriodCount(entries.length)) {
    return movement({
      periodCount: 1,
      onlyPeriod: latest.period,
      latestPeriod: latest.period,
      latestTotal: latest.total,
    });
  }
  const prior = entries.at(-2);
  const delta = round(latest.total - prior.total);
  return movement({
    available: true,
    periodCount: entries.length,
    latestPeriod: latest.period,
    priorPeriod: prior.period,
    latestTotal: latest.total,
    priorTotal: prior.total,
    delta,
    direction: delta > 0 ? MOVEMENT_DIRECTION.increase
      : delta < 0 ? MOVEMENT_DIRECTION.decrease : MOVEMENT_DIRECTION.flat,
  });
}

/** "2026-03" as a reader reads it: "Mar 2026". Null for anything unparseable. */
export function monthLabel(period) {
  const key = canonicalPeriod(period);
  if (key === null) return null;
  return `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

/**
 * WHICH MONTHS THE FIGURE WAS COMPUTED FROM: the first, the last, and how many.
 *
 * The movement above names the newest two periods and nothing else, so a reader
 * looking at "up 1,500 USD" could not tell whether the file behind it held two
 * months or twelve — and a series merged with retained history can hold months
 * the file they just chose does not. This is the window that series covers,
 * derived from the SAME entries the movement is, so the two cannot disagree.
 *
 * `label` is the whole thing in one string for prose and for a test to pin; the
 * renderer paints the parts, because the arrow is decoration and a screen
 * reader needs the word "to" in its place.
 *
 * @returns `{ monthCount, firstPeriod, lastPeriod, firstLabel, lastLabel,
 *   label }`, with nulls and an empty label when no month was read.
 */
export function comparisonWindow(series) {
  const entries = periodSeriesFromTotals(series);
  const first = entries[0] ?? null;
  const last = entries.at(-1) ?? null;
  const count = entries.length;
  const months = `${count} month${count === 1 ? "" : "s"}`;
  return Object.freeze({
    monthCount: count,
    firstPeriod: first?.period ?? null,
    lastPeriod: last?.period ?? null,
    firstLabel: first ? monthLabel(first.period) : null,
    lastLabel: last ? monthLabel(last.period) : null,
    label: count === 0 ? ""
      : count === 1 ? `${monthLabel(last.period)} only, ${months}`
        : `${monthLabel(first.period)} → ${monthLabel(last.period)}, ${months}`,
  });
}

const WORD = Object.freeze({
  [MOVEMENT_DIRECTION.increase]: "up", [MOVEMENT_DIRECTION.decrease]: "down",
});

/** The file input's own label in src/evolution.html, quoted so the step is findable. */
const FILE_PICKER_LABEL = "Choose your export files";

/**
 * The movement in words: both period names, the direction, and the magnitude.
 *
 * THE SINGLE-PERIOD STATE IS THREE SENTENCES, AND EACH ONE DOES A DIFFERENT
 * JOB: what is not on screen, the one input that is missing, and the one step
 * that supplies it. It used to end at "Movement is stated as soon as a second
 * period is present" — true, and a fact about the file rather than a step, which
 * left a reader holding one month with nothing to do about it. Naming the file
 * picker is not blame: the months are read out of whichever exports are chosen
 * together, so a second month is a file away and the sentence says which control
 * takes it.
 */
export function movementSentence(summary) {
  if (!summary || summary.periodCount === 0) {
    return "No movement figure: no dated calendar month was read from these files, and a "
      + `movement needs at least two months. Under "${FILE_PICKER_LABEL}", re-import a longer `
      + "export whose rows carry a usage date.";
  }
  if (summary.periodCount === 1) {
    return "No movement figure yet. This import covers one month — "
      + `${summary.onlyPeriod}, at ${formatUsd(summary.latestTotal)} — and a movement needs at `
      + `least two months. Under "${FILE_PICKER_LABEL}", re-import a longer export covering an `
      + "earlier month: the months are summed from the rows already inside the files you choose.";
  }
  const pair = `${summary.latestPeriod} vs ${summary.priorPeriod}`;
  if (summary.direction === MOVEMENT_DIRECTION.flat) {
    return `${pair}: flat at ${formatUsd(summary.latestTotal)}.`;
  }
  return `${pair}: ${WORD[summary.direction]} ${formatUsd(Math.abs(summary.delta))} — `
    + `${formatUsd(summary.latestTotal)} against ${formatUsd(summary.priorTotal)}.`;
}

/**
 * What one entry in this series IS. One line, in text.
 *
 * It used to name the count and the range too, which is the window label's job
 * now: two lines one under the other, both saying "three months, May through
 * July", is the same fact twice and neither reads as the answer. So this states
 * the rule the reader cannot see — a month here is every row of that calendar
 * month, summed — and leaves the window to the line above it.
 */
export function seriesSentence(series) {
  const entries = periodSeriesFromTotals(series);
  if (entries.length === 0) return "No period was derived from this export.";
  return "Each month is every row carrying that calendar month, summed.";
}

/** One row of the series, as the page prints it. */
export const periodRowLabel = (entry) =>
  `${entry.period} · ${formatUsd(entry.total)}`;
