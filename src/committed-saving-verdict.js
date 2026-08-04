// Did last month's commitment actually happen? One grade, from two months of
// the period series (#1090).
//
// WHAT THIS SCORES, AND WHAT IT DOES NOT
// --------------------------------------
// `commitment-verification.js` scores a commitment against a *later analysis
// envelope*: it finds the committed org unit and the committed model inside a
// fresh import and reports what that one route cost. That check needs a
// per-model dimension, which most imports do not carry, and it needs the file
// again.
//
// This module scores the same commitment against the thing a browser already
// kept: the chronological period series (`finops-imported-period-series.js`),
// one total per calendar month. It answers a coarser question — did total spend
// move by what we said it would, between the month we committed from and the
// month after — and it answers it from figures already on hand, with no file
// reopened. The two are deliberately different instruments and neither is a
// second opinion about the other: this one never looks at a route, and the other
// one never looks at a series.
//
// Pure and total. Arguments in, one frozen verdict out. No DOM, no storage, no
// clock, no network, no randomness, and no reads of anything global. The same
// inputs produce the same grade and the same figure, to the cent, in this
// process and the next one.
//
// EVIDENCE FIRST, ARITHMETIC SECOND
// ---------------------------------
// The preconditions below are checked BEFORE any figure is computed, and an
// abstention returns without a numeric grade. This ordering is the whole point:
// a commitment scored against the wrong pair of months, or against somebody
// else's books, produces a number that looks exactly like a real one. "Not
// enough evidence" is an answer with a reason attached; a wrong `met` is not
// recoverable once a director has read it.
//
// EVERY FIGURE SAYS WHERE IT CAME FROM
// ------------------------------------
// The verdict carries a provenance record naming the two periods compared, the
// commitment scored, and for each figure whether it was SUPPLIED (carried
// verbatim from the series or the commitment record) or DERIVED here (with the
// inputs it was derived from). A reader disputing the grade can check it without
// rerunning anything, and the abstentions carry the same record so "what was
// missing" is inspectable too.

import { canonicalPeriod, formatUsd, periodSeriesFromTotals } from "./finops-imported-period-series.js";
import { nextCalendarMonth } from "./commitment-verification.js";

/** Bump when a band, a boundary, or a provenance field changes meaning. */
export const COMMITTED_SAVING_VERDICT_VERSION = "committed-saving-verdict/1.0.0";

/** The one question, carried in the payload so a surface cannot retitle it. */
export const COMMITTED_SAVING_QUESTION = "Did last month's commitment happen?";

/** Four grades. Exactly one is reported, and the fourth is not a number. */
export const VERDICT_GRADE = Object.freeze({
  met: "met",
  partiallyMet: "partially_met",
  missed: "missed",
  notEnoughEvidence: "not_enough_evidence",
});

/**
 * THE TOLERANCE BANDS, IN ONE PLACE, EACH WITH ITS ASSUMPTION.
 *
 * Both sides are integers in USD minor units, so the grade is decided by integer
 * cross-multiplication (`realized * 100` against `committed * percent`) and never
 * by a float ratio. A band boundary can therefore not move because a division
 * rounded — which is the first thing a director disputes.
 *
 * Percentages are of the COMMITTED saving, not of spend.
 */
export const MET_BAND_PERCENT = 95;
export const MISSED_FLOOR_PERCENT = 25;

/**
 * The bands, as data, in the order they are tested. Read `assumption` before
 * quoting any grade: each one is a policy choice, not a fact about the figures.
 *
 * Exhaustive and non-overlapping by construction: `met` is everything at or
 * above 95%, `missed` is everything at or below 25%, and `partially_met` is the
 * open interval between them. Every possible delta — including a negative one —
 * lands in exactly one.
 */
export const VERDICT_BANDS = Object.freeze([
  Object.freeze({
    grade: VERDICT_GRADE.met,
    // realized * 100 >= committed * 95
    fromPercent: MET_BAND_PERCENT,
    toPercent: null,
    boundary: "Inclusive at 95%. There is no upper bound.",
    rule: "Realized movement reaches at least 95% of the committed saving.",
    assumption:
      "A month's total spend moves for reasons nobody committed to — a price change, a quiet week, "
      + "one team's experiment — so a commitment landing within a twentieth of its figure is treated "
      + "as met rather than as a miss that happens to be small. The favourable side is deliberately "
      + "unbounded: beating a commitment is met, and a fifth grade for over-delivery would only give "
      + "a good month something to argue about.",
  }),
  Object.freeze({
    grade: VERDICT_GRADE.partiallyMet,
    // committed * 25 < realized * 100 < committed * 95
    fromPercent: MISSED_FLOOR_PERCENT,
    toPercent: MET_BAND_PERCENT,
    boundary: "Exclusive at both ends: above 25% and below 95%.",
    rule: "Movement is in the committed direction but lands short of the met band.",
    assumption:
      "A quarter of the committed saving is the floor at which the movement is still evidence that "
      + "the change was made at all. Below it, the figure is as easily explained by ordinary variance "
      + "as by the commitment, so it is not credited as partial progress.",
  }),
  Object.freeze({
    grade: VERDICT_GRADE.missed,
    fromPercent: null,
    toPercent: MISSED_FLOOR_PERCENT,
    boundary: "Inclusive at 25%. There is no lower bound.",
    rule: "Movement is at or below a quarter of the committed saving, including no movement and "
      + "movement in the wrong direction.",
    assumption:
      "Spend that rose is a missed commitment, not a saving of zero. Clamping a regression at zero "
      + "would render the most expensive outcome this module can observe as the mildest one.",
  }),
]);

/**
 * Why no grade was computed. Each names a condition a reader can go and fix, and
 * each is reported in the explanation text by name.
 */
export const ABSTENTION_REASON = Object.freeze({
  commitmentUnreadable: "commitment_unreadable",
  scopeMismatch: "scope_mismatch",
  periodGapNotOneStep: "period_gap_not_one_step",
  committedPeriodMissing: "committed_period_missing",
  followUpPeriodMissing: "follow_up_period_missing",
});

/**
 * The order preconditions are reported in when more than one fired. A commitment
 * that cannot be read is stated first because every later check would be about a
 * figure nobody has; scope precedes periods because months matching in the wrong
 * book is a coincidence, not evidence.
 */
export const ABSTENTION_ORDER = Object.freeze([
  ABSTENTION_REASON.commitmentUnreadable,
  ABSTENTION_REASON.scopeMismatch,
  ABSTENTION_REASON.periodGapNotOneStep,
  ABSTENTION_REASON.committedPeriodMissing,
  ABSTENTION_REASON.followUpPeriodMissing,
]);

export const ABSTENTION_STATEMENT = Object.freeze({
  [ABSTENTION_REASON.commitmentUnreadable]:
    "the stored commitment does not carry a month and a saving above zero to score, so there is no "
    + "figure to compare movement against",
  [ABSTENTION_REASON.scopeMismatch]:
    "the series was read under a different scope than the commitment was made under, so its months "
    + "are not this commitment's months",
  [ABSTENTION_REASON.periodGapNotOneStep]:
    "the follow-up period is not the single month directly after the committed month, so the "
    + "movement between them is not this commitment's result",
  [ABSTENTION_REASON.committedPeriodMissing]:
    "the committed month itself is absent from the series, so there is no figure to measure movement "
    + "away from",
  [ABSTENTION_REASON.followUpPeriodMissing]:
    "the follow-up period is absent from the series, so nothing has been measured yet",
});

/* -------------------------------- primitives ------------------------------- */

const usd = (minor) => Math.round(minor) / 100;

/** Series totals are dollars to the cent; the commitment is minor units. */
const seriesMinor = (total) => Math.round(Number(total) * 100);

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

/** A figure a reader can trace. `supplied` names where; `derived` names from what. */
const supplied = (name, value, source) =>
  ({ name, unit: "usd_minor", value, origin: "supplied", source, derivedFrom: [] });

const derived = (name, value, derivedFrom, rule, unit = "usd_minor") =>
  ({ name, unit, value, origin: "derived", source: null, derivedFrom, rule });

/**
 * The scope qualifier both sides carry, reduced to a comparable string.
 *
 * In this browser's store a retained period is filed under `dataset:YYYY-MM`, so
 * the qualifier ahead of the colon is the scope: which books these figures were
 * read from. A bare qualifier is accepted too, because a caller holding a series
 * it built itself has the scope without ever having had a period id.
 */
export function verdictScope(value) {
  const text = typeof value === "string" ? value.trim() : "";
  const qualifier = text.includes(":") ? text.slice(0, text.indexOf(":")) : text;
  return qualifier === "" ? null : qualifier.toLowerCase();
}

/**
 * The fields the comparison needs, or null.
 *
 * This is a re-read of a record the workspace contract already validated, not a
 * second opinion about it: a record reaching here malformed came from storage
 * somebody edited, and every figure below would otherwise be computed from it.
 */
function readCommitment(record) {
  const committedMinor = record?.claim?.monthlySavingsMinor;
  const committedFrom = canonicalPeriod(record?.claim?.period);
  const commitmentId = typeof record?.commitmentId === "string" && record.commitmentId !== ""
    ? record.commitmentId : null;
  if (!commitmentId || committedFrom === null) return null;
  // The commitment contract's own eligibility floor: a commitment worth zero was
  // never supposed to exist, and dividing by it would produce a grade from noise.
  if (!Number.isSafeInteger(committedMinor) || committedMinor <= 0) return null;
  return { commitmentId, committedFrom, committedMinor };
}

/** The grade for a realized figure, by integer cross-multiplication only. */
export function gradeFor(realizedMinor, committedMinor) {
  if (realizedMinor * 100 >= committedMinor * MET_BAND_PERCENT) return VERDICT_GRADE.met;
  if (realizedMinor * 100 <= committedMinor * MISSED_FLOOR_PERCENT) return VERDICT_GRADE.missed;
  return VERDICT_GRADE.partiallyMet;
}

const bandFor = (grade) => VERDICT_BANDS.find((band) => band.grade === grade) ?? null;

/* --------------------------------- the score ------------------------------- */

const verdictShape = (fields) => deepFreeze({
  schemaVersion: COMMITTED_SAVING_VERDICT_VERSION,
  question: COMMITTED_SAVING_QUESTION,
  grade: VERDICT_GRADE.notEnoughEvidence,
  gradeRule: null,
  gradeAssumption: null,
  realizedSavingMinor: null,
  realizedSavingUsd: null,
  committedSavingMinor: null,
  committedSavingUsd: null,
  deltaMinor: null,
  deltaUsd: null,
  realizedPercentOfCommitted: null,
  relativeDeltaPercent: null,
  reasons: [],
  explanation: "",
  provenance: null,
  ...fields,
});

/**
 * Score one stored commitment against the movement the period series measured.
 *
 * @param options.series task 1's chronological period series, or anything
 *   `periodSeriesFromTotals` accepts: `[{ period, total | spendUsd }]`. It is
 *   re-keyed and re-sorted here rather than trusted, so a shuffled array scores
 *   identically to an ordered one.
 * @param options.commitment the stored commitment record
 *   (`shiplog-finops-commitment/1.0.0`): `commitmentId`, `claim.period` — the
 *   period committed FROM — `claim.monthlySavingsMinor`, and `periodId`, whose
 *   qualifier is the scope it was made under.
 * @param options.followUpPeriod the period the reader intends this commitment to
 *   be judged on. Taken as an argument rather than derived from the commitment,
 *   because "the month after" is the caller's claim about what it imported and
 *   the gap between the two is exactly what is checked.
 * @param options.seriesScope the scope the series was read under. Compared
 *   against the commitment's own; a mismatch abstains.
 * @returns a deeply frozen verdict. Never throws, and never returns null.
 */
export function scoreCommittedSaving({
  series, commitment, followUpPeriod = null, seriesScope = null,
} = {}) {
  const entries = periodSeriesFromTotals(series);
  const read = readCommitment(commitment);
  const followUp = canonicalPeriod(followUpPeriod);
  const commitmentScope = verdictScope(commitment?.periodId);
  const scope = verdictScope(seriesScope);
  const seriesPeriods = entries.map((entry) => entry.period);

  const reasons = [];
  if (!read) reasons.push(ABSTENTION_REASON.commitmentUnreadable);
  // An UNSTATED scope is not a matching scope. Treating null as "matches
  // anything" would let a caller that forgot to say which books it read score a
  // commitment against somebody else's months and never be told.
  if (scope !== commitmentScope) reasons.push(ABSTENTION_REASON.scopeMismatch);
  // The gap rule, stated once: the follow-up must be the calendar month directly
  // after the committed one. A follow-up that precedes it, repeats it, or skips a
  // month all fail the same equality — no separate cases, no ordering to get
  // wrong.
  if (read && (followUp === null || followUp !== nextCalendarMonth(read.committedFrom))) {
    reasons.push(ABSTENTION_REASON.periodGapNotOneStep);
  }
  const committedEntry = read
    ? entries.find((entry) => entry.period === read.committedFrom) ?? null : null;
  const followUpEntry = followUp !== null
    ? entries.find((entry) => entry.period === followUp) ?? null : null;
  if (read && !committedEntry) reasons.push(ABSTENTION_REASON.committedPeriodMissing);
  if (!followUpEntry) reasons.push(ABSTENTION_REASON.followUpPeriodMissing);

  const found = [
    ...(read ? [supplied("committedSavingMinor", read.committedMinor,
      "commitment.claim.monthlySavingsMinor")] : []),
    ...(committedEntry ? [supplied("committedPeriodSpendMinor", seriesMinor(committedEntry.total),
      `series[${committedEntry.period}].total`)] : []),
    ...(followUpEntry ? [supplied("followUpPeriodSpendMinor", seriesMinor(followUpEntry.total),
      `series[${followUpEntry.period}].total`)] : []),
  ];

  const provenance = {
    commitmentId: read?.commitmentId ?? null,
    comparedPeriods: {
      committedFrom: committedEntry?.period ?? null,
      followUp: followUpEntry?.period ?? null,
      expectedFollowUp: read ? nextCalendarMonth(read.committedFrom) : null,
      claimedFollowUp: followUp,
    },
    scope: {
      series: scope,
      commitment: commitmentScope,
      matched: !reasons.includes(ABSTENTION_REASON.scopeMismatch),
    },
    seriesPeriods,
    periodCount: seriesPeriods.length,
    figures: found,
    missing: ABSTENTION_ORDER.filter((reason) => reasons.includes(reason)),
  };

  if (provenance.missing.length > 0) return abstain(provenance);

  const realizedMinor = seriesMinor(committedEntry.total) - seriesMinor(followUpEntry.total);
  const { committedMinor } = read;
  const deltaMinor = realizedMinor - committedMinor;
  const grade = gradeFor(realizedMinor, committedMinor);
  const band = bandFor(grade);
  // Ratios are for reading, never for grading: the grade above is already
  // decided on integers, so rounding here cannot move a verdict across a band.
  const realizedPercent = Math.round((realizedMinor * 100) / committedMinor);
  const relativeDeltaPercent = Math.round((deltaMinor * 100) / committedMinor);

  provenance.figures = [
    ...found,
    derived("realizedSavingMinor", realizedMinor,
      ["committedPeriodSpendMinor", "followUpPeriodSpendMinor"],
      "committed-month spend minus follow-up-month spend"),
    derived("deltaMinor", deltaMinor, ["realizedSavingMinor", "committedSavingMinor"],
      "realized saving minus committed saving, signed"),
    derived("relativeDeltaPercent", relativeDeltaPercent, ["deltaMinor", "committedSavingMinor"],
      "delta as a rounded percent of the committed saving; reported, never graded on", "percent"),
  ];

  return verdictShape({
    grade,
    gradeRule: band.rule,
    gradeAssumption: band.assumption,
    realizedSavingMinor: realizedMinor,
    realizedSavingUsd: usd(realizedMinor),
    committedSavingMinor: committedMinor,
    committedSavingUsd: usd(committedMinor),
    deltaMinor,
    deltaUsd: usd(deltaMinor),
    realizedPercentOfCommitted: realizedPercent,
    relativeDeltaPercent,
    explanation: gradeSentence({
      grade,
      committedFrom: committedEntry.period,
      followUp: followUpEntry.period,
      realizedMinor,
      committedMinor,
      deltaMinor,
      realizedPercent,
    }),
    provenance,
  });
}

function abstain(provenance) {
  // The committed figure survives an abstention when the record carried one: it
  // is what the reader committed to, and withholding it would make an honest
  // abstention read as a lost commitment.
  const committed = provenance.figures
    .find((figure) => figure.name === "committedSavingMinor")?.value ?? null;
  return verdictShape({
    grade: VERDICT_GRADE.notEnoughEvidence,
    committedSavingMinor: committed,
    committedSavingUsd: committed === null ? null : usd(committed),
    reasons: provenance.missing,
    explanation: abstentionSentence(provenance),
    provenance,
  });
}

/* ------------------------------- the sentences ----------------------------- */

const WORD = Object.freeze({
  [VERDICT_GRADE.met]: "Met",
  [VERDICT_GRADE.partiallyMet]: "Partially met",
  [VERDICT_GRADE.missed]: "Missed",
});

/** The grade in words: both months, both figures, and the gap between them. */
function gradeSentence({
  grade, committedFrom, followUp, realizedMinor, committedMinor, deltaMinor, realizedPercent,
}) {
  const movement = realizedMinor === 0 ? "did not move"
    : realizedMinor > 0 ? `fell ${formatUsd(usd(realizedMinor))}`
      : `rose ${formatUsd(usd(-realizedMinor))}`;
  const against = deltaMinor === 0 ? "exactly the committed figure"
    : deltaMinor > 0 ? `${formatUsd(usd(deltaMinor))} more than committed`
      : `${formatUsd(usd(-deltaMinor))} short of the committed figure`;
  return `${WORD[grade]}. Between ${committedFrom} and ${followUp}, total spend ${movement} `
    + `against a committed ${formatUsd(usd(committedMinor))} monthly saving — `
    + `${realizedPercent}% of it, ${against}. ${bandFor(grade).rule} `
    + `${bandFor(grade).boundary}`;
}

/** The abstention in words: every condition that fired, named. */
function abstentionSentence(provenance) {
  const conditions = provenance.missing
    .map((reason) => `${reason} (${ABSTENTION_STATEMENT[reason]})`).join("; ");
  const seen = provenance.periodCount === 0
    ? "no month at all"
    : `${provenance.periodCount} month${provenance.periodCount === 1 ? "" : "s"}: `
      + provenance.seriesPeriods.join(", ");
  return "Not enough evidence to grade this commitment. The series holds "
    + `${seen}. No grade is computed because ${conditions}. A grade computed anyway would be a `
    + "number about a comparison that was never made.";
}
