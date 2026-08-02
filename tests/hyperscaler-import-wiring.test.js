// The adapters on the surface that has to use them: the AI FinOps import entry
// point on /evolution.html, booted by the real page entry.
//
// Nothing between the file selection and the panel is stubbed. What only this
// file can catch is the wiring itself — a module that adapts correctly and is
// never reached is a module that ships nothing — and the placement of that
// wiring, which is a dynamic import() so the adapters stay out of the page's
// initial payload. The adapters' own contract is in
// tests/hyperscaler-export-adapters.test.js.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const ENTRY = new URL("../src/evolution-page.js", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const BEDROCK_HEADER = ["lineItem/UsageStartDate", "product/model_id", "lineItem/UsageAmount",
  "lineItem/UnblendedCost", "lineItem/CurrencyCode", "lineItem/UsageAccountId",
  "lineItem/UsageType"];
const bedrockRow = (date, units, cost) => [date, "anthropic.claude-sonnet", units, cost,
  "USD", "000000000001", "USE1-InputTokenCount"];
const csv = (header, rows) => `${[header, ...rows].map((row) => row.join(",")).join("\n")}\n`;

const BEDROCK_EXPORT = csv(BEDROCK_HEADER, [
  bedrockRow("2026-07-20", "120000", "4.80"),
  bedrockRow("2026-07-21", "45000", "0.90"),
  bedrockRow("2026-07-22", "98000", "3.92"),
]);

// The same export with the currency column the contract requires taken out.
const BEDROCK_INCOMPLETE = csv(
  BEDROCK_HEADER.filter((column) => column !== "lineItem/CurrencyCode"),
  [["2026-07-20", "anthropic.claude-sonnet", "120000", "4.80", "000000000001", "USE1-InputTokenCount"],
    ["2026-07-21", "anthropic.claude-sonnet", "45000", "0.90", "000000000001", "USE1-InputTokenCount"],
    ["2026-07-22", "anthropic.claude-sonnet", "98000", "3.92", "000000000001", "USE1-InputTokenCount"]]);

async function openFinopsTab() {
  const page = await loadPage(PAGE, {
    storage: {},
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  return page;
}

function chooseFile(document, name, text) {
  const input = document.getElementById("local-finops-files");
  input.files = [{ name, type: "text/csv", text: async () => text }];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

const activationState = (document) =>
  document.getElementById("local-export-activation").dataset.state;

test("a Bedrock export dropped into the import entry point is adapted and projected", async () => {
  const { document } = await openFinopsTab();
  chooseFile(document, "bedrock-usage.csv", BEDROCK_EXPORT);
  await waitFor(() => activationState(document) === "ready",
    "the adapted Bedrock export to reach the ready state");

  const status = textOf(document.getElementById("local-export-activation-status"));
  assert.match(status, /AWS Bedrock export adapted locally/);
  // Counts, never a cell value: three rows in, three canonical aggregates out.
  assert.match(status, /3 of 3 rows became 3 canonical aggregates/);
  // The account id, the model string and every amount stay out of the surface.
  assert.doesNotMatch(status, /000000000001|anthropic\.claude-sonnet|4\.80/);
});

test("a Bedrock export missing a required column is refused as incomplete, not projected", async () => {
  const { document } = await openFinopsTab();
  chooseFile(document, "bedrock-no-currency.csv", BEDROCK_INCOMPLETE);
  await waitFor(() => activationState(document) === "error",
    "the incomplete Bedrock export to be refused");

  const status = textOf(document.getElementById("local-export-activation-status"));
  assert.match(status, /AWS Bedrock was recognized/);
  assert.match(status, /lineItem\/CurrencyCode/);
  assert.match(status, /No projection was produced\./);
});

test("a file no published contract claims still reaches the routes that owned it", async () => {
  const { document } = await openFinopsTab();
  // A general-ledger extract: the adapters return incompatible and the existing
  // delimited path takes it, exactly as it did before this wiring existed.
  chooseFile(document, "ledger.csv", csv(["posting_date", "gl_account", "amount"], [
    ["2026-07-20", "6100-software", "482.10"],
    ["2026-07-21", "6100-software", "133.75"],
  ]));
  await waitFor(() => !document.getElementById("import-mapping").hidden,
    "the column-mapping review to open on an unclaimed file");
});

// --- content-based provider detection (#957) --------------------------------

test("the ready panel names the provider the file's own columns identified", async () => {
  const { document } = await openFinopsTab();
  chooseFile(document, "bedrock-usage.csv", BEDROCK_EXPORT);
  await waitFor(() => activationState(document) === "ready",
    "the detected Bedrock export to reach the ready state");

  const status = textOf(document.getElementById("local-export-activation-status"));
  // The reader named no provider anywhere in this flow: the verdict, the
  // confidence and the evidence behind it all came from the file.
  assert.match(status, /AWS Bedrock identified from this file's own columns at \d+ of 100/);
  assert.match(status, /2 of 2 signature columns and 6 of 6 billing roles/);
  assert.doesNotMatch(status, /000000000001|anthropic\.claude-sonnet|4\.80/);
});

test("a refused file is told the named reason and the importer it is nearest to", async () => {
  const { document } = await openFinopsTab();
  // A JSON file no route claims: before #957 this reached the reader as the
  // generic "correct the file issue below" line and nothing else.
  chooseFile(document, "notes.json", JSON.stringify({ posting_date: "2026-07-20", note: "n/a" }));
  await waitFor(() => activationState(document) === "error",
    "the unrecognized file to be refused");

  const status = textOf(document.getElementById("local-export-activation-status"));
  assert.match(status, /No cost or amount column was found/);
  assert.match(status, /closest supported importer is .+ which this file matched at \d+ of 100/);
  // The panel keeps its own recovery line: the named reason leads it, never
  // replaces it.
  assert.match(status, /Correct the file issue below/);
  // A message only painted into the panel is one a screen reader never gets.
  const alert = textOf(document.getElementById("local-import-alert"));
  assert.match(alert, /No cost or amount column was found/);
  assert.match(alert, /closest supported importer/);
});

test("an empty file is a named reason rather than a blank panel", async () => {
  const { document } = await openFinopsTab();
  chooseFile(document, "empty.csv", "   \n  \n");
  await waitFor(() => activationState(document) === "error",
    "the empty file to be refused");
  const status = textOf(document.getElementById("local-export-activation-status"));
  assert.match(status, /empty or contains only blank space/);
  assert.match(textOf(document.getElementById("local-import-alert")),
    /empty or contains only blank space/);
});

// --- payload placement ------------------------------------------------------

test("the adapters are loaded on demand, never in the page's initial payload", async () => {
  const source = await readFile(ENTRY, "utf8");
  assert.match(source, /await import\("\/hyperscaler-export-adapters\.js"\)/,
    "the entry point must reach the adapters through a dynamic import");
  // A static import would put the module — and everything it reaches — into the
  // graph scripts/check-size-budget.mjs measures as the first-screen payload.
  assert.doesNotMatch(source, /^import[^;]*from\s*"\/hyperscaler-export-adapters\.js"/m);
  // The detection entry point rides the same dynamic import for the same
  // reason: it runs only once a reader has dropped a file in.
  assert.match(source, /import\("\/export-provider-detection\.js"\)/,
    "the entry point must reach provider detection through a dynamic import");
  assert.doesNotMatch(source, /^import[^;]*from\s*"\/export-provider-detection\.js"/m);
});
