const STATUS_LABELS = Object.freeze({
  unavailable_measurement: "Measurement unavailable",
  ambiguous_variance: "Decision support limited",
  material_shortfall: "Material annual shortfall",
  verified_delivery: "Verified delivery",
});

const MONTH = new Intl.DateTimeFormat("en-US", {
  month: "long", year: "numeric", timeZone: "UTC",
});
const USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function money(value, missing = "Not measured") {
  return Number.isFinite(value) ? USD.format(value) : missing;
}

function monthLabel(value) {
  return MONTH.format(new Date(`${value}-01T00:00:00Z`));
}

function fact(list, label, value) {
  const item = el("div", "sac-fact");
  item.append(el("dt", undefined, label), el("dd", undefined, value));
  list.append(item);
}

export function renderSavingsActionCenter(model) {
  const finding = model.finding;
  if (!finding) {
    const empty = el("section", "sac-state");
    empty.setAttribute("role", "status");
    empty.append(el("h2", undefined, "No monthly finding available"),
      el("p", undefined, "There are no reconciled actions in the current reporting window."));
    return empty;
  }

  const { action, record, adjudication, decision, adjudicationReference } = finding;
  const article = el("article", "sac-focus");
  article.setAttribute("aria-labelledby", "sac-finding-title");

  const heading = el("header", "sac-heading");
  heading.append(
    el("p", "sac-kicker", `Priority finding · ${monthLabel(record.measurementMonth)}`),
    el("h2", undefined, action.title),
    el("p", "sac-owner", `${action.department.name} · ${action.accountableOwner.role}`),
  );
  heading.children[1].id = "sac-finding-title";

  const status = el("p", "sac-status",
    STATUS_LABELS[adjudication.status] ?? "Review status unavailable");
  status.dataset.status = adjudication.status;

  const metrics = el("dl", "sac-metrics");
  fact(metrics, "Monthly projection", money(record.projectionBaseline.monthlySavingsUsd));
  fact(metrics, "Simulated realized", money(record.simulatedRealizedSavingsUsd));
  fact(metrics, "Measured variance", Number.isFinite(record.varianceUsd)
    ? `${record.varianceUsd >= 0 ? "+" : "−"}${money(Math.abs(record.varianceUsd))}`
    : "Not available");
  fact(metrics, "Confidence", `${Math.round(action.confidence * 100)}% · ${adjudication.confidenceLevel}`);

  const decisionBlock = el("section", "sac-decision");
  decisionBlock.setAttribute("aria-labelledby", "sac-decision-title");
  const decisionTitle = el("h3", undefined, decision.label);
  decisionTitle.id = "sac-decision-title";
  decisionBlock.append(el("p", "sac-kicker", "Recommended decision"), decisionTitle,
    el("p", undefined, decision.rationale));

  const links = el("div", "sac-links");
  const portfolioLink = el("a", "sac-primary-link", "Inspect action and lifecycle");
  portfolioLink.setAttribute("href", "/evolution.html#portfolio-title");
  links.append(portfolioLink);

  const details = el("details", "sac-details");
  const summary = el("summary", undefined, "Review monthly evidence and lifecycle context");
  const body = el("div", "sac-details-body");
  const context = el("dl", "sac-context");
  fact(context, "Monthly availability",
    record.availabilityReason === "measurement-pending"
      ? "Measurement pending from accountable owner"
      : record.availabilityState);
  fact(context, "Monthly provenance",
    `${record.evidenceProvenance.source} · ${record.evidenceProvenance.evidenceRefs.join(", ") || "no evidence reference"}`);
  fact(context, "Annual lifecycle adjudication", adjudication.varianceReason);
  fact(context, "Decision-policy fixture",
    adjudicationReference
      ? `${adjudicationReference.fixtureId} · ${adjudicationReference.explanation}`
      : "No matching adjudication fixture");

  const timeline = el("ol", "sac-timeline");
  for (const transition of action.lifecycleTransitions) {
    const item = el("li", undefined,
      `${transition.state.replace("-", " ")} · ${transition.transitionedDate}`);
    if (transition.state === action.lifecycleState) item.setAttribute("aria-current", "step");
    timeline.append(item);
  }
  body.append(context, el("h3", undefined, "Lifecycle history"), timeline,
    el("p", "sac-contracts",
      `${model.schemaVersions.portfolio} · ${model.schemaVersions.reconciliation} · ${model.schemaVersions.adjudication}`));
  details.append(summary, body);

  article.append(heading, status, metrics, decisionBlock, links, details);
  return article;
}

export function renderSavingsActionCenterError() {
  const error = el("section", "sac-state");
  error.setAttribute("role", "alert");
  error.append(el("h2", undefined, "Monthly savings review unavailable"),
    el("p", undefined,
      "The bundled contracts could not be reconciled. No savings decision is shown."));
  return error;
}
