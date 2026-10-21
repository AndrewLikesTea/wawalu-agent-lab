// The content region stays the reading target while it loads (#2799).
//
// AUDIT. Social, People and the shared post page already shipped every part of
// this before the issue was filed: the wait is drawn inside the named section
// that later holds the posts or the post, it is a visible sentence in that
// page's own words, one polite region says it, and the shimmer placeholders are
// aria-hidden and inert. Those are pinned here as one table rather than rebuilt.
// Two things were missing and are fixed in src/styles.css:
//   - the composer preview's shimmer (.compose-preview-frame) kept running under
//     prefers-reduced-motion: reduce, the one shimmer the media block missed;
//   - the authored first-frame wait on Social and People (.feed-status, 11px)
//     measured 4.53:1 on the panel and 4.37:1 where the page's blue top wash
//     shows through it — under AA for small text. It now uses #62625d, the
//     colour the mounted wait (.feed-status-value) already painted, so the
//     frame before the module and the frame after it are one colour.
//
// HARNESS NOTES. No layout, no matchMedia, no markup parsing: the reduced-motion,
// 390px and contrast checks read the stylesheet, and every wait is on a count of
// NON-skeleton cards (placeholders wear the card class). Focus is compared with
// `===` into a boolean, never by asserting on an element.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { FEED_LOADING_LINE } from "../src/social.js";
import { loadingSummaryText, PROFILE_LOADING_ANNOUNCEMENT } from "../src/profile.js";
import { POST_LOADING_STATUS } from "../src/post-detail.js";

const SEED_ROUTE = "/social-demo-data.json";
const LIVE_ROUTE = "/api/social-posts?limit=100";
const CSS = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

const apiPost = (id, author, day) => ({
  id,
  author,
  content: `${id} from ${author}`,
  timestamp: `2026-07-${day}T09:00:00.000Z`,
  source: "shiplog-web",
  like_count: 0,
  comment_count: 0,
  image_url: `/media/${author}.svg`,
  image_alt: `A drawing signed ${author}`,
  image_width: 1200,
  image_height: 900,
});
const FEED = { posts: [apiPost("live-18", "Zed", "18"), apiPost("live-17", "Ari", "17")] };

// One row per page. `region` is the content container that is swapped, `label`
// the visible wait, `voice` the one polite region that says it, `skeleton` the
// placeholder block, `actions` the container of the page's primary actions.
const PAGES = [
  {
    name: "Social",
    url: new URL("../src/social.html", import.meta.url),
    module: "/social-page.js",
    routes: { [SEED_ROUTE]: { posts: [] }, [LIVE_ROUTE]: FEED },
    gated: LIVE_ROUTE,
    regionName: "Post log",
    region: "#post-feed",
    label: "#feed-state",
    labelText: FEED_LOADING_LINE,
    voice: "#feed-state",
    voiceText: FEED_LOADING_LINE,
    skeleton: ".post-grid-skeleton",
    actions: ".hero-actions",
    drawn: (document) => document.querySelectorAll(".post-card")
      .filter((card) => !card.classList.contains("post-card-skeleton")).length,
    // The feed's answer is announced by the summary sentence, which ships empty.
    done: (document) => textOf(document.querySelector("#feed-summary")),
  },
  {
    name: "People",
    url: new URL("../src/profile.html", import.meta.url),
    module: "/profile-page.js",
    routes: { [SEED_ROUTE]: { posts: [] }, [LIVE_ROUTE]: { posts: [FEED.posts[0]] } },
    // People mounts once the seed answers, so only the live fetch is held.
    gated: LIVE_ROUTE,
    regionName: "Image posts",
    region: "#profile-grid",
    label: "#profile-feed-status",
    labelText: loadingSummaryText(),
    voice: "#profile-announcer",
    voiceText: PROFILE_LOADING_ANNOUNCEMENT,
    skeleton: ".profile-grid-skeleton",
    actions: ".hero-actions",
    drawn: (document) => document.querySelectorAll(".profile-tile")
      .filter((tile) => !tile.classList.contains("profile-tile-skeleton")).length,
    done: (document) => textOf(document.querySelector("#profile-announcer")),
  },
  {
    name: "the shared post",
    url: new URL("../src/post.html", import.meta.url),
    search: "?id=p-image",
    module: "/post-page.js",
    routes: {
      [SEED_ROUTE]: {
        posts: [{
          id: "p-image", author: "Mina Okafor", body: "Focus rings landed everywhere.",
          caption: "The middle card, ringed.", createdAt: "2026-07-14T09:00:00.000Z", likes: 3, comments: 1,
        }],
      },
    },
    gated: SEED_ROUTE,
    regionName: "Post",
    region: "#post-detail",
    label: ".detail-loading-text",
    labelText: POST_LOADING_STATUS,
    voice: "#post-detail",
    voiceText: POST_LOADING_STATUS,
    skeleton: ".detail-skeleton",
    actions: ".detail-page-exits",
    drawn: (document) => document.querySelectorAll(".detail-post")
      .filter((post) => !post.classList.contains("detail-skeleton")).length,
    done: (document) => (document.querySelector("#post-detail").dataset.postState === "loaded" ? "loaded" : ""),
  },
];

function ancestors(node) {
  const chain = [];
  for (let at = node.parentNode; at && at.getAttribute; at = at.parentNode) chain.push(at);
  return chain;
}

// The accessible name of the nearest labelled section around a node.
function regionNameOf(document, node) {
  const section = ancestors(node).find((at) => at.tagName === "SECTION"
    && (at.getAttribute("aria-label") || at.getAttribute("aria-labelledby")));
  if (!section) return null;
  const labelledBy = section.getAttribute("aria-labelledby");
  return labelledBy ? textOf(document.querySelector(`#${labelledBy}`)) : section.getAttribute("aria-label");
}

function contains(outer, inner) {
  return ancestors(inner).includes(outer);
}

// The primary actions in document order, by id or by their words.
function actionIds(document, selector) {
  const found = [];
  const visit = (node) => {
    for (const child of node.children) {
      if (!child.getAttribute) continue;
      if (child.tagName === "A" || child.tagName === "BUTTON") found.push(child.getAttribute("id") ?? textOf(child));
      visit(child);
    }
  };
  visit(document.querySelector(selector));
  return found;
}

for (const spec of PAGES) {
  test(`${spec.name}: the wait is drawn inside the region that later holds the content`, async (t) => {
    const page = await loadPage(spec.url, { location: { search: spec.search ?? "" } });
    t.after(() => page.restore());
    const { document } = page;
    const label = document.querySelector(spec.label);
    const region = document.querySelector(spec.region);
    const skeleton = document.querySelector(spec.skeleton);

    assert.equal(regionNameOf(document, region), spec.regionName, "the content sits in a named section");
    assert.equal(regionNameOf(document, label), spec.regionName, "the wait sits in that same section");
    assert.equal(textOf(label), spec.labelText);
    assert.ok(!ancestors(label).concat(label).some((at) => at.hasAttribute?.("hidden")
      || at.classList?.contains("visually-hidden")), "the wait is visible text, not a screen-reader-only line");
    assert.ok(contains(region, skeleton), "the placeholders reserve the content's own box");
    assert.equal(region.getAttribute("aria-busy"), "true");
    assert.equal(skeleton.getAttribute("aria-hidden"), "true");
    assert.equal(skeleton.getAttribute("inert"), "");
    assert.equal(textOf(skeleton), "", "a placeholder says nothing");
    assert.equal(skeleton.querySelectorAll("a").length + skeleton.querySelectorAll("button").length, 0);
  });

  test(`${spec.name}: one polite voice at start and at completion, with focus and actions left alone`, async (t) => {
    const page = await loadPage(spec.url, { routes: spec.routes, location: { search: spec.search ?? "" } });
    const savedInterval = globalThis.setInterval;
    globalThis.setInterval = () => 0;
    globalThis.window.history = { replaceState() {} };
    // Hold the content's response until the start of the wait has been read.
    const routed = globalThis.fetch;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    globalThis.fetch = async (url) => {
      if (String(url) === spec.gated) await gate;
      const response = await routed(url);
      return { status: 200, ...response };
    };
    t.after(() => { globalThis.setInterval = savedInterval; page.restore(); });
    const { document } = page;

    const actionsBefore = actionIds(document, spec.actions);
    const actions = document.querySelector(spec.actions);
    const anchor = actions.querySelector("a") ?? actions.querySelector("button");
    anchor.focus();

    await importPageModule(spec.module);
    const voice = document.querySelector(spec.voice);
    await waitFor(() => textOf(voice) === spec.voiceText, `${spec.name} announced the wait`);
    assert.equal(voice.getAttribute("aria-live") ?? (voice.getAttribute("role") === "status" ? "polite" : null), "polite");
    const waiting = [...document.querySelectorAll("[aria-live]")]
      .filter((node) => /\bload/i.test(textOf(node)));
    assert.equal(waiting.length, 1, "the wait is said from exactly one live region");
    assert.equal(textOf(voice).split(spec.voiceText).length - 1, 1, "the wait is said once, with no placeholder text");

    release();
    await waitFor(() => spec.drawn(document) > 0, `${spec.name} drew its content`);
    await waitFor(() => spec.done(document) !== "", `${spec.name} announced the answer`);

    assert.ok(!/\bloading\b/i.test(textOf(voice)), "the voice still says the content is loading");
    assert.equal(document.querySelector(spec.region).getAttribute("aria-busy"), "false");
    assert.equal(document.querySelectorAll(spec.skeleton).length, 0, "a placeholder outlived the content");
    assert.ok(document.activeElement === anchor, "swapping the content in moved focus");
    assert.deepEqual(actionIds(document, spec.actions), actionsBefore, "the primary actions were reordered");
  });
}

/* ------------------------------ stylesheet ------------------------------- */

// Split a selector list on the commas that are not inside parentheses.
function selectorsOf(list) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < list.length; i += 1) {
    if (list[i] === "(") depth += 1;
    else if (list[i] === ")") depth -= 1;
    else if (list[i] === "," && depth === 0) { out.push(list.slice(start, i)); start = i + 1; }
  }
  out.push(list.slice(start));
  return out.map((s) => s.trim().replace(/="([^"]*)"/g, "=$1"))
    // `:is(a,b)[x]` stops `a[x]` and `b[x]`.
    .flatMap((s) => {
      const match = s.match(/^:is\((.*)\)(.*)$/);
      return match ? selectorsOf(match[1]).map((inner) => inner + match[2]) : [s];
    });
}

test("every shimmer and spinner stops under prefers-reduced-motion: reduce", () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const block = css.split("\n").find((line) => line.startsWith("@media(prefers-reduced-motion:reduce)"));
  const stopped = new Set([...block.matchAll(/([^{}]+)\{animation:none\}/g)]
    .flatMap(([, list]) => selectorsOf(list)));
  const animated = [...css.matchAll(/(?:^|\})\s*([^{}@]+)\{[^{}]*animation:shiplog-(?:shimmer|spin)/gm)]
    .flatMap(([, list]) => selectorsOf(list));
  assert.ok(animated.includes(".compose-preview-frame[data-state=loading]"));
  for (const selector of animated) {
    assert.ok(stopped.has(selector), `${selector} keeps moving when motion is reduced`);
  }
});

test("at 390px the placeholders collapse with the grid they stand in for, content first", async () => {
  assert.match(CSS, /@media\(max-width:520px\) \{[^@]*?\.post-grid\{grid-template-columns:1fr/);
  assert.match(CSS, /@media\(max-width:520px\) \{[^@]*?\.profile-grid\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(CSS, /\.detail-skeleton \{[^}]*min-width:0/);

  for (const [file, cls, grid] of [["social.html", "post-grid post-grid-skeleton", "post-grid"],
    ["profile.html", "profile-grid profile-grid-skeleton", "profile-grid"]]) {
    const html = await readFile(new URL(`../src/${file}`, import.meta.url), "utf8");
    assert.ok(html.includes(`class="${cls}"`), `${file}: the placeholder grid is not the ${grid} it stands in for`);
  }
  // Content first: the feed precedes the composer, and each wait precedes its placeholders.
  const social = await readFile(new URL("../src/social.html", import.meta.url), "utf8");
  assert.ok(social.indexOf('id="post-feed"') < social.indexOf('id="post-compose-panel"'));
  assert.ok(social.indexOf('id="feed-state"') < social.indexOf('class="post-grid post-grid-skeleton"'));
  const post = await readFile(new URL("../src/post.html", import.meta.url), "utf8");
  assert.ok(post.indexOf("detail-loading-text") < post.indexOf('class="detail-skeleton'));
});

/* ------------------------------- contrast -------------------------------- */

const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));
const luminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const colourOf = (rule) => CSS.match(new RegExp(`^${rule} \\{[^}]*?[; ]color:(#[0-9a-f]{6})`, "m"))[1];

test("the loading labels meet WCAG AA on the panel in every theme the page has", () => {
  // The page declares one scheme and has no dark-scheme rule, so a dark OS
  // preference paints this same palette: the light numbers are the dark ones.
  assert.match(CSS, /^:root \{ color-scheme:light;/);
  assert.doesNotMatch(CSS, /prefers-color-scheme/);

  const [, alpha] = CSS.match(/\.list-panel \{[^}]*background:rgba\(255,255,255,(\.\d+)\)/);
  const page = CSS.match(/^:root \{[^}]*background:(#[0-9a-f]{6})/m)[1];
  const wash = CSS.match(/^body \{[^}]*radial-gradient\([^,]+,(#[0-9a-f]{6})/m)[1];
  // The panel is translucent: test over the page and over the top-right wash.
  const panels = [page, wash].map((under) => hex(under).map((v) => Number(alpha) * 255 + (1 - Number(alpha)) * v));

  const labels = { ".feed-status": colourOf("\\.feed-status"), ".detail-loading": colourOf("\\.detail-loading") };
  for (const [rule, colour] of Object.entries(labels)) {
    for (const panel of panels) {
      assert.ok(ratio(hex(colour), panel) >= 4.5,
        `${rule} ${colour} is ${ratio(hex(colour), panel).toFixed(2)}:1 on the panel`);
    }
  }
  // The shimmer base is decorative (aria-hidden, exempt from 1.4.11) at ~1.1:1;
  // it is the wait sentence beside it that carries the state.
  const shimmer = CSS.match(/\.skeleton-media,\.skeleton-line,\.skeleton-avatar \{ background:linear-gradient\(100deg,(#[0-9a-f]{6})/)[1];
  assert.ok(ratio(hex(shimmer), panels[0]) < 1.5);
});
