import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ANALYSIS_CURRENCY,
  CURRENCY_MINOR_UNITS,
  DELIMITED_SOURCE_INSTANCE_ID,
  LOCAL_FILE_ACCEPT,
  TABULAR_CODES,
  detectShape,
  minorUnitExponent,
  parseDelimitedFinopsFile,
  parseExportDate,
  parseLocalImportFile,
  toMinorUnits,
} from "../src/finops-tabular-import.js";
import { LOCAL_KINDS, normalizeLocalFinopsHistory, localFinopsMeetingSummary } from "../src/local-finops.js";
import { trustVerdict } from "../src/finops-trust-verdict.js";
import { leadingFinding } from "../src/finops-leading-finding.js";

const FIXTURES = new URL("./fixtures/delimited/", import.meta.url);
const GENERATED_AT = "2026-07-26T09:00:00.000Z";

async function fixture(name) {
  return readFile(new URL(name, FIXTURES), "utf8");
}

function parse(text, fileName) {
  return parseDelimitedFinopsFile(text, fileName, { generatedAt: GENERATED_AT });
}

test("a well-formed provider export normalizes into the v1 provider envelope", async () => {
  const result = parse(await fixture("openai-usage.csv"), "openai-usage.csv");
  assert.equal(result.ok, true);
  assert.equal(result.shape, "openai_usage");
  assert.equal(result.delimiter, "comma");
  assert.equal(result.acceptedRows, 4);
  assert.equal(result.skippedRows, 0);

  const { document } = result.parsed;
  assert.equal(result.parsed.type, "provider");
  assert.equal(document.kind, LOCAL_KINDS.provider);
  assert.equal(document.schema_version, "1.0");
  assert.equal(document.snapshot.source_instance_id, DELIMITED_SOURCE_INSTANCE_ID);
  assert.equal(document.snapshot.period_start, "2026-07-24");
  // Half-open: the last usage day plus one.
  assert.equal(document.snapshot.period_end, "2026-07-26");
  assert.equal(document.records.length, 4);
  assert.equal(
    document.records.reduce((sum, record) => sum + record.cost.amount_minor, 0),
    7279,
  );
  assert.equal(result.totals.amountMinor, 7279);
  assert.equal(result.totals.currency, ANALYSIS_CURRENCY);

  const categories = document.records.map((record) => record.service_category).sort();
  assert.deepEqual(categories, ["embedding", "image-generation", "text-generation", "text-generation"]);
  assert.ok(document.records.every((record) => record.usage.unit === "tokens"));
  assert.ok(document.records.every((record) => record.provider === "openai"));

  // Only headers and aggregate totals survive. No org-unit label, model name, or
  // other cell value may appear anywhere in the returned value.
  assert.deepEqual(result.columns, [
    "date", "project_name", "model", "n_context_tokens_total",
    "n_generated_tokens_total", "amount", "currency",
  ]);
  const serialized = JSON.stringify(result);
  for (const leaked of ["Atlas", "Boreal", "Cinder", "gpt-4o", "dall-e"]) {
    assert.equal(serialized.includes(leaked), false, `${leaked} must not survive normalization`);
  }
});

test("a missing required column is reported by code and coordinate", async () => {
  const result = parse(
    await fixture("anthropic-usage-missing-cost.csv"), "anthropic-usage-missing-cost.csv",
  );
  assert.equal(result.ok, false);
  assert.equal(result.shape, "anthropic_usage");
  assert.equal(result.problems.length, 1);
  const [problem] = result.problems;
  assert.equal(problem.code, TABULAR_CODES.MISSING_REQUIRED_COLUMN);
  assert.equal(problem.column, "amount");
  assert.equal(problem.row, 1);
  assert.ok(problem.expected.includes("cost"));
});

test("mixed date formats inside one file each record which format matched", async () => {
  const result = parse(await fixture("bedrock-usage.tsv"), "bedrock-usage.tsv");
  assert.equal(result.ok, true);
  assert.equal(result.shape, "bedrock_usage");
  assert.equal(result.delimiter, "tab");
  assert.deepEqual(result.dateFormats, {
    iso_datetime: 1,
    numeric_month_first: 1,
    numeric_day_first: 1,
    month_name_day: 1,
  });
  assert.deepEqual(
    result.parsed.document.records.map((record) => record.usage_date),
    ["2026-07-24", "2026-07-25", "2026-07-26", "2026-07-27"],
  );
  assert.ok(result.parsed.document.records.every((record) => record.provider === "aws"));
  assert.ok(result.parsed.document.records.every((record) => record.usage.unit === "provider-units"));
});

test("the ambiguous D/M versus M/D rule is fixed, documented, and per value", () => {
  // Stated rule: month-first, unless the first number cannot be a month.
  assert.deepEqual(parseExportDate("03/04/2026"), {
    ok: true, date: "2026-03-04", format: "numeric_month_first",
  });
  assert.deepEqual(parseExportDate("26/07/2026"), {
    ok: true, date: "2026-07-26", format: "numeric_day_first",
  });
  // The rule never depends on the rest of the file: the same value in a file of
  // day-first dates still resolves month-first.
  assert.equal(parseExportDate("03/04/2026").date, parseExportDate("03/04/2026").date);

  assert.equal(parseExportDate("2026-07-24").format, "iso_date");
  assert.equal(parseExportDate("2026-07-24T11:00:00Z").format, "iso_datetime");
  assert.equal(parseExportDate("2026/07/24").format, "iso_slash");
  assert.equal(parseExportDate("24 Jul 2026").format, "day_month_name");
  assert.equal(parseExportDate("Jul 24, 2026").format, "month_name_day");
  assert.equal(parseExportDate("02/31/2026").ok, false);
  assert.equal(parseExportDate("not a date").reason, "unrecognized_format");
});

test("minor units come from the currency exponent and never from a float", () => {
  assert.equal(minorUnitExponent("USD"), 2);
  assert.equal(minorUnitExponent("JPY"), 0);
  assert.equal(minorUnitExponent("KWD"), 3);
  assert.equal(minorUnitExponent("zzz"), 2, "the documented default is 2");
  assert.equal(CURRENCY_MINOR_UNITS.JPY, 0);

  assert.equal(toMinorUnits("19.99", "USD").amountMinor, 1999);
  assert.equal(toMinorUnits("1200", "JPY").amountMinor, 1200);
  assert.equal(toMinorUnits("1.234", "KWD").amountMinor, 1234);
  assert.equal(toMinorUnits("$1,234.50", "USD").amountMinor, 123450);
  // Half-up, away from zero, on the first discarded digit.
  assert.equal(toMinorUnits("0.125", "USD").amountMinor, 13);
  assert.equal(toMinorUnits("0.124", "USD").amountMinor, 12);
  // The float route gives 1998.9999999999998 for this; the stored value is exact.
  assert.equal(toMinorUnits("0.07", "USD").amountMinor, 7);
  assert.equal(toMinorUnits("70.07", "USD").amountMinor, 7007);
  assert.equal(toMinorUnits("-4.00", "USD").reason, "negative");
  assert.equal(toMinorUnits("n/a", "USD").reason, "not_a_number");
  assert.equal(toMinorUnits("", "USD").reason, "empty");
});

test("a malformed quoted field fails with a located reason code", () => {
  const result = parse('date,project_name,model,amount\n"2026-07-24,Atlas,gpt-4o,1.00\n', "bad.csv");
  assert.equal(result.ok, false);
  assert.equal(result.problems[0].code, TABULAR_CODES.MALFORMED_QUOTED_FIELD);
  assert.equal(result.problems[0].row, 2);
  assert.equal(result.parsed, null);
});

test("a BOM-prefixed CRLF copy normalizes identically to the plain file", async () => {
  const raw = await fixture("bedrock-usage.tsv");
  const plain = parse(raw, "bedrock-usage.tsv");
  const decorated = parse(`﻿${raw.replace(/\n/g, "\r\n")}`, "bedrock-usage.tsv");
  assert.equal(decorated.hadBom, true);
  assert.equal(decorated.lineEnding, "CRLF");
  assert.deepEqual(decorated.parsed.document.records, plain.parsed.document.records);
  assert.equal(decorated.parsed.document.export_id, plain.parsed.document.export_id);
});

test("a quoted field carrying the delimiter and a newline stays one field", async () => {
  const result = parse(await fixture("org-roster.csv"), "org-roster.csv");
  assert.equal(result.ok, true);
  assert.equal(result.shape, "org_roster");
  assert.equal(result.parsed.type, "hris");
  assert.equal(result.acceptedRows, 5);
  assert.equal(result.parsed.document.records.length, 5);
  assert.equal(result.parsed.document.records.filter((unit) => unit.active).length, 4);
  assert.equal(result.parsed.document.records.filter((unit) => unit.unit_type === "company").length, 1);
});

test("the row ceiling is enforced with the limit and the observed count", () => {
  const header = "date,project_name,model,amount,currency";
  const rows = Array.from({ length: 40 },
    (_, index) => `2026-07-24,Atlas Platform,gpt-4o,${index + 1}.00,USD`);
  const result = parseDelimitedFinopsFile([header, ...rows].join("\n"), "big.csv", {
    generatedAt: GENERATED_AT, maxRows: 10,
  });
  assert.equal(result.ok, false);
  assert.equal(result.problems[0].code, TABULAR_CODES.TOO_MANY_ROWS);
  assert.equal(result.problems[0].limit, 10);
  assert.equal(result.problems[0].observed, 41);
});

test("partial success returns the good rows beside the located problems", () => {
  const text = [
    "date,project_name,model,amount,currency",
    "2026-07-24,Atlas Platform,gpt-4o,10.00,USD",
    "not-a-date,Atlas Platform,gpt-4o,10.00,USD",
    "2026-07-24,Atlas Platform,gpt-4o,abc,USD",
    "2026-07-24,,gpt-4o,10.00,USD",
    "2026-07-24,Atlas Platform,gpt-4o,900,JPY",
    "2026-07-24,Atlas Platform,gpt-4o",
  ].join("\n");
  const result = parse(text, "partial.csv");
  assert.equal(result.ok, true);
  assert.equal(result.rowCount, 6);
  assert.equal(result.acceptedRows, 1);
  assert.equal(result.skippedRows, 5);
  assert.equal(result.parsed.document.records.length, 1);
  assert.equal(result.parsed.document.snapshot.completeness, "partial");

  const byCode = new Map(result.problems.map((problem) => [problem.code, problem]));
  assert.equal(byCode.get(TABULAR_CODES.UNPARSEABLE_DATE).row, 3);
  assert.equal(byCode.get(TABULAR_CODES.UNPARSEABLE_DATE).column, "date");
  assert.equal(byCode.get(TABULAR_CODES.UNPARSEABLE_DATE).columnIndex, 0);
  assert.equal(byCode.get(TABULAR_CODES.INVALID_AMOUNT).row, 4);
  assert.equal(byCode.get(TABULAR_CODES.INVALID_AMOUNT).column, "amount");
  assert.equal(byCode.get(TABULAR_CODES.MISSING_VALUE).row, 5);
  assert.equal(byCode.get(TABULAR_CODES.MISSING_VALUE).column, "project_name");
  assert.equal(byCode.get(TABULAR_CODES.UNSUPPORTED_CURRENCY).row, 6);
  assert.equal(byCode.get(TABULAR_CODES.UNSUPPORTED_CURRENCY).observed, "JPY");
  assert.equal(byCode.get(TABULAR_CODES.MALFORMED_ROW).row, 7);
  assert.equal(byCode.get(TABULAR_CODES.MALFORMED_ROW).expected, 5);
  assert.equal(byCode.get(TABULAR_CODES.MALFORMED_ROW).observed, 3);
  // The assumption the import cannot verify is reported, not hidden.
  assert.equal(byCode.get(TABULAR_CODES.GROUP_SIZE_ASSUMED).code, TABULAR_CODES.GROUP_SIZE_ASSUMED);
});

test("an unrecognized header is unsupported_format, not a missing column", () => {
  const result = parse("alpha,beta,gamma\n1,2,3\n", "mystery.csv");
  assert.equal(result.ok, false);
  assert.equal(result.problems[0].code, TABULAR_CODES.UNSUPPORTED_FORMAT);
  assert.equal(result.problems[0].row, 1);
  assert.deepEqual(result.columns, ["alpha", "beta", "gamma"]);
});

test("shape detection is deterministic and tolerates case and spacing", () => {
  const detected = detectShape(["  DATE ", "Project_Name", "MODEL", "Amount", "Currency"]);
  assert.equal(detected.recognized, true);
  assert.equal(detected.shape.id, "openai_usage");
  assert.equal(detectShape(["date", "workspace", "model", "cost"]).shape.id, "anthropic_usage");
  assert.equal(detectShape(["department", "parent", "unit type"]).shape.id, "org_roster");
});

test("normalized tabular output feeds the same analysis path the JSON envelope feeds", async () => {
  const provider = parse(await fixture("openai-usage.csv"), "openai-usage.csv");
  const roster = parse(await fixture("org-roster.csv"), "org-roster.csv");
  assert.equal(provider.ok && roster.ok, true);

  const analysis = normalizeLocalFinopsHistory({
    providers: [provider.parsed], hris: roster.parsed,
  });
  assert.equal(analysis.spendUsd, 72.79);
  assert.equal(analysis.rankedDepartments.length, 3);
  assert.equal(analysis.recoverableUsd, 12.51);
  assert.ok(analysis.decisionInputs.trends.departments.length === 3);
  assert.equal(analysis.quality.joinedRecords, 4);

  // The trust verdict, leading finding, and meeting summary all read the same
  // envelope the JSON path produces, so each is exercised against the CSV.
  const verdict = trustVerdict({ providers: [provider.parsed], hris: roster.parsed });
  assert.equal(verdict.currency, "USD");
  assert.equal(verdict.headline.totalRows, 4);
  assert.equal(verdict.headline.attributedRows, 4);

  const finding = leadingFinding(analysis);
  assert.equal(typeof finding.question, "string");
  assert.ok(localFinopsMeetingSummary(analysis).includes("72.79"));
});

test("parsing performs no network call and writes no persistent storage", async () => {
  const calls = [];
  const trap = (name) => (...args) => {
    calls.push(`${name}(${args.length})`);
    throw new Error(`${name} must never be called during a local parse`);
  };
  const storage = (name) => ({
    getItem: trap(`${name}.getItem`),
    setItem: trap(`${name}.setItem`),
    removeItem: trap(`${name}.removeItem`),
    clear: trap(`${name}.clear`),
  });
  const traps = {
    fetch: trap("fetch"),
    XMLHttpRequest: trap("XMLHttpRequest"),
    WebSocket: trap("WebSocket"),
    EventSource: trap("EventSource"),
    localStorage: storage("localStorage"),
    sessionStorage: storage("sessionStorage"),
    indexedDB: { open: trap("indexedDB.open"), deleteDatabase: trap("indexedDB.deleteDatabase") },
    navigator: { sendBeacon: trap("navigator.sendBeacon") },
  };
  const saved = new Map();
  for (const [name, value] of Object.entries(traps)) {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  try {
    for (const name of ["openai-usage.csv", "org-roster.csv", "bedrock-usage.tsv"]) {
      const result = parse(await fixture(name), name);
      assert.equal(result.ok, true);
    }
    // The failure paths must be just as quiet as the success paths.
    parse('a,b\n"unterminated,2\n', "bad.csv");
    parse("alpha,beta\n1,2\n", "mystery.csv");
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
  assert.deepEqual(calls, []);
});

test("the router keeps the JSON path and adds the delimited extensions", async () => {
  const envelope = JSON.parse(await readFile(
    new URL("../contracts/integrations/provider-usage-billing/v1/fixtures/valid.json",
      import.meta.url),
    "utf8",
  ));
  const json = parseLocalImportFile(JSON.stringify(envelope), "billing.json", "application/json");
  assert.equal(json.type, "provider");
  assert.deepEqual(json.document, envelope);

  const csv = parseLocalImportFile(await fixture("openai-usage.csv"), "usage.csv", "text/csv");
  assert.equal(csv.type, "provider");
  assert.equal(csv.shape, "openai_usage");

  const tsv = parseLocalImportFile(
    await fixture("bedrock-usage.tsv"), "usage.tsv", "text/tab-separated-values",
  );
  assert.equal(tsv.type, "provider");

  const txt = parseLocalImportFile(await fixture("org-roster.csv"), "roster.txt", "text/plain");
  assert.equal(txt.type, "hris");

  assert.throws(() => parseLocalImportFile("x", "book.xlsx", ""),
    (error) => error.code === TABULAR_CODES.UNSUPPORTED_FORMAT);
  assert.throws(
    () => parseLocalImportFile(
      "Usage Day,Workspace,Model\n2026-07-24,Atlas,claude\n", "usage.csv", "text/csv",
    ),
    (error) => error.code === TABULAR_CODES.MISSING_REQUIRED_COLUMN
      && error.problems[0].column === "amount",
  );

  for (const extension of [".json", ".csv", ".tsv", ".txt"]) {
    assert.ok(LOCAL_FILE_ACCEPT.includes(extension));
  }
});
