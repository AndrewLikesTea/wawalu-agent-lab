// The one recoverable answer, painted onto the two pages that state it (#1184).
//
// `computeRecoverableAnswer` in src/finops-spine.js is the arithmetic. This
// module is the only thing that turns it into sentences, and both /evolution.html
// and /savings-action-center.html read those sentences from here. Neither page
// composes a money string and neither rounds anything: the display strings arrive
// already rounded, so two surfaces cannot round one quantity two ways.
//
// THE AUTHORED COPY AND THIS MODULE ARE THE SAME SENTENCE. Both documents ship
// these exact words, so a reader whose script never ran meets a complete answer.
// tests/finops-recoverable-answer.test.js compares the authored markup against
// what these builders return, so an editor who changes one copy and not the other
// fails a test instead of publishing two figures.
//
// NO CLOCK, NO STORAGE, NO REQUEST, NO NEW DATA FILE — the analysis is the
// bundled synthetic example, on the singleton pattern finops-answer-summary.js
// already uses on this page.

import { loadExampleDataset } from "./example-dataset.js";
import { computeRecoverableAnswer } from "./finops-spine.js";

/** The slots each page authors. Ids, not selectors: the harness rejects descendants. */
export const RECOVERABLE_ANSWER_IDS = Object.freeze({
  value: "finops-recoverable-value",
  confidence: "finops-recoverable-confidence",
  action: "finops-recoverable-action",
  pointer: "finops-journey-owner",
  pointerLink: "finops-journey-owner-link",
});

/**
 * The bundled answer, computed once at import.
 *
 * Total for the same reason `finops-answer-summary.js` is: a bundled example
 * this browser could not read is a state the page reports, not an exception that
 * takes the first figure a reader meets off the screen.
 */
export const RECOVERABLE_ANSWER = (() => {
  try {
    return computeRecoverableAnswer(loadExampleDataset());
  } catch {
    return computeRecoverableAnswer(null);
  }
})();

/** The words shown in place of a figure that could not be derived. Never a zero. */
export const RECOVERABLE_WITHHELD_VALUE = "Not available";

/** The headline figure. One string, already rounded by the derivation. */
export function recoverableValueText(answer = RECOVERABLE_ANSWER) {
  return answer.available ? answer.recoverable.annualDisplay : RECOVERABLE_WITHHELD_VALUE;
}

/**
 * What the figure rests on and what it is not: the spend it is modelled over,
 * the annualisation stated rather than assumed, the two things left out of the
 * arithmetic, and the coverage behind the confidence.
 */
export function recoverableConfidenceText(answer = RECOVERABLE_ANSWER) {
  if (!answer.available) {
    return "No recoverable figure is stated here: the bundled dataset published no complete "
      + `answer (${answer.unavailableReason}). Nothing is estimated in its place.`;
  }
  const { totalSpend, period, annualFactor, coverage } = answer;
  const months = `${period.months} scored month${period.months === 1 ? "" : "s"}`;
  return `Modelled over ${totalSpend.annualDisplay} of analyzed AI spend a year — ${months} `
    + `annualised at ${annualFactor}x, at published list prices, with committed-use discounts `
    + "and measured throughput both left out of the arithmetic, so it reads as a ceiling to "
    + `verify rather than an invoiced saving. ${coverage.scoredShareDisplay} of that spend sits `
    + `in departments the rubric scored, across ${coverage.recordsAnalyzed} analyzed records; `
    + `confidence ${coverage.confidenceLevel}.`;
}

/** The one move, named by the ranked destination rather than by an author. */
export function recoverableActionText(answer = RECOVERABLE_ANSWER) {
  return answer.available
    ? answer.topDestination.move
    : "Import an export to rank a move";
}

/**
 * The action centre's pointer, in three parts around the link it already ships.
 *
 * It is a POINTER, not a second telling: the figure in it is painted from the
 * same derivation the answer region is, so the two cannot disagree. Returning
 * the parts rather than one string is what lets the painter reuse the authored
 * anchor instead of creating a second focusable on the page.
 */
export function recoverablePointerParts(answer = RECOVERABLE_ANSWER) {
  const tail = answer.available
    ? `: ${answer.recoverable.annualDisplay} recoverable a year, starting with `
      + `${answer.topDestination.name}. This page is where you carry it out and check it.`
    : ". This page is where you carry it out and check it.";
  return Object.freeze({
    before: "What the recommended move is, what it is worth, and how far to trust that figure "
      + "are stated once — on ",
    link: "the AI FinOps answer",
    after: tail,
  });
}

/**
 * Paint the answer region on /evolution.html.
 *
 * Text only. It writes no attribute the spine owns, adds no element, and adds no
 * focusable — the region's one link is authored and only its words are replaced.
 *
 * @returns the ids it painted, so a caller can assert on what it asked for.
 */
export function renderRecoverableAnswer(doc, answer = RECOVERABLE_ANSWER) {
  const painted = [];
  const write = (id, text) => {
    const node = doc?.getElementById?.(id) ?? null;
    if (!node) return;
    node.textContent = text;
    painted.push(id);
  };
  write(RECOVERABLE_ANSWER_IDS.value, recoverableValueText(answer));
  write(RECOVERABLE_ANSWER_IDS.confidence, recoverableConfidenceText(answer));
  write(RECOVERABLE_ANSWER_IDS.action, recoverableActionText(answer));
  return painted;
}

/**
 * Paint the pointer on /savings-action-center.html, around its authored link.
 *
 * The anchor element is reused rather than rebuilt, so the page's tab order is
 * exactly what it was before this ran.
 */
export function renderRecoverablePointer(doc, answer = RECOVERABLE_ANSWER) {
  const host = doc?.getElementById?.(RECOVERABLE_ANSWER_IDS.pointer) ?? null;
  const link = doc?.getElementById?.(RECOVERABLE_ANSWER_IDS.pointerLink) ?? null;
  if (!host || !link) return null;
  const parts = recoverablePointerParts(answer);
  link.textContent = parts.link;
  host.replaceChildren(
    doc.createTextNode(parts.before), link, doc.createTextNode(parts.after),
  );
  return host;
}
