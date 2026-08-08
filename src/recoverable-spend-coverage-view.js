import { evaluateRecoverableSpendCoverage } from "./recoverable-spend-coverage.js";

const node = (doc, tag, className, text) => {
  const value = doc.createElement(tag);
  if (className) value.className = className;
  if (text != null) value.textContent = text;
  return value;
};

export function renderRecoverableSpendCoverage(doc, coverage) {
  const root = doc.getElementById("recoverable-spend-coverage");
  if (!root) return null;
  root.replaceChildren();
  const list = node(doc, "ol", "recoverable-coverage-list");
  for (const item of coverage) {
    const row = node(doc, "li", "recoverable-coverage-row");
    row.dataset.coverageState = item.state;
    const heading = node(doc, "h4", "recoverable-coverage-heading", item.label);
    heading.append(node(doc, "span", "figure-source-state", item.state.replace("-", " ")));
    row.append(heading, node(doc, "p", "recoverable-coverage-question", item.question),
      node(doc, "p", "recoverable-coverage-result", item.stateDetail));
    const method = node(doc, "dl", "recoverable-coverage-method");
    for (const [term, detail] of [
      ["Required import fields", item.requiredImportFields.join(", ")],
      ["Metric", `${item.metric.formula} Denominator: ${item.metric.denominator}`],
      ["Pricing basis", item.pricingBasis], ["Accountable owner", item.accountableOwner],
      ["Confidence cap", `${item.confidenceCap.level}: ${item.confidenceCap.reason}`],
    ]) method.append(node(doc, "dt", "", term), node(doc, "dd", "", detail));
    row.append(method);
    list.append(row);
  }
  root.append(node(doc, "p", "recoverable-coverage-intro",
    "Coverage answers which recovery classes this analysis could test. Unsupported is not zero; no opportunity means only that evaluated records produced no candidate."), list);
  return root;
}

export function applyRecoverableSpendCoverage(doc, input) {
  return renderRecoverableSpendCoverage(doc, evaluateRecoverableSpendCoverage(input));
}
