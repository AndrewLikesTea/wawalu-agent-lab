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
  // OVER_LIMIT_ERROR above. A file over it — chosen or handed over from Paint —
  // is refused before it is read, so this is the backstop, not the usual answer.
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

// Paint hands an image to the Social composer as one record in localStorage.
// Not sessionStorage: Paint opens in a second tab, and the draft the image
// belongs to lives only in the memory of the first (src/social.js keeps it out
// of storage on purpose). An open composer claims the record from its `storage`
// event; when none does, Paint opens Social itself, which claims it on load.
// The record is taken once — removed before anything checks it — and becomes a
// File again, so the composer refuses, previews and publishes it through the
// same path as a file chosen with "Choose image". Nothing here judges the image.
export const PAINT_HANDOFF_KEY = "shiplog.paint-post.v2";
export const PAINT_HANDOFF_MAX_AGE_MS = 15 * 60 * 1000;
export const PAINT_HANDOFF_STORAGE_ERROR =
  "This image is too large to carry over to Social. Export it, then use “Choose image” on Social instead.";

function toBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

// Resolves { ok } and never rejects: a full or blocked store is an answer the
// caller has to say out loud, not an exception.
export async function writePaintHandoff(storage, blob, { name = "image", now = Date.now() } = {}) {
  try {
    const dataUrl = `data:${blob.type};base64,${toBase64(new Uint8Array(await blob.arrayBuffer()))}`;
    storage.setItem(PAINT_HANDOFF_KEY, JSON.stringify({ dataUrl, type: blob.type, name, size: blob.size, createdAt: now }));
    return { ok: true };
  } catch {
    return { ok: false, error: PAINT_HANDOFF_STORAGE_ERROR };
  }
}

export function takePaintHandoff(storage, now = Date.now()) {
  try {
    const raw = storage?.getItem(PAINT_HANDOFF_KEY);
    if (!raw) return null;
    storage.removeItem(PAINT_HANDOFF_KEY);
    const { dataUrl, type, name, createdAt } = JSON.parse(raw);
    const age = now - createdAt;
    if (!(age >= 0 && age <= PAINT_HANDOFF_MAX_AGE_MS)) return null;
    const match = /^data:[^;,]*;base64,([A-Za-z0-9+/]*=*)$/.exec(dataUrl);
    if (!match) return null;
    const bytes = Uint8Array.from(atob(match[1]), (character) => character.charCodeAt(0));
    return new File([bytes], String(name || "image"), { type: String(type ?? "") });
  } catch {
    return null;
  }
}
