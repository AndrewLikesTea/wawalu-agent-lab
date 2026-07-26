// Paint -> image editor import contract.
//
// This module intentionally owns validation and ordering only. Uploading bytes is
// the existing /api/images boundary; opening an editor window and authentication
// are deployment/UI decisions outside this contract.

export const PAINT_EDITOR_SCHEMA_VERSION = "1.0";
export const PAINT_EDITOR_KIND = "wawalu.paint.editor-import";
export const PAINT_EDITOR_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHECKSUM = /^[0-9a-f]{64}$/;
const CONTENT_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function rejectUnknown(object, allowed, path, errors) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) errors.push({ path: `${path}.${key}`, code: "unknown_field", message: `${key} is not defined in schema version ${PAINT_EDITOR_SCHEMA_VERSION}.` });
  }
}

export function validatePaintEditorImport(value, { nowMs = Date.now(), maxAgeMs = PAINT_EDITOR_MAX_AGE_MS } = {}) {
  const errors = [];
  if (!plainObject(value)) return { ok: false, errors: [{ path: "$", code: "invalid_type", message: "Import must be an object." }] };
  rejectUnknown(value, new Set(["schema_version", "kind", "transfer_id", "source", "asset", "canvas", "title"]), "$", errors);

  if (value.schema_version !== PAINT_EDITOR_SCHEMA_VERSION) {
    errors.push({ path: "$.schema_version", code: "unsupported_version", message: `Only schema version ${PAINT_EDITOR_SCHEMA_VERSION} is supported.` });
  }
  if (value.kind !== PAINT_EDITOR_KIND) {
    errors.push({ path: "$.kind", code: "invalid_value", message: `kind must be ${PAINT_EDITOR_KIND}.` });
  }
  if (!UUID.test(value.transfer_id ?? "")) errors.push({ path: "$.transfer_id", code: "invalid_format", message: "transfer_id must be a UUID." });

  if (!plainObject(value.source)) {
    errors.push({ path: "$.source", code: "required", message: "source is required." });
  } else {
    rejectUnknown(value.source, new Set(["application", "drawing_id", "revision", "exported_at"]), "$.source", errors);
    if (value.source.application !== "paint") errors.push({ path: "$.source.application", code: "invalid_value", message: "source.application must be paint." });
    if (typeof value.source.drawing_id !== "string" || !value.source.drawing_id.trim() || value.source.drawing_id.length > 128) {
      errors.push({ path: "$.source.drawing_id", code: "invalid_format", message: "drawing_id must be 1–128 characters." });
    }
    if (!Number.isSafeInteger(value.source.revision) || value.source.revision < 0) {
      errors.push({ path: "$.source.revision", code: "invalid_format", message: "revision must be a non-negative safe integer." });
    }
    if (!validTimestamp(value.source.exported_at)) {
      errors.push({ path: "$.source.exported_at", code: "invalid_format", message: "exported_at must be an RFC 3339 timestamp." });
    }
  }

  if (!plainObject(value.asset)) {
    errors.push({ path: "$.asset", code: "required", message: "asset is required." });
  } else {
    rejectUnknown(value.asset, new Set(["id", "url", "content_type", "byte_size", "checksum_sha256"]), "$.asset", errors);
    if (!UUID.test(value.asset.id ?? "")) errors.push({ path: "$.asset.id", code: "invalid_format", message: "asset.id must be a UUID." });
    if (value.asset.url !== `/api/images/${value.asset.id}/content`) {
      errors.push({ path: "$.asset.url", code: "invalid_value", message: "asset.url must be the canonical same-origin image content URL." });
    }
    if (!CONTENT_TYPES.has(value.asset.content_type)) errors.push({ path: "$.asset.content_type", code: "invalid_value", message: "asset.content_type is not supported." });
    if (!Number.isSafeInteger(value.asset.byte_size) || value.asset.byte_size < 1 || value.asset.byte_size > 5 * 1024 * 1024) {
      errors.push({ path: "$.asset.byte_size", code: "invalid_format", message: "asset.byte_size must be between 1 and 5242880." });
    }
    if (!CHECKSUM.test(value.asset.checksum_sha256 ?? "")) errors.push({ path: "$.asset.checksum_sha256", code: "invalid_format", message: "asset.checksum_sha256 must be 64 lowercase hex characters." });
  }

  if (!plainObject(value.canvas)) {
    errors.push({ path: "$.canvas", code: "required", message: "canvas is required." });
  } else {
    rejectUnknown(value.canvas, new Set(["width", "height"]), "$.canvas", errors);
    for (const dimension of ["width", "height"]) {
      if (!Number.isSafeInteger(value.canvas[dimension]) || value.canvas[dimension] < 1 || value.canvas[dimension] > 16384) {
        errors.push({ path: `$.canvas.${dimension}`, code: "invalid_format", message: `${dimension} must be an integer from 1 to 16384.` });
      }
    }
  }

  if (value.title !== undefined && (typeof value.title !== "string" || !value.title.trim() || value.title.length > 200)) {
    errors.push({ path: "$.title", code: "invalid_format", message: "title must be 1–200 characters when present." });
  }

  if (errors.length) return { ok: false, errors };
  const ageMs = nowMs - Date.parse(value.source.exported_at);
  return {
    ok: true,
    value: Object.freeze({
      ...value,
      source: Object.freeze({ ...value.source }),
      asset: Object.freeze({ ...value.asset }),
      canvas: Object.freeze({ ...value.canvas }),
    }),
    warnings: ageMs > maxAgeMs ? [{ path: "$.source.exported_at", code: "stale", message: "The export is older than the freshness window." }] : [],
  };
}

// Reordered or retried delivery is normal. Pick the highest valid revision for
// one drawing; transfer_id makes exact retries idempotent. Equal revisions with
// different checksums are a conflict and must not be guessed through.
export function resolvePaintEditorImports(values, options = {}) {
  const valid = [];
  const rejected = [];
  const seenTransfers = new Set();

  for (const candidate of values) {
    const result = validatePaintEditorImport(candidate, options);
    if (!result.ok) {
      rejected.push({ candidate, errors: result.errors });
      continue;
    }
    if (seenTransfers.has(result.value.transfer_id)) continue;
    seenTransfers.add(result.value.transfer_id);
    valid.push(result);
  }
  if (!valid.length) return { status: "rejected", rejected };

  const drawingIds = new Set(valid.map(({ value }) => value.source.drawing_id));
  if (drawingIds.size !== 1) return { status: "conflict", reason: "mixed_drawings", rejected };

  const revision = Math.max(...valid.map(({ value }) => value.source.revision));
  const newest = valid.filter(({ value }) => value.source.revision === revision);
  if (new Set(newest.map(({ value }) => value.asset.checksum_sha256)).size !== 1) {
    return { status: "conflict", reason: "revision_checksum_mismatch", rejected };
  }
  newest.sort((a, b) => a.value.transfer_id.localeCompare(b.value.transfer_id));
  return { status: "accepted", import: newest[0].value, warnings: newest[0].warnings, rejected };
}
