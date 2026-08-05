// The routing policy file: the ranked rules, handed over as something a reader
// can diff, mail, and dispute away from this page.
//
// Four properties carry it, and each has a test that fails when it stops holding:
//
//   1. BYTE-STABILITY. Two generations of one slate at one timestamp are the same
//      string. A file that reshuffles between exports cannot be diffed, and a
//      policy nobody can diff is a screenshot with braces in it.
//   2. ONE MOVING FIELD. Change the timestamp and NOTHING else in the string
//      moves. That is what makes "this month's policy differs from last month's"
//      a statement about routing rather than about serialization.
//   3. NOTHING FABRICATED AND NOTHING LEAKED. Every figure is the slate's own,
//      and no prompt text, customer content, credential or request is in it.
//   4. NO EMPTY POLICY. With no analysis and with no ranked rule, the generator
//      refuses and the shipped control is disabled with the reason stated.

import assert from "node:assert/strict";
import test from "node:test";

import { loadExampleDataset } from "../src/example-dataset.js";
import { routingSlate } from "../src/routing-slate.js";
import {
  ROUTING_POLICY_CONTROL_LABEL, ROUTING_POLICY_SCHEMA, ROUTING_POLICY_STATEMENT,
  ROUTING_POLICY_VERSION, routingPolicyAvailability, routingPolicyDocument,
  routingPolicyDownloadedMessage, routingPolicyText,
} from "../src/routing-policy-document.js";
import { applyRoutingSlate } from "../src/routing-slate-view.js";
import { loadPage, textOf } from "./support/browser.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

const STAMP = "2026-08-05T09:30:00.000Z";
const LATER = "2026-09-01T00:00:00.000Z";

/** The slate a first-time visitor meets: the real bundled example, not a fixture. */
const bundledSlate = () => routingSlate(loadExampleDataset());

// ---------------------------------------------------------------------------
// 1 and 2. Determinism.
// ---------------------------------------------------------------------------

test("two generations of one slate at one timestamp are the same string", () => {
  const slate = bundledSlate();
  assert.ok(slate.rules.length >= 2, "the bundled example must earn ranked rules to export");
  assert.strictEqual(routingPolicyText(slate, STAMP), routingPolicyText(slate, STAMP));
});

test("re-ranking the same export from a second slate object still exports the same bytes", () => {
  // Two independently composed slates over one dataset. This is the case a
  // memoised page hides: the reader downloads before an import and after one
  // that changed nothing, and the two files have to be identical.
  const first = routingPolicyText(routingSlate(loadExampleDataset()), STAMP);
  const second = routingPolicyText(routingSlate(loadExampleDataset()), STAMP);
  assert.strictEqual(first, second);
});

test("only the timestamp differs when the timestamp changes", () => {
  const slate = bundledSlate();
  const earlier = routingPolicyText(slate, STAMP);
  const later = routingPolicyText(slate, LATER);

  assert.notStrictEqual(earlier, later, "the stamp must actually reach the file");
  assert.strictEqual(earlier.split(STAMP).length, 2, "the stamp must occur exactly once");
  assert.strictEqual(earlier.split(STAMP).join(LATER), later,
    "swapping the one timestamp must turn one export into the other, character for character");
  assert.strictEqual(JSON.parse(earlier).generatedAt, STAMP);
  assert.strictEqual(JSON.parse(later).generatedAt, LATER);
});

test("key order is the declared order, not an order a rule was built in", () => {
  const document = routingPolicyDocument(bundledSlate(), STAMP);
  assert.deepStrictEqual(Object.keys(document), [
    "schema", "version", "generatedAt", "period", "statement", "basis", "tieBreak",
    "ruleCount", "totalExpectedMonthlyReturnUsd", "rules",
  ]);
  assert.deepStrictEqual(Object.keys(document.rules[0]), [
    "rank", "sourceModel", "sourceTier", "targetTier", "expectedMonthlyReturnUsd",
    "observedChangeUsd", "guardrails", "evidence",
  ]);
});

test("no dollar figure in the file carries a fraction", () => {
  const document = routingPolicyDocument(bundledSlate(), STAMP);
  assert.ok(Number.isInteger(document.totalExpectedMonthlyReturnUsd));
  for (const rule of document.rules) {
    assert.ok(Number.isInteger(rule.expectedMonthlyReturnUsd),
      `rank ${rule.rank} exports ${rule.expectedMonthlyReturnUsd}, which formats differently `
      + "on a second export");
    assert.ok(rule.observedChangeUsd === null || Number.isInteger(rule.observedChangeUsd));
  }
});

// ---------------------------------------------------------------------------
// 3. It says what it is, and it decides nothing new.
// ---------------------------------------------------------------------------

test("the document names its schema, its version and the period it came from", () => {
  const slate = bundledSlate();
  const document = routingPolicyDocument(slate, STAMP);
  assert.strictEqual(document.schema, ROUTING_POLICY_SCHEMA);
  assert.strictEqual(document.version, ROUTING_POLICY_VERSION);
  assert.strictEqual(document.period, slate.period);
  assert.ok(document.period, "the bundled example publishes a period, so the file must carry it");
  assert.strictEqual(document.ruleCount, slate.rules.length);
});

test("it says in plain words that it is a proposal to be reviewed, not a configuration", () => {
  const { statement } = routingPolicyDocument(bundledSlate(), STAMP);
  assert.strictEqual(statement, ROUTING_POLICY_STATEMENT);
  assert.ok(statement.includes("proposal"));
  assert.ok(statement.includes("live gateway"),
    "the sentence has to name the thing the reader must not change yet");
  assert.ok(/your own browser/.test(statement),
    "it has to say the figures came from the reader's own export");
});

test("every rule carries its source, target tier, return, guardrails and evidence", () => {
  const slate = bundledSlate();
  const document = routingPolicyDocument(slate, STAMP);
  assert.strictEqual(document.rules.length, slate.rules.length);
  for (const [index, exported] of document.rules.entries()) {
    const rule = slate.rules[index];
    assert.strictEqual(exported.rank, rule.rank, "rule order must be the slate's rank");
    assert.strictEqual(exported.sourceModel, rule.source);
    assert.strictEqual(exported.targetTier, rule.targetTier);
    assert.strictEqual(exported.expectedMonthlyReturnUsd, rule.expectedMonthlyUsd);
    assert.strictEqual(exported.guardrails.appliesToOrgUnit, rule.unit);
    assert.strictEqual(exported.guardrails.appliesToSourceTier, rule.sourceTier);
    assert.strictEqual(exported.guardrails.derivedFromPeriod, slate.period);
    assert.strictEqual(exported.guardrails.lifecycle, rule.lifecycle);
    assert.strictEqual(exported.guardrails.reviewBeforeApply, true);
    assert.strictEqual(exported.evidence.statement, rule.evidence);
    assert.ok(exported.evidence.statement, "a rule with no evidence line is not disputable");
    assert.strictEqual(exported.evidence.derivedFrom, slate.source);
  }
});

test("the exported total is the slate's own total, not a second sum", () => {
  const slate = bundledSlate();
  const document = routingPolicyDocument(slate, STAMP);
  assert.strictEqual(document.totalExpectedMonthlyReturnUsd, slate.totalExpectedMonthlyUsd);
  const added = document.rules.reduce((sum, rule) => sum + rule.expectedMonthlyReturnUsd, 0);
  assert.strictEqual(added, document.totalExpectedMonthlyReturnUsd,
    "a reader adding the exported column has to reach the exported total");
});

test("the generator reads no clock and refuses a timestamp it was not given", () => {
  const slate = bundledSlate();
  assert.throws(() => routingPolicyDocument(slate), /timestamp/);
  assert.throws(() => routingPolicyDocument(slate, ""), /timestamp/);
});

test("the module never reads a clock, a network or storage of its own", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../src/routing-policy-document.js", import.meta.url), "utf8");
  for (const forbidden of ["Date.now", "new Date", "fetch(", "localStorage", "XMLHttpRequest"]) {
    assert.ok(!source.includes(forbidden),
      `${forbidden} in a generator that promises byte-identical output is a defect`);
  }
});

// ---------------------------------------------------------------------------
// 4. There is no empty policy.
// ---------------------------------------------------------------------------

test("with no analysis there is nothing to download and the reason says so", () => {
  const slate = routingSlate(null);
  const { available, reason } = routingPolicyAvailability(slate);
  assert.strictEqual(available, false);
  assert.strictEqual(reason, slate.reason);
  assert.ok(reason.length > 0, "a disabled control with no stated reason is a dead control");
  assert.throws(() => routingPolicyText(slate, STAMP), new RegExp("no routing change"));
});

test("an envelope that ranks no rule refuses too, rather than exporting an empty list", () => {
  const slate = routingSlate({ period: "2026-06-01 to 2026-06-30", rankedDepartments: [] });
  assert.strictEqual(slate.rules.length, 0);
  const { available, reason } = routingPolicyAvailability(slate);
  assert.strictEqual(available, false);
  assert.strictEqual(reason, slate.reason);
  assert.throws(() => routingPolicyDocument(slate, STAMP));
});

test("a slate that was never composed refuses with its own sentence", () => {
  const { available, reason } = routingPolicyAvailability(null);
  assert.strictEqual(available, false);
  assert.ok(reason.includes("no policy to download"));
});

// ---------------------------------------------------------------------------
// The shipped control.
// ---------------------------------------------------------------------------

test("the shipped control is authored inside the routing section, disabled, with its reason", async () => {
  const { document } = await loadPage(PAGE, { scripts: false });
  const button = document.getElementById("routing-policy-download");
  assert.ok(button, "the control must be authored in evolution.html");
  assert.strictEqual(button.getAttribute("type"), "button");
  assert.strictEqual(button.hasAttribute("disabled"), true,
    "a document whose script never ran has no slate, so the control must refuse");
  const label = textOf(button);
  assert.ok(label.startsWith(ROUTING_POLICY_CONTROL_LABEL), label);
  assert.ok(label.includes("unavailable"), "the disabled state must be in the accessible name");
  assert.ok(label.includes("No analysis has been read yet"), label);

  // The harness rejects descendant selectors, so the section is walked up to.
  let ancestor = button.parentNode;
  const ids = [];
  while (ancestor) {
    if (ancestor.id) ids.push(ancestor.id);
    ancestor = ancestor.parentNode;
  }
  assert.ok(ids.includes("routing-slate"),
    `the control must live inside the routing-slate section, saw ${ids.join(", ")}`);
  assert.strictEqual(ids.includes("routing-slate-body"), false,
    "inside the painted body it would be replaced on the next paint");
});

test("painting a slate with rules hands the control back, with no reason left on it", async () => {
  const { document } = await loadPage(PAGE, { scripts: false });
  const slate = applyRoutingSlate(document, loadExampleDataset());
  assert.ok(slate.rules.length >= 2);
  const button = document.getElementById("routing-policy-download");
  assert.strictEqual(button.hasAttribute("disabled"), false);
  assert.strictEqual(button.dataset.state, "ready");
  assert.strictEqual(textOf(button).trim(), ROUTING_POLICY_CONTROL_LABEL,
    "an enabled control must not carry an 'unavailable' clause in its name");
});

test("painting an unreadable envelope disables the control again and states why", async () => {
  const { document } = await loadPage(PAGE, { scripts: false });
  applyRoutingSlate(document, loadExampleDataset());
  const slate = applyRoutingSlate(document, { rankedDepartments: "not an array" });
  assert.strictEqual(slate.available, false);
  const button = document.getElementById("routing-policy-download");
  assert.strictEqual(button.hasAttribute("disabled"), true,
    "a control left enabled after the rules went away downloads a policy that is not on screen");
  assert.strictEqual(button.dataset.state, "unavailable");
  assert.ok(textOf(button).includes(slate.reason), textOf(button));
});

test("the download is announced through the region the section already has", async () => {
  const { document } = await loadPage(PAGE, { scripts: false });
  const slate = applyRoutingSlate(document, loadExampleDataset());
  const { announceRoutingPolicyDownload } = await import("../src/routing-slate-view.js");
  const message = announceRoutingPolicyDownload(document, slate);
  const status = document.getElementById("routing-slate-status");
  assert.strictEqual(status.getAttribute("role"), "status",
    "the announcement has to land in a region a screen reader is already watching");
  assert.strictEqual(textOf(status), message);
  assert.strictEqual(message, routingPolicyDownloadedMessage(slate));
  assert.ok(message.includes(String(slate.rules.length)), message);
  assert.ok(message.includes("proposal"), message);
});
