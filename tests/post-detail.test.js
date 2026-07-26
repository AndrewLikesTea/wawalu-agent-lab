// The single-post view a profile tile navigates to: resolution plus the four
// states it must keep apart (loading, found, missing, failed).

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { byClass, createElement, first, ids, installDocument, tags } from "./support/dom.js";

installDocument();

const { findPostById, postDetailTitle, renderPostDetail } = await import("../src/post-detail.js");

const post = {
  id: "p-image",
  author: "Mina Okafor",
  body: "Focus rings landed everywhere.",
  caption: "The middle card, ringed.",
  createdAt: "2026-07-14T09:00:00.000Z",
  likes: 3,
  comments: 1,
  image: { src: "/media/focus-ring.svg", alt: "A card wrapped in a blue focus ring", width: 1200, height: 900 },
};

test("a post is found by exact id", () => {
  const posts = [post, { ...post, id: "other" }];
  assert.equal(findPostById(posts, "p-image").id, "p-image");
  assert.equal(findPostById(posts, "missing"), null);
  assert.equal(findPostById(posts, ""), null);
  assert.equal(findPostById(undefined, "p-image"), null);
});

test("the detail view shows the image whole, with its caption and counts", () => {
  const container = createElement("div");
  renderPostDetail(container, post);

  assert.equal(container.getAttribute("aria-busy"), "false");
  const article = first(container, "detail-post");
  assert.equal(article.tagName, "ARTICLE");

  const img = tags(article, "IMG")[0];
  assert.equal(img.src, "/media/focus-ring.svg");
  assert.equal(img.alt, "A card wrapped in a blue focus ring");
  // No lazy loading here: this image is the reason the page was opened.
  assert.equal(img.loading, undefined);

  const figure = tags(article, "FIGURE")[0];
  assert.equal(tags(figure, "FIGCAPTION")[0].textContent, "The middle card, ringed.");
  // A dedicated caption does not replace the body, so both are shown.
  assert.equal(first(article, "detail-body").textContent, "Focus rings landed everywhere.");

  const author = first(article, "post-author");
  assert.equal(author.tagName, "A");
  assert.equal(author.href, "/profile.html?author=Mina%20Okafor");
  assert.equal(first(article, "post-avatar").getAttribute("aria-hidden"), "true");

  assert.match(first(article, "detail-stats").textContent, /3 likes.*1 comment/);

  const label = article.getAttribute("aria-labelledby").split(" ");
  assert.equal(label.length, 2);
  for (const id of label) assert.ok(ids(article).includes(id), `${id} must resolve inside the article`);
});

test("an image without source alt uses the visible caption as its description", () => {
  const container = createElement("div");
  renderPostDetail(container, { ...post, image: { ...post.image, alt: "" } });
  assert.equal(tags(container, "IMG")[0].alt, "The middle card, ringed.");
});

test("a post with no separate caption shows its body once", () => {
  const container = createElement("div");
  renderPostDetail(container, { ...post, caption: null });
  assert.equal(tags(container, "FIGCAPTION")[0].textContent, "Focus rings landed everywhere.");
  assert.equal(byClass(container, "detail-body").length, 0, "the body is not repeated under its own caption");
});

test("a text post falls back to a labelled paragraph", () => {
  const container = createElement("div");
  renderPostDetail(container, { ...post, caption: null, image: undefined });
  assert.equal(tags(container, "FIGURE").length, 0);
  const body = first(container, "detail-body");
  assert.equal(body.textContent, "Focus rings landed everywhere.");
  assert.ok(ids(container).includes(body.id));
});

test("a dead image keeps its description rather than dropping it", () => {
  const container = createElement("div");
  renderPostDetail(container, post);
  const media = first(container, "detail-media");
  assert.equal(media.dataset.state, "loading");

  tags(container, "IMG")[0].dispatch("error");
  assert.equal(media.dataset.state, "error");
  const fallback = first(container, "detail-media-fallback");
  assert.equal(fallback.hidden, false);
  assert.equal(fallback.getAttribute("role"), "status");
  assert.ok(ids(fallback).includes(fallback.getAttribute("aria-labelledby")));
  assert.match(fallback.textContent, /Image unavailable.*Description: A card wrapped in a blue focus ring/);
  const returnLink = first(fallback, "empty-action-secondary");
  assert.equal(returnLink.tagName, "A");
  assert.equal(returnLink.href, "/profile.html?author=Mina%20Okafor");
  assert.equal(returnLink.getAttribute("aria-label"), "Return to Mina Okafor's profile");
});

test("not-found and unavailable states are labelled and return to a profile", () => {
  const missing = createElement("div");
  renderPostDetail(missing, null, { id: "p-gone", author: "Mina" });
  assert.equal(first(missing, "empty-title").textContent, "That post is not here.");
  assert.match(missing.textContent, /may have been removed/);
  assert.equal(missing.firstChild.getAttribute("role"), "status");
  assert.ok(ids(missing).includes(missing.firstChild.getAttribute("aria-labelledby")));
  assert.equal(first(missing, "empty-action-secondary").href, "/profile.html?author=Mina");

  const failed = createElement("div");
  let retried = 0;
  renderPostDetail(failed, null, { state: "error", id: "p-gone", author: "Mina", onRetry: () => { retried += 1; } });
  assert.equal(first(failed, "empty-title").textContent, "This post is temporarily unavailable.");
  assert.equal(failed.firstChild.getAttribute("role"), "alert");
  assert.equal(first(failed, "empty-action-secondary").href, "/profile.html?author=Mina");
  tags(failed, "BUTTON")[0].dispatch("click");
  assert.equal(retried, 1, "a failed load offers a retry");
});

test("an id-less visit is told what the page needs", () => {
  const container = createElement("div");
  renderPostDetail(container, null, { id: "" });
  assert.match(container.textContent, /needs a post to show/);
});

test("the loading state is labelled, busy, and has profile recovery", () => {
  const container = createElement("div");
  renderPostDetail(container, null, { state: "loading", id: "p-image", author: "Mina" });
  assert.equal(container.getAttribute("aria-busy"), "true");
  assert.equal(first(container, "empty-title").textContent, "Loading post");
  assert.equal(container.firstChild.getAttribute("role"), "status");
  assert.ok(ids(container).includes(container.firstChild.getAttribute("aria-labelledby")));
  assert.equal(first(container, "empty-action-secondary").href, "/profile.html?author=Mina");
  assert.equal(first(container, "detail-skeleton").getAttribute("aria-hidden"), "true");
});

test("the document title names the post or says it is missing", () => {
  assert.match(postDetailTitle(post), /^Mina Okafor · .+ · Shiplog$/);
  assert.equal(postDetailTitle(null), "Post not found · Shiplog");
});

test("the visible back-to-profile control is the page's first focusable element", async () => {
  const html = await readFile(new URL("../src/post.html", import.meta.url), "utf8");
  const firstAnchor = html.indexOf("<a ");
  const back = html.indexOf('id="post-back"');
  assert.ok(firstAnchor >= 0 && back > firstAnchor, "the first anchor is the back control");
  assert.match(html.slice(firstAnchor, back + 120), /class="detail-back detail-page-back"[\s\S]*aria-label="Back to profile"/);
  assert.ok(back < html.indexOf('class="brand"'), "back precedes brand and navigation in DOM order");
});
