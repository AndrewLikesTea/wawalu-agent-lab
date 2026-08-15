// Page wiring for the single-post view. Resolution order mirrors the profile:
// the durable API first, the static demo seed behind it.
//
// The seed's ids are not UUIDs, so asking the API for one would earn a 400 that
// means nothing to the reader. The id shape therefore decides which source is
// asked first, and the seed is still consulted when the API has no answer.

import { normalizeProfileApiPosts, normalizeSeedPosts } from "/profile.js";
import { POST_EXITS, findPostById, postDetailTitle, postPageHeading, postPeopleHref, postPeopleLabel, renderPostDetail } from "/post-detail.js";

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
  // Two of the three routes onward ship as words in src/post.html and nothing
  // here rewrites them, so a label never changes under a reader mid-visit:
  // whatever a link says when it is on the page is what it said a moment ago.
  // The feed link and the composer link are complete as shipped, and they are
  // right in all four states — the feed and the composer exist whether or not
  // this one post does.
  //
  // The third is this post's display name, and it is built here because it
  // cannot be shipped: its words promise one person's other image posts, and
  // until a post loads there is no person to name. An ?author= on the arriving
  // URL is what the link claimed, not a name this page resolved, so it does not
  // qualify either — the label and the destination are both taken from the
  // loaded post and from nothing else.
  //
  // It goes first in the row, ahead of the feed and the composer: narrowest
  // route first, then the whole feed, then publishing your own. It is a plain
  // anchor carrying the same classes as its two neighbours, which is where its
  // focus ring, its spacing and its type come from — no new rule, and a real
  // link rather than a handler on something that is not one.
  const exits = document.querySelector(".detail-page-exits");
  const back = document.querySelector("#post-back");
  let people = null;
  // Absent, not hidden and not emptied, in every state that has no post. A
  // hidden link is still a node in the document, and a link with no words in it
  // is a stop a screen reader announces with nothing to say; the page offers
  // this one only where it can keep the promise its words make.
  //
  // A reader can be standing on it when it goes — so if it holds focus, focus
  // moves first to the route beside it rather than falling to the document and
  // costing them their place.
  const withdrawPeople = () => {
    if (!people?.parentNode) return;
    if (document.activeElement === people) back?.focus?.();
    people.remove();
  };
  const offerPeople = (author) => {
    const label = postPeopleLabel(author);
    if (!label || !exits || !back) {
      withdrawPeople();
      return;
    }
    if (!people) {
      people = document.createElement("a");
      people.className = "detail-back detail-page-back";
      people.id = "post-people";
    }
    people.href = postPeopleHref(window.location.search, author);
    people.textContent = label;
    if (!people.parentNode) exits.insertBefore(people, back);
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
    withdrawPeople();
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
    // The loaded post's own author, or nothing: a state with no post withdraws
    // the link rather than pointing it at People-in-general under words that
    // promise one person.
    offerPeople(post?.author ?? "");
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
