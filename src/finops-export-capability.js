// Which figures of the shipping brief this export can actually earn, answered
// BEFORE the analysis runs (#1065).
//
// WHAT THIS FIXES. The check delivered by #1064 answers one question — would
// this file analyze at all? — and a reader holding a yes still cannot tell
// whether the brief they are about to run will carry a period-over-period
// movement, a department breakdown, both, or neither. They find out by running
// the analysis and reading the gaps off `finops-brief-completeness.js`, which is
// the expensive way to learn that they needed to re-pull the export.
//
// So this module reports availability, one figure family at a time, from the
// preflight verdict the check already holds.
//
// IT INTRODUCES NO SCORING. There is no weight, no total, no tier, no grade and
// no confidence value below, and nothing here touches one. `SLOT_WEIGHTS`,
// `TIER_THRESHOLDS` and every literacy figure stay exactly where they are and
// are not read from here. The only two words this module emits about a family
// are `earnable` and `withheld`.
//
// IT DERIVES NOTHING TWICE. Every state below comes from a predicate the
// withholding path itself uses:
//
//   the export analyzes at all   `preflight`'s own READY reason, which is
//                                computed from `missingRequiredColumns` — the
//                                same function `adaptParsedExport` withholds the
//                                whole projection on.
//   a second billing period      `comparablePeriodCount`, extracted from
//                                `periodMovement`, which is the function whose
//                                `available: false` makes the brief's movement
//                                slot fall back.
// WHAT THE FIXTURES SAID ABOUT THE DEPARTMENT FIGURES, which is not what this
// change was scoped expecting. The department breakdown has NO precondition of
// its own in this build beyond the export analyzing at all, and there are two
// separate reasons, both checked rather than reasoned about:
//
//   * The unit or tag label column is a RECOGNITION SIGNATURE for all three
//     published contracts, not merely a required field. An export without it is
//     not recognized as any provider's — `preflight` answers `wrong_provider`,
//     never "recognized, missing the label column" — so the whole file is
//     refused and every figure is withheld together. A per-family "needs a label
//     column" rule would therefore be a branch that can never fire.
//   * An export that CARRIES the column with nothing in it still ranks: a blank
//     grouping cell lands in `local-finops.js`'s reserved unattributed unit,
//     which has a name, so `drillDownVerdict` and `topRecoverableDepartment` are
//     satisfied by it.
//
// So this module declares one extra input, for the one family that has one, and
// reports the other six against the export itself. That is a smaller claim than
// a table of per-family column rules would look like, and it is the one the
// brief actually enforces — tests/finops-export-capability.test.js is where both
// statements above are held.
//
// The family ids and the family labels are the BRIEF'S, read off
// `scoreBriefCompleteness` rather than retyped, so a slot added or renamed there
// appears here without an edit and cannot appear here under a different name.
//
// WHAT `earnable` CLAIMS, EXACTLY. That every input this family needs is in the
// file. It is a claim about inputs, not a promise about a value, and two things
// only the analysis can settle sit outside it: whether every row in the month
// parses (one unreadable row makes the month partial), and whether the
// recoverable amount comes out above zero. Both are stated here rather than
// implied so a disputed preview can be checked against the brief that followed
// it — tests/finops-export-capability.test.js runs both sides over three
// labelled exports and compares the derived sets mechanically.
//
// No DOM, no storage, no clock, no request, no randomness.

import { FIELD_ROLES } from "./browser-compat-contracts.js";
import { PREFLIGHT_REASONS } from "./hyperscaler-export-adapters.js";
import { comparablePeriodCount } from "./finops-imported-period-series.js";
import {
  DRILL_DOWN_SLOT_ID, SLOT_ORDER, TREND_SLOT_ID, scoreBriefCompleteness,
} from "./finops-brief-completeness.js";

/** Bump when a family, an input, or the ordering rule changes meaning. */
export const EXPORT_CAPABILITY_VERSION = "finops-export-capability/1.0.0";

/** The two states. There is no third, and neither is a score. */
export const CAPABILITY_STATE = Object.freeze({
  earnable: "earnable", withheld: "withheld",
});

/** The inputs a family can be waiting on. One id per thing a reader can go get. */
export const CAPABILITY_INPUTS = Object.freeze({
  analyzable: "analyzable_export",
  secondPeriod: "second_period",
});

/**
 * Each required column role in the words a reader would use for it, so a missing
 * input is an errand rather than a path out of one vendor's schema. The paths
 * themselves stay on the check's column breakdown, which is where a reader who
 * wants the exact spelling already looks.
 */
export const ROLE_INPUT_NAMES = Object.freeze({
  [FIELD_ROLES.COST]: "a billed cost amount column",
  [FIELD_ROLES.UNITS]: "a usage quantity column",
  [FIELD_ROLES.TIMESTAMP]: "a usage date column",
  [FIELD_ROLES.MODEL]: "a model or meter name column",
  [FIELD_ROLES.CURRENCY]: "a currency column",
  [FIELD_ROLES.SCOPE]: "a department or unit label column",
});

/** The input names that are not one column's absence. */
export const INPUT_NAMES = Object.freeze({
  [CAPABILITY_INPUTS.secondPeriod]: "a second billing period",
  unrecognized: "an export from a console this build reads",
  noRows: "usage rows — this file carries none",
});

/**
 * What each figure family is waiting on, MOST SPECIFIC FIRST.
 *
 * The order inside each list is the reporting order: a family names the
 * narrowest thing it is missing, and falls back to "this export does not analyze
 * at all" only when its own extra input is already in the file. A reader whose
 * export has no label column is told about the label column beside the
 * department figures, not beside all seven.
 *
 * The right-hand column states where the brief already enforces the same thing.
 */
export const FAMILY_INPUTS = Object.freeze({
  // `latestCompleteMonth` — a complete month with a recoverable total.
  recoverable_spend: Object.freeze([CAPABILITY_INPUTS.analyzable]),
  // `cohortBand` over that same month's recoverable and spend figures.
  peer_position: Object.freeze([CAPABILITY_INPUTS.analyzable]),
  // `topRecoverableDepartment` — the grouping column it needs is one the export
  // cannot be recognized without; see the note above.
  top_department: Object.freeze([CAPABILITY_INPUTS.analyzable]),
  // The same ranking: the first action is the top department's action.
  rank_1_action: Object.freeze([CAPABILITY_INPUTS.analyzable]),
  // `drillDownVerdict` — the ranked rows the evidence panel is painted from.
  [DRILL_DOWN_SLOT_ID]: Object.freeze([CAPABILITY_INPUTS.analyzable]),
  // `periodMovement` — latest against prior.
  [TREND_SLOT_ID]: Object.freeze([CAPABILITY_INPUTS.secondPeriod, CAPABILITY_INPUTS.analyzable]),
  // `importedHeadline`'s tier, satisfied whenever an analysis was read at all.
  confidence_tier: Object.freeze([CAPABILITY_INPUTS.analyzable]),
});

/**
 * The families and their labels, taken from the brief rather than restated.
 *
 * `scoreBriefCompleteness(null)` is the no-analysis verdict: it names every slot
 * the brief scores, in the declared reading order, with the label each one
 * prints. Reading it is a pure call with no analysis in it, and it is what makes
 * "the preview cannot name a family the brief does not have" true by
 * construction rather than by review.
 */
export const FAMILY_LABELS = Object.freeze(Object.fromEntries(
  scoreBriefCompleteness(null).slots.map((slot) => [slot.id, slot.label])));

/** The declared family order — the brief's own, never object key order. */
export const FAMILY_ORDER = Object.freeze(
  SLOT_ORDER.filter((id) => id in FAMILY_INPUTS));

/**
 * Whether one input is present in the file, and what it is called when it is not.
 *
 * A file no published contract claims is a file whose columns have no meaning
 * yet, so the two specific inputs are not evaluated against it: every family on
 * an unrecognized export is waiting on the export itself, and telling a reader
 * their spreadsheet needs a second billing period would send them to fetch one.
 */
function inputState(input, verdict) {
  const recognized = Boolean(verdict?.provider);
  if (input === CAPABILITY_INPUTS.secondPeriod) {
    return {
      met: !recognized || comparablePeriodCount(verdict.monthCount),
      name: INPUT_NAMES[CAPABILITY_INPUTS.secondPeriod],
    };
  }
  // The export-level input: preflight's own READY reason, and its own name for
  // the one column it already ranked as the thing to go and re-pull with.
  return {
    met: verdict?.reason === PREFLIGHT_REASONS.READY,
    name: !recognized ? INPUT_NAMES.unrecognized
      : verdict.namedColumnRole
        ? ROLE_INPUT_NAMES[verdict.namedColumnRole] ?? INPUT_NAMES.unrecognized
        : INPUT_NAMES.noRows,
  };
}

/** One family record. `missingInput` is "" when the family is earnable. */
function familyRecord(id, verdict) {
  const unmet = FAMILY_INPUTS[id]
    .map((input) => ({ input, ...inputState(input, verdict) }))
    .filter((entry) => !entry.met);
  return Object.freeze({
    id,
    label: FAMILY_LABELS[id] ?? id,
    state: unmet.length === 0 ? CAPABILITY_STATE.earnable : CAPABILITY_STATE.withheld,
    missingInput: unmet[0]?.name ?? "",
    missingInputId: unmet[0]?.input ?? null,
  });
}

/**
 * Which figures this export can earn, and what each withheld one is waiting on.
 *
 * @param verdict one `preflight` verdict — the SAME object the check panel is
 *   painted from. Nothing here re-reads or re-parses the file, and a null
 *   verdict reports every family withheld on the export itself rather than
 *   throwing.
 * @returns a frozen array of `{ id, label, state, missingInput, missingInputId }`,
 *   earnable families first in the brief's declared reading order, then the
 *   withheld ones by the ordering rule below.
 */
export function previewEarnableFigures(verdict) {
  const records = FAMILY_ORDER.map((id) => familyRecord(id, verdict ?? null));
  const withheld = records.filter((entry) => entry.state === CAPABILITY_STATE.withheld);
  const unlocks = new Map();
  for (const entry of withheld) {
    unlocks.set(entry.missingInputId, (unlocks.get(entry.missingInputId) ?? 0) + 1);
  }
  // ORDERING RULE, stated as the assumption it is: the input that unlocks the
  // most withheld figures ranks first, because re-pulling data is the expensive
  // action and the reader should see the pull that buys them the most. Ties
  // break on the brief's declared family order — never insertion order, never
  // object key order — so the same export always ranks the same way.
  const ranked = withheld.slice().sort((left, right) =>
    (unlocks.get(right.missingInputId) - unlocks.get(left.missingInputId))
    || (FAMILY_ORDER.indexOf(left.id) - FAMILY_ORDER.indexOf(right.id)));
  return Object.freeze([
    ...records.filter((entry) => entry.state === CAPABILITY_STATE.earnable),
    ...ranked,
  ]);
}

/** The counts a collapsed summary has to carry, so folding it away hides no news. */
export const capabilityCounts = (preview) => Object.freeze({
  earnable: preview.filter((entry) => entry.state === CAPABILITY_STATE.earnable).length,
  withheld: preview.filter((entry) => entry.state === CAPABILITY_STATE.withheld).length,
});
