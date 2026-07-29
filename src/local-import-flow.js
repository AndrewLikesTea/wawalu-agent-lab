// Reading layer for the browser-local import and mapping surface.
//
// evolution-page.js still owns the file reading, the parse call, and the result
// render; this module owns what the surface *says* about where it is. It names
// the three stages the shipped flow already walks, decides which requirement is
// still unresolved, decides whether the headline number is a real number, and
// scrubs every diagnostic before it reaches visible text or a live region.
//
// Two rules hold everywhere in here:
//   1. Nothing is signalled by color alone. Every state ships a word and a
//      shape alongside whatever the stylesheet tints.
//   2. Nothing read out of a selected file reaches the DOM. Diagnostics name
//      contract fields and the position of a file in the selection; record
//      identifiers, export IDs, and file names are replaced before display.

import {
  ORG_MAPPING_REQUIREMENT_STATUS, OPTIONAL_UPGRADES,
} from "./finops-attribution-policy.js";
import { importLimitsSentence } from "./import-limits.js";
// Every sentence a briefing or evidence panel says when it has no figure is
// authored in one module, so "nothing yet" reads the same on every surface.
import { BRIEFING_CONFIDENCE_LABEL, BRIEFING_STATE_MESSAGE } from "./briefing-strings.js";
// The two authored sentences a reopened briefing needs. They live with the
// reader that produced the briefing, not here, so the dates in them are the
// file's own and this layer cannot invent a third wording for them.
import { capturedPeriodLine, EXAMPLE_DATASET_LINE } from "./finops-briefing-restore.js";
import { renderBriefingDerivation } from "./finops-briefing-derivation-view.js";

/** The stages the shipped flow already walks. Naming them does not add one. */
export const IMPORT_STAGES = Object.freeze([
  Object.freeze({ id: "select", label: "Choose files" }),
  Object.freeze({ id: "check", label: "Check the mapping" }),
  Object.freeze({ id: "read", label: "Read the result" }),
]);

const STAGE_STATE_TEXT = Object.freeze({
  complete: { status: "done", shape: "✓" },
  current: { status: "now", shape: "●" },
  remaining: { status: "next", shape: "○" },
});

/**
 * Which stage the surface is in, from what has actually been loaded. Reviewing a
 * column mapping *is* the check stage — it is the one place the reader is shown
 * what their columns became — so it names the stage even before a file has
 * finished parsing into a loaded input.
 */
export function importStage({
  providers = 0, hris = false, hasResult = false, reviewing = false,
} = {}) {
  if (reviewing) return "check";
  if (hasResult) return "read";
  if (providers > 0 || hris) return "check";
  return "select";
}

/**
 * Current / completed / remaining for every stage, with the word and glyph the
 * indicator renders. Assistive tech gets `aria-current` on the current step;
 * everyone gets the word.
 */
export function stageProgress(stageId) {
  const index = Math.max(0, IMPORT_STAGES.findIndex((stage) => stage.id === stageId));
  return IMPORT_STAGES.map((stage, position) => {
    const state = position < index ? "complete" : position === index ? "current" : "remaining";
    return Object.freeze({
      ...stage,
      state,
      position: position + 1,
      status: STAGE_STATE_TEXT[state].status,
      shape: STAGE_STATE_TEXT[state].shape,
    });
  });
}

/**
 * One row per input the mapping needs. `control` is the id of the control that
 * resolves the row, so a summary entry can move focus to it rather than leaving
 * the reader to hunt for the field the message is about.
 *
 * The org mapping is **optional enrichment**, not a requirement — the state
 * `finops-attribution-policy.js` calls `PROVIDER_PLUS_ORG_MAPPING`, which is a
 * precision upgrade over `PROVIDER_PLUS_GROUPING` rather than a gate in front of
 * it. The status word is imported from that module so the requirement row and
 * the policy that classifies findings cannot drift. A provider
 * export carries its own grouping column — project, workspace, key alias, cost
 * tag — and `native-grouping.js` reads it, so a drop with no org file succeeds
 * and attributes spend under the export's own labels. The row therefore reports
 * `optional` rather than `missing`: nothing about it blocks the analysis, and
 * the only thing it adds is a department name over units a leader already has.
 */
export function mappingRequirements({
  providers = 0, hris = false, samples = 0, upgrades = null,
} = {}) {
  // The concrete gain each optional input buys. The standing sentence is the
  // policy's; once a share has actually been measured, the matching entry from
  // `rankedCoverageUpgrades` replaces it with the reader's own projected
  // coverage. Neither is authored here.
  const measuredGain = (id) => (upgrades?.all ?? []).find((entry) => entry.id === id)?.text ?? null;
  const optional = (definition, ready, readyStatus, gainId) => Object.freeze({
    id: definition.id,
    name: definition.name,
    control: "local-finops-files",
    required: false,
    // Required versus optional is a word, not a tint and not an inference from
    // the state value. It is what the accessible name carries.
    kindLabel: "Optional",
    state: ready ? "ready" : "optional",
    shape: ready ? "✓" : "+",
    status: ready ? readyStatus : definition.status,
    gain: measuredGain(gainId) ?? definition.gain,
  });
  return [
    Object.freeze({
      id: "provider",
      name: "Provider period export",
      control: "local-finops-files",
      required: true,
      kindLabel: "Required",
      state: providers > 0 ? "ready" : "missing",
      shape: providers > 0 ? "✓" : "○",
      status: providers > 0
        ? `${providers} period${providers === 1 ? "" : "s"} ready`
        : "not selected",
      gain: "",
    }),
    optional(
      Object.freeze({
        ...OPTIONAL_UPGRADES.ORG_MAPPING,
        // The row keeps the id the rest of this flow addresses it by; the gain
        // and the status word are still the policy's.
        id: "hris",
        name: "Department names (optional)",
        status: `${ORG_MAPPING_REQUIREMENT_STATUS}; your export's own grouping is used`,
      }),
      hris, "1 mapping ready", OPTIONAL_UPGRADES.ORG_MAPPING.id,
    ),
    optional(OPTIONAL_UPGRADES.QUERY_SAMPLE, samples > 0,
      `${samples} sample${samples === 1 ? "" : "s"} ready`, OPTIONAL_UPGRADES.QUERY_SAMPLE.id),
  ];
}

/**
 * The one provenance label for the bundled example dataset. It is written once,
 * here, and every surface that renders example numbers reads it — the badge, the
 * metric basis, the notes painted by `applyDatasetProvenance`, and the download
 * artifacts. A second wording anywhere is a defect, because the two would drift.
 */
export const EXAMPLE_DATASET_PROVENANCE = Object.freeze({
  label: "Example data — not your data",
  detail: "Computed from a bundled synthetic provider export and org roster.",
  swap: "To replace it, choose your own provider export in the import panel.",
});

/**
 * What the headline number is, in words, right next to the number. The metric
 * area is never allowed to be ambiguous about whether a figure is real, so
 * every non-real condition returns `real: false` and its own label.
 */
export function metricBasis({
  mode = "example", joinedRecords = 0, departments = 0, plausible = true,
  providers = 0, hris = false,
} = {}) {
  if (mode === "example-dataset") {
    // A real computed number — but computed from the bundled export, so it is
    // not a fact about the reader's spend and never claims to be.
    return Object.freeze({
      label: EXAMPLE_DATASET_PROVENANCE.label, real: false,
      detail: `${EXAMPLE_DATASET_PROVENANCE.detail} ${EXAMPLE_DATASET_PROVENANCE.swap}`,
    });
  }
  if (mode === "failed") {
    return Object.freeze({
      label: "Import failed", real: false,
      detail: "No number was produced from the selected files.",
    });
  }
  if (mode === "example") {
    return Object.freeze({
      label: "Example data", real: false,
      detail: "Bundled synthetic sample — not your import and not realized savings.",
    });
  }
  if (mode === "partial") {
    // Only genuinely required inputs are listed. An absent org mapping is not
    // "unresolved" — it is a choice with no consequence for whether a number
    // exists, so naming it here would be telling the reader to fix nothing.
    const missing = mappingRequirements({ providers, hris })
      .filter((requirement) => requirement.state === "missing")
      .map((requirement) => requirement.name);
    return Object.freeze({
      label: "Incomplete mapping", real: false,
      detail: missing.length
        ? `Still unresolved: ${missing.join(" and ")}. No number is computed yet.`
        : "No number is computed yet.",
    });
  }
  if (!plausible) {
    return Object.freeze({
      label: "Needs review", real: false,
      detail: "A total fell outside the supported display range, so the value is withheld.",
    });
  }
  if (departments === 0) {
    return Object.freeze({
      label: "No rows matched", real: false,
      detail: "The mapping is valid, but no provider aggregate joined an active HRIS unit.",
    });
  }
  return Object.freeze({
    label: "Local import", real: true,
    detail: `${joinedRecords} joined record${joinedRecords === 1 ? "" : "s"} from the files `
      + "selected in this tab. Source rows stay in the browser.",
  });
}

// Identifiers a selected file can carry into a parser message: opaque org-unit
// ids, export UUIDs, and anything that looks like a file name or path. None of
// them help a reader fix a mapping, and all of them are source content.
const OPAQUE_IDENTIFIER = /\bpsn_[A-Za-z0-9_-]{16,64}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const FILE_REFERENCE = /\S*\.(?:json|ndjson|csv|tsv|txt|xlsx?)\b/gi;

/**
 * Scrub a diagnostic before it is shown or announced. Contract field names in
 * “curly quotes” survive — they are the header names a reader needs. Record
 * identifiers and file references do not.
 */
export function redactDiagnostic(text) {
  return String(text ?? "")
    .replace(FILE_REFERENCE, "the selected file")
    .replace(OPAQUE_IDENTIFIER, "a redacted identifier");
}

const RECOVERY_BY_CODE = Object.freeze({
  unsupported_format: "Select a .json v1 export, or a .csv/.tsv provider usage export or org roster.",
  // Delimited-import reasons. Each one names the single edit that clears it; the
  // located row and column travel on the problem, never in this sentence.
  empty_file: "The selected file has no rows; re-export the period and choose it again.",
  file_too_large: "Split the export into smaller periods; the size ceiling is stated in the message.",
  too_many_rows: "Split the export into smaller periods; the row ceiling is stated in the message.",
  malformed_quoted_field: "Re-export without editing the file by hand; a quoted field is left open.",
  missing_required_column: "Add the named column to the export, or choose the full provider export.",
  unparseable_date: "Correct the dates in the named column, then choose the file again.",
  invalid_amount: "Correct the cost column so every row holds a non-negative amount.",
  invalid_quantity: "Correct the usage column so every row holds a non-negative quantity.",
  unsupported_currency: "Export one currency at a time; totals are not converted for you.",
  malformed_row: "Correct the rows whose field count differs from the header row.",
  missing_value: "Fill in the named column for every row, then choose the file again.",
  no_usable_rows: "No row could be normalized; check the date, org unit, and cost columns.",
  contract_rejected: "The normalized export did not satisfy the v1 contract; report this file shape.",
  invalid_json: "Re-export the period; the file is not valid JSON.",
  unsupported_contract: "Choose a v1 provider-usage or HRIS-org envelope.",
  unknown_field: "Remove the undeclared field from the source export and choose the files again.",
  missing_field: "Add the named field to the source export and choose the files again.",
  invalid_value: "Correct the named field in the source export and choose the files again.",
  record_outside_period: "Re-export so every record falls inside the declared period.",
  malformed_period: "Correct period_start and period_end, then choose the files again.",
  incompatible_source: "Choose periods from one source instance, or analyze each source separately.",
  too_many_files: "Choose a smaller set of related exports, then analyze any remaining files separately.",
  selection_too_large: "Choose a smaller set of related exports; no file in this selection was read.",
});

const DEFAULT_RECOVERY = "Choose a provider export in CSV, TSV, or v1 JSON format and try again.";

/**
 * A per-field diagnostic: which file in the selection failed (by position, not
 * by name), what the contract objected to, and the one action that fixes it.
 */
export function diagnosticFor({ code = "", message = "", ordinal = 1, total = 1 } = {}) {
  const position = total > 1 ? `File ${ordinal} of ${total}: ` : "";
  return Object.freeze({
    code: String(code),
    text: `${position}${redactDiagnostic(message)}`.trim(),
    recovery: RECOVERY_BY_CODE[code] ?? DEFAULT_RECOVERY,
  });
}

// --- DOM application -------------------------------------------------------
// These take the document rather than reading a global so a test can drive the
// shipped markup directly. Every node is addressed by id and written with
// textContent; no markup string is ever assigned.

function byId(doc, id) {
  return doc?.getElementById ? doc.getElementById(id) : null;
}

function textNode(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  node.textContent = text;
  return node;
}

/** Paint the stage indicator, including `aria-current` on the current step. */
export function applyStage(doc, stageId) {
  const list = byId(doc, "import-stages");
  if (!list) return stageProgress(stageId);
  const steps = stageProgress(stageId);
  list.replaceChildren(...steps.map((step) => {
    const item = doc.createElement("li");
    item.className = "import-stage";
    item.dataset.state = step.state;
    if (step.state === "current") item.setAttribute("aria-current", "step");
    else item.removeAttribute?.("aria-current");
    const shape = textNode(doc, "span", "stage-shape", step.shape);
    shape.setAttribute("aria-hidden", "true");
    item.append(
      shape,
      textNode(doc, "span", "stage-index", `Step ${step.position}`),
      textNode(doc, "span", "stage-name", step.label),
      textNode(doc, "span", "stage-status", step.status),
    );
    return item;
  }));
  return steps;
}

/** Paint the requirement rows; each unresolved row carries its own jump. */
export function applyRequirements(doc, counts, { onJump } = {}) {
  const list = byId(doc, "mapping-requirements");
  const rows = mappingRequirements(counts);
  if (!list) return rows;
  list.replaceChildren(...rows.map((requirement) => {
    const item = doc.createElement("li");
    item.className = "mapping-requirement";
    item.dataset.state = requirement.state;
    item.dataset.kind = requirement.required ? "required" : "optional";
    const shape = textNode(doc, "span", "requirement-shape", requirement.shape);
    shape.setAttribute("aria-hidden", "true");
    // Required and optional are told apart by a word and a shape before they are
    // told apart by a tint, and the word is in the row's own accessible name so
    // a screen reader hears "Optional" without reaching the visual grouping.
    item.setAttribute("aria-label",
      `${requirement.kindLabel}: ${requirement.name}. ${requirement.status}.`
      + (requirement.gain ? ` ${requirement.gain}` : ""));
    item.append(
      shape,
      textNode(doc, "span", "requirement-kind", requirement.kindLabel),
      textNode(doc, "span", "requirement-name", requirement.name),
      textNode(doc, "span", "requirement-status", requirement.status),
    );
    // An optional row is only worth offering if it says what it buys. The
    // sentence is the policy's, or the projected coverage the confidence model
    // computed from the reader's own file — never a phrase written here.
    if (requirement.gain)
      item.append(textNode(doc, "span", "requirement-gain", requirement.gain));
    if (requirement.state === "missing") {
      const jump = doc.createElement("button");
      jump.setAttribute("type", "button");
      jump.className = "requirement-jump";
      jump.textContent = "Add it";
      jump.setAttribute("aria-label", `Add the ${requirement.name} — moves focus to the file chooser`);
      jump.addEventListener("click", () => {
        const control = byId(doc, requirement.control);
        control?.focus?.();
        onJump?.(requirement);
      });
      item.append(jump);
    }
    return item;
  }));
  return rows;
}

/**
 * Bind a diagnostic to the control it concerns: `aria-invalid` on the control,
 * `aria-describedby` extended to the message, recovery offered at the control.
 */
export function applyFieldDiagnostic(doc, diagnostic) {
  const control = byId(doc, "local-finops-files");
  const errorNode = byId(doc, "local-file-error");
  const recovery = byId(doc, "local-file-recovery");
  if (!control || !errorNode) return null;
  if (!diagnostic) {
    control.setAttribute("aria-invalid", "false");
    control.setAttribute("aria-describedby", "local-file-help");
    errorNode.textContent = "";
    errorNode.hidden = true;
    if (recovery) recovery.hidden = true;
    return null;
  }
  control.setAttribute("aria-invalid", "true");
  control.setAttribute("aria-describedby", "local-file-help local-file-error");
  errorNode.replaceChildren(
    textNode(doc, "strong", "field-error-label", "Not analyzed"),
    textNode(doc, "span", "field-error-text", diagnostic.text),
    textNode(doc, "span", "field-error-recovery", diagnostic.recovery),
  );
  errorNode.hidden = false;
  if (recovery) recovery.hidden = false;
  return diagnostic;
}

/**
 * Mark every surface that renders analysis numbers with where those numbers came
 * from, and paint the provenance note on each one that declares a slot for it.
 *
 * The audit this makes possible is mechanical rather than editorial: a surface
 * opts in with `data-analysis-surface`, and it either carries a
 * `data-dataset-provenance` note or it is a defect. Nothing here is per-view
 * copy — one string, one flag, applied everywhere at once.
 */
export function applyDatasetProvenance(doc, exampleActive, userProvenance = null) {
  const dataset = exampleActive ? "example" : "user";
  for (const surface of doc.querySelectorAll?.("[data-analysis-surface]") ?? [])
    surface.dataset.dataset = dataset;
  for (const note of doc.querySelectorAll?.("[data-dataset-provenance]") ?? []) {
    note.dataset.dataset = dataset;
    note.hidden = !exampleActive && !userProvenance;
    if (!exampleActive) {
      note.replaceChildren();
      // The reader's own numbers carry the reader's own provenance, on every
      // surface the example caption used to occupy. One state, one label, no
      // figure left captioned "Example data" once the example is gone.
      if (userProvenance) {
        const shape = textNode(doc, "span", "provenance-shape", "▣");
        shape.setAttribute("aria-hidden", "true");
        note.append(
          shape,
          textNode(doc, "strong", "provenance-label", userProvenance.label),
          textNode(doc, "span", "provenance-detail", userProvenance.detail),
        );
      }
      continue;
    }
    const shape = textNode(doc, "span", "provenance-shape", "◇");
    shape.setAttribute("aria-hidden", "true");
    note.replaceChildren(
      shape,
      textNode(doc, "strong", "provenance-label", EXAMPLE_DATASET_PROVENANCE.label),
      textNode(doc, "span", "provenance-detail", EXAMPLE_DATASET_PROVENANCE.detail),
      textNode(doc, "span", "provenance-swap", EXAMPLE_DATASET_PROVENANCE.swap),
    );
  }
  return exampleActive ? EXAMPLE_DATASET_PROVENANCE : userProvenance;
}

/**
 * The provenance label for the reader's own import: their file names, the rows
 * that were read, and — when one was recognized — the export shape they were
 * read as. It is built here, once, for the same reason the example label is:
 * two wordings on two surfaces would drift.
 *
 * File names are the reader's own and appear only on their own result. They are
 * written as text nodes; nothing here interpolates them into markup, and the
 * redaction that governs *diagnostics* is unchanged — a parser message still
 * names a file by its position in the selection, never by name.
 */
export function userDatasetProvenance({ files = [], rows = 0, shapes = [] } = {}) {
  const names = files.filter(Boolean);
  if (!names.length) return null;
  const shapeText = shapes.filter(Boolean).length
    ? ` Read as ${[...new Set(shapes.filter(Boolean))].join(" and ")}.`
    : "";
  return Object.freeze({
    label: `Your data — ${names.join(", ")}`,
    detail: `${rows} row${rows === 1 ? "" : "s"} read in this tab and mapped by you.${shapeText}`
      + " Nothing was uploaded or stored.",
    files: Object.freeze([...names]),
    rows,
  });
}

// ---------------------------------------------------------------------------
// The supporting rail's shared disclosures.
//
// Five native `details` sit below the department ranking, and until now every
// one of them looked identical whether it held twelve rows, zero rows, or had
// never been analyzed at all. A reader had to open five controls to learn that
// four were empty, and a collapsed disclosure over nothing is a control that
// lies about what pressing it will do.
//
// So each one states its own count *in its summary*, which is to say inside the
// control's accessible name. The state travels three ways — the word, the count,
// and a dashed edge — and never as a tint alone.
// ---------------------------------------------------------------------------

/**
 * The three states a shared disclosure can be in. `unavailable` is deliberately
 * distinct from `empty`: before an analysis exists the count is not zero, it is
 * unknown, and printing "0 rows" over an unanalyzed list is a claim the page has
 * no basis for.
 */
export const DISCLOSURE_STATE = Object.freeze({
  filled: "filled",
  empty: "empty",
  unavailable: "unavailable",
});

/**
 * Which count slot belongs to which disclosure, and the noun each one counts.
 * Data rather than five call sites, so a sixth disclosure declares itself here
 * instead of inventing its own wording.
 */
export const SUPPORTING_DISCLOSURES = Object.freeze([
  Object.freeze({ key: "periods", detailId: "local-periods-detail", countId: "local-periods-count", noun: "period" }),
  Object.freeze({ key: "assumptions", detailId: "local-assumptions-detail", countId: "local-assumptions-count", noun: "assumption" }),
  Object.freeze({ key: "warnings", detailId: "local-warnings-detail", countId: "local-warning-count", noun: "warning" }),
  Object.freeze({ key: "limits", detailId: "local-limits-detail", countId: "local-limits-count", noun: "limit" }),
  Object.freeze({ key: "evidence", detailId: "local-evidence-detail", countId: "local-evidence-count", noun: "evidence item" }),
]);

/**
 * The sentence fragment a summary ends in, for one count.
 *
 * @param count a non-negative integer, or null/undefined for "not analyzed".
 * @returns `{ state, text }` — the state enum and the words that carry it.
 */
export function disclosureCount(count, noun = "item") {
  if (!Number.isFinite(count) || count < 0) {
    return Object.freeze({ state: DISCLOSURE_STATE.unavailable, text: "not analyzed" });
  }
  const rounded = Math.trunc(count);
  if (rounded === 0) return Object.freeze({ state: DISCLOSURE_STATE.empty, text: "none" });
  return Object.freeze({
    state: DISCLOSURE_STATE.filled,
    text: `${rounded} ${noun}${rounded === 1 ? "" : "s"}`,
  });
}

/**
 * Paint every shared disclosure's state and count.
 *
 * @param counts `{ periods, assumptions, warnings, limits, evidence }`. A key
 *   that is absent or not a number paints `unavailable` rather than zero.
 * @returns the states that were painted, keyed the same way, so a caller can
 *   assert on what it asked for rather than on the DOM it got.
 */
export function applySupportingDisclosures(doc, counts = {}) {
  const painted = {};
  for (const { key, detailId, countId, noun } of SUPPORTING_DISCLOSURES) {
    const { state, text } = disclosureCount(counts[key], noun);
    painted[key] = state;
    const detail = doc?.getElementById?.(detailId);
    if (detail) detail.dataset.state = state;
    const slot = doc?.getElementById?.(countId);
    if (slot) slot.textContent = text;
  }
  return Object.freeze(painted);
}

/**
 * How this layer renders a briefing's figure. The contract emits
 * `{ value, unit }` and deliberately does no formatting, so the two-decimal USD
 * convention the rest of this page uses is applied here and only here.
 */
function metricText(metric) {
  const amount = `${metric.value.toFixed(2)} ${metric.unit}`;
  const signed = metric.value > 0 ? `+${amount}` : metric.value < 0
    ? `−${Math.abs(metric.value).toFixed(2)} ${metric.unit}` : amount;
  const period = `${metric.period.start.slice(0, 10)} to ${metric.period.end.slice(0, 10)}`;
  // The signed form is only meaningful for a change; a stock figure is not
  // "+5200 USD", it is 5200 USD.
  const figure = metric.candidate === "spend_change" ? signed : amount;
  return `${figure} · ${metric.label} · ${period}`;
}

const CONFIDENCE_WORD = Object.freeze({
  high: "High confidence",
  moderate: "Moderate confidence",
  low: "Low confidence",
  insufficient: "Insufficient coverage",
});

function coverageText(coverage) {
  const share = coverage.recordsTotal === 0
    ? "no records to cover"
    : `${(coverage.coverageRatio * 100).toFixed(1)}% of records`;
  const missing = coverage.missingInputs.length
    ? ` Missing input${coverage.missingInputs.length === 1 ? "" : "s"}: ${coverage.missingInputs.join(", ")}.`
    : "";
  return `${CONFIDENCE_WORD[coverage.confidence]} · ${share} `
    + `(${coverage.recordsAnalyzed} analyzed of ${coverage.recordsTotal}).${missing}`;
}

function arithmeticText(arithmetic) {
  return `${arithmetic.operation}. `
    + arithmetic.inputs.map((input) => `${input.name} = ${input.value}`).join("; ") + ".";
}

/**
 * A shape per confidence level, so the grade survives a mono printer, a
 * greyscale screenshot, and a reader who cannot tell the four tints apart. It is
 * `aria-hidden`: the word beside it is what a screen reader reads.
 */
const CONFIDENCE_SHAPE = Object.freeze({
  high: "◆",
  moderate: "◈",
  low: "◇",
  insufficient: "×",
});

/**
 * The graded slot, as the contract actually emits it.
 *
 * The briefing contract has no letter grade — `coverage.confidence` is the one
 * graded value it computes, so that is what this surface grades. The three
 * channels are returned together and are painted together: the word is the
 * label, the ratio is the value, and the glyph is the shape. Colour is a fourth
 * channel layered on top of those, never a replacement for one.
 */
function gradeOf(coverage) {
  return {
    level: coverage.confidence,
    label: CONFIDENCE_WORD[coverage.confidence],
    shape: CONFIDENCE_SHAPE[coverage.confidence],
    value: coverage.recordsTotal === 0
      ? "no records to cover"
      : `${(coverage.coverageRatio * 100).toFixed(1)}% coverage`,
  };
}

/**
 * What bounds this briefing, in one paragraph behind the method disclosure.
 *
 * Every sentence is either the contract's own or a statement of a contract
 * value; this layer authors no method of its own. The missing-input list is
 * named as aggregates, which is the only form the contract carries them in.
 */
function methodText(briefing) {
  const parts = [`Selected by briefing contract ${briefing.contractVersion}`
    + `${briefing.analysisSchemaVersion ? ` from analysis ${briefing.analysisSchemaVersion}` : ""}.`];
  const missing = briefing.coverage.missingInputs;
  parts.push(missing.length
    ? `Inputs this briefing did not have: ${missing.join(", ")}. `
      + "Confidence is bounded by that, not by the arithmetic above it."
    : "Every required input was present, so confidence is bounded only by record coverage.");
  for (const slot of ["materialMetric", "rankedAction"]) {
    const absent = briefing.absent?.[slot];
    if (absent) parts.push(absent.statement);
  }
  return parts.join(" ");
}

/**
 * The four sentences a briefing renders to, authored in exactly one place.
 *
 * The live surface and a briefing reopened from a file are the same contract
 * seen twice, so they format it once. A second copy of these lines is how a
 * reader ends up comparing two differently-worded versions of the same slot.
 *
 * `arithmetic` is null when there is no figure to recompute; every other line is
 * always a string, because a slot the contract declared absent still has the
 * contract's own statement of why to render.
 */
export function briefingLines(briefing) {
  const { materialMetric, rankedAction } = briefing;
  return {
    question: briefing.headlineQuestion,
    metric: materialMetric ? metricText(materialMetric) : briefing.absent.materialMetric.statement,
    grade: gradeOf(briefing.coverage),
    coverage: coverageText(briefing.coverage),
    arithmetic: materialMetric ? arithmeticText(briefing.arithmeticInputs) : null,
    action: rankedAction
      ? `${rankedAction.action} Accountable role: ${rankedAction.accountableRole}.`
      : briefing.absent.rankedAction.statement,
    // The role on its own line as well as inside the action sentence: the
    // sentence is what a screen reader hears in context, the line is what a
    // leader's eye lands on when scanning for who owns this.
    role: rankedAction ? `Accountable role: ${rankedAction.accountableRole}` : null,
    method: methodText(briefing),
    rubric: `Rubric ${briefing.rubricVersion} · briefing contract ${briefing.contractVersion}`,
    provenance: briefing.provenance.text,
  };
}

/**
 * Paint the briefing: the one question, the one figure that answers it, how
 * that figure was computed, and the rank-1 action with the role accountable for
 * it — in that order.
 *
 * Every slot comes from `buildFinopsBriefing`. This layer decides no figure, no
 * question, and no action of its own; it formats what the contract selected, and
 * where the contract says a slot is absent it renders the contract's own
 * statement of why rather than a zero, a dash, or an estimate.
 */
export function applyBriefing(doc, briefing, derivation = null) {
  const section = byId(doc, "local-lead-finding");
  if (!section) return briefing;
  const { materialMetric, rankedAction } = briefing;
  const lines = briefingLines(briefing);
  section.dataset.state = materialMetric ? "available" : "unavailable";
  // The version this surface rendered, on the surface itself: a reviewer
  // comparing the page against an export is comparing two stated versions.
  section.dataset.contractVersion = briefing.contractVersion;
  section.hidden = false;
  const write = (id, text) => {
    const node = byId(doc, id);
    if (node) node.textContent = text;
  };
  const show = (id, visible) => {
    const node = byId(doc, id);
    if (node) node.hidden = !visible;
  };
  // A painted briefing is not loading, empty, or failed; the state line goes.
  write("local-lead-status", "");
  show("local-lead-status", false);
  write("local-lead-question", lines.question);
  write("local-lead-metric", lines.metric);
  const metricNode = byId(doc, "local-lead-metric");
  if (metricNode) metricNode.dataset.available = String(Boolean(materialMetric));
  // The grade, in three channels at once. `data-confidence` on both the chip
  // and its paragraph is for the stylesheet and is never the only place the
  // level can be read — the word and the ratio beside it say the same thing.
  write("local-lead-grade-shape", lines.grade.shape);
  write("local-lead-grade-label", lines.grade.label);
  write("local-lead-grade-value", lines.grade.value);
  for (const id of ["local-lead-grade", "local-lead-grade-chip"]) {
    const node = byId(doc, id);
    if (node) node.dataset.confidence = lines.grade.level;
  }
  // Coverage is stated in every state, including the states with no figure in
  // them. A low-coverage briefing that hides its coverage is the one dishonest
  // shape this surface can take.
  write("local-lead-coverage", lines.coverage);
  write("local-lead-arithmetic", lines.arithmetic ?? "");
  const arithmetic = byId(doc, "local-lead-arithmetic");
  if (arithmetic) arithmetic.hidden = !materialMetric;
  // The disclosure itself goes with its content: a summary that opens onto
  // nothing is a control that lies about having something behind it.
  show("local-lead-arithmetic-detail", Boolean(materialMetric));
  write("local-lead-method", lines.method);
  write("local-lead-action", lines.action);
  const action = byId(doc, "local-lead-action");
  if (action) action.dataset.available = String(Boolean(rankedAction));
  write("local-lead-role", lines.role ?? "");
  const role = byId(doc, "local-lead-role");
  if (role) role.dataset.available = String(Boolean(rankedAction));
  show("local-lead-role", Boolean(rankedAction));
  // Rubric and provenance are painted in every state and are never disclosed
  // behind anything: a forwarded briefing has to say what graded it and where
  // it ran, on screen and on paper.
  write("local-lead-rubric", lines.rubric);
  write("local-lead-provenance", lines.provenance);
  // Check the math, when the caller has one to show. It is optional rather than
  // required: a surface that can paint the briefing but not the derivation shows
  // the briefing, and the disclosure that would open onto nothing stays away.
  renderBriefingDerivation(doc, "local-lead-derivation", derivation);
  show("local-lead-derivation-detail", Boolean(derivation));
  return briefing;
}

/**
 * The three states a briefing has before it has an answer: loading, nothing to
 * show yet, and generation failed.
 *
 * The surface is not swapped for a panel. The same article stays, keeps its
 * heading and its rubric line, and the slots it cannot fill yet are emptied and
 * marked through `data-state` — the stylesheet draws the loading skeleton over
 * the real slots, so the layout a reader sees while waiting is the shape of the
 * layout they get. `local-lead-status` carries the sentence, and for empty and
 * error it also carries the recovery path.
 *
 * @param state one of "loading", "empty", "error".
 * @param message the sentence to state. Callers own the copy; this layer owns
 *   the structure, exactly as `applyBriefing` owns no wording of its own.
 */
export { BRIEFING_STATE_MESSAGE };

export function applyBriefingState(doc, state, message = BRIEFING_STATE_MESSAGE[state]) {
  const section = byId(doc, "local-lead-finding");
  if (!section || !BRIEFING_STATE_MESSAGE[state]) return null;
  section.hidden = false;
  section.dataset.state = state;
  const write = (id, text) => {
    const node = byId(doc, id);
    if (node) node.textContent = text;
  };
  const status = byId(doc, "local-lead-status");
  if (status) {
    status.textContent = message;
    status.hidden = false;
  }
  // The slots are emptied rather than removed. Nothing is unmounted, so the
  // skeleton occupies the space the answer will, and a print of a loading page
  // cannot show a stale figure.
  write("local-lead-metric", "—");
  write("local-lead-grade-value", "—");
  write("local-lead-grade-label", BRIEFING_CONFIDENCE_LABEL[state] ?? BRIEFING_CONFIDENCE_LABEL.loading);
  write("local-lead-grade-shape", "◇");
  write("local-lead-coverage", "—");
  write("local-lead-arithmetic", "");
  write("local-lead-action", "—");
  write("local-lead-role", "");
  write("local-lead-method", "—");
  for (const id of ["local-lead-grade", "local-lead-grade-chip"]) {
    const node = byId(doc, id);
    if (node) node.dataset.confidence = "";
  }
  for (const [id, available] of [["local-lead-metric", false], ["local-lead-action", false],
    ["local-lead-role", false]]) {
    const node = byId(doc, id);
    if (node) node.dataset.available = String(available);
  }
  for (const id of ["local-lead-arithmetic", "local-lead-arithmetic-detail", "local-lead-role",
    "local-lead-derivation-detail"]) {
    const node = byId(doc, id);
    if (node) node.hidden = true;
  }
  // A derivation belongs to one briefing. Leaving the previous one painted
  // through a loading or error state would offer a reader a re-derivation of a
  // figure that is no longer on screen.
  renderBriefingDerivation(doc, "local-lead-derivation", null);
  return state;
}

// --- a briefing reopened from a file ---------------------------------------
// Its own region, below the live analysis and never inside it. A returning
// visitor has to be able to tell at a glance which numbers are from today's
// import and which came off a file they saved weeks ago, so this surface never
// borrows the live slot's markup, its heading, or its position.

const RESTORED_SLOTS = Object.freeze([
  "restored-briefing-captured", "restored-briefing-dataset", "restored-briefing-question",
  "restored-briefing-metric", "restored-briefing-coverage", "restored-briefing-arithmetic",
  "restored-briefing-action", "restored-briefing-delta",
]);

/**
 * Paint — or clear — the restored briefing.
 *
 * @param model `{ saved, delta }` from `parseSavedBriefing` and `briefingDelta`,
 *   or null to take the region off screen entirely. There is no third state: a
 *   rejected file clears this region rather than leaving half of one behind.
 *
 * Every value written here goes through `textContent`. Nothing out of the file
 * becomes markup, an attribute, or a URL.
 */
export function applyRestoredBriefing(doc, model) {
  const section = byId(doc, "restored-briefing");
  if (!section) return null;
  const write = (id, text) => {
    const node = byId(doc, id);
    if (node) node.textContent = text;
  };
  const show = (id, visible) => {
    const node = byId(doc, id);
    if (node) node.hidden = !visible;
  };
  if (!model?.saved) {
    section.hidden = true;
    section.dataset.state = "empty";
    delete section.dataset.contractVersion;
    for (const id of RESTORED_SLOTS) {
      write(id, "");
      show(id, false);
    }
    renderBriefingDerivation(doc, "restored-briefing-derivation", null);
    show("restored-briefing-derivation-detail", false);
    return null;
  }

  const { saved, delta = null } = model;
  const lines = briefingLines(saved.briefing);
  section.hidden = false;
  section.dataset.state = "restored";
  section.dataset.contractVersion = saved.contractVersion;
  section.dataset.savedOn = saved.savedOn;
  write("restored-briefing-captured", capturedPeriodLine(saved));
  show("restored-briefing-captured", true);
  // The example-data notice travels with the file that carried it. Without this
  // a reopened example briefing would read as somebody's real spend.
  write("restored-briefing-dataset", saved.dataset === "example" ? EXAMPLE_DATASET_LINE : "");
  show("restored-briefing-dataset", saved.dataset === "example");
  write("restored-briefing-question", lines.question);
  show("restored-briefing-question", true);
  write("restored-briefing-metric", lines.metric);
  show("restored-briefing-metric", true);
  write("restored-briefing-coverage", lines.coverage);
  show("restored-briefing-coverage", true);
  write("restored-briefing-arithmetic", lines.arithmetic ?? "");
  show("restored-briefing-arithmetic", Boolean(lines.arithmetic));
  write("restored-briefing-action", lines.action);
  show("restored-briefing-action", true);
  // The delta is absent, not empty, when there is nothing on screen to compare
  // against: an empty line under a restored briefing reads as "no change".
  write("restored-briefing-delta", delta?.text ?? "");
  show("restored-briefing-delta", Boolean(delta));
  const deltaNode = byId(doc, "restored-briefing-delta");
  if (deltaNode) {
    // Direction is in the sentence itself; this attribute exists for styling and
    // is never the only place the reader can find it.
    deltaNode.dataset.comparable = String(Boolean(delta?.comparable));
    deltaNode.dataset.direction = delta?.comparable ? delta.spend.direction : "none";
  }
  // The derivation travels on the parsed file rather than being recomputed here,
  // so what a reader checks is what the reader was shown.
  renderBriefingDerivation(doc, "restored-briefing-derivation", saved.derivation ?? null);
  show("restored-briefing-derivation-detail", Boolean(saved.derivation));
  return model;
}

/**
 * The one place a rejected file is written to the page: a sentence beside the
 * control that read it, and no restored region at all.
 *
 * Deliberately not a live region — `announce` already speaks the same outcome
 * from the page's one polite/assertive pair, and this page's rule is that a
 * message is announced from exactly one region.
 */
export function applyRestoreRejection(doc, rejection) {
  const node = byId(doc, "restored-briefing-error");
  if (!node) return null;
  node.textContent = rejection?.message ?? "";
  node.hidden = !rejection;
  const input = byId(doc, "reopen-briefing-file");
  if (input) input.setAttribute("aria-invalid", rejection ? "true" : "false");
  return rejection ?? null;
}

/**
 * Paint the trust verdict: the coverage headline with its own numerator and
 * denominator beside it, the ranked findings, and the one next action.
 *
 * Every string comes from the verdict model. This layer chooses no words of its
 * own beyond the static labels already in the markup, and it never builds a
 * finding's per-identifier detail until that finding is actually expanded — the
 * model hands the detail over as a thunk precisely so a collapsed verdict over
 * a large import costs nothing.
 */
export function applyTrustVerdict(doc, verdict) {
  const section = byId(doc, "local-trust");
  if (!section) return verdict;
  section.dataset.state = verdict.state;
  section.hidden = false;
  const write = (id, text) => {
    const node = byId(doc, id);
    if (node) node.textContent = text;
  };
  const { headline } = verdict;
  write("local-trust-question", verdict.question);
  write("local-trust-coverage", headline.available ? headline.coverageText : "No percentage");
  const coverage = byId(doc, "local-trust-coverage");
  if (coverage) coverage.dataset.available = String(headline.available);
  // The percentage alone is not enough to act on. Numerator, denominator, and
  // both row counts ship with it, always, in the same line of sight.
  write("local-trust-inputs", headline.available
    ? `${headline.attributed} attributed of ${headline.total} total · `
      + `${headline.attributedRows} of ${headline.totalRows} rows`
    : `${headline.totalRows} parsed row${headline.totalRows === 1 ? "" : "s"}; no total can be shown`);
  write("local-trust-answer", verdict.answer);

  const list = byId(doc, "local-trust-findings");
  const findingsSection = byId(doc, "local-trust-findings-section");
  if (findingsSection) findingsSection.hidden = verdict.findings.length === 0;
  if (list) list.replaceChildren(...verdict.findings.map((finding, index) => {
    const item = doc.createElement("li");
    item.className = "local-trust-finding";
    item.dataset.finding = finding.id;
    item.dataset.blocking = String(Boolean(finding.blocking));
    const panelId = `local-trust-detail-${index}`;
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "local-trust-choice";
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", panelId);
    button.setAttribute("aria-label",
      `Expand ${finding.title}, ${finding.impact} of spend across ${finding.rows} row${finding.rows === 1 ? "" : "s"}`);
    button.append(
      textNode(doc, "span", "local-trust-rank", String(index + 1).padStart(2, "0")),
      textNode(doc, "strong", "local-trust-title", finding.title),
      textNode(doc, "span", "local-trust-impact", finding.impact),
      textNode(doc, "span", "local-trust-confidence", `${finding.confidence} classification`),
    );
    const panel = doc.createElement("div");
    panel.id = panelId;
    panel.className = "local-trust-detail";
    panel.hidden = true;
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", `${finding.title} detail`);
    let built = false;
    button.addEventListener("click", () => {
      const expanded = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!expanded));
      button.setAttribute("aria-label",
        `${expanded ? "Expand" : "Collapse"} ${finding.title}, ${finding.impact} of spend `
        + `across ${finding.rows} row${finding.rows === 1 ? "" : "s"}`);
      panel.hidden = expanded;
      if (expanded || built) return;
      built = true;
      const rows = doc.createElement("ol");
      rows.className = "local-trust-detail-rows";
      rows.replaceChildren(...finding.detail().map((group) => {
        const row = doc.createElement("li");
        row.append(
          textNode(doc, "span", "local-trust-detail-label", group.label),
          textNode(doc, "span", "local-trust-detail-rows-count",
            `${group.rows} row${group.rows === 1 ? "" : "s"}`),
          textNode(doc, "span", "local-trust-detail-impact", group.impact),
        );
        return row;
      }));
      panel.append(rows);
    });
    panel.append(
      textNode(doc, "p", "local-trust-provenance", finding.provenance),
      textNode(doc, "p", "local-trust-confidence-reason", finding.confidenceReason),
    );
    item.append(button, panel);
    return item;
  }));

  const next = byId(doc, "local-trust-next");
  if (next) next.hidden = !verdict.nextAction;
  if (!verdict.nextAction) {
    // An all-clear has no action, and a stale one left hidden in the markup is
    // still a sentence waiting to be shown at the wrong moment.
    write("local-trust-action", "—");
    const cleared = byId(doc, "local-trust-jump");
    if (cleared) cleared.hidden = true;
  } else {
    write("local-trust-action", verdict.nextAction.text);
    const action = byId(doc, "local-trust-action");
    if (action) action.dataset.available = String(verdict.nextAction.available);
    // The action links back into the step that closes the gap. When no step in
    // this product could close it, there is no link to offer and the sentence
    // above already says why.
    const jump = byId(doc, "local-trust-jump");
    if (jump) {
      jump.hidden = !verdict.nextAction.control;
      jump.dataset.step = verdict.nextAction.step ?? "";
      // The control travels on the node, and the listener is bound once, so a
      // re-import repoints the same button instead of stacking handlers on it.
      jump.dataset.control = verdict.nextAction.control ?? "";
      jump.setAttribute("aria-label",
        `${jump.textContent} — moves focus to the control that closes this gap`);
      if (!jump.dataset.bound) {
        jump.dataset.bound = "true";
        jump.addEventListener("click", () => byId(doc, jump.dataset.control)?.focus?.());
      }
    }
  }
  return verdict;
}

/** State the basis of the headline number in words, beside the number. */
export function applyMetricBasis(doc, basis) {
  const label = byId(doc, "local-metric-label");
  const detail = byId(doc, "local-metric-detail");
  const impact = byId(doc, "local-recoverable");
  if (label) {
    label.textContent = basis.label;
    label.dataset.real = String(basis.real);
  }
  if (detail) detail.textContent = basis.detail;
  if (impact) impact.dataset.real = String(basis.real);
  return basis;
}

/**
 * One announcement per commit, routed by severity: hard failures go to the
 * assertive region, everything else to the polite status the page already had.
 * The other region is emptied so nothing is read twice.
 */
export function announce(doc, { severity = "polite", state = "ready", title, copy }) {
  const status = byId(doc, "local-import-state");
  const alert = byId(doc, "local-import-alert");
  const target = severity === "assertive" ? alert : status;
  const other = severity === "assertive" ? status : alert;
  if (other) other.replaceChildren();
  if (status) status.dataset.state = state;
  if (!target) return null;
  target.replaceChildren(
    textNode(doc, "strong", undefined, title),
    textNode(doc, "span", undefined, redactDiagnostic(copy)),
  );
  return { severity, title, copy: redactDiagnostic(copy) };
}

// --- import progress -------------------------------------------------------
// A large export is parsed in a worker, so the page can say how far along it is
// and offer a real cancel. Where a worker is unavailable the parse runs on the
// page thread with no progress hooks; the copy below says that plainly rather
// than animating a fraction nobody measured.

const PROGRESS_PHASE_TEXT = Object.freeze({
  read: "Reading the file",
  parse: "Parsing and validating",
  done: "Finished",
});

/**
 * One sentence for one progress sample. A coarse sample gets no percentage,
 * because there is no percentage to report — not a rounded guess at one.
 */
export function importProgressText(progress) {
  const phase = PROGRESS_PHASE_TEXT[progress?.phase] ?? "Working";
  if (progress?.coarse) {
    return `${phase} on the page thread — this browser cannot run the import in a worker, `
      + "so progress is coarse and the page may pause.";
  }
  if (!Number.isFinite(progress?.ratio)) return `${phase}…`;
  return `${phase} — ${Math.round(progress.ratio * 100)}% of the file.`;
}

/**
 * Paint the progress region and the cancel control. Passing `null` clears both,
 * which is what a finished, failed, or cancelled import does.
 */
export function applyImportProgress(doc, progress) {
  const region = byId(doc, "local-import-progress");
  const bar = byId(doc, "local-import-progress-bar");
  const text = byId(doc, "local-import-progress-text");
  if (!region) return null;
  if (!progress || progress.phase === "done") {
    region.hidden = true;
    if (text) text.textContent = "";
    if (bar) {
      bar.removeAttribute("value");
      bar.setAttribute("aria-valuenow", "0");
    }
    return null;
  }
  region.hidden = false;
  region.dataset.phase = progress.phase ?? "read";
  region.dataset.coarse = String(Boolean(progress.coarse));
  const sentence = importProgressText(progress);
  if (text) text.textContent = sentence;
  if (bar) {
    // An indeterminate <progress> is one with no value attribute. A coarse or
    // hookless phase gets exactly that instead of a number that means nothing.
    if (Number.isFinite(progress.ratio) && !progress.coarse) {
      const percent = Math.round(progress.ratio * 100);
      bar.setAttribute("value", String(percent));
      bar.setAttribute("aria-valuenow", String(percent));
    } else {
      bar.removeAttribute("value");
      bar.removeAttribute("aria-valuenow");
    }
    bar.setAttribute("aria-label", sentence);
  }
  return sentence;
}

/**
 * State the enforced import ceilings where the reader chooses a file, from the
 * one place the numbers are defined. The markup carries no numbers of its own,
 * so a raised limit cannot leave a stale promise on the page.
 */
export function applyImportLimits(doc) {
  const help = byId(doc, "local-file-limits");
  const sentence = importLimitsSentence();
  if (help) help.textContent = sentence;
  return sentence;
}

/** Move focus to the stage a reader has just been moved into. */
export function focusStageHeading(doc, stageId) {
  const target = stageId === "read"
    ? byId(doc, "local-results-title")
    : byId(doc, "local-finops-files");
  target?.focus?.();
  return target;
}
