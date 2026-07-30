import {
  MONTHLY_DECISION_STATE, monthlyDepartmentDecision,
} from "./monthly-department-decision.js";
import {
  browserFinopsWorkspaceStorage, readRetainedCommitments, retainApprovedCommitment,
} from "./finops-workspace.js";
import { restoreFinopsWorkspace } from "./finops-workspace-restore.js";
import { applyWorkspaceRestore } from "./finops-workspace-restore-view.js";

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

const id = (value, fallback) => String(value ?? fallback).toLowerCase()
  .replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63) || fallback;

function commitmentId(decision) {
  return id(`monthly-${decision.baseline.period}-${decision.department}-${decision.action.id}`,
    `monthly-${decision.baseline.period}`);
}

function trackedCommitment(storage, decision) {
  if (!decision.action) return null;
  const match = readRetainedCommitments(storage)
    .find((entry) => entry.commitmentId === commitmentId(decision));
  return match ? {
    department: decision.department,
    actionId: decision.action.id,
    status: "Saved for later review",
    reference: match.commitmentId,
  } : null;
}

function commitmentInput(decision, now) {
  const monthlyMinor = Math.round(decision.baseline.value * 100);
  const confidence = { high: 90, medium: 70, low: 40 }[decision.confidence.value] ?? 0;
  return {
    metadata: {
      commitmentId: commitmentId(decision),
      claim: {
        baselineMonthlyCostMinor: monthlyMinor,
        projectedMonthlyCostMinor: 0,
        monthlySavingsMinor: monthlyMinor,
        currency: "USD",
        unit: "month",
        period: decision.baseline.period,
      },
      confidence: { percent: confidence, band: decision.confidence.value },
      provenance: {
        designation: "monthly_department_decision",
        analysisPeriod: decision.baseline.period,
        recordCount: decision.evidenceReferences.length,
      },
      recommendedAction: {
        workloadId: id(decision.action.id, "monthly-action"),
        departmentId: id(decision.department, "department"),
        fromModelId: "current-routing",
        toModelId: id(decision.action.id, "proposed-routing"),
      },
    },
    periodId: `user:${decision.baseline.period}`,
    approvedAt: now.toISOString(),
  };
}

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
  const storage = options.storage === undefined ? browserFinopsWorkspaceStorage() : options.storage;
  const now = options.now instanceof Date ? options.now : new Date();
  const initial = monthlyDepartmentDecision(pack, options);
  const tracking = options.tracking
    ?? (initial.action ? trackedCommitment(storage, initial) : null);
  const decision = monthlyDepartmentDecision(pack, { ...options, tracking });
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

  const controls = element(doc, "div", "monthly-decision-controls");
  const outcome = element(doc, "p", "monthly-decision-outcome");
  outcome.setAttribute("role", "status");
  outcome.setAttribute("aria-live", "polite");
  const review = element(doc, "section", "monthly-decision-review");
  review.setAttribute("aria-label", "Later monthly review");

  if (decision.state === MONTHLY_DECISION_STATE.ready) {
    const commit = element(doc, "button", "monthly-decision-commit", "Track this action");
    commit.type = "button";
    const decline = element(doc, "button", "monthly-decision-decline", "Decline for this month");
    decline.type = "button";
    commit.addEventListener("click", () => {
      const result = retainApprovedCommitment(storage, commitmentInput(decision, now), { now });
      outcome.textContent = result.ok
        ? "Action saved in this browser. It is awaiting a compatible later analysis; no savings have been realized or verified."
        : `${result.message} Choose “Local workspace” to allow browser-only retention, then return here.`;
      outcome.dataset.state = result.ok ? "saved" : "not-saved";
      if (result.ok) {
        commit.disabled = true;
        decline.disabled = true;
        applyWorkspaceRestore(doc, restoreFinopsWorkspace(storage, { now }));
      }
    });
    decline.addEventListener("click", () => {
      commit.disabled = true;
      decline.disabled = true;
      outcome.dataset.state = "declined";
      outcome.textContent = "Declined for this month. No tracking record was created and no savings are claimed.";
    });
    controls.append(commit, decline,
      Object.assign(element(doc, "a", "monthly-decision-workspace", "Review local storage settings"), {
        href: "/workspace.html#finops-workspace-preview",
      }));
  } else if (decision.state === MONTHLY_DECISION_STATE.tracked) {
    outcome.dataset.state = "saved";
    outcome.textContent = "Saved action awaiting a compatible later analysis. A saved target is not a realized saving.";
  }

  if (decision.state === MONTHLY_DECISION_STATE.tracked) {
    const restored = restoreFinopsWorkspace(storage, { now });
    const trend = restored.available ? restored.trend : null;
    review.dataset.state = trend?.available ? "comparable"
      : trend?.reason === "contract_changed" ? "non-comparable" : "awaiting";
    review.append(
      element(doc, "p", "eyebrow", trend?.available ? "Later review · rank 1" : "Later review"),
      element(doc, "h4", null, trend?.available
        ? `Baseline versus current: analyzed spend went ${trend.direction}`
        : trend?.reason === "contract_changed"
          ? "This later analysis is not comparable"
          : "Waiting for a compatible later analysis"),
      element(doc, "p", null, trend?.statement
        ?? "Run and retain a later monthly analysis to compare analyzed spend. No realized savings are available."),
      element(doc, "p", "monthly-decision-review-boundary",
        "This comparison ranks analyzed-spend movement only. It does not measure, attribute, or verify savings from this action."),
    );
  }

  body.replaceChildren(
    answer(doc, 1, decision.questionOrder[0], first),
    answer(doc, 2, decision.questionOrder[1], measurement),
    answer(doc, 3, decision.questionOrder[2], confidence, evidence),
    answer(doc, 4, decision.questionOrder[3],
      element(doc, "p", "monthly-decision-next", decision.localNextStep),
      controls, outcome, ...(decision.state === MONTHLY_DECISION_STATE.tracked ? [review] : [])),
  );
  return decision;
}
