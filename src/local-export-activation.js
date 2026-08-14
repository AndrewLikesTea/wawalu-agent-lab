// Focused entry to the existing local FinOps import. This owns presentation
// state only: the page's established importer still owns validation, analysis,
// cancellation, and reset.

export const LOCAL_EXPORT_ACTIVATION_STATE = Object.freeze({
  IDLE: "idle",
  READING: "reading",
  READY: "ready",
  ERROR: "error",
});

// Exported so a caller that PREFIXES one of these lines — the content-based
// detection reason (#957) leads the error line — quotes this file rather than
// restating it, and the panel cannot end up with two wordings of one state.
export const LOCAL_EXPORT_ACTIVATION_COPY = Object.freeze({
  idle: "The Bundled synthetic example is active. Choose your provider export to answer this question with your own spend.",
  reading: "Reading and validating your provider export.",
  ready: "Your provider export is active. The result below was computed from its accepted rows, not from the Bundled synthetic example.",
  error: "Nothing was analyzed, so the Bundled synthetic example is still active. Correct the file issue below, then choose your provider export again.",
});

export function renderLocalExportActivation(document, state, detail = null) {
  const region = document.getElementById("local-export-activation");
  const status = document.getElementById("local-export-activation-status");
  const choose = document.getElementById("activate-local-export");
  const reset = document.getElementById("return-to-bundled-example");
  if (!region || !status || !choose || !reset || !LOCAL_EXPORT_ACTIVATION_COPY[state]) return false;
  region.dataset.state = state;
  region.setAttribute("aria-busy", String(state === LOCAL_EXPORT_ACTIVATION_STATE.READING));
  status.textContent = detail?.message ?? LOCAL_EXPORT_ACTIVATION_COPY[state];
  if (detail?.confidence !== undefined) {
    region.dataset.confidence = String(detail.confidence);
  } else {
    delete region.dataset.confidence;
  }
  choose.textContent = state === LOCAL_EXPORT_ACTIVATION_STATE.ERROR
    ? "Choose a corrected export" : "Choose a provider export";
  choose.disabled = state === LOCAL_EXPORT_ACTIVATION_STATE.READING;
  reset.hidden = state !== LOCAL_EXPORT_ACTIVATION_STATE.READY;
  return true;
}

// Reading disables the only control that reopens the picker, so a read that
// ends without a verdict has to hand it back or it is a dead end. Several
// paths end that way and none of them are errors: a delimited file goes to the
// mapping review, an org mapping or delivery history carries no provider
// period to project, and a cancelled read paints nothing by design. Settling is
// guarded on "reading" precisely so it can be called from the one place every
// path passes through without overwriting a verdict that was already computed.
export function settleLocalExportActivation(document, state) {
  const region = document.getElementById("local-export-activation");
  if (region?.dataset.state !== LOCAL_EXPORT_ACTIVATION_STATE.READING) return false;
  return renderLocalExportActivation(document, state);
}

export function bindLocalExportActivation(document, { onChoose, onReturn }) {
  const choose = document.getElementById("activate-local-export");
  const reset = document.getElementById("return-to-bundled-example");
  if (!choose || !reset) return false;
  choose.addEventListener("click", onChoose);
  reset.addEventListener("click", onReturn);
  return true;
}
