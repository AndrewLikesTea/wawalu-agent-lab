// Published synthetic peer cohorts.
//
// WHAT THIS FILE IS
// -----------------
// Reference data, not sample data. Every record below was authored in this
// repository by hand so that "how do we compare with organizations like us?"
// has an answer that ships with the product instead of an answer that waits for
// a peer network nobody is going to build. It is invented, it says so in every
// consuming surface, and it is the same for every visitor.
//
// WHAT IS NOT IN IT
// -----------------
// No customer, tenant, provider, telemetry, or visitor record. Nothing here is
// derived from an imported file: a cohort a reader's own import could move is a
// cohort that leaks the reader's import to the next comparison. The values are
// fixed at publication and the version above them changes when they do.
//
// A member carries exactly four fields — an opaque synthetic id and the three
// declared benchmark metrics. There is deliberately no name, region, headcount,
// provider, or free-text field: a cohort member is a point in three dimensions
// and anything else on it would only be there to be printed.

/** Bump with `PEER_COHORT_VERSION` whenever a value or a member below changes. */
export const PEER_COHORT_SNAPSHOT_DATE = "2026-06-30";

/** The rubric every published literacy score was computed under. */
export const PEER_COHORT_RUBRIC_VERSION = "literacy-mix/1.0.0";

/** The industry keys a segment input may declare. Wire values. */
export const PEER_INDUSTRY = Object.freeze({
  saas: "saas",
  financialServices: "financial_services",
});

const member = (memberId, literacyScore, highValueShare, recoverableShare) =>
  Object.freeze({ memberId, literacyScore, highValueShare, recoverableShare });

const cohort = (cohortId, family, label, selector, segmentLabel, members) => Object.freeze({
  cohortId,
  family,
  label,
  /**
   * The eligibility predicate, as data. `industry` null means the cohort does
   * not constrain industry; `orgUnits` is an inclusive band on the count of
   * attributed org units in the organization being compared.
   */
  selector: Object.freeze({
    industry: selector.industry ?? null,
    orgUnits: Object.freeze({ min: selector.min, max: selector.max }),
  }),
  segmentLabel,
  rubricVersion: PEER_COHORT_RUBRIC_VERSION,
  snapshotDate: PEER_COHORT_SNAPSHOT_DATE,
  members: Object.freeze(members),
});

/** Organization size is counted in attributed org units, never in employees. */
export const COHORT_FAMILY = Object.freeze({
  organizationSize: "organization_size",
  industry: "industry",
});

/**
 * Every published cohort.
 *
 * Order is not significance: selection sorts by how many segment dimensions a
 * cohort constrains and then by `cohortId`, so this array may be reordered
 * without moving any reader's answer.
 */
export const PEER_COHORTS = Object.freeze([
  cohort("size-focused", COHORT_FAMILY.organizationSize,
    "Organizations with 1–4 attributed org units",
    { min: 1, max: 4 }, "1–4 attributed org units", [
      member("syn-foc-01", 38, 0.14, 0.34), member("syn-foc-02", 42, 0.17, 0.31),
      member("syn-foc-03", 45, 0.19, 0.29), member("syn-foc-04", 48, 0.22, 0.27),
      member("syn-foc-05", 51, 0.24, 0.25), member("syn-foc-06", 54, 0.26, 0.23),
      member("syn-foc-07", 57, 0.29, 0.21), member("syn-foc-08", 60, 0.31, 0.19),
      member("syn-foc-09", 63, 0.34, 0.17), member("syn-foc-10", 67, 0.37, 0.15),
      member("syn-foc-11", 71, 0.41, 0.12), member("syn-foc-12", 76, 0.46, 0.09),
    ]),
  cohort("size-scaling", COHORT_FAMILY.organizationSize,
    "Organizations with 5–14 attributed org units",
    { min: 5, max: 14 }, "5–14 attributed org units", [
      member("syn-scl-01", 44, 0.16, 0.32), member("syn-scl-02", 47, 0.19, 0.30),
      member("syn-scl-03", 50, 0.21, 0.28), member("syn-scl-04", 53, 0.24, 0.26),
      member("syn-scl-05", 56, 0.26, 0.24), member("syn-scl-06", 58, 0.28, 0.22),
      member("syn-scl-07", 61, 0.31, 0.20), member("syn-scl-08", 64, 0.33, 0.18),
      member("syn-scl-09", 67, 0.36, 0.16), member("syn-scl-10", 70, 0.39, 0.14),
      member("syn-scl-11", 74, 0.43, 0.11), member("syn-scl-12", 79, 0.48, 0.08),
    ]),
  cohort("size-enterprise", COHORT_FAMILY.organizationSize,
    "Organizations with 15 or more attributed org units",
    { min: 15, max: 500 }, "15+ attributed org units", [
      member("syn-ent-01", 49, 0.18, 0.30), member("syn-ent-02", 52, 0.21, 0.28),
      member("syn-ent-03", 55, 0.23, 0.26), member("syn-ent-04", 58, 0.26, 0.24),
      member("syn-ent-05", 60, 0.28, 0.22), member("syn-ent-06", 63, 0.30, 0.20),
      member("syn-ent-07", 66, 0.33, 0.18), member("syn-ent-08", 69, 0.35, 0.16),
      member("syn-ent-09", 72, 0.38, 0.14), member("syn-ent-10", 75, 0.41, 0.12),
      member("syn-ent-11", 79, 0.45, 0.10), member("syn-ent-12", 83, 0.50, 0.07),
    ]),
  cohort("industry-saas", COHORT_FAMILY.industry,
    "Software-as-a-service organizations with 5 or more attributed org units",
    { industry: PEER_INDUSTRY.saas, min: 5, max: 500 },
    "SaaS · 5+ attributed org units", [
      member("syn-saas-01", 52, 0.20, 0.28), member("syn-saas-02", 55, 0.23, 0.26),
      member("syn-saas-03", 58, 0.25, 0.24), member("syn-saas-04", 61, 0.28, 0.22),
      member("syn-saas-05", 63, 0.30, 0.20), member("syn-saas-06", 66, 0.32, 0.18),
      member("syn-saas-07", 69, 0.35, 0.16), member("syn-saas-08", 72, 0.37, 0.14),
      member("syn-saas-09", 75, 0.40, 0.12), member("syn-saas-10", 78, 0.43, 0.10),
      member("syn-saas-11", 81, 0.47, 0.08), member("syn-saas-12", 85, 0.52, 0.06),
    ]),
  cohort("industry-financial-services", COHORT_FAMILY.industry,
    "Financial-services organizations with 5 or more attributed org units",
    { industry: PEER_INDUSTRY.financialServices, min: 5, max: 500 },
    "Financial services · 5+ attributed org units", [
      member("syn-fin-01", 45, 0.15, 0.33), member("syn-fin-02", 48, 0.18, 0.31),
      member("syn-fin-03", 51, 0.20, 0.29), member("syn-fin-04", 54, 0.23, 0.27),
      member("syn-fin-05", 57, 0.25, 0.25), member("syn-fin-06", 59, 0.27, 0.23),
      member("syn-fin-07", 62, 0.30, 0.21), member("syn-fin-08", 65, 0.32, 0.19),
      member("syn-fin-09", 68, 0.35, 0.17), member("syn-fin-10", 71, 0.38, 0.15),
      member("syn-fin-11", 75, 0.42, 0.13), member("syn-fin-12", 80, 0.47, 0.10),
    ]),
]);
