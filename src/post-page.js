// Page wiring for the single-post view. Resolution order mirrors the profile:
// the durable API first, the static demo seed behind it.
//
// The seed's ids are not UUIDs, so asking the API for one would earn a 400 that
// means nothing to the reader. The id shape therefore decides which source is
// asked first, and the seed is still consulted when the API has no answer.

import { normalizeProfileApiPosts, normalizeSeedPosts } from "/profile.js";
import { POST_EXITS, findPostById, postDetailTitle, postPageHeading, postPeopleHref, renderPostDetail } from "/post-detail.js";

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
  // Both routes out ship as words in src/post.html and nothing here rewrites
  // them, so their labels never change under a reader mid-visit. The Social link
  // is complete as shipped and stands in every state. Only the People link's
  // destination is refined, and only ever narrowed to the display name the words
  // already promise — first from the ?author= the arriving link carried, then
  // from the post itself once one loads. A name that never resolves leaves it on
  // People plainly.
  const people = document.querySelector("#post-people");
  const peopleSlot = people?.parentNode ?? null;
  const aimPeople = (author) => {
    if (people) people.href = postPeopleHref(window.location.search, author);
  };
  aimPeople("");

  // …and on the two states that end without a post, the People link is not
  // offered at all. Its words promise "this display name's other image posts",
  // and a reader looking at "Post not found" or "Post could not be loaded" has
  // never been shown a display name: the lookup either answered with nothing or
  // never completed. The ?author= an arriving link happened to carry is not a
  // name that reader saw, so following the link would land them in one person's
  // posts with no idea whose. Loading and loaded keep it — one is on its way to
  // a name, the other has one on screen above the link.
  //
  // Removed rather than hidden, for the same reason renderPostDetail() replaces
  // the region instead of toggling CSS on four stacked states: absence is the
  // only version of "not offered" that a screen reader and the tab order agree
  // with. (`hidden` would also need a stylesheet rule here, because
  // `.detail-back` sets `display:inline-flex` and would win against the UA's
  // `[hidden]` rule.) It goes back in its own slot, after the Social link, when
  // a retry puts the page back into loading.
  const offerPeople = (state) => {
    if (!people || !peopleSlot) return;
    if (state === "not-found" || state === "error") people.remove();
    else if (!people.parentNode) peopleSlot.append(people);
  };

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
    offerPeople("loading");
    renderPostDetail(container, null, { state: "loading", id, author: requestedAuthor, returnHref: POST_EXITS.social.href });
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
      returnHref: POST_EXITS.social.href,
      onRetry: () => load({ fromRetry: true }),
    });
    nameHeading(post);
    aimPeople(post?.author ?? "");
    offerPeople(state);
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
