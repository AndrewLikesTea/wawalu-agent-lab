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
import { OPEN_POST_LABEL, postDetailHref, profileHref } from "./social-links.js";
import { renderFeedStatus, feedPhase, feedPresence, filtersAvailable, setFilterAvailability, FILTERS_UNAVAILABLE_HINT } from "./feed-status.js";

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
    // field's own label does: "Post", not a second word for it. "Blank" and not
    // "required", because the browser's own required check has already passed by
    // the time this fires — the only body that reaches here is whitespace, and a
    // reader who typed spaces is not missing a field, they are holding an empty
    // one. Shaped like the over-budget refusal below, the way the two composer
    // refusals downpage are shaped like each other.
    throw new TypeError("A post cannot be blank.");
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

// …and the post field's, which works the same way: the id joins the textarea's
// aria-describedby only while there is a sentence to point at.
export const POST_BODY_ERROR_ID = "post-body-error";

// What the composer says about a post that is over the budget, and the only
// place it is said. Both numbers, because neither is enough on its own: the
// counter beside the field already counts down to a negative, which tells a
// reader how far over they are and never what the limit was, and the hint above
// states the limit and never how long the post is. It opens with the field's own
// label ("Your post"), so the sentence is self-describing wherever it is read —
// out of the accessibility tree, out of a find-in-page hit, out of a colourless
// screen — and nothing in it depends on the counter going red.
export function overLengthPostMessage(length, max = MAX_POST_LENGTH) {
  return `Your post is ${length} characters — ${length - max} over the ${max} limit.`;
}

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

// The one way this page words the two filters, so the heading, the sentence
// above the cards, and the no-match panel name a narrowed feed identically.
// The time clause is the time menu's own option text, read back off the control;
// the name clause is "by Ari", which is how People already words the same fact
// ("Showing 3 image posts by Ari") — one phrasing for one concept, both pages.
function filterClauses({ range = "", author = "" } = {}) {
  return [author ? `by ${author}` : "", range].filter(Boolean).join(" ");
}

// The heading above the post list. It read "All posts" in every state, so a
// reader who narrowed the feed to one display name, or to the past hour, still
// met a heading claiming every post was below it — and the heading is the
// accessible name of the whole feed panel, so that claim was also what a screen
// reader announced on entering the region.
//
// A noun phrase, not a sentence — it is a heading, and the summary below it is
// where the full sentence lives. It no longer says "All": the summary is now the
// page's one statement of how many of how many posts are showing, so a heading
// claiming "all" of anything beside it was a second, weaker telling of the same
// count.
//
// `shown` is the length of the array the cards are rendered from, never a second
// filter pass, which is what keeps the stated count and the visible cards the
// same number.
export const DEFAULT_FEED_HEADING = "Posts";

export function feedHeading({ shown = 0, range = "", author = "" } = {}) {
  const clauses = filterClauses({ range, author });
  const counted = shown === 0 ? "No posts" : `${shown} ${shown === 1 ? "post" : "posts"}`;
  return clauses ? `${counted} ${clauses}` : counted;
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
// It also carries the ordering, which is why the eyebrow that used to sit above
// the heading ("Post order: newest first") is gone: the page states the order
// once, in the sentence that already states the count, and the feed list points
// its aria-describedby here.
//
// An empty feed returns "", filtered or not, because neither empty screen is
// this sentence's to state. A never-posted feed is the empty panel's news, and a
// feed the filters emptied is the no-match panel's — and that panel is #feed-state,
// which is `role="status"`, so it is announced where it stands. This element is
// polite too, so composing the same two sentences here printed the dead end twice
// and read it out twice: "No posts by Ari from the past hour. Select Clear
// filters to see all 9 posts." above the panel saying exactly that, with the
// heading making it three. One state, one telling, and it is the telling that
// carries the control back out.
export function feedSummarySentence({ shown = 0, total = shown, range = "", author = "" } = {}) {
  const clauses = filterClauses({ range, author });

  if (shown === 0) return "";
  if (!clauses) return `Showing ${shownPostsCount({ shown })}, newest first.`;
  return `Showing ${shownPostsCount({ shown, total, filtering: true })} ${clauses}, newest first.`;
}

// How many posts are showing, in the one shape this page states it in — and the
// only place that shape is decided. Unfiltered there is nothing to be shown out
// of, so it is the single total; with either filter set it is "3 of 12 posts",
// the number on screen first and what it was narrowed from behind it.
//
// The noun is written once and agrees with the figure it follows: the total when
// there is a denominator ("1 of 1 post", "1 of 12 posts"), the shown count when
// there is not ("1 post"). It used to read "1 posts of 12" beside the heading —
// the same fact in a second word order, with the plural fixed — because the
// heading's count and this sentence's count were spelled in two different files'
// worth of string building. Both call sites now spell it here.
export function shownPostsCount({ shown = 0, total = shown, filtering = false } = {}) {
  const noun = (count) => (count === 1 ? "post" : "posts");
  return filtering ? `${shown} of ${total} ${noun(total)}` : `${shown} ${noun(shown)}`;
}

// The two sentences of the no-match dead end, and the only place they are said:
// the panel below the feed. A filter combination that matches
// nothing used to render the never-posted panel — "No posts on Social yet." —
// which told a reader the feed was empty when in fact it was full and their own
// two menus were hiding it. These say the opposite, in the menus' own words:
// what excluded the posts, and how many are waiting behind the filters.
//
// Plain sentences, not a colon and a list of set filters: "No posts match these
// filters: Ari · from the past hour." asked a reader to parse a field before
// they could read the news. The clauses are the same ones the heading and the
// summary use, so the three cannot drift apart.
//
// The way out names the control by the exact words on it — CLEAR_FILTERS_LABEL
// is what the button renders — rather than describing the act ("clear the
// filters"), so a reader can look for the thing they were just told to press.
export function noMatchMessage({ range = "", author = "" } = {}) {
  const clauses = filterClauses({ range, author });
  return clauses ? `No posts ${clauses}.` : "No posts match these filters.";
}

export function noMatchGuidance(total = 0) {
  return `Select ${CLEAR_FILTERS_LABEL} to see all ${total} ${total === 1 ? "post" : "posts"}.`;
}

export const CLEAR_FILTERS_LABEL = "Clear filters";

// The filter row's own line, and the only place its three shapes are decided.
// The row used to state its condition twice in two vocabularies and leave a gap
// between them: a sentence appeared while the menus were shut and vanished the
// moment they worked, so a settled feed's controls said nothing at all about
// what they were set to and a reader had to infer "nothing is filtered" from a
// fill on a button. Dimming is the signal a low-vision reader is least likely to
// get, and a menu is closed over its own answer.
//
// Three shapes, mutually exclusive:
//   shut     — the wait, in the words the row has always used for it.
//   open     — nothing set, said plainly, which is also exactly when Clear
//              filters has nothing to do and is `disabled`.
//   open     — the filters that are set, named in the menus' own option text.
//
// The clauses come from filterClauses, the same function the heading, the
// summary and the no-match panel word a narrowed feed with, and the caller reads
// them off the rendered options — so this line cannot name a display name or a
// time range in words the control beside it does not use.
//
// No count and no ordering: the summary sentence below the toolbar owns both,
// and this line is deliberately outside the list panel so that it can only ever
// describe the controls it sits with.
export const NO_FILTERS_APPLIED = "No filters applied.";

export function filterStatusLine({ available = true, range = "", author = "" } = {}) {
  if (!available) return FILTERS_UNAVAILABLE_HINT;
  const clauses = filterClauses({ range, author });
  return clauses ? `Filtered to posts ${clauses}.` : NO_FILTERS_APPLIED;
}

// ---------------------------------------------------------------------------
// The publish confirmation's words. Pure, so the sentence a reader hears after
// publishing is tested without a browser.
//
// The confirmation names the post rather than saying "post published": a reader
// who publishes twice in a row, or who publishes while a filter is on, needs to
// know WHICH post landed. Its own words are the only name a post has, so they
// are the name, quoted and shortened to a scannable opening, not repeated whole.
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
export const PUBLISH_FAILED_NOTE = "Your post, image, and image description are still in the composer, exactly as you left them.";

// …and the sentence that says what to do with them. Said only where it is true:
// a publish the server refused can be sent again unchanged, so this names the
// control that sends it. The composer's own refusals — a blank post, a
// missing image description — do not get it, because pressing the same button
// again without fixing the field would fail the same way.
export const PUBLISH_RETRY_NOTE = "Use Retry publishing post to send the same post again.";
export const PUBLISH_RETRY_LABEL = "Retry publishing post";

// The label said "(required with an image)" and nothing said what the
// requirement does, so the one refusal that is entirely this page's own — the
// browser has no opinion about this field — happened without being announced.
// Written in the post hint's sentence, clause for clause: what stops, what is
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

// One drawing for every refusal the composer shows beside a field — the post
// that is too long, the image description that is empty, the file this field
// will not take. Text plus a mark, never a colour on its own: the ⚠ is the
// message's first character and the band down its edge is a border, not a tint.
// The mark is hidden from assistive tech, because the sentence beside it already
// says what is wrong. Exported so src/social-page.js, which owns the file
// picker, draws its refusal identically rather than growing a second shape for
// the same thing.
export function renderFieldError(node, message) {
  const mark = el("span", "field-error-mark", "⚠");
  mark.setAttribute("aria-hidden", "true");
  node.replaceChildren(mark, el("span", "field-error-text", message));
  node.hidden = false;
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
function renderMedia(image, description, descriptionId) {
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
  img.setAttribute("aria-describedby", descriptionId);
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

function renderPostCard(post, { index }) {
  const item = el("li");
  const article = el("article", "post-card");
  article.dataset.postId = post.id;

  const header = el("header", "post-head");
  const avatar = el("span", "post-avatar", initials(post.author));
  avatar.setAttribute("aria-hidden", "true");

  const byline = el("div", "post-byline");
  const author = el("a", "post-author", post.author);
  author.href = profileHref(post.author);
  author.setAttribute("aria-label", `${post.author} — view this display name on People`);
  // Ids are minted from the render index, never from post.id — a post id is
  // arbitrary text and must not be spliced into an id/IDREF list.
  author.id = `post-${index}-author`;
  byline.append(author);
  const time = el("time", "post-date", formatDateTime(post.createdAt));
  time.dateTime = post.createdAt;
  byline.append(time);

  header.append(avatar, byline);
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
    const caption = el("figcaption", "post-caption", post.body);
    caption.id = textId;
    figure.append(caption);
    const descriptionText = el("p", "post-image-description", `Image description: ${description.alt}`);
    descriptionText.id = `post-${index}-image-description`;
    figure.append(renderMedia(image, description, descriptionText.id), descriptionText);
    // The note sits beside the caption rather than inside it, so an undescribed
    // legacy post is visibly flagged without the flag joining the card's
    // accessible name.
    if (description.missing) figure.append(renderDescriptionNote());
    article.append(figure, header);
  } else {
    article.append(header);
    const body = el("p", "post-body", post.body);
    body.id = textId;
    article.append(body);
  }
  // The card's own way into the post, last in the card so the action follows the
  // picture and the words it acts on. A plain anchor in the link shape the
  // Releases index already uses for the same job — a row that summarises a
  // record, and one named link out of it to that record's own page.
  //
  // Named by the action, not by the post: every card prints the same two words,
  // and the sentence in the hero prints them too, so a reader who is told to
  // "Select Open post" is looking for the words that are actually on screen.
  // The post it opens is said by aria-describedby rather than by folding the
  // body into the link's name — the card's text is already on the page and
  // reading it twice into one accessible name is how a name stops being one.
  const open = el("a", "release-detail-link", OPEN_POST_LABEL);
  open.href = postDetailHref(post.id, post.author);
  open.setAttribute("aria-describedby", textId);
  article.append(open);
  item.append(article);
  return item;
}

// Placeholder cards for the first load. They reserve the real card hierarchy —
// author and time, post text, an optional image, then the post action — rather
// than turning every pending record into the same large grey rectangle. There
// are no links or controls in here, and no card claims to be a particular post:
// how many are drawn is a layout choice, not a count this page has fetched.
//
// Still out of the accessibility tree. #feed-status announces the state in one
// sentence, and three placeholders reading themselves out after it would be the
// same news three more times — plus a post count that is not yet a fact. The
// post permalink's skeleton (src/post-detail.js) waits the same way.
function renderSkeleton(container, count = 3) {
  const list = el("ol", "post-grid post-grid-skeleton");
  list.setAttribute("role", "list");
  list.setAttribute("aria-hidden", "true");
  list.setAttribute("inert", "");
  for (let index = 0; index < count; index += 1) {
    const item = el("li");
    const card = el("div", "post-card post-card-skeleton");
    const head = el("div", "post-head skeleton-post-head");
    const byline = el("div", "post-byline skeleton-byline");
    byline.append(el("div", "skeleton-line skeleton-line-author skeleton-line-short"),
      el("div", "skeleton-line skeleton-line-date skeleton-line-short"));
    // The avatar keeps .post-avatar's 38px circle and does not also take
    // .skeleton-line, whose 13px height wins on source order and would shrink
    // the reserved head row to a quarter of the height the real card needs.
    head.append(el("div", "post-avatar skeleton-avatar"), byline);
    const copy = el("div", "skeleton-copy");
    copy.append(el("div", "skeleton-line"), el("div", "skeleton-line"),
      el("div", "skeleton-line skeleton-line-short"));
    const action = el("div", "skeleton-line skeleton-line-short skeleton-line-action");
    if (index % 2 === 0) {
      card.classList.add("post-card-media");
      card.append(copy, el("div", "skeleton-media"), head, action);
    } else {
      card.append(head, copy, action);
    }
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
// "create an image in Paint" is the site's one name for that act — the composer
// and both of People's invitations all use it — so this sentence uses it too
// rather than the "open Paint" it used to say. It is the sentence that points at
// Paint here; the button that used to repeat it under this line is gone, because
// Social offered one action three times and the composer above is where the
// image is actually attached.
//
// It names the hero's control in that control's own words. The sentence used to
// open "Publish a post", which was the opener's label at the time; the opener is
// "Write a post" now, and an empty state that tells a reader to press a button
// nothing on the page is called sends them looking for it.
const NO_POSTS_GUIDANCE = "Write a post, or create an image in Paint first.";

// One wait, one sentence — on this page. Social used to describe it twice at
// once: a visible line ("Loading posts…") beside a live region that said
// something else ("Connecting to the Social feed…"). A reader saw two claims and
// a screen reader heard two; neither was more true than the other. The waiting
// feed now uses one short status in the static markup and the panel that replaces
// it. src/social.html carries it for the frame before hydration, so a change here
// is a change in two files.
//
// People is not one of them. It waits on the same fetch but shows one display
// name's image posts, so it says that instead (loadingSummaryText,
// src/profile.js); this sentence stays Social's.
export const FEED_LOADING_LINE = "Loading the Social feed…";

// The connection line under the filters, on Social and on People, from one
// source so the same fact never gets two phrasings. `noun` is the only
// difference between the pages: Social shows posts, People shows one display
// name's image posts.
//
// What each state says is what the reader gets, or what to do about not getting
// it. "Live updates" is gone from all three: it named a mechanism and left a
// first-time visitor to guess what the mechanism did for them, and while the
// first fetch was open "Connecting to live updates…" ran as a second in-progress
// line beside the one that already said the feed was loading
// (FEED_LOADING_LINE here, loadingSummaryText in src/profile.js). So the
// connecting sentence states the promise instead and says nothing about the
// load; "live" is settled and takes no ellipsis; "degraded" is one sentence
// carrying both the consequence and the action, for a first failure and a
// dropped connection alike, because a reader who cannot get new posts needs the
// same thing either way.
//
// The two pages carry the connecting sentence in their static markup for the
// frame before hydration (src/social.html, src/profile.html), so a change here
// is a change in three files.
export function connectionStatusLine(state, noun = "posts") {
  if (state === "live") return `New ${noun} appear here without reloading the page.`;
  if (state === "degraded") return `New ${noun} will not appear here, so reload the page to see the latest.`;
  return `New ${noun} will appear here on their own.`;
}

// `state` separates "we have nothing yet because we are still fetching" from
// "we have nothing because there is nothing" and from "we have nothing because
// the fetch failed" — three situations that must not share one empty state.
// Posts always win over a pending or failed refresh: stale content beats a
// spinner over content the reader could already see.
export function renderPosts(container, posts, options = {}) {
  const { noMatch = null, state = "ready", statusRegion = container, onRetry = null } = options;
  const ordered = sortPostsNewestFirst(posts);
  container.replaceChildren();
  container.setAttribute("aria-busy", state === "loading" && ordered.length === 0 ? "true" : "false");
  if (statusRegion !== container && state === "error") {
    renderFeedStatus(statusRegion, {
      state: "error", label: "Social feed update failed",
      text: "Showing the posts already loaded.",
      detail: "Your filters and anything in the composer are unchanged. Retry loading newer posts.",
      actionLabel: "Retry loading Social posts", onAction: onRetry,
    });
  } else if (statusRegion !== container) {
    statusRegion.replaceChildren();
    statusRegion.hidden = false;
  }

  // One decision, taken by the shared machine, so the status region below and
  // the count, filters, and connection line in mountSocialFeed cannot disagree
  // about which of the five states this render is in.
  const phase = feedPhase({
    state,
    total: noMatch ? noMatch.total : ordered.length,
    visible: ordered.length,
    filtering: Boolean(noMatch),
  });

  if (ordered.length === 0) {
    if (phase === "loading") {
      renderSkeleton(container);
      renderFeedStatus(statusRegion, {
        state: "loading", label: "Social feed loading", text: FEED_LOADING_LINE,
        append: statusRegion === container,
      });
      return;
    }
    if (phase === "failed") {
      const panel = renderFeedStatus(statusRegion, {
        state: "error",
        label: "Social feed error",
        text: "Social posts could not be loaded.",
        detail: "Your filters and anything in the composer are unchanged. Retry loading the feed.",
        actionLabel: "Retry loading Social posts",
        onAction: onRetry,
        append: statusRegion === container,
      });
      panel.classList.add("empty-state", "empty-state-error");
    } else if (phase === "filtered-empty") {
      // The filtered dead end. Its own words, its own label, and — unlike every
      // other state on this page — its own control, because this is the one
      // empty screen the reader can undo from where they are standing. A real
      // <button> (the shared status builds one whenever an action can run),
      // after the message in DOM order, so Tab from the message reaches it.
      const panel = renderFeedStatus(statusRegion, {
        state: "filtered",
        label: "Social filter result",
        text: noMatchMessage(noMatch),
        detail: noMatchGuidance(noMatch.total),
        actionLabel: CLEAR_FILTERS_LABEL,
        onAction: noMatch.onClear,
        append: statusRegion === container,
      });
      panel.classList.add("empty-state", "empty-state-filtered");
    } else {
      const panel = renderFeedStatus(statusRegion, {
        state: "empty",
        label: "Social feed status",
        text: "No posts on Social yet.",
        detail: NO_POSTS_GUIDANCE,
        append: statusRegion === container,
      });
      panel.classList.add("empty-state");
    }
    return;
  }

  if (statusRegion !== container) {
    statusRegion.replaceChildren();
    statusRegion.hidden = true;
  }

  // `role="list"` is explicit because the grid removes list-style, which drops
  // list semantics in some Safari/VoiceOver combinations.
  const list = el("ol", "post-grid");
  list.setAttribute("role", "list");
  ordered.forEach((post, index) => {
    list.append(renderPostCard(post, { index }));
  });
  container.append(list);
}

// The composer's image-description field: its requirement marker, its remaining
// -character counter, and its refusal state. It lives here rather than in the
// page wiring because the refusal is what decides whether a post is created,
// and that decision is testable without a file picker or a FileReader.
//
// The counter is the post field's counter — same counterState math, same
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
    renderFieldError(errorNode, message);
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

// The composer as a disclosure, wired the way this site already wires its other
// one (src/site-footer.js): a trigger that carries `aria-expanded`, a panel that
// carries `hidden`, Escape from inside the panel, and focus that returns to the
// trigger on every close. No new pattern, no new class, no new rule.
//
// Why the panel is `hidden` rather than moved with CSS: the point of the reorder
// is that the feed comes first in the order a keyboard reader and a screen
// reader travel, and a visually-repositioned form still stands between the
// heading and the first post in both of those. `hidden` also takes the four
// composer fields out of the tab sequence until somebody asks for them.
//
// Focus is the half that makes it usable, so it is stated once here and holds
// for every route: open puts the caret in the post field, because revealing a
// form and leaving focus on the trigger above it strands the reader at the exact
// moment they asked for the form; close puts it back on the trigger, because
// anything else drops them at the top of the document, above everything they
// have already read.
//
// A publish that succeeds deliberately does NOT close the panel. The receipt —
// #social-notice, with the permalink and the People link — is inside it, and
// src/social.js already moves focus there; collapsing the composer would hide
// the announcement the reader was just sent to.
//
// What a close costs a half-written post is nothing, and that is a contract
// rather than an accident of the implementation (#1832): the panel is revealed
// and hidden, never re-created, so the post, the byline, the image and its
// description are still in the fields — and the counters still count down from
// them — when it comes back. close() must therefore never empty a field. The
// only reset is the one the success path in mountSocialFeed performs, on a
// publish that actually landed, and a failed publish leaves the draft where the
// reader left it. Nothing is written down: this is memory for this tab, so the
// panel's own state is the whole mechanism and there is no second store to keep
// in step with it, no storage promise to answer for, and no draft waiting on a
// shared machine after the visitor closes the tab. The sentence beside the
// Paint steps in src/social.html is this paragraph, said to the visitor.
export function mountComposerDisclosure(root) {
  const trigger = root.querySelector("#post-compose-open");
  const panel = root.querySelector("#post-compose-panel");
  const caption = root.querySelector("#post-body");
  const cancel = root.querySelector("#post-compose-cancel");
  const closed = { open() {}, close() {}, get isOpen() { return false; } };
  if (!trigger || !panel) return closed;

  // `focus: false` is for the two arrivals that already own where the reader
  // lands — a Paint handoff, and a cold load on the composer's own fragment.
  const open = ({ focus = true } = {}) => {
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    if (focus) caption?.focus();
  };
  const close = () => {
    if (panel.hidden) return;
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.focus();
  };

  trigger.addEventListener("click", () => (panel.hidden ? open() : close()));
  cancel?.addEventListener("click", close);
  panel.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
  });

  return { open, close, get isOpen() { return !panel.hidden; } };
}

// Wire the interactive behaviour: compose submission, the live character
// counter, and the two feed filters. Nothing here binds a key over the feed —
// it is a list of ordinary links, so Tab and the arrow keys stay the browser's.
// Returns a small API so the page can seed and re-render with fresh data.
export function mountSocialFeed(root, options = {}) {
  const feed = root.querySelector("#post-feed");
  const feedState = root.querySelector("#feed-state");
  const form = root.querySelector("#post-form");
  const bodyInput = root.querySelector("#post-body");
  const authorInput = root.querySelector("#post-author");
  const descriptionInput = root.querySelector("#post-image-alt");
  const counter = root.querySelector("#post-counter");
  const bodyError = root.querySelector("#post-body-error");
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
  const composer = mountComposerDisclosure(root);

  // The two lines that may only speak once a fetch has answered. The count is a
  // number the page has not got yet, and the connection line is a promise about
  // posts nobody has seen; both used to sit on screen beside "Loading the Social
  // feed…", so a waiting reader met three sentences about one wait. They leave
  // the document while the feed is loading and come back with the answer.
  const countPresence = feedPresence(count);
  // The connection line ships empty and `hidden` (src/social.html) so that the
  // frame before this module runs states one thing — that the feed is loading.
  // Everything about the line from here is decided in code: this drops the
  // attribute once, and presence below decides which states carry it at all.
  const connection = root.querySelector(".feed-connection");
  connection?.removeAttribute("hidden");
  const connectionPresence = feedPresence(connection);
  const connectionText = root.querySelector("#feed-status");

  let posts = options.posts ?? [];
  let state = options.state ?? "ready";

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
    renderPosts(feed, visible, {
      state, noMatch, statusRegion: feedState ?? feed, onRetry: options.onRetry,
    });
    // The same machine renderPosts just branched on, so the count, the filters
    // and the connection line are describing the state the status region drew.
    const phase = feedPhase({ state, total: posts.length, visible: visible.length, filtering });
    // Absent, not hidden: a `hidden` placeholder is still text in the
    // accessibility tree, and the point is that a page with no answer yet makes
    // no claim at all.
    countPresence.present(phase !== "loading");
    // The promise goes with it, and it speaks only in the two states that have
    // a feed for new posts to arrive in: one with posts, and one waiting for its
    // first. It leaves while a fetch is open, because the status region is
    // already reporting that wait and a promise beside it is a second thing to
    // read. It leaves when the filters have emptied the feed, because "New posts
    // will appear here on their own." over a panel saying nothing matches
    // answers "why is this empty?" with the wrong reason and tells a reader to
    // wait when the fix is one control away. And it leaves when the load failed,
    // where the panel below is the one message and its Retry is the one action:
    // a second line saying to reload the page instead is a rival instruction.
    const connected = phase === "loaded" || phase === "empty";
    connectionPresence.present(connected);
    // The connecting sentence, written here rather than authored in the markup,
    // because the markup frame is the loading frame. Only into a line that has
    // no words yet, so the settled sentence social-page.js writes over it
    // survives the next filter change.
    if (connected && connectionText && !connectionText.textContent) {
      connectionText.textContent = connectionStatusLine("connecting");
    }
    // Nothing to filter yet, so the menus and their reset say so with the one
    // attribute that also takes them out of the tab order — plus the words for
    // why, next to the controls, since a greyed fill is not a signal every
    // reader gets. Focus is not dropped either: the shared helper moves a reader
    // standing on a menu to the status region that just changed under them. On
    // the failed feed this is also what puts Retry next in the tab order after
    // the message, with nothing moved in the markup to do it.
    //
    // The sentence is the row's state in every phase now, not only in the shut
    // ones: it is authored in the markup, it never leaves, and only its text
    // changes, so the words are there to be read whether or not a reader can see
    // which button is greyed. A failed load keeps the waiting sentence rather
    // than falling back to "No filters applied." — no filters are applied, but
    // saying so on a screen with no feed behind it reads as a working row, and
    // the honest fact is the one the controls are actually in: they are shut,
    // and they open when posts load, which is what Retry is there to do.
    const filtersOpen = filtersAvailable(phase);
    setFilterAvailability(filtersOpen, {
      controls: [nameFilter, timeFilter, clearFilters],
      statusRegion: feedState ?? feed,
      hintHost: root.querySelector(".social-toolbar"),
      hintId: "post-filter-hint",
      hintText: filterStatusLine({ available: filtersOpen, ...named }),
      hintPersists: true,
    });
    // And the reset follows what that sentence says. With both menus on "all"
    // there is nothing to clear, so the button is not a control a reader can
    // spend a Tab and a press on to no effect; it stays in the document and in
    // the accessibility tree as a named button either way, because a control
    // that disappears when it is inapplicable is a row that changes shape under
    // a reader. Focus is not dropped with it: pressing it is the one way to
    // arrive here standing on it, and the next named control in the row — the
    // display-name menu — is where that reader is put.
    if (clearFilters && filtersOpen && !filtering) {
      const standingOnIt = document.activeElement === clearFilters;
      clearFilters.disabled = true;
      if (standingOnIt) nameFilter?.focus();
    }
    // The count answers "how many posts are there", which this page can only
    // answer once a fetch has come back. While one is open there is no count
    // line at all — it used to wait out the fetch as "Counting posts…", a third
    // description of the one wait the status region was already reporting. A
    // failed load names itself rather than printing a zero that reads as an
    // empty feed. Every other state resolves to a literal number, and it is the
    // length of the array the cards were just rendered from, so the figure is
    // the count of posts on screen under whatever filters are set — and it is
    // spelled by the same function the summary sentence below spells its count
    // with, so the two lines on this screen cannot state one count in two shapes.
    if (count && phase !== "loading") {
      if (phase === "failed") count.textContent = "Unavailable";
      else count.textContent = shownPostsCount({ shown: visible.length, total: posts.length, filtering });
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

  };

  const renderNames = () => {
    if (!nameFilter) return;
    const selected = nameFilter.value;
    const authors = [...new Set(posts.map((post) => post.author))].sort((a, b) => a.localeCompare(b));
    nameFilter.replaceChildren(new Option("All display names", "all"), ...authors.map((author) => new Option(author, author)));
    nameFilter.value = authors.includes(selected) ? selected : "all";
  };

  // The post field's refusal, wired exactly as the image description's is: the
  // sentence lives in the slot that follows the field, the id joins the field's
  // aria-describedby only while the sentence is there, and aria-invalid arrives
  // and leaves with it. A field left marked invalid while it holds a valid value
  // is a lie, so there is one place that says so and one place that takes it
  // back.
  //
  // The description read here is the one the markup ships, so restoring it is a
  // restore and not a re-authoring of the hint and counter ids.
  const bodyDescribed = bodyInput?.getAttribute("aria-describedby") ?? "";

  const clearBodyError = () => {
    if (!bodyInput || !bodyError) return;
    bodyInput.removeAttribute("aria-invalid");
    bodyInput.setAttribute("aria-describedby", bodyDescribed);
    bodyError.replaceChildren();
    bodyError.hidden = true;
  };

  const showBodyError = (length) => {
    if (!bodyInput || !bodyError) return;
    renderFieldError(bodyError, overLengthPostMessage(length));
    bodyInput.setAttribute("aria-invalid", "true");
    bodyInput.setAttribute("aria-describedby", `${bodyDescribed} ${POST_BODY_ERROR_ID}`.trim());
  };

  const updateCounter = () => {
    if (!counter || !bodyInput) return;
    const state = counterState(bodyInput.value);
    counter.textContent = `${state.remaining}`;
    counter.classList.toggle("over", state.over);
    counter.classList.toggle("near", state.near);
    // The counter turning red and the button looking spent are the two halves of
    // this state a reader may never get. The sentence is the state, drawn beside
    // the field, arriving as the post crosses the budget and leaving as it comes
    // back under — the same moment the counter's own class flips, from the same
    // measurement, so the two cannot disagree about which side of 280 the post
    // is on.
    if (state.over) showBodyError(state.length);
    else clearBodyError();
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
    const firstLink = feed.querySelector(".post-author");
    (firstLink ?? heading)?.focus();
  };

  const focusPostCard = (id) => {
    const card = [...feed.querySelectorAll(".post-card")].find((item) => item.dataset.postId === id);
    card?.querySelector(".post-author")?.focus();
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

  const showFailure = (message, { retry = false } = {}) => {
    if (!notice) return;
    notice.classList.remove("is-success");
    notice.replaceChildren(
      stateChip(PUBLISH_STATE_WORDS.failed, "detail-state-chip-error"),
      document.createTextNode(` ${message} ${PUBLISH_FAILED_NOTE}${retry ? ` ${PUBLISH_RETRY_NOTE}` : ""}`),
    );
    if (retry) {
      const retryButton = el("button", "feed-status-action", PUBLISH_RETRY_LABEL);
      retryButton.type = "button";
      retryButton.addEventListener("click", () => submit?.click());
      notice.append(document.createTextNode(" "), retryButton);
    }
    notice.hidden = false;
  };

  // The outcome of the *last* press is not the state of this one. Cleared as a
  // publish starts, so the only thing describing the attempt in flight is the
  // button that started it — otherwise a retry runs under a region still
  // reading "Not published", and the reader is told two states at once.
  const clearNotice = () => {
    if (!notice) return;
    notice.replaceChildren();
    notice.classList.remove("is-success");
    notice.hidden = true;
  };

  // True from the moment a request leaves until it comes back. `disabled` on the
  // submit button is the visible half and it is not the whole guard: Enter in a
  // single-line field, and the post field's Cmd/Ctrl+Enter shortcut, both submit
  // the form without going through that button. This is what makes a second press
  // impossible rather than merely inconvenient.
  let publishing = false;

  const setSubmitting = (submitting) => {
    publishing = submitting;
    if (!submit) return;
    submit.disabled = submitting;
    submit.setAttribute("aria-busy", String(submitting));
    if (submitLabel) submitLabel.textContent = submitting ? "Publishing…" : "Publish post";
  };

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
      // One press, one post. A submit that arrives while one is already in
      // flight is dropped here rather than queued: the composer still holds the
      // same draft, so queuing it would publish the same post twice.
      if (publishing) return;
      if (!form.reportValidity()) return;

      // Over the budget, refused here rather than by createPost below. The
      // sentence is already beside the field — the counter's own input handler
      // put it there as the post crossed 280 — so this press only has to make
      // the refusal true: no post is created, and the reader is put on the
      // field to cut down. Announcing it a second time in the notice at the foot
      // of the form would answer one press twice, in two places, and `maxlength`
      // is not the guard: it stops a key press, not a paste, a restored draft,
      // or a handoff, and this is the check that decides whether a post exists.
      const budget = counterState(bodyInput?.value);
      if (budget.over) {
        showBodyError(budget.length);
        bodyInput?.focus();
        return;
      }

      let post;
      let media;
      try {
        post = createPost({ author: authorInput?.value, body: bodyInput?.value });
        media = options.getMedia?.() ?? null;
      } catch (error) {
        // reportValidity()/maxlength catch the empty and the over-long body, but
        // not a body of spaces — `required` is satisfied by whitespace — so the
        // blank refusal reaches this notice for real. The fallback is the belt:
        // an error that arrives with no message still says what happened.
        // Not "Write a post within the limit": "Write a post" is the label on
        // the control that opens this composer, so that sentence read as an
        // instruction to press a button the reader is already past. This one
        // names the field and the number instead.
        showFailure(error?.message
          || `That post could not be published. Enter a post of ${MAX_POST_LENGTH} characters or fewer.`);
        return;
      }

      // The one field the composer will not publish an image without. Refusing
      // here means no post is created and nothing else is touched: the post,
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
        clearNotice();
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
        // The failure arrives here as a value the composer can draw, never as an
        // exception that escapes into the console: the draft is untouched above
        // this line, so the same post can be sent again from where the reader
        // is standing.
        showFailure(error?.message || "This post could not be saved. Check the live connection.", { retry: true });
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
    // Handed back so the page can reveal the composer for the two arrivals that
    // ask for it by URL — a Paint handoff, and a cold load on #post-form.
    composer,
    seed(next) { posts = next ?? []; state = "ready"; renderNames(); render(); },
    // Loading/error are display states only — they never discard posts already
    // on screen, so a failed refresh degrades to "stale but readable".
    setState(next) { state = next; render(); },
    getPosts() { return [...posts]; },
  };
}
