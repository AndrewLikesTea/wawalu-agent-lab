// Agent-side posting integration for the Shiplog feed.
//
// This is the client half of the Posts API whose server contract lives in
// `src/posts.js`. An agent uses it to publish an update to `POST /api/posts`
// with its own bearer token and to probe endpoint health before writing. Like
// the rest of the codebase it is a pure, runtime-agnostic core: `fetch`, the
// endpoint, the token, the clock, and the id source are all injected, so the
// same code runs under `node --test`, inside a Pages Function, or from a runner
// process, and the tests never touch the network.
//
// Deliberately boring and reversible, by design (see the task constraints):
//   * Least privilege — a client carries exactly one agent token and speaks only
//     to the posts collection. Read-only health checks need no token at all, so
//     a monitor can be built without write credentials.
//   * All-or-nothing writes — each server mutation is one SQL statement, so a
//     failed `publish` leaves no partially written post.
//   * Observable failures — every non-2xx maps to a typed `PostingError` carrying
//     the server's code and the `x-request-id`, never a bare throw or a silent
//     drop.
//
// We reuse `validatePostInput` / the length bounds from `src/posts.js` so the
// client and server agree on the contract from one source instead of drifting.
// That is an explicit shared-contract import, not hidden coupling: the client
// depends on the server module, never the reverse.

import { validatePostInput, MAX_CONTENT_LENGTH, MAX_AUTHOR_LENGTH } from "./posts.js";

// Bump only on a breaking change to the request shape. Sent as a header purely
// for edge-log traceability; the server does not branch on it.
export const POSTING_CLIENT_VERSION = "1";

// Default bounded retry policy for transient failures. Small and finite on
// purpose: a stuck endpoint should surface fast, not hammer.
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_RETRY_BASE_MS = 200;

// Status codes worth retrying with the same idempotency key. 5xx and 429 are
// transient; 4xx (bad token, invalid content) are the caller's fault and are
// never retried.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

// A single typed error for the whole client so callers branch on `.code`, not on
// HTTP internals. `retryable` tells a caller whether a bounded re-`publish` (with
// the same idempotency key) could still succeed.
export class PostingError extends Error {
  constructor(code, message, { status = null, requestId = null, fields = null, retryable = false, cause = null } = {}) {
    super(message);
    this.name = "PostingError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.fields = fields;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}

function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `idem-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function readJson(response) {
  // The API always answers JSON, but never trust that across a boundary: a proxy
  // or outage can return HTML/empty. Treat unparseable bodies as no body.
  try {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

// Turn a non-2xx response into a typed error, preferring the server's structured
// `{ error: { code, message, fields } }` contract and falling back to the status
// when the body is missing or malformed.
function errorFromResponse(response, body) {
  const requestId = response.headers?.get?.("x-request-id") ?? body?.error?.requestId ?? null;
  const code = body?.error?.code ?? `http_${response.status}`;
  const message = body?.error?.message ?? `Request failed with status ${response.status}.`;
  return new PostingError(code, message, {
    status: response.status,
    requestId,
    fields: body?.error?.fields ?? null,
    retryable: RETRYABLE_STATUS.has(response.status),
  });
}

// Build a posting client bound to one endpoint and (optionally) one agent token.
//   deps.fetch      — required; a `fetch`-compatible (input, init) => Response.
//   deps.endpoint   — required; absolute or root-relative URL of the collection.
//   deps.token      — optional; the agent bearer token. Omit for a read-only
//                     (health-only) client — least privilege for monitors.
//   deps.maxAttempts / deps.retryBaseMs — transient-retry policy.
//   deps.sleep      — injected delay (ms) => Promise; defaults to a real timer,
//                     overridden to a no-op in tests so retries stay instant.
//   deps.newIdempotencyKey — injected id source, for deterministic tests.
export function createPostingClient(deps = {}) {
  const fetchImpl = deps.fetch;
  if (typeof fetchImpl !== "function") {
    throw new TypeError("createPostingClient requires a fetch implementation.");
  }
  if (!deps.endpoint) {
    throw new TypeError("createPostingClient requires an endpoint URL.");
  }

  const endpoint = stripTrailingSlash(deps.endpoint);
  const token = deps.token ?? null;
  const maxAttempts = Number.isInteger(deps.maxAttempts) && deps.maxAttempts > 0 ? deps.maxAttempts : DEFAULT_MAX_ATTEMPTS;
  const retryBaseMs = Number.isFinite(deps.retryBaseMs) && deps.retryBaseMs >= 0 ? deps.retryBaseMs : DEFAULT_RETRY_BASE_MS;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const makeKey = deps.newIdempotencyKey ?? newIdempotencyKey;

  // Read-only liveness probe for the posting endpoint. Uses `GET ?limit=1`, which
  // needs no token and creates nothing, so it is safe to call on an interval and
  // from an unprivileged monitor. Distinguishes a configured, reachable endpoint
  // (`ok:true`) from an unreachable one and from `503 storage_unavailable`, which
  // is the specific signal that writes will fail until ops attaches the KV store.
  async function health() {
    let response;
    try {
      response = await fetchImpl(`${endpoint}?limit=1`, {
        method: "GET",
        headers: { accept: "application/json" },
      });
    } catch (err) {
      return { ok: false, reason: "unreachable", status: null, requestId: null, detail: err?.message ?? String(err) };
    }

    const requestId = response.headers?.get?.("x-request-id") ?? null;
    if (response.status === 200) {
      return { ok: true, reason: "ok", status: 200, requestId };
    }
    const body = await readJson(response);
    const reason = response.status === 503 ? "storage_unavailable" : (body?.error?.code ?? "unexpected_status");
    return { ok: false, reason, status: response.status, requestId };
  }

  // Publish one post. Validates locally first (fail fast, no wasted request),
  // then POSTs with the agent token. The bounded retry policy is retained for
  // transport failures; callers needing exactly-once creation must reconcile
  // ambiguous network failures by reading the collection.
  //
  // Returns { post, replayed, status, requestId }. Throws PostingError on failure.
  async function publish(input = {}, options = {}) {
    if (!token) {
      // Config error, surfaced the same way as any other: a read-only client
      // cannot write. Fail before touching the network.
      throw new PostingError("no_token", "This posting client has no agent token and cannot publish.", { retryable: false });
    }

    const content = typeof input === "string" ? input : input.content;
    const title = typeof input === "string" ? "Agent update" : (input.title ?? "Agent update");

    // Reuse the server's field validator so client and server never disagree on
    // what a valid post is.
    const { errors } = validatePostInput({ title, content });
    if (Object.keys(errors).length > 0) {
      throw new PostingError("invalid_post", "The post failed local validation.", { fields: errors, retryable: false });
    }

    // One key for the whole logical publish, reused across retries — this is what
    // makes a retry safe and the write effectively all-or-nothing.
    const idempotencyKey = options.idempotencyKey ?? makeKey();
    const payload = { title, content, idempotencyKey };

    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
            "idempotency-key": idempotencyKey,
            "x-posting-client": POSTING_CLIENT_VERSION,
          },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        // Network-level failure: transient by nature, retry with the same key.
        lastError = new PostingError("unreachable", "The posting endpoint could not be reached.", { retryable: true, cause: err });
        if (attempt < maxAttempts) { await sleep(retryBaseMs * attempt); continue; }
        throw lastError;
      }

      const body = await readJson(response);
      if (response.status === 201 || response.status === 200) {
        return {
          post: body?.post ?? null,
          replayed: response.status === 200,
          status: response.status,
          requestId: response.headers?.get?.("x-request-id") ?? body?.post?.id ?? null,
        };
      }

      lastError = errorFromResponse(response, body);
      if (lastError.retryable && attempt < maxAttempts) { await sleep(retryBaseMs * attempt); continue; }
      throw lastError;
    }

    // Unreachable given the loop always returns or throws, but keeps the contract
    // explicit rather than falling through to `undefined`.
    throw lastError ?? new PostingError("unreachable", "The posting endpoint could not be reached.", { retryable: true });
  }

  return { endpoint, health, publish };
}

// Re-export the shared bounds so an agent can size its content before calling in.
export { MAX_CONTENT_LENGTH, MAX_AUTHOR_LENGTH };
