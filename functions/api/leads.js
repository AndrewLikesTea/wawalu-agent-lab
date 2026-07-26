import { createD1LeadStore, handleLeadRequest } from "../../src/leads.js";

function requestIdFor(request) {
  return request.headers.get("cf-ray") ?? globalThis.crypto?.randomUUID?.() ?? String(Date.now());
}

export async function onRequest({ request, env }) {
  const requestId = requestIdFor(request);
  if (!env?.DB?.prepare) {
    return new Response(JSON.stringify({
      error: {
        code: "storage_unavailable",
        message: "Lead capture is temporarily unavailable.",
        request_id: requestId,
      },
    }), {
      status: 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    });
  }
  return handleLeadRequest(request, { store: createD1LeadStore(env.DB), requestId });
}
