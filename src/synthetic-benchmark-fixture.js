import {
  COMPARISON_INPUT_KIND, SYNTHETIC_BENCHMARK_VERSION, SYNTHETIC_COHORT_KIND,
} from "./synthetic-benchmark-contract.js";

export const SYNTHETIC_COHORT_FIXTURE = Object.freeze({
  schemaVersion: SYNTHETIC_BENCHMARK_VERSION,
  kind: SYNTHETIC_COHORT_KIND,
  snapshot: Object.freeze({ id: "synthetic-cohorts-2026-06", generatedAt: "2026-06-30T00:00:00Z" }),
  cohorts: Object.freeze([Object.freeze({
    industryBand: "all_industries", organizationSizeBand: "five_to_fourteen_units",
    taskVolumeBand: "measured", measures: Object.freeze({ performance: 61, cost: 0.22 }),
  })]),
});

export function comparisonInput({ organization, segment }) {
  return {
    schemaVersion: SYNTHETIC_BENCHMARK_VERSION, kind: COMPARISON_INPUT_KIND,
    industryBand: segment?.industry ?? "all_industries",
    organizationSizeBand: Number.isInteger(segment?.orgUnits) && segment.orgUnits > 0
      ? (segment.orgUnits < 5 ? "one_to_four_units" : segment.orgUnits < 15
        ? "five_to_fourteen_units" : "fifteen_plus_units") : null,
    taskVolumeBand: Number.isFinite(organization?.literacyScore) ? "measured" : null,
    measures: { performance: organization?.literacyScore, cost: organization?.recoverableShare },
  };
}

const valid = comparisonInput({
  organization: { literacyScore: 70, recoverableShare: 0.2 },
  segment: { orgUnits: 8, industry: "saas" },
});

/** Labeled, local fixtures for every contract outcome deployment must handle. */
export const BENCHMARK_COMPARISON_FIXTURES = Object.freeze({
  valid: Object.freeze(valid),
  missing: Object.freeze({ ...valid, taskVolumeBand: null }),
  incompatible: Object.freeze({ ...valid, schemaVersion: "finops-synthetic-benchmark/2.0.0" }),
  prohibited: Object.freeze({ ...valid, prompt: "prohibited synthetic sentinel" }),
});
