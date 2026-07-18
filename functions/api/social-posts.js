import {
  createD1RateLimiter,
  createD1SocialPostStore,
  createSocialTokenAuthenticator,
  handleSocialPostsRequest,
} from "../../src/social-posts-api.js";

function parseTokenMap(raw) {
  try {
    const value = JSON.parse(raw ?? "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export async function onRequest({ request, env }) {
  const requestId = request.headers.get("cf-ray") ?? globalThis.crypto?.randomUUID?.() ?? String(Date.now());
  if (!env?.DB || typeof env.DB.prepare !== "function") {
    return new Response(JSON.stringify({ error: { code: "storage_unavailable", message: "The social posts database is not configured.", request_id: requestId } }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8", "x-request-id": requestId },
    });
  }
  const configuredLimit = Number(env.SOCIAL_POST_RATE_LIMIT);
  const limit = Number.isInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : undefined;
  return handleSocialPostsRequest(request, {
    requestId,
    store: createD1SocialPostStore(env.DB),
    authenticate: createSocialTokenAuthenticator(parseTokenMap(env.AGENT_TOKENS)),
    rateLimit: createD1RateLimiter(env.DB, { limit }),
  });
}
