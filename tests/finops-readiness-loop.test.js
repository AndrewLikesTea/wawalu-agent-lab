// The guided loop from a hedged ceiling to a defensible claim (#1483), in its
// three states: untouched, partially completed, and fully completed.
//
// WHAT IS ACTUALLY BEING PINNED. Not the copy — the delegation. The loop is only
// worth its bytes if its steps are the readiness contract's own categories, in
// the readiness contract's own order, and if "done" for the two steps that have
// an owner is the owner module's verdict rather than a rule restated here. So
// the fixtures below move ONLY the inputs those modules read, and the assertions
// are about which step flipped.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHtml, tabSequence, textOf } from "./support/browser.js";
import { analysisReadinessForDataset } from "../src/finops-analysis-readiness.js";
import { LOOP_QUESTION, READINESS_LOOP_VERSION, readinessLoop }
  from "../src/finops-readiness-loop.js";
import {
  QUOTED_SLOTS, READINESS_LOOP_IDS, applyReadinessLoop, currentLoopRender, readClaim,
  resetReadinessLoop,
} from "../src/finops-readiness-loop-view.js";
import { parseRateDeclaration } from "../src/finops-declared-rate-contract.js";
import { PRICED_DESTINATIONS } from "../src/finops-pricing-provenance.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");

const byId = (document, id) => document.getElementById(id);

/**
 * A dataset that carries usage and cost and nothing else. Generated here rather
 * than committed: the readiness contract's own predicates are what decide which
 * categories are held, so the fixture only has to satisfy or miss them.
 */
function dataset({ classified = false, observed = false } = {}) {
  return {
    departments: [{ id: "atlas", name: "Atlas Platform", spendUsd: 120000, queries: 4000 }],
    evidence: classified ? [{ category: "exploratory" }] : [],
    actionPlan: {
      actions: [observed
        ? { actionId: "route-atlas", observed: { realizedSavingsUsd: 4200 } }
        : { actionId: "route-atlas" }],
    },
  };
}

/** A graded floor record in each of the two states the loop distinguishes. */
const FLOOR = Object.freeze({
  unscored: Object.freeze({
    scored: false, publishable: false, coverage: null, reason: "The rubric has not scored any "
      + "department in this analysis yet, so no graded floor is taken.",
  }),
  published: Object.freeze({ scored: true, publishable: true, coverage: 0.82 }),
  belowBar: Object.freeze({ scored: true, publishable: false, coverage: 0.2 }),
});

/**
 * Contracted rates for every destination this page prices, generated from the
 * pricing module's own list so the fixture cannot fall out of step with it.
 */
const DECLARED_BOTH = PRICED_DESTINATIONS.flatMap((model) => [
  { model, unit: "usd-per-million-input", rate: 2.5, effectiveDate: "2026-01-01",
    sourceLabel: "Master services agreement" },
  { model, unit: "usd-per-million-output", rate: 10, effectiveDate: "2026-01-01",
    sourceLabel: "Master services agreement" },
]);

const stepFor = (loop, id) => loop.steps.find((step) => step.id === id);

// --- the model -------------------------------------------------------------

test("untouched: every step the readiness contract raises is open, in its order", () => {
  const readiness = analysisReadinessForDataset(dataset());
  const loop = readinessLoop({ readiness, floor: FLOOR.unscored });

  assert.equal(loop.version, READINESS_LOOP_VERSION);
  assert.equal(loop.question, LOOP_QUESTION);
  // The steps ARE the contract's categories, in the contract's order — not a
  // list authored here that happens to look like them.
  assert.deepEqual(loop.steps.map((step) => step.id),
    readiness.categories.map((category) => category.id));
  assert.deepEqual(loop.steps.map((step) => step.ordinal), [1, 2, 3, 4]);

  // Usage and cost is the one category this dataset carries sufficiently, so
  // exactly one step is done and the loop is still hedged.
  assert.equal(stepFor(loop, "usage_cost").done, true);
  assert.equal(loop.completed, 1);
  assert.equal(loop.remaining, 3);
  assert.equal(loop.settled, false);
  assert.equal(loop.verdict, "hedged");
  // The top of the loop is one metric and one action, and the action is the
  // FIRST open step rather than the worst or the cheapest.
  assert.match(loop.metric, /1 of 4 steps done · 3 still open/);
  assert.equal(loop.next.id, "workload_classification");
  assert.match(loop.nextAction, /^Step 2 of 4 —/);
});

test("the two owned steps are decided by their owner module, not by this one", () => {
  const readiness = analysisReadinessForDataset(dataset({ classified: true }));

  // The graded floor is the ONLY input that moves the scoring step: the
  // readiness contract already calls the classification category sufficient in
  // this dataset, and the step is still open because the floor is below bar.
  assert.equal(readiness.categories.find((c) => c.id === "workload_classification").sufficient, true);
  const below = readinessLoop({ readiness, floor: FLOOR.belowBar });
  assert.equal(stepFor(below, "workload_classification").done, false);
  assert.equal(stepFor(below, "workload_classification").owner, "graded-floor");
  assert.match(stepFor(below, "workload_classification").source, /gradedRecoverableFloor/);

  const above = readinessLoop({ readiness, floor: FLOOR.published });
  assert.equal(stepFor(above, "workload_classification").done, true);
  assert.match(stepFor(above, "workload_classification").state, /82% of analyzed spend/);

  // And the declared-rate contract is the only input that moves the pricing
  // step, which the readiness contract can never call sufficient on its own.
  const listPriced = readinessLoop({ readiness, floor: FLOOR.published });
  assert.equal(stepFor(listPriced, "applicable_pricing").done, false);
  assert.match(stepFor(listPriced, "applicable_pricing").state, /Pricing provenance is List price/);

  const declared = readinessLoop({
    readiness, floor: FLOOR.published,
    declaration: parseRateDeclaration(DECLARED_BOTH), asOf: "2026-03-01",
    destinations: PRICED_DESTINATIONS,
  });
  assert.equal(stepFor(declared, "applicable_pricing").done, true);
  assert.match(stepFor(declared, "applicable_pricing").state, /Pricing provenance is Declared/);
  assert.equal(stepFor(declared, "applicable_pricing").owner, "declared-rate");
});

test("partially completed: cleared steps stay listed, and the loop points past them", () => {
  const readiness = analysisReadinessForDataset(dataset({ classified: true }));
  const loop = readinessLoop({ readiness, floor: FLOOR.published });

  assert.equal(loop.total, 4);
  assert.equal(loop.completed, 2);
  assert.equal(loop.remaining, 2);
  assert.equal(loop.settled, false);
  // A cleared step is still in the list. Hiding it would leave a reader unable
  // to see what the step they just took bought them.
  assert.equal(loop.steps.length, 4);
  assert.deepEqual(loop.steps.filter((step) => step.done).map((step) => step.id),
    ["usage_cost", "workload_classification"]);
  // A done step carries no blocker and no "do this".
  for (const step of loop.steps.filter((step) => step.done)) {
    assert.equal(step.blocker, null);
  }
  assert.equal(loop.next.id, "applicable_pricing");
});

test("fully completed: the loop stops cleanly instead of inventing a next step", () => {
  const readiness = analysisReadinessForDataset(dataset({ classified: true, observed: true }));
  const loop = readinessLoop({
    readiness, floor: FLOOR.published,
    declaration: parseRateDeclaration(DECLARED_BOTH), asOf: "2026-03-01",
    destinations: PRICED_DESTINATIONS,
  });

  assert.equal(loop.remaining, 0);
  assert.equal(loop.completed, loop.total);
  assert.equal(loop.settled, true);
  assert.equal(loop.verdict, "defensible");
  assert.equal(loop.next, null);
  assert.match(loop.nextAction, /Nothing is outstanding/);
  // The stop sentence says the claim stands. It does not ask for anything.
  assert.doesNotMatch(loop.nextAction, /Step \d/);
});

test("no analysis at all is a stated absence, not an empty loop that looks done", () => {
  const loop = readinessLoop({ readiness: null, floor: null, analysis: null });
  assert.equal(loop.total, 0);
  assert.equal(loop.settled, false, "an empty loop must never read as a defensible claim");
  assert.equal(loop.verdict, "unavailable");
  assert.match(loop.metric, /No readiness benchmark/);
});

test("the loop computes no figure of its own", () => {
  const source = readinessLoop({
    readiness: analysisReadinessForDataset(dataset({ classified: true })),
    floor: FLOOR.published,
  });
  // Every dollar figure a reader sees comes from a slot the page painted. The
  // model carries none, so it cannot disagree with one.
  assert.doesNotMatch(JSON.stringify(source), /\$/);
});

// --- the view --------------------------------------------------------------

/** The authored page, with the five quoted slots set to a known claim. */
function pageWithClaim(values = {}) {
  const document = parseHtml(html);
  for (const slot of QUOTED_SLOTS) {
    const node = byId(document, slot.id);
    assert.ok(node, `the quoted slot #${slot.id} is not on the page`);
    if (values[slot.key] !== undefined) node.textContent = values[slot.key];
  }
  return document;
}

const HEDGED = {
  claim: "$62,400", tier: "Illustrative", confidence: "Confidence: not graded",
  provenance: "Pricing provenance: List price", floor: "",
};
const DEFENSIBLE = {
  claim: "$48,900", tier: "Declared", confidence: "Confidence: B",
  provenance: "Pricing provenance: Declared", floor: "$31,200",
};

test("the region is authored complete and keyboard operable before any script runs", () => {
  const document = parseHtml(html);
  const region = byId(document, READINESS_LOOP_IDS.region);
  assert.ok(region, "the loop region is not authored in the document");
  // Two focusables, and both of them below the brief: the first screen above
  // #finops-first-run has no spare tab stop.
  const order = tabSequence(document).map((node) => node.id);
  const brief = order.indexOf("finops-first-run-import");
  for (const id of ["readiness-loop-detail-summary", READINESS_LOOP_IDS.recheck]) {
    assert.ok(order.indexOf(id) > brief, `#${id} is reached before the brief's own next step`);
  }
  // The disclosure is a native details, so Enter and Space are the browser's.
  assert.equal(byId(document, READINESS_LOOP_IDS.detail).tagName, "DETAILS");
  assert.equal(byId(document, READINESS_LOOP_IDS.detail).hasAttribute("open"), false);
  // The recheck control is a real, enabled button with an accessible name.
  const button = byId(document, READINESS_LOOP_IDS.recheck);
  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.getAttribute("type"), "button");
  assert.equal(button.hasAttribute("disabled"), false);
  assert.match(textOf(button), /Recheck/);
});

test("the live region is a sibling of the disclosure, never inside it", () => {
  const document = parseHtml(html);
  const live = byId(document, READINESS_LOOP_IDS.live);
  const details = byId(document, READINESS_LOOP_IDS.detail);
  assert.equal(live.getAttribute("role"), "status");
  assert.equal(live.getAttribute("aria-live"), "polite");
  // Folded into a shut details element, an announcement is one nobody is told.
  for (let walk = live.parentNode; walk; walk = walk.parentNode) {
    assert.notEqual(walk, details, "the live region is inside the disclosure");
  }
  assert.equal(live.parentNode, details.parentNode, "the live region left the region");
});

test("the view quotes the painted slots and re-derives nothing", () => {
  resetReadinessLoop();
  const document = pageWithClaim(HEDGED);
  assert.deepEqual(readClaim(document), HEDGED);
});

test("untouched: the top of the loop is one question, one metric, one action", () => {
  resetReadinessLoop();
  const document = pageWithClaim(HEDGED);
  const loop = readinessLoop({
    readiness: analysisReadinessForDataset(dataset()), floor: FLOOR.unscored,
  });
  const region = applyReadinessLoop(document, loop);

  assert.equal(region.dataset.state, "hedged");
  assert.equal(region.dataset.remaining, "3");
  assert.equal(textOf(byId(document, READINESS_LOOP_IDS.metric)), loop.metric);
  assert.equal(textOf(byId(document, READINESS_LOOP_IDS.action)), loop.nextAction);
  // Four steps are listed, done and open alike, each naming the module that
  // decided it — the per-step detail is behind the disclosure.
  const steps = byId(document, READINESS_LOOP_IDS.steps).children.filter((n) => n.nodeType === 1);
  assert.equal(steps.length, 4);
  assert.deepEqual(steps.map((node) => node.dataset.done), ["true", "false", "false", "false"]);
  assert.match(textOf(steps[2]), /finops-declared-rate-contract\.js/);
  // Nothing has moved yet, so nothing is announced on the first paint.
  assert.equal(textOf(byId(document, READINESS_LOOP_IDS.live)), "");
  assert.match(textOf(byId(document, READINESS_LOOP_IDS.change)), /Nothing moved/);
});

test("partially completed: the before-and-after names every input that moved", () => {
  resetReadinessLoop();
  const document = pageWithClaim(HEDGED);
  const readiness = analysisReadinessForDataset(dataset({ classified: true }));
  applyReadinessLoop(document, readinessLoop({ readiness, floor: FLOOR.unscored }));

  // The reader takes a step: the page repaints the five slots, then the loop.
  for (const slot of QUOTED_SLOTS) byId(document, slot.id).textContent = DEFENSIBLE[slot.key];
  applyReadinessLoop(document, readinessLoop({ readiness, floor: FLOOR.published }));

  const render = currentLoopRender();
  assert.deepEqual(render.changes.map((change) => change.key),
    ["claim", "tier", "confidence", "provenance", "floor"]);
  const change = textOf(byId(document, READINESS_LOOP_IDS.change));
  assert.match(change, /5 inputs moved/);
  assert.match(change, /The claim was \$62,400, now \$48,900/);
  assert.match(change, /Tier was Illustrative, now Declared/);
  // …and the itemised list of the same moves, inside the disclosure.
  const rows = byId(document, READINESS_LOOP_IDS.changes).children.filter((n) => n.nodeType === 1);
  assert.equal(rows.length, 5);
  assert.match(textOf(rows[4]), /Graded floor: was  → now \$31,200|Graded floor: was → now \$31,200/);
  // A recompute IS announced, and the announcement carries the metric and the move.
  const live = textOf(byId(document, READINESS_LOOP_IDS.live));
  assert.match(live, /2 of 4 steps done/);
  assert.match(live, /Tier Illustrative to Declared/);
});

test("fully completed: the region stops asking, and says so where it is read", () => {
  resetReadinessLoop();
  const document = pageWithClaim(DEFENSIBLE);
  const loop = readinessLoop({
    readiness: analysisReadinessForDataset(dataset({ classified: true, observed: true })),
    floor: FLOOR.published,
    declaration: parseRateDeclaration(DECLARED_BOTH), asOf: "2026-03-01",
    destinations: PRICED_DESTINATIONS,
  });
  const region = applyReadinessLoop(document, loop);

  assert.equal(region.dataset.state, "defensible");
  assert.equal(region.dataset.remaining, "0");
  assert.match(textOf(byId(document, READINESS_LOOP_IDS.action)), /Nothing is outstanding/);
  const steps = byId(document, READINESS_LOOP_IDS.steps).children.filter((n) => n.nodeType === 1);
  assert.deepEqual(steps.map((node) => node.dataset.done), ["true", "true", "true", "true"]);
});

test("a document without the region is left alone rather than thrown through", () => {
  resetReadinessLoop();
  const empty = parseHtml("<!doctype html><html><body><p id=\"x\">nothing</p></body></html>");
  assert.equal(applyReadinessLoop(empty, readinessLoop({})), null);
});
