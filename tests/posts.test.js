import test from "node:test";
import assert from "node:assert/strict";
import {
  createPost, createMemoryStore, createD1Store, createTokenAuthenticator,
  handlePostsRequest, validatePostInput, MAX_TITLE_LENGTH, MAX_CONTENT_LENGTH,
} from "../src/posts.js";

const AUTHOR_ID = "11111111-1111-4111-8111-111111111111";
const POST_ID = "22222222-2222-4222-8222-222222222222";
const MISSING_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_AUTHOR_ID = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-07-18T12:00:00.000Z";
const LATER = "2026-07-18T13:00:00.000Z";

test("post model has only the explicit durable fields", () => {
  const post = createPost({ title: "  Release  ", content: " shipped " }, { identity: { id: AUTHOR_ID }, id: POST_ID, now: NOW });
  assert.deepEqual(post, { id: POST_ID, title: "Release", content: "shipped", author_id: AUTHOR_ID, created_at: NOW, updated_at: NOW });
  assert.throws(() => { post.title = "changed"; }, TypeError);
});

test("validation is bounded and supports partial updates", () => {
  assert.deepEqual(validatePostInput({}).errors, { title: "title must be a string", content: "content must be a string" });
  assert.match(validatePostInput({ title: "x".repeat(MAX_TITLE_LENGTH + 1), content: "x" }).errors.title, /at most/);
  assert.match(validatePostInput({ title: "x", content: "x".repeat(MAX_CONTENT_LENGTH + 1) }).errors.content, /at most/);
  assert.equal(validatePostInput({}, { partial: true }).errors.body, "at least one of title or content is required");
});

function harness() {
  const store = createMemoryStore();
  const authenticate = createTokenAuthenticator({ secret: { id: AUTHOR_ID, scopes: ["posts:write"] }, unscoped: { id: AUTHOR_ID }, other: { id: OTHER_AUTHOR_ID, scopes: ["posts:write"] } });
  let now = NOW;
  async function call(method, path, options = {}) {
    const headers = {};
    if (options.token) headers.authorization = `Bearer ${options.token}`;
    if (options.body !== undefined || options.raw !== undefined) headers["content-type"] = options.contentType ?? "application/json";
    const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    const response = await handlePostsRequest(new Request(`https://test.invalid${path}`, { method, headers, body }), { store, authenticate, now: () => now, requestId: "req-1" });
    const text = await response.text(); let json = null; if (text) json = JSON.parse(text);
    return { response, status: response.status, json };
  }
  return { store, call, later: () => { now = LATER; } };
}

test("write endpoints require authentication", async () => {
  const { call } = harness();
  assert.equal((await call("POST", "/api/posts", { body: { title: "x", content: "y" } })).status, 401);
  assert.equal((await call("PUT", `/api/posts/${POST_ID}`, { body: { title: "x" } })).status, 401);
  assert.equal((await call("DELETE", `/api/posts/${POST_ID}`)).status, 401);
  assert.equal((await call("POST", "/api/posts", { token: "unscoped", body: { title: "x", content: "y" } })).status, 403);
});

test("POST creates, derives author, and rejects malformed input", async () => {
  const { call } = harness();
  const badType = await call("POST", "/api/posts", { token: "secret", body: {}, contentType: "text/plain" });
  assert.equal(badType.status, 415);
  assert.equal((await call("POST", "/api/posts", { token: "secret", raw: "{" })).status, 400);
  const invalid = await call("POST", "/api/posts", { token: "secret", body: { title: "", content: "" } });
  assert.equal(invalid.status, 422);
  const made = await call("POST", "/api/posts", { token: "secret", body: { title: "Title", content: "Body", author_id: MISSING_ID } });
  assert.equal(made.status, 201);
  assert.equal(made.json.post.author_id, AUTHOR_ID);
  assert.match(made.json.post.id, /^[0-9a-f-]{36}$/);
  assert.equal(made.response.headers.get("location"), `/api/posts/${made.json.post.id}`);
});

test("GET collection is public, bounded, and GET item reports 404", async () => {
  const { call } = harness();
  const first = await call("POST", "/api/posts", { token: "secret", body: { title: "A", content: "a" } });
  const list = await call("GET", "/api/posts?limit=1&offset=0");
  assert.equal(list.status, 200); assert.equal(list.json.posts.length, 1); assert.equal(list.json.pagination.total, 1);
  assert.equal((await call("GET", "/api/posts?limit=101")).status, 400);
  assert.equal((await call("GET", `/api/posts/${first.json.post.id}`)).status, 200);
  assert.equal((await call("GET", `/api/posts/${MISSING_ID}`)).status, 404);
  assert.equal((await call("GET", "/api/posts/not-a-uuid")).status, 400);
});

test("PUT atomically updates mutable fields and DELETE removes the row", async () => {
  const { call, later } = harness();
  const made = await call("POST", "/api/posts", { token: "secret", body: { title: "Old", content: "Body" } });
  later();
  const changed = await call("PUT", `/api/posts/${made.json.post.id}`, { token: "secret", body: { title: "New", author_id: MISSING_ID } });
  assert.equal(changed.status, 200); assert.equal(changed.json.post.title, "New"); assert.equal(changed.json.post.author_id, AUTHOR_ID);
  assert.equal(changed.json.post.created_at, NOW); assert.equal(changed.json.post.updated_at, LATER);
  assert.equal((await call("PUT", `/api/posts/${made.json.post.id}`, { token: "other", body: { title: "stolen" } })).status, 404);
  assert.equal((await call("DELETE", `/api/posts/${made.json.post.id}`, { token: "other" })).status, 404);
  assert.equal((await call("PUT", `/api/posts/${MISSING_ID}`, { token: "secret", body: { title: "x" } })).status, 404);
  assert.equal((await call("DELETE", `/api/posts/${made.json.post.id}`, { token: "secret" })).status, 204);
  assert.equal((await call("DELETE", `/api/posts/${made.json.post.id}`, { token: "secret" })).status, 404);
});

test("healthz probes durable storage without authentication", async () => {
  const { call } = harness();
  const health = await call("GET", "/api/posts/healthz");
  assert.equal(health.status, 200);
  assert.deepEqual(health.json, { status: "ok", storage: "available" });
  assert.equal(health.response.headers.get("cache-control"), "no-store");
});

test("healthz reports an unavailable durable store without leaking details", async () => {
  const response = await handlePostsRequest(new Request("https://x/api/posts/healthz"), {
    store: { health: async () => { throw new Error("database password"); } },
    authenticate: async () => null,
    requestId: "health-trace",
  });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error.code, "storage_unavailable");
  assert.equal(body.error.request_id, "health-trace");
  assert.doesNotMatch(body.error.message, /password/);
});

test("unexpected storage failures are observable without leaking details", async () => {
  const response = await handlePostsRequest(new Request("https://x/api/posts"), { store: { list: async () => { throw new Error("database password"); } }, authenticate: async () => null, requestId: "trace" });
  assert.equal(response.status, 500); const body = await response.json(); assert.equal(body.error.request_id, "trace"); assert.doesNotMatch(body.error.message, /password/);
});

test("D1 repository uses parameterized atomic mutation statements", async () => {
  const seen = [];
  const db = { prepare(sql) { const stmt = { bind(...args) { seen.push({ sql, args }); return stmt; }, async first() { return sql.startsWith("INSERT") ? { id: POST_ID, title: "T", content: "C", author_id: AUTHOR_ID, created_at: NOW, updated_at: NOW } : null; } }; return stmt; } };
  const store = createD1Store(db);
  const saved = await store.create(createPost({ title: "T", content: "C" }, { identity: { id: AUTHOR_ID }, id: POST_ID, now: NOW }));
  assert.equal(saved.id, POST_ID); assert.match(seen[0].sql, /INSERT INTO posts/); assert.equal(seen[0].args.length, 6);
});
