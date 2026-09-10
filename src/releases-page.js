// Page wiring for the releases view: the recorder that writes a release and the
// LIST that shows the result. Data sourcing is delegated to releases-data.js
// (shared with the detail view) and every rendering decision to releases.js /
// release-form.js; this layer only binds composed data to the DOM so both
// components stay reusable and unit-testable.

import {
  ALL_DECISIONS_FILTER,
  focusRelease,
  mountReleaseList,
  readReleases,
  releaseListStateCopy,
  releaseSummarySentence,
  releaseDetailHref,
  releaseDetailLinkLabel,
  releaseFollowUp,
  renderReleaseFollowUp,
  renderReleaseListState,
  saveReleases,
} from "./releases.js";
import { bindReleaseFilterUrl } from "./release-filter-url.js";
import { loadReleaseData } from "./releases-data.js";
import { BUILD_STAMP } from "./build-stamp.js";
import { deployedReleaseRecord } from "./deployed-release.js";
import { renderShippedBuild } from "./deployed-release-view.js";
import { initDeploymentStatus } from "./deployment-status-view.js";
import { RELEASE_FORM_ERRORS, createRelease, mountDecisionPicker, recordedSummaryText } from "./release-form.js";
import { copyRecordUrl } from "./share-link.js";
import { initReleaseExport } from "./release-export.js";

const SAVE_FAILED = "This release could not be saved in this browser. Your entries are still here; free some browser storage and try again.";
export const LOG_UNREAD = "Couldn’t save: the release log didn’t load. Retry loading releases, then record again.";

export function initShiplogProof(root, options = {}) {
  const button = root.querySelector("#shiplog-proof-copy");
  const link = root.querySelector(".shiplog-proof-link");
  const status = root.querySelector("#shiplog-proof-copy-status");
  if (!button || !link || !status) return;
  const locationRef = options.location ?? globalThis.window?.location;
  const clipboard = options.clipboard ?? globalThis.navigator?.clipboard;
  let url = "";
  try {
    url = new URL(link.getAttribute("href"), locationRef?.origin).href;
  } catch {}
  button.addEventListener("click", async () => {
    button.disabled = true;
    status.textContent = "";
    const copied = await copyRecordUrl(clipboard, url);
    status.textContent = copied
      ? "Example link copied to clipboard."
      : "Clipboard unavailable. Use the “Open this example release” link beside this button to open or copy its address.";
    button.disabled = false;
  });
}

// The hero's one link to the recorder, which now sits below the whole log.
//
// The anchor already carries the address, and #record-release is focusable, so
// a page with no JavaScript still arrives and still lands: this listener only
// makes the landing explicit instead of leaving it to each browser's
// fragment-focus behaviour. Nothing is prevented — the fragment still reaches
// the URL, so the arrival stays shareable and the back button undoes it — and
// the destination is the same anchor the deployment check's "Record the release
// that is running" has always pointed at, so both arrive in one place.
export function initRecordReleaseJump(root) {
  const link = root.querySelector("#record-release-link");
  const panel = root.querySelector("#record-release");
  if (!link || !panel) return;
  link.addEventListener("click", () => {
    panel.focus?.({ preventScroll: true });
    panel.scrollIntoView?.({ block: "start" });
  });
}

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
  const success = root.querySelector("#release-record-next");
  const detailLink = root.querySelector("#release-record-detail");
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
  const SELECTION_ERRORS = [RELEASE_FORM_ERRORS.unknownDecision];

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

  // The success state belongs to exactly one release: the last one this browser
  // actually stored. Withdrawing it is therefore a single operation over both
  // halves — the announced sentence and the region that offers the record — so
  // neither can survive the other and leave the page half-claiming a record.
  const clearRecorded = () => {
    if (status) status.textContent = "";
    if (success) success.hidden = true;
  };

  // Touching the form is composing the next release, so the previous one's
  // ending is withdrawn on the first keystroke or tick. This is not a
  // convenience: a browser refuses a form that fails native validation *before*
  // dispatching submit, so the handler below never runs on the invalid submit
  // that most needs the stale success gone. Clearing on the way in covers it.
  // form.reset() and the picker's own re-render raise neither event, so the
  // state this sets on a successful record survives the reset that follows it.
  form.addEventListener("input", clearRecorded);
  form.addEventListener("change", clearRecorded);

  const showRecorded = (release) => {
    if (status) status.textContent = recordedSummaryText(release);
    if (detailLink) {
      detailLink.setAttribute("href", releaseDetailHref(release.id));
      detailLink.setAttribute("aria-label", releaseDetailLinkLabel(release));
    }
    if (success) success.hidden = false;
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    clearRecorded();
    // A submit the browser refused is a submit that recorded nothing, and it
    // has to say so where the form's other failures say so. The native bubble
    // names the field but does not persist; this does.
    if (!form.reportValidity()) {
      showError(RELEASE_FORM_ERRORS.incomplete);
      return;
    }

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
      // A selection that no longer resolves is a failure native form validity
      // cannot express. It is reported inline and nothing is written; any
      // other failure is a programming error and keeps throwing.
      if (!Object.values(RELEASE_FORM_ERRORS).includes(failure.message)) throw failure;
      showError(failure.message);
      return;
    }
    clearError();

    // The log the new record joins is read strictly. The tolerant loader turns a
    // refused read into an empty log, and saving over that would erase every
    // release already stored — so an unread log refuses the save instead, and
    // every typed field stays for the record after a retry.
    let existing;
    try {
      existing = readReleases(storage);
    } catch {
      showError(LOG_UNREAD);
      return;
    }
    try {
      saveReleases(storage, [release, ...existing]);
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
    showRecorded(release);
    form.reset();
    picker.clear();
    detailLink?.focus?.();
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
  const decisionFilter = root.querySelector("#release-decision");
  const locationRef = options.location ?? globalThis.window?.location;
  const historyRef = options.history ?? globalThis.window?.history;
  if (!container) return;
  initShiplogProof(root, options);
  initRecordReleaseJump(root);

  // The real record of this deployment, painted before anything else on the
  // page: the observatory's "read the releases these pull requests shipped"
  // link lands here, and what it lands on has to be a record a visitor can
  // check rather than the invented-example panel below it. Derived from the
  // stamp this artifact shipped with, and null when that stamp names no commit —
  // in which case the block says so and no record is manufactured.
  const buildStamp = options.buildStamp ?? BUILD_STAMP;
  const deployedRelease = options.deployedRelease !== undefined
    ? options.deployedRelease
    : deployedReleaseRecord(buildStamp);
  renderShippedBuild(root, deployedRelease, options);

  // The log's one live region. Loading, empty, no-match and failed-load are all
  // announced here and nowhere else, and none of them moves focus on its own.
  const listStatus = root.querySelector("#release-list-status");
  const announce = (state) => {
    if (listStatus) listStatus.textContent = releaseListStateCopy(state)[0];
  };
  const seed = options.seed ?? {};
  // The strict read, or null when the store refused it.
  const readLog = () => {
    try {
      return loadReleaseData(storage, seed, { strict: true });
    } catch {
      return null;
    }
  };

  container.setAttribute("aria-busy", "true");
  announce("loading");
  let data = readLog();
  // An unread log is a state of the list, not of the page: the filters and the
  // recorder still work from what did load, and the recorder refuses to save
  // over a log it could not read.
  let unread = data === null;
  data ??= loadReleaseData(storage, seed);
  const { decisions } = data;
  let releases = data.releases;
  // One set for the page's lifetime, refilled by a successful retry, so the
  // list and the export keep reading the same answer without being re-bound.
  const exampleReleaseIds = new Set(data.exampleReleaseIds);

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
  }

  // The clipboard the expanded rows' "Copy release brief" controls write
  // through, from the same option the share and export controls above read, so
  // a test drives one writer rather than patching a global.
  const view = mountReleaseList(
    container,
    { releases, decisions, exampleIds: exampleReleaseIds },
    { clipboard: options.clipboard ?? globalThis.navigator?.clipboard, status: listStatus },
  );
  // The one selection this page holds: whatever the last render actually drew.
  // The export reads it rather than filtering a second time, so the file a
  // visitor downloads is the list they are looking at by construction and not
  // by two implementations agreeing.
  let shown = [];
  const update = () => {
    if (unread) {
      // Nothing is shown, so nothing is counted, exported or followed up.
      shown = [];
      renderReleaseListState(container, "error", { actions: true, status: listStatus });
      if (count) count.textContent = "";
      if (followUpSlot) renderReleaseFollowUp(followUpSlot, null);
      return;
    }
    const filters = {
      query: search?.value ?? "",
      status: statusFilter?.value ?? "all",
      decisionStatus: decisionStatusInputs.find((input) => input.checked)?.value ?? "all",
      decisionId: decisionFilter?.value ?? ALL_DECISIONS_FILTER,
    };
    shown = view.render({ releases, decisions, exampleIds: exampleReleaseIds }, filters);
    // One count, from the same computation that rendered the rows, and one
    // follow-up derived from exactly those rows — so the callout can never
    // point at a release the active filter has hidden.
    if (count) count.textContent = releaseSummarySentence(shown.length, releases.length);
    if (followUpSlot) renderReleaseFollowUp(followUpSlot, releaseFollowUp(shown));
  };
  // Reads the selection above at press time, not a copy taken at boot, so the
  // file follows every filter change without a subscription to maintain.
  initReleaseExport(root, {
    shown: () => shown,
    exampleIds: exampleReleaseIds,
    now: options.now,
    download: options.download,
  });
  const filtersChanged = bindReleaseFilterUrl({
    root, search, statusFilter, decisionFilter, decisionStatusInputs, knownDecisionIds,
    location: locationRef, history: historyRef,
    navigation: options.navigation ?? globalThis.window,
    clipboard: options.clipboard ?? globalThis.navigator?.clipboard, update,
  });

  // Read the log again, announcing the wait. Returns whether it loaded; a failed
  // read re-announces the error and leaves the panel, and its Retry, in place.
  const reload = () => {
    announce("loading");
    const next = readLog();
    if (!next) {
      announce("error");
      return false;
    }
    unread = false;
    releases = next.releases;
    exampleReleaseIds.clear();
    for (const id of next.exampleReleaseIds) exampleReleaseIds.add(id);
    update();
    return true;
  };

  // The next step each state offers. Delegated to the list container so it
  // survives the re-render that removes the button, and focus is moved off that
  // button before it disappears: resetting returns focus to the search it just
  // cleared, recording moves it to the first field of the form it names, and a
  // retry that loaded lands on the log's heading.
  container.addEventListener("click", (event) => {
    const action = event.target.closest?.("[data-action]");
    if (!action) return;
    if (action.dataset.action === "reset-filters") {
      if (search) search.value = "";
      if (statusFilter) statusFilter.value = "all";
      if (decisionFilter) decisionFilter.value = ALL_DECISIONS_FILTER;
      for (const input of decisionStatusInputs) input.checked = input.value === "all";
      filtersChanged();
      search?.focus?.();
    } else if (action.dataset.action === "record-release") {
      root.querySelector("#release-version")?.focus?.();
    } else if (action.dataset.action === "retry" && reload()) {
      root.querySelector("#releases-title")?.focus?.();
    }
  });

  // A successfully recorded release joins the composed list in memory rather
  // than through a re-read of storage. initReleaseRecorder calls this only
  // after persistence succeeds, so history never contains a phantom record.
  // On an unread log the save itself proved the log readable again, so the
  // list is read back instead of joined to a list it never loaded.
  initReleaseRecorder(root, storage, {
    decisions,
    onRecorded: (release) => {
      if (unread) {
        reload();
        return;
      }
      releases = [release, ...releases];
      update();
    },
  });

  // The deployment status band, booted once from the same composed log the list
  // renders. It reads `/healthz` and nothing else, so it cannot delay or fail
  // the list: the promise is guarded end to end, and a boot that somehow still
  // threw leaves the authored waiting line — which names the identifier being
  // retrieved and the record it is compared with — rather than a blank panel.
  //
  // Not re-run when a release is recorded. The band answers a question about the
  // running deployment against the real record of it, and neither of those
  // changes because a visitor wrote a record of their own.
  initDeploymentStatus(root, {
    release: deployedRelease,
    buildStamp,
    readHealth: options.readHealth,
    now: options.now,
    clipboard: options.clipboard,
  }).catch(() => {});

  update();
  const focusId = new URLSearchParams(locationRef?.search ?? "").get("focus");
  if (focusId) focusRelease(container, focusId, { expand: true });
  const documentElement = root.documentElement ?? globalThis.document?.documentElement;
  if (documentElement) documentElement.dataset.shiplogReleases = "ready";
}

// Guarded so this module can be imported by a test (or another page) without
// booting against a document that is not the releases page.
if (typeof document !== "undefined" && document.querySelector("#release-list")) {
  initReleasesPage();
}
