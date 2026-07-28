// Reconciling recorded decisions through the shipped import flow.
//
// This is the loop the issue asks for, driven end to end on the real page: a
// visitor opens the month after the one they committed in, the page tells them
// which of their own recorded decisions that month settles, and one explicit
// press keeps the derived comparison on those decisions.
//
// Three things are pinned:
//
//   1. IT IS THE NORMAL IMPORT. The reconciliation appears because a file was
//      opened on the action center's own file input, not because a second
//      module was visited.
//   2. WHAT IS DISPLAYED. Status word, observed against projected, confidence,
//      and concise provenance are all on the row, and the status is carried by a
//      word and a shape before it is carried by a tint.
//   3. WHAT IS KEPT. One bounded derived block per decision, and nothing that
//      came out of the file.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import { DomEvent, loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  RECONCILIATION_METADATA_FIELD, reconciliationErrors,
} from "../src/decision-reconciliation.js";
import { COMMITMENT_METADATA_FIELD } from "../src/finops-commitment-decision.js";
import {
  HALF_TRAFFIC, LIGHT_MIGRATION, OTHER_UNIT, openedMonth, recordedDecision, shippedRelease,
} from "./fixtures/decision-reconciliation/labelled-cases.js";

const PAGE = new URL("../src/savings-action-center.html", import.meta.url);
const DECISION_KEY = "shiplog.decisions.v1";
const RELEASE_KEY = "shiplog.releases.v1";

const fixture = async (name) => JSON.parse(await readFile(new URL(`../src/${name}`, import.meta.url), "utf8"));
const ROUTES = {
  "/savings-portfolio-fixture.json": await fixture("savings-portfolio-fixture.json"),
  "/monthly-savings-reconciliation-fixture.json":
    await fixture("monthly-savings-reconciliation-fixture.json"),
  "/savings-variance-fixtures.json": await fixture("savings-variance-fixtures.json"),
};

const decision = recordedDecision();
const release = shippedRelease(decision);

/** The briefing file a visitor picks, in the shape a file input supplies. */
function briefingFileFor(rows) {
  const entry = openedMonth("2026-07", { rows });
  return { name: entry.name, size: entry.text.length, text: async () => entry.text };
}

async function openPage({ decisions = [decision], releases = [release] } = {}) {
  const page = await loadPage(PAGE, {
    storage: {
      [DECISION_KEY]: JSON.stringify(decisions),
      [RELEASE_KEY]: JSON.stringify(releases),
    },
    routes: ROUTES,
  });
  await importPageModule("/savings-action-center-page.js");
  await waitFor(() => page.document.querySelector(".rec-panel") !== null,
    "the reconciliation panel to render");
  return page;
}

async function chooseBriefing(page, rows) {
  const input = page.document.getElementById("sac-file");
  input.files = [briefingFileFor(rows)];
  input.dispatchEvent(new DomEvent("change", { bubbles: true }));
  await waitFor(() => page.document.querySelector(".rec-row") !== null
    && page.document.querySelector(".rec-row").dataset.status !== "no_comparable_data",
  "the opened month to be reconciled");
}

test("opening the month after the baseline reports the recorded decision as verified", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    // Before any file is opened the panel is honest about having nothing: the
    // commitment is listed, and its state is the absence rather than a zero.
    const before = document.querySelector(".rec-row");
    assert.equal(before.dataset.status, "no_comparable_data");
    assert.match(textOf(before), /No later month has been imported|no comparable/i);
    assert.equal(document.getElementById("sac-reconcile-save").disabled, false);

    await chooseBriefing(page, HALF_TRAFFIC());

    const row = document.querySelector(".rec-row");
    assert.equal(row.dataset.status, "verified");
    // The word, then the shape, then whatever the stylesheet tints.
    assert.equal(textOf(row.querySelector(".rec-status")), "Verified");
    assert.equal(row.dataset.shape, "solid");
    assert.match(row.getAttribute("aria-label"), /^Verified: /);

    const figures = row.querySelectorAll(".rec-fact-label").map((node) => textOf(node));
    assert.deepEqual(figures,
      ["Observed monthly saving", "Projected monthly saving", "Variance"]);
    const values = row.querySelectorAll(".rec-fact-value").map((node) => textOf(node));
    assert.equal(values[0], "$150.00");
    assert.equal(values[1], "$150.00");
    assert.match(values[2], /100% of the projected saving/);

    assert.match(textOf(row.querySelector(".rec-confidence")), /confidence/i);
    assert.match(textOf(row.querySelector(".rec-provenance")),
      /Observed month 2026-07 · baseline 2026-06 · source/);
    // The row links to the decision it is about.
    assert.equal(row.querySelector(".rec-title").getAttribute("href"),
      `/decision.html?id=${decision.id}`);
    // The rubric is on the page, not in a comment: every rule states its own
    // assumption where a director can read it.
    const rules = document.querySelector(".rec-rules");
    assert.equal(rules.querySelectorAll(".rec-rule").length, 5);
    assert.equal(rules.querySelectorAll(".rec-rule-assumption")
      .every((node) => textOf(node).startsWith("Assumption:")), true);
  } finally {
    page.restore();
  }
});

test("a month that misses the plan is reported as underperforming, with the gap", async () => {
  const page = await openPage();
  try {
    await chooseBriefing(page, LIGHT_MIGRATION());
    const row = page.document.querySelector(".rec-row");
    assert.equal(row.dataset.status, "underperforming");
    assert.equal(row.dataset.shape, "double");
    const values = row.querySelectorAll(".rec-fact-value").map((node) => textOf(node));
    assert.equal(values[0], "$60.00");
    assert.equal(values[1], "$150.00");
    assert.match(values[2], /−\$90\.00 · 40% of the projected saving/);
  } finally {
    page.restore();
  }
});

test("a month describing another org unit leaves the commitment unmatched, not scored", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    const input = document.getElementById("sac-file");
    input.files = [briefingFileFor(OTHER_UNIT())];
    input.dispatchEvent(new DomEvent("change", { bubbles: true }));
    await waitFor(() => document.querySelector(".rec-row").dataset.status
      === "unmatched_commitment", "the unmatched state");

    const row = document.querySelector(".rec-row");
    assert.equal(row.dataset.shape, "dotted");
    assert.equal(textOf(row.querySelector(".rec-status")), "Unmatched commitment");
    assert.match(textOf(row.querySelector(".rec-statement")),
      /No imported month carries this decision's commitment identifier/);
    // No figure where there is no comparison. A dash in a money column reads as
    // a zero, and a zero here would be a claim nobody computed.
    assert.equal(row.querySelector(".rec-figures").dataset.available, "false");
    assert.equal(textOf(row.querySelector(".rec-fact-value")), "No comparable figure");
  } finally {
    page.restore();
  }
});

test("saving keeps the derived comparison on the decision, and nothing else", async () => {
  const page = await openPage();
  const { document } = page;
  try {
    await chooseBriefing(page, HALF_TRAFFIC());
    document.getElementById("sac-reconcile-save").click();

    const [stored] = JSON.parse(page.storage.getItem(DECISION_KEY));
    const block = stored[RECONCILIATION_METADATA_FIELD];
    assert.deepEqual(reconciliationErrors(block), []);
    assert.equal(block.status, "verified");
    assert.equal(block.observedMonthlySavingsMinor, 15_000);
    assert.equal(block.varianceMinor, 0);
    assert.equal(block.commitmentId, decision[COMMITMENT_METADATA_FIELD].commitmentId);
    // The commitment the decision was recorded with is untouched: a reconciled
    // outcome never edits the promise it is measured against.
    assert.deepEqual(stored[COMMITMENT_METADATA_FIELD], decision[COMMITMENT_METADATA_FIELD]);
    assert.ok(!JSON.stringify(block).includes(".json"), "a file name reached storage");

    const said = textOf(document.getElementById("sac-reconcile-status"));
    assert.match(said, /Saved to 1 recorded decision/);
    assert.match(said, /no imported rows, and no file names/i);

    // Pressing again changes nothing and says so.
    document.getElementById("sac-reconcile-save").click();
    assert.match(textOf(document.getElementById("sac-reconcile-status")),
      /Nothing changed: 1 recorded decision already carried this reconciliation/);
  } finally {
    page.restore();
  }
});

test("with no recorded commitment decision the panel says so and offers no save", async () => {
  const page = await openPage({ decisions: [], releases: [] });
  const { document } = page;
  try {
    assert.equal(document.querySelectorAll(".rec-row").length, 0);
    assert.match(textOf(document.querySelector(".rec-summary")),
      /No recorded decision carries a FinOps commitment yet/);
    assert.equal(document.getElementById("sac-reconcile-save").disabled, true);
  } finally {
    page.restore();
  }
});
