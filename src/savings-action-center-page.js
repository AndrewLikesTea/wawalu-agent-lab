import { demoSavingsClaim, loadSavingsActionCenter } from "/savings-action-center.js";
import {
  importedSavingsClaim, readEvidenceFiles, savingsEvidenceBundle,
} from "/savings-evidence.js";
import {
  renderEvidenceRejections,
  renderSavingsActionCenter,
  renderSavingsActionCenterError,
} from "/savings-action-center-view.js";
import { loadDecisions } from "/app.js";
import { loadReleases } from "/releases.js";
import {
  persistReconciliations, reconcileImportedAnalysis,
} from "/decision-reconciliation.js";
import {
  persistedStatusText, renderDecisionReconciliation,
} from "/decision-reconciliation-view.js";

const root = document.getElementById("savings-action-center");
const notices = document.getElementById("sac-notices");
const fileInput = document.getElementById("sac-file");
const exportButton = document.getElementById("sac-export");
const clearButton = document.getElementById("sac-clear");
const status = document.getElementById("sac-evidence-status");
const reconciliationRoot = document.getElementById("sac-reconciliation");
const saveButton = document.getElementById("sac-reconcile-save");
const saveStatus = document.getElementById("sac-reconcile-status");

// The reconciliation the months currently open produce. Recomputed on every
// read of the file input, so the panel and the save control can never describe a
// selection that is no longer on screen.
let reconciliation = null;

// The opened evidence, held only for as long as the tab is open. Nothing here is
// written to storage: a briefing is the visitor's own spend, and this page has
// no reason to keep a copy of it after they close it.
let opened = [];
let demo = null;

function paint(node) {
  root.replaceChildren(node);
  root.setAttribute("aria-busy", "false");
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
  if (importing) {
    paint(renderSavingsActionCenter(importedSavingsClaim(opened)));
    return;
  }
  paint(demo
    ? renderSavingsActionCenter(demoSavingsClaim(demo))
    : renderSavingsActionCenterError());
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
  say("Imported evidence cleared. The demonstration month is shown again.");
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

try {
  demo = await loadSavingsActionCenter();
} catch (error) {
  console.error("savings_action_center_unavailable", {
    error: error?.message ?? String(error),
  });
}
renderClaim();
