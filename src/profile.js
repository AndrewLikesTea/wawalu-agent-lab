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
import { postDetailHref, profileHref } from "./social-links.js";
import { imageDescription, renderDescriptionNote, renderImageUnavailable } from "./image-description.js";
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
// finally to the landing name this feed suggests (defaultProfileAuthor below).
// `authors` is the last resort, for a feed that holds posts but no images.
export function resolveProfileAuthor({ param, stored, authors = [], preferred = null } = {}) {
  const requested = String(param ?? "").trim();
  if (requested && requested.length <= MAX_AUTHOR_LENGTH) return requested;
  const remembered = String(stored ?? "").trim();
  if (remembered && remembered.length <= MAX_AUTHOR_LENGTH) return remembered;
  // With no hint at all, a name that actually has image posts beats an empty
  // grid: this page is a wall of images, and landing on a blank one leaves a
  // first-time visitor unable to tell an empty feature from a wrong name.
  const landing = String(preferred ?? "").trim();
  if (landing) return landing;
  return authors[0] ?? DEFAULT_AUTHOR;
}

// Did anything actually ask for a name, or is this a first-time landing? The
// resolver above and the page wiring both need the answer — the wiring only
// re-picks a default for a visitor who never chose — and deriving it twice from
// the same two inputs is how the two would drift apart.
export function hasExplicitAuthor({ param, stored } = {}) {
  return [param, stored].some((value) => {
    const name = String(value ?? "").trim();
    return Boolean(name) && name.length <= MAX_AUTHOR_LENGTH;
  });
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

// How many image posts each display name has, in the picker's own order. Two
// things read it — the chip labels and the landing default — and they must
// agree, so both count with the same rule the grid renders by. Derived at
// render time from the posts in hand; nothing persists a count that could drift
// away from the rows underneath it.
export function imagePostCounts(posts) {
  return distinctAuthors(posts).map((name) => ({ name, images: selectProfilePosts(posts, name).length }));
}

// The name a visitor lands on when nothing else says whose posts to show. It is
// the name with the most image posts, ties broken by distinctAuthors order —
// deterministic, so the same feed always opens on the same view — and null when
// no display name has an image at all, which is the one case where the empty
// state is the honest answer rather than a wrong name.
export function defaultProfileAuthor(posts) {
  let best = null;
  for (const entry of imagePostCounts(posts)) {
    if (entry.images > 0 && (!best || entry.images > best.images)) best = entry;
  }
  return best?.name ?? null;
}

// The picker's three states in one place. `images: null` is the third one, and
// the reason it exists: a name whose posts have not been loaded yet is not a
// name with no posts, and a chip that prints "0 image posts" before the store
// has answered is a wrong count rather than a pending one.
export const COUNTING_LABEL = "Counting…";
// The mark on the chip that is currently showing. A word and a glyph, not a
// colour: it is the one difference between selected and unselected that
// survives greyscale, inversion, and forced colours. "Showing" is the verb the
// live region already uses for the same fact ("Showing 2 image posts by Zed"),
// so the picker and the announcement say it the same way.
export const SELECTED_MARK = "✓ Showing";

// What one entry in the picker reads. The count is part of the button's text —
// a button's accessible name is its text — so the picker says which names have
// something to show before a reader has to try them one by one, and a screen
// reader hears the count with the name rather than beside it. Same count
// phrasing and the same separator the rest of this page uses.
export function authorChipLabel(name, images, { selected = false } = {}) {
  const count = images === null || images === undefined ? COUNTING_LABEL : countLabel(images, "image post");
  return `${selected ? `${SELECTED_MARK} ` : ""}${name} · ${count}`;
}

// The rows the picker draws: every display name the loaded posts carry, plus
// the selected one when the store does not carry it yet, so the control never
// silently drops the name you are looking at. A name with no image posts stays
// in the list too — its count is what tells the reader it is empty, which is the
// whole reason the counts are here.
//
// Counts come from the same posts the grid renders from, through the same
// selector, so the number on a chip and the tiles below it cannot disagree.
export function pickerEntries(posts, author) {
  const counts = imagePostCounts(posts);
  const name = String(author ?? "").trim();
  return name && !counts.some((entry) => entry.name === name) ? [{ name, images: 0 }, ...counts] : counts;
}

// The caption a tile shows. An image post may carry a dedicated caption; a post
// that does not falls back to its body, so a tile is never captionless — which
// matters more than it looks, because the caption is also the tile's accessible
// name and its fallback when the image fails to load.
export function captionFor(post) {
  return post?.caption?.trim() || post?.body?.trim() || "";
}

// The permalink and People URL shapes moved to src/social-links.js when the
// composer's publish confirmation started building the same links: profile.js
// imports social.js, so social.js cannot import profile.js back. Re-exported
// here unchanged, because this module is where every existing caller asks for
// them and the shape is the same shape.
export { postDetailHref, profileHref };

// Paint is a separate, full-screen workspace. Carry the selected display name
// across that boundary so its back link can return to this exact profile rather
// than dropping a first-time visitor at a generic page.
export function profilePaintHref(author) {
  const params = new URLSearchParams({
    from: "profile",
    author: String(author ?? "").trim(),
  });
  return `/paint/?${params}`;
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

export function formatDate(iso) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
}

/* --------------------------- first-run copy ------------------------------- */

// The one place the empty profile's wording lives. Four spots on the page speak
// to this situation — the hero description, the heading count, the grid, and the
// live region — and when each held its own literal the page printed the same
// sentence twice while the grid said something else entirely.
//
// The terms are borrowed from the destination rather than invented here: Paint's
// primary action is "Use in post", so this copy says "image post" and "use it in
// a post", and it names Paint instead of gesturing at "the team feed".
//
// One message for every visitor, deliberately. This demo has no accounts, so an
// empty view you are only looking at and an empty view of your own are the same
// surface, and splitting the copy in two is what produced the duplication in the
// first place. If accounts ever arrive, branch here — not at four call sites.
export const PROFILE_EMPTY_COPY = {
  // The grid's empty state. The sentence says what fills this grid — both ends
  // of the path, in one telling — and the two buttons below it name the two
  // destinations. Splitting it that way is deliberate: when the sentence and the
  // buttons both spell out the instruction, the empty state repeats itself in
  // the space of three lines, which is the defect this copy exists to fix.
  guidance: "Images made in Paint and published on Social appear here.",
  actionLabel: "Create an image in Paint",
  postActionLabel: "See every post on Social",
  // Paint opens in a new tab from every route on this site, so the control that
  // takes it says so in the same five words the two authored links use. It is
  // part of the label rather than a title attribute: an accessible name that
  // stops at "Create an image in Paint" has not disclosed anything.
  newTabNote: "(opens in a new tab)",
};

// The identity line under the heading when the selected name has nothing to
// show. It names the person the page is already showing rather than the surface:
// "No image posts on People yet" read as if People itself were empty, which is
// never true — some other display name always has posts. Built from the same
// display name the heading renders, so it stays right for every one of them.
//
// The name is written through textContent everywhere it lands (the header, the
// live region), so an apostrophe in a name needs no escaping; nothing here is
// ever parsed as markup.
export function emptySummaryText(author) {
  const name = String(author ?? "").trim() || DEFAULT_AUTHOR;
  return `${name} hasn’t posted an image yet.`;
}

// What the identity line and the connection line say before anything has been
// counted. Both wait on the same fetch, so both say this word for word — and
// what they name is what People is actually fetching: the image posts published
// under the selected display name. They used to say "Loading the Social feed…",
// Social's sentence about the whole feed, three lines under People's own intro
// telling a reader to open Social when they want that feed — and it was the
// first thing a screen reader announced on this page.
//
// It still does not guess a count: the page ships this line as static markup for
// the frame before hydration, where it once shipped "Ari hasn't posted an image
// yet", a verdict that was false for the seeded feed.
//
// The name is written through textContent everywhere it lands, so an apostrophe
// inside a display name needs no escaping; nothing here is parsed as markup.
// With no name chosen the sentence drops the possessive rather than inventing
// one — the posts are still image posts, and this page still only shows the ones
// under a display name.
export function loadingSummaryText(author) {
  const name = String(author ?? "").trim();
  return name ? `Loading ${name}’s image posts…` : "Loading image posts…";
}

// The profile description under the name, and the one place on the page that
// states the image-post count. The results panel used to repeat it in a chip
// beside its heading, so an empty name printed "hasn't posted an image yet" and
// "0 image posts" on the same render, in two voices, one of them a bare number
// a first-time visitor could not tell from a broken feature.
//
// An author with posts but no images reads "0 image posts · 3 posts in total",
// so the counts carry the "you posted, just without pictures" case that the
// empty state used to spell out in prose.
export function profileSummaryText(summary, author) {
  if (summary.total === 0) return emptySummaryText(author);
  const parts = [countLabel(summary.withImages, "image post"), `${countLabel(summary.total, "post")} in total`];
  if (summary.latest) parts.push(`last posted ${formatDate(summary.latest)}`);
  return parts.join(" · ");
}

// The results panel's heading, and — because profile.html points that section's
// `aria-labelledby` at it — the panel's accessible name. It read "Image posts"
// in every state, so the region a reader lands in from Social's "Open People"
// pointer named neither the display name they picked nor how many pictures were
// under it, and a screen reader entering the region heard the same three
// syllables Social's own feed could have claimed.
//
// The count phrase is Social's, not a lookalike: its feed heading counts with
// `${shown} ${shown === 1 ? "post" : "posts"}` (feedHeading, src/social.js),
// which is what countLabel spells with this page's noun — so "1 image post" and
// "3 image posts" read the same way here, on the picker's chips, and in the live
// region. The separator is the middot the chips and the identity line already
// join their clauses with.
//
// A null count is the page not having counted yet, which is a different fact
// from a count of zero: the heading names the display name and the posts under
// it and stops, exactly as the picker says "Counting…" rather than "0".
export function profileResultsHeading(author, count = null) {
  const name = String(author ?? "").trim() || DEFAULT_AUTHOR;
  const counted = count === null || count === undefined ? "image posts" : countLabel(count, "image post");
  return `${name} · ${counted}`;
}

// What the live region announces after a refresh settles. It mirrors what the
// grid now shows rather than composing a fourth variant of the same news.
export function profileAnnouncement(author, visibleCount) {
  if (visibleCount > 0) return `Showing ${countLabel(visibleCount, "image post")} by ${author}.`;
  return `${emptySummaryText(author)} ${PROFILE_EMPTY_COPY.guidance}`;
}

/* ------------------------------ rendering layer --------------------------- */
// Everything below touches the DOM. Text is written via textContent only.

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// The tile image. Three states driven by one data attribute, so CSS owns the
// appearance and JS owns only the transition: loading reserves a square that
// cannot shift the grid, ready shows the image, error leaves the caption to
// carry the post on its own.
function renderTileMedia(image, description) {
  const frame = el("div", "profile-media");
  frame.dataset.state = "loading";

  const img = document.createElement("img");
  img.className = "profile-image";
  img.src = image.src;
  // A supplied alt always wins. A post that carries none is a row written
  // before a description was required, and the shared read-path fallback
  // (src/image-description.js — the same one the feed uses) still gives it a
  // real alt rather than the silence of alt="".
  img.alt = description.alt;
  img.loading = "lazy";
  img.decoding = "async";
  if (image.width && image.height) {
    img.width = image.width;
    img.height = image.height;
  }

  // A dead tile used to say "Image unavailable" and stop there, which told a
  // reader that something was missing without telling them what. The tile's
  // caption is the post's words, not the image's; the description is the only
  // thing that says what the picture was, so the placeholder keeps it.
  const fallback = renderImageUnavailable("profile-media-fallback", description.alt, { textClassName: "media-fallback-text" });
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
  link.href = postDetailHref(post.id, post.author, "profile");
  link.dataset.postId = post.id;

  const figure = el("figure", "profile-figure");
  const description = imageDescription(post);
  if (post.image) figure.append(renderTileMedia(post.image, description));

  const caption = el("figcaption", "profile-tile-caption", captionFor(post));
  // Ids are minted from the render index, never from post.id: a post id is
  // arbitrary text and must not be spliced into an id/IDREF list.
  caption.id = `profile-tile-${index}-caption`;
  figure.append(caption);
  // Beside the caption, not inside it: the tile is named by its caption alone,
  // and flagging a missing description must not rename the link.
  if (post.image && description.missing) figure.append(renderDescriptionNote());
  const destination = el("span", "profile-tile-link-label", "View full post on Social");
  link.append(figure);

  const meta = el("p", "profile-tile-meta");
  const time = el("time", "profile-tile-date", formatDate(post.createdAt));
  time.dateTime = post.createdAt;
  meta.append(time);
  meta.append(el("span", "profile-tile-stat", `${countLabel(post.likes, "like")} · ${countLabel(post.comments, "comment")}`));
  link.append(meta, destination);

  link.setAttribute("aria-label", `${captionFor(post)} — view full post on Social`);
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

// One paragraph and two distinct actions. The hero has already said the profile
// is empty, so this says what fills it and then separates the two things a
// reader can do about it: read the whole feed, or make an image for it. Paint is
// the primary and goes first, so the solid control and the first stop in reading
// and tab order are the same link; the way back to the whole feed is already a
// sentence in the hero. The secondary is outlined as well as second, so weight
// is not the only thing saying which is which.
function renderEmpty(container, author) {
  const empty = el("div", "empty-state");
  empty.append(el("p", "empty-title", PROFILE_EMPTY_COPY.guidance));
  const link = el("a", "empty-action", PROFILE_EMPTY_COPY.actionLabel);
  link.href = profilePaintHref(author);
  link.target = "_blank";
  link.rel = "noopener";
  link.append(el("span", "new-tab-note", ` ${PROFILE_EMPTY_COPY.newTabNote}`));
  const postLink = el("a", "empty-action empty-action-secondary",
    PROFILE_EMPTY_COPY.postActionLabel);
  postLink.href = "/social.html";
  const actions = el("div", "empty-actions");
  actions.append(link, postLink);
  empty.append(actions);
  container.append(empty);
}

function renderError(container, onRetry) {
  const failed = el("div", "empty-state empty-state-error");
  failed.append(el("p", "empty-title", "Image posts could not be loaded."));
  failed.append(el("p", undefined, "The connection to the Social feed behind People failed. Nothing was lost — try again."));
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
  const { state = "ready", onRetry = null, author = DEFAULT_AUTHOR } = options;
  const ordered = sortNewestFirst(posts ?? []);
  container.replaceChildren();
  container.setAttribute("aria-busy", state === "loading" && ordered.length === 0 ? "true" : "false");

  if (ordered.length === 0) {
    if (state === "loading") renderSkeleton(container);
    else if (state === "error") renderError(container, onRetry);
    else renderEmpty(container, author);
    return;
  }

  // `role="list"` is explicit because the grid drops list-style, which drops
  // list semantics in some Safari/VoiceOver combinations.
  const list = el("ul", "profile-grid");
  list.setAttribute("role", "list");
  ordered.forEach((post, index) => list.append(renderTile(post, index)));
  container.append(list);
}

// The display-name picker: one real <button> per name, in reading order. Tab
// reaches each of them and Space and Enter select, all from native button
// semantics rather than from a keydown handler this module would have to keep
// honest with the platform.
//
// Every chip wears the same treatment, selected or not. A display name is a
// static classification, and this site reserves a filled, changed chip for a
// live signal (design-system/claude-design/review-08-foundations.html); which
// one is showing is said in the button's own text instead. So the difference a
// reader sees is a glyph and a word, never a colour — and `aria-pressed` is
// written on every chip, "false" included, because a toggle that omits it on
// the unpressed ones reads as a plain button that happens to be pressed.
//
// `counted` is the store's own answer, not a guess: while it is false every
// chip says "Counting…" rather than claiming a number the posts have not
// supported yet.
export function renderAuthorPicker(container, entries, { author, counted = true, onSelect = null } = {}) {
  container.replaceChildren(...entries.map((entry) => {
    const selected = entry.name === author;
    const chip = el("button", "profile-filter-option", authorChipLabel(entry.name, counted ? entry.images : null, { selected }));
    chip.type = "button";
    chip.dataset.author = entry.name;
    chip.setAttribute("aria-pressed", selected ? "true" : "false");
    if (onSelect) chip.addEventListener("click", () => onSelect(entry.name));
    return chip;
  }));
}

// The identity block between the picker and the grid: avatar, name, and the
// counts that explain what the grid is showing, empty case included. The results
// heading below it states the selected name and the number of tiles it heads
// (profileResultsHeading); this line is where the image posts are put next to the
// posts in total and the last posting date, which is the context a bare count
// beside the heading cannot carry.
export function renderProfileHeader(elements, author, summary) {
  if (elements.avatar) {
    elements.avatar.textContent = authorInitials(author);
    elements.avatar.setAttribute("aria-hidden", "true");
  }
  if (elements.name) elements.name.textContent = `Active display-name filter: ${author}`;
  if (elements.roleName) elements.roleName.textContent = author;
  if (elements.summary) elements.summary.textContent = profileSummaryText(summary, author);
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
    roleName: root.querySelector("#profile-role-name"),
    summary: root.querySelector("#profile-summary"),
    heading: root.querySelector("#grid-title"),
    status: root.querySelector("#profile-status"),
    announcer: root.querySelector("#profile-announcer"),
    picker: root.querySelector("#profile-author"),
    // The one route into Paint: the invitation above the grid. It is a real
    // anchor in the markup and stays one whether or not this runs; all that is
    // added here is the display name, so Paint's back link returns to the
    // profile that was actually being read rather than the default display
    // name. The hero used to carry a second copy of the same offer, four words
    // and one label identical to this one.
    paintRoutes: [root.querySelector("#profile-paint-route")].filter(Boolean),
  };

  let posts = options.posts ?? [];
  let state = options.state ?? "ready";
  let author = options.author ?? DEFAULT_AUTHOR;

  const render = () => {
    const mine = selectProfilePosts(posts, author);
    const summary = profileSummary(posts, author);
    renderProfileHeader(elements, author, summary);
    // The heading is written from `mine`, the same array the tiles are rendered
    // from three lines below, in this one update — so the name it states and the
    // number it states are the name and the number on screen, and neither can
    // move without the other.
    //
    // A number only where the page has a settled answer behind it: a finished
    // load, or, after a failed refresh, the tiles still on screen from the last
    // one. While the first load is in flight there is nothing to count — the
    // picker says "Counting…" in that frame, and a heading claiming a number
    // beside it would contradict it — and a failed load with an empty grid
    // states no zero it cannot support.
    if (elements.heading) {
      const counted = state === "ready" || (state === "error" && mine.length > 0);
      elements.heading.textContent = profileResultsHeading(author, counted ? mine.length : null);
    }
    // The connection line is a placeholder until the first fetch answers and
    // profile-page.js writes the real one over it. While that is in flight it
    // names the wait the same way the identity line ships it in markup, from the
    // display name in hand — so a reader who switches names mid-load is not left
    // reading the name the page happened to ship with.
    if (elements.status && state === "loading") elements.status.textContent = loadingSummaryText(author);
    for (const route of elements.paintRoutes) route.href = profilePaintHref(author);
    renderProfileGrid(grid, mine, {
      state,
      onRetry: options.onRetry,
      author,
    });
    if (elements.announcer && state === "ready") {
      elements.announcer.textContent = profileAnnouncement(author, mine.length);
    }
    if (options.onRender) options.onRender({ author, posts: mine, summary });
  };

  const renderPicker = ({ refocus = false } = {}) => {
    if (!elements.picker) return;
    renderAuthorPicker(elements.picker, pickerEntries(posts, author), {
      author,
      // "loading" is the store not having answered yet, which is a different
      // fact from its answer being zero. Seeded posts are already on screen in
      // that state, so the chips must not turn a partial feed into a count.
      counted: state !== "loading",
      onSelect: choose,
    });
    // Selecting rebuilds the chips, so the button that was just pressed is
    // gone. Focus its replacement, or a keyboard reader is dropped back to the
    // top of the document after every choice.
    if (refocus) elements.picker.querySelector('[aria-pressed="true"]')?.focus();
  };

  function choose(next) {
    if (next === author) return;
    author = next;
    options.onAuthorChange?.(next);
    renderPicker({ refocus: true });
    render();
  }

  renderPicker();
  render();

  return {
    render,
    getAuthor() { return author; },
    setAuthor(next) { author = next; renderPicker(); render(); },
    seed(next) { posts = next ?? []; state = "ready"; renderPicker(); render(); },
    // Loading and error are display states only: they never discard posts
    // already on screen, so a failed refresh degrades to "stale but readable".
    // The picker re-renders too, because leaving "loading" is exactly what
    // turns "Counting…" into a number.
    setState(next) { state = next; renderPicker(); render(); },
    setStatus(text) { if (elements.status) elements.status.textContent = text; },
    getPosts() { return [...posts]; },
  };
}
