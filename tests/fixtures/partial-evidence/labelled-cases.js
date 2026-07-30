// Labelled adversarial cases for partial-evidence/1.1.0.
// These are deliberately tiny; the row-boundary case supplies counts because
// committing 50,001 repeated rows would test the repository, not the rule.

const PERIOD = Object.freeze({ start: "2026-06-01", end: "2026-07-01" });
const row = (id, sourceInstanceId, overrides = {}) => Object.freeze({
  id,
  sourceInstanceId,
  providerLabel: `${id} provider export`,
  periodStart: PERIOD.start,
  periodEnd: PERIOD.end,
  currencyCode: "USD",
  spendUsd: 100,
  rowCounts: { source: 10, analyzed: 10 },
  ...overrides,
});

export const PARTIAL_EVIDENCE_FIXTURE_METADATA = Object.freeze({
  rubric: "partial-evidence/1.1.0",
  assumptions: Object.freeze({
    alignedWindowWeight: "25/100: temporal mismatch can create a false total.",
    usdWeight: "20/100: no reproducible local exchange-rate source exists.",
    uniqueSourceWeight: "20/100: one source instance may contribute once.",
    rowCoverageWeight: "20/100: a bounded sample cannot represent a whole-file sum.",
    orgMappingWeight: "15/100: mapping controls department actions, not provider spend.",
    aggregateThreshold: "85/100: all four aggregate dimensions must pass; org mapping may be absent.",
  }),
});

export const PARTIAL_EVIDENCE_CASES = Object.freeze([
  Object.freeze({
    id: "same-source-is-duplicate",
    input: {
      requiredPeriod: PERIOD, attribution: { share: 1 },
      records: [row("delivery-a", "source-1"), row("delivery-b", "source-1")],
    },
    expected: { state: "partial", spend: 100, excluded: 1, code: "duplicate_export" },
  }),
  Object.freeze({
    id: "distinct-sources-are-allowed",
    input: {
      requiredPeriod: PERIOD, attribution: { share: 1 },
      records: [row("delivery-a", "source-1"), row("delivery-b", "source-2")],
    },
    expected: { state: "supported", spend: 200, excluded: 0, code: null },
  }),
  Object.freeze({
    id: "non-usd-is-a-floor",
    input: {
      requiredPeriod: PERIOD, attribution: { share: 1 },
      records: [row("usd", "source-1"), row("eur", "source-2", { currencyCode: "EUR" })],
    },
    expected: { state: "partial", spend: 100, excluded: 1, code: "incompatible_currency" },
  }),
  Object.freeze({
    id: "misaligned-window-is-a-floor",
    input: {
      requiredPeriod: PERIOD, attribution: { share: 1 },
      records: [row("aligned", "source-1"), row("may", "source-2", {
        periodStart: "2026-05-01", periodEnd: "2026-06-01",
      })],
    },
    expected: { state: "partial", spend: 100, excluded: 1, code: "outside_required_period" },
  }),
  Object.freeze({
    id: "sample-boundary-is-a-safe-non-finding",
    input: {
      requiredPeriod: PERIOD, attribution: { share: 1 },
      records: [row("sampled", "source-1", {
        rowCounts: { source: 50_001, analyzed: 50_000 },
      })],
    },
    expected: { state: "insufficient_evidence", spend: 0, excluded: 1, code: "sampled_rows" },
  }),
  Object.freeze({
    id: "missing-org-map-suppresses-department-action",
    input: {
      requiredPeriod: PERIOD, records: [row("unmapped", "source-1")],
      attribution: { mappingAvailable: false },
    },
    expected: { state: "supported", spend: 100, excluded: 0, code: null },
  }),
]);
