# Gateway shape mapping contract

Mapping version: `gateway-shape-mapping/1.0.0`
Implemented by: `src/gateway-shape-translation.js`
Reads: `shiplog/routing-policy` version `1.0.0` — the file
`src/routing-policy-document.js` composes and the routing-slate section
downloads.

The routing policy is a proposal about routing. It is not a gateway
configuration and nothing in this product can make it one. This mapping answers
the narrow question a platform team asks the moment the file lands: on the shape
my request router is configured in, which of these rules survive the
translation, and which do not.

It is a pure, offline function of `(policy, shape)`. No DOM, no request, no
credential, no clock, no randomness, and nothing time-dependent in the output —
two readers translating one policy get identical bytes. The policy's
`generatedAt` is read by nothing here.

No vendor, product or proprietary configuration schema is named, imitated or
referenced. Both target shapes below are generic.

## Target shapes

| id | shape |
| --- | --- |
| `rule-list` | an ordered array of `{match, target}`, evaluated **first match wins**. Order is the semantics: the array is the policy's own rank order and nothing re-sorts it. |
| `weighted-pool` | named pools of upstreams carrying integer weights (percent of the pool), each pool with a `default` upstream. |

Two shapes is the requirement and the ceiling. There is no registry and no
plugin point: a third shape is a code change here, reviewed like any other.

## Field-by-field mapping

Every policy path this mapping reads is read in one function, `readRule`. A
policy field that is renamed breaks the mapping and fails
`tests/gateway-shape-translation.test.js`, which is the point.

| policy path | `rule-list` | `weighted-pool` |
| --- | --- | --- |
| `rules[].guardrails.appliesToOrgUnit` | `match.orgUnit` | `appliesTo.orgUnit`, and the first half of `name` |
| `rules[].sourceModel` | `match.model`, or `null` | `appliesTo.model`, and the second half of `name` |
| `rules[].guardrails.appliesToSourceTier` | `match.tier`, or `null` | `default`, and the zero-weight upstream |
| `rules[].targetTier` | `target.tier` | the weight-100 upstream |
| `rules[].rank` | the array index | (used only to name a rule in `untranslatable`) |

`match.model` is `null` when the policy repeats the org unit as `sourceModel`.
That is what the per-org-unit form of the policy does when the export never
named a model, and a match on a model name that is really an org unit would
address traffic no gateway has. The match then names the org unit alone.

### Fields neither shape carries

`expectedMonthlyReturnUsd`, `observedChangeUsd`, `evidence`,
`guardrails.confidence`, `guardrails.basis`, `guardrails.lifecycle`.

A router has no field for what a route is worth, and a comment claiming a dollar
figure inside a live config is a claim nobody re-checks. They stay in the policy
file, which is the record. The list is exported as `FIELDS_NOT_CARRIED` and rides
on every result as `fieldsNotCarried`, so the omission is machine-readable rather
than folklore.

## Result

```
{ mappingVersion, policySchema, policyVersion, shape, shapeLabel, state, reason,
  ruleCount, translatedCount, translated, untranslatable, fieldsNotCarried }
```

`state` is exactly one of `translated`, `empty`, `unsupported_version`,
`unsupported_shape`, `unreadable`. The function never throws.

## Stated behaviour for partial and unsupported input

**Unsupported policy version.** The version gate runs before any field is read.
A policy whose `version` is not in `ACCEPTED_POLICY_VERSIONS` returns
`state: "unsupported_version"`, `translated: null` and an empty `untranslatable`
list, with a `reason` naming both the version it was handed and the versions it
accepts. Nothing is translated and nothing is guessed: a schema this mapping does
not know may use the same field names for different things.

**Empty policy.** `rules: []` returns `state: "empty"`, `translated: null` and a
reason. An empty rule list rendered as an empty config teaches a reader their
gateway has nothing to change, which is the same defect `routingPolicyDocument`
refuses an empty download for.

**A rule the shape cannot express.** It is never omitted silently. It is left out
of `translated` and appended to `untranslatable` as
`{rank, source, field, reason}`:

| condition | shapes affected | `field` |
| --- | --- | --- |
| no org unit on the rule | both | `no_org_unit` |
| no target tier | both | `no_target_tier` |
| no current tier | `weighted-pool` only | `no_source_tier` |

The last is the case where the two shapes genuinely differ: a rule list can match
on the org unit alone, but a weighted pool has no upstream to weight the proposed
one against. `untranslatableSummary()` states the count, the distinct reasons and
that the rules are still in the downloaded policy; the routing-slate section
renders it beside the snippet.

**Rules present, no default or fallback route.** The policy ranks changes; it
never claims to describe all traffic.

- `rule-list` ends with `default: null` and carries the `unmatchedTraffic`
  sentence: anything unmatched keeps the route it has today. No catch-all is
  invented, because a `match: *` entry would move every unmentioned request onto
  a route no rule asked for.
- `weighted-pool` cannot omit a default, so each pool defaults to the tier that
  rule is on today, and `defaultsFrom` says so.

**Unreadable input.** A non-object, or an object whose `rules` is not an array,
returns `state: "unreadable"` with a reason.

## On the page

`/evolution.html` renders one worked snippet — the `rule-list` shape, from the
reader's current policy — in a collapsed disclosure inside the routing-slate
section, below the download control. It is the reader's own policy, composed by
the same generator the control serializes, so the snippet and the file cannot
disagree. The snippet is written through `textContent`, so policy content cannot
carry markup into the page.

There is no input of any kind in that block: no credential field, no endpoint, no
connect affordance. The translation happens in the tab, and there is nowhere in
it to paste a secret.
