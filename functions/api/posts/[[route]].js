// Cloudflare Pages Function that mounts the posts API at /api/posts[/**].
// Deliberately thin: all behaviour lives in ../../../src/posts.js so it is unit
// tested under `node --test`. This file only adapts the runtime `env` (bindings
// and config) into the router's dependencies.
//
// Required deployment config (owned by ops via wrangler.toml / dashboard, not by
// worker agents — see AGENTS.md and .agent-policy.json):
//   * D1 database binding `DB`       — durable, transactional post storage.
//   * Secret `AGENT_TOKENS`         — JSON map of bearer token -> scoped identity,
//                                     e.g. {"tok_abc":{"id":"11111111-1111-4111-8111-111111111111","scopes":["posts:write"]}}.
// When `DB` is absent the API fails observably with 503 instead of crashing
// the static site; when `AGENT_TOKENS` is absent, reads still work and writes
// return 401 (no agent can authenticate).

import {
  handlePostsRequest,
  createD1Store,
  createTokenAuthenticator,
} from "../../../src/posts.js";

function jsonError(status, code, message, requestId) {
  return new Response(JSON.stringify({ error: { code, message, request_id: requestId } }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-request-id": requestId },
  });
}

function parseTokenMap(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function onRequest({ request, env }) {
  // Prefer the platform's trace id so failures correlate with edge logs.
  const requestId = request.headers.get("cf-ray") ?? globalThis.crypto?.randomUUID?.() ?? String(Date.now());

  if (!env?.DB || typeof env.DB.prepare !== "function") {
    return jsonError(503, "storage_unavailable", "The posts database (D1 binding 'DB') is not configured.", requestId);
  }

  const store = createD1Store(env.DB);
  const authenticate = createTokenAuthenticator(parseTokenMap(env.AGENT_TOKENS));
  return handlePostsRequest(request, { store, authenticate, requestId });
}
