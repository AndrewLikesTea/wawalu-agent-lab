// One derivation, every dollar figure on both FinOps pages (#1184).
//
// WHAT THIS SUITE OWNS. `bundledRecoverableAnswer()` in src/finops-first-run.js
// computes the whole answer set — total annual spend, the recoverable amount,
// the destination carrying most of it, and the coverage behind the confidence
// statement — out of the bundled scored dataset. These assertions are that both
// surfaces STATE that computation and hold no copy of it:
//
//   1. Neither document authors a currency figure in the region that carries
//      the answer. A literal left behind is what the issue is about.
//   2. The served /evolution.html — the seeded document a visitor is actually
//      handed — carries the derivation's own formatted strings.
//   3. The painted /savings-action-center.html carries the same two figures.
//
// NOTHING IS COMPARED AGAINST A LITERAL. Every expected string is read off the
// function under test, so relocating the hardcoding into this file would not
// make it pass: the load-bearing check at the end drives the same paint from a
// dataset neither page has ever seen and asserts every rendered figure moved
// with it.
//
// No clock, no network, no storage: the derivation reads one bundled fixture.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import { firstScreenEdits, loadBundledSeed, seedDocument } from "../scripts/seed-first-screen.mjs";
import { ANNUAL_MONTHS, bundledRecoverableAnswer } from "../src/finops-first-run.js";
import {
  applyRecoverableAnswer, RECOVERABLE_ANSWER_IDS,
} from "../src/finops-first-run-view.js";

const EVOLUTION = new URL("../src/evolution.html", import.meta.url);
const ACTION_CENTER = new URL("../src/savings-action-center.html", import.meta.url);

const evolutionSource = await readFile(EVOLUTION, "utf8");
const actionCenterSource = await readFile(ACTION_CENTER, "utf8");
const seededEvolution = seedDocument(evolutionSource, firstScreenEdits(await loadBundledSeed()));

const ANSWER = bundledRecoverableAnswer();

/** A currency amount as either document would have to author one. */
const CURRENCY = /\$[\d,]+/;

// ---------------------------------------------------------------------------
// 1. The derivation itself.
// ---------------------------------------------------------------------------

test("the answer set is derived from the bundled scored dataset, whole", () => {
  assert.equal(ANSWER.available, true, "the bundled scored dataset produced no answer");
  assert.equal(ANSWER.annualSpendUsd, ANSWER.monthly.spendUsd * ANNUAL_MONTHS);
  assert.equal(ANSWER.annualRecoverableUsd, ANSWER.monthly.recoverableUsd * ANNUAL_MONTHS);
  assert.ok(ANSWER.annualRecoverableUsd < ANSWER.annualSpendUsd,
    "a recoverable amount larger than the spend it is a share of is not a share");
  assert.match(ANSWER.recoverableAnnual, /^\$[\d,]+$/);
  assert.match(ANSWER.totalAnnualSpend, /^\$[\d,]+$/);
  // The destination, and the coverage the confidence statement rests on.
  assert.ok(ANSWER.destination?.name, "no destination carries the recoverable amount");
  assert.match(ANSWER.destination.label, new RegExp(ANSWER.destination.name));
  assert.ok(ANSWER.coverage.scoredUsd <= ANSWER.coverage.inScopeUsd);
  assert.ok(ANSWER.confidence.includes(ANSWER.coverage.scored),
    "the confidence statement does not carry the coverage behind it");
  // And the working, so a reader can check the figure by hand.
  for (const part of [ANSWER.recoverableAnnual, ANSWER.totalAnnualSpend, ANSWER.monthly.recoverable,
    ANSWER.sharePercent, ANSWER.destination.amount]) {
    assert.ok(ANSWER.basis.includes(part), `the basis omits ${part}`);
  }
});

test("an unreadable dataset withholds every figure rather than zeroing one", () => {
  const withheld = bundledRecoverableAnswer(() => {
    throw new Error("bundled dataset unreadable");
  });
  assert.equal(withheld.available, false);
  assert.equal(withheld.destination, null);
  assert.doesNotMatch(withheld.recoverableAnnual, CURRENCY);
  assert.doesNotMatch(withheld.totalAnnualSpend, CURRENCY);
  assert.doesNotMatch(withheld.basis, CURRENCY, "a withheld answer states an amount anyway");
});

// ---------------------------------------------------------------------------
// 2. Neither document authors a figure of its own.
// ---------------------------------------------------------------------------

test("no currency figure is authored in either page's answer slots", () => {
  const authored = parseHtml(evolutionSource);
  const centre = parseHtml(actionCenterSource);
  for (const id of Object.values(RECOVERABLE_ANSWER_IDS)) {
    const node = authored.getElementById(id);
    if (node) {
      assert.doesNotMatch(textOf(node), CURRENCY,
        `#${id} authors a currency figure in src/evolution.html`);
    }
    const slot = centre.getElementById(id);
    if (slot) {
      assert.doesNotMatch(textOf(slot), CURRENCY,
        `#${id} authors a currency figure in src/savings-action-center.html`);
    }
  }
  // The two slots the action center does author are the two it paints, and they
  // ship empty rather than holding a stale figure.
  for (const id of [RECOVERABLE_ANSWER_IDS.value, RECOVERABLE_ANSWER_IDS.total]) {
    assert.equal(textOf(centre.getElementById(id)), "",
      `#${id} ships with something in it on the action center`);
  }
  // And the old hand-maintained arithmetic is gone from the document entirely.
  assert.equal(evolutionSource.includes("5,200 x 12 = 62,400"), false,
    "the hand-worked derivation survived in the markup");
  assert.equal(evolutionSource.includes("$62,400"), false,
    "the previous headline figure survived as a literal");
});

// ---------------------------------------------------------------------------
// 3. What each page actually renders equals what the derivation computed.
// ---------------------------------------------------------------------------

test("the served evolution page renders the derivation's figures, not a copy", () => {
  const served = parseHtml(seededEvolution);
  assert.equal(textOf(served.getElementById(RECOVERABLE_ANSWER_IDS.value)),
    ANSWER.recoverableAnnual, "the served recoverable figure is not the derivation's");
  assert.equal(textOf(served.getElementById(RECOVERABLE_ANSWER_IDS.confidence)),
    ANSWER.confidence);
  assert.equal(textOf(served.getElementById(RECOVERABLE_ANSWER_IDS.basis)), ANSWER.basis);
  assert.equal(textOf(served.getElementById(RECOVERABLE_ANSWER_IDS.action)),
    ANSWER.destination.label);
  // The total annual spend is stated in the basis, which is where the arithmetic
  // that produced the figure above it belongs.
  assert.ok(textOf(served.getElementById(RECOVERABLE_ANSWER_IDS.basis))
    .includes(ANSWER.totalAnnualSpend), "the served page states no total annual spend");
});

test("the painted pages render the derivation's figures on both surfaces", () => {
  for (const source of [evolutionSource, actionCenterSource]) {
    const document = parseHtml(source);
    const written = applyRecoverableAnswer(document);
    assert.ok(written.includes(RECOVERABLE_ANSWER_IDS.value),
      "a FinOps page painted no recoverable figure");
    assert.equal(textOf(document.getElementById(RECOVERABLE_ANSWER_IDS.value)),
      ANSWER.recoverableAnnual);
  }
  // The action center's own total slot, which /evolution.html states in prose.
  const centre = parseHtml(actionCenterSource);
  applyRecoverableAnswer(centre);
  assert.equal(textOf(centre.getElementById(RECOVERABLE_ANSWER_IDS.total)),
    ANSWER.totalAnnualSpend);
  assert.equal(textOf(centre.getElementById(RECOVERABLE_ANSWER_IDS.value)),
    ANSWER.recoverableAnnual);
});

test("the seeded document and the paint state the same answer", () => {
  const served = parseHtml(seededEvolution);
  const painted = parseHtml(seededEvolution);
  applyRecoverableAnswer(painted);
  for (const id of Object.values(RECOVERABLE_ANSWER_IDS)) {
    if (!served.getElementById(id)) continue;
    assert.equal(textOf(served.getElementById(id)), textOf(painted.getElementById(id)),
      `#${id} drifted between the seed and the paint`);
  }
});

// ---------------------------------------------------------------------------
// 4. The load-bearing check: a dataset neither page has seen moves every figure.
// ---------------------------------------------------------------------------

test("a moved dataset moves every rendered figure on both pages", () => {
  // Invented here rather than committed, and deliberately nothing like the
  // bundled one: a rendered figure that survives this is a figure the page is
  // holding rather than computing.
  const moved = () => ({
    period: "2027-01-01 to 2027-02-01",
    spendUsd: 200_000,
    recoverableUsd: 40_000,
    rankedDepartments: [
      { name: "Tin Foundry", spendUsd: 150_000, recoverableUsd: 30_000 },
      { name: "Rill Data", spendUsd: 50_000, recoverableUsd: 10_000 },
    ],
  });
  const grade = () => ({ coveredUsd: 120_000, totalUsd: 200_000, tier: "provisional" });
  const answer = bundledRecoverableAnswer(moved, grade);

  assert.equal(answer.available, true);
  assert.notEqual(answer.recoverableAnnual, ANSWER.recoverableAnnual, "the fixture did not move");
  assert.equal(answer.destination.name, "Tin Foundry");

  for (const source of [evolutionSource, actionCenterSource]) {
    const document = parseHtml(source);
    applyRecoverableAnswer(document, answer);
    const value = textOf(document.getElementById(RECOVERABLE_ANSWER_IDS.value));
    assert.equal(value, answer.recoverableAnnual);
    assert.doesNotMatch(value, new RegExp(ANSWER.recoverableAnnual.replace(/\$/g, "\\$")),
      "the shipped figure survived a dataset that does not produce it");
  }
  const centre = parseHtml(actionCenterSource);
  applyRecoverableAnswer(centre, answer);
  assert.equal(textOf(centre.getElementById(RECOVERABLE_ANSWER_IDS.total)),
    answer.totalAnnualSpend);
});
