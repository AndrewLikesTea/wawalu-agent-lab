// Aspect-ratio resilience for a published image, on the three surfaces that
// render one: a Social feed card, a People image-post tile, and a post
// permalink.
//
// THE SHAPE OF AN IMAGE IS NOT A LAYOUT THIS SITE CONTROLS. A poster uploads
// whatever they photographed — a 3000×300 panorama, a 300×3000 phone portrait,
// a square export, a 60×40 favicon — and each of the three frames has a fixed
// geometry it must fit that picture into: 4:3 on the feed, 1:1 on People, an
// open column on the permalink. The failure this file exists to catch is the
// one that is invisible in a fixture set where every image happens to be 4:3:
// a fit that CROPS. `object-fit:cover` fills the frame by cutting the sides off
// a portrait and the top and bottom off a panorama, and it does it silently —
// the DOM is identical, the alt text is identical, and the only thing that
// changed is that the reader can no longer see the thing the poster described.
//
// WHY THIS FILE ASSERTS ON src/styles.css RATHER THAN ON A VIEWPORT.
// tests/support/dom.js models no layout and no media queries, and no module on
// social.html, profile.html or post.html reads matchMedia or innerWidth (that
// is asserted below, so it stays true). A test that shimmed a 390px viewport
// here would therefore be asserting only its own shim. What is actually
// shippable and actually checkable is the declaration: the stylesheet is the
// artifact that does the fitting, so the stylesheet is what is pinned. Real
// pixels at a real ratio remain a browser's job, not this file's.
//
// The render half is pinned too, but only for the thing the CSS depends on:
// that no surface writes a width, a height or a style attribute out of post
// data. One inline `style="width:1200px"` would defeat every rule below, and it
// is the natural shortcut for anyone reaching for the intrinsic dimensions.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { byClass, createElement, first, installDocument, tags } from "./support/dom.js";

installDocument();

const { renderPosts } = await import("../src/social.js");
const { renderProfileGrid } = await import("../src/profile.js");
const { renderPostDetail } = await import("../src/post-detail.js");

const css = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

// A rule looked up by one class in its selector list, so a declaration block
// shared by two surfaces (`.post-image,.profile-image`) resolves for either
// name. The `^selector \{` idiom used elsewhere in tests/ cannot see a group,
// and reading it as one string is how a grouped rule silently stops being
// asserted for the second class in it.
function declarations(className) {
  for (const [, selectors, body] of css.matchAll(/^([^@\n{][^{\n]*)\{([^}]*)\}/gm)) {
    const named = selectors.split(",").some((selector) => selector.trim() === className);
    if (named) return body;
  }
  return "";
}

const DESCRIPTION = "A release row with a green check beside it.";

// Four shapes, chosen to break a frame in four different directions. The
// numbers are the intrinsic dimensions a post record carries, and they are the
// only thing about an image the renderers ever see.
const SHAPES = [
  { name: "a panorama", width: 3000, height: 300 },
  { name: "a phone portrait", width: 300, height: 3000 },
  { name: "a square export", width: 1000, height: 1000 },
  { name: "a favicon-sized crop", width: 60, height: 40 },
];

const postFor = ({ width, height }) => ({
  id: "p-image",
  author: "Mina Okafor",
  body: "The row landed green.",
  caption: null,
  createdAt: "2026-07-14T09:00:00.000Z",
  likes: 3,
  comments: 1,
  image: { src: "/media/release-row.png", alt: DESCRIPTION, width, height },
});

/* --------------------- the fit, on all three surfaces --------------------- */

// The two tile surfaces share one declaration block because they have the same
// problem: a frame whose ratio is fixed by the grid around it, and a picture
// whose ratio is fixed by whoever took it. `scale-down` is the answer to both
// halves — it fits the whole image inside the frame at any ratio, and unlike
// `contain` it refuses to enlarge a small one past its own pixels, which is
// what turns the 60×40 case into a blur rather than a small picture.
test("a feed card and a People tile fit the whole image rather than cropping it", () => {
  for (const className of [".post-image", ".profile-image"]) {
    const rule = declarations(className);
    assert.notEqual(rule, "", `${className} has no rule in src/styles.css`);
    assert.match(rule, /object-fit:\s*(scale-down|contain)/,
      `${className} must fit the whole image inside its frame`);
    assert.doesNotMatch(rule, /object-fit:\s*(cover|fill|none)/,
      `${className}: cover crops a portrait and a panorama, fill distorts them`);
    // Both axes bounded by the frame, so neither ratio can push past it.
    assert.match(rule, /width:100%/, `${className} must not exceed its frame`);
    assert.match(rule, /height:100%/, `${className} must not exceed its frame`);
    assert.doesNotMatch(rule, /min-width|min-height/,
      `${className}: a floor would let one shape widen the page`);
  }
});

// The frames themselves: a declared ratio so the box is reserved before the
// image arrives, and an overflow guard so whatever letterboxing `scale-down`
// leaves is clipped to the frame rather than painted over the caption.
test("each tile frame declares its ratio and clips to itself", () => {
  for (const className of [".post-media", ".profile-media"]) {
    const rule = declarations(className);
    assert.match(rule, /aspect-ratio:/, `${className} must reserve a box of a known shape`);
    assert.match(rule, /overflow:hidden/, `${className} must clip to its own frame`);
    // Centred in both axes, so a letterboxed panorama sits in the middle of the
    // frame instead of against one edge.
    assert.match(rule, /place-items:center/, `${className} must centre what it fits`);
  }
});

// The permalink is the odd one out and correctly so: there is no grid to keep
// square, the image IS the page, and the honest cap is the reader's column one
// way and their viewport the other. So it takes both caps and no fixed size,
// which lets the browser keep the ratio under either.
test("the permalink caps a wide image by the column and a tall one by the viewport", () => {
  const rule = declarations(".detail-image");
  assert.match(rule, /max-width:100%/, "a panorama is bounded by the column");
  assert.match(rule, /max-height:/, "a phone portrait needs a height cap");
  assert.match(rule, /width:auto/, "a fixed width would distort the capped image");
  assert.match(rule, /height:auto/, "a fixed height would distort the capped image");
  assert.doesNotMatch(rule, /min-width|min-height/, "nothing may force the image past its column");
  assert.match(declarations(".detail-media"), /overflow:hidden/, "the frame clips to itself");
  assert.match(declarations(".detail-figure"), /min-width:0/,
    "a flex column defaults to min-width:auto, which is how a wide child scrolls the page");
});

// The reduced-motion escape hatch still names every frame after the three
// shimmer rules became one. A consolidation that dropped a selector here would
// leave one surface animating for a reader who asked it not to.
test("every image frame still stops shimmering under prefers-reduced-motion", () => {
  const reduced = css.split("\n").find((line) => line.startsWith("@media(prefers-reduced-motion:reduce)")) ?? "";
  for (const frame of [".post-media", ".profile-media", ".detail-media"]) {
    assert.ok(reduced.includes(`${frame}[data-state="loading"]`),
      `${frame} must stop its shimmer under prefers-reduced-motion`);
  }
});

/* ------------- the render half the stylesheet depends on ------------------ */

// The intrinsic dimensions reach the browser as width/height ATTRIBUTES, which
// reserve the box and are overridden by the CSS above. As inline style they
// would win instead, and every rule in this file would be decoration.
test("no surface writes a size out of post data at any ratio", () => {
  for (const shape of SHAPES) {
    const post = postFor(shape);

    const feed = createElement("div");
    renderPosts(feed, [post]);
    const people = createElement("div");
    renderProfileGrid(people, [post], { author: post.author });
    const permalink = createElement("div");
    renderPostDetail(permalink, post);

    for (const [surface, container] of [["feed", feed], ["People", people], ["permalink", permalink]]) {
      const images = tags(container, "IMG");
      assert.equal(images.length, 1, `${surface}: ${shape.name} rendered ${images.length} images`);
      const [img] = images;
      assert.equal(img.getAttribute("style"), null,
        `${surface}: ${shape.name} was sized inline, which overrides the stylesheet`);
      // The attributes are the post's own numbers, unrounded and uncorrected:
      // the ratio they encode is what reserves the right box before load.
      assert.equal(img.width, shape.width, `${surface}: ${shape.name} lost its intrinsic width`);
      assert.equal(img.height, shape.height, `${surface}: ${shape.name} lost its intrinsic height`);
      // And the description is the poster's words, unprefixed, at every ratio —
      // the reshaping must not reach the string that says what the picture is.
      assert.equal(img.alt, DESCRIPTION, `${surface}: ${shape.name} lost the author's description`);
    }

    // The tie between the picture and the words about it is markup, not
    // proximity: one figure per surface, so the caption is the image's caption.
    assert.equal(tags(feed, "FIGURE").length, 1, "the feed card ties image to caption with a figure");
    assert.equal(tags(people, "FIGURE").length, 1, "a People tile ties image to caption with a figure");
    assert.equal(tags(permalink, "FIGURE").length, 1, "the permalink ties image to caption with a figure");

    // Said once per surface. The visible description on the feed and on the
    // permalink is one node, not one per state and not one per breakpoint.
    assert.equal(byClass(feed, "post-image-description").length, 1,
      "the feed prints the description exactly once");
    assert.equal(byClass(permalink, "detail-image-description").length, 1,
      "the permalink prints the description exactly once");
    assert.equal(first(permalink, "detail-image-description-text").textContent, DESCRIPTION,
      "the permalink's visible description is the poster's words verbatim");
  }
});

// The discipline that makes this file the right place for these assertions: if
// a module started measuring, the stylesheet would stop being the whole answer
// and these tests would be pinning half a mechanism.
test("no module behind these three pages measures the viewport itself", async () => {
  for (const module of ["social.js", "profile.js", "post-detail.js", "social-page.js", "profile-page.js", "post-page.js"]) {
    const source = await readFile(new URL(`../src/${module}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /matchMedia|innerWidth|getBoundingClientRect|naturalHeight/,
      `src/${module} must leave sizing to the stylesheet`);
  }
});
