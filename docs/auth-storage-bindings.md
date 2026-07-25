# Auth and storage bindings

Scope of this change: the posting APIs' runtime bindings are now declared in
one versioned contract (`src/bindings.js`) and their configuration health is
observable at `/healthz`. No deployment configuration changed.

## What was actually missing

Authentication and least-privilege scope enforcement already existed on
`POST/PUT/DELETE /api/posts` (bearer token, `posts:write` scope, author-scoped
mutations, credential-free audit events) and on `POST /api/social-posts`.
See `docs/posts-api.md` and `docs/social-posts-api.md`.

The real gap was operational, not functional: `/healthz` probed only D1. If
`AGENT_TOKENS` were absent, malformed, or rotated to identities that no longer
carry `posts:write`, the site reported `200 ok` while every write silently
returned `401`/`403`. That failure mode is invisible to a rollout smoke test and
is the one a token rotation actually produces.

## The binding contract

`BINDING_CONTRACT` in `src/bindings.js` declares each binding's name, kind,
whether it is required, its purpose, and its least-privilege expectation:

| Binding | Kind | Required | Privilege |
| --- | --- | --- | --- |
| `DB` | D1 | yes | Read/write on this project's D1 database only. |
| `AGENT_TOKENS` | secret | no | One rotatable token per principal, only the scopes it needs. |
| `SOCIAL_POST_RATE_LIMIT` | var | no | Plain integer; carries no credential. |

The contract is data, not configuration. It ships inside `src/`, so
`npm run build` pins its SHA-256 in `build-manifest.json` and `npm run
verify:build` revalidates that digest. A commit therefore states exactly which
bindings it expects, and two builds of the same commit declare the same
contract. Provisioning the bindings remains operations-owned via
`wrangler.toml` and the Cloudflare dashboard; this repository's agents are
policy-forbidden from changing them and this module never mutates them.

## Health semantics: what fails the probe and what does not

`/healthz` and `/api/posts/healthz` return
`{ "status", "storage", "auth" }` with `cache-control: no-store`.

- **Storage fails closed.** A missing or unusable `DB` binding returns `503
  storage_unavailable`. D1 is a hard dependency; a truthy placeholder that
  cannot `prepare()` is treated as unbound.
- **Auth is reported, not gating.** `auth` is `ok`, `degraded`, `invalid`, or
  `unconfigured`, and never changes the status code.

That second rule is a deliberate refusal to add coupling. `/healthz` gates
production rollout and the post-rollback smoke test. If a rotatable secret could
turn it red, a routine token rotation could fail an unrelated deploy, and — far
worse — a bad secret could block the rollback of an unrelated outage. Storage
and identity have different owners, different change cadences, and different
blast radii; the probe keeps them separately observable instead of collapsing
them into one red/green bit.

## Least privilege in the probe output

The probe is unauthenticated, so it emits status enums only.
`publicBindingStatus()` is the single projection allowed into a response body.
Principal counts (`principals`, `writers`, `invalid`) go to the structured
`binding_health` log for operators; token strings and principal names are never
serialized anywhere. A regression test asserts the projection contains no token,
no name, and no digit. The probe performs no authentication, sends no
credential, and issues exactly one statement, `SELECT 1 AS healthy`.

No Wawalu production database, cookie, credential, or internal API is read.
`src/bindings.js` reads only the Pages `env` object handed to the request and
the repository's own source; its sole outbound dependency is `normalizeIdentity`
from `src/posts.js`.

## Rollback

Reversible by revert, with no data path:

1. `git revert` the commit and let protected CI redeploy that artifact, or
   redeploy the last known-good commit artifact through the established
   protected release process (`OPERATIONS.md`).
2. `npm run verify:build` revalidates every digest, including `bindings.js`.
3. Smoke-test `/healthz`; the previous artifact returns
   `{ "status": "ok", "storage": "available" }` without the `auth` field.

The change adds no migration, no schema, and no binding. Reverting it deletes no
durable rows and cannot strand storage configuration, because it never wrote
any. The only externally visible surface is one additive JSON field on the
health probes.

## Operational risk assessment

| Risk | Assessment |
| --- | --- |
| Response-shape change on `/healthz` | Low. Additive field; `status` and `storage` are unchanged. `scripts/verify-build.mjs` checks the static `healthz` sentinel, which is untouched. |
| Probe leaking auth material | Low. Enum-only projection with a regression test; counts confined to logs. |
| New failure mode in the probe | Low. Binding inspection is pure, synchronous, and total — malformed JSON is caught and reported as `invalid`. |
| Auth degradation masked by a green probe | Accepted, deliberately. Writes still fail loudly with `401`/`403` and audit events; operators get `auth: "degraded"` plus the `binding_health` log. Alert on that field rather than on the status code. |
| Privilege change | None. No binding, secret, scope, workflow, or ownership file was modified. |

## Deliberately not implemented: image posting

The assigned task asks for auth and storage bindings for an **image posting
API**. That endpoint does not exist, and I did not create one.

1. **Out of charter.** `PRODUCT.md` scopes Shiplog to decisions, releases,
   browsing, and JSON export. Image upload is a new product surface, not a
   binding change, and needs a charter amendment first.
2. **The binding cannot be created here.** Object storage means an R2 bucket
   binding in `wrangler.toml`, which `.agent-policy.json` lists as a forbidden
   path. No agent in this repository can configure it. Emulating it by storing
   blobs in the existing `DB` binding would be exactly the hidden coupling this
   change is meant to avoid: it silently repurposes a text-record database as a
   binary store, ties image retention to post retention, and makes rollback of
   the API a data problem rather than an artifact problem.
3. **The security surface is not free.** User-supplied binaries need a
   content-type allowlist, a size cap, a separate origin or path so a stored
   file can never be served as script under the site's CSP, write-scoped
   (not read-write-list) bucket credentials, and a bucket lifecycle policy so
   rollback has a defined data story.

If image posting is genuinely wanted, it needs its own issue covering points
1–3, and the bucket binding must be provisioned by operations before any code
depends on it. Until then the honest state is: no image endpoint, and therefore
no image storage binding to configure.
