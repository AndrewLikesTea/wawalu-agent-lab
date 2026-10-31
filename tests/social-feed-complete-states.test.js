import test from "node:test";
import assert from "node:assert/strict";
import { loadPage, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { mountSocialFeed } from "../src/social.js";

const PAGE = new URL("../src/social.html", import.meta.url);
const LIVE = "/api/social-posts?limit=100";
const post = { id: "one", author: "Mina", body: "Shipped", createdAt: "2020-01-01T00:00:00.000Z" };
const apiPost = { ...post, content: post.body, timestamp: post.createdAt, source: "human" };
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

function assertState(document, phase, action = "") {
  const region = document.querySelector("#feed-state");
  assert.equal(region.getAttribute("role"), "status");
  assert.equal(region.getAttribute("aria-live"), "polite");
  assert.equal(region.getAttribute("aria-atomic"), "true");
  // "stale" is a failed refresh over posts already shown: they stay, Retry joins them.
  const stale = phase === "stale";
  assert.deepEqual(region.querySelectorAll(".feed-status").map((node) => node.dataset.state),
    phase === "loaded" ? [] : [stale ? "error" : phase]);
  assert.deepEqual(region.querySelectorAll("button").map((node) => textOf(node)), action ? [action] : []);
  assert.equal(document.querySelectorAll("article.post-card").length, phase === "loaded" || stale ? 1 : 0);
  assert.equal(document.querySelector("#post-feed").getAttribute("aria-busy"), String(phase === "loading"));
  const trigger = document.querySelector("#post-compose-open");
  assert.equal(Boolean(trigger.disabled), false);
  assert.equal(trigger.hidden, false);
  assert.equal(Boolean(document.querySelector("#post-submit").disabled), false);
  if (phase === "loading" || phase === "error") {
    assert.equal(textOf(document.querySelector("#feed-summary")), "");
    assert.equal(document.querySelectorAll(".feed-connection").length, 0);
    assert.doesNotMatch(textOf(region), /No posts|Clear filters|Write a post/);
  }
}

test("Social transitions exclusively through all states and preserves an open draft", async (t) => {
  const page = await loadPage(PAGE);
  t.after(() => page.restore());
  const { document } = page;
  let retries = 0;
  const feed = mountSocialFeed(document, {
    posts: [], state: "loading",
    onRetry: () => { retries++; feed.setState("loading"); },
  });
  assertState(document, "loading");
  const trigger = document.querySelector("#post-compose-open");
  trigger.focus();
  pressEnter(document);
  const draft = document.querySelector("#post-body");
  draft.value = "Keep this draft";
  draft.focus();

  feed.setState("error");
  assertState(document, "error", "Retry loading Social posts");
  assert.equal(document.querySelector("#post-compose-panel").hidden, false);
  assert.equal(document.activeElement.id, "post-body");
  feed.seed([post]);
  assertState(document, "loaded");
  feed.seed([]);
  assertState(document, "empty", "Write a post");
  assert.equal(draft.value, "Keep this draft");
  feed.composer.close();
  const firstPost = document.querySelector(".feed-status-action");
  firstPost.focus();
  pressEnter(document);
  assert.equal(document.querySelector("#post-compose-panel").hidden, false);
  assert.equal(document.activeElement.id, "post-form-title");
  feed.composer.close();

  feed.seed([post]);
  const name = document.querySelector("#post-name-filter");
  const time = document.querySelector("#post-time-filter");
  assert.ok(tabSequence(document).indexOf(trigger) < tabSequence(document).indexOf(name),
    "the existing composer trigger precedes the feed filters");
  name.focus();
  pressTab(document);
  assert.equal(document.activeElement.id, "post-time-filter");
  time.value = "hour";
  time.dispatchEvent({ type: "change", bubbles: true });
  assertState(document, "filtered", "Clear filters");
  pressTab(document);
  assert.equal(document.activeElement.id, "post-filter-clear");
  pressTab(document);
  assert.equal(textOf(document.activeElement), "Clear filters");
  pressTab(document);
  assert.equal(textOf(document.activeElement), "How reporting works");
  const clear = document.querySelector(".feed-status-action");
  clear.focus();
  pressEnter(document);
  assert.equal(time.value, "all");
  assert.equal(name.value, "all");
  assertState(document, "loaded");
  assert.equal(document.activeElement.classList.contains("release-detail-link"), true);

  feed.setState("error");
  assertState(document, "stale", "Retry loading Social posts");
  const retry = document.querySelector(".feed-status-action");
  retry.focus();
  pressTab(document);
  assert.equal(textOf(document.activeElement), "Mina", "Retry leads into the first post’s author link");
  assert.equal(document.activeElement.getAttribute("href"), "/profile.html?author=Mina");
  retry.focus();
  pressEnter(document);
  assert.equal(retries, 1);
  assertState(document, "loaded");
  assert.equal(draft.value, "Keep this draft");
  assert.equal(document.activeElement.id, "feed-summary");
});

test("live loading never paints demo data; overlapping refresh and Retry join one request", async (t) => {
  const page = await loadPage(PAGE, { routes: { "/social-demo-data.json": { posts: [post] } } });
  const originalInterval = globalThis.setInterval;
  let tick;
  globalThis.setInterval = (callback) => { tick = callback; return 0; };
  t.after(() => { globalThis.setInterval = originalInterval; page.restore(); });
  const attempts = [];
  const harnessFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (url !== LIVE) return harnessFetch(url, options);
    const answer = await new Promise((resolve) => attempts.push(resolve));
    if (answer instanceof Error) throw answer;
    return { ok: true, json: async () => answer };
  };
  await importPageModule("/social-page.js");
  await waitFor(() => attempts.length === 1, "first API request");
  await flush();
  assertState(page.document, "loading");
  attempts[0]({ posts: [apiPost] });
  await waitFor(() => page.document.documentElement.dataset.shiplogSocial === "ready", "first result");
  assertState(page.document, "loaded");

  tick();
  await flush();
  attempts[1](new Error("Offline"));
  await flush();
  assertState(page.document, "stale", "Retry loading Social posts");
  // A background request is already open when the visitor presses Retry twice.
  tick();
  const retry = page.document.querySelector(".feed-status-action");
  retry.click();
  retry.click();
  page.document.dispatchEvent({ type: "visibilitychange" });
  tick();
  await flush();
  assert.equal(attempts.length, 3, "overlapping triggers must not create stale competing responses");
  assertState(page.document, "loaded");
  attempts[2]({ posts: [apiPost] });
  await flush();
  assertState(page.document, "loaded");
  assert.equal(attempts.length, 3);
});
