// "Send this to a colleague" — the link, and the control that copies it.
//
// THE PROBLEM THIS SOLVES. A lead who has analyzed their own export sends the
// URL. The colleague opens it in a browser that has retained nothing, the
// executive briefing falls back to the published synthetic sample, and they read
// an invented company's spend under the sender's sentence about ours. So this
// control copies a link with the sender's own retained periods in its fragment,
// and `executive-briefing-source.js` resolves that fragment ahead of both the
// recipient's workspace and the sample.
//
// FIVE RULES THIS MODULE HOLDS.
//
//   1. **Nothing beyond the retained-period allowlist travels.** The projection,
//      the ceiling and every refusal live in `finops-shared-briefing-link.js`;
//      this module chooses no field and validates nothing itself.
//
//   2. **The store is read, never written.** `readWorkspacePeriods` is the same
//      total reader the executive briefing uses. Pressing this button changes no
//      record and stamps no "shared at".
//
//   3. **Nothing to share means no control.** With no retained period there is
//      no link to copy, and a disabled button beside a bundled example would
//      offer to share an invented company. The block is `hidden` and carries
//      `data-reason` saying which named refusal put it there — the same
//      hidden-with-a-reason shape the answer-summary control beside it uses.
//
//   4. **The announcement is a paragraph in the open.** Never inside a
//      disclosure: the test harness reads through a shut `details` and a real
//      browser does not, so an announcement folded into one passes its test and
//      is silent for the reader it was written for. It ships EMPTY and stays
//      empty until the button is pressed, because this page allows one voice per
//      change and a status seeded on load joins the queue.
//
//   5. **A copy that did not happen never reports success.** The link is
//      readable and selectable in the box before anything is pressed, and a
//      refused clipboard focuses and selects it with the keystroke to use.
//
// The markup is authored in evolution.html rather than built here, for the same
// reason as the control beside it: a live region that is replaced is a live
// region assistive technology stops watching.

import { COPY_METHOD, copySummaryText } from "./coaching-summary.js";
import { readWorkspacePeriods } from "./executive-briefing-source.js";
import { sharedBriefingHref } from "./finops-shared-briefing-link.js";
// Whether the link about to be copied reproduces this brief on the other side
// (#1210). Checked at paint, beside the control, because a lead who has already
// pressed the button has already sent it.
import { checkSharedBriefingParity } from "./finops-share-parity.js";

/** The ids this control owns. Authored in evolution.html, written only here. */
export const SHARE_LINK_IDS = Object.freeze({
  block: "finops-share",
  lead: "finops-share-lead",
  // The standing egress caution (#1209): authored visible in the page and never
  // written from here. It is a fact about what sending costs, not a status, so
  // no paint may empty it, and it hides only with the block that owns it.
  egress: "finops-share-egress",
  button: "finops-share-button",
  parity: "finops-share-parity",
  status: "finops-share-status",
  fallback: "finops-share-fallback",
  text: "finops-share-text",
});

/** The control's accessible name. It says what it copies, not "Copy". */
export const SHARE_LINK_LABEL = "Copy shareable link to your own figures";

/** Empty until the reader presses. See rule 4 above. */
export const SHARE_LINK_IDLE = "";

/** Where a shared link lands: the printable briefing, not this page. */
export const SHARE_LINK_PATH = "/executive-briefing.html";

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

/**
 * Build the link for the periods this browser has retained.
 *
 * @param storage this browser's `localStorage`, or a stand-in.
 * @param origin the origin to build the absolute URL against.
 * @returns the codec's own frozen result, with `url` set and `ok` telling the
 *   caller whether there is anything to offer. A workspace that cannot be read
 *   is reported through the codec's `empty` reason rather than a second
 *   vocabulary of absences: from this control's side, "your browser refused its
 *   own storage" and "you have not analyzed anything" produce the same offer,
 *   which is none, and the page states the difference elsewhere.
 */
export function shareableBriefingLink(storage, origin) {
  const read = readWorkspacePeriods(storage);
  const base = (() => {
    try {
      return new URL(SHARE_LINK_PATH, origin).href;
    } catch {
      return "";
    }
  })();
  if (base === "") return sharedBriefingHref("", []);
  return sharedBriefingHref(base, read.code === null ? read.periods : []);
}

/**
 * The periods the link would carry, read the way the link itself reads them.
 *
 * The raw retained list, not the projected subset: the parity check compares
 * what the sender holds against what a recipient decodes, and handing it the
 * already-projected records would compare a copy with itself.
 */
function sharedPeriods(storage) {
  const read = readWorkspacePeriods(storage);
  return read.code === null ? read.periods : [];
}

/**
 * Paint the control for what this browser currently holds.
 *
 * @returns the link result that was painted; `ok` is false when the block is
 *   hidden because there is nothing of the reader's own to share.
 */
export function applyShareLink(doc, storage, { origin = globalThis.location?.origin } = {}) {
  const block = byId(doc, SHARE_LINK_IDS.block);
  if (!block) return null;
  const link = shareableBriefingLink(storage, origin);
  const box = byId(doc, SHARE_LINK_IDS.text);
  const status = byId(doc, SHARE_LINK_IDS.status);

  // A repaint that leaves the same link on screen leaves its outcome alone.
  // "Copied." over a link that no longer points at the same months is the one
  // way this control can lie, so a genuinely different link retires it.
  if (!box || box.value !== link.url) {
    if (status) {
      status.textContent = SHARE_LINK_IDLE;
      delete status.dataset.outcome;
    }
    if (box) box.value = link.url;
  }

  // The parity verdict, painted in the open beside the control rather than
  // logged: it is the one sentence that says whether the thing this button
  // copies reproduces the sender's figure, destination and grade. With nothing
  // to share there is no link to check, so the line is emptied rather than left
  // claiming a match for a link that no longer exists.
  const parityNode = byId(doc, SHARE_LINK_IDS.parity);
  if (parityNode) {
    const parity = link.ok ? checkSharedBriefingParity(sharedPeriods(storage)) : null;
    const sentence = parity ? parity.statement : "";
    if (parityNode.textContent !== sentence) parityNode.textContent = sentence;
    if (parity) parityNode.dataset.parity = parity.reason;
    else delete parityNode.dataset.parity;
  }

  block.hidden = !link.ok;
  const fallback = byId(doc, SHARE_LINK_IDS.fallback);
  if (fallback) fallback.hidden = !link.ok;
  // Why the control is or is not on screen, in the DOM, so a state this surface
  // can reach is a state a test can name rather than infer from a hidden flag.
  block.dataset.reason = link.reason;
  return link;
}

/**
 * Wire the copy button, once.
 *
 * The clipboard is read at press time rather than at wiring time: a page entry
 * runs before a reader has granted anything.
 */
export function bindShareLink(doc = globalThis.document, deps = {}) {
  const button = byId(doc, SHARE_LINK_IDS.button);
  if (!button || button.dataset.wired === "true") return button;
  button.dataset.wired = "true";

  button.addEventListener("click", async () => {
    const box = byId(doc, SHARE_LINK_IDS.text);
    const status = byId(doc, SHARE_LINK_IDS.status);
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
      // Focus follows the instruction: the status line has just told the reader
      // to press Ctrl+C, so the link has to be what is selected when they do.
      box?.focus?.();
      box?.select?.();
    }
  });

  return button;
}
