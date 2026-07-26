// Format routing for the browser-local import panel.
//
// One entry point, two readers, one envelope. A selected file is either a v1
// JSON envelope or a delimited provider/roster export; both end as the same
// validated v1 document, so `normalizeLocalFinopsHistory` and every surface
// downstream of it are untouched by this path.
//
// Routing is decided by content, not by extension. A `.txt` holding an envelope
// and a `.csv` holding tabs are both read correctly, because extensions lie. The
// extension and media type only gate the accept list.

import {
  mapDelimitedOrgUnits, mapDelimitedProviderUsage, detectDelimitedKind,
} from "./delimited-finops-mapping.js";
import { DELIMITED_IMPORT_CODES, importProblem, readDelimitedText } from "./delimited-text.js";
import { parseLocalFinopsFile, validateLocalFinopsEnvelope } from "./local-finops.js";

/** What the file picker admits, and what the validator will read. */
export const ACCEPTED_LOCAL_IMPORT = Object.freeze({
  extensions: Object.freeze([".json", ".csv", ".tsv", ".txt"]),
  mediaTypes: Object.freeze([
    "application/json", "text/json", "text/csv", "application/csv",
    "text/tab-separated-values", "text/plain", "",
  ]),
  accept: ".json,.csv,.tsv,.txt,application/json,text/csv,text/tab-separated-values,text/plain",
});

function failure(code, message, problems = []) {
  const error = new TypeError(message);
  error.code = code;
  error.problems = Object.freeze(problems);
  return error;
}

/** A JSON envelope starts with `{`; anything else on this path is delimited. */
export function looksLikeJsonEnvelope(text) {
  return String(text ?? "").replace(/^﻿/, "").trimStart().startsWith("{");
}

/**
 * Read one selected file into a validated v1 envelope.
 *
 * Success carries the partial-parse detail the delimited path can produce:
 * `errors` is the per-row problem list, so parsed rows and rejected rows are
 * representable together. Failure throws with a machine-readable `code` and a
 * `problems` array of coordinate-tagged objects.
 *
 * @param {string} text decoded file text, read with the browser's local file APIs
 * @param {string} fileName used only for the accept-list gate and echoed back
 * @param {string} mediaType the browser's type, gate only
 * @param {object} options forwarded to the mapper (`exportId`, `generatedAt`, …)
 */
export function parseLocalImportFile(text, fileName = "local.csv", mediaType = "", options = {}) {
  const lower = String(fileName).toLowerCase();
  if (!ACCEPTED_LOCAL_IMPORT.extensions.some((extension) => lower.endsWith(extension))) {
    // The message carries no extension spelling and no file name: the reading
    // layer redacts file references before display, and a mangled sentence is a
    // worse diagnostic than a plain one.
    throw failure("unsupported_format",
      "The selected file is not a declared format; JSON envelopes and delimited CSV, TSV, or plain-text exports are supported.");
  }
  if (mediaType && !ACCEPTED_LOCAL_IMPORT.mediaTypes.includes(mediaType)) {
    throw failure("unsupported_format", `The file media type “${mediaType}” is not declared by the manifest.`);
  }
  if (looksLikeJsonEnvelope(text)) {
    // Hand the whole string to the reviewed JSON validator unchanged, under the
    // name it expects, so its behaviour and its tests stay exactly as they are.
    const parsed = parseLocalFinopsFile(text, "local.json", "");
    return Object.freeze({
      ...parsed,
      fileName,
      format: "json",
      errors: Object.freeze([]),
      defaultsApplied: Object.freeze([]),
      rowsMapped: parsed.document.records.length,
      rowsRejected: 0,
    });
  }
  return parseDelimitedLocalFile(text, fileName, options);
}

/**
 * Read delimited text into a validated v1 envelope. Exported for tests and for
 * callers that already know the content is tabular.
 */
export function parseDelimitedLocalFile(text, fileName = "local.csv", options = {}) {
  const reading = readDelimitedText(text, { byteSize: options.byteSize });
  if (!reading.ok) throw failure(reading.error.code, reading.error.message, [reading.error]);

  const kind = detectDelimitedKind(reading.normalizedHeader);
  if (!kind) {
    const problem = importProblem(DELIMITED_IMPORT_CODES.UNRECOGNIZED_KIND, {
      row: reading.headerRow,
      message: "The header matches neither a provider-usage export nor an org-unit roster.",
      headers: Object.freeze([...reading.header]),
    });
    throw failure(problem.code, problem.message, [problem]);
  }
  const mapped = kind === "provider"
    ? mapDelimitedProviderUsage(reading, options)
    : mapDelimitedOrgUnits(reading, options);
  if (!mapped.ok) {
    const first = mapped.errors.find((problem) =>
      problem.code === DELIMITED_IMPORT_CODES.MISSING_REQUIRED_COLUMN) ?? mapped.errors.at(-1);
    throw failure(first.code, first.message, mapped.errors);
  }
  // The convergence check: the mapped document must satisfy the same v1
  // validator the JSON path uses. A throw here is a mapping defect, and it
  // surfaces with the JSON path's own reason code rather than being swallowed.
  let type;
  try {
    type = validateLocalFinopsEnvelope(mapped.document);
  } catch (error) {
    throw failure(error.code ?? "invalid_value", error.message, mapped.errors);
  }
  return Object.freeze({
    type,
    fileName,
    format: "delimited",
    delimiter: mapped.delimiter,
    document: mapped.document,
    headers: mapped.headers,
    errors: mapped.errors,
    defaultsApplied: mapped.defaultsApplied,
    totals: mapped.totals,
    rowsMapped: mapped.rowsMapped,
    rowsRejected: mapped.rowsRejected,
  });
}
