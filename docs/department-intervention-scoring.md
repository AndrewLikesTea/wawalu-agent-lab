# Department intervention scoring

`src/department-intervention-scoring.js` answers one question for one
department: **what single thing should this team do next, and what is it worth?**

It is a pure function of a department's *aggregate* record. No clock, no
randomness, no network, no prompt text. The same input gives the same answer
every time, and `provenance.inputDigest` is the handle for saying so when two
people disagree about a number.

Scope: this module ranks interventions. It does not grade. The literacy score, the
category mix and the grading floor all come from the existing rubric
(`prompt-literacy-rubric.json` via `prompt-literacy-scoring.js`) and are consumed
here unchanged.

## Executive decision contract

The department drill-down answers these questions in order:

1. **Can this period support a decision?** A leader gets a named evidence
   shortfall, not a recommendation, when sampling or spend is unavailable.
2. **Is any intervention worth management attention?** A leader gets an explicit
   hold when no recoverable category exists or the best estimated value is below
   the materiality floor.
3. **Can one action be prioritized honestly?** A leader gets either one action or
   a named ambiguity. The scorer does not silently break a close result.
4. **What makes that action the priority?** A recommendation states the aggregate
   pattern, its denominator, the full value arithmetic, the weakest confidence
   factor, and reproducibility provenance.

The view deliberately leaves out prompt text, examples, conversation identifiers,
individual or team rankings, implementation steps, vendor/model selection,
intervention operating cost, realized savings, and a second-best recommendation.
Those fields do not answer which single intervention to prioritize from the
available aggregate evidence. Operating cost and reversibility become a separate
leader judgment only when the scorer returns ambiguity.

## Output contract

`scoreDepartmentIntervention(record)` returns a frozen object with exactly one of
four outcomes.

| Field | Always present | Notes |
| --- | --- | --- |
| `version` | yes | `department-intervention/1.0.0` |
| `outcome` | yes | `recommended` \| `ambiguous` \| `insufficient_evidence` \| `hold` |
| `department` | yes | `{ id, label }` — a roster slug and a checked roster label |
| `recommendation` | only when `recommended` | see below |
| `candidates` | yes (empty when evidence is insufficient) | every candidate, with its arithmetic |
| `provenance` | yes | scorer version, rubric version, sample size, basis, input digest |
| `reason` | only when *not* `recommended` | `{ code, text }` |
| `redaction` | yes | the promise, and the input allowlist |

A `recommendation` carries the five things an executive view needs and nothing
else:

1. **One prioritized action** — `kind`, `title`, `action`.
2. **Estimated monthly value** — `estimatedMonthlyValueUsd`, a whole-dollar integer.
3. **Confidence** — `{ level, factors }`, where `level` is the *weakest* factor.
4. **Provenance** — on the result, not the recommendation: one line for all four outcomes.
5. **Pattern-level rationale** — the pattern, its share of scored prompts, the
   arithmetic as a string, and the assumption behind the weight that produced it.

## The weights, and the assumption behind each

Value for a candidate is:

```
monthly spend × category share × recoverable share × attainment × addressable
```

`monthly spend` restates the period's spend to a 30-day month.
**ASSUMPTION:** a 30-day month. Drill-down periods run 28–31 days, so this moves
a figure by at most ~7%, and the restated number is printed in the arithmetic
rather than hidden inside the result.

`category share` is the department's normalized mix — not re-derived here.

`recoverable share` is **not declared in this module**. It is read from
`QUERY_CATEGORIES` in `src/evolution.js`, so "how much of this slice is
recoverable at all" keeps one definition across the product: over-provisioned
0.7, inefficient 0.4, out-of-scope 1.0.

`attainment` is what this module adds: of the recoverable slice, how much a
*specific* intervention actually lands.

| Kind | Category | Attainment | Addressable | Assumption behind the weight |
| --- | --- | --- | --- | --- |
| `routing` | over-provisioned | **0.90** | 1 | Down-routing is a gateway rule, not a behaviour change. Nobody has to be persuaded, so it lands on nearly all of the recoverable slice; the 10% held back is prompts a router misclassifies and escalates. |
| `rewrite` | inefficient | **0.60** | `repeatedShapeShare` | A template lands quickly for the shapes it covers, but people paste around it. Six in ten of the repeats it targets are held; the rest drift back to hand-written prompts within the quarter. |
| `training_gap` | inefficient | **0.35** | `1 − repeatedShapeShare` | Taught behaviour decays. Roughly a third of a diffuse retry gap closes and stays closed over a quarter — deliberately the lowest attainment in the table, so coaching never outranks a mechanical fix addressing the same dollars. |
| `access_policy` | out-of-scope | **0.80** | 1 | A policy block is mechanical like routing, but adversarial — some traffic moves to a shape the policy does not match. Scored below routing for that reason, never above it. |

`rewrite` and `training_gap` split the same category. The split is driven by one
aggregate signal, `patterns.repeatedShapeShare`: the share of a department's
retry chains that repeat a single prompt *shape* (a length band, an intent class,
a model tier and a rubric signal — never text). Concentrated retries have a
template to write; diffuse ones do not. The crossover sits at
`0.6r = 0.35(1 − r)`, i.e. **r ≈ 0.37**.

When that signal is missing, the two candidates are scored as an **interval**
rather than a point: `valueUsd` is `null` and only the ceiling (`maxValueUsd`, at
`addressable = 1`) is reported. An unmeasured candidate cannot lead — but it can
still block a leader with its ceiling, which is what keeps a partial answer
honest.

### Thresholds

| Constant | Value | Assumption |
| --- | --- | --- |
| `MIN_SCORED_PROMPTS_FOR_INTERVENTION` | `MIN_SCORED_PROMPTS` (25) | An intervention should not be recommended off a sample too thin to publish a grade from. Borrowed, not re-declared, so nobody meets a second and quieter floor. |
| `MIN_MATERIAL_MONTHLY_USD` | 150 | An intervention costs a manager roughly half a day to schedule and chase. Below this it spends more attention than it returns, and an executive who acts on three learns to ignore the fourth. |
| `AMBIGUITY_RELATIVE_MARGIN` | 0.10 | The mix is estimated from a few hundred scored prompts, so its per-category share carries several points of sampling error. A gap under 10% of the leader is inside that error. |
| `AMBIGUITY_ABSOLUTE_MARGIN_USD` | 250 | Stops the relative rule from calling a $40-vs-$38 photo finish meaningful on a small department. |

## Order of decision

Checked in this order, and the order matters:

1. `sampling.status !== "available"` → `insufficient_evidence` / `sampling_unavailable`
2. `sampledQueries < 25` → `insufficient_evidence` / `sample_below_floor` (shortfall named in whole prompts)
3. monthly spend ≤ 0 → `insufficient_evidence` / `no_spend`
4. no candidate has recoverable spend → `hold` / `no_recoverable_spend`
5. leader worth < $150/month → `hold` / `below_material_threshold`
6. any rival within the margin → `ambiguous` / `candidates_not_separated`, **both named**
7. otherwise → `recommended`

Materiality (5) is checked **before** ambiguity (6) deliberately: whether two
sub-threshold candidates are separated is a question about numbers nobody should
act on either way.

`sampledQueries` means the non-negative integer count of prompts included in the
category mix denominator. A fractional, negative, missing, or non-finite value is
invalid sampling metadata and normalizes to unavailable; it is never rounded
across the floor.

A measured candidate blocks with its `valueUsd`; only an unmeasured one gets to
argue from its ceiling. Using the ceiling for both would let a candidate the
signals already priced at $270 block a $2,993 winner — not caution, but refusing
to answer a question the evidence answered.

## Confidence

Three factors, each reported with its own detail line:

- **sample** — 400+ scored prompts reads high, 120+ medium, otherwise low.
- **separation** — the leader's margin over the strongest rival's blocking
  value: a measured rival uses its point value; an unmeasured rival uses its
  ceiling. A 50%+ margin reads high and 20%+ reads medium.
- **completeness** — high when every pattern signal the table reads was supplied.

`confidence.level` is the **weakest** of the three, never an average. A
5,000-prompt sample cannot rescue a near-tie, and reporting "high" because two of
three factors were high is exactly how an unexplainable number reaches an
executive view. The rendered field names the factor that capped it, so the next
question — "what would make this high?" — has an answer on the same line.

## The redaction boundary

`ALLOWED_INPUT_FIELDS` is a **closed allowlist**. `normalizeInterventionInput`
copies those fields off the caller's object and drops everything else, at every
depth, before any scoring happens. A key not on the list never reaches the
scorer's working state, so no extra payload on a department record can carry
prompt text into a score, a persisted value or a rendered field.

The only string that crosses the boundary is the department's **org-roster
label**. It is checked as if it were hostile:

- whitespace collapses to single word breaks;
- charset is `A-Za-z0-9 &,.-/'()` — what an org chart uses, nothing more;
- more than 6 words or more than 64 characters is prose, not a department name.

A rejected label becomes `"This department"`. It is never an input to any number,
so a bad label costs one heading and no arithmetic.

`tests/department-intervention-scoring.test.js` asserts the boundary rather than
describing it: a record salted with prompt bodies in every plausible field scores
byte-identically to the clean one, and the sentinel appears nowhere in the result
or the rendered fields. `tests/department-intervention-drilldown.test.js` runs the
same check through the real page.

## Fixtures and agreement

`src/department-intervention-fixtures.js` holds thirteen synthetic,
aggregate-only cases. Each declares the outcome — and where there is one, the
kind — that a reviewer says the aggregate warrants, written from the pattern the
case represents rather than from the arithmetic.

The agreement check reports **all** disagreements from one run: one disagreement
is a bug, four is a weight that moved, and a reviewer needs to tell those apart.

Coverage is deliberate: two cases per named kind at different scales, one for
leakage (so leakage is never misattributed to a coaching failure), two ambiguity
routes (missing split signal; two determined candidates inside the margin), one
case per insufficient-evidence code, and one hold.

## Where it renders

`src/department-intervention-view.js` maps a result onto the twelve slots
`#action-result` already paints in `src/evolution.html`. No new markup, no new
CSS, no new vocabulary.

`renderDecisionDetail` in `src/evolution-page.js` calls it **only when the
fixture carries no reviewed intervention**. A reviewed result is never
overwritten by a computed one, and a computed one is distinguishable by what its
status, provenance and realized fields say:

- status reads `Computed recommendation · not yet reviewed`;
- provenance carries the scorer version and the input digest that produced the numbers;
- realized says plainly that nothing has been simulated.

`data-status` reuses the existing `planned` treatment for a recommendation and
`unavailable` for the three outcomes that carry none.

## Known limits

- The attainment weights are **stated priors, not measured outcomes**. Nothing in
  this repository has yet observed a down-routing rule or a workshop and
  reconciled the estimate against a realized saving. Every figure is labelled
  `Computed recommendation · not yet reviewed` for that reason, and the honest
  next step is a reconciliation fixture that scores the estimate against the
  realized number the way `monthly-savings-reconciliation.js` does for savings.
- `patterns.repeatedShapeShare` is not yet produced by the bundled pipeline, so
  every bundled department scores with `completeness: medium` at best. The
  aggregate sketch signatures in `conversation-literacy.js` are where it should
  come from.
- The ambiguity margin is a flat 10%, not the department's own sampling
  uncertainty, which `departmentPerformance` already computes. Using the real
  interval would be strictly better and is a follow-up, not a defect of the rule.
