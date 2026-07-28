# Local FinOps workspace contract

`finops-workspace/1.0.0` — the opt-in, browser-local retention contract for
**derived** FinOps briefing periods and commitments.

The executable constants, allowlists, and normative sample live in
`src/finops-workspace-contract.js`; the shipped local-workspace preview consumes
that module. This document defines the behavior around that contract: what the
surface must answer, how each number is computed, and what happens on consent,
migration, export, and erasure. The downstream tasks in
[Downstream dependencies](#downstream-dependencies) build against the module,
not a copied field list.

Today a FinOps briefing is computed in the tab and evaporates on reload.
`shiplog.workspace.v1` retains decisions and releases; nothing retains FinOps
material. This contract closes that gap for derived aggregates only — the
imported provider rows are never retained, and this document is what makes that
claim checkable rather than promised.

## The questions this workspace answers, in priority order

1. **Did last month's picture hold, or has it moved?** A leader who imported in
   June and returns in July must see June's derived figures without re-importing
   June's file. This is the entire reason retention exists.
2. **What did we commit to, and against which period's numbers?** Every retained
   commitment names the period whose figures sized it.
3. **What exactly is this browser keeping about our spend, and how do I get rid
   of it?** A consent surface that cannot enumerate what it holds has not
   obtained consent.
4. **Can I trust these retained numbers as much as the day they were computed?**
   Retained coverage and confidence travel with the figures, or the figures do
   not appear.

Question 1 outranks 2 because a commitment without its period is unauditable.
Question 3 outranks 4 because a leader who cannot erase will not import at all.

### Non-goals — deliberately not answered here

- **Any use of raw imported rows after the tab closes.** No provider export, no
  cell, no header, no filename, no row count keyed to a file survives the
  session. Retention is derived aggregates only.
- **Multi-period trend analysis and charting.** `longitudinal-finops/1.0.0`
  already owns "which department moved against its baseline". This contract
  supplies the retained periods that contract reads; it does not restate them.
- **Verification that a commitment landed.** That needs a later period's import
  and is `savings-commitment-verification/1.0.0`'s question. Retaining a
  commitment creates no evidence about its outcome.
- **Sync, accounts, backup, or sharing.** There is no server. See
  [Honest limits](#honest-limits-under-the-static-client-side-constraint).
- **A settings page.** Two controls exist — grant/revoke, and erase. Anything
  else is surface without a question.
- **Free text of any kind.** No notes, no labels a visitor typed, no reasons.
  Every retained string is an enum, a canonical identifier, a period, or an
  instant. This is the cheapest structural defence against retaining prompts.

## Where it sits

| Contract | Question |
| --- | --- |
| `finops-briefing/1.0.0` | Is this spend justified, and what do we do next? (in-tab) |
| `finops-workspace/1.0.0` | What did this browser keep from those briefings, with consent? |
| `longitudinal-finops/1.0.0` | Which department moved against its own baseline? (reads retained periods) |
| `shiplog-finops-commitment/1.0.0` | The commitment block, stored verbatim here and in a Shiplog decision |

## Storage

One key, one JSON object, whole-key writes only.

```
shiplog.finops.workspace.v1
```

The key does not exist until consent is granted. **Absence means no grant has
ever been recorded**, not granted — the opposite of `shiplog.workspace.v1`, where absence means the
long-standing default of retaining decisions. The defaults differ deliberately:
Shiplog records are things the visitor typed into Shiplog, while a FinOps
briefing is derived from a spend file the visitor's employer owns. Keeping the
second by default is a decision this product has no standing to make.

## The envelope

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `schemaVersion` | string | required | exactly `"finops-workspace/1.0.0"` |
| `consent` | object | required | below |
| `periods` | array | required | may be empty; ordered, capped, deduped per [Retention semantics](#retention-semantics) |
| `commitments` | array | required | may be empty; same |
| `meta` | object | required | below |

`consent`:

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `state` | enum | required | `"granted"` or `"declined"`. There is no `"unasked"` value; unasked is the absent key. |
| `decidedAt` | instant | required | ISO-8601 UTC, `YYYY-MM-DDTHH:MM:SS(.mmm)Z` |
| `grantedAgainst` | string | required | the `schemaVersion` the visitor consented to |

`meta`:

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `lastWriteAt` | instant | required | stamped on every successful whole-key write |

## Retained briefing period

One entry per `(dataset, period)`. All money is **integer USD minor units
(cents)**; a float, a negative where the field forbids it, or a non-integer is
rejected on read, never rounded into acceptance.

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `periodId` | string | required | `` `${dataset}:${period}` `` — the dedup key, not an opaque id |
| `period` | string | required | `YYYY-MM` |
| `dataset` | enum | required | `"user"` or `"example"` |
| `briefingContractVersion` | string | required | the `finops-briefing/*` version the figures were selected by |
| `derivedAt` | instant | required | when this browser computed the figures |
| `sourceFingerprint` | string | required | 8 lowercase hex chars, [below](#source-fingerprint) |
| `analyzedSpendMinor` | integer | required | ≥ 0 |
| `attributedSpendMinor` | integer | required | ≥ 0 and ≤ `analyzedSpendMinor` |
| `recoverableScenarioMinor` | integer | required | ≥ 0 |
| `recordsTotal` | integer | required | ≥ 0, safe integer |
| `recordsAnalyzed` | integer | required | ≥ 0 and ≤ `recordsTotal` |
| `coverageRatioPpm` | integer | required | 0…1 000 000, derived; see below |
| `confidence` | enum | required | `high` \| `moderate` \| `low` \| `insufficient`, derived |
| `missingInputs` | array of enum | required | may be empty; values from `REQUIRED_INPUTS`, sorted ascending |
| `materialMetricId` | enum or null | required | `"recoverable_scenario"` \| `"spend_change"` \| `null` |
| `materialMetricMinor` | integer | conditional | signed; present **iff** `materialMetricId !== null` |
| `absenceReason` | enum | conditional | an `ABSENCE_REASON` value; present **iff** `materialMetricId === null` |
| `topDepartmentId` | string | optional | canonical lower-case kebab-case, ≤ 64 chars; absent when no department ranked |

Absent-versus-null is load-bearing: a **conditional** field is absent, not null,
when its condition does not hold, and a reader that finds both `absenceReason`
and `materialMetricMinor` rejects the entry rather than choosing one.

### Calculation rules

**Money.** `minorFromUsd(usd) = Math.sign(usd) * Math.round(Math.abs(usd) * 100)`.
Taking the absolute value first makes JavaScript's round-half-up equal
round-half-away-from-zero, so −$0.005 and +$0.005 give −1 and 1 rather than 0
and 1. `usd` must be finite and `Math.abs(usd) <= 1e12` (the plausibility ceiling
`finops-briefing-restore.js` already applies); anything else is not retainable.

**Coverage.**
`coverageRatioPpm = Math.round(recordsAnalyzed / recordsTotal * 1e6)`, and
**`recordsTotal === 0` is defined as 0**, matching `coverageRatio()` — a briefing
that joined nothing has covered nothing. `coverageRatioPpm` is stored *and*
re-derived on read; a stored value that disagrees with its own inputs rejects the
entry. Parts-per-million integers, not floats, so two engineers who serialize the
same workspace produce identical bytes.

**Confidence.** Derived from `coverageRatioPpm` and `missingInputs` by the
thresholds in `finops-briefing-contract.js`, unchanged: `high` needs ppm ≥
900 000 **and** an empty `missingInputs`; `moderate` needs ppm ≥ 600 000; `low`
needs ppm > 0; otherwise `insufficient`. Stored and re-derived on read, like
`coverageRatioPpm`, and like the existing commitment block's `confidence.band`.

**Material metric.** Copied from the briefing's single selected figure — the same
total order (materiality rank, then absolute value, then longer period, then
candidate id). This contract never re-selects it. `materialMetricMinor` is signed
because `spend_change` can be negative and a spend that fell is the good news a
leader most wants retained.

**Period eligibility.** A briefing is retainable only when its period is exactly
one calendar month: start at `YYYY-MM-01T00:00:00Z` and exclusive end at the
first instant of the next month. Anything else is not retained, with reason
`period_not_calendar_month`. A half-month retained as `YYYY-MM` would silently
corrupt every month-over-month comparison downstream.

### Source fingerprint

`sourceFingerprint` is FNV-1a 32-bit over the UTF-8 bytes of the entry's
canonical JSON — keys sorted ascending, `derivedAt`, `periodId` and
`sourceFingerprint` itself excluded — rendered `(hash >>> 0).toString(16)`
left-padded to 8 characters with `0`. Offset basis 2166136261, prime 16777619.

It is a change detector, not an identity and not a security claim: it answers
"did re-importing change last month's numbers?" without retaining anything of
the file. It is **not** derived from file bytes, filename, or row contents.

## Retained commitment

The commitment block is stored **verbatim** as
`shiplog-finops-commitment/1.0.0` — `schemaVersion`, `commitmentId`, `claim`,
`confidence`, `provenance`, `recommendedAction` — and validated by the existing
`commitmentMetadataErrors()`. This contract adds no field to it and re-derives
none of its arithmetic. Two rules would be two rules.

Four local envelope fields sit beside it:

| Field | Type | Required | Rule |
| --- | --- | --- | --- |
| `recordedAt` | instant | required | when this browser retained it |
| `status` | enum | required | `"recorded"` \| `"decision_linked"` |
| `decisionId` | string | conditional | present **iff** `status === "decision_linked"`; equals `` `finops-commitment-${commitmentId}` `` |
| `periodId` | string | optional | the retained period whose figures sized the claim; absent if that period is not retained |

`periodId` is optional rather than required because a period can be evicted while
its commitment survives. When it is absent the surface must say the sizing period
is no longer retained rather than showing an unanchored dollar figure.

## Prohibited fields

Enforcement is a **closed allowlist**: a key not named in this document is
rejected on write and drops the entry on read. A denylist scan would need to
anticipate every future leak; an allowlist fails closed. The list below is the
rationale for the allowlist, and the acceptance test asserts each class is
unrepresentable.

- **Credentials and account identity** — API keys, tokens, bearer strings,
  cookies, provider account ids, billing account numbers, org ids, email
  addresses, user names, employee identifiers.
- **Prompts and model content** — prompt text, completions, system prompts,
  conversation ids, embeddings, samples, excerpts, any substring of any of them.
- **Raw imports** — file names, file bytes, sizes, MIME types, column headers,
  cell values, per-row records, row ids from the source file, sheet names, or any
  count scoped to a single file.
- **Network and transfer** — URLs, endpoints, hostnames, IP addresses, user
  agents, request/response ids, trace or correlation ids, timing or beacon
  payloads, retry state, sync cursors, remote record ids, queue entries, or any
  field whose only purpose is to be sent somewhere later.
- **Free text** — every retained string is an enum, a canonical identifier, a
  `YYYY-MM` period, an ISO-8601 UTC instant, or hex. No exceptions in v1.

`provenance.recordIds` inside the commitment block is the one identifier list
retained. It stays because it is already the audit trail of a decision recorded
into Shiplog, it is canonical kebab-case, it is capped at 50, and it names
analysis records rather than source rows. It must not be widened.

## Retention semantics

- **Periods**: at most **24** entries, keyed by `periodId`. A re-derivation of an
  existing key replaces the entry wholesale. Order is `period` ascending, then
  `dataset` (`example` before `user`). Over cap, evict from the front.
- **Commitments**: at most **50**, keyed by `commitmentId`, replaced in place.
  Over cap, evict the oldest `recordedAt` among `status: "recorded"` first; only
  when none remain evict `decision_linked`, oldest first; ties break on
  `commitmentId` ascending. A commitment already written into the decision log is
  the last thing to go.
- **Size**: the serialized key must stay at or under **256 000 characters**.
  Evict per the rules above until it fits; if a single period still exceeds it,
  refuse the write and report `workspace_over_size` — never a silent truncation.
- **No clock expiry.** Nothing is deleted because it got old. A TTL that quietly
  removed a leader's June figures would break question 1, and a surface that
  claims a record exists must not be racing a timer to be right.
- **Writes are whole-key and last-write-wins.** Two tabs writing at once means
  the later write stands; v1 does not merge. See [Honest limits](#honest-limits-under-the-static-client-side-constraint).

## Consent, migration, export, erasure

### Consent

- Nothing is written before `consent.state === "granted"`. Declining the initial
  preview therefore writes nothing; the choice applies to the current visit and
  the preview may be offered again later. The grant control is
  reachable only from the preview described below, so a visitor cannot consent
  to a description they were not shown.
- A write is permitted **iff** FinOps consent is `granted` **and**
  `retentionDeclined(storage)` is false. Declining Shiplog retention is a
  statement about this browser, not about one feature, and it wins.
- Revoking (`state: "declined"`) stops new writes and erases nothing. Entries
  written before the revocation stay until erased, and the surface's one next
  action becomes erase — the same ladder `local-workspace.js` already uses for
  `erase_after_decline`.

### Migration

- v1 is the first version; there is nothing to migrate from. The rule that
  matters is forward-defensive.
- A stored `schemaVersion` this build does not recognise, or text that is not
  parseable JSON, is **quarantined, not overwritten**: counts report `unknown`
  rather than zero, no write proceeds, and the only offered actions are export
  and erase. Restore before erase, as elsewhere in the workspace.
- A future minor version requires a reader update before it can be accepted.
  V1's closed allowlist rejects unknown keys, including additive ones; silently
  ignoring them would make the preview's “every retained field” claim false. A
  major bump additionally requires a fresh grant, because
  `consent.grantedAgainst` records what the visitor actually saw.

### Export

- One file, `shiplog-finops-workspace-YYYY-MM-DD.json`, media type
  `application/json`, containing the canonical serialization of the stored
  object. Serialization sorts object keys, so the same workspace exports to
  identical bytes twice — the same rule `serializeBriefing()` already uses.
- Quarantined text uses a separate recovery export: download the stored text
  byte-for-byte as `shiplog-finops-workspace-recovery-YYYY-MM-DD.json`. Do not
  parse, stamp, sort, or rewrite a schema this build does not understand.
- Export is a local download and does not mutate storage. It is the only way
  retained material leaves this browser.

### Erasure

One control, and it is total: `removeItem` on `shiplog.finops.workspace.v1`
**and** on `shiplog.finops.orgUnitLabels` — the existing key holding org-unit
labels derived from imports. Leaving that second key behind would make "erased
everything" false.

- Erasure is verified by re-reading both keys; both must read `null` before the
  surface reports success. A refused or partial erase reports what is still
  stored, matching `eraseWorkspace()`'s existing honesty about partial failure.
- Erasure returns this browser to the never-asked state, and the control says so:
  the visitor will be asked again before anything is retained.
- Erasure does not touch `shiplog.decisions.v1` or `shiplog.releases.v1`. A
  commitment already recorded as a decision is a Shiplog record and is erased
  from the Shiplog workspace, which already has its own control.

## The sample workspace preview

Shown **before** the grant control, and generated by the same projection that
would write real data, run over the example dataset — so the preview cannot drift
from what actually gets stored. It answers three questions in this order:

1. **What is retained?** Every field of one sample period and one sample
   commitment, each with a one-line plain-language gloss. Not a summary: the
   literal field names and literal values that would be written.
2. **Why does it matter?** Beside each group, the question it lets a leader
   answer later — the four in [the priority list](#the-questions-this-workspace-answers-in-priority-order).
   A field group that cannot name one does not belong in v1.
3. **How do I erase it?** The exact keys removed, the fact that erasure returns
   the browser to never-asked, and what is deliberately left alone (decisions and
   releases, and any export file already downloaded).

The preview also states the prohibited classes as "never stored", which is
assertable rather than decorative because the allowlist makes each class
unrepresentable.

A normative sample, to be lifted as the preview fixture:

```json
{
  "schemaVersion": "finops-workspace/1.0.0",
  "consent": {
    "state": "granted",
    "decidedAt": "2026-07-02T09:14:00Z",
    "grantedAgainst": "finops-workspace/1.0.0"
  },
  "periods": [
    {
      "periodId": "example:2026-06",
      "period": "2026-06",
      "dataset": "example",
      "briefingContractVersion": "finops-briefing/1.0.0",
      "derivedAt": "2026-07-02T09:14:00Z",
      "sourceFingerprint": "c1daf8d2",
      "analyzedSpendMinor": 4820000,
      "attributedSpendMinor": 4577000,
      "recoverableScenarioMinor": 612000,
      "recordsTotal": 1840,
      "recordsAnalyzed": 1748,
      "coverageRatioPpm": 950000,
      "confidence": "high",
      "missingInputs": [],
      "materialMetricId": "recoverable_scenario",
      "materialMetricMinor": 612000,
      "topDepartmentId": "customer-support"
    }
  ],
  "commitments": [
    {
      "schemaVersion": "shiplog-finops-commitment/1.0.0",
      "commitmentId": "route-support-triage-to-haiku",
      "claim": {
        "baselineMonthlyCostMinor": 1840000,
        "projectedMonthlyCostMinor": 1228000,
        "monthlySavingsMinor": 612000,
        "currency": "USD",
        "unit": "usd_minor",
        "period": "2026-06"
      },
      "confidence": { "percent": 78, "band": "high" },
      "provenance": {
        "sourceId": "example-dataset",
        "designation": "demo",
        "importedAt": "2026-07-02T09:12:00Z",
        "analysisPeriod": "2026-06",
        "recordIds": ["rec-0f21", "rec-0f22"],
        "recordCount": 2
      },
      "recommendedAction": {
        "workloadId": "support-triage",
        "departmentId": "customer-support",
        "fromModelId": "opus-tier",
        "toModelId": "haiku-tier"
      },
      "recordedAt": "2026-07-02T09:15:00Z",
      "status": "decision_linked",
      "decisionId": "finops-commitment-route-support-triage-to-haiku",
      "periodId": "example:2026-06"
    }
  ],
  "meta": { "lastWriteAt": "2026-07-02T09:15:00Z" }
}
```

## Acceptance criteria

Each is a question a leader asks, and each is answerable from the shipped
surface without opening a console.

1. **"I imported in June. It is July — what did June say?"** Reopening the
   workspace after a browser restart shows June's analyzed spend, recoverable
   scenario, coverage, and confidence, without re-importing, and names the date
   they were derived.
2. **"What did we commit to, sized against which month?"** Every retained
   commitment shows its claim, its confidence band, and the retained period that
   sized it — or states plainly that the sizing period is no longer retained.
3. **"What is this browser keeping about our spend?"** The surface enumerates
   every retained field before consent is asked and after it is granted, and the
   two enumerations match field for field.
4. **"Is any of our provider file in there?"** The surface states that no prompt,
   credential, filename, cell, or network field can be stored, and a test proves
   each class is rejected rather than merely absent from the sample.
5. **"Can I still trust these numbers?"** No retained figure renders without the
   coverage and confidence it was computed under; a period whose stored coverage
   or confidence disagrees with its own inputs is reported as unreadable, not
   shown.
6. **"How do I get rid of all of it?"** One control removes both FinOps keys,
   verifies both read empty before reporting success, and states that the browser
   is back to never-asked — and that decisions, releases, and any downloaded
   export are untouched.
7. **"I never agreed to this."** A browser that has never granted consent stores
   nothing under either key, and the workspace shows the preview rather than a
   count.
8. **"I turned Shiplog retention off — why is FinOps still writing?"** It is not:
   with Shiplog retention declined, no FinOps write succeeds regardless of FinOps
   consent, and the surface says which choice is blocking it.
9. **"Two of us ran this — do we get the same file?"** The same retained
   workspace exports to byte-identical JSON on two machines, and the same
   briefing derives a byte-identical period entry.

## Downstream dependencies

Independently mergeable, in this order of usefulness; 1 and 2 land without 3.

1. **Persistence** — `src/finops-workspace.js`: read, project a briefing into a
   period entry, project a commitment, whole-key write behind the consent gate,
   eviction, export serialization, erase. Pure module: no DOM, no fetch, no
   clock beyond an injected one, one storage key plus the labels key on erase.
2. **Verification** — `tests/finops-workspace.test.js`: allowlist rejection per
   prohibited class; derived-field disagreement rejected; eviction and cap
   ordering; consent gate including the `retentionDeclined` interaction;
   quarantine of an unknown `schemaVersion`; erase completeness across both keys;
   byte-identical serialization; and a source scan asserting the module contains
   no `fetch`, `XMLHttpRequest`, `sendBeacon`, `indexedDB`, or cookie path — the
   same assertion style `longitudinal-finops` already uses.
3. **UI** — the preview is shipped read-only on the workspace page. Add the
   grant/revoke control and retained-period and commitment sections when
   persistence lands, reusing the existing state, confidence, and next-action
   ladder rather than inventing a second one.

## Honest limits under the static client-side constraint

Stated because the surface must not imply otherwise.

- **Erasure is local.** This page can only clear this browser. Another browser,
  another device, another profile, an OS or extension backup, and any export
  file already downloaded are all outside its reach, and the erase copy must say
  so rather than claiming the data is gone.
- **Consent is unprovable.** The consent record is itself erasable by the
  visitor. That is correct, and it means the product can never demonstrate that
  consent was given. No surface may suggest an audit trail exists.
- **Storage size is characters, not bytes on disk.** No browser exposes the
  second, so the 256 000 cap and any reported size are counts of JSON text.
- **Retention is not verification.** Keeping a commitment says nothing about
  whether the saving landed; that still requires a later import.
- **A hand-edited key cannot be prevented, only rejected.** There is no server to
  sign anything, so read-time validation is the whole defence — which is why
  every derived field is re-derived on read rather than trusted.
- **Concurrent tabs can clobber.** Whole-key last-write-wins is the v1 rule; a
  merge would need a conflict story this product has no question for yet.
