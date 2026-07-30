// The consolidated AI FinOps journey, in the three states a lead arrives in.
//
// Every state here is expressed with the bundled example data and the shipped
// writers — the same monthly-action record and the same retained review
// evidence the product itself stores — so a state that passes here is a state a
// visitor's browser can actually be in. Nothing is asserted on markup shape:
// what is checked is that the question, the one control, and the checkpoint all
// move when the state does, and that opening a disclosure reveals the evidence.

import assert from "node:assert/strict";
import test from "node:test";

import { loadPage, parseHtml, pressEnter, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  REVIEW_EVIDENCE_KEY, REVIEW_EVIDENCE_VERSION, assembleRecurringReview,
} from "../src/recurring-review-readiness.js";
import { renderRecurringReviewWorkspace } from "../src/recurring-review-workspace-view.js";
import { MONTHLY_ACTION_KEY, MONTHLY_ACTION_VERSION } from "../src/monthly-department-action-store.js";
import {
  JOURNEY_STAGE, STAGE_QUESTION, journeyEntryLink, journeyStage, resolveTarget,
} from "../src/finops-journey-stage.js";
import { loadWorkspaceDestinations } from "../src/finops-destination-contract.js";

const PAGE = new URL("../src/savings-action-center.html", import.meta.url);

const action = (overrides = {}) => ({
  schemaVersion: MONTHLY_ACTION_VERSION,
  decisionVersion: "monthly-department-decision/1.0.0",
  actionId: "route-short-lookups",
  actionLabel: "Route short lookups to the efficient model",
  department: "Atlas Platform",
  ownerLabel: "AI Platform product owner",
  baseline: {
    value: 1200, unit: "USD/month", period: "2026-06",
    aggregation: "Monthly eligible recoverable spend",
    calculation: "Sum eligible row deltas",
  },
  target: {
    value: 0, unit: "USD/month remaining avoidable spend",
    deadline: "2026-07-31", calculation: "baseline minus verified reduction",
  },
  reviewPeriod: "2026-07",
  confidence: "high",
  provenanceReferences: ["fix-pack:1"],
  committedAt: "2026-06-30T12:00:00.000Z",
  ...overrides,
});

const analysis = (period = "2026-07", value = 900) => ({
  schemaVersion: "local-finops/1.0.0",
  period,
  rankedDepartments: [{ name: "Atlas Platform", recoverableUsd: value }],
});

const evidence = (currentAnalysis) => JSON.stringify({
  schemaVersion: REVIEW_EVIDENCE_VERSION,
  currentAnalysis,
  theoVerdict: { state: "all_clear", measured: true, coveragePercent: 96, rows: 24, confidence: "high" },
});

/**
 * The three journeys, as this browser's own storage holds them.
 *
 * `new` has nothing retained. `resumed` retains an action but its carried
 * evidence is from the baseline month, so the comparison is not available yet —
 * Rowan's carry-across is what puts that evidence there, and it is read back
 * through the same key rather than reconstructed here. `verification_ready`
 * carries a later comparable period, so the checkpoint is due.
 */
const STORAGE = Object.freeze({
  new_review: {},
  resumed_review: {
    [MONTHLY_ACTION_KEY]: JSON.stringify(action()),
    [REVIEW_EVIDENCE_KEY]: evidence(analysis("2026-06")),
  },
  verification_ready: {
    [MONTHLY_ACTION_KEY]: JSON.stringify(action()),
    [REVIEW_EVIDENCE_KEY]: evidence(analysis()),
  },
});

async function openJourney(stage) {
  const page = await loadPage(PAGE, { storage: STORAGE[stage] });
  await importPageModule("/savings-action-center-page.js");
  await waitFor(() => page.document.querySelector(".sac-journey"), `the ${stage} journey`);
  return page;
}

const destinationFor = (role) =>
  loadWorkspaceDestinations().record.destinations.find((entry) => entry.role === role);

test("each of the three journeys asks its own question and offers its own step", async () => {
  const seen = new Map();
  for (const stage of Object.keys(STORAGE)) {
    const page = await openJourney(stage);
    try {
      const { document } = page;
      const view = document.querySelector(".sac-journey");
      assert.equal(view.dataset.journeyStage, stage, `${stage} names itself on the view`);

      // The lead question is this stage's, and it is the only h2 in the view.
      const question = document.getElementById("sac-question");
      assert.equal(question.textContent, STAGE_QUESTION[stage]);
      assert.equal(question.tagName, "H2");

      // The one control, and where it goes.
      const control = document.getElementById("sac-primary-action");
      const checkpoint = document.getElementById("sac-checkpoint");
      seen.set(stage, {
        question: question.textContent,
        label: control.textContent,
        target: control.getAttribute("href"),
        checkpoint: checkpoint.dataset.checkpoint,
      });

      // The checkpoint is a region with a heading, not a badge on the decision.
      assert.equal(checkpoint.getAttribute("aria-labelledby"), "sac-checkpoint-title");
      assert.ok(textOf(checkpoint).length > 40, "the checkpoint says something in every state");
      // No blank panels and no leaked placeholders anywhere in the view.
      assert.doesNotMatch(textOf(view), /undefined|NaN|\[object|null/);
    } finally {
      page.restore();
    }
  }

  // All three differ in all three places. A state that changed only a badge
  // would collapse one of these sets to fewer than three entries.
  for (const field of ["question", "label", "checkpoint"]) {
    const values = new Set([...seen.values()].map((entry) => entry[field]));
    assert.equal(values.size, 3, `${field} differs across all three journeys`);
  }
  assert.deepEqual([...seen.keys()],
    [JOURNEY_STAGE.new, JOURNEY_STAGE.resumed, JOURNEY_STAGE.verification]);
});

test("the primary control's label, target, and state all come from the destination contract", async () => {
  // New review: the contract's department-detail door, reached from this page
  // and therefore carrying the briefing page in front of its fragment.
  const fresh = await openJourney("new_review");
  try {
    const contract = destinationFor("department-detail");
    const control = fresh.document.getElementById("sac-primary-action");
    assert.equal(control.textContent, contract.callToAction ?? contract.label);
    assert.equal(control.getAttribute("href"), `/evolution.html${contract.href}`);
    assert.equal(control.dataset.enabled, "true");
    assert.equal(fresh.document.getElementById("sac-decision-title").textContent, contract.label);
    // The step names what it answers, and the control is described by it.
    assert.equal(textOf(fresh.document.getElementById("sac-decision-note")), contract.answers);
    assert.match(control.getAttribute("aria-describedby") ?? "", /sac-decision-note/);
  } finally {
    fresh.restore();
  }

  // Verification ready: the act-and-verify door is this very page, so it
  // resolves to the checkpoint region rather than reloading the reader onto the
  // screen they are already reading.
  const due = await openJourney("verification_ready");
  try {
    const contract = destinationFor("act-and-verify");
    const control = due.document.getElementById("sac-primary-action");
    assert.equal(control.textContent, contract.callToAction ?? contract.label);
    assert.equal(control.getAttribute("href"), "#sac-checkpoint");
    assert.ok(due.document.getElementById("sac-checkpoint"), "and that region exists to be reached");
  } finally {
    due.restore();
  }
});

test("a resumed review with no current analysis disables the step and says why", () => {
  // The realistic degraded shape: the action was retained, the carried evidence
  // was not. The control stays on screen, focusable, and states the reason.
  const review = {
    state: "blocked", ready: false, code: "analysis_missing",
    evidenceBoundary: { gaps: ["current_analysis_missing"] },
    current: { value: null }, verdict: { wording: "" }, recommendation: null,
  };
  const journey = journeyStage({ review, retainedAction: action() });
  assert.equal(journey.stage, JOURNEY_STAGE.resumed);
  assert.equal(journey.nextAction.enabled, false);
  assert.match(journey.nextAction.disabledReason, /no current local analysis/i);
  // The label is still the contract's: a blocked step is not a different step.
  assert.equal(journey.nextAction.label, destinationFor("evidence").label);
  assert.deepEqual([...journey.degraded], ["Current local analysis"]);
  assert.equal(journey.checkpoint.status, "waiting");
  assert.equal(journey.checkpoint.due, "2026-07-31");
});

test("a destination record that failed its contract leaves a stated step, not a blank one", () => {
  const journey = journeyStage({
    review: null, destinations: { valid: false, record: null, errors: ["broken"] },
  });
  assert.equal(journey.stage, JOURNEY_STAGE.new);
  assert.equal(journey.nextAction.enabled, false);
  assert.equal(journey.nextAction.href, null);
  assert.match(journey.nextAction.disabledReason, /destination contract could not be read/);
  assert.equal(journey.empty, true);
});

test("expanding a disclosure reveals the evidence behind the recommendation", async () => {
  const page = await openJourney("verification_ready");
  try {
    const { document } = page;
    const trigger = document.getElementById("sac-prior-result-trigger");
    const panel = document.getElementById("sac-prior-result-panel");
    // Collapsed is genuinely collapsed: hidden, out of the tab sequence, and
    // reporting its own state to assistive technology.
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(panel.hidden, true);
    assert.equal(trigger.getAttribute("aria-controls"), "sac-prior-result-panel");

    trigger.focus();
    pressEnter(document);
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.equal(panel.hidden, false);
    // And what it reveals is the prior action's own result, not a restatement
    // of the recommendation above it.
    const revealed = textOf(panel);
    assert.match(revealed, /Route short lookups to the efficient model/);
    assert.match(revealed, /2026-07-31/);
    assert.match(revealed, /Due now/);
  } finally {
    page.restore();
  }
});

test("the briefing and the local workspace both open this journey by its contract name", async () => {
  const entry = journeyEntryLink();
  const contract = destinationFor("act-and-verify");
  assert.equal(entry.label, contract.label);
  assert.equal(entry.href, contract.href);

  // The local workspace's door is a real anchor with a real href, so it works
  // before any script on that page runs.
  const workspace = await loadPage(new URL("../src/workspace.html", import.meta.url), { storage: {} });
  try {
    const link = workspace.document.getElementById("ws-journey-link");
    assert.equal(link.getAttribute("href"), entry.href);
    assert.equal(link.textContent, entry.label);
    assert.ok(workspace.document.getElementById(link.getAttribute("aria-describedby")),
      "the door explains where it goes");
  } finally {
    workspace.restore();
  }

  // The briefing's recurring-review block paints the same door, from the same
  // contract, with the stage it is continuing named beside it. It is rendered
  // through the function `evolution-page.js` calls on every guided-result sync.
  const doc = parseHtml(`<main><section id="guided-result">
    <section id="recurring-review-workspace" hidden></section></section></main>`);
  renderRecurringReviewWorkspace(doc, assembleRecurringReview({
    retainedAction: action(),
    currentAnalysis: analysis(),
    theoVerdict: { state: "all_clear", measured: true, coveragePercent: 96, rows: 24, confidence: "high" },
  }), action());
  const briefingLink = doc.getElementById("recurring-review-journey");
  assert.equal(briefingLink.getAttribute("href"), entry.href);
  assert.equal(briefingLink.textContent, entry.label);
  assert.ok(textOf(doc.getElementById("recurring-review-journey-note"))
    .includes(STAGE_QUESTION.verification_ready));
});

test("a contract fragment is read against the page it was authored for", () => {
  assert.equal(resolveTarget("#recommendation-evidence", "/evolution.html"), "#recommendation-evidence");
  assert.equal(resolveTarget("#recommendation-evidence", "/savings-action-center.html"),
    "/evolution.html#recommendation-evidence");
  assert.equal(resolveTarget("/savings-action-center.html", "/evolution.html"),
    "/savings-action-center.html");
  assert.equal(resolveTarget("/savings-action-center.html", "/savings-action-center.html"),
    "#sac-checkpoint");
});
