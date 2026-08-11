// One department's whole answer, addressable by slug.
//
// WHAT WAS MISSING. A lead who drilled into a department and forwarded the link
// sent an address the receiving page did not read. `?destination=…&department=…`
// is honoured (src/destination-route.js) and `?dept=…#workspace-departments` is
// honoured (src/finops-destination-router.js), but the bare `?department=backend`
// that survives a paste into a chat window resolved to nothing at all: the
// recipient landed on the organization answer and on whichever department
// happened to rank first. This module is the half of the fix that has no
// document in it — the address is turned into ONE record carrying the five facts
// a director asked the sender about, and src/finops-department-answer-view.js
// puts that record on screen.
//
// THE FIVE FACTS, and why exactly these. They are the four figures the
// department drill-down already publishes beside a name — the spend mix, the
// period-over-period trajectory, the peer position and the training gap the
// rubric's `inefficient` slice is defined to be — plus the intervention verdict
// the page states under them. A forwarded link that opens on a name and a score
// and makes the recipient press three more things to reach the argument is a
// link that was not worth forwarding.
//
// NOTHING HERE IS NEW ARITHMETIC. Every figure is `src/evolution.js`'s, called
// rather than restated: `departmentPerformance`, `departmentTrend`,
// `categorySpendUsd`, `normalizeMix`, `quartileLabel` and `actionPlanFor`
// already are this page's published rules, and a second module computing a
// second recoverable share would be a second answer to a question the page has
// answered once. What is added is the SELECTION — which department, from what
// the address said — and the bounded, serializable shape that selection returns.
//
// PURE. No DOM, no storage, no network, no clock, no randomness. Same record and
// same slug in, byte-identical record out, which is what lets the wiring be a
// dozen lines and the tests be a fixture.
//
// SERIALIZABLE. `JSON.parse(JSON.stringify(model))` deep-equals the model: every
// absent figure is an explicit `null` with a stated reason beside it, never
// `undefined`, and no timestamp is turned into a Date on the way through. A view
// model that does not survive a round trip is a view model that cannot be put in
// a message, a fixture or a bug report.
//
// IT NEVER THROWS. A slug is user input arriving off a URL somebody else wrote,
// so every refusal is a returned reason and a sentence — `null`, a number, an
// array, a control character, a kilobyte of junk and a record with no
// departments at all are five ordinary inputs here, not five stack traces.

import {
  QUERY_CATEGORIES, actionPlanFor, categorySpendUsd, departmentPerformance,
  departmentTrend, normalizeMix, quartileLabel,
} from "./evolution.js";

/** Bump when a field, a reason or the shape of the model below changes. */
export const DEPARTMENT_ANSWER_VERSION = "finops-department-answer/1.0.0";

/** The query parameter a forwarded department link is written with. */
export const DEPARTMENT_PARAM = "department";

/**
 * The longest slug this page will look at. The vocabulary's longest is nine
 * characters; 64 is the same ceiling `record.labels` keeps in
 * src/finops-portable-record.js, so an oversized value is refused by a stated
 * limit rather than by whatever the first regular expression happened to do.
 */
export const DEPARTMENT_SLUG_MAX = 64;

/** What an address can be wrong about. Three errands, so three reasons. */
export const DEPARTMENT_REFUSAL = Object.freeze({
  unknown: "unknown-department",
  missing: "missing-department",
  malformed: "malformed-department",
});

/** The shape of a slug once it is normalized: the one this analysis speaks. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const CONTROL_GLOBAL = /[\u0000-\u001f\u007f]/g;

const array = (value) => (Array.isArray(value) ? value : []);
const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
const money = (value) => (finite(value) === null ? null : Math.round(Number(value)));

/**
 * The requested value as a reader can be shown it, clamped.
 *
 * Echoing what the link asked for is the difference between "that department is
 * not here" and "which department did I ask for?" — but the value came off a
 * URL, so it is clamped here and written with `textContent` there.
 */
function echo(value) {
  if (typeof value === "string") {
    const flat = value.replace(CONTROL_GLOBAL, " ").trim();
    return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
  }
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return "a list";
  return typeof value === "object" ? "an object" : String(value).slice(0, 60);
}

/**
 * The refusal a reader is shown, in a director's words.
 *
 * Same construction as `routeFailureMessage` in src/destination-route.js — what
 * the link asked for, what is true, and what is on screen instead — because a
 * page that explains two failures in two voices reads as two pages.
 */
export function departmentRefusalMessage(reason, requested) {
  const asked = echo(requested);
  if (reason === DEPARTMENT_REFUSAL.unknown) {
    return `That link asked for a department called “${asked}”. This analysis does not `
      + "have one, so the whole-organization answer is on screen instead.";
  }
  if (reason === DEPARTMENT_REFUSAL.malformed) {
    return asked
      ? `That link asked for a department called “${asked}”, which is not how a `
        + "department is named here. The whole-organization answer is on screen instead."
      : "That link asked for a department in a form this page cannot read. "
        + "The whole-organization answer is on screen instead.";
  }
  return "That link did not say which department to open, so the whole-organization "
    + "answer is on screen.";
}

const refuse = (reason, requested) => Object.freeze({
  resolved: false, reason, requested: typeof requested === "string" ? echo(requested) : null,
  message: departmentRefusalMessage(reason, requested),
});

/**
 * A raw address value reduced to a slug, or the reason it is not one.
 *
 * Trimmed, lowercased, and percent-decoding tolerated once: `?department=%20Backend`
 * and `?department=BACKEND%20` are the same forwarded link as `?department=backend`,
 * and a reader who pasted one of them did not make a different request. Decoding
 * happens before the charset check so an encoded control character cannot walk
 * in behind its own escape.
 */
export function normalizeDepartmentSlug(requested) {
  if (requested === null || requested === undefined) {
    return { slug: null, reason: DEPARTMENT_REFUSAL.missing };
  }
  if (typeof requested !== "string") {
    return { slug: null, reason: DEPARTMENT_REFUSAL.malformed };
  }
  if (requested.length > DEPARTMENT_SLUG_MAX) {
    return { slug: null, reason: DEPARTMENT_REFUSAL.malformed };
  }
  let decoded = requested;
  try {
    decoded = decodeURIComponent(requested.replace(/\+/g, " "));
  } catch {
    return { slug: null, reason: DEPARTMENT_REFUSAL.malformed };
  }
  if (CONTROL_PATTERN.test(decoded)) return { slug: null, reason: DEPARTMENT_REFUSAL.malformed };
  const slug = decoded.trim().toLowerCase();
  // An empty or whitespace-only value is what a form submits when nobody chose
  // anything. It is the absent case, not a wrong one.
  if (!slug) return { slug: null, reason: DEPARTMENT_REFUSAL.missing };
  if (slug.length > DEPARTMENT_SLUG_MAX || !SLUG_PATTERN.test(slug)) {
    return { slug: null, reason: DEPARTMENT_REFUSAL.malformed };
  }
  return { slug, reason: null };
}

/**
 * Every department slug a record carries, in the order the record carries them.
 *
 * THE SINGLE SOURCE OF TRUTH for the vocabulary. src/finops-destinations.js
 * imports it rather than restating seven strings, so the workspace index, the
 * route allowlist and this deep link cannot drift apart — a department added to
 * the analysis is addressable the moment it is analysed.
 *
 * Two collections are read, because two records in this repository name
 * departments: the analysis record's `departments[].id`, and the portable
 * record's `periods[].departmentAllocations[].departmentId`
 * (src/finops-portable-record.js), which is the same vocabulary written for a
 * file that carries derived money and no drill-down. Document order, first
 * appearance wins, duplicates dropped — deterministic without imposing an
 * alphabetical order the analysis did not choose.
 */
export function listDepartmentSlugs(record) {
  const seen = new Set();
  const slugs = [];
  const add = (value) => {
    const { slug } = normalizeDepartmentSlug(value);
    if (!slug || seen.has(slug)) return;
    seen.add(slug);
    slugs.push(slug);
  };
  for (const department of array(record?.departments)) add(department?.id);
  for (const period of array(record?.periods)) {
    for (const row of array(period?.departmentAllocations)) add(row?.departmentId);
  }
  return Object.freeze(slugs);
}

/**
 * The department vocabulary the bundled analysis ships, as a record.
 *
 * It is here rather than in src/finops-destinations.js because the slugs and the
 * rule for reading them belong together: the registry used to author its own
 * literal beside a comment promising it matched the seed, and two authorities
 * for one published vocabulary disagree the first time one is edited. The
 * registry now imports `FINOPS_DEPARTMENT_SLUGS` below, and
 * tests/finops-destinations.test.js still pins the result against
 * src/evolution-demo-data.json — the seed cannot be imported here, because it is
 * fetched at runtime and pulling it into the module graph would put the whole
 * analysis in the initial payload of /evolution.html.
 */
export const BUNDLED_DEPARTMENT_RECORD = Object.freeze({
  departments: Object.freeze([
    "data-ml", "backend", "frontend", "sre", "mobile", "quality", "security",
  ].map((id) => Object.freeze({ id }))),
});

/** The vocabulary itself, read by the same function every record is read by. */
export const FINOPS_DEPARTMENT_SLUGS = listDepartmentSlugs(BUNDLED_DEPARTMENT_RECORD);

/**
 * Read the forwarded parameter off a query string without a URL parser.
 *
 * Returns the RAW value, so the caller can tell "the link carried nothing" from
 * "the link carried something this page refused" — `null` for absent, a string
 * (possibly empty) for present. Accepts a string, a Location, or anything with
 * a `search`; never throws.
 */
export function readDepartmentParam(input) {
  const text = typeof input === "string" ? input : input?.search ?? null;
  if (typeof text !== "string") return null;
  const query = text.startsWith("?") ? text.slice(1) : text;
  for (const pair of query.split("&")) {
    if (!pair) continue;
    const index = pair.indexOf("=");
    const name = index < 0 ? pair : pair.slice(0, index);
    if (name !== DEPARTMENT_PARAM) continue;
    return index < 0 ? "" : pair.slice(index + 1);
  }
  return null;
}

/**
 * Resolve one requested value against one record. Discriminated, never thrown.
 *
 * `{ resolved: true, slug }` or `{ resolved: false, reason, requested, message }`.
 * A record with no departments collection at all resolves nothing and says so as
 * `unknown` — the address was well-formed; it is this analysis that is empty.
 */
export function resolveDepartmentSlug(record, requested) {
  const { slug, reason } = normalizeDepartmentSlug(requested);
  if (!slug) return refuse(reason, requested);
  if (!listDepartmentSlugs(record).includes(slug)) {
    return refuse(DEPARTMENT_REFUSAL.unknown, requested);
  }
  return Object.freeze({ resolved: true, slug });
}

/** The department record itself, matched on the normalized slug. */
function departmentRecord(record, slug) {
  return array(record?.departments)
    .find((entry) => normalizeDepartmentSlug(entry?.id).slug === slug) ?? null;
}

/**
 * The spend mix: four categories, one row each, in the rubric's own order.
 *
 * Shares are normalized before they are read, so a mix that arrived as raw
 * counts or drifted a fraction off 1 states the same percentages the score was
 * computed from. Each row carries the money as well as the share: a director
 * arguing about a slice argues about its dollars.
 */
function spendMixOf(department) {
  const performance = departmentPerformance(department);
  const shares = normalizeMix(department?.mix);
  const rows = QUERY_CATEGORIES.map((category) => Object.freeze({
    key: category.key,
    label: category.label,
    share: Math.round(shares[category.key] * 1000) / 1000,
    spendUsd: money(categorySpendUsd(department, category.key)) ?? 0,
    recoverableUsd: money(categorySpendUsd(department, category.key) * category.recoverableShare) ?? 0,
  }));
  const largest = [...rows].sort((a, b) => b.share - a.share || (a.key < b.key ? -1 : 1))[0];
  return Object.freeze({
    available: performance.available,
    reason: performance.available ? null : performance.reason,
    scoredQueries: finite(department?.sampling?.sampledQueries),
    score: performance.available ? performance.score : null,
    uncertaintyPoints: performance.available ? performance.uncertaintyPoints : null,
    rows: Object.freeze(rows),
    largestKey: largest?.key ?? null,
  });
}

/** Period over period: the money, the points, and whether both went the wrong way. */
function trajectoryOf(department) {
  const trend = departmentTrend(department);
  const current = money(department?.spendUsd);
  const previous = money(department?.previousPeriod?.spendUsd);
  return Object.freeze({
    available: trend.costAvailable,
    reason: trend.costAvailable ? null : "No prior period with a spend basis to compare against.",
    period: trend.period ?? null,
    comparisonPeriod: trend.comparisonPeriod ?? null,
    spendUsd: current,
    previousSpendUsd: previous,
    spendChangeUsd: current !== null && previous !== null ? current - previous : null,
    costChangePercent: trend.costChangePercent,
    performanceChangePoints: trend.performanceChangePoints,
    worsening: trend.worsening,
  });
}

/** Where the department sits against the external cohort, as a band and a number. */
function peerPositionOf(department) {
  const percentile = finite(department?.peerPercentile);
  return Object.freeze({
    available: percentile !== null,
    reason: percentile === null ? "No peer percentile is published for this department." : null,
    percentile,
    band: percentile === null ? null : quartileLabel(percentile),
  });
}

/**
 * The training gap, which is the rubric's `inefficient` slice and nothing else.
 *
 * Not a new judgement: src/evolution.js already declares that category's system
 * action to be "surfaced as a training gap for that team", and its recoverable
 * share to be the fraction training compresses rather than removes. Both are
 * read from the category record so a change to the rubric moves this figure.
 */
function trainingGapOf(department) {
  const category = QUERY_CATEGORIES.find((entry) => entry.key === "inefficient");
  const performance = departmentPerformance(department);
  const share = normalizeMix(department?.mix).inefficient;
  const spend = money(categorySpendUsd(department, "inefficient")) ?? 0;
  return Object.freeze({
    available: performance.available,
    reason: performance.available ? null : performance.reason,
    share: Math.round(share * 1000) / 1000,
    spendUsd: spend,
    recoverableUsd: Math.round(spend * category.recoverableShare),
    statement: category.systemAction,
  });
}

/** The reviewed intervention, bounded to the fields a forwarded link should carry. */
function interventionVerdictOf(department) {
  const plan = actionPlanFor(department);
  if (!plan.available) {
    return Object.freeze({
      available: false, reason: plan.reason ?? "No reviewed intervention for this department.",
      status: plan.status, statusLabel: plan.statusLabel, title: null, diagnosis: null,
      accountableRole: null, baselineUsd: null, targetUsd: null,
      estimatedSavingsUsd: null, realizedSavingsUsd: null, provenance: null,
    });
  }
  return Object.freeze({
    available: true,
    reason: null,
    status: plan.status,
    statusLabel: plan.statusLabel,
    title: plan.title ?? null,
    diagnosis: plan.diagnosis ?? null,
    accountableRole: plan.accountableRole ?? null,
    baselineUsd: money(plan.baselineUsd),
    targetUsd: money(plan.targetUsd),
    estimatedSavingsUsd: money(plan.estimatedSavingsUsd),
    realizedSavingsUsd: plan.realizedSavingsUsd === null ? null : money(plan.realizedSavingsUsd),
    provenance: plan.provenance ?? null,
  });
}

/**
 * ONE department's complete answer, or the reason there is not one.
 *
 * `{ resolved: true, slug, department }` where `department` is the serializable
 * model, or the same refusal record `resolveDepartmentSlug` returns. A slug that
 * a record lists only as a portable-record allocation resolves with its figures
 * marked unavailable and their reasons stated: an allocation carries recoverable
 * money and no mix, and answering half the question honestly beats refusing a
 * link the vocabulary says is valid.
 */
export function departmentAnswer(record, requested) {
  const resolution = resolveDepartmentSlug(record, requested);
  if (!resolution.resolved) return resolution;
  const department = departmentRecord(record, resolution.slug) ?? { id: resolution.slug };
  return Object.freeze({
    resolved: true,
    slug: resolution.slug,
    department: Object.freeze({
      version: DEPARTMENT_ANSWER_VERSION,
      slug: resolution.slug,
      name: typeof department.name === "string" && department.name.trim()
        ? department.name.trim() : resolution.slug,
      period: department.period ?? null,
      spendUsd: money(department.spendUsd),
      spendMix: spendMixOf(department),
      trajectory: trajectoryOf(department),
      peerPosition: peerPositionOf(department),
      trainingGap: trainingGapOf(department),
      interventionVerdict: interventionVerdictOf(department),
    }),
  });
}
