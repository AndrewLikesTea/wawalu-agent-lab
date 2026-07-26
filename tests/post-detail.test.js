// The single-post view a profile tile navigates to: resolution plus the four
// states it must keep apart (loading, found, missing, failed).

import test from "node:test";
import assert from "node:assert/strict";
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
  assert.equal(first(container, "detail-media-fallback").hidden, false);
  assert.match(first(container, "detail-media-fallback").textContent, /Image unavailable: A card wrapped in a blue focus ring/);
});

test("a missing post and a failed lookup are different messages", () => {
  const missing = createElement("div");
  renderPostDetail(missing, null, { id: "p-gone" });
  assert.equal(first(missing, "empty-title").textContent, "That post is not here.");
  assert.match(missing.textContent, /may have been removed/);

  const failed = createElement("div");
  let retried = 0;
  renderPostDetail(failed, null, { state: "error", id: "p-gone", onRetry: () => { retried += 1; } });
  assert.equal(first(failed, "empty-title").textContent, "This post could not be loaded.");
  first(failed, "empty-action").dispatch("click");
  assert.equal(retried, 1, "a failed load offers a retry");
});

test("an id-less visit is told what the page needs", () => {
  const container = createElement("div");
  renderPostDetail(container, null, { id: "" });
  assert.match(container.textContent, /needs a post to show/);
});

test("the loading state is busy and empty of claims", () => {
  const container = createElement("div");
  renderPostDetail(container, null, { state: "loading", id: "p-image" });
  assert.equal(container.getAttribute("aria-busy"), "true");
  assert.equal(first(container, "detail-skeleton").getAttribute("aria-hidden"), "true");
  assert.equal(byClass(container, "empty-state").length, 0, "loading never reads as 'not found'");
});

test("the document title names the post or says it is missing", () => {
  assert.match(postDetailTitle(post), /^Mina Okafor · .+ · Shiplog$/);
  assert.equal(postDetailTitle(null), "Post not found · Shiplog");
});
