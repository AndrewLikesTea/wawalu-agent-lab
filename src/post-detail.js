// Single-post detail view — where a profile tile goes.
//
// Deliberately small: it is the destination that makes the grid's tiles real
// links rather than decoration. Same split as everywhere else in Shiplog, a pure
// core (resolution) plus a rendering layer, and the same rule about text —
// textContent only, never an HTML string.
//
// Four states, and exactly four: loading, loaded, not-found, error. They are
// mutually exclusive by construction rather than by CSS — renderPostDetail()
// empties the region and fills it with one branch, so an inactive state has no
// node in the document at all. Hiding one instead would leave its heading in
// the heading count and reachable by a screen reader, which is the bug this
// shape exists to make impossible.
//
// not-found and error are different answers and say different things: the feed
// answered and had no such post, versus the feed could not be reached. Only the
// second offers a retry, because only the second can come out differently.

// Relative, not root-absolute: this module is imported by `node --test` as well
// as by the browser, and only a relative specifier resolves in both.
import { captionFor, countLabel, profileHref } from "./profile.js";
import { renderImageUnavailable } from "./image-description.js";
import { pageTitle, recordTitle } from "./page-title.js";
import { normalizeImage } from "./social.js";

// The two routes out of a permalink, named once and shipped in src/post.html.
//
// Neither is a "back". A permalink is the one page in this product a visitor can
// meet cold — pasted into a chat window, opened by someone who has never seen
// Social — and there is nothing behind them to return to. So both links point
// forward, name their destination, and say what is there, in the verb the two
// feed pages already use for each other ("Open People when you want…", "Open
// Social when you want…"). The label says People, not Profile: this site has a
// People page and no page called Profile.
//
// The labels are constants because nothing may rewrite them mid-visit. They are
// pinned against src/post.html, which ships both links. Social stands in all
// four states. People is withdrawn by post-page.js in not-found and error,
// where there is no post and so no display name its words can be about — the
// label is never softened to fit a state, it is simply not offered in one.
export const POST_EXITS = {
  social: { href: "/social.html", label: "Open Social to read the whole feed" },
  people: { href: "/profile.html" },
};
const MAX_RETURN_AUTHOR_LENGTH = 60;

export function postPeopleLabel(author = "") {
  const name = String(author).trim();
  return name && name.length <= MAX_RETURN_AUTHOR_LENGTH ? `Open People to see ${name}’s other image posts` : "";
}

// Where the People link goes. The words promise one display name's image posts,
// so the destination narrows to that name whenever the page can honestly name
// one — from the loaded post first, and otherwise from the ?author= that
// profile.js writes into its tiles. With no usable name it is People plainly,
// rather than a filter parameter standing for a name nobody supplied. An author
// string longer than a display name can be is not a name.
export function postPeopleHref(search = "", author = "") {
  const params = new URLSearchParams(String(search).replace(/^\?/, ""));
  const name = String(author || params.get("author") || "").trim();
  return name && name.length <= MAX_RETURN_AUTHOR_LENGTH ? profileHref(name) : POST_EXITS.people.href;
}

export function findPostById(posts, id) {
  const wanted = String(id ?? "").trim();
  if (!wanted) return null;
  return (posts ?? []).find((post) => post?.id === wanted) ?? null;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDateTime(iso) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

// The page carries both standing exits in src/post.html, named by POST_EXITS
// above. An unavailable-post state also owns an explicit return action so the
// next step remains visible beside the explanation.

// One title and one sentence per resolved state, in the same shape the decision
// detail uses: a status chip, a heading that names the state, then a single line
// saying what is happening. Nothing here reports a status code, an id, or an
// exception — none of those tell a reader what to do next.
//
// `tone` picks the chip's colour. Every chip here reports the outcome of a
// lookup that just happened, which is a dynamic signal, so all of them are
// filled washes rather than outlines — the outline is this site's mark for a
// standing classification (see the note above .sample-badge in evolution.css).
// The word in the chip is the signal; the wash only agrees with it.
//
// `empty` is not a fifth state. It is the not-found state's wording for the one
// case where no id was asked for at all, and it renders under the same
// data-post-state-panel="not-found" as any other post that could not be found.
//
// It is headed by that state's words too. It used to read "Post status" /
// "Choose a post": a neutral chip and an instruction, which named neither what
// happened nor what this page is. A link arriving with no id, a truncated id,
// or an id nobody ever posted under are one answer as far as a reader is
// concerned — the link did not reach a post — so all three are headed "Post
// not found" and chipped with the same live word. Only the sentence underneath
// differs, because only it can say the true thing about *this* link.
const POST_STATE_COPY = {
  empty: {
    state: "not-found",
    className: "detail-state-not-found",
    tone: "missing",
    label: "Not found",
    title: "Post not found",
    description: "This link did not name a post to open, so there is nothing to show. Social is a shared demo feed, not a signed-in account.",
  },
  "not-found": {
    state: "not-found",
    className: "detail-state-not-found",
    tone: "missing",
    label: "Not found",
    title: "Post not found",
    description: "This post was not found. It may have been removed, or the link may point at a post that never existed. Social is a shared demo feed, not a signed-in account.",
  },
  // The error state names the thing that broke — the feed — rather than
  // describing the post as "unavailable", which reads as a verdict about the
  // post and tells a reader nothing about whether waiting would help.
  error: {
    state: "error",
    className: "empty-state-error detail-state-unavailable",
    tone: "error",
    label: "Unreachable",
    title: "Post could not be loaded",
    description: "The Social feed could not be reached, so this post could not be loaded. Social is a shared demo feed, not a signed-in account.",
  },
};

function labelledState(key, actions = []) {
  const copy = POST_STATE_COPY[key] ?? POST_STATE_COPY.error;
  const node = el("div", `empty-state detail-state-panel detail-state-message ${copy.className}`);
  const heading = el("h2", "empty-title", copy.title);
  heading.id = `post-state-${key}-title`;
  node.setAttribute("role", copy.state === "error" ? "alert" : "status");
  node.setAttribute("aria-labelledby", heading.id);
  node.setAttribute("data-post-state-panel", copy.state);
  node.append(
    el("p", `detail-state-label detail-state-chip detail-state-chip-${copy.tone}`, copy.label),
    heading,
    el("p", undefined, copy.description),
  );
  // A state offers the actions it owns — retrying a failed load, or reaching the
  // feed when the standing exit leads somewhere else. The way *back* is still
  // the standing link, and these come after the words that explain them.
  for (const action of actions.filter(Boolean)) node.append(action);
  return node;
}

// Every unavailable requested-post panel links to the feed itself. Keeping the
// action with the state makes the next step explicit even when the standing
// exit above leads to the same place.
function feedAction() {
  const link = el("a", "empty-action empty-action-secondary detail-state-feed", "Return to the Social feed");
  link.href = POST_EXITS.social.href;
  return link;
}

// The image's accessible name, in one place, with one precedence:
//
//   1. what the poster wrote about the image, when they wrote anything;
//   2. otherwise the visible caption, which is the most useful true sentence
//      about the image this page has;
//   3. otherwise nothing — an empty alt, which marks the image decorative and
//      leaves it out of the accessibility tree rather than announcing "image"
//      or reading a filename aloud.
//
// Never a placeholder. A screen reader that says "image" has told the reader the
// one thing they already knew.
export function postImageAlt(image, caption) {
  const supplied = typeof image?.alt === "string" ? image.alt.trim() : "";
  if (supplied) return supplied;
  return String(caption ?? "").trim();
}

// The visible half of the description, and the only label it gets.
//
// The description a poster is required to write used to be readable by exactly
// one kind of reader: one using a screen reader, because it lived in an alt
// attribute and nowhere else. A sighted reader of the same post never saw it,
// and neither did anyone whose image loaded but who wanted to know what the
// poster said the image shows. On a permalink — the page opened cold from a
// pasted link — that is the difference between reading the post and guessing at
// it, so the description is drawn as text under the image, under a label saying
// what it is.
export const POST_IMAGE_DESCRIPTION_LABEL = "Image description";

// Read-time sibling of the composer's own preview failure in src/social-page.js
// ("We couldn't create a preview of the uploaded image. Remove the image, upload
// the file again, and check the preview before publishing."). Same voice, same
// first four words, same typographic apostrophe — and a different second half,
// because the two states can offer different things. The composer's reader holds
// the file and can upload it again; this one is reading somebody else's
// published post and can do nothing about it, so the sentence hands over the
// description instead of an instruction.
export const POST_IMAGE_FAILED_LINE = "We couldn’t show the image on this post, so the description the poster wrote stands in its place.";

// The same sentence for a post written before descriptions were required, where
// there is no description to stand in. It keeps the second half honest rather
// than promising text that is not there, and it still ends in the clause the
// older wording ended in, which is what a reader is actually owed here.
export const POST_IMAGE_FAILED_UNDESCRIBED_LINE = "We couldn’t show the image on this post, and the post carries no description of it.";

// One paragraph, two spans, and no new stylesheet rule: `.description-note` is
// the caption role this site already uses for exactly this text on the feed and
// on a People tile (subtitles & captions — ink-3, 11px, the monospace face), so
// the third surface that says it says it in the same type. Reused rather than
// re-declared: src/styles.css has no size headroom to spend on a fourth spelling
// of a rule that exists.
//
// The description is in a span of its own so it is one exact string — the same
// string that went into alt, byte for byte, which is what the parity test reads.
// Putting the label in the same text node would make the two impossible to
// compare and easy to let drift.
function renderImageDescription(description) {
  const note = el("p", "description-note detail-image-description");
  note.append(
    el("span", "detail-image-description-label", `${POST_IMAGE_DESCRIPTION_LABEL}: `),
    el("span", "detail-image-description-text", description),
  );
  return note;
}

// `description` is resolved by the caller — one value, used twice, so the alt
// attribute and the visible caption cannot drift apart. Passing the caption in
// and resolving it here would have meant resolving it twice.
function renderMedia(image, description) {
  const frame = el("div", "detail-media");
  frame.dataset.state = "loading";

  const img = document.createElement("img");
  img.className = "detail-image";
  img.src = image.src;
  img.alt = description;
  img.decoding = "async";
  if (image.width && image.height) {
    img.width = image.width;
    img.height = image.height;
  }

  // On the detail view the image is the point, so its failure note keeps the
  // description rather than discarding it with the element. It offers no way
  // out: the post itself still reads, and the standing back link is above it.
  //
  // The label used to be an <h2>, which put "Image unavailable" into this page's
  // heading outline as a peer of the post itself. It is the same marker the feed
  // and a People tile now draw (src/image-description.js), so it is the same
  // outline chip here — one shape for one fact, and one fewer heading claiming
  // to be a section of a page that has exactly one.
  //
  // What stands in the image's place is the description itself, unprefixed and
  // byte-identical to the alt above — the same string, not a copy of it with
  // "Description: " glued on, which was one more thing that could drift from the
  // labelled caption under the frame. Under it, one sentence naming what went
  // wrong in words, because a tinted box with an outline chip in it is a signal
  // a reader has to already know how to read.
  const chipId = "post-image-unavailable-title";
  const failed = description ? POST_IMAGE_FAILED_LINE : POST_IMAGE_FAILED_UNDESCRIBED_LINE;
  const fallback = renderImageUnavailable("detail-media-fallback", description || failed, { chipId });
  if (description) fallback.append(el("p", "detail-media-failed-line", failed));
  fallback.setAttribute("role", "status");
  fallback.setAttribute("aria-labelledby", chipId);
  fallback.hidden = true;

  const settle = (state) => {
    frame.dataset.state = state;
    fallback.hidden = state !== "error";
    if (state === "error") img.remove();
  };
  img.addEventListener("load", () => settle("ready"), { once: true });
  img.addEventListener("error", () => settle("error"), { once: true });
  if (img.complete) settle(img.naturalWidth > 0 ? "ready" : "error");

  frame.append(img, fallback);
  return frame;
}

// One next step, and exactly one: the feed. Whichever way a link failed to
// reach a post — no id, a truncated id, an id nobody posted under — the only
// thing this page can honestly offer is the feed the post would have been in.
// The id-less case used to offer nothing at all, on the grounds that the
// standing exit above already names Social; that left the state explaining a
// dead end without pointing anywhere out of it.
function renderMissing(container, id) {
  container.append(labelledState(id ? "not-found" : "empty", [feedAction()]));
}

// The retry is a real <button>, so it is in the natural tab order and picks up
// the site's own `button:focus-visible` ring with no extra rule. It is appended
// after the heading and the sentence that explain it — source order, not just
// visual order — so a screen reader reaches the explanation before the action.
function renderFailed(container, onRetry) {
  const retry = el("button", "empty-action detail-retry", "Retry");
  retry.type = "button";
  if (onRetry) retry.addEventListener("click", onRetry);
  container.append(labelledState("error", [feedAction(), retry]));
}

// The wait, in one place, because src/post.html ships this same line in its
// markup so the region is never blank before this module runs. Two spellings of
// one sentence would flash a rewrite at the reader on every visit; one exported
// string cannot. It no longer names Social — the h1 directly above it already
// reads "Post from Social", and the standing sentence under that says what
// Social is, so repeating the surface a third time bought nothing.
//
// It is the single-post form of FEED_LOADING_LINE in src/social.js ("Loading the
// Social feed…"), which is what Social and People say while the whole feed is in
// flight: same verb, same shape, same ellipsis, and the object swapped for the
// one thing this page is actually waiting on. Keep the two in step — a new verb
// here would put a third voice on the wait these three surfaces share.
export const POST_LOADING_LINE = "Loading this post…";

// Waiting is not one of the states above, and it does not get their furniture.
//
// It used to: a full banner with its own heading, its own sentence, and a 4:3
// shimmer block standing in for the image. On a page whose frame, heading and
// standing sentence are already drawn, that is a second page announcing itself
// on top of the first — and the placeholder was a guess at a shape (an image
// this post may not even have) that then shoved the real post down when it
// landed. One short labelled line in the post's own region says the same thing:
// something is coming, here, and it is this post. The dot is decorative and
// stops moving under prefers-reduced-motion; the sentence carries the state.
function renderLoading(container) {
  const status = el("p", "detail-loading detail-state-panel");
  status.setAttribute("role", "status");
  status.setAttribute("data-post-state-panel", "loading");
  const dot = el("span", "detail-loading-dot");
  dot.setAttribute("aria-hidden", "true");
  status.append(dot, el("span", "detail-loading-text", POST_LOADING_LINE));
  container.append(status);
}

// The four states, named once, in the order a load moves through them. Every
// other spelling of "what is this page showing" — the region's data-post-state,
// each panel's data-post-state-panel, the tab title — is derived from this list.
export const POST_STATES = ["loading", "loaded", "not-found", "error"];

// Which of the four a render is. Callers say what the *lookup* did — it is
// running, it finished, it threw — and the post itself decides the rest, so
// there is no way to ask for "error" and get a post, or to claim "loaded" with
// nothing to load. A fetch that came back empty-handed is not-found; only a
// fetch that could not complete is error. `ready` is the older spelling of "the
// lookup finished" and still resolves the same way.
export function resolvePostState(post, state = "ready") {
  if (state === "loading") return "loading";
  if (post) return "loaded";
  return state === "error" ? "error" : "not-found";
}

export function renderPostDetail(container, post, options = {}) {
  const { state: requested = "ready", id = "", returnHref = POST_EXITS.social.href } = options;
  // One state, chosen before anything is drawn. replaceChildren() empties the
  // region and exactly one branch below fills it, so the states cannot stack:
  // an inactive state is absent from the document rather than hidden, which is
  // what keeps its heading out of the page's heading count and out of reach of
  // a screen reader. src/post.html ships the region already marked "loading",
  // so the shipped markup and the first render agree.
  const state = resolvePostState(post, requested);
  container.replaceChildren();
  container.setAttribute("aria-busy", state === "loading" ? "true" : "false");
  container.dataset.postState = state;

  if (state !== "loaded") {
    if (state === "loading") renderLoading(container);
    else if (state === "error") renderFailed(container, options.onRetry);
    else renderMissing(container, id, returnHref);
    return;
  }

  const article = el("article", "detail-post detail-state-panel");
  article.setAttribute("data-post-state-panel", "loaded");
  // Focusable only on purpose, never by tabbing: post-page.js sends focus here
  // after a retry succeeds, so the reader lands on what they asked for instead
  // of at the top of the document. -1 keeps it out of the tab sequence, which
  // stays: back link, post content, then retry when there is one.
  article.setAttribute("tabindex", "-1");

  // Reading order, top to bottom: who posted, when, the image, the caption.
  //
  // The name is a link to that person's People view, and its text is the name
  // itself — not "profile", not "view profile", which would give a screen
  // reader a link list of identical labels and tell nobody whose profile it is.
  // It is the page's one forward step: without it a shared link is a dead end
  // whose only exit is back to the feed. The href is /profile.html?author=…,
  // the same shape profile-page.js writes into the address bar, rather than a
  // second URL vocabulary for the same view.
  const author = String(post.author ?? "").trim();
  if (author) {
    const byline = el("p", "detail-byline");
    const link = el("a", "detail-author-link", author);
    link.href = profileHref(author);
    byline.append(link);
    article.append(byline);
  }

  const time = el("time", "post-date detail-date", formatDateTime(post.createdAt));
  time.dateTime = post.createdAt;
  article.append(time);

  const caption = captionFor(post);
  // The page normally receives posts through profile.js's normalizers, but
  // this renderer is also an exported boundary. Recheck the URL at the final
  // browser sink so a future caller cannot turn an attacker-controlled image
  // field into a cross-origin request or an active data/javascript URL.
  const image = normalizeImage(post.image);
  if (image) {
    // figure/figcaption, so the caption is the image's caption to a screen
    // reader and not merely the paragraph that happens to sit under it.
    const figure = el("figure", "detail-figure");
    // Resolved once, here, and handed to both the image and the caption under
    // it. That is the whole of the alt-parity guarantee: there is one value, so
    // there is nothing for a second value to drift from. An empty result means
    // the post has neither a stored description nor a caption to fall back on —
    // a decorative image, which gets alt="" and no caption promising text that
    // does not exist.
    const description = postImageAlt(image, caption);
    // Whether there is a description to *label*, which is a narrower question
    // than what to put in alt. postImageAlt falls back to the visible caption
    // when a legacy post stored none, and that fallback is right for alt — the
    // caption is the truest sentence the page has about the image — but it is
    // not a description the poster wrote about the image, and printing it under
    // "Image description" would both claim that it is and say the same sentence
    // twice under one figure. So the labelled caption appears when, and only
    // when, the poster actually wrote one; where it appears it is `description`
    // itself, so it is still the identical string the alt attribute holds.
    const stored = typeof image.alt === "string" && image.alt.trim() !== "";
    figure.append(renderMedia(image, description));
    // An empty figcaption would announce a caption that is not there. A post
    // with neither caption nor body cannot come out of the normalizers, but the
    // renderer is handed plain objects and must not invent text either way.
    if (caption) {
      const figcaption = el("figcaption", "detail-caption", caption);
      figcaption.id = "detail-caption";
      figure.append(figcaption);
    }
    // The description closes the figure — image, what the poster said about the
    // post, then what they said about the image. It sits inside the figure
    // rather than after it because it is about the image and nothing else, and
    // it is deliberately not the figcaption: a figcaption joins the figure's
    // accessible name, and the description is already the image's alt, so
    // announcing it there would read the same sentence to a screen reader twice.
    if (stored) figure.append(renderImageDescription(description));
    article.append(figure);
    // A dedicated caption does not replace the post body, so show the body too
    // when they differ — otherwise the detail view would hide text the feed shows.
    if (post.caption && post.body && post.body !== post.caption) article.append(el("p", "detail-body", post.body));
  } else if (caption) {
    const body = el("p", "detail-body", caption);
    body.id = "detail-caption";
    article.append(body);
  }

  const stats = el("p", "detail-stats");
  stats.append(el("span", "detail-stat", countLabel(post.likes ?? 0, "like")));
  stats.append(el("span", "detail-stat", countLabel(post.comments ?? 0, "comment")));
  article.append(stats);

  if (caption) article.setAttribute("aria-labelledby", "detail-caption");
  container.append(
    article,
    el("p", "hint detail-identity", "A display name is not a signed-in user — nobody owns or verifies one, and anyone can publish under any name."),
  );
}

// The page heading names the post the way a reader would: by who wrote it. The
// post record carries no title of its own, so the poster's display name is the
// only durable name it has. It is written as "Post by <author>" rather than as
// the bare name, because a permalink is the one place a visitor arrives with no
// context: an h1 holding only a person's name reads as that person's profile,
// which is a different page in this product. It is also the exact phrase
// postDetailTitle() puts in the tab, so the heading and the tab name the same
// thing. The date and caption sit in the article underneath.
//
// With no author to name — while the lookup is still running, and afterwards if
// it found nothing — the heading names the page instead of standing as the bare
// word "Post", which says only what a reader can already see. "Post from Social"
// says which surface this one post came out of, which is the thing a visitor
// arriving on a pasted link does not know yet.
export function postPageHeading(post) {
  const author = post?.author?.trim();
  return author ? `Post by ${author}` : "Post from Social";
}

// Same shape as the decision detail's title — the record, then the surface the
// nav names, then the product. src/post.html ships titled "Post · Social ·
// Shiplog", which is what a reader sees until this runs.
//
// The title says what the panel says, including which of the two unresolved
// answers it is: a tab strip full of shared links should distinguish a post that
// is gone from one the feed could not be asked for.
export function postDetailTitle(post, state = "ready") {
  if (post?.author) return recordTitle(`Post by ${post.author}`, { surface: "Social", fallback: "Post" });
  return pageTitle(POST_STATE_COPY[resolvePostState(post, state)]?.title ?? POST_STATE_COPY["not-found"].title);
}
