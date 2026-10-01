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

/** The block's own name, in the page's h2 register. Names what the two numbers
 * count rather than claiming the log keeps its reasoning: the figure below is
 * how many of the loaded releases link a decision this log holds, and a reader
 * who met the claim first would read the numbers as evidence for it. */
export const REASONING_PROOF_HEADING = "Releases on this page that link a decision";

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
//
// "the browser it came from" and not "this browser" (#2682): the page's own
// wording for the scope is "loaded in this browser", which is unambiguous while
// a reader is holding the browser. Pasted into a mail by someone who was on the
// call, "this browser" is the recipient's, and the figure becomes a claim about
// their log. Naming it once, as somewhere else, is what makes the sentence safe
// to forward.
export const REASONING_PROOF_SUMMARY_SCOPE =
  "Counted over every release loaded in the browser it came from, not a filtered view.";

// WHOSE RECORDS, AS A CLAIM AND NOT A COUNT (#2682).
//
// reasoningProvenanceNote already says HOW MANY of the counted releases were
// examples. This says what an example record IS, which is the half a recipient
// who never saw the page cannot infer: a figure forwarded without it reads as a
// statement about a real team's release history. It is a property of example
// records rather than a sentence about this log, so it is true at zero examples
// too — the note above it is where the reader learns there were none.
//
// It carries the site's pinned commitment, "no customer or production data",
// verbatim; the example panel above states it in its own words about its own
// records, and tests/shiplog-proof.test.js counts that statement once above the
// recorder with this region excluded from the walk.
export const REASONING_PROOF_SUMMARY_EXAMPLES =
  "Example records counted here are invented to demonstrate Shiplog and use no customer or production data.";

// WHERE IT CAME FROM, SO THE SOURCE IS FINDABLE (#2682). A quoted figure with
// no source is a figure a recipient has to take on trust. "Releases" is the
// name the site's own navigation gives this page, so a recipient looking for it
// is looking for the word they will see; the path is relative because this
// module is pure and the site is served from more than one origin, and a
// hostname it invented would be a worse pointer than none.
export const REASONING_PROOF_SUMMARY_SOURCE =
  "Source: the Releases page of the Shiplog site, at releases.html.";

// WHAT THE TWO NUMBERS ARE, IN ONE CLAUSE (#2645).
//
// Two surfaces have to name this pair before either figure exists — this page
// and the home page's copy of the block — and a reader who met two wordings
// would be counting two things. So the clause is exported and both of them
// spend it, the way they already share the rule and the scope above. It is the
// counted sentence's own words ("link at least one decision the decision log
// holds", "loaded"), so the introduction and the figure read as one claim
// rather than as a paraphrase and its subject.
//
// It deliberately does NOT say "uncovered". The page defines that word further
// down, in #coverage-gap-definition, and a rendered-order check holds the
// definition to being the page's first use of it.
export const REASONING_PROOF_FIGURES =
  "how many of them link at least one decision the decision log holds, "
  + "out of how many were loaded";

/** The wait, as the home page's block already says it. */
export const REASONING_PROOF_COUNTING_LEAD = "Still counting the releases loaded in this browser";

// WHAT THE FIGURE'S NODE SHIPS (#2645). The releases page used to ship it empty,
// which left a reader who arrived before the log loaded with a heading, an
// exclusion rule and two numbers nobody had named. One sentence does both jobs
// here — names the pair and says it is still being counted — because this block
// has no lead paragraph of its own; the home page's copy carries a lead above
// the figure, so there the wait is only the first clause plus an ellipsis.
//
// It states no LOADING: the log's own status region below is still the page's
// one voice for that, and "counting" is what this block is waiting on.
export const REASONING_PROOF_COUNTING = `${REASONING_PROOF_COUNTING_LEAD}: ${REASONING_PROOF_FIGURES}.`;

// Why the copy control cannot be pressed yet, in the shape the home page's
// deployment check already uses for the same slot ("The copy control becomes
// available once the check answers."). It refers to the control rather than
// quoting its label, because the label naming itself twice on one page is the
// defect #2644 reported about the share control beside it. Withdrawn by
// initReleaseReasoningProof the moment the control is live, so it is never a
// sentence about something that already works.
export const REASONING_PROOF_COPY_PENDING =
  "The copy control becomes available once the figures are counted.";

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
 * The whole proof point as lines, which IS the deliverable (#2682).
 *
 * Pure: no DOM, no clipboard, no clock. The clipboard joins these lines and the
 * copy-by-hand region below the figure renders one node per line, so the text a
 * reader checked on screen and the text their colleague receives cannot differ
 * in a figure, a word or a space. A region assembled separately from the
 * payload is a region that can lie about what was copied.
 *
 * EVERY NUMBER HERE IS ALREADY ON THE PAGE. The two figures come from
 * reasoningKeptSentence — the sentence in #reasoning-proof-claim — and the
 * split from reasoningProvenanceNote, which is #reasoning-proof-provenance.
 * Nothing is derived: no percentage, no ratio, no "x out of y as a share",
 * because a figure that appears only in the clipboard is a figure nobody could
 * check against the page it claims to come from.
 *
 * WHAT MAKES IT STAND ALONE, in the order a recipient needs it: the figures,
 * the rule they were counted under, which of the counted records were invented,
 * what an invented record is, what the count was taken over, and where to find
 * the source. The first three were already here; #2682 added the last three,
 * because the sentence was being forwarded to people who had never seen the
 * page and read as a claim about a real team's releases.
 */
export function reasoningProofSummaryLines(counts = {}) {
  return [
    `Shiplog releases: ${reasoningKeptSentence(counts)}`,
    REASONING_PROOF_RULE,
    reasoningProvenanceNote(counts),
    REASONING_PROOF_SUMMARY_EXAMPLES,
    REASONING_PROOF_SUMMARY_SCOPE,
    REASONING_PROOF_SUMMARY_SOURCE,
  ];
}

/** The clipboard payload: the same lines, one per line. */
export function reasoningProofSummary(counts = {}) {
  return reasoningProofSummaryLines(counts).join("\n");
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
  renderReasoningProofSentence(root, counts);
}

/**
 * Paint the copy-by-hand region: one node per payload line, in payload order.
 *
 * REVEALED HERE AND NOWHERE ELSE (#2682). The region ships `hidden` and empty,
 * because the only thing it could say before the counts exist is a sentence with
 * placeholder figures in it — and the block already has one voice for the wait
 * (#reasoning-proof-claim) and one for why the control cannot be pressed yet
 * (#reasoning-proof-copy-availability). A third would say it a third way.
 *
 * NOT A LIVE REGION, deliberately, and this is the one place the block departs
 * from "announce what changes". #reasoning-proof-claim is already a polite live
 * region carrying the first of these lines verbatim, so announcing this one too
 * would read the same two figures to a screen reader twice per count — once
 * bare, once inside six lines of provenance. `aria-busy` carries the wait
 * instead, which is how index.html's evaluation-summary preview — the same
 * component, a payload previewed beside its copy control — already does it.
 *
 * Repainted only when a line actually changed: a filter keypress moves neither
 * figure, and rebuilding the list under the reader's selection on every
 * keystroke would drop a hand-selected sentence mid-drag.
 */
export function renderReasoningProofSentence(root, counts) {
  const list = root.querySelector("#reasoning-proof-sentence");
  if (!list) return [];
  const lines = reasoningProofSummaryLines(counts);
  const painted = Array.from(list.querySelectorAll("li")).map((item) => item.textContent);
  if (painted.length !== lines.length || lines.some((line, index) => painted[index] !== line)) {
    list.replaceChildren();
    for (const line of lines) {
      const item = list.ownerDocument.createElement("li");
      item.className = "shiplog-proof-note";
      item.textContent = line;
      list.append(item);
    }
  }
  list.setAttribute("aria-busy", "false");
  const region = root.querySelector("#reasoning-proof-copyable");
  if (region) region.hidden = false;
  return lines;
}

/**
 * Mount the block: the copy control now, the figure on every later render.
 *
 * The button ships disabled in the markup, like the log's own share controls:
 * without this module there is no sentence to hand over. It is enabled here and
 * reads the latest counts at press time, so the clipboard can never receive a
 * figure the page has since replaced.
 *
 * The authored line saying why it cannot be pressed yet is withdrawn in the same
 * breath as the control is enabled, so the page never carries a sentence about a
 * control that already works.
 *
 * A document without the block gets an inert handle back, so a surface that
 * mounts the releases page without this markup is unaffected.
 */
export function initReleaseReasoningProof(root, options = {}) {
  const claim = root.querySelector("#reasoning-proof-claim");
  const button = root.querySelector("#reasoning-proof-copy");
  const status = root.querySelector("#reasoning-proof-copy-status");
  const availability = root.querySelector("#reasoning-proof-copy-availability");
  if (!claim) return { update() {} };
  let counts = countReasoningKept();
  if (button) {
    button.disabled = false;
    if (availability) availability.textContent = "";
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
