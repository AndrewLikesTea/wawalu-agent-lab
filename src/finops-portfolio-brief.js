// The portfolio-primary brief: one answer over every provider that was combined.
//
// WHAT THIS FIXES. Once `planMultiProviderIntake` accepted two providers' exports
// and merged them into one billing window, the workspace still led with a brief
// written for one provider's analysis. The reader's combined total was on screen,
// but the answer above it did not say it was combined, did not say who was in it,
// and did not say who had been held out — the coverage panel two destinations
// away held those facts, so "we read three providers and dropped one" was a thing
// a lead had to go and find. A portfolio total whose composition is elsewhere is a
// number a lead cannot defend in the meeting they brought it to.
//
// So when compatible multi-provider evidence exists, the brief is the portfolio's:
// the aligned total leads, and the five things a lead is judged on — one
// benchmark, impact, confidence, provenance, one next action — are stated beside
// it before any provider-level detail. Provider composition, exclusions, period
// coverage, and the validation reasons follow as disclosures, so the summary stays
// one screen and the evidence stays one keystroke away.
//
// WHAT MAKES A PORTFOLIO. Two or more distinct providers accepted into the same
// billing window by the intake contract — `multiProvider.comparability.state` of
// `combined` or `combined_bounded`. Anything else is not a portfolio and this
// module says so by returning `available: false`: one provider, a bundle that
// already arrived combined, or a selection the intake contract reduced to one
// provider all keep the single-provider brief the page has always rendered. That
// is the contract's first promise held one layer up.
//
// EXACTLY ONE, TWICE OVER.
//
//   * One benchmark. Two efficiency comparisons can be available at once — a peer
//     cohort scored against the same rubric, and the analysis's own recoverable
//     share. A brief that showed both would make the reader choose which one the
//     decision rests on. The peer cohort wins when it is eligible, because it
//     compares this organization against others rather than against itself;
//     otherwise the recoverable share, which needs only the reader's own export;
//     otherwise nothing, with the reason the cohort gave.
//   * One next action. The analysis's own rank-1 recommendation, with the
//     department accountable for it. Never a list: a list is a backlog, and this
//     brief exists to be acted on once.
//
// WHAT IT NEVER DOES. No DOM, no storage, no clock, no randomness, no fetch. It
// reads one analysis envelope and returns a plain object. Every string it emits
// is authored here or arrives on the envelope as a provider label, an adapter
// version, a period, an export id, a count, or the analysis's own authored
// sentence — never a cell value and never prompt text.
//
// PER-PROVIDER MONEY IS NOT INVENTED. The intake contract merges a window's
// providers into one period before any total is computed, so the envelope holds no
// per-provider spend and this module will not manufacture one by apportioning the
// total. The composition disclosure states what each provider did contribute —
// windows, adapter version, settlement state, what its cost column means — and
// says plainly that the money is not separable once merged.

// Whether a figure may be shown as a fact is already decided for this product;
// this module asks rather than re-deriving a range of its own.
import { metricState } from "./finops-display.js";

/** Bump when a slot, a selection rule, or a state boundary changes meaning. */
export const PORTFOLIO_BRIEF_VERSION = "finops-portfolio-brief/1.0.0";

/** The question a portfolio brief answers. */
export const PORTFOLIO_QUESTION = "Across the providers we combined, where is the money going?";

/**
 * The three states a portfolio brief can be in.
 *
 * `trusted` — every selected export was combined and nothing bounds the total.
 * `partial` — the total is publishable but bounded: an export was held out, a
 *   period was provisional or partial, or a slot could not be filled.
 * `blocked` — portfolio evidence exists and no total may be published from it.
 *   The figures are withheld rather than shown with a caveat, because a figure a
 *   reader can read is a figure they will quote.
 */
export const PORTFOLIO_STATE = Object.freeze({
  trusted: "trusted",
  partial: "partial",
  blocked: "blocked",
});

/** The intake comparability states that mean "several providers were combined". */
const COMBINED_STATES = Object.freeze(["combined", "combined_bounded"]);

/** The disclosure ids, in the order a reader opens them. */
export const PORTFOLIO_DISCLOSURES = Object.freeze([
  "composition", "exclusions", "coverage", "validation",
]);

const usable = (value) => metricState(value, "spendUsd").plausible;

const list = (value) => (Array.isArray(value) ? value : []);

const wholeUsd = (value) => `${Math.round(value).toLocaleString("en-US")} USD`;

const percentOf = (part, whole) => `${Math.round((part / whole) * 100)}%`;

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

function unavailable(reason) {
  return Object.freeze({
    version: PORTFOLIO_BRIEF_VERSION,
    available: false,
    state: null,
    reason,
  });
}

/**
 * The one efficiency benchmark this brief rests on.
 *
 * Returns the selected comparison and, when a candidate was passed over, why —
 * so a reader who expected the peer cohort learns it was not eligible here rather
 * than assuming the page forgot it.
 */
export function selectPortfolioBenchmark(analysis) {
  const benchmark = analysis?.benchmark ?? null;
  const cohortEligible = benchmark?.eligible === true
    && list(benchmark.comparisons).length > 0;
  if (cohortEligible) {
    return Object.freeze({
      available: true,
      selected: "peer_cohort",
      label: "Peer cohort comparison",
      value: benchmark.message,
      detail: `Scored against ${plural(list(benchmark.comparisons).length, "cohort comparison")}`
        + `${benchmark.methodology ? ` under ${benchmark.methodology}` : ""}.`,
      passedOver: null,
    });
  }
  const spend = analysis?.spendUsd;
  const recoverable = analysis?.recoverableUsd;
  const shareUsable = usable(spend) && usable(recoverable) && spend > 0 && recoverable <= spend;
  const cohortReason = benchmark?.message
    ?? "No imported peer cohort was scored with the same rubric.";
  if (!shareUsable) {
    return Object.freeze({
      available: false,
      selected: null,
      label: "Efficiency benchmark",
      value: "No efficiency benchmark is available for this portfolio.",
      detail: cohortReason,
      passedOver: null,
    });
  }
  return Object.freeze({
    available: true,
    selected: "recoverable_share",
    label: "Potentially recoverable share of aligned spend",
    value: `${percentOf(recoverable, spend)} of the aligned total`,
    detail: `${wholeUsd(recoverable)} of ${wholeUsd(spend)} is modelled as recoverable under the `
      + "routing scenario. It is a ceiling on what re-routing could recover, not a measured saving.",
    passedOver: `Peer cohort: ${cohortReason}`,
  });
}

/** The one prioritized next action, and the department accountable for it. */
function selectNextAction(analysis) {
  const top = analysis?.topDepartment ?? null;
  const text = typeof analysis?.action === "string" ? analysis.action : "";
  if (!text) {
    return Object.freeze({
      available: false,
      text: "No action is ranked from this portfolio yet.",
      accountable: null,
      rank: null,
    });
  }
  return Object.freeze({
    available: Boolean(top),
    text,
    accountable: top?.name ?? null,
    rank: top ? 1 : null,
  });
}

function compositionRows(summary) {
  return list(summary.providers).map((provider) => Object.freeze({
    term: provider.label,
    detail: [
      `${plural(list(provider.periods).length, "aligned period")}`,
      provider.adapterId
        ? `read by adapter ${provider.adapterId} v${provider.adapterVersion}`
        : "no declared adapter",
      provider.state === "settled" ? "settled" : provider.state.replace(/_/g, " "),
      provider.comparabilityNote || null,
    ].filter(Boolean).join(" · "),
  }));
}

function exclusionRows(analysis, summary) {
  const rejections = list(summary.rejections);
  if (rejections.length === 0) return [];
  return rejections.map((held) => Object.freeze({
    term: `${held.providerLabel} — ${String(held.code).replace(/_/g, " ")}`,
    detail: `${held.message} ${held.action}`.trim(),
  }));
}

function coverageRows(analysis) {
  const history = analysis?.history ?? null;
  const periods = list(history?.periods);
  const rows = periods.map((entry) => Object.freeze({
    term: entry.period,
    detail: usable(entry.spendUsd)
      ? `${wholeUsd(entry.spendUsd)} aligned · export ${entry.exportId}`
      : `Total withheld: outside the supported display range · export ${entry.exportId}`,
  }));
  if (history?.message) {
    rows.push(Object.freeze({ term: "Adjacent-period history", detail: history.message }));
  }
  return rows;
}

function validationRows(analysis) {
  const results = list(analysis?.validation?.results);
  return results.map((result) => Object.freeze({
    term: `${String(result.code).replace(/_/g, " ")} (${result.scope})`,
    detail: `${result.message} ${result.action}`.trim(),
  }));
}

/**
 * Build the portfolio-primary brief from one analysis envelope.
 *
 * @param analysis an envelope from `normalizeLocalFinopsHistory`.
 * @returns `{ available: false, reason }` when this is not a portfolio, or the
 *   brief: one aligned total, one benchmark, impact, confidence, provenance, one
 *   next action, and the four disclosures — in that order, which is the order the
 *   view paints and the order a reader reads.
 */
export function portfolioBrief(analysis) {
  const summary = analysis?.multiProvider ?? null;
  if (!summary) return unavailable("This analysis carries no multi-provider intake plan.");
  const state = summary.comparability?.state ?? null;
  if (!COMBINED_STATES.includes(state) || (summary.providerCount ?? 0) < 2) {
    return unavailable("One provider was read, so there is no portfolio to lead with.");
  }

  const spend = analysis.spendUsd;
  const recoverable = analysis.recoverableUsd;
  // The same pairing rule the headline already applies: a recoverable figure
  // larger than the spend it came out of invalidates both, not just itself.
  const spendPublishable = usable(spend)
    && (recoverable === undefined || recoverable === null
      || (usable(recoverable) && recoverable <= spend));
  const notes = list(summary.comparability?.notes);
  const rejections = list(summary.rejections);
  const validations = list(analysis.validation?.results);
  const benchmark = selectPortfolioBenchmark(analysis);
  const nextAction = selectNextAction(analysis);

  // Blocked first: a total outside the supported range, or a recoverable figure
  // larger than the spend it came out of, means the arithmetic on screen would be
  // wrong. Nothing is printed from it, and the reason names the export to inspect.
  const briefState = !spendPublishable
    ? PORTFOLIO_STATE.blocked
    : notes.length || rejections.length || validations.length
      || !benchmark.available || !nextAction.available
      ? PORTFOLIO_STATE.partial
      : PORTFOLIO_STATE.trusted;

  const providerLabels = list(summary.providers).map((provider) => provider.label);
  const periodCount = list(analysis.history?.periods).length;
  const disclosures = Object.freeze([
    Object.freeze({
      id: "composition",
      summary: `Which providers are inside this total (${providerLabels.length})`,
      note: "Windows covered by more than one provider are merged before any total is computed, "
        + "so the aligned figure cannot be split back into per-provider spend.",
      rows: Object.freeze(compositionRows(summary)),
    }),
    Object.freeze({
      id: "exclusions",
      summary: rejections.length
        ? `What was held out of this total (${rejections.length})`
        : "What was held out of this total (none)",
      note: rejections.length
        ? "Each line names the export, why the intake contract held it out, and the one action "
          + "that recovers it."
        : "Every selected export was combined into this total.",
      rows: Object.freeze(exclusionRows(analysis, summary)),
    }),
    Object.freeze({
      id: "coverage",
      summary: `Period coverage (${plural(periodCount, "aligned period")})`,
      note: "Every provider in a window covers the same billing window; a window no provider "
        + "aligned to is not in this total.",
      rows: Object.freeze(coverageRows(analysis)),
    }),
    Object.freeze({
      id: "validation",
      summary: validations.length
        ? `Validation and remediation (${validations.length})`
        : "Validation and remediation (none)",
      note: validations.length
        ? "Each reason is the reconciler's own code, scope, and the action that clears it."
        : "The reconciler raised nothing against this portfolio.",
      rows: Object.freeze(validationRows(analysis)),
    }),
  ]);

  return Object.freeze({
    version: PORTFOLIO_BRIEF_VERSION,
    available: true,
    state: briefState,
    reason: null,
    question: PORTFOLIO_QUESTION,
    contractVersion: summary.contractVersion ?? null,
    alignedSpend: Object.freeze({
      available: spendPublishable,
      usd: spendPublishable ? spend : null,
      text: spendPublishable ? wholeUsd(spend) : "Withheld",
      label: "Total aligned spend",
      detail: spendPublishable
        ? `${analysis.period} · ${plural(providerLabels.length, "provider")} on one billing window`
        : "A total is outside the supported display range, or recoverable spend exceeds observed "
          + "spend. Every figure is withheld; inspect the named exports before quoting one.",
      providerCount: providerLabels.length,
      providerLabels: Object.freeze(providerLabels),
      periodCount,
    }),
    benchmark,
    impact: Object.freeze({
      available: spendPublishable && usable(recoverable),
      usd: spendPublishable && usable(recoverable) ? recoverable : null,
      text: spendPublishable && usable(recoverable) ? wholeUsd(recoverable) : "Withheld",
      label: "Estimated impact · routing scenario",
      detail: "Estimated cost reduction over the aligned window under the stated routing rule. "
        + "Nothing here has been invoiced or realized.",
    }),
    confidence: Object.freeze({
      available: Boolean(analysis.decisionInputs?.confidence?.level),
      level: analysis.decisionInputs?.confidence?.level ?? "unavailable",
      basis: Object.freeze(list(analysis.decisionInputs?.confidence?.basis)),
      // The intake contract's own bounding notes, restated where the confidence
      // they bound is read. A partial export makes the total a floor, and a lead
      // who quotes the total needs that sentence next to it, not two panels away.
      bounds: Object.freeze(notes),
    }),
    provenance: Object.freeze({
      processing: summary.provenance?.processing ?? "browser_local_ephemeral",
      contract: summary.provenance?.contract ?? summary.contractVersion ?? null,
      adapters: Object.freeze(list(summary.provenance?.adapters)),
      exportIds: Object.freeze(list(summary.provenance?.acceptedExportIds)),
      combinedSourceInstanceId: summary.provenance?.combinedSourceInstanceId ?? null,
      text: `Combined in this browser tab from ${plural(providerLabels.length, "provider export")}`
        + ` under ${summary.provenance?.contract ?? summary.contractVersion ?? "the intake contract"}.`
        + " Nothing was uploaded.",
    }),
    nextAction,
    disclosures,
  });
}
