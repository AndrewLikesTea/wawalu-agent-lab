import { FINOPS_RUBRIC } from "./finops-evaluation.js";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Render only scorer output; raw fixture recommendations are never accepted here. */
export function renderFinOpsEvaluation(result) {
  if (!result?.explanation || !Array.isArray(result.criteria))
    throw new TypeError("An explained FinOps score is required.");

  const article = element("article", "evaluation-card");
  article.dataset.status = result.status;
  const heading = element("div", "evaluation-heading");
  heading.append(
    element("div", undefined),
    element("span", "evaluation-status",
      result.executiveReady ? "Executive-ready" : "Withheld"),
  );
  heading.children[0].append(
    element("p", "eyebrow", result.rubricVersion),
    element("h3", undefined, result.label),
  );
  article.append(heading);

  const score = element("p", "evaluation-score",
    result.executiveReady ? `${result.total.toFixed(1)} / 100` : "Score withheld");
  article.append(score,
    element("p", "evaluation-threshold", result.explanation.threshold));

  const details = element("details", "evaluation-details");
  details.append(element("summary", undefined, "Inspect criteria, weights, and arithmetic"));
  // The audit trail necessarily restates the total a withheld card keeps out of
  // its headline. Label it, so an expanded card cannot be read — or screenshotted
  // — as an approved score.
  if (!result.executiveReady) {
    details.append(element("p", "evaluation-withheld-note",
      `Withheld from the executive score. The arithmetic below is the disputed `
      + `total, shown for reproduction only.`));
  }
  const list = element("dl", "evaluation-breakdown");
  for (const criterion of result.criteria) {
    const row = element("div", "evaluation-criterion");
    row.append(
      element("dt", undefined, `${criterion.label} · ${criterion.score}/4`),
      element("dd", "evaluation-contribution", `${criterion.contribution.toFixed(2)} points`),
      element("dd", undefined, criterion.rationale),
      element("dd", "evaluation-assumption", `Weight assumption: ${criterion.assumption}`),
      element("dd", "evaluation-arithmetic", criterion.arithmetic),
    );
    list.append(row);
  }
  details.append(list,
    element("p", "evaluation-formula",
      `${result.explanation.formula} = ${result.explanation.arithmetic}`),
    element("p", "evaluation-sanitized",
      `Sanitized input: ${result.evaluatedRecommendation.content}`));
  article.append(details);
  return article;
}

export function mountFinOpsEvaluations(results, nodes) {
  if (!nodes?.list) return;
  // The method note is supporting text. Losing it must not cost the reader every
  // result, so it is optional here and the list is not.
  if (nodes.method) {
    nodes.method.textContent = `${FINOPS_RUBRIC.version} · ${FINOPS_RUBRIC.thresholds.rule} `
      + `Scale ${FINOPS_RUBRIC.scale.min}–${FINOPS_RUBRIC.scale.max}. ${FINOPS_RUBRIC.rounding}`;
  }
  nodes.list.replaceChildren(...(Array.isArray(results) && results.length
    ? results.map(renderFinOpsEvaluation)
    // Replacing the loading text with nothing leaves a heading over a blank gap,
    // which reads as a broken page rather than an absent result.
    : [renderFinOpsEvaluationUnavailable(
      "No labelled fixtures were returned, so no score is shown.")]));
  nodes.list.setAttribute("aria-busy", "false");
}

export function renderFinOpsEvaluationUnavailable(
  reason = "Evaluation unavailable. No unexplained score is shown.",
) {
  return element("p", "evaluation-unavailable", reason);
}
