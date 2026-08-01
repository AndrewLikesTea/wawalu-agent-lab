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
  STAND_CONFIDENCE_LABEL, STAND_DISCLOSURE_ORDER, STAND_EVIDENCE_LABEL, STAND_IDS,
  STAND_MOUNTED_DISCLOSURES, STAND_QUESTION, STAND_RESOLUTION_ACTION, buildStandHeadline,
  composeStandHeadline, standHeadlineForImport,
} from "../src/finops-stand.js";
import {
  CONFIDENCE_LEVELS, EVIDENCE_CLASS, SYNTHETIC_CLAIM_QUALIFIER,
} from "../src/finops-finding-resolver.js";
import { ANSWER_BLOCK_IDS, applyStandHeadline, standDisclosureIds } from "../src/finops-stand-view.js";
import {
  EXAMPLE_ORG_COHORT_PROFILE, EXAMPLE_TASK_LEDGER, loadExampleDataset,
} from "../src/example-dataset.js";
import { resolveCostPosition } from "../src/peer-cost-position.js";
import { validateCohortAttribution } from "../src/cohort-attribution.js";
import { createAnswerState } from "../src/answer-state.js";
import { gradeEligibilityFromCoverage, sampledSpendCoverage } from "../src/grade-eligibility.js";

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

/**
 * The disclosures the document authors, which is every one of them except the
 * few `STAND_MOUNTED_DISCLOSURES` names. Those are built by
 * `finops-stand-view.js` because `evolution.html` is under a byte budget on the
 * initial payload and they carry nothing before their modules have run — so a
 * static read of the markup is the wrong place to look for them, and the tests
 * below that read `src/evolution.html` directly skip them. Every guarantee they
 * skip is asserted against the BOOTED page instead, in the test that follows.
 */
const AUTHORED_DISCLOSURES = STAND_DISCLOSURE_ORDER
  .filter((key) => !STAND_MOUNTED_DISCLOSURES.includes(key));

test("every disclosure is one interaction from the headline, with no nesting", () => {
  const document = parseHtml(html);
  const region = byId(document, STAND_IDS.region);
  for (const key of AUTHORED_DISCLOSURES) {
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
  // All of them are siblings of one another in one flat container.
  const container = byId(document, STAND_IDS.disclosures);
  assert.equal(container.querySelectorAll("details").length, AUTHORED_DISCLOSURES.length);
});

test("a mounted disclosure is indistinguishable from an authored one once the page has booted", async () => {
  const { document } = await openWithClearedStorage();
  const region = byId(document, STAND_IDS.region);
  const container = byId(document, STAND_IDS.disclosures);
  assert.ok(STAND_MOUNTED_DISCLOSURES.length > 0,
    "this assertion is only meaningful while something is mounted rather than authored");

  for (const key of STAND_MOUNTED_DISCLOSURES) {
    const ids = standDisclosureIds(key);
    const details = byId(document, ids.details);
    assert.ok(details, `${key} was never mounted into the booted page`);
    assert.equal(details.tagName.toLowerCase(), "details");
    assert.equal(details.dataset.mounted, "true", `${key} does not say it was mounted`);
    // The same three rules the authored ones are held to: flat, in the region,
    // and named by a real summary.
    assert.equal(details.parentNode.closest("details"), null, `${key} is nested`);
    assert.equal(details.closest(`#${STAND_IDS.region}`), region, `${key} is outside the region`);
    const summary = byId(document, ids.summary);
    assert.equal(summary.tagName.toLowerCase(), "summary");
    assert.equal(summary.parentNode.id, ids.details);
    assert.equal(summary.getAttribute("aria-controls"), ids.list);
    assert.equal(summary.getAttribute("tabindex"), null, `${key} overrides its tab stop`);
    assert.equal(summary.getAttribute("role"), null, `${key} overrides its native role`);
    assert.ok(textOf(summary).length > 8, `${key} carries no question of its own`);
    assert.equal(details.className, "stand-disclosure",
      `${key} would not pick up the shipped stylesheet`);
  }

  // And the container holds every disclosure exactly once, in the declared order.
  assert.deepEqual(
    [...container.querySelectorAll("details")].map((node) => node.id),
    STAND_DISCLOSURE_ORDER.map((key) => standDisclosureIds(key).details));
});

test("a mounted disclosure toggles through the same state channels as an authored one", async () => {
  const { document } = await openWithClearedStorage();
  const ids = standDisclosureIds(STAND_MOUNTED_DISCLOSURES[0]);
  const details = byId(document, ids.details);
  const summary = byId(document, ids.summary);
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  assert.match(shownText(document, ids.state), /^▸ Show · \d+$/);

  details.open = true;
  details.dispatchEvent(new DomEvent("toggle", { bubbles: false }));
  assert.equal(summary.getAttribute("aria-expanded"), "true",
    "a mounted disclosure never bound its own toggle");
  assert.equal(details.dataset.disclosure, "expanded");
  assert.match(shownText(document, ids.state), /^▾ Hide · \d+$/);
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
  for (const key of AUTHORED_DISCLOSURES) {
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
// 4b. The gradability gate is repainted, not latched.
//
// A region that suppresses its figures once and never restores them is a region
// that will assert "this export can be graded" over an empty headline. Both
// tests below drive ONE document through two states and read what a lead would
// see: the visible sentences, and whether the blocks are on the screen.
// ---------------------------------------------------------------------------

/**
 * A literacy verdict at a chosen coverage, generated here rather than committed
 * as a fixture. One scored department and one unscored one, so the ratio is the
 * only thing that changes between the two states below.
 */
function literacyAt({ coveredUsd, uncoveredUsd }) {
  return {
    departments: [
      {
        departmentId: "dept-scored", name: "Platform", gradeable: true, reason: null,
        spend: { totalUsd: coveredUsd },
      },
      {
        departmentId: "dept-unscored", name: "Support", gradeable: false,
        reason: "no_sampled_queries", spend: { totalUsd: uncoveredUsd },
      },
    ],
    eligibility: gradeEligibilityFromCoverage(
      sampledSpendCoverage({ coveredUsd, totalUsd: coveredUsd + uncoveredUsd }),
      { groups: [{ key: "Support", uncoveredUsd }] }),
    missingInput: null,
  };
}

const importedAnalysis = (literacy) => ({
  schemaVersion: "finops-analysis/test",
  period: "2026-06-01 to 2026-07-01",
  spendUsd: literacy.departments.reduce((sum, row) => sum + row.spend.totalUsd, 0),
  recoverableUsd: 1200,
  rankedDepartments: [{ id: "dept-scored", name: "Platform", spendUsd: 900 }],
  literacy,
});

/** An import the rubric barely touched: 5% of its spend is scored. */
const farBelowBar = () => importedAnalysis(literacyAt({ coveredUsd: 50, uncoveredUsd: 950 }));
/** …and one that clears the 50% bar comfortably. */
const overBar = () => importedAnalysis(literacyAt({ coveredUsd: 900, uncoveredUsd: 100 }));

/**
 * WHERE THE GRADABILITY VERDICT IS READ NOW. #831 deleted the three-slot
 * gradability line from this region: it restated, twenty lines under the answer
 * block, the same verdict that block is painted from. The verdict did not move —
 * it is the answer block's own figure and confidence sentence, which is where
 * these assertions read it, and it is carried in full by the "Can this export be
 * graded?" disclosure.
 */
const verdictText = (document) => ({
  figure: shownText(document, ANSWER_BLOCK_IDS.value),
  confidence: shownText(document, ANSWER_BLOCK_IDS.confidence),
});

const figuresOnScreen = (document) => ({
  figures: document.querySelectorAll(".stand-figures").map((node) => node.hidden),
  team: byId(document, STAND_IDS.team).hidden,
});

test("a second import that clears the bar brings the figures and the named team back", () => {
  const document = parseHtml(html);
  const eligibility = validateCohortAttribution({
    rows: [{ department_key: "atlas-platform", cost: "10" }],
  });

  // Far below the bar: the figures and the named department come off the screen,
  // because a headline computed over 5% of the spend is a claim about a sample.
  applyStandHeadline(document,
    standHeadlineForImport({ analysis: farBelowBar(), eligibility }));
  assert.deepEqual(figuresOnScreen(document), { figures: [true], team: true });
  // The answer withholds its percentage rather than printing one nobody should
  // act on, and says which state it is in.
  assert.equal(verdictText(document).figure, "Not enough scored to stand behind");

  // The same DOM, repainted with an export that clears the bar. Everything the
  // suppressed state took away has to come back, or the sentence beside it is
  // talking about figures nobody can see.
  applyStandHeadline(document, standHeadlineForImport({ analysis: overBar(), eligibility }));
  assert.deepEqual(figuresOnScreen(document), { figures: [false], team: false },
    "the suppressed figures were latched hidden and never restored");
  const graded = verdictText(document);
  assert.match(graded.figure, /^90(\.0)?% of spend in scope$/,
    "an export over the bar prints its coverage share as the answer's figure");
  assert.match(graded.confidence,
    /Coverage: .+ of .+ of spend in scope sits in departments the rubric scored\./,
    "the coverage that decided the verdict travels with the figure");
  assert.match(graded.confidence, /Residue: /,
    "what is not scored is stated beside what is");
});

test("clearing a suppressed import renders the bundled example exactly as a fresh load does", () => {
  // What a lead who never imported anything sees.
  const fresh = parseHtml(html);
  applyStandHeadline(fresh, buildStandHeadline());

  // …and what a lead sees after an import that suppressed the figures is
  // discarded. `clearImport()` restores the same bundled answer, so the two
  // renderings have to be indistinguishable — not a gutted version of one.
  const cleared = parseHtml(html);
  const answerState = createAnswerState();
  const outcome = answerState.setImport({
    analysis: farBelowBar(),
    eligibility: validateCohortAttribution({
      rows: [{ department_key: "atlas-platform", cost: "10" }],
    }),
  });
  assert.equal(outcome.committed, true, "this assertion needs the suppressing import to commit");
  applyStandHeadline(cleared, answerState.getHeadline());
  assert.deepEqual(figuresOnScreen(cleared), { figures: [true], team: true },
    "this assertion is only meaningful once the import has suppressed something");

  answerState.clearImport();
  applyStandHeadline(cleared, answerState.getHeadline());

  assert.deepEqual(figuresOnScreen(cleared), figuresOnScreen(fresh));
  assert.deepEqual(verdictText(cleared), verdictText(fresh));
  for (const id of [STAND_IDS.question, STAND_IDS.answer, STAND_IDS.recoverableValue,
    STAND_IDS.teamName, STAND_IDS.action, STAND_IDS.sample]) {
    assert.equal(shownText(cleared, id), shownText(fresh, id), `#${id} came back different`);
  }
  assert.equal(byId(cleared, STAND_IDS.region).dataset.source,
    byId(fresh, STAND_IDS.region).dataset.source);
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
