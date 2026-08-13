// The one renderer for the Evolution answer region (#1699).
//
// It writes what src/evolution-finding-contract.js decided and derives nothing.
// Every sentence below comes off the record, including the modelled-vs-realized
// distinction: a view that printed that as its own literal would keep printing
// it after the contract stopped meaning it.

import { CTO_QUESTION } from "./evolution-finding-contract.js";

const set = (doc, id, value) => {
  const node = doc.getElementById(id);
  if (node) node.textContent = value;
  return node;
};

/** Render the contract into the existing Evolution entry point. */
export function renderEvolutionFinding(doc, finding) {
  set(doc, "finops-recoverable-question", finding?.question ?? CTO_QUESTION);
  const benchmark = finding?.primaryBenchmark;
  const stated = Boolean(benchmark?.available);
  const figure = doc.getElementById("finops-recoverable-figure");
  if (figure) {
    figure.dataset.primaryBenchmark = "true";
    figure.dataset.metricId = benchmark?.id ?? "unavailable";
    figure.dataset.currency = benchmark?.currency ?? "USD";
    figure.dataset.unit = benchmark?.unit ?? "USD/month";
    figure.dataset.available = stated ? "true" : "false";
    // Scope rides the figure. Left at the authored counts these would claim
    // five scored departments under a figure that could not be stated.
    figure.dataset.scoredDepartments = String(benchmark?.scoredDepartments ?? 0);
    figure.dataset.totalDepartments = String(benchmark?.totalDepartments ?? 0);
  }
  set(doc, "finops-recoverable-label", "Modelled recoverable AI spend · USD per month");
  set(doc, "finops-recoverable-value", stated ? benchmark.display : "Not stated");
  set(doc, "finops-recoverable-basis", stated
    ? `${benchmark.scope} ${finding.realizedSavings.statement}`
    : "No modelled recoverable-spend benchmark is available for this document.");

  const action = doc.getElementById("finops-recoverable-action");
  if (action) {
    action.dataset.nextAction = "true";
    action.textContent = finding?.nextAction?.statement ?? "No action can be ranked";
    action.setAttribute("href", finding?.nextAction?.href ?? "#local-import");
  }
  return figure;
}
