// The portfolio aggregate: one set of totals over several providers' evidence,
// with each provider's share of it still attached.
//
// WHAT THIS FIXES. `planMultiProviderIntake` folds every provider covering one
// billing window into a single merged period before any total is computed, so
// the analysis envelope carries a combined figure and no way back to who paid
// what. The portfolio brief says so in as many words: "the aligned figure cannot
// be split back into per-provider spend." That is true of the *merged period*,
// but it is not true of the *evidence*: every normalized record still declares
// its own `provider`, so the split survives the merge and only the arithmetic
// threw it away. A lead who is told "138,000 USD across three providers" and
// cannot say which provider is 60% of it has one number and no decision.
//
// So this module re-derives the portfolio from record-level provider identity:
// aligned spend, usage, delivery efficiency, each provider's contribution, and
// the trend inputs — every figure traceable to the provider, period, and export
// it came out of.
//
// THE THREE RULES THAT MAKE A TOTAL DEFENSIBLE.
//
//   1. IDENTITY IS EXPLICIT AND STABLE. One unit of portfolio evidence is one
//      provider's records inside one billing window: `provider@start/end`. The
//      id is derived from declared fields only — never from array order, never
//      from a hash of content, never from a clock — so the same selection always
//      produces the same ids, and a reader can point at one.
//   2. NOTHING IS COUNTED TWICE. The same evidence id twice is a duplicate and
//      the second copy is excluded. Two *different* windows of the same provider
//      that share a day overlap, and no arithmetic can separate the shared days,
//      so the later window is excluded whole. Both are reported with the id that
//      was kept, because "your total is smaller than your files" is a sentence a
//      reader must be able to check rather than discover.
//   3. NON-COMPARABLE EVIDENCE IS NOT BLENDED IN. A provider whose adapter
//      declares a cost basis other than `billed_amount` is not on the same
//      footing as one that does — unblended CUR cost excludes the credit rows
//      that a console amount already applied. It is excluded from the trusted
//      total and reported with its own basis, rather than quietly making the
//      portfolio read high.
//
// Every exclusion above is an observable result carrying a code, the provider,
// the evidence id, why, and the one action that recovers it. Nothing is dropped
// silently, and nothing incomparable reaches a published figure.
//
// SINGLE PROVIDER IS UNTOUCHED. Fewer than two distinct providers in the
// accepted evidence is not a portfolio: this module returns `available: false`
// with the reason, and every existing figure on the envelope is what it always
// was. Adding an aggregate must not change what a reader who imports one
// provider's periods sees.
//
// WHAT IT NEVER DOES. No DOM, no storage, no clock, no randomness, no fetch. It
// reads accepted period documents plus the intake summary and returns a plain
// frozen object. Every string it emits is authored here or arrives as a provider
// id, an adapter version, a period, an export id, or a count — never a cell
// value and never prompt text.

import { readUsageDetail } from "./provider-usage-record.js";

/** Bump when an identity rule, an exclusion code, or a figure changes meaning. */
export const PORTFOLIO_AGGREGATE_VERSION = "finops-portfolio-aggregate/1.0.0";

/**
 * The one cost basis that may enter a trusted portfolio total. Adapters declare
 * their own; anything else is reported beside the total instead of inside it.
 */
export const COMPARABLE_COST_BASIS = "billed_amount";

/** Every reason a unit of provider-period evidence is kept out of the total. */
export const PORTFOLIO_EXCLUSION_CODES = Object.freeze({
  DUPLICATE_EVIDENCE: "duplicate_evidence",
  OVERLAPPING_EVIDENCE: "overlapping_evidence",
  INCOMPARABLE_COST_BASIS: "incomparable_cost_basis",
});

/**
 * `trusted` — every unit of evidence was comparable and nothing bounds the total.
 * `partial` — a publishable total that something bounds: an exclusion, a partial
 *   export, or usage the exports do not fully report.
 * `blocked` — portfolio evidence exists and none of it is comparable, so no
 *   total is published at all.
 */
export const PORTFOLIO_AGGREGATE_STATE = Object.freeze({
  trusted: "trusted",
  partial: "partial",
  blocked: "blocked",
});

const list = (value) => (Array.isArray(value) ? value : []);

const usd = (minor) => Math.round(minor) / 100;

const money = (minor) => `${usd(minor).toFixed(2)} USD`;

const share = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

const dayStart = (date) => Date.parse(`${date}T00:00:00Z`);

/**
 * The identity of one unit of portfolio evidence: one provider inside one
 * billing window. Derived from declared fields only, so two runs over the same
 * selection produce the same id and a reader can quote it.
 */
export function portfolioEvidenceId({ provider, periodStart, periodEnd }) {
  return `${provider}@${periodStart}/${periodEnd}`;
}

function excluded(code, unit, why, action) {
  return Object.freeze({
    code,
    evidenceId: unit.evidenceId,
    provider: unit.provider,
    period: `${unit.periodStart} to ${unit.periodEnd}`,
    exportId: unit.exportId,
    spendUsd: usd(unit.spendMinor),
    message: why,
    action,
  });
}

// --- reading the evidence ---------------------------------------------------

/** A running count that knows whether every contributing record reported it. */
const counter = () => ({ sum: 0, complete: true });

function add(target, value) {
  if (value === null || value === undefined) target.complete = false;
  else target.sum += value;
}

function publishCount(target) {
  return Object.freeze({
    value: target.complete ? target.sum : null,
    observed: target.sum,
    complete: target.complete,
  });
}

/**
 * Split one accepted period document into one unit of evidence per provider.
 * The merge concatenated the providers' records but never erased `provider` on
 * any of them, so this is a regrouping of what is already there — not an
 * apportionment of the merged total, which this module would refuse to invent.
 */
function unitsOf(document) {
  const periodStart = document.snapshot.period_start;
  const periodEnd = document.snapshot.period_end;
  const byProvider = new Map();
  for (const record of list(document.records)) {
    const unit = byProvider.get(record.provider) ?? {
      evidenceId: portfolioEvidenceId({ provider: record.provider, periodStart, periodEnd }),
      provider: record.provider,
      periodStart,
      periodEnd,
      exportId: document.export_id,
      completeness: document.snapshot.completeness,
      start: dayStart(periodStart),
      end: dayStart(periodEnd),
      records: 0,
      spendMinor: 0,
      estimatedMinor: 0,
      requests: counter(),
      inputTokens: counter(),
      outputTokens: counter(),
      categories: new Map(),
    };
    const detail = readUsageDetail(record);
    unit.records += 1;
    unit.spendMinor += record.cost.amount_minor;
    if (record.cost.status !== "final") unit.estimatedMinor += record.cost.amount_minor;
    add(unit.requests, detail.request_count);
    add(unit.inputTokens, detail.input_tokens);
    add(unit.outputTokens, detail.output_tokens);
    unit.categories.set(record.service_category,
      (unit.categories.get(record.service_category) ?? 0) + record.cost.amount_minor);
    byProvider.set(record.provider, unit);
  }
  return [...byProvider.values()].sort((left, right) =>
    left.provider.localeCompare(right.provider));
}

/** The largest service category inside one unit, ties broken by name. */
function leadingCategory(unit) {
  return [...unit.categories.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] ?? null;
}

// --- the deduplication pass -------------------------------------------------

/**
 * Keep at most one unit per evidence id, and at most one window per provider
 * among windows that share a day. Deterministic in both directions: units are
 * visited in window order then provider order, and the first one kept wins.
 */
function deduplicate(units) {
  const kept = [];
  const rejected = [];
  const seen = new Map();
  const byProvider = new Map();
  for (const unit of units) {
    const held = seen.get(unit.evidenceId);
    if (held) {
      rejected.push(excluded(PORTFOLIO_EXCLUSION_CODES.DUPLICATE_EVIDENCE, unit,
        `${unit.provider} supplies ${unit.evidenceId} more than once; the first copy is counted `
        + `and this one is not.`,
        "Remove the repeated export, or re-export the window once."));
      continue;
    }
    const overlap = (byProvider.get(unit.provider) ?? [])
      .find((other) => unit.start < other.end && unit.end > other.start);
    if (overlap) {
      rejected.push(excluded(PORTFOLIO_EXCLUSION_CODES.OVERLAPPING_EVIDENCE, unit,
        `${unit.evidenceId} shares days with ${overlap.evidenceId}, which is already counted; `
        + "no arithmetic can separate the days they both bill.",
        "Re-export this provider on the same window boundaries as the counted one."));
      continue;
    }
    seen.set(unit.evidenceId, unit);
    byProvider.set(unit.provider, [...(byProvider.get(unit.provider) ?? []), unit]);
    kept.push(unit);
  }
  return { kept, rejected };
}

/**
 * What the intake contract declared about each provider, keyed by provider id.
 * A provider the summary does not name keeps its evidence — an undeclared cost
 * basis bounds the total, it does not disqualify the file — and says so.
 */
function declarationsOf(intake) {
  return new Map(list(intake?.providers).map((entry) => [entry.provider, entry]));
}

function screenComparability(units, declarations) {
  const kept = [];
  const rejected = [];
  for (const unit of units) {
    const declared = declarations.get(unit.provider) ?? null;
    const basis = declared?.costBasis ?? null;
    if (basis && basis !== COMPARABLE_COST_BASIS) {
      rejected.push(excluded(PORTFOLIO_EXCLUSION_CODES.INCOMPARABLE_COST_BASIS, unit,
        `${declared.label ?? unit.provider} reports ${basis.replace(/_/g, " ")}, which is not the `
        + "same basis as a billed amount, so it is reported beside the portfolio total rather "
        + "than inside it.",
        "Re-export this provider on a billed-amount basis, or read it as its own analysis."));
      continue;
    }
    kept.push({ ...unit, costBasis: basis, declared });
  }
  return { kept, rejected };
}

// --- the aligned figures ----------------------------------------------------

function windowOf(units) {
  const [first] = units;
  const spendMinor = units.reduce((sum, unit) => sum + unit.spendMinor, 0);
  const requests = counter();
  const inputTokens = counter();
  const outputTokens = counter();
  for (const unit of units) {
    for (const [target, source] of [[requests, unit.requests],
      [inputTokens, unit.inputTokens], [outputTokens, unit.outputTokens]]) {
      // The observed sum always accumulates; completeness is the weaker claim
      // and one silent provider makes the window's count a floor, not a total.
      target.sum += source.sum;
      if (!source.complete) target.complete = false;
    }
  }
  return Object.freeze({
    periodStart: first.periodStart,
    periodEnd: first.periodEnd,
    period: `${first.periodStart} to ${first.periodEnd}`,
    start: first.start,
    end: first.end,
    providerCount: units.length,
    providers: Object.freeze(units.map((unit) => unit.provider)),
    spendUsd: usd(spendMinor),
    spendMinor,
    estimatedUsd: usd(units.reduce((sum, unit) => sum + unit.estimatedMinor, 0)),
    records: units.reduce((sum, unit) => sum + unit.records, 0),
    usage: Object.freeze({
      requests: publishCount(requests),
      inputTokens: publishCount(inputTokens),
      outputTokens: publishCount(outputTokens),
    }),
    evidenceIds: Object.freeze(units.map((unit) => unit.evidenceId)),
  });
}

/** Each provider's share of one window, largest first, ties broken by id. */
function contributionsOf(units, spendMinor) {
  return Object.freeze([...units]
    .sort((left, right) => right.spendMinor - left.spendMinor
      || left.provider.localeCompare(right.provider))
    .map((unit) => {
      const category = leadingCategory(unit);
      return Object.freeze({
        provider: unit.provider,
        label: unit.declared?.label ?? unit.provider,
        evidenceId: unit.evidenceId,
        exportId: unit.exportId,
        adapter: unit.declared?.adapterId
          ? `${unit.declared.adapterId}/${unit.declared.adapterVersion}` : null,
        costBasis: unit.costBasis,
        spendUsd: usd(unit.spendMinor),
        sharePercent: share(unit.spendMinor, spendMinor),
        records: unit.records,
        leadingCategory: category ? category[0] : null,
        leadingCategoryUsd: category ? usd(category[1]) : null,
      });
    }));
}

/**
 * Spend per delivery over the current aligned window. A delivery counts when it
 * completed inside the window the spend was billed in — the same boundary rule
 * the spend-per-release contract uses, so the two figures cannot disagree about
 * which releases belong to a month.
 */
function deliveryEfficiencyOf(window, deliveries) {
  const stamps = list(deliveries)
    .map((entry) => Date.parse(typeof entry === "string" ? entry : entry?.completedAt ?? ""));
  const unreadable = stamps.filter((at) => Number.isNaN(at)).length;
  const inside = stamps.filter((at) => !Number.isNaN(at) && at >= window.start && at < window.end);
  if (inside.length === 0) {
    return Object.freeze({
      available: false,
      deliveries: 0,
      unreadableDeliveries: unreadable,
      spendPerDeliveryUsd: null,
      reason: list(deliveries).length === 0
        ? "No local delivery history was supplied, so spend cannot be divided by delivered work."
        : `No delivery completed inside ${window.period}, so a spend-per-delivery figure would `
          + "divide by zero.",
    });
  }
  return Object.freeze({
    available: true,
    deliveries: inside.length,
    unreadableDeliveries: unreadable,
    spendPerDeliveryUsd: Math.round((window.spendMinor / inside.length)) / 100,
    reason: null,
  });
}

/**
 * Trend inputs, and the one rule that makes them honest: a portfolio whose
 * provider set changed between the two windows did not get more expensive, it
 * got wider. Mix shift is reported as ineligible rather than as a change.
 */
function trendOf(current, previous) {
  if (!previous) {
    return Object.freeze({
      eligible: false,
      reason: "Only one aligned window carries portfolio evidence, so there is nothing to compare.",
      spendChangeUsd: null,
      spendChangePercent: null,
      previousPeriod: null,
      providerSetStable: false,
      providersAdded: Object.freeze([]),
      providersRemoved: Object.freeze([]),
    });
  }
  const before = new Set(previous.providers);
  const now = new Set(current.providers);
  const added = current.providers.filter((provider) => !before.has(provider));
  const removed = previous.providers.filter((provider) => !now.has(provider));
  const stable = added.length === 0 && removed.length === 0;
  const eligible = stable && previous.spendMinor > 0;
  return Object.freeze({
    eligible,
    reason: eligible ? null
      : !stable
        ? "The comparable provider set changed between the two windows, so the difference is a "
          + "mix shift rather than a trend."
        : "The preceding aligned window carries no comparable spend to compare against.",
    spendChangeUsd: eligible ? usd(current.spendMinor - previous.spendMinor) : null,
    spendChangePercent: eligible
      ? Math.round(((current.spendMinor - previous.spendMinor) / previous.spendMinor) * 1000) / 10
      : null,
    previousPeriod: previous.period,
    providerSetStable: stable,
    providersAdded: Object.freeze(added),
    providersRemoved: Object.freeze(removed),
  });
}

function confidenceOf({ observedProviders, comparableProviders, exclusions, window, bounds }) {
  const coveragePercent = share(comparableProviders, observedProviders);
  const usageComplete = window.usage.requests.complete
    && window.usage.inputTokens.complete && window.usage.outputTokens.complete;
  const level = comparableProviders < observedProviders || comparableProviders < 2
    ? "Low"
    : exclusions.length || bounds.length || !usageComplete ? "Medium" : "High";
  return Object.freeze({
    level,
    coveragePercent,
    comparableProviders,
    observedProviders,
    usageComplete,
    basis: Object.freeze([
      `${comparableProviders} of ${observedProviders} observed providers are on a comparable `
      + "billed-amount basis",
      exclusions.length
        ? `${exclusions.length} unit${exclusions.length === 1 ? "" : "s"} of evidence excluded `
          + "from the total"
        : "no evidence was excluded from the total",
      usageComplete
        ? "every counted record reports request and token usage"
        : "at least one counted record does not report request or token usage",
    ]),
    bounds: Object.freeze(bounds),
  });
}

// --- the one prioritized finding -------------------------------------------

/**
 * One finding, never a list. The largest comparable provider in the current
 * aligned window is the portfolio's biggest single lever, and the action names
 * it, its share, and the category the spend actually sits in.
 */
function findingOf({ window, contributions, trend, confidence, provenance, exclusions, windows }) {
  const [leader] = contributions;
  if (!leader) {
    return Object.freeze({
      available: false,
      reason: "No comparable provider evidence remains, so no portfolio finding is published.",
    });
  }
  const direction = trend.eligible && trend.spendChangePercent !== null
    ? `${trend.spendChangePercent > 0 ? "up" : trend.spendChangePercent < 0 ? "down" : "flat"} `
      + `${Math.abs(trend.spendChangePercent)}% against ${trend.previousPeriod}`
    : `no like-for-like trend (${trend.reason})`;
  return Object.freeze({
    available: true,
    id: `portfolio-contribution/${leader.evidenceId}`,
    title: `${leader.label} is the largest share of aligned portfolio spend`,
    summary: `${leader.label} accounts for ${money(Math.round(leader.spendUsd * 100))} of the `
      + `${money(window.spendMinor)} aligned across ${window.providerCount} providers in `
      + `${window.period} — ${leader.sharePercent}% of the portfolio, ${direction}.`,
    impact: Object.freeze({
      usd: leader.spendUsd,
      sharePercent: leader.sharePercent,
      portfolioSpendUsd: window.spendUsd,
      text: `${money(Math.round(leader.spendUsd * 100))} of ${money(window.spendMinor)} aligned `
        + `spend (${leader.sharePercent}%)`,
      basis: "Observed billed amounts over the current aligned window. Nothing here is a saving, "
        + "a forecast, or an invoice.",
    }),
    confidence,
    provenance,
    nextAction: Object.freeze({
      text: `Review ${leader.label}'s ${leader.leadingCategory ?? "largest"} spend of `
        + `${money(Math.round((leader.leadingCategoryUsd ?? leader.spendUsd) * 100))} before the `
        + `next billing window; it is the largest single lever in this portfolio.`,
      accountableProvider: leader.provider,
      evidenceId: leader.evidenceId,
    }),
    // Progressive disclosure: the answer above stands alone, and each level
    // below it is one keystroke away rather than a second page.
    disclosures: Object.freeze([
      Object.freeze({
        id: "providers",
        summary: `Provider contribution (${contributions.length})`,
        rows: Object.freeze(contributions.map((entry) => Object.freeze({
          term: `${entry.label} — ${entry.sharePercent}%`,
          detail: `${money(Math.round(entry.spendUsd * 100))} · ${entry.records} records · `
            + `${entry.evidenceId} · export ${entry.exportId}`
            + (entry.adapter ? ` · adapter ${entry.adapter}` : ""),
        }))),
      }),
      Object.freeze({
        id: "periods",
        summary: `Aligned periods (${windows.length})`,
        rows: Object.freeze(windows.map((entry) => Object.freeze({
          term: entry.period,
          detail: `${money(entry.spendMinor)} across ${entry.providerCount} provider`
            + `${entry.providerCount === 1 ? "" : "s"} · ${entry.records} records`,
        }))),
      }),
      Object.freeze({
        id: "excluded",
        summary: `Excluded from this total (${exclusions.length})`,
        rows: Object.freeze(exclusions.map((entry) => Object.freeze({
          term: `${entry.evidenceId} — ${entry.code.replace(/_/g, " ")}`,
          detail: `${entry.message} ${entry.action}`,
        }))),
      }),
    ]),
  });
}

// --- the aggregate ----------------------------------------------------------

function unavailable(reason) {
  return Object.freeze({
    version: PORTFOLIO_AGGREGATE_VERSION,
    available: false,
    state: null,
    reason,
  });
}

/**
 * Aggregate accepted provider evidence into one portfolio answer.
 *
 * @param periods accepted period entries — `{ document }` or bare documents,
 *   already reconciled by `normalizeLocalFinopsHistory`, in period order.
 * @param intake the `multiProvider` summary from `planMultiProviderIntake`,
 *   which is where each provider's declared cost basis and label come from.
 * @param deliveries optional local delivery records — `{ completedAt }` or ISO
 *   strings — counted only inside the current aligned window.
 * @returns `{ available: false, reason }` when fewer than two distinct providers
 *   supplied evidence, or the aggregate: aligned windows, per-provider
 *   contribution, delivery efficiency, trend inputs, every exclusion, and one
 *   prioritized finding.
 */
export function aggregatePortfolio({ periods = [], intake = null, deliveries = [] } = {}) {
  const documents = list(periods)
    .map((entry) => entry?.document ?? entry)
    .filter((document) => document && Array.isArray(document.records));
  if (documents.length === 0) return unavailable("No accepted provider period carries records.");

  const ordered = [...documents].sort((left, right) =>
    left.snapshot.period_start.localeCompare(right.snapshot.period_start)
    || left.snapshot.period_end.localeCompare(right.snapshot.period_end)
    || String(left.export_id).localeCompare(String(right.export_id)));
  const units = ordered.flatMap(unitsOf);
  const observedProviders = new Set(units.map((unit) => unit.provider));
  if (observedProviders.size < 2) {
    return unavailable("Fewer than two providers supplied evidence, so there is no portfolio to "
      + "aggregate and the single-provider analysis is unchanged.");
  }

  const deduped = deduplicate(units);
  const screened = screenComparability(deduped.kept, declarationsOf(intake));
  const exclusions = Object.freeze([...deduped.rejected, ...screened.rejected]);
  const comparableProviders = new Set(screened.kept.map((unit) => unit.provider));

  const byWindow = new Map();
  for (const unit of screened.kept) {
    const key = `${unit.periodStart}/${unit.periodEnd}`;
    byWindow.set(key, [...(byWindow.get(key) ?? []), unit]);
  }
  const windows = [...byWindow.values()]
    .map(windowOf)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const current = windows.at(-1) ?? null;
  const previous = windows.at(-2) ?? null;

  const provenance = Object.freeze({
    processing: "browser_local_ephemeral",
    aggregateVersion: PORTFOLIO_AGGREGATE_VERSION,
    intakeContract: intake?.contractVersion ?? null,
    adapters: Object.freeze(list(intake?.provenance?.adapters)),
    exportIds: Object.freeze([...new Set(ordered.map((document) => document.export_id))].sort()),
    evidenceIds: Object.freeze(screened.kept.map((unit) => unit.evidenceId)),
    identityRule: "One unit of evidence is one provider inside one billing window: "
      + "provider@period_start/period_end.",
  });

  if (!current) {
    return Object.freeze({
      version: PORTFOLIO_AGGREGATE_VERSION,
      available: true,
      state: PORTFOLIO_AGGREGATE_STATE.blocked,
      reason: "Every unit of portfolio evidence was excluded, so no total is published.",
      observedProviders: Object.freeze([...observedProviders].sort()),
      comparableProviders: Object.freeze([]),
      windows: Object.freeze([]),
      current: null,
      previous: null,
      contributions: Object.freeze([]),
      deliveryEfficiency: null,
      trend: null,
      confidence: null,
      provenance,
      exclusions,
      finding: findingOf({
        window: null, contributions: [], trend: null, confidence: null, provenance,
        exclusions, windows: [],
      }),
    });
  }

  const bounds = list(intake?.comparability?.notes);
  const contributions = contributionsOf(
    screened.kept.filter((unit) => unit.periodStart === current.periodStart
      && unit.periodEnd === current.periodEnd),
    current.spendMinor,
  );
  const trend = trendOf(current, previous);
  const confidence = confidenceOf({
    observedProviders: observedProviders.size,
    comparableProviders: comparableProviders.size,
    exclusions,
    window: current,
    bounds,
  });
  const state = exclusions.length || bounds.length || confidence.level !== "High"
    ? PORTFOLIO_AGGREGATE_STATE.partial
    : PORTFOLIO_AGGREGATE_STATE.trusted;

  return Object.freeze({
    version: PORTFOLIO_AGGREGATE_VERSION,
    available: true,
    state,
    reason: null,
    observedProviders: Object.freeze([...observedProviders].sort()),
    comparableProviders: Object.freeze([...comparableProviders].sort()),
    windows: Object.freeze(windows),
    current,
    previous,
    contributions,
    deliveryEfficiency: deliveryEfficiencyOf(current, deliveries),
    trend,
    confidence,
    provenance,
    exclusions,
    finding: findingOf({
      window: current, contributions, trend, confidence, provenance, exclusions, windows,
    }),
  });
}
