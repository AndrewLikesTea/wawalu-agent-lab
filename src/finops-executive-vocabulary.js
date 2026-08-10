// ---------------------------------------------------------------------------
// THE WORDS THE FIRST SCREEN SAYS OUT LOUD (#1554)
//
// The first screen of /evolution.html answers one executive question: what is
// the recoverable figure priced from, and how sure are we? It was answering it
// in the vocabulary of the repository that computes it — a contract version, a
// fixture path, the words "declared" and "derived" used as terms of art — so a
// CTO who has never opened this repository could read the sentence and still
// not be able to repeat it in a meeting.
//
// NOTHING IS DELETED, IT IS DEMOTED. Every identifier the sentence used to
// print is still on the page and still walkable: the version, the pinned
// evidence file and the operand assumptions are stated in the "How we know
// this" disclosure the same region already carries, and the attested values
// still travel on the slot's own data attributes for the drift check. A
// skeptic can still get from the sentence to the fixture and the clause. What
// changed is which of the two a reader meets first.
//
// THIS MODULE IS INERT ON PURPOSE. It imports nothing. It holds no mutable
// state, opens no request, reads no storage, no cookie and no clock, draws no
// random value, and performs no I/O of any kind. Every export is either a
// frozen table of authored English or a pure function of the string it is
// handed. It is on the canonical decision path only because the sentence that
// path publishes is composed from it, and it is reviewed onto that path's
// allow-list in tests/finops-decision-regression.test.js on exactly those
// grounds — the gate exists to catch a data provider or a network client
// arriving on the static path, and a string table is neither.
// ---------------------------------------------------------------------------

/**
 * Every internal identifier the FinOps answer surfaces print today, mapped to
 * the phrase a reader gets instead.
 *
 * The key set is not invented: each key is a value that /evolution.html's
 * attestation region or its data attributes actually emit — the attestation
 * contract version, the fixture the four dimensions are pinned in, the two
 * operand origins, the basis word, and the confidence bands
 * `finops-answer-contract.js` grades to.
 *
 * The confidence phrases are written as full clauses because a band word on
 * its own ("medium") tells a leader nothing about what they may do with the
 * figure, which is the only reason the band is on the first screen at all.
 */
export const READER_PHRASING = Object.freeze({
  // The attestation contract itself. Keyed without the version suffix so a
  // bump of `finops-recoverable-attestation/1.0.0` still resolves; the exact
  // string as printed is keyed too, so a reader grepping the served bytes for
  // what they saw lands here.
  "finops-recoverable-attestation": "the check this page publishes on its own figure",
  "finops-recoverable-attestation/1.0.0": "the check this page publishes on its own figure",

  // Where the four dimensions and their assumptions are pinned value-for-value.
  "tests/fixtures/finops-consolidated-answer-attestation.json": "the pinned evidence file",

  // The two operand origins. "Declared" and "derived" are precise and are kept
  // as the field values; they are terms of art, so they are not what a reader
  // is shown.
  declared: "stated by the export itself",
  derived: "worked out on this page",

  // The basis of record.
  monthly: "the most recent complete month",

  // The confidence bands, as what a leader may do with the figure.
  high: "High confidence — steady enough to commit against",
  medium: "Medium confidence — enough to plan against, not yet enough to bill against",
  low: "Low confidence — a direction to check, not a number to commit against",
  "not graded": "Ungraded confidence — this export published no confidence signal",
  "not stated": "not stated",
});

/**
 * The reader-facing phrase for an internal identifier, or `null`.
 *
 * A trailing `/N.N.N` is stripped before the second lookup so that bumping a
 * contract version does not silently drop the sentence back to the identifier.
 * Pure: no state, no fallback that reaches anywhere.
 */
export function readerPhraseFor(identifier) {
  if (typeof identifier !== "string") return null;
  const key = identifier.trim();
  if (!key) return null;
  return READER_PHRASING[key]
    ?? READER_PHRASING[key.replace(/\/\d+\.\d+\.\d+$/, "")]
    ?? null;
}

/**
 * THE SHAPES THAT MAY NOT APPEAR IN VISIBLE COPY.
 *
 * Each entry is a machine-checkable matcher plus the one thing it forbids, so
 * two engineers reading this list implement the same check. The rule these
 * encode is not "no jargon" — it is that a token whose meaning is only
 * recoverable by opening this repository does not belong in a sentence written
 * for someone who never will. All of them remain legal, and required, inside
 * the audit disclosure and in the data attributes the drift check reads.
 */
export const FORBIDDEN_TOKEN_SHAPES = Object.freeze([
  Object.freeze({
    id: "fixture-path",
    // Any path into the test fixture tree, e.g. tests/fixtures/whatever.json.
    forbids: "a path into the test fixture tree",
    pattern: /tests\/fixtures\/[\w.-]+/,
  }),
  Object.freeze({
    id: "repository-path",
    // A repository-relative path into any top-level directory of this repo.
    forbids: "a repository-relative source path",
    pattern: /\b(?:src|tests|scripts|config|contracts|docs|design-system|functions|migrations|personas|runner|scenarios)\/[\w.-]+/,
  }),
  Object.freeze({
    id: "file-extension",
    // A bare file extension in prose. "the pinned evidence file" is fine;
    // naming the file by its extension is not.
    forbids: "a bare file extension in prose",
    pattern: /\.(?:json|js|mjs|cjs|ts|md|html|css|ya?ml|csv|txt)\b/i,
  }),
  Object.freeze({
    id: "version-string",
    // A rubric or contract version of the form name/N.N.N.
    forbids: "a rubric or contract version string",
    pattern: /[a-z][\w-]*\/\d+\.\d+\.\d+/i,
  }),
  Object.freeze({
    id: "contract-id",
    // A kebab-case internal identifier of three or more segments — the shape
    // every contract id, module name and slot id in this codebase takes
    // (finops-recoverable-attestation, finops-answer-contract). Two segments
    // are left alone: "committed-use" and "list-price" are English.
    forbids: "a kebab-case contract, module or slot identifier",
    pattern: /\b[a-z][a-z0-9]*(?:-[a-z0-9]+){2,}\b/,
  }),
  Object.freeze({
    id: "clause-id",
    // A snake_case clause code, the shape the priority clauses use
    // (unchecked_basis, ready_to_commit). No English word carries an
    // underscore, so this shape is unambiguous.
    forbids: "a snake_case clause identifier",
    pattern: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/,
  }),
]);

/**
 * Every forbidden shape a piece of visible copy trips, with what it matched.
 *
 * @param copy the rendered text of a region, exactly as a reader sees it.
 * @returns `[{ id, forbids, match }]` — empty when the copy is reader-facing.
 */
export function forbiddenTokensIn(copy) {
  if (typeof copy !== "string" || !copy) return [];
  const found = [];
  for (const shape of FORBIDDEN_TOKEN_SHAPES) {
    const match = shape.pattern.exec(copy);
    if (match) found.push(Object.freeze({ id: shape.id, forbids: shape.forbids, match: match[0] }));
  }
  return found;
}

/** True when the copy carries none of the forbidden shapes. */
export const isReaderFacing = (copy) => forbiddenTokensIn(copy).length === 0;
