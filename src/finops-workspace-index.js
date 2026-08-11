// The first screen of /evolution.html read as an INDEX: one row per destination,
// each row saying what question that destination answers, how bad it is, and the
// one thing to do about it.
//
// WHAT WAS MISSING. The front door already named three destinations and the
// question each one answers (#1325, #1327). What a returning lead could not get
// from it was the other half of "which screen do I open right now?" — the size of
// the thing behind each door, and the single move it implies. Both existed: the
// per-destination figure was authored into the front door's `details` disclosure,
// shut on load, and `nextAction` was in the registry and rendered nowhere at all.
// A number behind a triangle is a number a scanning reader does not have, and an
// action nothing renders is an action nobody takes. Both now sit in the row.
//
// WHAT THIS MODULE DOES NOT OWN, ON PURPOSE. The slug, the question, the href and
// the next action are src/finops-destinations.js's, read below rather than
// restated. A second file spelling out what each destination asks would be a
// second authority for a published product decision, and the two would disagree
// the first time one was edited — the same discipline src/finops-destination-regions.js
// keeps with the screen contract. What is new here is the two things the registry
// has no opinion about: the ORDER a leader should read the rows in, and each row's
// metric stated as a value, a unit and an explicit window.
//
// COPIED RATHER THAN IMPORTED, and pinned. src/finops-destinations.js renders
// this index, so importing that registry back from here would put the two in a
// cycle whose evaluation order decides whether `FINOPS_WORKSPACE_INDEX` is built
// against an initialised array or a temporal-dead-zone binding. The question, the
// action and the target are therefore restated below and pinned field by field
// against the registry in tests/finops-workspace-index.test.js — an edit to one
// that does not reach the other is a failing test, not a silent disagreement.
// It is the arrangement `BUNDLED_SEED_FACTS` in src/finops-headline-provenance.js
// already keeps with src/evolution-demo-data.json, for the same reason.
//
// DATA ONLY. No DOM, no storage, no network, no clock, no provider call. Every
// value below is read from a committed fixture already in this repository; none
// is measured, sampled or invented here.
//
// ---------------------------------------------------------------------------
// THE ORDERING RULE
// ---------------------------------------------------------------------------
//
// Rows are ordered by DECISION URGENCY: recoverable spend descending, then
// effort ascending, then slug. It is the rule src/finops-destinations.js already
// states for `prioritizedSlug()`, applied to the whole list rather than only to
// its winner — a first screen that recommends one door by one rule and orders the
// rest by another is a first screen with two opinions about what matters. The
// ordering is ENCODED IN `INDEX_ORDER` below, not computed by the renderer, and
// tests/finops-workspace-index.test.js asserts the literal order agrees with the
// rule applied to the registry. A hand-moved row without the numbers behind it
// fails rather than ships.
//
// ---------------------------------------------------------------------------
// METRIC DEFINITIONS — stated so two engineers compute the same number
// ---------------------------------------------------------------------------
//
// Every metric is ONE figure with ONE unit over ONE explicit window. A
// destination that needs two numbers to be understood is two destinations, or it
// is not a destination.
//
// * optimisation-levers — 5,200 USD/month over 25 Jun – 25 Jul 2026.
//   NUMERATOR: `departments[id=backend].actionPlan.estimatedSavingsUsd` in
//   src/evolution-demo-data.json, which is that plan's own `baselineUsd` 7,430
//   minus its `targetUsd` 2,230. Not a rate, so no denominator. WINDOW: the
//   seed's own reporting month, `25 Jun – 25 Jul 2026`, carried as
//   `BUNDLED_SEED_FACTS.window` in src/finops-headline-provenance.js. It is the
//   monthly saving of the single highest-ranked lever, never a sum of levers and
//   never a projection over more than one month.
//
// * spend-attribution — 154,500 USD over 2026-06-01 to 2026-07-01.
//   NUMERATOR: `benchmark.baselineUsd` in src/finops-destination-fixture.json,
//   which is the example corpus's `analysis.spendUsd` for the same period. Not a
//   rate, so no denominator. WINDOW: the reporting period the corpus declares.
//   It is TOTAL analyzed AI spend, not a recoverable subset — attribution
//   recovers nothing by itself, which is why it carries the largest figure on
//   the screen and does not lead it.
//
// * commitment-coverage — 100 % over 2026-06-01 to 2026-07-01.
//   NUMERATOR: analyzed spend in the window priced from a rate whose source is
//   `published-list`. DENOMINATOR: total analyzed spend in the same window,
//   154,500 USD. The shipped `DEFAULT_REFERENCE_CARD` declares no `contracted`
//   rate for any in-scope model (src/finops-rate-card-contract.js: an absent
//   contracted rate is undeclared, and `published-list` is a reference price,
//   not a contract), so numerator equals denominator and the share is exactly
//   100%. It is the share of spend exposed to list pricing — at-risk, not
//   recoverable — so it never enters the recoverable figure above it.
//
// NO DESTINATION WAS DROPPED. All three carry a figure that is read from
// committed data rather than estimated here.

/**
 * The index: one record per destination, in urgency order, carrying exactly the
 * five fields a row needs and no others. `value` is a number, `unit` is short
 * enough to read inside a link, and `period` is an explicit window rather than a
 * relative phrase — "last 30 days" moves under a reader, a dated range does not.
 */
export const FINOPS_WORKSPACE_INDEX = Object.freeze([
  Object.freeze({
    slug: "optimisation-levers",
    question: "What can we change?",
    metric: Object.freeze({ value: 5_200, unit: "USD/month", period: "25 Jun – 25 Jul 2026" }),
    nextAction: "Move Atlas Platform's short, low-context requests to the standard model",
    href: "/savings-action-center.html",
  }),
  Object.freeze({
    slug: "spend-attribution",
    question: "Where is the money going?",
    metric: Object.freeze({ value: 154_500, unit: "USD", period: "2026-06-01 to 2026-07-01" }),
    nextAction: "Read the department breakdown behind the analyzed figure",
    href: "#finops-stand",
  }),
  Object.freeze({
    slug: "commitment-coverage",
    question: "Are we paying list price for steady-state load?",
    metric: Object.freeze({ value: 100, unit: "%", period: "2026-06-01 to 2026-07-01" }),
    nextAction: "Declare contracted rates for the premium and standard text tiers",
    href: "/savings-commitment.html",
  }),
]);

/** The reading order, most urgent first. */
export const INDEX_ORDER = Object.freeze(FINOPS_WORKSPACE_INDEX.map((row) => row.slug));

/**
 * Recompute the reading order from the rule rather than from the array above.
 * Total and reproducible: recoverable spend descending, then effort ascending,
 * then slug, so no two destinations can tie into an undefined order.
 */
export function urgencyOrder(destinations) {
  return [...destinations].sort((a, b) => {
    if (a.recoverableUsd !== b.recoverableUsd) return b.recoverableUsd - a.recoverableUsd;
    if (a.effortDays !== b.effortDays) return a.effortDays - b.effortDays;
    return a.slug < b.slug ? -1 : 1;
  }).map((entry) => entry.slug);
}

/** One row, or null. Never throws on a slug the index does not carry. */
export const workspaceIndexRow = (slug) =>
  FINOPS_WORKSPACE_INDEX.find((row) => row.slug === slug) ?? null;

/**
 * A metric as a reader meets it: money leads with its symbol and groups its
 * thousands, a percentage trails its sign, and anything else is stated as the
 * number and the unit side by side. Rounded once, at the unit it is displayed
 * in, so no row shows a precision its source does not have.
 */
export function formatIndexMetric(metric) {
  const { value, unit } = metric;
  if (unit === "%") return `${Math.round(value)}%`;
  const grouped = Math.round(value).toLocaleString("en-US");
  return unit.startsWith("USD") ? `$${grouped}${unit.slice(3)}` : `${grouped} ${unit}`;
}

/**
 * The row's subordinate line: how bad it is, over what window, and the one thing
 * to do about it. One sentence-length string rather than three nodes, because
 * the row is a link and every node inside it is read as part of the link's name.
 */
export const indexRowText = (row) =>
  `${formatIndexMetric(row.metric)} · ${row.metric.period} · Next: ${row.nextAction}`;
