// Where a keyboard reader stands after pressing a feed's Retry (#2499).
//
// THE DEFECT. Both feeds draw their Retry inside the status region that is
// reporting the failure, and the first thing a retry does is redraw that region
// as the wait. So the button is destroyed under the press: in a browser focus
// falls to <body>, and the reader's next Tab restarts at the top of the document
// — skip link, brand, the whole site nav — before they are anywhere near the
// feed they were trying to load. Nothing on the page says it happened.
//
// WHAT IS PINNED HERE, per feed. The failed state's Retry is a real button, in
// the natural tab order, with no tabindex bookkeeping. Pressing it lands the
// reader on the status region while the re-request is open. A second failure
// leaves them on that region with a fresh Retry inside it, one Tab away. A
// success — where the region is emptied and hidden, and focus on a hidden node
// is focus lost again — hands them the feed's own heading.
//
// The shared post page already did all of this (src/post-page.js's `fromRetry`,
// pinned in post-permalink-states.test.js), and the two feeds are brought up to
// it rather than given a second idiom.
//
// HARNESS NOTES. Removing an element does not blur it here, so "focus left the
// button" would pass green with nothing implemented; every assertion below is on
// where focus LANDED, read as an attribute of document.activeElement. Skeleton
// cards wear the real card class, so drawn content is counted as the cards
// without the -skeleton class. API fixtures carry `source` or the normaliser
// drops them and a "the retry recovered" wait would come true against zero
// cards. Descendant selectors are unreliable, so the region's own buttons are
// found by walking its children. Nothing is asserted against an element node.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { FEED_LOADING_LINE } from "../src/social.js";
import { PROFILE_RETRY_LABEL, loadingSummaryText } from "../src/profile.js";

const SOCIAL_PAGE = new URL("../src/social.html", import.meta.url);
const PEOPLE_PAGE = new URL("../src/profile.html", import.meta.url);
const SEED_ROUTE = "/social-demo-data.json";
const LIVE_ROUTE = "/api/social-posts?limit=100";

const SOCIAL_RETRY_LABEL = "Retry loading Social posts";
const SOCIAL_FAILED_LINE = "Social posts could not be loaded.";
const PEOPLE_FAILED_LINE = "Image posts could not be loaded.";

// The id tail is the day of the month the post is dated, so it has to name a
// real day; `source` is required or normalizeSocialApiPosts drops the record.
const apiPost = (id, author, day, { withImage = false } = {}) => ({
  id,
  author,
  content: `${id} from ${author}`,
  timestamp: `2026-07-${day}T09:00:00.000Z`,
  source: "shiplog-web",
  like_count: 0,
  comment_count: 0,
  ...(withImage
    ? { image_url: "/paint/out.png", image_alt: `A drawing ${author} published`, image_width: 600, image_height: 600 }
    : {}),
});

/** The buttons inside `host`, by walking it: no descendant selectors. */
function buttonsIn(host) {
  const found = [];
  const visit = (node) => {
    for (const child of node?.children ?? []) {
      // Text nodes sit in `children` with a truthy tagName, so the filter is on
      // getAttribute, which only a real element has.
      if (!child.getAttribute) continue;
      if (child.tagName === "BUTTON") found.push(child);
      visit(child);
    }
  };
  visit(host);
  return found;
}

/**
 * What focus is on, as a string. Never the node itself: asserting equality
 * against a harness element walks the whole parsed page for minutes. An id where
 * the markup gives one, otherwise the class, which is how the rendered controls
 * name themselves.
 */
function focusedName(document) {
  const active = document.activeElement;
  if (!active) return "nothing";
  return active.getAttribute?.("id") || active.getAttribute?.("class") || active.tagName || "unnamed";
}

/** Is this node reachable by Tab, rather than only by a script? */
const tabbable = (document, node) => tabSequence(document).includes(node);

const drawnCards = (document) => document.querySelectorAll(".post-card")
  .filter((card) => !card.classList.contains("post-card-skeleton"));
const drawnTiles = (document) => document.querySelectorAll(".profile-tile")
  .filter((tile) => !tile.classList.contains("profile-tile-skeleton"));

/**
 * A page booted with a live feed whose answer this test controls and can change
 * between attempts. The harness's own fetch answers the seed route; the live
 * route is served from `live.answer`, and an Error there is a request that could
 * not be made at all, which is the failure the panel under test reports.
 */
async function boot(t, { page: url, entry, settled, search = "", answer }) {
  const page = await loadPage(url, { location: { search }, routes: { [SEED_ROUTE]: { posts: [] } } });
  const savedInterval = globalThis.setInterval;
  const harnessFetch = globalThis.fetch;
  const live = { answer };
  globalThis.setInterval = () => 0; // The page's own refresh must not outlive the test.
  globalThis.window.history = { replaceState() {} };
  globalThis.fetch = async (route, options) => {
    if (route !== LIVE_ROUTE) return harnessFetch(route, options);
    if (live.answer instanceof Error) throw live.answer;
    return { ok: true, json: async () => structuredClone(live.answer) };
  };
  t.after(() => {
    globalThis.fetch = harnessFetch;
    globalThis.setInterval = savedInterval;
    page.restore();
  });
  await importPageModule(entry);
  const { document } = page;
  await waitFor(() => document.documentElement.dataset[settled] === "ready", "the first load settles");
  return { document, live };
}

const bootSocial = (t, options) => boot(t, {
  page: SOCIAL_PAGE, entry: "/social-page.js", settled: "shiplogSocial", ...options,
});
const bootPeople = (t, options) => boot(t, {
  page: PEOPLE_PAGE, entry: "/profile-page.js", settled: "shiplogProfile", search: "?author=Zed", ...options,
});

/* -------------------------------- Social --------------------------------- */

test("Social's failed feed offers one Retry, and it is a real keyboard stop", async (t) => {
  const { document } = await bootSocial(t, { answer: new Error("Posts API unreachable") });
  const region = document.querySelector("#feed-state");

  assert.match(textOf(region), new RegExp(SOCIAL_FAILED_LINE.replace(".", "\\.")));
  const offered = buttonsIn(region);
  assert.equal(offered.length, 1, "the failed feed offers something other than exactly one Retry");
  const retry = offered[0];
  assert.equal(retry.tagName, "BUTTON");
  // The property, not the attribute: the harness reflects neither onto the other.
  assert.equal(retry.type, "button");
  assert.equal(textOf(retry), SOCIAL_RETRY_LABEL);
  assert.ok(!retry.disabled, "the one control on a failed feed is disabled");
  assert.equal(retry.getAttribute("tabindex"), null, "Retry needed tabindex to be reachable");
  assert.ok(tabbable(document, retry), "Retry is not in the tab order of the failed feed");
});

test("pressing Social's Retry moves the reader to the status region, then to the restored feed", async (t) => {
  const { document, live } = await bootSocial(t, { answer: new Error("Posts API unreachable") });
  const region = document.querySelector("#feed-state");
  const retry = buttonsIn(region)[0];

  retry.focus();
  live.answer = { posts: [apiPost("live-18", "Zed", "18"), apiPost("live-17", "Ari", "17")] };
  retry.click();

  // The wait, with the button gone: the reader is on the region that is saying
  // it, not on the detached node they pressed and not at the top of the page.
  assert.equal(focusedName(document), "feed-state", "the press left focus on a node that is no longer in the document");
  assert.match(textOf(region), new RegExp(FEED_LOADING_LINE.replace(/[.…]/g, "\\$&")));
  // Programmatically focusable only. A status line must not become a tab stop.
  assert.equal(region.getAttribute("tabindex"), "-1");
  assert.ok(!tabbable(document, region), "the status region became a tab stop");

  await waitFor(() => drawnCards(document).length > 0, "the retry drew the posts");
  // The region is emptied and hidden by a successful load, and focus on a hidden
  // node is focus lost, so the reader is handed the feed's own heading.
  assert.equal(focusedName(document), "feed-title", "focus was left on the hidden status region");
  assert.equal(buttonsIn(region).length, 0);
});

test("a second Social failure leaves the reader on the region, one Tab from the fresh Retry", async (t) => {
  const { document } = await bootSocial(t, { answer: new Error("Posts API unreachable") });
  const region = document.querySelector("#feed-state");

  buttonsIn(region)[0].focus();
  buttonsIn(region)[0].click();
  await waitFor(() => buttonsIn(region).length === 1, "the second failure drew its own Retry");

  assert.match(textOf(region), new RegExp(SOCIAL_FAILED_LINE.replace(".", "\\.")));
  assert.equal(focusedName(document), "feed-state", "the reader was moved off the region that reported the second failure");
  const again = buttonsIn(region)[0];
  assert.equal(textOf(again), SOCIAL_RETRY_LABEL);
  assert.ok(tabbable(document, again), "the fresh Retry is not in the tab order");
  assert.equal(drawnCards(document).length, 0);
});

/* -------------------------------- People --------------------------------- */

test("People's failed grid offers one Retry, and it is a real keyboard stop", async (t) => {
  const { document } = await bootPeople(t, { answer: new Error("Posts API unreachable") });
  const region = document.querySelector("#profile-feed-status");

  assert.match(textOf(region), new RegExp(PEOPLE_FAILED_LINE.replace(".", "\\.")));
  const offered = buttonsIn(region);
  assert.equal(offered.length, 1, "the failed grid offers something other than exactly one Retry");
  const retry = offered[0];
  assert.equal(retry.tagName, "BUTTON");
  assert.equal(retry.type, "button");
  assert.equal(textOf(retry), PROFILE_RETRY_LABEL);
  assert.ok(!retry.disabled, "the one control on a failed grid is disabled");
  assert.equal(retry.getAttribute("tabindex"), null, "Retry needed tabindex to be reachable");
  assert.ok(tabbable(document, retry), "Retry is not in the tab order of the failed grid");
});

test("pressing People's Retry moves the reader to the status region, then to the restored grid", async (t) => {
  const { document, live } = await bootPeople(t, { answer: new Error("Posts API unreachable") });
  const region = document.querySelector("#profile-feed-status");
  const retry = buttonsIn(region)[0];

  retry.focus();
  live.answer = { posts: [apiPost("live-18", "Zed", "18", { withImage: true })] };
  retry.click();

  assert.equal(focusedName(document), "profile-feed-status", "the press left focus on a node that is no longer in the document");
  assert.match(textOf(region), new RegExp(loadingSummaryText("Zed").replace(/[.…]/g, "\\$&")));
  assert.equal(region.getAttribute("tabindex"), "-1");
  assert.ok(!tabbable(document, region), "the status region became a tab stop");

  await waitFor(() => drawnTiles(document).length > 0, "the retry drew the image posts");
  assert.equal(focusedName(document), "grid-title", "focus was left on the hidden status region");
  assert.equal(buttonsIn(region).length, 0);
});

test("a second People failure leaves the reader on the region, one Tab from the fresh Retry", async (t) => {
  const { document } = await bootPeople(t, { answer: new Error("Posts API unreachable") });
  const region = document.querySelector("#profile-feed-status");

  buttonsIn(region)[0].focus();
  buttonsIn(region)[0].click();
  await waitFor(() => buttonsIn(region).length === 1, "the second failure drew its own Retry");

  assert.match(textOf(region), new RegExp(PEOPLE_FAILED_LINE.replace(".", "\\.")));
  assert.equal(focusedName(document), "profile-feed-status", "the reader was moved off the region that reported the second failure");
  const again = buttonsIn(region)[0];
  assert.equal(textOf(again), PROFILE_RETRY_LABEL);
  assert.ok(tabbable(document, again), "the fresh Retry is not in the tab order");
  assert.equal(drawnTiles(document).length, 0);
});
