// Root health probe for the posting APIs' runtime bindings. The static build
// also contains a healthz sentinel; Pages Functions takes precedence when
// deployed and verifies that the D1 binding can answer a read.
//
// Fail-closed applies to storage only. Auth configuration is reported as an
// observable sub-status and never turns the probe red: `/healthz` gates
// production rollout and rollback smoke tests, so coupling it to a rotatable
// secret would let a token rotation fail a deploy or block the rollback of an
// unrelated change. See docs/auth-storage-bindings.md.
//
// It also answers the second question an on-call operator asks after "is it
// up": is the build serving this traffic the one the release log says shipped?
// The comparison is not made here — src/release-build-match.js owns it, and
// src/releases-page.js renders the same result object — so the page and the
// probe cannot disagree. Both of its inputs are compiled in (the generated
// build stamp and the shipped release records), so this costs no binding, no
// storage read, and no network call, and every failure mode of that comparison
// degrades to `verdict: "unknown"` with a reason rather than to a status code.
import { inspectBindings, publicBindingStatus } from "../src/bindings.js";
import { createD1Store, handlePostsHealth } from "../src/posts.js";
import { BUILD_STAMP } from "../src/build-stamp.js";
import { releaseBuildStatus } from "../src/release-build-match.js";
import { SEED_RELEASES } from "../src/seed-records.js";

function requestIdFor(request) {
  return request.headers.get("cf-ray") ?? globalThis.crypto?.randomUUID?.() ?? String(Date.now());
}

/**
 * The verdict fields, computed so that nothing they touch can produce a 500.
 *
 * `releaseBuildStatus` is documented never to throw, and this is the belt to
 * that braces: if the stamp module or the release records were ever replaced by
 * something unreadable, the probe still answers 200 with an `unknown` verdict
 * naming the failure. A rollout and a rollback both smoke-test this endpoint —
 * it does not get to be the thing that fails them.
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
      reason: `The build stamp or the release log could not be read: ${error?.message ?? String(error)}`,
    };
  }
  // `verdict` first: it is the one word the operator came for, and the fields
  // behind it are the evidence for that word.
  return {
    verdict: result.verdict,
    build_sha: result.buildSha,
    built_at: result.builtAt,
    release_sha: result.releaseSha,
    release_id: result.releaseId,
    ...(result.action ? { action: result.action } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
  };
}

// `overrides` is never passed by Pages, which calls onRequest with one argument.
// It exists so a test can drive every verdict through this handler with a
// committed fixture instead of against whatever commit happens to be checked
// out — the four cases have to be provable, not observable once a year.
export async function onRequest({ request, env }, injected = null) {
  const overrides = injected ?? {};
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
  const release = releaseBuildFields(
    "stamp" in overrides ? overrides.stamp : BUILD_STAMP,
    "releases" in overrides ? overrides.releases : SEED_RELEASES,
  );
  console.info("release_build_match", { requestId, ...release });
  // The verdict rides ahead of the binding statuses so it is the first thing
  // after the liveness pair in the printed body — the word the operator opened
  // the probe for, before the evidence behind it.
  return handlePostsHealth(createD1Store(env.DB), requestId, { ...release, ...publicBindingStatus(report) });
}
