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

import { loadPage, parseHtml, textOf } from "./support/browser.js";
import { initDecisionLog } from "../src/app.js";

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
  // #2941: one claim, beside the recorder. The hero's copy was a repeat.
  assert.equal(claims.length, 1, `expected only the demo-step claim, found:\n${claims.join("\n")}`);
  for (const claim of claims) assert.match(claim, EXCEPTION, claim);
});

// #2941: the hero, the four-step guide and the save confirmation each made the
// promise before the decision list. It is made once, in the recorder panel
// directly above the form, and the page's scripts add no second copy.
test("before any record, the promise is made once between the hero and the decision list", async (t) => {
  const page = await loadPage(new URL("../src/index.html", import.meta.url), { storage: {} });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage, { readHealth: async () => { throw new Error("offline"); } });
  const order = walk(page.document.body);
  const start = order.indexOf(page.document.getElementById("top"));
  const end = order.indexOf(page.document.getElementById("decision-list"));
  assert.ok(start >= 0 && end > start, "the hero or the decision list is missing");
  const claims = order.slice(start, end).filter((node) => STAYS.test(textOf(node))
    && !node.children.some((child) => typeof child.getAttribute === "function" && STAYS.test(textOf(child))));
  assert.equal(claims.length, 1, claims.map(textOf).join("\n"));
  assert.equal(claims[0].getAttribute("id"), "evaluation-path-scope");
  assert.match(textOf(claims[0]), EXCEPTION);
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
  assert.equal(textOf(document.getElementById("download-shiplog-archive")), "Download complete Shiplog archive");
});

test("the JSON download and the storage link say where records go", () => {
  const hints = document.querySelector(".export-panel").querySelectorAll("p").map(textOf);
  assert.ok(hints.some((text) => text.startsWith("Download JSON builds its file in this browser and sends nothing.")));
  assert.ok(hints.some((text) => text.startsWith("See what's stored in this browser")
    && text.endsWith("The complete archive download is the only control that sends records to a server.")));
});
