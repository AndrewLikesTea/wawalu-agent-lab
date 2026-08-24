// A request that never answers, on Social and on People (#1999).
//
// THE DEFECT. Both pages ship a failed state with an in-place Retry, and every
// test that reached it did so through a request that *rejected* — no live route,
// so the harness threw. A browser's `fetch` has no timeout, and the failure a
// live demo actually hits is the other one: a stalled connection, or a worker
// that accepts and never answers. Nothing rejects, the catch never runs, and the
// page sits on "Loading the Social feed…" for as long as anyone will look at it
// — the perpetual loading state a prospect met, with no Retry to press, because
// a Retry is only drawn by the failed state the page never reached.
//
// WHAT IS PINNED HERE. That a hung read still lands on the state the reader can
// act on. No new state and no new copy: the deadline rejects, and the page's
// existing failure path — the same one a 500 takes — paints the same panel and
// the same Retry these tests already assert elsewhere.
//
// HOW THE WAIT IS DRIVEN. `setTimeout` is captured rather than elapsed, so the
// spec never depends on a clock and the suite never waits eight real seconds for
// it. Every captured deadline is fired: the ones whose request already answered
// reject a settled race and do nothing, which is the point of clearing them.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { REQUEST_DEADLINE_MS, withDeadline } from "../src/request-deadline.js";

const SOCIAL_PAGE = new URL("../src/social.html", import.meta.url);
const PEOPLE_PAGE = new URL("../src/profile.html", import.meta.url);
const SEED_ROUTE = "/social-demo-data.json";
const LIVE_ROUTE = "/api/social-posts?limit=100";

/**
 * Boot a page whose live-posts request is answered by nothing at all, with the
 * deadline behind it held in hand rather than left to a clock.
 */
async function pageWithHungLiveRequest(t, pageUrl) {
  const page = await loadPage(pageUrl, { routes: { [SEED_ROUTE]: { posts: [] } } });
  const savedInterval = globalThis.setInterval;
  const savedTimeout = globalThis.setTimeout;
  const seedFetch = globalThis.fetch;
  const deadlines = [];
  globalThis.setInterval = () => 0;
  globalThis.setTimeout = (callback) => { deadlines.push(callback); return 0; };
  globalThis.fetch = (url, init) => (url === LIVE_ROUTE ? new Promise(() => {}) : seedFetch(url, init));
  // page.restore() puts back the fetch loadPage installed, so the stub above
  // needs no undo of its own; the timers are this test's to return.
  t.after(() => {
    globalThis.setInterval = savedInterval;
    globalThis.setTimeout = savedTimeout;
    page.restore();
  });
  return { page, document: page.document, fireDeadlines: () => { for (const fire of deadlines) fire(); } };
}

test("Social's hung post request settles onto the failed state and its Retry", async (t) => {
  const { document, fireDeadlines } = await pageWithHungLiveRequest(t, SOCIAL_PAGE);

  await importPageModule("/social-page.js");
  // Nothing has answered and nothing has failed: this is the state the deadline
  // exists to end, and it offers the reader no control at all.
  // Two calls rather than a descendant selector: the harness rejects those.
  const feedTitle = () => document.querySelector("#feed-state")?.querySelector(".state-title");
  await waitFor(() => textOf(feedTitle() ?? { textContent: "" }) === "Loading the Social feed…",
    "the feed reaches its loading state");
  assert.equal(document.querySelector("#feed-state").querySelectorAll(".feed-status-action").length, 0,
    "a loading feed has nothing to retry yet");
  assert.equal(document.documentElement.dataset.shiplogSocial, undefined,
    "the page cannot be ready while its first read is still open");

  fireDeadlines();
  await waitFor(() => document.querySelectorAll(".empty-state-error").length === 1,
    "the hung read settles onto the failed state");

  const status = document.querySelector("#feed-state");
  assert.match(textOf(status), /Social posts could not be loaded\./);
  const retry = status.querySelector(".feed-status-action");
  assert.equal(retry.tagName, "BUTTON");
  assert.equal(retry.type, "button");
  assert.equal(textOf(retry), "Retry loading Social posts");
  // The failed state a rejection leaves, byte for byte: a read that ran out of
  // time is the same fact to the reader — nothing arrives on its own — so the
  // page grows no second dialect for it, and keeps making no promise it cannot
  // now keep.
  assert.doesNotMatch(textOf(document.body), /New posts will appear here on their own\./);
  // Nothing was invented to fill the gap: no count, and no post the request did
  // not carry.
  assert.equal(textOf(document.querySelector("#post-count")), "Unavailable");
  assert.equal(document.querySelectorAll(".post-card").length, 0);
});

test("People's hung image-post request settles onto the failed state and its Retry", async (t) => {
  const { document, fireDeadlines } = await pageWithHungLiveRequest(t, PEOPLE_PAGE);

  await importPageModule("/profile-page.js");
  await waitFor(() => textOf(document.querySelector("#profile-feed-status")) === "Loading image posts…",
    "the grid reaches its loading state");
  assert.equal(document.querySelector("#profile-feed-status").querySelectorAll(".feed-status-action").length, 0,
    "a loading grid has nothing to retry yet");
  assert.equal(document.documentElement.dataset.shiplogProfile, undefined,
    "the page cannot be ready while its first read is still open");

  fireDeadlines();
  await waitFor(() => document.querySelectorAll(".empty-state-error").length === 1,
    "the hung read settles onto the failed state");

  const status = document.querySelector("#profile-feed-status");
  assert.match(textOf(status), /Image posts could not be loaded\./);
  const retry = status.querySelector(".feed-status-action");
  assert.equal(retry.tagName, "BUTTON");
  assert.equal(retry.type, "button");
  assert.equal(textOf(retry), "Retry loading image posts");
  assert.equal(document.querySelectorAll(".profile-tile").length, 0,
    "a failed grid draws no tile, and no skeleton pretending to be one");
});

test("a read that answers inside the deadline is untouched by it", async () => {
  assert.equal(await withDeadline(Promise.resolve("answered")), "answered");
  // The caller's own rejection reaches the caller, not the deadline's wording:
  // a 500 must still be reported as a 500.
  await assert.rejects(() => withDeadline(Promise.reject(new Error("Posts API returned 500"))),
    /Posts API returned 500/);
});

test("a read that never answers rejects once the deadline passes", async () => {
  await assert.rejects(() => withDeadline(new Promise(() => {}), { ms: 0, message: "ran out of time" }),
    /ran out of time/);
  // Comfortably inside Social's ten-second poll, so a deadline can never be
  // outlived by the refresh that would have replaced it.
  assert.ok(REQUEST_DEADLINE_MS < 10_000, "the deadline must settle before the next poll opens another read");
});

test("a request that fails after losing the race is handled, not an unhandled rejection", async () => {
  let failLate;
  const request = new Promise((_, reject) => { failLate = reject; });
  await assert.rejects(() => withDeadline(request, { ms: 0, message: "ran out of time" }), /ran out of time/);
  // The losing side settles after the page has moved on. Promise.race already
  // took its rejection; if it did not, this would take the process down.
  failLate(new Error("late failure"));
  await new Promise((resolve) => setImmediate(resolve));
});
