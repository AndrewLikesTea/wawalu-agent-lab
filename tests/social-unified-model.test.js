// The unified social post model: images, captions, likes, and comments on one
// record, plus the transactional invariants that keep it consistent.
//
// Every fixture is synthetic. No customer content, credential, or production
// endpoint appears here, and the D1 cases run against an in-memory SQLite with
// the checked-in migrations (see ./support/d1-sqlite.js).

import test from "node:test";
import assert from "node:assert/strict";
import {
  createD1RateLimiter,
  createD1SocialPostStore,
  createD1SocialStores,
  createMemoryRateLimiter,
  createMemorySocialStores,
  handleSocialMediaRequest,
  handleSocialPostsRequest,
  validateSocialPostInput,
  validateSocialPostPatch,
} from "../src/social-posts-api.js";
import {
  MAX_MEDIA_BYTES,
  createD1MediaStore,
  createMemoryBlobStore,
  ingestMediaUpload,
  matchesDeclaredType,
  validateMediaUpload,
} from "../src/social-media.js";
import { createD1LikeStore, validateCommentInput } from "../src/social-engagement.js";
import { createTestD1 } from "./support/d1-sqlite.js";

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_AGENT_ID = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-07-18T12:00:00.000Z");
const AGENT = { id: AGENT_ID, persona: "Priya", scopes: ["social-posts:write"] };
const OTHER_AGENT = { id: OTHER_AGENT_ID, persona: "Kai", scopes: ["social-posts:write"] };

// A real 1x1 PNG: the magic-byte check is only meaningful against actual bytes.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const GIF = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const upload = { content_type: "image/png", data: PNG, alt: "A single grey pixel.", width: 1, height: 1 };

function harness({ limit = 30 } = {}) {
  const stores = createMemorySocialStores();
  const rateLimit = createMemoryRateLimiter({ limit });
  const deps = {
    ...stores,
    store: stores.posts,
    authenticate: async (request) => {
      const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
      if (token === "agent") return AGENT;
      if (token === "other") return OTHER_AGENT;
      return null;
    },
    identifyHuman: async () => ({ id: "human:hashed-principal" }),
    rateLimit,
    nowMs: () => NOW,
    requestId: "request-1",
  };

  async function send(handler, method, path, { body, token = "agent", contentType = "application/json", headers = {} } = {}) {
    const requestHeaders = { ...headers };
    if (token) requestHeaders.authorization = `Bearer ${token}`;
    if (contentType && body !== undefined) requestHeaders["content-type"] = contentType;
    const response = await handler(new Request(`https://test.invalid${path}`, {
      method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body),
    }), deps);
    const text = response.status === 204 || response.status === 304 ? "" : await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
    return { response, status: response.status, json: parsed, text };
  }

  return {
    deps,
    stores,
    posts: (method, path, options) => send(handleSocialPostsRequest, method, path, options),
    media: (method, path, options) => send(handleSocialMediaRequest, method, path, options),
  };
}

async function uploadImage(api, options = {}) {
  const created = await api.media("POST", "/api/social-media", { body: { ...upload, ...options.body }, token: options.token ?? "agent" });
  assert.equal(created.status, 201, created.text);
  return created.json.media;
}

/* ------------------------------ image uploads ---------------------------- */

test("upload validation enforces the allowlist, the size cap, and honest bytes", () => {
  assert.deepEqual(validateMediaUpload({}).errors, {
    content_type: "content_type must be one of image/png, image/jpeg, image/gif, image/webp",
    alt: "alt must be a string",
    data: "data must be a base64-encoded image",
  });

  // SVG is not on the allowlist at all: it is a script host, and PRODUCT.md
  // forbids executing user-generated markup.
  assert.match(validateMediaUpload({ ...upload, content_type: "image/svg+xml" }).errors.content_type, /must be one of/);

  // A declared type the bytes do not support is refused, so a document can
  // never be parked in storage behind an image label.
  assert.match(validateMediaUpload({ ...upload, data: GIF }).errors.data, /does not contain a image\/png image/);
  assert.deepEqual(validateMediaUpload({ ...upload, content_type: "image/gif", data: GIF }).errors, {});

  assert.match(validateMediaUpload({ ...upload, data: "not base64!!" }).errors.data, /valid base64/);
  // Oversized payloads are refused on the encoded length, before any decode.
  assert.match(validateMediaUpload({ ...upload, data: "A".repeat(MAX_MEDIA_BYTES * 2) }).errors.data, /at most 524288 bytes/);
  // Alt text is required: an undescribed image is an accessibility defect.
  assert.match(validateMediaUpload({ ...upload, alt: "   " }).errors.alt, /required/);
  // Dimensions must arrive as a pair or not at all.
  assert.match(validateMediaUpload({ ...upload, height: undefined }).errors.dimensions, /both omitted/);
  assert.deepEqual(validateMediaUpload({ content_type: "image/png", data: PNG, alt: "ok" }).errors, {});

  assert.equal(matchesDeclaredType(new Uint8Array([0x47, 0x49, 0x46, 0x38]), "image/gif"), true);
  assert.equal(matchesDeclaredType(new Uint8Array([0x3c, 0x73, 0x76, 0x67]), "image/png"), false);
});

test("an upload stores bytes, reports a storage reference, and serves them locked down", async () => {
  const api = harness();
  const media = await uploadImage(api);

  assert.match(media.url, /^\/api\/social-media\/[0-9a-f-]{36}\/content$/);
  assert.equal(media.content_type, "image/png");
  assert.equal(media.alt, "A single grey pixel.");
  assert.deepEqual([media.width, media.height], [1, 1]);
  assert.match(media.checksum_sha256, /^[0-9a-f]{64}$/);
  // The public projection carries no storage key and no principal.
  assert.deepEqual(Object.keys(media).filter((key) => /storage|principal/.test(key)), []);

  const bytes = await api.media("GET", media.url, { token: null });
  assert.equal(bytes.status, 200);
  assert.equal(bytes.response.headers.get("content-type"), "image/png");
  assert.equal(bytes.response.headers.get("x-content-type-options"), "nosniff");
  assert.match(bytes.response.headers.get("content-security-policy"), /default-src 'none'; sandbox/);
  assert.match(bytes.response.headers.get("cache-control"), /immutable/);
  assert.equal(bytes.response.headers.get("etag"), `"${media.checksum_sha256}"`);

  // Content is addressed by an immutable id, so a matching ETag is a 304.
  const revalidated = await api.media("GET", media.url, { token: null, headers: { "if-none-match": `"${media.checksum_sha256}"` } });
  assert.equal(revalidated.status, 304);

  assert.equal((await api.media("GET", `/api/social-media/${AGENT_ID}/content`, { token: null })).status, 404);
});

test("uploads require a scoped principal and reject unusable payloads observably", async () => {
  const api = harness();
  assert.equal((await api.media("POST", "/api/social-media", { body: upload, token: "nobody" })).status, 401);

  const invalid = await api.media("POST", "/api/social-media", { body: { ...upload, data: GIF } });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.json.error.code, "invalid_media");
  assert.match(invalid.json.error.fields.data, /does not contain/);
  assert.equal(invalid.json.error.request_id, "request-1");

  assert.equal((await api.media("PUT", "/api/social-media", { body: upload })).status, 405);
});

test("a failed metadata write leaves no dangling reference and logs the orphan", async () => {
  const blobs = createMemoryBlobStore();
  const failing = { async create() { throw new Error("d1 write failed"); } };
  await assert.rejects(
    ingestMediaUpload(upload, { media: failing, blobs, principalId: AGENT_ID, id: AGENT_ID, now: "2026-07-18T12:00:00.000Z" }),
    /image metadata could not be stored/,
  );
  // The commit point is the metadata row, so the bytes are reclaimed and no
  // post can ever reference an image that was never committed.
  assert.equal(await blobs.get("social-media/11111111-1111-4111-8111-111111111111.png"), null);
});

/* ------------------------------- image posts ----------------------------- */

test("one record covers text and image posts; the image fields describe the image", async () => {
  const api = harness();
  const media = await uploadImage(api);

  const created = await api.posts("POST", "/api/social-posts", {
    body: { author: "Priya", content: "Shipped the upload path.", timestamp: "2026-07-18T11:59:00Z", source: "agent-orchestrator", media_id: media.id, caption: "A single grey pixel." },
  });
  assert.equal(created.status, 201, created.text);
  const post = created.json.post;
  assert.equal(post.image_url, media.url);
  assert.equal(post.image_alt, "A single grey pixel.");
  assert.deepEqual([post.image_width, post.image_height], [1, 1]);
  assert.equal(post.caption, "A single grey pixel.");
  assert.deepEqual([post.like_count, post.comment_count], [0, 0]);
  assert.equal(created.response.headers.get("location"), `/api/social-posts/${post.id}`);

  // The feed and the single read return the identical projection.
  const listed = await api.posts("GET", "/api/social-posts", { token: null });
  assert.deepEqual(listed.json.posts, [post]);
  assert.deepEqual((await api.posts("GET", `/api/social-posts/${post.id}`, { token: null })).json.post, post);
});

test("image references are validated, owner-scoped, and claimable exactly once", async () => {
  const api = harness();
  const media = await uploadImage(api);
  const body = { author: "Priya", content: "Post text.", timestamp: "2026-07-18T11:59:00Z", source: "agent-orchestrator" };

  // A caption with no image is refused with a usable message rather than
  // surfacing the storage CHECK constraint as a 500.
  const captionOnly = await api.posts("POST", "/api/social-posts", { body: { ...body, caption: "orphan caption" } });
  assert.equal(captionOnly.status, 422);
  assert.equal(captionOnly.json.error.fields.caption, "caption requires media_id or image");

  const unknown = await api.posts("POST", "/api/social-posts", { body: { ...body, media_id: OTHER_AGENT_ID } });
  assert.equal(unknown.status, 422);
  assert.equal(unknown.json.error.code, "invalid_media");

  const notOwned = await api.posts("POST", "/api/social-posts", {
    body: { ...body, author: "Kai", media_id: media.id }, token: "other",
  });
  assert.equal(notOwned.status, 403);
  assert.equal(notOwned.json.error.code, "media_not_owned");

  assert.equal((await api.posts("POST", "/api/social-posts", { body: { ...body, media_id: media.id } })).status, 201);
  // One image belongs to one post: the second claim is a 409, not a silent
  // second post sharing the image.
  const reclaim = await api.posts("POST", "/api/social-posts", { body: { ...body, media_id: media.id } });
  assert.equal(reclaim.status, 409);
  assert.equal(reclaim.json.error.code, "media_already_attached");

  assert.match(validateSocialPostInput({ ...body, media_id: "nope" }).errors.media_id, /UUID of an uploaded image/);
});

/* ------------------------ single-request image posts --------------------- */

// Console capture, so the observability these paths promise is asserted rather
// than assumed -- and so a deliberate failure does not scribble on test output.
async function captureErrors(run) {
  const original = console.error;
  const entries = [];
  console.error = (event, detail) => entries.push({ event, detail });
  try {
    return { result: await run(), entries };
  } finally {
    console.error = original;
  }
}

test("a post can carry its image inline and lands as one indistinguishable record", async () => {
  const api = harness();
  const created = await api.posts("POST", "/api/social-posts", {
    body: {
      author: "Priya", content: "Painted this.", timestamp: "2026-07-18T11:59:00Z",
      source: "paint", image: upload, caption: "A single grey pixel.",
    },
  });
  assert.equal(created.status, 201, created.text);
  const post = created.json.post;
  assert.match(post.image_url, /^\/api\/social-media\/[0-9a-f-]{36}\/content$/);
  assert.equal(post.image_alt, "A single grey pixel.");
  assert.deepEqual([post.image_width, post.image_height], [1, 1]);
  assert.equal(post.caption, "A single grey pixel.");
  assert.equal(created.response.headers.get("location"), `/api/social-posts/${post.id}`);

  // Same public byte route as an uploaded image: how the image arrived is not
  // part of the read contract.
  const bytes = await api.media("GET", post.image_url, { token: null });
  assert.equal(bytes.status, 200);
  assert.equal(bytes.response.headers.get("content-type"), "image/png");

  const listed = await api.posts("GET", "/api/social-posts", { token: null });
  assert.deepEqual(listed.json.posts, [post]);

  // Unauthenticated writers are refused before any byte is decoded.
  assert.equal((await api.posts("POST", "/api/social-posts", { body: { author: "Priya", content: "x", image: upload }, token: "nobody" })).status, 401);
});

test("inline Paint images accept JPEG and use the existing canonical storage path", async () => {
  const api = harness();
  const jpeg = {
    content_type: "image/jpeg",
    // Transport whitespace is accepted, but only decoded bytes reach storage.
    data: " /9j/\n2Q== ",
    alt: "A tiny generated JPEG.",
  };
  const created = await api.posts("POST", "/api/social-posts", {
    body: {
      author: "Priya", content: "Painted in JPEG.", timestamp: "2026-07-18T11:59:00Z",
      source: "paint", image: jpeg,
    },
  });

  assert.equal(created.status, 201, created.text);
  const mediaId = created.json.post.image_url.split("/")[3];
  const object = await api.stores.media.get(mediaId);
  assert.equal(object.content_type, "image/jpeg");
  assert.equal(object.storage_key, `social-media/${mediaId}.jpg`);
  assert.deepEqual([...((await api.stores.blobs.get(object.storage_key)).bytes)], [0xff, 0xd8, 0xff, 0xd9]);
});

test("inline images are held to the upload rules, and a rejected post stores nothing", async () => {
  const api = harness();
  const body = { author: "Priya", content: "Painted this.", timestamp: "2026-07-18T11:59:00Z", source: "paint" };

  for (const [image, field, message] of [
    [{ ...upload, data: "not base64!!" }, "image.data", /valid base64/],
    // A declared type the bytes do not support, refused before storage.
    [{ ...upload, data: GIF }, "image.data", /does not contain/],
    [{ content_type: "image/gif", data: GIF, alt: "A GIF." }, "image.content_type", /image\/png, image\/jpeg/],
    // Oversized payloads are refused on encoded length, before any decode.
    [{ ...upload, data: "A".repeat(MAX_MEDIA_BYTES * 2) }, "image.data", /at most 524288 bytes/],
    [{ ...upload, alt: "   " }, "image.alt", /required/],
    [{ ...upload, content_type: "image/svg+xml" }, "image.content_type", /must be one of/],
    [{ ...upload, height: undefined }, "image.dimensions", /both omitted/],
  ]) {
    const rejected = await api.posts("POST", "/api/social-posts", { body: { ...body, image } });
    assert.equal(rejected.status, 422, `${field}: ${rejected.text}`);
    assert.equal(rejected.json.error.code, "invalid_social_post");
    assert.match(rejected.json.error.fields[field], message);
  }

  // A data URL or any other non-object is a client bug worth naming.
  const scalar = await api.posts("POST", "/api/social-posts", { body: { ...body, image: "data:image/png;base64,iVBOR" } });
  assert.match(scalar.json.error.fields.image, /must be an object/);

  // Two ways to attach one image is ambiguous, not a merge.
  const both = await api.posts("POST", "/api/social-posts", { body: { ...body, image: upload, media_id: AGENT_ID } });
  assert.equal(both.status, 422);
  assert.match(both.json.error.fields.image, /not both/);

  assert.deepEqual((await api.posts("GET", "/api/social-posts", { token: null })).json.posts, []);
});

test("an inline image that cannot be stored fails the post as 503 and leaves no post", async () => {
  const api = harness();
  const body = { author: "Priya", content: "Painted this.", timestamp: "2026-07-18T11:59:00Z", source: "paint", image: upload };

  const blobs = api.deps.blobs;
  api.deps.blobs = { ...blobs, put: async () => { throw new Error("bucket unavailable"); } };
  const noBytes = await captureErrors(() => api.posts("POST", "/api/social-posts", { body }));
  api.deps.blobs = blobs;
  assert.equal(noBytes.result.status, 503);
  assert.equal(noBytes.result.json.error.code, "storage_unavailable");
  // The binding's own message is logged and never returned to the caller.
  assert.equal(noBytes.entries[0].event, "social_media_storage_failure");
  assert.match(noBytes.entries[0].detail.error, /bucket unavailable/);
  assert.doesNotMatch(noBytes.result.text, /bucket unavailable/);

  const stored = [];
  const blobPut = api.stores.blobs.put;
  api.stores.blobs.put = async (key, ...rest) => { stored.push(key); return blobPut(key, ...rest); };
  const mediaCreate = api.stores.media.create;
  api.stores.media.create = async () => { throw new Error("d1 write failed"); };
  const noRow = await captureErrors(() => api.posts("POST", "/api/social-posts", { body }));
  api.stores.media.create = mediaCreate;
  api.stores.blobs.put = blobPut;
  assert.equal(noRow.result.status, 503);
  // The metadata row is the commit point, so the written bytes were reclaimed.
  assert.equal(stored.length, 1);
  assert.equal(await api.stores.blobs.get(stored[0]), null);

  // A deployment without the image stores still serves text posts, and says so
  // rather than failing an image post as an unexplained 500.
  const media = api.deps.media;
  api.deps.media = null;
  const unwired = await captureErrors(() => api.posts("POST", "/api/social-posts", { body }));
  api.deps.media = media;
  assert.equal(unwired.result.status, 503);
  assert.match(unwired.result.json.error.message, /Image posting is not configured/);

  assert.deepEqual((await api.posts("GET", "/api/social-posts", { token: null })).json.posts, []);
});

test("an inline image is rolled back when the post row it was created for never lands", async () => {
  // Both ways the insert can fail after the image has already committed: it
  // throws, or it refuses the row. Either way the request must leave nothing
  // behind -- an image with no post is unreachable garbage nobody will reclaim.
  for (const [outcome, create, code] of [
    ["throws", async () => { throw new Error("d1 write failed"); }, "internal"],
    ["refuses", async () => null, "internal"],
  ]) {
    const api = harness();
    const written = [];
    const mediaCreate = api.stores.media.create;
    api.stores.media.create = async (row) => { written.push(row); return mediaCreate(row); };
    api.deps.store.create = create;

    const { result: failed, entries } = await captureErrors(() => api.posts("POST", "/api/social-posts", {
      body: { author: "Priya", content: "Painted this.", timestamp: "2026-07-18T11:59:00Z", source: "paint", image: upload },
    }));

    assert.equal(failed.status, 500, outcome);
    assert.equal(failed.json.error.code, code, outcome);
    assert.equal(failed.json.error.request_id, "request-1");
    assert.equal(written.length, 1, outcome);
    assert.equal(await api.stores.media.get(written[0].id), null, `${outcome}: image row`);
    assert.equal(await api.stores.blobs.get(written[0].storage_key), null, `${outcome}: image bytes`);
    // The failure is named in the log, not swallowed.
    assert.ok(entries.length > 0, outcome);
  }
});

test("an attached image cannot be deleted out from under the post that shows it", async () => {
  const api = harness();
  const media = await uploadImage(api);

  // Unattached: the uploader may reclaim it.
  const spare = await uploadImage(api);
  assert.equal((await api.media("DELETE", `/api/social-media/${spare.id}`)).status, 204);
  assert.equal((await api.media("GET", `/api/social-media/${spare.id}`, { token: null })).status, 404);

  await api.posts("POST", "/api/social-posts", {
    body: { author: "Priya", content: "Post text.", timestamp: "2026-07-18T11:59:00Z", source: "agent-orchestrator", media_id: media.id },
  });
  const attached = await api.media("DELETE", `/api/social-media/${media.id}`);
  assert.equal(attached.status, 409);
  assert.equal(attached.json.error.code, "media_attached");

  // Another principal gets 404, not 409: ownership is never disclosed.
  assert.equal((await api.media("DELETE", `/api/social-media/${media.id}`, { token: "other" })).status, 404);
});

/* --------------------------------- likes --------------------------------- */

test("likes are idempotent, reversible, and counted on the post", async () => {
  const api = harness();
  const created = await api.posts("POST", "/api/social-posts", {
    body: { author: "Priya", content: "Post text.", timestamp: "2026-07-18T11:59:00Z", source: "agent-orchestrator" },
  });
  const id = created.json.post.id;

  const first = await api.posts("PUT", `/api/social-posts/${id}/likes`);
  assert.equal(first.status, 200);
  assert.deepEqual(first.json, { post_id: id, liked: true, like_count: 1 });
  // A retried like asserts state rather than incrementing, so a client that
  // never saw the first response cannot double count.
  assert.deepEqual((await api.posts("PUT", `/api/social-posts/${id}/likes`)).json.like_count, 1);
  assert.deepEqual((await api.posts("PUT", `/api/social-posts/${id}/likes`, { token: "other" })).json.like_count, 2);

  assert.equal((await api.posts("GET", `/api/social-posts/${id}`, { token: null })).json.post.like_count, 2);

  const removed = await api.posts("DELETE", `/api/social-posts/${id}/likes`);
  assert.deepEqual(removed.json, { post_id: id, liked: false, like_count: 1 });
  // Unliking twice is equally safe.
  assert.deepEqual((await api.posts("DELETE", `/api/social-posts/${id}/likes`)).json.like_count, 1);

  assert.equal((await api.posts("PUT", `/api/social-posts/${OTHER_AGENT_ID}/likes`)).status, 404);
  assert.equal((await api.posts("PUT", `/api/social-posts/${id}/likes`, { token: "nobody" })).status, 401);
  assert.equal((await api.posts("GET", `/api/social-posts/${id}/likes`, { token: null })).status, 405);
});

/* -------------------------------- comments ------------------------------- */

test("comments are owned, bounded, listed newest first, and counted", async () => {
  const api = harness();
  const created = await api.posts("POST", "/api/social-posts", {
    body: { author: "Priya", content: "Post text.", timestamp: "2026-07-18T11:59:00Z", source: "agent-orchestrator" },
  });
  const id = created.json.post.id;

  const comment = await api.posts("POST", `/api/social-posts/${id}/comments`, { body: { author: "Priya", content: "Nice work." } });
  assert.equal(comment.status, 201, comment.text);
  assert.equal(comment.json.comment.post_id, id);
  assert.equal(comment.json.comment.content, "Nice work.");
  // principal_id is server-side only and never appears in a public read.
  assert.deepEqual(Object.keys(comment.json.comment).sort(), ["author", "content", "created_at", "id", "post_id"]);

  const listed = await api.posts("GET", `/api/social-posts/${id}/comments`, { token: null });
  assert.equal(listed.status, 200);
  assert.deepEqual(listed.json.comments, [comment.json.comment]);
  assert.equal((await api.posts("GET", `/api/social-posts/${id}`, { token: null })).json.post.comment_count, 1);

  // Agents cannot comment under another persona's name.
  const impersonation = await api.posts("POST", `/api/social-posts/${id}/comments`, { body: { author: "Kai", content: "hi" } });
  assert.equal(impersonation.status, 403);
  assert.equal(impersonation.json.error.code, "author_mismatch");

  assert.match(validateCommentInput({ author: "Priya", content: "x".repeat(281) }).errors.content, /at most 280/);
  assert.equal((await api.posts("POST", `/api/social-posts/${id}/comments`, { body: { author: "Priya", content: " " } })).status, 422);
  assert.equal((await api.posts("POST", `/api/social-posts/${OTHER_AGENT_ID}/comments`, { body: { author: "Priya", content: "hi" } })).status, 404);
  assert.equal((await api.posts("GET", `/api/social-posts/${id}/comments?limit=101`, { token: null })).status, 400);

  const commentId = comment.json.comment.id;
  // Only the principal who wrote it may remove it, and a refusal is a 404.
  assert.equal((await api.posts("DELETE", `/api/social-posts/${id}/comments/${commentId}`, { token: "other" })).status, 404);
  assert.equal((await api.posts("DELETE", `/api/social-posts/${id}/comments/${commentId}`)).status, 204);
  assert.equal((await api.posts("GET", `/api/social-posts/${id}`, { token: null })).json.post.comment_count, 0);
});

/* --------------------------- update and delete --------------------------- */

test("edits are bounded to content and caption; the image reference is immutable", async () => {
  const api = harness();
  const media = await uploadImage(api);
  const created = await api.posts("POST", "/api/social-posts", {
    body: { author: "Priya", content: "First take.", timestamp: "2026-07-18T11:59:00Z", source: "agent-orchestrator", media_id: media.id, caption: "First caption." },
  });
  const id = created.json.post.id;

  const patched = await api.posts("PATCH", `/api/social-posts/${id}`, { body: { content: "Second take." } });
  assert.equal(patched.status, 200, patched.text);
  assert.equal(patched.json.post.content, "Second take.");
  assert.equal(patched.json.post.caption, "First caption.", "an unsent field is untouched");
  assert.equal(patched.json.post.image_url, media.url);

  assert.equal((await api.posts("PATCH", `/api/social-posts/${id}`, { body: { caption: null } })).json.post.caption, null);

  const reparent = await api.posts("PATCH", `/api/social-posts/${id}`, { body: { media_id: media.id } });
  assert.equal(reparent.status, 422);
  assert.match(reparent.json.error.fields.media_id, /cannot be changed/);

  assert.equal((await api.posts("PATCH", `/api/social-posts/${id}`, { body: {} })).status, 422);
  // Editing someone else's post is a 404, not a 403.
  assert.equal((await api.posts("PATCH", `/api/social-posts/${id}`, { body: { content: "hijack" }, token: "other" })).status, 404);

  assert.match(validateSocialPostPatch({ caption: "x" }, { hasMedia: false }).errors.caption, /requires an image/);
});

test("deleting a post removes its likes, comments, image, and bytes together", async () => {
  const api = harness();
  const media = await uploadImage(api);
  const created = await api.posts("POST", "/api/social-posts", {
    body: { author: "Priya", content: "Post text.", timestamp: "2026-07-18T11:59:00Z", source: "agent-orchestrator", media_id: media.id },
  });
  const id = created.json.post.id;
  await api.posts("PUT", `/api/social-posts/${id}/likes`);
  await api.posts("POST", `/api/social-posts/${id}/comments`, { body: { author: "Priya", content: "Nice." } });

  assert.equal((await api.posts("DELETE", `/api/social-posts/${id}`, { token: "other" })).status, 404);
  assert.equal((await api.posts("DELETE", `/api/social-posts/${id}`)).status, 204);

  assert.equal((await api.posts("GET", `/api/social-posts/${id}`, { token: null })).status, 404);
  assert.deepEqual((await api.posts("GET", "/api/social-posts", { token: null })).json.posts, []);
  assert.equal(await api.stores.likes.countFor(id), 0);
  assert.equal(await api.stores.comments.countFor(id), 0);
  // The image and its bytes go with the post; nothing is left to leak.
  assert.equal((await api.media("GET", `/api/social-media/${media.id}`, { token: null })).status, 404);
  assert.equal((await api.media("GET", media.url, { token: null })).status, 404);
});

/* ---------------------------- routing and limits ------------------------- */

test("unknown routes, bad identifiers, and unusable methods fail predictably", async () => {
  const api = harness();
  assert.equal((await api.posts("GET", "/api/social-posts/not-a-uuid", { token: null })).status, 400);
  assert.equal((await api.posts("GET", `/api/social-posts/${AGENT_ID}/reactions`, { token: null })).status, 404);
  assert.equal((await api.posts("GET", `/api/social-posts/${AGENT_ID}/likes/${AGENT_ID}`, { token: null })).status, 404);
  assert.equal((await api.posts("GET", `/api/social-posts/${AGENT_ID}/comments/not-a-uuid`, { token: null })).status, 400);

  const method = await api.posts("POST", `/api/social-posts/${AGENT_ID}`, { body: {} });
  assert.equal(method.status, 405);
  assert.equal(method.response.headers.get("allow"), "GET, PATCH, DELETE");
});

test("one rate budget covers every social write, so likes cannot dodge the post limit", async () => {
  const api = harness({ limit: 2 });
  const created = await api.posts("POST", "/api/social-posts", {
    body: { author: "Priya", content: "Post text.", timestamp: "2026-07-18T11:59:00Z", source: "agent-orchestrator" },
  });
  assert.equal(created.status, 201);
  assert.equal((await api.posts("PUT", `/api/social-posts/${created.json.post.id}/likes`)).status, 200);

  const limited = await api.posts("POST", `/api/social-posts/${created.json.post.id}/comments`, { body: { author: "Priya", content: "hi" } });
  assert.equal(limited.status, 429);
  assert.equal(limited.response.headers.get("retry-after"), "60");
  // Reads are never rate limited: the feed must stay available under write load.
  assert.equal((await api.posts("GET", "/api/social-posts", { token: null })).status, 200);
});

/* --------------------- transactional correctness on D1 -------------------- */

test("an inline image post commits bytes, image row, and post row on real SQL", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const stores = createD1SocialStores(db);
  const deps = {
    ...stores, store: stores.posts,
    authenticate: async () => AGENT,
    rateLimit: createD1RateLimiter(db),
    nowMs: () => NOW,
    requestId: "request-1",
  };

  const response = await handleSocialPostsRequest(new Request("https://test.invalid/api/social-posts", {
    method: "POST",
    headers: { authorization: "Bearer agent", "content-type": "application/json" },
    body: JSON.stringify({
      author: "Priya", content: "Painted this.", timestamp: "2026-07-18T11:59:00Z",
      source: "paint", image: upload, caption: "A single grey pixel.",
    }),
  }), deps);
  assert.equal(response.status, 201);
  const { post } = await response.json();

  // Every layer the request touched is durable and consistent: the post row,
  // the image row it references, and the bytes that row points at.
  const mediaId = post.image_url.split("/")[3];
  const object = await stores.media.get(mediaId);
  assert.equal(object.principal_id, AGENT_ID);
  assert.equal(object.byte_size, 70);
  assert.equal((await stores.blobs.get(object.storage_key)).bytes.byteLength, 70);
  assert.equal((await stores.posts.get(post.id)).caption, "A single grey pixel.");

  // The image arrived inline, but it is an ordinary media object afterwards:
  // one post owns it, and the unique index still refuses a second claim.
  assert.equal(await stores.posts.create({
    id: "44444444-4444-4444-8444-444444444444", author: "Priya", content: "Post text.",
    timestamp: "2026-07-18T11:59:00.000Z", source: "paint", media_id: mediaId,
    principal_id: AGENT_ID, created_at: "2026-07-18T12:00:00.000Z",
  }), null);
});

test("the guarded insert lets exactly one post claim an image, in real SQL", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const posts = createD1SocialPostStore(db);
  const media = createD1MediaStore(db);

  const object = await media.create({
    id: AGENT_ID, storage_key: "social-media/one.png", content_type: "image/png", byte_size: 70,
    checksum_sha256: "a".repeat(64), alt_text: "A single grey pixel.", width: 1, height: 1,
    principal_id: AGENT_ID, created_at: "2026-07-18T12:00:00.000Z",
  });
  assert.equal(object.id, AGENT_ID);

  const base = { author: "Priya", content: "Post text.", timestamp: "2026-07-18T11:59:00.000Z", source: "agent-orchestrator", principal_id: AGENT_ID, created_at: "2026-07-18T12:00:00.000Z" };
  const first = await posts.create({ ...base, id: "33333333-3333-4333-8333-333333333333", media_id: AGENT_ID, caption: "A pixel." });
  assert.equal(first.image_url, `/api/social-media/${AGENT_ID}/content`);
  assert.equal(first.image_alt, "A single grey pixel.");
  assert.equal(first.caption, "A pixel.");

  // Second claim on the same image: the guard rejects it, and no row lands.
  const second = await posts.create({ ...base, id: "44444444-4444-4444-8444-444444444444", media_id: AGENT_ID });
  assert.equal(second, null);
  assert.equal((await posts.list(10)).length, 1);

  // An image belonging to another principal is equally unclaimable.
  await media.create({ id: OTHER_AGENT_ID, storage_key: "social-media/two.png", content_type: "image/png", byte_size: 70, checksum_sha256: "b".repeat(64), alt_text: "Another pixel.", width: null, height: null, principal_id: "someone-else", created_at: "2026-07-18T12:00:00.000Z" });
  assert.equal(await posts.create({ ...base, id: "55555555-5555-4555-8555-555555555555", media_id: OTHER_AGENT_ID }), null);

  // And the attached image cannot be deleted while the post references it.
  assert.equal(await media.deleteOwned(AGENT_ID, AGENT_ID), null);
});

test("deleting a post on D1 clears its engagement and image in one transaction", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const posts = createD1SocialPostStore(db);
  const media = createD1MediaStore(db);
  const likes = createD1LikeStore(db);

  await media.create({ id: AGENT_ID, storage_key: "social-media/one.png", content_type: "image/png", byte_size: 70, checksum_sha256: "a".repeat(64), alt_text: "A pixel.", width: 1, height: 1, principal_id: AGENT_ID, created_at: "2026-07-18T12:00:00.000Z" });
  const postId = "33333333-3333-4333-8333-333333333333";
  await posts.create({ id: postId, author: "Priya", content: "Post text.", timestamp: "2026-07-18T11:59:00.000Z", source: "agent-orchestrator", media_id: AGENT_ID, principal_id: AGENT_ID, created_at: "2026-07-18T12:00:00.000Z" });
  assert.equal((await likes.like(postId, "human:someone", "2026-07-18T12:01:00.000Z")).like_count, 1);

  // A non-owner's delete changes nothing at all.
  assert.equal(await posts.deleteOwned(postId, "someone-else"), null);
  assert.equal((await likes.like(postId, "human:someone", "2026-07-18T12:01:00.000Z")).like_count, 1);

  const removed = await posts.deleteOwned(postId, AGENT_ID);
  // The reclaimable blob key is reported, so the bytes can be freed after commit.
  assert.equal(removed.storage_key, "social-media/one.png");
  assert.equal(await posts.get(postId), null);
  assert.equal(await media.get(AGENT_ID), null);
  assert.equal(await likes.countFor(postId), 0);
  assert.equal(await posts.deleteOwned(postId, AGENT_ID), null, "a repeated delete is a clean miss");
});

test("D1 likes stay idempotent and refuse to attach to a post that is gone", async (t) => {
  const db = await createTestD1();
  t.after(() => db.close());
  const posts = createD1SocialPostStore(db);
  const likes = createD1LikeStore(db);
  const postId = "33333333-3333-4333-8333-333333333333";
  await posts.create({ id: postId, author: "Priya", content: "Post text.", timestamp: "2026-07-18T11:59:00.000Z", source: "agent-orchestrator", principal_id: AGENT_ID, created_at: "2026-07-18T12:00:00.000Z" });

  assert.equal((await likes.like(postId, "p1", "t")).like_count, 1);
  assert.equal((await likes.like(postId, "p1", "t")).like_count, 1, "the primary key absorbs the retry");
  assert.equal((await likes.like(postId, "p2", "t")).like_count, 2);
  assert.equal((await likes.unlike(postId, "p1")).like_count, 1);
  assert.equal(await likes.like("66666666-6666-4666-8666-666666666666", "p1", "t"), null);
  // The count the caller receives is the count at commit, read in the same
  // transaction as the write that produced it.
  assert.equal(await likes.countFor(postId), 1);
});
