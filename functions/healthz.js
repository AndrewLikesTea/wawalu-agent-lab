// Root health probe for the posting APIs' runtime bindings. The static build
// also contains a healthz sentinel; Pages Functions takes precedence when
// deployed and verifies that the D1 binding can answer a read.
//
// Fail-closed applies to storage only. Auth configuration is reported as an
// observable sub-status and never turns the probe red: `/healthz` gates
// production rollout and rollback smoke tests, so coupling it to a rotatable
// secret would let a token rotation fail a deploy or block the rollback of an
// unrelated change. See docs/auth-storage-bindings.md.
import { inspectBindings, publicBindingStatus } from "../src/bindings.js";
import { createD1Store, handlePostsHealth } from "../src/posts.js";

function requestIdFor(request) {
  return request.headers.get("cf-ray") ?? globalThis.crypto?.randomUUID?.() ?? String(Date.now());
}

export async function onRequest({ request, env }) {
  const requestId = requestIdFor(request);
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { allow: "GET", "cache-control": "no-store", "x-request-id": requestId } });
  }
  const report = inspectBindings(env);
  // Principal counts go to operator logs, not to the anonymous response body.
  console.info("binding_health", { requestId, storage: report.storage, auth: report.auth, missing: report.missing });

  if (report.storage !== "configured") {
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
  return handlePostsHealth(createD1Store(env.DB), requestId, publicBindingStatus(report));
}
