// The shared durable image store: POST /api/images and GET /api/images/{id}.
//
// Every fixture is synthetic. No customer content, credential, or production
// endpoint appears here, and the D1 cases run against an in-memory SQLite with
// the checked-in migrations (see ./support/d1-sqlite.js).

import test from "node:test";
import assert from "node:assert/strict";
import {
  INLINE_MAX_IMAGE_BYTES,
  IMAGE_WRITE_SCOPE,
  MAX_IMAGE_BYTES,
  createD1ImageStore,
  createMemoryImageStore,
  effectiveMaxBytes,
  handleImagesRequest,
  publicImage,
  storeImage,
  validateImageUpload,
} from "../src/images-api.js";
import { createD1BlobStore, createMemoryBlobStore, storageKeyFor } from "../src/social-media.js";
import { imageDependencies } from "../src/social-edge.js";
import { createTestD1 } from "./support/d1-sqlite.js";

const UPLOADER = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-07-18T12:00:00.000Z");
const ISO = "2026-07-18T12:00:00.000Z";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Real files, not placeholder buffers: the magic-byte check is only meaningful
// against bytes a decoder would actually accept.
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const GIF_BASE64 = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

function bytesOf(base64) {
  return new Uint8Array([...atob(base64)].map((character) => character.charCodeAt(0)));
}

function crc32(bytes, start, end) {
  let crc = 0xffffffff;
  for (let offset = start; offset < end; offset++) {
    crc ^= bytes[offset];
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const PNG = bytesOf(PNG_BASE64);
const GIF = bytesOf(GIF_BASE64);

function harness({ blobKind = "r2", limit = 10 } = {}) {
  const images = createMemoryImageStore();
  const blobs = { ...createMemoryBlobStore(), kind: blobKind };
  const calls = [];
  const deps = {
    requestId: "request-1",
    images,
    blobs,
    nowMs: () => NOW,
    authenticate: async (request) => {
      const token = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "")?.[1];
      if (token === "uploader") return { id: UPLOADER, scopes: [IMAGE_WRITE_SCOPE] };
      if (token === "other") return { id: OTHER, scopes: [IMAGE_WRITE_SCOPE] };
      if (token === "reader") return { id: OTHER, scopes: ["social-posts:write"] };
      return null;
    },
    rateLimit: async (key, nowMs) => {
      calls.push(key);
      const used = calls.filter((entry) => entry === key).length;
      return { allowed: used <= limit, limit, remaining: Math.max(0, limit - used), resetAt: nowMs + 60_000 };
    },
  };

  function form({ bytes = PNG, contentType = "image/png", alt = "A single grey pixel.", omitFile = false } = {}) {
    const body = new FormData();
    if (!omitFile) body.set("file", new Blob([bytes], { type: contentType }), "pixel.png");
    if (alt !== null) body.set("alt", alt);
    return body;
  }

  async function send(method, path, { body, token = "uploader", headers = {} } = {}) {
    const requestHeaders = { ...headers };
    if (token) requestHeaders.authorization = `Bearer ${token}`;
    return handleImagesRequest(new Request(`https://labs.wawalu.org${path}`, { method, body, headers: requestHeaders }), deps);
  }

  return { deps, images, blobs, form, send, rateKeys: calls };
}

/* ------------------------------ happy path ------------------------------- */

test("an upload is stored durably and retrievable by its returned identifier", async () => {
  const { send, form, blobs } = harness();

  const created = await send("POST", "/api/images", { body: form() });
  assert.equal(created.status, 201);
  const { image } = await created.json();
  assert.match(image.id, UUID);
  assert.equal(created.headers.get("location"), `/api/images/${image.id}`);
  assert.equal(image.url, `/api/images/${image.id}/content`);
  assert.equal(image.content_type, "image/png");
  assert.equal(image.byte_size, PNG.byteLength);
  assert.equal(image.alt, "A single grey pixel.");
  assert.equal(image.namespace, "images");
  assert.match(image.checksum_sha256, /^[0-9a-f]{64}$/);

  const metadata = await send("GET", `/api/images/${image.id}`, { token: null });
  assert.equal(metadata.status, 200);
  assert.deepEqual((await metadata.json()).image, image);

  const content = await send("GET", `/api/images/${image.id}/content`, { token: null });
  assert.equal(content.status, 200);
  assert.equal(content.headers.get("content-type"), "image/png");
  assert.equal(content.headers.get("x-content-type-options"), "nosniff");
  assert.equal(content.headers.get("content-security-policy"), "default-src 'none'; sandbox");
  assert.equal(content.headers.get("etag"), `"${image.checksum_sha256}"`);
  assert.deepEqual(new Uint8Array(await content.arrayBuffer()), PNG);

  // The bytes really are in the blob store under the derived, namespaced key.
  const stored = await blobs.get(storageKeyFor(image.id, "image/png", "images"));
  assert.deepEqual(stored.bytes, PNG);
});

test("content honours conditional requests and HEAD", async () => {
  const { send, form } = harness();
  const { image } = await (await send("POST", "/api/images", { body: form() })).json();

  const cached = await send("GET", `/api/images/${image.id}/content`, { token: null, headers: { "if-none-match": `"${image.checksum_sha256}"` } });
  assert.equal(cached.status, 304);
  assert.equal((await cached.arrayBuffer()).byteLength, 0);

  const head = await send("HEAD", `/api/images/${image.id}/content`, { token: null });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(PNG.byteLength));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
});

test("every allowlisted image type round-trips", async () => {
  const { send, form } = harness();
  for (const [bytes, contentType] of [[PNG, "image/png"], [GIF, "image/gif"]]) {
    const response = await send("POST", "/api/images", { body: form({ bytes, contentType, alt: "Synthetic fixture." }) });
    assert.equal(response.status, 201, contentType);
    assert.equal((await response.json()).image.content_type, contentType);
  }
});

/* ------------------------------- size limits ----------------------------- */

test("the advertised ceiling is 5MB and an oversized upload is rejected with 413", async () => {
  assert.equal(MAX_IMAGE_BYTES, 5 * 1024 * 1024);
  const { send, form } = harness();

  // A real PNG header followed by filler, so the payload fails on size rather
  // than on the signature check.
  const huge = new Uint8Array(MAX_IMAGE_BYTES + 1);
  huge.set(PNG.subarray(0, 8), 0);
  const response = await send("POST", "/api/images", { body: form({ bytes: huge }) });
  assert.equal(response.status, 413);
  const { error } = await response.json();
  assert.equal(error.code, "payload_too_large");
  assert.equal(error.max_bytes, MAX_IMAGE_BYTES);
  assert.equal(error.request_id, "request-1");
});

test("a file exactly at the ceiling is accepted", async () => {
  const { send, form } = harness();
  // Signature + IHDR, one large private ancillary chunk, then IEND. A header
  // followed by filler is malformed and must not prove the success path.
  const atLimit = new Uint8Array(MAX_IMAGE_BYTES);
  atLimit.set(PNG.subarray(0, 33), 0);
  const chunkLength = MAX_IMAGE_BYTES - 33 - 12 - 12;
  new DataView(atLimit.buffer).setUint32(33, chunkLength);
  atLimit.set(new TextEncoder().encode("ruSt"), 37);
  new DataView(atLimit.buffer).setUint32(
    MAX_IMAGE_BYTES - 16,
    crc32(atLimit, 37, MAX_IMAGE_BYTES - 16),
  );
  atLimit.set(PNG.subarray(-12), MAX_IMAGE_BYTES - 12);
  const response = await send("POST", "/api/images", { body: form({ bytes: atLimit }) });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).image.byte_size, MAX_IMAGE_BYTES);
});

test("without an object store the cap drops to the inline bound and says why", async () => {
  const { send, form } = harness({ blobKind: "d1" });
  assert.equal(effectiveMaxBytes({ kind: "d1" }), INLINE_MAX_IMAGE_BYTES);
  assert.equal(effectiveMaxBytes({ kind: "r2" }), MAX_IMAGE_BYTES);
  assert.ok(INLINE_MAX_IMAGE_BYTES < MAX_IMAGE_BYTES);

  const overInline = new Uint8Array(INLINE_MAX_IMAGE_BYTES + 1);
  overInline.set(PNG.subarray(0, 8), 0);
  const response = await send("POST", "/api/images", { body: form({ bytes: overInline }) });
  assert.equal(response.status, 413);
  const { error } = await response.json();
  assert.equal(error.max_bytes, INLINE_MAX_IMAGE_BYTES);
  // A deployment without a bucket must not look like the API lying about 5MB.
  assert.match(error.reason, /object store/i);

  // Under the inline bound it still works, so the fallback degrades in capacity
  // rather than in availability.
  assert.equal((await send("POST", "/api/images", { body: form() })).status, 201);
});

test("an oversized body is refused from content-length before it is buffered", async () => {
  const { deps } = harness();
  let bodyWasRead = false;
  const request = new Request("https://labs.wawalu.org/api/images", {
    method: "POST",
    headers: { authorization: "Bearer uploader", "content-type": "multipart/form-data; boundary=x", "content-length": String(MAX_IMAGE_BYTES * 4) },
  });
  Object.defineProperty(request, "formData", { value: async () => { bodyWasRead = true; return new FormData(); } });

  assert.equal((await handleImagesRequest(request, deps)).status, 413);
  assert.equal(bodyWasRead, false);
});

/* ----------------------------- invalid formats --------------------------- */

test("a payload whose bytes contradict its declared type is rejected", async () => {
  const { send, form } = harness();
  // A GIF renamed to image/png: exactly the case a content-type-only check
  // would wave through into durable storage.
  const response = await send("POST", "/api/images", { body: form({ bytes: GIF, contentType: "image/png" }) });
  assert.equal(response.status, 422);
  const { error } = await response.json();
  assert.equal(error.code, "invalid_image");
  assert.match(error.fields.file, /does not contain a well-formed image\/png image/);
});

test("HTML and SVG cannot be parked in durable storage", async () => {
  const { send, form, images } = harness();
  const html = new TextEncoder().encode("<script>alert(1)</script>");
  const svg = new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>");

  for (const [bytes, contentType] of [[html, "image/png"], [svg, "image/svg+xml"], [svg, "image/png"], [html, "text/html"]]) {
    const response = await send("POST", "/api/images", { body: form({ bytes, contentType }) });
    assert.equal(response.status, 422, `${contentType} must be rejected`);
  }
  assert.equal(await images.get("any"), null);
});

test("truncated images and bytes appended after the image are rejected", async () => {
  const { send, form } = harness();
  for (const bytes of [
    PNG.subarray(0, PNG.length - 1),
    Uint8Array.from(PNG, (byte, index) => index === 40 ? byte ^ 1 : byte),
    Uint8Array.from([...PNG, ...new TextEncoder().encode("<script>alert(1)</script>")]),
    GIF.subarray(0, GIF.length - 1),
    Uint8Array.from([...GIF, 0x00]),
  ]) {
    const contentType = bytes[0] === 0x89 ? "image/png" : "image/gif";
    const response = await send("POST", "/api/images", { body: form({ bytes, contentType }) });
    assert.equal(response.status, 422);
    assert.match((await response.json()).error.fields.file, /well-formed/);
  }
});

test("missing file, empty file, and missing alt are reported as field errors", async () => {
  const { send, form } = harness();

  const noFile = await send("POST", "/api/images", { body: form({ omitFile: true }) });
  assert.equal(noFile.status, 422);
  assert.match((await noFile.json()).error.fields.file, /single uploaded image part/);

  const empty = await send("POST", "/api/images", { body: form({ bytes: new Uint8Array(0) }) });
  assert.equal(empty.status, 422);
  assert.match((await empty.json()).error.fields.file, /must not be empty/);

  const noAlt = await send("POST", "/api/images", { body: form({ alt: null }) });
  assert.equal(noAlt.status, 422);
  assert.match((await noAlt.json()).error.fields.alt, /alt must be a string/);

  const blankAlt = await send("POST", "/api/images", { body: form({ alt: "   " }) });
  assert.equal(blankAlt.status, 422);
  assert.match((await blankAlt.json()).error.fields.alt, /alt is required/);

  const longAlt = await send("POST", "/api/images", { body: form({ alt: "x".repeat(301) }) });
  assert.equal(longAlt.status, 422);
  assert.match((await longAlt.json()).error.fields.alt, /at most 300/);
});

test("a non-multipart upload is a 415", async () => {
  const { send } = harness();
  const response = await send("POST", "/api/images", { body: JSON.stringify({ data: PNG_BASE64 }), headers: { "content-type": "application/json" } });
  assert.equal(response.status, 415);
  assert.equal((await response.json()).error.code, "unsupported_media_type");
});

/* -------------------------------- routing -------------------------------- */

test("unknown routes, bad ids, and wrong methods get the right status", async () => {
  const { send, form } = harness();
  const { image } = await (await send("POST", "/api/images", { body: form() })).json();

  assert.equal((await send("GET", "/api/images/not-a-uuid", { token: null })).status, 400);
  assert.equal((await send("GET", "/api/images/%E0%A4%A", { token: null })).status, 400);
  assert.equal((await send("GET", `/api/images/${image.id}/thumbnail`, { token: null })).status, 404);
  assert.equal((await send("GET", "/api/images/11111111-1111-4111-8111-111111111199", { token: null })).status, 404);

  const badMethod = await send("GET", "/api/images", { token: null });
  assert.equal(badMethod.status, 405);
  assert.equal(badMethod.headers.get("allow"), "POST");

  const badWrite = await send("DELETE", `/api/images/${image.id}`);
  assert.equal(badWrite.status, 405);
  assert.equal(badWrite.headers.get("allow"), "GET, HEAD");
});

/* ----------------------------- authorization ----------------------------- */

test("uploads require a bearer token carrying the images scope", async () => {
  const { send, form } = harness();

  const anonymous = await send("POST", "/api/images", { body: form(), token: null });
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error.code, "unauthenticated");

  const wrongScope = await send("POST", "/api/images", { body: form(), token: "reader" });
  assert.equal(wrongScope.status, 403);
  assert.match((await wrongScope.json()).error.message, /images:write/);

  // Reads stay open -- the bytes are addressed by an unguessable id.
  const { image } = await (await send("POST", "/api/images", { body: form() })).json();
  assert.equal((await send("GET", `/api/images/${image.id}`, { token: null })).status, 200);
});

test("uploads spend their own rate budget and 429 when it is exhausted", async () => {
  const { send, form, rateKeys } = harness({ limit: 1 });

  assert.equal((await send("POST", "/api/images", { body: form() })).status, 201);
  const limited = await send("POST", "/api/images", { body: form() });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("ratelimit-limit"), "1");
  assert.ok(Number(limited.headers.get("retry-after")) >= 1);
  // Prefixed, so an upload cannot consume the principal's social post budget.
  assert.ok(rateKeys.every((key) => key === `images:${UPLOADER}`));

  // The budget is per principal, not global.
  assert.equal((await send("POST", "/api/images", { body: form(), token: "other" })).status, 201);
});

/* ------------------------- no customer data leaks ------------------------ */

test("no principal, storage key, or credential reaches a response", async () => {
  const { send, form, images } = harness();
  const created = await send("POST", "/api/images", { body: form() });
  const { image } = await created.clone().json();

  const row = await images.get(image.id);
  assert.equal(row.principal_id, UPLOADER, "the principal is persisted for attribution");

  for (const response of [created, await send("GET", `/api/images/${image.id}`, { token: null })]) {
    const body = await response.text();
    assert.doesNotMatch(body, new RegExp(UPLOADER), "principal id must not be exposed");
    assert.doesNotMatch(body, /storage_key|principal|Bearer|uploader/i);
  }
  assert.equal(publicImage(row).principal_id, undefined);
  assert.equal(publicImage(row).storage_key, undefined);
});

/* ---------------------------- storage failures --------------------------- */

test("a blob write failure is a 503 and commits no metadata row", async () => {
  const { deps, send, form, images } = harness();
  deps.blobs = { kind: "r2", async put() { throw new Error("R2 binding unavailable"); }, async get() { return null; }, async delete() {} };

  const response = await send("POST", "/api/images", { body: form() });
  assert.equal(response.status, 503);
  const { error } = await response.json();
  assert.equal(error.code, "storage_unavailable");
  // The failing binding is named in logs, never to the caller.
  assert.doesNotMatch(JSON.stringify(error), /R2 binding unavailable/);
  assert.equal(await images.get("11111111-1111-4111-8111-111111111111"), null);
});

test("a metadata write failure reclaims the orphaned bytes", async () => {
  const blobs = { ...createMemoryBlobStore(), kind: "r2" };
  const images = { namespace: "images", async create() { throw new Error("D1 write failed"); }, async get() { return null; } };
  const id = "33333333-3333-4333-8333-333333333333";

  await assert.rejects(
    storeImage({ bytes: PNG, content_type: "image/png", alt: "Synthetic fixture." },
      { images, blobs, principalId: UPLOADER, id, now: ISO, maxBytes: MAX_IMAGE_BYTES, log: { error() {} } }),
    /metadata could not be stored/,
  );
  assert.equal(await blobs.get(storageKeyFor(id, "image/png", "images")), null, "bytes must not be left orphaned");
});

test("metadata without bytes is reported as a storage inconsistency, not a miss", async () => {
  const { deps, send, form } = harness();
  const { image } = await (await send("POST", "/api/images", { body: form() })).json();
  deps.blobs = { kind: "r2", async get() { return null; }, async put() {}, async delete() {} };

  const response = await send("GET", `/api/images/${image.id}/content`, { token: null });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "storage_unavailable");
});

/* --------------------------- validation in isolation --------------------- */

test("validateImageUpload separates oversize from malformed", async () => {
  const ok = validateImageUpload({ bytes: PNG, content_type: "image/png", alt: "Fine." });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.oversize, false);

  const big = validateImageUpload({ bytes: new Uint8Array(11), content_type: "image/png", alt: "Fine." }, { maxBytes: 10 });
  assert.equal(big.oversize, true);
  assert.deepEqual(big.errors, {}, "an oversize file is a size problem, not a format problem");

  const parameterized = validateImageUpload({ bytes: PNG, content_type: "IMAGE/PNG; charset=binary", alt: "Fine." });
  assert.deepEqual(parameterized.errors, {}, "the type parameter and case must not defeat the allowlist");

  assert.match(validateImageUpload({ bytes: PNG, content_type: "image/svg+xml", alt: "Fine." }).errors.content_type, /must be one of/);
});

/* --------------------------------- D1 ------------------------------------ */

test("the D1 store round-trips through the real migration", async () => {
  const db = await createTestD1();
  const images = createD1ImageStore(db);
  const blobs = createD1BlobStore(db);
  const id = "44444444-4444-4444-8444-444444444444";

  const { image } = await storeImage({ bytes: PNG, content_type: "image/png", alt: "A single grey pixel." },
    { images, blobs, principalId: UPLOADER, id, now: ISO, maxBytes: INLINE_MAX_IMAGE_BYTES });

  assert.equal(image.id, id);
  assert.equal(image.namespace, "images");
  assert.equal(image.storage_key, "images/44444444-4444-4444-8444-444444444444.png");
  assert.equal(Number(image.byte_size), PNG.byteLength);
  assert.deepEqual((await blobs.get(image.storage_key)).bytes, PNG);
  assert.equal((await images.get(id)).id, id);
});

test("D1 CHECK constraints backstop the API limits", async () => {
  const db = await createTestD1();
  const images = createD1ImageStore(db);

  const row = {
    storage_key: "images/x.png", content_type: "image/png", byte_size: MAX_IMAGE_BYTES + 1,
    checksum_sha256: "a".repeat(64), alt_text: "Fine.", principal_id: UPLOADER, created_at: ISO,
  };
  // The hard ceiling is enforced by storage too, so a bug in the size logic
  // fails as a rejected write rather than as an unbounded row.
  await assert.rejects(images.create({ ...row, id: "55555555-5555-4555-8555-555555555555" }));
  await assert.rejects(images.create({ ...row, id: "55555555-5555-4555-8555-555555555555", byte_size: 10, content_type: "image/svg+xml" }));
  await assert.rejects(images.create({ ...row, id: "not-a-uuid", byte_size: 10 }));
});

test("namespaces isolate reads, so a shared table is not a cross-team channel", async () => {
  const db = await createTestD1();
  const images = createD1ImageStore(db);
  const reports = createD1ImageStore(db, { namespace: "reports" });
  const blobs = createD1BlobStore(db);
  const id = "66666666-6666-4666-8666-666666666666";

  await storeImage({ bytes: PNG, content_type: "image/png", alt: "A single grey pixel." },
    { images: reports, blobs, principalId: OTHER, id, now: ISO, maxBytes: INLINE_MAX_IMAGE_BYTES });

  assert.equal((await reports.get(id)).id, id);
  assert.equal(await images.get(id), null, "another namespace's id must read as absent");

  // Keys are namespaced too, so two namespaces share one bucket without
  // colliding on the same object id.
  assert.equal(storageKeyFor(id, "image/png", "reports"), `reports/${id}.png`);
  assert.notEqual(storageKeyFor(id, "image/png", "reports"), storageKeyFor(id, "image/png", "images"));
});

test("existing social keys are unchanged by namespacing", () => {
  const id = "77777777-7777-4777-8777-777777777777";
  assert.equal(storageKeyFor(id, "image/png"), `social-media/${id}.png`);
});

/* ------------------------------ edge wiring ------------------------------ */

test("the edge adapter wires a namespace-scoped store and the shared blob store", async () => {
  const db = await createTestD1();
  const inline = imageDependencies({ DB: db, AGENT_TOKENS: "{}" }, "request-9");
  assert.equal(inline.images.namespace, "images");
  assert.equal(inline.blobs.kind, "d1");
  assert.equal(effectiveMaxBytes(inline.blobs), INLINE_MAX_IMAGE_BYTES);
  // Bearer only: there is no anonymous write path into the shared store.
  assert.equal(inline.identifyHuman, undefined);
  assert.equal(await inline.authenticate(new Request("https://labs.wawalu.org/api/images")), null);

  const bucket = { async put() {}, async get() { return null; }, async delete() {} };
  const withBucket = imageDependencies({ DB: db, SOCIAL_MEDIA_BUCKET: bucket }, "request-10");
  assert.equal(withBucket.blobs.kind, "r2");
  assert.equal(effectiveMaxBytes(withBucket.blobs), MAX_IMAGE_BYTES);
});

test("the images route is mounted at both the exact path and the catch-all", async () => {
  const exact = await import("../functions/api/images.js");
  const catchAll = await import("../functions/api/images/[[route]].js");
  assert.equal(exact.onRequest, catchAll.onRequest, "one implementation, no drift");

  // No DB binding means an honest 503 rather than a crash.
  const response = await exact.onRequest({ request: new Request("https://labs.wawalu.org/api/images", { method: "POST" }), env: {} });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "storage_unavailable");
});
