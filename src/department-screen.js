// One department's answer, composed from the model this repository already has.
//
// WHAT THIS ADDS, AND WHAT IT DELIBERATELY DOES NOT. Every figure below is read
// from src/evolution.js — the per-department view model the AI FinOps drill-down
// has computed since the beginning: `recoverableSpendUsd`, `recommendationFor`,
// `departmentTrend`, `benchmarkComparison`, `quartileLabel`, `normalizeMix`.
// Nothing here re-derives one of them, and nothing here invents a figure the
// drill-down does not already publish. What is new is the ARRANGEMENT: which
// single number leads, which single action follows it, and what waits behind a
// disclosure until a reader asks.
//
// WHY THAT ARRANGEMENT. A department lead arrives with one question — "is my
// team's AI spend recoverable, and what do I do first?" — and the drill-down
// answered it with a mix chart, a trend, a peer rank and a training-gap reading
// all at once, folded inside a disclosure on somebody else's page. Four numbers
// competing for one glance is no answer. Above the fold there is exactly one
// material metric (recoverable spend per month) and exactly one prioritized next
// action. Mix, trajectory, peer position and training gap are all still here,
// one disclosure each, in the order a reader who doubts the headline asks for
// them.
//
// DATA ONLY. No DOM, no storage, no network, no clock. The caller hands in the
// departments and the benchmark it already loaded; this module decides nothing
// about where they came from. That is what makes the unknown-department state
// testable without a page.
//
// COMMITTED FIXTURES ONLY. The one dataset a caller passes in is
// src/evolution-demo-data.json, the bundled synthetic example. No credential, no
// provider call, no customer record, and no reader's own file reaches this file.

import {
  QUERY_CATEGORIES,
  benchmarkComparison,
  categorySpendUsd,
  departmentTrend,
  formatPercent,
  formatUsd,
  normalizeMix,
  quartileLabel,
  recoverableSpendUsd,
} from "./evolution.js";
import { departmentVerdict, periodKeyOf } from "./department-verdict.js";
import { departmentSourceProvenance } from "./department-source-provenance.js";

/** The one question this screen exists to answer, stated once. */
export const DEPARTMENT_QUESTION =
  "Is my team’s AI spend recoverable, and what do I do first?";

/** The query parameter both directions of the round trip carry. */
export const DEPARTMENT_PARAM = "department";

/**
 * The optional second half of the address: which period is being answered for.
 *
 * A verdict is only a verdict for one department AND one period, so a forwarded
 * link that names a department an analysis holds twice has to say which month
 * it meant. Optional, because every link forwarded before this existed names no
 * period and must keep resolving: with none given the first record for that
 * department is answered, exactly as before.
 */
export const PERIOD_PARAM = "period";

/** This screen's own path, and the organization-wide answer it came from. */
export const DEPARTMENT_SCREEN_PATH = "/departments.html";
export const ORG_ANSWER_PATH = "/evolution.html";
export const ORG_ANSWER_FRAGMENT = "workspace-answer";

/**
 * A slug shape a URL may carry, so an address bar cannot put arbitrary text into
 * a sentence. Anything else is "not a department this analysis holds" — which is
 * true, and is the only thing worth saying about it.
 */
const SLUG_SHAPE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** The `?department=` value of a query string, or null. Never throws. */
export function departmentSlugFrom(search) {
  const raw = new URLSearchParams(String(search ?? "")).get(DEPARTMENT_PARAM);
  const slug = String(raw ?? "").trim().toLowerCase();
  return slug === "" ? null : slug;
}

/** The `?period=` value of a query string, as a period key, or null. */
export function periodSlugFrom(search) {
  const raw = new URLSearchParams(String(search ?? "")).get(PERIOD_PARAM);
  return periodKeyOf({ periodId: raw });
}

/** This screen's address for one department — the link evolution.html forwards. */
export function departmentScreenHref(slug, period = null) {
  if (!slug) return DEPARTMENT_SCREEN_PATH;
  const tail = period ? `&${PERIOD_PARAM}=${encodeURIComponent(period)}` : "";
  return `${DEPARTMENT_SCREEN_PATH}?${DEPARTMENT_PARAM}=${encodeURIComponent(slug)}${tail}`;
}

/**
 * The way back to the organization-wide answer, carrying the same selection.
 *
 * The query string sits before the fragment because that is what a URL is: a
 * fragment is the tail of the address, and putting `?department=` after it would
 * make the selection part of the fragment and lose it on arrival.
 */
export function orgAnswerHref(slug) {
  const query = slug ? `?${DEPARTMENT_PARAM}=${encodeURIComponent(slug)}` : "";
  return `${ORG_ANSWER_PATH}${query}#${ORG_ANSWER_FRAGMENT}`;
}

/** The three states this screen is ever in. */
export const DEPARTMENT_SCREEN_STATE = Object.freeze({
  pending: "pending",
  resolved: "resolved",
  unavailable: "unavailable",
});

/** Why an unavailable screen is unavailable. Each one gets its own sentence. */
export const DEPARTMENT_SCREEN_REASON = Object.freeze({
  noDepartment: "no-department",
  unknownDepartment: "unknown-department",
  loadFailed: "load-failed",
});

const REASON_TEXT = Object.freeze({
  [DEPARTMENT_SCREEN_REASON.noDepartment]:
    "This screen answers for one department and the address names none, so "
    + "nothing is guessed at. The organization-wide answer ranks every "
    + "department in this analysis, and it is one link away below.",
  [DEPARTMENT_SCREEN_REASON.unknownDepartment]:
    "The bundled example analysis holds no department by that name, so there is "
    + "no figure to state and none is invented. The organization-wide answer "
    + "ranks every department this analysis does hold, one link away below.",
  [DEPARTMENT_SCREEN_REASON.loadFailed]:
    "The bundled example analysis could not be read in this tab, so no "
    + "department figure can be stated. Nothing of yours was uploaded, read, or "
    + "stored. Reloading tries again, and the organization-wide answer is below.",
});

/**
 * The named problem, as a heading-length sentence.
 *
 * A slug is only quoted back when it is slug-shaped; anything else is described
 * rather than repeated, so no address bar can put its own prose on this screen.
 */
function unavailableTitle(reason, slug) {
  if (reason === DEPARTMENT_SCREEN_REASON.loadFailed) {
    return "This department’s figures could not be read";
  }
  if (reason === DEPARTMENT_SCREEN_REASON.noDepartment) {
    return "No department is named in this link";
  }
  return SLUG_SHAPE.test(String(slug ?? ""))
    ? `No department called “${slug}” is in this analysis`
    : "The department named in this link is not one this analysis holds";
}

/** The screen while its dataset is still in flight. */
export function pendingDepartmentScreen(slug = null) {
  return Object.freeze({
    state: DEPARTMENT_SCREEN_STATE.pending,
    reason: null,
    slug: slug ?? null,
    name: null,
    title: "Reading this department’s figures",
    status: "Reading the bundled example analysis for this department. "
      + "Nothing is uploaded and nothing is stored.",
    metric: null,
    verdict: null,
    action: null,
    sources: null,
    disclosures: null,
    backHref: orgAnswerHref(slug),
  });
}

/** The screen when there is nothing to answer with, and why. */
export function unavailableDepartmentScreen(reason, slug = null) {
  const named = REASON_TEXT[reason] ? reason : DEPARTMENT_SCREEN_REASON.loadFailed;
  return Object.freeze({
    state: DEPARTMENT_SCREEN_STATE.unavailable,
    reason: named,
    slug: slug ?? null,
    name: null,
    title: unavailableTitle(named, slug),
    status: `${unavailableTitle(named, slug)}. ${REASON_TEXT[named]}`,
    metric: null,
    verdict: null,
    action: null,
    sources: null,
    disclosures: null,
    // The way back is the org answer, and it still carries the selection: a
    // reader who mistyped one letter should not also lose which department they
    // were reading about.
    backHref: orgAnswerHref(slug),
  });
}

/** Mix, as one row per category: the share, and what that share costs. */
function mixRows(department) {
  const shares = normalizeMix(department.mix);
  return QUERY_CATEGORIES.map((category) => Object.freeze({
    key: category.key,
    label: category.label,
    share: formatPercent(shares[category.key], { digits: 1 }),
    spend: formatUsd(categorySpendUsd(department, category.key)),
    note: category.description,
  }));
}

/** Trajectory against the immediately preceding equal-length period. */
function trajectoryText(department) {
  const trend = departmentTrend(department);
  if (!trend.costAvailable) {
    return "No prior period of equal length sits beside this one, so no change "
      + "is stated rather than a change of zero.";
  }
  const direction = trend.costChangePercent > 0 ? "up" : trend.costChangePercent < 0 ? "down" : "flat";
  const score = trend.performanceAvailable
    ? ` Prompt-literacy score moved ${trend.performanceChangePoints >= 0 ? "+" : "−"}`
      + `${Math.abs(trend.performanceChangePoints)} points over the same pair.`
    : " The prompt-literacy score is not comparable across this pair.";
  return `Spend is ${direction} ${Math.abs(trend.costChangePercent)}% against `
    + `${trend.comparisonPeriod ?? "the preceding period"} (${trend.period ?? "current period"}).`
    + score;
}

/** Peer position: the external cohort quartile, and the gap to its median. */
function peerText(department, benchmark) {
  const comparison = benchmarkComparison(department, benchmark ?? {});
  const quartile = quartileLabel(department.peerPercentile);
  const cohort = benchmark?.name ?? "the synthetic peer cohort";
  if (!comparison.available) {
    return `${quartile} of the external cohort. No score gap against ${cohort} `
      + `is stated: ${comparison.reason}`;
  }
  const gap = comparison.deltaPoints;
  const sense = gap > 0 ? "above" : gap < 0 ? "below" : "level with";
  return `${quartile} of the external cohort, and ${Math.abs(gap)} points ${sense} `
    + `the median of ${benchmark.medianScore} in ${cohort}. The quartile and the `
    + "median are hand-authored synthetic fixtures, not a live industry claim.";
}

/**
 * The training-gap reading, kept separate from the action on purpose.
 *
 * Inefficient retry chains are the one category coaching addresses, and its
 * recoverable share is the rubric's, not this file's. A department whose largest
 * line is leakage or over-provisioning gets told so here rather than being sent
 * to a workshop that would not touch its bill.
 */
function trainingGapText(department) {
  const inefficient = QUERY_CATEGORIES.find((category) => category.key === "inefficient");
  const spend = categorySpendUsd(department, "inefficient");
  const share = formatPercent(normalizeMix(department.mix).inefficient, { digits: 1 });
  const recoverable = Math.round(spend * inefficient.recoverableShare);
  if (spend === 0) {
    return "No scored spend sits in repeated, chained re-prompts, so coaching has "
      + "nothing here to compress.";
  }
  return `${share} of scored spend — ${formatUsd(spend)} a month — is repeated, `
    + `chained re-prompts. About ${formatUsd(recoverable)} of that is what `
    + "coaching compresses; the underlying task remains and is not counted.";
}

/**
 * The whole screen for one slug.
 *
 * @param {object} input `departments` and `benchmark` as the bundled example
 *   publishes them, and the `slug` read off the address bar. `organization` and
 *   `provenance` are that same document's source declarations, passed through
 *   untouched so this screen states which exports the figure rests on without
 *   re-declaring them; `now` is the caller's date, never a clock read here.
 * @returns a frozen model in exactly one of the three states.
 */
export function departmentScreenModel({
  departments, benchmark = null, slug = null, period = null,
  organization = null, provenance = null, now = null,
} = {}) {
  const list = Array.isArray(departments) ? departments : [];
  if (!list.length) return unavailableDepartmentScreen(DEPARTMENT_SCREEN_REASON.loadFailed, slug);
  if (!slug) return unavailableDepartmentScreen(DEPARTMENT_SCREEN_REASON.noDepartment, slug);

  // A department, and — when the address names one — that department's period.
  // A named period this analysis does not hold is an unknown selection, not a
  // silent fall back to whichever month happened to be first: a CTO forwarded a
  // link to May must never be shown June under May's address.
  const forSlug = list.filter((entry) => String(entry?.id ?? "").toLowerCase() === slug);
  const department = period
    ? forSlug.find((entry) => periodKeyOf(entry) === period)
    : forSlug[0];
  if (!department) {
    return unavailableDepartmentScreen(DEPARTMENT_SCREEN_REASON.unknownDepartment, slug);
  }

  const recoverable = recoverableSpendUsd(department);
  // The verdict, the confidence and the evidence count come from the one
  // function the organization-wide review also calls. Nothing on this screen
  // re-derives them, so a forwarded deep link cannot state a next move the org
  // answer already refused to prioritize.
  const verdict = departmentVerdict(department);
  const name = department.name ?? "This department";
  const metric = Object.freeze({
    label: "Recoverable AI spend per month",
    value: recoverable,
    display: formatUsd(recoverable),
    basis: `${formatUsd(department.spendUsd)} analyzed for ${department.period ?? "the reporting month"}`
      + ", scored against this page's published recoverability rule. Synthetic example, not an invoice.",
  });

  return Object.freeze({
    state: DEPARTMENT_SCREEN_STATE.resolved,
    reason: null,
    slug,
    name,
    title: `${name} — one figure, one next move`,
    // The live region says the answer, not that an answer arrived. A reader who
    // is told "loaded" has been told about the page rather than about the money.
    status: `${name}: ${metric.display} of monthly AI spend is recoverable. `
      + `Verdict: ${verdict.verdict}`,
    metric,
    // The verdict block, in the words a CTO reads it in. The rubric line names
    // what scored this in reader vocabulary — no file, module, fixture or test
    // identifier reaches a rendered sentence on this screen.
    verdict: Object.freeze({
      label: "Intervention verdict",
      value: verdict.verdict,
      confidence: verdict.confidence,
      confidenceDetail: `Confidence: ${verdict.confidenceDetail}`,
      evidenceCount: verdict.evidenceCount,
      evidence: verdict.evidence,
      basis: verdict.rubricSentence,
    }),
    action: Object.freeze({
      label: "Do this first",
      headline: verdict.action
        ? `${formatPercent(verdict.action.shareOfScoredPrompts, { digits: 1 })} of ${name}’s `
          + `scored prompts are ${verdict.action.patternLabel}.`
        : verdict.reason ?? verdict.confidenceDetail,
      text: verdict.action ? verdict.action.text
        : "No next move is prioritized for this department and period.",
      worth: verdict.action && verdict.action.valueUsd > 0
        ? `Worth about ${formatUsd(verdict.action.valueUsd)} a month of the figure above.`
        : "No dollar value is claimed for this department.",
    }),
    // Which declared exports this department's figure rests on, projected from
    // the same declarations the organization-wide answer reads. Nothing here
    // grades, re-declares, or contacts a source.
    sources: departmentSourceProvenance({
      organization, provenance, departments: list, departmentId: slug,
      period: department.period ?? null, now,
    }),
    disclosures: Object.freeze({
      mix: Object.freeze(mixRows(department)),
      trajectory: trajectoryText(department),
      peer: peerText(department, benchmark),
      trainingGap: trainingGapText(department),
    }),
    backHref: orgAnswerHref(slug),
  });
}
