// The two files a lead can hold before they own a console login (#1167): a blank
// CSV template and a tiny worked sample, per pinned adapter.
//
// THE GAP. #1166 says which report to pull and which columns get read. It still
// leaves a lead holding a column list and a spreadsheet, guessing at the shape:
// is the header spelled the way this importer spells it, does my date format
// import, and what should the total come out as if I got it right? A column list
// answers none of those, and the only way to find out was to run the errand,
// build a file by hand, and be refused.
//
// So this module emits the two artifacts that answer them without a credential:
// a header-only template to paste rows under, and three synthetic rows that
// import to a figure stated on the control BEFORE the download — so a lead who
// imports the sample and sees a different number knows the importer, not their
// file, is what to argue with.
//
// EVERY COLUMN NAME HERE IS READ, NOT WRITTEN. The header is `recipe.columns`
// from `import-recipes.js`, which is itself the required columns of the shape
// that reads the adapter, named by the first spelling the shape accepts. No
// header string is authored anywhere in this file. Cell values are keyed by the
// SHAPE'S OWN COLUMN KEY (`date`, `orgUnit`, `model`, `amount`) rather than by
// column name, for the reason `provider-readiness-contract.js` gives about its
// role table: keying by name would be retyping the list this module refuses to
// retype, and would let a sample drift from the contract one cell at a time.
//
// EVERY CELL IS OBVIOUSLY SYNTHETIC. No customer, no tenant, subscription,
// payer-account or project identifier, no key, no address, no prompt text. A
// sample file a reader may mail to a colleague is a file that must be safe to
// mail to a colleague, and `tests/import-sample-files.test.js` holds the
// serialized text against the identifier shapes the intake contract documents.
//
// The agreement between the header and `import-recipes.js` is checked AT MODULE
// LOAD: a contract change that renames or reorders a required column throws on
// import rather than shipping a template whose header the importer would refuse.
//
// No DOM, no Blob, no fetch, no clock, no randomness — the exact bytes a reader
// receives are the bytes the tests feed back through the importer.

import { PROVIDER_ADAPTERS } from "./multi-provider-intake.js";
import { recipeForAdapter } from "./import-recipes.js";
import { SHAPES } from "./finops-tabular-import.js";

/** This module's own identity. Independent of the contracts it reads. */
export const IMPORT_SAMPLE_FILES_VERSION = "import-sample-files/1.0.0";

/** Both artifacts are CSV: it is the one shape every pinned adapter parses. */
export const IMPORT_SAMPLE_MEDIA_TYPE = "text/csv";

/**
 * The worked sample, keyed by shape column key. Three rows, on purpose: two org
 * units so a grouped total is visibly a sum rather than a copy, two models so a
 * per-model split has something to split, and three days so a period is a range.
 *
 * Amounts are written as strings so the file carries exactly these digits — a
 * sample whose serialization depends on float formatting is a sample whose
 * documented figure drifts with the runtime.
 */
const SAMPLE_ROWS = Object.freeze([
  Object.freeze({
    date: "2026-06-01", orgUnit: "Department A", model: "acme-model-a", amount: "120.00",
  }),
  Object.freeze({
    date: "2026-06-02", orgUnit: "Department B", model: "acme-model-b", amount: "80.50",
  }),
  Object.freeze({
    date: "2026-06-03", orgUnit: "Department A", model: "acme-model-a", amount: "45.25",
  }),
]);

/**
 * What the worked sample imports as: 120.00 + 80.50 + 45.25.
 *
 * Exported as DATA rather than written into a label, so the control a lead reads
 * and the test that runs the sample through the importer quote the same
 * constant. A sample whose figure drifts reds the fixture test rather than
 * quietly relabelling the button.
 */
export const SAMPLE_TOTAL_USD = 245.75;

/** The same figure as the one string the surface is allowed to print. */
export const SAMPLE_TOTAL_LABEL = "$245.75";

/** The period the sample rows cover, stated for the control that offers them. */
export const SAMPLE_PERIOD_LABEL = "1–3 June 2026";

// RFC 4180 quoting, applied to headers as well as cells because a column name is
// a field too. Present so a contract that later names a column with a comma in
// it still emits a file the reader's own importer can read.
const csvField = (value) => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const csvLine = (values) => `${values.map(csvField).join(",")}\n`;

const shapeById = (id) => SHAPES.find((shape) => shape.id === id);

/** The shape's required column KEYS, in the shape's own declared order. */
function requiredKeysOf(shape) {
  return Object.entries(shape.columns)
    .filter(([, spec]) => spec.required)
    .map(([key]) => key);
}

/**
 * The load-time guard. `columns` is the recipe's list and `keys` is the shape's,
 * derived independently and required to line up one for one; if they ever stop
 * agreeing, a cell would be written under the wrong header. Throwing here fails
 * the page boot and the build, which is louder than a silently mislabelled file.
 */
function assertHeaderAgrees(adapterId, columns, keys, shape) {
  const expected = keys.map((key) => shape.columns[key].aliases[0]);
  const same = columns.length === expected.length
    && columns.every((column, index) => column === expected[index]);
  if (!same) {
    throw new Error(`${IMPORT_SAMPLE_FILES_VERSION}: the template header for ${adapterId} `
      + `(${expected.join(", ")}) is not the recipe's column list (${columns.join(", ")}).`);
  }
}

function sampleFileFor(adapter) {
  const recipe = recipeForAdapter(adapter.id);
  const shape = shapeById(adapter.shapes[0]);
  if (!recipe || !shape) {
    throw new Error(`${IMPORT_SAMPLE_FILES_VERSION}: no recipe or shape for ${adapter.id}`);
  }
  const columns = [...recipe.columns];
  const keys = requiredKeysOf(shape);
  assertHeaderAgrees(adapter.id, columns, keys, shape);
  // The other half of the guard, and the one a contract ADDITION trips: a shape
  // that starts requiring a column this table has no cell for would otherwise
  // emit a sample with an empty column under a header the importer accepts —
  // a file that imports to a figure nobody documented.
  const unfilled = keys.filter((key) => SAMPLE_ROWS.some((row) => row[key] === undefined));
  if (unfilled.length) {
    throw new Error(`${IMPORT_SAMPLE_FILES_VERSION}: ${adapter.id} requires `
      + `${unfilled.join(", ")}, which the worked sample has no value for.`);
  }
  const header = csvLine(columns);
  const rows = SAMPLE_ROWS.map((row) => csvLine(keys.map((key) => row[key])));
  return Object.freeze({
    adapter: adapter.id,
    label: adapter.label,
    columns: Object.freeze(columns),
    mediaType: IMPORT_SAMPLE_MEDIA_TYPE,
    // The blank template is the header and nothing else: a lead pastes their own
    // rows under it, and a template carrying an example row is a template whose
    // example gets imported by accident.
    blankTemplate: header,
    blankFilename: `wawalu-template-${adapter.id}.csv`,
    workedSample: header + rows.join(""),
    sampleFilename: `wawalu-sample-${adapter.id}.csv`,
    sampleRowCount: SAMPLE_ROWS.length,
    documentedTotalUsd: SAMPLE_TOTAL_USD,
    documentedTotalLabel: SAMPLE_TOTAL_LABEL,
    documentedPeriodLabel: SAMPLE_PERIOD_LABEL,
  });
}

/**
 * One template-and-sample pair per pinned adapter, in the intake contract's own
 * declared order. Derived from PROVIDER_ADAPTERS rather than hand-listed, so a
 * fourth adapter arrives here with no edit and a renamed one throws.
 */
export const IMPORT_SAMPLE_FILES = Object.freeze(PROVIDER_ADAPTERS.map(sampleFileFor));

/** The pair for a pinned adapter id, or null. */
export function importSampleFileById(id) {
  return IMPORT_SAMPLE_FILES.find((file) => file.adapter === id) ?? null;
}

/**
 * The headline figure of an imported provider document, in whole USD and cents.
 *
 * Defined once, here, so the number the control promises and the number the
 * fixture test reads out of the real importer are the same arithmetic: the sum
 * of every accepted record's billed cost. Minor units are summed as integers and
 * divided once, so three rows of cents cannot round apart.
 */
export function importedTotalUsd(document) {
  const records = document?.records ?? [];
  return records.reduce((total, record) => total + (record?.cost?.amount_minor ?? 0), 0) / 100;
}
