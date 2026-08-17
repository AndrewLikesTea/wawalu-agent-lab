// The counted figure, as plain text somebody can paste somewhere else.
//
// THE PROBLEM THIS SOLVES. The observatory's one real number is the thing a
// reader is most likely to want to quote — in a note, a ticket, a reply to
// "how much has this actually shipped?" — and retyping it is where everything
// that makes it checkable falls off. The digit travels; when it was counted,
// what it is a count of, and the two feeds anyone can open and count for
// themselves stay behind. So the block offers the whole of it, in one payload.
//
// FOUR RULES THIS MODULE HOLDS.
//
//   1. **One number, not two.** The text is composed in the same paint that
//      renders the figure, from the values that paint was given — never a
//      constant, never a second request, never a digit read back off the DOM.
//      `applyMergedCountCopy` is called from `renderMergedFigure`, so a state
//      the readout can reach and a payload the button holds cannot fall out of
//      step with each other. Change the render and the clipboard changes with
//      it, or the render does not compile.
//
//   2. **A payload is never undated, and never claims to be live.** The two
//      states that carry a digit carry different sentences: a live count says
//      it was counted from public GitHub activity and when, and a retained one
//      says in words that it is a previous count, in the same clause the block
//      itself prints. There is no third shape and no bare number.
//
//   3. **No count, nothing to copy.** A browser that has never held a count and
//      a request public GitHub has not answered leave the control disabled with
//      the reason on screen beside it — not enabled over an empty string, and
//      not hidden with no explanation. The served page ships in exactly that
//      state, so a slow response cannot flash a copyable figure.
//
//   4. **It asserts nothing the page does not.** Every sentence here is either
//      the block's own wording or built from the shared merge-count module: no
//      rate, no trend, no per-day figure, no percentage, no markup. Plain text,
//      and only text a reader can check against what is on screen.
//
// Nothing leaves this tab. A clipboard write is local; this module has no
// fetch, no storage, and no path to either.
import { EVENTS_URLS, SOURCE_REPOSITORIES, feedLinkText, mergedCountUnit } from "./public-merges.js";
import { RETAINED_LEAD, formatRetainedClock, formatRetainedDate } from "./merged-count-retention.js";

/** The ids this control owns. Authored in agents.html, written only here. */
export const MERGED_COPY_IDS = Object.freeze({
  block: "merged-figure-copy",
  button: "merged-figure-copy-button",
  reason: "merged-figure-copy-reason",
  status: "merged-figure-copy-status",
});

/** The control's visible name. It says what it copies, not "Copy". */
export const MERGED_COPY_LABEL = "Copy this count and its sources";

/**
 * What the reader is told after pressing, and only after pressing.
 *
 * The failure line points at the page rather than at a hidden box: everything
 * the payload would have carried is readable in this block already, which is
 * what makes a refused clipboard a nuisance rather than a dead end.
 */
export const MERGED_COPY_FEEDBACK = Object.freeze({
  copied: "Copied the count, when it was counted, and the feeds it was counted from.",
  failed: "Could not copy the count. The count, the time it was counted, and the feeds it was counted "
    + "from are all readable above.",
});

/** Why there is nothing to copy, in the state where there is nothing to copy. */
export const MERGED_COPY_NO_COUNT = "There is no count to copy yet. This turns on as soon as public GitHub "
  + "answers, or as soon as this browser has taken a count of its own.";

/**
 * What the counted merges are, in the block's own words.
 *
 * Byte-identical to the first sentence of #merged-figure-note in agents.html,
 * and held there by a case in tests/agent-observatory-merged-copy.test.js: the
 * payload may repeat what the page says, and may not say something else.
 */
export const MERGED_COPY_NOTE = `${SOURCE_REPOSITORIES.join(" and ")} hold the merged pull requests `
  + "that built and changed the pages of this site.";

/** Where the figure is published, so a pasted payload can be walked back to it. */
export const OBSERVATORY_PATH = "/agents.html";
/** The origin this site is served from, for a paste taken outside a browser. */
export const PUBLISHED_ORIGIN = "https://labs.wawalu.org";

/**
 * The observatory's absolute URL.
 *
 * Absolute or nothing: a pasted "/agents.html" resolves against wherever it
 * lands, which is not where this figure lives. The reader's own origin wins
 * when there is one — a preview deployment should point at itself — and the
 * published origin is the fallback for a caller with no location at all.
 */
export function observatoryUrl(origin = globalThis.location?.origin) {
  try {
    return new URL(OBSERVATORY_PATH, origin || PUBLISHED_ORIGIN).href;
  } catch {
    return new URL(OBSERVATORY_PATH, PUBLISHED_ORIGIN).href;
  }
}

/** The moment a count was taken, in the strings the block already prints. */
const stamp = (date) => `${formatRetainedDate(date)} at ${formatRetainedClock(date)}`;

/**
 * Build the payload for one paint of the figure.
 *
 * @param {string} state the resolved render state — "live", "recorded",
 *   "loading" or "unavailable". It is the renderer's own resolved name, not a
 *   request outcome, so the payload is keyed on what is actually on screen.
 * @param {{count?: number, asOf?: Date, takenAt?: Date}} values the values that
 *   paint was made from.
 * @param {string} [origin] the origin to resolve the observatory URL against.
 * @returns {{available: boolean, reason: string, text: string, lines: string[]}}
 *   frozen. `available` is false whenever the figure carries no dated whole
 *   count, because the one thing this control may never do is offer to copy a
 *   number the page did not render.
 */
export function buildMergedCountCopy(state, { count, asOf = null, takenAt = null } = {}, origin) {
  const whole = Number.isInteger(count) && count >= 0;
  // The live state is dated by its response, the retained one by the moment it
  // was taken. Any other state has no date, and therefore no payload.
  const at = state === "live" ? asOf : state === "recorded" ? takenAt : null;
  const dated = at instanceof Date && !Number.isNaN(at.getTime());
  if (!whole || !dated) {
    return Object.freeze({
      available: false,
      reason: whole ? "undated" : "no_count",
      text: "",
      lines: Object.freeze([]),
    });
  }

  // The freshness sentence is the page's, both times. The live one is the
  // clause the home page's block prints under the same figure; the retained one
  // is the shared lead the observatory prints, with the fact that it is not a
  // live count said in front of it, because a payload read on its own has no
  // block around it to infer that from.
  const freshness = state === "live"
    ? `Counted from public GitHub activity in ${SOURCE_REPOSITORIES.join(" and ")}, as of ${stamp(at)}.`
    : `This is a previous count, not a live one. ${RETAINED_LEAD}${stamp(at)}.`;
  const lines = [
    // The figure exactly as the readout renders it: the digit and its unit.
    `${count} ${mergedCountUnit(count)}`,
    MERGED_COPY_NOTE,
    freshness,
    // The proof, one feed per line, each named the way the links beside it are
    // named — so a reader who pastes this can go and count it themselves.
    ...EVENTS_URLS.map((url, index) => `${feedLinkText(SOURCE_REPOSITORIES[index])}: ${url}`),
    `Counted on the Agent observatory: ${observatoryUrl(origin)}`,
  ];
  return Object.freeze({
    available: true,
    reason: state,
    text: lines.join("\n"),
    lines: Object.freeze(lines),
  });
}

const byId = (root, id) => (root?.querySelector ? root.querySelector(`#${id}`) : null);

/**
 * Paint the control for the figure that was just painted.
 *
 * Called from `renderMergedFigure` with that paint's own state and values, so
 * the text on the clipboard and the digit on the screen are two readings of one
 * set of numbers. Returns null when the markup is absent, which is every root
 * that is not the observatory page.
 *
 * @param {object} root the document or root the figure was painted into.
 * @param {string} state the resolved render state.
 * @param {object} values the values that paint was made from.
 * @param {string} [origin] the origin to resolve the observatory URL against.
 * @returns {object|null} the payload that was painted.
 */
export function applyMergedCountCopy(root, state, values = {}, origin) {
  const button = byId(root, MERGED_COPY_IDS.button);
  const block = byId(root, MERGED_COPY_IDS.block);
  if (!button || !block) return null;
  const summary = buildMergedCountCopy(state, values, origin);
  const status = byId(root, MERGED_COPY_IDS.status);
  const reason = byId(root, MERGED_COPY_IDS.reason);

  // A payload that changed retires the outcome of the last copy: "Copied." left
  // standing over a count it no longer describes is the one way this control
  // can lie. A repaint that lands on the same payload leaves it alone, because
  // withdrawing it because the page repainted reads as the copy coming undone.
  if (button.dataset.copyText !== summary.text) {
    button.dataset.copyText = summary.text;
    if (status) {
      status.textContent = "";
      delete status.dataset.outcome;
    }
  }
  // Why the control is or is not offered, in the DOM, so every state this
  // surface can reach is one a test can name rather than infer.
  block.dataset.state = summary.available ? "ready" : summary.reason;
  button.disabled = !summary.available;
  if (reason) {
    reason.textContent = summary.available ? "" : MERGED_COPY_NO_COUNT;
    reason.hidden = summary.available;
  }
  return summary;
}

/**
 * Wire the copy button, once.
 *
 * The payload is read off the button at press time rather than captured at
 * wiring time: the figure repaints on every load and every refresh, and the
 * count in the reader's hand has to be the one on their screen.
 *
 * @param {object} doc the document holding the control.
 * @param {object} [clipboard] injected for tests; the page passes none.
 * @returns {object|null} the button, or null when the markup is absent.
 */
export function bindMergedCountCopy(doc = globalThis.document, clipboard = globalThis.navigator?.clipboard) {
  const button = byId(doc, MERGED_COPY_IDS.button);
  const status = byId(doc, MERGED_COPY_IDS.status);
  if (!button || !status || button.dataset.wired === "true") return null;
  button.dataset.wired = "true";

  button.addEventListener("click", async () => {
    const text = button.dataset.copyText ?? "";
    try {
      // An empty payload is the never-counted state arriving here anyway. It
      // reports the failure rather than writing an empty clipboard over
      // whatever the reader had in it.
      if (!text) throw new Error("No count to copy");
      if (typeof clipboard?.writeText !== "function") throw new Error("Clipboard unavailable");
      await clipboard.writeText(text);
      status.textContent = MERGED_COPY_FEEDBACK.copied;
      status.dataset.outcome = "copied";
    } catch {
      status.textContent = MERGED_COPY_FEEDBACK.failed;
      status.dataset.outcome = "manual";
    }
  });
  return button;
}
