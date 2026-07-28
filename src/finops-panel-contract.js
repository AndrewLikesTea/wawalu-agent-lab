// The executive panel contract for the AI FinOps tab.
//
// One question per panel, one declared input list per panel, one threshold per
// input, and one sentence naming the single highest-value input that is still
// missing. Nothing on the page decides for itself whether a panel may show a
// figure: `panelStates` is the only answer, and it is a pure function of a flat
// record of counted facts.
//
// WHY A CONTRACT AND NOT PAGE LOGIC. Before this module the page hid every
// bundled panel the moment a provider export was imported. A leader who
// imported one invoice lost the hero grade, the spend mix, and the department
// ranking at once, and was told nothing about why or what would bring them
// back. The panels were not wrong — they were unanswerable, which is a
// different thing and has a different remedy: say which file or field answers
// them.
//
// DETERMINISM. Two engineers must derive the same panel state from the same
// import. That holds because:
//   * every requirement is `fact >= atLeast` over a counted integer or a share
//     in [0,1]; there is no free-text rule and no "and/or" nesting,
//   * a fact that is absent, non-finite, or negative is `0`, never "unknown",
//   * the highest-priority missing input is the FIRST unmet requirement in
//     declaration order, so priority is a property of this file rather than of
//     the order a reader happened to select files in.
//
// PRIVACY. Facts are counts and ratios over records the browser already parsed.
// No prompt text, customer record, credential, or network call enters this
// module, and nothing it returns carries a cell value from an imported file.

import { PROMPT_GRADING_THRESHOLDS } from "./prompt-grading-eligibility.js";
import { ATTRIBUTION_RANKED_FINDING_FLOOR } from "./finops-attribution-policy.js";

// 1.1 adds the stable machine-readable unavailable reason to requirements,
// panel states, and messages. Keep this honest: exported consumers need to be
// able to distinguish the old sentence-only shape during rollback and replay.
export const PANEL_CONTRACT_VERSION = "executive-panel-contract/1.1.0";

/**
 * The minimum scored prompts behind any grade-shaped claim.
 *
 * Not a new number: it is the published prompt-grading threshold, imported so
 * a panel cannot drift from the module that grades the prompts.
 */
export const MIN_SCORED_PROMPTS = PROMPT_GRADING_THRESHOLDS.minPromptsPerDepartment;

/**
 * The minimum attributed share behind any money-on-a-department claim.
 *
 * Also not a new number: the attribution policy's ranked-finding floor. Below
 * it the policy already refuses to publish a ranked recoverable figure, so a
 * panel built on one has to refuse with it.
 */
export const MIN_ATTRIBUTED_SHARE = ATTRIBUTION_RANKED_FINDING_FLOOR;

/** Every fact a requirement may name, with the value used when it is absent. */
export const PANEL_FACTS = Object.freeze({
  /** Provider period exports parsed into a v1 envelope. */
  providerPeriodFiles: 0,
  /** Provider rows carrying `cost.amount_minor`. */
  costedRows: 0,
  /** Provider rows carrying `org_unit_id`. */
  orgUnitRows: 0,
  /** Provider rows carrying `usage.model_raw`. */
  modelIdentifiedRows: 0,
  /** Provider rows carrying `usage.request_count`. */
  requestCountedRows: 0,
  /** Attributed spend over total spend, dollar-weighted, in [0,1]. */
  attributedShare: 0,
  /** Departments the analysis could rank after the join. */
  rankedDepartments: 0,
  /** Prompts the literacy rubric actually scored. */
  scoredPrompts: 0,
  /** Departments holding at least `MIN_SCORED_PROMPTS` scored prompts. */
  gradedDepartments: 0,
  /** Savings actions carrying a lifecycle state and a realized figure. */
  actionOutcomeRecords: 0,
  /** Recommendation evaluations available to inspect. */
  evaluationRecords: 0,
  /** Peer organizations available to compare against. */
  peerCohortRecords: 0,
});

const FILE = "file";
const FIELD = "field";

/**
 * The stable code a caller reports when one declared input is what stopped a
 * figure from being published.
 *
 * One code per fact, because the fact IS the reason: a panel is unanswerable
 * because a counted input is absent or under its threshold, and there is no
 * other way for a panel to be unanswerable. A consumer that has to explain a
 * refusal — a KPI card, a log line, an exported briefing — quotes one of these
 * rather than inventing a sentence, so the same gap is named the same way
 * everywhere it surfaces.
 *
 * These are wire values. Reword the `need` sentences freely; changing a code
 * here is a contract version bump.
 */
export const PANEL_UNAVAILABLE_REASON = Object.freeze({
  providerPeriodFiles: "no_provider_period_export",
  costedRows: "no_cost_amount_field",
  orgUnitRows: "no_org_unit_field",
  modelIdentifiedRows: "no_model_identifier_field",
  requestCountedRows: "no_request_count_field",
  attributedShare: "attributed_share_below_floor",
  rankedDepartments: "no_department_joined",
  scoredPrompts: "scored_prompts_below_floor",
  gradedDepartments: "no_graded_department",
  actionOutcomeRecords: "no_action_outcome_records",
  evaluationRecords: "no_evaluation_records",
  peerCohortRecords: "no_peer_cohort",
});

/**
 * One declared input.
 *
 * `label` names the thing a leader has to produce. `need` is the sentence they
 * are shown when it is the highest-priority one missing, and it names exactly
 * one file or one field — never a list, because a list is not a next step.
 * `reason` is the machine-readable form of the same statement.
 *
 * A requirement naming a fact with no declared reason throws at module load
 * rather than shipping a panel that can refuse without saying why.
 */
function requirement(fact, atLeast, kind, label, need) {
  const reason = PANEL_UNAVAILABLE_REASON[fact];
  if (!reason) throw new Error(`panel contract: no declared unavailable reason for fact "${fact}"`);
  return Object.freeze({ fact, atLeast, kind, label, need, reason });
}

const PROVIDER_FILE = requirement("providerPeriodFiles", 1, FILE,
  "Provider period export",
  "Select one provider period export (CSV, TSV, or a v1 JSON envelope) in the import panel above. "
  + "Nothing else on this page can produce a spend figure.");

const COST_FIELD = requirement("costedRows", 1, FIELD,
  "Cost amount column (cost.amount_minor)",
  "Map your export's cost column to `cost.amount_minor` in the column-review step. "
  + "Every row was read, but none carried a cost, so there is no money to report.");

const ORG_UNIT_FIELD = requirement("orgUnitRows", 1, FIELD,
  "Org unit column (org_unit_id)",
  "Map the column that names the team, project, or cost centre to `org_unit_id`. "
  + "Without it the spend is one undivided total and no department can be ranked.");

const ATTRIBUTION_FLOOR = requirement("attributedShare", MIN_ATTRIBUTED_SHARE, FIELD,
  "Org unit values that match your roster",
  `Fewer than ${Math.round(MIN_ATTRIBUTED_SHARE * 100)}% of the imported dollars resolve to one org unit. `
  + "Add an org roster export, or respell the org unit values so they match the roster you already added.");

const SCORED_PROMPTS = requirement("scoredPrompts", MIN_SCORED_PROMPTS, FILE,
  "Query sample export",
  `Add a query sample export carrying at least ${MIN_SCORED_PROMPTS} prompts. `
  + "A provider invoice prices the work; only a query sample says what the work was.");

const GRADED_DEPARTMENT = requirement("gradedDepartments", 1, FIELD,
  "Org unit column on the query sample",
  `Fill \`org_unit_id\` on the query sample so at least ${MIN_SCORED_PROMPTS} scored prompts `
  + "land in one department. A grade spread thin across many teams grades none of them.");

/**
 * The panels, in the order a leader meets them.
 *
 * `figures` are the nodes that carry a number or a chart. When a panel is
 * unavailable they go off screen and the contract's sentence takes their place:
 * the heading, the question, and the panel itself stay, because a leader has to
 * be able to see that the question exists and what it costs to answer.
 */
export const EXECUTIVE_PANELS = Object.freeze([
  {
    id: "hero-grade",
    elementId: "score-card",
    question: "Is our AI spend earning a passing grade, and is that grade ours?",
    metric: "AI literacy score: the prompt-literacy rubric's mean over scored prompts, "
      + "rolled up across departments holding at least "
      + `${MIN_SCORED_PROMPTS} scored prompts, weighted by each department's scored prompt count.`,
    figures: Object.freeze(["score-grade", "score-value", "score-coverage", "score-peer"]),
    requirements: Object.freeze([SCORED_PROMPTS, GRADED_DEPARTMENT]),
  },
  {
    id: "spend-and-recovery",
    elementId: "kpi-row",
    question: "What did we spend this period, and how much of it is recoverable?",
    metric: "Spend is the sum of `cost.amount_minor` over imported provider rows, in major USD. "
      + "Recoverable is the disclosed down-routing scenario over attributed spend only.",
    figures: Object.freeze(["kpi-spend", "kpi-recoverable"]),
    requirements: Object.freeze([PROVIDER_FILE, COST_FIELD, ATTRIBUTION_FLOOR]),
  },
  {
    id: "high-value-share",
    elementId: "kpi-productive",
    question: "Is the spend buying high-value work rather than filler?",
    metric: "Share of scored prompts classified high-value by the prompt-literacy rubric, "
      + "over all scored prompts.",
    figures: Object.freeze(["kpi-productive-value", "kpi-productive-note"]),
    requirements: Object.freeze([SCORED_PROMPTS]),
  },
  {
    id: "peer-benchmark",
    elementId: "kpi-peer",
    question: "How do we compare with organizations like us?",
    metric: "Percentile of this organization's literacy score within an anonymized cohort "
      + "of at least one comparable organization.",
    figures: Object.freeze(["kpi-peer-value", "kpi-peer-note"]),
    requirements: Object.freeze([
      requirement("peerCohortRecords", 1, FILE, "A published peer cohort that applies to you",
        "No published synthetic peer cohort applies to this organization. The cohorts are "
        + "reference data shipped with this product — they are never built from your files and "
        + "never contain them — so what is missing is a segment input that selects one. The "
        + "card names which."),
    ]),
  },
  {
    id: "spend-mix",
    elementId: "spend-mix-panel",
    question: "Where does the money go — what was the spend actually asked to do?",
    metric: "Share of scored prompts in each query category (high value, over-provisioned, "
      + "inefficient, out of scope). A query mix, not a spend mix, unless per-query cost is present.",
    figures: Object.freeze(["mix-bar", "mix-legend"]),
    requirements: Object.freeze([SCORED_PROMPTS]),
  },
  {
    id: "department-priority",
    elementId: "department-decision-panel",
    question: "Which department needs help first?",
    metric: "Departments ordered by recoverable USD descending, over attributed spend only; "
      + "a department with no joined provider aggregate is not ranked and is never ranked as poor.",
    figures: Object.freeze(["decision-provenance", "decision-layout"]),
    requirements: Object.freeze([
      PROVIDER_FILE, COST_FIELD, ORG_UNIT_FIELD, ATTRIBUTION_FLOOR,
      requirement("rankedDepartments", 1, FIELD, "Org unit values that join the roster",
        "The export and the roster share no org unit value, so nothing can be ranked. "
        + "Respell the org unit values, or add the roster the export was grouped by."),
    ]),
  },
  {
    id: "model-overspend",
    elementId: "model-overspend",
    question: "Which model is overspending for the work it is doing?",
    metric: "Cost per request by model tier: summed `cost.amount_minor` over summed "
      + "`usage.request_count`, per `usage.model_raw`, within one period.",
    figures: Object.freeze(["model-overspend-body"]),
    requirements: Object.freeze([
      requirement("modelIdentifiedRows", 1, FIELD, "Model identifier column (usage.model_raw)",
        "Map the column naming the model to `usage.model_raw`. A per-model finding cannot be "
        + "derived from an export that never says which model was billed."),
      requirement("requestCountedRows", 1, FIELD, "Request count column (usage.request_count)",
        "Map the column counting requests to `usage.request_count`. Cost alone cannot say whether "
        + "a model is expensive per unit of work."),
    ]),
  },
  {
    id: "savings-portfolio",
    elementId: "savings-portfolio-panel",
    question: "Are projected savings turning into verified savings?",
    metric: "Projected, completed, and verified savings summed over savings actions carrying "
      + "a lifecycle state; verified requires an adjudicated realized figure.",
    figures: Object.freeze(["portfolio-filters", "portfolio-summary", "portfolio-count", "portfolio-list"]),
    requirements: Object.freeze([
      requirement("actionOutcomeRecords", 1, FILE, "Savings action outcome records",
        "No provider export carries lifecycle state, so nothing here can be verified from one. "
        + "Record outcomes in the monthly Savings Action Center — they are not derivable from spend. "
        + "This panel is also unavailable when the bundled action plan cannot be read."),
    ]),
  },
  {
    id: "recommendation-evidence",
    elementId: "recommendation-evidence",
    question: "How did a recommendation earn the score it was given?",
    metric: "The evaluation rubric's per-dimension scores for one recommendation, with the "
      + "gate that accepted or rejected it.",
    figures: Object.freeze(["finops-evaluation-result"]),
    requirements: Object.freeze([
      requirement("evaluationRecords", 1, FILE, "Recommendation evaluation records",
        "This panel inspects bundled evaluation records, and an imported provider export contains "
        + "no recommendation to score. It is unavailable whenever your own import is on screen, and "
        + "whenever those bundled records cannot be read."),
    ]),
  },
]);

/** Panels keyed by id, for a caller that wants one. */
export const PANELS_BY_ID = Object.freeze(Object.fromEntries(
  EXECUTIVE_PANELS.map((panel) => [panel.id, panel])));

/**
 * A counted fact, or zero.
 *
 * Absent, non-finite, and negative all mean "we counted none of these". There
 * is no third state, because a third state is where two engineers start
 * disagreeing about whether a panel may draw a number.
 */
function counted(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Normalize any partial record into the full fact set. */
export function panelFacts(raw = {}) {
  const facts = {};
  for (const key of Object.keys(PANEL_FACTS)) facts[key] = counted(raw[key]);
  return Object.freeze(facts);
}

/** The state of one panel against one fact record. */
export function panelState(panel, rawFacts = {}) {
  const facts = panelFacts(rawFacts);
  const missing = panel.requirements.filter((entry) => facts[entry.fact] < entry.atLeast);
  const blocking = missing[0] ?? null;
  return Object.freeze({
    id: panel.id,
    elementId: panel.elementId,
    question: panel.question,
    figures: panel.figures,
    available: missing.length === 0,
    missing,
    blocking,
    /** The blocking input's stable code, or null when the panel is answerable. */
    reason: blocking?.reason ?? null,
    remaining: Math.max(0, missing.length - 1),
    message: blocking ? unavailableMessage(panel, blocking, missing.length) : null,
  });
}

/**
 * The sentence under an unanswerable panel.
 *
 * It names one input and one only. A panel with four unmet requirements still
 * gets one instruction: the reader completes it, the panel re-evaluates, and
 * the next one is named. A list of four is a backlog, not a next step — but the
 * count is still stated, so nobody is surprised by a second ask.
 */
export function unavailableMessage(panel, blocking, missingCount = 1) {
  const rest = Math.max(0, missingCount - 1);
  return {
    headline: "Not answerable from your import yet",
    question: panel.question,
    reason: blocking.reason,
    needLabel: blocking.label,
    needKind: blocking.kind,
    need: blocking.need,
    rest: rest === 0 ? null
      : `${rest} further declared input${rest === 1 ? "" : "s"} remain${rest === 1 ? "s" : ""} after this one.`,
  };
}

/** Every panel's state, in page order. */
export function panelStates(rawFacts = {}) {
  const facts = panelFacts(rawFacts);
  return EXECUTIVE_PANELS.map((panel) => panelState(panel, facts));
}

// ---------------------------------------------------------------------------
// Deriving the facts.
// ---------------------------------------------------------------------------

const records = (envelope) => (Array.isArray(envelope?.document?.records)
  ? envelope.document.records
  : Array.isArray(envelope?.records) ? envelope.records : []);

const has = (value) => value !== null && value !== undefined && value !== "";

/**
 * Facts for a leader's own import.
 *
 * The provider-side facts are counted here out of the parsed v1 envelopes, so
 * the panel decision and the analysis read the same rows. The two prompt-side
 * counts are passed in because the prompt-grading module already publishes
 * them, and counting them twice is how two numbers on one screen disagree.
 *
 * `attributedShare` likewise comes from the trust verdict rather than being
 * re-derived: the coverage headline and the panel decision must be the same
 * ratio or the page contradicts itself.
 */
export function importedPanelFacts({
  providers = [], result = null, attributedShare = 0,
  scoredPrompts = 0, gradedDepartments = 0, peerCohortRecords = 0,
} = {}) {
  const rows = providers.flatMap((envelope) => records(envelope));
  return panelFacts({
    providerPeriodFiles: providers.length,
    costedRows: rows.filter((row) => Number.isFinite(row?.cost?.amount_minor)).length,
    orgUnitRows: rows.filter((row) => has(row?.org_unit_id)).length,
    modelIdentifiedRows: rows.filter((row) => has(row?.usage?.model_raw)).length,
    requestCountedRows: rows.filter((row) => Number.isFinite(row?.usage?.request_count)).length,
    attributedShare,
    rankedDepartments: result?.rankedDepartments?.length ?? 0,
    scoredPrompts,
    gradedDepartments,
    // An import carries neither of these two, and saying so in the fact record
    // rather than in a branch is what keeps the panels' unavailable sentences
    // honest instead of absent.
    actionOutcomeRecords: 0,
    evaluationRecords: 0,
    // Not zero by construction any more. An import still builds no cohort of its
    // own — the count is the PUBLISHED cohort that applies to this import, and
    // it is 0 when the import's segment inputs select none.
    peerCohortRecords,
  });
}

/**
 * Facts for the bundled synthetic seed.
 *
 * The example view runs the same contract as an import — that is the point of
 * having one — so the seed is counted into the same fact record rather than
 * being waved through by a dataset flag.
 */
export function examplePanelFacts(seed = null, {
  evaluationRecords = 0, modelFindingRows = 0,
} = {}) {
  const departments = Array.isArray(seed?.departments) ? seed.departments : [];
  const sampled = departments.map((department) => (
    department?.sampling?.status === "available" ? counted(department.sampling.sampledQueries) : 0));
  const actions = Array.isArray(seed?.actionPlan) ? seed.actionPlan
    : Array.isArray(seed?.actionPlan?.actions) ? seed.actionPlan.actions
      : departments.filter((department) => has(department?.actionPlan?.status));
  return panelFacts({
    providerPeriodFiles: departments.length ? 1 : 0,
    costedRows: departments.filter((department) => counted(department?.spendUsd) > 0).length,
    orgUnitRows: departments.filter((department) => has(department?.id)).length,
    // The seed publishes department roll-ups, never per-model billing rows. The
    // bundled per-model finding is its own shipped fixture, so the caller says
    // how many rows it carries rather than this module guessing from the seed.
    modelIdentifiedRows: modelFindingRows,
    requestCountedRows: modelFindingRows,
    attributedShare: departments.length ? 1 : 0,
    rankedDepartments: departments.length,
    scoredPrompts: sampled.reduce((total, count) => total + count, 0),
    gradedDepartments: sampled.filter((count) => count >= MIN_SCORED_PROMPTS).length,
    actionOutcomeRecords: actions.length,
    evaluationRecords,
    peerCohortRecords: has(seed?.organization?.peerCohort) ? 1 : 0,
  });
}
