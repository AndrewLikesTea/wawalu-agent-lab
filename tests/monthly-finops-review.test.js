import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  buildMonthlyFinopsReview, clearOperatingCycleSelection, MONTHLY_FINOPS_METRIC_CONTRACTS,
  MONTHLY_FINOPS_REVIEW_VERSION, OPERATING_CYCLE_STORAGE_KEY, projectOperatingCycle,
  readOperatingCycleSelection, roundOne, validateOperatingCycleSelection,
  writeOperatingCycleSelection,
} from "../src/monthly-finops-review.js";
import { renderMonthlyFinopsReview, renderOperatingCycle } from "../src/monthly-finops-review-view.js";
import { parseHtml, textOf } from "./support/browser.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const fixture = async () => JSON.parse(await read("src/monthly-finops-review-fixture.json"));

test("metric definitions fix formulas, populations, rounding, and exclusions", () => {
  const metrics = MONTHLY_FINOPS_METRIC_CONTRACTS;
  assert.match(metrics.selectedAction.definition, /sole action with selected=true/);
  assert.match(metrics.expectedSavings.population, /verificationPeriodId only/);
  assert.equal(metrics.observedSavings.formula,
    "observation.baselinePeriod.spendMinor - observation.verificationPeriod.spendMinor");
  assert.match(metrics.observedSavings.excluded, /Causal attribution/);
  assert.match(metrics.variance.formula, /observedSavingsMinor - expectedSavingsMinor/);
  assert.match(metrics.attainment.formula, /null when expectedSavingsMinor is zero/);
  assert.match(metrics.confidence.formula, /high=3, moderate=2, low=0 or 1/);
  assert.match(metrics.provenance.definition, /baselinePeriodId and verificationPeriodId/);
  assert.match(metrics.followUp.excluded, /Equal-weight alerts/);
  assert.equal(roundOne(-10.05), -10.1);
});

test("answers whether the selected action delivered in the next synthetic period", async () => {
  const review = buildMonthlyFinopsReview(await fixture());
  assert.equal(review.schemaVersion, MONTHLY_FINOPS_REVIEW_VERSION);
  assert.deepEqual(review.selectedAction, {
    id: "platform-routing-policy",
    name: "Platform routing policy",
    scope: "Platform model-routing spend",
  });
  assert.equal(review.benchmark.expectedSavingsMinor, 1_027_200);
  assert.equal(review.benchmark.observedSavingsMinor, 1_290_600);
  assert.equal(review.benchmark.varianceMinor, 263_400);
  assert.equal(roundOne(review.benchmark.attainment * 100), 125.6);
  assert.equal(review.finding.outcome, "met");
  assert.equal(review.confidence.level, "high");
  assert.deepEqual(review.provenance.periodIds, ["synthetic-2026-06", "synthetic-2026-07"]);
  assert.equal(review.nextAction.id, "extend-platform-routing");
});

test("finding, confidence, and the sole action change by documented bundled rules", async () => {
  const input = await fixture();
  input.observation.verificationPeriod.spendMinor = 12_200_000;
  input.observation.complete = false;
  const review = buildMonthlyFinopsReview(input);
  assert.equal(review.benchmark.observedSavingsMinor, 640_000);
  assert.equal(review.benchmark.varianceMinor, -387_200);
  assert.equal(review.finding.outcome, "missed");
  assert.equal(review.confidence.level, "moderate");
  assert.equal(review.nextAction.id, "inspect-routing-gap");
  assert.equal(review.nextAction.rank, 1);
});

test("zero expectation has defined variance and null attainment", async () => {
  const input = await fixture();
  input.actions.find((action) => action.selected).expectedSavingsMinor = 0;
  const review = buildMonthlyFinopsReview(input);
  assert.equal(review.benchmark.varianceMinor, review.benchmark.observedSavingsMinor);
  assert.equal(review.benchmark.attainment, null);
});

test("meeting expectation exactly is stated as met, not exceeded", async () => {
  const input = await fixture();
  // Observed savings land on the expectation to the minor unit.
  input.observation.verificationPeriod.spendMinor = 12_840_000 - 1_027_200;
  const review = buildMonthlyFinopsReview(input);
  assert.equal(review.benchmark.varianceMinor, 0);
  assert.equal(review.finding.outcome, "met");
  assert.doesNotMatch(review.finding.statement, /exceeded/);
  assert.match(review.finding.statement, /met its next-period savings expectation exactly/);
});

test("an unscoped observation is a failed signal, not a like-for-like benchmark", async () => {
  const mismatched = await fixture();
  mismatched.observation.scope = "Support inference spend";
  const review = buildMonthlyFinopsReview(mismatched);
  assert.equal(review.confidence.signals.scopeMatches, false);
  assert.equal(review.confidence.level, "moderate");

  // Two failed signals is the documented low level; it must be reachable.
  const weak = await fixture();
  delete weak.observation.scope;
  weak.observation.complete = false;
  const low = buildMonthlyFinopsReview(weak);
  assert.equal(low.confidence.signalCount, 1);
  assert.equal(low.confidence.level, "low");
});

test("a zero-record account renders the brief instead of throwing", async () => {
  const input = await fixture();
  input.confidence.recordsExpected = 0;
  input.confidence.recordsComparable = 0;
  const review = buildMonthlyFinopsReview(input);
  assert.equal(review.confidence.coveragePercent, null);
  assert.equal(review.confidence.signals.coverageMeetsThreshold, false);

  const doc = parseHtml(await read("src/evolution.html"));
  const root = renderMonthlyFinopsReview(doc, review);
  assert.match(textOf(root.querySelector("details")), /No comparable records/);
  assert.match(textOf(root), /Confidence: moderate/);
});

test("sub-unit amounts and attainment keep the contract's documented precision", async () => {
  const doc = parseHtml(await read("src/evolution.html"));
  const withCents = await fixture();
  withCents.actions.find((action) => action.selected).expectedSavingsMinor = 1_027_240;
  const cents = textOf(renderMonthlyFinopsReview(doc, buildMonthlyFinopsReview(withCents))
    .querySelector(".monthly-review-benchmark"));
  // Rounding the minor units away prints a $0 variance beside a met/missed verdict.
  assert.match(cents, /Expected savings.*\$10,272\.40/s);
  assert.match(cents, /Variance.*\$2,633\.60/s);

  const halfTie = await fixture();
  halfTie.actions.find((action) => action.selected).expectedSavingsMinor = 1_200_000;
  halfTie.observation.verificationPeriod.spendMinor = 12_840_000 - 1_200_600;
  // Exactly 100.05%: toFixed drops it to 100.0 and reads as "landed on target",
  // when the contract's half-away-from-zero rule says the action came in over.
  assert.match(textOf(renderMonthlyFinopsReview(doc, buildMonthlyFinopsReview(halfTie))
    .querySelector(".monthly-review-benchmark")), /Attainment.*100\.1%/s);
});

test("rejects ambiguous selected actions and ambiguous outcome actions", async () => {
  const twoSelected = await fixture();
  twoSelected.actions[1].selected = true;
  assert.throws(() => buildMonthlyFinopsReview(twoSelected), /exactly one selected/);

  const twoFollowUps = await fixture();
  twoFollowUps.followUpActions.push({ ...twoFollowUps.followUpActions[0], id: "duplicate" });
  assert.throws(() => buildMonthlyFinopsReview(twoFollowUps), /exactly one met follow-up/);
});

test("the existing AI FinOps monthly-review workspace imports and renders one accessible brief", async () => {
  const html = await read("src/evolution.html");
  const page = await read("src/evolution-page.js");
  const doc = parseHtml(html);
  const root = renderMonthlyFinopsReview(doc, buildMonthlyFinopsReview(await fixture()));

  assert.match(page, /projectOperatingCycle/);
  assert.match(page, /renderOperatingCycle\(document/);
  assert.match(textOf(root.querySelector("h2")), /Did our last action deliver the expected savings\?/);
  assert.match(textOf(root.querySelector(".monthly-review-benchmark")), /Expected savings.*\$10,272/s);
  assert.match(textOf(root.querySelector(".monthly-review-benchmark")), /Observed savings.*\$12,906/s);
  assert.match(textOf(root), /Confidence: high/);
  assert.match(textOf(root), /June 2026 synthetic source.*July 2026 synthetic source/s);
  assert.equal(root.querySelectorAll(".monthly-review-projection-action").length, 1);
  assert.equal(root.querySelectorAll("details").length, 1);
  assert.equal(root.querySelector("details").hasAttribute("open"), false);
  assert.equal(root.querySelector("summary").getAttribute("aria-controls"),
    "monthly-review-verification-support");
  assert.deepEqual(root.querySelectorAll("h2,h3").map(textOf), [
    "Did our last action deliver the expected savings?",
    "Finding",
    "Prioritized follow-up · rank 1",
  ]);
});

const memoryStorage = () => {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
};

test("identical bundled period and selected-action inputs produce an identical cycle", async () => {
  const input = await fixture();
  const selected = { status: "selected", selection: {
    schemaVersion: "finops-operating-cycle-selection/1.0.0", actionId: "platform-routing-policy",
  } };
  assert.deepEqual(projectOperatingCycle(structuredClone(input), structuredClone(selected)),
    projectOperatingCycle(structuredClone(input), structuredClone(selected)));
  const cycle = projectOperatingCycle(input, selected);
  assert.equal(cycle.status, "ready");
  assert.equal(cycle.review.benchmark.expectedSavingsMinor, 1_027_200);
  assert.equal(cycle.review.benchmark.observedSavingsMinor, 1_290_600);
  assert.equal(cycle.review.benchmark.varianceMinor, 263_400);
  assert.equal(cycle.review.confidence.level, "high");
  assert.deepEqual(cycle.review.provenance.periodIds,
    ["synthetic-2026-06", "synthetic-2026-07"]);
});

test("cycle storage accepts only an action id and reset clears all local cycle state", () => {
  const storage = memoryStorage();
  assert.equal(readOperatingCycleSelection(storage).status, "empty");
  assert.equal(writeOperatingCycleSelection(storage, "platform-routing-policy").ok, true);
  assert.deepEqual(JSON.parse(storage.getItem(OPERATING_CYCLE_STORAGE_KEY)), {
    schemaVersion: "finops-operating-cycle-selection/1.0.0", actionId: "platform-routing-policy",
  });
  assert.equal(validateOperatingCycleSelection({ schemaVersion: "finops-operating-cycle-selection/1.0.0",
    actionId: "platform-routing-policy", prompt: "forbidden" }).valid, false);
  assert.equal(clearOperatingCycleSelection(storage).ok, true);
  assert.equal(storage.getItem(OPERATING_CYCLE_STORAGE_KEY), null);
  assert.equal(readOperatingCycleSelection(storage).status, "empty");
});

test("empty, incompatible, and no-comparison cycles never imply verification", async () => {
  const input = await fixture();
  const doc = parseHtml(await read("src/evolution.html"));
  const empty = projectOperatingCycle(input, { status: "empty", selection: null });
  assert.match(textOf(renderOperatingCycle(doc, empty)), /No verification exists/);
  const incompatible = projectOperatingCycle(input, { status: "selected", selection: {
    schemaVersion: "finops-operating-cycle-selection/1.0.0", actionId: "removed-action",
  } });
  assert.equal(incompatible.status, "incompatible");
  assert.match(textOf(renderOperatingCycle(doc, incompatible)), /cannot be read/);
  const unsupported = projectOperatingCycle(input, { status: "selected", selection: {
    schemaVersion: "finops-operating-cycle-selection/1.0.0", actionId: "support-cache-policy",
  } });
  assert.equal(unsupported.status, "no_valid_comparison");
  const text = textOf(renderOperatingCycle(doc, unsupported));
  assert.match(text, /not verified/);
  assert.doesNotMatch(text, /Observed savings/);
});

test("recommended action confirms into Rowan's next-period result and reset restores focus", async () => {
  const input = await fixture();
  const doc = parseHtml(await read("src/evolution.html"));
  const storage = memoryStorage();
  const paint = () => renderOperatingCycle(doc,
    projectOperatingCycle(input, readOperatingCycleSelection(storage)), {
      onSelect(actionId) {
        writeOperatingCycleSelection(storage, actionId);
        paint();
      },
      onReset() {
        clearOperatingCycleSelection(storage);
        paint();
      },
    });

  let root = paint();
  const choice = root.querySelector('input[name="monthly-review-action"]');
  const confirm = root.querySelector('button[type="submit"]');
  assert.equal(root.querySelectorAll('input[name="monthly-review-action"]').length, 1,
    "only the prioritized eligible action is offered");
  assert.equal(confirm.disabled, true);
  assert.match(choice.getAttribute("aria-describedby"), /-evidence$/);
  choice.click();
  assert.equal(confirm.disabled, false);
  confirm.click();

  root = doc.getElementById("monthly-review-projection");
  assert.equal(root.dataset.state, "met");
  assert.match(textOf(root), /Platform routing policy exceeded.*Expected savings.*Observed savings/s);
  assert.match(textOf(root), /Continue.*Extend the verified routing policy/s);
  assert.equal(doc.activeElement?.id, "monthly-review-projection-title");
  const reset = root.querySelector("button");
  assert.match(reset.getAttribute("aria-label"), /Reset Platform routing policy/);
  reset.click();

  root = doc.getElementById("monthly-review-projection");
  assert.equal(root.dataset.state, "empty");
  assert.match(textOf(root), /Choose one bundled demo action/);
  assert.doesNotMatch(textOf(root), /Observed savings/);
  assert.equal(doc.activeElement?.id, "monthly-review-projection-title");
  assert.equal(readOperatingCycleSelection(storage).status, "empty");
});

test("an action the cycle cannot store or format is never offered as a choice", async () => {
  const doc = parseHtml(await read("src/evolution.html"));
  const noSelection = { status: "empty", selection: null };

  // Offering an id the selection validator rejects makes Confirm a silent no-op:
  // the write fails, the repaint returns the same form, and focus jumps away.
  const badId = await fixture();
  badId.actions.find((action) => action.selected).id = "routing policy!";
  assert.equal(writeOperatingCycleSelection(memoryStorage(), "routing policy!").ok, false);
  assert.deepEqual(projectOperatingCycle(badId, noSelection).actions, []);

  // A currency Intl cannot parse throws a RangeError out of the render, blanking
  // the workspace; reset repaints outside the page's try, so it would not recover.
  const badCurrency = await fixture();
  badCurrency.currency = "US$";
  assert.deepEqual(projectOperatingCycle(badCurrency, noSelection).actions, []);

  // A fixture version this build cannot vouch for must not reach the offer at all.
  const badVersion = await fixture();
  badVersion.schemaVersion = "monthly-finops-review-fixture/9.9.9";
  assert.equal(projectOperatingCycle(badVersion, noSelection).status, "incompatible");

  // Counts, never the node itself: asserting an element equals null makes the
  // runner inspect it to build a diff, and these nodes link back to the whole
  // parsed page, so the assertion hangs instead of failing.
  const root = renderOperatingCycle(doc, projectOperatingCycle(badCurrency, noSelection));
  assert.match(textOf(root), /No bundled demo action is offerable/);
  assert.equal(root.querySelectorAll('input[name="monthly-review-action"]').length, 0);
  assert.equal(root.querySelectorAll("button").length, 0, "no dead Confirm control is left behind");
});

test("confirming follows the checked action, not the first one rendered", async () => {
  const doc = parseHtml(await read("src/evolution.html"));
  const offer = (id, name) => ({ id, name, scope: `${name} spend`, expectedSavingsMinor: 100,
    verificationPeriodId: "synthetic-2026-07", currency: "USD", evidence: "Bundled synthetic." });
  const confirmed = [];
  const root = renderOperatingCycle(doc, { schemaVersion: "finops-operating-cycle/1.0.0",
    status: "empty", review: null,
    actions: [offer("first-action", "First"), offer("second-action", "Second")] },
  { onSelect: (actionId) => confirmed.push(actionId) });

  const [first, second] = root.querySelectorAll('input[name="monthly-review-action"]');
  const confirm = root.querySelector('button[type="submit"]');
  assert.equal(confirm.disabled, true);
  second.click();
  assert.equal(first.checked, false);
  assert.equal(confirm.disabled, false, "a checked second choice enables Confirm");
  confirm.click();
  assert.deepEqual(confirmed, ["second-action"]);
  assert.equal(root.querySelector("form").getAttribute("aria-labelledby"),
    "monthly-review-recommendation-title");
});
