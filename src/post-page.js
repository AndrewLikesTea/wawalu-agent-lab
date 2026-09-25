// Page wiring for the single-post view. Resolution order mirrors the profile:
// the durable API first, the static demo seed behind it.
//
// The seed's ids are not UUIDs, so asking the API for one would earn a 400 that
// means nothing to the reader. The id shape therefore decides which source is
// asked first, and the seed is still consulted when the API did not answer.
//
// "Did not answer" is the narrow thing it sounds like. An endpoint that reached
// its store and said there is no such post has answered, and the lookup is over:
// no id can be in both sources (a live id is a UUID and no seed id is), so a
// second source has nothing to add and its own troubles must not be reported as
// this link's. That is the whole difference between the page's two unresolved
// states, and it is decided here rather than in the view.

import { normalizeProfileApiPosts, normalizeSeedPosts } from "/profile.js";
import { POST_EXITS, findPostById, postDetailTitle, postPageHeading, postPeopleHref, postPeopleLabel, renderPostDetail } from "/post-detail.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// What the live endpoint said about this id, in the only two shapes that change
// what the page draws.
//
// `post` is the post, when there is one. `answered` is the load-bearing half: it
// means the endpoint reached its store and returned a verdict about *this id*,
// so there is nothing further to look up and nothing a retry could change.
//
// Two statuses are that verdict. 404 is the endpoint saying it holds no such
// post — the ordinary dead link: a post deleted, or an id nobody ever published
// under. 400 is it refusing the id's shape (`invalid_id` is the only 400 this
// route can return for a GET), which is the same fact reached sooner — an id the
// endpoint will not accept can never name a post. The page checks the shape
// itself before asking, so that branch is a belt over braces; but the check is a
// second copy of the endpoint's own pattern, and if the two ever drift apart,
// drifting into a dead link is right and drifting into a retryable failure is a
// lie told to a reader who can do nothing with it.
//
// Everything else throws: a 5xx, a body that will not parse, a request that
// never completed. Those are the lookup failing rather than answering, and they
// are the only thing a retry can fix.
async function fetchLivePost(id) {
  const response = await fetch(`/api/social-posts/${encodeURIComponent(id)}`, { cache: "no-store", headers: { accept: "application/json" } });
  if (response.status === 404 || response.status === 400) return { post: null, answered: true };
  if (!response.ok) throw new Error(`Posts API returned ${response.status}`);
  return { post: normalizeProfileApiPosts({ posts: [(await response.json()).post] })[0] ?? null, answered: true };
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
    let failed = false;
    // Whether any source has given a verdict about this id yet. A verdict closes
    // the lookup: the seed is the fallback for a source that did not answer, not
    // a second opinion on one that did.
    let answered = false;
    if (id) {
      if (UUID.test(id)) {
        try {
          ({ post, answered } = await fetchLivePost(id));
        } catch {
          failed = true;
        }
      }
      // Only a UUID can name a live post and no seed id is one, so at most one
      // of the two sources can hold any given id. The seed is asked when the
      // live endpoint was never asked — a non-UUID id, which is the shape a
      // truncated paste usually has — or was asked and did not answer.
      if (!post && !answered) {
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
    //
    // Nor is it reported when a source already answered. A dead link whose
    // fallback lookup then fell over is still a dead link — the endpoint said
    // there is no such post, and an unreachable demo seed does not make that
    // less true. Reporting it as a failure would hand the reader a Retry for an
    // id that can never resolve, which is the one thing the dead-link state
    // exists to avoid saying.
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
