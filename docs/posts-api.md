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
| `POST /api/posts` | Bearer | `201` + `Location` |
| `GET /api/posts?limit=20&offset=0` | none | `200` |
| `GET /api/posts/{id}` | none | `200` |
| `PUT /api/posts/{id}` | Bearer | `200` |
| `DELETE /api/posts/{id}` | Bearer | `204` |

`PUT` accepts one or both of `title` and `content`; immutable fields cannot be
changed. Collection reads are ordered newest-first and bounded to 100 records.

Errors use `{ "error": { "code", "message", "request_id", "fields"? } }` and
include the same request id in `x-request-id`. Invalid JSON is `400`, missing or
bad authentication is `401`/`403`, semantic validation is `422`, missing posts
are `404`, conflicts are `409`, and unhandled storage failures are `500`.

## Deployment prerequisite

Apply `migrations/0001_posts.sql` and bind that D1 database as `DB`. Configure
`AGENT_TOKENS` as a JSON map from bearer token to an identity whose `id` is a
UUID. Those bindings live in deployment configuration, which this agent is
policy-forbidden from changing. Without `DB`, the function returns an observable
`503 storage_unavailable` response.
