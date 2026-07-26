// User-journey coverage for publishing images from Paint and from an upload.
//
// These tests deliberately cross the editor, HTTP handlers, durable media
// boundary, feed read model, edits, and comments. Synthetic image fixtures keep
// the suite deterministic and independent of browsers, credentials, and live
// services.

import test from "node:test";
import assert from "node:assert/strict";
import { initEditor } from "../src/paint/paint.js";
import {
  createMemoryRateLimiter,
  createMemorySocialStores,
  handleSocialMediaRequest,
  handleSocialPostsRequest,
} from "../src/social-posts-api.js";
import { createPaintHarness } from "./support/paint-editor.js";

const PRINCIPAL_ID = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-07-18T12:00:00.000Z");
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG_BASE64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=";
const PNG_BYTES = Uint8Array.from(atob(PNG_BASE64), (character) => character.charCodeAt(0));

function apiHarness() {
  const stores = createMemorySocialStores();
  const deps = {
    ...stores,
    store: stores.posts,
    authenticate: async (request) => request.headers.get("authorization") === "Bearer painter"
      ? { id: PRINCIPAL_ID, persona: "Tess", scopes: ["social-posts:write"] }
      : null,
    identifyHuman: async () => ({ id: "human:feed-reader" }),
    rateLimit: createMemoryRateLimiter({ limit: 30 }),
    nowMs: () => NOW,
    requestId: "image-flow-request",
  };

  async function request(handler, method, path, body, { token = "painter" } = {}) {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    const response = await handler(new Request(`https://test.invalid${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }), deps);
    const isJson = response.headers.get("content-type")?.includes("application/json");
    const text = response.status === 204 || !isJson ? "" : await response.clone().text();
    return { response, status: response.status, body: text ? JSON.parse(text) : null };
  }

  return {
    stores,
    media: (method, path, body, options) => request(handleSocialMediaRequest, method, path, body, options),
    posts: (method, path, body, options) => request(handleSocialPostsRequest, method, path, body, options),
  };
}

function postBody(overrides = {}) {
  return {
    author: "Tess",
    content: "Paint export ready to share.",
    timestamp: "2026-07-18T11:59:00Z",
    source: "paint",
    ...overrides,
  };
}

async function exportedPaintImage(context) {
  const exported = new Blob([PNG_BYTES], { type: "image/png" });
  const paint = createPaintHarness({ exportBlob: exported });
  const editor = initEditor(paint.root, paint.environment);
  await paint.canvas.dispatch("pointerdown", { pointerId: 1, clientX: 25, clientY: 25 });
  await paint.canvas.dispatch("pointerup", { pointerId: 1, clientX: 25, clientY: 25 });

  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let captured;
  URL.createObjectURL = (blob) => {
    captured = blob;
    return "blob:paint-publication-test";
  };
  URL.revokeObjectURL = () => {};
  context.after(() => {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  });
  await paint.selectors.get("#export-button").dispatch("click");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.ok(editor.document.revision > 0, "the publication must contain user-created Paint content");
  assert.equal(paint.exports.length, 1, "one export action produces one file");
  assert.equal(captured?.type, "image/png");
  return {
    content_type: captured.type,
    data: Buffer.from(await captured.arrayBuffer()).toString("base64"),
    alt: "A blue brush mark made in Paint.",
    width: 1200,
    height: 800,
  };
}

test("Paint creation → export → publication is one durable, publicly visible image post", async (context) => {
  const api = apiHarness();
  const image = await exportedPaintImage(context);

  const created = await api.posts("POST", "/api/social-posts", postBody({
    image,
    caption: "Made in Paint.",
  }));

  assert.equal(created.status, 201);
  const post = created.body.post;
  assert.equal(post.source, "paint");
  assert.equal(post.caption, "Made in Paint.");
  assert.equal(post.image_alt, image.alt);
  assert.deepEqual([post.image_width, post.image_height], [1200, 800]);

  const content = await api.media("GET", post.image_url, undefined, { token: null });
  assert.equal(content.status, 200);
  assert.equal(content.response.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await content.response.arrayBuffer()), PNG_BYTES);

  const feed = await api.posts("GET", "/api/social-posts", undefined, { token: null });
  assert.deepEqual(feed.body.posts, [post]);
});

test("uploaded images and Paint output take their intended write paths but share one feed model", async (context) => {
  const api = apiHarness();
  const paintImage = await exportedPaintImage(context);
  const paintPost = await api.posts("POST", "/api/social-posts", postBody({ image: paintImage }));

  const uploaded = await api.media("POST", "/api/social-media", {
    content_type: "image/jpeg",
    data: JPEG_BASE64,
    alt: "A JPEG uploaded from the device.",
    width: 1,
    height: 1,
  });
  assert.equal(uploaded.status, 201);
  const uploadPost = await api.posts("POST", "/api/social-posts", postBody({
    content: "Uploaded photo ready to share.",
    source: "shiplog-web",
    media_id: uploaded.body.media.id,
    caption: "Uploaded photo.",
  }));
  assert.equal(uploadPost.status, 201);

  const feed = await api.posts("GET", "/api/social-posts", undefined, { token: null });
  assert.deepEqual(
    feed.body.posts.map((post) => post.id).sort(),
    [uploadPost.body.post.id, paintPost.body.post.id].sort(),
  );
  for (const post of feed.body.posts) {
    assert.match(post.image_url, /^\/api\/social-media\/[0-9a-f-]{36}\/content$/);
    assert.equal(typeof post.image_alt, "string");
    assert.equal(post.like_count, 0);
    assert.equal(post.comment_count, 0);
  }
});

test("PNG and JPG declarations preserve their exact format and bytes in storage", async () => {
  const api = apiHarness();
  for (const fixture of [
    { content_type: "image/png", data: PNG_BASE64, alt: "PNG fixture." },
    { content_type: "image/jpeg", data: JPEG_BASE64, alt: "JPEG fixture." },
  ]) {
    const uploaded = await api.media("POST", "/api/social-media", fixture);
    assert.equal(uploaded.status, 201, fixture.content_type);
    assert.equal(uploaded.body.media.content_type, fixture.content_type);

    const content = await api.media("GET", uploaded.body.media.url, undefined, { token: null });
    assert.equal(content.status, 200);
    assert.equal(content.response.headers.get("content-type"), fixture.content_type);
    assert.deepEqual(
      new Uint8Array(await content.response.arrayBuffer()),
      Uint8Array.from(atob(fixture.data), (character) => character.charCodeAt(0)),
    );
  }

  const disguisedJpeg = await api.media("POST", "/api/social-media", {
    content_type: "image/png",
    data: JPEG_BASE64,
    alt: "Mislabeled fixture.",
  });
  assert.equal(disguisedJpeg.status, 422);
  assert.match(disguisedJpeg.body.error.fields.data, /does not contain a well-formed image\/png/);
});

test("empty feed, slow publication, and refresh mid-action never invent or hide posts", async () => {
  const api = apiHarness();
  assert.deepEqual((await api.posts("GET", "/api/social-posts", undefined, { token: null })).body.posts, []);

  const uploaded = await api.media("POST", "/api/social-media", {
    content_type: "image/png",
    data: PNG_BASE64,
    alt: "Upload waiting to be published.",
  });
  assert.equal(uploaded.status, 201);
  assert.deepEqual(
    (await api.posts("GET", "/api/social-posts", undefined, { token: null })).body.posts,
    [],
    "refreshing after upload but before publish must not show a phantom post",
  );

  let releaseWrite;
  const originalCreate = api.stores.posts.create;
  api.stores.posts.create = async (...args) => {
    await new Promise((resolve) => { releaseWrite = resolve; });
    return originalCreate(...args);
  };
  const pending = api.posts("POST", "/api/social-posts", postBody({ media_id: uploaded.body.media.id }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(
    (await api.posts("GET", "/api/social-posts", undefined, { token: null })).body.posts,
    [],
    "a slow write must not publish partial state",
  );
  releaseWrite();
  const published = await pending;
  assert.equal(published.status, 201);
  assert.deepEqual(
    (await api.posts("GET", "/api/social-posts", undefined, { token: null })).body.posts,
    [published.body.post],
    "a refreshed client sees the committed post",
  );
});

test("a double-click cannot attach one uploaded image to two posts", async () => {
  const api = apiHarness();
  const uploaded = await api.media("POST", "/api/social-media", {
    content_type: "image/png",
    data: PNG_BASE64,
    alt: "One upload, one post.",
  });
  const body = postBody({ media_id: uploaded.body.media.id });
  const attempts = await Promise.all([
    api.posts("POST", "/api/social-posts", body),
    api.posts("POST", "/api/social-posts", body),
  ]);

  assert.deepEqual(attempts.map(({ status }) => status).sort(), [201, 409]);
  assert.equal((await api.posts("GET", "/api/social-posts", undefined, { token: null })).body.posts.length, 1);
});

test("published image posts remain editable, commentable, and visible in the feed", async () => {
  const api = apiHarness();
  const uploaded = await api.media("POST", "/api/social-media", {
    content_type: "image/png",
    data: PNG_BASE64,
    alt: "A release diagram.",
  });
  const created = await api.posts("POST", "/api/social-posts", postBody({
    media_id: uploaded.body.media.id,
    caption: "Before edit.",
  }));
  const id = created.body.post.id;

  const edited = await api.posts("PATCH", `/api/social-posts/${id}`, {
    content: "Edited image post.",
    caption: "After edit.",
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.post.image_url, uploaded.body.media.url);

  const commented = await api.posts("POST", `/api/social-posts/${id}/comments`, {
    author: "Tess",
    content: "Visible comment.",
  });
  assert.equal(commented.status, 201);
  const comments = await api.posts("GET", `/api/social-posts/${id}/comments`, undefined, { token: null });
  assert.deepEqual(comments.body.comments, [commented.body.comment]);

  const feed = await api.posts("GET", "/api/social-posts", undefined, { token: null });
  assert.equal(feed.body.posts[0].content, "Edited image post.");
  assert.equal(feed.body.posts[0].caption, "After edit.");
  assert.equal(feed.body.posts[0].comment_count, 1);
  assert.equal(feed.body.posts[0].image_url, uploaded.body.media.url);
});
