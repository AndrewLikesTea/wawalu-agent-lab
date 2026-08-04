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
import { DomEvent, loadPage, tabSequence, textOf } from "./support/browser.js";
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

// --- the no-commitment check (#1064) ----------------------------------------
//
// The check runs the preflight from the same adapters module the analysis path
// uses and then stops. What only these tests can catch is that it stops: that a
// verdict is one answer, one detail and one control rather than a report, and
// that checking a file leaves a brief the reader already has — and the context
// they typed onto it — exactly where it was.

const checkZone = (document) => document.getElementById("finops-export-check");
const checkState = (document) => checkZone(document).dataset.check;
const checkSlot = (document, slot) =>
  document.getElementById(`finops-export-check-${slot}`);

function checkExport(document, name, text) {
  const input = document.getElementById("finops-export-check-file");
  input.files = [{ name, type: "text/csv", text: async () => text }];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

const ledger = () => csv(["posting_date", "gl_account", "amount"], [
  ["2026-07-20", "6100-software", "482.10"],
]);

test("a recognized check answers the question, names what it read, and stops", async () => {
  const { document } = await openFinopsTab();
  checkExport(document, "bedrock-usage.csv", BEDROCK_EXPORT);
  await waitFor(() => checkState(document) === "recognized", "the check to recognize the export");

  assert.equal(textOf(checkSlot(document, "answer")), "Yes — this export will analyze.");
  assert.equal(textOf(checkSlot(document, "detail")),
    "AWS Bedrock · 3 rows · 3 dated periods covered.");
  // A check is not a quieter import: no analysis ran, so the result surface is
  // still closed and the picker's own live region never spoke.
  assert.equal(activationState(document), "idle");
  assert.equal(document.getElementById("local-results").hidden, true);
  assert.equal(document.getElementById("finops-import-reason").dataset.state, "idle");
});

test("the check says which figures the brief will earn, with the counts in the summary", async () => {
  const { document } = await openFinopsTab();
  checkExport(document, "bedrock-usage.csv", BEDROCK_EXPORT);
  await waitFor(() => checkState(document) === "recognized", "the check to recognize the export");

  // The counts are on the summary itself. A real browser does not read a
  // collapsed disclosure out however readable this harness finds it, so a
  // collapsed panel still has to say how many figures this export earns.
  const summary = document.getElementById("finops-export-check-capability-summary");
  assert.equal(textOf(summary), "What this export earns on the brief — 6 earnable, 1 withheld");
  // Collapsed on arrival, in the idiom of the column breakdown beside it.
  assert.equal(summary.parentNode.hasAttribute("open"), false);
  assert.equal(summary.parentNode.hidden, false);

  const rows = [...document.getElementById("finops-export-check-capability-list")
    .querySelectorAll("li")];
  assert.equal(rows.length, 7);
  assert.equal(rows.filter((row) => row.dataset.state === "missing").length, 1);
  // Three dated days inside one month are one billing month, so the movement is
  // the one figure this export cannot earn — and it says what would unlock it.
  const withheld = rows.find((row) => row.dataset.state === "missing");
  assert.match(textOf(withheld), /Period-over-period movement/);
  assert.match(textOf(withheld), /Withheld — needs a second billing period/);
  // Nothing was analyzed to say any of that.
  assert.equal(document.getElementById("local-results").hidden, true);
});

test("a refusal names the missing column and links to that console's guidance entry", async () => {
  const { document } = await openFinopsTab();
  checkExport(document, "bedrock-no-currency.csv", BEDROCK_INCOMPLETE);
  await waitFor(() => checkState(document) === "refused", "the check to refuse the export");

  assert.equal(textOf(checkSlot(document, "answer")), "No — this export will not analyze as it is.");
  assert.match(textOf(checkSlot(document, "detail")),
    /AWS Bedrock was recognized, but the required column lineItem\/CurrencyCode is not in this file\./);
  // One control, and it carries both halves: the instruction preflight wrote,
  // and the way back to the entry that says where the export comes from.
  const guidance = checkSlot(document, "guidance");
  assert.equal(guidance.hidden, false);
  assert.equal(checkSlot(document, "continue").hidden, true);
  assert.match(textOf(guidance),
    /Re-pull the AWS Bedrock export with the lineItem\/CurrencyCode column included/);
  assert.match(textOf(guidance), /Open the AWS Bedrock export guidance above\./);
  assert.equal(guidance.href, "#provider-readiness-bedrock");
  // The anchor resolves: the guidance entry it names is on this page, once.
  assert.equal(document.querySelectorAll("#provider-readiness-bedrock").length, 1);
  // Nothing was created on this path.
  assert.equal(document.getElementById("local-results").hidden, true);
});

test("a file dropped on the check zone is checked, and is not imported by the page", async () => {
  const { document } = await openFinopsTab();
  // The page body is a drop target for the FULL import (#958). A file dropped on
  // the check zone must stop here: a reader who came to check has not agreed to
  // an analysis, and the drop that starts one is indistinguishable from theirs.
  const event = new DomEvent("drop", { bubbles: true });
  event.dataTransfer = { files: [{ name: "bedrock-usage.csv", type: "text/csv",
    text: async () => BEDROCK_EXPORT }] };
  document.getElementById("finops-export-check").dispatchEvent(event);
  await waitFor(() => checkState(document) === "recognized", "the dropped file to be checked");

  assert.equal(activationState(document), "idle");
  assert.equal(document.getElementById("local-results").hidden, true);
  assert.equal(document.getElementById("finops-import-reason").dataset.state, "idle");
});

test("a file no console claims is sent back to the five entries, not to one of them", async () => {
  const { document } = await openFinopsTab();
  checkExport(document, "ledger.csv", ledger());
  await waitFor(() => checkState(document) === "refused", "the check to refuse the ledger");
  const guidance = checkSlot(document, "guidance");
  assert.equal(guidance.href, "#provider-readiness");
  assert.match(textOf(guidance), /none of their signature columns are in this file/);
});

test("an existing brief and the reader's own context both survive a failed check", async () => {
  const { document } = await openFinopsTab();
  // A brief of the reader's own, from the picker that commits.
  chooseFile(document, "bedrock-usage.csv", BEDROCK_EXPORT);
  await waitFor(() => activationState(document) === "ready", "the imported brief to paint");

  // Context the reader typed onto it: their own name for one of their own units.
  const naming = document.querySelectorAll(".first-run-unit-label-input");
  assert.ok(naming.length > 0, "the imported brief must offer the reader a naming field");
  naming[0].value = "Platform Engineering";
  naming[0].dispatchEvent(new DomEvent("input", { bubbles: true }));

  const brief = textOf(document.getElementById("local-results"));
  const status = textOf(document.getElementById("local-export-activation-status"));

  checkExport(document, "bedrock-no-currency.csv", BEDROCK_INCOMPLETE);
  await waitFor(() => checkState(document) === "refused", "the second file to be refused");

  assert.equal(document.getElementById("local-results").hidden, false);
  assert.equal(textOf(document.getElementById("local-results")), brief);
  assert.equal(textOf(document.getElementById("local-export-activation-status")), status);
  assert.equal(activationState(document), "ready");
  assert.equal(document.querySelectorAll(".first-run-unit-label-input")[0].value,
    "Platform Engineering");
});

test("continuing from a recognized check runs the full analysis on the same file", async () => {
  const { document } = await openFinopsTab();
  checkExport(document, "bedrock-usage.csv", BEDROCK_EXPORT);
  await waitFor(() => checkState(document) === "recognized", "the check to recognize the export");

  // The picker holds nothing: whatever the analysis reads, it does not read a
  // second selection the reader made.
  const picker = document.getElementById("local-finops-files");
  picker.files = [];
  checkSlot(document, "continue").click();
  await waitFor(() => activationState(document) === "ready",
    "the checked file to run the full analysis");

  assert.match(textOf(document.getElementById("local-export-activation-status")),
    /AWS Bedrock export adapted locally/);
  assert.equal(picker.files.length, 0);
  assert.equal(checkState(document), "continued");
});

test("a verdict is one answer, one detail and one action, with the breakdown collapsed", async () => {
  const { document } = await openFinopsTab();
  checkExport(document, "bedrock-usage.csv", BEDROCK_EXPORT);
  await waitFor(() => checkState(document) === "recognized", "the check to recognize the export");

  const shown = ["answer", "detail", "continue", "guidance"]
    .filter((slot) => !checkSlot(document, slot).hidden);
  assert.deepEqual(shown, ["answer", "detail", "continue"]);

  // The breakdown is present and closed. Asserted on the attribute rather than
  // on what the text reads: this harness has no layout and reads straight
  // through a closed disclosure.
  const disclosure = checkSlot(document, "columns");
  assert.equal(disclosure.hasAttribute("open"), false);
  assert.equal(disclosure.hidden, false);
  // Two disclosures and no third: the column breakdown, and the figure preview
  // #1065 added beside it. Both ship collapsed, and neither holds a control.
  assert.equal(checkZone(document).querySelectorAll("details").length, 2);
  assert.equal(document.getElementById("finops-export-check-column-list")
    .querySelectorAll("li").length, 7);

  // The live region is not inside it. A region a reader has to open to hear is
  // a region assistive technology was never watching.
  let ancestor = checkSlot(document, "answer").parentNode;
  while (ancestor && ancestor.nodeType === 1) {
    assert.notEqual(ancestor.tagName, "DETAILS");
    ancestor = ancestor.parentNode;
  }
  // And it was already in the document, with a sentence in it, before any file
  // was checked — the same node, never a replacement.
  const fresh = await openFinopsTab();
  assert.match(textOf(checkSlot(fresh.document, "answer")), /No export checked yet/);
  assert.equal(checkSlot(fresh.document, "answer").getAttribute("aria-live"), "polite");
});

test("the keyboard reaches the check control, its one action, and the breakdown", async () => {
  const { document } = await openFinopsTab();
  checkExport(document, "bedrock-usage.csv", BEDROCK_EXPORT);
  await waitFor(() => checkState(document) === "recognized", "the check to recognize the export");

  const order = (node) => tabSequence(document).indexOf(node);
  const control = order(document.getElementById("finops-export-check-file"));
  const summary = order(checkZone(document).querySelector("summary"));
  assert.ok(control >= 0, "the check's file control must be reachable by Tab");
  assert.ok(control < order(checkSlot(document, "continue")),
    "the one action follows the control that produced it");
  assert.ok(order(checkSlot(document, "continue")) < summary,
    "the breakdown comes after the action, never in front of it");
  // The hidden path is out of the sequence, so a keyboard reader meets one next
  // step rather than two, one of which does nothing.
  assert.equal(order(checkSlot(document, "guidance")), -1);

  checkExport(document, "bedrock-no-currency.csv", BEDROCK_INCOMPLETE);
  await waitFor(() => checkState(document) === "refused", "the second file to be refused");
  assert.ok(order(checkSlot(document, "guidance")) > control,
    "the refusal's link is reachable by Tab from the control");
  assert.equal(order(checkSlot(document, "continue")), -1);
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
  // The check zone mounts at boot — its live region has to be in the document
  // before there is anything to announce — so it is in the graph. What it must
  // not drag in with it is the adapters, which it too reaches on demand.
  const check = await readFile(new URL("../src/finops-export-check.js", import.meta.url), "utf8");
  assert.match(check, /import\("\.\/hyperscaler-export-adapters\.js"\)/);
  assert.doesNotMatch(check, /^import[^;]*from\s*"\.\/hyperscaler-export-adapters\.js"/m);
});
