// The two URL shapes Social's surfaces link to each other with: a post's
// permalink and a display name's People page.
//
// They live in their own module because three surfaces now need them and two of
// those already import each other. src/profile.js owned them and re-exports them
// still, so every existing caller is unchanged; src/social.js — which profile.js
// imports — can now build the same links without a cycle between the two.
//
// One owner matters here more than it looks: /post.html reads its post out of
// `?id=` (see src/post-page.js), so a link built any other way resolves to a
// permalink that cannot find its own post.

// What both feeds print on the control that opens a post, owned here because
// both of them already import this module for the URL that control points at.
// The pages say these two words back to the reader ("Select Open post to read a
// post in full."), so a second wording on one surface would leave that sentence
// naming a control the reader cannot find.
export const OPEN_POST_LABEL = "Open post";

// `from` is provenance, written by the surface that links to the post so the
// detail page can offer one back link that names where the reader actually came
// from. Same parameter, same value, same defaulting rule as profilePaintHref in
// src/profile.js and src/paint/paint.js: only "profile" means anything, and a
// link that omits it gets the feed's exit.
export function postDetailHref(id, author = "", from = "") {
  const params = new URLSearchParams({ id: String(id ?? "") });
  const name = String(author ?? "").trim();
  if (name) params.set("author", name);
  if (from) params.set("from", String(from));
  return `/post.html?${params}`;
}

// The absolute address a reader can carry away — the value a copy control hands
// to the clipboard. Built from postDetailHref above, so it is the one URL shape
// /post.html reads its post out of, and the id goes through URLSearchParams:
// an id that arrived over the wire is encoded rather than concatenated, so it
// cannot open a second parameter, a fragment, or a scheme of its own. No
// ?author=, no ?from=, because those are how one reader got here and not part of
// the post.
//
// No id or no origin, no link: a URL that cannot be resolved absolutely is no
// use pasted into a chat window, so the control that would offer it is withdrawn
// rather than left handing over something broken.
//
// Owned here rather than on the permalink page for the same reason the two hrefs
// above are: /post.html's copy control and Social's publish confirmation both
// hand over this address now, and a second rule for building it would be a
// second answer to "what is this post's link". src/post-detail.js re-exports it,
// so every existing caller is unchanged.
export function postPermalink(id, origin) {
  const wanted = String(id ?? "").trim();
  if (!wanted) return "";
  try {
    return new URL(postDetailHref(wanted), origin).href;
  } catch {
    return "";
  }
}

// What the control that hands over that address is called, on both surfaces that
// offer it. One wording, for the same reason OPEN_POST_LABEL is one wording.
export const POST_COPY_LABEL = "Copy link to this post";

export function profileHref(author) {
  return `/profile.html?author=${encodeURIComponent(String(author ?? ""))}`;
}

// What a link to People is called, wherever Social offers one. It names the
// display name AND the destination, because both the feed card and the publish
// confirmation put it beside other links, and "Iris Vale" on its own does not
// say where activating it goes.
//
// Owned here for the same reason OPEN_POST_LABEL is: two surfaces print it, and
// a second wording on one of them would be a second promise about the same
// place.
export function peopleImagePostsLabel(author) {
  return `See ${String(author ?? "").trim()}’s image posts on People`;
}
