import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createD1RateLimiter,
  createD1SocialPostStore,
  createMemoryRateLimiter,
  createMemorySocialPostStore,
  createSocialTokenAuthenticator,
  handleSocialPostsRequest,
  MAX_SOCIAL_AUTHOR_LENGTH,
  MAX_SOCIAL_CONTENT_LENGTH,
  MAX_SOCIAL_SOURCE_LENGTH,
  validateSocialPostInput,
} from "../src/social-posts-api.js";
import { createTestD1 } from "./support/d1-sqlite.js";

const ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-07-18T12:00:00.000Z");
const AUTH = { id: ID, persona: "Priya", scopes: ["social-posts:write"] };

function harness({ limit = 30, tokens = { secret: AUTH } } = {}) {
  const store = createMemorySocialPostStore();
  const authenticate = createSocialTokenAuthenticator(tokens);
  const rateLimit = createMemoryRateLimiter({ limit });
  async function call(method = "POST", { body, raw, token = "secret", contentType = "application/json", path = "/api/social-posts" } = {}) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (contentType) headers["content-type"] = contentType;
    const response = await handleSocialPostsRequest(new Request(`https://test.invalid${path}`, {
      method, headers, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    }), { store, authenticate, rateLimit, nowMs: () => NOW, requestId: "request-1" });
    const text = await response.text();
    return { response, status: response.status, json: text ? JSON.parse(text) : null };
  }
  return { call, store };
}

const valid = { author: "Priya", content: "The orchestrator shipped.", timestamp: "2026-07-18T11:59:00Z", source: "agent-orchestrator" };

test("validates all required fields and accepts exact boundaries", () => {
  assert.deepEqual(validateSocialPostInput({}).errors, {
    author: "author must be a string",
    content: "content must be a string",
    source: "source must be a string",
    timestamp: "timestamp must be an ISO-8601 string",
  });
  const boundary = validateSocialPostInput({
    author: "a".repeat(MAX_SOCIAL_AUTHOR_LENGTH),
    content: "c".repeat(MAX_SOCIAL_CONTENT_LENGTH),
    source: "s".repeat(MAX_SOCIAL_SOURCE_LENGTH),
    timestamp: "2026-07-18T12:00:00.000Z",
  });
  assert.deepEqual(boundary.errors, {});
  assert.match(validateSocialPostInput({ ...valid, timestamp: "not-a-date" }).errors.timestamp, /valid/);
  assert.match(validateSocialPostInput({ ...valid, timestamp: "July 18, 2026" }).errors.timestamp, /valid/);
  assert.match(validateSocialPostInput({ ...valid, timestamp: "2026-02-31T12:00:00Z" }).errors.timestamp, /valid/);
  assert.match(validateSocialPostInput({ ...valid, content: "x".repeat(MAX_SOCIAL_CONTENT_LENGTH + 1) }).errors.content, /at most/);
});

test("POST authenticates, persists, and makes the post visible to public clients", async () => {
  const { call } = harness();
  const created = await call("POST", { body: valid });
  assert.equal(created.status, 201);
  // A text post is the image post with every image field null -- one shape for
  // every kind of post, so clients never branch on which sort they received.
  assert.deepEqual(created.json.post, {
    id: created.json.post.id,
    author: "Priya",
    content: valid.content,
    caption: null,
    timestamp: "2026-07-18T11:59:00.000Z",
    source: "agent-orchestrator",
    image_url: null,
    image_alt: null,
    image_width: null,
    image_height: null,
    like_count: 0,
    comment_count: 0,
  });
  assert.equal(created.response.headers.get("cache-control"), "no-store");
  assert.equal(created.response.headers.get("ratelimit-remaining"), "29");

  const listed = await call("GET", { token: null, contentType: null });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.json.posts, [created.json.post]);
});

test("human browser writes need only author + content; server owns provenance", async () => {
  const store = createMemorySocialPostStore();
  async function humanPost(body) {
    return handleSocialPostsRequest(new Request("https://test.invalid/api/social-posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }), {
      store,
      authenticate: async () => null,
      identifyHuman: async () => ({ id: "human:hashed-network-principal" }),
      rateLimit: createMemoryRateLimiter(),
      nowMs: () => NOW,
      requestId: "human-request",
    });
  }
  // The client sends no timestamp/source at all — the server supplies them.
  const response = await humanPost({ author: "Morgan", content: valid.content });
  assert.equal(response.status, 201);
  const post = (await response.json()).post;
  assert.equal(post.author, "Morgan");
  assert.equal(post.timestamp, "2026-07-18T12:00:00.000Z");
  assert.equal(post.source, "shiplog-web");
  assert.deepEqual(await store.list(1), [post]);

  // Any client-sent timestamp/source is ignored rather than honored.
  const spoofed = await humanPost({ author: "Morgan", content: valid.content, timestamp: "2020-01-01T00:00:00Z", source: "agent-orchestrator" });
  const spoofedPost = (await spoofed.json()).post;
  assert.equal(spoofedPost.timestamp, "2026-07-18T12:00:00.000Z");
  assert.equal(spoofedPost.source, "shiplog-web");
});

test("provenance validation is skipped for human writes but enforced for agents", () => {
  // Agents must self-report timestamp + source.
  assert.deepEqual(validateSocialPostInput({ author: "Priya", content: "hi" }).errors, {
    source: "source must be a string",
    timestamp: "timestamp must be an ISO-8601 string",
  });
  // Humans need only author + content; provenance is server-owned.
  assert.deepEqual(validateSocialPostInput({ author: "Morgan", content: "hi" }, { requireProvenance: false }), {
    values: { author: "Morgan", content: "hi" },
    errors: {},
  });
});

test("rejects missing credentials, missing scope, and author impersonation", async () => {
  const { call } = harness({ tokens: {
    secret: AUTH,
    unscoped: { ...AUTH, scopes: [] },
  } });
  assert.equal((await call("POST", { body: valid, token: null })).status, 401);
  assert.equal((await call("POST", { body: valid, token: "wrong" })).status, 401);
  assert.equal((await call("POST", { body: valid, token: "unscoped" })).status, 403);
  const mismatch = await call("POST", { body: { ...valid, author: "Someone else" } });
  assert.equal(mismatch.status, 403);
  assert.equal(mismatch.json.error.code, "author_mismatch");
});

test("reports malformed JSON, media type, semantic errors, query bounds, and methods", async () => {
  const { call } = harness();
  assert.equal((await call("POST", { raw: "{" })).status, 400);
  assert.equal((await call("POST", { body: valid, contentType: "text/plain" })).status, 415);
  const invalid = await call("POST", { body: { ...valid, content: " " } });
  assert.equal(invalid.status, 422);
  assert.ok(invalid.json.error.fields.content);
  assert.equal((await call("GET", { token: null, contentType: null, path: "/api/social-posts?limit=101" })).status, 400);
  const method = await call("DELETE", { token: null, contentType: null });
  assert.equal(method.status, 405);
  assert.equal(method.response.headers.get("allow"), "GET, POST");
});

test("durable fixed-window rate limiting returns retry metadata", async () => {
  const { call } = harness({ limit: 1 });
  assert.equal((await call("POST", { body: valid })).status, 201);
  const limited = await call("POST", { body: valid });
  assert.equal(limited.status, 429);
  assert.equal(limited.json.error.code, "rate_limited");
  assert.equal(limited.response.headers.get("ratelimit-remaining"), "0");
  assert.equal(limited.response.headers.get("retry-after"), "60");
});

test("storage failures are opaque and correlated", async () => {
  const response = await handleSocialPostsRequest(new Request("https://x/api/social-posts"), {
    requestId: "trace-1",
    store: { list: async () => { throw new Error("database password"); } },
    authenticate: async () => null,
    rateLimit: async () => ({}),
  });
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.request_id, "trace-1");
  assert.doesNotMatch(body.error.message, /password/);
});

// Runs the real migrations against a real SQLite engine rather than asserting
// on SQL strings: the properties this store depends on -- durable ordering,
// idempotent rate counters, a genuinely atomic insert -- are engine behaviour,
// and a string match cannot observe any of them.
test("D1 post store persists, orders, and rate-limits against real SQL", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const store = createD1SocialPostStore(db);

  const first = await store.create({ id: ID, ...valid, timestamp: "2026-07-18T11:59:00.000Z", principal_id: ID, created_at: new Date(NOW).toISOString() });
  assert.equal(first.author, "Priya");
  assert.equal(first.like_count, 0);
  assert.equal(first.image_url, null);

  const second = await store.create({ id: OTHER_ID, ...valid, timestamp: "2026-07-18T12:30:00.000Z", principal_id: ID, created_at: new Date(NOW).toISOString() });
  assert.deepEqual((await store.list(10)).map((post) => post.id), [second.id, first.id], "newest first");
  assert.deepEqual(await store.get(ID), first);

  const longContent = "A".repeat(2200);
  const long = await store.create({
    id: "33333333-3333-4333-8333-333333333333",
    ...valid,
    content: longContent,
    timestamp: "2026-07-18T12:45:00.000Z",
    principal_id: ID,
    created_at: new Date(NOW).toISOString(),
  });
  assert.equal(long.content, longContent, "the persistence layer keeps the full composer budget");

  const rateLimit = createD1RateLimiter(db, { limit: 2 });
  assert.deepEqual(
    [(await rateLimit(ID, NOW)).remaining, (await rateLimit(ID, NOW)).remaining, (await rateLimit(ID, NOW)).allowed],
    [1, 0, false],
    "the durable counter increments across calls in one window",
  );
  // A new window resets the budget rather than carrying the exhausted count.
  assert.equal((await rateLimit(ID, NOW + 60_000)).allowed, true);
});

test("deployment adapters and migrations keep persistence and auth at the edge", async () => {
  const [collection, subresources, media, edge, migration, mediaMigration, captionMigration] = await Promise.all([
    "../functions/api/social-posts.js",
    "../functions/api/social-posts/[[route]].js",
    "../functions/api/social-media/[[route]].js",
    "../src/social-edge.js",
    "../migrations/0003_social_posts.sql",
    "../migrations/0004_social_post_media.sql",
    "../migrations/0007_social_post_long_captions.sql",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

  // The exact-path route must delegate, never re-implement: two wirings for one
  // endpoint is how the collection quietly drifts from its sub-resources.
  assert.match(collection, /export \{ onRequest \} from "\.\/social-posts\/\[\[route\]\]\.js"/);
  for (const adapter of [subresources, media]) {
    assert.match(adapter, /socialDependencies/);
    assert.match(adapter, /storageUnavailable/);
  }
  assert.match(edge, /env\.DB/);
  assert.match(edge, /env\.AGENT_TOKENS/);
  assert.match(edge, /env\.SOCIAL_MEDIA_BUCKET/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS social_posts/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS social_post_rate_limits/);
  assert.match(mediaMigration, /CREATE TABLE IF NOT EXISTS social_media_objects/);
  assert.match(captionMigration, /ADD COLUMN long_content/);
  assert.match(mediaMigration, /CREATE TABLE IF NOT EXISTS social_post_likes/);
  assert.match(mediaMigration, /CREATE TABLE IF NOT EXISTS social_post_comments/);
  // Forward-only: the unified model may add columns and tables, never drop or
  // rewrite what 0003 already persisted. (ON DELETE CASCADE is a constraint on
  // new tables, not a data-destroying statement, so it is deliberately allowed.)
  assert.doesNotMatch(mediaMigration, /\bDROP\s+(TABLE|COLUMN|INDEX)\b|\bDELETE\s+FROM\b|\bUPDATE\s+social_posts\b/i);
});
