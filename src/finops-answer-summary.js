// The answer block's headline, derived once from the bundled fixture.
//
// THE PROBLEM THIS SOLVES. The first thing a CTO reads on /evolution.html is the
// answer block: one figure, its unit, one confidence sentence, one next action.
// Until this module, getting those four values meant composing a whole stand
// headline — `buildStandHeadline()` reaches the briefing contract, the leading
// finding, the ranking-reproducibility gate, the cohort-attribution validator,
// the workspace-destination record and the finding resolver — and then reading
// three of that object's fields. Every panel on the page paid for the headline,
// and the headline paid for every panel.
//
// So the block's headline now has a data dependency of its own size: this one
// object. It is derived from the same fixture by a path that is four lines long.
//
// WHAT THIS MODULE MAY AND MAY NOT DO
//
// 1. IT REACHES NO PANEL DATASET. It imports the fixture reader, the gradability
//    gate the answer's own figure IS, and the screen contract that turns a
//    verdict into the block's four values. It does not import — directly or
//    transitively — the briefing contract, the leading finding, the destination
//    contract, or the headline composer that runs all three. Nothing here is
//    "compose everything, then pick three fields off it";
//    tests/finops-answer-summary.test.js pins that import list.
//
// 2. IT OPENS NO SECOND ARITHMETIC PATH. The percentage, the coverage sentence
//    and the ranked next action are `answerBlock()`'s, which is the same
//    function `finops-stand-view.js` paints a reader's own import through. That
//    is what makes the agreement test meaningful rather than tautological: the
//    two sides share the composer and differ in how the three fields it reads
//    were obtained, which is exactly the drift worth catching.
//
// 3. IT IS THE BUNDLED PATH ONLY. A reader who imports their own export is
//    painted from their own composed headline, unchanged. This object is what
//    the block says before anything has been imported, which is the state every
//    reader lands in.
//
// 4. NO STORAGE, NO NETWORK, NO CLOCK. The fixture is generated in-process by
//    example-dataset.js and the as-of phrase is the analysis's own window.

import { loadExampleDataset } from "./example-dataset.js";
import { gradeExport } from "./export-gradability.js";
import {
  ANSWER_DESTINATION, STAND_LABEL, answerBlock, periodLabel,
} from "./finops-screen-contract.js";

/**
 * The fixture, or null. Total for the same reason `buildStandHeadline` is: a
 * bundled example this browser could not read is a state the block reports —
 * `gradeExport` calls it `no_baseline` — not an exception that takes the first
 * thing a reader sees off the page.
 */
function bundledAnalysis() {
  try {
    return loadExampleDataset();
  } catch {
    return null;
  }
}

const analysis = bundledAnalysis();

/**
 * The answer block's sole data dependency for its headline.
 *
 * Carries `figure` and its raw `ratio`, the `unit` that figure is in, the
 * confidence/provenance fields (`confidence`, `basis`, `state`, `available`),
 * and the next action with the destination it targets. `answerBlock()` freezes
 * its own result; this re-freezes the two fields added beside it.
 */
export const FINOPS_ANSWER_SUMMARY = Object.freeze({
  ...answerBlock({
    label: STAND_LABEL.example,
    period: periodLabel(analysis),
    gradability: gradeExport({ analysis, source: "example" }),
  }),
  /** The unit the contract declares for this metric, beside the figure in it. */
  unit: ANSWER_DESTINATION.metricUnit,
  /** Which dataset the four values above were derived from. Never a clock. */
  source: "example",
});
