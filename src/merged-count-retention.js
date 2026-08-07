// What this browser remembers of the one number nobody invented.
//
// The counted-pull-request block is the site's proof point, and the request
// behind it is unauthenticated: a prospect is routinely rate-limited, so the
// block used to be blank exactly when somebody looked at it. This module is the
// memory that fixes that, and the whole of it — both surfaces read and write the
// figure through here, so the home page and the Agent observatory cannot end up
// remembering two different things about one response.
//
// WHAT IS REMEMBERED IS A RESPONSE, NOT A RENDER. Only a count that came back
// from public GitHub is written, and it is written with the moment it was taken.
// A figure with no time behind it is never stored and never shown, because a
// number a reader cannot date is a number they cannot check. There is no seed,
// no default, and no constant to fall back to: a browser that has never seen a
// real response has nothing here, and both pages say so in words.
//
// NOTHING IN HERE THROWS. Reading `localStorage` is what raises when site data
// is disabled, so the accessor itself is wrapped rather than the call after it,
// and every read treats "absent", "unparseable", and "the wrong shape" as the
// same answer: no retained count.
import { SOURCE_REPOSITORIES } from "./public-merges.js";

/** One key, named for what it holds, shared by both surfaces. */
export const RETAINED_COUNT_KEY = "shiplog.merged-pull-request-count";

/** Bumped when the stored shape changes, so an old entry is simply not read. */
export const RETAINED_COUNT_SCHEMA = 1;

/**
 * A stored or published count record, or `null` when there is not one.
 *
 * A record is usable only when it carries both halves — a whole non-negative
 * count and a timestamp that parses — because "how many" without "when" is the
 * undated number this block may not render. A count of 0 is a real answer public
 * GitHub can give, so it is a record like any other and never "no record".
 */
export function parseCountRecord(payload) {
  const count = payload?.count;
  const takenAt = payload?.takenAt;
  if (!Number.isInteger(count) || count < 0 || typeof takenAt !== "string") return null;
  const taken = new Date(takenAt);
  if (Number.isNaN(taken.getTime())) return null;
  return { count, takenAt: taken };
}

/**
 * This browser's storage, or null. Acquired here rather than in a page: the
 * accessor throws on an origin with site data disabled, and a proof block must
 * not be the thing that takes the page down.
 */
export function browserCountStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The last count this browser saw public GitHub return, or `null`.
 *
 * Absent, unreadable, not an object, written by a schema this version does not
 * know, or missing either half — all of them are the same answer, and none of
 * them reaches the page as a figure.
 */
export function readRetainedCount(storage = browserCountStorage()) {
  let raw;
  try {
    raw = storage?.getItem(RETAINED_COUNT_KEY) ?? null;
  } catch {
    return null;
  }
  if (typeof raw !== "string" || !raw) return null;
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (value.schemaVersion !== RETAINED_COUNT_SCHEMA) return null;
  return parseCountRecord(value);
}

/**
 * Remember a count public GitHub actually returned.
 *
 * Held to exactly the rule the read is held to, so this function cannot be the
 * way an undated or half-written figure gets into storage and back onto a page.
 * Returns what was stored, or `null` when nothing was — a refusal and a browser
 * that would not take the write are the same non-event to a caller.
 */
export function writeRetainedCount(storage, { count, asOf } = {}) {
  if (!Number.isInteger(count) || count < 0) return null;
  if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) return null;
  if (typeof storage?.setItem !== "function") return null;
  const record = { schemaVersion: RETAINED_COUNT_SCHEMA, count, takenAt: asOf.toISOString() };
  try {
    storage.setItem(RETAINED_COUNT_KEY, JSON.stringify(record));
  } catch {
    return null;
  }
  return record;
}

/** Of two records, the one taken later. Either may be absent. */
export function mostRecentRecord(left, right) {
  if (!left) return right ?? null;
  if (!right) return left;
  return right.takenAt > left.takenAt ? right : left;
}

// The date a retained count was taken, ISO-8601 rather than a locale format: it
// is the same string the record itself holds, so what a reader sees and what
// storage says cannot drift, and it stays unambiguous for a reader who is not in
// the writer's locale. The clock is stamped UTC for the same reason.
export const formatRetainedDate = (date) => date.toISOString().slice(0, 10);
export const formatRetainedClock = (date) => `${date.toISOString().slice(11, 16)} UTC`;

/**
 * The words that say a figure is an earlier one, in full, before the date.
 *
 * It is a whole clause and not a badge: a reader who glances at the block has to
 * learn from the sentence itself that public GitHub did not answer and that this
 * number is the last one taken. Both surfaces render it as plain text in the
 * status region — never behind a details element, a tooltip, or a title.
 */
export const RETAINED_LEAD = "Public GitHub activity did not answer just now, so this is the last count "
  + `taken from ${SOURCE_REPOSITORIES.join(" and ")}, as of `;
