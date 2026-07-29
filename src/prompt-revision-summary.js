// The words for a revision comparison, and the one thing a reader takes out of
// the tab: a short coaching summary on the clipboard.
//
// Kept apart from the surface for two reasons. The first is testability — the
// exact sentence that lands in someone's message thread is asserted as a string
// rather than scraped out of a DOM. The second matters more: **the clipboard is
// the only egress this workflow has**, so the function that decides what may
// leave is small enough to read in one sitting.
//
// WHAT MAY LEAVE, STATED AS A RULE. Every line below is built from
// `prompt-revision-comparison/1.0.0` fields only. That envelope is structurally
// incapable of holding prompt text — it consumes two coaching sessions, and a
// session carries measurements of the analyzed text and never the text — so
// "the summary cannot contain what you pasted" is a consequence of the input
// type rather than a discipline maintained here. The two-marker test in
// tests/prompt-revision-summary.test.js asserts it anyway, because a guarantee
// worth stating is worth failing a build over.
//
// NOT A SHARE FEATURE. There is no network call, no upload, and no link. The
// reader pastes it somewhere themselves, which is the only "sharing" this
// product's boundary permits.

/** Direction word and shape. Never colour alone, on any surface that uses these. */
export const DIRECTION_COPY = Object.freeze({
  improved: Object.freeze({ word: "Improved", shape: "▲" }),
  unchanged: Object.freeze({ word: "Unchanged", shape: "■" }),
  regressed: Object.freeze({ word: "Regressed", shape: "▼" }),
});

/**
 * The four `remainingWeakness.status` values in the reader's words.
 *
 * This is a *status*, not an action — it answers "am I fixing what I was told
 * to fix?", which a score delta does not. The action is `nextAction`, and it is
 * the only thing on the surface phrased as an instruction.
 */
export const REMAINING_STATUS_COPY = Object.freeze({
  unaddressed: Object.freeze({
    label: "Same first move",
    text: "The coach is still naming the change it named on the baseline.",
  }),
  advanced: Object.freeze({
    label: "A different first move",
    text: "The change you were told to make is no longer the top-ranked one.",
  }),
  emerged: Object.freeze({
    label: "A first move appeared",
    text: "The baseline had nothing ranked worth points; the revision does.",
  }),
  none: Object.freeze({
    label: "Nothing ranked",
    text: "The rubric has no higher-priority weakness left to name.",
  }),
});

/** What the copy control says after it ran. Three outcomes, three sentences. */
export const COPY_FEEDBACK = Object.freeze({
  copied: "Coaching summary copied to your clipboard.",
  failed: "Could not copy. Open “What gets copied” below and copy the text yourself.",
  unavailable: "This browser did not offer a clipboard. Open “What gets copied” below and copy the text yourself.",
});

export const COPY_OUTCOME = Object.freeze({
  copied: "copied", failed: "failed", unavailable: "unavailable",
});

/** The line that travels with the numbers, so a pasted figure carries its own limits. */
export const SUMMARY_BOUNDARY_LINE = "Graded in the browser from one prompt in one tab. "
  + "No prompt text was sent, stored, or included above, and this is not an organization's grade.";

const bandPhrase = ({ from, to, bandDelta }) => {
  if (bandDelta === 0) return `${from} → ${to}, still the same band`;
  const steps = Math.abs(bandDelta);
  return `${from} → ${to}, ${bandDelta > 0 ? "up" : "down"} ${steps} band${steps === 1 ? "" : "s"}`;
};

/**
 * The concise coaching summary, as plain text.
 *
 * Deliberately plain rather than Markdown or JSON: it is pasted into a message
 * to a colleague, and a reader who wanted the envelope has the envelope.
 *
 * @param {object} comparison from `buildRevisionComparison`.
 * @returns {string} newline-separated lines, no trailing newline.
 */
export function revisionCopySummary(comparison) {
  if (!comparison || typeof comparison !== "object" || typeof comparison.compared !== "boolean") {
    throw new TypeError("prompt revision summary: needs a comparison from buildRevisionComparison");
  }
  const { headline, grade, remainingWeakness, nextAction } = comparison.comparison;
  const lines = [`Prompt coaching — ${comparison.question}`];

  if (!comparison.compared) {
    // An abstention is a result, and it is the one most worth pasting to a
    // colleague: it says the two runs were not comparable and why, in a code.
    lines.push(
      `Not compared — ${comparison.reason}.`,
      `${nextAction.title} ${nextAction.guidance}`,
    );
  } else {
    const remaining = REMAINING_STATUS_COPY[remainingWeakness.status];
    lines.push(
      `${DIRECTION_COPY[headline.direction].word}. ${headline.text}`,
      `Letter grade ${bandPhrase(grade)}.`,
      `Still first: ${remaining.label} — ${remaining.text}`,
    );
    if (remainingWeakness.signalId) {
      lines.push(`Signal: ${remainingWeakness.signalId} (${remainingWeakness.axis} axis).`);
    }
    lines.push(`Do this next: ${nextAction.title} ${nextAction.guidance}`);
    // The rubric identifier travels with the number for the same reason the
    // per-turn reason codes are printed rather than translated: a figure a
    // colleague can dispute has to name what produced it.
    lines.push(`Rubric ${comparison.revision.result.rubricVersionId}.`);
  }

  lines.push(SUMMARY_BOUNDARY_LINE);
  return lines.join("\n");
}

/**
 * Put the summary on the clipboard, and say which of three things happened.
 *
 * A boolean would collapse "your browser has no clipboard API" into "the copy
 * failed", and those need different recovery sentences: one is permanent for
 * that browser, the other is worth trying again.
 *
 * @returns {Promise<"copied"|"failed"|"unavailable">}
 */
export async function copyRevisionSummary(clipboard, text) {
  if (typeof clipboard?.writeText !== "function") return COPY_OUTCOME.unavailable;
  if (typeof text !== "string" || text === "") return COPY_OUTCOME.failed;
  try {
    await clipboard.writeText(text);
    return COPY_OUTCOME.copied;
  } catch {
    // A denied permission, a document that is not focused, a browser that
    // refuses outside a user gesture: all of them land here, and all of them
    // have the same recovery — the text is on the page, copy it by hand.
    return COPY_OUTCOME.failed;
  }
}
