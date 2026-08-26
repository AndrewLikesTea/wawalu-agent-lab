// The prompt coach as a destination: how a visitor reaches it, what it shows
// someone who has typed nothing, and what leaves the page when they copy.
//
// The workflow's own behaviour — refusals, revisions, disclosures, the copy
// control's three rungs — is covered by the flow tests that drive it. This file
// covers only what turning the workflow into its own route can break: the ways
// in, the deep link the AI FinOps dashboard used to own, the deterministic
// first-run result the destination paints before it asks for anything, and the
// rule that a copied summary carries figures and never the visitor's prompt.
//
// The harness's fetch throws on any request a test did not declare, and this
// file declares none. That is the network assertion: no part of arriving at
// this page, grading on it, or copying from it may become a request.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { loadPage, parseHtml, pressEnter, pressTab, tabSequence, textOf, typeText } from "./support/browser.js";
import { importPageModule } from "./support/page-module.js";
import { SITE_NAV } from "../src/site-nav.js";
import { COACHING_INPUT_SOURCE } from "../src/prompt-coaching-contract.js";
import { COACHING_ENTRY_EXAMPLE } from "../src/prompt-coaching-entry.js";
import { COPY_LABEL } from "../src/coaching-summary-view.js";

const PAGE = fileURLToPath(new URL("../src/coach.html", import.meta.url));
const read = (file) => readFile(new URL(`../src/${file}`, import.meta.url), "utf8");

const byId = (document, id) => document.getElementById(id);

// A prompt nobody would write by accident, so "the summary does not carry it"
// cannot pass by coincidence.
const OWN_PROMPT = [
  "User: Draft the migration note for the zk-orbital ledger cutover.",
  "Audience is the on-call rota. Cover the rollback switch, the two-hour freeze,",
  "and the pager owner. Keep it under 200 words and end with the checklist.",
].join("\n");
const OWN_REVISION = `${OWN_PROMPT}\nAssistant: Here is the note, with the checklist last.`;

async function openCoach() {
  const page = await loadPage(PAGE);
  await importPageModule("/prompt-coaching-page.js");
  return page;
}

/** Reach a control from the keyboard alone; no mouse anywhere in this file. */
function tabTo(document, id) {
  for (let step = 0; step <= tabSequence(document).length; step += 1) {
    const focused = pressTab(document);
    if (focused?.id === id) return focused;
  }
  return assert.fail(`"${id}" is not reachable by Tab; a keyboard user cannot use the coach.`);
}

function gradeText(document, text) {
  const field = tabTo(document, "prompt-coaching-input");
  field.value = "";
  typeText(document, text);
  tabTo(document, "prompt-coaching-grade");
  pressEnter(document);
}

const sampleBody = (document) => byId(document, "prompt-coach-sample-body");
const sampleSection = (document) => byId(document, "prompt-coach-sample");
const sampleResult = (document) => byId(document, "prompt-coach-sample-result");
const regionText = (document, id) =>
  textOf(sampleResult(document).querySelector(`.coaching-result-${id}`));

/* ----------------------------- the ways in -------------------------------- */

test("the coach is a nav destination, named the same way everywhere", async () => {
  const link = SITE_NAV.find((entry) => entry.href === "/coach.html");
  assert.ok(link, "the prompt coach must be a destination in the site nav");
  assert.equal(link.label, "Prompt coach");
  assert.ok(!link.subordinate, "the coach is a peer surface, not a view of another one");

  // The page marks itself as the current destination, which is what a screen
  // reader announces when a reader lands here from any other page.
  const document = parseHtml(await read("coach.html"));
  const current = document.querySelector(".site-nav").querySelector('a[aria-current="page"]');
  assert.equal(current.getAttribute("href"), "/coach.html");
  assert.equal(textOf(current), "Prompt coach");
});

test("the home page offers the coach twice: in the destination list and as a thing to do", async () => {
  const html = await read("index.html");
  const document = parseHtml(html);

  const guideLink = document.querySelector(".site-guide").querySelector('a[href="/coach.html"]');
  assert.ok(guideLink, "the destination list must name the coach");
  assert.equal(textOf(guideLink), "Prompt coach");

  const entry = document.querySelector(".coach-entry");
  assert.ok(entry, "the home page must carry a prompt-coach entry point");
  // The eyebrow names what the section is about. "Also part of Shiplog" named
  // the site instead, so a reader skimming the eyebrows learned nothing.
  assert.equal(textOf(entry.querySelector(".eyebrow")), "Prompt coach · nothing to install, nothing to upload");
  const control = entry.querySelector('a[href="/coach.html"]');
  assert.ok(control, "the entry point must link to the coach");
  // Named by destination rather than by gesture: "Open the prompt coach" reads
  // the same out of context as it does in it.
  assert.match(textOf(control), /prompt coach/i);
  // What it costs, said where the offer is made rather than after the click.
  assert.match(textOf(entry), /No sign-in, no upload, no storage, and no request to a model/);
  // The offer sits below the destination list, so the log the home page leads
  // with keeps its own primary call to action.
  assert.ok(html.indexOf('class="site-guide"') < html.indexOf('class="coach-entry"'));

  // Reachable from the keyboard, and it opens the route it names.
  const document2 = parseHtml(html);
  const target = document2.querySelector(".coach-entry").querySelector('a[href="/coach.html"]');
  let reached = null;
  // Bounded by the page's own tab stops, like tabTo above: a fixed count turns
  // every new link added higher up the page into a failure of this test.
  for (let press = 0; press < tabSequence(document2).length && reached !== target; press += 1) reached = pressTab(document2);
  // ok(), not equal(): a failing equal() on two parsed nodes stringifies the
  // whole page and takes minutes to report what this message already says.
  assert.ok(reached === target, "the coach entry point must sit in the natural tab order");
  pressEnter(document2);
  assert.deepEqual(document2.navigations, ["/coach.html"]);
});

test("the AI FinOps deep link still lands, and hands the reader on", async () => {
  const html = await read("evolution.html");
  const document = parseHtml(html);

  // A link saved before the coach moved is still a link to something that
  // explains where the workflow went.
  const anchor = byId(document, "prompt-coaching");
  assert.ok(anchor, "/evolution.html#prompt-coaching must still resolve");
  assert.ok(anchor.querySelector('a[href="/coach.html"]'), "the anchor must hand the reader on to the coach");

  // And the workflow itself lives in exactly one place now: two pages with the
  // same field ids is how the two copies drift.
  assert.equal(byId(document, "prompt-coaching-form"), null,
    "the dashboard must not ship a second copy of the coaching form");
  assert.ok(!html.includes("prompt-coaching-page.js"),
    "the dashboard must not mount the coaching entry any more");

  // The dashboard's own surfaces are untouched by the move.
  assert.ok(byId(document, "guided-result"), "the guided result must survive the move");
  assert.ok(byId(document, "local-import-flow") || html.includes('class="local-import'),
    "the import flow must survive the move");
});

/* -------------------------- the zero-input path --------------------------- */

test("a visitor who types nothing reads one complete result on arrival", async () => {
  const { document } = await openCoach();

  const body = sampleBody(document);
  assert.equal(body.dataset.sampleId, COACHING_ENTRY_EXAMPLE.sampleId);
  assert.equal(body.dataset.source, COACHING_INPUT_SOURCE.bundledSample);
  assert.equal(sampleSection(document).dataset.sampleState, "shown");
  assert.equal(sampleSection(document).hidden, false);

  // The reading order the result presentation publishes: the answer, what it is
  // measured against with its provenance, and exactly one thing to do first.
  const result = sampleResult(document);
  assert.ok(result, "the sample must render a real result, not a description of one");
  assert.equal(result.dataset.status, "graded");
  for (const region of ["grade", "benchmark", "action"]) {
    assert.ok(regionText(document, region).length > 0, `the sample is missing its ${region} region`);
  }
  // The benchmark carries the figure, the band it sits in, and the confidence
  // the figure is allowed to claim — one text, graded in this tab.
  const benchmark = regionText(document, "benchmark");
  assert.match(benchmark, /Composite/, "the benchmark must name the metric");
  assert.match(benchmark, /this text only/, "the benchmark must state what it may not be read as");
  assert.match(benchmark, /in this browser tab/, "the benchmark must say where it was computed");

  // Exactly one next action, which is the whole promise of the surface.
  assert.equal(result.querySelectorAll(".coaching-result-action").length, 1);

  // Whose text it is, beside the figures rather than under them.
  const attribution = textOf(document.querySelector(".prompt-coach-sample-attribution"));
  assert.match(attribution, /bundled synthetic example, not of your text/);

  // Supporting evidence stays disclosed rather than spent on a first read.
  const toggle = result.querySelector(".coaching-result-toggle");
  assert.ok(toggle, "the rubric evidence must sit behind a disclosure");
  assert.equal(toggle.tagName, "BUTTON");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  toggle.focus?.();
  pressEnter(document);
  assert.equal(toggle.getAttribute("aria-expanded"), "true", "the disclosure must open from the keyboard");
});

test("the same visit twice draws the same figures, because nothing is sampled or timed", async () => {
  const first = await openCoach();
  const firstFigures = ["grade", "benchmark", "action"].map((id) => regionText(first.document, id));
  const second = await openCoach();
  const secondFigures = ["grade", "benchmark", "action"].map((id) => regionText(second.document, id));
  assert.deepEqual(secondFigures, firstFigures);
});

test("the worked example steps aside for the visitor's own result, and comes back on clear", async () => {
  const { document } = await openCoach();

  gradeText(document, OWN_PROMPT);
  assert.equal(sampleSection(document).hidden, true, "two results must never be on screen at once");
  assert.equal(sampleSection(document).dataset.sampleState, "replaced");
  // Their result, classified as theirs — never as a reading of our example.
  assert.equal(byId(document, "prompt-coaching-entry").dataset.gradedSource, COACHING_INPUT_SOURCE.readerText);
  assert.equal(byId(document, "prompt-coaching-result").hidden, false);

  tabTo(document, "prompt-coaching-clear");
  pressEnter(document);
  assert.equal(sampleSection(document).hidden, false, "clearing returns the page a visitor arrived on");
  assert.equal(sampleSection(document).dataset.sampleState, "shown");
  assert.equal(byId(document, "prompt-coaching-result").hidden, true);
});

/* ------------------------------ the copy rule ----------------------------- */

test("the copied summary carries figures and rubric wording, never the visitor's prompt", async () => {
  const { document } = await openCoach();

  gradeText(document, OWN_PROMPT);
  gradeText(document, OWN_REVISION);

  const copy = byId(document, "prompt-coaching-copy");
  assert.equal(copy.hidden, false, "a second grade must offer the summary");
  const text = byId(document, "prompt-coaching-copy-text").value;
  assert.ok(text.length > 0, "the summary must have something in it to copy");

  // Not one line, one sentence, or one distinctive phrase of what was typed.
  for (const line of [...OWN_PROMPT.split("\n"), "zk-orbital", "pager owner", "two-hour freeze"]) {
    assert.ok(!text.includes(line.trim()), `the summary leaked the visitor's prompt: ${line}`);
  }
  // What it does carry: the grades and the movement between them.
  assert.match(text, /\d/, "the summary must carry the figures it is a record of");
});

/* --------------------------- the page as a page --------------------------- */

test("the destination reads as one page about one thing", async () => {
  const document = parseHtml(await read("coach.html"));

  const headings = document.querySelectorAll("h1");
  assert.equal(headings.length, 1, "a destination has exactly one h1");
  assert.equal(byId(document, "page-title"), headings[0]);

  // The workflow keeps the h2 it had as a panel, so the outline reads h1 then
  // h2 rather than two competing top-level headings.
  const question = byId(document, "prompt-coaching-question");
  assert.equal(question.tagName, "H2");
  assert.equal(
    byId(document, "prompt-coaching").getAttribute("aria-labelledby"),
    "prompt-coaching-question",
  );

  // The sample names itself, and the result it holds is labelled by that name
  // rather than writing a second heading over the same figures.
  assert.equal(sampleSection(document).getAttribute("aria-labelledby"), "prompt-coach-sample-title");

  // The boundary a visitor needs before pasting is readable with no script at
  // all: it is in the shipped markup, not painted by a module. It is the
  // sentence under the heading now — the first thing read on arrival, and still
  // above the form rather than in a disclosure the reader has to open.
  const privacy = byId(document, "page-tagline");
  assert.match(textOf(privacy), /pasted text stays in this browser/i);
  assert.match(textOf(privacy), /not sent to a model or stored/);
  const markup = await read("coach.html");
  assert.ok(markup.indexOf('id="page-tagline"') < markup.indexOf('id="prompt-coaching-input"'),
    "the privacy statement must be read before the prompt field");

  // Said once. A page that repeats the same promise four times teaches a
  // visitor to skip all four.
  assert.equal(document.querySelectorAll(".prompt-coaching-privacy").length, 0);
  // The example is named the same way the rest of the site names one —
  // "bundled synthetic example" — and says what it is made of in the same breath.
  const sample = textOf(document.querySelector(".prompt-coach-sample-static"));
  assert.match(sample, /bundled synthetic example/);
  assert.match(sample, /not your prompt/);
  assert.match(sample, /real prompt/);

  // The heading is the name the visitor clicked in the nav, and one sentence
  // under it says what the page does. An eyebrow above the heading, and a
  // tagline that restated the heading, said the same thing again before a
  // reader reached anywhere to type.
  const hero = document.querySelector(".coach-hero");
  assert.equal(textOf(byId(document, "page-title")), "Prompt coach");
  assert.equal(hero.querySelectorAll("p").length, 1,
    "the hero carries one purpose sentence and nothing else");
  assert.equal(hero.querySelectorAll(".eyebrow").length, 0,
    "the eyebrow above the heading named the page the heading names");
  // And the introduction does not spend a second clause on the promise the
  // form makes. The privacy claim has one wording on this page and the purpose
  // sentence is where it lives, so the phrasings retired with it stay retired.
  const intro = textOf(hero);
  assert.doesNotMatch(intro, /leaves this tab|uploaded|no sign-in/i,
    "the privacy statement has one wording on this page and these are not it");
  // Nor a second copy of the instructions: what to do, in what order, is said
  // once in the block that sits immediately before the field.
  assert.doesNotMatch(intro, /grade it again|bundled/i,
    "the purpose statement is not a second copy of the block before the field");
  // Nor a second copy of what a grade returns: the score and the first change
  // are promised in that same block, once.
  assert.doesNotMatch(intro, /score|first change/i,
    "what a grade returns is promised once, in the block before the field");
  // Nor a pitch for the neighbouring surface. A reader with an export of their
  // own is handed it once, in the card under the grade, not before they have
  // used the page they came to.
  assert.equal(hero.querySelectorAll('a[href="/personal-history.html"]').length, 0,
    "the handoff to Personal AI history belongs in the card below the grade");

  // The copy a visitor reads before any script runs describes what they get,
  // not how this page is built. Contracts, fixtures, and script loading are
  // implementation, and they belong in a disclosure or in the source.
  for (const selector of [".coach-hero", ".prompt-coaching-entry-static",
    ".prompt-coaching-entry-lead", ".prompt-coach-sample-static", ".prompt-coach-sample-lead"]) {
    const text = textOf(document.querySelector(selector));
    assert.doesNotMatch(text, /contract|fixture|scripts load|rendered here/i,
      `first-screen copy in ${selector} describes the implementation, not the reader's result`);
  }
});

/* --------------------- one promise, made once ------------------------------ */

// The claim the page states once, above the field: "Your pasted text stays in
// this browser. It is not sent to a model or stored." The punctuation is left
// loose so a near-duplicate that differs only in a colon still counts here and
// pushes the total past one.
const PRIVACY_CLAIM = /stays in this browser[.:]\s*(?:It|it) is not sent to a model or stored/g;

/** Every heading rendered above the prompt field, in reading order. */
function headingsAboveTheField(document) {
  const above = [];
  for (const node of document.querySelectorAll("h1,h2,h3,h4,h5,h6,textarea")) {
    if (node.id === "prompt-coaching-input") break;
    if (node.tagName !== "TEXTAREA") above.push(textOf(node).trim());
  }
  return above;
}

/**
 * Everything a visitor reads above the prompt field, once the modules have
 * painted, in reading order. The site nav and the footer are outside <main>, so
 * neither is in here, and neither is a control label: every button on this page
 * sits below the field. Joined on newlines so no phrase can be assembled out of
 * the end of one element and the start of the next.
 */
function copyAboveTheField(document) {
  const parts = [];
  const selector = "h1,h2,h3,h4,h5,h6,p,summary,label,li,dt,dd,textarea";
  for (const node of document.querySelector("main").querySelectorAll(selector)) {
    if (node.id === "prompt-coaching-input") break;
    if (node.tagName !== "TEXTAREA") parts.push(textOf(node).trim());
  }
  return parts.join("\n");
}

// The promise this page makes, in every wording it made it in: "Grade a
// prompt.", "Grade one prompt before you send it.". The control's own name,
// "Grade this prompt", is deliberately not in this family — the instruction
// names the button a visitor presses, which is not a second promise.
const PROMISE = /grade (?:a|one|your) prompt/gi;

test("the promise is made once above the field, and then the page says how", async () => {
  const { document } = await openCoach();

  // Four introductions — an eyebrow, the heading, a tagline under it, and a
  // question over the form — all promised the same grade before a reader
  // reached anywhere to type, and the instruction that carried the facts came
  // last. One promise now, in the sentence under the heading; the heading
  // itself names the page rather than making the promise a second time.
  const above = copyAboveTheField(document);
  const made = above.match(PROMISE) ?? [];
  assert.equal(made.length, 1,
    `the promise is made ${made.length} times above the prompt field: ${made.join(" / ")}`);
  assert.equal(textOf(byId(document, "page-title")), "Prompt coach");
  assert.equal((textOf(byId(document, "page-tagline")).match(PROMISE) ?? []).length, 1,
    "the one promise is made in the sentence directly under the heading");

  // No heading above the field asks the question the grade answers either. The
  // workflow still publishes that question in the session it returns; a reader
  // who has read the heading does not need it asked back at them.
  assert.deepEqual(headingsAboveTheField(document).filter((text) => text.endsWith("?")), [],
    "a heading above the field asks what the heading already promised an answer to");
  assert.equal(byId(document, "prompt-coaching-question").tagName, "H2");
  assert.equal(
    byId(document, "prompt-coaching").getAttribute("aria-labelledby"),
    "prompt-coaching-question",
  );

  // And the copy that survives the cut still carries every fact: what to paste,
  // which control to press, and both halves of what comes back.
  const start = textOf(document.querySelector(".prompt-coaching-entry-static"));
  assert.match(start, /Paste a prompt or short conversation/);
  assert.ok(start.includes(textOf(byId(document, "prompt-coaching-grade"))),
    "the instruction must name the grading control by its own label");
  assert.match(start, /score out of 100/);
  assert.match(start, /first change to make/);
});

test("the page names itself and says what it does, and the introduction stops there", async () => {
  const { document } = await openCoach();

  // One name for this page: the nav link a visitor clicked, the browser tab,
  // and the first heading all say it. Arriving should not cost anyone a moment
  // spent deciding whether they reached the destination they chose.
  const navLabel = SITE_NAV.find((entry) => entry.href === "/coach.html").label;
  assert.equal(textOf(byId(document, "page-title")), "Prompt coach");
  assert.equal(textOf(byId(document, "page-title")), navLabel);
  assert.match(await read("coach.html"), /<title>Prompt coach · Shiplog<\/title>/);

  // Reading order inside the introduction, asserted on the elements rather than
  // on the markup: the page's name, then one sentence saying what it does and
  // where the text stays. Nothing sits above the name, and nothing follows the
  // purpose — the offer of the surface that reads a whole history is made once,
  // in the card under the grade, where the reader has a use for it.
  const hero = document.querySelector(".coach-hero");
  const label = (node) => node.id || node.getAttribute("class") || node.tagName;
  assert.deepEqual(hero.childElements.map(label), ["page-title", "page-tagline"],
    "the introduction must read name, then purpose, and stop");
  assert.equal(hero.childElements[0].tagName, "H1");

  const purpose = textOf(byId(document, "page-tagline"));
  assert.match(purpose, /Grade a prompt/, "the sentence under the name must say what the page does");
  assert.match(purpose, /stays in this browser/, "…and where a visitor's pasted text stays");

  // And the page still introduces itself exactly once before the field: one
  // promise of what a grade is, one statement of where the text stays.
  const above = copyAboveTheField(document);
  assert.equal((above.match(PROMISE) ?? []).length, 1);
  assert.equal((above.match(PRIVACY_CLAIM) ?? []).length, 1);
});

/** How many times a phrase is written in a block of rendered copy. */
const occurrences = (text, phrase) => text.split(phrase).length - 1;

test("Personal AI history is pitched once, in the card under the grade", async () => {
  const { document } = await openCoach();

  // The hero pitched it in near-identical words to the card below the grade —
  // the same rubric over a history, the same habit worth changing first, the
  // same browser. Two pitches read as two destinations to compare before the
  // reader has used the one they came for, so the page makes exactly one.
  const body = textOf(document.querySelector("main"));
  assert.equal(occurrences(body, "Personal AI history"), 1,
    "Personal AI history is pitched more than once above the footer directory");
  assert.equal(occurrences(textOf(document.querySelector(".coach-neighbour")), "Personal AI history"), 1,
    "the one pitch must be the answer in the “Also on this site” card");
  assert.equal(document.querySelector(".coach-hero").querySelectorAll("a").length, 0,
    "the introduction sends a reader nowhere but the field below it");

  // The surviving pitch carries every fact the deleted one had, so nothing a
  // reader needed to choose the destination left with the duplicate.
  const card = textOf(document.querySelector(".coach-neighbour"));
  // Including the file it wants, named the way the site-wide footer names it:
  // the card and that clause are the only two places the site says what
  // Personal AI history reads, so they say it in the same words.
  assert.match(card, /the same rubric across your assistant export — weeks of your prompts —/);
  assert.match(card, /names the single habit worth changing first/);
  assert.match(card, /It is read in your browser too\./);

  // The footer directory is the site's, not this page's: it keeps its own entry
  // and is the only other place the destination is named.
  const footer = textOf(byId(document, "site-footer"));
  assert.equal(occurrences(footer, "Personal AI history"), 1);

  // And the sentence both pitches ended on is written once on the whole page.
  assert.ok(occurrences(`${body}\n${footer}`, "It is read in your browser too.") <= 1,
    "“It is read in your browser too.” is written twice on the rendered page");
});

test("“Start here” names the region for a screen reader and no longer heads it", async () => {
  const { document } = await openCoach();

  const entry = byId(document, "prompt-coaching-entry");
  assert.equal(entry.getAttribute("aria-label"), "Start here",
    "the region keeps the accessible name it had as a heading");
  assert.equal(entry.getAttribute("aria-labelledby"), null,
    "a region named by aria-label must not also point at a heading id");
  for (const heading of headingsAboveTheField(document)) {
    assert.notEqual(heading, "Start here",
      "“Start here” must not compete with the section heading above it");
  }
});

test("the privacy promise is made once, in one wording, before the field", async () => {
  const { document } = await openCoach();

  // Once, where a reader meets it before pasting. A second copy in the
  // disclosure below said the same thing with different punctuation, which
  // reads as two promises to compare rather than one to rely on, so the count
  // is pinned rather than trusted.
  const rendered = textOf(document.querySelector("main"));
  assert.equal(rendered.match(PRIVACY_CLAIM)?.length, 1,
    "the privacy claim is stated exactly once on the rendered page");

  const beforeTheField = textOf(byId(document, "page-tagline"));
  assert.match(beforeTheField, /Your pasted text stays in this browser\. It is not sent to a model or stored\./);
  // And the block before the field, which used to carry it, does not carry it
  // again: the statement moved up into the introduction rather than being
  // copied into it.
  assert.doesNotMatch(textOf(document.querySelector(".prompt-coaching-entry-static")),
    /stays in this browser/, "the instruction block restates where the text stays");

  // The disclosure keeps the facts that statement does not carry: what the
  // coach reads, and what it never reaches.
  assert.equal(textOf(byId(document, "prompt-coaching-preview-summary")),
    "What the coach reads and keeps");
  const reads = textOf(document.querySelector(".prompt-coaching-preview-static"));
  assert.match(reads, /reads only the text you paste and the optional model choice/);
  assert.match(reads, /does not access your accounts, files, or customer data/);
  assert.doesNotMatch(reads, /stays in this browser/,
    "the disclosure must not restate where the text stays");
});

test("one name for what a reader leaves with: the coaching summary", async () => {
  const { document } = await openCoach();

  const copy = byId(document, "prompt-coaching-copy");
  assert.equal(textOf(copy.querySelector("h3")), "Coaching summary");
  assert.match(textOf(byId(document, "prompt-coaching-copy-button")), /coaching summary/i);
  assert.match(textOf(copy.querySelector("label")), /Coaching summary/);
  // The button the module writes and the button in the markup are the same
  // control, so the name in the module carries the same noun phrase.
  assert.match(COPY_LABEL, /coaching summary/i);
  // And the artifact has no second name anywhere on the page.
  assert.doesNotMatch(textOf(document.querySelector("main")), /Take this with you/);
});

test("the first screen names the result and the next action, before any script runs", async () => {
  const document = parseHtml(await read("coach.html"));

  // What comes back, in the reader's terms rather than the rubric's: a number,
  // where that number sits, and the one thing to do about it.
  const start = textOf(document.querySelector(".prompt-coaching-entry-static"));
  assert.match(start, /score out of 100/, "the first screen must say what a visitor receives");
  assert.match(start, /first change to make/);
  assert.match(start, /Paste a prompt or short conversation, then select “Grade this prompt”/);
  // Where the text stays is static too, one block higher, so a dead script
  // never costs a reader the promise they need before pasting.
  const purpose = textOf(byId(document, "page-tagline"));
  assert.match(purpose, /pasted text stays in this browser/i);
  assert.match(purpose, /not sent to a model or stored/);

  // And the next action, named with the words on the controls a visitor presses,
  // so the instruction and the button cannot be read as two different things.
  const grade = textOf(byId(document, "prompt-coaching-grade"));
  assert.equal(grade, "Grade this prompt");
  assert.ok(start.includes(grade),
    `the block before the field must name the ${grade} button it points at`);

  // And it points only at controls that exist without scripts: the bundled
  // synthetic example is offered by the block the entry module paints, beside the button
  // that loads it, rather than promised here to a reader who has none.
  assert.equal(byId(document, "prompt-coaching-example"), null,
    "the example control is painted, so the static copy must not send a reader to it");
  assert.ok(byId(document, "prompt-coaching-input") && byId(document, "prompt-coaching-grade"),
    "the field and the button the static copy names are in the shipped markup");

  const sampleFallback = textOf(document.querySelector(".prompt-coach-sample-lead"));
  assert.match(sampleFallback, /Loading the bundled example/);
  assert.match(sampleFallback, /paste your own prompt below now/);
});

test("one name per concept: the example, the grade button, and the clear button", async () => {
  const { document } = await openCoach();

  // The site calls a bundled demonstration a "bundled synthetic example"
  // everywhere else, so this page does too — not "supplied example" in one
  // region and "our example" in the next.
  const text = textOf(document.querySelector("main"));
  assert.doesNotMatch(text, /supplied example|our example/i,
    "the bundled demonstration is a bundled synthetic example on every surface that names it");
  assert.match(textOf(byId(document, "prompt-coaching-example")), /Grade the bundled synthetic example/);

  // The clear control is referred to by its own label wherever copy points at
  // it, rather than by a name for the region it clears.
  assert.equal(textOf(byId(document, "prompt-coaching-clear")), "Clear and start over");
  assert.doesNotMatch(text, /clear the panel/i);

  // And a result that points at a control names it by what a reader sees on the
  // page. The id stays in data, where a consumer reads it, and out of the prose.
  for (const line of document.querySelectorAll(".coaching-result-action-control")) {
    assert.match(textOf(line), /^Do this in the prompt field, then grade again\.$/,
      "a result names a control by its label, not by its element id");
    assert.equal(line.dataset.control, "prompt-coaching-input");
  }
});

/* --------------------- three invitations, three promises ------------------- */

// The page carries three "See …" invitations, each one the whole of what a
// reader has to go on before they open the explanation under it. They are
// pinned byte for byte because the failure they had was not a typo: the middle
// invitation listed possible results and the privacy details, which are what
// the explanations either side of it reveal, so all three read as the same
// offer and none of them said which one to open.
const INVITATIONS = Object.freeze([
  [".prompt-coaching-entry-lead",
    "See what you get here, what it is measured against, and what to do first."],
  [".prompt-coaching-preview-lead",
    "See the text this preview analyzes and every field a grade returns."],
  ["#coaching-specimen-summary",
    "See possible results, including the ones with no grade"],
]);

test("each 'See …' invitation names only what its own explanation reveals", async () => {
  // Read from the markup, before a module paints: two of the three are the copy
  // a reader gets with scripts blocked, and the preview's is replaced the
  // instant the preview paints over it. A stale copy survives here, unseen by
  // any test that only reads the painted page.
  const markup = await read("coach.html");
  const document = parseHtml(markup);

  for (const [selector, invitation] of INVITATIONS) {
    assert.equal(textOf(document.querySelector(selector)), invitation);
    // Authored once. An invitation with a second copy elsewhere in the page is
    // an invitation that gets rewritten in one place and left stale in the other.
    assert.equal(markup.split(invitation).length - 1, 1,
      `"${invitation}" is authored more than once in coach.html`);
  }

  const [entry, preview, specimen] = INVITATIONS.map(([, invitation]) => invitation);
  // The middle one is the whole point: the bundled sample it reads and the
  // fields that come back are its own, and neither the outcome list nor the
  // privacy boundary is what a reader should open it for.
  assert.doesNotMatch(preview, /possible results|privacy/i,
    "the preview invitation promises what the other two explanations reveal");
  assert.doesNotMatch(entry, /possible results|privacy/i,
    "the entry invitation promises what the other two explanations reveal");
  assert.match(specimen, /possible results/,
    "possible results is the name this page gives the specimen, in its copy and in its retry control");
  assert.equal(new Set([entry, preview, specimen]).size, 3);
});

test("the invitations survive as three promises once the page has painted", async () => {
  const { document } = await openCoach();

  // The specimen is closed on arrival, so its invitation is all a reader has;
  // a closed details reports its open property as undefined, not false.
  const disclosure = byId(document, "coaching-specimen");
  assert.ok(!disclosure.open, "the specimen opens on request, not on arrival");
  assert.equal(textOf(byId(document, "coaching-specimen-summary")),
    "See possible results, including the ones with no grade");

  // And the preview has painted over its own invitation with the material that
  // invitation described: the text it analyzes, and the fields that come back.
  const painted = textOf(byId(document, "prompt-coaching-preview-body"));
  for (const [, invitation] of INVITATIONS.slice(0, 2)) {
    assert.ok(!painted.includes(invitation),
      "a pre-script invitation is still on the page after the block it introduced painted");
  }
  assert.match(painted, /What text is analyzed/);
  assert.match(painted, /What you receive/);
});
