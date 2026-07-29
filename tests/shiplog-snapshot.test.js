// The linked Shiplog snapshot served by /api/exports.
//
// What an engineering lead needs from the downloaded file is that it is the
// whole log and that its associations mean something: every decision, every
// release, an explicit link per association, and nothing on either side quietly
// dropped for having no counterpart. Each test below pins one of those, plus
// the two things a download is (valid JSON, and headers that make it a file).

import test from "node:test";
import assert from "node:assert/strict";
import {
  EXPORT_VERSION,
  createD1ExportStore,
  createExport,
  handleExportRequest,
} from "../src/exports.js";
import { linkShiplogRecords } from "../src/shiplog-snapshot.js";

const NOW = new Date("2026-07-29T10:00:00.000Z");

function decisionRow(overrides = {}) {
  return {
    id: "d-linked",
    title: "Adopt durable queues",
    context: "Retries were losing work",
    alternatives: "Polling",
    owner: "Rowan",
    status: "accepted",
    createdAt: "2026-07-20T08:00:00.000Z",
    ...overrides,
  };
}

function releaseRow(overrides = {}) {
  return {
    id: "r-linked",
    version: "v1.2.0",
    title: "Queue delivery",
    description: "Durable work",
    owner: "Rowan",
    status: "completed",
    createdAt: "2026-07-21T09:00:00.000Z",
    decisionIds: ["d-linked"],
    ...overrides,
  };
}

// A decision every release ignores, and a release that names no decision. Both
// edges of the join, in one fixture, so no test can pass by handling only the
// linked case.
const UNLINKED_DECISION = decisionRow({
  id: "d-orphan",
  title: "Freeze the schema",
  createdAt: "2026-07-22T08:00:00.000Z",
});
const UNLINKED_RELEASE = releaseRow({
  id: "r-orphan",
  version: "v1.3.0",
  title: "Docs refresh",
  createdAt: "2026-07-23T09:00:00.000Z",
  decisionIds: [],
});

function store(decisions, releases) {
  return {
    async listDecisions() { return structuredClone(decisions); },
    async listReleases() { return structuredClone(releases); },
  };
}

async function exportAll(decisions, releases, options = {}) {
  const response = await handleExportRequest(
    new Request("https://shiplog.test/api/exports"),
    { store: store(decisions, releases), now: () => NOW, requestId: "snapshot-1", ...options },
  );
  const body = await response.text();
  return { response, body, payload: JSON.parse(body) };
}

test("the snapshot states every release-to-decision association as its own record", async () => {
  const second = decisionRow({ id: "d-second", createdAt: "2026-07-20T09:00:00.000Z" });
  const release = releaseRow({ decisionIds: ["d-second", "d-linked"] });
  const { payload } = await exportAll([decisionRow(), second], [release]);

  assert.deepEqual(payload.links, [
    // Position is the order the release recorded, kept as recorded: that
    // sequence is authored content, not an artifact of storage.
    { releaseId: "r-linked", decisionId: "d-second", position: 0 },
    { releaseId: "r-linked", decisionId: "d-linked", position: 1 },
  ]);
  assert.deepEqual(payload.releases[0].decisionIds, ["d-second", "d-linked"]);
  assert.deepEqual(payload.metadata.counts, {
    decisions: 2, releases: 1, links: 2,
    decisionsWithoutReleases: 0, releasesWithoutDecisions: 0,
  });
  for (const link of payload.links) {
    assert.ok(
      payload.decisions.some((decision) => decision.id === link.decisionId),
      `link to ${link.decisionId} resolves inside the file`,
    );
    assert.ok(
      payload.releases.some((release) => release.id === link.releaseId),
      `link from ${link.releaseId} resolves inside the file`,
    );
  }
});

test("a decision no release mentions is exported in full, not dropped for having no link", async () => {
  const { payload } = await exportAll(
    [decisionRow(), UNLINKED_DECISION],
    [releaseRow()],
  );

  const orphan = payload.decisions.find((decision) => decision.id === "d-orphan");
  assert.deepEqual(orphan, UNLINKED_DECISION);
  assert.equal(payload.links.filter((link) => link.decisionId === "d-orphan").length, 0);
  assert.equal(payload.metadata.counts.decisionsWithoutReleases, 1);
  assert.equal(payload.metadata.counts.decisions, 2);
});

test("a release that names no decision is exported in full, with an empty association list", async () => {
  const { payload } = await exportAll(
    [decisionRow()],
    [releaseRow(), UNLINKED_RELEASE],
  );

  const orphan = payload.releases.find((release) => release.id === "r-orphan");
  assert.deepEqual(orphan, UNLINKED_RELEASE);
  assert.deepEqual(orphan.decisionIds, [], "an unlinked release still declares the field");
  assert.equal(payload.links.filter((link) => link.releaseId === "r-orphan").length, 0);
  assert.equal(payload.metadata.counts.releasesWithoutDecisions, 1);
  assert.equal(payload.metadata.counts.releases, 2);
});

test("a release with no decisionIds column at all still exports as an unlinked release", async () => {
  const bare = releaseRow({ id: "r-bare", createdAt: "2026-07-24T09:00:00.000Z" });
  delete bare.decisionIds;
  const { payload } = await exportAll([decisionRow()], [bare]);

  assert.deepEqual(payload.releases.at(-1).decisionIds, []);
  assert.deepEqual(payload.links, []);
  assert.equal(payload.metadata.counts.releasesWithoutDecisions, 1);
});

test("an association to a decision the tables no longer hold is reported, never exported dangling", async () => {
  const release = releaseRow({ decisionIds: ["d-gone", "d-linked"] });
  const { payload } = await exportAll([decisionRow()], [release]);

  assert.deepEqual(payload.links, [
    { releaseId: "r-linked", decisionId: "d-linked", position: 1 },
  ]);
  assert.deepEqual(payload.metadata.unresolvedLinks, [
    { releaseId: "r-linked", decisionId: "d-gone", position: 0 },
  ]);
  assert.deepEqual(
    payload.releases[0].decisionIds, ["d-linked"],
    "the release's own list agrees with the links list",
  );
});

test("only declared Shiplog fields leave the server", async () => {
  // The store reads whole rows, so anything a future migration adds to these
  // tables would ride along unless the export projects an allowlist.
  const decision = decisionRow({
    customer_email: "lead@example.com",
    session_cookie: "sid=abc",
    internal_api_key: "sk-live-1234",
  });
  const release = releaseRow({ telemetry_events: [{ event: "click" }], internal_notes: "do not ship" });
  const { payload, response, body } = await exportAll([decision], [release]);

  for (const secret of ["customer_email", "lead@example.com", "session_cookie", "sk-live-1234", "telemetry_events", "internal_notes"]) {
    assert.doesNotMatch(body, new RegExp(secret), `${secret} must not reach the export`);
  }
  assert.deepEqual(Object.keys(payload.decisions[0]), [
    "id", "title", "context", "alternatives", "owner", "status", "createdAt",
  ]);
  assert.deepEqual(Object.keys(payload.releases[0]), [
    "id", "version", "title", "description", "owner", "status", "createdAt", "decisionIds",
  ]);
  assert.equal(response.status, 200);
});

test("records are written in canonical order however the rows arrive", async () => {
  const early = decisionRow({ id: "d-b", createdAt: "2026-07-01T00:00:00.000Z" });
  const tieA = decisionRow({ id: "d-a", createdAt: "2026-07-02T00:00:00.000Z" });
  const tieZ = decisionRow({ id: "d-z", createdAt: "2026-07-02T00:00:00.000Z" });
  const late = releaseRow({ id: "r-late", createdAt: "2026-07-09T00:00:00.000Z", decisionIds: [] });
  const soon = releaseRow({ id: "r-soon", createdAt: "2026-07-03T00:00:00.000Z", decisionIds: [] });

  const forward = await exportAll([early, tieA, tieZ], [soon, late]);
  const reversed = await exportAll([tieZ, tieA, early], [late, soon]);

  assert.deepEqual(forward.payload.decisions.map((d) => d.id), ["d-b", "d-a", "d-z"]);
  assert.deepEqual(forward.payload.releases.map((r) => r.id), ["r-soon", "r-late"]);
  assert.deepEqual(
    JSON.stringify(forward.payload), JSON.stringify(reversed.payload),
    "the same log exports to the same bytes",
  );
});

test("links are ordered by release, then by the position the release recorded", () => {
  const snapshot = linkShiplogRecords(
    [decisionRow({ id: "d-1" }), decisionRow({ id: "d-2", createdAt: "2026-07-20T08:00:01.000Z" })],
    [
      releaseRow({ id: "r-2", createdAt: "2026-07-25T09:00:00.000Z", decisionIds: ["d-2", "d-1"] }),
      releaseRow({ id: "r-1", createdAt: "2026-07-21T09:00:00.000Z", decisionIds: ["d-1"] }),
    ],
  );

  assert.deepEqual(snapshot.links, [
    { releaseId: "r-1", decisionId: "d-1", position: 0 },
    { releaseId: "r-2", decisionId: "d-2", position: 0 },
    { releaseId: "r-2", decisionId: "d-1", position: 1 },
  ]);
});

test("the download is valid JSON delivered as an attachment", async () => {
  const { response, body } = await exportAll(
    [decisionRow(), UNLINKED_DECISION],
    [releaseRow(), UNLINKED_RELEASE],
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(
    response.headers.get("content-disposition"),
    'attachment; filename="shiplog-all-2026-07-29.json"',
  );
  assert.equal(response.headers.get("x-request-id"), "snapshot-1");

  const parsed = JSON.parse(body);
  assert.equal(parsed.metadata.version, EXPORT_VERSION);
  assert.equal(parsed.metadata.timestamp, NOW.toISOString());
  assert.equal(parsed.decisions.length, 2);
  assert.equal(parsed.releases.length, 2);
  assert.equal(parsed.links.length, 1);
});

test("a single-table export keeps the allowlist and claims no associations", async () => {
  const response = await handleExportRequest(
    new Request("https://shiplog.test/api/exports/releases"),
    {
      store: store([decisionRow()], [releaseRow({ internal_notes: "hidden" })]),
      now: () => NOW,
    },
  );
  const payload = JSON.parse(await response.text());

  assert.equal(payload.links, undefined, "no decisions in the file means no resolvable link");
  assert.equal(payload.decisions, undefined);
  assert.equal(payload.metadata.counts, undefined);
  assert.equal(payload.releases[0].internal_notes, undefined);
  assert.deepEqual(payload.releases[0].decisionIds, ["d-linked"]);
});

test("createExport snapshots the rows it is given rather than holding references", () => {
  const decision = decisionRow();
  const release = releaseRow();
  const payload = createExport({ decisions: [decision], releases: [release] }, {
    timestamp: NOW.toISOString(),
  });

  decision.title = "mutated after export";
  release.decisionIds.push("d-late");
  assert.equal(payload.decisions[0].title, "Adopt durable queues");
  assert.deepEqual(payload.releases[0].decisionIds, ["d-linked"]);
  assert.deepEqual(payload.links, [{ releaseId: "r-linked", decisionId: "d-linked", position: 0 }]);
});

test("the D1 store reads both logs in one batch, each in canonical order", async () => {
  const queries = [];
  const resultFor = (sql) => (sql.includes("decisions")
    ? { success: true, results: [decisionRow()] }
    : { success: true, results: [{ ...releaseRow(), decisionIds: '["d-linked"]' }] });
  const database = {
    prepare(sql) {
      queries.push(sql);
      return { sql, async all() { return resultFor(sql); } };
    },
    async batch(statements) { return statements.map(({ sql }) => resultFor(sql)); },
  };

  const d1 = createD1ExportStore(database);
  const all = await d1.listAll();

  assert.deepEqual(queries, [
    "SELECT * FROM decisions ORDER BY createdAt ASC, id ASC",
    "SELECT * FROM releases ORDER BY createdAt ASC, id ASC",
  ]);
  assert.deepEqual(all.releases[0].decisionIds, ["d-linked"], "the stored JSON column is restored to an array");
  assert.deepEqual(
    createExport(all, { timestamp: NOW.toISOString() }).links,
    [{ releaseId: "r-linked", decisionId: "d-linked", position: 0 }],
  );
});
