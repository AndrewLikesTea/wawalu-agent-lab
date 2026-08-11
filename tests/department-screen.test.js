// The department screen: three states, one live region, and a round trip that
// keeps the selection in both directions.
//
// Every assertion here is driven through the shipped page — its markup, its
// entry module, its view — rather than through the model alone. A model that
// composes a perfect answer nothing paints is not a screen.
//
// The harness models no layout and reflects no properties, so this file asserts
// on properties and attributes rather than on appearance, never compares a
// parsed node to another node, and reads a closed disclosure with `!open`.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, parseHtml, tabSequence, textOf } from "./support/browser.js";
import { importPageModule } from "./support/page-module.js";
import {
  DEPARTMENT_SCREEN_REASON,
  DEPARTMENT_SCREEN_STATE,
  departmentScreenHref,
  departmentScreenModel,
  departmentSlugFrom,
  orgAnswerHref,
} from "../src/department-screen.js";

const PAGE = new URL("../src/departments.html", import.meta.url);
const DATA_URL = "/evolution-demo-data.json";
const dataset = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));

const byId = (document, id) => document.getElementById(id);
const shown = (document, id) => textOf(byId(document, id));
const stateOf = (document) => byId(document, "department-answer").getAttribute("data-state");

/** Open the shipped page with the bundled analysis served, as the origin does. */
async function open(search, { routes = { [DATA_URL]: dataset } } = {}) {
  const page = await loadPage(PAGE, { routes, location: { search } });
  const module = await importPageModule("/department-screen-page.js");
  return { ...page, module };
}

/* ------------------------------- the states ------------------------------- */

test("the markup a reader gets before any script runs already says it is reading", async () => {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  assert.equal(stateOf(document), DEPARTMENT_SCREEN_STATE.pending);
  assert.equal(byId(document, "department-answer").getAttribute("aria-busy"), "true");
  assert.match(shown(document, "department-status"), /Reading the bundled example analysis/);
  assert.ok(byId(document, "department-resolved").hidden, "the answer is drawn before it exists");
  assert.ok(byId(document, "department-unavailable").hidden, "the failure state is drawn on arrival");
});

test("the screen holds the pending state for as long as the analysis is in flight", async () => {
  // The analysis is held open, so the state a reader occupies on a slow network
  // is a state this test can stand in — not a frame that has already gone.
  const page = await loadPage(PAGE, { location: { search: "?department=quality" } });
  let land = null;
  globalThis.fetch = () => new Promise((resolve) => {
    land = () => resolve({ ok: true, json: async () => structuredClone(dataset) });
  });
  try {
    const module = await importPageModule("/department-screen-page.js");
    assert.equal(stateOf(page.document), DEPARTMENT_SCREEN_STATE.pending);
    assert.equal(byId(page.document, "department-answer").getAttribute("aria-busy"), "true");
    assert.match(shown(page.document, "department-status"), /Reading the bundled example analysis/);
    assert.ok(byId(page.document, "department-resolved").hidden, "a figure is on screen before it exists");

    land();
    await module.ready;
    assert.equal(stateOf(page.document), DEPARTMENT_SCREEN_STATE.resolved);
    assert.equal(byId(page.document, "department-answer").getAttribute("aria-busy"), "false");
    assert.equal(shown(page.document, "department-metric-value"), "$4,530");
  } finally {
    page.restore();
  }
});

test("a resolved screen leads with one metric and one next action, everything else folded", async () => {
  const page = await open("?department=quality");
  try {
    await page.module.ready;
    const { document } = page;

    assert.equal(shown(document, "department-metric-label"), "Recoverable AI spend per month");
    assert.equal(shown(document, "department-metric-value"), "$4,530");
    assert.match(shown(document, "department-action-text"), /down-routing/);
    assert.match(shown(document, "department-action-worth"), /^Worth about \$/);
    assert.match(shown(document, "department-subject"), /^QA & Release/);
    assert.ok(!byId(document, "department-resolved").hidden, "the answer stayed hidden");
    assert.ok(byId(document, "department-unavailable").hidden, "a resolved screen also shows a failure");

    // Mix, trajectory, peer position and the training gap are all present and
    // all behind a disclosure that is shut on arrival — the headline is one
    // figure and one move, not five numbers competing for a glance.
    for (const id of ["department-mix", "department-trajectory", "department-peer", "department-training-gap"]) {
      const disclosure = byId(document, id);
      assert.equal(disclosure.tagName, "DETAILS", `${id} is not a disclosure`);
      assert.ok(!disclosure.open, `${id} is open on arrival`);
    }
    assert.match(shown(document, "department-mix-overProvisioned-share"), /% · \$[\d,]+ a month$/);
    assert.match(shown(document, "department-trajectory-text"), /Spend is up 14.7%/);
    assert.match(shown(document, "department-peer-text"), /quartile/);
    assert.match(shown(document, "department-training-gap-text"), /chained re-prompts/);
  } finally {
    page.restore();
  }
});

test("an unknown department names the problem and keeps the way back open", async () => {
  const page = await open("?department=marketing");
  try {
    await page.module.ready;
    const { document } = page;

    assert.equal(stateOf(document), DEPARTMENT_SCREEN_STATE.unavailable);
    assert.equal(shown(document, "department-subject"), "No department called “marketing” is in this analysis");
    assert.match(shown(document, "department-status"), /no figure to state and none is invented/);
    assert.ok(byId(document, "department-resolved").hidden, "an unknown department still paints a figure");
    assert.ok(!byId(document, "department-unavailable").hidden, "the failure state is not on screen");

    // Actionable, not blank: the org answer is a real link, in the tab order,
    // and it still carries the department the reader asked for.
    const back = byId(document, "department-unavailable-org-answer");
    assert.equal(back.getAttribute("href"), "/evolution.html?department=marketing#workspace-answer");
    assert.ok(tabSequence(document).includes(back), "the way back is not keyboard reachable");
  } finally {
    page.restore();
  }
});

test("a link with no department, and an analysis that will not load, each say which one happened", async () => {
  const missing = await open("");
  try {
    await missing.module.ready;
    assert.equal(stateOf(missing.document), DEPARTMENT_SCREEN_STATE.unavailable);
    assert.equal(shown(missing.document, "department-subject"), "No department is named in this link");
    assert.equal(byId(missing.document, "department-unavailable-org-answer").getAttribute("href"),
      "/evolution.html#workspace-answer");
  } finally {
    missing.restore();
  }

  // No route for the analysis: the harness refuses the request the way an
  // offline browser does.
  const broken = await open("?department=sre", { routes: {} });
  try {
    await broken.module.ready;
    assert.equal(stateOf(broken.document), DEPARTMENT_SCREEN_STATE.unavailable);
    assert.equal(shown(broken.document, "department-subject"), "This department’s figures could not be read");
    assert.match(shown(broken.document, "department-status"), /Nothing of yours was uploaded, read, or stored/);
    assert.equal(byId(broken.document, "department-unavailable-org-answer").getAttribute("href"),
      "/evolution.html?department=sre#workspace-answer");
  } finally {
    broken.restore();
  }
});

/* ------------------------------ the round trip ----------------------------- */

test("the department drill-down forwards its selection, and the screen carries it back", async () => {
  // Outbound: the workspace's departments panel links to this screen with a
  // department in the address, so the screen never has to ask which one.
  const evolution = parseHtml(await readFile(new URL("../src/evolution.html", import.meta.url), "utf8"));
  const forward = evolution.getElementById("department-screen-link");
  assert.equal(forward.tagName, "A");
  assert.equal(forward.getAttribute("href"), departmentScreenHref("quality"),
    "the authored link must name the department the drill-down selects by default");
  assert.ok(dataset.departments.some((department) => department.id === "quality"),
    "the authored default names a department the bundled analysis holds");

  // Inbound: the same slug goes back out, on both of this screen's doors.
  const page = await open("?department=frontend");
  try {
    await page.module.ready;
    assert.equal(byId(page.document, "department-org-answer").getAttribute("href"),
      "/evolution.html?department=frontend#workspace-answer");
    assert.equal(shown(page.document, "department-subject"), "Frontend Experience — one figure, one next move");
  } finally {
    page.restore();
  }
});

test("the selection survives every hop of a whole round trip", () => {
  for (const department of dataset.departments) {
    const outbound = departmentScreenHref(department.id);
    const arrived = departmentSlugFrom(outbound.slice(outbound.indexOf("?")));
    assert.equal(arrived, department.id, `${department.id} was lost on the way out`);
    const model = departmentScreenModel({
      departments: dataset.departments, benchmark: dataset.benchmark, slug: arrived,
    });
    assert.equal(model.state, DEPARTMENT_SCREEN_STATE.resolved);
    // The query string sits before the fragment, or the selection becomes part
    // of the fragment and is lost on arrival.
    assert.equal(model.backHref, orgAnswerHref(department.id));
    assert.ok(model.backHref.indexOf("?") < model.backHref.indexOf("#"),
      `${department.id}: the fragment swallowed the selection`);
  }
});

/* --------------------------- structure and access -------------------------- */

test("the screen carries exactly one live region, and it is never folded away", async () => {
  const page = await open("?department=quality");
  try {
    await page.module.ready;
    const main = page.document.getElementById("main-content");
    const announcing = main.querySelectorAll("[aria-live]")
      .concat(main.querySelectorAll('[role="status"]'))
      .filter((node, index, all) => all.indexOf(node) === index);
    assert.equal(announcing.length, 1,
      `the screen announces from ${announcing.length} regions; two live regions race each other`);
    assert.equal(announcing[0].getAttribute("id"), "department-status");

    // A live region inside a shut disclosure is silent in a real browser, and
    // the harness would read straight through it — so the ancestry is checked
    // rather than the text.
    for (let node = announcing[0].parentNode; node; node = node.parentNode) {
      assert.notEqual(node.tagName, "DETAILS", "the live region is folded inside a disclosure");
    }
  } finally {
    page.restore();
  }
});

test("headings are unique, sequential, and reachable", async () => {
  const page = await open("?department=quality");
  try {
    await page.module.ready;
    const { document } = page;
    const headings = ["h1", "h2", "h3", "h4", "h5", "h6"]
      .flatMap((tag) => document.querySelectorAll(tag));
    const texts = headings.map((heading) => textOf(heading));
    assert.equal(new Set(texts).size, texts.length, `a heading is repeated: ${texts.join(" | ")}`);

    // In document order, so a level may only ever step down by one.
    const levels = document.querySelectorAll("h1,h2,h3,h4,h5,h6")
      .map((heading) => Number(heading.tagName.slice(1)));
    assert.equal(levels[0], 1, "the screen does not start at h1");
    assert.equal(levels.filter((level) => level === 1).length, 1, "more than one h1");
    for (let index = 1; index < levels.length; index += 1) {
      assert.ok(levels[index] - levels[index - 1] <= 1,
        `heading level jumps from h${levels[index - 1]} to h${levels[index]}`);
    }

    // Every disclosure heading is inside a summary, which is a tab stop: a
    // reader on a keyboard can reach each one and open what it names.
    const sequence = tabSequence(document);
    for (const id of ["department-mix", "department-trajectory", "department-peer", "department-training-gap"]) {
      const summary = byId(document, id).children.find((child) => child.tagName === "SUMMARY");
      assert.ok(sequence.includes(summary), `${id} cannot be opened from the keyboard`);
      assert.equal(summary.children.filter((child) => child.tagName === "H3").length, 1,
        `${id} does not name itself with a heading`);
    }
  } finally {
    page.restore();
  }
});

test("nothing an address bar carries can become markup or a sentence of its own", () => {
  const model = departmentScreenModel({
    departments: dataset.departments,
    benchmark: dataset.benchmark,
    slug: "<script>alert(1)</script>",
  });
  assert.equal(model.state, DEPARTMENT_SCREEN_STATE.unavailable);
  assert.equal(model.reason, DEPARTMENT_SCREEN_REASON.unknownDepartment);
  assert.doesNotMatch(model.title, /script/, "an unslug-shaped value was quoted back onto the screen");
  assert.doesNotMatch(model.status, /alert/, "an unslug-shaped value was quoted back onto the screen");
});
