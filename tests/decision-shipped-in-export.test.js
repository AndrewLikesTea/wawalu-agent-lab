// Each exported decision says which releases shipped it (#2981).
//
// `shipped_in` is `{ id, version }` per release that names the decision, newest
// first by the history row's own ordering rule (byNewestRelease), `[]` when none
// does. `shipped_while_unaccepted` is true exactly when that list is non-empty
// and the status is not accepted — one predicate, shippedWhileUnaccepted, shared
// with the history view. The fixture is the hand-counted history from
// tests/fixtures/history-count-export.json, so the expected values below can be
// checked by reading it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { STORAGE_KEY, toHistoryRecords } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { buildShiplogExport, createShiplogExport } from "../src/shiplog-export.js";
import { parseImport } from "../src/shiplog-import.js";
import {
  EXPORT_DECISION_FIELDS,
  EXPORT_RELEASE_FIELDS,
  normalizeExportRecord,
  shiplogExportViolations,
} from "../src/shiplog-export-schema.js";
import { shippedWhileUnaccepted } from "../src/shipped-releases.js";

const GENERATED_AT = "2026-10-22T12:00:00.000Z";
const FIXTURE = JSON.parse(await readFile(new URL("./fixtures/history-count-export.json", import.meta.url), "utf8"));

function storage(decisions, releases) {
  const values = {
    [STORAGE_KEY]: JSON.stringify(decisions),
    [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
  };
  return { getItem: (key) => values[key] ?? null };
}

const exportOf = (decisions, releases) =>
  createShiplogExport(storage(decisions, releases), { generatedAt: GENERATED_AT });
const byId = (payload, id) => payload.decisions.find((decision) => decision.id === id);

test("a decision two releases carried lists both, newest first", () => {
  // Stored oldest first, and v1.5.0 names count-d-cache second — so neither the
  // store's order nor the release's own order can produce this answer by luck.
  const payload = exportOf(FIXTURE.decisions, FIXTURE.releases);
  assert.deepEqual(byId(payload, "count-d-cache").shipped_in, [
    { id: "count-r-1-5-0", version: "v1.5.0" },
    { id: "count-r-1-4-0", version: "v1.4.0" },
  ]);
  // The store order does not leak in either: reversed storage, same answer.
  const reversed = exportOf(FIXTURE.decisions, [...FIXTURE.releases].reverse());
  assert.deepEqual(byId(reversed, "count-d-cache").shipped_in, byId(payload, "count-d-cache").shipped_in);
});

test("the flag is true only for a shipped decision that is not accepted", () => {
  const payload = exportOf(FIXTURE.decisions, FIXTURE.releases);
  const pick = (id) => {
    const { shipped_in: shippedIn, shipped_while_unaccepted: flag } = byId(payload, id);
    return { shippedIn: shippedIn.map((release) => release.version), flag };
  };
  // Accepted and shipped.
  assert.deepEqual(pick("count-d-cache"), { shippedIn: ["v1.5.0", "v1.4.0"], flag: false });
  // Pending and shipped.
  assert.deepEqual(pick("count-d-flags"), { shippedIn: ["v1.5.0"], flag: true });
  // Proposed and unshipped.
  assert.deepEqual(pick("count-d-queue"), { shippedIn: [], flag: false });
  // Accepted and unshipped: an empty list, never an absent field.
  assert.deepEqual(pick("count-d-retention"), { shippedIn: [], flag: false });
  for (const decision of payload.decisions) {
    assert.ok(Array.isArray(decision.shipped_in), `${decision.id} has no shipped_in array`);
    assert.equal(typeof decision.shipped_while_unaccepted, "boolean");
  }
});

test("the retired 'approved' reads as accepted, as it does everywhere else", () => {
  const [cache] = FIXTURE.decisions;
  const payload = exportOf([{ ...cache, status: "approved" }], FIXTURE.releases);
  assert.equal(payload.decisions[0].shipped_while_unaccepted, false);
  assert.equal(shippedWhileUnaccepted({ status: "approved", shippedCount: 1 }), false);
  assert.equal(shippedWhileUnaccepted({ status: "superseded", shippedCount: 2 }), true);
  assert.equal(shippedWhileUnaccepted({ status: "pending", shippedCount: 0 }), false);
  assert.equal(shippedWhileUnaccepted({ status: "pending" }), false, "a missing count is not a shipment");
});

test("a release naming a decision the log lacks neither throws nor invents one", () => {
  const dangling = {
    id: "count-r-dangling", version: "v9.0.0", createdAt: "2026-06-01T09:00:00.000Z",
    decisionIds: ["count-d-gone", "count-d-queue"],
  };
  const releases = [...FIXTURE.releases, dangling];
  const before = buildShiplogExport(storage(FIXTURE.decisions, releases), { generatedAt: GENERATED_AT });

  // The release and its links are exactly what the exporter wrote before this
  // change: the resolved join omits the missing id; the release retains it
  // separately as evidence, without inventing a resolvable decision.
  assert.deepEqual(before.payload.releases.at(-1).unresolved_decision_ids, ["count-d-gone"]);
  assert.deepEqual(before.payload.releases.at(-1).decisionIds, ["count-d-queue"]);
  assert.deepEqual(before.unresolvedLinks, [{ releaseId: "count-r-dangling", decisionId: "count-d-gone", position: 0 }]);
  assert.equal(before.payload.decisions.some((decision) => decision.id === "count-d-gone"), false);
  assert.equal(before.payload.decisions.length, FIXTURE.decisions.length);
  // The decision it does name gets that release, and nothing else does.
  assert.deepEqual(byId(before.payload, "count-d-queue").shipped_in, [{ id: "count-r-dangling", version: "v9.0.0" }]);
  assert.equal(byId(before.payload, "count-d-queue").shipped_while_unaccepted, true);
  const named = before.payload.decisions.flatMap((decision) => decision.shipped_in.map((release) => release.id));
  assert.equal(named.filter((id) => id === "count-r-dangling").length, 1);
  assert.deepEqual(shiplogExportViolations(before.payload), []);
});

test("the fixture export keeps every existing field, record order, and top-level shape", () => {
  const payload = exportOf(FIXTURE.decisions, FIXTURE.releases);
  assert.deepEqual(Object.keys(payload), [
    "schema", "version", "generatedAt", "record_count", "decision_count", "release_count",
    "source", "filter", "decisions", "releases", "associations",
  ]);
  assert.deepEqual(payload.decisions.map((decision) => decision.id), FIXTURE.decisions.map((decision) => decision.id));
  assert.deepEqual(payload.releases.map((release) => release.id), FIXTURE.releases.map((release) => release.id));
  // Each decision is its stored record, field for field and in the same order,
  // with the two derived fields appended after it.
  for (const [index, stored] of FIXTURE.decisions.entries()) {
    const exported = payload.decisions[index];
    const legacy = normalizeExportRecord(stored, EXPORT_DECISION_FIELDS);
    assert.deepEqual(Object.keys(exported), [...Object.keys(legacy), "shipped_in", "shipped_while_unaccepted"]);
    const { shipped_in: _in, shipped_while_unaccepted: _flag, ...rest } = exported;
    assert.deepEqual(rest, legacy);
  }
  // Releases are untouched.
  assert.deepEqual(payload.releases, FIXTURE.releases.map((release) => normalizeExportRecord(release, EXPORT_RELEASE_FIELDS)));
  assert.deepEqual(shiplogExportViolations(payload), []);
});

test("an exported file imports without carrying the derived fields into storage", () => {
  const payload = exportOf(FIXTURE.decisions, FIXTURE.releases);
  const parsed = parseImport(JSON.stringify(payload));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.rejected, []);
  for (const decision of parsed.decisions) {
    assert.equal("shipped_in" in decision, false, `${decision.id} stored shipped_in`);
    assert.equal("shipped_while_unaccepted" in decision, false, `${decision.id} stored the flag`);
  }
});

test("the history row and the export answer from the same rule", () => {
  const payload = exportOf(FIXTURE.decisions, FIXTURE.releases);
  const rows = toHistoryRecords(FIXTURE.decisions, FIXTURE.releases)
    .filter((record) => record.type === "decision");
  for (const row of rows) {
    assert.equal(row.shippedWhileUnaccepted, byId(payload, row.id).shipped_while_unaccepted, row.id);
  }
  assert.deepEqual(rows.filter((row) => row.shippedWhileUnaccepted).map((row) => row.id), ["count-d-flags"]);
});


test("a leader receives every shipping release with its full version, beyond page limits", () => {
  const decision = { ...FIXTURE.decisions[0], status: "pending" };
  const releases = Array.from({ length: 105 }, (_, index) => ({
    id: `evidence-${index}`, version: `v${index}-` + "x".repeat(50),
    createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    decisionIds: [decision.id, decision.id],
  }));
  const exported = exportOf([decision], releases).decisions[0];
  assert.equal(exported.shipped_in.length, 105);
  assert.deepEqual(exported.shipped_in, [...releases].reverse().map(({ id, version }) => ({ id, version })));
  assert.equal(exported.shipped_while_unaccepted, true);
});

test("the flag answers current acceptance, not acceptance at the time of shipping", () => {
  const decision = { ...FIXTURE.decisions[0], status: "pending" };
  assert.equal(exportOf([decision], FIXTURE.releases).decisions[0].shipped_while_unaccepted, true);
  const accepted = { ...decision, status: "accepted" };
  assert.equal(exportOf([accepted], FIXTURE.releases).decisions[0].shipped_while_unaccepted, false);
  const superseded = { ...decision, status: "superseded" };
  assert.equal(exportOf([superseded], FIXTURE.releases).decisions[0].shipped_while_unaccepted, true);
});

test("a filtered decision keeps shipping evidence even when no release row is selected", () => {
  const payload = createShiplogExport(storage(FIXTURE.decisions, FIXTURE.releases), {
    generatedAt: GENERATED_AT,
    scope: { filtered: true, decisionIds: ["count-d-cache"], releaseIds: [], filters: { status: "accepted" } },
  });
  assert.equal(payload.record_count, 1);
  assert.deepEqual(payload.releases, []);
  assert.deepEqual(payload.decisions[0].shipped_in, [
    { id: "count-r-1-5-0", version: "v1.5.0" },
    { id: "count-r-1-4-0", version: "v1.4.0" },
  ]);
});
