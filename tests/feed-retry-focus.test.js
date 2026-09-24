// Reading a feed that is still arriving, without a screen (#2499).
//
// THE DEFECT THIS FILE HOLDS. Both feeds draw their failure — the message, the
// guidance, and the one control that re-runs the fetch — inside the status
// region. So the render that answers a Retry press is the render that destroys
// the button the press came from. Nothing put the reader anywhere afterwards,
// and a removed focused element drops focus to <body>: the next Tab restarts at
// the top of the document, and the reader who asked for the feed again loses
// the feed, the navigation, and every stop in between. They pressed one button
// and were returned to the front door.
//
// And People's failure was announced by nothing at all. Its status panel is
// rendered content with no live semantics, its announcer only ever spoke for a
// settled load, so a reader who could not see the panel was told the image
// posts were loading and then never told that they were not.
//
// WHAT IS PINNED HERE, per feed: the status node's role and politeness, its
// words at each transition, placeholders that stay out of the accessibility
// tree and out of the tab order, a Retry that Tab reaches and Enter operates,
// and where `document.activeElement` is standing afterwards — on the new Retry
// when the attempt failed again, and on the region's documented landing when it
// did not. Never at document start, which is the assertion the rest exists for.
//
// HARNESS NOTES. Placeholders wear the same class as real cards and tiles, so
// every count of drawn content subtracts the `-skeleton` ones inline. The API
// normaliser drops a post with no `source`, which would land every recovery
// assertion in the empty state with nothing to notice. Removing a node here
// leaves `document.activeElement` pointing at the detached element rather than
// at <body> as a browser would, so "the reader was stranded" is asserted as an
// id that is still in the document. Counts and attributes only: asserting
// against an element node walks the whole parsed page.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, pressKey, pressTab, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { PROFILE_LOADING_ANNOUNCEMENT, PROFILE_RETRY_LABEL } from "../src/profile.js";

const SOCIAL_PAGE = new URL("../src/social.html", import.meta.url);
const PEOPLE_PAGE = new URL("../src/profile.html", import.meta.url);
const POST_PAGE = new URL("../src/post.html", import.meta.url);
const SEED_ROUTE = "/social-demo-data.json";
const LIVE_ROUTE = "/api/social-posts?limit=100";

// `source` is required on the way in: without it the normaliser drops the post,
// the feed lands in its empty state, and "the retry recovered" would come true
// against zero cards.
const apiPost = (id, author, day, { withImage = false } = {}) => ({
  id,
  author,
  content: `${id} from ${author}`,
  timestamp: `2026-07-${day}T09:00:00.000Z`,
  source: "shiplog-web",
  like_count: 0,
  comment_count: 0,
  ...(withImage
    ? { image_url: `/media/${author}.svg`, image_alt: `A drawing signed ${author}`, image_width: 1200, image_height: 900 }
    : {}),
});

const drawnCards = (document) =>
  document.querySelectorAll(".post-card").filter((card) => !card.classList.contains("post-card-skeleton"));
const drawnTiles = (document) =>
  document.querySelectorAll(".profile-tile").filter((tile) => !tile.classList.contains("profile-tile-skeleton"));

const focusedId = (document) => document.activeElement?.getAttribute?.("id") ?? null;
const focusedText = (document) => textOf(document.activeElement ?? { textContent: "" });

// aria-hidden is set once on the placeholder container, which covers every card
// inside it, so the question is about ancestors and not about the node.
function hiddenFromAssistiveTech(node) {
  for (let at = node; at; at = at.parentNode) {
    if (at.getAttribute?.("aria-hidden") === "true") return true;
  }
  return false;
}

// Walk the tab sequence from wherever focus is and report where the named
// control sits in it, or -1. The cap is a runaway guard: pressTab wraps, so a
// control that is not in the sequence would loop forever.
function tabDistanceTo(document, matches) {
  document.activeElement?.blur?.();
  for (let step = 0; step < 200; step += 1) {
    const stop = pressTab(document);
    if (!stop) return -1;
    if (matches(stop)) return step;
  }
  return -1;
}

const isRetry = (label) => (node) => node.tagName === "BUTTON" && textOf(node) === label;

/* -------------------------------- Social ---------------------------------- */

// No live route, so the first fetch fails and the page settles on its failure.
async function bootSocial(t, { routes = {} } = {}) {
  const table = { [SEED_ROUTE]: { posts: [] }, ...routes };
  const page = await loadPage(SOCIAL_PAGE, { routes: table });
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  t.after(() => { globalThis.setInterval = savedInterval; page.restore(); });
  await importPageModule("/social-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogSocial === "ready", "Social's first load settled");
  return { document: page.document, routes: table };
}

test("Social's wait is announced by one node, and its placeholders are in neither tree", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  // The frame a cold visitor meets, before any module runs.
  const status = document.querySelector("#feed-state");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(status.getAttribute("aria-atomic"), "true");
  assert.match(textOf(status), /still loading/);

  // The count line is the same region's second half: one claim, read whole.
  const summary = document.querySelector("#feed-summary");
  assert.equal(summary.getAttribute("aria-live"), "polite");
  assert.equal(summary.getAttribute("aria-atomic"), "true");
  // A place focus can be put, never a stop Tab lands on.
  assert.equal(summary.getAttribute("tabindex"), "-1");
  assert.equal(textOf(summary), "", "a count was claimed before the fetch answered");

  // The placeholders say nothing and are reachable by nothing.
  const placeholders = document.querySelectorAll(".post-card").filter((card) => card.classList.contains("post-card-skeleton"));
  assert.ok(placeholders.length >= 3, `only ${placeholders.length} placeholders fill the pending feed`);
  for (const card of placeholders) {
    assert.ok(hiddenFromAssistiveTech(card), "a placeholder is exposed to assistive technology");
    assert.equal(card.getAttribute("tabindex"), null, "a placeholder carries a tab stop");
    assert.equal(textOf(card), "", "a placeholder carries words");
  }
  assert.equal(tabDistanceTo(document, (node) => hiddenFromAssistiveTech(node)), -1,
    "Tab reaches a node inside the placeholder grid");
});

test("Social's failed feed hands Retry to the keyboard and gives back the line that says what came back", async (t) => {
  const { document, routes } = await bootSocial(t);

  const status = document.querySelector("#feed-state");
  assert.match(textOf(status), /Social posts could not be loaded\./);
  // Meaning in words, not in a colour: the panel names the failure and names
  // the control, and the control is a real button rather than a handler on a div.
  const retry = status.querySelector(".feed-status-action");
  assert.equal(retry.tagName, "BUTTON");
  assert.equal(retry.type, "button");
  assert.equal(retry.disabled, false);
  assert.equal(textOf(retry), "Retry loading Social posts", "the control does not name what it retries");

  // And Tab reaches it: the filters are shut, so nothing dead stands in front.
  assert.ok(tabDistanceTo(document, isRetry("Retry loading Social posts")) >= 0,
    "Retry is not in the tab order of the failed feed");
  assert.equal(focusedText(document), "Retry loading Social posts");

  routes[LIVE_ROUTE] = { posts: [apiPost("live-18", "Zed", "18"), apiPost("live-17", "Ari", "17")] };
  pressKey(document, "Enter");
  await waitFor(() => drawnCards(document).length === 2, "the retried request drew no cards");

  // The button the press came from is gone, and the reader is not.
  assert.equal(document.querySelectorAll(".feed-status-action").length, 0);
  assert.equal(focusedId(document), "feed-summary",
    "a successful retry left focus somewhere other than the region's status line");
  assert.equal(focusedText(document), "Showing 2 posts, newest first.",
    "the landing does not say what the retry produced");

  // Not document start, which is where doing nothing would have put them: the
  // landing is well past the first stop on the page.
  const first = pressTab(document);
  assert.notEqual(first.getAttribute("id"), "feed-summary");
});

test("a Social retry that fails again puts the reader on the new Retry, not at the top of the page", async (t) => {
  const { document } = await bootSocial(t);

  const retry = document.querySelector("#feed-state").querySelector(".feed-status-action");
  retry.focus();
  retry.click();
  // The page returns to "loading" first, so a second failure reads as a second
  // attempt. `shiplogSocial` is already "ready" from the first one and settles
  // nothing here; the panel coming back is the event worth waiting on.
  await waitFor(() => document.querySelectorAll(".feed-status-action").length === 1, "the second attempt never settled");

  const again = document.querySelector("#feed-state").querySelector(".feed-status-action");
  assert.equal(textOf(again), "Retry loading Social posts", "the second failure withdrew the control");
  assert.equal(focusedText(document), "Retry loading Social posts",
    "the reader was not put back on the one control the failed feed offers");
  // The same node, or a fresh one drawn in its place — either way it is the
  // control, and not <body> and not the first stop in the document.
  assert.equal(document.activeElement.tagName, "BUTTON");
});

test("changing a Social filter leaves focus on the control that was changed", async (t) => {
  const { document } = await bootSocial(t, {
    routes: { [LIVE_ROUTE]: { posts: [apiPost("live-18", "Zed", "18"), apiPost("live-17", "Ari", "17")] } },
  });
  await waitFor(() => drawnCards(document).length === 2, "the feed drew its cards");

  const name = document.querySelector("#post-name-filter");
  name.focus();
  // Operated by keyboard, from the control itself: the menu's options are read
  // off the posts, so the reader moves through them rather than being assigned
  // a value the page invented.
  pressKey(document, "ArrowDown");

  assert.equal(drawnCards(document).length, 1, "the filter did not narrow the feed");
  assert.equal(focusedId(document), "post-name-filter",
    "a filter change moved focus off the menu that was operated");
});

/* -------------------------------- People ---------------------------------- */

async function bootPeople(t, { routes = {} } = {}) {
  const table = { [SEED_ROUTE]: { posts: [] }, ...routes };
  const page = await loadPage(PEOPLE_PAGE, { routes: table });
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  globalThis.window.history = { replaceState() {} };
  t.after(() => { globalThis.setInterval = savedInterval; page.restore(); });
  await importPageModule("/profile-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogProfile === "ready", "People's first load settled");
  return { document: page.document, routes: table };
}

test("People announces the wait from the node that was already there, and only that node", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, { routes: { [SEED_ROUTE]: { posts: [] } } });
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  globalThis.window.history = { replaceState() {} };
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  const harnessFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (url !== LIVE_ROUTE) return harnessFetch(url, options);
    const answer = await gate;
    if (answer instanceof Error) throw answer;
    return { ok: true, json: async () => structuredClone(answer) };
  };
  t.after(() => { globalThis.setInterval = savedInterval; page.restore(); });
  const { document } = page;

  await importPageModule("/profile-page.js");
  await waitFor(() => textOf(document.querySelector("#profile-announcer")).length > 0, "the wait was never announced");

  const announcer = document.querySelector("#profile-announcer");
  assert.equal(announcer.getAttribute("aria-live"), "polite");
  assert.equal(announcer.getAttribute("aria-atomic"), "true");
  assert.equal(textOf(announcer), PROFILE_LOADING_ANNOUNCEMENT);

  // One voice. The visible panel carries the same wait in words a reader can
  // see, and carries no live semantics of its own — a region built at the
  // moment its words arrive is a second announcement of one fetch, and an
  // unreliable one.
  const status = document.querySelector("#profile-feed-status");
  assert.equal(status.getAttribute("role"), null);
  assert.equal(status.getAttribute("aria-live"), null);
  assert.equal(status.querySelectorAll('[role="status"]').length, 0,
    "a live region was drawn inside the rendered status panel");
  assert.equal(status.querySelectorAll("[aria-live]").length, 0);
  assert.match(textOf(status), /Image posts are loading\./);

  // The placeholders under it are in neither tree.
  const placeholders = document.querySelectorAll(".profile-tile").filter((tile) => tile.classList.contains("profile-tile-skeleton"));
  assert.ok(placeholders.length >= 3, `only ${placeholders.length} placeholders fill the pending grid`);
  for (const tile of placeholders) {
    assert.ok(hiddenFromAssistiveTech(tile), "a placeholder is exposed to assistive technology");
    assert.equal(tile.getAttribute("tabindex"), null, "a placeholder carries a tab stop");
    assert.equal(textOf(tile), "", "a placeholder carries words");
  }

  open({ posts: [apiPost("live-18", "Zed", "18", { withImage: true })] });
  await waitFor(() => drawnTiles(document).length === 1, "the grid drew no tiles");
  assert.equal(textOf(announcer), "Showing 1 image post by Zed, newest first.",
    "the answer was not announced from the node that announced the wait");
});

test("People says its failure out loud and names the control that undoes it", async (t) => {
  const { document } = await bootPeople(t);

  const announcer = document.querySelector("#profile-announcer");
  assert.equal(textOf(announcer), `Image posts could not be loaded. Select ${PROFILE_RETRY_LABEL}.`,
    "a failed load was announced as nothing, or as something other than a failure");

  const status = document.querySelector("#profile-feed-status");
  assert.match(textOf(status), /Image posts could not be loaded\./);
  const retry = status.querySelector(".feed-status-action");
  assert.equal(retry.tagName, "BUTTON");
  assert.equal(textOf(retry), PROFILE_RETRY_LABEL);
});

test("People's Retry is reachable by Tab and gives focus back to the region that speaks", async (t) => {
  const { document, routes } = await bootPeople(t);

  assert.ok(tabDistanceTo(document, isRetry(PROFILE_RETRY_LABEL)) >= 0,
    "Retry is not in the tab order of the failed grid");

  routes[LIVE_ROUTE] = { posts: [apiPost("live-18", "Zed", "18", { withImage: true })] };
  pressKey(document, "Enter");
  await waitFor(() => drawnTiles(document).length === 1, "the retried request drew no tiles");

  assert.equal(document.querySelectorAll(".feed-status-action").length, 0, "Retry outlived the load it retried");
  assert.equal(focusedId(document), "profile-announcer",
    "a successful retry left focus somewhere other than the region's status node");
  assert.equal(textOf(document.activeElement), "Showing 1 image post by Zed, newest first.",
    "the landing does not say what the retry produced");
  // A landing, not a stop: Tab still starts the page where it always did.
  assert.equal(document.activeElement.getAttribute("tabindex"), "-1");
});

/* ---------------------------- the shared post ----------------------------- */

// Already shipped before this change: src/post-page.js sends focus to the post
// it just resolved, and src/post-detail.js gives that article the tabindex="-1"
// to receive it. Held here because the criterion is the same one for all three
// regions and a page that only sometimes keeps a reader's place is the defect
// in a third of its shape.
test("the shared post keeps the reader in the region across a retry", async (t) => {
  const page = await loadPage(POST_PAGE, { location: { search: "?id=p-image" } });
  t.after(() => page.restore());
  const { document } = page;

  let answer = () => { throw new Error("Posts API unreachable"); };
  globalThis.fetch = async (url) => {
    if (String(url) !== SEED_ROUTE) throw new Error(`Unexpected request: ${url}`);
    return { ok: true, status: 200, json: async () => answer() };
  };

  await importPageModule("/post-page.js");
  await waitFor(() => document.documentElement.dataset.shiplogPostDetail === "ready", "the failed lookup settled");

  const detail = document.querySelector("#post-detail");
  assert.equal(detail.getAttribute("role"), "status");
  assert.equal(detail.getAttribute("aria-live"), "polite");
  assert.equal(detail.getAttribute("aria-atomic"), "true");

  assert.ok(tabDistanceTo(document, isRetry("Retry the shared post")) >= 0,
    "Retry is not in the tab order of the failed post page");

  answer = () => ({
    posts: [{
      id: "p-image",
      author: "Mina Okafor",
      body: "Focus rings landed everywhere.",
      caption: "The middle card, ringed.",
      createdAt: "2026-07-14T09:00:00.000Z",
      likes: 3,
      comments: 1,
    }],
  });
  pressKey(document, "Enter");
  // The loading placeholder wears `.detail-post` too, so the wait is on the
  // panel marker rather than on the class the real article shares with it.
  await waitFor(() => document.querySelectorAll('[data-post-state-panel="loaded"]').length > 0,
    "the retried lookup drew no post");

  assert.equal(document.querySelectorAll(".detail-retry").length, 0, "Retry outlived the lookup it retried");
  assert.equal(document.activeElement.getAttribute("tabindex"), "-1");
  assert.equal(document.activeElement.getAttribute("data-post-state-panel"), "loaded",
    "a successful retry left focus somewhere other than the post it resolved");
});
