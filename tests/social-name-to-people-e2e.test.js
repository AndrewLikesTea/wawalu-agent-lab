// A display name in the Social feed, followed to People, end to end.
//
// THE FLOW UNDER TEST (#1649). A reader scrolling Social sees a name they want
// more of, activates it, and lands on People already filtered to that name. Then
// they paste that URL to someone else, whose tab has never been to this site.
// Three properties have to hold across that walk, and each is one test here:
//
//   1. On a SETTLED Social feed the name is a real control — an anchor with a
//      href, the display name in its accessible name — and it is reachable by Tab
//      in the post's own reading order, behind the caption and the image
//      description rather than in front of them.
//   2. That URL, opened COLD, resolves to the forwarded name and not to the
//      landing default: the picker is already on it, the active-filter line names
//      it, and the tiles are newest first. No second selection step.
//   3. A forwarded name with NO image posts gets People's existing empty message
//      and its link back to the whole feed — not a blank list, and not a silent
//      fall back to some other name.
//
// WHY IT IS ONE FILE. The two halves already had coverage of their own:
// tests/social-render.test.js pins the anchor on a bare container, and
// tests/people-landing.test.js pins `?author=` beating the default. Neither walks
// the URL from the surface that mints it to the page that reads it, and that
// seam — Social's href shape versus People's parameter name — is the one place a
// regression can leave both files green and the journey broken.
//
// NOTHING IS COPIED FROM A SCREENSHOT. The People URL under test is built by
// profileHref(), the same function src/social.js calls to build the anchor, and
// test 1 asserts the rendered anchor equals it. So a change to either side reds
// this file by name instead of quietly splitting the two.
//
// NO NETWORK AND NO CLOCK. The feed is generated in this file and served through
// declared routes; the harness throws on any other request. The refresh timers
// both pages start are collected and cleared, so nothing outlives a test.
//
// HARNESS. A DOM double, not a browser: no `assert.equal(node, null)` (it walks
// the whole parsed page), no `querySelectorAll("*")` and no descendant
// selectors — document order is a hand-rolled pre-order walk over `children`,
// which also holds text nodes, so every `dataset` read here is guarded.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { profileHref } from "../src/social-links.js";
// The settled connection sentence is the wait signal on both pages, taken from
// the module that writes it so a reworded status cannot leave this file hanging.
import { connectionStatusLine } from "../src/social.js";
import { profileConnectionLine } from "../src/profile.js";

const SOCIAL_PAGE = new URL("../src/social.html", import.meta.url);
const PEOPLE_PAGE = new URL("../src/profile.html", import.meta.url);
const SEED_ROUTE = "/social-demo-data.json";
const LIVE_ROUTE = "/api/social-posts?limit=100";

// Three display names whose image-post counts disagree with every other order in
// the feed, because the landing default is "the name with the most image posts":
//   Iris Vale   — 3 image posts, so she is what People picks for a visitor who
//                 asked for nobody. Forwarding her would prove nothing.
//   Remy Okafor — 2 image posts, the non-default name test 2 forwards.
//   Tess Nakano — posts, but never a picture: the empty forward in test 3.
const IRIS = "Iris Vale";
const REMY = "Remy Okafor";
const TESS = "Tess Nakano";

const image = (name) => ({ src: `/media/${name.split(" ")[0].toLowerCase()}.svg`, alt: `A drawing signed ${name}`, width: 1200, height: 900 });

// Posts in the demo-seed shape People reads. The timestamp is written out rather
// than derived from the id: a seed id whose tail is not a real day of the month
// silently lands People on "Guest".
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
  post("p-01", IRIS, "01"),
  post("p-02", REMY, "02"),
  post("p-03", TESS, "03", { withImage: false }),
  post("p-04", IRIS, "04"),
  post("p-05", REMY, "05"),
  post("p-06", IRIS, "06"),
  post("p-07", TESS, "07", { withImage: false }),
];

// The same posts in the durable API's shape. Social replaces its seed with
// whatever the live route answers, so the feed under test has to arrive there.
const asApiPost = (entry) => ({
  id: entry.id,
  author: entry.author,
  content: entry.body,
  timestamp: entry.createdAt,
  source: "demo",
  ...(entry.image ? { image: entry.image } : {}),
});

// Newest first, as both feeds sort. Derived from the fixture's own timestamps so
// the expectation cannot drift away from the data it is about.
const newestFirstIds = (author) => FEED
  .filter((entry) => entry.author === author && entry.image)
  .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  .map((entry) => entry.id);

/** Every element under `root`, in the pre-order a reader meets them in. */
function documentOrder(root) {
  const order = [];
  const visit = (node) => {
    for (const child of node.children) {
      if (child.nodeType !== 1) continue;
      order.push(child);
      visit(child);
    }
  };
  visit(root);
  return order;
}

/** Is `node` inside `ancestor`? The harness rejects descendant selectors. */
function within(node, ancestor) {
  for (let walk = node; walk; walk = walk.parentNode) if (walk === ancestor) return true;
  return false;
}

/**
 * A settled Social feed, served from the shipped markup and the shipped wiring.
 *
 * Three waits, not one. `shiplogSocial` is the entry's own load flag; the
 * connection line and the summary sentence are what the page writes once the
 * fetch it started has actually landed. Awaiting only the flag leaves a render in
 * flight that resolves after the globals are torn down and surfaces as an
 * unhandled rejection — green on a quiet laptop, red on a loaded CI box.
 */
async function openSocial(t) {
  const page = await loadPage(SOCIAL_PAGE, {
    storage: {},
    routes: { [SEED_ROUTE]: { posts: [] }, [LIVE_ROUTE]: { posts: FEED.map(asApiPost) } },
  });
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

  await importPageModule("/social-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogSocial === "ready", "the Social page finished its first load");
  await waitFor(() => textOf(document.querySelector("#feed-status")) === connectionStatusLine("live"), "the live feed answered");
  await waitFor(() => textOf(document.querySelector("#feed-summary")).startsWith("Showing"), "the feed settled on a count");
  globalThis.setInterval = realSetInterval;
  return page;
}

/**
 * People, opened cold at a forwarded URL: an empty store, one declared route per
 * fetch the page makes, and nothing in this file having visited People first.
 *
 * Three waits again — the entry's flag, the connection line, and the polite
 * region, which is only written once the grid has been painted for a name.
 */
async function openPeople(t, { search, storage = {} } = {}) {
  const page = await loadPage(PEOPLE_PAGE, {
    storage,
    location: { search },
    routes: { [SEED_ROUTE]: { posts: FEED }, [LIVE_ROUTE]: { posts: [] } },
  });
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

  await importPageModule("/profile-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogProfile === "ready", "the People page finished its first load");
  // The connection line leaves the document when the picker has emptied the
  // grid, so this asks for the settled sentence where there is one and takes its
  // absence otherwise; the announcement below settles either way.
  await waitFor(() => {
    const line = document.querySelectorAll("#profile-status");
    return line.length === 0 || textOf(line[0]) === profileConnectionLine("live");
  }, "the live feed answered");
  await waitFor(() => textOf(document.querySelector("#profile-announcer")).length > 0, "People announced the view it settled on");
  globalThis.setInterval = realSetInterval;
  return page;
}

/** The picker's own entries: real buttons, read off the container's children. */
const chips = (document) => document.querySelector("#profile-author").children.filter((node) => node.tagName === "BUTTON");
const pressedChip = (document) => chips(document).find((chip) => chip.getAttribute("aria-pressed") === "true") ?? null;

/* ------------------------------ 1. the control ----------------------------- */

test("a settled Social post carries its display name as a link to People, in the post's own reading order", async (t) => {
  const page = await openSocial(t);
  const { document } = page;

  const cards = document.querySelectorAll(".post-card");
  assert.equal(cards.length, FEED.length, "the settled feed is not the feed this test served");

  // Every image card, not a lucky first one: the two image posts lay their
  // insides out differently from the text posts, and each image card has to
  // carry the control. The text posts carry the same name as prose — People
  // holds image posts only, so a link from one of them would arrive at nothing
  // (#2149); tests/social-image-post-people-link.test.js pins that half.
  const withImage = FEED.filter((entry) => entry.image);
  const names = document.querySelectorAll(".post-author");
  assert.equal(names.length, withImage.length);
  assert.equal(document.querySelectorAll(".post-name").length, FEED.length - withImage.length);
  for (const link of names) {
    assert.equal(link.tagName, "A", "the display name is not an anchor, so it cannot be forwarded or copied");
    assert.ok(link.href, "the display name is an anchor with no destination");
  }

  // The newest post is Tess's text post; the one under test here is the newest
  // image post, because it is the card whose caption and image description the
  // control must not jump in front of.
  const card = cards.find((node) => node.dataset?.postId === "p-06");
  assert.ok(card, "the fixture's newest image post did not render");
  const link = card.querySelectorAll(".post-author")[0];

  // A real destination, in People's own URL shape — built by the function
  // src/social.js itself calls, so the two cannot drift apart — and the display
  // name is in the accessible name rather than only in the ink.
  assert.equal(link.getAttribute("href"), profileHref(IRIS));
  assert.equal(link.href, "/profile.html?author=Iris%20Vale");
  assert.ok(link.getAttribute("aria-label").includes(IRIS),
    `the control's accessible name does not contain the display name: ${link.getAttribute("aria-label")}`);
  assert.equal(textOf(link), IRIS, "the visible text is not the display name it links to");

  // Tabbable, and the first of the card's two stops: the display name, then the
  // card's one route into the post itself. The caption and the image description
  // stay ordinary prose, so nothing else was inserted into the reading order to
  // carry either control.
  const stops = tabSequence(document).filter((element) => within(element, card));
  assert.deepEqual(stops.map((element) => element.className), ["post-author", "release-detail-link"],
    "the post grew a tab stop of its own, or lost one it had");
  assert.equal(link.getAttribute("tabindex"), null, "the stop is markup order, not a tabindex trick");

  // And it sits where the name already sat: behind the caption and the image
  // description, so a reader walking the card meets the post before the byline.
  const order = documentOrder(card);
  const at = (node) => order.indexOf(node);
  const caption = card.querySelectorAll(".post-caption")[0];
  const description = card.querySelectorAll(".post-image-description")[0];
  assert.equal(textOf(caption), "p-06 from Iris Vale");
  assert.ok(at(caption) < at(description), "the image description was reordered ahead of the caption");
  assert.ok(at(description) < at(link), "the display name jumped ahead of the post it belongs to");

  // The card's second stop, on the real page rather than in a render stub: one
  // named anchor per card, last in the card, opening that card's own post.
  const open = stops[1];
  assert.equal(open.tagName, "A");
  assert.equal(textOf(open), "Open post");
  assert.equal(open.getAttribute("href"), "/post.html?id=p-06&author=Iris+Vale");
  assert.ok(at(link) < at(open), "the action was offered before the post it acts on");
  assert.equal(card.querySelectorAll(".release-detail-link").length, 1,
    "the card names its way into the post more than once");

  // Affordance without colour alone: the site's existing link treatment — an
  // underline on the class itself — and the shared focus ring the global anchor
  // rule already gives every link. No rule of its own, because styles.css has no
  // room for one and this control needs nothing the site does not already ship.
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  assert.match(css, /\.post-author[^{]*\{[^}]*text-decoration:underline/);
  assert.match(css, /button:focus-visible,a:focus-visible \{[^}]*outline:3px solid var\(--focus-ring\)/);
  assert.equal(/outline\s*:\s*(none|0)/.test(css.match(/\.post-author[^{]*\{[^}]*\}/g)?.join("") ?? ""), false,
    "no rule may take the focus outline off the display name");
});

/* ---------------------------- 2. the cold open ----------------------------- */

test("the forwarded People URL opens cold on that display name, filtered and newest first", async (t) => {
  const search = new URL(profileHref(REMY), "https://labs.wawalu.org").search;
  const page = await openPeople(t, { search });
  const { document } = page;

  // The forwarded name, not the landing default. Iris has the most image posts,
  // so she is what this page picks for a visitor who asked for nobody — reaching
  // her here would mean the URL lost to the default.
  assert.equal(pressedChip(document)?.dataset.author, REMY, "the cold open did not resolve to the forwarded name");
  assert.equal(chips(document).filter((chip) => chip.getAttribute("aria-pressed") === "true").length, 1);
  assert.equal(textOf(document.querySelector("#profile-name")), `Showing 2 image posts published as ${REMY}.`);

  // No second selection step: the grid is already Remy's, newest first, and the
  // expected ids are sorted out of the fixture rather than written down.
  const tiles = document.querySelectorAll(".profile-tile");
  assert.deepEqual(tiles.map((tile) => tile.dataset?.postId), newestFirstIds(REMY));
  assert.equal(tiles.length, 2);
  assert.equal(textOf(document.querySelector("#profile-order")), "Newest first");
  assert.equal(document.querySelectorAll(".empty-state").length, 0);
  assert.equal(textOf(document.querySelector("#grid-title")), `${REMY} · 2 image posts`);

  // Nothing was written on the visitor's behalf by arriving, and the session
  // really was cold: the URL is the only thing that chose this name.
  assert.equal(page.storage.getItem("shiplog.social.author"), null);
});

test("a stored name loses to the forwarded one on first paint", async (t) => {
  // The same URL in a tab that HAS been here before, and remembers someone else.
  // The parameter is the source of truth, so the link a colleague sent shows what
  // the sender saw rather than what this browser last looked at.
  const search = new URL(profileHref(REMY), "https://labs.wawalu.org").search;
  const page = await openPeople(t, { search, storage: { "shiplog.social.author": IRIS } });
  const { document } = page;

  assert.equal(pressedChip(document)?.dataset.author, REMY, "the remembered name overrode the forwarded one");
  assert.equal(textOf(document.querySelector("#profile-name")), `Showing 2 image posts published as ${REMY}.`);
  assert.deepEqual(document.querySelectorAll(".profile-tile").map((tile) => tile.dataset?.postId), newestFirstIds(REMY));
});

/* --------------------------- 3. the empty forward -------------------------- */

test("a forwarded name with no image posts is named, and offered the whole feed", async (t) => {
  const search = new URL(profileHref(TESS), "https://labs.wawalu.org").search;
  const page = await openPeople(t, { search });
  const { document } = page;

  // Held, not swapped: Tess has posted twice and never a picture, and People
  // stays on her rather than falling back to the name with images.
  assert.equal(pressedChip(document)?.dataset.author, TESS, "the empty name was silently replaced");
  assert.equal(textOf(document.querySelector("#profile-name")), `${TESS} has no image posts yet.`);
  assert.equal(textOf(document.querySelector("#grid-title")), `${TESS} · 0 image posts`);

  // One explained region rather than a blank list.
  assert.equal(document.querySelectorAll(".profile-tile").length, 0);
  assert.equal(document.querySelectorAll(".profile-grid").length, 0, "an empty list was drawn beside the region explaining it");
  assert.equal(document.querySelectorAll(".empty-state").length, 1);
  const empty = document.querySelector(".empty-state");
  // This feed has image posts, under other display names, so the region says
  // the filter emptied the view rather than that there is nothing to see. The
  // genuinely-empty invitation belongs to a feed with no images at all.
  assert.match(textOf(empty), new RegExp(`The display name “${TESS}” has no image posts yet\\.Publish post`));

  // The way back to the whole feed is the reset that undoes the filter, in the
  // one label this site uses for it.
  const back = empty.querySelectorAll("a");
  assert.equal(back.length, 1, "the filtered view offers recovery no times, or twice");
  assert.equal(textOf(back[0]), "Publish post");
  assert.equal(back[0].getAttribute("href"), "/social.html#post-form");

  // And the name is spoken as well as shown, so a reader who arrived by link is
  // told whose posts are missing rather than that some feature is empty.
  assert.equal(textOf(document.querySelector("#profile-announcer")), `The display name “${TESS}” has no image posts yet.`);
});
