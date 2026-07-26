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

/** Which stage the surface is in, from what has actually been loaded. */
export function importStage({ providers = 0, hris = false, hasResult = false } = {}) {
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
 */
export function mappingRequirements({ providers = 0, hris = false } = {}) {
  return [
    Object.freeze({
      id: "provider",
      name: "Provider period export",
      control: "local-finops-files",
      state: providers > 0 ? "ready" : "missing",
      shape: providers > 0 ? "✓" : "○",
      status: providers > 0
        ? `${providers} period${providers === 1 ? "" : "s"} ready`
        : "not selected",
    }),
    Object.freeze({
      id: "hris",
      name: "HRIS org mapping",
      control: "local-finops-files",
      state: hris ? "ready" : "missing",
      shape: hris ? "✓" : "○",
      status: hris ? "1 mapping ready" : "not selected",
    }),
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
    const missing = mappingRequirements({ providers, hris })
      .filter((requirement) => requirement.state === "missing")
      .map((requirement) => requirement.name);
    return Object.freeze({
      label: "Incomplete mapping", real: false,
      detail: `Still unresolved: ${missing.join(" and ")}. No number is computed yet.`,
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
  unsupported_format: "Select a .json export produced from the v1 compatibility manifest.",
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

/** Paint the requirement rows; each unresolved row carries its own jump. */
export function applyRequirements(doc, counts, { onJump } = {}) {
  const list = byId(doc, "mapping-requirements");
  const rows = mappingRequirements(counts);
  if (!list) return rows;
  list.replaceChildren(...rows.map((requirement) => {
    const item = doc.createElement("li");
    item.className = "mapping-requirement";
    item.dataset.state = requirement.state;
    const shape = textNode(doc, "span", "requirement-shape", requirement.shape);
    shape.setAttribute("aria-hidden", "true");
    item.append(
      shape,
      textNode(doc, "span", "requirement-name", requirement.name),
      textNode(doc, "span", "requirement-status", requirement.status),
    );
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
export function applyDatasetProvenance(doc, exampleActive) {
  const dataset = exampleActive ? "example" : "user";
  for (const surface of doc.querySelectorAll?.("[data-analysis-surface]") ?? [])
    surface.dataset.dataset = dataset;
  for (const note of doc.querySelectorAll?.("[data-dataset-provenance]") ?? []) {
    note.dataset.dataset = dataset;
    note.hidden = !exampleActive;
    if (!exampleActive) {
      note.replaceChildren();
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
  return exampleActive ? EXAMPLE_DATASET_PROVENANCE : null;
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

/** Move focus to the stage a reader has just been moved into. */
export function focusStageHeading(doc, stageId) {
  const target = stageId === "read"
    ? byId(doc, "local-results-title")
    : byId(doc, "local-finops-files");
  target?.focus?.();
  return target;
}
