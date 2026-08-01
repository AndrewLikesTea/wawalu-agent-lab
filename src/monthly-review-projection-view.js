import { validateMonthlyReviewProjection } from "./monthly-review-projection.js";

const percent = (ppm) => Number.isInteger(ppm) ? `${(ppm / 10_000).toFixed(1)}%` : "unavailable";
const text = (doc, tag, className, value) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
};

export function renderMonthlyReviewProjection(doc, review) {
  const root = doc.getElementById("monthly-review-projection");
  if (!root) return null;
  const checked = validateMonthlyReviewProjection(review);
  root.hidden = false;
  root.replaceChildren();
  root.dataset.state = checked.valid ? review.status : "invalid_output";
  const heading = text(doc, "h2", undefined, "What changed this month, and what happens next?");
  heading.id = "monthly-review-projection-title";
  root.append(text(doc, "p", "eyebrow", "Local monthly review · versioned projection"), heading);
  if (!checked.valid) {
    root.append(text(doc, "p", "monthly-review-projection-failure",
      "The retained monthly-review projection failed validation, so no recommendation is shown."));
    return root;
  }
  const benchmark = review.materialBenchmark.status === "unavailable"
    ? "Month-over-month benchmark unavailable"
    : `${review.status}: ${percent(review.materialBenchmark.currentSharePpm)} current recoverable share vs ${percent(review.materialBenchmark.baselineSharePpm)} baseline`;
  root.append(
    text(doc, "p", "monthly-review-projection-benchmark", benchmark),
    text(doc, "p", "monthly-review-projection-department",
      review.strongestDepartmentContributor
        ? `Strongest department contributor: ${review.strongestDepartmentContributor.departmentId}`
        : "Strongest department contributor unavailable"),
    text(doc, "p", "monthly-review-projection-verification",
      `Prior commitment verification: ${review.priorCommitmentVerification.status}. ${review.priorCommitmentVerification.basis}`),
    text(doc, "p", "monthly-review-projection-confidence", `Confidence: ${review.confidence.level}. ${review.confidence.basis}`),
  );
  const action = text(doc, "section", "monthly-review-projection-action", "");
  action.append(
    text(doc, "h3", undefined, `Next action · rank ${review.nextAction.rank}`),
    text(doc, "p", undefined, review.nextAction.statement),
  );
  root.append(action);
  const details = text(doc, "details", "monthly-review-projection-provenance", "");
  details.append(
    text(doc, "summary", undefined, "Provenance and evidence boundary"),
    text(doc, "p", undefined, `${review.schemaVersion} · ${review.inputVersion} · periods ${review.provenance.periodIds.join(", ") || "none"}. Browser-local retained derived periods only; no causal attribution.`),
  );
  root.append(details);
  return root;
}
