// The observatory's counted figure, as plain text a salesperson can paste.
//
// THE PROBLEM THIS SOLVES. The merged-pull-request count is the one number on
// this site that nobody invented, which makes it the one number worth forwarding
// — and retyping it into an email is where everything around it gets dropped.
// What travels is "42"; what stays behind is what the 42 counts, which
// repositories it was counted in, whether it is this minute's answer or the last
// one this browser took, and where the reader can go and look. So the block
// offers the whole of that itself.
//
// FOUR RULES THIS MODULE HOLDS.
//
//   1. **The figure is read, never written.** `buildMergedCountCopy` takes the
//      resolved state and the count that state was painted from, so the string
//      on the clipboard and the digit on the screen are two readings of one
//      render. There is no literal number anywhere in this file.
//
//   2. **Nothing copyable may assert a figure the page does not show.** The
//      `loading` and `unavailable` states have no number, so they have no
//      summary and the control is taken off the page — hidden, the way
//      `finops-answer-copy.js` hides its block, rather than left pressable over
//      an absence.
//
//   3. **Freshness travels with the figure.** A live count says when it was
//      counted; a retained one says in words that it is a previous count and
//      when that count was taken. Both timestamps are the ones the block is
//      already rendering, formatted with the shared ISO/UTC formatters so a
//      recipient in another locale reads the same instant the sender did.
//
//   4. **Plain text, and only claims the page makes.** No markup, no rate, no
//      trend, no per-day figure, no rounding. The lines are the count and its
//      unit, the sentence the block already prints about what these merges did,
//      the freshness clause, and the page's own absolute address.
//
// Nothing leaves this tab: a clipboard write is local, and this module has no
// fetch, no storage, and no path to either.
import { SOURCE_REPOSITORIES, mergedCountUnit } from "./public-merges.js";
import { formatRetainedClock, formatRetainedDate } from "./merged-count-retention.js";

/** The ids this control owns. Authored in agents.html, written only here. */
export const MERGED_COPY_IDS = Object.freeze({
  block: "merged-figure-copy",
  button: "merged-figure-copy-button",
  status: "merged-figure-copy-status",
});

/** The control's accessible name. It says what it copies, not "Copy". */
export const MERGED_COPY_LABEL = "Copy this count and its sources";

/**
 * The outcome the status line reports. Idle is empty for the observatory's own
 * reason: the block already owns one polite region that speaks on load, and a
 * second line seeded with prose would announce a control nobody has touched.
 */
export const MERGED_COPY_FEEDBACK = Object.freeze({
  copied: "Count copied.",
  failed: "Could not copy the count. Select the text above and copy it manually.",
});

/** The path of the page this count is published on. */
export const OBSERVATORY_PATH = "/agents.html";

/** The origin the absolute address falls back to when a page has none. */
export const OBSERVATORY_ORIGIN = "https://labs.wawalu.org";

/**
 * The absolute address of the observatory, so a pasted count is checkable from
 * a mail client that has no idea what "/agents.html" is relative to.
 */
export function observatoryUrl(origin = globalThis.window?.location?.origin ?? globalThis.location?.origin) {
  try {
    return new URL(OBSERVATORY_PATH, origin || OBSERVATORY_ORIGIN).href;
  } catch {
    return new URL(OBSERVATORY_PATH, OBSERVATORY_ORIGIN).href;
  }
}

/**
 * What the merges are, in the words the block already prints under the figure.
 *
 * Composed from the same `SOURCE_REPOSITORIES` the page names, rather than
 * retyped: a repository that changed there changes here, and a case in
 * tests/agent-observatory-merged-copy.test.js holds this string against the
 * sentence agents.html actually renders, so the two cannot drift apart.
 */
export const MERGED_COPY_MEANING = `${SOURCE_REPOSITORIES.join(" and ")} hold the merged pull `
  + "requests that built and changed the pages of this site.";

/** The instant a count was taken, spelled the way the block spells it. */
const stamp = (date) => `${formatRetainedDate(date)} at ${formatRetainedClock(date)}`;

const usable = (date) => date instanceof Date && !Number.isNaN(date.getTime());

/**
 * Build the copyable summary of one painted figure.
 *
 * @param {string} state the resolved state name `renderMergedFigure` painted:
 *   only `live` and `recorded` carry a figure at all.
 * @param {{count?: number, asOf?: Date|null, takenAt?: Date|null}} figure the
 *   same values that paint was given.
 * @returns {{available: boolean, reason: string, text: string, lines: string[]}}
 *   frozen. `available` is false whenever there is no dated count, because a
 *   summary with a gap where the figure goes is one a reader pastes believing it
 *   is whole.
 */
export function buildMergedCountCopy(state = "loading", { count = 0, asOf = null, takenAt = null } = {}) {
  const unavailable = (reason) => Object.freeze({
    available: false, reason, text: "", lines: Object.freeze([]),
  });
  const whole = Number.isInteger(count) && count >= 0;
  // The same admission rule the render is held to, read from the same values: a
  // count with no instant behind it is one this control may not offer either.
  const at = state === "live" ? asOf : state === "recorded" ? takenAt : null;
  if (state !== "live" && state !== "recorded") return unavailable(state === "loading" ? "loading" : "no_count");
  if (!whole || !usable(at)) return unavailable("no_count");

  const lines = [
    // 1. The figure, with the words the block puts beside the digit.
    `${count} ${mergedCountUnit(count)}`,
    // 2. What those merges are, and in which repositories.
    MERGED_COPY_MEANING,
    // 3. Whether this is the response's own count or the last one taken here.
    state === "live"
      ? `Counted from public GitHub activity on ${stamp(at)}.`
      : `Public GitHub activity did not answer just now, so this is a previous count, taken on ${stamp(at)}.`,
    // 4. Where the count is published, absolutely, so it can be opened.
    `Agent observatory: ${observatoryUrl()}`,
  ];

  return Object.freeze({
    available: true,
    reason: state,
    text: lines.join("\n"),
    lines: Object.freeze(lines),
  });
}

/**
 * Show or hide the control for the figure that was just painted.
 *
 * Called from `renderMergedFigure` with that paint's own state and values, so
 * the control cannot survive the figure it describes. The summary is kept on the
 * block rather than in a closure: the press reads it back, which is what makes
 * "the clipboard got exactly what the page showed" a property of one object.
 */
export function applyMergedCountCopy(root = document, state = "loading", figure = {}) {
  const block = root?.querySelector?.(`#${MERGED_COPY_IDS.block}`);
  if (!block) return null;
  const summary = buildMergedCountCopy(state, figure);
  const status = root.querySelector(`#${MERGED_COPY_IDS.status}`);
  // A repaint that changes the payload retires the previous outcome: "Copied."
  // sitting over a count it no longer describes is the one way this can lie.
  if (block.dataset.payload !== summary.text && status) status.textContent = "";
  block.dataset.payload = summary.text;
  // Why the control is or is not on screen, in the DOM, so a state this surface
  // can reach is a state a test can name rather than infer from a hidden flag.
  block.dataset.reason = summary.reason;
  block.hidden = !summary.available;
  return summary.available ? summary : null;
}

/**
 * Wire the copy button, once.
 *
 * The clipboard is read at press time rather than at wiring time: a page entry
 * runs before a reader has granted anything, and the object captured at load is
 * not necessarily the one available at the press.
 */
export function bindMergedCountCopy(root = document, clipboard) {
  const button = root?.querySelector?.(`#${MERGED_COPY_IDS.button}`);
  if (!button || button.dataset.wired === "true") return null;
  button.dataset.wired = "true";

  button.addEventListener("click", async () => {
    const block = root.querySelector(`#${MERGED_COPY_IDS.block}`);
    const status = root.querySelector(`#${MERGED_COPY_IDS.status}`);
    const payload = block?.dataset.payload ?? "";
    const writer = clipboard ?? globalThis.navigator?.clipboard;
    try {
      // A control with nothing to offer never reports a copy it did not make.
      if (!payload) throw new Error("No count to copy");
      if (typeof writer?.writeText !== "function") throw new Error("Clipboard unavailable");
      await writer.writeText(payload);
      if (status) status.textContent = MERGED_COPY_FEEDBACK.copied;
    } catch {
      if (status) status.textContent = MERGED_COPY_FEEDBACK.failed;
    }
  });
  return button;
}
