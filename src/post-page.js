// Page wiring for the single-post view. Resolution order mirrors the profile:
// the durable API first, the static demo seed behind it.
//
// The seed's ids are not UUIDs, so asking the API for one would earn a 400 that
// means nothing to the reader. The id shape therefore decides which source is
// asked first, and the seed is still consulted when the API has no answer.

import { normalizeProfileApiPosts, normalizeSeedPosts } from "/profile.js";
import {
  POST_EXITS,
  POST_SOURCE_ABSENT,
  POST_SOURCE_FOUND,
  POST_SOURCE_UNREACHABLE,
  authoritativePostSource,
  findPostById,
  postDetailTitle,
  postPageHeading,
  postPeopleHref,
  postPeopleLabel,
  renderPostDetail,
  resolvePostLookupState,
} from "/post-detail.js";

// Which of a source's three answers this was, without letting a thrown request
// and an answered-but-empty one collapse into the same boolean. `null` from a
// fetcher is the source saying it has no such post; a throw is the source not
// answering at all, and only the caller's try/catch can tell them apart.
async function consult(fetcher) {
  const post = await fetcher();
  return { post, outcome: post ? POST_SOURCE_FOUND : POST_SOURCE_ABSENT };
}

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
  // them, so a label never changes under a reader mid-visit: whatever a link
  // says when it is on the page is what it said a moment ago. The Social link
  // is complete as shipped. Only the People link's destination is refined, and
  // only ever narrowed to the display name the words already promise — first
  // from the ?author= the arriving link carried, then from the post itself once
  // one loads. A name that never resolves leaves it on People plainly.
  const people = document.querySelector("#post-people");
  const exits = people?.parentNode ?? null;
  const aimPeople = (author) => {
    if (!people) return;
    people.href = postPeopleHref(window.location.search, author);
    people.textContent = postPeopleLabel(author);
  };
  // …and whether it is offered at all. Its words promise "this display name's
  // other image posts", which only means something while there is a post, or
  // while one may still arrive. When the lookup settles on not-found or error
  // there is no post and therefore no display name this page can point at — an
  // ?author= in the URL is what the arriving link claimed, not a name the page
  // resolved — so the link is removed from the document rather than left
  // pointing at People-in-general under words that promise one person. Removed,
  // not dimmed and not left in place: a link that is on the page is a promise
  // the page can keep, and this one it cannot.
  //
  // It comes back on the next attempt. A retry re-enters the loading state,
  // where a post may yet arrive, so the link is restored to the exits paragraph
  // in its shipped position — Social first, People second — before every load.
  //
  // A reader can be standing on that link at the moment it goes — they tabbed
  // to it while the lookup was still running, and the lookup then failed.
  // Removing the focused element would drop focus to the document and cost them
  // their place, so focus moves one stop back first, to the exit that is still
  // there and sits beside it in the same paragraph.
  const offerPeople = (offered) => {
    if (!people || !exits) return;
    if (offered) {
      people.hidden = false;
      return;
    }
    if (document.activeElement === people) document.querySelector("#post-back")?.focus?.();
    people.hidden = true;
  };
  aimPeople("");
  // The publish route is not about this post at all, so nothing here narrows
  // it, rewrites it, or withdraws it: it ships standing in src/post.html and
  // this module never touches it. It used to be withheld while the lookup ran,
  // on the reasoning that a page still looking something up offers one route
  // out and not a row of them — but the reader it costs is the one who already
  // knows they want to write rather than to read, and making them wait out a
  // fetch they have no stake in buys nothing. The state that can go wrong here
  // is the one where a link's words promise something the page cannot supply,
  // and this link promises nothing about this post.

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
    document.title = postDetailTitle(null, "loading");
    offerPeople(false);
    renderPostDetail(container, null, { state: "loading", id, author: requestedAuthor, returnHref: POST_EXITS.social.href });
    let post = null;
    // What each source said, kept apart by name. The API is asked only for ids
    // it can answer for — it replies 400 invalid_id to anything that is not a
    // UUID — and the seed is asked whenever nothing has been found yet, so a
    // post it holds is still reached behind an absent API.
    const answered = {};
    if (id) {
      if (authoritativePostSource(id) === "live") {
        try {
          ({ post, outcome: answered.live } = await consult(() => fetchLivePost(id)));
        } catch {
          answered.live = POST_SOURCE_UNREACHABLE;
        }
      }
      if (!post) {
        try {
          ({ post, outcome: answered.seed } = await consult(() => fetchSeedPost(id)));
        } catch {
          answered.seed = POST_SOURCE_UNREACHABLE;
        }
      }
    }
    // The two unresolved answers are different facts and get different states.
    // A source that threw or answered not-ok means the feed could not be
    // reached — that is `error`, and it is retryable. A source that answered
    // and simply had no post with this id is `not-found`, and retrying it would
    // only produce the same answer more slowly.
    //
    // A found post ends the question wherever it came from: if the seed
    // answered, the reader has the post and does not need to hear about the
    // network. Otherwise the verdict belongs to the one source whose answer is
    // about this id — see resolvePostLookupState in src/post-detail.js, which is
    // where the rule and the reason for it live.
    const state = post ? "loaded" : resolvePostLookupState(id, answered);
    renderPostDetail(container, post, {
      state,
      id,
      author: post?.author ?? requestedAuthor,
      returnHref: POST_EXITS.social.href,
      onRetry: () => load({ fromRetry: true }),
    });
    nameHeading(post);
    aimPeople(post?.author ?? "");
    offerPeople(Boolean(post));
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
