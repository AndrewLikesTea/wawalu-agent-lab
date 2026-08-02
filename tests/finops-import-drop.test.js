// The one import affordance on /evolution.html (#958), driven through the real
// page entry. Nothing between the file and the panel is stubbed.
//
// What only this file can catch: that drop and browse reach the SAME handler and
// produce the same reading, that an unrecognized file names its reason without
// taking the reading a visitor already has away from them, and that the three
// provider pickers this consolidated are gone from the document.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const BEDROCK_HEADER = ["lineItem/UsageStartDate", "product/model_id", "lineItem/UsageAmount",
  "lineItem/UnblendedCost", "lineItem/CurrencyCode", "lineItem/UsageAccountId",
  "lineItem/UsageType"];
const bedrockRow = (date, units, cost) => [date, "anthropic.claude-sonnet", units, cost,
  "USD", "000000000001", "USE1-InputTokenCount"];
const BEDROCK_EXPORT = `${[BEDROCK_HEADER,
  bedrockRow("2026-07-20", "120000", "4.80"),
  bedrockRow("2026-07-21", "45000", "0.90"),
  bedrockRow("2026-07-22", "98000", "3.92")].map((row) => row.join(",")).join("\n")}\n`;

// No cost column, no provider signature: the recognition entry point names a
// reason for this rather than refusing it anonymously.
const NOT_AN_EXPORT = "note,author\nreview the invoice,rowan\n";

const file = (name, text) => ({ name, type: "text/csv", text: async () => text });

async function openFinopsTab() {
  const page = await loadPage(PAGE, {
    storage: {},
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  return page;
}

/** The browse path: a real file control, a real change event. */
function browse(document, chosen) {
  const input = document.getElementById("local-finops-files");
  input.files = [chosen];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
}

/** The drop path: a file released anywhere on the page body. */
function dropOnPage(document, chosen) {
  const event = new DomEvent("drop", { bubbles: true });
  event.dataTransfer = { files: [chosen] };
  document.body.dispatchEvent(event);
  return event;
}

const source = (document) => document.getElementById("finops-stand-import-source");
const reason = (document) => document.getElementById("finops-import-reason");

const recognized = (document) => waitFor(() => source(document).hidden === false,
  "the recognized provider and confidence to reach the result region");

test("a dropped export names its provider and confidence in the result region", async () => {
  const page = await openFinopsTab();
  const { document } = page;
    dropOnPage(document, file("bedrock-usage.csv", BEDROCK_EXPORT));
    await recognized(document);

    const line = textOf(source(document));
    assert.match(line, /AWS Bedrock/, "the detected provider is not in the result region");
    assert.match(line, /confidence \d+ of 100/, "the confidence value is not in the result region");
    // Whose figures these are, in the exact words the criteria name.
    assert.match(line, /your imported export/);
    // Visible on arrival: the region carries no `hidden`, and its state is on
    // the lead finding itself rather than behind a disclosure.
    assert.equal(source(document).hidden, false);
    assert.equal(document.getElementById("finops-stand").dataset.provenance, "your imported export");
    assert.equal(document.getElementById("finops-stand").dataset.detectedProvider, "bedrock");
});

test("the browse control alone produces the identical result", async () => {
  const page = await openFinopsTab();
  const { document } = page;
    // No drag event is dispatched anywhere in this test: the file control on its
    // own completes the whole import.
    browse(document, file("bedrock-usage.csv", BEDROCK_EXPORT));
    await recognized(document);

    assert.match(textOf(source(document)), /AWS Bedrock/);
    assert.match(textOf(source(document)), /confidence \d+ of 100/);
    assert.match(textOf(source(document)), /your imported export/);
    assert.equal(document.getElementById("finops-stand").dataset.detectedProvider, "bedrock");
});

test("an unrecognized file names its reason and leaves the reading on screen", async () => {
  const page = await openFinopsTab();
  const { document } = page;
    browse(document, file("bedrock-usage.csv", BEDROCK_EXPORT));
    await recognized(document);
    const stood = textOf(source(document));
    const recoverable = textOf(document.getElementById("finops-stand-recoverable-value"));
    const department = textOf(document.getElementById("finops-stand-team-name"));

    dropOnPage(document, file("notes.csv", NOT_AN_EXPORT));
    await waitFor(() => reason(document).dataset.state === "unrecognized",
      "the named reason for the unrecognized file");

    // The reason is the recognition entry point's own sentence, not a generic
    // "could not analyze": it names what was missing and the nearest importer.
    const said = textOf(reason(document));
    assert.match(said, /No cost or amount column was found/);
    assert.match(said, /closest supported importer|No supported importer matched/);
    // A live region that was in the document before the failure, beside the
    // import control, so the update is announced without moving focus.
    assert.equal(reason(document).getAttribute("role"), "status");
    assert.equal(reason(document).getAttribute("aria-live"), "polite");

    // And the first reader's result is exactly what it was.
    assert.equal(textOf(source(document)), stood);
    assert.equal(textOf(document.getElementById("finops-stand-recoverable-value")), recoverable);
    assert.equal(textOf(document.getElementById("finops-stand-team-name")), department);
});

test("a drag over the page is a state in words, and the drop is not a navigation", async () => {
  const page = await openFinopsTab();
  const { document } = page;
    const over = new DomEvent("dragover", { bubbles: true });
    document.body.dispatchEvent(over);
    // Without this the browser leaves the page for the dropped file.
    assert.equal(over.defaultPrevented, true, "dragover was not prevented");
    assert.equal(document.getElementById("finops-import-drop").dataset.dragging, "true");
    // More than colour: the active state is a word as well as a border.
    assert.equal(textOf(document.getElementById("finops-import-drop-state")), "Drop to import");

    document.body.dispatchEvent(new DomEvent("dragleave", { bubbles: true }));
    assert.equal(document.getElementById("finops-import-drop").dataset.dragging, "false");
    assert.equal(textOf(document.getElementById("finops-import-drop-state")), "");
});

test("the three provider pickers this replaced are gone from the document", async () => {
  const page = await openFinopsTab();
  const { document } = page;
    // Counted, never compared to null: a null-comparison assertion against this
    // harness's element objects walks the whole parsed page and hangs.
    for (const id of ["browser-compat-file", "provider-native-file", "provider-native-drop"]) {
      assert.equal(document.querySelectorAll(`#${id}`).length, 0,
        `${id} is still a second way to import the same export`);
    }
    // One file control for a provider export, and one for the saved briefing —
    // which says what it reopens rather than reading as a rival importer.
    const fileInputs = document.querySelectorAll("input")
      .filter((node) => node.getAttribute("type") === "file");
    assert.deepEqual(fileInputs.map((node) => node.getAttribute("id")).sort(),
      ["local-finops-files", "reopen-briefing-file"]);
    const label = document.querySelectorAll("label")
      .find((node) => node.getAttribute("for") === "reopen-briefing-file");
    assert.match(textOf(label), /Reopen a saved briefing/);
});
