import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PUBLISH_IMAGE_BYTES,
  PAINT_HANDOFF_KEY,
  PAINT_HANDOFF_MAX_AGE_MS,
  PAINT_HANDOFF_STORAGE_ERROR,
  dataUrlPayload,
  takePaintHandoff,
  validatePublishImage,
  writePaintHandoff,
} from "../src/publishing-media.js";

const pixel = {
  content_type: "image/png",
  data: "iVBORw0KGgo=",
  preview: "data:image/png;base64,iVBORw0KGgo=",
  size: 12,
  width: 1,
  height: 1,
  source: "paint",
};

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("publishing image validation draws empty, error, and implausible extremes", () => {
  assert.match(validatePublishImage(null), /Choose/);
  assert.match(validatePublishImage({ ...pixel, content_type: "image/svg+xml" }), /PNG/);
  assert.match(validatePublishImage({ ...pixel, size: 0 }), /empty/);
  assert.match(validatePublishImage({ ...pixel, size: MAX_PUBLISH_IMAGE_BYTES + 1 }), /512 KB/);
  assert.match(validatePublishImage({ ...pixel, width: 0 }), /dimensions/);
  assert.equal(validatePublishImage(pixel), null);
});

test("data URLs become the publish payload only for accepted image types", () => {
  assert.deepEqual(dataUrlPayload(pixel.preview), { content_type: "image/png", data: pixel.data });
  assert.equal(dataUrlPayload("data:image/svg+xml;base64,PHN2Zz4="), null);
});

const PNG = Buffer.from(pixel.data, "base64");

test("a Paint handoff comes back as the same file, and only once", async () => {
  const storage = memoryStorage();
  const written = await writePaintHandoff(storage, new Blob([PNG], { type: "image/png" }), { name: "paint-export.png", now: 1_000 });
  assert.deepEqual(written, { ok: true });
  const record = JSON.parse(storage.getItem(PAINT_HANDOFF_KEY));
  assert.deepEqual(record, { dataUrl: pixel.preview, type: "image/png", name: "paint-export.png", size: PNG.length, createdAt: 1_000 });

  const file = takePaintHandoff(storage, 2_000);
  assert.ok(file instanceof File);
  assert.equal(file.name, "paint-export.png");
  assert.equal(file.type, "image/png");
  assert.equal(file.size, PNG.length);
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
  assert.equal(storage.getItem(PAINT_HANDOFF_KEY), null);
  assert.equal(takePaintHandoff(storage, 2_000), null, "the handoff was taken twice");

  // The type is not judged here: the composer's Choose image path refuses it,
  // with the reason it gives a chosen file.
  await writePaintHandoff(storage, new Blob(["<svg/>"], { type: "image/svg+xml" }), { now: 0 });
  assert.equal(takePaintHandoff(storage, 0).type, "image/svg+xml");
});

test("a stale, future-dated or unreadable record is cleared and ignored", async () => {
  const storage = memoryStorage();
  const blob = new Blob([PNG], { type: "image/png" });
  await writePaintHandoff(storage, blob, { now: 0 });
  assert.ok(takePaintHandoff(storage, PAINT_HANDOFF_MAX_AGE_MS), "a record at fifteen minutes is still fresh");
  for (const [raw, now] of [
    [JSON.stringify({ dataUrl: pixel.preview, type: "image/png", createdAt: 0 }), PAINT_HANDOFF_MAX_AGE_MS + 1],
    [JSON.stringify({ dataUrl: pixel.preview, type: "image/png", createdAt: 5_000 }), 0],
    [JSON.stringify({ dataUrl: "https://example.com/x.png", type: "image/png", createdAt: 0 }), 0],
    ["{bad json", 0],
  ]) {
    storage.setItem(PAINT_HANDOFF_KEY, raw);
    assert.equal(takePaintHandoff(storage, now), null, `took ${raw}`);
    assert.equal(storage.getItem(PAINT_HANDOFF_KEY), null, `left ${raw} behind`);
  }
});

test("a store that will not hold the record is reported, never thrown", async () => {
  const blob = new Blob([PNG], { type: "image/png" });
  const full = { setItem() { throw new DOMException("The quota has been exceeded.", "QuotaExceededError"); } };
  assert.deepEqual(await writePaintHandoff(full, blob), { ok: false, error: PAINT_HANDOFF_STORAGE_ERROR });
  assert.deepEqual(await writePaintHandoff(undefined, blob), { ok: false, error: PAINT_HANDOFF_STORAGE_ERROR });
  assert.match(PAINT_HANDOFF_STORAGE_ERROR, /Export it, then use “Choose image”/);
  assert.equal(takePaintHandoff({ getItem() { throw new Error("blocked"); } }), null);
  assert.equal(takePaintHandoff(undefined), null);
});
