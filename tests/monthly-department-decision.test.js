import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { EXCLUSION_REASONS, UNPRICED_REASONS } from "../src/department-fix-pack.js";
import {
  CONFIDENCE, MISSING_EVIDENCE, MONTHLY_DECISION_EXAMPLES, MONTHLY_DECISION_STATE,
  monthlyCycle, monthlyDepartmentDecision,
} from "../src/monthly-department-decision.js";
import { applyMonthlyDepartmentDecision } from "../src/monthly-department-decision-view.js";
import {
  FINOPS_CONSENT, readRetainedCommitments, retainFinopsPeriod, setFinopsConsent,
} from "../src/finops-workspace.js";
import { loadPage, textOf } from "./support/browser.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

function lead({
  monthlySavingsUsd = 1840,
  basis = "down_routing_delta",
  unpricedReasonCode = null,
  level = "medium",
} = {}) {
  return Object.freeze({
    action: Object.freeze({
      id: "route-short-lookups",
      kind: "routing",
      name: "Route short lookups to the standard tier",
    }),
    monthlySavingsUsd,
    savings: Object.freeze({ basis, unpricedReasonCode }),
    confidence: Object.freeze({
      level,
      reasons: Object.freeze(level === "medium" ? [Object.freeze({
        detail: "Coverage omitted some provider rows.",
      })] : []),
      inheritedReasons: Object.freeze([]),
    }),
    provenance: Object.freeze({
      fixPackVersion: "department-fix-pack/1.0.0",
      rubricVersion: "prompt-literacy/2026-05",
      classifierVersion: "query-classification/1.2.0",
      evidence: Object.freeze(["signal:model_fit", "routing:down-routing/1.1.0"]),
    }),
  });
}

function pack(intervention = lead()) {
  return Object.freeze({
    version: "department-fix-pack/1.0.0",
    state: "ready",
    department: "Atlas Platform",
    interventions: Object.freeze([intervention]),
  });
}

function storageOf() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function period(month, spend, version = "finops-briefing/1.0.0") {
  return {
    periodId: `user:${month}`,
    period: month,
    dataset: "user",
    briefingContractVersion: version,
    derivedAt: `${month}-28T12:00:00.000Z`,
    sourceFingerprint: `source-${month}`,
    analyzedSpendMinor: spend,
    attributedSpendMinor: spend,
    recoverableScenarioMinor: 184000,
    recordsTotal: 10,
    recordsAnalyzed: 10,
    coverageRatioPpm: 1_000_000,
    confidence: "high",
    missingInputs: [],
    materialMetricId: "recoverable_scenario",
    materialMetricMinor: 184000,
    absenceReason: null,
    topDepartmentId: "atlas-platform",
  };
}

test("ready contract defines every metric field and preserves the four-question order", () => {
  const decision = monthlyDepartmentDecision(pack(), {
    cycle: Object.freeze({
      period: "2026-07",
      deadline: "2026-07-31",
      reviewPeriod: "2026-08",
    }),
  });

  assert.equal(decision.state, MONTHLY_DECISION_STATE.ready);
  assert.deepEqual(decision.questionOrder, [
    "What action should we track this month?",
    "What baseline and target make it trackable?",
    "How confident are we and why?",
    "What should happen locally next?",
  ]);
  assert.deepEqual(
    Object.keys(decision.baseline).sort(),
    ["aggregation", "calculation", "name", "period", "unit", "value"],
  );
  assert.deepEqual(
    Object.keys(decision.target).sort(),
    ["calculation", "deadline", "unit", "value"],
  );
  assert.equal(decision.baseline.value, 1840);
  assert.equal(decision.baseline.unit, "USD/month");
  assert.match(decision.baseline.aggregation, /Sum of eligible row-level/);
  assert.match(decision.baseline.calculation, /actual monthly USD minus projected monthly USD/);
  assert.equal(decision.target.value, 0);
  assert.equal(decision.target.deadline, "2026-07-31");
  assert.equal(decision.ownerLabel, "AI Platform product owner");
  assert.equal(decision.reviewPeriod, "2026-08");
  assert.equal(decision.confidence.value, CONFIDENCE.medium.value);
  assert.deepEqual(decision.confidence.reasons, ["Coverage omitted some provider rows."]);
  assert.deepEqual(decision.evidenceReferences.slice(0, 2),
    ["signal:model_fit", "routing:down-routing/1.1.0"]);
});

test("the UTC calendar cycle has one unambiguous month-end and next review period", () => {
  assert.deepEqual(monthlyCycle(new Date("2028-02-12T23:00:00-08:00")), {
    period: "2028-02",
    deadline: "2028-02-29",
    reviewPeriod: "2028-03",
  });
});

test("insufficient evidence creates no action, baseline, or target and names the gap", () => {
  const decision = monthlyDepartmentDecision(pack(lead({
    monthlySavingsUsd: null,
    unpricedReasonCode: "no_monthly_spend_basis",
  })));

  assert.equal(decision.state, MONTHLY_DECISION_STATE.insufficient);
  assert.equal(decision.action, null);
  assert.equal(decision.baseline, null);
  assert.equal(decision.target, null);
  assert.equal(decision.ownerLabel, null);
  assert.equal(decision.reviewPeriod, null);
  assert.equal(decision.confidence.value, CONFIDENCE.not_scored.value);
  assert.deepEqual(decision.missingEvidence, [{
    code: "no_monthly_spend_basis",
    evidence: "A department-level monthly spend basis in USD",
  }]);
  assert.match(decision.localNextStep, /create no trackable action yet/i);
});

test("matching existing tracking is non-duplicative; a different action is not a match", () => {
  const tracking = Object.freeze({
    department: "Atlas Platform",
    actionId: "route-short-lookups",
    status: "On track",
    reference: "local-action-2026-07-atlas-routing",
  });
  const tracked = monthlyDepartmentDecision(pack(), { tracking });
  const different = monthlyDepartmentDecision(pack(), {
    tracking: Object.freeze({ ...tracking, actionId: "another-action" }),
  });

  assert.equal(tracked.state, MONTHLY_DECISION_STATE.tracked);
  assert.deepEqual(tracked.tracking, {
    status: "On track",
    reference: "local-action-2026-07-atlas-routing",
  });
  assert.match(tracked.localNextStep, /do not create a duplicate/i);
  assert.equal(different.state, MONTHLY_DECISION_STATE.ready);
});

test("a tracking record without an action id never claims to track an untrackable finding", () => {
  // A caller record matching on department alone previously outranked the
  // evidence check: a withheld pack threw, and an unpriced one rendered a
  // tracked action with a null owner and no baseline.
  const withheld = Object.freeze({
    version: "department-fix-pack/1.0.0",
    state: "withheld",
    department: "Atlas Platform",
    reasonCode: "department_not_graded",
    interventions: Object.freeze([]),
    excluded: Object.freeze([]),
  });
  const partial = Object.freeze({
    department: "Atlas Platform", status: "On track", reference: "local-action-2026-07",
  });

  for (const target of [withheld, pack(lead({
    monthlySavingsUsd: null, unpricedReasonCode: "no_monthly_spend_basis",
  }))]) {
    const decision = monthlyDepartmentDecision(target, { tracking: partial });
    assert.equal(decision.state, MONTHLY_DECISION_STATE.insufficient);
    assert.equal(decision.action, null);
    assert.equal(decision.tracking, null);
    assert.equal(decision.ownerLabel, null);
    assert.ok(decision.missingEvidence.length > 0);
  }
});

test("every producer reason code has an evidence gloss, so none degrades to rule prose", () => {
  for (const code of [...Object.values(UNPRICED_REASONS), ...Object.values(EXCLUSION_REASONS)]) {
    assert.equal(typeof MISSING_EVIDENCE[code], "string", `${code} has no evidence gloss`);
  }
});

test("the three executable examples are valid decision states", () => {
  assert.equal(MONTHLY_DECISION_EXAMPLES.readyToTrack.state,
    MONTHLY_DECISION_STATE.ready);
  assert.equal(MONTHLY_DECISION_EXAMPLES.insufficientEvidence.state,
    MONTHLY_DECISION_STATE.insufficient);
  assert.equal(MONTHLY_DECISION_EXAMPLES.alreadyTracked.state,
    MONTHLY_DECISION_STATE.tracked);
  assert.equal(MONTHLY_DECISION_EXAMPLES.insufficientEvidence.action, null);
  assert.match(MONTHLY_DECISION_EXAMPLES.alreadyTracked.localNextStep, /do not create a duplicate/i);
});

test("the shipped surface consumes the contract in question order with collapsed evidence", async () => {
  const { document } = await loadPage(PAGE);
  const decision = applyMonthlyDepartmentDecision(document, pack());
  const section = document.getElementById("monthly-department-decision");
  const text = textOf(section);

  assert.equal(decision.state, MONTHLY_DECISION_STATE.ready);
  assert.equal(section.hidden, false);
  let cursor = -1;
  for (const question of decision.questionOrder) {
    const next = text.indexOf(question);
    assert.ok(next > cursor, `${question} is out of order`);
    cursor = next;
  }
  const disclosure = section.querySelector("details");
  assert.equal(disclosure.hasAttribute("open"), false);
  assert.match(textOf(disclosure.querySelector("summary")), /Show 5 evidence references/);
});

test("the surface states refuse untrackable work and identify existing tracking", async () => {
  const { document } = await loadPage(PAGE);
  const insufficient = applyMonthlyDepartmentDecision(document, pack(lead({
    monthlySavingsUsd: null,
    unpricedReasonCode: "no_monthly_spend_basis",
  })));
  let text = textOf(document.getElementById("monthly-department-decision"));
  assert.equal(insufficient.state, MONTHLY_DECISION_STATE.insufficient);
  assert.match(text, /Create no trackable action/);
  assert.match(text, /department-level monthly spend basis in USD/);

  const tracked = applyMonthlyDepartmentDecision(document, pack(), {
    tracking: Object.freeze({
      department: "Atlas Platform",
      actionId: "route-short-lookups",
      status: "On track",
      reference: "local-action-2026-07-atlas-routing",
    }),
  });
  text = textOf(document.getElementById("monthly-department-decision"));
  assert.equal(tracked.state, MONTHLY_DECISION_STATE.tracked);
  assert.match(text, /Already tracked: On track/);
  assert.match(text, /do not create a duplicate/);
});

test("track and decline are explicit, consent-gated controls with an honest saved state", async () => {
  const storage = storageOf();
  const now = new Date("2026-07-20T12:00:00.000Z");
  const first = await loadPage(PAGE);
  applyMonthlyDepartmentDecision(first.document, pack(), { storage, now });
  const commit = first.document.querySelector(".monthly-decision-commit");
  const decline = first.document.querySelector(".monthly-decision-decline");
  assert.equal(commit.textContent, "Track this action");
  assert.equal(decline.textContent, "Decline for this month");

  commit.click();
  assert.equal(readRetainedCommitments(storage).length, 0);
  assert.match(textOf(first.document.querySelector(".monthly-decision-outcome")),
    /not been asked to remember/i);

  const declined = await loadPage(PAGE);
  applyMonthlyDepartmentDecision(declined.document, pack(), { storage, now });
  declined.document.querySelector(".monthly-decision-decline").click();
  assert.match(textOf(declined.document.querySelector(".monthly-decision-outcome")),
    /No tracking record was created and no savings are claimed/i);

  setFinopsConsent(storage, FINOPS_CONSENT.granted, { now });
  const second = await loadPage(PAGE);
  applyMonthlyDepartmentDecision(second.document, pack(), { storage, now });
  second.document.querySelector(".monthly-decision-commit").click();
  assert.equal(readRetainedCommitments(storage).length, 1);
  assert.match(textOf(second.document.querySelector(".monthly-decision-outcome")),
    /awaiting a compatible later analysis/i);

});

test("later review ranks comparable movement and refuses incompatible analyses", async () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const storage = storageOf();
  setFinopsConsent(storage, FINOPS_CONSENT.granted, { now });
  let page = await loadPage(PAGE);
  applyMonthlyDepartmentDecision(page.document, pack(), { storage, now });
  page.document.querySelector(".monthly-decision-commit").click();

  retainFinopsPeriod(storage, period("2026-07", 500000), { now });
  retainFinopsPeriod(storage, period("2026-08", 450000), { now });
  page = await loadPage(PAGE);
  applyMonthlyDepartmentDecision(page.document, pack(), { storage, now });
  let review = page.document.querySelector(".monthly-decision-review");
  assert.equal(review.dataset.state, "comparable");
  assert.match(textOf(review), /Later review · rank 1/);
  assert.match(textOf(review), /analyzed spend went down/i);
  assert.match(textOf(review), /does not measure, attribute, or verify savings/i);

  const incompatible = storageOf();
  setFinopsConsent(incompatible, FINOPS_CONSENT.granted, { now });
  page = await loadPage(PAGE);
  applyMonthlyDepartmentDecision(page.document, pack(), { storage: incompatible, now });
  page.document.querySelector(".monthly-decision-commit").click();
  retainFinopsPeriod(incompatible, period("2026-07", 500000), { now });
  retainFinopsPeriod(incompatible,
    period("2026-08", 450000, "finops-briefing/2.0.0"), { now });
  page = await loadPage(PAGE);
  applyMonthlyDepartmentDecision(page.document, pack(), { storage: incompatible, now });
  review = page.document.querySelector(".monthly-decision-review");
  assert.equal(review.dataset.state, "non-comparable");
  assert.match(textOf(review), /not comparable/i);
});

test("the integration uses the reviewed local store and contains no network behavior", async () => {
  const source = await readFile(new URL("../src/monthly-department-decision.js", import.meta.url), "utf8")
    + await readFile(new URL("../src/monthly-department-decision-view.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket|sessionStorage)\b/);
  assert.match(source, /retainApprovedCommitment/);
  assert.match(await readFile(new URL("../src/department-evidence-view.js", import.meta.url), "utf8"),
    /applyMonthlyDepartmentDecision\(doc, model\.fixPack/);
});
