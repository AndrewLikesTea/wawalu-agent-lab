/**
 * Static executive savings portfolio contract.
 *
 * Questions this contract answers, in order:
 * 1. Which department needs attention now, and why?
 * 2. What annualized savings are projected across the portfolio?
 * 3. What savings have verification evidence and may be credited as realized?
 * 4. How far is credited realized savings from the full projection?
 *
 * Deliberately out of scope: UI instructions, forecasts by time period, currency
 * conversion, live data, and causal claims beyond the supplied evidence.
 */

/** @typedef {"planned"|"in-progress"|"completed"|"verified"} SavingsLifecycleState */

/**
 * @typedef {object} SavingsAction
 * @property {string} actionId
 * @property {string} title
 * @property {{role: string}} accountableOwner
 * @property {{id: string, name: string, accountableOwner: {role: string}}} department
 * @property {SavingsLifecycleState} lifecycleState
 * @property {{state: SavingsLifecycleState, transitionedDate: string}[]} lifecycleTransitions
 * @property {number} projectedSavingsUsd Expected annualized whole-US-dollar savings.
 * @property {number|null} completedSavingsUsd Measured savings once completed.
 * @property {number|null} verifiedSavingsUsd Evidence-backed savings once verified.
 * @property {number} creditedVerifiedSavingsUsd Verified savings that may be credited; 0 until verified.
 * @property {number} varianceUsd Credited verified minus projected savings for this action.
 * @property {{evidenceId: string, description: string}[]} verificationEvidence
 * @property {number} confidence Support for the projection on a 0-to-1 scale.
 * @property {string} updatedDate ISO calendar date (YYYY-MM-DD).
 */

export const SAVINGS_LIFECYCLE_STATES = Object.freeze([
  "planned", "in-progress", "completed", "verified",
]);

export const SAVINGS_PORTFOLIO_METRIC_RULES = Object.freeze({
  projectedSavings:
    "Sum projectedSavingsUsd for planned, in-progress, completed, and verified actions.",
  verifiedSavings:
    "Sum verifiedSavingsUsd for verified actions only; completed measurements remain visible but uncredited.",
  variance:
    "Credited verified savings minus projected savings, reported identically for each action, each department, and the portfolio.",
  attention:
    "Exclude verified actions. Rank departments by completed projected USD, then in-progress projected USD, then planned projected USD (all descending), then oldest updated date ascending, then department ID ascending.",
});

export class SavingsPortfolioValidationError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = "SavingsPortfolioValidationError";
    this.path = path;
  }
}

function invalid(path, message) {
  throw new SavingsPortfolioValidationError(path, message);
}

function requiredText(value, path) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0)
    invalid(path, "must be a non-empty trimmed string");
  return value;
}

function wholeUsd(value, path) {
  if (!Number.isSafeInteger(value) || value < 0)
    invalid(path, "must be a non-negative safe integer in whole USD");
  return value;
}

function isoDate(value, path) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    invalid(path, "must be an ISO calendar date (YYYY-MM-DD)");
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day) invalid(path, "must be a real calendar date");
  return value;
}

/**
 * Freeze every level of a plain result object. A shallow freeze still lets a
 * consumer edit a nested per-lifecycle total, which would make two reads of the
 * same static fixture disagree.
 */
function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

/** Validate and return an immutable SavingsAction. */
export function validateSavingsAction(input, index = 0) {
  const path = `actions[${index}]`;
  if (!input || typeof input !== "object" || Array.isArray(input))
    invalid(path, "must be an object");

  const lifecycleState = input.lifecycleState;
  if (!SAVINGS_LIFECYCLE_STATES.includes(lifecycleState))
    invalid(`${path}.lifecycleState`, `must be one of ${SAVINGS_LIFECYCLE_STATES.join(", ")}`);
  if (!input.department || typeof input.department !== "object")
    invalid(`${path}.department`, "must be an object");
  if (!Array.isArray(input.verificationEvidence))
    invalid(`${path}.verificationEvidence`, "must be an array");
  if (!Array.isArray(input.lifecycleTransitions) || input.lifecycleTransitions.length === 0)
    invalid(`${path}.lifecycleTransitions`, "must be a non-empty array");
  if (!input.accountableOwner || typeof input.accountableOwner !== "object")
    invalid(`${path}.accountableOwner`, "must be an object");
  if (!input.department.accountableOwner
    || typeof input.department.accountableOwner !== "object")
    invalid(`${path}.department.accountableOwner`, "must be an object");

  const lifecycleIndex = SAVINGS_LIFECYCLE_STATES.indexOf(lifecycleState);
  const lifecycleTransitions = input.lifecycleTransitions.map((transition, transitionIndex) => {
    const transitionPath = `${path}.lifecycleTransitions[${transitionIndex}]`;
    if (!transition || typeof transition !== "object" || Array.isArray(transition))
      invalid(transitionPath, "must be an object");
    if (transition.state !== SAVINGS_LIFECYCLE_STATES[transitionIndex])
      invalid(`${transitionPath}.state`, "must follow the lifecycle in order without gaps");
    return {
      state: transition.state,
      transitionedDate: isoDate(
        transition.transitionedDate, `${transitionPath}.transitionedDate`,
      ),
    };
  });
  if (lifecycleTransitions.length !== lifecycleIndex + 1
    || lifecycleTransitions.at(-1).state !== lifecycleState)
    invalid(`${path}.lifecycleTransitions`, "must end at lifecycleState");
  for (let transitionIndex = 1; transitionIndex < lifecycleTransitions.length; transitionIndex += 1) {
    if (lifecycleTransitions[transitionIndex].transitionedDate
      < lifecycleTransitions[transitionIndex - 1].transitionedDate)
      invalid(`${path}.lifecycleTransitions[${transitionIndex}].transitionedDate`,
        "must not precede the prior transition");
  }

  const verificationEvidence = input.verificationEvidence.map((evidence, evidenceIndex) => {
    const evidencePath = `${path}.verificationEvidence[${evidenceIndex}]`;
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence))
      invalid(evidencePath, "must be an object");
    return {
      evidenceId: requiredText(evidence.evidenceId, `${evidencePath}.evidenceId`),
      description: requiredText(evidence.description, `${evidencePath}.description`),
    };
  });
  const completedSavingsUsd = input.completedSavingsUsd;
  const verifiedSavingsUsd = input.verifiedSavingsUsd;
  if (lifecycleIndex >= SAVINGS_LIFECYCLE_STATES.indexOf("completed")) {
    wholeUsd(completedSavingsUsd, `${path}.completedSavingsUsd`);
  } else if (completedSavingsUsd !== null) {
    invalid(`${path}.completedSavingsUsd`, "must be null until the action is completed");
  }
  if (lifecycleState === "verified") {
    wholeUsd(verifiedSavingsUsd, `${path}.verifiedSavingsUsd`);
    if (verificationEvidence.length === 0)
      invalid(`${path}.verificationEvidence`, "verified actions require evidence");
  } else {
    if (verifiedSavingsUsd !== null)
      invalid(`${path}.verifiedSavingsUsd`, "must be null until the action is verified");
    if (verificationEvidence.length !== 0)
      invalid(`${path}.verificationEvidence`, "must be empty until the action is verified");
  }
  if (typeof input.confidence !== "number" || !Number.isFinite(input.confidence)
    || input.confidence < 0 || input.confidence > 1)
    invalid(`${path}.confidence`, "must be a finite number from 0 through 1");

  const projectedSavingsUsd = wholeUsd(
    input.projectedSavingsUsd, `${path}.projectedSavingsUsd`,
  );
  // One credit rule, applied once, so action, department, and portfolio variance
  // can never drift apart. Unverified savings credit zero without ever claiming
  // that zero was measured — verifiedSavingsUsd stays null.
  const creditedVerifiedSavingsUsd = lifecycleState === "verified" ? verifiedSavingsUsd : 0;

  return deepFreeze({
    actionId: requiredText(input.actionId, `${path}.actionId`),
    title: requiredText(input.title, `${path}.title`),
    accountableOwner: {
      role: requiredText(input.accountableOwner.role, `${path}.accountableOwner.role`),
    },
    department: {
      id: requiredText(input.department.id, `${path}.department.id`),
      name: requiredText(input.department.name, `${path}.department.name`),
      accountableOwner: {
        role: requiredText(
          input.department.accountableOwner.role, `${path}.department.accountableOwner.role`,
        ),
      },
    },
    lifecycleState,
    lifecycleTransitions,
    projectedSavingsUsd,
    completedSavingsUsd,
    verifiedSavingsUsd,
    creditedVerifiedSavingsUsd,
    varianceUsd: creditedVerifiedSavingsUsd - projectedSavingsUsd,
    verificationEvidence,
    confidence: input.confidence,
    updatedDate: isoDate(input.updatedDate, `${path}.updatedDate`),
  });
}

/** Totals for any set of actions; the only place savings are summed. */
function portfolioTotals(actions) {
  const projectedSavingsUsd = actions.reduce(
    (total, action) => total + action.projectedSavingsUsd, 0,
  );
  const verifiedSavingsUsd = actions.reduce(
    (total, action) => total + action.creditedVerifiedSavingsUsd, 0,
  );
  const completedSavingsUsd = actions.reduce(
    (total, action) => total + (action.completedSavingsUsd ?? 0), 0,
  );
  return { projectedSavingsUsd, completedSavingsUsd, verifiedSavingsUsd };
}

function departmentSummary(actions) {
  const first = actions[0];
  const byState = Object.fromEntries(SAVINGS_LIFECYCLE_STATES.map((state) => [state, 0]));
  const projectedByStateUsd = Object.fromEntries(
    SAVINGS_LIFECYCLE_STATES.map((state) => [state, 0]),
  );
  for (const action of actions) {
    byState[action.lifecycleState] += 1;
    projectedByStateUsd[action.lifecycleState] += action.projectedSavingsUsd;
  }
  const { projectedSavingsUsd, completedSavingsUsd, verifiedSavingsUsd } =
    portfolioTotals(actions);
  return {
    department: first.department,
    actionCount: actions.length,
    actionCountByLifecycle: byState,
    projectedByLifecycleUsd: projectedByStateUsd,
    projectedSavingsUsd,
    completedSavingsUsd,
    verifiedSavingsUsd,
    varianceUsd: verifiedSavingsUsd - projectedSavingsUsd,
    oldestUnverifiedUpdatedDate: actions
      .filter((action) => action.lifecycleState !== "verified")
      .map((action) => action.updatedDate).sort()[0] ?? null,
  };
}

/**
 * Reasons in ranking order. The first lifecycle a department actually has work
 * in decides the reason, and every reason states the amount that earned it so a
 * leader never has to reconstruct the ranking to understand the answer.
 */
const ATTENTION_REASONS = Object.freeze([
  Object.freeze({
    lifecycleState: "completed",
    reasonCode: "completed-awaiting-verification",
    explain: (name, usd) => `${name} has completed work with ${usd} USD in annualized`
      + " projected savings awaiting verification evidence.",
  }),
  Object.freeze({
    lifecycleState: "in-progress",
    reasonCode: "work-in-progress",
    explain: (name, usd) => `${name} has in-progress work with ${usd} USD in annualized`
      + " projected savings and no completed claim ready to verify.",
  }),
  Object.freeze({
    lifecycleState: "planned",
    reasonCode: "planned-not-started",
    explain: (name, usd) => `${name} has ${usd} USD in annualized projected savings`
      + " still planned and not started.",
  }),
]);

function attentionFor(summary) {
  // An attention candidate holds at least one unverified action, so exactly one
  // of the three unverified lifecycles always matches.
  const reason = ATTENTION_REASONS.find(
    (candidate) => summary.actionCountByLifecycle[candidate.lifecycleState] > 0,
  );
  const projectedUsd = summary.projectedByLifecycleUsd[reason.lifecycleState];
  return {
    department: summary.department,
    reasonCode: reason.reasonCode,
    explanation: reason.explain(summary.department.name, projectedUsd),
    projectedSavingsUsd: projectedUsd,
    oldestUnverifiedUpdatedDate: summary.oldestUnverifiedUpdatedDate,
  };
}

function compareAttention(left, right) {
  return right.projectedByLifecycleUsd.completed - left.projectedByLifecycleUsd.completed
    || right.projectedByLifecycleUsd["in-progress"]
      - left.projectedByLifecycleUsd["in-progress"]
    || right.projectedByLifecycleUsd.planned - left.projectedByLifecycleUsd.planned
    || left.oldestUnverifiedUpdatedDate.localeCompare(right.oldestUnverifiedUpdatedDate)
    || left.department.id.localeCompare(right.department.id);
}

/**
 * Validate a static fixture and produce the complete product-consumed summary.
 * Duplicate action IDs and conflicting names for a department ID are rejected.
 */
export function createSavingsPortfolio(fixture) {
  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture))
    invalid("fixture", "must be an object");
  if (fixture.schemaVersion !== "savings-portfolio/1.1.0")
    invalid("fixture.schemaVersion", "must equal savings-portfolio/1.1.0");
  if (!Array.isArray(fixture.actions))
    invalid("fixture.actions", "must be an array");

  const actions = fixture.actions.map(validateSavingsAction);
  const actionIds = new Set();
  const departmentNames = new Map();
  const departmentOwners = new Map();
  for (const [index, action] of actions.entries()) {
    if (actionIds.has(action.actionId))
      invalid(`actions[${index}].actionId`, "must be unique");
    actionIds.add(action.actionId);
    const knownName = departmentNames.get(action.department.id);
    if (knownName && knownName !== action.department.name)
      invalid(`actions[${index}].department.name`, "must match the department ID");
    departmentNames.set(action.department.id, action.department.name);
    const knownOwner = departmentOwners.get(action.department.id);
    if (knownOwner && knownOwner !== action.department.accountableOwner.role)
      invalid(`actions[${index}].department.accountableOwner.role`,
        "must match the department ID");
    departmentOwners.set(action.department.id, action.department.accountableOwner.role);
  }

  const grouped = Map.groupBy(actions, (action) => action.department.id);
  const departments = [...grouped.values()].map(departmentSummary)
    .sort((left, right) => left.department.id.localeCompare(right.department.id));
  const attentionCandidates = departments
    .filter((department) => department.oldestUnverifiedUpdatedDate !== null)
    .sort(compareAttention);
  const attentionDepartment = attentionCandidates[0] ?? null;
  const { projectedSavingsUsd, completedSavingsUsd, verifiedSavingsUsd } =
    portfolioTotals(actions);

  return deepFreeze({
    schemaVersion: fixture.schemaVersion,
    actions,
    summary: {
      projectedSavingsUsd,
      completedSavingsUsd,
      verifiedSavingsUsd,
      varianceUsd: verifiedSavingsUsd - projectedSavingsUsd,
      departments,
      attention: attentionDepartment ? attentionFor(attentionDepartment) : null,
    },
  });
}

/** Load and validate the bundled static fixture through the browser data boundary. */
export async function loadSavingsPortfolio(fetcher = fetch, url = "/savings-portfolio-fixture.json") {
  const response = await fetcher(url, {
    cache: "no-store", headers: { accept: "application/json" },
  });
  if (!response?.ok) {
    throw new Error(`Savings portfolio returned ${response?.status ?? "an invalid response"}.`);
  }
  return createSavingsPortfolio(await response.json());
}
