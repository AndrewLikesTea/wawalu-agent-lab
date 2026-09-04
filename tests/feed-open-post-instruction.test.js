// A feed that does not offer what it cannot do yet (#2111), on Social and on
// People.
//
// THE DEFECT. Both pages printed "Select Open post to read a post in full." in
// the paragraph under the heading, authored into the markup — so it was on
// screen in the frame before any fetch had answered, several screens above a
// list that held three grey rectangles. It named a control, "Open post", that
// exists nowhere except on a rendered card. A reader who followed it while the
// feed was loading was hunting for a button no card on the page had, and a
// reader whose feed failed was left with an instruction for an affordance that
// never arrived.
//
// WHAT IS PINNED HERE. The sentence's absence from the loading page — from the
// markup as shipped and from the rendered page text, not merely from the intro
// — its arrival with the first real card, its arrival exactly once, and its
// departure again when the cards go. Plus the state the filters are in on
// either side of that line, which is the same rule read through the controls:
// nothing offers itself over a feed that has not answered.
//
// The filter controls' own behaviour landed with #1790/#1855/#2001 and is
// pinned in depth by tests/feed-filter-availability.test.js. What this file
// adds is the before/after pair stated as one screen: while the feed loads the
// display-name menu is `disabled` and describes itself with the reason, and
// once posts are on screen it is operable and holds their names.
//
// HARNESS NOTES. `disabled` is read as the property, and an unset property
// reads as undefined rather than false, so the enabled case asserts `!disabled`.
// Nothing is compared against an element node — that walks the whole parsed
// page and hangs for minutes. Skeleton cards wear the same class as real ones,
// so every count here subtracts them.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, textOf } from "./support/browser.js";
import { mountSocialFeed } from "../src/social.js";
import { mountProfile } from "../src/profile.js";
import { OPEN_POST_INSTRUCTION, FILTERS_UNAVAILABLE_HINT } from "../src/feed-status.js";
import { PROFILE_FILTERS_UNAVAILABLE_HINT } from "../src/profile.js";

const SOCIAL_PAGE = new URL("../src/social.html", import.meta.url);
const PEOPLE_PAGE = new URL("../src/profile.html", import.meta.url);

const image = (name) => ({ src: `/media/${name}.svg`, alt: `A drawing signed ${name}`, width: 1200, height: 900 });

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

// Zed publishes pictures, Ari does not: the People half needs a display name
// whose grid actually draws tiles, and one whose grid never does.
const POSTS = [
  post("p-11", "Ari", "11"),
  post("p-12", "Zed", "12", { withImage: true }),
  post("p-13", "Zed", "13", { withImage: true }),
];

const classesOf = (node) => (node?.getAttribute("class") ?? "").split(" ").filter(Boolean);

/** Cards a reader can open. The loading reservations carry the card's class. */
const rendered = (document, selector) => document.querySelectorAll(selector)
  .filter((node) => !classesOf(node).some((name) => name.endsWith("-skeleton")))
  .length;

/** How many times the page says it — never "does it", so a second copy fails. */
const saidOnPage = (document) =>
  (textOf(document.body).match(/Select Open post to read a post in full\./g) ?? []).length;

const noteText = (document, id) => textOf(document.querySelector(id));

/* ---------------------------------- Social -------------------------------- */

test("Social's first paint offers neither a filter nor an instruction for a card it has not drawn", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  // The shipped frame, before a module has run: three reserved shapes wearing
  // the post card's own class, and no post behind any of them. This is exactly
  // the screen the sentence used to be printed on.
  assert.ok(document.querySelectorAll(".post-card").length > 0, "the loading frame reserves no cards at all");
  assert.equal(rendered(document, ".post-card"), 0, "the loading frame drew a real card");
  assert.equal(saidOnPage(document), 0, "the shipped markup still tells a reader to select Open post");

  mountSocialFeed(document, { posts: [], state: "loading" });
  assert.equal(rendered(document, ".post-card"), 0);
  assert.equal(saidOnPage(document), 0, "a loading feed names a control none of its cards carry");

  // The slot the sentence will arrive in is authored and wordless, so nothing
  // is inserted above the cards later and no layout moves under the reader.
  assert.equal(document.querySelectorAll("#post-open-note").length, 1);
  assert.equal(noteText(document, "#post-open-note"), "");

  // And the same rule read through the controls. The property, not a class and
  // not a colour wash: it is what takes them out of the tab order too.
  const names = document.querySelector("#post-name-filter");
  const clear = document.querySelector("#post-filter-clear");
  assert.equal(names.disabled, true, "the display-name menu offers itself over a feed that has not answered");
  assert.equal(clear.disabled, true, "Clear filters offers itself with nothing on screen to clear");
  assert.equal(names.options.length, 1, "the menu holds display names with no posts behind them");

  // The reason in words, next to the controls, since a greyed fill is a signal
  // some readers never get. Stable id, and the menu points at it.
  const hint = document.querySelector("#post-filter-hint");
  assert.equal(hint.getAttribute("id"), "post-filter-hint");
  assert.equal(textOf(hint), FILTERS_UNAVAILABLE_HINT);
  assert.equal(textOf(hint), "Display name options become available when posts load.");
  assert.equal(names.getAttribute("aria-describedby"), "post-filter-hint",
    "the menu is shut and says nothing about why");
});

test("Social names Open post once, as soon as there is a post to open, and takes it back with the cards", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  const feed = mountSocialFeed(document, { posts: [], state: "loading" });

  feed.seed(POSTS);
  assert.equal(rendered(document, ".post-card"), 3, "the fixture drew no cards to instruct about");
  assert.equal(saidOnPage(document), 1, "the feed with posts in it does not say how to open one");
  assert.equal(noteText(document, "#post-open-note"), OPEN_POST_INSTRUCTION);
  assert.equal(noteText(document, "#post-open-note"), "Select Open post to read a post in full.");

  // The menu came back with them, holding the names the cards were drawn from,
  // and the description that has stopped being true went with the wait.
  const names = document.querySelector("#post-name-filter");
  assert.ok(!names.disabled, "the display-name menu did not come back with the posts");
  assert.equal(names.getAttribute("aria-describedby"), null, "it still points at a reason that has gone");
  const options = names.options.map((option) => option.getAttribute("value"));
  assert.deepEqual(options, ["all", "Ari", "Zed"]);
  assert.equal(textOf(document.querySelector("#feed-summary")), "Showing 3 posts, newest first.");

  // Clear filters follows the second rule this row already had (#1855): it is
  // operable when there is something set to clear, so it opens on a filter
  // rather than on the posts, and stays shut over a settled feed with nothing
  // applied. Both readings agree that it is never operable with no feed at all.
  const clear = document.querySelector("#post-filter-clear");
  assert.equal(clear.disabled, true, "a reset with nothing to reset offers itself");
  names.value = "Zed";
  names.dispatchEvent({ type: "change" });
  assert.ok(!clear.disabled, "Clear filters stayed shut with a filter set");
  assert.equal(rendered(document, ".post-card"), 2);
  assert.equal(saidOnPage(document), 1, "narrowing the feed restated the instruction");

  // And it is an instruction about cards, so it goes when they do — on the
  // filtered dead end, and on a failed refresh, where the panel's own Retry is
  // the one thing left to do.
  names.value = "Nobody";
  names.dispatchEvent({ type: "change" });
  assert.equal(rendered(document, ".post-card"), 0);
  assert.equal(saidOnPage(document), 0, "an empty result still says how to open a post");

  feed.seed([]);
  assert.equal(saidOnPage(document), 0, "a feed with no posts in it still says how to open one");
  feed.setState("error");
  assert.equal(saidOnPage(document), 0, "a failed feed still says how to open a post");
  assert.equal(document.querySelector("#post-name-filter").disabled, true);
});

/* ---------------------------------- People -------------------------------- */

test("People's loading grid offers neither a display name nor an instruction for a tile it has not drawn", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  // The authored markup fakes hydration on this page — the display name and the
  // filter hint are both in it before anything runs — so this is read as tiles,
  // not as text: reserved shapes wearing the tile class, and no image post
  // behind them.
  assert.ok(document.querySelectorAll(".profile-tile").length > 0, "the loading frame reserves no tiles at all");
  assert.equal(rendered(document, ".profile-tile"), 0, "the loading frame drew a real tile");
  assert.equal(saidOnPage(document), 0, "the shipped markup still tells a reader to select Open post");

  // Ari is in the feed and has published no picture, so this grid is genuinely
  // waiting on the fetch rather than already drawn from seeded tiles.
  mountProfile(document, { posts: POSTS, author: "Ari", state: "loading" });
  assert.equal(rendered(document, ".profile-tile"), 0);
  assert.equal(saidOnPage(document), 0, "a loading grid names a control none of its tiles carry");
  assert.equal(document.querySelectorAll("#profile-open-note").length, 1);
  assert.equal(noteText(document, "#profile-open-note"), "");

  // The chooser, and the reason it is not offering anything. People has no
  // Clear filters control and this does not add one.
  assert.equal(document.querySelectorAll(".profile-filter-option").length, 0,
    "the chooser exposed display names before the image posts loaded");
  assert.equal(document.querySelectorAll("#profile-filter-clear").length, 0,
    "People grew a reset control it never had");
  const hint = document.querySelector("#profile-filter-hint");
  assert.equal(hint.getAttribute("id"), "profile-filter-hint");
  assert.equal(textOf(hint), PROFILE_FILTERS_UNAVAILABLE_HINT);
  assert.equal(textOf(hint), "Display names become available when image posts load.");
});

test("People names Open post once, as soon as a tile carries it", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  const profile = mountProfile(document, { posts: POSTS, author: "Zed", state: "ready" });

  assert.equal(rendered(document, ".profile-tile"), 2, "the fixture drew no tiles to instruct about");
  assert.equal(saidOnPage(document), 1, "the grid with image posts in it does not say how to open one");
  assert.equal(noteText(document, "#profile-open-note"), OPEN_POST_INSTRUCTION);
  // Word for word Social's, because it is the same act on the same object.
  assert.equal(noteText(document, "#profile-open-note"), "Select Open post to read a post in full.");

  // The chooser came back with the tiles, carrying the names behind them, and
  // its describedby went with the wait it described.
  const chips = document.querySelectorAll(".profile-filter-option");
  assert.ok(chips.length > 1, "the chooser never offered the display names at all");
  for (const chip of chips) {
    assert.ok(!chip.disabled, "the chooser did not come back with the image posts");
    assert.equal(chip.getAttribute("aria-describedby"), null);
  }
  assert.ok(chips.map((chip) => chip.dataset.author).includes("Zed"));

  // It describes the tiles, not the fetch: a refresh opening behind a drawn
  // grid leaves them on screen and openable, so the sentence stays with them.
  profile.setState("loading");
  assert.equal(rendered(document, ".profile-tile"), 2, "the open refresh took the drawn tiles away");
  assert.equal(saidOnPage(document), 1, "the instruction went while the tiles it names were still there");

  // And when the grid does empty, it goes.
  profile.seed([]);
  assert.equal(rendered(document, ".profile-tile"), 0);
  assert.equal(saidOnPage(document), 0, "a grid with no image posts in it still says how to open one");
});
