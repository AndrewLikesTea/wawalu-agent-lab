// The release export's decision links and acceptance flag (#2985): each
// release's linked decisions with their status, whether it ships one that is
// not accepted, and each decision's releases, all read off the same resolution
// the Releases row draws. A dangling link is exported as an explicit unresolved
// entry and counts as not accepted, as it does on the row (#2980).
import test from "node:test";
import assert from "node:assert/strict";
import { buildReleaseExport } from "../src/release-export.js";
import { filterReleases, shipsUnacceptedDecision, summarizeReleases, unacceptedDecisions } from "../src/releases.js";

const AT = "2026-10-22T12:00:00.000Z";
const DECISIONS = [
  { id: "d-ok", title: "Adopt a durable queue", owner: "Kai", status: "accepted", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "d-maybe", title: "Cache the read path", owner: "Ari", status: "proposed", createdAt: "2026-01-02T00:00:00.000Z" },
];
const RELEASES = [
  { id: "r-a", version: "v1.0.0", status: "completed", createdAt: "2026-02-01T00:00:00.000Z", decisionIds: ["d-ok", "d-maybe"] },
  { id: "r-b", version: "v1.1.0", status: "completed", createdAt: "2026-03-01T00:00:00.000Z", decisionIds: ["d-gone"] },
];

const shown = summarizeReleases(RELEASES, DECISIONS);
const linkFor = (payload, id) => payload.releaseLinks.find((entry) => entry.releaseId === id);

test("the export completes with a dangling link and keeps the release", () => {
  const payload = buildReleaseExport(shown, { generatedAt: AT });
  assert.deepEqual(payload.releases.map((release) => release.id), ["r-b", "r-a"]);
  assert.deepEqual(payload.releaseLinks.map((entry) => entry.releaseId), ["r-b", "r-a"], "one entry per release, in file order");
});

test("each release lists its decisions with status, and the not-accepted flag", () => {
  const payload = buildReleaseExport(shown, { generatedAt: AT });
  assert.deepEqual(linkFor(payload, "r-a"), {
    releaseId: "r-a",
    decisions: [
      { id: "d-ok", title: "Adopt a durable queue", status: "accepted" },
      { id: "d-maybe", title: "Cache the read path", status: "proposed" },
    ],
    shipsUnacceptedDecision: true,
  });
  assert.deepEqual(linkFor(payload, "r-b"), {
    releaseId: "r-b",
    decisions: [{ id: "d-gone", title: null, status: null, unresolved: true }],
    shipsUnacceptedDecision: true,
  });
});

test("each decision lists the releases that shipped it, agreeing with the release side", () => {
  const payload = buildReleaseExport(shown, { generatedAt: AT });
  assert.deepEqual(payload.decisions, [
    { id: "d-ok", title: "Adopt a durable queue", status: "accepted", releaseIds: ["r-a"] },
    { id: "d-maybe", title: "Cache the read path", status: "proposed", releaseIds: ["r-a"] },
  ]);
  for (const decision of payload.decisions) {
    for (const releaseId of decision.releaseIds) {
      assert.ok(linkFor(payload, releaseId).decisions.some((entry) => entry.id === decision.id));
    }
  }
  for (const { releaseId, decisions } of payload.releaseLinks) {
    for (const entry of decisions.filter((link) => !link.unresolved)) {
      assert.ok(payload.decisions.find((decision) => decision.id === entry.id).releaseIds.includes(releaseId));
    }
  }
});

test("the existing release records and envelope keys are unchanged, new keys come last", () => {
  const payload = buildReleaseExport(shown, { generatedAt: AT });
  assert.deepEqual(Object.keys(payload), [
    "schema", "version", "generatedAt", "notice", "release_count", "releases", "releaseLinks", "decisions",
  ]);
});

test("one predicate answers the row's flag, the filter and the export", () => {
  const [b, a] = shown;
  assert.equal(shipsUnacceptedDecision(a), true);
  assert.equal(shipsUnacceptedDecision(b), true, "a link to a decision the log does not hold is not accepted");
  assert.equal(shipsUnacceptedDecision(summarizeReleases([{ ...RELEASES[0], decisionIds: ["d-ok"] }], DECISIONS)[0]), false);
  assert.equal(shipsUnacceptedDecision(summarizeReleases([{ ...RELEASES[0], decisionIds: [] }], DECISIONS)[0]), false);
  assert.equal(shipsUnacceptedDecision(a), unacceptedDecisions(a).length > 0);
  const filtered = filterReleases(RELEASES, DECISIONS, { unaccepted: "only" }).map((release) => release.id);
  const exported = buildReleaseExport(shown, { generatedAt: AT }).releaseLinks
    .filter((entry) => entry.shipsUnacceptedDecision).map((entry) => entry.releaseId);
  assert.deepEqual(exported, filtered);
});
