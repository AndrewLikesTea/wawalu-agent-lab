// A destination on /evolution.html, addressable by URL.
//
// THE DEFECT THIS CLOSES. #1325 gave the page a front door: three named
// destinations, one prioritized, every string rendered from the registry in
// src/finops-destinations.js. What a reader could not do was SEND one. Every
// open of /evolution.html landed at the top of the document, so "look at
// commitment coverage" was a sentence in a chat message rather than an address,
// and the browser's back button unwound scroll positions instead of moving
// between the places the page had just told a leader to go.
//
// This module is the parser and the serializer for that address, and nothing
// else. It reads no DOM, holds no state, and never throws: a parser that throws
// on a hand-typed URL is a blank page, which is strictly worse than the top of
// the document it was meant to improve on. src/destination-route-view.js owns
// everything that touches a document or a History.
//
// ---------------------------------------------------------------------------
// THE ENCODING: QUERY PARAMETERS, AND ONLY QUERY PARAMETERS
// ---------------------------------------------------------------------------
//
// Three reserved names — `destination`, `scope`, `department` — in the query
// string. The fragment is NOT used and must not be: this page already spends
// its hash twice over, on `#brief=` shared-briefing payloads and on the
// `#recommendation-evidence` style deep links that src/deep-link-disclosure.js
// opens disclosures for. A route in the hash would be a third claimant on one
// slot, and the first collision would silently drop somebody's shared brief.
//
// `parseDestinationRoute` accepts a hash-shaped STRING as an input convenience
// (a caller holding `"#destination=..."` gets an answer rather than an
// exception), but nothing in this module ever WRITES one. One encoding out.
//
// ---------------------------------------------------------------------------
// THE RESULT IS A DISCRIMINATED RECORD, NEVER A NULLABLE SLUG
// ---------------------------------------------------------------------------
//
// Four statuses, and there is no fifth:
//
//   ok         The slug is registered. `slug` is the registry's own string.
//   unknown    Syntactically a slug, absent from the registry. A renamed or
//              retired destination, or a link that outlived its target.
//   malformed  Cannot be interpreted: an empty slug, a value whose percent
//              encoding does not decode, a slug that is not kebab-case, or an
//              input whose structure is not a URL, a location or a query.
//   absent     No `destination` parameter at all. This is an ORDINARY open of
//              the page and NOT an error — collapsing it into `malformed`
//              would greet every first-time reader with a message about a
//              destination they never asked for.
//
// Every result carries the same keys whatever the status, so a consumer reads
// `route.scope` without first proving which branch it is in. `slug` is non-null
// only on `ok`; `requestedSlug` is the text the URL actually carried, kept for
// the failure message and for nothing else. It is ATTACKER-CONTROLLABLE and
// must reach a document through `textContent`, never through markup.
//
// ---------------------------------------------------------------------------
// A PARAMETER THE DESTINATION DOES NOT CARRY IS DROPPED, OUT LOUD
// ---------------------------------------------------------------------------
//
// `scope` and `department` are validated against what the REGISTRY says that
// destination carries (`destination.route`). A value the destination does not
// support is removed from the result and recorded in `droppedParams` with its
// name, the value that was dropped and a reason code. It is never preserved: a
// junk value that survives a round trip is a junk value that gets shared,
// bookmarked and reported as a bug six months later.
//
// A bad `scope` does NOT make the whole address malformed. The destination is
// still resolvable, and resolving it is the more useful answer than refusing
// the page over a qualifier.
//
// ---------------------------------------------------------------------------
// IDEMPOTENCE
// ---------------------------------------------------------------------------
//
// `serializeDestinationRoute(parseDestinationRoute(x))` is a fixed point:
// parameters are emitted in one order (destination, scope, department), absent
// values are omitted rather than emitted empty, and values are percent-encoded
// exactly once. tests/destination-route.test.js asserts this over every slug in
// the registry rather than over an example.

import { FINOPS_DESTINATIONS } from "./finops-destinations.js";

/** The three reserved query parameters. Nothing else on the address is ours. */
export const DESTINATION_PARAM = "destination";
export const SCOPE_PARAM = "scope";
export const DEPARTMENT_PARAM = "department";

/** Read in this order, written in this order, so serialization is total. */
export const ROUTE_PARAMS = Object.freeze([
  DESTINATION_PARAM, SCOPE_PARAM, DEPARTMENT_PARAM,
]);

/** The four statuses. There is no fifth. */
export const ROUTE_STATUS = Object.freeze({
  ok: "ok",
  unknown: "unknown",
  malformed: "malformed",
  absent: "absent",
});

/** Why a qualifier was dropped. Reason codes, so a caller can branch on them. */
export const DROP_REASON = Object.freeze({
  // The value's percent encoding does not decode.
  malformedValue: "malformed-value",
  // This destination carries no parameter by that name at all.
  notCarried: "not-carried",
  // It carries one, but not this value.
  notSupported: "not-supported",
  // The destination itself did not resolve, so its qualifiers cannot.
  unresolvedDestination: "unresolved-destination",
});

/** The canonical address of the front door: this page, with no route on it. */
export const FRONT_DOOR_QUERY = "";

/**
 * Slugs are lower-case kebab-case, which is what the registry already asserts
 * of itself in tests/finops-destinations.test.js. Anything else is malformed
 * rather than unknown: `../../etc/passwd` is not a destination somebody
 * retired, and calling it one would put it in a "no longer exists" sentence.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The longest `requestedSlug` this module will hand back. A URL can carry
 * kilobytes; a failure message naming one is still a sentence a person reads.
 * Truncation happens HERE rather than at the render so that every consumer —
 * message, log line, test — sees the same bounded string.
 */
export const MAX_REQUESTED_SLUG_LENGTH = 80;

const clamp = (text) => {
  const value = String(text ?? "");
  return value.length > MAX_REQUESTED_SLUG_LENGTH
    ? `${value.slice(0, MAX_REQUESTED_SLUG_LENGTH - 1)}…`
    : value;
};

/** One decode attempt. `null` — never a replacement character — means "no". */
const decode = (raw) => {
  try {
    return decodeURIComponent(String(raw).replace(/\+/g, " "));
  } catch {
    return null;
  }
};

const encode = (value) => encodeURIComponent(String(value));

/**
 * The query text of whatever was handed in, or `null` when the input's
 * structure cannot be interpreted at all.
 *
 * Accepts: a `URL`, anything location-shaped (`{ search }` or `{ href }`), a
 * full URL string, a `?a=b` string, a bare `a=b` string, and a `#a=b` string.
 * `null`/`undefined`/`""` are an empty query — the ordinary open of the page —
 * rather than a structural failure.
 */
function queryTextOf(input) {
  if (input === null || input === undefined) return "";
  if (typeof input === "string") {
    const raw = input.trim();
    if (raw === "") return "";
    const cut = raw.indexOf("?");
    // A full URL: everything after the first `?` and before the fragment.
    if (cut >= 0) return raw.slice(cut + 1).split("#")[0];
    if (raw.startsWith("#")) return raw.slice(1);
    if (raw.includes("=")) return raw;
    // A bare word is not an address. It may well be a slug, but guessing that
    // here would make `parse("nonsense")` and `parse("?destination=nonsense")`
    // the same call, and only one of them came off a URL.
    return null;
  }
  if (typeof input !== "object") return null;
  if (typeof input.search === "string") return input.search.replace(/^\?/, "");
  if (typeof input.href === "string") return queryTextOf(input.href);
  return null;
}

/**
 * The query's pairs, values left RAW and undecoded.
 *
 * Raw on purpose: one parameter with a broken escape must not cost the reader
 * the rest of the address. This page's own share links put base64url payloads
 * on the query elsewhere, and a route parser that refused the whole string
 * because a neighbouring parameter did not decode would be a new way to lose a
 * shared brief. Each of our three names is decoded on read, individually.
 *
 * First occurrence wins. A repeated parameter is not a second opinion.
 */
function rawPairs(text) {
  const pairs = new Map();
  for (const chunk of String(text).split("&")) {
    if (chunk === "") continue;
    const eq = chunk.indexOf("=");
    const name = decode(eq < 0 ? chunk : chunk.slice(0, eq));
    if (name === null) continue;
    const value = eq < 0 ? "" : chunk.slice(eq + 1);
    if (!pairs.has(name)) pairs.set(name, value);
  }
  return pairs;
}

const result = (status, fields = {}) => Object.freeze({
  status,
  slug: null,
  requestedSlug: null,
  scope: null,
  department: null,
  droppedParams: Object.freeze([]),
  ...fields,
});

const dropped = (name, value, reason) => Object.freeze({ name, value: clamp(value), reason });

/** What the registry says this destination carries. Absent means "carries none". */
const carried = (destination, name) => {
  const allowed = destination?.route?.[name === SCOPE_PARAM ? "scopes" : "departments"];
  return Array.isArray(allowed) ? allowed : [];
};

/**
 * Resolve one qualifier against the registry, appending to `drops` when the
 * value cannot survive.
 */
function qualifier(pairs, name, destination, drops) {
  if (!pairs.has(name)) return null;
  const raw = pairs.get(name);
  const value = decode(raw);
  if (value === null) {
    drops.push(dropped(name, raw, DROP_REASON.malformedValue));
    return null;
  }
  if (value === "") {
    // An empty qualifier is not a selection. It is what a form submits when
    // nobody chose anything, and it must not round-trip as `scope=`.
    drops.push(dropped(name, value, DROP_REASON.notCarried));
    return null;
  }
  const allowed = carried(destination, name);
  if (!allowed.length) {
    drops.push(dropped(name, value, DROP_REASON.notCarried));
    return null;
  }
  if (!allowed.includes(value)) {
    drops.push(dropped(name, value, DROP_REASON.notSupported));
    return null;
  }
  return value;
}

/**
 * Parse an address into a destination route.
 *
 * Never throws. Every failure is a status.
 */
export function parseDestinationRoute(input, registry = FINOPS_DESTINATIONS) {
  const destinations = Array.isArray(registry) ? registry : FINOPS_DESTINATIONS;
  const text = queryTextOf(input);
  if (text === null) return result(ROUTE_STATUS.malformed);
  const pairs = rawPairs(text);
  if (!pairs.has(DESTINATION_PARAM)) return result(ROUTE_STATUS.absent);

  const rawSlug = pairs.get(DESTINATION_PARAM);
  const slug = decode(rawSlug);
  if (slug === null) {
    return result(ROUTE_STATUS.malformed, { requestedSlug: clamp(rawSlug) });
  }
  if (slug === "" || !SLUG_PATTERN.test(slug)) {
    return result(ROUTE_STATUS.malformed, { requestedSlug: clamp(slug) });
  }

  const destination = destinations.find((entry) => entry?.slug === slug) ?? null;
  if (!destination) {
    // The qualifiers are reported dropped rather than silently discarded: a
    // reader whose bookmark carried `?destination=old-name&department=backend`
    // lost two things, and a log line that names one of them is half a story.
    const drops = ROUTE_PARAMS.slice(1)
      .filter((name) => pairs.has(name))
      .map((name) => dropped(name, decode(pairs.get(name)) ?? pairs.get(name),
        DROP_REASON.unresolvedDestination));
    return result(ROUTE_STATUS.unknown, {
      requestedSlug: clamp(slug),
      droppedParams: Object.freeze(drops),
    });
  }

  const drops = [];
  const scope = qualifier(pairs, SCOPE_PARAM, destination, drops);
  const department = qualifier(pairs, DEPARTMENT_PARAM, destination, drops);
  return result(ROUTE_STATUS.ok, {
    slug: destination.slug,
    requestedSlug: clamp(slug),
    scope,
    department,
    droppedParams: Object.freeze(drops),
  });
}

/**
 * The canonical query string for a route: `"?destination=…"`, or `""` for the
 * front door.
 *
 * A slug the registry does not hold serializes to the front door rather than to
 * an address nothing can open — the same rule the failure path applies, stated
 * once. Qualifiers the destination does not carry are omitted, so this is
 * idempotent over its own output and over `parseDestinationRoute`.
 */
export function serializeDestinationRoute(route, registry = FINOPS_DESTINATIONS) {
  const destinations = Array.isArray(registry) ? registry : FINOPS_DESTINATIONS;
  const destination = destinations.find((entry) => entry?.slug === route?.slug) ?? null;
  if (!destination) return FRONT_DOOR_QUERY;
  const parts = [`${DESTINATION_PARAM}=${encode(destination.slug)}`];
  for (const name of [SCOPE_PARAM, DEPARTMENT_PARAM]) {
    const value = route?.[name];
    if (value === null || value === undefined || value === "") continue;
    if (!carried(destination, name).includes(String(value))) continue;
    parts.push(`${name}=${encode(value)}`);
  }
  return `?${parts.join("&")}`;
}

/**
 * The whole canonical query for an address that may carry parameters belonging
 * to somebody else.
 *
 * Ours are rewritten from `route` and placed first; every foreign parameter is
 * carried through in its original raw bytes, in its original order. This is
 * what makes it safe to `replaceState` a normalized address on load: the reader
 * keeps whatever else was on their URL.
 */
export function canonicalQuery(search, route, registry = FINOPS_DESTINATIONS) {
  const ours = serializeDestinationRoute(route, registry);
  const foreign = [];
  for (const chunk of String(queryTextOf(search) ?? "").split("&")) {
    if (chunk === "") continue;
    const eq = chunk.indexOf("=");
    const name = decode(eq < 0 ? chunk : chunk.slice(0, eq));
    if (name === null || ROUTE_PARAMS.includes(name)) continue;
    foreign.push(chunk);
  }
  if (!foreign.length) return ours;
  return `?${[...(ours ? [ours.slice(1)] : []), ...foreign].join("&")}`;
}

/** True when this route names a destination the registry actually holds. */
export const isResolvedRoute = (route) => route?.status === ROUTE_STATUS.ok;

/**
 * The one sentence a reader gets when their address named a destination that is
 * not there. It states the slug they asked for and what happened to it, and it
 * is returned as TEXT — the caller must place it with `textContent`.
 */
export function routeFailureMessage(route) {
  if (!route || route.status === ROUTE_STATUS.ok || route.status === ROUTE_STATUS.absent) {
    return "";
  }
  const requested = route.requestedSlug;
  if (route.status === ROUTE_STATUS.unknown) {
    return `That link asked for a destination called “${requested}”. `
      + "It no longer exists, so this is the front door instead.";
  }
  return requested
    ? `That link asked for a destination called “${requested}”, which is not a `
      + "destination name. Showing the front door instead."
    : "That link did not name a destination this page can open. "
      + "Showing the front door instead.";
}
