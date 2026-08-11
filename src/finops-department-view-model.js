// One department's complete answer, as one plain object (#1612).
//
// WHAT THIS FIXES. A forwarded `evolution.html?department=<slug>` link landed a
// reader on the organization answer and left them to reassemble the department
// out of four separate regions: the spend mix in one, the trajectory in another,
// the peer rank behind a disclosure, the recommended intervention in a third.
// Nothing stated the five parts together, so "look at Quality" was still an
// instruction to go and read four things. This module is that statement: given a
// record and a slug it returns spend mix, trajectory, peer position, training
// gap and the intervention verdict, in one shape, from one pass over one record.
//
// NOTHING HERE IS RE-DERIVED. Every figure is `departmentScreenModel`'s, which
// is itself every figure `evolution.js` has published since the beginning. A
// second implementation of the recoverable share or the literacy score would be
// a second answer to a published question, and the two would disagree on the
// first rubric change. This module decides the SHAPE and the RESOLUTION, and
// nothing else.
//
// RESOLUTION IS TOTAL. A missing slug, an empty one, a non-string (an
// array-valued query parameter arrives that way), a slug shape no address bar
// should be able to put into a sentence, a slug this record does not hold, and a
// record that cannot be read at all all return the SAME shape: the org-level
// answer, a machine-readable `reasonCode`, and one sentence in reader
// vocabulary. It never throws, and it never answers a question about one
// department with another department's numbers — the fallback says "the whole
// organization" out loud rather than quietly ranking a substitute into the slot.
// Silently substituting is what turns a stale bookmark into a wrong decision,
// and no status code prevents it; only refusing to fill the slot does.
//
// PURE. No DOM, no storage, no network, no clock, no randomness. The caller
// hands in the record it already loaded. `JSON.parse(JSON.stringify(model))` is
// deep-equal to `model`, which is what lets the page, a shared brief and a unit
// test read the same five figures without three derivations of them.

import { departmentScreenModel, DEPARTMENT_SCREEN_STATE } from "./department-screen.js";
import { periodKeyOf } from "./department-verdict.js";
import {
  QUERY_CATEGORIES, categorySpendUsd, formatPercent, formatUsd, summarize,
} from "./evolution.js";

/** Stamped on every model, so a consumer can refuse a shape it cannot read. */
export const DEPARTMENT_VIEW_MODEL_VERSION = "finops-department-view-model/1.0.0";

/**
 * The department slugs this product publishes as addresses, in ranking order.
 *
 * THE CANONICAL LIST LIVES HERE and src/finops-destinations.js reads it, so the
 * workspace index, the destination registry, the selection ids in
 * src/finops-destination-regions.js and this selector cannot drift: there is one
 * list and one importer chain. It is authored rather than read off a record
 * because a registry must be answerable before any dataset is, and it is pinned
 * against src/evolution-demo-data.json by this module's own test — an
 * addressable department the bundled analysis does not hold is a link to an
 * empty drill-down, and that pin is what catches it.
 */
export const DEPARTMENT_SLUGS = Object.freeze([
  "data-ml", "backend", "frontend", "sre", "mobile", "quality", "security",
]);

/**
 * Every department id a record actually holds, in the record's own order.
 *
 * Deduplicated, because a record may hold the same department for two periods.
 */
export function knownDepartmentSlugs(record) {
  const list = Array.isArray(record?.departments) ? record.departments : [];
  const slugs = [];
  for (const entry of list) {
    const id = entry?.id;
    if (typeof id === "string" && id !== "" && !slugs.includes(id)) slugs.push(id);
  }
  return Object.freeze(slugs);
}

/**
 * Why a request resolved the way it did. Machine-readable, so a caller branches
 * on the code and never on the sentence — the sentence is copy and will be
 * rewritten by somebody whose job that is; the code is a contract.
 */
export const DEPARTMENT_RESOLUTION = Object.freeze({
  resolved: "resolved",
  missing: "no_department_named",
  malformed: "department_not_readable",
  unknown: "unknown_department",
  unreadable: "record_unreadable",
});

/** The two scopes an answer can be about. Never a third. */
export const ANSWER_SCOPE = Object.freeze({ department: "department", organization: "organization" });

/** What the fallback answer is called, everywhere it is named. */
const ORG_NAME = "the whole organization";

/**
 * A slug shape a URL may carry, so an address bar cannot put arbitrary prose
 * into a sentence a reader is shown. Anything else is "not readable as a
 * department name", which is true and is the only thing worth saying about it.
 */
const SLUG_SHAPE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/**
 * The longest requested value this module ever hands back. A URL can carry
 * kilobytes; a sentence quoting one is still a sentence somebody reads. Clamped
 * here rather than at the render, so the message, the log line and the test all
 * see the same bounded string.
 */
export const MAX_REQUESTED_SLUG_LENGTH = 60;

const clamp = (text) => (text.length > MAX_REQUESTED_SLUG_LENGTH
  ? `${text.slice(0, MAX_REQUESTED_SLUG_LENGTH - 1)}…`
  : text);

/**
 * Read a requested value into a slug, or say why it is not one.
 *
 * `requested` is what the reader's link asked for, clamped and never trusted
 * further than being quoted back; `slug` is null unless the value is shaped like
 * a department id this product could hold.
 */
export function normalizeRequestedSlug(value) {
  const answer = (code, requested = null, slug = null) =>
    Object.freeze({ code, requested, slug });
  if (value === null || value === undefined) return answer(DEPARTMENT_RESOLUTION.missing);
  if (typeof value !== "string") {
    // An array-valued `?department=a&department=b`, or anything else a caller
    // read out of a parsed query object. Not a name, and not guessed at.
    return answer(DEPARTMENT_RESOLUTION.malformed);
  }
  const trimmed = clamp(value.trim());
  if (trimmed === "") return answer(DEPARTMENT_RESOLUTION.missing);
  const lowered = trimmed.toLowerCase();
  if (!SLUG_SHAPE.test(lowered)) return answer(DEPARTMENT_RESOLUTION.malformed, trimmed);
  return answer(DEPARTMENT_RESOLUTION.resolved, trimmed, lowered);
}

/**
 * Resolve a requested value against a record. Total: every input produces the
 * same keys and none of them throws.
 *
 * `department` is the matched entry or null, and it is null in every branch but
 * `resolved`. Callers read `code`; nothing downstream may fall back to "the
 * first department" when this says no.
 */
export function resolveDepartment(record, value, { period = null } = {}) {
  const departments = Array.isArray(record?.departments) ? record.departments : [];
  const answer = (code, requested, slug, department = null) =>
    Object.freeze({ code, requested, slug, department });
  const read = normalizeRequestedSlug(value);
  if (!departments.length) {
    return answer(DEPARTMENT_RESOLUTION.unreadable, read.requested, null);
  }
  if (read.code !== DEPARTMENT_RESOLUTION.resolved) {
    return answer(read.code, read.requested, null);
  }
  // A named period this record does not hold is an unknown selection, not a
  // silent fall back to whichever month happened to be first: a link forwarded
  // for May must never be answered with June under May's address.
  const wantedPeriod = period ? periodKeyOf({ periodId: period }) : null;
  const forSlug = departments.filter(
    (entry) => String(entry?.id ?? "").toLowerCase() === read.slug);
  const department = wantedPeriod
    ? forSlug.find((entry) => periodKeyOf(entry) === wantedPeriod) ?? null
    : forSlug[0] ?? null;
  if (!department) return answer(DEPARTMENT_RESOLUTION.unknown, read.requested, read.slug);
  return answer(DEPARTMENT_RESOLUTION.resolved, read.requested, read.slug, department);
}

/**
 * The one sentence a reader is shown. One sentence on purpose: it sits above a
 * panel of figures, and a paragraph there is read as the answer rather than as
 * the reason the answer is the one below it.
 */
export function resolutionSentence(code, requested = null, name = null) {
  if (code === DEPARTMENT_RESOLUTION.resolved) {
    return `Showing ${name ?? "this department"}, the department this link named.`;
  }
  if (code === DEPARTMENT_RESOLUTION.unreadable) {
    return "The example analysis could not be read in this tab, so no department "
      + "figures are shown here.";
  }
  if (code === DEPARTMENT_RESOLUTION.unknown && requested) {
    return `There is no department called “${requested}” in this analysis, so the `
      + "answer below is for the whole organization.";
  }
  if (code === DEPARTMENT_RESOLUTION.missing) {
    return "This link did not say which department it meant, so the answer below "
      + "is for the whole organization.";
  }
  return "The department name in this link could not be read, so the answer "
    + "below is for the whole organization.";
}

/* -------------------------------- the parts -------------------------------- */

const part = (available, text) => Object.freeze({ available, text });

/** Mix, as one row per category: the share, and what that share costs. */
function mixRows(shares, spendOf) {
  return Object.freeze(QUERY_CATEGORIES.map((category) => Object.freeze({
    key: category.key,
    label: category.label,
    share: formatPercent(shares[category.key] ?? 0, { digits: 1 }),
    spend: formatUsd(spendOf(category.key)),
    note: category.description,
  })));
}

/** The whole organization's five parts, summed from the departments it holds. */
function organizationParts(record) {
  const departments = Array.isArray(record?.departments) ? record.departments : [];
  const totals = summarize(departments);
  const benchmark = record?.benchmark ?? null;
  const sumOf = (key) => departments.reduce(
    (total, entry) => total + categorySpendUsd(entry, key), 0);

  // Trajectory: only over the departments that carry a prior period of their
  // own, so a partial record states a change over the part it can compare
  // rather than a change of zero over the part it cannot.
  const comparable = departments.filter(
    (entry) => Number(entry?.previousPeriod?.spendUsd) > 0);
  const priorSpend = comparable.reduce(
    (total, entry) => total + Number(entry.previousPeriod.spendUsd), 0);
  const currentSpend = comparable.reduce(
    (total, entry) => total + (Number(entry?.spendUsd) || 0), 0);
  const changePercent = priorSpend > 0
    ? Math.round(((currentSpend - priorSpend) / priorSpend) * 1000) / 10 : null;
  const trajectory = changePercent === null
    ? part(false, "No prior period sits beside this one, so no change is stated "
      + "rather than a change of zero.")
    : part(true, `Spend across ${comparable.length} of ${departments.length} `
      + `departments is ${changePercent > 0 ? "up" : changePercent < 0 ? "down" : "flat"} `
      + `${Math.abs(changePercent)}% against the preceding period.`);

  const median = Number(benchmark?.medianScore);
  const cohort = benchmark?.name ?? "the synthetic peer cohort";
  const peerPosition = Number.isFinite(median)
    ? part(true, `The organization scores ${totals.score} against a median of `
      + `${median} in ${cohort}. The median is a hand-authored synthetic fixture, `
      + "not a live industry claim.")
    : part(false, `No score gap is stated: ${cohort} publishes no comparable median.`);

  const inefficient = QUERY_CATEGORIES.find((category) => category.key === "inefficient");
  const gapSpend = sumOf("inefficient");
  const trainingGap = gapSpend === 0
    ? part(false, "No scored spend sits in repeated, chained re-prompts, so "
      + "coaching has nothing here to compress.")
    : part(true, `${formatPercent(totals.mix.inefficient, { digits: 1 })} of scored `
      + `spend — ${formatUsd(gapSpend)} a month — is repeated, chained re-prompts. `
      + `About ${formatUsd(Math.round(gapSpend * inefficient.recoverableShare))} of `
      + "that is what coaching compresses; the underlying task remains and is not "
      + "counted.");

  return {
    headline: Object.freeze({
      label: "Recoverable AI spend per month",
      value: totals.recoverableUsd,
      display: formatUsd(totals.recoverableUsd),
      basis: `Summed over the ${departments.length} departments in this analysis, `
        + `out of ${formatUsd(totals.spendUsd)} analyzed. Synthetic example, not an invoice.`,
    }),
    spendMix: Object.freeze({
      available: totals.spendUsd > 0,
      basis: "Every department in this analysis, summed by category.",
      rows: mixRows(totals.mix, sumOf),
    }),
    trajectory,
    peerPosition,
    trainingGap,
    // No verdict is invented for a scope no rubric scores. The verdict is a
    // reading of ONE department for ONE period; stating an organization-wide
    // one here would be exactly the substitution this module exists to refuse.
    verdict: Object.freeze({
      available: false,
      value: null,
      confidence: null,
      detail: "An intervention verdict is given for one department at a time, and "
        + "this answer covers every department at once.",
      evidenceCount: null,
      basis: null,
      action: null,
    }),
  };
}

/** One resolved department's five parts, read off the screen model. */
function departmentParts(screen) {
  return {
    headline: Object.freeze({ ...screen.metric }),
    spendMix: Object.freeze({
      available: screen.disclosures.mix.length > 0,
      basis: screen.metric.basis,
      rows: Object.freeze(screen.disclosures.mix.map((row) => Object.freeze({ ...row }))),
    }),
    trajectory: part(true, screen.disclosures.trajectory),
    peerPosition: part(true, screen.disclosures.peer),
    trainingGap: part(true, screen.disclosures.trainingGap),
    verdict: Object.freeze({
      available: true,
      value: screen.verdict.value,
      confidence: screen.verdict.confidence,
      detail: screen.verdict.confidenceDetail,
      evidenceCount: screen.verdict.evidenceCount,
      basis: screen.verdict.basis,
      action: Object.freeze({
        headline: screen.action.headline,
        text: screen.action.text,
        worth: screen.action.worth,
      }),
    }),
  };
}

/**
 * The complete answer for one requested department, or the org-level answer and
 * the reason it is the one on screen.
 *
 * @param {object} record the analysis record — `departments` and `benchmark` as
 *   src/evolution-demo-data.json publishes them.
 * @param {*} requested whatever the address bar carried. Any type; never trusted.
 * @param {object} [options] `period` narrows a record that holds a department
 *   more than once.
 * @returns {object} a frozen, JSON-serializable model. Never throws.
 */
export function departmentViewModel(record, requested, { period = null } = {}) {
  const resolution = resolveDepartment(record, requested, { period });
  const departments = Array.isArray(record?.departments) ? record.departments : [];
  const screen = resolution.department
    ? departmentScreenModel({
      departments,
      benchmark: record?.benchmark ?? null,
      slug: resolution.slug,
      period: periodKeyOf(resolution.department),
    })
    : null;
  // Belt and braces: the screen model has its own unavailable states, and a
  // resolved slug that somehow does not compose one falls back rather than
  // rendering half an answer under a department's name.
  const ok = screen?.state === DEPARTMENT_SCREEN_STATE.resolved;
  const code = ok ? DEPARTMENT_RESOLUTION.resolved
    : resolution.code === DEPARTMENT_RESOLUTION.resolved
      ? DEPARTMENT_RESOLUTION.unknown : resolution.code;
  const parts = ok ? departmentParts(screen) : organizationParts(record);
  const name = ok ? screen.name : ORG_NAME;

  return Object.freeze({
    version: DEPARTMENT_VIEW_MODEL_VERSION,
    scope: ok ? ANSWER_SCOPE.department : ANSWER_SCOPE.organization,
    resolved: ok,
    reasonCode: code,
    sentence: resolutionSentence(code, resolution.requested, name),
    requestedSlug: resolution.requested,
    slug: ok ? resolution.slug : null,
    name,
    period: ok ? (resolution.department.period ?? null) : (departments[0]?.period ?? null),
    ...parts,
  });
}
