// One deterministic peer-cost benchmark result for the static AI FinOps demo.
// It joins the existing metric/segment resolver to the existing fitness policy;
// consumers do not get to render a rank before checking that policy.

import { evaluatePeerCostBenchmarkFit } from "./peer-cost-benchmark-scope.js";
import {
  COST_BAND_DIRECTION, COST_METRIC, PEER_COST_COHORTS, resolveCostPosition,
} from "./peer-cost-position.js";

export const PEER_COST_BENCHMARK_VERSION = "finops-peer-cost-benchmark/1.0.0";

/**
 * @typedef {Object} PeerCostBenchmarkResult
 * @property {string} version
 * @property {boolean} available
 * @property {number|null} percentile Percent of peers whose cost is higher; lower cost is better.
 * @property {{p25:number,p75:number,unit:string}|null} range
 * @property {number|null} cohortSize
 * @property {{snapshotDate:string|null,ageDays:number|null,state:string}} freshness
 * @property {{level:string,basis:string,ruleId:string}} confidence
 * @property {{eligible:boolean,status:string,reason:string}} eligibility
 * @property {{priority:1,statement:string,evidence:string}|null} finding
 */

/** Mid-rank percentile. Equal observations contribute one half, then round half-up. */
export function lowerCostPercentile(values, value) {
  if (!Array.isArray(values) || values.length === 0 || !Number.isFinite(value)
    || values.some((entry) => !Number.isFinite(entry))) return null;
  let worse = 0;
  let tied = 0;
  for (const entry of values) {
    if (entry > value) worse += 1;
    else if (entry === value) tied += 1;
  }
  return Math.round(((worse + tied / 2) / values.length) * 100);
}

const fixtureFor = (position) => PEER_COST_COHORTS.find(
  (cohort) => cohort.cohortId === position?.cohort?.cohortId);

/** Pure calculator over bundled fixtures. No clock is read: `asOfDate` is required input. */
export function calculatePeerCostBenchmark({ org = null, spendUsd = null, tasks = null,
  asOfDate = null } = {}) {
  const position = resolveCostPosition({ org, spendUsd, tasks });
  const cohort = fixtureFor(position);
  const fit = evaluatePeerCostBenchmarkFit({
    // A resolver refusal is itself non-comparability. Do not let the cohort
    // summary retained for diagnostics independently earn confidence.
    metricId: position.available ? position.metric.id : null,
    sizeBand: position.declaredSizeBand,
    industry: position.declaredIndustry,
    cohort: position.cohort,
    asOfDate,
  });
  const available = position.available && fit.eligible && Boolean(cohort);
  const percentile = available ? lowerCostPercentile(cohort.memberValues, position.value) : null;
  const range = available ? Object.freeze({
    p25: cohort.p25, p75: cohort.p75, unit: COST_METRIC.unit,
  }) : null;
  const finding = available ? Object.freeze({
    priority: 1,
    statement: `${position.valueDisplay} per successful task is at the ${percentile}th percentile `
      + `for cost efficiency in this synthetic cohort; ${COST_BAND_DIRECTION.toLowerCase()}`,
    evidence: `${position.successfulTasks} successful tasks and $${position.spendUsd.toFixed(2)} `
      + `attributed spend, compared with ${cohort.memberCount} bundled observations; `
      + `p25 $${cohort.p25.toFixed(2)}, p75 $${cohort.p75.toFixed(2)}.`,
  }) : null;
  return Object.freeze({
    version: PEER_COST_BENCHMARK_VERSION,
    available,
    percentile,
    range,
    cohortSize: position.cohort?.memberCount ?? null,
    freshness: Object.freeze({ snapshotDate: fit.snapshotDate, ageDays: fit.ageDays, state: fit.state }),
    confidence: Object.freeze({
      level: fit.confidence, basis: fit.confidenceBasis, ruleId: fit.confidenceRuleId,
    }),
    eligibility: Object.freeze({ eligible: available, status: fit.state,
      reason: position.available ? fit.outcome : position.reason }),
    finding,
    position: available ? position : null,
    provenance: fit.provenance,
  });
}
