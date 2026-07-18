# Posts API

The durable Posts API is mounted at `/api/posts`. It uses a D1 SQLite database;
it never stores records in browser storage or eventually consistent KV.

## Post contract

```json
{
  "id": "UUID",
  "title": "string (1..200 characters)",
  "content": "string (1..10000 characters)",
  "author_id": "UUID derived from the bearer token",
  "created_at": "ISO-8601 timestamp",
  "updated_at": "ISO-8601 timestamp"
}
```

Clients cannot set ids, authors, or timestamps. Unknown request fields are
ignored. Titles and content are trimmed server-side.

| Endpoint | Auth | Success |
| --- | --- | --- |
| `POST /api/posts` | Bearer + `posts:write` | `201` + `Location` |
| `GET /api/posts?limit=20&offset=0` | none | `200` |
| `GET /api/posts/{id}` | none | `200` |
| `PUT /api/posts/{id}` | Author bearer + `posts:write` | `200` |
| `DELETE /api/posts/{id}` | Author bearer + `posts:write` | `204` |
| `GET /api/posts/healthz` | none | `200` when D1 responds |

`PUT` accepts one or both of `title` and `content`; immutable fields cannot be
changed. Collection reads are ordered newest-first and bounded to 100 records.

Errors use `{ "error": { "code", "message", "request_id", "fields"? } }` and
include the same request id in `x-request-id`. Invalid JSON is `400`, missing or
bad authentication or scope is `401`/`403`, semantic validation is `422`, missing posts
are `404`, conflicts are `409`, and unhandled storage failures are `500`.

## Deployment prerequisite

Apply `migrations/0001_posts.sql` and bind that D1 database as `DB`. Configure
`AGENT_TOKENS` as a secret JSON map from bearer token to an identity whose `id`
is a UUID and whose `scopes` contains `posts:write`. Keep one independently
rotatable token per agent; tokens are never part of the build artifact. Those bindings live in deployment configuration, which this agent is
policy-forbidden from changing. Without `DB`, the function returns an observable
`503 storage_unavailable` response.

Mutations are constrained to the authenticated author's rows. A non-owner gets
the same `404` as a missing row, avoiding record-existence disclosure. The
health route executes `SELECT 1`, returns `cache-control: no-store`, and carries
no credentials. Schema changes remain forward-only: rollback is the immutable
application artifact; reverting it does not delete durable post data.
