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

// ---------------------------------------------------------------------------
// WHAT A PERIOD ENTRY IS — MEASURED, OR MODELLED BEFORE ANYTHING WAS MEASURED
// (#1106)
// ---------------------------------------------------------------------------
//
// A month can be put on this record before there is a file for it: an estimate
// from declared facts (#1102) covering a month a reader expects to import
// later. That entry is STRUCTURALLY a different thing from an imported one, so
// it carries its own discriminator — `basis` — on the entry itself. Nothing is
// inferred: "no provider id" is not a basis, and an export this page could not
// recognize is still `imported`, because a file was read.
//
// THE FOUR RULES.
//
//  1. ABSENT IS `imported`. Every entry written before this field existed, in
//     storage or in an exported file, came out of a file. It is normalized on
//     read in `entryOf`, the single door every entry comes through.
//
//  2. AN ESTIMATE IS NEVER DELETED BY AN IMPORT. Estimates are filed under
//     their own scope, so an import for the same month lands BESIDE the
//     estimate rather than on its key. `marked()` then stamps the estimate with
//     `supersededBy`, naming the verified entry that took over. The verified
//     entry drives every downstream figure; the estimate stays on the record as
//     the thing that can be scored against it.
//
//  3. TWO ESTIMATES FOR ONE PERIOD REPLACE IN PLACE, keyed by `period` plus
//     `ESTIMATE_SCOPE` — the same upsert rule a re-import already follows. A
//     second estimate is a later reading of the same unmeasured month, and
//     keeping both would put two rows for one period in front of a reader with
//     no way to tell which is current.
//
//  4. `verified` IS DERIVED FROM `basis`, NEVER READ, so no stored record and
//     no hand-edited file can promote its own estimate into a measured month.

export const ENTRY_BASIS = Object.freeze({
  /** Summed out of a provider export this browser read. */
  imported: "imported",
  /** Modelled from declared facts. Never verified against a file. */
  estimated: "estimated",
});

/** The scope every estimate is filed under — see rule 3 above. */
export const ESTIMATE_SCOPE = "estimated";

/** Its name in the provider column, so no surface writes its own. */
export const ESTIMATE_PROVIDER_NAME = "Estimated from declared facts";

/**
 * The basis of an entry, normalized.
 *
 * Absent, null and empty are `imported` (rule 1). Anything present that this
 * build does not recognize is `estimated`, which is the SAFE direction: an
 * unknown basis from a newer build or a hand-edited file is excluded from every
 * realized figure rather than quietly counted as a measured month.
 */
const basisOf = (value) => {
  if (value === undefined || value === null || value === "") return ENTRY_BASIS.imported;
  return value === ENTRY_BASIS.imported ? ENTRY_BASIS.imported : ENTRY_BASIS.estimated;
};

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
 *   basis           `imported` or `estimated` — see the block above
 *   verified        derived: true only for an imported entry
 *   supersededBy    on an estimate an import took over: that entry's key
 *
 * Null when the entry has no period, no capture instant or no spend figure: a
 * row that cannot say which month it is or what it cost is not a partial row.
 */
function entryOf(fields) {
  const period = canonicalPeriod(fields?.period);
  const capturedAt = text(fields?.capturedAt);
  const spendUsd = number(fields?.spendUsd);
  if (period === null || !capturedAt || spendUsd === null) return null;
  const basis = basisOf(fields?.basis);
  const estimated = basis === ENTRY_BASIS.estimated;
  return Object.freeze({
    period,
    scope: text(fields?.scope) ?? "unknown",
    providerName: text(fields?.providerName) ?? "Unnamed provider",
    capturedAt,
    spendUsd,
    recoverableUsd: number(fields?.recoverableUsd) ?? 0,
    confidence: text(fields?.confidence) ?? "Low",
    basis,
    verified: !estimated,
    // Only an estimate can be superseded, and the marker is recomputed below on
    // every read — a file cannot arrive claiming a supersession that its own
    // periods do not contain.
    supersededBy: estimated ? text(fields?.supersededBy) : null,
  });
}

/** One entry's identity: the two halves this series is keyed by. */
const entryKey = (entry) => `${entry.period} ${entry.scope}`;

/**
 * Stamp every estimate that a verified entry has taken over.
 *
 * Derived on every read rather than stored as a decision, so the marker cannot
 * outlive the import that caused it: forget the imported month and the estimate
 * reads live again, which is the truth about the record at that moment. The
 * naming entry is the FIRST imported entry of that period in sorted order, so
 * two providers billing one month name one of them deterministically.
 */
function marked(entries) {
  const verifiedBy = new Map();
  for (const entry of entries) {
    if (entry.basis === ENTRY_BASIS.imported && !verifiedBy.has(entry.period)) {
      verifiedBy.set(entry.period, entryKey(entry));
    }
  }
  return entries.map((entry) => {
    if (entry.basis !== ENTRY_BASIS.estimated) return entry;
    const by = verifiedBy.get(entry.period) ?? null;
    return by === entry.supersededBy ? entry : entryOf({ ...entry, supersededBy: by });
  });
}

/**
 * THE CALCULATION BOUNDARY. The realized months, and nothing else (#1106).
 *
 * Every aggregate, every trend and every commitment verdict reads the series
 * through this one function, so a caller cannot accidentally count a modelled
 * month as a measured one — there is no `basis === "imported"` test anywhere
 * else in this codebase, on purpose.
 *
 * A SUPERSEDED ESTIMATE IS EXCLUDED FOR THE SAME REASON A LIVE ONE IS: it was
 * never verified. The import that superseded it is in this list in its own
 * right, and counting both would double the month.
 */
export const realizedSeries = (series) => Object.freeze((Array.isArray(series) ? series : [])
  .filter((entry) => Boolean(entry) && entry.basis !== ENTRY_BASIS.estimated));

/** The other side of the same filter: the modelled months, live or superseded. */
export const estimatedSeries = (series) => Object.freeze((Array.isArray(series) ? series : [])
  .filter((entry) => entry?.basis === ENTRY_BASIS.estimated));

/**
 * The series entry an estimate from declared facts stands for (#1102, #1106).
 *
 * The figures are the ones the estimator already published — no arithmetic is
 * redone here. Spend is the declared monthly bill it estimated from, and the
 * modelled saving is the LOW end of its recoverable band: an estimate that will
 * later be scored against an invoice may not flatter itself first.
 *
 * @param period the calendar month the estimate covers, supplied by the caller.
 * @param capturedAt an ISO instant from the caller; no clock is read here.
 * @returns an entry, or null when the estimator withheld its figure.
 */
export function estimatedSeriesEntry({ estimate = null, period = null, capturedAt = null } = {}) {
  if (!estimate?.costPerSuccessfulTask?.available) return null;
  const recoverable = estimate.recoverableMonthlyUsd;
  return entryOf({
    period,
    scope: ESTIMATE_SCOPE,
    providerName: ESTIMATE_PROVIDER_NAME,
    capturedAt,
    spendUsd: estimate.inputs?.monthlySpendUsd,
    recoverableUsd: recoverable?.available ? recoverable.low : 0,
    confidence: estimate.confidence?.tier,
    basis: ENTRY_BASIS.estimated,
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

/**
 * Chronological, computed here so stored insertion order can never matter, and
 * superseded ESTIMATES stamped in the same pass — every path that produces a
 * read shape goes through this function, so there is one place the marker is
 * applied and none where it can be forgotten.
 */
const chronological = (entries) => Object.freeze(marked([...entries]
  .sort((left, right) => left.period.localeCompare(right.period)
    || left.scope.localeCompare(right.scope))));

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

/**
 * The ONE write. Every path that persists a series goes through here, so there
 * is exactly one `setItem` in this module and one place a refusal is detected.
 *
 * @returns true when the browser accepted the write, false when it refused —
 *   a full quota, a blocked accessor, or no storage at all.
 */
function writeSeries(storage, entries) {
  try {
    storage?.setItem(BRIEFING_SERIES_KEY,
      JSON.stringify({ version: BRIEFING_SERIES_VERSION, entries }));
    return true;
  } catch {
    // A full or blocked browser keeps the series it can hold in memory for this
    // render and says nothing: the briefing on screen is unaffected, and the
    // retention control beside it already carries the refusal sentence.
    return false;
  }
}

function persist(storage, entries) {
  writeSeries(storage, entries);
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
  return upsert(storage, briefingSeriesEntry(payload));
}

/**
 * Upsert one estimate into the series, keyed by period plus `ESTIMATE_SCOPE`.
 *
 * A re-estimate of a month REPLACES the estimate on file (rule 3 above). An
 * import for that month is not touched by this call and never can be: the two
 * are different keys, and the import keeps its own row.
 *
 * @returns the persisted series, in read shape.
 */
export function recordEstimatedPeriod(storage, options) {
  return upsert(storage, estimatedSeriesEntry(options));
}

/** The one upsert both doors above use: same key, same replace rule, one write. */
function upsert(storage, entry) {
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

// ---------------------------------------------------------------------------
// CARRYING THE SERIES OUT OF THIS BROWSER AND BACK IN (#1092)
// ---------------------------------------------------------------------------
//
// The series above lives in one browser on one device, which is the point of it
// and the reason a reader who changes laptop loses a year of periods. The pair
// below is the way out and back: one self-describing file, shaped here rather
// than in the page, so a page script never learns a field name.
//
// INPUTS ONLY. The file carries the same seven fields an entry holds, plus the
// two optional #1106 fields on an estimate (`basis`, `supersededBy`). The count,
// the span, the ordering and every movement figure are recomputed on the far
// side, so a hand-edited "count" in a file is not a value this build can show.
//
// VALIDATE WHOLE, THEN COMMIT ONCE. `importBriefingSeries` reaches storage only
// after the file is parsed, versioned, shape-checked row by row and merged in
// memory. A rejected file performs no read and no write at all, and a browser
// that refuses the single write says so rather than leaving half a series.

/** Bumped when a field below changes meaning. A newer file is refused, not read. */
export const SERIES_FILE_SCHEMA_VERSION = 1;

/**
 * The ceiling on a chosen file, in bytes: 256 KiB.
 *
 * A track record is seven small fields per period; 256 KiB is thousands of
 * months. The number is here to bound the parse, not to serve a real record.
 */
export const SERIES_FILE_MAX_BYTES = 262144;

/** A stable, descriptive name, so a reader's downloads folder stays legible. */
export const SERIES_FILE_NAME = "shiplog-finops-track-record.json";

const periods = (count) => `${count} period${count === 1 ? "" : "s"}`;

/**
 * Every sentence the portable path says, authored once, each naming its own
 * reason. "Invalid file" tells a reader nothing they can act on.
 */
export const SERIES_FILE_COPY = Object.freeze({
  nothingOnFile: "No period is kept in this browser yet.",
  nothingToExport:
    "There is no track record in this browser to export yet, so no file was written. "
    + "Import a period, or keep one from an analysis of your own first.",
  exported: (count) => `Exported ${periods(count)} to ${SERIES_FILE_NAME}. `
    + "The file was written by this tab and went nowhere else.",
  oversized: (bytes) => `That file is ${bytes} bytes. This page reads a track record file of at `
    + `most ${SERIES_FILE_MAX_BYTES} bytes, so it was not read and nothing here changed.`,
  unparseable: "That file is not valid JSON, so nothing in it could be read. "
    + "Nothing in this browser changed.",
  fileUnreadable: "That file could not be read by this browser, so nothing was imported and "
    + "nothing in this browser changed.",
  notARecord: "That file holds a value rather than a track record object, "
    + "so nothing was read and nothing in this browser changed.",
  noSchemaVersion: "That file does not say which track record format it is written in, so it "
    + "cannot be read safely. Nothing in this browser changed.",
  unknownSchema: (version) => `That file says it is track record format ${version}. This page `
    + `reads format ${SERIES_FILE_SCHEMA_VERSION}, so nothing in this browser changed.`,
  newerSchema: (version) => `That file was written by a newer version of this page (track record `
    + `format ${version}, and this one reads ${SERIES_FILE_SCHEMA_VERSION}). Nothing in this `
    + "browser changed.",
  noPeriods: "That file has no list of periods in it, so there was nothing to import. "
    + "Nothing in this browser changed.",
  malformedPeriod: (position) => `Period ${position} in that file is missing its month, its `
    + "capture time or its spend figure, so the whole file was refused. "
    + "Nothing in this browser changed.",
  writeRefused: "This browser had no room to keep the imported periods, so nothing was written "
    + "and the periods already here are untouched.",
  imported: (added, total) => `Imported ${periods(added)}. This browser now holds `
    + `${periods(total)}.`,
  unreadable: "A track record kept in this browser could not be read, so none of it is shown. "
    + "Import a file you exported earlier, or use the forget control to clear what is here.",
});

/** UTF-8 length, because a byte ceiling counted in UTF-16 units is not a ceiling. */
const byteLengthOf = (value) => (typeof TextEncoder === "function"
  ? new TextEncoder().encode(value).length : value.length);

/**
 * THE FILE SHAPE. Field by field, no spread and no iteration over an unknown
 * object — the same rule the entry writer above holds, for the same reason.
 */
export function serializeBriefingSeries(series) {
  return {
    schemaVersion: SERIES_FILE_SCHEMA_VERSION,
    periods: (Array.isArray(series) ? series : []).filter(Boolean).map((entry) => {
      const record = {
        period: entry.period,
        scope: entry.scope,
        providerName: entry.providerName,
        capturedAt: entry.capturedAt,
        spendUsd: entry.spendUsd,
        recoverableUsd: entry.recoverableUsd,
        confidence: entry.confidence,
      };
      // ADDITIVE AND ONLY WHEN IT IS NOT THE DEFAULT (#1106). A record of
      // imported months alone serializes to the same seven fields it always
      // did, byte for byte, so format 1 means exactly what it meant to a reader
      // holding only imported periods — which is why there is no version bump.
      // A reader on an older build meets these two keys only on an estimate,
      // ignores them, and reads that month as imported; the basis is the one
      // thing that path gets wrong, and it is the reason the field is written
      // at all rather than inferred at either end.
      if (entry.basis === ENTRY_BASIS.estimated) record.basis = ENTRY_BASIS.estimated;
      if (entry.supersededBy) record.supersededBy = entry.supersededBy;
      return record;
    }),
  };
}

/** The file text a reader downloads: the shape above, and nothing beside it. */
export const briefingSeriesFileText = (series) =>
  `${JSON.stringify(serializeBriefingSeries(series), null, 2)}\n`;

const refused = (message) => Object.freeze({ ok: false, entries: null, message });

/**
 * Parse and validate a chosen file. PURE: no storage, no DOM, no clock.
 *
 * @param text the file's text.
 * @param fileBytes the chooser's own byte count when it has one, so an oversized
 *   file is refused on its declared size rather than after being read.
 * @returns `{ ok, entries, message }` — entries in read shape when ok, and a
 *   sentence naming the actual reason when not.
 */
export function parseBriefingSeriesFile(text, fileBytes = null) {
  const source = typeof text === "string" ? text : "";
  const bytes = Number.isFinite(fileBytes) ? Number(fileBytes) : byteLengthOf(source);
  if (bytes > SERIES_FILE_MAX_BYTES) return refused(SERIES_FILE_COPY.oversized(bytes));
  let file;
  try {
    file = JSON.parse(source);
  } catch {
    return refused(SERIES_FILE_COPY.unparseable);
  }
  if (!file || typeof file !== "object" || Array.isArray(file)) {
    return refused(SERIES_FILE_COPY.notARecord);
  }
  const version = file.schemaVersion;
  if (!Number.isInteger(version)) return refused(SERIES_FILE_COPY.noSchemaVersion);
  if (version > SERIES_FILE_SCHEMA_VERSION) return refused(SERIES_FILE_COPY.newerSchema(version));
  if (version !== SERIES_FILE_SCHEMA_VERSION) {
    return refused(SERIES_FILE_COPY.unknownSchema(version));
  }
  if (!Array.isArray(file.periods)) return refused(SERIES_FILE_COPY.noPeriods);
  const entries = [];
  for (const [index, record] of file.periods.entries()) {
    const entry = entryOf(record);
    // One malformed row refuses the WHOLE file. A partial import would leave a
    // reader holding a series they cannot tell is incomplete.
    if (!entry) return refused(SERIES_FILE_COPY.malformedPeriod(index + 1));
    entries.push(entry);
  }
  return Object.freeze({ ok: true, entries: chronological(entries), message: null });
}

/**
 * Merge a file into this browser's series, in ONE write.
 *
 * MERGE, NOT REPLACE, and keyed exactly as `recordBriefingSeriesEntry` keys:
 * period plus provider scope. A file's April lands beside a June already here,
 * and a file's June REPLACES a June already here — the same rule #1089 and
 * #1095 settled for a second import, because a file is a second import.
 *
 * @returns `{ ok, series, message }`. On refusal `series` is null and storage
 *   was never touched; the caller repaints nothing and says the message.
 */
export function importBriefingSeries(storage, text, fileBytes = null) {
  const file = parseBriefingSeriesFile(text, fileBytes);
  if (!file.ok) return Object.freeze({ ok: false, series: null, message: file.message });
  const held = readBriefingSeries(storage);
  const incoming = new Set(file.entries.map((entry) => `${entry.period} ${entry.scope}`));
  const kept = held.filter((entry) => !incoming.has(`${entry.period} ${entry.scope}`));
  const merged = chronological([...kept, ...file.entries]);
  if (!writeSeries(storage, merged)) {
    return Object.freeze({ ok: false, series: held, message: SERIES_FILE_COPY.writeRefused });
  }
  return Object.freeze({
    ok: true,
    series: merged,
    message: SERIES_FILE_COPY.imported(file.entries.length,
      briefingSeriesSummary(merged).count),
  });
}

/**
 * Is this browser holding a series record this build cannot read?
 *
 * `readBriefingSeries` answers a corrupt record with an empty series, which is
 * the right thing to RENDER and the wrong thing to say nothing about: a reader
 * whose periods vanished needs to know they were there. Read-only.
 */
export function briefingSeriesUnreadable(storage) {
  let raw = null;
  try {
    raw = storage?.getItem(BRIEFING_SERIES_KEY) ?? null;
  } catch {
    return false;
  }
  if (raw === null) return false;
  try {
    return !seriesRecord(JSON.parse(raw));
  } catch {
    return true;
  }
}
