// Social feed foundation for Shiplog: a durable Post data model plus a bounded,
// runtime-agnostic HTTP API. Everything here is pure/injectable so the same code
// runs under `node --test` and inside a Cloudflare Pages Function — the router
// speaks the Web `Request`/`Response` contract and takes its store, clock, id
// source, and authenticator as dependencies. No DOM, no localStorage.
//
// Design contracts (server-side, explicit on purpose):
//   * A Post is immutable once created. Its `agent` block is derived from the
//     authenticated identity and OVERWRITES any client-sent value, mirroring the
//     ingest boundary in OPERATIONS.md ("proxy derives identity from the token").
//   * Writes are transactional: id uniqueness is enforced atomically, and an
//     optional idempotency key makes agent retries safe (replay returns the
//     original post instead of duplicating it).
//   * Failures are observable: every error response is a structured JSON contract
//     `{ error: { code, message, ... } }` carrying the request id, never a bare
//     throw across the boundary.

export const MAX_CONTENT_LENGTH = 500;
export const MAX_AUTHOR_LENGTH = 80;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function newId() {
  return globalThis.crypto?.randomUUID?.() ?? `post-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Coerce an authenticated identity into a stable, minimal agent-metadata block.
// `id` is mandatory; persona/runId are optional context and default to null so
// stored posts have a uniform shape.
export function normalizeIdentity(identity) {
  const id = normalizeText(identity?.id);
  if (!id) throw new TypeError("An authenticated agent identity requires an id.");
  return {
    id,
    persona: normalizeText(identity?.persona) || null,
    runId: normalizeText(identity?.runId) || null,
  };
}

// Field-level validation. Returns the normalized values plus an `errors` map so
// the API can report every problem at once instead of failing on the first.
export function validatePostInput(input = {}) {
  const errors = {};

  let content = "";
  if (typeof input.content !== "string") {
    errors.content = "content must be a string";
  } else {
    content = input.content.trim();
    if (!content) errors.content = "content is required";
    else if (content.length > MAX_CONTENT_LENGTH) {
      errors.content = `content must be at most ${MAX_CONTENT_LENGTH} characters`;
    }
  }

  // author is an optional display handle; it defaults to the agent identity when
  // omitted. When present it must be a non-empty, bounded string.
  let author = null;
  if (input.author !== undefined && input.author !== null) {
    if (typeof input.author !== "string" || !input.author.trim()) {
      errors.author = "author must be a non-empty string when provided";
    } else if (input.author.trim().length > MAX_AUTHOR_LENGTH) {
      errors.author = `author must be at most ${MAX_AUTHOR_LENGTH} characters`;
    } else {
      author = input.author.trim();
    }
  }

  return { content, author, errors };
}

// Build a normalized, immutable Post. Throws PostValidationError on bad input so
// callers off the HTTP path (tests, scripts) get a typed failure; the router
// catches it and renders the structured 400 contract.
export function createPost(input, context = {}) {
  const { content, author, errors } = validatePostInput(input);
  if (Object.keys(errors).length > 0) {
    throw new PostValidationError(errors);
  }
  const agent = normalizeIdentity(context.identity);
  return Object.freeze({
    id: context.id ?? newId(),
    content,
    author: author ?? agent.persona ?? agent.id,
    createdAt: context.createdAt ?? new Date().toISOString(),
    agent,
  });
}

// Guard for data crossing a trust boundary (e.g. rehydrated from KV). Keeps a
// corrupt record from poisoning a list response.
export function isPost(value) {
  return value !== null
    && typeof value === "object"
    && typeof value.id === "string" && value.id !== ""
    && typeof value.content === "string" && value.content.trim() !== ""
    && typeof value.author === "string" && value.author.trim() !== ""
    && typeof value.createdAt === "string" && !Number.isNaN(Date.parse(value.createdAt))
    && value.agent !== null && typeof value.agent === "object"
    && typeof value.agent.id === "string" && value.agent.id !== "";
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

export class PostValidationError extends Error {
  constructor(fields) {
    super("The post failed validation.");
    this.name = "PostValidationError";
    this.code = "invalid_post";
    this.fields = fields;
  }
}

export class ConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConflictError";
    this.code = "conflict";
  }
}

export class InvalidCursorError extends Error {
  constructor(message = "The pagination cursor is malformed.") {
    super(message);
    this.name = "InvalidCursorError";
    this.code = "invalid_cursor";
  }
}

// ---------------------------------------------------------------------------
// Transactional store (reference implementation, in-memory)
// ---------------------------------------------------------------------------

// Single-writer, append-only log with an id index and an optional idempotency
// index. JavaScript's run-to-completion model gives us atomic check-and-insert:
// there is no `await` between the uniqueness check and the append, so two
// concurrent creates cannot both observe "absent" and both write.
export function createMemoryStore(initial = []) {
  const log = []; // insertion order == chronological order (monotonic seq)
  const byId = new Map();
  const byIdempotencyKey = new Map();

  function snapshotOf(entry) {
    return entry.post;
  }

  const store = {
    // Atomically insert a post. `idempotencyKey` (optional) makes the write
    // safe to retry: a repeat with the same key returns { post, replayed: true }
    // instead of creating a duplicate or throwing.
    async insert(post, idempotencyKey) {
      if (!isPost(post)) throw new TypeError("insert requires a valid post");

      if (idempotencyKey) {
        const existing = byIdempotencyKey.get(idempotencyKey);
        if (existing) return { post: existing.post, replayed: true };
      }
      if (byId.has(post.id)) {
        throw new ConflictError(`A post with id ${post.id} already exists.`);
      }

      const entry = { post, seq: log.length, idempotencyKey: idempotencyKey ?? null };
      log.push(entry);
      byId.set(post.id, entry);
      if (idempotencyKey) byIdempotencyKey.set(idempotencyKey, entry);
      return { post, replayed: false };
    },

    async get(id) {
      return byId.get(id)?.post ?? null;
    },

    // Consistent snapshot, newest first, with bounded cursor pagination. The
    // opaque cursor encodes the seq of the last item already returned; the store
    // owns its format and rejects a malformed one. `nextCursor` is null at the
    // end of the feed.
    async list({ limit = DEFAULT_PAGE_SIZE, cursor = null } = {}) {
      let beforeSeq = log.length;
      if (cursor !== null && cursor !== undefined) {
        const parsed = Number(cursor);
        if (!Number.isInteger(parsed) || parsed < 0) throw new InvalidCursorError();
        beforeSeq = parsed;
      }
      const page = [];
      // Walk backwards from the newest entry strictly older than the cursor.
      for (let i = Math.min(beforeSeq, log.length) - 1; i >= 0; i--) {
        page.push(log[i]);
        if (page.length >= limit) break;
      }
      const last = page[page.length - 1];
      const nextCursor = last && last.seq > 0 ? String(last.seq) : null;
      return { posts: page.map(snapshotOf), nextCursor };
    },

    async count() {
      return log.length;
    },
  };

  for (const post of initial) {
    // Seed synchronously-ish; insert is async but resolves immediately here.
    store.insert(post);
  }
  return store;
}

// ---------------------------------------------------------------------------
// KV-backed store (for the deployed Cloudflare Pages Function)
// ---------------------------------------------------------------------------

// Cloudflare Workers KV is eventually consistent and not transactional, so this
// adapter documents weaker guarantees than the in-memory reference: id
// uniqueness is best-effort (check-then-put can race), while idempotency keys and
// immutability keep the practical failure modes benign for an append-only feed.
// The record under `post:<id>` is the source of truth; a `feed:` index provides
// chronological ordering. Keys invert the timestamp so KV's ascending list order
// yields newest-first without loading the whole feed.
const KV_TIME_WIDTH = 14; // digits; fits millis well past year 2286

function feedKey(post) {
  const inverted = (10 ** KV_TIME_WIDTH - 1) - Date.parse(post.createdAt);
  return `feed:${String(inverted).padStart(KV_TIME_WIDTH, "0")}:${post.id}`;
}

export function createKvStore(kv) {
  return {
    async insert(post, idempotencyKey) {
      if (!isPost(post)) throw new TypeError("insert requires a valid post");

      if (idempotencyKey) {
        const existingId = await kv.get(`idem:${idempotencyKey}`);
        if (existingId) {
          const existing = await this.get(existingId);
          if (existing) return { post: existing, replayed: true };
        }
      }
      if (await kv.get(`post:${post.id}`)) {
        throw new ConflictError(`A post with id ${post.id} already exists.`);
      }

      const serialized = JSON.stringify(post);
      // Source of truth first, then the secondary index, then the idem pointer.
      await kv.put(`post:${post.id}`, serialized);
      await kv.put(feedKey(post), post.id);
      if (idempotencyKey) await kv.put(`idem:${idempotencyKey}`, post.id);
      return { post, replayed: false };
    },

    async get(id) {
      const raw = await kv.get(`post:${id}`);
      if (!raw) return null;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return null;
      }
      return isPost(parsed) ? parsed : null;
    },

    async list({ limit = DEFAULT_PAGE_SIZE, cursor = null } = {}) {
      const result = await kv.list({ prefix: "feed:", limit, cursor: cursor || undefined });
      const posts = [];
      for (const key of result.keys) {
        const id = key.name.slice(key.name.lastIndexOf(":") + 1);
        const post = await this.get(id);
        if (post) posts.push(post); // skip any index entry whose record is gone
      }
      return { posts, nextCursor: result.list_complete ? null : result.cursor ?? null };
    },
  };
}

// ---------------------------------------------------------------------------
// Agent authentication
// ---------------------------------------------------------------------------

// Length-independent-ish constant comparison. Portable across node and Workers
// (no node:crypto). Length is allowed to leak; token contents are not.
function safeEqual(a, b) {
  const enc = new TextEncoder();
  const bufA = enc.encode(String(a));
  const bufB = enc.encode(String(b));
  if (bufA.length !== bufB.length) return false;
  let diff = 0;
  for (let i = 0; i < bufA.length; i++) diff |= bufA[i] ^ bufB[i];
  return diff === 0;
}

function readBearerToken(request) {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

// Build an authenticator from a { token -> identity } map. Returns an async fn
// `(request) -> identity | null`. Comparison is constant-time per candidate so a
// bad token cannot be distinguished by timing.
export function createTokenAuthenticator(tokenMap) {
  const entries = Object.entries(tokenMap ?? {});
  return async function authenticate(request) {
    const presented = readBearerToken(request);
    if (!presented) return null;
    for (const [token, identity] of entries) {
      if (safeEqual(presented, token)) return identity;
    }
    return null;
  };
}

// ---------------------------------------------------------------------------
// Bounded HTTP API
// ---------------------------------------------------------------------------

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(status, body, requestId, extraHeaders = {}) {
  const headers = { ...JSON_HEADERS, ...extraHeaders };
  if (requestId) headers["x-request-id"] = requestId;
  return new Response(JSON.stringify(body), { status, headers });
}

function errorResponse(status, code, message, requestId, extra = {}) {
  return json(status, { error: { code, message, requestId: requestId ?? null, ...extra } }, requestId);
}

function methodNotAllowed(method, resource, allow, requestId) {
  return json(
    405,
    { error: { code: "method_not_allowed", message: `${method} is not allowed on ${resource}.`, requestId } },
    requestId,
    { allow },
  );
}

function parseLimit(raw) {
  if (raw === null || raw === "") return DEFAULT_PAGE_SIZE;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return { error: "limit must be a positive integer" };
  return Math.min(n, MAX_PAGE_SIZE); // clamp rather than reject an over-large page
}

// The router. `deps` = { store, authenticate, requestId? }. Never throws across
// the boundary: unexpected errors become an observable 500 contract.
export async function handlePostsRequest(request, deps) {
  const { store, authenticate } = deps;
  const requestId = deps.requestId ?? newId();
  const url = new URL(request.url);
  // Normalize to the resource path under /api/posts, tolerant of trailing slash.
  const path = url.pathname.replace(/\/+$/, "");
  const rest = path.replace(/^.*\/api\/posts/, ""); // "" | "/:id"

  try {
    if (rest === "" || rest === "/") {
      if (request.method === "GET") return await listPosts(url, store, requestId);
      if (request.method === "POST") return await createPostRequest(request, deps, requestId);
      return methodNotAllowed(request.method, "the posts collection", "GET, POST", requestId);
    }

    const idMatch = /^\/([^/]+)$/.exec(rest);
    if (idMatch) {
      if (request.method === "GET") return await getPostRequest(decodeURIComponent(idMatch[1]), store, requestId);
      return methodNotAllowed(request.method, "a post", "GET", requestId);
    }

    return errorResponse(404, "not_found", "Unknown posts route.", requestId);
  } catch (err) {
    // Last line of defense: surface an id so the failure is traceable in logs.
    return errorResponse(500, "internal", "An unexpected error occurred.", requestId, { detail: err?.message ?? String(err) });
  }
}

async function createPostRequest(request, deps, requestId) {
  const identity = await deps.authenticate(request);
  if (!identity) {
    return errorResponse(401, "unauthenticated", "A valid agent bearer token is required to post.", requestId);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "invalid_body", "Request body must be valid JSON.", requestId);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return errorResponse(400, "invalid_body", "Request body must be a JSON object.", requestId);
  }

  const idempotencyKey = typeof body.idempotencyKey === "string" && body.idempotencyKey.trim()
    ? body.idempotencyKey.trim()
    : (typeof request.headers.get === "function" ? request.headers.get("idempotency-key") : null) || null;

  let post;
  try {
    // agent metadata is server-derived from the token, never trusted from body.
    post = createPost({ content: body.content, author: body.author }, { identity });
  } catch (err) {
    if (err instanceof PostValidationError) {
      return errorResponse(400, err.code, "The post failed validation.", requestId, { fields: err.fields });
    }
    throw err;
  }

  let result;
  try {
    result = await deps.store.insert(post, idempotencyKey);
  } catch (err) {
    if (err instanceof ConflictError) {
      return errorResponse(409, "conflict", err.message, requestId);
    }
    throw err;
  }

  // Replay of an idempotent write is a 200 (nothing new created); a fresh write
  // is a 201 with a Location header pointing at the durable resource.
  const status = result.replayed ? 200 : 201;
  return json(status, { post: result.post }, requestId, { location: `/api/posts/${result.post.id}` });
}

async function getPostRequest(id, store, requestId) {
  const post = await store.get(id);
  if (!post) return errorResponse(404, "not_found", `No post with id ${id}.`, requestId);
  return json(200, { post }, requestId);
}

async function listPosts(url, store, requestId) {
  const limit = parseLimit(url.searchParams.get("limit"));
  if (typeof limit === "object") return errorResponse(400, "invalid_query", limit.error, requestId);

  const cursor = url.searchParams.get("cursor"); // opaque; the store validates it
  try {
    const { posts, nextCursor } = await store.list({ limit, cursor });
    return json(200, { posts, nextCursor: nextCursor ?? null, limit }, requestId);
  } catch (err) {
    if (err instanceof InvalidCursorError) {
      return errorResponse(400, "invalid_query", err.message, requestId);
    }
    throw err;
  }
}

// Convenience factory: bind a store + authenticator into a plain
// `(request) -> Promise<Response>` handler for a runtime to mount.
export function createPostsHandler({ store, authenticate }) {
  return (request) => handlePostsRequest(request, { store, authenticate });
}
