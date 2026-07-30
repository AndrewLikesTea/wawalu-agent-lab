import {
  MONTHLY_DECISION_STATE, monthlyDepartmentDecision,
} from "./monthly-department-decision.js";
import {
  browserFinopsWorkspaceStorage, readRetainedCommitments, retainApprovedCommitment,
} from "./finops-workspace.js";
import { restoreFinopsWorkspace } from "./finops-workspace-restore.js";
import { applyWorkspaceRestore } from "./finops-workspace-restore-view.js";
import {
  compareMonthlyAction, readMonthlyAction, writeMonthlyAction,
} from "./monthly-department-action-store.js";

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
const minorMoney = (value) => money(Math.round(Number(value)) / 100);

// One name per state, everywhere: the control says "Track this action", so every
// state that follows it says "Tracked" — never "committed" or "saved", which the
// storage layer uses for its records rather than for the reader.
const STATE_PRESENTATION = Object.freeze({
  tracked: Object.freeze({ shape: "✓", label: "Tracked", tone: "saved" }),
  declined: Object.freeze({ shape: "–", label: "Declined this month", tone: "declined" }),
  "not-tracked": Object.freeze({ shape: "!", label: "Not tracked", tone: "error" }),
  awaiting: Object.freeze({ shape: "○", label: "Awaiting analysis", tone: "awaiting" }),
  comparable: Object.freeze({ shape: "↔", label: "Comparable result", tone: "comparable" }),
  "non-comparable": Object.freeze({
    shape: "≠", label: "Not comparable", tone: "non-comparable",
  }),
  loading: Object.freeze({ shape: "…", label: "Loading monthly action", tone: "loading" }),
  empty: Object.freeze({ shape: "○", label: "No monthly action", tone: "empty" }),
  error: Object.freeze({ shape: "!", label: "Monthly action unavailable", tone: "error" }),
  "check-figure": Object.freeze({ shape: "!", label: "Check this figure", tone: "error" }),
  // Named from the contract's own rating, so the page never asserts a confidence
  // level the producer declined to score.
  "confidence-high": Object.freeze({ shape: "●", label: "High confidence", tone: "comparable" }),
  "confidence-medium": Object.freeze({
    shape: "◐", label: "Medium confidence", tone: "awaiting",
  }),
  "confidence-low": Object.freeze({ shape: "◔", label: "Low confidence", tone: "non-comparable" }),
  "confidence-not-scored": Object.freeze({
    shape: "?", label: "Confidence not scored", tone: "error",
  }),
});

const id = (value, fallback) => String(value ?? fallback).toLowerCase()
  .replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63) || fallback;

function commitmentId(decision) {
  return id(`monthly-${decision.baseline.period}-${decision.department}-${decision.action.id}`,
    `monthly-${decision.baseline.period}`);
}

function trackedCommitment(storage, decision) {
  if (!decision.action) return null;
  const local = readMonthlyAction(storage);
  if (local.record?.department === decision.department
    && local.record.actionId === decision.action.id) {
    return {
      department: decision.department,
      actionId: decision.action.id,
      status: "Saved for later review",
      reference: local.record.actionId,
    };
  }
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

/** Paint a node as a named state: shape for sighted scanning, name for everyone. */
function announce(doc, node, state, text) {
  const presentation = STATE_PRESENTATION[state];
  node.dataset.state = presentation.tone;
  const shape = element(doc, "span", "monthly-decision-status-shape", presentation.shape);
  shape.setAttribute("aria-hidden", "true");
  node.replaceChildren(shape, element(doc, "strong", null, presentation.label),
    doc.createTextNode(` — ${text}`));
  return node;
}

const statusLine = (doc, state, text) =>
  announce(doc, element(doc, "p", "monthly-decision-status"), state, text);

function unavailableView(doc, section, body, phase) {
  const copy = {
    loading: "Analysis is still running. The recommendation and controls will appear here when it finishes.",
    empty: "No department finding yet. Run a local analysis to get this month's recommended action.",
    error: "The local analysis could not be read. Review the import error and run it again; no action was created.",
  }[phase];
  section.hidden = false;
  section.dataset.state = phase;
  section.setAttribute("aria-busy", phase === "loading" ? "true" : "false");
  const announcement = statusLine(doc, phase, copy);
  announcement.setAttribute("role", "status");
  announcement.setAttribute("aria-live", "polite");
  announcement.setAttribute("aria-atomic", "true");
  body.replaceChildren(
    announcement,
    element(doc, "p", "monthly-decision-boundary",
      "Files and prompt text stay in this tab. Nothing here makes a network request or is stored."),
  );
}

export function applyMonthlyDepartmentDecision(doc, pack, options = {}) {
  const section = byId(doc, MONTHLY_DECISION_SECTION_ID);
  if (!section) return null;
  const body = byId(doc, "monthly-department-decision-body");
  const phase = ["loading", "empty", "error"].includes(options.phase)
    ? options.phase : "ready";
  if (phase !== "ready") {
    if (body) unavailableView(doc, section, body, phase);
    return null;
  }
  const storage = options.storage === undefined ? browserFinopsWorkspaceStorage() : options.storage;
  const now = options.now instanceof Date ? options.now : new Date();
  const initial = monthlyDepartmentDecision(pack, options);
  const tracking = options.tracking
    ?? (initial.action ? trackedCommitment(storage, initial) : null);
  const decision = monthlyDepartmentDecision(pack, { ...options, tracking });
  section.hidden = !decision.department;
  section.dataset.state = decision.state;
  section.setAttribute("aria-busy", "false");
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
    ? element(doc, "div", "monthly-decision-measurement")
    : element(doc, "p", "monthly-decision-refusal",
      `Missing evidence: ${decision.missingEvidence.map((item) => item.evidence).join("; ")}.`);
  if (decision.baseline) {
    const headline = element(doc, "p", "monthly-decision-figure");
    headline.append(
      element(doc, "span", "monthly-decision-figure-label", "Baseline"),
      element(doc, "strong", "monthly-decision-figure-value", money(decision.baseline.value)),
      element(doc, "span", "monthly-decision-figure-unit", decision.baseline.unit),
    );
    measurement.append(headline);
    if (decision.baseline.value >= 1_000_000_000) {
      measurement.append(statusLine(doc, "check-figure",
        "This baseline is larger than any plausible monthly spend. Confirm the source import "
          + "and its monthly unit before you track it."));
    }
    const facts = element(doc, "dl", "monthly-decision-metric");
    for (const [term, detail] of [
      ["Aggregation", decision.baseline.aggregation],
      ["Period", decision.baseline.period],
      ["Calculation", decision.baseline.calculation],
      ["Target", `${money(decision.target.value)} · ${decision.target.unit} by ${decision.target.deadline}`],
      ["Target calculation", decision.target.calculation],
      ["Review period", decision.reviewPeriod],
    ]) {
      const row = element(doc, "div");
      row.append(element(doc, "dt", null, term), element(doc, "dd", null, detail));
      facts.append(row);
    }
    measurement.append(facts);
  }

  const confidence = statusLine(doc,
    `confidence-${decision.confidence.value.replace("_", "-")}`,
    `${decision.confidence.meaning} ${decision.confidence.reasons.join(" ")}`);
  confidence.className += " monthly-decision-confidence";
  const provenance = element(doc, "p", "monthly-decision-provenance",
    `Provenance: ${decision.evidenceReferences.length} reference`
      + `${decision.evidenceReferences.length === 1 ? "" : "s"} derived in this browser from the `
      + `${decision.baseline?.period ?? "unavailable"} analysis period. No source file is kept.`);
  const evidence = element(doc, "details", "monthly-decision-evidence");
  evidence.id = `${MONTHLY_DECISION_SECTION_ID}-evidence`;
  const references = decision.evidenceReferences.length
    ? decision.evidenceReferences : decision.missingEvidence.map((item) => `missing:${item.code}`);
  const summary = element(doc, "summary", null,
    `Show ${references.length} evidence reference${references.length === 1 ? "" : "s"}`);
  const evidenceList = element(doc, "ul");
  for (const reference of references) evidenceList.append(element(doc, "li", null, reference));
  evidence.append(summary, evidenceList);

  const controls = element(doc, "div", "monthly-decision-controls");
  const outcome = element(doc, "p", "monthly-decision-status monthly-decision-outcome");
  outcome.setAttribute("role", "status");
  outcome.setAttribute("aria-live", "polite");
  outcome.setAttribute("aria-atomic", "true");
  // The later review is rendered once with the page, not repainted in place, so it
  // is a named landmark rather than a live region: a screen-reader user reaches it
  // by name instead of hearing the whole block read out on load.
  const review = element(doc, "section", "monthly-decision-review");

  if (decision.state === MONTHLY_DECISION_STATE.ready) {
    const commit = element(doc, "button", "monthly-decision-commit", "Track this action");
    commit.type = "button";
    const implausible = decision.baseline.value >= 1_000_000_000;
    commit.disabled = implausible;
    if (implausible) commit.textContent = "Confirm the source before tracking";
    const decline = element(doc, "button", "monthly-decision-decline", "Decline for this month");
    decline.type = "button";
    commit.addEventListener("click", () => {
      const result = retainApprovedCommitment(storage, commitmentInput(decision, now), { now });
      const actionResult = result.ok ? writeMonthlyAction(storage, decision, { now }) : null;
      if (result.ok && actionResult.ok) {
        announce(doc, outcome, "tracked", "Kept in this browser and awaiting a compatible later "
          + "analysis. Nothing is proven yet: no saving has been realized or verified.");
      } else {
        const message = result.ok
          ? "The commitment was kept, but the monthly action could not be restored from storage."
          : result.message;
        announce(doc, outcome, "not-tracked", `${message} Choose “Local workspace” to `
          + "allow browser-only retention, then return here.");
      }
      if (result.ok) {
        commit.disabled = true;
        decline.disabled = true;
        applyWorkspaceRestore(doc, restoreFinopsWorkspace(storage, { now }));
      }
    });
    decline.addEventListener("click", () => {
      commit.disabled = true;
      decline.disabled = true;
      announce(doc, outcome, "declined",
        "No tracking record was created and no savings are claimed.");
    });
    controls.append(commit, decline,
      ...(implausible ? [Object.assign(
        element(doc, "a", "monthly-decision-source", "Review the source import"),
        { href: "#local-import-title" },
      )] : []),
      Object.assign(element(doc, "a", "monthly-decision-workspace", "Review local storage settings"), {
        href: "/workspace.html#finops-workspace-preview",
      }));
  } else if (decision.state === MONTHLY_DECISION_STATE.tracked) {
    announce(doc, outcome, "tracked",
      "Kept in this browser. This target is unproven and is not a realized saving.");
  }

  if (decision.state === MONTHLY_DECISION_STATE.tracked) {
    const restored = restoreFinopsWorkspace(storage, { now });
    const storedAction = readMonthlyAction(storage);
    const comparison = storedAction.record
      ? compareMonthlyAction(storedAction.record, initial) : null;
    const trend = restored.available ? restored.trend : null;
    const reviewState = comparison?.comparable ? "comparable"
      : comparison?.status === "awaiting_later_analysis" || !storedAction.record
        ? "awaiting" : "non-comparable";
    review.dataset.state = reviewState;
    review.setAttribute("aria-label",
      `Later monthly review: ${STATE_PRESENTATION[reviewState].label}`);
    const comparisonList = element(doc, "dl", "monthly-decision-comparison");
    for (const [term, value] of [
      ["Committed baseline", comparison?.baseline == null ? "Not available" : money(comparison.baseline)],
      ["Current result", comparison?.current == null ? "Not comparable" : money(comparison.current)],
      ["Comparison status", STATE_PRESENTATION[reviewState].label],
    ]) {
      const row = element(doc, "div");
      row.append(element(doc, "dt", null, term), element(doc, "dd", null, value));
      comparisonList.append(row);
    }
    review.append(
      statusLine(doc, reviewState, comparison?.comparable
        ? "The committed baseline and current result use the same decision and metric contract."
        : reviewState === "non-comparable"
          ? "The current analysis does not use the committed action and metric contract."
          : "A compatible later monthly analysis is required."),
      element(doc, "h4", null, comparison?.comparable
        ? `Baseline versus current: ${money(comparison.baseline)} to ${money(comparison.current)}`
        : reviewState === "non-comparable" ? "This later analysis is not comparable"
          : "Waiting for a compatible later analysis"),
      element(doc, "p", null, comparison?.comparable
        ? `The current result changed by ${money(Math.abs(comparison.change))} from the committed baseline.`
        : trend?.statement
          ?? "Run a compatible later monthly analysis. No realized savings are available."),
      comparisonList,
      element(doc, "p", "monthly-decision-review-boundary",
        "Result type: unproven metric movement. This does not measure, attribute, or verify savings from this action."),
    );
  }

  body.replaceChildren(
    answer(doc, 1, decision.questionOrder[0], first),
    answer(doc, 2, decision.questionOrder[1], measurement),
    answer(doc, 3, decision.questionOrder[2], confidence, provenance, evidence),
    answer(doc, 4, decision.questionOrder[3],
      element(doc, "p", "monthly-decision-next", decision.localNextStep),
      controls, outcome, ...(decision.state === MONTHLY_DECISION_STATE.tracked ? [review] : [])),
  );
  return decision;
}
