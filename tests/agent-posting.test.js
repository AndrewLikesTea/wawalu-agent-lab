import test from "node:test";
import assert from "node:assert/strict";
import {
  createPostingClient,
  PostingError,
  POSTING_CLIENT_VERSION,
} from "../src/agent-posting.js";
import {
  createMemoryStore,
  createTokenAuthenticator,
  handlePostsRequest,
} from "../src/posts.js";

const ENDPOINT = "https://feed.test/api/posts";
const TOKEN = "secret-token";
const IDENTITY = { id: "11111111-1111-4111-8111-111111111111", scopes: ["posts:write"], persona: "Ellis", runId: "run-1" };
const noSleep = async () => {};

// --------------------------------------------------------------------------
// Scripted fetch — drives error/retry paths without a real server or timers.
// --------------------------------------------------------------------------

// A response *spec* (not a live Response): a fresh Response is built per call so a
// repeated step is not defeated by single-use body consumption.
function jsonResponse(status, body, headers = {}) {
  return { status, body, headers: { "content-type": "application/json; charset=utf-8", ...headers } };
}

function buildResponse(spec) {
  if (spec instanceof Response) return spec; // raw Response: single-use by design
  return new Response(spec.body === null || spec.body === undefined ? null : JSON.stringify(spec.body), {
    status: spec.status,
    headers: spec.headers ?? {},
  });
}

// Each step is a response spec, a raw Response, or { throw } to simulate a network
// failure. The last step repeats if the client calls more times than there are
// steps, and a fresh Response is minted every call.
function scriptedFetch(steps) {
  const calls = [];
  let i = 0;
  async function fetchImpl(input, init) {
    calls.push({ url: String(input), init });
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    if (step && step.throw) throw step.throw;
    return buildResponse(step);
  }
  return { fetchImpl, calls };
}

// --------------------------------------------------------------------------
// Real-router fetch — wires the client to the actual server contract so the two
// halves cannot drift. This is the integration-in-isolation the task asks for.
// --------------------------------------------------------------------------

function routerHarness({ token = TOKEN } = {}) {
  const store = createMemoryStore();
  const authenticate = createTokenAuthenticator({ [TOKEN]: IDENTITY });
  async function fetchImpl(input, init = {}) {
    const request = new Request(String(input), init);
    return handlePostsRequest(request, { store, authenticate });
  }
  const client = createPostingClient({ fetch: fetchImpl, endpoint: ENDPOINT, token, sleep: noSleep });
  return { store, client };
}

// --------------------------------------------------------------------------
// Construction / least privilege
// --------------------------------------------------------------------------

test("construction requires fetch and endpoint", () => {
  assert.throws(() => createPostingClient({ endpoint: ENDPOINT }), TypeError);
  assert.throws(() => createPostingClient({ fetch: () => {} }), TypeError);
});

test("a token-less client is read-only and refuses to publish before any network call", async () => {
  const { fetchImpl, calls } = scriptedFetch([]);
  const client = createPostingClient({ fetch: fetchImpl, endpoint: ENDPOINT }); // no token
  await assert.rejects(() => client.publish("hi"), (err) => {
    assert.ok(err instanceof PostingError);
    assert.equal(err.code, "no_token");
    assert.equal(err.retryable, false);
    return true;
  });
  assert.equal(calls.length, 0, "must not touch the network without a token");
});

test("health needs no token — a monitor can be built with least privilege", async () => {
  const { fetchImpl, calls } = scriptedFetch([jsonResponse(200, { posts: [], nextCursor: null, limit: 1 }, { "x-request-id": "r1" })]);
  const client = createPostingClient({ fetch: fetchImpl, endpoint: ENDPOINT }); // no token
  const result = await client.health();
  assert.deepEqual(result, { ok: true, reason: "ok", status: 200, requestId: "r1" });
  assert.equal(calls[0].url, `${ENDPOINT}/healthz`);
  assert.equal(calls[0].init.method, "GET");
  assert.equal(calls[0].init.headers.authorization, undefined, "health carries no credentials");
});

// --------------------------------------------------------------------------
// Health probe states
// --------------------------------------------------------------------------

test("health reports storage_unavailable distinctly from other failures", async () => {
  const { fetchImpl } = scriptedFetch([
    jsonResponse(503, { error: { code: "storage_unavailable", message: "no KV" } }, { "x-request-id": "r2" }),
  ]);
  const client = createPostingClient({ fetch: fetchImpl, endpoint: ENDPOINT });
  const result = await client.health();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "storage_unavailable");
  assert.equal(result.status, 503);
});

test("health reports an unreachable endpoint without throwing", async () => {
  const { fetchImpl } = scriptedFetch([{ throw: new Error("ECONNREFUSED") }]);
  const client = createPostingClient({ fetch: fetchImpl, endpoint: ENDPOINT });
  const result = await client.health();
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unreachable");
  assert.equal(result.status, null);
});

// --------------------------------------------------------------------------
// Publish — happy path against the real server contract
// --------------------------------------------------------------------------

test("publish creates a post and identity is server-derived from the token", async () => {
  const { store, client } = routerHarness();
  const result = await client.publish({ content: "  shipped the rollback path  ", author: "Ari" });
  assert.equal(result.status, 201);
  assert.equal(result.replayed, false);
  assert.equal(result.post.content, "shipped the rollback path");
  assert.equal(result.post.title, "Agent update");
  assert.equal(result.post.author_id, IDENTITY.id); // from the token, not the body
  assert.equal(result.post.agent_name, IDENTITY.persona);
  assert.ok(result.requestId);
  assert.ok(await store.get(result.post.id));
});

test("publish accepts a bare string as content", async () => {
  const { client } = routerHarness();
  const result = await client.publish("terse update");
  assert.equal(result.status, 201);
  assert.equal(result.post.content, "terse update");
  assert.equal(result.post.author_id, IDENTITY.id);
});

test("publish sends the client version header", async () => {
  const { fetchImpl, calls } = scriptedFetch([jsonResponse(201, { post: { id: "p1", content: "x" } }, { "x-request-id": "r" })]);
  const client = createPostingClient({ fetch: fetchImpl, endpoint: ENDPOINT, token: TOKEN, sleep: noSleep });
  await client.publish("x");
  assert.equal(calls[0].init.headers["x-posting-client"], POSTING_CLIENT_VERSION);
  assert.equal(calls[0].init.headers.authorization, `Bearer ${TOKEN}`);
});

// --------------------------------------------------------------------------
// Rollback / idempotency — the write is all-or-nothing, never a duplicate
// --------------------------------------------------------------------------

test("repeating a logical publish replays the durable resource", async () => {
  const { store, client } = routerHarness();
  const first = await client.publish("once", { idempotencyKey: "k-1" });
  const second = await client.publish("once", { idempotencyKey: "k-1" });
  assert.equal(first.status, 201);
  assert.equal(first.replayed, false);
  assert.equal(second.status, 200);
  assert.equal(second.replayed, true);
  assert.equal(second.post.id, first.post.id);
  assert.equal(await store.count(), 1);
});

test("a transient network failure is retried with the same key and converges to one post", async () => {
  // First attempt dies mid-flight; the retry reuses the idempotency key and
  // succeeds. The endpoint must therefore never see two distinct writes.
  const seenKeys = [];
  let attempt = 0;
  async function fetchImpl(_input, init) {
    seenKeys.push(init.headers["idempotency-key"]);
    attempt += 1;
    if (attempt === 1) throw new Error("socket hang up");
    return jsonResponse(201, { post: { id: "p1", content: "resfilient" } }, { "x-request-id": "r" });
  }
  const client = createPostingClient({ fetch: fetchImpl, endpoint: ENDPOINT, token: TOKEN, sleep: noSleep });
  const result = await client.publish("resilient", { idempotencyKey: "k-9" });
  assert.equal(result.status, 201);
  assert.equal(attempt, 2);
  assert.deepEqual(seenKeys, ["k-9", "k-9"], "the same key is reused across the retry");
});

test("a retryable 503 is retried up to the attempt limit, then throws a typed error", async () => {
  const { fetchImpl, calls } = scriptedFetch([
    jsonResponse(503, { error: { code: "storage_unavailable", message: "no KV", requestId: "r3" } }),
  ]);
  const client = createPostingClient({ fetch: fetchImpl, endpoint: ENDPOINT, token: TOKEN, sleep: noSleep, maxAttempts: 3 });
  await assert.rejects(() => client.publish("x", { idempotencyKey: "k" }), (err) => {
    assert.ok(err instanceof PostingError);
    assert.equal(err.code, "storage_unavailable");
    assert.equal(err.status, 503);
    assert.equal(err.retryable, true);
    return true;
  });
  assert.equal(calls.length, 3, "exhausts the attempt budget");
});

// --------------------------------------------------------------------------
// Error mapping — client faults never retry and surface the server contract
// --------------------------------------------------------------------------

test("a 401 is not retried and surfaces the server error contract", async () => {
  const { fetchImpl, calls } = scriptedFetch([
    jsonResponse(401, { error: { code: "unauthenticated", message: "bad token", requestId: "r4" } }, { "x-request-id": "r4" }),
  ]);
  const client = createPostingClient({ fetch: fetchImpl, endpoint: ENDPOINT, token: "wrong", sleep: noSleep });
  await assert.rejects(() => client.publish("x"), (err) => {
    assert.equal(err.code, "unauthenticated");
    assert.equal(err.status, 401);
    assert.equal(err.retryable, false);
    assert.equal(err.requestId, "r4");
    return true;
  });
  assert.equal(calls.length, 1, "auth failures are the caller's fault — no retry");
});

test("invalid content fails locally with no network call", async () => {
  const { fetchImpl, calls } = scriptedFetch([]);
  const client = createPostingClient({ fetch: fetchImpl, endpoint: ENDPOINT, token: TOKEN, sleep: noSleep });
  await assert.rejects(() => client.publish({ content: "" }), (err) => {
    assert.equal(err.code, "invalid_post");
    assert.ok(err.fields.content);
    return true;
  });
  assert.equal(calls.length, 0, "local validation short-circuits the request");
});

test("a malformed (non-JSON) error body still yields a typed error", async () => {
  const { fetchImpl } = scriptedFetch([new Response("<html>502</html>", { status: 502 })]);
  const client = createPostingClient({ fetch: fetchImpl, endpoint: ENDPOINT, token: TOKEN, sleep: noSleep, maxAttempts: 1 });
  await assert.rejects(() => client.publish("x"), (err) => {
    assert.equal(err.status, 502);
    assert.equal(err.code, "http_502");
    assert.equal(err.retryable, true);
    return true;
  });
});
