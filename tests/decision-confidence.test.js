// The per-decision confidence grade on the history view (issue #1188).
//
// Two layers, matching how the feature is split:
//   * the scoring rule is asserted against the checked-in labelled fixtures —
//     every expectation is a literal string in the fixture file, so a changed
//     verdict has to be approved in the fixture as well as in the module;
//   * the rendered line is checked through the element stub: where the verdict
//     sits relative to the collapsed part, that the disclosure is a native
//     control, and that hostile record text arrives as text and not as markup.
//
// Determinism: no network, no sleeps, and no clock — the scoring function takes
// no instant at all, so a test that passes today passes in a year.

import test from "node:test";
import assert from "node:assert/strict";
import {
  BACKED_RULE_ID,
  CONFIDENCE_CHECK_ORDER,
  CONFIDENCE_DISCLOSURE_LABEL,
  scoreDecisionConfidence,
} from "../src/decision-confidence.js";
import {
  ADVERSARIAL_ALTERNATIVE,
  ADVERSARIAL_FIXTURE,
  ADVERSARIAL_OWNER,
  DECISION_CONFIDENCE_FIXTURES,
} from "../src/decision-confidence-fixtures.js";
import { renderHistory, toHistoryRecords } from "../src/app.js";
import { byClass, first, installDocument, tags, walk } from "./support/dom.js";

const failingIds = (grade) => grade.checks.filter(({ passed }) => !passed).map(({ id }) => id);

test("the rule order is the order stated in the module comment", () => {
  assert.deepEqual([...CONFIDENCE_CHECK_ORDER], ["owner", "context", "alternatives", "release"]);
});

test("every labelled fixture scores to its stated verdict, action, gaps, and rule", () => {
  for (const fixture of DECISION_CONFIDENCE_FIXTURES) {
    const grade = scoreDecisionConfidence(fixture.record);
    assert.equal(grade.verdict, fixture.expected.verdict, fixture.label);
    assert.equal(grade.nextAction, fixture.expected.nextAction, fixture.label);
    assert.equal(grade.ruleId, fixture.expected.ruleId, fixture.label);
    assert.deepEqual(failingIds(grade), fixture.expected.failing, fixture.label);
    // Whatever the verdict, all four checks are always reported, in rule order.
    assert.deepEqual(grade.checks.map(({ id }) => id), [...CONFIDENCE_CHECK_ORDER], fixture.label);
    assert.equal(grade.backed, fixture.expected.failing.length === 0, fixture.label);
  }
});

test("a backed record is the only one that names no next action", () => {
  for (const fixture of DECISION_CONFIDENCE_FIXTURES) {
    const grade = scoreDecisionConfidence(fixture.record);
    assert.equal(grade.nextAction === null, grade.backed, fixture.label);
    assert.equal(grade.ruleId === BACKED_RULE_ID, grade.backed, fixture.label);
  }
});

test("scoring the same fixture twice yields identical output", () => {
  for (const fixture of DECISION_CONFIDENCE_FIXTURES) {
    // Serialised, so key order and every nested string are compared, not just
    // the fields the assertions above happen to name.
    const once = JSON.stringify(scoreDecisionConfidence(fixture.record));
    const twice = JSON.stringify(scoreDecisionConfidence(fixture.record));
    assert.equal(once, twice, fixture.label);
  }
});

test("a bare decision object scores the same as the composed record around it", () => {
  const decision = { owner: "Priya", context: "Why.", createdAt: "2026-03-04T09:00:00.000Z", alternatives: [] };
  const bare = scoreDecisionConfidence(decision);
  assert.equal(bare.ruleId, "first-gap:alternatives");
  assert.equal(JSON.stringify(scoreDecisionConfidence({ decision })), JSON.stringify(bare));
});

// --- rendering ---------------------------------------------------------------

installDocument();

const BACKED = {
  id: "d-backed",
  title: "Adopt a cache",
  context: "Read latency spikes.",
  alternatives: "Query tuning alone.",
  owner: "Priya",
  status: "accepted",
  createdAt: "2026-03-04T09:00:00.000Z",
};

const UNOWNED = { ...BACKED, id: "d-unowned", owner: "" };

const RELEASE = {
  id: "r-1",
  version: "v2.1.0",
  status: "shipped",
  decisionIds: [BACKED.id, UNOWNED.id],
  createdAt: "2026-03-05T09:00:00.000Z",
};

// Rendered the way the page renders the stream: composed records, so the
// release check sees the same association the row's "Shipped in" line does.
const render = (decisions, releases = [RELEASE]) => {
  const container = document.createElement("ol");
  const count = document.createElement("p");
  renderHistory(container, count, toHistoryRecords(decisions, releases), {});
  return container;
};

test("each decision row renders exactly one confidence line", () => {
  const container = render([BACKED, UNOWNED]);
  assert.equal(byClass(container, "decision-confidence").length, 2);
  assert.equal(byClass(container, "confidence-verdict").length, 2);
});

test("the verdict is not inside the collapsed part of the disclosure", () => {
  const container = render([UNOWNED]);
  const verdict = first(container, "confidence-verdict");
  assert.equal(verdict.textContent, "Needs an owner before this is quotable");
  // Walk up from the verdict: no ancestor is the disclosure, so the sentence is
  // read out whether or not the control was ever opened.
  for (let node = verdict.parent; node; node = node.parent) {
    assert.notEqual(node.tagName, "DETAILS");
  }
});

test("a backed row is quiet and an unbacked row is the one marked", () => {
  const container = render([BACKED, UNOWNED]);
  const [backed, unbacked] = byClass(container, "confidence-verdict");
  assert.equal(backed.textContent, "Backed: owner, context, 1 alternative, 1 release");
  assert.ok(backed.classes.includes("record-link-empty"));
  assert.equal(backed.classes.includes("record-link-missing"), false);
  assert.ok(unbacked.classes.includes("record-link-missing"));
  assert.equal(unbacked.classes.includes("record-link-empty"), false);
});

test("the disclosure is a native control, closed by default, naming every check and the rule", () => {
  const container = render([UNOWNED]);
  const disclosure = first(container, "confidence-detail");
  assert.equal(disclosure.tagName, "DETAILS");
  assert.equal(disclosure.getAttribute("open"), null);
  const summary = tags(disclosure, "SUMMARY");
  assert.equal(summary.length, 1);
  assert.equal(summary[0].textContent, CONFIDENCE_DISCLOSURE_LABEL);
  assert.equal(summary[0].getAttribute("aria-expanded"), "false");
  // Four checks — all of them, not only the one the verdict names — plus one
  // next action and one rule line.
  assert.equal(tags(first(disclosure, "confidence-checks"), "LI").length, 4);
  assert.equal(byClass(disclosure, "confidence-next").length, 1);
  assert.equal(byClass(disclosure, "confidence-rule").length, 1);
  assert.ok(first(disclosure, "confidence-rule").textContent.includes("first-gap:owner"));
});

test("opening the disclosure keeps aria-expanded in step", () => {
  const container = render([UNOWNED]);
  const disclosure = first(container, "confidence-detail");
  disclosure.setAttribute("open", "");
  disclosure.dispatch("toggle");
  assert.equal(tags(disclosure, "SUMMARY")[0].getAttribute("aria-expanded"), "true");
});

test("a backed row's disclosure names no next action", () => {
  const container = render([BACKED]);
  assert.equal(byClass(first(container, "decision-confidence"), "confidence-next").length, 0);
  assert.ok(first(container, "confidence-rule").textContent.includes(BACKED_RULE_ID));
});

test("hostile owner and alternative text is rendered as characters, never as elements", () => {
  const hostile = {
    ...ADVERSARIAL_FIXTURE.record.decision,
    id: "d-hostile",
    alternatives: [ADVERSARIAL_ALTERNATIVE, "Ben & Co's \"cheap\" option"],
  };
  const container = render([hostile], [{ ...RELEASE, decisionIds: [hostile.id] }]);
  const line = first(container, "decision-confidence");
  const evidence = byClass(line, "confidence-evidence").map((node) => node.textContent).join(" | ");
  assert.ok(evidence.includes(ADVERSARIAL_OWNER));
  assert.ok(evidence.includes(ADVERSARIAL_ALTERNATIVE));
  assert.ok(evidence.includes("Ben & Co's \"cheap\" option"));
  // The payload's tag names never became elements anywhere on the line: the
  // text was set on a node, not parsed as markup.
  assert.equal(walk(line, (node) => node.tagName === "IMG" || node.tagName === "SCRIPT").length, 0);
  // Nothing on the line carries an inline handler either.
  assert.equal(walk(line, (node) => node.getAttribute("onerror") !== null).length, 0);
});

test("the composed history record and the raw decision agree on the release check", () => {
  const records = toHistoryRecords([BACKED], [RELEASE]);
  const grade = scoreDecisionConfidence(records.find((record) => record.type !== "release"));
  assert.equal(grade.verdict, "Backed: owner, context, 1 alternative, 1 release");
  assert.equal(grade.ruleId, BACKED_RULE_ID);
});
