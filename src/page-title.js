// One place that builds the string a reader sees in a browser tab.
//
// Every Shiplog title has the same shape: the most specific thing first, the
// surface it belongs to next, the product last —
// `Adopt a durable job queue · Decisions · Shiplog`. Four pages used to assemble
// that by hand, which is how three of them ended up saying the same thing.
//
// A tab is narrow, so the whole string stays under LIMIT characters. When a
// record's own name is what has to give, it is cut at a word boundary and marked
// with an ellipsis: a shortened sentence is still recognisable, a severed word
// is not.
//
// Relative-import safe: this module is loaded by `node --test` as well as by the
// browser, so it imports nothing and depends on no DOM.

export const PRODUCT = "Shiplog";
export const SEPARATOR = " · ";
export const TITLE_LIMIT = 60;

const clean = (value) => String(value ?? "").trim();

// Joins the segments a page names itself by and appends the product. Empty
// segments drop out, so `pageTitle("", "Decisions")` is `Decisions · Shiplog`
// rather than a title with a hole in it.
export function pageTitle(...segments) {
  return [...segments.map(clean).filter(Boolean), PRODUCT].join(SEPARATOR);
}

// Cuts `text` to at most `limit` characters, ending on a word boundary with an
// ellipsis. Trailing punctuation goes with the cut word — `Down-route routine,…`
// reads as a typo, `Down-route routine…` reads as an abbreviation.
export function truncate(text, limit) {
  const value = clean(text);
  if (limit <= 0) return "";
  if (value.length <= limit) return value;
  const room = limit - 1; // the ellipsis takes one character
  const clipped = value.slice(0, room);
  // A clip that lands exactly on a space already ended on a whole word; only
  // one that lands inside a word has to give that word back.
  const boundary = value[room] === " " ? -1 : clipped.lastIndexOf(" ");
  const head = (boundary > 0 ? clipped.slice(0, boundary) : clipped).replace(/[\s,;:.!?—–-]+$/, "");
  return `${head || clipped.trimEnd()}…`;
}

// A title for a page named after one record: a decision, a release, a post, a
// profile. `surface` is the trailing name the nav gives the page's home, so
// whatever room it leaves is what the record's own name gets.
//
// `fallback` is what the page is called when the record has no usable name. It
// replaces the record segment rather than joining it, because a nameless record
// should leave the tab reading like the page it is — `Decision · Shiplog`, the
// same string the HTML shipped with — and never like the list it came from.
export function recordTitle(name, { surface, fallback } = {}) {
  const room = TITLE_LIMIT - 1 - pageTitle(surface).length - SEPARATOR.length;
  const named = truncate(name, room);
  return named ? pageTitle(named, surface) : pageTitle(fallback || surface);
}
