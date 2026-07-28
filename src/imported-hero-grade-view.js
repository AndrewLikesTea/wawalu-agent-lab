// The hero grade card, drawn from the visitor's own imported corpus.
//
// `imported-corpus-grade.js` already answers "does this corpus earn a letter,
// and how confident is that letter?" — but nothing on the page asked it. The
// hero card was painted once, from the bundled seed, and an import left the
// bundled letter sitting under an imported heading. The panel contract hides
// those figures while the question is unanswerable, which stops the lie; it
// does not make the card *answer* once the reader's own file can.
//
// This module is that missing half, and it is deliberately two pieces:
//
//   `importedHeroGrade`  pure. Corpus grade in, four sentences out. No DOM, no
//                        clock, no wording invented that the grade module has
//                        already published.
//   `applyImportedHeroGrade`  writes those four sentences into the four slots
//                        the panel contract already declares as this panel's
//                        figures, plus the next action beside them.
//
// WHAT IT WILL NOT DO. It never decides whether the panel may show a figure —
// `finops-panel-contract.js` owns that and runs after this paint, so a card
// filled here can still be covered by the contract's sentence. Painting a slot
// and revealing it are two decisions, and one module holding both is how the
// hero drifted from the panel beneath it in the first place.
//
// PRIVACY. Counts, a letter, a composite, and published rule text. No prompt,
// no model identifier, and no cell value from an imported file reaches a node.

import {
  CORPUS_CONFIDENCE_TIERS, CORPUS_ELIGIBILITY, CORPUS_NOT_GRADEABLE,
} from "./imported-corpus-grade.js";

export const IMPORTED_HERO_VERSION = "imported-hero-grade-view/1.0.0";

/** The slots the hero panel declares as its figures, plus the action beside them. */
export const HERO_SLOTS = Object.freeze({
  grade: "score-grade",
  value: "score-value",
  coverage: "score-coverage",
  peer: "score-peer",
  action: "score-action",
  card: "score-card",
});

/**
 * The next step, per state, and where each sentence comes from.
 *
 * A graded corpus is told what would strengthen the letter it already has; an
 * ungraded one is told what would produce a letter at all. Both are derived
 * from the published floor and the published tier table rather than authored
 * as free-standing copy, so raising a threshold moves this sentence with it.
 */
function nextAction(corpus) {
  const floor = CORPUS_ELIGIBILITY.minScoredRecords;
  if (!corpus.gradeable) {
    if (corpus.reason === CORPUS_NOT_GRADEABLE.noSourceRecords) {
      return {
        available: false,
        text: "Add a query sample export. A provider invoice prices the work; only a query "
          + "sample says what the work was, and the grade is a claim about the work.",
      };
    }
    if (corpus.reason === CORPUS_NOT_GRADEABLE.noneClassified) {
      return {
        available: true,
        text: `Fill the category column on the query sample. ${corpus.records.source} `
          + `record${corpus.records.source === 1 ? " was" : "s were"} read and none carried a `
          + "category this rubric recognises, so none could be scored.",
      };
    }
    const short = floor - corpus.records.scored;
    return {
      available: true,
      text: `Add ${short} more scored record${short === 1 ? "" : "s"}. `
        + `${corpus.records.scored} of the ${corpus.records.source} imported record`
        + `${corpus.records.source === 1 ? "" : "s"} scored, and the declared floor is ${floor}.`,
    };
  }
  // Graded. The tiers are ordered high to low, so the tier that would be earned
  // next is the last one strictly above the level currently held.
  const held = CORPUS_CONFIDENCE_TIERS.findIndex((tier) => tier.level === corpus.confidence.level);
  const next = held > 0 ? CORPUS_CONFIDENCE_TIERS[held - 1] : null;
  if (!next) {
    return {
      available: false,
      text: `This corpus is at the published high-confidence floor (${floor * 4} scored records). `
        + "No further sample is needed for the letter to be reportable.",
    };
  }
  const target = floor * next.minFloorMultiple;
  const short = Math.max(0, target - corpus.records.scored);
  return {
    available: true,
    text: `Add ${short} more scored record${short === 1 ? "" : "s"} to reach ${target} and raise `
      + `this to ${next.label.toLowerCase()}. ${next.rule}`,
  };
}

/**
 * The four hero sentences for one imported corpus.
 *
 * Every figure is the grade module's own: the letter, the composite, the named
 * confidence level and its stated arithmetic, and the two record counts. The
 * only thing composed here is the order they are read in.
 */
export function importedHeroGrade(corpus, { files = [] } = {}) {
  if (!corpus) return null;
  const names = files.filter(Boolean);
  const source = `${corpus.records.scored} of ${corpus.records.source} imported record`
    + `${corpus.records.source === 1 ? "" : "s"} scored`;
  const provenance = names.length ? ` · ${names.join(", ")}` : "";
  if (!corpus.gradeable) {
    return Object.freeze({
      version: IMPORTED_HERO_VERSION,
      available: false,
      band: "review",
      metricState: "needs-review",
      gradeState: corpus.reason,
      coverageTier: "insufficient",
      grade: "!",
      value: `No grade · ${source}`,
      coverage: corpus.reasonRule,
      peer: `${corpus.rubricVersionId} · ${corpus.version}. ${CORPUS_ELIGIBILITY.assumption}`,
      action: nextAction(corpus),
    });
  }
  const { confidence } = corpus;
  return Object.freeze({
    version: IMPORTED_HERO_VERSION,
    available: true,
    band: corpus.composite >= 80 ? "good" : corpus.composite >= 65 ? "watch" : "poor",
    metricState: "available",
    gradeState: "graded",
    coverageTier: confidence.level,
    grade: corpus.grade,
    value: `${corpus.composite} / 100 · grade ${corpus.grade}`,
    // Grade, confidence, and record count in one line of sight, which is the
    // whole point: a letter whose sample size sits three paragraphs away is a
    // letter a reader quotes without its qualifier.
    coverage: `${confidence.label} · ${source}${provenance}`,
    peer: `${corpus.rubricVersionId} · ${confidence.rule} ${confidence.basis.arithmetic}.`,
    action: nextAction(corpus),
  });
}

const byId = (doc, id) => (doc?.getElementById ? doc.getElementById(id) : null);

function write(doc, id, text) {
  const node = byId(doc, id);
  if (node) node.textContent = text;
  return node;
}

/**
 * Paint the hero card from an imported corpus.
 *
 * Nothing is hidden or revealed here. The four figure slots are filled and the
 * card's own data attributes are set; whether a reader sees them is the panel
 * contract's call, made afterwards from the same counts this grade was built
 * from. Returns the model that was painted, or null when there was none.
 */
export function applyImportedHeroGrade(doc, model) {
  if (!model) return null;
  const card = byId(doc, HERO_SLOTS.card);
  if (card) {
    card.dataset.band = model.band;
    card.dataset.metricState = model.metricState;
    card.dataset.coverageTier = model.coverageTier;
    card.dataset.gradeState = model.gradeState;
    // Whose numbers these are, on the element itself, so a reviewer comparing a
    // screenshot against an export can tell an imported letter from a bundled
    // one without reading the provenance line.
    card.dataset.basis = "import";
  }
  write(doc, HERO_SLOTS.grade, model.grade);
  write(doc, HERO_SLOTS.value, model.value);
  write(doc, HERO_SLOTS.coverage, model.coverage);
  write(doc, HERO_SLOTS.peer, model.peer);
  const action = write(doc, HERO_SLOTS.action, model.action.text);
  if (action) action.dataset.available = String(model.action.available);
  return model;
}

/**
 * Hand the card back to whatever painted it before an import arrived.
 *
 * Only the marker this module added is removed: the bundled renderer rewrites
 * every slot itself when it repaints, and clearing them here would leave the
 * card blank for the frame between the two calls.
 */
export function clearImportedHeroGrade(doc) {
  const card = byId(doc, HERO_SLOTS.card);
  if (card) delete card.dataset.basis;
  return null;
}
