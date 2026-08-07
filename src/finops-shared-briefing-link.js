// A FinOps lead's own retained periods, carried in a link's fragment.
//
// THE PROBLEM THIS SOLVES. A lead reads the AI FinOps answer, wants a colleague
// to read the same thing, and sends them the URL. The colleague opens it in a
// browser that has retained nothing, so the executive briefing falls back to the
// published synthetic sample: same headings, same layout, an invented company's
// figures. Nothing on the page is wrong and the reader is still misled, because
// the one thing they were told — "here are our numbers" — is the one thing the
// page cannot know.
//
// So the numbers travel with the link. Four properties make that safe enough to
// ship on a static site with no server and no account:
//
//   1. THE FRAGMENT, NEVER THE QUERY. Everything after `#` is stripped by the
//      browser before the request line is built: it reaches no server, no proxy
//      log, and no referrer header. `sharedBriefingHref` therefore writes the
//      token into `url.hash` and leaves `url.search` exactly as it found it, and
//      `tests/finops-shared-briefing-link.test.js` asserts the search component
//      is byte-identical to the base URL's.
//
//   2. THE ALLOWLIST IS NOT RESTATED HERE. The fields that may leave the
//      sender's browser are `FINOPS_PERIOD_FIELDS` — the same closed list the
//      retained-period contract already governs the local store with — and every
//      record is put through `validateRetainedPeriod` and `scanRetainedContent`
//      on the way OUT and again on the way IN. A field added to a period record
//      later is absent from a link by default rather than leaked by default, and
//      there is exactly one place to look to find out what may travel.
//
//   3. EVERY REFUSAL HAS A NAME. `SHARE_DECODE_REASON` is a closed set, decoding
//      returns a structured result rather than throwing, and the caller renders
//      the reason. A link this build cannot read must never resolve to a blank
//      page, and must never quietly fall back to the bundled sample as though it
//      were the sender's data — those are the two failure modes this module
//      exists to prevent, and they are the two that look identical to a reader.
//
//   4. DECODING IS READ-ONLY. Nothing here touches storage. There is no upsert,
//      no "last viewed" stamp, and no path to one: the module imports the
//      contract and the two validators and nothing that writes.
//
// The token is not a secret and is not signed. It is the sender's own figures,
// pasted by the sender, and the recipient is told exactly that — see
// `SHARED_ORIGIN` in `executive-briefing-source.js`. A token is evidence of what
// somebody chose to send, not proof of who sent it.

// THE ENVELOPE IS NOT DEFINED HERE (#1207). A link and a downloaded brief file
// carry the SAME object, built and validated by one module, so a disclosure the
// link carries cannot go missing from the file. This module is a transport: it
// base64url-encodes what `buildBriefEnvelope` returns and hands what comes back
// off the wire to `validateBriefEnvelope`. It chooses no field, applies no
// threshold, and holds no copy of the contract to drift from.
import {
  BRIEF_ENVELOPE_REASON, BRIEF_ENVELOPE_SCHEMA, MAX_BRIEF_PERIODS,
  SUPPORTED_BRIEF_ENVELOPE_SCHEMAS, buildBriefEnvelope, serializeBriefEnvelope,
  validateBriefEnvelope,
} from "./finops-brief-envelope.js";

/**
 * The token's schema version. An INTEGER a reader compares, not prose it parses.
 *
 * It is the ENVELOPE's version, re-exported rather than restated: a link and a
 * brief file declare the same number because they carry the same object. A
 * token declaring anything else is refused by name rather than read
 * best-effort: half-understood figures are how a colleague ends up quoting a
 * field this build silently dropped.
 */
export const SHARED_BRIEFING_SCHEMA = BRIEF_ENVELOPE_SCHEMA;

/**
 * Every schema this build reads, weakest-numbered first.
 *
 * A LIST rather than the one integer above, because the sentence a refusal has
 * to say is "this page reads 2" — a range, stated from the same constant the
 * reader actually branches on. A build that learns a second schema adds it to
 * the envelope contract and the refusal sentence, the parity check and the
 * decoder all move together.
 */
export const SUPPORTED_SHARED_SCHEMAS = SUPPORTED_BRIEF_ENVELOPE_SCHEMAS;

/** The fragment parameter the token is carried in: `#brief=<token>`. */
export const SHARED_BRIEFING_FRAGMENT_KEY = "brief";

/**
 * The ceiling a token is written and read under.
 *
 * Fragments are not sent to a server, so this is not a protocol limit — it is a
 * refusal to paste something no reader could handle and no address bar could
 * survive. A sender over it is told their workspace is too large to link rather
 * than handed a truncated one, because a truncated briefing is a wrong briefing.
 */
// Raised from 8,192 for #1207. The envelope now carries the disclosures a
// recipient is owed — the confidence grade and its meaning, the provenance, and
// the Limits statements — which is roughly 2 KB of prose on top of six periods.
// The ceiling is not a protocol limit either way, so the question is what a
// reader's clipboard and address bar survive rather than what a request line
// allows; 12 KiB is comfortably inside every current browser's URL length and
// still refuses a paste no chat client would carry intact.
export const MAX_SHARED_TOKEN_LENGTH = 12288;

/**
 * How many periods a link may carry: the most recent six.
 *
 * The envelope's own cap, re-exported. The store keeps up to
 * `MAX_RETAINED_PERIODS` (24). A shared brief is a message, not a backup, and
 * six months is the span the executive briefing's own trend reads. The cut is
 * stated in the sender's control copy rather than made silently.
 */
export const MAX_SHARED_PERIODS = MAX_BRIEF_PERIODS;

/**
 * Every way a token is refused. A closed set; each renders its own sentence.
 *
 * The five envelope refusals are the ENVELOPE's codes, not a parallel set: a
 * file and a link refuse the same brief for the same named reason, and only the
 * remedy sentence differs. `absent`, `oversize` and `malformed` are this
 * transport's own — a fragment can be missing, too long, or not base64url, none
 * of which a file can be.
 */
export const SHARE_DECODE_REASON = Object.freeze({
  absent: "no_shared_briefing",
  oversize: "token_over_length",
  malformed: "token_not_decodable",
  unsupportedVersion: BRIEF_ENVELOPE_REASON.unsupportedVersion,
  missingDisclosures: BRIEF_ENVELOPE_REASON.missingDisclosures,
  rejectedRecords: BRIEF_ENVELOPE_REASON.rejectedRecords,
  empty: BRIEF_ENVELOPE_REASON.empty,
});

/** What each refusal says: what is true, what it means, what to do about it. */
export const SHARE_DECODE_COPY = Object.freeze({
  [SHARE_DECODE_REASON.absent]: Object.freeze({
    summary: "This link carries no shared figures",
    statement: "The address has no shared-briefing fragment on it, so there is nothing in the link "
      + "for this page to brief on.",
    remedy: "Nothing was read from your browser and nothing was stored. Ask the sender to copy the "
      + "link again from the AI FinOps answer region.",
  }),
  [SHARE_DECODE_REASON.oversize]: Object.freeze({
    summary: "The shared figures in this link are too long to read",
    statement: `The fragment on this address is longer than the ${MAX_SHARED_TOKEN_LENGTH} characters `
      + "this build will read, so it was refused whole rather than read in part.",
    remedy: "A partly read briefing would quote months that are not in it. Ask the sender to share "
      + "fewer periods, or to send the downloaded briefing file instead.",
  }),
  [SHARE_DECODE_REASON.malformed]: Object.freeze({
    summary: "The shared figures in this link could not be decoded",
    statement: "The fragment on this address is not a briefing token this build can decode — a copied "
      + "link is easily cut short by a chat client or an email wrapper.",
    remedy: "Nothing of yours was read or changed. Ask the sender for the link again, copied whole.",
  }),
  [SHARE_DECODE_REASON.missingDisclosures]: Object.freeze({
    summary: "The shared figures arrived without their Limits disclosures",
    statement: "The link carries a brief, but at least one of the confidence grade, the provenance "
      + "and the Limits statements is absent — the three things that say how far the figure can be "
      + "trusted.",
    remedy: "No part of the brief is shown, because a figure without the sentences that bound it "
      + "reads as more certain than it is. Ask the sender to copy a fresh link.",
  }),
  [SHARE_DECODE_REASON.unsupportedVersion]: Object.freeze({
    summary: "The shared figures were written by a different build",
    statement: `The token declares a schema this build does not know; it reads versions `
      + `${SUPPORTED_SHARED_SCHEMAS.join(" and ")} and reinterpreting another would mean guessing at `
      + "fields it cannot see.",
    remedy: "Nothing was changed. Reloading after this site next updates is what makes the link "
      + "readable, or the sender can copy a fresh one.",
  }),
  [SHARE_DECODE_REASON.rejectedRecords]: Object.freeze({
    summary: "A shared period failed the retained-record contract",
    statement: "At least one period in this link was rejected by the same contract this browser holds "
      + "its own retained periods to, so briefing on the rest could publish a partial figure.",
    remedy: "No shared figure is shown and nothing of yours was read or changed. Ask the sender to "
      + "run their analysis again and copy a fresh link.",
  }),
  [SHARE_DECODE_REASON.empty]: Object.freeze({
    summary: "The shared link carries no period",
    statement: "The token decoded, declared this build's schema, and holds no period, so there is no "
      + "month in it to brief on.",
    remedy: "Nothing of yours was read or changed. Ask the sender to analyze an export before copying "
      + "the link.",
  }),
});

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * Translate an envelope verdict into this transport's vocabulary.
 *
 * Four of the five codes pass straight through — they are the same refusal on
 * either transport. `not_a_brief` becomes `malformed`, because on a link the
 * thing that was not a brief was a fragment somebody's chat client cut in half,
 * and the remedy for that is "copied whole", not "ask for a different file".
 */
const asDecodeReason = (reason) => (reason === BRIEF_ENVELOPE_REASON.notABrief
  ? SHARE_DECODE_REASON.malformed
  : reason);

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(token) {
  const padded = token.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const refusal = (reason) => Object.freeze({
  ok: false, reason, token: "", periods: Object.freeze([]), envelope: null,
  ...SHARE_DECODE_COPY[reason],
});

/**
 * Encode the sender's own retained periods into a fragment token.
 *
 * @param periods retained-period records, newest last, as the workspace keeps them.
 * @param options `{ producedAt }` — passed straight to the envelope builder. No
 *   clock is read here: two encodes of the same analysis must produce the same
 *   token, or the parity check in `finops-share-parity.js` cannot compare them.
 * @returns `{ ok, reason, token, periods, envelope, summary?, statement?,
 *   remedy? }`, frozen. `ok` is false with a named reason rather than a thrown
 *   error, because the control that calls this has to say why it is disabled.
 */
export function encodeSharedBriefing(periods, options = {}) {
  const built = buildBriefEnvelope(periods, options);
  if (!built.ok) return refusal(asDecodeReason(built.reason));

  let token;
  try {
    // Compact, not indented: a token has to survive an address bar, and the
    // whitespace a file gets for readability would be a third of the fragment.
    // Same object either way — that is what the parity test asserts.
    token = toBase64Url(serializeBriefEnvelope(built.envelope));
  } catch {
    return refusal(SHARE_DECODE_REASON.malformed);
  }
  if (token.length > MAX_SHARED_TOKEN_LENGTH) return refusal(SHARE_DECODE_REASON.oversize);
  return Object.freeze({
    ok: true,
    reason: "encoded",
    token,
    periods: built.envelope.periods,
    envelope: built.envelope,
  });
}

/**
 * Decode a fragment token back into retained-period records.
 *
 * READ-ONLY. No storage is touched on any path, including the failing ones.
 *
 * @returns `{ ok, reason, periods, envelope, summary?, statement?, remedy? }`,
 *   frozen. The envelope is the shared contract's own projection: rebuilt field
 *   by field, so an unknown key a hostile token carried reaches no caller.
 */
export function decodeSharedBriefing(token) {
  if (typeof token !== "string" || token === "") return refusal(SHARE_DECODE_REASON.absent);
  if (token.length > MAX_SHARED_TOKEN_LENGTH) return refusal(SHARE_DECODE_REASON.oversize);
  if (!BASE64URL.test(token)) return refusal(SHARE_DECODE_REASON.malformed);

  let parsed;
  try {
    parsed = JSON.parse(fromBase64Url(token));
  } catch {
    return refusal(SHARE_DECODE_REASON.malformed);
  }
  // Version, required fields, disclosures and records are all the ENVELOPE's
  // call, checked whole before anything is returned. This transport adds no rule
  // of its own here — a link and a file that refuse the same brief for different
  // reasons would be two contracts wearing one name.
  const read = validateBriefEnvelope(parsed);
  if (!read.ok) return refusal(asDecodeReason(read.reason));

  return Object.freeze({
    ok: true,
    reason: "decoded",
    periods: read.envelope.periods,
    envelope: read.envelope,
  });
}

/**
 * The schema version a token DECLARES, which is not the same as one this build
 * reads. Nothing else in the envelope is trusted or returned.
 *
 * The parity check needs this to say "unsupported schema version 3" rather than
 * "could not read the link": a refusal that cannot name the version it refused
 * sends a lead looking for a broken clipboard instead of a stale build.
 *
 * @returns the declared value verbatim when the envelope parses — any type, so
 *   a caller can report `"2.0"` as the string it was — and null otherwise.
 */
export function declaredSchemaVersion(token) {
  if (typeof token !== "string" || token === "" || !BASE64URL.test(token)) return null;
  if (token.length > MAX_SHARED_TOKEN_LENGTH) return null;
  try {
    const envelope = JSON.parse(fromBase64Url(token));
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return null;
    return envelope.v ?? null;
  } catch {
    return null;
  }
}

/**
 * Pull the token out of a location fragment.
 *
 * Reads `#brief=<token>` out of a fragment that may carry other keys, and
 * returns "" when there is none. A fragment that is an ordinary anchor — the
 * shape every previously shared deep link on this site has — yields "".
 */
export function sharedBriefingToken(hash) {
  if (typeof hash !== "string" || hash === "") return "";
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!fragment.includes("=")) return "";
  for (const pair of fragment.split("&")) {
    const separator = pair.indexOf("=");
    if (separator < 0) continue;
    if (pair.slice(0, separator) !== SHARED_BRIEFING_FRAGMENT_KEY) continue;
    return pair.slice(separator + 1);
  }
  return "";
}

/** Decode whatever a location's fragment carries. Total; never throws. */
export function readSharedBriefingFragment(hash) {
  return decodeSharedBriefing(sharedBriefingToken(hash));
}

/**
 * Build the link the sender copies.
 *
 * The token goes in the hash and NOWHERE else: `url.search` is whatever the base
 * URL already carried, untouched, so a briefing link cannot become a request
 * carrying a company's spend figures in its query string.
 *
 * @returns `{ ok, reason, url, token, ... }`, frozen. `url` is "" on any refusal.
 */
export function sharedBriefingHref(base, periods, options = {}) {
  const encoded = encodeSharedBriefing(periods, options);
  if (!encoded.ok) return Object.freeze({ ...encoded, url: "" });
  let url;
  try {
    url = new URL(base);
  } catch {
    return Object.freeze({ ...refusal(SHARE_DECODE_REASON.malformed), url: "" });
  }
  url.hash = `${SHARED_BRIEFING_FRAGMENT_KEY}=${encoded.token}`;
  return Object.freeze({ ...encoded, url: url.href });
}
