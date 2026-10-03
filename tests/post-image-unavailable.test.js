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

const { normalizeImage, renderPosts } = await import("../src/social.js");
// The words on the card's own control, read from the one module that owns them.
const { OPEN_POST_LABEL } = await import("../src/social-links.js");
const {
  imagePostCounts, profileAnnouncement, profileResultsHeading, profileSummary, profileSummaryText,
  renderProfileGrid, selectProfilePosts,
} = await import("../src/profile.js");
const { renderPostDetail } = await import("../src/post-detail.js");
// The sentence under the chip, read from its one definition rather than typed
// again here: a test holding its own copy of shared copy is how the two drift.
const { IMAGE_UNDISPLAYABLE_LINE } = await import("../src/image-description.js");

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
  assert.ok(order(container, caption) < order(container, fallback), "caption remains the primary content");
  assert.ok(order(container, fallback) < order(container, author));
  assert.ok(order(container, author) < order(container, time));

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
  // The counts are the card's own shipped stops, not a round number: a feed card
  // offers the display name and then Open post, and a People tile is one link.
  for (const [name, render, expected] of [
    ["feed", (container) => renderPosts(container, [post]), 2],
    ["people", (container) => renderProfileGrid(container, [post], { author: "Mina Okafor" }), 1],
  ]) {
    const container = createElement("div");
    render(container);
    assert.equal(tabStops(container), expected, `${name}: the card's own stops while the image loads`);
    tags(container, "IMG")[0].dispatch("error");
    assert.equal(tabStops(container), expected, `${name}: the failure added or removed a stop`);
    assert.equal(byClass(container, "empty-action").length, 0, `${name}: the placeholder offers no action`);
  }
});

/* ------------------ the other way into the same placeholder ---------------- */
// A published post can carry a description and no source to fetch: a write that
// stored the description and lost the upload, a blob whose row outlived it. The
// reader gets exactly what a dead source gives them — no picture — so the state
// must be the same state, and the post must not quietly become a text post,
// which is what dropping the field used to turn it into.
//
// The fixtures are the three shapes a source can be useless in. All three keep
// the description, because the description is what says a picture was published
// at all; a row with neither is not a claim and stays a text post.
const SOURCELESS = { ...post, image: { alt: DESCRIPTION } };
const EMPTY_SRC = { ...post, image: { src: "", alt: DESCRIPTION } };
const BLANK_SRC = { ...post, image: { src: "   \t ", alt: DESCRIPTION } };

test("a described image with no source is still an image post, not a text post", () => {
  // Every renderer re-normalizes at its own boundary, so this is the gate that
  // decides whether any of them ever sees the claim.
  for (const [name, raw] of [["absent", SOURCELESS.image], ["empty", EMPTY_SRC.image], ["blank", BLANK_SRC.image]]) {
    assert.deepEqual(normalizeImage(raw), { src: "", alt: DESCRIPTION }, `${name}: the claim did not survive`);
  }
  // Dimensions describe a box for an image that is not coming, so they are
  // dropped rather than reserving space nothing will fill.
  assert.equal("width" in normalizeImage({ alt: DESCRIPTION, width: 1200, height: 900 }), false);
  // The other half of the rule: no source and no description is no claim. The
  // feed's flat-column reader hands this function an all-undefined object for
  // every text-only post on Social, so this is what keeps those posts text.
  for (const raw of [{}, { src: "" }, { src: "   " }, { src: undefined, alt: "" }, { src: "", alt: "   " }]) {
    assert.equal(normalizeImage(raw), null, `${JSON.stringify(raw)} is not an image claim`);
  }
});

test("Social feed: a described image with no source draws the placeholder and requests nothing", () => {
  for (const [name, fixture] of [["absent", SOURCELESS], ["empty", EMPTY_SRC], ["blank", BLANK_SRC]]) {
    const container = createElement("div");
    renderPosts(container, [fixture]);

    // No element, so no request and no broken-image glyph to explain.
    assert.equal(tags(container, "IMG").length, 0, `${name}: an image was rendered for a post with no source`);
    // And no shimmer: a loading state here promises an arrival on every render
    // of a post that can never have one.
    assert.equal(first(container, "post-media").dataset.state, "error", `${name}: the frame must open in its failed state`);

    const fallback = first(container, "post-media-fallback");
    assert.equal(fallback.hidden, false, `${name}: the placeholder was drawn hidden`);
    const visible = visibleStrings(container);
    assert.ok(visible.includes(IMAGE_UNDISPLAYABLE_LINE), `${name}: the sentence is rendered text, not a class name`);
    assert.ok(visible.includes("Image unavailable"), `${name}: the label is rendered text`);
    assert.ok(visible.includes(DESCRIPTION), `${name}: the description is rendered text, not just an alt`);
    // The post itself is untouched: a degraded image, not a degraded post.
    assert.equal(first(container, "post-caption").textContent, "Focus rings landed everywhere.");
    assert.ok(order(container, fallback) < order(container, first(container, "post-author")));
  }
});

test("the two ways an image fails produce one block, word for word", () => {
  // The point of building the block before the branch: the reader who gets a
  // dead source and the reader who gets no source are told the same thing in the
  // same order by the same node. Compared as rendered text and as class lists,
  // because that is the whole of what a reader and a stylesheet each receive.
  for (const [name, render, frameClass, fallbackClass] of [
    ["feed", (container, fixture) => renderPosts(container, [fixture]), "post-media", "post-media-fallback"],
    ["people", (container, fixture) => renderProfileGrid(container, [fixture], { author: "Mina Okafor" }), "profile-media", "profile-media-fallback"],
    ["permalink", (container, fixture) => renderPostDetail(container, fixture), "detail-media", "detail-media-fallback"],
  ]) {
    const died = createElement("div");
    render(died, post);
    tags(died, "IMG")[0].dispatch("error");

    const never = createElement("div");
    render(never, SOURCELESS);

    for (const container of [died, never]) {
      assert.equal(first(container, frameClass).dataset.state, "error", `${name}: both states are the frame's error state`);
      assert.equal(tags(container, "IMG").length, 0, `${name}: an image element survived`);
      assert.equal(first(container, fallbackClass).hidden, false, `${name}: the placeholder is not shown`);
    }
    const spoken = (container) => visibleStrings(first(container, fallbackClass));
    assert.deepEqual(spoken(never), spoken(died), `${name}: the two states say different things`);
    assert.deepEqual(
      first(never, fallbackClass).classes,
      first(died, fallbackClass).classes,
      `${name}: the two states are styled differently`,
    );
  }
});

test("a loaded image keeps the published description as its alt, byte for byte", () => {
  // No prefix, no suffix, no "Image: " — the alt is the sentence the poster
  // published, which is the same sentence the placeholder stands in with.
  for (const [name, render] of [
    ["feed", (container) => renderPosts(container, [post])],
    ["people", (container) => renderProfileGrid(container, [post], { author: "Mina Okafor" })],
    ["permalink", (container) => renderPostDetail(container, post)],
  ]) {
    const container = createElement("div");
    render(container);
    const img = tags(container, "IMG")[0];
    assert.equal(img.alt, DESCRIPTION, `${name}: the alt is not the published description`);
    img.dispatch("load");
    assert.equal(tags(container, "IMG").length, 1, `${name}: a loaded image left the page`);
    const visible = visibleStrings(container);
    assert.equal(visible.includes(IMAGE_UNDISPLAYABLE_LINE), false, `${name}: a working image is called undisplayable`);
  }
});

test("a post with no image at all is unchanged: no frame, no placeholder, no sentence", () => {
  // The fallback belongs to a post that claims a picture. A text post claims
  // none and must not grow a frame explaining the absence of something nobody
  // said was there.
  const textPost = { ...post, image: undefined };
  for (const [name, render, frameClass] of [
    ["feed", (container) => renderPosts(container, [textPost]), "post-media"],
    ["permalink", (container) => renderPostDetail(container, textPost), "detail-media"],
  ]) {
    const container = createElement("div");
    render(container);
    assert.equal(byClass(container, frameClass).length, 0, `${name}: a text post was given an image frame`);
    assert.equal(byClass(container, "detail-state-chip").length, 0, `${name}: a text post was labelled unavailable`);
    const visible = visibleStrings(container);
    assert.equal(visible.includes(IMAGE_UNDISPLAYABLE_LINE), false, `${name}: a text post explains a missing image`);
    assert.equal(visible.includes("Image unavailable"), false, `${name}: a text post is labelled unavailable`);
  }
});

test("the no-source placeholder introduces no focusable element either", () => {
  // Several pages have no spare tab stop at all, so this is counted against the
  // working card rather than against a round number.
  for (const [name, render] of [
    ["feed", (container, fixture) => renderPosts(container, [fixture])],
    ["people", (container, fixture) => renderProfileGrid(container, [fixture], { author: "Mina Okafor" })],
    ["permalink", (container, fixture) => renderPostDetail(container, fixture)],
  ]) {
    const working = createElement("div");
    render(working, post);
    const expected = tabStops(working);

    const container = createElement("div");
    render(container, SOURCELESS);
    assert.equal(tabStops(container), expected, `${name}: the no-source state changed the card's tab stops`);
    assert.equal(byClass(container, "empty-action").length, 0, `${name}: the placeholder offers an action`);
  }
});

test("the feed's card controls keep their names and their places in the no-source state", () => {
  // Named controls, not just a count: a placeholder that renamed Open post or
  // moved it above the card's content would pass a stop count and still break a
  // reader who navigates by control name.
  const controlNames = (root) => walk(root, (node) => ["A", "BUTTON"].includes(node.tagName))
    .map((node) => node.textContent);

  const working = createElement("div");
  renderPosts(working, [post], { onReport: () => {} });
  const container = createElement("div");
  renderPosts(container, [SOURCELESS], { onReport: () => {} });

  assert.deepEqual(controlNames(container), controlNames(working),
    "the controls, their names and their order are the working card's");
  assert.ok(controlNames(container).some((name) => name.startsWith(OPEN_POST_LABEL)), "Open post is still on the card");
  assert.ok(controlNames(container).length >= 2, "the card's own controls are present to compare");
});

/* ------------- People: the placeholder is still an image post ------------- */

test("People: a tile in the placeholder state still counts as an image post", () => {
  // People holds image posts and nothing else, and its heading, its count and
  // its ordering line are statements about the posts — not about whether their
  // pictures arrived. A post whose image cannot be displayed is still a post
  // somebody published a picture under, so dropping it from the count would make
  // the page's own number wrong about what it is showing.
  const older = { ...post, id: "p-two", createdAt: "2026-07-13T09:00:00.000Z" };
  const working = [post, older];
  const degraded = [SOURCELESS, older];

  assert.equal(selectProfilePosts(degraded, "Mina Okafor").length, 2, "a placeholder tile was filtered out of the grid");
  assert.deepEqual(imagePostCounts(degraded), imagePostCounts(working), "the picker's chip count changed");
  assert.deepEqual(profileSummary(degraded, "Mina Okafor"), profileSummary(working, "Mina Okafor"));
  assert.equal(
    profileSummaryText(profileSummary(degraded, "Mina Okafor")),
    profileSummaryText(profileSummary(working, "Mina Okafor")),
    "the summary beside the heading changed",
  );
  assert.equal(
    profileResultsHeading("Mina Okafor", selectProfilePosts(degraded, "Mina Okafor").length),
    profileResultsHeading("Mina Okafor", selectProfilePosts(working, "Mina Okafor").length),
    "the results heading changed",
  );
  assert.equal(
    profileAnnouncement("Mina Okafor", selectProfilePosts(degraded, "Mina Okafor").length),
    "Showing 2 image posts by Mina Okafor, newest first.",
    "the ordering line changed",
  );

  // And in the rendered grid: two tiles, one of them a placeholder. Skeleton
  // cells carry the cell class too, so they are subtracted before counting.
  const container = createElement("div");
  renderProfileGrid(container, degraded, { author: "Mina Okafor" });
  const tiles = byClass(container, "profile-cell")
    .filter((cell) => !cell.classes.some((name) => name.includes("-skeleton")));
  assert.equal(tiles.length, 2, "the grid dropped the post whose image could not be displayed");
  // Every tile builds a placeholder; only the degraded one shows it, so the
  // hidden ones are filtered out rather than counted.
  const shownFallbacks = byClass(container, "profile-media-fallback").filter((node) => node.hidden !== true);
  assert.equal(shownFallbacks.length, 1, "exactly one tile is in the placeholder state");
  assert.equal(tags(container, "IMG").length, 1, "only the post with a source renders an image");
  assert.ok(visibleStrings(container).includes(IMAGE_UNDISPLAYABLE_LINE), "the placeholder states the case in words");
});

/* ------------------------ the permalink's own wording --------------------- */

test("permalink: a described image with no source draws the placeholder in the image's place", () => {
  const container = createElement("div");
  renderPostDetail(container, SOURCELESS);

  assert.equal(tags(container, "IMG").length, 0, "an image was rendered for a post with no source");
  assert.equal(first(container, "detail-media").dataset.state, "error");
  const fallback = first(container, "detail-media-fallback");
  assert.equal(fallback.hidden, false);
  assert.equal(fallback.getAttribute("role"), "status");

  const visible = visibleStrings(fallback);
  assert.ok(visible.includes("Image unavailable"));
  assert.ok(visible.some((line) => line.includes(DESCRIPTION)), "the description is rendered text, not just an alt");
  // This page's own longer sentence, the one already shipped for a source that
  // died — and only that one. The shared default must not have been appended
  // beside it, which would say the same thing twice under one chip.
  assert.ok(visible.some((line) => line.includes("We couldn’t show the image on this post")));
  assert.equal(visible.includes(IMAGE_UNDISPLAYABLE_LINE), false, "the permalink states the failure twice");

  // The caption still carries the post, and the placeholder took the image's place.
  assert.equal(tags(container, "FIGCAPTION")[0].textContent, "Focus rings landed everywhere.");
  assert.ok(order(container, fallback) < order(container, tags(container, "FIGCAPTION")[0]));
});
