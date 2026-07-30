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
  FINOPS_CONSENT, finopsWorkspaceFile, forgetFinopsWorkspace, readRetainedCommitments,
  retainFinopsPeriod, setFinopsConsent,
} from "../src/finops-workspace.js";
import {
  compareMonthlyAction, MONTHLY_ACTION_KEY, MONTHLY_ACTION_VERSION,
  projectMonthlyAction, readMonthlyAction, writeMonthlyAction,
} from "../src/monthly-department-action-store.js";
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
  assert.equal(readMonthlyAction(storage).status, "restored");
  assert.match(textOf(second.document.querySelector(".monthly-decision-outcome")),
    /awaiting a compatible later analysis/i);

});

test("later review compares the committed metric and refuses incompatible analyses", async () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const storage = storageOf();
  setFinopsConsent(storage, FINOPS_CONSENT.granted, { now });
  let page = await loadPage(PAGE);
  applyMonthlyDepartmentDecision(page.document, pack(), { storage, now });
  page.document.querySelector(".monthly-decision-commit").click();

  retainFinopsPeriod(storage, period("2026-07", 500000), { now });
  retainFinopsPeriod(storage, period("2026-08", 450000), { now });
  page = await loadPage(PAGE);
  applyMonthlyDepartmentDecision(page.document, pack(lead({ monthlySavingsUsd: 1600 })), {
    storage,
    now,
    cycle: { period: "2026-08", deadline: "2026-08-31", reviewPeriod: "2026-09" },
  });
  let review = page.document.querySelector(".monthly-decision-review");
  assert.equal(review.dataset.state, "comparable");
  assert.equal(review.getAttribute("aria-label"), "Later monthly review: Comparable result");
  assert.match(textOf(review), /Committed baseline\$1,840\.00/);
  assert.match(textOf(review), /Current result\$1,600\.00/);
  assert.match(textOf(review), /changed by \$240\.00/i);
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
  applyMonthlyDepartmentDecision(page.document, pack(lead({ basis: "signal_share" })), {
    storage: incompatible,
    now,
    cycle: { period: "2026-08", deadline: "2026-08-31", reviewPeriod: "2026-09" },
  });
  review = page.document.querySelector(".monthly-decision-review");
  assert.equal(review.dataset.state, "non-comparable");
  assert.equal(review.getAttribute("aria-label"), "Later monthly review: Not comparable");
  assert.match(textOf(review), /not comparable/i);
});

test("every monthly workspace phase has an explicit accessible state", async () => {
  for (const [phase, label, busy] of [
    ["loading", "Loading monthly action", "true"],
    ["empty", "No monthly action", "false"],
    ["error", "Monthly action unavailable", "false"],
  ]) {
    const { document } = await loadPage(PAGE);
    applyMonthlyDepartmentDecision(document, null, { phase });
    const section = document.getElementById("monthly-department-decision");
    assert.equal(section.hidden, false);
    assert.equal(section.getAttribute("role"), "region");
    assert.equal(section.getAttribute("aria-busy"), busy);
    assert.equal(section.querySelector(".monthly-decision-status").getAttribute("role"), "status");
    assert.equal(section.querySelector(".monthly-decision-status").getAttribute("aria-live"), "polite");
    assert.match(textOf(section), new RegExp(label, "i"));
    assert.match(textOf(section), /Nothing here makes a network request or is stored/i);
  }
});

test("tracked, awaiting, comparable, and non-comparable states announce text, not color", async () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const storage = storageOf();
  setFinopsConsent(storage, FINOPS_CONSENT.granted, { now });
  let page = await loadPage(PAGE);
  applyMonthlyDepartmentDecision(page.document, pack(), { storage, now });
  page.document.querySelector(".monthly-decision-commit").click();
  const tracked = page.document.querySelector(".monthly-decision-outcome");
  assert.equal(tracked.getAttribute("role"), "status");
  assert.equal(tracked.getAttribute("aria-live"), "polite");
  assert.equal(tracked.getAttribute("aria-atomic"), "true");
  assert.match(textOf(tracked), /✓Tracked.*Nothing is proven yet/i);
  assert.equal(tracked.querySelector(".monthly-decision-status-shape")
    .getAttribute("aria-hidden"), "true");

  page = await loadPage(PAGE);
  applyMonthlyDepartmentDecision(page.document, pack(), { storage, now });
  let review = page.document.querySelector(".monthly-decision-review");
  assert.equal(review.dataset.state, "awaiting");
  assert.equal(review.getAttribute("aria-label"), "Later monthly review: Awaiting analysis");
  assert.match(textOf(review), /○Awaiting analysis.*compatible later monthly analysis/i);
  // Rendered once with the page, so it is a named landmark, not a live region that
  // reads the whole block out on load.
  assert.equal(review.getAttribute("aria-live"), null);

  retainFinopsPeriod(storage, period("2026-07", 500000), { now });
  retainFinopsPeriod(storage, period("2026-08", 450000), { now });
  page = await loadPage(PAGE);
  applyMonthlyDepartmentDecision(page.document, pack(), {
    storage,
    now,
    cycle: { period: "2026-08", deadline: "2026-08-31", reviewPeriod: "2026-09" },
  });
  review = page.document.querySelector(".monthly-decision-review");
  assert.match(textOf(review), /↔Comparable result/);
  assert.match(textOf(review), /Result type: unproven/);
});

test("the versioned action record creates, reloads, compares, and rejects drift", () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const baseline = monthlyDepartmentDecision(pack(), {
    cycle: { period: "2026-07", deadline: "2026-07-31", reviewPeriod: "2026-08" },
  });
  const record = projectMonthlyAction(baseline, { now });
  assert.equal(record.schemaVersion, MONTHLY_ACTION_VERSION);
  assert.deepEqual(Object.keys(record).sort(), [
    "actionId", "actionLabel", "baseline", "committedAt", "confidence", "decisionVersion",
    "department", "ownerLabel", "provenanceReferences", "reviewPeriod", "schemaVersion", "target",
  ]);

  const storage = storageOf();
  assert.equal(writeMonthlyAction(storage, baseline, { now }).ok, true);
  assert.deepEqual(readMonthlyAction(storage).record, record);
  assert.deepEqual(finopsWorkspaceFile(storage, { now }).monthlyDepartmentAction, record);

  const later = monthlyDepartmentDecision(pack(lead({ monthlySavingsUsd: 1600 })), {
    cycle: { period: "2026-08", deadline: "2026-08-31", reviewPeriod: "2026-09" },
  });
  assert.deepEqual(compareMonthlyAction(record, later), {
    status: "comparable", comparable: true, baseline: 1840, current: 1600, change: -240,
  });
  const drifted = monthlyDepartmentDecision(pack(lead({ basis: "signal_share" })), {
    cycle: { period: "2026-08", deadline: "2026-08-31", reviewPeriod: "2026-09" },
  });
  assert.deepEqual(compareMonthlyAction(record, drifted), {
    status: "not_comparable", comparable: false, baseline: 1840, current: null, change: null,
  });
  assert.equal(forgetFinopsWorkspace(storage).ok, true);
  assert.equal(storage.getItem(MONTHLY_ACTION_KEY), null);
});

test("missing, corrupt, and unsupported action storage recover without inventing tracking", async () => {
  const storage = storageOf();
  assert.equal(readMonthlyAction(storage).status, "missing");
  storage.setItem(MONTHLY_ACTION_KEY, "{broken");
  assert.equal(readMonthlyAction(storage).status, "malformed");
  storage.setItem(MONTHLY_ACTION_KEY, JSON.stringify({
    schemaVersion: "monthly-department-action/99.0.0",
  }));
  assert.equal(readMonthlyAction(storage).status, "unsupported");

  const page = await loadPage(PAGE);
  const decision = applyMonthlyDepartmentDecision(page.document, pack(), { storage });
  assert.equal(decision.state, MONTHLY_DECISION_STATE.ready);
  assert.equal(page.document.querySelector(".monthly-decision-commit").disabled, false);
});

test("one name per concept: the tracked path never calls itself committed or saved", async () => {
  const now = new Date("2026-07-20T12:00:00.000Z");
  const storage = storageOf();
  setFinopsConsent(storage, FINOPS_CONSENT.granted, { now });
  const page = await loadPage(PAGE);
  applyMonthlyDepartmentDecision(page.document, pack(), { storage, now });
  const outcome = page.document.querySelector(".monthly-decision-outcome");

  page.document.querySelector(".monthly-decision-decline").click();
  assert.match(textOf(outcome), /–Declined this month/);
  assert.equal(outcome.dataset.state, "declined");

  const refused = await loadPage(PAGE);
  applyMonthlyDepartmentDecision(refused.document, pack(), { storage: storageOf(), now });
  refused.document.querySelector(".monthly-decision-commit").click();
  const notTracked = refused.document.querySelector(".monthly-decision-outcome");
  assert.match(textOf(notTracked), /!Not tracked/);
  assert.equal(notTracked.dataset.state, "error");

  const section = page.document.getElementById("monthly-department-decision");
  assert.doesNotMatch(textOf(section), /\bcommitted\b/i);
});

test("confidence is named from the rating the producer actually scored", async () => {
  for (const [level, label] of [
    ["high", "●High confidence"], ["medium", "◐Medium confidence"], ["low", "◔Low confidence"],
  ]) {
    const { document } = await loadPage(PAGE);
    applyMonthlyDepartmentDecision(document, pack(lead({ level })));
    assert.match(textOf(document.querySelector(".monthly-decision-confidence")),
      new RegExp(label.replace(/[●◐◔]/, (shape) => `\\${shape}`)));
  }
  // An unpriced finding scores no confidence, so the page must not imply one.
  const { document } = await loadPage(PAGE);
  applyMonthlyDepartmentDecision(document, pack(null));
  const confidence = document.querySelector(".monthly-decision-confidence");
  assert.match(textOf(confidence), /\?Confidence not scored/);
  assert.doesNotMatch(textOf(confidence), /Limited confidence|Rating:/);
});

test("the evidence disclosure and action path are named and keyboard reachable in reading order", async () => {
  const { document } = await loadPage(PAGE);
  applyMonthlyDepartmentDecision(document, pack());
  const section = document.getElementById("monthly-department-decision");
  const controls = section.querySelectorAll("summary,button,a");
  assert.deepEqual(controls.map((node) => node.tagName), ["SUMMARY", "BUTTON", "BUTTON", "A"]);
  assert.match(textOf(controls[0]), /Show 5 evidence references/);
  assert.equal(controls[1].textContent, "Track this action");
  assert.equal(controls[2].textContent, "Decline for this month");
  assert.equal(controls[3].textContent, "Review local storage settings");
  for (const control of controls) assert.notEqual(control.getAttribute("tabindex"), "-1");

  const css = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
  assert.match(css, /\.monthly-decision-evidence>summary:focus-visible\s*\{[^}]*outline:3px solid var\(--focus-ring\)/);
});

test("implausible metric extremes stay visible and demand source verification", async () => {
  const { document } = await loadPage(PAGE);
  applyMonthlyDepartmentDecision(document, pack(lead({ monthlySavingsUsd: 9_999_999_999 })));
  const measurement = document.querySelector(".monthly-decision-measurement");
  assert.match(textOf(measurement), /\$9,999,999,999\.00/);
  // The action itself is available, so this warning must not borrow the
  // "Monthly action unavailable" name the loading/error phases use.
  assert.match(textOf(measurement), /!Check this figure — This baseline is larger than any/i);
  assert.doesNotMatch(textOf(measurement), /unavailable/i);
  assert.equal(document.querySelector(".monthly-decision-commit").disabled, true);
  assert.equal(document.querySelector(".monthly-decision-commit").textContent,
    "Confirm the source before tracking");
  assert.equal(document.querySelector(".monthly-decision-source").href, "#local-import-title");
});

test("the integration uses the reviewed local store and contains no network behavior", async () => {
  const source = await readFile(new URL("../src/monthly-department-decision.js", import.meta.url), "utf8")
    + await readFile(new URL("../src/monthly-department-decision-view.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\b(fetch|XMLHttpRequest|WebSocket|sessionStorage)\b/);
  assert.match(source, /retainApprovedCommitment/);
  assert.match(await readFile(new URL("../src/department-evidence-view.js", import.meta.url), "utf8"),
    /applyMonthlyDepartmentDecision\(doc, model\.fixPack/);
});
