# Privacy-preserving enterprise integration contracts

Status: **Anya-approved contract set, version 1.0, 2026-07-25**. Approval is
limited to the schemas, fixtures, and processing rules in this document. It does
not approve a vendor connection, credential, production data transfer, retention
exception, or deployment. Any implementation must pass a separate security and
deployment review and must not broaden these fields.

These contracts let producers and consumers develop and test without an HRIS,
identity-provider, or billing credential. Every fixture is synthetic.

## Boundary shared by all three integrations

The transfer unit is one UTF-8 JSON document validated against its exact
versioned schema before any state change. The receiving system must enforce a
configured byte and record limit before parsing, reject duplicate JSON keys,
validate formats (including real calendar dates), and never coerce values.
Schema validation is necessary but does not replace the semantic checks below.

Files are delivered through a deployment-selected authenticated, encrypted
transport. Credentials, cookies, HMAC keys, source URLs, and transport headers
are never fields in a document and must not be written to integration logs.
Logs may contain `kind`, `schema_version`, `export_id`, sequence, counts, and
machine-readable error codes, but no records.

Opaque identifiers are producer-generated as:

`psn_` + base64url(first 16 or more bytes of
HMAC-SHA-256(tenant integration key, entity namespace + NUL + source id)).

The secret is unique per tenant and contract generation (`salt_scope`), stored
outside exports, and rotated only as a planned major-version migration. Entity
namespaces prevent a source identifier reused for a person and unit from
colliding. All producers that need to join an organization unit use the same
tenant integration key and `org-unit` namespace. Subject identifiers are never
shared with provider exports.

Consumers keep the raw document only in an encrypted quarantine area long
enough to validate and recover, with a hard maximum of 7 days, then delete it.
Persist only allowlisted fields needed by the product. Access is least-privilege
and audited. Backups follow the same retention/deletion policy. A tenant
offboarding or erasure workflow deletes the integration key, raw quarantine,
and derived tenant rows.

The following data is always out of scope:

- names, email addresses, phone numbers, addresses, employee/provider account
  numbers, government identifiers, free text, or custom HR fields;
- credentials, authentication factors, group names, job titles, compensation,
  performance, leave, demographic, health, or location data;
- prompts, responses, files, model input/output, IP addresses, device data,
  request IDs, API keys, and per-person or per-request provider activity.

`additionalProperties: false` makes that boundary enforceable. A consumer must
reject and privacy-quarantine a document containing an unknown field; it must
not strip the field and continue.

## Versioning and reconciliation

`schema_version` is `major.minor`. Consumers allowlist exact versions they have
reviewed. A new optional field or enum value requires a minor version plus
review; a required field, removal, rename, privacy change, identifier change, or
semantic change requires a new major-version directory. Producers continue the
old version until the consumer advertises the new exact version. Unknown
versions are rejected without guessing.

`export_id` makes retries idempotent. For one `(kind, source_instance_id)`,
`snapshot.sequence` is a producer-owned monotonically increasing integer.
Consumers process sequences in numerical order, not arrival or timestamp order.
A sequence below the committed high-water mark is an acknowledged stale replay
and cannot mutate state. A gap is quarantined while the missing export is
retried; after a configured timeout, an operator may request a new complete
snapshot. The high-water mark advances only after an atomic commit.

An identical `export_id` and content digest is a no-op. Reuse of an `export_id`
or sequence with a different digest is `identity_conflict` and stops that source.
Within records, the greatest `revision` for an entity wins. A lower revision is
a no-op; equal revisions with different content are `revision_conflict`.
`generated_at` provides freshness only and never determines ordering. Exports
from different source instances are not merged automatically.

Partial exports are schema-valid and explicitly marked. Valid records may be
upserted atomically, but absence never implies deletion and the high-water mark
may advance after that atomic commit; a separate complete-snapshot baseline does
not advance. Explicit tombstones are applied only from an otherwise valid
export. A complete `full` HRIS or identity snapshot may reconcile absence only
after all pages validate and deployment policy explicitly enables snapshot
deletion.

## HRIS organizational structure

Schema: [`contracts/integrations/hris-org/v1/schema.json`](../contracts/integrations/hris-org/v1/schema.json)

Shared data is only pseudonymous unit identity, parent topology, a coarse unit
type, active state, revision, and effective time. Unit labels, managers, members,
cost centers, legal entity metadata, and all worker fields are excluded.
The complete record allowlist is `unit_id`, `revision`, `operation`,
`effective_at`, `parent_unit_id`, `unit_type`, and `active`; delete records omit
the last three topology/state fields as required by the schema.

Semantic validation rejects self-parenting, cycles, duplicate unit revisions
with conflicting content, and a parent reference absent from both committed
state and the same complete export. A missing parent in a partial export
quarantines that record while independent records may commit.

Freshness target: warn after 24 hours; after 72 hours mark organization views
degraded and alert, but retain the last complete state. Age alone never deletes
or overwrites data.

| Failure | Behavior | Recovery |
| --- | --- | --- |
| Partial/page missing | Accept independent valid upserts; no absence-based deletion; expose degraded status. | Retry same `export_id`, then request a complete snapshot. |
| Stale timestamp or sequence | Warn for age; ignore a sequence/revision rollback. | Verify producer clock; replay missing sequence or obtain a full snapshot. |
| Malformed, unknown, or direct-identifying field | Reject entire document to privacy quarantine; no state/high-water change. | Producer removes prohibited data and issues a new `export_id`. |
| Reordered export/record | Buffer sequence gaps; apply greatest revision only. | Replay gap; atomically commit in order. |
| Cycle, orphan, or revision conflict | Quarantine conflicting records/export; do not guess topology. | Correct source topology and send a higher revision. |

## Identity affiliation

Schema: [`contracts/integrations/identity/v1/schema.json`](../contracts/integrations/identity/v1/schema.json)

This is an affiliation/authorization projection, not a directory or
authentication protocol. It shares only a pseudonymous subject, organization
unit links, coarse account state and access tier. It contains no login name,
profile, groups, entitlements, tokens, authentication events, or authentication
factors. The contract does not grant access by itself.

An unknown `org_unit_id` is quarantined pending the HRIS unit; it is not mapped
to a default unit. Access changes are fail-safe: a valid explicit `disabled`,
`suspended`, or delete event may reduce access immediately. A partial snapshot,
missing record, stale feed, or orphan must never grant access or infer that an
account is active. Authorization systems retain their own deny controls.

Freshness target: warn after 4 hours; after 24 hours mark affiliation state
degraded and block new access grants derived solely from this feed. Existing
access is handled by deployment policy, not silently revoked from absence.

| Failure | Behavior | Recovery |
| --- | --- | --- |
| Partial/redacted records | Apply valid explicit restrictions; no grants or absence-based deletion. | Retry, then obtain a complete snapshot before granting. |
| Stale timestamp or sequence | Ignore rollback; surface degraded state and block feed-derived grants after 24 hours. | Restore cadence and replay sequences. |
| Malformed, unknown, or direct-identifying field | Reject entire document to privacy quarantine. | Remove prohibited fields and re-export with a new ID. |
| Reordered revisions | Higher revision wins even if it arrives first. | Buffer sequence gaps and replay deterministically. |
| Unknown unit or conflicting revision | Quarantine the record; never assign a default or guess. | Import HRIS dependency or issue a corrected higher revision. |

## Provider usage and billing

Schema: [`contracts/integrations/provider-usage-billing/v1/schema.json`](../contracts/integrations/provider-usage-billing/v1/schema.json)

Only daily aggregates by pseudonymous organization unit, provider, and coarse
service category cross the boundary. Each group must represent at least 10
distinct subjects before aggregation; groups below the threshold are omitted
and counted as `group_suppressed`. Producers must apply thresholding before
delivery. The consumer cannot accept a producer assertion as permission to
ingest user-level rows: the fixed shape and absent subject field are mandatory.
The complete aggregate-record allowlist is `aggregate_id`, `revision`,
`usage_date`, `org_unit_id`, `provider`, `service_category`, `usage.quantity`,
`usage.unit`, `cost.amount_minor`, `cost.currency`, and `cost.status`.

Costs use integer minor currency units and are never floating point. Aggregates
with different currencies are not summed. `estimated` may be replaced only by a
higher revision; `final` is still correctable only with a higher revision and an
audit entry. The semantic validator checks `period_start < period_end`,
`usage_date` within the half-open period, finite quantities, consistent units
for a given aggregate, and unique aggregate IDs.

Freshness target: warn if generated more than 72 hours after `period_end`, or if
the latest closed daily period has not arrived within 72 hours. Stale or partial
data may power clearly labeled estimates but not invoice reconciliation,
chargeback, quota enforcement, or personnel decisions.

| Failure | Behavior | Recovery |
| --- | --- | --- |
| Partial/open invoice/suppressed group | Show labeled aggregate estimates only; never synthesize omitted values. | Await final export or retry retryable pages. |
| Stale timestamp or sequence | Retain last final aggregates and warn; never roll totals back. | Replay missing export or request the closed period. |
| Malformed, content, direct identifier, or group size below 10 | Reject entire document to privacy quarantine. | Aggregate/redact at source and create a new export. |
| Reordered estimate/final correction | Greatest revision wins; status/timestamp do not establish order. | Replay gap; retain audit trail for corrections. |
| Currency/unit/revision conflict | Quarantine conflicting aggregate and stop reconciliation. | Correct with a higher revision; never convert implicitly. |

## Fixtures and implementation gate

Each schema directory contains `valid`, `partial`, `stale`, `malformed`, and
`reordered` fixtures. `partial` and `stale` are intentionally schema-valid;
freshness and completeness are semantic outcomes. `malformed` intentionally
combines structural and privacy violations and must be rejected. `reordered`
places a newer export/revision before an older one to prove arrival order is not
authority.

Before implementation, Anya must approve any schema revision and its updated
fixtures in review. Implementation acceptance requires contract tests for every
fixture, calendar/finiteness and cross-record semantic tests, atomic high-water
updates, privacy-safe logging tests, and proof that a rejected document produces
no derived-state mutation. Live credential testing and production connectivity
are explicitly outside this deliverable.
