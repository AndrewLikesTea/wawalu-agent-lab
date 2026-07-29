// The outcome of one recorded decision: four states, one comparison, one step.
//
// Every record here is built in the test from one synthetic imported analysis —
// no committed fixture, no clock, no storage, no network — and the decision goes
// through `buildCommitmentDecision`, so these assertions are made against the
// metadata block that path actually writes rather than against a hand-authored
// copy of it that could drift.

import test from "node:test";
import assert from "node:assert/strict";
import { createElement, installDocument } from "./support/dom.js";
import { buildCommitmentDecision } from "../src/finops-commitment-decision.js";
import { buildSavingsCommitment } from "../src/savings-commitment.js";
import { VERIFICATION_UNAVAILABLE_REASON } from "../src/commitment-verification.js";
import {
  DECISION_OUTCOME_QUESTION,
  OUTCOME_CONFIDENCE_RULES,
  OUTCOME_REASON,
  OUTCOME_STATUS,
  OUTCOME_STATUS_CUE,
  OUTCOME_STATUS_FROM_REASON,
  commitmentFromDecision,
  decisionOutcome,
  observationFromBriefing,
  outcomeMonthLabel,
  shippingRelease,
} from "../src/decision-outcome.js";

const IMPORTED_AT = "2026-05-01T06:00:00.000Z";
const APPROVED_AT = "2026-05-04T09:30:00.000Z";

function candidate(overrides = {}) {
  return {
    candidateId: "route-support-summaries",
    workloadScope: { workloadId: "support-summaries", description: "the summaries workload", period: "2026-05" },
    department: { departmentId: "customer-support", name: "Customer Support" },
    accountableOwner: { role: "Director of Support Engineering" },
    recordIds: ["record-a", "record-b"],
    routing: {
      currentRoute: { modelId: "frontier-large" },
      proposedRoute: { modelId: "efficient-small" },
      workloadId: "support-summaries",
      rationale: "The measured output length fits the smaller model's published envelope.",
      evidence: [{ recordId: "record-a", statement: "Sampled calls stayed inside the envelope." }],
    },
    baseline: { monthlyCostMinor: 1_200_000, workloadId: "support-summaries", period: "2026-05" },
    projected: { monthlyCostMinor: 718_000, workloadId: "support-summaries", period: "2026-05" },
    confidence: { percent: 78, basis: "Measured across a full month of provider records." },
    ...overrides,
  };
}

function analysis(overrides = {}) {
  return {
    schemaVersion: "savings-commitment-input/1.0.0",
    source: {
      sourceId: "decision-outcome-source",
      importedAt: IMPORTED_AT,
      analysisPeriod: "2026-05",
      designation: "imported",
      currency: "USD",
      unit: "usd_minor",
      recordIds: ["record-a", "record-b"],
    },
    candidates: [candidate(overrides.candidate)],
  };
}

function decision(overrides = {}) {
  return buildCommitmentDecision({
    preview: buildSavingsCommitment(analysis(overrides.analysis)),
    approvedBy: "Dana Okafor",
    approvedAt: APPROVED_AT,
  });
}

function release(overrides = {}) {
  return {
    id: "release-outcome-1",
    version: "2026.06.01",
    owner: "Priya Raman",
    status: "shipped",
    createdAt: "2026-05-28T12:00:00.000Z",
    decisionIds: ["finops-commitment-route-support-summaries"],
    ...overrides,
  };
}

// A later month, shaped as `observationFromBriefing` produces it: the committed
// route's own spend in the committed org unit. `currentSpendUsd` is dollars, and
// the period is the half-open month interval `calendarMonth` reads.
function observation({
  spendUsd = 7_000, unitId = "customer-support", model = "frontier-large", period = "2026-06-01 to 2026-07-01",
} = {}) {
  return {
    period,
    modelRouting: {
      ranked: [{ unitId, candidates: [{ model, currentSpendUsd: spendUsd }], excludedModels: [] }],
      insufficientData: [],
    },
  };
}

const META = Object.freeze({
  name: "finops-2026-06.json", month: "2026-06", dataset: "user", savedOn: "2026-07-01",
});

const shipped = (extra = {}) => decisionOutcome({
  decision: decision(), releases: [release()], observation: observation(), observationMeta: META, ...extra,
});

/* --------------------------------- states ---------------------------------- */

test("a month that beat the projection is verified, with one comparison and the verdict kept", () => {
  const outcome = shipped();
  assert.equal(outcome.question, DECISION_OUTCOME_QUESTION);
  assert.equal(outcome.status, OUTCOME_STATUS.verified);
  assert.equal(outcome.reason, null);
  assert.equal(outcome.verdict, "achieved");
  assert.equal(outcome.cue.label, "Verified");
  assert.equal(outcome.cue.shape, "solid");
  // $12,000 baseline, $7,000 observed, so $5,000 realized against $4,820 projected.
  assert.equal(outcome.comparison.observedText, "$5,000.00");
  assert.equal(outcome.comparison.projectedText, "$4,820.00");
  assert.equal(outcome.comparison.varianceText, "+$180.00");
  assert.equal(outcome.comparison.attainmentPercent, 104);
  assert.equal(outcome.comparison.direction, "at_or_above");
  assert.equal(outcome.comparison.baselinePeriod, "2026-05");
  assert.equal(outcome.comparison.observedPeriod, "2026-06");
});

test("a month that saved less than projected is underperforming, not unverified", () => {
  const outcome = shipped({ observation: observation({ spendUsd: 9_000 }) });
  assert.equal(outcome.status, OUTCOME_STATUS.underperforming);
  assert.equal(outcome.verdict, "under_realized");
  assert.equal(outcome.cue.shape, "double");
  assert.equal(outcome.comparison.direction, "below");
  assert.equal(outcome.comparison.varianceText, "−$1,820.00");
  assert.equal(outcome.comparison.attainmentPercent, 62);
  assert.match(outcome.nextAction.label, /Review the route/);
});

test("a route that got more expensive is underperforming with its own next step", () => {
  const outcome = shipped({ observation: observation({ spendUsd: 13_000 }) });
  assert.equal(outcome.status, OUTCOME_STATUS.underperforming);
  assert.equal(outcome.verdict, "not_realized");
  assert.equal(outcome.comparison.observedText, "−$1,000.00");
  assert.match(outcome.nextAction.label, /actually reached production/);
});

test("a later month that does not describe this decision's org unit is unmatched, not inconclusive", () => {
  const outcome = shipped({ observation: observation({ unitId: "platform-engineering" }) });
  assert.equal(outcome.status, OUTCOME_STATUS.unmatched);
  assert.equal(outcome.reason, VERIFICATION_UNAVAILABLE_REASON.departmentNotObserved);
  assert.equal(outcome.cue.shape, "dotted");
  assert.equal(outcome.comparison, null);
  assert.match(outcome.nextAction.label, /org unit/);
});

test("a month that is not the one after the baseline is unmatched rather than compared anyway", () => {
  const outcome = shipped({ observation: observation({ period: "2026-08-01 to 2026-09-01" }) });
  assert.equal(outcome.status, OUTCOME_STATUS.unmatched);
  assert.equal(outcome.reason, VERIFICATION_UNAVAILABLE_REASON.observationPeriodNotPaired);
});

test("no later month opened is inconclusive and asks for the month after the baseline", () => {
  const outcome = shipped({ observation: null, observationMeta: null });
  assert.equal(outcome.status, OUTCOME_STATUS.inconclusive);
  assert.equal(outcome.reason, VERIFICATION_UNAVAILABLE_REASON.noObservation);
  assert.equal(outcome.cue.shape, "dashed");
  assert.equal(outcome.comparison, null);
  assert.match(outcome.nextAction.label, /month after the baseline/);
});

test("withheld attribution is inconclusive and never a verdict computed anyway", () => {
  const outcome = shipped({ attributionWithheld: true });
  assert.equal(outcome.status, OUTCOME_STATUS.inconclusive);
  assert.equal(outcome.reason, VERIFICATION_UNAVAILABLE_REASON.attributionWithheld);
  assert.equal(outcome.comparison, null);
});

test("a decision with no FinOps commitment metadata says so instead of measuring nothing", () => {
  const outcome = decisionOutcome({
    decision: { id: "plain-1", title: "Adopt trunk-based development", owner: "Ada", status: "accepted" },
    releases: [release({ decisionIds: ["plain-1"] })],
  });
  assert.equal(outcome.status, OUTCOME_STATUS.inconclusive);
  assert.equal(outcome.reason, OUTCOME_REASON.notACommitmentDecision);
  assert.equal(outcome.comparison, null);
  assert.equal(outcome.confidence, null);
  assert.equal(outcome.provenance, null);
  assert.equal(outcome.decision.title, "Adopt trunk-based development");
});

test("no decision at all is a state with a way back, not an empty model", () => {
  const outcome = decisionOutcome({});
  assert.equal(outcome.status, OUTCOME_STATUS.inconclusive);
  assert.equal(outcome.reason, OUTCOME_REASON.noDecision);
  assert.equal(outcome.decision, null);
  assert.equal(outcome.nextAction.href, "/");
});

/* ------------------------------ the linked data ---------------------------- */

test("a decision no release links to is never verified, however good the month looks", () => {
  const outcome = shipped({ releases: [] });
  assert.equal(outcome.status, OUTCOME_STATUS.inconclusive);
  assert.equal(outcome.reason, OUTCOME_REASON.releaseNotRecorded);
  assert.equal(outcome.linkedRelease, null);
  assert.match(outcome.nextAction.label, /Record the release/);
  assert.match(outcome.statement, /not this decision's result/);
});

test("a release recorded after the observed month cannot have caused it", () => {
  const outcome = shipped({ releases: [release({ createdAt: "2026-08-02T09:00:00.000Z" })] });
  assert.equal(outcome.status, OUTCOME_STATUS.inconclusive);
  assert.equal(outcome.reason, OUTCOME_REASON.releaseNotBeforeObservation);
  // The figures are still computed and shown: the reader is told the month is
  // the wrong one, not left guessing whether there was a figure at all.
  assert.equal(outcome.comparison.observedText, "$5,000.00");
  assert.equal(outcome.linkedRelease.month, "2026-08");
});

test("a release in the observed month does not claim the mixed month as its outcome", () => {
  const outcome = shipped({ releases: [release({ createdAt: "2026-06-02T09:00:00.000Z" })] });
  assert.equal(outcome.status, OUTCOME_STATUS.inconclusive);
  assert.equal(outcome.reason, OUTCOME_REASON.releaseNotBeforeObservation);
  assert.match(outcome.statement, /not a full post-release period/);
  assert.match(outcome.nextAction.label, /first full month/);
});

test("the earliest linked release is the one that shipped the decision", () => {
  const record = decision();
  const early = release({ id: "release-early", createdAt: "2026-05-20T09:00:00.000Z" });
  const late = release({ id: "release-late", createdAt: "2026-09-01T09:00:00.000Z" });
  assert.equal(shippingRelease(record, [late, early]).id, "release-early");
  const outcome = shipped({ releases: [late, early] });
  assert.equal(outcome.linkedRelease.id, "release-early");
  assert.equal(outcome.linkedRelease.href, "/release.html?id=release-early");
});

test("a release that links to some other decision is not this decision's release", () => {
  const outcome = shipped({ releases: [release({ decisionIds: ["some-other-decision"] })] });
  assert.equal(outcome.reason, OUTCOME_REASON.releaseNotRecorded);
});

/* ------------------------- confidence, evidence, steps --------------------- */

test("confidence starts at the commitment's own band and is only ever lowered", () => {
  assert.equal(shipped().confidence.level, "high");
  assert.equal(shipped().confidence.statedPercent, 78);
  const unshipped = shipped({ releases: [] });
  assert.equal(unshipped.confidence.level, "medium");
  assert.ok(unshipped.confidence.reasons.includes(OUTCOME_CONFIDENCE_RULES.notShipped));
  const demo = shipped({ observationMeta: { ...META, dataset: "example" } });
  assert.equal(demo.confidence.level, "medium");
  assert.ok(demo.confidence.reasons.includes(OUTCOME_CONFIDENCE_RULES.exampleData));
});

test("confidence cannot fall below the weakest rung however many rules apply", () => {
  const outcome = decisionOutcome({
    decision: decision({ analysis: { candidate: { confidence: { percent: 51, basis: "Two weeks of records." } } } }),
    releases: [],
    observation: observation(),
    observationMeta: { ...META, dataset: "example" },
  });
  assert.equal(outcome.confidence.startedAt, "medium");
  assert.equal(outcome.confidence.level, "low");
});

test("both sides of the comparison are cited, and every gap in them is named", () => {
  const outcome = shipped();
  assert.equal(outcome.evidence.complete, true);
  assert.deepEqual(outcome.evidence.gaps, []);
  assert.equal(outcome.evidence.baselineRecordCount, 2);
  assert.equal(outcome.evidence.observedRecordCount, 1);
  assert.deepEqual([...new Set(outcome.evidence.citations.map((entry) => entry.side))],
    ["observed", "baseline"]);
  assert.equal(outcome.evidence.citations[0].recordId,
    "observation-2026-06-customer-support-frontier-large");

  const incomplete = shipped({ releases: [], observationMeta: { ...META, dataset: "example" } });
  assert.equal(incomplete.evidence.complete, false);
  assert.equal(incomplete.evidence.gaps.length, 2);
});

test("the disclosures carry the arithmetic and the two months, quoted from verification", () => {
  const outcome = shipped();
  assert.deepEqual(outcome.calculation.steps.map((step) => step.label), [
    "Observed monthly saving",
    "Variance against the projection",
    "Where the verdict boundary falls",
  ]);
  assert.match(outcome.calculation.steps[0].formula, /1200000 - 700000 = 500000 minor units/);
  assert.match(outcome.calculation.caveat, /UPPER BOUND/);
  assert.deepEqual(outcome.periodComparison.rows.map((entry) => entry.costText),
    ["$12,000.00", "$7,000.00", "$7,180.00"]);
  assert.equal(outcome.periodComparison.rows[1].periodLabel, "June 2026");
});

test("provenance names the analysis the decision was priced from and the month opened", () => {
  const outcome = shipped();
  assert.equal(outcome.provenance.sourceId, "decision-outcome-source");
  assert.equal(outcome.provenance.designation, "imported");
  assert.equal(outcome.provenance.baselinePeriod, "2026-05");
  assert.equal(outcome.provenance.observedPeriod, "2026-06");
  assert.equal(outcome.provenance.observedFrom, "finops-2026-06.json");
});

/* ------------------------------- the mappings ------------------------------ */

test("every verification refusal and every reason this module raises maps to a state", () => {
  const reasons = [
    ...Object.values(VERIFICATION_UNAVAILABLE_REASON),
    ...Object.values(OUTCOME_REASON),
  ];
  for (const reason of reasons) {
    assert.ok(OUTCOME_STATUS_FROM_REASON[reason], `${reason} has no state`);
    assert.ok(Object.values(OUTCOME_STATUS).includes(OUTCOME_STATUS_FROM_REASON[reason]));
  }
  assert.equal(Object.keys(OUTCOME_STATUS_FROM_REASON).length, reasons.length);
});

test("each state carries a distinct word and a distinct non-colour shape", () => {
  const cues = Object.values(OUTCOME_STATUS).map((status) => OUTCOME_STATUS_CUE[status]);
  assert.equal(new Set(cues.map((cue) => cue.label)).size, 4);
  assert.equal(new Set(cues.map((cue) => cue.shape)).size, 4);
  assert.equal(new Set(cues.map((cue) => cue.glyph)).size, 4);
});

/* ------------------------------ the input readers -------------------------- */

test("the commitment is projected from the decision's stored block, never re-derived", () => {
  const commitment = commitmentFromDecision(decision());
  assert.equal(commitment.commitmentId, "route-support-summaries");
  assert.equal(commitment.department.departmentId, "customer-support");
  assert.equal(commitment.routing.currentRoute.modelId, "frontier-large");
  assert.equal(commitment.baseline.monthlyCostMinor, 1_200_000);
  assert.equal(commitment.projectedMonthlySavings.amountMinor, 482_000);
  assert.deepEqual(commitment.provenance.recordIds, ["record-a", "record-b"]);
  assert.equal(commitmentFromDecision({ id: "plain" }), null);
  assert.equal(commitmentFromDecision(null), null);
});

test("a briefing observes nothing unless its own commitment block reports a route", () => {
  const entry = {
    periodText: "2026-06-01 to 2026-07-01",
    commitment: {
      status: "ok",
      commitment: {
        department: { departmentId: "customer-support" },
        routing: { currentRoute: { modelId: "frontier-large" } },
        baseline: { monthlyCostUsd: 7_000 },
      },
    },
  };
  assert.equal(observationFromBriefing(entry).modelRouting.ranked[0].unitId, "customer-support");
  assert.equal(observationFromBriefing({ ...entry, commitment: { status: "unavailable" } }), null);
  assert.equal(observationFromBriefing(null), null);
});

test("a month is labelled for reading, and an unreadable one says so", () => {
  assert.equal(outcomeMonthLabel("2026-06"), "June 2026");
  assert.equal(outcomeMonthLabel("2026-13"), "an unreadable month");
  assert.equal(outcomeMonthLabel(null), "an unreadable month");
});

/* -------------------------------- the wiring ------------------------------- */

const { initDecisionOutcome, loadDecisionOutcome, readObservationFile } =
  await import("../src/decision-outcome-page.js");

test("the page resolves the decision out of the visitor's own log and its releases", () => {
  const record = decision();
  const loadData = () => ({ decisions: [record], releases: [release()] });
  const outcome = loadDecisionOutcome(record.id, null, {
    loadData, detailSeeds: [], observation: observation(), observationMeta: META,
  });
  assert.equal(outcome.status, OUTCOME_STATUS.verified);
  assert.equal(outcome.decision.id, record.id);
  assert.equal(outcome.linkedRelease.id, "release-outcome-1");

  const missing = loadDecisionOutcome("not-a-decision", null, { loadData, detailSeeds: [] });
  assert.equal(missing.reason, OUTCOME_REASON.noDecision);
});

test("a file that is not a saved briefing is reported with the reader's own sentence", () => {
  const read = readObservationFile({ name: "notes.txt", text: "not json at all", byteSize: 15 });
  assert.equal(read.observation, null);
  assert.equal(read.observationMeta, null);
  assert.match(read.message, /^notes\.txt: /);
  assert.ok(read.message.length > "notes.txt: ".length);
});

test("a slower file read cannot overwrite a newer briefing selection", async () => {
  installDocument();
  const outcome = createElement("div");
  const input = createElement("input");
  const status = createElement("p");
  const nodes = {
    "#decision-outcome": outcome,
    "#dout-file": input,
    "#dout-file-status": status,
  };
  globalThis.document.querySelector = (selector) => nodes[selector] ?? null;
  globalThis.document.documentElement = createElement("html");
  globalThis.window = { location: { search: "?id=decision-1" } };
  globalThis.localStorage = {};

  initDecisionOutcome({
    loadData: () => ({ decisions: [], releases: [] }),
    detailSeeds: [],
  });
  const onChange = input.listeners.change[0];
  let finishSlow;
  const slowText = new Promise((resolve) => { finishSlow = resolve; });
  const slow = onChange({
    target: { files: [{ name: "older.json", size: 4, text: () => slowText }] },
  });
  const fast = onChange({
    target: { files: [{ name: "newer.json", size: 4, text: async () => "nope" }] },
  });

  await fast;
  finishSlow("also nope");
  await slow;

  assert.match(status.textContent, /^newer\.json:/,
    "the status and outcome must continue to describe the newest file selected");
});
