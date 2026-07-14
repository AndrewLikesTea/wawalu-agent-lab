import test from "node:test";
import assert from "node:assert/strict";
import { createDecision, loadDecisions, saveDecisions, STORAGE_KEY } from "../src/app.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("creates a normalized decision with deterministic metadata", () => {
  const decision = createDecision(
    { title: "  Pick a queue  ", context: "  We need retries. ", owner: "  Kai ", status: "accepted" },
    { id: "decision-1", createdAt: "2026-07-13T12:00:00.000Z" },
  );

  assert.deepEqual(decision, {
    id: "decision-1",
    title: "Pick a queue",
    context: "We need retries.",
    owner: "Kai",
    status: "accepted",
    createdAt: "2026-07-13T12:00:00.000Z",
  });
});

test("rejects incomplete decisions and unsupported statuses", () => {
  assert.throws(() => createDecision({ title: "", context: "Why", owner: "Kai", status: "proposed" }), TypeError);
  assert.throws(() => createDecision({ title: "Choice", context: "Why", owner: "Kai", status: "done" }), TypeError);
});

test("persists and reloads decisions from local storage", () => {
  const storage = memoryStorage();
  const decision = createDecision(
    { title: "Use text nodes", context: "Prevent <img onerror=alert(1)>", owner: "Ari", status: "proposed" },
    { id: "safe", createdAt: "2026-07-13T12:00:00.000Z" },
  );

  saveDecisions(storage, [decision]);
  assert.deepEqual(loadDecisions(storage), [decision]);
  assert.match(storage.getItem(STORAGE_KEY), /<img onerror=alert\(1\)>/);
});

test("malformed or invalid stored data is ignored", () => {
  assert.deepEqual(loadDecisions(memoryStorage({ [STORAGE_KEY]: "not json" })), []);
  assert.deepEqual(loadDecisions(memoryStorage({ [STORAGE_KEY]: JSON.stringify([{ title: "partial" }]) })), []);
  assert.deepEqual(loadDecisions(memoryStorage({
    [STORAGE_KEY]: JSON.stringify([{
      id: "bad-date", title: "Choice", context: "Why", owner: "Kai", status: "accepted", createdAt: "never",
    }]),
  })), []);
});
