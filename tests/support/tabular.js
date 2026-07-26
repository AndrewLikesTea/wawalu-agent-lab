// Test-only fixture reader: raw export text -> the table shape the dialect
// layer consumes ({ delimiter, headerRowIndex, columns, rows }).
//
// This is NOT a product parser and deliberately does not live in src/. The
// shipped importer is JSON-only, and the tabular parser this layer is written
// against has not landed; until it does, something has to turn a checked-in
// vendor fixture into columns and rows so the profiles are executable rather
// than aspirational. When the real parser lands, this file is deleted and its
// detection output feeds `detectDialect` directly — the contract is the shape
// below, not this code.

const DELIMITERS = [",", "\t", ";", "|"];

/** Split one delimited line, honouring RFC 4180 double-quoted fields. */
function splitLine(line, delimiter) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character !== "\"") cell += character;
      else if (line[index + 1] === "\"") { cell += "\""; index += 1; }
      else quoted = false;
    } else if (character === "\"") {
      quoted = true;
    } else if (character === delimiter) {
      cells.push(cell);
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

/** The delimiter that yields the most columns on the header line. */
function sniffDelimiter(line) {
  return DELIMITERS.reduce((best, candidate) =>
    splitLine(line, candidate).length > splitLine(line, best).length ? candidate : best);
}

export function readTable(text) {
  const lines = String(text).split(/\r?\n/).filter((line) => line.trim() !== "");
  if (!lines.length) return { delimiter: null, headerRowIndex: null, columns: [], rows: [] };
  const delimiter = sniffDelimiter(lines[0]);
  return {
    delimiter,
    headerRowIndex: 0,
    columns: splitLine(lines[0], delimiter),
    rows: lines.slice(1).map((line) => splitLine(line, delimiter)),
  };
}

/** Same table with its columns permuted, to prove mapping is name-based. */
export function reorderColumns(table, order) {
  return {
    ...table,
    columns: order.map((position) => table.columns[position]),
    rows: table.rows.map((row) => order.map((position) => row[position])),
  };
}

/** Same table with named columns removed, to prove the required gate holds. */
export function withoutColumns(table, names) {
  const keep = table.columns
    .map((name, position) => (names.includes(name) ? -1 : position))
    .filter((position) => position >= 0);
  return reorderColumns(table, keep);
}
