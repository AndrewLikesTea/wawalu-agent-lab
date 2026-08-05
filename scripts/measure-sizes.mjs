// The exact bytes behind `npm run verify:build`'s KiB report.
//
// check-size-budget.mjs rounds to KiB for a reader, but raising a budget in
// config/evolution-size-budget.json is supposed to record what was MEASURED,
// itemised in bytes. This prints those numbers so the baseline note beside a
// raise is a measurement rather than a rounded one.
//
//   node scripts/measure-sizes.mjs dist
import { checkSizeBudget } from "./check-size-budget.mjs";

const { results } = await checkSizeBudget(process.argv[2] ?? "dist");
for (const result of results) {
  console.log(result.id, "measured", result.measuredBytes, "budget", result.budgetBytes,
    "delta", result.deltaBytes);
}
