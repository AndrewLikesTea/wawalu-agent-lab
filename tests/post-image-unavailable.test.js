// The read-time image failure, pinned on all three surfaces that render a
// published post's image: the Social feed, a People image-post tile, and a post
// permalink.
//
// NOT the composer's preview failure (#compose-preview-error in src/social.html),
// which is pre-publish and is covered elsewhere. This is the case where the post
// is already out — a dead host, an expired blob, a connection that gave up — and
// somebody reading it gets no picture. What must survive that is the label
// ("Image unavailable") and the description the poster was required to write,
// both as real on-screen text, because the description in an alt attribute is
// exactly the text a sighted reader of a broken image cannot get at.
//
// WHAT THIS HARNESS CANNOT SEE, AND HOW THESE TESTS COMPENSATE.
// tests/support/dom.js models no layout, so `textContent` reads straight through
// a container that a browser would have collapsed, clipped, or hidden. A
// placeholder that is invisible in Chrome would still pass a naive
// `assert.match(fallback.textContent, /Image unavailable/)`. So each surface here
// asserts on text that is (a) the node's OWN text, not a descendant's, and (b)
// under an unbroken chain of non-hidden ancestors, and separately asserts that
// the frame reached the `error` state the stylesheet actually paints. Anything
// beyond that — real pixels, real contrast — is a browser's job, not this file's.
//
// Assertions are per surface on purpose. One shared "check a card" helper would
// have really exercised the feed and taken the other two on trust, and these
// three renderers are three separate functions in three separate modules.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { byClass, createElement, first, installDocument, tags, walk } from "./support/dom.js";

installDocument();

const { renderPosts } = await import("../src/social.js");
const { renderProfileGrid } = await import("../src/profile.js");
const { renderPostDetail } = await import("../src/post-detail.js");

// An src nothing can resolve. The stub issues no request, so the `error` event
// below is what actually stands in for "the browser tried and failed"; the dead
// path is here so the fixture is not quietly a working image.
const DEAD_SRC = "/media/expired-blob-7f3c.svg";
const DESCRIPTION = "A card wrapped in a blue focus ring";

const post = {
  id: "p-image",
  author: "Mina Okafor",
  body: "Focus rings landed everywhere.",
  caption: null,
  createdAt: "2026-07-14T09:00:00.000Z",
  likes: 3,
  comments: 1,
  image: { src: DEAD_SRC, alt: DESCRIPTION, width: 1200, height: 900 },
};

/** True only when the node and every ancestor up to `root` is unhidden. */
function shown(node, root) {
  for (let cursor = node; cursor; cursor = cursor.parent) {
    if (cursor.hidden === true) return false;
    if (cursor === root) return true;
  }
  return true;
}

/**
 * Every string a reader would actually be handed: own text only, from nodes no
 * hidden ancestor has taken out of the render. `textContent` would happily read
 * the alt-only, display:none, or `hidden` cases this is written to exclude.
 */
function visibleStrings(root) {
  return walk(root, (node) => Boolean(node.ownText) && shown(node, root)).map((node) => node.ownText);
}

/** Tab stops, counted the way a keyboard reader meets them. */
function tabStops(root) {
  return walk(root, (node) => {
    if (!shown(node, root)) return false;
    if (typeof node.tabIndex === "number") return node.tabIndex >= 0;
    if (node.getAttribute("tabindex") !== null) return Number(node.getAttribute("tabindex")) >= 0;
    return ["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(node.tagName);
  }).length;
}

/** Index of a node in a depth-first walk, for reading-order assertions. */
function order(root, node) {
  return walk(root, () => true).indexOf(node);
}

/* ------------------------------- the feed -------------------------------- */

test("Social feed: a post whose image dies still shows the label and the description", () => {
  const container = createElement("div");
  renderPosts(container, [post]);

  const media = first(container, "post-media");
  const loadedStops = tabStops(container);
  tags(media, "IMG")[0].dispatch("error");

  // The stylesheet paints the placeholder off this attribute, so a placeholder
  // whose frame never reached `error` is a placeholder nobody would see.
  assert.equal(media.dataset.state, "error");
  const fallback = first(container, "post-media-fallback");
  assert.equal(fallback.hidden, false);

  const visible = visibleStrings(container);
  assert.ok(visible.includes("Image unavailable"), "the label is rendered text, not a class name");
  assert.ok(visible.includes(DESCRIPTION), "the description is rendered text, not just an alt");

  // Reading order: caption, display name and timestamp all still present, and
  // the placeholder sits where the image was rather than after the card.
  const caption = first(container, "post-caption");
  const author = first(container, "post-author");
  const time = tags(container, "TIME")[0];
  assert.equal(caption.textContent, "Focus rings landed everywhere.");
  assert.equal(author.textContent, "Mina Okafor");
  assert.equal(time.dateTime, post.createdAt);
  assert.ok(order(container, author) < order(container, time));
  assert.ok(order(container, time) < order(container, fallback));
  assert.ok(order(container, fallback) < order(container, caption), "the placeholder took the image's place");

  // Same number of tab stops broken as unbroken: the placeholder adds no control.
  assert.equal(tabStops(container), loadedStops);
});

/* ------------------------------ People tiles ------------------------------ */

test("People tile: a post whose image dies still shows the label and the description", () => {
  const container = createElement("div");
  renderProfileGrid(container, [post], { author: "Mina Okafor" });

  const media = first(container, "profile-media");
  const loadedStops = tabStops(container);
  tags(container, "IMG")[0].dispatch("error");

  assert.equal(media.dataset.state, "error");
  const fallback = first(container, "profile-media-fallback");
  assert.equal(fallback.hidden, false);

  const visible = visibleStrings(container);
  assert.ok(visible.includes("Image unavailable"), "the label is rendered text, not a class name");
  assert.ok(visible.includes(DESCRIPTION), "the description is rendered text, not just an alt");

  const caption = first(container, "profile-tile-caption");
  const time = tags(container, "TIME")[0];
  assert.equal(caption.textContent, "Focus rings landed everywhere.");
  assert.equal(time.dateTime, post.createdAt);
  assert.ok(order(container, fallback) < order(container, caption), "the placeholder took the image's place");
  assert.ok(order(container, caption) < order(container, time));

  // The tile is one link before and one link after; the placeholder is text
  // inside it, so the grid's tab order is untouched.
  assert.equal(tabStops(container), loadedStops);
  assert.equal(tabStops(container), 1);
});

/* ------------------------------- permalink -------------------------------- */

test("permalink: a post whose image dies still shows the label and the description", () => {
  const container = createElement("div");
  renderPostDetail(container, post);

  const media = first(container, "detail-media");
  const loadedStops = tabStops(container);
  tags(container, "IMG")[0].dispatch("error");

  assert.equal(media.dataset.state, "error");
  const fallback = first(container, "detail-media-fallback");
  assert.equal(fallback.hidden, false);

  const visible = visibleStrings(container);
  assert.ok(visible.includes("Image unavailable"), "the label is rendered text, not a class name");
  assert.ok(
    visible.some((line) => line.includes(DESCRIPTION)),
    "the description is rendered text, not just an alt",
  );

  const caption = tags(container, "FIGCAPTION")[0];
  const time = tags(container, "TIME")[0];
  assert.equal(caption.textContent, "Focus rings landed everywhere.");
  assert.equal(time.dateTime, post.createdAt);
  assert.ok(order(container, fallback) < order(container, caption), "the placeholder took the image's place");
  assert.ok(order(container, caption) < order(container, time), "media and caption lead the posting time");

  assert.equal(tabStops(container), loadedStops);
});

/* ------------------------- shared shape, all three ------------------------ */

test("the placeholder is one shape on all three surfaces, and it is an outline chip", async () => {
  const chips = [];
  for (const [name, render] of [
    ["feed", (container) => renderPosts(container, [post])],
    ["people", (container) => renderProfileGrid(container, [post], { author: "Mina Okafor" })],
    ["permalink", (container) => renderPostDetail(container, post)],
  ]) {
    const container = createElement("div");
    render(container);
    tags(container, "IMG")[0].dispatch("error");
    const chip = first(container, "detail-state-chip");
    assert.equal(chip.textContent, "Image unavailable", `${name}: the label is the same words`);
    // Shape, not hue: the chip is a bordered box and the frame around it draws
    // its own inset border, so a reader who perceives no colour still gets two
    // non-colour cues plus the words themselves.
    assert.equal(chip.classes.includes("detail-state-chip-missing"), false, `${name}: no live-state wash`);
    assert.equal(chip.classes.includes("detail-state-chip-error"), false, `${name}: no live-state wash`);
    chips.push(chip.classes.join(" "));
  }
  assert.equal(new Set(chips).size, 1, "one class list, so the three cannot drift apart");

  // "Image unavailable" is a standing classification of the post, not a live
  // reading, so per design-system/claude-design/review-08-foundations.html it
  // takes the outline treatment and never a filled wash.
  const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
  const base = css.match(/^\.detail-state-chip \{([^}]*)\}/m)?.[1] ?? "";
  assert.match(base, /border:1px solid currentColor/, "the outline chip must draw a border");
  assert.doesNotMatch(base, /background:/, "an outline chip must not be filled");
});

test("a post written before descriptions were required still gets a described placeholder", () => {
  // The read-path fallback in src/image-description.js is what stands in, and it
  // must reach the placeholder too — otherwise a legacy row degrades to a bare
  // label with nothing under it, which is the state this issue exists to remove.
  for (const [name, render] of [
    ["feed", (container) => renderPosts(container, [{ ...post, image: { ...post.image, alt: "" } }])],
    ["people", (container) => renderProfileGrid(container, [{ ...post, image: { ...post.image, alt: "" } }], { author: "Mina Okafor" })],
  ]) {
    const container = createElement("div");
    render(container);
    tags(container, "IMG")[0].dispatch("error");
    const described = visibleStrings(container).some((line) => line.includes("No description provided"));
    assert.ok(described, `${name}: the placeholder says the description is missing rather than saying nothing`);
  }
});

test("the placeholder introduces no focusable element on any surface", () => {
  // Counted rather than assumed: an extra tab stop here would land in the middle
  // of the feed's roving-tabindex grid and inside a People tile's own link.
  for (const [name, render, expected] of [
    ["feed", (container) => renderPosts(container, [post]), 1],
    ["people", (container) => renderProfileGrid(container, [post], { author: "Mina Okafor" }), 1],
  ]) {
    const container = createElement("div");
    render(container);
    assert.equal(tabStops(container), expected, `${name}: one stop while the image loads`);
    tags(container, "IMG")[0].dispatch("error");
    assert.equal(tabStops(container), expected, `${name}: still one stop once it fails`);
    assert.equal(byClass(container, "empty-action").length, 0, `${name}: the placeholder offers no action`);
  }
});
