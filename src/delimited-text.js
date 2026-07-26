// Delimited-text reader for the browser-local import surface.
//
// One pure function in, one structured value out. No DOM, no network, no
// storage, no dependency: a provider CSV is untrusted input read inside the
// reader's own tab, so this layer decides everything from the bytes rather than
// from a file name, and it fails with a code and a coordinate rather than a
// sentence.
//
// What is detected from the file itself:
//   * delimiter — comma or tab, chosen by which one yields a consistent field
//     count across the leading records, never by the extension;
//   * RFC4180 quoting — doubled quotes, embedded delimiters, embedded newlines;
//   * a UTF-8 BOM, which is stripped before anything reads the header;
//   * CRLF, LF, or bare CR line endings.
//
// Row numbers are the ones a reader sees in a spreadsheet: record 1 is the
// header, the first data record is row 2, and a quoted field containing a
// newline does not advance the count.

/** Largest accepted file, in UTF-8 bytes. Checked before any record is built. */
export const MAX_DELIMITED_BYTES = 8_000_000;

/** Largest accepted record count, header row included. */
export const MAX_DELIMITED_ROWS = 50_000;

/** How many leading records the delimiter vote inspects. */
export const DELIMITER_SAMPLE_ROWS = 20;

export const DELIMITED_CODES = Object.freeze({
  EMPTY_FILE: "empty_file",
  FILE_TOO_LARGE: "file_too_large",
  TOO_MANY_ROWS: "too_many_rows",
  MALFORMED_QUOTED_FIELD: "malformed_quoted_field",
  UNSUPPORTED_FORMAT: "unsupported_format",
});

const CANDIDATE_DELIMITERS = Object.freeze([
  Object.freeze({ character: ",", name: "comma" }),
  Object.freeze({ character: "\t", name: "tab" }),
]);

const BOM = "﻿";

/** UTF-8 length without allocating an encoded copy of the file. */
export function utf8ByteLength(text) {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function problem(code, detail) {
  return Object.freeze({ code, ...detail });
}

/**
 * Split one candidate delimiter's records out of the text.
 *
 * Returns `{ ok: true, records }` or a `malformed_quoted_field` problem carrying
 * the 1-based record number and the 0-based field index where the quoting broke.
 */
function parseRecords(text, delimiter) {
  const records = [];
  let field = "";
  let values = [];
  let inQuotes = false;
  let row = 1;
  let fieldIndex = 0;
  let index = 0;

  const malformed = (detail) => problem(DELIMITED_CODES.MALFORMED_QUOTED_FIELD, {
    row, columnIndex: fieldIndex, detail,
  });

  while (index < text.length) {
    const character = text[index];
    if (inQuotes) {
      if (character !== '"') {
        field += character;
        index += 1;
        continue;
      }
      if (text[index + 1] === '"') {
        field += '"';
        index += 2;
        continue;
      }
      inQuotes = false;
      index += 1;
      const next = text[index];
      // Anything other than a delimiter or a line break after the closing quote
      // means the field was never really closed. Guessing which half the reader
      // meant is how a silent mis-parse ships.
      if (next !== undefined && next !== delimiter && next !== "\n" && next !== "\r") {
        return { ok: false, problem: malformed("text follows a closed quoted field") };
      }
      continue;
    }
    if (character === '"') {
      if (field.length > 0) {
        return { ok: false, problem: malformed("a quote opens inside an unquoted field") };
      }
      inQuotes = true;
      index += 1;
      continue;
    }
    if (character === delimiter) {
      values.push(field);
      field = "";
      fieldIndex += 1;
      index += 1;
      continue;
    }
    if (character === "\r" || character === "\n") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      index += 1;
      values.push(field);
      records.push({ row, values });
      field = "";
      values = [];
      fieldIndex = 0;
      row += 1;
      continue;
    }
    field += character;
    index += 1;
  }
  if (inQuotes) return { ok: false, problem: malformed("the file ends inside a quoted field") };
  if (field.length > 0 || values.length > 0) {
    values.push(field);
    records.push({ row, values });
  }
  return { ok: true, records };
}

/** Blank separator lines are not rows; a record of one empty field is blank. */
function isBlank(record) {
  return record.values.length === 1 && record.values[0].trim() === "";
}

/**
 * How well a delimiter explains the file: the share of the leading records whose
 * field count matches the header's. A tab file read with commas collapses to one
 * field per row, which scores a wide header of 1 and loses to the real answer.
 */
function scoreCandidate(records) {
  const sample = records.slice(0, DELIMITER_SAMPLE_ROWS);
  const width = sample[0]?.values.length ?? 0;
  const consistent = sample.filter((record) => record.values.length === width).length;
  return { width, consistency: sample.length ? consistent / sample.length : 0 };
}

/**
 * Read delimited text into a header row plus data rows, or a structured failure.
 *
 * @param {string} text raw file text, BOM and all.
 * @param {{maxBytes?: number, maxRows?: number}} [limits]
 * @returns {{ok: true, delimiter, delimiterName, header, rows, rowCount, byteSize,
 *   lineEnding, hadBom, quoted}|{ok: false, problem}}
 */
export function readDelimitedText(text, { maxBytes, maxRows } = {}) {
  const byteLimit = Number.isInteger(maxBytes) ? maxBytes : MAX_DELIMITED_BYTES;
  const rowLimit = Number.isInteger(maxRows) ? maxRows : MAX_DELIMITED_ROWS;
  const source = String(text ?? "");
  const byteSize = utf8ByteLength(source);
  if (byteSize > byteLimit) {
    return {
      ok: false,
      problem: problem(DELIMITED_CODES.FILE_TOO_LARGE, {
        limit: byteLimit, observed: byteSize, unit: "bytes",
      }),
    };
  }
  const hadBom = source.startsWith(BOM);
  const body = hadBom ? source.slice(BOM.length) : source;
  if (body.trim() === "") {
    return { ok: false, problem: problem(DELIMITED_CODES.EMPTY_FILE, { observed: 0, unit: "rows" }) };
  }

  const attempts = CANDIDATE_DELIMITERS.map((candidate) => ({
    ...candidate,
    result: parseRecords(body, candidate.character),
  }));
  const usable = attempts.filter((attempt) => attempt.result.ok);
  if (!usable.length) {
    // Broken quoting breaks every delimiter equally. Report it against whichever
    // separator the file actually leans on, so the coordinate lands where the
    // reader's spreadsheet would put it.
    const counts = attempts.map((attempt) => ({
      attempt,
      hits: body.split(attempt.character).length - 1,
    }));
    counts.sort((left, right) => right.hits - left.hits);
    return { ok: false, problem: counts[0].attempt.result.problem };
  }

  // A delimiter that never appears splits the file into one perfectly consistent
  // column, which would otherwise win the consistency vote outright. Splitting
  // the header at all is the first requirement; consistency only decides between
  // candidates that actually do.
  const scored = usable
    .map((attempt) => ({ ...attempt, score: scoreCandidate(attempt.result.records) }))
    .sort((left, right) => Number(right.score.width >= 2) - Number(left.score.width >= 2)
      || right.score.consistency - left.score.consistency
      || right.score.width - left.score.width);
  const chosen = scored[0];
  if (chosen.score.width < 2) {
    return {
      ok: false,
      problem: problem(DELIMITED_CODES.UNSUPPORTED_FORMAT, {
        detail: "no comma or tab separates the header into fields",
      }),
    };
  }

  const records = chosen.result.records.filter((record) => !isBlank(record));
  if (records.length > rowLimit) {
    return {
      ok: false,
      problem: problem(DELIMITED_CODES.TOO_MANY_ROWS, {
        limit: rowLimit, observed: records.length, unit: "rows",
      }),
    };
  }
  const [header, ...rows] = records;
  return Object.freeze({
    ok: true,
    delimiter: chosen.character,
    delimiterName: chosen.name,
    header: Object.freeze(header.values.map((value) => value.trim())),
    headerRow: header.row,
    rows: Object.freeze(rows.map((record) => Object.freeze({
      row: record.row,
      values: Object.freeze(record.values),
    }))),
    rowCount: records.length,
    byteSize,
    lineEnding: body.includes("\r\n") ? "CRLF" : body.includes("\r") ? "CR" : "LF",
    hadBom,
    quoted: body.includes('"'),
  });
}
