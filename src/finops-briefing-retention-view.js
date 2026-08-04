/**
 * The retention affordance inside the AI FinOps import result region (#959).
 *
 * It paints one block that is already in the document — a checkbox, the
 * sentence that says what turning it on writes, a status line, a capture time,
 * and one forget control. Nothing is built here and nothing is unmounted, so a
 * screen reader that has landed inside the block does not lose its place when a
 * write is refused.
 *
 * Every string comes from `finops-briefing-retention.js`. This layer decides no
 * copy of its own, and it never renders an exception: a caller hands it a state
 * from the store, and the store's own sentence is what is shown.
 */
import {
  BRIEFING_RETENTION_KEY, RETENTION_COPY, RETENTION_STATE, capturedAtLabel,
  suppliedContextLabel,
} from "./finops-briefing-retention.js";
import { SERIES_FILE_COPY } from "./finops-briefing-series.js";

export const RETENTION_IDS = Object.freeze({
  block: "local-lead-retention",
  toggle: "local-lead-retention-toggle",
  label: "local-lead-retention-label",
  detail: "local-lead-retention-detail",
  status: "local-lead-retention-status",
  captured: "local-lead-retention-captured",
  supplied: "local-lead-retention-supplied",
  forget: "local-lead-retention-forget",
});

export { BRIEFING_RETENTION_KEY };

const byId = (doc, id) => doc.getElementById(id);

/**
 * Paint one retention state.
 *
 * @param state an outcome from the store: `{ state, message, payload }`.
 * @param now injected so the relative capture time is reproducible in a test.
 * @returns true when the block was found and painted.
 */
export function renderBriefingRetention(doc, state, { now = new Date() } = {}) {
  const block = byId(doc, RETENTION_IDS.block);
  if (!block) return false;
  const code = state?.state ?? RETENTION_STATE.off;
  const retained = code === RETENTION_STATE.retained;
  const available = code !== RETENTION_STATE.unavailable;

  block.hidden = false;
  block.dataset.state = code;
  block.dataset.retained = String(retained);

  const label = byId(doc, RETENTION_IDS.label);
  if (label) label.textContent = RETENTION_COPY.label;
  const detail = byId(doc, RETENTION_IDS.detail);
  if (detail) detail.textContent = RETENTION_COPY.detail;

  const toggle = byId(doc, RETENTION_IDS.toggle);
  if (toggle) {
    // The control follows the STORE, not the click: a write the browser refused
    // leaves the box unchecked, because a checked box beside "nothing was kept"
    // is the one lie a consent surface cannot tell.
    toggle.checked = retained;
    toggle.disabled = !available;
  }

  const status = byId(doc, RETENTION_IDS.status);
  if (status) status.textContent = state?.message ?? RETENTION_COPY[RETENTION_STATE.off];

  // The capture time is part of the restored reading, so it is a visible line in
  // the region rather than an attribute: a reader deciding whether this briefing
  // is still the one they meant needs to see when it was taken.
  const captured = byId(doc, RETENTION_IDS.captured);
  if (captured) {
    const stamp = retained ? state?.payload?.capturedAt ?? null : null;
    captured.textContent = stamp ? capturedAtLabel(stamp, now) : "";
    captured.hidden = !stamp;
  }

  // …and beside it the time the reader last edited context of their own. Two
  // instants rather than one, because a name typed by hand and a figure read
  // off a file are not the same kind of fact. Hidden when none was supplied.
  const supplied = byId(doc, RETENTION_IDS.supplied);
  if (supplied) {
    const line = retained ? suppliedContextLabel(state?.payload?.context ?? null, now) : "";
    supplied.textContent = line;
    supplied.hidden = !line;
  }

  // Forget is offered only when there is something to forget. A control that
  // clears nothing is a control that teaches a reader their data was kept.
  const forget = byId(doc, RETENTION_IDS.forget);
  if (forget) {
    forget.textContent = RETENTION_COPY.forget;
    forget.hidden = !retained;
  }
  return true;
}

/** Hide the affordance entirely: there is no briefing of the reader's to keep. */
export function clearBriefingRetention(doc) {
  const block = byId(doc, RETENTION_IDS.block);
  if (!block) return false;
  block.hidden = true;
  block.dataset.state = RETENTION_STATE.off;
  block.dataset.retained = "false";
  const toggle = byId(doc, RETENTION_IDS.toggle);
  if (toggle) toggle.checked = false;
  for (const id of [RETENTION_IDS.captured, RETENTION_IDS.supplied]) {
    const line = byId(doc, id);
    if (line) {
      line.textContent = "";
      line.hidden = true;
    }
  }
  const forget = byId(doc, RETENTION_IDS.forget);
  if (forget) forget.hidden = true;
  return true;
}

/**
 * Bind the two controls, once.
 *
 * @param onRetain called with true when the reader turns retention on and false
 *   when they turn it off. The caller owns the write and the erase; this layer
 *   never touches storage.
 * @param onForget called for the one-action forget.
 */
export function bindBriefingRetention(doc, { onRetain, onForget } = {}) {
  const toggle = byId(doc, RETENTION_IDS.toggle);
  const forget = byId(doc, RETENTION_IDS.forget);
  if (!toggle || typeof onRetain !== "function") return false;
  toggle.addEventListener("change", () => onRetain(Boolean(toggle.checked)));
  if (forget && typeof onForget === "function") {
    forget.addEventListener("click", () => onForget());
  }
  return true;
}

// ---------------------------------------------------------------------------
// CARRYING THE TRACK RECORD (#1092)
// ---------------------------------------------------------------------------
//
// The same shape as the block above — nothing built, nothing unmounted, every
// sentence authored elsewhere — for the export and import pair beside it. The
// count and the status are two lines rather than one because "what is on file"
// survives a refusal that "what just happened" does not.

export const PORTABILITY_IDS = Object.freeze({
  block: "local-lead-portability",
  export: "local-lead-portability-export",
  import: "local-lead-portability-import",
  count: "local-lead-portability-count",
  status: "local-lead-portability-status",
});

/**
 * Paint the count on file and the outcome of the last action.
 *
 * Neither line is ever hidden: a live region a page folds away announces
 * nothing, and an empty count reads as a figure that failed, so the store's own
 * "nothing kept yet" sentence stands in its place.
 */
export function renderBriefingPortability(doc, { count = "", message = "" } = {}) {
  const block = byId(doc, PORTABILITY_IDS.block);
  if (!block) return false;
  const countLine = byId(doc, PORTABILITY_IDS.count);
  if (countLine) countLine.textContent = count || SERIES_FILE_COPY.nothingOnFile;
  const status = byId(doc, PORTABILITY_IDS.status);
  if (status) status.textContent = message ?? "";
  return true;
}

/**
 * Bind the two controls, once. This layer never reads a file and never writes:
 * the caller owns storage, exactly as it does for the toggle above.
 */
export function bindBriefingPortability(doc, { onExport, onImport } = {}) {
  const exportControl = byId(doc, PORTABILITY_IDS.export);
  const importControl = byId(doc, PORTABILITY_IDS.import);
  if (!exportControl || !importControl) return false;
  if (typeof onExport === "function") exportControl.addEventListener("click", () => onExport());
  if (typeof onImport === "function") {
    importControl.addEventListener("change", () => onImport(importControl));
  }
  return true;
}
