// How complete an imported brief is: the score, its reproducibility, and the
// surface that shows it.
//
// What is pinned here is the scoring rule, not an object shape:
//
//   1. The scale is stated, not implied. The seven weights sum to the maximum
//      and the tier thresholds are read off the same table the page reads, so a
//      weight changed without a threshold changed fails here.
//   2. A real import through the REAL path scores to an expected tier and an
//      expected verdict for every slot — both written out below rather than
//      recomputed from the scorer, which is what makes the assertion able to
//      fail for a broken scorer.
//   3. The same fixture scores identically twice, over two independent
//      import-and-score runs, asserted by deep equality on the serialized
//      verdict. The scorer reads no clock, no storage and no randomness, so
//      anything else is a defect.
//   4. A degraded export drops a tier, names what it fell back to, and the
//      prioritized next action is the highest-weight missing slot — not the
//      first one in object order.
//   5. Nothing out of the export reaches a reason unescaped or untruncated.
//
// The example dataset is the checked-in provider export: `exampleDatasetFiles`
// emits the raw v1 provider and HRIS documents and `loadExampleDatasetInputs`
// puts them through `parseLocalFinopsFile`, which is the same translator the
// file input uses. Scoring runs on the envelope `normalizeLocalFinopsHistory`
// publishes from those parsed inputs — no bypass branch.
//
// Assertions are on counts, attributes and text content. The harness reads text
// through collapsed containers, so "the tier is not hidden behind the
// disclosure" is held on the element's ancestry rather than on visibility.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHtml, pressEnter } from "./support/browser.js";
import { loadExampleDatasetInputs } from "../src/example-dataset.js";
import { normalizeLocalFinopsHistory } from "../src/local-finops.js";
import { periodMovement } from "../src/finops-imported-period-series.js";
import {
  COMPLETENESS_TIER, MAX_COMPLETENESS_TOTAL, MAX_QUOTE_CHARS, NOTHING_MISSING, SLOT_INSTRUCTIONS,
  SLOT_ORDER, SLOT_WEIGHTS, TIER_THRESHOLDS, quoteFromExport, scoreBriefCompleteness,
} from "../src/finops-brief-completeness.js";
import {
  applyBriefCompleteness, clearBriefCompleteness,
} from "../src/finops-brief-completeness-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const pageEntry = await readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8");

/** One import through the real path: raw fixture bytes, translator, analysis. */
const importedAnalysis = () => normalizeLocalFinopsHistory(loadExampleDatasetInputs());

const slotOf = (score, id) => score.slots.find((slot) => slot.id === id);

/**
 * A complete month with both figures but nothing grouped: no department, no
 * ranked action, no drill-down row, and one period so no movement.
 */
const degradedAnalysis = {
  period: "2026-01-01 to 2026-02-01",
  currency: "USD",
  spendUsd: 240_000,
  recoverableUsd: 36_000,
  rankedDepartments: [],
  action: "",
  history: {
    state: "available",
    periods: [
      { period: "2026-01", spendUsd: 240_000, recoverableUsd: 36_000, completeness: "complete" },
    ],
  },
};

// --- 1. the scale itself ----------------------------------------------------

test("every scored slot carries a weight and an instruction, and the weights are the scale", () => {
  assert.equal(SLOT_ORDER.length, 7, "five headline slots, movement, drill-down");
  assert.equal(new Set(SLOT_ORDER).size, 7, "a slot is declared once");
  const summed = SLOT_ORDER.reduce((total, id) => total + SLOT_WEIGHTS[id], 0);
  assert.equal(summed, MAX_COMPLETENESS_TOTAL,
    "the maximum must be the sum of the weights, so a threshold in points is readable");
  assert.equal(MAX_COMPLETENESS_TOTAL, 100, "the thresholds below are stated on a 100-point scale");
  for (const id of SLOT_ORDER) {
    assert.ok(Number.isInteger(SLOT_WEIGHTS[id]) && SLOT_WEIGHTS[id] > 0,
      `${id} ships without a real weight`);
    assert.ok(SLOT_INSTRUCTIONS[id]?.trim().length > 0,
      `${id} ships without an instruction for satisfying it`);
  }
  // The assumption behind the ordering, asserted rather than only written down:
  // a missing headline figure costs more than a missing drill-down, because the
  // rows justify the figure rather than replace it.
  assert.ok(SLOT_WEIGHTS.recoverable_spend > SLOT_WEIGHTS.drill_down);
  assert.ok(SLOT_WEIGHTS.top_department > SLOT_WEIGHTS.drill_down);
  assert.ok(SLOT_WEIGHTS.confidence_tier < SLOT_WEIGHTS.peer_position,
    "the tier restates the slots above it, so it may not outweigh a fact of its own");
});

test("the tier table is ordered, and complete is the whole scale rather than a rounding", () => {
  const mins = TIER_THRESHOLDS.map((entry) => entry.min);
  assert.deepEqual(mins, [...mins].sort((left, right) => right - left),
    "thresholds must be read highest-first for the first-match rule to hold");
  assert.equal(TIER_THRESHOLDS[0].tier, COMPLETENESS_TIER.complete);
  assert.equal(TIER_THRESHOLDS[0].min, MAX_COMPLETENESS_TOTAL,
    "a brief with a fallback in it may not read complete");
  assert.equal(TIER_THRESHOLDS.at(-1).min, 0, "every total lands in a tier");
});

// --- 2. the checked-in export, scored ---------------------------------------

test("the checked-in provider export scores complete, with every slot verdict named", () => {
  const score = scoreBriefCompleteness(importedAnalysis());

  // Written out, not recomputed: a scorer that satisfied nothing would still
  // agree with itself, so the expected verdicts are typed here.
  assert.deepEqual(score.slots.map((slot) => [slot.id, slot.satisfied, slot.weight]), [
    ["recoverable_spend", true, 25],
    ["peer_position", true, 10],
    ["top_department", true, 20],
    ["rank_1_action", true, 15],
    ["confidence_tier", true, 5],
    ["trend_movement", true, 15],
    ["drill_down", true, 10],
  ]);
  assert.equal(score.total, 100);
  assert.equal(score.maxTotal, 100);
  assert.equal(score.satisfiedCount, 7);
  assert.equal(score.slotCount, 7);
  assert.equal(score.tier, COMPLETENESS_TIER.complete);
  assert.equal(score.available, true);
  // Nothing missing is a value, not an absence.
  assert.equal(score.nextAction.slot, NOTHING_MISSING);
  assert.equal(score.nextAction.nothingMissing, true);
  assert.ok(score.nextAction.instruction.length > 0);
  // And the two slots this module scores itself say what they read.
  assert.match(slotOf(score, "trend_movement").reason,
    /2026-06 against 2026-05, over 6 imported periods/);
  assert.match(slotOf(score, "drill_down").reason, /5 ranked department rows, led by/);
});

test("the movement slot is scored from the page's own summary, never from a placeholder", () => {
  const analysis = importedAnalysis();
  // The shape the page hands in, from the derivation that owns it.
  const real = scoreBriefCompleteness(analysis,
    { movement: periodMovement(analysis.history.periods) });
  assert.equal(slotOf(real, "trend_movement").satisfied, true);

  // The same fields, without the derivation's version stamp: a hand-made object
  // that looks complete is not a comparison of imported periods.
  const placebo = scoreBriefCompleteness(analysis, {
    movement: { available: true, periodCount: 9, latestPeriod: "2026-06", priorPeriod: "2026-05" },
  });
  const slot = slotOf(placebo, "trend_movement");
  assert.equal(slot.satisfied, false);
  assert.match(slot.reason, /no period series was derived/);
  assert.equal(placebo.total, 100 - SLOT_WEIGHTS.trend_movement);
  assert.equal(placebo.tier, COMPLETENESS_TIER.substantial);
});

// --- 3. reproducibility -----------------------------------------------------

test("two independent import-and-score runs produce a byte-identical verdict", () => {
  const first = scoreBriefCompleteness(importedAnalysis());
  const second = scoreBriefCompleteness(importedAnalysis());
  assert.deepEqual(JSON.parse(JSON.stringify(second)), JSON.parse(JSON.stringify(first)),
    "the same export scored differently twice");
  assert.equal(JSON.stringify(second), JSON.stringify(first),
    "the serialized verdict must be identical, key order included");
  assert.equal(second.tier, first.tier);
  for (const slot of first.slots) {
    const other = slotOf(second, slot.id);
    assert.equal(other.satisfied, slot.satisfied, `${slot.id} flipped between runs`);
    assert.equal(other.reason, slot.reason, `${slot.id}'s reason changed between runs`);
  }
});

// --- 4. a degraded export ---------------------------------------------------

test("a degraded export drops a tier, states its fallbacks, and names the costliest gap", () => {
  const score = scoreBriefCompleteness(degradedAnalysis);

  assert.deepEqual(score.slots.map((slot) => [slot.id, slot.satisfied]), [
    ["recoverable_spend", true],
    ["peer_position", true],
    ["top_department", false],
    ["rank_1_action", false],
    ["confidence_tier", true],
    ["trend_movement", false],
    ["drill_down", false],
  ]);
  assert.equal(score.total, 40);
  assert.equal(score.satisfiedCount, 3);
  assert.equal(score.tier, COMPLETENESS_TIER.partial);
  assert.notEqual(score.tier, COMPLETENESS_TIER.complete);

  // Every fallen slot says what it fell back TO, not only that it fell.
  assert.match(slotOf(score, "top_department").reason,
    /Fell back to the headline contract's own sentence: No grouping column/);
  assert.match(slotOf(score, "rank_1_action").reason,
    /Fell back to the headline contract's own sentence: No line item/);
  assert.match(slotOf(score, "trend_movement").reason,
    /Fell back to a single named period, 2026-01/);
  assert.match(slotOf(score, "drill_down").reason, /Fell back to the empty-evidence sentence/);

  // The prioritized action is the heaviest missing slot — 20 points — and not
  // the first missing one in reading order, which would be rank_1_action's 15
  // only if weight were ignored.
  assert.equal(score.nextAction.slot, "top_department");
  assert.equal(score.nextAction.weight, 20);
  assert.equal(score.nextAction.nothingMissing, false);
  assert.equal(score.nextAction.instruction, SLOT_INSTRUCTIONS.top_department);
});

test("equal-weight gaps break on the declared slot order rather than on key order", () => {
  // Movement and the ranked action are both worth 15. With the department
  // missing too the heavier gap wins; with only these two missing, the declared
  // order decides, and rank_1_action is declared before trend_movement.
  const score = scoreBriefCompleteness({
    ...degradedAnalysis,
    rankedDepartments: [
      { id: "unit-a", name: "Platform", spendUsd: 120_000, recoverableUsd: 21_000 },
    ],
  });
  assert.equal(slotOf(score, "top_department").satisfied, true);
  assert.equal(slotOf(score, "rank_1_action").satisfied, false);
  assert.equal(slotOf(score, "trend_movement").satisfied, false);
  assert.equal(score.nextAction.slot, "rank_1_action");
  assert.equal(score.nextAction.weight, SLOT_WEIGHTS.trend_movement,
    "the tie is between two 15-point slots, so the order broke it and not the weight");
});

test("no analysis is a state with no tier, not a zero anybody could quote", () => {
  const score = scoreBriefCompleteness(null);
  assert.equal(score.available, false);
  assert.equal(score.tier, null);
  assert.equal(score.slotCount, 7, "the slots are still enumerated, so nothing is silently dropped");
  assert.equal(score.satisfiedCount, 0);
  assert.equal(score.nextAction.slot, "recoverable_spend",
    "with nothing read, the costliest gap is the money figure itself");
});

// --- 5. untrusted export content --------------------------------------------

test("anything quoted out of an export is stripped of markup and truncated", () => {
  const hostile = `<img src=x onerror="boom()"> ${"A".repeat(400)}`;
  const score = scoreBriefCompleteness({
    ...degradedAnalysis,
    rankedDepartments: [{ id: "u", name: hostile, spendUsd: 1_000, recoverableUsd: 500 }],
  });
  for (const slot of score.slots) {
    // The authored half of a reason has apostrophes in it; what may never
    // survive is a character a tag or an entity is built out of.
    assert.doesNotMatch(slot.reason, /[<>`]/, `${slot.id}'s reason carries markup characters`);
    assert.ok(slot.reason.length < 400, `${slot.id}'s reason passed the export through whole`);
  }
  assert.match(slotOf(score, "drill_down").reason, /…/, "a long quote must be truncated");
  // What is left of the hostile name is inert text: no tag can be reassembled
  // out of it, and the page paints it with textContent besides.
  assert.match(slotOf(score, "top_department").reason, /img src=x onerror=boom\(\)/);
  // The guard itself: collapsed, stripped of every character markup is made of,
  // and never longer than the stated maximum.
  assert.equal(quoteFromExport("  a\n<b>& 'c'  "), "a b c");
  assert.equal(quoteFromExport(null), "");
  assert.equal(quoteFromExport("B".repeat(500)).length, MAX_QUOTE_CHARS);
});

// --- 6. the rendered surface ------------------------------------------------

test("the shipped page shows the tier, the next action, and one row per slot", () => {
  const document = parseHtml(html);
  const painted = applyBriefCompleteness(document, importedAnalysis());
  const region = document.getElementById("finops-brief-completeness");
  assert.equal(region.hidden, false);
  assert.equal(region.dataset.state, "imported");
  assert.equal(region.dataset.tier, COMPLETENESS_TIER.complete);
  assert.equal(region.dataset.total, "100");
  assert.match(document.getElementById("finops-brief-completeness-tier").textContent,
    /Brief completeness: complete — 100 of 100 points, 7 of 7 slots earned/);
  assert.match(document.getElementById("finops-brief-completeness-next").textContent,
    /Nothing missing/);
  const rows = document.querySelectorAll("dd.completeness-slot");
  assert.equal(rows.length, 7);
  assert.deepEqual([...rows].map((row) => row.dataset.slot), [...SLOT_ORDER]);
  assert.equal([...rows].filter((row) => row.dataset.satisfied === "true").length, 7);
  assert.equal(document.getElementById("finops-brief-completeness-count").textContent,
    "all 7 earned");
  assert.equal(painted.tier, COMPLETENESS_TIER.complete);
});

test("a degraded import paints the dropped tier and the one gap worth fixing first", () => {
  const document = parseHtml(html);
  applyBriefCompleteness(document, degradedAnalysis);
  const region = document.getElementById("finops-brief-completeness");
  assert.equal(region.dataset.tier, COMPLETENESS_TIER.partial);
  assert.equal(region.dataset.total, "40");
  const next = document.getElementById("finops-brief-completeness-next").textContent;
  assert.match(next, /Highest-value gap \(20 points\)/);
  assert.ok(next.includes(SLOT_INSTRUCTIONS.top_department),
    "the next action must carry the instruction for satisfying it");
  const rows = document.querySelectorAll("dd.completeness-slot");
  assert.equal([...rows].filter((row) => row.dataset.satisfied === "false").length, 4);
  assert.equal(document.getElementById("finops-brief-completeness-count").textContent,
    "4 of 7 fell back");
  // The state is in the word as well as in the attribute, never in colour alone.
  assert.equal(document.querySelectorAll("span.completeness-verdict")
    .filter((node) => node.textContent === "Fell back").length, 4);
});

test("the tier and the next action are outside the disclosure, which is keyboard operable", () => {
  const document = parseHtml(html);
  applyBriefCompleteness(document, degradedAnalysis);
  // Collapsing a region hides it from assistive tech, so neither line a reader
  // came for may sit inside one. The harness reads text through a closed
  // details element, so this is held on the ancestry rather than on text.
  for (const id of ["finops-brief-completeness-tier", "finops-brief-completeness-next"]) {
    assert.ok(!document.getElementById(id).closest("details"),
      `${id} is inside a disclosure a reader has to open`);
  }
  const details = document.getElementById("finops-brief-completeness-detail");
  const summary = document.getElementById("finops-brief-completeness-summary");
  assert.ok(document.getElementById("finops-brief-completeness-slots").closest("details"),
    "the slot-by-slot working belongs behind the control");
  assert.equal(details.dataset.disclosure, "collapsed");
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  summary.focus();
  pressEnter(document);
  assert.equal(details.hasAttribute("open"), true, "Enter did not open the disclosure");
  assert.equal(details.dataset.disclosure, "expanded");
  assert.equal(summary.getAttribute("aria-expanded"), "true",
    "the summary's expanded state was not mirrored");
});

test("clearing the import takes the block off screen and leaves no stale row", () => {
  const document = parseHtml(html);
  applyBriefCompleteness(document, importedAnalysis());
  clearBriefCompleteness(document);
  const region = document.getElementById("finops-brief-completeness");
  assert.equal(region.hidden, true);
  assert.equal(region.dataset.state, "unavailable");
  assert.equal(document.querySelectorAll("dd.completeness-slot").length, 0);
  assert.equal(document.getElementById("finops-brief-completeness-tier").textContent, "");
  assert.equal(document.getElementById("finops-brief-completeness-next").textContent, "");
  assert.equal(document.getElementById("finops-brief-completeness-count").textContent,
    "not analyzed");
});

test("the example headline's own nodes are untouched, and the example is not scored", () => {
  const document = parseHtml(html);
  const before = document.getElementById("finops-stand-answer").textContent;
  applyBriefCompleteness(document, importedAnalysis());
  assert.equal(document.getElementById("finops-stand-answer").textContent, before);
  const score = applyBriefCompleteness(document, null);
  assert.equal(score.available, false);
  assert.equal(document.getElementById("finops-brief-completeness").hidden, true);
});

// --- 7. the wiring ----------------------------------------------------------

test("the page entry scores every import and clears the block with the import", () => {
  assert.match(pageEntry, /from "\/finops-brief-completeness-view\.js"/,
    "the page does not import the completeness view");
  assert.match(pageEntry, /applyBriefCompleteness\(document, example \? null : next,/,
    "the result render does not score the imported analysis");
  assert.match(pageEntry, /movement: example \? null : movement\.movement/,
    "the score must read the movement summary the page already painted");
  assert.match(pageEntry, /clearBriefCompleteness\(document\);/,
    "a clear leaves the completeness tier standing over a file nobody loaded");
});
