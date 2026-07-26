import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DELIMITED_CODES,
  MAX_DELIMITED_BYTES,
  MAX_DELIMITED_ROWS,
  readDelimitedText,
  utf8ByteLength,
} from "../src/delimited-text.js";

const FIXTURES = new URL("./fixtures/delimited/", import.meta.url);

async function fixture(name) {
  return readFile(new URL(name, FIXTURES), "utf8");
}

test("the delimiter is decided by the file, not by the extension", async () => {
  const comma = readDelimitedText(await fixture("openai-usage.csv"));
  assert.equal(comma.ok, true);
  assert.equal(comma.delimiterName, "comma");
  assert.equal(comma.header[0], "date");
  assert.equal(comma.rows.length, 4);

  // The tab fixture is read here with no hint from its name at all.
  const tab = readDelimitedText(await fixture("bedrock-usage.tsv"));
  assert.equal(tab.ok, true);
  assert.equal(tab.delimiterName, "tab");
  assert.equal(tab.header.length, 6);

  // A comma-bearing tab file must still read as tabs: commas inside the values
  // do not make it a CSV, because they do not produce a consistent field count.
  const mixed = readDelimitedText("a\tb\tc\nx, y\tz\tw\np, q\tr\ts\n");
  assert.equal(mixed.delimiterName, "tab");
  assert.equal(mixed.rows[0].values[0], "x, y");
});

test("RFC4180 quoting survives delimiters, newlines, and doubled quotes", () => {
  const reading = readDelimitedText(
    'a,b\n"has, comma","has\nnewline"\n"said ""hi""",plain\n',
  );
  assert.equal(reading.ok, true);
  assert.deepEqual(reading.rows[0].values, ["has, comma", "has\nnewline"]);
  assert.deepEqual(reading.rows[1].values, ['said "hi"', "plain"]);
  // A quoted newline does not advance the row number a spreadsheet shows.
  assert.deepEqual(reading.rows.map((row) => row.row), [2, 3]);
});

test("a BOM is stripped and CRLF is reported without changing the fields", async () => {
  const raw = await fixture("bedrock-usage.tsv");
  const withBom = `﻿${raw.replace(/\n/g, "\r\n")}`;
  const plain = readDelimitedText(raw);
  const decorated = readDelimitedText(withBom);

  assert.equal(plain.hadBom, false);
  assert.equal(plain.lineEnding, "LF");
  assert.equal(decorated.hadBom, true);
  assert.equal(decorated.lineEnding, "CRLF");
  assert.equal(decorated.header[0], "lineItem/UsageStartDate");
  assert.deepEqual(decorated.header, plain.header);
  assert.deepEqual(
    decorated.rows.map((row) => row.values),
    plain.rows.map((row) => row.values),
  );
});

test("an unterminated quote fails with a located reason code", () => {
  const reading = readDelimitedText('a,b\nok,fine\n"never closed,2\n');
  assert.equal(reading.ok, false);
  assert.equal(reading.problem.code, DELIMITED_CODES.MALFORMED_QUOTED_FIELD);
  assert.equal(reading.problem.row, 3);
  assert.equal(reading.problem.columnIndex, 0);

  const trailing = readDelimitedText('a,b\n"closed"then,2\n');
  assert.equal(trailing.problem.code, DELIMITED_CODES.MALFORMED_QUOTED_FIELD);
  assert.equal(trailing.problem.row, 2);
});

test("the row and byte ceilings are named limits reported with the observed value", () => {
  assert.ok(Number.isInteger(MAX_DELIMITED_ROWS) && MAX_DELIMITED_ROWS > 0);
  assert.ok(Number.isInteger(MAX_DELIMITED_BYTES) && MAX_DELIMITED_BYTES > 0);

  const rows = ["a,b", ...Array.from({ length: 12 }, (_, index) => `${index},x`)].join("\n");
  const tooMany = readDelimitedText(rows, { maxRows: 5 });
  assert.equal(tooMany.ok, false);
  assert.equal(tooMany.problem.code, DELIMITED_CODES.TOO_MANY_ROWS);
  assert.equal(tooMany.problem.limit, 5);
  assert.equal(tooMany.problem.observed, 13);

  const tooBig = readDelimitedText(rows, { maxBytes: 10 });
  assert.equal(tooBig.problem.code, DELIMITED_CODES.FILE_TOO_LARGE);
  assert.equal(tooBig.problem.limit, 10);
  assert.equal(tooBig.problem.observed, utf8ByteLength(rows));
});

test("empty and undelimited input are distinguished from each other", () => {
  assert.equal(readDelimitedText("").problem.code, DELIMITED_CODES.EMPTY_FILE);
  assert.equal(readDelimitedText("﻿\n\n").problem.code, DELIMITED_CODES.EMPTY_FILE);
  assert.equal(readDelimitedText("just one column\nand a value\n").problem.code,
    DELIMITED_CODES.UNSUPPORTED_FORMAT);
});

test("UTF-8 byte length is measured without encoding a copy", () => {
  assert.equal(utf8ByteLength("abc"), 3);
  assert.equal(utf8ByteLength("é"), 2);
  assert.equal(utf8ByteLength("€"), 3);
  assert.equal(utf8ByteLength("😀"), 4);
});
