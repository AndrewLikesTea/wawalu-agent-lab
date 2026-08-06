// ONE COMPUTED ANSWER, AND NOTHING ON EITHER PAGE MAY RESTATE IT (#1184).
//
// The regression this file exists to fail on: /evolution.html led with a
// hand-authored "$62,400" a year while the panel below it said $51,254 over
// $154,500, and /savings-action-center.html could not check either. Three
// numbers for one quantity, and nothing red.
//
// So no number in this file is a string constant copied off the page. Every
// expectation is computed by `computeRecoverableAnswer` over the bundled scored
// dataset and then asserted against what the documents actually ship. Change the
// dataset and these tests still pass; hand-author a figure into either document
// and they fail.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHtml, textOf } from "./support/browser.js";
import { loadExampleDataset } from "../src/example-dataset.js";
import { RECOVERABLE_ANSWER_UNAVAILABLE, computeRecoverableAnswer } from "../src/finops-spine.js";
import {
  RECOVERABLE_ANSWER, RECOVERABLE_WITHHELD_VALUE, recoverableActionText,
  recoverableConfidenceText, recoverablePointerParts, recoverableValueText,
  renderRecoverableAnswer, renderRecoverablePointer,
} from "../src/finops-recoverable-answer-view.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

/** Every `$1,234`-shaped literal in a slice of markup, in document order. */
const dollarLiterals = (markup) => markup.match(/\$\d[\d,]*/g) ?? [];

/** Collapse whitespace the way `textOf` does, so a built string compares to a rendered one. */
const squash = (text) => text.replace(/\s+/g, " ").trim();

/** The pointer sentence, assembled from the parts the painter puts around the link. */
const pointerSentence = (parts) => squash(parts.before + parts.link + parts.after);

/**
 * The answer region's own markup, by slicing rather than by selector: the
 * harness rejects descendant selectors, and a count has to be taken over the
 * region's authored bytes rather than over what a parser hands back.
 */
function answerRegionMarkup(page) {
  const open = page.indexOf('id="finops-recoverable-answer"');
  assert.ok(open > 0, "the answer region must be in the document");
  const close = page.indexOf("</section>", open);
  assert.ok(close > open, "the answer region must be closed");
  return page.slice(open, close);
}

test("the derivation answers the whole question from the bundled dataset alone", () => {
  const answer = computeRecoverableAnswer(loadExampleDataset());
  assert.equal(answer.available, true);
  assert.equal(answer.unavailableReason, null);

  // Named fields, not a positional tuple, and every money figure carries the
  // string the page prints beside the number the page must not re-round.
  assert.equal(answer.recoverable.annualUsd,
    Math.round(answer.recoverable.periodUsd * answer.annualFactor));
  assert.equal(answer.totalSpend.annualUsd,
    Math.round(answer.totalSpend.periodUsd * answer.annualFactor));
  assert.equal(answer.annualFactor, 12 / answer.period.months);
  assert.match(answer.recoverable.annualDisplay, /^\$[\d,]+$/);
  assert.match(answer.totalSpend.annualDisplay, /^\$[\d,]+$/);
  assert.ok(answer.topDestination.name.length > 0);
  assert.ok(answer.topDestination.move.includes(answer.topDestination.name));

  // The coverage inputs behind the confidence statement, from the same object.
  assert.equal(answer.coverage.analyzedSpendUsd, answer.totalSpend.periodUsd);
  assert.ok(answer.coverage.scoredSpendUsd <= answer.coverage.analyzedSpendUsd);
  assert.match(answer.coverage.scoredShareDisplay, /^\d+%$/);
  assert.ok(Number.isInteger(answer.coverage.recordsAnalyzed));
  assert.ok(answer.coverage.confidenceLevel.length > 0);
});

test("the derivation is a pure function of the dataset, so a changed dataset moves it", () => {
  const base = loadExampleDataset();
  const doubled = computeRecoverableAnswer({ ...base, recoverableUsd: base.recoverableUsd * 2 });
  const shipped = computeRecoverableAnswer(base);

  assert.equal(doubled.recoverable.annualUsd, shipped.recoverable.annualUsd * 2);
  assert.notEqual(doubled.recoverable.annualDisplay, shipped.recoverable.annualDisplay);
  // Same call, same input, same answer: nothing here reads a clock or storage.
  assert.deepEqual(computeRecoverableAnswer(base), shipped);
});

test("an incomplete dataset withholds the figure instead of reporting a zero", () => {
  const base = loadExampleDataset();
  for (const [patch, reason] of [
    [{ spendUsd: 0 }, RECOVERABLE_ANSWER_UNAVAILABLE.noSpend],
    [{ recoverableUsd: undefined }, RECOVERABLE_ANSWER_UNAVAILABLE.noRecoverable],
    [{ period: "2026-06-01 to 2026-06-14" }, RECOVERABLE_ANSWER_UNAVAILABLE.noPeriod],
    [{ topDepartment: null }, RECOVERABLE_ANSWER_UNAVAILABLE.noDestination],
  ]) {
    const answer = computeRecoverableAnswer({ ...base, ...patch });
    assert.equal(answer.available, false);
    assert.equal(answer.unavailableReason, reason);
    assert.equal(answer.recoverable, null, "a withheld answer carries no figure");
    assert.equal(recoverableValueText(answer), RECOVERABLE_WITHHELD_VALUE);
    assert.equal(dollarLiterals(recoverableConfidenceText(answer)).length, 0);
  }
});

test("every figure the AI FinOps answer region ships is the derivation's own", async () => {
  const page = await read("src/evolution.html");
  const region = answerRegionMarkup(page);
  const answer = RECOVERABLE_ANSWER;

  // The authored words ARE the painted words. An editor who changes one of the
  // two copies without the other fails here rather than publishing two answers.
  const document = parseHtml(page);
  assert.equal(textOf(document.getElementById("finops-recoverable-value")),
    recoverableValueText(answer));
  assert.equal(textOf(document.getElementById("finops-recoverable-confidence")),
    recoverableConfidenceText(answer));
  assert.equal(textOf(document.getElementById("finops-recoverable-action")),
    recoverableActionText(answer));

  // …AND THE COUNT. Every dollar literal reachable in the region must be one the
  // derivation published, and there must be exactly as many as it publishes for
  // this region — so a re-introduced hardcode trips this line even if somebody
  // matches the format.
  const literals = dollarLiterals(region);
  const published = new Set(answer.dollarDisplays);
  for (const literal of literals) {
    assert.ok(published.has(literal),
      `${literal} in the answer region came from nowhere the derivation computes`);
  }
  assert.equal(literals.length, 2,
    "the region states the recoverable figure and the spend it is modelled over, and no third");
  assert.deepEqual(literals,
    [answer.recoverable.annualDisplay, answer.totalSpend.annualDisplay]);

  // And nowhere else on the page restates the headline: one occurrence, in the
  // region, including in prose, aria-labels, titles and export captions.
  assert.equal(page.split(answer.recoverable.annualDisplay).length - 1, 1,
    "the headline recoverable figure appears once in the document, in its answer region");
});

test("repainting the answer region from the derivation changes nothing on the page", async () => {
  const document = parseHtml(await read("src/evolution.html"));
  const before = ["finops-recoverable-value", "finops-recoverable-confidence",
    "finops-recoverable-action"].map((id) => textOf(document.getElementById(id)));

  const painted = renderRecoverableAnswer(document);
  assert.deepEqual(painted, ["finops-recoverable-value", "finops-recoverable-confidence",
    "finops-recoverable-action"]);
  const after = painted.map((id) => textOf(document.getElementById(id)));
  assert.deepEqual(after, before, "the shipped document already says what the paint says");

  // The region's one control is the one the document authored: no focusable was
  // added above the first-run region by painting it.
  const links = [...document.getElementById("finops-recoverable-answer").querySelectorAll("a")];
  assert.equal(links.length, 1);
  assert.equal(links[0].getAttribute("href"), "/savings-action-center.html");
});

test("the action center quotes the same computed figure and authors none of its own", async () => {
  const page = await read("src/savings-action-center.html");
  const answer = RECOVERABLE_ANSWER;
  const parts = recoverablePointerParts(answer);

  const document = parseHtml(page);
  assert.equal(textOf(document.getElementById("finops-journey-owner")), pointerSentence(parts));

  // Repainting is a no-op, and it reuses the authored anchor rather than making
  // a second one — this page's tab order is unchanged by the paint. The stamp is
  // how the identity of the anchor is checked without asserting on two elements.
  document.getElementById("finops-journey-owner-link").dataset.authored = "yes";
  renderRecoverablePointer(document, answer);
  assert.equal(textOf(document.getElementById("finops-journey-owner")), pointerSentence(parts));
  assert.equal(document.getElementById("finops-journey-owner-link").dataset.authored, "yes",
    "the painter reuses the authored link rather than creating a second focusable");
  assert.equal(
    [...document.getElementById("finops-journey-owner").querySelectorAll("a")].length, 1);

  // THE COUNT for this page is the whole document: it authors no dollar figure
  // of its own anywhere, and the one it quotes is the derivation's.
  const literals = dollarLiterals(page);
  assert.deepEqual(literals, [answer.recoverable.annualDisplay],
    "the only money figure on this page is the one the answer computed");
});
