// #2597. A reader could not tell which posts on Social, People and a shared
// permalink were invented. Each page carried one blanket caveat — "The example
// posts here are invented to demonstrate Shiplog…" — and every post under it
// looked the same, including one a visitor had really published.
//
// So each post that is invented now prints two words, "Example post", and each
// list says in its own summary sentence how many of the posts on screen are.
// The caveats then stopped naming a set the reader had to find and started
// quoting the marker instead — "Posts labelled 'Example post' are invented…"
// (#2683) — so the sentence and the cards under it answer the same question.
// Four rules hold this together, and this file is the one place they are all
// pinned at once:
//
//   1. The label is the exception. A post a visitor published carries NO marker
//      — not an empty one, not a hidden one — because a distinction a reader
//      cannot see is not one.
//   2. `source` is the only thing that decides it, and "shiplog-web" is the only
//      value a visitor's post carries. normalizeProfileApiPosts used to drop the
//      field, which labelled every post on the permalink path, visitor-published
//      ones included, while a test that only checked the invented case passed.
//   3. Loading placeholders say nothing. They carry the same .post-card and
//      .profile-tile classes as real content, so every count here subtracts the
//      -skeleton elements rather than trusting the class alone.
//   4. Every caveat that points at the label quotes EXAMPLE_POST_LABEL itself.
//      Three pages ship that wording in authored markup, so the only thing
//      stopping the sentence and the badge from drifting apart is a test that
//      builds the expected words from the constant the badge is drawn with.

import test from "node:test";
import assert from "node:assert/strict";

import { loadPage, textOf } from "./support/browser.js";
import { createElement, installDocument } from "./support/dom.js";
import {
  EXAMPLE_POST_LABEL, countExamplePosts, examplePostsClause, isExamplePost, mountSocialFeed,
} from "../src/social.js";
import { mountProfile, normalizeProfileApiPosts, normalizeSeedPosts } from "../src/profile.js";
import { renderPostDetail } from "../src/post-detail.js";

// renderPostDetail builds its nodes through the ambient document, so the
// permalink tests below need one standing outside any loaded page. loadPage
// installs its own for the duration of a page test and restores this one after.
installDocument();

const SOCIAL_PAGE = new URL("../src/social.html", import.meta.url);
const PROFILE_PAGE = new URL("../src/profile.html", import.meta.url);

const IMAGE = { src: "/media/focus-ring.svg", alt: "A card wrapped in a blue focus ring", width: 1200, height: 900 };

// Seeded sample content declares no source, exactly like src/social-demo-data.json.
const seeded = (id, author, day) => ({
  id, author, body: `Seeded post ${id}`, caption: null,
  createdAt: `2026-07-${day}T09:00:00.000Z`, likes: 0, comments: 0, image: IMAGE,
});

// What the API hands back for a post a visitor published: the source is stamped
// server-side (src/social-posts-api.js) and nothing else writes it.
const published = (id, author, day) => ({ ...seeded(id, author, day), source: "shiplog-web" });

// .post-card and .profile-tile are on the placeholders too, so every count has
// to drop them. There is no shared helper for this — do it inline, once, here.
const realCards = (document) => document.querySelectorAll(".post-card")
  .filter((card) => !(card.getAttribute("class") ?? "").includes("-skeleton"));
const realTiles = (document) => document.querySelectorAll(".profile-tile")
  .filter((tile) => !(tile.getAttribute("class") ?? "").includes("-skeleton"));
const markers = (document) => document.querySelectorAll(".badge-example");

/* ------------------------------- the rule --------------------------------- */

test("only a post with the visitor source escapes the label, and the words are one string", () => {
  assert.equal(EXAMPLE_POST_LABEL, "Example post");
  assert.equal(isExamplePost({ source: "shiplog-web" }), false);
  // Everything else is sample content, including a record that carries no source
  // at all — the seed's shape, and the safe direction for an unknown value.
  assert.equal(isExamplePost({ source: "agent-demo" }), true);
  assert.equal(isExamplePost({}), true);
  assert.equal(isExamplePost(null), true);
  assert.equal(countExamplePosts([published("a", "Ari", "01"), seeded("b", "Bea", "02"), seeded("c", "Cy", "03")]), 2);
  assert.equal(countExamplePosts([]), 0);
  assert.equal(countExamplePosts(null), 0);
});

test("the clause agrees with the figure it follows, in every shape a list can be in", () => {
  // Nothing invented on screen: the clause says nothing rather than printing a
  // zero. The blanket caveat above the list already covers that case.
  assert.equal(examplePostsClause(3, 0), "");
  assert.equal(examplePostsClause(0, 0), "");
  // Wholly invented, which is what the demo normally shows.
  assert.equal(examplePostsClause(3, 3), ", all example posts");
  // One post, one example — never "all example posts" over a screen holding one.
  assert.equal(examplePostsClause(1, 1), ", an example post");
  // Mixed, singular and plural, and never "1 example posts".
  assert.equal(examplePostsClause(4, 1), ", including 1 example post");
  assert.equal(examplePostsClause(4, 3), ", including 3 example posts");
});

/* -------------------------------- Social ---------------------------------- */

test("Social marks the invented posts, leaves a published one bare, and counts both", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  mountSocialFeed(document, {
    posts: [seeded("s-1", "Ari", "14"), seeded("s-2", "Bea", "13"), published("s-3", "Cy", "12")],
    state: "ready",
  });

  assert.equal(realCards(document).length, 3);
  // Two markers for three cards. The third post is somebody's, and nothing on
  // its card says otherwise.
  assert.equal(markers(document).length, 2);
  for (const marker of markers(document)) assert.equal(textOf(marker), EXAMPLE_POST_LABEL);

  // The card with no marker is the published one, checked through the post id the
  // card carries rather than by position.
  const bare = realCards(document)
    .filter((card) => card.querySelectorAll(".badge-example").length === 0)
    .map((card) => card.dataset.postId);
  assert.deepEqual(bare, ["s-3"]);

  // One sentence: how many are showing, how many of those are invented, and the
  // order — and the order is still stated exactly once in the panel.
  const summary = document.querySelector("#feed-summary");
  assert.equal(textOf(summary), "Showing 3 posts, including 2 example posts, newest first.");
  const panel = document.querySelector(".list-panel");
  assert.equal((textOf(panel).match(/newest first/gi) ?? []).length, 1);
  assert.doesNotMatch(textOf(panel), /Post order/, "the deleted ordering eyebrow came back");
});

test("a wholly published Social feed says nothing about examples and marks nothing", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  mountSocialFeed(document, { posts: [published("s-1", "Ari", "14"), published("s-2", "Bea", "13")], state: "ready" });

  assert.equal(realCards(document).length, 2);
  assert.equal(markers(document).length, 0);
  assert.equal(textOf(document.querySelector("#feed-summary")), "Showing 2 posts, newest first.");
  // Nothing in the feed names the label. The panel's own caveats quote it to say
  // what it means (#2683), so the words are asserted off the cards rather than
  // off the panel they sit in.
  for (const card of realCards(document))
    assert.doesNotMatch(textOf(card), /Example post/, "a post a visitor published carries the words anyway");
});

test("Social's loading placeholders carry no label and no count", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  mountSocialFeed(document, { posts: [], state: "loading" });

  // Placeholders are drawn — and they are placeholders, not content.
  assert.equal(document.querySelectorAll(".post-card-skeleton").length > 0, true);
  assert.equal(realCards(document).length, 0);
  assert.equal(markers(document).length, 0, "a placeholder claimed to be an example post");
  assert.equal(textOf(document.querySelector("#feed-summary")), "",
    "a wait counted posts it has not fetched");
});

/* -------------------------------- People ---------------------------------- */

test("People marks the invented tiles, leaves a published one bare, and says so above them", async (t) => {
  const page = await loadPage(PROFILE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  mountProfile(document, {
    posts: [seeded("p-1", "Zed", "14"), seeded("p-2", "Zed", "13"), published("p-3", "Zed", "12")],
    author: "Zed",
    state: "ready",
  });

  assert.equal(realTiles(document).length, 3);
  assert.equal(markers(document).length, 2);
  for (const marker of markers(document)) assert.equal(textOf(marker), EXAMPLE_POST_LABEL);

  const bare = realTiles(document)
    .filter((tile) => tile.querySelectorAll(".badge-example").length === 0)
    .map((tile) => tile.dataset.postId);
  assert.deepEqual(bare, ["p-3"]);

  // The attribution sentence is injected here, by the render module — profile.html
  // ships no copy of it, and its authored body text is held to saying neither
  // "published as" nor "Showing N image post".
  assert.equal(textOf(document.querySelector("#profile-name")),
    "Showing 3 image posts published as Zed, including 2 example posts.");
});

test("a wholly published People grid says nothing about examples and marks nothing", async (t) => {
  const page = await loadPage(PROFILE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  mountProfile(document, { posts: [published("p-1", "Zed", "14")], author: "Zed", state: "ready" });

  assert.equal(realTiles(document).length, 1);
  assert.equal(markers(document).length, 0);
  assert.equal(textOf(document.querySelector("#profile-name")), "Showing 1 image post published as Zed.");
});

test("People's loading placeholders carry no label and no count", async (t) => {
  const page = await loadPage(PROFILE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  mountProfile(document, { posts: [], author: "Zed", state: "loading" });

  // The grid's own placeholders are present, and none of them is a tile.
  assert.equal(document.querySelectorAll(".profile-grid-skeleton").length > 0, true);
  assert.equal(realTiles(document).length, 0);
  assert.equal(markers(document).length, 0, "a placeholder claimed to be an example post");
  // A first load with nothing drawn says nothing about a person at all — the
  // line leaves the document entirely — so it cannot be saying how many of their
  // posts are invented either.
  assert.equal(document.querySelectorAll("#profile-name").length, 0);
});

/* ------------------------------ the permalink ------------------------------ */

test("the permalink marks an invented post and leaves a published one bare", () => {
  const invented = createElement("div");
  renderPostDetail(invented, seeded("d-1", "Mina", "14"));
  const marker = invented.querySelectorAll(".badge-example");
  assert.equal(marker.length, 1);
  assert.equal(textOf(marker[0]), EXAMPLE_POST_LABEL);
  // It is its own line, not a word appended to the display name: the byline is
  // the name, linked, and this is not part of anybody's name.
  assert.equal(invented.querySelectorAll(".detail-post-example").length, 1);
  assert.equal(invented.querySelectorAll(".detail-author-link .badge-example").length, 0);

  const real = createElement("div");
  renderPostDetail(real, published("d-2", "Mina", "14"));
  assert.equal(real.querySelectorAll(".badge-example").length, 0);
  assert.equal(real.querySelectorAll(".detail-post-example").length, 0);
  assert.doesNotMatch(textOf(real), /Example post/);
});

test("the permalink's waiting and dead-end states claim nothing about provenance", () => {
  for (const state of ["loading", "error", "not-found"]) {
    const container = createElement("div");
    renderPostDetail(container, null, { state, id: "d-1" });
    assert.equal(container.querySelectorAll(".badge-example").length, 0,
      `${state}: a state with no post marked one`);
    assert.doesNotMatch(textOf(container), /Example post/, `${state}: a state with no post named one`);
  }
});

/* ------------------------------ the plumbing ------------------------------- */

// The bug this file exists to prevent: normalizeProfileApiPosts dropped `source`,
// so the permalink and People saw every post as invented. A test that only
// rendered a seeded post would still have passed.
test("the normalizers carry source through, so a published post reaches the renderers unlabelled", () => {
  const apiRow = {
    id: "8a1f4c62-1c2a-4f4b-9a3d-2b6e5c7d8e9f",
    author: "Mina",
    content: "Focus rings landed everywhere.",
    timestamp: "2026-07-14T09:00:00.000Z",
    source: "shiplog-web",
    like_count: 0,
    comment_count: 0,
  };

  const [fromApi] = normalizeProfileApiPosts({ posts: [apiRow] });
  assert.equal(fromApi.source, "shiplog-web");
  assert.equal(isExamplePost(fromApi), false);

  // …and the whole way to the permalink renderer, which is the path post-page.js
  // takes for a live post.
  const container = createElement("div");
  renderPostDetail(container, fromApi);
  assert.equal(container.querySelectorAll(".badge-example").length, 0,
    "a post a visitor published was labelled invented on its own page");

  // An unsourced row is still sample content, and still labelled.
  const [unsourced] = normalizeProfileApiPosts({ posts: [{ ...apiRow, source: undefined }] });
  assert.equal(unsourced.source, undefined);
  assert.equal(isExamplePost(unsourced), true);

  // The seed normalizer answers the same question the same way. The bundled seed
  // declares no source, so its posts are examples.
  const [fromSeed] = normalizeSeedPosts([seeded("seed-post-1", "Mina", "14")]);
  assert.equal(fromSeed.source, undefined);
  assert.equal(isExamplePost(fromSeed), true);
  const [seedWithSource] = normalizeSeedPosts([published("seed-post-2", "Mina", "13")]);
  assert.equal(seedWithSource.source, "shiplog-web");
});

/* ------------------------------- the caveats ------------------------------- */

// The other half of the label: the sentences that tell a reader it is there.
//
// Each page used to say some of the posts on it were invented and leave the
// reader to work out which — "The example posts here are invented…" over a feed
// where nothing distinguished one post from another (#2683). Each now quotes the
// marker instead, so the sentence names something the reader can look at.
//
// Three pages ship that wording as authored markup, which is the one place it
// could drift from the badge. The expected words are built from
// EXAMPLE_POST_LABEL here rather than typed out a fourth time, so renaming the
// label fails this test instead of quietly leaving three caveats pointing at a
// marker no post carries. The quotation marks are the site's typographic ones,
// as in every other quoted control name in these pages' prose.
const QUOTED_LABEL = `labelled “${EXAMPLE_POST_LABEL}”`;

test("every caveat that points at the label quotes the label the posts are drawn with", async (t) => {
  const caveats = {
    "social.html": [".social-feed-intro"],
    "profile.html": [".profile-lede.hint"],
    // One paragraph on the permalink, and it is the standing hedge: src/post-page.js
    // replaces it with the answer about the loaded post, which names no marker.
    "post.html": ["#post-provenance"],
  };

  for (const [file, selectors] of Object.entries(caveats)) {
    const page = await loadPage(new URL(`../src/${file}`, import.meta.url), {});
    t.after(() => page.restore());
    for (const selector of selectors) {
      assert.equal(page.document.querySelectorAll(selector).length, 1,
        `${file}: ${selector} is not on the page exactly once`);
      const text = textOf(page.document.querySelector(selector));
      assert.ok(text.includes(QUOTED_LABEL),
        `${file}: ${selector} asks the reader to identify the invented posts instead of quoting the label: ${text}`);
      // Once, and the old wording never beside it: a caveat that said both would
      // be giving the set two names in one paragraph.
      assert.equal(text.split(QUOTED_LABEL).length - 1, 1,
        `${file}: ${selector} quotes the label more than once`);
      assert.doesNotMatch(text, /the example posts/i,
        `${file}: ${selector} still names the set a reader cannot see`);
    }
  }
});
