import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DELIMITED_IMPORT_CODES as CODES, readDelimitedText } from "../src/delimited-text.js";
import {
  amountToMinorUnits, CURRENCY_MINOR_UNITS, DEFAULT_CURRENCY, detectDelimitedKind,
  mapDelimitedOrgUnits, mapDelimitedProviderUsage, normalizeUsageDate,
  PROVIDER_HEADER_ALIASES, resolveColumns,
} from "../src/delimited-finops-mapping.js";
import { validateLocalFinopsEnvelope } from "../src/local-finops.js";

const FIXTURES = new URL("./fixtures/delimited/", import.meta.url);
const PINNED = Object.freeze({
  exportId: "40000000-0000-4000-8000-000000000001",
  generatedAt: "2026-07-26T00:00:00Z",
});

async function reading(name) {
  const result = readDelimitedText(await readFile(new URL(name, FIXTURES), "utf8"));
  assert.equal(result.ok, true);
  return result;
}

// --- amount conversion -----------------------------------------------------

test("amounts convert through the currency's own exponent, not a hardcoded 100", () => {
  assert.deepEqual(amountToMinorUnits("12.34", "USD"), { ok: true, minor: 1234, currency: "USD", exponent: 2 });
  // 19.99 * 100 is 1998.9999999999998 in binary floating point; the digits are
  // concatenated instead, so this is exact.
  assert.equal(amountToMinorUnits("19.99", "USD").minor, 1999);
  assert.equal(amountToMinorUnits("0.1", "USD").minor, 10);
  assert.equal(amountToMinorUnits("0.2", "USD").minor, 20);
  assert.equal(amountToMinorUnits("1.005", "EUR").ok, false);
  assert.equal(amountToMinorUnits("8.29", "EUR").minor, 829);
  assert.equal(amountToMinorUnits(".5", "USD").minor, 50);
  assert.equal(amountToMinorUnits("7.", "USD").minor, 700);
  assert.equal(amountToMinorUnits("$1,234.56", "USD").minor, 123_456);

  // JPY has no minor unit: 1200 yen is 1200 minor units, not 120000.
  assert.deepEqual(amountToMinorUnits("1200", "JPY"), { ok: true, minor: 1200, currency: "JPY", exponent: 0 });
  assert.equal(amountToMinorUnits("1200.00", "JPY").minor, 1200);
  assert.equal(CURRENCY_MINOR_UNITS.JPY, 0);
  assert.equal(CURRENCY_MINOR_UNITS.BHD, 3);
  assert.equal(amountToMinorUnits("1.234", "BHD").minor, 1234);
});

test("excess fractional digits are rejected rather than rounded away", () => {
  assert.deepEqual(amountToMinorUnits("1.005", "USD"), {
    ok: false, code: CODES.AMOUNT_PRECISION_EXCEEDED, currency: "USD",
    exponent: 2, observedFractionDigits: 3,
  });
  assert.deepEqual(amountToMinorUnits("1200.50", "JPY"), {
    ok: false, code: CODES.AMOUNT_PRECISION_EXCEEDED, currency: "JPY",
    exponent: 0, observedFractionDigits: 1,
  });
  // Trailing zeros carry no value, so they are not "excess" digits.
  assert.equal(amountToMinorUnits("19.9900", "USD").minor, 1999);
});

test("unparseable, negative, and unsupported-currency amounts have their own codes", () => {
  assert.equal(amountToMinorUnits("n/a", "USD").code, CODES.UNPARSEABLE_AMOUNT);
  assert.equal(amountToMinorUnits("", "USD").code, CODES.UNPARSEABLE_AMOUNT);
  assert.equal(amountToMinorUnits("1 234.00", "USD").code, CODES.UNPARSEABLE_AMOUNT);
  assert.equal(amountToMinorUnits("-4.00", "USD").code, CODES.NEGATIVE_AMOUNT);
  assert.equal(amountToMinorUnits("4.00", "XYZ").code, CODES.UNSUPPORTED_CURRENCY);
  assert.equal(amountToMinorUnits("4.00", "").code, CODES.UNSUPPORTED_CURRENCY);
  assert.equal(DEFAULT_CURRENCY, "USD");
});

// --- period parsing --------------------------------------------------------

test("mixed date formats normalize onto the contract's YYYY-MM-DD usage date", () => {
  assert.equal(normalizeUsageDate("2026-07-24").date, "2026-07-24");
  assert.equal(normalizeUsageDate("2026-07").date, "2026-07-01");
  assert.equal(normalizeUsageDate("2026-07-25T06:15:00Z").date, "2026-07-25");
  assert.equal(normalizeUsageDate("2026-07-25T06:15:00.123Z").date, "2026-07-25");
  // Offset-bearing timestamps convert to UTC first, so this one lands on the 26th.
  assert.equal(normalizeUsageDate("2026-07-25T23:30:00-05:00").date, "2026-07-26");
  assert.equal(normalizeUsageDate("2026-07-25T01:30:00+05:30").date, "2026-07-24");
  assert.equal(normalizeUsageDate("2026-02-30").code, CODES.UNPARSEABLE_DATE);
  assert.equal(normalizeUsageDate("03/07/2026").code, CODES.UNPARSEABLE_DATE);
  assert.equal(normalizeUsageDate("").code, CODES.UNPARSEABLE_DATE);
});

test("the host timezone cannot move a row into a different period", () => {
  // An offset-free timestamp is read as UTC by declaration. Proven by running
  // the same parse under two extreme zones in a child process: a local-time
  // reading would put these rows on different days.
  const script = "import('./src/delimited-finops-mapping.js').then(({normalizeUsageDate}) => "
    + "process.stdout.write([normalizeUsageDate('2026-07-24T23:30:00').date,"
    + "normalizeUsageDate('2026-07-24T00:30:00').date,"
    + "normalizeUsageDate('2026-07-25T06:15:00Z').date].join(',')))";
  const run = (timezone) => execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, TZ: timezone }, encoding: "utf8",
  });
  assert.equal(run("Pacific/Kiritimati"), "2026-07-24,2026-07-24,2026-07-25");
  assert.equal(run("Pacific/Midway"), run("Pacific/Kiritimati"));
  assert.equal(run("UTC"), run("Pacific/Kiritimati"));
});

// --- column identification -------------------------------------------------

test("headers match case-insensitively with whitespace collapsed, from the alias table", () => {
  const header = ["  Usage   DATE ", "Cost Center", "lineItem/UnblendedCost", "Currency Code"]
    .map((name) => name.trim().replace(/\s+/g, " ").toLowerCase());
  const resolved = resolveColumns(header, PROVIDER_HEADER_ALIASES);
  assert.equal(resolved.usage_date, 0);
  assert.equal(resolved.org_unit_id, 1);
  assert.equal(resolved.amount, 2);
  assert.equal(resolved.currency, 3);
  assert.equal("status" in resolved, false);
  // The alias table is data, so a spelling can be checked without running a parse.
  assert.ok(PROVIDER_HEADER_ALIASES.amount.includes("lineitem/unblendedcost"));
});

test("the envelope kind is detected from the header", async () => {
  assert.equal(detectDelimitedKind((await reading("provider-usage-openai.csv")).normalizedHeader), "provider");
  assert.equal(detectDelimitedKind((await reading("org-roster.csv")).normalizedHeader), "hris");
  assert.equal(detectDelimitedKind(["colour", "shape"]), null);
});

// --- provider mapping ------------------------------------------------------

test("a well-formed provider export maps onto a valid v1 provider envelope", async () => {
  const mapped = mapDelimitedProviderUsage(await reading("provider-usage-openai.csv"), PINNED);
  assert.equal(mapped.ok, true);
  assert.deepEqual(mapped.errors, []);
  assert.equal(mapped.rowsMapped, 3);
  assert.equal(mapped.rowsRejected, 0);
  // The convergence guarantee: the same validator the JSON path uses accepts it.
  assert.equal(validateLocalFinopsEnvelope(mapped.document), "provider");
  assert.equal(mapped.document.kind, "wawalu.integration.provider-usage-billing");
  assert.equal(mapped.document.schema_version, "1.0");
  assert.equal(mapped.document.snapshot.period_start, "2026-07-24");
  // Half-open period: the last observed day is included by ending on the next.
  assert.equal(mapped.document.snapshot.period_end, "2026-07-26");
  assert.equal(mapped.document.snapshot.completeness, "complete");
  assert.deepEqual(mapped.document.privacy, {
    aggregation: "daily-org-unit-service", minimum_group_size: 10,
    direct_identifiers_included: false, content_included: false,
  });
  assert.deepEqual(mapped.document.records[0], {
    aggregate_id: "psn_emo_00000002_20260724_1",
    revision: 0,
    usage_date: "2026-07-24",
    org_unit_id: "psn_unit_demo_00000002",
    provider: "openai",
    service_category: "text-generation",
    usage: { quantity: 420_000, unit: "tokens" },
    cost: { amount_minor: 1234, currency: "USD", status: "final" },
  });
  assert.deepEqual(mapped.document.records.map((record) => record.provider),
    ["openai", "anthropic", "aws"]);
  assert.deepEqual(mapped.document.records.map((record) => record.cost.status),
    ["final", "final", "estimated"]);
  assert.deepEqual(mapped.document.records.map((record) => record.cost.amount_minor),
    [1234, 1999, 405]);
  assert.equal(mapped.totals.amountMinor, 3638);
  assert.deepEqual(mapped.totals.currencies, ["USD"]);
  // Re-reading the same file yields the same record identities.
  const again = mapDelimitedProviderUsage(await reading("provider-usage-openai.csv"), PINNED);
  assert.deepEqual(again.document.records, mapped.document.records);
});

test("only headers and aggregate totals leave the mapper; no cell value does", async () => {
  const mapped = mapDelimitedProviderUsage(await reading("provider-usage-openai.csv"), PINNED);
  const serialized = JSON.stringify({
    headers: mapped.headers, totals: mapped.totals, errors: mapped.errors,
    defaults: mapped.defaultsApplied,
  });
  // The free-text `notes` column holds these; none of it may travel.
  for (const secret of ["Renewal", "Multi-line", "fine", "note that stays"]) {
    assert.doesNotMatch(serialized, new RegExp(secret));
  }
  assert.deepEqual(mapped.headers.slice(0, 2), ["date", "cost center"]);
  // The mapped records carry only declared contract fields, never the free text.
  assert.doesNotMatch(JSON.stringify(mapped.document.records), /Renewal|Multi-line/);
});

test("a missing required column names the field at the header's coordinate", async () => {
  const mapped = mapDelimitedProviderUsage(await reading("provider-usage-missing-amount.csv"), PINNED);
  assert.equal(mapped.ok, false);
  assert.equal(mapped.document, null);
  assert.deepEqual(mapped.errors, [{
    code: CODES.MISSING_REQUIRED_COLUMN, row: 1, column: null, header: "amount",
    message: "No column in the header maps to the required field “amount”.",
    field: "amount",
  }]);
  assert.equal(mapped.rowsMapped, 0);
});

test("mixed date formats map row by row, and an unparseable one is a partial parse", async () => {
  const mapped = mapDelimitedProviderUsage(await reading("provider-usage-mixed-dates.tsv"), PINNED);
  assert.equal(mapped.ok, true);
  assert.equal(mapped.rowsMapped, 4);
  assert.equal(mapped.rowsRejected, 1);
  assert.deepEqual(mapped.document.records.map((record) => record.usage_date),
    ["2026-07-24", "2026-07-25", "2026-07-26", "2026-07-01"]);
  // Row 6 of the spreadsheet, column 1, header `date` — and not the cell value.
  assert.deepEqual(mapped.errors, [{
    code: CODES.UNPARSEABLE_DATE, row: 6, column: 1, header: "date",
    message: "The date cell is not an ISO date, ISO timestamp, or YYYY-MM month.",
  }]);
  // A partial parse is declared in the envelope the analysis reads, not hidden.
  assert.equal(mapped.document.snapshot.completeness, "partial");
  assert.equal(mapped.document.snapshot.omitted_record_count, 1);
  assert.deepEqual(mapped.document.snapshot.issues, [CODES.UNPARSEABLE_DATE]);
  assert.equal(validateLocalFinopsEnvelope(mapped.document), "provider");
});

test("a defaulted currency and defaulted dimensions are recorded, not assumed silently", () => {
  const mapped = mapDelimitedProviderUsage(
    readDelimitedText("date,cost center,cost\n2026-07-24,psn_unit_demo_00000002,5.00\n"), PINNED);
  assert.equal(mapped.ok, true);
  assert.equal(mapped.document.records[0].cost.currency, "USD");
  assert.equal(mapped.document.records[0].cost.status, "estimated");
  assert.equal(mapped.document.records[0].service_category, "other");
  assert.deepEqual(mapped.document.records[0].usage, { quantity: 0, unit: "provider-units" });
  const currencyDefault = mapped.defaultsApplied.find((entry) => entry.field === "currency");
  assert.match(currencyDefault.reason, /No currency column was present; amounts were read as USD/);
  assert.deepEqual(mapped.defaultsApplied.map((entry) => entry.field).sort(),
    ["currency", "provider", "quantity", "service_category", "status", "unit"]);
});

test("per-row amount and identity failures are coordinate-tagged and never echo the cell", () => {
  const mapped = mapDelimitedProviderUsage(readDelimitedText([
    "date,cost center,cost,currency",
    "2026-07-24,psn_unit_demo_00000002,1.005,USD",
    "2026-07-24,CC-1042-SECRET-NAME,4.00,USD",
    "2026-07-24,psn_unit_demo_00000002,4.00,XYZ",
    "2026-07-24,psn_unit_demo_00000002,-4.00,USD",
    "2026-07-24,psn_unit_demo_00000002,2.50,USD",
  ].join("\n")), PINNED);
  assert.equal(mapped.ok, true);
  assert.equal(mapped.rowsMapped, 1);
  assert.deepEqual(mapped.errors.map((problem) => [problem.code, problem.row, problem.column, problem.header]), [
    [CODES.AMOUNT_PRECISION_EXCEEDED, 2, 3, "cost"],
    [CODES.UNPSEUDONYMIZED_IDENTIFIER, 3, 2, "cost center"],
    [CODES.UNSUPPORTED_CURRENCY, 4, 4, "currency"],
    [CODES.NEGATIVE_AMOUNT, 5, 3, "cost"],
  ]);
  assert.doesNotMatch(JSON.stringify(mapped.errors), /SECRET|1\.005|XYZ|-4\.00/);
});

test("an all-rejected file fails with no_mappable_rows rather than an empty envelope", () => {
  const mapped = mapDelimitedProviderUsage(
    readDelimitedText("date,cost center,cost\nnot-a-date,psn_unit_demo_00000002,5.00\n"), PINNED);
  assert.equal(mapped.ok, false);
  assert.equal(mapped.document, null);
  assert.equal(mapped.errors.at(-1).code, CODES.NO_MAPPABLE_ROWS);
});

// --- roster mapping --------------------------------------------------------

test("a roster CSV maps onto a valid v1 org-unit envelope", async () => {
  const mapped = mapDelimitedOrgUnits(await reading("org-roster.csv"), PINNED);
  assert.equal(mapped.ok, true);
  assert.deepEqual(mapped.errors, []);
  assert.equal(validateLocalFinopsEnvelope(mapped.document), "hris");
  assert.equal(mapped.document.kind, "wawalu.integration.hris-org");
  assert.deepEqual(mapped.document.records[0], {
    unit_id: "psn_unit_demo_00000001",
    revision: 0,
    operation: "upsert",
    effective_at: "2026-07-25T00:00:00Z",
    parent_unit_id: null,
    unit_type: "company",
    active: true,
  });
  assert.deepEqual(mapped.document.records.map((record) => record.unit_type),
    ["company", "department", "team"]);
  assert.deepEqual(mapped.document.records.map((record) => record.active), [true, true, true]);
  assert.deepEqual(mapped.totals, { activeUnits: 3, units: 3 });
});

test("an unrecognized active flag is a coordinate-tagged row error", () => {
  const mapped = mapDelimitedOrgUnits(readDelimitedText([
    "unit_id,unit_type,active",
    "psn_unit_demo_00000001,company,maybe",
    "psn_unit_demo_00000002,department,no",
  ].join("\n")), PINNED);
  assert.equal(mapped.rowsMapped, 1);
  assert.deepEqual(mapped.errors, [{
    code: CODES.UNPARSEABLE_FLAG, row: 2, column: 3, header: "active",
    message: "The active cell is not one of the declared boolean spellings.",
  }]);
  assert.equal(mapped.document.records[0].active, false);
});
