function node(document, tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  result.textContent = text;
  return result;
}

export const OWN_DATA_VIEW_STATE = Object.freeze({
  LOADING: "loading",
  VALIDATION_ERROR: "validation-error",
});

const VIEW_COPY = Object.freeze({
  [OWN_DATA_VIEW_STATE.LOADING]: Object.freeze({
    shape: "○",
    status: "Not yet classified · No evidence has been validated. Processing stays local to this tab; no file is uploaded or retained.",
    verdict: "Checking evidence",
    finding: "Results will appear after local validation.",
    confidence: "Not classified · Evidence has not been validated yet.",
    action: "Wait for local validation to finish.",
    provenance: "Evidence under validation · No rows have been accepted yet; nothing is uploaded or retained.",
  }),
  [OWN_DATA_VIEW_STATE.VALIDATION_ERROR]: Object.freeze({
    shape: "×",
    status: "Validation error · This evidence was not analyzed. The file was read locally in this tab and dropped; nothing was uploaded or retained.",
    verdict: "Evidence could not be validated",
    finding: "No benchmark result or department-spend classification was produced.",
    confidence: "Not classified · Invalid evidence cannot support a confidence judgment.",
    action: "Correct the named file validation errors, then choose the export again.",
    provenance: "No validated evidence · The selected file failed local validation, so no rows were accepted from it.",
  }),
});

const QUERY_LIMIT = "Incomplete query evidence limits classification confidence.";

// One row per outcome, so the shape, the word beside it, and the limitation
// that word implies cannot drift apart. Only `complete` clears the caveat: it
// is reached only with corroborating query rows, and its own provenance line
// says so, so printing the caveat there would contradict the verdict this
// region exists to make legible.
const outcomePresentation = (outcome) => ({
  complete: { shape: "●", label: "Supported", limit: "" },
  "provider-export-only": { shape: "◐", label: "Provider export only", limit: QUERY_LIMIT },
  "insufficient-evidence": { shape: "◔", label: "Evidence limited", limit: QUERY_LIMIT },
}[outcome] ?? { shape: "○", label: "Not classified", limit: QUERY_LIMIT });

// Both renderers write the same slots and both return a boolean the page
// branches on, so they resolve them the same way: one lookup, all or nothing.
// A half-painted region is how a stale figure survives beside a fresh verdict.
const PREFLIGHT_SLOTS = Object.freeze(["region", "status", "finding", "benchmark",
  "provenance", "confidence", "action", "boundary"]);

function preflightSlots(document) {
  const found = Object.fromEntries(PREFLIGHT_SLOTS.map((slot) => [slot,
    document.getElementById(slot === "region"
      ? "own-data-evidence-preflight" : `own-data-preflight-${slot}`)]));
  return PREFLIGHT_SLOTS.every((slot) => found[slot]) ? found : null;
}

function paintStatus(document, target, shape, text) {
  target.replaceChildren(node(document, "span", "status-shape", shape),
    document.createTextNode(` ${text}`));
  target.firstChild.setAttribute("aria-hidden", "true");
}

/** One provenance line, in the shape the assessed list uses, so the disclosure
 * never keeps the last accepted export's row counts under a fresh state. */
function paintReservedProvenance(document, provenance, text) {
  const item = node(document, "li", undefined, text);
  item.dataset.available = "false";
  provenance.replaceChildren(item);
}

function setDisclosureState(document) {
  const disclosure = document.getElementById("own-data-preflight-disclosure");
  const summary = document.getElementById("own-data-preflight-disclosure-summary");
  const state = document.getElementById("own-data-preflight-disclosure-state");
  if (!disclosure || !summary || !state) return;
  const expanded = disclosure.open === true;
  summary.setAttribute("aria-expanded", String(expanded));
  state.textContent = expanded ? "Hide" : "Show";
}

/** Bind the native disclosure once; native Enter/Space behavior retains focus on its summary. */
export function bindOwnDataEvidencePreflight(document) {
  const disclosure = document.getElementById("own-data-preflight-disclosure");
  if (!disclosure || disclosure.dataset.bound === "true") return false;
  disclosure.dataset.bound = "true";
  disclosure.addEventListener("toggle", () => setDisclosureState(document));
  setDisclosureState(document);
  return true;
}

/** Paint reserved loading and validation-error states without publishing stale figures. */
export function renderOwnDataEvidenceState(document, state, detail = "") {
  const copy = VIEW_COPY[state];
  const slots = preflightSlots(document);
  if (!copy || !slots) return false;
  const { region, status, finding, benchmark, provenance, confidence, action } = slots;
  region.dataset.outcome = state;
  region.setAttribute("aria-busy", String(state === OWN_DATA_VIEW_STATE.LOADING));
  paintStatus(document, status, copy.shape, detail ? `${copy.status} ${detail}` : copy.status);
  finding.replaceChildren(node(document, "strong", "own-data-preflight-verdict", copy.verdict),
    node(document, "span", undefined, copy.finding));
  benchmark.textContent = "90% required spend coverage · Not evaluated.";
  confidence.textContent = copy.confidence;
  action.textContent = copy.action;
  paintReservedProvenance(document, provenance, copy.provenance);
  if (state === OWN_DATA_VIEW_STATE.VALIDATION_ERROR) {
    region.setAttribute("tabindex", "-1");
    region.focus();
  }
  bindOwnDataEvidencePreflight(document);
  return true;
}

export function renderOwnDataEvidencePreflight(document, assessment) {
  const slots = preflightSlots(document);
  if (!slots) return false;
  const { region, status, finding, benchmark, provenance, confidence, action,
    boundary } = slots;

  region.dataset.outcome = assessment.outcome;
  region.setAttribute("aria-busy", "false");
  region.removeAttribute("tabindex");
  const presentation = outcomePresentation(assessment.outcome);
  // The local-processing claim rides the always-visible status line rather than
  // the provenance detail, which sits inside a disclosure that is closed until
  // a reader opens it. Every state states it, not only the reserved ones.
  paintStatus(document, status, presentation.shape,
    `${presentation.label} · Evidence check complete. Processed locally in this tab; nothing was uploaded or retained.`);
  finding.replaceChildren(
    node(document, "strong", "own-data-preflight-verdict", assessment.verdict),
    node(document, "span", undefined, assessment.finding),
  );
  benchmark.textContent = `${assessment.benchmark.label} · ${assessment.coverage.coveredRows} of ${assessment.coverage.totalRows} rows covered. ${assessment.benchmark.rule}`;
  provenance.replaceChildren(...assessment.provenance.map((source) => {
    const item = node(document, "li", undefined, "");
    item.dataset.available = String(source.available);
    item.append(node(document, "strong", undefined, source.source),
      document.createTextNode(` · ${source.available ? "Available" : "Absent"} · ${source.detail}`));
    return item;
  }));
  confidence.textContent = [`${presentation.label} · ${assessment.confidence}`,
    presentation.limit].filter(Boolean).join(" ");
  action.textContent = assessment.nextAction;
  boundary.replaceChildren(...assessment.boundary
    .map((rule) => node(document, "li", undefined, rule)));
  bindOwnDataEvidencePreflight(document);
  return true;
}
