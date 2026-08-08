/**
 * Finance-leader portfolio projection over Rowan's savings-action lifecycle.
 * The action store stays the sole source of portfolio values; this module only
 * replays the bundled lifecycle onto it, filters, and totals.
 *
 * The bundled lifecycle is treated as untrusted input. One malformed row must
 * not take the whole board offline, so rows are validated and applied one at a
 * time; a rejected row leaves its action in the last state that was proven, and
 * the rejection is reported rather than swallowed. Errors here always fail
 * toward under-reporting savings, never toward claiming savings that were not
 * measured.
 */

import { createSavingsActionStore, savingsVariance } from "./savings-actions.js";

export const PORTFOLIO_STATES = Object.freeze([
  "planned", "in_progress", "completed", "verified",
]);

/** The transitions the store requires to reach each declared lifecycle state. */
const LIFECYCLE_PATHS = Object.freeze({
  in_progress: Object.freeze(["in_progress"]),
  completed: Object.freeze(["in_progress", "completed"]),
  verified: Object.freeze(["in_progress", "completed", "verified"]),
});

const usable = (value) => (Number.isFinite(value) ? value : 0);

function rejection(actionId, code) {
  return Object.freeze({ actionId: String(actionId ?? "(unnamed)"), code });
}

/**
 * Replay declared lifecycle rows onto the store, skipping the ones that do not
 * hold up. Returns the rejections so callers can be honest about the gap.
 */
function applyLifecycle(store, rows) {
  const seen = new Set();
  const rejected = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const actionId = row?.actionId;
    const path = LIFECYCLE_PATHS[row?.status];
    if (typeof actionId !== "string" || !path) {
      rejected.push(rejection(actionId, "INVALID_LIFECYCLE_ROW"));
      continue;
    }
    if (seen.has(actionId)) {
      rejected.push(rejection(actionId, "DUPLICATE_LIFECYCLE_ROW"));
      continue;
    }
    seen.add(actionId);

    // Checked before the first transition so an unusable measurement cannot
    // leave the action stranded halfway along its path. The store re-checks
    // this and everything else it owns; a row it rejects mid-path stops at the
    // last state the store accepted, which under-reports rather than over-claims.
    const realizedUsd = row.realizedImpact?.value;
    if (path.includes("completed") && !(Number.isFinite(realizedUsd) && realizedUsd >= 0)) {
      rejected.push(rejection(actionId, "UNUSABLE_RESULT"));
      continue;
    }

    try {
      for (const step of path)
        store.transition(actionId, step, step === "completed" ? row.realizedImpact : undefined);
    } catch (error) {
      rejected.push(rejection(actionId, error?.code ?? "INVALID_TRANSITION"));
    }
  }

  return Object.freeze(rejected);
}

export function createFinancePortfolio(fixture) {
  const store = createSavingsActionStore(fixture);
  const rejectedLifecycle = applyLifecycle(store, fixture?.portfolioLifecycle);
  const evidence = new Map((fixture?.evidence ?? [])
    .map((item) => [item.sampleId, Object.freeze({ ...item })]));
  const periods = new Map(store.selectReportingPeriods().map((item) => [item.periodId, item]));

  function select(filters = {}) {
    const department = typeof filters.department === "string" ? filters.department : "all";
    const state = PORTFOLIO_STATES.includes(filters.state) ? filters.state : "all";
    return store.selectPrioritizedActions(department === "all" ? undefined : department)
      .filter((action) => state === "all" || action.status === state);
  }

  return Object.freeze({
    /** Lifecycle rows that did not hold up, in fixture order. */
    rejectedLifecycle,

    select,

    /** Every department that actually has an action, in priority order. */
    departments() {
      const named = new Map();
      for (const action of select())
        if (!named.has(action.departmentId))
          named.set(action.departmentId, action.departmentName);
      return Object.freeze([...named].map(([id, name]) => Object.freeze({ id, name })));
    },

    summarize(filters = {}) {
      const actions = select(filters);
      const totals = {
        projectedUsd: 0, completedUsd: 0, verifiedUsd: 0, actionCount: actions.length,
      };
      for (const action of actions) {
        totals.projectedUsd += usable(action.estimatedImpactUsd);
        if (!action.realizedImpact) continue;
        const realizedUsd = usable(action.realizedImpact.value);
        totals.completedUsd += realizedUsd;
        if (action.status === "verified") totals.verifiedUsd += realizedUsd;
      }
      return Object.freeze(totals);
    },

    comparison(action) {
      return savingsVariance(action?.estimatedImpactUsd, action?.realizedImpact?.value);
    },

    evidenceFor(action) {
      const references = Array.isArray(action?.evidenceRefs) ? action.evidenceRefs : [];
      return references.map((reference) => evidence.get(reference)).filter(Boolean);
    },

    periodFor(reference) {
      return periods.get(reference) ?? null;
    },
  });
}

/**
 * The one action to recommend first, or null when this selection supports none.
 *
 * `priorityRank` ranks within a department — the plan's own ordering rule gives
 * every included department exactly one rank-1 action — so it carries no
 * cross-department meaning, and the first row of an all-departments selection is
 * decided by the `actionId` tiebreak. Promoting that row would answer "where
 * should we reduce spend first?" with alphabetical order. The recommendation is
 * the largest supported recoverable-spend figure instead.
 *
 * An action with no usable savings figure is not a recommendation, so a
 * non-finite or zero estimate is not eligible at all. Ties keep the earlier
 * action, which leaves the store's stable order as the tiebreak rather than
 * letting the promotion move between renders.
 *
 * @param actions a selection in `select()` order.
 */
export function selectPrimaryAction(actions = []) {
  let best = null;
  for (const action of actions) {
    const value = action?.estimatedImpactUsd;
    if (!Number.isFinite(value) || value <= 0) continue;
    if (best === null || value > best.estimatedImpactUsd) best = action;
  }
  return best;
}

export function confidenceLabel(confidence = {}) {
  const value = Number(confidence?.value);
  if (!Number.isFinite(value)) return "Unavailable";
  const band = value >= 0.85 ? "High" : value >= 0.7 ? "Moderate" : "Low";
  return `${band} · ${Math.round(value * 100)}%`;
}
