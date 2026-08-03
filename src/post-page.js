// Page wiring for the single-post view. Resolution order mirrors the profile:
// the durable API first, the static demo seed behind it.
//
// The seed's ids are not UUIDs, so asking the API for one would earn a 400 that
// means nothing to the reader. The id shape therefore decides which source is
// asked first, and the seed is still consulted when the API has no answer.

import { normalizeProfileApiPosts, normalizeSeedPosts } from "/profile.js";
import { findPostById, postDetailTitle, postPageHeading, postPeopleHref, renderPostDetail } from "/post-detail.js";

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
  // Both onward links ship written out in src/post.html and nothing here
  // rewrites their words: they read the same in the loading, loaded, missing and
  // failed states, and never change under a reader mid-visit. The only thing
  // this can settle is *which* People view the second one opens, and it settles
  // it from the URL the visitor arrived on rather than from the post — a name in
  // the link is known before the fetch and does not change with what loads.
  const people = document.querySelector("#post-people");
  if (people) people.href = postPeopleHref(window.location.search);

  const heading = document.querySelector("#page-title");
  const nameHeading = (post) => {
    if (heading) heading.textContent = postPageHeading(post);
  };

  const load = async ({ fromRetry = false } = {}) => {
    // The heading only names a post once there is one. Until then it names the
    // page, and the panel below carries the state. The marker goes back to
    // "loading" on every attempt, including a retry, so anything watching the
    // page (a test, a smoke check) sees the second fetch as its own load.
    document.documentElement.dataset.shiplogPostDetail = "loading";
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
    // The two unresolved answers are different facts and get different states.
    // A source that threw or answered not-ok means the feed could not be
    // reached — that is `error`, and it is retryable. A source that answered
    // and simply had no post with this id is `not-found`, and retrying it would
    // only produce the same answer more slowly.
    //
    // A lookup that failed is only reported as a failure when nothing was found
    // anywhere: if the seed answered, the reader has the post and does not need
    // to hear about the network.
    const state = post ? "loaded" : failed ? "error" : "not-found";
    renderPostDetail(container, post, {
      state,
      id,
      author: post?.author ?? requestedAuthor,
      onRetry: () => load({ fromRetry: true }),
    });
    nameHeading(post);
    document.title = postDetailTitle(post, state);
    document.documentElement.dataset.shiplogPostDetail = "ready";

    // Pressing "Try again" destroys the button the reader was standing on, so
    // this render has to say where focus goes next. It goes to the post when the
    // retry worked and back onto the new retry button when it did not — never to
    // the top of the document, which would cost the reader their place. Nothing
    // moves focus on a first load: an arriving page must not grab it.
    if (fromRetry) {
      const landing = container.querySelector(".detail-post") ?? container.querySelector(".detail-retry");
      landing?.focus?.();
    }
  };

  await load();
}

init();
