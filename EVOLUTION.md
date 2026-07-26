# Wawalu Evolution — Enterprise AI FinOps & Efficacy

A second product line on `labs.wawalu.org`, served at `/evolution.html` under the
**AI FinOps** tab. Shiplog records why engineering decisions were made; Evolution
measures what the organization's AI spend is buying.

**Audience:** CTOs, CIOs, and enterprise engineering leaders.
**Mission:** turn enterprise AI usage from a black-box expense into a measurable,
optimized, and benchmarked driver of engineering velocity.

## The problem this tab answers

Leadership approves millions in GenAI spend and cannot answer basic questions: is
it producing value, are engineers writing effective prompts, and how much is being
burned on bloated, repeated, or out-of-scope queries. Counting tokens does not
answer any of them — the substance of the prompt does.

## What the seed ships

- `/evolution.html` — the executive view: hero literacy grade, four headline KPIs,
  spend-mix breakdown, department attribution table, ranked actions, redaction proof.
- `src/evolution.js` — the pure scoring model: `normalizeMix`, `literacyScore`,
  `letterGrade`, `recoverableSpendUsd`, `valuePerThousandUsd`, `rankDepartments`,
  `recommendationFor`, `redactForScoring`, `summarize`.
- `src/evolution-page.js` — the only layer that touches data or the DOM.
- `src/evolution-demo-data.json` — hand-authored sample organization.
- `tests/evolution.test.js` — the scoring rules, the demo boundary, and the tab links.

### The scoring model, stated plainly

Four query classes, weighted for the literacy score and for what a CTO can actually
reclaim. Both numbers are deliberately conservative — an executive metric that
oversells the saving loses the room the first time finance checks it.

| Class | Score weight | Recoverable share | System action |
|---|---|---|---|
| High-value | 100 | 0 | Counted as productive spend |
| Over-provisioned | 55 | 0.7 | Candidate for automated down-routing |
| Inefficient | 35 | 0.4 | Surfaced as a team training gap |
| Out-of-scope | 0 | 1.0 | Tagged as leakage, excluded from productivity |

The organization score is **spend-weighted, not team-weighted**: a five-person team
with a perfect score must never mask the largest budget in the company. Leakage stays
in the ranking because it is fully recoverable, but its recommendation is always
policy, never coaching — no prompt workshop stops someone asking about their kitchen
remodel.

### Content-judge rubric (`1.0.0`)

The upstream content judge uses the machine-readable contract in
`src/content-evaluation.js`; labelled synthetic cases live in
`contracts/content-evaluation/v1/fixtures.json`. Each dimension is an integer
from 0 (absent, unsafe, or contradictory) through 4 (fully satisfied with
verifiable support).

| Dimension | Weight | Assumption behind the weight |
|---|---:|---|
| Correctness | 30% | Wrong content destroys utility even when polished, so this is the largest component. |
| Instruction fit | 25% | A correct answer to another task is not success, but correctness remains primary. |
| Evidence and specificity | 20% | Checkable support makes review possible, but cannot redeem a wrong conclusion. |
| Efficiency | 15% | Review time matters, while brevity must not reward omitted substance. |
| Safety and boundary respect | 10% | A separate hard safety gate handles severe defects; this weight captures lesser defects without double-counting the gate. |

The total is `sum(score / 4 × weight × 100)`, rounded to one decimal only
after summing. A total of 70 or more passes, 65 through 69.9 is borderline, and
less than 65 fails. A safety score below 2 always fails, even when the weighted
total passes. Exact thresholds enter the higher band. Missing, fractional, or
out-of-range dimension scores and missing evidence are rejected rather than
coerced. Equal totals remain tied in source order.

Every accepted score record contains the rubric version, every dimension score
and evidence string, its weight and contribution, each applied rule, and a
human-readable arithmetic line. `evaluateContent` passes only a structured
`untrusted-content` envelope through the judge boundary. Email addresses,
credentials, payment-card-like numbers, government-ID-like numbers, URLs, IP
addresses, and common prompt-injection instructions are replaced before that
call. The sanitized envelope—not raw content—is the only content copied into
the result.

### Labels, agreement, and review

The fixture labels were hand-chosen from the rubric anchors, then checked by
recomputing each weighted contribution. They cover strong, weak, exact
borderline, exact pass, conflicting high-quality/unsafe, injection-like, and
redaction-required cases. Fixture rationales describe why the label exists;
tests repeat every aggregation and require exact fixture-to-result agreement.
That is a contract consistency check, not evidence that an external model judge
will agree with humans.

Before changing a label, two reviewers should independently score the sanitized
fixture using only the current anchors. Record disagreements per dimension,
resolve them with an anchor-based rationale, and bump the rubric version for
any changed dimension, weight, threshold, redaction rule, or label that changes
results. Add a regression fixture for every upheld score dispute. A deployment
candidate requires 100% fixture agreement and repeated-evaluation stability for
the deterministic aggregation layer.

Known limitations: these fixtures are synthetic and English-only; they test the
scoring contract rather than the accuracy or demographic fairness of a live
model judge. Regex redaction is defense in depth, not a complete DLP system, and
novel secrets or obfuscated injections may evade it. Production use therefore
requires an upstream allowlisted DLP boundary, blinded human agreement studies,
slice analysis by language/content type, and ongoing drift monitoring. The
current executive demo still aggregates pre-labelled query classes; its visible
headline now exposes the `literacy-mix/1.0.0` version and spend-weighted
arithmetic instead of an unexplained number.

## The constraint boundary — read before proposing work

`labs.wawalu.org` is a static, client-side site with no production database, no
server-side secrets, and no customer data. That is a hard boundary, not a current
limitation to engineer around.

- **Buildable here:** the executive surface, the scoring and aggregation model,
  the redaction contract, org-chart attribution over sample data, benchmarking views,
  documented integration and gateway *designs*.
- **Not buildable here:** a live Workday/Okta connection, real provider billing
  ingestion, a running proxy in the request path, storage of any real prompt.
  Model these as documented interfaces and demo fixtures. A task that requires a
  real enterprise credential is out of scope by construction.

Privacy invariants inherited from `PRODUCT.md`: no user-generated HTML execution,
no secrets, no real emails, no Wawalu customer or telemetry data, keyboard-accessible
and responsive, tests and a production build green before merge.

## Cross-functional ownership

This product line added four specialists to the synthetic team. The full roster:

| Persona | Name | Owns |
|---|---|---|
| `manager` | Sam | Scope, sequencing, dependencies, assignment |
| `product` | Noor | Metric definitions, dashboard scope, what a view must answer |
| `design` | Iris | Reading experience, grading legibility, accessibility |
| `evaluation` | Theo | Judge rubrics, scoring fixtures, score reproducibility |
| `integrations` | Anya | HRIS, identity, and provider export contracts |
| `staff` | Priya | Architecture and cross-cutting seams |
| `backend` | Rowan | Data models, aggregation, service contracts |
| `frontend` | Mina | Interfaces, interaction states, resilient UI |
| `infrastructure` | Ellis | Gateway and operational design, reversibility |
| `reviewer` | Marcus | Final review of every diff |

| Directive from the brief | Owner |
|---|---|
| Define the C-suite dashboard; it answers "are we wasting money?" in five seconds | Noor with Sam |
| Integration strategy — the endpoint contracts for Workday, Bedrock, OpenAI, Anthropic | Anya |
| Privacy & compliance — the exact redaction logic, scored without storing IP or PII | Theo with Rowan |
| Gateway architecture — asynchronous scoring that adds no latency to the user's request | Ellis |
| Evaluation pipeline — the LLM-as-a-judge grading intent, efficiency, model-matching | Theo |
| Data aggregation — usage and score metrics mapped to the HRIS org structure | Rowan |
| Executive consumption — widget-based, embeddable, legible to non-technical readers | Iris with Mina |
| The literacy score — a grading system an executive reads instantly | Iris with Noor |
| Actionable insights — a low score always guides toward the fix | Iris with Mina |

A definition task is sequenced before the build that depends on it: Noor defines a
metric and Theo defends how it is computed before Mina renders it.

Marcus reviews every diff. Branch protection, CI, and the daily diff budget are
unchanged by this product line.

## Standing backlog themes

1. **Benchmarking** — internal team-vs-team comparison; external anonymized cohort
   quartiles with an explicit method note on how anonymization works.
2. **Evaluation pipeline** — a documented judge rubric, scored fixtures, and
   agreement checks so a score can be defended when a director disputes it.
3. **Gateway design** — the asynchronous scoring path, sampling strategy, and the
   latency budget it must never spend.
4. **Integration contracts** — the request and response shapes for HRIS sync and
   each provider's usage export, as fixtures and documentation.
5. **Trends** — period-over-period movement, so a literacy score becomes a trajectory
   rather than a snapshot.
6. **Drill-down** — one department's detail view: its teams, its query mix over time,
   and the specific training gap behind its score.
