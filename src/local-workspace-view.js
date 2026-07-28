// The local workspace, rendered.
//
// READING ORDER
// -------------
// The page is built to be read top to bottom and stopped at any point:
//
//   1. the privacy boundary — static markup, true before any script runs;
//   2. what is retained, and how sure the page is about it;
//   3. exactly one prioritized next action;
//   4. the other things you may do (backup, restore, erase);
//   5. where every number came from, behind a closed disclosure.
//
// Only (2)–(5)'s values are rendered here. The boundary is in the HTML because a
// claim about privacy that appears only when JavaScript succeeds is a claim a
// visitor cannot rely on.
//
// COLOUR IS NEVER THE MESSAGE
// ---------------------------
// Both chips carry their meaning as words — "Retaining", "Partial" — and the
// tone is set through `data-tone`, which the stylesheet uses for a wash or an
// outline. Reading the page in greyscale loses nothing. The two silhouettes
// follow the Claude Design foundations card: the storage chip is a live signal
// and takes a filled wash, the confidence chip is a static classification and
// takes an outline.
//
// DESTRUCTION IS TWO STEPS, AND THE SECOND ONE COUNTS WHAT IT WILL TAKE
// --------------------------------------------------------------------
// Erase reveals a named confirmation region, moves focus into it, and labels its
// commit button with the actual record counts. Cancel puts focus back on the
// control the reader pressed. Nothing here uses `window.confirm`: a native
// dialog cannot say how many records are about to go, and it cannot be read by
// the live region that reports what happened afterwards.

import { buildShiplogExport, downloadShiplogExport, unresolvedLinkSentence } from "./shiplog-export.js";
import { commitShiplogImport, formatImportSummary, prepareShiplogImport } from "./shiplog-import.js";
import {
  OUTCOME, RETENTION, WORKSPACE_STATE, eraseWorkspace, noteExport, readWorkspace, setRetention,
} from "./local-workspace.js";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function chip(label, kind, tone) {
  const node = element("span", `ws-chip ws-chip-${kind}`, label);
  node.dataset.tone = tone;
  return node;
}

function fact(term, ...values) {
  const row = element("div", "ws-fact");
  row.append(element("dt", null, term));
  const detail = element("dd");
  detail.append(...values);
  row.append(detail);
  return row;
}

const plural = (count, noun) => `${count} ${count === 1 ? noun : `${noun}s`}`;

/**
 * Mount the workspace surface against the shipped markup.
 *
 * @param root the document (or a parsed stand-in).
 * @param storage this browser's `localStorage`, or a stand-in.
 * @param options.now injectable clock, `options.readFile` injectable file
 *   reader, `options.download` injectable download — the same three seams the
 *   export and import panels already expose, so a flow test drives the shipped
 *   wiring rather than a copy of it.
 */
export function initLocalWorkspace(root, storage, options = {}) {
  const byId = (id) => root.querySelector(`#${id}`);
  const panel = byId("ws-panel");
  if (!panel) return null;

  const now = () => options.now?.() ?? new Date();
  const readFile = options.readFile ?? ((file) => file.text());
  const download = options.download ?? downloadShiplogExport;

  const status = byId("ws-status");
  const facts = byId("ws-facts");
  const summary = byId("ws-summary");
  const next = byId("ws-next");
  const outcome = byId("ws-outcome");
  const announcement = byId("ws-announcement");
  const provenance = byId("ws-provenance-list");
  const retentionButton = byId("ws-retention");
  const retentionNote = byId("ws-retention-note");
  const exportButton = byId("ws-export");
  const restoreInput = byId("ws-restore-file");
  const restorePlan = byId("ws-restore-plan");
  const restoreHeadline = byId("ws-restore-headline");
  const restoreCommit = byId("ws-restore-commit");
  const restoreCancel = byId("ws-restore-cancel");
  const eraseButton = byId("ws-erase");
  const confirm = byId("ws-confirm");
  const confirmTitle = byId("ws-confirm-title");
  const confirmWarning = byId("ws-confirm-warning");
  const confirmYes = byId("ws-confirm-yes");
  const confirmNo = byId("ws-confirm-no");

  let view = null;
  let plan = null;

  // One announcement channel. The visible notice and the screen-reader text are
  // the same sentence, so nothing is said to one reader and withheld from the
  // other.
  function report(message, { tone = "neutral" } = {}) {
    outcome.textContent = message ?? "";
    outcome.hidden = !message;
    outcome.dataset.tone = tone;
    announcement.textContent = message ?? "";
  }

  function closeConfirm({ focusTrigger = false } = {}) {
    confirm.hidden = true;
    eraseButton.setAttribute("aria-expanded", "false");
    if (focusTrigger) eraseButton.focus();
  }

  function closeRestorePlan() {
    plan = null;
    restorePlan.hidden = true;
    restoreHeadline.textContent = "";
  }

  function renderStatus() {
    facts.replaceChildren(
      fact("Storage", chip(view.storage.label, "storage", view.storage.tone)),
      fact("Retained", element("span", "ws-count", view.state === WORKSPACE_STATE.unavailable
        ? "Unknown"
        : `${plural(view.records.decisions, "decision")} · ${plural(view.records.releases, "release")}`)),
      fact("Confidence",
        chip(view.confidence.label, "confidence", view.confidence.grade),
        element("span", "ws-fact-detail", view.confidence.detail)),
    );
    summary.textContent = view.summary;
    status.dataset.state = view.state;
    panel.setAttribute("aria-busy", "false");
  }

  function renderNext() {
    const action = view.nextAction;
    const card = element("section", "ws-next-card");
    card.dataset.action = action.code;
    card.setAttribute("aria-labelledby", "ws-next-title");
    const title = element("h2", "ws-next-title", action.headline);
    title.id = "ws-next-title";
    title.setAttribute("tabindex", "-1");
    card.append(element("p", "eyebrow", "Do this next"), title, element("p", "ws-next-why", action.why));

    let control;
    if (action.kind === "link") {
      control = element("a", "ws-next-action", action.label);
      control.setAttribute("href", action.href);
    } else {
      control = element("button", "ws-next-action", action.label);
      control.setAttribute("type", "button");
      control.addEventListener("click", () => runAction(action.kind));
    }
    control.id = "ws-next-action";
    card.append(control);
    next.replaceChildren(card);
  }

  function renderProvenance() {
    provenance.replaceChildren(...view.provenance.map((row) => fact(row.term, element("span", null, row.detail))));
  }

  function renderControls() {
    const declined = view.retention === RETENTION.declined;
    retentionButton.textContent = declined
      ? "Keep new records in this browser"
      : "Stop keeping new records in this browser";
    retentionButton.setAttribute("aria-pressed", declined ? "false" : "true");
    retentionButton.disabled = view.state === WORKSPACE_STATE.unavailable;
    retentionNote.textContent = declined
      ? "Off. Decisions and releases you record stay on screen for the visit and are not written to "
        + "this browser. Records stored before you turned it off are untouched."
      : view.retentionChosen
        ? "On, by your choice. Decisions and releases you record are written to this browser and "
          + "are readable the next time you open Shiplog on this device."
        : "On, by default. Shiplog keeps records in this browser unless you turn it off here; you "
          + "have not been asked before, so this is the default rather than a choice you made.";

    exportButton.disabled = !view.canExport;
    eraseButton.disabled = !view.canErase;
    confirmYes.textContent = view.records.total > 0
      ? `Erase ${plural(view.records.decisions, "decision")} and ${plural(view.records.releases, "release")}`
      : "Erase the unreadable stored text";
    confirmWarning.textContent = view.records.total > 0
      ? `This removes ${plural(view.records.total, "record")} from this browser. Shiplog keeps no `
        + "other copy, so anything not in a downloaded backup is gone and cannot be recovered here."
      : "This removes the unreadable text stored under Shiplog's keys. Anything it contained is gone "
        + "and cannot be recovered here.";
  }

  function render() {
    view = readWorkspace(storage, { now: now() });
    renderStatus();
    renderNext();
    renderControls();
    renderProvenance();
    return view;
  }

  /**
   * Re-read, redraw, say what happened, and put focus where the answer is.
   *
   * Focus lands on the next action's heading rather than staying on a control
   * that may no longer mean what it did: after an erase, "Erase 3 decisions" is
   * gone, and leaving a keyboard reader parked on a stale label is how a page
   * loses someone mid-task.
   */
  function settle(message, { tone = "neutral", focus = true } = {}) {
    render();
    report(message, { tone });
    if (focus) byId("ws-next-title")?.focus();
  }

  function runExport() {
    try {
      const report = buildShiplogExport(storage, { generatedAt: now().toISOString() });
      download(report.payload);
      noteExport(storage, { now: now() });
      // A backup that quietly holds fewer links than the store is not a backup
      // the reader can check, so the same sentence the export panel uses is
      // appended here when the file had to leave one out.
      settle([OUTCOME.exported, unresolvedLinkSentence(report)].filter(Boolean).join(" "), { tone: "good" });
    } catch {
      settle(OUTCOME.export_failed, { tone: "bad" });
    }
  }

  function runErase() {
    const result = eraseWorkspace(storage, { now: now() });
    closeConfirm();
    settle(result.message, { tone: result.ok ? "good" : "bad" });
  }

  function openConfirm() {
    confirm.hidden = false;
    eraseButton.setAttribute("aria-expanded", "true");
    confirmTitle.focus();
  }

  function toggleRetention(target) {
    const result = setRetention(storage, target, { now: now() });
    settle(result.message, { tone: result.ok ? "neutral" : "bad" });
  }

  // The next-action button is a shortcut to a control that also exists in the
  // actions region below. It runs the same code path rather than a parallel one,
  // and for restore it hands focus to the file input, because a script cannot
  // open a file picker a reader did not ask for.
  function runAction(kind) {
    if (kind === "export") return runExport();
    if (kind === "erase") return openConfirm();
    if (kind === "opt-in") return toggleRetention(RETENTION.retaining);
    if (kind === "restore") return restoreInput.focus();
    // "recheck": read storage again and say so, whether or not the answer moved.
    return settle("This browser's storage was read again.", { tone: "neutral" });
  }

  async function readChosenFile(file) {
    try {
      const text = await readFile(file);
      plan = prepareShiplogImport(storage, text);
    } catch {
      plan = null;
      report(OUTCOME.restore_failed, { tone: "bad" });
      return;
    }
    if (!plan.ok) {
      const reason = plan.parsed?.error ?? "";
      plan = null;
      restorePlan.hidden = true;
      report(`${OUTCOME.restore_failed} ${reason}`.trim(), { tone: "bad" });
      return;
    }
    restorePlan.hidden = false;
    restoreHeadline.textContent = formatImportSummary(plan.merged.summary);
    restoreCommit.textContent = `Restore ${plural(plan.merged.summary.restorable, "record")}`;
    restoreCommit.disabled = plan.merged.summary.restorable === 0;
    report("This file was read in this browser. Nothing is stored until you confirm.", { tone: "neutral" });
    restoreHeadline.focus();
  }

  retentionButton.addEventListener("click", () => {
    toggleRetention(view.retention === RETENTION.declined ? RETENTION.retaining : RETENTION.declined);
  });
  exportButton.addEventListener("click", runExport);
  eraseButton.addEventListener("click", () => {
    if (confirm.hidden) openConfirm();
    else closeConfirm({ focusTrigger: true });
  });
  confirmNo.addEventListener("click", () => {
    closeConfirm({ focusTrigger: true });
    report("Erase cancelled. Nothing in this browser was changed.", { tone: "neutral" });
  });
  confirmYes.addEventListener("click", runErase);
  restoreCancel.addEventListener("click", () => {
    closeRestorePlan();
    report("Restore cancelled. Nothing in this browser was changed.", { tone: "neutral" });
    restoreInput.focus();
  });
  restoreCommit.addEventListener("click", () => {
    if (!plan) return;
    let summary;
    try {
      summary = commitShiplogImport(storage, plan);
    } catch (error) {
      closeRestorePlan();
      settle(error?.code === "retention_declined"
        ? `${OUTCOME.restore_failed} This browser is set not to keep Shiplog records.`
        : OUTCOME.restore_failed, { tone: "bad" });
      return;
    }
    closeRestorePlan();
    settle(`${OUTCOME.restored} ${plural(summary.restorable, "record")} added.`, { tone: "good" });
  });
  restoreInput.addEventListener("change", () => {
    const file = restoreInput.files?.[0];
    if (!file) return;
    return readChosenFile(file);
  });

  render();
  report(null);
  return { render, refresh: () => settle(null, { focus: false }) };
}
