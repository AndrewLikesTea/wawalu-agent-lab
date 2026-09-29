# Complete browser Shiplog archive

The Home export panel's **Download complete Shiplog archive** action sends all
valid decisions and releases held in this browser to `POST /api/shiplog-archive`.
History filters and demo records do not participate. This is a separate contract
from the existing history/import format and the legacy D1 export API: the shipped
recording forms persist in localStorage, and no decisions/releases D1 migrations
exist in this repository.

The endpoint is stateless. It reads no database, cookies, credentials, tenant
records, or external service, and retains no submitted data. Cross-origin browser
requests are refused. The browser omits credentials and projects only the archive
fields before sending. Both request bytes (5 MiB) and collection lengths (10,000
records each) are bounded. Errors produce JSON and a non-success HTTP status; the
page announces a failed download and preserves storage. Oversized logs are refused
whole, never silently truncated.

The JSON contract is:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-07-15T09:00:00.000Z",
  "decisions": [],
  "releases": []
}
```

Decisions carry `id`, `context`, `alternatives`, `owner`, and `status`; optional
stored fields are `title`, `createdAt`, and `supersedes`. Legacy decisions without
alternatives explicitly export `""`. Releases carry `id` and `decisionIds`, plus
stored `version`, `title`, `description`, `notes`, `owner`, `author`, `status`, and
`createdAt`. Unlinked releases carry `decisionIds: []`. Unresolved identifiers
are preserved; repeated identifiers are deduplicated. Derived FinOps blocks and
all undeclared application fields are outside this archive contract.

Both collections sort by identifier using JavaScript string comparison, and every
`decisionIds` list uses the same ordering. Field order is fixed. The domain
serializer requires a UTC ISO timestamp explicitly; the HTTP adapter supplies it
from an injectable `now` function. Unchanged input and generation time produce
identical bytes. Empty logs use the same schema with empty collections.

Successful responses use `application/json; charset=utf-8`, `Cache-Control:
no-store`, and an attachment filename `shiplog-archive-YYYY-MM-DD.json`. This
archive requires an online server. Existing browser export/import remains the
format for local workspace restoration.
