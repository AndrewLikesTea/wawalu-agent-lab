// HOW CONSISTENTLY THE RELEASE LOG KEEPS ITS REASONING (#2579).
//
// One figure, over the complete loaded release log: how many releases link at
// least one decision that is ALSO in the loaded decision log, out of how many
// releases loaded. A buyer asked for a number they could quote, so the whole of
// this module is the number, the rule behind it, and who its records belong to.
//
// THE RULE IS STRICTER THAN THE HOME PAGE'S, ON PURPOSE. app.js's
// releaseCoverageLine counts a release as carrying its reasoning when it
// recorded an association at all — a dangling reference included, because "never
// recorded a decision" and "lost the decision to an import" are different
// failures and that line is about the first. This figure is about the second:
// the question is whether the rationale can still be READ, so an association
// pointing at a decision this log does not hold does not count, and neither does
// a release that linked nothing. The two lines therefore disagree on a log with
// dangling references, which is the correct outcome and is why each states its
// own rule beside itself rather than borrowing the other's sentence.
//
// FILTERS DO NOT MOVE IT. Every other count on the releases page describes what
// the filters are showing (releaseSummarySentence, the export, the follow-up).
// This one describes the whole loaded log, because a figure that changes while a
// reader types in the search box is not a figure they can quote — and the copy
// on screen says so rather than leaving a reader to discover it. The page passes
// the complete `releases` array here on every render, never the rendered
// selection, so that property is structural and not a promise.
//
// The counting, the sentences and the clipboard text are pure and exported. The
// words are the product here; the control below is only what hands them over.

import { countedRecordsNoteFor } from "./app.js";
import { indexById, resolveRelease } from "./releases.js";
import { copyText } from "./share-link.js";

/** The block's own name, in the page's h2 register. */
export const REASONING_PROOF_HEADING = "Reasoning kept with each release";

// What a release has to do to be counted, said where the number is. Both halves
// of the rule are stated, because a reader who only learns the first would read
// the remainder as "linked, but to something missing".
export const REASONING_PROOF_RULE =
  "A link pointing at a decision the decision log does not hold does not count. "
  + "Neither does a release with no linked decision.";

// What the two numbers are over. Static, because it is true on every render.
export const REASONING_PROOF_SCOPE =
  "Both numbers are over every release loaded on this page, not the filtered view: "
  + "the search and the filters below do not change them.";

// The same fact, for a reader who has the sentence and not the page.
export const REASONING_PROOF_SUMMARY_SCOPE =
  "Counted over every release loaded on the Shiplog releases page, not a filtered view.";

// The visible words on the control, which say what pressing it produces. The
// block reports two numbers and the scope sentence calls them "both numbers", so
// the control says "both numbers" too: "this count" named one figure for a
// sentence that has always carried two. The "Copy <what it is>" shape is the
// page's own (see "Copy the deployment check verdict and both versions"), and
// "as a sentence" is what tells a reader this is not another link control.
export const REASONING_PROOF_COPY_LABEL = "Copy both numbers as a sentence";

export const REASONING_PROOF_COPIED_STATUS = "Both numbers copied to clipboard.";
export const REASONING_PROOF_COPY_FAILED_STATUS =
  "Could not copy both numbers. The same sentence is above this button.";

// A log with nothing in it names nothing: "0 of 0 releases" is a fraction posing
// as a finding, and this is also what an unread log says, because a log that did
// not load has no releases to count either.
export const NO_RELEASES_TO_COUNT = "No releases are loaded here, so there are none to count.";

/**
 * The split this figure reports: `{ total, preserved, examples, added }`.
 *
 * `preserved` reads `counts.linked` off the same resolution the rows are built
 * from (resolveRelease), so the figure and a row's own breakdown cannot disagree
 * about whether a decision is in the log.
 *
 * `examples` / `added` are over the records ACTUALLY COUNTED — the whole loaded
 * log, which is what both numbers are over — and are decided by the same
 * `exampleIds` set that badges a row "Example record". Nothing here re-derives
 * provenance from the shape of an id.
 */
export function countReasoningKept(releases = [], decisions = [], exampleIds = new Set()) {
  const lookup = indexById(decisions);
  const examples = exampleIds instanceof Set ? exampleIds : new Set(exampleIds ?? []);
  let preserved = 0;
  let example = 0;
  for (const release of releases) {
    const ids = Array.isArray(release?.decisionIds) ? release.decisionIds : [];
    if (resolveRelease({ ...release, decisionIds: ids }, lookup).counts.linked > 0) preserved += 1;
    if (examples.has(release?.id)) example += 1;
  }
  return { total: releases.length, preserved, examples: example, added: releases.length - example };
}

/**
 * The figure as a sentence, with both numbers in it.
 *
 * Words, not a fraction glyph: this is the line a reader quotes, and "6/8" does
 * not say what either number is. "N of M releases" is the shape the log's own
 * count sentence already uses, so the page reads in one idiom.
 *
 * It says the decision log HOLDS the decision, which is the verb the exclusion
 * sentence under it already uses ("a decision the decision log does not hold
 * does not count"): one name for one concept, so the two sentences read as the
 * rule and its bound rather than as two rules. It stays page-neutral — no "on
 * this page" — because the homepage's evaluation summary and the clipboard both
 * quote this sentence byte for byte, and each states its own scope beside it.
 */
export function reasoningKeptSentence({ total = 0, preserved = 0 } = {}) {
  if (total === 0) return NO_RELEASES_TO_COUNT;
  return `${preserved} of ${total} ${total === 1 ? "release" : "releases"} in this release log `
    + `${preserved === 1 ? "links" : "link"} at least one decision the decision log holds.`;
}

/**
 * Whose records the figure counted, in the site's own wording.
 *
 * countedRecordsNoteFor is the home page's sentence for exactly this job —
 * "which records a counted figure counted" — imported rather than reworded so
 * the two figures name their halves identically, including at zero: "no example
 * records" is a fact a reader can act on, and dropping a half would leave them
 * unable to tell an absence from something the page declined to say.
 */
export function reasoningProvenanceNote(counts = {}) {
  return countedRecordsNoteFor(counts);
}

/**
 * The whole proof point as plain text, for the mail or ticket it gets pasted
 * into. Pure: no DOM, no clipboard, no clock.
 *
 * It carries its own scope and its own provenance, because a quoted figure
 * travels without the page around it and a reader receiving it must not have to
 * guess whether the records behind it were invented.
 */
export function reasoningProofSummary(counts = {}) {
  return [
    `Shiplog releases: ${reasoningKeptSentence(counts)}`,
    REASONING_PROOF_RULE,
    reasoningProvenanceNote(counts),
    REASONING_PROOF_SUMMARY_SCOPE,
  ].join("\n");
}

/**
 * Write the figure and its attribution into the block.
 *
 * Both nodes are written only when the words change. The claim is a live region
 * that ships empty and stays in the accessibility tree from the first paint — a
 * region inserted at the moment its text arrives is announced by nothing — and
 * a filter change moves neither number, so rewriting the same sentence on every
 * render would announce "nothing happened" to a screen reader for every keypress
 * in the search box.
 */
export function renderReleaseReasoningProof(root, counts) {
  const claim = root.querySelector("#reasoning-proof-claim");
  const provenance = root.querySelector("#reasoning-proof-provenance");
  for (const [node, text] of [
    [claim, reasoningKeptSentence(counts)],
    [provenance, reasoningProvenanceNote(counts)],
  ]) {
    if (node && node.textContent !== text) node.textContent = text;
  }
}

/**
 * Mount the block: the copy control now, the figure on every later render.
 *
 * The button ships disabled in the markup, like the log's own share controls:
 * without this module there is no sentence to hand over. It is enabled here and
 * reads the latest counts at press time, so the clipboard can never receive a
 * figure the page has since replaced.
 *
 * A document without the block gets an inert handle back, so a surface that
 * mounts the releases page without this markup is unaffected.
 */
export function initReleaseReasoningProof(root, options = {}) {
  const claim = root.querySelector("#reasoning-proof-claim");
  const button = root.querySelector("#reasoning-proof-copy");
  const status = root.querySelector("#reasoning-proof-copy-status");
  if (!claim) return { update() {} };
  let counts = countReasoningKept();
  if (button) {
    button.disabled = false;
    button.addEventListener("click", async () => {
      button.disabled = true;
      if (status) status.textContent = "";
      const copied = await copyText(options.clipboard ?? globalThis.navigator?.clipboard, reasoningProofSummary(counts));
      if (status) status.textContent = copied ? REASONING_PROOF_COPIED_STATUS : REASONING_PROOF_COPY_FAILED_STATUS;
      button.disabled = false;
    });
  }
  return {
    update(releases, decisions, exampleIds) {
      counts = countReasoningKept(releases, decisions, exampleIds);
      renderReleaseReasoningProof(root, counts);
      return counts;
    },
  };
}
