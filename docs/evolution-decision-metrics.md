# Evolution executive decision contract

This static demo answers three questions, in order:

1. **Which department needs help?** Rank departments with eligible samples by
   lowest department performance score; break ties by higher recoverable spend,
   then preserve fixture order. Departments with unavailable sampling follow
   eligible departments and show no score. This view deliberately omits
   individual employees, provider/model controls, and arbitrary sorting because
   none changes the intervention decision.
2. **Is that department's cost/performance trend worsening?** Compare the
   selected department's current period with the immediately preceding
   equal-length period. Show cost and performance together. This view deliberately
   omits forecasts and causal claims; two synthetic periods establish direction,
   not cause.
3. **How does it compare with the defined benchmark, and what supports that
   conclusion?** Compare the selected score with the median of the named,
   synthetic cohort and show only that department's scored evidence. This view
   deliberately omits percentile theater and live “industry” claims.

## Exact metric definitions

- **Department performance score:** use rubric `literacy-mix/1.0.0`. Normalize
  the non-negative category counts/shares to sum to one, then compute
  `100×highValue + 55×overProvisioned + 35×inefficient + 0×outOfScope`.
  Round the sum once to the nearest integer. The score is available only when
  `sampling.status` is `available`, `sampledQueries` is a positive integer, and
  the normalized mix has a positive denominator.
- **Benchmark comparator:** `department performance score − cohort median score`,
  in score points. It is available only when the department score exists, the
  cohort median is finite, and both use the same rubric version. The fixture
  states cohort name, organization count, segment, snapshot date, and provenance.
- **Cost trend:** compare current spend with the immediately preceding
  equal-length period as `(current − prior) ÷ prior × 100`, rounded to one
  decimal. A missing, non-finite, or zero prior spend is unavailable.
- **Performance trend:** current eligible score minus the stored prior-period
  eligible score, in integer score points. “Worsening” means current spend is
  higher **and** current performance is lower; otherwise it is “not jointly
  worsening.” Missing either comparison yields “unavailable,” not “flat.”
- **Uncertainty:** a 95% normal-approximation margin of error for the sampled
  mean of category weights:
  `1.96 × sqrt(sum(pᵢ × (weightᵢ − unrounded mean)²) ÷ sampledQueries)`.
  Report in score points, rounded to one decimal. It describes sampling
  precision only; it does not cover rubric validity, judge bias, or fixture
  realism.
- **Sample freshness:** show `sampledThrough` as an absolute date and the fixture's
  `freshnessLabel`. No browser-clock-dependent “days ago” claim is used, so the
  bundled demo remains reproducible. A stale label is a warning, not permission
  to silently remove the sample.
- **Unavailable sampling:** when sampling is explicitly unavailable, the sample
  count is not positive, or the mix denominator is zero, show the fixture reason.
  Do not compute score, uncertainty, trend performance, benchmark delta, or
  evidence conclusions. Cost can still be shown if its independent billing
  fixture exists.

## Acceptance criteria as leader questions

- A CTO can identify the first eligible department needing help without choosing
  a sort mode and can distinguish unavailable data from poor performance.
- After selecting a department, a CTO can tell whether cost rose, performance
  fell, and whether both worsened over explicitly named equal-length periods.
- A CTO can tell how many score points the department is above/below the named
  cohort median and can inspect the cohort method.
- Supporting evidence contains only records whose `departmentId` matches the
  selected department. An empty eligible sample says no evidence was retained;
  unavailable sampling explains why no conclusion can be drawn.
- The department, trend, benchmark, and evidence surfaces state synthetic
  provenance, rubric version, sample freshness, and sampling uncertainty whenever
  a score is present.

## Synthetic action-plan contract

The already-consumed `evolution-demo-data.json` fixture includes
`actionPlan` version `action-plan/1.0.0`. It answers one additional contract
question without adding a view: **What is the one evidence-backed next action
for each eligible department, who owns it, what could it save, and how will the
same result be checked after an equal period?**

An eligible department has available sampling and at least one retained evidence
record. Mobile has no retained evidence and Security Engineering has unavailable
sampling, so neither receives an action. Creating recommendations for them would
present unsupported surface as evidence. Within each included department,
ascending `priorityRank` then `actionId` is the deterministic order; exactly one
record has rank 1 and `isTopNextAction: true`.

The action baseline and target use only `recoverable_spend_usd`, defined as:

`round(spendUsd × (0.70 × normalized overProvisioned + 0.40 × normalized inefficient + 1.00 × normalized outOfScope))`

Normalize the four non-negative category values by their sum, and round only the
final USD result to the nearest whole dollar. Estimated action savings is the
largest single recoverable category using the same inputs and established
recoverability factor. The target is baseline recoverable spend minus estimated
action savings. It is a synthetic planning threshold, not realized savings.

Tracking compares that identical metric and department scope over the existing
31-day baseline and a defined, contiguous 31-day successor period. The after
value is `null` with status `pending`; consumers must not convert missing
measurement to zero. The historical reference reuses the existing immediately
preceding 31-day fixture period. This contract deliberately leaves out UI,
forecasts, causal claims, live integrations, model behavior, employee detail,
and actions for departments without retained evidence.

## Reproducible action-outcome scoring

`action-outcome/1.0.0` classifies the bundled labelled fixtures without a
provider, HRIS, customer, or browser-clock dependency. Its output is the
UI-facing contract: outcome code and label, projected and realized USD,
variance, attainment percentage, tolerance, confidence explanation, priority,
evidence references, and provenance.

- An observed result meets target when `realized + tolerance >= projected`.
  Tolerance is the greater of 5% of a non-zero projection or $100. The 5%
  assumption covers ordinary measurement noise; the $100 floor covers
  whole-dollar aggregation noise for small actions. Neither is intended to hide
  a material miss.
- A zero projection has zero tolerance and a `null` attainment percentage,
  because dividing by zero would create an unexplainable metric.
- A missing or non-observed result is `awaiting_result`, never zero savings.
- Confidence below 0.75 changes an otherwise observed outcome to
  `low_confidence`. The threshold assumes an executive claim needs at least
  three quarters of its stated support. It is a disclosure gate, not a
  calibrated probability.
- When confidence signals conflict, the lowest valid signal wins. Averaging
  could conceal weak retained evidence behind a strong aggregate assertion. The
  numerical comparison remains in `comparisonCode` so the override is auditable.
- Priority is authored evidence: ascending `priorityRank`, then `actionId`.
  Outcome results never reshuffle the action queue.

Every fixture references IDs already present in `evolution-demo-data.json`.
Raw fixture prompts are untrusted. `scoreActionOutcome` omits them and exposes
only `judgeInput.prompt` after `redactForScoring`, so a judge-facing consumer
cannot accidentally select the raw field.
