# Shiplog delivery-history contract

Status: **Anya-approved contract 1.0, 2026-07-29**. Approval covers the schema,
the versioning rule, the failure semantics, the generated fixtures, and the
browser consumer in `src/shiplog-delivery-history.js`. It does not approve a
vendor connection, credential, scheduled transfer, retention exception, or
deployment. A real connector is a separate deployment decision with its own
security and privacy review.

Machine-readable form:
[`contracts/integrations/shiplog-delivery-history/v1/manifest.json`](../contracts/integrations/shiplog-delivery-history/v1/manifest.json).

## What it is for

`docs/spend-per-delivery-contract.md` answers "is local AI spend keeping pace
with shipped delivery?" by dividing recorded spend by releases recorded as
completed. It reads the release log **this browser** keeps, which is right for a
reader who records releases here and useless for a FinOps lead whose releases
live in another Shiplog install. This contract is the file that carries those
releases across: one UTF-8 JSON document, chosen with the file picker, validated
and consumed entirely in the tab.

It supplies a denominator and nothing else. It does not establish that the spend
produced the releases, that a release is a unit of value, or that a lower ratio
is better — the metric contract states that once and every rendered state carries
it.

## Boundary

No credential, URL, host, header, token, or transport of any kind is a field in
this document, and none is required to develop against it. The consumer performs
no fetch, no upload, and no storage write: the file is read with the local Blob
text API and the parse is pure, so the same bytes always produce the same
outcome.

Per release the document carries an opaque delivery id, a revision, an
operation, a completion timestamp, a coarse status, an optional short version
label, and a count of linked decisions. That is the entire allowlist, and
`additionalProperties: false` is enforced in code: an undeclared field refuses
the document rather than being stripped, because a consumer that strips one hides
what it was sent.

Never carried, and refused by name where a producer serializes a vendor object
instead of projecting one: release notes, commit messages, descriptions, titles,
or any free prose; author, owner, reviewer, or committer identity; branch,
commit, diff, repository, URL, host, or IP; credentials, tokens, keys, cookies,
or prompt contents.

Opaque identifiers use the same producer-side construction as the rest of this
contract set — see
[`docs/privacy-preserving-integration-contracts.md`](privacy-preserving-integration-contracts.md).
`delivery_id`, `snapshot.source_instance_id`, and `export_id` are **withheld**:
validated, joined on, then dropped. The forwarded projection carries an ordinal
instead, so nothing the consumer publishes can be rendered back to a release, an
instance, or an export.

## The identifier-derived label rule

`version_label` is the one producer-authored string that crosses the boundary, so
it is the one string that can smuggle a withheld identifier out with it. The
obvious test — normalize both sides, ask whether either contains the other —
is not sufficient:

| withheld `delivery_id` | `version_label` | containment | shared run |
| --- | --- | --- | --- |
| `ABCDEF123456` | `build DEF123` | passes: neither contains the other | `def123`, six characters, in order |

Six characters of a pseudonym is enough to correlate two exports. So the rule is
a **shared contiguous run**: if a label and any withheld identifier share a run
of **three or more** alphanumeric characters, the label is treated as derived
from that identifier and the whole document is refused as a privacy violation
(`identifier_derived_label`), exactly as an undeclared field is.

Both sides are case-folded and stripped of every non-alphanumeric character
before comparison, so `def-123`, `DEF 123`, and `d.e.f.1.2.3` are the same run
as `def123`. Testing every window of exactly three characters is equivalent to
testing for runs of three *or longer*, because a longer shared run contains a
shorter one.

The check is deliberately biased toward refusal: an incidental three-character
collision costs a reader a cosmetic string, while a forwarded fragment costs a
producer their pseudonyms. `sanitizeDeliveryLabel` re-applies the same test at
the forwarding boundary as a second lock, so a label assembled outside the parser
is dropped — never truncated, never hashed — instead of being rendered. Both
locks are covered by regression tests, including the case in the table above.

A rejection names the run's length and its normalized offset and nothing else. A
diagnostic that quoted the label, the run, or the identifier would be the leak it
exists to prevent, and the same holds for every string this consumer renders: the
surface writes counts, periods, statuses, and cleared labels as text nodes, and
never a file name, an id, or a raw parser message.

## Versioning

`schema_version` is `major.minor` and the consumer allowlists exact versions it
has reviewed — currently `1.0` only. An unknown version is refused
(`unsupported_version`) without any claim about whether the rest of the document
would have validated. A new optional field or enum value is a minor version plus
review; a required field, a removal, a rename, an identifier change, a privacy
change, or a semantic change is a new major version. `kind` must be
`shiplog.delivery_history`; a file claiming that kind is always reported against
*this* contract, even when it fails it, so a reader is never told their delivery
history was simply unrecognized.

`export_id` makes a retry idempotent. `snapshot.sequence` is producer-owned and
monotonically increasing per source instance; `generated_at` provides freshness
only and never determines ordering.

## Validation outcomes

| Outcome | Meaning | Effect on the reading |
| --- | --- | --- |
| `accepted` | Complete, fresh, every record inside the declared period. | The count is used as stated. |
| `incomplete` | Usable and knowably a floor: partial or stale export, declared omissions, or records quarantined outside the period. | The count is used and labelled as a floor. |
| `incompatible` | Nothing can be derived. | No count is taken and no reading on screen is replaced. |

## Failure behaviour

| Input | Behaviour | Recovery |
| --- | --- | --- |
| Partial (`mode`/`completeness` partial, or `omitted_record_count > 0`) | Valid records are counted; absence never deletes and never implies a release did not ship. `incomplete`, `partial_export`. | Request a complete snapshot when the count must be final. |
| Stale | Judged against a caller-supplied timestamp — the analysed period's own end on the page, never a clock inside the parser. Past 72 hours the count is labelled lagging, not refused: `incomplete`, `stale_export`. With no timestamp the outcome reports freshness *unknown* rather than assuming current. | Re-export the period from the source instance. |
| Malformed | Invalid JSON, a non-envelope top level, an undeclared or prohibited field, a missing required field, an out-of-range value, an impossible calendar date (`2026-02-30`), or a privacy declaration this contract does not accept refuses the whole document. No partial state is built. `incompatible`. | Correct the export at source and re-export with a new `export_id`. |
| Reordered | Arrival order is never authority: the greatest revision for a delivery wins whether it arrives first or last, an identical duplicate collapses to one, and two copies at one revision with differing content refuse the document (`revision_conflict`). The outcome is independent of array order. | Correct the source so one delivery and revision has one content. |
| Replayed | A `snapshot.sequence` at or below one the caller has already accepted is an acknowledged replay: `incompatible`, `stale_replay`, and the reading already on screen is kept unchanged. | Nothing to fix; a replay is a no-op by design. |
| Period-incompatible | A record outside the declared half-open period is quarantined *and counted*, never silently dropped. If none remain inside, the document is refused as `no_release_in_declared_period`. A declared delivery period that cannot overlap the billing period being analysed is refused as `period_incompatible_with_spend`. | Export the delivery period that overlaps the billing period, or compare the two separately. |

## Known limits, stated rather than implied

- A duplicate JSON key collapses in the browser's parser before validation runs.
  The last value wins and no code in the consumer can see the first, so
  "reject duplicate keys" is a producer and transport obligation here, not
  something this boundary verifies.
- One export is one reading. The parser holds no high-water mark of its own;
  replay protection is the caller passing back the sequence it last accepted.
- Ceilings are enforced before parsing: 4,000,000 characters and 20,000 records.
  A larger history is refused whole, with the ceiling stated in the message.

## Fixtures

Every scenario in the manifest's `fixtures.scenarios` list is generated in
`tests/shiplog-delivery-history.test.js` from one base document, one field at a
time. Nothing is committed as a file: each fixture is a field away from the valid
case, so a generated set cannot drift from the schema it is checked against, and
the ceiling cases cost no repository bytes. All data is synthetic. No live
enterprise credential, vendor sandbox, customer identifier, or network connection
is required or authorised by this contract.

## Where it is consumed

`src/evolution-page.js` routes a chosen file to this parser from the file's own
`kind`, paints the outcome through `src/shiplog-delivery-history-view.js` in the
import panel, and — when the outcome is usable — divides the analysed billing
period's spend by this file's release count instead of the local release log's.
The file is authoritative rather than merged: the same release recorded in both
would otherwise be counted twice, and the provenance line says which of the two
answered.
