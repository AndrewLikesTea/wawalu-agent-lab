// Image objects for the unified social post model.
//
// An upload is two durable writes: the bytes into a blob store, then a metadata
// row. The row is the commit point, and it is written last, so the only failure
// mode is an orphaned blob (garbage, reapable, logged) rather than a post
// pointing at bytes that were never stored. Storage keys are derived from the
// media id, so a retried upload overwrites its own key instead of accumulating.
//
// Posts reference the media *row*, never a blob key or a URL. That is what lets
// operations move bytes from D1 to R2 without touching a single post row.

export const MAX_MEDIA_BYTES = 512 * 1024;
export const MAX_MEDIA_ALT_LENGTH = 300;
export const MAX_MEDIA_DIMENSION = 20000;
export const MEDIA_ROUTE_PREFIX = "/api/social-media";

// Declared content types are caller-controlled, so each allowlisted type also
// carries the leading bytes a real file of that type must start with. A payload
// that does not match its declaration is rejected at ingest: storing, say, an
// SVG or an HTML document under an image/* label would park an active document
// in durable storage, and PRODUCT.md forbids user-generated HTML execution.
// SVG is absent from the allowlist for the same reason -- it is a script host.
const MEDIA_TYPES = Object.freeze({
  "image/png": { extension: "png", signature: [[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]] },
  "image/jpeg": { extension: "jpg", signature: [[0, [0xff, 0xd8, 0xff]]] },
  "image/gif": { extension: "gif", signature: [[0, [0x47, 0x49, 0x46, 0x38]]] },
  "image/webp": { extension: "webp", signature: [[0, [0x52, 0x49, 0x46, 0x46]], [8, [0x57, 0x45, 0x42, 0x50]]] },
});

export const MEDIA_CONTENT_TYPES = Object.freeze(Object.keys(MEDIA_TYPES));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
// 4 base64 characters per 3 bytes; refuse oversized payloads before decoding
// them so a caller cannot spend the isolate's memory to earn a 422.
const MAX_ENCODED_LENGTH = Math.ceil(MAX_MEDIA_BYTES / 3) * 4 + 4;

export class MediaValidationError extends Error {
  constructor(fields) {
    super("The image failed validation.");
    this.name = "MediaValidationError";
    this.fields = fields;
  }
}

export class MediaStorageError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "MediaStorageError";
    this.cause = cause;
  }
}

export function mediaUrl(id) {
  return `${MEDIA_ROUTE_PREFIX}/${id}/content`;
}

// Keyed by media id, so the key is derived (never parsed) and a retry of the
// same upload is idempotent at the blob layer.
export function storageKeyFor(id, contentType) {
  return `social-media/${id}.${MEDIA_TYPES[contentType].extension}`;
}

export function decodeBase64(value) {
  const compact = value.replace(/\s+/g, "");
  if (!compact || compact.length % 4 !== 0 || !BASE64.test(compact)) return null;
  let binary;
  try {
    binary = atob(compact);
  } catch {
    return null;
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function matchesDeclaredType(bytes, contentType) {
  const type = MEDIA_TYPES[contentType];
  if (!type) return false;
  return type.signature.every(([offset, expected]) =>
    expected.every((byte, index) => bytes[offset + index] === byte));
}

function positiveInteger(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 && number <= MAX_MEDIA_DIMENSION ? number : null;
}

export function validateMediaUpload(input) {
  const errors = {};
  const values = {};

  if (typeof input?.content_type !== "string" || !MEDIA_TYPES[input.content_type.trim()]) {
    errors.content_type = `content_type must be one of ${MEDIA_CONTENT_TYPES.join(", ")}`;
  } else {
    values.content_type = input.content_type.trim();
  }

  if (typeof input?.alt !== "string") errors.alt = "alt must be a string";
  else if (!input.alt.trim()) errors.alt = "alt is required so the image is described to every reader";
  else if (input.alt.trim().length > MAX_MEDIA_ALT_LENGTH) errors.alt = `alt must be at most ${MAX_MEDIA_ALT_LENGTH} characters`;
  else values.alt = input.alt.trim();

  if (typeof input?.data !== "string" || !input.data.trim()) {
    errors.data = "data must be a base64-encoded image";
  } else if (input.data.length > MAX_ENCODED_LENGTH) {
    errors.data = `data must decode to at most ${MAX_MEDIA_BYTES} bytes`;
  } else {
    const bytes = decodeBase64(input.data);
    if (!bytes) errors.data = "data must be valid base64";
    else if (bytes.byteLength === 0) errors.data = "data must not be empty";
    else if (bytes.byteLength > MAX_MEDIA_BYTES) errors.data = `data must decode to at most ${MAX_MEDIA_BYTES} bytes`;
    else if (values.content_type && !matchesDeclaredType(bytes, values.content_type)) {
      errors.data = `data does not contain a ${values.content_type} image`;
    } else values.bytes = bytes;
  }

  // Dimensions are optional, but a half-supplied pair reserves nothing and is
  // almost always a client bug worth surfacing rather than silently dropping.
  const hasWidth = input?.width !== undefined && input?.width !== null;
  const hasHeight = input?.height !== undefined && input?.height !== null;
  if (hasWidth || hasHeight) {
    const width = positiveInteger(input.width);
    const height = positiveInteger(input.height);
    if (!width || !height) {
      errors.dimensions = `width and height must both be integers between 1 and ${MAX_MEDIA_DIMENSION}, or both omitted`;
    } else {
      values.width = width;
      values.height = height;
    }
  }

  return { values, errors };
}

export async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("A SHA-256 implementation is unavailable.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function publicMedia(row) {
  if (!row) return null;
  return Object.freeze({
    id: row.id,
    url: mediaUrl(row.id),
    alt: row.alt_text,
    content_type: row.content_type,
    byte_size: Number(row.byte_size),
    width: row.width ?? null,
    height: row.height ?? null,
    checksum_sha256: row.checksum_sha256,
    created_at: row.created_at,
  });
}

/* ----------------------------- blob stores ------------------------------ */

export function createMemoryBlobStore() {
  const blobs = new Map();
  return {
    kind: "memory",
    async put(key, bytes, contentType) { blobs.set(key, { bytes: new Uint8Array(bytes), contentType }); },
    async get(key) { return blobs.get(key) ?? null; },
    async delete(key) { blobs.delete(key); },
  };
}

// Inline bytes in D1. Bounded by MAX_MEDIA_BYTES, which is why this is a viable
// default rather than a placeholder: the cap is enforced twice, in
// validateMediaUpload and again by the column CHECK on social_media_objects.
export function createD1BlobStore(db) {
  return {
    kind: "d1",
    async put(key, bytes, contentType, now) {
      await db.prepare("INSERT INTO social_media_blobs (storage_key,content_type,bytes,created_at) VALUES (?,?,?,?) ON CONFLICT(storage_key) DO UPDATE SET content_type=excluded.content_type, bytes=excluded.bytes")
        .bind(key, contentType, bytes, now ?? new Date().toISOString()).run();
    },
    async get(key) {
      const row = await db.prepare("SELECT content_type, bytes FROM social_media_blobs WHERE storage_key = ?").bind(key).first();
      return row ? { bytes: new Uint8Array(row.bytes), contentType: row.content_type } : null;
    },
    async delete(key) {
      await db.prepare("DELETE FROM social_media_blobs WHERE storage_key = ?").bind(key).run();
    },
  };
}

// Used when operations bind an R2 bucket. Same key space as the D1 store, so
// switching is a copy of the blob rows, with no post or metadata rewrite.
export function createR2BlobStore(bucket) {
  return {
    kind: "r2",
    async put(key, bytes, contentType) {
      await bucket.put(key, bytes, { httpMetadata: { contentType } });
    },
    async get(key) {
      const object = await bucket.get(key);
      if (!object) return null;
      return { bytes: new Uint8Array(await object.arrayBuffer()), contentType: object.httpMetadata?.contentType ?? "application/octet-stream" };
    },
    async delete(key) { await bucket.delete(key); },
  };
}

/* ---------------------------- metadata stores --------------------------- */

// `isAttached` is injected so this store enforces the same guard the D1
// statement does. Without it the in-memory path would happily delete an image
// out from under a live post -- the drift a permissive fake is meant to catch.
export function createMemoryMediaStore({ initial = [], isAttached = async () => false } = {}) {
  const rows = new Map(initial.map((row) => [row.id, Object.freeze({ ...row })]));
  return {
    async create(row) { rows.set(row.id, Object.freeze({ ...row })); return Object.freeze({ ...row }); },
    async get(id) { return rows.get(id) ?? null; },
    async deleteOwned(id, principalId) {
      const row = rows.get(id);
      if (!row || row.principal_id !== principalId || await isAttached(id)) return null;
      rows.delete(id);
      return row;
    },
    async health() { return true; },
  };
}

export function createD1MediaStore(db) {
  return {
    async create(row) {
      return await db.prepare("INSERT INTO social_media_objects (id,storage_key,content_type,byte_size,checksum_sha256,alt_text,width,height,principal_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING *")
        .bind(row.id, row.storage_key, row.content_type, row.byte_size, row.checksum_sha256, row.alt_text, row.width ?? null, row.height ?? null, row.principal_id, row.created_at)
        .first();
    },
    async get(id) {
      return await db.prepare("SELECT * FROM social_media_objects WHERE id = ?").bind(id).first();
    },
    // Owner-scoped and attachment-guarded in one statement: an image already
    // carried by a post cannot be deleted out from under it, and the guard
    // cannot race the attach because attaching takes the unique index first.
    async deleteOwned(id, principalId) {
      return await db.prepare("DELETE FROM social_media_objects WHERE id = ? AND principal_id = ? AND NOT EXISTS (SELECT 1 FROM social_posts p WHERE p.media_id = ?) RETURNING *")
        .bind(id, principalId, id).first();
    },
    async health() { return Boolean(await db.prepare("SELECT 1 AS healthy").first()); },
  };
}

/* -------------------------------- ingest -------------------------------- */

// The full upload: validate, then bytes, then the metadata row that commits it.
export async function ingestMediaUpload(input, { media, blobs, principalId, id, now, log = console }) {
  const { values, errors } = validateMediaUpload(input);
  if (Object.keys(errors).length) throw new MediaValidationError(errors);
  if (!UUID.test(id)) throw new TypeError("Media id must be a UUID.");

  const storageKey = storageKeyFor(id, values.content_type);
  const row = {
    id,
    storage_key: storageKey,
    content_type: values.content_type,
    byte_size: values.bytes.byteLength,
    checksum_sha256: await sha256Hex(values.bytes),
    alt_text: values.alt,
    width: values.width ?? null,
    height: values.height ?? null,
    principal_id: principalId,
    created_at: now,
  };

  try {
    await blobs.put(storageKey, values.bytes, values.content_type, now);
  } catch (error) {
    throw new MediaStorageError("The image bytes could not be stored.", error);
  }

  try {
    return await media.create(row);
  } catch (error) {
    // The blob is now unreferenced. Try to reclaim it, but never let cleanup
    // failure mask the real error -- and always leave a log line naming the key,
    // because an orphan that nothing reports is an invisible storage leak.
    try {
      await blobs.delete(storageKey);
    } catch (cleanupError) {
      log.error?.("social_media_orphaned_blob", { storageKey, error: cleanupError?.message ?? String(cleanupError) });
    }
    throw new MediaStorageError("The image metadata could not be stored.", error);
  }
}
