import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { MONTHLY_REVIEW_FIXTURE } from "../src/monthly-review-fixture.js";
import { monthlyReview } from "../src/monthly-review.js";
import { renderMonthlyReview } from "../src/monthly-review-view.js";
import { parseHtml, textOf } from "./support/browser.js";

test("the exact fixture headline, commitment result, and ranked action are deterministic", () => {
  const review = monthlyReview(MONTHLY_REVIEW_FIXTURE);
  assert.equal(review.change.value, -3500);
  assert.equal(review.change.unit, "USD/month");
  assert.equal(review.change.denominator, "Not applicable: this is an absolute monthly USD amount, not a rate");
  assert.equal(review.commitment.outcome, "achieved");
  assert.equal(review.prioritizedAction.id, "enforce-routing-policy");
  assert.equal(review.confidence.assessment, "High confidence");
});

test("commitment operators and stable action tie-breaking are declared data rules", () => {
  const review = monthlyReview({ ...MONTHLY_REVIEW_FIXTURE,
    priorCommitment: { ...MONTHLY_REVIEW_FIXTURE.priorCommitment, operator: "<", target: 9340 },
    actions: [
      { id: "z-action", rank: 1, label: "Z", evidence: "Synthetic Z" },
      { id: "a-action", rank: 1, label: "A", evidence: "Synthetic A" },
    ],
  });
  assert.equal(review.commitment.outcome, "not_achieved");
  assert.equal(review.prioritizedAction.id, "a-action");
});

test("the preview renders the three leader questions in order with detail secondary", () => {
  const document = parseHtml('<main><section id="monthly-review-preview" hidden></section></main>');
  const root = renderMonthlyReview(document, monthlyReview(MONTHLY_REVIEW_FIXTURE));
  const questions = root.querySelectorAll("h3").map((node) => node.textContent);
  assert.deepEqual(questions, [
    "What changed since last month?",
    "Did the prior commitment work?",
    "What single action should be prioritized next?",
  ]);
  assert.match(textOf(root), /\$3,500 lower/);
  assert.match(textOf(root), /Achieved/);
  assert.equal(root.querySelectorAll("details").length, 1);
});

test("evolution ships an accessible explicit entry and page wiring", async () => {
  const [html, page] = await Promise.all([
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /id="monthly-review-open" aria-expanded="false" aria-controls="monthly-review-preview"/);
  assert.match(html, /id="monthly-review-preview" aria-labelledby="monthly-review-title" hidden/);
  assert.match(page, /import\("\/monthly-review-view\.js"\)/);
  assert.match(page, /renderMonthlyReview\(document, monthlyReview\(MONTHLY_REVIEW_FIXTURE\)\)/);
});
