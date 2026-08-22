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

test("a titled image post reads display name, title, body, image description, time, then action", () => {
  const container = createElement("div");
  renderPosts(container, [{ ...imagePost, title: "A deliberately long title that remains after the display name" }]);

  const card = first(container, "post-card");
  assert.ok(card.classes.includes("post-card-media"));
  assert.equal(card.tabIndex, undefined, "the article is not an invented tab stop");
  assert.equal(card.dataset.postId, "p-image");

  const figure = tags(card, "FIGURE")[0];
  assert.ok(figure, "an image post is wrapped in a <figure>");
  const description = tags(figure, "FIGCAPTION")[0];
  assert.equal(description.textContent, "Image description: A card wrapped in a blue focus ring");

  const img = tags(figure, "IMG")[0];
  assert.equal(img.src, "/media/focus-ring.svg");
  assert.equal(img.alt, "A card wrapped in a blue focus ring");
  assert.equal(img.loading, "lazy");
  assert.equal(img.decoding, "async");
  // Intrinsic dimensions reserve the tile, so the caption cannot be shoved down.
  assert.equal(img.width, 1200);
  assert.equal(img.height, 900);

  const author = first(card, "post-author");
  assert.equal(author.tagName, "A");
  assert.equal(author.href, "/profile.html?author=Mina");
  assert.equal(author.getAttribute("aria-label"), "Mina — view this display name on People");
  assert.equal(first(card, "post-image-description").textContent,
    "Image description: A card wrapped in a blue focus ring");
  assert.equal(img.getAttribute("aria-describedby"), first(card, "post-image-description").id);
  const ordered = card.children.map((child) => child.className);
  assert.deepEqual(ordered, ["post-head", "post-title", "post-body post-caption", "post-figure", "post-date post-card-date", "release-detail-link"]);
  assert.equal(first(card, "post-author").textContent, "Mina");
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
  // The description outlives the element it described, under a label chip that
  // says what happened in words.
  assert.equal(fallback.textContent, "Image unavailable A card wrapped in a blue focus ring");
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

test("the grid keeps list semantics and leaves focus on native links", () => {
  const container = createElement("div");
  renderPosts(container, [imagePost, textPost]);

  const grid = first(container, "post-grid");
  assert.equal(grid.tagName, "OL");
  assert.equal(grid.getAttribute("role"), "list");

  const cards = byClass(container, "post-card");
  assert.equal(cards.length, 2);
  assert.deepEqual(cards.map((card) => card.tabIndex), [undefined, undefined]);
  assert.equal(first(cards[0], "post-author").tagName, "A");
  // Newest first, regardless of input order.
  assert.deepEqual(cards.map((card) => card.dataset.postId), ["p-image", "p-text"]);
});

// The feed used to have no way into a post at all: a reader could see a card
// and had nowhere to go from it. Every card now ends on one named anchor to that
// post's own page, in the same words People's tiles print and the same words the
// hero sentence tells a reader to look for.
test("every card carries one control named Open post, pointing at that post", () => {
  const container = createElement("div");
  renderPosts(container, [imagePost, textPost]);

  // Placeholders wear .post-card too, so a count that included them would pass
  // against a feed holding no posts at all.
  const cards = byClass(container, "post-card").filter((card) => !card.classes.includes("post-card-skeleton"));
  assert.equal(cards.length, 2, "the per-card assertions below need real cards");

  for (const [index, post] of [imagePost, textPost].entries()) {
    const card = cards[index];
    const opens = byClass(card, "release-detail-link");
    assert.equal(opens.length, 1, "a card names its way into the post exactly once");
    const open = opens[0];
    assert.equal(open.tagName, "A", "a route to another page is an anchor, not a scripted click target");
    assert.equal(open.textContent, "Open post");
    assert.equal(open.href, `/post.html?id=${post.id}&author=${post.author}`,
      "the card opens its own post, not the feed's first one");
    // Named by the action; the post it opens is the description, so the two are
    // announced together without the body being read into the link's name.
    assert.equal(open.getAttribute("aria-describedby"), first(card, "post-body").id);
    // Last child, by index rather than by node identity: a failed identity
    // comparison would print the whole parsed card.
    assert.equal(card.children.indexOf(open), card.children.length - 1,
      "the action is offered before the reader has the post it acts on");
  }
});

test("empty, loading, and error states are three distinct renders", () => {
  // Nothing published yet and nothing matching the filters are different news.
  // The first is the only one that has to name Paint: an image is the part of a
  // post a reader has nowhere else to get.
  const noPosts = createElement("div");
  renderPosts(noPosts, []);
  const noPostsPanel = first(noPosts, "empty-state");
  assert.match(noPostsPanel.textContent, /No posts on Social yet\./);
  assert.match(noPostsPanel.textContent, /Write a post, or create an image in Paint first\./);
  // The sentence points at Paint; the button that used to repeat it under this
  // line is gone. Social offered one action in three places — the hero, the
  // composer, and here — and the composer's is the one beside the field an image
  // is actually attached to. Counted, not compared against null.
  assert.equal(byClass(noPostsPanel, "state-action").length, 0,
    "the empty state offers Paint a second time under the sentence that names it");

  const empty = createElement("div");
  renderPosts(empty, [], { noMatch: { author: "Ari", range: "from the past hour", total: 4, onClear() {} } });
  assert.equal(empty.getAttribute("aria-busy"), "false");
  // The filtered dead end names the surface too, but nothing else about it is
  // shared: it says what excluded the posts, how many are waiting behind the
  // filters, and offers the control that brings them back.
  const filtered = first(empty, "empty-state");
  assert.match(filtered.textContent, /No posts by Ari from the past hour\. Select Clear filters to see all 4 posts\./);
  // The way out names the control by the words printed on it.
  assert.match(filtered.textContent, /Select Clear filters to/);
  assert.doesNotMatch(filtered.textContent, /No posts on Social yet/);
  const clear = first(filtered, "state-action");
  assert.equal(clear.tagName, "BUTTON");
  assert.equal(clear.type, "button");
  assert.equal(clear.textContent, "Clear filters");

  const loading = createElement("div");
  renderPosts(loading, [], { state: "loading" });
  assert.equal(loading.getAttribute("aria-busy"), "true");
  const skeleton = first(loading, "post-grid-skeleton");
  assert.ok(skeleton, "a first load reserves the grid with placeholders");
  // Visible words on every reserved card, but still out of the accessibility
  // tree: #feed-status announces the state once, and no card claims to be a
  // post, because the count is what the open fetch has not answered yet.
  assert.equal(skeleton.getAttribute("aria-hidden"), "true");
  assert.equal(byClass(loading, "post-card-skeleton").length, 3);
  const labels = byClass(loading, "skeleton-label");
  assert.equal(labels.length, 3, "every reserved card says what it is holding open");
  assert.ok(labels.every((node) => node.textContent === "Loading post"));
  assert.equal(tags(skeleton, "A").length + tags(skeleton, "BUTTON").length, 0);
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
