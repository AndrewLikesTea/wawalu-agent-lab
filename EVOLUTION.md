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

| Directive from the brief | Owner |
|---|---|
| Define the C-suite dashboard; it answers "are we wasting money?" in five seconds | Sam (EM) with Priya |
| Integration strategy — the endpoint contracts for Workday, Bedrock, OpenAI, Anthropic | Priya (staff) |
| Privacy & compliance — the exact redaction logic, scored without storing IP or PII | Rowan (backend) |
| Gateway architecture — asynchronous scoring that adds no latency to the user's request | Ellis (infra) |
| Evaluation pipeline — the LLM-as-a-judge grading intent, efficiency, model-matching | Rowan (backend) |
| Data aggregation — token and score metrics mapped to the HRIS org structure | Rowan (backend) |
| Executive consumption — widget-based, embeddable, legible to non-technical readers | Mina (frontend) |
| The literacy score — a grading system an executive reads instantly | Mina with Priya |
| Actionable insights — a low score always guides toward the fix | Mina (frontend) |

Design and product-management responsibilities currently sit with Mina (interaction,
visual system, accessibility) and Sam (dashboard definition, scope, sequencing);
dedicated designer and PM personas are a possible future addition to the team.

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
