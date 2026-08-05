// The routing policy file: the ranked slate as an artifact a FinOps lead hands
// to whoever owns the gateway.
//
// Four properties carry it, and each has a test that fails when it stops holding:
//
//   1. It is a function of the slate and the passed timestamp and nothing else.
//      Two calls with the same pair are byte-identical, so a month-over-month
//      diff of two policy files shows routing changes and never serialization.
//   2. Every figure in it is the slate's. Nothing is re-derived at export time,
//      because a file that ranks the analysis a second time can disagree with
//      the list the reader decided from.
//   3. It refuses to be written when there is no ranked rule. An empty policy
//      imports cleanly and reads as "nothing is recommended", which is a
//      different claim from "no export has been read".
//   4. The shipped page offers it, disabled until there is something to hand
//      over, and describes it by the same review notice the file carries.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { loadExampleDataset } from "../src/example-dataset.js";
import {
  ROUTING_POLICY_NOTICE, ROUTING_POLICY_SCHEMA, ROUTING_POLICY_VERSION,
  buildRoutingPolicy, routingPolicyFile, routingSlate, serializeRoutingPolicy,
} from "../src/routing-slate.js";
import { ROUTING_POLICY_BUTTON_ID, applyRoutingSlate } from "../src/routing-slate-view.js";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(
  await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));
const GENERATED_AT = "2026-08-05T12:00:00.000Z";

/** The record the page renders from, built the one way the page builds it. */
const exampleSlate = () => routingSlate(loadExampleDataset());

// ---------------------------------------------------------------------------
// 1. Same record, same timestamp, same bytes.
// ---------------------------------------------------------------------------

test("two builds of one slate at one timestamp serialize to identical bytes", () => {
  const slate = exampleSlate();
  const first = serializeRoutingPolicy(buildRoutingPolicy(slate, { generatedAt: GENERATED_AT }));
  const second = serializeRoutingPolicy(buildRoutingPolicy(slate, { generatedAt: GENERATED_AT }));
  assert.equal(first, second, "the file must be a function of the record and the timestamp alone");
  assert.equal(routingPolicyFile(slate, { generatedAt: GENERATED_AT }).text, first);
});

test("rule order is the slate's rank, not the order the rules were handed over", () => {
  const slate = exampleSlate();
  // The same record with its rules reversed: a filter or a re-collection upstream
  // may reorder the array, and the file must not notice.
  const reversed = { ...slate, rules: [...slate.rules].reverse() };
  assert.equal(
    serializeRoutingPolicy(buildRoutingPolicy(reversed, { generatedAt: GENERATED_AT })),
    serializeRoutingPolicy(buildRoutingPolicy(slate, { generatedAt: GENERATED_AT })),
  );
  const policy = buildRoutingPolicy(reversed, { generatedAt: GENERATED_AT });
  assert.deepEqual(policy.rules.map((rule) => rule.rank),
    slate.rules.map((rule) => rule.rank), "the file carries the ranked order");
});

test("the timestamp is the caller's and is required", () => {
  const slate = exampleSlate();
  assert.throws(() => buildRoutingPolicy(slate), TypeError,
    "a file stamped with no timestamp is worse than one that refused to be written");
  assert.throws(() => buildRoutingPolicy(slate, { generatedAt: "" }), TypeError);
  assert.equal(buildRoutingPolicy(slate, { generatedAt: GENERATED_AT }).generatedAt, GENERATED_AT);
});

// ---------------------------------------------------------------------------
// 2. Every field is the record's.
// ---------------------------------------------------------------------------

test("the policy stamps its schema, its version and the period it was derived from", () => {
  const slate = exampleSlate();
  const policy = buildRoutingPolicy(slate, { generatedAt: GENERATED_AT });
  assert.equal(policy.schema, ROUTING_POLICY_SCHEMA);
  assert.equal(policy.schema, "routing-policy/v1", "the identifier is a stable literal");
  assert.equal(policy.policyVersion, ROUTING_POLICY_VERSION);
  assert.equal(policy.policyVersion, 1);
  assert.equal(policy.period, slate.period, "the period is the analysis's, not a new window");
  assert.ok(policy.period, "the bundled example must carry a period to export");
  assert.equal(policy.basis, slate.basis);
  assert.equal(policy.ranking, slate.tieBreak);
  assert.equal(policy.totalExpectedMonthlyUsd, slate.totalExpectedMonthlyUsd);
});

test("every rule carries source, target tier, return, guardrails and evidence from the record", () => {
  const slate = exampleSlate();
  const policy = buildRoutingPolicy(slate, { generatedAt: GENERATED_AT });
  assert.equal(policy.rules.length, slate.rules.length);
  assert.ok(policy.rules.length >= 2, "the bundled example must exercise more than one rule");
  for (const rule of slate.rules) {
    const exported = policy.rules[rule.rank - 1];
    assert.equal(exported.sourceModel, rule.source);
    assert.equal(exported.targetTier, rule.targetTier);
    assert.equal(exported.expectedMonthlyUsd, rule.expectedMonthlyUsd);
    assert.equal(exported.evidence, rule.evidence);
    assert.ok(exported.evidence.length > 0, "the evidence reference is what a reader disputes");
    assert.deepEqual(exported.guardrails, {
      currentTier: rule.sourceTier,
      orgUnit: rule.unit,
      confidence: rule.confidence,
      basis: rule.basis,
    });
  }
});

test("the file carries a review notice and no field beyond the declared contract", () => {
  const policy = buildRoutingPolicy(exampleSlate(), { generatedAt: GENERATED_AT });
  assert.equal(policy.notice, ROUTING_POLICY_NOTICE);
  assert.match(policy.notice, /proposal derived from your own export/);
  assert.match(policy.notice, /before applying it to a live gateway configuration/);
  assert.deepEqual(Object.keys(policy).sort(), [
    "basis", "generatedAt", "notice", "period", "policyVersion", "ranking", "rules",
    "schema", "totalExpectedMonthlyUsd",
  ], "a field nobody declared is a field that can carry prompt or customer text");
  assert.deepEqual(Object.keys(policy.rules[0]).sort(), [
    "evidence", "expectedMonthlyUsd", "guardrails", "rank", "sourceModel", "targetTier",
  ]);
});

test("the file names the period it covers and carries no wall-clock time in its name", () => {
  const slate = exampleSlate();
  const file = routingPolicyFile(slate, { generatedAt: GENERATED_AT });
  const slug = slate.period.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  assert.equal(file.fileName, `routing-policy-${slug}.json`);
  assert.equal(file.mediaType, "application/json");
  assert.equal(routingPolicyFile(slate, { generatedAt: "2026-09-09T23:59:59.000Z" }).fileName,
    file.fileName, "the name must be stable within a session");
});

// ---------------------------------------------------------------------------
// 3. Nothing ranked, nothing handed over.
// ---------------------------------------------------------------------------

test("a slate with no ranked rule produces no policy at all", () => {
  for (const slate of [routingSlate(null), routingSlate({ period: "2026-06", rankedDepartments: [] })]) {
    assert.equal(slate.available, false);
    assert.equal(buildRoutingPolicy(slate, { generatedAt: GENERATED_AT }), null);
    assert.equal(routingPolicyFile(slate, { generatedAt: GENERATED_AT }), null);
  }
  assert.equal(buildRoutingPolicy(null, { generatedAt: GENERATED_AT }), null);
  // Every rule filtered out of an otherwise ready record is the same state.
  assert.equal(
    buildRoutingPolicy({ ...exampleSlate(), rules: [] }, { generatedAt: GENERATED_AT }), null);
});

// ---------------------------------------------------------------------------
// 4. The shipped page offers it.
// ---------------------------------------------------------------------------

test("the control ships disabled, named on its own, and beside the file's own notice", async () => {
  const markup = await readFile(PAGE, "utf8");
  assert.ok(markup.includes(ROUTING_POLICY_NOTICE),
    "the page and the file must describe the artifact in one sentence, authored once");
  const { document } = await loadPage(PAGE, { scripts: false });
  const button = document.getElementById(ROUTING_POLICY_BUTTON_ID);
  assert.ok(button, "the download control must be authored in evolution.html");
  assert.equal(button.disabled, true, "a page whose script never ran has nothing to hand over");
  assert.equal(textOf(button), "Download routing policy (JSON)");
  // It is inside the routing-slate section rather than beside a different export.
  let ancestor = button.parentNode;
  while (ancestor && ancestor.getAttribute?.("id") !== "routing-slate") ancestor = ancestor.parentNode;
  assert.ok(ancestor, "the control belongs to the section whose rules it exports");
});

test("the control is enabled with rules and described by the notice, disabled without", async () => {
  const { document } = await loadPage(PAGE, { scripts: false });
  const button = document.getElementById(ROUTING_POLICY_BUTTON_ID);

  const slate = applyRoutingSlate(document, loadExampleDataset());
  assert.equal(slate.available, true);
  assert.equal(button.disabled, false, "the bundled example ranks rules, so they can be exported");
  assert.equal(button.getAttribute("aria-describedby"), "routing-policy-note");
  assert.equal(textOf(document.getElementById("routing-policy-note")), ROUTING_POLICY_NOTICE);

  const cleared = applyRoutingSlate(document, null);
  assert.equal(button.disabled, true, "no analysis, no policy to offer");
  assert.equal(button.getAttribute("aria-describedby"), "routing-slate-reason");
  assert.equal(textOf(document.getElementById("routing-slate-reason")), cleared.reason,
    "the disabled control is described by the sentence saying why there is nothing to export");
});

test("the shipped page hands over one file, named for the period, from the rules on screen", async () => {
  // The real page entry, so this is the wiring that ships rather than a call
  // this file made itself: the download goes through the same local blob helper
  // every other artifact on this page uses.
  const page = await loadPage(PAGE, {
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  const { document } = page;
  const button = document.getElementById(ROUTING_POLICY_BUTTON_ID);
  assert.equal(button.disabled, true, "nothing is analysed until the reader asks for it");

  document.getElementById("try-example-dataset").click();
  assert.equal(button.disabled, false, "the example ranks rules, so the policy can be handed over");
  button.click();
  assert.equal(page.downloads.length, 1, "the control must hand back exactly one file");
  const [download] = page.downloads;
  const slate = routingSlate(loadExampleDataset());
  assert.equal(download.filename, `routing-policy-${
    slate.period.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`);
  const policy = JSON.parse(download.text);
  assert.equal(policy.schema, ROUTING_POLICY_SCHEMA);
  assert.equal(policy.policyVersion, ROUTING_POLICY_VERSION);
  assert.equal(policy.notice, ROUTING_POLICY_NOTICE);
  assert.equal(policy.period, slate.period);
  assert.equal(policy.rules.length, Number(document.getElementById("routing-slate").dataset.ruleCount),
    "the file carries the rules the section says it is showing");
  assert.equal(policy.totalExpectedMonthlyUsd, slate.totalExpectedMonthlyUsd);
  assert.match(policy.generatedAt, /^\d{4}-\d{2}-\d{2}T/, "the page passes its own clock read in");
});
