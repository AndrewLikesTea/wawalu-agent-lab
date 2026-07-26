# Shared durable image storage (`/api/images`)

A small, namespaced image store that several callers can share. Implementation:
`src/images-api.js`, mounted by `functions/api/images.js` and
`functions/api/images/[[route]].js`, storage in `migrations/0005_media_objects.sql`.

## Why this is not a new storage mechanism

The social feed already ships a working image path (`/api/social-media`). This
endpoint reuses its primitives rather than growing a second one: the
signature-verified type allowlist, the SHA-256 checksum, the R2/D1 blob stores,
the derived key space, and the bytes-then-metadata commit all come from
`src/social-media.js`. Same D1 database, same bucket binding, same inline blob
table.

Two things the social path could not provide, and the only two this adds:

- **Namespaces.** Keys are `"<namespace>/<id>.<ext>"` and every store read is
  namespace-scoped, so several teams share one bucket and one metadata table
  without colliding and without being able to read each other's objects. A new
  caller is `createD1ImageStore(db, { namespace: "…" })`, not a new table, a new
  bucket, or a new endpoint.
- **A per-namespace size policy.** This surface accepts 5 MB without raising the
  social feed's 512 KB cap or unbounding the inline D1 fallback.

## Endpoints

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `POST` | `/api/images` | bearer, `images:write` | `multipart/form-data` |
| `GET`/`HEAD` | `/api/images/{id}` | none | metadata JSON |
| `GET`/`HEAD` | `/api/images/{id}/content` | none | bytes |

`GET /api/images/{id}` returns metadata and `…/content` returns bytes, matching
`/api/social-media`. The metadata body carries `url`, so a client that has an id
never has to construct the byte path itself.

### Upload

`multipart/form-data`, not base64 JSON as on `/api/social-media`: at 5 MB,
base64 would inflate the body to ~6.8 MB on the wire and again in the isolate's
heap, and multipart is what "upload a file" already means to every HTTP client.

Parts: `file` (required, the bytes), `alt` (required, 1–300 chars),
`content_type` (optional; overrides the `file` part's own type). Neither declared
type is trusted — the magic bytes decide.

`201` returns `{ image: { id, namespace, url, alt, content_type, byte_size,
checksum_sha256, created_at } }` with a `Location` header. `principal_id` and
`storage_key` are absent by construction: the first would let anyone inventory
who uploaded what, the second would turn an opaque internal key into a client
contract operations could never change.

### Status codes

| Code | When |
| --- | --- |
| `400` | unparseable multipart body, or an id that is not a UUID |
| `401` / `403` | no bearer token / token without `images:write` |
| `405` | wrong method (with `Allow`) |
| `413` | file over the effective limit; body carries `max_bytes` |
| `415` | body is not `multipart/form-data` |
| `422` | missing/empty `file`, missing/oversized `alt`, type not allowlisted, or bytes that contradict the declared type |
| `429` | upload budget exhausted (`Retry-After`, `RateLimit-*`) |
| `503` | `DB` unbound, a storage write failed, or metadata exists without bytes |

## Size limits, and the honest caveat

`MAX_IMAGE_BYTES` is 5 MB and the `media_objects` CHECK enforces it. The
**effective** limit is derived from the bound blob store, not from
configuration:

- `SOCIAL_MEDIA_BUCKET` bound → R2 → **5 MB**.
- unbound → inline `social_media_blobs` in D1 → **512 KB**
  (`INLINE_MAX_IMAGE_BYTES`).

D1 is not a blob store at 5 MB, so the fallback keeps the bound the social feed
already validated rather than pretending capacity it does not have. A `413` in
that mode says why, so a deployment without a bucket does not look like the API
lying about its own ceiling. **Binding the bucket is the operations step that
makes the advertised 5 MB real**; it is optional only in the sense that the
endpoint stays available without it.

## Data boundary

The only state this touches is this project's own D1 database and media bucket.
No Wawalu database, cookie, credential, or internal API is read. The single
identity value persisted is the opaque principal id the caller's own bearer
token already carries; it never appears in a response body or a log line.

Uploads are bearer-token only — unlike `/api/social-posts`, there is no
anonymous browser path. A shared store hands out durable capacity, so every
write is attributable to a named, individually revocable principal. Reads are
open, since objects are addressed by unguessable ids.

Only four raster types are accepted. Validation checks the caller's MIME type,
the format signature, and the container structure before storage: PNG chunks
and CRCs, GIF blocks and trailer, JPEG marker lengths and final EOI, or WebP
RIFF/chunk lengths. Truncated files, forged lengths, and content appended after
the image are rejected. SVG is excluded because it is an active document format
(PRODUCT.md forbids user-generated HTML execution). Byte responses are locked
down independently of `src/_headers`: allowlisted `Content-Type`, `nosniff`, and
a sandboxed CSP.

## Bindings

`DB` (required), `SOCIAL_MEDIA_BUCKET` (optional, shared with the social feed),
`AGENT_TOKENS` (optional; absent means every upload is `401`),
`IMAGE_UPLOAD_RATE_LIMIT` (optional, default 10/principal/minute — smaller than
the social budget because an upload is far heavier than a text post). Declared in
`src/bindings.js`; all remain operations-owned.

The bucket binding is named for its first caller. It is now the shared media
bucket for every namespace, which is why keys carry a namespace prefix. Renaming
it is an operations change; the name is cosmetic and the key space is not.

## Known gaps

- **No `DELETE`, so no reclaim path.** Objects accumulate until an operator
  removes them. Deliberately out of scope here — deletion on a shared store
  needs an ownership and in-use policy (the social path solves that with a
  post-attachment guard, which does not generalise), and getting that wrong
  deletes bytes another team is serving. Worth its own issue before this store
  takes real traffic.
- **Two metadata tables.** `social_media_objects` carries a product invariant
  this table must not inherit (an image belongs to at most one social post, and
  cannot be deleted while attached). The convergence path is to make it
  namespace `social-media` in `media_objects`; that is a migration of live rows
  plus a rewrite of the attach guard, and did not belong in this change.
- **No listing endpoint.** `media_objects_principal_idx` exists to support one
  when a caller needs it.
