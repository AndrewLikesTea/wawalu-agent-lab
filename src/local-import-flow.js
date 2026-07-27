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

import { optionalInputUpgrade } from "./finops-attribution-policy.js";
import { importLimitsSentence } from "./import-limits.js";

/** The stages the shipped flow already walks. Naming them does not add one. */
export const IMPORT_STAGES = Object.freeze([
  Object.freeze({ id: "select", label: "Select exports" }),
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
export function mappingRequirements({ providers = 0, hris = false, sample = false } = {}) {
  /** One optional row, from the policy's own table. No copy is authored here. */
  const optional = (id, name, ready, readyStatus, pendingSuffix) => {
    const upgrade = optionalInputUpgrade(id);
    return Object.freeze({
      id,
      name,
      control: "local-finops-files",
      required: false,
      /** The word the row shows beside the name; never a tint on its own. */
      kind: "Optional",
      state: ready ? "ready" : "optional",
      shape: ready ? "✓" : "–",
      status: ready ? readyStatus : `${upgrade.status}${pendingSuffix}`,
      /** What adding it buys, verbatim from `OPTIONAL_INPUT_UPGRADES`. */
      gain: upgrade.gain,
    });
  };
  return [
    Object.freeze({
      id: "provider",
      name: "Provider period export",
      control: "local-finops-files",
      required: true,
      kind: "Required",
      state: providers > 0 ? "ready" : "missing",
      shape: providers > 0 ? "✓" : "○",
      status: providers > 0
        ? `${providers} period${providers === 1 ? "" : "s"} ready`
        : "not selected",
      gain: null,
    }),
    optional("hris", "Department names (optional)", hris,
      "1 mapping ready", "; your export's own grouping is used"),
    optional("sample", "Query sample (optional)", sample,
      "1 sample ready", "; spend is analyzed without one"),
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
  swap: "To replace it, import your own v1 provider-usage JSON export plus an HRIS org mapping.",
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
  empty_file: "The selected file has no rows; re-export the period and select it again.",
  file_too_large: "Split the export into smaller periods; the size ceiling is stated in the message.",
  too_many_rows: "Split the export into smaller periods; the row ceiling is stated in the message.",
  malformed_quoted_field: "Re-export without editing the file by hand; a quoted field is left open.",
  missing_required_column: "Add the named column to the export, or select the full provider export.",
  unparseable_date: "Correct the dates in the named column, then select the file again.",
  invalid_amount: "Correct the cost column so every row holds a non-negative amount.",
  invalid_quantity: "Correct the usage column so every row holds a non-negative quantity.",
  unsupported_currency: "Export one currency at a time; totals are not converted for you.",
  malformed_row: "Correct the rows whose field count differs from the header row.",
  missing_value: "Fill in the named column for every row, then select the file again.",
  no_usable_rows: "No row could be normalized; check the date, org unit, and cost columns.",
  contract_rejected: "The normalized export did not satisfy the v1 contract; report this file shape.",
  invalid_json: "Re-export the period; the file is not valid JSON.",
  unsupported_contract: "Select a v1 provider-usage or HRIS-org envelope.",
  unknown_field: "Remove the undeclared field from the source export and select the files again.",
  missing_field: "Add the named field to the source export and select the files again.",
  invalid_value: "Correct the named field in the source export and select the files again.",
  record_outside_period: "Re-export so every record falls inside the declared period.",
  malformed_period: "Correct period_start and period_end, then select the files again.",
  incompatible_source: "Select periods from one source instance, or analyze each source separately.",
});

const DEFAULT_RECOVERY = "Select a manifest-compatible v1 JSON export and try again.";

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

/**
 * Paint the requirement rows; each unresolved row carries its own jump.
 *
 * Required and optional are told apart three ways, none of them a tint: the
 * word ("Required" / "Optional"), the shape, and `data-required` for the
 * stylesheet. An optional row additionally states the precision it buys, so
 * "optional" is never a shrug — it is a named trade the reader can decline.
 */
export function applyRequirements(doc, counts, { onJump } = {}) {
  const list = byId(doc, "mapping-requirements");
  const rows = mappingRequirements(counts);
  if (!list) return rows;
  list.replaceChildren(...rows.map((requirement) => {
    const item = doc.createElement("li");
    item.className = "mapping-requirement";
    item.dataset.state = requirement.state;
    item.dataset.required = String(requirement.required);
    const shape = textNode(doc, "span", "requirement-shape", requirement.shape);
    shape.setAttribute("aria-hidden", "true");
    item.append(
      shape,
      textNode(doc, "span", "requirement-kind", requirement.kind),
      textNode(doc, "span", "requirement-name", requirement.name),
      textNode(doc, "span", "requirement-status", requirement.status),
    );
    // The gain is the reason the row exists at all, so it is on the row rather
    // than behind a disclosure a reader has to know to open.
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

/**
 * Paint the leading finding: the question, the one number that answers it, the
 * driver behind that number, and the prioritized action. Every string comes from
 * the finding model, which reads the analysis envelope; this layer chooses no
 * words of its own beyond the static field labels in the markup.
 */
export function applyLeadingFinding(doc, finding) {
  const section = byId(doc, "local-lead-finding");
  if (!section) return finding;
  section.dataset.state = finding.available ? "available" : "unavailable";
  section.hidden = false;
  const write = (id, text) => {
    const node = byId(doc, id);
    if (node) node.textContent = text;
  };
  write("local-lead-question", finding.question);
  write("local-lead-metric", finding.metric);
  write("local-lead-driver", finding.driverSentence);
  write("local-lead-action", finding.action.text);
  const action = byId(doc, "local-lead-action");
  if (action) action.dataset.available = String(finding.action.available);
  return finding;
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

// --- in-place precision upgrades -------------------------------------------
// Adding an optional file from the results view is not a second import flow.
// It is the same analysis re-run over inputs the tab already holds, plus one
// extra: the figures that moved. The reader keeps the result they are reading,
// and the provider export is never asked for again.

/**
 * The figures an optional file can move. Nothing here is a new metric: each id
 * is read off the result the analysis already published, and the label is what
 * the surface already calls it.
 */
export const UPGRADE_FIGURES = Object.freeze([
  Object.freeze({ id: "recoverableUsd", label: "Recoverable scenario", format: "money" }),
  Object.freeze({ id: "spendUsd", label: "Attributed spend", format: "money" }),
  Object.freeze({ id: "attributedPercent", label: "Attributed share", format: "percent" }),
  Object.freeze({ id: "namedUnits", label: "Named units", format: "count" }),
]);

const DIRECTION_TEXT = Object.freeze({
  up: { word: "up", shape: "↑" },
  down: { word: "down", shape: "↓" },
  same: { word: "unchanged", shape: "→" },
});

/**
 * What changed, tied to the file that changed it.
 *
 * `before` and `after` are the same four numbers taken either side of the
 * re-run. A figure that is absent on one side is reported as unchanged rather
 * than as a movement from nothing, because "it appeared" is not a direction.
 *
 * @param {{before: object, after: object, fileName: string,
 *          formatMoney?: (value: number) => string}} input
 */
export function upgradeDelta({
  before = null, after = null, fileName = "", formatMoney = (value) => `${value.toFixed(2)} USD`,
} = {}) {
  const show = (figure, value) => {
    if (!Number.isFinite(value)) return "—";
    if (figure.format === "money") return formatMoney(value);
    if (figure.format === "percent") return `${value}%`;
    return String(value);
  };
  const changes = UPGRADE_FIGURES.map((figure) => {
    const from = Number(before?.[figure.id]);
    const to = Number(after?.[figure.id]);
    const comparable = Number.isFinite(from) && Number.isFinite(to);
    const direction = !comparable || from === to ? "same" : to > from ? "up" : "down";
    return Object.freeze({
      id: figure.id,
      label: figure.label,
      before: show(figure, from),
      after: show(figure, to),
      direction,
      word: DIRECTION_TEXT[direction].word,
      shape: DIRECTION_TEXT[direction].shape,
      text: `${figure.label}: ${show(figure, from)} → ${show(figure, to)} (${DIRECTION_TEXT[direction].word})`,
    });
  });
  const moved = changes.filter((change) => change.direction !== "same");
  return Object.freeze({
    fileName: String(fileName ?? ""),
    changes: Object.freeze(changes),
    moved: Object.freeze(moved),
    summary: moved.length
      ? `${fileName} applied. ${moved.length} figure${moved.length === 1 ? "" : "s"} moved: `
        + `${moved.map((change) => change.text).join("; ")}. The result you were reading is still here.`
      : `${fileName} applied. No figure moved; the result you were reading is unchanged.`,
  });
}

/**
 * The one sentence the results view makes about where an in-place upgrade
 * routes bytes. It is stated on every state of the upgrade control — idle,
 * working, applied, and failed — because a reader adding a second file is
 * being asked the same question they were asked about the first one.
 */
export const UPGRADE_PRIVACY_STATEMENT =
  "Your file stays in this tab: this reads it in the browser, re-runs the same local "
  + "analysis, and uploads, stores, and transfers nothing.";

const UPGRADE_STATE_TEXT = Object.freeze({
  idle: "Add an org mapping or a query sample to sharpen this result. Your provider export "
    + "stays loaded; you will not be asked for it again.",
  reading: "Reading the added file in this tab… the result below is unchanged while it runs.",
  applied: "Applied. The figures below were recomputed from the files already in this tab.",
  error: "That file was not applied. The result below is exactly as it was.",
});

/**
 * Paint the upgrade control from one state object, and nothing else.
 *
 * The view holds no state of its own: `{state, fileName, delta, error}` is the
 * whole truth about whether an optional file has been applied, and every node
 * below is a function of it. A failed upgrade paints the diagnostic at the
 * control that produced it and leaves every result node untouched.
 */
export function applyUpgradePanel(doc, upgrade = { state: "idle" }, { available = true } = {}) {
  const section = byId(doc, "local-upgrade");
  if (!section) return null;
  const state = upgrade?.state ?? "idle";
  section.hidden = !available;
  section.dataset.state = state;
  const status = byId(doc, "local-upgrade-status");
  if (status) status.textContent = UPGRADE_STATE_TEXT[state] ?? UPGRADE_STATE_TEXT.idle;
  const privacy = byId(doc, "local-upgrade-privacy");
  if (privacy) privacy.textContent = UPGRADE_PRIVACY_STATEMENT;

  const control = byId(doc, "local-upgrade-file");
  const errorNode = byId(doc, "local-upgrade-error");
  if (control) {
    control.setAttribute("aria-invalid", String(state === "error"));
    control.setAttribute("aria-describedby",
      state === "error" ? "local-upgrade-help local-upgrade-error" : "local-upgrade-help");
    control.disabled = state === "reading";
  }
  if (errorNode) {
    errorNode.hidden = state !== "error";
    errorNode.replaceChildren();
    if (state === "error" && upgrade.error) {
      errorNode.append(
        textNode(doc, "strong", "field-error-label", "Not applied"),
        textNode(doc, "span", "field-error-text", redactDiagnostic(upgrade.error.text)),
        textNode(doc, "span", "field-error-recovery", upgrade.error.recovery),
      );
    }
  }

  const changes = byId(doc, "local-upgrade-changes");
  if (changes) {
    changes.hidden = state !== "applied" || !upgrade.delta;
    changes.replaceChildren(...(state === "applied" && upgrade.delta
      ? upgrade.delta.changes.map((change) => {
        const item = doc.createElement("li");
        item.className = "local-upgrade-change";
        item.dataset.direction = change.direction;
        const shape = textNode(doc, "span", "upgrade-change-shape", change.shape);
        shape.setAttribute("aria-hidden", "true");
        item.append(
          shape,
          textNode(doc, "span", "upgrade-change-label", change.label),
          textNode(doc, "span", "upgrade-change-value", `${change.before} → ${change.after}`),
          textNode(doc, "span", "upgrade-change-direction", change.word),
        );
        return item;
      })
      : []));
  }

  // Polite, never assertive: the reader did not lose their place, so nothing
  // here interrupts them. Focus and scroll are deliberately untouched.
  const live = byId(doc, "local-upgrade-live");
  if (live) {
    live.textContent = state === "applied" && upgrade.delta
      ? `${upgrade.delta.summary} ${UPGRADE_PRIVACY_STATEMENT}`
      : state === "error" && upgrade.error
        ? `${upgrade.fileName ? `${upgrade.fileName}: ` : ""}${redactDiagnostic(upgrade.error.text)} `
          + `${upgrade.error.recovery} The result already on screen was not replaced.`
        : "";
  }
  return upgrade;
}

/** Move focus to the stage a reader has just been moved into. */
export function focusStageHeading(doc, stageId) {
  const target = stageId === "read"
    ? byId(doc, "local-results-title")
    : byId(doc, "local-finops-files");
  target?.focus?.();
  return target;
}
