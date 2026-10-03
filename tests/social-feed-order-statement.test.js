// #2757. "State the Social feed's post order" — already shipped, and this file
// is why it stays shipped.
//
// Social states the order in #feed-summary, the sentence that already carries
// the count, directly above the post list: "Showing 4 posts, newest first."
// (feedSummarySentence, src/social.js). The standalone eyebrow that used to say
// "Post order: newest first" above the heading was deleted deliberately — it
// told one fact twice on one screen (src/social.html, src/social.js) — so the
// shape of this surface is one telling, in one place, and the regression risk
// runs both ways:
//
//   * delete the clause and the feed stops stating its order at all;
//   * add a second line and the deleted eyebrow is back, which the occurrence
//     count below and tests/social.test.js already refuse.
//
// WHAT IS PINNED HERE. The order statement across the four states the issue
// names, in one file, against the real page module:
//
//   1. posts loaded                  — the clause is in the sentence;
//   2. a filter active, >= 1 match   — it survives the narrowed count;
//   3. the first fetch still open    — no sentence at all (nothing counted yet);
//   4. a filter active, 0 matches    — no sentence; #post-count reports
//                                      "0 of 4 posts" and the no-match panel
//                                      owns the dead end.
//
// State 4 is deliberate, not a gap. #feed-summary is blank whenever nothing is
// on screen, because a feed with no posts in it has no order to state, and the
// no-match panel is the region that carries both the reason and the control
// back out. Forcing "newest first" into that state would be the page saying how
// it ordered nothing.
//
// And one vocabulary: People says "newest first" in the same bytes, in its
// eyebrow and in what its live region announces, so a reader who has read one
// feed does not learn a second phrase for one concept.
//
// HARNESS NOTES. Skeletons wear .post-card too, so card counts subtract the
// -skeleton elements. Document order is walked over node.children by hand —
// querySelectorAll("*") throws in this double and descendant selectors match
// nothing. Every assertion is on text, counts or attributes; never on element
// identity, which walks the whole parsed page.

import test from "node:test";
import assert from "node:assert/strict";

import { loadPage, textOf } from "./support/browser.js";
import { feedSummarySentence, mountSocialFeed } from "../src/social.js";
import { profileAnnouncement } from "../src/profile.js";

const SOCIAL_PAGE = new URL("../src/social.html", import.meta.url);
const PEOPLE_PAGE = new URL("../src/profile.html", import.meta.url);

// The phrase itself, written once here so every expectation below is built from
// it rather than from four hand-typed copies that could drift apart.
const ORDER = "newest first";

// Posts a visitor published: `source` is what tells an invented post from a real
// one, and without it every fixture here would be an example post and the
// sentence would carry the example clause as well as the order. These assertions
// are about the order, so the fixtures are the plain case.
const published = (id, author, day) => ({
  id,
  author,
  body: `Post ${id} from ${author}`,
  caption: null,
  createdAt: `2026-07-${day}T09:00:00.000Z`,
  likes: 0,
  comments: 0,
  source: "shiplog-web",
});

const FEED = [
  published("o-11", "Ari", "11"),
  published("o-12", "Bea", "12"),
  published("o-13", "Zed", "13"),
  published("o-14", "Zed", "14"),
];

// The time menu's windows are counted from the real clock — render() calls
// filterPosts without a `now`, so there is no seam to inject one through — which
// means a fixture that must survive "From the past hour" has to be dated from
// it. Minutes rather than a fixed date, so the test does not expire.
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
const RECENT = FEED.map((post, index) => ({ ...post, createdAt: minutesAgo((index + 1) * 5) }));

const realCards = (document) => document.querySelectorAll(".post-card")
  .filter((card) => !(card.getAttribute("class") ?? "").includes("-skeleton"));

const setFilter = (document, id, value) => {
  const control = document.querySelector(id);
  control.value = value;
  control.dispatchEvent({ type: "change" });
};

// How many times the whole feed panel says it. One, in every state that says it
// at all — this is the assertion a re-added eyebrow fails.
const orderTellings = (document) =>
  (textOf(document.querySelector(".list-panel")).match(new RegExp(ORDER, "gi")) ?? []).length;

/* ----------------------------- one vocabulary ----------------------------- */

test("Social and People state the order in the same words", async (t) => {
  // Social's sentence closes on it, and so does what People announces: same
  // phrase, same position in the sentence, with only each page's noun differing.
  assert.equal(feedSummarySentence({ shown: 4 }), `Showing 4 posts, ${ORDER}.`);
  assert.equal(profileAnnouncement("Ari", 3), `Showing 3 image posts by Ari, ${ORDER}.`);

  // People also labels its grid with the phrase title-cased, which is the same
  // two words and the reason Social does not need a label of its own.
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());
  assert.equal(textOf(page.document.querySelector("#profile-order")), "Newest first");
});

/* ------------------------------ posts loaded ------------------------------ */

test("a loaded Social feed states its order beside the count, above the list", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  mountSocialFeed(document, { posts: FEED, state: "ready" });

  const drawn = realCards(document).length;
  assert.equal(drawn, 4);
  assert.equal(textOf(document.querySelector("#feed-summary")), `Showing ${drawn} posts, ${ORDER}.`);

  // Document order, the order a reader travels: the order is stated before the
  // posts it describes, not discovered after scrolling past them.
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
  assert.ok(at("#feed-title") < at("#feed-summary"), "the order is stated before the panel is named");
  assert.ok(at("#feed-summary") < at("#post-feed"), "the cards are reached before the line that orders them");

  // Once. The deleted eyebrow is the thing a second telling would be.
  assert.equal(orderTellings(document), 1);
  assert.doesNotMatch(textOf(document.querySelector(".list-panel")), /Post order/,
    "the deleted ordering eyebrow came back");
});

/* --------------------------- a filter, with matches ----------------------- */

test("the order survives an active filter, still once and still above the list", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  mountSocialFeed(document, { posts: RECENT, state: "ready" });
  setFilter(document, "#post-name-filter", "Zed");

  const drawn = realCards(document).length;
  assert.equal(drawn, 2);
  // The narrowed count and the order in the same sentence: a reader who filtered
  // the feed is not left to assume the order came off with the posts.
  assert.equal(textOf(document.querySelector("#feed-summary")),
    `Showing ${drawn} of ${RECENT.length} posts by Zed, ${ORDER}.`);
  assert.equal(orderTellings(document), 1);

  // And with both menus set, which is the narrowest the feed goes with posts
  // still in it. The order is the last clause either way.
  setFilter(document, "#post-time-filter", "hour");
  assert.equal(realCards(document).length, 2);
  assert.equal(textOf(document.querySelector("#feed-summary")),
    `Showing 2 of ${RECENT.length} posts by Zed from the past hour, ${ORDER}.`);
  assert.equal(orderTellings(document), 1);
});

/* ------------------------- the two states with no order ------------------- */

test("a feed that has counted nothing states no order", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  // The first fetch is still open: placeholders are on screen and the page has
  // no posts to have ordered. "Showing 0 posts, newest first." would be a claim
  // about a feed nobody has looked at yet.
  mountSocialFeed(document, { posts: [], state: "loading" });
  assert.ok(document.querySelectorAll(".post-card-skeleton").length > 0);
  assert.equal(textOf(document.querySelector("#feed-summary")), "");
  assert.equal(orderTellings(document), 0);
});

test("the filtered dead end states no order, and the count carries the fraction", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  mountSocialFeed(document, { posts: FEED, state: "ready" });
  setFilter(document, "#post-name-filter", "Ari");
  setFilter(document, "#post-time-filter", "hour");
  assert.equal(realCards(document).length, 0);

  // Nothing matched, so there is nothing to have ordered. The summary stands
  // down and the no-match panel is the one telling of the dead end.
  assert.equal(textOf(document.querySelector("#feed-summary")), "");
  assert.equal(orderTellings(document), 0);
  // The count is still answered — "0 of 4 posts" — so a reader can see the feed
  // has posts in it that these filters excluded.
  assert.equal(textOf(document.querySelector("#post-count")), `0 of ${FEED.length} posts`);
  assert.match(textOf(document.querySelector(".empty-state")), /No posts by Ari from the past hour\./);

  // Clearing the filters brings the order back with the posts.
  setFilter(document, "#post-name-filter", "all");
  setFilter(document, "#post-time-filter", "all");
  assert.equal(textOf(document.querySelector("#feed-summary")), `Showing ${FEED.length} posts, ${ORDER}.`);
  assert.equal(orderTellings(document), 1);
});
