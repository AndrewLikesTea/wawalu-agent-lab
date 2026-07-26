import { validatePaintEditorImport } from "./paint-editor-contract.js";

export const MAX_COMPOSER_IMAGE_BYTES = 512 * 1024;
export const COMPOSER_IMAGE_TYPES = Object.freeze(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export function validateImageFile(file) {
  if (!file || typeof file !== "object") return "Choose an image to continue.";
  if (!COMPOSER_IMAGE_TYPES.includes(file.type)) return "Choose a PNG, JPEG, GIF, or WebP image.";
  if (!Number.isFinite(file.size) || file.size < 1) return "The selected image is empty.";
  if (file.size > MAX_COMPOSER_IMAGE_BYTES) return "Choose an image smaller than 512 KB.";
  return "";
}

export function parsePaintExport(text, options) {
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    return { error: "That Paint export is not valid JSON." };
  }
  const result = validatePaintEditorImport(manifest, options);
  if (!result.ok) return { error: "That file is not a valid Paint export." };
  return {
    media: {
      kind: "paint",
      name: result.value.title?.trim() || "Paint export",
      src: result.value.asset.url,
      contentType: result.value.asset.content_type,
      size: result.value.asset.byte_size,
      width: result.value.canvas.width,
      height: result.value.canvas.height,
    },
    warning: result.warnings.length ? "This Paint export is more than 24 hours old." : "",
  };
}

export function formatImageSize(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${Math.ceil(bytes / 1024)} KB`;
}

export async function fileToBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export async function imagePayload(media, alt, fetchImpl = fetch) {
  if (!media) return null;
  let file = media.file;
  if (!file) {
    const response = await fetchImpl(media.src, { cache: "no-store", headers: { accept: media.contentType } });
    if (!response.ok) throw new Error("paint_export_unavailable");
    file = await response.blob();
    const error = validateImageFile(file);
    if (error || file.type !== media.contentType) throw new Error("paint_export_invalid");
  }
  return {
    content_type: media.contentType,
    data: await fileToBase64(file),
    alt: alt.trim(),
    ...(media.width && media.height ? { width: media.width, height: media.height } : {}),
  };
}
