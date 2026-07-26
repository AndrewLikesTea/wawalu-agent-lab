import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  PAINT_EDITOR_MAX_AGE_MS,
  resolvePaintEditorImports,
  validatePaintEditorImport,
} from "../src/paint-editor-contract.js";

const FIXTURES = new URL("../contracts/paint-editor/v1/fixtures/", import.meta.url);
const NOW = Date.parse("2026-07-25T13:00:00.000Z");

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`${name}.json`, FIXTURES), "utf8"));
}

test("the valid fixture is accepted without mutating caller data", async () => {
  const input = await fixture("valid");
  const before = structuredClone(input);
  const result = validatePaintEditorImport(input, { nowMs: NOW });

  assert.equal(result.ok, true);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(input, before);
  assert.notEqual(result.value, input);
  assert.equal(Object.isFrozen(result.value.asset), true);
});

test("partial input is rejected with a precise missing-field error", async () => {
  const result = validatePaintEditorImport(await fixture("partial"), { nowMs: NOW });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.find(({ path }) => path === "$.asset"), {
    path: "$.asset",
    code: "required",
    message: "asset is required.",
  });
});

test("stale input is usable but carries a warning", async () => {
  const result = validatePaintEditorImport(await fixture("stale"), {
    nowMs: Date.parse("2026-07-25T12:00:00.001Z"),
    maxAgeMs: PAINT_EDITOR_MAX_AGE_MS,
  });
  assert.equal(result.ok, true);
  assert.equal(result.warnings[0].code, "stale");
});

test("malformed input is rejected defensively across trust boundaries", async () => {
  const result = validatePaintEditorImport(await fixture("malformed"), { nowMs: NOW });
  assert.equal(result.ok, false);
  const paths = new Set(result.errors.map(({ path }) => path));
  for (const path of [
    "$.schema_version",
    "$.transfer_id",
    "$.source.drawing_id",
    "$.source.revision",
    "$.source.exported_at",
    "$.asset.url",
    "$.asset.content_type",
    "$.asset.byte_size",
    "$.asset.checksum_sha256",
    "$.canvas.width",
    "$.canvas.height",
  ]) assert.equal(paths.has(path), true, path);
});

test("unknown fields require a contract version instead of being silently trusted", async () => {
  const input = await fixture("valid");
  input.asset.credentials = "must-not-cross-boundary";
  const result = validatePaintEditorImport(input, { nowMs: NOW });
  assert.equal(result.ok, false);
  assert.equal(result.errors.find(({ path }) => path === "$.asset.credentials")?.code, "unknown_field");
});

test("reordered delivery selects the greatest revision, not the last item", async () => {
  const deliveries = await fixture("reordered");
  const result = resolvePaintEditorImports([...deliveries].reverse(), { nowMs: NOW });
  assert.equal(result.status, "accepted");
  assert.equal(result.import.source.revision, 3);
  assert.equal(result.import.transfer_id, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
});

test("duplicates are idempotent and malformed siblings are quarantined", async () => {
  const valid = await fixture("valid");
  const result = resolvePaintEditorImports([valid, structuredClone(valid), await fixture("partial")], { nowMs: NOW });
  assert.equal(result.status, "accepted");
  assert.equal(result.import.transfer_id, valid.transfer_id);
  assert.equal(result.rejected.length, 1);
});

test("equal revisions with different bytes are a conflict", async () => {
  const first = await fixture("valid");
  const second = structuredClone(first);
  second.transfer_id = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  second.asset.checksum_sha256 = "f".repeat(64);
  const result = resolvePaintEditorImports([first, second], { nowMs: NOW });
  assert.deepEqual({ status: result.status, reason: result.reason }, {
    status: "conflict",
    reason: "revision_checksum_mismatch",
  });
});

test("mixed drawings are never compared as revisions of one another", async () => {
  const first = await fixture("valid");
  const second = structuredClone(first);
  second.transfer_id = "ffffffff-ffff-4fff-8fff-ffffffffffff";
  second.source.drawing_id = "another-drawing";
  const result = resolvePaintEditorImports([first, second], { nowMs: NOW });
  assert.equal(result.status, "conflict");
  assert.equal(result.reason, "mixed_drawings");
});

test("schema is versioned, strict, and aligned with the runtime constants", async () => {
  const schema = JSON.parse(await readFile(new URL("../contracts/paint-editor/v1/schema.json", import.meta.url), "utf8"));
  assert.equal(schema.properties.schema_version.const, "1.0");
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.source.additionalProperties, false);
  assert.equal(schema.properties.asset.properties.byte_size.maximum, 5 * 1024 * 1024);
  assert.deepEqual(schema.required, ["schema_version", "kind", "transfer_id", "source", "asset", "canvas"]);
});
