// The three reading surfaces' asynchronous states, read without sight and
// operated without a mouse (#2499): Social's feed, People's image-post grid, and
// the single shared post.
//
// THE DEFECT. Most of this was already built — one status region per surface, a
// placeholder grid out of the accessibility tree, a real <button> for every
// retry. Two things were not.
//
//   1. PRESSING RETRY DROPPED THE READER. The retry control lives inside the
//      status region, and pressing it is what destroys it: every surface goes
//      back to the loading state, which replaces the panel the button was drawn
//      in. A keyboard reader was left on <body> for the whole of the second
//      fetch, one Tab from the top of the document, and the answer then landed
//      somewhere they were no longer standing.
//   2. PEOPLE ANNOUNCED EVERY STATE BUT THE ONE THAT BROKE. #profile-announcer
//      is that page's single live region and it spoke only for a settled load.
//      The failed panel is rendered content — no role, no aria-live, pinned that
//      way in tests/people-landing.test.js — so a failure was drawn on screen
//      and announced by nothing.
//
// WHAT IS PINNED HERE. Per surface: where focus is while a retried load is in
// flight and where it lands when that load answers; that the failure has a voice
// as well as a panel; that no placeholder is reachable or readable; and that the
// failed state is told apart from the empty one by words and by a mark that is
// not a colour.
//
// HARNESS NOTES. Element identity is compared with `===` inside assert.ok —
// asserting an element against a value walks the whole parsed page and hangs for
// minutes. Skeleton cards wear the same class as real ones, so every "it
// loaded" wait subtracts them. `tabindex` is read as an attribute because the
// markup authors it; `disabled` and `hidden` are read as properties because the
// modules assign them. The harness never blurs a node it removes, so every focus
// assertion here is against document.activeElement itself rather than against
// the absence of something.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, textOf, tabSequence } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { mountSocialFeed } from "../src/social.js";
import { mountProfile, PROFILE_FAILED_ANNOUNCEMENT, PROFILE_STALE_ANNOUNCEMENT, PROFILE_RETRY_LABEL } from "../src/profile.js";

const SOCIAL_PAGE = new URL("../src/social.html", import.meta.url);
const PEOPLE_PAGE = new URL("../src/profile.html", import.meta.url);
const POST_PAGE = new URL("../src/post.html", import.meta.url);
const SEED_ROUTE = "/social-demo-data.json";

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

const PICTURES = [post("p-12", "Zed", "12", { withImage: true }), post("p-13", "Zed", "13", { withImage: true })];

const classesOf = (node) => (node?.getAttribute("class") ?? "").split(" ").filter(Boolean);
const isSkeleton = (node) => classesOf(node).some((name) => name.endsWith("-skeleton"));
const drawn = (document, selector) => document.querySelectorAll(selector).filter((node) => !isSkeleton(node));

/** Is `node` inside `host`? The harness rejects descendant selectors. */
function within(node, host) {
  for (let at = node; host && at; at = at.parentNode) if (at === host) return true;
  return false;
}

/* --------------------------------- Social ---------------------------------- */

test("Social's Retry keeps the reader in the status region, then hands them the summary", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  let retried = 0;
  const feed = mountSocialFeed(document, {
    posts: [],
    state: "loading",
    onRetry: () => { retried += 1; feed.setState("loading"); },
  });
  feed.setState("error");

  const status = document.querySelector("#feed-state");
  const retry = status.querySelector(".feed-status-action");
  assert.equal(retry.tagName, "BUTTON", "the failed feed's recovery is not a real button");
  assert.equal(textOf(retry), "Retry loading Social posts");
  assert.equal(tabSequence(document).includes(retry), true, "Retry is not reachable by keyboard");

  // IN FLIGHT. The press removes the button it was made on, so the region it
  // stood in is where the reader is put — the node that just changed, and the
  // one saying the second attempt has started.
  retry.focus();
  retry.click();
  assert.equal(retried, 1, "the retry control did not re-trigger the fetch");
  assert.ok(document.activeElement === status, "pressing Retry dropped the reader to the document");
  assert.equal(status.getAttribute("tabindex"), "-1", "the landing place is not focusable");
  assert.equal(tabSequence(document).includes(status), false, "the status region became a tab stop");
  assert.match(textOf(status), /Existing posts are still loading\./);

  // ANSWERED. The region empties and hides, so the reader goes to the sentence
  // that outlives it and carries the count.
  feed.seed([post("p-11", "Ari", "11")]);
  const summary = document.querySelector("#feed-summary");
  assert.ok(document.activeElement === summary, "the answer left the reader on a hidden region");
  assert.equal(summary.getAttribute("tabindex"), "-1");
  assert.match(textOf(summary), /, newest first\.$/, "the landing sentence lost the settled summary");
  assert.equal(drawn(document, ".post-card").length, 1);
});

test("a reader who never touched Retry is not moved, and the region keeps no tab stop", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  const feed = mountSocialFeed(document, { posts: [], state: "loading", onRetry: () => {} });
  const body = document.querySelector("#post-body");
  body.focus();
  feed.setState("error");
  feed.seed([post("p-11", "Ari", "11")]);

  assert.ok(document.activeElement === body, "a render moved a reader who was not standing in the status region");
  assert.equal(document.querySelector("#feed-state").getAttribute("tabindex"), null,
    "the status region took a tabindex it never needed");
  assert.equal(document.querySelector("#feed-summary").getAttribute("tabindex"), null);
});

test("Social's placeholders are neither reachable nor readable", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  mountSocialFeed(document, { posts: [], state: "loading" });

  const placeholders = document.querySelectorAll(".post-card").filter(isSkeleton);
  assert.ok(placeholders.length > 0, "the waiting feed reserved no layout at all");
  for (const card of placeholders) {
    const hidden = document.querySelectorAll('[aria-hidden="true"]').find((host) => within(card, host));
    assert.ok(hidden, "a placeholder card is in the accessibility tree");
    assert.equal(hidden.hasAttribute("inert"), true, "the hidden placeholder grid is still interactive");
  }
  for (const stop of tabSequence(document)) {
    assert.equal(placeholders.some((card) => within(stop, card)), false, "a placeholder holds a tab stop");
  }
  // The wait itself stays in the document and stays announced.
  assert.match(textOf(document.querySelector("#feed-state")), /Existing posts are still loading\./);
});

/* --------------------------------- People ---------------------------------- */

test("People announces a failed load from the region that announces every other one", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  const profile = mountProfile(document, { posts: [], author: "Zed", state: "loading", onRetry: () => {} });

  const announcer = document.querySelector("#profile-announcer");
  assert.equal(announcer.getAttribute("aria-live"), "polite");
  assert.equal(announcer.getAttribute("aria-atomic"), "true");

  profile.setState("error");
  assert.equal(textOf(announcer), PROFILE_FAILED_ANNOUNCEMENT, "the failure was drawn but never announced");
  assert.match(textOf(announcer), /Image posts could not be loaded\./);
  // It names the control that answers it, in that control's own words.
  assert.ok(PROFILE_FAILED_ANNOUNCEMENT.includes(PROFILE_RETRY_LABEL));
  // And the panel below is still rendered content, not a second voice.
  const status = document.querySelector("#profile-feed-status");
  assert.equal(status.getAttribute("aria-live"), null);
  assert.equal(status.getAttribute("role"), null);

  // Tiles already on screen are a different fact and get different words.
  profile.seed(PICTURES);
  profile.setState("error");
  assert.equal(textOf(announcer), PROFILE_STALE_ANNOUNCEMENT);
  assert.equal(drawn(document, ".profile-tile").length, 2, "a failed refresh discarded the tiles");
});

test("People's Retry keeps the reader in the status panel, then hands them the results heading", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;

  let retried = 0;
  const profile = mountProfile(document, {
    posts: [],
    author: "Zed",
    state: "loading",
    onRetry: () => { retried += 1; profile.setState("loading"); },
  });
  profile.setState("error");

  const status = document.querySelector("#profile-feed-status");
  const retry = status.querySelector(".feed-status-action");
  assert.equal(retry.tagName, "BUTTON");
  assert.equal(textOf(retry), PROFILE_RETRY_LABEL);
  assert.equal(tabSequence(document).includes(retry), true, "Retry is not reachable by keyboard");

  retry.focus();
  retry.click();
  assert.equal(retried, 1, "the retry control did not re-trigger the fetch");
  assert.ok(document.activeElement === status, "pressing Retry dropped the reader to the document");
  assert.equal(status.getAttribute("tabindex"), "-1");
  assert.equal(tabSequence(document).includes(status), false, "the status panel became a tab stop");

  profile.seed(PICTURES);
  const heading = document.querySelector("#grid-title");
  assert.ok(document.activeElement === heading, "the answer left the reader on a hidden panel");
  assert.equal(heading.getAttribute("tabindex"), "-1");
  assert.match(textOf(heading), /Zed/, "the landing heading does not say what arrived");
  assert.equal(drawn(document, ".profile-tile").length, 2);
});

test("People's placeholders are neither reachable nor readable", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  mountProfile(document, { posts: [], author: "Zed", state: "loading" });

  const placeholders = document.querySelectorAll(".profile-tile").filter(isSkeleton);
  assert.ok(placeholders.length > 0, "the waiting grid reserved no layout at all");
  for (const tile of placeholders) {
    const hidden = document.querySelectorAll('[aria-hidden="true"]').find((host) => within(tile, host));
    assert.ok(hidden, "a placeholder tile is in the accessibility tree");
    assert.equal(hidden.hasAttribute("inert"), true);
  }
  for (const stop of tabSequence(document)) {
    assert.equal(placeholders.some((tile) => within(stop, tile)), false, "a placeholder holds a tab stop");
  }
});

/* ------------------------------ the shared post ---------------------------- */

test("the shared post's Retry keeps the reader in the status region, then hands them the post", async (t) => {
  const routes = {};
  const page = await loadPage(POST_PAGE, { location: { search: "?id=p-image" }, routes });
  t.after(() => page.restore());
  const { document } = page;

  await importPageModule("/post-page.js");
  await waitFor(() => document.querySelector("#post-detail").dataset.postState === "error",
    "the shared post page never reached its failed state");

  const region = document.querySelector("#post-detail");
  const retry = region.querySelector(".detail-retry");
  assert.equal(retry.tagName, "BUTTON");
  assert.equal(retry.type, "button");
  assert.equal(textOf(retry), "Retry the shared post");
  assert.equal(tabSequence(document).includes(retry), true, "Retry is not reachable by keyboard");

  routes[SEED_ROUTE] = {
    posts: [{
      id: "p-image",
      author: "Mina Okafor",
      body: "Focus rings landed everywhere.",
      caption: "The middle card, ringed.",
      createdAt: "2026-07-14T09:00:00.000Z",
      likes: 3,
      comments: 1,
    }],
  };
  retry.focus();
  retry.click();
  // IN FLIGHT: the region, which has just replaced the failed panel with the
  // wait and is the node that says the second attempt started.
  assert.equal(region.dataset.postState, "loading", "Retry did not put the page back into the loading state");
  assert.ok(document.activeElement === region, "pressing Retry dropped the reader to the document");
  assert.equal(region.getAttribute("tabindex"), "-1");
  assert.equal(tabSequence(document).includes(region), false, "the status region became a tab stop");

  await waitFor(() => region.dataset.postState === "loaded", "the retried lookup never settled");
  const article = drawn(document, ".detail-post")[0];
  assert.ok(document.activeElement === article, "the answer did not hand the reader the post they asked for");
});

/* ----------------------- states that do not need colour --------------------- */

test("a failed panel is marked by more than a tint", async () => {
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const rule = css.match(/\.empty-state-error \{([^}]*)\}/)?.[1] ?? "";
  assert.notEqual(rule, "", "the failed panel has no treatment of its own at all");
  assert.match(rule, /border-top:/, "the failed state is told from the empty one by colour alone");
});

test("Social's failed and empty screens are told apart by their words", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  const feed = mountSocialFeed(document, { posts: [], state: "loading", onRetry: () => {} });
  const status = document.querySelector("#feed-state");

  feed.setState("error");
  const failed = textOf(status);
  assert.match(failed, /Social feed error:/, "the failed panel does not name itself in words");
  assert.match(failed, /Social posts could not be loaded\./);
  assert.equal(classesOf(status.querySelector(".feed-status")).includes("empty-state-error"), true);

  feed.seed([]);
  const empty = textOf(status);
  assert.match(empty, /No posts on Social yet\./);
  assert.doesNotMatch(empty, /could not be loaded/, "the empty feed reads as a failure");
  assert.equal(classesOf(status.querySelector(".feed-status")).includes("empty-state-error"), false);
  assert.notEqual(failed, empty, "the two states differ by class alone");
});
