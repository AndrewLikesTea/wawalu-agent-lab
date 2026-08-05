// Which rung of the trust ladder a reader's own brief is standing on (#1104).
//
// THE QUESTION THIS ANSWERS. A reader who drops their own export gets a
// headline figure, a movement sentence, a completeness score and a cohort
// position — and no way to answer the one question a leader is asked the moment
// they quote any of it: how far will this number carry? "Complete brief, 4 of 5
// slots earned" answers how MUCH was computed. It does not answer how much the
// result can be LEANED ON, which is a different axis and the one that decides
// whether a figure belongs in a planning deck or in a billing dispute.
//
// So there is one ladder with three rungs, and a brief stands on exactly one:
//
//   1 DECLARED   the figures rest on what was stated, not on what was measured
//   2 ESTIMATED  computed from a complete billing month in the reader's export
//   3 VERIFIED   reconciled against evidence something outside this page checked
//
// NO NEW MARK, AND NO COLOUR CARRYING THE MEANING. The distinction is carried
// by a WORD and by a POSITION — "Estimated — rung 2 of 3" — because the ordinal
// is a shape-free cue that survives grayscale, a mono printer, and a reader who
// separates no hues. `evolution.css` already publishes a two-family glyph
// vocabulary (diamond = provenance, circle = status) in which every character is
// spoken for; a fourth family for a fourth axis would put a mark on this page
// that means one thing here and something else four sections down, which is the
// collapse tests/evolution-glyph-roles.test.js exists to prevent. Per-figure
// provenance is left to the marker `finops-brief-provenance.js` already owns,
// and this module adds one short text token beside it — `est.` — rather than a
// second provenance vocabulary.
//
// NO RUNG IS EVER AWARDED FOR A CLAIM THIS PAGE CANNOT CHECK. `trustAssessment`
// can return DECLARED or ESTIMATED and nothing else: reconciliation happens
// against invoices and outcomes this tab never sees, so VERIFIED is on the
// ladder as the rung the promotion step names and is never handed out by a
// derivation. An import whose figures are nonsensical — a negative recoverable
// total, or one larger than the spend it came out of — falls to DECLARED and is
// told why, rather than being quietly promoted by arithmetic nobody checked.
//
// It reads no clock, no storage and no network, and it decides nothing about
// which figures the brief prints. That belongs to the modules that own them.

import { latestCompleteMonth } from "./finops-imported-headline.js";
import { FIGURE_SOURCE, renderProvenance } from "./finops-brief-provenance.js";

/** The three rungs. There is no fourth, and none of them is a compliment. */
export const TRUST_RUNG = Object.freeze({
  declared: "declared", estimated: "estimated", verified: "verified",
});

/** Where the promotion sentence points: the evidence preflight already on the
 *  page. One path up the ladder, and this module does not restate its copy. */
export const PROMOTION_TARGET_ID = "own-data-evidence-preflight";

/**
 * The ladder, in order, low to high.
 *
 * `statement` is the literal string a reader sees and a screen reader hears —
 * the name and the ordinal together, so neither has to be inferred from the
 * other. `supports` is one plain-language line on what the rung is and is not
 * good for, because "estimated" means nothing until somebody says what an
 * estimate may be spent on.
 */
export const TRUST_LADDER = Object.freeze([
  Object.freeze({
    rung: TRUST_RUNG.declared,
    ordinal: 1,
    name: "Declared",
    token: "decl.",
    statement: "Declared — rung 1 of 3",
    supports: "Good enough to frame the question. Not good enough to size a decision:"
      + " no complete billing month in your export supported these figures, so what is on"
      + " screen rests on what was stated rather than on what was measured.",
    promotion: "Re-export a complete billing month, then check what is still missing in the"
      + " evidence preflight.",
  }),
  Object.freeze({
    rung: TRUST_RUNG.estimated,
    ordinal: 2,
    name: "Estimated",
    token: "est.",
    statement: "Estimated — rung 2 of 3",
    supports: "Good enough to size a decision and to choose where to look first. Not good"
      + " enough to settle a billing dispute: every figure is computed from your export,"
      + " not reconciled against an invoice or a realized saving.",
    promotion: "Run the evidence preflight to see what this export would still need before a"
      + " figure could be called verified.",
  }),
  Object.freeze({
    rung: TRUST_RUNG.verified,
    ordinal: 3,
    name: "Verified",
    token: "ver.",
    statement: "Verified — rung 3 of 3",
    supports: "Good enough to settle a billing dispute: every figure has been reconciled"
      + " against evidence checked outside this page.",
    promotion: "Re-run the evidence preflight after each new export, because a rung is a"
      + " statement about one file and not about a habit.",
  }),
]);

/** How many rungs the ladder has, stated once. */
export const RUNG_COUNT = TRUST_LADDER.length;

const rungNamed = (rung) => TRUST_LADDER.find((entry) => entry.rung === rung) ?? null;

const positive = (value) => Number.isFinite(value) && value > 0;

/**
 * Which rung one imported analysis earns, and what disqualified it when the
 * answer is the bottom one.
 *
 * `null` for no import at all — the ladder is a statement ABOUT a brief, so with
 * no brief on screen there is nothing for it to be about and nothing is drawn.
 *
 * @returns `{ entry, plausible, note }`, or null when nothing was imported.
 */
export function trustAssessment(analysis) {
  if (!analysis) return null;
  const month = latestCompleteMonth(analysis);
  const spend = Number(month?.spendUsd);
  const recoverable = Number(month?.recoverableUsd);
  // A figure outside what the arithmetic admits is not a smaller figure: it is a
  // reading nobody should stand on. It is named here rather than rounded away.
  const plausible = !month || (Number.isFinite(recoverable) && recoverable >= 0
    && positive(spend) && recoverable <= spend);
  const earned = Boolean(month) && plausible && positive(spend)
    && Number.isFinite(recoverable) && recoverable >= 0;
  const entry = rungNamed(earned ? TRUST_RUNG.estimated : TRUST_RUNG.declared);
  const note = plausible
    ? (month ? "" : "No month in this export is marked complete, so no period could be summed.")
    : "This export's newest complete month reports a recoverable total that is negative or"
      + " larger than the spend it came from, so it was not read as an estimate.";
  return Object.freeze({ entry, plausible, note });
}

/** The one sentence a rung change is announced with, folded into the page's
 *  existing answer announcement rather than spoken as a second utterance. */
export const trustAnnouncement = (assessment) =>
  (assessment ? `Trust ladder: ${assessment.entry.statement}` : "");

/**
 * The announcer, which speaks a rung only when the reader MOVED to it.
 *
 * WHY THIS IS STATEFUL AND THE INDICATOR IS NOT. The visible block is a fact
 * about the brief on screen, so it is repainted on every recompute and is always
 * current. The announcement is a fact about a CHANGE, and a reader who corrects
 * a department name, re-imports, and lands on the rung they were already on has
 * not changed rung — reading "Trust ladder: Estimated — rung 2 of 3" at them
 * again is a second utterance that carries no news, queued behind the sentence
 * that does. Blanking the region and writing the same string back is not a fix
 * either: an assistive technology handed a rewritten polite region speaks it,
 * which is exactly the spurious announcement this closure exists to prevent.
 *
 * So the last rung SPOKEN is held here, and an unchanged rung contributes the
 * empty string — the answer sentence is composed and announced without a trust
 * clause at all, rather than with a repeated one.
 *
 * A cleared import returns to `null`, which is the state before any brief, so
 * re-importing the same file afterwards is a move onto the ladder and is spoken.
 * One announcer per mount; it holds nothing but a rung name.
 */
export function createTrustAnnouncer() {
  let spoken = null;
  return function announceRung(assessment) {
    const rung = assessment?.entry?.rung ?? null;
    if (rung === spoken) return "";
    spoken = rung;
    return trustAnnouncement(assessment);
  };
}

const HOST_ID = "finops-trust-ladder";

function line(doc, tag, className, text) {
  const node = doc.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

/**
 * Paint the ladder into the imported brief, or take it off screen.
 *
 * OFF SCREEN MEANS GONE, NOT RESET TO RUNG 1. An unimported page and a cleared
 * import both empty this host and hide it, so the brief marks nothing and claims
 * nothing — "Declared" over no file would be a verdict about a file nobody
 * loaded, which is the one thing this indicator must never say.
 *
 * It writes no live region of its own: the stand region owns the page's single
 * announcer and the rung rides the answer's own sentence. Every class here is
 * one the brief already ships, so the ladder costs the stylesheet nothing.
 *
 * @returns the assessment it painted, or null when it took the block off screen.
 */
export function applyTrustLadder(doc, analysis) {
  const host = doc?.getElementById?.(HOST_ID) ?? null;
  const assessment = trustAssessment(analysis ?? null);
  if (!host) return assessment;
  if (!assessment) {
    host.replaceChildren();
    host.hidden = true;
    host.dataset.rung = "none";
    delete host.dataset.ordinal;
    return null;
  }
  const { entry, note } = assessment;
  host.hidden = false;
  host.dataset.rung = entry.rung;
  host.dataset.ordinal = String(entry.ordinal);
  const promotion = doc.createElement("p");
  promotion.className = "stand-imported-next";
  const link = doc.createElement("a");
  link.id = "finops-trust-ladder-promotion";
  link.href = `#${PROMOTION_TARGET_ID}`;
  link.textContent = entry.promotion;
  promotion.append(link);
  const marker = doc.createElement("p");
  marker.className = "brief-provenance-line";
  // The rung reuses the brief's own provenance marker rather than minting a
  // second one: a rung this page derived is not a figure out of the file, so it
  // takes the reader-stated silhouette and carries its short token as the
  // detail the marker already has a slot for.
  marker.append(renderProvenance(doc, FIGURE_SOURCE.reader, {
    qualifies: "Trust ladder rung",
    detail: `${entry.token} · derived on this page from your export`,
  }));
  host.replaceChildren(
    line(doc, "p", "eyebrow", "Trust ladder · your brief"),
    line(doc, "p", "stand-imported-movement", entry.statement),
    marker,
    line(doc, "p", "stand-imported-basis", note ? `${entry.supports} ${note}` : entry.supports),
    promotion,
  );
  return assessment;
}

/** Take the ladder off screen. A cleared import leaves no rung behind it. */
export const clearTrustLadder = (doc) => applyTrustLadder(doc, null);
