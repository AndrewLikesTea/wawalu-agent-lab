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
  for (let press = 0; press < 30 && reached !== target; press += 1) reached = pressTab(document2);
  assert.equal(reached, target, "the coach entry point must sit in the natural tab order");
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
  assert.match(attribution, /supplied example, not of your text/);

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
  // all: it is in the shipped markup, not painted by a module.
  assert.match(textOf(document.querySelector(".coach-hero-boundary")), /Nothing you paste leaves this tab/);
  assert.match(
    textOf(document.querySelector(".prompt-coach-sample-static")),
    /bundled synthetic example/,
  );
});
