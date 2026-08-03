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
import {
  IMPORT_DROP_IDS, STAND_LABELLED_BY, renderImportReading, renderImportRecognition,
} from "../src/finops-import-drop.js";

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

// A file with nothing in it at all. Its own named failure, and a different one
// from the file above: "empty" and "no cost column" are two different fixes.
const EMPTY_EXPORT = "   \n\n";

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

// A Vertex AI export with its money column left out: recognized as Vertex by
// its signature columns, refused by the import path, and the one file where a
// generic "no cost column" sentence is not enough to act on.
const VERTEX_WITHOUT_COST = [
  { usage_start_time: "2026-07-20", sku: { model_id: "gemini-1.5-pro" },
    usage: { amount: 120000, unit: "input tokens" }, project: { id: "proj-01" } },
  { usage_start_time: "2026-07-21", sku: { model_id: "gemini-1.5-pro" },
    usage: { amount: 45000, unit: "input tokens" }, project: { id: "proj-01" } },
].map((record) => JSON.stringify(record)).join("\n");

test("a refused file carries the check path's one instruction, naming the column", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  browse(document, file("vertex-usage.jsonl", VERTEX_WITHOUT_COST));
  await waitFor(() => reason(document).dataset.state === "unrecognized",
    "the named reason for the export with no amount column");

  // The refusal still says what is wrong, and now ends with the concrete thing
  // to go and do — the preflight verdict, from the import module the analysis
  // path uses, with no analysis run and no briefing built.
  const said = textOf(reason(document));
  assert.match(said, /No cost or amount column was found/);
  assert.ok(said.endsWith("Re-pull the Google Vertex AI export with the cost column included, "
    + "then check it again."), `the preflight instruction is not the last word: ${said}`);
  // Check-only: the reading a visitor already had is untouched.
  assert.equal(source(document).hidden, true);
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

// ---------------------------------------------------------------------------
// #960 — the same path, without a mouse.
//
// Everything below asserts on ids, counts and attribute values. Nothing here
// compares an element object: a null comparison against this harness's nodes
// walks the whole parsed page.
// ---------------------------------------------------------------------------

const stand = (document) => document.getElementById(IMPORT_DROP_IDS.region);
const input = (document) => document.getElementById(IMPORT_DROP_IDS.input);

test("a recognized import lands the reader on their own briefing, named as theirs", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  browse(document, file("bedrock-usage.csv", BEDROCK_EXPORT));
  await recognized(document);

  // (a) THE FOCUS TARGET. Asserted by id, and by the attributes that make the
  // landing legal: a region a script focuses must be programmatically focusable
  // and must never join the tab sequence.
  await waitFor(() => document.activeElement?.id === IMPORT_DROP_IDS.region,
    "focus to move to the result region after a successful import");
  assert.equal(document.activeElement.getAttribute("tabindex"), "-1");

  // And it says whose briefing it is. The question alone named a page section;
  // the source line beside it names the console the figures came from.
  assert.equal(stand(document).getAttribute("aria-labelledby"), STAND_LABELLED_BY);
  for (const id of STAND_LABELLED_BY.split(" ")) {
    assert.equal(document.querySelectorAll(`#${id}`).length, 1,
      `the result region is labelled by #${id}, which is not in the document`);
  }
  assert.match(textOf(source(document)), /AWS Bedrock/,
    "the region's own label does not name the imported source");
});

test("the success announcement names the provider and the confidence", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  browse(document, file("bedrock-usage.csv", BEDROCK_EXPORT));
  await waitFor(() => reason(document).dataset.state === "recognized",
    "the recognition verdict to reach the live region");

  // (b) THE ANNOUNCEMENT. One polite region, and it carries both figures a
  // reader needs to decide whether to trust what just replaced their page.
  const said = textOf(reason(document));
  assert.match(said, /AWS Bedrock/, "the announcement does not name the detected provider");
  assert.match(said, /\d+ of 100/, "the announcement does not carry the confidence");
  assert.equal(reason(document).getAttribute("aria-live"), "polite");
  assert.equal(reason(document).dataset.band, "settled");

  // A polite region inside a collapsed disclosure announces nothing in a real
  // browser, whatever this harness reads through. Counted, not compared.
  const inDisclosure = document.querySelectorAll("details")
    .filter((node) => node.querySelectorAll(`#${IMPORT_DROP_IDS.reason}`).length > 0);
  assert.equal(inDisclosure.length, 0,
    "the import live region sits inside a disclosure that can be collapsed while it speaks");

  // Never colour alone: the chip carries a mark, a word and the value.
  const chip = reason(document).querySelectorAll(".import-chip")[0];
  assert.equal(chip.dataset.status, "recognized");
  assert.equal(textOf(chip.querySelectorAll(".import-chip-label")[0]), "Recognized");
  assert.match(textOf(chip.querySelectorAll(".import-chip-value")[0]), /^\d+ of 100$/);
  assert.equal(chip.querySelectorAll(".import-chip-shape")[0].getAttribute("aria-hidden"), "true");
});

test("a refusal announces its own reason and leaves focus on the import control", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  input(document).focus();

  // (c) THE FAILURE ANNOUNCEMENT. Two different refusals, two different
  // sentences — an empty file and an unreadable one are not one "import failed".
  browse(document, file("nothing.csv", EMPTY_EXPORT));
  await waitFor(() => reason(document).dataset.state === "unrecognized",
    "the named reason for the empty file");
  assert.match(textOf(reason(document)), /empty or contains only blank space/);
  assert.equal(reason(document).querySelectorAll(".import-chip")[0].dataset.status, "rejected");
  assert.equal(textOf(reason(document).querySelectorAll(".import-chip-label")[0]), "Rejected");

  // Focus is not stolen: the reader is still on the control they retry from,
  // and was not moved to a result region that did not change.
  assert.equal(document.activeElement?.id, IMPORT_DROP_IDS.input);
  assert.notEqual(document.activeElement?.id, IMPORT_DROP_IDS.region);

  browse(document, file("notes.csv", NOT_AN_EXPORT));
  await waitFor(() => /No cost or amount column/.test(textOf(reason(document))),
    "the second refusal to name its own different reason");
  assert.doesNotMatch(textOf(reason(document)), /empty or contains only blank space/);
});

test("the import affordance is one real control, reachable before and after an import", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  const control = input(document);

  // A native file control behind a real label: Tab reaches it and Enter or Space
  // opens the picker with no script of ours in the way.
  assert.equal(control.getAttribute("type"), "file");
  assert.equal(control.getAttribute("disabled"), null);
  assert.equal(control.getAttribute("tabindex"), null);
  const label = document.querySelectorAll("label")
    .find((node) => node.getAttribute("for") === IMPORT_DROP_IDS.input);
  assert.match(textOf(label), /Choose your export files/);

  // The zone around it is not a second, competing tab stop.
  const zone = document.getElementById(IMPORT_DROP_IDS.zone);
  assert.equal(zone.getAttribute("tabindex"), null);
  assert.equal(zone.querySelectorAll(`#${IMPORT_DROP_IDS.input}`).length, 1);

  // Post-import: the same control, still in the document, still enabled, still
  // inside the zone — a reader who imported once can import again.
  browse(document, file("bedrock-usage.csv", BEDROCK_EXPORT));
  await recognized(document);
  assert.equal(document.querySelectorAll(`#${IMPORT_DROP_IDS.input}`).length, 1);
  assert.equal(input(document).getAttribute("disabled"), null);
  assert.equal(input(document).hidden, false);
});

test("the reading state is drawn, and never in the live region", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  const state = document.getElementById(IMPORT_DROP_IDS.state);

  renderImportReading(document, true);
  assert.match(textOf(state), /Reading/);
  assert.equal(state.querySelectorAll(".import-chip")[0].dataset.status, "loading");
  // The answer block already speaks this one. A second region saying it is a
  // queue, so this slot is decoration the reader sees and no one hears.
  assert.equal(state.getAttribute("aria-hidden"), "true");
  assert.equal(textOf(reason(document)), "");

  renderImportReading(document, false);
  assert.equal(textOf(state), "");
});

test("the implausible extremes are drawn: a long name, a low confidence, no confidence", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  const longName = "Contoso Global Cloud Cost and Usage Analytics Console (EU-Central Tenancy)";

  // A recognition that did not clear the settled band is still a result. It is
  // banded like a refusal and says what to do rather than reading as a pass.
  renderImportRecognition(document, {
    provider: "contoso", displayName: longName, confidence: 41,
    reason: { code: "provider_detected", message: "" },
  });
  assert.equal(reason(document).dataset.band, "unsettled");
  assert.equal(reason(document).querySelectorAll(".import-chip")[0].dataset.tone, "warn");
  assert.match(textOf(reason(document)), /41 of 100/);
  assert.match(textOf(reason(document)), /open the supporting evidence/i);
  // The long name is not truncated away in the markup, and the source line still
  // carries the provenance words after it.
  assert.match(textOf(source(document)), new RegExp(longName.replace(/[()]/g, "\\$&")));
  assert.match(textOf(source(document)), /your imported export$/);

  // Zero confidence is a number, not a missing one: the chip still shows a value.
  renderImportRecognition(document, {
    provider: "contoso", displayName: "Contoso", confidence: 0,
    reason: { code: "provider_detected", message: "" },
  });
  assert.match(textOf(reason(document).querySelectorAll(".import-chip-value")[0]), /^0 of 100$/);
  assert.equal(reason(document).dataset.band, "unsettled");
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
