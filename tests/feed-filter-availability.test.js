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
import { mountSocialFeed, filterStatusLine, NO_FILTERS_APPLIED } from "../src/social.js";
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
/** Social's filter-row status line, read as text. */
const filterStatus = (document) => textOf(hintIn(document.querySelector(".social-toolbar"), "post-filter-hint"));

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
  assert.equal(textOf(hint), "Display name and posting time options become available when posts load.");
  assert.equal(classesOf(hint).includes("hint"), true, "the reason is set at content weight");
  assert.equal((textOf(document.body).match(/Display name and posting time options become available when posts load\./g) ?? []).length, 1);
});

test("Social's filters come back, in their authored order, the moment posts render", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  const feed = mountSocialFeed(document, { posts: [], state: "loading" });

  feed.seed(MIXED);
  assert.equal(rendered(document, ".post-card"), 3);

  // Both menus. Clear filters follows a second rule (#1855) — it is operable
  // when there is something set to clear — so with nothing set it stays shut,
  // and the state line below says which of the two reasons is in force.
  for (const id of SOCIAL_FILTERS.slice(0, 2)) {
    const control = document.querySelector(id);
    assert.equal(control.disabled, false, `${id} did not come back with the posts`);
    assert.equal(control.getAttribute("aria-disabled"), null, `${id} still claims to be disabled`);
    assert.equal(control.getAttribute("aria-describedby"), null, `${id} still points at a hint that is gone`);
  }
  // Rewritten, not removed: the line is the filter row's own status in every
  // state now, and a description that has stopped being true is replaced by the
  // one that is.
  assert.equal(textOf(hintIn(document.querySelector(".social-toolbar"), "post-filter-hint")), NO_FILTERS_APPLIED);
  assert.doesNotMatch(textOf(document.body), /Filters become available/);

  // The menus in the order the markup puts them, with nothing moved.
  const stops = tabSequence(document);
  const [names, time, clear] = socialFilters(document);
  assert.ok(stops.indexOf(names) < stops.indexOf(time), "the display-name menu is no longer first");
  assert.equal(stops.includes(clear), false, "a reset with nothing to reset is still a tab stop");
  names.focus();
  pressTab(document);
  assert.ok(document.activeElement === time, "Tab from the display-name menu does not reach the time menu");

  // And it comes back the moment there is something to clear, still last.
  time.value = "week";
  time.dispatchEvent({ type: "change" });
  assert.equal(clear.disabled, false, "Clear filters stayed shut with a filter set");
  const set = tabSequence(document);
  assert.ok(set.indexOf(time) < set.indexOf(clear), "Clear filters is no longer last");
  time.focus();
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

/* ------------------- The filter row says what it is doing ------------------ */
//
// #1855. The row's condition was readable in two ways and neither was words a
// settled feed carried: a sentence that only existed while the menus were shut,
// and a fill on a button. So "nothing is filtered" was something a reader
// inferred from dimming, and Clear filters offered itself as a working control
// on a screen where it could do nothing. This pins the one line, its three
// shapes, the reset following the sentence, and the row keeping its shape.

const hoursAgo = (n) => new Date(Date.now() - n * 3600 * 1000).toISOString();

/** Recent enough that "From the past 7 days" leaves the feed populated. */
const RECENT = [
  { id: "r-ari", author: "Ari", body: "just shipped", createdAt: hoursAgo(1), likes: 0, comments: 0 },
  { id: "r-zed", author: "Zed", body: "earlier", createdAt: hoursAgo(30), likes: 0, comments: 0 },
];

/** All three controls, still in the document, whatever state the row is in. */
const rowIsWhole = (document, state) => {
  for (const id of SOCIAL_FILTERS) {
    assert.equal(document.querySelectorAll(id).length, 1, `${state}: ${id} left the document`);
  }
  const clear = document.querySelector("#post-filter-clear");
  assert.equal(clear.tagName, "BUTTON", `${state}: the reset stopped being a button`);
  assert.equal(textOf(clear), "Clear filters", `${state}: the reset lost its name`);
};

const choose = (control, value) => {
  control.value = value;
  control.dispatchEvent({ type: "change" });
};

test("the filter row's status line is one live region inside the group it describes", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  // Authored, not written in on demand: a live region that arrives carrying its
  // news announces unreliably, if at all.
  const line = hintIn(document.querySelector(".social-toolbar"), "post-filter-hint");
  assert.equal(line.tagName, "P");
  assert.equal(line.getAttribute("aria-live"), "polite");
  assert.equal(classesOf(line).includes("hint"), true, "the line is set above caption weight");

  // A child of the group itself, which is what associates it with the controls
  // without a describedby on each of them. Read by walking up, because the
  // harness rejects a descendant selector.
  const toolbar = document.querySelector(".social-toolbar");
  assert.ok(line.parentNode === toolbar, "the status line left the filter group");
  assert.equal(toolbar.getAttribute("role"), "group");
  assert.equal(toolbar.getAttribute("aria-label"), "Filter posts");
  // And it is not a second copy of the sentence below it: that one stays the
  // list panel's, said once, and this line is not it.
  assert.equal(document.querySelectorAll(".feed-summary").length, 1, "the feed summary was duplicated");
  assert.equal(classesOf(line).includes("feed-summary"), false);

  mountSocialFeed(document, { posts: RECENT, state: "ready" });
  // It restates neither half of the summary sentence: no count, no ordering.
  assert.equal(filterStatus(document), NO_FILTERS_APPLIED);
  assert.doesNotMatch(filterStatus(document), /newest|oldest|order/i, "the row restates the feed's ordering");
  assert.doesNotMatch(filterStatus(document), /\d/, "the row restates the feed's count");
  assert.equal(textOf(document.querySelector("#feed-summary")), "Showing 2 posts, newest first.");
});

test("a loading filter row says the filters open with the posts, and offers none of them", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  mountSocialFeed(document, { posts: [], state: "loading" });

  rowIsWhole(document, "loading");
  for (const id of SOCIAL_FILTERS) {
    assert.equal(document.querySelector(id).disabled, true, `${id} offers itself before there is a feed`);
  }
  assert.equal(filterStatus(document), FILTERS_UNAVAILABLE_HINT);
  assert.equal(filterStatus(document), "Display name and posting time options become available when posts load.");
  assert.equal(filterStatus(document), filterStatusLine({ available: false }));
});

test("a settled filter row with nothing set says so, and its reset has nothing to do", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  const feed = mountSocialFeed(document, { posts: [], state: "loading" });
  feed.seed(RECENT);

  rowIsWhole(document, "no filters set");
  assert.equal(rendered(document, ".post-card"), 2);
  assert.equal(document.querySelector("#post-name-filter").disabled, false);
  assert.equal(document.querySelector("#post-time-filter").disabled, false);
  // Exactly when the sentence says nothing is applied.
  assert.equal(document.querySelector("#post-filter-clear").disabled, true,
    "a reset with nothing to reset still offers itself");
  assert.equal(filterStatus(document), "No filters applied.");
  assert.equal(filterStatus(document), filterStatusLine({}));
});

test("the status line names each set filter in the words of the control that set it", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  mountSocialFeed(document, { posts: RECENT, state: "ready" });
  const names = document.querySelector("#post-name-filter");
  const time = document.querySelector("#post-time-filter");
  const clear = document.querySelector("#post-filter-clear");

  // The display name alone, exactly as the option renders it.
  choose(names, "Ari");
  rowIsWhole(document, "display name set");
  const chosenName = names.options.find((option) => option.getAttribute("value") === "Ari");
  assert.equal(textOf(chosenName), "Ari");
  assert.equal(filterStatus(document), "Filtered to posts by Ari.");
  assert.equal(clear.disabled, false, "a set filter left the reset shut");

  // The time range alone, in the option's own words: the menu reads "From the
  // past 7 days" and the sentence carries it mid-sentence, which is the one
  // change this page makes to a filter's words anywhere it quotes them.
  choose(names, "all");
  choose(time, "week");
  rowIsWhole(document, "time range set");
  const chosenTime = time.options.find((option) => option.getAttribute("value") === "week");
  assert.equal(textOf(chosenTime), "From the past 7 days");
  assert.equal(filterStatus(document), "Filtered to posts from the past 7 days.");
  assert.equal(filterStatus(document).includes(textOf(chosenTime).slice(1)), true,
    "the sentence and the menu word the same range differently");
  assert.equal(clear.disabled, false);

  // Both, in one sentence, naming both.
  choose(names, "Ari");
  rowIsWhole(document, "both set");
  assert.equal(filterStatus(document), "Filtered to posts by Ari from the past 7 days.");
  assert.equal(filterStatus(document), filterStatusLine({ author: "Ari", range: "from the past 7 days" }));
  assert.equal(rendered(document, ".post-card"), 1, "the sentence describes a feed it did not narrow");
});

test("Clear filters returns the row to the no-filters sentence and hands focus to a live control", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  mountSocialFeed(document, { posts: RECENT, state: "ready" });
  const names = document.querySelector("#post-name-filter");
  const clear = document.querySelector("#post-filter-clear");

  choose(names, "Ari");
  choose(document.querySelector("#post-time-filter"), "week");
  clear.focus();
  assert.ok(document.activeElement === clear, "the reset would not take focus to begin with");

  clear.click();
  rowIsWhole(document, "cleared");
  assert.equal(filterStatus(document), NO_FILTERS_APPLIED);
  assert.equal(clear.disabled, true, "the reset survived its own press with nothing left to clear");
  // Never left standing on the control that just went away underneath them.
  assert.ok(document.activeElement === names, "focus was dropped, or left on a control that cannot act");
  assert.equal(tabSequence(document).includes(names), true, "focus landed somewhere a reader cannot Tab back to");
  assert.equal(rendered(document, ".post-card"), 2);
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
  assert.equal(chips.length, 0, "the chooser exposed names before image posts loaded");

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
  assert.equal(chips.length, 0, "a failed first load exposed stale display names");
  assert.equal(textOf(hintIn(document.querySelector("#profile-author").parentNode, "profile-filter-hint")),
    PROFILE_FILTERS_UNAVAILABLE_HINT);

  const retry = document.querySelector("#profile-feed-status").querySelector(".feed-status-action");
  assert.equal(retry.tagName, "BUTTON");
  assert.equal(retry.disabled, false);
  assert.equal(stops.includes(retry), true, "the retry control is not reachable by keyboard");
  assert.equal(stops.includes(retry), true, "Retry is not in the tab order");

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
