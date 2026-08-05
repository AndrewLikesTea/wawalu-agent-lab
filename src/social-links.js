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
