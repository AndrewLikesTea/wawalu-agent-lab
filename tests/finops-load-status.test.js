// The AI FinOps page's first viewport, and the rule that keeps it readable.
//
// The regression this exists to catch is not a broken function — it is a page
// that grows a second "Loading…". Twenty slots on this page used to narrate the
// same single fetch, so the first thing a visitor read was a wall of progress
// messages with no answer and no next step in it. The rule now is one dominant
// status region and one next action; every other slot states what it does not
// have yet.
//
// So most of what is pinned here is a property of the *shipped markup and the
// booted page*, not of a helper: walk the document, and no slot outside
// #finops-load-state may read as a load in progress. A future panel that ships
// "Loading departments…" fails here, which is the point.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DomEvent, loadPage, parseHtml, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  applyImportPresence, applyMetricFlag, applyPageLoadStatus, bindChooseFiles,
  CHOOSE_FILES_ACTION, competingLoadMessages, IMPORT_PRESENCE, LOAD_PRESENTATION,
  LOAD_STATUS_IDS, METRIC_FLAG, SECONDARY_PLACEHOLDER,
} from "../src/finops-load-status.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const ROUTES = {
  "/evolution-demo-data.json": DEMO_DATA,
  "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
};

async function bootedPage({ routes = ROUTES } = {}) {
  const page = await loadPage(PAGE, { routes });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready"
    || document.getElementById(LOAD_STATUS_IDS.region)?.dataset.state === "error",
  "the page never settled into a resolved load state");
  // The other two things the page starts on its own. Waiting for them is not
  // pedantry: `restore()` pulls the globals out from under any request still in
  // flight, and the rejection surfaces in whichever test happens to run next.
  await waitFor(() => document.getElementById("integration-contract-provenance")
    ?.textContent.trim().startsWith("Gateway completed"), "the static contract gateway to settle");
  await waitFor(() => document.getElementById("finops-evaluation-result")
    ?.getAttribute("aria-busy") === "false", "the evaluation panel to settle");
  return page;
}

const byId = (document, id) => document.getElementById(id);

// --- the shipped markup ----------------------------------------------------

test("only one region in the shipped markup narrates the load", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));

  const competing = competingLoadMessages(document);
  assert.deepEqual(competing, [],
    `these slots narrate a load that #finops-load-state already owns: `
    + competing.map((entry) => `${entry.id || entry.className || entry.tagName} — "${entry.text}"`).join(" | "));
});

test("the dominant region is authored inside the first viewport, above every panel", async () => {
  const html = await readFile(PAGE, "utf8");
  // Before the guided result, the import panel, the KPI row, and the portfolio:
  // a status a reader has to scroll nine screens for is not a status.
  for (const later of ['id="guided-result"', 'id="local-import-title"', 'id="kpi-row"',
    'id="savings-portfolio-panel"', 'class="proof-point"']) {
    assert.ok(html.indexOf('id="finops-load-state"') < html.indexOf(later),
      `#finops-load-state is authored after ${later}`);
  }
  // And after the h1, so the page still leads with what it is.
  assert.ok(html.indexOf('id="page-title"') < html.indexOf('id="finops-load-state"'));
});

test("the available document omits the preparation panel from the reading order", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  const region = byId(document, LOAD_STATUS_IDS.region);

  assert.equal(region.getAttribute("role"), "status");
  assert.equal(region.getAttribute("aria-labelledby"), LOAD_STATUS_IDS.label);
  assert.equal(region.hidden, true);
  assert.equal(region.dataset.state, "ready");
  assert.match(textOf(byId(document, LOAD_STATUS_IDS.label)), /Page status/);
  // If script reveals this region for a transition, its authored fallback is
  // still a word and shape rather than a colour-only state.
  assert.equal(textOf(byId(document, LOAD_STATUS_IDS.shape)), LOAD_PRESENTATION.ready.shape);
  assert.equal(byId(document, LOAD_STATUS_IDS.shape).getAttribute("aria-hidden"), "true");
  assert.equal(textOf(byId(document, LOAD_STATUS_IDS.word)), LOAD_PRESENTATION.ready.word);
  assert.doesNotMatch(textOf(region), /prepar|unavailable|waiting/i);
});

test("the score card and every KPI ship a shape-and-word flag, not a bare dash", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  for (const id of ["score-flag", "kpi-spend-flag", "kpi-recoverable-flag",
    "kpi-productive-flag", "kpi-peer-flag"]) {
    const flag = byId(document, id);
    assert.ok(flag, `${id} is missing`);
    assert.equal(flag.hidden, true, `${id} claims a state before anything was measured`);
    assert.match(textOf(flag), /^○ unmeasured$/);
  }
});

// --- the booted page -------------------------------------------------------

test("a cold load says nothing of yours is imported, and offers one action", async () => {
  const page = await bootedPage();
  try {
    const { document } = page;
    const region = byId(document, LOAD_STATUS_IDS.region);

    assert.equal(region.dataset.state, "ready");
    assert.equal(region.hidden, true, "a ready status must not compete with the available result");
    assert.equal(region.dataset.import, "example");
    // Answer first: whose numbers these are. Evidence second: what that costs
    // and what changes it.
    assert.equal(textOf(byId(document, LOAD_STATUS_IDS.title)), IMPORT_PRESENCE.example.title);
    assert.match(textOf(byId(document, LOAD_STATUS_IDS.copy)), /Bundled synthetic example/);
    assert.match(textOf(byId(document, LOAD_STATUS_IDS.copy)), /no upload/i);
    assert.equal(textOf(byId(document, LOAD_STATUS_IDS.word)), LOAD_PRESENTATION.ready.word);
    assert.equal(textOf(byId(document, LOAD_STATUS_IDS.shape)), LOAD_PRESENTATION.ready.shape);

    // One action, available now; the retry belongs to the failure state only.
    const choose = byId(document, LOAD_STATUS_IDS.choose);
    assert.equal(choose.hidden, false);
    assert.equal(textOf(choose), CHOOSE_FILES_ACTION.label);
    assert.equal(byId(document, LOAD_STATUS_IDS.retry).hidden, true);
  } finally {
    page.restore();
  }
});

test("the booted page still narrates the load in exactly one place", async () => {
  const page = await bootedPage();
  try {
    const competing = competingLoadMessages(page.document);
    assert.deepEqual(competing, [],
      competing.map((entry) => `${entry.id || entry.tagName} — "${entry.text}"`).join(" | "));
  } finally {
    page.restore();
  }
});

test("the loading replacement offers Choose files and lands the reader on the picker", async () => {
  const page = await loadPage(PAGE, { routes: ROUTES });
  try {
    const { document } = page;
    bindChooseFiles(document);
    applyPageLoadStatus(document, {
      state: "loading",
      title: "Preparing the Bundled synthetic example…",
      detail: "Invented example data is being prepared.",
    });
    const choose = byId(document, LOAD_STATUS_IDS.choose);
    assert.ok(tabSequence(document).includes(choose),
      "the page's one next action is not keyboard reachable");
    assert.equal(byId(document, "finops-stand").hidden, true);
    assert.equal(byId(document, "finops-first-run").hidden, true);

    choose.dispatchEvent(new DomEvent("click"));
    assert.equal(document.activeElement, byId(document, CHOOSE_FILES_ACTION.targetId),
      "pressing the action left the reader somewhere other than the file input");
  } finally {
    page.restore();
  }
});

test("a failed bundled load keeps the action and adds the retry", async () => {
  const page = await bootedPage({ routes: { "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES } });
  try {
    const { document } = page;
    const region = byId(document, LOAD_STATUS_IDS.region);

    assert.equal(region.dataset.state, "error");
    assert.equal(textOf(byId(document, LOAD_STATUS_IDS.word)), LOAD_PRESENTATION.error.word);
    assert.equal(textOf(byId(document, LOAD_STATUS_IDS.shape)), LOAD_PRESENTATION.error.shape);
    assert.equal(byId(document, LOAD_STATUS_IDS.retry).hidden, false);
    assert.equal(region.hidden, false);
    assert.equal(byId(document, "finops-stand").hidden, true,
      "failed preparation left headline figures and briefing controls visible");
    assert.equal(byId(document, "finops-first-run").hidden, true,
      "failed preparation left recoverable spend, confidence, or recommendation visible");
    // Still offered: a reader whose example failed can analyze their own file,
    // and that is the better of the two next steps.
    assert.equal(byId(document, LOAD_STATUS_IDS.choose).hidden, false);

    // Every unfillable metric says so in a word and a shape, not in a tint.
    for (const id of ["score-flag", "kpi-spend-flag", "kpi-recoverable-flag",
      "kpi-productive-flag", "kpi-peer-flag"]) {
      assert.equal(byId(document, id).hidden, false, `${id} stayed silent about a metric that never loaded`);
      assert.equal(textOf(byId(document, id)), `${METRIC_FLAG.notLoaded.shape} ${METRIC_FLAG.notLoaded.word}`);
    }
  } finally {
    page.restore();
  }
});

test("retry reruns a failed bundled analysis and restores the synthetic completed state", async () => {
  // Keep the routes object mutable: the first request cannot find the bundled
  // analysis, then the retry sees the fixture become available. This exercises
  // the shipped click handler rather than repainting the status helper by hand.
  const routes = { "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES };
  const page = await bootedPage({ routes });
  try {
    const { document } = page;
    const region = byId(document, LOAD_STATUS_IDS.region);
    const retry = byId(document, LOAD_STATUS_IDS.retry);

    assert.equal(region.dataset.state, "error");
    assert.equal(region.getAttribute("aria-busy"), "false");
    assert.equal(retry.hidden, false);

    routes["/evolution-demo-data.json"] = DEMO_DATA;
    retry.click();
    assert.equal(region.dataset.state, "loading");
    assert.equal(region.getAttribute("aria-busy"), "true");
    assert.equal(retry.hidden, true, "a running retry is not offered a second time");

    await waitFor(() => region.dataset.state === "ready", "the retry to complete");
    assert.equal(region.getAttribute("aria-busy"), "false");
    assert.equal(region.hidden, true);
    assert.equal(byId(document, "finops-stand").hidden, false);
    assert.equal(byId(document, "finops-first-run").hidden, false);
    assert.equal(region.dataset.import, "example");
    assert.match(textOf(byId(document, LOAD_STATUS_IDS.copy)), /Bundled synthetic example/);
    assert.match(textOf(byId(document, LOAD_STATUS_IDS.copy)), /invented data, not your spend/);
    assert.match(textOf(byId(document, "kpi-recoverable-value")), /\$/,
      "the completed analysis does not publish its recoverable figure");
    assert.ok(textOf(byId(document, "department-priority")).length > 20,
      "the completed analysis does not publish a recommended department action");
  } finally {
    page.restore();
  }
});

// --- the module in isolation ----------------------------------------------

test("import presence is a no-op while the load owns the region", () => {
  const document = parseHtml('<body><section id="finops-load-state" data-state="loading">'
    + '<span id="finops-load-shape"></span><span id="finops-load-word"></span>'
    + '<strong id="finops-load-title">Reading…</strong><span id="finops-load-copy">wait</span>'
    + "</section></body>");

  assert.equal(applyImportPresence(document, true), null);
  assert.equal(textOf(document.getElementById(LOAD_STATUS_IDS.title)), "Reading…");

  applyPageLoadStatus(document, { state: "ready" });
  applyImportPresence(document, true);
  assert.equal(textOf(document.getElementById(LOAD_STATUS_IDS.title)), IMPORT_PRESENCE.imported.title);
  assert.match(textOf(document.getElementById(LOAD_STATUS_IDS.copy)), /Nothing was uploaded or stored/);
});

test("clearing a metric flag restores the neutral wording rather than hiding a verdict", () => {
  const document = parseHtml('<body><p class="kpi-flag" id="kpi-spend-flag" hidden></p></body>');

  applyMetricFlag(document, "kpi-spend-flag", "needsReview");
  const flag = document.getElementById("kpi-spend-flag");
  assert.equal(flag.hidden, false);
  assert.equal(textOf(flag), `${METRIC_FLAG.needsReview.shape} ${METRIC_FLAG.needsReview.word}`);
  assert.equal(flag.querySelector(".kpi-flag-shape").getAttribute("aria-hidden"), "true");

  applyMetricFlag(document, "kpi-spend-flag", null);
  assert.equal(flag.hidden, true);
  assert.equal(textOf(flag), `${METRIC_FLAG.unmeasured.shape} ${METRIC_FLAG.unmeasured.word}`,
    "a hidden flag kept last render's verdict for a later surface to reveal");
});

test("every placeholder states an absence rather than a wait", () => {
  for (const [key, copy] of Object.entries(SECONDARY_PLACEHOLDER)) {
    assert.ok(copy.trim().length, `${key} is an empty slot`);
    assert.doesNotMatch(copy, /\b(loading|counting|computing|connecting)\b/i,
      `${key} narrates a load that only #finops-load-state may narrate`);
    assert.notEqual(copy.trim(), "Unavailable", `${key} falls back to a bare "Unavailable"`);
    assert.doesNotMatch(copy, /\bpending\b/i,
      `${key} uses a status term that can imply an error or queued work`);
  }
});

test("binding the action survives a missing picker without throwing", () => {
  const document = parseHtml('<body><button id="finops-choose-files" type="button">Choose files</button></body>');
  const button = bindChooseFiles(document, { targetId: "nothing-here" });
  assert.equal(button.dataset.target, "nothing-here");
  button.dispatchEvent(new DomEvent("click"));
  assert.equal(document.activeElement, null);
});
