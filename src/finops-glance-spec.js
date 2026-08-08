// The five-second glance: which ONE of four figures is the reason to keep
// reading, and the one thing to do about it.
//
// WHY THIS EXISTS. A lead who opens /evolution.html meets an answer region, a
// front door, and then a long column of supporting sections. The answer region
// tells them where they stand. What it does not tell them is which of the
// page's supporting figures is the one worth their next two minutes. Before
// this module that was a judgement each reader made by scrolling.
//
// So this block leads with ONE answerable question and ONE prioritized action,
// and states the other three figures as one-liners underneath. Four figures,
// declared in a fixed order, each bound to a model function that already
// exists on this page.
//
// THE LEAD IS CHOSEN BY DECLARED ORDER, NEVER BY MAGNITUDE. The lead figure is
// the FIRST figure in `FINOPS_GLANCE_FIGURES` order whose value crosses its own
// threshold. If none crosses, the lead is the first figure in that same order
// that has data, and the block says plainly that nothing crossed. Magnitude
// comparison across these four is meaningless — a percent of spend, a signed
// month-over-month percent, and a quartile are not on one scale — and it would
// also make the lead flip on noise. Declared order is reproducible; "biggest"
// is not.
//
// NO NEW DATA. Every figure reads a function already exported by
// src/evolution.js over the dataset the page already holds. This module adds no
// fixture, no field, and no request, and it surfaces no figure beyond the four
// aggregates below.

import {
  QUERY_CATEGORIES, departmentTrend, quartileLabel, rankDepartments, summarize,
} from "./evolution.js";

/** Bump when a figure, its formula, or its threshold changes meaning. */
export const FINOPS_GLANCE_VERSION = "finops-glance/1.0.0";

/** The one sentence a figure with no data renders. Never a 0, a dash, or a blank. */
export const NOT_YET_MEASURED = "not yet measured";

/** The element ids this block owns. Authored in src/evolution.html. */
export const FINOPS_GLANCE_IDS = Object.freeze({
  region: "finops-glance",
  heading: "finops-glance-title",
  lead: "finops-glance-lead",
  action: "finops-glance-action",
  figures: "finops-glance-figures",
});

/** Every threshold is crossed on the same side: at or above the number. */
export const GLANCE_DIRECTION = "at_or_above";

/**
 * The four figures, in the order the lead is scanned for.
 *
 * `source` names the EXISTING computed-model function each figure reads. It is
 * a name, not a reference, so this list stays readable as a spec; the readers
 * below are what call the function.
 */
export const FINOPS_GLANCE_FIGURES = Object.freeze([
  Object.freeze({
    id: "spend-mix",
    question: "Is one query class eating the budget?",
    unit: "percent",
    source: "summarize",
    threshold: 40,
    direction: GLANCE_DIRECTION,
    definition:
      "The share of current-period total AI spend held by the single largest query class: "
      + "largest class spend / total spend x 100, one decimal. The class totals are "
      + "summarize(departments).mix, which is already normalized over the same denominator. "
      + "Ties are broken by QUERY_CATEGORIES declaration order.",
  }),
  Object.freeze({
    id: "department-rank",
    question: "Which department is the one to talk to?",
    unit: "percent",
    source: "rankDepartments",
    threshold: 30,
    direction: GLANCE_DIRECTION,
    definition:
      "The share of current-period total AI spend held by the top-ranked department: that "
      + "department's spendUsd / summarize(departments).spendUsd x 100, one decimal. Ranking is "
      + "rankDepartments(departments, \"spendUsd\"); a tie on spend is broken by department name "
      + "ascending so the named department is deterministic.",
  }),
  Object.freeze({
    id: "mom-movement",
    question: "Is spend accelerating?",
    unit: "percent",
    source: "departmentTrend",
    threshold: 10,
    direction: GLANCE_DIRECTION,
    definition:
      "(current period total spend - prior period total spend) / prior period total spend x 100, "
      + "signed, one decimal. The departments counted on both sides are exactly those whose "
      + "departmentTrend(department).costAvailable is true, so the eligibility rule is the one "
      + "the trend model already publishes rather than a second one written here. Undefined when "
      + "no department qualifies or the prior total is 0.",
  }),
  Object.freeze({
    id: "peer-quartile",
    question: "Are we worse than comparable teams?",
    unit: "quartile",
    source: "quartileLabel",
    threshold: 3,
    direction: GLANCE_DIRECTION,
    definition:
      "The workspace's quartile against its declared synthetic peer cohort, as an integer 1-4 "
      + "where 1 is best: quartileLabel(organization.peerPercentile) mapped Top=1, Second=2, "
      + "Third=3, Bottom=4. Undefined when no percentile is declared. Cohort boundaries are "
      + "hand-authored synthetic fixtures, not a measured population.",
  }),
]);

/** Half away from zero to one decimal, so +7.55 and -7.55 round identically. */
function round1(value) {
  if (!Number.isFinite(value)) return null;
  const sign = value < 0 ? -1 : 1;
  return sign * (Math.round(Math.abs(value) * 10) / 10);
}

/** A figure with no data. It renders NOT_YET_MEASURED and can never lead. */
function unmeasured(id) {
  return Object.freeze({ id, available: false, value: null, subject: null, supporting: NOT_YET_MEASURED });
}

function measured(id, value, subject, supporting, remediable = true) {
  return Object.freeze({ id, available: true, value, subject, supporting, remediable });
}

const percent = (value) => `${value.toFixed(1)}%`;

const QUARTILE_BY_LABEL = Object.freeze({
  "Top quartile": 1,
  "Second quartile": 2,
  "Third quartile": 3,
  "Bottom quartile": 4,
});

function readSpendMix(departments) {
  const totals = summarize(departments);
  if (!(totals.spendUsd > 0)) return unmeasured("spend-mix");
  // First maximum wins, so QUERY_CATEGORIES order is the tie-break.
  let top = null;
  for (const category of QUERY_CATEGORIES) {
    const share = Number(totals.mix?.[category.key]);
    if (!Number.isFinite(share)) continue;
    if (!top || share > top.share) top = { category, share };
  }
  if (!top || !(top.share > 0)) return unmeasured("spend-mix");
  const value = round1(top.share * 100);
  // `recoverableShare` is the existing model's own statement of whether a class
  // is remediable at all. The largest class is not automatically the problem —
  // on a healthy dataset it is the high-value class — and the action below
  // branches on this rather than telling a lead to route productive spend away.
  return measured("spend-mix", value, top.category.label,
    `${top.category.label} queries hold ${percent(value)} of this period's AI spend.`,
    top.category.recoverableShare > 0);
}

function readDepartmentRank(departments) {
  const totals = summarize(departments);
  const ranked = rankDepartments(departments, "spendUsd");
  const leader = ranked[0];
  if (!(totals.spendUsd > 0) || !leader) return unmeasured("department-rank");
  const topSpend = Number(leader.spendUsd);
  if (!Number.isFinite(topSpend) || topSpend <= 0) return unmeasured("department-rank");
  // A tie on spend is broken by name ascending, so the department this block
  // tells a lead to go and talk to does not depend on dataset order.
  const tied = ranked.filter((department) => Number(department.spendUsd) === topSpend);
  const winner = [...tied].sort((first, second) =>
    String(first.name ?? "").localeCompare(String(second.name ?? "")))[0];
  const value = round1((topSpend / totals.spendUsd) * 100);
  const name = String(winner.name ?? "").trim() || "The top-ranked department";
  return measured("department-rank", value, name,
    `${name} holds ${percent(value)} of this period's AI spend, more than any other department.`);
}

function readMomMovement(departments) {
  const eligible = (Array.isArray(departments) ? departments : [])
    .filter((department) => departmentTrend(department).costAvailable);
  if (eligible.length === 0) return unmeasured("mom-movement");
  const current = eligible.reduce((sum, department) => sum + Number(department.spendUsd), 0);
  const prior = eligible.reduce((sum, department) =>
    sum + Number(department.previousPeriod.spendUsd), 0);
  if (!(prior > 0)) return unmeasured("mom-movement");
  const value = round1(((current - prior) / prior) * 100);
  // The period names come from the first eligible department in dataset order:
  // every department in this dataset carries the same pair, and taking the
  // first keeps the sentence deterministic if one day they do not.
  const from = eligible[0].previousPeriod?.period ?? "the prior period";
  const to = eligible[0].period ?? "this period";
  const word = value > 0 ? "up" : value < 0 ? "down" : "level";
  return measured("mom-movement", value, `${from} to ${to}`,
    value === 0
      ? `Total AI spend is level from ${from} to ${to}.`
      : `Total AI spend is ${word} ${percent(Math.abs(value))} from ${from} to ${to}.`);
}

function readPeerQuartile(organization) {
  const quartile = QUARTILE_BY_LABEL[quartileLabel(organization?.peerPercentile)];
  if (!quartile) return unmeasured("peer-quartile");
  const label = quartileLabel(organization.peerPercentile);
  return measured("peer-quartile", quartile, label,
    `${label} of the bundled synthetic peer cohort, where the first quartile is best.`);
}

/**
 * Read all four figures, in declared order.
 *
 * @param {{departments?: Array, organization?: object}} data the dataset the
 *   page already holds. Nothing else is read, and nothing is fetched.
 */
export function readGlanceFigures({ departments = [], organization = null } = {}) {
  return Object.freeze([
    readSpendMix(departments),
    readDepartmentRank(departments),
    readMomMovement(departments),
    readPeerQuartile(organization),
  ]);
}

/** True when a reading has data and sits at or above its figure's threshold. */
export function crossesThreshold(figure, reading) {
  return Boolean(reading?.available) && Number(reading.value) >= Number(figure.threshold);
}

/**
 * The lead figure: first crossing in declared order, else first with data.
 *
 * Returns `{ figure, reading, crossed }`, or null when nothing is measured.
 * A `not yet measured` figure is skipped by both passes — it can never lead.
 */
export function selectGlanceLead(readings, figures = FINOPS_GLANCE_FIGURES) {
  const paired = figures.map((figure, index) => ({ figure, reading: readings?.[index] ?? null }));
  const crossing = paired.find(({ figure, reading }) => crossesThreshold(figure, reading));
  if (crossing) return Object.freeze({ ...crossing, crossed: true });
  const measurable = paired.find(({ reading }) => reading?.available);
  return measurable ? Object.freeze({ ...measurable, crossed: false }) : null;
}

/**
 * The one prioritized next action, derived from the lead figure.
 *
 * Each names the concrete object to act on — the class, the department, the
 * period, or the peer gap. "Investigate further" is not an action.
 */
export function glanceAction(lead) {
  if (!lead) return null;
  const { reading } = lead;
  switch (lead.figure.id) {
    case "spend-mix":
      return reading.remediable
        ? `Take the ${reading.subject} query class to the routing slate below: it is `
          + `${percent(reading.value)} of this period's spend.`
        : `${reading.subject} is the largest class at ${percent(reading.value)} and the model `
          + "recovers nothing from it — hold it as the internal reference rather than routing it "
          + "away.";
    case "department-rank":
      return `Book the review of ${reading.subject}'s ${percent(reading.value)} share with its `
        + "department lead before next period opens.";
    case "mom-movement":
      return `Reconcile ${reading.subject} line by line before approving next period's budget.`;
    case "peer-quartile":
      return "Close the gap to the next quartile up on spend per successful task, using the peer "
        + "position in the answer above.";
    default:
      return null;
  }
}

/**
 * The whole block as data: four figures with their readings, the lead, the
 * action, and the sentence the lead line renders.
 */
export function composeFinopsGlance(data) {
  const readings = readGlanceFigures(data);
  const lead = selectGlanceLead(readings);
  const entries = FINOPS_GLANCE_FIGURES.map((figure, index) => Object.freeze({
    figure,
    reading: readings[index],
    lead: Boolean(lead) && lead.figure.id === figure.id,
  }));
  const headline = !lead
    ? "No figure on this page is measured yet, so there is nothing to lead with."
    : lead.crossed
      ? `${lead.figure.question} ${lead.reading.supporting}`
      : `No figure crossed its threshold this period. ${lead.figure.question} `
        + `${lead.reading.supporting}`;
  return Object.freeze({
    version: FINOPS_GLANCE_VERSION,
    entries: Object.freeze(entries),
    lead,
    headline,
    action: glanceAction(lead),
  });
}

/**
 * Paint the block. Static text only: no control, no disclosure, no tab stop.
 *
 * Tolerates a missing region and never throws — it runs on the paint path.
 */
export function applyFinopsGlance(doc, data) {
  const region = doc?.getElementById?.(FINOPS_GLANCE_IDS.region) ?? null;
  if (!region) return null;
  const glance = composeFinopsGlance(data);

  const leadLine = doc.getElementById(FINOPS_GLANCE_IDS.lead);
  if (leadLine) leadLine.textContent = glance.headline;

  const action = doc.getElementById(FINOPS_GLANCE_IDS.action);
  if (action) {
    action.textContent = glance.action ?? "No action can be ranked until a figure is measured.";
  }

  const list = doc.getElementById(FINOPS_GLANCE_IDS.figures);
  if (list) {
    list.replaceChildren();
    for (const entry of glance.entries) {
      if (entry.lead) continue;
      const item = doc.createElement("li");
      item.id = `finops-glance-${entry.figure.id}`;
      item.setAttribute("data-glance-measured", String(entry.reading.available));
      // The leader's question, then the one-line answer to it. One text node
      // rather than a wrapped fragment: this block is read straight through and
      // owns no styling hooks of its own.
      item.textContent = `${entry.figure.question} ${entry.reading.supporting}`;
      list.append(item);
    }
  }

  region.setAttribute("data-glance-lead", glance.lead?.figure.id ?? "none");
  region.setAttribute("data-glance-crossed", String(Boolean(glance.lead?.crossed)));
  return glance;
}
