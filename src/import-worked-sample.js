// The worked sample beside the blank template (#1167): a handful of rows that
// import, through the shipping intake path, to one figure a reader can check.
//
// THE GAP. The on-ramp already hands a platform lead a column template — the
// header row of the report and nothing under it (#1169). A header row proves
// which columns are read; it does not prove that a file SHAPED that way lands
// anywhere. A lead who exports real billing data to find that out has already
// pulled the file this panel exists to help them scope. This module is the
// other half of that check: the same columns, with rows under them, and a
// stated figure the import produces from those rows.
//
// EVERY COLUMN IS DERIVED, NOTHING IS SPELLED TWICE. The header comes from
// `import-recipes.js` — the same list the blank template and the column
// disclosure are painted from — and the ORDER of the values under it comes from
// the intake shape those columns were derived from. A column renamed in
// `finops-tabular-import.js` therefore renames it in the template, in the
// worked sample and in the disclosure at once, and the cross-check below fails
// the build if the two ever disagree.
//
// EVERY VALUE IS FICTIONAL, ON PURPOSE. The rows carry no organisation, model,
// account or department that exists. They are the same four rows for every
// adapter, which is a decision and not an oversight: what differs between two
// providers' exports is the SPELLING OF THE HEADER, so holding the rows still
// makes the one figure below true of all three and checkable once.
//
// IT IS NOT IN THE INITIAL PAYLOAD. Nothing imports this module statically. The
// on-ramp reaches it with a native `import()` when it paints a chosen provider,
// so the rows and the figure cost a first-time visitor nothing.
//
// No DOM, no fetch, no clock: the bytes a download hands a reader are testable
// in Node.

import { SHAPES } from "./finops-tabular-import.js";
import { PROVIDER_ADAPTERS } from "./multi-provider-intake.js";
import { recipeForAdapter } from "./import-recipes.js";

/** This module's own identity. Independent of every contract it reads. */
export const WORKED_SAMPLE_VERSION = "import-worked-sample/1.0.0";

/** Delimited, like the reports it stands in for. */
export const WORKED_SAMPLE_MEDIA_TYPE = "text/csv";

/** The label the figure is read under, beside the control that emits the file. */
export const WORKED_SAMPLE_FIGURE_LABEL = "These rows import to";

/**
 * The rows, keyed by the intake contract's own field names rather than by any
 * one provider's column spelling.
 *
 * Obviously synthetic and deliberately so: no real organisation, no real
 * department, no real model, no account identifier, no prompt text. A sample
 * that looks like somebody's export invites a reader to treat it as evidence.
 */
const WORKED_ROWS = Object.freeze([
  Object.freeze({
    date: "2026-03-02", orgUnit: "Example Dept Alpha", model: "example-model-small",
    amount: "120.50",
  }),
  Object.freeze({
    date: "2026-03-02", orgUnit: "Example Dept Beta", model: "example-model-large",
    amount: "240.25",
  }),
  Object.freeze({
    date: "2026-03-03", orgUnit: "Example Dept Alpha", model: "example-model-large",
    amount: "89.00",
  }),
  Object.freeze({
    date: "2026-03-03", orgUnit: "Example Dept Gamma", model: "example-model-small",
    amount: "55.25",
  }),
]);

/**
 * The one documented headline figure: what the rows above total, in USD.
 *
 * Authored here rather than computed from the rows, because a figure computed
 * from the same array it is checked against proves nothing. The test runs the
 * emitted file through `parseLocalImportFile` and the shipping projection and
 * asserts THIS number, so a row edited without the figure being edited fails.
 */
export const WORKED_SAMPLE_TOTAL_USD = 505;

const money = (value) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
}).format(value);

/** The required fields of an intake shape, in declared order, with the column
 *  name each one is written under. */
function requiredFieldsOf(shape) {
  return Object.entries(shape.columns)
    .filter(([, spec]) => spec.required)
    .map(([field, spec]) => ({ field, column: spec.aliases[0] }));
}

/** RFC4180 quoting, applied only where it is needed. */
function cell(value) {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function sampleFor(adapter) {
  const shape = SHAPES.find((entry) => entry.id === adapter.shapes[0]);
  const recipe = recipeForAdapter(adapter.id);
  if (!shape || !recipe) {
    throw new Error(`import-worked-sample: no shape or recipe for adapter ${adapter.id}`);
  }
  const fields = requiredFieldsOf(shape);
  // THE CROSS-CHECK. The header a reader downloads and the header the panel
  // tells them to expect are two derivations of the same contract; if they ever
  // stop agreeing, this throws on import and the page fails to boot rather than
  // handing out a file whose columns the panel misnames.
  const columns = fields.map(({ column }) => column);
  if (columns.join(",") !== recipe.columns.join(",")) {
    throw new Error(`import-worked-sample: ${adapter.id} columns disagree with its recipe`);
  }
  const rows = WORKED_ROWS.map((row) => fields.map(({ field }) => {
    const value = row[field];
    // A required field with no authored value would ship a sample that cannot
    // import. A field added to the contract is a row to write here, not a blank
    // to emit.
    if (value === undefined) {
      throw new Error(`import-worked-sample: no ${field} value for ${adapter.id}`);
    }
    return cell(value);
  }).join(","));
  return Object.freeze({
    adapter: adapter.id,
    label: adapter.label,
    columns: Object.freeze(columns),
    rowCount: rows.length,
    filename: `wawalu-worked-sample-${adapter.id}.csv`,
    mediaType: WORKED_SAMPLE_MEDIA_TYPE,
    text: `${[columns.join(","), ...rows].join("\n")}\n`,
    totalUsd: WORKED_SAMPLE_TOTAL_USD,
    // The sentence the panel prints beside the download control. Composed from
    // the figure above and the row count of the file that is actually emitted,
    // so the two cannot be edited apart.
    figure: `${money(WORKED_SAMPLE_TOTAL_USD)} of spend, from ${rows.length} rows`,
  });
}

/**
 * One worked sample per pinned spend adapter, in the intake contract's declared
 * order. Derived from that list rather than hand-listed, so an adapter added
 * there arrives here or throws on import.
 */
export const WORKED_SAMPLES = Object.freeze(PROVIDER_ADAPTERS.map(sampleFor));

/** The worked sample for a pinned adapter id, or null. */
export function workedSample(id) {
  return WORKED_SAMPLES.find((sample) => sample.adapter === id) ?? null;
}
