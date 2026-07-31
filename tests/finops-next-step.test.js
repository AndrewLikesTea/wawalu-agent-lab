// "Where do I start this month?" — the contract, and the screen that carries it.
//
// What is pinned here is the product rule rather than an object shape:
//
//   1. every journey state maps to one state and one recommendation;
//   2. a degraded input can never reach a confident-looking answer — it lands
//      on EVIDENCE_INSUFFICIENT, asks for the specific thing that is missing,
//      and states no figure;
//   3. the same records always produce the same single recommendation, however
//      they were ordered on the way in;
//   4. the trust surface — impact, confidence, provenance, boundary — is on the
//      first screen before any interaction, under exactly one primary action;
//   5. the confidence thresholds are the ones the metric definition publishes,
//      checked on the days either side of the boundary rather than near it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import {
  CAPTURE_AGE_DAYS, CONFIDENCE, JOURNEY_STATE, PRIMARY_ACTION, STATE_PRIORITY,
  annualizedImpactUsd, coversFullCalendarMonth, monthlyImpactUsd, selectNextStep,
} from "../src/finops-next-step.js";
import {
  DEGRADED_FIXTURES, JOURNEY_FIXTURES, REFERENCE_DAY,
} from "../src/finops-next-step-fixtures.js";
import {
  ACTION_TARGET, NEXT_STEP_IDS, renderNextStep,
} from "../src/finops-next-step-view.js";
import {
  JOURNEY_SOURCE, SAMPLE_LABEL, chooseJourneyState, journeyStateFromRetainedAction,
} from "../src/finops-next-step-source.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");

const clone = (value) => JSON.parse(JSON.stringify(value));
const byId = (doc, id) => doc.getElementById(id);

/** The shipped region, lifted out of the page it ships in. */
const region = () => parseHtml(html);

// ---------------------------------------------------------------------------
// 1. The full state matrix.
// ---------------------------------------------------------------------------

test("every journey fixture maps to its own state and one recommendation", () => {
  for (const [name, journeyState] of Object.entries(JOURNEY_FIXTURES)) {
    const recommendation = selectNextStep(journeyState, REFERENCE_DAY);
    assert.equal(recommendation.state, name, `${name} did not derive its own state`);
    assert.equal(recommendation.question, "Where do I start this month?");
    assert.equal(typeof recommendation.primaryAction.kind, "string");
    assert.ok(Object.values(PRIMARY_ACTION).includes(recommendation.primaryAction.kind),
      `${name} recommended an action kind outside the four`);
    assert.ok(recommendation.headline.length > 0, `${name} recommended nothing in words`);
  }
});

test("each state recommends the step that state calls for, and only that one", () => {
  const kindFor = (name) =>
    selectNextStep(JOURNEY_FIXTURES[name], REFERENCE_DAY).primaryAction.kind;
  assert.equal(kindFor("VERIFICATION_DUE"), PRIMARY_ACTION.verifyAction);
  assert.equal(kindFor("REVIEW_IN_PROGRESS"), PRIMARY_ACTION.resumeReview);
  assert.equal(kindFor("ACTIONS_PENDING"), PRIMARY_ACTION.resumeReview);
  assert.equal(kindFor("NO_CURRENT_REVIEW"), PRIMARY_ACTION.startReview);
  assert.equal(kindFor("EVIDENCE_INSUFFICIENT"), PRIMARY_ACTION.collectEvidence);
});

test("the priority order is total, and evidence sufficiency is checked first", () => {
  assert.deepEqual(STATE_PRIORITY, [
    "EVIDENCE_INSUFFICIENT", "VERIFICATION_DUE", "REVIEW_IN_PROGRESS",
    "ACTIONS_PENDING", "NO_CURRENT_REVIEW",
  ]);
  // A state that would otherwise win, degraded. The higher-priority branch has
  // to take it, or a stale input reaches a confident recommendation.
  const degraded = clone(JOURNEY_FIXTURES.VERIFICATION_DUE);
  degraded.source.capturedOn = "2026-01-05";
  assert.equal(selectNextStep(degraded, REFERENCE_DAY).state,
    JOURNEY_STATE.evidenceInsufficient);
});

test("an open review outranks pending dispositions, which outrank a new month", () => {
  // Both conditions true at once. The order decides, not the input order.
  const both = clone(JOURNEY_FIXTURES.ACTIONS_PENDING);
  both.reviews.push({
    id: "r-2026-08", periodStart: "2026-08-01", periodEnd: "2026-08-31", completedAt: null,
  });
  assert.equal(selectNextStep(both, REFERENCE_DAY).state, JOURNEY_STATE.reviewInProgress);
});

test("within a state the winner is the largest monthly impact, then the lowest id", () => {
  const recommendation = selectNextStep(JOURNEY_FIXTURES.VERIFICATION_DUE, REFERENCE_DAY);
  // 4200-3120 plus 900-720 is 1260, against the other candidate's 400.
  assert.equal(recommendation.subject.id, "a-route-support");
  assert.equal(recommendation.impact.monthlyUsd, 1260);
  assert.equal(recommendation.rationale.outrankedCandidates, 1);

  // Equal impact, so only the id can decide it.
  const tied = clone(JOURNEY_FIXTURES.VERIFICATION_DUE);
  tied.actions[1].lineItems = clone(tied.actions[0].lineItems);
  assert.equal(selectNextStep(tied, REFERENCE_DAY).subject.id, "a-cache-embeddings");
});

// ---------------------------------------------------------------------------
// 2. Degraded input never becomes a confident answer.
// ---------------------------------------------------------------------------

test("every degraded fixture is insufficient, conservative, and states no figure", () => {
  for (const [name, journeyState] of Object.entries(DEGRADED_FIXTURES)) {
    const recommendation = selectNextStep(journeyState, REFERENCE_DAY);
    assert.equal(recommendation.state, JOURNEY_STATE.evidenceInsufficient, name);
    assert.equal(recommendation.confidence, CONFIDENCE.low, name);
    assert.equal(recommendation.primaryAction.kind, PRIMARY_ACTION.collectEvidence, name);
    assert.equal(recommendation.impact.stated, false, name);
    assert.equal(recommendation.impact.monthlyUsd, null, `${name} stated a monthly figure`);
    assert.equal(recommendation.impact.annualizedUsd, null, `${name} stated an annual figure`);
    // Not "evidence is insufficient" — which evidence.
    assert.ok(recommendation.unknowns.length > 0, `${name} named nothing to collect`);
    assert.ok(recommendation.primaryAction.collect.length > 0, name);
    assert.match(recommendation.primaryAction.label, /^Collect /, name);
  }
});

test("the degraded fixtures fail for the three distinct reasons they exist for", () => {
  const named = (fixture) => selectNextStep(fixture, REFERENCE_DAY).unknowns.join(" | ");
  assert.match(named(DEGRADED_FIXTURES.missingRequiredField), /impact basis/);
  assert.match(named(DEGRADED_FIXTURES.staleCapture), /capture newer than 90 days/);
  assert.match(named(DEGRADED_FIXTURES.subMonthObservationWindow), /full calendar month/);
});

test("a sub-month window is excluded and named, never prorated or extrapolated", () => {
  const recommendation = selectNextStep(
    DEGRADED_FIXTURES.subMonthObservationWindow, REFERENCE_DAY);
  assert.match(recommendation.evidenceBoundary, /li-support-chat/);
  assert.match(recommendation.evidenceBoundary, /never prorated/);
  // The twenty-day figure would have been 1080 a month if anyone had scaled it.
  assert.equal(JSON.stringify(recommendation).includes("1080"), false);
});

test("a non-USD amount is a missing input, not a conversion", () => {
  const recommendation = selectNextStep(JOURNEY_FIXTURES.EVIDENCE_INSUFFICIENT, REFERENCE_DAY);
  assert.match(recommendation.unknowns.join(" | "), /USD amount/);
  assert.equal(recommendation.impact.stated, false);
});

// ---------------------------------------------------------------------------
// 3. Determinism.
// ---------------------------------------------------------------------------

test("repeated calls and a shuffled input produce an identical recommendation", () => {
  for (const journeyState of Object.values(JOURNEY_FIXTURES)) {
    const once = selectNextStep(journeyState, REFERENCE_DAY);
    assert.deepEqual(selectNextStep(journeyState, REFERENCE_DAY), once);

    const shuffled = clone(journeyState);
    shuffled.reviews.reverse();
    shuffled.actions.reverse();
    for (const action of shuffled.actions) action.lineItems?.reverse();
    assert.deepEqual(selectNextStep(shuffled, REFERENCE_DAY), once,
      `${once.state} moved when only the input order moved`);
  }
});

test("the recommendation is frozen, so a caller cannot edit the answer it was given", () => {
  const recommendation = selectNextStep(JOURNEY_FIXTURES.VERIFICATION_DUE, REFERENCE_DAY);
  assert.equal(Object.isFrozen(recommendation), true);
  assert.equal(Object.isFrozen(recommendation.impact), true);
});

test("the module reads no clock of its own", async () => {
  const source = await readFile(new URL("../src/finops-next-step.js", import.meta.url), "utf8");
  // The rule the module states in prose, held against the code that has to keep
  // it: comment lines are stripped, so documenting the prohibition is allowed
  // and only an actual call fails here.
  const code = source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");
  assert.equal(/Date\.now\(\)/.test(code), false, "the contract called Date.now()");
  assert.equal(/new Date\(/.test(code), false, "the contract constructed its own clock");
  // And the proof that it matters: a different day is a different answer.
  assert.notEqual(
    selectNextStep(JOURNEY_FIXTURES.NO_CURRENT_REVIEW, "2026-06-15").headline,
    selectNextStep(JOURNEY_FIXTURES.NO_CURRENT_REVIEW, REFERENCE_DAY).headline);
});

// ---------------------------------------------------------------------------
// 4. The metrics, computed the one way the definition allows.
// ---------------------------------------------------------------------------

test("monthly impact rounds half-up once at the sum, never per item", () => {
  const window = { observationStart: "2026-06-01", observationEnd: "2026-06-30" };
  const items = [
    { id: "a", currency: "USD", currentMonthlyCostUsd: 10.4, projectedMonthlyCostUsd: 0, ...window },
    { id: "b", currency: "USD", currentMonthlyCostUsd: 10.1, projectedMonthlyCostUsd: 0, ...window },
  ];
  // Per item it would be 10 + 10 = 20. At the sum it is 20.5, half-up to 21.
  assert.equal(monthlyImpactUsd(items).monthlyUsd, 21);
  assert.equal(annualizedImpactUsd(21), 252);
});

test("a window is complete only when it covers a whole calendar month", () => {
  assert.equal(coversFullCalendarMonth("2026-06-01", "2026-06-30"), true);
  assert.equal(coversFullCalendarMonth("2026-02-01", "2026-02-28"), true);
  assert.equal(coversFullCalendarMonth("2026-06-01", "2026-06-29"), false);
  assert.equal(coversFullCalendarMonth("2026-06-01", "2026-06-20"), false);
  assert.equal(coversFullCalendarMonth("2026-06-15", "2026-07-14"), true);
});

test("capture age lands on high at exactly 35 days and medium at exactly 36", () => {
  const at = (capturedOn) => selectNextStep(
    { ...clone(JOURNEY_FIXTURES.VERIFICATION_DUE), source: { name: "boundary", capturedOn } },
    REFERENCE_DAY);
  assert.equal(CAPTURE_AGE_DAYS.high, 35);
  assert.equal(CAPTURE_AGE_DAYS.medium, 90);
  // 2026-07-15 less 35 days is 2026-06-10; one more day back is 36.
  assert.equal(at("2026-06-10").confidence, CONFIDENCE.high);
  assert.equal(at("2026-06-09").confidence, CONFIDENCE.medium);
  // And the far boundary: 90 days is still an answer, 91 is not.
  assert.equal(at("2026-04-16").confidence, CONFIDENCE.medium);
  assert.equal(at("2026-04-15").state, JOURNEY_STATE.evidenceInsufficient);
});

test("a benchmark-derived figure is medium however fresh the capture is", () => {
  const benchmark = clone(JOURNEY_FIXTURES.VERIFICATION_DUE);
  benchmark.actions[0].impactBasis = "published_benchmark";
  assert.equal(selectNextStep(benchmark, REFERENCE_DAY).confidence, CONFIDENCE.medium);
});

test("provenance names the local source and its capture date, never internal data", () => {
  const recommendation = selectNextStep(JOURNEY_FIXTURES.VERIFICATION_DUE, REFERENCE_DAY);
  assert.equal(recommendation.provenance,
    "local fixture `finops-journey-june-2026`, captured 2026-07-01");
  assert.equal(/internal data/i.test(recommendation.provenance), false);
});

// ---------------------------------------------------------------------------
// 5. The source the briefing actually feeds it.
// ---------------------------------------------------------------------------

const RETAINED = Object.freeze({
  schemaVersion: "monthly-department-action/1.0.0",
  actionId: "route-support",
  actionLabel: "Route support summaries to the standard model",
  department: "Support",
  ownerLabel: "FinOps lead",
  baseline: { value: 1000, unit: "USD/month", period: "2026-06", calculation: "Recoverable spend" },
  target: { value: 700, unit: "USD/month", deadline: "2026-07-10", calculation: "At or below 700" },
  reviewPeriod: "2026-06",
  confidence: "high",
  committedAt: "2026-07-01T12:00:00.000Z",
});

test("a retained monthly action becomes a journey state without inventing a field", () => {
  const journeyState = journeyStateFromRetainedAction(RETAINED, null);
  const recommendation = selectNextStep(journeyState, REFERENCE_DAY);
  // Its deadline has passed and nothing recorded whether it held, which is
  // exactly the loop this screen exists to close.
  assert.equal(recommendation.state, JOURNEY_STATE.verificationDue);
  assert.equal(recommendation.impact.monthlyUsd, 300);
  assert.equal(recommendation.impact.annualizedUsd, 3600);
  assert.equal(journeyState.actions[0].verifiedOutcome, null);
});

test("with no retained action the briefing reads the bundled fixture, and says so", () => {
  const chosen = chooseJourneyState({ retainedAction: null });
  assert.equal(chosen.source, JOURNEY_SOURCE.example);
  assert.match(SAMPLE_LABEL[chosen.source], /Bundled synthetic example/);
  assert.match(SAMPLE_LABEL[JOURNEY_SOURCE.local], /Your own retained records/);
  assert.equal(chooseJourneyState({ retainedAction: RETAINED }).source, JOURNEY_SOURCE.local);
});

// ---------------------------------------------------------------------------
// 6. The screen. The trust surface is legible before any interaction.
// ---------------------------------------------------------------------------

test("the region ships in the briefing as evidence, not as a second answer", () => {
  const doc = region();
  const section = byId(doc, NEXT_STEP_IDS.region);
  assert.ok(section, "the briefing does not carry #finops-next-step");
  assert.equal(section.dataset.decisionSummary, "evidence");
  // #742 folded this section into a `support-disclosure`, and the destination a
  // fragment resolves to is whichever ancestor carries the attribute — so the
  // owner is asserted the way the shell reads it, not off this element alone.
  assert.equal(section.closest("[data-workspace-region]")?.dataset.workspaceRegion, "answer");
  assert.match(textOf(byId(doc, "finops-next-step-question")), /Where do I start this month\?/);
  // Authored above the figures, so the claim is true before a script runs.
  assert.match(textOf(byId(doc, "finops-next-step-sample")), /Bundled synthetic example/);
});

for (const [name, journeyState] of Object.entries(JOURNEY_FIXTURES)) {
  test(`${name} paints its trust surface with no interaction and one primary action`, () => {
    const doc = region();
    const recommendation = selectNextStep(journeyState, REFERENCE_DAY);
    renderNextStep(doc, recommendation, { sample: SAMPLE_LABEL[JOURNEY_SOURCE.example] });

    for (const id of [NEXT_STEP_IDS.headline, NEXT_STEP_IDS.impact, NEXT_STEP_IDS.confidence,
      NEXT_STEP_IDS.provenance, NEXT_STEP_IDS.boundary]) {
      assert.ok(textOf(byId(doc, id)).trim().length > 0, `${name} left #${id} empty`);
    }
    assert.match(textOf(byId(doc, NEXT_STEP_IDS.confidence)), /high|medium|low/);
    assert.match(textOf(byId(doc, NEXT_STEP_IDS.provenance)), /captured \d{4}-\d{2}-\d{2}|not named/);

    const primaries = doc.querySelectorAll("[data-primary-action]");
    assert.equal(primaries.length, 1, `${name} rendered ${primaries.length} primary actions`);
    assert.equal(primaries[0].getAttribute("href"),
      ACTION_TARGET[recommendation.primaryAction.kind]);
    assert.equal(textOf(primaries[0]), recommendation.primaryAction.label);

    // No interaction happened. The four facts above were read from a closed page.
    const details = byId(doc, NEXT_STEP_IDS.details);
    assert.equal(details.hasAttribute("open"), false, `${name} shipped its disclosure open`);
  });
}

test("the disclosure holds the three rationale facts and adds no second call to action", () => {
  const doc = region();
  renderNextStep(doc, selectNextStep(JOURNEY_FIXTURES.VERIFICATION_DUE, REFERENCE_DAY));
  const details = byId(doc, NEXT_STEP_IDS.details);
  const text = textOf(details);
  assert.match(text, /VERIFICATION_DUE/);
  assert.match(text, /outranked/i);
  assert.match(text, /1, ranked below it by monthly impact/);
  // No widget for a runner-up that cannot change what the lead does next.
  assert.equal(textOf(details).includes("a-cache-embeddings"), false);
  assert.equal(details.querySelectorAll("a,button,input,select,table,canvas").length, 0);
});

test("an insufficient state names what to collect and prints no figure on screen", () => {
  const doc = region();
  renderNextStep(doc, selectNextStep(DEGRADED_FIXTURES.staleCapture, REFERENCE_DAY));
  assert.match(textOf(byId(doc, NEXT_STEP_IDS.impact)), /Not stated/);
  assert.equal(/\$\d/.test(textOf(byId(doc, NEXT_STEP_IDS.region))), false,
    "an unsupported dollar figure reached the screen");
  assert.match(textOf(byId(doc, NEXT_STEP_IDS.action)), /^Collect /);
  assert.match(textOf(byId(doc, NEXT_STEP_IDS.unknowns)), /capture newer than 90 days/);
  assert.equal(byId(doc, NEXT_STEP_IDS.region).dataset.confidence, CONFIDENCE.low);
});

test("an unchanged recommendation is left standing, so a repaint cannot close a disclosure", () => {
  const doc = region();
  const recommendation = selectNextStep(JOURNEY_FIXTURES.ACTIONS_PENDING, REFERENCE_DAY);
  renderNextStep(doc, recommendation);
  const details = byId(doc, NEXT_STEP_IDS.details);
  details.setAttribute("open", "");
  renderNextStep(doc, selectNextStep(JOURNEY_FIXTURES.ACTIONS_PENDING, REFERENCE_DAY));
  assert.equal(byId(doc, NEXT_STEP_IDS.details), details, "the disclosure was rebuilt");
  assert.equal(details.hasAttribute("open"), true);
});

test("the AI FinOps entry paints the next step before any fetch, and repaints with the review", async () => {
  const entry = await readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8");
  assert.match(entry, /import \{ renderNextStep \} from "\/finops-next-step-view\.js"/);
  // Once in the synchronous boot, once with the recurring review it shares
  // records with. A region painted only after a fetch is a blank first screen
  // on the run where that fetch never resolves.
  assert.equal((entry.match(/paintNextStep\(\)/g) ?? []).length, 3);
});
