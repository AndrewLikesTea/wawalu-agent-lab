// Shared durable image storage: POST /api/images, GET /api/images/{id}.
//
// This endpoint deliberately adds no storage mechanism. It reuses the pieces
// the social feed already proved out in src/social-media.js -- the signature
// verified type allowlist, the SHA-256 checksum, the R2/D1 blob stores, the
// derived key space, and the bytes-then-metadata commit -- and adds exactly two
// things the social path could not provide:
//
//   1. A *namespace*, so several teams can share one bucket, one inline blob
//      table, and one metadata table without colliding or reading each other's
//      objects. Reads are namespace-scoped, so a guessed id from another
//      namespace is a 404, not a leak.
//   2. A *per-namespace size policy*, so this surface can accept 5 MB without
//      raising the social feed's 512 KB cap or unbounding the inline D1 blob
//      fallback.
//
// What it is not: a general object store. Only the four raster image types the
// allowlist verifies by magic bytes are accepted, for the same reason as the
// social path -- an SVG or an HTML document parked under an image/* label is an
// active document in durable storage, which PRODUCT.md forbids.
//
// Data boundary (PRODUCT.md): the only state this module touches is this
// project's own D1 database and media bucket. It reads no Wawalu database,
// cookie, credential, or internal API, and the one identity value it persists
// is the opaque principal id the caller's own bearer token already carries.
// Nothing secret is ever written to a response body or a log line.

import {
  MEDIA_CONTENT_TYPES,
  MediaStorageError,
  MAX_MEDIA_BYTES,
  commitMedia,
  isWellFormedImage,
  sha256Hex,
  storageKeyFor,
} from "./social-media.js";

export const IMAGES_ROUTE_PREFIX = "/api/images";
export const IMAGE_NAMESPACE = "images";
export const IMAGE_WRITE_SCOPE = "images:write";

// The ceiling this endpoint advertises, and the one the media_objects CHECK
// enforces.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// The ceiling when no object store is bound. Bytes then fall back to the inline
// social_media_blobs table in D1, and a 5 MB row there is not a degraded
// deployment, it is a broken one -- D1 is not a blob store at that size. So the
// fallback keeps the bound the social feed already validated rather than
// pretending capacity it does not have. Callers are told which limit applied.
export const INLINE_MAX_IMAGE_BYTES = MAX_MEDIA_BYTES;
export const MAX_IMAGE_ALT_LENGTH = 300;

// A multipart envelope costs boundary lines and part headers on top of the file
// itself. The early content-length check exists only to refuse an obviously
// oversized body before buffering it, so it is generous; the authoritative
// check runs on the decoded bytes.
const MULTIPART_OVERHEAD_ALLOWANCE = 8 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGES_ROUTE = /^\/api\/images(?:\/([^/]+))?(?:\/(content))?\/?$/;
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

export function imageUrl(id) {
  return `${IMAGES_ROUTE_PREFIX}/${id}/content`;
}

// The effective cap for a deployment. Derived from the bound blob store rather
// than from configuration, so the limit cannot claim capacity the storage
// actually bound does not have.
export function effectiveMaxBytes(blobs) {
  return blobs?.kind === "d1" ? INLINE_MAX_IMAGE_BYTES : MAX_IMAGE_BYTES;
}

/* ----------------------------- read projection --------------------------- */

// The single place a stored row becomes a public image. `principal_id` and
// `storage_key` are absent by construction: the first would let anyone inventory
// who uploaded what, and the second would turn an opaque internal key into a
// client-held contract that operations could never change.
export function publicImage(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    namespace: row.namespace,
    url: imageUrl(row.id),
    alt: row.alt_text ?? null,
    content_type: row.content_type,
    byte_size: Number(row.byte_size),
    checksum_sha256: row.checksum_sha256,
    created_at: row.created_at,
  });
}

/* -------------------------------- validation ----------------------------- */

// Returns `oversize` separately from `errors` because the two map to different
// status codes: a file over the limit is a 413 the caller fixes by sending less,
// a malformed or non-image payload is a 422 they fix by sending something else.
export function validateImageUpload(input, { maxBytes = MAX_IMAGE_BYTES } = {}) {
  const errors = {};
  const values = {};
  let oversize = false;

  const declared = typeof input?.content_type === "string" ? input.content_type.trim().split(";")[0].trim().toLowerCase() : "";
  if (!MEDIA_CONTENT_TYPES.includes(declared)) {
    errors.content_type = `content_type must be one of ${MEDIA_CONTENT_TYPES.join(", ")}`;
  } else {
    values.content_type = declared;
  }

  // Required here, nullable in storage. See migrations/0005_media_objects.sql.
  if (typeof input?.alt !== "string") errors.alt = "alt must be a string";
  else if (!input.alt.trim()) errors.alt = "alt is required so the image is described to every reader";
  else if (input.alt.trim().length > MAX_IMAGE_ALT_LENGTH) errors.alt = `alt must be at most ${MAX_IMAGE_ALT_LENGTH} characters`;
  else values.alt = input.alt.trim();

  const bytes = input?.bytes;
  if (!(bytes instanceof Uint8Array)) {
    errors.file = "file must be a single uploaded image part";
  } else if (bytes.byteLength === 0) {
    errors.file = "file must not be empty";
  } else if (bytes.byteLength > maxBytes) {
    oversize = true;
  } else if (values.content_type && !isWellFormedImage(bytes, values.content_type)) {
    // The declared type is caller controlled; the magic bytes are not. This is
    // the check that keeps a renamed HTML document out of durable storage.
    errors.file = `file does not contain a well-formed ${values.content_type} image`;
  } else {
    values.bytes = bytes;
  }

  return { values, errors, oversize };
}

/* ------------------------------ metadata stores -------------------------- */

// Every read and write is namespace-scoped in the store itself rather than in
// the handler. A future namespace therefore gets isolation by constructing a
// store, and cannot lose it by forgetting a filter at a call site.
export function createMemoryImageStore({ initial = [], namespace = IMAGE_NAMESPACE } = {}) {
  const rows = new Map(initial.map((row) => [row.id, Object.freeze({ ...row })]));
  return {
    namespace,
    async create(row) {
      const stored = Object.freeze({ ...row, namespace });
      rows.set(stored.id, stored);
      return stored;
    },
    async get(id) {
      const row = rows.get(id);
      return row && row.namespace === namespace ? row : null;
    },
    async health() { return true; },
  };
}

export function createD1ImageStore(db, { namespace = IMAGE_NAMESPACE } = {}) {
  return {
    namespace,
    async create(row) {
      return await db.prepare(`INSERT INTO media_objects (id,namespace,storage_key,content_type,byte_size,checksum_sha256,alt_text,principal_id,created_at)
        VALUES (?,?,?,?,?,?,?,?,?) RETURNING *`)
        .bind(row.id, namespace, row.storage_key, row.content_type, row.byte_size, row.checksum_sha256, row.alt_text ?? null, row.principal_id, row.created_at)
        .first();
    },
    async get(id) {
      return await db.prepare("SELECT * FROM media_objects WHERE id = ? AND namespace = ?").bind(id, namespace).first();
    },
    async health() { return Boolean(await db.prepare("SELECT 1 AS healthy").first()); },
  };
}

/* --------------------------------- ingest -------------------------------- */

// Validation and the durable commit, with no HTTP in sight, so the storage
// contract can be tested and reused without constructing a Request.
export async function storeImage(input, { images, blobs, principalId, id, now, maxBytes, log = console }) {
  const { values, errors, oversize } = validateImageUpload(input, { maxBytes });
  if (oversize || Object.keys(errors).length) return { errors, oversize };
  if (!UUID.test(id)) throw new TypeError("Image id must be a UUID.");

  const namespace = images.namespace ?? IMAGE_NAMESPACE;
  const row = {
    id,
    namespace,
    storage_key: storageKeyFor(id, values.content_type, namespace),
    content_type: values.content_type,
    byte_size: values.bytes.byteLength,
    checksum_sha256: await sha256Hex(values.bytes),
    alt_text: values.alt,
    principal_id: principalId,
    created_at: now,
  };

  return { image: await commitMedia({ media: images, blobs, row, bytes: values.bytes, now, log }) };
}

/* -------------------------------- plumbing ------------------------------- */

// Bearer tokens only, unlike /api/social-posts. A shared multi-team store hands
// out durable capacity, so every write is attributable to a named, individually
// revocable principal; there is no anonymous browser path to authenticate.
export async function resolveImagePrincipal(request, deps, requestId) {
  const identity = await deps.authenticate?.(request);
  const id = typeof identity?.id === "string" ? identity.id.trim() : "";
  const scopes = Array.isArray(identity?.scopes) ? identity.scopes : [];
  if (!id) return { response: failure(401, "unauthenticated", "A valid bearer token is required.", requestId) };
  if (!scopes.includes(IMAGE_WRITE_SCOPE)) {
    return { response: failure(403, "insufficient_scope", `The ${IMAGE_WRITE_SCOPE} scope is required.`, requestId) };
  }
  return { identity: { id, scopes } };
}

function rateHeadersFor(rate) {
  return { "ratelimit-limit": String(rate.limit), "ratelimit-remaining": String(rate.remaining), "ratelimit-reset": String(Math.ceil(rate.resetAt / 1000)) };
}

async function authorizeUpload(request, deps, requestId, nowMs) {
  const principal = await resolveImagePrincipal(request, deps, requestId);
  if (principal.response) return principal;
  if (!deps.rateLimit) return { identity: principal.identity, headers: {} };
  // Keyed under an `images:` prefix so this budget is its own: an upload cannot
  // consume a principal's social post allowance, and vice versa.
  const rate = await deps.rateLimit(`images:${principal.identity.id}`, nowMs);
  const headers = rateHeadersFor(rate);
  if (!rate.allowed) {
    return { response: failure(429, "rate_limited", "Too many image uploads. Try again after the current window.", requestId, {}, { ...headers, "retry-after": String(Math.max(1, Math.ceil((rate.resetAt - nowMs) / 1000))) }) };
  }
  return { identity: principal.identity, headers };
}

// multipart/form-data, not base64 JSON as on /api/social-media. At this size the
// difference is material: base64 would inflate a 5 MB file to ~6.8 MB on the
// wire and again in the isolate's heap, and "upload a file" is what multipart
// already means to every HTTP client.
async function parseUpload(request, maxBytes, requestId) {
  if (!/^multipart\/form-data\s*;/i.test(request.headers.get("content-type") ?? "")) {
    return { response: failure(415, "unsupported_media_type", "Content-Type must be multipart/form-data with a `file` part.", requestId) };
  }

  // Refuse an obviously oversized body before buffering it, so a caller cannot
  // spend the isolate's memory just to earn a 413.
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes + MULTIPART_OVERHEAD_ALLOWANCE) {
    return { response: tooLarge(maxBytes, requestId) };
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return { response: failure(400, "invalid_body", "The multipart body could not be parsed.", requestId) };
  }

  const file = form.get("file");
  if (typeof file !== "object" || file === null || typeof file.arrayBuffer !== "function") {
    return { input: { bytes: null, content_type: form.get("content_type"), alt: form.get("alt") } };
  }

  return {
    input: {
      bytes: new Uint8Array(await file.arrayBuffer()),
      // An explicit `content_type` part wins over the browser-declared part
      // type, so a client that knows better than its own form encoding can say
      // so. Neither is trusted: the magic bytes decide.
      content_type: typeof form.get("content_type") === "string" ? form.get("content_type") : (file.type ?? ""),
      alt: form.get("alt"),
    },
  };
}

function tooLarge(maxBytes, requestId, headers = {}) {
  const capped = maxBytes < MAX_IMAGE_BYTES;
  return failure(413, "payload_too_large", `The image must be at most ${maxBytes} bytes.`, requestId, {
    max_bytes: maxBytes,
    // Say *why* the limit is below the advertised one. Otherwise a deployment
    // without an object store looks like the API lying about its own ceiling.
    ...(capped ? { reason: "No object store is bound, so uploads fall back to bounded inline storage." } : {}),
  }, headers);
}

/* --------------------------------- router -------------------------------- */

export async function handleImagesRequest(request, deps) {
  const requestId = deps.requestId ?? uuid();
  try {
    const match = IMAGES_ROUTE.exec(new URL(request.url).pathname);
    if (!match) return failure(404, "not_found", "Unknown images route.", requestId);

    let [, imageId, content] = match;
    try { imageId = imageId ? decodeURIComponent(imageId) : null; }
    catch { return failure(400, "invalid_id", "Image id must be a UUID.", requestId); }
    if (imageId && !UUID.test(imageId)) return failure(400, "invalid_id", "Image id must be a UUID.", requestId);

    const nowMs = deps.nowMs?.() ?? Date.now();
    // Awaited rather than returned: an un-awaited promise would settle outside
    // this try, and a storage rejection would escape as an unhandled edge
    // exception instead of a correlated 500.
    if (!imageId) return await handleUpload(request, deps, requestId, nowMs);
    if (content) return await handleContent(request, deps, requestId, imageId);
    return await handleMetadata(request, deps, requestId, imageId);
  } catch (error) {
    console.error("images_api_failure", { requestId, error: error?.message ?? String(error) });
    return failure(500, "internal", "An unexpected error occurred.", requestId);
  }
}

async function handleUpload(request, deps, requestId, nowMs) {
  if (request.method !== "POST") return methodNotAllowed(request.method, "POST", requestId);

  const auth = await authorizeUpload(request, deps, requestId, nowMs);
  if (auth.response) return auth.response;

  const maxBytes = deps.maxBytes ?? effectiveMaxBytes(deps.blobs);
  const parsed = await parseUpload(request, maxBytes, requestId);
  if (parsed.response) return parsed.response;

  let result;
  try {
    result = await storeImage(parsed.input, {
      images: deps.images, blobs: deps.blobs, principalId: auth.identity.id,
      id: uuid(), now: new Date(nowMs).toISOString(), maxBytes,
    });
  } catch (error) {
    if (error instanceof MediaStorageError) {
      // The cause names the binding that failed and never reaches the client.
      console.error("images_storage_failure", { requestId, error: error.cause?.message ?? String(error.cause) });
      return failure(503, "storage_unavailable", "The image could not be stored. Retry the upload.", requestId, {}, auth.headers);
    }
    throw error;
  }

  if (result.oversize) return tooLarge(maxBytes, requestId, auth.headers);
  if (result.errors && Object.keys(result.errors).length) {
    return failure(422, "invalid_image", "The image failed validation.", requestId, { fields: result.errors }, auth.headers);
  }

  const image = publicImage(result.image);
  return json(201, { image }, requestId, { ...auth.headers, location: `${IMAGES_ROUTE_PREFIX}/${image.id}`, "cache-control": "no-store" });
}

// Reads are unauthenticated and namespace-scoped. An id from another namespace
// is indistinguishable from one that never existed, which is what keeps the
// shared table from becoming a cross-team read channel.
async function handleMetadata(request, deps, requestId, imageId) {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(request.method, "GET, HEAD", requestId);
  const row = await deps.images.get(imageId);
  if (!row) return failure(404, "not_found", "Image not found.", requestId);
  const response = json(200, { image: publicImage(row) }, requestId, { "cache-control": "no-store" });
  return request.method === "HEAD" ? new Response(null, { status: 200, headers: response.headers }) : response;
}

// Public byte read, locked down independently of the site's _headers so a
// stored payload can never be interpreted as a document: the content type comes
// from the allowlisted column and never from the request, nosniff blocks type
// inference, and the sandboxed CSP neutralizes anything that still manages to
// be parsed as active content.
async function handleContent(request, deps, requestId, imageId) {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(request.method, "GET, HEAD", requestId);
  const row = await deps.images.get(imageId);
  if (!row) return failure(404, "not_found", "Image not found.", requestId);

  const etag = `"${row.checksum_sha256}"`;
  const headers = {
    "content-type": row.content_type,
    "content-length": String(row.byte_size),
    etag,
    // Addressed by an immutable id whose bytes never change, so this is safe to
    // cache forever; a replacement gets a new id.
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "content-disposition": "inline",
    "x-request-id": requestId,
  };
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

  const blob = await deps.blobs.get(row.storage_key);
  if (!blob) {
    // Metadata without bytes is a real, reportable storage inconsistency rather
    // than an ordinary miss, so it is logged loudly and answered 503.
    console.error("images_missing_blob", { requestId, imageId, storageKey: row.storage_key });
    return failure(503, "storage_unavailable", "The image bytes are temporarily unavailable.", requestId);
  }
  return new Response(request.method === "HEAD" ? null : blob.bytes, { status: 200, headers });
}
