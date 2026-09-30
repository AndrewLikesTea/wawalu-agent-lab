// What the first screen of Releases and of the Prompt coach is for.
//
// #2654. Both pages opened with their name, their one-line promise, and then a
// three-line caption about a form at the foot of the page — the longest copy
// above the fold on two pages whose promise is a record you can check and a
// prompt you can grade. The page's own surface came third. Social and People
// already read the other way round, so these two now match them: the promise,
// then the surface that keeps it, and the contact route below it.
//
// Pinned on the RENDERED page and not on the markup. The coach replaces its
// entry and preview copy from its view modules on load, and Releases paints its
// deployment record from the build stamp, so an assertion against the authored
// file would describe a page no visitor sees. Each surface here is opened, its
// own entry module is run, and the order is walked out of the document that
// results.
//
// Counts, ids and indexes throughout, never `assert.equal(node, null)`:
// comparing a harness element stringifies the whole parsed page.

import test from "node:test";
import assert from "node:assert/strict";

import { ASK_ABOUT_SHIPLOG_DESCRIPTION, ASK_ABOUT_SHIPLOG_DESCRIPTION_ID } from "../src/ask-about-shiplog.js";
import { FOLLOW_UP_TOPICS } from "../src/leads.js";
import { initReleasesPage } from "../src/releases-page.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";

const PANEL_ID = "site-footer-panel";

async function openReleases(t) {
  const page = await loadPage(new URL("../src/releases.html", import.meta.url));
  t.after(() => page.restore());
  initReleasesPage(page.document, page.storage, {
    location: { pathname: "/releases.html", origin: "https://labs.wawalu.org", search: "", hash: "" },
    history: { replaceState() {} },
  });
  return page;
}

async function openCoach(t) {
  const page = await loadPage(new URL("../src/coach.html", import.meta.url));
  t.after(() => page.restore());
  await importPageModule("/prompt-coaching-page.js");
  await importPageModule("/ask-about-shiplog-page.js");
  // The bundled example grades itself on load; its score is part of the surface
  // the promise is meant to lead to, so the order is read once it is on screen.
  await waitFor(
    () => page.document.getElementById("prompt-coach-sample-body").dataset.loadState === "ready",
    "the bundled example's score",
  );
  return page;
}

const SURFACES = [
  {
    name: "releases",
    open: openReleases,
    purpose: "follow_up_releases",
    // The page's name, its one-line promise, the action that writes a record,
    // and then the one record on this page a visitor can check.
    sequence: ["#page-title", "#record-release-link", "#shipped-build", "#ask-about-shiplog"],
    intro: ["eyebrow", "page-title", "P", "hero-actions"],
    // Everything the route's caption may no longer stand above.
    surface: "#shipped-build",
  },
  {
    name: "coach",
    open: openCoach,
    purpose: "follow_up_coach",
    // The name, the promise and the in-browser data line in one sentence, the
    // region heading that names what the page returns, and the graded example.
    sequence: ["#page-title", "#page-tagline", "#prompt-coaching-question", "#prompt-coach-sample", "#ask-about-shiplog"],
    intro: ["page-title", "page-tagline"],
    surface: "#prompt-coach-sample",
  },
];

/** Document order inside the content region, as a browser would read it. */
function readingOrder(document) {
  const order = [];
  const walk = (node) => { for (const child of node.children) { order.push(child); walk(child); } };
  walk(document.querySelector("#main-content"));
  return order;
}

for (const surface of SURFACES) {
  test(`${surface.name}: the promise is followed by the page's own surface, not by the follow-up caption`, async (t) => {
    const { document } = await surface.open(t);
    const order = readingOrder(document);

    let previous = -1;
    for (const selector of surface.sequence) {
      const nodes = document.querySelectorAll(selector);
      assert.equal(nodes.length, 1, `${surface.name}: ${selector} is rendered ${nodes.length} times`);
      const index = order.indexOf(nodes[0]);
      assert.ok(index > previous, `${surface.name}: ${selector} must follow the preceding reading step`);
      previous = index;
    }

    // The introduction is exactly what it claims to be, child by child: the
    // page's name, the line that promises what it does, and — on Releases — the
    // one action that keeps it. No caption, no second paragraph.
    const intro = document.getElementById("page-title").parentNode;
    assert.deepEqual(
      intro.childElements.map((node) => node.getAttribute("id") || node.getAttribute("class") || node.tagName),
      surface.intro,
      `${surface.name}: the introduction gained or lost a block`,
    );
    const heading = order.indexOf(document.querySelector("#page-title"));

    // And the explanation is below the surface, in full: not shortened, not
    // rewritten, not split in two. It is the shared constant the other four
    // carrying pages render, so a rewrite here would be a rewrite of theirs.
    const captions = document.querySelectorAll("p")
      .filter((node) => node.getAttribute("id") === ASK_ABOUT_SHIPLOG_DESCRIPTION_ID);
    assert.equal(captions.length, 1, `${surface.name}: the caption is rendered ${captions.length} times`);
    assert.equal(textOf(captions[0]), ASK_ABOUT_SHIPLOG_DESCRIPTION);
    assert.ok(order.indexOf(captions[0]) > order.indexOf(document.querySelector(surface.surface)),
      `${surface.name}: the caption still reads above the surface the promise leads to`);

    // Read as a reader meets it: no sentence about the follow-up form stands
    // between the heading and the surface. Asserted on the rendered text of
    // every block up there rather than on the caption's own position, so a
    // second copy of the explanation cannot be written back in above it.
    const above = order.slice(heading, order.indexOf(document.querySelector(surface.surface)))
      .map((node) => textOf(node)).join(" ");
    assert.doesNotMatch(above, /follow-up form at the foot of this page/,
      `${surface.name}: the first screen explains the follow-up form again`);
    assert.doesNotMatch(above, /A person replies by email/,
      `${surface.name}: the reply window is promised above the page's own surface`);
  });

  test(`${surface.name}: the moved route still reaches the form, once, and the form still names its topic`, async (t) => {
    const { document } = await surface.open(t);

    // One route, one stop, and the label is its visible text.
    const routes = document.querySelectorAll("a")
      .filter((node) => node.getAttribute("id") === "ask-about-shiplog");
    assert.equal(routes.length, 1, `${surface.name}: the page renders ${routes.length} routes`);
    const [route] = routes;
    assert.equal(textOf(route), "Ask about Shiplog");
    assert.equal(route.getAttribute("aria-label"), null);
    assert.equal(route.getAttribute("href"), `#${PANEL_ID}`);
    const stops = tabSequence(document);
    assert.equal(stops.filter((node) => node === route).length, 1,
      `${surface.name}: the route is unreachable by Tab, or reached twice`);
    assert.ok(route.closest("#main-content"), `${surface.name}: the route left the content region`);

    // The caption is still the route's accessible description, and still not a
    // control: the description survives the move for a screen-reader user, and
    // the move added no tab stop to either page.
    const caption = document.getElementById(ASK_ABOUT_SHIPLOG_DESCRIPTION_ID);
    assert.equal(route.getAttribute("aria-describedby"), ASK_ABOUT_SHIPLOG_DESCRIPTION_ID);
    assert.equal(caption.parentNode === route.parentNode, true,
      `${surface.name}: the caption drifted out of the row its label sits in`);
    assert.equal(caption.tagName, "P");
    assert.equal(caption.getAttribute("class"), "hint");
    assert.equal(stops.filter((node) => node === caption).length, 0,
      `${surface.name}: the caption became a tab stop`);
    assert.equal(caption.querySelectorAll("a").length + caption.querySelectorAll("button").length, 0,
      `${surface.name}: the caption drew a control`);
    // Nor is it inside anything announced: a caption that moved into a status
    // or live node would be read out on load in a real browser, and this
    // harness models no layout, so nothing here would have said so.
    for (let cursor = caption; cursor; cursor = cursor.parentNode) {
      assert.equal(cursor.getAttribute?.("aria-live") ?? null, null,
        `${surface.name}: the caption sits inside a live region`);
      assert.ok(!["status", "alert", "log"].includes(cursor.getAttribute?.("role")),
        `${surface.name}: the caption sits inside an announced region`);
    }

    // Following it still lands focus on the form's container, not merely at its
    // scroll position, and the fragment is still navigated so the arrival stays
    // shareable.
    route.focus();
    pressEnter(document);
    assert.equal(document.activeElement?.getAttribute("id"), PANEL_ID,
      `${surface.name}: following the route left focus outside the follow-up form`);
    assert.deepEqual(document.navigations, [`#${PANEL_ID}`]);

    // And what a reader arrives at is unchanged: the topic this request is
    // about, named above the field, in the words the one map holds for it.
    const panel = document.getElementById(PANEL_ID);
    assert.equal(panel.querySelectorAll("#site-footer-email").length, 1);
    const note = document.getElementById("site-footer-topic-note");
    assert.ok(textOf(note).includes(FOLLOW_UP_TOPICS[surface.purpose]),
      `${surface.name}: the form no longer names the topic it sends`);
    const panelOrder = [];
    const walk = (node) => { for (const child of node.children) { panelOrder.push(child); walk(child); } };
    walk(panel);
    assert.ok(panelOrder.indexOf(note) < panelOrder.indexOf(document.getElementById("site-footer-email")),
      `${surface.name}: the topic is named below the field it describes`);
    assert.equal(document.querySelector("#site-footer-form").dataset.followUpType, surface.purpose);
  });
}
