// The copy control for a compared revision.
//
// WHY THE MARKUP IS IN THE PAGE AND NOT BUILT HERE. Everything else on this
// surface is built with createElement on every paint, and the change region is
// replaced wholesale each time a disclosure toggles. A live region that is
// replaced is a live region that may never announce: assistive technology
// watches a node, and a fresh node with text already in it is not a change to
// anything it was watching. The status line here has to announce the difference
// between "on your clipboard" and "not on your clipboard", so it is a permanent
// node in evolution.html that this module writes into — never one it creates.
//
// The same reasoning puts the summary text in a permanent `readonly` textarea:
// it is the fallback a reader selects from when copying is unavailable, and it
// doubles as the single place the current summary lives. There is no copy of
// the summary in a closure, a dataset, or a module variable — the box the reader
// can see is the box the button reads, so the two can never disagree.
//
// NOTHING PERSISTS. The textarea is a DOM node in this tab. It is cleared when
// the panel clears, it is never read back into any model, and its contents
// contain no pasted text (see `coaching-summary.js`).

import { COPY_METHOD, buildCoachingSummary, copySummaryText } from "./coaching-summary.js";

const COPY_ID = "prompt-coaching-copy";
const BUTTON_ID = "prompt-coaching-copy-button";
const STATUS_ID = "prompt-coaching-copy-status";
const FALLBACK_ID = "prompt-coaching-copy-fallback";
const TEXT_ID = "prompt-coaching-copy-text";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

export const COPY_LABEL = "Copy this coaching summary";

/** What the status line says before the button has been pressed. */
export const COPY_IDLE = "Nothing has been copied yet.";

/**
 * Paint the copy control for the current change.
 *
 * @param {object} doc the document to paint into.
 * @param {{change?: object|null, result?: object|null}} pair the change model
 *   from `buildRevisionChange` and the result from `gradeMyPrompt`.
 * @returns {object|null} the summary that was painted, or null when there is
 *   nothing to summarise and the block is hidden.
 */
export function applyCoachingSummary(doc, { change = null, result = null } = {}) {
  const block = byId(doc, COPY_ID);
  if (!block) return null;
  const summary = buildCoachingSummary({ change, result });
  const box = byId(doc, TEXT_ID);
  const status = byId(doc, STATUS_ID);
  const fallback = byId(doc, FALLBACK_ID);

  // The change region is repainted whenever a disclosure toggles, and this runs
  // with it. Retiring a copy outcome the reader can still see, because they
  // opened a panel, would read as the copy having come undone — so the outcome
  // survives every repaint that leaves the same summary on screen, and only a
  // genuinely different summary clears it.
  const changed = !box || box.value !== summary.text;
  if (changed) {
    // A new comparison retires the last one's outcome. Leaving "Copied." above a
    // different set of figures is the one way this control can lie.
    if (fallback) fallback.hidden = true;
    if (status) {
      status.textContent = summary.available ? COPY_IDLE : "";
      delete status.dataset.outcome;
    }
    if (box) box.value = summary.text;
  }

  block.hidden = !summary.available;
  // Why the control is or is not on screen, in the DOM, so a state this surface
  // can reach is a state a test can name rather than infer from a hidden flag.
  block.dataset.reason = summary.available ? "compared" : summary.reason;
  return summary.available ? summary : null;
}

/**
 * Wire the copy button, once.
 *
 * The dependencies are read at click time rather than at wiring time, because a
 * page entry runs before a reader has granted anything: a clipboard object
 * captured at load is not necessarily the one available at the press.
 *
 * @param {object} doc the document holding the control.
 * @param {{clipboard?: object}} deps injected for tests; the page passes none
 *   and the browser's own clipboard is used.
 * @returns {object|null} the button, or null when the markup is absent.
 */
export function initCoachingSummaryCopy(doc = globalThis.document, deps = {}) {
  const button = byId(doc, BUTTON_ID);
  if (!button || button.dataset.wired === "true") return button;
  button.dataset.wired = "true";

  button.addEventListener("click", async () => {
    const box = byId(doc, TEXT_ID);
    const status = byId(doc, STATUS_ID);
    const fallback = byId(doc, FALLBACK_ID);
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
    if (!fallback) return;
    fallback.hidden = outcome.ok;
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
