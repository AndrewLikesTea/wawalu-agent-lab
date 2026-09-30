// Where People puts its follow-up errand (#2640).
//
// People answers with pictures. The "Ask about Shiplog" route used to open the
// page: it was the first stop in the content region and the second thing read
// inside <main>, above the display-name filter that chooses the pictures and
// above the pictures themselves. So a reader who came to look at image posts
// met an errand about the product before a single tile, and a keyboard reader
// had to walk past it to reach the filter.
//
// It closes the reading surface now, in the place Social already puts the same
// label: under the list, under the supporting captions, and above the About
// Shiplog band it points at. What this file pins is the placement in the frames
// a reader actually gets — rendered, hydrated, and in each of the four states
// the list passes through — rather than in the served markup alone, because
// src/profile.js rewrites this panel on every render and removes two of its
// blocks while the first fetch is open.
//
// Counts and attributes throughout, and index comparisons rather than element
// comparisons: asserting on a harness element stringifies the whole parsed page
// and outlives the timeout.

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

// The 30-second refresh must not outlive a test, and history.replaceState is not
// something this harness provides.
function quietPage(page) {
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  globalThis.window.history = { replaceState() {} };
  return () => { globalThis.setInterval = savedInterval; page.restore(); };
}

/**
 * The settled page, with the module that owns it, and the teardown that undoes
 * it. Returned rather than registered: a test that opens more than one page has
 * to close them newest first, and per-test hooks run oldest first, which would
 * leave an earlier page's globals installed for whatever ran next.
 */
async function openPeople({ search = "", seed = SEED_FEED, live = { posts: [] } } = {}) {
  const page = await loadPage(PAGE_URL, { location: { search }, routes: { [SEED_ROUTE]: seed, [LIVE_ROUTE]: live } });
  const close = quietPage(page);
  await importPageModule("/profile-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogProfile === "ready", "the first load settles");
  return { document: page.document, close };
}

/** The same page for a test that opens exactly one. */
async function people(t, options = {}) {
  const { document, close } = await openPeople(options);
  t.after(close);
  return document;
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

/** Reading position of a selector inside <main>. Index, never the element. */
const readingIndex = (document, selector) => {
  const target = document.querySelector(selector);
  return mainOrder(document).findIndex((node) => node === target);
};

/** The results panel's own element children, in order. */
const panelBlocks = (document) =>
  document.querySelector(".list-panel").children.filter((node) => node.nodeType === 1);

/** Each block named by the one attribute it carries, so a signature can be
 * compared across states without comparing elements. */
const panelSignature = (document) =>
  panelBlocks(document).map((node) => node.getAttribute("id") ?? node.getAttribute("class") ?? "");

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
    assert.ok(at(ahead) < route,
      `${state}: ${ahead} is read after the follow-up route, not before it`);
  }
  // The caption travels with the label and follows it, so the row reads as a
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

test("the filter and the image-post list are read before the follow-up route", async (t) => {
  // The markup as served, before a line of script has run: a reader whose
  // scripts never arrive gets this order too.
  const served = await loadPage(PAGE_URL, { routes: { [SEED_ROUTE]: SEED_FEED, [LIVE_ROUTE]: { posts: [] } } });
  t.after(() => served.restore());
  assertErrandFollowsTheList(served.document, "as served");

  // And once the module owns the page. This page pre-renders filter copy, so the
  // wait is on drawn tiles rather than on text — skeletons carry the tile class.
  const document = await people(t);
  await waitFor(() => drawnTiles(document).length > 0, "the grid drew a tile");
  assertErrandFollowsTheList(document, "loaded");
});

test("the follow-up route and its explanation are each rendered exactly once", async (t) => {
  const document = await people(t);
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
  // written by a render path would not carry the id.
  assert.equal(textOf(main).split(ASK_ABOUT_SHIPLOG_DESCRIPTION).length - 1, 1,
    "the content region states the follow-up caption more than once");
  // The label reads twice in that text and only twice: once as the control, once
  // as the first three words of the sentence describing it.
  assert.equal(textOf(main).split(ASK_ABOUT_SHIPLOG_LABEL).length - 1, 2,
    "the label is written somewhere other than the control and its own caption");

  // It cost no new rule and no new stop of its own beyond the link.
  assert.equal(captions[0].getAttribute("class"), "hint", "the caption introduced a class of its own");
  assert.equal(routes[0].getAttribute("class"), "text-link", "the route introduced a class of its own");
  assert.equal(tabSequence(document).filter((node) => node === captions[0]).length, 0,
    "the caption became a tab stop");
  // And it moved by markup, not by a tabindex: the stop order is reading order.
  assert.equal(routes[0].getAttribute("tabindex"), null);
  assert.equal(tabSequence(document).filter((node) => Number(node.getAttribute("tabindex")) > 0).length, 0,
    "a positive tabindex is propping up the new order");
});

test("the route still lands on the follow-up form from its new position", async (t) => {
  const document = await people(t);
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

  // What the reader arrives on: the container that holds the topic control they
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
  const document = await people(t);
  const inMain = tabSequence(document).filter((node) => node.closest("#main-content"));

  // The display names open the content region. Read off the fixture's own two
  // names rather than a literal list, and checked to be the filter's controls
  // rather than merely to be first.
  assert.deepEqual(inMain.slice(0, 2).map((node) => node.dataset?.author), ["Bea", "Zed"],
    "the display-name filter is no longer the first thing a keyboard reader reaches");
  assert.equal(inMain[0].closest("#profile-name-picker"), document.querySelector("#profile-name-picker"),
    "the first stop in the content region is not part of the display-name filter");
  // The errand closes it.
  assert.equal(inMain.at(-1).getAttribute("id"), ASK_ABOUT_SHIPLOG_ID,
    "the follow-up route is not the last stop in the content region");
  // And every control the list itself draws is reached before it.
  const routeStop = inMain.length - 1;
  const tiles = drawnTiles(document);
  assert.ok(tiles.length > 0, "the grid drew no posts to tab through");
  for (const tile of tiles) {
    assert.ok(inMain.indexOf(tile) > -1 && inMain.indexOf(tile) < routeStop,
      "an image post is reached after the follow-up route");
  }
});

/* ---------------- the list slot does not move between states --------------- */

// The list's four states are drawn into one slot — the status panel that stands
// in for the grid, and the grid itself — and the reader has to find them in the
// same place each time. A relocation is exactly the change that moves three of
// them and leaves the fourth behind, because only the populated state is on
// screen while the markup is being edited.
function assertListSlotUnderTheFilter(document, state) {
  const signature = panelSignature(document);
  const block = (name) => signature.indexOf(name);

  assert.ok(block("profile-feed-status") > -1, `${state}: the list's status panel left the results region`);
  assert.equal(block("profile-grid"), block("profile-feed-status") + 1,
    `${state}: something was inserted between the list's status panel and its tiles`);
  assert.equal(document.querySelectorAll("#profile-feed-status").length, 1,
    `${state}: the status region was replaced rather than rewritten`);
  // Only the panel's own preamble stands above the list. The blocks in it are
  // not all present in every state — src/profile.js withdraws the connecting
  // line when there is nothing to connect to — so the slot's absolute index
  // legitimately shifts by one, and what has to hold is the neighbourhood: the
  // live region, then the list, then its tiles.
  for (const above of signature.slice(0, block("profile-feed-status"))) {
    assert.ok(["profile-identity", "section-heading list-heading", "feed-connection", "profile-announcer"].includes(above),
      `${state}: "${above}" was inserted between the heading group and the list`);
  }

  // Directly under the filter, in reading order: the heading group that names
  // and orders the list, and then the list. Nothing the reader can reach stands
  // between the filter and it — every stop above the list is the filter's own.
  const at = (selector) => readingIndex(document, selector);
  assert.ok(at("#profile-author") < at("#profile-feed-status"),
    `${state}: the list is read before the filter that chooses it`);
  assert.ok(at(".section-heading") < at("#profile-feed-status"),
    `${state}: the ordering label no longer comes before the list it orders`);
  const picker = document.querySelector("#profile-name-picker");
  for (const stop of tabSequence(document).filter((node) => node.closest("#main-content"))) {
    if (mainOrder(document).indexOf(stop) > at("#profile-feed-status")) continue;
    assert.ok(stop.closest("#profile-name-picker") === picker,
      `${state}: a control that is not part of the filter stands between it and the list`);
  }

  assertErrandFollowsTheList(document, state);
}

test("every list state renders in the same slot under the filter, with the errand below it", async () => {
  // The slot each state put the list in, recorded while that page is still the
  // one the globals belong to. Numbers, so nothing has to be held open.
  const slots = new Map();
  const record = (state, document) => {
    assertListSlotUnderTheFilter(document, state);
    const signature = panelSignature(document);
    const at = signature.indexOf("profile-feed-status");
    slots.set(state, signature.slice(at - 1, at + 2).join(" → "));
  };

  // The shape the four states are compared against, taken off the populated page
  // rather than written down.
  const loaded = await openPeople();
  try {
    await waitFor(() => drawnTiles(loaded.document).length > 0, "the grid drew a tile");
    record("loaded", loaded.document);
  } finally {
    loaded.close();
  }

  // 1. Loading: the live fetch is open and has not answered.
  const pending = await loadPage(PAGE_URL, { routes: { [SEED_ROUTE]: SEED_FEED, [LIVE_ROUTE]: { posts: [] } } });
  const closePending = quietPage(pending);
  const routed = globalThis.fetch;
  globalThis.fetch = (url, init) => (url === LIVE_ROUTE ? new Promise(() => {}) : routed(url, init));
  try {
    await importPageModule("/profile-page.js");
    await waitFor(() => textOf(pending.document.querySelector("#profile-filter-hint")), "the loading helper renders");
    // The seed's tiles are on screen and the live feed has not answered, which
    // is the frame this state is: the filter says so in its own words.
    assert.equal(textOf(pending.document.querySelector("#profile-filter-hint")),
      "Filter image posts by display name becomes available when image posts finish loading.");
    record("loading", pending.document);
  } finally {
    globalThis.fetch = routed;
    closePending();
  }

  // 2. Failed: the live route is undeclared, so the harness refuses it the way
  //    an offline browser would.
  const failed = await loadPage(PAGE_URL, { routes: { [SEED_ROUTE]: { posts: [] } } });
  const closeFailed = quietPage(failed);
  try {
    await importPageModule("/profile-page.js");
    await waitFor(() => failed.document.documentElement.dataset.shiplogProfile === "ready",
      "the failed first load settles");
    assert.match(textOf(failed.document.querySelector("#profile-feed-status")), /Image posts could not be loaded/);
    record("failed", failed.document);
    // The one control the failure offers is inside the slot, so it is reached
    // where the list is rather than after the errand below it.
    const retry = failed.document.querySelector("#profile-feed-status").querySelectorAll("button");
    assert.equal(retry.length, 1, "the failed list offers no single retry");
    const stops = tabSequence(failed.document).filter((node) => node.closest("#main-content"));
    assert.ok(stops.indexOf(retry[0]) < stops.indexOf(failed.document.getElementById(ASK_ABOUT_SHIPLOG_ID)),
      "failed: the retry is reached after the follow-up route");
  } finally {
    closeFailed();
  }

  // 3. Empty: the feed answered, and it holds nothing.
  const empty = await openPeople({ seed: { posts: [] } });
  try {
    assert.equal(drawnTiles(empty.document).length, 0, "the empty state drew a tile");
    assert.equal(empty.document.querySelectorAll(".empty-state").length, 1);
    record("empty", empty.document);
  } finally {
    empty.close();
  }

  // 4. Filtered-empty: this feed has image posts, and the chosen name has none.
  const filtered = await openPeople({ search: "?author=Nova" });
  try {
    assert.equal(drawnTiles(filtered.document).length, 0, "the filtered-empty state drew a tile");
    assert.equal(textOf(filtered.document.querySelector(".empty-state")),
      "The display name “Nova” has no image posts yet.Choose another display name");
    record("filtered-empty", filtered.document);
  } finally {
    filtered.close();
  }

  // And it is the same slot in all five frames, not merely a valid one in each:
  // the reader finds the list where they last left it, between the same two
  // blocks every time.
  assert.deepEqual([...slots.values()], Array.from(slots, () => "profile-announcer → profile-feed-status → profile-grid"),
    `the list slot moved between states: ${[...slots].map(([state, at]) => `${state}: ${at}`).join(" / ")}`);
});
