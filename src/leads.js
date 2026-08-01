export const MAX_EMAIL_LENGTH = 254;
export const LEAD_PURPOSES = Object.freeze(["field_notes", "follow_up"]);
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

export function createD1LeadStore(db) {
  return {
    async capture(email, purpose, createdAt) {
      const result = await db.prepare(
        "INSERT OR IGNORE INTO lead_submissions (email, purpose, created_at) VALUES (?, ?, ?)",
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
    return json({ error: { code: "invalid_purpose", message: "Purpose must be field_notes or follow_up.", request_id: requestId } }, 422, requestId);
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
