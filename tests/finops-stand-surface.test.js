// The headline, on the surface a FinOps lead actually reads.
//
// This drives the shipped AI FinOps tab — the real markup from
// src/evolution.html, booted by the real page entry — with storage cleared and
// no import, which is the state a lead lands in. The model contract lives in
// tests/finops-stand.test.js; what only this file can catch is the boundary:
// a headline that composes correctly and paints into slots that are not there,
// a disclosure nested one level too deep to reach in one interaction, and a
// control that is operable with a mouse and not with a keyboard.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  DomEvent, loadPage, parseHtml, pressEnter, tabSequence, textOf,
} from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  STAND_DISCLOSURE_ORDER, STAND_IDS, STAND_QUESTION, STAND_RESOLUTION_ACTION,
  composeStandHeadline, standHeadlineForImport,
} from "../src/finops-stand.js";
import { applyStandHeadline, standDisclosureIds } from "../src/finops-stand-view.js";
import { loadExampleDataset } from "../src/example-dataset.js";
import { resolveCostPosition } from "../src/peer-cost-position.js";
import { validateCohortAttribution } from "../src/cohort-attribution.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const DEMO_DATA = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(await readFile(
  new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));

/** The page as a first-time lead meets it: no stored state, no import. */
async function openWithClearedStorage() {
  const page = await loadPage(PAGE, {
    storage: {},
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  return page;
}

// ---------------------------------------------------------------------------
// 1. First load, storage cleared, nothing imported.
// ---------------------------------------------------------------------------

test("the complete headline renders on first load with no import and no stored state", async () => {
  const { document, storage } = await openWithClearedStorage();
  assert.deepEqual(Object.keys(storage?.local ?? {}), [],
    "this assertion is only meaningful with local storage genuinely empty");

  const region = byId(document, STAND_IDS.region);
  assert.equal(region.dataset.state, "ready");
  assert.equal(region.dataset.position, "placed");
  assert.equal(region.dataset.source, "example");

  // The question, and the four things that make it answerable.
  assert.equal(shownText(document, STAND_IDS.question), STAND_QUESTION);
  assert.match(shownText(document, STAND_IDS.positionValue),
    /Bottom quartile · \$38\.63 per successful task/);
  assert.match(shownText(document, STAND_IDS.positionBasis),
    /quartile boundaries \$18\.40 and \$31\.50 per successful task/);
  assert.match(shownText(document, STAND_IDS.recoverableValue),
    /\$51,254 · 33% of analyzed spend/);
  assert.equal(shownText(document, STAND_IDS.teamName), "Department …atlas0");
  assert.equal(byId(document, STAND_IDS.action).hidden, false);
  assert.equal(shownText(document, STAND_IDS.action), "Open the recommendation evidence");
  assert.equal(byId(document, STAND_IDS.action).getAttribute("href"), "#recommendation-evidence");

  // Nothing is placed yet is a lie here, so the withheld path must be shut.
  assert.equal(byId(document, STAND_IDS.withheld).hidden, true);
});

test("the headline is the highest-ranked heading in its region, and it is first on the view", () => {
  const document = parseHtml(html);
  const region = byId(document, STAND_IDS.region);
  const headings = region.querySelectorAll("h1,h2,h3,h4,h5,h6");
  assert.equal(headings[0].id, STAND_IDS.question, "the headline is not the first heading");
  assert.equal(headings[0].tagName.toLowerCase(), "h2");
  // One h2 in the region and no h1: everything else is subordinate to it.
  assert.equal(headings.filter((node) => node.tagName.toLowerCase() === "h2").length, 1);
  assert.equal(headings.filter((node) => node.tagName.toLowerCase() === "h1").length, 0);
  // And the region itself is named by that heading.
  assert.equal(region.getAttribute("aria-labelledby"), STAND_IDS.question);

  // First in reading order among the decision-bearing regions of this view: the
  // brief that used to lead comes after it, and is marked subordinate.
  const sections = document.querySelectorAll("section");
  const order = sections.map((node) => node.id);
  assert.ok(order.indexOf(STAND_IDS.region) < order.indexOf("finops-first-run"),
    "the headline must precede the region it summarises");
  assert.equal(byId(document, "finops-first-run").dataset.subordinate, "true");
});

// ---------------------------------------------------------------------------
// 2. Progressive disclosure: one step, every time.
// ---------------------------------------------------------------------------

test("every disclosure is one interaction from the headline, with no nesting", () => {
  const document = parseHtml(html);
  const region = byId(document, STAND_IDS.region);
  for (const key of STAND_DISCLOSURE_ORDER) {
    const ids = standDisclosureIds(key);
    const details = byId(document, ids.details);
    assert.ok(details, `${key} has no disclosure in the shipped markup`);
    assert.equal(details.tagName.toLowerCase(), "details");
    // A details inside a details is two interactions, which is the one thing
    // "reachable in one step" forbids.
    assert.equal(details.parentNode.closest("details"), null,
      `${key} is nested inside another disclosure`);
    assert.equal(details.closest(`#${STAND_IDS.region}`), region,
      `${key} is not in the headline region at all`);
    const summary = byId(document, ids.summary);
    assert.equal(summary.tagName.toLowerCase(), "summary");
    assert.equal(summary.parentNode.id, ids.details);
  }
  // All six are siblings of one another in one flat container.
  const container = byId(document, STAND_IDS.disclosures);
  assert.equal(container.querySelectorAll("details").length, STAND_DISCLOSURE_ORDER.length);
});

test("each disclosure is filled from the composed headline and reports its own count", async () => {
  const { document } = await openWithClearedStorage();
  for (const key of STAND_DISCLOSURE_ORDER) {
    const ids = standDisclosureIds(key);
    const terms = byId(document, ids.list).querySelectorAll("dt");
    assert.ok(terms.length > 0, `${key} painted no entries`);
    // The visible state chip says how much is behind the control, so a reader
    // decides whether to open it before they open it.
    assert.match(shownText(document, ids.state), new RegExp(`Show · ${terms.length}$`));
  }
});

// ---------------------------------------------------------------------------
// 3. Keyboard operability and state exposure.
// ---------------------------------------------------------------------------

test("the disclosures are native summaries, keyboard-operable with no script and no tab-stop override", () => {
  const document = parseHtml(html);
  for (const key of STAND_DISCLOSURE_ORDER) {
    const summary = byId(document, standDisclosureIds(key).summary);
    // A native summary is focusable, activates on Enter and Space, and toggles
    // its own details — none of which this page re-implements. What it must not
    // do is carry an override that takes any of that away.
    assert.equal(summary.getAttribute("tabindex"), null, `${key} overrides its tab stop`);
    assert.equal(summary.getAttribute("aria-hidden"), null, `${key} is hidden from AT`);
    assert.equal(summary.getAttribute("role"), null, `${key} overrides its native role`);
    // The collapsed state is exposed before any script runs.
    assert.equal(summary.getAttribute("aria-expanded"), "false");
  }
  // And a visible focus indicator for them, held to the stylesheet rather than
  // to a reviewer's eye.
  assert.match(html, /class="stand-disclosure"/);
});

test("a visible focus indicator is published for every control this region adds", async () => {
  const css = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
  for (const selector of [
    ".stand-disclosure>summary:focus-visible", ".stand-action:focus-visible",
    ".stand-withheld-action:focus-visible",
  ]) {
    const rule = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[^}]*outline:`);
    assert.match(css, rule, `${selector} has no outline rule`);
  }
});

test("opening a disclosure moves every state channel, not just the chevron", async () => {
  const { document } = await openWithClearedStorage();
  const ids = standDisclosureIds("cohort");
  const details = byId(document, ids.details);
  const summary = byId(document, ids.summary);
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  assert.equal(details.dataset.disclosure, "collapsed");
  assert.match(shownText(document, ids.state), /^▸ Show/);

  // What the browser does when Enter, Space, or a click reaches the summary.
  details.open = true;
  details.dispatchEvent(new DomEvent("toggle", { bubbles: false }));

  assert.equal(summary.getAttribute("aria-expanded"), "true",
    "the expanded state is not exposed to assistive technology");
  assert.equal(details.dataset.disclosure, "expanded");
  // The word, not only the shape: a chevron that rotates is a state a reader
  // cannot hear, cannot print, and cannot see in greyscale.
  assert.match(shownText(document, ids.state), /^▾ Hide/);
});

test("the prioritized action is tab-reachable and activates from the keyboard", async () => {
  const { document } = await openWithClearedStorage();
  const action = byId(document, STAND_IDS.action);
  assert.ok(tabSequence(document).includes(action),
    "the one prioritized action is not in the tab order");
  action.focus();
  assert.equal(document.activeElement, action);
  let followed = null;
  action.addEventListener("click", () => { followed = action.getAttribute("href"); });
  pressEnter(document);
  assert.equal(followed, "#recommendation-evidence");
  // And the destination it names is a real region on this page.
  assert.ok(byId(document, "recommendation-evidence"), "the action points at nothing");
});

// ---------------------------------------------------------------------------
// 4. The withheld path, on both sources.
// ---------------------------------------------------------------------------

test("a withheld bundled position renders an action, not a dead label", () => {
  const document = parseHtml(html);
  const analysis = loadExampleDataset();
  applyStandHeadline(document, composeStandHeadline({
    analysis, source: "example",
    position: resolveCostPosition({ org: {}, spendUsd: analysis.spendUsd, tasks: [] }),
  }));

  const region = byId(document, STAND_IDS.region);
  assert.equal(region.dataset.position, "withheld");
  assert.equal(byId(document, STAND_IDS.withheld).hidden, false);
  assert.match(shownText(document, STAND_IDS.withheldMissing),
    /has not declared its size band and industry/);
  assert.match(shownText(document, STAND_IDS.withheldNext),
    /Declare your organization's size band and industry/);
  // A control, not a sentence about a control.
  const resolve = byId(document, STAND_IDS.withheldAction);
  assert.equal(resolve.tagName.toLowerCase(), "button");
  assert.equal(resolve.getAttribute("type"), "button");
  assert.equal(resolve.getAttribute("aria-describedby"), STAND_IDS.withheldNext);
  assert.ok(!/\bUnavailable\b/.test(textOf(region)),
    "the withheld headline fell back to a dead label");
});

test("a withheld imported position carries the import contract's own reason and step", () => {
  const document = parseHtml(html);
  const eligibility = validateCohortAttribution({
    rows: [{ department_key: "atlas-platform", cost: "10" }],
  });
  applyStandHeadline(document,
    standHeadlineForImport({ analysis: loadExampleDataset(), eligibility }));

  assert.equal(byId(document, STAND_IDS.region).dataset.source, "import");
  assert.equal(byId(document, STAND_IDS.region).dataset.position, "withheld");
  assert.equal(shownText(document, STAND_IDS.withheldMissing), eligibility.reasonText);
  assert.equal(shownText(document, STAND_IDS.withheldNext), eligibility.nextStep);
  assert.ok(!/\bUnavailable\b/.test(textOf(byId(document, STAND_IDS.region))));
});

test("the resolving control is tab-reachable and delegates to the page's one file picker", async () => {
  const { document } = await openWithClearedStorage();
  const analysis = loadExampleDataset();
  applyStandHeadline(document, composeStandHeadline({
    analysis, source: "example",
    position: resolveCostPosition({ org: {}, spendUsd: analysis.spendUsd, tasks: [] }),
  }));

  const resolve = byId(document, STAND_IDS.withheldAction);
  assert.ok(tabSequence(document).includes(resolve),
    "the way out of the withheld state is not in the tab order");
  assert.equal(resolve.dataset.target, STAND_RESOLUTION_ACTION.targetId);

  // No second picker: it focuses and presses the one this page already ships.
  const picker = byId(document, STAND_RESOLUTION_ACTION.targetId);
  let opened = 0;
  picker.addEventListener("click", () => { opened += 1; });
  resolve.focus();
  pressEnter(document);
  assert.equal(opened, 1);
  assert.equal(document.activeElement, picker,
    "focus was left on a button that did nothing the reader can see");
});

// ---------------------------------------------------------------------------
// 5. The figures are text, and the hierarchy is not carried by position alone.
// ---------------------------------------------------------------------------

test("the named team and every figure are readable as text", async () => {
  const { document } = await openWithClearedStorage();
  // Each of these is a value a reader can select, copy, hear, and print — not a
  // colour, a bar, or "the first row of a grid".
  for (const id of [STAND_IDS.positionValue, STAND_IDS.positionBasis,
    STAND_IDS.recoverableValue, STAND_IDS.recoverableBasis, STAND_IDS.teamName,
    STAND_IDS.teamDetail, STAND_IDS.answer]) {
    assert.ok(shownText(document, id).length > 0, `#${id} is empty`);
  }
  // The availability of a figure is stated in the value, never only in an
  // attribute the eye cannot read.
  assert.equal(byId(document, STAND_IDS.positionValue).dataset.available, "true");
  assert.equal(byId(document, STAND_IDS.team).dataset.available, "true");
  // One live announcement, and it is the answer rather than the machinery. The
  // answer is the resolved finding's claim, so this is pinned to the slot that
  // prints it rather than to a sentence one signal happened to produce.
  assert.ok(shownText(document, STAND_IDS.live).includes(shownText(document, STAND_IDS.answer)),
    "the live region must announce the headline answer, not the machinery");
});
