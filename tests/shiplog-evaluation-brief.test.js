import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bindShiplogEvaluationBrief } from "../src/shiplog-evaluation-brief.js";
import { loadPage, textOf, pressEnter, tabSequence } from "./support/browser.js";

const page = new URL("../src/index.html", import.meta.url);
const url = "https://preview.example/index.html?review=procurement#top";
const settle = () => new Promise((resolve) => setImmediate(resolve));

async function open(t, clipboard) {
  const home = await loadPage(page);
  t.after(() => home.restore());
  bindShiplogEvaluationBrief(home.document, clipboard, { href: url });
  return home.document;
}

test("homepage renders the complete product brief between its explanation and AI FinOps", async (t) => {
  const doc = await open(t, {});
  const brief = doc.getElementById("shiplog-evaluation-brief");
  assert.equal(brief.getAttribute("aria-labelledby"), "shiplog-evaluation-brief-title");
  assert.equal(textOf(brief.querySelector("h2")), "Shiplog evaluation brief");
  const text = textOf(brief);
  for (const wording of [
    "without reconstructing decisions from chat history",
    "context, alternatives, and owner", "links it to the release it shaped",
    "Decisions and releases you add stay in this browser; they are not shared hosted records.",
    "Availability and pricing are provided on request.",
    "synthetic, use no customer or production data, and are not customer results",
    "manager or procurement stakeholder",
  ]) assert.ok(text.includes(wording), wording);
  const link = brief.querySelector("a");
  assert.equal(link.getAttribute("href"), "/releases.html#shipped-build");
  const releases = await loadPage(new URL("../src/releases.html", import.meta.url));
  t.after(() => releases.restore());
  assert.match(textOf(releases.document.getElementById("shipped-build")), /Real record of this deployment/);
  const html = await readFile(page, "utf8");
  assert.ok(html.indexOf('id="top"') < html.indexOf('id="shiplog-evaluation-brief"'));
  assert.ok(html.indexOf('id="shiplog-evaluation-brief"') < html.indexOf('id="additional-capability"'));
  assert.match(html, /<script type="module" src="\/shiplog-evaluation-brief.js"><\/script>/);
});

test("keyboard copy includes every rendered paragraph, verification link and current URL, then confirms success", async (t) => {
  const copied = [];
  let complete;
  const doc = await open(t, { writeText: (text) => { copied.push(text); return new Promise((resolve) => { complete = resolve; }); } });
  const button = doc.getElementById("copy-shiplog-evaluation-brief");
  const status = doc.getElementById("shiplog-evaluation-brief-status");
  assert.ok(tabSequence(doc).includes(button));
  button.focus();
  pressEnter(doc);
  assert.equal(textOf(status), "");
  complete();
  await settle();
  const paragraphs = doc.getElementById("shiplog-evaluation-brief-text").querySelectorAll("h2, p")
    .map((node) => textOf(node).replace(/\s+/g, " ").trim());
  assert.equal(paragraphs.length, 4);
  assert.deepEqual(copied, [[...paragraphs,
    "Verification: https://preview.example/releases.html#shipped-build", `Page: ${url}`].join("\n\n")]);
  assert.equal(textOf(status), "Shiplog evaluation brief and page link copied.");
  assert.equal(status.hidden, false);
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
});

// An impatient buyer presses twice. Whatever the LAST press did is what the
// status line has to say: a slow first copy landing after a refused second one
// would report success for a clipboard that is still empty.
test("a slow first press cannot report success over a later refusal", async (t) => {
  const presses = [];
  const doc = await open(t, { writeText: () => new Promise((resolve, reject) => presses.push({ resolve, reject })) });
  const button = doc.getElementById("copy-shiplog-evaluation-brief");
  const status = doc.getElementById("shiplog-evaluation-brief-status");
  button.click();
  button.click();
  assert.equal(presses.length, 2);
  presses[1].reject(new Error("denied"));
  await settle();
  presses[0].resolve();
  await settle();
  await settle();
  assert.match(textOf(status), /^Could not copy/);
});

// Sasha's brief travels into someone else's evaluation, where nobody can check
// it against the page. Claim SHAPES, not a word list: the brief honestly says
// "no customer or production data", so "customer" alone cannot be the trigger.
const UNSUPPORTED_CLAIMS = [
  /\d\s*%/, /\b\d+x\b/i, /\bsav(e|es|ed|ing|ings)\b/i, /\btrusted by\b/i,
  /\b(faster|fastest|quicker|cheaper)\b/i, /\b(hundreds|thousands|millions) of\b/i,
  /\b(industry[- ]leading|best[- ]in[- ]class|proven results)\b/i,
  /\b\d+\s+(customers|teams|companies|engineers)\b/i,
  /\bcustomers\s+(use|trust|report|say|ship)\b/i,
];

test("the copied brief carries its own boundaries and claims nothing it cannot show", async (t) => {
  let copied = "";
  const doc = await open(t, { writeText: async (text) => { copied = text; } });
  doc.getElementById("copy-shiplog-evaluation-brief").click();
  await settle();
  for (const wording of [
    "Decisions and releases you add stay in this browser; they are not shared hosted records.",
    "Availability and pricing are provided on request.",
    "The example decisions and releases are synthetic",
    "are not customer results",
    "Verification: https://preview.example/releases.html#shipped-build",
  ]) assert.ok(copied.includes(wording), wording);
  for (const claim of UNSUPPORTED_CLAIMS) assert.doesNotMatch(copied, claim);
});

for (const [name, clipboard] of [
  ["unavailable", {}],
  ["denied", { writeText: async () => { throw new Error("denied"); } }],
]) test(`clipboard ${name} shows manual recovery without claiming success`, async (t) => {
  const doc = await open(t, clipboard);
  doc.getElementById("copy-shiplog-evaluation-brief").click();
  await settle();
  const status = doc.getElementById("shiplog-evaluation-brief-status");
  assert.match(textOf(status), /^Could not copy.*copy it manually.*page URL/);
  assert.equal(status.hidden, false);
});
