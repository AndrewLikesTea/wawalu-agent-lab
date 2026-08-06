// The downgraded tier a billing-only export lands on (#1168).
//
// THE DEAD END THIS REPLACES. A provider export that carries money and nothing
// else — no grouping value on any row, no query sample beside it — used to reach
// the evidence preflight as `insufficient-evidence` or as a bounded
// `provider-export-only`, and both of those are the same sentence to a reader:
// this file bought you nothing. That is not true. Spend alone still answers what
// the period cost and how that cost divides across the models named in the file.
// It answers neither which department spent it nor what any of it was asked for.
//
// So this module publishes the DOWNGRADED result rather than a refusal, in two
// separately named parts, as data:
//
//   computed   every figure derivable from spend alone, each stamped with the
//              tier it belongs to, so a caller cannot hand one on as a
//              full-import figure by reading it out of the wrong list.
//   withheld   one entry per figure that cannot be computed, each naming the
//              structural field that is missing and the adapter recipe that
//              supplies it.
//
// THE FIELD AND THE RECIPE ARE READ, NEVER WRITTEN. Both come out of
// `import-recipes.js` (#1166), which is where this product already says which
// file supplies which half of the answer. The table below names a column KEY and
// then resolves it against that module: the emitted `field` is the module's own
// string, and a rename there throws AT MODULE LOAD — the page fails to boot and
// the build fails — rather than shipping a withheld line pointing a lead at a
// column their console no longer emits.
//
// No I/O of any kind: no fetch, no storage, no clock, no randomness. It is
// handed records another module already validated in the reader's own tab.

import { recipeSupplyingColumn } from "./import-recipes.js";
import { readUsageDetail } from "./provider-usage-record.js";

/** The tier discriminant. A caller branches on exactly this. */
export const SPEND_ONLY_TIER = "spend-only";

/** The two figure ids the computed list publishes. Nothing else is in it. */
export const SPEND_ONLY_FIGURE = Object.freeze({
  totalSpend: "total_spend",
  modelSpendSplit: "model_spend_split",
});

/**
 * What a row that names no model is called in the split.
 *
 * A bucket, not a dropped row: the money is in the file whether or not the file
 * says which model spent it, and a split whose parts do not add to the total is
 * worse than one honest bucket. Never "unknown" as a model name — the label says
 * the export did not state it, which is a fact about the file.
 */
export const MODEL_NOT_STATED = "Model not stated in this export";

/**
 * Every figure this tier cannot compute, and the ONE structural field whose
 * absence is why. The column keys below are resolved against the recipe registry
 * at module load; they are lookup keys, not display strings.
 */
const WITHHELD = Object.freeze([
  Object.freeze({ id: "department_spend_split", figure: "Spend split by department",
    column: "org_unit_id" }),
  Object.freeze({ id: "query_category_mix", figure: "Query category mix",
    column: "prompt_excerpt or category" }),
  Object.freeze({ id: "prompt_efficiency", figure: "Tokens per query",
    column: "input_tokens" }),
  Object.freeze({ id: "down_routing_candidates", figure: "Cheaper-model candidates",
    column: "model_raw" }),
]);

/** The withheld list, resolved once against the contract module. */
export const SPEND_ONLY_WITHHELD = Object.freeze(WITHHELD.map((entry) => {
  const recipe = recipeSupplyingColumn(entry.column);
  if (!recipe) {
    throw new Error(`spend-only-tier: no recipe supplies ${entry.column}`);
  }
  return Object.freeze({
    id: entry.id,
    figure: entry.figure,
    tier: SPEND_ONLY_TIER,
    // The module's own strings, both of them: the column as the recipe spells
    // it, and the recipe that supplies it, by id and by label.
    field: recipe.columns.find((column) => column === entry.column),
    recipe: recipe.adapter,
    recipeLabel: recipe.label,
  });
}));

const money = (value) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
}).format(value);

const share = (ratio) => new Intl.NumberFormat("en-US", {
  style: "percent", maximumFractionDigits: 1,
}).format(ratio);

const dollars = (minor) => Math.round(minor) / 100;

/** Code-unit order. Host collation settings cannot change this answer. */
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

const figure = (id, label, display, value) => Object.freeze({
  id, label, display, value, tier: SPEND_ONLY_TIER,
});

/**
 * Spend by model, largest first, then by model name so a tie is deterministic.
 *
 * A zero total is a real reading of a real export — a period billed at nothing,
 * or credits — so it produces buckets with a null share rather than a division
 * by zero, and the caller still renders the models the file named.
 */
function modelSplit(records, totalMinor) {
  const buckets = new Map();
  for (const row of records) {
    const model = readUsageDetail(row).model_raw ?? MODEL_NOT_STATED;
    buckets.set(model, (buckets.get(model) ?? 0) + row.cost.amount_minor);
  }
  return [...buckets.entries()]
    .sort((left, right) => right[1] - left[1] || compare(left[0], right[0]))
    .map(([model, minor]) => {
      const ratio = totalMinor > 0 ? minor / totalMinor : null;
      return figure(SPEND_ONLY_FIGURE.modelSpendSplit, model,
        ratio === null ? money(dollars(minor)) : `${money(dollars(minor))} · ${share(ratio)}`,
        Object.freeze({ model, amountUsd: dollars(minor), share: ratio }));
    });
}

/**
 * The downgraded result for one set of accepted, canonical billing records.
 *
 * @param records the projection's normalized records — already validated, each
 *   carrying an integer `cost.amount_minor`.
 * @returns a frozen `{ tier, computed, withheld }`. `computed` always leads with
 *   the total and is never empty, so the region has something to render even for
 *   a single-bucket or zero-dollar export.
 */
export function spendOnlyFigures(records = []) {
  const rows = Array.isArray(records) ? records : [];
  const totalMinor = rows.reduce((sum, row) => sum + row.cost.amount_minor, 0);
  return Object.freeze({
    tier: SPEND_ONLY_TIER,
    computed: Object.freeze([
      figure(SPEND_ONLY_FIGURE.totalSpend, "Total spend",
        money(dollars(totalMinor)), dollars(totalMinor)),
      ...modelSplit(rows, totalMinor),
    ]),
    withheld: SPEND_ONLY_WITHHELD,
  });
}
