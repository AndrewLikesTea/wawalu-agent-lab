// Why the headline number is that number, in terms a director can check.
//
// THE PROBLEM THIS SOLVES. `answer-state.js` made the reader's own export drive
// the headline. What it did not do is let anyone PROVE it did. A FinOps lead who
// repeats "$51,254 recoverable" in a review is asked three questions in order —
// which file was this, how many rows was it, and which teams add up to it — and
// before this module the page could answer none of them. The departments
// disclosure listed every team's figure, but nothing said those figures sum to
// the headline, nothing named the rules version they were scored under, and
// nothing distinguished a number read out of the reader's file from the same
// number read out of the bundled sample.
//
// So this module publishes four things, and only these four:
//
//   1. WHICH INPUT. Stated in words, differently for the two sources. The
//      imported case and the fallback case never read alike.
//   2. HOW MANY ROWS. The sum of the per-department record counts listed below
//      it, so the total is checkable against the lines it came from.
//   3. A FINGERPRINT of the normalized input, so a second import of the same
//      file is comparable with this one at a glance.
//   4. THE NAMED CONTRIBUTIONS — which department contributed how much, by
//      name, adding up to the headline figure exactly.
//
// ---------------------------------------------------------------------------
// WHAT THIS MODULE MAY AND MAY NOT DO
// ---------------------------------------------------------------------------
//
// 1. IT SCORES NOTHING. There is no rubric here. Every figure is read off the
//    analysis the import pipeline already published; the only arithmetic is a
//    sum, a subtraction for the unattributed remainder, and a percentage. If
//    this module and the headline ever disagree, this module is wrong.
//
// 2. NO UNEXPLAINED COEFFICIENT REACHES THIS VIEW. There is exactly one weight
//    (`CONTRIBUTION_WEIGHT`), it is 1, and the assumption behind it is stated
//    both beside the constant and in the rendered disclosure.
//
// 3. THE FINGERPRINT IS NOT A SECURITY DIGEST AND NEVER SAYS IT IS. It is a
//    64-bit FNV-1a over a canonical string — enough to notice that the input
//    changed, and nothing more. The visible copy says exactly that.
//
// 4. EVERY READER-DERIVED STRING IS BOUNDED BEFORE IT LEAVES HERE. Department
//    names come out of an untrusted export. `finops-stand-view.js` inserts them
//    as text nodes, so markup cannot execute; truncation is this module's job,
//    so a 4,000-character department name cannot break the layout either.
//
// 5. NOTHING BELOW BUILDS A NODE, reads storage, or opens a request.

import { RUBRIC_VERSION } from "./ranking-reproducibility.js";

/**
 * Bump when an entry of this disclosure changes meaning.
 *
 * Named once, here. Call sites import it; no literal version string is typed
 * into a template anywhere else, which is the whole point of it being a
 * constant — a reader quoting a version can be told where it came from.
 */
export const REPRODUCTION_VERSION = "finops-answer-reproduction/1.0.0";

/** The two inputs this disclosure can be describing. Never rendered raw. */
export const REPRODUCTION_SOURCE = Object.freeze({
  imported: "imported",
  synthetic: "synthetic",
});

/**
 * The one sentence that says which input the figures below came from.
 *
 * These two must never be paraphrases of each other. A reader who opens this
 * disclosure and skims one line has to come away knowing whether they are
 * looking at their own file or at the sample, so the two say different things in
 * different words rather than the same sentence with one noun swapped.
 */
export const REPRODUCTION_SOURCE_STATEMENT = Object.freeze({
  [REPRODUCTION_SOURCE.imported]:
    "Your own imported export. Every figure below was read out of the file you chose, in this "
    + "browser. No bundled sample contributed to any of them.",
  [REPRODUCTION_SOURCE.synthetic]:
    "The built-in sample — invented data, not yours. Nothing has been imported in this browser, "
    + "so the figures below describe the bundled synthetic example and must not be quoted as this "
    + "organization's spend.",
});

/**
 * THE ONE WEIGHT, AND THE ASSUMPTION BEHIND IT.
 *
 * Every department's modelled recoverable enters the headline at full weight.
 * The assumption is that the analysis has already applied whatever discount a
 * department's evidence deserves — the down-routing rules lower a candidate's
 * confidence tier and shrink its routable spend upstream of here — so applying a
 * second coefficient at disclosure time would double-count a judgement already
 * made, and would make the named contributions stop adding up to the figure on
 * screen. No department is boosted, discounted, capped, or dropped by this
 * module. If that assumption ever stops holding, this constant is where the
 * change goes, and it is one number rather than a coefficient per call site.
 */
export const CONTRIBUTION_WEIGHT = 1;

/** How the weight is explained to a reader, in the disclosure itself. */
export const CONTRIBUTION_WEIGHT_STATEMENT =
  `Each department enters at weight ${CONTRIBUTION_WEIGHT.toFixed(2)} — its own modelled `
  + "recoverable, undiscounted. Nothing here re-weights, caps, or drops a department: the "
  + "analysis already lowered what it could not verify, so a second coefficient at this stage "
  + "would discount the same evidence twice and the named lines would stop adding up.";

/** Longest department name rendered. Past this it is cut and marked as cut. */
export const NAME_LIMIT = 48;

/** What an unnamed department is called, so a blank never renders as a blank. */
export const UNNAMED_DEPARTMENT = "Unnamed department";

/** The line that carries whatever the named departments do not account for. */
export const REMAINDER_LABEL = "Not attributed to any department";

const USD_CENTS = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const COUNT = new Intl.NumberFormat("en-US");

/**
 * Money as whole cents, as an integer.
 *
 * Cents rather than dollars because the named contributions must add up to the
 * headline EXACTLY, and whole-dollar rounding of five departments does not: the
 * bundled example's five lines round to a dollar more than their own total. A
 * sum that is visibly off by a dollar is the one thing this disclosure cannot
 * afford, so it is stated to the cent and the headline card keeps its rounding.
 */
const cents = (value) => {
  // `Number(null)` is 0, which would publish a $0.00 total for an analysis that
  // published none at all — a figure this module would then invite a director to
  // check. An absent value is absent, and says so.
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) : null;
};

const money = (inCents) => USD_CENTS.format(inCents / 100);

/** A count that is a count, or zero. Never NaN, never a guess. */
const whole = (value) => (Number.isInteger(Number(value)) && Number(value) >= 0
  ? Number(value) : 0);

/**
 * A reader-supplied name, made safe to put on a line of prose.
 *
 * Three things, in order: control characters and newlines out (a name carrying
 * a newline would break the definition list into what looks like two entries),
 * runs of whitespace collapsed, and a hard length cap with the cut declared
 * rather than hidden behind a bare ellipsis. Escaping is NOT done here and must
 * not be: the view inserts every string as a text node, and pre-escaping would
 * paint literal `&amp;` at a reader who typed an ampersand.
 */
export function displayName(value) {
  const flat = String(value ?? "").replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ").trim();
  if (flat === "") return UNNAMED_DEPARTMENT;
  return flat.length <= NAME_LIMIT ? flat : `${flat.slice(0, NAME_LIMIT)}… (name shortened)`;
}

/** The same name reduced to an identity: case and spacing are not data. */
const nameKey = (value) => String(value ?? "").replace(/\s+/gu, " ").trim().toLowerCase();

/**
 * The parsed input, normalized to exactly what the headline depends on.
 *
 * THE NORMALIZATION POLICY, stated once and tested:
 *
 *   * This runs over the PARSED analysis, never over file bytes. Two exports of
 *     the same period that differ in quoting, line endings, column order, or
 *     trailing whitespace parse to the same rows and must fingerprint the same.
 *   * Row order is NOT part of the identity. Rows are sorted by normalized
 *     department name, so an export re-sorted in a spreadsheet is the same
 *     input. Rank is not lost by this — it is a property of the figures, which
 *     are in the row.
 *   * Department names are compared case-insensitively with whitespace runs
 *     collapsed. "Atlas  Platform" and "atlas platform" are one department.
 *   * Money is carried as whole cents, as integers. No float ever reaches the
 *     canonical string, so a value that prints differently on two platforms
 *     cannot fingerprint differently.
 *   * The period, the analysis schema version, and the scoring-rules version
 *     are part of the identity: the same rows scored under different rules are
 *     not the same input, and saying so is the point of the fingerprint.
 */
export function normalizeAnswerInput(analysis) {
  const source = Array.isArray(analysis?.rankedDepartments) ? analysis.rankedDepartments : [];
  const rows = source.map((department) => Object.freeze({
    name: displayName(department?.name),
    key: nameKey(department?.name),
    records: whole(department?.records),
    spendCents: cents(department?.spendUsd) ?? 0,
    recoverableCents: cents(department?.recoverableUsd) ?? 0,
  })).sort((left, right) => (left.key < right.key ? -1 : Number(left.key > right.key)));
  return Object.freeze({
    version: REPRODUCTION_VERSION,
    rubricVersion: RUBRIC_VERSION,
    schemaVersion: String(analysis?.schemaVersion ?? "no analysis schema"),
    period: String(analysis?.period ?? "no period"),
    spendCents: cents(analysis?.spendUsd),
    recoverableCents: cents(analysis?.recoverableUsd),
    rows: Object.freeze(rows),
    /** Input rows, as the sum of the per-department counts rendered below. */
    rowCount: rows.reduce((total, row) => total + row.records, 0),
    departmentCount: rows.length,
  });
}

/** The exact string the fingerprint is taken over. Exported so a test can pin it. */
export function canonicalInput(normalized) {
  return [
    normalized.version, normalized.rubricVersion, normalized.schemaVersion, normalized.period,
    String(normalized.spendCents ?? "none"), String(normalized.recoverableCents ?? "none"),
    ...normalized.rows.map((row) =>
      `${row.key}|${row.records}|${row.spendCents}|${row.recoverableCents}`),
  ].join("\n");
}

/**
 * A 64-bit FNV-1a over the canonical string, as sixteen hex digits.
 *
 * Dependency-free and byte-for-byte reproducible: the same normalized input
 * gives the same sixteen characters in every browser, on every run, with no
 * clock and no random seed anywhere in it. It is a CHANGE DETECTOR. It is not a
 * cryptographic digest, nothing here claims collision resistance, and no
 * user-visible string in this module calls it a hash.
 */
export function fingerprint(normalized) {
  const PRIME = 0x100000001b3n;
  const MASK = 0xffffffffffffffffn;
  let value = 0xcbf29ce484222325n;
  const bytes = new TextEncoder().encode(canonicalInput(normalized));
  for (const byte of bytes) {
    value = ((value ^ BigInt(byte)) * PRIME) & MASK;
  }
  return value.toString(16).padStart(16, "0");
}

/**
 * Who contributed how much to the headline recoverable figure.
 *
 * Ordered by contribution, largest first, ties broken by name so the order is
 * total. Every line carries the weight it entered at, and a remainder line is
 * appended whenever the named departments do not account for the whole figure —
 * because a list that silently stops short of the headline is worse than no
 * list, and this is exactly the gap a director would find.
 */
export function answerContributions(normalized) {
  const total = normalized.recoverableCents;
  if (total === null) return Object.freeze([]);
  const named = normalized.rows
    .filter((row) => row.recoverableCents !== 0)
    .map((row) => Object.freeze({
      name: row.name,
      cents: row.recoverableCents,
      records: row.records,
      weight: CONTRIBUTION_WEIGHT,
      remainder: false,
    }))
    .sort((left, right) => (right.cents - left.cents)
      || (left.name < right.name ? -1 : Number(left.name > right.name)));
  const attributed = named.reduce((sum, row) => sum + row.cents, 0);
  if (attributed === total) return Object.freeze(named);
  return Object.freeze([...named, Object.freeze({
    name: REMAINDER_LABEL,
    cents: total - attributed,
    records: 0,
    weight: CONTRIBUTION_WEIGHT,
    remainder: true,
  })]);
}

const entry = (term, detail) => Object.freeze({ term, detail: String(detail) });

const share = (part, total) => (total === 0 ? "—"
  : `${((part / total) * 100).toFixed(1)}% of the headline figure`);

/**
 * The disclosure entries, in the order a reader checks them.
 *
 * @param source one of `REPRODUCTION_SOURCE`. Anything else is treated as the
 *   synthetic sample, because claiming a figure is the reader's own on an
 *   unrecognized input is the one error here with a cost.
 */
export function reproductionEntries({ analysis = null, source = REPRODUCTION_SOURCE.synthetic }
= {}) {
  const which = source === REPRODUCTION_SOURCE.imported
    ? REPRODUCTION_SOURCE.imported : REPRODUCTION_SOURCE.synthetic;
  const normalized = normalizeAnswerInput(analysis);
  const rows = [
    entry("What this describes", REPRODUCTION_SOURCE_STATEMENT[which]),
    entry("Scoring rules", `${normalized.rubricVersion} · analysis schema `
      + `${normalized.schemaVersion} · this disclosure ${REPRODUCTION_VERSION}. Named once in the `
      + "source and read from there, so a version quoted here is the version that ran."),
    entry("Period analyzed", normalized.period),
    // The row total is the sum of counts the input published. An analysis that
    // published none of them gets that stated rather than "0 rows", which would
    // be a false claim about the reader's file in the one entry whose whole
    // purpose is being checkable.
    entry("Rows read", normalized.rowCount === 0 && normalized.departmentCount > 0
      ? `Not published by this input · ${COUNT.format(normalized.departmentCount)} department`
        + `${normalized.departmentCount === 1 ? "" : "s"} were analyzed, but none of them carries `
        + "a row count, so no row total is claimed here."
      : `${COUNT.format(normalized.rowCount)} row`
        + `${normalized.rowCount === 1 ? "" : "s"} across `
        + `${COUNT.format(normalized.departmentCount)} department`
        + `${normalized.departmentCount === 1 ? "" : "s"} — the sum of the per-department counts `
        + "listed below, so the total can be checked against the lines it came from."),
  ];
  rows.push(entry("Input fingerprint", `${fingerprint(normalized)} · import the same file again `
    + "and you get these same sixteen characters; change one figure, one department name, or the "
    + "period and they change. Taken over the parsed rows rather than the file's bytes, so "
    + "re-quoting, re-ordering, or re-spacing the same export does not change it. It is a digest "
    + "for detecting a changed input, not a security digest, and it makes no claim beyond that."));
  if (normalized.recoverableCents === null) {
    rows.push(entry("Named contributions", "This input published no recoverable total, so there "
      + "is no headline figure to break down and none is claimed."));
    return Object.freeze(rows);
  }
  const contributions = answerContributions(normalized);
  rows.push(entry("Headline figure", `${money(normalized.recoverableCents)} modelled recoverable `
    + `· the sum of the ${COUNT.format(contributions.length)} line`
    + `${contributions.length === 1 ? "" : "s"} below, to the cent. The headline card rounds this `
    + "to whole dollars; the lines are stated in cents so they add up exactly rather than "
    + "approximately."));
  rows.push(entry("How each line is weighted", CONTRIBUTION_WEIGHT_STATEMENT));
  contributions.forEach((row, index) => {
    rows.push(entry(`${index + 1}. ${row.name}`,
      `${money(row.cents)} · ${share(row.cents, normalized.recoverableCents)} · weight `
      + `${row.weight.toFixed(2)}`
      + (row.remainder
        ? " · the part of the headline figure no named department accounts for. It is shown "
          + "rather than dropped so the lines above cannot look complete when they are not."
        : (row.records === 0
          ? " · read from this department's own rows; the input published no count of them."
          : ` · read from this department's own ${COUNT.format(row.records)} row`
            + `${row.records === 1 ? "" : "s"} in the input.`))));
  });
  return Object.freeze(rows);
}
