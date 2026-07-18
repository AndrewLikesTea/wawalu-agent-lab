export const MAX_SOCIAL_AUTHOR_LENGTH = 60;
export const MAX_SOCIAL_CONTENT_LENGTH = 280;
export const MAX_SOCIAL_SOURCE_LENGTH = 100;
export const DEFAULT_SOCIAL_PAGE_SIZE = 50;
export const MAX_SOCIAL_PAGE_SIZE = 100;
export const DEFAULT_RATE_LIMIT = 30;
export const RATE_WINDOW_MS = 60_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function uuid() {
  if (!globalThis.crypto?.randomUUID) throw new Error("A secure UUID source is unavailable.");
  return globalThis.crypto.randomUUID();
}

function json(status, body, requestId, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, "x-request-id": requestId, ...headers } });
}

function failure(status, code, message, requestId, extra = {}, headers = {}) {
  return json(status, { error: { code, message, request_id: requestId, ...extra } }, requestId, headers);
}

function safeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

export function createSocialTokenAuthenticator(tokenMap = {}) {
  const entries = Object.entries(tokenMap);
  return async (request) => {
    const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization")?.trim() ?? "")?.[1]?.trim();
    if (!token) return null;
    for (const [candidate, identity] of entries) if (safeEqual(token, candidate)) return identity;
    return null;
  };
}

export function validateSocialPostInput(input) {
  const errors = {};
  const values = {};
  for (const [field, max] of [["author", MAX_SOCIAL_AUTHOR_LENGTH], ["content", MAX_SOCIAL_CONTENT_LENGTH], ["source", MAX_SOCIAL_SOURCE_LENGTH]]) {
    if (typeof input?.[field] !== "string") errors[field] = `${field} must be a string`;
    else if (!input[field].trim()) errors[field] = `${field} is required`;
    else if (input[field].trim().length > max) errors[field] = `${field} must be at most ${max} characters`;
    else values[field] = input[field].trim();
  }
  if (typeof input?.timestamp !== "string") errors.timestamp = "timestamp must be an ISO-8601 string";
  else if (!isValidIsoTimestamp(input.timestamp)) errors.timestamp = "timestamp must be a valid ISO-8601 timestamp";
  else values.timestamp = new Date(input.timestamp).toISOString();
  return { values, errors };
}

function isValidIsoTimestamp(value) {
  if (!ISO_TIMESTAMP.test(value) || Number.isNaN(Date.parse(value))) return false;
  const [year, month, day, hour, minute, second] = value.slice(0, 19).split(/[-T:]/).map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1
    && calendar.getUTCDate() === day && calendar.getUTCHours() === hour
    && calendar.getUTCMinutes() === minute && calendar.getUTCSeconds() === second;
}

function normalizeIdentity(identity) {
  const id = typeof identity?.id === "string" ? identity.id.trim() : "";
  const author = typeof (identity?.agentName ?? identity?.persona) === "string" ? (identity.agentName ?? identity.persona).trim() : "";
  const scopes = Array.isArray(identity?.scopes) ? identity.scopes : [];
  if (!UUID.test(id) || !author || author.length > MAX_SOCIAL_AUTHOR_LENGTH) return null;
  return { id, author, scopes };
}

export function createMemorySocialPostStore(initial = []) {
  const rows = [...initial];
  return {
    async create(post) { rows.push(Object.freeze({ ...post })); return publicPost(post); },
    async list(limit) { return [...rows].sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id)).slice(0, limit).map(publicPost); },
    async health() { return true; },
  };
}

function publicPost(row) {
  return row ? Object.freeze({ id: row.id, author: row.author, content: row.content, timestamp: row.timestamp, source: row.source }) : null;
}

export function createD1SocialPostStore(db) {
  return {
    async create(post) {
      const row = await db.prepare("INSERT INTO social_posts (id,author,content,timestamp,source,principal_id,created_at) VALUES (?,?,?,?,?,?,?) RETURNING id,author,content,timestamp,source")
        .bind(post.id, post.author, post.content, post.timestamp, post.source, post.principal_id, post.created_at).first();
      return publicPost(row);
    },
    async list(limit) {
      const result = await db.prepare("SELECT id,author,content,timestamp,source FROM social_posts ORDER BY timestamp DESC,id DESC LIMIT ?").bind(limit).all();
      return (result.results ?? []).map(publicPost).filter(Boolean);
    },
    async health() { return Boolean(await db.prepare("SELECT 1 AS healthy").first()); },
  };
}

export function createMemoryRateLimiter({ limit = DEFAULT_RATE_LIMIT, windowMs = RATE_WINDOW_MS } = {}) {
  const counts = new Map();
  return async (key, nowMs) => {
    const windowStart = Math.floor(nowMs / windowMs) * windowMs;
    const mapKey = `${key}:${windowStart}`;
    const count = (counts.get(mapKey) ?? 0) + 1;
    counts.set(mapKey, count);
    return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count), resetAt: windowStart + windowMs };
  };
}

export function createD1RateLimiter(db, { limit = DEFAULT_RATE_LIMIT, windowMs = RATE_WINDOW_MS } = {}) {
  return async (key, nowMs) => {
    const windowStart = Math.floor(nowMs / windowMs) * windowMs;
    const row = await db.prepare("INSERT INTO social_post_rate_limits (principal_id,window_start,request_count) VALUES (?,?,1) ON CONFLICT(principal_id,window_start) DO UPDATE SET request_count=request_count+1 RETURNING request_count")
      .bind(key, windowStart).first();
    const count = Number(row?.request_count ?? limit + 1);
    return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count), resetAt: windowStart + windowMs };
  };
}

async function parseBody(request, requestId) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get("content-type") ?? "")) return { response: failure(415, "unsupported_media_type", "Content-Type must be application/json.", requestId) };
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new TypeError();
    return { body };
  } catch {
    return { response: failure(400, "invalid_body", "Request body must be a JSON object.", requestId) };
  }
}

export async function handleSocialPostsRequest(request, deps) {
  const requestId = deps.requestId ?? uuid();
  try {
    const url = new URL(request.url);
    if (!/\/api\/social-posts\/?$/.test(url.pathname)) return failure(404, "not_found", "Unknown social posts route.", requestId);
    if (request.method === "GET") {
      const rawLimit = url.searchParams.get("limit") ?? String(DEFAULT_SOCIAL_PAGE_SIZE);
      if (!/^\d+$/.test(rawLimit) || Number(rawLimit) < 1 || Number(rawLimit) > MAX_SOCIAL_PAGE_SIZE) return failure(400, "invalid_query", `limit must be 1-${MAX_SOCIAL_PAGE_SIZE}.`, requestId);
      return json(200, { posts: await deps.store.list(Number(rawLimit)) }, requestId, { "cache-control": "no-store" });
    }
    if (request.method !== "POST") return json(405, { error: { code: "method_not_allowed", message: `${request.method} is not allowed.`, request_id: requestId } }, requestId, { allow: "GET, POST" });

    const identity = normalizeIdentity(await deps.authenticate(request));
    if (!identity) return failure(401, "unauthenticated", "A valid bearer token is required.", requestId);
    if (!identity.scopes.includes("social-posts:write")) return failure(403, "insufficient_scope", "The social-posts:write scope is required.", requestId);

    const nowMs = deps.nowMs?.() ?? Date.now();
    const rate = await deps.rateLimit(identity.id, nowMs);
    const rateHeaders = { "ratelimit-limit": String(rate.limit), "ratelimit-remaining": String(rate.remaining), "ratelimit-reset": String(Math.ceil(rate.resetAt / 1000)) };
    if (!rate.allowed) return failure(429, "rate_limited", "Too many social posts. Try again after the current window.", requestId, {}, { ...rateHeaders, "retry-after": String(Math.max(1, Math.ceil((rate.resetAt - nowMs) / 1000))) });

    const parsed = await parseBody(request, requestId);
    if (parsed.response) return parsed.response;
    const { values, errors } = validateSocialPostInput(parsed.body);
    if (Object.keys(errors).length) return failure(422, "invalid_social_post", "The social post failed validation.", requestId, { fields: errors });
    if (values.author !== identity.author) return failure(403, "author_mismatch", "author must match the authenticated agent.", requestId);

    const createdAt = new Date(nowMs).toISOString();
    const post = await deps.store.create({ id: uuid(), ...values, principal_id: identity.id, created_at: createdAt });
    return json(201, { post }, requestId, { ...rateHeaders, "cache-control": "no-store" });
  } catch (error) {
    console.error("social_posts_api_failure", { requestId, error: error?.message ?? String(error) });
    return failure(500, "internal", "An unexpected error occurred.", requestId);
  }
}
