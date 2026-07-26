// A deterministic generator for provider/HRIS export files.
//
// Nothing large is committed. A test that needs a year-sized export calls
// `providerExport` with the day and unit counts it wants and gets the same
// bytes on every machine and every run: the only source of variation is a
// seeded 32-bit LCG, so a failure is reproducible from the seed alone.

const UNIT_COUNT_DEFAULT = 12;

/** Seeded LCG (Numerical Recipes constants). Deterministic, not random. */
export function seededNumbers(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const unitId = (index) => `psn_unit_${String(index).padStart(14, "0")}`;
const aggregateId = (index) => `psn_agg_${String(index).padStart(16, "0")}`;

function isoDate(startDay, offset) {
  return new Date(Date.UTC(2026, 0, 1) + (startDay + offset) * 86_400_000)
    .toISOString().slice(0, 10);
}

/**
 * An HRIS mapping: one company root plus `units` active departments, so every
 * generated provider aggregate joins.
 */
export function hrisExport({ units = UNIT_COUNT_DEFAULT } = {}) {
  const records = [{
    unit_id: unitId(0),
    revision: 1,
    operation: "upsert",
    effective_at: "2026-01-01T00:00:00Z",
    parent_unit_id: null,
    unit_type: "company",
    active: true,
  }];
  for (let index = 1; index <= units; index += 1) {
    records.push({
      unit_id: unitId(index),
      revision: 1,
      operation: "upsert",
      effective_at: "2026-01-01T00:00:00Z",
      parent_unit_id: unitId(0),
      unit_type: "department",
      active: true,
    });
  }
  return {
    schema_version: "1.0",
    kind: "wawalu.integration.hris-org",
    export_id: "10000000-0000-4000-8000-000000000001",
    snapshot: {
      source_instance_id: "psn_hris_demo_00000001",
      sequence: 1,
      generated_at: "2026-07-25T12:00:00Z",
      mode: "full",
      completeness: "complete",
      omitted_record_count: 0,
      issues: [],
    },
    privacy: {
      identifier_method: "hmac-sha256-truncated",
      direct_identifiers_included: false,
      salt_scope: "tenant-integration-v1",
    },
    records,
  };
}

/**
 * A provider usage export of `days * units` daily aggregates.
 *
 * `startDay` is a day offset from 2026-01-01 so two calls can produce adjacent
 * periods, and `seed` selects the deterministic cost/usage series.
 */
export function providerExport({
  days = 30, units = UNIT_COUNT_DEFAULT, startDay = 0, seed = 7,
  exportId = "30000000-0000-4000-8000-000000000001", sequence = 1,
} = {}) {
  const next = seededNumbers(seed);
  const records = [];
  let counter = 0;
  for (let day = 0; day < days; day += 1) {
    for (let unit = 1; unit <= units; unit += 1) {
      counter += 1;
      records.push({
        aggregate_id: aggregateId(startDay * 100_000 + counter),
        revision: 1,
        usage_date: isoDate(startDay, day),
        org_unit_id: unitId(unit),
        provider: next() > 0.5 ? "openai" : "anthropic",
        service_category: next() > 0.25 ? "text-generation" : "embedding",
        usage: { quantity: Math.floor(next() * 900_000) + 1000, unit: "tokens" },
        cost: {
          amount_minor: Math.floor(next() * 250_000) + 100,
          currency: "USD",
          status: "final",
        },
      });
    }
  }
  return {
    schema_version: "1.0",
    kind: "wawalu.integration.provider-usage-billing",
    export_id: exportId,
    snapshot: {
      source_instance_id: "psn_provider_demo_00001",
      sequence,
      generated_at: "2026-07-25T12:00:00Z",
      period_start: isoDate(startDay, 0),
      period_end: isoDate(startDay, days),
      completeness: "complete",
      omitted_record_count: 0,
      issues: [],
    },
    privacy: {
      aggregation: "daily-org-unit-service",
      minimum_group_size: 10,
      direct_identifiers_included: false,
      content_included: false,
    },
    records,
  };
}

/** Wrap a document as the `File` the import path is handed by the picker. */
export function jsonFile(document, name) {
  return new File([JSON.stringify(document)], name, { type: "application/json" });
}
