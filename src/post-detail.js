// Single-post detail view — where a profile tile goes.
//
// Deliberately small: it is the destination that makes the grid's tiles real
// links rather than decoration. Same split as everywhere else in Shiplog, a pure
// core (resolution) plus a rendering layer, and the same rule about text —
// textContent only, never an HTML string.
//
// Four states, because they are four different things to a reader: loading,
// found, "no such post", and "the lookup failed". Collapsing the last two would
// tell someone their post was deleted when the network merely blinked.

// Relative, not root-absolute: this module is imported by `node --test` as well
// as by the browser, and only a relative specifier resolves in both.
import { captionFor, countLabel, profileHref } from "./profile.js";
import { pageTitle, recordTitle } from "./page-title.js";
import { normalizeImage } from "./social.js";

// Where "back" goes, read the way src/paint/paint.js reads the same thing: an
// explicit `from` written by the link that sent the reader here. One exit, named
// for one destination — the page used to ship two stacked back links, which left
// a reader to guess which one undid their last step.
//
// Anything we did not write is not provenance: no parameter, a parameter naming
// somewhere else, or an author string longer than a display name can be all fall
// back to the feed, which is where a shared link is honestly from.
export const DEFAULT_POST_RETURN = { href: "/social.html", label: "← Back to Social" };
const MAX_RETURN_AUTHOR_LENGTH = 60;

export function postReturnContext(search = "") {
  const params = new URLSearchParams(String(search).replace(/^\?/, ""));
  if (params.get("from") !== "profile") return DEFAULT_POST_RETURN;
  const author = (params.get("author") ?? "").trim();
  // The visitor did come from a profile, so the exit says so either way; only the
  // destination narrows to one author's profile when the name is usable.
  return {
    href: author && author.length <= MAX_RETURN_AUTHOR_LENGTH ? profileHref(author) : "/profile.html",
    label: "← Back to Profile",
  };
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

// The page carries exactly one standing exit, in src/post.html, named by
// postReturnContext above. No state renders a second way back — with one narrow
// exception, feedAction() below, for the reader whose exit does not lead to the
// feed and whose post is not there.

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
const POST_STATE_COPY = {
  empty: {
    className: "detail-state-not-found",
    tone: "neutral",
    label: "Post status",
    title: "Choose a post",
    description: "No post was specified. Open one from Social.",
  },
  "not-found": {
    className: "detail-state-not-found",
    tone: "missing",
    label: "Unavailable",
    title: "Post unavailable",
    // Second sentence names the way on: this state is the one place a reader can
    // land with nothing to read, and "browse Social" is true whichever route the
    // page is offering them — the standing exit when they came from the feed,
    // the feed link feedAction() adds when they came from a profile.
    description: "It may have been removed, or the link may be incomplete. Browse Social to find another post.",
  },
  error: {
    className: "empty-state-error detail-state-unavailable",
    tone: "error",
    label: "Error",
    title: "Post couldn’t be loaded",
    // Points at the retry button this state ships, and says the wait is worth
    // it: nothing here suggests the post is gone, because it probably is not.
    description: "We couldn’t reach Social, so this post didn’t load. Try again in a moment.",
  },
};

function labelledState(state, actions = []) {
  const copy = POST_STATE_COPY[state] ?? POST_STATE_COPY.error;
  const node = el("div", `empty-state detail-state-message ${copy.className}`);
  const heading = el("h2", "empty-title", copy.title);
  heading.id = `post-state-${state}-title`;
  node.setAttribute("role", state === "error" ? "alert" : "status");
  node.setAttribute("aria-labelledby", heading.id);
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

// The one case where a panel may link to Social itself.
//
// The standing exit is usually the feed, and then this adds nothing and renders
// nothing: one link to Social on the page, never two. But a reader who arrived
// from a profile has an exit that goes back to that profile, and if the post
// they clicked is gone, nothing on the page reaches the feed the post belonged
// to. That reader gets this link, and only in the states where the post is not
// there to read.
function feedAction(returnHref) {
  if (String(returnHref ?? DEFAULT_POST_RETURN.href).startsWith(DEFAULT_POST_RETURN.href)) return null;
  const link = el("a", "empty-action empty-action-secondary detail-state-feed", "Browse the Social feed");
  link.href = DEFAULT_POST_RETURN.href;
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

function renderMedia(image, caption) {
  const frame = el("div", "detail-media");
  frame.dataset.state = "loading";

  const img = document.createElement("img");
  img.className = "detail-image";
  img.src = image.src;
  img.alt = postImageAlt(image, caption);
  img.decoding = "async";
  if (image.width && image.height) {
    img.width = image.width;
    img.height = image.height;
  }

  // On the detail view the image is the point, so its failure note keeps the
  // description rather than discarding it with the element. It offers no way
  // out: the post itself still reads, and the standing back link is above it.
  const fallback = el("div", "detail-media-fallback");
  const fallbackTitle = el("h2", "detail-media-fallback-title", "Image unavailable");
  fallbackTitle.id = "post-image-unavailable-title";
  fallback.setAttribute("role", "status");
  fallback.setAttribute("aria-labelledby", fallbackTitle.id);
  fallback.append(
    fallbackTitle,
    el("p", undefined, img.alt
      ? `The post image could not be displayed. Description: ${img.alt}`
      : "The post image could not be displayed, and the post carries no description of it."),
  );
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

function renderMissing(container, id, returnHref) {
  container.append(labelledState(id ? "not-found" : "empty", [feedAction(returnHref)]));
}

function renderFailed(container, onRetry) {
  const retry = el("button", "empty-action detail-retry", "Retry");
  retry.type = "button";
  if (onRetry) retry.addEventListener("click", onRetry);
  container.append(labelledState("error", [retry]));
}

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
  const status = el("p", "detail-loading");
  status.setAttribute("role", "status");
  const dot = el("span", "detail-loading-dot");
  dot.setAttribute("aria-hidden", "true");
  status.append(dot, el("span", "detail-loading-text", "Loading this post from Social…"));
  container.append(status);
}

export function renderPostDetail(container, post, options = {}) {
  const { state = "ready", id = "", returnHref = DEFAULT_POST_RETURN.href } = options;
  container.replaceChildren();
  container.setAttribute("aria-busy", state === "loading" ? "true" : "false");

  if (!post) {
    if (state === "loading") renderLoading(container);
    else if (state === "error") renderFailed(container, options.onRetry);
    else renderMissing(container, id, returnHref);
    return;
  }

  const article = el("article", "detail-post");
  // Focusable only on purpose, never by tabbing: post-page.js sends focus here
  // after a retry succeeds, so the reader lands on what they asked for instead
  // of at the top of the document. -1 keeps it out of the tab sequence, which
  // stays: back link, post content, then retry when there is one.
  article.setAttribute("tabindex", "-1");

  // Reading order, top to bottom: who posted (the page's h1, written by
  // post-page.js into the hero above this panel), when, the image, the caption.
  // The author is not repeated as a link here — the one exit above already
  // leads to the profile when the reader came from one, and a second link
  // between the exit and the image would put an unasked-for stop in the way of
  // a keyboard reader heading for the picture.
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
    figure.append(renderMedia(image, caption));
    // An empty figcaption would announce a caption that is not there. A post
    // with neither caption nor body cannot come out of the normalizers, but the
    // renderer is handed plain objects and must not invent text either way.
    if (caption) {
      const figcaption = el("figcaption", "detail-caption", caption);
      figcaption.id = "detail-caption";
      figure.append(figcaption);
    }
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
  container.append(article);
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
// The title says what the panel says, in the panel's words: a post that is not
// there is "unavailable" in both places, and a load that failed says so in both.
// They used to be crossed — the tab read "Post unavailable" for the failure and
// "Post not found" for the absence, which is the one distinction this page
// exists to keep straight.
export function postDetailTitle(post, state = "ready") {
  if (post?.author) return recordTitle(`Post by ${post.author}`, { surface: "Social", fallback: "Post" });
  return state === "error" ? pageTitle("Post couldn’t be loaded") : pageTitle("Post unavailable");
}
