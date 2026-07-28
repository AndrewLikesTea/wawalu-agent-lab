// The "check the math" view.
//
// It renders `verifyBriefingMath`'s model and computes nothing of its own. Every
// number on screen came out of that one function, which is the same function the
// golden fixtures assert against — a view with its own arithmetic would be a
// second answer to the question this surface exists to settle.
//
// ACCESSIBILITY
// -------------
// * The verdict is a sentence, in a heading and in a paragraph. `data-verdict`
//   exists for styling; no state here is carried by colour alone.
// * Steps are an ordered list of headed items, the pattern the evaluation panel
//   already uses, and every operation is written out in words and digits rather
//   than implied by layout.
// * Every threshold is followed by the assumption behind it in the same list
//   item, so a reader who disputes a number never has to leave the page to find
//   out why it is that number.
//
// Everything is written through `textContent`. Nothing from a restored file —
// which is untrusted input — becomes markup, an attribute value, or a URL.

import { GRADE_LABEL } from "./finops-briefing-restore.js";
import { VERIFICATION_VERDICT } from "./finops-briefing-verification.js";

/** The short label above the sentence. The sentence is still the answer. */
export const VERDICT_HEADLINE = Object.freeze({
  [VERIFICATION_VERDICT.reproduced]: "Reproduced exactly",
  [VERIFICATION_VERDICT.rubricDrift]: "Cannot reproduce — rubric version drift",
  [VERIFICATION_VERDICT.mismatch]: "Does not match",
  [VERIFICATION_VERDICT.cannotReproduce]: "Cannot reproduce — an input is missing",
});

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function gradeText(grade) {
  return GRADE_LABEL[grade] ?? String(grade ?? "not stated");
}

function moneyText(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)} USD` : "not stated";
}

function figureText(figure) {
  if (figure.name === "grade") {
    return figure.matches
      ? `Recomputed ${gradeText(figure.recomputed)}; the briefing published ${gradeText(figure.stated)}.`
      : `Recomputed ${gradeText(figure.recomputed)}, but the briefing published `
        + `${gradeText(figure.stated)}.`;
  }
  const stated = figure.unit === "USD" ? moneyText(figure.stated)
    : Number.isFinite(figure.stated) ? String(figure.stated) : "not stated";
  const recomputed = figure.unit === "USD" ? moneyText(figure.recomputed)
    : Number.isFinite(figure.recomputed) ? String(figure.recomputed) : "not computed";
  const gap = figure.matches
    ? "they agree"
    : `they differ by ${figure.unit === "USD" ? moneyText(figure.delta) : figure.delta}`;
  return `Briefing states ${stated}; recomputed ${recomputed} — ${gap}.`;
}

function stepList(doc, steps) {
  const list = element(doc, "ol", "verification-steps");
  for (const step of steps) {
    const item = element(doc, "li", "verification-step");
    item.dataset.step = step.id;
    item.append(
      element(doc, "h5", undefined, step.label),
      element(doc, "p", "verification-step-operation", `Operation: ${step.expression}`),
      element(doc, "p", "verification-step-value", `Result: ${step.value}`),
    );
    list.append(item);
  }
  return list;
}

function assumptionList(doc, entries, className) {
  const list = element(doc, "ol", className);
  for (const entry of entries) {
    const item = element(doc, "li", "verification-assumption");
    item.dataset.parameter = entry.name ?? "";
    item.append(
      element(doc, "h5", undefined,
        `${entry.name} = ${entry.value}${entry.unit ? ` ${entry.unit}` : ""}`),
      element(doc, "p", "verification-assumption-text", `Assumption: ${entry.assumption ?? "not stated"}`),
    );
    if (entry.source) item.append(element(doc, "p", "verification-assumption-source", `Value ${entry.source}.`));
    list.append(item);
  }
  return list;
}

/**
 * Build the whole view.
 *
 * @param verification a `verifyBriefingMath` result.
 * @param options.doc the document to build in; the page's own by default.
 * @param options.headingId the id the caller uses to label the region.
 * @returns a `<section>` the caller places. This module never queries or mutates
 *   anything outside the tree it returns.
 */
export function renderBriefingVerification(verification, { doc = document, headingId = "verification-title" } = {}) {
  const section = element(doc, "section", "briefing-verification");
  section.setAttribute("role", "region");
  section.setAttribute("aria-labelledby", headingId);
  section.dataset.verdict = verification.verdict;

  const heading = element(doc, "h4", undefined,
    `Check the math — ${VERDICT_HEADLINE[verification.verdict]}`);
  heading.id = headingId;
  // The verdict as a sentence, in a status region, so a screen-reader user is
  // told the outcome rather than shown a coloured band.
  const verdict = element(doc, "p", "verification-verdict", verification.statement);
  verdict.setAttribute("role", "status");
  verdict.dataset.verdict = verification.verdict;

  const rubric = element(doc, "p", "verification-rubric",
    verification.rubric.drifted
      ? `Rubric applied to this briefing: ${verification.rubric.stated}. This build runs `
        + `${verification.rubric.current}.`
      : `Rubric applied to this briefing: ${verification.rubric.stated ?? "not stated by the file"}`
        + `${verification.rubric.stated ? ` — the version this build runs.` : "."}`);

  section.append(heading, verdict, rubric);

  if (verification.missingOperands.length) {
    section.append(element(doc, "p", "verification-missing",
      `Missing operands, so the arithmetic was not attempted from source data: `
      + `${verification.missingOperands.join(", ")}.`));
  }

  // Attribution first: a director reading a figure about their department asks
  // what fraction of the spend it was summed over before they ask anything else.
  const attributionNode = element(doc, "p", "verification-attribution", verification.attribution.statement);
  attributionNode.dataset.full = String(Boolean(verification.attribution.full));
  section.append(attributionNode);

  const figures = element(doc, "ul", "verification-figures");
  for (const figure of Object.values(verification.figures)) {
    const item = element(doc, "li", "verification-figure");
    item.dataset.figure = figure.name;
    item.dataset.matches = String(figure.matches);
    item.append(
      element(doc, "h5", undefined, figure.name),
      element(doc, "p", undefined, figureText(figure)),
    );
    figures.append(item);
  }
  section.append(element(doc, "h5", "verification-subhead", "Published figure against recomputed figure"), figures);

  section.append(
    element(doc, "h5", "verification-subhead", "From the stated inputs to the recoverable-spend figure"),
    stepList(doc, verification.steps.recoverableSpend),
    element(doc, "h5", "verification-subhead", "From the scored inputs to the grade"),
    stepList(doc, verification.steps.grade),
    element(doc, "h5", "verification-subhead",
      "Every price and volume threshold in the money figure, and what each one assumes"),
    assumptionList(doc, verification.parameters, "verification-parameters"),
    element(doc, "h5", "verification-subhead",
      "Every threshold in the grade, and what each one assumes"),
    assumptionList(doc, verification.thresholds, "verification-thresholds"),
  );
  return section;
}

/**
 * Paint the view into a container, or take it off screen.
 *
 * @param model a `verifyBriefingMath` result, or null to empty the container.
 *   There is no half state: a container with no verification in it is hidden,
 *   not left holding the previous briefing's arithmetic.
 */
export function applyBriefingVerification(doc, containerId, model, { headingId } = {}) {
  const container = doc.getElementById(containerId);
  if (!container) return null;
  if (!model) {
    container.replaceChildren();
    container.hidden = true;
    delete container.dataset.verdict;
    return null;
  }
  container.hidden = false;
  container.dataset.verdict = model.verdict;
  container.replaceChildren(renderBriefingVerification(model, { doc, headingId: headingId ?? `${containerId}-title` }));
  return model;
}
