// Image posts at their allowed limits stay legible and in one reading order on
// Social, People and the shared-post page (#2814).
//
// Fixtures are built here, in the public API's wire shape, and go through the
// real normalizers and renderers each page uses: a 280-character body with one
// unbroken token, a 200-character description, a 60-character unbroken display
// name, and portrait, landscape, very narrow (40x1200), tall (1:6) and very wide
// (6:1) images. 60 is the longest name a post can carry: the normalizers drop
// longer ones, so an 80-character fixture would only assert against zero cards.
//
// Every image retains its description as alt, and on every surface the visible
// caption is aria-hidden so the description is announced exactly once (#3036).
//
// Layout is CSS-asserted only. The harness models no layout and nothing on these
// pages reads matchMedia, so a 390px shim would only assert itself; what is
// pinned instead is the rule each selector carries in the sheets the page loads.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { byClass, createElement, installDocument } from "./support/dom.js";

installDocument();

const { renderPosts, normalizeSocialApiPosts, MAX_POST_LENGTH, MAX_IMAGE_ALT_LENGTH } = await import("../src/social.js");
const { renderProfileGrid, normalizeProfileApiPosts } = await import("../src/profile.js");
const { renderPostDetail } = await import("../src/post-detail.js");
const { MAX_AUTHOR_LENGTH } = await import("../src/social-identity.js");

const TOKEN = `https://example.com/${"t".repeat(100)}`;
const BODY = `${"Long post words ".repeat(20).slice(0, MAX_POST_LENGTH - TOKEN.length - 1)} ${TOKEN}`;
const DESCRIPTION = `${"A described image, said in full. ".repeat(10).slice(0, MAX_IMAGE_ALT_LENGTH - 1).trimEnd().padEnd(MAX_IMAGE_ALT_LENGTH - 1, "x")}.`;
const NAME = "N".repeat(MAX_AUTHOR_LENGTH);
const SHAPES = [
  { name: "portrait", width: 900, height: 1200 },
  { name: "landscape", width: 1600, height: 900 },
  { name: "very narrow", width: 40, height: 1200 },
  // #2955: the 1:6 and 6:1 extremes, the wide one previously unexercised.
  { name: "tall", width: 200, height: 1200 },
  { name: "very wide", width: 1200, height: 200 },
];

// Wire shape (src/social-posts-api.js): a UUID id, `source` so the feed keeps
// it, and the flat image columns. The id tail is a valid day of the month.
const wire = (shape, index) => ({
  id: `2814aaaa-0000-4000-8000-00000000001${index}`,
  author: NAME,
  content: BODY,
  timestamp: `2026-07-1${index}T09:00:00.000Z`,
  source: "shiplog-web",
  like_count: 0,
  comment_count: 0,
  image_url: `/media/${shape.name.replace(" ", "-")}.svg`,
  image_alt: DESCRIPTION,
  image_width: shape.width,
  image_height: shape.height,
});

test("the fixtures sit exactly at the limits the composer allows", () => {
  assert.equal(BODY.length, 280);
  assert.ok(BODY.includes(TOKEN), "the body carries one unbroken token");
  assert.equal(DESCRIPTION.length, 200);
  assert.equal(NAME.length, 60);
});

// Each surface: how to draw one post, and the class of each reading step.
const SURFACES = [
  {
    name: "Social",
    draw(container, payload) {
      const posts = normalizeSocialApiPosts(payload);
      assert.equal(posts.length, 1, "the feed dropped the fixture");
      renderPosts(container, posts, { onReport: () => {} });
    },
    steps: { meta: "post-author", text: "post-caption", image: "post-image", description: "post-image-description", action: "release-detail-link" },
    actions: ["post-people", "release-detail-link", "post-report-button"],
  },
  {
    name: "People",
    draw(container, payload) {
      const posts = normalizeProfileApiPosts(payload);
      assert.equal(posts.length, 1, "People dropped the fixture");
      renderProfileGrid(container, posts, { author: NAME, onReport: () => {} });
    },
    steps: { meta: "profile-tile-date", text: "profile-tile-caption", image: "profile-image", description: "profile-tile-description", action: "profile-tile-link-label" },
    actions: ["profile-tile", "post-report-button"],
  },
  {
    name: "the post page",
    draw(container, payload) {
      const [post] = normalizeProfileApiPosts(payload);
      assert.ok(post, "the permalink's normalizer dropped the fixture");
      renderPostDetail(container, post, { location: { origin: "https://shiplog.test" } });
    },
    steps: { meta: "detail-author-link", text: "detail-caption", image: "detail-image", description: "detail-image-description", action: "share-button" },
    actions: ["detail-author-link", "share-button"],
  },
];

function documentOrder(root) {
  const order = [];
  const walk = (node) => { for (const child of node.children ?? []) { order.push(child); walk(child); } };
  walk(root);
  return order;
}

// Out of the accessibility tree by aria-hidden or `hidden`, on itself or above.
function hiddenFromAssistiveTech(node) {
  for (let at = node; at; at = at.parent) {
    if (at.getAttribute?.("aria-hidden") === "true" || at.hidden) return true;
  }
  return false;
}

for (const surface of SURFACES) {
  for (const [index, shape] of SHAPES.entries()) {
    test(`${surface.name}: a ${shape.name} image post at every limit reads in one order, whole`, () => {
      const container = createElement("div");
      surface.draw(container, { posts: [wire(shape, index)] });

      const order = documentOrder(container);
      const at = (className) => {
        const nodes = byClass(container, className);
        assert.equal(nodes.length, 1, `${surface.name}: expected one .${className}`);
        return order.indexOf(nodes[0]);
      };
      const { meta, text, image, description, action } = surface.steps;
      assert.ok(at(meta) < at(text), "posting metadata leads the post's words");
      assert.ok(at(text) < at(image), "the post's words lead the image");
      assert.ok(at(image) < at(description), "the description follows the image");
      assert.ok(at(description) < at(action), "the post's action closes the post");

      // Every string whole: nothing truncated by the renderer.
      assert.equal(byClass(container, text)[0].textContent, BODY);
      assert.ok(byClass(container, description)[0].textContent.endsWith(DESCRIPTION));
      assert.ok(container.textContent.includes(NAME) || surface.name === "People",
        "the display name is printed whole");

      // The image keeps its intrinsic shape, so the frame reserves it.
      const img = byClass(container, image)[0];
      assert.equal(img.width, shape.width);
      assert.equal(img.height, shape.height);

      // One announcement on every route: the alt carries the description and the
      // visible caption is hidden from assistive tech, referenced by nothing.
      const caption = byClass(container, description)[0];
      assert.equal(caption.tagName, "FIGCAPTION");
      assert.equal(caption.getAttribute("aria-hidden"), "true");
      assert.equal(img.alt, DESCRIPTION);
      const exposed = order.filter((node) => (img === node ? node.alt : node.textContent) === DESCRIPTION
        && node.children.length === 0 && !hiddenFromAssistiveTech(node));
      assert.equal(exposed.length, 1, `${surface.name}: the description is exposed ${exposed.length} times`);
      for (const node of order) {
        const ids = (node.getAttribute?.("aria-describedby") ?? "").split(/\s+/);
        assert.equal(ids.includes(caption.id ?? "\u0000"), false, "nothing re-reads the hidden caption");
      }

      // Every action is a native control with words on it, reachable by Tab.
      for (const className of surface.actions) {
        const control = byClass(container, className)[0];
        assert.ok(control, `${surface.name}: .${className} is missing`);
        assert.ok(["A", "BUTTON"].includes(control.tagName), `.${className} is not keyboard reachable`);
        assert.notEqual(control.getAttribute("tabindex"), "-1");
        assert.ok(control.textContent.trim().length > 0, `.${className} has no text label`);
      }

      // A failed load keeps the unit whole: the image goes, the failure block
      // carries the description in its place — still exactly once — and the
      // post's words, caption and actions stay where they were.
      img.dispatch("error");
      const after = documentOrder(container);
      assert.equal(after.includes(img), false);
      const spoken = after.filter((node) => node.textContent === DESCRIPTION && node.children.length === 0
        && !hiddenFromAssistiveTech(node));
      assert.equal(spoken.length, 1, `${surface.name}: a failed image exposes the description ${spoken.length} times`);
      assert.equal(byClass(container, "detail-state-chip")[0].textContent, "Image unavailable");
      assert.ok(after.indexOf(byClass(container, text)[0]) < after.indexOf(spoken[0]));
      assert.ok(after.indexOf(spoken[0]) < after.indexOf(byClass(container, action)[0]));
    });
  }
}

/* --------------------------------- CSS ---------------------------------- */

const src = (file) => readFile(new URL(`../src/${file}`, import.meta.url), "utf8");

async function pageRules(page) {
  const html = await src(page);
  const hrefs = [...html.matchAll(/<link rel="stylesheet" href="\/([^"]+)"/g)].map(([, href]) => href);
  const css = (await Promise.all(hrefs.map(src))).join("\n").replace(/\/\*[\s\S]*?\*\//g, "");
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectors, body]) => ({
    selectors: selectors.split(",").map((s) => s.trim().replace(/\s+/g, " ")),
    body,
  }));
}

const bodyOf = (sheet, selector) => sheet.filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.body).join(";");
// The last declaration of a property wins, as it does in the cascade.
const last = (body, property) => [...body.matchAll(new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+)`, "g"))].map(([, v]) => v.trim()).at(-1);

const IMAGES = {
  "social.html": { image: ".post-image", frame: ".post-media", figure: ".post-figure" },
  "profile.html": { image: ".profile-image", frame: ".profile-media", figure: ".profile-figure" },
  "post.html": { image: ".detail-image", frame: ".detail-media", figure: ".detail-figure" },
};

test("every post image is capped to its column, bounded in height, and shown whole", async () => {
  for (const [page, { image, frame, figure }] of Object.entries(IMAGES)) {
    const sheet = await pageRules(page);
    const img = bodyOf(sheet, image);
    assert.equal(last(img, "max-width"), "100%", `${page}: ${image} can overflow its column`);
    assert.equal(last(img, "object-fit"), "contain", `${page}: ${image} crops a narrow or tall image`);
    // Bounded: either the frame fixes an aspect ratio the image fills, or the
    // image caps its own height and keeps its ratio with height:auto.
    const ratio = last(bodyOf(sheet, frame), "aspect-ratio");
    if (ratio) assert.equal(last(img, "height"), "100%", `${page}: ${image} escapes its frame`);
    else {
      assert.ok(last(img, "max-height"), `${page}: ${image} has no height bound`);
      assert.equal(last(img, "height"), "auto", `${page}: ${image} distorts its aspect ratio`);
    }
    assert.match(bodyOf(sheet, figure), /min-width:\s*0/, `${page}: ${figure} can widen its flex parent`);
    // The global reset still applies under every one of these rules.
    assert.match(bodyOf(sheet, "img"), /max-width:\s*100%/);
    assert.match(bodyOf(sheet, "img"), /height:\s*auto/);
  }
});

test("a People tile's date row wraps rather than clipping a stat", async () => {
  const sheet = await pageRules("profile.html");
  assert.equal(last(bodyOf(sheet, ".profile-tile-meta"), "flex-wrap"), "wrap");
});

const ACTIONS = {
  "social.html": [".release-detail-link", ".text-button", ".post-people"],
  "profile.html": [".profile-tile", ".text-button"],
  "post.html": [".share-button", ".detail-author-link"],
};

test("every post action keeps a visible focus ring in the site's token, and never clips its label", async () => {
  for (const [page, selectors] of Object.entries(ACTIONS)) {
    const sheet = await pageRules(page);
    for (const selector of selectors) {
      const tag = selector === ".post-people" || selector === ".detail-author-link" ? "a" : null;
      const ring = bodyOf(sheet, `${selector}:focus-visible`) || (tag && bodyOf(sheet, `${tag}:focus-visible`));
      assert.match(ring, /outline:\s*3px solid var\(--focus-ring\)/, `${page}: ${selector} has no visible focus ring`);
      // A People tile is the whole card and hides overflow only to round its
      // full-bleed image's corners; its label is checked on the label itself.
      const label = selector === ".profile-tile" ? ".profile-tile-link-label" : selector;
      assert.doesNotMatch(bodyOf(sheet, label), /white-space:\s*nowrap|text-overflow:\s*ellipsis|overflow:\s*hidden/,
        `${page}: ${label} can clip its label`);
    }
  }
});
