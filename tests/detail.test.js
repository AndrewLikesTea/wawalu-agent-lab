import test from "node:test";
import assert from "node:assert/strict";
import { compareAlternatives } from "../src/detail.js";
import {
  createAlternative,
  createDecision,
  loadDecisions,
  normalizeAlternatives,
  normalizeList,
} from "../src/app.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("normalizeList trims and drops blanks from arrays and newline text", () => {
  assert.deepEqual(normalizeList(["  fast ", "", "cheap"]), ["fast", "cheap"]);
  assert.deepEqual(normalizeList("fast\n\n  cheap  \n"), ["fast", "cheap"]);
  assert.deepEqual(normalizeList(undefined), []);
});

test("createAlternative normalizes fields and requires a name", () => {
  const alternative = createAlternative(
    { name: "  Managed queue ", pros: "reliable\nfast", cons: ["cost"] },
    { id: "alt-1" },
  );
  assert.deepEqual(alternative, {
    id: "alt-1",
    name: "Managed queue",
    pros: ["reliable", "fast"],
    cons: ["cost"],
  });
  assert.throws(() => createAlternative({ name: "   " }), TypeError);
});

test("normalizeAlternatives skips rows without a name", () => {
  const result = normalizeAlternatives([
    { name: "A", pros: "p", cons: "" },
    { name: "  ", pros: "ignored", cons: "" },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "A");
});

test("createDecision attaches alternatives only when present", () => {
  const without = createDecision(
    { title: "T", context: "C", owner: "O", status: "accepted" },
    { id: "d1", createdAt: "2026-07-13T12:00:00.000Z" },
  );
  assert.equal("alternatives" in without, false);

  const withAlts = createDecision(
    {
      title: "T",
      context: "C",
      owner: "O",
      status: "accepted",
      alternatives: [{ name: "A", pros: "x", cons: "y" }],
    },
    { id: "d2", createdAt: "2026-07-13T12:00:00.000Z" },
  );
  assert.equal(withAlts.alternatives.length, 1);
  assert.equal(withAlts.alternatives[0].name, "A");
});

test("stored decisions with malformed alternatives are rejected, valid ones kept", () => {
  const valid = createDecision(
    {
      title: "Queue",
      context: "Why",
      owner: "Kai",
      status: "accepted",
      alternatives: [{ name: "SQS", pros: "managed", cons: "cost" }],
    },
    { id: "ok", createdAt: "2026-07-13T12:00:00.000Z" },
  );
  const badAlt = { ...valid, id: "bad", alternatives: [{ name: "", pros: [], cons: [] }] };

  const storage = memoryStorage({
    "shiplog.decisions.v1": JSON.stringify([valid, badAlt]),
  });
  const loaded = loadDecisions(storage);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, "ok");
});

test("compareAlternatives marks unique points as differences and shared ones as shared", () => {
  const compared = compareAlternatives([
    { id: "a", name: "A", pros: ["Fast", "Cheap"], cons: ["Lock-in"] },
    { id: "b", name: "B", pros: ["fast", "Flexible"], cons: ["Slower"] },
  ]);

  const byName = Object.fromEntries(compared.map((alt) => [alt.name, alt]));
  // "Fast"/"fast" appears in both (case-insensitive) -> shared.
  assert.equal(byName.A.pros.find((p) => p.text === "Fast").shared, true);
  assert.equal(byName.B.pros.find((p) => p.text === "fast").shared, true);
  // Unique points are flagged as differences.
  assert.equal(byName.A.pros.find((p) => p.text === "Cheap").shared, false);
  assert.equal(byName.B.pros.find((p) => p.text === "Flexible").shared, false);
  assert.equal(byName.A.cons[0].shared, false);
});

test("compareAlternatives is safe on empty and single-alternative input", () => {
  assert.deepEqual(compareAlternatives(), []);
  assert.deepEqual(compareAlternatives([]), []);
  const single = compareAlternatives([{ id: "a", name: "A", pros: ["Fast"], cons: [] }]);
  assert.equal(single[0].pros[0].shared, false);
});
