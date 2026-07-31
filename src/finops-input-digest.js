// What the headline number was computed FROM, in a form a reader can check.
//
// THE PROBLEM THIS SOLVES. A FinOps lead who imports their own export gets one
// recoverable-spend figure and is expected to forward it to a director. The page
// already says where that figure sits (`finops-stand.js`) and whether the
// RANKING behind it can be repeated (`ranking-reproducibility.js`). Neither says
// which rows of the reader's own file added up to the number, or how to tell
// that the file they are looking at now is the file the number came from. So the
// first question a director asks — "which departments is this, and is this still
// the same export?" — had no answer on the page.
//
// This module answers exactly that and nothing else:
//
//   * a DIGEST of the normalized input rows, so two runs over the same file are
//     comparable at a glance and a swapped file is visibly a different one,
//   * the ROW COUNT the digest covers,
//   * the NAMED CONTRIBUTIONS: which rows of the reader's file added how much to
//     the headline, and what each one's weight in it is.
//
// ---------------------------------------------------------------------------
// WHAT THIS MODULE MAY AND MAY NOT DO
// ---------------------------------------------------------------------------
//
// 1. IT RECOMPUTES NO FIGURE. Every dollar here is read off the analysis the
//    import pipeline already produced. The only arithmetic is division — a row's
//    modelled recoverable over the total — and it is division of numbers this
//    module did not produce. There is no second scoring path here.
//
// 2. THE DIGEST IS A PURE FUNCTION OF THE NORMALIZED ROWS. No clock, no
//    `Date.now()`, no random source, no locale-sensitive formatting, and no
//    dependence on the order keys were inserted into an object: the rows are
//    projected onto a fixed tuple, sorted by a code-unit comparison, and joined
//    with control separators. The same file imported twice in the same session
//    therefore produces a byte-identical string. That is the whole claim; it is
//    a check for CHANGE, not a security digest, and the copy says so.
//
// 3. EVERY LABEL IS UNTRUSTED. Department names arrive from the reader's own
//    file. Nothing here builds a node or a markup string — every value leaves as
//    plain text for `finops-stand-view.js`, which assigns it through
//    `textContent`. Display labels are truncated; the digest is computed over
//    the UNTRUNCATED normalized value, so two departments that differ only past
//    the truncation point still produce different digests.
//
// 4. MONEY IS COMPARED IN WHOLE CENTS. The rest of this codebase rounds published
//    figures with `Math.round(x * 100) / 100`, so hashing the float would make
//    the digest turn on a representation the reader never sees. It is hashed as
//    an integer number of cents for the same reason `ranking-reproducibility.js`
//    fingerprints spend in whole cents.

/**
 * The rules this disclosure applies, versioned on their own.
 *
 * Bump it DELIBERATELY, and only when a rule below changes what the numbers
 * mean: which rows are named, how a weight is defined, or what enters the
 * digest. It is never derived from a build, a clock, or a package version —
 * a version that moves on its own tells a reader nothing about whether the
 * scoring moved.
 */
export const INPUT_RUBRIC_VERSION = "finops-input-contribution/v1";

/** Named so a reader can say which digest they are comparing. */
export const INPUT_DIGEST_ALGORITHM = "FNV-1a, 64-bit";

/** How many characters of the digest are shown before the full value. */
export const DIGEST_PREFIX_LENGTH = 8;

/** Longer labels are cut FOR DISPLAY only. The digest sees the whole thing. */
export const DISPLAY_LABEL_LIMIT = 48;

/**
 * How many rows are named individually before the rest are summed into one
 * line. An import with four hundred departments would otherwise put four
 * hundred rows behind a disclosure, which is a wall, not evidence. The
 * remainder line states its own count and its own total, so nothing is dropped
 * silently.
 */
export const NAMED_CONTRIBUTION_LIMIT = 8;

/** The two sources, in the reader's words. Never "example"/"import" on screen. */
export const INPUT_SOURCE_LABEL = Object.freeze({
  import: "your imported file",
  example: "the built-in sample data — no file imported",
});

/**
 * The assumption behind each weight, stated where the weight is read.
 *
 * Both are the existing model's assumptions, written down rather than
 * introduced: the headline is a plain sum of the per-department modelled
 * recoverable (`local-finops.js`), and the modelled recoverable is premium-tier
 * token spend repriced at the standard-tier reference rate
 * (`down-routing-candidates.js`). Neither is restated as a rule here; they are
 * quoted so that no number in this disclosure reaches a director unexplained.
 */
export const WEIGHT_ASSUMPTION = Object.freeze({
  share: "Weights are dollars, not headcount. A row's weight is its own modelled recoverable "
    + "divided by the headline total, so 0.64 means that row is 64% of the number. Seat count, "
    + "request count and department size do not enter it: a large department on cheap models "
    + "weighs less than a small one on premium-tier models.",
  model: "Recoverable is modelled, not measured. Token-billed text-generation spend priced at or "
    + "above the premium-tier floor is repriced at the standard-tier reference rate, and the "
    + "difference is what these rows count. It assumes the same work runs acceptably on the "
    + "cheaper tier; nothing here is money already saved.",
});

// ---------------------------------------------------------------------------
// Normalization. Everything the digest depends on happens here.
// ---------------------------------------------------------------------------

const SEPARATOR = Object.freeze({ field: "\u001f", row: "\u001e" });

/**
 * One label, reduced to what two runs must agree on.
 *
 * NFC first, because the same department name typed with a combining accent and
 * with a precomposed one is the same department to a reader. Control characters
 * become spaces — that also keeps the field separators below out of the payload,
 * so a label can never forge a row boundary. Whitespace collapses last.
 */
export function normalizeLabel(value) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whole cents, or null. Never a float in the digest payload. */
const cents = (value) => (Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) : null);

/** Cut for reading, never for hashing. The ellipsis is part of the display value. */
export function truncateLabel(label, limit = DISPLAY_LABEL_LIMIT) {
  const text = String(label ?? "");
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

/**
 * The analysis's ranked departments, projected onto the tuple the digest is
 * computed over and sorted by a code-unit comparison.
 *
 * The sort is over the WHOLE tuple, not the key alone, so two rows that share a
 * key still land in one fixed order rather than in whatever order the ranking
 * happened to produce. `localeCompare` is deliberately not used: it depends on
 * an ICU collation that differs between browsers and would make the digest a
 * property of the reader's machine.
 */
export function normalizeInputRows(analysis) {
  const ranked = Array.isArray(analysis?.rankedDepartments) ? analysis.rankedDepartments : [];
  const rows = ranked.map((department) => {
    const label = normalizeLabel(department?.name ?? department?.unit?.label ?? "");
    return Object.freeze({
      // The id is the attribution key the ranking itself joins on; the label is
      // the fallback for a projection that carries no id. Departments are
      // compared by id wherever there is one, exactly as the ranking does.
      key: normalizeLabel(department?.id ?? "") || label,
      label,
      displayLabel: truncateLabel(label),
      spendCents: cents(department?.spendUsd),
      recoverableCents: cents(department?.recoverableUsd),
      records: Number.isInteger(department?.records) ? department.records : null,
    });
  });
  rows.sort((left, right) => {
    if (left.key !== right.key) return left.key < right.key ? -1 : 1;
    if (left.spendCents !== right.spendCents) return (left.spendCents ?? -1) - (right.spendCents ?? -1);
    return (left.recoverableCents ?? -1) - (right.recoverableCents ?? -1);
  });
  return Object.freeze(rows);
}

/** The exact bytes hashed, exposed so a disagreement can be diffed rather than argued. */
export function canonicalInput(rows) {
  return [`${INPUT_RUBRIC_VERSION}${SEPARATOR.field}${rows.length}`]
    .concat(rows.map((row) => [row.key, row.spendCents, row.recoverableCents]
      .join(SEPARATOR.field)))
    .join(SEPARATOR.row);
}

const FNV_OFFSET_BASIS = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const SIXTY_FOUR_BITS = 0xffffffffffffffffn;

/**
 * FNV-1a over UTF-16 code units, 64 bits, as sixteen lowercase hex characters.
 *
 * BigInt rather than two 32-bit lanes so the algorithm is the published one
 * rather than a construction of ours, and so the arithmetic is exact on every
 * engine. It is a change-detection code: it says two inputs differ, and it is
 * not a claim that a third party could not construct a collision.
 */
export function digestOf(text) {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * FNV_PRIME) & SIXTY_FOUR_BITS;
  }
  return hash.toString(16).padStart(16, "0");
}

// ---------------------------------------------------------------------------
// The disclosure's own record.
// ---------------------------------------------------------------------------

/**
 * Which rows contributed how much, and what each one's weight is.
 *
 * The total divided by is the HEADLINE's own total, not a sum taken here, so a
 * weight column that does not add to 1.00 is a true statement about the analysis
 * rather than a rounding artefact of this module. `remainder` carries whatever
 * the named rows do not cover — the rows past the display limit plus any part of
 * the headline that no ranked row accounts for — and is null when there is none.
 */
function contributionsFrom(rows, totalRecoverableCents) {
  const ranked = [...rows]
    .filter((row) => Number.isInteger(row.recoverableCents) && row.recoverableCents > 0)
    .sort((left, right) => right.recoverableCents - left.recoverableCents
      || (left.key < right.key ? -1 : 1));
  const share = (amount) => (totalRecoverableCents > 0 ? amount / totalRecoverableCents : null);
  const named = ranked.slice(0, NAMED_CONTRIBUTION_LIMIT).map((row) => Object.freeze({
    key: row.key,
    label: row.label,
    displayLabel: row.displayLabel,
    recoverableUsd: row.recoverableCents / 100,
    spendUsd: Number.isInteger(row.spendCents) ? row.spendCents / 100 : null,
    weight: share(row.recoverableCents),
  }));
  const namedCents = named.reduce((total, row) => total + Math.round(row.recoverableUsd * 100), 0);
  const restCents = Math.max(0, totalRecoverableCents - namedCents);
  const restRows = Math.max(0, rows.length - named.length);
  return Object.freeze({
    named: Object.freeze(named),
    remainder: restCents > 0 || restRows > 0
      ? Object.freeze({
        rows: restRows, recoverableUsd: restCents / 100, weight: share(restCents),
      })
      : null,
  });
}

/**
 * Everything the reproducibility disclosure needs, from one analysis.
 *
 * @param analysis the projection the import pipeline produced, or the bundled
 *   example's — the same shape either way.
 * @param source `"import"` or `"example"`, the composer's own word. It is
 *   turned into a reader's sentence here and nowhere else.
 */
export function buildInputProvenance({ analysis = null, source = "example" } = {}) {
  const rows = normalizeInputRows(analysis);
  const canonical = canonicalInput(rows);
  const digest = digestOf(canonical);
  const totalRecoverableCents = cents(analysis?.recoverableUsd) ?? 0;
  const records = rows.every((row) => row.records !== null)
    ? rows.reduce((total, row) => total + row.records, 0)
    : null;
  return Object.freeze({
    version: INPUT_RUBRIC_VERSION,
    algorithm: INPUT_DIGEST_ALGORITHM,
    imported: source === "import",
    sourceLabel: source === "import" ? INPUT_SOURCE_LABEL.import : INPUT_SOURCE_LABEL.example,
    rows,
    rowCount: rows.length,
    /** Underlying usage records, when every row published its own count. */
    recordCount: records,
    canonical,
    digest,
    digestPrefix: digest.slice(0, DIGEST_PREFIX_LENGTH),
    totalRecoverableUsd: totalRecoverableCents / 100,
    analyzedSpendUsd: (cents(analysis?.spendUsd) ?? 0) / 100,
    ...contributionsFrom(rows, totalRecoverableCents),
  });
}
