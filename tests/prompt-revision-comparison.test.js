import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildCoachingSession } from "../src/prompt-coaching-contract.js";
import {
  COMPARISON_BODY_FIELDS, COMPARISON_BOUNDARY, COMPARISON_FIELDS,
  PROMPT_REVISION_COMPARISON_VERSION, buildRevisionComparison,
} from "../src/prompt-revision-comparison.js";

const strong = [
  "Context: we run a checkout service on Node 20 behind a CDN, and retries flood payments.",
  "Constraints: do not add a dependency and do not change the public API.",
  "Success: return a one-file patch and a test that fails without it.",
  "Explain the retry storm and propose the smallest fix.",
].join("\n");
const weak = "improve the checkout code somehow and make it better as needed";
const session = (id, text, modelTier = "standard") =>
  buildCoachingSession({ sessionId: id, text, modelTier });

test("the shipped contract answers improved, unchanged, and regressed deterministically", () => {
  const cases = [
    ["improved", session("a1", weak), session("a2", strong), "improved", "apply_remaining"],
    ["unchanged", session("b1", strong), session("b2", strong), "unchanged", "apply_remaining"],
    ["regressed", session("c1", strong), session("c2", weak), "regressed", "revert"],
  ];
  for (const [id, baseline, revision, direction, action] of cases) {
    const result = buildRevisionComparison({ comparisonId: id, baseline, revision });
    assert.equal(result.schemaVersion, PROMPT_REVISION_COMPARISON_VERSION);
    assert.deepEqual(Object.keys(result).sort(), [...COMPARISON_FIELDS].sort());
    assert.deepEqual(Object.keys(result.comparison).sort(), [...COMPARISON_BODY_FIELDS].sort());
    assert.equal(result.compared, true);
    assert.equal(result.comparison.headline.direction, direction);
    assert.equal(result.comparison.nextAction.kind, action);
    assert.deepEqual(result.boundary, COMPARISON_BOUNDARY);
    assert.equal(JSON.stringify(result),
      JSON.stringify(buildRevisionComparison({ comparisonId: id, baseline, revision })));
  }
});

test("abstention is ordered and always provides one recovery action", () => {
  const graded = session("graded", strong);
  const empty = session("empty", " ");
  const result = buildRevisionComparison({
    comparisonId: "refused", baseline: graded, revision: empty,
  });
  assert.equal(result.compared, false);
  assert.equal(result.reason, "revision_not_graded");
  assert.equal(result.comparison.headline, null);
  assert.equal(result.comparison.grade, null);
  assert.equal(result.comparison.remainingWeakness, null);
  assert.equal(result.comparison.nextAction.kind, "abstain_recovery");

  const changedTier = buildRevisionComparison({
    comparisonId: "tier", baseline: graded, revision: session("premium", strong, "premium"),
  });
  assert.equal(changedTier.reason, "tier_changed");
});

test("comparison accepts sessions only and cannot retain either marker", () => {
  const baselineMarker = "BASELINE-ZZQX-413";
  const revisionMarker = "REVISION-ZZQX-927";
  const baseline = session("marker-a", `${strong}\n${baselineMarker}`);
  const revision = session("marker-b", `${strong}\n${revisionMarker}`);
  const serialized = JSON.stringify(buildRevisionComparison({
    comparisonId: "markers", baseline, revision,
  }));
  assert.equal(serialized.includes(baselineMarker), false);
  assert.equal(serialized.includes(revisionMarker), false);
  assert.throws(() => buildRevisionComparison({
    comparisonId: "bad", baseline: "prompt text", revision,
  }), /invalid baseline session/);
});

test("the comparison implementation has no network or persistence capability", async () => {
  const source = await readFile(new URL("../src/prompt-revision-comparison.js", import.meta.url), "utf8");
  const executable = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
  for (const capability of [
    "fetch", "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource",
    "localStorage", "sessionStorage", "indexedDB", "document.cookie",
  ]) {
    assert.equal(new RegExp(`\\b${capability.replace(".", "\\.")}\\b`).test(executable), false,
      `${capability} would violate the comparison boundary`);
  }
});
