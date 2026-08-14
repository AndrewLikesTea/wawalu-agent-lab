// The failed feed state on Social and People, and getting out of it (#1743).
//
// WHAT WAS ALREADY THERE. The failure state itself is shipped: renderFeedStatus
// (src/feed-status.js) draws one panel per state, the "failed" branch of the
// shared machine names the failure in words, and both page entries hand it an
// onRetry that re-requests from the page it is standing on. tests/feed-one-
// state.test.js pins the first failure and one successful retry on each page.
//
// WHAT THIS ADDS. The half of the loop nobody had walked: what a *second*
// failure looks like. A retry that fails again has to leave the reader exactly
// where the first failure did — one status, still named, still retryable — and
// not a disabled button, a stacked pair of panels, or a page that quietly went
// blank. And it adds the invariant across the whole sequence rather than at its
// ends: at every step exactly one of loading, empty, error, or posts is on the
// page.
//
// It also pins the part the failure state was contradicting in the same breath
// as promising it. Both panels tell the reader the rest of the page is intact —
// "Your filters and anything in the composer are unchanged", "The selected
// display-name filter is unchanged" — while the controls those sentences name
// were being disabled by the same render. A reader who narrowed Social to
// nothing and then lost the connection could not press Clear filters; a reader
// on People could not move to a display name whose pictures were already
// rendered. The rule is now what is behind a control, not which phase drew the
// panel, so a failure never takes away a way out that still works.
//
// HARNESS NOTES. Counts and attributes only: asserting equality against an
// element node hangs for minutes here. Button type is read off the property
// because this double reflects nothing, skeleton cards carry the same class as
// real ones so they are subtracted rather than excluded with :not(), and every
// dataset read goes through `?.` because text nodes sit in node.children.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { mountSocialFeed } from "../src/social.js";
import { mountProfile } from "../src/profile.js";

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

const MIXED = [
  post("p-11", "Ari", "11"),
  post("p-12", "Zed", "12", { withImage: true }),
  post("p-13", "Zed", "13", { withImage: true }),
];

// `source` is not optional: normalizeSocialApiPosts drops any post without one,
// so a fixture missing it recovers into an *empty* feed rather than a loaded one
// — which is a passing retry assertion that proves nothing.
const LIVE_POSTS = {
  posts: [
    { id: "back-1", author: "Zed", content: "Recovered.", timestamp: "2026-07-18T12:00:00.000Z", source: "human" },
    { id: "back-2", author: "Ari", content: "Also here.", timestamp: "2026-07-17T12:00:00.000Z", source: "human" },
  ],
};

const LIVE_IMAGE_POSTS = {
  posts: [{
    id: "live-image", author: "Mina", content: "Recovered.", timestamp: "2026-07-18T12:00:00.000Z",
    image_url: "/media/Mina.svg", image_alt: "A drawing signed Mina", image_width: 1200, image_height: 900,
  }],
};

/* ------------------------- one state at a time ---------------------------- */

// Every feed state the reader can be in, named, at one instant. The status
// panels carry their own state on `data-state`, and rendered cards are the
// fifth: the skeleton wears the card class too, so it is subtracted rather than
// filtered out with a selector this harness will not parse. The invariant under
// test is that this list always has exactly one entry.
function feedStates(document, { statusId, cardClass, skeletonClass }) {
  const region = document.querySelector(statusId);
  const panels = region
    ? region.querySelectorAll(".feed-status").map((panel) => panel.dataset?.state).filter(Boolean)
    : [];
  const rendered = document.querySelectorAll(cardClass).length
    - document.querySelectorAll(skeletonClass).length;
  return rendered > 0 ? [...panels, "posts"] : panels;
}

const socialStates = (document) => feedStates(document, {
  statusId: "#feed-state", cardClass: ".post-card", skeletonClass: ".post-card-skeleton",
});

const peopleStates = (document) => feedStates(document, {
  statusId: "#profile-feed-status", cardClass: ".profile-tile", skeletonClass: ".profile-tile-skeleton",
});

const retryControl = (document, statusId) => document.querySelector(statusId).querySelector(".feed-status-action");

/* --------------------------------- Social --------------------------------- */

test("Social's failed feed survives a second failure and is still retryable", async (t) => {
  // No live route, so every attempt rejects until one is added. The seed answers
  // with nothing, so this is a first load rather than a degraded refresh.
  const routes = { [SEED_ROUTE]: { posts: [] } };
  const page = await loadPage(SOCIAL_PAGE, { routes });
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  t.after(() => { globalThis.setInterval = savedInterval; page.restore(); });
  const { document } = page;

  await importPageModule("/social-page.js");
  await waitFor(() => document.documentElement.dataset.shiplogSocial === "ready", "the failed first load settles");

  // One state, and it is the failure: no loading line and no empty message
  // beside it.
  assert.deepEqual(socialStates(document), ["error"]);
  const status = document.querySelector("#feed-state");
  // Named in words, not in colour, and it says what is still standing.
  assert.match(textOf(status), /Social posts could not be loaded\./);
  assert.match(textOf(status), /Your filters and anything in the composer are unchanged\./);
  assert.doesNotMatch(textOf(document.body), /Loading the Social feed/);
  assert.doesNotMatch(textOf(document.body), /No posts on Social yet/);

  // The composer is not collateral damage: it is on the page and it can be used.
  assert.equal(document.querySelectorAll("#post-form").length, 1);
  assert.equal(document.querySelector("#post-body").disabled, false);
  assert.equal(document.querySelector("#post-submit").disabled, false);

  const first = retryControl(document, "#feed-state");
  assert.equal(first.tagName, "BUTTON");
  assert.equal(first.type, "button");
  assert.equal(first.disabled, false);
  assert.equal(first.getAttribute("tabindex"), null, "a real button needs no invented tab stop");
  assert.equal(textOf(first), "Retry loading Social posts");

  // Attempt two, still with no live route. The page says out loud that it is
  // trying again…
  first.click();
  assert.deepEqual(socialStates(document), ["loading"], "retry did not return the page to the loading state");
  await waitFor(() => socialStates(document).join() === "error", "the second attempt settled");

  // …and lands back on one failure panel, not two, with the control live.
  assert.deepEqual(socialStates(document), ["error"]);
  assert.equal(status.querySelectorAll(".feed-status").length, 1, "a second failure stacked a second status");
  assert.equal(status.querySelectorAll(".feed-status-action").length, 1);
  const second = retryControl(document, "#feed-state");
  assert.equal(second.disabled, false, "the retry control went dead after a second failure");
  assert.equal(textOf(second), "Retry loading Social posts");
  assert.equal(textOf(document.querySelector("#post-count")), "Unavailable");

  // Attempt three answers. Retry re-requests from this page — nothing here
  // reloads or navigates — so the status is replaced by the posts it fetched.
  routes[LIVE_ROUTE] = LIVE_POSTS;
  second.click();
  assert.deepEqual(socialStates(document), ["loading"]);
  await waitFor(() => socialStates(document).join() === "posts", "the retried request settled");

  assert.deepEqual(socialStates(document), ["posts"]);
  assert.equal(status.querySelectorAll(".feed-status").length, 0);
  assert.equal(document.querySelectorAll(".post-card").length, 2);
  assert.equal(textOf(document.querySelector("#post-count")), "2 posts");
});

test("a Social refresh that fails over filtered-out posts leaves the way out operable", async (t) => {
  const page = await loadPage(SOCIAL_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  const feed = mountSocialFeed(document, { posts: MIXED, state: "ready" });

  // Narrow to nothing, then lose the connection. The failure outranks the
  // filtered dead end — one state at a time — but the filters that produced the
  // empty screen are the reader's way out of it and have to still work.
  const names = document.querySelector("#post-name-filter");
  names.value = "Ari";
  names.dispatchEvent({ type: "change" });
  document.querySelector("#post-time-filter").value = "hour";
  document.querySelector("#post-time-filter").dispatchEvent({ type: "change" });
  assert.deepEqual(socialStates(document), ["filtered"]);

  feed.setState("error");
  assert.deepEqual(socialStates(document), ["error"]);
  for (const id of ["#post-name-filter", "#post-time-filter", "#post-filter-clear"]) {
    assert.equal(document.querySelector(id).disabled, false,
      `${id} was disabled by a failure, trapping the reader on an empty screen`);
  }

  // And it is a real way out: widening the filters brings the posts back even
  // though the feed is still in its failed state.
  document.querySelector("#post-time-filter").value = "all";
  document.querySelector("#post-time-filter").dispatchEvent({ type: "change" });
  names.value = "all";
  names.dispatchEvent({ type: "change" });
  assert.deepEqual(socialStates(document), ["posts"]);
  assert.equal(document.querySelectorAll(".post-card").length, 3);
});

/* --------------------------------- People --------------------------------- */

test("People's failed feed survives a second failure and is still retryable", async (t) => {
  const routes = { [SEED_ROUTE]: { posts: [] } };
  const page = await loadPage(PEOPLE_PAGE, { routes });
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  t.after(() => { globalThis.setInterval = savedInterval; page.restore(); });
  const { document } = page;

  await importPageModule("/profile-page.js");
  await waitFor(() => document.documentElement.dataset.shiplogProfile === "ready", "the failed first load settles");

  assert.deepEqual(peopleStates(document), ["error"]);
  const status = document.querySelector("#profile-feed-status");
  assert.match(textOf(status), /Image posts could not be loaded\./);
  assert.match(textOf(status), /The selected display-name filter is unchanged\./);
  assert.doesNotMatch(textOf(document.body), /Loading image posts/);
  assert.doesNotMatch(textOf(document.body), /Images made in Paint and published on Social appear here/);

  // The chooser is still on the page. With nothing loaded it has one name in it
  // and says so in a sentence, which is the state that has no control to offer —
  // not a row of controls taken away by the failure.
  assert.equal(document.querySelectorAll("#profile-author").length, 1);

  const first = retryControl(document, "#profile-feed-status");
  assert.equal(first.tagName, "BUTTON");
  assert.equal(first.type, "button");
  assert.equal(first.disabled, false);
  assert.equal(first.getAttribute("tabindex"), null);
  assert.equal(textOf(first), "Retry loading image posts");

  first.click();
  assert.deepEqual(peopleStates(document), ["loading"], "retry did not return the page to the loading state");
  await waitFor(() => peopleStates(document).join() === "error", "the second attempt settled");

  assert.deepEqual(peopleStates(document), ["error"]);
  assert.equal(status.querySelectorAll(".feed-status").length, 1, "a second failure stacked a second status");
  assert.equal(status.querySelectorAll(".feed-status-action").length, 1);
  const second = retryControl(document, "#profile-feed-status");
  assert.equal(second.disabled, false, "the retry control went dead after a second failure");
  assert.equal(textOf(second), "Retry loading image posts");

  routes[LIVE_ROUTE] = LIVE_IMAGE_POSTS;
  second.click();
  assert.deepEqual(peopleStates(document), ["loading"]);
  await waitFor(() => peopleStates(document).join() === "posts", "the retried request settled");

  assert.deepEqual(peopleStates(document), ["posts"]);
  assert.equal(status.querySelectorAll(".feed-status").length, 0);
  assert.equal(document.querySelectorAll(".profile-tile").length, 1);
});

test("a failed People refresh leaves the display-name chooser operable", async (t) => {
  const page = await loadPage(PEOPLE_PAGE, {});
  t.after(() => page.restore());
  const { document } = page;
  // Ari is selected and has no pictures, so this grid is empty while Zed's two
  // are already loaded behind the picker.
  const profile = mountProfile(document, { posts: MIXED, author: "Ari", state: "ready" });
  assert.deepEqual(peopleStates(document), ["filtered"]);

  profile.setState("error");
  assert.deepEqual(peopleStates(document), ["error"]);
  const chips = document.querySelectorAll(".profile-filter-option");
  assert.equal(chips.length, 2);
  for (const chip of chips) {
    assert.equal(chip.disabled, false, "a failed refresh disabled the only control that moves between display names");
    assert.equal(chip.tagName, "BUTTON");
    assert.equal(chip.type, "button");
  }

  // Pressing one works: the pictures that were already loaded are reachable even
  // though the feed is still in its failed state.
  document.querySelectorAll(".profile-filter-option").find((chip) => chip.dataset?.author === "Zed").click();
  assert.equal(profile.getAuthor(), "Zed");
  assert.deepEqual(peopleStates(document), ["posts"]);
  assert.equal(document.querySelectorAll(".profile-tile").length, 2);
});
