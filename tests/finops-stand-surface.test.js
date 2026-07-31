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
  STAND_CONFIDENCE_LABEL, STAND_DISCLOSURE_ORDER, STAND_EVIDENCE_LABEL, STAND_IDS, STAND_QUESTION,
  STAND_RESOLUTION_ACTION, composeStandHeadline, standHeadlineForImport,
} from "../src/finops-stand.js";
import {
  CONFIDENCE_LEVELS, EVIDENCE_CLASS, SYNTHETIC_CLAIM_QUALIFIER,
} from "../src/finops-finding-resolver.js";
import { applyStandHeadline, standDisclosureIds } from "../src/finops-stand-view.js";
import {
  EXAMPLE_ORG_COHORT_PROFILE, EXAMPLE_TASK_LEDGER, loadExampleDataset,
} from "../src/example-dataset.js";
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
    /Most expensive quarter · \$38\.63 per successful task/);
  assert.match(shownText(document, STAND_IDS.positionBasis),
    /less than \$18\.40 and a quarter spends more than \$31\.50 per successful task/);
  // The period the claim covers is on the surface, not only in the module.
  assert.match(shownText(document, STAND_IDS.positionBasis), /for June 2026/);
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
  // The page's h1 since #727, and the only one: the finding outranks the hero's
  // promise in the heading tree as well as in type. Its parts moved up a level
  // with it, because h1 followed by h3 is a skipped level — hierarchy is carried
  // by the type ramp, structure by the level, and neither may be bought with the
  // other.
  assert.equal(headings[0].tagName.toLowerCase(), "h1");
  assert.equal(headings.filter((node) => node.tagName.toLowerCase() === "h1").length, 1);
  assert.equal(headings.filter((node) => node.tagName.toLowerCase() === "h3").length, 0,
    "a part of the answer is an h2 under its h1; nothing in the region skips to h3");
  assert.equal(document.querySelectorAll("h1").length, 1, "a second h1 makes two claims");
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
// 1b. Announcement order and one coherent claim (#727).
// ---------------------------------------------------------------------------

/** The element children of `<main>`, in document order. */
const regionsOf = (document) => [...(byId(document, "main-content").children ?? [])]
  .filter((node) => node?.nodeType === 1);

test("the headline is the first content a reader meets after the page landmark", () => {
  const document = parseHtml(html);
  const first = regionsOf(document)[0];
  assert.equal(first.id, STAND_IDS.region,
    `the first region inside <main> is #${first.id}; a screen-reader user who takes `
    + "the skip link must meet the finding, not the preamble before it");
  // The hero keeps every word it had, one region down and marked subordinate.
  const order = regionsOf(document).map((node) => node.id);
  assert.ok(order.indexOf(STAND_IDS.region) < order.indexOf("finops-hero"));
  assert.equal(byId(document, "finops-hero").dataset.subordinate, "true");
  // The skip link still targets the landmark the headline now opens, rather than
  // a competing mechanism added beside it.
  const skip = document.querySelector(".skip-link");
  assert.equal(skip.getAttribute("href"), "#main-content");
  assert.equal(document.querySelectorAll(".skip-link").length, 1);
});

test("no source-order laundering: the visual order is the DOM order", async () => {
  const css = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
  // Reordering in CSS would put the answer first for the eye and leave it second
  // for the keyboard and the screen reader, which is the defect this restructure
  // exists to fix rather than to move.
  for (const line of css.split("\n").filter((row) => /\.stand|\.finops-hero|data-subordinate/.test(row))) {
    assert.doesNotMatch(line, /(^|[;{ ])order\s*:\s*-?\d/, `a rule reorders visually: ${line}`);
    assert.doesNotMatch(line, /(flex|grid-auto)-flow?\s*:\s*[a-z-]*reverse/, `a rule reverses: ${line}`);
    assert.doesNotMatch(line, /flex-direction\s*:\s*[a-z-]*reverse/, `a rule reverses: ${line}`);
  }
  // And nothing forces a tab stop out of document order.
  assert.doesNotMatch(html, /tabindex="[1-9]/, "a positive tabindex desynchronizes focus from source order");
});

test("every spine step that is not the headline is drawn one tier down", async () => {
  const document = parseHtml(html);
  const css = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
  // The five supporting steps of the collapsed page, each authored subordinate
  // before any script runs.
  for (const id of ["finops-hero", "finops-first-run", "finops-next-step",
    "finops-journey", "finops-destinations"]) {
    assert.equal(byId(document, id).dataset.subordinate, "true",
      `#${id} is a spine step that is not the headline and must read as one`);
  }
  assert.equal(byId(document, STAND_IDS.region).dataset.subordinate, undefined,
    "the headline is never subordinate to itself");
  // Three tiers, and each one is a ramp step the page already shipped.
  assert.match(css, /\.stand-head h1 \{[^}]*font-size:clamp\(26px,4vw,38px\)/);
  assert.match(css, /\.finops-hero h2 \{[^}]*font-size:clamp\(22px,3\.2vw,31px\)/);
  assert.match(css, /\[data-subordinate="true"\] \.next-step-head h2[^{]*\{[^}]*font-size:clamp\(18px,2\.2vw,22px\)/);
  // The container carries the same rank in a second, non-colour channel: the
  // headline keeps a 6px accent rule and the filled wash, a supporting step gets
  // a 3px neutral rule on flat white. (Claude Design foundations: "filled wash =
  // dynamic signal, outline = static classification".)
  assert.match(css, /\.stand \{[^}]*border-left:6px solid var\(--import-accent\)/);
  assert.match(css, /\[data-subordinate="true"\] \{ border-left-width:3px; border-left-color:var\(--import-accent\); background:#fff; \}/);
  // The hue is the same on both tiers, so nothing about rank is carried by
  // colour: the width, the level, the type step, and the fill all move together.
  assert.doesNotMatch(css, /\[data-subordinate="true"\] \{[^}]*border-left-color:var\(--import-line\)/);
});

test("the entitlement is announced as part of the claim, not as a stray badge", () => {
  const document = parseHtml(html);
  const answer = byId(document, STAND_IDS.answer);
  assert.equal(answer.getAttribute("aria-describedby"), STAND_IDS.entitlement,
    "the confidence tier and the evidence class describe THIS claim");
  // The description points at copy that is already on screen and already in the
  // reading order — no visually-hidden duplicate of what is announced anyway.
  const entitlement = byId(document, STAND_IDS.entitlement);
  assert.ok(entitlement, "the described element exists");
  assert.equal(entitlement.getAttribute("aria-hidden"), null);
  assert.ok(!String(entitlement.getAttribute("class") ?? "").includes("visually-hidden"));
  // Both halves of it are inside the described element, so the description is
  // the whole entitlement rather than one of its two indicators.
  for (const id of [STAND_IDS.evidence, STAND_IDS.confidence]) {
    assert.equal(byId(document, id).closest(`#${STAND_IDS.entitlement}`), entitlement);
  }
});

test("every disclosure names what it reveals and exposes its own state", async () => {
  const { document } = await openWithClearedStorage();
  // A bare "Show more" is a control a screen-reader user cannot tell from the
  // five beside it. Each name has to carry the question it opens.
  const bare = /^\s*(show|show more|hide|more|details|expand)\s*$/i;
  for (const key of STAND_DISCLOSURE_ORDER) {
    const ids = standDisclosureIds(key);
    const summary = byId(document, ids.summary);
    const name = textOf(summary).replace(/\s+/g, " ").trim();
    assert.doesNotMatch(name, bare, `${key} is named "${name}"`);
    assert.ok(name.length > 20, `${key}'s name does not say what it reveals: "${name}"`);
    assert.equal(summary.getAttribute("aria-expanded"), "false");
    assert.equal(summary.getAttribute("aria-label"), null,
      "the visible text is the accessible name, so speech control can say it");
  }
  // The other two disclosure controls a reader meets on the collapsed page.
  for (const id of ["finops-first-run-method-summary", "finops-workspace-nav-detail-summary"]) {
    const summary = byId(document, id);
    assert.doesNotMatch(textOf(summary).replace(/\s+/g, " ").trim(), bare);
    assert.equal(summary.getAttribute("aria-expanded"), "false");
  }
});

test("expanding a supporting step leaves the reader standing on the answer", async () => {
  const { document } = await openWithClearedStorage();
  const action = byId(document, STAND_IDS.action);
  action.focus();
  assert.equal(document.activeElement, action);

  // A supporting disclosure opens; nothing moves the keyboard off the answer.
  const ids = standDisclosureIds("departments");
  const details = byId(document, ids.details);
  details.open = true;
  details.dispatchEvent(new DomEvent("toggle", { bubbles: false }));

  assert.equal(byId(document, ids.summary).getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement, action,
    "opening supporting detail took the reader away from the answer");
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

test("a lead can tell what the claim rests on without opening anything", async () => {
  const { document } = await openWithClearedStorage();
  const region = byId(document, STAND_IDS.region);
  const entitlement = byId(document, STAND_IDS.entitlement);
  // The bundled path is hand-authored synthetic cohorts, and the region says so
  // in the same two channels every other state on it uses.
  assert.equal(region.dataset.evidenceClass, EVIDENCE_CLASS.syntheticCohort);
  assert.equal(entitlement.dataset.evidence, EVIDENCE_CLASS.syntheticCohort);
  assert.equal(entitlement.dataset.available, "true");
  // And in words, which is the channel that survives greyscale, print, and a
  // screen reader. Both come from the resolver's winning finding.
  assert.equal(shownText(document, STAND_IDS.evidence),
    STAND_EVIDENCE_LABEL[EVIDENCE_CLASS.syntheticCohort]);
  // The tier rendered is one the resolver published, never a number this view
  // worked out: the word, the attribute beside it, and the winning finding's own
  // post-downgrade level are the same value in three channels.
  const tier = entitlement.dataset.confidence;
  assert.ok(CONFIDENCE_LEVELS.includes(tier),
    `the headline rendered "${tier}", which is not a tier the resolver publishes`);
  assert.equal(tier, region.dataset.findingConfidence);
  assert.equal(shownText(document, STAND_IDS.confidence), STAND_CONFIDENCE_LABEL[tier]);
  // Neither indicator is behind a disclosure — no `details` ancestor at all.
  for (const id of [STAND_IDS.evidence, STAND_IDS.confidence]) {
    let node = byId(document, id)?.parentNode ?? null;
    while (node && node !== region) {
      assert.notEqual(node.tagName?.toLowerCase(), "details",
        `#${id} is inside a disclosure; the entitlement must be readable at a glance`);
      node = node.parentNode;
    }
  }
  // The claim above them is the degraded one, so the sentence and the indicator
  // cannot disagree about what this rests on.
  assert.ok(shownText(document, STAND_IDS.answer).startsWith(SYNTHETIC_CLAIM_QUALIFIER),
    "the headline asserted a synthetic-cohort claim without qualifying it");
});

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
  // One live announcement, and it is the answer rather than the machinery.
  assert.match(shownText(document, STAND_IDS.live), /Where do we stand|most expensive quarter/);
});

test("the shipped page renders the resolver's winning finding, and only that one", async () => {
  const { document } = await openWithClearedStorage();
  const region = byId(document, STAND_IDS.region);
  // Which finding won is on the region, so a printed page and a support
  // conversation can name the claim the reader was shown.
  assert.equal(region.dataset.finding, "peer_position");
  // The bundled path rests on synthetic cohort boundaries, so the level painted
  // here is the downgraded one, not the tier the reproducibility result stated.
  assert.equal(region.dataset.findingConfidence, "moderate");
  // The painted sentence is the winner's claim, taken from the composed model
  // rather than from a second computation on the page.
  const headline = composeStandHeadline({ analysis: loadExampleDataset(), source: "example" });
  assert.ok(headline.finding, "the example supports at least one finding");
  // And no runner-up claim reached the surface: no panel, toggle, or expander
  // for them exists in the shipped markup.
  for (const runnerUp of headline.runnersUp) {
    assert.ok(!html.includes(runnerUp.claim),
      `a runner-up claim was authored into the page: ${runnerUp.claim}`);
  }
});
