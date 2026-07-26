import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PUBLISH_IMAGE_BYTES,
  PAINT_HANDOFF_KEY,
  dataUrlPayload,
  takePaintHandoff,
  validatePublishImage,
  writePaintHandoff,
} from "../src/publishing-media.js";
import { paintHandoffFromDataUrl } from "../src/paint/paint.js";

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

test("paint data URLs become a bounded social handoff", () => {
  assert.deepEqual(dataUrlPayload(pixel.preview), { content_type: "image/png", data: pixel.data });
  assert.equal(dataUrlPayload("data:image/svg+xml;base64,PHN2Zz4="), null);
  assert.deepEqual(paintHandoffFromDataUrl(pixel.preview, { width: 1, height: 1, size: 12 }), pixel);
});

test("paint handoff is consumed once and malformed state is discarded", () => {
  const storage = memoryStorage();
  assert.deepEqual(writePaintHandoff(storage, pixel), { ok: true });
  assert.ok(storage.getItem(PAINT_HANDOFF_KEY));
  assert.deepEqual(takePaintHandoff(storage), pixel);
  assert.equal(takePaintHandoff(storage), null);

  storage.setItem(PAINT_HANDOFF_KEY, "{bad json");
  assert.equal(takePaintHandoff(storage), null);
});

test("storage and oversize handoff failures give a recovery path", () => {
  const blocked = { setItem() { throw new Error("quota"); } };
  assert.match(writePaintHandoff(blocked, pixel).error, /Export it/);
  assert.match(writePaintHandoff(memoryStorage(), { ...pixel, size: MAX_PUBLISH_IMAGE_BYTES + 1 }).error, /512 KB/);
});
