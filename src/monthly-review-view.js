const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const el = (doc, tag, className, text) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const fact = (doc, list, label, value) => {
  const row = el(doc, "div", "monthly-review-fact");
  row.append(el(doc, "dt", undefined, label), el(doc, "dd", undefined, value));
  list.append(row);
};

export function renderMonthlyReview(doc, review) {
  const root = doc.getElementById("monthly-review-preview");
  if (!root) return null;
  root.replaceChildren();
  root.hidden = false;
  root.dataset.version = review.schemaVersion;

  const heading = el(doc, "header", "monthly-review-heading");
  heading.append(el(doc, "p", "eyebrow", "Monthly executive review · synthetic preview"));
  const title = el(doc, "h2", undefined, "What changed, did our commitment work, and what happens next?");
  title.id = "monthly-review-title";
  title.setAttribute("tabindex", "-1");
  heading.append(title, el(doc, "p", "monthly-review-provenance", review.provenance.source));
  root.append(heading);

  const change = el(doc, "section", "monthly-review-decision");
  const changeTitle = el(doc, "h3", undefined, review.questionOrder[0]);
  changeTitle.id = "monthly-review-change-question";
  change.setAttribute("aria-labelledby", changeTitle.id);
  change.append(changeTitle,
    el(doc, "p", "monthly-review-value", `${USD.format(Math.abs(review.change.value))} ${review.change.value < 0 ? "lower" : review.change.value > 0 ? "higher" : "unchanged"}`),
    el(doc, "p", "monthly-review-support", `${USD.format(review.change.currentValue)} in ${review.change.currentPeriod}, from ${USD.format(review.change.priorValue)} in ${review.change.priorPeriod} · ${review.change.unit}`));

  const commitment = el(doc, "section", "monthly-review-decision");
  const commitmentTitle = el(doc, "h3", undefined, review.questionOrder[1]);
  commitmentTitle.id = "monthly-review-commitment-question";
  commitment.setAttribute("aria-labelledby", commitmentTitle.id);
  commitment.append(commitmentTitle,
    el(doc, "p", "monthly-review-outcome", review.commitment.outcome === "achieved" ? "Achieved" : "Not achieved"),
    el(doc, "p", "monthly-review-support", `${USD.format(review.commitment.observed)} observed ${review.commitment.operator} ${USD.format(review.commitment.target)} target · ${review.commitment.unit}`));

  const action = el(doc, "section", "monthly-review-decision monthly-review-next");
  const actionTitle = el(doc, "h3", undefined, review.questionOrder[2]);
  actionTitle.id = "monthly-review-action-question";
  action.setAttribute("aria-labelledby", actionTitle.id);
  action.append(actionTitle, el(doc, "p", "monthly-review-action", review.prioritizedAction.label),
    el(doc, "p", "monthly-review-support", review.prioritizedAction.evidence));
  root.append(change, commitment, action);

  const direction = review.change.value < 0 ? "less" : review.change.value > 0 ? "more" : "no change in";
  const result = review.commitment.outcome === "achieved" ? "met" : "did not meet";
  const finding = el(doc, "p", "monthly-review-finding",
    `${USD.format(Math.abs(review.change.value))} ${direction} recoverable spend ${result} the prior target. ${review.prioritizedAction.label}.`);
  finding.setAttribute("role", "note");
  root.append(finding);

  const details = el(doc, "details", "monthly-review-details");
  details.append(el(doc, "summary", undefined, "Supporting definitions, confidence, and provenance"));
  const facts = el(doc, "dl", "monthly-review-facts");
  fact(doc, facts, "Monthly change", `${review.change.definition}; unit: ${review.change.unit}; denominator: ${review.change.denominator}`);
  fact(doc, facts, "Commitment result", review.commitment.definition);
  fact(doc, facts, "Confidence", `${review.confidence.assessment}. ${review.confidence.basis}`);
  fact(doc, facts, "Action ordering", review.prioritizedAction.rankingRule);
  fact(doc, facts, "Provenance", `${review.provenance.generatedBy}; observed through ${review.provenance.observedThrough}; excludes ${review.provenance.exclusions.join(", ")}.`);
  fact(doc, facts, "Contracts", `${review.schemaVersion}; fixture ${review.fixtureId}`);
  details.append(facts);
  root.append(details);
  title.focus?.();
  return root;
}
