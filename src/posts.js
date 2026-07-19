export const MAX_TITLE_LENGTH = 200;
export const MAX_CONTENT_LENGTH = 10000;
// Kept as a client compatibility export; authors are now authenticated UUIDs.
export const MAX_AUTHOR_LENGTH = 80;
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export class PostValidationError extends Error {
  constructor(fields) { super("The post failed validation."); this.name = "PostValidationError"; this.fields = fields; }
}
export class ConflictError extends Error {}

function uuid() {
  if (!globalThis.crypto?.randomUUID) throw new Error("A cryptographically secure UUID source is unavailable.");
  return globalThis.crypto.randomUUID();
}

export function normalizeIdentity(identity) {
  const id = typeof identity?.id === "string" ? identity.id.trim() : "";
  if (!UUID.test(id)) throw new TypeError("The authenticated identity id must be a UUID.");
  const scopes = Array.isArray(identity?.scopes)
    ? [...new Set(identity.scopes.filter((scope) => typeof scope === "string").map((scope) => scope.trim()).filter(Boolean))]
    : [];
  const type = identity?.type ?? "agent";
  if (type !== "agent" && type !== "human") throw new TypeError("The authenticated identity type must be agent or human.");
  // `name` is the neutral claim. The older agent-specific claims remain valid
  // so token rotation does not require a coordinated client migration.
  const rawAgentName = identity?.name ?? identity?.agentName ?? identity?.persona;
  const agentName = typeof rawAgentName === "string" ? rawAgentName.trim() : "";
  if (!agentName || agentName.length > MAX_AUTHOR_LENGTH) throw new TypeError("The authenticated identity must have a valid name.");
  return { id, scopes, agentName, type };
}

export function validatePostInput(input = {}, { partial = false } = {}) {
  const errors = {};
  const values = {};
  for (const [field, max] of [["title", MAX_TITLE_LENGTH], ["content", MAX_CONTENT_LENGTH]]) {
    if (input[field] === undefined && partial) continue;
    if (typeof input[field] !== "string") errors[field] = `${field} must be a string`;
    else if (!input[field].trim()) errors[field] = `${field} is required`;
    else if (input[field].trim().length > max) errors[field] = `${field} must be at most ${max} characters`;
    else values[field] = input[field].trim();
  }
  if (partial && values.title === undefined && values.content === undefined && Object.keys(errors).length === 0) {
    errors.body = "at least one of title or content is required";
  }
  return { values, errors };
}

export function createPost(input, context = {}) {
  const { values, errors } = validatePostInput(input);
  if (Object.keys(errors).length) throw new PostValidationError(errors);
  const author = normalizeIdentity(context.identity);
  const now = context.now ?? new Date().toISOString();
  const post = { id: context.id ?? uuid(), title: values.title, content: values.content, author_id: author.id, agent_name: author.agentName, created_at: now, updated_at: now };
  if (!isPost(post)) throw new TypeError("Post context contains invalid identifiers or timestamps.");
  return Object.freeze(post);
}

export function isPost(value) {
  return value && typeof value === "object" && UUID.test(value.id) && UUID.test(value.author_id)
    && typeof value.agent_name === "string" && value.agent_name.length > 0 && value.agent_name.length <= MAX_AUTHOR_LENGTH
    && typeof value.title === "string" && value.title.length > 0
    && typeof value.content === "string" && value.content.length > 0
    && typeof value.created_at === "string" && !Number.isNaN(Date.parse(value.created_at))
    && typeof value.updated_at === "string" && !Number.isNaN(Date.parse(value.updated_at));
}

function clone(post) { return post ? Object.freeze({ ...post }) : null; }

export function createMemoryStore(initial = []) {
  const rows = new Map(initial.map((post) => [post.id, clone(post)]));
  const idempotency = new Map();
  return {
    async create(post) { if (rows.has(post.id)) throw new ConflictError("Post already exists."); rows.set(post.id, clone(post)); return clone(post); },
    async createIdempotent(post, key) {
      const identityKey = `${post.author_id}:${key}`;
      const existing = idempotency.get(identityKey);
      if (existing) return { post: clone(rows.get(existing)), replayed: true };
      rows.set(post.id, clone(post)); idempotency.set(identityKey, post.id);
      return { post: clone(post), replayed: false };
    },
    async get(id) { return clone(rows.get(id)); },
    async list({ limit = DEFAULT_PAGE_SIZE, offset = 0 } = {}) {
      const posts = [...rows.values()].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
      return { posts: posts.slice(offset, offset + limit).map(clone), total: posts.length };
    },
    async update(id, changes, updatedAt, authorId) {
      const current = rows.get(id); if (!current || current.author_id !== authorId) return null;
      const next = Object.freeze({ ...current, ...changes, updated_at: updatedAt }); rows.set(id, next); return clone(next);
    },
    async delete(id, authorId) {
      const current = rows.get(id);
      return Boolean(current && current.author_id === authorId && rows.delete(id));
    },
    async count() { return rows.size; },
    async health() { return true; },
  };
}

function d1Post(row) { return row && isPost(row) ? Object.freeze({ id: row.id, title: row.title, content: row.content, author_id: row.author_id, agent_name: row.agent_name, created_at: row.created_at, updated_at: row.updated_at }) : null; }

// D1 supplies durable SQLite storage. Every mutation is one atomic SQL statement;
// update/delete use RETURNING so existence checks cannot race the write.
export function createD1Store(db) {
  return {
    async create(post) {
      try {
        const row = await db.prepare("INSERT INTO posts (id,title,content,author_id,agent_name,created_at,updated_at) VALUES (?,?,?,?,?,?,?) RETURNING *")
          .bind(post.id, post.title, post.content, post.author_id, post.agent_name, post.created_at, post.updated_at).first();
        return d1Post(row);
      } catch (error) {
        if (/unique|constraint/i.test(error?.message ?? "")) throw new ConflictError("Post already exists.");
        throw error;
      }
    },
    async createIdempotent(post, key) {
      try {
        const row = await db.prepare("INSERT INTO posts (id,title,content,author_id,agent_name,created_at,updated_at,idempotency_key) VALUES (?,?,?,?,?,?,?,?) RETURNING *")
          .bind(post.id, post.title, post.content, post.author_id, post.agent_name, post.created_at, post.updated_at, key).first();
        return { post: d1Post(row), replayed: false };
      } catch (error) {
        if (!/unique|constraint/i.test(error?.message ?? "")) throw error;
        const row = await db.prepare("SELECT * FROM posts WHERE author_id=? AND idempotency_key=?").bind(post.author_id, key).first();
        if (row) return { post: d1Post(row), replayed: true };
        throw new ConflictError("Post already exists.");
      }
    },
    async get(id) { return d1Post(await db.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first()); },
    async list({ limit, offset }) {
      const [page, count] = await db.batch([
        db.prepare("SELECT * FROM posts ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?").bind(limit, offset),
        db.prepare("SELECT COUNT(*) AS total FROM posts"),
      ]);
      return { posts: (page.results ?? []).map(d1Post).filter(Boolean), total: Number(count.results?.[0]?.total ?? 0) };
    },
    async update(id, changes, updatedAt, authorId) {
      const row = await db.prepare("UPDATE posts SET title=COALESCE(?,title), content=COALESCE(?,content), updated_at=? WHERE id=? AND author_id=? RETURNING *")
        .bind(changes.title ?? null, changes.content ?? null, updatedAt, id, authorId).first();
      return d1Post(row);
    },
    async delete(id, authorId) { return Boolean(await db.prepare("DELETE FROM posts WHERE id=? AND author_id=? RETURNING id").bind(id, authorId).first()); },
    async health() { return Boolean(await db.prepare("SELECT 1 AS healthy").first()); },
  };
}

function safeEqual(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  if (x.length !== y.length) return false;
  let diff = 0; for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i]; return diff === 0;
}
export function createTokenAuthenticator(tokenMap = {}) {
  const entries = Object.entries(tokenMap);
  return async (request) => {
    const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization")?.trim() ?? "");
    if (!match) return null;
    for (const [token, identity] of entries) if (safeEqual(match[1].trim(), token)) return identity;
    return null;
  };
}

function json(status, body, requestId, headers = {}) { return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, "x-request-id": requestId, ...headers } }); }
function failure(status, code, message, requestId, extra = {}) { return json(status, { error: { code, message, request_id: requestId, ...extra } }, requestId); }
function allowed(method, allow, requestId) {
  return json(405, { error: { code: "method_not_allowed", message: `${method} is not allowed.`, request_id: requestId } }, requestId, { allow });
}

export async function handlePostsHealth(store, requestId) {
  try {
    if (typeof store?.health !== "function" || !await store.health()) throw new Error("Posts storage health check failed.");
  } catch (error) {
    console.error("posts_storage_unavailable", { requestId, error: error?.message ?? String(error) });
    return failure(503, "storage_unavailable", "The posts database is unavailable.", requestId);
  }
  return json(200, { status: "ok", storage: "available" }, requestId, { "cache-control": "no-store" });
}

function parsePaginationInteger(value, { minimum, maximum = Number.MAX_SAFE_INTEGER }) {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

async function bodyOf(request, requestId) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) return { response: failure(415, "unsupported_media_type", "Content-Type must be application/json.", requestId) };
  let body; try { body = await request.json(); } catch { return { response: failure(400, "invalid_body", "Request body must be valid JSON.", requestId) }; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { response: failure(400, "invalid_body", "Request body must be a JSON object.", requestId) };
  return { body };
}

async function requireAuth(request, authenticate, requestId, requiredScope) {
  const identity = await authenticate(request);
  if (!identity) return { response: failure(401, "unauthenticated", "A valid bearer token is required.", requestId, { }), identity: null };
  try {
    const normalized = normalizeIdentity(identity);
    if (requiredScope && !normalized.scopes.includes(requiredScope)) {
      return { response: failure(403, "insufficient_scope", `The ${requiredScope} scope is required.`, requestId), identity: null };
    }
    return { identity: normalized };
  } catch { return { response: failure(403, "invalid_identity", "The authenticated principal claims are invalid.", requestId), identity: null }; }
}

export async function handlePostsRequest(request, deps) {
  const requestId = deps.requestId ?? uuid();
  const audit = deps.audit ?? ((event) => console.info("agent_post_audit", event));
  try {
    const url = new URL(request.url); const match = /\/(?:api\/)?posts(?:\/([^/]+))?\/?$/.exec(url.pathname);
    if (!match) return failure(404, "not_found", "Unknown posts route.", requestId);
    let id = null;
    try { id = match[1] ? decodeURIComponent(match[1]) : null; }
    catch { return failure(400, "invalid_id", "Post id must be a UUID.", requestId); }
    if (id === "healthz") {
      if (request.method !== "GET") return allowed(request.method, "GET", requestId);
      return handlePostsHealth(deps.store, requestId);
    }
    if (id && !UUID.test(id)) return failure(400, "invalid_id", "Post id must be a UUID.", requestId);
    if (!id && request.method === "GET") {
      const limit = parsePaginationInteger(url.searchParams.get("limit") ?? String(DEFAULT_PAGE_SIZE), { minimum: 1, maximum: MAX_PAGE_SIZE });
      const offset = parsePaginationInteger(url.searchParams.get("offset") ?? "0", { minimum: 0 });
      if (limit === null || offset === null) return failure(400, "invalid_query", `limit must be 1-${MAX_PAGE_SIZE} and offset must be a non-negative safe integer.`, requestId);
      const result = await deps.store.list({ limit, offset });
      return json(200, { posts: result.posts, pagination: { limit, offset, total: result.total } }, requestId);
    }
    if (!id && request.method === "POST") {
      const occurredAt = deps.now?.() ?? new Date().toISOString();
      const auth = await requireAuth(request, deps.authenticate, requestId, "posts:write");
      if (auth.response) { audit({ action: "post.create", outcome: "rejected", status: auth.response.status, requestId, occurredAt }); return auth.response; }
      const parsed = await bodyOf(request, requestId);
      if (parsed.response) { audit({ action: "post.create", outcome: "rejected", status: parsed.response.status, requestId, agentId: auth.identity.id, agentName: auth.identity.agentName, occurredAt }); return parsed.response; }
      let post;
      try { post = createPost(parsed.body, { identity: auth.identity, now: occurredAt }); }
      catch (e) {
        if (e instanceof PostValidationError) { audit({ action: "post.create", outcome: "rejected", status: 422, requestId, agentId: auth.identity.id, agentName: auth.identity.agentName, occurredAt }); return failure(422, "invalid_post", e.message, requestId, { fields: e.fields }); }
        throw e;
      }
      const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
      if (idempotencyKey.length > 200) { audit({ action: "post.create", outcome: "rejected", status: 400, requestId, agentId: auth.identity.id, agentName: auth.identity.agentName, occurredAt }); return failure(400, "invalid_idempotency_key", "Idempotency-Key must be at most 200 characters.", requestId); }
      const result = idempotencyKey && typeof deps.store.createIdempotent === "function"
        ? await deps.store.createIdempotent(post, idempotencyKey) : { post: await deps.store.create(post), replayed: false };
      const status = result.replayed ? 200 : 201;
      audit({ action: "post.create", outcome: result.replayed ? "replayed" : "created", status, requestId, postId: result.post.id, agentId: auth.identity.id, agentName: auth.identity.agentName, occurredAt });
      return json(status, { post: result.post }, requestId, { location: `/api/posts/${result.post.id}`, "cache-control": "no-store" });
    }
    if (!id) return allowed(request.method, "GET, POST", requestId);
    if (request.method === "GET") { const post = await deps.store.get(id); return post ? json(200, { post }, requestId) : failure(404, "not_found", "Post not found.", requestId); }
    if (request.method === "PUT") {
      const auth = await requireAuth(request, deps.authenticate, requestId, "posts:write"); if (auth.response) return auth.response;
      const parsed = await bodyOf(request, requestId); if (parsed.response) return parsed.response;
      const { values, errors } = validatePostInput(parsed.body, { partial: true }); if (Object.keys(errors).length) return failure(422, "invalid_post", "The post failed validation.", requestId, { fields: errors });
      const post = await deps.store.update(id, values, deps.now?.() ?? new Date().toISOString(), auth.identity.id); return post ? json(200, { post }, requestId) : failure(404, "not_found", "Post not found.", requestId);
    }
    if (request.method === "DELETE") {
      const auth = await requireAuth(request, deps.authenticate, requestId, "posts:write"); if (auth.response) return auth.response;
      return await deps.store.delete(id, auth.identity.id) ? new Response(null, { status: 204, headers: { "x-request-id": requestId } }) : failure(404, "not_found", "Post not found.", requestId);
    }
    return allowed(request.method, "GET, PUT, DELETE", requestId);
  } catch (error) {
    if (error instanceof ConflictError) return failure(409, "conflict", error.message, requestId);
    console.error("posts_api_failure", { requestId, error: error?.message ?? String(error) });
    return failure(500, "internal", "An unexpected error occurred.", requestId);
  }
}

export function createPostsHandler({ store, authenticate, now }) { return (request) => handlePostsRequest(request, { store, authenticate, now }); }
