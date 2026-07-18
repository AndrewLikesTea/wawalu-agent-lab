import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPORT_VERSION,
  createD1ExportStore,
  createExport,
  handleExportRequest,
} from "../src/exports.js";

const decision = {
  id: "d1", title: "Use queues", context: "Retries", alternatives: "Polling",
  owner: "Rowan", status: "accepted", createdAt: "2026-07-18T08:00:00.000Z",
};
const release = {
  id: "r1", version: "v1.2.0", title: "Queue delivery", description: "Durable work",
  owner: "Rowan", status: "completed", notes: "Shipped", createdAt: "2026-07-18T09:00:00.000Z",
  decisionIds: ["d1"],
};
const NOW = new Date("2026-07-18T10:00:00.000Z");

function store() {
  return {
    async listDecisions() { return [decision]; },
    async listReleases() { return [release]; },
  };
}

test("createExport wraps exact internal records with versioned timestamp metadata", () => {
  const exported = createExport({ decisions: [decision], releases: [release] }, { timestamp: NOW.toISOString() });
  assert.deepEqual(exported, {
    metadata: { timestamp: NOW.toISOString(), version: EXPORT_VERSION },
    decisions: [decision],
    releases: [release],
  });
  assert.notEqual(exported.decisions[0], decision, "the export is a snapshot, not a live record reference");
});

test("combined endpoint exports every decision and release as a JSON attachment", async () => {
  const response = await handleExportRequest(new Request("https://shiplog.test/api/exports"), {
    store: store(), now: () => NOW, requestId: "request-1",
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="shiplog-all-2026-07-18.json"');
  assert.deepEqual(await response.json(), {
    metadata: { timestamp: NOW.toISOString(), version: EXPORT_VERSION },
    decisions: [decision], releases: [release],
  });
});

test("typed endpoints query and return only the requested table", async () => {
  const calls = [];
  const trackedStore = {
    async listDecisions() { calls.push("decisions"); return [decision]; },
    async listReleases() { calls.push("releases"); return [release]; },
  };
  const decisionsResponse = await handleExportRequest(new Request("https://shiplog.test/api/exports/decisions"), {
    store: trackedStore, now: () => NOW,
  });
  assert.deepEqual(calls, ["decisions"]);
  assert.deepEqual(await decisionsResponse.json(), {
    metadata: { timestamp: NOW.toISOString(), version: EXPORT_VERSION }, decisions: [decision],
  });
});

test("endpoint rejects writes and exposes storage failures without leaking details", async () => {
  const method = await handleExportRequest(new Request("https://shiplog.test/api/exports", { method: "POST" }), { store: store(), requestId: "r1" });
  assert.equal(method.status, 405);

  let observed;
  const failure = await handleExportRequest(new Request("https://shiplog.test/api/exports/releases"), {
    store: { async listReleases() { throw new Error("database password in error"); } },
    requestId: "r2", onError: (error) => { observed = error; },
  });
  assert.equal(failure.status, 503);
  const failureBody = await failure.text();
  assert.equal(JSON.parse(failureBody).error.code, "export_unavailable");
  assert.equal(observed.message, "database password in error");
  assert.doesNotMatch(failureBody, /password/);
});

test("D1 adapter reads both complete tables and restores release decisionIds", async () => {
  const queries = [];
  const resultFor = (sql) => sql.includes("decisions")
    ? { success: true, results: [decision] }
    : { success: true, results: [{ ...release, decisionIds: '["d1"]' }] };
  const database = {
    prepare(sql) {
      queries.push(sql);
      return { sql, async all() { return resultFor(sql); } };
    },
    async batch(statements) { return statements.map(({ sql }) => resultFor(sql)); },
  };
  const d1 = createD1ExportStore(database);
  assert.deepEqual(await d1.listDecisions(), [decision]);
  assert.deepEqual(await d1.listReleases(), [release]);
  assert.deepEqual(await d1.listAll(), { decisions: [decision], releases: [release] });
  assert.deepEqual(queries, [
    "SELECT * FROM decisions", "SELECT * FROM releases",
    "SELECT * FROM decisions", "SELECT * FROM releases",
  ]);
});
