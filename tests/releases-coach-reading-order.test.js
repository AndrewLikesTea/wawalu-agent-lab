// THE OPENING SCREEN ON RELEASES AND THE PROMPT COACH (#2654).
//
// Both pages used to open on a paragraph about a form. The "Ask about Shiplog"
// route carries three sentences saying where it goes, what the form there asks
// for and what comes back (#2556), and on these two pages that caption stood in
// the introduction — between the Releases promise and the one record on that
// page a visitor can check, and between the coach's promise and the bundled
// example that keeps it. Social already ships the other shape: the hero carries
// the page's own action and the contact route closes the supporting material.
//
// What is pinned here:
//
//   1. RENDERED reading order, walked over the painted document after every
//      module has settled. Source order is not the claim: the coach replaces its
//      entry and preview leads on load, and the Releases page paints the build
//      stamp's own commit subject into the deployment record. A markup-order
//      check would describe a page no visitor reads.
//   2. The route survives the move: one per page, in the tab order once, still
//      landing focus on the follow-up panel rather than only scrolling to it.
//   3. The explanation survives with it — same container, same aria-describedby,
//      still static text rather than a second control.
//   4. The form it lands on still names the topic this request is about above
//      the field it asks for, in the words the one topic map holds.
//
// Counts, attributes and indexes throughout, never `assert.equal(node, node)`:
// comparing two harness elements stringifies the whole parsed page and outlives
// the timeout.

import test from "node:test";
import assert from "node:assert/strict";

import { STORAGE_KEY } from "../src/app.js";
import {
  ASK_ABOUT_SHIPLOG_DESCRIPTION, ASK_ABOUT_SHIPLOG_DESCRIPTION_ID,
  ASK_ABOUT_SHIPLOG_HREF, ASK_ABOUT_SHIPLOG_ID, ASK_ABOUT_SHIPLOG_LABEL,
} from "../src/ask-about-shiplog.js";
import { FOLLOW_UP_TOPICS } from "../src/leads.js";
import { FIRST_RUN_GRADED_TITLE } from "../src/prompt-coaching-entry-view.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { initReleasesPage } from "../src/releases-page.js";
import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const PANEL_ID = ASK_ABOUT_SHIPLOG_HREF.slice(1);
const ROW_ID = "ask-about-shiplog-actions";

/** Every element of the painted page, in the order a reader meets it. */
function readingOrder(root) {
  const order = [];
  const walk = (node) => {
    for (const child of node.children ?? []) {
      order.push(child);
      walk(child);
    }
  };
  walk(root);
  return order;
}

/**
 * The Releases page, booted the way the browser boots it and waited on BOTH of
 * its settle signals: the log's own render, and the deployment band's
 * comparison. Waiting on the first alone leaves the record's probe in flight,
 * which lands in CI as an unhandled rejection while passing locally.
 */
async function openReleases(t) {
  const page = await loadPage(new URL("../src/releases.html", import.meta.url), {
    storage: { [STORAGE_KEY]: "[]", [RELEASE_STORAGE_KEY]: "[]" },
  });
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, {
    location: { pathname: "/releases.html", origin: "https://labs.wawalu.org", search: "", hash: "" },
    history: { replaceState() {} },
  });
  const settled = (name) => page.document.documentElement.dataset[name] === "ready";
  await waitFor(() => settled("shiplogReleases"), "the releases page never finished rendering");
  await waitFor(() => settled("shiplogDeployment"), "the deployment band never finished its comparison");
  return page;
}

/**
 * The prompt coach, likewise: the page entry and the route's own module, then
 * every region that paints after load — the bundled example's load state, its
 * heading (which ships the loading state's wording and is rewritten only once
 * the grade it claims is on screen), and the possible results. The heading is
 * waited on separately from the load state on purpose: a settled promise says
 * the load finished, and the heading says the paint did.
 */
async function openCoach(t) {
  const page = await loadPage(new URL("../src/coach.html", import.meta.url));
  t.after(() => page.restore());
  await importPageModule("/prompt-coaching-page.js");
  await importPageModule("/ask-about-shiplog-page.js");
  const { document } = page;
  const ready = (id) => document.getElementById(id)?.dataset.loadState === "ready";
  await waitFor(() => ready("prompt-coach-sample-body"), "the bundled example never graded");
  await waitFor(() => textOf(document.getElementById("prompt-coach-sample-title")) === FIRST_RUN_GRADED_TITLE,
    "the bundled example's heading still reads as a load in progress");
  await waitFor(() => ready("coaching-specimen-body"), "the possible results never loaded");
  return page;
}

/**
 * Each page's own content, in the order the issue requires it: everything a
 * visitor came for stands above the ask. Selectors rather than strings, because
 * the Releases record paints a commit subject this page neither writes nor
 * bounds, and a word in it must not be able to move a reading-order index.
 */
const surfaces = [
  {
    name: "releases",
    open: openReleases,
    purpose: "follow_up_releases",
    // The heading, the one-line promise of what the log holds, the route into
    // the recorder, then the page's one checkable record — and the invented
    // example still wholly after the ask, not interleaved with it.
    before: ["#page-title", "#releases-promise", "#record-release-link", "#shipped-build-title"],
    after: ["#shiplog-proof-title"],
  },
  {
    name: "coach",
    open: openCoach,
    purpose: "follow_up_coach",
    // The heading, the promise and the in-browser data line it carries, the
    // region that holds the bundled example, and the example's own score.
    before: ["#page-title", "#page-tagline", "#prompt-coaching-question", "#prompt-coach-sample-result"],
    after: ["#coach-neighbour-title"],
  },
];

for (const surface of surfaces) {
  test(`${surface.name}: the page's own content is read before the ask that follows it`, async (t) => {
    const page = await surface.open(t);
    const { document } = page;
    const order = readingOrder(document.getElementById("main-content"));
    const at = (selector) => {
      const nodes = document.querySelectorAll(selector);
      assert.equal(nodes.length, 1, `${surface.name}: ${selector} is painted ${nodes.length} times`);
      const index = order.indexOf(nodes[0]);
      assert.ok(index >= 0, `${surface.name}: ${selector} is not inside the content region`);
      return index;
    };

    let previous = -1;
    for (const selector of [...surface.before, `#${ASK_ABOUT_SHIPLOG_ID}`,
      `#${ASK_ABOUT_SHIPLOG_DESCRIPTION_ID}`, ...surface.after]) {
      const index = at(selector);
      assert.ok(index > previous,
        `${surface.name}: ${selector} is read before the step that must precede it`);
      previous = index;
    }

    // The promise is the page's, not this test's: read off the node the order
    // above places, so rewriting it to something that is not a promise fails
    // here rather than drifting.
    assert.match(textOf(document.querySelector(surface.before[1])),
      surface.name === "releases" ? /^Every release — Completed, Planned, or Cancelled/ : /^Grade a prompt before you send it/);
  });

  test(`${surface.name}: the ask keeps its one control, its landing and its description`, async (t) => {
    const page = await surface.open(t);
    const { document } = page;

    // One route, named by its visible text, in the tab order exactly once.
    const routes = document.querySelectorAll("a")
      .filter((link) => link.getAttribute("id") === ASK_ABOUT_SHIPLOG_ID);
    assert.equal(routes.length, 1, `${surface.name}: the page paints ${routes.length} routes, not one`);
    const [route] = routes;
    assert.equal(textOf(route), ASK_ABOUT_SHIPLOG_LABEL);
    assert.equal(route.getAttribute("href"), ASK_ABOUT_SHIPLOG_HREF);
    assert.equal(route.getAttribute("aria-label"), null);
    const sequence = tabSequence(document);
    assert.equal(sequence.filter((node) => node === route).length, 1,
      `${surface.name}: the route is not reached by Tab exactly once`);

    // The first focusable after the skip link is untouched by the move: the
    // wordmark, the way it is on every page of this site.
    assert.equal(textOf(sequence[0]), "Skip to main content");
    assert.equal(textOf(sequence[1]), "Shiplog");

    // The description moved with the label, in one container, and it is still
    // the label's accessible description rather than a line beside it.
    const described = document.querySelectorAll("p")
      .filter((node) => node.getAttribute("id") === ASK_ABOUT_SHIPLOG_DESCRIPTION_ID);
    assert.equal(described.length, 1, `${surface.name}: the description is painted ${described.length} times`);
    assert.equal(textOf(described[0]), ASK_ABOUT_SHIPLOG_DESCRIPTION);
    assert.equal(route.getAttribute("aria-describedby"), ASK_ABOUT_SHIPLOG_DESCRIPTION_ID);
    const row = document.getElementById(ROW_ID);
    assert.equal(row.querySelectorAll(`#${ASK_ABOUT_SHIPLOG_ID}`).length, 1,
      `${surface.name}: the route left the row that carries its description`);
    assert.equal(row.querySelectorAll(`#${ASK_ABOUT_SHIPLOG_DESCRIPTION_ID}`).length, 1,
      `${surface.name}: the description left the row its label sits in`);

    // Static text, not a second control: neither page has a tab stop to spare
    // on something that only explains another control.
    assert.equal(described[0].tagName, "P");
    assert.equal(described[0].getAttribute("class"), "hint");
    assert.equal(described[0].getAttribute("tabindex"), null);
    assert.equal(described[0].querySelectorAll("a").length + described[0].querySelectorAll("button").length, 0,
      `${surface.name}: the description drew a control of its own`);
    assert.equal(sequence.filter((node) => node === described[0]).length, 0,
      `${surface.name}: the description became a tab stop`);
    // And it is not folded into a disclosure on the way: textOf reads through a
    // closed details element, so only the ancestor walk catches that.
    for (let node = described[0]; node; node = node.parentNode) {
      assert.ok(!node.open, `${surface.name}: the description is inside a disclosure`);
      assert.ok(!node.hidden, `${surface.name}: the description is inside a hidden region`);
    }

    // Following it lands focus on the follow-up panel, not merely at its scroll
    // position — this harness models no layout, and the focus move is the half a
    // keyboard or screen-reader visitor depends on.
    const panel = document.getElementById(PANEL_ID);
    assert.equal(panel.getAttribute("tabindex"), "-1");
    assert.equal(sequence.filter((node) => node === panel).length, 0,
      `${surface.name}: the landing target became a tab stop of its own`);
    route.focus();
    pressEnter(document);
    assert.equal(document.activeElement?.getAttribute("id"), PANEL_ID,
      `${surface.name}: following the route left focus outside the follow-up form`);
    assert.deepEqual(document.navigations, [ASK_ABOUT_SHIPLOG_HREF]);
  });

  test(`${surface.name}: the form it lands on still names the topic above the field`, async (t) => {
    const { document } = await surface.open(t);
    const topic = FOLLOW_UP_TOPICS[surface.purpose];

    // The topic the form sends is untouched by the move, and it is stated in the
    // panel — above the work-email field, in the words the one map holds.
    const form = document.getElementById("site-footer-form");
    assert.equal(form.dataset.followUpType, surface.purpose);
    assert.equal(form.dataset.followUpTopic, topic);
    const note = document.getElementById("site-footer-topic-note");
    assert.ok(textOf(note).includes(topic), `${surface.name}: the panel no longer names "${topic}"`);

    const order = readingOrder(document.getElementById(PANEL_ID));
    assert.ok(order.indexOf(note) >= 0, `${surface.name}: the topic line left the landing target`);
    assert.ok(order.indexOf(note) < order.indexOf(document.getElementById("site-footer-email")),
      `${surface.name}: the topic is named below the field it is about`);
  });
}
