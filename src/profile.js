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

import { connectionStatusLine, normalizeImage } from "./social.js";
import { OPEN_POST_LABEL, postDetailHref, profileHref } from "./social-links.js";
import { imageDescription, renderDescriptionNote, renderImageUnavailable } from "./image-description.js";
import { renderFeedStatus, feedPhase, feedPresence, setFilterAvailability } from "./feed-status.js";
import { DEFAULT_AUTHOR, MAX_AUTHOR_LENGTH } from "./social-identity.js";

// Social's three connection sentences with the noun this page shows, so the two
// pages differ in one word and nowhere else. Exported because profile-page.js
// writes the settled and the failed line over the one mountProfile renders.
export const profileConnectionLine = (state) => connectionStatusLine(state, "image posts");

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

// The name a forwarded link asked for. Any non-empty one counts, including a
// name longer than the limit every post on this site is written under
// (MAX_AUTHOR_LENGTH): no post can carry such a name, which makes it a display
// name with zero image posts — a state this page already draws, under the name
// that was asked for — rather than a reason to answer under somebody else's.
// It used to be dropped at the door, and the page then landed on whichever name
// had the most pictures, or on "Guest" when nothing had any, with nothing on it
// saying the name in the link had gone. Trimmed, never truncated: a shortened
// name is a different name, and this one is repeated back verbatim.
const requestedName = (param) => String(param ?? "").trim();

// The name this browser last posted under. The limit stays here, because this
// one is a name the visitor may still publish with, and rememberAuthor
// (src/social-identity.js) refuses to store one over the limit anyway.
function rememberedName(stored) {
  const name = String(stored ?? "").trim();
  return name && name.length <= MAX_AUTHOR_LENGTH ? name : "";
}

// Whose profile this is. An explicit ?author= wins so a profile is linkable and
// shareable; otherwise it falls back to the name this browser posts under, and
// finally to the landing name this feed suggests (defaultProfileAuthor below).
// `authors` is the last resort, for a feed that holds posts but no images.
export function resolveProfileAuthor({ param, stored, authors = [], preferred = null } = {}) {
  const requested = requestedName(param);
  if (requested) return requested;
  const remembered = rememberedName(stored);
  if (remembered) return remembered;
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
  return Boolean(requestedName(param) || rememberedName(stored));
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
  // The image-post figure is the picker's figure: the same selector, asked the
  // same question, rather than a second `post.image` test written out here. Two
  // rules for "is this an image post?" is how the number beside "Newest first"
  // and the number printed on the chip that promised it drift apart, and the
  // chip is a promise about the grid this line is counting.
  const withImages = selectProfilePosts(posts, author).length;
  return {
    total: mine.length,
    withImages,
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
// survives greyscale, inversion, and forced colours. "Selected" distinguishes
// the current option while its action still says exactly what the filter does.
export const SELECTED_MARK = "✓ Selected:";

// What one entry in the picker reads. The count is part of the button's text —
// a button's accessible name is its text — so the picker says which names have
// something to show before a reader has to try them one by one, and a screen
// reader hears the count with the name rather than beside it. Same count
// phrasing and the same separator the rest of this page uses.
export function authorChipLabel(name, images, { selected = false } = {}) {
  const count = images === null || images === undefined ? COUNTING_LABEL : countLabel(images, "image post");
  return `${selected ? `${SELECTED_MARK} ` : ""}Filter People to ${name}’s image posts · ${count}`;
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

// The line over the picker: how to change what is showing, and whether the page
// chose the current name or the visitor did. Landing with no ?author= used to
// state a verdict about a name nobody had picked, so this says the preselection
// out loud and points at the control that undoes it. A shared link or a
// remembered name is a choice, and claiming to have preselected one would be
// untrue, so that clause is only ever written for a visitor who asked for
// nobody.
//
// It no longer opens on "Showing <name>'s image posts." The selected chip below
// carries that name with a "✓ Selected:" mark on it, and the results region
// states it twice more, so this line was the fourth telling of one fact and the
// second full sentence claiming to be the page's answer. The author is still
// taken, and ignored, because every caller renders this beside a name.
//
// `choices` is how many entries the picker offers. With one there is nothing to
// switch to, so there is no instruction to give and singleNameNotice() below
// carries the fact instead.
export function pickerNoteText(author, { preselected = false, choices = 2 } = {}) {
  if (choices < 2) return "";
  if (preselected) return "We preselected a name for you; pick another below to switch.";
  return "Pick another name below to switch.";
}

// A picker holding one entry is not a choice, and a lone chip drawn as one reads
// as a choice the visitor failed to make. The sentence states the fact in the
// place the buttons would have taken, so nothing is hidden by the swap — the
// name and its situation are still text on the page.
//
// `counted` is the store's own answer, the same three-state rule the chips use:
// before it lands, the sentence names the feed's one display name without
// claiming anything about how many pictures are under it.
export function singleNameNotice(entries, { counted = true } = {}) {
  if (!Array.isArray(entries) || entries.length !== 1) return null;
  const { name, images } = entries[0];
  if (counted && images > 0) return `Only one display name has image posts: ${name}.`;
  return `Only one display name is in this feed: ${name}.`;
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

// The grid's first-load status says exactly what People is retrieving and names
// the selected display name. The name is interpolated as text, never markup.
//
// It does not guess a count: the page ships this line as static markup for
// the frame before hydration, where it once shipped "Ari hasn't posted an image
// yet", a verdict that was false for the seeded feed.
export function loadingSummaryText(author = DEFAULT_AUTHOR) {
  return "Loading image posts…";
}

// The counts line when the selected display name has nothing to show. It states
// the situation without naming anyone, because the heading directly above it
// does — "Nova · 0 image posts" — and this line is read against it.
// emptySummaryText() above still carries the name, because the one place that
// wording still lands is the polite announcement, which has no page around it to
// borrow a subject from.
export const EMPTY_SUMMARY_LINE = "No image posts under this display name yet.";

// The counts line beside the ordering label, and the one place on the page that
// states the image-post total. The results panel used to repeat it in a chip
// beside its heading, so an empty name printed "hasn't posted an image yet" and
// "0 image posts" on the same render, in two voices, one of them a bare number
// a first-time visitor could not tell from a broken feature.
//
// An author with posts but no images reads "0 image posts · 3 posts in total",
// so the counts carry the "you posted, just without pictures" case that the
// empty state used to spell out in prose.
//
// It takes no display name: this line is read under a heading that has already
// named one, and naming it again here was the third visible copy of it.
export function profileSummaryText(summary) {
  if (summary.total === 0) return EMPTY_SUMMARY_LINE;
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

// The identity line under the heading: what the page is showing, in the words a
// visitor would use for it. It read "People is filtered to Ari." — the system's
// account of its own state, naming a filter the reader had to already understand
// and a surface rather than the pictures. It now says the result: how many image
// posts are on screen and whose name they were published under.
//
// The count is the length of the array the tiles are drawn from, handed down by
// the caller, so this sentence and the grid cannot disagree. It spells the count
// with countLabel, the way the heading, the chips and the live region do, so "1
// image post" never lands as "1 image posts".
//
// A null count is the page not having counted yet — the pre-hydration frame and
// a load still in flight — so the line names the display name and stops rather
// than claiming a number, and the same rule keeps it from printing an empty
// verdict over a feed that has not answered. A settled zero is a different fact
// and reads as one, in the same voice; the empty state below the grid still
// carries what to do about it, unchanged.
export function profileActiveFilterLine(author, count = null) {
  const name = String(author ?? "").trim() || DEFAULT_AUTHOR;
  if (count === null || count === undefined) return `Showing image posts published as ${name}.`;
  if (count === 0) return `${name} has no image posts yet.`;
  return `Showing ${countLabel(count, "image post")} published as ${name}.`;
}

// What the live region announces after a refresh settles. It mirrors what the
// grid now shows rather than composing a fourth variant of the same news.
//
// It is Social's settled sentence with this page's noun in it: same verb, same
// word order, same closing clause — "Showing 12 posts, newest first." there,
// "Showing 3 image posts by Ari, newest first." here. A reader who has read one
// feed can read the other without learning a second sentence, and the ordering
// travels with the count instead of being a fact only the sighted eyebrow above
// the grid carries.
export function profileAnnouncement(author, visibleCount) {
  if (visibleCount > 0) return `Showing ${countLabel(visibleCount, "image post")} by ${author}, newest first.`;
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
  // The tile is the control, and this is the word printed on it — the same two
  // words Social's cards print (src/social-links.js owns them) and the same two
  // the lead sentence on both pages tells a reader to look for. It used to say
  // "View full post on Social", which named a destination rather than an action
  // and named a different one from the feed's, so the two pages offered the same
  // step under two labels and neither matched the sentence above the grid.
  const destination = el("span", "profile-tile-link-label", OPEN_POST_LABEL);
  link.append(figure);

  const meta = el("p", "profile-tile-meta");
  const time = el("time", "profile-tile-date", formatDate(post.createdAt));
  time.dateTime = post.createdAt;
  meta.append(time);
  meta.append(el("span", "profile-tile-stat", `${countLabel(post.likes, "like")} · ${countLabel(post.comments, "comment")}`));
  link.append(meta, destination);

  // Which post first, then what the tile does, quoting the words printed on it
  // so a reader who hears the name can find the control by sight.
  link.setAttribute("aria-label", `${captionFor(post)} — ${OPEN_POST_LABEL}`);
  item.append(link);
  return item;
}

// First-load placeholders. Hidden from assistive tech because the live region on
// the page announces the real status; a shimmering box announces nothing.
function renderSkeleton(container, author, count = 6) {
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

// The retry control's whole job has to be in its own text: a button reading
// "Try again" is announced as two words with no object, and this page carries a
// second control ("Create an image in Paint") that also acts on the grid. What
// it retries is what the message above it just failed at.
export const PROFILE_RETRY_LABEL = "Retry loading image posts";

// The filtered dead end, and the reason it is not the empty state. People is a
// filtered view of Social, and the display-name picker is the filter: a name
// with no pictures under it while other names have plenty is a full feed you
// have narrowed to nothing, not a site with nothing on it. It says so in its
// own words, and hands over the same reset Social's no-match panel does.
//
// The way out is Social's sentence with this page's noun in it: "Select Clear
// filters to see all 9 posts." there (noMatchGuidance, src/social.js), the same
// shape here. It names the control by the exact words printed on it — a reader
// told to "clear filters" on a page whose filter is a row of display-name chips
// has to go looking for a control that word does not obviously belong to — and
// it says what pressing it will show, because People's reset does not restore
// "everything": it lands on the display name this feed opens on. "Clear filters
// to show them" claimed neither.
//
// It names that destination and not the display name showing: this page keeps
// the selected name to two visible elements in the results region (the heading
// and the identity line), so the sentence above it states the situation without
// a name, exactly as the counts line does.
export const PROFILE_CLEAR_FILTERS_LABEL = "Clear filters";
export const PROFILE_NO_MATCH_LINE = "No image posts match the selected display name.";

export function profileNoMatchGuidance(clearTo) {
  const name = String(clearTo ?? "").trim();
  return name
    ? `Select ${PROFILE_CLEAR_FILTERS_LABEL} to see ${name}’s image posts.`
    : `Select ${PROFILE_CLEAR_FILTERS_LABEL} to see the image posts under another display name.`;
}

function renderError(container, onRetry) {
  const failed = renderFeedStatus(container, {
    state: "error", label: "People feed error", text: "Image posts could not be loaded.",
    detail: "The selected display-name filter is unchanged. Retry loading image posts.",
    actionLabel: PROFILE_RETRY_LABEL, onAction: onRetry,
  });
  failed.classList.add("empty-state", "empty-state-error");
  failed.querySelector?.(".feed-status-value")?.classList.add("empty-title");
  failed.querySelector?.(".feed-status-action")?.classList.add("empty-action");
}

function renderNoMatch(container, { onClearFilters, clearTo }) {
  const panel = renderFeedStatus(container, {
    state: "filtered", label: "People filter result",
    text: PROFILE_NO_MATCH_LINE, detail: profileNoMatchGuidance(clearTo),
    actionLabel: PROFILE_CLEAR_FILTERS_LABEL, onAction: onClearFilters,
  });
  panel.classList.add("empty-state", "empty-state-filtered");
  panel.querySelector?.(".feed-status-value")?.classList.add("empty-title");
  panel.querySelector?.(".feed-status-action")?.classList.add("empty-action");
}

// `state` keeps three situations apart that must never share one empty state:
// still loading, loaded and genuinely empty, and failed. Posts already on screen
// always win over a pending or failed refresh — stale content beats a spinner
// over content the reader could already see.
export function renderProfileGrid(container, posts, options = {}) {
  const {
    state = "ready", onRetry = null, author = DEFAULT_AUTHOR, statusRegion = container,
    total = null, onClearFilters = null, clearTo = "",
  } = options;
  const ordered = sortNewestFirst(posts ?? []);
  container.replaceChildren();
  container.setAttribute("aria-busy", state === "loading" && ordered.length === 0 ? "true" : "false");
  if (statusRegion !== container && state === "error") {
    renderFeedStatus(statusRegion, {
      state: "error", label: "People feed update failed",
      text: "Showing the image posts already loaded.",
      detail: "The selected display-name filter is unchanged. Retry loading newer image posts.",
      actionLabel: PROFILE_RETRY_LABEL, onAction: onRetry,
    });
  } else if (statusRegion !== container) {
    statusRegion.replaceChildren();
    statusRegion.hidden = false;
  }

  // `total` is the whole feed behind the display-name filter, and a clear
  // handler is what makes the filtered dead end recoverable. A caller that
  // passes neither — the render-layer tests, and any surface with no picker —
  // gets the old three states, because with no filter there is nothing to have
  // been filtered out.
  const filtering = Boolean(onClearFilters) && total !== null && total > 0;
  const phase = feedPhase({ state, total: total ?? ordered.length, visible: ordered.length, filtering });

  if (ordered.length === 0) {
    if (phase === "loading") {
      renderFeedStatus(statusRegion, {
        state: "loading", label: "People feed loading", text: loadingSummaryText(author),
        append: statusRegion === container,
      });
      renderSkeleton(container, author);
    } else if (phase === "failed") renderError(statusRegion, onRetry);
    else if (phase === "filtered-empty") renderNoMatch(statusRegion, { onClearFilters, clearTo });
    else renderEmpty(statusRegion, author);
    return;
  }

  if (statusRegion !== container) {
    statusRegion.replaceChildren();
    statusRegion.hidden = true;
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
//
// One entry is the exception: a feed carrying a single display name has no
// choice in it, so the sentence replaces the button rather than drawing a
// control whose only value is already selected.
//
// `disabled` is the state where there is nothing to filter: a fetch still open,
// a feed that came back empty, or one that failed. The chips carry the real
// attribute then, so they leave the tab order instead of standing there as
// controls that silently do nothing — and on a failed feed that is what leaves
// the panel's Retry as the next stop after the message. They come back the
// moment posts exist.
//
// Everything about that state goes through the shared helper Social's menus use
// (src/feed-status.js): the property, `aria-disabled`, the one sentence saying
// why, and the focus rescue — a reader standing on a chip when the feed goes
// back to loading is moved to the status region rather than dropped to <body>,
// which is a real path here because selecting a name rebuilds every chip.
export const PROFILE_FILTERS_UNAVAILABLE_HINT = "Display names become available when image posts load.";

export function renderAuthorPicker(container, entries, { author, counted = true, onSelect = null, disabled = false, statusRegion = null } = {}) {
  const alone = singleNameNotice(entries, { counted });
  const chips = alone ? [] : entries.map((entry) => {
    const selected = entry.name === author;
    const chip = el("button", "profile-filter-option", authorChipLabel(entry.name, counted ? entry.images : null, { selected }));
    chip.type = "button";
    chip.dataset.author = entry.name;
    chip.setAttribute("aria-pressed", selected ? "true" : "false");
    if (onSelect) chip.addEventListener("click", () => onSelect(entry.name));
    return chip;
  });
  // Before replaceChildren, so the focus check still sees the chip the reader
  // is standing on; the hint goes above the row, where this group already puts
  // the words that describe the controls under them.
  setFilterAvailability(!disabled || alone, {
    controls: chips,
    statusRegion,
    focusHost: container,
    hintHost: container.parentNode,
    hintBefore: container,
    hintId: "profile-filter-hint",
    hintText: PROFILE_FILTERS_UNAVAILABLE_HINT,
    hintClass: "hint profile-toolbar-hint",
  });
  if (alone) {
    container.replaceChildren(el("p", "hint", alone));
    return;
  }
  container.replaceChildren(...chips);
}

// The profile header that opens the results region — avatar, heading,
// active-filter chip — plus the counts line under it that explains what the grid
// is showing, empty case included.
//
// The heading (profileResultsHeading, written in mountProfile from the same list
// the tiles come from) states the selected name and the number of tiles; the
// chip states in a sentence what the grid beside it is showing
// (profileActiveFilterLine). Those two are the whole visible budget for the
// display name in this region, so nothing else written here carries it: the
// avatar is initials and is hidden from assistive technology, so the name is
// announced once and never as the word "AR", and the counts line puts the image
// posts next to the posts in total and the last posting date without naming
// anybody.
//
// `count` is the number of tiles the caller is about to draw, or null while the
// page has nothing settled to count. The header does not derive it: mountProfile
// holds the one filtered array, and a second count taken here could drift from
// the one on screen.
export function renderProfileHeader(elements, author, summary, { count = null } = {}) {
  if (elements.avatar) {
    elements.avatar.textContent = authorInitials(author);
    elements.avatar.setAttribute("aria-hidden", "true");
  }
  if (elements.name) elements.name.textContent = profileActiveFilterLine(author, count);
  if (elements.summary) elements.summary.textContent = profileSummaryText(summary);
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
    heading: root.querySelector("#grid-title"),
    status: root.querySelector("#profile-status"),
    feedStatus: root.querySelector("#profile-feed-status"),
    announcer: root.querySelector("#profile-announcer"),
    picker: root.querySelector("#profile-author"),
    pickerNote: root.querySelector("#profile-picker-note"),
    // The one route into Paint: the invitation above the grid. It is a real
    // anchor in the markup and stays one whether or not this runs; all that is
    // added here is the display name, so Paint's back link returns to the
    // profile that was actually being read rather than the default display
    // name. The hero used to carry a second copy of the same offer, four words
    // and one label identical to this one.
    paintRoutes: [root.querySelector("#profile-paint-route")].filter(Boolean),
  };

  // The three lines this page may only say once a fetch has answered: the count,
  // the promise about image posts arriving on their own, and the invitation to
  // put a picture in a grid nobody has seen yet. All three used to sit on screen
  // beside "Loading image posts…", so one wait was narrated four times. They
  // leave the document while the feed is loading — absent, not hidden, because a
  // hidden line is still text a screen reader can be walked through.
  const waiting = [
    feedPresence(elements.summary),
    feedPresence(root.querySelector(".feed-create")),
  ];
  // The connection line ships empty and `hidden` (src/profile.html) so the frame
  // before this module runs says one thing: that the image posts are loading.
  // The attribute is dropped once, here, and presence decides the rest.
  const connection = root.querySelector(".feed-connection");
  connection?.removeAttribute("hidden");
  const connectionLine = feedPresence(connection);

  let posts = options.posts ?? [];
  let state = options.state ?? "ready";
  let author = options.author ?? DEFAULT_AUTHOR;
  // Whether the name on screen is the page's suggestion or the visitor's. It
  // starts as whatever the wiring worked out from the URL and the remembered
  // name, and only choose() below can clear it: a landing name that moves when
  // the live feed answers is still a name nobody picked.
  let preselected = options.preselected ?? false;

  const render = () => {
    const mine = selectProfilePosts(posts, author);
    const summary = profileSummary(posts, author);
    // The heading and the identity line are both written from `mine`, the same
    // array the tiles are rendered from further down, in this one update — so the
    // name they state and the number they state are the name and the number on
    // screen, and neither can move without the tiles.
    //
    // A number only where the page has a settled answer behind it: a finished
    // load, or, after a failed refresh, the tiles still on screen from the last
    // one. While the first load is in flight there is nothing to count — the
    // picker says "Counting…" in that frame, and a line claiming a number beside
    // it would contradict it — and a failed load with an empty grid states no
    // zero it cannot support.
    const counted = state === "ready" || (state === "error" && mine.length > 0);
    renderProfileHeader(elements, author, summary, { count: counted ? mine.length : null });
    if (elements.heading) {
      elements.heading.textContent = profileResultsHeading(author, counted ? mine.length : null);
    }
    // The connection line until the first fetch answers and profile-page.js
    // writes the settled one over it. The markup ships it wordless, so this is
    // also where a page whose data layer never answers gets its one sentence:
    // while the first fetch is open, and whenever the line comes back blank. It
    // states what the connection will give the reader and leaves the wait to the
    // line over the grid, which is the page's one statement that the image posts
    // are still loading — and presence below keeps the two apart, because a
    // sentence written into a line that is off the page is not read out. It
    // names nobody: the heading above states whose posts are being counted, so a
    // reader who switches names mid-load reads one moved heading rather than a
    // display name repeated down the region.
    if (elements.status && (state === "loading" || !elements.status.textContent)) {
      elements.status.textContent = profileConnectionLine("connecting");
    }
    // The line above the picker, written from the same name the heading states,
    // so the page never says one name is showing while another is filtering.
    if (elements.pickerNote) {
      elements.pickerNote.textContent = pickerNoteText(author, { preselected, choices: pickerEntries(posts, author).length });
    }
    for (const route of elements.paintRoutes) route.href = profilePaintHref(author);
    // The one case where an empty grid is a filtered feed rather than an empty
    // one: some other display name in this feed does have image posts, so the
    // reader has narrowed a full feed to nothing and there is somewhere to
    // clear back to. With no such name, nothing was filtered out and the empty
    // state is the honest answer.
    const elsewhere = defaultProfileAuthor(posts);
    const recoverable = Boolean(elsewhere) && elsewhere !== author;
    renderProfileGrid(grid, mine, {
      state,
      onRetry: options.onRetry,
      author,
      statusRegion: elements.feedStatus ?? grid,
      total: recoverable ? posts.length : 0,
      onClearFilters: recoverable ? () => clearFilters(elsewhere) : null,
      // The name the reset lands on, so the panel can say what pressing its
      // control will show rather than promising a feed it does not restore.
      clearTo: recoverable ? elsewhere : "",
    });
    const phase = feedPhase({
      state, total: recoverable ? posts.length : mine.length, visible: mine.length, filtering: recoverable,
    });
    for (const line of waiting) line.present(phase !== "loading");
    // The promise speaks only where there is a grid for new image posts to
    // arrive in: one with tiles, and one waiting for its first. "New image posts
    // will appear here on their own." over a grid the picker has emptied gives
    // the wrong reason for the empty screen and asks the reader to wait, when
    // what they need is the one control the panel below is holding out; over a
    // failed load it is a second instruction beside the panel's Retry; and over
    // an open fetch it is a promise standing on the line that is already saying
    // the image posts are still loading.
    connectionLine.present(phase === "loaded" || phase === "empty");
    // The page's one voice carries the panel's way out. An empty grid with
    // pictures under other display names is a filtered dead end, so the
    // announcement offers the reset rather than the invitation into Paint that
    // the visible region no longer offers here — and it names both display names
    // the reader is standing between, because an announcement has no page around
    // it to borrow a subject from.
    if (elements.announcer && state === "ready") {
      elements.announcer.textContent = phase === "filtered-empty"
        ? `${emptySummaryText(author)} ${profileNoMatchGuidance(elsewhere)}`
        : profileAnnouncement(author, mine.length);
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
      // Nothing to filter until the feed holds something: a chooser offered over
      // a pending, empty, or failed feed is a row of controls that cannot change
      // what is on screen.
      disabled: state !== "ready" || posts.length === 0,
      // Where focus lands if the reader was standing on a chip when it went
      // away: the line that just changed under them, over the grid.
      statusRegion: elements.feedStatus ?? grid,
      onSelect: choose,
    });
    // Selecting rebuilds the chips, so the button that was just pressed is
    // gone. Focus its replacement, or a keyboard reader is dropped back to the
    // top of the document after every choice.
    if (refocus) elements.picker.querySelector('[aria-pressed="true"]')?.focus();
  };

  // The reset behind the filtered dead end's Clear filters control: it puts the
  // picker back on the display name this feed actually opens on — the one a
  // visitor who chose nobody would have landed on — which restores the full grid
  // and returns the page to its loaded state. Focus moves with it, because the
  // button that ran this sits inside the panel the restored tiles replace, and
  // leaving focus on a removed node drops a keyboard reader to the top of the
  // document. It lands on the first restored tile, or on the chip choose()
  // already focused when there is no tile to land on.
  function clearFilters(next) {
    choose(next);
    grid.querySelector(".profile-tile")?.focus();
  }

  function choose(next) {
    if (next === author) return;
    author = next;
    preselected = false;
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
