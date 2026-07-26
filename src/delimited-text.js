// Pure delimited-text reader for the browser-local import panel.
//
// Input is decoded file text; output is a header row plus data rows, or a
// structured failure. There is no DOM, no fetch, no storage, and no File API in
// here: the caller reads bytes with the browser's local file APIs and hands the
// text over.
//
// Three rules hold in this module:
//   1. The delimiter comes from the file, never from the file extension.
//      Extensions lie; a `.txt` holding tabs and a `.csv` holding tabs are the
//      same file to us.
//   2. Ceilings are declared, named, and reported. Nothing is truncated
//      silently: over a ceiling we fail with the ceiling value in the payload.
//   3. No cell value ever reaches a failure payload. A problem carries the
//      1-based spreadsheet coordinate, the reason code, and — where one exists —
//      the header name. The value stays in the file.

/**
 * The single declared ceiling for this path. Both limits are checked before any
 * mapping work happens, and both are echoed into the failure payload so a
 * reader is told the actual number rather than "too big".
 */
export const DELIMITED_LIMITS = Object.freeze({
  maxBytes: 8_000_000,
  maxDataRows: 50_000,
  maxColumns: 256,
});

/**
 * The closed set of reason codes this whole path may emit — reader and mapper.
 * A later task renders these, so the set is the contract: no opaque strings, and
 * no code that is not listed here.
 */
export const DELIMITED_IMPORT_CODES = Object.freeze({
  SIZE_CEILING_EXCEEDED: "size_ceiling_exceeded",
  ROW_CEILING_EXCEEDED: "row_ceiling_exceeded",
  COLUMN_CEILING_EXCEEDED: "column_ceiling_exceeded",
  EMPTY_FILE: "empty_file",
  MISSING_HEADER_ROW: "missing_header_row",
  DUPLICATE_COLUMN: "duplicate_column",
  MALFORMED_QUOTED_FIELD: "malformed_quoted_field",
  RAGGED_ROW: "ragged_row",
  MISSING_REQUIRED_COLUMN: "missing_required_column",
  UNRECOGNIZED_KIND: "unrecognized_kind",
  UNPARSEABLE_DATE: "unparseable_date",
  UNPARSEABLE_AMOUNT: "unparseable_amount",
  NEGATIVE_AMOUNT: "negative_amount",
  AMOUNT_PRECISION_EXCEEDED: "amount_precision_exceeded",
  UNSUPPORTED_CURRENCY: "unsupported_currency",
  UNPARSEABLE_QUANTITY: "unparseable_quantity",
  UNPARSEABLE_FLAG: "unparseable_flag",
  UNPSEUDONYMIZED_IDENTIFIER: "unpseudonymized_identifier",
  NO_MAPPABLE_ROWS: "no_mappable_rows",
});

const CODE_VALUES = Object.freeze(Object.values(DELIMITED_IMPORT_CODES));

/** Candidate delimiters, in tie-break order. Comma wins a tie. */
const DELIMITERS = Object.freeze([
  Object.freeze({ id: "comma", character: "," }),
  Object.freeze({ id: "tab", character: "\t" }),
]);

const BOM = "﻿";
const QUOTE = '"';

/**
 * Every failure on this path is one of these. `row` and `column` are 1-based so
 * they match what a spreadsheet shows; `null` means the problem is not anchored
 * to a cell. `header` is the offending column's header name, which is metadata,
 * not content. `message` is written to be safe to display verbatim.
 */
export function importProblem(code, { row = null, column = null, header = null, message = "", ...rest } = {}) {
  if (!CODE_VALUES.includes(code)) {
    throw new TypeError(`Reason code “${code}” is not in the closed delimited-import set.`);
  }
  return Object.freeze({ code, row, column, header, message, ...rest });
}

/** UTF-8 byte length without materializing a second copy of the whole file. */
function utf8ByteLength(text) {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const point = text.codePointAt(index);
    if (point > 0xffff) {
      bytes += 4;
      index += 1;
    } else if (point > 0x7ff) bytes += 3;
    else if (point > 0x7f) bytes += 2;
    else bytes += 1;
  }
  return bytes;
}

/**
 * Count top-level delimiter candidates. Quote handling does not depend on which
 * delimiter is in play, so one quote-aware pass scores both candidates: a comma
 * inside `"Acme, Inc"` is not a column boundary for either of them.
 */
function detectDelimiter(text) {
  const counts = new Map(DELIMITERS.map((delimiter) => [delimiter.character, 0]));
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character !== QUOTE) continue;
      if (text[index + 1] === QUOTE) index += 1;
      else quoted = false;
      continue;
    }
    if (character === QUOTE) quoted = true;
    else if (counts.has(character)) counts.set(character, counts.get(character) + 1);
  }
  const best = DELIMITERS.reduce((winner, candidate) =>
    counts.get(candidate.character) > counts.get(winner.character) ? candidate : winner);
  // A single-column file has no delimiter to detect; comma is the declared
  // default so the row shape is still well defined.
  return counts.get(best.character) > 0 ? best : DELIMITERS[0];
}

/**
 * Is the first record a header row? Decided from shape alone, because this
 * module must not know the alias table: a header cell is non-empty, is not a
 * number, and is not a date-ish value. All cells must qualify.
 */
function looksLikeHeaderRow(cells) {
  if (!cells.length) return false;
  return cells.every((cell) => {
    const value = cell.trim();
    if (!value) return false;
    if (/^[-+]?[\d.,]+$/.test(value)) return false;
    if (/^\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?/.test(value)) return false;
    return true;
  });
}

/** Normalized header key: trimmed, lowercased, internal whitespace collapsed. */
export function normalizeHeaderName(value) {
  return String(value ?? "").replace(BOM, "").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Tokenize into records. RFC4180 quoting: a field is quoted only when the quote
 * opens the field, `""` is a literal quote, and embedded delimiters and newlines
 * survive inside quotes.
 *
 * Two malformed-quote shapes are distinguished deliberately:
 *   - junk after a closing quote (`"a"b`) is recoverable, so it becomes a
 *     per-record problem and parsing continues with the next record;
 *   - an unterminated quote swallows the rest of the file, so nothing after it
 *     can be trusted and it is a whole-file failure.
 */
function tokenize(text, delimiter) {
  const records = [];
  const problems = [];
  let cells = [];
  let field = "";
  // `line` is the physical line the cursor is on; `recordLine` is the line the
  // current record started on. A quoted newline advances the first and not the
  // second, so a record that spans lines is reported at the line a reader sees
  // it begin on.
  let line = 1;
  let recordLine = 1;
  let column = 1;
  let index = 0;

  const endField = () => {
    cells.push(field);
    field = "";
    column += 1;
  };
  const endRecord = () => {
    endField();
    records.push({ line: recordLine, cells });
    cells = [];
    column = 1;
  };

  while (index < text.length) {
    const character = text[index];
    if (character === QUOTE && field === "") {
      index += 1;
      let closed = false;
      while (index < text.length) {
        if (text[index] === QUOTE) {
          if (text[index + 1] === QUOTE) {
            field += QUOTE;
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        if (text[index] === "\r" || text[index] === "\n") {
          // A newline inside quotes is content, normalized to LF so a cell does
          // not carry the file's line-ending convention into the mapping.
          index += text[index] === "\r" && text[index + 1] === "\n" ? 2 : 1;
          field += "\n";
          line += 1;
          continue;
        }
        field += text[index];
        index += 1;
      }
      if (!closed) {
        return {
          fatal: importProblem(DELIMITED_IMPORT_CODES.MALFORMED_QUOTED_FIELD, {
            row: recordLine,
            column,
            message: "A quoted field is never closed, so the rest of the file cannot be read.",
          }),
        };
      }
      const next = text[index];
      if (next !== undefined && next !== delimiter && next !== "\n" && next !== "\r") {
        problems.push(importProblem(DELIMITED_IMPORT_CODES.MALFORMED_QUOTED_FIELD, {
          row: recordLine,
          column,
          message: "A quoted field has trailing characters after its closing quote.",
        }));
        while (index < text.length && text[index] !== delimiter
          && text[index] !== "\n" && text[index] !== "\r") index += 1;
      }
      continue;
    }
    if (character === delimiter) {
      endField();
      index += 1;
      continue;
    }
    if (character === "\r" || character === "\n") {
      index += character === "\r" && text[index + 1] === "\n" ? 2 : 1;
      endRecord();
      line += 1;
      recordLine = line;
      continue;
    }
    field += character;
    index += 1;
  }
  if (field !== "" || cells.length) endRecord();
  return { records, problems };
}

/**
 * Read decoded delimited text.
 *
 * @param {string} text decoded file text (the caller owns decoding)
 * @param {{byteSize?: number}} options `byteSize` is the real file size when the
 *   caller knows it, so the ceiling is enforced against bytes on disk rather
 *   than against a re-encoded estimate.
 * @returns {{ok: true, delimiter: string, header: string[], normalizedHeader: string[],
 *   headerRow: number, rows: Array<{row: number, cells: string[]}>, errors: object[],
 *   dataRowCount: number}
 *   | {ok: false, error: object}}
 */
export function readDelimitedText(text, { byteSize } = {}) {
  const raw = String(text ?? "");
  const bytes = Number.isFinite(byteSize) ? byteSize : utf8ByteLength(raw);
  if (bytes > DELIMITED_LIMITS.maxBytes) {
    return {
      ok: false,
      error: importProblem(DELIMITED_IMPORT_CODES.SIZE_CEILING_EXCEEDED, {
        message: `The file is larger than the ${DELIMITED_LIMITS.maxBytes}-byte import ceiling; nothing was read.`,
        ceiling: DELIMITED_LIMITS.maxBytes,
        observed: bytes,
      }),
    };
  }
  const body = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw;
  if (!body.trim()) {
    return {
      ok: false,
      error: importProblem(DELIMITED_IMPORT_CODES.EMPTY_FILE, {
        message: "The file contains no rows.",
      }),
    };
  }

  const delimiter = detectDelimiter(body);
  const tokenized = tokenize(body, delimiter.character);
  if (tokenized.fatal) return { ok: false, error: tokenized.fatal };

  const records = tokenized.records.filter((record) =>
    record.cells.some((cell) => cell.trim() !== ""));
  const [first, ...dataRecords] = records;
  if (!first || !looksLikeHeaderRow(first.cells)) {
    return {
      ok: false,
      error: importProblem(DELIMITED_IMPORT_CODES.MISSING_HEADER_ROW, {
        row: first?.line ?? 1,
        message: "The first row is not a header row; a delimited import must name its columns.",
      }),
    };
  }
  if (first.cells.length > DELIMITED_LIMITS.maxColumns) {
    return {
      ok: false,
      error: importProblem(DELIMITED_IMPORT_CODES.COLUMN_CEILING_EXCEEDED, {
        row: first.line,
        message: `The header declares more than the ${DELIMITED_LIMITS.maxColumns}-column import ceiling.`,
        ceiling: DELIMITED_LIMITS.maxColumns,
        observed: first.cells.length,
      }),
    };
  }
  if (dataRecords.length > DELIMITED_LIMITS.maxDataRows) {
    return {
      ok: false,
      error: importProblem(DELIMITED_IMPORT_CODES.ROW_CEILING_EXCEEDED, {
        message: `The file has more than the ${DELIMITED_LIMITS.maxDataRows}-row import ceiling; nothing was mapped.`,
        ceiling: DELIMITED_LIMITS.maxDataRows,
        observed: dataRecords.length,
      }),
    };
  }

  const header = first.cells.map((cell) => cell.replace(BOM, "").trim());
  const normalizedHeader = header.map(normalizeHeaderName);
  const errors = [...tokenized.problems];
  const seen = new Map();
  normalizedHeader.forEach((name, position) => {
    if (seen.has(name)) {
      errors.push(importProblem(DELIMITED_IMPORT_CODES.DUPLICATE_COLUMN, {
        row: first.line,
        column: position + 1,
        header: header[position],
        message: `Column “${header[position]}” is declared more than once; the first occurrence is used.`,
      }));
      return;
    }
    seen.set(name, position);
  });

  const rows = [];
  for (const record of dataRecords) {
    if (record.cells.length !== header.length) {
      errors.push(importProblem(DELIMITED_IMPORT_CODES.RAGGED_ROW, {
        row: record.line,
        column: Math.min(record.cells.length, header.length) + 1,
        message: `The row has ${record.cells.length} cells; the header declares ${header.length}.`,
        expectedCells: header.length,
        observedCells: record.cells.length,
      }));
      continue;
    }
    rows.push({ row: record.line, cells: record.cells });
  }

  return {
    ok: true,
    delimiter: delimiter.id,
    header,
    normalizedHeader,
    headerRow: first.line,
    rows,
    errors,
    dataRowCount: dataRecords.length,
  };
}
