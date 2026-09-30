// The shared-log question is answered once, in words, and never re-deferred.
//
// #2655. Three passages used to hand the same question back to the reader. The
// home page's evaluation brief said availability was "provided on request"; the
// decision recorder and the Releases recorder each carried the same 35-word
// sentence saying a shared log was "answered on request — ask the team". A
// visitor met the deferral three times and learned nothing from any of them.
//
// One passage now answers it plainly: records stay in the visitor's own
// browser, one shared log across a team's browsers and devices is not part of
// this build, a pilot therefore evaluates the recording workflow and the
// deployment record, and availability is asked in the follow-up form this page
// already carries. "Not part of this build" is the honest ceiling — this file
// fails if the passage upgrades it to a promise ("not yet", "coming", a date),
// claims a shared log exists, names a price, or names a customer.
//
// What the recorders keep is the statement of fact they already had: where a
// record goes. What they may not do is ask or defer the availability question a
// second and third time. So this file asserts the answer exists exactly once on
// the home page, that both recorders still state where records go unsoftened,
// and that neither of them carries a deferral any more.
//
// It also asserts the answer adds no focusable. Both pages hold their authored
// regions to one route per destination, and each already carries exactly one
// route to its own follow-up form — the "Ask about Shiplog" action in the
// introduction. Naming the form in words costs no tab stop; index.html's first
// screen and Releases' recorder tab order both have none to spare.
//
// The rationale lives here rather than in a markup comment because the home
// page's recorder panel is prose a document budget measures.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";

// The one answer, byte-exact. Written out here rather than read from the page,
// so a reworded passage has to be reworded on purpose.
const SHARED_LOG_ANSWER = "Decisions and releases you add stay in this browser."
  + " One shared log across a team’s browsers and devices is not part of this"
  + " demonstration build. A pilot here evaluates that recording workflow and"
  + " this site’s deployment record, not shared storage. Shiplog is built and"
  + " operated by Wawalu; ask about availability in the follow-up form at the"
  + " foot of this page.";

// The deferrals this change removed, in the words they shipped in.
const DEFERRALS = [
  "Browser-only storage is how this public demo works",
  "Whether a team gets one shared log is answered on request",
  "Availability and pricing are provided on request",
];

// page file, the storage note that page keeps, and the phrase it uses to say a
// record does not leave this browser.
const RECORDERS = [
  ["index.html", "evaluation-path-scope", "stay in this browser only"],
  ["releases.html", "release-record-scope", "kept in this browser, on this device"],
];

const read = (file) => readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
const escape = (phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("the home page answers the shared-log question once, in the evaluation brief", async () => {
  const html = await read("index.html");
  const document = parseHtml(html);

  const brief = document.getElementById("shiplog-evaluation-brief-text");
  assert.ok(brief, "the home page no longer carries the evaluation brief");
  const passage = brief.querySelectorAll("p").find((node) => textOf(node) === SHARED_LOG_ANSWER);
  assert.ok(passage, "the brief does not answer the shared-log question in the words this file pins");

  // Once. Meeting the answer twice would read as the page protesting.
  const answers = brief.querySelectorAll("p").filter((node) => textOf(node) === SHARED_LOG_ANSWER);
  assert.equal(answers.length, 1);
  assert.equal(html.split("is not part of this demonstration build").length - 1, 1,
    "the home page states the build's storage limit more than once");

  // Named, not linked: the page's one route to that form is the introduction's
  // "Ask about Shiplog" action, and this passage does not draw a second one.
  assert.equal(passage.querySelectorAll("a").length, 0,
    "the passage adds a second link to a destination this page already names");
  const route = document.getElementById("ask-about-shiplog");
  assert.ok(route, "the home page no longer offers the route this passage relies on");
  assert.equal(route.getAttribute("href"), "#site-footer-panel");
  assert.equal(document.querySelectorAll("#site-footer-form").length, 1,
    "the passage names a follow-up form at the foot of the page and the page carries none");
  assert.ok(document.getElementById("site-footer-panel"),
    "the page has no follow-up panel for the named form to sit in");
});

test("the answer states a limit of this build and promises nothing beyond it", async () => {
  const document = parseHtml(await read("index.html"));
  const brief = document.getElementById("shiplog-evaluation-brief-text");
  const passage = textOf(brief.querySelectorAll("p").find((node) => textOf(node) === SHARED_LOG_ANSWER));

  // A roadmap commitment, a claim that shared storage already works, a price,
  // a date, or a named customer would each be the page promising what nobody
  // has agreed to.
  for (const claim of [
    /\bnot yet\b/i, /\bcoming\b/i, /\bsoon\b/i, /\broadmap\b/i, /\bplanned\b/i, /\bwill\b/i,
    /\bsync(s|ed|ing)?\b/i, /\bserver|hosted|cloud|account|sign[- ]?in\b/i,
    /\bprice|pricing|cost|\$\d|free\b/i, /\bper (seat|user)\b/i,
    /\b20\d\d\b/, /\bQ[1-4]\b/,
    /\bcustomers\b/i, /\btrusted by\b/i,
  ]) assert.doesNotMatch(passage, claim, `the answer claims more than a limit of this build: ${claim}`);

  // And it still says all four things it exists to say.
  assert.match(passage, /stay in this browser/);
  assert.match(passage, /not part of this demonstration build/);
  assert.match(passage, /A pilot here evaluates/);
  assert.match(passage, /follow-up form at the foot of this page/);
});

for (const [file, noteId, browserOnlyPhrase] of RECORDERS) {
  test(`${file}: the recorder says where a record goes and defers nothing`, async () => {
    const html = await read(file);
    const document = parseHtml(html);

    // The existing statement of fact, unsoftened.
    const note = document.getElementById(noteId);
    assert.ok(note, `${file} no longer states where a record goes`);
    assert.match(textOf(note), new RegExp(escape(browserOnlyPhrase)),
      "the existing browser-only statement was reworded or softened");

    // And no second passage handing the availability question back.
    assert.equal(document.querySelectorAll("#shared-log-question").length, 0,
      `${file} still carries the deferral the evaluation brief answers`);
    for (const deferral of DEFERRALS) {
      assert.ok(!html.includes(deferral), `${file} still defers with “${deferral}”`);
    }
  });
}

test("no page repeats a deferral the evaluation brief answers", async () => {
  for (const file of ["index.html", "releases.html"]) {
    const html = await read(file);
    for (const deferral of DEFERRALS.slice(0, 2)) {
      assert.ok(!html.includes(deferral), `${file} still defers with “${deferral}”`);
    }
  }
  // The brief's own passage replaced the third one, so it may not survive
  // anywhere the brief is authored or forwarded.
  for (const file of ["index.html", "shiplog-evaluation-brief.txt"]) {
    assert.ok(!(await read(file)).includes(DEFERRALS[2]),
      `${file} still says availability is “provided on request” without saying where`);
  }
});

test("the forwarded brief carries the same answer as the page", async () => {
  const document = parseHtml(await read("index.html"));
  const brief = document.getElementById("shiplog-evaluation-brief-text");
  const passage = brief.querySelectorAll("p").find((node) => textOf(node) === SHARED_LOG_ANSWER);
  assert.ok(passage, "the page does not carry the answer this file pins");
  assert.ok((await read("shiplog-evaluation-brief.txt")).includes(SHARED_LOG_ANSWER),
    "the downloadable brief and the page disagree about the answer");
});
