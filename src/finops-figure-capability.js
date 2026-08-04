/**
 * WHICH FIGURES THIS EXPORT CAN EARN, answered before the analysis runs (#1065).
 *
 * A finance lead drops one month of billing-only data, waits for the analysis,
 * and finds the movement figure and the department names withheld. Nothing was
 * broken and nothing lied to them — those figures need inputs that file never
 * carried — but they learned it AFTER spending the effort, which is the one
 * moment the information is worth nothing. The preflight verdict (#1064) already
 * knows enough to say it first.
 *
 * THIS ADDS NO SCORE. There is no grade here, no confidence, no percentage, and
 * no number presented as quality. A family is `earnable` or `withheld`, and the
 * only counts are an inventory — how many families are in each state — which is
 * a fact about a list rather than a judgement about a file. Nothing in this
 * module reads or writes a score, a confidence tier, or a literacy grade;
 * `quoteFromExport` is imported from the completeness module because it is the
 * sanitiser this codebase already puts every export-derived string through, and
 * it is the only thing imported from there.
 *
 * THE REQUIREMENTS ARE NOT RESTATED HERE, WHICH IS THE WHOLE POINT. Each family
 * below consults the SAME predicate the shipping analysis withholds on:
 *
 *   movement            `hasMovementPeriods` — finops-imported-period-series.js,
 *                       applied by `periodMovement` to the series it builds and
 *                       by this module to the verdict's own month count.
 *   department names    `labelSourceColumns` — finops-export-unit-names.js,
 *                       the same `labelColumns` pass `deriveOrgUnitNames` runs.
 *   spend, department   the projection gate. This one is a REASON CODE and not a
 *   rows                shared function, and it is the one place this module
 *                       could not lift the rule out: whether an export projects
 *                       is decided by `adaptParsedExport`'s control flow, which
 *                       returns early down five branches rather than evaluating
 *                       a predicate. `preflight` already re-answers that question
 *                       through the SAME `recognizeExport` pass and the same
 *                       required-column comparison, so this reads its verdict
 *                       rather than reimplementing either. Lifting the gate into
 *                       a predicate would be a rewrite of the adapter, not a
 *                       refactor, and is deliberately not attempted here.
 *
 * WHAT `earnable` PROMISES, EXACTLY. That the export carries the INPUT the figure
 * needs — the months, the columns. It cannot promise the cells inside those
 * columns are usable, because a check reads a header and a date and imports
 * nothing. The agreement fixtures in tests/finops-figure-capability.test.js pin
 * the preview against what the produced brief actually contains for the same
 * input, family by family, so a rule that drifts from the analysis fails there
 * rather than on a reader's screen.
 */

import { PREFLIGHT_REASONS } from "./hyperscaler-export-adapters.js";
import {
  LABEL_DERIVATION_PRECEDENCE, labelSourceColumns,
} from "./finops-export-unit-names.js";
import { hasMovementPeriods } from "./finops-imported-period-series.js";
// The sanitiser only. No score, tier, or weight is read from this module.
import { quoteFromExport } from "./finops-brief-completeness.js";

/** Bump when a family, a requirement, or the ranking changes meaning. */
export const FIGURE_CAPABILITY_VERSION = "finops-figure-capability/1.0.0";

/** The two states. There is no third, and neither is a grade. */
export const FIGURE_STATE = Object.freeze({ earnable: "earnable", withheld: "withheld" });

/** The longest reader-supplied column name this preview will print. */
export const MAX_COLUMN_NAME = 32;

const shortColumn = (name) => {
  const text = quoteFromExport(name);
  return text.length > MAX_COLUMN_NAME ? `${text.slice(0, MAX_COLUMN_NAME - 1)}…` : text;
};

/** The missing input for every family that needs the export to project at all. */
function projectionMissing(verdict) {
  if (verdict.namedColumn) return `needs the ${shortColumn(verdict.namedColumn)} column`;
  if (!verdict.provider) return "needs an export from a console this build reads";
  return "needs an export with usage rows in it";
}

/**
 * THE RANKING, DECLARED. The array order IS the order withheld families are
 * listed in, and each entry carries its rank and the assumption that earns it,
 * so a reader who disputes the order argues with a sentence rather than with
 * object key order — which is an implementation detail nobody can see or check.
 *
 * "Highest value" means: how much of the brief the missing input unlocks, from
 * the input without which there is no brief at all down to the one that changes
 * how a figure reads rather than whether it exists.
 */
const FAMILY_SPECS = Object.freeze([
  Object.freeze({
    id: "spend_headline",
    rank: 1,
    label: "Recoverable and total spend",
    requirement: "requiresProjectableExport",
    assumption: "First because the money figure IS the brief: with no spend figure there is "
      + "no sentence to quote and every family below it is withheld too.",
    earnable: (input) => input.projectable,
    missing: (input) => projectionMissing(input.verdict),
  }),
  Object.freeze({
    id: "movement",
    rank: 2,
    label: "Month-on-month movement",
    requirement: "requiresMultiplePeriods",
    assumption: "Second because a second billing month unlocks the most downstream reading — "
      + "\"is this new?\" is the first question asked of any cost figure — and because it is "
      + "the one missing input a wider re-pull fixes outright.",
    earnable: (input) => input.projectable && hasMovementPeriods(input.verdict.monthCount),
    missing: (input) => (input.projectable
      ? `needs more than one billing period — this export covers ${
        input.verdict.monthCount === 1 ? "one month" : "no dated month"}`
      : projectionMissing(input.verdict)),
  }),
  Object.freeze({
    id: "department_rows",
    rank: 3,
    label: "Department breakdown",
    requirement: "requiresProjectableExport",
    assumption: "Third because an amount nobody owns cannot be assigned, so the brief stops "
      + "one step short of a decision — but the money figure above it still stands.",
    earnable: (input) => input.projectable,
    missing: (input) => projectionMissing(input.verdict),
  }),
  Object.freeze({
    id: "department_names",
    rank: 4,
    label: "Readable department names",
    requirement: "requiresLabelField",
    assumption: "Last because the rows and their figures exist either way: without a name "
      + "column the departments are shown under their own opaque identifiers, which changes "
      + "who can say the finding out loud rather than whether the finding is there.",
    earnable: (input) => input.projectable && input.labelColumns.length > 0,
    missing: (input) => (input.projectable
      ? `needs a unit or tag column — one of ${LABEL_DERIVATION_PRECEDENCE.join(", ")}`
      : projectionMissing(input.verdict)),
    detail: (input) => `named from the ${shortColumn(input.labelColumns[0])} column`,
  }),
]);

/** The families and their stated ranking, for a caller that lists or pins them. */
export const FIGURE_FAMILIES = Object.freeze(FAMILY_SPECS.map((spec) => Object.freeze({
  id: spec.id, rank: spec.rank, label: spec.label,
  requirement: spec.requirement, assumption: spec.assumption,
})));

/** The ranked ids, in the one order withheld entries are listed in. */
export const FIGURE_FAMILY_RANKING = Object.freeze(FAMILY_SPECS.map((spec) => spec.id));

const summarySentence = (earnable, withheld, top) => {
  const total = FAMILY_SPECS.length;
  if (withheld === 0) {
    return `All ${total} figure families are earnable from this export. Nothing is withheld.`;
  }
  return `${earnable} of ${total} figure families are earnable. Withheld first: `
    + `${top.label} — ${top.missing}.`;
};

/**
 * What this verdict's export can and cannot earn, family by family.
 *
 * Pure and total: no DOM, no storage, no clock, no randomness, and no branch
 * that throws. A null or malformed verdict reads as an export that projects
 * nothing, which is the honest answer rather than an exception.
 *
 * @param verdict one frozen `preflight` verdict (#1064) — read for `reason`,
 *   `provider`, `monthCount`, `namedColumn` and `scopeColumn`, and for nothing
 *   else. No field of it is written.
 * @param {{fieldNames?: string[]}} [options] the column names the same parse
 *   read, which is where `preflight` gets them from too.
 * @returns a frozen `{ version, families, earnableCount, withheldCount,
 *   topMissing, summary }`. `families` is every family in the declared ranking,
 *   each `{ id, rank, label, state, missing, detail }`; `missing` is the empty
 *   string on an earnable family and never a null a caller has to test for.
 */
export function previewFigureCapability(verdict, { fieldNames = [] } = {}) {
  const safe = verdict ?? {};
  const columns = Array.isArray(fieldNames) ? fieldNames.map(String) : [];
  const input = Object.freeze({
    verdict: Object.freeze({
      reason: safe.reason ?? null,
      provider: safe.provider ?? null,
      monthCount: Number(safe.monthCount) || 0,
      namedColumn: safe.namedColumn ?? null,
    }),
    projectable: safe.reason === PREFLIGHT_REASONS.READY,
    labelColumns: labelSourceColumns(columns, safe.scopeColumn ?? null),
  });

  const families = FAMILY_SPECS.map((spec) => {
    const earnable = spec.earnable(input);
    return Object.freeze({
      id: spec.id,
      rank: spec.rank,
      label: spec.label,
      requirement: spec.requirement,
      state: earnable ? FIGURE_STATE.earnable : FIGURE_STATE.withheld,
      missing: earnable ? "" : spec.missing(input),
      detail: earnable && spec.detail ? spec.detail(input) : "",
    });
  });
  const withheld = families.filter((family) => family.state === FIGURE_STATE.withheld);
  const top = withheld[0] ?? null;
  return Object.freeze({
    version: FIGURE_CAPABILITY_VERSION,
    families: Object.freeze(families),
    earnableCount: families.length - withheld.length,
    withheldCount: withheld.length,
    // The one missing input worth acting on, by the ranking above and never by
    // the order the families happen to be built in.
    topMissing: top === null ? null
      : Object.freeze({ id: top.id, label: top.label, missing: top.missing }),
    summary: summarySentence(families.length - withheld.length, withheld.length, top),
  });
}
