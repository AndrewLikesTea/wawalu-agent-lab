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

// What Social prints on the control that opens its composer, owned here for the
// same reason OPEN_POST_LABEL is: both pages say these three words back to a
// reader — Social's own waiting and empty lines, and People's route into the
// composer — and a second wording on one of them sends a visitor to Social
// looking for a control that is not there. People used to say "Write a post on
// Social", which was that exact failure. The button that renders the label is
// authored in src/social.html (#post-compose-open); the pages that only name it
// take it from here.
export const PUBLISH_POST_LABEL = "Publish a post";

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

// The third URL shape, and the mirror of the one above: People filtered to a
// display name links back to that same name's whole feed on Social, text posts
// included. Without it a reader who wanted the rest of one name's posts had to
// open Social and re-select a filter the page they were standing on already
// knew.
//
// One parameter name for one idea across three pages. /post.html and
// /profile.html both carry a display name as `author`, so the feed reads the
// same word rather than inventing a fourth spelling of it, and the value is a
// plain display name percent-encoded once — no casing rule, no slug, nothing to
// reverse at the other end.
export const FEED_AUTHOR_PARAM = "author";

export function socialFeedHref(author) {
  return `/social.html?${FEED_AUTHOR_PARAM}=${encodeURIComponent(String(author ?? "").trim())}`;
}

// The read half of that contract, next to the write half so the two cannot
// drift: src/social.js hands it the page's query string and gets back a display
// name to preselect, or "" when nobody was asked for. Trimmed, because a name
// that arrives with padding would match no option in the menu and silently show
// the whole feed instead.
export function requestedFeedAuthor(search) {
  return String(new URLSearchParams(String(search ?? "")).get(FEED_AUTHOR_PARAM) ?? "").trim();
}

// What that link is called on People, owned here beside the label Social's own
// links to People use. It names the display name and the destination, because a
// link that said only the name would not say where activating it goes, and it
// leads on "every post" — the one word that separates the feed at the other end
// from the image posts People is showing.
//
// It stops there. People's intro already says what the whole feed includes
// ("including posts with no image"), and a test on this page counts that rule as
// stated once in the main content: this link is the second route to Social, not
// a second telling of the rule that explains why anyone would take it.
//
// "published under" is the site's phrasing for the relationship between a post
// and a display name — People's own picker hint and its publishing helper both
// spell it that way — and there is no count in it: the number belongs to the
// feed at the other end, which this page has not loaded.
export function socialAllPostsLabel(author) {
  return `See every post published under ${String(author ?? "").trim()} on Social`;
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
