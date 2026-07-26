import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { analyzeLongitudinalFinops } from "../src/local-finops-longitudinal.js";
import { normalizeLocalFinops } from "../src/local-finops.js";

const readJson = async (url) => JSON.parse(await readFile(url, "utf8"));
const fixtureUrl = new URL("../src/local-finops-longitudinal-fixture.json", import.meta.url);

test("leader question: where is spend changing period over period?", async () => {
  const result = analyzeLongitudinalFinops(await readJson(fixtureUrl));
  const departmentA = result.findings.find(({ departmentId }) => departmentId === "department-a");

  assert.deepEqual(departmentA.trend.changes, [
    { fromPeriodId: "2026-04", toPeriodId: "2026-05", percentChange: 20 },
    { fromPeriodId: "2026-05", toPeriodId: "2026-06", percentChange: 25 },
  ]);
  assert.equal(departmentA.trend.latestPercentChange, 25);
});

test("leader question: how does each department compare with an eligible benchmark?", async () => {
  const result = analyzeLongitudinalFinops(await readJson(fixtureUrl));
  const departmentA = result.findings.find(({ departmentId }) => departmentId === "department-a");

  // A's peer mean excludes A: (105000 + 85000) / 2 = 95000 minor units.
  assert.deepEqual(departmentA.comparison, {
    status: "comparable",
    benchmarkValue: 95000,
    differenceValue: 55000,
    percentDifference: 57.89,
    eligibleDepartmentCount: 3,
  });
  assert.equal(departmentA.estimatedExcessValue, 55000);
});

test("leader question: how trustworthy is the finding?", async () => {
  const fixture = await readJson(fixtureUrl);
  const result = analyzeLongitudinalFinops(fixture);
  assert.equal(result.findings.find((item) => item.departmentId === "department-a").confidence, "high");
  assert.equal(result.findings.find((item) => item.departmentId === "department-b").confidence, "high");
  assert.equal(result.findings.find((item) => item.departmentId === "department-c").confidence,
    "non-comparable");

  const onlyA = structuredClone(fixture);
  onlyA.observations = onlyA.observations.filter((item) => item.departmentId === "department-a");
  const medium = analyzeLongitudinalFinops(onlyA).findings[0];
  assert.equal(medium.trend.status, "comparable");
  assert.equal(medium.comparison.status, "non-comparable");
  assert.equal(medium.confidence, "medium");
});

test("leader question: what should we do first?", async () => {
  const result = analyzeLongitudinalFinops(await readJson(fixtureUrl));
  assert.deepEqual(result.findings.map((item) => [
    item.actionPriority, item.departmentId, item.estimatedExcessValue,
  ]), [
    [1, "department-a", 55000],
    [2, "department-b", 0],
    [3, "department-c", 0],
  ]);
});

test("unsupported definitions and insufficient history are explicitly non-comparable", async () => {
  const fixture = await readJson(fixtureUrl);
  const mismatch = structuredClone(fixture);
  mismatch.observations.find((item) =>
    item.departmentId === "department-a" && item.periodId === "2026-05").coverage = "text-only";
  const finding = analyzeLongitudinalFinops(mismatch).findings
    .find((item) => item.departmentId === "department-a");
  assert.equal(finding.trend.status, "non-comparable");
  assert.equal(finding.trend.latestPercentChange, null);
  assert.match(finding.trend.reason, /same metric, currency, and coverage/);

  const short = analyzeLongitudinalFinops(fixture).findings
    .find((item) => item.departmentId === "department-c");
  assert.equal(short.trend.status, "non-comparable");
  assert.equal(short.confidence, "non-comparable");
});

test("ambiguous duplicate observations and broken period chains are refused", async () => {
  const fixture = await readJson(fixtureUrl);
  const duplicate = structuredClone(fixture);
  duplicate.observations.push(structuredClone(duplicate.observations[0]));
  assert.throws(() => analyzeLongitudinalFinops(duplicate), /only one observation per period/);

  const broken = structuredClone(fixture);
  broken.periods[2].previousPeriodId = "2026-04";
  assert.throws(() => analyzeLongitudinalFinops(broken), /consecutive chain/);
});

test("provenance says exactly what source, periods, fields, and handling support the result", async () => {
  const fixture = await readJson(fixtureUrl);
  const result = analyzeLongitudinalFinops(fixture);
  assert.equal(result.provenance.source, fixture.source);
  assert.deepEqual(result.provenance.coveredPeriods.map((item) => item.id),
    ["2026-04", "2026-05", "2026-06"]);
  assert.deepEqual(result.provenance.fields,
    ["departmentId", "periodId", "metric", "currency", "coverage", "value"]);
  assert.match(result.provenance.handling, /browser memory.*session-only.*refresh/i);
  assert.deepEqual(fixture.privacy, {
    directIdentifiersIncluded: false,
    employeeFieldsIncluded: false,
    promptOrResponseContentIncluded: false,
    credentialsIncluded: false,
  });
});

test("browser imports remain session-only and the shipped single-period answer is unchanged", async () => {
  const [page, provider, hris] = await Promise.all([
    readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8"),
    readJson(new URL(
      "../contracts/integrations/provider-usage-billing/v1/fixtures/valid.json", import.meta.url)),
    readJson(new URL("../contracts/integrations/hris-org/v1/fixtures/valid.json", import.meta.url)),
  ]);
  assert.doesNotMatch(page, /localStorage|sessionStorage|indexedDB|fetch\([^)]*local-finops-files/);
  assert.match(page, /const loaded = \{\}/);
  assert.match(page, /input\.value = ""/);
  assert.match(page, /delete loaded\.provider[\s\S]*delete loaded\.hris/);

  const result = normalizeLocalFinops({ provider, hris });
  assert.equal(result.schemaVersion, "local-finops/1.0.0");
  assert.equal(result.spendUsd, 12.34);
  assert.equal(result.recoverableUsd, 2.47);
  assert.match(result.limits.join(" "), /No benchmark.*No trend/s);
});

test("the product consumes the fixture and answers the four executive questions in order", async () => {
  const [html, page] = await Promise.all([
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8"),
  ]);
  assert.match(page, /local-finops-longitudinal-fixture\.json/);
  assert.match(page, /renderLongitudinalFinops/);
  const panel = html.split('id="longitudinal-title"')[1].split("</section>")[0];
  assert.ok(panel.indexOf("change over time") < panel.indexOf("eligible peer comparison"));
  assert.ok(panel.indexOf("eligible peer comparison") < panel.indexOf("confidence"));
  assert.ok(panel.indexOf("confidence") < panel.indexOf("first action"));
  assert.match(panel, /Unsupported comparisons are stated instead of inferred/);
});
