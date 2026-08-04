// Which releases shipped a decision.
//
// Shiplog stores exactly one association: a release names the decisions it
// carried in `decisionIds`. Read from the decision's side that is "what shipped
// this", and two surfaces now ask for it — the decision detail page's "Linked
// releases" section and the history row's inline "Shipped in" line. The rule for
// what is renderable, which release is the most recent one, and what to say when
// the answer cannot be worked out lives here once, so the two renderers cannot
// drift into disagreeing about the same records.
//
// Nothing here touches the DOM or the network. It takes the release records the
// page already holds and returns plain data.

import { releaseDetailHref, releaseStatus, releaseTitle } from "./releases.js";

// A bound on how much one decision can put into the DOM. A log edited outside
// the recorder can name any number of releases; a row is still a row.
export const MAX_LINKED_RELEASES = 100;

// One name for this relationship, wherever it is put into words: the history
// row's label, the rows of the decision detail's release section, and the
// release detail's heading. Held here so the three cannot drift into three
// different words for the same association.
//
// Shiplog stores exactly one kind of link — a release names the decisions it
// carried — so this is the only relationship the records can state. A weaker
// one, where a release merely mentions a decision it did not deliver, is not
// representable today, and no view may word a link as if it were.
export const SHIPPED_IN_LABEL = "Shipped in";

export const text = (value, fallback = "") => typeof value === "string" && value.trim() ? value.trim() : fallback;

// Stored data can be edited outside the recorder. Keep route identifiers free of
// invisible controls and bound the copy a view will put into the DOM.
export const UNSAFE_IDENTIFIER_CHARACTERS = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u;
const UNSAFE_DISPLAY_CHARACTERS = /[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu;
export const boundedText = (value, max) => {
  const normalized = text(value).replace(UNSAFE_DISPLAY_CHARACTERS, "");
  return normalized.length <= max ? normalized : normalized.slice(0, max);
};

// A release is renderable when it can be named and routed to: an id for the
// existing release detail route, and a version to name the link by. Everything
// else has a stated fallback so one malformed record never empties the section.
// A missing or unparseable date is kept and said out loud rather than dropped —
// the association is still true, only its position in time is unknown.
//
// The returned strings are the ones a view puts in a text node. They are bounded
// and stripped of invisible controls here, and never escaped anywhere: a version
// carrying markup is characters, and characters are what `textContent` renders.
export function normalizeShippedRelease(release) {
  const id = text(release?.id);
  const version = boundedText(release?.version, 40);
  if (!id || id.length > 200 || UNSAFE_IDENTIFIER_CHARACTERS.test(id) || !version) return null;
  const createdAt = text(release?.createdAt);
  const dated = Boolean(createdAt) && !Number.isNaN(Date.parse(createdAt));
  const title = boundedText(releaseTitle(release), 120);
  return {
    id,
    version,
    // releaseTitle falls back to the version, which the link already shows.
    title: title === version ? "" : title,
    status: releaseStatus(release),
    createdAt: dated ? createdAt : "",
    dated,
    timestamp: dated ? Date.parse(createdAt) : 0,
    href: releaseDetailHref(id),
  };
}

// The renderable associations, in the order the records compose them, one entry
// per release. A release that names the same decision twice is one association,
// not two — the same rule the history rows follow.
export function shippedReleaseEntries(releases) {
  const seen = new Set();
  const entries = [];
  for (const release of Array.isArray(releases) ? releases : []) {
    const entry = normalizeShippedRelease(release);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push(entry);
    if (entries.length === MAX_LINKED_RELEASES) break;
  }
  return entries;
}

// Newest first, undated last. Total and deterministic: two releases dated the
// same day fall back to the version descending, and two that agree on both keep
// the order the records composed them in, because Array#sort is stable. The same
// input therefore always produces the same "most recent" answer.
export function byNewestRelease(a, b) {
  return Number(a.dated !== true) - Number(b.dated !== true)
    || b.timestamp - a.timestamp
    || b.version.localeCompare(a.version);
}

export function sortByNewestRelease(entries) {
  return [...entries].sort(byNewestRelease);
}

export function normalizeLinkedReleases(releases) {
  return sortByNewestRelease(shippedReleaseEntries(releases));
}

// What a decision row has to say about shipping, as three named states rather
// than a count a renderer has to interpret:
//
//   shipped     — at least one release could be named and routed to.
//   none        — no release names this decision. It has not shipped yet.
//   unresolved  — releases name it, and not one of them could be read. The
//                 association exists and its subject does not, which is a
//                 different fact from "nothing shipped it" and must never be
//                 rendered with the same words.
//
// `newest` is the most recent renderable release and `others` is how many more
// there are, so a summary line can be written without re-deriving the order the
// list is rendered in.
export function shippedState(releases) {
  const carried = Array.isArray(releases) ? releases : [];
  const entries = shippedReleaseEntries(carried);
  if (entries.length === 0) {
    return { state: carried.length > 0 ? "unresolved" : "none", entries, newest: null, others: 0 };
  }
  return {
    state: "shipped",
    entries,
    newest: sortByNewestRelease(entries)[0],
    others: entries.length - 1,
  };
}
