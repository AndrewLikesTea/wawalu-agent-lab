// The supersede link, from the storage side.
//
// One rule is under test everywhere here: the link is stored in exactly one
// direction (`supersedes`) and the reverse direction is derived. So the tests
// assert on what indexSupersessions produces, never on a stored reverse field —
// there is none, and a test that expected one would be pinning a bug.

import test from "node:test";
import assert from "node:assert/strict";
import {
  createDecision,
  currentOnlySearch,
  loadDecisions,
  readCurrentOnly,
  saveDecisions,
  selectDecisions,
  supersedeFilterSummary,
  toHistoryRecords,
  STORAGE_KEY,
} from "../src/app.js";
import {
  SUPERSEDE_ERRORS,
  indexSupersessions,
  predecessorOf,
  successorOf,
  validateSupersedes,
} from "../src/supersede.js";
import { createShiplogExport } from "../src/shiplog-export.js";
import { commitShiplogImport, parseImport, prepareShiplogImport } from "../src/shiplog-import.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

const decision = (id, overrides = {}) => ({
  id,
  title: `Decision ${id}`,
  context: `Why ${id}`,
  alternatives: "",
  owner: "Kai",
  status: "approved",
  createdAt: `2026-0${overrides.month ?? 1}-01T00:00:00.000Z`,
  ...overrides.fields,
});

// A → replaced by B → replaced by C. Only the forward links are written.
const A = decision("a", { month: 1 });
const B = decision("b", { month: 2, fields: { supersedes: "a" } });
const C = decision("c", { month: 3, fields: { supersedes: "b" } });
const CHAIN = [A, B, C];

test("the reverse link is derived from the stored one, in both directions", () => {
  const { supersededBy, replaces } = indexSupersessions(CHAIN);

  assert.equal(supersededBy.get("a").id, "b");
  assert.equal(supersededBy.get("b").id, "c");
  assert.equal(supersededBy.has("c"), false, "the newest decision is current");
  assert.equal(replaces.get("c").id, "b");
  assert.equal(replaces.get("a"), undefined);
  // Nothing anywhere stores the reverse direction.
  for (const record of CHAIN) assert.equal("superseded_by" in record, false);
  assert.equal(successorOf(CHAIN, "a").id, "b");
  assert.equal(predecessorOf(CHAIN, "b").id, "a");
});

test("a self reference and a missing target are refused, and never derived", () => {
  assert.equal(validateSupersedes("a", { id: "a", decisions: CHAIN }), SUPERSEDE_ERRORS.self);
  assert.equal(validateSupersedes("ghost", { id: "b", decisions: CHAIN }), SUPERSEDE_ERRORS.unknown);
  assert.equal(validateSupersedes(42, { id: "b", decisions: CHAIN }), SUPERSEDE_ERRORS.type);
  assert.equal(validateSupersedes("", { id: "b", decisions: CHAIN }), null);
  assert.equal(validateSupersedes(undefined, { id: "b", decisions: CHAIN }), null);
  assert.equal(validateSupersedes("a", { id: "b", decisions: CHAIN }), null);

  // Even if one were written past the validator, the index refuses to derive a
  // banner from it.
  const bad = [decision("x", { fields: { supersedes: "x" } }), decision("y", { fields: { supersedes: "ghost" } })];
  const { supersededBy, replaces } = indexSupersessions(bad);
  assert.equal(supersededBy.size, 0);
  assert.equal(replaces.size, 0);
});

test("createDecision refuses a self or unknown link and stores an accepted one", () => {
  assert.throws(
    () => createDecision(
      { title: "New", context: "Why", alternatives: "Keep the old one.", owner: "Kai", status: "approved", supersedes: "ghost" },
      { id: "new", decisions: CHAIN },
    ),
    new RegExp(SUPERSEDE_ERRORS.unknown.slice(0, 30)),
  );
  assert.throws(
    () => createDecision(
      { title: "New", context: "Why", alternatives: "Keep the old one.", owner: "Kai", status: "approved", supersedes: "self" },
      { id: "self", decisions: [...CHAIN, decision("self")] },
    ),
    /cannot supersede itself/,
  );

  const linked = createDecision(
    { title: "New", context: "Why", alternatives: "Keep the old one.", owner: "Kai", status: "approved", supersedes: " c " },
    { id: "d", createdAt: "2026-04-01T00:00:00.000Z", decisions: CHAIN },
  );
  assert.equal(linked.supersedes, "c");
  // A decision without a link carries no empty field.
  const plain = createDecision(
    { title: "New", context: "Why", alternatives: "Keep the old one.", owner: "Kai", status: "approved" },
    { id: "e", createdAt: "2026-04-01T00:00:00.000Z" },
  );
  assert.equal("supersedes" in plain, false);
});

test("setting the link leaves the superseded record byte-identical", () => {
  const storage = memoryStorage();
  saveDecisions(storage, [A]);
  const before = storage.getItem(STORAGE_KEY);
  const snapshot = structuredClone(loadDecisions(storage)[0]);

  // Recording the replacement is the only write. The record it replaces is not
  // touched: no status change, no reverse field, no new timestamp.
  const replacement = createDecision(
    { title: "Replacement", context: "Why", alternatives: "Keep the old one.", owner: "Mina", status: "approved", supersedes: "a" },
    { id: "b2", createdAt: "2026-05-01T00:00:00.000Z", decisions: loadDecisions(storage) },
  );
  saveDecisions(storage, [replacement, ...loadDecisions(storage)]);

  const stored = loadDecisions(storage).find((record) => record.id === "a");
  assert.deepEqual(stored, snapshot);
  assert.equal(JSON.stringify(stored), JSON.stringify(JSON.parse(before)[0]));
  // The reverse direction still exists — derived, not written.
  assert.equal(successorOf(loadDecisions(storage), "a").id, "b2");

  // Clearing the link is equally non-destructive to the record it pointed at.
  saveDecisions(storage, loadDecisions(storage).filter((record) => record.id !== "b2"));
  assert.deepEqual(loadDecisions(storage).find((record) => record.id === "a"), snapshot);
  assert.equal(successorOf(loadDecisions(storage), "a"), null);
});

test("a stored self reference is not loadable, a dangling one is kept and ignored", () => {
  const selfReferential = { ...decision("loop"), supersedes: "loop" };
  assert.deepEqual(loadDecisions(memoryStorage({ [STORAGE_KEY]: JSON.stringify([selfReferential]) })), []);

  // A predecessor that was deleted later must not cost us the record itself.
  const orphan = { ...decision("orphan"), supersedes: "gone" };
  const loaded = loadDecisions(memoryStorage({ [STORAGE_KEY]: JSON.stringify([orphan]) }));
  assert.deepEqual(loaded, [orphan]);
  assert.equal(predecessorOf(loaded, "orphan"), null);
});

test("current only hides superseded decisions and reports what it hid", () => {
  const view = { currentOnly: true };
  assert.deepEqual(selectDecisions(CHAIN, view).map((record) => record.id), ["c"]);
  assert.deepEqual(selectDecisions(CHAIN, {}).map((record) => record.id), ["c", "b", "a"]);

  const records = toHistoryRecords(CHAIN, []);
  assert.equal(supersedeFilterSummary(records, view), "1 current, 2 superseded hidden");
  assert.equal(supersedeFilterSummary(records, {}), "", "the summary is silent while the filter is off");
  // It composes with the other filters instead of replacing them.
  assert.deepEqual(
    selectDecisions(CHAIN, { ...view, query: "Decision a" }).map((record) => record.id),
    [],
  );
});

test("the filter state rides in the query string the other pages already read", () => {
  assert.equal(readCurrentOnly("?current=only"), true);
  assert.equal(readCurrentOnly("?owner=Kai"), false);
  assert.equal(readCurrentOnly(""), false);
  assert.equal(currentOnlySearch("", true), "?current=only");
  assert.equal(currentOnlySearch("?current=only", false), "");
  // Unrelated parameters survive both directions.
  assert.equal(currentOnlySearch("?id=abc", true), "?id=abc&current=only");
  assert.equal(currentOnlySearch("?id=abc&current=only", false), "?id=abc");
  assert.equal(readCurrentOnly(currentOnlySearch("?id=abc", true)), true);
});

test("a three-decision chain survives export and re-import in both directions", () => {
  const source = memoryStorage({
    [STORAGE_KEY]: JSON.stringify(CHAIN),
    [RELEASE_STORAGE_KEY]: JSON.stringify([]),
  });
  const exported = createShiplogExport(source, { generatedAt: "2026-06-01T00:00:00.000Z" });
  assert.deepEqual(exported.decisions.map((record) => record.supersedes), [undefined, "a", "b"]);

  // Into a fresh browser, from the file bytes the download would contain.
  const target = memoryStorage();
  const plan = prepareShiplogImport(target, JSON.stringify(exported, null, 2));
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.parsed.droppedSupersedes, []);
  const summary = commitShiplogImport(target, plan);
  assert.equal(summary.newDecisions, 3);

  const restored = loadDecisions(target);
  assert.deepEqual(restored.map((record) => record.id), ["a", "b", "c"]);
  const { supersededBy, replaces } = indexSupersessions(restored);
  assert.equal(supersededBy.get("a").id, "b");
  assert.equal(supersededBy.get("b").id, "c");
  assert.equal(replaces.get("b").id, "a");
  assert.equal(replaces.get("c").id, "b");
  assert.equal(supersededBy.size, 2, "no reference was invented on the way in");

  // Importing the same file again adds nothing and cannot fork the chain.
  const again = prepareShiplogImport(target, JSON.stringify(exported, null, 2));
  assert.equal(again.merged.summary.newDecisions, 0);
  assert.equal(again.merged.summary.duplicateDecisions, 3);
  assert.deepEqual(
    loadDecisions(target).map((record) => record.supersedes),
    [undefined, "a", "b"],
  );
});

test("import drops a dangling supersede link and rejects a self-referential record", () => {
  const file = {
    schema: "shiplog-history",
    version: 1,
    generatedAt: "2026-06-01T00:00:00.000Z",
    decisions: [
      { ...decision("kept"), supersedes: "never-existed" },
      { ...decision("loop"), supersedes: "loop" },
    ],
    releases: [],
  };
  const parsed = parseImport(JSON.stringify(file));

  assert.deepEqual(parsed.decisions.map((record) => record.id), ["kept"]);
  assert.equal("supersedes" in parsed.decisions[0], false, "the dangling link is not written");
  assert.equal(parsed.droppedSupersedes.length, 1);
  assert.match(parsed.droppedSupersedes[0].message, /dropped link to unknown decision "never-existed"/);
  assert.equal(parsed.rejected.length, 1);
  assert.match(parsed.rejected[0].message, /cannot supersede itself/);
});
