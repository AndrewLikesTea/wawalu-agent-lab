import test from "node:test";
import assert from "node:assert/strict";
import {
  selectDecisions,
  uniqueOwners,
  nextFocusIndex,
  DEFAULT_SORT,
  SORTS,
  focusLinkedDecision,
} from "../src/app.js";

// Fixtures deliberately vary title, owner, status, and date so a single set
// exercises every filter and sort path. Ids double as ordering assertions.
const sample = [
  { id: "zebra",  title: "Zebra queue",  context: "c", owner: "Kai", status: "proposed",   createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "alpha",  title: "Alpha cache",  context: "c", owner: "Ari", status: "accepted",   createdAt: "2026-03-01T00:00:00.000Z" },
  { id: "middle", title: "Middle plan",  context: "c", owner: "Kai", status: "accepted",   createdAt: "2026-02-01T00:00:00.000Z" },
  { id: "sunset", title: "sunset flag",  context: "c", owner: "ari", status: "superseded", createdAt: "2026-04-01T00:00:00.000Z" },
];

const ids = (decisions) => decisions.map((decision) => decision.id);

test("defaults to newest-first ordering with no filters", () => {
  assert.deepEqual(ids(selectDecisions(sample)), ["sunset", "alpha", "middle", "zebra"]);
});

test("filters by status", () => {
  assert.deepEqual(ids(selectDecisions(sample, { status: "accepted" })), ["alpha", "middle"]);
  assert.deepEqual(selectDecisions(sample, { status: "proposed" }).length, 1);
});

test("filters by owner (exact, case-sensitive value from the control)", () => {
  assert.deepEqual(ids(selectDecisions(sample, { owner: "Kai" })), ["middle", "zebra"]);
  assert.deepEqual(ids(selectDecisions(sample, { owner: "ari" })), ["sunset"]);
});

test("combines status and owner filters", () => {
  assert.deepEqual(ids(selectDecisions(sample, { status: "accepted", owner: "Kai" })), ["middle"]);
});

test("'all' sentinels and empty view are pass-through", () => {
  assert.equal(selectDecisions(sample, { status: "all", owner: "all" }).length, sample.length);
  assert.equal(selectDecisions(sample, {}).length, sample.length);
});

test("sorts by title alphabetically, case-insensitively", () => {
  assert.deepEqual(ids(selectDecisions(sample, { sort: "title" })), ["alpha", "middle", "sunset", "zebra"]);
});

test("sorts by owner, breaking ties with newest-first", () => {
  // Ari/ari sort together; within the Kai group the Feb entry precedes the Jan one.
  assert.deepEqual(ids(selectDecisions(sample, { sort: "owner" })), ["sunset", "alpha", "middle", "zebra"]);
});

test("unknown sort key falls back to the default order", () => {
  assert.deepEqual(
    ids(selectDecisions(sample, { sort: "nope" })),
    ids(selectDecisions(sample, { sort: DEFAULT_SORT })),
  );
});

test("does not mutate the input array or its order", () => {
  const before = ids(sample);
  selectDecisions(sample, { sort: "title", status: "accepted" });
  assert.deepEqual(ids(sample), before);
});

test("filtering an empty list yields an empty list", () => {
  assert.deepEqual(selectDecisions([], { status: "accepted", owner: "Kai" }), []);
});

test("uniqueOwners returns distinct owners sorted case-insensitively", () => {
  assert.deepEqual(uniqueOwners(sample), ["Ari", "ari", "Kai"]);
  assert.deepEqual(uniqueOwners([]), []);
});

test("every advertised sort option has a comparator", () => {
  for (const key of ["newest", "title", "owner"]) {
    assert.equal(typeof SORTS[key]?.compare, "function");
  }
});

test("nextFocusIndex moves within bounds and clamps at the ends", () => {
  assert.equal(nextFocusIndex(0, "ArrowDown", 3), 1);
  assert.equal(nextFocusIndex(2, "ArrowDown", 3), 2); // clamps at last
  assert.equal(nextFocusIndex(1, "ArrowUp", 3), 0);
  assert.equal(nextFocusIndex(0, "ArrowUp", 3), 0); // clamps at first
  assert.equal(nextFocusIndex(-1, "ArrowDown", 3), 0); // nothing focused yet
  assert.equal(nextFocusIndex(1, "Enter", 3), 2); // Enter advances like ArrowDown
  assert.equal(nextFocusIndex(1, "Home", 3), 0);
  assert.equal(nextFocusIndex(1, "End", 3), 2);
  assert.equal(nextFocusIndex(1, "Tab", 3), 1); // unhandled key is a no-op
  assert.equal(nextFocusIndex(0, "ArrowDown", 0), -1); // empty list
});

test("focusLinkedDecision ignores malformed and unrelated fragments", () => {
  const root = { getElementById: () => null };
  assert.equal(focusLinkedDecision(root, "#elsewhere"), false);
  assert.equal(focusLinkedDecision(root, "#decision-%E0%A4%A"), false);
  assert.equal(focusLinkedDecision(root, "#decision-missing"), false);
});
