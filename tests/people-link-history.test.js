// #2826: from an image post on Social or on the shared post page, one action
// reaches People with that post's display name selected, and the selection
// lives in the address — so it survives a refresh, a bookmark, and Back.
//
// WHAT WAS ALREADY THERE. Social's image cards link to People (#2149, #2312,
// tests/social-image-post-people-link.test.js), People reads ?author= at boot
// and states an unknown name rather than falling back
// (tests/people-requested-name.test.js), and a pushed address reopens on its
// name (tests/social-image-post-people-link.test.js, "writes it into the
// address").
//
// WHAT THIS FILE PINS. The two pieces that were missing:
//   1. The post page offered its People link for every loaded post, text-only
//      included, under words that promise image posts. It is now offered only
//      where post.image is set — on both the seed and the live (UUID) path.
//   2. People wrote its selection with replaceState and never listened for
//      popstate, so Back left the page instead of returning to the name the
//      reader was on. It now pushes, and re-applies the entry's name in place.
// And the encoding contract for a name with markup characters in it. The
// harness parses no markup, so XSS cannot fail at page level here; the
// round-trip is pinned on the helper, and the render half at the source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { profileHref, requestedProfileAuthor } from "../src/social-links.js";
import { postPeopleLabel } from "../src/post-detail.js";
import { profileConnectionLine } from "../src/profile.js";

const POST_PAGE = new URL("../src/post.html", import.meta.url);
const PEOPLE_PAGE = new URL("../src/profile.html", import.meta.url);
const SEED_ROUTE = "/social-demo-data.json";
const LIVE_ROUTE = "/api/social-posts?limit=100";
const ORIGIN = "https://labs.wawalu.org";

const IRIS = "Iris Vale";
const REMY = "Remy Okafor";
const TESS = "Tess Nakano";
// Every character that would mean something in markup or in a query string.
const MARKUP = `A<b>&"c'`;

const image = (slug) => ({ src: `/media/${slug}.svg`, alt: `A drawing numbered ${slug}`, width: 1200, height: 900 });

// The seed shape. The day is written out: a seed id whose tail is not a real
// day of the month is dropped at the door.
const post = (id, author, day, { withImage = true } = {}) => ({
  id,
  author,
  body: `${id} body`,
  caption: null,
  createdAt: `2026-07-${day}T09:00:00.000Z`,
  likes: 0,
  comments: 0,
  ...(withImage ? { image: image(id) } : {}),
});

// Iris has the most pictures, so she is People's landing name.
const FEED = [
  post("p-01", IRIS, "01"),
  post("p-02", REMY, "02"),
  post("p-03", TESS, "03", { withImage: false }),
  post("p-04", IRIS, "04"),
  post("p-05", REMY, "05"),
  post("p-06", IRIS, "06"),
  post("p-07", MARKUP, "07"),
  post("p-08", MARKUP, "08"),
];

const newestFirstIds = (author) => FEED
  .filter((entry) => entry.author === author && entry.image)
  .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  .map((entry) => entry.id);

const drawnTiles = (document) => document
  .querySelectorAll(".profile-tile")
  .filter((tile) => !tile.classList.contains("profile-tile-skeleton"));
const chips = (document) => document.querySelector("#profile-author").children.filter((node) => node.tagName === "BUTTON");
const pressedChip = (document) => chips(document).find((chip) => chip.getAttribute("aria-pressed") === "true") ?? null;

/* ------------------------------ the helper -------------------------------- */

test("the People address round-trips a display name with markup characters unchanged", () => {
  const href = profileHref(MARKUP);
  for (const raw of ["<", ">", "&", '"', " "]) {
    assert.equal(href.includes(raw), false, `the address carries a raw ${JSON.stringify(raw)}`);
  }
  assert.equal(new URL(href, ORIGIN).pathname, "/profile.html");
  assert.equal(requestedProfileAuthor(new URL(href, ORIGIN).search), MARKUP);
  assert.equal(new URL(href, ORIGIN).searchParams.get("author"), MARKUP);
});

test("both links to People set their words as text, never as markup", async () => {
  // The render half of the encoding contract, pinned where the harness cannot
  // reach: these modules build every node with createElement + textContent.
  for (const file of ["social.js", "post-page.js", "post-detail.js", "profile.js", "profile-page.js"]) {
    const source = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML/, `${file} writes markup`);
  }
  const social = await readFile(new URL("../src/social.js", import.meta.url), "utf8");
  assert.match(social, /el\("a", "post-people", peopleImagePostsLabel\(post\.author\)\)/);
  assert.match(social, /function el\(tag, className, text\) \{[^}]*node\.textContent = text;/);
  const postPage = await readFile(new URL("../src/post-page.js", import.meta.url), "utf8");
  assert.match(postPage, /people\.textContent = postPeopleLabel\(author\);/);
});

/* ---------------------------- the post page ------------------------------- */

async function openPost(t, search, answer) {
  const page = await loadPage(POST_PAGE, { location: { search } });
  t.after(() => page.restore());
  globalThis.fetch = async (url) => answer(String(url));
  await importPageModule("/post-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogPostDetail === "ready", `the permalink ${search} settled`);
  assert.equal(page.document.querySelector("#post-detail").dataset.postState, "loaded", `${search} did not load a post`);
  return page;
}

const seed = (url) => {
  if (url === SEED_ROUTE) return { ok: true, status: 200, json: async () => ({ posts: FEED }) };
  throw new Error(`Unexpected request: ${url}`);
};

// A seed id never reaches the API: the live path needs a UUID, and the stub
// answers in the API's wire shape, `source` included, or the row is dropped.
const LIVE_TEXT_ID = "3f6a2b10-7c4d-4e5f-9a81-0b1c2d3e4f50";
const LIVE_IMAGE_ID = "8d1e4c27-2a3b-4c5d-8e9f-6a7b8c9d0e1f";
const liveRow = (id, withImage) => ({
  id,
  author: REMY,
  content: "Focus rings landed everywhere.",
  timestamp: "2026-07-14T09:00:00.000Z",
  like_count: 0,
  comment_count: 0,
  source: "shiplog-web",
  ...(withImage ? { image_url: "/media/remy.svg", image_alt: "A drawing of a focus ring", image_width: 1200, image_height: 900 } : {}),
});
const live = (row) => (url) => {
  if (url === `/api/social-posts/${row.id}`) return { ok: true, status: 200, json: async () => ({ post: row }) };
  throw new Error(`Unexpected request: ${url}`);
};

test("the post page offers its People link for an image post, named and aimed at that name", async (t) => {
  const { document } = await openPost(t, "?id=p-05", seed);
  const link = document.querySelector("#post-people");
  assert.equal(link.hidden, false, "an image post withheld its route to People");
  assert.equal(textOf(link), postPeopleLabel(REMY));
  assert.equal(link.getAttribute("href"), profileHref(REMY));
  // Beside the two standing exits, in the one exits paragraph.
  assert.deepEqual(link.parentNode.children.filter((node) => node.tagName === "A").map((node) => node.id),
    ["post-back", "post-people", "post-publish"]);
});

test("the post page offers no People link for a text-only post", async (t) => {
  const { document } = await openPost(t, "?id=p-03", seed);
  assert.equal(document.querySelector("#post-people").hidden, true,
    "a text-only post offered a route to image posts it does not have");
  // The other two exits still stand.
  assert.equal(document.querySelector("#post-back").hidden, false);
  assert.equal(document.querySelector("#post-publish").hidden, false);
});

test("on the live path the People link follows post.image too", async (t) => {
  await t.test("a live text-only post", async (t) => {
    const { document } = await openPost(t, `?id=${LIVE_TEXT_ID}`, live(liveRow(LIVE_TEXT_ID, false)));
    assert.equal(document.querySelector("#post-people").hidden, true);
  });
  await t.test("a live image post", async (t) => {
    const { document } = await openPost(t, `?id=${LIVE_IMAGE_ID}`, live(liveRow(LIVE_IMAGE_ID, true)));
    assert.equal(document.querySelector("#post-people").hidden, false);
    assert.equal(document.querySelector("#post-people").getAttribute("href"), profileHref(REMY));
  });
});

test("a display name with markup characters reads literally on the post page's link", async (t) => {
  const { document } = await openPost(t, "?id=p-08", seed);
  const link = document.querySelector("#post-people");
  assert.equal(textOf(link), postPeopleLabel(MARKUP));
  assert.equal(requestedProfileAuthor(new URL(link.getAttribute("href"), ORIGIN).search), MARKUP);
});

/* -------------------------------- People ---------------------------------- */

/**
 * People at an address, with a history double that moves location the way a
 * browser does and a captured popstate listener the test fires for Back and
 * Forward. Three settle waits, not one: the ready flag alone leaves a paint in
 * flight that reds a loaded CI box as an unhandled rejection.
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
  page.pushed = [];
  page.replaced = [];
  page.popstate = [];
  const { window } = globalThis;
  window.history = {
    pushState: (state, title, url) => {
      page.pushed.push(url);
      window.location.search = new URL(url, ORIGIN).search;
    },
    replaceState: (state, title, url) => page.replaced.push(url),
  };
  window.addEventListener = (type, handler) => { if (type === "popstate") page.popstate.push(handler); };
  page.go = (address) => {
    window.location.search = address;
    for (const handler of page.popstate) handler({ type: "popstate" });
  };

  await importPageModule("/profile-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogProfile === "ready", "People finished its first load");
  await waitFor(() => {
    const line = document.querySelectorAll("#profile-status");
    return line.length === 0 || textOf(line[0]) === profileConnectionLine("live");
  }, "the live feed answered");
  await waitFor(() => textOf(document.querySelector("#profile-announcer")).length > 0, "People announced its view");
  globalThis.setInterval = realSetInterval;
  return page;
}

const tileIds = (document) => drawnTiles(document).map((tile) => tile.dataset?.postId);

test("People booted at a name selects it and lists only its image posts, newest first", async (t) => {
  const page = await openPeople(t, `?author=${encodeURIComponent(REMY)}`);
  assert.equal(pressedChip(page.document)?.dataset.author, REMY);
  assert.deepEqual(tileIds(page.document), newestFirstIds(REMY));
  // Exactly one view entry per page: the boot restores, it does not push.
  assert.equal(page.pushed.length, 0, "booting pushed a history entry");
  assert.equal(page.popstate.length, 1, "People listens for Back and Forward exactly once");
});

test("choosing a name pushes its address in place, and Back and Forward re-apply it", async (t) => {
  const page = await openPeople(t, "");
  const { document } = page;
  assert.equal(pressedChip(document)?.dataset.author, IRIS, "the landing name is not the fixture's busiest");

  chips(document).find((chip) => chip.dataset.author === REMY).click();
  assert.deepEqual(page.pushed, [profileHref(REMY)]);
  assert.equal(globalThis.window.location.search, `?author=${encodeURIComponent(REMY)}`);
  assert.equal(page.navigations.length, 0, "choosing a name reloaded the page");
  assert.equal(page.replaced.length, 0);
  assert.deepEqual(tileIds(document), newestFirstIds(REMY));

  // Back to the address the reader arrived on: the name they landed on, even
  // though storage now remembers Remy.
  page.go("");
  assert.equal(pressedChip(document)?.dataset.author, IRIS, "Back did not return to the landing name");
  assert.deepEqual(tileIds(document), newestFirstIds(IRIS));

  // Forward re-applies the pushed name. Neither move writes history.
  page.go(`?author=${encodeURIComponent(REMY)}`);
  assert.equal(pressedChip(document)?.dataset.author, REMY);
  assert.deepEqual(tileIds(document), newestFirstIds(REMY));
  assert.equal(page.pushed.length, 1, "Back or Forward pushed a history entry");
  assert.equal(page.navigations.length, 0);
});

test("a display name with markup characters selects, reads literally, and pushes a decodable address", async (t) => {
  const page = await openPeople(t, profileHref(MARKUP).slice("/profile.html".length));
  const { document } = page;
  const chip = pressedChip(document);
  assert.equal(chip?.dataset.author, MARKUP);
  assert.ok(textOf(chip).includes(MARKUP), "the chip does not print the name as written");
  assert.deepEqual(tileIds(document), newestFirstIds(MARKUP));

  chips(document).find((node) => node.dataset.author === IRIS).click();
  page.go(profileHref(MARKUP).slice("/profile.html".length));
  assert.equal(pressedChip(document)?.dataset.author, MARKUP, "Back did not restore the name byte for byte");
});
