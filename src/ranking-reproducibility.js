// Can a FinOps lead repeat this ranking claim, and prove it is the same claim?
//
// THE ONE QUESTION
// ----------------
//   "If I say we are in the bottom quartile, can a second person re-derive that
//    from the same inputs and get the same answer?"
//
// A band is a claim a director will dispute. What makes it defensible is not
// more precision — it is that the rubric that produced it is named, the cohort
// snapshot it was scored against was built for that same rubric, the sample it
// was computed over is large enough to be stable, and the whole derived record
// is a fixed value a second run reproduces byte for byte.
//
// WHAT THIS MODULE ADDS, AND WHAT IT DELIBERATELY DOES NOT
// -------------------------------------------------------
// It adds three gates and one record. It adds NO scoring: the metric, the
// quartile boundaries, the cohort match, and the department gap are
// `peer-cost-position.js` and `internal-cost-gap.js`, called unmodified. There
// is no second band rule here, no re-weighting, and no widened band for a thin
// sample. A weaker number is not a safer number; it is the same disputed claim
// with the evidence for it removed, so the answer to "not enough to say" is to
// say nothing and say why.
//
//   1. VERSION GUARD. The cohort snapshot carries the rubric version it was
//      built for. If it disagrees with the rubric this path implements, the
//      position is withheld ENTIRELY — no band, no percentile, no estimate —
//      and the refusal names both versions.
//   2. SAMPLE FLOOR. Below `MINIMUM_RANKED_SUCCESSFUL_TASKS` the position is
//      refused rather than published with a caveat.
//   3. MATCHED COHORT. `peer-cost-position.js` already refuses when no
//      published cohort matches; this passes that refusal through in its own
//      words rather than paraphrasing it.
//
// THE RECORD IS THE COMPARED VALUE
// --------------------------------
// `record` holds only derived, typed values — versions, ids, integers, and
// money in whole cents — and `fingerprint` is a pure function of it. Nothing
// nondeterministic is inside either: no clock, no random, no iteration over an
// object whose key order depends on input order, no floating-point remainder
// that a second run could format differently. The verification date IS shown to
// readers, and it lives on `verification`, OUTSIDE the record and outside the
// fingerprint, because a value that changes every time it is read would make
// every comparison of two runs report a difference that is not one.
//
// LOCALITY. Pure arithmetic over the published cohorts and inputs handed in by
// the caller. No storage, clock, network, credential, or DOM.

import { neutralizeRecordText } from "./finops-journey-redaction.js";
import { resolveInternalCostGap } from "./internal-cost-gap.js";
import {
  COST_POSITION_WITHHELD, PEER_COST_PROVENANCE, resolveCostPosition,
} from "./peer-cost-position.js";

/** Bump when a gate, a refusal reason, or the shape of the compared record changes. */
export const REPRODUCIBILITY_VERSION = "finops-ranking-reproducibility/1.0.0";

/**
 * The rubric this scoring path implements.
 *
 * ASSUMPTION: the numbers that decide a band — the quartile boundaries on a
 * cohort record and the metric they are boundaries on — are one versioned unit,
 * so a snapshot published under a different version cannot be scored here at
 * all. WHO DISPUTES IT: an analyst who wants last quarter's snapshot ranked
 * against this quarter's rubric to keep a trend line unbroken. They are told no,
 * because that trend line would compare two different questions.
 *
 * It is declared HERE, beside the code that reads the boundaries, and pinned
 * against the snapshot's own declaration in the fixture suite. Deriving it from
 * the snapshot would make the guard a comparison of a value with itself.
 */
export const RUBRIC_VERSION = "finops-cost-rubric/v2";

/**
 * The sample floor for any published ranking claim, in successful tasks.
 *
 * ASSUMPTION: thirty successful tasks is the point below which one retried task
 * moves cost per successful task by more than three percent, which is narrower
 * than the gap between two quartile boundaries on every published cohort — so
 * above this floor the band a reader repeats does not turn over on a single row.
 * WHO DISPUTES IT: the lead of a four-person team whose month has eight
 * successful tasks and who wants a position anyway. They get a refusal with the
 * number in it rather than a band that would change next week.
 *
 * It is scoped to the ORG-level ranking claim. The per-department floor is
 * `INTERNAL_MINIMUM_SUCCESSFUL_TASKS` in `internal-cost-gap.js` and is a
 * different number for a different comparison; neither reads the other.
 */
export const MINIMUM_RANKED_SUCCESSFUL_TASKS = 30;

/**
 * Confidence, as multiples of that same floor rather than as a second opinion.
 *
 * ASSUMPTION: confidence in a band claim is a statement about how far the sample
 * is from the point where the claim stops being stable, so it is expressed in
 * the only unit this rubric has for that — the floor. Four times the floor is
 * "high", twice is "moderate", clearing it at all is "low".
 * WHO DISPUTES IT: a statistician who wants a confidence interval on the metric.
 * They are right that this is coarser; it is published as a tier with its own
 * arithmetic shown so a reader can check it, not as a probability it is not.
 */
export const CONFIDENCE_TIER = Object.freeze({ high: "high", moderate: "moderate", low: "low" });

/** The multiples of the floor each tier starts at. Stated as data, not as an `if`. */
export const CONFIDENCE_MULTIPLE = Object.freeze({ high: 4, moderate: 2, low: 1 });

export const CONFIDENCE_LABEL = Object.freeze({
  [CONFIDENCE_TIER.high]: "High",
  [CONFIDENCE_TIER.moderate]: "Moderate",
  [CONFIDENCE_TIER.low]: "Low",
});

/** Why a ranking claim is refused. Wire values; the sentences are composed below. */
export const REPRODUCIBILITY_REFUSED = Object.freeze({
  missingRubricVersion: "missing_rubric_version",
  rubricVersionMismatch: "rubric_version_mismatch",
  noMatchedCohort: "no_matched_cohort",
  insufficientSample: "insufficient_sample_size",
  positionWithheld: "position_withheld",
});

/**
 * The cohort snapshot as it ships, carrying the rubric version it was built for.
 *
 * Read from `PEER_COST_PROVENANCE` rather than restated, so there is one
 * published snapshot on this page and no way for a surface to name a second.
 */
export const SHIPPED_COHORT_SNAPSHOT = Object.freeze({
  snapshotId: PEER_COST_PROVENANCE.snapshotId,
  rubricVersion: PEER_COST_PROVENANCE.rubricVersion,
});

const filled = (value) => typeof value === "string" && value.trim().length > 0;

/** Money as whole cents: an integer two runs cannot format differently. */
const cents = (value) => (Number.isFinite(value) ? Math.round(value * 100) : null);

/**
 * Every field of the compared record, in the one order it is ever serialized in.
 *
 * The order is this literal, not `Object.keys` of an input, because a key order
 * that follows input order is exactly the nondeterminism the record exists to
 * rule out. A field added here changes the fingerprint, which is the point: it
 * fails the pinned assertion rather than changing a number nobody re-checked.
 */
export const RECORD_FIELDS = Object.freeze([
  "rubricVersion", "snapshotId", "cohortId", "band", "boundaryP25Cents", "boundaryP75Cents",
  "valueCents", "spendCents", "successfulTasks", "confidenceTier",
  "gapStatus", "gapBands", "gapValueCents", "gapLeaderId", "gapLaggardId",
]);

function canonical(record) {
  return JSON.stringify(RECORD_FIELDS.map((field) => [field, record[field] ?? null]));
}

/**
 * A 32-bit FNV-1a digest of the canonical record, as eight hex characters.
 *
 * A change DETECTOR, not a cryptographic digest and never described as one: it
 * exists so two runs can be compared in one glance and so a moved pinned value
 * fails a named assertion. It is implemented here rather than imported because
 * this repository takes no dependency for eight lines of arithmetic.
 */
export function reproducibilityFingerprint(record) {
  const text = canonical(record ?? {});
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    // The FNV-1a 32-bit prime, applied with Math.imul so the multiply stays in
    // 32 bits on every engine rather than losing precision in a double.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The tier, and the arithmetic that produced it, in the reader's own units. */
function confidenceFor(successfulTasks) {
  const multiple = successfulTasks / MINIMUM_RANKED_SUCCESSFUL_TASKS;
  const tier = multiple >= CONFIDENCE_MULTIPLE.high
    ? CONFIDENCE_TIER.high
    : (multiple >= CONFIDENCE_MULTIPLE.moderate ? CONFIDENCE_TIER.moderate : CONFIDENCE_TIER.low);
  return Object.freeze({
    tier,
    label: CONFIDENCE_LABEL[tier],
    successfulTasks,
    minimum: MINIMUM_RANKED_SUCCESSFUL_TASKS,
    // Rounded to one decimal for reading, from integers on both sides, so the
    // sentence a reader repeats is the same sentence on every run.
    multiple: Math.round(multiple * 10) / 10,
    // What the tier means for repeating the claim, in the reader's own units:
    // how much finished work it rests on, against the least this page will
    // publish a ranking on at all.
    detail: `${CONFIDENCE_LABEL[tier]} · based on ${successfulTasks} successful tasks, `
      + `${Math.round(multiple * 10) / 10}× the ${MINIMUM_RANKED_SUCCESSFUL_TASKS} this page needs `
      + "before it will publish a ranking at all. More finished work means one retried task cannot "
      + "move which quarter you are in.",
  });
}

/**
 * The verification date, and where it is NOT.
 *
 * It is the analysed window's own end — a date the caller hands in, never a
 * clock this module reads — and it is returned OUTSIDE `record`, so it is
 * displayed without ever entering the fingerprinted payload. An unavailable date
 * is a sentence saying why, never a blank and never today's date standing in.
 */
function verificationFor(verifiedAt) {
  if (!filled(verifiedAt)) {
    return Object.freeze({
      available: false,
      value: null,
      detail: "This analysis published no window end, so no date is claimed. The date shown here "
        + "is always the end of the period being analysed, never the time you opened this page.",
    });
  }
  return Object.freeze({
    available: true,
    value: verifiedAt.trim(),
    detail: `Checked against spend up to ${verifiedAt.trim()}, the end of the period analysed. `
      + "This date is deliberately left out of the repeat-check code: a value that moves with the "
      + "clock would make every re-run look like a different result.",
  });
}

/** "2026-06-01 to 2026-07-01" → "2026-07-01". Null rather than a guess. */
export function windowEnd(period) {
  const match = /^(\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/.exec(String(period ?? "").trim());
  return match ? match[2] : null;
}

function refused(code, reason, { rubric, verification, position = null }) {
  return Object.freeze({
    version: REPRODUCIBILITY_VERSION,
    reproducible: false,
    refusedCode: code,
    reason,
    /**
     * The withheld position, in the shape the headline's withheld path reads.
     * Null band, null value: a refusal is not a position, and no field on it may
     * be mistaken for one.
     */
    position: position ?? Object.freeze({
      available: false, band: null, bandLabel: null, value: null, valueDisplay: null,
      reasonCode: code, reason,
    }),
    rubric,
    confidence: null,
    verification,
    record: null,
    fingerprint: null,
  });
}

/**
 * Resolve a reproducible ranking claim, or refuse it with a reason.
 *
 * The gates are checked in a fixed order and the FIRST failure wins, so two
 * engineers reading the same broken input report the same cause:
 *
 *   1. the snapshot declares a rubric version,
 *   2. that version is the one this path implements,
 *   3. the shared rubric can place the org at all (which includes "a published
 *      cohort matches"), and
 *   4. the sample clears the floor.
 *
 * @param org `{ sizeBand, industry, snapshotId }` — declared, never inferred.
 * @param spendUsd the page's headline spend total for the window.
 * @param tasks the window's task ledger.
 * @param analysis the normalized envelope, for the department gap and the window.
 * @param snapshot the cohort snapshot descriptor. Defaults to the shipped one;
 *   a caller passes another only to exercise the version guard.
 * @param verifiedAt the verification date. Defaults to the analysed window's
 *   end, so the shipped path reads no clock to obtain it.
 */
export function evaluateRankingReproducibility({
  org = null, spendUsd = null, tasks = null, analysis = null,
  snapshot = SHIPPED_COHORT_SNAPSHOT, verifiedAt = undefined,
} = {}) {
  const declared = snapshot?.rubricVersion ?? null;
  const rubric = Object.freeze({
    inUse: RUBRIC_VERSION,
    snapshot: filled(declared) ? declared : null,
    snapshotId: snapshot?.snapshotId ?? null,
  });
  const verification = verificationFor(
    verifiedAt === undefined ? windowEnd(analysis?.period) : verifiedAt);

  if (!filled(declared)) {
    return refused(REPRODUCIBILITY_REFUSED.missingRubricVersion,
      "No ranking is shown: this peer data does not say which version of the scoring rules it was "
      + `built for, so there is no way to tell whether it matches the rules in use `
      + `(${RUBRIC_VERSION}). Peer data with no version is scored against nothing, not scored `
      + "leniently.",
      { rubric, verification });
  }
  if (declared !== RUBRIC_VERSION) {
    return refused(REPRODUCIBILITY_REFUSED.rubricVersionMismatch,
      `No ranking is shown: peer data built for scoring rules ${declared} cannot be scored against `
      + `the rules in use (${RUBRIC_VERSION}). The boundaries and the metric they divide are one `
      + "versioned set, so no quarter, percentile, or estimate is published on this path.",
      { rubric, verification });
  }

  const position = resolveCostPosition({ org, spendUsd, tasks });
  if (!position.available) {
    const code = position.reasonCode === COST_POSITION_WITHHELD.noMatchingCohort
      ? REPRODUCIBILITY_REFUSED.noMatchedCohort
      : REPRODUCIBILITY_REFUSED.positionWithheld;
    // The position contract's own sentence, verbatim. Paraphrasing it here would
    // be a second eligibility rule wearing the first one's clothes.
    return refused(code, position.reason, { rubric, verification, position });
  }
  if (position.successfulTasks < MINIMUM_RANKED_SUCCESSFUL_TASKS) {
    return refused(REPRODUCIBILITY_REFUSED.insufficientSample,
      `No ranking is shown: this period has ${position.successfulTasks} successful task`
      + `${position.successfulTasks === 1 ? "" : "s"} and this page needs `
      + `${MINIMUM_RANKED_SUCCESSFUL_TASKS} before it will say which quarter you are in. A vaguer `
      + "ranking over the same thin sample would be the same claim with the evidence removed, so "
      + "none is offered.",
      { rubric, verification });
  }

  const gap = resolveInternalCostGap({ analysis, org, tasks });
  const record = Object.freeze({
    rubricVersion: RUBRIC_VERSION,
    snapshotId: position.cohort.snapshotId,
    cohortId: position.cohort.cohortId,
    band: position.band,
    boundaryP25Cents: cents(position.cohort.p25),
    boundaryP75Cents: cents(position.cohort.p75),
    valueCents: cents(position.value),
    spendCents: cents(position.spendUsd),
    successfulTasks: position.successfulTasks,
    confidenceTier: confidenceFor(position.successfulTasks).tier,
    gapStatus: gap.status,
    gapBands: gap.gapBands,
    gapValueCents: cents(gap.gapValue),
    // Ids, not names: a department NAME is free text out of a reader's own file
    // and has no place in a value two runs are compared on. The name is
    // redacted where it is rendered, which is a different concern from this one.
    gapLeaderId: gap.leader?.departmentId ?? null,
    gapLaggardId: gap.laggard?.departmentId ?? null,
  });
  return Object.freeze({
    version: REPRODUCIBILITY_VERSION,
    reproducible: true,
    refusedCode: null,
    reason: null,
    position,
    rubric,
    confidence: confidenceFor(position.successfulTasks),
    verification,
    record,
    fingerprint: reproducibilityFingerprint(record),
    /** The gap, for a surface that names the department behind the record's id. */
    gap,
  });
}

/**
 * The laggard department as it may be RENDERED — never as it is compared.
 *
 * A department name arrives in a file a reader was sent, and it is copied into a
 * sentence a reader pastes into a review or a model. It is neutralized here for
 * exactly that reason; nothing derived from it reaches `record`, so redacting it
 * cannot move a band and leaving it could not have raised one.
 */
export function renderableLaggardName(result) {
  const name = result?.gap?.laggard?.department;
  return filled(name) ? neutralizeRecordText(name) : null;
}
