// A loading feed offers no control it cannot run, and no instruction for a
// control it has not drawn (#2111), on Social and on People.
//
// THE DEFECT. The frame before hydration is the loading frame, and both pages
// furnished it as though the fetch had already answered. Social painted a
// display-name menu holding one option, a posting-time menu, and a Clear filters
// button — all three operable, all three able to act only on posts that were not
// there — directly above a sentence saying the display names were still coming.
// People painted a named, enabled control group with no entries in it. And both
// heroes told a reader, four paragraphs above a row of placeholders, to "Select
// Open post" — a control that exists on a rendered card and nowhere else.
//
// WHAT IS PINNED HERE. Two states per page, and the same facts in each. Before
// the feed answers: the `disabled` PROPERTY on Social's display-name menu, its
// posting-time menu and its reset, and on People's control group; the sentence
// saying why, attached to the control by aria-describedby and resolving to the
// element that holds it; and no instruction naming Open post anywhere on the
// page. After the first card renders: the property gone, the display names in
// the menu, and the instruction on the page, once, beside the cards it is about.
//
// Both states are asserted twice on each page — once on the served markup with
// nothing mounted, and once through the render path — because a control that is
// only shut by script is enabled for as long as the script takes to arrive, and
// that is the frame this issue is about.
//
// HARNESS NOTES. `disabled` is read as a property; the harness reflects no
// property to an attribute, and this one is the platform's own state rather than
// a class. Nothing here asserts equality against an element node — that inspects
// the whole parsed page and hangs for minutes — so absence is a count and
// presence is text. Skeleton cards carry the same class as real ones, so "a card
// rendered" subtracts them.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, textOf } from "./support/browser.js";
import { mountSocialFeed } from "../src/social.js";
import { mountProfile, PROFILE_FILTERS_UNAVAILABLE_HINT } from "../src/profile.js";
import { FILTERS_UNAVAILABLE_HINT } from "../src/feed-status.js";
import { OPEN_POST_INSTRUCTION } from "../src/social-links.js";

const SOCIAL_PAGE = new URL("../src/social.html", import.meta.url);
const PEOPLE_PAGE = new URL("../src/profile.html", import.meta.url);

const SOCIAL_FILTERS = ["#post-name-filter", "#post-time-filter", "#post-filter-clear"];

const post = (id, author, day, { withImage = false } = {}) => ({
  id,
  author,
  body: `${id} from ${author}`,
  caption: null,
  createdAt: `2026-07-${day}T09:00:00.000Z`,
  likes: 0,
  comments: 0,
  ...(withImage
    ? { image: { src: `/media/${author}.svg`, alt: `A drawing signed ${author}`, width: 1200, height: 900 } }
    : {}),
});

// Ari has no image post, so People's grid for Ari stays empty while Zed's fills:
// the same array is a loaded feed on Social and a two-tile grid on People.
const POSTS = [
  post("p-11", "Ari", "11"),
  post("p-12", "Zed", "12", { withImage: true }),
  post("p-13", "Zed", "13", { withImage: true }),
];

const classesOf = (node) => (node?.getAttribute("class") ?? "").split(" ").filter(Boolean);

/** Cards a reader can read: the loading placeholders wear the same class. */
const rendered = (document, selector) => document.querySelectorAll(selector)
  .filter((node) => !classesOf(node).some((name) => name.endsWith("-skeleton")))
  .length;

/** How many times the whole page says a sentence. */
const says = (document, sentence) =>
  textOf(document.body).split(sentence).length - 1;

/**
 * The control's own description, resolved the way a screen reader resolves it:
 * every id it names has to be an element on the page, and the sentence is what
 * those elements say. Returns the joined text, so a dangling id reads as "".
 */
const describedText = (document, control) => (control.getAttribute("aria-describedby") ?? "")
  .split(/\s+/)
  .filter(Boolean)
  .map((id) => document.querySelectorAll(`#${id}`).map((node) => textOf(node)).join(""))
  .join(" ");

/* ---------------------------------- Social -------------------------------- */

/** Every fact this issue is about, in whichever of the two shut states. */
const socialIsShut = (document, when) => {
  for (const id of SOCIAL_FILTERS) {
    const control = document.querySelector(id);
    assert.equal(control.disabled, true, `${when}: ${id} offers itself over a feed that has not answered`);
    assert.equal(control.getAttribute("aria-describedby"), "post-filter-hint",
      `${when}: ${id} does not name the sentence that says why it is shut`);
    // And that id is an element with the sentence in it, not a dangling name.
    assert.equal(describedText(document, control), FILTERS_UNAVAILABLE_HINT,
      `${when}: ${id}'s description does not resolve to the reason`);
  }
  assert.equal(textOf(document.querySelector("#post-filter-hint")),
    "Display name options become available when posts load.", `${when}: the reason is not in words`);
  // The display-name menu holds nothing but its all-values option, which is the
  // fact the sentence beside it rests on.
  assert.equal(document.querySelector("#post-name-filter").options.length, 1,
    `${when}: the menu holds display names with no posts behind them`);

  // And no instruction for a control that is not on the page. The slot is
  // authored, so this is the sentence's absence and not the element's.
  assert.equal(says(document, OPEN_POST_INSTRUCTION), 0,
    `${when}: the page tells a reader to select a control it has not drawn`);
  assert.equal(rendered(document, ".post-card"), 0, `${when}: this is not a feed without cards`);
};

test("Social's served frame offers no filter it can run and no instruction it can honour", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());

  // Nothing mounted: this is the markup a reader gets before the module arrives,
  // and the frame in which the old page was at its most inviting.
  socialIsShut(page.document, "served");
  assert.equal(page.document.querySelectorAll("#post-open-instruction").length, 1,
    "the slot the instruction is written into left the markup");
  assert.equal(textOf(page.document.querySelector("#post-open-instruction")), "",
    "the served page prints the instruction before there is a card to act on");
});

test("Social's loading render keeps the row shut and the reason attached", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  mountSocialFeed(page.document, { posts: [], state: "loading" });

  socialIsShut(page.document, "loading");
  // Removed rather than emptied: a hidden sentence is still text a screen reader
  // can be walked through, and this one is not true yet.
  assert.equal(page.document.querySelectorAll("#post-open-instruction").length, 0,
    "the instruction's slot outlived the wait");
});

test("Social opens its filters and names Open post in the paint that draws the first card", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  const feed = mountSocialFeed(document, { posts: [], state: "loading" });

  feed.seed(POSTS);
  assert.equal(rendered(document, ".post-card"), 3);

  const names = document.querySelector("#post-name-filter");
  const time = document.querySelector("#post-time-filter");
  assert.equal(names.disabled, false, "the display-name menu did not come back with the posts");
  assert.equal(time.disabled, false, "the posting-time menu is shut over a feed it could narrow");
  // Populated, which is what the sentence promised: the all-values option and
  // one entry per display name in the feed.
  assert.deepEqual(names.options.map((option) => option.getAttribute("value")), ["all", "Ari", "Zed"]);
  assert.equal(names.getAttribute("aria-describedby"), null,
    "the menu still points at a sentence that has stopped being true");
  assert.equal(says(document, OPEN_POST_INSTRUCTION), 1,
    "the instruction is missing, or said twice, on a feed with cards in it");
  assert.equal(textOf(document.querySelector("#post-open-instruction")),
    "Select Open post to read a post in full.");
  // Said beside the cards, in the panel that holds them — not back in the hero.
  const panelOf = (node) => {
    for (let at = node?.parentNode; at; at = at.parentNode) {
      if (at.classList?.contains("list-panel")) return at;
    }
    return undefined;
  };
  assert.ok(panelOf(document.querySelector("#post-open-instruction")),
    "the instruction is not in the panel that holds the cards it describes");

  // The reset keeps its own rule (#1855): operable when there is something set
  // to clear. With posts on screen and nothing set, that is still nothing — and
  // a range that empties the feed takes the instruction with the cards, because
  // the dead-end panel prints no Open post control either.
  const clear = document.querySelector("#post-filter-clear");
  assert.equal(clear.disabled, true, "the reset offers itself with nothing to reset");
  time.value = "week";
  time.dispatchEvent({ type: "change" });
  assert.equal(clear.disabled, false, "the reset stayed shut with a filter set");
  assert.equal(rendered(document, ".post-card"), 0, "this is not the filtered dead end");
  assert.equal(says(document, OPEN_POST_INSTRUCTION), 0,
    "the instruction survived the filters emptying the feed");

  // And it stays out on a feed that lost its posts: a failed refresh leaves no
  // control on screen for it to be naming.
  feed.setState("error");
  feed.seed([]);
  assert.equal(says(document, OPEN_POST_INSTRUCTION), 0,
    "the instruction outlived the last card it could be true of");
});

/* ---------------------------------- People -------------------------------- */

const GROUP = ".filter-group";

const peopleIsShut = (document, when) => {
  const group = document.querySelector(GROUP);
  assert.equal(group.tagName, "FIELDSET", `${when}: the control group stopped being a fieldset`);
  assert.equal(group.disabled, true, `${when}: the display-name chooser offers itself with no names in it`);
  const described = (group.getAttribute("aria-describedby") ?? "").split(/\s+/);
  assert.equal(described.includes("profile-filter-hint"), true,
    `${when}: the chooser does not name the sentence that says why it is shut`);
  assert.equal(describedText(document, group).includes(PROFILE_FILTERS_UNAVAILABLE_HINT), true,
    `${when}: the chooser's description does not resolve to the reason`);
  assert.equal(textOf(document.querySelector("#profile-filter-hint")),
    "Display names become available when image posts load.", `${when}: the reason is not in words`);
  assert.equal(document.querySelectorAll(".profile-filter-option").length, 0,
    `${when}: the chooser exposed display names before the image posts loaded`);

  assert.equal(says(document, OPEN_POST_INSTRUCTION), 0,
    `${when}: the page tells a reader to select a control it has not drawn`);
  assert.equal(rendered(document, ".profile-tile"), 0, `${when}: this is not a grid without tiles`);
};

test("People's served frame offers no chooser it can run and no instruction it can honour", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());

  // The authored markup already carries the hint sentence and the picker's own
  // description, so this is read off the control state rather than off the text.
  peopleIsShut(page.document, "served");
  assert.equal(page.document.querySelector(GROUP).getAttribute("aria-describedby"),
    "profile-author-hint profile-filter-hint",
    "the served group describes itself with something other than its two sentences");
  assert.equal(page.document.querySelectorAll("#profile-open-instruction").length, 1,
    "the slot the instruction is written into left the markup");
  assert.equal(textOf(page.document.querySelector("#profile-open-instruction")), "",
    "the served page prints the instruction before there is a tile to act on");
});

test("People's loading render keeps the chooser shut and the reason attached", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());
  // Ari is in the feed and has no image posts, so this grid is genuinely waiting
  // on the fetch rather than already drawn from seeded tiles.
  mountProfile(page.document, { posts: POSTS, author: "Ari", state: "loading" });

  peopleIsShut(page.document, "loading");
  assert.equal(page.document.querySelectorAll("#profile-open-instruction").length, 0,
    "the instruction's slot outlived the wait");
});

test("People opens its chooser and names Open post in the paint that draws the first tile", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  const profile = mountProfile(document, { posts: [], author: "Zed", state: "loading" });

  profile.seed(POSTS);
  assert.equal(rendered(document, ".profile-tile"), 2);

  const group = document.querySelector(GROUP);
  assert.equal(group.disabled, false, "the chooser did not come back with the image posts");
  assert.equal(group.getAttribute("aria-describedby"), "profile-author-hint",
    "the chooser still points at a sentence that has left the document");
  assert.equal(document.querySelectorAll("#profile-filter-hint").length, 0,
    "the waiting sentence outlived the wait");
  // Populated: one entry per display name in the feed, each of them operable.
  const chips = document.querySelectorAll(".profile-filter-option");
  assert.deepEqual(chips.map((chip) => chip.dataset.author), ["Ari", "Zed"]);
  for (const chip of chips) assert.equal(chip.disabled, false, "a display name came back shut");

  assert.equal(says(document, OPEN_POST_INSTRUCTION), 1,
    "the instruction is missing, or said twice, on a grid with tiles in it");
  assert.equal(textOf(document.querySelector("#profile-open-instruction")),
    "Select Open post to read a post in full.");

  // A display name with no image posts under it is a grid with no Open post
  // control on it either, so the instruction goes with the tiles.
  profile.setAuthor("Ari");
  assert.equal(rendered(document, ".profile-tile"), 0);
  assert.equal(says(document, OPEN_POST_INSTRUCTION), 0,
    "the instruction outlived the last tile it could be true of");
});

// One sentence, one owner. Both pages print the words the card's own control
// carries, from the constant that also names that control, so a rename cannot
// leave either page describing a control the reader cannot find.
test("both feeds say the instruction in one wording, and neither authors it", async (t) => {
  const social = await loadPage(SOCIAL_PAGE, {});
  t.after(() => social.restore());
  const people = await loadPage(PEOPLE_PAGE, {});
  t.after(() => people.restore());

  assert.equal(OPEN_POST_INSTRUCTION, "Select Open post to read a post in full.");
  mountSocialFeed(social.document, { posts: POSTS, state: "ready" });
  mountProfile(people.document, { posts: POSTS, author: "Zed", state: "ready" });
  assert.equal(textOf(social.document.querySelector("#post-open-instruction")), OPEN_POST_INSTRUCTION);
  assert.equal(textOf(people.document.querySelector("#profile-open-instruction")), OPEN_POST_INSTRUCTION);
});
