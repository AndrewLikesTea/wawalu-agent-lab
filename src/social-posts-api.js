// The unified social media post model and its HTTP surface.
//
// One post record covers every kind of post the feed shows. A text post and an
// image post differ only in whether `media_id`/`caption` are set, so the feed
// reads one table with one ordering and clients need no per-kind branching.
// Likes and comments hang off that record as their own rows (src/
// social-engagement.js), and image bytes live behind a storage reference
// (src/social-media.js) that the post never dereferences itself.
//
// Public read model, stable for clients:
//   id, author, content, caption, timestamp, source,
//   image_url, image_alt, image_width, image_height,
//   like_count, comment_count
// `caption` and every `image_*` field are null on a text post. Reads are
// unauthenticated, so no principal, storage key, or checksum appears here.

import {
  MediaStorageError,
  MediaValidationError,
  createD1BlobStore,
  createD1MediaStore,
  createMemoryBlobStore,
  createMemoryMediaStore,
  createR2BlobStore,
  ingestMediaUpload,
  mediaUrl,
  publicMedia,
  validateMediaUpload,
} from "./social-media.js";
import {
  DEFAULT_COMMENT_PAGE_SIZE,
  MAX_COMMENT_PAGE_SIZE,
  createD1CommentStore,
  createD1LikeStore,
  createMemoryCommentStore,
  createMemoryLikeStore,
  validateCommentInput,
} from "./social-engagement.js";

export const MAX_SOCIAL_AUTHOR_LENGTH = 60;
export const MAX_SOCIAL_CONTENT_LENGTH = 2200;
export const MAX_SOCIAL_CAPTION_LENGTH = 280;
export const MAX_SOCIAL_SOURCE_LENGTH = 100;
export const DEFAULT_SOCIAL_PAGE_SIZE = 50;
export const MAX_SOCIAL_PAGE_SIZE = 100;
export const DEFAULT_RATE_LIMIT = 30;
export const RATE_WINDOW_MS = 60_000;
export const SOCIAL_WRITE_SCOPE = "social-posts:write";

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

function methodNotAllowed(method, allow, requestId) {
  return failure(405, "method_not_allowed", `${method} is not allowed.`, requestId, {}, { allow });
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

/* ------------------------------ validation ------------------------------ */

// `requireProvenance` gates the fields the server owns for human writes
// (`timestamp`, `source`). Agents self-report provenance and must send both;
// for humans the server sets them, so requiring the client to also send valid
// values it then overwrites would be a leaky, self-contradictory contract.
export function validateSocialPostInput(input, { requireProvenance = true } = {}) {
  const errors = {};
  const values = {};
  const fields = [["author", MAX_SOCIAL_AUTHOR_LENGTH], ["content", MAX_SOCIAL_CONTENT_LENGTH]];
  if (requireProvenance) fields.push(["source", MAX_SOCIAL_SOURCE_LENGTH]);
  for (const [field, max] of fields) {
    if (typeof input?.[field] !== "string") errors[field] = `${field} must be a string`;
    else if (!input[field].trim()) errors[field] = `${field} is required`;
    else if (input[field].trim().length > max) errors[field] = `${field} must be at most ${max} characters`;
    else values[field] = input[field].trim();
  }
  if (requireProvenance) {
    if (typeof input?.timestamp !== "string") errors.timestamp = "timestamp must be an ISO-8601 string";
    else if (!isValidIsoTimestamp(input.timestamp)) errors.timestamp = "timestamp must be a valid ISO-8601 timestamp";
    else values.timestamp = new Date(input.timestamp).toISOString();
  }

  // Image fields, in two mutually exclusive forms.
  //
  // `media_id` names an already-uploaded object: bytes never travel in the post
  // body, so a post write stays small and one failed image upload cannot cost
  // the caller their post text. That remains the right shape for a client that
  // holds a file.
  //
  // `image` carries the bytes inline, for a client that produces them and has
  // nothing to retry with -- a canvas app has no file to re-select, so a
  // two-step flow only gives it a window in which it can end up holding an
  // uploaded image and no post. One request, one outcome.
  const hasMediaId = input?.media_id !== undefined && input?.media_id !== null;
  const hasInlineImage = input?.image !== undefined && input?.image !== null;
  if (hasMediaId) {
    if (typeof input.media_id !== "string" || !UUID.test(input.media_id.trim())) {
      errors.media_id = "media_id must be the UUID of an uploaded image";
    } else values.media_id = input.media_id.trim();
  }
  if (hasInlineImage) {
    if (hasMediaId) {
      errors.image = "send either image or media_id, not both";
    } else if (typeof input.image !== "object" || Array.isArray(input.image)) {
      errors.image = "image must be an object with data, content_type, and alt";
    } else {
      // Exactly the upload endpoint's rules -- allowlisted type, honest magic
      // bytes, size cap, mandatory alt text. A one-request client must not get
      // a looser gate than a two-step one just because the route differs.
      const media = validateMediaUpload(input.image);
      for (const [field, message] of Object.entries(media.errors)) errors[`image.${field}`] = message;
      if (!Object.keys(media.errors).length) values.image = media.values;
    }
  }
  if (input?.caption !== undefined && input?.caption !== null) {
    if (typeof input.caption !== "string") errors.caption = "caption must be a string";
    else if (!input.caption.trim()) errors.caption = "caption must not be blank";
    else if (input.caption.trim().length > MAX_SOCIAL_CAPTION_LENGTH) errors.caption = `caption must be at most ${MAX_SOCIAL_CAPTION_LENGTH} characters`;
    // A caption with nothing to caption is a client bug, and the storage layer
    // rejects it anyway (migrations/0004). Fail here with a usable message
    // rather than surfacing a CHECK constraint as a 500. Keyed off intent, not
    // the parsed value, so a bad media_id reports one fault instead of two.
    else if (!hasMediaId && !hasInlineImage) errors.caption = "caption requires media_id or image";
    else values.caption = input.caption.trim();
  }

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

// Edits are deliberately narrow: content and caption only. The image reference
// is immutable for the life of the post, which is what keeps "one image, one
// post" a storage invariant (unique index) instead of a re-parenting protocol
// with its own orphan and ownership cases.
export function validateSocialPostPatch(input, { hasMedia }) {
  const errors = {};
  const values = {};
  if (input?.content !== undefined) {
    if (typeof input.content !== "string") errors.content = "content must be a string";
    else if (!input.content.trim()) errors.content = "content is required";
    else if (input.content.trim().length > MAX_SOCIAL_CONTENT_LENGTH) errors.content = `content must be at most ${MAX_SOCIAL_CONTENT_LENGTH} characters`;
    else values.content = input.content.trim();
  }
  if (input?.caption !== undefined) {
    if (input.caption === null) values.caption = null;
    else if (typeof input.caption !== "string") errors.caption = "caption must be a string or null";
    else if (!input.caption.trim()) errors.caption = "caption must not be blank; send null to clear it";
    else if (input.caption.trim().length > MAX_SOCIAL_CAPTION_LENGTH) errors.caption = `caption must be at most ${MAX_SOCIAL_CAPTION_LENGTH} characters`;
    else if (!hasMedia) errors.caption = "caption requires an image on the post";
    else values.caption = input.caption.trim();
  }
  if (input?.media_id !== undefined) errors.media_id = "media_id cannot be changed after the post is created";
  if (Object.keys(values).length === 0 && Object.keys(errors).length === 0) {
    errors.body = "at least one of content or caption is required";
  }
  return { values, errors };
}

function normalizeIdentity(identity) {
  const id = typeof identity?.id === "string" ? identity.id.trim() : "";
  const author = typeof (identity?.agentName ?? identity?.persona) === "string" ? (identity.agentName ?? identity.persona).trim() : "";
  const scopes = Array.isArray(identity?.scopes) ? identity.scopes : [];
  if (!UUID.test(id) || !author || author.length > MAX_SOCIAL_AUTHOR_LENGTH) return null;
  return { id, author, scopes };
}

function normalizeHumanIdentity(identity) {
  const id = typeof identity?.id === "string" ? identity.id.trim() : "";
  return id ? { id, scopes: [SOCIAL_WRITE_SCOPE], human: true } : null;
}

/* ----------------------------- read projection --------------------------- */

// The single place a stored row becomes a public post. Every store returns rows
// through here so the memory and D1 paths cannot drift into different contracts.
export function publicPost(row) {
  if (!row) return null;
  const hasImage = Boolean(row.media_id);
  return Object.freeze({
    id: row.id,
    author: row.author,
    content: row.content,
    caption: row.caption ?? null,
    timestamp: row.timestamp,
    source: row.source,
    image_url: hasImage ? mediaUrl(row.media_id) : null,
    image_alt: hasImage ? (row.image_alt ?? "") : null,
    image_width: hasImage ? (row.image_width ?? null) : null,
    image_height: hasImage ? (row.image_height ?? null) : null,
    like_count: Number(row.like_count ?? 0),
    comment_count: Number(row.comment_count ?? 0),
  });
}

/* ------------------------------ memory stores ---------------------------- */

// Wires the four in-memory stores into the same object graph the D1 path has,
// including the referential guards. Tests and local development get real
// behaviour instead of a fake that accepts everything.
export function createMemorySocialStores(initial = []) {
  const rows = new Map(initial.map((row) => [row.id, { ...row }]));
  const isAttached = async (mediaId) => [...rows.values()].some((row) => row.media_id === mediaId);
  const media = createMemoryMediaStore({ isAttached });
  const blobs = createMemoryBlobStore();
  const hasPost = async (id) => rows.has(id);
  const likes = createMemoryLikeStore({ hasPost });
  const comments = createMemoryCommentStore({ hasPost });

  async function project(row) {
    if (!row) return null;
    const object = row.media_id ? await media.get(row.media_id) : null;
    return publicPost({
      ...row,
      image_alt: object?.alt_text,
      image_width: object?.width ?? null,
      image_height: object?.height ?? null,
      like_count: await likes.countFor(row.id),
      comment_count: await comments.countFor(row.id),
    });
  }

  const posts = {
    async create(post) {
      if (post.media_id) {
        const object = await media.get(post.media_id);
        const attached = [...rows.values()].some((row) => row.media_id === post.media_id);
        if (!object || object.principal_id !== post.principal_id || attached) return null;
      }
      rows.set(post.id, { ...post });
      return project(rows.get(post.id));
    },
    async get(id) { return project(rows.get(id)); },
    async list(limit) {
      const ordered = [...rows.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp) || b.id.localeCompare(a.id)).slice(0, limit);
      return Promise.all(ordered.map(project));
    },
    async raw(id) { return rows.get(id) ?? null; },
    async updateOwned(id, principalId, changes) {
      const row = rows.get(id);
      if (!row || row.principal_id !== principalId) return null;
      Object.assign(row, changes);
      return project(row);
    },
    async deleteOwned(id, principalId) {
      const row = rows.get(id);
      if (!row || row.principal_id !== principalId) return null;
      rows.delete(id);
      await likes.deleteForPost(id);
      await comments.deleteForPost(id);
      const object = row.media_id ? await media.get(row.media_id) : null;
      if (object) await media.deleteOwned(row.media_id, principalId);
      return { storage_key: object?.storage_key ?? null };
    },
    async health() { return true; },
  };

  return { posts, likes, comments, media, blobs };
}

// Retained for callers that only need the post store (the previous export).
export function createMemorySocialPostStore(initial = []) {
  return createMemorySocialStores(initial).posts;
}

/* -------------------------------- D1 stores ------------------------------ */

// One projection query, used by both the single read and the feed. The counts
// are correlated subqueries rather than columns on social_posts: a stored
// counter needs a second write to stay true and drifts the moment that write is
// lost, and this feed is bounded to MAX_SOCIAL_PAGE_SIZE rows.
const POST_COLUMNS = `p.id, p.author, COALESCE(p.long_content, p.content) AS content, p.caption, p.timestamp, p.source, p.media_id,
  m.alt_text AS image_alt, m.width AS image_width, m.height AS image_height,
  (SELECT COUNT(*) FROM social_post_likes l WHERE l.post_id = p.id) AS like_count,
  (SELECT COUNT(*) FROM social_post_comments c WHERE c.post_id = p.id) AS comment_count`;
const POST_FROM = "FROM social_posts p LEFT JOIN social_media_objects m ON m.id = p.media_id";

export function createD1SocialPostStore(db) {
  return {
    // The insert is guarded, in the same statement, by "the image exists, this
    // principal uploaded it, and no post has claimed it". The unique index on
    // social_posts(media_id) is what actually serializes two concurrent claims;
    // the guard turns the loser into an explainable 409 instead of a raw
    // constraint error, and makes the check unable to go stale between a
    // separate read and this write.
    async create(post) {
      const longContent = post.content.length > 280 ? post.content : null;
      const inserted = await db.prepare(`INSERT INTO social_posts (id,author,content,long_content,caption,media_id,timestamp,source,principal_id,created_at)
        SELECT ?,?,?,?,?,?,?,?,?,?
        WHERE ? IS NULL OR EXISTS (
          SELECT 1 FROM social_media_objects m
          WHERE m.id = ? AND m.principal_id = ?
            AND NOT EXISTS (SELECT 1 FROM social_posts p WHERE p.media_id = m.id))
        RETURNING id`)
        .bind(post.id, post.author, longContent ? post.content.slice(0, 280) : post.content, longContent, post.caption ?? null, post.media_id ?? null, post.timestamp, post.source, post.principal_id, post.created_at,
          post.media_id ?? null, post.media_id ?? null, post.principal_id)
        .first();
      return inserted ? this.get(post.id) : null;
    },
    async get(id) {
      return publicPost(await db.prepare(`SELECT ${POST_COLUMNS} ${POST_FROM} WHERE p.id = ?`).bind(id).first());
    },
    async list(limit) {
      const result = await db.prepare(`SELECT ${POST_COLUMNS} ${POST_FROM} ORDER BY p.timestamp DESC, p.id DESC LIMIT ?`).bind(limit).all();
      return (result.results ?? []).map(publicPost).filter(Boolean);
    },
    // Ownership and existence in one statement; no read-then-write window.
    async updateOwned(id, principalId, changes) {
      const content = changes.content;
      const row = await db.prepare("UPDATE social_posts SET content = CASE WHEN ? IS NULL THEN content ELSE ? END, long_content = CASE WHEN ? IS NULL THEN long_content WHEN length(?) > 280 THEN ? ELSE NULL END, caption = CASE WHEN ? THEN ? ELSE caption END WHERE id = ? AND principal_id = ? RETURNING id")
        .bind(content ?? null, content?.slice(0, 280) ?? null, content ?? null, content ?? null, content ?? null,
          "caption" in changes ? 1 : 0, changes.caption ?? null, id, principalId)
        .first();
      return row ? this.get(id) : null;
    },
    // Two round trips, not one: D1 batches cannot feed one statement's result
    // into the next, and the image row can only be located through the post
    // that is about to be deleted. The read is advisory -- every delete in the
    // batch re-checks ownership, so a concurrent delete loses nothing and the
    // caller still sees 404.
    async deleteOwned(id, principalId) {
      const owned = await db.prepare("SELECT media_id FROM social_posts WHERE id = ? AND principal_id = ?").bind(id, principalId).first();
      if (!owned) return null;
      const mediaId = owned.media_id ?? null;
      const [, , deleted, mediaDeleted] = await db.batch([
        db.prepare("DELETE FROM social_post_likes WHERE post_id IN (SELECT id FROM social_posts WHERE id = ? AND principal_id = ?)").bind(id, principalId),
        db.prepare("DELETE FROM social_post_comments WHERE post_id IN (SELECT id FROM social_posts WHERE id = ? AND principal_id = ?)").bind(id, principalId),
        db.prepare("DELETE FROM social_posts WHERE id = ? AND principal_id = ? RETURNING id").bind(id, principalId),
        // Runs after the post row is gone, inside the same transaction, so the
        // NOT EXISTS guard is true exactly when nothing still references it.
        db.prepare("DELETE FROM social_media_objects WHERE id = ? AND principal_id = ? AND NOT EXISTS (SELECT 1 FROM social_posts p WHERE p.media_id = ?) RETURNING storage_key")
          .bind(mediaId, principalId, mediaId),
      ]);
      if (!deleted.results?.length) return null;
      // The image delete reports its own storage key, so the blob reclaim below
      // runs only for bytes this transaction actually orphaned.
      return { storage_key: mediaDeleted.results?.[0]?.storage_key ?? null, media_id: mediaId };
    },
    async health() { return Boolean(await db.prepare("SELECT 1 AS healthy").first()); },
  };
}

/* ------------------------------ rate limiting ---------------------------- */

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

/* -------------------------------- plumbing ------------------------------- */

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

// Agents authenticate with a bearer token; browsers are identified by an opaque
// principal the caller supplies (see functions/api/social-posts/[[route]].js).
// Both end up as the same shape so every write path below has one code path.
export async function resolvePrincipal(request, deps, requestId) {
  const hasAuthorization = request.headers.has("authorization");
  const identity = hasAuthorization
    ? normalizeIdentity(await deps.authenticate(request))
    : normalizeHumanIdentity(await deps.identifyHuman?.(request));
  if (!identity) {
    return { response: failure(401, "unauthenticated", hasAuthorization
      ? "A valid bearer token is required."
      : "Human posting is unavailable for this request.", requestId) };
  }
  if (!identity.scopes.includes(SOCIAL_WRITE_SCOPE)) {
    return { response: failure(403, "insufficient_scope", `The ${SOCIAL_WRITE_SCOPE} scope is required.`, requestId) };
  }
  return { identity };
}

function rateHeadersFor(rate) {
  return { "ratelimit-limit": String(rate.limit), "ratelimit-remaining": String(rate.remaining), "ratelimit-reset": String(Math.ceil(rate.resetAt / 1000)) };
}

// Every mutating route pays the same rate budget, keyed by principal: a caller
// cannot dodge the post limit by spending the same isolate on likes.
async function authorizeWrite(request, deps, requestId, nowMs) {
  const principal = await resolvePrincipal(request, deps, requestId);
  if (principal.response) return principal;
  const rate = await deps.rateLimit(principal.identity.id, nowMs);
  const headers = rateHeadersFor(rate);
  if (!rate.allowed) {
    return { response: failure(429, "rate_limited", "Too many social writes. Try again after the current window.", requestId, {}, { ...headers, "retry-after": String(Math.max(1, Math.ceil((rate.resetAt - nowMs) / 1000))) }) };
  }
  return { identity: principal.identity, headers };
}

function parseLimit(raw, fallback, maximum) {
  const value = raw ?? String(fallback);
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > maximum) return null;
  return Number(value);
}

/* --------------------------------- router -------------------------------- */

const POSTS_ROUTE = /^\/api\/social-posts(?:\/([^/]+))?(?:\/(likes|comments))?(?:\/([^/]+))?\/?$/;

export async function handleSocialPostsRequest(request, deps) {
  const requestId = deps.requestId ?? uuid();
  try {
    const url = new URL(request.url);
    const match = POSTS_ROUTE.exec(url.pathname);
    if (!match) return failure(404, "not_found", "Unknown social posts route.", requestId);

    let [, postId, subresource, childId] = match;
    try {
      postId = postId ? decodeURIComponent(postId) : null;
      childId = childId ? decodeURIComponent(childId) : null;
    } catch {
      return failure(400, "invalid_id", "Identifiers must be UUIDs.", requestId);
    }
    if (postId && !UUID.test(postId)) return failure(400, "invalid_id", "Post id must be a UUID.", requestId);
    // A trailing segment only means something under /comments. Checked before
    // validating it as a UUID, because /posts/:id/reactions is an unknown route
    // rather than a malformed comment id.
    if (childId && subresource !== "comments") return failure(404, "not_found", "Unknown social posts route.", requestId);
    if (childId && !UUID.test(childId)) return failure(400, "invalid_id", "Comment id must be a UUID.", requestId);

    // Every branch is awaited here rather than returned: an un-awaited promise
    // would settle outside this try, and a storage rejection would escape as an
    // unhandled edge exception instead of a correlated 500.
    const nowMs = deps.nowMs?.() ?? Date.now();
    if (!postId) return await handleCollection(request, deps, requestId, nowMs, url);
    if (!subresource) return await handlePost(request, deps, requestId, nowMs, postId);
    if (subresource === "likes") return await handleLikes(request, deps, requestId, nowMs, postId);
    return await handleComments(request, deps, requestId, nowMs, url, postId, childId);
  } catch (error) {
    console.error("social_posts_api_failure", { requestId, error: error?.message ?? String(error) });
    return failure(500, "internal", "An unexpected error occurred.", requestId);
  }
}

async function handleCollection(request, deps, requestId, nowMs, url) {
  if (request.method === "GET") {
    const limit = parseLimit(url.searchParams.get("limit"), DEFAULT_SOCIAL_PAGE_SIZE, MAX_SOCIAL_PAGE_SIZE);
    if (limit === null) return failure(400, "invalid_query", `limit must be 1-${MAX_SOCIAL_PAGE_SIZE}.`, requestId);
    return json(200, { posts: await deps.store.list(limit) }, requestId, { "cache-control": "no-store" });
  }
  if (request.method !== "POST") return methodNotAllowed(request.method, "GET, POST", requestId);

  const auth = await authorizeWrite(request, deps, requestId, nowMs);
  if (auth.response) return auth.response;
  const { identity, headers } = auth;

  const parsed = await parseBody(request, requestId);
  if (parsed.response) return parsed.response;
  const { values, errors } = validateSocialPostInput(parsed.body, { requireProvenance: !identity.human });
  if (Object.keys(errors).length) return failure(422, "invalid_social_post", "The social post failed validation.", requestId, { fields: errors }, headers);
  if (!identity.human && values.author !== identity.author) return failure(403, "author_mismatch", "author must match the authenticated agent.", requestId, {}, headers);

  const createdAt = new Date(nowMs).toISOString();
  // Human provenance and ordering are server-owned; only the demo display
  // name is self-asserted. Any client-sent timestamp/source is ignored here.
  if (identity.human) {
    values.timestamp = createdAt;
    values.source = "shiplog-web";
  }

  // `image` is validated input, never a column: the row references the media
  // object this request is about to create, exactly as the two-step path does.
  const { image, ...postValues } = values;
  let ingested = null;
  if (image) {
    const stored = await storeInlineImage(parsed.body.image, deps, identity.id, createdAt, requestId, headers);
    if (stored.response) return stored.response;
    ingested = stored.object;
    postValues.media_id = ingested.id;
  }

  let post;
  try {
    post = await deps.store.create({ id: uuid(), ...postValues, principal_id: identity.id, created_at: createdAt });
  } catch (error) {
    // The image committed and the post did not, so the image is garbage that
    // only this request knows about. Undo it before the 500 leaves.
    await discardImage(deps, ingested, identity.id, requestId);
    throw error;
  }
  if (!post) {
    if (ingested) {
      // The guarded insert's image condition cannot be what failed: this image
      // was created moments ago, by this principal, and no post has seen its
      // id. Something else refused the row, so report it as ours and roll back.
      console.error("social_post_inline_image_rollback", { requestId, mediaId: ingested.id });
      await discardImage(deps, ingested, identity.id, requestId);
      return failure(500, "internal", "The post could not be created.", requestId, {}, headers);
    }
    // A null on the media_id path means only one thing: the guarded insert's
    // image condition failed. Classify it with a follow-up read so the caller
    // learns whether the image is missing, someone else's, or already claimed.
    return mediaAttachFailure(deps, postValues.media_id, identity.id, requestId, headers);
  }
  return json(201, { post }, requestId, { ...headers, location: `/api/social-posts/${post.id}`, "cache-control": "no-store" });
}

// Inline bytes take the same ingest as an upload -- bytes first, metadata row
// as the commit point -- so both entry points share one storage contract and
// one set of failure modes.
async function storeInlineImage(input, deps, principalId, now, requestId, headers) {
  // A deployment wired without the image stores can still serve text posts.
  // Say so, rather than letting the missing store surface as a 500.
  if (!deps.media || !deps.blobs) {
    console.error("social_post_image_stores_missing", { requestId });
    return { response: failure(503, "storage_unavailable", "Image posting is not configured.", requestId, {}, headers) };
  }
  try {
    return { object: await ingestMediaUpload(input, { media: deps.media, blobs: deps.blobs, principalId, id: uuid(), now }) };
  } catch (error) {
    // Already validated above; reaching here means the two validators disagree,
    // which is a defect worth surfacing as the same 422 rather than a 500.
    if (error instanceof MediaValidationError) {
      return { response: failure(422, "invalid_media", error.message, requestId, { fields: error.fields }, headers) };
    }
    if (error instanceof MediaStorageError) {
      // The cause names the binding that failed and never reaches the client.
      console.error("social_media_storage_failure", { requestId, error: error.cause?.message ?? String(error.cause) });
      return { response: failure(503, "storage_unavailable", "The image could not be stored. Retry the post.", requestId, {}, headers) };
    }
    throw error;
  }
}

// Undo an inline image whose post never landed. Best effort and always logged:
// the caller is already getting an error, and a reclaim failure costs storage
// rather than correctness -- but a leak nothing reports is the one found later.
async function discardImage(deps, object, principalId, requestId) {
  if (!object) return;
  let removed = null;
  try {
    removed = await deps.media.deleteOwned(object.id, principalId);
  } catch (error) {
    console.error("social_media_orphaned_object", { requestId, mediaId: object.id, error: error?.message ?? String(error) });
  }
  // Bytes are reclaimed only once the row that pointed at them is gone. If the
  // row survived, the image is still reachable and still the owner's to delete;
  // deleting its bytes anyway would turn a leak into a broken image.
  if (removed) await reclaimBlob(deps, object.storage_key, requestId);
  else console.error("social_media_orphaned_object", { requestId, mediaId: object.id, storageKey: object.storage_key });
}

async function mediaAttachFailure(deps, mediaId, principalId, requestId, headers) {
  const object = deps.media ? await deps.media.get(mediaId) : null;
  if (!object) return failure(422, "invalid_media", "media_id does not reference an uploaded image.", requestId, { fields: { media_id: "unknown image" } }, headers);
  if (object.principal_id !== principalId) return failure(403, "media_not_owned", "media_id was uploaded by a different principal.", requestId, {}, headers);
  return failure(409, "media_already_attached", "That image is already attached to a post.", requestId, {}, headers);
}

async function handlePost(request, deps, requestId, nowMs, postId) {
  if (request.method === "GET") {
    const post = await deps.store.get(postId);
    return post ? json(200, { post }, requestId, { "cache-control": "no-store" }) : failure(404, "not_found", "Social post not found.", requestId);
  }
  if (request.method !== "PATCH" && request.method !== "DELETE") return methodNotAllowed(request.method, "GET, PATCH, DELETE", requestId);

  const auth = await authorizeWrite(request, deps, requestId, nowMs);
  if (auth.response) return auth.response;

  if (request.method === "DELETE") {
    const removed = await deps.store.deleteOwned(postId, auth.identity.id);
    // Ownership is not disclosed: a non-owner and a stranger both get 404, so
    // the endpoint cannot be used to probe who wrote what.
    if (!removed) return failure(404, "not_found", "Social post not found.", requestId, {}, auth.headers);
    await reclaimBlob(deps, removed.storage_key, requestId);
    return new Response(null, { status: 204, headers: { "x-request-id": requestId, ...auth.headers } });
  }

  const parsed = await parseBody(request, requestId);
  if (parsed.response) return parsed.response;
  const existing = await deps.store.get(postId);
  if (!existing) return failure(404, "not_found", "Social post not found.", requestId, {}, auth.headers);
  const { values, errors } = validateSocialPostPatch(parsed.body, { hasMedia: Boolean(existing.image_url) });
  if (Object.keys(errors).length) return failure(422, "invalid_social_post", "The social post failed validation.", requestId, { fields: errors }, auth.headers);
  const post = await deps.store.updateOwned(postId, auth.identity.id, values);
  if (!post) return failure(404, "not_found", "Social post not found.", requestId, {}, auth.headers);
  return json(200, { post }, requestId, { ...auth.headers, "cache-control": "no-store" });
}

// Best effort by design: the metadata row is already gone, so the bytes are
// unreachable garbage. Losing the reclaim costs storage, never correctness --
// but it is always logged, because a silent leak is the failure you find later.
async function reclaimBlob(deps, storageKey, requestId) {
  if (!storageKey || !deps.blobs) return;
  try {
    await deps.blobs.delete(storageKey);
  } catch (error) {
    console.error("social_media_orphaned_blob", { requestId, storageKey, error: error?.message ?? String(error) });
  }
}

async function handleLikes(request, deps, requestId, nowMs, postId) {
  if (request.method !== "PUT" && request.method !== "DELETE") return methodNotAllowed(request.method, "PUT, DELETE", requestId);
  const auth = await authorizeWrite(request, deps, requestId, nowMs);
  if (auth.response) return auth.response;

  // PUT and DELETE are both idempotent: the state after the call is asserted,
  // not incremented, so a client retrying on a dropped response cannot double
  // count.
  const result = request.method === "PUT"
    ? await deps.likes.like(postId, auth.identity.id, new Date(nowMs).toISOString())
    : await deps.likes.unlike(postId, auth.identity.id);
  if (!result) return failure(404, "not_found", "Social post not found.", requestId, {}, auth.headers);
  return json(200, { post_id: postId, ...result }, requestId, { ...auth.headers, "cache-control": "no-store" });
}

async function handleComments(request, deps, requestId, nowMs, url, postId, commentId) {
  if (commentId) {
    if (request.method !== "DELETE") return methodNotAllowed(request.method, "DELETE", requestId);
    const auth = await authorizeWrite(request, deps, requestId, nowMs);
    if (auth.response) return auth.response;
    const removed = await deps.comments.deleteOwned(commentId, postId, auth.identity.id);
    if (!removed) return failure(404, "not_found", "Comment not found.", requestId, {}, auth.headers);
    return new Response(null, { status: 204, headers: { "x-request-id": requestId, ...auth.headers } });
  }

  if (request.method === "GET") {
    const limit = parseLimit(url.searchParams.get("limit"), DEFAULT_COMMENT_PAGE_SIZE, MAX_COMMENT_PAGE_SIZE);
    if (limit === null) return failure(400, "invalid_query", `limit must be 1-${MAX_COMMENT_PAGE_SIZE}.`, requestId);
    if (!await deps.store.get(postId)) return failure(404, "not_found", "Social post not found.", requestId);
    return json(200, { post_id: postId, comments: await deps.comments.list(postId, limit) }, requestId, { "cache-control": "no-store" });
  }
  if (request.method !== "POST") return methodNotAllowed(request.method, "GET, POST", requestId);

  const auth = await authorizeWrite(request, deps, requestId, nowMs);
  if (auth.response) return auth.response;
  const parsed = await parseBody(request, requestId);
  if (parsed.response) return parsed.response;
  const { values, errors } = validateCommentInput(parsed.body);
  if (Object.keys(errors).length) return failure(422, "invalid_comment", "The comment failed validation.", requestId, { fields: errors }, auth.headers);
  if (!auth.identity.human && values.author !== auth.identity.author) return failure(403, "author_mismatch", "author must match the authenticated agent.", requestId, {}, auth.headers);

  const comment = await deps.comments.create({
    id: uuid(), post_id: postId, author: values.author, content: values.content,
    principal_id: auth.identity.id, created_at: new Date(nowMs).toISOString(),
  });
  if (!comment) return failure(404, "not_found", "Social post not found.", requestId, {}, auth.headers);
  return json(201, { comment }, requestId, { ...auth.headers, location: `/api/social-posts/${postId}/comments/${comment.id}`, "cache-control": "no-store" });
}

/* ----------------------------- media endpoints --------------------------- */

const MEDIA_ROUTE = /^\/api\/social-media(?:\/([^/]+))?(?:\/(content))?\/?$/;

export async function handleSocialMediaRequest(request, deps) {
  const requestId = deps.requestId ?? uuid();
  try {
    const match = MEDIA_ROUTE.exec(new URL(request.url).pathname);
    if (!match) return failure(404, "not_found", "Unknown social media route.", requestId);
    let [, mediaId, content] = match;
    try { mediaId = mediaId ? decodeURIComponent(mediaId) : null; }
    catch { return failure(400, "invalid_id", "Image id must be a UUID.", requestId); }
    if (mediaId && !UUID.test(mediaId)) return failure(400, "invalid_id", "Image id must be a UUID.", requestId);

    const nowMs = deps.nowMs?.() ?? Date.now();
    if (!mediaId) return await handleMediaUpload(request, deps, requestId, nowMs);
    if (content) return await handleMediaContent(request, deps, requestId, mediaId);

    if (request.method === "GET") {
      const object = await deps.media.get(mediaId);
      return object ? json(200, { media: publicMedia(object) }, requestId) : failure(404, "not_found", "Image not found.", requestId);
    }
    if (request.method !== "DELETE") return methodNotAllowed(request.method, "GET, DELETE", requestId);

    const auth = await authorizeWrite(request, deps, requestId, nowMs);
    if (auth.response) return auth.response;
    const removed = await deps.media.deleteOwned(mediaId, auth.identity.id);
    // deleteOwned refuses to detach an image from a live post, so an existing
    // image that will not delete is attached, not missing.
    if (!removed) {
      const object = await deps.media.get(mediaId);
      if (object && object.principal_id === auth.identity.id) {
        return failure(409, "media_attached", "Delete the post that carries this image instead.", requestId, {}, auth.headers);
      }
      return failure(404, "not_found", "Image not found.", requestId, {}, auth.headers);
    }
    await reclaimBlob(deps, removed.storage_key, requestId);
    return new Response(null, { status: 204, headers: { "x-request-id": requestId, ...auth.headers } });
  } catch (error) {
    console.error("social_media_api_failure", { requestId, error: error?.message ?? String(error) });
    return failure(500, "internal", "An unexpected error occurred.", requestId);
  }
}

async function handleMediaUpload(request, deps, requestId, nowMs) {
  if (request.method !== "POST") return methodNotAllowed(request.method, "POST", requestId);
  const auth = await authorizeWrite(request, deps, requestId, nowMs);
  if (auth.response) return auth.response;
  const parsed = await parseBody(request, requestId);
  if (parsed.response) return parsed.response;

  try {
    const object = await ingestMediaUpload(parsed.body, {
      media: deps.media, blobs: deps.blobs, principalId: auth.identity.id,
      id: uuid(), now: new Date(nowMs).toISOString(),
    });
    const media = publicMedia(object);
    return json(201, { media }, requestId, { ...auth.headers, location: media.url, "cache-control": "no-store" });
  } catch (error) {
    if (error instanceof MediaValidationError) return failure(422, "invalid_media", error.message, requestId, { fields: error.fields }, auth.headers);
    if (error instanceof MediaStorageError) {
      // The cause names the binding that failed and never reaches the client.
      console.error("social_media_storage_failure", { requestId, error: error.cause?.message ?? String(error.cause) });
      return failure(503, "storage_unavailable", "The image could not be stored. Retry the upload.", requestId, {}, auth.headers);
    }
    throw error;
  }
}

// Public byte read. The response is locked down independently of the site's
// _headers so that a stored payload can never be interpreted as a document:
// the content type comes from the allowlisted column (never from the request),
// nosniff blocks type inference, and the sandboxed CSP neutralizes anything
// that still manages to be parsed as active content.
async function handleMediaContent(request, deps, requestId, mediaId) {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(request.method, "GET, HEAD", requestId);
  const object = await deps.media.get(mediaId);
  if (!object) return failure(404, "not_found", "Image not found.", requestId);

  const etag = `"${object.checksum_sha256}"`;
  const headers = {
    "content-type": object.content_type,
    "content-length": String(object.byte_size),
    etag,
    // Content is addressed by an immutable id whose bytes never change, so this
    // is safe to cache forever; a replacement gets a new id.
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "content-disposition": "inline",
    "x-request-id": requestId,
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

  const blob = await deps.blobs.get(object.storage_key);
  if (!blob) {
    // Metadata without bytes: a real, reportable storage inconsistency rather
    // than an ordinary miss, so it is logged loudly and answered 503.
    console.error("social_media_missing_blob", { requestId, mediaId, storageKey: object.storage_key });
    return failure(503, "storage_unavailable", "The image bytes are temporarily unavailable.", requestId);
  }
  return new Response(request.method === "HEAD" ? null : blob.bytes, { status: 200, headers });
}

/* ------------------------------- composition ----------------------------- */

// One call sites the whole D1-backed object graph, so an edge adapter cannot
// wire three of the four stores and silently lose a capability.
export function createD1SocialStores(db, { bucket = null } = {}) {
  return {
    posts: createD1SocialPostStore(db),
    likes: createD1LikeStore(db),
    comments: createD1CommentStore(db),
    media: createD1MediaStore(db),
    // R2 when operations bind a bucket, inline D1 blobs otherwise. Both use the
    // same key space, so the choice is a deployment detail and not a contract.
    blobs: bucket ? createR2BlobStore(bucket) : createD1BlobStore(db),
  };
}
