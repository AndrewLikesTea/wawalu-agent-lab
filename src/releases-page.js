// Page wiring for the releases view: the recorder that writes a release and the
// LIST that shows the result. Data sourcing is delegated to releases-data.js
// (shared with the detail view) and every rendering decision to releases.js /
// release-form.js; this layer only binds composed data to the DOM so both
// components stay reusable and unit-testable.

import { focusRelease, loadReleases, mountReleaseList, renderReleaseListState, saveReleases } from "./releases.js";
import { loadReleaseData } from "./releases-data.js";
import { RELEASE_FORM_ERRORS, createRelease, mountDecisionPicker, recordedSummaryText } from "./release-form.js";

const SAVE_FAILED = "This release could not be saved in this browser. Your entries are still here; free some browser storage and try again.";

// The recorder. Returns null when the page carries no form, so the list wiring
// below is unaffected on a surface that only browses.
//
// Nothing is written until the record validates: a rejected submit leaves the
// typed fields and the linked decisions exactly as they were, because the
// selection lives in the picker's state rather than in the DOM the browser
// would clear on a reset.
function initReleaseRecorder(root, storage, options = {}) {
  const form = root.querySelector("#release-form");
  const decisionField = root.querySelector("#release-decisions");
  if (!form || !decisionField) return null;
  const error = root.querySelector("#release-form-error");
  const status = root.querySelector("#release-record-status");
  const notice = root.querySelector("#release-storage-notice");
  const picker = mountDecisionPicker(decisionField, {
    decisions: options.decisions ?? [],
    summary: root.querySelector("#release-decisions-summary"),
  });

  const showError = (message) => {
    if (!error) return;
    error.textContent = message;
    error.hidden = false;
  };
  const clearError = () => {
    if (!error) return;
    error.textContent = "";
    error.hidden = true;
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    let release;
    try {
      release = createRelease({
        version: form.elements.version?.value,
        title: form.elements.title?.value,
        description: form.elements.description?.value,
        owner: form.elements.owner?.value,
        status: form.elements.status?.value,
        decisionIds: picker.selectedIds(),
      }, { decisions: options.decisions ?? [] });
    } catch (failure) {
      // A selection that no longer resolves is the one failure native form
      // validity cannot express. It is reported inline and nothing is written;
      // any other failure is a programming error and keeps throwing.
      if (!Object.values(RELEASE_FORM_ERRORS).includes(failure.message)) throw failure;
      showError(failure.message);
      return;
    }
    clearError();

    try {
      saveReleases(storage, [release, ...loadReleases(storage)]);
      if (notice) notice.hidden = true;
    } catch {
      if (notice) {
        notice.textContent = SAVE_FAILED;
        notice.hidden = false;
      }
      // Persistence is the commit boundary. Keep every field and association
      // intact so the user can retry; do not render or announce a record that
      // will disappear on reload.
      return;
    }
    options.onRecorded?.(release);
    if (status) status.textContent = recordedSummaryText(release);
    form.reset();
    picker.clear();
    form.elements.version?.focus?.();
  });

  return picker;
}

export function initReleasesPage(root = document, storage = localStorage, options = {}) {
  const container = root.querySelector("#release-list");
  const count = root.querySelector("#release-count");
  const search = root.querySelector("#release-search");
  const statusFilter = root.querySelector("#release-status");
  if (!container) return;

  container.setAttribute("aria-busy", "true");
  let data;
  try {
    data = loadReleaseData(storage, options.seed ?? {});
  } catch {
    renderReleaseListState(container, "error");
    if (count) count.textContent = "Unavailable";
    return;
  }
  const { decisions, unavailable } = data;
  let releases = data.releases;
  if (unavailable && releases.length === 0) {
    renderReleaseListState(container, "error");
    if (count) count.textContent = "Unavailable";
    return;
  }

  const view = mountReleaseList(container, { releases, decisions });
  const update = () => {
    const filters = { query: search?.value ?? "", status: statusFilter?.value ?? "all" };
    const shown = view.render({ releases, decisions }, filters);
    if (count) count.textContent = `${shown.length} of ${releases.length} ${releases.length === 1 ? "release" : "releases"}`;
  };
  search?.addEventListener("input", update);
  statusFilter?.addEventListener("change", update);

  // A successfully recorded release joins the composed list in memory rather
  // than through a re-read of storage. initReleaseRecorder calls this only
  // after persistence succeeds, so history never contains a phantom record.
  initReleaseRecorder(root, storage, {
    decisions,
    onRecorded: (release) => {
      releases = [release, ...releases];
      update();
    },
  });

  update();
  const focusId = new URLSearchParams(globalThis.window?.location?.search ?? "").get("focus");
  if (focusId) focusRelease(container, focusId);
  const documentElement = root.documentElement ?? globalThis.document?.documentElement;
  if (documentElement) documentElement.dataset.shiplogReleases = "ready";
}

// Guarded so this module can be imported by a test (or another page) without
// booting against a document that is not the releases page.
if (typeof document !== "undefined" && document.querySelector("#release-list")) {
  initReleasesPage();
}
