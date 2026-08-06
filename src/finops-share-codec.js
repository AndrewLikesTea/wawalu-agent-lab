// One analysis, carried in a URL fragment, so a lead can send their own figures.
//
// THE PROBLEM THIS SOLVES. A FinOps lead who analyses their own export gets an
// answer that lives in one tab. Sending it meant sending a screenshot, or a
// link that opens the bundled invented company on the recipient's screen and
// says so in the marker. This codec turns the bounded answer the page already
// holds into a token, and back, so a link opens the SENDER's numbers.
//
// FOUR RULES THIS MODULE HOLDS.
//
//   1. THE FRAGMENT, AND NOWHERE ELSE. `shareFragment` returns a fragment; the
//      link builder puts it after `#`. A fragment is the one part of a URL a
//      browser does not put on the wire, so the figures cannot reach a server
//      by being clicked. There is no query parameter and no form action here,
//      and `tests/finops-share-link.test.js` holds the built link to it.
//
//   2. PURE, AND BROWSER-ONLY. `btoa`/`atob`, `JSON`, `encodeURIComponent` —
//      the same globals the rest of this bundle already uses. No fetch, no
//      storage read, no storage write, no clock, no random source. Decoding a
//      link a stranger sent must not be able to touch what the reader kept.
//
//   3. A DECODE IS A VALUE, NOT A THROW. `decodeShareToken` always returns
//      `{ ok, reason, message, payload }`. Every failure has a reason from the
//      closed set below and a sentence the page can print, because a reader who
//      followed a link that did not open is owed the reason rather than the
//      bundled company appearing as if nothing happened.
//
//   4. THE FIELD LIST IS NOT FORKED. What may travel is `SHAREABLE_ANSWER`,
//      exported by answer-state.js beside the projection that produces it. This
//      module encodes what that allowlist selects and validates a decoded
//      envelope against the same list, so a field added to the answer is absent
//      from a link until the allowlist names it.

import { SHAREABLE_ANSWER, shareableAnswer } from "./answer-state.js";

/**
 * The envelope's schema version, stated in the token as `v`.
 *
 * Bump when a field in `SHAREABLE_ANSWER` changes meaning or a required one is
 * added. An older build meeting a newer number says so by name — `version` —
 * rather than reading fields it does not understand.
 */
export const SHARE_SCHEMA_VERSION = 1;

/** The fragment key the token rides under. */
export const SHARE_FRAGMENT_KEY = "analysis";

/**
 * The longest token this build will decode, in characters.
 *
 * Browsers and chat clients truncate long URLs, and a truncated token decodes
 * to garbage that a validator has to reject anyway. Refusing the whole thing at
 * a stated ceiling turns "why is this link broken" into one named answer. The
 * bounded answer encodes to roughly 900 characters, so this is ample headroom
 * and still far under what a browser will carry.
 */
export const MAX_SHARE_TOKEN = 4096;

/** How a decode can fail. A closed set; the page prints one message per code. */
export const SHARE_REASON = Object.freeze({
  ok: "ok",
  absent: "absent",
  oversize: "oversize",
  version: "unsupported_version",
  malformed: "malformed",
  incomplete: "incomplete_payload",
});

/**
 * What each reason says to a reader who clicked the link.
 *
 * Three jobs each: what is wrong with the LINK, that nothing of the reader's
 * was changed, and what to ask the sender for. None of them blames the reader,
 * because none of these states is something the reader did.
 */
export const SHARE_REASON_MESSAGE = Object.freeze({
  [SHARE_REASON.ok]: "",
  [SHARE_REASON.absent]: "",
  [SHARE_REASON.oversize]:
    "This shared link is longer than this page will read, so the figures in it were not opened. "
    + "Nothing of yours was changed. Ask the sender to copy the link again — a link that was "
    + "pasted twice, or wrapped by a mail client, is the usual cause.",
  [SHARE_REASON.version]:
    "This shared link was written by a newer version of this page, so the figures in it were not "
    + "opened: reading them would mean guessing at fields this build cannot see. Nothing of yours "
    + "was changed. Reloading after this site next updates is what opens it.",
  [SHARE_REASON.malformed]:
    "This shared link could not be read as a shared analysis — it is truncated or altered. Nothing "
    + "of yours was changed. Ask the sender to send the link again, unbroken and in one piece.",
  [SHARE_REASON.incomplete]:
    "This shared link was read, but it does not carry a whole answer: at least one of the figure, "
    + "the first move, and the confidence grade is missing or is not the kind of value it should "
    + "be. Nothing of yours was changed. Ask the sender to copy the link again.",
});

/** The figures on screen are not the reader's own, and the link says whose. */
export const SHARE_ORIGIN =
  "Opened from a shared link. Every figure here was computed in the sender's browser from their "
  + "own export and carried in the link — not fetched, and not this page's bundled example.";

const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

const failure = (reason) => Object.freeze({
  ok: false,
  reason,
  message: SHARE_REASON_MESSAGE[reason],
  payload: null,
});

// --------------------------------------------------------------------------
// base64url, over UTF-8. `btoa` takes one byte per character, so the JSON is
// widened to its UTF-8 bytes first — a department name with an accent in it
// would otherwise throw here rather than travel.
// --------------------------------------------------------------------------

const toBytes = (text) => encodeURIComponent(text)
  .replace(/%([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

const fromBytes = (binary) => decodeURIComponent(Array.from(binary,
  (character) => `%${character.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""));

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Encode one bounded answer as a fragment token.
 *
 * @param answer the projection `answer-state.js` holds, or anything shaped like
 *   it. A value that carries no shareable answer returns `""` — there is
 *   nothing to link to, and an empty token is what the control reads as "do not
 *   offer a link".
 * @returns a base64url token, or `""`.
 */
export function encodeShareToken(answer) {
  const payload = shareableAnswer(answer);
  if (!payload) return "";
  let token;
  try {
    token = btoa(toBytes(JSON.stringify({ v: SHARE_SCHEMA_VERSION, a: payload })))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  } catch {
    return "";
  }
  // A token this build would refuse to decode is one it must not hand out.
  return token.length > MAX_SHARE_TOKEN ? "" : token;
}

/**
 * Decode a fragment token back into a bounded answer.
 *
 * Total: every path returns the same four-key result and nothing here throws.
 *
 * @param token the token from the fragment, or null.
 * @returns `{ ok, reason, message, payload }`. `payload` is non-null exactly
 *   when `ok` is true.
 */
export function decodeShareToken(token) {
  if (typeof token !== "string" || token === "") return failure(SHARE_REASON.absent);
  // Size before parse, so an oversize token is refused by its own name rather
  // than by whatever `atob` makes of it.
  if (token.length > MAX_SHARE_TOKEN) return failure(SHARE_REASON.oversize);
  if (!BASE64URL.test(token)) return failure(SHARE_REASON.malformed);

  let envelope;
  try {
    envelope = JSON.parse(fromBytes(atob(token.replace(/-/g, "+").replace(/_/g, "/"))));
  } catch {
    return failure(SHARE_REASON.malformed);
  }
  if (!isObject(envelope)) return failure(SHARE_REASON.malformed);
  // The version is read before any field is, which is the whole point of
  // carrying it: an envelope from a build this one does not know is refused
  // whole rather than half-read.
  if (envelope.v !== SHARE_SCHEMA_VERSION) return failure(SHARE_REASON.version);
  if (!isObject(envelope.a)) return failure(SHARE_REASON.malformed);

  const payload = shareableAnswer(envelope.a);
  if (!payload) return failure(SHARE_REASON.incomplete);
  return Object.freeze({
    ok: true, reason: SHARE_REASON.ok, message: "", payload,
  });
}

/** The fragment a token rides in, `#` included. `""` when there is no token. */
export function shareFragment(token) {
  return token ? `#${SHARE_FRAGMENT_KEY}=${token}` : "";
}

/**
 * The token carried by a fragment, or null.
 *
 * Reads the fragment as its own parameter list rather than the location's
 * search: a page opened at `#analysis=…` has an empty query string, and that is
 * the invariant this whole module exists to keep.
 */
export function tokenFromFragment(fragment) {
  if (typeof fragment !== "string" || fragment === "") return null;
  const body = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (!body.includes(`${SHARE_FRAGMENT_KEY}=`)) return null;
  try {
    return new URLSearchParams(body).get(SHARE_FRAGMENT_KEY);
  } catch {
    return null;
  }
}

/**
 * The whole link for one answer: this page, with the token in its fragment.
 *
 * @param answer the bounded answer to share.
 * @param location the page's own location, or a stand-in. Only `origin` and
 *   `pathname` are read — never `search`, so a reader who arrived with query
 *   parameters does not send them on, and never `hash`, so a link built from a
 *   shared link does not stack two tokens.
 * @returns the absolute link, or `""` when there is nothing to share.
 */
export function buildShareLink(answer, location = globalThis.location) {
  const token = encodeShareToken(answer);
  if (!token) return "";
  const path = typeof location?.pathname === "string" ? location.pathname : "/evolution.html";
  const origin = typeof location?.origin === "string" ? location.origin : "";
  return `${origin}${path}${shareFragment(token)}`;
}

/** The allowlist this module encodes, re-exported for callers that check it. */
export { SHAREABLE_ANSWER };
