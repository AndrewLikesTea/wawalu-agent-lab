// The personal AI-history reader: your own export in, one prioritized move out,
// your prompts nowhere.
//
// This is the consumer half of `personal-history-contract.js`. Every floor,
// reason code, metric definition, and field list it uses is declared there and
// imported here; nothing in this file re-derives a published number, so a reader
// disputing a figure reads one document and a change to a threshold moves one
// constant.
//
// HOW A PROMPT LIVES AND DIES, as implemented rather than promised:
//
//   1. `extractEntries` builds a local array of `{ date, text }` from the file.
//      That array is a function-local; nothing this module returns can reach it.
//   2. Each entry's text is handed to `gradeMyPrompt` as an argument. The graded
//      result carries counts, this repository's own move identifiers, and static
//      authored copy — never an echo of the input.
//   3. The aggregate is built from the move identifiers alone, the entry array
//      goes out of scope on return, and no key on a report could hold prompt text
//      anyway: `PERSONAL_REPORT_FIELDS` is closed and `FORBIDDEN_REPORT_KEYS` is
//      walked by the contract's validator.
//
// ATTACHMENTS ARE COUNTED, NEVER OPENED. A non-string part or an `attachments`
// entry increments one integer; no filename, MIME type, byte length, or content
// is read. An entry carrying only attachments is not a prompt entry at all —
// counting it as one would put an unreadable row in the coverage denominator and
// make the honest figure look worse than the truth.
//
// DETERMINISM. Pure and synchronous: no clock, no randomness, no network, no
// storage, no mutation of the caller's input. The same export read twice
// produces a byte-identical report.

import { readDelimitedText } from "./delimited-text.js";
import { gradeMyPrompt } from "./prompt-coaching.js";
import {
  FORBIDDEN_REPORT_KEYS, PERSONAL_BASIS, PERSONAL_BOUNDARY, PERSONAL_CONFIDENCE_NONE,
  PERSONAL_CONFIDENCE_TIERS, PERSONAL_COVERAGE_FLOOR, PERSONAL_COVERAGE_IDENTITY,
  PERSONAL_ELIGIBILITY, PERSONAL_EXPORT_PATH_RULE, PERSONAL_EXPORT_SHAPES,
  PERSONAL_HISTORY_QUESTION, PERSONAL_HISTORY_VERSION, PERSONAL_NOT_ELIGIBLE,
  PERSONAL_NOT_ELIGIBLE_RULE, PERSONAL_READER_LIMITS, PERSONAL_REPORT_STATE,
  PERSONAL_REPORT_STATES, PERSONAL_SAMPLING,
} from "./personal-history-contract.js";

const SHAPE = Object.fromEntries(PERSONAL_EXPORT_SHAPES.map((shape) => [shape.id, shape]));
const JSON_SHAPE = SHAPE["personal-conversation-json"];
const TABLE_SHAPE = SHAPE["personal-prompt-table"];

/** The roles whose messages are read. Everything else is not a prompt entry. */
const READER_ROLES = new Set(["user", "human", "you", "me"]);

/** Decimals on the two published ratios. Rounded once, and the tier reads the rounded value. */
const RATIO_DECIMALS = 3;
const POINT_DECIMALS = 2;

const roundTo = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

// ---------------------------------------------------------------------------
// Reading a declared path
// ---------------------------------------------------------------------------

/**
 * Segments of every path this contract declares, resolved once at load.
 *
 * Built from the contract rather than from a caller's string, which is the first
 * half of the allowlist: a path that is not a key in this map has no segments
 * here to walk, so there is nothing for the accessor to resolve it with.
 */
const DECLARED_PATH_LISTS = new Set(PERSONAL_EXPORT_SHAPES.flatMap((shape) => [
  shape.conversationPaths, shape.messagePaths, shape.rolePaths, shape.attachmentPaths,
  shape.dateFields, shape.textFields,
].filter(Boolean)));
const DECLARED_SEGMENTS = new Map([...DECLARED_PATH_LISTS].flatMap((paths) => paths.map(
  (path) => [path, Object.freeze(path.split(PERSONAL_EXPORT_PATH_RULE.separator))])));

/** A plain object: something a path may be walked *through*. Arrays are not. */
const isRecord = (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

/**
 * The one way anything in this module reads a field out of an export.
 *
 * WHY THERE IS EXACTLY ONE. A parser that reaches nested export fields with
 * hand-written `?.` chains is a parser whose real allowlist is its own source
 * code: every new spelling adds an expression that indexes a place nobody
 * declared, and the boundary this product publishes stops being checkable. This
 * accessor is the whole of the reader's access to a parsed export, so "what can
 * this product read out of your file" is answered by the path lists in
 * personal-history-contract.js and by nothing else.
 *
 * TWO CHECKS, BOTH LOAD-BEARING. `declared` is the allowlist for this call site
 * — a role path is not resolvable where a date is being read — and
 * `DECLARED_SEGMENTS` is the allowlist for the contract as a whole, so a caller
 * cannot invent a path by passing a list of its own. A path failing either check
 * resolves to undefined and the export is not touched.
 *
 * Only own keys of plain objects are walked, per `PERSONAL_EXPORT_PATH_RULE`: an
 * array or a string part-way along a path ends the resolution, and an inherited
 * key never resolves at all, so a file carrying `__proto__` or `constructor` in
 * a declared path gets nothing rather than something off the prototype chain.
 *
 * @param {unknown} source a parsed value from the export.
 * @param {string} path the path to resolve.
 * @param {ReadonlyArray<string>} declared the paths this call site may resolve.
 * @returns {unknown} the value at that path, or undefined.
 */
export function readDeclaredExportPath(source, path, declared) {
  if (!DECLARED_PATH_LISTS.has(declared) || !declared.includes(path)) return undefined;
  const segments = DECLARED_SEGMENTS.get(path);
  if (!segments) return undefined;
  let value = source;
  for (const segment of segments) {
    if (!isRecord(value) || !Object.hasOwn(value, segment)) return undefined;
    value = value[segment];
  }
  return value;
}

/**
 * The first declared path whose value the caller accepts, or undefined. The
 * ordinary way to read one field that an export may spell several ways.
 */
function readFirstDeclared(source, declared, accept) {
  for (const path of declared) {
    const value = readDeclaredExportPath(source, path, declared);
    if (accept(value)) return value;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Reading a date
// ---------------------------------------------------------------------------

/**
 * The whole of a value, or nothing: a complete ISO 8601 calendar date, or a
 * complete date-time whose time is `hh:mm`, `hh:mm:ss`, or `hh:mm:ss.sss`, with
 * an optional `Z` or `±hh:mm` offset. `YYYY/MM/DD` is the same date with the
 * other separator and is spelled here rather than parsed leniently.
 *
 * ANCHORED AT BOTH ENDS ON PURPOSE. A prefix match reads `2026-05-01not-a-date`
 * as the first of May, which is a date this reader invented out of a field the
 * export did not fill in correctly. A malformed field is a counted drop and,
 * where the record carries a second date field or sits in a dated conversation,
 * it falls back to that real date — see `firstDate` and the JSON shape's
 * `dateFallback`. Guessing at a partly-typed value is the one outcome that puts
 * a day in a report with nothing behind it.
 */
const PERSONAL_DATE_PATTERN =
  /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

const PERSONAL_EPOCH_PATTERN = /^\d{9,14}(\.\d+)?$/;

/**
 * One value to a UTC calendar date, or null.
 *
 * DELIBERATELY NARROW. Accepted: the complete spellings above and an epoch
 * number. Not accepted: `03/04/2026`, which is two different days depending on
 * where the reader lives; every other locale format a permissive parser would
 * silently pick a hemisphere for; and any value carrying anything else before or
 * after the date. An unparseable date is a counted drop, which is a smaller harm
 * than a confidently wrong day. An epoch number under 1e11 is read as seconds
 * and at or above it as milliseconds — that crossover is the year 5138 in
 * seconds and 1973 in milliseconds, so no plausible export is on the wrong side
 * of it.
 *
 * The clock and the offset are read only to establish that the value is a
 * well-formed instant and are then discarded: the calendar date is the one
 * written in the value, because nothing this report answers depends on the hour
 * and an hour is a fingerprint.
 */
export function personalHistoryDate(value) {
  if (typeof value === "number" || (typeof value === "string" && PERSONAL_EPOCH_PATTERN.test(value.trim()))) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    const stamp = new Date(number < 1e11 ? number * 1000 : number);
    return Number.isNaN(stamp.getTime()) ? null : stamp.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  const match = value.trim().match(PERSONAL_DATE_PATTERN);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  // A time out of range makes the whole value malformed. Keeping its date would
  // be reading a day out of a field the export demonstrably filled in wrong.
  if (hour !== undefined && (Number(hour) > 23 || Number(minute) > 59 || Number(second ?? 0) > 60)) return null;
  const stamp = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (Number.isNaN(stamp.getTime())) return null;
  // Round-trip so 2026-02-31 is rejected rather than rolled into March.
  return stamp.toISOString().slice(0, 10) === `${year}-${month}-${day}` ? `${year}-${month}-${day}` : null;
}

/**
 * The first declared date path on a record that reads as a calendar date, or
 * null. A declared path carrying a malformed value is not a date and does not
 * stop the search: the record's other declared path, or its conversation's, is a
 * real date and this one is a field the export filled in wrong.
 */
function firstDate(source, declared) {
  for (const path of declared) {
    const date = personalHistoryDate(readDeclaredExportPath(source, path, declared));
    if (date) return date;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Detecting the shape
// ---------------------------------------------------------------------------

const normalizeHeader = (name) => String(name ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");

function locateColumn(header, candidates) {
  const index = header.map(normalizeHeader);
  for (const candidate of candidates) {
    const at = index.indexOf(candidate);
    if (at !== -1) return at;
  }
  return -1;
}

/** The messages of one conversation record: the first declared path that is an array. */
function messagesOf(conversation) {
  return readFirstDeclared(conversation, JSON_SHAPE.messagePaths, Array.isArray) ?? null;
}

function readJsonShape(text) {
  let root = null;
  try {
    root = JSON.parse(text);
  } catch {
    return null;
  }
  // A top-level array is the shape with nothing to name; every other spelling is
  // a declared record path and is resolved as one.
  const conversations = Array.isArray(root) ? root
    : readFirstDeclared(root, JSON_SHAPE.conversationPaths, Array.isArray) ?? null;
  if (!conversations) return null;
  // An empty array is this shape carrying nothing, which is a different answer
  // from "not this shape" and gets the reason code that says so.
  if (conversations.length && !conversations.some((entry) => messagesOf(entry))) return null;
  return conversations;
}

function readTableShape(text) {
  const reading = readDelimitedText(text);
  if (!reading.ok) return null;
  const dateColumn = locateColumn(reading.header, TABLE_SHAPE.dateFields);
  const promptColumn = locateColumn(reading.header, TABLE_SHAPE.textFields);
  if (dateColumn === -1 || promptColumn === -1) return null;
  return { reading, dateColumn, promptColumn };
}

/**
 * Which supported shape this text is, or null.
 *
 * The executable form of the `detect` sentences in `PERSONAL_EXPORT_SHAPES`.
 * JSON is tried first because a JSON file that fell through to the delimited
 * reader would be scored as a one-column table and reported as the wrong shape.
 */
export function detectPersonalExportShape(text) {
  if (typeof text !== "string") return null;
  if (readJsonShape(text)) return JSON_SHAPE.id;
  return readTableShape(text) ? TABLE_SHAPE.id : null;
}

// ---------------------------------------------------------------------------
// Extracting prompt entries
// ---------------------------------------------------------------------------

/**
 * The text and attachment count of one JSON message, read from declared paths
 * and nowhere else. Attachments are counted, never read: an attachment path
 * contributes its array's length and a non-string part contributes one, and no
 * filename, MIME type, or byte length is looked at on the way.
 *
 * A nested spelling such as `content.parts` is a declared path like any other
 * rather than a branch that reaches into `content` — which is what makes "this
 * reader opens the fields on that list" a statement about the contract instead
 * of about this function.
 */
function messageBody(message) {
  let attachments = 0;
  for (const path of JSON_SHAPE.attachmentPaths) {
    const value = readDeclaredExportPath(message, path, JSON_SHAPE.attachmentPaths);
    if (Array.isArray(value)) attachments += value.length;
  }
  const strings = [];
  for (const path of JSON_SHAPE.textFields) {
    const value = readDeclaredExportPath(message, path, JSON_SHAPE.textFields);
    if (typeof value === "string") strings.push(value);
    else if (Array.isArray(value)) {
      for (const part of value) {
        if (typeof part === "string") strings.push(part);
        else attachments += 1;
      }
    }
  }
  return { text: strings.join("\n"), attachments };
}

/** The role a message is attributed to, from a declared path. Unattributed reads as "". */
function roleOf(message) {
  const role = readFirstDeclared(message, JSON_SHAPE.rolePaths, (value) => typeof value === "string");
  return (role ?? "").trim().toLowerCase();
}

/**
 * The file to a local list of `{ date, text }`, plus the attachment count.
 *
 * The returned array is consumed by `buildPersonalHistoryReport` and never
 * escapes it. It is the one place prompt text exists in this module.
 */
function extractEntries(shapeId, text) {
  const entries = [];
  let attachments = 0;

  if (shapeId === JSON_SHAPE.id) {
    for (const conversation of readJsonShape(text) ?? []) {
      // A record carrying no declared messages path is not a conversation this
      // reader recognizes. It is skipped whole rather than searched for
      // something message-shaped somewhere inside it.
      const messages = messagesOf(conversation);
      if (!messages) continue;
      const conversationDate = firstDate(conversation, JSON_SHAPE.dateFields);
      for (const message of messages) {
        if (!READER_ROLES.has(roleOf(message))) continue;
        const body = messageBody(message);
        attachments += body.attachments;
        // An entry carrying only attachments is not a prompt entry: there is no
        // prompt in it to have read, so it belongs in neither the numerator nor
        // the denominator of coverage.
        if (!body.text.trim() && body.attachments) continue;
        entries.push({ date: firstDate(message, JSON_SHAPE.dateFields) ?? conversationDate, text: body.text });
      }
    }
    return { entries, attachments };
  }

  const table = readTableShape(text);
  for (const row of table?.reading.rows ?? []) {
    entries.push({
      date: personalHistoryDate(row.values[table.dateColumn]),
      text: String(row.values[table.promptColumn] ?? ""),
    });
  }
  return { entries, attachments };
}

// ---------------------------------------------------------------------------
// Ranking the moves
// ---------------------------------------------------------------------------

/**
 * Accumulate every move the rubric found available across the scored prompts,
 * then rank them by `PERSONAL_RANKING_RULE`.
 *
 * `points` is summed unrounded and rounded once at the end, so the published
 * figure is the sum rather than a sum of roundings.
 */
function rankMoves(candidatesByPrompt) {
  const tally = new Map();
  for (const candidates of candidatesByPrompt) {
    for (const candidate of candidates) {
      const move = tally.get(candidate.id) ?? {
        id: candidate.id,
        kind: candidate.kind,
        axis: candidate.axis,
        title: candidate.title,
        guidance: candidate.guidance,
        rewrite: candidate.rewrite,
        promptsAffected: 0,
        points: 0,
      };
      move.promptsAffected += 1;
      move.points += candidate.points;
      tally.set(candidate.id, move);
    }
  }
  return [...tally.values()]
    .map((move) => ({ ...move, points: roundTo(move.points, POINT_DECIMALS) }))
    .filter((move) => move.points > 0)
    .sort((left, right) => right.points - left.points
      || right.promptsAffected - left.promptsAffected
      || Number(right.kind === "fix") - Number(left.kind === "fix")
      || left.id.localeCompare(right.id));
}

/**
 * The priority slot when the ranking is empty. Never a blank panel, never a
 * filler move.
 *
 * Exported because it is the only copy on a report that is authored here rather
 * than in the contract, and a surface — or a test checking that a report prints
 * nothing it read out of a file — needs to be able to name it as published copy.
 */
export const PERSONAL_NO_PRIORITY = Object.freeze({
  available: false,
  id: null,
  kind: null,
  evidence: "none",
  axis: null,
  title: "No move was prioritized.",
  guidance: "The rubric found nothing worth points in the prompts it read. That is an answer, "
    + "not a gap: there is no next change this reading can justify recommending.",
  rewrite: null,
  promptsAffected: 0,
  promptShare: 0,
  points: 0,
  leadMargin: null,
  runnerUp: null,
});

function confidenceFor({ scoredPrompts, leadMargin, coverage }) {
  const floorMultiple = roundTo(scoredPrompts / PERSONAL_ELIGIBILITY.minScoredPrompts, POINT_DECIMALS);
  const earnedIndex = PERSONAL_CONFIDENCE_TIERS.findIndex(
    (tier) => floorMultiple >= tier.minFloorMultiple && leadMargin >= tier.minLeadMargin,
  );
  const last = PERSONAL_CONFIDENCE_TIERS.length - 1;
  // findIndex cannot miss here: confidence is only asked for once the scored
  // floor is cleared, and the last tier is that floor with no margin required.
  const earned = earnedIndex === -1 ? last : earnedIndex;
  const thin = coverage !== null && coverage < PERSONAL_COVERAGE_FLOOR;
  const index = Math.min(earned + (thin ? 1 : 0), last);
  const tier = PERSONAL_CONFIDENCE_TIERS[index];
  return Object.freeze({
    level: tier.level,
    label: tier.label,
    rule: tier.rule,
    basis: Object.freeze({
      scoredPrompts,
      minScoredPrompts: PERSONAL_ELIGIBILITY.minScoredPrompts,
      floorMultiple,
      leadMargin,
      coverage,
      coverageFloor: PERSONAL_COVERAGE_FLOOR,
      // Stated whether or not it fired, so a reader whose level moved between
      // two reads can see it was coverage and not a prompt count.
      downgradedForCoverage: thin && index !== earned,
      arithmetic: `${scoredPrompts} scored prompts / ${PERSONAL_ELIGIBILITY.minScoredPrompts} `
        + `floor = ${floorMultiple.toFixed(POINT_DECIMALS)}x; leading move ahead of the runner-up `
        + `by ${(leadMargin * 100).toFixed(1)}% of its own points`,
    }),
  });
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const boundaryFor = (state) => PERSONAL_REPORT_STATES.find((entry) => entry.state === state).boundary;

const scopeOf = ({ sampled, stride, available, read }) => Object.freeze({
  sampled,
  method: sampled ? PERSONAL_SAMPLING.methods.evenlySpaced : PERSONAL_SAMPLING.methods.complete,
  ceiling: PERSONAL_SAMPLING.ceiling,
  stride,
  promptEntriesAvailable: available,
  promptEntriesRead: read,
  rule: PERSONAL_SAMPLING.rule,
});

/** Every entry the export carried was read. The shape a refusal carries too. */
const completeScope = (entries) => scopeOf({ sampled: false, stride: 1, available: entries, read: entries });

/**
 * Bound a history to the in-tab ceiling by reading every nth entry.
 *
 * `stride = ceil(available / ceiling)` and the entries at `0, stride, 2*stride,
 * …` are taken in file order, so the sample spans the whole export rather than
 * its opening months, at most `ceiling` entries are graded, and the selection is
 * a pure function of one integer. No clock, no randomness, no hashing: the same
 * export sampled twice reads the same entries, which is what lets two readings
 * of one file be compared at all.
 *
 * @param {ReadonlyArray<{date: string|null, text: string}>} entries in file order.
 * @returns {{sample: ReadonlyArray<object>, scope: object}} the entries to grade
 *   and the declared scope that travels onto the report beside their figures.
 */
export function sampleEntries(entries) {
  const available = entries.length;
  const ceiling = PERSONAL_SAMPLING.ceiling;
  if (available <= ceiling) {
    return { sample: entries, scope: completeScope(available) };
  }
  const stride = Math.ceil(available / ceiling);
  const sample = [];
  for (let at = 0; at < available; at += stride) sample.push(entries[at]);
  return { sample, scope: scopeOf({ sampled: true, stride, available, read: sample.length }) };
}

function report({
  shape = null, state, reason = null, counts, priority = PERSONAL_NO_PRIORITY,
  confidence = PERSONAL_CONFIDENCE_NONE, scope = null,
}) {
  const promptEntries = counts.scoredPrompts + counts.empty + counts.undated + counts.unreadable;
  return Object.freeze({
    schemaVersion: PERSONAL_HISTORY_VERSION,
    question: PERSONAL_HISTORY_QUESTION,
    shape,
    state,
    reason,
    reasonRule: reason ? PERSONAL_NOT_ELIGIBLE_RULE[reason] : null,
    // What the figures below are drawn from. A refusal that read nothing still
    // carries it, so a consumer reads one shape and a reader never has to infer
    // from a missing field that nothing was left out.
    scope: scope ?? completeScope(promptEntries),
    eligibility: Object.freeze({
      minScoredPrompts: PERSONAL_ELIGIBILITY.minScoredPrompts,
      minDistinctDays: PERSONAL_ELIGIBILITY.minDistinctDays,
      operator: PERSONAL_ELIGIBILITY.operator,
      scoredPrompts: counts.scoredPrompts,
      distinctDays: counts.distinctDays,
      met: state !== PERSONAL_REPORT_STATE.notEligible,
      // The boundary, restated where a reader is most owed it: beside the
      // sentence that just told them their file did or did not qualify.
      boundary: boundaryFor(state),
    }),
    coverage: Object.freeze({
      ratio: promptEntries === 0 ? null : roundTo(counts.scoredPrompts / promptEntries, RATIO_DECIMALS),
      promptEntries,
      scoredPrompts: counts.scoredPrompts,
      distinctDays: counts.distinctDays,
      dropped: Object.freeze({
        empty: counts.empty, undated: counts.undated, unreadable: counts.unreadable,
      }),
      attachmentsSkipped: counts.attachments,
      identity: PERSONAL_COVERAGE_IDENTITY,
    }),
    confidence,
    priority,
    basis: PERSONAL_BASIS,
    boundary: PERSONAL_BOUNDARY,
  });
}

const NO_COUNTS = Object.freeze({
  scoredPrompts: 0, empty: 0, undated: 0, unreadable: 0, distinctDays: 0, attachments: 0,
});

/**
 * Read one personal AI-history export and name the single move worth
 * prioritizing, or say precisely why none was named.
 *
 * @param {unknown} text the export file's own text. Anything that is not a
 *   string is a refusal rather than a coercion — a coerced `[object Object]` is
 *   a file nobody handed in.
 * @returns {object} frozen, closed over `PERSONAL_REPORT_FIELDS`, and valid
 *   against `validatePersonalHistoryReport` in every state. The prompts read to
 *   produce it appear nowhere in it.
 */
export function buildPersonalHistoryReport(text) {
  if (typeof text !== "string") {
    return report({
      state: PERSONAL_REPORT_STATE.notEligible,
      reason: PERSONAL_NOT_ELIGIBLE.unsupportedInput,
      counts: NO_COUNTS,
    });
  }
  if (text.length > PERSONAL_READER_LIMITS.maxChars) {
    return report({
      state: PERSONAL_REPORT_STATE.notEligible,
      reason: PERSONAL_NOT_ELIGIBLE.exportTooLarge,
      counts: NO_COUNTS,
    });
  }
  const shape = detectPersonalExportShape(text);
  if (!shape) {
    return report({
      state: PERSONAL_REPORT_STATE.notEligible,
      reason: PERSONAL_NOT_ELIGIBLE.unrecognizedShape,
      counts: NO_COUNTS,
    });
  }

  const { entries, attachments } = extractEntries(shape, text);
  // The sample is decided before a prompt is graded and travels onto the report
  // whether or not it fired. A history over the ceiling is read across its whole
  // span rather than refused; what the old refusal was right about — that a
  // figure drawn from part of a file must say so — is `scope`, not silence.
  const { sample, scope } = sampleEntries(entries);
  const refuse = (reason, counts) => report({
    shape, state: PERSONAL_REPORT_STATE.notEligible, reason, counts, scope,
  });

  if (!entries.length) {
    return refuse(PERSONAL_NOT_ELIGIBLE.noPromptEntries, { ...NO_COUNTS, attachments });
  }

  // Drop precedence, declared in PERSONAL_METRIC_DEFINITIONS: empty, then
  // undated, then unreadable. Exclusive by construction — each entry takes one
  // branch — which is what makes the published coverage identity hold.
  const counts = { scoredPrompts: 0, empty: 0, undated: 0, unreadable: 0, distinctDays: 0, attachments };
  const days = new Set();
  const candidatesByPrompt = [];
  for (const entry of sample) {
    if (!entry.text.trim()) { counts.empty += 1; continue; }
    if (!entry.date) { counts.undated += 1; continue; }
    const graded = gradeMyPrompt({ text: entry.text });
    if (!graded.scored) { counts.unreadable += 1; continue; }
    counts.scoredPrompts += 1;
    days.add(entry.date);
    // The move identifiers and their points. Nothing else from the grade is
    // kept, and the text that produced it is not referenced past this line.
    candidatesByPrompt.push(graded.detail.improvements);
  }
  counts.distinctDays = days.size;

  if (counts.scoredPrompts === 0 && counts.undated > 0 && counts.unreadable === 0) {
    return refuse(PERSONAL_NOT_ELIGIBLE.noDatedPrompts, counts);
  }
  if (counts.scoredPrompts < PERSONAL_ELIGIBILITY.minScoredPrompts) {
    return refuse(PERSONAL_NOT_ELIGIBLE.tooFewScoredPrompts, counts);
  }
  if (counts.distinctDays < PERSONAL_ELIGIBILITY.minDistinctDays) {
    return refuse(PERSONAL_NOT_ELIGIBLE.tooFewDistinctDays, counts);
  }

  const ranked = rankMoves(candidatesByPrompt);
  if (!ranked.length) {
    return report({ shape, state: PERSONAL_REPORT_STATE.noMoveAvailable, counts, scope });
  }

  const promptEntries = counts.scoredPrompts + counts.empty + counts.undated + counts.unreadable;
  const coverage = roundTo(counts.scoredPrompts / promptEntries, RATIO_DECIMALS);
  const [top, runnerUp] = ranked;
  const leadMargin = runnerUp ? roundTo((top.points - runnerUp.points) / top.points, RATIO_DECIMALS) : 1;
  return report({
    shape,
    state: PERSONAL_REPORT_STATE.prioritized,
    counts,
    scope,
    confidence: confidenceFor({ scoredPrompts: counts.scoredPrompts, leadMargin, coverage }),
    priority: Object.freeze({
      available: true,
      id: top.id,
      kind: top.kind,
      // A fired penalty is something you did; an unfired credit is something you
      // could add. Named on the result, because a reader acts differently on the
      // two and the distinction is invisible from the title alone.
      evidence: top.kind === "fix" ? "measured" : "projected",
      axis: top.axis,
      title: top.title,
      guidance: top.guidance,
      rewrite: top.rewrite,
      promptsAffected: top.promptsAffected,
      promptShare: roundTo(top.promptsAffected / counts.scoredPrompts, RATIO_DECIMALS),
      points: top.points,
      leadMargin,
      // The move it beat, so the recommendation can be argued with rather than
      // taken. One runner-up and no more: third place changes nothing a reader
      // would do differently on Monday.
      runnerUp: runnerUp
        ? Object.freeze({ id: runnerUp.id, points: runnerUp.points, title: runnerUp.title })
        : null,
    }),
  });
}

/**
 * The never-persist rule as an executable assertion, cheap enough for a consumer
 * to call before rendering. Throws rather than returning false, because a leak
 * is not a status.
 *
 * @param {object} result a report.
 * @param {string} marker a string known to appear in the graded prompts.
 */
export function assertNoPromptText(result, marker) {
  const serialized = JSON.stringify(result);
  if (typeof marker === "string" && marker && serialized.includes(marker)) {
    throw new Error("the report carries text from the export it read");
  }
  for (const key of FORBIDDEN_REPORT_KEYS) {
    if (new RegExp(`"${key}"\\s*:`).test(serialized)) {
      throw new Error(`the report carries "${key}", which is outside the report vocabulary`);
    }
  }
  return true;
}
