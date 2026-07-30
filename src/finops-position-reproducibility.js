// Whether a ranking claim can be repeated in a review — and when it must not be
// made at all.
//
// THE ONE QUESTION
// ----------------
//   "If a FinOps lead states this position in a review on Tuesday, will the same
//    inputs produce the same position on Thursday, and can they show why?"
//
// Nothing here computes a position. `peer-cost-position.js` owns the metric and
// the bands, `internal-cost-gap.js` owns the department gap, and this module
// runs both, decides whether their output may be published at all, and hands
// back one record a reader can inspect and a later run can compare against.
//
// THE THREE REFUSALS
// ------------------
// A refusal is not a degraded answer. When one of these fires there is no band,
// no gap, no wider interval, and no lowered confidence figure — those are all
// ways of stating a claim the inputs do not support while looking careful about
// it. All three refusals return the SAME shape, so a surface has one path to
// render and never has to tell three failures apart:
//
//   1. RUBRIC VERSION MISMATCH. The cohort snapshot publishes the rubric version
//      its boundaries were computed under. When that is not the rubric this
//      module scores with, the boundaries mean something else, and the position
//      is withheld entirely. There is deliberately no fall back to the nearest
//      matching snapshot: "nearest" is a comparison against a cohort the reader
//      was never told about, and it is how a review ends up defending a figure
//      derived from data nobody chose.
//   2. SAMPLE BELOW THE FLOOR. Too few successful tasks to divide by.
//   3. NO MATCHED COHORT. Nothing published matches the declared attributes, so
//      there is no distribution to be a position in.
//
// EVERY THRESHOLD IS STATED WHERE IT IS DEFINED
// ---------------------------------------------
// Each number below carries one sentence saying what it assumes, phrased so a
// director whose team it grades can argue with the assumption rather than with
// the arithmetic.
//
// UNTRUSTED TEXT
// --------------
// Department names arrive from an uploaded export. They are display data and
// never rubric input: nothing here branches on a name, and every name that
// reaches the record goes through `neutralizeRecordText` first, so instruction
// text pasted into a department column is redacted before it can reach a judge,
// a stored record, or the DOM.
//
// LOCALITY. Pure over the inputs it is handed, plus an explicit storage object
// for the serialize/rehydrate pair. No clock, network, credential, or DOM.

import { PEER_COST_SNAPSHOT } from "./peer-cost-cohorts.js";
import {
  COST_METRIC, COST_POSITION_VERSION, COST_POSITION_WITHHELD,
  displayCostPerSuccessfulTask, resolveCostPosition,
} from "./peer-cost-position.js";
import { INTERNAL_GAP_STATUS, resolveInternalCostGap } from "./internal-cost-gap.js";
import { neutralizeRecordText } from "./finops-journey-redaction.js";
import {
  FIXTURE_PROVENANCE, FIXTURES_VERIFIED_ON, PINNED_EXPECTATION_COUNT,
} from "./finops-position-fixtures.js";

/** Bump when a refusal rule, a threshold, a reason string, or the record shape changes. */
export const REPRODUCIBILITY_VERSION = "finops-position-reproducibility/1.0.0";

/**
 * The rubric this module scores with.
 *
 * Declared here rather than read off the snapshot, and that is the whole point
 * of the guard: a constant that copied itself from the data it is checking would
 * agree with every snapshot ever published and could never fail.
 *
 * ASSUMPTION, disputable on the merits: two rubric versions are compatible only
 * when their strings are identical. There is no ordering, no "v2 data is close
 * enough for v3", and no compatibility range — a range is a judgement a reader
 * cannot check from the page.
 */
export const SCORING_RUBRIC_VERSION = "finops-cost-rubric/v2";

/**
 * The org-level sample floor, in successful tasks.
 *
 * ASSUMPTION, disputable on the merits: below thirty successful tasks a single
 * retried or reclassified task moves cost per successful task by more than 3% of
 * the metric, which is enough to cross a quartile boundary for an organization
 * sitting near one — so a position built on fewer rows is a claim about the
 * ledger's noise. Argue it down by showing a smaller denominator whose band
 * survives one row changing outcome; argue it up by showing thirty does not.
 *
 * It is deliberately larger than `INTERNAL_MINIMUM_SUCCESSFUL_TASKS` (12), which
 * governs a department inside one org and answers a narrower question: naming a
 * lagging team is a comparison against colleagues, while a peer position is a
 * claim made outside the company, and the outside claim is held to more rows.
 */
export const POSITION_MINIMUM_SUCCESSFUL_TASKS = 30;

/**
 * The confidence tiers, as multiples of the floor.
 *
 * ASSUMPTION, disputable on the merits: confidence in a position is a statement
 * about how many rows stand behind the denominator and nothing else — it is not
 * a probability, and this module never publishes it as a number, because a
 * number invites arithmetic nobody defined. Ten times the floor is "high", three
 * times is "medium", and anything above the floor is "low"; below the floor
 * there is no tier at all, because that case is a refusal rather than a weaker
 * answer. A director may dispute the multipliers; they cannot mistake the tier
 * for a measured probability.
 */
export const CONFIDENCE_TIER = Object.freeze({
  high: { id: "high", label: "High", multiple: 10 },
  medium: { id: "medium", label: "Medium", multiple: 3 },
  low: { id: "low", label: "Low", multiple: 1 },
});

/** Refusal codes. Wire values; the sentences below are what a reader sees. */
export const POSITION_REFUSAL = Object.freeze({
  rubricVersionMismatch: "rubric_version_mismatch",
  sampleBelowFloor: "sample_below_floor",
  noMatchedCohort: "no_matched_cohort",
  positionWithheld: "position_withheld",
});

/** The two statuses. There is no third, and no exception path. */
export const REPRODUCIBILITY_STATUS = Object.freeze({
  verified: "verified",
  refused: "refused",
});

/**
 * The next step for each refusal, as copy rather than as a rule.
 *
 * The refusal reason is composed per case with the real versions and counts in
 * it; the remedy is fixed per code. A reader handed a reason with no remedy is
 * being handed a dead label with more words in it.
 */
export const REFUSAL_NEXT_STEP = Object.freeze({
  [POSITION_REFUSAL.rubricVersionMismatch]:
    "Wait for a cohort snapshot published under the scoring rubric this page runs, or state the "
    + "spend figure without a peer position until one exists.",
  [POSITION_REFUSAL.sampleBelowFloor]:
    "Include a full month of the task ledger — the rows carrying a terminal outcome — and analyze "
    + "the export again.",
  [POSITION_REFUSAL.noMatchedCohort]:
    "Check the declared size band and industry against the published cohorts listed in this "
    + "disclosure, then analyze the export again.",
  [POSITION_REFUSAL.positionWithheld]:
    "Resolve what the reason above names in the export, then analyze it again.",
});

/** Which refusal code a withheld position maps to. Anything else is a pass-through. */
const WITHHELD_AS_REFUSAL = Object.freeze({
  [COST_POSITION_WITHHELD.noMatchingCohort]: POSITION_REFUSAL.noMatchedCohort,
  [COST_POSITION_WITHHELD.noSuccessfulTasks]: POSITION_REFUSAL.sampleBelowFloor,
});

const rubricRecord = (snapshot, rubricVersion) => Object.freeze({
  inUse: rubricVersion,
  snapshot: snapshot?.rubricVersion ?? null,
  snapshotDate: snapshot?.snapshotId ?? null,
  matches: Boolean(rubricVersion) && rubricVersion === snapshot?.rubricVersion,
});

/**
 * The refusal, in the one shape all three cases share.
 *
 * Every field a published result carries is present and null. A surface that
 * reads `band` off this gets nothing rather than something weaker, which is the
 * behaviour the refusal exists to guarantee.
 */
function refuse(code, reason, rubric) {
  return Object.freeze({
    version: REPRODUCIBILITY_VERSION,
    status: REPRODUCIBILITY_STATUS.refused,
    refused: true,
    refusal: Object.freeze({ code, reason, nextStep: REFUSAL_NEXT_STEP[code] }),
    band: null,
    bandLabel: null,
    value: null,
    valueDisplay: null,
    gap: null,
    confidence: null,
    lastVerification: verificationRecord(),
    provenance: null,
    rubric,
  });
}

/** What is checked, and how much of it. Constant, and traceable to the fixtures. */
function verificationRecord() {
  return Object.freeze({
    verifiedOn: FIXTURES_VERIFIED_ON,
    pinnedExpectations: PINNED_EXPECTATION_COUNT,
    label: FIXTURE_PROVENANCE.label,
    statement: FIXTURE_PROVENANCE.statement,
  });
}

/** The tier for a denominator. Never called below the floor — that path refuses. */
function confidenceFor(successfulTasks) {
  const floor = POSITION_MINIMUM_SUCCESSFUL_TASKS;
  const tier = successfulTasks >= floor * CONFIDENCE_TIER.high.multiple ? CONFIDENCE_TIER.high
    : successfulTasks >= floor * CONFIDENCE_TIER.medium.multiple ? CONFIDENCE_TIER.medium
      : CONFIDENCE_TIER.low;
  return Object.freeze({
    tier: tier.id,
    label: tier.label,
    basis: `${successfulTasks} successful tasks stand behind this position, against a floor of `
      + `${floor} and a ${tier.label.toLowerCase()}-confidence cut at ${floor * tier.multiple}. `
      + "Confidence is a count of rows, not a probability.",
  });
}

/**
 * The gap, with every department name neutralized.
 *
 * A suppressed gap is carried as its own sentence rather than dropped: "no
 * internal comparison, and here is why" is a fact the reader is owed, and it is
 * not a refusal of the peer position, which stands on its own inputs.
 */
function gapRecord(gap) {
  if (gap?.status !== INTERNAL_GAP_STATUS.finding) {
    return Object.freeze({
      available: false,
      suppressedReason: gap?.suppressedReason ?? null,
      laggard: null, leader: null, gapBands: null, gapValue: null, gapDisplay: null,
    });
  }
  return Object.freeze({
    available: true,
    suppressedReason: null,
    laggard: Object.freeze({
      id: gap.laggard.departmentId,
      name: neutralizeRecordText(gap.laggard.department),
      value: gap.laggard.metricValue,
      band: gap.laggard.band,
    }),
    leader: Object.freeze({
      id: gap.leader.departmentId,
      name: neutralizeRecordText(gap.leader.department),
      value: gap.leader.metricValue,
      band: gap.leader.band,
    }),
    gapBands: gap.gapBands,
    gapValue: gap.gapValue,
    gapDisplay: displayCostPerSuccessfulTask(gap.gapValue),
  });
}

/**
 * The record two runs are compared on.
 *
 * WHAT IS DELIBERATELY ABSENT: the wall-clock instant of the run. It is the one
 * field that cannot be equal across two runs, and including it would force every
 * determinism check to be written as "equal except for this", which is a
 * comparison that also passes when a real figure moves. Every date in this
 * record is a date carried by the DATA — the snapshot's, the window's, the
 * fixtures' — and every one of those is reproducible.
 */
function provenanceRecord(position, gap, confidence, rubric, period) {
  return Object.freeze({
    reproducibilityVersion: REPRODUCIBILITY_VERSION,
    positionContract: position.version ?? COST_POSITION_VERSION,
    rubricVersion: rubric.inUse,
    snapshotRubricVersion: rubric.snapshot,
    cohortSnapshotDate: rubric.snapshotDate,
    cohortId: position.cohort.cohortId,
    metricId: COST_METRIC.id,
    p25: position.cohort.p25,
    p75: position.cohort.p75,
    band: position.band,
    value: position.value,
    valueDisplay: position.valueDisplay,
    successfulTasks: position.successfulTasks,
    spendUsd: position.spendUsd,
    period: period ?? null,
    confidenceTier: confidence.tier,
    gapBands: gap.gapBands,
    gapValue: gap.gapValue,
    gapLaggardId: gap.laggard?.id ?? null,
    gapLeaderId: gap.leader?.id ?? null,
    verifiedOn: FIXTURES_VERIFIED_ON,
    pinnedExpectations: PINNED_EXPECTATION_COUNT,
  });
}

/**
 * Evaluate a position and decide whether it may be published.
 *
 * The checks run in a fixed order and the FIRST failure wins, so two engineers
 * reading the same broken input report the same cause:
 *
 *   1. the snapshot's rubric version and this module's agree,
 *   2. the shared rubric can place the org at all — an unmatched cohort and an
 *      empty denominator become refusals in this module's own shape,
 *   3. the denominator clears the sample floor.
 *
 * The version guard runs FIRST and reads nothing else: a snapshot scored under
 * another rubric must not produce a cohort match, a band, or a reason derived
 * from boundaries that mean something different.
 *
 * @param analysis the already-normalized envelope the org-level path consumes.
 * @param org `{ sizeBand, industry, snapshotId }` — declared, never inferred.
 * @param tasks the window's task ledger.
 * @param snapshot `{ snapshotId, rubricVersion }`; defaults to the published one.
 * @param rubricVersion the rubric in use; defaults to this module's own.
 */
export function evaluatePositionReproducibility({
  analysis = null, org = null, tasks = null,
  snapshot = PEER_COST_SNAPSHOT, rubricVersion = SCORING_RUBRIC_VERSION,
} = {}) {
  const rubric = rubricRecord(snapshot, rubricVersion);
  if (!rubric.matches) {
    return refuse(POSITION_REFUSAL.rubricVersionMismatch,
      `No peer position: the cohort snapshot dated ${rubric.snapshotDate ?? "unknown"} was built `
      + `for rubric ${rubric.snapshot ?? "unknown"} and cannot be scored against rubric `
      + `${rubric.inUse ?? "unknown"}, so its quartile boundaries do not mean here what they meant `
      + "there.", rubric);
  }

  const spendUsd = Number(analysis?.spendUsd);
  const position = resolveCostPosition({ org, spendUsd, tasks });
  if (!position.available) {
    const code = WITHHELD_AS_REFUSAL[position.reasonCode] ?? POSITION_REFUSAL.positionWithheld;
    return refuse(code, position.reason, rubric);
  }

  if (position.successfulTasks < POSITION_MINIMUM_SUCCESSFUL_TASKS) {
    return refuse(POSITION_REFUSAL.sampleBelowFloor,
      `No peer position: this window has ${position.successfulTasks} successful task`
      + `${position.successfulTasks === 1 ? "" : "s"} and a position needs at least `
      + `${POSITION_MINIMUM_SUCCESSFUL_TASKS}, so a band here would describe the sample rather `
      + "than the organization.", rubric);
  }

  const confidence = confidenceFor(position.successfulTasks);
  const gap = gapRecord(resolveInternalCostGap({ analysis, org, tasks }));
  return Object.freeze({
    version: REPRODUCIBILITY_VERSION,
    status: REPRODUCIBILITY_STATUS.verified,
    refused: false,
    refusal: null,
    band: position.band,
    bandLabel: position.bandLabel,
    value: position.value,
    valueDisplay: position.valueDisplay,
    gap,
    confidence,
    lastVerification: verificationRecord(),
    provenance: provenanceRecord(position, gap, confidence, rubric, analysis?.period ?? null),
    rubric,
  });
}

// ---------------------------------------------------------------------------
// Persistence. The review flow already carries its state across a reload as JSON
// under a `shiplog.finops.*` key; a resumed review reads the position back the
// same way, through the same kind of store, so "resumed" and "fresh" are the
// same comparison rather than two.
// ---------------------------------------------------------------------------

export const REPRODUCIBILITY_KEY = "shiplog.finops.position-reproducibility.v1";

/** Write the provenance record. Returns what was written, or null when there is none. */
export function storeReproducibility(storage, result) {
  const record = result?.provenance ?? null;
  if (!storage || !record) return null;
  storage.setItem(REPRODUCIBILITY_KEY, JSON.stringify(record));
  return record;
}

/**
 * Read it back. Null — never a partial object — for anything that is not the
 * record this module wrote: half-understood evidence is how a review ends up
 * defending a field nobody wrote.
 */
export function readReproducibility(storage) {
  if (!storage) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(storage.getItem(REPRODUCIBILITY_KEY) ?? "null");
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.reproducibilityVersion !== REPRODUCIBILITY_VERSION) return null;
  return Object.freeze(parsed);
}

// ---------------------------------------------------------------------------
// Copy. Plain text only — the view owns the DOM.
// ---------------------------------------------------------------------------

/**
 * The one line the comparison disclosure leads with: whether this claim can be
 * repeated, or the reason it is refused.
 */
export function reproducibilityNote(result) {
  if (!result) return "This view has not checked whether its position can be reproduced.";
  if (result.refused) return result.refusal.reason;
  const { provenance, confidence, lastVerification } = result;
  return `This position is reproducible: rubric ${provenance.rubricVersion}, cohort snapshot `
    + `${provenance.cohortSnapshotDate}, ${confidence.label.toLowerCase()} confidence, `
    + `${lastVerification.pinnedExpectations} pinned expectations last verified `
    + `${lastVerification.verifiedOn}.`;
}

/**
 * The disclosure rows, in the term/detail shape the stand disclosures already
 * paint. Four terms in both states — a refusal replaces the figures with its
 * reason and its next step, it does not remove the rows that say which rubric
 * and which snapshot produced nothing.
 */
export function reproducibilityEntries(result) {
  const entry = (term, detail) => Object.freeze({ term, detail: String(detail) });
  if (!result) {
    return [entry("Reproducibility",
      "This view has not checked whether its position can be reproduced.")];
  }
  const rows = [
    entry("Scoring rubric", result.rubric.inUse ?? "no rubric declared"),
    entry("Cohort snapshot", `${result.rubric.snapshotDate ?? "no snapshot"} · built for rubric `
      + `${result.rubric.snapshot ?? "unknown"}`),
  ];
  if (result.refused) {
    rows.push(entry("Position withheld", result.refusal.reason));
    rows.push(entry("What resolves it", result.refusal.nextStep));
    rows.push(entry("Last verification",
      `${result.lastVerification.pinnedExpectations} pinned expectations, last verified `
      + `${result.lastVerification.verifiedOn}. ${result.lastVerification.statement}`));
    return rows;
  }
  rows.push(entry("Confidence", `${result.confidence.label} · ${result.confidence.basis}`));
  rows.push(entry("Last verification",
    `${result.lastVerification.pinnedExpectations} pinned expectations, last verified `
    + `${result.lastVerification.verifiedOn}. ${result.lastVerification.statement}`));
  rows.push(entry("Reproduced figure", `${result.bandLabel} · ${result.valueDisplay} per `
    + `successful task, from ${result.provenance.successfulTasks} successful tasks against `
    + `boundaries ${displayCostPerSuccessfulTask(result.provenance.p25)} and `
    + `${displayCostPerSuccessfulTask(result.provenance.p75)}.`));
  if (result.gap.available) {
    rows.push(entry("Widest internal gap", `${result.gap.laggard.name} is `
      + `${result.gap.gapDisplay} per successful task behind ${result.gap.leader.name}, on the `
      + "same rubric."));
  }
  return rows;
}
