// Profile view: one author's image posts as a grid of linked tiles.
//
// Same shape as the rest of Shiplog — a pure, DOM-free core (normalization,
// selection, summary math, link building) that `node --test` covers without a
// browser, plus a rendering layer that turns posts into accessible DOM. Data
// sourcing lives in profile-page.js so this module stays testable in isolation.
//
// Demo only (PRODUCT.md): posts come from the shared demo feed and a static
// seed. No customer data, cookies, credentials, or internal APIs are involved,
// and every field is written through textContent — never an HTML string — so a
// caption can never execute markup.
//
// Two deliberate interaction decisions, both different from the social feed:
//
//   1. A tile is a link, not a focusable article. The feed's cards are prose you
//      read in place, so they use roving focus and Enter does nothing. A profile
//      tile's entire job is to go somewhere, so it is an <a>: every tile is a
//      real tab stop with native Enter, middle-click, and open-in-new-tab
//      behaviour that no keydown handler reproduces faithfully.
//   2. The tile's accessible name is the caption alone (aria-labelledby), not
//      the image alt plus the caption plus the counts. In a link list, "Focus
//      rings landed everywhere" is a usable name; the alt text is still exposed
//      on the image inside the link when the tile is read rather than listed.

import { normalizeImage } from "./social.js";
import { DEFAULT_AUTHOR, MAX_AUTHOR_LENGTH } from "./social-identity.js";

export const MAX_CAPTION_LENGTH = 280;

/* -------------------------------- pure core ------------------------------- */

// The public read model of src/social-posts-api.js, narrowed to what the grid
// draws. A post that fails validation is dropped rather than rendered half-formed
// — this view is a wall of images, and one malformed row must not take the wall
// down with it.
export function normalizeProfileApiPosts(payload) {
  if (!Array.isArray(payload?.posts)) return [];
  return payload.posts.flatMap((post) => {
    if (!isRenderablePost(post?.id, post?.author, post?.content, post?.timestamp)) return [];
    const normalized = {
      id: post.id,
      author: post.author.trim(),
      body: post.content.trim(),
      caption: typeof post.caption === "string" && post.caption.trim() ? post.caption.trim().slice(0, MAX_CAPTION_LENGTH) : null,
      createdAt: post.timestamp,
      likes: countOf(post.like_count),
      comments: countOf(post.comment_count),
    };
    const image = normalizeImage({ src: post.image_url, alt: post.image_alt, width: post.image_width, height: post.image_height });
    if (image) normalized.image = image;
    return [normalized];
  });
}

// The static seed (src/social-demo-data.json) already uses the feed's internal
// shape, so it only needs the same validation gate, not a second translation.
export function normalizeSeedPosts(list) {
  if (!Array.isArray(list)) return [];
  return list.flatMap((post) => {
    if (!isRenderablePost(post?.id, post?.author, post?.body, post?.createdAt)) return [];
    const normalized = {
      id: post.id,
      author: post.author.trim(),
      body: post.body.trim(),
      caption: typeof post.caption === "string" && post.caption.trim() ? post.caption.trim().slice(0, MAX_CAPTION_LENGTH) : null,
      createdAt: post.createdAt,
      likes: countOf(post.likes),
      comments: countOf(post.comments),
    };
    const image = normalizeImage(post.image);
    if (image) normalized.image = image;
    return [normalized];
  });
}

function isRenderablePost(id, author, body, createdAt) {
  return typeof id === "string" && Boolean(id.trim())
    && typeof author === "string" && Boolean(author.trim()) && author.trim().length <= MAX_AUTHOR_LENGTH
    && typeof body === "string" && Boolean(body.trim())
    && typeof createdAt === "string" && !Number.isNaN(Date.parse(createdAt));
}

function countOf(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

// Earlier lists win, so live posts shadow a seed entry with the same id instead
// of the profile showing one post twice.
export function mergePostsById(...lists) {
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    for (const post of list ?? []) {
      if (!post || seen.has(post.id)) continue;
      seen.add(post.id);
      merged.push(post);
    }
  }
  return merged;
}

// Whose profile this is. An explicit ?author= wins so a profile is linkable and
// shareable; otherwise it falls back to the name this browser posts under, and
// finally to the same default byline the compose form uses.
export function resolveProfileAuthor({ param, stored, authors = [] } = {}) {
  const requested = String(param ?? "").trim();
  if (requested && requested.length <= MAX_AUTHOR_LENGTH) return requested;
  const remembered = String(stored ?? "").trim();
  if (remembered && remembered.length <= MAX_AUTHOR_LENGTH) return remembered;
  // With no hint at all, an author who actually has posts beats an empty
  // profile for the default name.
  return authors[0] ?? DEFAULT_AUTHOR;
}

export function sortNewestFirst(posts) {
  return [...posts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

// The grid is image-first by definition, so `imagesOnly` is the default. Author
// matching is exact: display names are the only handle this demo has, and a
// fuzzy match would silently pool two different people's posts.
export function selectProfilePosts(posts, author, { imagesOnly = true } = {}) {
  const name = String(author ?? "").trim();
  if (!name) return [];
  return sortNewestFirst((posts ?? []).filter((post) => post
    && post.author === name
    && (!imagesOnly || Boolean(post.image))));
}

// Header counts. `withImages` is reported next to `total` on purpose: it is the
// only thing that explains an empty grid belonging to an author who has posted.
export function profileSummary(posts, author) {
  const mine = selectProfilePosts(posts, author, { imagesOnly: false });
  const withImages = mine.filter((post) => Boolean(post.image));
  return {
    total: mine.length,
    withImages: withImages.length,
    likes: mine.reduce((sum, post) => sum + post.likes, 0),
    latest: mine[0]?.createdAt ?? null,
  };
}

export function distinctAuthors(posts) {
  return [...new Set((posts ?? []).filter(Boolean).map((post) => post.author))]
    .sort((a, b) => a.localeCompare(b));
}

// The caption a tile shows. An image post may carry a dedicated caption; a post
// that does not falls back to its body, so a tile is never captionless — which
// matters more than it looks, because the caption is also the tile's accessible
// name and its fallback when the image fails to load.
export function captionFor(post) {
  return post?.caption?.trim() || post?.body?.trim() || "";
}

export function postDetailHref(id) {
  return `/post.html?id=${encodeURIComponent(String(id ?? ""))}`;
}

export function profileHref(author) {
  return `/profile.html?author=${encodeURIComponent(String(author ?? ""))}`;
}

// Two letters for the avatar chip. Decorative only — the name is always present
// as text beside it.
export function authorInitials(author) {
  const parts = String(author ?? "").trim().split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? "").slice(0, 2);
  return letters.toUpperCase() || "?";
}

export function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

const EMPTY_PROFILE_MESSAGE = "You haven’t posted anything yet. Start by sharing an image.";

/* ------------------------------ rendering layer --------------------------- */
// Everything below touches the DOM. Text is written via textContent only.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function formatDate(iso) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
}

// The tile image. Three states driven by one data attribute, so CSS owns the
// appearance and JS owns only the transition: loading reserves a square that
// cannot shift the grid, ready shows the image, error leaves the caption to
// carry the post on its own.
function renderTileMedia(image) {
  const frame = el("div", "profile-media");
  frame.dataset.state = "loading";

  const img = document.createElement("img");
  img.className = "profile-image";
  img.src = image.src;
  // A supplied alt always wins. Without one the image is marked decorative on
  // purpose: it sits in a <figure> whose <figcaption> is right there, so reading
  // out a storage path would be strictly worse than silence.
  img.alt = image.alt;
  img.loading = "lazy";
  img.decoding = "async";
  if (image.width && image.height) {
    img.width = image.width;
    img.height = image.height;
  }

  const fallback = el("span", "profile-media-fallback", "Image unavailable");
  fallback.hidden = true;

  const settle = (state) => {
    frame.dataset.state = state;
    fallback.hidden = state !== "error";
    if (state === "error") img.remove();
  };
  img.addEventListener("load", () => settle("ready"), { once: true });
  img.addEventListener("error", () => settle("error"), { once: true });
  // A cached image can already be decoded before those listeners attach.
  if (img.complete) settle(img.naturalWidth > 0 ? "ready" : "error");

  frame.append(img, fallback);
  return frame;
}

function renderTile(post, index) {
  const item = el("li", "profile-cell");
  const link = el("a", "profile-tile");
  link.href = postDetailHref(post.id);
  link.dataset.postId = post.id;

  const figure = el("figure", "profile-figure");
  if (post.image) figure.append(renderTileMedia(post.image));

  const caption = el("figcaption", "profile-tile-caption", captionFor(post));
  // Ids are minted from the render index, never from post.id: a post id is
  // arbitrary text and must not be spliced into an id/IDREF list.
  caption.id = `profile-tile-${index}-caption`;
  figure.append(caption);
  link.append(figure);

  const meta = el("p", "profile-tile-meta");
  const time = el("time", "profile-tile-date", formatDate(post.createdAt));
  time.dateTime = post.createdAt;
  meta.append(time);
  meta.append(el("span", "profile-tile-stat", `${countLabel(post.likes, "like")} · ${countLabel(post.comments, "comment")}`));
  link.append(meta);

  // Name the link by its caption alone; the date and counts are decoration for
  // a link list, and the image alt is still read inside the link.
  link.setAttribute("aria-labelledby", caption.id);
  item.append(link);
  return item;
}

// First-load placeholders. Hidden from assistive tech because the live region on
// the page announces the real status; a shimmering box announces nothing.
function renderSkeleton(container, count = 6) {
  const list = el("ul", "profile-grid profile-grid-skeleton");
  list.setAttribute("role", "list");
  list.setAttribute("aria-hidden", "true");
  for (let index = 0; index < count; index += 1) {
    const item = el("li", "profile-cell");
    const tile = el("div", "profile-tile profile-tile-skeleton");
    tile.append(el("div", "skeleton-media skeleton-media-square"), el("div", "skeleton-line"), el("div", "skeleton-line skeleton-line-short"));
    item.append(tile);
    list.append(item);
  }
  container.append(list);
}

function renderEmpty(container, { author, hasTextPosts }) {
  const empty = el("div", "empty-state");
  empty.append(el("p", "empty-title", hasTextPosts ? "No image posts yet." : EMPTY_PROFILE_MESSAGE));
  // The two empty states are genuinely different situations, and telling them
  // apart is the difference between "you posted, just without pictures" and
  // "this profile is blank".
  empty.append(el("p", undefined, hasTextPosts
    ? `${author} has posted, but none of those posts carry an image. Posts with an image appear here.`
    : "Share a post with an image on the team feed and it will appear here."));
  const link = el("a", "empty-action", "Share your first post");
  link.href = "/social.html";
  empty.append(link);
  container.append(empty);
}

function renderError(container, onRetry) {
  const failed = el("div", "empty-state empty-state-error");
  failed.append(el("p", "empty-title", "Posts could not be loaded."));
  failed.append(el("p", undefined, "The connection to the feed failed. Nothing was lost — try again."));
  const retry = el("button", "empty-action", "Try again");
  retry.type = "button";
  if (onRetry) retry.addEventListener("click", onRetry);
  failed.append(retry);
  container.append(failed);
}

// `state` keeps three situations apart that must never share one empty state:
// still loading, loaded and genuinely empty, and failed. Posts already on screen
// always win over a pending or failed refresh — stale content beats a spinner
// over content the reader could already see.
export function renderProfileGrid(container, posts, options = {}) {
  const { state = "ready", author = "", hasTextPosts = false, onRetry = null } = options;
  const ordered = sortNewestFirst(posts ?? []);
  container.replaceChildren();
  container.setAttribute("aria-busy", state === "loading" && ordered.length === 0 ? "true" : "false");

  if (ordered.length === 0) {
    if (state === "loading") renderSkeleton(container);
    else if (state === "error") renderError(container, onRetry);
    else renderEmpty(container, { author, hasTextPosts });
    return;
  }

  // `role="list"` is explicit because the grid drops list-style, which drops
  // list semantics in some Safari/VoiceOver combinations.
  const list = el("ul", "profile-grid");
  list.setAttribute("role", "list");
  ordered.forEach((post, index) => list.append(renderTile(post, index)));
  container.append(list);
}

// The identity block above the grid: avatar, name, and the counts that explain
// what the grid is showing.
export function renderProfileHeader(elements, author, summary) {
  if (elements.avatar) {
    elements.avatar.textContent = authorInitials(author);
    elements.avatar.setAttribute("aria-hidden", "true");
  }
  if (elements.name) elements.name.textContent = author;
  if (elements.summary) {
    if (summary.total === 0) {
      elements.summary.textContent = EMPTY_PROFILE_MESSAGE;
      return;
    }
    const parts = [countLabel(summary.withImages, "image post"), `${countLabel(summary.total, "post")} in total`];
    if (summary.latest) parts.push(`last posted ${formatDate(summary.latest)}`);
    elements.summary.textContent = parts.join(" · ");
  }
}

/* -------------------------------- mounting -------------------------------- */

// Wires the page: header, author switcher, grid, and the announcements that make
// an async refresh legible to a screen reader. Returns a small API so the data
// layer can seed and re-state without knowing any of the DOM.
export function mountProfile(root, options = {}) {
  const grid = root.querySelector("#profile-grid");
  if (!grid) return null;

  const elements = {
    avatar: root.querySelector("#profile-avatar"),
    name: root.querySelector("#profile-name"),
    summary: root.querySelector("#profile-summary"),
    status: root.querySelector("#profile-status"),
    announcer: root.querySelector("#profile-announcer"),
    picker: root.querySelector("#profile-author"),
    count: root.querySelector("#profile-count"),
  };

  let posts = options.posts ?? [];
  let state = options.state ?? "ready";
  let author = options.author ?? DEFAULT_AUTHOR;

  const render = () => {
    const mine = selectProfilePosts(posts, author);
    const summary = profileSummary(posts, author);
    renderProfileHeader(elements, author, summary);
    renderProfileGrid(grid, mine, {
      state,
      author,
      hasTextPosts: summary.total > summary.withImages,
      onRetry: options.onRetry,
    });
    if (elements.count) {
      elements.count.textContent = summary.total === 0
        ? EMPTY_PROFILE_MESSAGE
        : countLabel(mine.length, "image post");
    }
    if (elements.announcer && state === "ready") {
      elements.announcer.textContent = mine.length
        ? `Showing ${countLabel(mine.length, "image post")} by ${author}.`
        : summary.total === 0
          ? EMPTY_PROFILE_MESSAGE
          : `${author} has no image posts yet.`;
    }
    if (options.onRender) options.onRender({ author, posts: mine, summary });
  };

  const renderPicker = () => {
    if (!elements.picker) return;
    const authors = distinctAuthors(posts);
    // The current author stays selectable even with nothing in the feed yet, so
    // the control never silently drops the profile you are looking at.
    const names = authors.includes(author) ? authors : [author, ...authors];
    elements.picker.replaceChildren(...names.map((name) => new Option(name, name)));
    elements.picker.value = author;
  };

  elements.picker?.addEventListener("change", () => {
    author = elements.picker.value;
    options.onAuthorChange?.(author);
    render();
  });

  renderPicker();
  render();

  return {
    render,
    getAuthor() { return author; },
    setAuthor(next) { author = next; renderPicker(); render(); },
    seed(next) { posts = next ?? []; state = "ready"; renderPicker(); render(); },
    // Loading and error are display states only: they never discard posts
    // already on screen, so a failed refresh degrades to "stale but readable".
    setState(next) { state = next; render(); },
    setStatus(text) { if (elements.status) elements.status.textContent = text; },
    getPosts() { return [...posts]; },
  };
}
