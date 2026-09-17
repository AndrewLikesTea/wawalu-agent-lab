// A display name on the shared post page, followed to People, end to end.
//
// THE FLOW UNDER TEST (#2428). Somebody is sent a permalink. They read the post,
// want more from the same name, and take the name — or the People exit beside
// it — to People, which opens already narrowed to that display name. When the
// name has no image posts People says so under that name rather than showing
// somebody else's pictures.
//
// WHY THIS FILE EXISTS. Both halves already ship and both halves already have
// coverage of their own: tests/post-permalink-states.test.js pins the href the
// permalink mints (`.detail-author-link` and `#post-people`), and
// tests/people-requested-name.test.js and tests/people-landing.test.js pin what
// People does with `?author=`. Neither walks the URL from the page that writes
// it to the page that reads it, so the seam between them — the permalink's URL
// shape versus People's parameter name — is the one place a regression can
// leave both files green and the journey broken. Social's half of the same
// journey has had that walk since #1649 (tests/social-name-to-people-e2e.test.js);
// the permalink's half did not.
//
// NOTHING IS COPIED FROM A SCREENSHOT. The expected URL is built by
// profileHref(), the function src/post-detail.js itself calls, and the name is
// read back out of the rendered anchor by requestedProfileAuthor() — the
// function src/profile-page.js calls. So the two halves are asserted against
// each other rather than against a string written down here, and a rename on
// either side reds this file by name instead of quietly splitting the journey.
//
// NO NETWORK AND NO CLOCK. The feed is generated in this file and served
// through declared routes; the harness throws on any other request. People's
// 30-second refresh timer is collected and cleared, so nothing outlives a test.
//
// HARNESS. A DOM double, not a browser: no `assert.equal(node, null)` (it walks
// the whole parsed page), no descendant selectors, and `children` holds text
// nodes, so every `dataset` read here is guarded. Loading placeholders carry
// `.profile-tile` too, so tiles are counted with the skeletons excluded.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { profileHref, requestedProfileAuthor } from "../src/social-links.js";
import { profileConnectionLine } from "../src/profile.js";

const POST_PAGE = new URL("../src/post.html", import.meta.url);
const PEOPLE_PAGE = new URL("../src/profile.html", import.meta.url);
const SEED_ROUTE = "/social-demo-data.json";
const LIVE_ROUTE = "/api/social-posts?limit=100";

// Three display names whose image-post counts disagree, because People's
// landing default is "the name with the most image posts":
//   Iris Vale   — 3 pictures, so she is what People picks for a visitor who
//                 asked for nobody. Arriving at her proves the link was lost.
//   Remy Okafor — 2 pictures, the non-default name the permalink forwards.
//   Tess Nakano — has posted, never a picture: the empty forward at the end.
const IRIS = "Iris Vale";
const REMY = "Remy Okafor";
const TESS = "Tess Nakano";

const image = (name) => ({ src: `/media/${name.split(" ")[0].toLowerCase()}.svg`, alt: `A drawing signed ${name}`, width: 1200, height: 900 });

// Posts in the demo-seed shape both pages read. The timestamp is written out
// rather than derived from the id: a seed id whose tail is not a real day of
// the month silently lands People on "Guest".
const post = (id, author, day, { withImage = true } = {}) => ({
  id,
  author,
  body: `${id} from ${author}`,
  caption: withImage ? `A picture ${author} posted` : null,
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

// Newest first, as People sorts. Derived from the fixture's own timestamps so
// the expectation cannot drift away from the data it is about.
const newestFirstIds = (author) => FEED
  .filter((entry) => entry.author === author && entry.image)
  .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  .map((entry) => entry.id);

/** The query string of a page-relative href, the way a browser would open it. */
const searchOf = (href) => new URL(href, "https://labs.wawalu.org").search;

/**
 * The accessible name of a link that names itself with its own words. Asserted
 * as well as read: a label attribute would silently win over the text, so a
 * link whose words stopped naming the display name could still pass.
 */
function accessibleName(link, where) {
  for (const attribute of ["aria-label", "aria-labelledby", "title"]) {
    assert.equal(link.getAttribute(attribute), null,
      `${where}: the link names itself with ${attribute} instead of visible words`);
  }
  return textOf(link);
}

/** Tiles People actually drew. First-load placeholders carry .profile-tile too. */
const drawnTiles = (document) => document
  .querySelectorAll(".profile-tile")
  .filter((tile) => !tile.classList.contains("profile-tile-skeleton"));

/** The picker's own entries: real buttons, read off the container's children. */
const chips = (document) => document.querySelector("#profile-author").children.filter((node) => node.tagName === "BUTTON");
const pressedChip = (document) => chips(document).find((chip) => chip.getAttribute("aria-pressed") === "true") ?? null;

/**
 * The shared post page, opened cold at a permalink, from the shipped markup and
 * the shipped wiring. The seed answers because the fixture ids are not UUIDs,
 * which is the shape that decides src/post-page.js does not ask the API.
 */
async function openPost(t, id) {
  const page = await loadPage(POST_PAGE, {
    location: { search: `?id=${encodeURIComponent(id)}` },
    routes: { [SEED_ROUTE]: { posts: FEED } },
  });
  t.after(() => page.restore());
  await importPageModule("/post-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "ready", `the permalink for ${id} settled`);
  return page;
}

/**
 * The permalink's own answer to "where does this name go?", taken from the
 * rendered anchor rather than composed here — and the page is torn down before
 * the caller opens People with it, because these page doubles install globals
 * and the newest one has to come off first.
 */
async function mintedPeopleHref(id, selector) {
  const page = await loadPage(POST_PAGE, {
    location: { search: `?id=${encodeURIComponent(id)}` },
    routes: { [SEED_ROUTE]: { posts: FEED } },
  });
  try {
    await importPageModule("/post-page.js");
    await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "ready", `the permalink for ${id} settled`);
    return page.document.querySelector(selector).getAttribute("href");
  } finally {
    page.restore();
  }
}

/**
 * People, opened cold at a forwarded URL: an empty store, one declared route
 * per fetch the page makes, and nothing in this file having visited People
 * first.
 *
 * Three waits, not one. The entry's own flag, the connection line, and the
 * polite region, which is only written once the grid has been painted for a
 * name. Awaiting only the flag leaves a render in flight that resolves after
 * the globals are torn down and surfaces as an unhandled rejection — green on a
 * quiet laptop, red on a loaded CI box.
 */
async function openPeople(t, search) {
  const page = await loadPage(PEOPLE_PAGE, {
    storage: {},
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
  // grid, so this asks for the settled sentence where there is one and takes
  // its absence otherwise; the announcement below settles either way.
  await waitFor(() => {
    const line = document.querySelectorAll("#profile-status");
    return line.length === 0 || textOf(line[0]) === profileConnectionLine("live");
  }, "the live feed answered");
  await waitFor(() => textOf(document.querySelector("#profile-announcer")).length > 0, "People announced the view it settled on");
  globalThis.setInterval = realSetInterval;
  return page;
}

/* ------------------------- 1. the two routes onward ------------------------ */

test("a loaded permalink mints one People URL for its display name, and People's own reader parses the name back out of it", async (t) => {
  const page = await openPost(t, "p-05");
  const { document } = page;

  const expected = profileHref(REMY);
  const byline = document.querySelector(".detail-author-link");
  const exit = document.querySelector("#post-people");

  // The name in the post is the route. Its text is the display name itself, so
  // a screen reader's list of links can say whose posts each one leads to.
  assert.equal(byline.tagName, "A", "the display name is not an anchor, so it cannot be forwarded or copied");
  assert.equal(accessibleName(byline, "the byline"), REMY);
  assert.equal(byline.getAttribute("href"), expected, "the byline invented a URL shape of its own");

  // And the standing exit beside it goes to the same place under words that
  // name both the person and the destination.
  assert.equal(exit.hidden, false, "the People exit is withheld from a post that loaded");
  assert.equal(exit.getAttribute("href"), expected, "the two routes to People disagree about where they go");
  assert.ok(accessibleName(exit, "the People exit").includes(REMY),
    "the People exit does not say whose posts it leads to");

  // THE SEAM. The key People reads is the key the permalink writes, asserted by
  // handing People's own reader what the page actually rendered.
  for (const [where, link] of [["the byline", byline], ["the People exit", exit]]) {
    assert.equal(requestedProfileAuthor(searchOf(link.getAttribute("href"))), REMY,
      `${where}: People cannot read the display name out of the URL this page minted`);
  }

  // Both are things a keyboard reader can actually reach.
  const sequence = tabSequence(document);
  assert.ok(sequence.includes(byline), "the display name is not reachable by keyboard");
  assert.ok(sequence.includes(exit), "the People exit is not reachable by keyboard");
});

test("a display name that needs encoding survives the round trip intact", async (t) => {
  // One space, one ampersand, one non-ASCII letter and one curly apostrophe:
  // between them they cover every way a name can be mangled by being encoded
  // twice, or not at all, on the way into a query string.
  const awkward = "Ada Ø’Neil & Co";
  const page = await openPost(t, "p-02");
  const { document } = page;

  // The rendered name is the one the fixture carries; the awkward one is put
  // through the same two functions the two pages use, in the same order.
  assert.equal(textOf(document.querySelector(".detail-author-link")), REMY);
  const href = profileHref(awkward);
  assert.equal(href, `/profile.html?author=${encodeURIComponent(awkward)}`, "the name is not encoded exactly once");
  assert.equal(requestedProfileAuthor(searchOf(href)), awkward, "the name did not survive the round trip");
});

/* ---------------------------- 2. the cold open ----------------------------- */

test("the URL the permalink minted opens People on that display name, already narrowed", async (t) => {
  const href = await mintedPeopleHref("p-05", ".detail-author-link");
  const page = await openPeople(t, searchOf(href));
  const { document } = page;

  // The forwarded name, not the landing default. Iris has the most image posts,
  // so she is what this page picks for a visitor who asked for nobody; reaching
  // her here would mean the URL lost to the default.
  assert.equal(pressedChip(document)?.dataset.author, REMY, "the cold open did not resolve to the forwarded name");
  assert.equal(chips(document).filter((chip) => chip.getAttribute("aria-pressed") === "true").length, 1);
  assert.equal(textOf(document.querySelector("#grid-title")), `${REMY} · 2 image posts`);

  // No second selection step: the grid is already Remy's, newest first, and the
  // expected ids are sorted out of the fixture rather than written down.
  assert.deepEqual(drawnTiles(document).map((tile) => tile.dataset?.postId), newestFirstIds(REMY));
  assert.equal(document.querySelectorAll(".profile-tile-skeleton").length, 0, "placeholders are still standing behind the answer");
  assert.equal(document.querySelectorAll(".empty-state").length, 0);
  assert.ok(textOf(document.querySelector("#profile-announcer")).includes(REMY),
    "the view was announced under a name nobody asked for");

  // The session really was cold: the URL is the only thing that chose this name.
  assert.equal(page.storage.getItem("shiplog.social.author"), null);
});

test("the People exit leads to the same narrowed view as the display name beside it", async (t) => {
  const fromExit = await mintedPeopleHref("p-05", "#post-people");
  const page = await openPeople(t, searchOf(fromExit));
  const { document } = page;

  assert.equal(pressedChip(document)?.dataset.author, REMY);
  assert.deepEqual(drawnTiles(document).map((tile) => tile.dataset?.postId), newestFirstIds(REMY));
});

/* --------------------------- 3. the empty forward -------------------------- */

test("a display name with no image posts is named on arrival rather than replaced", async (t) => {
  // Tess has posted twice and never a picture, so the permalink for one of
  // those posts forwards a name People holds nothing for.
  const href = await mintedPeopleHref("p-07", ".detail-author-link");
  assert.equal(requestedProfileAuthor(searchOf(href)), TESS, "the permalink forwarded somebody else's name");

  const page = await openPeople(t, searchOf(href));
  const { document } = page;

  // Held, not swapped. This is the branch that used to land on whichever name
  // had the most pictures — or on "Guest" — and then tell the reader it had
  // preselected that name for them.
  assert.equal(pressedChip(document)?.dataset.author, TESS, "the empty name was silently replaced");
  assert.equal(textOf(document.querySelector("#grid-title")), `${TESS} · 0 image posts`);

  // One explained region rather than a blank list, and it names the name that
  // was asked for.
  assert.equal(drawnTiles(document).length, 0, "the grid drew a tile under a name with no image posts");
  assert.equal(document.querySelectorAll(".profile-tile-skeleton").length, 0, "placeholders outlived the answer");
  assert.equal(document.querySelectorAll(".empty-state").length, 1);
  const empty = textOf(document.querySelector(".empty-state"));
  assert.ok(empty.includes(TESS), "the empty state does not say whose posts are missing");
  assert.equal(empty.includes(IRIS), false, "the empty state offers another name's view as the answer");

  // And the name is spoken as well as shown, so a reader who arrived by link is
  // told whose posts are missing rather than that some feature is empty.
  assert.ok(textOf(document.querySelector("#profile-announcer")).includes(TESS));
});
