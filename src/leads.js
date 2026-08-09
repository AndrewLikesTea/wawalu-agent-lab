export const MAX_EMAIL_LENGTH = 254;
export const FOLLOW_UP_REQUEST_TYPES = Object.freeze([
  "follow_up_coach",
  "follow_up_releases",
  "follow_up_social",
  "follow_up_people",
  "follow_up_agents",
]);
export const LEAD_PURPOSES = Object.freeze(["field_notes", "follow_up", ...FOLLOW_UP_REQUEST_TYPES]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const submissions = new Set();
  return {
    async capture(email, purpose) {
      const key = `${purpose}:${email}`;
      const created = !submissions.has(key);
      submissions.add(key);
      return created;
    },
    has: (email, purpose = "field_notes") => submissions.has(`${purpose}:${email}`),
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
    async capture(email, purpose, createdAt) {
      const result = await db.prepare(
        "INSERT INTO lead_submissions (email, purpose, created_at) VALUES (?, ?, ?)"
        + " ON CONFLICT (email, purpose) DO NOTHING",
      ).bind(email, purpose, createdAt).run();
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
  if (!isObject || keys.length !== 2 || !keys.includes("email") || !keys.includes("purpose")) {
    return json({ error: { code: "invalid_request", message: "Body must contain only email and purpose.", request_id: requestId } }, 400, requestId);
  }
  const email = normalizeEmail(input.email);
  if (!email) {
    return json({ error: { code: "invalid_email", message: "Enter a valid email address.", request_id: requestId } }, 422, requestId);
  }
  if (!LEAD_PURPOSES.includes(input.purpose)) {
    return json({ error: { code: "invalid_purpose", message: "Purpose is not a supported request type.", request_id: requestId } }, 422, requestId);
  }

  try {
    const created = await store.capture(email, input.purpose, now());
    return json({ captured: true, created, purpose: input.purpose }, created ? 201 : 200, requestId);
  } catch {
    // Correlatable in platform logs without copying a driver message that may
    // contain connection or schema detail into the event.
    console.error("lead_capture_storage_error", { requestId, purpose: input.purpose });
    return json({ error: { code: "storage_error", message: "We couldn’t save your email. Please try again.", request_id: requestId } }, 500, requestId);
  }
}
