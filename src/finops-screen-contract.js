// The screen contract for /evolution.html, executable.
//
// The prose is docs/executive-answer-screen-contract.md; this is the copy the
// page renders, so the document and the screen cannot say different things.
// Four destinations, one question each, one metric each.
//
// THE HEADLINE METRIC — stand-behind share. Numerator `summarize(scored)
// .spendUsd`, where a department is scored exactly when `departmentPerformance
// (d).available`; denominator `summarize(population).spendUsd` over the same
// analysed set; no filter; ratio raw in [0,1], null (never zero) with no
// denominator; rendered `formatPercent(ratio, {digits:1})`, the call the score
// card's coverage line already makes. §1 of the document is the long form.
//
// NOTHING IS RECOMPUTED HERE. Every value comes off the composed headline's
// `gradability` verdict — `gradeExport()` over `gradeEligibility()`. This module
// divides nothing and reads no dataset, no storage, and no network.
//
// The grade threshold is a PUBLICATION GATE, not a numerator filter: there is no
// per-dollar grade to filter by, and the threshold on this page is itself a
// coverage threshold, so the figure is published in `graded` and `provisional`
// and withheld — not printed small — in `below_bar` and `no_baseline`. §5 of the
// document says why at length, and says it is a departure from the brief.

import { formatPercent, formatUsd } from "./evolution.js";
import { COVERAGE_TIERS } from "./grade-eligibility.js";
import { GRADABILITY_STATE } from "./export-gradability.js";

/** Bump when a question, a metric, or a computation below changes meaning. */
export const SCREEN_CONTRACT_VERSION = "finops-screen-contract/1.0.0";

/** The prose this file is the executable form of. Named so a reader can find it. */
export const SCREEN_CONTRACT_DOC = "docs/executive-answer-screen-contract.md";

/**
 * The four destinations, in reading order. `shellDestination` is the key the
 * working-area control already uses: it says "department" where a leader says
 * "departments", and renaming it would move a fragment already in address bars.
 */
export const SCREEN_CONTRACT = Object.freeze([
  Object.freeze({
    key: "answer",
    shellDestination: "answer",
    name: "The answer",
    question: "Is our AI spend classification trustworthy enough to act on?",
    metricLabel: "Spend we can stand behind",
    metricUnit: "% of spend in scope",
    target: "#finops-answer",
    excludes: "The peer rank band, the recoverable-dollar figure, the letter grade itself, "
      + "the classifier-agreement rate, and every trend.",
  }),
  Object.freeze({
    key: "evidence",
    shellDestination: "evidence",
    name: "Evidence",
    question: "What was this computed from?",
    metricLabel: "Sampled-query coverage of the scored sample",
    metricUnit: "% of spend in scope",
    target: "#recommendation-evidence",
    excludes: "Any recommendation, any dollar projection, and any claim about what follows.",
  }),
  Object.freeze({
    key: "departments",
    shellDestination: "department",
    name: "Departments",
    question: "Where is the problem concentrated?",
    metricLabel: "Unscored spend per department",
    metricUnit: "USD, ranked descending",
    target: "#department-decision-panel",
    excludes: "Per-department letter grades, which no unscored department has, "
      + "and headcount-normalised spend.",
  }),
  Object.freeze({
    key: "act-and-verify",
    shellDestination: "act-and-verify",
    name: "Act and verify",
    question: "What do I do next, and how will I know it worked?",
    metricLabel: "Monthly savings committed against monthly savings verified",
    metricUnit: "USD",
    target: "/savings-action-center.html",
    excludes: "Modelled ceilings. A routing scenario is not a realized saving.",
  }),
]);

/** One destination by key, or null. Never throws on an unknown key. */
export function destination(key) {
  return SCREEN_CONTRACT.find((entry) => entry.key === key) ?? null;
}

/** The answer destination, which is the one the block below is built from. */
export const ANSWER_DESTINATION = destination("answer");

/**
 * THE ONE DECISION-SUMMARY REGION, declared once.
 *
 * A CTO who has never opened this product lands on /evolution.html and must get,
 * in ONE region, above and before any working area, four things and exactly one
 * of each: the question this page decides, the material number with its unit and
 * its period, the single next action, and how much to trust the number. That
 * region is `#finops-answer`, inside the headline region `#finops-stand`, and
 * this is the declaration downstream code reads — the element ids it paints
 * into, the wording it ships before any script runs, and the order the four
 * parts are met in. `finops-stand-view.js` derives its id map from `parts`
 * below, so the page cannot paint into a slot the contract does not declare.
 *
 * WHY THE MARKING RATHER THAN A COUNT OF ANSWER-SHAPED BLOCKS. "Exactly one" has
 * to be checkable against the shipped document, and a second summary is not
 * recognisable by its tag: it is recognisable by claiming to be the answer. So
 * the claim is authored — `data-decision-summary-region="authored"` — and
 * `auditDecisionSummary` fails on a second element carrying it, on the declared
 * region not carrying it, and on a part that left the region or moved within it.
 * The claim is deliberately NOT `data-decision-summary`: that attribute is the
 * decision contract's `complete`/`evidence` vocabulary for whole regions, with
 * its own entitlement referee, and repurposing it would make one attribute mean
 * two things.
 *
 * WHY CONFIDENCE SITS AHEAD OF THE ACTION. The four parts are ordered question →
 * metric → confidence → action, which is the order the page already ships. An
 * action read before the reader knows how far to trust the number behind it is
 * an instruction with no argument under it, and a reader who cannot see the two
 * lines at once has no way to scan back for the reason. The same rule orders
 * `READING_ORDER` in finops-decision-interaction.js.
 */
export const DECISION_SUMMARY = Object.freeze({
  /** The one region that answers on its own. Every other region supports it. */
  regionId: "finops-answer",
  /** The top-level region it sits in, first in `#main-content`. */
  hostRegionId: "finops-stand",
  /** The authored claim, checkable in the document before any paint. */
  attribute: "data-decision-summary-region",
  claim: "authored",
  /**
   * The four parts, in reading order. `answers` is the reader's question, not a
   * description of the widget; `authored` is the wording the document ships
   * before a figure exists, which lives here rather than only in the markup so
   * the page is a rendering of this file and a test can hold the two together.
   */
  parts: Object.freeze([
    Object.freeze({
      role: "question",
      elementId: "finops-answer-question",
      answers: "What does this page decide?",
      authored: ANSWER_DESTINATION.question,
    }),
    Object.freeze({
      role: "metric",
      elementId: "finops-answer-figure",
      answers: "What is the one number, in what unit, over what period?",
      authored: null,
      /** The figure's three slots, in the order they are spoken as one line. */
      slots: Object.freeze({
        label: Object.freeze({
          elementId: "finops-answer-label", authored: ANSWER_DESTINATION.metricLabel,
        }),
        value: Object.freeze({ elementId: "finops-answer-value", authored: "Still reading" }),
        basis: Object.freeze({
          elementId: "finops-answer-basis", authored: "as of the Bundled synthetic example",
        }),
      }),
    }),
    Object.freeze({
      role: "confidence",
      elementId: "finops-answer-confidence",
      answers: "How much of this number was measured, and what does it not measure?",
      authored: "Nothing has been read yet, so there is no coverage, grade, or residue to report.",
    }),
    Object.freeze({
      role: "action",
      elementId: "finops-answer-action",
      answers: "What is the one thing to do next?",
      authored: "Analyze a provider export — go to the import panel",
      /** Authored href, so the one action is operable before any script runs. */
      href: "#local-import",
    }),
  ]),
  /** The entry points beside the block, kept out of it so the block stays four things. */
  doorsId: "finops-answer-doors",
});

/** The element ids the block owns, keyed by role, for a painter to write into. */
export const DECISION_SUMMARY_IDS = Object.freeze(Object.fromEntries([
  ["block", DECISION_SUMMARY.regionId],
  ["doors", DECISION_SUMMARY.doorsId],
  ...DECISION_SUMMARY.parts.flatMap((part) => [
    [part.role === "metric" ? "figure" : part.role, part.elementId],
    ...Object.entries(part.slots ?? {}).map(([key, slot]) => [key, slot.elementId]),
  ]),
]));

/** Element children as a real Array. `children` is a live collection in a browser. */
const elementChildren = (node) => [...(node?.children ?? [])]
  .filter((child) => child?.nodeType === undefined || child.nodeType === 1);

/** Every descendant id of `node`, in document order. */
function idsInOrder(node, out = []) {
  for (const child of elementChildren(node)) {
    if (child.id) out.push(child.id);
    idsInOrder(child, out);
  }
  return out;
}

/**
 * Is this document carrying exactly one decision summary, and does that one
 * state all four things in the declared order?
 *
 * Returns problems as plain sentences and never throws — the caller is a test
 * that should report every drift at once, not the first one.
 */
export function auditDecisionSummary(doc) {
  const problems = [];
  const marked = [...(doc?.querySelectorAll?.(
    `[${DECISION_SUMMARY.attribute}="${DECISION_SUMMARY.claim}"]`) ?? [])];
  const named = marked.map((element) => `#${element.id || "(no id)"}`);

  if (marked.length === 0) {
    problems.push(`No region claims ${DECISION_SUMMARY.attribute}="${DECISION_SUMMARY.claim}", so `
      + `this page states no decision summary. "#${DECISION_SUMMARY.regionId}" is the one that must.`);
    return Object.freeze(problems);
  }
  if (marked.length > 1) {
    problems.push(`${marked.length} regions claim to be the decision summary (${named.join(", ")}). `
      + "Exactly one may: a second is a competing answer to the same question, and a reader who "
      + "meets two does not know which one to act on.");
  }

  const region = marked.find((element) => element.id === DECISION_SUMMARY.regionId) ?? null;
  if (!region) {
    problems.push(`The decision summary is declared as "#${DECISION_SUMMARY.regionId}", but the `
      + `claim is on ${named.join(", ")}.`);
    return Object.freeze(problems);
  }

  const found = idsInOrder(region);
  for (const part of DECISION_SUMMARY.parts) {
    if (!found.includes(part.elementId)) {
      problems.push(`The decision summary states no ${part.role}: "#${part.elementId}" is not `
        + `inside "#${DECISION_SUMMARY.regionId}", so it never answers "${part.answers}"`);
    }
  }

  const declared = DECISION_SUMMARY.parts.map((part) => part.elementId);
  const order = found.filter((id) => declared.includes(id));
  if (order.length === declared.length && order.join(" → ") !== declared.join(" → ")) {
    problems.push(`The decision summary reads ${order.join(" → ")}; the contract's reading order `
      + `is ${declared.join(" → ")}.`);
  }
  return Object.freeze(problems);
}

/** The states in which the percentage may be printed at all. */
const PUBLISHED_STATES = Object.freeze([
  GRADABILITY_STATE.graded, GRADABILITY_STATE.provisional,
]);

/** The published coverage tier this verdict landed in, or null. */
const tierOf = (tier) => COVERAGE_TIERS.find((entry) => entry.tier === tier) ?? null;

/** The published rule for a coverage tier, so the bar ships beside the figure. */
const tierRule = (tier) => tierOf(tier)?.rule ?? null;

/**
 * WHICH SUPPORTING PANEL BACKS THE HEADLINE FIGURE, declared once.
 *
 * The answer screen puts three supporting layers under the block: the two
 * folded evidence disclosures (#disclosure-next-step, #disclosure-journey) and
 * #finops-destinations, which is the one that publishes a confidence WITH its
 * basis and a provenance for the finding the headline rests on —
 * finops-destination-contract.js carries both on its `finding` record, and the
 * other two carry neither. It is also the only one of the three that is not a
 * `details`, which is what lets the promoted panel be expanded by default
 * without unfolding a layer tests/finops-answer-evidence-collapse.test.js
 * requires to ship shut.
 *
 * It is ONE field on the payload rather than a panel index in the template, so
 * the surface reads the link instead of knowing it. Exactly one element may
 * carry the marking; `applyAnswerEvidence` in finops-stand-view.js clears every
 * marking before it sets this one, and refuses to set any when the id does not
 * resolve.
 *
 * HONEST LIMIT. This panel is where the headline's confidence and provenance are
 * READABLE; it is not where the percentage is DIVIDED. That arithmetic is
 * `gradeExport()` over the analysis, which no panel on this screen owns. Naming
 * a panel that computed the figure would need a per-panel lineage the data model
 * does not publish, and inventing one here would be a claim nothing could check.
 */
export const ANSWER_EVIDENCE_PANEL = Object.freeze({
  /** The stable id `aria-describedby` and the promotion both resolve against. */
  panelId: "finops-destinations",
  /** The persistent text label. Read aloud on its own, it states the relationship. */
  label: "Evidence for the headline figure",
});

/**
 * The confidence and the provenance behind the figure, as one line.
 *
 * NEITHER VALUE IS INVENTED. The confidence is the coverage tier's OWN published
 * label — `COVERAGE_TIERS[].label`, already the words "high confidence",
 * "moderate confidence", "provisional grade", "insufficient coverage" — read off
 * the same verdict the figure came from. The provenance is the as-of basis this
 * module already composes. A verdict in a tier this module cannot name (a
 * baseline-less import, whose tier is not in the published table) gets the
 * provenance ALONE rather than a confidence word nothing measured.
 */
function answerEvidence(gradability, basis) {
  const confidence = tierOf(gradability?.tier)?.label ?? null;
  return Object.freeze({
    panelId: ANSWER_EVIDENCE_PANEL.panelId,
    label: ANSWER_EVIDENCE_PANEL.label,
    confidence,
    provenance: basis,
    line: confidence
      ? `Confidence: ${confidence}. Source: ${basis}.`
      : `Source: ${basis}. No coverage tier was established, so this figure carries no confidence level.`,
  });
}

/** What the block says instead of a figure, per withholding state. */
const WITHHELD_FIGURE = Object.freeze({
  [GRADABILITY_STATE.belowBar]: "Not enough scored to stand behind",
  [GRADABILITY_STATE.noBaseline]: "No spend baseline",
});

/**
 * The one action, and where it is taken.
 *
 * Priority when more than one is arguably first: THE LARGEST CORRECTABLE
 * RESIDUE — the unscored department holding the most unscored spend, ties broken
 * lexicographically. That ranking is not recomputed here; it is `topCluster()`
 * in export-gradability.js, already carried as `action.cluster`, so this block
 * cannot name a different department from the one the verdict named. The two
 * states with no residue to rank are handled ahead of it.
 */
function nextAction(gradability) {
  const state = gradability?.state ?? null;
  if (state === GRADABILITY_STATE.noBaseline) {
    return Object.freeze({
      label: "Import billing data so coverage has a denominator",
      href: "#local-import",
      destinationKey: null,
    });
  }
  if (state === GRADABILITY_STATE.graded) {
    const act = destination("act-and-verify");
    return Object.freeze({
      label: `Record and verify a savings commitment — go to ${act.name}`,
      href: act.target,
      destinationKey: act.key,
    });
  }
  const cluster = gradability?.action?.cluster ?? null;
  const departments = destination("departments");
  return Object.freeze({
    label: cluster
      ? `Widen the scored sample for ${cluster} — go to ${departments.name}`
      : `Review which departments were scored — go to ${departments.name}`,
    href: departments.target,
    destinationKey: departments.key,
  });
}

/**
 * Coverage, grade, residue, and what it is all as of — in that order, naming
 * only inputs that entered the computation. Classifier agreement is deliberately
 * absent: it scores `classifyQuery` against a hand-labelled corpus and is not an
 * input to this figure, so naming it would claim a link that does not exist.
 */
function confidenceSentence(gradability, basis) {
  const covered = Number(gradability?.coveredUsd);
  const total = Number(gradability?.totalUsd);
  const parts = [Number.isFinite(total) && total > 0
    ? `Coverage: ${formatUsd(covered)} of ${formatUsd(total)} of spend in scope sits in `
      + "departments the rubric scored."
    : "Coverage: this analysis published no spend total, so there is nothing to measure "
      + "coverage against."];
  const rule = tierRule(gradability?.tier);
  if (rule) parts.push(`Grade: ${gradability.tier} coverage tier — ${rule}`);
  const residue = Number.isFinite(total) && Number.isFinite(covered) && total > covered
    ? total - covered : 0;
  const cluster = gradability?.action?.cluster ?? null;
  parts.push(residue > 0
    ? `Residue: ${formatUsd(residue)} of that spend has no scored query`
      + (cluster ? `, the largest single block of it in ${cluster}.` : ".")
    : "Residue: none — every department in scope carries a scored query.");
  parts.push(`All of it as of ${basis}.`);
  return parts.join(" ");
}

/** The dataset and period a figure is as of, as one phrase. Never a clock. */
export function asOfBasis(headline) {
  const label = String(headline?.label ?? "").trim() || "the current dataset";
  const period = String(headline?.period ?? "").trim();
  return period ? `${label} · ${period}` : label;
}

/**
 * Whose figures these are, per source. Moved here from finops-stand.js, which
 * re-exports it: `asOfBasis` above and `src/finops-answer-summary.js` both need
 * it, and neither may reach the headline composer to get it.
 */
export const STAND_LABEL = Object.freeze({
  example: "Bundled synthetic example · nothing of yours needed",
  import: "Your own export · analyzed in this browser",
});

const MONTH = Object.freeze(["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"]);

/**
 * "2026-06-01 to 2026-07-01" → "June 2026". Null rather than a guess.
 *
 * The period a claim covers is half of what makes it repeatable, and the
 * analysis already carries it in the shape every other window on this page uses.
 * A window that spans more than one month gets both ends rather than a month
 * name that would be wrong for most of it. Here rather than in finops-stand.js
 * for the reason above: it is half of the as-of phrase this module composes.
 */
export function periodLabel(analysis) {
  const match = /^(\d{4})-(\d{2})-\d{2} to (\d{4})-(\d{2})-(\d{2})$/
    .exec(String(analysis?.period ?? "").trim());
  if (!match) return null;
  const [, startYear, startMonth, endYear, endMonth, endDay] = match;
  const month = MONTH[Number(startMonth) - 1];
  if (!month) return null;
  // A half-open window ending on the first of the next month is one whole
  // month, which is how this page's own exports are cut.
  const wholeMonth = endDay === "01"
    && (Number(endMonth) === Number(startMonth) + 1 ? endYear === startYear
      : Number(startMonth) === 12 && Number(endMonth) === 1
        && Number(endYear) === Number(startYear) + 1);
  return wholeMonth ? `${month} ${startYear}` : `${analysis.period}`;
}

/**
 * The whole answer block from a composed stand headline: four values and nothing
 * else. `figure` is a string in every state — the withheld states say which
 * state they are in rather than printing a percentage nobody should act on.
 *
 * It reads three fields — `label`, `period`, `gradability` — and nothing else,
 * which is why `src/finops-answer-summary.js` can hand it a small object derived
 * straight from the fixture instead of a fully composed headline.
 */
export function answerBlock(headline) {
  const gradability = headline?.gradability ?? null;
  const basis = asOfBasis(headline);
  const state = gradability?.state ?? null;
  const ratio = typeof gradability?.coverage === "number" ? gradability.coverage : null;
  const published = ratio !== null && PUBLISHED_STATES.includes(state);
  return Object.freeze({
    version: SCREEN_CONTRACT_VERSION,
    question: ANSWER_DESTINATION.question,
    metricLabel: ANSWER_DESTINATION.metricLabel,
    /** Raw, unrounded, for a caller that wants to check the arithmetic. */
    ratio: published ? ratio : null,
    available: published,
    state: state ?? "unavailable",
    figure: published
      ? `${formatPercent(ratio, { digits: 1 })} of spend in scope`
      : WITHHELD_FIGURE[state] ?? "Not computed yet",
    basis: `as of ${basis}`,
    confidence: confidenceSentence(gradability, basis),
    /** Which supporting panel backs this figure, and the one line that says so. */
    evidence: answerEvidence(gradability, basis),
    action: nextAction(gradability),
  });
}
