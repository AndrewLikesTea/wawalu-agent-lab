// The FinOps history this browser kept, graded against labelled cases.
//
// WHY THIS SUITE EXISTS SEPARATELY
// --------------------------------
// `tests/local-finops.test.js` grades the analysis while it is on screen and
// `tests/decision-reconciliation.test.js` grades one reconciliation in memory.
// Neither asks the question a director asks after a refresh: is what the browser
// *kept* the same finding it showed, and can a bad entry in the store change it?
//
// Three claims are checked, in this order, because each one is only worth making
// if the one before it holds:
//
//   1. REPRODUCIBLE. The retained periods publish exactly one trend and exactly
//      one benchmark refusal, and the retained commitments reconcile to exactly
//      the labelled statuses and amounts. Every expected number is stated in
//      `tests/fixtures/finops-workspace/labelled-cases.js` with the assumption
//      behind it.
//   2. DURABLE. Those same findings come back byte-for-byte out of a JSON
//      backup restored into an empty browser.
//   3. HOSTILE-INPUT SAFE. Corrupted, duplicate, stale, and unsupported entries
//      each fail safely, and none of them alters the valid findings.
//
// And underneath all three, the claim that has to hold or none of the others
// matter: a prohibited source field cannot reach the store in the first place.
//
// NO CLOCK, NO NETWORK, NO CREDENTIAL, NO CUSTOMER DATA
// -----------------------------------------------------
// Every instant is stated. Every record is synthetic and derived from the two
// shipped contract fixtures. The store is an in-memory Map.

import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_ALTERNATIVES_LENGTH, MAX_CONTEXT_LENGTH, MAX_OWNER_LENGTH, MAX_TITLE_LENGTH,
  STORAGE_KEY, loadDecisions, saveDecisions,
} from "../src/app.js";
import { RELEASE_STORAGE_KEY, saveReleases } from "../src/releases.js";
import { normalizeLocalFinopsHistory } from "../src/local-finops.js";
import {
  COMMITMENT_METADATA_FIELD, recordCommitmentDecision,
} from "../src/finops-commitment-decision.js";
import {
  RECONCILIATION_METADATA_FIELD, persistReconciliations, reconcileImportedAnalysis,
} from "../src/decision-reconciliation.js";
import { createShiplogExport } from "../src/shiplog-export.js";
import { commitShiplogImport, prepareShiplogImport } from "../src/shiplog-import.js";
import { CONFIDENCE, WORKSPACE_STATE, readWorkspace } from "../src/local-workspace.js";
import {
  FORBIDDEN_FIELD_PATTERN, FORBIDDEN_VALUE_PATTERNS, MAX_STRING_LENGTH,
} from "../src/finops-briefing-contract.js";
import {
  RECONCILED_AT,
  RETAINED_HISTORY_EXPECTATION,
  SENTINELS,
  commitmentApproval,
  hostileEntries,
  retainedCommitments,
  retainedPeriods,
  retainingWorkspace,
  taintedUsageRows,
} from "./fixtures/finops-workspace/labelled-cases.js";

const CHECKED_AT = new Date("2026-08-03T09:00:00.000Z");

/** A retaining browser holding the two commitment decisions and their release. */
function retainedWorkspace() {
  const retained = retainedCommitments();
  const storage = retainingWorkspace();
  saveDecisions(storage, retained.decisions);
  saveReleases(storage, [retained.release]);
  return { storage, retained };
}

function reconcile(storage, entries) {
  return reconcileImportedAnalysis({
    decisions: loadDecisions(storage),
    releases: JSON.parse(storage.getItem(RELEASE_STORAGE_KEY) ?? "[]"),
    entries,
    reconciledAt: RECONCILED_AT,
  });
}

/**
 * One row's graded facts, in the shape the labelled expectations are written in.
 *
 * The amounts are read off `row.record` — the block that is actually persisted —
 * rather than off the in-memory outcome, because the claim this suite makes is
 * about what the browser kept, not about what it computed on the way there.
 */
function graded(row) {
  return {
    decisionId: row.decisionId,
    commitmentId: row.commitmentId,
    status: row.status,
    reason: row.reason,
    observedMonth: row.observedMonth,
    amounts: {
      projectedMonthlySavingsMinor: row.record.projectedMonthlySavingsMinor ?? null,
      observedMonthlySavingsMinor: row.record.observedMonthlySavingsMinor ?? null,
      varianceMinor: row.record.varianceMinor ?? null,
      attainmentPercent: row.record.attainmentPercent ?? null,
    },
  };
}

function expectedGrade(expected) {
  const { label, ...rest } = expected;
  return { ...rest, amounts: { ...rest.amounts } };
}

/* ------------------------- 1. reproducible findings ------------------------ */

test("three retained calendar months publish the newest pair's trend and one benchmark refusal", async () => {
  const { periods, hris } = await retainedPeriods();
  const expected = RETAINED_HISTORY_EXPECTATION;

  const result = normalizeLocalFinopsHistory({ providers: periods, hris });

  assert.equal(result.history.state, expected.historyState, expected.label);
  assert.equal(result.history.periodCount, expected.periodCount);
  assert.equal(result.history.currentPeriod, expected.currentPeriod);
  assert.equal(result.history.previousPeriod, expected.previousPeriod);
  // The assumption a director disputes first: three months are retained, and the
  // published organization trend is the newest pair only. The 2026-05 month is
  // present in `history.periods` and absent from this figure on purpose.
  assert.equal(result.history.organizationTrendAvailable, expected.organizationTrendAvailable);
  assert.equal(result.history.organizationSpendChangePercent,
    expected.organizationSpendChangePercent);
  assert.equal(result.spendUsd, expected.spendUsd);
  assert.deepEqual(result.history.periods.map((period) => period.spendUsd),
    expected.periodSpendUsd);

  // A benchmark with no cohort is a named refusal, never a zero.
  assert.equal(result.benchmark.state, expected.benchmarkState);
  assert.equal(result.benchmark.eligible, expected.benchmarkEligible);
  assert.equal(result.benchmark.reasonCode, expected.benchmarkReasonCode);
  assert.equal(result.decisionInputs.benchmarkEligibility.eligible, false);

  // Order in must not change the answer out: a retained history is a set.
  const reversed = normalizeLocalFinopsHistory({ providers: [...periods].reverse(), hris });
  assert.deepEqual(reversed, result,
    "the retained periods must reconcile to the same finding in any order");
});

test("each retained commitment reconciles to its labelled status and amounts", () => {
  const { storage, retained } = retainedWorkspace();

  const model = reconcile(storage, retained.entries);

  assert.equal(model.rows.length, retained.expected.length);
  for (const expected of retained.expected) {
    const row = model.rows.find((candidate) => candidate.decisionId === expected.decisionId);
    assert.ok(row, `${expected.label}: no row was produced at all`);
    assert.deepEqual(graded(row), expectedGrade(expected), expected.label);
    // Every row carries the sentence it was settled by, so an executive view
    // never has to render a status code on its own.
    assert.equal(typeof row.statement, "string");
    assert.notEqual(row.statement.trim(), "");
  }
});

test("reconciling the retained store twice at the same stated instant is byte-identical", () => {
  const { storage, retained } = retainedWorkspace();

  const first = reconcile(storage, retained.entries);
  const second = reconcile(storage, retained.entries);

  assert.deepEqual(second, first, "a reproducible finding cannot depend on when it was run");
});

/* ---------------------------- 2. durable findings -------------------------- */

test("the retained findings survive a JSON backup restored into an empty browser", () => {
  const { storage, retained } = retainedWorkspace();
  const model = reconcile(storage, retained.entries);
  const written = persistReconciliations(storage, model);
  assert.equal(written.written, 2);
  assert.deepEqual(written.invalid, []);
  assert.equal(written.blocked, null);

  const text = JSON.stringify(createShiplogExport(storage, {
    generatedAt: "2026-08-03T09:05:00.000Z",
  }));

  const restored = retainingWorkspace();
  const plan = prepareShiplogImport(restored, text);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.parsed.droppedCommitments, [],
    "a commitment this build wrote must be readable by the importer that reads it");
  assert.equal(plan.merged.summary.newDecisions, 2);
  commitShiplogImport(restored, plan);

  // Field for field, including both derived blocks.
  assert.deepEqual(loadDecisions(restored), loadDecisions(storage));
  for (const decision of loadDecisions(restored)) {
    assert.ok(decision[COMMITMENT_METADATA_FIELD]?.commitmentId);
    assert.ok(decision[RECONCILIATION_METADATA_FIELD]?.status);
  }

  // And the finding recomputed in the restored browser is the finding that was
  // taken. A backup that restores the records but not the conclusion is not a
  // backup of the history.
  assert.deepEqual(reconcile(restored, retained.entries).rows, model.rows);
});

test("persisting an unchanged reconciliation rewrites nothing, so an untouched log stays untouched", () => {
  const { storage, retained } = retainedWorkspace();
  const model = reconcile(storage, retained.entries);
  persistReconciliations(storage, model);
  const after = storage.getItem(STORAGE_KEY);

  const second = persistReconciliations(storage, reconcile(storage, retained.entries));

  assert.equal(second.written, 0);
  assert.equal(second.unchanged, 2);
  assert.equal(storage.getItem(STORAGE_KEY), after);
});

/* ------------------------- 3. hostile stored entries ----------------------- */

test("a corrupted, duplicate, stale, or unsupported entry never alters the valid findings", () => {
  const baseline = retainedWorkspace();
  const expectedRows = baseline.retained.expected.map((expected) => {
    const row = reconcile(baseline.storage, baseline.retained.entries).rows
      .find((candidate) => candidate.decisionId === expected.decisionId);
    return [expected.decisionId, row];
  });

  for (const hostile of hostileEntries(baseline.retained.decisions)) {
    const { storage, retained } = retainedWorkspace();
    // The only way in: written straight into the key. Every shipped writer
    // refuses these, which is what the two cases below this one assert.
    storage.setItem(STORAGE_KEY,
      JSON.stringify([...retained.decisions, hostile.entry]));

    // Fails safely: the readers are total, whatever is in the key.
    const stored = loadDecisions(storage);
    const model = reconcile(storage, retained.entries);
    const status = readWorkspace(storage, { now: CHECKED_AT });

    assert.equal(stored.length, hostile.kept ? 3 : 2, `${hostile.label}: ${hostile.because}`);
    assert.equal(model.rows.length, hostile.reconciledRow ? 3 : 2, hostile.label);

    // Never alters a valid finding: each labelled row is the row it was.
    for (const [decisionId, expectedRow] of expectedRows) {
      const row = model.rows.find((candidate) => candidate.decisionId === decisionId);
      assert.deepEqual(row, expectedRow,
        `${hostile.label}: the valid row for ${decisionId} moved`);
    }

    // And the workspace page never claims a count it could not verify.
    if (!hostile.kept) {
      assert.equal(status.confidence.grade, CONFIDENCE.partial,
        `${hostile.label}: a dropped entry must degrade the confidence grade`);
      assert.equal(status.records.dropped, 1);
      assert.match(status.confidence.detail, /did not match the record shape/);
    } else {
      assert.equal(status.confidence.grade, CONFIDENCE.verified);
    }
  }
});

test("a store whose text is not a readable list reports unreadable rather than empty", () => {
  const { storage } = retainedWorkspace();
  storage.setItem(STORAGE_KEY, "{ this is not a decision log");

  const status = readWorkspace(storage, { now: CHECKED_AT });

  assert.deepEqual(loadDecisions(storage), [], "the reader is total; it does not throw");
  assert.equal(reconcile(storage, []).rows.length, 0);
  assert.equal(status.state, WORKSPACE_STATE.corrupted);
  assert.equal(status.confidence.grade, CONFIDENCE.partial);
  // Restore is offered before erase: erasing is the step that loses whatever
  // survived, and this is the ladder that decides which button is drawn.
  assert.equal(status.nextAction.code, "restore_unreadable");
  assert.equal(status.canErase, true);
});

test("the writer refuses a duplicate commitment rather than linking it twice", () => {
  const { storage, retained } = retainedWorkspace();
  const before = storage.getItem(STORAGE_KEY);

  // The same approval a second time, from a second approver: the commitment is
  // already in the log, so nothing is written and the existing link is returned.
  const again = recordCommitmentDecision(storage,
    commitmentApproval({ approvedBy: "Another Approver" }));

  assert.equal(again.created, false);
  assert.equal(again.reason, "already_linked");
  assert.equal(again.decision.id, retained.decisions[0].id);
  assert.equal(storage.getItem(STORAGE_KEY), before, "a refused write must change no bytes");
  assert.equal(reconcile(storage, retained.entries).rows.length, 2);
});

test("the importer refuses a commitment already linked to another stored decision", () => {
  const { storage, retained } = retainedWorkspace();
  const foreign = {
    ...structuredClone(retained.decisions[0]),
    id: "imported-second-link",
    owner: "Another Approver",
  };
  const text = JSON.stringify({
    schema: "shiplog-history",
    version: 1,
    generatedAt: "2026-08-03T09:05:00.000Z",
    decisions: [foreign],
    releases: [],
  });

  const plan = prepareShiplogImport(storage, text);
  assert.equal(plan.ok, true);
  assert.equal(plan.parsed.droppedCommitments.length, 1);
  assert.match(plan.parsed.droppedCommitments[0].message, /already linked to decision/);
  commitShiplogImport(storage, plan);

  // The record is kept without its block, so the finding is unchanged: still
  // exactly two rows, and both of them the labelled ones.
  const model = reconcile(storage, retained.entries);
  assert.equal(model.rows.length, 2);
  assert.deepEqual(model.rows.map((row) => row.decisionId),
    retained.decisions.map((decision) => decision.id));
});

/* --------------------------- 4. redaction at the seam ---------------------- */

/** Every key and every string in a persisted value, with its path. */
function walk(value, path, keys, strings) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, keys, strings));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.push({ path: `${path}.${key}`, key });
      walk(child, `${path}.${key}`, keys, strings);
    }
    return;
  }
  if (typeof value === "string") strings.push({ path, value });
}

function inspectPersisted(storage) {
  const keys = [];
  const strings = [];
  const text = [STORAGE_KEY, RELEASE_STORAGE_KEY]
    .map((key) => storage.getItem(key) ?? "")
    .join("\n");
  for (const key of [STORAGE_KEY, RELEASE_STORAGE_KEY]) {
    walk(JSON.parse(storage.getItem(key) ?? "[]"), key, keys, strings);
  }
  return { keys, strings, text };
}

test("prohibited source fields are dropped before the commitment is persisted", () => {
  const storage = retainingWorkspace();
  // The usage rows carry a prompt excerpt, an email address, an API key, an IP
  // address, and a customer name — every category the briefing contract names.
  const { created } = recordCommitmentDecision(storage,
    commitmentApproval({ rows: taintedUsageRows() }));
  assert.equal(created, true, "the tainted rows must still produce a recordable commitment, "
    + "or this test would pass by recording nothing at all");

  const persisted = inspectPersisted(storage);
  for (const [name, sentinel] of Object.entries(SENTINELS)) {
    assert.equal(persisted.text.includes(sentinel), false,
      `the ${name} sentinel reached the persisted workspace`);
  }
});

test("the redaction scan itself detects a sentinel, so a clean scan means something", () => {
  // A scan that cannot fail is not evidence. This plants each sentinel in the
  // store on a field named for what it is, and requires the same two checks the
  // test above runs to find every one of them. It grades the detector, not the
  // product — and without it, a scan that silently stopped looking would read
  // exactly like a workspace with nothing to find.
  const storage = retainingWorkspace();
  storage.setItem(STORAGE_KEY, JSON.stringify([{
    id: "planted", promptExcerpt: SENTINELS.promptExcerpt, userEmail: SENTINELS.email,
    apiKey: SENTINELS.apiKey, callerIpAddress: SENTINELS.ipAddress,
    customerName: SENTINELS.customerName,
  }]));

  const persisted = inspectPersisted(storage);
  for (const [name, sentinel] of Object.entries(SENTINELS)) {
    assert.equal(persisted.text.includes(sentinel), true, `the scan missed the ${name} sentinel`);
  }
  const forbiddenKeys = persisted.keys
    .filter(({ key }) => FORBIDDEN_FIELD_PATTERN.test(key.toLowerCase().replace(/[^a-z]/g, "")))
    .map(({ key }) => key);
  // Four of the five, and the fifth is the point of writing this down. The
  // shipped `FORBIDDEN_FIELD_PATTERN` names `customerid` but not `customername`,
  // so a field called `customerName` is caught here only by the substring scan
  // above and not by the key rule. That is a real hole in the key blocklist,
  // recorded as an expectation rather than quietly widened: the pattern belongs
  // to the briefing contract, and a scoring suite must not edit the rule it
  // grades. Adding `customername|companyname|orgname` to that pattern is the fix,
  // and this assertion is what will fail — visibly, with this comment attached —
  // on the day someone makes it.
  assert.deepEqual(forbiddenKeys.sort(),
    ["apiKey", "callerIpAddress", "promptExcerpt", "userEmail"]);
  const codes = new Set();
  for (const { value } of persisted.strings) {
    for (const { code, pattern } of FORBIDDEN_VALUE_PATTERNS) if (pattern.test(value)) codes.add(code);
  }
  assert.deepEqual([...codes].sort(), ["bearer_token", "email_address", "ip_address"]);
});

test("no key or value anywhere in the persisted workspace breaks the redaction rules", () => {
  const { storage, retained } = retainedWorkspace();
  persistReconciliations(storage, reconcile(storage, retained.entries));

  const persisted = inspectPersisted(storage);
  assert.ok(persisted.keys.length > 0, "nothing was persisted, so nothing was proved");

  // The key rule applies to the whole store, with no exemption: a field named
  // for prompt, identity, or credential content is a leak wherever it sits.
  const forbiddenKeys = persisted.keys.filter(({ key }) =>
    FORBIDDEN_FIELD_PATTERN.test(key.toLowerCase().replace(/[^a-z]/g, "")));
  assert.deepEqual(forbiddenKeys, [],
    "a persisted key named for prompt, identity, or credential content");

  // So does the value rule. An address, an IP, or a token is a leak whatever
  // the field it arrived on is called.
  const leaks = [];
  for (const { path, value } of persisted.strings) {
    for (const { code, pattern } of FORBIDDEN_VALUE_PATTERNS) {
      if (pattern.test(value)) leaks.push({ path, code });
    }
  }
  assert.deepEqual(leaks, [], "a persisted string carries an address, an IP, or a token");
});

test("the imported half of a persisted decision stays inside the briefing prose ceiling", () => {
  const { storage, retained } = retainedWorkspace();
  persistReconciliations(storage, reconcile(storage, retained.entries));

  // ASSUMPTION, stated because it is the one weight in this file a reviewer
  // could reasonably set differently. Two different ceilings govern two
  // different halves of a stored decision, and applying either one to the other
  // half would be wrong:
  //
  //   * The DERIVED blocks came out of an imported file. Free-form text there is
  //     how a visitor's own words reach a durable record, so the briefing
  //     contract's 400-character ceiling is the rule, and it is checked here.
  //   * The decision's OWN title, context, alternatives, and owner are authored
  //     by this build (or typed into the record form) and are bounded by app.js's
  //     own maxima. `commitmentContext` writes a summary that is deliberately
  //     longer than 400 characters and shorter than 1,000, so grading it against
  //     the briefing ceiling would fail a sentence the product intends to store.
  const overLong = [];
  const authored = [];
  for (const decision of loadDecisions(storage)) {
    for (const field of [COMMITMENT_METADATA_FIELD, RECONCILIATION_METADATA_FIELD]) {
      const strings = [];
      walk(decision[field], `${decision.id}.${field}`, [], strings);
      for (const { path, value } of strings) {
        if (value.length > MAX_STRING_LENGTH) overLong.push({ path, length: value.length });
      }
    }
    authored.push({
      id: decision.id,
      title: decision.title.length <= MAX_TITLE_LENGTH,
      context: decision.context.length <= MAX_CONTEXT_LENGTH,
      alternatives: (decision.alternatives ?? "").length <= MAX_ALTERNATIVES_LENGTH,
      owner: decision.owner.length <= MAX_OWNER_LENGTH,
    });
  }

  assert.deepEqual(overLong, [],
    "a derived block carries free-form prose out of the imported file");
  for (const record of authored) {
    assert.deepEqual(record, {
      id: record.id, title: true, context: true, alternatives: true, owner: true,
    }, `${record.id}: an authored field exceeded the decision log's own maximum`);
  }
});
