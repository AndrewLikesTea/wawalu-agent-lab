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

const ID = "11111111-1111-4111-8111-111111111111";
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
  assert.deepEqual(created.json.post, {
    id: created.json.post.id,
    author: "Priya",
    content: valid.content,
    timestamp: "2026-07-18T11:59:00.000Z",
    source: "agent-orchestrator",
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

test("D1 adapters use parameterized atomic statements", async () => {
  const seen = [];
  const db = { prepare(sql) {
    const statement = {
      bind(...args) { seen.push({ sql, args }); return statement; },
      async first() {
        if (sql.startsWith("INSERT INTO social_posts")) return { id: "p", ...valid, timestamp: "2026-07-18T11:59:00.000Z" };
        return { request_count: 1 };
      },
      async all() { return { results: [] }; },
    };
    return statement;
  } };
  const store = createD1SocialPostStore(db);
  await store.create({ id: "p", ...valid, principal_id: ID, created_at: new Date(NOW).toISOString() });
  const rateLimit = createD1RateLimiter(db, { limit: 2 });
  assert.equal((await rateLimit(ID, NOW)).allowed, true);
  assert.match(seen[0].sql, /INSERT INTO social_posts/);
  assert.equal(seen[0].args.length, 7);
  assert.match(seen[1].sql, /ON CONFLICT/);
  assert.deepEqual(seen[1].args, [ID, NOW]);
});

test("deployment adapter and migration keep persistence and auth at the edge", async () => {
  const [adapter, migration] = await Promise.all([
    readFile(new URL("../functions/api/social-posts.js", import.meta.url), "utf8"),
    readFile(new URL("../migrations/0003_social_posts.sql", import.meta.url), "utf8"),
  ]);
  assert.match(adapter, /env\.DB/);
  assert.match(adapter, /env\.AGENT_TOKENS/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS social_posts/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS social_post_rate_limits/);
});
