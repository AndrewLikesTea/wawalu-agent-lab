import {
  readEvidenceFiles, savingsEvidenceBundle,
} from "/savings-evidence.js";
import {
  renderEvidenceRejections,
  renderRecurringReviewReadiness,
  renderSavingsActionCenter,
  renderSavingsActionCenterError,
  renderSavingsActionCenterLoading,
} from "/savings-action-center-view.js";
import { journeyPaintKey } from "/finops-journey-signals.js";
import { assembleRecurringReview } from "/recurring-review-readiness.js";
import {
  journeySnapshotPaintKey, restoreJourneySnapshot,
} from "/finops-journey-snapshot.js";
// The whole journey on this surface: evidence, the one prioritized step, and the
// checkpoint that will judge it. It composes the same restored snapshot this
// entry already read — nothing is read from storage twice — and it decides
// nothing the contracts below have not already decided.
import { consolidateJourney } from "/finops-journey-consolidated.js";
import {
  renderConsolidatedJourney, renderJourneyExamplePicker,
} from "/finops-journey-consolidated-view.js";
// The bundled examples, loaded through the same restore this entry already
// makes. They are records, not a mode: choosing one changes which store the
// journey is composed from and nothing else on this page.
import {
  BUNDLED_EXAMPLES, BUNDLED_EXAMPLE_NAMES, evaluateBundledExample,
} from "/finops-journey-fixtures.js";
import { browserFinopsWorkspaceStorage } from "/finops-workspace.js";
import { loadDecisions } from "/app.js";
import { loadReleases } from "/releases.js";
import {
  persistReconciliations, reconcileImportedAnalysis,
} from "/decision-reconciliation.js";
import {
  persistedStatusText, renderDecisionReconciliation,
} from "/decision-reconciliation-view.js";
// The recoverable answer, from the same derivation /evolution.html paints its
// answer region from. This page carries the move out; it does not get to hold a
// second opinion about what the move is worth.
import { renderRecoverablePointer } from "/finops-recoverable-answer-view.js";

// Before anything on this page is read from storage: the pointer to the answer,
// repainted from the derivation. It touches text and the anchor already in the
// document — no element, no focusable, and no stored or reader data.
renderRecoverablePointer(document);

const root = document.getElementById("savings-action-center");
const notices = document.getElementById("sac-notices");
const fileInput = document.getElementById("sac-file");
const exportButton = document.getElementById("sac-export");
const clearButton = document.getElementById("sac-clear");
const status = document.getElementById("sac-evidence-status");
const reconciliationRoot = document.getElementById("sac-reconciliation");
const saveButton = document.getElementById("sac-reconcile-save");
const saveStatus = document.getElementById("sac-reconcile-status");
const journeyLive = document.getElementById("sac-journey-live");

// One title per state of this view. The static markup names the page; a reader
// with six tabs open needs to know which of them holds a review that is ready.
const TITLE = Object.freeze({
  ready: "Ready to act on",
  blocked: "Not ready · evidence gap",
  insufficient_evidence: "Not ready · insufficient evidence",
  unavailable: "Unavailable",
});
const titleFor = (state) =>
  `${TITLE[state] ?? TITLE.unavailable} · Monthly Savings Action Center · Shiplog`;

// The keyboard is moved to this view's heading once, when the review first
// resolves. Later repaints must not do it again: a reader who has tabbed into a
// disclosure would be thrown back to the top by a file they just opened.
let announced = false;

// The reconciliation the months currently open produce. Recomputed on every
// read of the file input, so the panel and the save control can never describe a
// selection that is no longer on screen.
let reconciliation = null;

// Which bundled example is loaded, or null for this browser's own records. It
// is held in this tab only: an example a reader opened is not a preference, and
// a returning visitor is shown their own review.
let example = null;

const EXAMPLE_CHOICES = BUNDLED_EXAMPLE_NAMES.map((name) => ({
  name, title: BUNDLED_EXAMPLES[name].title,
}));

// The opened evidence, held only for as long as the tab is open. Nothing here is
// written to storage: a briefing is the visitor's own spend, and this page has
// no reason to keep a copy of it after they close it.
let opened = [];

function paint(node) {
  root.replaceChildren(node);
  root.setAttribute("aria-busy", "false");
}

/**
 * Land the reader in this view: name it in the title, say so once in a polite
 * live region, and put the keyboard on the view's own heading.
 *
 * Focus goes to the heading rather than to the recommended action, because the
 * heading is what a returning reader needs read to them first, and because the
 * control that brought them here is on another page and no longer exists to
 * hold focus.
 */
function arrive(state, sentence) {
  document.title = titleFor(state);
  if (announced) return;
  announced = true;
  if (journeyLive) journeyLive.textContent = sentence;
  document.getElementById("sac-question")?.focus();
}

function paintNotices(rejected) {
  const node = renderEvidenceRejections(rejected);
  notices.replaceChildren(...(node ? [node] : []));
}

function say(message) {
  status.textContent = message;
}

/**
 * Reconcile the recorded decisions against whatever is open, and paint it.
 *
 * This runs on every read rather than behind its own control: the reader has
 * already asked the one question this page exists for by opening a month, and
 * making them press a second button to find out which of their own recorded
 * commitments that month settles would be asking it twice. The pass is pure and
 * writes nothing — persistence is the separate, explicit control below.
 *
 * `reconciledAt` is read from the clock here, at the edge, and passed in, so the
 * model itself stays testable without one.
 */
function renderReconciliation() {
  if (!reconciliationRoot) return;
  reconciliation = reconcileImportedAnalysis({
    decisions: loadDecisions(globalThis.localStorage),
    releases: loadReleases(globalThis.localStorage),
    entries: opened,
    reconciledAt: new Date().toISOString(),
  });
  reconciliationRoot.replaceChildren(renderDecisionReconciliation(reconciliation));
  // Nothing to save when nothing was reconciled; the control says so by being
  // unavailable rather than by failing after it is pressed.
  if (saveButton) saveButton.disabled = reconciliation.rows.length === 0;
}

function renderClaim() {
  const importing = opened.length > 0;
  exportButton.disabled = !importing;
  clearButton.disabled = !importing;
  renderReconciliation();
  // Both halves of the join are read through the same accessor the analysis page
  // writes them with. Reading `globalThis.localStorage` directly here would not
  // be the same thing: with site data blocked the *accessor* throws, and an
  // uncaught throw in this entry module leaves the page on its "Reconciling
  // monthly savings…" region with aria-busy="true" for good.
  const storage = browserFinopsWorkspaceStorage();
  // One read of this browser's own records, through the snapshot the import left
  // behind. A snapshot that is invalid, stale, or from a version this build does
  // not support costs the carried provenance line and nothing else: the three
  // values below are the records' own state either way, which is exactly what
  // this view showed before any snapshot existed.
  const restored = restoreJourneySnapshot(storage);
  const { retainedAction, currentAnalysis, theoVerdict } = restored;
  const review = assembleRecurringReview({ retainedAction, currentAnalysis, theoVerdict });
  // The consolidated journey, from the same restored snapshot. `new Date()` is
  // read here, at the edge, and passed in: the model is a pure function of its
  // arguments, so the same records always produce the same journey. A journey
  // that has not changed is left standing by the view itself, which is what keeps
  // an evidence read from closing the disclosures a reader opened.
  renderJourneyExamplePicker(document, {
    choices: EXAMPLE_CHOICES,
    active: example,
    onSelect: (name) => { example = name; renderClaim(); },
  });
  // A loaded example composes the same model from bundled records, carrying the
  // provenance marker that makes it distinguishable from the reader's own. Its
  // clock is the fixture's own hardcoded day, which is what makes the answer
  // below reproducible rather than dependent on when it is read.
  renderConsolidatedJourney(document, example
    ? evaluateBundledExample(example, { surface: "review" })
    : consolidateJourney({ restored, now: new Date(), surface: "review" }));
  // An unchanged review is left standing. Every evidence read repaints this
  // region, and rebuilding a review nothing moved would close the disclosures
  // the reader opened and take the keyboard with them — the same rule the
  // guided workspace already runs on. A review that genuinely moved on does
  // repaint, and losing the open panels is then the honest outcome.
  const key = `${journeyPaintKey(review, retainedAction)} ${journeySnapshotPaintKey(restored)}`;
  if (root.firstChild?.dataset?.reviewKey !== key) {
    paint(renderRecurringReviewReadiness(review, {
      source: "local", retainedAction, snapshot: restored,
    }));
  } else {
    root.setAttribute("aria-busy", "false");
  }
  arrive(review.state, `${review.question} ${review.headline}`);
}

async function openFiles(list) {
  const files = [];
  for (const file of list) {
    files.push({ name: file.name, text: await file.text(), byteSize: file.size });
  }
  const read = readEvidenceFiles(files);
  // Preserve every accepted file through verification. The metric layer keys
  // observations by period, so agreeing copies count once and conflicting
  // copies count as no month. Replacing a month here would silently make the
  // last file authoritative and keep the documented conflict state from ever
  // reaching the leader.
  opened = [...opened, ...read.opened];
  paintNotices(read.rejected);
  renderClaim();
  const months = opened.map((entry) => entry.month).filter(Boolean).sort();
  const distinctMonths = [...new Set(months)];
  const duplicateCount = months.length - distinctMonths.length;
  say(`${distinctMonths.length} distinct month${distinctMonths.length === 1 ? "" : "s"} open: `
    + `${distinctMonths.join(", ") || "none"}.`
    + (duplicateCount
      ? ` ${duplicateCount} additional file${duplicateCount === 1 ? "" : "s"} repeat`
        + `${duplicateCount === 1 ? "s" : ""} an open month and will not add verification months.`
      : "")
    + (read.rejected.length ? ` ${read.rejected.length} file(s) were not read.` : ""));
}

fileInput?.addEventListener("change", async (event) => {
  const list = [...(event.target.files ?? [])];
  if (!list.length) return;
  root.setAttribute("aria-busy", "true");
  // A standing review is left on screen while the files are read — it is still
  // true, and replacing it would close the reader's disclosures. Only a region
  // that never resolved to a review gets the loading state drawn into it.
  if (!root.querySelector(".sac-focus")) {
    paint(renderSavingsActionCenterLoading("Reading the evidence files you opened…"));
    root.setAttribute("aria-busy", "true");
  }
  try {
    await openFiles(list);
  } catch (error) {
    console.error("savings_evidence_unreadable", { error: error?.message ?? String(error) });
    say("Those files could not be read in this tab. Nothing on this page changed.");
    root.setAttribute("aria-busy", "false");
  } finally {
    // So reopening the same file fires a change event again.
    event.target.value = "";
  }
});

exportButton?.addEventListener("click", () => {
  const file = savingsEvidenceBundle(opened, { exportedAt: new Date().toISOString() });
  const url = URL.createObjectURL(new Blob([file.text], { type: file.mediaType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName;
  link.click();
  URL.revokeObjectURL(url);
  say(`Exported ${opened.length} briefing${opened.length === 1 ? "" : "s"} as ${file.fileName}. `
    + "Open that file here again to reopen this review.");
});

clearButton?.addEventListener("click", () => {
  opened = [];
  paintNotices([]);
  renderClaim();
  if (saveStatus) saveStatus.textContent = "";
  say("Imported evidence cleared. The review above still reads this browser's own "
    + "retained action and analysis; clearing files here removed neither.");
  fileInput?.focus();
});

// Persisting is its own explicit press. The reconciliation is derived from the
// visitor's own records, but writing it amends decisions they authored, and this
// product does not amend a stored record because a file was opened.
saveButton?.addEventListener("click", () => {
  if (!reconciliation) return;
  const result = persistReconciliations(globalThis.localStorage, reconciliation);
  if (saveStatus) saveStatus.textContent = persistedStatusText(result);
  // Repaint from storage so the panel shows what was actually kept rather than
  // what was offered.
  renderReconciliation();
});

// The first paint is the whole page: everything above is a handler that only
// runs if this one succeeds. A throw here — a storage accessor a browser refuses,
// a stored record no reader guards — would otherwise leave the static
// "Reconciling monthly savings…" region with aria-busy="true" and never resolve,
// which reads as a page that is still working. This says so instead, in an
// alert region, and keeps the failure in the console for a deploy to find.
try {
  renderClaim();
} catch (error) {
  console.error("savings_action_center_unavailable", {
    error: error?.message ?? String(error),
  });
  paint(renderSavingsActionCenterError());
  // The failure is a state of this view, so it names itself in the title and in
  // the live region too. Focus stays where the reader left it: there is no
  // heading here worth taking the keyboard for, and the alert announces itself.
  document.title = titleFor("unavailable");
  announced = true;
  if (journeyLive) {
    journeyLive.textContent = "Monthly savings review unavailable. No savings decision is shown.";
  }
}
