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
    throw new TypeError("A post requires a message.");
  }
  if (body.length > MAX_POST_LENGTH) {
    throw new TypeError(`A post must be ${MAX_POST_LENGTH} characters or fewer.`);
  }
  if (author.length > MAX_AUTHOR_LENGTH) {
    throw new TypeError(`An author must be ${MAX_AUTHOR_LENGTH} characters or fewer.`);
  }

  return {
    id: options.id ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    author,
    body,
    createdAt: options.createdAt ?? new Date().toISOString(),
  };
}

// Reverse chronological order (newest first). Never mutates the input; ties fall
// back to input order via JS sort stability.
export function sortPostsNewestFirst(posts) {
  return [...posts].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

export const TIME_RANGES = Object.freeze({ hour: 60 * 60 * 1000, day: 24 * 60 * 60 * 1000, week: 7 * 24 * 60 * 60 * 1000 });

export function filterPosts(posts, { author = "all", range = "all", now = Date.now() } = {}) {
  const cutoff = TIME_RANGES[range] ? now - TIME_RANGES[range] : null;
  return sortPostsNewestFirst(posts).filter((post) => {
    if (author !== "all" && post.author !== author) return false;
    return cutoff === null || Date.parse(post.createdAt) >= cutoff;
  });
}

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
function renderMedia(image) {
  const frame = el("div", "post-media");
  frame.dataset.state = "loading";

  const img = document.createElement("img");
  img.className = "post-image";
  img.src = image.src;
  // A supplied alt always wins. When a post carries no alt text the image is
  // marked decorative (alt="") on purpose: it sits inside a <figure> whose
  // <figcaption> is right there and describes it, so the alternative — reading
  // out a filename, or repeating the caption twice — is strictly worse.
  img.alt = image.alt;
  img.loading = "lazy";
  img.decoding = "async";
  if (image.width && image.height) {
    img.width = image.width;
    img.height = image.height;
  }

  // When the image dies, its description is the only thing left that says what
  // was there — so the fallback keeps it rather than discarding it with the
  // element.
  const fallback = el("p", "post-media-fallback", image.alt ? `Image unavailable: ${image.alt}` : "Image unavailable.");
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
    figure.append(renderMedia(image));
    const caption = el("figcaption", "post-caption", post.body);
    caption.id = textId;
    figure.append(caption);
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

const DEFAULT_EMPTY_MESSAGE = "Share the first update to start the feed.";

// `state` separates "we have nothing yet because we are still fetching" from
// "we have nothing because there is nothing" and from "we have nothing because
// the fetch failed" — three situations that must not share one empty state.
// Posts always win over a pending or failed refresh: stale content beats a
// spinner over content the reader could already see.
export function renderPosts(container, posts, options = {}) {
  const { emptyMessage = DEFAULT_EMPTY_MESSAGE, state = "ready" } = options;
  const ordered = sortPostsNewestFirst(posts);
  container.replaceChildren();
  container.setAttribute("aria-busy", state === "loading" && ordered.length === 0 ? "true" : "false");

  if (ordered.length === 0) {
    if (state === "loading") {
      renderSkeleton(container);
      const loading = document.createElement("div");
      renderState(loading, { state: "loading", title: "Loading team posts…" });
      container.append(...loading.children);
      return;
    }
    if (state === "error") {
      const panel = renderState(container, {
        state: "error",
        label: "Feed error",
        value: "Posts could not be loaded.",
        description: "The feed keeps retrying. Check the connection status above.",
      });
      panel.classList.add("empty-state", "empty-state-error");
    } else {
      const panel = renderState(container, {
        state: "empty",
        label: "Feed status",
        value: "No posts yet.",
        description: emptyMessage,
        action: { label: "Write an update", href: "#post-body" },
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

// Wire the interactive behaviour: compose submission, the live character
// counter, and roving-focus navigation over the feed. Handlers are delegated to
// the feed container so they survive a re-render without re-binding. Returns a
// small API so the page can seed and re-render with fresh data.
export function mountSocialFeed(root, options = {}) {
  const feed = root.querySelector("#post-feed");
  const form = root.querySelector("#post-form");
  const bodyInput = root.querySelector("#post-body");
  const authorInput = root.querySelector("#post-author");
  const counter = root.querySelector("#post-counter");
  const notice = root.querySelector("#social-notice");
  const submit = root.querySelector("#post-submit") ?? form?.querySelector("button[type=submit]");
  const submitLabel = submit?.querySelector(".submit-label");
  const count = root.querySelector("#post-count");
  const agentFilter = root.querySelector("#post-agent-filter");
  const timeFilter = root.querySelector("#post-time-filter");
  const clearFilters = root.querySelector("#post-filter-clear");

  let posts = options.posts ?? [];
  let state = options.state ?? "ready";
  // The card that owns the tab stop, remembered across re-renders so a
  // background refresh cannot silently send a returning keyboard user back to
  // the top of the feed.
  let activeId = null;

  const postLabel = (n) => `${n} ${n === 1 ? "post" : "posts"}`;

  const render = () => {
    const hadFocus = Boolean(feed.querySelector(".post-card:focus"));
    const visible = filterPosts(posts, { author: agentFilter?.value, range: timeFilter?.value });
    const filtering = agentFilter?.value !== "all" || timeFilter?.value !== "all";
    renderPosts(feed, visible, { state, emptyMessage: filtering ? "No posts match these filters." : undefined });
    if (count) count.textContent = filtering ? `${postLabel(visible.length)} of ${posts.length}` : postLabel(visible.length);

    const cards = [...feed.querySelectorAll(".post-card")];
    const index = activeId ? cards.findIndex((card) => card.dataset.postId === activeId) : -1;
    if (index < 0) return;
    // Move focus only if the feed already had it; otherwise just restore the
    // tab stop, so a refresh never yanks focus out of the compose form.
    if (hadFocus) focusCard(cards, index);
    else cards.forEach((card, i) => { card.tabIndex = i === index ? 0 : -1; });
  };

  const renderAgents = () => {
    if (!agentFilter) return;
    const selected = agentFilter.value;
    const authors = [...new Set(posts.map((post) => post.author))].sort((a, b) => a.localeCompare(b));
    agentFilter.replaceChildren(new Option("All agents", "all"), ...authors.map((author) => new Option(author, author)));
    agentFilter.value = authors.includes(selected) ? selected : "all";
  };

  const updateCounter = () => {
    if (!counter || !bodyInput) return;
    const state = counterState(bodyInput.value);
    counter.textContent = `${state.remaining}`;
    counter.classList.toggle("over", state.over);
    counter.classList.toggle("near", state.near);
  };

  const setSubmitting = (submitting) => {
    if (!submit) return;
    submit.disabled = submitting;
    submit.setAttribute("aria-busy", String(submitting));
    if (submitLabel) submitLabel.textContent = submitting ? "Publishing…" : "Post update";
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
        if (notice) {
          notice.textContent = error?.message || "That post could not be created. Add a caption within the limit.";
          notice.hidden = false;
          notice.classList.remove("is-success");
        }
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
        renderAgents();
        if (notice) {
          notice.replaceChildren(
            document.createTextNode(media ? "Image posted successfully. " : "Post published successfully. "),
          );
          const successLink = document.createElement("a");
          successLink.href = `#post-${saved.id}`;
          successLink.textContent = "View in feed";
          successLink.addEventListener("click", (event) => {
            event.preventDefault();
            const card = [...feed.querySelectorAll(".post-card")].find((item) => item.dataset.postId === saved.id);
            card?.focus();
            card?.scrollIntoView?.({ block: "center", behavior: "smooth" });
          });
          notice.append(successLink);
          notice.classList.add("is-success");
          notice.hidden = false;
        }
      } catch (error) {
        if (notice) {
          notice.textContent = error?.message || "This post could not be saved. Check the live connection and try again.";
          notice.classList.remove("is-success");
          notice.hidden = false;
        }
        return;
      } finally {
        setSubmitting(false);
      }
      render();
      form.reset();
      options.clearMedia?.();
      updateCounter();
      bodyInput?.focus();
    });
  }


  agentFilter?.addEventListener("change", render);
  timeFilter?.addEventListener("change", render);
  clearFilters?.addEventListener("click", () => {
    agentFilter.value = "all";
    timeFilter.value = "all";
    render();
    agentFilter.focus();
  });

  // Carry the byline across visits so the feed and the profile agree on who you
  // are without asking twice. An untouched field only.
  const remembered = readStoredAuthor(options.storage ?? globalThis.localStorage);
  if (authorInput && !authorInput.value && remembered) authorInput.value = remembered;

  renderAgents();
  render();
  updateCounter();
  return {
    render,
    seed(next) { posts = next ?? []; state = "ready"; renderAgents(); render(); },
    // Loading/error are display states only — they never discard posts already
    // on screen, so a failed refresh degrades to "stale but readable".
    setState(next) { state = next; render(); },
    getPosts() { return [...posts]; },
  };
}
