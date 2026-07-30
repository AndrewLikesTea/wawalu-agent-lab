// The words a first-time visitor reads on the AI FinOps page before they press
// anything.
//
// tests/finops-first-viewport.test.js pins what is *authored where* — that the
// composed example brief outranks everything that waits on a fetch. This file
// pins what those first few elements actually say, because the order was right
// while the reading still was not:
//
//   1. The hero explained the machinery ("every prompt is scored for intent,
//      efficiency, and model fit, then attributed to the org chart") instead of
//      the outcome, in two sentences, to a reader who had not yet been told
//      what the page produces.
//   2. Two lines above the first control both said what had not happened —
//      "organization not read yet" in the hero and "Example result pending" in
//      the region below it — so a visitor met two waiting-messages stacked over
//      an answer that needed no network at all.
//   3. The two choices were "Try the example data" and "Analyze local exports",
//      and the same dataset was called "Try it with example data" further down
//      the page. One concept had two names, and the other named the file rather
//      than whose file it was.
//   4. Both choices promised "not uploaded or stored", inches apart, when only
//      one of them touches a file of the reader's at all.
//
// Every claim below is checked against a rendered surface: the shipped markup
// for what is true before any script runs, and the booted page for what is true
// after one.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, parseHtml, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  FIRST_RUN_ACTIONS, FIRST_RUN_IDS, FIRST_RUN_INSTRUCTION, FIRST_RUN_NOT_YET, FIRST_RUN_STATE,
} from "../src/finops-first-run.js";
import { HERO_INTRO, LOAD_NARRATION, SECONDARY_PLACEHOLDER } from "../src/finops-load-status.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const ROUTES = {
  "/evolution-demo-data.json": DEMO_DATA,
  "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
};

const byId = (document, id) => document.getElementById(id);

/**
 * A line that tells a reader something has not happened.
 *
 * Deliberately blunt: "pending", "yet", and the load verbs are the whole of the
 * vocabulary this page uses for waiting, and the zone checked below is small
 * enough that a blunt match is the point.
 */
const WAITING = /\bpending\b|\byet\b/i;

/**
 * The explanation zone: everything a visitor reads between the page title and
 * the figures — the hero, the region's own head, and the sample label under it.
 *
 * The slots below it are excluded on purpose. "Not measured yet" in a value
 * slot is a labelled absence beside the figure it stands in for, which is a
 * different claim from a status line at the top of the page.
 */
function explanationZone(document) {
  const hero = document.querySelector(".finops-hero");
  const head = document.querySelector(".first-run-head");
  const nodes = [];
  const collect = (node) => {
    for (const child of node?.children ?? []) {
      if (child?.nodeType !== 1) continue;
      nodes.push(child);
      collect(child);
    }
  };
  collect(hero);
  collect(head);
  nodes.push(byId(document, FIRST_RUN_IDS.sample));
  return nodes.filter(Boolean);
}

/** A node's own text — its direct text children, not its descendants'. */
function ownText(node) {
  const direct = (node.children ?? []).filter((child) => child?.nodeType === 3);
  if (!direct.length && (node.children ?? []).some((child) => child?.nodeType === 1)) return "";
  return textOf(node);
}

/**
 * The waiting lines in that zone, counted as a reader meets them: one line per
 * message, not one per element the message is split across. A match stops the
 * walk, so a label and the span inside it are the same line.
 */
function waitingLines(document) {
  const lines = [];
  const visit = (node) => {
    for (const child of node?.children ?? []) {
      if (child?.nodeType !== 1 || child.hidden) continue;
      const text = textOf(child).trim();
      if (text && WAITING.test(text)) lines.push(text);
      else visit(child);
    }
  };
  visit(document.querySelector(".finops-hero"));
  visit(document.querySelector(".first-run-head"));
  const sample = textOf(byId(document, FIRST_RUN_IDS.sample)).trim();
  if (WAITING.test(sample)) lines.push(sample);
  return lines;
}

async function bootedPage() {
  const page = await loadPage(PAGE, { routes: ROUTES });
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready"
    || byId(page.document, "finops-load-state")?.dataset.state === "error",
  "the page never settled into a resolved load state");
  await waitFor(() => byId(page.document, "integration-contract-provenance")
    ?.textContent.trim().startsWith("Gateway completed"), "the static contract gateway to settle");
  await waitFor(() => byId(page.document, "finops-evaluation-result")
    ?.getAttribute("aria-busy") === "false", "the evaluation panel to settle");
  return page;
}

// --- the shipped markup ----------------------------------------------------

test("the hero is one heading and one sentence about the outcome", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));

  // One primary heading on the page, and it is the hero's.
  const headings = document.querySelectorAll("h1");
  assert.equal(headings.length, 1, "a second h1 makes two claims on the reader's first read");
  assert.equal(headings[0].id, "page-title");

  const intro = byId(document, "finops-intro");
  assert.equal(textOf(intro), HERO_INTRO,
    "the authored sentence and the one the page repaints have drifted apart");
  // One sentence. Two made the reader hold a description of the machinery
  // before they had been told what the page produces.
  assert.equal(HERO_INTRO.split(". ").length, 1);
  assert.match(HERO_INTRO, /^\S[^.]*\.$/, "the hero sentence is one sentence");
  // It names what a visitor gets, in their words rather than the product's.
  for (const outcome of [/recoverable/, /what to do first/, /how far to trust/]) {
    assert.match(HERO_INTRO, outcome);
  }
  // And none of the vocabulary that made it a page-mechanics description.
  for (const jargon of [/scored for intent/, /model fit/, /org chart/]) {
    assert.doesNotMatch(HERO_INTRO, jargon);
  }
});

test("one instruction stands between the page title and the first control", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));

  const lines = waitingLines(document);
  assert.deepEqual(lines, [],
    `the first screen should instruct the visitor instead of showing a pending state: ${JSON.stringify(lines)}`);

  // The state label stays a state label. It is `.eyebrow` — 11px uppercase
  // monospace at .11em tracking — so a two-clause instruction set in it is
  // shouted rather than read, and it is the half of the word/shape pair that is
  // swapped on every transition.
  const word = textOf(byId(document, FIRST_RUN_IDS.word));
  assert.equal(word, FIRST_RUN_STATE.pending.word);
  assert.ok(word.split(/\s+/).length <= 3, `a state label, not a sentence: ${JSON.stringify(word)}`);

  // The one plain-language message is the answer slot, which is the region's
  // largest text and the first line a reader lands on. It says what has
  // happened and names both ways on, so the slots under it need not repeat it.
  assert.equal(textOf(byId(document, FIRST_RUN_IDS.answer)), FIRST_RUN_INSTRUCTION);
  assert.match(FIRST_RUN_INSTRUCTION, /^No analysis has run yet\./);
  assert.match(FIRST_RUN_INSTRUCTION, /Try the bundled example data/);
  assert.match(FIRST_RUN_INSTRUCTION, /analyze your own export/);

  // The hero provenance names the dataset on screen rather than a read that has
  // not happened, so it no longer competes with the label above.
  assert.equal(textOf(byId(document, "finops-provenance")), SECONDARY_PLACEHOLDER.organization);
  assert.doesNotMatch(SECONDARY_PLACEHOLDER.organization, WAITING);

  // And nothing in the zone narrates a load: exactly one region on this page
  // may do that, and it is authored below the result.
  for (const node of explanationZone(document)) {
    assert.doesNotMatch(ownText(node), LOAD_NARRATION,
      `${node.id || node.className || node.tagName} narrates a load above the first control`);
  }
});

test("the first screen says nothing has run, never that something failed", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));

  // "Unavailable" is spoken for. `DECISION_STATE.error` is literally
  // `state: "unavailable", tone: "error"`, and `.first-run-answer
  // [data-available="false"]` is painted in `--state-warn-ink`. A first screen
  // that borrows the word tells a visitor their analysis failed before they
  // have chosen anything, and leaves the page nothing to say when one does.
  assert.notEqual(FIRST_RUN_STATE.pending.word, FIRST_RUN_STATE.unavailable.word);
  assert.doesNotMatch(FIRST_RUN_STATE.pending.word, /unavailable/i);
  assert.doesNotMatch(FIRST_RUN_INSTRUCTION, /unavailable/i);

  // And one shape for the slots, so a reader learns it once rather than
  // re-reading a differently-worded absence in every panel.
  const slots = [
    FIRST_RUN_IDS.benchmarkValue, FIRST_RUN_IDS.impactValue,
    FIRST_RUN_IDS.confidenceValue, FIRST_RUN_IDS.action,
  ];
  const shapes = new Set();
  for (const id of slots) {
    const text = textOf(byId(document, id));
    assert.ok(Object.values(FIRST_RUN_NOT_YET).includes(text),
      `${id} reads ${JSON.stringify(text)}, which is outside the one absence vocabulary`);
    shapes.add(text.split(" ").slice(0, 2).join(" "));
  }
  assert.deepEqual([...shapes], ["Not yet"],
    "the slots stopped sharing one grammatical shape, which is what made them scannable");
});

test("the two choices are told apart by whose data each one uses", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const demo = textOf(byId(document, FIRST_RUN_IDS.demo));
  const own = textOf(byId(document, FIRST_RUN_IDS.import));

  assert.equal(demo, FIRST_RUN_ACTIONS.demo.label);
  assert.equal(own, FIRST_RUN_ACTIONS.import.label);
  assert.notEqual(demo, own);
  // Each label carries the distinction on its own, without the note under it:
  // one runs the bundled example, the other reads the reader's export.
  assert.match(demo, /example/i);
  assert.match(own, /your own export/i);
  assert.doesNotMatch(own, /example/i);
  // "local" is this page's word for where the analysis runs, not for whose file
  // it is, so it is not what tells these two apart.
  assert.doesNotMatch(own, /\blocal\b/i);
});

test("one name for the example dataset, on both controls that load it", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const entry = byId(document, FIRST_RUN_ACTIONS.demo.targetId);
  // The picker's own entry control carries a basis span after the label; the
  // label itself has to be the same words the first-run choice uses, or the two
  // read as two different things to try.
  const basis = textOf(entry.querySelector(".local-example-basis"));
  const label = textOf(entry).replace(basis, "").trim();
  assert.equal(label, FIRST_RUN_ACTIONS.demo.label);
  assert.match(basis, /invented sample, not your spend/);
});

test("the no-upload promise sits once, beside the choice that touches a file", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const notes = document.querySelectorAll(".first-run-action-note").map((node) => textOf(node));
  assert.equal(notes.length, 2);

  const promises = notes.filter((note) => /upload/i.test(note));
  assert.equal(promises.length, 1,
    "both choices promised the same thing inches apart, and only one of them reads a file");
  const importNote = textOf(byId(document, `${FIRST_RUN_IDS.import}-note`));
  assert.match(importNote, /stay in this browser and are not uploaded/);
  // And it opens with the label of the picker it delegates to, so a reader who
  // follows the choice meets the same words on the control itself.
  const picker = textOf(document.querySelector(`label[for="${FIRST_RUN_ACTIONS.import.targetId}"]`));
  assert.ok(importNote.startsWith(`${picker}.`),
    `the note ("${importNote}") and the picker ("${picker}") ask for different things`);
  // The example choice says what it does instead, and claims nothing about a
  // file it never receives.
  const demoNote = textOf(byId(document, `${FIRST_RUN_IDS.demo}-note`));
  assert.equal(demoNote, FIRST_RUN_ACTIONS.demo.note);
  assert.match(demoNote, /every panel below/);
});

// --- the booted page -------------------------------------------------------

test("the hero renders the same sentence after the page has run", async () => {
  const page = await bootedPage();
  const { document } = page;
  try {
    assert.equal(textOf(byId(document, "finops-intro")), HERO_INTRO);
    assert.equal(textOf(byId(document, FIRST_RUN_IDS.demo)), FIRST_RUN_ACTIONS.demo.label);
    assert.equal(textOf(byId(document, FIRST_RUN_IDS.import)), FIRST_RUN_ACTIONS.import.label);

    // The bundled fixture resolved, so the provenance slot now carries the
    // organization it read — and the region's own label has stopped waiting.
    const provenance = textOf(byId(document, "finops-provenance"));
    assert.notEqual(provenance, SECONDARY_PLACEHOLDER.organization);
    assert.doesNotMatch(provenance, WAITING);
    assert.deepEqual(waitingLines(document), [],
      "nothing above the first control is still saying something has not happened");
  } finally {
    page.restore();
  }
});
