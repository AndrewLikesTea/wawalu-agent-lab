// Root health probe for the Posts API's required durable dependency. The static
// build also contains a healthz sentinel; Pages Functions takes precedence when
// deployed and verifies that the D1 binding can answer a read.
import { createD1Store, handlePostsHealth } from "../src/posts.js";

function requestIdFor(request) {
  return request.headers.get("cf-ray") ?? globalThis.crypto?.randomUUID?.() ?? String(Date.now());
}

export async function onRequest({ request, env }) {
  const requestId = requestIdFor(request);
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { allow: "GET", "cache-control": "no-store", "x-request-id": requestId } });
  }
  if (!env?.DB || typeof env.DB.prepare !== "function") {
    return new Response(JSON.stringify({
      error: {
        code: "storage_unavailable",
        message: "The posts database (D1 binding 'DB') is not configured.",
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
  return handlePostsHealth(createD1Store(env.DB), requestId);
}
