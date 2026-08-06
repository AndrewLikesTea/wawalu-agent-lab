// The AI FinOps answer, as plain text a lead can paste, and the copy itself.
//
// THE PROBLEM THIS SOLVES. A lead who has read "where do we stand on AI spend?"
// has somewhere to put the result — a board note, a ticket, a message to the
// team that owns the spend. Retyping a figure out of a headline is where the
// qualifier gets dropped: the number travels and "bundled synthetic example"
// stays behind. So the region offers the lines itself, and the qualifier is one
// of them rather than a checkbox beside them.
//
// FOUR RULES THIS MODULE HOLDS.
//
//   1. **The qualifying label is not optional.** It is a line of every summary
//      this module can build, composed from the SAME `headline.source` the
//      visible label and the provenance marker are painted from in the same
//      paint. There is no boolean here to fall out of step with the screen:
//      analyze an export and the copied label changes because the headline it
//      was read off changed.
//
//   2. **Nothing but what the region already renders.** Five slots of one
//      composed headline, plus the provenance sentence the marker states. No
//      row, no record, no unnamed department, no filename: this takes a
//      headline, not an analysis and not a file, so it could not reach one.
//
//   3. **A copy that did not happen never reports success.** The three rungs are
//      `coaching-summary.js`'s, shared rather than reimplemented.
//
//   4. **Nothing leaves this tab.** A clipboard write is local. This module has
//      no fetch, no storage, and no path to either.
//
// The markup is in the page, not built here, for the coaching control's reason:
// a live region that is replaced is one that may never announce.

import { COPY_METHOD, copySummaryText } from "./coaching-summary.js";
import { asOfBasis } from "./finops-screen-contract.js";
import { STAND_SAMPLE_MARKER } from "./finops-stand.js";

/** The ids this control owns. Authored in evolution.html, written only here. */
export const ANSWER_COPY_IDS = Object.freeze({
  block: "finops-copy",
  lead: "finops-copy-lead",
  button: "finops-copy-button",
  status: "finops-copy-status",
  fallback: "finops-copy-fallback",
  text: "finops-copy-text",
});

/** The control's accessible name. It says what it copies, not "Copy". */
export const ANSWER_COPY_LABEL = "Copy this answer summary";

/**
 * What the status line says before the button has been pressed: NOTHING.
 *
 * This page allows one announcer, and the reason is that nine regions once spoke
 * over each other on a single answer change. A status line seeded with "nothing
 * has been copied yet" would join them — a polite region that speaks on load and
 * again on every repaint, about a control nobody has touched. It is empty until
 * the reader presses the button, the stylesheet takes an empty one out of the
 * layout, and `tests/finops-answer-announcement.test.js` holds the page to it.
 */
export const ANSWER_COPY_IDLE = "";

/**
 * The line labels this module authors.
 *
 * The recoverable figure's own label is NOT here — it is `recoverable.label`,
 * read off the headline, because the page prints that string over the figure and
 * a second copy of it here is a second thing to keep in step.
 */
export const ANSWER_COPY_LINE = Object.freeze({
  basis: "Basis",
  action: "Do this first",
  team: "Department driving the increase",
  asOf: "As of",
});

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

const line = (label, value) => `${label}: ${value}`;

/**
 * Build the copyable summary of one composed headline.
 *
 * @param {object|null} headline from `buildStandHeadline`, `standHeadlineForImport`
 *   or `composeStandHeadline` — whichever one the region was last painted with.
 * @returns {{available: boolean, reason: string, text: string, lines: string[]}}
 *   frozen. `available` is false for any headline missing one of the four things
 *   the summary states, because a summary that silently drops a line is one a
 *   reader pastes believing it is whole.
 */
export function buildAnswerCopy(headline = null) {
  const unavailable = (reason) => Object.freeze({
    available: false, reason, text: "", lines: Object.freeze([]),
  });
  if (!headline?.question) return unavailable("not_composed");
  // The verdict that takes the figures off the screen takes them out of the
  // clipboard with them. Read from the headline on every build, never latched.
  if (headline.figuresSuppressed) return unavailable("figures_withheld");

  const { recoverable, team, action } = headline;
  if (!recoverable?.available) return unavailable("no_recoverable");
  if (!action?.available) return unavailable("no_action");
  if (!team?.available) return unavailable("no_department");

  // The same marker the region paints above every figure, keyed on the same
  // field. The word and the sentence travel with the figure so a reader meeting
  // these lines in a ticket can tell whose numbers they are.
  const marker = STAND_SAMPLE_MARKER[headline.source] ?? STAND_SAMPLE_MARKER.example;
  const lines = [
    // 1. The question this page answers, in the words its heading asks it in.
    headline.question,
    // 2. The figure, and the basis printed under it — never the bare number.
    line(recoverable.label, recoverable.value),
    line(ANSWER_COPY_LINE.basis, recoverable.basis),
    // 3. The one action the region names first.
    line(ANSWER_COPY_LINE.action, action.label),
    // 4. The department the finding attributes the increase to.
    line(ANSWER_COPY_LINE.team, team.name),
    // 5. The qualifying label, with the period it covers. Unconditional.
    line(ANSWER_COPY_LINE.asOf, asOfBasis(headline)),
    `${marker.word} — ${marker.detail}`,
  ];

  return Object.freeze({
    available: true,
    reason: "composed",
    text: lines.join("\n"),
    lines: Object.freeze(lines),
  });
}

/**
 * Paint the copy control for the headline the region was just painted with.
 *
 * Called from `applyStandHeadline`, with that paint's own headline, so the text
 * on the clipboard and the text on the screen are two readings of one object.
 *
 * @param {object} doc the document to paint into.
 * @param {object|null} headline the composed headline.
 * @returns {object|null} the summary that was painted, or null when there is
 *   nothing to summarise and the block is hidden.
 */
export function applyAnswerCopy(doc, headline = null) {
  const block = byId(doc, ANSWER_COPY_IDS.block);
  if (!block) return null;
  const summary = buildAnswerCopy(headline);
  const box = byId(doc, ANSWER_COPY_IDS.text);
  const status = byId(doc, ANSWER_COPY_IDS.status);

  // A repaint that leaves the same summary on screen leaves its outcome alone:
  // retiring "Copied." because another region repainted would read as the copy
  // having come undone. A genuinely different summary retires it, because
  // "Copied." over figures it no longer describes is the one way this control
  // can lie.
  if (!box || box.value !== summary.text) {
    if (status) {
      status.textContent = ANSWER_COPY_IDLE;
      delete status.dataset.outcome;
    }
    if (box) box.value = summary.text;
  }

  block.hidden = !summary.available;
  // The fallback is not hidden behind a failure. The text that would be copied
  // is readable and selectable on the page before anything is pressed, which is
  // what makes "the clipboard got exactly this" checkable rather than promised.
  const fallback = byId(doc, ANSWER_COPY_IDS.fallback);
  if (fallback) fallback.hidden = !summary.available;
  // Why the control is or is not on screen, in the DOM, so a state this surface
  // can reach is a state a test can name rather than infer from a hidden flag.
  block.dataset.reason = summary.reason;
  return summary.available ? summary : null;
}

/**
 * Wire the copy button, once.
 *
 * The clipboard is read at press time rather than at wiring time: a page entry
 * runs before a reader has granted anything, and the object captured at load is
 * not necessarily the one available at the press.
 *
 * @param {object} doc the document holding the control.
 * @param {{clipboard?: object}} deps injected for tests; the page passes none
 *   and the browser's own clipboard is used.
 * @returns {object|null} the button, or null when the markup is absent.
 */
export function bindAnswerCopy(doc = globalThis.document, deps = {}) {
  const button = byId(doc, ANSWER_COPY_IDS.button);
  if (!button || button.dataset.wired === "true") return button;
  button.dataset.wired = "true";

  button.addEventListener("click", async () => {
    const box = byId(doc, ANSWER_COPY_IDS.text);
    const status = byId(doc, ANSWER_COPY_IDS.status);
    // Disabled for the duration and labelled while it is: a second press
    // mid-copy would race two writes at one clipboard, and a control that goes
    // quiet without saying why reads as broken.
    button.disabled = true;
    if (status) {
      status.textContent = "Copying…";
      status.dataset.outcome = "pending";
    }

    const clipboard = "clipboard" in deps ? deps.clipboard : globalThis.navigator?.clipboard;
    const outcome = await copySummaryText(box?.value ?? "", { clipboard, doc });

    button.disabled = false;
    if (status) {
      status.textContent = outcome.message;
      status.dataset.outcome = outcome.ok ? "copied" : "manual";
    }
    if (outcome.method === COPY_METHOD.manual) {
      // Focus follows the instruction. The status line has just told the reader
      // to press Ctrl+C; the thing that copies has to be what is selected when
      // they do, and leaving focus on a button that just failed would make the
      // keystroke copy nothing.
      box?.focus?.();
      box?.select?.();
    }
  });

  return button;
}
