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
import { DomEvent, loadPage, pressEnter, pressSpace, tabSequence, textOf } from "./support/browser.js";
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

// A file with a header row and nothing under it: the recognition entry point has
// its own sentence for this, and it is not the one it uses for a wrong shape.
const EMPTY_EXPORT = "   \n\n";

const source = (document) => document.getElementById("finops-stand-import-source");
const reason = (document) => document.getElementById("finops-import-reason");

/**
 * How many disclosures this node is folded inside.
 *
 * A count, never a comparison against the element itself: an assertion on one of
 * this harness's element objects walks the whole parsed page and hangs. And a
 * count is the only honest question here, because `textOf` reads straight
 * through a closed disclosure — a live region inside one passes every text
 * assertion in this file while being silent in a real browser.
 */
function disclosureDepth(node) {
  let depth = 0;
  for (let cursor = node.parentNode; cursor && cursor.nodeType === 1; cursor = cursor.parentNode) {
    if (cursor.tagName === "DETAILS") depth += 1;
  }
  return depth;
}

/** The name a screen reader announces on arriving at a region. */
function accessibleName(document, node) {
  const labelledBy = (node.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean);
  if (labelledBy.length) {
    return labelledBy.map((id) => textOf(document.getElementById(id))).join(" ").replace(/\s+/g, " ").trim();
  }
  return node.getAttribute("aria-label") ?? textOf(node);
}

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

// --- #960: the same journey without a mouse -------------------------------

test("a recognized import lands focus on the reader's own briefing, named as theirs", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  const stand = document.getElementById("finops-stand");
  // Before the import the region is named by the question alone — there is no
  // briefing of the reader's to name yet.
  assert.equal(accessibleName(document, stand), "Where do we stand on AI spend?");

  browse(document, file("bedrock-usage.csv", BEDROCK_EXPORT));
  await recognized(document);

  // Focus is on the result region itself, not back at the top of the page and
  // not left on the file control the reader has finished with.
  assert.equal(document.activeElement?.id, "finops-stand",
    "focus did not move to the result region after a successful import");
  // And what it announces on arrival is the reader's own briefing: the detected
  // provider, how sure the recognition was, and which file it came from.
  const named = accessibleName(document, stand);
  assert.match(named, /Your AWS Bedrock briefing/);
  assert.match(named, /recognized at \d+ of 100/);
  assert.match(named, /bedrock-usage\.csv/);
  // The question survives as the second half rather than being replaced.
  assert.match(named, /Where do we stand on AI spend\?$/);
});

test("the success announcement carries the provider and the confidence", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  dropOnPage(document, file("bedrock-usage.csv", BEDROCK_EXPORT));
  await waitFor(() => reason(document).dataset.state === "recognized",
    "the recognized outcome to reach the live region");

  const said = textOf(reason(document));
  assert.match(said, /AWS Bedrock/, "the announcement does not name the detected provider");
  assert.match(said, /\d+ of 100/, "the announcement does not carry the confidence");
  assert.match(said, /high confidence|moderate confidence|low confidence/,
    "the confidence tier is not a word, so only the tint carries it");
  // The outcome is a chip with a shape and a word in it, so the meaning is not
  // the wash behind it.
  const chip = reason(document).querySelector(".import-reason-chip");
  assert.equal(chip.dataset.outcome, "recognized");
  assert.match(textOf(chip), /Recognized/);
  assert.equal(reason(document).querySelectorAll(".import-reason-shape")
    .filter((mark) => mark.getAttribute("aria-hidden") === "true").length, 1,
    "the chip's mark is not decoration, so it is spoken as part of the outcome");
});

test("an empty file is refused by its own reason, not a generic failure", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  browse(document, file("nothing-in-here.csv", EMPTY_EXPORT));
  await waitFor(() => reason(document).dataset.state === "unrecognized",
    "the named reason for the empty file");

  const said = textOf(reason(document));
  assert.match(said, /empty or contains only blank space/,
    "the announcement does not say what was actually wrong with this file");
  assert.doesNotMatch(said, /import failed/i);
  assert.match(textOf(reason(document).querySelector(".import-reason-chip")), /Not recognized/);
  // A refusal does not drag the reader anywhere: they are still at the control
  // they will use again.
  assert.notEqual(document.activeElement?.id, "finops-stand");
});

test("an unreadable file names the browser's refusal, and only that", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  browse(document, {
    name: "locked.csv",
    type: "text/csv",
    text: async () => { throw new Error("permission denied"); },
  });
  await waitFor(() => reason(document).dataset.state === "unrecognized",
    "the named reason for the unreadable file");
  assert.match(textOf(reason(document)), /could not be read in this browser/);
});

test("the live region is not folded inside a disclosure, before or after it speaks", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  // Counted, not compared against an element: a text assertion cannot catch this
  // at all, because this harness reads through a closed disclosure.
  assert.equal(disclosureDepth(reason(document)), 0,
    "the import live region ships inside a disclosure, so a real browser never announces it");
  assert.equal(reason(document).getAttribute("aria-live"), "polite");

  dropOnPage(document, file("bedrock-usage.csv", BEDROCK_EXPORT));
  await recognized(document);
  assert.equal(disclosureDepth(reason(document)), 0);
  // The same rule for the line the result region carries.
  assert.equal(disclosureDepth(source(document)), 0);
  assert.equal(disclosureDepth(document.getElementById("finops-stand-owner")), 0);
});

test("the import is completed from the keyboard alone", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  const input = document.getElementById("local-finops-files");
  const browseButton = document.getElementById("finops-import-browse");

  // Both halves of the one affordance are tab stops: the button that opens the
  // picker and the file control it opens.
  const sequence = tabSequence(document);
  assert.equal(sequence.includes(browseButton), true, "the browse control is not in the tab order");
  assert.equal(sequence.includes(input), true, "the file control is not in the tab order");

  let opened = 0;
  input.addEventListener("click", () => { opened += 1; });
  browseButton.focus();
  pressEnter(document);
  assert.equal(opened, 1, "Enter did not open the file control");
  browseButton.focus();
  pressSpace(document);
  assert.equal(opened, 2, "Space did not open the file control");

  // And the file the picker hands back completes the import with no drag event
  // dispatched anywhere in this test.
  browse(document, file("bedrock-usage.csv", BEDROCK_EXPORT));
  await recognized(document);
  assert.match(textOf(source(document)), /AWS Bedrock/);
  assert.equal(document.activeElement?.id, "finops-stand");
});

test("every import state is drawn on the zone, not left to the reason line", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  const zone = document.getElementById("finops-import-drop");
  assert.equal(zone.dataset.state, "empty");

  browse(document, file("notes.csv", NOT_AN_EXPORT));
  // The reading state is set on the same tick the import starts.
  assert.equal(zone.dataset.state, "reading");
  assert.equal(textOf(document.getElementById("finops-import-drop-state")), "Reading your file");
  await waitFor(() => zone.dataset.state === "refused", "the refused state on the drop zone");

  browse(document, file("bedrock-usage.csv", BEDROCK_EXPORT));
  await waitFor(() => zone.dataset.state === "imported", "the imported state on the drop zone");
});

test("a very long file name is clipped in the accessible name and wraps in the visible one", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  const long = `${"quarterly-bedrock-consolidated-billing-export-".repeat(6)}final.csv`;
  browse(document, file(long, BEDROCK_EXPORT));
  await recognized(document);

  const owner = textOf(document.getElementById("finops-stand-owner"));
  assert.match(owner, /Your AWS Bedrock briefing/);
  assert.match(owner, /…\.$/, "the clipped name does not say it was clipped");
  assert.ok(owner.length < long.length,
    "the whole file name is read out before the reader hears their own figures");
  // The visible line is untouched by the clip and still says whose data it is.
  assert.match(textOf(source(document)), /your imported export/);
});

test("a low-confidence recognition says so in words as well as in the chip", async () => {
  const page = await openFinopsTab();
  const { document } = page;
  const { confidenceTier } = await import("../src/finops-import-drop.js");
  for (const [confidence, word] of [[92, "high confidence"], [70, "moderate confidence"],
    [31, "low confidence"]]) {
    assert.equal(confidenceTier(confidence).word, word);
    // Each tier is also a different silhouette, so the three are separable with
    // no colour at all.
    assert.equal(confidenceTier(confidence).shape.length, 1);
  }
  assert.equal(new Set([92, 70, 31].map((value) => confidenceTier(value).shape)).size, 3);
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
