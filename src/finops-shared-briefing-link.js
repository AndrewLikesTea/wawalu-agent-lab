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

import { FINOPS_PERIOD_FIELDS } from "./finops-workspace-contract.js";
import { scanRetainedContent, validateRetainedPeriod } from "./finops-workspace.js";
// The repository's one deterministic serializer: same values in, same bytes out,
// because every object is rebuilt with its keys sorted. Reused rather than
// reimplemented so a link and a downloaded briefing cannot disagree about what
// "the same figures" means.
import { serializeBriefing } from "./finops-briefing-export.js";

/**
 * The token's schema version. An INTEGER a reader compares, not prose it parses.
 *
 * A token declaring anything else is refused by name rather than read
 * best-effort: half-understood figures are how a colleague ends up quoting a
 * field this build silently dropped.
 */
export const SHARED_BRIEFING_SCHEMA = 1;

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
export const MAX_SHARED_TOKEN_LENGTH = 8192;

/**
 * How many periods a link may carry: the most recent six.
 *
 * The store keeps up to `MAX_RETAINED_PERIODS` (24). A link is a message, not a
 * backup, and six months is the span the executive briefing's own trend reads.
 * The cut is stated in the sender's control copy rather than made silently.
 */
export const MAX_SHARED_PERIODS = 6;

/** Every way a token is refused. A closed set; each renders its own sentence. */
export const SHARE_DECODE_REASON = Object.freeze({
  absent: "no_shared_briefing",
  oversize: "token_over_length",
  malformed: "token_not_decodable",
  unsupportedVersion: "unsupported_token_version",
  rejectedRecords: "records_failed_contract",
  empty: "no_period_in_token",
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
  [SHARE_DECODE_REASON.unsupportedVersion]: Object.freeze({
    summary: "The shared figures were written by a different build",
    statement: `The token declares a schema this build does not know; it reads version `
      + `${SHARED_BRIEFING_SCHEMA} and reinterpreting another would mean guessing at fields it cannot see.`,
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

/** Project one record onto the contract's allowlist. Copied out, never spread. */
function projectPeriod(period) {
  const projected = {};
  for (const field of FINOPS_PERIOD_FIELDS) {
    if (period?.[field] !== undefined) projected[field] = period[field];
  }
  return projected;
}

/**
 * Hold a list of records to the same contract in both directions.
 *
 * Encoding and decoding call this with the same arguments, which is the point:
 * a record this build would refuse to read is a record it refuses to write.
 */
function contractViolations(periods) {
  if (!Array.isArray(periods)) return true;
  if (periods.length > MAX_SHARED_PERIODS) return true;
  for (const period of periods) {
    if (!validateRetainedPeriod(period).ok) return true;
    for (const key of Object.keys(period)) {
      if (!FINOPS_PERIOD_FIELDS.includes(key)) return true;
    }
  }
  return !scanRetainedContent(periods, "periods").ok;
}

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
  ok: false, reason, token: "", periods: Object.freeze([]),
  ...SHARE_DECODE_COPY[reason],
});

/**
 * Encode the sender's own retained periods into a fragment token.
 *
 * @param periods retained-period records, newest last, as the workspace keeps them.
 * @returns `{ ok, reason, token, periods, summary?, statement?, remedy? }`, frozen.
 *   `ok` is false with a named reason rather than a thrown error, because the
 *   control that calls this has to say why it is disabled.
 */
export function encodeSharedBriefing(periods) {
  if (!Array.isArray(periods) || periods.length === 0) {
    return refusal(SHARE_DECODE_REASON.empty);
  }
  // The most recent six. `slice` from the end because the store appends.
  const shared = periods.slice(-MAX_SHARED_PERIODS).map(projectPeriod);
  if (contractViolations(shared)) return refusal(SHARE_DECODE_REASON.rejectedRecords);

  let token;
  try {
    token = toBase64Url(serializeBriefing({ v: SHARED_BRIEFING_SCHEMA, periods: shared }));
  } catch {
    return refusal(SHARE_DECODE_REASON.malformed);
  }
  if (token.length > MAX_SHARED_TOKEN_LENGTH) return refusal(SHARE_DECODE_REASON.oversize);
  return Object.freeze({
    ok: true,
    reason: "encoded",
    token,
    periods: Object.freeze(shared.map((period) => Object.freeze(period))),
  });
}

/**
 * Decode a fragment token back into retained-period records.
 *
 * READ-ONLY. No storage is touched on any path, including the failing ones.
 *
 * @returns `{ ok, reason, periods, summary?, statement?, remedy? }`, frozen.
 */
export function decodeSharedBriefing(token) {
  if (typeof token !== "string" || token === "") return refusal(SHARE_DECODE_REASON.absent);
  if (token.length > MAX_SHARED_TOKEN_LENGTH) return refusal(SHARE_DECODE_REASON.oversize);
  if (!BASE64URL.test(token)) return refusal(SHARE_DECODE_REASON.malformed);

  let envelope;
  try {
    envelope = JSON.parse(fromBase64Url(token));
  } catch {
    return refusal(SHARE_DECODE_REASON.malformed);
  }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return refusal(SHARE_DECODE_REASON.malformed);
  }
  // Version before shape: a token from a build that changed what `periods` means
  // must be refused as the wrong version, not as a malformed one.
  if (envelope.v !== SHARED_BRIEFING_SCHEMA) {
    return refusal(SHARE_DECODE_REASON.unsupportedVersion);
  }
  if (!Array.isArray(envelope.periods)) return refusal(SHARE_DECODE_REASON.malformed);
  if (envelope.periods.length === 0) return refusal(SHARE_DECODE_REASON.empty);
  if (contractViolations(envelope.periods)) return refusal(SHARE_DECODE_REASON.rejectedRecords);

  return Object.freeze({
    ok: true,
    reason: "decoded",
    periods: Object.freeze(envelope.periods.map((period) => Object.freeze(projectPeriod(period)))),
  });
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
export function sharedBriefingHref(base, periods) {
  const encoded = encodeSharedBriefing(periods);
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
