// What People answers when the display name it was asked for has nothing to
// show — and when it was asked for a name this feed cannot hold at all.
//
// Two outcomes are reachable from a link somebody forwards, and both used to end
// somewhere other than the name in the link:
//
//   1. A display name this feed does carry, with zero image posts under it.
//   2. A display name the feed does not carry, including one longer than the
//      author limit every post on this site is written under
//      (MAX_AUTHOR_LENGTH, src/social-identity.js). That one was dropped on the
//      floor: the resolver skipped it, the page landed on whichever name had the
//      most pictures — or on "Guest" when nothing had any — and then told the
//      reader it had preselected that name for them. Three statements, all of
//      them about a name nobody asked for.
//
// The feed is built here rather than committed as a fixture, so a change to the
// bundled demo posts cannot quietly decide what these tests assert.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { MAX_AUTHOR_LENGTH } from "../src/social-identity.js";
// Imported rather than spelled out: this file only ever asserts that the wait is
// gone, and a literal copy of it here goes quietly true the next time the wait
// is reworded, leaving the check passing over a page still narrating a load.
import { loadingSummaryText } from "../src/profile.js";

const PAGE_URL = new URL("../src/profile.html", import.meta.url);
const SEED_ROUTE = "/social-demo-data.json";
const LIVE_ROUTE = "/api/social-posts?limit=100";

// The id tail is the day of month the post is dated, so an id ending in a day
// this calendar does not have drops the post at the door and takes its display
// name off the page with it.
const seedPost = (id, author, { withImage = true } = {}) => ({
  id,
  author,
  body: `${id} from ${author}`,
  caption: null,
  createdAt: `2026-07-${id.slice(-2)}T09:00:00.000Z`,
  likes: 0,
  comments: 0,
  ...(withImage ? { image: { src: `/media/${author}.svg`, alt: `A drawing signed ${author}`, width: 1200, height: 900 } } : {}),
});

// Zed has two pictures, Bea one, Ari has posted and never a picture. So there is
// always another display name for the page to fall back to, which is exactly
// what none of these states may do.
const SEED_FEED = {
  posts: [
    seedPost("p-11", "Ari", { withImage: false }),
    seedPost("p-12", "Zed"),
    seedPost("p-13", "Bea"),
    seedPost("p-14", "Zed"),
  ],
};

// A forwarded name one character past the limit every post on this site is
// written under: no post can carry it, so it is the unknown name in its purest
// form, and it is what a truncated or mangled share link arrives as.
const OVERLONG_NAME = `Nova ${"n".repeat(MAX_AUTHOR_LENGTH)}`;

async function people({ search = "", storage = {}, live = { posts: [] }, seed = SEED_FEED } = {}) {
  const page = await loadPage(PAGE_URL, {
    storage,
    location: { search },
    routes: { [SEED_ROUTE]: seed, [LIVE_ROUTE]: live },
  });
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0; // The page's 30-second refresh must not outlive the test.
  const replaced = [];
  globalThis.window.history = { replaceState: (...args) => replaced.push(args) };
  await importPageModule("/profile-page.js");
  const { document } = page;
  await waitFor(() => document.documentElement.dataset.shiplogProfile === "ready", "the first load settles");
  return {
    document,
    replaced,
    storage: page.storage,
    picker: document.querySelector("#profile-author"),
    restore() { globalThis.setInterval = savedInterval; page.restore(); },
  };
}

const chips = (page) => page.picker.children.filter((node) => node.tagName === "BUTTON");
const selectedChip = (page) => chips(page).find((chip) => chip.getAttribute("aria-pressed") === "true") ?? null;

// Tiles the grid actually drew. The first-load placeholders carry .profile-tile
// as well, so counting without excluding them lets "the grid is empty" pass over
// a grid still full of skeletons.
const drawnTiles = (document) =>
  document.querySelectorAll(".profile-tile").filter((tile) => !tile.classList.contains("profile-tile-skeleton"));

// Everything the two states have to hold, whichever name produced them: one
// status region, no placeholders left inside or under it, no wait still being
// narrated, and a count of zero that is drawn rather than missing.
function assertStatedZero(document, name) {
  assert.equal(document.querySelectorAll("#profile-feed-status").length, 1,
    "the page draws more than one feed status region");
  const status = document.querySelector("#profile-feed-status");
  assert.equal(status.hidden, false, "the region that carries the answer is hidden");
  assert.equal(drawnTiles(document).length, 0, "the grid drew a tile under a name with no image posts");
  assert.equal(document.querySelectorAll(".profile-tile-skeleton").length, 0,
    "loading placeholders are still standing behind the answered state");
  assert.notEqual(textOf(status), loadingSummaryText(),
    "the waiting line outlived the wait it stood in for");
  // Replaced, not merely emptied: the region says something a reader can act on.
  assert.ok(textOf(status).length > 0, "the status region answered with nothing at all");
  // The count is drawn, and it is a zero rather than a gap or the last name's
  // number. The heading is where this page states it.
  assert.equal(textOf(document.querySelector("#grid-title")), `${name} · 0 image posts`);
}

test("a display name with zero image posts is answered under that name, with a stated zero", async () => {
  // Ari is in this feed and has posted; nothing under that name is a picture.
  const page = await people({ search: "?author=Ari" });
  try {
    const { document } = page;
    assert.equal(selectedChip(page)?.dataset.author, "Ari", "the page answered under a display name nobody asked for");
    assertStatedZero(document, "Ari");
    // The chip prints the zero too, so the picker and the grid cannot disagree
    // about what choosing this name will show.
    assert.equal(textOf(selectedChip(page)), "✓ Current filter — Display name: Ari · 0 image posts");
    // One panel, in the region that was carrying the wait, and it says which
    // way out this state has: other names here do have pictures, so the way out
    // is the reset rather than the editor.
    assert.equal(document.querySelectorAll(".empty-state").length, 1);
    const panel = document.querySelector("#profile-feed-status").querySelector(".empty-state");
    assert.match(textOf(panel), /The display name “Ari” has no image posts yet\.Publish post/);
    assert.equal(textOf(panel.querySelector("a")), "Publish post");
    assert.equal(panel.querySelector("a").getAttribute("href"), "/social.html#post-form");
    // And the page's one voice names the display name, because an announcement
    // has no page around it to borrow a subject from.
    assert.equal(textOf(document.querySelector("#profile-announcer")), "The display name “Ari” has no image posts yet.");
  } finally {
    page.restore();
  }
});

test("a feed with no pictures under any name offers Publish post", async () => {
  // Nobody has an image post, so nothing was filtered out: this is the empty
  // state rather than the filtered dead end, and its two routes are the ones
  // that fill it — Paint, and the rest of the posts on Social.
  const page = await people({
    search: "?author=Ari",
    seed: { posts: [seedPost("p-11", "Ari", { withImage: false })] },
  });
  try {
    const { document } = page;
    assertStatedZero(document, "Ari");
    const panel = document.querySelector("#profile-feed-status").querySelector(".empty-state");
    assert.match(textOf(panel), /The display name “Ari” has no image posts yet\.Publish post/);
    const routes = panel.querySelectorAll("a");
    assert.deepEqual(routes.map((route) => textOf(route)), ["Publish post"]);
    assert.equal(routes[0].getAttribute("href"), "/social.html#post-form");
    // Both are real links, so both are a tab stop and neither needs a handler to
    // be reachable from the keyboard.
    for (const route of routes) {
      assert.equal(route.tagName, "A");
      assert.equal(route.getAttribute("tabindex"), null);
    }
    // The page states the path from a blank grid to a picture on it, in the
    // order the steps happen, beside the state that needs it.
    assert.match(textOf(document.querySelector(".feed-create")),
      /A published post with an image appears on People, under the display name you publish it with\. To add yours: Create an image in Paint .*, export the PNG, then Write a post on Social and publish it\./);
  } finally {
    page.restore();
  }
});

test("a forwarded name this feed does not hold is repeated verbatim and never traded for another", async () => {
  const page = await people({ search: "?author=Nova" });
  try {
    const { document } = page;
    assert.equal(selectedChip(page)?.dataset.author, "Nova");
    assertStatedZero(document, "Nova");
    assert.equal(textOf(document.querySelector("#profile-name")), "Nova has no image posts yet.");
    // Not Zed, who has the most pictures, and not the no-name default.
    const rendered = textOf(document.getElementById("main-content"));
    assert.doesNotMatch(rendered, /published as (Zed|Guest)\./);
    assert.doesNotMatch(rendered, /(Zed|Guest) has no image posts yet\./);
    // A link that asked for somebody is not a name the page chose.
    assert.equal(textOf(document.querySelector("#profile-picker-note")), "");
  } finally {
    page.restore();
  }
});

test("a forwarded name the feed cannot hold is still the name the page answers", async () => {
  // The reported defect. Past the author limit, the name used to be discarded
  // without a word: the page answered under whichever display name had the most
  // pictures and reported that as a preselection.
  const page = await people({ search: `?author=${encodeURIComponent(OVERLONG_NAME)}` });
  try {
    const { document } = page;
    assert.equal(selectedChip(page)?.dataset.author, OVERLONG_NAME,
      "the forwarded display name was dropped for one the page preferred");
    assertStatedZero(document, OVERLONG_NAME);
    // Whole and literal, in the two visible elements this region spends on the
    // display name. Written as text, never as markup, because it arrived in a URL.
    assert.equal(textOf(document.querySelector("#profile-name")), `${OVERLONG_NAME} has no image posts yet.`);
    assert.equal(document.querySelector(".profile-identity").querySelectorAll("a").length, 0);
    // No other name is claimed as the answer, and "Guest" — the name the page
    // reached for when it had run out of candidates — is nowhere on it.
    const rendered = textOf(document.getElementById("main-content"));
    assert.doesNotMatch(rendered, /published as (Zed|Guest)\./);
    assert.doesNotMatch(rendered, /(Zed|Guest) has no image posts yet\./);
    assert.doesNotMatch(rendered, /Guest/);
    // The count on its own chip is the drawn zero, not "Counting…" and not a
    // number borrowed from the name the page used to fall back to.
    assert.equal(textOf(selectedChip(page)), `✓ Current filter — Display name: ${OVERLONG_NAME} · 0 image posts`);
    // A name that was asked for is never reported back as the page's own choice.
    assert.equal(textOf(document.querySelector("#profile-picker-note")), "");
    // Nothing this browser cannot post under is written to storage, and the
    // filter is still linkable: the name goes back into the URL encoded.
    assert.equal(page.storage.getItem("shiplog.social.author"), null);
  } finally {
    page.restore();
  }
});

test("an unusable forwarded name does not move when the live feed lands", async () => {
  // The second half of the same defect: the page re-picked a landing name for
  // any visitor it thought had chosen nobody, so a dropped forwarded name was
  // replaced a second time, after the fetch, under the reader.
  const page = await people({
    search: `?author=${encodeURIComponent(OVERLONG_NAME)}`,
    live: { posts: [{
      id: "live-image", author: "Mina", content: "Recovered.", timestamp: "2026-07-18T12:00:00.000Z",
      image_url: "/media/Mina.svg", image_alt: "A drawing signed Mina", image_width: 1200, image_height: 900,
    }] },
  });
  try {
    const { document } = page;
    assert.equal(selectedChip(page)?.dataset.author, OVERLONG_NAME,
      "the live feed moved the page off the display name that was asked for");
    assertStatedZero(document, OVERLONG_NAME);
    // The name that arrived with pictures is offered, not imposed.
    assert.equal(chips(page).some((chip) => chip.dataset.author === "Mina"), true);
  } finally {
    page.restore();
  }
});
