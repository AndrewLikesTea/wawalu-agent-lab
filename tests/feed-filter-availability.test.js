// Filters that stop offering themselves while the feed cannot be filtered
// (#1790), on Social and on People.
//
// THE DEFECT. A feed that has not answered yet, or whose fetch failed, still
// drew a full working toolbar: a display-name menu, a time-posted menu and a
// Clear filters button, all reachable by Tab, all of them controls whose only
// possible effect was on posts that were not there. On the failed screen that
// put three dead stops between the message a reader had just heard and the one
// control that could do anything about it — Retry.
//
// WHAT IS PINNED HERE. The `disabled` PROPERTY on all three Social controls and
// on People's display-name chips while the feed is loading or failed, their
// return the moment posts render, the retry control being the next stop after
// the status text on a failed feed, the non-colour signal (aria-disabled, a
// described-by hint, and one sentence in words), and the focus rescue: a reader
// standing on a control when it is taken away lands on the status region that
// just changed under them, never on <body>.
//
// HARNESS NOTES. `disabled` is read as the property. Nothing here asserts
// equality against an element node — that inspects the whole parsed page and
// hangs for minutes — so element identity is compared with `===` inside
// assert.ok, and everything else is counts and attributes. Skeleton cards carry
// the same class as real ones, so "posts rendered" subtracts them.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, textOf, tabSequence, pressTab } from "./support/browser.js";
import { mountSocialFeed } from "../src/social.js";
import { mountProfile } from "../src/profile.js";
import { FILTERS_UNAVAILABLE_HINT } from "../src/feed-status.js";
import { PROFILE_FILTERS_UNAVAILABLE_HINT } from "../src/profile.js";

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
  ...(withImage ? { image: { src: `/media/${author}.svg`, alt: `A drawing signed ${author}`, width: 1200, height: 900 } } : {}),
});

const MIXED = [
  post("p-11", "Ari", "11"),
  post("p-12", "Zed", "12", { withImage: true }),
  post("p-13", "Zed", "13", { withImage: true }),
];

const classesOf = (node) => (node?.getAttribute("class") ?? "").split(" ").filter(Boolean);

/** Cards a reader can read: the loading placeholders wear the same class. */
const rendered = (document, selector) => document.querySelectorAll(selector)
  .filter((node) => !classesOf(node).some((name) => name.endsWith("-skeleton")))
  .length;

const socialFilters = (document) => SOCIAL_FILTERS.map((id) => document.querySelector(id));

/** The one hint node this feature writes, found without a descendant selector. */
const hintIn = (host, id) => [...(host?.children ?? [])].find((child) => child.getAttribute?.("id") === id) ?? null;
/** Presence as a boolean: asserting equality against an element node hangs. */
const hasHint = (host, id) => Boolean(hintIn(host, id));

/* ---------------------------------- Social -------------------------------- */

test("Social's filters are not operable while the feed is loading, and say why", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  mountSocialFeed(document, { posts: [], state: "loading" });

  // The property, not a class and not a colour wash: this is what takes them
  // out of the tab order and out of the pointer path.
  for (const id of SOCIAL_FILTERS) {
    const control = document.querySelector(id);
    assert.equal(control.disabled, true, `${id} is operable while the feed is loading`);
    assert.equal(control.getAttribute("aria-disabled"), "true", `${id} states nothing in the markup`);
    assert.equal(control.getAttribute("aria-describedby"), "post-filter-hint", `${id} is not described by the reason`);
  }
  const stops = tabSequence(document);
  for (const control of socialFilters(document)) {
    assert.equal(stops.includes(control), false, "a dead filter is still a tab stop");
  }

  // And the reason in words, at caption weight, inside the filter region.
  const hint = hintIn(document.querySelector(".social-toolbar"), "post-filter-hint");
  assert.equal(hint.tagName, "P");
  assert.equal(textOf(hint), FILTERS_UNAVAILABLE_HINT);
  assert.equal(textOf(hint), "Filters become available when posts load.");
  assert.equal(classesOf(hint).includes("hint"), true, "the reason is set at content weight");
  assert.equal((textOf(document.body).match(/Filters become available when posts load\./g) ?? []).length, 1);
});

test("Social's filters come back, in their authored order, the moment posts render", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  const feed = mountSocialFeed(document, { posts: [], state: "loading" });

  feed.seed(MIXED);
  assert.equal(rendered(document, ".post-card"), 3);

  for (const id of SOCIAL_FILTERS) {
    const control = document.querySelector(id);
    assert.equal(control.disabled, false, `${id} did not come back with the posts`);
    assert.equal(control.getAttribute("aria-disabled"), null, `${id} still claims to be disabled`);
    assert.equal(control.getAttribute("aria-describedby"), null, `${id} still points at a hint that is gone`);
  }
  // Removed, not hidden: a description that has stopped being true is worse
  // standing there than absent.
  assert.equal(hasHint(document.querySelector(".social-toolbar"), "post-filter-hint"), false,
    "the hint outlived the state it describes");
  assert.doesNotMatch(textOf(document.body), /Filters become available/);

  // The three of them, in the order the markup puts them, with nothing moved.
  const stops = tabSequence(document);
  const [names, time, clear] = socialFilters(document);
  assert.ok(stops.indexOf(names) < stops.indexOf(time), "the display-name menu is no longer first");
  assert.ok(stops.indexOf(time) < stops.indexOf(clear), "Clear filters is no longer last");
  names.focus();
  pressTab(document);
  assert.ok(document.activeElement === time, "Tab from the display-name menu does not reach the time menu");
  pressTab(document);
  assert.ok(document.activeElement === clear, "Tab from the time menu does not reach Clear filters");
});

test("a failed Social feed leaves Retry as the reachable control, with nothing moved", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  const feed = mountSocialFeed(document, { posts: [], state: "loading", onRetry: () => {} });
  feed.setState("error");

  const status = document.querySelector("#feed-state");
  assert.match(textOf(status), /Social posts could not be loaded\./);
  for (const control of socialFilters(document)) {
    assert.equal(control.disabled, true, "a failed feed still offers a filter");
    assert.equal(control.getAttribute("aria-disabled"), "true");
  }
  assert.equal(textOf(hintIn(document.querySelector(".social-toolbar"), "post-filter-hint")), FILTERS_UNAVAILABLE_HINT);

  const retry = status.querySelector(".feed-status-action");
  assert.equal(retry.tagName, "BUTTON");
  assert.equal(retry.disabled, false);
  assert.equal(retry.getAttribute("tabindex"), null, "a real button needs no invented tab stop");

  // The filters sit ahead of the status region in the markup and stay there:
  // dropping them out of the tab order is what makes Retry the next stop, so
  // the DOM did not have to be rearranged to put it in the reader's path.
  const stops = tabSequence(document);
  const seat = stops.indexOf(retry);
  assert.ok(seat > 0, "the retry control is not reachable by keyboard at all");
  const before = stops[seat - 1];
  assert.equal(socialFilters(document).includes(before), false, "a dead filter is still a stop ahead of Retry");
  before.focus();
  pressTab(document);
  assert.ok(document.activeElement === retry, "Tab does not reach Retry from the stop before it");
});

test("a filter that loses its posts hands focus to the status region, not to the document", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  const feed = mountSocialFeed(document, { posts: MIXED, state: "ready", onRetry: () => {} });

  // A reader standing in the toolbar, narrowing the feed, when the refresh
  // behind them fails and the filters are taken away.
  const names = document.querySelector("#post-name-filter");
  names.value = "Ari";
  names.dispatchEvent({ type: "change" });
  const time = document.querySelector("#post-time-filter");
  time.value = "hour";
  time.dispatchEvent({ type: "change" });
  const clear = document.querySelector("#post-filter-clear");
  clear.focus();
  assert.equal(document.querySelectorAll(".empty-state-filtered").length, 1, "this is not the filtered dead end");
  assert.equal(clear.disabled, false, "the filtered dead end is a state its filters still work in");

  feed.setState("error");
  const status = document.querySelector("#feed-state");
  assert.equal(clear.disabled, true);
  assert.ok(document.activeElement === status, "focus was dropped instead of moved to the status region");
  // A programmatic landing place, not a new tab stop.
  assert.equal(status.getAttribute("tabindex"), "-1");
  assert.equal(tabSequence(document).includes(status), false, "the status region became a tab stop");
});

test("a filter nobody is standing on does not steal focus when it is disabled", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  const feed = mountSocialFeed(document, { posts: MIXED, state: "ready", onRetry: () => {} });

  const body = document.querySelector("#post-body");
  body.focus();
  feed.seed([]);
  assert.equal(document.querySelector("#post-time-filter").disabled, true);
  assert.ok(document.activeElement === body, "disabling a filter moved focus out of the composer");
  assert.equal(document.querySelector("#feed-state").getAttribute("tabindex"), null,
    "the status region took a tabindex it never needed");
});

/* ---------------------------------- People -------------------------------- */

test("People's display-name chooser is not operable while image posts are loading", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  // Ari is in the feed and has no image posts, so this display name's grid is
  // genuinely waiting on the fetch rather than already drawn from seeded tiles.
  mountProfile(document, { posts: MIXED, author: "Ari", state: "loading" });

  assert.equal(textOf(document.querySelector("#profile-feed-status")), "Loading image posts…");
  const chips = document.querySelectorAll(".profile-filter-option");
  assert.ok(chips.length > 1, "the chooser drew no chips to disable");
  const stops = tabSequence(document);
  for (const chip of chips) {
    assert.equal(chip.disabled, true, "a chip is operable while the image posts are loading");
    assert.equal(chip.getAttribute("aria-disabled"), "true");
    assert.equal(chip.getAttribute("aria-describedby"), "profile-filter-hint");
    assert.equal(stops.includes(chip), false, "a dead chip is still a tab stop");
  }

  const hint = hintIn(document.querySelector("#profile-author").parentNode, "profile-filter-hint");
  assert.equal(textOf(hint), PROFILE_FILTERS_UNAVAILABLE_HINT);
  assert.equal(textOf(hint), "Display names become available when image posts load.");
  assert.equal(classesOf(hint).includes("hint"), true);
});

test("a failed People feed disables the chooser and leaves Retry reachable", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  const profile = mountProfile(document, { posts: MIXED, author: "Ari", state: "ready", onRetry: () => {} });
  assert.equal(rendered(document, ".profile-tile"), 0);
  assert.equal(document.querySelectorAll(".profile-filter-option")[0].disabled, false,
    "the chooser was already closed before the feed failed");

  profile.setState("error");
  const chips = document.querySelectorAll(".profile-filter-option");
  const stops = tabSequence(document);
  for (const chip of chips) {
    assert.equal(chip.disabled, true, "a failed feed still offers a display name to choose");
    assert.equal(chip.getAttribute("aria-disabled"), "true");
    assert.equal(stops.includes(chip), false);
  }
  assert.equal(textOf(hintIn(document.querySelector("#profile-author").parentNode, "profile-filter-hint")),
    PROFILE_FILTERS_UNAVAILABLE_HINT);

  const retry = document.querySelector("#profile-feed-status").querySelector(".feed-status-action");
  assert.equal(retry.tagName, "BUTTON");
  assert.equal(retry.disabled, false);
  assert.equal(stops.includes(retry), true, "the retry control is not reachable by keyboard");
  const seat = stops.indexOf(retry);
  assert.equal([...chips].includes(stops[seat - 1]), false, "a dead chip is still a stop ahead of Retry");

  // And back: the chooser returns with the image posts, described by nothing.
  profile.seed(MIXED);
  for (const chip of document.querySelectorAll(".profile-filter-option")) {
    assert.equal(chip.disabled, false, "the chooser did not come back with the image posts");
    assert.equal(chip.getAttribute("aria-disabled"), null);
    assert.equal(chip.getAttribute("aria-describedby"), null);
  }
  assert.doesNotMatch(textOf(document.body), /Display names become available/);
});

test("a chip holding focus when the chooser closes hands it to the status region", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  const profile = mountProfile(document, { posts: MIXED, author: "Zed", state: "ready", onRetry: () => {} });

  const chip = document.querySelectorAll(".profile-filter-option")[0];
  chip.focus();
  assert.ok(document.activeElement === chip, "the chooser did not take focus to begin with");

  profile.setState("loading");
  const status = document.querySelector("#profile-feed-status");
  assert.ok(document.activeElement === status, "focus was dropped when the chips were rebuilt disabled");
  assert.equal(status.getAttribute("tabindex"), "-1");
  assert.equal(tabSequence(document).includes(status), false, "the status region became a tab stop");
});
