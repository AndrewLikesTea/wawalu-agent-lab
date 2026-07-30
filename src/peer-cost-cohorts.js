// Published synthetic cost cohorts.
//
// WHAT THIS FILE IS
// -----------------
// Reference data, in the same sense and the same shape as
// `peer-cohort-fixtures.js`: hand-authored in this repository, identical for
// every visitor, fixed at publication, and versioned by the snapshot identifier
// the peer-cohort reference data already carries. It exists so a FinOps lead
// can state *where their AI spend ranks*, not only what it costs, on the first
// load of the page and without importing anything.
//
// WHAT A RECORD PUBLISHES
// -----------------------
// Two boundary numbers and the segment they belong to. `p25` and `p75` are the
// quartile boundaries of that cohort's distribution of `cost_per_successful_task`
// in USD, stored as NUMBERS on the record. They are deliberately not prose, and
// they are deliberately not recomputed at runtime from member rows: a boundary
// that is derived on every page load is a boundary that two readers can compute
// differently, and a boundary written in a sentence is one no code can check.
//
// WHAT IS NOT IN IT
// -----------------
// No customer, tenant, provider, telemetry, or visitor record, and no member
// rows at all — a distribution is published as its boundaries here, so there is
// nothing on a record for an imported file to join against, average with, or
// extend. Nothing in this file is derived from any imported file, and nothing
// imported can reach it: `peer-cost-position.js` reads `PEER_COST_COHORTS` from
// module scope and takes no cohort argument from any caller.

import { PEER_COHORT_SNAPSHOT_DATE, PEER_INDUSTRY } from "./peer-cohort-fixtures.js";

export { PEER_INDUSTRY } from "./peer-cohort-fixtures.js";

/**
 * The snapshot identifier both sides of a comparison must agree on.
 *
 * It is the peer-cohort reference data's own snapshot date rather than a second
 * one, because a page that versioned its two reference tables separately would
 * have two answers to "which snapshot is this?" and no way to say which is the
 * page's.
 */
export const PEER_COST_SNAPSHOT_ID = PEER_COHORT_SNAPSHOT_DATE;

/**
 * The declared organization size bands. Wire values: reword a label freely,
 * changing a key is a snapshot bump.
 *
 * Size is declared by the organization, not inferred from its spend. A band
 * inferred from the invoice would make the cohort a function of the number the
 * cohort exists to judge.
 */
export const ORG_SIZE_BAND = Object.freeze({
  small: "small",
  mid: "mid",
  enterprise: "enterprise",
});

export const ORG_SIZE_BAND_LABEL = Object.freeze({
  [ORG_SIZE_BAND.small]: "Small · under 200 employees",
  [ORG_SIZE_BAND.mid]: "Mid-market · 200–1,999 employees",
  [ORG_SIZE_BAND.enterprise]: "Enterprise · 2,000+ employees",
});

export const PEER_INDUSTRY_LABEL = Object.freeze({
  [PEER_INDUSTRY.saas]: "Software-as-a-service",
  [PEER_INDUSTRY.financialServices]: "Financial services",
});

/**
 * The rule every published record has to satisfy, as a function rather than as
 * a module-level `if`, so a test can hand it a deliberately broken record and
 * see the same verdict the loader applies to the shipped ones.
 *
 * @returns the problem as a sentence, or null when the record is publishable.
 */
export function costCohortProblem(record) {
  if (!record || typeof record !== "object") return "a cohort record must be an object.";
  const { cohortId, sizeBand, industry, p25, p75 } = record;
  if (typeof cohortId !== "string" || !cohortId) return "a cohort record must declare a cohortId.";
  if (!Object.values(ORG_SIZE_BAND).includes(sizeBand)) {
    return `cohort ${cohortId} declares an unpublished size band.`;
  }
  if (!Object.values(PEER_INDUSTRY).includes(industry)) {
    return `cohort ${cohortId} declares an unpublished industry.`;
  }
  if (!Number.isFinite(p25) || p25 <= 0) return `cohort ${cohortId} must publish a positive p25.`;
  if (!Number.isFinite(p75) || p75 <= 0) return `cohort ${cohortId} must publish a positive p75.`;
  // The one invariant the band assignment cannot survive without: with p25 at
  // or above p75 the "middle range" is empty and one value could satisfy both
  // the top and the bottom rule.
  if (!(p25 < p75)) return `cohort ${cohortId} must publish p25 strictly below p75.`;
  return null;
}

/** Every record, checked; throws on the first problem, naming the record. */
export function assertPublishableCostCohorts(records) {
  const seenIds = new Set();
  const seenSegments = new Set();
  for (const record of records) {
    const problem = costCohortProblem(record);
    if (problem) throw new Error(`peer cost cohorts: ${problem}`);
    if (seenIds.has(record.cohortId)) {
      throw new Error(`peer cost cohorts: duplicate cohortId ${record.cohortId}.`);
    }
    seenIds.add(record.cohortId);
    // Two published cohorts on one segment would make every match ambiguous and
    // withhold every position, which is a fixture bug wearing an eligibility
    // rule's clothes.
    const segment = `${record.sizeBand}/${record.industry}`;
    if (seenSegments.has(segment)) {
      throw new Error(`peer cost cohorts: two cohorts published for segment ${segment}.`);
    }
    seenSegments.add(segment);
  }
  return records;
}

const cohort = (cohortId, sizeBand, industry, p25, p75) => Object.freeze({
  cohortId,
  /** The eligibility predicate, as data: both attributes, both exact matches. */
  sizeBand,
  industry,
  label: `${ORG_SIZE_BAND_LABEL[sizeBand]} · ${PEER_INDUSTRY_LABEL[industry]}`,
  /** USD per successful task. Lower is better, so p25 is the cheap boundary. */
  p25,
  p75,
  snapshotId: PEER_COST_SNAPSHOT_ID,
});

/**
 * Every published cost cohort.
 *
 * Four records, not one: a single-row table would make "the cohort that matches
 * this org" a fallback dressed as a lookup, and no test over it could tell a
 * working match rule from a constant. Order carries no meaning — matching is on
 * the two declared attributes and a match is required to be unique.
 */
export const PEER_COST_COHORTS = Object.freeze(assertPublishableCostCohorts([
  cohort("cost-enterprise-saas", ORG_SIZE_BAND.enterprise, PEER_INDUSTRY.saas, 18.40, 31.50),
  cohort("cost-enterprise-financial-services", ORG_SIZE_BAND.enterprise,
    PEER_INDUSTRY.financialServices, 22.10, 38.75),
  cohort("cost-mid-saas", ORG_SIZE_BAND.mid, PEER_INDUSTRY.saas, 12.75, 24.60),
  cohort("cost-small-saas", ORG_SIZE_BAND.small, PEER_INDUSTRY.saas, 9.20, 19.80),
]));

/** What the cohorts are, stated once so no consuming surface restates it. */
export const PEER_COST_PROVENANCE = Object.freeze({
  label: "Published synthetic cost cohorts",
  statement: "Cost cohorts are published synthetic reference data authored in this repository. "
    + "They contain no customer, tenant, or provider data, they are not derived from any file "
    + "imported by any visitor, and no import can add to, replace, or move them.",
  snapshotId: PEER_COST_SNAPSHOT_ID,
});
