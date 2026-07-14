import test from "node:test";
import assert from "node:assert/strict";
import {
  createPost,
  validatePostInput,
  normalizeIdentity,
  isPost,
  createMemoryStore,
  createKvStore,
  createTokenAuthenticator,
  handlePostsRequest,
  PostValidationError,
  ConflictError,
  InvalidCursorError,
  MAX_CONTENT_LENGTH,
} from "../src/posts.js";

const IDENTITY = { id: "backend", persona: "Rowan", runId: "run-1" };

// --------------------------------------------------------------------------
// Data model
// --------------------------------------------------------------------------

test("createPost normalizes fields and derives server-side agent metadata", () => {
  const post = createPost(
    { content: "  Shipped the queue.  " },
    { identity: IDENTITY, id: "p1", createdAt: "2026-07-14T00:00:00.000Z" },
  );
  assert.deepEqual(post, {
    id: "p1",
    content: "Shipped the queue.",
    author: "Rowan", // defaults to the agent persona
    createdAt: "2026-07-14T00:00:00.000Z",
    agent: { id: "backend", persona: "Rowan", runId: "run-1" },
  });
  assert.throws(() => { post.content = "tampered"; }, TypeError, "posts are immutable");
});

test("createPost keeps an explicit author and falls back to agent id without a persona", () => {
  const withAuthor = createPost({ content: "hi", author: "  Ari  " }, { identity: IDENTITY, id: "a", createdAt: "2026-07-14T00:00:00.000Z" });
  assert.equal(withAuthor.author, "Ari");

  const noPersona = createPost({ content: "hi" }, { identity: { id: "svc-42" }, id: "b", createdAt: "2026-07-14T00:00:00.000Z" });
  assert.equal(noPersona.author, "svc-42");
  assert.equal(noPersona.agent.persona, null);
});

test("validatePostInput reports every field problem at once", () => {
  const errors = validatePostInput({ content: "", author: "  " }).errors;
  assert.equal(errors.content, "content is required");
  assert.equal(errors.author, "author must be a non-empty string when provided");

  assert.match(validatePostInput({ content: "x".repeat(MAX_CONTENT_LENGTH + 1) }).errors.content, /at most/);
  assert.equal(validatePostInput({ content: 42 }).errors.content, "content must be a string");
});

test("createPost throws a typed validation error the router can render", () => {
  try {
    createPost({ content: "" }, { identity: IDENTITY });
    assert.fail("expected PostValidationError");
  } catch (err) {
    assert.ok(err instanceof PostValidationError);
    assert.equal(err.code, "invalid_post");
    assert.equal(err.fields.content, "content is required");
  }
});

test("normalizeIdentity requires an id and normalizes optional context", () => {
  assert.throws(() => normalizeIdentity({ persona: "x" }), TypeError);
  assert.deepEqual(normalizeIdentity({ id: " svc ", persona: "" }), { id: "svc", persona: null, runId: null });
});

test("isPost guards corrupt records", () => {
  const good = createPost({ content: "ok" }, { identity: IDENTITY, id: "g", createdAt: "2026-07-14T00:00:00.000Z" });
  assert.ok(isPost(good));
  assert.equal(isPost({ id: "x", content: "", author: "a", createdAt: "2026-07-14T00:00:00.000Z", agent: { id: "a" } }), false);
  assert.equal(isPost({ ...good, createdAt: "never" }), false);
  assert.equal(isPost(null), false);
});

// --------------------------------------------------------------------------
// Transactional in-memory store
// --------------------------------------------------------------------------

function seed(store, ids) {
  return Promise.all(ids.map((id, i) =>
    store.insert(createPost({ content: `post ${id}` }, {
      identity: IDENTITY,
      id,
      createdAt: `2026-07-14T00:0${i}:00.000Z`,
    }))));
}

test("memory store round-trips a post and rejects duplicate ids", async () => {
  const store = createMemoryStore();
  const post = createPost({ content: "hello" }, { identity: IDENTITY, id: "p1", createdAt: "2026-07-14T00:00:00.000Z" });
  const { post: saved, replayed } = await store.insert(post);
  assert.equal(replayed, false);
  assert.deepEqual(await store.get("p1"), saved);
  assert.equal(await store.get("missing"), null);
  await assert.rejects(() => store.insert(post), ConflictError);
});

test("idempotency key makes a retried write safe", async () => {
  const store = createMemoryStore();
  const make = () => createPost({ content: "retry" }, { identity: IDENTITY, createdAt: "2026-07-14T00:00:00.000Z" });
  const first = await store.insert(make(), "key-1");
  const second = await store.insert(make(), "key-1");
  assert.equal(first.replayed, false);
  assert.equal(second.replayed, true);
  assert.equal(second.post.id, first.post.id);
  assert.equal(await store.count(), 1);
});

test("list returns a newest-first snapshot with bounded cursor pagination", async () => {
  const store = createMemoryStore();
  await seed(store, ["a", "b", "c"]); // c is newest
  const page1 = await store.list({ limit: 2 });
  assert.deepEqual(page1.posts.map((p) => p.id), ["c", "b"]);
  assert.ok(page1.nextCursor);

  const page2 = await store.list({ limit: 2, cursor: page1.nextCursor });
  assert.deepEqual(page2.posts.map((p) => p.id), ["a"]);
  assert.equal(page2.nextCursor, null);

  await assert.rejects(() => store.list({ cursor: "not-a-number" }), InvalidCursorError);
});

// --------------------------------------------------------------------------
// Agent authentication
// --------------------------------------------------------------------------

test("token authenticator resolves identities for valid bearer tokens only", async () => {
  const authenticate = createTokenAuthenticator({ "tok-good": IDENTITY });
  const auth = (header) => new Request("https://feed.test/api/posts", { headers: header ? { authorization: header } : {} });
  assert.deepEqual(await authenticate(auth("Bearer tok-good")), IDENTITY);
  assert.equal(await authenticate(auth("Bearer tok-bad")), null);
  assert.equal(await authenticate(auth("tok-good")), null); // missing scheme
  assert.equal(await authenticate(auth(null)), null);
});

// --------------------------------------------------------------------------
// HTTP API router
// --------------------------------------------------------------------------

function harness() {
  const store = createMemoryStore();
  const authenticate = createTokenAuthenticator({ "secret-token": IDENTITY });
  const deps = { store, authenticate };

  async function call(method, path, { token, body, rawBody } = {}) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    const init = { method, headers };
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    } else if (rawBody !== undefined) {
      headers["content-type"] = "application/json";
      init.body = rawBody;
    }
    const res = await handlePostsRequest(new Request(`https://feed.test${path}`, init), deps);
    let json = null;
    const text = await res.text();
    try { json = JSON.parse(text); } catch { /* non-JSON */ }
    return { res, status: res.status, json };
  }

  return { store, call };
}

test("POST rejects unauthenticated requests", async () => {
  const { call } = harness();
  const r = await call("POST", "/api/posts", { body: { content: "hi" } });
  assert.equal(r.status, 401);
  assert.equal(r.json.error.code, "unauthenticated");
  assert.ok(r.res.headers.get("x-request-id"), "failures carry a request id");
});

test("POST validates body shape and content", async () => {
  const { call } = harness();

  const badJson = await call("POST", "/api/posts", { token: "secret-token", rawBody: "{not json" });
  assert.equal(badJson.status, 400);
  assert.equal(badJson.json.error.code, "invalid_body");

  const notObject = await call("POST", "/api/posts", { token: "secret-token", body: ["nope"] });
  assert.equal(notObject.status, 400);
  assert.equal(notObject.json.error.code, "invalid_body");

  const invalid = await call("POST", "/api/posts", { token: "secret-token", body: { content: "" } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.json.error.code, "invalid_post");
  assert.equal(invalid.json.error.fields.content, "content is required");
});

test("POST creates a post with server-derived agent metadata and a Location header", async () => {
  const { call, store } = harness();
  // Client-sent agent metadata must be ignored; identity comes from the token.
  const r = await call("POST", "/api/posts", {
    token: "secret-token",
    body: { content: "shipping notes", author: "Rowan", agent: { id: "spoofed" } },
  });
  assert.equal(r.status, 201);
  assert.equal(r.json.post.content, "shipping notes");
  assert.equal(r.json.post.agent.id, "backend"); // not "spoofed"
  assert.equal(r.res.headers.get("location"), `/api/posts/${r.json.post.id}`);
  assert.ok(await store.get(r.json.post.id));
});

test("POST with an idempotency key replays instead of duplicating", async () => {
  const { call, store } = harness();
  const body = { content: "once", idempotencyKey: "k-1" };
  const first = await call("POST", "/api/posts", { token: "secret-token", body });
  const second = await call("POST", "/api/posts", { token: "secret-token", body });
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.json.post.id, first.json.post.id);
  assert.equal(await store.count(), 1);
});

test("GET returns a post or an observable 404", async () => {
  const { call } = harness();
  const created = await call("POST", "/api/posts", { token: "secret-token", body: { content: "readable" } });
  const found = await call("GET", `/api/posts/${created.json.post.id}`);
  assert.equal(found.status, 200);
  assert.equal(found.json.post.content, "readable");

  const missing = await call("GET", "/api/posts/does-not-exist");
  assert.equal(missing.status, 404);
  assert.equal(missing.json.error.code, "not_found");
});

test("GET list paginates newest-first and validates query params", async () => {
  const { call } = harness();
  for (const n of ["1", "2", "3"]) {
    await call("POST", "/api/posts", { token: "secret-token", body: { content: `post ${n}` } });
  }
  const page1 = await call("GET", "/api/posts?limit=2");
  assert.equal(page1.status, 200);
  assert.equal(page1.json.posts.length, 2);
  assert.equal(page1.json.posts[0].content, "post 3"); // newest first
  assert.ok(page1.json.nextCursor);

  const page2 = await call("GET", `/api/posts?limit=2&cursor=${page1.json.nextCursor}`);
  assert.equal(page2.json.posts.length, 1);
  assert.equal(page2.json.nextCursor, null);

  const badLimit = await call("GET", "/api/posts?limit=0");
  assert.equal(badLimit.status, 400);
  assert.equal(badLimit.json.error.code, "invalid_query");

  const badCursor = await call("GET", "/api/posts?cursor=abc");
  assert.equal(badCursor.status, 400);
});

test("router rejects unknown routes and unsupported methods", async () => {
  const { call } = harness();
  const method = await call("DELETE", "/api/posts");
  assert.equal(method.status, 405);
  assert.equal(method.res.headers.get("allow"), "GET, POST");

  const itemMethod = await call("POST", "/api/posts/some-id");
  assert.equal(itemMethod.status, 405);
  assert.equal(itemMethod.res.headers.get("allow"), "GET");
});

// --------------------------------------------------------------------------
// KV-backed store (deployed adapter)
// --------------------------------------------------------------------------

function mockKv() {
  const map = new Map();
  return {
    async get(key) {
      return map.has(key) ? map.get(key) : null;
    },
    async put(key, value) {
      map.set(key, value);
    },
    async list({ prefix = "", limit = 1000, cursor } = {}) {
      const all = [...map.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const slice = all.slice(start, start + limit);
      const next = start + slice.length;
      const complete = next >= all.length;
      return {
        keys: slice.map((name) => ({ name })),
        list_complete: complete,
        cursor: complete ? undefined : String(next),
      };
    },
  };
}

test("KV store round-trips, dedupes, and lists newest-first", async () => {
  const store = createKvStore(mockKv());
  await store.insert(createPost({ content: "oldest" }, { identity: IDENTITY, id: "k1", createdAt: "2026-07-14T00:00:00.000Z" }));
  await store.insert(createPost({ content: "newest" }, { identity: IDENTITY, id: "k2", createdAt: "2026-07-14T00:05:00.000Z" }));

  assert.equal((await store.get("k1")).content, "oldest");
  assert.equal(await store.get("missing"), null);

  const listed = await store.list({ limit: 10 });
  assert.deepEqual(listed.posts.map((p) => p.id), ["k2", "k1"]);

  const replay = await store.insert(
    createPost({ content: "again" }, { identity: IDENTITY, id: "k3", createdAt: "2026-07-14T00:06:00.000Z" }),
    "idem-1",
  );
  const replay2 = await store.insert(
    createPost({ content: "again" }, { identity: IDENTITY, id: "k4", createdAt: "2026-07-14T00:07:00.000Z" }),
    "idem-1",
  );
  assert.equal(replay.replayed, false);
  assert.equal(replay2.replayed, true);
  assert.equal(replay2.post.id, "k3");
});
