// Labelled fixtures for the department-intervention scorer.
//
// Every case here is synthetic and aggregate-only. There is no prompt text, no
// excerpt, no conversation id and no real department in this file, and the
// scorer could not read one if there were — see `ALLOWED_INPUT_FIELDS`.
//
// A fixture is a *label*, not a snapshot. Each case declares the outcome and,
// where there is one, the intervention kind a human reviewer says the aggregate
// warrants — written before the arithmetic was run, from the pattern the case is
// built to represent. `tests/department-intervention-scoring.test.js` is the
// agreement check between those labels and the rule. When the rule and a label
// disagree, one of them is wrong and the disagreement is the finding.
//
// Deliberately covered, because these are the cases a director disputes:
//
//   - each of the three named recommendation kinds, twice, at different scales;
//   - the fourth kind (`access_policy`), so leakage is never misattributed to
//     a coaching or routing failure;
//   - two ambiguous cases — one where the split signal is missing, one where two
//     fully determined candidates land inside the margin;
//   - three insufficient-evidence cases, one per named shortfall;
//   - a hold, where the arithmetic works and the answer is still "do nothing".
//
// `expect.kind` is null wherever the outcome carries no recommendation.

/** Bump alongside a fixture edit so a stale expectation cannot pass quietly. */
export const INTERVENTION_FIXTURES_VERSION = "department-intervention-fixtures/1.0.0";

const sampling = (sampledQueries, status = "available") =>
  ({ status, sampledQueries });

export const DEPARTMENT_INTERVENTION_FIXTURES = Object.freeze([
  // --- routing -------------------------------------------------------------
  Object.freeze({
    id: "routing-large-frontier-overuse",
    note: "A third of scored prompts are simple tasks on a frontier model. "
      + "Mechanical fix, large spend, nothing else close.",
    expect: Object.freeze({ outcome: "recommended", kind: "routing" }),
    input: Object.freeze({
      departmentId: "fx-routing-1",
      departmentLabel: "Platform Engineering",
      spendUsd: 60000, periodDays: 30,
      mix: { highValue: 0.55, overProvisioned: 0.33, inefficient: 0.08, outOfScope: 0.04 },
      sampling: sampling(900),
      patterns: { repeatedShapeShare: 0.5 },
    }),
  }),
  Object.freeze({
    id: "routing-small-team-clear-signal",
    note: "Small department, but over-provisioning dominates every rival "
      + "ceiling — scale must not change the answer, only the confidence.",
    expect: Object.freeze({ outcome: "recommended", kind: "routing" }),
    input: Object.freeze({
      departmentId: "fx-routing-2",
      departmentLabel: "Mobile",
      spendUsd: 14000, periodDays: 28,
      mix: { highValue: 0.5, overProvisioned: 0.4, inefficient: 0.06, outOfScope: 0.04 },
      sampling: sampling(140),
      patterns: { repeatedShapeShare: 0.4 },
    }),
  }),

  // --- rewrite -------------------------------------------------------------
  Object.freeze({
    id: "rewrite-concentrated-retry-chains",
    note: "Retry chains dominate and four in five repeat one shape, so a "
      + "template reaches most of the waste. Rewrite, not a workshop.",
    expect: Object.freeze({ outcome: "recommended", kind: "rewrite" }),
    input: Object.freeze({
      departmentId: "fx-rewrite-1",
      departmentLabel: "Frontend Experience",
      spendUsd: 45000, periodDays: 30,
      mix: { highValue: 0.42, overProvisioned: 0.05, inefficient: 0.5, outOfScope: 0.03 },
      sampling: sampling(620),
      patterns: { repeatedShapeShare: 0.8 },
    }),
  }),
  Object.freeze({
    id: "rewrite-fully-templated-gap",
    note: "Every retry chain repeats the same shape. The addressable share is "
      + "1, which is the strongest case a template can have.",
    expect: Object.freeze({ outcome: "recommended", kind: "rewrite" }),
    input: Object.freeze({
      departmentId: "fx-rewrite-2",
      departmentLabel: "QA & Release",
      spendUsd: 22000, periodDays: 31,
      mix: { highValue: 0.55, overProvisioned: 0.04, inefficient: 0.38, outOfScope: 0.03 },
      sampling: sampling(430),
      patterns: { repeatedShapeShare: 1 },
    }),
  }),

  // --- training gap --------------------------------------------------------
  Object.freeze({
    id: "training-gap-diffuse-retry-chains",
    note: "The same retry volume as the rewrite cases, spread across many "
      + "distinct shapes. No template to write; the gap is the people.",
    expect: Object.freeze({ outcome: "recommended", kind: "training_gap" }),
    input: Object.freeze({
      departmentId: "fx-training-1",
      departmentLabel: "Data Science",
      spendUsd: 45000, periodDays: 30,
      mix: { highValue: 0.42, overProvisioned: 0.05, inefficient: 0.5, outOfScope: 0.03 },
      sampling: sampling(620),
      patterns: { repeatedShapeShare: 0.05 },
    }),
  }),
  Object.freeze({
    id: "training-gap-no-repeated-shapes",
    note: "Not one retry chain repeats. The template candidate is worth zero, "
      + "so coaching wins outright rather than by a margin.",
    expect: Object.freeze({ outcome: "recommended", kind: "training_gap" }),
    input: Object.freeze({
      departmentId: "fx-training-2",
      departmentLabel: "Site Reliability",
      spendUsd: 30000, periodDays: 30,
      mix: { highValue: 0.5, overProvisioned: 0.04, inefficient: 0.43, outOfScope: 0.03 },
      sampling: sampling(300),
      patterns: { repeatedShapeShare: 0 },
    }),
  }),

  // --- leakage, so it is never blamed on prompt skill -----------------------
  Object.freeze({
    id: "access-policy-leakage-dominates",
    note: "A fifth of scored prompts are non-business. Fully recoverable and "
      + "no prompt technique touches it; recommending coaching here would "
      + "blame the team for the wrong thing.",
    expect: Object.freeze({ outcome: "recommended", kind: "access_policy" }),
    input: Object.freeze({
      departmentId: "fx-policy-1",
      departmentLabel: "Field Operations",
      spendUsd: 40000, periodDays: 30,
      mix: { highValue: 0.65, overProvisioned: 0.06, inefficient: 0.09, outOfScope: 0.2 },
      sampling: sampling(500),
      patterns: { repeatedShapeShare: 0.5 },
    }),
  }),

  // --- ambiguous -----------------------------------------------------------
  Object.freeze({
    id: "ambiguous-missing-split-signal",
    note: "Routing leads on the point estimate, but with no repeated-shape "
      + "signal the template candidate's ceiling sits inside the margin. "
      + "The honest answer is that the sample cannot separate them.",
    expect: Object.freeze({ outcome: "ambiguous", kind: null }),
    input: Object.freeze({
      departmentId: "fx-ambiguous-1",
      departmentLabel: "Backend Platform",
      spendUsd: 40000, periodDays: 30,
      mix: { highValue: 0.59, overProvisioned: 0.1, inefficient: 0.27, outOfScope: 0.04 },
      sampling: sampling(700),
      patterns: {},
    }),
  }),
  Object.freeze({
    id: "ambiguous-determined-photo-finish",
    note: "Every signal is present and two candidates still land within a few "
      + "percent. A tie-break here would be false precision, not a decision.",
    expect: Object.freeze({ outcome: "ambiguous", kind: null }),
    input: Object.freeze({
      departmentId: "fx-ambiguous-2",
      departmentLabel: "Growth",
      spendUsd: 50000, periodDays: 30,
      mix: { highValue: 0.2, overProvisioned: 0.2, inefficient: 0.6, outOfScope: 0 },
      sampling: sampling(800),
      patterns: { repeatedShapeShare: 0.85 },
    }),
  }),

  // --- insufficient evidence -----------------------------------------------
  Object.freeze({
    id: "insufficient-sampling-unavailable",
    note: "The export omitted sampling metadata. The mix is unmeasured, so "
      + "every dollar figure would be invented.",
    expect: Object.freeze({ outcome: "insufficient_evidence", kind: null, code: "sampling_unavailable" }),
    input: Object.freeze({
      departmentId: "fx-insufficient-1",
      departmentLabel: "Security Engineering",
      spendUsd: 25000, periodDays: 30,
      mix: { highValue: 0.5, overProvisioned: 0.3, inefficient: 0.15, outOfScope: 0.05 },
      sampling: sampling(0, "unavailable"),
      patterns: { repeatedShapeShare: 0.5 },
    }),
  }),
  Object.freeze({
    id: "insufficient-sample-below-floor",
    note: "A sample exists and is under the floor the grade already uses. "
      + "A second, quieter floor would be indefensible.",
    expect: Object.freeze({ outcome: "insufficient_evidence", kind: null, code: "sample_below_floor" }),
    input: Object.freeze({
      departmentId: "fx-insufficient-2",
      departmentLabel: "Legal",
      spendUsd: 18000, periodDays: 30,
      mix: { highValue: 0.4, overProvisioned: 0.4, inefficient: 0.15, outOfScope: 0.05 },
      sampling: sampling(9),
      patterns: { repeatedShapeShare: 0.5 },
    }),
  }),
  Object.freeze({
    id: "insufficient-no-spend",
    note: "A graded sample against zero billed spend: nothing to recover, and "
      + "a percentage of nothing is not a recommendation.",
    expect: Object.freeze({ outcome: "insufficient_evidence", kind: null, code: "no_spend" }),
    input: Object.freeze({
      departmentId: "fx-insufficient-3",
      departmentLabel: "Design",
      spendUsd: 0, periodDays: 30,
      mix: { highValue: 0.4, overProvisioned: 0.4, inefficient: 0.2, outOfScope: 0 },
      sampling: sampling(400),
      patterns: { repeatedShapeShare: 0.5 },
    }),
  }),

  // --- hold ----------------------------------------------------------------
  Object.freeze({
    id: "hold-healthy-mix",
    note: "Almost everything is high-value. The arithmetic runs and the answer "
      + "is still that scheduling an intervention costs more than it returns.",
    expect: Object.freeze({ outcome: "hold", kind: null }),
    input: Object.freeze({
      departmentId: "fx-hold-1",
      departmentLabel: "Data & ML",
      spendUsd: 9000, periodDays: 30,
      mix: { highValue: 0.97, overProvisioned: 0.02, inefficient: 0.01, outOfScope: 0 },
      sampling: sampling(450),
      patterns: { repeatedShapeShare: 0.5 },
    }),
  }),
]);
