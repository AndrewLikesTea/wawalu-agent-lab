import { matchesDeclaredType } from "./social-media.js";

export const IMAGE_EXPORT_ROUTE = /^\/api\/image\/export\/([^/]+)\/?$/;
export const MAX_EXPORT_INPUT_BYTES = 5 * 1024 * 1024;
export const EXPORT_FORMATS = Object.freeze({
  png: Object.freeze({ contentType: "image/png", extension: "png" }),
  jpeg: Object.freeze({ contentType: "image/jpeg", extension: "jpg" }),
});

const INPUT_TYPES = Object.freeze(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const FITS = Object.freeze(["scale-down", "contain", "cover", "crop", "pad"]);
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(status, body, requestId, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, "x-request-id": requestId, ...headers },
  });
}

function failure(status, code, message, requestId, fields, headers = {}) {
  return json(status, {
    error: { code, message, request_id: requestId, ...(fields ? { fields } : {}) },
  }, requestId, headers);
}

function integer(value, name, minimum, maximum, errors) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    errors[name] = `${name} must be an integer from ${minimum} to ${maximum}`;
    return undefined;
  }
  return value;
}

// This is the public request model. Unknown keys are rejected so a misspelled
// edit is never silently omitted from an otherwise successful export.
export function validateExportTransformations(input, format) {
  const errors = {};
  if (input === undefined || input === null) input = {};
  if (typeof input !== "object" || Array.isArray(input)) {
    return { values: {}, errors: { transformations: "transformations must be a JSON object" } };
  }

  const allowed = new Set(["width", "height", "fit", "rotate", "quality"]);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) errors[key] = `${key} is not a supported transformation`;
  }

  const values = {};
  const width = integer(input.width, "width", 1, 4096, errors);
  const height = integer(input.height, "height", 1, 4096, errors);
  if (width !== undefined) values.width = width;
  if (height !== undefined) values.height = height;

  if (input.fit !== undefined) {
    if (!FITS.includes(input.fit)) errors.fit = `fit must be one of ${FITS.join(", ")}`;
    else values.fit = input.fit;
  }
  if (input.rotate !== undefined) {
    if (![0, 90, 180, 270].includes(input.rotate)) errors.rotate = "rotate must be 0, 90, 180, or 270";
    else if (input.rotate !== 0) values.rotate = input.rotate;
  }

  const quality = integer(input.quality, "quality", 1, 100, errors);
  if (quality !== undefined) {
    if (format !== "jpeg") errors.quality = "quality is only supported for jpeg exports";
    else values.quality = quality;
  }
  return { values, errors };
}

export function validateExportInput(input, format) {
  const errors = {};
  const bytes = input?.bytes;
  const contentType = typeof input?.contentType === "string"
    ? input.contentType.trim().split(";")[0].toLowerCase()
    : "";

  if (!(bytes instanceof Uint8Array)) errors.file = "file must be a single uploaded image part";
  else if (bytes.byteLength === 0) errors.file = "file must not be empty";
  else if (bytes.byteLength > MAX_EXPORT_INPUT_BYTES) errors.file = `file must be at most ${MAX_EXPORT_INPUT_BYTES} bytes`;

  if (bytes instanceof Uint8Array && !INPUT_TYPES.includes(contentType)) {
    errors.file = `file must have one of these content types: ${INPUT_TYPES.join(", ")}`;
  } else if (bytes instanceof Uint8Array && bytes.byteLength > 0 && bytes.byteLength <= MAX_EXPORT_INPUT_BYTES
    && !matchesDeclaredType(bytes, contentType)) {
    errors.file = `file does not contain a ${contentType} image`;
  }

  const transformations = validateExportTransformations(input?.transformations, format);
  return {
    values: { bytes, contentType, transformations: transformations.values },
    errors: { ...errors, ...transformations.errors },
  };
}

async function parseRequest(request, requestId) {
  if (!/^multipart\/form-data\s*;/i.test(request.headers.get("content-type") ?? "")) {
    return { response: failure(415, "unsupported_media_type", "Content-Type must be multipart/form-data.", requestId) };
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return { response: failure(400, "invalid_body", "The multipart body could not be parsed.", requestId) };
  }

  const file = form.get("file");
  let transformations;
  try {
    const raw = form.get("transformations");
    transformations = raw === null || raw === "" ? {} : JSON.parse(raw);
  } catch {
    return { response: failure(400, "invalid_json", "transformations must contain valid JSON.", requestId) };
  }

  if (typeof file !== "object" || file === null || typeof file.arrayBuffer !== "function") {
    return { input: { bytes: null, contentType: "", transformations } };
  }
  if (file.size > MAX_EXPORT_INPUT_BYTES) {
    return { response: failure(413, "payload_too_large", `The input image must be at most ${MAX_EXPORT_INPUT_BYTES} bytes.`, requestId) };
  }
  return {
    input: {
      bytes: new Uint8Array(await file.arrayBuffer()),
      contentType: file.type,
      transformations,
    },
  };
}

// One input handle, one ordered transform chain, and one output response: there
// is no partial commit or durable intermediate state to clean up.
export async function processImageExport(input, format, images) {
  const contract = EXPORT_FORMATS[format];
  let pipeline = images.input(input.bytes);
  const { quality, ...transform } = input.transformations;
  if (Object.keys(transform).length) pipeline = pipeline.transform(transform);
  const output = await pipeline.output({
    format: contract.contentType,
    ...(quality === undefined ? {} : { quality }),
    anim: false,
  });
  return output.response();
}

export async function handleImageExportRequest(request, deps) {
  const requestId = deps.requestId ?? crypto.randomUUID();
  const startedAt = Date.now();
  let format = "unknown";
  try {
    const match = IMAGE_EXPORT_ROUTE.exec(new URL(request.url).pathname);
    if (!match) return failure(404, "not_found", "Unknown image export route.", requestId);
    format = match[1].toLowerCase();
    if (!EXPORT_FORMATS[format]) {
      return failure(400, "invalid_format", "format must be png or jpeg.", requestId);
    }
    if (request.method !== "POST") {
      return failure(405, "method_not_allowed", `${request.method} is not allowed.`, requestId, undefined, { allow: "POST" });
    }
    if (!deps.images) {
      deps.log?.error?.("image_export_unavailable", { requestId, format, durationMs: Date.now() - startedAt });
      return failure(503, "export_unavailable", "Image processing is unavailable.", requestId);
    }

    const parsed = await parseRequest(request, requestId);
    if (parsed.response) return parsed.response;
    const validation = validateExportInput(parsed.input, format);
    if (Object.keys(validation.errors).length) {
      return failure(422, "invalid_image_export", "The image export request is invalid.", requestId, validation.errors);
    }

    const processed = await processImageExport(validation.values, format, deps.images);
    if (!processed.ok) throw new Error(`image pipeline returned ${processed.status}`);
    const headers = new Headers(processed.headers);
    headers.set("content-type", EXPORT_FORMATS[format].contentType);
    headers.set("content-disposition", `attachment; filename="edited-image.${EXPORT_FORMATS[format].extension}"`);
    headers.set("cache-control", "no-store");
    headers.set("x-content-type-options", "nosniff");
    headers.set("x-request-id", requestId);
    deps.log?.info?.("image_export_completed", {
      requestId, format, inputBytes: validation.values.bytes.byteLength, durationMs: Date.now() - startedAt,
    });
    return new Response(processed.body, { status: 200, headers });
  } catch (error) {
    deps.log?.error?.("image_export_failed", {
      requestId, format, durationMs: Date.now() - startedAt, error: error?.message ?? String(error),
    });
    return failure(422, "image_processing_failed", "The input could not be processed as an image.", requestId);
  }
}
