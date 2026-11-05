// The five states a grade can be in on Prompt coach — loading, graded, empty,
// not graded, and failed — driven through the shipped page and its real entry.
//
// The shipped grader is a synchronous, in-page function, so the loading and
// failed states only appear for a grader that answers later or breaks. These
// tests hand the entry such a grader through its `gradeSession` seam; nothing
// here reaches a network, and the harness's fetch would throw if it tried.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadPage, pressTab, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { buildCoachingSession } from "../src/prompt-coaching-contract.js";
import { composeBenchmark } from "../src/prompt-coaching.js";
import { GRADING_FAILURE, GRADING_STATUS } from "../src/prompt-coaching-view.js";

const PAGE = fileURLToPath(new URL("../src/coach.html", import.meta.url));
const STRONG_PROMPT = "You are reviewing a Postgres migration for the billing service. "
  + "List every statement that takes a lock longer than one second, as a numbered list, "
  + "and do not suggest schema changes.";

const byId = (document, id) => document.getElementById(id);

/** The page with the booted form wiring replaced by one that grades through `gradeSession`. */
async function openWith(gradeSession) {
  const page = await loadPage(PAGE);
  const { initPromptCoaching } = await importPageModule("/prompt-coaching-page.js");
  if (gradeSession) {
    // The entry boots itself on import. Its form handlers are dropped so the
    // second, stubbed wiring is the only one a submit reaches.
    byId(page.document, "prompt-coaching-form").listeners.delete("submit");
    byId(page.document, "prompt-coaching-clear").listeners.delete("click");
    initPromptCoaching(page.document, { gradeSession });
  }
  return page;
}

/** A grader whose answers the test releases one at a time. */
function deferredGrader() {
  const calls = [];
  const gradeSession = (submission) => new Promise((resolve, reject) => {
    calls.push({ submission, resolve, reject });
  });
  return { calls, gradeSession };
}

function fill(document, text, tier) {
  byId(document, "prompt-coaching-input").value = text;
  byId(document, "prompt-coaching-model").value = tier;
}

const submit = (document) => byId(document, "prompt-coaching-grade").click();

test("a pending grade shows a labelled status, clears the stale result, and ignores Grade", async () => {
  const { calls, gradeSession } = deferredGrader();
  const page = await openWith(gradeSession);
  try {
    const { document } = page;
    const section = byId(document, "prompt-coaching");
    const result = byId(document, "prompt-coaching-result");
    const live = byId(document, "prompt-coaching-live");
    fill(document, STRONG_PROMPT, "standard");
    submit(document);
    calls[0].resolve(buildCoachingSession(calls[0].submission));
    await waitFor(() => section.dataset.state === "graded", "the first grade to paint");
    assert.ok(result.querySelectorAll(".prompt-coaching-answer").length > 0);

    submit(document);
    assert.equal(section.dataset.state, "loading");
    assert.equal(live.getAttribute("role"), "status");
    assert.equal(live.getAttribute("aria-live"), "polite");
    assert.equal(textOf(live), GRADING_STATUS);
    assert.equal(result.children.length, 0, "the previous result must not stand over a new grade");
    assert.equal(result.hidden, true);
    assert.equal(result.getAttribute("aria-busy"), "true");
    assert.equal(section.dataset.grade, undefined);

    const grade = byId(document, "prompt-coaching-grade");
    assert.equal(grade.getAttribute("aria-disabled"), "true");
    submit(document);
    assert.equal(calls.length, 2, "a second press while grading must not send a second grade");

    calls[1].resolve(buildCoachingSession(calls[1].submission));
    await waitFor(() => section.dataset.state === "graded", "the second grade to paint");
    assert.equal(grade.getAttribute("aria-disabled"), null);
    assert.equal(result.getAttribute("aria-busy"), null);
    assert.notEqual(textOf(live), GRADING_STATUS);
  } finally {
    page.restore();
  }
});

for (const [kind, gradeSession] of [
  ["a rejected request (network error or timeout)", () => Promise.reject(new Error("timed out"))],
  ["a grader that throws", () => { throw new Error("grader broke"); }],
  ["a malformed payload", () => Promise.resolve({ unexpected: true })],
  ["a graded payload with no score", () => Promise.resolve({ result: { scored: true } })],
]) {
  test(`${kind} is a failure with an alert and a Retry button, and focus stays put`, async () => {
    const page = await openWith(gradeSession);
    try {
      const { document } = page;
      const section = byId(document, "prompt-coaching");
      fill(document, STRONG_PROMPT, "premium");
      byId(document, "prompt-coaching-grade").focus();
      submit(document);
      await waitFor(() => section.dataset.state === "failed", "the failure to paint");

      const result = byId(document, "prompt-coaching-result");
      const alerts = result.querySelectorAll("[role=alert]");
      assert.equal(alerts.length, 1);
      assert.equal(textOf(alerts[0].querySelector(".prompt-coaching-recovery-words")), GRADING_FAILURE);
      assert.equal(alerts[0].querySelector(".prompt-coaching-shape").getAttribute("aria-hidden"), "true");
      assert.equal(alerts[0].querySelectorAll("button").length, 0);
      const retry = byId(document, "prompt-coaching-retry");
      assert.equal(retry.tagName.toLowerCase(), "button");
      assert.equal(retry.type, "button");
      assert.equal(textOf(retry), "Retry grading");
      assert.equal(textOf(byId(document, "prompt-coaching-live")), "",
        "the loading status must stand down beside the alert");
      assert.equal(document.activeElement.id, "prompt-coaching-grade", "a failure must not move focus");
      assert.equal(byId(document, "prompt-coaching-grade").getAttribute("aria-disabled"), null);
    } finally {
      page.restore();
    }
  });
}

test("Retry re-sends the same prompt and tier and leaves both in the form", async () => {
  const submissions = [];
  const page = await openWith((submission) => {
    submissions.push(submission);
    return submissions.length === 1
      ? Promise.reject(new Error("unavailable"))
      : Promise.resolve(buildCoachingSession(submission));
  });
  try {
    const { document } = page;
    const section = byId(document, "prompt-coaching");
    const prompt = byId(document, "prompt-coaching-input");
    const tier = byId(document, "prompt-coaching-model");
    fill(document, STRONG_PROMPT, "economy");
    submit(document);
    await waitFor(() => section.dataset.state === "failed", "the first grade to fail");
    assert.equal(prompt.value, STRONG_PROMPT);
    assert.equal(tier.value, "economy");

    byId(document, "prompt-coaching-retry").click();
    await waitFor(() => section.dataset.state === "graded", "the retry to grade");
    assert.equal(submissions.length, 2);
    assert.equal(submissions[1].text, submissions[0].text);
    assert.equal(submissions[1].modelTier, "economy");
    assert.equal(submissions[0].modelTier, "economy");
    assert.equal(prompt.value, STRONG_PROMPT);
    assert.equal(tier.value, "economy");
    assert.equal(document.activeElement.id, "prompt-coaching-grade",
      "the replaced Retry hands focus to the control it stood in for");
  } finally {
    page.restore();
  }
});

test("a grade that settles after it was superseded never overwrites the newer state", async () => {
  const { calls, gradeSession } = deferredGrader();
  const page = await openWith(gradeSession);
  try {
    const { document } = page;
    const section = byId(document, "prompt-coaching");
    fill(document, STRONG_PROMPT, "standard");
    submit(document);
    byId(document, "prompt-coaching-clear").click();
    assert.equal(section.dataset.state, "idle");

    fill(document, STRONG_PROMPT, "standard");
    submit(document);
    assert.equal(calls.length, 2, "clearing ends the pending grade, so Grade answers again");
    calls[1].resolve(buildCoachingSession(calls[1].submission));
    await waitFor(() => section.dataset.state === "graded", "the newer grade to paint");
    const letter = section.dataset.grade;

    calls[0].resolve(buildCoachingSession({ ...calls[0].submission, text: "   " }));
    calls[0].reject(new Error("late"));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(section.dataset.state, "graded");
    assert.equal(section.dataset.grade, letter);
    assert.equal(byId(document, "prompt-coaching-result").querySelectorAll("[role=alert]").length, 0);
  } finally {
    page.restore();
  }
});

test("an empty prompt and an ungradable one are named apart, and each action moves focus to the prompt", async () => {
  const page = await openWith(null);
  try {
    const { document } = page;
    const section = byId(document, "prompt-coaching");
    const result = byId(document, "prompt-coaching-result");

    fill(document, "   \n ", "");
    submit(document);
    assert.equal(section.dataset.reason, "empty_input");
    assert.equal(textOf(result.querySelector(".eyebrow")), "Empty prompt");
    const emptyTitle = textOf(result.querySelector(".prompt-coaching-recovery-words"));
    let action = byId(document, "prompt-coaching-edit");
    assert.equal(action.type, "button");
    assert.equal(textOf(action), "Write a prompt");
    byId(document, "prompt-coaching-grade").focus();
    action.click();
    assert.equal(document.activeElement.id, "prompt-coaching-input");

    fill(document, "```\nconst x = 1;\nconst y = 2;\n```", "");
    submit(document);
    assert.equal(section.dataset.state, "not_gradeable");
    assert.equal(section.dataset.reason, "no_scorable_turn");
    assert.equal(textOf(result.querySelector(".eyebrow")), "Not graded");
    assert.notEqual(textOf(result.querySelector(".prompt-coaching-recovery-words")), emptyTitle);
    action = byId(document, "prompt-coaching-edit");
    assert.equal(textOf(action), "Edit your prompt");
    byId(document, "prompt-coaching-grade").focus();
    action.click();
    assert.equal(document.activeElement.id, "prompt-coaching-input");
  } finally {
    page.restore();
  }
});

test("scores of 0 and 100 render as text in the figure and the component scores", async () => {
  for (const score of [0, 100]) {
    const page = await openWith((submission) => {
      const session = buildCoachingSession(submission);
      const { detail } = session.result;
      return {
        ...session,
        result: {
          ...session.result,
          benchmark: composeBenchmark(score),
          detail: { ...detail, axes: detail.axes.map((axis) => ({ ...axis, score })) },
        },
      };
    });
    try {
      const { document } = page;
      fill(document, STRONG_PROMPT, "standard");
      submit(document);
      const result = byId(document, "prompt-coaching-result");
      assert.match(textOf(result), new RegExp(`Overall score: ${score} / 100 · grade [A-F]`));
      assert.ok(textOf(result.querySelector(".prompt-coaching-improvement-title")).trim().length > 0,
        "the first recommended change must render beside an extreme score");
      byId(document, "prompt-coaching-detail-toggle").click();
      const values = byId(document, "prompt-coaching-detail-panel").querySelectorAll("dd")
        .map((node) => textOf(node));
      assert.ok(values.filter((value) => value === `${score} / 100`).length >= 3,
        `each component score reads ${score} / 100`);
    } finally {
      page.restore();
    }
  }
});

test("Tab runs prompt, tier, Grade, then the result's action, in failure and refusal alike", async () => {
  const order = (document, last) => {
    const ids = tabSequence(document).map((node) => node.id);
    const at = ["prompt-coaching-input", "prompt-coaching-model", "prompt-coaching-grade",
      "prompt-coaching-clear", last].map((id) => ids.indexOf(id));
    assert.ok(at.every((index) => index >= 0), `missing from the tab sequence: ${at}`);
    assert.deepEqual([...at].sort((a, b) => a - b), at);
  };
  let page = await openWith(() => Promise.reject(new Error("down")));
  try {
    fill(page.document, STRONG_PROMPT, "standard");
    submit(page.document);
    await waitFor(() => byId(page.document, "prompt-coaching-retry"), "the Retry button");
    order(page.document, "prompt-coaching-retry");
  } finally {
    page.restore();
  }
  page = await openWith(null);
  try {
    const { document } = page;
    fill(document, "", "");
    submit(document);
    order(document, "prompt-coaching-edit");
    byId(document, "prompt-coaching-clear").focus();
    assert.equal(pressTab(document).id, "prompt-coaching-edit",
      "the state's own action is the next stop after the form");
  } finally {
    page.restore();
  }
});

test("the state controls keep the focus ring and the result text cannot clip at 390px", () => {
  const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const evolution = readFileSync(new URL("../src/evolution.css", import.meta.url), "utf8");
  assert.match(styles, /\.secondary-button:focus-visible[^{]*\{[^}]*outline:3px solid var\(--focus-ring\)/);
  const rule = (selector) => {
    const match = evolution.match(new RegExp(`(?:^|\\n)\\${selector}\\s*\\{([^}]*)\\}`));
    assert.ok(match, `${selector} has a rule`);
    return match[1];
  };
  for (const selector of [".prompt-coaching-answer", ".prompt-coaching-benchmark-text",
    ".prompt-coaching-improvement-title", ".prompt-coaching-recommendation-text",
    ".prompt-coaching-recovery-title"]) {
    assert.match(rule(selector), /overflow-wrap:anywhere/);
  }
  for (const selector of [".prompt-coaching-letter", ".prompt-coaching-benchmark-text",
    ".prompt-coaching-axes dd"]) {
    assert.doesNotMatch(rule(selector), /(?:^|[;\s])(?:min-|max-)?width:\s*\d/,
      `${selector} must not fix a width that clips three digits`);
  }
});
