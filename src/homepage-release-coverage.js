// THE RELEASES PAGE'S TWO COVERAGE FIGURES, ON THE FRONT DOOR (#2605).
//
// A buyer reading the home page met the worked decision-to-release example and
// the deployment check, and then had to take the site's word for how typical
// that example was. The releases page already answers that in two numbers — how
// many releases link a decision the log still holds, out of how many were
// loaded — but a visitor who never leaves the front door never sees them.
//
// NOTHING HERE COUNTS ANYTHING. The split comes from countReasoningKept in
// release-reasoning-proof.js, which is the function the releases page renders
// from, and the sentence from reasoningKeptSentence, which is the string that
// page paints byte for byte. So the two pages cannot report different numbers
// for one browser, and cannot word one number two ways: there is one counter
// and one sentence, called twice. The evaluation summary further down this page
// quotes the same pair for the same reason.
//
// WHAT IT IS COUNTED OVER: every release the page loaded, never the filtered
// view. app.js calls update() from refresh() — the one place the data changes —
// and not from render(), which is where the filters reach, so the scope
// sentence beside the figures is structural rather than a promise. It is
// REASONING_PROOF_SCOPE verbatim: it says "the search and the filters below",
// and on this page as on that one the filters are below this block.
//
// THREE STATES, AND NONE OF THEM IS A BARE ZERO:
//
//   • still counting — what the document ships, because a figure in the served
//     bytes is a figure nobody counted. It is the sentence the deployment check
//     beside it ships ("Checking the running build now…") in the same register,
//     not an em dash, an empty node, or a "0".
//   • counted — the releases page's sentence, plus whose records it counted.
//   • unread — the log refused the read. countReasoningKept over an empty log
//     would say "No releases are loaded here, so there are none to count",
//     which is a statement about the log and is FALSE here: the log may be full
//     and unreachable. This block says which of the two happened and defers to
//     the recovery the page already owns, the history's own Retry.
//
// NO CONTROL, BY CONSTRAINT AND ON PURPOSE. The figures are static text: this
// section's eight tab stops are pinned by homepage-log-leads.test.js, and the
// sentence is already copyable from the evaluation summary below, which carries
// it with its own scope attached. Every class here already ships, so the block
// costs nothing in styles.css, which is at its measured size budget.

import { HISTORY_UNREAD_ANNOUNCEMENT } from "./app.js";
import {
  REASONING_PROOF_HEADING,
  REASONING_PROOF_RULE,
  REASONING_PROOF_SCOPE,
  countReasoningKept,
  reasoningKeptSentence,
  reasoningProvenanceNote,
} from "./release-reasoning-proof.js";

// The nodes this block writes, so the page and the tests share one spelling.
//
// `reasoning-kept-` and NOT `release-coverage-`: this page already carries a
// node called `release-coverage`, the line above the record list that reports
// the same subject over the FILTERED view. app.js resolves it by
// `querySelector("#release-coverage")`, which matches in document order, so a
// block named that above the list would have been found first and overwritten
// with the filtered sentence. The two figures answer different questions and
// keep different names.
export const RELEASE_COVERAGE_IDS = Object.freeze({
  region: "reasoning-kept",
  heading: "reasoning-kept-title",
  lead: "reasoning-kept-lead",
  claim: "reasoning-kept-claim",
  provenance: "reasoning-kept-provenance",
  rule: "reasoning-kept-rule",
  scope: "reasoning-kept-scope",
});

/** The same name the block carries on Releases, one heading level down. */
export const RELEASE_COVERAGE_HEADING = REASONING_PROOF_HEADING;

// What the two numbers are, said before either of them arrives.
//
// The one sentence on this block that the releases page does not already
// publish, and it is here because the figure is written by script: a reader
// waiting on the count would otherwise have a heading, a wait, and a rule about
// a number nobody had named yet. It borrows the claim sentence's own words for
// both halves — "link at least one decision the decision log holds", "loaded" —
// so it introduces the sentence below rather than paraphrasing it into a second
// version of the same claim. The deployment check above states its comparison
// the same way, in the same place, for the same reason.
export const RELEASE_COVERAGE_LEAD =
  "Two numbers, counted from the releases loaded in this browser: how many of them "
  + "link at least one decision the decision log holds, out of how many were loaded.";

// The caveats, from the releases page's own constants. Authored into the
// document rather than written here: both are true before any module runs.
export const RELEASE_COVERAGE_RULE = REASONING_PROOF_RULE;
export const RELEASE_COVERAGE_SCOPE = REASONING_PROOF_SCOPE;

// What the document ships in the figure's place. It says the counting is still
// happening, which is the one thing that is true of a page whose script has not
// run, and it is a sentence rather than a placeholder glyph so a screen reader
// reaching it early is told something.
export const RELEASE_COVERAGE_COUNTING = "Still counting the releases loaded in this browser…";

/**
 * A refused read is not an empty log. The first sentence says which of the two
 * this is; the second is the history's own recovery, borrowed rather than
 * reworded because the control that performs it is the one further down this
 * page and the site must not name it two ways.
 *
 * A function and not a constant: app.js imports this module and this module
 * imports app.js, so a top-level read of that constant is a read of a binding
 * still in its temporal dead zone. Composed at render time, which is long after
 * both modules have finished evaluating.
 */
export function releaseCoverageUnread() {
  return "The release log could not be read in this browser, so neither number could be counted. "
    + HISTORY_UNREAD_ANNOUNCEMENT;
}

/**
 * The two lines this block paints: `{ claim, provenance }`.
 *
 * Pure, and the whole deliverable — no DOM, no clock, no storage. `unread` is
 * checked before anything is counted, because the composed log under a refused
 * read is empty and an empty log has its own true sentence that would be false
 * here.
 */
export function releaseCoverageLines({
  releases = [], decisions = [], exampleIds = new Set(), unread = false,
} = {}) {
  if (unread) return { claim: releaseCoverageUnread(), provenance: "" };
  const counts = countReasoningKept(releases, decisions, exampleIds);
  return { claim: reasoningKeptSentence(counts), provenance: reasoningProvenanceNote(counts) };
}

/**
 * Write the figures into the block, if the surface carries it.
 *
 * Both nodes are written only when the words change. The claim is a live region
 * from the first paint, and a repaint that moved no number — a recomposition
 * after a filter-only change, say — must not announce "nothing happened" to a
 * screen reader. A document without the block is left alone, so every other
 * surface app.js boots is unaffected.
 */
export function renderReleaseCoverage(root, state) {
  const claim = root?.querySelector?.(`#${RELEASE_COVERAGE_IDS.claim}`);
  if (!claim) return null;
  const lines = releaseCoverageLines(state);
  const provenance = root.querySelector(`#${RELEASE_COVERAGE_IDS.provenance}`);
  if (claim.textContent !== lines.claim) claim.textContent = lines.claim;
  if (provenance && provenance.textContent !== lines.provenance) {
    provenance.textContent = lines.provenance;
  }
  return lines;
}
