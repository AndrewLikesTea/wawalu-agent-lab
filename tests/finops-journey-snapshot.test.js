// The snapshot that carries one local review into the journey view.
//
// Every store here is a plain Map behind the three methods the readers use, and
// every record in it is written by the shipped writer rather than hand-rolled:
// a fixture that agrees with the reader but not with the writer would pass this
// suite and fail on a visitor's machine.

import assert from "node:assert/strict";
import test from "node:test";
import {
  JOURNEY_SNAPSHOT_COPY,
  JOURNEY_SNAPSHOT_KEY,
  JOURNEY_SNAPSHOT_VERSION,
  SNAPSHOT_REJECTION,
  captureJourneySnapshot,
  clearJourneySnapshot,
  restoreJourneySnapshot,
} from "../src/finops-journey-snapshot.js";
import {
  REVIEW_EVIDENCE_KEY, REVIEW_STATE, assembleRecurringReview, retainCurrentReviewEvidence,
} from "../src/recurring-review-readiness.js";
import {
  MONTHLY_ACTION_KEY, MONTHLY_ACTION_VERSION, readMonthlyAction,
} from "../src/monthly-department-action-store.js";
import { loadPage } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const NOW = new Date("2026-07-30T10:00:00.000Z");
const IMPORT_SOURCE = { files: ["openai-usage-export.csv", "roster.csv"], rows: 12 };

const retainedAction = {
  schemaVersion: MONTHLY_ACTION_VERSION,
  decisionVersion: "monthly-department-decision/1.0.0",
  actionId: "route-short-lookups",
  actionLabel: "Route short lookups",
  department: "Atlas Platform",
  ownerLabel: "AI Platform product owner",
  baseline: {
    value: 1200, unit: "USD/month", period: "2026-06",
    aggregation: "Monthly eligible recoverable spend",
    calculation: "Sum eligible row deltas",
  },
  target: {
    value: 0, unit: "USD/month remaining avoidable spend",
    deadline: "2026-07-31", calculation: "baseline minus verified reduction",
  },
  reviewPeriod: "2026-07",
  confidence: "high",
  provenanceReferences: ["fix-pack:1", "rubric:1"],
  committedAt: "2026-06-30T12:00:00.000Z",
};

const analysis = (department = "Atlas Platform") => ({
  schemaVersion: "local-finops/1.0.0",
  period: "2026-07-01 to 2026-08-01",
  rankedDepartments: [{ name: department, recoverableUsd: 900 }],
});
const verdict = () => ({
  state: "all_clear",
  headline: { available: true, coveragePercent: 100, totalRows: 12 },
});

function store(values = new Map()) {
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

/** A browser that has run one import and retained one monthly action. */
function seeded({ department = "Atlas Platform", action = true } = {}) {
  const storage = store();
  retainCurrentReviewEvidence(storage, {
    currentAnalysis: analysis(department), theoVerdict: verdict(),
  });
  if (action) storage.setItem(MONTHLY_ACTION_KEY, JSON.stringify(retainedAction));
  return storage;
}

/** Restore with the diagnostic channel captured rather than printed. */
function restoreWatched(storage) {
  const warn = console.warn;
  const emitted = [];
  console.warn = (...args) => emitted.push(args);
  try {
    return { restored: restoreJourneySnapshot(storage), emitted };
  } finally {
    console.warn = warn;
  }
}

const snapshotOf = (storage) => storage.getItem(JOURNEY_SNAPSHOT_KEY);

/**
 * Every rejection is checked the same way: the reason is named on the result and
 * in the diagnostic channel, nothing is carried, and the review the visitor's own
 * records still support is untouched.
 */
function assertConservative({ restored, emitted }, reason, storage, before) {
  assert.equal(restored.status, "rejected");
  assert.equal(restored.reason, reason);
  assert.equal(restored.carried, null);
  assert.equal(restored.notice, JOURNEY_SNAPSHOT_COPY.discarded);
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0][0], "finops_journey_snapshot_rejected");
  assert.equal(emitted[0][1].reason, reason);
  // The contents never reach the log; only the reason and a bounded detail do.
  assert.doesNotMatch(JSON.stringify(emitted[0][1]), /Atlas|route-short-lookups/);
  // The tracked action is exactly as it was: not re-read into a new shape, not
  // half-applied, not cleared.
  assert.equal(storage.getItem(MONTHLY_ACTION_KEY), before);
  assert.deepEqual(readMonthlyAction(storage).record, restored.retainedAction);
}

test("a snapshot round-trips every retained field through storage", () => {
  const storage = seeded();
  const captured = captureJourneySnapshot(storage, { importSource: IMPORT_SOURCE, now: NOW });
  assert.equal(captured.ok, true);

  const { restored } = restoreWatched(storage);
  assert.equal(restored.status, "restored");
  assert.equal(restored.reason, null);
  assert.equal(restored.notice, JOURNEY_SNAPSHOT_COPY.carried);
  // Byte-for-byte through JSON: what was captured is what comes back.
  assert.deepEqual(restored.carried, captured.snapshot);

  const carried = restored.carried;
  assert.equal(carried.version, JOURNEY_SNAPSHOT_VERSION);
  // Provenance: which import, and when.
  assert.match(carried.provenance.importSourceId, /^[0-9a-f]{8}$/);
  assert.equal(carried.provenance.fileCount, 2);
  assert.equal(carried.provenance.rows, 12);
  assert.equal(carried.provenance.importedAt, NOW.toISOString());
  assert.equal(carried.provenance.analysisContract, "local-finops/1.0.0");
  // Confidence, from both sides that have one.
  assert.deepEqual(carried.confidence, { action: "high", evidence: "high", coveragePercent: 100 });
  // Benchmark period, current and retained.
  assert.deepEqual(carried.benchmark,
    { analysisPeriod: "2026-07", baselinePeriod: "2026-06", unit: "USD/month" });
  // Department drill-down: references into the retained evidence record, and the
  // keys that record actually minted.
  const evidence = JSON.parse(storage.getItem(REVIEW_EVIDENCE_KEY));
  assert.deepEqual(carried.departmentReferences,
    evidence.currentAnalysis.rankedDepartments.map((entry) => entry.scopeKey));
  // Verification status.
  assert.deepEqual(carried.verification, { state: "all_clear", measured: true, rows: 12 });
  assert.deepEqual(carried.trackedAction,
    { actionId: "route-short-lookups", committedAt: "2026-06-30T12:00:00.000Z" });

  // And the restored state is Noor's contract's own inputs, ready to act on.
  assert.equal(assembleRecurringReview(restored).state, REVIEW_STATE.ready);
});

test("the snapshot carries no department name, no figure, and no source file name", () => {
  const storage = seeded();
  captureJourneySnapshot(storage, { importSource: IMPORT_SOURCE, now: NOW });
  const serialized = snapshotOf(storage);
  assert.doesNotMatch(serialized, /Atlas Platform|openai-usage-export|roster\.csv|900|1200/);
});

test("restoring twice is the same state and writes nothing", () => {
  const storage = seeded();
  captureJourneySnapshot(storage, { importSource: IMPORT_SOURCE, now: NOW });
  const before = [...storage.values.entries()];

  const first = restoreJourneySnapshot(storage);
  const second = restoreJourneySnapshot(storage);
  assert.deepEqual(second, first);
  assert.equal(second.status, "restored");
  // No duplicated tracked action, because restoration never writes at all.
  assert.deepEqual([...storage.values.entries()], before);
  assert.deepEqual(readMonthlyAction(storage).record, retainedAction);
});

test("an unreadable stored value is invalid and falls back conservatively", () => {
  const storage = seeded();
  captureJourneySnapshot(storage, { importSource: IMPORT_SOURCE, now: NOW });
  const before = storage.getItem(MONTHLY_ACTION_KEY);
  storage.setItem(JOURNEY_SNAPSHOT_KEY, "{not json");

  const watched = restoreWatched(storage);
  assertConservative(watched, SNAPSHOT_REJECTION.invalid, storage, before);
  // Conservative is not blank: the records themselves still support the review.
  assert.equal(assembleRecurringReview(watched.restored).state, REVIEW_STATE.ready);
});

test("a stored value that fails the schema is invalid, not partially applied", () => {
  const storage = seeded();
  captureJourneySnapshot(storage, { importSource: IMPORT_SOURCE, now: NOW });
  const before = storage.getItem(MONTHLY_ACTION_KEY);
  const stored = JSON.parse(snapshotOf(storage));
  storage.setItem(JOURNEY_SNAPSHOT_KEY, JSON.stringify({
    ...stored, departmentReferences: ["not-a-scope-key"], confidence: { action: "certain" },
  }));

  assertConservative(restoreWatched(storage), SNAPSHOT_REJECTION.invalid, storage, before);
});

test("a snapshot from a newer version is unsupported, never best-effort read", () => {
  const storage = seeded();
  captureJourneySnapshot(storage, { importSource: IMPORT_SOURCE, now: NOW });
  const before = storage.getItem(MONTHLY_ACTION_KEY);
  const stored = JSON.parse(snapshotOf(storage));
  // Synthetic v2: every v1 field still present and valid, so only the gate can
  // refuse it. There is no v2 in this build, and reading one as v1 would be this
  // reader inventing a migration it does not have.
  storage.setItem(JOURNEY_SNAPSHOT_KEY, JSON.stringify({
    ...stored, version: JOURNEY_SNAPSHOT_VERSION + 1, carriedForward: { newField: true },
  }));

  assertConservative(restoreWatched(storage), SNAPSHOT_REJECTION.unsupported, storage, before);
});

test("an absent or older version with no migration path is unsupported", () => {
  const storage = seeded();
  captureJourneySnapshot(storage, { importSource: IMPORT_SOURCE, now: NOW });
  const before = storage.getItem(MONTHLY_ACTION_KEY);
  const stored = JSON.parse(snapshotOf(storage));

  for (const version of [undefined, null, "1", 0]) {
    const { version: _drop, ...rest } = stored;
    storage.setItem(JOURNEY_SNAPSHOT_KEY, JSON.stringify(
      version === undefined ? rest : { ...rest, version }));
    assertConservative(restoreWatched(storage), SNAPSHOT_REJECTION.unsupported, storage, before);
  }
});

test("a snapshot whose department references no longer resolve is stale", () => {
  const storage = seeded();
  captureJourneySnapshot(storage, { importSource: IMPORT_SOURCE, now: NOW });
  const before = storage.getItem(MONTHLY_ACTION_KEY);
  // A later import of a differently-named department mints different scope keys.
  retainCurrentReviewEvidence(storage, {
    currentAnalysis: analysis("Boreal Support"), theoVerdict: verdict(),
  });

  const watched = restoreWatched(storage);
  assertConservative(watched, SNAPSHOT_REJECTION.stale, storage, before);
  assert.equal(watched.emitted[0][1].reference, "department");
});

test("a snapshot whose tracked action identity changed is stale", () => {
  const storage = seeded();
  captureJourneySnapshot(storage, { importSource: IMPORT_SOURCE, now: NOW });
  const recommitted = JSON.stringify({ ...retainedAction, committedAt: "2026-07-29T08:00:00.000Z" });
  storage.setItem(MONTHLY_ACTION_KEY, recommitted);

  const watched = restoreWatched(storage);
  assertConservative(watched, SNAPSHOT_REJECTION.stale, storage, recommitted);
  assert.equal(watched.emitted[0][1].reference, "tracked_action");
});

test("a snapshot whose evidence record was cleared is stale, and the review says so", () => {
  const storage = seeded();
  captureJourneySnapshot(storage, { importSource: IMPORT_SOURCE, now: NOW });
  const before = storage.getItem(MONTHLY_ACTION_KEY);
  storage.removeItem(REVIEW_EVIDENCE_KEY);

  const watched = restoreWatched(storage);
  assertConservative(watched, SNAPSHOT_REJECTION.stale, storage, before);
  assert.equal(watched.emitted[0][1].reference, "current_analysis");
  // The state a visitor with no snapshot sees: the retained action is waiting on
  // an analysis, which is exactly what Noor's contract already reports.
  assert.equal(assembleRecurringReview(watched.restored).code, "analysis_missing");
});

test("no stored snapshot is neither an error nor a notice", () => {
  const storage = seeded();
  const { restored, emitted } = restoreWatched(storage);
  assert.equal(restored.status, "absent");
  assert.equal(restored.reason, null);
  assert.equal(restored.notice, null);
  assert.deepEqual(emitted, []);
  assert.equal(assembleRecurringReview(restored).state, REVIEW_STATE.ready);
});

test("a browser with no evidence to carry produces no snapshot, and clearing is total", () => {
  const empty = store();
  assert.deepEqual(captureJourneySnapshot(empty, { importSource: IMPORT_SOURCE, now: NOW }),
    { ok: false, code: "not_derivable", snapshot: null });
  assert.equal(snapshotOf(empty), null);

  const storage = seeded();
  captureJourneySnapshot(storage, { importSource: IMPORT_SOURCE, now: NOW });
  clearJourneySnapshot(storage);
  assert.equal(snapshotOf(storage), null);
  assert.equal(restoreJourneySnapshot(storage).status, "absent");
});

test("blocked storage neither throws nor claims a capture", () => {
  const blocked = {
    getItem() { throw new Error("SecurityError"); },
    setItem() { throw new Error("SecurityError"); },
    removeItem() { throw new Error("SecurityError"); },
  };
  assert.equal(captureJourneySnapshot(blocked, { importSource: IMPORT_SOURCE, now: NOW }).ok, false);
  const { restored } = restoreWatched(blocked);
  assert.equal(restored.carried, null);
  assert.equal(restored.retainedAction, null);
  clearJourneySnapshot(blocked);
});

/* ------------------------------- entry points ------------------------------ */

/** The three records one import leaves behind, as a page storage seed. */
function importedSeed(options = {}) {
  const storage = seeded(options);
  captureJourneySnapshot(storage, { importSource: IMPORT_SOURCE, now: NOW });
  return Object.fromEntries(storage.values);
}

async function openJourney(seed) {
  const page = await loadPage(new URL("../src/savings-action-center.html", import.meta.url),
    { storage: seed });
  await importPageModule("/savings-action-center-page.js");
  await waitFor(() => page.document.querySelector(".sac-focus")?.dataset.reviewState === "ready",
    "ready recurring review");
  return page;
}

test("the journey view resumes a carried snapshot without a re-import", async () => {
  const page = await openJourney(importedSeed());
  try {
    const carried = page.document.querySelector(".sac-snapshot");
    assert.equal(carried.dataset.snapshot, "restored");
    assert.equal(carried.textContent, JOURNEY_SNAPSHOT_COPY.carried);
    // The carried provenance is readable in the evidence panel, by its import
    // identity rather than by the file names it was hashed from.
    const panel = page.document.getElementById("sac-evidence-detail-panel");
    assert.match(panel.textContent, /Carried from import/);
    assert.match(panel.textContent, /2 files, 12 rows/);
    assert.match(panel.textContent, /Department references \(1\)/);
    assert.doesNotMatch(panel.textContent, /openai-usage-export/);
  } finally {
    page.restore();
  }
});

test("the journey view discards a rejected snapshot and still shows the review", async () => {
  const seed = { ...importedSeed(), [JOURNEY_SNAPSHOT_KEY]: "{not json" };
  const warn = console.warn;
  console.warn = () => {};
  const page = await openJourney(seed);
  try {
    const carried = page.document.querySelector(".sac-snapshot");
    assert.equal(carried.dataset.snapshot, "rejected");
    assert.equal(carried.dataset.snapshotReason, SNAPSHOT_REJECTION.invalid);
    assert.equal(carried.textContent, JOURNEY_SNAPSHOT_COPY.discarded);
    // The fallback costs the carried line and nothing else.
    assert.equal(page.document.querySelector(".sac-focus").dataset.reviewState, "ready");
    assert.doesNotMatch(
      page.document.getElementById("sac-evidence-detail-panel").textContent,
      /Carried from import/);
    // And the tracked action the page read is the one it was given, unmutated.
    assert.deepEqual(JSON.parse(page.storage.getItem(MONTHLY_ACTION_KEY)), retainedAction);
  } finally {
    console.warn = warn;
    page.restore();
  }
});
