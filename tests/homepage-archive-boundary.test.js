// #2922: the home page told a visitor "Records you add stay in this browser"
// beside the record form and the demo steps, then said further down that the
// complete archive is built on the server. Both are true only if each browser-
// only sentence names that one exception, and the export panel says the archive
// sends records before the visitor presses it.
//
// Text and order only: the harness models no layout and reads through a closed
// details element, so nothing here claims a sentence is visible.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import {
  EXPORT_BUTTON_LABEL,
  EXPORT_STATUS,
  exportedRecordSentence,
  shiplogExportLabel,
} from "../src/shiplog-export.js";
import { initShiplogArchive } from "../src/shiplog-archive-page.js";

const document = parseHtml(await readFile(new URL("../src/index.html", import.meta.url), "utf8"));
const STAYS = /\bstays? in this browser\b/;
const EXCEPTION = /unless you download the complete archive, which sends them to the Shiplog server to build the file\./;

// Element nodes in document order. The harness rejects `*`, so walk children,
// and skip text nodes by the attribute API they lack.
function walk(node, out = []) {
  for (const child of node.children ?? []) {
    if (typeof child.getAttribute !== "function") continue;
    out.push(child);
    walk(child, out);
  }
  return out;
}

// The decision-log and export sections this issue covers. The evaluation brief
// and the security boundaries make their own storage claims; they are pinned by
// shared-log-question.test.js and homepage-security-boundaries.test.js.
const sections = [
  document.getElementById("top"),
  document.querySelector(".evaluation-path"),
  document.querySelector(".export-panel"),
];

test("every stays-in-this-browser sentence in the log and export sections names the archive", () => {
  assert.equal(sections.filter(Boolean).length, 3, "a covered section is missing");
  const claims = sections.flatMap((section) => section.querySelectorAll("p").map(textOf))
    .filter((text) => STAYS.test(text));
  assert.equal(claims.length, 2, `expected the hero and demo-step claims, found:\n${claims.join("\n")}`);
  for (const claim of claims) assert.match(claim, EXCEPTION, claim);
});

test("the archive's server step is stated before its control, in the export panel", () => {
  const order = walk(document.body);
  const note = order.findIndex((node) => node.getAttribute("id") === "shiplog-archive-note");
  const button = order.findIndex((node) => node.getAttribute("id") === "download-shiplog-archive");
  assert.ok(note >= 0 && button >= 0, "the archive note or control is missing");
  assert.ok(note < button, "the server sentence comes after the archive control");

  const text = textOf(document.getElementById("shiplog-archive-note"));
  assert.match(text, /This download sends those records to the Shiplog server to build the file/);
  assert.match(text, /the server does not retain them\./);
  assert.equal(textOf(document.getElementById("download-shiplog-archive")), "Download complete archive");
});

test("the browser export and the storage link say where records go", () => {
  const hints = document.querySelector(".export-panel").querySelectorAll("p").map(textOf);
  assert.ok(hints.some((text) => text.startsWith(
    "Browser export: the records chosen above, built into a JSON file in this browser. Nothing is sent.")));
  assert.ok(hints.some((text) => text.startsWith("See what's stored in this browser")
    && text.endsWith("The complete archive is the only download that sends records to a server.")));
});

// Scope and data handling must be associated with the control itself, not
// merely somewhere in the panel. This checks DOM associations, not layout.
test("each download describes its scope and data boundary before activation", () => {
  const browser = document.getElementById("export-shiplog");
  const archive = document.getElementById("download-shiplog-archive");
  const description = (button) => button.getAttribute("aria-describedby")
    .split(/\s+/).map((id) => {
      const note = document.getElementById(id);
      assert.ok(note, `Missing description: ${id}`);
      return textOf(note);
    }).join(" ");
  assert.match(description(browser), /follows your history filters by default/);
  assert.match(description(browser), /export every stored record/);
  assert.match(description(browser), /in this browser\. Nothing is sent\./);
  assert.match(description(archive), /every decision and release stored in this browser, regardless of filters/);
  assert.match(description(archive), /sends those records to the Shiplog server/);
  assert.match(description(archive), /server does not retain them/);
  const order = walk(document.body);
  assert.ok(order.indexOf(document.getElementById("browser-export-note")) < order.indexOf(browser));
  assert.ok(order.indexOf(browser) < order.indexOf(document.getElementById("shiplog-archive-note")),
    "the browser download must precede the other path's explanation");
});

// #2933: "Download JSON", "Export history", and "Complete archive" read as one
// path. Each path now has one name, carried by its button, its sentence, and
// every status line it writes, and neither name appears in the other's.
test("each export path keeps its own name on its button, sentence, and status lines", async () => {
  assert.equal(textOf(document.getElementById("export-shiplog")), EXPORT_BUTTON_LABEL);
  assert.equal(EXPORT_BUTTON_LABEL, "Download browser export (JSON)");
  assert.match(textOf(document.getElementById("shiplog-archive-note")), /^Complete archive: /);

  const browserLines = [
    ...Object.values(EXPORT_STATUS).filter((line) => !line.startsWith("No file was written")),
    exportedRecordSentence({ recordCount: 3, filtered: true }),
    shiplogExportLabel({ decisions: 2, releases: 1, filtered: true }),
  ];
  for (const line of browserLines) {
    assert.match(line, /browser export/i, line);
    assert.doesNotMatch(line, /archive/i, line);
  }

  const archiveLines = await archiveStatusLines();
  assert.deepEqual(archiveLines, [
    "Complete archive downloaded.",
    "Complete archive could not be downloaded. Your records are unchanged. Try again.",
  ]);
  for (const line of archiveLines) assert.doesNotMatch(line, /browser export|JSON/i, line);
});

// Presses the archive button once against a stub server that answers, and once
// against one that refuses, and returns the status line each press left.
async function archiveStatusLines() {
  const lines = [];
  for (const ok of [true, false]) {
    let click;
    const button = { disabled: false, addEventListener(_type, listener) { click = listener; } };
    const status = { textContent: "" };
    const documentRef = {
      getElementById: (id) => ({ "download-shiplog-archive": button, "shiplog-archive-status": status })[id] ?? null,
      createElement: () => ({ click() {}, remove() {} }),
      body: { append() {} },
    };
    const headers = new Map([
      ["content-disposition", 'attachment; filename="shiplog-archive-2026-10-19.json"'],
      ["content-type", "application/json; charset=utf-8"],
    ]);
    const fetch = async () => ({ ok, headers, blob: async () => new Blob(["{}"]) });
    const storage = { getItem: () => null };
    initShiplogArchive(documentRef, storage, { fetch, urlApi: { createObjectURL: () => "blob:x", revokeObjectURL() {} } });
    await click();
    lines.push(status.textContent);
  }
  return lines;
}
