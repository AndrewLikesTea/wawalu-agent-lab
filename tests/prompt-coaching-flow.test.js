// The coaching workflow, driven through the shipped markup of the prompt-coach destination.
//
// This file loads the real page and the real page entry — not a fixture DOM and
// not a re-implementation of the wiring — so "a reader can paste a prompt and
// read a coached answer" is a keystroke assertion rather than an inspection of
// the source. What it cannot model is layout: the responsive rules are CSS and
// belong in a browser. What it does model is the part a keyboard and screen
// reader user feels — tab order, activation, live-region text, the expanded
// state of the disclosure, and where focus lands after a refusal.
//
// The harness's fetch throws on any request a test did not declare, and this
// test declares none. That is the network assertion: if this workflow ever
// grows a call, every test in this file fails.

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { loadPage, pressEnter, pressTab, tabSequence, textOf, typeText } from "./support/browser.js";
import { importPageModule } from "./support/page-module.js";
import { COACHING_INPUT_LIMITS } from "../src/prompt-coaching.js";
import {
  COACHING_INPUT_SOURCE, COACHING_LOCAL_ONLY_BOUNDARY, COACHING_OUTCOME_STATES,
  COACHING_SESSION_VERSION, PREVIEW_SAMPLE_ID, RESULT_FIELD_MEANINGS, SESSION_FIELDS,
  buildSampleCoachingSession, coachingSample, validateCoachingSession,
} from "../src/prompt-coaching-contract.js";
import {
  COACHING_ENTRY_EXAMPLE, COACHING_ENTRY_EXCLUSIONS, COACHING_ENTRY_VERSION,
  buildEntryExampleSession,
} from "../src/prompt-coaching-entry.js";

const PAGE = fileURLToPath(new URL("../src/coach.html", import.meta.url));

const byId = (document, id) => document.getElementById(id);

const WEAK_PROMPT = "can you improve this and fix it somehow, make it better as needed";

/** The page with only the coaching entry mounted; the analysis page is not. */
async function openCoachingPage() {
  const page = await loadPage(PAGE);
  await importPageModule("/prompt-coaching-page.js");
  return page;
}

/** Tab from wherever focus is until a control is reached; no mouse involved. */
function tabTo(document, id) {
  for (let step = 0; step <= tabSequence(document).length; step += 1) {
    const focused = pressTab(document);
    if (focused?.id === id) return focused;
  }
  return assert.fail(`"${id}" is not reachable by Tab; a keyboard user cannot use the workflow.`);
}

/** Type into the field and activate the grade control from the keyboard. */
function gradeText(document, text) {
  const field = tabTo(document, "prompt-coaching-input");
  field.value = "";
  typeText(document, text);
  tabTo(document, "prompt-coaching-grade");
  pressEnter(document);
}

test("the workflow is discoverable and idle before anything is pasted", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    const section = byId(document, "prompt-coaching");
    assert.ok(section, "the coaching section must ship in the page markup");
    assert.equal(section.dataset.state, "idle");
    assert.equal(section.getAttribute("aria-labelledby"), "prompt-coaching-question");
    assert.equal(textOf(byId(document, "prompt-coaching-question")),
      "Would a model answer this prompt well?");

    // The field is labelled and described, and no result is claimed yet.
    const field = byId(document, "prompt-coaching-input");
    assert.equal(field.tagName, "TEXTAREA");
    assert.equal(document.querySelector('label[for="prompt-coaching-input"]').textContent.trim(),
      "Your prompt or short conversation");
    assert.equal(field.getAttribute("aria-describedby"), "prompt-coaching-hint");
    assert.equal(field.getAttribute("aria-invalid"), null);
    assert.equal(byId(document, "prompt-coaching-result").hidden, true);
    assert.equal(textOf(byId(document, "prompt-coaching-live")), "");

    // The published limits are under the field, from the contract, so a reader
    // learns them before hitting one.
    const hint = textOf(byId(document, "prompt-coaching-hint"));
    assert.ok(hint.includes(COACHING_INPUT_LIMITS.maxChars.toLocaleString("en-US")), hint);
    assert.ok(hint.includes(String(COACHING_INPUT_LIMITS.maxTurns)), hint);
  } finally {
    page.restore();
  }
});

test("pasting a weak prompt returns an answer, one benchmark, and one move", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeText(document, WEAK_PROMPT);

    const section = byId(document, "prompt-coaching");
    assert.equal(section.dataset.state, "graded");
    assert.match(section.dataset.grade, /^[A-F]$/);

    const result = byId(document, "prompt-coaching-result");
    assert.equal(result.hidden, false);

    // The answer to the question is first, in words.
    const answer = result.querySelector(".prompt-coaching-answer-words");
    assert.ok(textOf(answer).length > 0);

    // The letter is decorative; the sentence beside it carries the grade, so a
    // screen reader does not announce it twice.
    const letter = result.querySelector(".prompt-coaching-letter");
    assert.equal(letter.getAttribute("aria-hidden"), "true");
    assert.match(textOf(result.querySelector(".prompt-coaching-benchmark-text")),
      /\/ 100 · grade [A-F]\./);

    // Exactly one prioritized improvement, and it says what it is worth.
    const moves = result.querySelectorAll(".prompt-coaching-improvement");
    assert.equal(moves.length, 1, "a ranked backlog is not a next step");
    assert.equal(moves[0].dataset.available, "true");
    assert.match(textOf(result.querySelector(".prompt-coaching-improvement-worth")),
      /worth about \d+ points? of the 0–100 composite/);
    const rewrite = result.querySelector(".prompt-coaching-rewrite");
    assert.match(textOf(rewrite.querySelector(".prompt-coaching-rewrite-label")),
      /Ready-to-edit rewrite/);
    assert.ok(textOf(rewrite.querySelector(".prompt-coaching-rewrite-text")).length > 0);
    assert.equal(textOf(rewrite).includes(WEAK_PROMPT), false,
      "the usable rewrite must not duplicate the private paste into the result");

    // And it announced the answer before the figure.
    const live = byId(document, "prompt-coaching-live");
    assert.equal(live.getAttribute("role"), "status");
    assert.ok(textOf(live).startsWith(textOf(answer)), textOf(live));
    assert.match(textOf(live), /Do this first:/);
  } finally {
    page.restore();
  }
});

test("hostile prompt markup is treated as text and never creates executable DOM", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    const hostile = '<img src=x onerror="globalThis.pwned=true"><script>globalThis.pwned=true</script>';
    gradeText(document, hostile);

    assert.equal(byId(document, "prompt-coaching-input").value, hostile,
      "the textarea preserves what the reader typed without parsing it as markup");
    assert.equal(byId(document, "prompt-coaching-result").querySelector("script"), null);
    assert.equal(byId(document, "prompt-coaching-result").querySelector("img"), null);
    assert.equal(globalThis.pwned, undefined);
  } finally {
    delete globalThis.pwned;
    page.restore();
  }
});

test("the rubric detail starts closed and the toggle keeps focus when it opens", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeText(document, WEAK_PROMPT);

    const toggle = byId(document, "prompt-coaching-detail-toggle");
    assert.equal(toggle.tagName, "BUTTON");
    assert.equal(toggle.getAttribute("type"), "button");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(toggle.getAttribute("aria-controls"), "prompt-coaching-detail-panel");
    assert.equal(byId(document, "prompt-coaching-detail-panel").hidden, true,
      "rubric detail must not be in the headline");
    assert.match(textOf(toggle), /^Show how this grade was reached/);

    toggle.focus();
    pressEnter(document);

    const opened = byId(document, "prompt-coaching-detail-toggle");
    assert.equal(opened.getAttribute("aria-expanded"), "true");
    assert.match(textOf(opened), /^Hide how this grade was reached/);
    assert.equal(document.activeElement.id, "prompt-coaching-detail-toggle",
      "focus must come back to the control the reader pressed");

    const panel = byId(document, "prompt-coaching-detail-panel");
    assert.equal(panel.hidden, false);
    assert.equal(panel.getAttribute("role"), "region");
    // The axes, the per-turn reading, and the rubric version behind the grade.
    assert.equal(panel.querySelector(".prompt-coaching-axes").querySelectorAll("dt").length, 3);
    assert.ok(panel.querySelectorAll(".prompt-coaching-turn").length >= 1);
    assert.match(textOf(panel.querySelector(".prompt-coaching-rubric-version")),
      /Rubric literacy-mix\/1\.0\.0/);
  } finally {
    page.restore();
  }
});

test("grading nothing explains the recovery, marks the field, and moves focus to it", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    tabTo(document, "prompt-coaching-grade");
    pressEnter(document);

    const section = byId(document, "prompt-coaching");
    assert.equal(section.dataset.state, "not_gradeable");
    assert.equal(section.dataset.reason, "empty_input");
    assert.equal(section.dataset.grade, undefined, "a refusal must publish no letter");

    const recovery = byId(document, "prompt-coaching-result")
      .querySelector(".prompt-coaching-recovery");
    assert.equal(recovery.dataset.reason, "empty_input");
    assert.ok(textOf(recovery).includes("There is nothing to grade yet."));

    // The guidance is part of the field's accessible description, so a screen
    // reader reads it when focus lands — which is where focus was just sent.
    const field = byId(document, "prompt-coaching-input");
    assert.equal(field.getAttribute("aria-invalid"), "true");
    assert.equal(field.getAttribute("aria-describedby"),
      "prompt-coaching-hint prompt-coaching-recovery-guidance");
    assert.equal(document.activeElement.id, "prompt-coaching-input");
    assert.match(textOf(byId(document, "prompt-coaching-live")), /^Not graded\./);
  } finally {
    page.restore();
  }
});

test("a paste with nothing but code is refused with the reason and the way out", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeText(document, "```\nconst x = 1;\nconst y = 2;\n```");
    const section = byId(document, "prompt-coaching");
    assert.equal(section.dataset.state, "not_gradeable");
    assert.equal(section.dataset.reason, "no_scorable_turn");
    assert.match(textOf(byId(document, "prompt-coaching-result")),
      /Add the request itself in prose/);
  } finally {
    page.restore();
  }
});

test("a transcript over the turn ceiling names the ceiling it passed", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeText(document, Array.from({ length: COACHING_INPUT_LIMITS.maxTurns + 2 },
      (unused, at) => `User: turn ${at}, still failing, try again`).join("\n"));
    assert.equal(byId(document, "prompt-coaching").dataset.reason, "too_many_turns");
    assert.match(
      textOf(byId(document, "prompt-coaching-result")
        .querySelector(".prompt-coaching-recovery-observed")),
      new RegExp(`${COACHING_INPUT_LIMITS.maxTurns + 2} turns read, `
        + `${COACHING_INPUT_LIMITS.maxTurns} is the ceiling`),
    );
  } finally {
    page.restore();
  }
});

test("a successful grade after a refusal takes the invalid state back off the field", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    tabTo(document, "prompt-coaching-grade");
    pressEnter(document);
    assert.equal(byId(document, "prompt-coaching-input").getAttribute("aria-invalid"), "true");

    gradeText(document, WEAK_PROMPT);
    const field = byId(document, "prompt-coaching-input");
    assert.equal(field.getAttribute("aria-invalid"), null);
    assert.equal(field.getAttribute("aria-describedby"), "prompt-coaching-hint");
    assert.equal(byId(document, "prompt-coaching").dataset.state, "graded");
  } finally {
    page.restore();
  }
});

test("clearing empties the field, hides the result, and hands focus back", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeText(document, WEAK_PROMPT);
    tabTo(document, "prompt-coaching-clear");
    pressEnter(document);

    const section = byId(document, "prompt-coaching");
    assert.equal(section.dataset.state, "idle");
    assert.equal(section.dataset.grade, undefined);
    assert.equal(byId(document, "prompt-coaching-input").value, "");
    assert.equal(byId(document, "prompt-coaching-result").hidden, true);
    assert.equal(textOf(byId(document, "prompt-coaching-live")), "");
    assert.equal(document.activeElement.id, "prompt-coaching-input");
  } finally {
    page.restore();
  }
});

test("a graded prompt with no tier named says so instead of recommending one", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeText(document, WEAK_PROMPT);
    const block = byId(document, "prompt-coaching-result")
      .querySelector(".prompt-coaching-recommendation");
    assert.ok(block, "a graded result must answer the routing question, even to decline");
    assert.equal(block.dataset.state, "no_tier_stated");
    assert.equal(block.dataset.evidenced, "false");
    assert.equal(block.querySelector(".prompt-coaching-recommendation-basis"), null,
      "an abstention cites no signal, because none fired");
    assert.match(textOf(block), /abstain rather than assume/);
  } finally {
    page.restore();
  }
});

test("a mechanical errand on premium recommends one step down and cites the signal", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    byId(document, "prompt-coaching-model").value = "premium";
    gradeText(document, "rename the variable foo to bar and fix the typo in the header");

    const block = byId(document, "prompt-coaching-result")
      .querySelector(".prompt-coaching-recommendation");
    assert.equal(block.dataset.state, "route_down");
    assert.equal(block.dataset.direction, "down");
    assert.equal(textOf(block.querySelector(".prompt-coaching-recommendation-words")),
      "Route this one down to standard.");
    // The signal id is printed verbatim: a reader disputing a routing claim
    // quotes it, and a prettified sentence is not quotable.
    assert.equal(textOf(block.querySelector(".prompt-coaching-recommendation-basis")),
      "Evidence: model-fit-trivial-on-premium on turn 1");
    // And the claim stops at what the rubric observed.
    const text = textOf(block.querySelector(".prompt-coaching-recommendation-text"));
    assert.match(text, /measures no answer, no follow-up turn, and no spend/);
    assert.equal(/re-?prompt|quality|savings?/i.test(text.replace(/measures no [^.]+\./, "")),
      false, text);
  } finally {
    page.restore();
  }
});

test("the model select offers a stated-nothing default and does not require a choice", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    const select = byId(document, "prompt-coaching-model");
    assert.equal(select.tagName, "SELECT");
    assert.deepEqual(select.options.map((option) => option.getAttribute("value")),
      ["", "premium", "standard", "economy"]);
    assert.equal(select.value, "", "no tier is assumed on a reader's behalf");
    gradeText(document, WEAK_PROMPT);
    assert.equal(byId(document, "prompt-coaching").dataset.state, "graded");
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// The pre-paste preview
// ---------------------------------------------------------------------------
//
// The question this surface answers is asked before a reader types anything:
// "what does this read, what do I get back, and what does it do with my text?"
// So every assertion below runs on a page where nothing has been pasted.

test("the boundary is stated in the markup, before any script runs", async () => {
  const page = await loadPage(PAGE);
  try {
    const { document } = page;
    const preview = byId(document, "prompt-coaching-preview");
    assert.ok(preview, "the preview must ship in the page markup");
    const claim = textOf(preview.querySelector(".prompt-coaching-preview-static"));
    // Stated as the reader's risk rather than as our implementation: where the
    // grading happens, and what does not happen to what they pasted.
    assert.match(claim, /graded in this browser tab/);
    assert.match(claim, /Nothing you paste is sent anywhere, saved anywhere, or read from an account/);
    // A privacy claim a reader can only see once JavaScript succeeds is a claim
    // they cannot rely on, so this one does not wait for the entry module. And
    // it says how the analysis runs rather than how many files a build emits:
    // a file count is not checkable from the page and answers nothing.
    assert.equal(/\b(one|two|three|four|\d+)\s+(static\s+)?(files?|scripts?|modules?)\b/i
      .test(textOf(preview)), false, "a file count is not a verifiable claim");
  } finally {
    page.restore();
  }
});

test("the preview shows the text it analyzed and what it measured about it", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    const block = byId(document, "prompt-coaching-preview-body")
      .querySelector('[data-block="analyzed"]');
    const sample = coachingSample(PREVIEW_SAMPLE_ID);
    assert.equal(block.querySelector(".prompt-coaching-preview-sample").textContent, sample.text,
      "the analyzed text is shown in full, not described");
    const terms = block.querySelectorAll("dt").map((node) => textOf(node));
    const values = block.querySelectorAll("dd").map((node) => textOf(node));
    assert.deepEqual(terms, ["Source", "Characters read", "Turns read",
      "Role labels found", "Turns the rubric scored", "Model tier named"]);
    assert.equal(values[0], "bundled_sample");
    assert.equal(values[1], String(sample.text.length));
  } finally {
    page.restore();
  }
});

test("the preview names every result field and shows the session a client receives", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    const body = byId(document, "prompt-coaching-preview-body");
    assert.equal(body.dataset.contractVersion, COACHING_SESSION_VERSION);
    const block = body.querySelector('[data-block="result"]');
    const fields = block.querySelector(".prompt-coaching-preview-fields")
      .querySelectorAll("dt").map((node) => textOf(node));
    assert.deepEqual(fields, RESULT_FIELD_MEANINGS.map((entry) => entry.field));

    // The JSON is the session, not a transcription of one: parsing it and
    // checking it against the contract is the assertion that this page cannot
    // display a shape a consumer would be refused.
    const json = JSON.parse(block.querySelector(".prompt-coaching-preview-json").textContent);
    assert.equal(json.schemaVersion, COACHING_SESSION_VERSION);
    assert.deepEqual(Object.keys(json).sort(), [...SESSION_FIELDS].sort());
    assert.equal(validateCoachingSession(buildSampleCoachingSession(PREVIEW_SAMPLE_ID)).valid, true);
  } finally {
    page.restore();
  }
});

test("the preview demonstrates every state, including the three that refuse", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    const items = byId(document, "prompt-coaching-preview-body")
      .querySelector('[data-block="states"]').querySelectorAll("li");
    assert.deepEqual(items.map((item) => item.dataset.outcome),
      COACHING_OUTCOME_STATES.map((state) => state.outcome));
    for (const item of items) {
      assert.ok(textOf(item.querySelector(".prompt-coaching-preview-state-meaning")).length,
        `${item.dataset.outcome} says nothing about itself`);
      assert.ok(item.querySelectorAll(".prompt-coaching-preview-state-sample").length,
        `${item.dataset.outcome} is claimed but not demonstrated`);
    }
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// The front door
// ---------------------------------------------------------------------------
//
// The journey a visitor is on before they have typed anything: what they get,
// what it is measured against, the one thing to do first, and — once a grade is
// on screen — whose text produced it. The last of those is the assertion that
// matters most: a figure produced from our supplied example must never be
// readable, by a person or a consumer, as a grade of the visitor's own work.

/** Load the supplied example from the keyboard, as a visitor with nothing to paste would. */
function loadExample(document) {
  tabTo(document, "prompt-coaching-example");
  pressEnter(document);
}

test("the front door states what this is and what it never reaches, before any script runs", async () => {
  const page = await loadPage(PAGE);
  try {
    const { document } = page;
    const entry = byId(document, "prompt-coaching-entry");
    assert.ok(entry, "the front door must ship in the page markup");
    // The systems this never reaches are not listed twice on the first screen:
    // the entry module paints them, each with how to check it, in the privacy
    // boundary disclosure. What has to survive a dead script is the promise a
    // visitor needs before pasting, and it is beside the button they press.
    const privacy = textOf(byId(document, "prompt-coaching-privacy"));
    assert.match(privacy, /Nothing you paste leaves this tab/);
    assert.match(privacy, /no upload, no storage, and no request to a model/);
  } finally {
    page.restore();
  }
});

test("the front door answers the arrival questions in order: value, benchmark, action, exclusions", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    const body = byId(document, "prompt-coaching-entry-body");
    assert.equal(body.dataset.entryVersion, COACHING_ENTRY_VERSION);
    assert.deepEqual(
      body.querySelectorAll(".prompt-coaching-entry-block").map((block) => block.dataset.block),
      ["value", "benchmark", "action", "exclusions"],
      "a visitor asks what they get before what it is measured against, and both before what to do",
    );

    // The benchmark is named with its scale and its bands, not asserted as good.
    const benchmark = body.querySelector('[data-block="benchmark"]');
    assert.match(textOf(benchmark.querySelector(".prompt-coaching-entry-metric")),
      /0–100 in whole points, from rubric literacy-mix\/1\.0\.0/);
    assert.match(textOf(benchmark), /only when the letter band moves/);
    assert.match(textOf(benchmark), /classified prompts in a department/);

    // And every excluded system is on the page with the way to check it.
    const excluded = body.querySelector('[data-block="exclusions"]').querySelectorAll("li");
    const boundary = body.querySelector('[data-block="exclusions"]');
    assert.equal(boundary.tagName, "DETAILS",
      "audit proofs stay reachable without blocking the path from action to field");
    assert.equal(boundary.hasAttribute("open"), false);
    assert.match(textOf(boundary.querySelector("summary")),
      /no provider, HRIS, enterprise system, credential, or customer data/i);
    assert.deepEqual(excluded.map((item) => item.dataset.exclusion),
      COACHING_ENTRY_EXCLUSIONS.map((entry) => entry.id));
    for (const item of excluded) {
      assert.match(textOf(item.querySelector(".prompt-coaching-entry-exclusion-verify")),
        /^How to check: /);
    }
  } finally {
    page.restore();
  }
});

test("with nothing typed the one offered action is the supplied example", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    const entry = byId(document, "prompt-coaching-entry");
    assert.equal(entry.dataset.entryState, "empty");
    assert.equal(entry.dataset.nextAction, "try_example");
    assert.equal(entry.dataset.gradedSource, undefined, "nothing has been graded yet");
    assert.equal(byId(document, "prompt-coaching-entry-source").hidden, true);

    // Reachable from the keyboard, and it says what it does before it is pressed.
    const control = tabTo(document, "prompt-coaching-example");
    assert.equal(control.getAttribute("type"), "button");
    assert.equal(control.getAttribute("aria-describedby"), "prompt-coaching-entry-action");
    assert.match(textOf(byId(document, "prompt-coaching-entry-action")), /Nothing to paste\?/);
    assert.match(textOf(byId(document, "prompt-coaching-entry-alternative")), /field below/);
  } finally {
    page.restore();
  }
});

test("grading the supplied example is classified bundled_sample and said so on the page", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    loadExample(document);

    // The example is written into the field with the tier it is graded against.
    assert.equal(byId(document, "prompt-coaching-input").value, COACHING_ENTRY_EXAMPLE.text);
    assert.equal(byId(document, "prompt-coaching-model").value, COACHING_ENTRY_EXAMPLE.modelTier);
    const entry = byId(document, "prompt-coaching-entry");
    assert.equal(entry.dataset.entryState, "example_loaded");
    assert.equal(entry.dataset.nextAction, "grade_example");
    assert.equal(byId(document, "prompt-coaching-example").hidden, true,
      "offering to overwrite text already in the field is not an offer");

    tabTo(document, "prompt-coaching-grade");
    pressEnter(document);

    // The classification the session carries, published on the page: this is a
    // demonstration, not a reading of anything the visitor wrote.
    assert.equal(entry.dataset.gradedSource, COACHING_INPUT_SOURCE.bundledSample);
    const attribution = byId(document, "prompt-coaching-entry-source");
    assert.equal(attribution.hidden, false);
    assert.equal(attribution.getAttribute("role"), "status");
    assert.match(textOf(attribution), /bundled synthetic example, not of your text/);

    // And the result is the real one the example grades to, not a canned figure.
    assert.equal(byId(document, "prompt-coaching").dataset.grade,
      buildEntryExampleSession().result.benchmark.grade);
    assert.equal(entry.dataset.entryState, "answered");
    assert.equal(entry.dataset.nextAction, "apply_one_change");
  } finally {
    page.restore();
  }
});

test("editing the supplied example makes the next grade the visitor's own text", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    loadExample(document);
    const entry = byId(document, "prompt-coaching-entry");

    // One keystroke in the field ends the example.
    tabTo(document, "prompt-coaching-input");
    typeText(document, " and state the constraint the answer must respect");
    assert.equal(entry.dataset.entryState, "visitor_text");
    assert.equal(entry.dataset.nextAction, "grade_own");
    assert.equal(byId(document, "prompt-coaching-example").hidden, true);

    tabTo(document, "prompt-coaching-grade");
    pressEnter(document);
    assert.equal(entry.dataset.gradedSource, COACHING_INPUT_SOURCE.readerText,
      "edited text is the reader's, however it started");
    assert.match(textOf(byId(document, "prompt-coaching-entry-source")), /grade is of your text/);
  } finally {
    page.restore();
  }
});

test("a prompt the visitor typed is classified reader_text, and clearing re-offers the example", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeText(document, WEAK_PROMPT);
    const entry = byId(document, "prompt-coaching-entry");
    assert.equal(entry.dataset.gradedSource, COACHING_INPUT_SOURCE.readerText);

    tabTo(document, "prompt-coaching-clear");
    pressEnter(document);
    assert.equal(entry.dataset.gradedSource, undefined,
      "a cleared panel attributes nothing, because nothing is on screen");
    assert.equal(byId(document, "prompt-coaching-entry-source").hidden, true);
    assert.equal(entry.dataset.entryState, "empty");
    assert.equal(entry.dataset.nextAction, "try_example");
    assert.equal(byId(document, "prompt-coaching-example").hidden, false);
  } finally {
    page.restore();
  }
});

test("the preview pairs every excluded class with the way to check it", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    const items = byId(document, "prompt-coaching-preview-body")
      .querySelector('[data-block="boundary"]').querySelectorAll("li");
    assert.deepEqual(items.map((item) => item.dataset.boundary),
      COACHING_LOCAL_ONLY_BOUNDARY.map((entry) => entry.id));
    for (const item of items) {
      assert.match(textOf(item.querySelector(".prompt-coaching-preview-boundary-verify")),
        /^How to check: /);
    }
  } finally {
    page.restore();
  }
});
