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

// A single, classic short-post budget. Enforced in three places that must agree:
// the textarea `maxlength`, the live counter, and createPost's validation.
export const MAX_POST_LENGTH = 280;
export const MAX_AUTHOR_LENGTH = 60;

// Author is optional in the compose form; an empty author normalizes to this so
// the card always has a stable byline.
export const DEFAULT_AUTHOR = "Guest";

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
    return [{ id: post.id, author: post.author, body: post.content, createdAt: post.timestamp, source: post.source }];
  });
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
const NAV_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End"]);

export function nextFocusIndex(current, key, length) {
  if (length === 0) return -1;
  switch (key) {
    case "ArrowDown":
      return current < 0 ? 0 : Math.min(current + 1, length - 1);
    case "ArrowUp":
      return current <= 0 ? 0 : current - 1;
    case "Home":
      return 0;
    case "End":
      return length - 1;
    default:
      return current;
  }
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

function renderPostCard(post, isFirst) {
  const item = el("li");
  const article = el("article", "post-card");
  // Roving tabindex: the first card is the single tab stop; arrow keys move
  // focus between cards (see the keydown handler in mountSocialFeed).
  article.tabIndex = isFirst ? 0 : -1;
  article.dataset.postId = post.id;

  const header = el("header", "post-head");
  const avatar = el("span", "post-avatar", initials(post.author));
  avatar.setAttribute("aria-hidden", "true");

  const byline = el("div", "post-byline");
  byline.append(el("span", "post-author", post.author));
  const time = el("time", "post-date", formatDateTime(post.createdAt));
  time.dateTime = post.createdAt;
  byline.append(time);

  header.append(avatar, byline);
  article.append(header);
  if (post.title) article.append(el("h3", "post-title", post.title));
  article.append(el("p", "post-body", post.body));

  item.append(article);
  return item;
}

export function renderPosts(container, posts, emptyMessage = "Share the first update to start the feed.") {
  const ordered = sortPostsNewestFirst(posts);
  container.replaceChildren();

  if (ordered.length === 0) {
    const empty = el("div", "empty-state");
    empty.append(el("p", "empty-title", "No posts yet."));
    empty.append(el("p", undefined, emptyMessage));
    container.append(empty);
    return;
  }

  const list = el("ol", "post-list");
  ordered.forEach((post, index) => {
    list.append(renderPostCard(post, index === 0));
  });
  container.append(list);
}

function focusCard(cards, index) {
  cards.forEach((card, i) => { card.tabIndex = i === index ? 0 : -1; });
  cards[index]?.focus();
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
  const count = root.querySelector("#post-count");
  const agentFilter = root.querySelector("#post-agent-filter");
  const timeFilter = root.querySelector("#post-time-filter");
  const clearFilters = root.querySelector("#post-filter-clear");

  let posts = options.posts ?? [];

  const postLabel = (n) => `${n} ${n === 1 ? "post" : "posts"}`;

  const render = () => {
    const focusedId = feed.querySelector(".post-card:focus")?.dataset.postId;
    const visible = filterPosts(posts, { author: agentFilter?.value, range: timeFilter?.value });
    const filtering = agentFilter?.value !== "all" || timeFilter?.value !== "all";
    renderPosts(feed, visible, filtering ? "No posts match these filters." : undefined);
    if (count) count.textContent = filtering ? `${postLabel(visible.length)} of ${posts.length}` : postLabel(visible.length);
    if (focusedId) {
      const cards = [...feed.querySelectorAll(".post-card")];
      const index = cards.findIndex((card) => card.dataset.postId === focusedId);
      if (index >= 0) focusCard(cards, index);
    }
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

  // Arrow/Home/End move focus between cards; delegated so it survives re-renders.
  feed.addEventListener("keydown", (event) => {
    const card = event.target.closest?.(".post-card");
    if (!card || !NAV_KEYS.has(event.key)) return;
    const cards = [...feed.querySelectorAll(".post-card")];
    event.preventDefault();
    focusCard(cards, nextFocusIndex(cards.indexOf(card), event.key, cards.length));
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
      try {
        post = createPost({ author: authorInput?.value, body: bodyInput?.value });
      } catch {
        // Should be unreachable behind reportValidity()/maxlength, but keeps the
        // submit flow resilient rather than throwing into the console.
        if (notice) {
          notice.textContent = "That post could not be created. Add a message within the limit.";
          notice.hidden = false;
        }
        return;
      }

      try {
        form.querySelector("button[type=submit]")?.setAttribute("disabled", "");
        const saved = options.create ? await options.create(post) : post;
        posts = [saved, ...posts.filter((item) => item.id !== saved.id)];
        renderAgents();
        if (notice) notice.hidden = true;
      } catch {
        if (notice) {
          notice.textContent = "This post could not be saved. Check the live connection and try again.";
          notice.hidden = false;
        }
        return;
      } finally {
        form.querySelector("button[type=submit]")?.removeAttribute("disabled");
      }
      render();
      form.reset();
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

  renderAgents();
  render();
  updateCounter();
  return {
    render,
    seed(next) { posts = next ?? []; renderAgents(); render(); },
    getPosts() { return [...posts]; },
  };
}
