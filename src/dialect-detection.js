// Detection and normalization over the dialect profile registry.
//
// INPUT — the seam with the tabular parser.
//
// Everything here takes a *table*, not bytes:
//
//   { columns: string[], rows: string[][], delimiter?, headerRowIndex? }
//
// That is the detection output a tabular parser is expected to produce. This
// module deliberately does not read files, sniff delimiters, or split lines:
// the repository's shipped importer is JSON-only (`parseLocalFinopsFile`
// rejects CSV outright) and no tabular parser has landed yet, so rather than
// ship a second parser this layer is written against the contract the parser
// will satisfy. When it lands, its result object feeds `detectDialect` as-is.
//
// THE CONFIDENCE RULE — two mechanisms, stated once, here.
//
//  1. Hard gate. A profile is a *candidate* only if the file carries EVERY one
//     of its required columns, carries at least `match.minColumns` columns, and
//     carries none of its `match.forbidden` columns. One missing required
//     column disqualifies it outright — a file that half-resembles a profile is
//     never forced onto it.
//  2. Confidence. For a candidate, confidence is the share of that profile's
//     declared match signals the file actually carries:
//
//        confidence = (required + optionalPresent) / (required + optional)
//
//     Required columns are all present by rule 1, so confidence is bounded
//     below by required/(required+optional) and above by 1. MIN_CONFIDENCE is
//     0.7: a candidate below it resolves to `unidentified`. In practice that
//     means "every required column, plus at least one corroborating optional
//     signal" — a profile whose required set is generic enough to be satisfied
//     by accident does not win on the required columns alone.
//
// The highest-confidence candidate wins. An exact tie between two candidates is
// `unidentified` — ambiguity is reported, never resolved by registry order.
//
// A match is a *suggestion*. The result always carries the parsed columns and
// rows and a per-field mapping the caller may override field by field, so a
// detected profile can never hard-block manual mapping.

import {
  COERCIONS, DIALECT_PROFILES, NORMALIZED_FIELDS, OPTIONAL_NORMALIZED_FIELDS,
  columnNames, matchSignals, normalizeColumnName,
} from "./dialect-profiles.js";

/** Stated in the comment above; changing it is a behaviour change. */
export const MIN_CONFIDENCE = 0.7;

const round3 = (value) => Math.round(value * 1000) / 1000;

/**
 * Normalized header -> first column index carrying it. First wins: a vendor
 * that repeats a header gets the leftmost copy, deterministically.
 */
function indexColumns(columns) {
  const index = new Map();
  columns.forEach((name, position) => {
    const key = normalizeColumnName(name);
    if (key && !index.has(key)) index.set(key, position);
  });
  return index;
}

/** The first accepted spelling of this column present in the file, if any. */
function locate(entry, index) {
  for (const name of columnNames(entry)) {
    if (index.has(name)) return { name, position: index.get(name) };
  }
  return null;
}

/** Score one profile against a header index. Returns confidence 0 if excluded. */
export function scoreProfile(profile, columns) {
  const index = indexColumns(columns);
  const { forbidden } = matchSignals(profile);
  if (columns.length < profile.match.minColumns) {
    return { profileId: profile.id, confidence: 0, reason: "too few columns" };
  }
  for (const name of forbidden) {
    if (index.has(name)) {
      return { profileId: profile.id, confidence: 0, reason: `carries ${name}, which this profile excludes` };
    }
  }
  let required = 0;
  let optional = 0;
  let optionalPresent = 0;
  const missing = [];
  for (const entry of profile.columns) {
    const found = locate(entry, index);
    if (entry.required) {
      required += 1;
      if (!found) missing.push(entry.source);
    } else {
      optional += 1;
      if (found) optionalPresent += 1;
    }
  }
  if (missing.length) {
    return {
      profileId: profile.id,
      confidence: 0,
      reason: `missing required column${missing.length === 1 ? "" : "s"} ${missing.join(", ")}`,
    };
  }
  return {
    profileId: profile.id,
    confidence: round3((required + optionalPresent) / (required + optional)),
    reason: "all required columns present",
  };
}

/**
 * Identify the dialect of a parsed table. Always returns the columns and rows
 * it was given, matched or not, so the manual mapping path is unchanged.
 */
export function detectDialect(table, profiles = DIALECT_PROFILES) {
  const columns = [...(table?.columns ?? [])];
  const rows = table?.rows ?? [];
  const scores = profiles
    .map((profile) => scoreProfile(profile, columns))
    .filter((score) => score.confidence > 0)
    .sort((left, right) => right.confidence - left.confidence);

  const base = {
    columns, rows,
    delimiter: table?.delimiter ?? null,
    headerRowIndex: table?.headerRowIndex ?? null,
    candidates: Object.freeze(scores.map((score) => Object.freeze({ ...score }))),
  };
  // An unidentified table is grouped by nothing this layer can name. It is a
  // stated absence, not an omitted key: a consumer that joins on the grouping
  // unit reads `null` and says so, rather than reading `undefined` and guessing.
  const unidentified = (reason) => Object.freeze({
    ...base, status: "unidentified", profileId: null, profile: null,
    version: null, kind: null, groupingUnit: null,
    confidence: scores[0]?.confidence ?? 0, mapping: [], reason,
  });

  if (!scores.length) return unidentified("no profile's required columns are all present");
  if (scores.length > 1 && scores[0].confidence === scores[1].confidence) {
    return unidentified(`ambiguous between ${scores[0].profileId} and ${scores[1].profileId}`);
  }
  if (scores[0].confidence < MIN_CONFIDENCE) {
    return unidentified(`best candidate ${scores[0].profileId} scored `
      + `${scores[0].confidence}, below the ${MIN_CONFIDENCE} threshold`);
  }
  const profile = profiles.find((candidate) => candidate.id === scores[0].profileId);
  return Object.freeze({
    ...base,
    status: "matched",
    profileId: profile.id,
    profile,
    version: profile.version,
    kind: profile.kind,
    // The provider-native unit this export is grouped by, republished off the
    // matched profile so a consumer never maps a profile id back to a unit.
    groupingUnit: profile.groupingUnit,
    confidence: scores[0].confidence,
    mapping: planMapping(profile, columns),
    reason: scores[0].reason,
  });
}

/**
 * The pre-filled mapping a matched profile offers the import panel: one row per
 * normalized field, naming the column it came from and where the value comes
 * from when no column carries it. Every row is overridable by the reader.
 */
export function planMapping(profile, columns) {
  const index = indexColumns(columns);
  const plan = [];
  for (const entry of profile.columns) {
    if (entry.field === null) continue;
    const found = locate(entry, index);
    if (found) {
      plan.push(Object.freeze({
        field: entry.field, column: columns[found.position], columnIndex: found.position,
        coerce: entry.coerce, required: entry.required, origin: "column",
      }));
    } else if (entry.whenAbsent?.mode === "default") {
      plan.push(Object.freeze({
        field: entry.field, column: null, columnIndex: null, coerce: entry.coerce,
        required: entry.required, origin: "default", value: entry.whenAbsent.value,
      }));
    }
  }
  for (const [field, value] of Object.entries(profile.constants)) {
    plan.push(Object.freeze({
      field, column: null, columnIndex: null, coerce: "string",
      required: true, origin: "constant", value,
    }));
  }
  return Object.freeze(plan);
}

/**
 * Apply a profile to a parsed table.
 *
 * `overrides` is `{ field: columnIndex | null }` — the reader's manual mapping,
 * which always wins over the profile. `null` drops a field, which surfaces as a
 * row issue if the field is required, never as a silent omission.
 *
 * A row that fails coercion on a required field is not emitted; it becomes an
 * entry in `issues` naming the row, the column, the field and the reason, so a
 * partial file still yields the rows that are good.
 */
export function applyDialectProfile(profile, table, { overrides = {} } = {}) {
  const columns = [...(table?.columns ?? [])];
  const plan = planMapping(profile, columns).map((step) => {
    if (!Object.hasOwn(overrides, step.field)) return step;
    const columnIndex = overrides[step.field];
    if (columnIndex === null || columnIndex === undefined) return { ...step, origin: "dropped" };
    return { ...step, origin: "column", columnIndex, column: columns[columnIndex] ?? null };
  });
  for (const [field, columnIndex] of Object.entries(overrides)) {
    if (plan.some((step) => step.field === field)) continue;
    if (columnIndex === null || columnIndex === undefined) continue;
    const known = NORMALIZED_FIELDS[profile.kind].includes(field);
    if (!known) continue;
    plan.push({
      field, column: columns[columnIndex] ?? null, columnIndex,
      coerce: "string", required: true, origin: "column",
    });
  }

  const optionalFields = OPTIONAL_NORMALIZED_FIELDS[profile.kind];
  const attempted = new Set(plan.filter((step) => step.origin !== "dropped").map((step) => step.field));
  const mappedColumns = new Set(plan
    .filter((step) => step.origin === "column")
    .map((step) => step.columnIndex));
  const records = [];
  const issues = [];

  (table?.rows ?? []).forEach((row, rowIndex) => {
    const record = {};
    let failed = false;
    for (const step of plan) {
      if (step.origin === "dropped") continue;
      if (step.origin === "constant" || step.origin === "default") {
        record[step.field] = step.value;
        continue;
      }
      const raw = row[step.columnIndex];
      if (raw === undefined || String(raw).trim() === "") {
        if (step.required) {
          issues.push(issue(rowIndex, step, "missing_value", "is empty"));
          failed = true;
        }
        continue;
      }
      try {
        record[step.field] = COERCIONS[step.coerce](raw);
      } catch (error) {
        if (step.required) failed = true;
        issues.push(issue(rowIndex, step, "invalid_value", error.message));
      }
    }
    // A non-optional field that did not come out of the row fails it, whatever
    // the cause — so an incomplete record is never emitted. It only earns a
    // second `unmapped_field` issue when nothing even tried to supply it; a
    // column that was present but uncoercible already has its precise issue.
    for (const field of NORMALIZED_FIELDS[profile.kind]) {
      if (optionalFields.includes(field) || Object.hasOwn(record, field)) continue;
      if (!attempted.has(field)) {
        issues.push({
          row: rowIndex, column: null, field, code: "unmapped_field",
          message: `no column or default supplies ${field}`,
        });
      }
      failed = true;
    }
    if (!failed) records.push(orderRecord(record, NORMALIZED_FIELDS[profile.kind]));
  });

  return Object.freeze({
    profileId: profile.id,
    version: profile.version,
    kind: profile.kind,
    records: Object.freeze(records),
    issues: Object.freeze(issues.map((entry) => Object.freeze(entry))),
    unmappedColumns: Object.freeze(columns.filter((_, position) => !mappedColumns.has(position))),
  });
}

function issue(row, step, code, message) {
  return { row, column: step.column, field: step.field, code, message: `${step.field} ${message}` };
}

/** Deterministic key order, so a full-record assertion is stable. */
function orderRecord(record, fields) {
  const ordered = {};
  for (const field of fields) if (Object.hasOwn(record, field)) ordered[field] = record[field];
  return Object.freeze(ordered);
}

/**
 * Detect and, if a profile matched, normalize — the whole layer in one call.
 * An unidentified table returns its columns and rows and no records, which is
 * exactly the manual-mapping path the import flow already has.
 */
export function normalizeTable(table, { overrides = {}, profiles = DIALECT_PROFILES } = {}) {
  const detection = detectDialect(table, profiles);
  if (detection.status !== "matched") {
    return Object.freeze({ detection, normalized: null });
  }
  return Object.freeze({
    detection,
    normalized: applyDialectProfile(detection.profile, table, { overrides }),
  });
}
