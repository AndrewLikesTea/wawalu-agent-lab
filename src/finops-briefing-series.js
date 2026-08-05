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
const round = (value) => Math.round(value * 100) / 100;

// ---------------------------------------------------------------------------
// WHAT AN ENTRY'S FIGURE STANDS ON (#1106)
// ---------------------------------------------------------------------------
//
// Two bases, and no third. `verified` is a month read out of a provider export
// this browser imported. `estimated` is a month a reader derived from declared
// facts before any file arrived — kept here, on the record, so that when the
// real import for that month lands the page can say how far the estimate was
// off instead of quietly replacing it.
//
// A MISSING BASIS IS VERIFIED, and a verified entry writes no basis field at
// all. Every entry written before this discriminator existed came out of an
// import, so the absent field IS the migration: nothing stored is rewritten, a
// browser holding only imports exports the same bytes it did yesterday, and an
// older export imports as fully verified because that is what it is. Read the
// basis through `basisOf` and the realized set through `realizedSeries`.

export const ENTRY_BASIS = Object.freeze({ verified: "verified", estimated: "estimated" });

/**
 * The reserved scope every estimated entry is filed under.
 *
 * The series key is period plus scope, so ONE reserved scope is what makes "at
 * most one estimate per period" fall out of the keying already in place rather
 * than out of a second rule beside it. A period may still hold one verified
 * entry per provider: two providers billing one month were two entries before
 * #1106 and still are.
 */
export const ESTIMATE_SCOPE = "estimate";

/** The provider name an estimate carries, so every row it appears in says so. */
export const ESTIMATE_PROVIDER_NAME = "Estimated from declared facts";

/** The basis of any entry, including one stored before the field existed. */
export const basisOf = (entry) =>
  (entry?.basis === ENTRY_BASIS.estimated ? ENTRY_BASIS.estimated : ENTRY_BASIS.verified);

/** THE ONE TEST for "is this figure a measurement". */
export const isRealizedEntry = (entry) => basisOf(entry) === ENTRY_BASIS.verified;

/**
 * ONLY THE REALIZED ENTRIES. Every figure a surface presents as measured — an
 * aggregate, a movement, a commitment verdict — is computed from this and from
 * nothing else, so no consumer has to carry its own basis test.
 */
export const realizedSeries = (series) =>
  Object.freeze((Array.isArray(series) ? series : []).filter(isRealizedEntry));

/**
 * The declared facts an estimate was derived from, allowlisted field by field.
 *
 * Kept with the entry rather than referenced by an id: the delta sentence has
 * to be explainable from the record alone, long after the tab that produced it
 * closed, and a reference into a store that does not exist is not a linkage.
 *
 * FIVE KEYS, AND NOTHING A READER TYPED. The three numbers are read as numbers
 * and the two cohort attributes only as a bounded enumeration token — lower
 * case, underscores, 32 characters. The estimator has already matched them
 * against the published tables; the check here is against a hand-edited FILE,
 * and it is a shape check rather than a table lookup on purpose, so this store
 * does not drag the cohort tables into the page's initial payload to validate
 * two words.
 */
const ENUM_TOKEN = /^[a-z][a-z_]{0,31}$/;

function declaredFactsOf(facts) {
  if (!facts || typeof facts !== "object" || Array.isArray(facts)) return null;
  const kept = {};
  for (const key of ["monthlySpendUsd", "engineers"]) {
    const value = number(facts[key]);
    if (value !== null) kept[key] = value;
  }
  const mix = {};
  for (const tier of ["frontier", "standard", "economy"]) {
    const share = number(facts.providerMix?.[tier]);
    if (share !== null) mix[tier] = share;
  }
  if (Object.keys(mix).length === 3) kept.providerMix = Object.freeze(mix);
  for (const key of ["sizeBand", "industry"]) {
    if (typeof facts[key] === "string" && ENUM_TOKEN.test(facts[key])) kept[key] = facts[key];
  }
  return Object.keys(kept).length > 0 ? Object.freeze(kept) : null;
}

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
  const estimated = fields?.basis === ENTRY_BASIS.estimated;
  const entry = {
    period,
    scope: estimated ? ESTIMATE_SCOPE : text(fields?.scope) ?? "unknown",
    providerName: estimated ? ESTIMATE_PROVIDER_NAME
      : text(fields?.providerName) ?? "Unnamed provider",
    capturedAt,
    spendUsd,
    recoverableUsd: number(fields?.recoverableUsd) ?? 0,
    confidence: text(fields?.confidence) ?? "Low",
  };
  // Three more fields, on an estimated entry ONLY. A verified entry keeps the
  // exact seven-field shape it has always had, which is what lets a browser
  // holding nothing but imports carry on reading and writing as if #1106 never
  // landed. See the basis note above.
  if (!estimated) return Object.freeze(entry);
  return Object.freeze({
    ...entry,
    basis: ENTRY_BASIS.estimated,
    superseded: fields?.superseded === true,
    declaredFacts: declaredFactsOf(fields?.declaredFacts),
  });
}

/**
 * THE SUPERSESSION RULE, applied to the whole series at once.
 *
 * An estimate for a period that also holds a verified entry is superseded: the
 * import is the answer for that month now, and the estimate stays on the record
 * beside it as the thing that was superseded rather than being deleted or
 * overwritten. Two properties make a repeat import safe — the rule is a
 * function of the series' own state, so re-running it changes nothing and no
 * entry is added; and the mark is MONOTONE, so a mark that arrived in an
 * imported file survives a merge that does not carry its verified counterpart.
 */
function withSupersession(entries) {
  const verified = new Set(entries.filter(isRealizedEntry).map((entry) => entry.period));
  return entries.map((entry) => {
    if (isRealizedEntry(entry)) return entry;
    const superseded = entry.superseded === true || verified.has(entry.period);
    return superseded === entry.superseded ? entry : entryOf({ ...entry, superseded });
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

/**
 * THE READ SHAPE OF A WHOLE SERIES: supersession settled, then ordered.
 *
 * Every path that produces a series — a load, a capture, a parsed file, a merge
 * — ends here, so the rule above is applied in exactly one place and no caller
 * can hold a series it was not applied to.
 */
const settled = (entries) => chronological(withSupersession(entries));

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
    return settled(stored.entries.map(entryOf).filter(Boolean));
  }
  const migrated = briefingSeriesEntry(parsed(storage, BRIEFING_RETENTION_KEY));
  if (!migrated) return EMPTY;
  return persist(storage, settled([migrated]));
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
 * The one upsert. Keyed by period plus scope, settled once, written once.
 *
 * A verified entry landing on a period that already holds an estimate marks
 * that estimate superseded through `settled` rather than through a rule of its
 * own here — which is why importing the same month twice neither stacks entries
 * nor double-marks anything.
 */
function upsert(storage, entry) {
  const held = readBriefingSeries(storage);
  if (!entry) return held;
  const kept = held.filter((other) =>
    other.period !== entry.period || other.scope !== entry.scope);
  return persist(storage, settled([...kept, entry]));
}

/**
 * KEEP AN ESTIMATE ON THE RECORD, in the same series as the imported months.
 *
 * @param estimate a result from `estimateFromDeclaredFacts`.
 * @param period the calendar month the estimate is FOR, and `capturedAt` the
 *   instant it was made — both supplied by the caller, because this module
 *   reads no clock.
 * @returns the persisted series, in read shape. An estimate with no figure in
 *   it writes nothing: a withheld estimate is not a period.
 */
export const recordEstimatedPeriod = (storage, estimate, when) =>
  upsert(storage, estimatedSeriesEntry(estimate, when));

/**
 * The series entry an estimate stands for.
 *
 * The estimator's own `provenance` word and this module's `estimated` basis are
 * the same string on purpose: an estimate is the only thing that can produce an
 * estimated entry, and one vocabulary for it means no mapping table can drift.
 */
export function estimatedSeriesEntry(estimate, { period, capturedAt } = {}) {
  if (estimate?.provenance !== ENTRY_BASIS.estimated) return null;
  if (!estimate?.costPerSuccessfulTask?.available) return null;
  const recoverable = estimate.recoverableMonthlyUsd;
  return entryOf({
    period,
    capturedAt,
    basis: ENTRY_BASIS.estimated,
    spendUsd: estimate.inputs?.monthlySpendUsd,
    // The conservative end of the modelled range, never its midpoint: this
    // column is read beside realized savings, and an estimate should not be the
    // optimistic number in that comparison.
    recoverableUsd: recoverable?.available ? recoverable.low : 0,
    confidence: estimate.confidence?.tier,
    declaredFacts: estimate.inputs,
  });
}

/** The three words the delta sentence is built on. */
export const ESTIMATE_MISS = Object.freeze({
  under: "under", over: "over", exact: "exact",
});

/**
 * WHERE AN ESTIMATE MET ITS IMPORT: one comparison per period holding both.
 *
 * Derived on every read from the two durable entries, never stored beside them:
 * a kept delta is a third number that can disagree with the two it came from.
 * The verified side is summed across providers, the same rule every other
 * figure for a period follows.
 *
 * @returns frozen `[{ period, estimatedUsd, verifiedUsd, deltaUsd, direction }]`
 *   oldest first, where `direction` is `under` when the estimate was below what
 *   the import turned out to be.
 */
export function estimateComparisons(series) {
  const entries = (Array.isArray(series) ? series : []).filter(Boolean);
  const comparisons = [];
  for (const estimate of entries.filter((entry) => !isRealizedEntry(entry))) {
    const realized = entries.filter((entry) =>
      isRealizedEntry(entry) && entry.period === estimate.period);
    if (realized.length === 0) continue;
    const verifiedUsd = round(realized.reduce((sum, entry) => sum + entry.spendUsd, 0));
    const deltaUsd = round(estimate.spendUsd - verifiedUsd);
    comparisons.push(Object.freeze({
      period: estimate.period,
      estimatedUsd: estimate.spendUsd,
      verifiedUsd,
      deltaUsd,
      direction: deltaUsd < 0 ? ESTIMATE_MISS.under
        : deltaUsd > 0 ? ESTIMATE_MISS.over : ESTIMATE_MISS.exact,
    }));
  }
  return Object.freeze(comparisons
    .sort((left, right) => left.period.localeCompare(right.period)));
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
 */
export function serializeBriefingSeries(series) {
  return {
    schemaVersion: SERIES_FILE_SCHEMA_VERSION,
    periods: (Array.isArray(series) ? series : []).filter(Boolean).map((entry) => ({
      period: entry.period,
      scope: entry.scope,
      providerName: entry.providerName,
      capturedAt: entry.capturedAt,
      spendUsd: entry.spendUsd,
      recoverableUsd: entry.recoverableUsd,
      confidence: entry.confidence,
      // AN ESTIMATED PERIOD CARRIES THREE MORE FIELDS; a verified one carries
      // none of them. The schema version is unchanged for exactly that reason:
      // no file that was interpretable stopped being so, and one with no basis
      // field anywhere is a fully verified series — which is what it always was.
      ...(isRealizedEntry(entry) ? {} : {
        basis: ENTRY_BASIS.estimated,
        superseded: entry.superseded === true,
        declaredFacts: entry.declaredFacts,
      }),
    })),
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
  return Object.freeze({ ok: true, entries: settled(entries), message: null });
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
  const merged = settled([...kept, ...file.entries]);
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
