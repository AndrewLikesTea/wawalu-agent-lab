import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { byClass, first, installDocument, tags } from "./support/dom.js";

installDocument();

const { createSavingsActionCenter, demoSavingsClaim, loadSavingsActionCenter } =
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

test("the demo claim leads with the projected-versus-realized question and says it is a demo", () => {
  const claim = demoSavingsClaim(createSavingsActionCenter(inputs));
  assert.equal(claim.source, "demo");
  assert.match(claim.question, /^Did the savings we projected actually show up/);
  assert.match(claim.headline, /^Not measured yet/);
  assert.equal(claim.metric.value, "Not measured");
  assert.match(claim.metric.comparison, /\$7,333 projected a month/);
  assert.equal(claim.nextAction.label, "Request the monthly measurement");
  assert.deepEqual(claim.facts.map((entry) => entry.label),
    ["Accountable department", "Expected effect", "Confidence", "Provenance"]);
  assert.match(claim.facts[3].value, /bundled demonstration fixture/);
  assert.match(claim.notes[0], /Demonstration data/);
  assert.equal(claim.exportable, false, "a demo claim is not the visitor's evidence to export");
});

test("a demo window with nothing reconciled is a stated state, not an empty panel", () => {
  const empty = demoSavingsClaim({ finding: null });
  assert.match(empty.headline, /no monthly claim to show/);
  assert.match(empty.nextAction.label, /Open a saved briefing/);
  const view = renderSavingsActionCenter(empty);
  assert.equal(tags(view, "H2")[0].id, "sac-question");
  assert.equal(byClass(view, "sac-metric").length, 0);
  assert.match(first(view, "sac-details-body").textContent, /no arithmetic to show/);
});

test("the rendered claim leads with one metric, one next action, and disclosed detail", () => {
  const claim = demoSavingsClaim(createSavingsActionCenter(inputs));
  const view = renderSavingsActionCenter(claim);

  // The question labels the whole panel, so a screen reader lands on it first.
  assert.equal(view.getAttribute("aria-labelledby"), "sac-question");
  assert.equal(tags(view, "H2")[0].textContent, claim.question);
  assert.equal(view.dataset.source, "demo");

  // One material metric, once.
  assert.equal(byClass(view, "sac-metric").length, 1);
  assert.equal(first(view, "sac-metric-value").textContent, "Not measured");

  // One prioritized next action, labelled by its own heading.
  const decision = first(view, "sac-decision");
  assert.equal(decision.getAttribute("aria-labelledby"), "sac-decision-title");
  assert.equal(tags(decision, "H3")[0].textContent, "Request the monthly measurement");

  // Department, expected effect, confidence, and provenance are on the surface,
  // not behind the disclosure.
  assert.deepEqual(tags(first(view, "sac-facts"), "DT").map((node) => node.textContent),
    ["Accountable department", "Expected effect", "Confidence", "Provenance"]);

  // The arithmetic is behind one native, keyboard-operable disclosure.
  assert.equal(tags(view, "DETAILS").length, 1);
  assert.equal(tags(view, "SUMMARY")[0].textContent, "How this figure was calculated");
  assert.match(first(view, "sac-caveat").textContent, /simulated for demonstration/);
  assert.match(first(view, "sac-contracts").textContent, /savings-portfolio/);
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

test("the entry point ships labelled controls, a live region, and responsive rules", async () => {
  const [html, css, evolution, page] = await Promise.all([
    readFile(new URL("../src/savings-action-center.html", import.meta.url), "utf8"),
    readFile(new URL("../src/savings-action-center.css", import.meta.url), "utf8"),
    readFile(new URL("../src/evolution.html", import.meta.url), "utf8"),
    readFile(new URL("../src/savings-action-center-page.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<h1 id="page-title">/);
  assert.match(html, /id="savings-action-center" aria-live="polite" aria-busy="true"/);
  assert.match(html, /<script type="module" src="\/savings-action-center-page\.js">/);

  // Every control is named, and the file input's own note is part of its
  // accessible description rather than a paragraph beside it.
  assert.match(html, /<label for="sac-file">/);
  assert.match(html, /id="sac-file" type="file"[^>]*aria-describedby="sac-evidence-note"/);
  assert.match(html, /id="sac-export" type="button" disabled/);
  assert.match(html, /id="sac-clear" type="button" disabled/);
  assert.match(html, /id="sac-evidence-status" role="status" aria-live="polite"/);
  // The controls sit outside the region the page replaces on every read.
  assert.ok(html.indexOf("sac-evidence-controls") < html.indexOf("id=\"savings-action-center\""));

  // Duplicate files must reach the metric contract. Replacing entries by month
  // here would make conflicting copies silently "last file wins" and render the
  // verifier's explicit conflict state unreachable from the actual page.
  assert.doesNotMatch(page, /new Map\(opened\.map/);
  assert.match(page, /opened = \[\.\.\.opened, \.\.\.read\.opened\]/);
  assert.match(page, /new Set\(months\)/);

  assert.match(css, /@media \(max-width:760px\)/);
  assert.match(css, /:focus-visible/);
  assert.match(evolution, /href="\/savings-action-center\.html">Open monthly Savings Action Center/);
});
