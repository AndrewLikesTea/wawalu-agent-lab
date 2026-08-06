// Which file a platform lead has to go and get, per pinned adapter, and which
// half of the answer that file can supply on its own (#1166).
//
// THE GAP. The panel already says this import reads two files, and the
// readiness list already says where five recognized console exports live.
// Neither says what a lead decides BEFORE opening a console: for the adapter
// that reads my provider, which one report do I pull, and does it get me the
// headline figure or only half of it? A spend export answers where the money
// went and nothing about how it was used. Learning that after the errand means
// running the errand twice.
//
// EVERY FACT HERE IS READ, NOT WRITTEN. Adapter ids and labels come from the
// intake contract, the report to ask for from that adapter's export package,
// the row unit from its declared `billingGrain`, the columns from the delimited
// shape it names. The sample half is pinned in a different registry because it
// is a different contract — `org-query-source.js` plus the required fields in
// `query-sample-contract.js`. The only authored strings are the QUESTIONS: no
// schema carries the question a leader is asking.
//
// Both id sets are checked AT MODULE LOAD. A fourth adapter, or a renamed query
// source, throws on import — the page fails to boot and the build fails —
// rather than shipping a list that quietly names three of four. No DOM, no
// fetch, no clock.

import { PROVIDER_ADAPTERS } from "./multi-provider-intake.js";
import { packageById } from "./provider-export-package.js";
import { SHAPES } from "./finops-tabular-import.js";
import { orgQuerySourceById } from "./org-query-source.js";
import {
  CLASSIFICATION_FIELDS, REQUIRED_QUERY_SAMPLE_FIELDS,
} from "./query-sample-contract.js";

/** This module's own identity. Independent of either contract it reads. */
export const IMPORT_RECIPES_VERSION = "import-recipes/1.0.0";

/** The two halves an export can supply. There is no third and no partial. */
export const RECIPE_SUPPLIES = Object.freeze({ spend: "spend", sample: "sample" });

/** Said in the open, above the list: the headline figure needs both halves. */
export const IMPORT_RECIPES_LEAD = "The headline figure needs both halves. A spend "
  + "export answers where the money went; a query or conversation sample answers how "
  + "it was used. Each file below says which half it supplies — one of them is never "
  + "enough on its own.";

/** The marker each row carries in the open, beside the provider name. */
export const SUPPLIES_MARKER = Object.freeze({
  [RECIPE_SUPPLIES.spend]: "Supplies spend only",
  [RECIPE_SUPPLIES.sample]: "Supplies the query sample",
});

/**
 * The one question each export answers, phrased the way a lead asks it. The
 * only authored copy here: a row that lists a report without saying what it
 * buys adds surface without answering anything.
 */
const QUESTIONS = Object.freeze({
  "openai-usage": "What did OpenAI cost us last period, and which project spent it?",
  "anthropic-usage": "What did Anthropic cost us last period, and which workspace spent it?",
  "bedrock-cost-and-usage": "What did our Bedrock usage cost, and which cost centre owns it?",
  "gateway-proxy-log": "What were people actually asking for, and could a cheaper model "
    + "have answered it?",
});

/** The pinned query source that supplies the sample half of the answer. */
const SAMPLE_SOURCE_ID = "gateway-proxy-log";

/**
 * What each adapter's worked CSV sample (#1167) adds up to, in integer USD
 * cents. The ONE fact about those samples that ships in this page's initial
 * payload: the rows and the generator live in `import-file-template.js`, loaded
 * only on activation, but the figure has to be readable BEFORE the download or
 * a lead cannot tell whether the file they got back is the file described here.
 * `tests/import-file-template.test.js` feeds each sample through the real
 * delimited intake and asserts this exact number, so the documented figure and
 * the asserted figure are one constant with no second copy to drift.
 *
 * Whole dollars: the page's money formatter rounds to whole units, so a total
 * carrying cents would be documented as a figure the importer never reports.
 */
const SAMPLE_TOTAL_MINOR = Object.freeze({
  "openai-usage": 259500,
  "anthropic-usage": 187600,
  "bedrock-cost-and-usage": 223500,
});

/** Rows per worked sample. Enough to exercise the adapter, not a corpus. */
export const SAMPLE_ROW_COUNT = 4;

const shapeById = (id) => SHAPES.find((shape) => shape.id === id);

/**
 * The columns the scorer actually reads: a shape's REQUIRED fields, named by
 * the first spelling it accepts. Optional columns are deliberately absent —
 * this row answers "will this file import", not "what else is in it".
 */
function requiredColumnsOf(shape) {
  return Object.freeze(Object.values(shape.columns)
    .filter((spec) => spec.required)
    .map((spec) => spec.aliases[0]));
}

function spendRecipe(adapter) {
  const pkg = packageById(adapter.packageId);
  const shape = shapeById(adapter.shapes[0]);
  const question = QUESTIONS[adapter.id];
  const sampleTotalMinor = SAMPLE_TOTAL_MINOR[adapter.id];
  if (!pkg || !shape || !question || sampleTotalMinor === undefined) {
    throw new Error(`import-recipes: no recipe for pinned adapter ${adapter.id}`);
  }
  return Object.freeze({
    adapter: adapter.id,
    label: adapter.label,
    question,
    supplies: RECIPE_SUPPLIES.spend,
    // Non-null exactly where a blank template and a worked sample exist.
    sampleTotalMinor,
    // What a billing owner is asked for, from the adapter's own export package.
    report: pkg.export_request.ask_for,
    // The adapter's declared billing grain: what one row of it is.
    grouping: adapter.billingGrain,
    columns: requiredColumnsOf(shape),
  });
}

function sampleRecipe(id) {
  const entry = orgQuerySourceById(id);
  const question = QUESTIONS[id];
  if (!entry || !question) {
    throw new Error(`import-recipes: no pinned query source ${id}`);
  }
  return Object.freeze({
    adapter: entry.id,
    label: entry.label,
    question,
    supplies: RECIPE_SUPPLIES.sample,
    // No template ships for the query-sample half in this slice; see the PR.
    sampleTotalMinor: null,
    // The registry's own one-line description of the file to go and get.
    report: entry.summary,
    // Composed from the registry's declared attribution field and time bucket,
    // because a query sample row is one query and the unit it counts toward is
    // what a reader needs before they scope an export.
    grouping: `${entry.time_bucket.granularity}-bucket per ${entry.attribution.field}`,
    columns: Object.freeze([
      ...REQUIRED_QUERY_SAMPLE_FIELDS, CLASSIFICATION_FIELDS.join(" or "),
    ]),
  });
}

/**
 * One recipe per pinned adapter, in the intake contract's declared order, plus
 * the one query source that supplies the other half. Derived from the contract
 * list rather than hand-listed, so an adapter added there and not here throws.
 */
export const IMPORT_RECIPES = Object.freeze([
  ...PROVIDER_ADAPTERS.map(spendRecipe),
  sampleRecipe(SAMPLE_SOURCE_ID),
]);

/** The recipe for a pinned adapter or query-source id, or null. */
export function recipeForAdapter(id) {
  return IMPORT_RECIPES.find((recipe) => recipe.adapter === id) ?? null;
}

/** Which pinned recipe supplies a named column, in declared order, or null. The
 * missing-field → recipe direction, asked by `spend-only-tier.js` (#1168). */
export function recipeSupplyingColumn(column) {
  return IMPORT_RECIPES.find((recipe) => recipe.columns.includes(column)) ?? null;
}
