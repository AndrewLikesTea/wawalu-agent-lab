import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DELIMITED_IMPORT_CODES as CODES } from "../src/delimited-text.js";
import { diagnosticFor } from "../src/local-import-flow.js";
import { normalizeLocalFinopsHistory } from "../src/local-finops.js";
import {
  ACCEPTED_LOCAL_IMPORT, looksLikeJsonEnvelope, parseLocalImportFile,
} from "../src/local-import-formats.js";

const DELIMITED = new URL("./fixtures/delimited/", import.meta.url);
const CONTRACTS = new URL("../contracts/integrations/", import.meta.url);
const PINNED = Object.freeze({
  exportId: "40000000-0000-4000-8000-000000000001",
  generatedAt: "2026-07-26T00:00:00Z",
});

function fixture(name) {
  return readFile(new URL(name, DELIMITED), "utf8");
}

function contract(path) {
  return readFile(new URL(path, CONTRACTS), "utf8");
}

test("the accept list admits delimited exports alongside the JSON envelope", () => {
  assert.deepEqual([...ACCEPTED_LOCAL_IMPORT.extensions], [".json", ".csv", ".tsv", ".txt"]);
  assert.match(ACCEPTED_LOCAL_IMPORT.accept, /\.csv/);
  assert.match(ACCEPTED_LOCAL_IMPORT.accept, /\.tsv/);
  assert.match(ACCEPTED_LOCAL_IMPORT.accept, /\.txt/);
  assert.throws(() => parseLocalImportFile("a,b\n1,2\n", "book.xlsx"),
    (error) => error.code === "unsupported_format");
  assert.throws(() => parseLocalImportFile("a,b\n1,2\n", "book.csv", "application/vnd.ms-excel"),
    (error) => error.code === "unsupported_format");
});

test("routing reads the content, because extensions lie", async () => {
  assert.equal(looksLikeJsonEnvelope('﻿  {"schema_version":"1.0"}'), true);
  assert.equal(looksLikeJsonEnvelope("date,cost\n"), false);

  // A v1 envelope named .txt still takes the JSON path…
  const envelope = await contract("provider-usage-billing/v1/fixtures/valid.json");
  const asText = parseLocalImportFile(envelope, "export.txt", "text/plain");
  assert.equal(asText.format, "json");
  assert.equal(asText.type, "provider");
  assert.deepEqual(asText.document, JSON.parse(envelope));

  // …and a delimited body named .json still takes the delimited path.
  const asCsv = parseLocalImportFile(await fixture("provider-usage-openai.csv"),
    "export.json", "application/json", PINNED);
  assert.equal(asCsv.format, "delimited");
  assert.equal(asCsv.delimiter, "comma");
});

test("a delimited provider export reaches the same downstream call as the JSON envelope", async () => {
  const provider = parseLocalImportFile(await fixture("provider-usage-openai.csv"),
    "usage.csv", "text/csv", PINNED);
  const hris = parseLocalImportFile(await fixture("org-roster.csv"), "roster.csv", "text/csv", {
    ...PINNED, exportId: "40000000-0000-4000-8000-000000000002",
  });
  assert.equal(provider.type, "provider");
  assert.equal(hris.type, "hris");
  assert.equal(provider.rowsMapped, 3);
  assert.equal(provider.rowsRejected, 0);
  assert.deepEqual(provider.errors, []);

  // No consumer changed: the shipped analysis takes these unmodified.
  const result = normalizeLocalFinopsHistory({ providers: [provider], hris });
  assert.equal(result.schemaVersion, "local-finops-history/1.0.0");
  assert.equal(result.spendUsd, 36.38);
  assert.equal(result.period, "2026-07-24 to 2026-07-26");
  assert.equal(result.rankedDepartments.length, 2);
  assert.equal(result.quality.joinedRecords, 3);
  assert.equal(result.validation.state, "needs_review"); // one period: no trend yet
  assert.equal(result.history.state, "missing");
});

test("a JSON provider period and a delimited roster still pair", async () => {
  const provider = parseLocalImportFile(
    await contract("provider-usage-billing/v1/fixtures/valid.json"), "billing.json", "application/json");
  const hris = parseLocalImportFile(await fixture("org-roster.csv"), "roster.csv", "text/csv", PINNED);
  const result = normalizeLocalFinopsHistory({ providers: [provider], hris });
  assert.equal(result.spendUsd, 12.34);
  assert.equal(provider.errors.length, 0);
});

test("a partial delimited parse still produces a result, with the row count carried", async () => {
  const provider = parseLocalImportFile(await fixture("provider-usage-mixed-dates.tsv"),
    "usage.tsv", "text/tab-separated-values", PINNED);
  assert.equal(provider.delimiter, "tab");
  assert.equal(provider.rowsMapped, 4);
  assert.equal(provider.rowsRejected, 1);
  assert.deepEqual(provider.errors.map((problem) => [problem.code, problem.row, problem.column]),
    [[CODES.UNPARSEABLE_DATE, 6, 1]]);
  const hris = parseLocalImportFile(await fixture("org-roster.csv"), "roster.csv", "text/csv", {
    ...PINNED, exportId: "40000000-0000-4000-8000-000000000002",
  });
  const result = normalizeLocalFinopsHistory({ providers: [provider], hris });
  assert.equal(result.spendUsd, 10);
  assert.match(result.warnings.join(" "), /partial/);
});

test("failures carry a machine-readable code plus coordinate-tagged problems", async () => {
  const cases = [
    ["provider-usage-missing-amount.csv", CODES.MISSING_REQUIRED_COLUMN,
      { row: 1, column: null, header: "amount" }],
    ["provider-usage-malformed-quote.csv", CODES.MALFORMED_QUOTED_FIELD,
      { row: 2, column: 5, header: null }],
  ];
  for (const [name, code, coordinate] of cases) {
    const text = await fixture(name);
    assert.throws(() => parseLocalImportFile(text, name, "text/csv", PINNED), (error) => {
      assert.equal(error.code, code);
      assert.equal(typeof error.message, "string");
      assert.equal(error.problems.length >= 1, true);
      const problem = error.problems.find((entry) => entry.code === code);
      assert.equal(problem.row, coordinate.row);
      assert.equal(problem.column, coordinate.column);
      assert.equal(problem.header, coordinate.header);
      // No opaque single-string failure: the diagnostic keeps the structure.
      const diagnostic = diagnosticFor({ code: error.code, message: error.message, problems: error.problems });
      assert.notEqual(diagnostic.recovery, "Select a manifest-compatible v1 JSON export and try again.");
      assert.equal(diagnostic.problems.length, error.problems.length);
      return true;
    });
  }
});

test("no failure payload on this path echoes a cell value", async () => {
  const malformed = await fixture("provider-usage-malformed-quote.csv");
  assert.throws(() => parseLocalImportFile(malformed, "notes.csv", "text/csv", PINNED), (error) => {
    assert.doesNotMatch(JSON.stringify(error.problems), /unclosed note|closed note/);
    assert.doesNotMatch(error.message, /unclosed note/);
    return true;
  });
  const partial = parseLocalImportFile(await fixture("provider-usage-mixed-dates.tsv"),
    "usage.tsv", "text/tab-separated-values", PINNED);
  assert.doesNotMatch(JSON.stringify(partial.errors), /03\/07\/2026/);
  // Only headers and aggregate totals are retained beside the mapped records.
  assert.deepEqual([...partial.headers].slice(0, 2), ["date", "cost center"]);
  assert.equal(partial.totals.amountMinor, 1000);
});

test("a header that matches neither contract is named, not silently mapped", () => {
  assert.throws(() => parseLocalImportFile("colour,shape\nred,round\n", "other.csv", "text/csv"),
    (error) => error.code === CODES.UNRECOGNIZED_KIND && error.problems[0].row === 1);
});

test("the page wires the router and reads files with the browser's local APIs only", async () => {
  const script = await readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8");
  assert.match(script, /import \{ parseLocalImportFile \} from "\/local-import-formats\.js"/);
  assert.match(script, /parseLocalImportFile\(await file\.text\(\), file\.name, file\.type/);
  assert.doesNotMatch(script, /parseLocalFinopsFile/);
  // Same downstream call as before: no second pipeline, no new route.
  assert.match(script, /renderResult\(normalizeLocalFinopsHistory\(\{/);
  for (const source of ["delimited-text.js", "delimited-finops-mapping.js", "local-import-formats.js"]) {
    const module = await readFile(new URL(`../src/${source}`, import.meta.url), "utf8");
    assert.doesNotMatch(module, /\bfetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|navigator\.sendBeacon/);
  }
});
