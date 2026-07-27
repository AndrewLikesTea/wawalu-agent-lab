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
import { authorInitials, captionFor, countLabel, profileHref } from "./profile.js";

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

// Recovery is offered to the nearest place the post came from: the author's
// profile when the link carried one, and otherwise the feed itself. The feed is
// called "Social" here because that is the name the site navigation gives it.
function postReturn(author) {
  if (!author) {
    const feed = el("a", "empty-action empty-action-secondary", "Return to Social");
    feed.href = "/social.html";
    feed.setAttribute("aria-label", "Return to Social");
    return feed;
  }
  const link = el("a", "empty-action empty-action-secondary", "Return to profile");
  link.href = profileHref(author);
  link.setAttribute("aria-label", `Return to ${author}'s profile`);
  return link;
}

// One title and one sentence per state, in the same shape the decision detail
// uses: a category label, a heading that names the state, then a single line
// saying what is happening. Nothing here reports a status code, an id, or an
// exception — none of those tell a reader what to do next.
const POST_STATE_COPY = {
  loading: {
    className: "detail-state-loading",
    label: "Post status",
    title: "Loading post",
    description: "We’re finding this post and its author.",
  },
  empty: {
    className: "detail-state-not-found",
    label: "Post status",
    title: "Choose a post",
    description: "No post was specified. Open one from Social.",
  },
  "not-found": {
    className: "detail-state-not-found",
    label: "Post status",
    title: "Post not found",
    description: "This post may have been removed, or the link may be incomplete.",
  },
  error: {
    className: "empty-state-error detail-state-unavailable",
    label: "Error",
    title: "Post couldn’t be loaded",
    description: "We couldn’t reach Social, so this post didn’t load.",
  },
};

function labelledState(state, author, action) {
  const copy = POST_STATE_COPY[state] ?? POST_STATE_COPY.error;
  const node = el("div", `empty-state detail-state-message ${copy.className}`);
  const heading = el("h2", "empty-title", copy.title);
  heading.id = `post-state-${state}-title`;
  node.setAttribute("role", state === "error" ? "alert" : "status");
  node.setAttribute("aria-labelledby", heading.id);
  node.append(el("p", "detail-state-label", copy.label), heading, el("p", undefined, copy.description));
  // The state's own action comes first; the standing way back is the fallback
  // behind it.
  if (action) node.append(action);
  node.append(postReturn(author));
  return node;
}

function renderMedia(image, author, caption) {
  const frame = el("div", "detail-media");
  frame.dataset.state = "loading";

  const img = document.createElement("img");
  img.className = "detail-image";
  img.src = image.src;
  // A detail image is content, not decoration. The API normally supplies its
  // own description; older seed data can omit one, in which case the visible
  // caption is the most useful truthful fallback.
  img.alt = image.alt || caption;
  img.decoding = "async";
  if (image.width && image.height) {
    img.width = image.width;
    img.height = image.height;
  }

  // On the detail view the image is the point, so its failure note keeps the
  // description rather than discarding it with the element.
  const fallback = el("div", "detail-media-fallback");
  const fallbackTitle = el("h2", "detail-media-fallback-title", "Image unavailable");
  fallbackTitle.id = "post-image-unavailable-title";
  fallback.setAttribute("role", "status");
  fallback.setAttribute("aria-labelledby", fallbackTitle.id);
  fallback.append(
    fallbackTitle,
    el("p", undefined, `The post image could not be displayed. Description: ${img.alt}`),
    postReturn(author),
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

function renderMissing(container, id, author) {
  container.append(labelledState(id ? "not-found" : "empty", author));
}

function renderFailed(container, onRetry, author) {
  const retry = el("button", "empty-action", "Try again");
  retry.type = "button";
  if (onRetry) retry.addEventListener("click", onRetry);
  container.append(labelledState("error", author, retry));
}

function renderLoading(container, author) {
  const loading = labelledState("loading", author);
  const skeleton = el("div", "detail-skeleton");
  skeleton.setAttribute("aria-hidden", "true");
  skeleton.append(el("div", "skeleton-line skeleton-line-short"), el("div", "skeleton-media"), el("div", "skeleton-line"));
  loading.append(skeleton);
  container.append(loading);
}

export function renderPostDetail(container, post, options = {}) {
  const { state = "ready", id = "", author: profileAuthor = "" } = options;
  container.replaceChildren();
  container.setAttribute("aria-busy", state === "loading" ? "true" : "false");

  if (!post) {
    if (state === "loading") renderLoading(container, profileAuthor);
    else if (state === "error") renderFailed(container, options.onRetry, profileAuthor);
    else renderMissing(container, id, profileAuthor);
    return;
  }

  const article = el("article", "detail-post");

  const header = el("header", "post-head");
  const avatar = el("span", "post-avatar", authorInitials(post.author));
  avatar.setAttribute("aria-hidden", "true");
  const byline = el("div", "post-byline");
  // The byline links back to the profile the reader most likely arrived from,
  // which also makes the detail page reachable-from and returnable-to on its own.
  const author = el("a", "post-author", post.author);
  author.href = profileHref(post.author);
  author.id = "detail-author";
  const time = el("time", "post-date", formatDateTime(post.createdAt));
  time.dateTime = post.createdAt;
  byline.append(author, time);
  header.append(avatar, byline);
  article.append(header);

  const caption = captionFor(post);
  if (post.image) {
    const figure = el("figure", "detail-figure");
    figure.append(renderMedia(post.image, post.author, caption));
    const figcaption = el("figcaption", "detail-caption", caption);
    figcaption.id = "detail-caption";
    figure.append(figcaption);
    article.append(figure);
    // A dedicated caption does not replace the post body, so show the body too
    // when they differ — otherwise the detail view would hide text the feed shows.
    if (post.caption && post.body && post.body !== post.caption) article.append(el("p", "detail-body", post.body));
  } else {
    const body = el("p", "detail-body", caption);
    body.id = "detail-caption";
    article.append(body);
  }

  const stats = el("p", "detail-stats");
  stats.append(el("span", "detail-stat", countLabel(post.likes ?? 0, "like")));
  stats.append(el("span", "detail-stat", countLabel(post.comments ?? 0, "comment")));
  article.append(stats);

  article.setAttribute("aria-labelledby", "detail-author detail-caption");
  container.append(article);
}

// The page heading names the post the way a reader would: by who wrote it. The
// post record carries no title of its own, so the author is the only durable
// name it has — the date and caption sit in the article underneath.
export function postPageHeading(post) {
  return post?.author ? `Post by ${post.author}` : "Post";
}

// Same shape as the decision detail's title — the record, then the surface the
// nav names, then the product.
export function postDetailTitle(post, state = "ready") {
  if (post?.author) return `Post by ${post.author} · Social · Shiplog`;
  return state === "error" ? "Post unavailable · Shiplog" : "Post not found · Shiplog";
}
