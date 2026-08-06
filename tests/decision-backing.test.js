// The backing verdict: the rule set, and the line the history row shows.
//
// WHAT THESE TESTS DEFEND. A lead reading "Backed" has to be able to ask why,
// get the same answer twice, and be told which rule produced it. So the pure
// layer is asserted against labelled fixtures — exact verdict string, exact
// rule id, exact passed/failed lists — and the render layer is asserted against
// the shared element stub for the one structural property the wording cannot
// carry: that the verdict is outside the collapsed region.
//
// Why the structure and not the text. The harness models no layout and reads
// text straight through a closed disclosure, so `textContent` containing the
// verdict proves nothing about whether a reader or a screen reader would ever
// encounter it. The assertions below walk the parent chain instead.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  DECISION_BACKING_CHECKS,
  DECISION_BACKING_LABELS,
  countAlternatives,
  countAssociatedReleases,
  scoreDecisionBacking,
} from "../src/decision-backing.js";
import { renderHistory, toHistoryRecords } from "../src/app.js";
import { DECISION_BACKING_CASES } from "./fixtures/decision-backing-cases.js";
import { byClass, createElement, first, installDocument, walk } from "./support/dom.js";

installDocument();

test("every labelled fixture produces its exact verdict, rule, and check lists", () => {
  assert.ok(DECISION_BACKING_CASES.length >= 12, "the fixture set must cover more than the happy path");
  for (const { label, record, expected } of DECISION_BACKING_CASES) {
    const verdict = scoreDecisionBacking(record);
    assert.equal(verdict.verdict, expected.verdict, `${label}: wrong line`);
    assert.equal(verdict.state, expected.state, `${label}: wrong state`);
    assert.equal(verdict.ruleId, expected.ruleId, `${label}: wrong deciding rule`);
    assert.equal(verdict.nextAction, expected.nextAction, `${label}: wrong next action`);
    assert.deepEqual([...verdict.passed], expected.passed, `${label}: wrong passing checks`);
    assert.deepEqual([...verdict.failed], expected.failed, `${label}: wrong failing checks`);
    // Every check lands on exactly one side of the line, whatever the record.
    assert.deepEqual(
      [...verdict.passed, ...verdict.failed].sort(),
      [...DECISION_BACKING_CHECKS].sort(),
      `${label}: a check went missing`,
    );
  }
});

test("the priority order is total, so a record with several gaps still names one action", () => {
  // Every non-empty subset of the four checks, failed together. The named gap
  // must always be the highest-priority one, and there must always be exactly
  // one — this is the tie the rule order exists to break.
  const expectedFor = { owner: "backing/missing-owner", context: "backing/missing-context",
    alternatives: "backing/missing-alternatives", release: "backing/missing-release" };
  for (let mask = 1; mask < 16; mask += 1) {
    const failing = DECISION_BACKING_CHECKS.filter((_, index) => (mask >> index) & 1);
    const verdict = scoreDecisionBacking({
      decision: {
        owner: failing.includes("owner") ? "" : "Kai",
        context: failing.includes("context") ? "" : "Retries are required.",
        createdAt: "2026-01-01T00:00:00.000Z",
        alternatives: failing.includes("alternatives") ? "" : "Poll the database.",
      },
      shipped: failing.includes("release")
        ? { state: "none", entries: [], newest: null, others: 0 }
        : { state: "shipped", entries: [{ id: "r-1" }], newest: { id: "r-1" }, others: 0 },
    });
    assert.deepEqual([...verdict.failed], failing, `failing set ${failing.join("+")} was not read back`);
    assert.equal(verdict.ruleId, expectedFor[failing[0]],
      `failing set ${failing.join("+")} named the wrong gap`);
    assert.equal(typeof verdict.nextAction, "string");
    // One action, never two: the line names a single thing to do next.
    assert.equal(verdict.verdict.split("Next:").length, 2);
  }
});

test("the same record scores the same verdict however often it is asked, and however its keys were written", () => {
  for (const { label, record } of DECISION_BACKING_CASES) {
    const once = scoreDecisionBacking(record);
    const twice = scoreDecisionBacking(record);
    assert.deepEqual(twice, once, `${label}: two calls disagreed`);
    assert.equal(twice.verdict, once.verdict);
  }
  // Key order is not data. A record rebuilt with its keys reversed — the shape
  // a JSON round trip or an import can produce — must score identically.
  const forward = { owner: "Kai", context: "Retries are required.", alternatives: "Poll.", createdAt: "2026-01-01T00:00:00.000Z" };
  const reversed = Object.fromEntries(Object.entries(forward).reverse());
  assert.deepEqual(scoreDecisionBacking({ decision: reversed }), scoreDecisionBacking({ decision: forward }));
});

test("blank, absent, and wrongly shaped fields are counted as missing rather than crashing", () => {
  for (const value of [undefined, null, "", "   ", 0, 42, {}, true]) {
    const verdict = scoreDecisionBacking({ decision: { owner: value, context: value, alternatives: value } });
    assert.equal(verdict.state, "incomplete");
    assert.equal(verdict.ruleId, "backing/missing-owner", `${JSON.stringify(value) ?? "undefined"} was read as an owner`);
  }
  assert.equal(scoreDecisionBacking(undefined).ruleId, "backing/missing-owner");
  assert.equal(scoreDecisionBacking(null).state, "incomplete");
  // The two counters are the pieces most likely to be reused, so they are pinned
  // on their own rather than only through a verdict.
  assert.equal(countAlternatives({ alternatives: "One long paragraph." }), 1);
  assert.equal(countAlternatives({ alternatives: [{}, {}, null, undefined] }), 2);
  assert.equal(countAlternatives({}), 0);
  assert.equal(countAssociatedReleases({ shipped: { state: "unresolved", entries: [] } }), 0);
  assert.equal(countAssociatedReleases({ shipped: { state: "shipped", entries: [1, 2] } }), 2);
  assert.equal(countAssociatedReleases({}), 0);
});

// ---------------------------------------------------------------------------
// The row.
// ---------------------------------------------------------------------------

const decisions = [
  { id: "queue", title: "Adopt a durable queue", context: "Retries are required.", alternatives: "Poll the database.", owner: "Kai", status: "accepted", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "solo", title: "Retire the cron worker", context: "Nothing ships this yet.", owner: "", status: "proposed", createdAt: "2026-02-01T00:00:00.000Z" },
];
const releases = [
  { id: "r-1-3-0", version: "v1.3.0", title: "Throughput", status: "completed", owner: "Kai", createdAt: "2026-04-01T00:00:00.000Z", decisionIds: ["queue"] },
];

function renderRows(records = toHistoryRecords(decisions, releases)) {
  const container = createElement("div");
  renderHistory(container, createElement("span"), records, {});
  return container;
}

const rowFor = (container, title) => byClass(container, "history-card")
  .find((card) => card.children[0].textContent === title).parent;

const ancestors = (node) => {
  const chain = [];
  for (let current = node.parent; current; current = current.parent) chain.push(current.tagName);
  return chain;
};

test("each decision row carries one backing line, and the verdict is outside the disclosure", () => {
  const container = renderRows();
  assert.equal(byClass(container, "decision-backing").length, 2, "one backing line per decision row, and none on a release row");

  const backed = first(rowFor(container, "Adopt a durable queue"), "decision-backing");
  const verdict = first(backed, "decision-backing-verdict");
  assert.equal(verdict.textContent, "Backed: owner, context, 1 alternative, 1 release.");
  // The structural claim: no DETAILS anywhere above the verdict text. A
  // harness that reads through a closed disclosure cannot tell the difference,
  // and a browser and a screen reader can.
  assert.equal(ancestors(verdict).includes("DETAILS"), false, "the verdict is inside a collapsed region");
  assert.deepEqual(ancestors(verdict).slice(0, 2), ["DIV", "ARTICLE"]);
  // Outside the card's own anchor too: an anchor may not contain a disclosure.
  assert.equal(byClass(first(rowFor(container, "Adopt a durable queue"), "history-card"), "decision-backing").length, 0);
});

test("an unbacked decision names one next action on the always-visible line", () => {
  const unbacked = first(rowFor(renderRows(), "Retire the cron worker"), "decision-backing");
  const verdict = first(unbacked, "decision-backing-verdict");
  assert.equal(verdict.textContent, "Not fully backed. Next: name an owner for this decision.");
  assert.equal(ancestors(verdict).includes("DETAILS"), false);
  // No badge, no status word, no icon: the backed row must not be decorated
  // into competing with this one for attention.
  assert.equal(byClass(unbacked, "badge").length, 0);
});

test("the supporting detail is a native disclosure, closed on arrival and keyboard-operable", () => {
  const container = renderRows();
  const backed = first(rowFor(container, "Adopt a durable queue"), "decision-backing");
  const details = walk(backed, (node) => node.tagName === "DETAILS");
  assert.equal(details.length, 1, "one disclosure per backing line");
  assert.equal(details[0].getAttribute("open"), null, "the detail must be closed on arrival");

  const summary = first(details[0], "supersede-disclosure-summary");
  assert.equal(summary.tagName, "SUMMARY", "a native summary is the tab stop, not a div with a handler");
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  // Enter and Space are the browser's on a summary; what this layer owns is
  // keeping the announced state in step with the real one.
  details[0].setAttribute("open", "");
  details[0].dispatch("toggle");
  assert.equal(summary.getAttribute("aria-expanded"), "true");

  // Four checks and the deciding rule, all behind the disclosure.
  const checks = byClass(backed, "decision-backing-check");
  assert.equal(checks.length, DECISION_BACKING_CHECKS.length);
  assert.deepEqual(checks.map((item) => item.textContent), [
    `${DECISION_BACKING_LABELS.owner}: recorded`,
    `${DECISION_BACKING_LABELS.context}: recorded`,
    `${DECISION_BACKING_LABELS.alternatives}: recorded`,
    `${DECISION_BACKING_LABELS.release}: recorded`,
  ]);
  for (const item of checks) assert.ok(ancestors(item).includes("DETAILS"), "a check escaped the disclosure");
  const rule = first(backed, "decision-backing-rule");
  assert.equal(rule.textContent, "Deciding rule: backing/complete");
  assert.ok(ancestors(rule).includes("DETAILS"));

  const failing = first(rowFor(container, "Retire the cron worker"), "decision-backing");
  assert.deepEqual(byClass(failing, "decision-backing-check").map((item) => item.textContent), [
    `${DECISION_BACKING_LABELS.owner}: missing`,
    `${DECISION_BACKING_LABELS.context}: recorded`,
    `${DECISION_BACKING_LABELS.alternatives}: missing`,
    `${DECISION_BACKING_LABELS.release}: missing`,
  ]);
  assert.equal(first(failing, "decision-backing-rule").textContent, "Deciding rule: backing/missing-owner");
});

test("no decision-derived text reaches the DOM as HTML", async () => {
  const hostile = "<img src=x onerror=alert(1)>";
  const container = renderRows(toHistoryRecords([{
    id: "xss", title: hostile, context: hostile, alternatives: hostile, owner: hostile,
    status: "accepted", createdAt: "2026-01-01T00:00:00.000Z",
  }], []));
  // Nothing was parsed into elements: the payload is text on the nodes that
  // carry it, and the row grew no img.
  assert.equal(walk(container, (node) => node.tagName === "IMG").length, 0);
  assert.equal(walk(container, (node) => node.tagName === "SCRIPT").length, 0);
  assert.equal(first(container, "owner").textContent.includes(hostile), true);
  // The backing line quotes no stored text at all — it is authored sentences
  // and two integers — so the payload cannot reach it in the first place.
  const backing = first(container, "decision-backing");
  assert.equal(backing.textContent.includes("<img"), false);

  // The only way a string becomes markup in this codebase is a caller reaching
  // for innerHTML. Neither the rule set nor the view that renders it does.
  for (const module of ["../src/decision-backing.js", "../src/app.js"]) {
    const source = await readFile(new URL(module, import.meta.url), "utf8");
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/,
      `${module} builds markup from a string`);
  }
});
