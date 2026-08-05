// Engineer headcount from a privacy-preserving HRIS roster, read in the reader's
// own tab (#1105).
//
// THE CONTRACT IS THE DELIVERABLE, and it is written down before this file:
// `contracts/integrations/hris-headcount-roster/v1/manifest.json`. Every rule
// below — the two permitted columns, the classification counted, the refusal for
// an unlisted column, and what happens to each degenerate shape — is stated
// there first and restated here as code. `ROSTER_CONTRACT_VERSION` is carried in
// both and asserted equal by the test, so the two cannot drift apart quietly.
//
// TWO COLUMNS IS THE WHOLE PERMITTED SURFACE. A roster names a role bucket and a
// month, and nothing else. An unlisted column is REFUSED, never dropped —
// dropping is how a file carrying salaries becomes a file we quietly accepted,
// and it makes the promise "no personal data was read" unprovable. Refusing on
// the header record means the refusal is decided before a single data cell is
// parsed.
//
// ONE BAD ROW REFUSES THE FILE. A headcount is one integer with no error bars: a
// file three rows short produces a number that reads exactly like a correct one.
// The one thing this module does silently drop is a row for a period other than
// the one being counted, and it reports how many.
//
// NO I/O OF ANY KIND. No fetch, no XHR, no storage, no cookie, no clock. The
// caller hands over a string it got from the browser's own local Blob text API,
// and gets back counts, the two header names, and sentences authored here. No
// cell value is returned, rendered, or retained.

import { DELIMITED_CODES, readDelimitedText } from "./delimited-text.js";

/** Bump with the manifest whenever a column, a code, or a behavior changes. */
export const ROSTER_CONTRACT_VERSION = "hris-headcount-roster/1.0.0";

/** The two columns, by the names the contract publishes. Nothing else is read. */
export const ROSTER_COLUMN = Object.freeze({ role: "team_role", period: "period" });

/** The one role bucket that counts as an engineer. Trimmed, case-folded, exact. */
export const ENGINEERING_CLASSIFICATION = "engineering";

/**
 * Personal columns named in the disclosure, so a reader recognises their own
 * export in the list before they choose it.
 *
 * This is NOT the rule. The rule is that anything unlisted is refused, which
 * needs no blocklist to stay ahead of next quarter's extra column; these are
 * examples of what a raw HRIS roster usually carries and what will happen to it.
 */
export const REFUSED_COLUMN_EXAMPLES = Object.freeze([
  "name", "first_name", "last_name", "email", "employee_id", "salary",
  "compensation", "manager", "location", "birth_date",
]);

/** Every reason a roster can be refused. Stable; a surface switches on these. */
export const ROSTER_REFUSAL = Object.freeze({
  UNREADABLE: "unreadable_file",
  EMPTY_FILE: "empty_file",
  NO_DATA_ROWS: "no_data_rows",
  UNLISTED_COLUMN: "unlisted_column",
  MISSING_COLUMN: "missing_required_column",
  DUPLICATE_COLUMN: "duplicate_column",
  MALFORMED_ROW: "malformed_row",
  UNPARSEABLE_PERIOD: "unparseable_period",
  BLANK_ROLE: "blank_role",
  NO_ROWS_FOR_PERIOD: "no_rows_for_period",
  NO_ENGINEERING_ROWS: "no_engineering_rows",
});

/** The two words this import can put on a figure, and the one it cannot. */
export const HEADCOUNT_SOURCE = Object.freeze({
  estimated: "estimated",
  supplied: "supplied",
});

/**
 * What a reader is told BEFORE they choose anything.
 *
 * Both halves are plain text in the region rather than a disclosure a reader has
 * to open: the expectation only helps if it is read before the file picker, and
 * a refusal a reader could have avoided is a refusal we caused.
 */
export const ROSTER_EXPECTATION = `Expected columns, exactly two: ${ROSTER_COLUMN.role}`
  + ` (the role or department bucket, counted when it reads "${ENGINEERING_CLASSIFICATION}")`
  + ` and ${ROSTER_COLUMN.period} (the month, as YYYY-MM). Column order does not matter.`;

export const ROSTER_REFUSAL_NOTICE = "Refused columns: every other column, including"
  + ` ${REFUSED_COLUMN_EXAMPLES.join(", ")}. An unlisted column is refused on sight, never`
  + " dropped, so re-export with those two columns only. The file is read in this tab —"
  + " nothing is uploaded, no account is needed, and no copy is kept.";

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const fold = (value) => String(value ?? "").trim().toLowerCase();

/**
 * A header name safe to print back at the reader.
 *
 * A refusal has to name the offending column or it is not actionable, and the
 * name comes out of an untrusted file — so it is collapsed to single spaces,
 * stripped of control characters, and capped. Surfaces render it through
 * textContent, so this is about keeping a message readable, not about markup.
 */
export function safeHeaderName(header) {
  const cleaned = String(header ?? "").replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ").trim();
  if (!cleaned) return "(an unnamed column)";
  return cleaned.length > 40 ? `${cleaned.slice(0, 40)}…` : cleaned;
}

const refuse = (code, message, detail = {}) =>
  Object.freeze({ ok: false, contractVersion: ROSTER_CONTRACT_VERSION, code, message, ...detail });

/** The header record, screened against the contract's two columns. */
function screenHeader(header) {
  const seen = new Map();
  for (const [at, raw] of header.entries()) {
    const name = fold(raw);
    if (name === "") {
      return refuse(ROSTER_REFUSAL.UNLISTED_COLUMN,
        "This roster has a column with no header name, so there is no way to tell what it"
        + " carries. A headcount export needs exactly two named columns."
        + ` ${ROSTER_EXPECTATION}`,
        { column: safeHeaderName(raw) });
    }
    if (name !== ROSTER_COLUMN.role && name !== ROSTER_COLUMN.period) {
      return refuse(ROSTER_REFUSAL.UNLISTED_COLUMN,
        `This roster carries a column this page will not read: "${safeHeaderName(raw)}".`
        + " Nothing in it was parsed — an unlisted column is refused rather than dropped,"
        + " because dropping it is what would let personal data through unnoticed."
        + ` ${ROSTER_EXPECTATION}`,
        { column: safeHeaderName(raw) });
    }
    if (seen.has(name)) {
      return refuse(ROSTER_REFUSAL.DUPLICATE_COLUMN,
        `This roster names the "${safeHeaderName(raw)}" column twice, so which one holds the`
        + " value is ambiguous. Re-export with one column of each.",
        { column: safeHeaderName(raw) });
    }
    seen.set(name, at);
  }
  for (const required of [ROSTER_COLUMN.role, ROSTER_COLUMN.period]) {
    if (!seen.has(required)) {
      return refuse(ROSTER_REFUSAL.MISSING_COLUMN,
        `This roster has no "${required}" column, so there is nothing to count.`
        + ` ${ROSTER_EXPECTATION}`,
        { column: required });
    }
  }
  return { ok: true, index: seen };
}

const readFailure = (problem) => {
  if (problem.code === DELIMITED_CODES.EMPTY_FILE) {
    return refuse(ROSTER_REFUSAL.EMPTY_FILE,
      "This file is empty, so nothing was read and no headcount was changed.");
  }
  return refuse(ROSTER_REFUSAL.UNREADABLE,
    "This file could not be read as a comma or tab separated roster in this browser, so"
    + ` nothing was parsed. ${ROSTER_EXPECTATION}`,
    { detail: problem.code });
};

/**
 * Count the engineers in a roster.
 *
 * @param {string} text the file's own text, from the local Blob text API.
 * @param {{period?: string}} [options] the period the brief is estimating. When
 *   absent, the LATEST period in the file is counted and named in the result —
 *   this module reads no clock, so it never infers "now" on its own.
 * @returns {{ok: true, headcount: number, period: string, countedRows: number,
 *   otherPeriodRows: number, duplicateRows: number, source: "supplied"}
 *   | {ok: false, code: string, message: string}}
 */
export function parseHeadcountRoster(text, { period = null } = {}) {
  const read = readDelimitedText(text);
  if (!read.ok) return readFailure(read.problem);

  const screened = screenHeader(read.header);
  if (!screened.ok) return screened;
  const roleAt = screened.index.get(ROSTER_COLUMN.role);
  const periodAt = screened.index.get(ROSTER_COLUMN.period);

  if (read.rows.length === 0) {
    return refuse(ROSTER_REFUSAL.NO_DATA_ROWS,
      "This roster has its header row and no people under it. Zero rows is an export that"
      + " did not include anybody, not a headcount of zero, so the declared headcount is"
      + " unchanged.");
  }

  // Every row is validated before anything is counted, so a refusal never lands
  // after a partial count has already been handed to a caller.
  const entries = [];
  for (const record of read.rows) {
    if (record.values.length !== read.header.length) {
      return refuse(ROSTER_REFUSAL.MALFORMED_ROW,
        `Row ${record.row} has ${record.values.length} of the ${read.header.length} expected`
        + " columns, so it cannot be counted and the whole file was left. A headcount short"
        + " by one row reads exactly like a correct one, which is why this stops rather than"
        + " counts what it can.",
        { row: record.row });
    }
    const rowPeriod = fold(record.values[periodAt]);
    if (!PERIOD_PATTERN.test(rowPeriod)) {
      return refuse(ROSTER_REFUSAL.UNPARSEABLE_PERIOD,
        `Row ${record.row} does not carry a month this page can read in its`
        + ` "${ROSTER_COLUMN.period}" column. The expected form is YYYY-MM, so July 2026 is`
        + " 2026-07.",
        { row: record.row });
    }
    const role = fold(record.values[roleAt]);
    if (role === "") {
      return refuse(ROSTER_REFUSAL.BLANK_ROLE,
        `Row ${record.row} has an empty "${ROSTER_COLUMN.role}" cell, so there is no way to`
        + " tell whether that person is an engineer. Filling it in or removing the row both"
        + " give an answer this page can stand behind.",
        { row: record.row });
    }
    entries.push({ role, period: rowPeriod });
  }

  // The period being counted. A caller that knows what the brief is estimating
  // names it; otherwise the newest month in the file is the one a reader means,
  // and the accepted sentence says which it was.
  const counted = period && PERIOD_PATTERN.test(fold(period))
    ? fold(period)
    : entries.map((entry) => entry.period).sort().at(-1);
  const inPeriod = entries.filter((entry) => entry.period === counted);
  if (inPeriod.length === 0) {
    return refuse(ROSTER_REFUSAL.NO_ROWS_FOR_PERIOD,
      `This roster has no rows for ${counted}, the period being counted. Every row is for`
      + " another month, so it was left out rather than counted as a headcount of zero.",
      { period: counted });
  }

  const engineers = inPeriod.filter((entry) => entry.role === ENGINEERING_CLASSIFICATION);
  if (engineers.length === 0) {
    return refuse(ROSTER_REFUSAL.NO_ENGINEERING_ROWS,
      `No row for ${counted} carries "${ENGINEERING_CLASSIFICATION}" in its`
      + ` "${ROSTER_COLUMN.role}" column, so this page has no headcount to take from it. That`
      + " is the one bucket it counts; a differently named one has to be mapped to it in the"
      + " export.",
      { period: counted });
  }

  // Identical rows are COUNTED. This contract carries no identifier, so nothing
  // here can tell a duplicated person from a second person with the same role in
  // the same month — collapsing them would invent a lower headcount than the
  // roster states. The count of repeats is reported so a reader can check it.
  const seen = new Set();
  let duplicateRows = 0;
  for (const entry of inPeriod) {
    const key = `${entry.role}\u0000${entry.period}`;
    if (seen.has(key)) duplicateRows += 1;
    else seen.add(key);
  }

  return Object.freeze({
    ok: true,
    contractVersion: ROSTER_CONTRACT_VERSION,
    headcount: engineers.length,
    period: counted,
    countedRows: inPeriod.length,
    otherPeriodRows: entries.length - inPeriod.length,
    duplicateRows,
    // Supplied, never verified: the reader handed us this file, and nothing here
    // authenticated it or checked it against the system that produced it.
    source: HEADCOUNT_SOURCE.supplied,
  });
}

/** The sentence an accepted roster puts beside the headcount field. */
export function rosterAcceptedSentence(result) {
  const stale = result.otherPeriodRows
    ? ` ${result.otherPeriodRows} row${result.otherPeriodRows === 1 ? " for another month was" : "s for other months were"}`
      + " set aside."
    : "";
  const repeats = result.duplicateRows
    ? ` ${result.duplicateRows} of the counted rows repeat an earlier row exactly and were`
      + " counted, not merged."
    : "";
  return `Supplied: ${result.headcount} engineers counted from ${result.countedRows} rows for`
    + `${" "}${result.period} in the roster you chose.${stale}${repeats} Supplied, not verified —`
    + " this page read the file, it did not check it against the system that produced it.";
}

/** The sentence a refusal puts there instead. The declared headcount is untouched. */
export const rosterRefusalSentence = (refusal) =>
  `${refusal.message} The declared headcount is unchanged.`;
