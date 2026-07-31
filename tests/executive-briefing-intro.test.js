// What a first-time visitor reads before the figure, and what they read after.
//
// The masthead of this page used to carry five sentences: three possible data
// sources, what is fetched, what is not fetched, the example hand-off, and
// printing. A reader who has not seen the sheet yet cannot use any of it — the
// sheet names its own source, in the notice above it and in the origin line of
// its own masthead, in every case. So the intro states what the page is and
// what to do first, and the standing statements about upload and printing moved
// under the sheet where the print control is.
//
// This file owns that split: the intro stays short in all three source cases,
// and the relocated statements still render, as readable prose, in all three.
// tests/executive-briefing-local.test.js still owns which source is chosen and
// why; tests/executive-briefing-preview.test.js still owns the sheet itself.

import test from "node:test";
import assert from "node:assert/strict";

import { FINOPS_WORKSPACE_KEY, FINOPS_WORKSPACE_VERSION } from "../src/finops-workspace-contract.js";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const PAGE = new URL("../src/executive-briefing.html", import.meta.url);

/** One retained period, generated here rather than committed as a fixture. */
function period(month, recoverableMinor) {
  const next = String(Number(month.slice(5)) + 1).padStart(2, "0");
  return {
    periodId: `user:${month}`,
    period: month,
    dataset: "user",
    briefingContractVersion: "finops-briefing/1.0.0",
    derivedAt: `${month.slice(0, 5)}${next}-02T09:00:00.000Z`,
    sourceFingerprint: `fp-${month}`,
    analyzedSpendMinor: 5_000_000,
    attributedSpendMinor: 5_000_000,
    recoverableScenarioMinor: recoverableMinor,
    recordsTotal: 200,
    recordsAnalyzed: 200,
    coverageRatioPpm: 960_000,
    confidence: "high",
    missingInputs: [],
    materialMetricId: "recoverable_scenario",
    materialMetricMinor: recoverableMinor,
    topDepartmentId: "syn-model-serving",
  };
}

const RETAINED = JSON.stringify({
  schemaVersion: FINOPS_WORKSPACE_VERSION,
  consent: {
    state: "granted",
    decidedAt: "2026-07-01T10:00:00.000Z",
    grantedAgainst: "finops-workspace/1.1.0",
  },
  periods: [
    period("2026-04", 500_000),
    period("2026-05", 500_000),
    period("2026-06", 750_000),
  ],
  commitments: [],
  meta: { lastWriteAt: "2026-07-02T10:00:00.000Z" },
});

/** The three things this page may brief on. There is no fourth. */
const CASES = [
  { name: "this browser's own retained periods", storage: { [FINOPS_WORKSPACE_KEY]: RETAINED }, search: "" },
  { name: "the published synthetic sample", storage: {}, search: "" },
  { name: "the AI FinOps example", storage: {}, search: "?example=ai-finops-bundled" },
];

async function openBriefing(t, { storage, search }) {
  const page = await loadPage(PAGE, { storage, routes: {}, location: { search } });
  t.after(() => page.restore());
  await importPageModule("/executive-briefing-page.js");
  const root = page.document.getElementById("executive-briefing");
  await waitFor(() => root.getAttribute("aria-busy") === "false", "the briefing finished painting");
  return { document: page.document, root };
}

const introOf = (document) => [...document.querySelector(".brief-hero").querySelectorAll("p")]
  .filter((node) => !node.classList.contains("eyebrow"))
  .map(textOf);

const countWords = (text) => text.split(/\s+/).filter(Boolean).length;

const countSentences = (text) => text.split(/[.!?](?:\s|$)/).filter((part) => part.trim()).length;

test("the intro is two sentences that say what the page is and what to do first", async () => {
  const document = (await loadPage(PAGE, { storage: {}, routes: {} })).document;
  const intro = introOf(document);
  assert.equal(intro.length, 1, "the masthead carries one intro block");

  const text = intro[0];
  assert.ok(countWords(text) < 45, `the intro runs ${countWords(text)} words`);
  assert.ok(countSentences(text) <= 2, `the intro runs ${countSentences(text)} sentences`);
  // What it is, and the first thing to do with it.
  assert.match(text, /one-page FinOps briefing/);
  assert.match(text, /Read the first screen to act/);
  // It must not branch over sources: the sheet below names the one in use, and a
  // reader who has not reached the sheet cannot use a list of the alternatives.
  assert.doesNotMatch(text, /synthetic sample|retained FinOps periods|AI FinOps example/);
});

test("the heading and the promise this page was named for are untouched", async () => {
  const { document } = await loadPage(PAGE, { storage: {}, routes: {} });
  const hero = document.querySelector(".brief-hero");
  assert.equal(textOf(hero.querySelector(".eyebrow")), "Executive FinOps briefing");
  assert.match(textOf(document.querySelector("#page-title")), /One page,\s*one decision\./);
});

test("what is uploaded and what printing does still render, under the sheet", async (t) => {
  for (const scenario of CASES) {
    const { document, root } = await openBriefing(t, scenario);
    const notes = document.querySelector(".brief-notes");
    assert.ok(notes, `no notes block for ${scenario.name}`);

    // Attached to a heading, and readable prose — not a title attribute and not
    // a visually hidden node.
    const heading = notes.querySelector("h2");
    assert.equal(heading.id, notes.getAttribute("aria-labelledby"));
    assert.ok(textOf(heading).length > 0, `the notes heading is empty for ${scenario.name}`);
    assert.equal(notes.hasAttribute("hidden"), false);

    const prose = [...notes.querySelectorAll("p")].map(textOf);
    // The intro does not grow back once the sheet is painted.
    assert.ok(countWords(introOf(document)[0]) < 45, `the intro grew for ${scenario.name}`);
    assert.ok(prose.some((line) => /uploaded, stored, or linked/.test(line)),
      `the upload statement is missing for ${scenario.name}`);
    assert.ok(prose.some((line) => /both levels open on paper/.test(line)),
      `the printing statement is missing for ${scenario.name}`);

    // Under the sheet, in DOM order: the reader meets the figure first.
    assert.equal(root.compareDocumentPosition
      ? Boolean(root.compareDocumentPosition(notes) & 4)
      : true, true, `the notes block precedes the briefing for ${scenario.name}`);
  }
});

test("each source names itself in one sentence, in the sheet a reader is holding", async (t) => {
  const expected = [
    /Your own retained FinOps periods/,
    /Published synthetic sample/,
    /Bundled synthetic example from AI FinOps/,
  ];
  for (const [index, scenario] of CASES.entries()) {
    const { document } = await openBriefing(t, scenario);
    const origin = textOf(document.querySelector(".brief-origin"));
    assert.match(origin, expected[index], `the origin line is wrong for ${scenario.name}`);
    assert.equal(countSentences(origin), 1,
      `the origin line runs ${countSentences(origin)} sentences for ${scenario.name}`);

    // The two non-workspace cases also carry the notice directly above the
    // sheet, and it says whose figures these are before the figure is read.
    const notice = document.querySelector(".brief-source-notice");
    if (index === 0) {
      assert.equal(notice, null, "a briefing on the reader's own periods needs no absence notice");
    } else {
      assert.match(textOf(notice.querySelector(".brief-source-title")), /Not your figures:/);
    }
  }
});
