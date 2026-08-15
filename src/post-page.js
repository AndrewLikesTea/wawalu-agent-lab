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
  // The onward row's two standing routes ship as words in src/post.html and
  // nothing here touches them, so neither label changes under a reader mid-visit
  // and neither comes or goes with a state: the feed and the composer are there
  // whatever this lookup does, including while it runs.
  //
  // The third is this module's to draw. Its words are about one display name —
  // "…see Mina Okafor's other image posts" — so it exists exactly when the page
  // has resolved a post to take the name from, and not one render before. An
  // ?author= in the arriving URL is not that: it is what the link claimed, not a
  // name this page found, so it narrows the destination once a post agrees with
  // it and never conjures the link on its own.
  //
  // Created and removed rather than hidden. A link in the document is a promise
  // the page can keep; this one it cannot keep with no post behind it, and a
  // hidden link is still a node a future reader of this code has to reason about
  // — "is People offered here" should be a count of links, not a question about
  // an attribute. It is rebuilt on the next attempt: a retry re-enters the
  // loading state, where a post may yet arrive.
  //
  // It goes at the head of the row, before the feed link, because that is the
  // order the row reads in: the name you came from, the feed it came out of,
  // then publishing your own. Inserted, not appended — DOM order is what a
  // screen reader and the Tab key follow.
  //
  // A reader can be standing on it at the moment it goes, and removing the
  // focused element drops focus to the document and costs them their place — so
  // focus moves along first, to the feed link that is still there and sits
  // beside it in the same row. Nothing reaches that today: the link exists only
  // once a post has loaded, and a loaded state starts no second load (only the
  // error state offers a retry). It is kept because the shape that would reach
  // it — any later reload of a settled page — is one line away, and the cost of
  // being wrong about it is a keyboard reader thrown to the top of the document.
  const onward = document.querySelector("#post-onward");
  const feed = document.querySelector("#post-back");
  const offerPeople = (author) => {
    const label = postPeopleLabel(author);
    const existing = document.querySelector("#post-people");
    if (!label) {
      if (!existing) return;
      if (document.activeElement === existing) feed?.focus?.();
      existing.remove();
      return;
    }
    const link = existing ?? document.createElement("a");
    link.className = "detail-back detail-page-back";
    link.id = "post-people";
    link.href = postPeopleHref(window.location.search, author);
    link.textContent = label;
    if (!existing && onward && feed) onward.insertBefore(link, feed);
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
    offerPeople("");
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
