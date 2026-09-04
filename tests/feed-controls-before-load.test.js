// What the two feed pages offer before they have anything to offer it over
// (#2111), on Social and on People.
//
// THE DEFECT. Both pages ship a static frame that a visitor reads for as long
// as it takes the module to run, and that frame was written as if the feed had
// already answered. Social's display-name menu, its posting-time menu and Clear
// filters were all operable in it — three controls whose only possible effect is
// on posts that are not there — directly above a line that says the display
// names arrive with the posts. And both pages told a reader to "Select Open post
// to read a post in full." before a single card existed to print that control.
//
// WHAT IS PINNED HERE. The `disabled` PROPERTY on Social's three controls in the
// authored frame and in the loading render, the sentence that says why and the
// aria-describedby that ties each control to it, both coming back when cards do,
// and the open-post instruction being absent from every screen with no cards and
// present the moment there is one — on both pages, in the same bytes.
//
// HARNESS NOTES. `disabled` is read as the property, never as getAttribute: the
// harness does not reflect one to the other, and the property is what the
// platform acts on. Nothing is asserted equal to an element node — that walks
// the whole parsed page and hangs for minutes — so this is counts, properties
// and text. Loading placeholders carry the same class as real cards, so "a card
// is on screen" subtracts them rather than counting `.post-card`.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, textOf, tabSequence } from "./support/browser.js";
import { mountSocialFeed } from "../src/social.js";
import { mountProfile } from "../src/profile.js";
import { FILTERS_UNAVAILABLE_HINT } from "../src/feed-status.js";
import { PROFILE_FILTERS_UNAVAILABLE_HINT } from "../src/profile.js";
import { OPEN_POST_INSTRUCTION } from "../src/social-links.js";

const SOCIAL_PAGE = new URL("../src/social.html", import.meta.url);
const PEOPLE_PAGE = new URL("../src/profile.html", import.meta.url);

// The two menus and the reset, in the order the row authors them.
const SOCIAL_FILTERS = ["#post-name-filter", "#post-time-filter", "#post-filter-clear"];

const image = (name) => ({ src: `/media/${name}.svg`, alt: `A drawing signed ${name}`, width: 1200, height: 900 });

// Recent enough that no time range this row offers can empty the feed, and the
// dates are written here rather than derived from an id: a day this page cannot
// parse lands People on a display name nobody has.
const hoursAgo = (n) => new Date(Date.now() - n * 3600 * 1000).toISOString();

const POSTS = [
  { id: "p-ari", author: "Ari", body: "shipped the size gate", createdAt: hoursAgo(1), likes: 0, comments: 0 },
  { id: "p-zed", author: "Zed", body: "a drawing", createdAt: hoursAgo(2), likes: 0, comments: 0, image: image("Zed") },
  { id: "p-bea", author: "Bea", body: "another drawing", createdAt: hoursAgo(3), likes: 0, comments: 0, image: image("Bea") },
];

const classesOf = (node) => (node?.getAttribute("class") ?? "").split(" ").filter(Boolean);

/** Cards a reader can read: the placeholders wear the real card's class. */
const rendered = (document, selector) => document.querySelectorAll(selector)
  .filter((node) => !classesOf(node).some((name) => name.endsWith("-skeleton")))
  .length;

/** How often the page says something, in the text a reader is walked through. */
const says = (document, sentence) => textOf(document.body).split(sentence).length - 1;

/** A child of `host` carrying `id`, found without a descendant selector. */
const hintIn = (host, id) => [...(host?.children ?? [])]
  .find((child) => child.getAttribute?.("id") === id) ?? null;

/* ---------------------------------- Social -------------------------------- */

test("Social's authored frame ships its filters shut, described by the reason", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  // Nothing has run yet: this is the file a visitor is served, and the state it
  // describes is the state it is in — a feed with no posts in it.
  assert.equal(rendered(document, ".post-card"), 0, "the served page already holds cards, so this proves nothing");

  for (const id of SOCIAL_FILTERS) {
    const control = document.querySelector(id);
    assert.equal(control.disabled, true, `${id} is operable in the frame before the feed answers`);
    assert.equal(control.getAttribute("aria-describedby"), "post-filter-hint",
      `${id} does not name the line that says why it is shut`);
    assert.equal(tabSequence(document).includes(control), false, `${id} is a tab stop over an empty feed`);
  }

  // The sentence itself, unchanged, in the element those controls point at.
  const hint = hintIn(document.querySelector(".social-toolbar"), "post-filter-hint");
  assert.equal(textOf(hint), "Display name options become available when posts load.");
  assert.equal(textOf(hint), FILTERS_UNAVAILABLE_HINT);
  assert.equal(document.querySelectorAll("#post-filter-hint").length, 1,
    "the reason is written in more than one place, so a control can point at the wrong one");

  // And the menu is shut over the one option it can have here: the display names
  // are read off posts, so an empty feed is an empty menu.
  assert.equal(document.querySelector("#post-name-filter").options.length, 1);
});

test("Social withholds the open-post instruction until a card prints the control", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  // Absent from the served frame, and absent from the loading render: an
  // instruction for a control on a card, on a page with no cards.
  assert.equal(says(document, OPEN_POST_INSTRUCTION), 0,
    "the served page instructs a reader to use a control it has not drawn");
  const feed = mountSocialFeed(document, { posts: [], state: "loading" });
  assert.equal(rendered(document, ".post-card"), 0, "a placeholder was counted as a card");
  assert.equal(says(document, OPEN_POST_INSTRUCTION), 0, "the loading feed kept the instruction");
  assert.equal(says(document, "Select Open post"), 0, "some other wording of it survived the wait");

  // And there once there is a card, said once, in the intro that holds the slot.
  feed.seed(POSTS);
  assert.equal(rendered(document, ".post-card"), 3);
  assert.equal(says(document, OPEN_POST_INSTRUCTION), 1,
    "the instruction is missing, or said twice, on a feed that has posts");
  assert.match(textOf(document.querySelector(".social-feed-intro")), /Select Open post to read a post in full\./);
  // The words are the label on the card, so a reader who is told to select
  // "Open post" finds those two words printed on the thing they open.
  assert.equal(rendered(document, ".release-detail-link") > 0, true);
  assert.equal(textOf(document.querySelectorAll(".release-detail-link")[0]), "Open post");

  // A feed that empties again takes both back: no cards, no control, no
  // instruction, and the menus stop offering themselves a second time.
  feed.seed([]);
  assert.equal(says(document, OPEN_POST_INSTRUCTION), 0, "the instruction outlived the last card");
  assert.equal(document.querySelector("#post-name-filter").disabled, true);
});

test("Social's controls open with the posts and drop the description they no longer need", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  const feed = mountSocialFeed(document, { posts: [], state: "loading" });
  feed.seed(POSTS);

  // Readable from the page without looking at a style: the property is off, the
  // control is back in the tab order, and the menu now holds the names.
  const names = document.querySelector("#post-name-filter");
  assert.equal(names.disabled, false, "the display-name menu did not come back with the posts");
  assert.equal(names.getAttribute("aria-describedby"), null, "it still points at a reason that has stopped being one");
  assert.equal(tabSequence(document).includes(names), true, "it came back without becoming a tab stop again");
  assert.deepEqual(names.options.map((option) => option.getAttribute("value")), ["all", "Ari", "Bea", "Zed"]);
  assert.equal(document.querySelector("#post-time-filter").disabled, false);

  // The sentence is not standing there either: the line is the row's status and
  // says what the row is now doing instead.
  assert.equal(says(document, FILTERS_UNAVAILABLE_HINT), 0, "the waiting sentence outlived the wait");
  assert.equal(textOf(hintIn(document.querySelector(".social-toolbar"), "post-filter-hint")), "No filters applied.");

  // Clear filters follows the second rule this row already had (#1855): it opens
  // when there is something set to clear, which is the first moment it can do
  // anything at all.
  const clear = document.querySelector("#post-filter-clear");
  assert.equal(clear.disabled, true, "a reset with nothing to reset offers itself over a settled feed");
  names.value = "Ari";
  names.dispatchEvent({ type: "change" });
  assert.equal(clear.disabled, false, "the reset stayed shut with a filter set");
  assert.equal(clear.getAttribute("aria-describedby"), null);
});

/* ---------------------------------- People -------------------------------- */

test("People's authored frame offers no display name to choose, and says why", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  // The chooser is built from the image posts, so the served frame has nothing
  // to build it from and draws no control rather than a dead one.
  assert.equal(document.querySelectorAll(".profile-filter-option").length, 0,
    "the served page exposes display names no fetch has supported");
  assert.equal(document.querySelector("#profile-author").children.length, 0,
    "something is standing in the chooser before the image posts landed");
  assert.equal(rendered(document, ".profile-tile"), 0, "the served page already holds tiles, so this proves nothing");

  // The reason, in the sentence the group already carried, unchanged and inside
  // the fieldset the legend names. Ancestry by walk: no descendant selectors.
  const hint = document.querySelector("#profile-filter-hint");
  assert.equal(textOf(hint), "Display names become available when image posts load.");
  assert.equal(textOf(hint), PROFILE_FILTERS_UNAVAILABLE_HINT);
  assert.equal(hint.parentNode.tagName, "FIELDSET");
  assert.equal(textOf(hintIn(hint.parentNode, "profile-author-label")), "Filter by display name");
});

test("People withholds the open-post instruction until a tile prints the control", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  assert.equal(says(document, OPEN_POST_INSTRUCTION), 0,
    "the served page instructs a reader to use a control it has not drawn");
  // Ari has posted and never with an image, so this display name's grid is
  // genuinely waiting on the fetch rather than already drawn from seeded tiles.
  const profile = mountProfile(document, { posts: POSTS, author: "Ari", state: "loading" });
  assert.equal(rendered(document, ".profile-tile"), 0, "a placeholder was counted as a tile");
  assert.equal(says(document, OPEN_POST_INSTRUCTION), 0, "the loading grid kept the instruction");
  assert.equal(document.querySelectorAll(".profile-filter-option").length, 0,
    "the chooser exposed names before the image posts loaded");
  assert.equal(says(document, PROFILE_FILTERS_UNAVAILABLE_HINT), 1);

  // A display name with image posts, once the fetch has answered: tiles, a
  // chooser that works, and the sentence about opening one of them.
  profile.setAuthor("Zed");
  profile.seed(POSTS);
  assert.equal(rendered(document, ".profile-tile"), 1);
  assert.equal(says(document, OPEN_POST_INSTRUCTION), 1,
    "the instruction is missing, or said twice, on a grid that has tiles");
  assert.match(textOf(document.querySelectorAll(".profile-lede")[1]), /Select Open post to read a post in full\./);

  const chips = document.querySelectorAll(".profile-filter-option");
  assert.equal(chips.length > 1, true, "the chooser never became available at all");
  for (const chip of chips) {
    assert.equal(chip.disabled, false, "the chooser did not come back with the image posts");
    assert.equal(chip.getAttribute("aria-describedby"), null, "a working chip still points at the waiting sentence");
  }
  assert.equal(says(document, PROFILE_FILTERS_UNAVAILABLE_HINT), 0, "the waiting sentence outlived the wait");

  // And a display name with nothing to show takes the instruction back: an empty
  // grid prints no control for it to name.
  profile.setAuthor("Ari");
  assert.equal(rendered(document, ".profile-tile"), 0);
  assert.equal(says(document, OPEN_POST_INSTRUCTION), 0, "the instruction outlived the last tile");
});

// Both pages say it, and they say the same thing: the sentence is built from the
// label the cards print (src/social-links.js), so a reader sent looking for
// "Open post" is sent looking for words that are on screen.
test("the two feeds word the open-post instruction identically", async (t) => {
  const social = await loadPage(SOCIAL_PAGE, {});
  mountSocialFeed(social.document, { posts: POSTS, state: "ready" });
  const socialText = textOf(social.document.querySelector(".social-feed-intro"));
  social.restore();

  const people = await loadPage(PEOPLE_PAGE, {});
  t.after(() => people.restore());
  mountProfile(people.document, { posts: POSTS, author: "Zed", state: "ready" });
  const peopleText = textOf(people.document.querySelectorAll(".profile-lede")[1]);

  assert.equal(OPEN_POST_INSTRUCTION, "Select Open post to read a post in full.");
  assert.equal(socialText.includes(OPEN_POST_INSTRUCTION), true, "Social words it differently");
  assert.equal(peopleText.includes(OPEN_POST_INSTRUCTION), true, "People words it differently");
});
