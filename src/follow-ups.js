import { normalizeEmail } from "./leads.js";

export const MAX_INTEREST_LENGTH = 500;

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

export function normalizeInterest(value) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const interest = value.trim();
  if (!interest) return null;
  return interest.length <= MAX_INTEREST_LENGTH ? interest : undefined;
}

export function createMemoryFollowUpStore() {
  const submissions = [];
  return {
    async capture(email, interest) {
      submissions.push({ email, interest });
      return true;
    },
    submissions,
  };
}

export function createD1FollowUpStore(db) {
  return {
    async capture(email, interest) {
      const result = await db.prepare(
        "INSERT INTO follow_up_submissions (email, interest) VALUES (?, ?)",
      ).bind(email, interest).run();
      return Number(result.meta?.changes ?? 0) > 0;
    },
  };
}

export async function handleFollowUpRequest(request, {
  store,
  requestId = globalThis.crypto?.randomUUID?.() ?? String(Date.now()),
} = {}) {
  if (request.method !== "POST") {
    return json({ error: { code: "method_not_allowed", request_id: requestId } }, 405, requestId, { allow: "POST" });
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return json({ error: { code: "unsupported_media_type", request_id: requestId } }, 415, requestId);
  }
  let input;
  try { input = await request.json(); } catch {
    return json({ error: { code: "invalid_json", request_id: requestId } }, 400, requestId);
  }
  const isObject = input !== null && typeof input === "object" && !Array.isArray(input);
  const keys = isObject ? Object.keys(input) : [];
  if (!isObject || !keys.includes("email") || keys.some((key) => !["email", "interest"].includes(key))) {
    return json({ error: { code: "invalid_request", request_id: requestId } }, 400, requestId);
  }
  const email = normalizeEmail(input.email);
  if (!email) return json({ error: { code: "invalid_email", request_id: requestId } }, 422, requestId);
  const interest = normalizeInterest(input.interest);
  if (interest === undefined) {
    return json({ error: { code: "invalid_interest", request_id: requestId } }, 422, requestId);
  }
  try {
    await store.capture(email, interest);
    return json({ captured: true }, 201, requestId);
  } catch {
    console.error("follow_up_storage_error", { requestId });
    return json({ error: { code: "storage_error", request_id: requestId } }, 500, requestId);
  }
}
