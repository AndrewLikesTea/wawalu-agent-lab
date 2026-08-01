import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { MONTHLY_FINOPS_REVIEW_FIXTURE } from "../src/monthly-finops-review-fixture.js";
import { buildMonthlyFinopsReview } from "../src/monthly-finops-review.js";
import { renderMonthlyFinopsReview } from "../src/monthly-finops-review-view.js";
import { parseHtml, textOf } from "./support/browser.js";

const review = buildMonthlyFinopsReview(MONTHLY_FINOPS_REVIEW_FIXTURE);

test("fixture deterministically answers the three executive questions", () => {
  assert.deepEqual(review.change, { differenceMinor: -1_500_000, percentage: -0.125 });
  assert.equal(review.commitment.status, "achieved");
  assert.equal(review.nextAction.id, "lock_routing_policy");
  assert.equal(review.nextAction.priorityScore, 28);
  assert.equal(review.confidence.label, "high");
});

test("priority ties resolve by ascending action id", () => {
  const fixture = structuredClone(MONTHLY_FINOPS_REVIEW_FIXTURE);
  fixture.actions = [
    { id: "z_action", statement: "Z", impact: 1, urgency: 1, evidence: 1 },
    { id: "a_action", statement: "A", impact: 1, urgency: 1, evidence: 1 },
  ];
  assert.equal(buildMonthlyFinopsReview(fixture).nextAction.id, "a_action");
});

test("shipped evolution entry keeps preview hidden until its explicit control", async () => {
  const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
  const doc = parseHtml(html);
  const entry = doc.getElementById("monthly-finops-entry");
  const root = doc.getElementById("monthly-finops-review");
  assert.equal(entry.getAttribute("aria-controls"), root.id);
  assert.equal(entry.getAttribute("aria-expanded"), "false");
  assert.equal(root.hidden, true);

  renderMonthlyFinopsReview(doc, review);
  const headings = root.querySelectorAll("h2,h3").map(textOf);
  assert.deepEqual(headings, [
    "What changed since last month?",
    "Did the prior commitment work?",
    "What one action should happen next?",
  ]);
  assert.equal(root.querySelectorAll(".monthly-finops-action").length, 1);
  assert.match(textOf(root), /Invented two-period data only/);
});
