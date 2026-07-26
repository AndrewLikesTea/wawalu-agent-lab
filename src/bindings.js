// Declarative contract for the runtime bindings the posting APIs depend on.
//
// The bindings themselves stay operations-owned (wrangler.toml / dashboard).
// Agents are policy-forbidden from changing deployment configuration, so this
// module only *observes and reports* configuration; it never mutates it and it
// holds no credential material.
//
// Why a contract in the artifact: the declaration ships inside the immutable
// build, so `build-manifest.json` pins its SHA-256 and a given commit states
// exactly which bindings it expects and at what privilege. Rollback is
// therefore the ordinary artifact rollback -- reverting the commit reverts the
// expected contract, migrates nothing, and deletes no durable rows.

import { normalizeIdentity } from "./posts.js";

export const BINDING_CONTRACT = Object.freeze([
  Object.freeze({
    name: "DB",
    kind: "d1",
    required: true,
    purpose: "Durable, transactional storage for posts and social posts.",
    privilege: "Read/write on this project's D1 database only; no other database and no account-level D1 access.",
  }),
  Object.freeze({
    name: "AGENT_TOKENS",
    kind: "secret",
    required: false,
    purpose: "JSON map of bearer token to a scoped identity, used to authenticate writes.",
    privilege: "One independently rotatable token per principal, each carrying only the scopes it needs. When absent, reads still work and every write is rejected with 401.",
  }),
  Object.freeze({
    name: "SOCIAL_MEDIA_BUCKET",
    kind: "r2",
    required: false,
    // Named for its first caller. It is now the shared media bucket for every
    // namespace (/api/social-posts images and /api/images alike), which is why
    // keys carry a namespace prefix. Renaming the binding is an operations
    // change agents cannot make; the name is cosmetic and the key space is not.
    purpose: "Object storage for image bytes, shared across media namespaces.",
    privilege: "Read/write on this project's media bucket only. When absent, image bytes fall back to the bounded social_media_blobs table in D1, so the feature degrades in capacity rather than availability.",
  }),
  Object.freeze({
    name: "IMAGE_UPLOAD_RATE_LIMIT",
    kind: "var",
    required: false,
    purpose: "Positive integer upload budget per principal per minute for /api/images. Defaults to 10.",
    privilege: "Plain configuration value; carries no credential.",
  }),
  Object.freeze({
    name: "IMAGES",
    kind: "images",
    required: false,
    purpose: "Stateless decode, transformation, and PNG/JPEG encoding for /api/image/export/{format}.",
    privilege: "Transform request-scoped image bytes only; grants no D1, R2, filesystem, or account-wide storage access. The export endpoint returns 503 when absent.",
  }),
  Object.freeze({
    name: "SOCIAL_POST_RATE_LIMIT",
    kind: "var",
    required: false,
    purpose: "Positive integer write budget per principal per minute for /api/social-posts.",
    privilege: "Plain configuration value; carries no credential.",
  }),
]);

function isBound(value, kind) {
  // A D1 binding is only useful if it can actually prepare a statement; a
  // truthy placeholder must not read as healthy.
  if (kind === "d1") return typeof value?.prepare === "function";
  // Same rule for R2: a truthy placeholder that cannot store an object must not
  // read as bound, or the health probe would call an unusable binding healthy.
  if (kind === "r2") return typeof value?.put === "function" && typeof value?.get === "function";
  if (kind === "images") return typeof value?.input === "function";
  return value !== undefined && value !== null && String(value) !== "";
}

// Summarizes the token secret without ever touching token material. Counts are
// for operator logs; see publicBindingStatus for what an unauthenticated caller
// is allowed to see.
export function summarizeAuthConfiguration(raw, requiredScope = "posts:write") {
  const empty = { principals: 0, writers: 0, invalid: 0 };
  if (raw === undefined || raw === null || raw === "") return { status: "unconfigured", ...empty };

  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { status: "invalid", ...empty };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { status: "invalid", ...empty };

  let principals = 0;
  let writers = 0;
  let invalid = 0;
  for (const identity of Object.values(parsed)) {
    principals += 1;
    try {
      if (normalizeIdentity(identity).scopes.includes(requiredScope)) writers += 1;
    } catch {
      invalid += 1;
    }
  }
  if (principals === 0) return { status: "unconfigured", ...empty };
  // No writer means the endpoint is authenticated but unusable -- exactly the
  // silent failure this check exists to surface after a botched rotation.
  const status = invalid > 0 || writers === 0 ? "degraded" : "ok";
  return { status, principals, writers, invalid };
}

export function inspectBindings(env = {}) {
  const bindings = {};
  const missing = [];
  for (const binding of BINDING_CONTRACT) {
    const bound = isBound(env?.[binding.name], binding.kind);
    bindings[binding.name] = bound ? "bound" : "unbound";
    if (!bound && binding.required) missing.push(binding.name);
  }
  return {
    storage: bindings.DB === "bound" ? "configured" : "unconfigured",
    auth: summarizeAuthConfiguration(env?.AGENT_TOKENS),
    bindings,
    missing,
  };
}

// Projection for the unauthenticated probe: status enums only. Principal counts
// stay in structured logs so an anonymous caller cannot inventory how many
// tokens are provisioned, and no name or token can reach the response body.
export function publicBindingStatus(report) {
  return { auth: report?.auth?.status ?? "unknown" };
}
