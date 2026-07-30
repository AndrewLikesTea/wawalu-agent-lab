// The static monthly decision made from one existing department fix-pack.
//
// This contract is intentionally narrower than the fix-pack. It answers four
// executive questions, in order, and excludes forecasts, realized-savings
// claims, cross-department comparisons, people, prompt text and persistence.

import { EXCLUSION_REASONS, UNPRICED_REASONS } from "./department-fix-pack.js";

export const MONTHLY_DECISION_VERSION = "monthly-department-decision/1.0.0";

export const MONTHLY_DECISION_STATE = Object.freeze({
  ready: "ready_to_track",
  insufficient: "insufficient_evidence",
  tracked: "already_tracked",
});

export const CONFIDENCE = Object.freeze({
  high: Object.freeze({
    value: "high",
    meaning: "The action is priced from direct department evidence and no confidence factor lowered it.",
  }),
  medium: Object.freeze({
    value: "medium",
    meaning: "The action is priced, but one or more named evidence limitations could change its size or priority.",
  }),
  low: Object.freeze({
    value: "low",
    meaning: "The finding is directional; material evidence limitations make the size or priority unstable.",
  }),
  not_scored: Object.freeze({
    value: "not_scored",
    meaning: "Required evidence is missing, so confidence in a trackable action is not scored.",
  }),
});

const OWNER = Object.freeze({
  routing: "AI Platform product owner",
  rewrite: "Department technical lead",
  training: "Department engineering manager",
});

// Keyed off the producer's own exported codes rather than off copies of their
// spellings, so a rename upstream is a resolvable reference here instead of a
// silent fall-through to the generic `Evidence required by rule ...` prose.
// `tests/monthly-department-decision.test.js` asserts full coverage of both sets;
// the runtime keeps the fallback, because a missing gloss must not blank a page.
export const MISSING_EVIDENCE = Object.freeze({
  [UNPRICED_REASONS.noMonthlySpendBasis]: "A department-level monthly spend basis in USD",
  [UNPRICED_REASONS.noRoutingAnalysis]: "A department-level model-routing analysis",
  [UNPRICED_REASONS.routingInsufficientData]:
    "Enough eligible routing rows to price the routing delta",
  [UNPRICED_REASONS.noRecoverableSpend]:
    "A positive eligible row-level recoverable-spend delta",
  [EXCLUSION_REASONS.departmentNotGraded]: "Enough classified prompts for a department grade",
  [EXCLUSION_REASONS.signalDidNotFire]: "A qualifying recoverable pattern",
  no_department_selected: "A selected department finding",
  insufficient_evidence: "Enough classified, attributed prompts to prioritize one pattern",
});

const ACTION_BY_STATE = Object.freeze({
  [MONTHLY_DECISION_STATE.insufficient]:
    "Collect the missing evidence locally, rerun the same analysis, and create no trackable action yet.",
  [MONTHLY_DECISION_STATE.tracked]:
    "Update the existing tracking record at the review date; do not create a duplicate.",
});

const frozen = (value) => Object.freeze(value);
const list = (value) => (Array.isArray(value) ? value : []);

export function monthlyCycle(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const period = `${year}-${String(month + 1).padStart(2, "0")}`;
  const deadline = new Date(Date.UTC(year, month + 1, 0)).toISOString().slice(0, 10);
  const review = new Date(Date.UTC(year, month + 1, 1));
  return frozen({
    period,
    deadline,
    reviewPeriod: `${review.getUTCFullYear()}-${String(review.getUTCMonth() + 1).padStart(2, "0")}`,
  });
}

function confidenceOf(lead) {
  const key = String(lead?.confidence?.level ?? "").toLowerCase();
  const scale = CONFIDENCE[key] ?? CONFIDENCE.low;
  const reasons = [
    ...list(lead?.confidence?.reasons),
    ...list(lead?.confidence?.inheritedReasons),
  ].map((reason) => reason?.detail).filter((detail) => typeof detail === "string");
  return frozen({
    ...scale,
    reasons: frozen(reasons.length ? reasons : [
      scale.value === "high"
        ? "No confidence factor lowered this finding."
        : "The producer supplied no confidence explanation.",
    ]),
  });
}

function evidenceOf(pack, lead) {
  const provenance = lead?.provenance ?? {};
  return frozen([
    ...list(provenance.evidence),
    `fix-pack:${provenance.fixPackVersion ?? pack?.version ?? "unstated"}`,
    `rubric:${provenance.rubricVersion ?? "unstated"}`,
    `classifier:${provenance.classifierVersion ?? "unstated"}`,
  ].filter((value, index, all) => typeof value === "string" && all.indexOf(value) === index));
}

function missingOf(pack, lead) {
  const codes = [
    pack?.reasonCode,
    lead?.savings?.unpricedReasonCode,
    ...(lead ? [] : list(pack?.excluded).map((row) => row?.reasonCode)),
  ].filter(Boolean);
  if (!lead && !codes.length) codes.push("insufficient_evidence");
  return frozen([...new Set(codes)].map((code) =>
    frozen({ code, evidence: MISSING_EVIDENCE[code] ?? `Evidence required by rule ${code}` })));
}

function baselineOf(pack, lead, cycle) {
  return frozen({
    name: "Estimated avoidable AI spend in the prioritized department pattern",
    value: lead.monthlySavingsUsd,
    unit: "USD/month",
    aggregation: "Sum of eligible row-level recoverable-spend deltas for the prioritized pattern; unpriced rows are excluded, never treated as zero.",
    period: cycle.period,
    calculation: lead.savings?.basis === "down_routing_delta"
      ? "For each eligible model row: actual monthly USD minus projected monthly USD at the proposed tier; floor each row at 0, then sum."
      : "Department monthly spend USD × prioritized signal share × rubric recoverability; round once to two decimal places after multiplication.",
  });
}

/**
 * Convert one existing department finding to the consumed monthly contract.
 *
 * `tracking` is read-only caller evidence. Matching requires both department
 * and action id; a same-named action elsewhere is not a duplicate.
 */
export function monthlyDepartmentDecision(pack, {
  cycle = monthlyCycle(),
  tracking = null,
} = {}) {
  const lead = pack?.state === "ready" ? list(pack.interventions)[0] : null;
  const priced = Number.isFinite(lead?.monthlySavingsUsd) && lead.monthlySavingsUsd > 0;
  // Insufficient evidence outranks a tracking match, and a match needs a named
  // action id on both sides. Otherwise a record carrying no `actionId` matches a
  // withheld or unpriced finding on department alone, and this reports a tracked
  // action it cannot name, price, or assign — from a finding that supports none.
  const actionId = priced ? lead.action?.id ?? lead.actionId ?? null : null;
  const matchedTracking = Boolean(actionId
    && tracking?.department === pack?.department
    && tracking.actionId === actionId);
  const state = !priced ? MONTHLY_DECISION_STATE.insufficient
    : matchedTracking ? MONTHLY_DECISION_STATE.tracked
      : MONTHLY_DECISION_STATE.ready;
  const missingEvidence = state === MONTHLY_DECISION_STATE.insufficient
    ? missingOf(pack, lead) : frozen([]);

  return frozen({
    version: MONTHLY_DECISION_VERSION,
    state,
    department: pack?.department ?? null,
    questionOrder: frozen([
      "What action should we track this month?",
      "What baseline and target make it trackable?",
      "How confident are we and why?",
      "What should happen locally next?",
    ]),
    action: priced ? frozen({
      id: actionId,
      label: lead.action?.name ?? "Prioritized department action",
      priority: 1,
    }) : null,
    tracking: state === MONTHLY_DECISION_STATE.tracked ? frozen({
      status: tracking.status,
      reference: tracking.reference,
    }) : null,
    baseline: priced ? baselineOf(pack, lead, cycle) : null,
    target: priced ? frozen({
      value: 0,
      unit: "USD/month remaining avoidable spend",
      deadline: cycle.deadline,
      calculation: "max(0, baseline value minus verified reduction measured with the same eligibility rules and monthly aggregation)",
    }) : null,
    ownerLabel: priced ? OWNER[lead.action?.kind] ?? "Department FinOps owner" : null,
    reviewPeriod: priced ? cycle.reviewPeriod : null,
    confidence: priced ? confidenceOf(lead) : frozen({ ...CONFIDENCE.not_scored, reasons: frozen([
      "Confidence is not scored until every missing evidence item is supplied.",
    ]) }),
    evidenceReferences: lead ? evidenceOf(pack, lead) : frozen([]),
    missingEvidence,
    localNextStep: state === MONTHLY_DECISION_STATE.ready
      ? `Record this action locally for ${cycle.period}; review it in ${cycle.reviewPeriod}.`
      : ACTION_BY_STATE[state],
    exclusion: frozen([
      "No realized-savings claim",
      "No forecast beyond the named deadline",
      "No cross-department ranking",
      "No prompt text, person, credential, integration, network request, or stored tracking mutation",
    ]),
  });
}

const READY_PACK = frozen({
  version: "department-fix-pack/1.0.0",
  state: "ready",
  department: "Atlas Platform",
  interventions: frozen([frozen({
    action: frozen({ id: "route-short-lookups", kind: "routing", name: "Route short lookups to the standard tier" }),
    monthlySavingsUsd: 1840,
    savings: frozen({ basis: "down_routing_delta", unpricedReasonCode: null }),
    confidence: frozen({ level: "high", reasons: frozen([]), inheritedReasons: frozen([]) }),
    provenance: frozen({
      fixPackVersion: "department-fix-pack/1.0.0",
      rubricVersion: "prompt-literacy/2026-05",
      classifierVersion: "query-classification/1.2.0",
      evidence: frozen(["signal:model_fit", "routing:down-routing/1.1.0"]),
    }),
  })]),
});

const EXAMPLE_CYCLE = frozen({
  period: "2026-07", deadline: "2026-07-31", reviewPeriod: "2026-08",
});

export const MONTHLY_DECISION_EXAMPLES = frozen({
  readyToTrack: monthlyDepartmentDecision(READY_PACK, { cycle: EXAMPLE_CYCLE }),
  insufficientEvidence: monthlyDepartmentDecision(frozen({
    version: "department-fix-pack/1.0.0",
    state: "withheld",
    department: "Security Engineering",
    reasonCode: "department_not_graded",
    interventions: frozen([]),
  }), { cycle: EXAMPLE_CYCLE }),
  alreadyTracked: monthlyDepartmentDecision(READY_PACK, { tracking: frozen({
    department: "Atlas Platform",
    actionId: "route-short-lookups",
    status: "On track",
    reference: "local-action-2026-07-atlas-routing",
  }), cycle: EXAMPLE_CYCLE }),
});
