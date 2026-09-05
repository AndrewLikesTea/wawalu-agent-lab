// The edge #2149 asks for: an image post in the Social feed, followed to that
// display name's image posts on People, in one activation — and no such link
// anywhere it would arrive at nothing.
//
// WHAT WAS MISSING. The walk itself already existed (#1649): the byline is an
// anchor at /profile.html?author=…, and People reads that parameter at boot. But
// every card carried it, image or not, and People holds image posts and nothing
// else — so a text-only post offered a one-click route to a view that could only
// answer "this name has no image posts yet". The link now belongs to the posts
// that put something at the other end of it, and it says so: "See Ari's image
// posts on People" names the display name and the destination, not just the
// name. tests/social-name-to-people-e2e.test.js walks the same seam for the
// forwarded-URL half; this file is about which cards mint the link at all.
//
// THE INVARIANT, not three examples: every href the settled feed renders is
// followed here and asserted to land on a non-empty People view. A card that
// starts minting links for names with no pictures reds this file by name.
//
// HARNESS NOTES. Skeleton cards and skeleton tiles carry the real card classes,
// so both counts subtract them inline — "the feed loaded" is otherwise satisfied
// by placeholders. Nothing is asserted with assert.equal(node, null): that walks
// the whole parsed page. No `*` selector, no descendant selector, no comma
// group in the render stub. The harness reflects no properties, so `.href` and
// `.tagName` are read as properties and aria-label through getAttribute.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { peopleImagePostsLabel, profileHref } from "../src/social-links.js";
import { connectionStatusLine } from "../src/social.js";

const SOCIAL_PAGE = new URL("../src/social.html", import.meta.url);
const PEOPLE_PAGE = new URL("../src/profile.html", import.meta.url);
const SEED_ROUTE = "/social-demo-data.json";
const LIVE_ROUTE = "/api/social-posts?limit=100";

// Two names with pictures and different counts, so "filtered to one name" is
// distinguishable from "showing everything", and one name that has posted twice
// and never a picture — the case the link must not be offered for.
const ARI = "Ari Mensah";
const REMY = "Remy Okafor";
const TESS = "Tess Nakano";
// A name in neither feed. Nothing in the product mints a link to it; it is what
// a mangled or hand-edited share URL arrives as.
const NOBODY = "Wren Ashby";

const image = (name) => ({
  src: `/media/${name.split(" ")[0].toLowerCase()}.svg`,
  alt: `A drawing signed ${name}`,
  width: 1200,
  height: 900,
});

// The seed shape People reads. The day is written out rather than taken from the
// id: a seed id whose tail is not a real day of the month is dropped at the door
// and takes its display name off the page with it.
const post = (id, author, day, { withImage = true } = {}) => ({
  id,
  author,
  body: `${id} from ${author}`,
  createdAt: `2026-07-${day}T09:00:00.000Z`,
  likes: 0,
  comments: 0,
  ...(withImage ? { image: image(author) } : {}),
});

const FEED = [
  post("p-01", ARI, "01"),
  post("p-02", REMY, "02"),
  post("p-03", TESS, "03", { withImage: false }),
  post("p-04", ARI, "04"),
  post("p-05", ARI, "05"),
  post("p-06", TESS, "06", { withImage: false }),
];

// The durable API's shape. `source` is not decoration: a post without it is
// dropped, and a feed of dropped posts renders as the empty state, where every
// "no link here" assertion below would pass against nothing at all.
const asApiPost = (entry) => ({
  id: entry.id,
  author: entry.author,
  content: entry.body,
  timestamp: entry.timestamp ?? entry.createdAt,
  source: "demo",
  ...(entry.image ? { image: entry.image } : {}),
});

const imagePostIds = (author) => FEED
  .filter((entry) => entry.author === author && entry.image)
  .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  .map((entry) => entry.id);

/** Is `node` inside `ancestor`? The harness rejects descendant selectors. */
function within(node, ancestor) {
  for (let walk = node; walk; walk = walk.parentNode) if (walk === ancestor) return true;
  return false;
}

/** Cards the feed actually drew — the first-load placeholders share the class. */
const drawnCards = (document) =>
  document.querySelectorAll(".post-card").filter((card) => !card.classList.contains("post-card-skeleton"));

/** Tiles People actually drew, placeholders excluded for the same reason. */
const drawnTiles = (document) =>
  document.querySelectorAll(".profile-tile").filter((tile) => !tile.classList.contains("profile-tile-skeleton"));

/** The picker's own entries: real buttons, read off the container's children. */
const chips = (document) => document.querySelector("#profile-author").children.filter((node) => node.tagName === "BUTTON");
const pressedChip = (document) => chips(document).find((chip) => chip.getAttribute("aria-pressed") === "true") ?? null;

/** Collect the page's refresh timers so none of them outlives the test. */
function holdTimers(t, page) {
  const timers = [];
  const realSetInterval = globalThis.setInterval;
  globalThis.setInterval = (...args) => {
    const handle = realSetInterval(...args);
    timers.push(handle);
    return handle;
  };
  t.after(() => {
    for (const handle of timers) clearInterval(handle);
    globalThis.setInterval = realSetInterval;
    page.restore();
  });
  return () => { globalThis.setInterval = realSetInterval; };
}

/**
 * A settled Social feed from the shipped markup and the shipped wiring.
 *
 * Three waits: the entry's load flag, then the two sentences the page only
 * writes once the fetch it started has landed. Awaiting the flag alone leaves a
 * render in flight that resolves after the globals are torn down — green here,
 * an unhandled rejection on a loaded CI box.
 */
async function openSocial(t) {
  const page = await loadPage(SOCIAL_PAGE, {
    storage: {},
    routes: { [SEED_ROUTE]: { posts: [] }, [LIVE_ROUTE]: { posts: FEED.map(asApiPost) } },
  });
  const release = holdTimers(t, page);
  await importPageModule("/social-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogSocial === "ready", "the Social page finished its first load");
  await waitFor(() => textOf(document.querySelector("#feed-status")) === connectionStatusLine("live"), "the live feed answered");
  await waitFor(() => textOf(document.querySelector("#feed-summary")).startsWith("Showing"), "the feed settled on a count");
  release();
  return page;
}

/**
 * People, opened cold at a URL: an empty store, and nothing in this file having
 * visited People first. The wait is on drawn tiles or on the announcement, never
 * on body text — People's authored markup already prints profile prose before a
 * single post has arrived, so a text-based wait returns on turn zero.
 */
async function openPeople(t, { search = "" } = {}) {
  const page = await loadPage(PEOPLE_PAGE, {
    storage: {},
    location: { search },
    routes: { [SEED_ROUTE]: { posts: FEED }, [LIVE_ROUTE]: { posts: [] } },
  });
  const release = holdTimers(t, page);
  await importPageModule("/profile-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogProfile === "ready", "the People page finished its first load");
  await waitFor(() => document.querySelectorAll(".profile-tile-skeleton").length === 0, "the placeholder grid was replaced");
  await waitFor(() => textOf(document.querySelector("#profile-announcer")).length > 0, "People announced the view it settled on");
  release();
  return page;
}

/* --------------------------- 1. which cards link --------------------------- */

test("an image post carries one link to People, named for the name and the destination", async (t) => {
  const { document } = await openSocial(t);

  const cards = drawnCards(document);
  assert.equal(cards.length, FEED.length, "the settled feed is not the feed this test served");

  const card = cards.find((node) => node.dataset?.postId === "p-05");
  assert.ok(card, "the fixture's newest image post did not render");

  // Exactly one, so a reader is not offered the same destination twice.
  const links = card.querySelectorAll(".post-author");
  assert.equal(links.length, 1, "the image post offers its People link no times, or twice");
  const link = links[0];

  // A real anchor with a real destination, built by the function src/social.js
  // itself calls, so the two sides of the URL cannot drift apart.
  assert.equal(link.tagName, "A");
  assert.equal(link.getAttribute("href"), profileHref(ARI));
  assert.equal(link.href, "/profile.html?author=Ari%20Mensah");

  // The accessible name carries the display name AND where activating it goes.
  // Position and ink say neither, and the card's other link is two words that
  // say nothing about People.
  assert.equal(link.getAttribute("aria-label"), `See ${ARI}’s image posts on People`);
  assert.equal(link.getAttribute("aria-label"), peopleImagePostsLabel(ARI));
  // The visible words are inside the accessible name, so a reader who says
  // "Ari Mensah" is speaking a name the control answers to.
  assert.equal(textOf(link), ARI);
  assert.ok(link.getAttribute("aria-label").includes(textOf(link)));

  // Keyboard-reachable as markup, not as a tabindex trick, and the card still
  // reads in the order it read before: the name, then the card's way into the
  // post. Focusables in the card, not a screenshot of it.
  const stops = tabSequence(document).filter((element) => within(element, card));
  assert.deepEqual(stops.map((element) => element.className), ["post-author", "release-detail-link"],
    "the card grew a tab stop of its own, or lost one it had");
  assert.equal(link.getAttribute("tabindex"), null);
  assert.equal(link.classList.contains("post-author"), true,
    "the link is drawn in a style of its own rather than the site's existing underlined name");
});

test("a text-only post offers no People link at all, and keeps its remaining tab stop", async (t) => {
  const { document } = await openSocial(t);

  const card = drawnCards(document).find((node) => node.dataset?.postId === "p-06");
  assert.ok(card, "the fixture's text-only post did not render");

  // Counted, never compared against null: asserting on a harness element walks
  // the whole parsed page and hangs for minutes.
  assert.equal(card.querySelectorAll(".post-author").length, 0,
    "a post with no image links to a People view that can hold nothing");
  assert.equal(card.querySelectorAll("a").filter((node) => (node.getAttribute("href") ?? "").includes("/profile.html")).length, 0,
    "the card reaches People by some other anchor");

  // The name is still there, still first in the byline, as prose.
  const names = card.querySelectorAll(".post-name");
  assert.equal(names.length, 1);
  assert.equal(names[0].tagName, "SPAN");
  assert.equal(textOf(names[0]), TESS);
  assert.equal(names[0].getAttribute("href"), null, "a span was given a destination it cannot be activated at");

  // One stop left — the card's way into the post — and nothing was moved to
  // make room for the stop this card does not have.
  const stops = tabSequence(document).filter((element) => within(element, card));
  assert.deepEqual(stops.map((element) => element.className), ["release-detail-link"]);
});

test("across the whole settled feed, exactly the image posts link to People", async (t) => {
  const { document } = await openSocial(t);

  const withImage = FEED.filter((entry) => entry.image);
  assert.equal(withImage.length, 4, "this fixture stopped covering both kinds of post");
  assert.equal(FEED.length - withImage.length, 2, "this fixture stopped covering text-only posts");
  assert.equal(document.querySelectorAll(".post-author").length, withImage.length);
  assert.equal(document.querySelectorAll(".post-name").length, FEED.length - withImage.length);

  // Every minted href belongs to a name that has pictures. This is the property
  // the whole change exists for, checked against the data rather than a list.
  const hrefs = document.querySelectorAll(".post-author").map((link) => link.getAttribute("href"));
  assert.deepEqual([...new Set(hrefs)].sort(), [profileHref(ARI), profileHref(REMY)].sort());
  for (const href of new Set(hrefs)) {
    const asked = new URLSearchParams(new URL(href, "https://labs.wawalu.org").search).get("author");
    assert.ok(imagePostIds(asked).length > 0, `the feed minted a link to ${asked}, who has no image posts`);
  }
});

/* ------------------------ 2. the destination honours it --------------------- */

test("following the link opens People already filtered to that display name", async (t) => {
  const social = await openSocial(t);
  const card = drawnCards(social.document).find((node) => node.dataset?.postId === "p-02");
  const href = card.querySelectorAll(".post-author")[0].getAttribute("href");

  // The URL the feed actually rendered, not one this test wrote down.
  const { document } = await openPeople(t, { search: new URL(href, "https://labs.wawalu.org").search });

  // The rendered selected value, not a value assigned to a control: the harness
  // accepts any value on a control, so only what the page drew as selected says
  // anything about what a real picker would do.
  assert.equal(pressedChip(document)?.dataset.author, REMY, "People did not open on the forwarded display name");
  assert.equal(chips(document).filter((chip) => chip.getAttribute("aria-pressed") === "true").length, 1);
  assert.equal(textOf(document.querySelector("#grid-title")), `${REMY} · 1 image post`);

  // And the list under that heading is that name's image posts, only those, and
  // there is at least one of them.
  const tiles = drawnTiles(document);
  assert.equal(tiles.length, 1);
  assert.ok(tiles.length > 0);
  assert.deepEqual(tiles.map((tile) => tile.dataset?.postId), imagePostIds(REMY));
  assert.equal(document.querySelectorAll(".empty-state").length, 0);
  assert.equal(document.querySelectorAll(".empty-state-error").length, 0);
});

test("the busier name's link brings all of that name's image posts, newest first", async (t) => {
  const social = await openSocial(t);
  const card = drawnCards(social.document).find((node) => node.dataset?.postId === "p-01");
  const href = card.querySelectorAll(".post-author")[0].getAttribute("href");

  const { document } = await openPeople(t, { search: new URL(href, "https://labs.wawalu.org").search });

  assert.equal(pressedChip(document)?.dataset.author, ARI);
  const tiles = drawnTiles(document);
  assert.equal(tiles.length, 3);
  assert.deepEqual(tiles.map((tile) => tile.dataset?.postId), imagePostIds(ARI));
  assert.equal(textOf(document.querySelector("#profile-order")), "Newest first");
  assert.equal(document.querySelectorAll(".empty-state-error").length, 0);
});

/* ------------------- 3. a name it does not hold, and none ------------------ */

test("a display name People does not hold is not an error", async (t) => {
  const { document } = await openPeople(t, { search: `?author=${encodeURIComponent(NOBODY)}` });

  // Held rather than swapped, the way a forwarded name has always been held on
  // this page: the reader is told whose posts are missing instead of being moved
  // to somebody else's grid without being told. Nothing about it is an error —
  // no error panel, no failure copy — and the empty list is explained where it
  // stands, in the page's existing words.
  assert.equal(document.querySelectorAll(".empty-state-error").length, 0, "an unknown name reads as a failure");
  assert.equal(drawnTiles(document).length, 0);
  assert.equal(document.querySelectorAll(".profile-grid").length, 0, "an empty list was drawn beside the region explaining it");
  assert.equal(document.querySelectorAll(".empty-state").length, 1);
  assert.match(textOf(document.querySelector(".empty-state")), new RegExp(`The display name “${NOBODY}” has no image posts yet\\.`));
  assert.equal(textOf(document.querySelector("#profile-announcer")), `The display name “${NOBODY}” has no image posts yet.`);

  // Nothing in the product sends a reader here: no card in the feed mints a link
  // to a name without pictures, which is the whole point of the change above.
  assert.equal(textOf(document.querySelector("#grid-title")), `${NOBODY} · 0 image posts`);
});

test("no display name at all lands on People's own default, unchanged", async (t) => {
  const { document } = await openPeople(t, { search: "" });

  // The landing name is the one with the most image posts, chosen by the page
  // exactly as it was before this change: a full grid, no error, and no copy
  // that only a preselected visitor would see.
  assert.equal(pressedChip(document)?.dataset.author, ARI, "the default landing name moved");
  const tiles = drawnTiles(document);
  assert.equal(tiles.length, 3);
  assert.deepEqual(tiles.map((tile) => tile.dataset?.postId), imagePostIds(ARI));
  assert.equal(document.querySelectorAll(".empty-state").length, 0);
  assert.equal(document.querySelectorAll(".empty-state-error").length, 0);
});
