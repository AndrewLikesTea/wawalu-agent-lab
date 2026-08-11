// One department's whole decision, resolved from a record and a slug, as one
// JSON-serializable object.
//
// WHAT THIS FIXES. A director who is forwarded `/evolution.html?department=backend`
// arrived at the ORGANIZATION's answer and was told where to scroll. Every figure
// their own decision needs was already on the page — spend mix, trajectory, peer
// position, training gap, intervention verdict — but each one was computed by a
// different call site, at a different moment, into a different region, and the
// address bar reached none of them. So the forwarded link resolved to a page, not
// to an answer.
//
// This module is the one place that turns (record, slug) into that answer. The
// page calls it once on load; the destination registry calls it for the list of
// slugs an address may legally carry. Neither restates the other's list.
//
// RESOLUTION IS TOTAL. There is no input for which this throws and no input for
// which it returns nothing. An absent slug, a slug this record does not hold, a
// number, an object, `"  BACKEND  "`, `"../../etc/passwd"` and a 4 KiB string all
// return a well-formed model that carries `resolved: false` and a named reason.
// The one property that matters more than any of them: a slug that did not
// resolve NEVER carries another department's figures. `department` is null unless
// an entry of this record matched the normalized slug exactly.
//
// THE NORMALIZATION RULE, STATED ONCE. A slug is trimmed and lower-cased, and
// then it is either slug-shaped (`^[a-z0-9][a-z0-9-]{0,39}$`) or it is malformed.
// Nothing else is coerced: a non-string is malformed rather than stringified,
// because `String({})` is `"[object Object]"` and an address that carried an
// object did not name a department called that. The SAME rule is applied to the
// record's own ids in `departmentSlugs()`, so the list the registry publishes and
// the value the selector matches cannot drift by a capital letter.
//
// PURE. No DOM, no storage, no network, no clock, no randomness. Every figure is
// read from the record the caller hands in, through the same functions the
// drill-down has always used (src/evolution.js) and the same published scorer the
// monthly decision uses (src/department-intervention-scoring.js). Nothing here
// re-derives one of them and nothing here invents a figure they do not publish.
//
// COMMITTED FIXTURES ONLY. The record a caller passes is src/evolution-demo-data.json,
// the bundled synthetic example. No credential, no provider call and no reader's
// own file reaches this file.

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
import {
  INTERVENTION_OUTCOME, scoreDepartmentIntervention,
} from "./department-intervention-scoring.js";

/** Stamped on every model, so a consumer can branch on the shape it got. */
export const FINOPS_DEPARTMENT_VIEW_MODEL_VERSION = "finops-department-view-model/1.0.0";

/**
 * The query parameter a forwarded link carries.
 *
 * Restated rather than imported from src/destination-route.js on purpose: that
 * module imports the destination registry, and the registry imports THIS file for
 * its department ids, so importing it back would close a cycle whose evaluation
 * order decides whether the registry sees an initialised array. It is one word,
 * and tests/finops-department-view-model.test.js pins it against the router's own
 * constant, so a rename that reaches one and not the other fails.
 */
export const DEPARTMENT_PARAM = "department";

/**
 * The shape a slug may have after normalization. Anything else is malformed
 * rather than unknown — `../../etc/passwd` is not a department somebody retired,
 * and calling it one would put it in a "no longer in this analysis" sentence.
 */
const SLUG_SHAPE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Why a model fell back. Codes, so a caller branches on them, never on prose. */
export const DEPARTMENT_FALLBACK = Object.freeze({
  none: "none",
  noSlug: "no-slug",
  malformedSlug: "malformed-slug",
  unknownSlug: "unknown-slug",
  noDepartments: "no-departments",
});

/**
 * The one place every reader-facing fallback sentence is written.
 *
 * A copywriter revises this map without reading a line of resolution logic, and
 * resolution never composes a sentence of its own. Each string is short, plain,
 * and says the same two things: what this page could not do, and what it is
 * showing instead. None of them quotes the address back — see `echoOf` below.
 */
export const DEPARTMENT_FALLBACK_TEXT = Object.freeze({
  [DEPARTMENT_FALLBACK.none]: "",
  [DEPARTMENT_FALLBACK.noSlug]:
    "This link names no department, so none is chosen for you. Every department "
    + "in this analysis is ranked below.",
  [DEPARTMENT_FALLBACK.malformedSlug]:
    "The department in this link is not a name this analysis can look up, so no "
    + "figures are shown for it. Every department in this analysis is ranked below.",
  [DEPARTMENT_FALLBACK.unknownSlug]:
    "This analysis holds no department by that name, so no figures are shown for "
    + "it and none are guessed at. Every department it does hold is ranked below.",
  [DEPARTMENT_FALLBACK.noDepartments]:
    "This analysis holds no departments yet, so no department answer can be "
    + "stated. Import an export or reload to try again.",
});

/**
 * The one sentence a resolved forwarded link states, so ALL reader-facing copy in
 * this flow is in this file and a copywriter revises it without reading a line of
 * resolution logic. It names the department and says where the choice came from,
 * because a reader who did not send themselves the link is owed both.
 */
export const departmentResolvedText = (name) =>
  `Showing ${name}, chosen by the department named in this link.`;

const fallbackText = (reason) => DEPARTMENT_FALLBACK_TEXT[reason]
  ?? DEPARTMENT_FALLBACK_TEXT[DEPARTMENT_FALLBACK.unknownSlug];

/**
 * The department ids the bundled analysis holds, in the order it holds them.
 *
 * THIS IS THE SOURCE. It used to live in src/finops-destinations.js as a literal
 * beside the routes that use it, which meant the list an address is checked
 * against and the list this selector can resolve were two lists — and #1611's
 * workspace index made that a third surface reading the same seven strings. The
 * registry now imports this constant, and
 * tests/finops-department-view-model.test.js asserts it equals
 * `departmentSlugs(bundled seed)` field for field, so a department added to the
 * seed and not here (or here and not there) fails rather than shipping a deep
 * link to an empty drill-down.
 */
export const FINOPS_DEPARTMENT_SLUGS = Object.freeze([
  "data-ml", "backend", "frontend", "sre", "mobile", "quality", "security",
]);

/**
 * Trim, lower-case, and refuse anything that is not then slug-shaped.
 *
 * @returns {string|null} the normalized slug, or null for absent and malformed.
 *   The two are told apart by the caller, which knows whether a value was there
 *   at all; this function only answers "is this a usable slug".
 */
export function normalizeDepartmentSlug(value) {
  if (typeof value !== "string") return null;
  const slug = value.trim().toLowerCase();
  return SLUG_SHAPE.test(slug) ? slug : null;
}

/**
 * The `?department=` value of a query string, raw and un-normalized, or null.
 *
 * Raw on purpose: the difference between "no department was asked for" and "a
 * department was asked for and it is junk" is a difference the reader is owed,
 * and normalizing here would flatten the second into the first.
 */
export function departmentSlugFromSearch(search) {
  if (typeof search !== "string" && typeof search !== "object") return null;
  let params = null;
  try {
    params = new URLSearchParams(String(search ?? ""));
  } catch {
    return null;
  }
  return params.get(DEPARTMENT_PARAM);
}

/**
 * Every department slug this record can answer for, in record order.
 *
 * Normalized by the same rule the selector matches with, and de-duplicated: a
 * record carrying `Backend` and `backend` publishes one slug, because it can only
 * resolve to one department and a list that says otherwise is a list of links
 * that disagree with the page.
 */
export function departmentSlugs(record) {
  const list = Array.isArray(record?.departments) ? record.departments : [];
  const out = [];
  for (const entry of list) {
    const slug = normalizeDepartmentSlug(entry?.id);
    if (slug && !out.includes(slug)) out.push(slug);
  }
  return Object.freeze(out);
}

/** The record entry a normalized slug names, or null. Never a near match. */
function departmentFor(record, slug) {
  const list = Array.isArray(record?.departments) ? record.departments : [];
  return list.find((entry) => normalizeDepartmentSlug(entry?.id) === slug) ?? null;
}

/**
 * What the model is allowed to repeat back about the address.
 *
 * A slug-shaped value is echoed so a reader who mistyped one letter can see which
 * letter. Anything else is described rather than repeated: an address bar may not
 * put its own prose, its own markup or its own kilobyte into a sentence on this
 * page.
 */
function echoOf(raw) {
  return normalizeDepartmentSlug(raw);
}

/** Mix, as one row per category: the share, and what that share costs. */
function spendMixRows(department) {
  const shares = normalizeMix(department.mix);
  return QUERY_CATEGORIES.map((category) => Object.freeze({
    key: category.key,
    label: category.label,
    share: shares[category.key],
    shareText: formatPercent(shares[category.key], { digits: 1 }),
    spendUsd: categorySpendUsd(department, category.key),
    spendText: formatUsd(categorySpendUsd(department, category.key)),
    note: category.description,
  }));
}

/** Trajectory against the immediately preceding equal-length period. */
function trajectoryOf(department) {
  const trend = departmentTrend(department);
  if (!trend.costAvailable) {
    return Object.freeze({
      available: false,
      changePercent: null,
      comparisonPeriod: trend.comparisonPeriod ?? null,
      text: "No prior period of equal length sits beside this one, so no change is "
        + "stated rather than a change of zero.",
    });
  }
  const direction = trend.costChangePercent > 0 ? "up"
    : trend.costChangePercent < 0 ? "down" : "flat";
  const score = trend.performanceAvailable
    ? ` Prompt-literacy score moved ${trend.performanceChangePoints >= 0 ? "+" : "−"}`
      + `${Math.abs(trend.performanceChangePoints)} points over the same pair.`
    : " The prompt-literacy score is not comparable across this pair.";
  return Object.freeze({
    available: true,
    changePercent: trend.costChangePercent,
    comparisonPeriod: trend.comparisonPeriod ?? null,
    text: `Spend is ${direction} ${Math.abs(trend.costChangePercent)}% against `
      + `${trend.comparisonPeriod ?? "the preceding period"} (${trend.period ?? "current period"}).`
      + score,
  });
}

/** Peer position: the external cohort quartile, and the gap to its median. */
function peerPositionOf(department, benchmark) {
  const comparison = benchmarkComparison(department, benchmark ?? {});
  const quartile = quartileLabel(department.peerPercentile);
  const cohort = benchmark?.name ?? "the synthetic peer cohort";
  if (!comparison.available) {
    return Object.freeze({
      available: false,
      quartile,
      deltaPoints: null,
      text: `${quartile} of the external cohort. No score gap against ${cohort} is `
        + `stated: ${comparison.reason}`,
    });
  }
  const sense = comparison.deltaPoints > 0 ? "above"
    : comparison.deltaPoints < 0 ? "below" : "level with";
  return Object.freeze({
    available: true,
    quartile,
    deltaPoints: comparison.deltaPoints,
    text: `${quartile} of the external cohort, and ${Math.abs(comparison.deltaPoints)} `
      + `points ${sense} the median of ${benchmark.medianScore} in ${cohort}. The `
      + "quartile and the median are hand-authored synthetic fixtures, not a live "
      + "industry claim.",
  });
}

/**
 * The training-gap reading, kept separate from the intervention on purpose.
 *
 * Inefficient retry chains are the one category coaching addresses, and its
 * recoverable share is the rubric's, not this file's. A department whose largest
 * line is leakage or over-provisioning is told so here rather than sent to a
 * workshop that would not touch its bill.
 */
function trainingGapOf(department) {
  const category = QUERY_CATEGORIES.find((entry) => entry.key === "inefficient");
  const spendUsd = categorySpendUsd(department, "inefficient");
  const shareText = formatPercent(normalizeMix(department.mix).inefficient, { digits: 1 });
  const recoverableUsd = Math.round(spendUsd * category.recoverableShare);
  return Object.freeze({
    spendUsd,
    shareText,
    recoverableUsd,
    text: spendUsd === 0
      ? "No scored spend sits in repeated, chained re-prompts, so coaching has "
        + "nothing here to compress."
      : `${shareText} of scored spend — ${formatUsd(spendUsd)} a month — is repeated, `
        + `chained re-prompts. About ${formatUsd(recoverableUsd)} of that is what `
        + "coaching compresses; the underlying task remains and is not counted.",
  });
}

/**
 * The intervention verdict, from the published scorer rather than a second rule.
 *
 * Three of its four outcomes carry no recommendation, and each carries its own
 * reason. This flattens the scorer's result to what a forwarded reader needs —
 * the outcome, the move if there is one, and the sentence that earns it — and
 * changes no boundary: the scorer decides, this reads.
 */
function interventionOf(department) {
  const verdict = scoreDepartmentIntervention(department);
  const recommended = verdict.outcome === INTERVENTION_OUTCOME.recommended;
  const recommendation = recommended ? verdict.recommendation : null;
  return Object.freeze({
    version: verdict.version,
    outcome: verdict.outcome,
    recommended,
    title: recommendation?.title ?? null,
    action: recommendation?.action ?? null,
    estimatedMonthlyValueUsd: recommendation?.estimatedMonthlyValueUsd ?? null,
    confidence: recommendation?.confidence?.level ?? null,
    text: recommended ? recommendation.rationale.text : (verdict.reason?.text ?? ""),
    reasonCode: verdict.reason?.code ?? null,
  });
}

/** A model with no department in it, carrying the reason there is none. */
function fallbackModel(record, reason, raw) {
  return Object.freeze({
    version: FINOPS_DEPARTMENT_VIEW_MODEL_VERSION,
    resolved: false,
    requestedSlug: echoOf(raw),
    slug: null,
    name: null,
    period: null,
    fallback: Object.freeze({
      reason,
      text: fallbackText(reason),
    }),
    statusText: fallbackText(reason),
    spendUsd: null,
    recoverableUsd: null,
    spendMix: Object.freeze([]),
    trajectory: null,
    peerPosition: null,
    trainingGap: null,
    intervention: null,
    availableSlugs: departmentSlugs(record),
  });
}

/**
 * One department's decision, or the reason there is not one.
 *
 * @param {object} record the versioned analysis record — `departments` and
 *   `benchmark` as src/evolution-demo-data.json publishes them. Anything else,
 *   including null, resolves to the `no-departments` fallback.
 * @param {*} slug whatever the address bar carried, in whatever type it carried
 *   it. Normalized here and nowhere else.
 * @returns a frozen, JSON-serializable model. Never throws.
 */
export function departmentViewModel(record, slug) {
  const slugs = departmentSlugs(record);
  if (slugs.length === 0) return fallbackModel(record, DEPARTMENT_FALLBACK.noDepartments, slug);
  if (slug === null || slug === undefined || (typeof slug === "string" && slug.trim() === "")) {
    return fallbackModel(record, DEPARTMENT_FALLBACK.noSlug, null);
  }

  const normalized = normalizeDepartmentSlug(slug);
  if (normalized === null) return fallbackModel(record, DEPARTMENT_FALLBACK.malformedSlug, slug);

  const department = departmentFor(record, normalized);
  if (!department) return fallbackModel(record, DEPARTMENT_FALLBACK.unknownSlug, slug);

  const recoverableUsd = recoverableSpendUsd(department);
  const name = typeof department.name === "string" && department.name.trim() !== ""
    ? department.name : normalized;
  return Object.freeze({
    version: FINOPS_DEPARTMENT_VIEW_MODEL_VERSION,
    resolved: true,
    requestedSlug: normalized,
    slug: normalized,
    name,
    period: department.period ?? null,
    fallback: null,
    statusText: departmentResolvedText(name),
    spendUsd: Number.isFinite(department.spendUsd) ? department.spendUsd : null,
    recoverableUsd,
    spendMix: Object.freeze(spendMixRows(department)),
    trajectory: trajectoryOf(department),
    peerPosition: peerPositionOf(department, record?.benchmark ?? null),
    trainingGap: trainingGapOf(department),
    intervention: interventionOf(department),
    availableSlugs: slugs,
  });
}
