import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DELIMITED_IMPORT_CODES, DELIMITED_LIMITS, importProblem, normalizeHeaderName, readDelimitedText,
} from "../src/delimited-text.js";

const FIXTURES = new URL("./fixtures/delimited/", import.meta.url);

function fixture(name) {
  return readFile(new URL(name, FIXTURES), "utf8");
}

test("the delimiter comes from the file, not from the extension", async () => {
  // The .tsv fixture is tab-delimited and the .csv fixture is comma-delimited,
  // but the reader is never told which is which.
  const tsv = readDelimitedText(await fixture("provider-usage-mixed-dates.tsv"));
  assert.equal(tsv.ok, true);
  assert.equal(tsv.delimiter, "tab");
  assert.equal(tsv.header.length, 8);

  const csv = readDelimitedText(await fixture("provider-usage-openai.csv"));
  assert.equal(csv.delimiter, "comma");

  // A tab-delimited body under a lying .csv name still reads as tabs.
  const lying = readDelimitedText("date\tcost\tcurrency\n2026-07-24\t1.00\tUSD\n");
  assert.equal(lying.delimiter, "tab");
  assert.deepEqual(lying.header, ["date", "cost", "currency"]);

  // A comma inside quotes is content, so it cannot win the delimiter vote.
  const quotedCommas = readDelimitedText('a\tb\n"x,y,z,w"\tq\n');
  assert.equal(quotedCommas.delimiter, "tab");
  assert.deepEqual(quotedCommas.rows[0].cells, ["x,y,z,w", "q"]);
});

test("a UTF-8 BOM is stripped from the first header cell", async () => {
  const reading = readDelimitedText(await fixture("provider-usage-mixed-dates.tsv"));
  assert.equal(reading.header[0], "date");
  assert.equal(reading.normalizedHeader[0], "date");
  assert.equal(normalizeHeaderName("﻿  Cost   Center "), "cost center");
});

test("RFC4180 quoting survives embedded delimiters, newlines, and doubled quotes", async () => {
  const reading = readDelimitedText(await fixture("provider-usage-openai.csv"));
  assert.equal(reading.ok, true);
  assert.equal(reading.rows.length, 3);
  assert.equal(reading.errors.length, 0);
  assert.equal(reading.rows[0].cells.at(-1), "Renewal, annual");
  assert.equal(reading.rows[1].cells.at(-1), "Multi-line\nnote that stays in the file");
  assert.equal(reading.rows[2].cells.at(-1), 'He said "fine"');
  // The record that spans two physical lines is reported at the line it begins
  // on, and the record after it keeps counting physical lines.
  assert.deepEqual(reading.rows.map((row) => row.row), [2, 3, 5]);
  assert.equal(reading.headerRow, 1);
});

test("an unterminated quoted field fails the whole file with a coordinate", async () => {
  const reading = readDelimitedText(await fixture("provider-usage-malformed-quote.csv"));
  assert.equal(reading.ok, false);
  assert.equal(reading.error.code, DELIMITED_IMPORT_CODES.MALFORMED_QUOTED_FIELD);
  assert.equal(reading.error.row, 2);
  assert.equal(reading.error.column, 5);
  assert.doesNotMatch(reading.error.message, /unclosed note/);
});

test("trailing characters after a closing quote are a per-row problem, not an abort", () => {
  const reading = readDelimitedText('a,b\n"x"junk,2\nok,3\n');
  assert.equal(reading.ok, true);
  assert.equal(reading.errors.length, 1);
  assert.equal(reading.errors[0].code, DELIMITED_IMPORT_CODES.MALFORMED_QUOTED_FIELD);
  assert.equal(reading.errors[0].row, 2);
  assert.equal(reading.errors[0].column, 1);
  assert.deepEqual(reading.rows.map((row) => row.cells), [["x", "2"], ["ok", "3"]]);
});

test("a ragged row is a coordinate-tagged row error, not a whole-file abort", () => {
  const reading = readDelimitedText("a,b,c\n1,2,3\n4,5\n6,7,8,9\n");
  assert.equal(reading.ok, true);
  assert.equal(reading.rows.length, 1);
  assert.deepEqual(reading.errors.map((problem) => [problem.code, problem.row, problem.column]), [
    [DELIMITED_IMPORT_CODES.RAGGED_ROW, 3, 3],
    [DELIMITED_IMPORT_CODES.RAGGED_ROW, 4, 4],
  ]);
  assert.equal(reading.errors[0].expectedCells, 3);
  assert.equal(reading.errors[0].observedCells, 2);
});

test("CRLF line endings and a trailing newline-free row are read the same", () => {
  const reading = readDelimitedText("a,b\r\n1,2\r\n3,4");
  assert.deepEqual(reading.rows.map((row) => row.cells), [["1", "2"], ["3", "4"]]);
  assert.deepEqual(reading.rows.map((row) => row.row), [2, 3]);
});

test("a missing header row and an empty file are named, not guessed at", () => {
  assert.equal(readDelimitedText("2026-07-24,12.34\n").error.code,
    DELIMITED_IMPORT_CODES.MISSING_HEADER_ROW);
  assert.equal(readDelimitedText("   \n\n").error.code, DELIMITED_IMPORT_CODES.EMPTY_FILE);
  assert.equal(readDelimitedText("").error.code, DELIMITED_IMPORT_CODES.EMPTY_FILE);
});

test("a duplicated column is reported and the first occurrence is used", () => {
  const reading = readDelimitedText("cost,cost\n1,2\n");
  assert.equal(reading.errors[0].code, DELIMITED_IMPORT_CODES.DUPLICATE_COLUMN);
  assert.equal(reading.errors[0].column, 2);
  assert.equal(reading.errors[0].header, "cost");
});

test("the ceilings are declared, enforced, and reported with their value", () => {
  // Generated in-test rather than checked in: a file over the ceiling is large
  // by definition and has no business in the repository.
  const overRows = [...Array(DELIMITED_LIMITS.maxDataRows + 1)].map((_, index) => `${index},2`);
  const rowFailure = readDelimitedText(`a,b\n${overRows.join("\n")}\n`);
  assert.equal(rowFailure.ok, false);
  assert.equal(rowFailure.error.code, DELIMITED_IMPORT_CODES.ROW_CEILING_EXCEEDED);
  assert.equal(rowFailure.error.ceiling, DELIMITED_LIMITS.maxDataRows);
  assert.equal(rowFailure.error.observed, DELIMITED_LIMITS.maxDataRows + 1);

  // Nothing is truncated: the failure replaces the read, it does not trim it.
  assert.equal(rowFailure.rows, undefined);

  const sizeFailure = readDelimitedText("a,b\n1,2\n", { byteSize: DELIMITED_LIMITS.maxBytes + 1 });
  assert.equal(sizeFailure.error.code, DELIMITED_IMPORT_CODES.SIZE_CEILING_EXCEEDED);
  assert.equal(sizeFailure.error.ceiling, DELIMITED_LIMITS.maxBytes);
  assert.match(sizeFailure.error.message, new RegExp(String(DELIMITED_LIMITS.maxBytes)));

  const wide = [...Array(DELIMITED_LIMITS.maxColumns + 1)].map((_, index) => `c${index}`);
  const columnFailure = readDelimitedText(`${wide.join(",")}\n`);
  assert.equal(columnFailure.error.code, DELIMITED_IMPORT_CODES.COLUMN_CEILING_EXCEEDED);
  assert.equal(columnFailure.error.ceiling, DELIMITED_LIMITS.maxColumns);
});

test("reason codes are a closed set", () => {
  assert.throws(() => importProblem("something_went_wrong", {}), /closed delimited-import set/);
  const problem = importProblem(DELIMITED_IMPORT_CODES.RAGGED_ROW, { row: 4, column: 2 });
  assert.deepEqual(problem, { code: "ragged_row", row: 4, column: 2, header: null, message: "" });
  assert.equal(Object.isFrozen(problem), true);
});
