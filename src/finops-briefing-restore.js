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
  BRIEFING_CONFIDENCE, CONTRACT_VERSION, MAX_STRING_LENGTH, buildFinopsBriefing, validateBriefing,
} from "./finops-briefing-contract.js";
import { DOWN_ROUTING_RULE_VERSION } from "./down-routing-candidates.js";
import { briefingDerivation } from "./finops-briefing-derivation.js";
import { readSavedCommitment } from "./finops-briefing-commitment.js";
// The writer's own schema version and ceilings. Read from there rather than
// restated here, so the branch below cannot drift away from the branch a file
// was written under.
import {
  BRIEFING_EXPORT_SCHEMA_VERSION, MAX_EXPORTED_UNITS, MAX_EXPORTED_UNIT_NAME,
} from "./finops-briefing-export.js";

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

// ---------------------------------------------------------------------------
// Unit names, their provenance, and the reader's corrections — by schema version.
// ---------------------------------------------------------------------------
//
// THE BRANCH IS ON THE VERSION AND ONLY ON THE VERSION. A file written before
// #1027 has no `exportSchemaVersion`, and `savedExportSchemaVersion` reads that
// absence as 0 — a real version, not a fault. Version 0 takes the legacy branch,
// which reopens a complete brief and says out loud that the file carries no name
// provenance. Nothing here decides anything from whether `unitNaming` is present:
// a version-1 file whose analysis simply had no derived names is a different
// thing from a version-0 file, and only the version can tell them apart.
//
// A VERSION THIS BUILD DOES NOT KNOW takes the legacy branch too. A briefing
// written by a later build is still a briefing — every key this reader validates
// is in it — so it opens, and it opens with the same plain note rather than with
// a naming block read under rules this build is guessing at.

/**
 * The sentence a brief carrying no readable name provenance wears.
 *
 * Painted into the restored region, not logged: a reader comparing a reopened
 * brief against the one they exported has to be able to see why the unit names
 * lost their working, and a console warning is invisible to the person holding
 * the file.
 */
export const NAMING_PROVENANCE_ABSENT_NOTE =
  "This briefing was written before this page recorded where unit names come from, so it carries no "
  + "name provenance: no derived unit names, no column any name was read out of, and no record of a "
  + "correction a reader made. Every figure above is complete; only the naming is missing. "
  + "Export the analysis again from this build to get one that carries it.";

/** No naming to show, with the reason stated. Every restore carries one of these. */
export const NO_RESTORED_UNIT_NAMING = Object.freeze({
  available: false,
  contractVersion: null,
  conflictedCount: 0,
  correctedCount: 0,
  derivedCount: 0,
  note: NAMING_PROVENANCE_ABSENT_NOTE,
  precedenceStatement: "",
  provenanceAvailable: false,
  statement: "",
  unitCount: 0,
  units: Object.freeze([]),
});

/** A string from a file, or "". Length-capped and refused if it holds a control. */
function readText(value, maxLength) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || trimmed.length > maxLength) return "";
  for (const character of trimmed) {
    const code = character.codePointAt(0);
    if (code < 0x20 || code === 0x7f) return "";
  }
  return trimmed;
}

/**
 * The schema version a file was written under. Absent, malformed, or negative
 * all read as 0 — the legacy branch — because none of them is a version this
 * build wrote, and guessing upward is how a reader mis-reads a shape.
 */
export function savedExportSchemaVersion(raw) {
  const version = raw?.exportSchemaVersion;
  return Number.isInteger(version) && version > 0 ? version : 0;
}

/**
 * The naming block a version-1 file carries, sanitized field by field.
 *
 * Untrusted input, so nothing is spread: every field is named, type-checked and
 * length-capped here, and a unit whose identity does not read as an identity is
 * dropped rather than repaired. A correction keeps the derived name it replaced,
 * which is what lets the surface say "derived, then corrected by a reader"
 * instead of showing a typed name as though the export had supplied it.
 */
export function readUnitNaming(raw) {
  if (savedExportSchemaVersion(raw) !== BRIEFING_EXPORT_SCHEMA_VERSION) {
    return NO_RESTORED_UNIT_NAMING;
  }
  const block = raw?.unitNaming;
  const entries = isPlainObject(block) && Array.isArray(block.units) ? block.units : [];
  const units = [];
  const seen = new Set();
  for (const entry of entries.slice(0, MAX_EXPORTED_UNITS)) {
    if (!isPlainObject(entry)) continue;
    const unitId = readText(entry.unitId, 128);
    if (!unitId || seen.has(unitId)) continue;
    seen.add(unitId);
    const derivedName = readText(entry.derivedName, MAX_EXPORTED_UNIT_NAME);
    const correctionName = isPlainObject(entry.correction)
      ? readText(entry.correction.name, MAX_EXPORTED_UNIT_NAME) : "";
    units.push(Object.freeze({
      conflicted: entry.conflicted === true,
      correction: correctionName
        ? Object.freeze({
          name: correctionName,
          replacedDerivedName:
            readText(entry.correction.replacedDerivedName, MAX_EXPORTED_UNIT_NAME) || null,
        })
        : null,
      derived: entry.derived === true,
      derivedName: derivedName || null,
      sourceColumn: readText(entry.sourceColumn, MAX_EXPORTED_UNIT_NAME) || null,
      sourceField: readText(entry.sourceField, MAX_EXPORTED_UNIT_NAME) || null,
      sourceFieldLabel: readText(entry.sourceFieldLabel, MAX_EXPORTED_UNIT_NAME) || null,
      unitId,
      withheld: entry.withheld === true,
    }));
  }
  // Provenance is available because the FILE says version 1, not because it
  // turned out to hold units: an analysis whose units were never named from a
  // dropped export writes an empty block, and that is a complete answer.
  return Object.freeze({
    available: units.length > 0,
    contractVersion: Number.isInteger(block?.contractVersion) ? block.contractVersion : null,
    conflictedCount: units.filter((unit) => unit.conflicted).length,
    correctedCount: units.filter((unit) => unit.correction).length,
    derivedCount: units.filter((unit) => unit.derivedName).length,
    note: null,
    precedenceStatement: readText(block?.precedenceStatement, MAX_STRING_LENGTH),
    provenanceAvailable: true,
    statement: readText(block?.statement, MAX_STRING_LENGTH),
    unitCount: units.length,
    units: Object.freeze(units),
  });
}

/**
 * The names a restored brief renders with: the reader's correction where there
 * is one, the derived name otherwise. Same precedence the live page applies —
 * reader-typed, then derived, then the pseudonym the analysis already published.
 */
export function restoredUnitLabels(naming) {
  const labels = {};
  for (const unit of naming?.units ?? []) {
    const name = unit.correction?.name ?? unit.derivedName;
    if (name) labels[unit.unitId] = name;
  }
  return Object.freeze(labels);
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

  const naming = readUnitNaming(raw);
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
      // The schema the FILE was written under, and the naming that schema does
      // or does not carry. Version 0 — a briefing written before #1027 — reaches
      // here with a complete brief and a naming block that states its own
      // absence, never with a throw and never with a blank region.
      exportSchemaVersion: savedExportSchemaVersion(raw),
      unitNaming: naming,
      unitLabels: restoredUnitLabels(naming),
      analysisSchemaVersion: results.schemaVersion,
      period,
      spendUsd: spend.value,
      recoverableUsd: recoverable.value,
      rubricVersion: savedRubricVersion(results),
      briefing,
      // "Check the math" for a briefing that arrived as a file, computed here so
      // a reopened briefing is re-derivable on exactly the terms a fresh one is.
      //
      // The briefing handed to the derivation is the *rebuilt* one, not the
      // file's own `briefing` block: the rebuilt object is what this page shows,
      // and checking the arithmetic of an object the reader is not being shown
      // would be an audit of the wrong thing. Everything else — the record
      // counts, the per-department amounts, the attributed share, and the rubric
      // version stamped at analysis time — is the file's, which is what makes
      // this a check of the file rather than of this build.
      derivation: briefingDerivation({ ...raw, briefing }),
      // The commitment is read out of the file rather than rebuilt, because the
      // `results` projection carries no per-model routing detail to rebuild it
      // from. That makes it the one block here this page did not recompute, so
      // it goes through the commitment contract's own validator on the way in
      // and arrives as an explicit `unavailable` state when it does not hold —
      // including for every briefing written before this block existed.
      savingsCommitment: readSavedCommitment(raw),
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
