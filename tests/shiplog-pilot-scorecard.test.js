import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bindPilotScorecard, PILOT_SCORECARD_TEXT } from "../src/shiplog-pilot-scorecard.js";
import { loadPage, textOf, pressEnter, pressSpace, tabSequence } from "./support/browser.js";

const page = new URL("../src/index.html", import.meta.url);
const settle = () => new Promise((resolve) => setImmediate(resolve));
async function open(t, clipboard) {
  const home = await loadPage(page);
  t.after(() => home.restore());
  const doc = home.document;
  // The lightweight DOM models focus but not native textarea selection.
  doc.getElementById("pilot-scorecard-manual").select = function () { this.selected = true; };
  assert.equal(bindPilotScorecard(doc, clipboard), true);
  return doc;
}

test("homepage places four blank buyer measurements immediately after the evaluation brief", async (t) => {
  const doc = await open(t, {});
  const card = doc.getElementById("shiplog-pilot-scorecard");
  assert.equal(card.getAttribute("aria-labelledby"), "shiplog-pilot-scorecard-title");
  const rows = card.querySelectorAll("li");
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => textOf(row.querySelector("h3"))), [
    "Release reasoning retrieval", "Record completeness", "Team handoff", "Data-handling requirements",
  ]);
  for (const row of rows) {
    assert.match(textOf(row.querySelector("p")), /^Your evaluating team must /);
    assert.deepEqual(row.querySelectorAll("dt").map(textOf), ["Buyer target", "Observed result", "Owner"]);
    assert.deepEqual(row.querySelectorAll("dd").map(textOf), ["________", "________", "________"]);
    assert.equal(row.querySelectorAll("input,textarea").length, 0);
  }
  const paragraphs = card.querySelectorAll("p");
  const expected = [textOf(card.querySelector("h2")), textOf(paragraphs[0]),
    ...rows.map((row, i) => `${i + 1}. ${textOf(row.querySelector("h3"))}\n${textOf(row.querySelector("p"))}\nBuyer target: ________\nObserved result: ________\nOwner: ________`),
    "The example decisions and releases are invented, use no customer or production data, and are not customer results.",
    "Page: https://labs.wawalu.org/"].join("\n\n");
  assert.equal(PILOT_SCORECARD_TEXT, expected);
  assert.ok(textOf(card).includes("No pilot outcome is claimed."));
  assert.ok(textOf(card).includes(expected.split("\n\n").at(-2)));
  assert.equal(card.querySelector("a").getAttribute("href"), "https://labs.wawalu.org/");
  const html = await readFile(page, "utf8");
  assert.match(html, /id="shiplog-evaluation-brief"[\s\S]*?<\/section>\s*<section[^>]*id="shiplog-pilot-scorecard"/);
  assert.ok(html.indexOf('id="shiplog-pilot-scorecard"') < html.indexOf('id="additional-capability"'));
  assert.match(html, /<script type="module" src="\/shiplog-pilot-scorecard.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\/shiplog-pilot-scorecard.css" \/>/);
  const css = await readFile(new URL("../src/shiplog-pilot-scorecard.css", import.meta.url), "utf8");
  assert.match(css, /@media\(max-width:520px\).*pilot-scorecard-fields.*grid-template-columns:1fr/);
  assert.match(await readFile(new URL("../src/styles.css", import.meta.url), "utf8"), /\.share-button:focus-visible\s*\{ outline:3px solid/);
});

test("keyboard copy awaits success, preserves focus, and excludes even mutated page/user data", async (t) => {
  let finish;
  const writes = [];
  const doc = await open(t, { writeText: (text) => { writes.push(text); return new Promise((resolve) => { finish = resolve; }); } });
  const button = doc.getElementById("copy-pilot-scorecard");
  const status = doc.getElementById("pilot-scorecard-status");
  doc.getElementById("shiplog-pilot-scorecard-title").textContent = "PRIVATE RECORD";
  doc.getElementById("pilot-scorecard-manual").value = "PRIVATE FORM";
  globalThis.localStorage.setItem("shiplog-decisions", "PRIVATE DECISION");
  globalThis.localStorage.setItem("shiplog-releases", "PRIVATE RELEASE");
  assert.ok(tabSequence(doc).includes(button));
  button.focus();
  pressEnter(doc);
  pressSpace(doc);
  assert.deepEqual(writes, [PILOT_SCORECARD_TEXT]);
  assert.match(textOf(status), /^Copying/);
  assert.equal(doc.activeElement, button);
  finish();
  await settle();
  assert.match(textOf(status), /^Pilot scorecard and canonical page link copied/);
  assert.equal(button.getAttribute("aria-disabled"), null);
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(status.getAttribute("aria-atomic"), "true");
  assert.equal(button.getAttribute("aria-describedby"), status.id);
  assert.doesNotMatch(writes[0], /PRIVATE|\?|#|achieved|testimonial/i);
  // The same word the opening section and the brief use (#2284), with both claims intact.
  assert.ok(writes[0].includes("The example decisions and releases are invented, use no customer or production data, and are not customer results."));
  assert.doesNotMatch(writes[0], /synthetic/i);
  // The only dependency is the clipboard helper; document access is limited to controls.
  const source = await readFile(new URL("../src/shiplog-pilot-scorecard.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /localStorage|sessionStorage|location\.|querySelector|fetch\(|JSON\.parse/);
  assert.equal(doc.getElementById("pilot-scorecard-fallback").hidden, true);
});

for (const [name, clipboard] of [
  ["missing", null], ["unsupported", {}],
  ["rejected", { writeText: async () => { throw new Error("Denied"); } }],
]) test(`clipboard ${name} exposes selectable static text and permits retry`, async (t) => {
  const doc = await open(t, clipboard);
  const button = doc.getElementById("copy-pilot-scorecard");
  button.focus();
  pressSpace(doc);
  await settle();
  const manual = doc.getElementById("pilot-scorecard-manual");
  assert.match(textOf(doc.getElementById("pilot-scorecard-status")), /^Could not copy.*manual copying text box/);
  assert.equal(doc.getElementById("pilot-scorecard-fallback").hidden, false);
  assert.equal(manual.value, PILOT_SCORECARD_TEXT);
  assert.ok(manual.value.includes("are invented, use no customer or production data, and are not customer results."));
  assert.doesNotMatch(manual.value, /synthetic/i);
  assert.equal(manual.hasAttribute("readonly"), true);
  assert.equal(doc.activeElement, manual);
  assert.equal(manual.selected, true);
  assert.equal(doc.querySelector('[for="pilot-scorecard-manual"]').textContent, "Pilot scorecard for manual copying");
  assert.equal(button.getAttribute("aria-disabled"), null);
});
