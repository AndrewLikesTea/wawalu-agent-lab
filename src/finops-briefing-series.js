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
import { canonicalPeriod, formatUsd, monthLabel } from "./finops-imported-period-series.js";

/** One literal, shared by the page, the migration and the tests. */
export const BRIEFING_SERIES_KEY = "shiplog.finops.briefing.series.v1";

/** Top-level on the record, beside `entries` — never inside an entry. */
export const BRIEFING_SERIES_VERSION = 1;

// ---------------------------------------------------------------------------
// WHAT A PERIOD FIGURE IS: A DECLARATION, OR A BILL (#1106)
// ---------------------------------------------------------------------------
//
// A reader who has imported nothing can still say what they spend, and #1103
// turns those declared facts into a position. That position is worth keeping —
// it is what a later real import gets SCORED AGAINST — and it is not a
// measurement. So every entry carries an explicit `basis` rather than an
// implicit flag or an inferred-from-missing-field convention: an entry says
// which of the two it is, in a field, and an entry that says nothing is
// `imported`, because every entry written before this change was.
//
// AN ESTIMATE IS NEVER DELETED BY THE IMPORT THAT PROVES IT WRONG. When a
// provider's own figure lands on a period an estimate already covers, the
// estimate is RETAINED and marked superseded — `supersededBy` naming the entry
// that took over — so the miss can be stated. Overwriting it would erase the
// only record of what was predicted.
//
// ONE SELECTION RULE, NAMED ONCE: `realizedSeriesEntries`. Everything presented
// as realized — aggregates, movement, the commitment verdict — filters through
// it at its boundary, so a `basis` check is never scattered across call sites
// and a new consumer cannot forget one.

/** The two bases. Exhaustive: an entry is one or the other, never neither. */
export const ENTRY_BASIS = Object.freeze({
  estimated: "estimated",
  imported: "imported",
});

/** The scope an estimated entry is filed under. No provider billed it. */
export const ESTIMATED_SCOPE = "estimated";

/** What an estimated entry names as its source, where a provider name would be. */
export const ESTIMATED_PROVIDER_NAME = "Your declared facts";

const EMPTY = Object.freeze([]);

const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
const text = (value) => (typeof value === "string" && value.trim() ? value : null);
const round = (value) => Math.round(value * 100) / 100;

/** Period plus provider scope: the key #1089 settled on, written down once. */
export const seriesEntryKey = (entry) => `${entry.period} ${entry.scope}`;

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
 *   supersededBy    the key of the entry that took over, or null
 *
 * Null when the entry has no period, no capture instant or no spend figure: a
 * row that cannot say which month it is or what it cost is not a partial row.
 *
 * `basis` DEFAULTS TO `imported` for any value that is not exactly `estimated`,
 * which is what lets a file written before #1106 — and a record already in a
 * reader's browser — load unchanged and mean what it always meant.
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
    basis: fields?.basis === ENTRY_BASIS.estimated
      ? ENTRY_BASIS.estimated : ENTRY_BASIS.imported,
    supersededBy: text(fields?.supersededBy),
  });
}

/**
 * SUPERSESSION, RECOMPUTED ON EVERY PASS rather than trusted from what was read.
 *
 * A stored or imported `supersededBy` is a claim about a relationship BETWEEN
 * two entries, and the other half of it can be deleted, replaced or arrive
 * later. Deriving it here from the series as it now stands means the link is
 * true of the series a reader is actually holding: an estimate whose import was
 * forgotten goes back to live, and an estimate that meets an import for its
 * month is marked without anybody having to remember to mark it.
 *
 * Only an ESTIMATE is ever superseded. An imported figure is not overridden by
 * anything this page holds.
 */
function resolved(entries) {
  const importedFor = new Map();
  for (const entry of entries) {
    if (entry.basis === ENTRY_BASIS.imported && !importedFor.has(entry.period)) {
      importedFor.set(entry.period, seriesEntryKey(entry));
    }
  }
  return entries.map((entry) => {
    const supersededBy = entry.basis === ENTRY_BASIS.estimated
      ? importedFor.get(entry.period) ?? null
      : null;
    return supersededBy === entry.supersededBy
      ? entry : Object.freeze({ ...entry, supersededBy });
  });
}

/**
 * THE ONE SELECTION RULE. Every figure this product presents as REALIZED is
 * computed from what this returns and from nothing else.
 *
 * A verified figure takes precedence by construction: an estimate is dropped
 * here whether or not an import superseded it, so no consumer ever has to
 * decide between the two and no consumer can decide differently from another.
 *
 * IT DROPS `estimated` RATHER THAN KEEPING `imported`, which is the same
 * absent-means-imported default `entryOf` holds: a caller handing over an entry
 * shape from before #1106 gets it back, and only a thing that SAYS it is a
 * declaration is withheld. A typo in the discriminator therefore fails towards
 * counting a real figure rather than silently emptying a reader's record.
 *
 * @returns a frozen array in the same order, holding no estimated entry.
 */
export function realizedSeriesEntries(series) {
  return Object.freeze((Array.isArray(series) ? series : [])
    .filter((entry) => entry && entry.basis !== ENTRY_BASIS.estimated));
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
const chronological = (entries) => Object.freeze(resolved([...entries]
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
  const entry = briefingSeriesEntry(payload);
  const held = readBriefingSeries(storage);
  if (!entry) return held;
  const kept = held.filter((other) =>
    other.period !== entry.period || other.scope !== entry.scope);
  return persist(storage, chronological([...kept, entry]));
}

/**
 * Put an ESTIMATED period on the record, from facts the reader declared (#1106).
 *
 * It lands beside whatever is already on file rather than instead of it: the
 * estimate is filed under its own scope, so an imported figure for the same
 * month is a second entry and not a replacement, and `resolved` above marks
 * this one superseded the moment that import arrives. Re-declaring the same
 * month replaces the earlier estimate, which is the same rule a re-import
 * follows for an imported month.
 *
 * NO CLOCK IS READ HERE. The caller supplies `capturedAt`, and the period is
 * parsed off whatever period-shaped string it hands over — an ISO instant
 * included — so this module stays a pure function of its arguments.
 *
 * @returns the persisted series, in read shape.
 */
export function recordEstimatedPeriod(storage, facts = {}) {
  const entry = entryOf({
    period: facts?.period,
    capturedAt: facts?.capturedAt,
    spendUsd: facts?.spendUsd,
    recoverableUsd: facts?.recoverableUsd,
    confidence: facts?.confidence,
    scope: ESTIMATED_SCOPE,
    providerName: ESTIMATED_PROVIDER_NAME,
    basis: ENTRY_BASIS.estimated,
  });
  const held = readBriefingSeries(storage);
  if (!entry) return held;
  const kept = held.filter((other) => seriesEntryKey(other) !== seriesEntryKey(entry));
  return persist(storage, chronological([...kept, entry]));
}

/**
 * WHERE THE ESTIMATE LANDED, once the provider's own figure arrived (#1106).
 *
 * Scored only for a period holding BOTH: an estimate with no import is a
 * prediction nobody has checked, and an import with no estimate was never
 * predicted. The imported side is SUMMED across providers, because two
 * providers billing one month are that month's spend — the same rule
 * `mergePeriodSeries` states — and the estimate was a claim about the month.
 *
 * The sentence is prepared here, in the model, so the surface renders a string
 * and decides nothing about direction, rounding or wording.
 *
 * @returns a frozen array, oldest period first, of
 *   `{ period, periodLabel, estimatedUsd, importedUsd, deltaUsd, percent,
 *      direction, sentence }`. `percent` is null when the imported figure is
 *   zero — a share of nothing is not a number this page prints.
 */
export function estimateAccuracy(series) {
  const entries = (Array.isArray(series) ? series : []).filter(Boolean);
  const estimated = new Map();
  const imported = new Map();
  for (const entry of entries) {
    if (entry.basis === ENTRY_BASIS.estimated) estimated.set(entry.period, entry.spendUsd);
    else imported.set(entry.period, (imported.get(entry.period) ?? 0) + entry.spendUsd);
  }
  const scored = [];
  for (const period of [...estimated.keys()].sort()) {
    if (!imported.has(period)) continue;
    const estimatedUsd = round(estimated.get(period));
    const importedUsd = round(imported.get(period));
    const deltaUsd = round(estimatedUsd - importedUsd);
    const percent = importedUsd === 0
      ? null : Math.round((Math.abs(deltaUsd) / importedUsd) * 100);
    const periodLabel = monthLabel(period) ?? period;
    const direction = deltaUsd === 0 ? "matched" : deltaUsd < 0 ? "below" : "above";
    const share = percent === null ? "" : ` (${percent}%)`;
    scored.push(Object.freeze({
      period,
      periodLabel,
      estimatedUsd,
      importedUsd,
      deltaUsd,
      percent,
      direction,
      sentence: direction === "matched"
        ? `Your estimate matched the imported figure for ${periodLabel}, at `
          + `${formatUsd(importedUsd)}.`
        : `Your estimate was ${formatUsd(Math.abs(deltaUsd))}${share} ${direction} the imported `
          + `figure for ${periodLabel} — ${formatUsd(estimatedUsd)} against `
          + `${formatUsd(importedUsd)}.`,
    }));
  }
  return Object.freeze(scored);
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
// INPUTS ONLY. The file carries the same seven fields an entry holds. The count,
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
 *
 * THE SCHEMA VERSION DID NOT MOVE FOR #1106, and the two fields it added are
 * written ONLY WHEN THEY CARRY INFORMATION: `basis` when the entry is an
 * estimate, `supersededBy` when a link exists. A reader who has only ever had
 * imported periods therefore exports the same seven fields per period they
 * always did, byte for byte, and format 1 still means what it meant. The
 * absent-means-imported default on the way back in is what closes the loop.
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
