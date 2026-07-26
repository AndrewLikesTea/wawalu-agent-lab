// The one-click example dataset.
//
// A visitor who has never produced a provider export cannot use the import
// panel at all: it can only ask for a file they do not have. This module is the
// answer to that — a synthetic organisation, six consecutive complete months,
// emitted in the *raw* shape of the v1 provider-usage and HRIS-org contracts.
//
// It is deliberately a fixture generator rather than a committed result. The
// bytes below go through `parseLocalFinopsFile` and `normalizeLocalFinopsHistory`
// exactly like an uploaded file: same translator, same envelope, same analysis.
// There is no bypass branch, and no pre-computed number is stored anywhere. If
// the translator's contract tightens, this dataset fails with everything else,
// which is the point — it doubles as the translation regression fixture.
//
// Everything here is invented. There is no real company, customer, account,
// resource, or provider identifier in this file; the opaque ids follow the
// contract's pseudonym pattern and their readable tails are made-up words.

import { parseLocalFinopsFile, normalizeLocalFinopsHistory } from "./local-finops.js";

/** Six consecutive complete calendar months; the last one is the reporting period. */
const MONTHS = Object.freeze([
  "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
]);

const PROVIDER_SOURCE = "psn_example_provider_00001";
const HRIS_SOURCE = "psn_example_hris_00000001";
const COMPANY_UNIT = "psn_example_unit_hqroot";

// Monthly spend in whole USD, one entry per month in MONTHS order. The shape is
// the point of the dataset: Atlas is an unambiguous single driver of the most
// recent increase, Boreal is flat and Cinder is declining, so the leading
// finding is a real discrimination rather than the only non-zero row.
const DEPARTMENTS = Object.freeze([
  Object.freeze({
    unitId: "psn_example_unit_atlas0",
    monthlyUsd: Object.freeze([40_000, 41_500, 42_000, 43_000, 44_500, 79_000]),
    mix: Object.freeze([
      Object.freeze(["openai", "text-generation", 55]),
      Object.freeze(["anthropic", "text-generation", 30]),
      Object.freeze(["aws", "storage", 15]),
    ]),
  }),
  Object.freeze({
    unitId: "psn_example_unit_boreal",
    monthlyUsd: Object.freeze([22_000, 22_000, 22_000, 22_000, 22_000, 22_000]),
    mix: Object.freeze([
      Object.freeze(["anthropic", "text-generation", 40]),
      Object.freeze(["google", "embedding", 35]),
      Object.freeze(["azure", "storage", 25]),
    ]),
  }),
  Object.freeze({
    unitId: "psn_example_unit_cinder",
    monthlyUsd: Object.freeze([30_000, 29_000, 28_000, 27_000, 26_000, 24_500]),
    mix: Object.freeze([
      Object.freeze(["openai", "text-generation", 60]),
      Object.freeze(["openai", "image-generation", 25]),
      Object.freeze(["aws", "storage", 15]),
    ]),
  }),
  Object.freeze({
    unitId: "psn_example_unit_quartz",
    monthlyUsd: Object.freeze([12_000, 12_500, 13_000, 13_500, 14_000, 18_000]),
    mix: Object.freeze([
      Object.freeze(["google", "text-generation", 50]),
      Object.freeze(["google", "embedding", 30]),
      Object.freeze(["azure", "other", 20]),
    ]),
  }),
  Object.freeze({
    unitId: "psn_example_unit_ember0",
    monthlyUsd: Object.freeze([8_000, 8_200, 8_400, 8_600, 8_800, 11_000]),
    mix: Object.freeze([
      Object.freeze(["anthropic", "text-generation", 45]),
      Object.freeze(["openai", "image-generation", 35]),
      Object.freeze(["aws", "storage", 20]),
    ]),
  }),
]);

const USAGE_UNIT = Object.freeze({
  "text-generation": "tokens",
  "image-generation": "images",
  embedding: "tokens",
  storage: "byte-hours",
  other: "requests",
});

// Usage is a declared contract field, so it has to be present and plausible. It
// is derived from the cost so the dataset stays internally consistent; no
// analysis in this repo reads it.
const USAGE_PER_MINOR = Object.freeze({
  "text-generation": 340, "image-generation": 0.02, embedding: 900,
  storage: 12, other: 1,
});

/** The day of the month each row in a department's mix is billed on. */
const BILLING_DAYS = Object.freeze(["05", "12", "19"]);

function nextMonth(yearMonth) {
  const [year, month] = yearMonth.split("-").map(Number);
  return month === 12
    ? `${year + 1}-01`
    : `${year}-${String(month + 1).padStart(2, "0")}`;
}

function unitTail(unitId) {
  return unitId.slice(-6);
}

/**
 * Split a month's department total across its service mix in minor units. The
 * shares are integer percentages and every total is a whole multiple of 100 USD,
 * so each slice is exact; the last row still absorbs any remainder so the rows
 * can never fail to sum to the declared total.
 */
function allocate(totalMinor, mix) {
  const amounts = mix.map(([, , share], index) =>
    index === mix.length - 1 ? 0 : Math.floor((totalMinor * share) / 100));
  amounts[amounts.length - 1] = totalMinor - amounts.reduce((sum, value) => sum + value, 0);
  return amounts;
}

function providerRecords(monthIndex) {
  const yearMonth = MONTHS[monthIndex];
  const compact = yearMonth.replace("-", "");
  const records = [];
  for (const department of DEPARTMENTS) {
    const amounts = allocate(department.monthlyUsd[monthIndex] * 100, department.mix);
    department.mix.forEach(([provider, serviceCategory], row) => {
      records.push({
        aggregate_id: `psn_example_agg_${compact}_${unitTail(department.unitId)}_${row + 1}`,
        revision: 1,
        usage_date: `${yearMonth}-${BILLING_DAYS[row]}`,
        org_unit_id: department.unitId,
        provider,
        service_category: serviceCategory,
        usage: {
          quantity: Math.round(amounts[row] * USAGE_PER_MINOR[serviceCategory]),
          unit: USAGE_UNIT[serviceCategory],
        },
        cost: { amount_minor: amounts[row], currency: "USD", status: "final" },
      });
    });
  }
  return records;
}

function providerExport(monthIndex) {
  const yearMonth = MONTHS[monthIndex];
  const periodEnd = `${nextMonth(yearMonth)}-01`;
  return {
    schema_version: "1.0",
    kind: "wawalu.integration.provider-usage-billing",
    export_id: `1e5a0000-0000-4000-8000-${String(monthIndex + 1).padStart(12, "0")}`,
    snapshot: {
      source_instance_id: PROVIDER_SOURCE,
      sequence: monthIndex + 1,
      generated_at: `${periodEnd}T00:00:00Z`,
      period_start: `${yearMonth}-01`,
      period_end: periodEnd,
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
    records: providerRecords(monthIndex),
  };
}

function hrisExport() {
  const effectiveAt = `${MONTHS[0]}-01T00:00:00Z`;
  return {
    schema_version: "1.0",
    kind: "wawalu.integration.hris-org",
    export_id: "2e5a0000-0000-4000-8000-000000000001",
    snapshot: {
      source_instance_id: HRIS_SOURCE,
      sequence: 1,
      generated_at: `${MONTHS.at(-1)}-30T00:00:00Z`,
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
    records: [
      {
        unit_id: COMPANY_UNIT,
        revision: 1,
        operation: "upsert",
        effective_at: effectiveAt,
        parent_unit_id: null,
        unit_type: "company",
        active: true,
      },
      ...DEPARTMENTS.map((department) => ({
        unit_id: department.unitId,
        revision: 1,
        operation: "upsert",
        effective_at: effectiveAt,
        parent_unit_id: COMPANY_UNIT,
        unit_type: "department",
        active: true,
      })),
    ],
  };
}

/**
 * The dataset as files, in the byte shape the importer accepts. A test can hand
 * these to the translator directly; the page hands them to the same call the
 * file input uses.
 */
export function exampleDatasetFiles() {
  return [
    ...MONTHS.map((yearMonth, index) => ({
      fileName: `example-provider-${yearMonth}.json`,
      mediaType: "application/json",
      text: JSON.stringify(providerExport(index), null, 2),
    })),
    {
      fileName: "example-hris-org.json",
      mediaType: "application/json",
      text: JSON.stringify(hrisExport(), null, 2),
    },
  ];
}

/**
 * Translate the fixture and analyze it. Same two calls, in the same order, that
 * a selected set of files walks through in evolution-page.js.
 */
export function loadExampleDataset() {
  const providers = [];
  let hris = null;
  for (const file of exampleDatasetFiles()) {
    const parsed = parseLocalFinopsFile(file.text, file.fileName, file.mediaType);
    if (parsed.type === "provider") providers.push(parsed);
    else hris = parsed;
  }
  return normalizeLocalFinopsHistory({ providers, hris });
}
