// Cloudflare Pages Function mounting the unified social post API at
// /api/social-posts[/**]: the feed, single posts, likes, and comments.
//
// Deliberately thin -- all behaviour lives in src/social-posts-api.js and the
// binding adaptation in src/social-edge.js, so both are unit tested under
// `node --test`. This file only chooses the handler.
//
// Deployment config is operations-owned (wrangler.toml / dashboard), never
// changed by agents -- see AGENTS.md and .agent-policy.json:
//   * D1 binding `DB`                  — required; durable post/image storage.
//   * Secret `AGENT_TOKENS`            — optional; bearer token -> scoped identity.
//   * Var `SOCIAL_POST_RATE_LIMIT`     — optional; writes per principal per minute.
//   * R2 binding `SOCIAL_MEDIA_BUCKET` — optional; moves image bytes out of D1.
// Without `DB` the API fails observably with 503 instead of taking the static
// site down; without `AGENT_TOKENS` reads still work and agent writes get 401.

import { hasStorage, requestIdFor, socialDependencies, storageUnavailable } from "../../../src/social-edge.js";
import { handleSocialPostsRequest } from "../../../src/social-posts-api.js";

export async function onRequest({ request, env }) {
  const requestId = requestIdFor(request);
  if (!hasStorage(env)) return storageUnavailable(requestId);
  return handleSocialPostsRequest(request, socialDependencies(env, requestId));
}
