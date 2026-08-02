import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createPost,
  sortPostsNewestFirst,
  counterState,
  nextFocusIndex,
  filterPosts,
  normalizeApiPosts,
  normalizeSocialApiPosts,
  normalizeImage,
  columnCount,
  MAX_POST_LENGTH,
  MAX_AUTHOR_LENGTH,
  MAX_IMAGE_ALT_LENGTH,
  DEFAULT_AUTHOR,
  mountSocialFeed,
} from "../src/social.js";
import { loadPage, textOf } from "./support/browser.js";

const sample = [
  { id: "p-old", author: "Kai",  body: "first",  createdAt: "2026-07-10T00:00:00.000Z" },
  { id: "p-new", author: "Ari",  body: "latest", createdAt: "2026-07-14T00:00:00.000Z" },
  { id: "p-mid", author: "Mina", body: "middle", createdAt: "2026-07-12T00:00:00.000Z" },
];

const ids = (posts) => posts.map((post) => post.id);

// Tag-balance check for the hand-authored SVG assets. A mismatched or unclosed
// tag makes a browser drop the image, which would silently demote every seeded
// card to its "Image unavailable" state — a failure unit tests would otherwise
// never see.
function unbalancedTag(markup) {
  const stack = [];
  for (const [, closing, opening, , selfClosing] of markup.matchAll(/<(?:\/([\w:-]+)|([\w:-]+)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?))>/g)) {
    if (closing) {
      if (stack.pop() !== closing) return `unbalanced </${closing}>`;
    } else if (!selfClosing) {
      stack.push(opening);
    }
  }
  return stack.length ? `unclosed <${stack.at(-1)}>` : null;
}

test("creates a normalized post with deterministic metadata", () => {
  const post = createPost(
    { author: "  Mina  ", body: "  Shipped it!  " },
    { id: "post-1", createdAt: "2026-07-14T12:00:00.000Z" },
  );
  assert.deepEqual(post, {
    id: "post-1",
    author: "Mina",
    body: "Shipped it!",
    createdAt: "2026-07-14T12:00:00.000Z",
  });
});

test("author is optional and falls back to the default byline", () => {
  const post = createPost({ body: "no name given" }, { id: "p", createdAt: "2026-07-14T00:00:00.000Z" });
  assert.equal(post.author, DEFAULT_AUTHOR);
  const blank = createPost({ author: "   ", body: "whitespace name" }, { id: "p2", createdAt: "2026-07-14T00:00:00.000Z" });
  assert.equal(blank.author, DEFAULT_AUTHOR);
});

test("rejects an empty or over-budget body", () => {
  assert.throws(() => createPost({ author: "Kai", body: "   " }), TypeError);
  assert.throws(() => createPost({ body: "x".repeat(MAX_POST_LENGTH + 1) }), TypeError);
  // Exactly at the limit is allowed.
  assert.doesNotThrow(() => createPost({ body: "x".repeat(MAX_POST_LENGTH) }, { id: "p", createdAt: "2026-07-14T00:00:00.000Z" }));
});

test("rejects an over-budget author", () => {
  assert.throws(() => createPost({ author: "x".repeat(MAX_AUTHOR_LENGTH + 1), body: "hello" }), TypeError);
});

test("orders posts reverse-chronologically without mutating the input", () => {
  const before = ids(sample);
  assert.deepEqual(ids(sortPostsNewestFirst(sample)), ["p-new", "p-mid", "p-old"]);
  assert.deepEqual(ids(sample), before);
});

test("counterState reports remaining budget and warning thresholds", () => {
  const empty = counterState("");
  assert.equal(empty.remaining, MAX_POST_LENGTH);
  assert.equal(empty.empty, true);
  assert.equal(empty.over, false);

  const near = counterState("x".repeat(MAX_POST_LENGTH - 5));
  assert.equal(near.remaining, 5);
  assert.equal(near.near, true);
  assert.equal(near.over, false);

  const over = counterState("x".repeat(MAX_POST_LENGTH + 3));
  assert.equal(over.remaining, -3);
  assert.equal(over.over, true);
  assert.equal(over.near, false);
});

test("nextFocusIndex moves within bounds and clamps; Enter is not a nav key", () => {
  assert.equal(nextFocusIndex(0, "ArrowDown", 3), 1);
  assert.equal(nextFocusIndex(2, "ArrowDown", 3), 2); // clamps at last
  assert.equal(nextFocusIndex(1, "ArrowUp", 3), 0);
  assert.equal(nextFocusIndex(0, "ArrowUp", 3), 0); // clamps at first
  assert.equal(nextFocusIndex(-1, "ArrowDown", 3), 0); // nothing focused yet
  assert.equal(nextFocusIndex(1, "Home", 3), 0);
  assert.equal(nextFocusIndex(1, "End", 3), 2);
  assert.equal(nextFocusIndex(1, "Enter", 3), 1); // cards are not interactive; Enter is a no-op
  assert.equal(nextFocusIndex(0, "ArrowDown", 0), -1); // empty list
});

test("arrow keys walk the grid by card and by row", () => {
  // 5 cards over 2 columns: [0 1 / 2 3 / 4]
  assert.equal(nextFocusIndex(0, "ArrowRight", 5, 2), 1);
  assert.equal(nextFocusIndex(1, "ArrowLeft", 5, 2), 0);
  assert.equal(nextFocusIndex(0, "ArrowDown", 5, 2), 2); // down a whole row
  assert.equal(nextFocusIndex(3, "ArrowUp", 5, 2), 1);
  assert.equal(nextFocusIndex(3, "ArrowDown", 5, 2), 4); // clamps to the last card
  assert.equal(nextFocusIndex(1, "ArrowUp", 5, 2), 1); // already on the top row
  assert.equal(nextFocusIndex(4, "ArrowRight", 5, 2), 4); // clamps at the end
  assert.equal(nextFocusIndex(-1, "ArrowRight", 5, 2), 0);
  assert.equal(nextFocusIndex(0, "ArrowDown", 0, 3), -1);
  // A degenerate column count must not stall navigation.
  assert.equal(nextFocusIndex(0, "ArrowDown", 3, 0), 1);
});

test("columnCount reads the grid width off the laid-out rows", () => {
  assert.equal(columnCount([0, 0, 0, 320, 320, 640]), 3);
  assert.equal(columnCount([0, 210, 420]), 1); // single column, one card per row
  assert.equal(columnCount([0, 0]), 2);
  assert.equal(columnCount([]), 0);
  assert.equal(columnCount(null), 0);
});

test("normalizeImage accepts same-origin assets and rejects everything else", () => {
  assert.deepEqual(normalizeImage({ src: "/media/focus-ring.svg", alt: "  A blue ring  ", width: 1200, height: 900 }), {
    src: "/media/focus-ring.svg",
    alt: "A blue ring",
    width: 1200,
    height: 900,
  });
  // Alt is optional; the caption describes the image when it is absent.
  assert.deepEqual(normalizeImage({ src: "/media/a.png" }), { src: "/media/a.png", alt: "" });
  assert.equal(normalizeImage({ src: "/media/a.png", alt: "x".repeat(MAX_IMAGE_ALT_LENGTH + 40) }).alt.length, MAX_IMAGE_ALT_LENGTH);

  // Dimensions are only kept as a usable pair, and only when sane.
  assert.equal("width" in normalizeImage({ src: "/media/a.png", width: 800 }), false);
  assert.equal("height" in normalizeImage({ src: "/media/a.png", width: 0, height: 900 }), false);
  assert.equal("width" in normalizeImage({ src: "/media/a.png", width: 12.5, height: 900 }), false);

  for (const src of [
    "https://cdn.example.com/a.png", // off-origin: blocked by img-src 'self'
    "//cdn.example.com/a.png", // protocol-relative
    "data:image/svg+xml,<svg/>", // inline payload
    "javascript:alert(1)",
    "media/a.png", // not root-relative
    "/media/../../etc/passwd",
    "/media/a.png?track=1", // query string is not part of the asset alphabet
    "/media/a b.png",
    "",
    "   ",
  ]) {
    assert.equal(normalizeImage({ src }), null, `expected ${JSON.stringify(src)} to be rejected`);
  }
  assert.equal(normalizeImage(null), null);
  assert.equal(normalizeImage({ src: 42 }), null);
});

test("filters posts by agent and common time ranges", () => {
  const now = Date.parse("2026-07-14T12:00:00.000Z");
  const posts = [
    { id: "recent-mina", author: "Mina", body: "now", createdAt: "2026-07-14T11:30:00.000Z" },
    { id: "older-mina", author: "Mina", body: "yesterday", createdAt: "2026-07-13T10:00:00.000Z" },
    { id: "recent-kai", author: "Kai", body: "today", createdAt: "2026-07-14T11:00:00.000Z" },
  ];
  assert.deepEqual(ids(filterPosts(posts, { author: "Mina", range: "all", now })), ["recent-mina", "older-mina"]);
  assert.deepEqual(ids(filterPosts(posts, { author: "all", range: "hour", now })), ["recent-mina", "recent-kai"]);
  assert.deepEqual(ids(filterPosts(posts, { author: "Mina", range: "day", now })), ["recent-mina"]);
});

test("normalizes valid API posts and drops malformed records", () => {
  const posts = normalizeApiPosts({ posts: [
    { id: "api-1", author_id: "11111111-1111-4111-8111-111111111111", agent_name: "Priya", title: "Shipped", content: "Keyboard flow is live.", created_at: "2026-07-14T11:00:00.000Z" },
    { id: "bad", author_id: "agent", agent_name: "Priya", title: "", content: "missing title", created_at: "2026-07-14T11:00:00.000Z" },
  ] });
  assert.deepEqual(posts, [{
    id: "api-1",
    author: "Priya",
    title: "Shipped",
    body: "Keyboard flow is live.",
    createdAt: "2026-07-14T11:00:00.000Z",
  }]);
  assert.deepEqual(normalizeApiPosts(null), []);
});

test("normalizes durable social API posts and drops malformed records", () => {
  assert.deepEqual(normalizeSocialApiPosts({ posts: [
    { id: "social-1", author: "Priya", content: "Shipped.", timestamp: "2026-07-18T12:00:00Z", source: "agent-orchestrator" },
    { id: "bad", author: "Priya", content: "", timestamp: "2026-07-18T12:00:00Z", source: "agent-orchestrator" },
  ] }), [{ id: "social-1", author: "Priya", body: "Shipped.", createdAt: "2026-07-18T12:00:00Z", source: "agent-orchestrator" }]);
});

test("carries image posts through the API normalizer in either field shape", () => {
  const base = { id: "social-1", author: "Priya", content: "Shipped.", timestamp: "2026-07-18T12:00:00Z", source: "agent-orchestrator" };
  const image = { src: "/media/focus-ring.svg", alt: "A blue focus ring", width: 1200, height: 900 };

  const [nested] = normalizeSocialApiPosts({ posts: [{ ...base, image }] });
  assert.deepEqual(nested.image, image);

  // The flat column shape the durable API would most plausibly grow.
  const [flat] = normalizeSocialApiPosts({ posts: [{
    ...base,
    image_url: "/media/release-timeline.svg",
    image_alt: "A rising bar chart",
    image_width: 1200,
    image_height: 900,
  }] });
  assert.deepEqual(flat.image, { src: "/media/release-timeline.svg", alt: "A rising bar chart", width: 1200, height: 900 });

  // A text-only post stays text-only — no empty image key.
  assert.equal("image" in normalizeSocialApiPosts({ posts: [base] })[0], false);
});

test("a rejected image drops the image, never the post", () => {
  const posts = normalizeSocialApiPosts({ posts: [{
    id: "social-2",
    author: "Priya",
    content: "The caption still has to survive.",
    timestamp: "2026-07-18T12:00:00Z",
    source: "agent-orchestrator",
    image: { src: "https://cdn.example.com/tracker.gif", alt: "off-origin" },
  }] });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body, "The caption still has to survive.");
  assert.equal("image" in posts[0], false);
});

test("social page is wired, labeled, and linked from the other pages", async () => {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [home, releases, page, wiring, component, styles] = await Promise.all([
    read("src/index.html"),
    read("src/releases.html"),
    read("src/social.html"),
    read("src/social-page.js"),
    read("src/social.js"),
    read("src/styles.css"),
  ]);

  // Reachable from the existing navigation (agents.html is out of scope/forbidden).
  assert.match(home, /href="\/social\.html"/);
  assert.match(releases, /href="\/social\.html"/);

  assert.match(page, /<title>Social · Shiplog<\/title>/);
  assert.match(page, /id="post-feed"/);
  assert.match(page, /id="post-agent-filter"/);
  assert.match(page, /id="post-time-filter"/);
  assert.match(page, /id="feed-announcer"[^>]*aria-live="polite"/);
  assert.match(wiring, /\/api\/social-posts\?limit=100/);
  assert.match(wiring, /method: "POST"/);
  assert.match(wiring, /connection\.dataset\.state = "live"/);
  assert.match(wiring, /connection\.dataset\.state = "degraded"/);
  assert.match(styles, /\.feed-connection\[data-state="degraded"\] \.live-dot \{[^}]*border-radius:1px;[^}]*transform:rotate\(45deg\)/,
    "an unavailable live service changes the connection marker's shape, not only its colour");
  assert.doesNotMatch(wiring, /localStorage/);
  assert.match(page, /src="\/social-page\.js"/);
  // Compose inputs carry explicit labels + describedby wiring.
  assert.match(page, /<label for="post-author">/);
  assert.match(page, /<label for="post-body">/);
  assert.match(page, /aria-describedby="post-counter-label post-counter"/);
  assert.match(page, /id="post-counter"[^>]*aria-live="polite"/);
  assert.match(page, /id="post-count" aria-live="polite">Loading posts…<\/span>/);
  assert.doesNotMatch(page, /id="post-count"[^>]*>0 posts<\/span>/);
  assert.match(page, /required/);
  assert.match(page, /id="post-image"[^>]*type="file"[^>]*accept="image\/png,image\/jpeg,image\/gif,image\/webp"/);
  assert.match(page, /href="\/paint\/"/);
  assert.match(page, /id="compose-preview-image" alt=""/);
  const previewFailure = "We couldn’t create a preview of the uploaded image. Remove the image, upload the file again, and check the preview before publishing.";
  assert.ok(page.includes(`<p id="compose-preview-error" hidden>${previewFailure}</p>`));
  assert.ok(wiring.includes(`setStatus("${previewFailure}", true);`));
  assert.match(page, /id="post-image-alt"/);
  assert.match(page, /id="post-media-status" role="status" aria-live="polite"/);
  assert.match(page, /id="post-submit"[^>]*aria-describedby="social-notice"/);
  assert.match(page, /id="social-notice" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(wiring, /selectionGeneration/);
  assert.match(component, /Publishing…/);
  assert.match(wiring, /takePaintHandoff/);
  assert.match(wiring, /caption: post\.body/);

  // No innerHTML anywhere in the interactive layers (no user-generated HTML).
  assert.doesNotMatch(`${component}\n${wiring}`, /innerHTML/);
});

// The shipped markup only pins the count a visitor sees before the feed mounts.
// Every state after that is written by the feed itself, so the question "is this
// feed empty or still working?" is answered here, on a booted page: a count that
// says "0 posts" is a claim, and the page may only make it once it has looked.
test("the post count never claims zero posts before the feed has any answer", async (t) => {
  const page = await loadPage(new URL("../src/social.html", import.meta.url), {});
  t.after(() => page.restore());
  const count = page.document.querySelector("#post-count");
  const feed = mountSocialFeed(page.document, { posts: [], state: "loading" });

  assert.equal(textOf(count), "Loading posts…", "the first fetch is open, so there is no count to give");
  assert.equal(page.document.querySelectorAll(".empty-state").length, 0, "loading copy never shares the page with empty-state guidance");

  feed.setState("error");
  assert.equal(textOf(count), "Unavailable", "a failed fetch is not a count of zero");
  assert.match(textOf(page.document.querySelector(".empty-state-error")), /Social posts could not be loaded\./);

  feed.seed([]);
  assert.equal(textOf(count), "0 posts", "an answered fetch with nothing in it is a real zero");
  const empty = page.document.querySelector(".empty-state");
  assert.match(textOf(empty), /No posts on Social yet\./);
  assert.match(textOf(empty), /Publish a post, or open Paint to create an image first\./);
  assert.doesNotMatch(textOf(empty), /Loading|Connecting/);
});

test("demo seed contains only valid, demo-only posts", async () => {
  const raw = await readFile(new URL("../src/social-demo-data.json", import.meta.url), "utf8");
  const data = JSON.parse(raw);
  assert.ok(Array.isArray(data.posts) && data.posts.length > 0);
  // The seed is the offline fallback rendered directly by the feed, so every
  // entry must carry the render shape the feed expects.
  for (const post of data.posts) {
    assert.equal(typeof post.id === "string" && post.id.trim() !== "", true);
    assert.equal(typeof post.author === "string" && post.author.trim() !== "" && post.author.length <= MAX_AUTHOR_LENGTH, true);
    assert.equal(typeof post.body === "string" && post.body.trim() !== "" && post.body.length <= MAX_POST_LENGTH, true);
    assert.equal(typeof post.createdAt === "string" && !Number.isNaN(Date.parse(post.createdAt)), true);
  }
});

test("seeded images pass validation, ship as assets, and describe themselves", async () => {
  const data = JSON.parse(await readFile(new URL("../src/social-demo-data.json", import.meta.url), "utf8"));
  const imagePosts = data.posts.filter((post) => post.image);
  // The seed is the only path that exercises the image layout while the durable
  // API is text-only, so it must actually contain image posts.
  assert.ok(imagePosts.length > 0, "expected the demo seed to include image posts");

  for (const post of imagePosts) {
    const image = normalizeImage(post.image);
    assert.ok(image, `seed image ${post.image.src} must survive normalizeImage`);
    // Alt text is required of the seed even though the renderer tolerates its
    // absence: hand-authored content has no excuse.
    assert.ok(image.alt.length > 0 && image.alt.length <= MAX_IMAGE_ALT_LENGTH);
    assert.ok(image.width > 0 && image.height > 0, "seed images reserve layout space");
    // The referenced asset must exist in src/, or the card renders its error state.
    const file = await readFile(new URL(`../src${image.src}`, import.meta.url), "utf8");
    assert.match(file, /^<svg[^>]*viewBox=/, `${image.src} must be an SVG that scales to its tile`);
    assert.equal(unbalancedTag(file), null, `${image.src} must be well-formed`);
    // Assets are static art: no scripting, no off-origin fetches.
    assert.doesNotMatch(file, /<script|xlink:href|https?:\/\/(?!www\.w3\.org)/i);
  }
});

// The feed used to be "Social Profile" in the nav, which sat next to "Profile"
// and read as the same destination twice. It is "Social" everywhere now; the
// full ordered link set is pinned in tests/site-nav.test.js.
test("every global social destination link uses the Social label", async () => {
  const pages = [
    "index.html",
    "decision.html",
    "evolution.html",
    "releases.html",
    "release.html",
    "post.html",
    "profile.html",
    "social.html",
  ];

  for (const page of pages) {
    const html = await readFile(new URL(`../src/${page}`, import.meta.url), "utf8");
    assert.match(
      html,
      /<a class="nav-social"(?: aria-current="page")? href="\/social\.html">Social<\/a>/,
      `${page} must use the Social navigation label`,
    );
  }
});
