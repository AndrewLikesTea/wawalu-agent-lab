// Painting the specimen into the shipped markup.
//
// One article per case: a heading that names the state in words, one line
// saying what a reviewer is being asked to look at, and the result itself
// rendered by the same primitive the entry flow will use. The result is
// labelled by the case's own heading rather than writing a second one — two
// headings saying the same thing is how a heading outline stops being a
// navigable summary of the page.
//
// Heading levels: the coaching section owns the h2, so a case is an h3 and the
// regions inside a result are h4s. That is the level a reader jumping by
// heading expects, and it is asserted in tests/coaching-specimen-flow.test.js.

import { buildCoachingSpecimen } from "./coaching-specimen.js";
import { renderCoachingResult } from "./coaching-result-view.js";

const BODY_ID = "coaching-specimen-body";

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function specimenCase(doc, entry) {
  const article = element(doc, "article", "coaching-specimen-case");
  article.dataset.case = entry.id;
  article.dataset.status = entry.status;

  const headingId = `coaching-specimen-${entry.id}-heading`;
  const heading = element(doc, "h3", "coaching-specimen-case-title", entry.label);
  heading.id = headingId;

  article.append(
    heading,
    element(doc, "p", "coaching-specimen-case-purpose", entry.purpose),
    renderCoachingResult(doc, entry.model, {
      idPrefix: `coaching-specimen-${entry.id}`,
      headingLevel: 4,
      labelledBy: headingId,
    }),
  );
  return article;
}

/**
 * Paint the specimen.
 *
 * @returns the container that was painted, or `null` when the page does not
 *   carry one — the coaching workflow does not depend on this surface, and a
 *   page without it still grades prompts.
 */
export function applyCoachingSpecimen(doc) {
  const body = doc?.getElementById ? doc.getElementById(BODY_ID) : null;
  if (!body) return null;
  const cases = buildCoachingSpecimen();
  body.replaceChildren(...cases.map((entry) => specimenCase(doc, entry)));
  body.dataset.cases = String(cases.length);
  return body;
}
