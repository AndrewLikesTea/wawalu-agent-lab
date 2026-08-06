// The control that hands this answer to someone else, and the bad-link notice.
//
// This is `finops-answer-copy.js`'s sibling and deliberately its twin: the same
// three rungs of clipboard fallback, the same idle-empty status line, the same
// "the exact text this copies" box that is readable before anything is pressed.
// A second copy pattern on one page would be a second thing for a reader to
// learn for no gain, so nothing here is invented that that module already
// decided.
//
// WHAT IS DIFFERENT, AND WHY.
//
//   1. IT COPIES A LINK, NOT PROSE. The link is built by
//      `finops-share-codec.js` from the SAME bounded answer the region was
//      painted from, so a lead cannot send a link to figures other than the
//      ones they are looking at.
//
//   2. IT OFFERS NOTHING WHEN THERE IS NOTHING TO SHARE. The block is hidden,
//      with the reason in `data-reason`, exactly as the copy control is. A
//      disabled button beside an empty box would be a control that says "you
//      may share this" about an answer that has no figure in it.
//
//   3. IT ALSO PAINTS THE FAILURE. A reader who followed a link that did not
//      open must be told which of the named reasons it was — not shown the
//      bundled company as though they had arrived at this page cold.

import { COPY_METHOD, copySummaryText } from "./coaching-summary.js";
import { SHARE_REASON, buildShareLink } from "./finops-share-codec.js";

/** The ids this control owns. Authored in evolution.html, written only here. */
export const ANSWER_SHARE_IDS = Object.freeze({
  block: "finops-share",
  lead: "finops-share-lead",
  button: "finops-share-button",
  status: "finops-share-status",
  text: "finops-share-text",
  notice: "finops-share-notice",
});

/** The control's accessible name. It says what the link opens, not "Share". */
export const ANSWER_SHARE_LABEL = "Copy shareable link to this answer";

/** Empty until pressed, on this page's one-announcer rule. See the copy control. */
export const ANSWER_SHARE_IDLE = "";

/** Why the block is not on screen, in the DOM, one code per reachable state. */
export const ANSWER_SHARE_REASON = Object.freeze({
  shareable: "shareable",
  noAnswer: "no_answer",
  noFigure: "no_figure",
});

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

/**
 * The link for one bounded answer, and why there is none when there is none.
 *
 * @param answer the projection `answer-state.js` holds.
 * @param location read for origin and path only — never for its query string.
 * @returns `{ shareable, reason, link }`, frozen.
 */
export function buildAnswerShare(answer = null, location = globalThis.location) {
  if (!answer) {
    return Object.freeze({ shareable: false, reason: ANSWER_SHARE_REASON.noAnswer, link: "" });
  }
  const link = buildShareLink(answer, location);
  if (!link) {
    return Object.freeze({ shareable: false, reason: ANSWER_SHARE_REASON.noFigure, link: "" });
  }
  return Object.freeze({ shareable: true, reason: ANSWER_SHARE_REASON.shareable, link });
}

/**
 * Paint the control for the answer the region was just painted with.
 *
 * @returns the share that was painted, or null when there is nothing to share
 *   and the block is hidden.
 */
export function applyAnswerShare(doc, answer = null, location = globalThis.location) {
  const block = byId(doc, ANSWER_SHARE_IDS.block);
  if (!block) return null;
  const share = buildAnswerShare(answer, location);
  const box = byId(doc, ANSWER_SHARE_IDS.text);
  const status = byId(doc, ANSWER_SHARE_IDS.status);

  // A repaint that produces the same link leaves "Copied." standing; a link to
  // different figures retires it, because that is the one way this control
  // could tell a reader they had copied something they had not.
  if (!box || box.value !== share.link) {
    if (status) {
      status.textContent = ANSWER_SHARE_IDLE;
      delete status.dataset.outcome;
    }
    if (box) box.value = share.link;
  }
  block.hidden = !share.shareable;
  block.dataset.reason = share.reason;
  return share.shareable ? share : null;
}

/**
 * Say that a link did not open, and which named reason it was.
 *
 * Visible text in the page, not an announcement: this is painted at load, where
 * this page allows one announcer, and a reader who has just followed a link is
 * looking at the region it was supposed to open.
 *
 * @param result a `decodeShareToken` result.
 * @returns the notice element, or null when the markup is absent.
 */
export function applyShareNotice(doc, result = null) {
  const notice = byId(doc, ANSWER_SHARE_IDS.notice);
  if (!notice) return null;
  const failed = Boolean(result) && result.ok === false && result.reason !== SHARE_REASON.absent;
  notice.textContent = failed ? result.message : "";
  notice.dataset.reason = failed ? result.reason : "none";
  notice.hidden = !failed;
  return notice;
}

/**
 * Wire the button, once. The clipboard is read at press time, not at wiring.
 *
 * @param doc the document holding the control.
 * @param deps injected for tests; the page passes none.
 * @returns the button, or null when the markup is absent.
 */
export function bindAnswerShare(doc = globalThis.document, deps = {}) {
  const button = byId(doc, ANSWER_SHARE_IDS.button);
  if (!button || button.dataset.wired === "true") return button;
  button.dataset.wired = "true";

  button.addEventListener("click", async () => {
    const box = byId(doc, ANSWER_SHARE_IDS.text);
    const status = byId(doc, ANSWER_SHARE_IDS.status);
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
      // Focus follows the instruction: the status line has just said to press
      // Ctrl+C, so the box holding the link is what must be selected.
      box?.focus?.();
      box?.select?.();
    }
  });

  return button;
}
