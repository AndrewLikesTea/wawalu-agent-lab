// Page wiring for the single-post view. Resolution order mirrors the profile:
// the durable API first, the static demo seed behind it.
//
// The seed's ids are not UUIDs, so asking the API for one would earn a 400 that
// means nothing to the reader. The id shape therefore decides which source is
// asked first, and the seed is still consulted when the API has no answer.

import { normalizeProfileApiPosts, normalizeSeedPosts, profileHref } from "/profile.js";
import { findPostById, postDetailTitle, postPageHeading, renderPostDetail } from "/post-detail.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function fetchLivePost(id) {
  const response = await fetch(`/api/social-posts/${encodeURIComponent(id)}`, { cache: "no-store", headers: { accept: "application/json" } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Posts API returned ${response.status}`);
  return normalizeProfileApiPosts({ posts: [(await response.json()).post] })[0] ?? null;
}

async function fetchSeedPost(id) {
  const response = await fetch("/social-demo-data.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Demo posts returned ${response.status}`);
  return findPostById(normalizeSeedPosts((await response.json()).posts), id);
}

async function init() {
  const container = document.querySelector("#post-detail");
  if (!container) return;

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id") ?? "";
  const requestedAuthor = (params.get("author") ?? "").trim();
  const back = document.querySelector("#post-back");
  if (back && requestedAuthor) {
    back.href = profileHref(requestedAuthor);
    back.textContent = `← Back to ${requestedAuthor}'s profile`;
    back.setAttribute("aria-label", `Back to ${requestedAuthor}'s profile`);
  }

  const heading = document.querySelector("#page-title");
  const nameHeading = (post) => {
    if (heading) heading.textContent = postPageHeading(post);
  };

  const load = async () => {
    // The heading only names a post once there is one. Until then it names the
    // page, and the panel below carries the state.
    nameHeading(null);
    renderPostDetail(container, null, { state: "loading", id, author: requestedAuthor });
    let post = null;
    let failed = false;
    if (id) {
      try {
        post = UUID.test(id) ? await fetchLivePost(id) : null;
      } catch {
        failed = true;
      }
      if (!post) {
        try {
          post = await fetchSeedPost(id);
        } catch {
          failed = true;
        }
      }
    }
    // A lookup that failed is only reported as a failure when nothing was found
    // anywhere: if the seed answered, the reader has the post and does not need
    // to hear about the network.
    const state = post ? "ready" : failed ? "error" : "ready";
    renderPostDetail(container, post, {
      state,
      id,
      author: post?.author ?? requestedAuthor,
      onRetry: load,
    });
    nameHeading(post);
    document.title = postDetailTitle(post, state);
    if (back && post) {
      back.href = profileHref(post.author);
      back.textContent = `← Back to ${post.author}'s profile`;
      back.setAttribute("aria-label", `Back to ${post.author}'s profile`);
    }
    document.documentElement.dataset.shiplogPostDetail = "ready";
  };

  await load();
}

init();
