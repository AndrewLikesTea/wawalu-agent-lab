# Shiplog export API

`GET /api/exports` returns the server-held Shiplog log — every decision, every
release, and every release-to-decision association — as one JSON file. It reads
the D1 database bound as `DB`; it holds no Wawalu customer, telemetry, cookie,
or credential data, and it makes no network call of its own.

| Endpoint | Returns |
| --- | --- |
| `GET /api/exports` | Linked snapshot: `decisions`, `releases`, `links` |
| `GET /api/exports/decisions` | `decisions` only |
| `GET /api/exports/releases` | `releases` only |
| `GET /api/exports/portfolio` | Savings portfolio contract (bundled fixture) |
| `GET /api/exports/reconciliation` | Monthly reconciliation contract (bundled fixture) |

Every response is `content-type: application/json; charset=utf-8` with
`content-disposition: attachment; filename="shiplog-{type}-{YYYY-MM-DD}.json"`
and an `x-request-id`. Only `GET` is accepted; anything else is `405` with an
`allow: GET` header. A missing or unreadable database is `503` with an
`{ error: { code, message, requestId } }` body that names no internal detail.

## Snapshot shape

```json
{
  "metadata": {
    "timestamp": "ISO-8601, when the snapshot was taken",
    "version": "1",
    "counts": {
      "decisions": 2,
      "releases": 2,
      "links": 1,
      "decisionsWithoutReleases": 1,
      "releasesWithoutDecisions": 1
    },
    "unresolvedLinks": [
      { "releaseId": "r-2", "decisionId": "d-gone", "position": 0 }
    ]
  },
  "decisions": [
    {
      "id": "d-1", "title": "…", "context": "…", "alternatives": "…",
      "owner": "…", "status": "…", "createdAt": "ISO-8601",
      "supersedes": "id of the decision this one replaces (optional)"
    }
  ],
  "releases": [
    {
      "id": "r-1", "version": "v1.2.0", "title": "…", "description": "…",
      "notes": "…", "owner": "…", "author": "…", "status": "…",
      "createdAt": "ISO-8601", "decisionIds": ["d-1"]
    }
  ],
  "links": [
    { "releaseId": "r-1", "decisionId": "d-1", "position": 0 }
  ]
}
```

`links` is one record per association, and `position` is the index the release
recorded that decision at. It is the same information as `release.decisionIds`,
stated as rows so a consumer can join the two logs without unpacking a nested
array — and so the association survives a flattening into a table or a
spreadsheet.

## Guarantees

- **Complete on both sides.** A decision no release mentions and a release that
  names no decision are ordinary records; only their `links` are absent.
  `counts.decisionsWithoutReleases` and `counts.releasesWithoutDecisions` state
  how many of each the file holds, so an empty join is visible rather than
  inferred.
- **Every link resolves.** An id that names a decision the database no longer
  holds is listed in `metadata.unresolvedLinks` and removed from both `links`
  and that release's `decisionIds`, so the two views never disagree and a reader
  holding only this file can resolve every association it claims.
- **Closed field set.** Records are rebuilt from the field allowlists in
  `src/shiplog-export-schema.js`. A column the tables grow later is not exported
  until it is declared there, which is what keeps a `SELECT *` from carrying an
  unrelated field out of the product.
- **Deterministic order.** Both collections are ordered oldest `createdAt`
  first, ties broken by id, in the query (`ORDER BY createdAt ASC, id ASC`) and
  again when the snapshot is built. `links` follow release order, then recorded
  position. The same database exports to the same bytes, so two snapshots diff
  cleanly.
- **One point in time.** The combined endpoint reads both tables in a single D1
  batch, so a release written between two reads cannot produce a link to a
  decision the file does not carry.

`metadata.version` stays `"1"`: `links`, `counts`, and `unresolvedLinks` are
additive, and every other change narrows what a file may contain, so a reader
written against version 1 keeps working.

`/api/exports/decisions` and `/api/exports/releases` carry the same allowlist
and ordering but no `links`, `counts`, or `unresolvedLinks` — a single-table
file has nothing to resolve associations against, so a release's `decisionIds`
are returned as recorded.

The browser-side export (`src/shiplog-export.js`, download button on the export
panel) writes a separate `shiplog-history` file. Its stable top-level record is
`{ schema, version, generatedAt, record_count, filter, decisions, releases,
associations }`, and an empty history is that same record with all three
collections empty rather than a shorter file.

`associations` answers *which decisions shipped in which release, in what
order*, without a reader having to walk nested records. It is the file's
`releases[].decisionIds` flattened in file order — releases in the export's own
order, and within a release the order that release recorded — as one
`{ decisionId, releaseId, position }` row per link, where `position` is the
0-based index of `decisionId` in that release's `decisionIds` **as this file
carries it**.

Two consequences worth stating, because they are what a consumer would
otherwise have to guess:

- Positions are contiguous. A link the export could not carry — its decision is
  gone from the browser, or the visitor's filters hide it — is absent from
  `decisionIds` and from `associations` alike, and the remaining links renumber.
  There is no gap standing for a record the file does not contain. The export
  panel is where a dropped link is reported, and it is the surface that can also
  say which of the two reasons applied.
- `associations` is derived, never authoritative on its own.
  `shiplogExportViolations` rejects any file whose two views of a link disagree,
  so joining on `associations` and walking `decisionIds` cannot give different
  answers. `decisionIds` stays on the release because the importer reads it.
