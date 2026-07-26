import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { byClass, installDocument, tags } from "./support/dom.js";

installDocument();

const { createSavingsActionCenter, loadSavingsActionCenter } =
  await import("../src/savings-action-center.js");
const { renderSavingsActionCenter, renderSavingsActionCenterError } =
  await import("../src/savings-action-center-view.js");

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`../src/${name}`, import.meta.url), "utf8"));
}

const inputs = {
  portfolioFixture: await fixture("savings-portfolio-fixture.json"),
  reconciliationFixture: await fixture("monthly-savings-reconciliation-fixture.json"),
  adjudicationFixture: await fixture("savings-variance-fixtures.json"),
};

test("latest monthly review prioritizes a pending active measurement", () => {
  const center = createSavingsActionCenter(inputs);
  assert.equal(center.month, "2026-07");
  assert.equal(center.finding.action.actionId, "syn-quality-retry");
  assert.equal(center.finding.record.availabilityReason, "measurement-pending");
  assert.equal(center.finding.decision.label, "Request the monthly measurement");
  assert.equal(center.finding.adjudication.status, "unavailable_measurement");
  assert.equal(center.finding.adjudicationReference.fixtureId, "unavailable-measurement");
});

test("negative measured variance follows missing measurement in priority", () => {
  const changed = structuredClone(inputs);
  const pending = changed.reconciliationFixture.records.find(
    (record) => record.actionId === "syn-quality-retry"
      && record.measurementMonth === "2026-07",
  );
  pending.availabilityState = "available";
  pending.availabilityReason = null;
  pending.simulatedRealizedSavingsUsd = 7333;
  pending.varianceReason = "matched-projection";
  pending.evidenceProvenance.evidenceRefs = ["syn-recon-quality-2026-07"];
  const center = createSavingsActionCenter(changed);
  assert.equal(center.finding.action.actionId, "syn-finops-routing");
  assert.equal(center.finding.record.varianceUsd, -250);
});

test("rendered workflow leads with decision metrics and progressively discloses context", () => {
  const view = renderSavingsActionCenter(createSavingsActionCenter(inputs));
  assert.equal(tags(view, "H2")[0].textContent, "Reduce repeated unverified test retries");
  assert.deepEqual(tags(byClass(view, "sac-metrics")[0], "DT").map((node) => node.textContent),
    ["Monthly projection", "Simulated realized", "Measured variance", "Confidence"]);
  assert.match(byClass(view, "sac-metrics")[0].textContent,
    /\$7,333.*Not measured.*Not available.*78% · unavailable/);
  assert.equal(tags(view, "DETAILS").length, 1);
  assert.match(tags(view, "SUMMARY")[0].textContent, /monthly evidence and lifecycle context/i);
  assert.equal(tags(view, "A")[0].getAttribute("href"), "/evolution.html#portfolio-title");
  assert.equal(tags(byClass(view, "sac-timeline")[0], "LI").at(-1)
    .getAttribute("aria-current"), "step");
});

test("loading validates all three bundled sources and failures remain explicit", async () => {
  const files = [
    inputs.portfolioFixture, inputs.reconciliationFixture, inputs.adjudicationFixture,
  ];
  let index = 0;
  const loaded = await loadSavingsActionCenter(async () => ({
    ok: true, async json() { return files[index++]; },
  }));
  assert.equal(loaded.finding.action.actionId, "syn-quality-retry");

  await assert.rejects(
    loadSavingsActionCenter(async () => ({ ok: false, status: 503 })),
    /could not be loaded/,
  );
  assert.equal(renderSavingsActionCenterError().getAttribute("role"), "alert");
});

test("dedicated entry point ships semantic status, native disclosure, and responsive rules", async () => {
  const [html, css, evolution] = await Promise.all([
    readFile(new URL("../src/savings-action-center.html", import.meta.url), "utf8"),
    readFile(new URL("../src/savings-action-center.css", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<h1 id="page-title">/);
  assert.match(html, /id="savings-action-center" aria-live="polite" aria-busy="true"/);
  assert.match(html, /<script type="module" src="\/savings-action-center-page\.js">/);
  assert.match(css, /@media \(max-width:760px\)/);
  assert.match(css, /:focus-visible/);
  assert.match(evolution, /href="\/savings-action-center\.html">Open monthly Savings Action Center/);
});
