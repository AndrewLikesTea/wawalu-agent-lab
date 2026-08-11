export const PAINT_HANDOFF_KEY = "shiplog.paint-post.v1";
export const MAX_PUBLISH_IMAGE_BYTES = 512 * 1024;
export const PUBLISH_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

// What the Social composer says when a chosen file is refused before it is read.
// The two facts the field's help text states — "PNG, JPEG, GIF, or WebP" and
// "512 KB maximum" — are worded here exactly as they are worded there, so a
// reader who is refused reads back the same rule they were shown. Every refusal
// in this file follows the same shape: what stopped the file, then the step.
export const UNSUPPORTED_TYPE_ERROR =
  "This file is not a PNG, JPEG, GIF, or WebP.";

export function overLimitError(size) {
  return `This file is ${Math.max(1, Math.ceil(Number(size) / 1024))} KB; the maximum is 512 KB.`;
}

export function validatePublishImage(image) {
  if (!image || typeof image !== "object") return "Choose an image to continue.";
  if (!PUBLISH_IMAGE_TYPES.has(image.content_type)) return "Use a PNG, JPEG, GIF, or WebP image.";
  if (!Number.isInteger(image.size) || image.size < 1) return "That image is empty.";
  // The same figure, in the same words as the field's help text and as
  // OVER_LIMIT_ERROR above. Only the step differs: this one answers for a
  // drawing handed over from Paint, which is not a file the visitor can swap.
  if (image.size > MAX_PUBLISH_IMAGE_BYTES) return overLimitError(image.size);
  if (typeof image.data !== "string" || !image.data) return "This image could not be read.";
  if (!Number.isInteger(image.width) || image.width < 1 || !Number.isInteger(image.height) || image.height < 1) {
    return "This image has invalid dimensions.";
  }
  return null;
}

export function dataUrlPayload(dataUrl) {
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(String(dataUrl ?? ""));
  return match ? { content_type: match[1], data: match[2] } : null;
}

export function writePaintHandoff(storage, value) {
  const error = validatePublishImage(value);
  if (error) return { ok: false, error };
  try {
    storage?.setItem(PAINT_HANDOFF_KEY, JSON.stringify(value));
    return { ok: true };
  } catch {
    return { ok: false, error: "The drawing is too large to hand off. Export it, then upload the file from Social." };
  }
}

export function takePaintHandoff(storage) {
  try {
    const raw = storage?.getItem(PAINT_HANDOFF_KEY);
    if (!raw) return null;
    storage.removeItem(PAINT_HANDOFF_KEY);
    const value = JSON.parse(raw);
    return validatePublishImage(value) ? null : value;
  } catch {
    return null;
  }
}
