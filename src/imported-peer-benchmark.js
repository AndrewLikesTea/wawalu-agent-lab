// The imported organization's own peer benchmark.
//
// This is the seam the peer panel was missing. `peer-cohort-contract.js` knows
// how to compare an organization roll-up against a published cohort; it does
// not know what an imported FinOps analysis looks like. This module reads one
// import — the local analysis and the graded corpus the page already holds —
// and produces the roll-up and the segment inputs that contract needs.
//
// WHAT IT MAY READ
// ----------------
// Exactly two things, both already computed from the reader's own files: the
// local-finops analysis result and the imported-corpus grade. It does not read
// the bundled seed, the bundled peer percentile, or the example dataset's
// organization block — not for a fallback, not for a label, not for a median.
// An import's comparison is the import's or it is unavailable with a reason.
//
// WHAT IT DOES NOT DO
// -------------------
// No number below is measured here. The literacy composite is the grade's, the
// high-value share is the rubric's category row, and both sides of the
// recoverable ratio are the analysis's own published totals. Recomputing any of
// them is how two numbers on one screen disagree.

import {
  evaluatePeerBenchmark, PEER_UNAVAILABLE_REASON,
} from "./peer-cohort-contract.js";

export const IMPORTED_PEER_BENCHMARK_VERSION = "imported-peer-benchmark/1.0.0";

const finite = (value) => (Number.isFinite(value) ? value : null);

/**
 * The segment inputs, read off the import.
 *
 * ORGANIZATION SIZE is the count of org units the analysis actually attributed
 * and ranked. It is not headcount: no contract this product imports carries a
 * headcount, and a size band derived from a number nobody supplied would be a
 * guess with a percentile on top of it. The definition travels with the figure
 * everywhere it is shown.
 *
 * INDUSTRY is read only when the analysis declares one under `segment.industry`.
 * No provider or HRIS export in the v1 contracts carries an industry, so an
 * ordinary import declares none and is compared on size alone — which the
 * contract labels `broad` rather than quietly calling it a close match.
 */
export function importedPeerSegment(analysis = null) {
  const ranked = Array.isArray(analysis?.rankedDepartments) ? analysis.rankedDepartments.length : 0;
  const declared = analysis?.segment?.industry;
  return Object.freeze({
    orgUnits: ranked > 0 ? ranked : null,
    industry: typeof declared === "string" && declared ? declared : null,
  });
}

/**
 * The organization roll-up, read off the import.
 *
 * Each field is null when the import did not publish it, never zero: an absent
 * high-value share and a measured share of zero are different claims, and only
 * one of them belongs at the bottom of a cohort.
 */
export function importedPeerRollup(grade = null, analysis = null) {
  const spend = finite(analysis?.spendUsd);
  const recoverable = finite(analysis?.recoverableUsd);
  const highValue = grade?.gradeable
    ? grade.score?.categories?.find((entry) => entry.key === "highValue") ?? null
    : null;
  return Object.freeze({
    literacyScore: grade?.gradeable ? finite(grade.composite) : null,
    highValueShare: finite(highValue?.share),
    // Both sides of the ratio are the analysis's published USD totals for the
    // same period and the same attributed rows. A zero or absent denominator
    // makes the metric unavailable rather than infinite.
    recoverableShare: spend !== null && recoverable !== null && spend > 0
      ? recoverable / spend : null,
    rubricVersion: grade?.rubricVersionId ?? null,
    sourceRecords: grade?.records?.scored ?? 0,
    period: analysis?.period ?? null,
  });
}

/**
 * The imported organization's benchmark result.
 *
 * @param input.grade a `gradeImportedCorpus` result over the reader's own query
 *   sample, or null.
 * @param input.analysis a `localFinops` analysis over the reader's own provider
 *   export, or null.
 * @returns the contract's own frozen result, with the import's roll-up beside
 *   it so a surface can print the figure and its provenance from one object.
 *   Unavailable results carry the contract's reason code unchanged.
 */
export function importedPeerBenchmark({ grade = null, analysis = null } = {}) {
  const segment = importedPeerSegment(analysis);
  const organization = importedPeerRollup(grade, analysis);
  const result = evaluatePeerBenchmark({ organization, segment });
  return Object.freeze({
    ...result,
    derivationVersion: IMPORTED_PEER_BENCHMARK_VERSION,
    /**
     * The import's own inputs, published beside the comparison so a reader can
     * check what was compared without opening the analysis again.
     */
    organization,
    /** True exactly when this result was computed from the reader's own files. */
    fromImport: true,
  });
}

/** Re-exported so a consuming surface branches on codes from one place. */
export { PEER_UNAVAILABLE_REASON };
