// Paints the canonical answer inside the existing AI FinOps analysis region.
//
// It derives nothing. Every figure below is a field of the record
// `resolveFinopsAnswer` returned, and a withheld record clears the three slots a
// leader would otherwise read as an answer — the annual figure, the percentage
// and the prioritized action — rather than dimming them or leaving stale text.
//
// No new control: this region sits above the first-run region, whose tab order
// is already at capacity, so the supporting detail is plain text rather than a
// disclosure a reader would have to focus.
import { ANSWER_STATUS } from "./finops-answer-contract.js";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0,
});

const set = (doc, id, text) => {
  const node = doc.getElementById(id);
  if (node) node.textContent = text;
  return node;
};

const money = (value, unit) => (unit === "USD" ? USD.format(value) : `${value} ${unit}`);

const named = (ids) => (ids?.length ? ids.join(", ") : "none");

/**
 * @param doc the document holding `#finops-answer`.
 * @param answer a `finops-answer-contract/1.0.0` record, or null when the
 *   analysis itself failed to load.
 * @returns the region, or null when the page does not carry one.
 */
export function renderFinopsAnswer(doc, answer) {
  const region = doc.getElementById("finops-canonical-answer");
  if (!region) return null;
  const withheld = !answer || answer.status !== ANSWER_STATUS.answered;
  region.dataset.status = withheld ? ANSWER_STATUS.withheld : ANSWER_STATUS.answered;
  region.dataset.reason = answer?.withheldReason?.code ?? (answer ? "none" : "missing-input");

  const figure = doc.getElementById("finops-canonical-answer-figure");
  if (figure) {
    figure.dataset.available = withheld ? "false" : "true";
    figure.textContent = withheld ? ""
      : `${USD.format(answer.annualSavingsUsd)} a year — ${answer.savingsPercent}% of the`
        + ` ${USD.format(answer.annualBaselineSpendUsd)} analyzed baseline. Modelled from`
        + " invented records, not a realized saving.";
  }

  const benchmark = answer?.benchmark;
  set(doc, "finops-canonical-answer-benchmark", withheld || !benchmark ? ""
    : `Supported by ${benchmark.label} at ${money(benchmark.value, benchmark.unit)}.`);
  set(doc, "finops-canonical-answer-action", withheld ? ""
    : `Do this first: ${answer.primaryAction.label}`
      + `${answer.primaryAction.department ? ` in ${answer.primaryAction.department}` : ""}`
      + ` — ${USD.format(answer.primaryAction.monthlySavingsUsd)} a month.`);

  set(doc, "finops-canonical-answer-reason", withheld
    ? (answer?.withheldReason?.sentence
      ?? "The bundled analysis did not load, so no answer is stated.")
    : "");

  const sources = answer?.sources ?? {};
  set(doc, "finops-canonical-answer-sources", withheld
    ? `Signals still trusted — confidence: ${answer?.confidence
      ? `${answer.confidence.level} (${answer.confidence.value}/100) from ${named(sources.confidence)}`
      : "none"}; readiness: ${answer?.readiness
      ? `${answer.readiness.state} from ${named(sources.readiness)}` : "none"}; benchmark:`
      + ` ${benchmark ? `${benchmark.label} from ${named(sources.benchmark)}` : "none"}.`
    : `Figure from ${named(sources.annualSavingsUsd)} × 12; share also from`
      + ` ${named(sources.savingsPercent).split(", ").pop()}; benchmark from`
      + ` ${named(sources.benchmark)}; action from ${named(sources.primaryAction)};`
      + ` confidence ${answer.confidence.level} from ${named(sources.confidence)};`
      + ` readiness ${answer.readiness.state} from ${named(sources.readiness)}.`);
  return region;
}
