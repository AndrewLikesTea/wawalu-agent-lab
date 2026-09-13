// Cloudflare Pages Function for POST /api/post-reports. Deliberately thin: the
// behaviour is src/post-reports-api.js, unit tested under `node --test`.
//
// Uses the social API's D1 binding and its rate-limit table, keyed apart from
// post writes, and the same one-way connection hash for browser writers.

import { createD1RateLimiter } from "../../src/social-posts-api.js";
import { hasStorage, humanPrincipal, requestIdFor, storageUnavailable } from "../../src/social-edge.js";
import { REPORT_RATE_LIMIT, createD1PostReportStore, handlePostReportRequest } from "../../src/post-reports-api.js";

export async function onRequest({ request, env }) {
  const requestId = requestIdFor(request);
  if (!hasStorage(env)) return storageUnavailable(requestId);
  return handlePostReportRequest(request, {
    requestId,
    store: createD1PostReportStore(env.DB),
    identify: humanPrincipal,
    rateLimit: createD1RateLimiter(env.DB, { limit: REPORT_RATE_LIMIT }),
  });
}
