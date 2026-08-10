// The words the FinOps first screen says its answer in (#1554).
//
// THE GAP THIS CLOSES. The attestation under the consolidated answer told a
// reader the figure was "Attested finops-recoverable-attestation/1.0.0" and
// that each assumption sat in "tests/fixtures/finops-consolidated-answer-
// attestation.json". Both are true. Neither is a sentence a CTO who has never
// opened this repository can repeat in a meeting, and a version string is not
// an answer to "what is this priced from?" — it is the name of the thing that
// would answer it. So the first screen now states the evidence source as a noun
// phrase and the confidence as words, and the identifiers move down into the
// audit disclosure that already exists beside the figure. Demotion, not
// deletion: every identifier removed from the sentence is still findable one
// disclosure away.
//
// IT DERIVES NOTHING AND DEPENDS ON NOTHING. Literal tables and pure functions
// only: no import from any other module, no request, no storage, no clock, no
// random source, no file read. It is on the canonical decision path and
// tests/finops-decision-regression.test.js holds it to exactly that.
//
// NO SECOND CONFIDENCE SCALE IS INVENTED HERE. `confidencePhrase` is a total
// banded function over the confidence the analysis already publishes — the
// 0–100 evidence-confidence value, or the level word already read off it. The
// cut points below are the published ones restated as this module's own data so
// it can stay dependency-free; tests/finops-executive-vocabulary.test.js pins
// them against `CONFIDENCE_THRESHOLD` in src/finops-answer-contract.js, so the
// two cannot drift.

/**
 * What the money figure is priced from, as a noun phrase.
 *
 * It names the KIND of thing the evidence is and where it comes from. It is not
 * a path, not a filename, and not a contract id, because none of those tell a
 * reader whether the number is about their company.
 */
export const EVIDENCE_SOURCE_PHRASE = "the bundled synthetic example shipped with this page"
  + " — invented usage records for an invented company, not your own spend";

/**
 * The confidence bands, as explicit numeric intervals over the published 0–100
 * evidence-confidence value.
 *
 * Each band is `[min, max)` — closed at the bottom, open at the top — except
 * the highest, which is closed at both ends because 100 is in the domain. The
 * three bands tile [0, 100] with no gap and no overlap, so every value in the
 * domain lands in exactly one.
 */
export const CONFIDENCE_BANDS = Object.freeze([
  Object.freeze({ band: "high", min: 75, max: 100, maxInclusive: true, phrase: "strongly evidenced" }),
  Object.freeze({ band: "medium", min: 50, max: 75, maxInclusive: false, phrase: "reasonably evidenced" }),
  Object.freeze({ band: "low", min: 0, max: 50, maxInclusive: false, phrase: "weakly evidenced" }),
]);

/**
 * The one phrase for a confidence that is missing, out of domain, or a word
 * this module does not know.
 *
 * It says the confidence is NOT ESTABLISHED. It is never a silent fall-through
 * to a band, and never to the highest one: a reader who is told nothing about
 * how sure the product is has been told the product is sure.
 */
export const CONFIDENCE_NOT_ESTABLISHED = "not yet graded for confidence";

/**
 * The confidence, in words two engineers would produce identically.
 *
 * Total over every input. A finite number in [0, 100] is banded by the
 * intervals above; one of the three level words the analysis already publishes
 * maps to the same band's phrase; anything else — null, undefined, NaN, a
 * number outside the domain, an unknown word, an object — is
 * `CONFIDENCE_NOT_ESTABLISHED`.
 *
 * @param input the published 0–100 value, or the level word read off it.
 */
export function confidencePhrase(input) {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0 || input > 100) return CONFIDENCE_NOT_ESTABLISHED;
    const banded = CONFIDENCE_BANDS.find((entry) =>
      input >= entry.min && (entry.maxInclusive ? input <= entry.max : input < entry.max));
    return banded ? banded.phrase : CONFIDENCE_NOT_ESTABLISHED;
  }
  if (typeof input !== "string") return CONFIDENCE_NOT_ESTABLISHED;
  const word = input.trim().toLowerCase();
  const named = CONFIDENCE_BANDS.find((entry) => entry.band === word);
  return named ? named.phrase : CONFIDENCE_NOT_ESTABLISHED;
}

/**
 * Every internal identifier and piece of jargon the FinOps attestation printed
 * at a reader, and the phrase that replaces it.
 *
 * `demoted` marks the ones that left the visible sentence entirely and must now
 * be findable in the audit disclosure instead. tests assert that list against
 * the served disclosure, identifier by identifier, so nothing is dropped on the
 * way down.
 */
export const READER_PHRASES = Object.freeze([
  Object.freeze({
    id: "finops-recoverable-attestation/1.0.0", demoted: true,
    phrase: "the record this page's recoverable figure is checked against",
  }),
  Object.freeze({
    id: "finops-recoverable-spend/1.0.0", demoted: true,
    phrase: "the one recoverable-spend figure this page states",
  }),
  Object.freeze({
    id: "tests/fixtures/finops-consolidated-answer-attestation.json", demoted: true,
    phrase: "the audit note beside the figure, where every assumption is written out",
  }),
  Object.freeze({ id: "attested", demoted: false, phrase: "checked against its record" }),
  Object.freeze({ id: "operands", demoted: false, phrase: "inputs" }),
  Object.freeze({ id: "provenance", demoted: false, phrase: "where each input came from" }),
  Object.freeze({ id: "declared", demoted: false, phrase: "comes straight from that example" }),
  Object.freeze({ id: "derived", demoted: false, phrase: "worked out here" }),
  Object.freeze({ id: "coverage", demoted: false, phrase: "departments scored" }),
  Object.freeze({ id: "basis of record", demoted: false, phrase: "measured a month at a time" }),
]);

/** The identifiers that left visible copy and must still be in the disclosure. */
export const DEMOTED_IDENTIFIERS = Object.freeze(
  READER_PHRASES.filter((entry) => entry.demoted).map((entry) => entry.id));

/**
 * The reader phrase for an internal identifier.
 *
 * A miss THROWS rather than passing the identifier through: a silent
 * pass-through is exactly how a contract id gets painted at a reader again, and
 * it would do it in the one place nobody is looking.
 */
export function readerPhrase(id) {
  const entry = READER_PHRASES.find((candidate) => candidate.id === id);
  if (!entry) throw new TypeError(`no reader phrase is defined for "${id}"`);
  return entry.phrase;
}

/**
 * The token shapes that must never appear in visible first-screen copy.
 *
 * Machine-checkable on purpose: a test runs this list over the rendered text,
 * so adding a shape here tightens the guard everywhere at once rather than in
 * whichever test somebody remembers to edit. Every pattern is derived from an
 * identifier this repository actually prints — the contract ids are the
 * `finops-*` ones the FinOps modules export, and the clause codes are the
 * snake_case ones src/finops-destination-contract.js and the readiness levels
 * publish (`unchecked_basis`, `unscoped_action`, `ready_to_commit`,
 * `illustrative_only`, `provider_export`). None is a guessed shape.
 */
export const FORBIDDEN_TOKEN_SHAPES = Object.freeze([
  Object.freeze({
    name: "repository-relative path",
    pattern: /(?:^|[\s(])(?:src|tests|dist|node_modules|scripts|config|docs|migrations)\/[A-Za-z0-9._-]/,
  }),
  Object.freeze({
    name: "test fixture path",
    pattern: /(?:^|[\s(])tests\/fixtures\/[A-Za-z0-9._-]/,
  }),
  Object.freeze({
    name: "file extension",
    pattern: /[A-Za-z0-9_-]\.(?:js|json|html|css|md|ya?ml)\b/,
  }),
  Object.freeze({
    name: "contract id",
    pattern: /\bfinops-[a-z0-9-]+\/\d+\.\d+\.\d+\b/,
  }),
  Object.freeze({
    name: "rubric or version string",
    pattern: /\b[a-z][a-z0-9-]*\/\d+\.\d+\.\d+\b/,
  }),
  Object.freeze({
    name: "clause or state code",
    pattern: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/,
  }),
]);

/**
 * Every forbidden shape a piece of visible copy matches.
 *
 * @returns `[{ name, match }]` — empty when the text is clean. The name comes
 *   first so a failure says WHAT KIND of identifier leaked before it says which.
 */
export function forbiddenTokens(text) {
  const subject = typeof text === "string" ? text : "";
  return FORBIDDEN_TOKEN_SHAPES
    .map((shape) => ({ name: shape.name, match: shape.pattern.exec(subject)?.[0] ?? null }))
    .filter((hit) => hit.match !== null);
}

/**
 * The one sentence the first-screen attestation states.
 *
 * It answers the two questions a leader asks of a money figure they have not
 * seen before — what is it priced from, and how sure is the product — and it
 * answers both in words, in that order, before it states any count. The counts
 * that follow are the same four dimensions the attestation always carried; only
 * their vocabulary changed. The identifiers are one disclosure away and the
 * sentence says so, so nothing was hidden.
 *
 * @param dimensions `{ confidence, provenance: { declared, derived, total },
 *   coverage: { scored, inScope } }` — the attested record, unchanged.
 */
export function attestationSentence(dimensions) {
  const { declared, derived, total } = dimensions.provenance;
  const { scored, inScope } = dimensions.coverage;
  return `Priced from ${EVIDENCE_SOURCE_PHRASE} — and ${confidencePhrase(dimensions.confidence)}: `
    + `${declared} of ${total} inputs come straight from that example, ${derived} are worked out `
    + `here, ${scored} of ${inScope} departments are scored, and the reference identifiers and `
    + "the assumption behind each one are in the audit note beside the figure.";
}
