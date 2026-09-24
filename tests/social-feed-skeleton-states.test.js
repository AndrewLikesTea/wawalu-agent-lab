// Social's post-shaped wait, followed through every way the first fetch ends (#2448).
//
// The placeholders themselves shipped earlier: renderSkeleton in src/social.js,
// the authored copy in src/social.html, and a renderer-level pin in
// social-render.test.js. What nothing held end to end was the shipped page
// entry: that the grid a cold visitor meets while /api/social-posts is still
// open is post-shaped and silent, and that each of the three answers — posts,
// no posts, a failure — takes every placeholder with it rather than leaving a
// shimmer beside real cards, the empty-state sentence, or Retry.
//
// HARNESS NOTES. Placeholders wear .post-card, so drawn cards are counted as the
// ones without .post-card-skeleton. API fixtures carry `source`, or the
// normaliser drops them and "posts loaded" would pass against zero cards. The
// pending fetch is a gate this file opens; the harness's own fetch answers
// synchronously and has no way to hold a request open.

import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const SOCIAL_PAGE = new URL("../src/social.html", import.meta.url);
const SEED_ROUTE = "/social-demo-data.json";
const LIVE_ROUTE = "/api/social-posts?limit=100";

const apiPost = (id, author, day) => ({
  id,
  author,
  content: `${id} from ${author}`,
  timestamp: `2026-07-${day}T09:00:00.000Z`,
  source: "shiplog-web",
  like_count: 0,
  comment_count: 0,
});

const LIVE_POSTS = [apiPost("live-18", "Zed", "18"), apiPost("live-17", "Ari", "17"), apiPost("live-16", "Bea", "16")];

const skeletons = (document) => document.querySelectorAll(".post-card")
  .filter((card) => (card.getAttribute("class") ?? "").includes("skeleton"));
const drawnCards = (document) => document.querySelectorAll(".post-card")
  .filter((card) => !card.classList.contains("post-card-skeleton"));

// aria-hidden is set once on the placeholder grid, which hides every card in it.
function hiddenFromAssistiveTech(node) {
  for (let at = node; at; at = at.parentNode) {
    if (at.getAttribute?.("aria-hidden") === "true") return true;
  }
  return false;
}

async function bootSocial(t) {
  const page = await loadPage(SOCIAL_PAGE, { routes: { [SEED_ROUTE]: { posts: [] } } });
  const savedInterval = globalThis.setInterval;
  globalThis.setInterval = () => 0;
  t.after(() => { globalThis.setInterval = savedInterval; page.restore(); });
  let open;
  const gate = new Promise((resolve) => { open = resolve; });
  const harnessFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (url !== LIVE_ROUTE) return harnessFetch(url, options);
    const answer = await gate;
    if (answer instanceof Error) throw answer;
    return { ok: true, json: async () => structuredClone(answer) };
  };
  await importPageModule("/social-page.js");
  return { document: page.document, answer: open };
}

const settled = (document) => waitFor(() => document.documentElement.dataset.shiplogSocial === "ready",
  "the first live fetch settles");

test("Social's pending feed is post-shaped placeholders that say nothing", async (t) => {
  const { document, answer } = await bootSocial(t);
  // Let the seed fetch resolve so the page is parked on the live request.
  await new Promise((resolve) => setImmediate(resolve));

  const cards = skeletons(document);
  assert.ok(cards.length >= 3, `only ${cards.length} placeholders fill the pending feed`);
  assert.equal(drawnCards(document).length, 0);
  for (const card of cards) {
    assert.ok(card.classList.contains("post-card"), "a placeholder left the real card container");
    assert.ok(hiddenFromAssistiveTech(card), "a placeholder is exposed to assistive technology");
    assert.equal(textOf(card), "", "a placeholder carries words");
    assert.equal(card.querySelectorAll("img").length, 0, "a placeholder carries an image");
  }
  // The wait is announced once, by the status region, not by the placeholders.
  assert.equal(document.querySelectorAll("#feed-state").length, 1);
  assert.match(textOf(document.querySelector("#feed-state")), /^Posts are loading\.$/);

  answer({ posts: LIVE_POSTS });
  await settled(document);
  assert.equal(skeletons(document).length, 0, "a placeholder stayed beside the loaded posts");
  assert.equal(drawnCards(document).length, LIVE_POSTS.length);
});

test("Social's empty answer clears every placeholder and says so", async (t) => {
  const { document, answer } = await bootSocial(t);
  answer({ posts: [] });
  await settled(document);

  assert.equal(skeletons(document).length, 0, "a placeholder is standing in for posts that do not exist");
  assert.equal(document.querySelectorAll(".post-grid-skeleton").length, 0);
  assert.match(textOf(document.querySelector("#feed-state")), /No posts on Social yet\./);
});

test("Social's failed first load clears every placeholder beside the error and Retry", async (t) => {
  const { document, answer } = await bootSocial(t);
  answer(new Error("Posts API unreachable"));
  await settled(document);

  assert.equal(skeletons(document).length, 0, "a placeholder is shimmering beside the failure");
  assert.equal(document.querySelectorAll(".post-grid-skeleton").length, 0);
  assert.equal(document.querySelectorAll(".empty-state-error").length, 1);
  assert.equal(document.querySelectorAll(".feed-status-action").length, 1);
});
