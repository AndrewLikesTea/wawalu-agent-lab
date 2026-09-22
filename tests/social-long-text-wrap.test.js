// Long unbroken visitor text wraps inside its card on Social, People and the
// post page, at 390px and at desktop width, and is never clipped (#2486).
//
// The DOM harness does no layout, so a viewport shim would only assert itself.
// What this pins instead is the CSS that makes the layout hold — every selector
// that paints visitor text wraps with `overflow-wrap`, and no truncating rule
// (ellipsis, nowrap, line clamp, overflow:hidden) sits on a name or a
// description — plus a render check that the full strings land in exactly
// those classes on all three surfaces.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { byClass, createElement, installDocument } from "./support/dom.js";

installDocument();

const { renderPosts } = await import("../src/social.js");
const { renderProfileGrid, renderAuthorPicker } = await import("../src/profile.js");
const { renderPostDetail } = await import("../src/post-detail.js");

const src = (file) => readFile(new URL(`../src/${file}`, import.meta.url), "utf8");

// Every rule in the sheets, @media bodies included, as { selectors, body }.
function rules(css) {
  const found = [];
  for (const [, selectorText, body] of css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    found.push({ selectors: selectorText.split(",").map((s) => s.trim().replace(/\s+/g, " ")), body });
  }
  return found;
}

// The sheets each page loads, in load order.
async function pageRules(page) {
  const html = await src(page);
  const hrefs = [...html.matchAll(/<link rel="stylesheet" href="\/([^"]+)"/g)].map(([, href]) => href);
  return rules((await Promise.all(hrefs.map(src))).join("\n"));
}

// Selectors that paint visitor-written text, per page, by what they hold.
const TEXT = {
  "social.html": {
    body: [".post-body", ".post-caption", ".post-title"],
    description: [".post-image-description", ".media-fallback-text"],
    name: [".post-name", ".post-author", ".post-people", ".feed-summary"],
    filter: ["#post-name-filter"],
  },
  "profile.html": {
    body: [".profile-tile-caption"],
    description: [".media-fallback-text"],
    name: [".profile-active-filter", ".profile-summary", ".profile-identity-text h2", "#profile-social-route a"],
    filter: [".profile-filter-option"],
  },
  "post.html": {
    body: [".detail-caption", ".detail-body"],
    description: [".detail-image-description", ".detail-post-description"],
    name: [".detail-author-link"],
    filter: [],
  },
};

test("all three pages load the sheet that carries the wrap rule", async () => {
  for (const page of Object.keys(TEXT)) {
    assert.match(await src(page), /<link rel="stylesheet" href="\/social-states\.css" \/>/, page);
  }
});

test("every selector painting visitor text wraps, and shrinks inside flex and grid", async () => {
  for (const [page, groups] of Object.entries(TEXT)) {
    const sheet = await pageRules(page);
    for (const [kind, selectors] of Object.entries(groups)) {
      for (const selector of selectors) {
        const bodies = sheet.filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.body).join(";");
        assert.match(bodies, /overflow-wrap:\s*(anywhere|break-word)/, `${page} ${kind}: ${selector} does not wrap`);
        assert.match(bodies, /min-width:\s*0/, `${page} ${kind}: ${selector} can widen its flex or grid parent`);
      }
    }
  }
});

test("the name filter controls are capped to their column", async () => {
  const social = await pageRules("social.html");
  const people = await pageRules("profile.html");
  const body = (sheet, selector) => sheet.filter((rule) => rule.selectors.includes(selector)).map((rule) => rule.body).join(";");
  assert.match(body(social, "#post-name-filter"), /max-width:\s*100%/);
  assert.match(body(people, ".profile-filter-option"), /max-width:\s*100%/);
  // The select's column may never insist on more than the toolbar has.
  const minimums = [...body(social, ".social-toolbar .filter").matchAll(/min-width:\s*([^;]+)/g)].map(([, v]) => v.trim());
  assert.equal(minimums.at(-1), "min(150px,100%)");
});

test("no rule truncates a display name, a description or a People caption", async () => {
  const guarded = new Set();
  for (const groups of Object.values(TEXT)) {
    for (const selector of [...groups.name, ...groups.description, ...groups.body]) guarded.add(selector);
  }
  const truncating = /text-overflow:\s*ellipsis|white-space:\s*nowrap|line-clamp|overflow:\s*hidden/;
  for (const page of Object.keys(TEXT)) {
    for (const rule of await pageRules(page)) {
      for (const selector of rule.selectors) {
        // The selector itself, or one whose last compound is it (a media-query
        // override written against a parent).
        const hit = [...guarded].find((g) => selector === g || selector.endsWith(` ${g}`));
        if (hit) assert.doesNotMatch(rule.body, truncating, `${page}: ${selector} truncates`);
      }
    }
  }
});

test("a failed tile's description is not cropped by the frame it stands in", async () => {
  const sheet = await pageRules("social.html");
  for (const frame of ['.post-media[data-state="error"]', '.profile-media[data-state="error"]']) {
    const bodies = sheet.filter((rule) => rule.selectors.includes(frame)).map((rule) => rule.body);
    assert.match(bodies.at(-1) ?? "", /overflow:\s*visible/, frame);
  }
});

test("focus rings on the display-name link and card actions are never clipped by a card", async () => {
  for (const page of Object.keys(TEXT)) {
    for (const rule of await pageRules(page)) {
      for (const selector of rule.selectors) {
        if (/^\.(post-card|detail-post)$/.test(selector)) {
          assert.doesNotMatch(rule.body, /overflow:\s*(hidden|clip)/, `${page}: ${selector} clips`);
        }
      }
    }
  }
});

// ---------------------------------------------------------------------------
// The extreme strings, painted. Generated here rather than committed.
// ---------------------------------------------------------------------------
const BODY = "A".repeat(280);
const DESCRIPTION = "D".repeat(200);
const URL_TEXT = `https://example.com/${"u".repeat(120)}`;
const NAME = "N".repeat(60);
const IMAGE = { src: "/media/focus-ring.svg", alt: DESCRIPTION, width: 1200, height: 900 };

const textIn = (container, className) => byClass(container, className).map((node) => node.textContent).join("\n");

test("Social paints the whole body, URL, description and name into the wrapping classes", () => {
  const container = createElement("div");
  renderPosts(container, [
    { id: "p-text", author: NAME, body: `${BODY} ${URL_TEXT}`, createdAt: "2026-07-14T09:00:00.000Z", source: "shiplog-web" },
    { id: "p-image", author: NAME, body: BODY, createdAt: "2026-07-13T09:00:00.000Z", image: IMAGE, source: "shiplog-web" },
  ]);
  assert.equal(byClass(container, "post-card").length, 2);
  assert.ok(textIn(container, "post-body").includes(`${BODY} ${URL_TEXT}`));
  assert.ok(textIn(container, "post-caption").includes(BODY));
  assert.ok(textIn(container, "post-image-description").includes(DESCRIPTION));
  assert.equal(textIn(container, "post-name"), NAME);
  assert.equal(textIn(container, "post-author"), NAME);
  assert.ok(textIn(container, "post-people").includes(NAME));
});

test("People paints the whole caption and every name chip unclipped", () => {
  const grid = createElement("div");
  renderProfileGrid(grid, [{ id: "p-image", author: NAME, body: BODY, createdAt: "2026-07-14T09:00:00.000Z", image: IMAGE, likes: 0, comments: 0 }], { author: NAME });
  assert.equal(textIn(grid, "profile-tile-caption"), BODY);

  const picker = createElement("div");
  createElement("div").append(picker);
  renderAuthorPicker(picker, [{ name: NAME, images: 1 }, { name: "Ari", images: 2 }], { author: NAME });
  const chips = byClass(picker, "profile-filter-option");
  assert.equal(chips.length, 2);
  assert.ok(chips.some((chip) => chip.textContent.includes(NAME)));
});

test("the post page paints the whole body, description and name", () => {
  const container = createElement("div");
  renderPostDetail(container, { id: "p-image", author: NAME, body: `${BODY} ${URL_TEXT}`, createdAt: "2026-07-14T09:00:00.000Z", likes: 0, comments: 0, image: IMAGE });
  assert.equal(textIn(container, "detail-author-link"), NAME);
  assert.ok(textIn(container, "detail-image-description").includes(DESCRIPTION));
  assert.ok(`${textIn(container, "detail-caption")}\n${textIn(container, "detail-body")}`.includes(`${BODY} ${URL_TEXT}`));
});
