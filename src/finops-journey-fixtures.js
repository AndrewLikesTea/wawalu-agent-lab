// Five labelled, bundled journeys for the consolidated AI FinOps view.
//
// WHY THEY EXIST. A lead who disputes the one recommendation this view shows has
// nothing to argue with unless the same records can be put back in front of the
// same derivation and produce the same answer twice. These five are that: named
// records, a fixed clock, and a documented expected outcome each, so a contested
// score is reproduced by loading the example rather than by describing it.
//
// THEY ENTER THROUGH THE ORDINARY PATH, AND ONLY THROUGH IT. Each fixture is
// written into a browser-shaped store with the same writers the import screen
// uses — `writeMonthlyAction`, `retainCurrentReviewEvidence`,
// `captureJourneySnapshot` — and then read back with `restoreJourneySnapshot`,
// which is the one call the shipped surfaces make. There is no second pipeline
// here and no derivation of any kind: if a fixture disagrees with the product it
// is the fixture that is wrong, because it went through the product to get here.
//
// DETERMINISM IS THE POINT. Nothing below reads a clock, a locale, a time zone,
// a random source, or the network. Every date is a hardcoded ISO string and
// every `now` is injected, so two loads in two processes serialize byte for
// byte. A fixture that could drift would be evidence of nothing.
//
// PRIVACY. Invented organisations, invented services, and role titles rather
// than people. No address, no account number, no identifier, and no free text
// that could read as copied from a customer. What free text there is still
// travels through `neutralizeRecordText` on the way to the screen, exactly as a
// visitor's own records do — a bundled example is not a trusted input either.

import { captureJourneySnapshot, restoreJourneySnapshot } from "./finops-journey-snapshot.js";
import { consolidateJourney } from "./finops-journey-consolidated.js";
import { retainCurrentReviewEvidence } from "./recurring-review-readiness.js";
import { writeMonthlyAction } from "./monthly-department-action-store.js";

/** The day every fixture is evaluated against. Injected, never read as a clock. */
export const FIXTURE_NOW = "2026-07-15T09:00:00.000Z";

/** Provenance is data, not a sentence a view happens to paint. */
export const BUNDLED_EXAMPLE_KIND = "bundled-example";

const PROVENANCE_NOTE = "Invented records bundled with this app. Not your spend, "
  + "not your departments, and not realized savings.";

const freeze = Object.freeze;

const provenance = (label) => freeze({
  kind: BUNDLED_EXAMPLE_KIND, label, note: PROVENANCE_NOTE,
});

/**
 * One priced monthly decision, in the shape the decision surface hands the
 * store. Only the fields that differ between fixtures are parameters; the rest
 * are constant so two fixtures differ by exactly what their names say.
 */
const decision = ({
  actionId, actionLabel, department, ownerLabel, baselineValue, baselinePeriod,
  targetValue, deadline, reviewPeriod, confidence,
}) => freeze({
  version: "monthly-department-decision/1.0.0",
  action: freeze({ id: actionId, label: actionLabel }),
  department,
  ownerLabel,
  baseline: freeze({
    value: baselineValue,
    unit: "USD/month",
    period: baselinePeriod,
    aggregation: "Monthly recoverable spend for the department",
    calculation: "Sum of eligible row deltas in the bundled example analysis",
  }),
  target: freeze({
    value: targetValue,
    unit: "USD/month remaining avoidable spend",
    deadline,
    calculation: "Baseline minus the reduction the action is expected to hold",
  }),
  reviewPeriod,
  confidence: freeze({ value: confidence }),
  evidenceReferences: freeze([`fix-pack:${actionId}`, `analysis:${department.toLowerCase().replaceAll(" ", "-")}-${baselinePeriod}`]),
});

const analysis = (period, departments) => freeze({
  schemaVersion: "local-finops/1.0.0",
  period,
  rankedDepartments: freeze(departments.map(([name, recoverableUsd]) =>
    freeze({ name, recoverableUsd }))),
});

/** Theo's verdict as the evidence store already projects it: no headline shape. */
const verdict = (state, { measured = true, coveragePercent, rows, confidence }) =>
  freeze({ state, measured, coveragePercent, rows, confidence });

/* ------------------------------ the five ---------------------------------- */

/**
 * Nothing retained at all. The onboarding journey: one step, no figure, and no
 * recommendation borrowed from someone else's records.
 */
export const newReview = freeze({
  name: "newReview",
  title: "New review, nothing imported",
  provenance: provenance("Bundled example · new review"),
  evaluatedAt: FIXTURE_NOW,
  records: freeze({ decision: null, committedAt: null, analysis: null, verdict: null, importSource: null }),
});

/**
 * A retained action whose evidence never arrived, captured 181 days before the
 * reference day. Both layers are conservative for different reasons: the review
 * has no current analysis to compare, and the next-step contract refuses a
 * capture older than its ninety-day bound. This is the degraded fixture.
 */
export const incompleteEvidence = freeze({
  name: "incompleteEvidence",
  title: "Retained action, evidence missing and capture stale",
  provenance: provenance("Bundled example · incomplete evidence"),
  evaluatedAt: FIXTURE_NOW,
  records: freeze({
    decision: decision({
      actionId: "cache-relevance-embeddings",
      actionLabel: "Cache repeated relevance embeddings",
      department: "Vega Search Relevance",
      ownerLabel: "Search platform product owner",
      baselineValue: 2600,
      baselinePeriod: "2025-12",
      targetValue: 1900,
      deadline: "2026-02-28",
      reviewPeriod: "2025-12",
      confidence: "medium",
    }),
    committedAt: "2026-01-15T12:00:00.000Z",
    analysis: null,
    verdict: null,
    importSource: null,
  }),
});

/**
 * Three departments measured, one tracked. The boundary is the whole point: the
 * finding covers Vega only, and the larger Orion figure beside it is outside the
 * comparison rather than quietly folded into it.
 */
export const departmentDrillDown = freeze({
  name: "departmentDrillDown",
  title: "Three departments measured, one in scope",
  provenance: provenance("Bundled example · department drill-down"),
  evaluatedAt: FIXTURE_NOW,
  records: freeze({
    decision: decision({
      actionId: "route-relevance-lookups",
      actionLabel: "Route short relevance lookups to the standard model",
      department: "Vega Search Relevance",
      ownerLabel: "Search platform product owner",
      baselineValue: 4800,
      baselinePeriod: "2026-06",
      targetValue: 3600,
      deadline: "2026-12-31",
      reviewPeriod: "2026-06",
      confidence: "medium",
    }),
    committedAt: "2026-06-30T12:00:00.000Z",
    analysis: analysis("2026-07", [
      ["Orion Assistant Platform", 9100],
      ["Vega Search Relevance", 4100],
      ["Lyra Batch Analytics", 1500],
    ]),
    verdict: verdict("all_clear", { coveragePercent: 96.4, rows: 24, confidence: "high" }),
    importSource: null,
  }),
});

/**
 * A review carried across a navigation by the snapshot the import left behind,
 * on bounded rather than complete evidence: 82.5% attribution over twelve rows
 * is a moderate band by the verdict contract's own thresholds, and the journey
 * says so instead of rounding it up.
 */
export const resumedAction = freeze({
  name: "resumedAction",
  title: "Resumed review carried from a local import",
  provenance: provenance("Bundled example · resumed review"),
  evaluatedAt: FIXTURE_NOW,
  records: freeze({
    decision: decision({
      actionId: "batch-nightly-evaluation",
      actionLabel: "Batch the nightly evaluation run",
      department: "Orion Assistant Platform",
      ownerLabel: "AI platform product owner",
      baselineValue: 7400,
      baselinePeriod: "2026-06",
      targetValue: 5900,
      deadline: "2026-09-30",
      reviewPeriod: "2026-06",
      confidence: "high",
    }),
    committedAt: "2026-06-30T12:00:00.000Z",
    analysis: analysis("2026-07", [["Orion Assistant Platform", 6200]]),
    verdict: verdict("bounded_coverage", {
      coveragePercent: 82.5, rows: 12, confidence: "bounded",
    }),
    importSource: freeze({ files: freeze(["example-orion-2026-07.json"]), rows: 128 }),
    capturedAt: "2026-07-01T08:00:00.000Z",
  }),
});

/**
 * The expected effect of a committed action fell due on the reference day and
 * nothing has recorded whether it held. The one state where the checkpoint is
 * the answer rather than supporting detail.
 */
export const verificationReady = freeze({
  name: "verificationReady",
  title: "Committed action due for verification",
  provenance: provenance("Bundled example · verification ready"),
  evaluatedAt: FIXTURE_NOW,
  records: freeze({
    decision: decision({
      actionId: "route-long-context-lookups",
      actionLabel: "Route long-context lookups to the standard model",
      department: "Orion Assistant Platform",
      ownerLabel: "AI platform product owner",
      baselineValue: 7400,
      baselinePeriod: "2026-06",
      targetValue: 5900,
      deadline: "2026-07-15",
      reviewPeriod: "2026-06",
      confidence: "high",
    }),
    committedAt: "2026-06-30T12:00:00.000Z",
    analysis: analysis("2026-07", [
      ["Orion Assistant Platform", 6200],
      ["Lyra Batch Analytics", 1500],
    ]),
    verdict: verdict("all_clear", { coveragePercent: 97.2, rows: 31, confidence: "high" }),
    importSource: null,
  }),
});

export const BUNDLED_EXAMPLES = freeze({
  newReview, incompleteEvidence, departmentDrillDown, resumedAction, verificationReady,
});

/** Reading order on the picker: emptiest first, most complete last. */
export const BUNDLED_EXAMPLE_NAMES = freeze([
  "newReview", "incompleteEvidence", "departmentDrillDown", "resumedAction", "verificationReady",
]);

/* ---------------------------- loading them -------------------------------- */

/**
 * A `Storage`-shaped store held in memory.
 *
 * The journey reads records through `getItem`, so a store is all a fixture needs
 * to be indistinguishable from a browser to everything downstream. `entries`
 * exists for the round-trip check and is not part of the `Storage` interface the
 * product uses.
 */
export function memoryStorage(seed = []) {
  const map = new Map(seed);
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    entries: () => [...map.entries()].sort(([left], [right]) => left.localeCompare(right)),
  };
}

/**
 * One fixture, written into a store through the product's own writers.
 *
 * Every `now` is the fixture's own hardcoded string, so the records this
 * produces are byte-identical on every machine and in every time zone.
 */
export function bundledExampleStorage(fixture, storage = memoryStorage()) {
  const { decision: source, committedAt, analysis: currentAnalysis, verdict: theoVerdict,
    importSource, capturedAt } = fixture.records;
  if (source) writeMonthlyAction(storage, source, { now: new Date(committedAt) });
  if (currentAnalysis && theoVerdict) {
    retainCurrentReviewEvidence(storage, { currentAnalysis, theoVerdict });
  }
  if (importSource) {
    captureJourneySnapshot(storage, { importSource, now: new Date(capturedAt) });
  }
  return storage;
}

/**
 * The journey one bundled example produces, through the same restore the
 * shipped surfaces call.
 *
 * @param name one of `BUNDLED_EXAMPLE_NAMES`.
 * @param surface `"briefing"` or `"review"`, as `consolidateJourney` takes it.
 * @returns a frozen `finops-consolidated-journey/1.0.0` model carrying the
 *   fixture's provenance marker, or null when the name is not a bundled example.
 */
export function evaluateBundledExample(name, { surface = "briefing" } = {}) {
  const fixture = BUNDLED_EXAMPLES[name];
  if (!fixture) return null;
  return consolidateJourney({
    restored: restoreJourneySnapshot(bundledExampleStorage(fixture)),
    now: new Date(fixture.evaluatedAt),
    surface,
    provenance: fixture.provenance,
  });
}
