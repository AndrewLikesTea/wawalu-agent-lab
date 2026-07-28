// Page wiring for the social feed. This is the only layer that knows where data
// comes from, keeping social.js reusable and unit-testable. It composes:
//   1. posts from the shared durable API, or
//   2. a static seed from social-demo-data.json while that API is offline.
//
// Demo only (PRODUCT.md): the seed is static, hand-authored sample content and
// no customer or production data is read here.

import { mountSocialFeed, normalizeSocialApiPosts } from "/social.js";
import {
  MAX_PUBLISH_IMAGE_BYTES,
  dataUrlPayload,
  takePaintHandoff,
  validatePublishImage,
} from "/publishing-media.js";
import { paintHandoffIntent, renderPaintArrival } from "/paint-handoff.js";

const REFRESH_INTERVAL = 10_000;

async function fetchLivePosts() {
  const response = await fetch("/api/social-posts?limit=100", { cache: "no-store", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Posts API returned ${response.status}`);
  return normalizeSocialApiPosts(await response.json());
}

async function createLivePost(post, media) {
  const image = media ? {
    content_type: media.content_type,
    data: media.data,
    alt: media.alt,
    width: media.width,
    height: media.height,
  } : undefined;
  const response = await fetch("/api/social-posts", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    // timestamp and source are server-owned for human writes; the API sets them.
    body: JSON.stringify({
      author: post.author,
      content: post.body,
      ...(image ? { image, caption: post.body } : {}),
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message || `Posts API returned ${response.status}`);
  }
  const saved = normalizeSocialApiPosts({ posts: [(await response.json()).post] });
  if (!saved[0]) throw new Error("Posts API returned an invalid post");
  return saved[0];
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result), { once: true });
    reader.addEventListener("error", () => reject(new Error("This image could not be read.")), { once: true });
    reader.readAsDataURL(file);
  });
}

async function imageDimensions(file) {
  const bitmap = await createImageBitmap(file);
  const dimensions = { width: bitmap.width, height: bitmap.height };
  bitmap.close?.();
  return dimensions;
}

async function fileToPublishImage(file) {
  if (!file) throw new Error("Choose an image to continue.");
  if (file.size > MAX_PUBLISH_IMAGE_BYTES) throw new Error("This image is over 512 KB. Resize or simplify it, then try again.");
  const dataUrl = await readAsDataUrl(file);
  const payload = dataUrlPayload(dataUrl);
  if (!payload) throw new Error("Use a PNG, JPEG, GIF, or WebP image.");
  const dimensions = await imageDimensions(file).catch(() => null);
  const value = { ...payload, size: file.size, ...dimensions, preview: dataUrl, source: "upload" };
  const error = validatePublishImage(value);
  if (error) throw new Error(error);
  return value;
}

function mountMediaComposer(root) {
  const input = root.querySelector("#post-image");
  const panel = root.querySelector("#compose-media");
  const frame = root.querySelector("#compose-preview-frame");
  const preview = root.querySelector("#compose-preview-image");
  const fallback = root.querySelector("#compose-preview-error");
  const source = root.querySelector("#compose-media-source");
  const caption = root.querySelector("#compose-preview-caption");
  const alt = root.querySelector("#post-image-alt");
  const status = root.querySelector("#post-media-status");
  const remove = root.querySelector("#remove-image");
  let media = null;
  // FileReader and image decoding are asynchronous. A generation token keeps a
  // slow first selection from replacing a newer preview after it finally
  // finishes.
  let selectionGeneration = 0;

  const setStatus = (message, error = false) => {
    status.textContent = message;
    status.classList.toggle("is-error", error);
  };

  const clear = ({ focus = false } = {}) => {
    selectionGeneration += 1;
    media = null;
    input.value = "";
    alt.value = "";
    preview.removeAttribute("src");
    panel.hidden = true;
    setStatus("");
    if (focus) input.focus();
  };

  const show = (next) => {
    media = next;
    panel.hidden = false;
    frame.dataset.state = "loading";
    fallback.hidden = true;
    preview.hidden = false;
    preview.src = next.preview;
    source.textContent = next.source === "paint" ? "Paint drawing" : "Uploaded image";
    caption.textContent = `${next.width} × ${next.height} px · ${Math.max(1, Math.ceil(next.size / 1024))} KB`;
    setStatus(`${source.textContent} ready to describe and post.`);
    alt.focus();
  };

  preview.addEventListener("load", () => { frame.dataset.state = "ready"; });
  preview.addEventListener("error", () => {
    frame.dataset.state = "error";
    preview.hidden = true;
    fallback.hidden = false;
    setStatus("Preview unavailable. Remove this image and choose it again.", true);
  });
  input.addEventListener("change", async () => {
    const generation = ++selectionGeneration;
    const file = input.files?.[0];
    setStatus("Preparing image preview…");
    panel.hidden = true;
    try {
      const next = await fileToPublishImage(file);
      if (generation !== selectionGeneration) return;
      show(next);
    } catch (error) {
      if (generation !== selectionGeneration) return;
      clear();
      setStatus(error.message, true);
      input.focus();
    }
  });
  remove.addEventListener("click", () => clear({ focus: true }));

  // Arrival from Paint. The panel explains the handoff whether or not an image
  // came with it, because the honest answer differs: an exported file is still
  // only on the device and the visitor attaches it, while a prepared drawing is
  // in this draft and still unpublished. When there is an image to describe the
  // alt field keeps focus — that is the field the visitor has to fill — and
  // otherwise focus lands on the explanation.
  const arrival = renderPaintArrival(root.querySelector("#paint-arrival"), paintHandoffIntent(globalThis.location?.search));
  const paint = takePaintHandoff(globalThis.sessionStorage);
  if (paint) show(paint);
  else arrival?.focus?.();

  return {
    get() {
      if (!media) return null;
      const description = alt.value.trim();
      if (!description) throw new Error("Add an image description before posting.");
      return { ...media, alt: description };
    },
    clear,
  };
}

async function fetchDemoPosts() {
  try {
    const response = await fetch("/social-demo-data.json", { cache: "no-store" });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.posts) ? data.posts : [];
  } catch {
    return [];
  }
}

function dedupeById(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

async function init() {
  const root = document;
  if (!root.querySelector("#post-feed")) return;

  const status = root.querySelector("#feed-status");
  const announcer = root.querySelector("#feed-announcer");
  // Mount before any fetch resolves so the first paint is a reserved skeleton
  // grid rather than a blank panel that later jumps to full height.
  const media = mountMediaComposer(root);
  const feed = mountSocialFeed(root, {
    posts: [],
    state: "loading",
    create: createLivePost,
    getMedia: () => media.get(),
    clearMedia: () => media.clear(),
  });

  const fallback = dedupeById(await fetchDemoPosts());
  if (fallback.length) feed.seed(fallback);
  let knownIds = new Set(fallback.map((post) => post.id));
  let hasConnected = false;

  const refresh = async () => {
    try {
      const live = await fetchLivePosts();
      const nextIds = new Set(live.map((post) => post.id));
      const added = live.filter((post) => !knownIds.has(post.id)).length;
      feed.seed(live);
      knownIds = nextIds;
      if (status) status.textContent = `Live · updated ${new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date())}`;
      if (hasConnected && added && announcer) announcer.textContent = `${added} new ${added === 1 ? "post" : "posts"} added to the feed.`;
      hasConnected = true;
    } catch {
      if (status) status.textContent = hasConnected ? "Live updates paused · retrying" : "Demo posts · live service unavailable";
      // Posts already on screen stay on screen; the error state is only for the
      // case where a reader would otherwise be staring at a skeleton forever.
      if (feed.getPosts().length === 0) feed.setState("error");
    }
  };

  await refresh();
  const timer = setInterval(refresh, REFRESH_INTERVAL);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
  globalThis.addEventListener?.("pagehide", () => clearInterval(timer), { once: true });
  document.documentElement.dataset.shiplogSocial = "ready";
}

init();
