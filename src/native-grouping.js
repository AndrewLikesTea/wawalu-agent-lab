// Native grouping detection: which column in a provider's own export already
// says "this spend belongs to that team", and why that column beat the others.
//
// The premise this module replaces is that attribution needs an HRIS org file.
// It does not. Every provider export a finance lead can download is already
// grouped by something the provider bills by — a project, a workspace, a key
// alias, a cost-allocation tag, a linked account. Recognizing that column is the
// whole job here; an org file becomes strictly optional enrichment that maps a
// grouping unit to a department name, and its absence is no longer a blocker.
//
// WHERE THE DATA LIVES. The candidate columns and the precedence order are
// declared in `dialect-profiles.js` and nowhere else. This module contains no
// per-vendor branch: it reads `rankedGroupingCandidates(profile)`, looks each
// candidate up by name, and takes the first one that is actually usable. Adding
// a vendor is adding a profile, never an `if` here.
//
// DEFENSIVE BY DEFAULT — the four cases this layer is built around:
//
//   * A candidate column that is present but entirely empty is not a grouping
//     column. It is rejected with `column_empty` and the next candidate is
//     tried. A file with a blank `CostCenter` header still groups by project.
//   * A candidate column with *some* blank cells is chosen, and the blank rows
//     are counted and reported on `rows.ungrouped`. They are never dropped and
//     never bucketed into an invented "Unassigned" unit — an invented unit is a
//     number a leader would act on.
//   * No candidate column at all is a clean `status: "none"` result carrying a
//     sentence the UI can render. It is not a thrown error, and it is emphatically
//     not the old "your org file is missing" message: nothing is missing, this
//     export simply does not carry a grouping column.
//   * Duplicate, renamed, whitespace-padded and case-shifted headers are folded
//     by `normalizeColumnName` before matching, and candidates are ranked by the
//     declared precedence list — so column order in the file cannot change the
//     outcome, by construction.
//
// PRIVACY. A grouping label is a customer-chosen project or key name, which is
// the customer's business and not ours. Every label this module publishes has
// been through `orgUnitPseudonym` — the same helper the shipped delimited
// importer uses, imported rather than reimplemented. Headers are published
// verbatim because the column-review step already shows the reader their own
// header row; cell values never are.
//
// No I/O of any kind: no fetch, no storage, no credential, no network.

import { detectDialect } from "./dialect-detection.js";
import {
  DIALECT_PROFILES, GROUPING_UNIT_PRECEDENCE, groupingPrecedenceFor, normalizeColumnName,
  rankedGroupingCandidates,
} from "./dialect-profiles.js";
import { COVERAGE_TIERS, NO_BASELINE_TIER } from "./grade-eligibility.js";
import { orgUnitPseudonym } from "./unit-pseudonym.js";

/**
 * Bump the minor when a field is added, the major when one changes meaning or
 * disappears. Consumers may switch on `status`, `unit`, and every `code` below;
 * they may not switch on `text`, which is prose and may be reworded freely.
 */
export const NATIVE_GROUPING_VERSION = "native-grouping/1.0.0";

/** The three outcomes. Closed set; a consumer may switch on it exhaustively. */
export const GROUPING_STATUS = Object.freeze({
  /** A usable grouping column was found in the export itself. */
  native: "native",
  /** The dialect is known and carries no usable grouping column. */
  none: "none",
  /** No dialect matched, so no candidate list applies. */
  unidentified: "unidentified",
});

/** Why a candidate did not win. Stable codes; downstream never reads `text`. */
export const CANDIDATE_REJECTIONS = Object.freeze({
  /** The export carries no column under any accepted spelling for this unit. */
  absent: "column_absent",
  /** The column is present and every single cell in it is blank. */
  empty: "column_empty",
  /** The column is usable, but a higher-precedence candidate is also usable. */
  outranked: "outranked",
});

/**
 * Noor's eligibility states, imported rather than restated. Native grouping is a
 * *precondition* for the sampled-spend-coverage metric, not a replacement for
 * it: with no grouping unit there is no denominator to weight coverage by, so
 * the grade is withheld on exactly the terms `grade-eligibility.js` already
 * publishes. Re-spelling `"not_gradeable"` here is how the two would drift.
 */
const GRADEABLE_STATE = COVERAGE_TIERS[0].state;
const UNGRADEABLE_STATE = NO_BASELINE_TIER.state;

/**
 * @typedef {object} GroupingCandidateReport
 * @property {string} unit          member of `PROVIDER_GROUPING_UNITS`
 * @property {number} rank          index in the precedence list; lower wins
 * @property {string|null} header   the header as the file spelled it, or null
 * @property {number|null} index    column position, or null when absent
 * @property {"chosen"|"rejected"} status
 * @property {string|null} code     a `CANDIDATE_REJECTIONS` code when rejected
 * @property {number} valueRows     rows with a non-blank value in this column
 * @property {number} blankRows     rows with a blank or missing value
 * @property {string} text          one renderable sentence; never switched on
 *
 * @typedef {object} NativeGrouping
 * @property {string} version                  `NATIVE_GROUPING_VERSION`
 * @property {"native"|"none"|"unidentified"} status
 * @property {{id: string, label: string, version: number, kind: string,
 *            confidence: number}|null} dialect
 * @property {{header: string, index: number, normalized: string}|null} column
 *           the chosen grouping column's *source header*, verbatim
 * @property {string|null} unit                the chosen grouping-unit kind
 * @property {{order: string[], source: "global"|"profile", rank: number|null,
 *            code: string, beat: string[], text: string}} precedence
 *           machine-readable: `code` is `sole_candidate` | `outranked_others` |
 *           `no_candidate`; `beat` lists the units it outranked
 * @property {{distinct: number, labels: string[]}} units
 *           `labels` are pseudonyms, never the customer's own strings
 * @property {{total: number, grouped: number, ungrouped: number}} rows
 * @property {GroupingCandidateReport[]} candidates  considered and rejected too
 * @property {string} gradingState             a `grade-eligibility.js` state
 * @property {{applied: boolean, status: string, mapped: object[],
 *             unmapped: string[], unknown: object[], problems: object[]}}
 *           enrichment  — see `applyGroupingEnrichment`
 * @property {string} text                     one sentence for the review UI
 */

/** The enrichment half of the contract. Codes are stable; text is not. */
export const ENRICHMENT_CODES = Object.freeze({
  /** No enrichment file was supplied. The native labels stand. */
  absent: "enrichment_absent",
  /** Every grouping unit in the export was mapped to a department. */
  complete: "enrichment_complete",
  /** Some units mapped; the rest keep their native label. Not an error. */
  partial: "enrichment_partial",
  /** The file could not be read as a mapping. Native grouping stays intact. */
  malformed: "enrichment_malformed",
  /** An enrichment row named a unit the export does not contain. Reported. */
  unknownUnit: "enrichment_unknown_unit",
});

const EMPTY_ENRICHMENT = Object.freeze({
  applied: false,
  status: ENRICHMENT_CODES.absent,
  mapped: Object.freeze([]),
  unmapped: Object.freeze([]),
  unknown: Object.freeze([]),
  problems: Object.freeze([]),
});

/** The one result a consumer gets when there is nothing to group by. */
export const NO_NATIVE_GROUPING = Object.freeze({
  version: NATIVE_GROUPING_VERSION,
  status: GROUPING_STATUS.unidentified,
  dialect: null,
  column: null,
  unit: null,
  precedence: Object.freeze({
    order: GROUPING_UNIT_PRECEDENCE, source: "global", rank: null,
    code: "no_candidate", beat: Object.freeze([]),
    text: "No provider dialect matched, so no grouping candidates applied.",
  }),
  units: Object.freeze({ distinct: 0, labels: Object.freeze([]) }),
  rows: Object.freeze({ total: 0, grouped: 0, ungrouped: 0 }),
  candidates: Object.freeze([]),
  gradingState: UNGRADEABLE_STATE,
  enrichment: EMPTY_ENRICHMENT,
  text: "This file matched no recognized provider export, so no grouping column was read.",
});

const UNIT_WORD = Object.freeze({
  project: "project", workspace: "workspace", account: "linked account",
  resource_group: "resource group", api_key: "API key", tag: "resource tag",
});

/** Human words for a unit, for the one sentence. Never a machine key. */
const unitWord = (unit) => UNIT_WORD[unit] ?? unit;

/**
 * Normalized header -> first column index. First wins, deterministically: a
 * vendor that repeats a header gets its leftmost copy, and a renamed duplicate
 * that normalizes to the same name never shadows the original.
 */
function indexColumns(columns) {
  const index = new Map();
  columns.forEach((name, position) => {
    const key = normalizeColumnName(name);
    if (key && !index.has(key)) index.set(key, position);
  });
  return index;
}

/** The first accepted spelling of this candidate present in the file, if any. */
function locate(candidate, index) {
  for (const name of [candidate.source, ...candidate.aliases]) {
    const key = normalizeColumnName(name);
    if (index.has(key)) return { normalized: key, position: index.get(key) };
  }
  return null;
}

const isBlank = (value) => value === undefined || value === null || String(value).trim() === "";

/** Non-blank and blank cell counts for one column, over every data row. */
function tally(rows, position) {
  let valueRows = 0;
  let blankRows = 0;
  for (const row of rows) {
    if (isBlank(row?.[position])) blankRows += 1;
    else valueRows += 1;
  }
  return { valueRows, blankRows };
}

function candidateReport(candidate, extra) {
  return Object.freeze({
    unit: candidate.unit, rank: candidate.rank,
    header: null, index: null, valueRows: 0, blankRows: 0, code: null,
    ...extra,
  });
}

/**
 * Detect the grouping column a table already carries.
 *
 * @param {{columns: string[], rows: string[][]}} table the parsed table, exactly
 *   as the dialect layer's detector takes it. Rows are arrays of cell strings.
 * @param {{profiles?: object[], detection?: object}} [options] `detection` lets
 *   a caller that already ran `detectDialect` avoid running it twice.
 * @returns {NativeGrouping} always a whole result; never throws for bad input.
 */
export function detectNativeGrouping(table, { profiles = DIALECT_PROFILES, detection = null } = {}) {
  const columns = [...(table?.columns ?? [])];
  const rows = Array.isArray(table?.rows) ? table.rows : [];
  const found = detection ?? detectDialect({ columns, rows }, profiles);
  if (found?.status !== "matched" || found.kind !== "usage") {
    return Object.freeze({
      ...NO_NATIVE_GROUPING,
      rows: Object.freeze({ total: rows.length, grouped: 0, ungrouped: rows.length }),
      dialect: found?.status === "matched" ? dialectOf(found) : null,
      // A roster is a recognized dialect that groups nothing. Saying "no
      // grouping column" is true of it; saying "unidentified" would not be.
      status: found?.status === "matched" ? GROUPING_STATUS.none : GROUPING_STATUS.unidentified,
      text: found?.status === "matched"
        ? `${found.profile.label} carries no grouping column; it is an enrichment file.`
        : NO_NATIVE_GROUPING.text,
    });
  }

  const profile = found.profile;
  const order = groupingPrecedenceFor(profile);
  const index = indexColumns(columns);
  const reports = [];
  const usable = [];

  // One pass over the *declared* candidates, already sorted by precedence. The
  // file's column order is never consulted, so a reordered export is the same
  // export — that is the whole reason ranking happens on the profile data.
  for (const candidate of rankedGroupingCandidates(profile)) {
    const at = locate(candidate, index);
    if (!at) {
      reports.push(candidateReport(candidate, {
        status: "rejected", code: CANDIDATE_REJECTIONS.absent,
        text: `No ${unitWord(candidate.unit)} column is present under any accepted spelling.`,
      }));
      continue;
    }
    const counts = tally(rows, at.position);
    const header = columns[at.position];
    if (counts.valueRows === 0) {
      reports.push(candidateReport(candidate, {
        status: "rejected", code: CANDIDATE_REJECTIONS.empty,
        header, index: at.position, ...counts,
        text: `“${header}” is present but every row is blank, so it names no ${unitWord(candidate.unit)}.`,
      }));
      continue;
    }
    usable.push({ candidate, at, counts, header });
  }

  if (!usable.length) {
    return Object.freeze({
      ...NO_NATIVE_GROUPING,
      status: GROUPING_STATUS.none,
      dialect: dialectOf(found),
      precedence: Object.freeze({
        order, source: profile.groupingPrecedence ? "profile" : "global", rank: null,
        code: "no_candidate", beat: Object.freeze([]),
        text: `${profile.label} declares ${reports.length} grouping candidate`
          + `${reports.length === 1 ? "" : "s"}, and this export carries none of them with a value.`,
      }),
      rows: Object.freeze({ total: rows.length, grouped: 0, ungrouped: rows.length }),
      candidates: Object.freeze(reports),
      text: "This export carries no grouping column. Every row is counted, "
        + "and spend is reported for the export as a whole.",
    });
  }

  const [winner, ...losers] = usable;
  const beat = losers.map((entry) => entry.candidate.unit);
  for (const entry of losers) {
    reports.push(candidateReport(entry.candidate, {
      status: "rejected", code: CANDIDATE_REJECTIONS.outranked,
      header: entry.header, index: entry.at.position, ...entry.counts,
      text: `“${entry.header}” is usable, but ${unitWord(winner.candidate.unit)} `
        + `outranks ${unitWord(entry.candidate.unit)} in the grouping precedence order.`,
    }));
  }
  reports.push(candidateReport(winner.candidate, {
    status: "chosen", header: winner.header, index: winner.at.position, ...winner.counts,
    text: `“${winner.header}” groups this export by ${unitWord(winner.candidate.unit)}.`,
  }));
  reports.sort((left, right) => left.rank - right.rank);

  const labels = new Set();
  for (const row of rows) {
    const raw = row?.[winner.at.position];
    if (isBlank(raw)) continue;
    // Pseudonymized on the way in, so no raw project or key name is ever held on
    // this result, let alone rendered or exported.
    labels.add(orgUnitPseudonym(raw));
  }

  const precedenceCode = beat.length ? "outranked_others" : "sole_candidate";
  const precedenceText = beat.length
    ? `${beat.map(unitWord).join(" and ")} ${beat.length === 1 ? "was" : "were"} also present; `
      + `${unitWord(winner.candidate.unit)} wins because it is the most specific unit `
      + "a finance lead reads as a team's spend."
    : `${unitWord(winner.candidate.unit)} is the only grouping unit this export carries.`;

  const grouped = winner.counts.valueRows;
  const ungrouped = winner.counts.blankRows;
  return Object.freeze({
    version: NATIVE_GROUPING_VERSION,
    status: GROUPING_STATUS.native,
    dialect: dialectOf(found),
    column: Object.freeze({
      header: winner.header, index: winner.at.position, normalized: winner.at.normalized,
    }),
    unit: winner.candidate.unit,
    precedence: Object.freeze({
      order,
      source: profile.groupingPrecedence ? "profile" : "global",
      rank: winner.candidate.rank,
      code: precedenceCode,
      beat: Object.freeze(beat),
      text: precedenceText,
    }),
    units: Object.freeze({ distinct: labels.size, labels: Object.freeze([...labels].sort()) }),
    rows: Object.freeze({ total: rows.length, grouped, ungrouped }),
    candidates: Object.freeze(reports),
    gradingState: labels.size > 0 ? GRADEABLE_STATE : UNGRADEABLE_STATE,
    enrichment: EMPTY_ENRICHMENT,
    text: `Grouped by “${winner.header}” — ${labels.size} ${unitWord(winner.candidate.unit)}`
      + `${labels.size === 1 ? "" : "s"} across ${grouped} row${grouped === 1 ? "" : "s"}`
      + `${ungrouped ? `, and ${ungrouped} row${ungrouped === 1 ? "" : "s"} with no value` : ""}.`,
  });
}

function dialectOf(found) {
  return Object.freeze({
    id: found.profileId, label: found.profile.label,
    version: found.version, kind: found.kind, confidence: found.confidence,
  });
}

/**
 * Apply the optional enrichment mapping. The org file is *enrichment only*: it
 * renames units a leader already has, and every failure mode below leaves the
 * native grouping exactly as it was.
 *
 * @param {NativeGrouping} grouping the detection result to enrich.
 * @param {Array<{unit: string, department: string}>} rows the enrichment rows,
 *   already validated by the shipped import path. `unit` is the provider-native
 *   label; it is pseudonymized here with the same helper the export went
 *   through, so the two sides join without either raw string being retained.
 * @returns {NativeGrouping} a new result with `enrichment` filled in.
 *
 * Partial-failure behaviour, stated and tested:
 *   * A unit in the export with no enrichment row stays unmapped and keeps its
 *     native label. It is listed on `enrichment.unmapped`, not dropped.
 *   * An enrichment row naming a unit the export does not contain is reported
 *     on `enrichment.unknown` with `enrichment_unknown_unit`. Not fatal.
 *   * Rows that are not `{unit, department}` at all make the file malformed:
 *     `enrichment.status` is `enrichment_malformed`, `applied` is false, and the
 *     native grouping is returned untouched. A bad org file never costs the drop.
 */
export function applyGroupingEnrichment(grouping, rows) {
  const base = grouping ?? NO_NATIVE_GROUPING;
  if (rows === null || rows === undefined) return base;
  if (!Array.isArray(rows)) {
    return withEnrichment(base, malformed("The enrichment file is not a list of unit mappings."));
  }
  const mapping = new Map();
  const problems = [];
  for (const [position, row] of rows.entries()) {
    const unit = typeof row?.unit === "string" ? row.unit.trim() : "";
    const department = typeof row?.department === "string" ? row.department.trim() : "";
    if (!unit || !department) {
      problems.push(Object.freeze({
        code: ENRICHMENT_CODES.malformed, row: position,
        message: `Enrichment row ${position + 1} does not name both a unit and a department.`,
      }));
      continue;
    }
    // First row wins, so a duplicated unit is deterministic rather than
    // last-one-through. The duplicate is reported below as a problem.
    const key = orgUnitPseudonym(unit);
    if (mapping.has(key)) {
      problems.push(Object.freeze({
        code: ENRICHMENT_CODES.malformed, row: position,
        message: `Enrichment row ${position + 1} repeats a unit already mapped; the first mapping stands.`,
      }));
      continue;
    }
    mapping.set(key, department);
  }
  // Every row unusable is a malformed file, not an empty mapping: an empty
  // mapping would silently look like "nothing matched" and read as the reader's
  // fault rather than the file's.
  if (!mapping.size && problems.length) {
    return withEnrichment(base, malformed("No enrichment row named both a unit and a department.", problems));
  }

  const present = new Set(base.units?.labels ?? []);
  const mapped = [];
  const unmapped = [];
  for (const label of present) {
    if (mapping.has(label)) mapped.push(Object.freeze({ unit: label, department: mapping.get(label) }));
    else unmapped.push(label);
  }
  const unknown = [...mapping.entries()]
    .filter(([label]) => !present.has(label))
    .map(([label, department]) => Object.freeze({
      unit: label, department, code: ENRICHMENT_CODES.unknownUnit,
    }));

  return withEnrichment(base, Object.freeze({
    applied: mapped.length > 0,
    status: unmapped.length || unknown.length
      ? ENRICHMENT_CODES.partial
      : ENRICHMENT_CODES.complete,
    mapped: Object.freeze(mapped),
    unmapped: Object.freeze(unmapped),
    unknown: Object.freeze(unknown),
    problems: Object.freeze(problems),
  }));
}

function malformed(message, problems = []) {
  return Object.freeze({
    ...EMPTY_ENRICHMENT,
    status: ENRICHMENT_CODES.malformed,
    problems: Object.freeze([
      Object.freeze({ code: ENRICHMENT_CODES.malformed, row: null, message }),
      ...problems,
    ]),
  });
}

function withEnrichment(grouping, enrichment) {
  return Object.freeze({ ...grouping, enrichment });
}

/**
 * Runtime shape check, so a consumer's fixture pins the contract rather than
 * trusting it. Throws with the offending field named.
 */
export function assertNativeGrouping(value) {
  const where = "native grouping result";
  if (!value || typeof value !== "object") throw new Error(`${where}: not an object`);
  if (value.version !== NATIVE_GROUPING_VERSION) throw new Error(`${where}: wrong version`);
  if (!Object.values(GROUPING_STATUS).includes(value.status)) {
    throw new Error(`${where}: unknown status ${value.status}`);
  }
  for (const field of ["dialect", "column", "unit", "precedence", "units", "rows",
    "candidates", "gradingState", "enrichment", "text"]) {
    if (!Object.hasOwn(value, field)) throw new Error(`${where}: missing field ${field}`);
  }
  if (value.status === GROUPING_STATUS.native) {
    if (!value.column?.header) throw new Error(`${where}: native result names no column`);
    if (!value.unit) throw new Error(`${where}: native result names no unit`);
  } else if (value.column !== null || value.unit !== null) {
    throw new Error(`${where}: a non-native result must carry a null column and unit`);
  }
  for (const label of value.units.labels) {
    if (!String(label).startsWith("psn_unit_")) {
      throw new Error(`${where}: unit label is not pseudonymized`);
    }
  }
  return value;
}
