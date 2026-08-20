// One feed state at a time, on Social and on People (#1732).
//
// THE DEFECT. Both feeds narrated one wait several times over. A loading Social
// page carried "Loading the Social feed…" in its status region, "Counting posts…"
// beside the heading, and "New posts will appear here on their own." under the
// filters — three sentences about one open fetch, and the last two were claims
// the page had no answer for yet. People did the same with a fourth line, the
// invitation to put a picture in a grid nobody had seen. Two of the five states
// were never drawn at all: a failed request had no named message and no retry on
// People's own wording, and a display name filtered down to nothing borrowed the
// empty feed's copy, so "you narrowed this to nothing" and "there is nothing
// here" read identically.
//
// WHAT IS PINNED HERE. The five mutually exclusive states of the shared machine
// (src/feed-status.js), on both pages, including the negatives: while a fetch is
// open the count placeholder, the connection promise and People's invitation are
// not on the page at all. Absence, not visibility — feedPresence() removes the
// element, so these assertions count nodes rather than reading a `hidden` flag,
// which is exactly the difference a screen reader notices.
//
// WHAT #1772 ADDED. The connection line was a separate string that kept riding
// along: it left the document once the modules ran, but both pages still
// AUTHORED the promise into their markup, so the frame before hydration read
// "New posts will appear here on their own. Loading the Social feed…" — the
// promise first, then the admission there was nothing yet. And a failed load
// still carried it, where "reload the page to see the latest" stood beside the
// panel's Retry as a second instruction for one failure. The two tests at the
// end of each page's section below walk one page through loading, failed and
// loaded and count the promise in the rendered text: zero, zero, exactly one.
//
// HARNESS NOTES. The double reflects no properties, so a button's type is read
// off the property and never off getAttribute; it rejects the universal and
// descendant selectors, so ancestor walks go through parentNode by hand; and
// nothing here asserts equality against an element node, which hangs for
// minutes. Counts and attributes only.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { mountSocialFeed } from "../src/social.js";
import { mountProfile } from "../src/profile.js";
import { feedPhase } from "../src/feed-status.js";

const SOCIAL_PAGE = new URL("../src/social.html", import.meta.url);
const PEOPLE_PAGE = new URL("../src/profile.html", import.meta.url);
const SEED_ROUTE = "/social-demo-data.json";
const LIVE_ROUTE = "/api/social-posts?limit=100";

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

// Ari and Zed both post; only Zed attaches pictures, so on People a reader who
// selects Ari has filtered a full feed down to nothing, while a feed of Ari
// alone is genuinely empty of images. The two must not read the same.
const MIXED = [
  post("p-11", "Ari", "11"),
  post("p-12", "Zed", "12", { withImage: true }),
  post("p-13", "Zed", "13", { withImage: true }),
];

// Ancestor walk by hand: descendant selectors throw in this harness, and a live
// region inside a closed disclosure is silent in a real browser while textOf()
// reads straight through it.
function collapsibleAncestor(node) {
  for (let walker = node?.parentNode; walker; walker = walker.parentNode) {
    if (walker.tagName === "DETAILS" || walker.tagName === "DIALOG") return walker.tagName;
    if (walker.hasAttribute?.("hidden")) return "HIDDEN";
  }
  return null;
}

const classesOf = (node) => (node?.getAttribute("class") ?? "").split(" ").filter(Boolean);

/**
 * Cards a reader can actually read. The loading placeholders carry the same
 * class as the real thing, so counting the class alone reports a full grid to a
 * test that is standing in the middle of a load.
 */
const rendered = (document, selector) => document.querySelectorAll(selector)
  .filter((node) => !classesOf(node).some((name) => name.endsWith("-skeleton")))
  .length;

/** How many times the page says the promise, in the text a reader is given. */
const promiseCount = (document, sentence) =>
  (textOf(document.body).split(sentence).length - 1);

/* --------------------------------- the machine ---------------------------- */

test("the five feed states are mutually exclusive and decided in one place", () => {
  assert.equal(feedPhase({ state: "loading", total: 0, visible: 0 }), "loading");
  assert.equal(feedPhase({ state: "error", total: 0, visible: 0 }), "failed");
  assert.equal(feedPhase({ state: "ready", total: 0, visible: 0 }), "empty");
  assert.equal(feedPhase({ state: "ready", total: 5, visible: 0, filtering: true }), "filtered-empty");
  assert.equal(feedPhase({ state: "ready", total: 5, visible: 3, filtering: true }), "loaded");
  // Filters with nothing behind them do not turn an empty feed into a filtered
  // one: a reader who narrowed nothing has narrowed nothing.
  assert.equal(feedPhase({ state: "ready", total: 0, visible: 0, filtering: true }), "empty");
  // Posts on screen outrank a pending or failed refresh, so stale-but-readable
  // is still the loaded state rather than a spinner drawn over content.
  assert.equal(feedPhase({ state: "loading", total: 3, visible: 3 }), "loaded");
  assert.equal(feedPhase({ state: "error", total: 3, visible: 3 }), "loaded");
});

/* ---------------------------------- Social -------------------------------- */

test("Social says one thing while it loads, and the other three lines are not on the page", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  mountSocialFeed(document, { posts: [], state: "loading" });

  const status = document.querySelector("#feed-state");
  assert.equal(status.querySelectorAll(".state-title").length, 1);
  assert.equal(textOf(status.querySelector(".state-title")), "Loading the Social feed…");

  // Removed, not hidden. Each of these would otherwise be a second description
  // of the one open fetch, and neither is a claim the page can support yet.
  assert.equal(document.querySelectorAll("#post-count").length, 0);
  assert.equal(document.querySelectorAll(".feed-connection").length, 0);
  assert.equal(document.querySelectorAll(".empty-state").length, 0);
  const body = textOf(document.body);
  assert.doesNotMatch(body, /Counting posts/);
  assert.doesNotMatch(body, /New posts will appear here on their own/);
  assert.equal((body.match(/Loading the Social feed/g) ?? []).length, 1);

  // And nothing to filter yet, so the controls say so with the attribute that
  // also takes them out of the tab order.
  for (const id of ["#post-name-filter", "#post-time-filter", "#post-filter-clear"]) {
    assert.equal(document.querySelector(id).disabled, true, `${id} is operable before there is anything to filter`);
  }
});

test("Social's status region is a top-level polite live region, not a chip", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const status = page.document.querySelector("#feed-state");

  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(collapsibleAncestor(status), null, "a live region inside a collapsible is silent when it is closed");
  // Dynamic signal, not static classification: the status region must not wear
  // the outline treatment People's display-name chooser uses.
  assert.equal(classesOf(status).includes("profile-filter-option"), false);
});

test("Social names its failure, retries it by keyboard, and comes back", async (t) => {
  // No live route, so the first fetch rejects. The seed answers with nothing, so
  // the failure is a first load rather than a degraded refresh.
  const routes = { [SEED_ROUTE]: { posts: [] } };
  const page = await loadPage(SOCIAL_PAGE, { routes });
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  t.after(() => { globalThis.setInterval = savedInterval; page.restore(); });
  const { document } = page;

  await importPageModule("/social-page.js");
  await waitFor(() => document.documentElement.dataset.shiplogSocial === "ready", "the failed first load settles");

  const status = document.querySelector("#feed-state");
  assert.match(textOf(status), /Social posts could not be loaded\./);
  assert.equal(document.querySelectorAll(".empty-state-error").length, 1);
  assert.equal(textOf(document.querySelector("#post-count")), "Unavailable");
  // A real button, in the tab order under its own steam, whose accessible name
  // is the whole instruction: a button's text is its accessible name.
  const retry = status.querySelector(".feed-status-action");
  assert.equal(retry.tagName, "BUTTON");
  assert.equal(retry.type, "button");
  assert.equal(retry.disabled, false);
  assert.equal(retry.getAttribute("tabindex"), null, "a real button needs no invented tab stop");
  assert.equal(textOf(retry), "Retry loading Social posts");
  // A failed feed has nothing to filter either.
  assert.equal(document.querySelector("#post-name-filter").disabled, true);

  // Activating it re-requests and returns the page to loading, so a second
  // failure is visibly a second attempt rather than a button that did nothing.
  routes[LIVE_ROUTE] = { posts: [
    { id: "back-1", author: "Zed", content: "Recovered.", timestamp: "2026-07-18T12:00:00.000Z" },
    { id: "back-2", author: "Ari", content: "Also here.", timestamp: "2026-07-17T12:00:00.000Z" },
  ] };
  retry.click();
  assert.equal(textOf(status.querySelector(".state-title")), "Loading the Social feed…",
    "retry did not put the page back into the loading state");
  assert.equal(document.querySelectorAll("#post-count").length, 0, "the count outlived the state that has no count");
  await waitFor(() => document.querySelectorAll("#post-count").length === 1, "the retried request settled");

  // The retry settled: the failure panel is gone, the count is back, and it is
  // the number of cards the retried request actually drew.
  const cards = document.querySelectorAll(".post-card").length;
  assert.equal(document.querySelectorAll(".empty-state-error").length, 0);
  assert.equal(textOf(document.querySelector("#post-count")), `${cards} ${cards === 1 ? "post" : "posts"}`);
  assert.doesNotMatch(textOf(document.querySelector("#post-count")), /Unavailable|Counting/);
});

test("Social separates an empty feed from a feed its filters emptied", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  const feed = mountSocialFeed(document, { posts: [], state: "ready" });

  // Genuinely empty: the invitation, and no filter wording.
  const empty = document.querySelector(".empty-state");
  assert.match(textOf(empty), /No posts on Social yet\./);
  assert.equal(document.querySelectorAll(".empty-state-filtered").length, 0);
  assert.equal(textOf(document.querySelector("#post-count")), "0 posts");
  assert.equal(document.querySelector("#post-time-filter").disabled, true,
    "an empty feed offers filters that cannot change anything");

  // Filtered to nothing: different words, its own recovery, and the empty
  // feed's invitation must not be on the page beside it.
  feed.seed(MIXED);
  assert.equal(document.querySelector("#post-time-filter").disabled, false);
  const names = document.querySelector("#post-name-filter");
  names.value = "Ari";
  names.dispatchEvent({ type: "change" });
  document.querySelector("#post-time-filter").value = "hour";
  document.querySelector("#post-time-filter").dispatchEvent({ type: "change" });

  const filtered = document.querySelector(".empty-state-filtered");
  assert.equal(document.querySelectorAll(".empty-state").length, 1);
  assert.match(textOf(filtered), /No posts/);
  assert.doesNotMatch(textOf(document.body), /No posts on Social yet\./);
  assert.equal(document.querySelectorAll(".post-card").length, 0);

  // Clear filters restores the full feed and the loaded state.
  const clear = filtered.querySelector(".feed-status-action");
  assert.equal(textOf(clear), "Clear filters");
  clear.click();
  assert.equal(document.querySelectorAll(".empty-state").length, 0);
  assert.equal(document.querySelectorAll(".post-card").length, 3);
  assert.equal(textOf(document.querySelector("#post-count")), "3 posts");
});

test("Social's count is the number of cards under the filters actually set", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  mountSocialFeed(document, { posts: MIXED, state: "ready" });

  const count = document.querySelector("#post-count");
  assert.equal(textOf(count), "3 posts");

  const names = document.querySelector("#post-name-filter");
  names.value = "Zed";
  names.dispatchEvent({ type: "change" });
  // The figure the reader sees first is the number of cards below it, not the
  // unfiltered total, and it is a literal number rather than a placeholder.
  const rendered = document.querySelectorAll(".post-card").length;
  assert.equal(rendered, 2);
  assert.equal(textOf(count), `${rendered} of 3 posts`);
  assert.doesNotMatch(textOf(count), /Counting/);
});

test("Social's promise about new posts is said only where there is a feed for them", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  const promise = "New posts will appear here on their own.";

  // The shipped frame, before any module runs. It used to carry the promise
  // authored directly above "Loading the Social feed…", which is the whole of
  // #1772: two statuses at once, and the one that could not be true yet first.
  assert.equal(promiseCount(document, promise), 0);
  assert.equal((textOf(document.body).match(/Loading the Social feed…/g) ?? []).length, 1);

  // Loading: still one statement, and it is the wait.
  // A retry the panel can offer, so the failed state below is the one a reader
  // gets: the shared status only builds a control when there is something for it
  // to run.
  const feed = mountSocialFeed(document, { posts: [], state: "loading", onRetry: () => {} });
  assert.equal(promiseCount(document, promise), 0);
  assert.equal(document.querySelectorAll(".feed-connection").length, 0);
  assert.equal(textOf(document.querySelector("#feed-state").querySelector(".state-title")), "Loading the Social feed…");

  // Failed: the panel's message and its Retry are the page's whole status. A
  // connection line here would be a second instruction — reload the page —
  // beside a button that says press this.
  feed.setState("error");
  const failure = document.querySelector(".empty-state-error");
  assert.match(textOf(failure), /Social posts could not be loaded\./);
  assert.equal(failure.querySelectorAll(".feed-status-action").length, 1);
  assert.equal(promiseCount(document, promise), 0);
  assert.equal(document.querySelectorAll(".feed-connection").length, 0);
  assert.doesNotMatch(textOf(document.body), /will not appear here/);

  // Loaded: there is a feed for new posts to arrive in, so the promise is said,
  // once, in its authored slot.
  feed.seed(MIXED);
  assert.equal(rendered(document, ".post-card"), 3);
  assert.equal(promiseCount(document, promise), 1);
  assert.equal(document.querySelectorAll(".feed-connection").length, 1);
});

/* ---------------------------------- People -------------------------------- */

test("People says one thing while it loads, and the other three lines are not on the page", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  mountProfile(document, { posts: [], author: "Zed", state: "loading" });

  const status = document.querySelector("#profile-feed-status");
  assert.equal(textOf(status), "Loading image posts…");

  assert.equal(document.querySelectorAll("#profile-summary").length, 0);
  assert.equal(document.querySelectorAll(".feed-connection").length, 0);
  assert.equal(document.querySelectorAll(".feed-create").length, 0);
  assert.equal(document.querySelectorAll(".empty-state").length, 0);
  const body = textOf(document.body);
  assert.doesNotMatch(body, /Counting image posts/);
  assert.doesNotMatch(body, /New image posts will appear here on their own/);
  assert.doesNotMatch(body, /Want a picture of your own here\?/);
  assert.equal((body.match(/Loading image posts/g) ?? []).length, 1);
});

test("People's status region is a top-level sibling and not the chooser's chip", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  mountProfile(document, { posts: MIXED, author: "Ari", state: "ready" });

  const status = document.querySelector("#profile-feed-status");
  assert.equal(collapsibleAncestor(status), null, "a status behind a closed disclosure is silent");
  // The page's one polite live region sits beside it as a top-level sibling, so
  // transitions are announced without a second voice.
  const announcer = document.querySelector("#profile-announcer");
  assert.equal(announcer.getAttribute("aria-live"), "polite");
  assert.equal(collapsibleAncestor(announcer), null);
  assert.equal(status.parentNode.tagName, announcer.parentNode.tagName);

  // Filled signal versus outline classification: the chooser's chips and the
  // status region must not share a class.
  const chip = document.querySelector(".profile-filter-option");
  assert.equal(classesOf(status).includes("profile-filter-option"), false);
  assert.equal(classesOf(chip).includes("feed-status"), false);
  for (const node of status.querySelectorAll("div")) {
    assert.equal(classesOf(node).includes("profile-filter-option"), false);
  }
});

test("People names its failure, retries it by keyboard, and comes back", async (t) => {
  const routes = { [SEED_ROUTE]: { posts: [] } };
  const page = await loadPage(PEOPLE_PAGE, { routes });
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  t.after(() => { globalThis.setInterval = savedInterval; page.restore(); });
  const { document } = page;

  await importPageModule("/profile-page.js");
  await waitFor(() => document.documentElement.dataset.shiplogProfile === "ready", "the failed first load settles");

  const status = document.querySelector("#profile-feed-status");
  assert.match(textOf(status), /Image posts could not be loaded\./);
  const retry = status.querySelector(".feed-status-action");
  assert.equal(retry.tagName, "BUTTON");
  assert.equal(retry.type, "button");
  assert.equal(retry.disabled, false);
  assert.equal(retry.getAttribute("tabindex"), null);
  assert.equal(textOf(retry), "Retry loading image posts");

  routes[LIVE_ROUTE] = { posts: [{
    id: "live-image", author: "Mina", content: "Recovered.", timestamp: "2026-07-18T12:00:00.000Z",
    image_url: "/media/Mina.svg", image_alt: "A drawing signed Mina", image_width: 1200, image_height: 900,
  }] };
  retry.click();
  assert.equal(textOf(document.querySelector("#profile-feed-status")), "Loading image posts…",
    "retry did not put the page back into the loading state");
  await waitFor(() => document.querySelectorAll(".profile-tile").length > 0, "the retried request settled");

  assert.ok(document.querySelectorAll(".profile-tile").length > 0, "the retried request drew no tiles");
  assert.equal(document.querySelectorAll(".empty-state").length, 0);
});

test("People separates a feed with no pictures from a display name with none", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  // Nobody in this feed has attached a picture, so nothing was filtered out and
  // the invitation into Paint is the honest answer.
  const profile = mountProfile(document, { posts: [post("p-11", "Ari", "11")], author: "Ari", state: "ready" });

  assert.equal(document.querySelectorAll(".empty-state").length, 1);
  assert.match(textOf(document.querySelector(".empty-state")), /Images made in Paint and published on Social appear here\./);
  assert.equal(document.querySelectorAll(".empty-state-filtered").length, 0);
  assert.doesNotMatch(textOf(document.body), /No image posts match the selected display name/);

  // Now Zed's pictures exist and Ari is still selected: the same empty grid, a
  // different reason, and the invitation must not be the answer to it.
  profile.seed(MIXED);
  const filtered = document.querySelector(".empty-state-filtered");
  assert.equal(document.querySelectorAll(".empty-state").length, 1);
  assert.match(textOf(filtered), /No image posts were published under Ari\./);
  // The way out names the control by the words printed on it and says what
  // pressing it will show: this page's reset lands on one display name rather
  // than restoring every image post.
  assert.match(textOf(filtered), /Select Clear filters to see Zed’s image posts\./);
  assert.doesNotMatch(textOf(document.body), /Images made in Paint and published on Social appear here\./);
  // And the promise about image posts arriving on their own is not standing over
  // a grid the picker emptied: it would answer "why is this empty?" with the
  // wrong reason.
  assert.equal(document.querySelectorAll(".feed-connection").length, 0);
  assert.doesNotMatch(textOf(document.body), /New image posts will appear here on their own/);
  // The panel is rendered content and the announcer is the page's one voice, so
  // the voice carries the same way out, with both names spelled: it is heard
  // away from the heading and the chips that carry them on screen.
  assert.equal(textOf(document.querySelector("#profile-announcer")),
    "Ari hasn’t posted an image yet. Select Clear filters to see Zed’s image posts.");

  // Clear filters restores the full feed and the loaded state.
  const clear = filtered.querySelector(".feed-status-action");
  assert.equal(clear.tagName, "BUTTON");
  assert.equal(clear.type, "button");
  assert.equal(textOf(clear), "Clear filters");
  clear.click();
  assert.equal(document.querySelectorAll(".empty-state").length, 0);
  assert.equal(document.querySelectorAll(".profile-tile").length, 2);
  assert.equal(profile.getAuthor(), "Zed");
});

test("People's chooser is inoperable until there is something to choose between", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  const profile = mountProfile(document, { posts: MIXED, author: "Zed", state: "loading" });

  const disabledChips = () => document.querySelectorAll(".profile-filter-option").map((chip) => chip.disabled);
  assert.deepEqual(disabledChips(), [], "a pending feed must not expose provisional names");

  profile.setState("error");
  assert.deepEqual(disabledChips(), [], "a failed first load must not expose stale names");

  profile.seed(MIXED);
  assert.deepEqual(disabledChips(), [false, false]);
  // And the count line the loading state removed is back, resolved to the number
  // of tiles rendered under the selected display name.
  assert.equal(document.querySelectorAll(".profile-tile").length, 2);
  assert.match(textOf(document.querySelector("#profile-summary")), /^2 image posts · 2 posts in total/);
  assert.equal(document.querySelectorAll(".feed-connection").length, 1);
  assert.equal(document.querySelectorAll(".feed-create").length, 1);
});

test("People's promise about new image posts is said only where there is a grid for them", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  const promise = "New image posts will appear here on their own.";

  // The shipped frame: one statement, and it is the one over the grid.
  assert.equal(promiseCount(document, promise), 0);
  assert.equal((textOf(document.body).match(/Loading image posts…/g) ?? []).length, 1);

  // With a retry to run, so the failed panel below builds the control a reader
  // is actually given.
  const profile = mountProfile(document, { posts: [], author: "Zed", state: "loading", onRetry: () => {} });
  assert.equal(promiseCount(document, promise), 0);
  assert.equal(document.querySelectorAll(".feed-connection").length, 0);
  assert.equal(textOf(document.querySelector("#profile-feed-status")), "Loading image posts…");

  // Failed: the panel names it and holds the one control that retries it.
  profile.setState("error");
  const failure = document.querySelector("#profile-feed-status");
  assert.match(textOf(failure), /Image posts could not be loaded\./);
  assert.equal(failure.querySelectorAll(".feed-status-action").length, 1);
  assert.equal(promiseCount(document, promise), 0);
  assert.equal(document.querySelectorAll(".feed-connection").length, 0);
  assert.doesNotMatch(textOf(document.body), /will not appear here/);

  // Loaded: the promise is said once, beside the tiles it is about.
  profile.seed(MIXED);
  assert.equal(rendered(document, ".profile-tile"), 2);
  assert.equal(promiseCount(document, promise), 1);
  assert.equal(document.querySelectorAll(".feed-connection").length, 1);
});
