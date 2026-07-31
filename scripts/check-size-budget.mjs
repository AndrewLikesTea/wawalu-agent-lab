// Build-time size budget for the /evolution.html initial payload.
//
// WHY A CHECK AND NOT A TARGET. The AI FinOps page's initial payload is the
// document, its stylesheets, and the entry module's whole static import graph.
// Nothing in the ordinary build reports that number, so it moved without anyone
// deciding it should. This prints it on every build — pass or fail — and fails
// only when it crosses a budget somebody wrote down on purpose.
//
// THE BUDGETS ARE MEASUREMENTS, NOT AMBITIONS. Each one is the size measured on
// the post-collapse page plus a stated headroom. A budget set to a number the
// page does not meet is a check that is red on arrival and switched off by the
// first person it inconveniences.
//
// THE STATIC GRAPH IS THE POINT. A tracked artifact of kind `module-graph` sums
// the entry and everything it imports STATICALLY. A module moved behind a
// native dynamic `import()` leaves that graph, which is what makes deferral
// measurable here rather than merely claimed. `fetch()`ed fragments were never
// in it.
//
// It reads the built artifact and writes nothing. It touches no deployment
// path, no control, and no state a rollback would have to clean up.

import { readFile, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(import.meta.dirname, "..");
export const CONFIG_PATH = resolve(root, "config", "evolution-size-budget.json");

/**
 * Static import specifiers only.
 *
 * `import("/x.js")` — the dynamic form — is deliberately not matched: a module
 * loaded on demand is not in the initial payload, and counting it would make
 * this check unable to see the one thing it exists to measure. Both specifier
 * forms this repository uses are followed: root-absolute (`/x.js`, what a page
 * entry writes, because that is what the served origin resolves) and relative
 * (`./x.js`, what the modules underneath write).
 */
const STATIC_IMPORT = /(?:^|[\n;])\s*(?:import|export)\b[^;]*?\bfrom\s*["'](\.{0,2}\/[^"']+\.js)["']/g;
const BARE_IMPORT = /(?:^|[\n;])\s*import\s*["'](\.{0,2}\/[^"']+\.js)["']\s*;/g;

/** Resolve a specifier against the served path of the module that wrote it. */
function servedPath(specifier, importer) {
  if (specifier.startsWith("/")) return specifier;
  return new URL(specifier, `file:///${importer.replace(/^\//, "")}`).pathname;
}

/** Every module reachable from `entry` by static import, as served paths. */
export async function staticModuleGraph(distRoot, entry, readText) {
  const seen = new Set();
  const missing = [];
  const queue = [entry];
  while (queue.length > 0) {
    const served = queue.shift();
    if (seen.has(served)) continue;
    seen.add(served);
    let source;
    try {
      source = await readText(resolve(distRoot, served.replace(/^\//, "")));
    } catch {
      missing.push(served);
      continue;
    }
    for (const pattern of [STATIC_IMPORT, BARE_IMPORT]) {
      pattern.lastIndex = 0;
      let match = pattern.exec(source);
      while (match) {
        const next = servedPath(match[1], served);
        if (!seen.has(next)) queue.push(next);
        match = pattern.exec(source);
      }
    }
  }
  return { modules: [...seen].sort(), missing };
}

/**
 * Measure every tracked artifact against the config.
 *
 * Pure over its `sizes` input so a test can drive it with fixture numbers
 * instead of mutating a real build. `sizes` maps a tracked artifact's `id` to
 * its measured bytes.
 */
export function evaluateBudgets(config, sizes) {
  return config.artifacts.map((artifact) => {
    const measured = sizes[artifact.id];
    const known = Number.isFinite(measured);
    return {
      id: artifact.id,
      label: artifact.label,
      budgetBytes: artifact.budgetBytes,
      measuredBytes: known ? measured : null,
      deltaBytes: known ? measured - artifact.budgetBytes : null,
      // An artifact that could not be measured is a failure, not a pass. A
      // renamed or dropped entry file is exactly the change this check must
      // not sleep through.
      over: !known || measured > artifact.budgetBytes,
      unmeasured: !known,
    };
  });
}

const kib = (bytes) => `${(bytes / 1024).toFixed(1)} KiB`;
const signed = (bytes) => `${bytes >= 0 ? "+" : "-"}${kib(Math.abs(bytes))}`;

/**
 * The report, printed on pass and on fail alike.
 *
 * A check that is silent when it passes teaches nobody what the number is, and
 * the number drifting is the thing worth watching.
 */
export function formatReport(results, config) {
  const lines = [`/evolution.html initial-payload size budget (headroom: ${config.headroom})`];
  for (const result of results) {
    if (result.unmeasured) {
      lines.push(`  FAIL ${result.label}: not present in the build output `
        + `(budget ${kib(result.budgetBytes)})`);
      continue;
    }
    lines.push(`  ${result.over ? "FAIL" : "ok  "} ${result.label}: `
      + `measured ${kib(result.measuredBytes)} · budget ${kib(result.budgetBytes)} · `
      + `delta ${signed(result.deltaBytes)}`);
  }
  const failed = results.filter((result) => result.over);
  if (failed.length === 0) {
    lines.push("  every tracked artifact is inside its budget.");
    return lines.join("\n");
  }
  for (const result of failed) {
    lines.push(`\nOver budget: ${result.label} (${result.id}).`);
  }
  lines.push("", "This is not a flake and there is nothing to retry. Either take the bytes"
    + " back out of the initial payload, or raise the budget on purpose:", "",
    `  1. Open ${relative(root, CONFIG_PATH)}.`,
    "  2. Set budgetBytes for the artifact above to the new measured size plus the",
    "     stated headroom, and say in its `baseline` note what added the bytes and why",
    "     they belong in the initial payload.",
    "  3. Land the config change in the same commit as the growth, so the review that",
    "     approves the bytes is the review that approves the budget.");
  return lines.join("\n");
}

/** Measure one tracked artifact against the built output. */
async function measure(artifact, distRoot) {
  if (artifact.kind === "module-graph") {
    const { modules, missing } = await staticModuleGraph(
      distRoot, artifact.entry, (path) => readFile(path, "utf8"));
    if (missing.length > 0) return null;
    let total = 0;
    for (const served of modules) {
      total += (await stat(resolve(distRoot, served.replace(/^\//, "")))).size;
    }
    return total;
  }
  try {
    return (await stat(resolve(distRoot, artifact.path))).size;
  } catch {
    return null;
  }
}

export async function checkSizeBudget(distRoot, configPath = CONFIG_PATH) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const sizes = {};
  for (const artifact of config.artifacts) {
    const measured = await measure(artifact, distRoot);
    if (measured !== null) sizes[artifact.id] = measured;
  }
  const results = evaluateBudgets(config, sizes);
  return { config, results, report: formatReport(results, config) };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const distRoot = resolve(root, process.argv[2] ?? "dist");
  const { results, report } = await checkSizeBudget(distRoot);
  console.log(report);
  if (results.some((result) => result.over)) process.exitCode = 1;
}
