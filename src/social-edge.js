// Shared adaptation from a Cloudflare runtime `env` to the dependencies of the
// social API and of the shared images API. It lives in src/ rather than in one
// of the Pages Functions so every edge entry point gets an identical object
// graph and so this wiring is unit tested under `node --test` like everything
// else.
//
// Deployment config stays operations-owned (wrangler.toml / dashboard) and is
// never changed by agents -- see AGENTS.md and .agent-policy.json.

import { createD1RateLimiter, createD1SocialStores, createSocialTokenAuthenticator } from "./social-posts-api.js";
import { createD1BlobStore, createR2BlobStore } from "./social-media.js";
import { createD1ImageStore } from "./images-api.js";

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

// Wiring for /api/images. It shares the D1 database, the media bucket, the
// inline blob table, and the token map with the social API -- that sharing is
// the point of the endpoint -- and differs only in the metadata store, which is
// namespace-scoped. There is deliberately no `identifyHuman`: uploads to the
// shared store are bearer-token only (see resolveImagePrincipal).
export function imageDependencies(env, requestId) {
  const bucket = env.SOCIAL_MEDIA_BUCKET ?? null;
  return {
    requestId,
    images: createD1ImageStore(env.DB),
    // Same store selection and same key space as the social path, so the two
    // namespaces are two prefixes in one bucket rather than two deployments.
    blobs: bucket ? createR2BlobStore(bucket) : createD1BlobStore(env.DB),
    authenticate: createSocialTokenAuthenticator(parseTokenMap(env.AGENT_TOKENS)),
    rateLimit: createD1RateLimiter(env.DB, { limit: imageRateLimit(env) }),
  };
}

function imageRateLimit(env) {
  const configured = Number(env.IMAGE_UPLOAD_RATE_LIMIT);
  // Uploads are far heavier than a text post, so the default budget is smaller
  // than the social one rather than inherited from it.
  return Number.isInteger(configured) && configured > 0 ? configured : 10;
}
