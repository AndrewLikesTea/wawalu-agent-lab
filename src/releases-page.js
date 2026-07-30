// Page wiring for the releases view: the recorder that writes a release and the
// LIST that shows the result. Data sourcing is delegated to releases-data.js
// (shared with the detail view) and every rendering decision to releases.js /
// release-form.js; this layer only binds composed data to the DOM so both
// components stay reusable and unit-testable.

import {
  ALL_DECISIONS_FILTER,
  decisionFilterSearch,
  focusRelease,
  loadReleases,
  mountReleaseList,
  releaseCountText,
  readDecisionFilter,
  releaseFollowUp,
  renderReleaseFollowUp,
  renderReleaseListState,
  saveReleases,
} from "./releases.js";
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
  const decisionGroup = root.querySelector("#release-decisions-field");
  const picker = mountDecisionPicker(decisionField, {
    decisions: options.decisions ?? [],
    summary: root.querySelector("#release-decisions-summary"),
    // Ticking anything answers the only complaint this group can raise, so the
    // alert and the invalid marking clear as soon as the user acts on them
    // rather than lingering until the next submit.
    onChange: () => clearError(),
  });

  // Failures the checkbox group owns are also announced *on* the group: the
  // alert states what is wrong, `aria-invalid` marks which control is wrong,
  // and focus lands back in the group so the fix is one keystroke away.
  const SELECTION_ERRORS = [RELEASE_FORM_ERRORS.noDecisions, RELEASE_FORM_ERRORS.unknownDecision];

  const showError = (message) => {
    if (error) {
      error.textContent = message;
      error.hidden = false;
    }
    if (!SELECTION_ERRORS.includes(message)) return;
    decisionGroup?.setAttribute("aria-invalid", "true");
    picker.focus();
  };
  const clearError = () => {
    decisionGroup?.removeAttribute("aria-invalid");
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
        releasedOn: form.elements.releasedOn?.value,
        decisionIds: picker.selectedIds(),
      }, { decisions: options.decisions ?? [] });
    } catch (failure) {
      // An empty checkbox group and a selection that no longer resolves are the
      // failures native form validity cannot express. They are reported inline
      // and nothing is written; any other failure is a programming error and
      // keeps throwing.
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
  const followUpSlot = root.querySelector("#release-followup");
  // A radio group, so the active filter is whichever option is checked. Read
  // from the controls on every update rather than mirrored into page state:
  // the browser already owns "which one is selected", and a second copy of that
  // answer is a second thing that can be wrong.
  const decisionStatusInputs = [...(root.querySelectorAll?.('input[name="release-decision-status"]') ?? [])];
  // The one filter whose state survives a reload, for the same reason the
  // decisions history's does: a link to the releases behind one decision is
  // worth sharing. Everything else stays in the controls.
  const decisionFilter = root.querySelector("#release-decision");
  const locationRef = options.location ?? globalThis.window?.location;
  const historyRef = options.history ?? globalThis.window?.history;
  if (!container) return;

  // Every early return below leaves the page in a stated end state: the list
  // shows why it is empty, the count says so, and no stale follow-up survives
  // pointing at releases this page never managed to load.
  const clearFollowUp = () => {
    if (followUpSlot) renderReleaseFollowUp(followUpSlot, null);
  };

  container.setAttribute("aria-busy", "true");
  let data;
  try {
    data = loadReleaseData(storage, options.seed ?? {});
  } catch {
    renderReleaseListState(container, "error");
    if (count) count.textContent = "Unavailable";
    clearFollowUp();
    return;
  }
  const { decisions, unavailable, exampleReleaseIds } = data;
  let releases = data.releases;
  if (unavailable && releases.length === 0) {
    renderReleaseListState(container, "error");
    if (count) count.textContent = "Unavailable";
    clearFollowUp();
    return;
  }

  // The same example ids the decisions history badges its rows from, so a
  // shipped example says so here too and a release the visitor recorded (or
  // imported over a seed id) never carries the label.
  // One option per decision this log holds, named by its title. Written through
  // textContent, never markup: a decision title is user-authored (PRODUCT.md:
  // no user-generated HTML), and an <option> is no exception.
  const ownerDocument = root.ownerDocument ?? root;
  const knownDecisionIds = new Set(decisions.map(({ id }) => id));
  if (decisionFilter && typeof ownerDocument?.createElement === "function") {
    for (const decision of decisions) {
      const option = ownerDocument.createElement("option");
      option.setAttribute("value", decision.id);
      option.textContent = typeof decision.title === "string" && decision.title.trim() !== ""
        ? decision.title
        : decision.id;
      decisionFilter.append(option);
    }
    // A restored value naming a decision this log no longer holds falls back to
    // "all" rather than emptying the history — the same rule the status filter
    // applies to a stale bookmark. The <select> cannot show an option that is
    // not there, so leaving it set would also desync the control from the view.
    const restored = readDecisionFilter(locationRef?.search ?? "");
    decisionFilter.value = knownDecisionIds.has(restored) ? restored : ALL_DECISIONS_FILTER;
  }

  // The query string this page owns, tracked locally because replaceState does
  // not report back through the same object in every environment.
  let queryString = locationRef?.search ?? "";
  const syncUrl = () => {
    queryString = decisionFilterSearch(queryString, decisionFilter?.value ?? ALL_DECISIONS_FILTER);
    const target = `${locationRef?.pathname ?? ""}${queryString}${locationRef?.hash ?? ""}`;
    if (target) historyRef?.replaceState?.(null, "", target);
  };

  const view = mountReleaseList(container, { releases, decisions, exampleIds: exampleReleaseIds });
  const update = () => {
    const filters = {
      query: search?.value ?? "",
      status: statusFilter?.value ?? "all",
      decisionStatus: decisionStatusInputs.find((input) => input.checked)?.value ?? "all",
      decisionId: decisionFilter?.value ?? ALL_DECISIONS_FILTER,
    };
    const shown = view.render({ releases, decisions, exampleIds: exampleReleaseIds }, filters);
    // One count, from the same computation that rendered the rows, and one
    // follow-up derived from exactly those rows — so the callout can never
    // point at a release the active filter has hidden.
    if (count) count.textContent = releaseCountText(shown.length, releases.length);
    if (followUpSlot) renderReleaseFollowUp(followUpSlot, releaseFollowUp(shown));
  };
  search?.addEventListener("input", update);
  statusFilter?.addEventListener("change", update);
  for (const input of decisionStatusInputs) input.addEventListener("change", update);
  decisionFilter?.addEventListener("change", () => {
    syncUrl();
    update();
  });

  // The next step each empty state offers. Delegated to the list container so it
  // survives the re-render that removes the button, and focus is moved off that
  // button before it disappears: resetting returns focus to the filter group it
  // just cleared, recording moves it to the first field of the form it names.
  container.addEventListener("click", (event) => {
    const action = event.target.closest?.("[data-action]");
    if (!action) return;
    if (action.dataset.action === "reset-filters") {
      if (search) search.value = "";
      if (statusFilter) statusFilter.value = "all";
      if (decisionFilter) decisionFilter.value = ALL_DECISIONS_FILTER;
      for (const input of decisionStatusInputs) input.checked = input.value === "all";
      syncUrl();
      update();
      decisionStatusInputs.find((input) => input.value === "all")?.focus?.();
    } else if (action.dataset.action === "record-release") {
      root.querySelector("#release-version")?.focus?.();
    }
  });

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
  const focusId = new URLSearchParams(locationRef?.search ?? "").get("focus");
  if (focusId) focusRelease(container, focusId);
  const documentElement = root.documentElement ?? globalThis.document?.documentElement;
  if (documentElement) documentElement.dataset.shiplogReleases = "ready";
}

// Guarded so this module can be imported by a test (or another page) without
// booting against a document that is not the releases page.
if (typeof document !== "undefined" && document.querySelector("#release-list")) {
  initReleasesPage();
}
