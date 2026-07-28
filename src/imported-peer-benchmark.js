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
  evaluatePeerBenchmark, PEER_ACTION_CANDIDATES, PEER_COHORT_PROVENANCE, PEER_UNAVAILABLE_REASON,
} from "./peer-cohort-contract.js";
import { formatPercent, formatUsd } from "./evolution.js";

export const IMPORTED_PEER_BENCHMARK_VERSION = "imported-peer-benchmark/1.1.0";

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

// ---------------------------------------------------------------------------
// The one prioritized finding.
//
// The contract already selects exactly one action from the comparisons. What it
// cannot do is tie that action to the import's own money: it never sees an
// analysis. This section is that join and nothing more — it re-ranks nothing,
// re-measures nothing, and authors no second action. `action.text` below is the
// contract's own sentence, carried through unchanged, because a comparison that
// recommends one thing in a result object and another on screen is the defect
// this finding exists to close.
// ---------------------------------------------------------------------------

/** Where this import stands against its cohort on the action's own metric. */
export const PEER_STANDING = Object.freeze({
  behind: "behind_cohort",
  holding: "at_or_above_cohort",
});

/** Why a finding is absent when the benchmark itself did not refuse. */
export const PEER_FINDING_UNAVAILABLE = Object.freeze({
  /** No benchmark was handed over at all, so there is nothing to find in. */
  noBenchmark: "no_peer_benchmark_evaluated",
  /** A benchmark was published and it selected no action to report. */
  noAction: "no_prioritized_peer_action",
});

const FINDING_NEED = Object.freeze({
  [PEER_FINDING_UNAVAILABLE.noBenchmark]: Object.freeze({
    needLabel: "A peer benchmark for this import",
    need: "No peer comparison was evaluated for this import, so there is no peer finding to "
      + "report. Import a provider export and a query sample and the comparison is computed "
      + "from them.",
  }),
  [PEER_FINDING_UNAVAILABLE.noAction]: Object.freeze({
    needLabel: "A comparable metric to act on",
    need: "This comparison published no metric the action rules could be tested against, so no "
      + "next step follows from it. The import's own spend findings still apply.",
  }),
});

/**
 * The contract's own hold-position id.
 *
 * Named as a literal rather than derived from the rank order, and checked at
 * load: deriving "the last candidate is the hold" would silently pick a new
 * action the day a fifth candidate is ranked below it.
 */
const HOLD_ACTION_ID = "hold_position";

if (!PEER_ACTION_CANDIDATES.some((entry) => entry.id === HOLD_ACTION_ID)) {
  throw new Error(`imported peer benchmark: the contract publishes no "${HOLD_ACTION_ID}" action`);
}

/**
 * One metric value, in the unit the metric declares.
 *
 * Keyed by metric id rather than sniffed off the unit string, so adding a metric
 * to the contract without deciding how it reads here is a visible gap and not a
 * number printed in the wrong unit.
 */
const METRIC_VALUE_TEXT = Object.freeze({
  literacy_score: (value) => `${value} points`,
  high_value_share: (value) => formatPercent(value, { digits: 1 }),
  recoverable_share: (value) => formatPercent(value, { digits: 1 }),
});

const valueText = (metricId, value) => {
  const format = METRIC_VALUE_TEXT[metricId];
  return format ? format(value) : String(value);
};

/**
 * The import's own savings evidence behind the peer finding.
 *
 * Every entry is a figure the analysis already published and the page already
 * shows somewhere else. Nothing here is computed: a peer panel that derives its
 * own recoverable total is a second opinion about money, and two totals on one
 * screen is the failure this whole surface was built to end. An absent figure is
 * an absent entry, never a zero.
 */
export function importedPeerEvidence(analysis = null) {
  const entries = [];
  const recoverable = finite(analysis?.recoverableUsd);
  if (recoverable !== null) {
    entries.push(Object.freeze({
      id: "recoverable_scenario",
      label: "Recoverable in this import",
      value: formatUsd(recoverable),
    }));
  }
  const top = analysis?.topDepartment ?? null;
  const topRecoverable = finite(top?.recoverableUsd);
  if (typeof top?.name === "string" && top.name && topRecoverable !== null) {
    entries.push(Object.freeze({
      id: "top_department",
      label: "Largest recoverable unit",
      value: `${top.name} · ${formatUsd(topRecoverable)}`,
    }));
  }
  const next = typeof analysis?.action === "string" ? analysis.action.trim() : "";
  if (next) {
    entries.push(Object.freeze({ id: "analysis_action", label: "Already on this brief", value: next }));
  }
  return Object.freeze(entries);
}

function unavailableFinding({ reason, needLabel, need }) {
  return Object.freeze({
    available: false,
    id: null,
    rank: null,
    standing: null,
    behind: false,
    metricId: null,
    gap: null,
    action: null,
    evidence: Object.freeze([]),
    evidenceText: "",
    cohort: null,
    comparability: null,
    confidence: null,
    provenance: PEER_COHORT_PROVENANCE,
    unavailable: Object.freeze({ reason, needLabel, need }),
  });
}

/**
 * The single peer finding a reader is shown, with its action attached.
 *
 * @param input.peer an `evaluatePeerBenchmark` result, or null when none was
 *   evaluated. A refused benchmark keeps its own reason code: the finding does
 *   not restate a refusal in words of its own.
 * @param input.analysis the same local-finops analysis the benchmark was derived
 *   from, read only for the evidence entries above.
 * @returns a frozen finding. `available` is the only branch a surface needs; a
 *   surface that renders the gap and drops `action` is the rejected state this
 *   shape exists to make obvious.
 */
export function importedPeerFinding({ peer = null, analysis = null } = {}) {
  if (!peer) {
    return unavailableFinding({
      reason: PEER_FINDING_UNAVAILABLE.noBenchmark,
      ...FINDING_NEED[PEER_FINDING_UNAVAILABLE.noBenchmark],
    });
  }
  if (!peer.available) {
    return unavailableFinding({
      reason: peer.unavailable.reason,
      needLabel: peer.unavailable.needLabel,
      need: peer.unavailable.need,
    });
  }
  if (!peer.action?.available) {
    return unavailableFinding({
      reason: PEER_FINDING_UNAVAILABLE.noAction,
      ...FINDING_NEED[PEER_FINDING_UNAVAILABLE.noAction],
    });
  }
  // The comparison the ACTION is about, which is not always the headline: a
  // recoverable-share action is reported against recoverable share, so the gap
  // sentence and the next step name the same measurement.
  const comparison = peer.comparisons.find(
    (entry) => entry.metricId === peer.action.metricId && entry.available) ?? null;
  const standing = peer.action.id === HOLD_ACTION_ID ? PEER_STANDING.holding : PEER_STANDING.behind;
  const evidence = importedPeerEvidence(analysis);
  const gap = comparison === null ? null : Object.freeze({
    metricId: comparison.metricId,
    label: comparison.label,
    value: comparison.value,
    cohortMedian: comparison.cohortMedian,
    percentile: comparison.percentile,
    quartileLabel: comparison.quartileLabel,
    /** The contract's own distance-to-median phrase. Null when it published none. */
    size: peer.action.gap,
    text: `${comparison.label}: ${valueText(comparison.metricId, comparison.value)} against a cohort `
      + `median of ${valueText(comparison.metricId, comparison.cohortMedian)} · `
      + `${comparison.quartileLabel} of ${peer.cohort.label}`
      + (peer.action.gap ? ` · ${peer.action.gap} behind the median` : ""),
  });
  return Object.freeze({
    available: true,
    id: peer.action.id,
    rank: peer.action.rank,
    standing,
    /** True exactly when the selected action is a gap to close rather than a hold. */
    behind: standing === PEER_STANDING.behind,
    metricId: peer.action.metricId,
    gap,
    /** The contract's action, repeated. No sentence below is authored here. */
    action: Object.freeze({
      id: peer.action.id,
      text: peer.action.text,
      gap: peer.action.gap,
      accountableRole: peer.action.accountableRole,
    }),
    evidence,
    evidenceText: evidence.map((entry) => `${entry.label}: ${entry.value}`).join(" · "),
    cohort: peer.cohort,
    comparability: peer.comparability,
    confidence: peer.confidence,
    provenance: peer.provenance,
    unavailable: null,
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
    /**
     * The one prioritized finding, with the contract's action already attached
     * to the gap and to this import's own savings evidence. Published here so a
     * surface cannot render the comparison and leave the next step behind.
     */
    finding: importedPeerFinding({ peer: result, analysis }),
  });
}

/** Re-exported so a consuming surface branches on codes from one place. */
export { PEER_UNAVAILABLE_REASON };
