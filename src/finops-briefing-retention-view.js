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
} from "./finops-briefing-retention.js";

export const RETENTION_IDS = Object.freeze({
  block: "local-lead-retention",
  toggle: "local-lead-retention-toggle",
  label: "local-lead-retention-label",
  detail: "local-lead-retention-detail",
  status: "local-lead-retention-status",
  captured: "local-lead-retention-captured",
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
  const captured = byId(doc, RETENTION_IDS.captured);
  if (captured) {
    captured.textContent = "";
    captured.hidden = true;
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
