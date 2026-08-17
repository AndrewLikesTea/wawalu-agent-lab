// The observatory's counted figure, as plain text somebody can paste elsewhere.
//
// This is the one number on the site nobody invented, and until now it could
// only be read where it is rendered: forwarded by hand it arrived as a bare
// digit, without the repositories it was counted in, without the moment it was
// taken, and without the address of the page it can be checked on. This module
// writes that whole claim as one plain-text string.
//
// IT IS BUILT FROM WHAT WAS RENDERED, NOT FROM WORDS BESIDE IT. The caller hands
// over the same count and the same timestamp the readout was painted from, so a
// figure that changes on the page changes in the clipboard with it, and there is
// no literal here that could go on being copied after the page stopped saying
// it.
//
// IT MAY ASSERT NOTHING THE PAGE DOES NOT SHOW. A count, when it was counted,
// what was counted, where, and where to go and check it — no rate, no trend, no
// per-day figure, and no percentage. An undated or half-written figure is not
// copyable at all, for the reason it is not renderable: the block refuses to
// show a number it cannot date, so the clipboard refuses the same number.
import { SOURCE_REPOSITORIES, mergedCountUnit } from "./public-merges.js";
import { formatRetainedClock, formatRetainedDate } from "./merged-count-retention.js";

/** Where the block lives, for a reader who now holds only the pasted text. */
export const OBSERVATORY_PATH = "/agents.html";
const SITE_ORIGIN = "https://labs.wawalu.org";

/**
 * The absolute address of the observatory, taken from where the page is
 * actually being served so a preview build does not paste a production link,
 * and falling back to the canonical origin when there is no location to read.
 */
export function observatoryUrl(origin = globalThis.location?.origin) {
  try {
    return new URL(OBSERVATORY_PATH, origin || SITE_ORIGIN).href;
  } catch {
    return `${SITE_ORIGIN}${OBSERVATORY_PATH}`;
  }
}

/**
 * What the control says about itself, before and after it is pressed.
 *
 * `nothing` is the reason as well as the refusal: it is true while the page is
 * still waiting and true once a request has failed with no count ever taken in
 * this browser, which are the two states in which the control is offered but
 * genuinely has nothing to hand over.
 */
export const MERGED_COUNT_COPY = Object.freeze({
  label: "Copy this count and its sources",
  copied: "Count, sources, and the time it was counted copied.",
  failed: "Could not copy the count. Select the figure above and copy it manually.",
  nothing: "There is no counted figure on this page yet, so there is nothing to copy.",
});

// Why the number is worth forwarding at all, in the words the block already uses
// beside it. It carries no digit, so it reads the same whatever the count is.
const SITE_SENTENCE = "These merged pull requests built and changed the pages of this site.";

/**
 * The figure as plain text, or `null` when there is no figure to state.
 *
 * `live` says when the count was taken; `recorded` says the same and says first
 * that it is an earlier count and that public GitHub activity did not answer —
 * the distinction the page makes in words, made in the clipboard too, so a
 * pasted number cannot be read as current when the page did not call it that.
 * Anything else is not a figure: no state of its own, no count, or no timestamp
 * all return null, and a null is a control with nothing to offer.
 */
export function buildMergedCountCopy(figure, url = observatoryUrl()) {
  const state = figure?.state;
  const count = figure?.count;
  const takenAt = figure?.takenAt;
  if (state !== "live" && state !== "recorded") return null;
  if (!Number.isInteger(count) || count < 0) return null;
  if (!(takenAt instanceof Date) || Number.isNaN(takenAt.getTime())) return null;

  // The same ISO date and UTC clock the recorded figure prints, so what a reader
  // pastes and what the page shows cannot be two different-looking stamps.
  const stamp = `${formatRetainedDate(takenAt)} at ${formatRetainedClock(takenAt)}`;
  const opening = state === "live"
    ? `${count} ${mergedCountUnit(count)}, counted on ${stamp}.`
    : `${count} ${mergedCountUnit(count)}. This is a previous count, taken on ${stamp}; `
      + "public GitHub activity did not answer just now.";
  return [
    opening,
    SITE_SENTENCE,
    `Counted from public GitHub activity in ${SOURCE_REPOSITORIES.join(" and ")}.`,
    `Counted on the Agent observatory: ${url}`,
  ].join(" ");
}
