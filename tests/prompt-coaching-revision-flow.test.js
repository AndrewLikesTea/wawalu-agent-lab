// Re-grading a prompt, driven through the shipped markup of the prompt-coach destination.
//
// `prompt-coaching-flow.test.js` covers the first grade. This file covers only
// what the second one changes: the reading order of the change block, where
// focus lands after a re-grade, what the live region says, that the surface
// still names exactly one next move, and the four states the change block has
// that a happy path never shows — pending, no-baseline, abstained, and a figure
// outside the scale it is measured on.
//
// Contrast is measured out of `src/evolution.css` itself rather than asserted
// from memory, so a future edit to a token or a pairing fails here instead of
// shipping a delta nobody can read.
//
// The harness's fetch throws on any request a test did not declare, and this
// file declares none.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { loadPage, pressEnter, pressSpace, pressTab, tabSequence, textOf } from "./support/browser.js";
import { importPageModule } from "./support/page-module.js";
import { buildCoachingSession, coachingSample } from "../src/prompt-coaching-contract.js";
import {
  REVISION_STATUS, buildRevisionChange, markPromptCoachingPending,
} from "../src/prompt-coaching-view.js";

const PAGE = fileURLToPath(new URL("../src/coach.html", import.meta.url));
const CSS = new URL("../src/evolution.css", import.meta.url);
const BASE_CSS = new URL("../src/styles.css", import.meta.url);

const WEAK = coachingSample("underspecified-request").text;
const STRONG = coachingSample("well-formed-request").text;

const byId = (document, id) => document.getElementById(id);

async function openCoachingPage() {
  const page = await loadPage(PAGE);
  await importPageModule("/prompt-coaching-page.js");
  return page;
}

function tabTo(document, id) {
  for (let step = 0; step <= tabSequence(document).length; step += 1) {
    const focused = pressTab(document);
    if (focused?.id === id) return focused;
  }
  return assert.fail(`"${id}" is not reachable by Tab; a keyboard user cannot use the workflow.`);
}

/**
 * Grade what is in the box from the keyboard. The text is placed rather than
 * typed character by character — these specs are about what happens after the
 * grade, and the first-grade file already proves the keystroke path — but the
 * grade itself is always a real keyboard activation of the real control.
 */
function gradeText(document, text) {
  const field = byId(document, "prompt-coaching-input");
  field.value = text;
  tabTo(document, "prompt-coaching-grade");
  pressEnter(document);
}

const changeRegion = (document) => byId(document, "prompt-coaching-change");

/** The class names inside the change region, in document order. */
function changeOrder(document) {
  return changeRegion(document).querySelectorAll("h3,p,dl,div,ul")
    .map((node) => node.className)
    .filter(Boolean);
}

test("before a second grade the cue offers re-grading and nothing claims a change", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    const cue = byId(document, "prompt-coaching-cue");
    assert.ok(cue, "the re-grade cue must ship in the markup, before any script runs");
    assert.equal(cue.hidden, false);
    const words = textOf(cue);
    assert.match(words, /Compare a revision/i);
    // Privacy and storage are stated once before the field, so this cue stays
    // focused on the revision workflow instead of repeating that disclosure.
    // The steps are stated once there too — paste, grade, revise, grade again —
    // so this cue says only what the second grade will show.
    assert.match(words, /A second grade shows both scores and what changed\./);
    assert.doesNotMatch(words, /paste|revise|edit it|grade it again/i,
      "the steps belong to the block before the field, not to this cue");
    assert.doesNotMatch(words, /model|memory|text you pasted|saved|stored|history|account|upload/i);

    assert.equal(changeRegion(document).hidden, true);
    assert.equal(changeRegion(document).getAttribute("aria-labelledby"), null);
    // Hidden and out of the tab sequence: a reader who has not re-graded never
    // tabs into an empty landmark.
    assert.equal(changeRegion(document).getAttribute("tabindex"), "-1");
    assert.equal(tabSequence(document).includes(changeRegion(document)), false);

    gradeText(document, WEAK);
    assert.equal(changeRegion(document).hidden, true,
      "one grade is an answer, not a change; there is nothing to compare it to");
    assert.equal(cue.hidden, false);
    assert.ok(document.querySelector(".prompt-coaching-improvement"),
      "the single-result surface still names its own one move");
  } finally {
    page.restore();
  }
});

test("a second grade reads baseline, revised, delta, provenance, then one move", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeText(document, WEAK);
    gradeText(document, STRONG);

    const region = changeRegion(document);
    assert.equal(region.hidden, false);
    assert.equal(region.dataset.status, REVISION_STATUS.compared);
    assert.equal(region.getAttribute("aria-labelledby"), "prompt-coaching-change-heading");
    assert.equal(textOf(byId(document, "prompt-coaching-change-heading")),
      "What changed since your last grade");

    // The reading order, as the DOM: the answer to "did that help" first, the
    // dispute material last.
    assert.deepEqual(changeOrder(document).slice(0, 7), [
      "eyebrow",
      "prompt-coaching-change-status",
      "prompt-coaching-change-scores",
      "prompt-coaching-change-delta",
      "prompt-coaching-basis",
      "prompt-coaching-change-provenance",
      "prompt-coaching-change-action",
    ]);

    // Baseline before revised, each labelled, so the pair survives being read
    // aloud and out of position.
    const scores = region.querySelector(".prompt-coaching-change-scores");
    assert.deepEqual(scores.querySelectorAll("dt").map(textOf), ["Baseline", "Revised"]);
    const values = scores.querySelectorAll("dd").map(textOf);
    assert.match(values[0], /^\d+ \/ 100 · grade [A-F]$/);
    assert.match(values[1], /^\d+ \/ 100 · grade [A-F]$/);
    assert.notEqual(values[0], values[1]);

    // The delta is labelled, not left as a signed number to be ranked, and its
    // direction is a word beside the tint rather than the tint alone.
    const delta = region.querySelector(".prompt-coaching-change-delta");
    assert.equal(delta.dataset.direction, "improved");
    assert.match(textOf(delta.querySelector(".prompt-coaching-change-delta-label")),
      /^(Material change|Within the same grade band|No change)$/);
    assert.equal(textOf(delta.querySelector(".prompt-coaching-change-delta-direction")),
      "improved");
    assert.match(textOf(delta.querySelector(".prompt-coaching-change-delta-value")),
      /^\+\d+ points · \d+ → \d+ of 100\.$/);
    assert.match(textOf(delta.querySelector(".prompt-coaching-change-delta-band")),
      /^Grade band (moved [A-F] → [A-F]|unchanged at [A-F])\.$/);

    // The rubric's own confidence qualifier and the versions both grades ran on.
    assert.match(textOf(region.querySelector(".prompt-coaching-basis")), /Partial result/);
    assert.match(textOf(region.querySelector(".prompt-coaching-change-provenance")),
      /^Both grades: rubric \S+ · classifier \S+ · model tier not specified$/);

    // Exactly one next move on the whole surface: the comparison's, because it
    // is the one that knows a revision happened.
    assert.equal(document.querySelectorAll(".prompt-coaching-change-action").length, 1);
    assert.equal(document.querySelectorAll(".prompt-coaching-improvement").length, 0);
    assert.ok(textOf(region.querySelector(".prompt-coaching-change-action-guidance")).length > 0);

    // The cue has done its job and stands down rather than repeating itself.
    assert.equal(byId(document, "prompt-coaching-cue").hidden, true);
  } finally {
    page.restore();
  }
});

test("re-grading moves focus to what changed and announces it before the answer", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeText(document, WEAK);
    // The first grade leaves focus on the control that was pressed.
    assert.equal(document.activeElement.id, "prompt-coaching-grade");

    gradeText(document, STRONG);
    assert.equal(document.activeElement.id, "prompt-coaching-change",
      "a reader who pressed Grade a second time asked what moved; focus lands there");

    const live = textOf(byId(document, "prompt-coaching-live"));
    assert.match(live, /^(Material change|Within the same grade band|No change), improved\./);
    assert.match(live, /Grade band/);
    assert.match(live, /Do this next:/);
    // The change leads, and the revised answer follows it in the same breath.
    assert.ok(live.indexOf("Do this next:") < live.length - 1);
  } finally {
    page.restore();
  }
});

test("criterion-level movement is disclosed, keyboard-operable, and keeps focus", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeText(document, WEAK);
    gradeText(document, STRONG);

    const toggle = byId(document, "prompt-coaching-criteria-toggle");
    assert.ok(toggle, "criterion detail must be reachable");
    assert.equal(toggle.tagName, "BUTTON");
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(toggle.getAttribute("aria-controls"), "prompt-coaching-criteria-panel");
    assert.equal(byId(document, "prompt-coaching-criteria-panel").hidden, true,
      "the answer to 'did that help' is not four axis rows");
    assert.match(textOf(toggle), /^Show what moved criterion by criterion \(\d+ criteria\)$/);

    tabTo(document, "prompt-coaching-criteria-toggle");
    pressSpace(document);

    const opened = byId(document, "prompt-coaching-criteria-toggle");
    assert.equal(opened.getAttribute("aria-expanded"), "true");
    assert.equal(byId(document, "prompt-coaching-criteria-panel").hidden, false);
    assert.equal(document.activeElement.id, "prompt-coaching-criteria-toggle",
      "a toggle that moves focus off itself loses a keyboard reader their place");

    const panel = byId(document, "prompt-coaching-criteria-panel");
    assert.equal(panel.getAttribute("role"), "region");
    const rows = panel.querySelectorAll("dd").map(textOf);
    assert.ok(rows.length >= 1);
    for (const row of rows) {
      // Every criterion states both figures and the direction as a word.
      assert.match(row, /^\d+ → \d+ \/ 100 · (up \d+|down \d+|unchanged)$/);
    }
  } finally {
    page.restore();
  }
});

test("changing the model tier between grades abstains instead of claiming movement", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeText(document, WEAK);
    byId(document, "prompt-coaching-model").value = "premium";
    gradeText(document, STRONG);

    const region = changeRegion(document);
    assert.equal(region.hidden, false);
    assert.equal(region.dataset.status, REVISION_STATUS.abstained);
    assert.equal(region.querySelectorAll(".prompt-coaching-change-delta").length, 0,
      "two grades on different tiers have no comparable movement to draw");
    assert.equal(region.querySelectorAll(".prompt-coaching-change-scores").length, 0);
    assert.match(textOf(region.querySelector(".prompt-coaching-change-reason")),
      /Reason code tier_changed/);
    // Still exactly one move, and it is the one that unblocks the comparison.
    assert.equal(document.querySelectorAll(".prompt-coaching-change-action").length, 1);
    assert.equal(document.querySelectorAll(".prompt-coaching-improvement").length, 0);
    assert.match(textOf(region.querySelector(".prompt-coaching-change-action-words")),
      /Use one model tier\./);
    assert.match(textOf(byId(document, "prompt-coaching-live")), /^Not compared\./);
  } finally {
    page.restore();
  }
});

test("a refusal claims no movement and leaves the baseline standing", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeText(document, WEAK);
    gradeText(document, "   \n  ");

    assert.equal(changeRegion(document).hidden, true,
      "a state with no grade in it is not a revision of one");
    assert.equal(byId(document, "prompt-coaching-cue").hidden, false);
    assert.ok(document.querySelector(".prompt-coaching-recovery"));

    // The baseline survived the refusal, so the next real grade still compares.
    gradeText(document, STRONG);
    assert.equal(changeRegion(document).dataset.status, REVISION_STATUS.compared);
  } finally {
    page.restore();
  }
});

test("clearing drops the baseline, restores the cue, and empties the change region", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    gradeText(document, WEAK);
    gradeText(document, STRONG);
    assert.equal(changeRegion(document).hidden, false);

    tabTo(document, "prompt-coaching-clear");
    pressEnter(document);

    const region = changeRegion(document);
    assert.equal(region.hidden, true);
    assert.equal(textOf(region), "");
    assert.equal(region.getAttribute("aria-labelledby"), null);
    assert.equal(byId(document, "prompt-coaching-cue").hidden, false);
    assert.equal(document.activeElement.id, "prompt-coaching-input");

    gradeText(document, STRONG);
    assert.equal(changeRegion(document).hidden, true,
      "a cleared panel has no baseline, so the next grade is a first grade again");
  } finally {
    page.restore();
  }
});

test("the pending state is drawn rather than left as a blank while a grade runs", async () => {
  const page = await openCoachingPage();
  try {
    const { document } = page;
    const model = markPromptCoachingPending(document);
    assert.equal(model.status, REVISION_STATUS.pending);

    const region = changeRegion(document);
    assert.equal(region.hidden, false);
    assert.equal(region.dataset.status, REVISION_STATUS.pending);
    // Both figures are withheld, and marked as withheld rather than shown as 0.
    const values = region.querySelector(".prompt-coaching-change-scores").querySelectorAll("dd");
    assert.deepEqual(values.map(textOf), ["—", "—"]);
    assert.deepEqual(values.map((node) => node.dataset.pending), ["true", "true"]);
    assert.equal(region.querySelector(".prompt-coaching-change-delta").dataset.direction, "none");
    // A move is still named, and it names the wait rather than guessing.
    assert.equal(document.querySelectorAll(".prompt-coaching-change-action").length, 1);
    assert.match(textOf(byId(document, "prompt-coaching-live")),
      /^Grading the revision\. Nothing has been sent anywhere\.$/);
  } finally {
    page.restore();
  }
});

test("a figure outside the 0-100 scale withholds the delta instead of printing it", () => {
  const baseline = buildCoachingSession({ sessionId: "baseline", text: WEAK });
  const revision = buildCoachingSession({ sessionId: "revision", text: STRONG });
  // The shipped rubric clamps, so this pair cannot come out of the engine. It is
  // what a caller handing this surface a broken figure produces, and the honest
  // drawing of that is "out of range", not a confident arrow.
  const broken = JSON.parse(JSON.stringify(revision));
  broken.result.benchmark.score = 4000;

  const change = buildRevisionChange({ comparisonId: "revision-2", baseline, revision: broken });
  assert.equal(change.status, REVISION_STATUS.compared);
  assert.equal(change.delta.withheld, true);
  assert.match(change.delta.value, /^Out of range/);
  assert.ok(change.notices.some((notice) => notice.code === "score_out_of_range"));
  // The claim is withdrawn, not softened: no direction word, no materiality,
  // and nothing in the announcement a listener could act on as movement.
  assert.equal(change.delta.direction, null);
  assert.equal(change.delta.material, false);
  assert.equal(change.delta.label, "Movement not claimed");
  assert.doesNotMatch(change.announcement, /improved|regressed|Material change/);
  // The move is unchanged: the figure is untrustworthy, the guidance is not.
  assert.ok(change.action.title.length > 0);
  assert.doesNotMatch(change.announcement, /4000/);
});

test("a pair the contract refuses to compare becomes a drawn state, not an exception", () => {
  const session = buildCoachingSession({ sessionId: "only-one", text: WEAK });
  const change = buildRevisionChange({
    comparisonId: "revision-2", baseline: session, revision: session,
  });
  assert.equal(change.status, REVISION_STATUS.error);
  assert.equal(change.delta, null);
  assert.ok(change.reason.length > 0);
  assert.equal(change.action.control, "prompt-coaching-input");
});

// --- contrast and motion -----------------------------------------------------

const css = await readFile(CSS, "utf8");
const baseCss = await readFile(BASE_CSS, "utf8");

const TOKENS = new Map(
  [...(css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
    .map(([, name, value]) => [name, value.trim()]),
);

const color = (value) => {
  const named = value.match(/^var\((--[\w-]+)\)$/);
  return (named ? TOKENS.get(named[1]) : value)?.trim();
};

function declared(selector, property) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = css.match(new RegExp(`(?:^|[,}])\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
  assert.ok(rule, `no rule for ${selector}`);
  const found = rule[1].match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  return found ? color(found[1].trim()) : null;
}

const channel = (value) => {
  const linear = value / 255;
  return linear <= 0.03928 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
};

const expand = (hex) => {
  const digits = hex.replace("#", "");
  return `#${digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits}`;
};

function luminance(hex) {
  const n = parseInt(expand(hex).slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255)
    + 0.7152 * channel((n >> 8) & 255)
    + 0.0722 * channel(n & 255);
}

function ratio(foreground, background) {
  const [a, b] = [luminance(foreground), luminance(background)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test("every delta variant is readable on the fill it is drawn on", (t) => {
  const variants = [
    [".prompt-coaching-change-delta", "improved"],
    ['.prompt-coaching-change-delta[data-direction="regressed"]', "regressed"],
    ['.prompt-coaching-change-delta[data-implausible="true"]', "out of range"],
  ];
  for (const [selector, name] of variants) {
    const measured = ratio(declared(selector, "color"), declared(selector, "background"));
    t.diagnostic(`${name}: ${measured.toFixed(2)}:1`);
    assert.ok(measured >= 4.5, `${name} delta is ${measured.toFixed(2)}:1, below 4.5:1`);
  }
  // The unchanged variant declares both halves on one rule shared with `none`.
  const flat = css.match(/\.prompt-coaching-change-delta\[data-direction="unchanged"\],[\s\S]*?\{([^}]*)\}/);
  assert.ok(flat, "the unchanged delta must declare its own pairing");
  assert.match(flat[1], /color:#171713/);
  assert.match(flat[1], /background:#fff/);
});

test("the change region is a visible focus destination and asks for no motion", () => {
  assert.match(css, /\.prompt-coaching-change:focus,\.prompt-coaching-change:focus-visible \{[^}]*outline:3px solid var\(--focus-ring\)/);
  // The only motion landing focus here can cause is the scroll, and the base
  // stylesheet already reverts that for a reader who asked for less of it.
  assert.match(baseCss, /@media\(prefers-reduced-motion:reduce\) \{[^}]*html\{scroll-behavior:auto\}/);
  // Nothing in this block introduces an animation or a transition of its own.
  const block = css.slice(css.indexOf(".prompt-coaching-cue"), css.indexOf(".prompt-coaching-preview"));
  assert.doesNotMatch(block, /animation|transition/);
});
