// The portfolio aggregate: one total over several providers, still traceable to
// each of them.
//
// Every document in here is generated in-test from the normalized provider
// contract rather than committed as a fixture, so a field spelling cannot drift
// away from the model that claims to read it. Nothing reaches the network, a
// credential, or a real export.

import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPARABLE_COST_BASIS, PORTFOLIO_AGGREGATE_STATE, PORTFOLIO_EXCLUSION_CODES,
  aggregatePortfolio, portfolioEvidenceId,
} from "../src/finops-portfolio-aggregate.js";
import { portfolioBrief } from "../src/finops-portfolio-brief.js";
import { parseLocalImportFile } from "../src/finops-tabular-import.js";
import { normalizeLocalFinopsHistory } from "../src/local-finops.js";
import { PROVIDER_USAGE_CONTRACT_KIND } from "../src/provider-usage-record.js";

// --- generated evidence -----------------------------------------------------

function record({ provider, day, minor, category = "text-generation", detail = {} }) {
  return {
    aggregate_id: `agg_${provider}_${day.replace(/-/g, "")}_${category.slice(0, 3)}`,
    org_unit_id: "ou_platform",
    revision: 0,
    usage_date: day,
    provider,
    service_category: category,
    cost: { amount_minor: minor, currency: "USD", status: "final" },
    usage: { quantity: 1000, unit: "tokens" },
    model_raw: "gpt-5",
    model_tier: "premium",
    request_count: 10,
    input_tokens: 1000,
    output_tokens: 500,
    ...detail,
  };
}

function document({ periodStart, periodEnd, exportId, records }) {
  return {
    schema_version: "1.1",
    kind: PROVIDER_USAGE_CONTRACT_KIND,
    export_id: exportId,
    snapshot: {
      source_instance_id: "psn_multi_provider_intake_v1_0001",
      sequence: 1,
      generated_at: "2026-03-01T00:00:00Z",
      period_start: periodStart,
      period_end: periodEnd,
      completeness: "complete",
      omitted_record_count: 0,
      issues: [],
    },
    privacy: {
      aggregation: "org_unit_day",
      minimum_group_size: 5,
      direct_identifiers_included: false,
      content_included: false,
    },
    records,
  };
}

/** January, two providers, 300.00 USD of OpenAI against 100.00 USD of Anthropic. */
function januaryPair() {
  return document({
    periodStart: "2026-01-01",
    periodEnd: "2026-02-01",
    exportId: "exp_jan",
    records: [
      record({ provider: "openai", day: "2026-01-01", minor: 20_000 }),
      record({ provider: "openai", day: "2026-01-02", minor: 10_000 }),
      record({ provider: "openai", day: "2026-01-03", minor: 5_000, category: "embedding" }),
      record({ provider: "anthropic", day: "2026-01-01", minor: 10_000 }),
    ],
  });
}

function februaryPair() {
  return document({
    periodStart: "2026-02-01",
    periodEnd: "2026-03-01",
    exportId: "exp_feb",
    records: [
      record({ provider: "openai", day: "2026-02-01", minor: 40_000 }),
      record({ provider: "anthropic", day: "2026-02-01", minor: 20_000 }),
    ],
  });
}

const declared = (provider, label, costBasis = COMPARABLE_COST_BASIS) => ({
  provider,
  label,
  adapterId: `${provider}-usage`,
  adapterVersion: "1.0",
  costBasis,
  state: "settled",
});

function intakeSummary(providers, notes = []) {
  return {
    contractVersion: "wawalu.integration.multi-provider-intake/1.0",
    providerCount: providers.length,
    providers,
    comparability: { state: "combined", basis: "test", message: "", notes },
    rejections: [],
    provenance: {
      processing: "browser_local_ephemeral",
      adapters: providers.map((entry) => `${entry.adapterId}/${entry.adapterVersion}`),
    },
  };
}

const BOTH = [declared("openai", "OpenAI organization usage export"),
  declared("anthropic", "Anthropic workspace usage export")];

// --- stable totals ----------------------------------------------------------

test("aligned totals are stable, and every provider's contribution adds back up to them", () => {
  const intake = intakeSummary(BOTH);
  const periods = [{ document: januaryPair() }, { document: februaryPair() }];
  const aggregate = aggregatePortfolio({ periods, intake });

  assert.equal(aggregate.available, true);
  assert.equal(aggregate.state, PORTFOLIO_AGGREGATE_STATE.trusted);
  assert.deepEqual(aggregate.observedProviders, ["anthropic", "openai"]);
  // The current window is February; the aligned total is both providers in it.
  assert.equal(aggregate.current.period, "2026-02-01 to 2026-03-01");
  assert.equal(aggregate.current.spendUsd, 600);
  assert.equal(aggregate.previous.spendUsd, 450);
  assert.equal(aggregate.windows.length, 2);

  const contributed = aggregate.contributions
    .reduce((sum, entry) => sum + Math.round(entry.spendUsd * 100), 0);
  assert.equal(contributed, Math.round(aggregate.current.spendUsd * 100));
  assert.deepEqual(aggregate.contributions.map((entry) => entry.provider), ["openai", "anthropic"]);
  assert.deepEqual(aggregate.contributions.map((entry) => entry.sharePercent), [66.7, 33.3]);
  assert.equal(aggregate.contributions[0].evidenceId,
    portfolioEvidenceId({ provider: "openai", periodStart: "2026-02-01", periodEnd: "2026-03-01" }));

  // Usage is summed only where every counted record reported it.
  assert.equal(aggregate.current.usage.requests.value, 20);
  assert.equal(aggregate.current.usage.inputTokens.value, 2000);
  assert.equal(aggregate.current.usage.requests.complete, true);

  // Determinism: the same evidence in any input order is the same answer.
  const reversed = aggregatePortfolio({ periods: [...periods].reverse(), intake });
  assert.deepEqual(JSON.parse(JSON.stringify(reversed)), JSON.parse(JSON.stringify(aggregate)));
});

test("an export that does not report usage makes the window's counts a floor, not a total", () => {
  const partial = document({
    periodStart: "2026-01-01",
    periodEnd: "2026-02-01",
    exportId: "exp_partial",
    records: [
      record({ provider: "openai", day: "2026-01-01", minor: 10_000 }),
      record({
        provider: "anthropic",
        day: "2026-01-01",
        minor: 5_000,
        detail: { request_count: null, input_tokens: null, output_tokens: null },
      }),
    ],
  });
  const aggregate = aggregatePortfolio({ periods: [{ document: partial }], intake: intakeSummary(BOTH) });
  assert.equal(aggregate.current.spendUsd, 150);
  assert.equal(aggregate.current.usage.requests.value, null);
  assert.equal(aggregate.current.usage.requests.observed, 10);
  assert.equal(aggregate.confidence.usageComplete, false);
  assert.equal(aggregate.confidence.level, "Medium");
  assert.equal(aggregate.state, PORTFOLIO_AGGREGATE_STATE.partial);
});

// --- double counting --------------------------------------------------------

test("the same provider-period evidence supplied twice is counted once and reported", () => {
  const twice = [{ document: januaryPair() }, { document: januaryPair() }];
  const aggregate = aggregatePortfolio({ periods: twice, intake: intakeSummary(BOTH) });

  assert.equal(aggregate.current.spendUsd, 450);
  assert.equal(aggregate.windows.length, 1);
  assert.equal(aggregate.exclusions.length, 2);
  for (const held of aggregate.exclusions) {
    assert.equal(held.code, PORTFOLIO_EXCLUSION_CODES.DUPLICATE_EVIDENCE);
    assert.ok(held.action, "an exclusion always names the action that recovers it");
  }
  assert.deepEqual(aggregate.exclusions.map((held) => held.evidenceId).sort(),
    ["anthropic@2026-01-01/2026-02-01", "openai@2026-01-01/2026-02-01"]);
});

test("two windows of one provider that share days cannot both be counted", () => {
  const midMonth = document({
    periodStart: "2026-01-15",
    periodEnd: "2026-02-15",
    exportId: "exp_mid",
    records: [
      record({ provider: "openai", day: "2026-01-20", minor: 99_000 }),
      record({ provider: "anthropic", day: "2026-01-20", minor: 1_000 }),
    ],
  });
  const aggregate = aggregatePortfolio({
    periods: [{ document: januaryPair() }, { document: midMonth }],
    intake: intakeSummary(BOTH),
  });

  // January is visited first and kept whole; the overlapping window is excluded
  // whole, for both of its providers, rather than partly summed.
  assert.equal(aggregate.windows.length, 1);
  assert.equal(aggregate.current.period, "2026-01-01 to 2026-02-01");
  assert.equal(aggregate.current.spendUsd, 450);
  assert.equal(aggregate.exclusions.length, 2);
  assert.deepEqual([...new Set(aggregate.exclusions.map((held) => held.code))],
    [PORTFOLIO_EXCLUSION_CODES.OVERLAPPING_EVIDENCE]);
  assert.match(aggregate.exclusions[0].message, /shares days with/);
  assert.equal(aggregate.state, PORTFOLIO_AGGREGATE_STATE.partial);
});

// --- incomparable evidence --------------------------------------------------

test("a provider on another cost basis is reported beside the total, never inside it", () => {
  const mixed = document({
    periodStart: "2026-01-01",
    periodEnd: "2026-02-01",
    exportId: "exp_mixed",
    records: [
      record({ provider: "openai", day: "2026-01-01", minor: 30_000 }),
      record({ provider: "anthropic", day: "2026-01-01", minor: 10_000 }),
      record({ provider: "aws", day: "2026-01-01", minor: 500_000 }),
    ],
  });
  const intake = intakeSummary([...BOTH,
    declared("aws", "Amazon Bedrock CUR export", "unblended_cost")]);
  const aggregate = aggregatePortfolio({ periods: [{ document: mixed }], intake });

  assert.equal(aggregate.current.spendUsd, 400, "the 5,000 USD CUR line is not blended in");
  assert.deepEqual(aggregate.comparableProviders, ["anthropic", "openai"]);
  assert.deepEqual(aggregate.observedProviders, ["anthropic", "aws", "openai"]);
  const [held] = aggregate.exclusions;
  assert.equal(held.code, PORTFOLIO_EXCLUSION_CODES.INCOMPARABLE_COST_BASIS);
  assert.equal(held.provider, "aws");
  assert.equal(held.spendUsd, 5000);
  assert.match(held.message, /unblended cost/);
  assert.equal(aggregate.state, PORTFOLIO_AGGREGATE_STATE.partial);
});

test("partial coverage lowers confidence and states the coverage it is bounded by", () => {
  const intake = intakeSummary([...BOTH,
    declared("aws", "Amazon Bedrock CUR export", "unblended_cost")]);
  const covered = aggregatePortfolio({
    periods: [{
      document: document({
        periodStart: "2026-01-01",
        periodEnd: "2026-02-01",
        exportId: "exp_cover",
        records: [
          record({ provider: "openai", day: "2026-01-01", minor: 30_000 }),
          record({ provider: "anthropic", day: "2026-01-01", minor: 10_000 }),
          record({ provider: "aws", day: "2026-01-01", minor: 20_000 }),
        ],
      }),
    }],
    intake,
  });
  assert.equal(covered.confidence.level, "Low");
  assert.equal(covered.confidence.comparableProviders, 2);
  assert.equal(covered.confidence.observedProviders, 3);
  assert.equal(covered.confidence.coveragePercent, 66.7);

  // Full coverage with nothing bounding it is the only way to reach High.
  const full = aggregatePortfolio({ periods: [{ document: januaryPair() }], intake: intakeSummary(BOTH) });
  assert.equal(full.confidence.level, "High");
  assert.equal(full.confidence.coveragePercent, 100);
});

test("when nothing comparable survives, the aggregate blocks rather than publishing a total", () => {
  const intake = intakeSummary([
    declared("aws", "Amazon Bedrock CUR export", "unblended_cost"),
    declared("google", "Vertex export", "list_price"),
  ]);
  const aggregate = aggregatePortfolio({
    periods: [{
      document: document({
        periodStart: "2026-01-01",
        periodEnd: "2026-02-01",
        exportId: "exp_none",
        records: [
          record({ provider: "aws", day: "2026-01-01", minor: 10_000 }),
          record({ provider: "google", day: "2026-01-01", minor: 10_000 }),
        ],
      }),
    }],
    intake,
  });
  assert.equal(aggregate.available, true);
  assert.equal(aggregate.state, PORTFOLIO_AGGREGATE_STATE.blocked);
  assert.equal(aggregate.current, null);
  assert.equal(aggregate.finding.available, false);
  assert.equal(aggregate.exclusions.length, 2);
});

// --- trend, delivery efficiency, and the one finding ------------------------

test("a changed provider set is a mix shift, not a trend", () => {
  const january = document({
    periodStart: "2026-01-01",
    periodEnd: "2026-02-01",
    exportId: "exp_jan_one",
    records: [record({ provider: "openai", day: "2026-01-01", minor: 10_000 })],
  });
  const aggregate = aggregatePortfolio({
    periods: [{ document: january }, { document: februaryPair() }],
    intake: intakeSummary(BOTH),
  });
  assert.equal(aggregate.trend.eligible, false);
  assert.deepEqual(aggregate.trend.providersAdded, ["anthropic"]);
  assert.match(aggregate.trend.reason, /mix shift/);

  const stable = aggregatePortfolio({
    periods: [{ document: januaryPair() }, { document: februaryPair() }],
    intake: intakeSummary(BOTH),
  });
  assert.equal(stable.trend.eligible, true);
  assert.equal(stable.trend.spendChangeUsd, 150);
  assert.equal(stable.trend.spendChangePercent, 33.3);
});

test("delivery efficiency divides the aligned window only by deliveries inside it", () => {
  const periods = [{ document: februaryPair() }];
  const intake = intakeSummary(BOTH);
  const inside = aggregatePortfolio({
    periods,
    intake,
    deliveries: [
      { completedAt: "2026-02-03T10:00:00Z" },
      { completedAt: "2026-02-20T10:00:00Z" },
      { completedAt: "2026-01-20T10:00:00Z" },
      { completedAt: "not a date" },
    ],
  });
  assert.equal(inside.deliveryEfficiency.available, true);
  assert.equal(inside.deliveryEfficiency.deliveries, 2);
  assert.equal(inside.deliveryEfficiency.spendPerDeliveryUsd, 300);
  assert.equal(inside.deliveryEfficiency.unreadableDeliveries, 1);

  const none = aggregatePortfolio({ periods, intake });
  assert.equal(none.deliveryEfficiency.available, false);
  assert.equal(none.deliveryEfficiency.spendPerDeliveryUsd, null);
  assert.match(none.deliveryEfficiency.reason, /No local delivery history/);
});

test("one prioritized finding carries impact, confidence, provenance, action, and evidence", () => {
  const aggregate = aggregatePortfolio({
    periods: [{ document: januaryPair() }, { document: februaryPair() }],
    intake: intakeSummary(BOTH),
  });
  const finding = aggregate.finding;
  assert.equal(finding.available, true);
  assert.equal(finding.id, "portfolio-contribution/openai@2026-02-01/2026-03-01");
  assert.equal(finding.impact.usd, 400);
  assert.equal(finding.impact.sharePercent, 66.7);
  assert.equal(finding.confidence.level, "High");
  assert.equal(finding.provenance.processing, "browser_local_ephemeral");
  assert.ok(finding.provenance.exportIds.includes("exp_feb"));
  assert.match(finding.nextAction.text, /text-generation/);
  assert.equal(finding.nextAction.accountableProvider, "openai");
  assert.deepEqual(finding.disclosures.map((group) => group.id),
    ["providers", "periods", "excluded"]);
  assert.equal(finding.disclosures[0].rows.length, 2);
  assert.equal(finding.disclosures[1].rows.length, 2);
  assert.equal(finding.disclosures[2].rows.length, 0);
});

// --- wired into the analysis, and harmless to a single provider -------------

const OPENAI_HEADER =
  "usage_date,project,model,n_context_tokens_total,n_generated_tokens_total,amount,currency";
const ANTHROPIC_HEADER = "date,workspace,model,input_tokens,output_tokens,cost_usd,currency";

const openaiCsv = ({ month = "2026-01", amount = "120.00" } = {}) => [
  OPENAI_HEADER,
  ...[1, 2, 3].map((day) => `${month}-0${day},Platform,gpt-5,1000,500,${amount},USD`),
].join("\n");

const anthropicCsv = ({ month = "2026-01", amount = "80.00" } = {}) => [
  ANTHROPIC_HEADER,
  ...[1, 2, 3].map((day) => `${month}-0${day},Platform,claude-sonnet-5,900,400,${amount},USD`),
].join("\n");

const openai = (options) => parseLocalImportFile(openaiCsv(options), "openai.csv", "text/csv");
const anthropic = (options) =>
  parseLocalImportFile(anthropicCsv(options), "anthropic.csv", "text/csv");

test("the analysis entry point carries the portfolio, and the brief discloses it", () => {
  const analysis = normalizeLocalFinopsHistory({
    providers: [openai(), anthropic(), openai({ month: "2026-02", amount: "150.00" }),
      anthropic({ month: "2026-02", amount: "90.00" })],
    deliveries: [{ completedAt: "2026-02-02T12:00:00Z" }],
  });

  assert.equal(analysis.portfolio.available, true);
  assert.deepEqual(analysis.portfolio.observedProviders, ["anthropic", "openai"]);
  assert.equal(analysis.portfolio.contributions.length, 2);
  assert.equal(analysis.portfolio.contributions[0].provider, "openai");
  // The aligned total is the reconciled current-period total, split back out.
  assert.equal(
    Math.round(analysis.portfolio.current.spendUsd * 100),
    analysis.portfolio.contributions
      .reduce((sum, entry) => sum + Math.round(entry.spendUsd * 100), 0),
  );
  assert.equal(analysis.portfolio.deliveryEfficiency.deliveries, 1);
  assert.equal(analysis.portfolio.finding.available, true);

  const brief = portfolioBrief(analysis);
  assert.equal(brief.available, true);
  const contribution = brief.disclosures.find((group) => group.id === "contribution");
  assert.ok(contribution, "the brief opens onto the per-provider split");
  assert.ok(contribution.rows.length >= 5);
  assert.equal(contribution.rows[2].term, "Next action");
  assert.ok(contribution.rows.some((row) => row.term.startsWith("OpenAI")));
});

test("a single-provider analysis is unchanged and publishes no portfolio", () => {
  const analysis = normalizeLocalFinopsHistory({
    providers: [openai(), openai({ month: "2026-02", amount: "150.00" })],
  });

  assert.equal(analysis.portfolio.available, false);
  assert.match(analysis.portfolio.reason, /Fewer than two providers/);
  assert.equal(analysis.portfolio.state, null);
  // Everything the single-provider path already published is untouched.
  assert.equal(analysis.multiProvider.comparability.state, "single_provider");
  assert.equal(analysis.spendUsd, 450);
  assert.equal(analysis.history.periodCount, 2);
  // The reconciler's own verdict on these two three-day windows, and nothing the
  // aggregate added to it: portfolio exclusions never enter validation.
  assert.deepEqual(analysis.validation.results.map((result) => result.code),
    ["incompatible_periods"]);
  assert.equal(portfolioBrief(analysis).available, false);
});
