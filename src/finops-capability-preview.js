/**
 * Which figure families an export can EARN, said before the analysis runs (#1065).
 *
 * The check zone (#1064) already answers "will this file analyze?". It does not
 * answer the question a reader asks next and has, until now, had to run the whole
 * analysis to find out: "and what will I actually get out of it?" A brief that
 * silently withholds the movement figure because the file holds one month reads,
 * to somebody who has not seen a complete one, like a brief that has no movement
 * figure at all.
 *
 * ONE COPY OF THE WITHHOLDING RULES, NOT TWO. This is the failure mode that makes
 * a preview worse than no preview: a promise the analysis then breaks. So nothing
 * here re-states a threshold that already ships somewhere else.
 *
 *   - Whether two periods can be compared is `periodMovement`'s answer, obtained
 *     by CALLING it on the periods the check read. No "count >= 2" is written in
 *     this file; if the series module changes what a comparable pair is, this
 *     preview changes with it.
 *   - Which columns an export owes is the published contract's answer, read off
 *     `contractById` — the same contract `preflight` compared the file against.
 *   - What each figure family is CALLED is the completeness scorer's own label,
 *     read off `scoreBriefCompleteness(null)`. A family cannot be renamed on the
 *     brief and keep its old name here.
 *
 * NO SCORE, NO GRADE, NO WEIGHT, NO CONFIDENCE. This module reports two things
 * about each family — earnable or withheld — and, when withheld, the NAMED inputs
 * that are missing. It computes no number that reaches a reader. The one number
 * it does compute is `unblocks`, a count of withheld families, and it exists to
 * make the ORDER of the missing inputs arguable rather than opaque (see
 * `rankMissingInputs`). The completeness scorer's weights are deliberately not
 * consulted: a weight is a judgement about a finished brief, and reusing it here
 * would put a scoring opinion in front of a reader who has imported nothing.
 *
 * WHAT IT DELIBERATELY DOES NOT PREVIEW. Three of the brief's seven families are
 * out of scope because their outcome does not follow from anything the check can
 * see. `top_department` and `rank_1_action` need a group whose recoverable spend
 * is above zero, which is a fact about the ROW VALUES and the routing model, not
 * about columns and dates; `peer_position` needs a non-zero spend total; and
 * `confidence_tier` is satisfied by any analysis at all, so previewing it tells a
 * reader nothing. Previewing them would mean guessing, and a guess here is
 * exactly the promised-but-withheld figure this module exists to prevent. The
 * covered set is published as `PREVIEW_FAMILY_ORDER` so a test can hold the
 * boundary, and the agreement fixtures assert exactness over that set only.
 */

import {
  BROWSER_COMPAT_MANIFEST, FIELD_ROLES, contractById,
} from "./browser-compat-contracts.js";
import {
  DRILL_DOWN_SLOT_ID, SLOT_ORDER, TREND_SLOT_ID, scoreBriefCompleteness,
} from "./finops-brief-completeness.js";
import { periodMovement } from "./finops-imported-period-series.js";

/** Bump when a family, an input, or the ordering rule changes meaning. */
export const CAPABILITY_PREVIEW_VERSION = "finops-capability-preview/1.0.0";

/** The named inputs a figure family can be waiting on. Never a code, always a thing. */
export const PREVIEW_INPUTS = Object.freeze({
  BILLING_COLUMNS: "billing_columns",
  USAGE_ROWS: "usage_rows",
  UNIT_OR_TAG_LABELS: "unit_or_tag_labels",
  MULTIPLE_PERIODS: "multiple_periods",
});

/**
 * The declared input order. It is the order in which a reader can actually fix
 * them — a file with no recognized billing columns cannot be asked for a second
 * month — and it is the ONLY tie-break in `rankMissingInputs`, so two inputs
 * blocking the same number of families always resolve the same way.
 */
export const PREVIEW_INPUT_ORDER = Object.freeze([
  PREVIEW_INPUTS.BILLING_COLUMNS,
  PREVIEW_INPUTS.USAGE_ROWS,
  PREVIEW_INPUTS.UNIT_OR_TAG_LABELS,
  PREVIEW_INPUTS.MULTIPLE_PERIODS,
]);

/** What each input is called on screen. A missing input is named, never coded. */
export const PREVIEW_INPUT_LABELS = Object.freeze({
  [PREVIEW_INPUTS.BILLING_COLUMNS]: "a supported console's billing columns",
  [PREVIEW_INPUTS.USAGE_ROWS]: "at least one usage row",
  [PREVIEW_INPUTS.UNIT_OR_TAG_LABELS]: "unit or tag labels",
  [PREVIEW_INPUTS.MULTIPLE_PERIODS]: "two or more calendar months in one export",
});

/**
 * The inputs EVERY family needs, because without them no analysis runs at all
 * and there is no brief for a family to be withheld from. They are declared once
 * here rather than repeated in every family's list below.
 */
export const PREVIEW_UNIVERSAL_INPUTS = Object.freeze([
  PREVIEW_INPUTS.BILLING_COLUMNS, PREVIEW_INPUTS.USAGE_ROWS,
]);

/** What each previewed family reads BEYOND the two universal inputs above. */
export const PREVIEW_FAMILY_INPUTS = Object.freeze({
  recoverable_spend: Object.freeze([]),
  [DRILL_DOWN_SLOT_ID]: Object.freeze([PREVIEW_INPUTS.UNIT_OR_TAG_LABELS]),
  [TREND_SLOT_ID]: Object.freeze([PREVIEW_INPUTS.MULTIPLE_PERIODS]),
});

/**
 * The families this preview covers, in the brief's OWN reading order.
 *
 * Derived from `SLOT_ORDER` rather than typed out, so a family reordered on the
 * brief is reordered here and the declared order can never drift from the page
 * it describes.
 */
export const PREVIEW_FAMILY_ORDER = Object.freeze(
  SLOT_ORDER.filter((id) => id in PREVIEW_FAMILY_INPUTS));

/**
 * The scorer's own labels, read once. `scoreBriefCompleteness(null)` is the
 * no-analysis state: it publishes all seven slots with their labels and no
 * figure from anybody's export. Nothing but the label is read out of it.
 */
const FAMILY_LABELS = Object.freeze(Object.fromEntries(
  scoreBriefCompleteness(null).slots.map((slot) => [slot.id, slot.label])));

const list = (value) => (Array.isArray(value) ? value : []);

/**
 * Every column path any published contract declares under the unit/tag label
 * role, required or optional. Read off the manifest rather than typed out, so a
 * contract that adds a tag column is a column this preview counts.
 */
const LABEL_PATHS = Object.freeze([...new Set(BROWSER_COMPAT_MANIFEST.contracts
  .flatMap((entry) => [...entry.requiredFields, ...entry.optionalFields])
  .filter((field) => field.role === FIELD_ROLES.SCOPE)
  .map((field) => String(field.path)))]);

/** Each named input's state for one checked export, met or not, with its columns. */
function inputStates(verdict) {
  const contract = verdict?.provider ? contractById(verdict.provider) : null;
  const missing = list(verdict?.missingColumns).map(String);
  const present = list(verdict?.fieldNames).map(String);
  const labelsInFile = LABEL_PATHS.filter((path) => present.includes(path));
  // The comparability question, asked of the module that answers it on the
  // brief. The totals are zeroes because only the PERIOD KEYS decide whether a
  // comparison exists; no amount is read from the file and none is invented.
  const movement = periodMovement(list(verdict?.periods)
    .map((period) => ({ period: String(period), spendUsd: 0 })));
  const state = (met, columns = []) => Object.freeze({ met, columns: Object.freeze(columns) });
  return Object.freeze({
    // An unrecognized file owes EVERY billing column, which is why the contract
    // itself being absent is the same state as a column being absent. Missing
    // label columns count here too: a contract that requires one refuses the
    // file outright, and no family can be earned from a file nothing analyzed.
    [PREVIEW_INPUTS.BILLING_COLUMNS]: state(Boolean(contract) && missing.length === 0, missing),
    [PREVIEW_INPUTS.USAGE_ROWS]: state(Number(verdict?.rowCount) > 0),
    // Presence in the FILE, not absence from a contract's required list: an
    // export can carry a tag column no contract requires, and it groups just as
    // well. Every published contract also makes its label column a signature
    // column, so today a file that carries none is a file no contract claims —
    // both inputs read unmet and the family names both.
    [PREVIEW_INPUTS.UNIT_OR_TAG_LABELS]: state(labelsInFile.length > 0, labelsInFile),
    [PREVIEW_INPUTS.MULTIPLE_PERIODS]: state(movement.available),
  });
}

/** One family's verdict: earnable, or withheld on named inputs. */
function familyState(id, states) {
  const own = [...PREVIEW_UNIVERSAL_INPUTS, ...(PREVIEW_FAMILY_INPUTS[id] ?? [])];
  const missingInputs = PREVIEW_INPUT_ORDER.filter((input) =>
    !states[input].met && own.includes(input));
  return Object.freeze({
    id,
    label: FAMILY_LABELS[id] ?? id,
    earnable: missingInputs.length === 0,
    missingInputs: Object.freeze(missingInputs),
    /** The first unmet input in the declared order — one name for one line. */
    missingInput: missingInputs[0] ?? null,
    missingInputLabel: missingInputs.length ? PREVIEW_INPUT_LABELS[missingInputs[0]] : null,
  });
}

/**
 * The missing inputs, highest-value first.
 *
 * THE RULE, stated so it can be argued with: an input's rank is the NUMBER OF
 * WITHHELD FAMILIES IT BLOCKS, descending, ties broken by `PREVIEW_INPUT_ORDER`.
 *
 * THE ASSUMPTION BEHIND IT: every withheld figure family is worth the same to
 * the reader deciding whether to run the analysis. That is deliberately not the
 * completeness scorer's opinion — it weights a FINISHED brief, where the money
 * figure is worth five times the drill-down — and importing those weights here
 * would rank one reader's export against a judgement about somebody else's
 * brief. Counting families keeps the ordering checkable against the list on
 * screen: a reader can count the "Withheld — needs …" lines and get the same
 * answer this function did.
 *
 * A shared blocker is credited to every family it blocks, not only to families
 * it would single-handedly unblock. A family waiting on two inputs needs both,
 * and crediting neither would rank a shared blocker below a private one.
 */
export function rankMissingInputs(families) {
  const counts = new Map();
  for (const family of list(families)) {
    if (family.earnable) continue;
    for (const input of list(family.missingInputs)) {
      counts.set(input, (counts.get(input) ?? 0) + 1);
    }
  }
  return Object.freeze([...counts.entries()]
    .map(([id, unblocks]) => Object.freeze({ id, label: PREVIEW_INPUT_LABELS[id], unblocks }))
    .sort((left, right) => (right.unblocks - left.unblocks)
      || (PREVIEW_INPUT_ORDER.indexOf(left.id) - PREVIEW_INPUT_ORDER.indexOf(right.id))));
}

/**
 * READING ORDER, and the assumption behind it: earnable families first, in the
 * brief's own order, then withheld families ordered by the rank of the input
 * they lead with. The reader is deciding whether to import at all, so what they
 * WILL get leads; and the first withheld line then names the one input worth
 * fixing first, which is the same input the lede sentence names.
 */
function readingOrder(families, ranked) {
  const rankOf = (family) => {
    const index = ranked.findIndex((entry) => entry.id === family.missingInput);
    return index === -1 ? ranked.length : index;
  };
  const declared = (family) => PREVIEW_FAMILY_ORDER.indexOf(family.id);
  return Object.freeze(families.slice().sort((left, right) =>
    (Number(left.earnable ? 0 : 1) - Number(right.earnable ? 0 : 1))
    || (rankOf(left) - rankOf(right))
    || (declared(left) - declared(right))));
}

/**
 * Preview one preflight verdict: which figure families it can earn, and what the
 * withheld ones are waiting on.
 *
 * @param verdict a `preflight` verdict — its provider, row count, missing
 *   columns and detected periods. Pure: no DOM, no storage, no clock, no
 *   request, and nothing out of the file is quoted into the result beyond the
 *   contract's own column paths.
 * @returns `{ version, families, earnable, withheld, missingInputs }`, with
 *   `families` in reading order and `missingInputs` highest-value first. A null
 *   verdict previews every family as withheld, which is what "no file has been
 *   checked" honestly means.
 */
export function capabilityPreview(verdict = null) {
  const states = inputStates(verdict);
  const families = PREVIEW_FAMILY_ORDER.map((id) => familyState(id, states));
  const missingInputs = rankMissingInputs(families);
  return Object.freeze({
    version: CAPABILITY_PREVIEW_VERSION,
    families: readingOrder(families, missingInputs),
    earnable: Object.freeze(families.filter((family) => family.earnable).map((f) => f.id)),
    withheld: Object.freeze(families.filter((family) => !family.earnable).map((f) => f.id)),
    missingInputs,
  });
}
