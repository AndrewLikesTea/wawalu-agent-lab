import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assessBriefingReadiness, READINESS_STATE, REQUIRED_EVIDENCE, REQUIRED_EXCLUSIONS,
} from "../src/briefing-readiness.js";
import { renderBriefingReadiness } from "../src/briefing-readiness-view.js";
import { createElement } from "./support/dom.js";

const fixture = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));

test("the bundled period answers whether the analysis is decision-ready", () => {
  const decision = assessBriefingReadiness(fixture.briefingReadiness);
  assert.equal(decision.state, READINESS_STATE.complete);
  assert.equal(decision.readyToCirculate, true);
  assert.deepEqual(decision.missingEvidence, []);
  assert.deepEqual(REQUIRED_EVIDENCE, [
    "headlineFinding", "benchmarkComparison", "recommendedAction",
    "confidence", "sourcePeriod", "exclusions",
  ]);
  assert.deepEqual(REQUIRED_EXCLUSIONS, ["prompts", "providerRows"]);
  assert.match(decision.benchmarkComparison, /10 points above.*median of 61/);
  assert.deepEqual(decision.sourcePeriod, {
    start: "2026-06-25", end: "2026-07-25",
    provenance: "hand-authored bundled provider aggregates and org mapping; not live provider or HRIS data",
  });
});

test("omitted supported evidence is visibly incomplete", async () => {
  const input = structuredClone(fixture.briefingReadiness);
  delete input.benchmarkComparison;
  const decision = assessBriefingReadiness(input);
  assert.equal(decision.state, READINESS_STATE.insufficientEvidence);
  assert.equal(decision.readyToCirculate, false);
  assert.deepEqual(decision.missingEvidence, ["benchmarkComparison"]);

  const nodes = Object.fromEntries([
    "briefing-readiness", "briefing-readiness-verdict", "briefing-readiness-finding",
    "briefing-readiness-benchmark", "briefing-readiness-action", "briefing-readiness-confidence",
    "briefing-readiness-period", "briefing-readiness-boundary",
  ].map((id) => [id, createElement("p")]));
  const document = { getElementById: (id) => nodes[id] ?? null };
  renderBriefingReadiness(document, decision);
  assert.equal(document.getElementById("briefing-readiness").dataset.state, "insufficient-evidence");
  assert.match(document.getElementById("briefing-readiness-verdict").textContent, /Not ready/);
  assert.match(document.getElementById("briefing-readiness-benchmark").textContent, /missing/);
  assert.match(document.getElementById("briefing-readiness-boundary").textContent,
    /Missing required evidence: benchmarkComparison/);
});

test("claims outside the static model are unsupported, even when evidence is complete", () => {
  const input = structuredClone(fixture.briefingReadiness);
  input.claims.liveProviderAccess = true;
  input.claims.providerRows = true;
  const decision = assessBriefingReadiness(input);
  assert.equal(decision.state, READINESS_STATE.unsupportedInput);
  assert.equal(decision.readyToCirculate, false);
  assert.deepEqual(decision.unsupportedClaims, ["liveProviderAccess", "providerRows"]);
});

test("a seed that never arrived is missing evidence, not an unsupported claim", () => {
  for (const absent of [null, undefined, "", 7]) {
    const decision = assessBriefingReadiness(absent);
    assert.equal(decision.state, READINESS_STATE.insufficientEvidence);
    assert.equal(decision.readyToCirculate, false);
    // The failed-fetch path renders this. Reporting it as an unsupported input
    // would tell a reader the seed claimed live provider access.
    assert.deepEqual(decision.unsupportedClaims, []);
    assert.deepEqual(decision.missingEvidence, REQUIRED_EVIDENCE);
  }
});

test("the decision carries only declared fields, and none of them are writable", () => {
  const input = structuredClone(fixture.briefingReadiness);
  input.confidence.promptSample = "a customer prompt that must not reach the briefing";
  input.sourcePeriod.providerRows = 41;
  const decision = assessBriefingReadiness(input);
  assert.equal(decision.state, READINESS_STATE.complete);
  assert.deepEqual(Object.keys(decision.confidence), ["level", "basis"]);
  assert.deepEqual(Object.keys(decision.sourcePeriod), ["start", "end", "provenance"]);
  assert.deepEqual(Object.keys(decision.exclusions), [...REQUIRED_EXCLUSIONS]);
  for (const part of [decision, decision.confidence, decision.sourcePeriod, decision.exclusions]) {
    assert.equal(Object.isFrozen(part), true);
  }
  // A caller holding the decision cannot turn a "not ready" into a "ready".
  assert.throws(() => { decision.readyToCirculate = true; }, TypeError);
});

test("the failed-seed branch resolves the region instead of leaving it checking", async () => {
  const wiring = await readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8");
  const failure = wiring.slice(0, wiring.indexOf("applyPanelLifecycle(document, PANEL_STATUS.error)"));
  assert.match(failure.slice(failure.lastIndexOf("bundledSeed = null;")),
    /renderBriefingReadiness\(document, assessBriefingReadiness\(null\)\)/,
    "a seed that never loaded must still resolve the circulation decision");
});

test("the existing evolution surface consumes and renders the contract", async () => {
  const [page, wiring] = await Promise.all([
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8"),
  ]);
  assert.match(page, /Is this bundled analysis ready to circulate\?/);
  // #1020: the record still comes from the bundled seed, but its first action is
  // the one derived by src/finops-bundled-next-step.js, so this block and the two
  // evidence layers below it cannot name different first actions.
  assert.match(wiring, /assessBriefingReadiness\(withDerivedFirstAction\(data\)\)/);
  assert.match(wiring, /renderBriefingReadiness/);
});
