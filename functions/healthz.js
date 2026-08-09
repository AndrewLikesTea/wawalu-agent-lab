// Root release probe. It deliberately reads no binding, customer data, or
// external service: rollout and rollback must be able to distinguish the
// artifact even while every optional runtime dependency is unavailable.
// Storage has its own fail-closed probe at `/api/posts/healthz`.
import { BUILD_STAMP } from "../src/build-stamp.js";
import { healthContract } from "../src/health-contract.js";
import { UNKNOWN_REASONS, releaseBuildStatus } from "../src/release-build-match.js";
import { SEED_RELEASES } from "../src/seed-records.js";

function requestIdFor(request) {
  return request.headers.get("cf-ray") ?? globalThis.crypto?.randomUUID?.() ?? String(Date.now());
}

/**
 * The build-versus-log fields, computed so that nothing they touch can 500.
 *
 * `releaseBuildStatus` is documented never to throw; this is the belt to that
 * braces. If the stamp module or the release records were ever replaced by
 * something unreadable, the probe still answers 200 with an `unknown` verdict
 * that names the failure. A rollout and a rollback both smoke-test this
 * endpoint — it does not get to be the thing that fails them.
 *
 * Snake case on the wire, to match the request id and the error codes the rest
 * of this API already answers with.
 */
export function releaseBuildFields(stamp = BUILD_STAMP, releases = SEED_RELEASES) {
  let result;
  try {
    result = releaseBuildStatus(stamp, releases);
  } catch (error) {
    result = {
      verdict: "unknown",
      buildSha: null,
      builtAt: null,
      releaseSha: null,
      releaseId: null,
      reason: UNKNOWN_REASONS.noBuildStamp,
      reasonText: `The build stamp or the release log could not be read: ${error?.message ?? String(error)}`,
    };
  }
  // `verdict` leads: it is the one word the operator came for, and the fields
  // behind it are the evidence for that word. `action` appears on exactly one
  // verdict — mismatched — and is absent, not empty, on every other.
  return {
    verdict: result.verdict,
    build_sha: result.buildSha,
    built_at: result.builtAt,
    release_sha: result.releaseSha,
    release_id: result.releaseId,
    ...(result.action ? { action: result.action } : {}),
    ...(result.reason ? { reason: result.reason, reason_detail: result.reasonText } : {}),
  };
}

export async function onRequest({ request }) {
  const requestId = requestIdFor(request);
  if (request.method !== "GET") {
    return new Response(null, { status: 405, headers: { allow: "GET", "cache-control": "no-store", "x-request-id": requestId } });
  }
  return new Response(JSON.stringify(healthContract(BUILD_STAMP)), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}
