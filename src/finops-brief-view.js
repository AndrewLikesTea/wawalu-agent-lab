// The destination the sender was reading, carried inside the shared brief (#1330).
//
// #1325 gave /evolution.html three named destinations and #1326 made each an
// ADDRESS. A shared brief pointed at none of them: it landed a colleague at the
// front door, and the place the sender was actually reading travelled as a
// sentence in a chat message. This block is that pointer.
//
// NOT A SECOND PAYLOAD FORMAT. One envelope, `finops-brief-envelope.js`, and
// this is an OPTIONAL block on it: `view`. It follows `finops-brief-plan.js`
// (#1291) rule for rule, including the one that matters most — the envelope's
// schema version does NOT move for it.
//
// THE SCHEMA.
//
//   view.v         integer, required. THIS BLOCK's own version marker, 1.
//                  Compared, never parsed as prose.
//   view.slug      string, required. A destination slug from the registry in
//                  `finops-destinations.js` — the same strings `?destination=`
//                  carries, so one vocabulary names a place in a URL and in a
//                  brief. Kebab-case, validated by the #1326 parser, not here.
//   view.question  string, required. The destination's OWN stated question as
//                  the sender's build worded it, clamped to
//                  MAX_BRIEF_VIEW_QUESTION_LENGTH. It travels rather than being
//                  looked up on the reader's side: a question the registry has
//                  since reworded is still the one the sender was answering.
//   view.scope     string or null, required to be present. The reporting window
//                  in effect when the brief was written — `FINOPS_SCOPES`, the
//                  SAME representation `?scope=` uses and the registry declares
//                  per destination. No second scope shape is coined here, and
//                  it is deliberately NOT `plan.moves[].scope`, which is the
//                  planning surface's lever state wearing the same word. Null
//                  means no stated window, which is a fact and not a gap.
//
// WHAT DELIBERATELY DOES NOT TRAVEL: everything else. No credential, no prompt
// text, no customer or workload name, no URL of the sender's own, and not the
// department they had pressed — `?department=` addresses a slice of somebody's
// org chart, and a brief is a file that gets forwarded. Four fields are built by
// name and nothing is spread; the key-set assertion in
// tests/finops-shared-briefing-link.test.js holds the whole envelope to that.
//
// VERSION SEMANTICS, FORWARD AND BACKWARD. The envelope's own marker is `v`
// (`BRIEF_ENVELOPE_SCHEMA`) and it already exists; this change adds no second
// one, because two version numbers on one payload is how two readers end up
// disagreeing about which is authoritative.
//
//   NO `view` KEY — every brief written before this block, on any schema this
//   build reads. Decodes clean, `envelope.view` is null, and the recipient
//   lands on the front door exactly as before #1330. Never a refusal.
//   `view.v` UNRECOGNISED (older or newer) — refused as a BLOCK, by name, never
//   thrown and never refusing the brief around it: the reader gets the analysis
//   and the front door plus the sentence `BRIEF_VIEW_COPY` supplies. Degrading
//   to the front door is always honest; guessing at a field shape is not.
//   AN UNRECOGNISED ENVELOPE `v` — the envelope contract's call, not this one's.
//   It refuses by name, no view is read, nothing throws, front door.
//
// A later schema that makes `view` REQUIRED must add it to `requiredFieldsFor`
// and bump `BRIEF_ENVELOPE_SCHEMA`. Until then optional is the contract, and an
// older deployed build opening a newer brief is correct rather than broken.
//
// THE DEPENDENCY. This module holds no slug list, no scope list and no idea
// which qualifiers a destination carries: `parseDestinationRoute` in
// `src/destination-route.js` (#1326) answers all three, on the way OUT and on
// the way IN, so a slug a brief can carry is exactly a slug a URL can open. It
// never throws and reports a retired destination as `unknown`, which is what
// makes the stale case a sentence instead of an exception.
//
// PURE. No DOM, no clock, no storage, no network, no randomness.

import {
  ROUTE_STATUS, parseDestinationRoute, serializeDestinationRoute,
} from "./destination-route.js";
import { FINOPS_DESTINATIONS } from "./finops-destinations.js";

/** The envelope key this block travels under. Optional on every schema. */
export const BRIEF_VIEW_FIELD = "view";

/** The block's own version. Bump when a field, unit or meaning changes. */
export const BRIEF_VIEW_SCHEMA = 1;

/** The block's required fields, in the order the contract states them above. */
export const BRIEF_VIEW_FIELDS = Object.freeze(["v", "slug", "question", "scope"]);

/**
 * The longest question a block may carry. A destination's own question is a
 * short interrogative sentence; this bounds what a recipient renders when the
 * text came from a build, or a hand, this one cannot see.
 */
export const MAX_BRIEF_VIEW_QUESTION_LENGTH = 160;

/** Every state this block can be in. A closed set; each renders its own copy. */
export const BRIEF_VIEW_REASON = Object.freeze({
  absent: "no_shared_destination",
  malformed: "view_block_malformed",
  stale: "destination_no_longer_exists",
});

/**
 * What each state says: what is true of the block, what it means here, and the
 * one thing the reader can do. `absent` is the ordinary fact that a sender
 * shared the front door. All three end at the front door, which is a whole page
 * rather than a fallback.
 */
export const BRIEF_VIEW_COPY = Object.freeze({
  [BRIEF_VIEW_REASON.absent]: Object.freeze({
    summary: "This brief points at no particular destination",
    statement: "It carries the sender's analysis and no destination: either they shared it from the "
      + "front door, or it was written before a brief could name where it came from.",
    remedy: "Nothing is missing from what you were sent. The three destinations below are the whole "
      + "workspace; start wherever the figure above sends you.",
  }),
  [BRIEF_VIEW_REASON.malformed]: Object.freeze({
    summary: "The destination in this brief could not be read",
    statement: "The brief names a destination in a shape this build does not read — a newer block "
      + "version, a missing field, or a slug that is not a destination name.",
    remedy: "The analysis above is unaffected and the front door below is the whole workspace. Ask "
      + "the sender which destination they were reading, or for a fresh link.",
  }),
  [BRIEF_VIEW_REASON.stale]: Object.freeze({
    summary: "The destination this brief points at is no longer available",
    statement: "The sender was reading a destination this build does not have: it has been renamed "
      + "or retired since they shared it.",
    remedy: "The analysis above is unaffected. This is the front door instead, and the destinations "
      + "below are the ones that exist now.",
  }),
});

const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** A non-empty string, or null. Never a number coerced, never an object stringified. */
const readText = (value) => (typeof value === "string" && value.trim() !== "" ? value : null);

/** One question, bounded. Truncation happens HERE so every consumer sees one string. */
const clampQuestion = (text) => (text.length > MAX_BRIEF_VIEW_QUESTION_LENGTH
  ? `${text.slice(0, MAX_BRIEF_VIEW_QUESTION_LENGTH - 1)}…`
  : text);

const refusal = (reason) => Object.freeze({
  ok: false,
  reason,
  block: null,
  view: null,
  notice: Object.freeze({ reason, ...BRIEF_VIEW_COPY[reason] }),
});

/**
 * The route a slug and a scope resolve to, through #1326's parser and nothing
 * else. Serialized first so the qualifier rules the REGISTRY states are applied
 * once, in the module that owns them: a scope a destination does not carry is
 * dropped here rather than written into a brief that cannot honour it.
 */
function routeFor(slug, scope, registry) {
  const query = serializeDestinationRoute({ slug, scope }, registry);
  return parseDestinationRoute(query === "" ? `?destination=${encodeURIComponent(String(slug ?? ""))}`
    : query, registry);
}

/**
 * Build the block for the destination a sender is currently reading.
 *
 * FIELD BY FIELD, never spread: the argument is live page state read off the
 * document, and a caller handing over a polluted object cannot get any of it
 * into the payload, because nothing here reads a key it does not name.
 *
 * @param state `{ slug, question, scope }` or null at the front door. The
 *   question is optional — the registry's own is used when none is stated.
 * @returns `{ ok, reason, block, notice }`, frozen. `ok: false` with reason
 *   `absent` is the ordinary "no destination" answer, and the envelope writes NO
 *   key for it: a brief with no destination and a brief whose destination would
 *   not resolve must not look different on the wire.
 */
export function buildBriefViewBlock(state, registry = FINOPS_DESTINATIONS) {
  const slug = readText(state?.slug);
  if (slug === null) return refusal(BRIEF_VIEW_REASON.absent);
  const route = routeFor(slug, readText(state?.scope), registry);
  // A slug this build cannot resolve is a defect on the SENDER's side, caught
  // here rather than shipped: writing it would put a stale pointer into a brief
  // the moment it was created.
  if (route.status !== ROUTE_STATUS.ok) return refusal(BRIEF_VIEW_REASON.malformed);
  const destination = registry.find((entry) => entry?.slug === route.slug) ?? null;
  const question = readText(state?.question) ?? readText(destination?.question);
  if (question === null) return refusal(BRIEF_VIEW_REASON.malformed);
  const block = {
    v: BRIEF_VIEW_SCHEMA,
    slug: route.slug,
    question: clampQuestion(question),
    scope: route.scope,
  };
  // Built and then read back through the READER's own validator rather than
  // trusted because this module wrote it.
  const read = readBriefViewBlock(block);
  if (!read.ok) return refusal(read.reason);
  return Object.freeze({ ok: true, reason: "pointed", block, notice: null });
}

/**
 * Read a supplied block, or refuse it by name.
 *
 * Untrusted input: every field is copied out by name onto a fresh object, so an
 * unknown key on a hostile brief reaches no renderer. Never throws.
 *
 * @returns `{ ok, reason, view, notice }`, frozen. `view` is null on every
 *   refusal, and a refusal here never refuses the brief around the block.
 */
export function readBriefViewBlock(value) {
  if (value === undefined || value === null) return refusal(BRIEF_VIEW_REASON.absent);
  if (!isPlainObject(value)) return refusal(BRIEF_VIEW_REASON.malformed);
  for (const field of BRIEF_VIEW_FIELDS) {
    if (!Object.hasOwn(value, field)) return refusal(BRIEF_VIEW_REASON.malformed);
  }
  // A block version this build does not know is refused as a BLOCK — the brief
  // still opens and the reader still gets the front door.
  if (value.v !== BRIEF_VIEW_SCHEMA) return refusal(BRIEF_VIEW_REASON.malformed);
  const slug = readText(value.slug);
  const question = readText(value.question);
  if (slug === null || question === null) return refusal(BRIEF_VIEW_REASON.malformed);
  const view = Object.freeze({
    v: BRIEF_VIEW_SCHEMA,
    slug,
    question: clampQuestion(question),
    // Read as stated, resolved later: whether this destination carries this
    // window is the registry's call and `resolveBriefView` asks it.
    scope: readText(value.scope),
  });
  return Object.freeze({ ok: true, reason: "pointed", view, notice: null });
}

/**
 * Resolve a read block against the destinations this build actually has.
 *
 * THE ONE FUNCTION A SURFACE CALLS. It answers "where does this brief point,
 * and can we open it" in a single record, so a caller cannot resolve the slug
 * and forget the stale case — the two come back together or not at all.
 *
 * @param view the projected block from `readBriefViewBlock`, or null.
 * @returns frozen `{ ok, reason, status, slug, name, question, scope, address,
 *   statement }`. `address` is the canonical query for the destination, or ""
 *   for the front door. `statement` is TEXT for a caller to place with
 *   `textContent` — it always names the destination the SENDER meant, including
 *   when that destination no longer exists.
 */
export function resolveBriefView(view, registry = FINOPS_DESTINATIONS) {
  const result = (fields) => Object.freeze({
    ok: false, status: ROUTE_STATUS.absent, slug: null, name: null,
    question: readText(view?.question), scope: null, address: "", ...fields,
  });
  if (!view) {
    return result({ reason: BRIEF_VIEW_REASON.absent, statement: "" });
  }
  const route = routeFor(view.slug, view.scope, registry);
  if (route.status !== ROUTE_STATUS.ok) {
    // The stale case, and it is a SENTENCE: it names the destination the sender
    // meant, in their own words, and says plainly that it is gone. The slug came
    // off somebody else's brief, so a caller must place this with `textContent`.
    const named = readText(view.slug) ?? "an unnamed destination";
    const asked = readText(view.question);
    return result({
      reason: BRIEF_VIEW_REASON.stale,
      status: route.status,
      statement: `The sender was reading a destination called “${named}”`
        + `${asked ? ` — “${asked}”` : ""}. It is no longer available on this page, so this is the `
        + "front door instead.",
    });
  }
  const destination = registry.find((entry) => entry?.slug === route.slug) ?? null;
  const question = readText(view.question) ?? readText(destination?.question) ?? "";
  const window = route.scope ? ` Read at the ${route.scope} window.` : "";
  return Object.freeze({
    ok: true,
    reason: "pointed",
    status: route.status,
    slug: route.slug,
    name: destination?.name ?? route.slug,
    question,
    scope: route.scope,
    address: serializeDestinationRoute(route, registry),
    statement: `This brief was written at ${destination?.name ?? route.slug}, which answers: `
      + `${question}${window}`,
  });
}
