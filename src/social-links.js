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

// And the sentence that says it back, built from the label rather than typed
// beside it, so the words a reader is sent looking for are the words printed on
// the control by construction.
//
// It is written into the page by the two feed modules instead of being authored
// in social.html and profile.html, because it is an instruction about a control
// that only exists once a card does. The frame before hydration has no cards in
// it, and neither does a feed that is still loading, one that failed, or one a
// filter has emptied — so in all of those the sentence names nothing on screen
// and is not on the page at all. Same reason the connection line ships wordless
// in both pages (src/social.html, src/profile.html).
export const OPEN_POST_INSTRUCTION = `Select ${OPEN_POST_LABEL} to read a post in full.`;

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
