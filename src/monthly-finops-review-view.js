const node = (doc, tag, className, content) => {
  const result = doc.createElement(tag);
  if (className) result.className = className;
  result.textContent = content;
  return result;
};

const fact = (doc, label, value) => {
  const item = node(doc, "div", "monthly-review-fact", "");
  item.append(node(doc, "dt", "", label), node(doc, "dd", "", value));
  return item;
};

export function renderMonthlyFinopsReview(doc, review) {
  const root = doc.getElementById("monthly-review-projection");
  if (!root) return null;
  root.replaceChildren();
  root.dataset.state = "preview";
  root.dataset.contractVersion = review.schemaVersion;

  const heading = node(doc, "h2", "", "What changed this month, and what should we do next?");
  heading.id = "monthly-review-projection-title";
  const finding = node(doc, "section", "monthly-review-benchmark", "");
  const findingTitle = node(doc, "h3", "", "Primary finding");
  findingTitle.id = "monthly-review-primary-finding";
  finding.setAttribute("aria-labelledby", findingTitle.id);
  finding.append(findingTitle, node(doc, "p", "monthly-review-finding", review.finding.statement));

  const action = node(doc, "section", "monthly-review-projection-action", "");
  const actionTitle = node(doc, "h3", "", "What should we do next? · priority 1");
  actionTitle.id = "monthly-review-action-title";
  action.setAttribute("aria-labelledby", actionTitle.id);
  action.append(actionTitle, node(doc, "p", "monthly-review-action-statement", review.nextAction.statement),
    node(doc, "p", "monthly-review-comparison", review.nextAction.evidence));

  const details = node(doc, "details", "monthly-review-projection-provenance", "");
  const summary = node(doc, "summary", "", "Check commitment, confidence, metric definition, and provenance");
  const facts = node(doc, "dl", "monthly-review-evidence", "");
  facts.append(
    fact(doc, "Did the prior commitment hold?", `${review.commitment.status}. ${review.commitment.basis}`),
    fact(doc, "How trustworthy is this?", `${review.confidence.level}. ${review.confidence.coveragePercent.toFixed(1)}% coverage; threshold ${review.confidence.thresholdPercent.toFixed(1)}%.`),
    fact(doc, "Spend-change definition", "(current invoiced spend − prior invoiced spend) ÷ prior invoiced spend × 100; one decimal, half away from zero."),
    fact(doc, "What produced this?", `${review.provenance.methodVersion}; periods ${review.provenance.periodIds.join(" and ")}.`),
  );
  details.append(summary, facts, node(doc, "p", "monthly-review-boundary", review.provenance.boundary));

  root.append(node(doc, "p", "eyebrow", "Monthly FinOps review preview · synthetic fixture"), heading,
    node(doc, "p", "monthly-review-status", "Preview · not a customer result"), finding, action, details);
  return root;
}
