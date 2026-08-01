import { roundOne } from "./monthly-finops-review.js";

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

// Whole units stay uncluttered, but minor units are shown when there are any:
// rounding them away prints a $0 variance next to a met-or-missed verdict.
const money = (minor, currency) => {
  const digits = minor % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency, minimumFractionDigits: digits, maximumFractionDigits: digits,
  }).format(minor / 100);
};

// roundOne, not toFixed: the contract's rule is half away from zero, and toFixed
// would show an attainment of exactly 100.05% as 100.0% — "landed on target".
const percent = (ratio) => ratio === null
  ? "Not defined (expected savings are zero)"
  : `${roundOne(ratio * 100).toFixed(1)}%`;

export function renderMonthlyFinopsReview(doc, review) {
  const root = doc.getElementById("monthly-review-projection");
  if (!root) return null;
  root.replaceChildren();
  root.dataset.state = review.finding.outcome;
  root.dataset.contractVersion = review.schemaVersion;

  const heading = node(doc, "h2", "", review.question);
  heading.id = "monthly-review-projection-title";

  const finding = node(doc, "section", "monthly-review-benchmark", "");
  const findingTitle = node(doc, "h3", "", "Finding");
  findingTitle.id = "monthly-review-primary-finding";
  finding.setAttribute("aria-labelledby", findingTitle.id);
  const benchmark = node(doc, "dl", "monthly-review-evidence", "");
  benchmark.append(
    fact(doc, "Selected savings action", `${review.selectedAction.name} · ${review.selectedAction.scope}`),
    fact(doc, `Expected savings · ${review.benchmark.verificationPeriodLabel}`,
      money(review.benchmark.expectedSavingsMinor, review.benchmark.currency)),
    fact(doc, `Observed savings · ${review.benchmark.verificationPeriodLabel}`,
      money(review.benchmark.observedSavingsMinor, review.benchmark.currency)),
    fact(doc, "Variance · observed minus expected",
      money(review.benchmark.varianceMinor, review.benchmark.currency)),
    fact(doc, "Attainment · observed ÷ expected", percent(review.benchmark.attainment)),
  );
  finding.append(findingTitle, node(doc, "p", "monthly-review-finding", review.finding.statement), benchmark);

  const confidence = node(doc, "p", "monthly-review-status",
    `Confidence: ${review.confidence.level} · ${review.confidence.basis}`);
  const provenance = node(doc, "p", "monthly-review-comparison",
    `Synthetic provenance: ${review.provenance.periodLabels.join(" → ")} · ${review.provenance.methodVersion}.`);

  const action = node(doc, "section", "monthly-review-projection-action", "");
  const actionTitle = node(doc, "h3", "", "Prioritized follow-up · rank 1");
  actionTitle.id = "monthly-review-action-title";
  action.setAttribute("aria-labelledby", actionTitle.id);
  action.append(actionTitle, node(doc, "p", "monthly-review-action-statement", review.nextAction.statement),
    node(doc, "p", "monthly-review-comparison", review.nextAction.evidence));

  const details = node(doc, "details", "monthly-review-projection-provenance", "");
  const summary = node(doc, "summary", "", "Check supporting signals and metric boundaries");
  summary.setAttribute("aria-controls", "monthly-review-verification-support");
  const support = node(doc, "div", "monthly-review-provenance-content", "");
  support.id = "monthly-review-verification-support";
  const coverage = review.confidence.coveragePercent === null
    ? `No comparable records were expected, so coverage is undefined; threshold ${review.confidence.thresholdPercent.toFixed(1)}%.`
    : `${review.confidence.coveragePercent.toFixed(1)}% comparable; threshold ${review.confidence.thresholdPercent.toFixed(1)}%.`;
  const facts = node(doc, "dl", "monthly-review-evidence", "");
  facts.append(
    fact(doc, "Complete observation", String(review.confidence.signals.observationComplete)),
    fact(doc, "Coverage signal", coverage),
    fact(doc, "Scope match", review.confidence.signals.scopeMatches
      ? `true; observed spend is scoped to ${review.selectedAction.scope}.`
      : `false; observed spend is scoped to ${review.benchmark.observedScope ?? "an unnamed scope"}, not ${review.selectedAction.scope}.`),
    fact(doc, "Observed-savings definition", "Baseline scoped spend minus verification-period scoped spend."),
    fact(doc, "Variance and attainment", "Variance is observed minus expected. Attainment is observed divided by expected; undefined when expected is zero."),
    fact(doc, "Synthetic source period IDs", review.provenance.periodIds.join(" → ")),
  );
  support.append(facts, node(doc, "p", "monthly-review-boundary", review.provenance.boundary));
  details.append(summary, support);

  root.append(node(doc, "p", "eyebrow", "Monthly verification brief · bundled synthetic data"),
    heading, finding, confidence, provenance, action, details);
  return root;
}

export function renderOperatingCycle(doc, cycle, { onSelect, onReset } = {}) {
  const root = doc.getElementById("monthly-review-projection");
  if (!root) return null;
  if (cycle.status === "ready") {
    renderMonthlyFinopsReview(doc, cycle.review);
    const controls = node(doc, "div", "monthly-review-cycle-controls", "");
    const reset = node(doc, "button", "", "Reset demo action");
    reset.type = "button";
    reset.addEventListener("click", () => onReset?.());
    controls.append(reset, node(doc, "p", "monthly-review-boundary",
      "Reset removes the selected demo action from this browser. The synthetic fixture is never stored."));
    root.append(controls);
    return root;
  }

  root.replaceChildren();
  root.dataset.state = cycle.status;
  root.dataset.contractVersion = cycle.schemaVersion;
  const heading = node(doc, "h2", "", "Did our last action deliver the expected savings?");
  heading.id = "monthly-review-projection-title";
  root.append(node(doc, "p", "eyebrow", "Local operating cycle · bundled synthetic data"), heading);
  const messages = {
    empty: "Choose one bundled demo action to begin. No verification exists until a valid subsequent synthetic period is linked.",
    unavailable: "Browser-local storage is unavailable. No action was selected and no verification is shown.",
    incompatible: "The saved demo action cannot be read by this version. Reset it before starting a new cycle.",
    no_valid_comparison: "This action has no valid like-for-like subsequent bundled period. It is not verified.",
  };
  root.append(node(doc, "p", "monthly-review-status", messages[cycle.status] ?? messages.incompatible));
  if (cycle.status === "empty") {
    const choices = node(doc, "div", "monthly-review-cycle-controls", "");
    for (const action of cycle.actions) {
      const button = node(doc, "button", "", `Select ${action.name}`);
      button.type = "button";
      button.addEventListener("click", () => onSelect?.(action.id));
      choices.append(button, node(doc, "p", "monthly-review-comparison", action.scope));
    }
    root.append(choices);
  } else if (["incompatible", "no_valid_comparison"].includes(cycle.status)) {
    const reset = node(doc, "button", "", "Reset demo action");
    reset.type = "button";
    reset.addEventListener("click", () => onReset?.());
    root.append(reset);
  }
  root.append(node(doc, "p", "monthly-review-boundary",
    "Stored locally: selected synthetic action ID only. Provider exports, HRIS data, credentials, prompts, and customer data are rejected from this cycle."));
  return root;
}
