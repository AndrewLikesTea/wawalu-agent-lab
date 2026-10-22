// Each exported release names its decisions and whether it ships one that is
// not accepted (#2985). `decision_links` is the history row's join
// (resolveRelease) read against the whole store; `ships_unaccepted` is the
// releases page's own predicate, shipsUnacceptedDecision. A dangling link is
// kept as `{ id, title: null, status: null, unresolved: true }` and counts as
// not accepted, because an unknown decision cannot be shown to be accepted.

import test from "node:test";
import assert from "node:assert/strict";
import { STORAGE_KEY } from "../src/app.js";
import {
  RELEASE_STORAGE_KEY,
  UNACCEPTED_ONLY,
  filterReleases,
  shipsUnacceptedDecision,
  summarizeReleases,
} from "../src/releases.js";
import { createShiplogExport } from "../src/shiplog-export.js";
import { parseImport } from "../src/shiplog-import.js";
import { shiplogExportViolations } from "../src/shiplog-export-schema.js";

const decision = (id, title, status, createdAt) => ({
  id, title, status, createdAt, context: `Context for ${title}.`, alternatives: "None.", owner: "Ari",
});
const DECISIONS = [
  decision("links-d-accepted", "Adopt the queue", "accepted", "2026-09-01T10:00:00.000Z"),
  decision("links-d-proposed", "Shard the store", "proposed", "2026-09-02T10:00:00.000Z"),
];
const RELEASES = [
  { id: "links-r-both", version: "v2.0.0", title: "Both", createdAt: "2026-09-03T10:00:00.000Z",
    decisionIds: ["links-d-accepted", "links-d-proposed"] },
  { id: "links-r-dangling", version: "v2.1.0", title: "Dangling", createdAt: "2026-09-04T10:00:00.000Z",
    decisionIds: ["links-d-gone"] },
];

function storage(decisions, releases) {
  const values = { [STORAGE_KEY]: JSON.stringify(decisions), [RELEASE_STORAGE_KEY]: JSON.stringify(releases) };
  return { getItem: (key) => values[key] ?? null };
}

const exportOf = (decisions = DECISIONS, releases = RELEASES, options = {}) => JSON.parse(JSON.stringify(
  createShiplogExport(storage(decisions, releases), { generatedAt: "2026-10-22T12:00:00.000Z", ...options })));

test("every release carries its decision links and the unaccepted flag", () => {
  const payload = exportOf();
  assert.deepEqual(payload.releases.map(({ id, decision_links: links, ships_unaccepted: flag }) => ({ id, links, flag })), [
    {
      id: "links-r-both",
      links: [
        { id: "links-d-accepted", title: "Adopt the queue", status: "accepted", unresolved: false },
        { id: "links-d-proposed", title: "Shard the store", status: "proposed", unresolved: false },
      ],
      flag: true,
    },
    {
      id: "links-r-dangling",
      links: [{ id: "links-d-gone", title: null, status: null, unresolved: true }],
      flag: true,
    },
  ]);
  // Reverse side, shipped by #2986.
  assert.deepEqual(payload.decisions.map(({ id, shipped_in: shippedIn, shipped_while_unaccepted: flag }) => ({ id, shippedIn, flag })), [
    { id: "links-d-accepted", shippedIn: [{ id: "links-r-both", version: "v2.0.0" }], flag: false },
    { id: "links-d-proposed", shippedIn: [{ id: "links-r-both", version: "v2.0.0" }], flag: true },
  ]);
  assert.deepEqual(shiplogExportViolations(payload), []);
});

test("new release keys come after every legacy key, which keep their values", () => {
  const [both, dangling] = exportOf().releases;
  assert.deepEqual(Object.keys(both).slice(-2), ["decision_links", "ships_unaccepted"]);
  assert.deepEqual(Object.keys(dangling).slice(-3), ["unresolved_decision_ids", "decision_links", "ships_unaccepted"]);
  // The resolved join is unchanged: the dangling id stays out of decisionIds.
  assert.deepEqual(dangling.decisionIds, []);
  assert.deepEqual(dangling.unresolved_decision_ids, ["links-d-gone"]);
});

test("release→decision and decision→release are exact inverses", () => {
  const payload = exportOf();
  const forward = payload.releases.flatMap((release) => release.decision_links
    .filter((link) => !link.unresolved).map((link) => `${release.id}→${link.id}`));
  const backward = payload.decisions.flatMap((record) => record.shipped_in.map((release) => `${release.id}→${record.id}`));
  assert.deepEqual([...forward].sort(), [...backward].sort());
  assert.deepEqual(forward.sort(), ["links-r-both→links-d-accepted", "links-r-both→links-d-proposed"]);
});

test("a release linking only accepted decisions is not flagged", () => {
  const payload = exportOf(DECISIONS, [{ ...RELEASES[0], decisionIds: ["links-d-accepted"] }]);
  assert.equal(payload.releases[0].ships_unaccepted, false);
  assert.deepEqual(exportOf(DECISIONS, [{ ...RELEASES[0], decisionIds: [] }]).releases[0]
    .decision_links, []);
});

test("the export flag and the releases page filter use the same predicate", () => {
  const resolved = summarizeReleases(RELEASES, DECISIONS);
  const payload = exportOf();
  for (const release of resolved) {
    const exported = payload.releases.find((record) => record.id === release.id);
    assert.equal(exported.ships_unaccepted, shipsUnacceptedDecision(release), release.id);
  }
  assert.deepEqual(filterReleases(RELEASES, DECISIONS, { unaccepted: UNACCEPTED_ONLY }).map((r) => r.id).sort(),
    ["links-r-both", "links-r-dangling"]);
});

test("a filter-hidden decision still resolves in a release's links", () => {
  const payload = exportOf(DECISIONS, RELEASES, { scope: { filtered: true, decisionIds: ["links-d-accepted"], releaseIds: ["links-r-both"] } });
  assert.deepEqual(payload.decisions.map((record) => record.id), ["links-d-accepted"]);
  assert.deepEqual(payload.releases.map((record) => record.id), ["links-r-both"]);
  assert.deepEqual(payload.releases[0].decision_links.map((link) => link.unresolved), [false, false]);
  assert.equal(payload.releases[0].ships_unaccepted, true);
});

test("importing an export drops the derived release fields", () => {
  const result = parseImport(JSON.stringify(exportOf()));
  assert.equal(result.ok, true);
  for (const release of result.releases) {
    assert.equal("decision_links" in release, false);
    assert.equal("ships_unaccepted" in release, false);
  }
});
