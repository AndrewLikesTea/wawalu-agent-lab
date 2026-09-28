// What Social's Retry actually asks the API for (#2576).
//
// The three states themselves shipped earlier and are pinned elsewhere: the
// post-shaped wait and its three endings in social-feed-skeleton-states.test.js,
// the one-voice status region in feed-loading-one-voice.test.js, the shut filters
// in feed-filter-availability.test.js, where a stranded reader is put in
// feed-retry-focus.test.js. This file holds the half none of them can see, because
// all of them answer one request per load: how many requests a press opens.
//
// A feed that re-requests on a 10-second interval, on every return to the tab, and
// on Retry had no idea whether one of those was already open. Two presses meant two
// fetches; a press landing on top of the interval's fetch meant two fetches whose
// answers could arrive in either order, and the loser wrote its state last. So the
// journey is followed here by request count as well as by what the page says:
// failure, Retry, the same single request, the restored feed, and a second failure
// that comes back to the same labelled panel with a working control.
//
// HARNESS NOTES. Placeholders wear the real card class, so drawn cards are the ones
// without .post-card-skeleton. Every API fixture carries `source` or the normaliser
// drops it and a "posts came back" assertion passes against zero cards. Requests
// are held open one at a time through a queue of gates — the harness's own fetch
// answers synchronously and cannot hold anything open — and each gate is only
// answered after waitFor has seen the request it belongs to open, so a count is
// never read before the page has had the chance to make it wrong. Nothing here is
// compared against an element: counts, attributes and text only.
//
// It cannot show a focus ring, a contrast ratio or a pointer, so what it does show
// is that the control is a real button, keyboard-reachable in the document's tab
// sequence, disabled through the attribute rather than through a fill, and named in
// words that are not either of the page's other two feed sentences.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const SOCIAL_PAGE = new URL("../src/social.html", import.meta.url);
const SEED_ROUTE = "/social-demo-data.json";
const LIVE_ROUTE = "/api/social-posts?limit=100";

const FAILURE_LINE = "Social posts could not be loaded.";
const LOADING_LINE = "Posts are loading.";
// The two sentences the failed panel must not borrow: the connection line and the
// genuine zero-post state both mean something else on this page.
const CONNECTION_LINE = "New posts will appear here on their own.";
const NO_POSTS_LINE = "No posts on Social yet.";

const apiPost = (id, author, day) => ({
  id,
  author,
  content: `${id} from ${author}`,
  timestamp: `2026-07-${day}T09:00:00.000Z`,
  source: "shiplog-web",
  like_count: 0,
  comment_count: 0,
});

const LIVE_POSTS = [apiPost("live-21", "Zed", "21"), apiPost("live-20", "Ari", "20"), apiPost("live-19", "Bea", "19")];

const skeletons = (document) => document.querySelectorAll(".post-card")
  .filter((card) => card.classList.contains("post-card-skeleton"));
const drawnCards = (document) => document.querySelectorAll(".post-card")
  .filter((card) => !card.classList.contains("post-card-skeleton"));
const stateText = (document) => textOf(document.querySelector("#feed-state"));
const retryButton = (document) => document.querySelector(".feed-status-action");
const occurrences = (haystack, needle) => haystack.split(needle).length - 1;

// The feed's two menus, by id, so a disabled assertion names the control the
// label names.
const filterIds = ["post-name-filter", "post-time-filter"];

/** Is `node` inside `host`? An ancestor walk: descendant selectors throw here. */
const inside = (node, host) => {
  for (let walker = node; host && walker; walker = walker.parentNode) {
    if (walker === host) return true;
  }
  return false;
};

/** Let queued microtasks and already-resolved promises run before reading state. */
const flush = async () => { for (let turn = 0; turn < 8; turn += 1) await new Promise((resolve) => setImmediate(resolve)); };

// One page, its interval silenced, and a live route whose requests queue up as
// gates instead of answering. `attempts` grows by one entry per request the page
// opens, which is the number this file exists to hold.
async function bootSocial(t) {
  const page = await loadPage(SOCIAL_PAGE, { routes: { [SEED_ROUTE]: { posts: [] } } });
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  t.after(() => { globalThis.setInterval = savedInterval; page.restore(); });
  const attempts = [];
  const harnessFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (url !== LIVE_ROUTE) return harnessFetch(url, options);
    let open;
    const gate = new Promise((resolve) => { open = resolve; });
    attempts.push(open);
    const answer = await gate;
    if (answer instanceof Error) throw answer;
    return { ok: true, json: async () => structuredClone(answer) };
  };
  await importPageModule("/social-page.js");
  const answer = async (index, value) => {
    await waitFor(() => attempts.length > index, `live request ${index + 1} opens`);
    attempts[index](value);
    await flush();
  };
  return { document: page.document, attempts, answer };
}

const settled = (document) => waitFor(() => document.documentElement.dataset.shiplogSocial === "ready",
  "the first live fetch settles");

test("a failed Social load says so in its own words and offers one keyboard-reachable Retry", async (t) => {
  const { document, attempts, answer } = await bootSocial(t);
  await answer(0, new Error("Posts API unreachable"));
  await settled(document);

  assert.equal(attempts.length, 1, "the first load opened more than one request");
  // The failure is stated, and it is a third sentence rather than either of the
  // two the page already uses for other news.
  const panel = stateText(document);
  assert.match(panel, /Social posts could not be loaded\./);
  assert.equal(occurrences(panel, CONNECTION_LINE), 0, "the failure borrowed the connection line");
  assert.equal(occurrences(panel, NO_POSTS_LINE), 0, "the failure borrowed the zero-post line");
  // And it says what survived, so the panel is not a dead end.
  assert.match(panel, /Your filters and anything in the composer are unchanged\./);
  assert.equal(skeletons(document).length, 0, "a placeholder is shimmering beside the failure");
  assert.equal(document.querySelectorAll(".empty-state-error").length, 1);

  const retry = retryButton(document);
  assert.equal(retry.tagName, "BUTTON", "Retry is not a button");
  // The harness reflects no properties, so `type` is read off the property.
  assert.equal(retry.type, "button");
  assert.equal(retry.textContent, "Retry loading Social posts");
  assert.ok(tabSequence(document).includes(retry), "Retry is not in the page's tab sequence");

  // The menus are shut through the attribute and said to be shut in words.
  for (const id of filterIds) {
    const control = document.querySelector(`#${id}`);
    assert.equal(control.disabled, true, `${id} is still operable on a failed feed`);
    assert.equal(control.getAttribute("aria-disabled"), "true", `${id} is shut with no mark in the markup`);
  }
  assert.match(textOf(document.querySelector("#post-filter-hint")), /become available when posts finish loading\.$/);
});

test("Retry re-runs the same request, re-announces the wait, and lands the real posts", async (t) => {
  const { document, attempts, answer } = await bootSocial(t);
  await answer(0, new Error("Posts API unreachable"));
  await settled(document);

  const retry = retryButton(document);
  retry.focus();
  pressEnter(document);
  await flush();

  // The wait is back — a second failure has to read as a second attempt rather
  // than a button that did nothing — and the placeholders are back with it.
  assert.equal(stateText(document), LOADING_LINE, "the retried wait is not announced");
  assert.ok(skeletons(document).length >= 3, "the retried wait draws no placeholders");
  assert.equal(document.querySelectorAll(".empty-state-error").length, 0, "the failure panel outlived the retry");
  assert.equal(attempts.length, 2, `Retry opened ${attempts.length - 1} requests instead of one`);

  await answer(1, { posts: LIVE_POSTS });
  await waitFor(() => drawnCards(document).length === LIVE_POSTS.length, "the recovered posts paint");

  assert.equal(skeletons(document).length, 0, "a placeholder stayed beside the recovered posts");
  assert.equal(document.querySelectorAll(".post-grid-skeleton").length, 0);
  // No new endpoint: the recovery came from the same route the first load used.
  assert.equal(attempts.length, 2, "the recovery opened a request nobody asked for");
  // And the menus work again.
  for (const id of filterIds) {
    const control = document.querySelector(`#${id}`);
    assert.equal(control.disabled, false, `${id} is still shut over a feed that loaded`);
    assert.equal(control.getAttribute("aria-disabled"), null, `${id} is marked disabled over a feed that loaded`);
  }
});

test("Retry pressed twice opens one request and draws each post once", async (t) => {
  const { document, attempts, answer } = await bootSocial(t);
  await answer(0, new Error("Posts API unreachable"));
  await settled(document);

  // The press destroys the control it came from, so a second press only reaches
  // the handler through the node the reader was already standing on — key repeat
  // on Enter, a double-click delivered before the render. Held here by clicking
  // the captured node twice, which is that window exactly.
  const retry = retryButton(document);
  retry.click();
  retry.click();
  await flush();

  assert.equal(attempts.length, 2, `two presses opened ${attempts.length - 1} requests`);

  await answer(1, { posts: LIVE_POSTS });
  await waitFor(() => drawnCards(document).length > 0, "the recovered posts paint");

  assert.equal(drawnCards(document).length, LIVE_POSTS.length, "a post was drawn twice");
  assert.equal(document.querySelectorAll(".post-grid").length - document.querySelectorAll(".post-grid-skeleton").length,
    1, "the retry left a second grid of cards behind");
  assert.equal(attempts.length, 2, "a second request was still open after the feed came back");
});

test("a retry that fails again returns to the labelled panel with a control that still works", async (t) => {
  const { document, attempts, answer } = await bootSocial(t);
  await answer(0, new Error("Posts API unreachable"));
  await settled(document);

  retryButton(document).click();
  await answer(1, new Error("Posts API still unreachable"));
  await waitFor(() => stateText(document).includes(FAILURE_LINE), "the second failure is stated");

  assert.equal(attempts.length, 2);
  assert.equal(skeletons(document).length, 0, "a placeholder is shimmering beside the second failure");
  assert.equal(document.querySelectorAll(".feed-status-action").length, 1, "the second failure offers Retry twice or not at all");
  const again = retryButton(document);
  assert.ok(tabSequence(document).includes(again), "the second failure's Retry is not reachable by Tab");

  // A third press is a third request, because nothing is open to join.
  again.click();
  await flush();
  assert.equal(attempts.length, 3, "the reader cannot try again after a second failure");
  await answer(2, { posts: LIVE_POSTS });
  await waitFor(() => drawnCards(document).length === LIVE_POSTS.length, "the third attempt paints");
  assert.equal(stateText(document), "", "the failure panel outlived the load that fixed it");
});

test("a retry that succeeds leaves the reader exactly where they were standing", async (t) => {
  const { document, answer } = await bootSocial(t);
  await answer(0, new Error("Posts API unreachable"));
  await settled(document);

  // Somebody who pressed Retry and then moved on, or who never had focus in the
  // panel at all. The shared placement only rescues a reader whose node has been
  // taken out from under them (src/feed-status.js), and a reader standing on a
  // control of their own choosing is not one of those.
  const feedState = document.querySelector("#feed-state");
  const elsewhere = tabSequence(document).find((stop) => !inside(stop, feedState));
  assert.ok(elsewhere, "the failed page offers no stop outside the status region");
  // Identity is carried on an attribute rather than compared element to element:
  // a failed comparison against a harness node walks the whole parsed page.
  elsewhere.setAttribute("data-retry-witness", "chosen");
  elsewhere.focus();
  const before = elsewhere.focusCount;
  retryButton(document).click();
  await answer(1, { posts: LIVE_POSTS });
  await waitFor(() => drawnCards(document).length === LIVE_POSTS.length, "the recovered posts paint");

  assert.equal(document.activeElement?.getAttribute("data-retry-witness"), "chosen",
    "the recovery moved the reader off the control they chose");
  assert.equal(elsewhere.focusCount, before, "the reader's own control was focused again behind their back");
});

test("the feed states its order once, in the summary, at every stage of the retry journey", async (t) => {
  const { document, answer } = await bootSocial(t);
  const panel = () => textOf(document.querySelector(".list-panel"));
  const orderClaims = () => occurrences(panel(), ", newest first.");

  await answer(0, new Error("Posts API unreachable"));
  await settled(document);
  assert.equal(orderClaims(), 0, "a failed feed claims an order for posts it does not have");

  retryButton(document).click();
  await flush();
  assert.equal(orderClaims(), 0, "a loading feed claims an order for posts it does not have");

  await answer(1, { posts: LIVE_POSTS });
  await waitFor(() => drawnCards(document).length === LIVE_POSTS.length, "the recovered posts paint");
  assert.equal(orderClaims(), 1, "the recovered feed states its order more than once, or not at all");
  assert.equal(textOf(document.querySelector("#feed-summary")), "Showing 3 posts, newest first.");
});

// The treatments this harness cannot draw, asserted where they are declared. A
// rendered page is still the only place the ring and the contrast can be seen.
test("the failed panel's control and the wait's placeholders are drawn from existing tokens", async () => {
  const { readFile } = await import("node:fs/promises");
  const styles = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  // Retry is a plain button, so the page's one button focus ring covers it.
  assert.match(styles, /button:focus-visible[^}]*outline:3px solid var\(--focus-ring\)/,
    "buttons no longer take the shared focus ring, so Retry may have none");
  assert.match(styles, /\.skeleton-line\b/, "the placeholder line treatment is gone from the stylesheet");
  assert.match(styles, /\.post-card-skeleton\b/, "the placeholder card treatment is gone from the stylesheet");
});
