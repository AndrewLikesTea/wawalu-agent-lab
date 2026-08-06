// Every dollar figure in the AI FinOps answer traces to one derivation (#1184).
//
// WHAT THIS SUITE OWNS. #1183 shipped the answer region with its money authored
// into the markup three times over — the value slot, the basis under the
// disclosure, and the arithmetic in a comment — and none of the three came from
// the bundled analysis the page scores. This file holds the region to one
// source: `recoverableAnswer()` in src/finops-stand.js.
//
// HOW IT AVOIDS MOVING THE HARDCODING INTO THE TEST. Not one assertion below
// compares a rendered figure against a dollar string typed here. Every one
// compares it against what the derivation returns, and the drift test seeds the
// document a second time from a MOVED dataset and requires every occurrence to
// have moved with it. A literal reintroduced into the markup would survive the
// equality tests only by accident and cannot survive that one.
//
// The two harness rules this page has burned people on are respected: nothing
// is compared against null (that walks the whole parsed document), and no
// selector uses descendant form — ancestry is walked through parentNode.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import { firstScreenEdits, loadBundledSeed, seedDocument } from "../scripts/seed-first-screen.mjs";
import { ANNUALIZATION_MONTHS, RECOVERABLE_ANSWER_VERSION, recoverableAnswer }
  from "../src/finops-stand.js";
import { loadExampleDataset } from "../src/example-dataset.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const ACTION_CENTER = new URL("../src/savings-action-center.html", import.meta.url);
const SOURCE = await readFile(PAGE, "utf8");
const ACTION_CENTER_SOURCE = await readFile(ACTION_CENTER, "utf8");
const BUNDLED = await loadBundledSeed();

/** The document the build serves, from the answer this derivation produced. */
const servedWith = (answer) => parseHtml(seedDocument(SOURCE, firstScreenEdits(BUNDLED, answer)));

const REGION_ID = "finops-recoverable-answer";

/** Every node inside a region, without a descendant selector. */
const within = (document, regionId, node) => {
  const region = document.getElementById(regionId);
  for (let walk = node; walk; walk = walk.parentNode) if (walk === region) return true;
  return false;
};

/** The nearest ancestor with this tag name, or null. Walked, never selected. */
const closestTag = (node, tagName) => {
  for (let walk = node?.parentNode; walk; walk = walk.parentNode) {
    if (walk.tagName === tagName) return walk;
  }
  return null;
};

/** Every currency figure in a piece of rendered text, in order. */
const figuresIn = (text) => text.match(/\$[\d,]+(?:\.\d+)?/g) ?? [];

// ---------------------------------------------------------------------------
// The derivation itself: no DOM, no dataset file, no clock.
// ---------------------------------------------------------------------------

test("the derivation answers the region's question from the bundled analysis alone", () => {
  const answer = recoverableAnswer();
  const analysis = loadExampleDataset();

  assert.equal(answer.version, RECOVERABLE_ANSWER_VERSION);
  assert.equal(answer.available, true);
  // Every figure the region publishes is the analysis's own, annualized once.
  assert.equal(answer.spend.monthlyUsd, analysis.spendUsd);
  assert.equal(answer.recoverable.monthlyUsd, analysis.recoverableUsd);
  assert.equal(answer.spend.annualUsd, analysis.spendUsd * ANNUALIZATION_MONTHS);
  assert.equal(answer.recoverable.annualUsd, analysis.recoverableUsd * ANNUALIZATION_MONTHS);
  // The top destination is an identifier plus its own recoverable amount, so a
  // reader can go and check the department rather than trusting the name.
  assert.equal(answer.destination.id, analysis.topDepartment.id);
  assert.equal(answer.destination.label, analysis.topDepartment.name);
  assert.equal(answer.destination.monthlyUsd, analysis.topDepartment.recoverableUsd);
  assert.equal(answer.destination.annualUsd,
    analysis.topDepartment.recoverableUsd * ANNUALIZATION_MONTHS);
  // The coverage behind the confidence qualifier, carried rather than asserted.
  assert.equal(answer.coverage.scopeUsd, analysis.spendUsd);
  assert.ok(answer.coverage.scoredUsd > 0 && answer.coverage.scoredUsd <= answer.coverage.scopeUsd);
  assert.equal(typeof answer.coverage.tier, "string");
  // A recoverable ceiling can never exceed the spend it is taken out of.
  assert.ok(answer.recoverable.annualUsd <= answer.spend.annualUsd);
  assert.ok(answer.destination.annualUsd <= answer.recoverable.annualUsd);
});

test("the derivation withholds every figure when the dataset cannot be read", () => {
  const answer = recoverableAnswer(() => { throw new Error("unreadable"); });
  assert.equal(answer.available, false);
  assert.equal(answer.recoverable.text, null);
  assert.equal(answer.spend.text, null);
  assert.equal(answer.destination.available, false);
  assert.equal(answer.action, null);
  assert.equal(typeof answer.withheld, "string");
  // A withheld answer states a reason, never a zero dressed as an answer.
  assert.deepEqual(figuresIn(answer.withheld), []);
});

test("one formatter: every published figure is whole dollars from the same rounding", () => {
  const answer = recoverableAnswer();
  for (const text of [answer.spend.text, answer.recoverable.text, answer.destination.text]) {
    assert.match(text, /^\$[\d,]+$/, `${text} is not this page's currency format`);
  }
  assert.match(answer.recoverable.shareText, /^\d+%$/);
});

// ---------------------------------------------------------------------------
// The rendered page. Compared against the derivation, never against a literal.
// ---------------------------------------------------------------------------

test("every figure the answer region renders is the derivation's own", () => {
  const answer = recoverableAnswer();
  const document = servedWith(answer);

  assert.equal(textOf(document.getElementById("finops-recoverable-value")),
    answer.recoverable.text, "the headline figure is not the derived recoverable total");
  assert.equal(textOf(document.getElementById("finops-recoverable-action")), answer.action.label,
    "the first move is not the derived action");
  assert.equal(textOf(document.getElementById("finops-recoverable-basis")), answer.basis,
    "the disclosed arithmetic is not the derived basis");

  // The top destination's own amount, and the annual total the recoverable
  // figure is taken out of, are both stated where they are checkable.
  const basis = textOf(document.getElementById("finops-recoverable-basis"));
  assert.ok(basis.includes(answer.destination.text), "the basis omits the destination figure");
  assert.ok(basis.includes(answer.spend.text), "the basis omits the analyzed annual total");
  assert.ok(textOf(document.getElementById("finops-recoverable-action"))
    .includes(answer.destination.text), "the first move omits what the destination is worth");
});

test("no figure in the region comes from anywhere but the derivation", () => {
  const answer = recoverableAnswer();
  const document = servedWith(answer);
  const derived = new Set([
    answer.spend.text, answer.spend.monthlyText,
    answer.recoverable.text, answer.recoverable.monthlyText,
    answer.destination.text,
    // The coverage sentence is the gradability reader's own, carried whole.
    ...figuresIn(answer.coverage.qualifier),
  ]);
  const rendered = figuresIn(textOf(document.getElementById(REGION_ID)));
  assert.ok(rendered.length >= 4, "the region publishes its figures");
  for (const figure of rendered) {
    assert.equal(derived.has(figure), true,
      `${figure} is rendered in the answer region but no derivation produced it`);
  }
});

test("the authored markup carries no figure of its own", () => {
  const document = parseHtml(SOURCE);
  // The source ships pending wording in the three seeded slots, so a figure in
  // this region can only have arrived from the build's derivation.
  assert.deepEqual(figuresIn(textOf(document.getElementById(REGION_ID))), [],
    "a dollar figure is authored into the answer region again");
  // Attributes too: a title or an aria-label restating the figure is a copy the
  // rendered-text assertions above would never see.
  const region = SOURCE.slice(SOURCE.indexOf(`id="${REGION_ID}"`));
  const markup = region.slice(0, region.indexOf("</section>"));
  assert.deepEqual(markup.match(/(?:aria-label|title)="[^"]*\$[\d,]+/g) ?? [], []);
});

test("changing the dataset changes every occurrence on the page", () => {
  const analysis = loadExampleDataset();
  // The same derivation over a moved dataset — one dollar more of spend and a
  // materially different recoverable line — is what the served document must
  // follow. Nothing here asserts what the moved figures ARE; it asserts that
  // what the page states is what the derivation states, both times.
  const moved = recoverableAnswer(() => ({
    ...analysis,
    spendUsd: analysis.spendUsd * 2,
    recoverableUsd: analysis.recoverableUsd * 3,
    topDepartment: { ...analysis.topDepartment, recoverableUsd: analysis.topDepartment.recoverableUsd * 3 },
  }));
  const before = recoverableAnswer();
  assert.notEqual(moved.recoverable.text, before.recoverable.text, "the derivation did not move");

  const document = servedWith(moved);
  assert.equal(textOf(document.getElementById("finops-recoverable-value")), moved.recoverable.text);
  assert.equal(textOf(document.getElementById("finops-recoverable-action")), moved.action.label);
  assert.equal(textOf(document.getElementById("finops-recoverable-basis")), moved.basis);
  // …and not one occurrence of the figure the shipped dataset produces is left.
  const rendered = textOf(document.getElementById(REGION_ID));
  for (const stale of [before.recoverable.text, before.destination.text, before.spend.text]) {
    assert.equal(rendered.includes(stale), false,
      `${stale} survived a dataset change, so it is authored rather than derived`);
  }
});

// ---------------------------------------------------------------------------
// Where each figure sits. The harness models no layout, so a figure inside a
// shut disclosure has to be asserted to be on a path a reader can open.
// ---------------------------------------------------------------------------

test("the headline figure and the move are outside every disclosure", () => {
  const document = servedWith(recoverableAnswer());
  for (const id of ["finops-recoverable-value", "finops-recoverable-action"]) {
    const node = document.getElementById(id);
    assert.equal(within(document, REGION_ID, node), true, `${id} left the answer region`);
    assert.equal(closestTag(node, "DETAILS"), null,
      `${id} is folded into a disclosure, so a real browser shows nothing`);
    assert.equal(node.hidden, false, `${id} is out of the accessibility tree`);
  }
});

test("the disclosed arithmetic is reachable through its own control", () => {
  const document = servedWith(recoverableAnswer());
  const basis = document.getElementById("finops-recoverable-basis");
  const disclosure = closestTag(basis, "DETAILS");
  // It is inside a disclosure on purpose — a second figure beside the headline
  // hands the ranking decision back to the reader — so what has to hold is that
  // the disclosure is present, not hidden, and opened by its own summary.
  assert.equal(disclosure?.id, "finops-recoverable-how-we-know");
  assert.equal(disclosure.hidden, false);
  assert.equal(within(document, REGION_ID, disclosure), true);
  const summaries = [...disclosure.children].filter((child) => child.tagName === "SUMMARY");
  assert.equal(summaries.length, 1, "the disclosure has exactly one control");
  assert.equal(summaries[0].id, "finops-recoverable-how-we-know-summary");
  // Opened, the basis is on the visible path with its figures in it.
  disclosure.setAttribute("open", "");
  assert.equal(disclosure.getAttribute("open"), "");
  assert.ok(figuresIn(textOf(basis)).length >= 3);
});

// ---------------------------------------------------------------------------
// The action center. #1183 made it point at the answer instead of restating it,
// which is the same property this issue is after — one telling — reached by
// deferring rather than by deriving. What is asserted is that it still holds.
// ---------------------------------------------------------------------------

test("the action center restates no figure and points at the derived answer", () => {
  assert.deepEqual(ACTION_CENTER_SOURCE.match(/\$[\d,]+/g) ?? [], [],
    "the action center states a dollar figure of its own again");
  const document = parseHtml(ACTION_CENTER_SOURCE);
  const link = document.getElementById("finops-journey-owner-link");
  assert.equal(link.getAttribute("href"), `/evolution.html#${REGION_ID}`);
  // The region it points at is the one the derivation renders into.
  const served = servedWith(recoverableAnswer());
  assert.equal(textOf(served.getElementById("finops-recoverable-value")),
    recoverableAnswer().recoverable.text);
});
