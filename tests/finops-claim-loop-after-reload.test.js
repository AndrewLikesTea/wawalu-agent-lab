// The guided loop, on the boot AFTER a lead's declaration was restored (#1495).
//
// #1494's loop answers one question — "what still stands between this figure and
// a claim we could defend?" — by asking the module that owns each step whether
// it is done. #1493 made a declared rate survive a reload. This file is the
// seam between them: the boot where the rates come back out of the browser.
//
// WHY THIS IS ITS OWN FILE. The declared-rate view and the loop view each hold
// their last state in a module value, and the test harness gives a fresh
// instance to the page ENTRY only — a module the entry imports is evaluated
// once per process. So a second boot inside one file inherits the first boot's
// declaration and the defect below is masked. The boot under test here is the
// first boot of this process, which is what a browser reload actually is.
//
// Assertion discipline: counts, attributes and text content only. No assertion
// is handed a parsed node.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { PRICED_DESTINATIONS } from "../src/finops-pricing-provenance.js";
import {
  RETAINED_STATE_KEY, RETAINED_STATE_VERSION,
} from "../src/finops-retained-state.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));

/**
 * Exactly what the shipped form writes when a lead declares contracted rates for
 * every destination this analysis prices — generated from the page's own
 * destination list and stamped at the version this build reads, so the entry is
 * the one a real previous visit left behind rather than a shape invented here.
 */
const RETAINED_ENTRY = JSON.stringify({
  version: RETAINED_STATE_VERSION,
  capturedAt: "2026-08-01T09:15:00.000Z",
  declaredRates: PRICED_DESTINATIONS.flatMap((model) => [
    { model, unit: "usd-per-million-input", rate: 2.5, effectiveDate: "2026-01-01",
      sourceLabel: "MSA 2026 Schedule B" },
    { model, unit: "usd-per-million-output", rate: 10, effectiveDate: "2026-01-01",
      sourceLabel: "MSA 2026 Schedule B" },
  ]),
  scoredCoverage: {
    coverage: 0.9288025889967637,
    departmentIds: ["psn_example_unit_atlas0", "psn_example_unit_boreal",
      "psn_example_unit_cinder", "psn_example_unit_quartz"],
  },
});

async function openFinopsTab(seed = {}) {
  const page = await loadPage(PAGE, {
    storage: { ...seed },
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  await waitFor(() => shownText(document, "integration-contract-provenance")
    .startsWith("Gateway completed"), "the static contract gateway to settle");
  await waitFor(() => byId(document, "finops-evaluation-result")
    .getAttribute("aria-busy") === "false", "the evaluation panel to settle");
  return page;
}

/** The loop's own verdict on one step, read off the list item it painted. */
function stepState(document, id) {
  for (const node of byId(document, "readiness-loop-steps").children) {
    if (node?.dataset?.step === id) return node.dataset.done;
  }
  return null;
}

// ---------------------------------------------------------------------------
// KNOWN DEFECT — left failing on purpose, not patched here (#1495).
//
// USER-VISIBLE IMPACT. A lead declares their contracted rates on Tuesday. The
// headline moves to "Declared" and the browser retains it. On Friday they open
// the tab: the headline is still "Declared", the confidence grade is still the
// one they earned, and the retention line says the rates came back. But the
// guided loop directly under it still counts the pricing step as OPEN and
// prints, as the single prioritized next action, "Declare the contracted input
// and output rates for the destinations still priced at the published list" —
// work they have already done and whose result is on screen two paragraphs
// above. Its before-and-after line quotes the claim as "$62,400 · Illustrative ·
// Confidence: not graded", the served document's placeholders, contradicting the
// figure beside it. Pressing "Recheck this claim" corrects both.
//
// CAUSE, for whoever owns the fix: the page's boot paints the loop from
// `currentRateDeclaration()` at module scope, before `init()` reaches
// `bindDeclaredRateIntake`, which is what hydrates the declaration out of
// storage. Nothing repaints the loop afterwards, so on a restored boot the loop
// is the only surface on the page that never learns the rates came back.
// ---------------------------------------------------------------------------

test("the guided loop counts a restored declaration as done, like the headline does",
  { todo: "the boot paints the loop before the retained declaration is hydrated (#1495)" },
  async () => {
    const page = await openFinopsTab({ [RETAINED_STATE_KEY]: RETAINED_ENTRY });
    try {
      const { document } = page;
      // The restore itself landed: this test is about the loop under the claim,
      // not about whether the claim came back.
      assert.equal(shownText(document, "finops-recoverable-marker"), "Declared",
        "the retained declaration must be restored before the loop's reading of it matters");

      assert.equal(stepState(document, "applicable_pricing"), "true",
        "the loop still calls the pricing step open on a boot that restored the rates");
      assert.equal(shownText(document, "readiness-loop-action").includes("Declare the contracted"),
        false,
        "the loop asks the lead to declare rates the page has just restored for them");
      assert.equal(shownText(document, "readiness-loop-change").includes("Illustrative"), false,
        "the loop quotes the served placeholder claim, not the restored one beside it");
    } finally {
      page.restore();
    }
  });

// ---------------------------------------------------------------------------
// And the guard that says the fix, when it lands, has to be the loop learning
// rather than the reader pressing a button. This one passes today.
// ---------------------------------------------------------------------------

test("pressing Recheck on a restored boot brings the loop back into agreement", async () => {
  const page = await openFinopsTab({ [RETAINED_STATE_KEY]: RETAINED_ENTRY });
  try {
    const { document } = page;
    byId(document, "readiness-loop-recheck").click();

    assert.equal(stepState(document, "applicable_pricing"), "true",
      "a recheck after a restored boot must count the declared rates");
    assert.equal(shownText(document, "readiness-loop-action").includes("Declare the contracted"),
      false, "a recheck must stop asking for rates the browser already holds");
    // The loop and the headline now quote one claim, which is the invariant the
    // todo above is the reload-shaped violation of.
    assert.equal(shownText(document, "readiness-loop-change")
      .includes(shownText(document, "finops-recoverable-grade")), true,
    "the loop's quoted claim must carry the grade the headline is showing");
  } finally {
    page.restore();
  }
});
