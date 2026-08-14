// How many posts are showing, said out loud on both feeds (#1744).
//
// THE DEFECT. Social stated the narrowed count as "2 posts of 3": the noun in
// the middle of the figure, pluralised off the number on screen rather than off
// the total it is a fraction of, so a feed narrowed to one post out of one read
// "1 post of 1" while the summary sentence three lines below it said "Showing 1
// of 1 post". One fact, two shapes, on one screen. On People the number beside
// "Newest first" was counted by a second hand-written `post.image` test rather
// than by the selector the picker's chips and the grid both count with — the
// same answer today, and two rules to keep in step forever.
//
// WHAT IS PINNED HERE. The count text on both pages against the cards actually
// rendered in the same paint: Social unfiltered, Social filtered, after
// publishing, and after clearing a filter; People's chips including a name with
// none, and the region count beside the ordering label against the chip that
// promised it. Every expected figure is counted off the page rather than written
// as a literal that happens to match a fixture.
//
// HARNESS NOTES. Skeletons wear the same class as real cards (.post-card /
// .profile-tile), so every count here goes through loadedCards()/loadedTiles(),
// which refuse to count while a placeholder grid is on screen. Assertions are on
// text and on counts, never on element identity — a null-equality assertion on a
// harness element walks the whole parsed page — and the ancestor check walks
// parentNode by hand because descendant selectors throw in this double.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, textOf } from "./support/browser.js";
import { mountSocialFeed, shownPostsCount } from "../src/social.js";
import { mountProfile, profileSummary } from "../src/profile.js";

const SOCIAL_PAGE = new URL("../src/social.html", import.meta.url);
const PEOPLE_PAGE = new URL("../src/profile.html", import.meta.url);

const image = (name) => ({ src: `/media/${name}.svg`, alt: `A drawing signed ${name}`, width: 1200, height: 900 });

// The id tail is the day of month the post is dated, so it has to be a real day:
// an impossible date is dropped on the way in and the page lands somewhere else
// entirely, with the count assertion below passing against nothing.
const post = (id, author, day, { withImage = false } = {}) => ({
  id,
  author,
  body: `${id} from ${author}`,
  caption: null,
  createdAt: `2026-07-${day}T09:00:00.000Z`,
  likes: 0,
  comments: 0,
  ...(withImage ? { image: image(author) } : {}),
});

// Zed has two image posts, Bea one, Ari has posted but never a picture — so the
// picker holds a name whose honest count is zero, which is the case the chips
// exist for.
const FEED = [
  post("p-11", "Ari", "11"),
  post("p-12", "Zed", "12", { withImage: true }),
  post("p-13", "Bea", "13", { withImage: true }),
  post("p-14", "Zed", "14", { withImage: true }),
];

// The cards a reader can actually see. A loading grid draws placeholders wearing
// the card class, so a bare querySelectorAll would count them and a "the count
// matches the cards" assertion would pass mid-load against furniture.
function loadedCards(document) {
  assert.equal(document.querySelectorAll(".post-card-skeleton").length, 0,
    "counted cards while the feed was still drawing placeholders");
  return document.querySelectorAll(".post-card").length;
}

function loadedTiles(document) {
  assert.equal(document.querySelectorAll(".profile-tile-skeleton").length, 0,
    "counted tiles while the grid was still drawing placeholders");
  return document.querySelectorAll(".profile-tile").length;
}

const setFilter = (document, id, value) => {
  const control = document.querySelector(id);
  control.value = value;
  control.dispatchEvent({ type: "change" });
};

/* ------------------------------- the shape -------------------------------- */

test("the shown count is one shape, and the noun agrees with the figure in front of it", () => {
  // Unfiltered there is nothing to be shown out of, so the page states the one
  // number rather than a fraction of itself.
  assert.equal(shownPostsCount({ shown: 12 }), "12 posts");
  assert.equal(shownPostsCount({ shown: 1 }), "1 post");
  assert.equal(shownPostsCount({ shown: 0 }), "0 posts");

  // Narrowed: on screen first, then what it was narrowed from, noun last and
  // said once. The plural follows the total, which is the figure it sits behind.
  assert.equal(shownPostsCount({ shown: 3, total: 12, filtering: true }), "3 of 12 posts");
  assert.equal(shownPostsCount({ shown: 1, total: 12, filtering: true }), "1 of 12 posts");
  assert.equal(shownPostsCount({ shown: 1, total: 1, filtering: true }), "1 of 1 post");
  assert.equal(shownPostsCount({ shown: 0, total: 4, filtering: true }), "0 of 4 posts");
});

/* --------------------------------- Social --------------------------------- */

test("Social states the total when nothing is filtered, and it is the number of cards", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  mountSocialFeed(document, { posts: FEED, state: "ready" });

  const drawn = loadedCards(document);
  assert.equal(drawn, 4);
  assert.equal(textOf(document.querySelector("#post-count")), `${drawn} posts`);
  // No denominator when nothing narrowed the feed: "4 of 4 posts" would offer a
  // reader a fraction to read where there is only a total.
  assert.doesNotMatch(textOf(document.querySelector("#post-count")), / of /);
  assert.equal(textOf(document.querySelector("#feed-summary")), `Showing ${drawn} posts, newest first.`);
});

test("Social states shown and total once a filter is on, in one shape", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  mountSocialFeed(document, { posts: FEED, state: "ready" });

  setFilter(document, "#post-name-filter", "Zed");
  const drawn = loadedCards(document);
  assert.equal(drawn, 2);
  assert.equal(textOf(document.querySelector("#post-count")), `${drawn} of 4 posts`);
  // The sentence below the filters counts the same posts by the same rule, so
  // the two lines a reader meets on the way to the cards say one thing.
  assert.equal(textOf(document.querySelector("#feed-summary")),
    `Showing ${drawn} of 4 posts by Zed, newest first.`);

  // One post through is a sentence, not "1 posts": the noun follows the total.
  setFilter(document, "#post-name-filter", "Bea");
  assert.equal(loadedCards(document), 1);
  assert.equal(textOf(document.querySelector("#post-count")), "1 of 4 posts");
});

test("Social's count reaches a screen reader before the cards it counts", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  mountSocialFeed(document, { posts: FEED, state: "ready" });

  // Document order, the order a screen reader travels: the count is inside the
  // Posts region and ahead of the list, not a figure a reader meets on the way
  // back out.
  const order = [];
  const visit = (node) => {
    for (const child of node.children) {
      if (child.nodeType !== 1) continue;
      order.push(child);
      visit(child);
    }
  };
  visit(document);
  const at = (selector) => order.indexOf(document.querySelector(selector));
  assert.ok(at("#feed-title") < at("#post-count"), "the count is read before the heading that names it");
  assert.ok(at("#post-count") < at("#post-feed"), "the cards are reached before the line that counts them");
  assert.ok(at("#feed-summary") < at("#post-feed"));

  // Text, at a type-scale role the page already ships. Nothing about the number
  // is carried by a fill, a badge, or a colour.
  const classes = (document.querySelector("#post-count").getAttribute("class") ?? "").split(" ").filter(Boolean);
  assert.deepEqual(classes, ["count"]);
});

test("Social recounts after a post is published, without a reload", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  const feed = mountSocialFeed(document, {
    posts: FEED,
    state: "ready",
    storage: page.storage,
    create: async (draft) => ({ ...draft, id: "p-15", createdAt: "2026-07-15T09:00:00.000Z" }),
  });
  feed.composer.open();

  const before = loadedCards(document);
  assert.equal(textOf(document.querySelector("#post-count")), `${before} posts`);

  document.querySelector("#post-body").value = "One more for the log.";
  document.querySelector("#post-author").value = "Remy";
  document.querySelector("#post-submit").click();
  await new Promise((resolve) => setImmediate(resolve));

  // The same render that drew the new card wrote the number: no second update
  // path, and nothing reloaded.
  const after = loadedCards(document);
  assert.equal(after, before + 1);
  assert.equal(textOf(document.querySelector("#post-count")), `${after} posts`);
  assert.equal(textOf(document.querySelector("#feed-summary")), `Showing ${after} posts, newest first.`);
});

test("Social recounts when the filters are cleared", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  mountSocialFeed(document, { posts: FEED, state: "ready" });

  setFilter(document, "#post-name-filter", "Zed");
  setFilter(document, "#post-time-filter", "week");
  assert.equal(textOf(document.querySelector("#post-count")), `${loadedCards(document)} of 4 posts`);

  document.querySelector("#post-filter-clear").click();
  const restored = loadedCards(document);
  assert.equal(restored, 4);
  // Back to the single total: the denominator goes when the thing it counted
  // against goes.
  assert.equal(textOf(document.querySelector("#post-count")), `${restored} posts`);
  assert.doesNotMatch(textOf(document.querySelector("#post-count")), / of /);
});

/* --------------------------------- People --------------------------------- */

const chips = (document) => document.querySelector("#profile-author").children.filter((node) => node.tagName === "BUTTON");
const chipFor = (document, name) => chips(document).find((chip) => chip.dataset.author === name);

// The number a chip claims, read back out of the text a reader actually gets.
function claimedBy(chip) {
  const stated = textOf(chip).match(/· (\d+) image posts?$/);
  assert.ok(stated, `the chip states no count: ${textOf(chip)}`);
  return Number(stated[1]);
}

test("every display name carries its image-post count, zero included", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  mountProfile(document, { posts: FEED, author: "Zed", state: "ready" });

  assert.deepEqual(chips(document).map((chip) => chip.dataset.author), ["Ari", "Bea", "Zed"]);
  // Ari has posted and never attached a picture. The zero is the whole point of
  // the number being there: without it the only way to learn that is to select
  // the name and meet an empty grid.
  assert.deepEqual(chips(document).map(claimedBy), [0, 1, 2]);
  assert.match(textOf(chipFor(document, "Ari")), /· 0 image posts$/);
  assert.match(textOf(chipFor(document, "Bea")), /· 1 image post$/);
});

test("selecting a name draws exactly the number of tiles its chip promised", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  mountProfile(document, { posts: FEED, author: "Zed", state: "ready" });

  // Read every promise before anything is clicked, then hold the grid to it.
  const promised = new Map(chips(document).map((chip) => [chip.dataset.author, claimedBy(chip)]));
  assert.deepEqual([...promised], [["Ari", 0], ["Bea", 1], ["Zed", 2]]);

  for (const [name, count] of promised) {
    chipFor(document, name).click();
    assert.equal(loadedTiles(document), count,
      `${name}’s chip promised ${count} image posts and the grid drew something else`);
  }
});

test("People states the count beside the ordering label, and it is the chip's number", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  mountProfile(document, { posts: FEED, author: "Zed", state: "ready" });

  // Beside "Newest first", in the same heading row, and ahead of the grid: the
  // two are siblings, so the label and the number are one line rather than a
  // figure a reader meets after the tiles it describes. Walked by hand — the
  // harness rejects descendant selectors.
  const summary = document.querySelector("#profile-summary");
  const order = document.querySelector("#profile-order");
  assert.equal(summary.parentNode.tagName, order.parentNode.tagName);
  assert.equal((summary.parentNode.getAttribute("class") ?? "").includes("list-heading"), true);
  assert.equal(textOf(order), "Newest first");

  const drawn = loadedTiles(document);
  assert.equal(drawn, 2);
  assert.equal(claimedBy(chipFor(document, "Zed")), drawn);
  assert.match(textOf(summary), /^2 image posts · 2 posts in total/);

  // The name with none says so here too, and the grid keeps the empty message it
  // already had rather than growing a second one for the count's sake.
  chipFor(document, "Ari").click();
  assert.equal(loadedTiles(document), 0);
  assert.equal(claimedBy(chipFor(document, "Ari")), 0);
  assert.match(textOf(document.querySelector("#profile-summary")), /^0 image posts · 1 post in total/);
});

test("the region count and the chip count are one derivation, not two that agree today", () => {
  // Asked of the pure core, so a rewrite of either caller cannot quietly go back
  // to counting image posts a second way: the summary's figure is the selector's
  // own answer for the same name.
  for (const name of ["Ari", "Bea", "Zed"]) {
    const summary = profileSummary(FEED, name);
    assert.equal(summary.withImages, FEED.filter((entry) => entry.author === name && entry.image).length, name);
  }
  // And the two figures the line prints answer two different questions: the
  // image posts are a subset of the posts in total, which is what makes "0 image
  // posts · 1 post in total" the sentence that explains an empty grid.
  const ari = profileSummary(FEED, "Ari");
  assert.equal(ari.withImages, 0);
  assert.equal(ari.total, 1);
});
