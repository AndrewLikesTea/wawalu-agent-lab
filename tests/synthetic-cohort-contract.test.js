import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  SYNTHETIC_COHORT_CONTRACT, SYNTHETIC_COHORT_REASON, inspectSyntheticCohort,
} from "../src/synthetic-cohort-contract.js";
import { SYNTHETIC_COHORT_FIXTURE } from "../src/synthetic-cohort-fixture.js";
import { analyzeBundledScenario } from "../src/finops-bundled-scenarios.js";

const fixture = async (name) => JSON.parse(await readFile(new URL(
  `../contracts/integrations/synthetic-benchmark-cohort/v1/fixtures/${name}.json`, import.meta.url), "utf8"));
const clone = (value) => structuredClone(value);

test("bundled snapshot is eligible and is wired into the FinOps scenario result", () => {
  const inspected = inspectSyntheticCohort(SYNTHETIC_COHORT_FIXTURE);
  assert.deepEqual(inspected, {
    contract: SYNTHETIC_COHORT_CONTRACT, eligible: true, reason: "eligible",
    snapshotId: "synthetic-cohorts-2026-07", issues: [],
    execution: { location: "client", networkRequired: false },
  });
  const analysis = analyzeBundledScenario({ scenarioId: "aws-bedrock-cur-v1" });
  assert.equal(analysis.ok, true);
  assert.equal(analysis.eligibility.snapshotId, inspected.snapshotId);
  assert.equal(analysis.eligibility.execution.networkRequired, false);
});

test("the four labelled contract fixtures produce their stated eligibility", async () => {
  const expected = {
    valid: SYNTHETIC_COHORT_REASON.eligible,
    missing: SYNTHETIC_COHORT_REASON.missing,
    incompatible: SYNTHETIC_COHORT_REASON.incompatible,
    prohibited: SYNTHETIC_COHORT_REASON.prohibited,
  };
  for (const [name, reason] of Object.entries(expected)) {
    const result = inspectSyntheticCohort(await fixture(name));
    assert.equal(result.reason, reason, name);
    assert.equal(result.eligible, name === "valid", name);
  }
});

test("snapshot.id is required and exactly matches synthetic-cohorts-YYYY-MM", () => {
  for (const id of [undefined, "", "cohorts-2026-07", "synthetic-cohorts-2026-7",
    "synthetic-cohorts-2026-13", "synthetic-cohorts-26-07", "synthetic-cohorts-2026-07-extra"]) {
    const input = clone(SYNTHETIC_COHORT_FIXTURE);
    if (id === undefined) delete input.snapshot.id; else input.snapshot.id = id;
    const result = inspectSyntheticCohort(input);
    assert.equal(result.eligible, false, String(id));
    assert.match(result.issues.join(" "), /snapshot\.id.*required.*synthetic-cohorts-YYYY-MM/);
  }
});

test("generatedAt requires a real strict RFC 3339 date-time, not Date.parse acceptance", () => {
  const invalid = [undefined, "2026-08-01", "August 1, 2026", "2026-08-01 00:00:00Z",
    "2026-02-30T00:00:00Z", "2026-08-01T24:00:00Z", "2026-08-01T00:00:00",
    "2026-08-01T00:00:00+24:00"];
  for (const generatedAt of invalid) {
    const input = clone(SYNTHETIC_COHORT_FIXTURE);
    if (generatedAt === undefined) delete input.snapshot.generatedAt;
    else input.snapshot.generatedAt = generatedAt;
    assert.match(inspectSyntheticCohort(input).issues.join(" "), /strict RFC 3339/);
  }
  for (const generatedAt of ["2026-08-01T00:00:00Z", "2026-08-01T00:00:00.123+05:30"]) {
    const input = clone(SYNTHETIC_COHORT_FIXTURE); input.snapshot.generatedAt = generatedAt;
    assert.equal(inspectSyntheticCohort(input).eligible, true);
  }
});

test("identifiers, credentials, prompts, account IDs, employee records, and raw data are prohibited", () => {
  const keys = ["user_identifier", "credential", "prompt_content", "provider_account_id",
    "employee_record", "raw_customer_data", "api_key", "tenant_id"];
  for (const key of keys) {
    const input = clone(SYNTHETIC_COHORT_FIXTURE);
    input.scenarios[0][key] = "secret value";
    const inspected = inspectSyntheticCohort(input);
    assert.equal(inspected.reason, SYNTHETIC_COHORT_REASON.prohibited, key);
    assert.doesNotMatch(inspected.issues.join(" "), /secret value/);
  }
});

test("reordering is stable; partial and malformed aggregates are deterministically rejected", () => {
  const reversed = clone(SYNTHETIC_COHORT_FIXTURE);
  reversed.scenarios.reverse();
  assert.equal(inspectSyntheticCohort(reversed).eligible, true);

  const malformed = clone(SYNTHETIC_COHORT_FIXTURE);
  delete malformed.scenarios[0].query_count;
  malformed.scenarios[1].spend_usd = -1;
  const first = inspectSyntheticCohort(malformed);
  const second = inspectSyntheticCohort(clone(malformed));
  assert.deepEqual(first, second);
  assert.equal(first.reason, SYNTHETIC_COHORT_REASON.malformed);
  assert.deepEqual(first.issues, [...first.issues].sort());
});

test("stale snapshots remain inspectably dated without a hidden clock or network check", () => {
  const stale = clone(SYNTHETIC_COHORT_FIXTURE);
  stale.snapshot.id = "synthetic-cohorts-2020-01";
  stale.snapshot.generatedAt = "2020-02-01T00:00:00Z";
  const inspected = inspectSyntheticCohort(stale);
  assert.equal(inspected.eligible, true);
  assert.equal(inspected.snapshotId, "synthetic-cohorts-2020-01");
});

test("validation source contains no live request path", async () => {
  const sources = await Promise.all(["synthetic-cohort-contract.js", "synthetic-cohort-fixture.js"]
    .map((name) => readFile(new URL(`../src/${name}`, import.meta.url), "utf8")));
  assert.doesNotMatch(sources.join("\n"), /\bfetch\s*\(|XMLHttpRequest|WebSocket|https?:\/\//);
});
