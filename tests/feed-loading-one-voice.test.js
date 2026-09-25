// One voice for a first load, and no wait left standing after the answer (#2413).
//
// THE DEFECT. Three pages fetch their content and each one narrated the wait in
// its own shape. Social was the worst of it: the filter row's hint shipped as a
// polite live region saying the display-name menu was waiting on posts, directly
// above a status region that shipped saying the posts were still loading, so one
// open fetch was announced from two nodes — and then a third time, because the
// panel the renderer drew INTO that status region claimed `role="status"` of its
// own, which is a live region nested inside a live region. On top of that
// #feed-state carried a permanent `aria-label="Social feed loading"`: a name for
// one of its four states, written onto the node that outlives all four. With
// `aria-atomic="true"` that name is read with the contents, so the answer to the
// fetch arrived as "Social feed loading: No posts on Social yet." — the wait and
// the empty feed, the two states this page most needs to tell apart, announced
// as one sentence.
//
// WHAT IS PINNED HERE. Per page: exactly one node says the wait while the first
// fetch is open, and once the content paints nothing on the page is still saying
// it. The count is of nodes that ANNOUNCE and have words — `role="status"` is a
// polite live region by definition, so both spellings are counted, and an empty
// region says nothing — which is what makes a second region nested inside the
// first show up as two rather than as one.
//
// The Releases log (src/releases.html, #release-list-status) is the shape this
// follows: one region in the markup before any module runs, updated in place,
// never a second one beside it.
//
// HARNESS NOTES. Skeleton cards carry the same class as real ones, so every wait
// here is on a count of NON-skeleton cards; a raw `.post-card` count is already
// satisfied by the placeholder grid. People's authored markup fakes hydration —
// the filter hint and a display name are in the file — so nothing waits on text
// there either. Counts and attributes only: asserting against an element node
// walks the whole parsed page.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { mountSocialFeed, FEED_LOADING_LINE, noMatchMessage, CLEAR_FILTERS_LABEL } from "../src/social.js";
import { loadingSummaryText } from "../src/profile.js";
import { POST_LOADING_STATUS } from "../src/post-detail.js";

const SOCIAL_PAGE = new URL("../src/social.html", import.meta.url);
const PEOPLE_PAGE = new URL("../src/profile.html", import.meta.url);
const POST_PAGE = new URL("../src/post.html", import.meta.url);
const SEED_ROUTE = "/social-demo-data.json";
const LIVE_ROUTE = "/api/social-posts?limit=100";

const PEOPLE_LOADING_LINE = loadingSummaryText();
const SOCIAL_EMPTY_LINE = "No posts on Social yet.";

// The API's own shape, not the seed's. `source` is required on the way in —
// without it normalizeSocialApiPosts drops the post and the feed lands in its
// empty state, which would make every wait below come true by accident. The id
// tail is the day of the month the post is dated, so it has to be a real day.
const apiPost = (id, author, day, { withImage = false } = {}) => ({
  id,
  author,
  content: `${id} from ${author}`,
  timestamp: `2026-07-${day}T09:00:00.000Z`,
  source: "shiplog-web",
  like_count: 0,
  comment_count: 0,
  ...(withImage
    ? {
      image_url: `/media/${author}.svg`,
      image_alt: `A drawing signed ${author}`,
      image_width: 1200,
      image_height: 900,
    }
    : {}),
});

const LIVE_FEED = {
  posts: [
    apiPost("live-18", "Zed", "18", { withImage: true }),
    apiPost("live-17", "Ari", "17", { withImage: true }),
  ],
};

// Every node on the page that announces and has something to announce.
// `role="status"` implies `aria-live="polite"`, so a node spelled either way is
// counted once; a region that is empty is silent and is not.
function speakingRegions(document) {
  const found = [];
  for (const node of document.querySelectorAll("[aria-live]")) found.push(node);
  for (const node of document.querySelectorAll('[role="status"]')) {
    if (!found.includes(node)) found.push(node);
  }
  return found.filter((node) => textOf(node).trim() !== "");
}

// Of those, the ones talking about a load. Character counters and copy-link
// confirmations announce too, and neither is a claim about the fetch. The word
// boundary is only at the front: "loading", "load" and "loaded" are all this
// page telling a reader about its fetch, while "reloading the page" — the
// connection line's advice once the feed is on screen — is not, and is not
// matched because the boundary falls inside the word.
const speakingOfTheWait = (document) =>
  speakingRegions(document).filter((node) => /\bload/i.test(textOf(node)));

const idsOf = (nodes) => nodes.map((node) => node.getAttribute("id"));

const occurrences = (haystack, needle) => haystack.split(needle).length - 1;

// Cards the page actually drew, as opposed to the shimmer blocks it reserved the
// layout with. The placeholder wears the same class as the real thing, so a raw
// count is green in the middle of the wait this file is about.
const drawnCards = (document) =>
  document.querySelectorAll(".post-card").filter((card) => !card.classList.contains("post-card-skeleton"));
const drawnTiles = (document) =>
  document.querySelectorAll(".profile-tile").filter((tile) => !tile.classList.contains("profile-tile-skeleton"));

/* ------------------------------- Social ---------------------------------- */

test("Social announces its first load from one region, before any module runs", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  const speaking = speakingOfTheWait(document);
  assert.deepEqual(idsOf(speaking), ["feed-state"],
    "the frame a cold visitor meets says the feed is loading from more than one region");
  assert.equal(textOf(document.querySelector("#feed-state")), FEED_LOADING_LINE);

  // The region is named by what is inside it and by nothing else. A state name
  // pinned to the node would be read with every later state as well.
  const status = document.querySelector("#feed-state");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(status.getAttribute("aria-label"), null,
    "the status region carries a name for one of the states it passes through");

  // The filter row describes its shut controls; it does not announce them.
  const hint = document.querySelector("#post-filter-hint");
  assert.equal(hint.getAttribute("aria-live"), null, "the filter hint is a second voice for one fetch");
  assert.equal(hint.getAttribute("role"), null);
});

test("Social's loading panel does not nest a second status inside the status region", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  mountSocialFeed(document, { posts: [], state: "loading" });

  const status = document.querySelector("#feed-state");
  assert.equal(status.querySelectorAll('[role="status"]').length, 0,
    "a live region drawn inside a live region announces one open fetch twice");
  assert.equal(status.querySelectorAll("[aria-live]").length, 0);
  assert.deepEqual(idsOf(speakingOfTheWait(document)), ["feed-state"]);

  // And the shut menus still get the reason in words, through the description
  // the hint has always been, rather than through a region that shouts it.
  for (const id of ["#post-name-filter", "#post-time-filter", "#post-filter-clear"]) {
    assert.equal(document.querySelector(id).getAttribute("aria-describedby"), "post-filter-hint",
      `${id} lost the sentence that says why it cannot be used`);
  }
});

test("once Social's cards paint, nothing on the page is still saying the posts are loading", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, { routes: { [SEED_ROUTE]: { posts: [] }, [LIVE_ROUTE]: LIVE_FEED } });
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  t.after(() => { globalThis.setInterval = savedInterval; page.restore(); });
  const { document } = page;

  await importPageModule("/social-page.js");
  await waitFor(() => drawnCards(document).length > 0, "the feed drew a card");

  assert.equal(occurrences(textOf(document.body), FEED_LOADING_LINE), 0,
    "the wait is still in the rendered text after the posts arrived");
  assert.deepEqual(idsOf(speakingOfTheWait(document)), []);
  // Replaced in place, not left beside the answer: the region that held the wait
  // is the region the answer went into, so there is one of it either way.
  assert.equal(document.querySelectorAll("#feed-state").length, 1);
});

test("Social tells an empty feed apart from a feed that has not answered yet", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, { routes: { [SEED_ROUTE]: { posts: [] }, [LIVE_ROUTE]: { posts: [] } } });
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  t.after(() => { globalThis.setInterval = savedInterval; page.restore(); });
  const { document } = page;

  // The wait first, and the empty state is not standing behind it: "nothing yet"
  // and "nothing at all" are different answers and only one of them is true.
  assert.equal(occurrences(textOf(document.body), SOCIAL_EMPTY_LINE), 0,
    "the page calls itself empty while its first fetch is still open");

  await importPageModule("/social-page.js");
  await waitFor(() => document.documentElement.dataset.shiplogSocial === "ready", "the empty first load settles");

  const status = document.querySelector("#feed-state");
  assert.match(textOf(status), /No posts on Social yet\./);
  assert.equal(occurrences(textOf(document.body), FEED_LOADING_LINE), 0,
    "the wait outlived the answer that replaced it");
  // The whole announcement is the words in the region. An `aria-label` here is
  // read alongside them, and the one this page used to carry said "loading".
  assert.equal(status.getAttribute("aria-label"), null);
  assert.doesNotMatch(textOf(status), /\bloading\b/i);
});

// The third state this file never followed over the wire. Social's three status
// lines are mutually exclusive by construction — feedPhase() returns one phase
// and renderPosts() draws one panel into #feed-state — but every test that
// checked the filtered dead end against the other two mounted the feed directly
// with an already-normalised array. Booting it is what puts the real fetch, the
// real normaliser and the two real menus in the path, and the filtered state is
// the only one of the three a reader reaches by *doing* something, so it is the
// one where a stale line left standing would be a line they just watched appear.
//
// Counted over the whole rendered body, not per region: the defect this file
// exists for was never a region saying the wrong thing, it was a second region
// still saying the old thing somewhere else on the page.
test("Social's three feed states never overlap, from the first fetch through a filter and back", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, { routes: { [SEED_ROUTE]: { posts: [] }, [LIVE_ROUTE]: LIVE_FEED } });
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  t.after(() => { globalThis.setInterval = savedInterval; page.restore(); });
  const { document } = page;

  // The dead end's sentence is derived from what the menu is actually showing,
  // the same way src/social.js derives it, so a reworded option cannot leave
  // this test passing against a sentence the page no longer says.
  const midSentence = (text) => (text ? text[0].toLowerCase() + text.slice(1) : "");
  // The three lines, counted as occurrences in the rendered text. The wait and
  // the never-posted sentence are fixed strings; the dead end's is filled in
  // once the menu it quotes has been read.
  const tally = (noMatchLine) => ({
    loading: occurrences(textOf(document.body), FEED_LOADING_LINE),
    empty: occurrences(textOf(document.body), SOCIAL_EMPTY_LINE),
    noMatch: noMatchLine ? occurrences(textOf(document.body), noMatchLine) : 0,
  });

  // 1. The cold frame, before any module runs: the wait, and only the wait.
  assert.deepEqual(tally(null), { loading: 1, empty: 0, noMatch: 0 },
    "the frame a cold visitor meets carries more than one of the three feed states");

  await importPageModule("/social-page.js");
  await waitFor(() => drawnCards(document).length === 2, "the two live posts painted");
  assert.equal(document.querySelectorAll(".post-card-skeleton").length, 0,
    "counted cards while the feed was still drawing placeholders");

  // 2. Settled with posts: none of the three, because all three are claims about
  // a feed with nothing in it.
  assert.deepEqual(tally(null), { loading: 0, empty: 0, noMatch: 0 },
    "a feed with posts in it is still telling a reader it has none");

  const timeFilter = document.querySelector("#post-time-filter");
  // The harness's select accepts any value; a real one refuses an unlisted
  // option, so the value driven here is checked against what the menu renders.
  const offered = timeFilter.options.map((option) => option.getAttribute("value"));
  assert.ok(offered.includes("hour"), `the past-hour window must be offered; the menu holds ${offered.join(", ")}`);
  const windowLabel = midSentence(textOf(timeFilter.options.find((option) => option.getAttribute("value") === "hour")));
  const noMatchLine = noMatchMessage({ range: windowLabel });
  assert.equal(noMatchLine, "No posts from the past hour.",
    "the dead end no longer quotes the window the menu is showing");

  // 3. Narrowed to zero. These posts are dated in July, so the past-hour window
  // empties the feed without touching what the fetch returned.
  timeFilter.value = "hour";
  timeFilter.dispatchEvent({ type: "change", bubbles: true });
  assert.equal(drawnCards(document).length, 0);
  assert.deepEqual(tally(noMatchLine), { loading: 0, empty: 0, noMatch: 1 },
    "the filtered dead end stands beside the wait or the never-posted sentence");

  // Said by the region the page already owns, and by nothing else: the dead end
  // is the news a screen-reader user gets for changing a menu, so a second node
  // carrying it is a second announcement of one filter change.
  const speaking = speakingRegions(document).filter((node) => textOf(node).includes(noMatchLine));
  assert.deepEqual(idsOf(speaking), ["feed-state"],
    "the dead end is announced from somewhere other than the feed's own live region");
  const status = document.querySelector("#feed-state");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(status.querySelectorAll('[role="status"]').length, 0,
    "a live region drawn inside a live region announces one filter change twice");
  assert.equal(status.querySelectorAll("[aria-live]").length, 0);
  assert.deepEqual(idsOf(speakingOfTheWait(document)), [],
    "something is still talking about the load after the filters answered");

  // 4. And back out through the control the dead end hands over, to none of the
  // three again — the state a reader started in.
  const clear = status.querySelectorAll("button")[0];
  assert.equal(textOf(clear), CLEAR_FILTERS_LABEL);
  clear.click();
  assert.equal(drawnCards(document).length, 2, "clearing did not restore the posts the filter hid");
  assert.deepEqual(tally(noMatchLine), { loading: 0, empty: 0, noMatch: 0 },
    "a state line outlived the filter change that cleared it");
  assert.equal(document.querySelectorAll("#feed-state").length, 1,
    "the region the states share was replaced rather than reused");
});

/* ------------------------------- People ---------------------------------- */

test("once People's tiles paint, nothing on the page is still saying the image posts are loading", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {
    routes: {
      [SEED_ROUTE]: { posts: [] },
      [LIVE_ROUTE]: { posts: [apiPost("live-18", "Zed", "18", { withImage: true })] },
    },
  });
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  globalThis.window.history = { replaceState() {} };
  t.after(() => { globalThis.setInterval = savedInterval; page.restore(); });
  const { document } = page;

  await importPageModule("/profile-page.js");
  await waitFor(() => drawnTiles(document).length > 0, "the grid drew a tile");

  assert.equal(occurrences(textOf(document.body), PEOPLE_LOADING_LINE), 0,
    "the wait is still in the rendered text after the image posts arrived");
  assert.deepEqual(idsOf(speakingOfTheWait(document)), []);
  assert.equal(document.querySelectorAll("#profile-feed-status").length, 1);
});

/* ---------------------------- the shared post ----------------------------- */

test("the shared post page announces its load from one region and replaces it in place", async (t) => {
  const page = await loadPage(POST_PAGE, { location: { search: "?id=p-image" } });
  t.after(() => page.restore());
  const { document } = page;

  // The frame before the module: one region, saying one thing.
  assert.deepEqual(idsOf(speakingOfTheWait(document)), ["post-detail"]);
  const detail = document.querySelector("#post-detail");
  assert.equal(detail.getAttribute("aria-live"), "polite");
  assert.equal(detail.querySelectorAll('[role="status"]').length, 0);
  assert.equal(detail.querySelectorAll("[aria-live]").length, 0);

  globalThis.fetch = async (url) => {
    if (String(url) === SEED_ROUTE) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          posts: [{
            id: "p-image",
            author: "Mina Okafor",
            body: "Focus rings landed everywhere.",
            caption: "The middle card, ringed.",
            createdAt: "2026-07-14T09:00:00.000Z",
            likes: 3,
            comments: 1,
          }],
        }),
      };
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  await importPageModule("/post-page.js");
  await waitFor(() => document.documentElement.dataset.shiplogPostDetail === "ready", "the post page settled");

  assert.equal(occurrences(textOf(document.body), POST_LOADING_STATUS), 0,
    "the wait is still in the rendered text after the post arrived");
  assert.deepEqual(idsOf(speakingOfTheWait(document)), []);
  assert.equal(document.querySelectorAll("#post-detail").length, 1);
  assert.equal(document.querySelectorAll('[data-post-state-panel="loading"]').length, 0);
});
