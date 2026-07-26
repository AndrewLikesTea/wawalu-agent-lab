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
import { authorInitials, captionFor, countLabel, formatDate, profileHref } from "./profile.js";

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

function profileReturn(author) {
  const link = el("a", "empty-action empty-action-secondary", "Return to profile");
  link.href = profileHref(author);
  link.setAttribute("aria-label", author ? `Return to ${author}'s profile` : "Return to profile");
  return link;
}

function labelledState(className, title, message, author, role = "status") {
  const state = el("div", `empty-state detail-state-message ${className}`.trim());
  const heading = el("h2", "empty-title", title);
  heading.id = `post-state-${className.replaceAll(" ", "-") || "message"}-title`;
  state.setAttribute("role", role);
  state.setAttribute("aria-labelledby", heading.id);
  state.append(heading, el("p", undefined, message), profileReturn(author));
  return state;
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
    profileReturn(author),
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
  container.append(labelledState(
    "detail-state-not-found",
    "That post is not here.",
    id ? "It may have been removed, or the link may be incomplete." : "This page needs a post to show. Open one from a profile.",
    author,
  ));
}

function renderFailed(container, onRetry, author) {
  const failed = labelledState(
    "empty-state-error detail-state-unavailable",
    "This post is temporarily unavailable.",
    "The connection to the feed failed. The post may still be available — try again.",
    author,
    "alert",
  );
  const retry = el("button", "empty-action", "Try again");
  retry.type = "button";
  if (onRetry) retry.addEventListener("click", onRetry);
  failed.append(retry);
  container.append(failed);
}

function renderLoading(container, author) {
  const loading = labelledState(
    "detail-state-loading",
    "Loading post",
    "The post image and details are loading.",
    author,
  );
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

export function postDetailTitle(post) {
  return post ? `${post.author} · ${formatDate(post.createdAt)} · Shiplog` : "Post not found · Shiplog";
}
