// Page wiring for the social feed. This is the only layer that knows where data
// comes from, keeping social.js reusable and unit-testable. It composes:
//   1. posts created in this browser (localStorage), plus
//   2. a small static seed from social-demo-data.json so the feed renders
//      meaningfully in review before anyone has posted.
// Browser posts take precedence and are merged ahead of the demo seed; the seed
// is deduped by id so a saved post never appears twice.
//
// Demo only (PRODUCT.md): the seed is static, hand-authored sample content and
// no customer or production data is read here.

import { loadPosts, mountSocialFeed, normalizeSocialApiPosts, reconcilePosts } from "/social.js";

const REFRESH_INTERVAL = 10_000;

async function fetchLivePosts() {
  const response = await fetch("/api/social-posts?limit=100", { cache: "no-store", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Posts API returned ${response.status}`);
  return normalizeSocialApiPosts(await response.json());
}

async function fetchDemoPosts() {
  try {
    const response = await fetch("/social-demo-data.json", { cache: "no-store" });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data.posts) ? data.posts : [];
  } catch {
    return [];
  }
}

function dedupeById(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

async function init() {
  const root = document;
  if (!root.querySelector("#post-feed")) return;

  const status = root.querySelector("#feed-status");
  const announcer = root.querySelector("#feed-announcer");
  const demo = await fetchDemoPosts();
  const local = loadPosts(localStorage);
  const fallback = dedupeById([...local, ...demo]);
  const feed = mountSocialFeed(root, { posts: fallback, storage: localStorage });
  let knownIds = new Set(fallback.map((post) => post.id));
  let hasConnected = false;

  const refresh = async () => {
    try {
      const live = await fetchLivePosts();
      const nextIds = new Set(live.map((post) => post.id));
      const added = live.filter((post) => !knownIds.has(post.id)).length;
      // A poll is a remote snapshot, not the entire UI state. Re-read the
      // local overlay so a post composed in this tab (or another same-origin
      // tab) is never erased by a successful refresh.
      feed.seed(reconcilePosts(live, loadPosts(localStorage)));
      knownIds = nextIds;
      if (status) status.textContent = `Live · updated ${new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date())}`;
      if (hasConnected && added && announcer) announcer.textContent = `${added} new ${added === 1 ? "post" : "posts"} added to the feed.`;
      hasConnected = true;
    } catch {
      if (status) status.textContent = hasConnected ? "Live updates paused · retrying" : "Demo posts · live service unavailable";
    }
  };

  await refresh();
  const timer = setInterval(refresh, REFRESH_INTERVAL);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
  globalThis.addEventListener?.("pagehide", () => clearInterval(timer), { once: true });
  document.documentElement.dataset.shiplogSocial = "ready";
}

init();
