// #2218 — a posted image stays readable whatever shape it is, on all three
// surfaces that draw one: the Social feed, a People tile, and the permalink.
//
// THE DEFECT THIS FILE PINS SHUT. The two tile surfaces framed every image in a
// fixed box (4:3 on the feed, 1:1 on People) and then drew it with
// `object-fit:cover`, which fills the box by cutting off whatever does not fit.
// A very wide panorama lost its ends, a very tall screenshot lost its top and
// bottom — which on a screenshot is usually the part carrying the point — and a
// small upload was blown up past its own pixels to fill a card. The description
// the poster was required to write then described something the reader could
// not see all of. The permalink was already correct and is pinned here too, so
// the three surfaces are held to one contract in one place rather than drifting
// apart the next time one of them is touched.
//
// WHAT THIS HARNESS CANNOT SEE. tests/support/dom.js models no layout: it has
// no viewport, computes no styles, and reflects no properties, so "the tall
// image is not cropped" is not a question it can answer. A test that shimmed a
// viewport onto it would be asserting against the shim. So the geometry half is
// asserted where it actually lives — the declarations in src/styles.css — and
// the harness is used only for what it genuinely models: which elements are
// rendered, in what order, with which attributes and text.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { byClass, createElement, first, installDocument, tags } from "./support/dom.js";

installDocument();

const { renderPosts } = await import("../src/social.js");
const { renderProfileGrid } = await import("../src/profile.js");
const { renderPostDetail } = await import("../src/post-detail.js");

const CSS = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const rule = (selector) => CSS.match(new RegExp(`^\\${selector} \\{([^}]*)\\}`, "m"))?.[1] ?? "";

const DESCRIPTION = "A release row with a green check beside it.";
const CAPTION = "The middle card, ringed.";

const imagePost = {
  id: "p-image",
  author: "Mina Okafor",
  body: "Focus rings landed everywhere.",
  caption: CAPTION,
  createdAt: "2026-07-14T09:00:00.000Z",
  likes: 3,
  comments: 1,
  image: { src: "/media/focus-ring.svg", alt: DESCRIPTION, width: 1200, height: 900 },
};

const textPost = {
  id: "p-text",
  author: "Tess Bramall",
  body: "No picture on this one.",
  caption: null,
  createdAt: "2026-07-14T10:00:00.000Z",
  likes: 0,
  comments: 0,
};

/* --------------------------- 1. the geometry ------------------------------ */

// The two tile surfaces, whose frames are a fixed shape on purpose — an even
// grid is the point of a grid — so it is the picture inside the frame that has
// to give, not the frame. `scale-down` is `contain` with an upper stop at the
// image's own intrinsic size: it fits the whole picture inside the box without
// distorting it, and it refuses to enlarge one that is already smaller than the
// box. `contain` alone would satisfy the first half and fail the second.
test("a feed card and a People tile fit the whole picture inside the frame", () => {
  for (const [surface, selector, frame, shape] of [
    ["the feed", ".post-image", ".post-media", "4/3"],
    ["a People tile", ".profile-image", ".profile-media", "1/1"],
  ]) {
    const image = rule(selector);
    assert.notEqual(image, "", `${surface}: ${selector} has no rule at all`);

    // Contained, so nothing is cut away, and stopped at the intrinsic size, so
    // a small upload is not stretched into a blur.
    assert.match(image, /object-fit:scale-down/, `${surface}: the picture must be fitted, not filled`);
    assert.doesNotMatch(image, /object-fit:(cover|fill|none)/,
      `${surface}: cover crops the image the poster described`);

    // Bounded both ways, and by maxima rather than by a fixed size: a fixed
    // width or height is what forces a small image up to the frame's size.
    assert.match(image, /max-width:100%/, `${surface}: a wide image must not exceed its column`);
    assert.match(image, /max-height:/, `${surface}: a tall image needs a height cap`);
    assert.doesNotMatch(image, /[^-]width:\s*[\d.]/, `${surface}: a fixed width would upscale a small image`);
    assert.doesNotMatch(image, /[^-]height:\s*[\d.]/, `${surface}: a fixed height would upscale a small image`);

    // And the frame around it still owns the grid's rhythm and clips nothing
    // into the page beside it, which is what keeps a row of cards even.
    assert.match(rule(frame), new RegExp(`aspect-ratio:${shape.replace("/", "\\/")}`), `${surface}: the frame lost its shape`);
    assert.match(rule(frame), /overflow:hidden/, `${surface}: the frame must clip, not spill`);
    assert.match(rule(frame), /place-items:center/, `${surface}: a contained image must sit centred in its frame`);
  }
});

// The permalink has no fixed frame — the image is the reason the page was
// opened, so it is drawn at its own size under two caps, with width and height
// left auto so the browser keeps the ratio under either one. Nothing forces it
// up to a size it does not have, so the small-image rule holds here by the same
// means the tiles get from `scale-down`.
test("the permalink draws the image at its own size under two caps", () => {
  const image = rule(".detail-image");
  assert.match(image, /max-width:100%/, "a wide image must not exceed the column");
  assert.match(image, /max-height:min\(70vh,620px\)/, "a tall image is capped against the viewport");
  assert.match(image, /width:auto/);
  assert.match(image, /height:auto/);
  assert.doesNotMatch(image, /object-fit:(cover|fill)/, "nothing may crop or squash the post's own picture");
  assert.doesNotMatch(image, /min-width|[^-]width:\s*[\d.]/, "nothing may force the image wider than the column");
  assert.match(rule(".detail-media"), /overflow:hidden/);
  assert.match(rule(".detail-figure"), /min-width:0/, "the figure must be allowed to shrink inside a flex column");
});

// Horizontal page scroll is the failure a phone meets first, and it is caused by
// one thing: a child that cannot be made narrower than its content. Every
// container between an image and the page column has to be able to shrink.
test("no image container can push the page wider than the viewport", () => {
  for (const selector of [".post-image", ".profile-image", ".detail-image"]) {
    assert.match(rule(selector), /max-width:100%/, `${selector} may exceed its column`);
  }
  for (const selector of [".detail-post", ".detail-figure", ".detail-media"]) {
    assert.match(rule(selector), /min-width:0/, `${selector} cannot shrink below its content`);
  }
});

/* ------------------- 2. the image and its description ---------------------- */

// One mechanism on all three surfaces: the description the poster wrote is the
// image's alt text, verbatim and non-empty. It is never an empty alt (which
// would file a described photograph as decoration) and never a prefixed or
// re-worded copy, so what a screen reader is handed is the sentence the composer
// required rather than an editorial version of it.
test("each rendered image is described by the poster's own sentence, verbatim", () => {
  const surfaces = [
    ["the feed", (node) => renderPosts(node, [imagePost])],
    ["a People tile", (node) => renderProfileGrid(node, [imagePost], { author: imagePost.author })],
    ["the permalink", (node) => renderPostDetail(node, imagePost)],
  ];
  for (const [surface, render] of surfaces) {
    const container = createElement("div");
    render(container);
    const images = tags(container, "IMG");
    assert.equal(images.length, 1, `${surface}: expected exactly one image`);
    assert.equal(images[0].alt, DESCRIPTION, `${surface}: the alt is not the poster's sentence`);
    assert.notEqual(images[0].alt.trim(), "", `${surface}: a described image must not be marked decorative`);

    // The image sits inside a figure, which is the markup that ties it to the
    // words underneath it without a second announcement of its own.
    const figures = tags(container, "FIGURE");
    assert.equal(figures.length, 1, `${surface}: the image is not in a figure`);
    assert.equal(tags(figures[0], "IMG").length, 1, `${surface}: the image is not inside its own figure`);
    assert.equal(tags(figures[0], "FIGCAPTION").length, 1, `${surface}: the figure has no caption`);
  }
});

// imageDescription() in src/image-description.js never returns null — an
// undescribed post gets a fabricated "Image posted by X. No description
// provided." — so a text-only post guarded on the description string instead of
// on the image itself would grow a figure with a caption describing a picture
// that is not there. Guarded on `post.image`, and pinned by counting.
test("a post with no image grows no figure, no frame, and no fabricated caption", () => {
  const feed = createElement("div");
  renderPosts(feed, [textPost]);
  assert.equal(tags(feed, "IMG").length, 0, "the feed drew an image for a text-only post");
  assert.equal(tags(feed, "FIGURE").length, 0, "the feed drew an empty figure");
  assert.equal(byClass(feed, "post-media").length, 0, "the feed reserved a frame with nothing to put in it");
  assert.equal(byClass(feed, "post-image-description").length, 0, "the feed described an image that does not exist");
  assert.equal(first(feed, "post-body").textContent, textPost.body, "the text post lost its body");

  const detail = createElement("div");
  renderPostDetail(detail, textPost);
  assert.equal(tags(detail, "IMG").length, 0, "the permalink drew an image for a text-only post");
  assert.equal(tags(detail, "FIGURE").length, 0, "the permalink drew an empty figure");
  assert.equal(byClass(detail, "detail-image-description").length, 0,
    "the permalink printed a description for a post with no image");

  // People holds image posts and nothing else, so a text post cannot reach a
  // tile through the page — but the renderer is an exported boundary, and the
  // fabricated description must not become a frame there either.
  const people = createElement("div");
  renderProfileGrid(people, [textPost], { author: textPost.author });
  assert.equal(byClass(people, "profile-tile").length, 1, "the grid drew no tile, so the rest of this asserts nothing");
  assert.equal(tags(people, "IMG").length, 0, "a People tile drew an image for a text-only post");
  assert.equal(byClass(people, "profile-media").length, 0, "a People tile reserved an empty frame");
});

/* ---------------------------- 3. the caption ------------------------------- */

// The caption is the author's words and nothing else. No "Image description:"
// stitched onto the front of it, no truncation, no re-wording — a reader
// comparing the caption on a permalink with the same post in the feed has to
// see one string, not two spellings of one.
test("the permalink caption is the author's words, unprefixed", () => {
  const container = createElement("div");
  renderPostDetail(container, imagePost);
  const caption = tags(container, "FIGCAPTION")[0];
  assert.equal(caption.textContent, CAPTION);
  assert.equal(caption.classes.includes("detail-caption"), true, "the caption kept its class");
  assert.doesNotMatch(caption.textContent, /^Image description/, "the caption grew a label it does not own");
});

// Reading order, in the DOM rather than turned around in CSS, so a keyboard or
// screen-reader visitor is walked through the post in the order it is drawn.
// The permalink's order is the one already pinned by
// tests/post-permalink-states.test.js: the description the poster wrote, then
// the image, then the caption, then the byline and the time.
test("the permalink reads description, image, caption, byline, time", () => {
  const container = createElement("div");
  renderPostDetail(container, imagePost);
  const article = first(container, "detail-post");
  const order = article.children.map((node) => node.className);
  assert.deepEqual(order.slice(0, 4),
    ["description-note detail-image-description", "detail-figure", "detail-byline", "post-date detail-date"]);
});
