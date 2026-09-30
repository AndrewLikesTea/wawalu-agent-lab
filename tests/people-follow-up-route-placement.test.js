// Where People puts its follow-up errand (#2640).
//
// People answers with pictures. The "Ask about Shiplog" route used to open the
// page: it was the first stop in the content region and the second thing read
// inside the content region, above the display-name filter that chooses the
// pictures and above the pictures themselves. So a reader who came to look at
// image posts met an errand about the product before a single tile, and a
// keyboard reader had to walk past it to reach the filter.
//
// It closes the reading surface now, in the place Social already puts the same
// label (src/social.html): under the list, under the supporting captions, and
// above the About Shiplog band it points at. What this file pins is the
// placement in the frames a reader actually gets — served, hydrated, and in each
// state the list passes through — rather than in the served markup alone,
// because src/profile.js rewrites this panel on every render and withdraws two
// of its blocks while the first fetch is open.
//
// HOW THIS FILE IS BUILT, and why it is built that way. One page per test, torn
// down by that test: per-test hooks run oldest first, so a test holding several
// pages open would restore an earlier page's globals last and leave the wrong
// document installed for whatever ran next. And no assertion here reads a
// transient pre-hydration string. People's authored markup pre-renders
// hydrated-looking copy — the display-name filter ships the sentence it shows
// while the filter is shut — and src/feed-status.js REMOVES that sentence the
// moment the filter opens, so a wait or an assertion on it is a race against the
// module's own first render rather than a statement about this change.
//
// Counts, attributes and index comparisons throughout, never an equality
// assertion against a harness element: comparing one stringifies the whole
// parsed page and outlives the timeout.

import test from "node:test";
import assert from "node:assert/strict";

import {
  ASK_ABOUT_SHIPLOG_DESCRIPTION, ASK_ABOUT_SHIPLOG_DESCRIPTION_ID,
  ASK_ABOUT_SHIPLOG_HREF, ASK_ABOUT_SHIPLOG_ID, ASK_ABOUT_SHIPLOG_LABEL,
} from "../src/ask-about-shiplog.js";
import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const PAGE_URL = new URL("../src/profile.html", import.meta.url);
const SEED_ROUTE = "/social-demo-data.json";
const LIVE_ROUTE = "/api/social-posts?limit=100";
const PANEL_ID = ASK_ABOUT_SHIPLOG_HREF.slice(1);

// Built here rather than committed, so the bundled demo posts cannot decide what
// this file asserts. The id tail is the day of month the post is dated: an
// invalid day is dropped on the way in and the page lands on a name with nothing
// under it, which would quietly turn a populated state into an empty one.
const image = (name) => ({ src: `/media/${name}.svg`, alt: `A drawing signed ${name}`, width: 1200, height: 900 });
const seedPost = (id, author) => ({
  id,
  author,
  body: `${id} from ${author}`,
  caption: null,
  createdAt: `2026-07-${id.slice(-2)}T09:00:00.000Z`,
  likes: 0,
  comments: 0,
  image: image(author),
});
const SEED_FEED = { posts: [seedPost("p-12", "Zed"), seedPost("p-13", "Bea"), seedPost("p-14", "Zed")] };

/* ------------------------------ page harness ------------------------------ */

/**
 * The served markup, with no module run: the frame a reader whose scripts never
 * arrive gets, and the one the module renders into.
 */
async function servePeople(t, { search = "", routes = {} } = {}) {
  const page = await loadPage(PAGE_URL, { location: { search }, routes });
  t.after(() => page.restore());
  return page.document;
}

/**
 * The settled page, with the module that owns it. The 30-second refresh must not
 * outlive a test and history.replaceState is not something this harness
 * provides, so both are quieted and put back before the page is torn down.
 */
async function openPeople(t, { search = "", seed = SEED_FEED, live = { posts: [] }, routes } = {}) {
  const page = await loadPage(PAGE_URL, {
    location: { search },
    routes: routes ?? { [SEED_ROUTE]: seed, [LIVE_ROUTE]: live },
  });
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  globalThis.window.history = { replaceState() {} };
  t.after(() => { globalThis.setInterval = savedInterval; page.restore(); });
  await importPageModule("/profile-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogProfile === "ready", "the first load settles");
  return page.document;
}

/* ------------------------------- order tools ------------------------------ */

// The pre-order walk a browser reads the page in, over the content region only.
// The harness keeps text nodes in `children`, so element nodes are selected by
// nodeType rather than by a truthy tagName.
function mainOrder(document) {
  const order = [];
  const visit = (node) => {
    for (const child of node.children) {
      if (child.nodeType !== 1) continue;
      order.push(child);
      visit(child);
    }
  };
  visit(document.querySelector("#main-content"));
  return order;
}

/** Reading position of a selector inside the content region. Index, never the
 * element. */
const readingIndex = (document, selector) => {
  const target = document.querySelector(selector);
  return mainOrder(document).findIndex((node) => node === target);
};

/** Each of the results panel's own element children, named by the one attribute
 * it carries, so a signature can be compared across states without comparing
 * elements. */
const panelSignature = (document) => document.querySelector(".list-panel").children
  .filter((node) => node.nodeType === 1)
  .map((node) => node.getAttribute("id") ?? node.getAttribute("class") ?? "");

/** Real tiles only: the loading skeleton carries .profile-tile too. */
const drawnTiles = (document) => document.querySelectorAll(".profile-tile")
  .filter((tile) => !tile.classList.contains("profile-tile-skeleton"));

/* ------------------- the pictures come before the errand ------------------ */

function assertErrandFollowsTheList(document, state) {
  const at = (selector) => readingIndex(document, selector);
  const route = at(`#${ASK_ABOUT_SHIPLOG_ID}`);
  const caption = at(`#${ASK_ABOUT_SHIPLOG_DESCRIPTION_ID}`);

  assert.ok(route > -1, `${state}: the content region no longer carries the follow-up route`);
  for (const ahead of ["#profile-author-label", "#profile-author", "#grid-title", "#profile-feed-status", "#profile-grid"]) {
    assert.ok(at(ahead) > -1, `${state}: the page is missing ${ahead}`);
    assert.ok(at(ahead) < route, `${state}: ${ahead} is read after the follow-up route, not before it`);
  }
  // The caption travels with the label and follows it, so the pair reads as a
  // control and then the line explaining it.
  assert.ok(caption > route, `${state}: the caption is read before the label it explains`);
  assert.equal(document.querySelector(`#${ASK_ABOUT_SHIPLOG_DESCRIPTION_ID}`).parentNode
    === document.querySelector(`#${ASK_ABOUT_SHIPLOG_ID}`).parentNode, true,
    `${state}: the caption drifted out of the container its label sits in`);
  // And the errand closes the reading surface: the two blocks after the
  // display-name caveat, and nothing else.
  assert.deepEqual(panelSignature(document).slice(-3),
    ["profile-role hint", ASK_ABOUT_SHIPLOG_ID, ASK_ABOUT_SHIPLOG_DESCRIPTION_ID],
    `${state}: the follow-up route does not close the results panel`);
}

test("the filter and the image-post list are read before the follow-up route, as served", async (t) => {
  assertErrandFollowsTheList(await servePeople(t), "as served");
});

test("the filter and the image-post list are read before the follow-up route, once loaded", async (t) => {
  // The wait is on drawn tiles rather than on text: this page pre-renders
  // hydrated-looking copy, and skeletons carry the tile class.
  const document = await openPeople(t);
  await waitFor(() => drawnTiles(document).length > 0, "the grid drew a tile");
  assertErrandFollowsTheList(document, "loaded");
});

test("the follow-up route and its explanation are each rendered exactly once", async (t) => {
  const document = await openPeople(t);
  const main = document.querySelector("#main-content");

  const routes = main.querySelectorAll("a").filter((link) => link.getAttribute("id") === ASK_ABOUT_SHIPLOG_ID);
  assert.equal(routes.length, 1, `the content region paints ${routes.length} follow-up routes, not one`);
  assert.equal(textOf(routes[0]), ASK_ABOUT_SHIPLOG_LABEL);
  assert.equal(routes[0].getAttribute("href"), ASK_ABOUT_SHIPLOG_HREF);
  assert.equal(routes[0].getAttribute("aria-describedby"), ASK_ABOUT_SHIPLOG_DESCRIPTION_ID);

  const captions = main.querySelectorAll("p")
    .filter((node) => node.getAttribute("id") === ASK_ABOUT_SHIPLOG_DESCRIPTION_ID);
  assert.equal(captions.length, 1, `the caption is painted ${captions.length} times`);
  assert.equal(textOf(captions[0]), ASK_ABOUT_SHIPLOG_DESCRIPTION);
  // Counted over the rendered text as well as over the elements: a second copy
  // written by a render path would not have to carry the id.
  assert.equal(textOf(main).split(ASK_ABOUT_SHIPLOG_DESCRIPTION).length - 1, 1,
    "the content region states the follow-up caption more than once");
  // The label reads twice in that text and only twice: once as the control, once
  // as the first three words of the sentence describing it.
  assert.equal(textOf(main).split(ASK_ABOUT_SHIPLOG_LABEL).length - 1, 2,
    "the label is written somewhere other than the control and its own caption");
  // And nothing was left behind in the introduction it moved out of.
  const hero = document.querySelector(".hero-profile");
  assert.equal(hero.querySelectorAll(`#${ASK_ABOUT_SHIPLOG_ID}`).length, 0,
    "the introduction still carries a copy of the route");
  assert.equal(hero.querySelectorAll(".hero-actions").length, 0,
    "the introduction kept the empty action row the route used to sit in");

  // It cost no new rule, and it moved by markup rather than by a tabindex.
  assert.equal(captions[0].getAttribute("class"), "hint", "the caption introduced a class of its own");
  assert.equal(routes[0].getAttribute("class"), "text-link", "the route introduced a class of its own");
  assert.equal(tabSequence(document).filter((node) => node === captions[0]).length, 0,
    "the caption became a tab stop");
  assert.equal(routes[0].getAttribute("tabindex"), null);
  assert.equal(tabSequence(document).filter((node) => Number(node.getAttribute("tabindex")) > 0).length, 0,
    "a positive tabindex is propping up the new order");
});

test("the route still lands on the follow-up form from its new position", async (t) => {
  const document = await openPeople(t);
  await importPageModule("/ask-about-shiplog-page.js");

  const route = document.getElementById(ASK_ABOUT_SHIPLOG_ID);
  const panel = document.getElementById(PANEL_ID);
  // The handler resolves its target by id from the document, so the move cannot
  // have broken it by distance — but that is the claim, so it is pressed rather
  // than reasoned about.
  route.focus();
  pressEnter(document);
  assert.equal(document.activeElement?.getAttribute("id"), PANEL_ID,
    "following the route from below the list left focus outside the follow-up form");

  // What the reader arrives on: the container holding the topic control they
  // came to answer and the work-email field under it. The panel and not the
  // field itself, so the arrival reads as a form with its reasons.
  assert.equal(panel.querySelectorAll("#site-footer-intent").length, 1,
    "the topic control is not inside the container the route lands on");
  assert.equal(panel.querySelectorAll("#site-footer-email").length, 1);
  assert.equal(panel.getAttribute("tabindex"), "-1");
  assert.equal(tabSequence(document).filter((node) => node === panel).length, 0,
    "the landing target became a tab stop of its own");
  // The fragment is still reached, so the arrival stays shareable and the back
  // button undoes it. Nothing left the page.
  assert.deepEqual(document.navigations, [ASK_ABOUT_SHIPLOG_HREF]);

  // One follow-up form, counted by the submit the Wawalu team receives rather
  // than by element identity: the route's whole point is that it already exists.
  const asking = document.querySelectorAll("form").filter((form) => form.querySelectorAll("button")
    .some((button) => textOf(button) === "Request a follow-up"));
  assert.equal(asking.length, 1, `the page carries ${asking.length} follow-up forms`);
});

test("the tab order follows the new reading order: filter, then the list, then the errand", async (t) => {
  const document = await openPeople(t);
  const inMain = tabSequence(document).filter((node) => node.closest("#main-content"));

  // The display names open the content region. Read off the fixture's own two
  // names rather than a literal list, and checked to be the filter's controls
  // rather than merely to be first.
  assert.deepEqual(inMain.slice(0, 2).map((node) => node.dataset?.author), ["Bea", "Zed"],
    "the display-name filter is no longer the first thing a keyboard reader reaches");
  const picker = document.querySelector("#profile-name-picker");
  assert.equal(inMain[0].closest("#profile-name-picker"), picker,
    "the first stop in the content region is not part of the display-name filter");
  // The errand closes it.
  assert.equal(inMain.at(-1).getAttribute("id"), ASK_ABOUT_SHIPLOG_ID,
    "the follow-up route is not the last stop in the content region");
  // And every control the list itself draws is reached before it.
  const routeStop = inMain.length - 1;
  const tiles = drawnTiles(document);
  assert.ok(tiles.length > 0, "the grid drew no posts to tab through");
  for (const tile of tiles) {
    const stop = inMain.indexOf(tile);
    assert.ok(stop > -1 && stop < routeStop, "an image post is reached after the follow-up route");
  }
  // Nothing outside the filter stands between it and the list, either.
  const listAt = readingIndex(document, "#profile-feed-status");
  const order = mainOrder(document);
  for (const stop of inMain) {
    if (order.indexOf(stop) > listAt) continue;
    assert.equal(stop.closest("#profile-name-picker"), picker,
      "a control that is not part of the filter stands between it and the list");
  }
});

/* ---------------- the list slot does not move between states --------------- */

// The list's states are drawn into one slot — the status panel that stands in
// for the grid, and the grid itself — and the reader has to find them in the
// same place each time. A relocation is exactly the change that moves some of
// them and leaves the rest behind, because only the populated state is on screen
// while the markup is being edited.
//
// The slot is recorded as the three-block neighbourhood around it rather than as
// an absolute index: src/profile.js withdraws the connecting line when there is
// nothing to connect to, so the absolute index legitimately shifts by one, and
// what has to hold is that the live region, the list and its tiles stay
// adjacent, in that order, under the filter.
const LIST_SLOT = "profile-announcer → profile-feed-status → profile-grid";

function listSlot(document, state) {
  const signature = panelSignature(document);
  const at = signature.indexOf("profile-feed-status");
  assert.ok(at > 0, `${state}: the list's status panel left the results region`);
  assert.equal(document.querySelectorAll("#profile-feed-status").length, 1,
    `${state}: the status region was replaced rather than rewritten`);
  // Only the panel's own preamble stands above the list.
  for (const above of signature.slice(0, at)) {
    assert.ok(["profile-identity", "section-heading list-heading", "feed-connection", "profile-announcer"].includes(above),
      `${state}: "${above}" was inserted between the heading group and the list`);
  }
  // Directly under the filter, in reading order: the heading group that names
  // and orders the list, and then the list.
  assert.ok(readingIndex(document, "#profile-author") < readingIndex(document, "#profile-feed-status"),
    `${state}: the list is read before the filter that chooses it`);
  assert.ok(readingIndex(document, ".section-heading") < readingIndex(document, "#profile-feed-status"),
    `${state}: the ordering label no longer comes before the list it orders`);
  assertErrandFollowsTheList(document, state);
  return signature.slice(at - 1, at + 2).join(" → ");
}

test("the served frame draws the list in its slot under the filter", async (t) => {
  assert.equal(listSlot(await servePeople(t), "as served"), LIST_SLOT);
});

test("a loaded list renders in its slot under the filter, with the errand below it", async (t) => {
  const document = await openPeople(t);
  await waitFor(() => drawnTiles(document).length > 0, "the grid drew a tile");
  assert.equal(listSlot(document, "loaded"), LIST_SLOT);
});

test("an empty feed renders in the list's slot, with the errand below it", async (t) => {
  const document = await openPeople(t, { seed: { posts: [] } });
  assert.equal(drawnTiles(document).length, 0, "the empty state drew a tile");
  assert.equal(document.querySelectorAll(".empty-state").length, 1);
  assert.equal(listSlot(document, "empty"), LIST_SLOT);
});

test("a display name with no image posts renders in the list's slot, with the errand below it", async (t) => {
  const document = await openPeople(t, { search: "?author=Nova" });
  assert.equal(drawnTiles(document).length, 0, "the filtered-empty state drew a tile");
  assert.match(textOf(document.querySelector(".empty-state")), /Nova/,
    "the empty state does not name the display name that has nothing under it");
  assert.equal(listSlot(document, "filtered-empty"), LIST_SLOT);
});

// Whatever People draws for a load it could not finish, it draws THERE. This
// issue does not design that state, and does not touch it: the claim is only
// that it lands in the same container as the other three, under the filter and
// above the errand, and that the one control it offers is reached with the list
// rather than after the errand below it.
test("a failed load renders in the list's slot, and its control is reached with the list", async (t) => {
  // The live route is undeclared, so the harness refuses it the way an offline
  // browser would.
  const document = await openPeople(t, { routes: { [SEED_ROUTE]: { posts: [] } } });
  const status = document.querySelector("#profile-feed-status");
  assert.ok(textOf(status), "the failed load drew nothing at all into the list's slot");
  assert.equal(listSlot(document, "failed"), LIST_SLOT);

  const controls = status.querySelectorAll("button");
  const stops = tabSequence(document).filter((node) => node.closest("#main-content"));
  const errand = stops.indexOf(document.getElementById(ASK_ABOUT_SHIPLOG_ID));
  assert.ok(errand > -1, "failed: the follow-up route is not keyboard reachable");
  for (const control of controls) {
    assert.ok(stops.indexOf(control) > -1 && stops.indexOf(control) < errand,
      "failed: a control the list drew is reached after the follow-up route");
  }
});
