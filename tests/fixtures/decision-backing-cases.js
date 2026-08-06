// Labelled cases for the decision-backing rule set.
//
// Each case carries the record, the verdict string a reader must see, the rule
// that produced it, and the checks either side of the line. The expectations
// are written out rather than derived: a fixture that computes its own answer
// from the code it is testing agrees with every bug that code has.
//
// The cases are grouped the way the rules are argued about: one complete
// record, each single gap on its own, the multi-gap cases that prove the
// priority order breaks every tie, and the blank/absent shapes a stored or
// imported record actually arrives in.

const BACKED_ONE = "Backed: owner, context, 1 alternative, 1 release.";
const BACKED_TWO_ONE = "Backed: owner, context, 2 alternatives, 1 release.";
const NEXT_OWNER = "Not fully backed. Next: name an owner for this decision.";
const NEXT_CONTEXT = "Not fully backed. Next: record dated context for this decision.";
const NEXT_ALTERNATIVES = "Not fully backed. Next: record at least one alternative that was considered.";
const NEXT_RELEASE = "Not fully backed. Next: link the release that carried this decision.";

// One release, shaped the way shippedState composes it. Only the state and the
// entry count are read, so the entries carry nothing a scorer must not see.
const shippedOnce = () => ({
  state: "shipped",
  entries: [{ id: "r-1", version: "v1.0.0" }],
  newest: { id: "r-1", version: "v1.0.0" },
  others: 0,
});

// An association whose release record could not be read. It is deliberately not
// a release: a broken link must not stand in for evidence.
const unresolved = () => ({ state: "unresolved", entries: [], newest: null, others: 0 });

const backedDecision = () => ({
  id: "queue",
  title: "Adopt a durable queue",
  owner: "Kai",
  context: "Retries are required before the next launch.",
  alternatives: "Poll the database.",
  createdAt: "2026-01-01T00:00:00.000Z",
});

/** A composed history record, with named overrides on the decision. */
const record = (overrides = {}, shipped = shippedOnce()) => ({
  type: "decision",
  decision: { ...backedDecision(), ...overrides },
  shipped,
});

export const DECISION_BACKING_CASES = [
  {
    label: "fully backed, one alternative and one release",
    record: record(),
    expected: {
      verdict: BACKED_ONE,
      state: "backed",
      ruleId: "backing/complete",
      nextAction: null,
      passed: ["owner", "context", "alternatives", "release"],
      failed: [],
    },
  },
  {
    label: "fully backed, a structured comparison of two alternatives",
    record: record({ alternatives: [{ name: "Poll the database" }, { name: "In-process retries" }] }),
    expected: {
      verdict: BACKED_TWO_ONE,
      state: "backed",
      ruleId: "backing/complete",
      nextAction: null,
      passed: ["owner", "context", "alternatives", "release"],
      failed: [],
    },
  },
  {
    label: "only the owner is missing",
    record: record({ owner: undefined }),
    expected: {
      verdict: NEXT_OWNER,
      state: "incomplete",
      ruleId: "backing/missing-owner",
      nextAction: "Name an owner for this decision.",
      passed: ["context", "alternatives", "release"],
      failed: ["owner"],
    },
  },
  {
    label: "only the context is missing",
    record: record({ context: undefined }),
    expected: {
      verdict: NEXT_CONTEXT,
      state: "incomplete",
      ruleId: "backing/missing-context",
      nextAction: "Record dated context for this decision.",
      passed: ["owner", "alternatives", "release"],
      failed: ["context"],
    },
  },
  {
    label: "context is recorded but the entry carries no usable date",
    record: record({ createdAt: "sometime last spring" }),
    expected: {
      verdict: NEXT_CONTEXT,
      state: "incomplete",
      ruleId: "backing/missing-context",
      nextAction: "Record dated context for this decision.",
      passed: ["owner", "alternatives", "release"],
      failed: ["context"],
    },
  },
  {
    label: "only the alternatives are missing",
    record: record({ alternatives: undefined }),
    expected: {
      verdict: NEXT_ALTERNATIVES,
      state: "incomplete",
      ruleId: "backing/missing-alternatives",
      nextAction: "Record at least one alternative that was considered.",
      passed: ["owner", "context", "release"],
      failed: ["alternatives"],
    },
  },
  {
    label: "only the release is missing",
    record: record({}, { state: "none", entries: [], newest: null, others: 0 }),
    expected: {
      verdict: NEXT_RELEASE,
      state: "incomplete",
      ruleId: "backing/missing-release",
      nextAction: "Link the release that carried this decision.",
      passed: ["owner", "context", "alternatives"],
      failed: ["release"],
    },
  },
  {
    label: "an association exists but its release cannot be read, which is not a release",
    record: record({}, unresolved()),
    expected: {
      verdict: NEXT_RELEASE,
      state: "incomplete",
      ruleId: "backing/missing-release",
      nextAction: "Link the release that carried this decision.",
      passed: ["owner", "context", "alternatives"],
      failed: ["release"],
    },
  },
  {
    label: "owner and context both missing — owner outranks context",
    record: record({ owner: undefined, context: undefined }),
    expected: {
      verdict: NEXT_OWNER,
      state: "incomplete",
      ruleId: "backing/missing-owner",
      nextAction: "Name an owner for this decision.",
      passed: ["alternatives", "release"],
      failed: ["owner", "context"],
    },
  },
  {
    label: "context and alternatives both missing — context outranks alternatives",
    record: record({ context: undefined, alternatives: undefined }),
    expected: {
      verdict: NEXT_CONTEXT,
      state: "incomplete",
      ruleId: "backing/missing-context",
      nextAction: "Record dated context for this decision.",
      passed: ["owner", "release"],
      failed: ["context", "alternatives"],
    },
  },
  {
    label: "alternatives and release both missing — alternatives outrank the release",
    record: record({ alternatives: undefined }, { state: "none", entries: [], newest: null, others: 0 }),
    expected: {
      verdict: NEXT_ALTERNATIVES,
      state: "incomplete",
      ruleId: "backing/missing-alternatives",
      nextAction: "Record at least one alternative that was considered.",
      passed: ["owner", "context"],
      failed: ["alternatives", "release"],
    },
  },
  {
    label: "every field blank — a whitespace owner is not an owner",
    record: record(
      { owner: "   ", context: "", alternatives: "   ", createdAt: "" },
      { state: "none", entries: [], newest: null, others: 0 },
    ),
    expected: {
      verdict: NEXT_OWNER,
      state: "incomplete",
      ruleId: "backing/missing-owner",
      nextAction: "Name an owner for this decision.",
      passed: [],
      failed: ["owner", "context", "alternatives", "release"],
    },
  },
  {
    label: "every field null",
    record: record(
      { owner: null, context: null, alternatives: null, createdAt: null },
      { state: "none", entries: [], newest: null, others: 0 },
    ),
    expected: {
      verdict: NEXT_OWNER,
      state: "incomplete",
      ruleId: "backing/missing-owner",
      nextAction: "Name an owner for this decision.",
      passed: [],
      failed: ["owner", "context", "alternatives", "release"],
    },
  },
  {
    label: "an empty comparison array is no alternatives, not one",
    record: record({ alternatives: [] }),
    expected: {
      verdict: NEXT_ALTERNATIVES,
      state: "incomplete",
      ruleId: "backing/missing-alternatives",
      nextAction: "Record at least one alternative that was considered.",
      passed: ["owner", "context", "release"],
      failed: ["alternatives"],
    },
  },
  {
    label: "a record with nothing on it at all",
    record: { type: "decision", decision: {}, shipped: undefined },
    expected: {
      verdict: NEXT_OWNER,
      state: "incomplete",
      ruleId: "backing/missing-owner",
      nextAction: "Name an owner for this decision.",
      passed: [],
      failed: ["owner", "context", "alternatives", "release"],
    },
  },
];

export { backedDecision, record as backingRecord, shippedOnce };
