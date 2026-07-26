export const PAINT_HANDOFF_KEY = "shiplog.paint-post.v1";
export const MAX_PUBLISH_IMAGE_BYTES = 512 * 1024;
export const PUBLISH_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function validatePublishImage(image) {
  if (!image || typeof image !== "object") return "Choose an image to continue.";
  if (!PUBLISH_IMAGE_TYPES.has(image.content_type)) return "Use a PNG, JPEG, GIF, or WebP image.";
  if (!Number.isInteger(image.size) || image.size < 1) return "That image is empty.";
  if (image.size > MAX_PUBLISH_IMAGE_BYTES) return "This image is over 512 KB. Resize or simplify it, then try again.";
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
