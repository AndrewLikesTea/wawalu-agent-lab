// Render-layer tests for the social feed.
//
// The repo has no browser dependency, so this file stands up the smallest
// element stub that renderPosts actually uses (createElement, append,
// replaceChildren, class/dataset/attribute access, and event listeners) and
// asserts on the resulting tree. That is enough to pin the parts of the image
// grid that are easy to regress silently: the figure/caption pairing, the alt
// text, the labelled cards, and the loading/error/empty states.

import test from "node:test";
import assert from "node:assert/strict";
import { renderPosts } from "../src/social.js";

function createElement(tagName) {
  const node = {
    tagName: String(tagName).toUpperCase(),
    children: [],
    parent: null,
    attributes: {},
    dataset: {},
    listeners: {},
    className: "",
    hidden: false,
    ownText: "",
    get classes() { return node.className.split(" ").filter(Boolean); },
    classList: {
      add(...names) { node.className = [...new Set([...node.classes, ...names])].join(" "); },
      contains(name) { return node.classes.includes(name); },
    },
    get textContent() { return node.ownText || node.children.map((child) => child.textContent).join(" "); },
    set textContent(value) { node.ownText = String(value); node.children = []; },
    append(...nodes) {
      for (const child of nodes) {
        child.parent = node;
        node.children.push(child);
      }
    },
    replaceChildren(...nodes) {
      node.children = [];
      node.ownText = "";
      node.append(...nodes);
    },
    remove() {
      if (node.parent) node.parent.children = node.parent.children.filter((child) => child !== node);
      node.parent = null;
    },
    setAttribute(name, value) { node.attributes[name] = String(value); },
    getAttribute(name) { return node.attributes[name] ?? null; },
    addEventListener(type, handler) { (node.listeners[type] ??= []).push(handler); },
    dispatch(type) { for (const handler of node.listeners[type] ?? []) handler(); },
  };
  return node;
}

globalThis.document = { createElement };

function walk(node, predicate, found = []) {
  if (predicate(node)) found.push(node);
  for (const child of node.children) walk(child, predicate, found);
  return found;
}

const byClass = (node, name) => walk(node, (candidate) => candidate.classes.includes(name));
const first = (node, name) => byClass(node, name)[0] ?? null;
const tags = (node, tagName) => walk(node, (candidate) => candidate.tagName === tagName);

const imagePost = {
  id: "p-image",
  author: "Mina",
  body: "Focus rings landed everywhere.",
  createdAt: "2026-07-14T09:00:00.000Z",
  image: { src: "/media/focus-ring.svg", alt: "A card wrapped in a blue focus ring", width: 1200, height: 900 },
};

const textPost = { id: "p-text", author: "Kai", body: "No picture on this one.", createdAt: "2026-07-13T09:00:00.000Z" };

test("an image post renders as a figure with the caption as its figcaption", () => {
  const container = createElement("div");
  renderPosts(container, [imagePost]);

  const card = first(container, "post-card");
  assert.ok(card.classes.includes("post-card-media"));
  assert.equal(card.tabIndex, 0, "the first card is the tab stop");
  assert.equal(card.dataset.postId, "p-image");

  const figure = tags(card, "FIGURE")[0];
  assert.ok(figure, "an image post is wrapped in a <figure>");
  const caption = tags(figure, "FIGCAPTION")[0];
  assert.equal(caption.textContent, "Focus rings landed everywhere.");

  const img = tags(figure, "IMG")[0];
  assert.equal(img.src, "/media/focus-ring.svg");
  assert.equal(img.alt, "A card wrapped in a blue focus ring");
  assert.equal(img.loading, "lazy");
  assert.equal(img.decoding, "async");
  // Intrinsic dimensions reserve the tile, so the caption cannot be shoved down.
  assert.equal(img.width, 1200);
  assert.equal(img.height, 900);

  // Focusing the card announces "<author>: <caption>", not a bare "article".
  const label = card.getAttribute("aria-labelledby").split(" ");
  const ids = walk(card, () => true).map((node) => node.id).filter(Boolean);
  assert.equal(label.length, 2);
  for (const id of label) assert.ok(ids.includes(id), `${id} must resolve inside the card`);
});

test("a post without an image keeps the plain body paragraph", () => {
  const container = createElement("div");
  renderPosts(container, [textPost]);

  const card = first(container, "post-card");
  assert.equal(card.classes.includes("post-card-media"), false);
  assert.equal(tags(card, "FIGURE").length, 0);
  assert.equal(first(card, "post-body").textContent, "No picture on this one.");
});

test("an off-origin image is dropped at render time, but its post survives", () => {
  const container = createElement("div");
  renderPosts(container, [{ ...imagePost, image: { src: "https://cdn.example.com/tracker.gif", alt: "tracker" } }]);

  const card = first(container, "post-card");
  assert.equal(tags(card, "IMG").length, 0, "no off-origin request is ever issued");
  assert.equal(first(card, "post-body").textContent, "Focus rings landed everywhere.");
});

test("a broken image degrades the tile instead of the card", () => {
  const container = createElement("div");
  renderPosts(container, [imagePost]);

  const media = first(container, "post-media");
  assert.equal(media.dataset.state, "loading");
  assert.equal(first(media, "post-media-fallback").hidden, true);

  tags(media, "IMG")[0].dispatch("error");
  assert.equal(media.dataset.state, "error");
  assert.equal(tags(media, "IMG").length, 0, "the broken image element is removed");
  const fallback = first(media, "post-media-fallback");
  assert.equal(fallback.hidden, false);
  // The description outlives the element it described.
  assert.equal(fallback.textContent, "Image unavailable: A card wrapped in a blue focus ring");
  // The caption — the actual content — is untouched.
  assert.equal(first(container, "post-caption").textContent, "Focus rings landed everywhere.");
});

test("a loaded image settles the tile into its ready state", () => {
  const container = createElement("div");
  renderPosts(container, [imagePost]);
  const media = first(container, "post-media");
  tags(media, "IMG")[0].dispatch("load");
  assert.equal(media.dataset.state, "ready");
  assert.equal(first(media, "post-media-fallback").hidden, true);
});

test("the grid keeps list semantics and one roving tab stop", () => {
  const container = createElement("div");
  renderPosts(container, [imagePost, textPost]);

  const grid = first(container, "post-grid");
  assert.equal(grid.tagName, "OL");
  assert.equal(grid.getAttribute("role"), "list");

  const cards = byClass(container, "post-card");
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map((card) => card.tabIndex), [0, -1]);
  // Newest first, regardless of input order.
  assert.deepEqual(cards.map((card) => card.dataset.postId), ["p-image", "p-text"]);
});

test("empty, loading, and error states are three distinct renders", () => {
  // Nothing published yet and nothing matching the filters are different news.
  // The first is the only one that has to name Paint: an image is the part of a
  // post a reader has nowhere else to get.
  const noPosts = createElement("div");
  renderPosts(noPosts, []);
  const noPostsPanel = first(noPosts, "empty-state");
  assert.match(noPostsPanel.textContent, /No posts on Social yet\./);
  assert.match(noPostsPanel.textContent, /Publish the first one, with an image from Paint or without\./);
  const paintAction = first(noPostsPanel, "state-action");
  assert.equal(paintAction.textContent, "Create an image in Paint");
  assert.equal(paintAction.href, "/paint/");

  const empty = createElement("div");
  renderPosts(empty, [], { emptyMessage: "No Social posts match these filters." });
  assert.equal(empty.getAttribute("aria-busy"), "false");
  // Both halves name the surface: an empty screen is the worst place to leave a
  // reader guessing whether they are on Social or on People.
  assert.match(first(empty, "empty-state").textContent, /No posts on Social yet\..*No Social posts match these filters\./);

  const loading = createElement("div");
  renderPosts(loading, [], { state: "loading" });
  assert.equal(loading.getAttribute("aria-busy"), "true");
  const skeleton = first(loading, "post-grid-skeleton");
  assert.ok(skeleton, "a first load reserves the grid with placeholders");
  // Placeholders are decoration; #feed-status announces the real state.
  assert.equal(skeleton.getAttribute("aria-hidden"), "true");
  assert.equal(byClass(loading, "post-card-skeleton").length, 3);
  assert.equal(first(loading, "empty-state"), null);

  const failed = createElement("div");
  renderPosts(failed, [], { state: "error" });
  assert.equal(failed.getAttribute("aria-busy"), "false");
  assert.match(first(failed, "empty-state").textContent, /could not be loaded/);
  assert.equal(first(failed, "post-grid-skeleton"), null);
});

test("posts already on screen outrank a pending or failed refresh", () => {
  for (const state of ["loading", "error"]) {
    const container = createElement("div");
    renderPosts(container, [imagePost], { state });
    assert.equal(container.getAttribute("aria-busy"), "false");
    assert.equal(byClass(container, "post-card").length, 1, `${state} must not blank out readable posts`);
    assert.equal(first(container, "empty-state"), null);
  }
});
