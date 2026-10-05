// Shared links resolve from their owning source: UUIDs from the API,
// demo slugs from the seed. An authoritative absence needs no fallback.

import { normalizeProfileApiPosts, normalizeSeedPosts } from "/profile.js";
import {
  POST_EXITS, findPostById, postDetailTitle, postPageHeading, postPeopleHref, postPeopleLabel,
  postProvenanceSentence, renderPostDetail,
} from "/post-detail.js";

import { REPORT_EMAIL_NOTE, mountPostReport, renderReportButton } from "/post-report.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Social's note under its feed, quoted rather than restated: the handle is the
// words Social's own link to that note carries, and the body is the note. One
// account of what a report leads to serves both surfaces, so a reader who meets
// it on a forwarded link and a reader who meets it on the feed read the same
// sentences. tests/post-page-flow.test.js reads both out of src/social.html.
//
// What the form does with the address it asks for is the report module's own
// string (#2745), spliced in rather than retyped: the same bytes stand beside
// the field in src/post-report.js, so the answer a reader gets here is the
// answer the form gives. src/social.html ships the assembled paragraph, and
// tests/post-page-flow.test.js reads the two back against each other.
const REPORT_DISCLOSURE_SUMMARY = "How reporting works";
const REPORT_DISCLOSURE_BODY = "Report post opens a short form about that one post. Choose a reason, add a note if you want to, and give your email address. "
  + `${REPORT_EMAIL_NOTE} `
  + "The report goes only to the Wawalu team, who review each one. The post stays up unless the team decides after review to remove it.";

// The two sentences of the follow-up invitation that tell a reader to select a
// control, and the sentence they are threaded around. Both controls — Report
// post and Copy link to this post — are drawn only on the loaded post, so both
// sentences are withheld until there is one. The third sentence ships in
// src/post.html and holds in every state; it is matched here to put the
// reporting one before it and the copy one after it, which is the order the
// paragraph has always read in.
const INVITATION_REPORT = "If your question is about this post itself, select Report post instead.";
const INVITATION_ATTACHMENT = "Nothing about the post is attached to the request automatically.";
const INVITATION_COPY = "Select Copy link to this post above, then paste the link into the Anything else we should know? field so the team knows which post you mean.";

async function fetchLivePost(id) {
  const response = await fetch(`/api/social-posts/${encodeURIComponent(id)}`, { cache: "no-store", headers: { accept: "application/json" } });
  if ([400, 404, 410].includes(response.status)) return null;
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

  const report = mountPostReport(document);
  // Keep the disclosure beside the post, outside its repainted live region.
  container.parentNode.append(document.querySelector("#post-report-panel"));

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

  // Guidance that names a control follows the control. Reporting is explained
  // beside the post it applies to, and the invitation's two pointers at a
  // button arrive with the buttons and go when they go — a page that is still
  // looking a post up, or that failed to find one, draws neither button, and an
  // instruction to select one of them is an instruction that reader cannot
  // follow (#2603).
  //
  // The explanation is a disclosure rather than a standing paragraph so the
  // post keeps the top of the region: a reader who wants to know what a report
  // costs opens it, and a reader who does not reads past one line. It is built
  // here and not shipped closed in src/post.html because a disclosure handle is
  // a tab stop, and the waiting page's tab order runs from the Social exit
  // straight into the footer (tests/page-skip-link.test.js).
  const reporting = document.querySelector("#post-reporting");
  const invitation = document.querySelector(".site-footer-invitation");
  const waitingInvitation = invitation?.textContent ?? "";
  const loadedInvitation = `${waitingInvitation.replace(INVITATION_ATTACHMENT, `${INVITATION_REPORT} ${INVITATION_ATTACHMENT}`)} ${INVITATION_COPY}`;
  const nameControls = (drawn) => {
    if (invitation) invitation.textContent = drawn ? loadedInvitation : waitingInvitation;
    if (!reporting) return;
    // Same rule the People link follows: a reader standing on the handle when
    // it goes must not be dropped to the top of the document, so focus moves
    // back to the exit above it first.
    if (document.activeElement?.closest?.("#post-reporting")) document.querySelector("#post-back")?.focus?.();
    reporting.replaceChildren();
    if (!drawn) return;
    const disclosure = document.createElement("details");
    // The class goes on the parent, which is where the shipped pointer and
    // focus-ring treatment for a disclosure is keyed in this codebase.
    disclosure.className = "post-report-disclosure";
    const summary = document.createElement("summary");
    summary.textContent = REPORT_DISCLOSURE_SUMMARY;
    const body = document.createElement("p");
    body.className = "hint";
    body.textContent = REPORT_DISCLOSURE_BODY;
    disclosure.append(summary, body);
    reporting.append(disclosure);
  };

  const heading = document.querySelector("#page-title");
  const nameHeading = (post) => {
    if (heading) heading.textContent = postPageHeading(post);
  };

  // What the post is, said about the post rather than about the feed it came out
  // of (#2607). src/post.html ships the sentence that names both provenances and
  // commits to neither, because that is all a page can honestly say before it has
  // read the post — and it is what a reader whose script never runs is left with.
  // Once a post arrives this writes the answer for that one post over it, and
  // every attempt starts by putting the hedge back: a retry after a loaded post,
  // and a lookup that ends in not-found or error, have no post to be specific
  // about. The paragraph is the same paragraph throughout, in the same place in
  // reading order, so the claim moves from general to specific without the page
  // gaining or losing a line under the reader.
  const provenance = document.querySelector("#post-provenance");
  const bothProvenances = provenance?.textContent ?? "";
  const sayProvenance = (post) => {
    if (provenance) provenance.textContent = postProvenanceSentence(post) || bothProvenances;
  };

  let requestVersion = 0;
  const load = async ({ fromRetry = false } = {}) => {
    const version = ++requestVersion;
    const search = window.location.search;
    const params = new URLSearchParams(search);
    const id = params.get("id") ?? "";
    const requestedAuthor = (params.get("author") ?? "").trim();
    const retryFocused = fromRetry && document.activeElement === container.querySelector(".detail-retry");
    // The persistent region holds focus while its button is replaced.
    if (retryFocused) {
      container.setAttribute("tabindex", "-1");
      container.focus();
    }
    // The heading only names a post once there is one. Until then it names the
    // page, and the panel below carries the state. The marker goes back to
    // "loading" on every attempt, including a retry, so anything watching the
    // page (a test, a smoke check) sees the second fetch as its own load.
    document.documentElement.dataset.shiplogPostDetail = "loading";
    nameHeading(null);
    document.title = postDetailTitle(null, "loading");
    offerPeople(false);
    nameControls(false);
    sayProvenance(null);
    renderPostDetail(container, null, { state: "loading", id, author: requestedAuthor, returnHref: POST_EXITS.social.href });
    let post = null;
    let failed = false;
    // Demo identifiers are bounded slugs. Reject broken links before networking;
    // otherwise an offline browser would misclassify them as retryable failures.
    const valid = UUID.test(id) || (id.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(id));
    if (valid) {
      try {
        post = UUID.test(id) ? await fetchLivePost(id) : await fetchSeedPost(id);
      } catch {
        failed = true;
      }
    }
    // A previous attempt must not repaint a newer retry or navigation.
    if (version !== requestVersion || search !== window.location.search) return;
    const state = post ? "loaded" : failed ? "error" : "not-found";
    renderPostDetail(container, post, {
      state,
      id,
      author: post?.author ?? requestedAuthor,
      returnHref: POST_EXITS.social.href,
      onRetry: () => load({ fromRetry: true }),
    });
    if (post) {
      const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(post.createdAt));
      container.querySelector(".share-control").append(
        renderReportButton(post, when, (selected, opener) => report.open(selected, opener)),
      );
    }
    nameControls(Boolean(post));
    sayProvenance(post);
    nameHeading(post);
    aimPeople(post?.author ?? "");
    offerPeople(Boolean(post));
    document.title = postDetailTitle(post, state);
    document.documentElement.dataset.shiplogPostDetail = "ready";

    // Only hand focus to the result if the reader stayed in the waiting region.
    if (retryFocused && document.activeElement === container) {
      const landing = container.querySelector(".detail-post") ?? container.querySelector(".detail-retry");
      landing?.focus?.();
    }
  };

  window.addEventListener?.("popstate", () => load());

  await load();
}

init();
