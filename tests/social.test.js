import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createPost,
  loadPosts,
  savePosts,
  sortPostsNewestFirst,
  counterState,
  nextFocusIndex,
  filterPosts,
  normalizeApiPosts,
  MAX_POST_LENGTH,
  MAX_AUTHOR_LENGTH,
  MAX_STORED_POSTS,
  DEFAULT_AUTHOR,
  SOCIAL_STORAGE_KEY,
} from "../src/social.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

const sample = [
  { id: "p-old", author: "Kai",  body: "first",  createdAt: "2026-07-10T00:00:00.000Z" },
  { id: "p-new", author: "Ari",  body: "latest", createdAt: "2026-07-14T00:00:00.000Z" },
  { id: "p-mid", author: "Mina", body: "middle", createdAt: "2026-07-12T00:00:00.000Z" },
];

const ids = (posts) => posts.map((post) => post.id);

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

test("persists and reloads posts from local storage", () => {
  const storage = memoryStorage();
  const post = createPost(
    { author: "Ari", body: "Prevent <img onerror=alert(1)> from running" },
    { id: "safe", createdAt: "2026-07-14T12:00:00.000Z" },
  );
  savePosts(storage, [post]);
  assert.deepEqual(loadPosts(storage), [post]);
  // Stored verbatim; rendering (textContent) is what keeps it inert.
  assert.match(storage.getItem(SOCIAL_STORAGE_KEY), /<img onerror=alert\(1\)>/);
});

test("browser storage is bounded and excludes invalid entries", () => {
  const storage = memoryStorage();
  const posts = Array.from({ length: MAX_STORED_POSTS + 5 }, (_, index) => ({
    id: `p-${index}`,
    author: "Ari",
    body: "update",
    createdAt: "2026-07-14T12:00:00.000Z",
  }));
  posts.splice(1, 0, { ...posts[0], id: "invalid", author: "x".repeat(MAX_AUTHOR_LENGTH + 1) });
  savePosts(storage, posts);
  assert.equal(loadPosts(storage).length, MAX_STORED_POSTS);
  assert.equal(loadPosts(storage).some((post) => post.id === "invalid"), false);
});

test("malformed or invalid stored data is ignored", () => {
  assert.deepEqual(loadPosts(memoryStorage()), []);
  assert.deepEqual(loadPosts(memoryStorage({ [SOCIAL_STORAGE_KEY]: "not json" })), []);
  assert.deepEqual(loadPosts(memoryStorage({ [SOCIAL_STORAGE_KEY]: JSON.stringify({}) })), []);
  assert.deepEqual(
    loadPosts(memoryStorage({
      [SOCIAL_STORAGE_KEY]: JSON.stringify([
        { id: "ok", author: "Kai", body: "fine", createdAt: "2026-07-14T00:00:00.000Z" },
        { id: "", author: "Kai", body: "no id", createdAt: "2026-07-14T00:00:00.000Z" },
        { id: "no-body", author: "Kai", body: "  ", createdAt: "2026-07-14T00:00:00.000Z" },
        { id: "bad-date", author: "Kai", body: "when", createdAt: "never" },
        { id: "too-long", author: "Kai", body: "x".repeat(MAX_POST_LENGTH + 1), createdAt: "2026-07-14T00:00:00.000Z" },
      ]),
    })).map((p) => p.id),
    ["ok"],
  );
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
    { id: "api-1", author_id: "11111111-1111-4111-8111-111111111111", title: "Shipped", content: "Keyboard flow is live.", created_at: "2026-07-14T11:00:00.000Z" },
    { id: "bad", author_id: "agent", title: "", content: "missing title", created_at: "2026-07-14T11:00:00.000Z" },
  ] });
  assert.deepEqual(posts, [{
    id: "api-1",
    author: "11111111-1111-4111-8111-111111111111",
    title: "Shipped",
    body: "Keyboard flow is live.",
    createdAt: "2026-07-14T11:00:00.000Z",
  }]);
  assert.deepEqual(normalizeApiPosts(null), []);
});

test("social page is wired, labeled, and linked from the other pages", async () => {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [home, releases, page, wiring, component] = await Promise.all([
    read("src/index.html"),
    read("src/releases.html"),
    read("src/social.html"),
    read("src/social-page.js"),
    read("src/social.js"),
  ]);

  // Reachable from the existing navigation (agents.html is out of scope/forbidden).
  assert.match(home, /href="\/social\.html"/);
  assert.match(releases, /href="\/social\.html"/);

  assert.match(page, /<title>Social · Shiplog<\/title>/);
  assert.match(page, /id="post-feed"/);
  assert.match(page, /id="post-agent-filter"/);
  assert.match(page, /id="post-time-filter"/);
  assert.match(page, /id="feed-announcer"[^>]*aria-live="polite"/);
  assert.match(wiring, /\/api\/posts\?limit=100/);
  assert.match(page, /src="\/social-page\.js"/);
  // Compose inputs carry explicit labels + describedby wiring.
  assert.match(page, /<label for="post-author">/);
  assert.match(page, /<label for="post-body">/);
  assert.match(page, /aria-describedby="post-counter-label post-counter"/);
  assert.match(page, /id="post-counter"[^>]*aria-live="polite"/);
  assert.match(page, /required/);

  // No innerHTML anywhere in the interactive layers (no user-generated HTML).
  assert.doesNotMatch(`${component}\n${wiring}`, /innerHTML/);
});

test("demo seed contains only valid, demo-only posts", async () => {
  const raw = await readFile(new URL("../src/social-demo-data.json", import.meta.url), "utf8");
  const data = JSON.parse(raw);
  assert.ok(Array.isArray(data.posts) && data.posts.length > 0);
  // Every seed post must survive the same validation used for stored posts.
  const storage = memoryStorage({ [SOCIAL_STORAGE_KEY]: JSON.stringify(data.posts) });
  assert.equal(loadPosts(storage).length, data.posts.length);
});
