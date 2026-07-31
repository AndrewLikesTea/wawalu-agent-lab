// The AI FinOps answer spine: one question, one number, one action, one file,
// and an ordered classification of everything beneath them.
//
// THE PROBLEM THIS SOLVES. /evolution.html has 31 top-level regions. Two
// different modules already had an opinion about which one is "the" answer, and
// they disagreed:
//
//   * src/finops/answer-spine-view.js declares #finops-stand the `headline` —
//     it is the first region of `main`, it carries the reader's question as its
//     own heading, and it is what a first-time lead actually reads first.
//   * src/finops-decision-contract.js held a second, hard-coded precedence
//     table — `FRONT_DOOR_SUMMARY_ID = "finops-first-run"` — and counted
//     "complete summaries" by asking the markup what it thought it was
//     (`data-decision-summary="complete"`). Any region could self-declare.
//
// Two referees is one referee too many, and a markup attribute that lets a
// region promote itself is not a referee at all. This module is the single
// source of truth. `countCompleteSummaries` in the decision contract no longer
// carries a table: it takes the authorized ids, and the only caller that
// supplies them is `completeSummaries` below, which reads them from here.
//
// WHAT THIS MODULE IS. Data, not markup, and not a painter of numbers. It
// states the question, defines the one headline metric precisely enough that
// two engineers compute it identically, names the one action and the one
// forwardable artifact, classifies every top-level region with a role and an
// order, and states what the page may truthfully claim before the reader has
// imported anything. It computes no figure: the FinOps modules keep every
// number they already own. `src/finops-answer-spine-view.js` is the thin
// painter that puts these strings on the page.
//
// WHERE THE REGION LIST COMES FROM. `ANSWER_SPINE` in
// src/finops/answer-spine-view.js is already the checked-against-the-document
// list of top-level regions, in reading order, and a test there fails the build
// when the page and the list diverge. This module derives `evidenceLayers` from
// it rather than restating it, so there is exactly one place a new region has
// to be declared — and a region added to the page without an entry there fails
// that module's audit before it can escape classification here.
//
// THE THREE ROLES. `answer` (exactly one, and it is the region a first-time
// lead reads before anything else), `evidence` (everything that supports the
// answer without restating it), `removed` (declared dead; a later collapse pass
// deletes it). The four-role vocabulary next door is finer-grained — it
// separates steps from disclosure details — and it maps down cleanly: the
// headline is the answer, steps and details are both evidence, retired is
// removed. Marking a role here is the deliverable; deleting the markup is not.

import { ANSWER_SPINE, ROLE } from "./finops/answer-spine-view.js";
import { countCompleteSummaries } from "./finops-decision-contract.js";

/** Bump when a role, a metric rule, or the pre-import contract changes meaning. */
export const ANSWER_SPINE_CONTRACT_VERSION = "finops-answer-spine-contract/1.0.0";

/** The three roles a top-level region may hold in the spine. */
export const LAYER_ROLE = Object.freeze({
  answer: "answer",
  evidence: "evidence",
  removed: "removed",
});

/** How the four-role manifest next door maps onto the three roles here. */
const ROLE_FROM_MANIFEST = Object.freeze({
  [ROLE.headline]: LAYER_ROLE.answer,
  [ROLE.step]: LAYER_ROLE.evidence,
  [ROLE.detail]: LAYER_ROLE.evidence,
  [ROLE.retired]: LAYER_ROLE.removed,
});

// ---------------------------------------------------------------------------
// 1. THE QUESTION
// ---------------------------------------------------------------------------

/**
 * The one question this page answers, in the words a leader uses.
 *
 * Taken from the answer region's own entry rather than re-typed, so the heading
 * a reader sees, the manifest, and this contract cannot drift apart.
 */
export const SPINE_QUESTION =
  ANSWER_SPINE.find((entry) => entry.role === ROLE.headline)?.question ?? null;

// ---------------------------------------------------------------------------
// 2. THE HEADLINE METRIC
// ---------------------------------------------------------------------------

/**
 * One material number, defined so two engineers compute it identically.
 *
 * WHAT WAS NARROWED. The obvious executive metric — "how much are we wasting" —
 * is not available on this page as a measured figure, and nothing here will
 * pretend otherwise. What the loaded analysis actually publishes is a modelled
 * ceiling on what re-routing could recover under one authored rule version. So
 * the headline is the *recoverable share of analyzed spend*, and every word of
 * `basisLimits` exists to stop that ceiling being read as a saving. See
 * `narrowing` below; the same narrowing is stated in the pull request.
 */
export const HEADLINE_METRIC = Object.freeze({
  id: "recoverable-share-of-analyzed-spend",
  label: "Recoverable spend",
  /** The question the number answers, not the widget that displays it. */
  question: "How much of what we spend is recoverable?",
  statement: "Modelled recoverable spend as a share of analyzed AI spend, over the analyzed window.",

  /** The exact quotient. Both terms name the field they are read from. */
  numerator:
    "analysis.recoverableUsd — the sum of the per-department down-routing scenario values in USD "
    + "over the window, under rule version down-routing-candidate/1.0.0. A modelled ceiling on what "
    + "re-routing the same work could recover; never an invoiced or realized saving.",
  denominator:
    "analysis.spendUsd — analyzed AI spend in USD over the same window: every provider record the "
    + "loaded dataset carries for that window, not a subset chosen after the figure was known.",
  aggregation:
    "numerator ÷ denominator, computed once over the whole window. It is not the mean of the "
    + "per-department shares, which would weight a small department the same as a large one.",

  unit: "percent of analyzed spend, presented beside the USD amount it was divided from",
  currency: "USD",

  window: Object.freeze({
    shape: "A half-open interval [start, end): start inclusive, end exclusive.",
    format: "Both ends RFC-3339 instants in UTC.",
    anchor:
      "Anchored to the loaded dataset's own authored period (briefing.materialMetric.period), never "
      + "to the browser clock — so the same dataset shows the same figure on every open and in every "
      + "timezone.",
    sameWindowRule:
      "Numerator and denominator are read over one identical window. A pair measured over two "
      + "windows is not this metric and must render the unavailable state instead.",
  }),

  /** Which records are in, and which are out. Stated, not implied. */
  inclusion: Object.freeze([
    "Every provider spend record the loaded dataset carries inside the window.",
    "Every department the routing rubric could score, including departments whose modelled "
      + "recoverable amount is zero.",
  ]),
  exclusion: Object.freeze([
    "Records outside the window, including a record exactly at `end` — the interval is end-exclusive.",
    "Records the loaded adapter could not parse; they lower the coverage figure this page reports "
      + "separately, and they are never silently counted as zero spend.",
    "Prompt or conversation text of any kind. This page reads aggregates and nothing else.",
  ]),

  rounding: Object.freeze({
    share: "The unrounded quotient is never displayed. Displayed rounded half-up to a whole percent.",
    amount: "USD amounts formatted with Intl.NumberFormat('en-US'), no decimal places.",
    presentation: "\"$X · N% of analyzed spend\" — the amount first, the share as its qualifier.",
  }),

  /**
   * WHEN THE NUMBER MAY NOT BE SHOWN. An empty or partial dataset must never
   * produce a misleadingly precise figure, and a share of nothing is unknown,
   * not zero. These strings are what the page paints instead.
   */
  unavailable: Object.freeze({
    state: "unavailable",
    /** The exact string in the value slot. Never "0%", never "—". */
    value: "Not yet measured",
    /** The exact sentence beside it. */
    basis: "This analysis published no spend total to divide, so no recoverable share is claimed.",
    /** Every condition that produces the state above. */
    conditions: Object.freeze([
      "analysis.spendUsd is missing, not finite, or not greater than zero.",
      "analysis.recoverableUsd is missing, not finite, or negative.",
      "No analysis has been loaded yet.",
      "The numerator and denominator were measured over different windows.",
    ]),
  }),

  basisLimits: Object.freeze([
    "A ceiling, not a saving. Nothing on this page has been invoiced or verified.",
    "Modelled under one authored rule version; a different routing rule gives a different ceiling.",
  ]),

  narrowing:
    "Narrowed from \"how much are we wasting\" to \"what share is modelled as recoverable\". The "
    + "page has no realized-saving, invoice, or post-change measurement to divide, so a waste figure "
    + "would have to be invented. The recoverable share is the widest claim the data honestly "
    + "supports.",
});

// ---------------------------------------------------------------------------
// 3. THE ONE ACTION
// ---------------------------------------------------------------------------

/**
 * One prioritized next action, expressed as something the lead does.
 *
 * The wording of the concrete action — which department, which routing change —
 * is computed by the finding resolver and painted into `#finops-stand-action`.
 * This entry owns the *shape*: what kind of thing it is, when it appears, and
 * what it changes. A definition here plus a computed sentence there is one
 * action; a second authored sentence would be a second action.
 */
export const PRIORITIZED_ACTION = Object.freeze({
  id: "rank-1-routing-pilot",
  label: "Pilot the rank-1 routing change on the department named above",
  doer: "The FinOps lead, with the named department's owner accountable for the change.",
  renderedInto: "finops-stand-action",
  source:
    "Rank 1 of the finding resolver's action ranking (src/finops-finding-resolver.js), over the "
    + "loaded analysis. Rank 1 only: a list is not a decision.",
  shownWhen:
    "A loaded analysis ranked at least one action AND the headline metric is available. The runners-up "
    + "stay behind the \"Other actions, in priority order\" disclosure.",
  hiddenWhen:
    "No analysis has been read, or nothing could be ranked. The control is hidden and the region "
    + "claims no action rather than showing a disabled one.",
  changes:
    "It moves the lead from reading to a scoped pilot on one named department, and links to the "
    + "evidence that ranked it so the pilot can be defended before it is funded.",
  doesNotChange:
    "It commits no budget and promises no saving. The figure it acts on is a modelled ceiling.",
});

// ---------------------------------------------------------------------------
// 4. THE ONE FORWARDABLE ARTIFACT
// ---------------------------------------------------------------------------

/**
 * The one thing a lead forwards. It is the export this page already ships —
 * the briefing file written by `briefingFile` in src/finops-briefing-export.js
 * behind the "Export briefing (JSON)" control. No new export path.
 */
export const FORWARDABLE_ARTIFACT = Object.freeze({
  id: "finops-briefing-file",
  label: "Export briefing (JSON)",
  control: "export-local-json",
  producedBy: "briefingFile() in src/finops-briefing-export.js",
  fileVersion: "finops-briefing-file/1.0.0",
  mediaType: "application/json",
  fileNames: Object.freeze({ user: "local-finops-briefing.json", example: "example-finops-briefing.json" }),
  recipientCanVerify: Object.freeze([
    "The same headline metric, with the numerator, the denominator, and the window it was taken over.",
    "Which dataset produced it — a user import or the bundled synthetic example, named in the file.",
    "How much of the input was analyzed, and the attributed share of spend behind any figure that "
      + "presents itself as complete.",
    "The rank-1 action and the accountable role, with the rule version that ranked it.",
  ]),
  recipientCannotVerify: Object.freeze([
    "That any saving occurred. The file carries a modelled ceiling and says so.",
    "Anything about a real organization when the dataset is the bundled example; the file carries "
      + "the example-data notice for exactly that reason.",
  ]),
  privacy: "Written in the browser tab and downloaded locally. Nothing is uploaded and no prompt text is included.",
});

// ---------------------------------------------------------------------------
// 5. THE EVIDENCE LAYERS
// ---------------------------------------------------------------------------

/**
 * What each region adds that the region above it does not.
 *
 * One line per top-level region, keyed by id. This is the product judgement the
 * page kept re-litigating; keeping it as data means a reader of the codebase
 * can see the whole reading order at once. Every id in `ANSWER_SPINE` must
 * appear here — `validateAnswerSpineContract` fails otherwise, so a region
 * added to the page cannot slip through unclassified.
 */
const LAYER_ADDS = Object.freeze({
  "finops-stand": "The answer itself: where we stand, the recoverable figure, the department, and the one action.",
  "finops-hero": "What the page can tell you at all, and the single input it needs — no figure of its own.",
  "finops-first-run": "The bundled example decision in full, with its confidence score and the basis for it.",
  "finops-next-step": "Narrows the ranked actions to the one to start this month, out of what this browser holds.",
  "finops-journey": "Adds the checkpoint: what would tell you the action worked, and which phase you are in.",
  "finops-destinations": "Adds where to go to act, ranked, with the clause that promoted the first door.",
  "finops-workspace-nav": "Wayfinding between working areas; carries no claim of its own.",
  "finops-workspace-switch": "Names which working area is currently on screen.",
  "finops-workspace-context": "Names what the reader carried here from the answer, so the context is not re-derived.",
  "finops-first-run-conversion": "Nothing the contact region below does not already ask, and it asks it worse.",
  "finops-load-state": "Whether the page is still reading something, so a blank slot is not read as a zero.",
  "score-card": "The letter grade the example data earned, as a single graded artifact.",
  "finops-portfolio-brief": "Adds the across-provider view once more than one export was combined.",
  "guided-result": "The reader's own headline once their import has been analyzed, replacing the example's.",
  "local-import": "The path to run all of this on the reader's own numbers without uploading them.",
  "prompt-coaching": "Adds prompt quality, which no spend figure above can speak to.",
  "finops-contact": "Who to ask about the result, and what happens to the ask.",
  "finops-proof-point": "One worked example of what an action looks like in practice.",
  "finops-headline": "Whether the grade on screen belongs to the reader or to the example.",
  "disclosure-grade-comparisons": "Adds the comparison the grade alone lacks: cohort, and the team that needs coaching.",
  "graded-sample": "The specific prompts behind the grade, so the grade can be checked.",
  "org-coaching": "Which department needs coaching now, which the grade does not name.",
  "spend-per-delivery": "Adds delivery as a denominator: whether spend kept pace with what shipped.",
  "department-evidence": "The records behind one department's grade.",
  "department-fix-pack": "What that department does first, given its evidence.",
  "monthly-department-decision": "Adds the monthly cadence: which department action to take this month.",
  "disclosure-spend-and-recovery": "The period spend and recoverable totals the headline share was divided from.",
  "disclosure-department-priority": "Which department needs help first, and the direction it is trending.",
  "disclosure-spend-mix": "What the spend was actually asked to do — the mix behind the total.",
  "disclosure-savings-portfolio": "Whether projected savings became verified savings, which no projection can say.",
  "disclosure-recommendation-evidence": "How a recommendation earned its score, one rung below the recommendation.",
  "finops-privacy": "What the page reads and never reads — the boundary every claim above sits inside.",
});

/**
 * Every top-level FinOps region, in reading order, with its role.
 *
 * `order` is the declaration index of `ANSWER_SPINE`, which that module holds
 * equal to the document's own top-level order. A `removed` entry keeps its
 * index so the tombstone still says where the question used to sit.
 */
export const EVIDENCE_LAYERS = Object.freeze(ANSWER_SPINE.map((entry, index) => Object.freeze({
  id: entry.id,
  role: ROLE_FROM_MANIFEST[entry.role] ?? null,
  question: entry.question,
  adds: LAYER_ADDS[entry.id] ?? null,
  order: index,
  ...(entry.supersededBy ? { supersededBy: entry.supersededBy } : {}),
})));

// ---------------------------------------------------------------------------
// 6. THE PRE-IMPORT CONTRACT
// ---------------------------------------------------------------------------

/**
 * What the page may truthfully claim before the lead has imported anything.
 *
 * Stated as fields rather than prose because downstream tasks satisfy it: a
 * region that paints a figure before an import has to be able to look up
 * whether that figure is absent or demo, and which words label it.
 */
export const PRE_IMPORT_STATE = Object.freeze({
  id: "finops-answer-spine-pre-import/1.0.0",

  /** True the moment the reader's own export has been analyzed, false until then. */
  readerDataPresent: false,

  /** Figures that do not exist at all before an import. No placeholder number. */
  absent: Object.freeze([
    Object.freeze({
      slot: "finops-stand-recoverable-value",
      claim: HEADLINE_METRIC.unavailable.value,
      reason: "No analysis has been read, so there is nothing to divide.",
    }),
    Object.freeze({
      slot: "finops-stand-position-value",
      claim: "Not yet compared",
      reason: "No import means no figure to place against the cohort boundaries.",
    }),
    Object.freeze({
      slot: "finops-stand-action",
      claim: "Not yet ranked",
      reason: "Nothing has been ranked, so the control stays hidden rather than showing a stub.",
    }),
  ]),

  /**
   * Figures that ARE shown before an import, because the bundled synthetic
   * example fills them. Each is labelled as invented at the point it is read.
   */
  demo: Object.freeze([
    Object.freeze({
      slot: "finops-stand",
      dataset: "bundled-synthetic-example",
      label: "Bundled synthetic example · nothing of yours needed",
    }),
    Object.freeze({
      slot: "finops-first-run",
      dataset: "bundled-synthetic-example",
      label: "Bundled synthetic example",
    }),
  ]),

  /** The words that must travel with any pre-import figure. */
  labelling: Object.freeze({
    datasetName: "Bundled synthetic example",
    marker:
      "Every figure comes from invented data for an invented company. It is not your spend, customer "
      + "data, or realized savings.",
    rule: "A demo figure is never shown without its label in the same region a reader reads it in.",
  }),

  /** What the page must never claim before an import. */
  mustNotClaim: Object.freeze([
    "That any figure describes the reader's own organization.",
    "A zero where the honest state is unknown.",
    "A realized or invoiced saving.",
  ]),

  /** What changes the moment the reader analyzes their own export. */
  onImport: Object.freeze({
    label: "Your own export · analyzed in this browser",
    changes: Object.freeze([
      "The headline metric is recomputed from the reader's records and the example's figure is retired.",
      "The dataset label flips from the bundled example to the reader's own export.",
      "The forwardable artifact is written from the reader's data and its file name becomes "
        + "local-finops-briefing.json.",
    ]),
    unchanged: Object.freeze([
      "The metric definition, its window rule, and its rounding rule.",
      "The privacy boundary: the export stays in the browser tab and no prompt text is read.",
    ]),
  }),
});

// ---------------------------------------------------------------------------
// The spine, assembled.
// ---------------------------------------------------------------------------

/** The whole contract as one frozen object, in the order a lead reads it. */
export const FINOPS_ANSWER_SPINE = Object.freeze({
  contractVersion: ANSWER_SPINE_CONTRACT_VERSION,
  question: SPINE_QUESTION,
  headlineMetric: HEADLINE_METRIC,
  action: PRIORITIZED_ACTION,
  artifact: FORWARDABLE_ARTIFACT,
  evidenceLayers: EVIDENCE_LAYERS,
  preImportState: PRE_IMPORT_STATE,
});

// ---------------------------------------------------------------------------
// Reading the spine.
// ---------------------------------------------------------------------------

/** The one layer with role `answer`. Null if the manifest ever loses it. */
export function answerLayer(spine = FINOPS_ANSWER_SPINE) {
  return spine.evidenceLayers.find((layer) => layer.role === LAYER_ROLE.answer) ?? null;
}

/** The id of the region a first-time lead reads before anything else. */
export function answerRegionId(spine = FINOPS_ANSWER_SPINE) {
  return answerLayer(spine)?.id ?? null;
}

/** The layer for a region id, or null when the id is not classified. */
export function layerFor(id, spine = FINOPS_ANSWER_SPINE) {
  return spine.evidenceLayers.find((layer) => layer.id === id) ?? null;
}

/**
 * Region ids in spine order. `role` filters; `includeRemoved` is false by
 * default because a `removed` region is not part of the reading order — it is
 * a tombstone waiting for a collapse pass.
 */
export function orderedRegionIds({ role = null, includeRemoved = false } = {}, spine = FINOPS_ANSWER_SPINE) {
  return Object.freeze(spine.evidenceLayers
    .filter((layer) => (role ? layer.role === role : includeRemoved || layer.role !== LAYER_ROLE.removed))
    .map((layer) => layer.id));
}

/**
 * The single-summary referee, with the authorization supplied from here.
 *
 * `countCompleteSummaries` used to select on `data-decision-summary="complete"`,
 * which meant any region could promote itself by editing one attribute. It now
 * takes the authorized ids and has no table of its own; the spine is where the
 * answer is decided, so this is the only place those ids come from.
 */
export function completeSummaries(doc, spine = FINOPS_ANSWER_SPINE) {
  return countCompleteSummaries(doc, orderedRegionIds({ role: LAYER_ROLE.answer }, spine));
}

/**
 * Validate the spine itself: exactly one answer, every region classified, every
 * order index contiguous and in document order.
 *
 * Returns the errors rather than throwing, so a caller can report all of them.
 */
export function validateAnswerSpineContract(spine = FINOPS_ANSWER_SPINE) {
  const errors = [];
  const layers = spine.evidenceLayers ?? [];

  const answers = layers.filter((layer) => layer.role === LAYER_ROLE.answer);
  if (answers.length !== 1) {
    errors.push(`evidenceLayers: expected exactly one answer region, found ${answers.length}`);
  }

  const roles = new Set(Object.values(LAYER_ROLE));
  const seen = new Set();
  layers.forEach((layer, index) => {
    if (!layer.id) errors.push(`evidenceLayers[${index}].id: missing`);
    if (!roles.has(layer.role)) errors.push(`evidenceLayers[${index}] (${layer.id}): invalid role "${layer.role}"`);
    if (!layer.adds) errors.push(`evidenceLayers[${index}] (${layer.id}): missing what this layer adds`);
    if (layer.order !== index) errors.push(`evidenceLayers[${index}] (${layer.id}): order ${layer.order} is not its position`);
    if (seen.has(layer.id)) errors.push(`evidenceLayers: duplicate region "${layer.id}"`);
    seen.add(layer.id);
  });

  for (const id of Object.keys(LAYER_ADDS)) {
    if (!seen.has(id)) errors.push(`evidenceLayers: "${id}" is described but is not a region`);
  }

  if (!spine.question) errors.push("question: missing");
  if (!spine.headlineMetric?.unavailable?.value) errors.push("headlineMetric.unavailable.value: missing");

  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
