const usd = (minor) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
}).format(minor / 100);
const percentage = (value) => value === null ? "not defined" : `${(value * 100).toFixed(1)}%`;
const add = (doc, parent, tag, className, value) => {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  parent.append(node);
  return node;
};
const fact = (doc, list, term, value) => {
  add(doc, list, "dt", undefined, term);
  add(doc, list, "dd", undefined, value);
};

/** Render the three leadership questions in decision order; all support is secondary. */
export function renderMonthlyFinopsReview(doc, review) {
  const root = doc.getElementById("monthly-finops-review");
  if (!root) return null;
  root.className = "monthly-finops-review";
  root.tabIndex = -1;
  root.setAttribute("aria-labelledby", "monthly-finops-review-title");
  root.replaceChildren();
  root.hidden = false;

  add(doc, root, "p", "eyebrow", "Monthly AI FinOps review · bundled synthetic preview");
  add(doc, root, "h2", undefined, "What changed since last month?").id = "monthly-finops-review-title";
  add(doc, root, "p", "monthly-finops-finding", review.finding.statement);
  add(doc, root, "p", "monthly-finops-change",
    `${usd(review.periods.current.totalMinor)} this month · ${usd(Math.abs(review.change.differenceMinor))} lower · ${percentage(review.change.percentage)} month over month.`);

  const commitment = add(doc, root, "section", "monthly-finops-decision", "");
  add(doc, commitment, "h3", undefined, "Did the prior commitment work?");
  add(doc, commitment, "p", "monthly-finops-verdict",
    `${review.commitment.status === "achieved" ? "Achieved" : "Not achieved"}. ${review.commitment.statement}`);

  const action = add(doc, root, "section", "monthly-finops-decision", "");
  add(doc, action, "h3", undefined, "What one action should happen next?");
  add(doc, action, "p", "monthly-finops-action", review.nextAction.statement);

  const details = add(doc, root, "details", "monthly-finops-support", "");
  add(doc, details, "summary", undefined, "Supporting values, confidence, and provenance");
  const values = add(doc, details, "dl", undefined, "");
  fact(doc, values, "Prior total", usd(review.periods.prior.totalMinor));
  fact(doc, values, "Current total", usd(review.periods.current.totalMinor));
  fact(doc, values, "Commitment test", `${usd(review.commitment.observedMinor)} observed ${review.commitment.comparison.replace("_", " ")} ${usd(review.commitment.targetMinor)} target`);
  fact(doc, values, "Confidence", `${review.confidence.label} · complete: ${review.confidence.complete}; month-end fresh: ${review.confidence.fresh}`);
  fact(doc, values, "Action priority", `score ${review.nextAction.priorityScore} · ties resolve by action id`);
  fact(doc, values, "Provenance", `${review.sourceVersion} · ${review.periods.prior.id}, ${review.periods.current.id} · as of ${review.evidenceAsOf}`);
  add(doc, details, "p", "monthly-finops-boundary", "Invented two-period data only. This preview does not load, retain, filter, or transmit data and does not claim the action caused the change.");
  root.focus();
  return root;
}
