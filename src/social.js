// Social feed view component (demo only).
//
// Structured like releases.js and app.js: a pure, DOM-free core (validation,
// normalization, ordering, character-budget math, focus math) that is unit
// tested without a browser, plus a thin rendering layer that turns posts into
// accessible DOM. Data sourcing (durable API + demo seed) lives in social-page.js
// so this module stays reusable and testable in isolation.
//
// Demo-only, by design (PRODUCT.md): posts come from the shared backend with a
// static seed fallback. No customer data, cookies, credentials,
// or internal APIs are read or written, and — like the rest of Shiplog — every
// field is written through textContent / text nodes, never HTML strings, so a
// post body can never execute markup.
//
// Posts may carry an image, which renders as a <figure> tile with the post body
// as its <figcaption>. Images are optional and never load-bearing: an absent,
// rejected, or broken image degrades to a caption-only card. Sources are
// restricted to same-origin asset paths — see normalizeImage.

// The author-name rules live in social-identity.js, which is also what the
// profile view reads, and are re-exported here so this module stays the feed's
// single import. One owner, so the byline the feed accepts and the byline the
// profile remembers cannot drift apart.
import { DEFAULT_AUTHOR, MAX_AUTHOR_LENGTH, readStoredAuthor, rememberAuthor } from "./social-identity.js";
import { imageDescription, renderDescriptionNote, renderImageUnavailable } from "./image-description.js";
import { postDetailHref, profileHref } from "./social-links.js";
import { renderState } from "./state-ui.js";

export { DEFAULT_AUTHOR, MAX_AUTHOR_LENGTH };

// A single, classic short-post budget. Enforced in three places that must agree:
// the textarea `maxlength`, the live counter, and createPost's validation.
export const MAX_POST_LENGTH = 280;
export const MAX_IMAGE_ALT_LENGTH = 200;

// Normalize + validate a post from raw form values. Body is required and must
// fit the budget; author is optional and falls back to DEFAULT_AUTHOR. Throws
// on an empty or over-budget body so bad state never reaches storage.
export function createPost(values, options = {}) {
  const body = String(values.body ?? "").trim();
  const author = String(values.author ?? "").trim() || DEFAULT_AUTHOR;

  if (!body) {
    // Surfaced in the composer's notice, so it names the field the way the
    // field's own label does: "Caption", not a second word for it.
    throw new TypeError("A post requires a caption.");
  }
  if (body.length > MAX_POST_LENGTH) {
    throw new TypeError(`A post must be ${MAX_POST_LENGTH} characters or fewer.`);
  }
  if (author.length > MAX_AUTHOR_LENGTH) {
    // Surfaced in the composer's notice, so it names the field the way the
    // field's own label does: "Display name", not a second word for it.
    throw new TypeError(`A display name must be ${MAX_AUTHOR_LENGTH} characters or fewer.`);
  }

  return {
    id: options.id ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    author,
    body,
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
}

// The id of the composer's image-description error, referenced from the
// description input's aria-describedby while the error is showing.
export const IMAGE_DESCRIPTION_ERROR_ID = "post-image-alt-error";

// Submit-time validation of the image description, deliberately independent of
// the textarea's `maxlength`: the attribute stops a key press, this stops a
// value that arrived any other way — a paste, a Paint handoff, a restored
// draft — and it is the check that actually decides whether a post is created.
// Nothing is required of a post that carries no image.
export function imageDescriptionProblem(value, { attached = false } = {}) {
  if (!attached) return null;
  const text = String(value ?? "").trim();
  if (!text) {
    return "Add a description of the image before posting, so people who cannot see it still get the post.";
  }
  if (text.length > MAX_IMAGE_ALT_LENGTH) {
    return `An image description must be ${MAX_IMAGE_ALT_LENGTH} characters or fewer. Remove ${text.length - MAX_IMAGE_ALT_LENGTH}.`;
  }
  return null;
}

// Reverse chronological order (newest first). Never mutates the input; ties fall
// back to input order via JS sort stability.
export function sortPostsNewestFirst(posts) {
  return [...posts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export const TIME_RANGES = Object.freeze({ hour: 60 * 60 * 1000, day: 24 * 60 * 60 * 1000, week: 7 * 24 * 60 * 60 * 1000 });

// Whether one post survives the two feed filters. Factored out of filterPosts
// because the composer's publish confirmation has to answer "is the post I just
// published on screen?" and there must be exactly one answer to that: the feed
// renders from this predicate and the confirmation asks this predicate. A second
// copy of the rule would drift, and the drift would show as a confirmation
// promising a card that is not there.
export function postMatchesFilters(post, { author = "all", range = "all", now = Date.now() } = {}) {
  if (author && author !== "all" && post?.author !== author) return false;
  const cutoff = TIME_RANGES[range] ? now - TIME_RANGES[range] : null;
  return cutoff === null || Date.parse(post?.createdAt) >= cutoff;
}

export function filterPosts(posts, { author = "all", range = "all", now = Date.now() } = {}) {
  return sortPostsNewestFirst(posts).filter((post) => postMatchesFilters(post, { author, range, now }));
}

// The one term this site uses for the name a post is published under. The
// composer's field hint, People's picker, and the feed's own filter label all
// say "display name", so the sentence above the feed says it too rather than
// introducing a second word for the same thing.
export const AUTHOR_TERM = "display name";

// The heading above the post list. It read "All posts" in every state, so a
// reader who narrowed the feed to one display name, or to the past hour, still
// met a heading claiming every post was below it — and the heading is the
// accessible name of the whole feed panel, so that claim was also what a screen
// reader announced on entering the region.
//
// It names what the current filters are showing and how many posts matched, in
// the same words the controls use: the time clause is the time menu's own option
// text, and the name clause uses AUTHOR_TERM, so the heading, the note under
// Clear filters, and the sentence above the cards cannot drift apart.
//
// A noun phrase, not a sentence — it is a heading, and the summary below it is
// where the full sentence lives. "All" survives only where it is true and reads:
// with one post there is nothing to be "all" of, and with none the heading says
// so in the same words the empty panel does.
//
// `shown` is the length of the array the cards are rendered from, never a second
// filter pass, which is what keeps the stated count and the visible cards the
// same number.
export const DEFAULT_FEED_HEADING = "All posts";

export function feedHeading({ shown = 0, range = "", author = "" } = {}) {
  const clauses = [range, author ? `under the ${AUTHOR_TERM} ${author}` : ""].filter(Boolean).join(" ");
  const counted = shown === 0 ? "No posts" : `${shown} ${shown === 1 ? "post" : "posts"}`;
  if (!clauses) return shown > 1 ? `All ${shown} posts` : counted;
  return `${counted} ${clauses}`;
}

// The sentence above the post list: how many posts are on screen, out of how
// many the feed holds, and which filters produced that number. Pure so the
// wording is tested without a browser; the caller supplies `range` and `author`
// as the *rendered* option text of the two filter controls, so the sentence and
// the closed menus cannot drift apart.
//
// `shown` is the length of the array the cards are rendered from — never a
// second filter pass — which is what keeps the stated count and the visible
// cards the same number, and `total` is the unfiltered feed, so a narrowed feed
// says what it is narrowed *from*. Without that denominator "Showing 2 posts"
// and "Showing all 2 posts" are the same sentence to a reader who cannot see
// the menus above it.
//
// An unfiltered, genuinely empty feed returns "": that is the never-posted
// state, which the empty panel already owns and says more usefully than a
// sentence counting to zero would. A filtered feed that matched nothing does
// state its zero — the number is the news — and the recovery lives in the
// no-match panel below, which owns a control that can act on it.
export function feedSummarySentence({ shown = 0, total = shown, range = "", author = "" } = {}) {
  const clauses = [range, author ? `under the ${AUTHOR_TERM} ${author}` : ""].filter(Boolean).join(" ");

  if (!clauses) {
    if (shown === 0) return "";
    return shown === 1 ? "Showing 1 post, newest first." : `Showing all ${shown} posts, newest first.`;
  }
  return `Showing ${shown} of ${total} ${total === 1 ? "post" : "posts"} ${clauses}.`;
}

// The two lines of the no-match dead end. A filter combination that matches
// nothing used to render the never-posted panel — "No posts on Social yet." —
// which told a reader the feed was empty when in fact it was full and their own
// two menus were hiding it. These say the opposite, in the menus' own words:
// what excluded the posts, and how many are waiting behind the filters.
//
// The filters are listed after a colon, joined with "·", rather than folded
// into prose: this is a list of what is currently set, in the menus' own option
// text, and the colon is what keeps it a sentence when only one of the two is
// set — "No posts match from the past hour" is not English.
export function noMatchMessage({ range = "", author = "" } = {}) {
  const named = [author, range].filter(Boolean).join(" · ");
  return named ? `No posts match these filters: ${named}.` : "No posts match these filters.";
}

export function noMatchGuidance(total = 0) {
  return `Social still holds ${total} ${total === 1 ? "post" : "posts"}. Clear the filters to read them.`;
}

export const CLEAR_FILTERS_LABEL = "Clear filters";

// ---------------------------------------------------------------------------
// The publish confirmation's words. Pure, so the sentence a reader hears after
// publishing is tested without a browser.
//
// The confirmation names the post rather than saying "post published": a reader
// who publishes twice in a row, or who publishes while a filter is on, needs to
// know WHICH post landed. The caption is the only name a post has, so it is the
// name, quoted and shortened to a scannable opening rather than repeated whole.
// ---------------------------------------------------------------------------
const MAX_CONFIRMED_CAPTION = 60;

export function publishedPostLabel({ body = "", author = "" } = {}) {
  const caption = String(body ?? "").trim().replace(/\s+/g, " ");
  const short = caption.length > MAX_CONFIRMED_CAPTION
    ? `${caption.slice(0, MAX_CONFIRMED_CAPTION - 1).trimEnd()}…`
    : caption;
  return `Published “${short}” as ${author}.`;
}

// Two live states, two words, both carried by the label rather than by the wash
// behind it: blue on this site is already both a series hue and the selection
// accent, so a state told in colour alone is told in a colour that means three
// other things. The chips are the shipped detail-state chips — a filled wash, as
// the design system requires of a state that is happening now, and no new custom
// property or palette entry.
export const PUBLISH_STATE_WORDS = Object.freeze({ filtered: "Hidden by filters", failed: "Not published" });
export const FILTERED_OUT_NOTE = "Your current filters hide this post from the feed below.";
export const REVEAL_CONTROL_LABEL = "Clear filters and show this post";
export const NO_IMAGE_NOTE = "This post carries no image, so it appears on Social only.";
export const PUBLISH_FAILED_NOTE = "Your caption, image, and image description are still in the composer, exactly as you left them.";

// The label said "(required with an image)" and nothing said what the
// requirement does, so the one refusal that is entirely this page's own — the
// browser has no opinion about this field — happened without being announced.
// Written in the caption hint's sentence, clause for clause: what stops, what is
// asked of you, and that nothing is published. The two now read alike, so a
// reader who has met one already knows the shape of the other.
//
// Only the empty case reaches the notice. An over-long description has been
// announcing itself the whole time it was being typed — the field's own counter
// is a live region counting down past zero — so repeating it here would be the
// second telling of news the reader already has.
export const IMAGE_DESCRIPTION_REFUSAL_NOTE = "Publish post stops on an empty image description — this form asks you to describe the image, and nothing is published.";

export function normalizeApiPosts(payload) {
  if (!Array.isArray(payload?.posts)) return [];
  return payload.posts.flatMap((post) => {
    if (!post || typeof post.id !== "string" || !post.id.trim()
      || typeof post.author_id !== "string" || !post.author_id.trim()
      || typeof post.agent_name !== "string" || !post.agent_name.trim()
      || typeof post.title !== "string" || !post.title.trim()
      || typeof post.content !== "string" || !post.content.trim() || post.content.length > 10000
      || typeof post.created_at !== "string" || Number.isNaN(Date.parse(post.created_at))) return [];
    const normalized = {
      id: post?.id,
      author: post?.agent_name,
      title: post?.title,
      body: post?.content,
      createdAt: post?.created_at,
    };
    return [normalized];
  });
}

export function normalizeSocialApiPosts(payload) {
  if (!Array.isArray(payload?.posts)) return [];
  return payload.posts.flatMap((post) => {
    if (!post || typeof post.id !== "string" || !post.id.trim()
      || typeof post.author !== "string" || !post.author.trim() || post.author.length > MAX_AUTHOR_LENGTH
      || typeof post.content !== "string" || !post.content.trim() || post.content.length > MAX_POST_LENGTH
      || typeof post.timestamp !== "string" || Number.isNaN(Date.parse(post.timestamp))
      || typeof post.source !== "string" || !post.source.trim()) return [];
    const normalized = { id: post.id, author: post.author, body: post.content, createdAt: post.timestamp, source: post.source };
    // An image is optional and *never* load-bearing: a post whose image fails
    // validation still renders as a caption-only card rather than disappearing.
    const image = normalizeImage(readImageFields(post));
    if (image) normalized.image = image;
    return [normalized];
  });
}

// The durable API is text-only today (migrations/0003_social_posts.sql). These
// readers accept both the nested `image` object the demo seed uses and the flat
// `image_*` columns the API would most likely grow, so the feed can display
// image posts the moment either shape starts arriving.
function readImageFields(post) {
  if (post.image && typeof post.image === "object") return post.image;
  return { src: post.image_url, alt: post.image_alt, width: post.image_width, height: post.image_height };
}

// Only same-origin, root-relative asset paths are renderable. The site ships
// `img-src 'self' data:` (src/_headers), so a remote URL would be blocked at
// load time anyway — and accepting one would let a post turn every reader's
// browser into a third-party request. Rejecting here keeps the failure visible
// in one place instead of as a silent console error per card.
export function normalizeImage(raw) {
  if (!raw || typeof raw !== "object") return null;
  const src = typeof raw.src === "string" ? raw.src.trim() : "";
  if (!isSameOriginAssetPath(src)) return null;

  const image = { src, alt: typeof raw.alt === "string" ? raw.alt.trim().slice(0, MAX_IMAGE_ALT_LENGTH) : "" };
  // Intrinsic dimensions are optional but reserve layout space when present, so
  // a slow image cannot shove the caption below it down the page.
  const width = positiveInteger(raw.width);
  const height = positiveInteger(raw.height);
  if (width && height) Object.assign(image, { width, height });
  return image;
}

function positiveInteger(value) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isInteger(number) && number > 0 && number <= 20000 ? number : null;
}

// A single leading slash, then a conservative path alphabet. This rejects
// protocol-relative "//host/x.png", any scheme (http:, data:, javascript:),
// backslashes, whitespace, control characters, and "../" traversal.
function isSameOriginAssetPath(value) {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (value.includes("..")) return false;
  return /^\/[A-Za-z0-9._~\-/]+$/.test(value);
}

// Character-budget state for the live counter. `remaining` can go negative so
// the UI can warn before createPost/maxlength would hard-stop the input.
export function counterState(text, max = MAX_POST_LENGTH) {
  const length = String(text ?? "").length;
  const remaining = max - length;
  return {
    length,
    remaining,
    empty: length === 0,
    over: remaining < 0,
    // "Near" the limit: last ~10% of the budget, so the counter can escalate
    // visually before the user hits the wall.
    near: remaining >= 0 && remaining <= Math.ceil(max * 0.1),
  };
}

// Roving-focus math for reading the feed. Posts are non-interactive <article>s,
// so — like the release headers — Enter is NOT a navigation key; only arrows and
// Home/End move focus, clamping at the ends (no wrap).
//
// The feed is a grid, so left/right step one card and up/down step one *row*.
// `columns` is measured from the rendered layout (see visibleColumnCount), which
// is what keeps the keyboard model honest as the grid reflows from one column on
// a phone to several on a desktop. It defaults to 1 so a single-column feed
// behaves exactly like the previous list.
const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"]);

export function nextFocusIndex(current, key, length, columns = 1) {
  if (length === 0) return -1;
  const row = Math.max(1, Math.floor(columns) || 1);
  switch (key) {
    case "ArrowRight":
      return current < 0 ? 0 : Math.min(current + 1, length - 1);
    case "ArrowLeft":
      return current <= 0 ? 0 : current - 1;
    // Down into a short last row still lands on its final card; up from the
    // first row has nowhere to go, so focus holds its column instead of
    // sliding sideways to index 0.
    case "ArrowDown":
      return current < 0 ? 0 : Math.min(current + row, length - 1);
    case "ArrowUp": {
      if (current <= 0) return 0;
      const target = current - row;
      return target < 0 ? current : target;
    }
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return current;
  }
}

// How many cards share the first row, derived from their laid-out vertical
// offsets. Pure so the wrapping rule is unit-tested without a browser; the DOM
// layer supplies real offsets.
export function columnCount(offsets) {
  if (!Array.isArray(offsets) || offsets.length === 0) return 0;
  const first = offsets[0];
  let columns = 0;
  for (const offset of offsets) {
    if (offset !== first) break;
    columns += 1;
  }
  return columns;
}

// ---------------------------------------------------------------------------
// Rendering layer. Everything below touches the DOM and runs in the browser;
// the pure core above is what the unit tests cover. Text is always written via
// textContent / text nodes (never HTML strings) — no user-generated HTML.
// ---------------------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDateTime(iso) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

// Two-letter initials for the avatar chip. Purely decorative (aria-hidden); the
// author name is always announced from the byline text.
function initials(author) {
  const parts = author.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length >= 2
    ? parts[0][0] + parts[parts.length - 1][0]
    : (parts[0] ?? "").slice(0, 2);
  return letters.toUpperCase() || "?";
}

// The image tile. Three visual states, driven by one data attribute so CSS owns
// the appearance and JS only owns the transition:
//   loading → a reserved, shimmering placeholder (no layout shift on arrival)
//   ready   → the image
//   error   → an inline "image unavailable" note; the caption still carries the
//             post, so a dead asset degrades the card instead of breaking it.
function renderMedia(image, description) {
  const frame = el("div", "post-media");
  frame.dataset.state = "loading";

  const img = document.createElement("img");
  img.className = "post-image";
  img.src = image.src;
  // A supplied alt always wins. A post that carries none is a row written
  // before a description was required, and it still gets a real alt from the
  // shared read-path fallback (src/image-description.js) — never alt="", which
  // would quietly file the image as decoration.
  img.alt = description.alt;
  img.loading = "lazy";
  img.decoding = "async";
  if (image.width && image.height) {
    img.width = image.width;
    img.height = image.height;
  }

  // When the image dies, its description is the only thing left that says what
  // was there — so the fallback keeps it rather than discarding it with the
  // element. It takes `description.alt`, not the raw `image.alt`: a legacy row
  // written before descriptions were required used to fall through to a bare
  // "Image unavailable." with nothing under it, and the shared read-path
  // fallback has a real sentence for that case.
  const fallback = renderImageUnavailable("post-media-fallback", description.alt, { textClassName: "media-fallback-text" });
  fallback.hidden = true;

  const settle = (state) => {
    frame.dataset.state = state;
    fallback.hidden = state !== "error";
    if (state === "error") img.remove();
  };
  img.addEventListener("load", () => settle("ready"), { once: true });
  img.addEventListener("error", () => settle("error"), { once: true });
  // A cached image can already be decoded before the listeners above attach.
  if (img.complete) settle(img.naturalWidth > 0 ? "ready" : "error");

  frame.append(img, fallback);
  return frame;
}

function renderPostCard(post, { focusable, index }) {
  const item = el("li");
  const article = el("article", "post-card");
  // Roving tabindex: exactly one card is the tab stop; arrow keys move focus
  // between cards (see the keydown handler in mountSocialFeed).
  article.tabIndex = focusable ? 0 : -1;
  article.dataset.postId = post.id;

  const header = el("header", "post-head");
  const avatar = el("span", "post-avatar", initials(post.author));
  avatar.setAttribute("aria-hidden", "true");

  const byline = el("div", "post-byline");
  const author = el("span", "post-author", post.author);
  // Ids are minted from the render index, never from post.id — a post id is
  // arbitrary text and must not be spliced into an id/IDREF list.
  author.id = `post-${index}-author`;
  byline.append(author);
  const time = el("time", "post-date", formatDateTime(post.createdAt));
  time.dateTime = post.createdAt;
  byline.append(time);

  header.append(avatar, byline);
  article.append(header);
  if (post.title) article.append(el("h3", "post-title", post.title));

  const image = normalizeImage(post.image);
  const textId = `post-${index}-text`;
  if (image) {
    article.classList.add("post-card-media");
    // <figure>/<figcaption> is the semantic tie between an image and the text
    // that explains it, and it survives the caption being the only content left
    // when the image fails to load.
    const figure = el("figure", "post-figure");
    const description = imageDescription({ ...post, image });
    figure.append(renderMedia(image, description));
    const caption = el("figcaption", "post-caption", post.body);
    caption.id = textId;
    figure.append(caption);
    // The note sits beside the caption rather than inside it, so an undescribed
    // legacy post is visibly flagged without the flag joining the card's
    // accessible name.
    if (description.missing) figure.append(renderDescriptionNote());
    article.append(figure);
  } else {
    const body = el("p", "post-body", post.body);
    body.id = textId;
    article.append(body);
  }
  // Focusing a card announces "<author>: <caption>" rather than a bare "article".
  article.setAttribute("aria-labelledby", `post-${index}-author ${textId}`);

  item.append(article);
  return item;
}

// Placeholder tiles for the first load. Purely visual, so they are hidden from
// assistive tech — the live region in social.html announces the real status.
function renderSkeleton(container, count = 3) {
  const list = el("ol", "post-grid post-grid-skeleton");
  list.setAttribute("role", "list");
  list.setAttribute("aria-hidden", "true");
  for (let index = 0; index < count; index += 1) {
    const item = el("li");
    const card = el("div", "post-card post-card-skeleton");
    card.append(el("div", "skeleton-media"), el("div", "skeleton-line"), el("div", "skeleton-line skeleton-line-short"));
    item.append(card);
    list.append(item);
  }
  container.append(list);
}

// Every one of these states names Social. "No posts yet" on its own could be any
// list on the site; a reader who arrived from the nav needs the empty screen to
// confirm which of the two feeds they are looking at.
//
// A `noMatch` is passed only when filters are hiding posts, so its absence is
// what "the feed itself is empty" means. The two are different news, say
// different words, and get different actions: nothing published yet points at
// Paint, because an image is the part of a post a reader has nowhere else to
// get; a filtered-out feed is already full, so it names what excluded the posts
// and hands over the one control that brings them back.
//
// "create an image in Paint" is the site's one name for that act — the hero, the
// composer, and both of People's invitations all use it — so this sentence uses
// it too rather than the "open Paint" it used to say.
const NO_POSTS_GUIDANCE = "Publish a post, or create an image in Paint first.";

// One wait, one sentence. Social and People are both waiting on the same fetch,
// and each of them used to describe it twice at once — a visible line ("Loading
// posts…", "Counting Ari's image posts…") beside a live region that said
// something else ("Connecting to the Social feed…"). A reader saw two claims and
// a screen reader heard two; neither was more true than the other. Both surfaces
// now say this, word for word: the static markup a page ships, the panel over
// the empty grid, the count, and the connection line. People imports it from
// here because it already reads this module. src/social.html and
// src/profile.html carry it in markup for the frame before hydration, so a
// change here is a change in three files, not one.
export const FEED_LOADING_LINE = "Loading the Social feed…";

// `state` separates "we have nothing yet because we are still fetching" from
// "we have nothing because there is nothing" and from "we have nothing because
// the fetch failed" — three situations that must not share one empty state.
// Posts always win over a pending or failed refresh: stale content beats a
// spinner over content the reader could already see.
export function renderPosts(container, posts, options = {}) {
  const { noMatch = null, state = "ready" } = options;
  const ordered = sortPostsNewestFirst(posts);
  container.replaceChildren();
  container.setAttribute("aria-busy", state === "loading" && ordered.length === 0 ? "true" : "false");

  if (ordered.length === 0) {
    if (state === "loading") {
      renderSkeleton(container);
      const loading = document.createElement("div");
      renderState(loading, { state: "loading", title: FEED_LOADING_LINE });
      container.append(...loading.children);
      return;
    }
    if (state === "error") {
      const panel = renderState(container, {
        state: "error",
        label: "Social feed error",
        value: "Social posts could not be loaded.",
        description: "The feed keeps retrying. Check the connection status above.",
      });
      panel.classList.add("empty-state", "empty-state-error");
    } else if (noMatch) {
      // The filtered dead end. Its own words, its own label, and — unlike every
      // other state on this page — its own control, because this is the one
      // empty screen the reader can undo from where they are standing. A real
      // <button> (renderState builds one whenever an action carries no href),
      // after the message in DOM order, so Tab from the message reaches it.
      const panel = renderState(container, {
        state: "empty",
        label: "Social filter result",
        value: noMatchMessage(noMatch),
        description: noMatchGuidance(noMatch.total),
        action: { label: CLEAR_FILTERS_LABEL, onClick: noMatch.onClear },
      });
      panel.classList.add("empty-state", "empty-state-filtered");
    } else {
      const panel = renderState(container, {
        state: "empty",
        label: "Social feed status",
        value: "No posts on Social yet.",
        description: NO_POSTS_GUIDANCE,
        // Same label, same tab behaviour, same disclosure as the hero and the
        // composer above it: one action offered in a third place, not a third
        // action.
        action: { label: "Create an image in Paint", href: "/paint/", newTab: true },
      });
      panel.classList.add("empty-state");
    }
    return;
  }

  // `role="list"` is explicit because the grid removes list-style, which drops
  // list semantics in some Safari/VoiceOver combinations.
  const list = el("ol", "post-grid");
  list.setAttribute("role", "list");
  ordered.forEach((post, index) => {
    list.append(renderPostCard(post, { focusable: index === 0, index }));
  });
  container.append(list);
}

function focusCard(cards, index) {
  cards.forEach((card, i) => { card.tabIndex = i === index ? 0 : -1; });
  cards[index]?.focus();
}

// Cards on the same visual row share an offsetTop; that count is the grid's
// current column count, which is what up/down arrows step by.
function visibleColumnCount(cards) {
  return columnCount(cards.map((card) => card.offsetTop));
}

// The composer's image-description field: its requirement marker, its remaining
// -character counter, and its refusal state. It lives here rather than in the
// page wiring because the refusal is what decides whether a post is created,
// and that decision is testable without a file picker or a FileReader.
//
// The counter is the caption's counter — same counterState math, same
// "Characters remaining:" wording, same near/over classes — pointed at a
// different budget. There is deliberately no second mechanism.
export function mountImageDescription(root) {
  const input = root.querySelector("#post-image-alt");
  const marker = root.querySelector("#post-image-alt-required");
  const errorNode = root.querySelector("#post-image-alt-error");
  const counter = root.querySelector("#post-image-alt-counter");
  // The description the field carries when nothing is wrong. The error id is
  // added to it only while the error is showing: a hidden node named by
  // aria-describedby is still read, so leaving it there permanently would
  // announce a failure that has not happened.
  const described = input?.getAttribute("aria-describedby") ?? "";
  let attached = false;

  const updateCounter = () => {
    if (!counter || !input) return;
    const state = counterState(input.value, MAX_IMAGE_ALT_LENGTH);
    counter.textContent = `${state.remaining}`;
    counter.classList.toggle("over", state.over);
    counter.classList.toggle("near", state.near);
  };

  const clearError = () => {
    if (!input || !errorNode) return;
    input.removeAttribute("aria-invalid");
    input.removeAttribute("autofocus");
    input.setAttribute("aria-describedby", described);
    errorNode.replaceChildren();
    errorNode.hidden = true;
  };

  const showError = (message) => {
    if (!input || !errorNode) return;
    // Text plus a mark, never a colour on its own: the ⚠ is the message's first
    // character and the band down its edge is a border, not a tint.
    const mark = el("span", "field-error-mark", "⚠");
    mark.setAttribute("aria-hidden", "true");
    errorNode.replaceChildren(mark, el("span", "field-error-text", message));
    errorNode.hidden = false;
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", `${described} ${IMAGE_DESCRIPTION_ERROR_ID}`.trim());
    // Both halves of the same instruction. focus() moves the caret on the live
    // page; `autofocus` is carried by the input itself, so it still names the
    // field to land on if the composer is re-rendered around it.
    input.setAttribute("autofocus", "");
    input.focus();
  };

  input?.addEventListener("input", () => {
    updateCounter();
    // Clear the refusal the moment the reason for it is gone. A field that
    // stays marked invalid while it holds a valid value is a lie.
    if (input.getAttribute("aria-invalid") === "true" && !imageDescriptionProblem(input.value, { attached })) clearError();
  });

  updateCounter();
  return {
    // There is nothing to describe until an image is attached, so the marker
    // arrives with the image and leaves with it.
    setAttached(next) {
      attached = Boolean(next);
      if (marker) marker.hidden = !attached;
      // aria-required rather than `required`: the native attribute would hand
      // the refusal to the browser's own bubble, which cannot mark the field,
      // associate the message, or say what to do about it.
      input?.setAttribute("aria-required", String(attached));
      if (!attached) clearError();
      updateCounter();
    },
    // `required` overrides the marker's state at submit time, where the truth is
    // whether the composer actually handed over an image.
    validate(required) {
      const problem = imageDescriptionProblem(input?.value, {
        attached: required === undefined ? attached : Boolean(required),
      });
      if (problem) showError(problem);
      else clearError();
      return problem;
    },
    clear() {
      if (input) input.value = "";
      clearError();
      updateCounter();
    },
  };
}

// Wire the interactive behaviour: compose submission, the live character
// counter, and roving-focus navigation over the feed. Handlers are delegated to
// the feed container so they survive a re-render without re-binding. Returns a
// small API so the page can seed and re-render with fresh data.
export function mountSocialFeed(root, options = {}) {
  const feed = root.querySelector("#post-feed");
  const form = root.querySelector("#post-form");
  const bodyInput = root.querySelector("#post-body");
  const authorInput = root.querySelector("#post-author");
  const descriptionInput = root.querySelector("#post-image-alt");
  const counter = root.querySelector("#post-counter");
  const notice = root.querySelector("#social-notice");
  const submit = root.querySelector("#post-submit") ?? form?.querySelector("button[type=submit]");
  const submitLabel = submit?.querySelector(".submit-label");
  const count = root.querySelector("#post-count");
  const heading = root.querySelector("#feed-title");
  const summary = root.querySelector("#feed-summary");
  const nameFilter = root.querySelector("#post-name-filter");
  const timeFilter = root.querySelector("#post-time-filter");
  const clearFilters = root.querySelector("#post-filter-clear");
  const description = options.description ?? mountImageDescription(root);

  let posts = options.posts ?? [];
  let state = options.state ?? "ready";
  // The card that owns the tab stop, remembered across re-renders so a
  // background refresh cannot silently send a returning keyboard user back to
  // the top of the feed.
  let activeId = null;

  const postLabel = (n) => `${n} ${n === 1 ? "post" : "posts"}`;

  // The words a filter is currently showing, read back off the control itself
  // rather than kept as a second copy in this file. "From the past hour" is
  // sentence-initial in the menu and mid-sentence in the summary, so only its
  // first letter changes.
  const selectedText = (select) => {
    const option = [...(select?.options ?? [])].find((item) => item.value === select.value);
    return (option?.textContent ?? "").trim();
  };
  const midSentence = (text) => (text ? text[0].toLowerCase() + text.slice(1) : "");

  const render = () => {
    const hadFocus = Boolean(feed.querySelector(".post-card:focus"));
    const visible = filterPosts(posts, { author: nameFilter?.value, range: timeFilter?.value });
    const filtering = nameFilter?.value !== "all" || timeFilter?.value !== "all";
    const named = {
      range: timeFilter && timeFilter.value !== "all" ? midSentence(selectedText(timeFilter)) : "",
      author: nameFilter && nameFilter.value !== "all" ? selectedText(nameFilter) : "",
    };
    // A dead end only exists if there is something behind the filters: with no
    // posts at all this is the never-posted feed, whichever way the menus are
    // set, and that state has its own words and its own action.
    const noMatch = filtering && visible.length === 0 && posts.length > 0
      ? { ...named, total: posts.length, onClear: recoverFromNoMatch }
      : null;
    renderPosts(feed, visible, { state, noMatch });
    // The count answers "how many posts are there", which this page can only
    // answer once a fetch has come back. Until one has, it names which of
    // "still loading" and "could not load" is true instead of printing a zero
    // that reads as an empty feed — the same contradiction the three separate
    // renders above exist to avoid. The waiting case says it in the feed's one
    // wording, so the count, the panel over the empty grid, and the connection
    // line are not three descriptions of one wait.
    if (count) {
      if (posts.length === 0 && state === "loading") count.textContent = FEED_LOADING_LINE;
      else if (posts.length === 0 && state === "error") count.textContent = "Unavailable";
      else count.textContent = filtering ? `${postLabel(visible.length)} of ${posts.length}` : postLabel(visible.length);
    }

    // The same `visible` array the cards were just rendered from, so the count
    // the heading and the sentence state is the count of cards below them by
    // construction. Until a fetch has answered there is nothing to count, and
    // the connection status and the count already say which of loading and
    // failed is true.
    const answered = posts.length > 0 || state === "ready";
    const showing = { shown: visible.length, total: posts.length, ...named };

    // The heading is not its own live region: the count beside it is already
    // announced on every filter change, and a second polite region here would
    // read the same news twice. Nothing folds it away either — it names the
    // panel it heads.
    if (heading) heading.textContent = answered ? feedHeading(showing) : DEFAULT_FEED_HEADING;

    // Only the text is replaced. The element itself is the live region and it
    // ships with the page, so an update is one announcement — and it is never
    // hidden, because a region that is `hidden` at the moment its text arrives
    // announces unreliably, if at all. Before a fetch answers the sentence is
    // empty rather than a zero: "Showing 0 posts" is a claim, and the page has
    // not looked yet.
    if (summary) summary.textContent = answered ? feedSummarySentence(showing) : "";

    const cards = [...feed.querySelectorAll(".post-card")];
    const index = activeId ? cards.findIndex((card) => card.dataset.postId === activeId) : -1;
    if (index < 0) return;
    // Move focus only if the feed already had it; otherwise just restore the
    // tab stop, so a refresh never yanks focus out of the compose form.
    if (hadFocus) focusCard(cards, index);
    else cards.forEach((card, i) => { card.tabIndex = i === index ? 0 : -1; });
  };

  const renderNames = () => {
    if (!nameFilter) return;
    const selected = nameFilter.value;
    const authors = [...new Set(posts.map((post) => post.author))].sort((a, b) => a.localeCompare(b));
    nameFilter.replaceChildren(new Option("All display names", "all"), ...authors.map((author) => new Option(author, author)));
    nameFilter.value = authors.includes(selected) ? selected : "all";
  };

  const updateCounter = () => {
    if (!counter || !bodyInput) return;
    const state = counterState(bodyInput.value);
    counter.textContent = `${state.remaining}`;
    counter.classList.toggle("over", state.over);
    counter.classList.toggle("near", state.near);
  };

  // The one reset on this page. Both Clear filters controls — the one in the
  // toolbar and the one inside the no-match panel — run this and then decide
  // where focus goes, so the two can restore the feed differently only by
  // accident of where the reader was standing, never by holding two copies of
  // what "clear" means.
  const clearBothFilters = () => {
    if (nameFilter) nameFilter.value = "all";
    if (timeFilter) timeFilter.value = "all";
    render();
  };

  // Recovery from the no-match panel. The control that runs this is inside the
  // panel that this render replaces with the restored list, so focus is moved
  // explicitly: leaving it on a removed node drops a keyboard reader to
  // document.body and back to the top of the page. It lands on the first
  // restored post — the thing the reader asked for — and falls back to the list
  // heading, which is the panel's own accessible name and always present.
  const recoverFromNoMatch = () => {
    clearBothFilters();
    const first = feed.querySelector(".post-card");
    (first ?? heading)?.focus();
  };

  const focusPostCard = (id) => {
    const card = [...feed.querySelectorAll(".post-card")].find((item) => item.dataset.postId === id);
    card?.focus();
    card?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    return Boolean(card);
  };

  // A live state, drawn the way the design system draws live states: a filled
  // wash whose label carries the word, never a wash on its own.
  const stateChip = (word, variant) => el("span", `detail-state-chip ${variant}`, word);

  // What a reader gets back for pressing Publish. Everything in it is derived
  // from the post the API actually returned — the permalink is built from that
  // row's id, never reconstructed from the caption or the clock — and whether
  // the post is on screen is decided by the same predicate the feed just
  // rendered from, so the confirmation cannot promise a card that is not there.
  //
  // Deliberately not folded into a <details>: this is the announcement, and a
  // live region behind a closed disclosure is silent.
  const showConfirmation = (saved, { hasImage, focus = true }) => {
    if (!notice) return;
    const hiddenByFilters = !postMatchesFilters(saved, { author: nameFilter?.value, range: timeFilter?.value });

    notice.replaceChildren(document.createTextNode(`${publishedPostLabel(saved)} `));
    const permalink = document.createElement("a");
    permalink.href = postDetailHref(saved.id, saved.author);
    permalink.textContent = "Open the post’s permalink";
    notice.append(permalink, document.createTextNode(". "));

    if (hasImage) {
      // An image post is the only kind People shows, so that link is offered
      // exactly when there is something at the other end of it.
      const people = document.createElement("a");
      people.href = profileHref(saved.author);
      people.textContent = `See ${saved.author}’s image posts on People`;
      notice.append(people, document.createTextNode("."));
    } else {
      notice.append(document.createTextNode(NO_IMAGE_NOTE));
    }

    if (hiddenByFilters) {
      notice.append(
        document.createTextNode(" "),
        stateChip(PUBLISH_STATE_WORDS.filtered, "detail-state-chip-missing"),
        document.createTextNode(` ${FILTERED_OUT_NOTE} `),
      );
      const reveal = el("button", "text-button", REVEAL_CONTROL_LABEL);
      reveal.type = "button";
      reveal.addEventListener("click", () => {
        clearBothFilters();
        // Re-stated without the notice that is no longer true, then focus goes
        // to the card the reader asked to see — not back to this control, which
        // this render is about to remove.
        showConfirmation(saved, { hasImage, focus: false });
        focusPostCard(saved.id);
      });
      notice.append(reveal);
    }

    notice.classList.add("is-success");
    notice.hidden = false;
    // Focusable only by script: the announcement is where a screen-reader user
    // is put when it arrives, and it must not become a tab stop afterwards.
    notice.setAttribute("tabindex", "-1");
    if (focus) notice.focus();
  };

  const showFailure = (message) => {
    if (!notice) return;
    notice.classList.remove("is-success");
    notice.replaceChildren(
      stateChip(PUBLISH_STATE_WORDS.failed, "detail-state-chip-error"),
      document.createTextNode(` ${message} ${PUBLISH_FAILED_NOTE}`),
    );
    notice.hidden = false;
  };

  const setSubmitting = (submitting) => {
    if (!submit) return;
    submit.disabled = submitting;
    submit.setAttribute("aria-busy", String(submitting));
    if (submitLabel) submitLabel.textContent = submitting ? "Publishing…" : "Publish post";
  };

  // Arrow/Home/End move focus between cards; delegated so it survives re-renders.
  feed.addEventListener("keydown", (event) => {
    const card = event.target.closest?.(".post-card");
    if (!card || !NAV_KEYS.has(event.key)) return;
    const cards = [...feed.querySelectorAll(".post-card")];
    event.preventDefault();
    focusCard(cards, nextFocusIndex(cards.indexOf(card), event.key, cards.length, visibleColumnCount(cards)));
  });

  feed.addEventListener("focusin", (event) => {
    const card = event.target.closest?.(".post-card");
    if (card) activeId = card.dataset.postId;
  });

  if (bodyInput) {
    bodyInput.addEventListener("input", updateCounter);
    // Keyboard affordance: Cmd/Ctrl+Enter submits from the textarea, where a bare
    // Enter must stay a newline. (A single-line input would submit on Enter
    // natively; the message is multi-line, so we provide the explicit shortcut.)
    bodyInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        form.requestSubmit();
      }
    });
  }

  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!form.reportValidity()) return;

      let post;
      let media;
      try {
        post = createPost({ author: authorInput?.value, body: bodyInput?.value });
        media = options.getMedia?.() ?? null;
      } catch (error) {
        // Should be unreachable behind reportValidity()/maxlength, but keeps the
        // submit flow resilient rather than throwing into the console.
        showFailure(error?.message || "That post could not be created. Add a caption within the limit.");
        return;
      }

      // The one field the composer will not publish an image without. Refusing
      // here means no post is created and nothing else is touched: the caption,
      // the byline, and the encoded image all stay exactly where the poster left
      // them, the image in the same composer store the success path reads from.
      //
      // The refusal is said twice on purpose, in the two places a reader could
      // be: on the field, which is where validate() marks and focuses, and in
      // the composer's own status region, which is where every other outcome of
      // pressing Publish post is already announced. Same region, same failure
      // rendering as a save that did not land — no second live region, no colour
      // carrying the news, no new rule in styles.css. validate() runs first, so
      // focus is already on the field to fix and writing the notice does not
      // move it.
      if (description.validate(Boolean(media))) {
        if (!String(descriptionInput?.value ?? "").trim()) showFailure(IMAGE_DESCRIPTION_REFUSAL_NOTE);
        return;
      }

      try {
        setSubmitting(true);
        const saved = options.create ? await options.create(post, media) : post;
        // The byline is what the profile view treats as "you" (src/
        // social-identity.js). Remembered only after a post actually lands, so a
        // failed submit cannot rewrite who this browser thinks it is.
        rememberAuthor(options.storage ?? globalThis.localStorage, saved.author);
        posts = [saved, ...posts.filter((item) => item.id !== saved.id)];
        renderNames();
        // The feed is redrawn before the confirmation is written, so the
        // "is it visible?" question is asked of the feed that now exists.
        render();
        showConfirmation(saved, { hasImage: Boolean(media) });
      } catch (error) {
        showFailure(error?.message || "This post could not be saved. Check the live connection and try again.");
        return;
      } finally {
        setSubmitting(false);
      }
      // Only now, and only here: everything below runs on the confirmed-success
      // path, so a failed publish never costs a reader the post they wrote.
      // The three fields the post consumed are emptied; the display name is not
      // one of them — it is who this browser is, and it was just remembered.
      if (bodyInput) bodyInput.value = "";
      options.clearMedia?.();
      description.clear();
      updateCounter();
      // Focus is already on the confirmation (showConfirmation put it there);
      // clearing the fields above must not pull it back to the composer.
    });
  }


  nameFilter?.addEventListener("change", render);
  timeFilter?.addEventListener("change", render);
  clearFilters?.addEventListener("click", () => {
    clearBothFilters();
    nameFilter.focus();
  });

  // Carry the byline across visits so the feed and the profile agree on who you
  // are without asking twice. An untouched field only.
  const remembered = readStoredAuthor(options.storage ?? globalThis.localStorage);
  if (authorInput && !authorInput.value && remembered) authorInput.value = remembered;

  renderNames();
  render();
  updateCounter();
  return {
    render,
    // Handed back so the media composer can tell the field when an image
    // arrives or leaves, without either half owning the other's DOM.
    description,
    seed(next) { posts = next ?? []; state = "ready"; renderNames(); render(); },
    // Loading/error are display states only — they never discard posts already
    // on screen, so a failed refresh degrades to "stale but readable".
    setState(next) { state = next; render(); },
    getPosts() { return [...posts]; },
  };
}
