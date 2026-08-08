import { createD1FollowUpStore, handleFollowUpRequest } from "../../src/follow-ups.js";

export async function onRequest({ request, env }) {
  const requestId = request.headers.get("cf-ray") ?? globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  if (!env?.DB?.prepare) {
    return new Response(JSON.stringify({ error: { code: "storage_unavailable", request_id: requestId } }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-request-id": requestId },
    });
  }
  return handleFollowUpRequest(request, { store: createD1FollowUpStore(env.DB), requestId });
}
