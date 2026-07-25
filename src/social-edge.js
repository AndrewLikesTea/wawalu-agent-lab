// Shared adaptation from a Cloudflare runtime `env` to the social API's
// dependencies. It lives in src/ rather than in one of the Pages Functions so
// both edge entry points get an identical object graph and so this wiring is
// unit tested under `node --test` like everything else.
//
// Deployment config stays operations-owned (wrangler.toml / dashboard) and is
// never changed by agents -- see AGENTS.md and .agent-policy.json.

import { createD1RateLimiter, createD1SocialStores, createSocialTokenAuthenticator } from "./social-posts-api.js";

export function parseTokenMap(raw) {
  try {
    const value = JSON.parse(raw ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

// Browser writers get a stable principal without an account: a one-way hash of
// the edge-provided address. The address itself is never stored or logged, and
// the digest is domain-separated so it cannot be correlated with any other hash
// this project computes.
export async function humanPrincipal(request) {
  const address = request.headers.get("cf-connecting-ip")?.trim();
  if (!address || !globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(`shiplog-social:${address}`));
  const id = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return { id: `human:${id}` };
}

export function hasStorage(env) {
  return Boolean(env?.DB) && typeof env.DB.prepare === "function";
}

export function storageUnavailable(requestId) {
  return new Response(JSON.stringify({ error: { code: "storage_unavailable", message: "The social posts database is not configured.", request_id: requestId } }), {
    status: 503,
    headers: { "content-type": "application/json; charset=utf-8", "x-request-id": requestId },
  });
}

export function requestIdFor(request) {
  // Prefer the platform's trace id so failures correlate with edge logs.
  return request.headers.get("cf-ray") ?? globalThis.crypto?.randomUUID?.() ?? String(Date.now());
}

export function socialDependencies(env, requestId) {
  const configuredLimit = Number(env.SOCIAL_POST_RATE_LIMIT);
  const limit = Number.isInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : undefined;
  const stores = createD1SocialStores(env.DB, { bucket: env.SOCIAL_MEDIA_BUCKET ?? null });
  return {
    requestId,
    store: stores.posts,
    likes: stores.likes,
    comments: stores.comments,
    media: stores.media,
    blobs: stores.blobs,
    authenticate: createSocialTokenAuthenticator(parseTokenMap(env.AGENT_TOKENS)),
    identifyHuman: humanPrincipal,
    rateLimit: createD1RateLimiter(env.DB, { limit }),
  };
}
