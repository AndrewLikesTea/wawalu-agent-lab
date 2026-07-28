// Page wiring for the profile grid. The only layer that knows where posts come
// from, which is what keeps profile.js reusable and unit-testable. It composes:
//   1. posts from the shared durable API, and
//   2. the static seed in social-demo-data.json, which keeps the demo populated
//      while that API is empty or offline.
//
// Demo only (PRODUCT.md): the seed is hand-authored sample content and no
// customer or production data is read here.

import {
  mergePostsById,
  mountProfile,
  normalizeProfileApiPosts,
  normalizeSeedPosts,
  profileHref,
  resolveProfileAuthor,
  distinctAuthors,
} from "/profile.js";
import { readStoredAuthor, rememberAuthor } from "/social-identity.js";
import { recordTitle } from "/page-title.js";

const REFRESH_INTERVAL = 30_000;

async function fetchLivePosts() {
  const response = await fetch("/api/social-posts?limit=100", { cache: "no-store", headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Posts API returned ${response.status}`);
  return normalizeProfileApiPosts(await response.json());
}

async function fetchSeedPosts() {
  try {
    const response = await fetch("/social-demo-data.json", { cache: "no-store" });
    if (!response.ok) return [];
    return normalizeSeedPosts((await response.json()).posts);
  } catch {
    return [];
  }
}

// The heading answers whose posts are selected. The tab retains the stable
// destination name so it agrees with the global navigation for every persona.
function updateTitle() {
  document.title = recordTitle("People");
}

async function init() {
  if (!document.querySelector("#profile-grid")) return;

  const seeds = await fetchSeedPosts();
  const param = new URLSearchParams(window.location.search).get("author");
  let author = resolveProfileAuthor({
    param,
    stored: readStoredAuthor(globalThis.localStorage),
    authors: distinctAuthors(seeds),
  });

  // Mounted before the first fetch resolves so the first paint is a reserved
  // skeleton grid rather than a blank panel that later jumps to full height.
  const profile = mountProfile(document, {
    posts: seeds,
    author,
    // "loading" even with seeds in hand: seeded tiles still render (posts always
    // outrank a pending refresh), and an author the seed does not cover gets a
    // skeleton rather than an "empty profile" that the next second contradicts.
    state: "loading",
    onRetry: () => refresh(),
    onAuthorChange(next) {
      author = next;
      rememberAuthor(globalThis.localStorage, next);
      updateTitle(next);
      // replaceState, not pushState: switching profiles is a filter, not a
      // navigation, and it must not turn Back into "undo one dropdown change".
      window.history?.replaceState?.(null, "", profileHref(next));
    },
  });
  if (!profile) return;
  updateTitle(author);

  let live = [];
  let connected = false;

  async function refresh() {
    try {
      live = await fetchLivePosts();
      connected = true;
      // Live posts shadow same-id seeds; the seed stays visible underneath so an
      // empty database does not read as an empty profile.
      profile.seed(mergePostsById(live, seeds));
      profile.setStatus(`Live · updated ${new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date())}`);
    } catch {
      profile.setStatus(connected ? "Live updates paused · retrying" : "Demo posts · live service unavailable");
      // The error panel is only for a reader who would otherwise stare at a
      // skeleton forever. With the seed loaded there is something to show — the
      // profile leaves "loading" either way, because a spinner that never ends
      // is the one state worse than bad news.
      profile.setState(profile.getPosts().length === 0 ? "error" : "ready");
    }
  }

  await refresh();
  const timer = setInterval(refresh, REFRESH_INTERVAL);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refresh();
  });
  globalThis.addEventListener?.("pagehide", () => clearInterval(timer), { once: true });
  document.documentElement.dataset.shiplogProfile = "ready";
}

init();
