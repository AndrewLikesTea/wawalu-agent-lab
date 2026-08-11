// Coming back a month later, in one step.
//
// THE WORKFLOW THIS MODELS
// -----------------------
// A reader who analysed a month, downloaded the portable record, and came back
// in September has everything the page needs except September's total. This
// module turns that file plus one number into one decisive answer, and it owns
// no decoding, no compatibility rule, and no verdict boundary of its own:
//
//   - the file is read by finops-portable-record.js (the merged codec);
//   - a declaration is graded by that codec's `declarationCompatibility`;
//   - the verdict, the benchmark, and the evidence threshold come from
//     two-period-commitment-evaluator.js.
//
// What is genuinely here is the sequencing: which parts of a record may be
// prefilled, what a month adds, and which single action follows from the answer.
//
// PREFILL IS NOT THE SAME QUESTION AS IMPORT
// ------------------------------------------
// The atomic import refuses a whole file when any declaration is unreusable,
// which is right for a store that replaces four keys at once. Prefill is
// narrower: a record can carry one source whose figures may be reused and one
// whose may not, and holding back only the second is the difference between a
// reader continuing and a reader starting over. So each declaration is graded on
// its own, an unreusable one is named with the reason it failed, and its figures
// stay out of the arithmetic until the reader says otherwise.

import {
  PORTABLE_IMPORT_FAILURE, declarationCompatibility, parseFinopsPortableRecord,
} from "./finops-portable-record.js";
import {
  buildRedactedTwoPeriodInput, evaluateTwoPeriodCommitment,
} from "./two-period-commitment-evaluator.js";
import { nextCalendarMonth } from "./commitment-verification.js";
import { VERDICT_GRADE } from "./committed-saving-verdict.js";

export const FINOPS_RETURN_VERSION = "finops-month-return/1.0.0";

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * One sentence per refusal, and three different errands.
 *
 * Re-choose the file, re-export it, or correct it: a reader told only "import
 * failed" has to guess which, and two of the three guesses waste a trip back to
 * the browser that wrote the record.
 */
export const RETURN_REFUSAL = Object.freeze({
  [PORTABLE_IMPORT_FAILURE.unreadable]: "That file could not be read as JSON text. Choose the "
    + "FinOps JSON this page downloaded — a spreadsheet, a PDF, or a raw provider export is not "
    + "this file. Nothing in this browser changed.",
  [PORTABLE_IMPORT_FAILURE.unsupportedVersion]: "That file is a FinOps record this page cannot "
    + "read. Open it in the browser that wrote it and download it again, then choose it here. "
    + "Nothing in this browser changed.",
  [PORTABLE_IMPORT_FAILURE.invalidRecord]: "That file is a FinOps record, but its contents do not "
    + "match the record contract, so no figure in it can be trusted. Correct it on this computer "
    + "and choose it again. Nothing in this browser changed.",
});

/** Which figures each declared source stands behind, named for a reader. */
export const RETURN_SOURCE_FIGURES = Object.freeze({
  provider: "the retained monthly totals and the commitment made against them",
  hris: "the org-unit display labels",
});

/** The two wordings, deliberately different: one is old, the other is wrong. */
const REVIEW_WORDING = Object.freeze({
  stale: "Stale",
  unsupported: "Incompatible",
});

const REVIEW_WHY = Object.freeze({
  stale: "was exported against an older mapping, so its figures may not mean what this page would "
    + "read them as",
  unsupported: "declares a contract this page does not support, so its figures cannot be read at "
    + "all",
});

export const usdOf = (minor) => `${(Math.round(Number(minor)) / 100).toLocaleString("en-US", {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})} USD`;

/**
 * A typed total into whole minor units, or null.
 *
 * Grouping separators are accepted because a reader copying a figure out of a
 * console brings them; anything else is refused rather than coerced, because a
 * silently-zeroed month would be scored as a commitment that worked perfectly.
 */
export function parseSpendInput(text) {
  const cleaned = String(text ?? "").trim().replace(/[\s,_]/g, "").replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

/** Read the chosen file. One refusal code, one sentence, no file content echoed. */
export function readReturnFile(text) {
  const parsed = parseFinopsPortableRecord(text);
  if (parsed.ok) return Object.freeze({ ok: true, parsed });
  return Object.freeze({
    ok: false,
    code: parsed.code,
    message: RETURN_REFUSAL[parsed.code] ?? RETURN_REFUSAL[PORTABLE_IMPORT_FAILURE.invalidRecord],
    detail: parsed.errors[0] ?? null,
  });
}

const scopeOf = (record) => {
  const id = record.periods.at(-1)?.periodId ?? "";
  const qualifier = id.includes(":") ? id.slice(0, id.indexOf(":")) : "";
  return qualifier || "user";
};

/**
 * What a valid record offers, and what it is holding back.
 *
 * @param now injectable clock, used only to name the month a record with no
 *   prior month would be adding. Nothing else here reads a clock.
 */
export function planReturn(parsed, { now = new Date() } = {}) {
  const record = parsed.record;
  const graded = record.sourceDeclarations.map(declarationCompatibility);
  const months = [...record.periods].sort((a, b) => a.period.localeCompare(b.period));
  const priorMonth = months.at(-1)?.period ?? null;
  return Object.freeze({
    version: FINOPS_RETURN_VERSION,
    recordVersion: record.schemaVersion,
    scope: scopeOf(record),
    months: Object.freeze(months),
    priorMonth,
    nextMonth: priorMonth ? nextCalendarMonth(priorMonth) : now.toISOString().slice(0, 7),
    reusable: Object.freeze(graded.filter((entry) => entry.reusable)),
    review: Object.freeze(graded.filter((entry) => !entry.reusable).map((entry) => Object.freeze({
      ...entry,
      wording: REVIEW_WORDING[entry.state] ?? REVIEW_WORDING.unsupported,
      why: REVIEW_WHY[entry.state] ?? REVIEW_WHY.unsupported,
      holds: RETURN_SOURCE_FIGURES[entry.role] ?? "figures in this record",
    }))),
    prefill: Object.freeze({
      periods: months.length,
      labels: Object.keys(record.labels).length,
      declaredRates: record.declaredRates.length,
      commitments: record.commitmentInputs.approvedCommitments.length,
    }),
    commitments: Object.freeze(record.commitmentInputs.approvedCommitments),
  });
}

/** Is this source's contribution allowed into the arithmetic yet? */
export function sourceUsable(plan, role, approvedRoles = []) {
  const held = plan.review.find((entry) => entry.role === role);
  return !held || approvedRoles.includes(role);
}

const VERDICT_HEADLINE = Object.freeze({
  [VERDICT_GRADE.met]: "Commitment met",
  [VERDICT_GRADE.partiallyMet]: "Commitment partly met",
  [VERDICT_GRADE.missed]: "Commitment missed",
  [VERDICT_GRADE.notEnoughEvidence]: "No comparison available",
});

const NEXT_BY_VERDICT = Object.freeze({
  [VERDICT_GRADE.met]: {
    headline: "Commit the next month's saving",
    why: "The committed saving landed, so the routing change behind it is worth extending rather "
      + "than re-arguing.",
  },
  [VERDICT_GRADE.partiallyMet]: {
    headline: "Close the gap before committing again",
    why: "Part of the committed saving landed. Find what the rest was spent on before a second "
      + "commitment is made against the same route.",
  },
  [VERDICT_GRADE.missed]: {
    headline: "Reopen the commitment that missed",
    why: "The committed saving did not land. The decision that made it needs revisiting before "
      + "any further month is committed.",
  },
  [VERDICT_GRADE.notEnoughEvidence]: {
    headline: "Add the missing month before asking for a verdict",
    why: "There is no comparable prior month under the same scope, so no honest verdict can be "
      + "given for this one.",
  },
});

/**
 * The commitment this month is judged against: the one made in the month
 * directly before it, under the same scope. Anything else is a different
 * question, and answering it here would produce a grade that looks real.
 */
function commitmentFor(plan, month) {
  return plan.commitments.find((entry) => nextCalendarMonth(entry.claim?.period) === month) ?? null;
}

/**
 * Add one month and answer with three claims and their evidence.
 *
 * The verdict, the benchmark percentages, and the reason an absent verdict is
 * absent are all read off the evaluator's result. Nothing here decides what
 * counts as material: that is the benchmark's missed floor, applied to the
 * benchmark's own committed saving.
 */
export function addReturnMonth(plan, { month, spendMinor, approvedRoles = [] } = {}) {
  if (!MONTH.test(String(month ?? ""))) {
    return Object.freeze({ ok: false, code: "invalid_month",
      message: "Name the month as a year and a month, like 2026-08, so it can be compared with the "
        + "month before it." });
  }
  if (!Number.isSafeInteger(spendMinor) || spendMinor < 0) {
    return Object.freeze({ ok: false, code: "invalid_spend",
      message: "Enter this month's total spend as an amount in US dollars, like 7430.50." });
  }
  const providerUsable = sourceUsable(plan, "provider", approvedRoles);
  const commitment = providerUsable ? commitmentFor(plan, month) : null;
  const prior = providerUsable
    ? plan.months.find((entry) => entry.period === commitment?.claim?.period) ?? null : null;

  let result = null;
  if (commitment && prior && Number.isSafeInteger(prior.analyzedSpendMinor)) {
    try {
      result = evaluateTwoPeriodCommitment(buildRedactedTwoPeriodInput({
        id: `${plan.scope}-return`,
        scope: plan.scope,
        commitmentId: commitment.commitmentId,
        commitmentPeriod: commitment.claim.period,
        savingMinor: commitment.claim.monthlySavingsMinor,
        periods: [
          { period: prior.period, spendMinor: prior.analyzedSpendMinor },
          { period: month, spendMinor },
        ],
        followUpPeriod: month,
      }));
    } catch {
      // A record that reached here past the codec but cannot be shaped into the
      // evaluator's closed input is an absent verdict, not a hollow one.
      result = null;
    }
  }
  return Object.freeze({ ok: true, summary: summarize({
    plan, month, spendMinor, result, prior, commitment, providerUsable, approvedRoles,
  }) });
}

function movementOf(result) {
  if (!result?.movement) {
    return Object.freeze({
      material: false,
      headline: "No month-over-month movement to measure",
      statement: "A movement is the difference between two comparable months, and only one of "
        + "them is on file under this scope.",
    });
  }
  const { benchmark, movement } = result;
  // Material is the benchmark's own missed floor, applied to the benchmark's own
  // committed saving. The page holds no threshold of its own.
  const material = movement.savingMinor * 100
    > benchmark.committedSavingMinor * benchmark.missedAtOrBelowPercent;
  const direction = movement.savingMinor >= 0 ? "below" : "above";
  return Object.freeze({
    material,
    percentOfBenchmark: movement.percentOfBenchmark,
    headline: material
      ? `Material movement: ${usdOf(Math.abs(movement.savingMinor))} ${direction} ${movement.fromPeriod}`
      : `Immaterial movement: ${usdOf(Math.abs(movement.savingMinor))} ${direction} ${movement.fromPeriod}`,
    statement: `That is ${movement.percentOfBenchmark}% of the ${usdOf(benchmark.committedSavingMinor)} `
      + `committed saving. Material here means above the benchmark's ${benchmark.missedAtOrBelowPercent}% `
      + `missed floor, and met is ${benchmark.metAtPercent}% or more.`,
  });
}

function summarize({ plan, month, spendMinor, result, prior, commitment, providerUsable, approvedRoles }) {
  const grade = result?.verdict.code ?? VERDICT_GRADE.notEnoughEvidence;
  const outstanding = plan.review.filter((entry) => !approvedRoles.includes(entry.role));
  const verdictStatement = result
    ? result.verdict.explanation
    : absenceReason({ plan, month, commitment, prior, providerUsable });
  const next = outstanding.length
    ? {
      headline: `Review the ${outstanding[0].role} source declaration`,
      why: `${outstanding[0].wording}: it ${outstanding[0].why}, so ${outstanding[0].holds} `
        + "stayed out of this answer.",
    }
    : NEXT_BY_VERDICT[grade];
  return Object.freeze({
    month,
    monthSpendMinor: spendMinor,
    verdict: Object.freeze({
      code: grade,
      comparable: Boolean(result?.evidenceThreshold.satisfied),
      headline: VERDICT_HEADLINE[grade],
      statement: verdictStatement,
    }),
    movement: movementOf(result),
    nextAction: Object.freeze({ ...next }),
    evidence: Object.freeze({
      recordVersion: plan.recordVersion,
      scope: plan.scope,
      contractVersion: result?.contractVersion ?? null,
      periods: Object.freeze([
        ...(prior ? [`${prior.period} · ${usdOf(prior.analyzedSpendMinor)} retained`] : []),
        `${month} · ${usdOf(spendMinor)} added now`,
      ]),
      declarations: Object.freeze([
        ...plan.reusable.map((entry) => `${entry.role} · reused · ${entry.message}`),
        ...plan.review.map((entry) => `${entry.role} · ${entry.wording.toLowerCase()} · `
          + `${approvedRoles.includes(entry.role) ? "used after review" : "held back"} · ${entry.message}`),
      ]),
      rule: result?.evidenceThreshold.rule ?? null,
      lines: Object.freeze([
        `Record ${plan.recordVersion}, ${plan.prefill.periods} prior month`
          + `${plan.prefill.periods === 1 ? "" : "s"}, ${plan.prefill.labels} label`
          + `${plan.prefill.labels === 1 ? "" : "s"}, ${plan.prefill.declaredRates} declared rate`
          + `${plan.prefill.declaredRates === 1 ? "" : "s"}.`,
        commitment
          ? `Judged against commitment ${commitment.commitmentId}, made in ${commitment.claim.period}.`
          : "No commitment was made in the month before this one.",
      ]),
    }),
  });
}

function absenceReason({ plan, month, commitment, prior, providerUsable }) {
  if (!providerUsable) {
    return "The provider declaration is held back for review, so this month has nothing "
      + "comparable to be measured against yet.";
  }
  if (!plan.months.length) {
    return "This record carries no prior month, so this is the first month on file and there is "
      + "nothing to compare it with.";
  }
  if (!commitment) {
    return `No commitment was made in the month before ${month}, so there is no committed saving `
      + "for this month to be judged against.";
  }
  if (!prior) {
    return `The committed month ${commitment.claim.period} is not retained in this record, so the `
      + "movement into this month cannot be measured.";
  }
  return "The evidence threshold was not met, so no verdict is given rather than a hollow one.";
}
