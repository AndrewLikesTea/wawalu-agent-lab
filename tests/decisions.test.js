import test from "node:test";
import assert from "node:assert/strict";
import { createDecision, loadDecisions, saveDecisions, STORAGE_KEY } from "../src/app.js";
import { DECISION_ENTRY_ERRORS } from "../src/decision-entry.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test("creates a normalized decision with deterministic metadata", () => {
  const decision = createDecision(
    { title: "  Pick a queue  ", context: "  We need retries. ", alternatives: "  Poll the database. ", owner: "  Kai ", status: "accepted" },
    { id: "decision-1", createdAt: "2026-07-13T12:00:00.000Z" },
  );

  assert.deepEqual(decision, {
    id: "decision-1",
    title: "Pick a queue",
    context: "We need retries.",
    alternatives: "Poll the database.",
    owner: "Kai",
    status: "accepted",
    createdAt: "2026-07-13T12:00:00.000Z",
  });
});

test("rejects incomplete decisions and unsupported statuses", () => {
  const complete = { title: "Choice", context: "Why", alternatives: "Poll instead.", owner: "Kai", status: "proposed" };
  // Every field the form requires, the write path requires — including
  // alternatives — so a record cannot be stored in a state the form refuses.
  for (const field of ["title", "context", "alternatives", "owner"]) {
    assert.throws(() => createDecision({ ...complete, [field]: "  " }), TypeError, field);
  }
  assert.throws(() => createDecision({ ...complete, status: "done" }), TypeError);
  // The refusal is worded the way the recorder words it, not in a sentence
  // about "a decision" that names no field.
  assert.throws(
    () => createDecision({ ...complete, owner: "" }),
    new RegExp(DECISION_ENTRY_ERRORS.owner.missing.slice(0, 30)),
  );
});

test("creates decisions with the approved and pending workflow statuses", () => {
  for (const status of ["approved", "pending"]) {
    assert.equal(createDecision(
      { title: "Choice", context: "Why", alternatives: "None considered", owner: "Mina", status },
      { id: status, createdAt: "2026-07-18T12:00:00.000Z" },
    ).status, status);
  }
});

test("persists and reloads decisions from local storage", () => {
  const storage = memoryStorage();
  const decision = createDecision(
    { title: "Use text nodes", context: "Prevent <img onerror=alert(1)>", alternatives: "Sanitize on write.", owner: "Ari", status: "proposed" },
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

test("oversized fields are rejected on create and dropped from storage", () => {
  const base = { context: "Why", alternatives: "Poll instead.", owner: "Kai", status: "accepted" };
  // The refusal states the limit and the length that was submitted — the same
  // sentence the recorder prints beside the field — and never the value itself.
  assert.throws(
    () => createDecision({ ...base, title: "t".repeat(121) }),
    (error) => error.message === DECISION_ENTRY_ERRORS.title.tooLong(121),
  );
  assert.throws(
    () => createDecision({ ...base, title: "Choice", context: "c".repeat(1001) }),
    (error) => error.message === DECISION_ENTRY_ERRORS.context.tooLong(1001),
  );
  assert.throws(
    () => createDecision({ ...base, title: "Choice", owner: "o".repeat(81) }),
    (error) => error.message === DECISION_ENTRY_ERRORS.owner.tooLong(81),
  );
  assert.throws(
    () => createDecision({ ...base, title: "Choice", alternatives: "a".repeat(1001) }),
    (error) => error.message === DECISION_ENTRY_ERRORS.alternatives.tooLong(1001),
  );
  const oversized = {
    id: "big", title: "t".repeat(121), context: "Why", owner: "Kai",
    status: "accepted", createdAt: "2026-07-14T00:00:00.000Z",
  };
  assert.deepEqual(loadDecisions(memoryStorage({ [STORAGE_KEY]: JSON.stringify([oversized]) })), []);
});
