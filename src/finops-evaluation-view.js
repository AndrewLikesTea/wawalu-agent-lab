/** DOM rendering for already-sanitized, deterministic score records. */
import { evaluateFinopsOpportunities, scoreFinopsFixture } from "./finops-evaluation.js";

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function renderFinopsEvaluation(result) {
  const article = element("article", "evaluation-result");
  article.setAttribute("aria-labelledby", `evaluation-${result.fixtureId}`);
  // The heading is this article's accessible name. With several fixtures on the
  // page a shared name makes heading navigation useless, so it carries the
  // fixture identity and its grade.
  const heading = element("h3", undefined,
    `Fixture "${result.fixtureId}" — ${result.label}`);
  heading.id = `evaluation-${result.fixtureId}`;
  const summary = element("p", "evaluation-summary",
    `${result.score.toFixed(1)} / 100 · ${result.label}. ${result.rubricVersion}.`);
  const recommendation = element("p", "evaluation-recommendation", result.recommendation);
  const department = element("p", "evaluation-department", `Attributed department: ${result.department}`);
  const details = element("details", "evaluation-details");
  details.append(element("summary", undefined,
    `Inspect the "${result.fixtureId}" score breakdown and weight assumptions`));
  const list = element("ol", "evaluation-breakdown");
  for (const item of result.breakdown) {
    const row = element("li", "evaluation-criterion");
    row.append(
      element("h4", undefined, `${item.label}: ${item.contribution.toFixed(1)} points`),
      element("p", undefined, `Rating ${item.rating} of ${item.scaleMaximum}; weight ${(item.weight * 100).toFixed(0)}%. ${item.arithmetic}.`),
      element("p", undefined, `Evidence: ${item.evidence}`),
      element("p", undefined, `Weight assumption: ${item.assumption} ${item.weightReason}`),
    );
    list.append(row);
  }
  details.append(list,
    element("p", "evaluation-arithmetic", `Total arithmetic: ${result.arithmetic}.`),
    element("p", "evaluation-gate", result.privacyGate.applied
      ? `Privacy gate applied: ${result.privacyGate.rating} is below ${result.privacyGate.threshold}.`
      : `Privacy gate passed: ${result.privacyGate.rating} meets ${result.privacyGate.threshold}.`));
  article.append(heading, summary, recommendation, department, details);
  return article;
}

/**
 * The failure notice. It is an alert because it always replaces content the
 * reader was told to expect, and it states that nothing was substituted — a
 * missing fixture must never look like a low score.
 */
export function renderFinopsEvaluationUnavailable(reason) {
  const notice = element("p", "evaluation-unavailable", reason);
  notice.setAttribute("role", "alert");
  return notice;
}

const PAYLOAD_UNAVAILABLE = "The bundled evaluation fixtures are unavailable. "
  + "No score was produced, and no live provider or customer record was contacted.";

/**
 * Renders the whole bundled fixture set.
 *
 * Scoring happens here rather than in the page so the degraded paths — an empty
 * or truncated payload, one unreadable fixture among several — are covered by
 * the render tests instead of living in an untested page callback. A fixture
 * that fails validation is withheld and named; the readable ones still render,
 * because blanking the panel hides the evidence a reviewer came for.
 */
export function renderFinopsEvaluationPanel(payload) {
  const panel = element("div", "evaluation-panel");
  const fixtures = Array.isArray(payload?.fixtures) ? payload.fixtures : [];
  if (!fixtures.length) {
    panel.append(renderFinopsEvaluationUnavailable(PAYLOAD_UNAVAILABLE));
    return panel;
  }
  if (Array.isArray(payload.opportunities)) {
    const evaluation = evaluateFinopsOpportunities(payload);
    if (evaluation.winner) {
      const primary = element("article", "evaluation-primary-recommendation");
      primary.append(element("h3", undefined, "Primary portfolio recommendation"),
        element("p", undefined, `${evaluation.winner.action} · $${evaluation.winner.amountUsd.toLocaleString("en-US")} projected · ${Math.round(evaluation.winner.confidence * 100)}% confidence.`));
      panel.append(primary);
    }
  }
  for (const fixture of fixtures) {
    try {
      panel.append(renderFinopsEvaluation(scoreFinopsFixture(fixture)));
    } catch (error) {
      panel.append(renderFinopsEvaluationUnavailable(
        `A bundled fixture was withheld because it does not meet the rubric contract: ${error.message}`));
    }
  }
  return panel;
}
