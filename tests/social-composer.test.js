import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MAX_COMPOSER_IMAGE_BYTES,
  fileToBase64,
  formatImageSize,
  imagePayload,
  parsePaintExport,
  validateImageFile,
} from "../src/social-composer.js";

const fixture = (name) => readFile(new URL(`../contracts/paint-editor/v1/fixtures/${name}.json`, import.meta.url), "utf8");

test("upload validation gives actionable type, empty, and size errors", () => {
  assert.match(validateImageFile(null), /Choose/);
  assert.match(validateImageFile({ type: "image/svg+xml", size: 20 }), /PNG/);
  assert.match(validateImageFile({ type: "image/png", size: 0 }), /empty/);
  assert.match(validateImageFile({ type: "image/png", size: MAX_COMPOSER_IMAGE_BYTES + 1 }), /512 KB/);
  assert.equal(validateImageFile({ type: "image/webp", size: MAX_COMPOSER_IMAGE_BYTES }), "");
});

test("Paint manifests become same-origin preview media and malformed exports fail", async () => {
  const valid = parsePaintExport(await fixture("valid"), { nowMs: Date.parse("2026-07-20T12:00:00Z") });
  assert.equal(valid.media.kind, "paint");
  assert.match(valid.media.src, /^\/api\/images\/.+\/content$/);
  assert.equal(valid.media.width, 1024);
  assert.equal(parsePaintExport("{").error, "That Paint export is not valid JSON.");
  assert.match(parsePaintExport(await fixture("partial")).error, /valid Paint export/);
});

test("file and Paint selections produce the same inline image payload", async () => {
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
  const file = { type: "image/png", size: bytes.length, arrayBuffer: async () => bytes.buffer };
  const upload = await imagePayload({ contentType: file.type, file }, " A useful description ");
  const paint = await imagePayload(
    { src: "/api/images/id/content", contentType: "image/png", width: 10, height: 20 },
    "Painted marks",
    async () => ({ ok: true, blob: async () => file }),
  );
  assert.equal(upload.data, await fileToBase64(file));
  assert.equal(upload.alt, "A useful description");
  assert.deepEqual(paint, { content_type: "image/png", data: upload.data, alt: "Painted marks", width: 10, height: 20 });
  assert.equal(formatImageSize(1025), "2 KB");
});
