// Labelled fixtures for the decision-confidence grade (issue #1188).
//
// Checked in rather than built inside one test, because these records are the
// evidence that a graded verdict is reproducible: a change to the rule order or
// to a verdict string has to change a stated expectation here, in the same
// review, and cannot be absorbed by a test that recomputes what it asserts.
//
// Each fixture states the whole expected result — the verdict, the next action,
// which checks failed, and which rule decided — as literal strings. No
// expectation is derived from the module under test.
//
// `failing` is written in the module's rule order; a fixture whose record is
// fully backed states an empty list.

const RECORDED_AT = "2026-03-04T09:00:00.000Z";

/** The payload the rendering test asserts is escaped rather than executed. */
export const ADVERSARIAL_OWNER = "<img src=x onerror=alert(1)>";

/** A second payload, carrying the quote and ampersand characters as well. */
export const ADVERSARIAL_ALTERNATIVE = "\"Do nothing\" & <img src=y onerror=alert(2)>";

const base = {
  id: "fixture-decision",
  title: "Adopt a read-through cache",
  context: "Read latency spikes past 400ms under load.",
  alternatives: ["Query tuning alone", "Bigger instances"],
  owner: "Priya",
  status: "accepted",
  createdAt: RECORDED_AT,
};

// A composed history record hands the score its releases already resolved, the
// way renderHistory does. A fixture that names no release still carries the
// "nothing shipped it" shape rather than omitting the field.
const shipped = (versions) => ({
  state: versions.length ? "shipped" : "none",
  entries: versions.map((version, index) => ({ id: `rel-${index + 1}`, version })),
  newest: null,
  others: Math.max(0, versions.length - 1),
});

const record = (overrides = {}, versions = ["v2.1.0"]) => ({
  decision: { ...base, ...overrides },
  shipped: shipped(versions),
});

export const DECISION_CONFIDENCE_FIXTURES = Object.freeze([
  {
    label: "fully backed: owner, dated context, two alternatives, one release",
    record: record(),
    expected: {
      verdict: "Backed: owner, context, 2 alternatives, 1 release",
      nextAction: null,
      ruleId: "backed:all-checks-pass",
      failing: [],
    },
  },
  {
    label: "backed with exactly one alternative and one release: singular wording",
    record: record({ alternatives: ["Query tuning alone"] }),
    expected: {
      verdict: "Backed: owner, context, 1 alternative, 1 release",
      nextAction: null,
      ruleId: "backed:all-checks-pass",
      failing: [],
    },
  },
  {
    label: "owner alone missing",
    record: record({ owner: "   " }),
    expected: {
      verdict: "Needs an owner before this is quotable",
      nextAction: "Record who owns this decision.",
      ruleId: "first-gap:owner",
      failing: ["owner"],
    },
  },
  {
    label: "context alone missing",
    record: record({ context: "" }),
    expected: {
      verdict: "Needs a dated context entry before this is quotable",
      nextAction: "Record the context behind this decision on a record with a readable date.",
      ruleId: "first-gap:context",
      failing: ["context"],
    },
  },
  {
    label: "context present but the record carries no readable date",
    record: record({ createdAt: "sometime last spring" }),
    expected: {
      verdict: "Needs a dated context entry before this is quotable",
      nextAction: "Record the context behind this decision on a record with a readable date.",
      ruleId: "first-gap:context",
      failing: ["context"],
    },
  },
  {
    label: "alternatives alone missing",
    record: record({ alternatives: [] }),
    expected: {
      verdict: "Needs a considered alternative before this is quotable",
      nextAction: "Record at least one alternative that was considered and rejected.",
      ruleId: "first-gap:alternatives",
      failing: ["alternatives"],
    },
  },
  {
    label: "release alone missing",
    record: record({}, []),
    expected: {
      verdict: "Needs an associated release before this is quotable",
      nextAction: "Link the release that shipped this decision.",
      ruleId: "first-gap:release",
      failing: ["release"],
    },
  },
  {
    label: "all four missing: only the owner gap is named",
    record: record({ owner: "", context: "", alternatives: [], createdAt: "" }, []),
    expected: {
      verdict: "Needs an owner before this is quotable",
      nextAction: "Record who owns this decision.",
      ruleId: "first-gap:owner",
      failing: ["owner", "context", "alternatives", "release"],
    },
  },
  {
    label: "context and release missing, owner and alternatives present: context is named",
    record: record({ context: "" }, []),
    expected: {
      verdict: "Needs a dated context entry before this is quotable",
      nextAction: "Record the context behind this decision on a record with a readable date.",
      ruleId: "first-gap:context",
      failing: ["context", "release"],
    },
  },
  {
    label: "alternatives and release missing: alternatives is named",
    record: record({ alternatives: [] }, []),
    expected: {
      verdict: "Needs a considered alternative before this is quotable",
      nextAction: "Record at least one alternative that was considered and rejected.",
      ruleId: "first-gap:alternatives",
      failing: ["alternatives", "release"],
    },
  },
  {
    label: "an unreadable association is not evidence: dangling release only",
    record: { decision: { ...base }, shipped: { state: "unresolved", entries: [], newest: null, others: 0 } },
    expected: {
      verdict: "Needs an associated release before this is quotable",
      nextAction: "Link the release that shipped this decision.",
      ruleId: "first-gap:release",
      failing: ["release"],
    },
  },
  {
    label: "adversarial: markup and quote characters in owner, alternative, and release",
    record: record(
      {
        owner: ADVERSARIAL_OWNER,
        alternatives: [ADVERSARIAL_ALTERNATIVE, "Ben & Co's \"cheap\" option"],
      },
      ["<b>v9</b>"],
    ),
    expected: {
      // The record is complete, so it grades as backed: hostile content is not a
      // gap. The verdict is built from counts, so nothing from the record
      // reaches this string at all.
      verdict: "Backed: owner, context, 2 alternatives, 1 release",
      nextAction: null,
      ruleId: "backed:all-checks-pass",
      failing: [],
    },
  },
]);

/** The adversarial fixture, by label, for the tests that render it. */
export const ADVERSARIAL_FIXTURE = DECISION_CONFIDENCE_FIXTURES.find(
  (fixture) => fixture.label.startsWith("adversarial"),
);
