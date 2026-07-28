// The coaching workflow, driven through the shipped markup of evolution.html.
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

const PAGE = fileURLToPath(new URL("../src/evolution.html", import.meta.url));

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
