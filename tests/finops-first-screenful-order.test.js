// What a stranger meets, in order, in the first screenful of /evolution.html.
//
// #832 asked for one thing: a first-time reader reaches the ONE answer without
// scrolling past a queue of asks. This file pins the reading order that makes
// that true, and the shape of the single group the answer's follow-on detail
// now sits in. It reads the shipped markup rather than a booted page on
// purpose — everything asserted here has to be true before a line of
// JavaScript runs, because the reader who benefits most from it is the one
// whose script never arrived.
//
// WHAT IT DOES NOT ASSERT, AND WHY. Not pixels, not order in the stylesheet,
// not a screenshot. Source order IS announcement order and focus order on this
// page (tests/finops-headline-accessibility.test.js holds the stylesheet to
// that), so the document order below is the order a screen-reader user hears.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { DomEvent, loadPage, parseHtml, pressEnter, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { STAND_IDS } from "../src/finops-stand.js";
import { ANSWER_SUPPORT_IDS } from "../src/finops-stand-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const DEMO_DATA = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(await readFile(
  new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const byId = (document, id) => document.getElementById(id);
const doc = () => parseHtml(html);

/** `#main-content`'s own element children that carry an id, in document order. */
const regionIds = (document) => [...(byId(document, "main-content").children ?? [])]
  .filter((node) => node?.nodeType === 1 && node.id).map((node) => node.id);

/** Every heading in `main`, in document order, hidden ones included. */
const headings = (document) => byId(document, "main-content")
  .querySelectorAll("h1,h2,h3,h4,h5,h6");

// ---------------------------------------------------------------------------
// 1. Heading order.
// ---------------------------------------------------------------------------

test("the page carries exactly one h1, and the answer's h2 is the first heading in main", () => {
  const document = doc();
  const order = headings(document);

  const h1s = order.filter((node) => node.tagName === "H1");
  assert.equal(h1s.length, 1, `main carries ${h1s.length} h1 elements; it must carry exactly one`);
  assert.equal(h1s[0].id, "page-title", "the page's one h1 is not the hero's title");

  // THE ONE THING THAT MAY PRECEDE THE h1, and it is deliberate. #727 put the
  // answer above the hero: a leader opens this page with a question and used to
  // meet a full screen of what the page is FOR before it was answered. So the
  // first heading a reader meets is the question the page answers, and the h1
  // that names the page follows it as orientation. That ordering is the
  // product decision this assertion exists to keep, not an accident to fix —
  // see src/finops/answer-spine-view.js, which declares the same order.
  assert.equal(order[0].id, STAND_IDS.question, "the answer's question is not the first heading");
  assert.equal(order[0].tagName, "H2");

  // …and NOTHING ELSE gets in between. Every heading a reader meets before the
  // h1 belongs to the answer region itself — its own subordinate h3s — so no
  // second region has slipped a question in above the page's own name.
  for (const heading of order.slice(0, order.indexOf(h1s[0]))) {
    assert.equal(heading.closest(`#${STAND_IDS.region}`)?.id, STAND_IDS.region,
      `#${heading.id || heading.tagName} is authored above the page's h1 but outside the answer`);
  }

  // The answer region asks the page's one h2-level question; the next one is
  // below the h1, so a reader is never handed two competing questions first.
  const secondH2 = order.filter((node) => node.tagName === "H2")[1];
  assert.ok(order.indexOf(secondH2) > order.indexOf(h1s[0]),
    `#${secondH2?.id} asks a second question above the page's own h1`);
});

// ---------------------------------------------------------------------------
// 2. Region order: the answer, then the hero, then the way on.
// ---------------------------------------------------------------------------

test("the answer is the first content region, ahead of the hero, the rail and every disclosure", () => {
  const document = doc();
  const order = regionIds(document);
  const answer = order.indexOf(STAND_IDS.region);

  assert.equal(answer, 0, "the answer is not the first region a reader meets in the landmark");
  // The hero is the region immediately after it: orientation under the answer,
  // with nothing wedged between the two.
  assert.equal(order[1], "finops-hero", "the hero no longer follows the answer immediately");

  for (const id of ["finops-workspace-nav", "finops-workspace-switch",
    ANSWER_SUPPORT_IDS.group]) {
    assert.ok(order.indexOf(id) > answer, `#${id} is authored above the answer it supports`);
  }

  // Every top-level disclosure on the page, without naming them: a group added
  // later that opens above the answer fails here rather than in review.
  for (const details of byId(document, "main-content").querySelectorAll("details")) {
    const region = details.closest("#main-content").children.find(
      (node) => node === details || node.contains?.(details));
    assert.ok(regionIds(document).indexOf(region?.id ?? "") !== 0,
      `a disclosure is inside the first region, so the answer is behind a control`);
  }

  // The answer itself is not a disclosure and is not subordinate to anything.
  const region = byId(document, STAND_IDS.region);
  assert.equal(region.closest("details"), null, "the answer sits inside a disclosure");
  assert.equal(region.dataset.subordinate, undefined, "the answer is marked subordinate");
});

// ---------------------------------------------------------------------------
// 3. One group, one control, both layers still in it.
// ---------------------------------------------------------------------------

test("the follow-on detail is one collapsed group, with both consolidated layers inside it", () => {
  const document = doc();
  const group = byId(document, ANSWER_SUPPORT_IDS.group);
  const summary = byId(document, ANSWER_SUPPORT_IDS.summary);

  assert.ok(group, "the consolidated group is not on the page");
  assert.equal(group.tagName, "DETAILS", "the group is not a native disclosure");
  assert.equal(group.hasAttribute("open"), false, "the group ships expanded");
  assert.equal(group.dataset.subordinate, "true", "the group is not marked subordinate to the answer");
  assert.equal(group.dataset.headlineEvidence, "false",
    "the group claims to back the headline figure");
  assert.equal(group.dataset.workspaceRegion, "answer",
    "a deep link into the group would resolve to the wrong destination");

  // AUTHORED, not written on the first press. A control that gains its state
  // only once a reader has pressed it was unlabelled at the one moment they
  // were deciding whether to press it — which is exactly the moment a
  // progressive-disclosure group exists for.
  assert.equal(summary.tagName, "SUMMARY", "the control is not the summary itself");
  assert.equal(summary.getAttribute("aria-expanded"), "false",
    "the group's control ships without a collapsed state in the accessibility tree");
  assert.equal(summary.parentNode.id, ANSWER_SUPPORT_IDS.group);
  assert.equal(summary.querySelector("button"), null,
    "a button inside the summary takes Enter and Space away from the browser");
  assert.equal(summary.getAttribute("tabindex"), null, "the control left the natural tab order");
  assert.match(textOf(summary), /\?$/, "the group opens on a label rather than a question");

  // NOTHING WAS DROPPED. Both sections the two retired wrappers held are still
  // authored, still inside this one group, and still named by their own
  // headings and their own synthetic markers.
  for (const [id, headingId, markerId] of [
    ["finops-next-step", "finops-next-step-question", "finops-next-step-sample"],
    ["finops-journey", "finops-journey-question", "finops-journey-sample"]]) {
    const section = byId(document, id);
    assert.ok(section, `#${id} was dropped by the consolidation`);
    assert.equal(section.closest("details")?.id, ANSWER_SUPPORT_IDS.group,
      `#${id} is not inside the one group`);
    assert.equal(section.getAttribute("aria-labelledby"), headingId);
    assert.ok(textOf(byId(document, headingId)).length > 0, `#${id} lost its question`);
    assert.equal(byId(document, markerId).closest(`#${id}`)?.id, id,
      `#${id} lost the marker that says whose figures it holds`);
  }

  // One control, not two: the wrappers are gone, not hidden.
  for (const retired of ["disclosure-next-step", "disclosure-journey"]) {
    assert.ok(!html.includes(`id="${retired}"`),
      `${retired} was consolidated but is still authored on the page`);
  }
});

// ---------------------------------------------------------------------------
// 4. The state stays true after a reader presses it.
// ---------------------------------------------------------------------------

test("the group's announced state follows its own open state, both ways, on the booted page", async () => {
  const page = await loadPage(PAGE, {
    storage: {},
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  {
    await importPageModule("/evolution-page.js");
    await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
      "the bundled analysis to finish rendering");

    const { document } = page;
    const group = byId(document, ANSWER_SUPPORT_IDS.group);
    const summary = byId(document, ANSWER_SUPPORT_IDS.summary);
    assert.equal(summary.getAttribute("aria-expanded"), "false",
      "booting the page opened the group a reader had not asked for");

    // Enter on the native control, and focus stays where the reader put it.
    summary.focus();
    pressEnter(document);
    assert.equal(group.hasAttribute("open"), true, "Enter did not expand the group");
    assert.equal(summary.getAttribute("aria-expanded"), "true",
      "aria-expanded drifted from what the reader has open");
    assert.equal(group.dataset.disclosure, "expanded");
    assert.equal(document.activeElement, summary,
      "expanding moved focus off the control that opened it");

    pressEnter(document);
    assert.equal(summary.getAttribute("aria-expanded"), "false",
      "aria-expanded drifted from what the reader has open");
    assert.equal(group.dataset.disclosure, "collapsed");
    assert.equal(document.activeElement, summary);

    // And a path that is not the keyboard — a deep link opens the group through
    // the property — goes through the same one binding.
    group.open = true;
    group.dispatchEvent(new DomEvent("toggle", { bubbles: false }));
    assert.equal(summary.getAttribute("aria-expanded"), "true",
      "the group only tracks its state on the keyboard path");
  }
});
