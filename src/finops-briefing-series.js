/**
 * The retained AI FinOps briefing as a KEYED SERIES rather than one payload (#1089).
 *
 * WHAT THIS FIXES. `finops-briefing-retention.js` keeps exactly one briefing
 * under one key, so a reader who imports June after May has no May: the second
 * write overwrote the first, and a cost page whose whole job is movement could
 * only ever hold the newest month. One record, many entries, keyed so a
 * re-import lands on the entry it belongs to.
 *
 * THE KEY IS PERIOD PLUS PROVIDER SCOPE. `2026-06` and `openai` together
 * identify one entry. The period alone is not enough: two providers can bill the
 * same calendar month, and folding them onto one key would make the later import
 * silently delete the earlier provider's figure. Both halves come off the
 * imported briefing; neither is invented here.
 *
 * WHAT IS STORED IS WHAT WAS DERIVED, ENUMERATED. `briefingSeriesEntry` writes
 * seven named fields by hand — no spread, no iteration over an unknown object,
 * no `JSON.stringify` of anything parsed — so a prompt, a raw model response, a
 * file name or a usage row has no path into this record even when the caller
 * hands over a payload carrying one.
 *
 * NOTHING DERIVED IS STORED, and no storage condition escapes. The count, the
 * span and the ordering are computed on every read; a browser that refuses site
 * data, a truncated value, a hand-edited one and a record from a version this
 * build does not read all surface as an empty series rather than an exception.
 */

import { BRIEFING_RETENTION_KEY } from "./finops-briefing-retention.js";
import { canonicalPeriod, monthLabel } from "./finops-imported-period-series.js";

/** One literal, shared by the page, the migration and the tests. */
export const BRIEFING_SERIES_KEY = "shiplog.finops.briefing.series.v1";

/** Top-level on the record, beside `entries` — never inside an entry. */
export const BRIEFING_SERIES_VERSION = 1;

const EMPTY = Object.freeze([]);

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
const text = (value) => (typeof value === "string" && value.trim() ? value : null);

/**
 * ONE ENTRY, the shape every caller reads and the shape that is persisted.
 *
 *   period          canonical calendar month, `YYYY-MM`
 *   scope           provider id the briefing was recognized as, e.g. `openai`
 *   providerName    that provider's display name
 *   capturedAt      ISO instant the briefing was captured, supplied by the caller
 *   spendUsd        analyzed spend for the period
 *   recoverableUsd  recoverable spend for the period
 *   confidence      the analysis's own confidence word
 *
 * Null when the entry has no period, no capture instant or no spend figure: a
 * row that cannot say which month it is or what it cost is not a partial row.
 */
function entryOf(fields) {
  const period = canonicalPeriod(fields?.period);
  const capturedAt = text(fields?.capturedAt);
  const spendUsd = number(fields?.spendUsd);
  if (period === null || !capturedAt || spendUsd === null) return null;
  return Object.freeze({
    period,
    scope: text(fields?.scope) ?? "unknown",
    providerName: text(fields?.providerName) ?? "Unnamed provider",
    capturedAt,
    spendUsd,
    recoverableUsd: number(fields?.recoverableUsd) ?? 0,
    confidence: text(fields?.confidence) ?? "Low",
  });
}

/**
 * The series entry a retained briefing payload stands for.
 *
 * @param payload a record from `retainedBriefingPayload`, or the legacy
 *   single-briefing record this browser may already be holding — they are the
 *   same shape, which is what makes the migration below a field read.
 */
export function briefingSeriesEntry(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  return entryOf({
    period: payload.totals?.period,
    scope: payload.provider?.id,
    providerName: payload.provider?.name,
    capturedAt: payload.capturedAt,
    spendUsd: payload.totals?.analyzedSpendUsd,
    recoverableUsd: payload.totals?.recoverableUsd,
    confidence: payload.confidence,
  });
}

/** Chronological, computed here so stored insertion order can never matter. */
const chronological = (entries) => Object.freeze([...entries]
  .sort((left, right) => left.period.localeCompare(right.period)
    || left.scope.localeCompare(right.scope)));

const parsed = (storage, key) => {
  let raw;
  try {
    raw = storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/** A record this build reads: the version it wrote, and an array of entries. */
const seriesRecord = (value) => Boolean(value) && typeof value === "object"
  && !Array.isArray(value) && value.version === BRIEFING_SERIES_VERSION
  && Array.isArray(value.entries);

function persist(storage, entries) {
  try {
    storage?.setItem(BRIEFING_SERIES_KEY,
      JSON.stringify({ version: BRIEFING_SERIES_VERSION, entries }));
  } catch {
    // A full or blocked browser keeps the series it can hold in memory for this
    // render and says nothing: the briefing on screen is unaffected, and the
    // retention control beside it already carries the refusal sentence.
  }
  return entries;
}

/**
 * THE PUBLIC READ SHAPE.
 *
 * A frozen array, OLDEST PERIOD FIRST, of the entry shape documented on
 * `entryOf` above. Sorting is by `period` then `scope`, computed on every read.
 * Gaps are gaps: a series holding Apr and Jun is two entries, and no May is
 * fabricated to make the array contiguous. An empty series is `[]`, never null,
 * so no caller needs a null branch.
 *
 * MIGRATION, ON FIRST LOAD. When no series record is present, the legacy
 * single-briefing key is read and, if it holds a briefing, becomes the one entry
 * of a series that is persisted here and then returned. THE LEGACY KEY IS LEFT
 * IN PLACE, deliberately and consistently: it is still the full-fidelity payload
 * the page rehydrates the briefing from — departments, attribution and the
 * reader's own supplied context — and this series carries only the per-period
 * figures. Clearing it on migration would trade a restorable briefing for a
 * summary line. It is removed in exactly one place, `forgetBriefingSeries`.
 */
export function readBriefingSeries(storage) {
  const stored = parsed(storage, BRIEFING_SERIES_KEY);
  if (seriesRecord(stored)) {
    return chronological(stored.entries.map(entryOf).filter(Boolean));
  }
  const migrated = briefingSeriesEntry(parsed(storage, BRIEFING_RETENTION_KEY));
  if (!migrated) return EMPTY;
  return persist(storage, chronological([migrated]));
}

/**
 * Upsert one briefing into the series, keyed by period plus scope.
 *
 * Re-importing a month already on file REPLACES that entry rather than appending
 * beside it: the second import is a later reading of the same billed month, and
 * two rows for one month would double a period the moment anything sums them.
 *
 * @returns the persisted series, in read shape.
 */
export function recordBriefingSeriesEntry(storage, payload) {
  const entry = briefingSeriesEntry(payload);
  const held = readBriefingSeries(storage);
  if (!entry) return held;
  const kept = held.filter((other) =>
    other.period !== entry.period || other.scope !== entry.scope);
  return persist(storage, chronological([...kept, entry]));
}

/**
 * Erase every retained period, and the legacy record with them.
 *
 * Removed, never blanked, and both keys in one call: a forget that left the
 * single-briefing key behind would repopulate the series from it on the very
 * next load, which is a forget that does not forget.
 */
export function forgetBriefingSeries(storage) {
  for (const key of [BRIEFING_SERIES_KEY, BRIEFING_RETENTION_KEY]) {
    try {
      storage?.removeItem(key);
    } catch {
      return EMPTY;
    }
  }
  return EMPTY;
}

/**
 * How many periods are on file and the span they cover, in one line.
 *
 * The count is DISTINCT PERIODS, not entries: two providers billing one month
 * are two entries and one period, and "2 periods on file · Jun 2026" would be a
 * sentence disagreeing with the month beside it.
 *
 * @returns `{ count, firstPeriod, lastPeriod, label }`, with an empty label when
 *   nothing is on file — the caller renders nothing rather than an empty line.
 */
export function briefingSeriesSummary(series) {
  const periods = [...new Set((Array.isArray(series) ? series : [])
    .map((entry) => entry?.period).filter(Boolean))].sort();
  const count = periods.length;
  const first = periods[0] ?? null;
  const last = periods.at(-1) ?? null;
  const span = count === 0 ? ""
    : first === last ? monthLabel(last)
      // Same year, named once: "Apr–Jun 2026" rather than "Apr 2026–Jun 2026".
      : first.slice(0, 4) === last.slice(0, 4)
        ? `${monthLabel(first).slice(0, 3)}–${monthLabel(last)}`
        : `${monthLabel(first)}–${monthLabel(last)}`;
  return Object.freeze({
    count,
    firstPeriod: first,
    lastPeriod: last,
    label: count === 0 ? ""
      : `${count} period${count === 1 ? "" : "s"} on file · ${span}`,
  });
}
