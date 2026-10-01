// THE FRONT DOOR'S RECORD COUNTS, AS SOMETHING A BUYER CAN PASTE (#2582).
//
// A visitor evaluating Shiplog could read every figure on the home page and
// take none of it away. The page already ships an evaluation brief, but that
// brief is FIXED EDITORIAL TEXT and says so in its own words ("no visitor
// records or form entries"); it cannot answer "how much is actually in there?"
// This block answers exactly that, from the log the page has already loaded,
// and hands it over as text.
//
// ONE FUNCTION PRODUCES THE WORDS. evaluationSummaryLines() is the whole
// deliverable: the preview on screen and the clipboard payload are both it,
// rendered two ways. A preview assembled separately from the payload is a
// preview that can lie about what was copied, which is the defect this shape
// exists to make impossible.
//
// EVERY NUMBER IS BORROWED, NONE IS RE-DERIVED. The split comes from app.js's
// countRecordProvenance — the same predicate that badges a row "Example record"
// — and the reasoning figure from release-reasoning-proof.js's
// countReasoningKept, the module the releases page already quotes. Nothing here
// counts a record itself, so this block cannot disagree with the list above it.
//
// WHAT IT IS COUNTED OVER: the whole loaded log, never the filtered view. A
// figure that moves while a reader types in the search box is not a figure they
// can paste into a review, and the copy says so rather than leaving them to
// find out. That is also why the reasoning sentence is composed from its parts
// instead of calling reasoningProofSummary(): that helper appends a scope line
// naming the RELEASES page, which would be false here.
//
// THE PINNED CAVEAT IS DELIBERATELY NOT REPEATED. "no customer or production
// data" is counted per-page by tests elsewhere, and the sentence below makes
// the same commitment in its own words ("not customer results") without
// multiplying a pinned string once per block.

import { countRecordProvenance, countedRecordsNoteFor } from "./app.js";
import {
  REASONING_PROOF_RULE, countReasoningKept, reasoningKeptSentence,
} from "./release-reasoning-proof.js";
import { copyText } from "./share-link.js";

/** The nodes this block writes, so the page and the tests share one spelling. */
export const EVALUATION_SUMMARY_IDS = Object.freeze({
  region: "evaluation-summary",
  heading: "evaluation-summary-title",
  preview: "evaluation-summary-preview",
  copy: "evaluation-summary-copy",
  status: "evaluation-summary-copy-status",
});

/** The block's own name, in the page's h2 register. */
export const EVALUATION_SUMMARY_HEADING = "Evaluation summary of the records loaded here";

// Names what pressing it produces, not the gesture. "Copy" alone left a reader
// to guess whether they were getting a link, the page, or the log itself.
export const EVALUATION_SUMMARY_COPY_LABEL = "Copy this evaluation summary for an internal review";

export const EVALUATION_SUMMARY_COPIED_STATUS = "Evaluation summary copied to clipboard.";

// A refusal names the fallback rather than only the failure: the same text is
// on screen above the button and can be selected by hand.
export const EVALUATION_SUMMARY_COPY_FAILED_STATUS =
  "Could not copy the evaluation summary. The same text is listed above this button; select it to copy it by hand.";

// The first line of the payload, so a pasted block identifies itself in a
// ticket. Deliberately not "Shiplog evaluation brief" — that is the fixed
// editorial document further up this page, and two things called the brief is
// how a reader ends up quoting the one with no figures in it.
export const EVALUATION_SUMMARY_TITLE = "Shiplog evaluation summary, counted in this browser";

// Where the figures came from, and where they did not. Both halves matter to a
// manager reading this out of context: nothing was fetched from an account, and
// nothing was narrowed by the reader's filters.
export const EVALUATION_SUMMARY_PROVENANCE =
  "Every figure above is counted from the decisions and releases loaded in this browser at the moment it "
  + "was copied. There is no hosted account behind it, and the workspace's search and filters do not change it.";

// The one claim the example records need carried with them wherever this text
// lands. "Not customer results" is the commitment; see the note at the top of
// this file for why it is not the page's other caveat sentence.
export const EVALUATION_SUMMARY_EXAMPLE_CAVEAT =
  "The example records are invented to demonstrate Shiplog and are not customer results. "
  + "Records marked as added are ones this browser holds.";

// An unreadable store has no log to count, and a count of zero is the other
// state entirely — a reader with a full log and a refused read must not be told
// they have nothing.
export const EVALUATION_SUMMARY_UNREAD =
  "The decision and release log could not be read in this browser, so there is nothing to summarise. "
  + "Use Retry above the log, then copy this summary.";

// Both logs are counted in the same shape, so a reader comparing the two lines
// is comparing like with like. Zero names itself rather than rendering
// "0 decisions loaded", which reads as a figure when it is an absence.
function loadedLine(noun, { total = 0, examples = 0, repository = 0, added = 0 } = {}) {
  if (total === 0) return `No ${noun}s are loaded here, so there are none to count.`;
  // The whole split, not two thirds of it. countedRecordsNoteFor names the
  // repository class only when the counted set contains one, so the release line
  // is unchanged; the decision line names all three and still adds up to `total`,
  // which it would not if a repository record were folded into either half.
  return `${total} ${total === 1 ? noun : `${noun}s`} loaded. ${countedRecordsNoteFor({ examples, repository, added })}`;
}

/**
 * The figures this summary reports, derived from one composition of the log.
 *
 * `records` is the composed history stream (it carries the `example` flag the
 * rows are badged from); `decisions` and `releases` are the same logs the stream
 * was composed from, which is what the reasoning figure needs to tell a link
 * that resolves from one that dangles.
 */
export function evaluationSummaryCounts({
  records = [], decisions = [], releases = [], exampleIds = new Set(), unread = false,
} = {}) {
  if (unread) return { unread: true };
  return {
    unread: false,
    decisions: countRecordProvenance(records.filter((record) => record.type === "decision")),
    releases: countRecordProvenance(records.filter((record) => record.type === "release")),
    reasoning: countReasoningKept(releases, decisions, exampleIds),
  };
}

/**
 * The summary as lines, which IS the deliverable. Pure: no DOM, no clipboard,
 * no clock, no storage.
 *
 * The preview renders one node per line and the clipboard joins them, so the
 * two can never carry different figures or a different caveat.
 */
export function evaluationSummaryLines(counts = {}) {
  if (counts.unread) return [EVALUATION_SUMMARY_TITLE, EVALUATION_SUMMARY_UNREAD];
  return [
    EVALUATION_SUMMARY_TITLE,
    loadedLine("decision", counts.decisions),
    loadedLine("release", counts.releases),
    // Byte-for-byte the releases page's sentence, prefixed rather than reworded:
    // two wordings of one figure is how the site starts telling a reader two
    // different things about the same releases.
    `Reasoning kept: ${reasoningKeptSentence(counts.reasoning)}`,
    REASONING_PROOF_RULE,
    EVALUATION_SUMMARY_PROVENANCE,
    EVALUATION_SUMMARY_EXAMPLE_CAVEAT,
  ];
}

/** The clipboard payload: the same lines, one per line. */
export function buildEvaluationSummary(counts = {}) {
  return evaluationSummaryLines(counts).join("\n");
}

/**
 * Paint the preview. One list item per line, in payload order.
 *
 * The region's aria-busy is cleared here and nowhere else: until this runs the
 * block is still holding the wait its authored markup states.
 */
export function renderEvaluationSummary(root, counts) {
  const preview = root?.querySelector?.(`#${EVALUATION_SUMMARY_IDS.preview}`);
  if (!preview) return [];
  const lines = evaluationSummaryLines(counts);
  preview.replaceChildren();
  for (const line of lines) {
    const item = preview.ownerDocument?.createElement?.("li") ?? document.createElement("li");
    item.textContent = line;
    preview.append(item);
  }
  preview.setAttribute("aria-busy", "false");
  return lines;
}

/**
 * Mount the block: enable the control now, repaint the figures on every update.
 *
 * The button ships disabled in the markup, like the log's other share controls
 * — without this module there is no summary to hand over — and it reads the
 * latest counts at press time, so the clipboard can never receive figures the
 * page has since replaced.
 *
 * It is NOT disabled while a copy is in flight: disabling a focused control
 * blurs it, and a keyboard visitor who pressed Enter would lose their place
 * mid-copy. Presses are sequenced instead, so a slow first write settling after
 * a refused second one cannot report success for a clipboard that is empty.
 *
 * A document without the block gets an inert handle back, so a surface that
 * mounts the log without this markup is unaffected.
 */
export function initEvaluationSummary(root, options = {}) {
  const preview = root?.querySelector?.(`#${EVALUATION_SUMMARY_IDS.preview}`);
  if (!preview) return { update() {} };
  const button = root.querySelector(`#${EVALUATION_SUMMARY_IDS.copy}`);
  const status = root.querySelector(`#${EVALUATION_SUMMARY_IDS.status}`);
  let counts = evaluationSummaryCounts();
  if (button) {
    button.disabled = false;
    let press = 0;
    button.addEventListener("click", async () => {
      const current = ++press;
      if (status) status.textContent = "";
      const copied = await copyText(options.clipboard ?? globalThis.navigator?.clipboard,
        buildEvaluationSummary(counts));
      if (current !== press || !status) return;
      status.textContent = copied
        ? EVALUATION_SUMMARY_COPIED_STATUS
        : EVALUATION_SUMMARY_COPY_FAILED_STATUS;
    });
  }
  return {
    update(state) {
      counts = evaluationSummaryCounts(state);
      renderEvaluationSummary(root, counts);
      return counts;
    },
  };
}
