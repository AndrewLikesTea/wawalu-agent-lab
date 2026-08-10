/**
 * The reader's vocabulary for the FinOps first screen (#1554).
 *
 * THE DEFECT THIS CLOSES. The attestation under the recoverable figure told a
 * CTO that the number was "Attested finops-recoverable-attestation/1.0.0" and
 * that every operand's assumption was in a repository path ending .json. Both
 * statements are true and neither is readable: a leader deciding whether to act
 * on the figure cannot tell, from a contract id and a file name, what the money
 * was priced from or how sure anyone is about it. The identifiers were doing a
 * skeptic's job in the answer's own sentence.
 *
 * SO THIS IS A DEMOTION, NOT A DELETION. Each identifier keeps exactly one home
 * on the page — the "How we know this" disclosure the region already ships —
 * and this module owns the words that stand in its place above the fold. The
 * mapping is the contract between the two: a phrase here, an identifier there,
 * and a test that fails if the first screen prints either the identifier or
 * nothing at all.
 *
 * IT IS DATA AND PURE FUNCTIONS. No DOM, no import of the contract modules it
 * describes (they import it), so the vocabulary can be read, reviewed and
 * tested without a page. Callers get phrases and a matcher; nobody outside this
 * file loops over a regular expression, because a stateful global one used
 * twice is a matcher that skips its second caller's first token.
 */

/** Strip the trailing `/1.0.0` from a versioned contract id, if it carries one. */
const unversioned = (identifier) => String(identifier).replace(/\/\d+\.\d+\.\d+$/, "");

/**
 * Every internal identifier the FinOps surfaces print, and the words a leader
 * would use for it out loud. `demotedTo` names the disclosure that still states
 * the identifier verbatim, so the mapping records where a skeptic is sent.
 */
export const EXECUTIVE_VOCABULARY = Object.freeze([
  Object.freeze({
    identifier: "tests/fixtures/finops-consolidated-answer-attestation.json",
    kind: "evidence",
    phrase: "the bundled sample of invented invoices, pinned input by input with the"
      + " assumption behind each",
    demotedTo: "finops-recoverable-how-we-know",
  }),
  Object.freeze({
    identifier: "finops-recoverable-attestation/1.0.0",
    kind: "assurance",
    phrase: "re-checked against the published recoverability rule on every load",
    demotedTo: "finops-recoverable-how-we-know",
  }),
  Object.freeze({
    identifier: "finops-recoverable-attestation",
    kind: "contract",
    phrase: "the standing check that this figure still matches the rule that produced it",
    demotedTo: "finops-recoverable-how-we-know",
  }),
  Object.freeze({
    identifier: "literacy-mix/1.0.0",
    kind: "rubric",
    phrase: "scored against our published prompt-quality rubric",
    demotedTo: "finops-first-run-how-we-know",
  }),
]);

const BY_IDENTIFIER = new Map(EXECUTIVE_VOCABULARY.map((entry) => [entry.identifier, entry]));
// Only the VERSIONED entries index by contract root. A vocabulary can carry
// both `name/1.0.0` and the bare `name` with different phrases — the version is
// what a page prints beside a grade, the bare id is what a contract is called —
// and the root index exists for one job: a bumped version must resolve to the
// phrase written for the versioned string, not to the other entry.
const BY_CONTRACT = new Map(EXECUTIVE_VOCABULARY
  .filter((entry) => entry.identifier !== unversioned(entry.identifier))
  .map((entry) => [unversioned(entry.identifier), entry]));

/**
 * The entry for an identifier, matching the exact string first and the same
 * contract at another version second — a version bump must not silently drop a
 * sentence back to printing the raw id.
 *
 * @returns the frozen entry, or null when nothing in the vocabulary covers it.
 */
export function vocabularyEntry(identifier) {
  return BY_IDENTIFIER.get(identifier) ?? BY_CONTRACT.get(unversioned(identifier)) ?? null;
}

/**
 * The reader-facing phrase for an identifier.
 *
 * It THROWS on an unknown identifier rather than falling back to the raw
 * string: a silent fallback is how the file name gets back onto the first
 * screen, and the whole point of this module is that it cannot.
 */
export function readerPhrase(identifier) {
  const entry = vocabularyEntry(identifier);
  if (!entry) {
    throw new Error(`no reader-facing phrase for "${identifier}"; add one to `
      + "src/finops-executive-vocabulary.js rather than printing the identifier");
  }
  return entry.phrase;
}

/**
 * The token shapes that must never reach visible copy, each with the reason a
 * reader is owed. The patterns themselves stay private; `findForbiddenTokens`
 * is the only thing that runs them.
 */
const SHAPES = Object.freeze([
  Object.freeze({
    kind: "fixture-path",
    why: "a test fixture is where a claim is pinned, not what it is priced from",
    pattern: /tests\/fixtures\/[\w./-]+/g,
  }),
  Object.freeze({
    kind: "repository-path",
    why: "a path tells a reader where the code lives, not what the number means",
    pattern: /\b(?:src|tests|scripts|config|dist|functions|migrations|design-system)\/[\w./-]+/g,
  }),
  Object.freeze({
    kind: "file-name",
    why: "a bare file extension is an artifact name standing in for evidence",
    pattern: /\b[\w-]+\.(?:json|jsonl|js|mjs|css|html|md|csv)\b/g,
  }),
  Object.freeze({
    kind: "contract-version",
    why: "a name/1.0.0 string states which code ran, not how sure anyone is",
    pattern: /\b[a-z][\w-]*(?:\/[\w-]+)*\/\d+\.\d+\.\d+\b/g,
  }),
  Object.freeze({
    kind: "contract-id",
    why: "a contract id is an internal name for a claim the sentence should make",
    pattern: /\b(?:finops|evolution|literacy|shiplog)(?:-[a-z0-9]+){2,}\b/g,
  }),
  Object.freeze({
    kind: "clause-id",
    why: "a clause identifier names a paragraph; the reader wants what it is about",
    pattern: /\bclause\s+[\w.§-]+|\b[\w-]+-clause\b/gi,
  }),
]);

/** The shapes, described, for a caller that wants to state what it forbids. */
export const FORBIDDEN_TOKEN_KINDS = Object.freeze(
  SHAPES.map(({ kind, why }) => Object.freeze({ kind, why })));

/**
 * Every offending token in a string, in the order the shapes are declared.
 *
 * One token can offend twice — a fixture path is also a repository path and
 * also carries a file name — and all of them are reported, because a reader of
 * a failing test is better served by "this is three kinds of wrong" than by the
 * first shape that happened to match.
 *
 * @param text any visible copy.
 * @returns an array of `{ kind, token, why }`, empty when the copy is clean.
 */
export function findForbiddenTokens(text) {
  const subject = typeof text === "string" ? text : "";
  const found = [];
  for (const shape of SHAPES) {
    // A fresh regexp per call: the declared ones are global, and a shared
    // `lastIndex` makes the second caller miss what the first one found.
    const pattern = new RegExp(shape.pattern.source, shape.pattern.flags);
    for (const match of subject.matchAll(pattern)) {
      found.push(Object.freeze({ kind: shape.kind, token: match[0], why: shape.why }));
    }
  }
  return found;
}

/** True when a string carries none of the forbidden shapes. */
export function isReaderSafe(text) {
  return findForbiddenTokens(text).length === 0;
}
