// Reopen a briefing this page previously wrote to a file.
//
// WHAT THIS READS
// ---------------
// Exactly the artifact the export button writes, and nothing else:
//
//   { exportedAt, dataset, briefingContractVersion, datasetNotice?, results }
//
// Those five keys are the whole of what this reader looks at. Since #386 the
// writer is `briefingFile` in finops-briefing-export.js, which keeps all five
// and adds `briefing`, `figures`, and `scenario` beside them for a reader that
// wants the figures without rebuilding them. This one still rebuilds, because
// re-selecting from `results` is what makes a restored briefing unable to say
// something the live page would not have said.
//
// There is no second schema here. `results` is the analysis envelope the page
// already computes, and the three above-the-fold slots are re-selected from it
// by `buildFinopsBriefing` — the same call the live surface makes. A restored
// briefing therefore cannot say something the live page would not have said
// about the same envelope, which is the whole reason this module refuses to
// keep its own copy of the selection rules.
//
// WHAT IT DOES NOT DO
// -------------------
// No DOM, no fetch, no storage, no clock. The dates it reports are the file's
// own (`exportedAt`, `results.period`); reading "when" off the wall clock would
// be the one way a reopened briefing could quietly claim to be current.
//
// A FILE IS UNTRUSTED INPUT
// -------------------------
// The reader is total: it returns a rejection, never throws, and it never
// half-accepts. Size is checked before `JSON.parse` is reached, prototype keys
// are rejected rather than stripped, and anything that looks like markup or a
// scheme URL fails the whole file instead of being escaped downstream. The
// render layer still writes only through `textContent`; this is the belt to
// that layer's braces.

import {
  BRIEFING_CONFIDENCE, CONTRACT_VERSION, buildFinopsBriefing, validateBriefing,
} from "./finops-briefing-contract.js";
import { DOWN_ROUTING_RULE_VERSION } from "./down-routing-candidates.js";

/**
 * Ceilings, checked before the file is parsed. A briefing is aggregates: a few
 * hundred kilobytes at the very top end, so anything past two megabytes is not
 * a briefing and is refused without being read into an object graph.
 */
export const MAX_BRIEFING_BYTES = 2_000_000;
export const MAX_BRIEFING_DEPTH = 24;
export const MAX_BRIEFING_NODES = 50_000;

/** The largest figure this page is willing to display, as elsewhere on it. */
export const MAX_PLAUSIBLE_USD = 1_000_000_000_000;

/** The analysis envelopes a saved briefing may have been taken from. */
export const SUPPORTED_ANALYSIS_SCHEMAS = Object.freeze([
  "local-finops/1.0.0",
  "local-finops-history/1.0.0",
]);

/** "2026-06-01 to 2026-07-01", the envelope's own period string. */
const PERIOD_PATTERN = /^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/;

const POLLUTION_KEYS = Object.freeze(["__proto__", "constructor", "prototype"]);

// Markup, event handlers, and scheme URLs. A briefing carries none of these, so
// their presence is a fact about the file rather than about the reader.
const MARKUP_PATTERN = /<\s*[a-z!/]/i;
const HANDLER_PATTERN = /\bon[a-z]+\s*=\s*["'a-z]/i;
const SCHEME_PATTERN = /(?:javascript|vbscript)\s*:|data:[a-z0-9.+-]+\/[a-z0-9.+-]+/i;

/**
 * Every way a file can be turned away, with the sentence the reader is shown.
 *
 * The sentences are authored once, here, so the page, the announcement, and any
 * later consumer say the same thing about the same fault. Each one names what is
 * wrong and what to do next; none of them quotes the file's own content back,
 * because the content is exactly what is not trusted.
 */
export const RESTORE_REJECTION = Object.freeze({
  file_too_large:
    "That file is larger than 2 MB, so it was not opened. A saved briefing is a small JSON file; "
    + "choose the file the Export JSON button produced.",
  unreadable:
    "That file could not be read as text. Choose the JSON file the Export JSON button produced. "
    + "Nothing on this page was changed.",
  not_json:
    "That file is not complete JSON — it may be truncated or may not be a briefing at all. "
    + "Choose the JSON file the Export JSON button produced.",
  not_a_briefing_file:
    "That file is JSON, but not a saved briefing: the top level is not an object with a briefing in it. "
    + "Choose the JSON file the Export JSON button produced.",
  unsafe_keys:
    "That file uses reserved key names, so it was not opened. A briefing this page wrote never contains them. "
    + "Export the analysis again rather than editing a saved file by hand.",
  too_deeply_nested:
    "That file nests further than a briefing ever does, so it was not opened. "
    + "Choose the JSON file the Export JSON button produced.",
  too_many_values:
    "That file holds far more values than a briefing does, so it was not opened. "
    + "Choose the JSON file the Export JSON button produced.",
  unsafe_content:
    "That file contains markup or a scheme URL where a briefing holds only figures and labels, "
    + "so it was not opened. Export the analysis again rather than editing a saved file by hand.",
  unsupported_version:
    "That briefing was written against a different version of the briefing contract, so this page cannot "
    + "read it without risking a wrong figure. Export the analysis again from the build that wrote it.",
  missing_written_date:
    "That briefing does not record when it was written, so it cannot be shown as a past briefing. "
    + "Choose the JSON file the Export JSON button produced.",
  unknown_dataset:
    "That briefing does not say whether it came from your own data or the example dataset, "
    + "so it was not opened. Choose the JSON file the Export JSON button produced.",
  missing_results:
    "That briefing is missing its analysis, so there is nothing to show. "
    + "Choose the JSON file the Export JSON button produced.",
  unsupported_analysis:
    "That briefing was taken from an analysis this page does not know how to read. "
    + "Export the analysis again from the build that wrote it.",
  missing_period:
    "That briefing does not name the period it observed, so it cannot be shown without a date on it. "
    + "Choose the JSON file the Export JSON button produced.",
  wrong_type:
    "That briefing has a field of the wrong type, so it was not opened — a value this page expects as a "
    + "number or an object is something else. Export the analysis again rather than editing a saved file by hand.",
  not_a_number:
    "That briefing holds a spend figure that is not a finite number, so no total could be read from it. "
    + "Export the analysis again rather than editing a saved file by hand.",
  implausible_number:
    "That briefing holds a spend figure outside the 0–1 trillion USD range this page displays, "
    + "so it was not opened. Export the analysis again rather than editing a saved file by hand.",
  briefing_not_valid:
    "That briefing does not satisfy the briefing contract, so it was not opened. "
    + "Export the analysis again from the build that wrote it.",
});

function rejected(code) {
  return Object.freeze({ ok: false, code, message: RESTORE_REJECTION[code], saved: null });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * One pass over the parsed document for the three faults that are about the
 * file's shape rather than its fields: reserved keys, runaway nesting, and
 * content that belongs in a page rather than in a briefing.
 *
 * Iterative rather than recursive, so a hostile file cannot answer the depth
 * check with a stack overflow.
 */
function inspectDocument(root) {
  const stack = [{ value: root, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop();
    nodes += 1;
    if (nodes > MAX_BRIEFING_NODES) return "too_many_values";
    if (depth > MAX_BRIEFING_DEPTH) return "too_deeply_nested";
    if (typeof value === "string") {
      if (MARKUP_PATTERN.test(value) || HANDLER_PATTERN.test(value) || SCHEME_PATTERN.test(value)) {
        return "unsafe_content";
      }
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) stack.push({ value: item, depth: depth + 1 });
      continue;
    }
    if (!value || typeof value !== "object") continue;
    // getOwnPropertyNames, not Object.keys: `JSON.parse` defines `__proto__` as
    // an ordinary own property, and this is the check that has to see it.
    for (const key of Object.getOwnPropertyNames(value)) {
      if (POLLUTION_KEYS.includes(key)) return "unsafe_keys";
      if (MARKUP_PATTERN.test(key) || SCHEME_PATTERN.test(key)) return "unsafe_content";
      stack.push({ value: value[key], depth: depth + 1 });
    }
  }
  return null;
}

function readMoney(value) {
  if (typeof value !== "number") return { code: "wrong_type" };
  // `JSON.parse("1e999")` is Infinity, so this is the check that catches an
  // absurd literal as well as an explicitly non-finite one.
  if (!Number.isFinite(value)) return { code: "not_a_number" };
  if (value < 0 || value > MAX_PLAUSIBLE_USD) return { code: "implausible_number" };
  return { value };
}

function readPeriod(period) {
  const match = PERIOD_PATTERN.exec(typeof period === "string" ? period.trim() : "");
  if (!match) return null;
  const start = Date.parse(`${match[1]}T00:00:00Z`);
  const end = Date.parse(`${match[2]}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(start < end)) return null;
  return Object.freeze({
    label: `${match[1]} to ${match[2]}`,
    startDate: match[1],
    endDate: match[2],
    days: Math.round((end - start) / 86_400_000),
  });
}

/**
 * The routing-rubric version the *file* was produced under.
 *
 * The briefing contract stamps `rubricVersion` from this build's constant, so
 * asking a rebuilt briefing which rubric it used would only ever return today's
 * answer. The file's own answer is on the ranked departments, where
 * `evaluateDownRoutingCandidate` wrote it at export time. When no department
 * carries one there is no answer, and `null` says so rather than assuming.
 */
export function savedRubricVersion(results) {
  const ranked = Array.isArray(results?.rankedDepartments) ? results.rankedDepartments : [];
  for (const department of ranked) {
    const version = department?.downRouting?.ruleVersion;
    if (typeof version === "string" && version) return version;
  }
  return null;
}

/**
 * Read a saved briefing file.
 *
 * @param text the file's contents.
 * @param options.byteSize the selected file's size, checked before the text is
 *   parsed. Omitted, the text's own length stands in.
 * @returns `{ ok: true, saved }` or `{ ok: false, code, message }`. Total: it
 *   never throws and never returns a partially-read briefing.
 */
export function parseSavedBriefing(text, { byteSize = null } = {}) {
  if (Number.isFinite(byteSize) && byteSize > MAX_BRIEFING_BYTES) return rejected("file_too_large");
  if (typeof text !== "string") return rejected("unreadable");
  if (text.length > MAX_BRIEFING_BYTES) return rejected("file_too_large");

  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return rejected("not_json");
  }
  if (!isPlainObject(raw)) return rejected("not_a_briefing_file");

  const unsafe = inspectDocument(raw);
  if (unsafe) return rejected(unsafe);

  if (raw.briefingContractVersion !== CONTRACT_VERSION) return rejected("unsupported_version");

  const savedAt = typeof raw.exportedAt === "string" ? Date.parse(raw.exportedAt) : Number.NaN;
  if (!Number.isFinite(savedAt)) return rejected("missing_written_date");
  if (raw.dataset !== "user" && raw.dataset !== "example") return rejected("unknown_dataset");

  const results = raw.results;
  if (!isPlainObject(results)) return rejected("missing_results");
  if (!SUPPORTED_ANALYSIS_SCHEMAS.includes(results.schemaVersion)) return rejected("unsupported_analysis");

  const period = readPeriod(results.period);
  if (!period) return rejected("missing_period");

  const spend = readMoney(results.spendUsd);
  if (spend.code) return rejected(spend.code);
  const recoverable = readMoney(results.recoverableUsd);
  if (recoverable.code) return rejected(recoverable.code);

  if (!Array.isArray(results.rankedDepartments)) return rejected("wrong_type");
  if (results.topDepartment !== null && !isPlainObject(results.topDepartment)) return rejected("wrong_type");
  if (typeof results.action !== "string" || !results.action.trim()) return rejected("wrong_type");
  const quality = results.quality;
  if (!isPlainObject(quality)) return rejected("wrong_type");
  for (const count of [quality.joinedRecords, quality.quarantinedRecords]) {
    if (!Number.isInteger(count) || count < 0) return rejected("wrong_type");
  }

  // The one selection, made by the contract rather than here. A file that
  // survives every check above can still describe an envelope the contract
  // refuses, and that refusal is the answer rather than a caught surprise.
  let briefing;
  try {
    briefing = buildFinopsBriefing(results);
  } catch {
    return rejected("briefing_not_valid");
  }
  if (!validateBriefing(briefing).valid) return rejected("briefing_not_valid");

  return Object.freeze({
    ok: true,
    code: null,
    message: null,
    saved: Object.freeze({
      contractVersion: raw.briefingContractVersion,
      // The date the file records, not today's. Only the calendar day is kept:
      // a briefing is a statement about a period, and the minute it was written
      // is precision nobody reads.
      savedOn: new Date(savedAt).toISOString().slice(0, 10),
      dataset: raw.dataset,
      analysisSchemaVersion: results.schemaVersion,
      period,
      spendUsd: spend.value,
      recoverableUsd: recoverable.value,
      rubricVersion: savedRubricVersion(results),
      briefing,
    }),
  });
}

// ---------------------------------------------------------------------------
// The delta. Two briefings, or a stated reason they cannot be subtracted.
// ---------------------------------------------------------------------------

/**
 * The confidence grades, weakest first. A grade change is reported as a move
 * along this order, so "improved" and "fell" are decided by the enum rather
 * than by a word chosen at render time.
 */
export const GRADE_ORDER = Object.freeze([
  BRIEFING_CONFIDENCE.insufficient,
  BRIEFING_CONFIDENCE.low,
  BRIEFING_CONFIDENCE.moderate,
  BRIEFING_CONFIDENCE.high,
]);

export const GRADE_LABEL = Object.freeze({
  insufficient: "Insufficient",
  low: "Low",
  moderate: "Moderate",
  high: "High",
});

/**
 * Why two briefings cannot be subtracted, with the sentence that says which
 * mismatch it is. Rendering a delta across any of these would be arithmetic on
 * two different things wearing the same units.
 */
export const NOT_COMPARABLE = Object.freeze({
  dataset:
    "No change is shown: one of these is the example dataset and the other is your own data, "
    + "so the two totals are not measurements of the same thing.",
  analysis:
    "No change is shown: the saved briefing came from a different kind of analysis than the one on screen, "
    + "so their totals cover different scopes.",
  window:
    "No change is shown: the two briefings observe windows of different lengths, "
    + "so the difference between their totals would not be a like-for-like change.",
  rubric:
    "No change is shown: the saved briefing was scored against a different version of the routing rubric "
    + "than this analysis, so its figures are not comparable to these.",
  rubric_unknown:
    "No change is shown: the saved briefing does not record which version of the routing rubric produced it, "
    + "so this page cannot confirm the two were scored the same way.",
  coverage:
    "No change is shown: one of these briefings covered none of its records, "
    + "so there is no shared base to compare against.",
});

function money(value) {
  return `${value.toFixed(2)} USD`;
}

function directionWord(change) {
  if (change > 0) return "up";
  if (change < 0) return "down";
  return "unchanged";
}

/**
 * Compare a restored briefing against the analysis currently on screen.
 *
 * @param saved a `parseSavedBriefing` result's `saved`, or null.
 * @param current `{ dataset, result, briefing }` for the live analysis, or null
 *   when nothing has been analyzed in this tab.
 * @returns null when there is nothing to compare — the delta line is absent, not
 *   empty — otherwise `{ comparable, code, text, spend?, grade? }`.
 *
 * Mismatches are checked in a fixed order and the first one is reported, so the
 * message a reader gets for a given pair of files never depends on evaluation
 * luck: dataset, then analysis scope, then window length, then rubric, then
 * coverage.
 */
export function briefingDelta(saved, current) {
  if (!saved || !current?.result || !current?.briefing) return null;
  const period = readPeriod(current.result.period);
  const currentDataset = current.dataset === "example" ? "example" : "user";

  if (saved.dataset !== currentDataset) {
    return Object.freeze({ comparable: false, code: "dataset", text: NOT_COMPARABLE.dataset });
  }
  if (saved.analysisSchemaVersion !== current.result.schemaVersion) {
    return Object.freeze({ comparable: false, code: "analysis", text: NOT_COMPARABLE.analysis });
  }
  if (!period || period.days !== saved.period.days) {
    return Object.freeze({ comparable: false, code: "window", text: NOT_COMPARABLE.window });
  }
  const currentRubric = savedRubricVersion(current.result) ?? DOWN_ROUTING_RULE_VERSION;
  if (!saved.rubricVersion) {
    return Object.freeze({ comparable: false, code: "rubric_unknown", text: NOT_COMPARABLE.rubric_unknown });
  }
  if (saved.rubricVersion !== currentRubric) {
    return Object.freeze({ comparable: false, code: "rubric", text: NOT_COMPARABLE.rubric });
  }

  const savedGrade = saved.briefing.coverage.confidence;
  const currentGrade = current.briefing.coverage.confidence;
  if (savedGrade === BRIEFING_CONFIDENCE.insufficient || currentGrade === BRIEFING_CONFIDENCE.insufficient) {
    return Object.freeze({ comparable: false, code: "coverage", text: NOT_COMPARABLE.coverage });
  }

  const currentSpend = Number(current.result.spendUsd);
  if (!Number.isFinite(currentSpend)) {
    return Object.freeze({ comparable: false, code: "coverage", text: NOT_COMPARABLE.coverage });
  }
  const change = currentSpend - saved.spendUsd;
  const direction = directionWord(change);
  // Percentage only where there is a base to take it against. A change from
  // zero is not "infinite percent", it is a change from zero.
  const share = saved.spendUsd > 0
    ? ` (${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs((change / saved.spendUsd) * 100).toFixed(1)}%)`
    : "";
  const spendText = change === 0
    ? `Observed spend unchanged at ${money(currentSpend)}.`
    : `Observed spend ${direction} ${money(Math.abs(change))}${share} — `
      + `${money(saved.spendUsd)} in the saved briefing, ${money(currentSpend)} now.`;

  const savedRank = GRADE_ORDER.indexOf(savedGrade);
  const currentRank = GRADE_ORDER.indexOf(currentGrade);
  const gradeText = currentRank === savedRank
    ? `Confidence grade unchanged at ${GRADE_LABEL[currentGrade]}.`
    : `Confidence grade ${currentRank > savedRank ? "improved" : "fell"} `
      + `from ${GRADE_LABEL[savedGrade]} to ${GRADE_LABEL[currentGrade]}.`;

  return Object.freeze({
    comparable: true,
    code: null,
    text: `Since the saved briefing: ${spendText} ${gradeText}`,
    spend: Object.freeze({
      direction, changeUsd: change, savedUsd: saved.spendUsd, currentUsd: currentSpend,
    }),
    grade: Object.freeze({
      direction: currentRank === savedRank ? "unchanged" : currentRank > savedRank ? "improved" : "fell",
      saved: savedGrade,
      current: currentGrade,
    }),
  });
}

/**
 * The one line that says what this region is and when it is from. Both dates
 * come out of the file; nothing here reads a clock.
 */
export function capturedPeriodLine(saved) {
  return `Observation window ${saved.period.label} · written ${saved.savedOn} · `
    + `read from a file you chose, not recomputed here.`;
}

export const EXAMPLE_DATASET_LINE =
  "This saved briefing was taken from the bundled example dataset. It is not a report about any real organization.";
