// Does the briefed recoverable figure still reproduce, and do the surfaces that
// state it still agree with one another?
//
// WHAT A DISPUTING DIRECTOR SHOULD READ, IN ORDER.
//   1. RECORDED_INPUT below — the invented per-department operands, checked in
//      as a literal, with the assumption behind every one of them stated.
//   2. `checkBriefingReproducibility` — one function, returning a result with a
//      `mismatches` array. Every assertion below reads that array. Nothing here
//      relies on a thrown assertion to notice a divergence, which is what lets
//      the drift test in section 4 assert that the check REPORTS a mismatch.
//   3. The failure output. Each mismatch names the surface, the value it
//      states, the value recomputed from the recorded input, and the rule.
//
// THERE IS NO SECOND IMPLEMENTATION OF THE ARITHMETIC HERE. This file sums
// nothing and divides nothing. It calls `getRecoverableSpend` — the canonical
// accessor src/finops-answer-contract.js publishes and that both regions of
// /evolution.html paint from — and `recoverableShare`, which is the ratio
// src/finops-first-run.js divides for the brief. A fixture that re-derived
// $51,254 would only prove that two copies of one formula agree.
//
// NO PROMPT TEXT, NO CUSTOMER DATA, NO NETWORK, NO PROVIDER CALL. The recorded
// input is five invented department rows and two totals. The page is rendered
// against the harness with its two fixture routes stubbed, exactly as the other
// end-to-end suites on this page render it.
//
// HARNESS DISCIPLINE. Every assertion is on a string, a number, or a count.
// None is handed a parsed node: comparing one makes the harness walk the whole
// document to build a diff and outlives the test timeout.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { getRecoverableSpend } from "../src/finops-answer-contract.js";
import { recoverableShare } from "../src/finops-first-run.js";
import {
  BRIEFING_DESTINATION_SLUG, BRIEFING_DESTINATION_URL,
} from "../src/finops-example-briefing.js";
import { fragmentForSlug } from "../src/finops-destination-router.js";
import { currentWorkspaceDestination } from "../src/finops-workspace-shell.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(
  await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));

// ---------------------------------------------------------------------------
// The recorded input
// ---------------------------------------------------------------------------

/**
 * The invented analysis the briefed figure is recomputed from.
 *
 * ASSUMPTIONS THIS RECORD ENCODES, each one a thing a reader may dispute:
 *
 *   · UNITS. `spendUsd` and `recoverableUsd` are whole US dollars and cents as
 *     JavaScript numbers, per department, for ONE calendar month — the window
 *     `period` names, end exclusive. Nothing here is annualised.
 *   · PRECISION. Two rows carry a half dollar. That is deliberate and it is the
 *     load-bearing part of this fixture: the five rows sum to exactly 51,254.00
 *     only because the halves pair off. A check that recorded the five ROUNDED
 *     rows would sum to 51,255 and would then have to explain away a dollar.
 *   · SCORE STATUS. Every row is scored — none carries `scored: false` — so the
 *     figure is a total and not a floor, and no unscored department is
 *     extrapolated to.
 *   · CONFIDENCE. "Medium" is the analysis's OWN published signal, which is what
 *     `getRecoverableSpend` grades the figure by. This file invents no scale.
 *
 * These are the bundled synthetic example's operands as of this revision. If
 * src/evolution-demo-data.json moves, this fixture fails and names the field —
 * which is the point: a pinned input that silently tracked the data it pins
 * would prove nothing.
 */
const RECORDED_INPUT = Object.freeze({
  revision: "finops-briefing-reproducibility/1.0.0",
  period: "2026-06-01 to 2026-07-01",
  confidence: "Medium",
  spendUsd: 154500,
  rankedDepartments: Object.freeze([
    Object.freeze({ name: "Atlas Platform", spendUsd: 79000, recoverableUsd: 32903.5 }),
    Object.freeze({ name: "Cinder Research", spendUsd: 24500, recoverableUsd: 7203 }),
    Object.freeze({ name: "Quartz Analytics", spendUsd: 18000, recoverableUsd: 4410 }),
    Object.freeze({ name: "Boreal Support", spendUsd: 22000, recoverableUsd: 4312 }),
    Object.freeze({ name: "Ember Studio", spendUsd: 11000, recoverableUsd: 2425.5 }),
  ]),
});

/** A deep copy, so a perturbation in one test cannot leak into the next. */
const inputCopy = () => structuredClone(RECORDED_INPUT);

// ---------------------------------------------------------------------------
// The comparison rule, stated once
// ---------------------------------------------------------------------------
//
// WHAT "THE SAME VALUE" MEANS HERE, AND WHY IT IS NOT STRING EQUALITY.
//
// The three surfaces format the same two numbers three different ways, on
// purpose: the brief says "33% of analyzed AI spend is recoverable" and "Up to
// $51,254 …", the answer destination says "$51,254", and the restatement the
// shell carries onto every other destination says "51,254 USD modelled
// recoverable of 154,500 USD analyzed". Comparing formatted strings would fail
// on a comma, a currency symbol, or a leading word, and would say nothing about
// whether the FIGURE moved.
//
// So both sides are normalised to integers before they are compared:
//
//   · MONEY → whole US dollars, as an integer. `getRecoverableSpend` already
//     rounds half up to the whole dollar for publication, so the comparison is
//     exact at the unit the page actually prints. A surface stating cents would
//     be a mismatch, and should be.
//   · SHARE → whole percent, as an integer. The brief prints one whole percent
//     and nothing on the page prints a finer one, so a tenth of a point is
//     below the resolution any surface states; rounding both sides to the
//     integer percent is the honest precision, not a loosened one.
//
// A surface that states no number at all yields `null`, which never equals a
// recomputed integer, so an empty surface is a mismatch rather than a pass.

/** Every whole-dollar amount a surface states, in the order it states them. */
const dollarsIn = (text) => [...String(text ?? "").matchAll(/\$?([\d,]+)(?:\.\d+)?\s*(?:USD)?/g)]
  .map((match) => Number(match[1].replace(/,/g, "")))
  .filter((value) => Number.isFinite(value));

/** The first whole-dollar amount at or above $1,000. Below that is not money here. */
const moneyIn = (text) => dollarsIn(text).find((value) => value >= 1000) ?? null;

/** The first whole percentage a surface states, as an integer. */
function percentIn(text) {
  const match = /(\d+(?:\.\d+)?)\s*%/.exec(String(text ?? ""));
  return match ? Math.round(Number(match[1])) : null;
}

// ---------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------

/**
 * Recompute the briefed figure and compare it against what the surfaces state.
 *
 * Returns a result rather than throwing, so a caller can assert on `ok` in the
 * positive case AND on a reported mismatch in the negative one. A check that
 * could only fail by throwing cannot be shown to be capable of failing.
 *
 * @param input a recorded analysis record, in RECORDED_INPUT's shape.
 * @param surfaces `{ [name]: statedText }` — read from a rendered page.
 * @returns `{ ok, computed, mismatches }`.
 */
export function checkBriefingReproducibility(input, surfaces) {
  // THE PRODUCTION PATH, AND NOTHING BESIDE IT. Both values come from modules
  // /evolution.html paints from; this file neither sums nor divides.
  const recoverable = getRecoverableSpend(input);
  const share = recoverableShare(recoverable.monthly, input?.spendUsd);
  const computed = Object.freeze({
    dollars: recoverable.monthly === null ? null : Math.round(recoverable.monthly),
    percent: share === null ? null : Math.round(share * 100),
    display: recoverable.monthlyDisplay,
    grade: recoverable.confidence.level,
    scoredDepartments: recoverable.scoredDepartments,
    totalDepartments: recoverable.totalDepartments,
  });

  const mismatches = [];
  for (const [name, { text, states }] of Object.entries(surfaces)) {
    for (const unit of states) {
      const stated = unit === "money" ? moneyIn(text) : percentIn(text);
      const expected = unit === "money" ? computed.dollars : computed.percent;
      if (stated === expected) continue;
      mismatches.push(Object.freeze({
        surface: name,
        unit,
        stated,
        expected,
        text: String(text ?? "").slice(0, 160),
      }));
    }
  }
  return Object.freeze({ ok: mismatches.length === 0, computed, mismatches: Object.freeze(mismatches) });
}

/** One reported mismatch as the sentence CI should print. */
const reportOf = (result) => result.mismatches
  .map((m) => `  ${m.surface} states ${m.stated} ${m.unit}; the recorded input recomputes to `
    + `${m.expected}. The surface reads: "${m.text}"`)
  .join("\n");

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

/** Open /evolution.html at one address and let every asynchronous surface settle. */
async function openFinopsPage(hash = "") {
  const page = await loadPage(PAGE, {
    location: { hash },
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  // All three waits, and not just the first. Waiting only on `ready` leaves a
  // paint in flight, which passes locally and reds CI as an unhandled rejection.
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  await waitFor(() => shownText(document, "integration-contract-provenance")
    .startsWith("Gateway completed"), "the static contract gateway to settle");
  await waitFor(() => byId(document, "finops-evaluation-result")
    .getAttribute("aria-busy") === "false", "the evaluation panel to settle");
  return page;
}

/**
 * The three surfaces that state the briefed figure, read from the rendered page.
 *
 * WHICH THREE, AND WHY THESE. The brief is the forwardable artifact; the answer
 * destination is where the emitted URL lands; the workspace restatement is the
 * only statement of this figure that reaches the OTHER destinations — the shell
 * hides it on the answer screen precisely because the answer screen states the
 * figure itself, and reveals it everywhere else. Read on the evidence
 * destination it is therefore the evidence screen's copy of the number.
 *
 * Not asserted from the calculator: each value below is `textContent` off the
 * painted document.
 */
const surfacesOn = (document) => ({
  "the briefing text (share)": {
    text: shownText(document, "finops-first-run-answer"), states: ["percent"],
  },
  "the briefing text (amount)": {
    text: shownText(document, "finops-first-run-answer-detail"), states: ["money"],
  },
  "the answer destination": {
    text: shownText(document, "finops-recoverable-value"), states: ["money"],
  },
  "the answer destination headline": {
    text: shownText(document, "finops-stand-recoverable-value"), states: ["money", "percent"],
  },
});

/** The restatement the shell carries onto every destination that is not the answer. */
const carriedSurface = (document) => ({
  "the evidence destination restatement": {
    text: shownText(document, "finops-workspace-context"), states: ["money"],
  },
});

// ---------------------------------------------------------------------------
// 1. The emitted address is a destination URL from the router
// ---------------------------------------------------------------------------

test("the briefing emits a destination URL built by the FinOps destination router", () => {
  // The fragment is the router's for the answer destination, not a string this
  // page spelled out. Hand-concatenating it is exactly the second source of
  // truth this assertion exists to forbid.
  assert.equal(BRIEFING_DESTINATION_URL,
    `/evolution.html${fragmentForSlug(BRIEFING_DESTINATION_SLUG)}`,
    "the forwarded address is not the router's fragment for its own destination");
  assert.equal(BRIEFING_DESTINATION_SLUG, "answer");
  assert.match(BRIEFING_DESTINATION_URL, /^\/evolution\.html#/,
    "a forwardable address needs a path; a bare fragment only works to whoever is already here");
});

test("the shipped document renders that address beside the briefing hand-off", async () => {
  const page = await openFinopsPage();
  const { document } = page;
  try {
    // Authored, so a recipient can read and copy it before any script runs…
    const source = await readFile(PAGE, "utf8");
    assert.ok(source.includes(`>${BRIEFING_DESTINATION_URL}<`),
      "the authored document does not carry the emitted address as readable text");
    // …and repainted from the module, so the two cannot drift apart.
    assert.equal(shownText(document, "finops-first-run-briefing-url"), BRIEFING_DESTINATION_URL);
    // The control already in the region's focus order carries it too, so the
    // hand-off states its own forwardable destination without becoming a second
    // tab stop on a first screen that has none to spare.
    assert.equal(byId(document, "finops-first-run-briefing")
      .getAttribute("data-figure-destination"), BRIEFING_DESTINATION_URL);
    // And it really is text: the block still holds exactly one anchor.
    const anchors = [...byId(document, "finops-first-run-briefing").parentNode.children]
      .filter((node) => node?.tagName === "A").length;
    assert.equal(anchors, 1, "the hand-off block grew a second focusable control");
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// 2. The figure reproduces, and three surfaces state it
// ---------------------------------------------------------------------------

test("the briefed figure recomputes from the recorded input through the production path", () => {
  const result = checkBriefingReproducibility(inputCopy(), {});
  // ASSUMPTION: whole US dollars for one month, rounded half up once, by
  // `getRecoverableSpend` — not by this file. The five recorded rows sum to
  // 51,254.00 exactly; the pinned integer is that sum, not a re-rounding of it.
  assert.equal(result.computed.dollars, 51254,
    "the recorded operands no longer sum to the briefed monthly figure");
  assert.equal(result.computed.display, "$51,254");
  // ASSUMPTION: the share is the monthly figure over the analyzed spend the
  // same record declares, rounded to the whole percent the brief prints.
  assert.equal(result.computed.percent, 33);
  // ASSUMPTION: the grade is the analysis's own published confidence signal,
  // read through the accessor. No scale is invented here.
  assert.equal(result.computed.grade, "medium");
  // ASSUMPTION: a total, not a floor — every recorded department is scored, so
  // nothing is extrapolated to an unscored one.
  assert.equal(result.computed.scoredDepartments, result.computed.totalDepartments);
  assert.equal(result.computed.totalDepartments, 5);
});

test("the briefing, the answer destination and the evidence destination state one figure", async () => {
  const answerPage = await openFinopsPage(fragmentForSlug(BRIEFING_DESTINATION_SLUG));
  let onAnswer = null;
  let carried = null;
  try {
    // The restatement is hidden on the answer destination by design, so it is
    // read where it is shown: on the evidence screen.
    assert.equal(byId(answerPage.document, "finops-workspace-context").hidden, true,
      "the carried restatement is on screen beside the region it restates");
    onAnswer = surfacesOn(answerPage.document);
  } finally {
    answerPage.restore();
  }
  const evidencePage = await openFinopsPage("#workspace-evidence");
  try {
    assert.equal(currentWorkspaceDestination(evidencePage.document), "evidence");
    carried = carriedSurface(evidencePage.document);
  } finally {
    evidencePage.restore();
  }

  const result = checkBriefingReproducibility(inputCopy(), { ...onAnswer, ...carried });
  assert.equal(result.ok, true, "the surfaces do not all state the recomputed figure:\n"
    + `${reportOf(result)}\n`
    + "  Either the arithmetic changed on purpose — then update RECORDED_INPUT and the\n"
    + "  assumptions above it in the same change — or one surface has drifted from the others.");
  // Five readings across three surfaces, so an empty comparison cannot pass.
  assert.equal(Object.keys({ ...onAnswer, ...carried }).length, 5);
});

// ---------------------------------------------------------------------------
// 3. …and the check can fail. Two ways, one for each side of it.
// ---------------------------------------------------------------------------

test("perturbing one recorded input value is reported as a mismatch", () => {
  const input = inputCopy();
  // One value, one department, one dollar: the smallest change the published
  // whole-dollar figure can register.
  input.rankedDepartments[2].recoverableUsd += 1;
  const stated = { "the briefing text (amount)": { text: "Up to $51,254 …", states: ["money"] } };

  const drifted = checkBriefingReproducibility(input, stated);
  assert.equal(drifted.ok, false, "a moved input left the check reporting agreement");
  assert.equal(drifted.computed.dollars, 51255);
  assert.equal(drifted.mismatches.length, 1);
  assert.equal(drifted.mismatches[0].stated, 51254);
  assert.equal(drifted.mismatches[0].expected, 51255);
  assert.equal(drifted.mismatches[0].unit, "money");
  // …and the unperturbed input over the same stated text agrees, so the
  // assertion above is about the perturbation and not about the wording.
  assert.equal(checkBriefingReproducibility(inputCopy(), stated).ok, true);
});

test("perturbing one surface's stated figure is reported as a mismatch", () => {
  const drifted = checkBriefingReproducibility(inputCopy(), {
    "the answer destination": { text: "$51,254", states: ["money"] },
    "the evidence destination restatement": {
      // One surface left behind on last month's number.
      text: "49,900 USD modelled recoverable of 154,500 USD analyzed", states: ["money"],
    },
  });
  assert.equal(drifted.ok, false, "a surface stating a different figure passed silently");
  assert.equal(drifted.mismatches.length, 1);
  assert.equal(drifted.mismatches[0].surface, "the evidence destination restatement");
  assert.equal(drifted.mismatches[0].stated, 49900);
  assert.equal(drifted.mismatches[0].expected, 51254);
  // A surface that states no figure at all is a mismatch, never a pass.
  const silent = checkBriefingReproducibility(inputCopy(),
    { "a silent surface": { text: "Results will appear here", states: ["money"] } });
  assert.equal(silent.ok, false);
  assert.equal(silent.mismatches[0].stated, null);
});

// ---------------------------------------------------------------------------
// 4. Deep-link truthfulness, end to end
// ---------------------------------------------------------------------------

test("opening the emitted address lands on the destination that states the briefed figure", async () => {
  // The address as a recipient would paste it, split the way a browser splits it.
  const fragment = BRIEFING_DESTINATION_URL.slice(BRIEFING_DESTINATION_URL.indexOf("#"));
  const page = await openFinopsPage(fragment);
  try {
    const { document } = page;
    assert.equal(currentWorkspaceDestination(document), BRIEFING_DESTINATION_SLUG,
      "the forwarded address did not open the destination it names");
    // The destination is on screen, not merely selected.
    assert.equal(byId(document, "finops-recoverable-answer").hidden, false);
    // And it states the figure the briefing states — checked, not assumed.
    const result = checkBriefingReproducibility(inputCopy(), surfacesOn(document));
    assert.equal(result.ok, true,
      `the address opens a destination that states a different figure:\n${reportOf(result)}`);
  } finally {
    page.restore();
  }
});
