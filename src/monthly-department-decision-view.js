import {
  MONTHLY_DECISION_STATE, monthlyDepartmentDecision,
} from "./monthly-department-decision.js";

export const MONTHLY_DECISION_SECTION_ID = "monthly-department-decision";

const byId = (doc, id) => doc?.getElementById?.(id) ?? null;
function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const money = (value) => `$${value.toLocaleString("en-US", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})}`;

function answer(doc, number, question, ...content) {
  const block = element(doc, "section", "monthly-decision-answer");
  block.append(
    element(doc, "p", "eyebrow", `Decision ${number}`),
    element(doc, "h3", "monthly-decision-question", question),
    ...content,
  );
  return block;
}

export function applyMonthlyDepartmentDecision(doc, pack, options = {}) {
  const section = byId(doc, MONTHLY_DECISION_SECTION_ID);
  if (!section) return null;
  const decision = monthlyDepartmentDecision(pack, options);
  const body = byId(doc, "monthly-department-decision-body");
  section.hidden = !decision.department;
  section.dataset.state = decision.state;
  if (!body || section.hidden) return decision;

  const first = decision.state === MONTHLY_DECISION_STATE.insufficient
    ? element(doc, "p", "monthly-decision-refusal",
      "Create no trackable action. This finding does not have enough evidence.")
    : element(doc, "p", "monthly-decision-action",
      `${decision.action.label} — owner: ${decision.ownerLabel}.`);
  if (decision.tracking) first.append(
    element(doc, "span", "monthly-decision-tracking",
      ` Already tracked: ${decision.tracking.status} (${decision.tracking.reference}).`),
  );

  const measurement = decision.baseline
    ? element(doc, "dl", "monthly-decision-metric")
    : element(doc, "p", "monthly-decision-refusal",
      `Missing evidence: ${decision.missingEvidence.map((item) => item.evidence).join("; ")}.`);
  if (decision.baseline) {
    for (const [term, detail] of [
      ["Baseline", `${money(decision.baseline.value)} · ${decision.baseline.unit}`],
      ["Aggregation", decision.baseline.aggregation],
      ["Period", decision.baseline.period],
      ["Calculation", decision.baseline.calculation],
      ["Target", `${money(decision.target.value)} · ${decision.target.unit} by ${decision.target.deadline}`],
      ["Target calculation", decision.target.calculation],
      ["Review period", decision.reviewPeriod],
    ]) {
      const row = element(doc, "div");
      row.append(element(doc, "dt", null, term), element(doc, "dd", null, detail));
      measurement.append(row);
    }
  }

  const confidence = element(doc, "p", "monthly-decision-confidence",
    `${decision.confidence.value}: ${decision.confidence.meaning} ${decision.confidence.reasons.join(" ")}`);
  const evidence = element(doc, "details", "monthly-decision-evidence");
  const references = decision.evidenceReferences.length
    ? decision.evidenceReferences : decision.missingEvidence.map((item) => `missing:${item.code}`);
  const summary = element(doc, "summary", null,
    `Show ${references.length} evidence reference${references.length === 1 ? "" : "s"}`);
  const evidenceList = element(doc, "ul");
  for (const reference of references) evidenceList.append(element(doc, "li", null, reference));
  evidence.append(summary, evidenceList);

  body.replaceChildren(
    answer(doc, 1, decision.questionOrder[0], first),
    answer(doc, 2, decision.questionOrder[1], measurement),
    answer(doc, 3, decision.questionOrder[2], confidence, evidence),
    answer(doc, 4, decision.questionOrder[3],
      element(doc, "p", "monthly-decision-next", decision.localNextStep)),
  );
  return decision;
}
