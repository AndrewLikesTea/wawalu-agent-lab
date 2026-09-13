// One name for each kind of number on Prompt coach, asserted on the painted DOM.
//
// The page shows three kinds: the overall score out of 100, the three component
// scores it is built from, and the letter grade the overall score falls in. A
// revision puts two overall scores side by side, one for each prompt. The
// bundled example and a visitor's own grade are drawn by different modules, so
// both are loaded here and held to the same labels.
//
// The authored fallbacks already say "overall score", so every wait below is on
// state the script paints, never on text.

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { loadPage, pressEnter, pressSpace, pressTab, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { coachingSample } from "../src/prompt-coaching-contract.js";

const PAGE = fileURLToPath(new URL("../src/coach.html", import.meta.url));
const WEAK = coachingSample("underspecified-request").text;
const STRONG = coachingSample("well-formed-request").text;

const COMPONENT = /^(Intent|Efficiency|Model fit) score · \d+% of the overall score$/;
// The loose names this page used for its numbers: a count of unnamed scores, an
// unnamed pair, the old metric and band labels, and "grade" as the number itself.
const RETIRED = /three scores|both scores|Prompt score|Grade band|subscores?\b|criterion by criterion|(its|this|last|revised) grade\b/i;

const byId = (document, id) => document.getElementById(id);

async function openCoach() {
  const page = await loadPage(PAGE);
  await importPageModule("/prompt-coaching-page.js");
  return page;
}

function tabTo(document, id) {
  for (let step = 0; step <= tabSequence(document).length; step += 1) {
    if (pressTab(document)?.id === id) return;
  }
  assert.fail(`"${id}" is not reachable by Tab`);
}

function gradeText(document, text) {
  byId(document, "prompt-coaching-input").value = text;
  tabTo(document, "prompt-coaching-grade");
  pressEnter(document);
}

function assertComponents(list, ariaLabel) {
  assert.equal(list.getAttribute("aria-label"), ariaLabel);
  const labels = list.querySelectorAll("dt").map(textOf);
  assert.equal(labels.length, 3);
  for (const label of labels) assert.match(label, COMPONENT);
}

test("the bundled example labels its overall score, letter grade, and component scores", async () => {
  const page = await openCoach();
  try {
    const { document } = page;
    await waitFor(() => byId(document, "prompt-coach-sample-body").dataset.loadState === "ready",
      "bundled example painted");
    const result = byId(document, "prompt-coach-sample-result");
    assert.ok(result, "the example result is painted by script");

    const benchmark = result.querySelector(".coaching-result-benchmark");
    assert.deepEqual(benchmark.querySelectorAll("dt").map(textOf).slice(0, 2),
      ["Overall score", "Letter grade"]);
    assert.match(textOf(benchmark.querySelectorAll("dd")[0]), /^\d+ \/ 100$/);

    const rubric = result.querySelector(".coaching-result-rubric");
    assert.match(textOf(rubric.querySelector("button")),
      /^Show how the overall score was reached \(3 component scores, \d+ turns?\)$/);
    assertComponents(rubric.querySelector(".coaching-result-facts"), "Component scores");

    assert.doesNotMatch(textOf(byId(document, "prompt-coaching")), RETIRED);
  } finally {
    page.restore();
  }
});

test("a visitor's grade and its revision use the same names for every number", async () => {
  const page = await openCoach();
  try {
    const { document } = page;
    gradeText(document, WEAK);
    assert.match(textOf(document.querySelector(".prompt-coaching-benchmark-text")),
      /^Overall score: \d+ \/ 100 · grade [A-F]\./);

    tabTo(document, "prompt-coaching-detail-toggle");
    pressSpace(document);
    assert.match(textOf(byId(document, "prompt-coaching-detail-toggle")),
      /^Hide how the overall score was reached \(3 component scores, \d+ turns?\)$/);
    const detail = byId(document, "prompt-coaching-detail-panel");
    assert.equal(detail.getAttribute("aria-label"), "The rubric detail behind the overall score");
    assertComponents(detail.querySelector(".prompt-coaching-axes"), "Component scores");

    gradeText(document, STRONG);
    const scores = byId(document, "prompt-coaching-change").querySelector(".prompt-coaching-change-scores");
    assert.equal(scores.getAttribute("aria-label"),
      "Overall scores of the previous prompt and the revised prompt");
    assert.deepEqual(scores.querySelectorAll("dt").map(textOf),
      ["Previous prompt · overall score", "Revised prompt · overall score"]);

    tabTo(document, "prompt-coaching-criteria-toggle");
    pressSpace(document);
    const criteria = byId(document, "prompt-coaching-criteria-panel");
    assert.equal(criteria.getAttribute("aria-label"), "What moved in each component score");
    assertComponents(criteria.querySelector(".prompt-coaching-axes"),
      "Component scores, previous prompt beside revised prompt");

    assert.doesNotMatch(textOf(byId(document, "prompt-coaching")), RETIRED);
  } finally {
    page.restore();
  }
});
