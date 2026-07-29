// The personal AI-history workflow's page entry: the whole of the wiring.
//
// It is a script of its own rather than another branch of evolution-page.js
// because it shares nothing with the organizational import. Nothing here reads a
// workspace, a seed, a retained period, or an org roster; nothing here writes
// one. A file chosen on this page never reaches the conversation-export reader
// and never becomes part of anybody's team grade.
//
// NO NETWORK, NO CREDENTIAL, AND ONE KEY. The chosen file is read through the
// browser's own `Blob.text()` — the local API that turns a file the reader
// already has into a string in this tab — handed to a pure function, and dropped.
// There is no fetch, no upload, no URL parameter, and no sign-in:
// `PERSONAL_HISTORY_EXCLUSIONS` states each of those refusals and
// tests/personal-history-flow.test.js asserts them against this module's own
// imports and against a harness whose `fetch` throws on any request at all.
//
// The one exception is the slot a reading is carried forward in, and this file
// does not reach for it: `personal-history-carry-forward.js` is the only module
// in the workflow that names a storage API, it writes one declared key, and what
// goes in that key is fourteen scalars derived from a report — never the file,
// never a prompt, never a date. The same test asserts both halves.
//
// ONE RUN AT A TIME, AND THE PAGE ONLY EVER SHOWS THAT ONE
// -------------------------------------------------------
// Three things can be outstanding at once: a file read, the worked example, and
// a reader who has pressed Clear. Each of those is a start, each takes a token
// from `createRunLedger`, and **every async completion re-checks that it still
// holds the current token before it touches the DOM**. The checks are placed on
// both sides of every await, so:
//
//   * Clear during a read empties the page and the read cannot repaint it —
//     Clear takes a token nobody holds, so the read finds itself stale;
//   * a second start supersedes the first, and the first cannot overwrite the
//     second's result even if it settles later;
//   * the worked example and a file read cannot overwrite each other in either
//     direction, whichever finishes first;
//   * a stale run cannot re-enable a control, cannot announce, and cannot clear
//     the busy state on a run that is still going.
//
// The start controls are disabled while a run is in flight as well, so the race
// is not usually reachable by hand. The token is what makes it unreachable at
// all: a disabled attribute is a UI convenience, and the guard is the invariant.

import { PERSONAL_REPORT_STATE } from "/personal-history-contract.js";
import { buildPersonalHistoryReport } from "/personal-history-report.js";
import {
  CARRY_FORWARD_ORIGIN, browserCarryForwardStorage, carryForward, clearCarriedSummary,
} from "/personal-history-carry-forward.js";
import { personalHistoryPreviewFiles } from "/personal-history-fixture.js";
import {
  PERSONAL_ENTRY_REFUSAL, PERSONAL_FILE_ACCEPT, PERSONAL_RUN_KIND,
  createRunLedger, personalFileEligibility,
} from "/personal-history-entry.js";
import {
  BOUNDARY_CONTAINER_ID, ELIGIBILITY_CONTAINER_ID, RESULT_ID, STATUS_ID,
  renderBoundaryGuidance, renderEligibilityGuide, renderEntryError, renderIdle,
  renderProgress, renderReport, wireDisclosures,
} from "/personal-history-view.js";

export const FILE_INPUT_ID = "personal-history-file";
export const PREVIEW_ID = "personal-history-preview";
export const CLEAR_ID = "personal-history-clear";

/**
 * Give the browser one turn to paint the stage that was just written before the
 * synchronous grade begins.
 *
 * Reading and grading are pure and fast, but they are not free on a two-thousand
 * prompt export, and a progress state that is written and overwritten inside one
 * task is a progress state no reader ever sees. This is the only timer in the
 * workflow and it carries no threshold: nothing waits on it, and nothing is
 * decided by how long it takes.
 */
const yieldToPaint = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * @param {Document} doc the document to wire.
 * @param {{storage?: object|null}} options the slot one reading is carried
 *   forward in. Injected rather than reached for so a test can hand in a fake
 *   one, and defaulted through the carry-forward module rather than through
 *   `localStorage` here, so this file names no storage API — see
 *   `browserCarryForwardStorage`.
 */
export function initPersonalHistory(doc = globalThis.document, { storage = browserCarryForwardStorage() } = {}) {
  // The standing copy is painted first and independently of the controls: a
  // reader deciding whether to hand over their own history reads what this does
  // with a file, and which files it can read, before anything is chosen — and
  // still reads the shorter static version of both if this script never runs.
  doc?.getElementById?.(BOUNDARY_CONTAINER_ID)?.replaceChildren(renderBoundaryGuidance());
  doc?.getElementById?.(ELIGIBILITY_CONTAINER_ID)?.replaceChildren(renderEligibilityGuide());

  const result = doc?.getElementById?.(RESULT_ID);
  if (!result) return null;
  const status = doc.getElementById(STATUS_ID);
  const fileInput = doc.getElementById(FILE_INPUT_ID);
  const previewButton = doc.getElementById(PREVIEW_ID);
  const clearButton = doc.getElementById(CLEAR_ID);

  // The picker's filter comes from the shapes the reader actually accepts, so
  // the two cannot drift. It is a hint to the file dialog and never a check:
  // `personalFileEligibility` decides, and the bytes decide after that.
  fileInput?.setAttribute("accept", PERSONAL_FILE_ACCEPT);

  const ledger = createRunLedger();

  const announce = (sentence) => { if (status) status.textContent = sentence; };

  const paint = (node) => {
    result.replaceChildren(node);
    return node;
  };

  /**
   * Whether a start is available. Clear is never disabled: it is the way out of
   * a run that is taking too long, and disabling the escape hatch during the one
   * state a reader wants it in is how a page becomes a trap.
   */
  const setRunning = (running) => {
    result.setAttribute("aria-busy", running ? "true" : "false");
    if (fileInput) fileInput.disabled = running;
    if (previewButton) previewButton.disabled = running;
  };

  /**
   * The last gate. Nothing in this module writes to the document after an await
   * without going through here or through an explicit `isCurrent` check first.
   */
  const settle = (token, node, sentence) => {
    if (!ledger.isCurrent(token)) return null;
    ledger.finish(token);
    const painted = paint(node);
    announce(sentence);
    setRunning(false);
    return painted;
  };

  /**
   * One run: read something into a string, grade it, draw it. `load` is what
   * differs between a chosen file and the worked example — everything after it
   * is the same code on the same contract, which is the point of the example.
   */
  async function run(kind, load) {
    const token = ledger.start(kind);
    setRunning(true);
    paint(renderProgress({ kind, stage: "read" }));
    announce(kind === PERSONAL_RUN_KIND.preview
      ? "Building the worked example in this tab."
      : "Reading your export in this tab. Nothing is being uploaded.");

    let text = null;
    try {
      text = await load();
    } catch (error) {
      // A read that failed is still only allowed to speak if it is the current
      // run: a reader who pressed Clear is owed the empty page they asked for,
      // not somebody else's error.
      return settle(token, renderEntryError({
        code: PERSONAL_ENTRY_REFUSAL.readFailed,
        summary: "Your file could not be read in this tab",
        detail: `The browser stopped part-way through reading the file (${error?.message ?? "no reason given"}). `
          + "Nothing was read out of it, so no figure was drawn from a partial read.",
        remedy: "Choose the file again. If it keeps failing, the file may be open in another "
          + "program or may have moved since you picked it.",
      }), "Your file could not be read. Nothing was uploaded.");
    }
    if (!ledger.isCurrent(token)) return null;

    paint(renderProgress({ kind, stage: "grade" }));
    await yieldToPaint();
    if (!ledger.isCurrent(token)) return null;

    // The one place the file's text exists. It is an argument to a pure
    // function, and the report that comes back carries counts and move
    // identifiers in its place — never an echo of what was read.
    const report = buildPersonalHistoryReport(text);
    text = null;
    if (!ledger.isCurrent(token)) return null;

    // The comparison and the write happen together, in one call, against the one
    // slot. The reading is the product and this is a line beside it: every
    // storage fault comes back as a state on the comparison, so a browser that
    // refuses storage costs the reader that line and nothing else.
    //
    // The worked example does not reach this at all — it neither reads the slot
    // nor writes it. `carryForwardSummary` refuses that origin as well, so the
    // invented person cannot be carried forward by way of some later caller
    // either; this branch is what keeps them from so much as looking.
    const comparison = kind === PERSONAL_RUN_KIND.preview ? null
      : carryForward(report, storage, { origin: CARRY_FORWARD_ORIGIN.ownExport }).comparison;

    const article = settle(token, renderReport(report, { kind, comparison }), summarize(report, kind));
    if (article) wireDisclosures(article, doc);
    return article ? report : null;
  }

  fileInput?.addEventListener("change", () => {
    const file = fileInput.files?.[0] ?? null;
    // A picker closed without a selection changes nothing: whatever is on the
    // page — a result, a refusal, or a run in flight — is left alone.
    if (!file) return;

    const eligibility = personalFileEligibility(file);
    if (!eligibility.eligible) {
      // A refusal is a start too. It invalidates anything still in flight, so a
      // read the reader has already moved on from cannot paint over the reason
      // their next file was refused.
      ledger.invalidate();
      setRunning(false);
      paint(renderEntryError(eligibility));
      announce(`${eligibility.summary}. The file was not opened.`);
      return;
    }
    void run(PERSONAL_RUN_KIND.file, () => file.text());
  });

  // The zero-input path: a reader who has not exported anything yet — or who
  // wants to see what this makes of a history before handing over their own —
  // gets a complete result from the bundled synthetic export. It runs through
  // exactly the same reader, and the result says on its face that it is not
  // theirs.
  previewButton?.addEventListener("click", () => {
    void run(PERSONAL_RUN_KIND.preview, async () => personalHistoryPreviewFiles()[0].text);
  });

  // Clear is the cancel. It takes a token nobody holds, so every completion
  // still in flight is stale by the time it asks — which is what makes "clear"
  // mean cleared rather than "cleared until that read finishes".
  // Clear is also the way out of the one thing this browser keeps. A reader who
  // presses it on a shared machine means "leave nothing behind", and a control
  // that emptied the page while a summary of their history sat in storage would
  // be answering a different question than the one they asked.
  clearButton?.addEventListener("click", () => {
    ledger.invalidate();
    setRunning(false);
    const cleared = clearCarriedSummary(storage);
    paint(renderIdle());
    announce(cleared.cleared
      ? "Cleared. Nothing has been read, any reading still in progress was discarded, and "
        + "the summary carried forward from your last reading was deleted."
      : "Cleared. Nothing has been read and any reading still in progress was discarded. "
        + "This browser would not let the page delete the summary carried forward from your last "
        + "reading; clear this site's browser storage before leaving a shared device.");
    if (fileInput) fileInput.value = "";
    fileInput?.focus?.();
  });

  setRunning(false);
  return { ledger, result };
}

/** The one sentence the live region gets when a run lands. */
function summarize(report, kind) {
  const whose = kind === PERSONAL_RUN_KIND.preview ? "The worked example" : "Your export";
  if (report.state === PERSONAL_REPORT_STATE.prioritized) {
    return `${whose} was read in this tab. One move is prioritized: ${report.priority.title} `
      + `(${report.confidence.label.toLowerCase()}).`;
  }
  if (report.state === PERSONAL_REPORT_STATE.noMoveAvailable) {
    return `${whose} was read in this tab and the rubric found no move worth points. Nothing is prioritized.`;
  }
  return `${whose} was read in this tab and no move could be named: ${report.reasonRule}`;
}

initPersonalHistory();
