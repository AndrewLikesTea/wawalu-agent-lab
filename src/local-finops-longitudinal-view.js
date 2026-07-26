import { analyzeLongitudinalFinops } from "./local-finops-longitudinal.js";

function add(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const money = (minor, currency = "USD") => minor === null ? "Non-comparable"
  : new Intl.NumberFormat("en-US", { style: "currency", currency })
    .format(minor / 100);

export function renderLongitudinalFinops(fixture) {
  const analysis = analyzeLongitudinalFinops(fixture);
  const list = document.createDocumentFragment();
  for (const finding of analysis.findings) {
    const item = add("li", "longitudinal-finding");
    const heading = add("div", "longitudinal-heading");
    heading.append(
      add("h3", undefined, `Priority ${finding.actionPriority} · ${finding.departmentId}`),
      add("span", undefined, `Confidence: ${finding.confidence}`),
    );
    const trend = finding.trend.status === "comparable"
      ? `${finding.trend.latestPercentChange}% latest period-over-period`
      : `Non-comparable trend · ${finding.trend.reason}`;
    const comparison = finding.comparison.status === "comparable"
      ? `${money(finding.latestValue, finding.currency)} latest; `
        + `${finding.comparison.percentDifference === null
          ? "relative percentage unavailable for a zero benchmark"
          : `${finding.comparison.percentDifference}%`} vs `
        + `${money(finding.comparison.benchmarkValue, finding.currency)} peer benchmark`
      : `Non-comparable benchmark · ${finding.comparison.reason}`;
    const action = finding.estimatedExcessValue > 0
      ? `Investigate ${money(finding.estimatedExcessValue, finding.currency)} of latest-period excess spend first.`
      : finding.comparison.status === "comparable"
        ? "Monitor; no latest-period excess spend is estimated."
        : "Do not rank a spend intervention until comparable evidence exists.";
    item.append(heading, add("p", undefined, trend), add("p", undefined, comparison),
      add("strong", undefined, action));
    list.append(item);
  }
  return { analysis, list };
}
