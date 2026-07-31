// The measured-agreement claim, painted from a scorer run.
//
// Every figure this module writes comes out of `scoreAgreementCorpus`. Nothing
// here is authored: there is no fallback number, no rounded-up headline, and no
// "about three quarters" to fall back on when the corpus does not load. A run
// that produced no report paints the unavailable copy instead, because a claim
// this page cannot recompute is a claim it should not make.
//
// WHAT THE COLLAPSED VIEW OWES A READER. One sentence and one caveat. The
// per-class confusion is real evidence but it is the second question, so it sits
// behind the page's existing disclosure. The basis line — what the number is and
// what it is not — is NOT behind the disclosure: a reader who never opens
// anything must still leave knowing this is a synthetic sample.

import { classLabel } from "./finops-classifier-agreement.js";

/** On screen when the corpus did not load. Names the gap; invents no figure. */
export const AGREEMENT_UNAVAILABLE =
  "The labelled sample did not load, so there is no agreement figure to show. "
  + "Nothing on this page is estimated in its place.";

/**
 * The four strings a reader sees, derived from one report.
 *
 * Exported separately from the paint so a test can compare wording against a
 * fresh scorer run without a document, and so the copy has exactly one source.
 */
export function agreementCopy(report) {
  const { agreed, sampleSize } = report.overall;
  const weakest = report.weakestClass;
  return Object.freeze({
    headline: `The query classifier agrees with human labels on ${agreed} of ${sampleSize} sampled queries.`,
    caveat: weakest
      ? `Weakest class: ${classLabel(weakest.class)} — agrees on ${weakest.agreed} of ${weakest.support} queries a reviewer labelled that way.`
      : "",
    basis: `Agreement with published human labels on a synthetic sample of ${sampleSize} invented queries — not accuracy on customer traffic, and not a measurement of any customer's export.`,
    tieBreak: weakest ? `Weakest class chosen by: ${weakest.tieBreak}` : "",
  });
}

/** One confusion row per human label, in the scorer's declared order. */
export function confusionRows(report) {
  return report.perClass.map((row) => Object.freeze({
    term: `${classLabel(row.class)} — agrees on ${row.agreed} of ${row.support}`,
    detail: row.confusion.length === 0
      ? "No queries carry this label."
      : `Classifier said: ${row.confusion
        .map((cell) => `${classLabel(cell.predicted)} ${cell.count}`).join(" · ")}`,
  }));
}

function setText(doc, id, text) {
  const node = doc?.getElementById?.(id) ?? null;
  if (node) node.textContent = text;
  return node;
}

/**
 * Paint the region from a report, or from nothing.
 *
 * Safe on a document missing the region: it returns false rather than throwing,
 * because this runs on the same paint path as the answer and a throw here would
 * cost a reader the whole page.
 */
export function renderClassifierAgreement(doc, report) {
  const region = doc?.getElementById?.("classifier-agreement") ?? null;
  if (!region) return false;

  if (!report) {
    setText(doc, "classifier-agreement-headline", AGREEMENT_UNAVAILABLE);
    setText(doc, "classifier-agreement-caveat", "");
    setText(doc, "classifier-agreement-basis", "");
    setText(doc, "classifier-agreement-tie-break", "");
    const empty = doc.getElementById("classifier-agreement-confusion-list");
    if (empty) empty.replaceChildren();
    region.setAttribute("data-agreement", "unavailable");
    return true;
  }

  const copy = agreementCopy(report);
  setText(doc, "classifier-agreement-headline", copy.headline);
  setText(doc, "classifier-agreement-caveat", copy.caveat);
  setText(doc, "classifier-agreement-basis", copy.basis);
  setText(doc, "classifier-agreement-tie-break", copy.tieBreak);

  const list = doc.getElementById("classifier-agreement-confusion-list");
  if (list) {
    const nodes = [];
    for (const row of confusionRows(report)) {
      const term = doc.createElement("dt");
      term.textContent = row.term;
      const detail = doc.createElement("dd");
      detail.textContent = row.detail;
      nodes.push(term, detail);
    }
    list.replaceChildren(...nodes);
  }
  region.setAttribute("data-agreement", "measured");
  return true;
}
