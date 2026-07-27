// The mapping model for the column-review step: one explicit state describing
// what every column in the reader's own file became, and nothing else.
//
// It sits between the delimited reader (`readDelimitedText`) and the shipped
// normalizer (`parseDelimitedFinopsFile`). It parses nothing and renders
// nothing: `import-mapping-view.js` paints it, `evolution-page.js` hands the
// binding it produces back to the same normalizer the auto-detected path uses.
//
// Two rules hold everywhere in here:
//   1. Every column of the file is present in the state, in file order, with its
//      header verbatim — duplicates, blanks, and hostile strings included. A
//      column the reader cannot see is a column they cannot correct.
//   2. Nothing that can be derived is stored. Which required fields are still
//      unmapped, and which fields two columns both claim, are computed from the
//      columns on every read, so an edit can never leave a stale verdict behind.

import {
  CONVERSATION_DIALECT_PROFILES, columnNames, neverRenderColumns, normalizeColumnName,
} from "./dialect-profiles.js";
import { detectShape } from "./finops-tabular-import.js";
import { GROUPING_STATUS, detectNativeGrouping } from "./native-grouping.js";

/** The target that says, in the reader's words, "this column becomes nothing". */
export const IGNORED_TARGET = "ignored";

/** What kind of file this is. The reader may correct this too. */
export const IMPORT_KINDS = Object.freeze([
  Object.freeze({
    id: "provider",
    label: "Provider usage export",
    detail: "Dated rows of model usage and cost, one line per usage record.",
  }),
  Object.freeze({
    id: "hris",
    label: "HRIS org mapping",
    detail: "One row per org unit, with its parent and whether it is active.",
  }),
]);

const target = (field, label, required, consequence) =>
  Object.freeze({ field, label, required, consequence });

/**
 * The closed vocabulary a column may become, per kind, in the order the step
 * lists them. `consequence` is what the analysis loses if nothing supplies the
 * field — stated in product terms, because "required field missing" tells a
 * reader nothing about what they are about to not find out.
 */
export const MAPPING_TARGETS = Object.freeze({
  provider: Object.freeze([
    target("date", "Usage date", true,
      "No row can be dated, so no period, no trend, and no total are computed. The analysis cannot run without it."),
    target("orgUnit", "Org unit or cost centre", true,
      "No row can be attributed to a team, so nothing joins your HRIS mapping and no department finding exists. The analysis cannot run without it."),
    target("model", "Model or SKU", true,
      "No row can be classified into a service category, so spend cannot be split by what it was spent on. The analysis cannot run without it."),
    target("amount", "Cost amount", true,
      "There is no spend to total, so the headline number and the recoverable scenario cannot be computed. The analysis cannot run without it."),
    target("currency", "Currency code", false,
      "Every row is read as USD. A row priced in another currency is reported and skipped, never converted behind you."),
    target("inputTokens", "Input tokens", false,
      "Input volume counts as zero. Spend, trend, and the department finding are unaffected."),
    target("outputTokens", "Output tokens", false,
      "Output volume counts as zero. Spend, trend, and the department finding are unaffected."),
    target("quantity", "Usage quantity", false,
      "Usage volume counts as zero, so per-unit figures are unavailable. Spend still totals."),
    target("requests", "Request or call count", false,
      "Calls per model are unknown, so tokens per call cannot be checked and the per-model routing figure is published at a lower confidence tier."),
    target("provider", "Provider name", false,
      "Every row is attributed to one provider, so a mixed export cannot be split by vendor."),
    target("status", "Cost status", false,
      "Every row is recorded as final rather than estimated."),
  ]),
  hris: Object.freeze([
    target("orgUnit", "Unit name or id", true,
      "No org unit is created, so no provider row can join a department and no finding is produced. The analysis cannot run without it."),
    target("parent", "Parent unit", false,
      "Units are recorded without a parent, so the roster is flat and rollups by division are unavailable."),
    target("unitType", "Unit type", false,
      "Every unit is recorded as a department."),
    target("active", "Active flag", false,
      "Every unit is treated as active, so departed teams still receive spend."),
  ]),
});

/** Longest sample shown before it is cut. The full value stays on the state. */
export const SAMPLE_DISPLAY_LIMIT = 48;

// A cut that lands inside a grapheme is visible as a broken character, so the
// boundary walks back off zero-width joiners, variation selectors, combining
// marks, and regional indicators before the ellipsis is added.
const CONTINUATION = /[‍︎️̀-ͯ\u{1f3fb}-\u{1f3ff}\u{1f1e6}-\u{1f1ff}]/u;

function truncateSample(value) {
  const points = [...value];
  if (points.length <= SAMPLE_DISPLAY_LIMIT) return value;
  let cut = SAMPLE_DISPLAY_LIMIT;
  while (cut > 1 && (CONTINUATION.test(points[cut]) || CONTINUATION.test(points[cut - 1]))) cut -= 1;
  const head = points.slice(0, cut);
  const space = head.lastIndexOf(" ");
  const wrapped = space >= cut - 12 && space > 0 ? head.slice(0, space) : head;
  return `${wrapped.join("").trimEnd()}…`;
}

/**
 * A real value out of the reader's own column: the first non-empty cell. An
 * entirely empty column says so in words rather than rendering a blank cell,
 * because a blank cell and "we could not find one" look identical.
 */
function sampleFor(rows, index, hasRows) {
  for (const row of rows) {
    const raw = row?.values?.[index];
    if (raw === undefined || String(raw).trim() === "") continue;
    const value = String(raw);
    return Object.freeze({
      available: true, value, display: truncateSample(value),
      truncated: truncateSample(value) !== value, note: "",
    });
  }
  return Object.freeze({
    available: false, value: "", display: "", truncated: false,
    note: hasRows ? "Every row is empty in this column." : "This file has no data rows.",
  });
}

/**
 * The header spellings the conversation-export contract marks never-render,
 * read off the profiles rather than listed here — see
 * `docs/conversation-export-import-contract.md`.
 *
 * This step is the one place in the flow that shows a reader a cell of their own
 * file, and a reader may well drop an assistant conversation export into the
 * picker even though nothing here imports one yet. When they do, the column is
 * still listed, still mappable, and still theirs to correct; the *sample* is
 * withheld, because "no prompt text is ever rendered" has to hold on the manual
 * path too or it is not a rule.
 */
const NEVER_RENDER_HEADERS = new Set(CONVERSATION_DIALECT_PROFILES
  .flatMap((profile) => neverRenderColumns(profile))
  .flatMap((entry) => columnNames(entry)));

const WITHHELD_SAMPLE = Object.freeze({
  available: false, value: "", display: "", truncated: false,
  note: "Prompt text is never shown. This column is measured, not read.",
});

/** A blank header is still a column; it is named by its position instead. */
function headerLabel(header, index) {
  const text = String(header ?? "").trim();
  return text === "" ? `Column ${index + 1} (no header)` : text;
}

const targetsFor = (kind) => MAPPING_TARGETS[kind] ?? MAPPING_TARGETS.provider;

const targetLabel = (kind, field) => field === IGNORED_TARGET
  ? "Ignore this column"
  : targetsFor(kind).find((entry) => entry.field === field)?.label ?? "Ignore this column";

/**
 * Build the mapping state for one delimited file.
 *
 * `reading` is exactly what `readDelimitedText` returns. `detection` is what
 * `detectShape` returns for that header row; passing it in keeps this module
 * testable without a parser, and the default keeps the page call to one line.
 * When nothing was recognized, every column arrives unset and the step is still
 * completable by hand — an undetected file is a starting point, not a dead end.
 *
 * `nativeGrouping` is the versioned grouping contract from `native-grouping.js`.
 * It is stored whole on the state so the review surface can show its work — the
 * chosen column, why it beat the others, and which candidates were rejected and
 * for what reason — and it proposes the `orgUnit` target when the shape's own
 * aliases missed the column the export was already grouped by.
 */
export function createColumnMapping({
  reading, fileName = "export.csv", detection = null, nativeGrouping = null,
} = {}) {
  const header = [...(reading?.header ?? [])];
  const rows = reading?.rows ?? [];
  const detected = detection ?? detectShape(header);
  const grouping = nativeGrouping ?? detectNativeGrouping({
    columns: header, rows: rows.map((row) => row?.values ?? []),
  });
  const recognized = Boolean(detected?.recognized);
  const kind = recognized ? detected.shape.kind : "provider";
  const bound = recognized ? detected.bound : {};
  const known = new Set(targetsFor(kind).map((entry) => entry.field));
  const claimed = new Map();
  for (const [field, index] of Object.entries(bound)) {
    if (known.has(field) && !claimed.has(index)) claimed.set(index, field);
  }
  // The export's own grouping column fills `orgUnit` when nothing else claimed
  // it. It is recorded as `native` rather than `detected`, because the reader is
  // owed the difference between "your file says so" and "we guessed".
  const nativeIndex = kind === "provider" && grouping.status === GROUPING_STATUS.native
    ? grouping.column.index : null;
  const nativeClaimed = nativeIndex !== null
    && !claimed.has(nativeIndex)
    && ![...claimed.values()].includes("orgUnit");
  if (nativeClaimed) claimed.set(nativeIndex, "orgUnit");
  const ragged = rows.filter((row) => (row?.values?.length ?? 0) !== header.length).length;

  return freezeState({
    nativeGrouping: grouping,
    fileName: String(fileName ?? ""),
    kind,
    kindOrigin: recognized ? "detected" : "unset",
    shapeId: recognized ? detected.shape.id : null,
    shapeLabel: recognized ? detected.shape.label : null,
    providerFallback: recognized ? detected.shape.provider ?? "other" : "other",
    dataRowCount: rows.length,
    raggedRowCount: ragged,
    columns: header.map((text, index) => ({
      index,
      header: String(text ?? ""),
      label: headerLabel(text, index),
      blankHeader: String(text ?? "").trim() === "",
      target: claimed.get(index) ?? IGNORED_TARGET,
      origin: nativeClaimed && index === nativeIndex
        ? "native"
        : claimed.has(index) ? "detected" : "unset",
      sample: NEVER_RENDER_HEADERS.has(normalizeColumnName(text))
        ? WITHHELD_SAMPLE
        : sampleFor(rows, index, rows.length > 0),
    })),
  });
}

function freezeState(state) {
  return Object.freeze({
    ...state,
    columns: Object.freeze(state.columns.map((column) => Object.freeze({ ...column }))),
  });
}

/** Re-point one column. The reader's choice is recorded as theirs, not detected. */
export function setColumnTarget(state, index, next) {
  const allowed = next === IGNORED_TARGET
    || targetsFor(state.kind).some((entry) => entry.field === next);
  if (!allowed) return state;
  return freezeState({
    ...state,
    columns: state.columns.map((column) => column.index === index
      ? { ...column, target: next, origin: "chosen" }
      : { ...column }),
  });
}

/**
 * Correct what kind of file this is. Targets that exist in the new vocabulary
 * survive — `orgUnit` means the same thing in both — and the rest fall back to
 * ignored rather than silently pointing at a field that no longer exists.
 */
export function setMappingKind(state, kind) {
  if (!IMPORT_KINDS.some((entry) => entry.id === kind) || kind === state.kind) return state;
  const known = new Set(targetsFor(kind).map((entry) => entry.field));
  return freezeState({
    ...state,
    kind,
    kindOrigin: "chosen",
    columns: state.columns.map((column) => ({
      ...column,
      target: known.has(column.target) ? column.target : IGNORED_TARGET,
      origin: known.has(column.target) ? column.origin : "unset",
    })),
  });
}

/** Which columns claim each mapped field, in file order. Derived, never stored. */
export function claimsByField(state) {
  const claims = new Map();
  for (const column of state.columns) {
    if (column.target === IGNORED_TARGET) continue;
    if (!claims.has(column.target)) claims.set(column.target, []);
    claims.get(column.target).push(column.index);
  }
  return claims;
}

/**
 * Everything that is wrong with the mapping right now, split by whether it stops
 * the analysis or only narrows it.
 *
 * A blocker gates confirmation and says why the analysis cannot run at all. A
 * warning names the portion of the result that will be missing and lets the
 * reader proceed knowingly — the difference the reader cares about is "will I
 * get nothing" versus "will I get less", so the model draws it explicitly.
 */
export function mappingIssues(state) {
  const claims = claimsByField(state);
  const blockers = [];
  const warnings = [];

  if (state.columns.length === 0) {
    blockers.push(Object.freeze({
      id: "no-columns", code: "no_columns", field: null, columns: Object.freeze([]),
      message: "This file has no columns to map.",
      consequence: "Nothing can be normalized from it. Choose a delimited export with a header row.",
    }));
  }
  if (state.dataRowCount === 0) {
    blockers.push(Object.freeze({
      id: "no-data-rows", code: "no_data_rows", field: null, columns: Object.freeze([]),
      message: "This file has a header row and no data rows.",
      consequence: "There is nothing to normalize, so confirming would produce no number at all. "
        + "Re-export the period with its rows, or choose a different file.",
    }));
  }
  for (const entry of targetsFor(state.kind)) {
    const columns = claims.get(entry.field) ?? [];
    if (entry.required && columns.length === 0) {
      blockers.push(Object.freeze({
        id: `unmapped-${entry.field}`, code: "unmapped_required", field: entry.field,
        columns: Object.freeze([]),
        message: `No column becomes ${entry.label}.`,
        consequence: entry.consequence,
      }));
    }
    if (!entry.required && columns.length === 0) {
      warnings.push(Object.freeze({
        id: `omitted-${entry.field}`, code: "omitted_optional", field: entry.field,
        columns: Object.freeze([]),
        message: `No column becomes ${entry.label}.`,
        consequence: entry.consequence,
      }));
    }
    if (columns.length > 1) {
      // The last column would otherwise win silently, and the reader would never
      // learn which of their two columns the number came from.
      blockers.push(Object.freeze({
        id: `duplicate-${entry.field}`, code: "duplicate_target", field: entry.field,
        columns: Object.freeze([...columns]),
        message: `${columns.map((index) => `Column ${index + 1}`).join(" and ")} both become ${entry.label}.`,
        consequence: "Only one column can supply a field, and this step will not choose for you. "
          + "Set every column but one to “Ignore this column”.",
      }));
    }
  }
  if (state.raggedRowCount > 0) {
    warnings.push(Object.freeze({
      id: "ragged-rows", code: "ragged_rows", field: null, columns: Object.freeze([]),
      message: `${state.raggedRowCount} of ${state.dataRowCount} rows carry a different number of `
        + "cells than the header row.",
      consequence: "Those rows are reported and skipped when the analysis runs; the rest still count.",
    }));
  }
  return Object.freeze({
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(warnings),
    confirmable: blockers.length === 0,
  });
}

/** The per-column validation message, or null. Used to describe the control. */
export function columnIssue(state, index, issues = mappingIssues(state)) {
  return issues.blockers.find((issue) => issue.columns.includes(index)) ?? null;
}

/** A one-line answer to "where is this step", for the status region and caption. */
export function mappingSummary(state, issues = mappingIssues(state)) {
  const mapped = state.columns.filter((column) => column.target !== IGNORED_TARGET).length;
  const detected = state.columns
    .filter((column) => column.origin === "detected" || column.origin === "native").length;
  const source = state.shapeLabel
    ? `Recognized as ${state.shapeLabel}; ${detected} of ${state.columns.length} columns were proposed for you.`
    : "No known export shape matched this file, so nothing was proposed. Map the columns you need.";
  const outcome = issues.confirmable
    ? `${mapped} of ${state.columns.length} columns are mapped. Ready to run the analysis.`
    : `${mapped} of ${state.columns.length} columns are mapped. `
      + `${issues.blockers.length} thing${issues.blockers.length === 1 ? "" : "s"} must be resolved first.`;
  return Object.freeze({
    source, outcome, mapped, detected,
    grouping: groupingSentence(state.nativeGrouping),
    text: `${source} ${outcome}`,
  });
}

/**
 * The grouping step's own sentence, composed from the contract's machine-
 * readable fields rather than from a prose blob: what the export is grouped by,
 * why that column won, and — where they exist — the candidates that lost and
 * their reason. No org file is mentioned, because none is required.
 */
export function groupingSentence(grouping) {
  if (!grouping || grouping.status === "unidentified") return "";
  if (grouping.status !== "native") {
    return `${grouping.text} No org file is needed to proceed; one would only add department names.`;
  }
  const rejected = grouping.candidates.filter((candidate) => candidate.status === "rejected"
    && candidate.header !== null);
  const shown = rejected.map((candidate) => candidate.text).join(" ");
  const unassigned = grouping.rows.ungrouped
    ? ` ${grouping.rows.ungrouped} row${grouping.rows.ungrouped === 1 ? "" : "s"} carry no `
      + "value in it and are counted separately rather than pooled into an invented unit."
    : "";
  return `${grouping.text} ${grouping.precedence.text}${shown ? ` ${shown}` : ""}${unassigned}`;
}

export const mappingTargetLabel = targetLabel;

/**
 * The binding the shipped normalizer takes: which column index supplies each
 * canonical field, plus what the file is. It is only produced for a mapping
 * that has no blockers, so a duplicate or an unmapped required field can never
 * reach the parser as a silent last-one-wins.
 */
export function mappingBinding(state) {
  const issues = mappingIssues(state);
  if (!issues.confirmable) return null;
  const bound = {};
  for (const column of state.columns) {
    if (column.target === IGNORED_TARGET) continue;
    bound[column.target] = column.index;
  }
  return Object.freeze({
    kind: state.kind,
    shapeId: state.shapeId,
    provider: state.providerFallback,
    bound: Object.freeze(bound),
  });
}
