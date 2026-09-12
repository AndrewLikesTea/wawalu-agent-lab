import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  bindPilotScorecard, buildPilotScorecardText, PILOT_SCORECARD_CRITERIA, PILOT_SCORECARD_TEXT, PILOT_TEAM_HANDOFF,
} from "../src/shiplog-pilot-scorecard.js";
import { buildShiplogEvaluationBrief, BRIEF_FOLLOW_UP_SENTENCE, BRIEF_FOLLOW_UP_URL } from "../src/shiplog-evaluation-brief.js";
import { EXPORT_BUTTON_LABEL } from "../src/shiplog-export.js";
import { STORAGE_KEY } from "../src/app.js";
import { loadPage, textOf, pressEnter, pressSpace, tabSequence, typeText } from "./support/browser.js";

const page = new URL("../src/index.html", import.meta.url);
const settle = () => new Promise((resolve) => setImmediate(resolve));
const FOLLOW_UP_LINE = `${BRIEF_FOLLOW_UP_SENTENCE} ${BRIEF_FOLLOW_UP_URL}`;
const NO_OFFER = /\$|€|£|\bprice[sd]?\b|\bfree\b|sign ?up|\btrial\b|\bavailable\b|achieved|improved|reduced|testimonial/i;
async function open(t, clipboard, options) {
  const home = await loadPage(page, options);
  t.after(() => home.restore());
  const doc = home.document;
  // The lightweight DOM models focus but not native textarea selection.
  doc.getElementById("pilot-scorecard-manual").select = function () { this.selected = true; };
  assert.equal(bindPilotScorecard(doc, clipboard), true);
  return doc;
}

test("the pure builder composes every blank criterion, the brief's follow-up line and the page link", () => {
  assert.equal(buildPilotScorecardText(), PILOT_SCORECARD_TEXT);
  const blocks = PILOT_SCORECARD_TEXT.split("\n\n");
  assert.equal(blocks[0], "Shiplog pilot scorecard");
  assert.ok(blocks[1].endsWith("No pilot outcome is claimed."));
  assert.equal(blocks[4], `3. Team handoff\n${PILOT_TEAM_HANDOFF}\nBuyer target: ________\nObserved result: ________\nOwner: ________`);
  assert.deepEqual(blocks.slice(-2), [FOLLOW_UP_LINE, "Page: https://labs.wawalu.org/"]);
  const fields = PILOT_SCORECARD_TEXT.split("\n").filter((line) => /^(Buyer target|Observed result|Owner):/.test(line));
  assert.equal(fields.length, 12);
  for (const line of fields) assert.match(line, /^[^:]+: ________$/);
  assert.doesNotMatch(PILOT_SCORECARD_TEXT, NO_OFFER);
  const custom = buildPilotScorecardText([["Only row", "Your evaluating team must count one thing."]]);
  assert.ok(custom.includes("1. Only row\nYour evaluating team must count one thing.\nBuyer target: ________"));
  assert.ok(custom.includes(FOLLOW_UP_LINE));
});

test("homepage places four blank buyer measurements immediately after the evaluation brief", async (t) => {
  const doc = await open(t, {});
  const card = doc.getElementById("shiplog-pilot-scorecard");
  assert.equal(card.getAttribute("aria-labelledby"), "shiplog-pilot-scorecard-title");
  const rows = card.querySelectorAll("li");
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((row) => [textOf(row.querySelector("h3")), textOf(row.querySelector("p"))]),
    PILOT_SCORECARD_CRITERIA.map((criterion) => [...criterion]));
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
    FOLLOW_UP_LINE,
    "Page: https://labs.wawalu.org/"].join("\n\n");
  assert.equal(PILOT_SCORECARD_TEXT, expected);
  assert.ok(textOf(card).includes("No pilot outcome is claimed."));
  assert.ok(textOf(card).includes(expected.split("\n\n").at(-3)));
  // The follow-up line rides in the copy only, like the brief's: no second link on the page.
  assert.equal(card.querySelectorAll("a").length, 1);
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

// #2330: the handoff row names the log's real export and import controls, so a
// team can run it, and says nothing the stay-in-this-browser promise contradicts.
test("Team handoff names the page's export and import controls and claims no shared copy", async (t) => {
  const doc = await open(t, {});
  const row = doc.getElementById("shiplog-pilot-scorecard").querySelectorAll("li")[2];
  const handoff = textOf(row.querySelector("p"));
  assert.equal(handoff, PILOT_TEAM_HANDOFF);
  const exportLabel = textOf(doc.getElementById("export-shiplog"));
  const importLabel = textOf(doc.querySelector('label[for="import-shiplog-file"]'));
  assert.equal(exportLabel, EXPORT_BUTTON_LABEL);
  assert.equal(importLabel, "Choose JSON file");
  assert.equal(doc.getElementById("import-shiplog-file").getAttribute("type"), "file");
  assert.ok(handoff.includes(`“${exportLabel}”`), "names the export button");
  assert.ok(handoff.includes(`“${importLabel}”`), "names the import control");
  assert.ok(handoff.indexOf(exportLabel) < handoff.indexOf(importLabel));
  assert.match(handoff, /send the file to your teammate/);
  assert.match(handoff, /in their own browser/);
  assert.doesNotMatch(handoff, /shar|sync|host|upload|cloud|server|online|account|sign.?in|same (log|record)|workspace/i);
  assert.ok(textOf(doc.querySelector(".hero-boundary")).includes("Records you add stay in this browser."));
  assert.equal(row.querySelectorAll("a,button,input,select,textarea").length, 0);
});

test("the follow-up line is the evaluation brief's own, imported rather than retyped", async () => {
  const followUp = (text) => text.split("\n\n").filter((block) => /availability and pricing/.test(block));
  const brief = buildShiplogEvaluationBrief({ paragraphs: [], recordHref: "/releases.html#shipped-build", pageHref: "/" });
  assert.deepEqual(followUp(PILOT_SCORECARD_TEXT), [FOLLOW_UP_LINE]);
  assert.deepEqual(followUp(PILOT_SCORECARD_TEXT), followUp(brief));
  const source = await readFile(new URL("../src/shiplog-pilot-scorecard.js", import.meta.url), "utf8");
  assert.match(source, /import \{ BRIEF_FOLLOW_UP_SENTENCE, BRIEF_FOLLOW_UP_URL \} from "\.\/shiplog-evaluation-brief\.js";/);
  assert.ok(!source.includes("availability and pricing"));
});

test("keyboard copy awaits success, preserves focus, and excludes even mutated page/user data", async (t) => {
  let finish;
  const writes = [];
  const doc = await open(t, { writeText: (text) => { writes.push(text); return new Promise((resolve) => { finish = resolve; }); } }, {
    storage: { [STORAGE_KEY]: JSON.stringify([{ id: "private-1", title: "PRIVATE STORED DECISION", context: "PRIVATE CONTEXT",
      alternatives: "None considered", owner: "PRIVATE OWNER", status: "accepted", createdAt: "2026-09-01T00:00:00.000Z" }]) },
  });
  const button = doc.getElementById("copy-pilot-scorecard");
  const status = doc.getElementById("pilot-scorecard-status");
  doc.getElementById("shiplog-pilot-scorecard-title").textContent = "PRIVATE RECORD";
  doc.getElementById("pilot-scorecard-manual").value = "PRIVATE FORM";
  doc.getElementById("title").focus();
  typeText(doc, "PRIVATE TYPED TITLE");
  doc.getElementById("site-footer-email").focus();
  typeText(doc, "private@company.example");
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
  assert.ok(writes[0].includes(`3. Team handoff\n${PILOT_TEAM_HANDOFF}\n`));
  assert.ok(writes[0].includes(FOLLOW_UP_LINE));
  assert.ok(writes[0].includes("No pilot outcome is claimed."));
  assert.equal(writes[0].match(/: ________$/gm).length, 12);
  // The follow-up address is the only fragment; nothing else from location enters.
  assert.doesNotMatch(writes[0].replace(FOLLOW_UP_LINE, ""), /PRIVATE|private@|\?|#/i);
  assert.doesNotMatch(writes[0], NO_OFFER);
  // The same word the opening section and the brief use (#2284), with both claims intact.
  assert.ok(writes[0].includes("The example decisions and releases are invented, use no customer or production data, and are not customer results."));
  assert.doesNotMatch(writes[0], /synthetic/i);
  // Clipboard helper and the brief's follow-up words only; document access is limited to controls.
  const source = await readFile(new URL("../src/shiplog-pilot-scorecard.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /localStorage|sessionStorage|location\.|querySelector|fetch\(|JSON\.parse/);
  assert.equal(doc.getElementById("pilot-scorecard-fallback").hidden, true);
});

test("the manual copying box holds exactly the text the copy button tried to write", async (t) => {
  const writes = [];
  const doc = await open(t, { writeText: async (text) => { writes.push(text); throw new Error("Denied"); } });
  doc.getElementById("copy-pilot-scorecard").focus();
  pressEnter(doc);
  await settle();
  const manual = doc.getElementById("pilot-scorecard-manual");
  assert.equal(writes.length, 1);
  assert.equal(manual.value, writes[0]);
  assert.ok(manual.value.includes(PILOT_TEAM_HANDOFF));
  assert.ok(manual.value.includes(FOLLOW_UP_LINE));
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
