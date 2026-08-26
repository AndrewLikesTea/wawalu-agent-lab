import { MAX_FOLLOW_UP_MESSAGE_LENGTH } from "./lead-capture.js";
import { OBSERVATORY_DESCRIPTION } from "./surface-copy.js";

export { MAX_FOLLOW_UP_MESSAGE_LENGTH };
export const MAX_EMAIL_LENGTH = 254;
/**
 * The request types whose form offers a free-text message, and therefore the
 * only ones a `message` key may arrive on.
 *
 * It is a list rather than a flag on every follow-up type because the other
 * forms do not ship the field: a `message` sent for one of them is a key the
 * page cannot have produced, and the strict body check below refuses it rather
 * than storing text no surface invited.
 */
export const FOLLOW_UP_MESSAGE_PURPOSES = Object.freeze(["follow_up_finops_example"]);
export const FOLLOW_UP_REQUEST_TYPES = Object.freeze([
  "follow_up_homepage",
  "follow_up_finops_example",
  "follow_up_coach",
  "follow_up_releases",
  "follow_up_social",
  "follow_up_people",
  "follow_up_agents",
]);
export const LEAD_PURPOSES = Object.freeze(["field_notes", "follow_up", ...FOLLOW_UP_REQUEST_TYPES]);
// Each entry is the page's name and the words the site already uses for that
// destination — the description DEMOS in src/site-footer.js gives it, copied
// rather than rewritten. A topic invented here would be a seventh description of
// a surface the footer, the home page, and the navigation already describe, and
// a visitor comparing the follow-up block against the footer above it would find
// two accounts of the same page.
export const FOLLOW_UP_TOPICS = Object.freeze({
  follow_up_homepage: "Homepage — record a decision and explore Shiplog",
  follow_up_finops_example: "Bundled AI FinOps example — lower-cost routing in Atlas Platform",
  follow_up_coach: "Prompt coach page — grade a prompt, then revise and grade again",
  // Releases sent this request type with no topic entry, so the request reached
  // the row with an empty topic column and the page had nothing true to name.
  // The purpose was already in the migration 0009 CHECK; only the topic was
  // missing, and a topic is a free column (migration 0010), so naming it here
  // costs no schema change. The words are the site's own for this surface —
  // DEMOS in src/site-footer.js describes Releases the same way.
  follow_up_releases: "Releases page — every release and the decisions it carried",
  follow_up_social: "Social page — read short posts about what the team ships, images optional",
  follow_up_people: "People page — pick a display name, see its image posts, newest first",
  // The one entry built from a shared constant rather than retyped. The
  // observatory's follow-up block states its subject in prose directly above the
  // work-email field, on a page that also renders the footer directory — so the
  // visitor can read both descriptions of the same page in one glance, and two
  // hand-kept copies would be visibly different rather than merely stale. The
  // rest are still copies of the DEMOS wording; nothing pins them, and a check
  // cannot be written for all of them because Homepage and the bundled FinOps
  // example are not directory rows.
  follow_up_agents: `Agent observatory page — ${OBSERVATORY_DESCRIPTION}`,
});
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The optional message, held to the number the field beside it prints.
 *
 * Absent, null, or blank is `{ message: null }` — an optional field left empty
 * is not a refusal, and the row simply carries no message. Anything that is not
 * a string, or a string past the limit, is `{ invalid: true }`: the endpoint
 * must not accept what the form forbids, and must not silently truncate either,
 * because a stored half-question is worse than a refused one.
 */
export function normalizeFollowUpMessage(value) {
  if (value === undefined || value === null) return { message: null };
  if (typeof value !== "string") return { invalid: true };
  const message = value.trim();
  if (!message) return { message: null };
  if (message.length > MAX_FOLLOW_UP_MESSAGE_LENGTH) return { invalid: true };
  return { message };
}

export function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLocaleLowerCase("en-US");
  if (!email || email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) return null;
  return email;
}

function json(body, status, requestId, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-request-id": requestId,
      ...headers,
    },
  });
}

export function createMemoryLeadStore() {
  const submissions = new Map();
  return {
    async capture(email, purpose, createdAt = null, topic = null, message = null) {
      const key = `${purpose}:${email}`;
      const created = !submissions.has(key);
      if (created) submissions.set(key, { topic, message });
      return created;
    },
    has: (email, purpose = "field_notes") => submissions.has(`${purpose}:${email}`),
    // What was stored, not merely that something was: a test that can only ask
    // "is this address here?" cannot tell a carried message from a dropped one.
    read: (email, purpose = "field_notes") => submissions.get(`${purpose}:${email}`) ?? null,
  };
}

/**
 * `ON CONFLICT DO NOTHING`, not `INSERT OR IGNORE`.
 *
 * The two look interchangeable and are not. `OR IGNORE` ignores every
 * constraint failure on the row, including a CHECK violation, and still reports
 * `changes = 0` — the same answer a genuine duplicate gives. So a purpose the
 * deployed table does not accept is dropped on the floor and handed back to the
 * browser as `created: false`, which every follow-up form renders as "that
 * address is already on our list". Nothing was written, and no caller can tell.
 *
 * That is not hypothetical: migration 0008 widened the purpose CHECK to the five
 * bounded `follow_up_<surface>` request types, and nothing in this repository
 * applies migrations — no workflow, no build step. Until an operator runs them,
 * every page that sends one of those types writes no row and claims capture.
 *
 * The `ON CONFLICT (email, purpose)` form ignores exactly the primary-key
 * conflict it means to ignore. Anything else raises, and `handleLeadRequest`
 * turns it into a truthful `storage_error` the visitor can act on.
 */
export function createD1LeadStore(db) {
  return {
    async capture(email, purpose, createdAt, topic = null, message = null) {
      const result = await db.prepare(
        "INSERT INTO lead_submissions (email, purpose, created_at, topic, message) VALUES (?, ?, ?, ?, ?)"
        + " ON CONFLICT (email, purpose) DO NOTHING",
      ).bind(email, purpose, createdAt, topic, message).run();
      return Number(result.meta?.changes ?? 0) > 0;
    },
  };
}

export async function handleLeadRequest(request, {
  store,
  requestId = globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
  now = () => new Date().toISOString(),
} = {}) {
  if (request.method !== "POST") {
    return json({ error: { code: "method_not_allowed", message: "Method not allowed.", request_id: requestId } }, 405, requestId, { allow: "POST" });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: { code: "unsupported_media_type", message: "Content-Type must be application/json.", request_id: requestId } }, 415, requestId);
  }

  let input;
  try {
    input = await request.json();
  } catch {
    return json({ error: { code: "invalid_json", message: "Request body must be valid JSON.", request_id: requestId } }, 400, requestId);
  }
  const isObject = input !== null && typeof input === "object" && !Array.isArray(input);
  const keys = isObject ? Object.keys(input) : [];
  const expectedTopic = isObject ? FOLLOW_UP_TOPICS[input.purpose] : null;
  const expectedKeys = expectedTopic ? ["email", "purpose", "topic"] : ["email", "purpose"];
  // `message` is the one key that may be present or absent, and only on a
  // purpose whose form offers the field. Everything else is still exact.
  const allowedKeys = isObject && FOLLOW_UP_MESSAGE_PURPOSES.includes(input.purpose)
    ? [...expectedKeys, "message"]
    : expectedKeys;
  if (!isObject || !keys.every((key) => allowedKeys.includes(key)) || !expectedKeys.every((key) => keys.includes(key))) {
    return json({ error: { code: "invalid_request", message: "Body contains unsupported or missing fields.", request_id: requestId } }, 400, requestId);
  }
  const email = normalizeEmail(input.email);
  if (!email) {
    return json({ error: { code: "invalid_email", message: "Enter a valid email address.", request_id: requestId } }, 422, requestId);
  }
  if (!LEAD_PURPOSES.includes(input.purpose)) {
    return json({ error: { code: "invalid_purpose", message: "Purpose is not a supported request type.", request_id: requestId } }, 422, requestId);
  }
  if (expectedTopic && input.topic !== expectedTopic) {
    return json({ error: { code: "invalid_topic", message: "Topic does not match the request type.", request_id: requestId } }, 422, requestId);
  }
  const { message, invalid: unusableMessage } = normalizeFollowUpMessage(input.message);
  if (unusableMessage) {
    return json({ error: { code: "invalid_message", message: `Your message must be ${MAX_FOLLOW_UP_MESSAGE_LENGTH} characters or fewer.`, request_id: requestId } }, 422, requestId);
  }

  try {
    const created = await store.capture(email, input.purpose, now(), expectedTopic ?? null, message ?? null);
    return json({ captured: true, created, purpose: input.purpose }, created ? 201 : 200, requestId);
  } catch {
    // Correlatable in platform logs without copying a driver message that may
    // contain connection or schema detail into the event.
    console.error("lead_capture_storage_error", { requestId, purpose: input.purpose });
    return json({ error: { code: "storage_error", message: "We couldn’t save your email. Please try again.", request_id: requestId } }, 500, requestId);
  }
}
