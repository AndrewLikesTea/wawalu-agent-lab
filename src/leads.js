export const MAX_EMAIL_LENGTH = 254;
export const LEAD_PURPOSES = Object.freeze(["field_notes", "follow_up"]);

/**
 * Why a visitor asked for a follow-up, in the endpoint's own words.
 *
 * This is one half of a two-halved contract: the other half is
 * `FOLLOW_UP_REASONS` in src/site-footer.js, which is what the footer's radio
 * group is rendered from. tests/leads.test.js pins the two vocabularies to the
 * same values in the same order, because a form that offers a choice the
 * endpoint rejects loses the visitor at the last step, and an endpoint that
 * accepts a value no form can produce is storing something nobody chose.
 *
 * The field is optional on the wire: the field-note sign-up and the two
 * follow-up forms that do not ask why (the AI FinOps result's and the executive
 * briefing's) send no reason at all. What is not optional is its value — a
 * reason that is present and not one of these is refused, here, on the server,
 * whatever the browser did or did not check first.
 */
export const LEAD_REASONS = Object.freeze(["own_spend", "demo_question", "something_else"]);

// Everything the documented request shape allows, and nothing else. A body
// carrying a fourth key is a caller this endpoint does not know about.
const LEAD_FIELDS = Object.freeze(["email", "purpose", "reason"]);
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

// `reason` is the last argument on both stores so the calls that predate it —
// and the tests that make them — still say what they said.
export function createMemoryLeadStore() {
  const submissions = new Map();
  return {
    async capture(email, purpose, createdAt = null, reason = null) {
      const key = `${purpose}:${email}`;
      const created = !submissions.has(key);
      if (created) submissions.set(key, { email, purpose, reason, createdAt });
      return created;
    },
    has: (email, purpose = "field_notes") => submissions.has(`${purpose}:${email}`),
    // What was recorded beside the address, for a test that has to prove the
    // reason reached storage rather than stopping at the wire.
    reasonFor: (email, purpose = "follow_up") => submissions.get(`${purpose}:${email}`)?.reason ?? null,
  };
}

export function createD1LeadStore(db) {
  return {
    async capture(email, purpose, createdAt, reason = null) {
      const result = await db.prepare(
        "INSERT OR IGNORE INTO lead_submissions (email, purpose, reason, created_at) VALUES (?, ?, ?, ?)",
      ).bind(email, purpose, reason, createdAt).run();
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
  const shaped = isObject && keys.includes("email") && keys.includes("purpose")
    && keys.every((key) => LEAD_FIELDS.includes(key));
  if (!shaped) {
    return json({ error: { code: "invalid_request", message: "Body must contain email and purpose, and may contain reason.", request_id: requestId } }, 400, requestId);
  }
  const email = normalizeEmail(input.email);
  if (!email) {
    return json({ error: { code: "invalid_email", message: "Enter a valid email address.", request_id: requestId } }, 422, requestId);
  }
  if (!LEAD_PURPOSES.includes(input.purpose)) {
    return json({ error: { code: "invalid_purpose", message: "Purpose must be field_notes or follow_up.", request_id: requestId } }, 422, requestId);
  }
  // A reason that was sent has to be one this endpoint knows. Empty, null, and
  // invented values are all refused here rather than trusted from the browser:
  // the form's required-choice gate is a courtesy to the visitor, not the
  // guarantee that only a documented reason is ever recorded.
  const hasReason = Object.hasOwn(input, "reason");
  if (hasReason && !LEAD_REASONS.includes(input.reason)) {
    return json({ error: { code: "invalid_reason", message: `Reason must be one of ${LEAD_REASONS.join(", ")}.`, request_id: requestId } }, 422, requestId);
  }
  const reason = hasReason ? input.reason : null;

  try {
    const created = await store.capture(email, input.purpose, now(), reason);
    return json({ captured: true, created, purpose: input.purpose }, created ? 201 : 200, requestId);
  } catch {
    // Correlatable in platform logs without copying a driver message that may
    // contain connection or schema detail into the event.
    console.error("lead_capture_storage_error", { requestId, purpose: input.purpose });
    return json({ error: { code: "storage_error", message: "We couldn’t save your email. Please try again.", request_id: requestId } }, 500, requestId);
  }
}
