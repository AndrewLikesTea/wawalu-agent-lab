// A blank template and a worked sample per pinned adapter, so a lead can check
// the shape of their file before they export a real one (#1167).
//
// THE GAP. #1166 names the columns a lead's export has to carry. A column list
// read in a disclosure and a header row read in a spreadsheet are not the same
// artefact, and today the only way to compare them is to run the export and
// find out afterwards. These two files are that comparison, before the errand:
// an empty one to fill in, and a filled-in one that imports to a number this
// page states in advance.
//
// NOTHING HERE NAMES A COLUMN. The header row is the required columns of the
// shape that reads the adapter, in declared order, by the first spelling it
// accepts — the derivation `import-recipes.js` paints, asserted against it AT
// MODULE LOAD so the download and the recipe row cannot disagree. Rows are
// keyed by the shape's field ids, so a renamed or reordered column moves header
// and values together, and a newly required one throws on import rather than
// shipping a template short a column.
//
// THE FIGURE IS DERIVED, NOT WRITTEN. `headlineFigure` sums this module's own
// row amounts and formats them the way the trust verdict formats a total. The
// page prints it beside the download; the fixture test feeds these same bytes
// through the real parser and the real verdict and asserts that total matches.
// Neither surface carries a number of its own, so they cannot drift.
//
// EVERY VALUE IS INVENTED: placeholder organisation, workspace, cost-centre and
// model names, no account or tenant identifier, and no prompt or completion
// text — this import refuses a file carrying those. No DOM, no fetch, no clock.

import { PROVIDER_ADAPTERS } from "./multi-provider-intake.js";
import { ANALYSIS_CURRENCY, SHAPES } from "./finops-tabular-import.js";
import { recipeForAdapter } from "./import-recipes.js";

/** This module's own identity, independent of the contracts it reads. */
export const IMPORT_TEMPLATES_VERSION = "import-templates/1.0.0";

/** Both artefacts are delimited text; the adapters that read them are CSV. */
export const TEMPLATE_MEDIA_TYPE = "text/csv";

/** Said once, above the per-adapter controls. */
export const IMPORT_TEMPLATES_LEAD = "Check the shape before you export the real "
  + "thing. The blank template is the columns this import requires, and the worked "
  + "sample is a readable file that already imports — to the total stated beside it, "
  + "which is the same total this page will show you after import.";

/** The label the stated figure is printed under, on the page and nowhere else. */
export const HEADLINE_FIGURE_KEY = "This sample imports as";

/**
 * The two files, and which field of a template entry each one is. Declared as
 * data because the page paints one control per entry: a third artefact is a row
 * here, never another branch in a view.
 */
export const TEMPLATE_KINDS = Object.freeze([
  Object.freeze({
    id: "blank",
    text: "Download the blank CSV template",
    textKey: "blankText",
    fileKey: "blankFileName",
  }),
  Object.freeze({
    id: "sample",
    text: "Download the worked CSV sample",
    textKey: "sampleText",
    fileKey: "sampleFileName",
  }),
]);

/**
 * One row, keyed by the shape's own field ids rather than by any header
 * spelling. Amounts are minor units, so the stated total is exact arithmetic
 * rather than a sum of parsed decimals.
 */
const row = (date, orgUnit, model, amountMinor) =>
  Object.freeze({ date, orgUnit, model, amountMinor });

const BIG = "example-model-large";
const SMALL = "example-model-small";

/** Four invented rows per adapter, over two days and three grouping units. */
const SAMPLE_ROWS = Object.freeze({
  "openai-usage": Object.freeze([
    row("2026-03-02", "example-project-alpha", BIG, 18450),
    row("2026-03-02", "example-project-beta", SMALL, 4312),
    row("2026-03-03", "example-project-alpha", SMALL, 9925),
    row("2026-03-03", "example-project-gamma", BIG, 2818),
  ]),
  "anthropic-usage": Object.freeze([
    row("2026-03-02", "Example Workspace Alpha", BIG, 9120),
    row("2026-03-02", "Example Workspace Beta", SMALL, 2260),
    row("2026-03-03", "Example Workspace Alpha", SMALL, 4405),
    row("2026-03-03", "Example Workspace Gamma", BIG, 880),
  ]),
  "bedrock-cost-and-usage": Object.freeze([
    row("2026-03-02T00:00:00Z", "example-cost-centre-alpha", BIG, 5230),
    row("2026-03-02T00:00:00Z", "example-cost-centre-beta", SMALL, 1980),
    row("2026-03-03T00:00:00Z", "example-cost-centre-alpha", SMALL, 3115),
    row("2026-03-03T00:00:00Z", "example-cost-centre-gamma", BIG, 1278),
  ]),
});

const csvField = (value) => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Minor units as the decimal a delimited export carries. */
const amountText = (minor) => (minor / 100).toFixed(2);

/** The trust verdict's own formatting of a total, applied to the same sum. */
const moneyText = (minor) => `${amountText(minor)} ${ANALYSIS_CURRENCY}`;

/**
 * The shape's required fields: the field id the rows are keyed by, paired with
 * the header spelling the file carries, in the shape's declared order.
 */
function requiredFieldsOf(shape) {
  return Object.freeze(Object.entries(shape.columns)
    .filter(([, spec]) => spec.required)
    .map(([field, spec]) => Object.freeze({ field, column: spec.aliases[0] })));
}

function valueOf(adapterId, row, field) {
  if (field === "amount") return amountText(row.amountMinor);
  const value = row[field];
  if (value === undefined) {
    throw new Error(`import-templates: the ${adapterId} sample has no ${field} value`);
  }
  return value;
}

function templateOf(adapter) {
  const shape = SHAPES.find((entry) => entry.id === adapter.shapes[0]);
  const rows = SAMPLE_ROWS[adapter.id];
  if (!shape || !rows) {
    throw new Error(`import-templates: no sample for pinned adapter ${adapter.id}`);
  }
  const fields = requiredFieldsOf(shape);
  const columns = Object.freeze(fields.map((entry) => entry.column));
  // The recipe row and these two files quote the same columns to the same
  // reader in the same panel. One derivation, checked, rather than two.
  const painted = recipeForAdapter(adapter.id)?.columns ?? [];
  if (String(columns) !== String(painted)) {
    throw new Error(`import-templates: ${adapter.id} columns disagree with its recipe`);
  }
  const header = columns.map(csvField).join(",");
  const body = rows.map((row) => fields
    .map((entry) => csvField(valueOf(adapter.id, row, entry.field))).join(","));
  return Object.freeze({
    adapter: adapter.id,
    label: adapter.label,
    columns,
    rowCount: rows.length,
    // Both files, generated here so nothing downstream can assemble a third
    // spelling of the same header row.
    blankText: `${header}\n`,
    sampleText: `${[header, ...body].join("\n")}\n`,
    blankFileName: `${adapter.id}-template.csv`,
    sampleFileName: `${adapter.id}-worked-sample.csv`,
    mediaType: TEMPLATE_MEDIA_TYPE,
    // What this page promises the sample imports as, in the units and rounding
    // the trust verdict prints its total in.
    headlineFigure: moneyText(rows.reduce((sum, row) => sum + row.amountMinor, 0)),
  });
}

/**
 * One template pair per pinned adapter, in the intake contract's declared
 * order. Built at module load, so an adapter added to the contract without a
 * sample throws on import — the page fails to boot and the build fails — rather
 * than offering downloads for two providers out of three.
 */
export const IMPORT_TEMPLATES = Object.freeze(PROVIDER_ADAPTERS.map(templateOf));

/** The template pair for a pinned adapter id, or null. */
export function templateForAdapter(id) {
  return IMPORT_TEMPLATES.find((entry) => entry.adapter === id) ?? null;
}
