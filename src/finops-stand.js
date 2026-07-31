// "Where do we stand?" — the one answer the AI FinOps view leads with.
//
// THE PROBLEM THIS SOLVES. The peer position was already computed, already
// correct, and already on the page — in a supporting slot, the fourth card of a
// grid whose four cards all looked equally important. A FinOps lead who opens
// this view is not asking "what are our figures"; they are asking where they
// stand, and a wall of equal-weight cards makes them assemble that answer
// themselves out of four labelled boxes.
//
// So this module composes ONE headline out of figures other modules already
// produce, and publishes everything else as disclosure entries:
//
//   * the peer position, with the metric it is a position ON and its quartile
//     boundaries inline — never a bare band with no denominator,
//   * the recoverable figure beside it, not in a card of its own,
//   * exactly one named lagging team,
//   * exactly one prioritized next action.
//
// ---------------------------------------------------------------------------
// WHAT THIS MODULE MAY AND MAY NOT DO
// ---------------------------------------------------------------------------
//
// 1. IT COMPOSES; IT NEVER RECOMPUTES. Every figure is read off a result some
//    other module owns: `resolveCostPosition` for the position and its band,
//    `leadingFinding` for the lagging department, `prioritizedDestination` for
//    the rank-1 action, `validateCohortAttribution` for import eligibility and
//    the anonymization note, `buildFinopsBriefing` for the rubric and coverage.
//    There is no second arithmetic path here and no place to inject one.
//
// 2. THE WITHHELD POSITION IS A PATH, NOT A LABEL. When a position cannot be
//    shown, this module never emits the bare word "Unavailable". It emits what
//    specifically is missing and one concrete step that would resolve it —
//    verbatim from the eligibility result for an import, and from the table
//    below for the bundled path, where `peer-cost-position.js` publishes the
//    reason but no remedy. Those strings are copy for reasons that module
//    already decided; no eligibility RULE is restated here.
//
// 3. THE BUNDLED EXAMPLE IS THE DEFAULT, NOT A MODE. `buildStandHeadline()`
//    takes no arguments, reads no storage, opens no network, and needs no
//    import. First load with cleared storage is the path that runs here.
//
// 4. NOTHING BELOW BUILDS A NODE. Every value is plain text;
//    `finops-stand-view.js` owns the DOM.

import {
  EXAMPLE_ORG_COHORT_PROFILE, EXAMPLE_TASK_LEDGER, loadExampleDataset,
} from "./example-dataset.js";
import { buildFinopsBriefing } from "./finops-briefing-contract.js";
import { loadCanonicalDecision } from "./finops-decision-contract.js";
import { leadingFinding } from "./finops-leading-finding.js";
import { recoverableShare } from "./finops-first-run.js";
import { validateCohortAttribution } from "./cohort-attribution.js";
// The gate this region reads before it quotes a figure out of a reader's file.
// It owns the coverage bar, the four states, and the sentence for each; nothing
// about gradability is decided here.
import { gradeExport } from "./export-gradability.js";
import {
  COST_BAND, COST_BAND_DIRECTION, COST_METRIC, COST_POSITION_WITHHELD, PEER_COST_COHORTS,
  PEER_COST_PROVENANCE, PEER_COST_SNAPSHOT_ID, PEER_RANK_LABEL, displayCostPerSuccessfulTask,
} from "./peer-cost-position.js";

export { PEER_RANK_LABEL } from "./peer-cost-position.js";
import {
  loadWorkspaceDestinations, prioritizedDestination, supportingDestinations,
} from "./finops-destination-contract.js";
import {
  RECORD_FIELDS, REPRODUCIBILITY_REFUSED, RUBRIC_VERSION, SHIPPED_COHORT_SNAPSHOT,
  evaluateRankingReproducibility, renderableLaggardName,
} from "./ranking-reproducibility.js";
// The declarations only, never the classifier. `query-signal-families.js` holds
// integers and authored English and imports nothing, so naming the weights on
// this page costs the initial payload one small module rather than the rubric,
// the tier table and the segmenter the classifier itself reaches.
import { signalFamilyDisclosureRows } from "./query-signal-families.js";
import {
  EVIDENCE_CLASS, PROVENANCE_KIND, resolveFinding,
} from "./finops-finding-resolver.js";
import {
  INPUT_DIGEST_ALGORITHM, INPUT_RUBRIC_VERSION, WEIGHT_ASSUMPTION, buildInputProvenance,
} from "./finops-input-digest.js";
import {
  FINOPS_SPINE_MANIFEST, SPINE_CLAIM_KIND, SPINE_DIRECTION, SPINE_UNIT,
} from "./finops-spine-manifest.js";

/** Bump when a headline slot, a disclosure, or a withheld sentence changes meaning. */
export const STAND_VERSION = "finops-stand-headline/1.0.0";

/** The lead's own question, in the lead's own words. It is the region's heading. */
export const STAND_QUESTION = "Where do we stand on AI spend?";

/** The element ids the view owns. Nothing else writes them. */
export const STAND_IDS = Object.freeze({
  region: "finops-stand",
  label: "finops-stand-label",
  question: "finops-stand-question",
  answer: "finops-stand-answer",
  /** The one-sentence description the region is announced with. Never empty. */
  claim: "finops-stand-claim",
  positionValue: "finops-stand-position-value",
  positionBasis: "finops-stand-position-basis",
  recoverableValue: "finops-stand-recoverable-value",
  recoverableBasis: "finops-stand-recoverable-basis",
  team: "finops-stand-team",
  teamName: "finops-stand-team-name",
  teamDetail: "finops-stand-team-detail",
  action: "finops-stand-action",
  actionBasis: "finops-stand-action-basis",
  withheld: "finops-stand-withheld",
  withheldMissing: "finops-stand-withheld-missing",
  withheldAction: "finops-stand-withheld-action",
  withheldNext: "finops-stand-withheld-next",
  /**
   * The gradability line: the question, the verdict with its figure, and the one
   * next step. Three slots, not a panel — it is the gate on the answer above it,
   * and each slot is hidden when it has nothing to say.
   */
  gradability: "finops-stand-gradability",
  gradabilityQuestion: "finops-stand-gradability-question",
  gradabilityMetric: "finops-stand-gradability-metric",
  gradabilityAction: "finops-stand-gradability-action",
  entitlement: "finops-stand-entitlement",
  evidence: "finops-stand-evidence",
  confidence: "finops-stand-confidence",
  disclosures: "finops-stand-disclosures",
  /** The provenance marker above every figure in the region. */
  sample: "finops-stand-sample",
  live: "finops-stand-live",
});

/**
 * The provenance marker, in three redundant channels, one per source.
 *
 * WHOSE FIGURES ARE THESE is the question a lead has to be able to answer at a
 * glance and without seeing a colour. The marker carries a WORD ("Bundled
 * synthetic example" / "Imported"), a SHAPE (hollow diamond / filled diamond),
 * and a sentence saying what the figures were computed from. The stylesheet
 * adds a tint keyed on `data-source`; it is the third carrier, never the first.
 *
 * The example variant is authored in `src/evolution.html` as well, because it
 * is the state the page ships in and a reader whose JavaScript failed is owed a
 * true marker. `tests/finops-answer-announcement.test.js` holds the two copies
 * to the same string, so the pair cannot drift.
 */
export const STAND_SAMPLE_MARKER = Object.freeze({
  example: Object.freeze({
    shape: "◇",
    word: "Bundled synthetic example",
    detail: "Every figure on this page — here and inside each layer below — was computed from"
      + " invented data for an invented company. It is not your spend, customer data, or realized"
      + " savings, and no file is needed to read it.",
  }),
  import: Object.freeze({
    // ◆ and not ●: the filled circle is the status ramp's "measured", and a
    // marker saying where a figure came from must not borrow a mark that says
    // how well it is known. Both provenance states are diamonds — outline for
    // the bundled classification, filled for the file the reader brought.
    shape: "◆",
    word: "Imported",
    detail: "Every figure in this answer was computed in this browser from the export you"
      + " selected. Nothing was uploaded, and the bundled synthetic example is no longer what"
      + " this region is reporting.",
  }),
});

/**
 * The five disclosures, and the sixth the "one action only" rule creates.
 *
 * Every one of them is a SIBLING of the headline. Nothing here may be nested
 * inside another disclosure: "reachable in one step from the headline" is the
 * requirement, and a details inside a details is two.
 */
export const STAND_DISCLOSURE = Object.freeze({
  gradability: "gradability",
  cohort: "cohort",
  anonymization: "anonymization",
  versions: "versions",
  reproducibility: "reproducibility",
  inputs: "inputs",
  departments: "departments",
  verification: "verification",
  otherActions: "other-actions",
});

/** The order the disclosures are authored and painted in. */
export const STAND_DISCLOSURE_ORDER = Object.freeze([
  // First, because it is the gate: whether this export can be graded at all
  // decides what the figures above are worth reading.
  STAND_DISCLOSURE.gradability,
  STAND_DISCLOSURE.cohort, STAND_DISCLOSURE.anonymization, STAND_DISCLOSURE.versions,
  STAND_DISCLOSURE.reproducibility, STAND_DISCLOSURE.inputs, STAND_DISCLOSURE.departments,
  STAND_DISCLOSURE.verification, STAND_DISCLOSURE.otherActions,
]);

/**
 * The disclosures `finops-stand-view.js` MOUNTS rather than the document authoring.
 *
 * Every other disclosure ships as markup in `src/evolution.html`, so a reader
 * whose JavaScript failed still meets an operable control. These do not, for one
 * measured reason: `evolution.html` is the initial payload this repository holds
 * a byte budget on (`config/evolution-size-budget.json`), and an eighth authored
 * `details` block put the document over it. Everything inside this one — the
 * digest, the row count, the per-row weights — is computed by the same modules
 * that would have to run to fill it, so there is no state in which the authored
 * markup would have carried anything a reader could use. The entry graph it
 * moved to has budget headroom; the document did not.
 *
 * A disclosure whose CONTENT would be readable without script does not belong
 * here. Author that one in the document and pay for it, or take something out.
 */
export const STAND_MOUNTED_DISCLOSURES = Object.freeze([
  STAND_DISCLOSURE.gradability, STAND_DISCLOSURE.inputs,
]);

/**
 * The visible summary of each disclosure, authored once so markup and module agree.
 *
 * Each one is a question or a plain noun phrase a first-time reader can act on.
 * "Peer set", "rubric", and "the other ways on" were names for the machinery
 * rather than for what a reader would find inside, so they are gone from every
 * summary here; the published terms they stood for are still named in the
 * entries, where there is room to say what they mean.
 */
export const STAND_DISCLOSURE_SUMMARY = Object.freeze({
  [STAND_DISCLOSURE.gradability]: "Can this export be graded?",
  [STAND_DISCLOSURE.cohort]: "How the organizations you are compared with were chosen",
  [STAND_DISCLOSURE.anonymization]: "What this comparison reads, and what it never reads",
  [STAND_DISCLOSURE.versions]: "Which scoring rules and which peer data produced these figures",
  [STAND_DISCLOSURE.reproducibility]: "Can someone else repeat this ranking?",
  [STAND_DISCLOSURE.inputs]: "Which rows this number came from, and how to check it",
  [STAND_DISCLOSURE.departments]: "Every department, ranked",
  [STAND_DISCLOSURE.verification]: "How much of this was verified",
  [STAND_DISCLOSURE.otherActions]: "Other actions, in priority order",
});

/**
 * The published band, in words that carry their own direction.
 *
 * "Top quartile" is the CHEAPEST quartile, which is exactly backwards for a
 * reader who has never seen this page and sees a large dollar figure beside the
 * word "top". The published band name is not renamed — other surfaces and the
 * reproducibility record still carry it, and it is named in the basis line
 * below — but the figure a lead reads first says which quarter they are in.
 */
export const BAND_IN_WORDS = Object.freeze({
  [COST_BAND.top]: "cheapest quarter",
  [COST_BAND.middle]: "middle half",
  [COST_BAND.bottom]: "most expensive quarter",
});

/** The eyebrow above the question, per source. */
export const STAND_LABEL = Object.freeze({
  example: "Bundled synthetic example · nothing of yours needed",
  import: "Your own export · analyzed in this browser",
});

/**
 * The one way this region fails that is nobody's data problem: the example
 * itself could not be read in this browser.
 *
 * It gets a reason code of its own so the state reads as what it is. Before
 * this, a browser that could not load the example was told "this view produced
 * no comparison" — the same sentence a reader whose export is missing a column
 * gets, which sends them to fix a file that is not the problem.
 */
export const STAND_LOAD_FAILED = "stand_example_unreadable";

/**
 * The remedy for each way `peer-cost-position.js` can withhold a position.
 *
 * These are COPY, not rules: the module above decides whether a position may be
 * published and publishes the reason; nothing here re-decides eligibility. What
 * it does not publish is a next step, and a reader who is handed a reason with
 * no remedy is being handed a dead label with more words in it.
 */
export const STAND_RESOLUTION = Object.freeze({
  [COST_POSITION_WITHHELD.missingAttributes]:
    "Declare your organization's size band and industry in the export — one column each, on any "
    + "row — and analyze it again.",
  [COST_POSITION_WITHHELD.noMatchingCohort]:
    "Check the declared size band and industry against the published cohorts listed under "
    + `"${STAND_DISCLOSURE_SUMMARY[STAND_DISCLOSURE.cohort]}", then analyze the export again.`,
  [COST_POSITION_WITHHELD.ambiguousMatch]:
    "Declare exactly one size band and one industry across the export, then analyze it again.",
  [COST_POSITION_WITHHELD.noSuccessfulTasks]:
    "Include the task ledger for this window — the rows that carry a terminal outcome — and "
    + "analyze the export again.",
  [COST_POSITION_WITHHELD.snapshotMismatch]:
    "Analyze an export covering the same window as the published peer data "
    + `(${PEER_COST_SNAPSHOT_ID}), or wait for the next peer data to be published.`,
  [COST_POSITION_WITHHELD.noSpendTotal]:
    "Include the cost column in the export so a spend total can be attributed, then analyze it "
    + "again.",
  // The reproducibility gates. Same rule as above: the refusing module publishes
  // the reason, this table publishes the one step that resolves it.
  [REPRODUCIBILITY_REFUSED.missingRubricVersion]:
    "Wait for peer data that names the version of the scoring rules it was built for. Nothing in "
    + "an export can supply that, so there is nothing to change in your file.",
  [REPRODUCIBILITY_REFUSED.rubricVersionMismatch]:
    `Wait for peer data rebuilt for scoring rules ${RUBRIC_VERSION}. Older peer data is not scored `
    + "against newer rules, so analyzing the same export again will not change this.",
  [REPRODUCIBILITY_REFUSED.insufficientSample]:
    "Analyze a window with more finished work in it — a longer period, or one that includes every "
    + "department's completed tasks — and analyze the export again.",
  // The load failure. It is not an eligibility decision and never reads like
  // one: nothing in the reader's file caused it and nothing in their file fixes
  // it, so the step is the one that has any chance of working.
  [STAND_LOAD_FAILED]:
    "Reload the page. If the ranking still does not appear, analyze your own export instead — it "
    + "is read in this browser and does not depend on the example loading.",
  [REPRODUCIBILITY_REFUSED.noMatchedCohort]:
    "Check the declared size band and industry against the published cohorts listed under "
    + `"${STAND_DISCLOSURE_SUMMARY[STAND_DISCLOSURE.cohort]}", then analyze the export again.`,
});

/** The label on the control that resolves a withheld position. One control, both sources. */
export const STAND_RESOLUTION_ACTION = Object.freeze({
  label: "Choose the export files again",
  /** The page's single file input. There is no second picker on this page. */
  targetId: "local-finops-files",
});

/**
 * What the headline says before anything has been composed into it.
 *
 * One sentence, and it does both jobs: it names the cause — the page is still
 * reading — and says what replaces it, without asking the reader to do
 * anything, because there is nothing for them to do. It used to be followed by
 * "Nothing has been read yet, so this claim rests on nothing", which read as an
 * integrity warning about a claim nobody had made and contradicted the sentence
 * before it. The four short values carry this page's one empty-slot wording.
 */
export const STAND_PENDING = Object.freeze({
  answer: "Still reading the Bundled synthetic example; the numbers below fill in when it finishes.",
  position: "Not read yet",
  recoverable: "Not read yet",
  team: "Not read yet",
  action: "Not read yet",
});

/** The load failure, in the reader's terms: what broke, and what it was not. */
export const STAND_LOAD_FAILURE_REASON =
  "The Bundled synthetic example could not be read in this browser, so there is no ranking to "
  + "show. Nothing in your own data caused this.";

/**
 * The load failure in the shape the withheld path already reads.
 *
 * A frozen position-shaped value, not a new branch: `composeStandHeadline`
 * publishes it through the same slot every other withheld reason goes through.
 */
export const STAND_LOAD_FAILURE_POSITION = Object.freeze({
  available: false, band: null, bandLabel: null, value: null, valueDisplay: null,
  reasonCode: STAND_LOAD_FAILED, reason: STAND_LOAD_FAILURE_REASON,
});

const USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});
const COUNT = new Intl.NumberFormat("en-US");

const usd = (value) => (Number.isFinite(Number(value)) ? USD.format(Number(value)) : null);
// ---------------------------------------------------------------------------
// WHAT THE WINNING CLAIM RESTS ON, at the headline rather than in a panel.
//
// A lead glancing at this region has to be able to tell, without opening
// anything, whether the sentence rests on their own imported export or on
// hand-authored synthetic cohort boundaries, and how far the page will stand
// behind it. Both values are read off the resolver's finding — `evidenceClass`
// and `confidenceTier` — and neither is re-derived here. This table is COPY for
// values that module owns, in the same way the withheld sentences are copy for
// reasons the position contract owns.
// ---------------------------------------------------------------------------

/** How each evidence class is named on the surface. */
export const STAND_EVIDENCE_LABEL = Object.freeze({
  [EVIDENCE_CLASS.ownExport]: "Your own imported export",
  [EVIDENCE_CLASS.syntheticCohort]: "Hand-authored synthetic cohort boundaries",
});

/**
 * How each confidence tier is named on the surface.
 *
 * The four names are `CONFIDENCE_LEVELS` in the resolver, and the floor is
 * spelled out rather than shown as a bare word: "Unavailable" beside a headline
 * claim reads as a broken widget, while "Confidence not stated" is what
 * actually happened. No tier is rendered that the resolver did not publish.
 */
export const STAND_CONFIDENCE_LABEL = Object.freeze({
  high: "High confidence",
  moderate: "Moderate confidence",
  low: "Low confidence",
  unavailable: "Confidence not stated",
});

/**
 * The entitlement slot: one evidence indicator and one confidence indicator.
 *
 * Total, like every other slot here. With no winning finding there is nothing
 * to be entitled to, so it says that rather than showing a tier for a claim
 * that was never made.
 */
function entitlementSlot(winner) {
  if (!winner) {
    return Object.freeze({
      available: false,
      evidenceClass: null,
      confidenceTier: null,
      evidence: "No finding was resolved, so nothing is claimed about what one would rest on.",
      confidence: STAND_CONFIDENCE_LABEL.unavailable,
    });
  }
  return Object.freeze({
    available: true,
    evidenceClass: winner.evidenceClass,
    confidenceTier: winner.confidenceTier,
    evidence: STAND_EVIDENCE_LABEL[winner.evidenceClass]
      ?? STAND_EVIDENCE_LABEL[EVIDENCE_CLASS.syntheticCohort],
    confidence: STAND_CONFIDENCE_LABEL[winner.confidenceTier]
      ?? STAND_CONFIDENCE_LABEL.unavailable,
  });
}

const entry = (term, detail) => Object.freeze({ term, detail: String(detail) });
const filled = (value) => typeof value === "string" && value.trim().length > 0;

/**
 * "2026-06-01 to 2026-07-01" → "June 2026". Null rather than a guess.
 *
 * The period a claim covers is half of what makes it repeatable, and the
 * analysis already carries it in the shape every other window on this page uses.
 * A window that spans more than one month gets both ends rather than a month
 * name that would be wrong for most of it.
 */
const MONTH = Object.freeze(["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"]);

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
 * The position line: which quarter of comparable organizations, what the metric
 * is, and the two boundaries that make the quarter checkable.
 *
 * Never a bare rank, and never a bare band name. "Bottom quartile" is a word a
 * first-time reader cannot check and can read backwards; "Most expensive
 * quarter · $38.63 per successful task", with the boundaries and the published
 * band name under it, is a claim they can repeat and someone else can verify.
 */
function positionSlot(position, period) {
  if (!position?.available) return null;
  const { cohort } = position;
  const quarter = BAND_IN_WORDS[position.band] ?? "comparison group";
  const capitalized = quarter.charAt(0).toUpperCase() + quarter.slice(1);
  return Object.freeze({
    available: true,
    label: PEER_RANK_LABEL,
    value: `${capitalized} · ${position.valueDisplay} per successful task`,
    band: position.band,
    /** The metric on its own, for the one sentence the answer repeats. */
    perTask: position.valueDisplay,
    basis: `${COST_METRIC.label}${period ? ` for ${period}` : ""}, compared with organizations `
      + `that declared the same size and industry — ${cohort.label}. A quarter of that group `
      + `spends less than ${displayCostPerSuccessfulTask(cohort.p25)} and a quarter spends more `
      + `than ${displayCostPerSuccessfulTask(cohort.p75)} per successful task, so this `
      + `organization is in the ${quarter}, measured over `
      + `${COUNT.format(position.successfulTasks)} successful tasks. ${COST_BAND_DIRECTION} `
      + `Published band name for this quarter: ${position.bandLabel}.`,
  });
}

/** The recoverable figure, beside the position rather than in a card of its own. */
function recoverableSlot(analysis) {
  const amount = usd(analysis?.recoverableUsd);
  const analyzed = usd(analysis?.spendUsd);
  const share = recoverableShare(analysis?.recoverableUsd, analysis?.spendUsd);
  if (!amount || !analyzed || share === null) {
    return Object.freeze({
      available: false,
      label: "Recoverable spend",
      value: STAND_PENDING.recoverable,
      basis: "This analysis published no spend total to divide, so no recoverable share is claimed.",
    });
  }
  return Object.freeze({
    available: true,
    label: "Recoverable spend",
    value: `${amount} · ${Math.round(share * 100)}% of analyzed spend`,
    basis: `${amount} of ${analyzed} analyzed. A modelled ceiling on what re-routing this work `
      + "could save — not money already saved.",
  });
}

/**
 * Exactly one named team, and the evidence for naming it.
 *
 * The name comes from `leadingFinding` — the same driver the department panels
 * already rank — so the headline and the breakdown can never name two different
 * departments. Runners-up are not in the headline at all; they are in the
 * ranked-departments disclosure, which is where a reader who wants a list goes.
 */
function teamSlot(finding) {
  const name = finding?.driver?.name;
  if (!finding?.available || !filled(name)) {
    return Object.freeze({
      available: false,
      label: "Department driving the increase",
      name: STAND_PENDING.team,
      detail: finding?.reason
        ?? "No department increased its spend against the prior month, so none is named here.",
    });
  }
  return Object.freeze({
    available: true,
    // "Team" here and "department" in the ranked list below were two names for
    // one thing. Every rendered surface on this page says department, so this
    // one does too.
    label: "Department driving the increase",
    name,
    detail: finding.driverSentence,
  });
}

/**
 * One action. The rank-1 destination and nothing else.
 *
 * The rank is the destination contract's own — `prioritizedDestination` reads
 * the record's `rank === 1` and the record carries the clause that promoted it.
 * This module does not re-rank, and the destinations it did not pick are put
 * behind the "other ways on" disclosure rather than dropped.
 */
function actionSlot(record) {
  const top = prioritizedDestination(record);
  if (!top || !filled(top.label) || !filled(top.href)) {
    return Object.freeze({
      available: false, label: STAND_PENDING.action, href: null,
      basis: "No destination is ranked first in the published record, so none is offered here.",
    });
  }
  return Object.freeze({
    available: true,
    label: top.callToAction ?? top.label,
    href: top.href,
    // "Do this first" is the only thing added: when, and that there is one. The
    // question it answers and the clause that ranked it are the destination
    // contract's own sentences, quoted rather than paraphrased.
    basis: `Do this first, before any spend cap is set. ${top.answers} ${top.selectionBasis}`,
  });
}

// ---------------------------------------------------------------------------
// The candidate findings.
//
// WHAT CHANGED AND WHY. This region used to assemble its headline sentence by
// construction: `answerSentence()` took the peer position, bolted the
// recoverable figure and the named department onto it, and that was the
// headline because that is what the function did. There was no ranking, so a
// stronger finding — a department two quarters behind the rest of the
// organization, a month where spend moved further than the peer gap — had no
// way to reach the top of the page.
//
// So that function is gone. Each signal this region already had now states
// itself as a CANDIDATE — a claim, an impact in a declared unit, a confidence
// level with the reasons behind it, and its provenance — and
// `finops-finding-resolver.js` ranks them against the spine manifest. The
// winner's claim is the headline. Nothing below computes a figure: every value
// is read off a result some other module already published, exactly as before.
// ---------------------------------------------------------------------------

/** The band, as a distance in quartiles from the cheapest quarter. A lookup, not arithmetic. */
const BAND_QUARTILES_FROM_CHEAPEST = Object.freeze({
  [COST_BAND.top]: 0, [COST_BAND.middle]: 1, [COST_BAND.bottom]: 2,
});

/** The band, as a direction the manifest admits. */
const BAND_SPINE_DIRECTION = Object.freeze({
  [COST_BAND.top]: SPINE_DIRECTION.betterThanPeers,
  [COST_BAND.middle]: SPINE_DIRECTION.atPeers,
  [COST_BAND.bottom]: SPINE_DIRECTION.worseThanPeers,
});

/** Reason codes for the confidence a signal states before the resolver adjusts it. */
export const STAND_CONFIDENCE_REASON = Object.freeze({
  rankingReproducible: "ranking_reproducible",
  rankingNotReproducible: "ranking_not_reproducible",
  analysisCoverage: "analysis_coverage_published",
  coverageNotPublished: "analysis_coverage_not_published",
});

/**
 * How far to trust a figure that came out of the analysis rather than the peer
 * cohorts: the coverage confidence the briefing already published, or a stated
 * "moderate" when it published none. No new measurement is taken here.
 */
function analysisConfidence(briefing) {
  const published = briefing?.coverage?.confidence ?? null;
  return ["high", "moderate", "low"].includes(published)
    ? { level: published, reasons: [STAND_CONFIDENCE_REASON.analysisCoverage] }
    : { level: "moderate", reasons: [STAND_CONFIDENCE_REASON.coverageNotPublished] };
}

/**
 * The candidate signals, in a fixed authoring order.
 *
 * The order here is authoring convenience only — the resolver's tiebreak chain
 * is total, so shuffling this array cannot change the winner, and a test
 * asserts exactly that.
 */
function standSignals({
  analysis, briefing, position, cohort, recoverable, team, finding, reproducibility, action,
  period, source,
}) {
  const signals = [];
  const actionText = action?.available ? action.label : STAND_PENDING.action;
  // Cohort-derived signals rest on the published synthetic cohorts in every
  // state, including an import: no file a reader supplies changes those
  // boundaries. Analysis-derived signals carry the source the page already
  // resolved for this render.
  const cohortProvenance = Object.freeze({
    kind: PROVENANCE_KIND.synthetic,
    label: PEER_COST_PROVENANCE.label,
    id: cohort?.snapshotId ?? PEER_COST_SNAPSHOT_ID,
    detail: reproducibility?.rubric?.inUse ?? RUBRIC_VERSION,
  });
  const analysisProvenance = Object.freeze({
    kind: source === "import" ? PROVENANCE_KIND.imported : PROVENANCE_KIND.synthetic,
    label: STAND_LABEL[source] ?? STAND_LABEL.example,
    id: analysis?.period ?? null,
    detail: analysis?.schemaVersion ?? null,
  });
  const cohortConfidence = reproducibility?.confidence?.tier
    ? { level: reproducibility.confidence.tier,
      reasons: [STAND_CONFIDENCE_REASON.rankingReproducible] }
    : { level: "low", reasons: [STAND_CONFIDENCE_REASON.rankingNotReproducible] };

  // 1. Where we stand. The claim is the one a lead repeats verbatim: position,
  //    comparison set, metric and period in the first clause, then what it is
  //    worth and who is driving it.
  if (position?.available && position.band in BAND_QUARTILES_FROM_CHEAPEST) {
    const quarter = BAND_IN_WORDS[position.band] ?? "comparison group";
    const parts = [`Your AI spend is in the ${quarter} of organizations like yours, at `
      + `${position.perTask ?? position.value} per successful task${period ? ` for ${period}` : ""}.`];
    if (recoverable?.available) {
      parts.push(`${recoverable.value.split(" · ")[0]} of that is modelled as recoverable.`);
    }
    if (team?.available) parts.push(`${team.name} is driving the increase.`);
    signals.push({
      id: "peer-position",
      signalKind: SPINE_CLAIM_KIND.peerPosition,
      claim: parts.join(" "),
      impact: {
        value: BAND_QUARTILES_FROM_CHEAPEST[position.band],
        unit: SPINE_UNIT.quartilesFromCheapest,
        direction: BAND_SPINE_DIRECTION[position.band],
      },
      confidence: cohortConfidence,
      provenance: cohortProvenance,
      recommendedAction: actionText,
    });
  }

  // 2. Which way spend moved, in the leading finding's own figures.
  if (finding?.available && Number.isFinite(Number(finding.changeUsd))) {
    const change = Number(finding.changeUsd);
    signals.push({
      id: "spend-trend",
      signalKind: SPINE_CLAIM_KIND.spendTrend,
      claim: `Analyzed AI spend moved ${finding.metric}.`,
      impact: {
        value: change,
        unit: SPINE_UNIT.usdPerMonth,
        direction: change > 0 ? SPINE_DIRECTION.increase
          : change < 0 ? SPINE_DIRECTION.decrease : SPINE_DIRECTION.flat,
      },
      confidence: analysisConfidence(briefing),
      provenance: analysisProvenance,
      recommendedAction: actionText,
    });
  }

  // 3. The widest internal gap, from the reproducibility record that measured
  //    it on the same rules and boundaries as the position above.
  const laggard = renderableLaggardName(reproducibility);
  if (laggard && Number.isInteger(reproducibility?.record?.gapBands)
    && reproducibility.record.gapBands > 0) {
    const bands = reproducibility.record.gapBands;
    signals.push({
      id: "department-gap",
      signalKind: SPINE_CLAIM_KIND.departmentGap,
      claim: `${laggard} is ${bands} quarter${bands === 1 ? "" : "s"} behind the cheapest `
        + "department that qualified, measured on the same rules and boundaries as the peer ranking.",
      impact: {
        value: bands, unit: SPINE_UNIT.quartilesBehind, direction: SPINE_DIRECTION.behind,
      },
      confidence: cohortConfidence,
      provenance: cohortProvenance,
      recommendedAction: actionText,
    });
  }

  // 4. The department driving the change, in the sentence the finding published.
  if (team?.available && finding?.driver && Number.isFinite(Number(finding.driver.deltaUsd))) {
    const delta = Number(finding.driver.deltaUsd);
    signals.push({
      id: "department-driver",
      signalKind: SPINE_CLAIM_KIND.departmentDriver,
      claim: team.detail,
      impact: {
        value: delta,
        unit: SPINE_UNIT.usdPerMonth,
        direction: delta < 0 ? SPINE_DIRECTION.decrease : SPINE_DIRECTION.increase,
      },
      confidence: analysisConfidence(briefing),
      provenance: analysisProvenance,
      recommendedAction: actionText,
    });
  }

  // 5. What is modelled as recoverable. A ceiling, and it says so.
  if (recoverable?.available && Number.isFinite(Number(analysis?.recoverableUsd))) {
    signals.push({
      id: "recoverable-spend",
      signalKind: SPINE_CLAIM_KIND.recoverableSpend,
      claim: `${recoverable.value.split(" · ")[0]} of ${usd(analysis.spendUsd) ?? "analyzed spend"} `
        + "analyzed is modelled as recoverable — a ceiling on what re-routing this work could save, "
        + "not money already saved.",
      impact: {
        value: Number(analysis.recoverableUsd),
        unit: SPINE_UNIT.usdPerMonth,
        direction: SPINE_DIRECTION.recoverable,
      },
      confidence: analysisConfidence(briefing),
      provenance: analysisProvenance,
      recommendedAction: actionText,
    });
  }
  return signals;
}

// ---------------------------------------------------------------------------
// The disclosures. Each is a flat list of term/detail pairs, one step from the
// headline, and each is built from a result some other module already produced.
// ---------------------------------------------------------------------------

const SHARE = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 0 });

/**
 * Whether this export can be graded, and every number behind that verdict.
 *
 * The headline states the verdict in one sentence; this is where a reader who
 * disputes it finds the metric, the bar, the two amounts the ratio was taken
 * over, and how much was read to get there. Nothing is computed:
 * `export-gradability.js` published all of it, including the bar, which is
 * itself derived from the tiers in `grade-eligibility.js` rather than typed
 * anywhere on this page.
 */
function gradabilityEntries(gradability) {
  if (!gradability) {
    return [entry(STAND_DISCLOSURE_SUMMARY[STAND_DISCLOSURE.gradability],
      "No export has been read on this path, so no gradability verdict was worked out.")];
  }
  const rows = [
    entry(gradability.question, gradability.answer),
    entry("Metric definition", "Sampled spend coverage — the analyzed spend of departments the "
      + "rubric scored, divided by the analyzed spend of every department in the export. Both "
      + "amounts are read through the same accessor over the same set, so the two cannot be "
      + "measured differently, and the ratio is compared before it is rounded."),
    entry("The bar", `${SHARE.format(gradability.bar)} of analyzed spend must sit in scored `
      + "departments before this page will stand behind a grade. The bar is the lowest published "
      + "coverage floor that still grades, so it moves when those thresholds move and is not a "
      + "second number typed on this page."),
    entry("Coverage measured", gradability.coverage === null
      ? "None. This export publishes no positive spend total, so coverage has no denominator — "
        + "that is not a coverage of zero, and no percentage is shown for it."
      : `${SHARE.format(gradability.coverage)} · ${usd(gradability.coveredUsd) ?? "no scored spend"}`
        + ` of ${usd(gradability.totalUsd) ?? "no analyzed spend"} analyzed.`),
    // Every row the export carried, not the rows that counted: a count that
    // silently meant "scored rows" would make a thin import look thorough.
    entry("Rows read", `${COUNT.format(gradability.provenance.rows)} department row`
      + `${gradability.provenance.rows === 1 ? "" : "s"} read — `
      + `${COUNT.format(gradability.provenance.scored)} scored, `
      + `${COUNT.format(gradability.provenance.unscored)} not scored, `
      + `${COUNT.format(gradability.provenance.unpriced)} carrying no spend.`),
    entry("What to do next", gradability.action.text),
  ];
  // The named missing input, when the evaluator named one. The action above says
  // what to do; this says which input it supplies, in that evaluator's own
  // words. Nothing on this page invents a column, header, or field name for it.
  if (gradability.missingInput) rows.push(entry("Missing input", gradability.missingInput));
  return rows;
}

function cohortEntries(position) {
  const cohort = position?.cohort ?? null;
  const rows = [
    entry("Question answered", COST_METRIC.label),
    entry("Metric definition", COST_METRIC.definition),
    entry("Published cohorts", `${COUNT.format(PEER_COST_COHORTS.length)} cohorts, each keyed on a `
      + "declared organization size band and a declared industry. A cohort is matched, never "
      + "inferred, and a match must be unique."),
  ];
  if (cohort) {
    rows.push(entry("Matched cohort", `${cohort.label} — declared band ${cohort.sizeBandLabel}, `
      + `declared industry ${cohort.industryLabel}.`));
    rows.push(entry("Quartile boundaries", `${displayCostPerSuccessfulTask(cohort.p25)} and `
      + `${displayCostPerSuccessfulTask(cohort.p75)} per successful task. `
      + COST_BAND_DIRECTION));
  }
  rows.push(entry("Where the cohorts come from",
    `${PEER_COST_PROVENANCE.label}. ${PEER_COST_PROVENANCE.statement}`));
  return rows;
}

function anonymizationEntries(note) {
  if (!note) return [entry("Anonymization", "No comparison was run, so nothing was read.")];
  return [
    entry(note.label, note.text),
    entry("Fields read", note.fieldsRead.join(", ")),
    entry(note.provenance.label, note.provenance.statement),
  ];
}

function versionEntries(analysis, briefing, position) {
  return [
    entry("Analysis schema", analysis?.schemaVersion ?? "no analysis schema"),
    entry("Briefing contract", briefing?.contractVersion ?? "no briefing contract"),
    entry("Routing scoring rules", briefing?.rubricVersion ?? "no scoring rules"),
    entry("Peer data published", position?.cohort?.snapshotId ?? PEER_COST_SNAPSHOT_ID),
    entry("Position contract", position?.version ?? STAND_VERSION),
    entry("Headline contract", STAND_VERSION),
  ];
}

/**
 * Whether a reader can repeat this ranking claim, and what they would check.
 *
 * Four things a reader is owed before they repeat a band to a director — the
 * rubric version, the cohort snapshot it was built for, the confidence in the
 * sample, and when it was last verified — plus the fingerprint that lets a
 * second run be compared with this one in a glance. Every value here is read off
 * the reproducibility result; nothing is recomputed and nothing is a constant
 * typed twice.
 *
 * A refused ranking fills the same disclosure with the refusal, so a reader who
 * opens it after seeing no band finds the reason rather than an empty list.
 */
/**
 * How a query's class was decided, per class, with the weight behind it.
 *
 * Appended to the reproducibility disclosure in BOTH of its states, because it
 * is the one part of this list that does not depend on a result: the families
 * and their weights are constants, so a reader who opens the disclosure after
 * seeing no ranking still finds the rule that would produce one. The rows are
 * composed in `query-signal-families.js` and only shaped here, the same way
 * every other row on this list is: `entry` and nothing else.
 *
 * NOTHING PROMPT-DERIVED PASSES THROUGH HERE. `signalFamilyDisclosureRows`
 * takes no argument and reads no record; both strings in every row are authored
 * English or a declared identifier and an integer.
 */
function signalFamilyRows() {
  return signalFamilyDisclosureRows().map((row) => entry(row.term, row.detail));
}

/**
 * The disclosure, in one list: the ranking rows this page already published,
 * then the classification rows. Appended after, in every state and at exactly
 * one place, so a row cannot reach one branch of the answer and miss another.
 */
function reproducibilityEntries(result) {
  return [...rankingReproducibilityEntries(result), ...signalFamilyRows()];
}

function rankingReproducibilityEntries(result) {
  if (!result) {
    return [
      entry("Ranking claim", "No cost-per-successful-task ranking was worked out on this path, so "
        + "none is claimed as repeatable. The comparison above names the group this export was "
        + "matched to, not which quarter of it the spend falls in."),
      entry("Scoring rules", `${RUBRIC_VERSION} in use · the peer data published on `
        + `${SHIPPED_COHORT_SNAPSHOT.snapshotId} was built for `
        + `${SHIPPED_COHORT_SNAPSHOT.rubricVersion}.`),
    ];
  }
  const { rubric } = result;
  const rows = [
    entry("Scoring rules", rubric.snapshot
      ? `${rubric.inUse} in use · this peer data was built for ${rubric.snapshot} · `
        + `${rubric.snapshot === rubric.inUse ? "they match, so a ranking can be published"
          : "they do not match, so no ranking is published"}.`
      : `${rubric.inUse} in use · this peer data names no version of the rules it was built for, `
        + "so nothing was scored against it."),
    entry("Peer data published",
      rubric.snapshotId ?? "This peer data carries no publication date, so none is shown here."),
    entry("Confidence in this ranking", result.confidence?.detail
      ?? `Not claimed: no ranking was published, so there is no confidence in one. ${result.reason}`),
    entry("Last verified", result.verification.detail),
  ];
  if (!result.reproducible) {
    rows.push(entry("Why no ranking is shown", result.reason));
    return rows;
  }
  rows.push(entry("Repeat-check code", `${result.fingerprint} · run this analysis again over the `
    + "same figures and you get this same code. It is computed from the "
    + `${RECORD_FIELDS.length} values the ranking depends on — the scoring rules, the peer data `
    + "and its id, the quarter, both boundaries, the metric and the spend in whole cents, the "
    + "successful-task count, and the department gap — and from no date and no clock, so a "
    + "second run is comparable with this one in a glance. It is a check for changes, not a "
    + "security digest."));
  const laggard = renderableLaggardName(result);
  if (laggard && Number.isInteger(result.record.gapBands)) {
    rows.push(entry("Widest gap between departments", `${laggard} · `
      + `${result.record.gapBands} quarter${result.record.gapBands === 1 ? "" : "s"} behind the `
      + "cheapest department that qualified, measured on the same rules and the same boundaries "
      + `as the ${PEER_RANK_LABEL.toLowerCase()} above. Departments are compared by id, never by `
      + "name."));
  }
  return rows;
}

/**
 * Which rows of the reader's OWN file the headline number came from.
 *
 * The other disclosures answer "can this ranking be repeated?" — a question
 * about the rules and the peer data. This one answers the question a director
 * asks first: which rows is this, how much did each of them put in, and is the
 * file on my desk the file the number came from. So it states four things and
 * stops: which source produced the analysis IN PLAIN WORDS, how many rows the
 * digest covers, the digest itself, and one line per named contribution with
 * the weight it carries.
 *
 * NOTHING HERE IS COMPUTED. `buildInputProvenance` does the normalizing, the
 * hashing and the division; this turns its record into the reader's sentences.
 * Every label it hands back originated in an imported file and leaves as plain
 * text, which is what makes `finops-stand-view.js`'s `textContent` assignment
 * the only rendering path it can take.
 *
 * The weight assumptions are stated BEFORE the rows that carry weights, because
 * a reader meeting "0.64" for the first time needs to know it is dollars and not
 * headcount before they read eight of them.
 */
function inputEntries(analysis, source) {
  const provenance = buildInputProvenance({ analysis, source });
  const rows = [entry("What this number is derived from",
    provenance.imported
      ? `Derived from your imported file — ${COUNT.format(provenance.rowCount)} department `
        + `row${provenance.rowCount === 1 ? "" : "s"}`
        + `${provenance.recordCount === null ? ""
          : ` covering ${COUNT.format(provenance.recordCount)} usage records`}. `
        + "Every figure in this region is your own export's."
      : `Derived from ${provenance.sourceLabel}. These are invented departments and invented `
        + "amounts, not your spend — nothing here may be forwarded as your own number. Choose "
        + "an export to replace it.")];
  if (!provenance.rowCount) {
    rows.push(entry("Rows read", "This analysis published no department rows, so there is "
      + "nothing to name behind the number and no digest to compare."));
    return rows;
  }
  rows.push(entry(`Input digest · ${provenance.digestPrefix}`,
    `${provenance.digest} · ${INPUT_DIGEST_ALGORITHM} over the `
    + `${COUNT.format(provenance.rowCount)} normalized rows — each row's attribution key, its `
    + "analyzed spend and its modelled recoverable, both in whole cents, sorted before hashing. "
    + "No clock, no file name and no row order enter it, so the same file imported twice gives "
    + "this same code and a different code means different rows. It is a check for change, not "
    + "a security digest."));
  rows.push(entry("Scoring rules for this breakdown", `${INPUT_RUBRIC_VERSION} · named and `
    + "bumped by hand. A change to which rows are named, to how a weight is defined, or to what "
    + "enters the digest moves this version; nothing derives it from a build or a date."));
  rows.push(entry("Assumption behind every weight", WEIGHT_ASSUMPTION.share));
  rows.push(entry("Assumption behind the recoverable model", WEIGHT_ASSUMPTION.model));
  for (const row of provenance.named) {
    rows.push(entry(`${row.displayLabel} · ${usd(row.recoverableUsd)}`,
      `Weight ${row.weight === null ? "not stated" : row.weight.toFixed(2)} of the `
      + `${usd(provenance.totalRecoverableUsd)} headline`
      + `${row.spendUsd === null ? "" : ` · ${usd(row.spendUsd)} analyzed spend in this row`}.`));
  }
  if (provenance.remainder) {
    rows.push(entry(`The remaining ${COUNT.format(provenance.remainder.rows)} row`
      + `${provenance.remainder.rows === 1 ? "" : "s"} · ${usd(provenance.remainder.recoverableUsd)}`,
      `Weight ${provenance.remainder.weight === null ? "not stated"
        : provenance.remainder.weight.toFixed(2)} of the headline, summed rather than named one `
      + "by one. Every one of them is listed by name under “Every department, ranked”."));
  }
  return rows;
}

function departmentEntries(analysis) {
  const ranked = Array.isArray(analysis?.rankedDepartments) ? analysis.rankedDepartments : [];
  if (!ranked.length) return [entry("Departments", "This analysis ranked no departments.")];
  return ranked.map((department, index) => entry(
    `${index + 1}. ${department.name}`,
    `${usd(department.spendUsd) ?? "no spend total"} analyzed spend · `
    + `${usd(department.recoverableUsd) ?? "no modelled recoverable"} modelled recoverable`
    + (Number.isFinite(Number(department.previousSpendUsd))
      ? ` · ${usd(department.previousSpendUsd)} in the prior period.` : ".")));
}

function verificationEntries(decision, briefing) {
  const confidence = decision?.confidence ?? null;
  const coverage = briefing?.coverage ?? null;
  const rows = [];
  if (Number.isFinite(Number(confidence?.score)) && filled(confidence?.basis)) {
    rows.push(entry("Confidence",
      `${Number(confidence.score).toFixed(2)} of 1.00 · ${confidence.band}`));
    rows.push(entry("Basis", confidence.basis));
  } else {
    rows.push(entry("Confidence",
      "No confidence score was published with this analysis, so none is claimed."));
  }
  if (coverage && Number.isFinite(Number(coverage.recordsTotal))) {
    rows.push(entry("Coverage", `${COUNT.format(coverage.recordsAnalyzed ?? 0)} of `
      + `${COUNT.format(coverage.recordsTotal ?? 0)} records analyzed · `
      + `confidence ${coverage.confidence ?? "unknown"}.`));
  }
  for (const limit of confidence?.limits ?? []) {
    rows.push(entry(`Not verified · ${limit.code}`, limit.detail));
  }
  return rows;
}

function otherActionEntries(record) {
  const supporting = supportingDestinations(record);
  if (!supporting.length) {
    return [entry("Other ways on", "The published record ranks no destination below rank 1.")];
  }
  return supporting.map((destination) => entry(
    `Rank ${destination.rank} · ${destination.label}`,
    `${destination.answers} ${destination.doesNotAnswer}`));
}

function disclosure(id, entries) {
  return Object.freeze({
    id, summary: STAND_DISCLOSURE_SUMMARY[id], entries: Object.freeze(entries),
  });
}

// ---------------------------------------------------------------------------
// Composition.
// ---------------------------------------------------------------------------

/**
 * Compose the headline from results other modules produced.
 *
 * Total, like every other composer on this page: an input this cannot read
 * resolves to a withheld headline with a reason and a remedy, because the
 * disclosures and the resolving action stay useful in exactly those cases and a
 * region that vanishes takes them with it.
 *
 * @param position a `resolveCostPosition` result, or null.
 * @param eligibility a `validateCohortAttribution` result, or null. Owns the
 *   anonymization note in both states, and owns the withheld sentence and the
 *   next step whenever the reader is looking at their own import.
 */
export function composeStandHeadline({
  analysis = null, briefing = null, position = null, finding = null, decision = null,
  destinations = null, eligibility = null, source = "example", reproducibility = null,
} = {}) {
  // THE GATE, BEFORE THE FIGURES. Whether this export can be graded decides
  // whether the figures below may be quoted at all, so it is resolved first and
  // read by the view rather than re-derived per slot.
  const gradability = gradeExport({ analysis, source });
  const recoverable = recoverableSlot(analysis);
  const team = teamSlot(finding);
  const action = actionSlot(destinations);
  const period = periodLabel(analysis);
  const placed = positionSlot(position, period);
  const withheld = placed ? null : withheldFrom(position, eligibility, source);
  // The headline claim is RESOLVED, not assembled: every signal states itself as
  // a candidate and the ranked winner's claim is what this region asserts.
  const resolution = resolveFinding(standSignals({
    analysis, briefing, position: placed, cohort: position?.cohort ?? null, recoverable, team,
    finding, reproducibility, action, period, source,
  }), { manifest: FINOPS_SPINE_MANIFEST });
  return Object.freeze({
    version: STAND_VERSION,
    question: STAND_QUESTION,
    source,
    label: STAND_LABEL[source] ?? STAND_LABEL.example,
    /**
     * The window every figure in this headline is as of, or null when the
     * analysis published none. Carried on the headline rather than recomputed
     * per surface: the answer block prints it beside the figure, and a second
     * `periodLabel` call at a second call site is a second chance to disagree.
     */
    period,
    positioned: Boolean(placed),
    /** The headline is complete when every one of its five parts is present. */
    available: Boolean(placed && recoverable.available && team.available && action.available),
    /**
     * The winning finding's claim AS IT MAY BE ASSERTED. This region asserts
     * nothing else. On own-export evidence that is the claim verbatim; on
     * synthetic cohort boundaries the resolver's claim template qualifies it,
     * so the degradation is a property of the ranked finding rather than a
     * string this composer or the view special-cases.
     */
    answer: resolution.winner?.assertedClaim ?? withheld?.missing ?? STAND_PENDING.answer,
    /** The winning finding, for a surface that wants to trace the claim. */
    finding: resolution.winner,
    /** What that claim rests on, and how far this page stands behind it. */
    entitlement: entitlementSlot(resolution.winner),
    /**
     * The rest of the ranking, in order. Returned for progressive disclosure
     * later; NOTHING renders it today, and no panel, toggle, or expander for it
     * exists on this page.
     */
    runnersUp: resolution.runnersUp,
    /** Signals that could not become findings, and why. Never silently dropped. */
    rejectedSignals: resolution.rejected,
    position: placed ?? Object.freeze({
      available: false, label: PEER_RANK_LABEL, value: STAND_PENDING.position, band: null,
      basis: withheld?.missing ?? STAND_PENDING.answer,
    }),
    recoverable,
    team,
    action,
    withheld,
    /** The gradability verdict: question, state, coverage, bar, one action. */
    gradability,
    /**
     * Whether the figures and the named department may be on screen at all.
     *
     * Derived from the verdict on every compose, never latched: an import far
     * below the bar takes them off, and the next export that clears the bar puts
     * them back. The view assigns `hidden` from this on every paint for exactly
     * that reason.
     */
    figuresSuppressed: gradability.figuresSuppressed,
    /** The reproducibility result behind the position, or null on a path that has none. */
    reproducibility,
    disclosures: Object.freeze([
      disclosure(STAND_DISCLOSURE.gradability, gradabilityEntries(gradability)),
      disclosure(STAND_DISCLOSURE.cohort, cohortEntries(position)),
      disclosure(STAND_DISCLOSURE.anonymization, anonymizationEntries(eligibility?.note ?? null)),
      disclosure(STAND_DISCLOSURE.versions, versionEntries(analysis, briefing, position)),
      disclosure(STAND_DISCLOSURE.reproducibility, reproducibilityEntries(reproducibility)),
      disclosure(STAND_DISCLOSURE.inputs, inputEntries(analysis, source)),
      disclosure(STAND_DISCLOSURE.departments, departmentEntries(analysis)),
      disclosure(STAND_DISCLOSURE.verification, verificationEntries(decision, briefing)),
      disclosure(STAND_DISCLOSURE.otherActions, otherActionEntries(destinations)),
    ]),
  });
}

/**
 * The action-led path for a position that cannot be shown.
 *
 * Two sources, one shape. An import's sentence and remedy are the eligibility
 * result's own, verbatim — that module already decided why the file cannot be
 * placed and what would fix it, and paraphrasing it here would be a second
 * eligibility rule wearing the first one's clothes. The bundled path has no
 * eligibility result, so the reason is the position contract's and the remedy
 * comes from the copy table above.
 */
function withheldFrom(position, eligibility, source) {
  if (source === "import" && eligibility && eligibility.eligible === false) {
    return Object.freeze({
      reasonCode: eligibility.reason,
      missing: eligibility.reasonText,
      nextStep: eligibility.nextStep,
      actionLabel: STAND_RESOLUTION_ACTION.label,
    });
  }
  const code = position?.reasonCode ?? null;
  return Object.freeze({
    reasonCode: code,
    missing: position?.reason
      ?? "No ranking: this view produced no comparison to place this organization in.",
    nextStep: STAND_RESOLUTION[code]
      ?? "Analyze a provider export that declares an organization size band and an industry.",
    actionLabel: STAND_RESOLUTION_ACTION.label,
  });
}

/**
 * The bundled example headline. No arguments, no storage, no network, no import.
 *
 * This is the first-load path, and it is the DEFAULT path: the page calls this
 * on boot before anything has been chosen, so a lead who lands with cleared
 * storage reads the complete headline rather than an invitation to produce one.
 *
 * `loadAnalysis` and `loadDecision` are injectable for tests only. Neither has a
 * caller that passes anything but the shipped default.
 */
export function buildStandHeadline(loadAnalysis = loadExampleDataset,
  loadDecision = loadCanonicalDecision) {
  try {
    const analysis = loadAnalysis();
    const briefing = buildFinopsBriefing(analysis);
    let decision = null;
    try {
      const loaded = loadDecision();
      decision = loaded?.valid ? (loaded.decision ?? null) : null;
    } catch {
      decision = null;
    }
    // The position is read through the reproducibility gate rather than beside
    // it. That is what makes "refusal over a weaker number" structural: a rubric
    // version the cohort snapshot was not built for, or a sample under the
    // published floor, has no path to this surface that still carries a band.
    const reproducibility = evaluateRankingReproducibility({
      org: EXAMPLE_ORG_COHORT_PROFILE,
      spendUsd: Number(analysis?.spendUsd),
      tasks: EXAMPLE_TASK_LEDGER,
      analysis,
    });
    return composeStandHeadline({
      analysis,
      briefing,
      decision,
      source: "example",
      reproducibility,
      position: reproducibility.position,
      finding: leadingFinding(analysis),
      destinations: loadWorkspaceDestinations().record,
      // The bundled example imports nothing, so the eligibility result carries
      // no position — but it does carry the anonymization note, which is a
      // statement about what the comparison read and is owed in both states.
      eligibility: validateCohortAttribution({}),
    });
  } catch {
    // The example could not be read. Same withheld slot, its own reason: a
    // reader is told what failed and that their own data is not the cause.
    return composeStandHeadline({ source: "example", position: STAND_LOAD_FAILURE_POSITION });
  }
}

/**
 * The headline for a reader's own import.
 *
 * The eligibility decision is Anya's, unchanged and unreinterpreted: this passes
 * the result through and lets `withheldFrom` read the sentence and the next step
 * off it. When the import IS eligible the cohort it was placed against becomes
 * the position line, because that is the placement the import contract
 * publishes; the quartile band on cost per successful task belongs to the
 * bundled path, which is the only one that ships a task ledger to divide by.
 */
export function standHeadlineForImport({ analysis = null, eligibility = null } = {}) {
  let briefing = null;
  try {
    briefing = buildFinopsBriefing(analysis);
  } catch {
    briefing = null;
  }
  const composed = composeStandHeadline({
    analysis,
    briefing,
    eligibility,
    source: "import",
    finding: analysis ? leadingFinding(analysis) : null,
    destinations: loadWorkspaceDestinations().record,
  });
  if (!eligibility?.eligible || !eligibility.position) return composed;
  const { position } = eligibility;
  const placed = Object.freeze({
    available: true,
    label: PEER_RANK_LABEL,
    value: `Compared with ${position.label}`,
    band: null,
    basis: `${COUNT.format(position.memberCount)} organizations in ${position.segmentLabel} · `
      + `declared band ${position.orgSizeBand} · declared industry ${position.industry} · `
      + `${COUNT.format(position.orgUnits)} attributed org unit`
      + `${position.orgUnits === 1 ? "" : "s"} counted from this export · cohort snapshot `
      + `${position.snapshotDate}`,
  });
  // The answer is NOT rebuilt here. This path used to compose a second headline
  // sentence of its own — a placement clause with the recoverable figure and the
  // named department bolted on — which meant two per-signal headline
  // computations ran on this page, one per source. There is one now: the
  // composed resolution above ranked the signals this import supports, and the
  // placement it was matched to is stated in the position slot, which is where
  // the import contract publishes it.
  return Object.freeze({
    ...composed,
    positioned: true,
    withheld: null,
    position: placed,
    available: Boolean(composed.recoverable.available && composed.team.available
      && composed.action.available),
  });
}
