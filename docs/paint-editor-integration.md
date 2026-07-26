# Paint → image editor contract

Status: version 1.0, contract only. The Paint and editor deployments remain
independent. All examples are synthetic and require no enterprise credential.

## Boundary and opening flow

Version 1 transfers a **flattened raster snapshot**, not Paint's private undo
history, brushes, layers, or internal document model.

1. Paint uploads the snapshot to `POST /api/images` using its own bearer token
   and the existing `images:write` scope. See [images-api.md](images-api.md).
2. Paint builds a manifest conforming to
   `contracts/paint-editor/v1/schema.json` from the returned image metadata.
3. The host passes the parsed manifest to the editor's
   `openPaintDrawing(manifest)` boundary. The editor runs
   `validatePaintEditorImport` before any fetch or canvas mutation.
4. The editor fetches `GET asset.url` with no credentials, verifies the response
   content type, byte count, and SHA-256 against the manifest, decodes it, then
   creates a new unsaved editor document of `canvas.width × canvas.height`.

`asset.url` is deliberately restricted to the canonical same-origin
`/api/images/{id}/content` path and must contain the same UUID as `asset.id`.
Consumers must not accept an absolute or caller-selected URL. This prevents the
handoff from becoming an authenticated fetch or SSRF proxy.

The host may implement the call directly when both applications share a page.
If it uses `window.postMessage`, the message data is the manifest itself and both
sides must set/check the exact `location.origin`; `"*"` is not allowed. The
editor should send a readiness signal before Paint sends the manifest. Transport
retries are safe because `transfer_id` identifies one attempt.

There is no live Paint fetch, editor endpoint, shared cookie, or provider
credential in this contract. Wiring a button in the separately deployed Paint
application is a deployment decision, not a prerequisite for validating the
integration.

## Versioning

`schema_version` uses `major.minor` strings:

- A consumer accepts exactly the major versions it implements. Version 1
  currently accepts `1.0`.
- A new optional field requires a minor version and a validator update.
- Removing/renaming a field, changing meaning, or adding a required field
  requires a new major-version directory and a parallel validator.
- Producers must keep sending 1.0 until the receiving editor advertises support
  for another version. Consumers reject unknown versions; they never guess.

The JSON Schema is the portable producer contract. The JavaScript validator is
the normative runtime behavior for this repository.

## Failure behavior

Validation is side-effect free. The editor keeps its current document unchanged
unless the manifest, downloaded bytes, checksum, and image decode all succeed.

| Condition | Behavior |
| --- | --- |
| Partial manifest | Reject with field-level errors; do not fetch or change the editor. |
| Unknown version/kind or malformed values | Reject the whole manifest. Never coerce numbers, dates, URLs, or identifiers. |
| Unknown fields | JSON Schema rejects them. Producers must version additions. |
| Export older than 24 hours | Accept with a `stale` warning. Opening is an explicit user action, so age alone does not destroy useful work. |
| Missing image (`404`) | Report that the Paint export is unavailable and preserve the current document. |
| Storage unavailable (`503`) or network failure | Report a retryable failure; retry the same `transfer_id` with bounded backoff. |
| Metadata/bytes disagree, checksum fails, or decode fails | Reject as corrupted; never render partial bytes. Do not retry automatically because immutable bytes should not change. |
| Duplicate `transfer_id` | Treat as an idempotent retry and process once. |
| Reordered revisions | For a single `drawing_id`, choose the greatest valid integer `revision`; arrival time and `exported_at` do not decide order. |
| Same drawing/revision with different checksums | Stop with `revision_checksum_mismatch`; do not guess which payload is authoritative. |
| Mixed drawing ids in one resolution batch | Stop with `mixed_drawings`; resolve each drawing independently. |
| One malformed item in a batch | Quarantine it in `rejected`; another valid item may still be selected. |

Paint owns monotonically increasing revisions within a `drawing_id`. A save of
an older Paint revision may still be opened directly, but it must not replace a
newer revision when several deliveries are being reconciled.

## Fixtures

Fixtures live in `contracts/paint-editor/v1/fixtures`:

- `valid.json`: accepted current snapshot.
- `partial.json`: missing `asset`, rejected without side effects.
- `stale.json`: structurally accepted with a freshness warning.
- `malformed.json`: independent version, identity, URL, type, size, checksum,
  date, and dimension failures.
- `reordered.json`: revision 3 delivered before revision 2; revision 3 wins.

They are safe for producer contract tests, editor development, and deployment
smoke tests. They contain no customer drawing or credential.
