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
