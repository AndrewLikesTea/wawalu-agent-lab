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
