// The bundled demo path, pinned against the correction panel.
//
// The panel that lets a lead correct the classifier is scoped to an imported
// export. This file is the guard on that scoping: it boots the shipped page with
// no file selected at all and holds the demo path's headline number and its one
// prioritized next action to literal strings, so a future change to the
// correction seam that leaks into the bundled dataset fails here rather than
// quietly moving a number a visitor is told is synthetic.
//
// The literals are the point. Everywhere else in this repo an expected figure is
// derived; here it is written down, because what is being defended is that these
// exact bytes do not move.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadPage, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));
const OVERSPEND_FIXTURE = JSON.parse(
  await readFile(new URL("../src/model-overspend-finding-fixture.json", import.meta.url), "utf8"));

async function openFinopsTab() {
  const page = await loadPage(PAGE, {
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
      "/model-overspend-finding-fixture.json": OVERSPEND_FIXTURE,
    },
  });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  return page;
}

test("the bundled demo path shows no correction panel and no way to open one", async () => {
  const { document } = await openFinopsTab();
  assert.equal(document.getElementById("query-review-open").hidden, true,
    "the panel is for a reader's own export; the synthetic example must not offer it");
  assert.equal(document.getElementById("query-review").hidden, true);
  assert.equal(textOf(document.getElementById("query-review-rows")), "",
    "no row may be painted from a dataset the reader did not import");
  assert.equal(textOf(document.getElementById("query-review-provenance")), "",
    "a provenance line about corrections must not appear over synthetic figures");
  assert.equal(tabSequence(document).some((node) => node.id === "query-review-open"), false,
    "a keyboard user on the demo path must not reach a control for a file they have not chosen");
});

test("the bundled demo path's headline number and next action are unchanged", async () => {
  const { document } = await openFinopsTab();
  // Written down rather than derived: this test exists to notice movement.
  assert.equal(textOf(document.getElementById("finops-stand-recoverable-value")),
    "$51,254 · 33% of analyzed spend");
  assert.equal(textOf(document.getElementById("finops-stand-answer")),
    "Illustrative only, from hand-authored synthetic cohort boundaries rather than your own export: "
    + "Your AI spend is in the most expensive quarter of organizations like yours, at $38.63 per "
    + "successful task for June 2026. $51,254 of that is modelled as recoverable. Department "
    + "…atlas0 is driving the increase.");
  assert.equal(textOf(document.getElementById("finops-next-step-action")),
    "Verify “Route short support summaries to the standard model”");
});
