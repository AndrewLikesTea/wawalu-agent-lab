// The answer block, on the surface a CTO actually reads.
//
// The screen contract is docs/executive-answer-screen-contract.md and its
// executable form is src/finops-screen-contract.js. What this file exists to
// catch is drift between the two and drift between either of them and the
// shipped page:
//
//   * a headline figure that stopped being the contract's figure. The
//     assertion below RECOMPUTES the percentage from the page's own inputs —
//     `summarize` over the departments the rubric scored, over `summarize` over
//     all of them — and compares it to the rendered string. There is no
//     hardcoded percentage anywhere in this file; a fixture change moves both
//     sides together, and a change to the DEFINITION moves only one.
//   * a block that grew a fifth element, or lost one of its four.
//   * a destination in the contract with no working entry point on the page.
//   * a previously existing top-level section quietly dropped in the reorder.
//
// It drives the real markup from src/evolution.html through the real page entry
// with storage cleared and nothing imported, which is the state a lead lands in.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, parseHtml, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  ANSWER_DESTINATION, SCREEN_CONTRACT, answerBlock, asOfBasis,
} from "../src/finops-screen-contract.js";
import { ANSWER_BLOCK_IDS, applyStandHeadline } from "../src/finops-stand-view.js";
import { buildStandHeadline, composeStandHeadline } from "../src/finops-stand.js";
import { departmentPerformance, formatPercent, summarize } from "../src/evolution.js";
import { GRADABILITY_STATE } from "../src/export-gradability.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const DEMO_DATA = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(await readFile(
  new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));
const CONTRACT_DOC = await readFile(
  new URL("../docs/executive-answer-screen-contract.md", import.meta.url), "utf8");

const byId = (document, id) => document.getElementById(id);

async function openWithClearedStorage() {
  const page = await loadPage(PAGE, {
    storage: {},
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  return page;
}

// ---------------------------------------------------------------------------
// 1. The contract and the screen are one set of strings.
// ---------------------------------------------------------------------------

test("the contract document names exactly the four destinations the module ships", () => {
  assert.equal(SCREEN_CONTRACT.length, 4);
  assert.deepEqual(SCREEN_CONTRACT.map((entry) => entry.key),
    ["answer", "evidence", "departments", "act-and-verify"]);
  for (const entry of SCREEN_CONTRACT) {
    // Every question and every metric label a reader can meet is in the prose
    // too, verbatim. A reworded question in one file and not the other is the
    // drift this pair of assertions exists for.
    assert.ok(CONTRACT_DOC.includes(entry.question),
      `the contract document does not carry ${entry.key}'s question verbatim`);
    assert.ok(CONTRACT_DOC.includes(entry.metricLabel),
      `the contract document does not carry ${entry.key}'s metric label verbatim`);
    assert.ok(entry.excludes.trim().length > 0,
      `${entry.key} declares nothing that it deliberately excludes`);
  }
});

test("the authored markup says what the contract says, before any script runs", () => {
  const document = parseHtml(html);
  assert.equal(textOf(byId(document, ANSWER_BLOCK_IDS.question)), ANSWER_DESTINATION.question);
  assert.equal(textOf(byId(document, ANSWER_BLOCK_IDS.label)), ANSWER_DESTINATION.metricLabel);
});

// ---------------------------------------------------------------------------
// 2. Four elements, in order, and nothing else.
// ---------------------------------------------------------------------------

test("the answer block holds one question heading, one figure, one confidence sentence, and one action", () => {
  const document = parseHtml(html);
  const block = byId(document, ANSWER_BLOCK_IDS.block);
  const children = [...block.children].filter((node) => node.nodeType === 1);
  assert.equal(children.length, 4, "the answer block must contain exactly four elements");
  assert.deepEqual(children.map((node) => node.id), [
    ANSWER_BLOCK_IDS.question, ANSWER_BLOCK_IDS.figure,
    ANSWER_BLOCK_IDS.confidence, ANSWER_BLOCK_IDS.action,
  ]);

  // The question is a real heading, in a valid order under the region's own h2.
  assert.equal(children[0].tagName.toLowerCase(), "h3");
  const region = byId(document, "finops-stand");
  const headings = region.querySelectorAll("h1,h2,h3,h4,h5,h6");
  assert.equal(headings[0].tagName.toLowerCase(), "h2",
    "the region's own question stays the highest-ranked heading in it");
  assert.equal(headings[1].id, ANSWER_BLOCK_IDS.question,
    "the answer block's question is the next heading after it");

  // The action is a real link with a real href, operable before any script.
  assert.equal(children[3].tagName.toLowerCase(), "a");
  assert.ok(children[3].getAttribute("href"),
    "the next action must be a real link, not a scripted control");
  assert.ok(textOf(children[3]).trim().length > 0,
    "the next action's accessible name is its own visible text, and it must say what it does");

  // No figure ships in the authored bytes: the value slot is a state, not a number.
  assert.ok(!/\d/.test(textOf(byId(document, ANSWER_BLOCK_IDS.value))),
    "no figure may be authored into the markup; it is painted from the verdict");
});

test("the figure, its unit, and its as-of basis are one announcement, not three fragments", () => {
  const document = parseHtml(html);
  const figure = byId(document, ANSWER_BLOCK_IDS.figure);
  assert.equal(figure.tagName.toLowerCase(), "p");
  // All three live inside the one paragraph, so a screen reader speaks them
  // together rather than as three stops with nothing joining them.
  const inside = [...figure.children].filter((node) => node.nodeType === 1).map((node) => node.id);
  assert.deepEqual(inside,
    [ANSWER_BLOCK_IDS.label, ANSWER_BLOCK_IDS.value, ANSWER_BLOCK_IDS.basis]);
  assert.equal(figure.querySelectorAll("h1,h2,h3,h4,h5,h6").length, 0);
});

// ---------------------------------------------------------------------------
// 3. The figure equals the contract's computation over the page's own inputs.
// ---------------------------------------------------------------------------

/**
 * A department set the real modules will grade, built here rather than
 * committed. `sampling` and `categoryMix` are what `departmentPerformance`
 * reads to decide a department was scored, so this produces a genuine mixed
 * coverage rather than a mocked verdict.
 */
function departmentsWithCoverage() {
  const scored = (id, spendUsd) => ({
    id, name: id, spendUsd, records: 10,
    sampling: { status: "available", sampledQueries: 40 },
    mix: { highValue: 0.6, routine: 0.4 },
  });
  const unscored = (id, spendUsd) => ({
    id, name: id, spendUsd, records: 10,
    sampling: { status: "unavailable", sampledQueries: 0, reason: "No queries were sampled." },
  });
  return [scored("Platform", 60000), scored("Growth", 15000), unscored("Support", 25000)];
}

test("the headline figure is the contract's computation over the page's existing inputs", () => {
  const departments = departmentsWithCoverage();
  // Composed by the real headline composer, which reaches the real gradability
  // verdict over the real eligibility evaluator. Nothing is stubbed.
  const headline = composeStandHeadline({
    analysis: { period: "2026-06-01 to 2026-07-01", rankedDepartments: departments },
    source: "import",
  });
  const block = answerBlock(headline);

  // Recomputed here straight from the contract's definition — numerator is
  // `summarize` over the departments the rubric scored, denominator is
  // `summarize` over all of them — so this assertion fails if the DEFINITION
  // moves, and passes unchanged if the fixture does.
  const scored = departments.filter((row) => departmentPerformance(row).available);
  const expected = summarize(scored).spendUsd / summarize(departments).spendUsd;
  assert.ok(expected > 0 && expected < 1, "the fixture must produce a genuine mixed ratio");
  assert.equal(block.ratio, expected, "the block's raw ratio is not the contract's ratio");
  assert.equal(block.figure, `${formatPercent(expected, { digits: 1 })} of spend in scope`,
    "the rendered figure is not the contract's computation at the contract's rounding");
  assert.match(block.figure, /^\d+\.\d% of spend in scope$/,
    "one decimal, the same rounding the score card's coverage line uses");

  // The as-of basis travels with it: the dataset and the period, never a clock
  // and never a generic "recent".
  assert.equal(block.basis, `as of ${asOfBasis(headline)}`);
  assert.ok(block.basis.includes("June 2026"), block.basis);
  assert.ok(!/recent/i.test(block.basis));
});

test("the rendered figure is whatever the composer computed, and it is never authored", async () => {
  const { document } = await openWithClearedStorage();
  const headline = await buildStandHeadline();
  const expected = answerBlock(headline);
  assert.equal(textOf(byId(document, ANSWER_BLOCK_IDS.value)), expected.figure);
  assert.equal(textOf(byId(document, ANSWER_BLOCK_IDS.basis)), expected.basis);
  assert.ok(textOf(byId(document, ANSWER_BLOCK_IDS.basis)).includes("Bundled synthetic example"));

  // The bundled example ships no scored query sample, so its coverage is a
  // measured zero and the block withholds the percentage rather than printing
  // one a reader could act on. This is the honest state, and pinning it here is
  // what stops a later change from filling the slot with an invented figure.
  assert.equal(expected.available, false);
  assert.ok(!/%/.test(expected.figure), expected.figure);
  assert.equal(byId(document, ANSWER_BLOCK_IDS.block).dataset.available, "false");
});

test("the confidence sentence names the inputs the figure was computed from", async () => {
  const { document } = await openWithClearedStorage();
  const sentence = textOf(byId(document, ANSWER_BLOCK_IDS.confidence));
  for (const named of ["Coverage:", "Grade:", "Residue:", "as of"]) {
    assert.ok(sentence.includes(named), `the confidence sentence never names ${named}: ${sentence}`);
  }
  assert.ok(!/based on recent data/i.test(sentence));
  // Coverage is quoted in dollars on both sides, so the percentage above can be
  // re-divided by hand from the same sentence.
  assert.match(sentence, /\$[\d,]+ of \$[\d,]+ of spend in scope/);
});

test("the next action is a real link, named for what it does, pointing where it is taken", async () => {
  const { document } = await openWithClearedStorage();
  const action = byId(document, ANSWER_BLOCK_IDS.action);
  const href = action.getAttribute("href");
  const targets = new Set(SCREEN_CONTRACT.map((entry) => entry.target).concat(["#local-import"]));
  assert.ok(targets.has(href), `the action points at ${href}, which no destination owns`);
  assert.ok(textOf(action).trim().length > 0);
});

// ---------------------------------------------------------------------------
// 4. The metric's states, driven directly rather than waited for.
// ---------------------------------------------------------------------------

test("a coverage below the bar publishes no percentage at all", () => {
  // A department set the rubric scored none of: below the bar by construction.
  const withheld = answerBlock({
    label: "Imported", period: "June 2026",
    gradability: {
      state: GRADABILITY_STATE.belowBar, tier: "insufficient",
      coverage: 0.1, coveredUsd: 1000, totalUsd: 10000,
      action: { cluster: "Customer Support", uncoveredUsd: 9000 },
    },
  });
  assert.equal(withheld.available, false);
  assert.equal(withheld.ratio, null);
  assert.ok(!/%/.test(withheld.figure),
    "a below-bar export must not be shown a small percentage it could act on");
  // …and the residue it names is still the correctable one, so the action has a
  // department to aim at.
  assert.ok(withheld.confidence.includes("Customer Support"));
  assert.equal(withheld.action.href, "#department-decision-panel");
});

test("no spend baseline is not a coverage of zero", () => {
  const none = answerBlock({
    label: "Imported", period: null,
    gradability: {
      state: GRADABILITY_STATE.noBaseline, tier: "no_baseline",
      coverage: null, coveredUsd: 0, totalUsd: 0, action: { cluster: null, uncoveredUsd: 0 },
    },
  });
  assert.equal(none.ratio, null);
  assert.ok(!none.figure.includes("0%"), "an absent denominator must never print as 0%");
  assert.equal(none.action.href, "#local-import");
  assert.equal(asOfBasis({ label: "Imported", period: null }), "Imported");
});

test("a graded export's action is to commit and verify, not to widen anything", () => {
  const graded = answerBlock({
    label: "Imported", period: "June 2026",
    gradability: {
      state: GRADABILITY_STATE.graded, tier: "high",
      coverage: 0.9, coveredUsd: 9000, totalUsd: 10000,
      action: { cluster: "Customer Support", uncoveredUsd: 1000 },
    },
  });
  assert.equal(graded.available, true);
  assert.equal(graded.figure, "90.0% of spend in scope");
  assert.equal(graded.action.href, "/savings-action-center.html");
});

test("the block repaints from whatever headline it is given, and never latches a figure", () => {
  const document = parseHtml(html);
  const composed = composeStandHeadline({ analysis: null, source: "example" });
  applyStandHeadline(document, composed);
  const first = textOf(byId(document, ANSWER_BLOCK_IDS.value));
  applyStandHeadline(document, {
    ...composed,
    label: "Imported", period: "June 2026",
    gradability: {
      ...composed.gradability, state: GRADABILITY_STATE.graded, tier: "high",
      coverage: 0.75, coveredUsd: 7500, totalUsd: 10000,
      action: { cluster: null, uncoveredUsd: 0 },
    },
  });
  assert.equal(textOf(byId(document, ANSWER_BLOCK_IDS.value)), "75.0% of spend in scope");
  assert.notEqual(first, "75.0% of spend in scope");
  assert.equal(byId(document, ANSWER_BLOCK_IDS.block).dataset.available, "true");
});

// ---------------------------------------------------------------------------
// 5. Every destination has a working entry point, reachable by keyboard.
// ---------------------------------------------------------------------------

test("every contract destination has a working named entry point", async () => {
  const { document } = await openWithClearedStorage();
  const doors = [...byId(document, ANSWER_BLOCK_IDS.doors).children];
  assert.equal(doors.length, SCREEN_CONTRACT.length);

  doors.forEach((door, index) => {
    const entry = SCREEN_CONTRACT[index];
    assert.equal(door.tagName.toLowerCase(), "a", "an entry point must be a real link");
    assert.equal(door.getAttribute("href"), entry.target);
    const name = textOf(door);
    assert.ok(name.includes(entry.name), `${entry.key}'s door does not carry its contract name`);
    assert.ok(name.includes(entry.question), `${entry.key}'s door does not say what it answers`);
    // An in-page destination must actually exist on the page it claims to be on.
    if (entry.target.startsWith("#")) {
      assert.ok(byId(document, entry.target.slice(1)),
        `${entry.key} points at ${entry.target}, which is not on this page`);
    }
  });
});

test("the entry points are keyboard-reachable in visual order", () => {
  const document = parseHtml(html);
  // Source order is the visual order here — the block is a single-column grid
  // and the doors are wrapping inline links — so the tab order is the DOM
  // order, and no `tabindex` may be present to make it anything else.
  const doors = [...byId(document, ANSWER_BLOCK_IDS.doors).children];
  for (const door of doors) {
    assert.equal(door.getAttribute("tabindex"), null,
      "an entry point must take its place in the natural tab order");
  }
  const order = tabSequence(document).map((node) => node.id).filter(Boolean);
  const action = order.indexOf(ANSWER_BLOCK_IDS.action);
  assert.ok(action >= 0, "the next action must be in the tab order");
});

// ---------------------------------------------------------------------------
// 6. Nothing was dropped in the reorder.
// ---------------------------------------------------------------------------

test("every top-level section that existed before the answer block is still on the page", () => {
  const document = parseHtml(html);
  // The full top-level set as it shipped before this change. Pinned as a list
  // rather than derived, because the point of the assertion is that a reorder
  // did not quietly become a deletion.
  const existing = [
    "finops-stand", "finops-hero", "finops-first-run", "disclosure-next-step",
    "disclosure-journey", "finops-destinations", "finops-workspace-nav",
    "finops-workspace-switch",
    // #821: one load-state region per on-demand destination, so a module that
    // is in flight or that failed has somewhere named to be read.
    "destination-load-evidence", "destination-load-department",
    "destination-load-act-and-verify",
    "finops-workspace-context", "finops-load-state", "score-card",
    "finops-portfolio-brief", "guided-result", "local-import", "prompt-coaching",
    "finops-contact", "finops-proof-point", "finops-headline", "classifier-agreement",
    "disclosure-grade-comparisons", "graded-sample", "org-coaching", "spend-per-delivery",
    "department-evidence", "department-fix-pack", "monthly-department-decision",
    "disclosure-spend-and-recovery", "disclosure-department-priority", "disclosure-spend-mix",
    "disclosure-savings-portfolio", "disclosure-recommendation-evidence", "finops-privacy",
  ];
  const main = byId(document, "main-content");
  const top = [...main.children].filter((node) => node.nodeType === 1 && node.id)
    .map((node) => node.id);
  assert.deepEqual(top, existing,
    "this change reorders and adds entry points; it must not add or drop a top-level region");
  for (const id of existing) {
    const region = byId(document, id);
    assert.ok(region.children.filter((node) => node.nodeType === 1).length > 0,
      `${id} is on the page but its content is gone`);
  }
  // …and the answer block did not become one of them: it is content inside the
  // one region the answer spine allows to be the headline.
  assert.ok(!top.includes(ANSWER_BLOCK_IDS.block));
  assert.equal(byId(document, ANSWER_BLOCK_IDS.block).closest("section").id, "finops-stand");
});
