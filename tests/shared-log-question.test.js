// Browser-only storage is a property of this demo, not a limit of the product.
//
// Both places a visitor can write a record — the home page's four-step demo and
// the Releases recorder — already say the record stays in this browser. Read
// alone, that reads as "Shiplog cannot hold a shared team log", which is a claim
// neither page is entitled to make. Each note now carries one more sentence
// saying whose property the browser-only storage is, and where the question of a
// shared team log is answered.
//
// What this file pins is the sentence being the same sentence in both places,
// and the promise in it being a route rather than an assertion: it says the
// question is answered on request and names the form that asks it. It says
// nothing about what a team's Shiplog stores, syncs, or costs, and this file
// fails if it starts to.
//
// It names that form in words instead of linking it, on both pages. Releases
// holds its authored regions to one destination per link and one link per
// destination (releases.test.js), and both pages already carry exactly one
// route to their own follow-up form — the "Ask about Shiplog" action in the
// introduction. A second anchor to #site-footer-panel would be a second name
// for a destination the page already names, and on Releases it would also sit
// between the decision picker and "Record release" in the form's tab order.
// So this file asserts the opposite of a link: that the sentence adds no
// focusable and no href anywhere.
//
// The rationale lives here rather than in a markup comment because index.html
// is byte-gated by the document size budget.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";

// Byte-identical on both pages. Written out here rather than read from one page
// and compared to the other, so a reworded sentence has to be reworded on
// purpose in three files instead of drifting in two.
const SHARED_LOG_QUESTION = "Browser-only storage is how this public demo works."
  + " Whether a team gets one shared log is answered on request — ask the team"
  + " that operates Shiplog in the follow-up form at the foot of this page.";

// page file, the storage note the sentence belongs to, and the phrase that note
// uses to say a record does not leave this browser.
const PLACES = [
  ["index.html", "evaluation-path-scope", "stay in this browser only"],
  ["releases.html", "release-record-scope", "kept in this browser, on this device"],
];

const read = (file) => readFile(new URL(`../src/${file}`, import.meta.url), "utf8");

for (const [file, noteId, browserOnlyPhrase] of PLACES) {
  test(`${file}: the storage note says whose property browser-only storage is, and links to this page's follow-up form`, async () => {
    const document = parseHtml(await read(file));

    const sentence = document.getElementById("shared-log-question");
    assert.ok(sentence, `${file} does not answer the shared-log question where it admits browser-only storage`);
    assert.equal(textOf(sentence), SHARED_LOG_QUESTION);

    // Adjacent to the note it qualifies, not somewhere else on the page: the
    // reader who has just been told the record stays here is the reader this
    // sentence is for.
    const note = document.getElementById(noteId);
    assert.ok(note, `${file} no longer states browser-only storage where this sentence answers for it`);
    assert.match(textOf(note), new RegExp(browserOnlyPhrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      "the existing browser-only statement was reworded or softened");
    const paragraphs = note.parentNode.querySelectorAll("p");
    assert.equal(paragraphs.indexOf(sentence), paragraphs.indexOf(note) + 1,
      "the answer is not the next thing read after the note it answers for");

    // The form it names has to be on this page and has to be one form, or the
    // sentence sends a reader looking for something that is not there.
    assert.equal(document.querySelectorAll("#site-footer-form").length, 1,
      `${file} names a follow-up form at the foot of the page and carries none`);
    assert.ok(document.getElementById("site-footer-panel"),
      `${file} has no follow-up panel for the named form to sit in`);

    // Named, not linked: the page's one route to that form is the introduction's
    // "Ask about Shiplog" action, and this sentence does not draw a second one.
    assert.equal(sentence.querySelectorAll("a").length, 0,
      "the sentence adds a second link to a destination this page already names");
    const route = document.getElementById("ask-about-shiplog");
    assert.ok(route, `${file} no longer offers the route this sentence relies on`);
    assert.equal(route.getAttribute("href"), "#site-footer-panel");
  });

  test(`${file}: the answer routes the question instead of answering it`, async () => {
    const document = parseHtml(await read(file));
    const sentence = textOf(document.getElementById("shared-log-question"));

    // The whole point of "answered on request" is that this page is not the
    // place the answer is given. Any of these would be the page answering.
    for (const claim of [
      /\bsync(s|ed|ing)?\b/i,
      /\bserver|hosted|cloud|account|sign[- ]?in\b/i,
      /\bwill\b|\bcan\b|\bdoes\b|\bsupports?\b/i,
      /\bprice|cost|\$\d|free\b/i,
      /\bper (seat|user)\b/i,
    ]) {
      assert.doesNotMatch(sentence, claim,
        "the sentence makes a claim about a team's Shiplog instead of routing the question");
    }
  });
}

test("the home page answers the shared-log question once, not at every mention of this browser", async () => {
  const html = await read("index.html");
  const document = parseHtml(html);

  // The home page says "this browser" in several places — the hero boundary,
  // the retention link, the four-step demo. Meeting this answer twice would
  // read as the page protesting.
  assert.equal(document.querySelectorAll("#shared-log-question").length, 1);
  const occurrences = html.split("Browser-only storage is how this public demo works").length - 1;
  assert.equal(occurrences, 1, "the home page answers the shared-log question more than once");

  // And the statements it qualifies are all still there, unsoftened.
  const body = textOf(document.querySelector("main"));
  assert.match(body, /Records you add stay in this browser\./);
  assert.match(body, /Records you add stay in this browser only\./);
});
