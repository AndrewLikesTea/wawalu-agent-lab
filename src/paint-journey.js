// The round trip between the social pages and Paint.
//
// Sits beside src/publishing-media.js for the same reason: both ends of a
// handoff have to agree, so the agreement lives in one module that neither end
// owns. publishing-media.js carries the *image* from Paint back to the feed;
// this module carries the *place you came from* into Paint so the editor can
// offer a way back that lands where you started.
//
// Why a route key instead of a return URL: the origin writes `?from=profile`,
// never `?from=/profile.html`. A URL taken from the query string and written to
// an href is an open redirect and a `javascript:` sink; a key looked up in a
// table can only ever produce one of the paths written literally below. The
// author name is the single piece of free text that survives the trip, and it
// is length-capped and percent-encoded on the way out — it decorates a label
// and fills a query value, and can never widen the set of reachable paths.
//
// Both ends degrade rather than fail: an unknown key, a missing key, or no
// query string at all resolves to the same generic pair of links that the Paint
// shell already ships in static HTML, so a visitor with no JavaScript sees
// exactly what a visitor with a broken `from` sees.

import { MAX_AUTHOR_LENGTH } from "./social-identity.js";

export const PAINT_PATH = "/paint/";
export const PROFILE_PATH = "/profile.html";
export const FEED_PATH = "/social.html";

// The only origins Paint will name. Adding a third entry is the whole cost of
// wiring another page into the journey.
export const JOURNEY_ORIGINS = new Set(["profile", "feed"]);

// A name only survives the trip if it round-trips as itself. The cap matches
// social-identity's, so a name Paint cannot carry is one the feed would have
// refused to store in the first place.
function safeAuthor(value) {
  const name = String(value ?? "").trim();
  return name && name.length <= MAX_AUTHOR_LENGTH ? name : "";
}

function profileLink(author, label) {
  const name = safeAuthor(author);
  return { href: name ? `${PROFILE_PATH}?author=${encodeURIComponent(name)}` : PROFILE_PATH, label };
}

// The link a social page points at Paint. `author` is optional: the profile
// grid knows whose profile is empty, the feed does not.
export function paintEntryHref({ from = "", author = "" } = {}) {
  const origin = JOURNEY_ORIGINS.has(from) ? from : "";
  const name = safeAuthor(author);
  const query = new URLSearchParams();
  if (origin) query.set("from", origin);
  if (origin === "profile" && name) query.set("author", name);
  const search = query.toString();
  return search ? `${PAINT_PATH}?${search}` : PAINT_PATH;
}

// The two links Paint shows. Always two, always in reading order: where you
// came from first, the other side of the product second. Returning a fixed-
// length list keeps the shell's markup static — JavaScript relabels anchors
// that already exist rather than building navigation the no-JS visitor loses.
export function resolveJourneyLinks(search = "") {
  const query = new URLSearchParams(String(search ?? "").replace(/^\?/, ""));
  const from = query.get("from") ?? "";
  const author = safeAuthor(query.get("author"));
  const feed = { href: FEED_PATH, label: "Go to team feed" };

  if (from === "feed") return [{ href: FEED_PATH, label: "Back to team feed" }, profileLink("", "Go to your profile")];
  if (from === "profile") {
    return [profileLink(author, author ? `Back to ${author}’s profile` : "Back to your profile"), feed];
  }
  return [profileLink("", "Go to your profile"), feed];
}
