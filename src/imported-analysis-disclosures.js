// One imported analysis, four linked disclosures.
//
// WHY THIS MODULE EXISTS. The AI FinOps tab shows a leader four things about the
// same analysis: the leading finding above the fold, the benchmark card, the
// recommendation-evidence list, and the quantified-impact (savings) figure with
// the action it sizes. Until this module each of those four was composed at its
// own call site inside `evolution-page.js`, from a different input:
//
//   * the leading finding was selected by `buildFinopsBriefing` off the analysis
//     envelope;
//   * the benchmark card was written from two CONSTANT strings — "No benchmark
//     comparison" / "No compatible peer cohort for this import" — whatever the
//     envelope's own `benchmark` said, so an import that DID establish an
//     intra-tenant cohort was told it had none, and the bundled example dataset
//     was handed a sentence about "this import" it had no import for;
//   * the evidence list was filled straight from `result.evidence` with an empty
//     string authored at the call site;
//   * the savings figure was painted twice — once from the plausibility check
//     and again from the attribution decision a few lines later.
//
// Four call sites reading three inputs is how one analysis says four different
// things about itself. So: one state in, four disclosures out, and the page
// paints what it is handed.
//
// WHAT IT DECIDES, AND WHAT IT ONLY REPEATS.
//   * Decides nothing about eligibility, plausibility, or attribution. Whether
//     the totals are inside the display range and whether the money figure was
//     withheld are the PAGE's decisions, made before this module is called and
//     handed in; whether a cohort exists is the analysis envelope's. Repeating a
//     decision is how two numbers on one screen start disagreeing.
//   * Selects the leading finding through `buildFinopsBriefing` and nothing
//     else, so the export, the print render, and this page still read the one
//     briefing contract.
//   * Invents no figure. Every number below is read off the envelope and
//     formatted; nothing is recomputed and nothing is averaged.
//
// BUNDLED SYNTHETIC FIGURES ARE NOT A FALLBACK. A state's `source` is either the
// visitor's own import or the explicit try-example path, and the two are never
// mixed: an import that cannot fill a disclosure gets a stated gap with a
// machine-readable reason, never the example dataset's figure under the
// visitor's own provenance line. `allowsBundledFigures` says which path a state
// is on, in one boolean a caller and a test can both read.
//
// PRIVACY. The inputs are aggregates, counts, file names and authored sentences.
// No prompt text, cell value or record identifier reaches here.

import { buildFinopsBriefing } from "./finops-briefing-contract.js";
import { IMPORTED_BRIEFING_EMPTY } from "./briefing-strings.js";

export const GUIDED_DISCLOSURES_VERSION = "imported-analysis-disclosures/1.0.0";

/**
 * Where the figures on screen came from. `none` is a state with no analysis at
 * all, which is not the same as an import that produced nothing.
 */
export const DISCLOSURE_SOURCE = Object.freeze({
  import: "import",
  example: "example",
  none: "none",
});

/** The four disclosures this module composes, named once. */
export const DISCLOSURE = Object.freeze({
  finding: "finding",
  benchmark: "benchmark",
  evidence: "evidence",
  savings: "savings",
});

/**
 * Why a disclosure carries no figure. Each code has exactly one authored
 * sentence below, so the page, a log line, and a bug report all say the same
 * thing about the same hole.
 */
export const DISCLOSURE_GAP = Object.freeze({
  noAnalysis: "no_analysis",
  totalsOutsideRange: "totals_outside_supported_range",
  attributionBelowFloor: "attribution_below_floor",
  noRankedDepartment: "no_ranked_department",
  noBenchmarkCohort: "no_benchmark_cohort",
  noFigurePublished: "no_figure_published_by_analysis",
});

export const DISCLOSURE_STATEMENT = Object.freeze({
  [DISCLOSURE_GAP.noAnalysis]:
    "No analysis has been computed, so there is nothing behind this disclosure. "
    + "Select a provider export, or open the example dataset, to compute one.",
  [DISCLOSURE_GAP.totalsOutsideRange]:
    "A total in this analysis is outside the supported display range, so no figure is published here. "
    + "Inspect the source export.",
  [DISCLOSURE_GAP.attributionBelowFloor]:
    "Too little of this spend is attributed to name a figure, so none is shown.",
  [DISCLOSURE_GAP.noRankedDepartment]:
    "No provider aggregate joined an org unit, so no ranked department supports a recommendation.",
  [DISCLOSURE_GAP.noBenchmarkCohort]:
    `${IMPORTED_BRIEFING_EMPTY.benchmarkSummary}. A cohort is built from the graded departments in one `
    + "analysis; no cohort ships for imported data.",
  [DISCLOSURE_GAP.noFigurePublished]:
    "The inputs this disclosure declares are present and the analysis published no figure for it.",
});

/** The provenance label each source carries, so no caller authors its own. */
export const SOURCE_LABEL = Object.freeze({
  [DISCLOSURE_SOURCE.import]: "Your import",
  [DISCLOSURE_SOURCE.example]: "Example dataset",
  [DISCLOSURE_SOURCE.none]: "No analysis",
});

const MONEY = (value) => `${value.toFixed(2)} USD`;

const isSource = (value) => Object.values(DISCLOSURE_SOURCE).includes(value);

const trimmedStrings = (values) => (Array.isArray(values) ? values : [])
  .filter((value) => typeof value === "string" && value.trim())
  .map((value) => value.trim());

function gap(disclosure, reason, detail = null) {
  return Object.freeze({
    disclosure,
    reason,
    statement: DISCLOSURE_STATEMENT[reason] ?? detail ?? "",
    detail,
  });
}

/**
 * The one state four disclosures are composed from.
 *
 * Everything the page already decided is handed in rather than re-derived:
 * `plausible` is the display-range check the page made about the same totals,
 * and `attributionWithheld` is the attribution policy's suppression, made
 * upstream of this call. A state with no analysis is forced to `none`, because a
 * source without an envelope behind it would let a caller ask for the example
 * dataset's figures while holding nothing to read them off.
 *
 * @param analysis an envelope from `normalizeLocalFinops`/`…History`, or null.
 * @param source one of `DISCLOSURE_SOURCE`.
 * @param plausible whether the page accepted the totals for display.
 * @param attributionWithheld whether the money figure was already suppressed.
 * @param files the file names behind the analysis; empty for the example path.
 */
export function importedAnalysisState({
  analysis = null,
  source = DISCLOSURE_SOURCE.none,
  plausible = true,
  attributionWithheld = false,
  attributedShare = null,
  files = [],
} = {}) {
  const envelope = analysis && typeof analysis === "object" ? analysis : null;
  const named = isSource(source) ? source : DISCLOSURE_SOURCE.none;
  const resolved = envelope ? (named === DISCLOSURE_SOURCE.none ? DISCLOSURE_SOURCE.import : named)
    : DISCLOSURE_SOURCE.none;
  const quality = envelope?.quality ?? {};
  const count = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0);
  const share = Number.isFinite(attributedShare) && attributedShare >= 0 && attributedShare <= 1
    ? attributedShare : null;
  return Object.freeze({
    analysis: envelope,
    source: resolved,
    // The one place the try-example path is distinguished. Nothing below reads
    // a bundled figure, and this boolean is what a caller asserts on to prove
    // it: an imported state never permits one.
    allowsBundledFigures: resolved === DISCLOSURE_SOURCE.example,
    plausible: Boolean(envelope) && plausible !== false,
    attributionWithheld: Boolean(attributionWithheld),
    attributedShare: share,
    files: Object.freeze(resolved === DISCLOSURE_SOURCE.import ? trimmedStrings(files) : []),
    period: typeof envelope?.period === "string" ? envelope.period : null,
    recordsAnalyzed: count(quality.joinedRecords),
    recordsExcluded: count(quality.quarantinedRecords),
  });
}

/**
 * The provenance every disclosure carries, composed once and shared.
 *
 * Shared on purpose: four cards qualifying the same analysis with four
 * separately assembled provenance lines is the drift this module exists to end.
 */
function stateProvenance(state) {
  return Object.freeze({
    source: state.source,
    label: SOURCE_LABEL[state.source],
    files: state.files,
    period: state.period,
    recordsAnalyzed: state.recordsAnalyzed,
    recordsExcluded: state.recordsExcluded,
    attributedShare: state.attributedShare,
  });
}

/**
 * The leading finding, and it is the briefing contract's — not a second
 * selection beside it.
 *
 * The page used to build the briefing itself and paint it directly. Routing it
 * through here is what makes "one state, four disclosures" true rather than
 * three-quarters true: a caller that paints `guided.finding.briefing` cannot be
 * holding a briefing built from a different envelope than the benchmark card,
 * the evidence list, and the savings figure beside it.
 */
function findingDisclosure(state, provenance) {
  // The attribution decision is handed through unchanged. Widening it here —
  // "and also when the totals are implausible" — would be this module deciding
  // what the briefing may publish, which is the contract's job, not its
  // consumer's.
  const briefing = buildFinopsBriefing(state.analysis, {
    attributionWithheld: state.attributionWithheld,
  });
  const available = Boolean(briefing.materialMetric);
  return Object.freeze({
    key: DISCLOSURE.finding,
    available,
    briefing,
    question: briefing.headlineQuestion,
    provenance,
    // The briefing already carries its own machine-readable absence, authored
    // by the contract. Repeating it under a second code here would give one hole
    // two names.
    unavailable: available ? null
      : Object.freeze({
        disclosure: DISCLOSURE.finding,
        reason: briefing.absent?.materialMetric?.reason ?? DISCLOSURE_GAP.noAnalysis,
        statement: briefing.absent?.materialMetric?.statement
          ?? DISCLOSURE_STATEMENT[DISCLOSURE_GAP.noAnalysis],
        detail: null,
      }),
  });
}

/**
 * The benchmark card, from the envelope's own cohort.
 *
 * The reason a cohort is missing is the analysis's own reason code and its own
 * sentence; this module authors one only when the envelope carries no benchmark
 * object at all. Nothing here decides cohort size, rubric compatibility, or
 * eligibility — those are `query-literacy.js`'s, upstream and unchanged.
 */
function benchmarkDisclosure(state, provenance) {
  const benchmark = state.analysis?.benchmark ?? null;
  const cohort = benchmark?.cohort ?? null;
  if (!state.analysis) {
    return Object.freeze({
      key: DISCLOSURE.benchmark,
      available: false,
      answer: IMPORTED_BRIEFING_EMPTY.benchmarkAnswer,
      summary: IMPORTED_BRIEFING_EMPTY.benchmarkSummary,
      why: DISCLOSURE_STATEMENT[DISCLOSURE_GAP.noAnalysis],
      cohort: null,
      comparisons: Object.freeze([]),
      provenance,
      unavailable: gap(DISCLOSURE.benchmark, DISCLOSURE_GAP.noAnalysis),
    });
  }
  if (!benchmark?.eligible || !cohort || !Number.isFinite(Number(cohort.medianScore))) {
    return Object.freeze({
      key: DISCLOSURE.benchmark,
      available: false,
      answer: IMPORTED_BRIEFING_EMPTY.benchmarkAnswer,
      summary: IMPORTED_BRIEFING_EMPTY.benchmarkSummary,
      // The envelope's own sentence, verbatim, when it has one: the analysis
      // knows why it refused and this card is not entitled to a second opinion.
      why: typeof benchmark?.message === "string" && benchmark.message.trim()
        ? benchmark.message.trim()
        : DISCLOSURE_STATEMENT[DISCLOSURE_GAP.noBenchmarkCohort],
      cohort: null,
      comparisons: Object.freeze([]),
      provenance,
      unavailable: gap(DISCLOSURE.benchmark,
        // The analysis's code when it published one, so a consumer branching on
        // `no_compatible_cohort` still sees it.
        typeof benchmark?.reasonCode === "string" && benchmark.reasonCode
          ? benchmark.reasonCode : DISCLOSURE_GAP.noBenchmarkCohort,
        typeof benchmark?.message === "string" ? benchmark.message : null),
    });
  }
  const size = Number(cohort.size) || 0;
  const median = Number(cohort.medianScore);
  return Object.freeze({
    key: DISCLOSURE.benchmark,
    available: true,
    answer: `Cohort median ${median} across ${size} graded department${size === 1 ? "" : "s"}`,
    summary: `${cohort.kind === "intra_tenant" ? "Intra-tenant cohort" : "Cohort"} · `
      + `${size} graded department${size === 1 ? "" : "s"} · median ${median}`,
    why: typeof benchmark.message === "string" && benchmark.message.trim()
      ? benchmark.message.trim() : "",
    cohort: Object.freeze({ kind: cohort.kind ?? null, size, medianScore: median }),
    comparisons: Object.freeze([...(benchmark.comparisons ?? [])]),
    provenance,
    unavailable: null,
  });
}

/**
 * The recommendation-evidence list, and the sentence the list carries when the
 * analysis produced none.
 *
 * The lines are the envelope's, unedited: they name the same department the
 * savings figure is on, because both are read off `topDepartment`.
 */
function evidenceDisclosure(state, provenance) {
  const items = trimmedStrings(state.analysis?.evidence);
  const ranked = Boolean(state.analysis?.topDepartment);
  if (!state.analysis) {
    return Object.freeze({
      key: DISCLOSURE.evidence,
      available: false,
      items: Object.freeze([]),
      emptyText: DISCLOSURE_STATEMENT[DISCLOSURE_GAP.noAnalysis],
      provenance,
      unavailable: gap(DISCLOSURE.evidence, DISCLOSURE_GAP.noAnalysis),
    });
  }
  if (!ranked || !items.length) {
    const reason = ranked ? DISCLOSURE_GAP.noFigurePublished : DISCLOSURE_GAP.noRankedDepartment;
    return Object.freeze({
      key: DISCLOSURE.evidence,
      available: false,
      items: Object.freeze([]),
      emptyText: DISCLOSURE_STATEMENT[reason],
      provenance,
      unavailable: gap(DISCLOSURE.evidence, reason),
    });
  }
  return Object.freeze({
    key: DISCLOSURE.evidence,
    available: true,
    items: Object.freeze(items),
    emptyText: DISCLOSURE_STATEMENT[DISCLOSURE_GAP.noFigurePublished],
    provenance,
    unavailable: null,
  });
}

/**
 * The quantified-impact figure, the department it is on, and the one action it
 * sizes — one decision, made once.
 *
 * `real` is not `available`: the example dataset publishes a genuine computed
 * figure that is still not a fact about the reader's spend, so it is shown and
 * marked unreal. Only an import's own figure is real.
 *
 * The action is decided from the totals rather than from the withholding. A
 * suppressed figure does not retract the ranked recommendation — the department
 * is still the one to act on, and only the amount is unsafe to print — whereas
 * totals outside the display range mean there is nothing to act on yet.
 */
export const SAVINGS_NEXT_STEP = Object.freeze({
  [DISCLOSURE_GAP.totalsOutsideRange]:
    "Review imported totals before selecting a department action.",
  [DISCLOSURE_GAP.noAnalysis]: DISCLOSURE_STATEMENT[DISCLOSURE_GAP.noAnalysis],
  [DISCLOSURE_GAP.noRankedDepartment]: DISCLOSURE_STATEMENT[DISCLOSURE_GAP.noRankedDepartment],
});

function savingsDisclosure(state, provenance) {
  const analysis = state.analysis;
  const recoverable = Number(analysis?.recoverableUsd);
  const department = analysis?.topDepartment?.name ?? IMPORTED_BRIEFING_EMPTY.department;
  const rankedAction = typeof analysis?.action === "string" && analysis.action.trim()
    ? analysis.action.trim()
    : SAVINGS_NEXT_STEP[DISCLOSURE_GAP.noRankedDepartment];
  const refuse = (reason, value, { keepAction = false } = {}) => Object.freeze({
    key: DISCLOSURE.savings,
    available: false,
    real: false,
    value,
    department,
    action: keepAction ? rankedAction : (SAVINGS_NEXT_STEP[reason] ?? DISCLOSURE_STATEMENT[reason]),
    provenance,
    unavailable: gap(DISCLOSURE.savings, reason),
  });
  if (!analysis) return refuse(DISCLOSURE_GAP.noAnalysis, "—");
  if (!state.plausible) return refuse(DISCLOSURE_GAP.totalsOutsideRange, "Needs review");
  if (state.attributionWithheld) {
    return refuse(DISCLOSURE_GAP.attributionBelowFloor, "Not shown · attribution below floor",
      { keepAction: true });
  }
  if (!Number.isFinite(recoverable)) {
    return refuse(DISCLOSURE_GAP.noFigurePublished, "—", { keepAction: true });
  }
  return Object.freeze({
    key: DISCLOSURE.savings,
    available: true,
    real: state.source === DISCLOSURE_SOURCE.import,
    value: MONEY(recoverable),
    department,
    action: rankedAction,
    provenance,
    unavailable: null,
  });
}

/**
 * The four disclosures, composed from one state.
 *
 * Pure and total: the same state produces a deep-equal result every time, and a
 * state with no analysis produces four stated gaps rather than throwing.
 */
export function guidedDisclosures(state) {
  const resolved = state && typeof state === "object" && "allowsBundledFigures" in state
    ? state : importedAnalysisState(state ?? {});
  const provenance = stateProvenance(resolved);
  return Object.freeze({
    version: GUIDED_DISCLOSURES_VERSION,
    source: resolved.source,
    allowsBundledFigures: resolved.allowsBundledFigures,
    provenance,
    guided: Object.freeze({
      finding: findingDisclosure(resolved, provenance),
      benchmark: benchmarkDisclosure(resolved, provenance),
      evidence: evidenceDisclosure(resolved, provenance),
      savings: savingsDisclosure(resolved, provenance),
    }),
  });
}
