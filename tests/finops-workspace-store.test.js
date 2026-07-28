// The versioned browser-local FinOps store, and the surfaces that read it back.
//
// Four claims, in the order each one becomes worth making:
//
//   1. VERSIONED. A 1.0.0 store is migrated forward on read, a document from a
//      version this build does not know is refused and left untouched, and
//      malformed text is neither read nor overwritten.
//   2. VALIDATED. Only records satisfying the store's own contract go in, and
//      only those come back out; a hand-edited entry is dropped and counted.
//   3. OPT-IN. Nothing is written without a granted consent — periods or
//      commitments — and export and full erasure both cover everything kept.
//   4. INTEGRATED. What was written on one visit is read back on the next by
//      the briefing, trend, reconciliation, and commitment surfaces, with no
//      file reopened.
//
// Every instant is stated, the store is an in-memory Map, and nothing here
// reaches a network: the harness throws on an undeclared request.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { buildFinopsBriefing } from "../src/finops-briefing-contract.js";
import {
  FINOPS_WORKSPACE_KEY, FINOPS_WORKSPACE_VERSION, FINOPS_WORKSPACE_VERSION_1_0_0,
} from "../src/finops-workspace-contract.js";
import { MIGRATION_STATUS, migrateFinopsWorkspace } from "../src/finops-workspace-migrations.js";
import {
  FINOPS_CONSENT, FINOPS_STATE, finopsWorkspaceFile, forgetFinopsWorkspace,
  projectRetainedCommitment, projectRetainedPeriod, readFinopsDocument, readFinopsWorkspace,
  readRetainedCommitments, retainApprovedCommitment, retainFinopsCommitment, retainFinopsPeriod,
  setFinopsConsent, validateRetainedCommitment, validateRetainedPeriod,
} from "../src/finops-workspace.js";
import { restoreFinopsWorkspace } from "../src/finops-workspace-restore.js";
import { applyWorkspaceRestore } from "../src/finops-workspace-restore-view.js";
import { loadPage } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";

const NOW = new Date("2026-07-28T11:30:00.000Z");
const PAGE = new URL("../src/savings-commitment.html", import.meta.url);
const FIXTURE = JSON.parse(await readFile(
  new URL("../src/savings-commitment-fixture.json", import.meta.url), "utf8",
));

function storageOf(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    get size() { return values.size; },
  };
}

/** One analysis envelope in the shape `buildFinopsBriefing` reads. */
function analysisOf({ month = "2026-06", spendUsd = 7430, recoverableUsd = 5200 } = {}) {
  const next = `${month.slice(0, 5)}${String(Number(month.slice(5)) + 1).padStart(2, "0")}`;
  return {
    schemaVersion: "local-finops-history/1.0.0",
    period: `${month}-01 to ${next}-01`,
    spendUsd,
    recoverableUsd,
    rankedDepartments: [
      { id: "customer-support", name: "Customer support", spendUsd: spendUsd * 0.6, recoverableUsd },
      { id: "platform", name: "Platform", spendUsd: spendUsd * 0.4, recoverableUsd: 0 },
    ],
    topDepartment: { id: "customer-support", recoverableUsd },
    action: "Pilot lower-cost routing for text generation in the highest-spend org unit.",
    quality: { joinedRecords: 760, quarantinedRecords: 40, providerCompleteness: true },
  };
}

/** A retained period, projected exactly as the AI FinOps page projects one. */
function periodOf(options = {}) {
  const analysis = analysisOf(options);
  return projectRetainedPeriod({
    briefing: buildFinopsBriefing(analysis, options),
    analysis,
    dataset: options.dataset ?? "user",
    now: new Date(options.derivedAt ?? "2026-07-02T09:14:00.000Z"),
  });
}

/** The `finopsCommitment` block a recorded decision carries. */
function metadataOf({ commitmentId = "route-support-triage-to-haiku", period = "2026-06" } = {}) {
  return {
    schemaVersion: "shiplog-finops-commitment/1.0.0",
    commitmentId,
    claim: {
      baselineMonthlyCostMinor: 1_840_000,
      projectedMonthlyCostMinor: 1_228_000,
      monthlySavingsMinor: 612_000,
      currency: "USD",
      unit: "usd_minor",
      period,
    },
    confidence: { percent: 78, band: "high" },
    // The full decision-block provenance, source-row ids and all: the store is
    // what has to refuse them, not the caller.
    provenance: {
      sourceId: "example-dataset",
      designation: "imported",
      importedAt: "2026-07-02T09:12:00.000Z",
      analysisPeriod: period,
      recordIds: ["rec-0f21", "rec-0f22"],
      recordCount: 2,
    },
    recommendedAction: {
      workloadId: "support-triage",
      departmentId: "customer-support",
      fromModelId: "opus-tier",
      toModelId: "haiku-tier",
    },
  };
}

/** A browser that granted retention and holds one period. */
function retaining({ months = ["2026-06"] } = {}) {
  const storage = storageOf();
  setFinopsConsent(storage, FINOPS_CONSENT.granted, { now: NOW });
  for (const month of months) {
    const result = retainFinopsPeriod(storage, periodOf({ month }), { now: NOW });
    assert.equal(result.ok, true, result.message);
  }
  return storage;
}

/* ------------------------------ 1. versioned ------------------------------- */

test("a 1.0.0 store is migrated forward on read and keeps its consent", () => {
  const legacy = {
    schemaVersion: FINOPS_WORKSPACE_VERSION_1_0_0,
    consent: {
      state: "granted",
      decidedAt: "2026-07-02T09:14:00.000Z",
      grantedAgainst: FINOPS_WORKSPACE_VERSION_1_0_0,
    },
    periods: [periodOf()],
    commitments: [{
      ...projectRetainedCommitment({
        metadata: metadataOf(), decisionId: "finops-commitment-route-support-triage-to-haiku",
        approvedAt: "2026-07-02T09:15:00.000Z",
      }),
      // What a 1.0.0 browser could legitimately have written.
      provenance: { sourceId: "example-dataset", recordIds: ["rec-0f21"], recordCount: 1 },
    }],
    meta: { lastWriteAt: "2026-07-02T09:15:00.000Z" },
  };
  const storage = storageOf({ [FINOPS_WORKSPACE_KEY]: JSON.stringify(legacy) });

  const read = readFinopsDocument(storage);
  assert.equal(read.access, "ok");
  assert.equal(read.migratedFrom, FINOPS_WORKSPACE_VERSION_1_0_0);
  assert.equal(read.document.schemaVersion, FINOPS_WORKSPACE_VERSION);
  // Consent survives, and says which version it was granted against.
  assert.equal(read.document.consent.state, FINOPS_CONSENT.granted);
  assert.equal(read.document.consent.grantedAgainst, FINOPS_WORKSPACE_VERSION_1_0_0);
  // The source-row identifiers are gone, and the count that replaced them is not.
  const [commitment] = read.document.commitments;
  assert.deepEqual(Object.keys(commitment.provenance), ["recordCount"]);
  assert.equal(commitment.provenance.recordCount, 1);
  assert.equal(read.dropped, 0);
});

test("a document from an unknown version is refused, read from, or written over by nothing", () => {
  const future = JSON.stringify({
    schemaVersion: "finops-workspace/2.0.0",
    consent: { state: "granted", decidedAt: NOW.toISOString(), grantedAgainst: "finops-workspace/2.0.0" },
    periods: [{ periodId: "user:2026-06" }],
  });
  const storage = storageOf({ [FINOPS_WORKSPACE_KEY]: future });

  const read = readFinopsDocument(storage);
  assert.equal(read.access, "unsupported");
  assert.equal(read.document.periods.length, 0);

  // Every write path refuses, and the stored text is byte-for-byte unchanged.
  assert.equal(setFinopsConsent(storage, FINOPS_CONSENT.granted, { now: NOW }).code,
    "unsupported_document");
  assert.equal(retainFinopsPeriod(storage, periodOf(), { now: NOW }).ok, false);
  assert.equal(retainApprovedCommitment(storage, {
    metadata: metadataOf(), approvedAt: NOW.toISOString(),
  }, { now: NOW }).ok, false);
  assert.equal(storage.getItem(FINOPS_WORKSPACE_KEY), future);

  // The status surface says which of the two unreadable answers this is, and the
  // one thing it offers to do is not destructive.
  const status = readFinopsWorkspace(storage, { now: NOW });
  assert.equal(status.state, FINOPS_STATE.unsupported);
  assert.equal(status.nextAction.code, "update_page");
  assert.match(status.summary, /newer version/);
  // Erasure is still reachable: it is the visitor's own choice, not a repair.
  assert.equal(status.canForget, true);
});

test("malformed stored text is reported as unreadable and never reinterpreted", () => {
  for (const text of ["{ truncated", "[]", "null", JSON.stringify({ periods: [] })]) {
    const storage = storageOf({ [FINOPS_WORKSPACE_KEY]: text });
    const read = readFinopsDocument(storage);
    assert.equal(read.access, "unreadable", text);
    assert.equal(read.document.periods.length, 0);
    assert.equal(storage.getItem(FINOPS_WORKSPACE_KEY), text);
  }
  assert.equal(migrateFinopsWorkspace([]).status, MIGRATION_STATUS.malformed);
  assert.equal(migrateFinopsWorkspace({ schemaVersion: 7 }).status, MIGRATION_STATUS.malformed);
  assert.equal(migrateFinopsWorkspace({ schemaVersion: FINOPS_WORKSPACE_VERSION }).status,
    MIGRATION_STATUS.current);
});

/* ------------------------------ 2. validated ------------------------------- */

test("a hand-edited record is dropped on read and counted, and the good ones survive", () => {
  const storage = retaining({ months: ["2026-05", "2026-06"] });
  const document = JSON.parse(storage.getItem(FINOPS_WORKSPACE_KEY));
  document.periods.push({ periodId: "user:2026-07", period: "2026-07", dataset: "user" });
  document.periods.push({ ...document.periods[0], periodId: "user:2026-04", period: "2026-04", recordsTotal: "many" });
  document.commitments = [{ commitmentId: "no-claim-here" }];
  storage.setItem(FINOPS_WORKSPACE_KEY, JSON.stringify(document));

  const read = readFinopsDocument(storage);
  assert.deepEqual(read.document.periods.map((period) => period.period), ["2026-05", "2026-06"]);
  assert.equal(read.document.commitments.length, 0);
  assert.equal(read.dropped, 3);
  assert.equal(readFinopsWorkspace(storage, { now: NOW }).counts.dropped, 3);
});

test("the record validators name what is wrong rather than throwing", () => {
  assert.deepEqual(validateRetainedPeriod(periodOf()).errors, []);
  assert.equal(validateRetainedPeriod(null).ok, false);
  assert.match(validateRetainedPeriod({ ...periodOf(), period: "June" }).errors.join(" "),
    /period\.period/);
  assert.match(validateRetainedPeriod({ ...periodOf(), confidence: "great" }).errors.join(" "),
    /confidence/);

  const commitment = projectRetainedCommitment({
    metadata: metadataOf(), approvedAt: "2026-07-02T09:15:00.000Z",
  });
  assert.deepEqual(validateRetainedCommitment(commitment).errors, []);
  assert.match(validateRetainedCommitment({
    ...commitment, claim: { ...commitment.claim, monthlySavingsMinor: "a lot" },
  }).errors.join(" "), /monthlySavingsMinor/);
  assert.match(validateRetainedCommitment({
    ...commitment, provenance: { ...commitment.provenance, recordIds: ["rec-1"] },
  }).errors.join(" "), /provenance/);
});

test("an approved commitment is projected without a source id, a row id, or an approver", () => {
  const projected = projectRetainedCommitment({
    metadata: metadataOf(),
    decisionId: "finops-commitment-route-support-triage-to-haiku",
    approvedAt: "2026-07-02T09:15:00.000Z",
  });

  assert.deepEqual(Object.keys(projected.provenance).sort(),
    ["analysisPeriod", "designation", "recordCount"]);
  assert.equal(projected.status, "decision_linked");
  assert.equal(projected.periodId, "user:2026-06");
  const serialized = JSON.stringify(projected);
  for (const forbidden of ["rec-0f21", "example-dataset", "approvedBy", "importedAt"]) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} reached the store`);
  }
  // No instant, no key.
  assert.equal(projectRetainedCommitment({ metadata: metadataOf() }), null);
  assert.equal(projectRetainedCommitment({ approvedAt: NOW.toISOString() }), null);
});

/* -------------------------------- 3. opt-in -------------------------------- */

test("nothing is written to a browser that was never asked, or that declined", () => {
  for (const consent of [null, FINOPS_CONSENT.declined]) {
    const storage = storageOf();
    if (consent) setFinopsConsent(storage, consent, { now: NOW });
    const before = storage.getItem(FINOPS_WORKSPACE_KEY);

    assert.equal(retainFinopsPeriod(storage, periodOf(), { now: NOW }).code, "not_granted");
    assert.equal(retainApprovedCommitment(storage, {
      metadata: metadataOf(), approvedAt: NOW.toISOString(),
    }, { now: NOW }).code, "not_granted");
    assert.equal(storage.getItem(FINOPS_WORKSPACE_KEY), before);
    assert.deepEqual(readRetainedCommitments(storage), []);
    assert.equal(restoreFinopsWorkspace(storage, { now: NOW }).available, false);
    assert.equal(restoreFinopsWorkspace(storage, { now: NOW }).reason, "not_granted");
  }
});

test("withdrawing consent drops the retained commitments with the periods", () => {
  const storage = retaining();
  retainApprovedCommitment(storage, {
    metadata: metadataOf(), decisionId: "finops-commitment-route-support-triage-to-haiku",
    approvedAt: "2026-07-02T09:15:00.000Z",
  }, { now: NOW });
  assert.equal(readRetainedCommitments(storage).length, 1);

  setFinopsConsent(storage, FINOPS_CONSENT.declined, { now: NOW });
  const read = readFinopsDocument(storage);
  assert.equal(read.document.commitments.length, 0);
  assert.equal(read.document.periods.length, 0);
});

test("the export carries the commitments, and forgetting removes every key", () => {
  const storage = retaining();
  retainApprovedCommitment(storage, {
    metadata: metadataOf(), decisionId: "finops-commitment-route-support-triage-to-haiku",
    approvedAt: "2026-07-02T09:15:00.000Z",
  }, { now: NOW });

  const file = finopsWorkspaceFile(storage, { now: NOW });
  assert.equal(file.workspace.schemaVersion, FINOPS_WORKSPACE_VERSION);
  assert.equal(file.workspace.commitments.length, 1);
  assert.equal(file.workspace.commitments[0].commitmentId, "route-support-triage-to-haiku");
  assert.equal(JSON.stringify(file).includes("rec-0f21"), false);

  assert.equal(forgetFinopsWorkspace(storage).ok, true);
  assert.equal(readFinopsDocument(storage).document.commitments.length, 0);
  assert.equal(readFinopsWorkspace(storage, { now: NOW }).state, FINOPS_STATE.notAsked);
});

test("a commitment carrying forbidden content is refused at the door", () => {
  const storage = retaining();
  const commitment = projectRetainedCommitment({
    metadata: metadataOf(), approvedAt: "2026-07-02T09:15:00.000Z",
  });
  const result = retainFinopsCommitment(storage, {
    ...commitment,
    provenance: { ...commitment.provenance, designation: "owner@example.com" },
  }, { now: NOW });

  assert.equal(result.ok, false);
  assert.equal(result.code, "refused_content");
  assert.equal(result.violations[0].code, "email_address");
  assert.equal(readRetainedCommitments(storage).length, 0);
});

/* ------------------------------ 4. integrated ------------------------------ */

test("a later visit restores the briefing, the trend, and the reconciliation", () => {
  const storage = retaining({ months: ["2026-05", "2026-06"] });
  retainApprovedCommitment(storage, {
    metadata: metadataOf(), decisionId: "finops-commitment-route-support-triage-to-haiku",
    approvedAt: "2026-07-02T09:15:00.000Z",
  }, { now: NOW });

  // A different visit: nothing but the two storage keys crosses over.
  const later = restoreFinopsWorkspace(storageOf({
    [FINOPS_WORKSPACE_KEY]: storage.getItem(FINOPS_WORKSPACE_KEY),
  }), { now: NOW });

  assert.equal(later.available, true);
  assert.equal(later.briefing.period, "2026-06");
  assert.match(later.briefing.statement, /kept in this browser since/);
  assert.equal(later.trend.available, true);
  assert.deepEqual(later.trend.months, ["2026-05", "2026-06"]);
  assert.equal(later.trend.direction, "flat");

  const [row] = later.reconciliation.rows;
  assert.equal(row.commitmentId, "route-support-triage-to-haiku");
  assert.equal(row.status, "compared");
  assert.equal(row.plannedMonthlySavingsMinor, 612_000);
  assert.equal(row.scenarioMinor, 520_000);
  assert.equal(row.varianceMinor, 92_000);
  assert.match(row.statement, /Neither figure is a measured saving/);
  assert.match(later.provenance.map((entry) => entry.detail).join(" "), /local storage/);
});

test("a trend is refused rather than invented when there is one month or two rulesets", () => {
  const one = restoreFinopsWorkspace(retaining(), { now: NOW });
  assert.equal(one.trend.available, false);
  assert.equal(one.trend.reason, "one_period");

  const storage = retaining({ months: ["2026-05", "2026-06"] });
  const document = JSON.parse(storage.getItem(FINOPS_WORKSPACE_KEY));
  document.periods[0].briefingContractVersion = "finops-briefing/0.9.0";
  storage.setItem(FINOPS_WORKSPACE_KEY, JSON.stringify(document));

  const mixed = restoreFinopsWorkspace(storage, { now: NOW });
  assert.equal(mixed.trend.available, false);
  assert.equal(mixed.trend.reason, "contract_changed");
  assert.match(mixed.trend.statement, /different rules/);
});

test("a commitment whose period is not retained is stated, not silently compared", () => {
  const storage = retaining({ months: ["2026-06"] });
  retainApprovedCommitment(storage, {
    metadata: metadataOf({ commitmentId: "route-billing-to-haiku", period: "2026-03" }),
    approvedAt: "2026-04-02T09:15:00.000Z",
  }, { now: NOW });

  const [row] = restoreFinopsWorkspace(storage, { now: NOW }).reconciliation.rows;
  assert.equal(row.status, "period_not_retained");
  assert.equal(row.varianceMinor, null);
  assert.match(row.statement, /not retained in this browser/);
});

/* ------------------- the commitment surface, in the browser ---------------- */

async function commitmentPage(storage) {
  const page = await loadPage(PAGE, {
    storage,
    routes: { "/savings-commitment-fixture.json": FIXTURE },
  });
  await importPageModule("/savings-commitment-page.js");
  await waitFor(() => page.document.getElementById("savings-commitment")
    .getAttribute("aria-busy") === "false", "the commitment to render");
  return page;
}

test("approving on the commitment page writes to the opt-in store, and a return visit reads it", async () => {
  // Visit one: retention granted on the workspace page, then a commitment
  // approved here. The page writes both the decision and the workspace record.
  const consenting = storageOf();
  setFinopsConsent(consenting, FINOPS_CONSENT.granted, { now: NOW });
  const first = await commitmentPage({
    [FINOPS_WORKSPACE_KEY]: consenting.getItem(FINOPS_WORKSPACE_KEY),
  });
  assert.equal(first.document.getElementById("commit-retained").hidden, true);

  first.document.getElementById("commit-record-owner").value = "Dana Ruiz";
  first.document.getElementById("commit-record-submit").click();
  await waitFor(() => first.document.querySelector(".commit-recorded") !== null,
    "the decision to be recorded");

  const retained = readRetainedCommitments(first.storage);
  assert.equal(retained.length, 1);
  assert.equal(retained[0].status, "decision_linked");
  assert.match(retained[0].decisionId, /^finops-commitment-/);
  assert.equal(JSON.stringify(retained).includes("Dana Ruiz"), false);

  // Visit two: the same browser, a fresh page, no file reopened.
  const second = await commitmentPage({
    [FINOPS_WORKSPACE_KEY]: first.storage.getItem(FINOPS_WORKSPACE_KEY),
  });
  const line = second.document.getElementById("commit-retained");
  assert.equal(line.hidden, false);
  assert.match(line.textContent, /already recorded 1 commitment/);
  assert.match(line.textContent, /no file was reopened/);
});

/* --------------- the briefing surface, in the shipped markup --------------- */

test("the AI FinOps page paints the restored period, trend, and commitments", async () => {
  const storage = retaining({ months: ["2026-05", "2026-06"] });
  retainApprovedCommitment(storage, {
    metadata: metadataOf(), decisionId: "finops-commitment-route-support-triage-to-haiku",
    approvedAt: "2026-07-02T09:15:00.000Z",
  }, { now: NOW });

  const page = await loadPage(new URL("../src/evolution.html", import.meta.url));
  const { document } = page;
  const region = document.getElementById("workspace-restore");
  // Hidden until something is restored: a visitor who declined never sees it.
  assert.equal(region.hidden, true);
  assert.equal(applyWorkspaceRestore(document, restoreFinopsWorkspace(storageOf(), { now: NOW })),
    "empty");
  assert.equal(region.hidden, true);

  const state = applyWorkspaceRestore(document, restoreFinopsWorkspace(storage, { now: NOW }));
  assert.equal(state, "restored");
  assert.equal(region.hidden, false);
  assert.equal(region.dataset.period, "2026-06");
  assert.match(document.getElementById("workspace-restore-summary").textContent,
    /2026-06.*kept in this browser since/s);
  assert.match(document.getElementById("workspace-restore-trend").textContent,
    /2026-05.*2026-06/s);
  assert.match(document.getElementById("workspace-restore-reconciliation").textContent,
    /1 approved commitment kept in this browser/);
  const rows = [...document.getElementById("workspace-restore-commitments").children];
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /route-support-triage-to-haiku/);
  assert.match(document.getElementById("workspace-restore-provenance").textContent,
    /shiplog\.finops\.workspace\.v1/);
});

test("the AI FinOps page reads the store on cold load and again after retaining", async () => {
  // The wiring itself, pinned in the shipped entry: without the cold-load call a
  // returning visitor sees the region only after importing something again.
  const source = await readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8");
  assert.match(source, /import \{ restoreFinopsWorkspace \} from "\/finops-workspace-restore\.js"/);
  assert.equal(source.match(/syncWorkspaceRestore\(\);/g).length, 2);
  assert.match(source, /applyDatasetProvenance\(document, false\);\n(?:\s*\/\/.*\n)*\s*syncWorkspaceRestore\(\);/);
});

test("a browser that never opted in shows no restored commitment line at all", async () => {
  const page = await commitmentPage({});
  const line = page.document.getElementById("commit-retained");
  assert.equal(line.hidden, true);
  assert.equal(line.textContent, "");
  assert.equal(page.storage.getItem(FINOPS_WORKSPACE_KEY), null);

  page.document.getElementById("commit-record-owner").value = "Dana Ruiz";
  page.document.getElementById("commit-record-submit").click();
  await waitFor(() => page.document.querySelector(".commit-recorded") !== null,
    "the decision to be recorded");
  // The decision is recorded; the workspace stays empty, because consent is the
  // gate and this page is not where it is given.
  assert.equal(page.storage.getItem(FINOPS_WORKSPACE_KEY), null);
  assert.equal(page.document.getElementById("commit-retained").hidden, true);
});
