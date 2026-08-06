// The decision recorder's validation core, without a browser.
//
// Every rule a person types against is pinned here; tests/decision-entry-flow
// pins what the page does with the answers. Nothing in this file touches the
// DOM, storage, or a clock.

import test from "node:test";
import assert from "node:assert/strict";
import {
  DECISION_ENTRY_ERRORS,
  DECISION_ENTRY_FIELDS,
  DECISION_ENTRY_LIMITS,
  decisionEntryFieldError,
  decisionEntrySummary,
  decisionRecordedSummary,
  validateDecision,
  validateDecisionEntry,
} from "../src/decision-entry.js";
import {
  MAX_ALTERNATIVES_LENGTH,
  MAX_CONTEXT_LENGTH,
  MAX_OWNER_LENGTH,
  MAX_TITLE_LENGTH,
  createDecision,
} from "../src/app.js";

const COMPLETE = {
  title: "Adopt a durable job queue",
  context: "Background work was lost on deploys; move to an at-least-once queue.",
  alternatives: "Database polling and in-process retries.",
  owner: "Tess",
  status: "accepted",
};

const fields = (errors) => errors.map(({ field }) => field);

test("a complete entry has nothing to report", () => {
  assert.deepEqual(validateDecisionEntry(COMPLETE), []);
});

test("every required field is reported, in the order the form presents them", () => {
  assert.deepEqual(
    fields(validateDecisionEntry({})),
    ["title", "context", "alternatives", "owner", "status"],
    "the four outcomes PRODUCT.md names — context, alternatives, owner, status — plus the title",
  );
  assert.deepEqual(
    DECISION_ENTRY_FIELDS,
    ["title", "context", "alternatives", "owner", "status"],
    "the report order must match the field order in the form",
  );
});

test("whitespace is not an answer", () => {
  const errors = validateDecisionEntry({ ...COMPLETE, context: "   \n\t ", owner: " " });
  assert.deepEqual(fields(errors), ["context", "owner"]);
  assert.equal(errors[0].message, DECISION_ENTRY_ERRORS.context.missing);
});

test("alternatives is required, and its message says what to write when there were none", () => {
  const [failure] = validateDecisionEntry({ ...COMPLETE, alternatives: "" });
  assert.equal(failure.field, "alternatives");
  assert.match(
    failure.message,
    /None considered/,
    "a required field a visitor cannot honestly fill has to name the way out",
  );
  // The way out actually works.
  assert.deepEqual(validateDecisionEntry({ ...COMPLETE, alternatives: "None considered" }), []);
});

test("each message names its own field rather than repeating one generic sentence", () => {
  const messages = validateDecisionEntry({}).map(({ message }) => message);
  assert.equal(new Set(messages).size, messages.length, "two fields share a message");
  for (const message of messages) {
    assert.doesNotMatch(message, /required/i, "the control already carries `required`");
  }
});

test("a field over its limit is reported as too long, with the limit and the length", () => {
  for (const [field, limit] of Object.entries(DECISION_ENTRY_LIMITS)) {
    assert.equal(decisionEntryFieldError(field, "x".repeat(limit)), null, `${field} at its limit`);
    const over = decisionEntryFieldError(field, "x".repeat(limit + 12));
    assert.equal(over, DECISION_ENTRY_ERRORS[field].tooLong(limit + 12), `${field} over its limit`);
    // Both numbers a person needs to cut it down: the ceiling and where they
    // actually are. Neither is the text they typed.
    assert.match(over, new RegExp(String(limit)));
    assert.match(over, new RegExp(String(limit + 12)));
  }
});

test("a message never repeats the value that failed", () => {
  // The messages sit beside fields holding a visitor's own text, and a message
  // built out of that text would be a second place their string is rendered.
  // Nothing here may echo it — the numbers say what to fix instead.
  const hostile = '<script>alert("x")</script> & \'quoted\' <b>';
  const values = {
    title: `${hostile}${"x".repeat(DECISION_ENTRY_LIMITS.title)}`,
    context: "",
    alternatives: `${hostile}${"x".repeat(DECISION_ENTRY_LIMITS.alternatives)}`,
    owner: "",
    status: hostile,
  };
  for (const { message } of validateDecisionEntry(values)) {
    assert.equal(message.includes(hostile), false, "a message quoted the submitted value");
    assert.equal(message.includes("<"), false, "a message carries a character from the submitted value");
  }
});

test("the limits are the same numbers the record validator and the importer enforce", () => {
  assert.equal(DECISION_ENTRY_LIMITS.title, MAX_TITLE_LENGTH);
  assert.equal(DECISION_ENTRY_LIMITS.context, MAX_CONTEXT_LENGTH);
  assert.equal(DECISION_ENTRY_LIMITS.alternatives, MAX_ALTERNATIVES_LENGTH);
  assert.equal(DECISION_ENTRY_LIMITS.owner, MAX_OWNER_LENGTH);
});

test("status accepts every value a record may carry, and refuses anything else", () => {
  for (const status of ["pending", "accepted", "approved", "proposed", "superseded"]) {
    assert.equal(decisionEntryFieldError("status", status), null, status);
  }
  assert.equal(decisionEntryFieldError("status", ""), DECISION_ENTRY_ERRORS.status.missing);
  assert.equal(decisionEntryFieldError("status", "shipped"), DECISION_ENTRY_ERRORS.status.invalid);
  // A caller may narrow the set to the two the form offers.
  assert.equal(
    decisionEntryFieldError("status", "proposed", { statuses: ["pending", "accepted"] }),
    DECISION_ENTRY_ERRORS.status.invalid,
  );
});

test("anything this core accepts, createDecision stores", () => {
  // The two are deliberately separate boundaries — one speaks to a visitor, the
  // other refuses a bad record — so the seam between them is pinned rather than
  // trusted: a form the recorder passes must never throw on the way to storage.
  const cases = [
    COMPLETE,
    { ...COMPLETE, status: "approved" },
    { ...COMPLETE, alternatives: "None considered" },
    { ...COMPLETE, title: "x".repeat(DECISION_ENTRY_LIMITS.title) },
    { ...COMPLETE, owner: "  Tess  ", context: "  Padded.  " },
  ];
  for (const values of cases) {
    assert.deepEqual(validateDecisionEntry(values), [], JSON.stringify(values).slice(0, 60));
    assert.doesNotThrow(() => createDecision(values), JSON.stringify(values).slice(0, 60));
  }
});

test("the form-level line names what is blocking the save and counts the rest", () => {
  assert.equal(decisionEntrySummary([]), "");
  assert.equal(
    decisionEntrySummary(["owner", "status", "title"]),
    "Owner is blocking this save. 2 more fields need attention.",
  );
  assert.equal(
    decisionEntrySummary(["context", "owner"]),
    "Context is blocking this save. 1 more field needs attention.",
  );
  assert.equal(
    decisionEntrySummary(["alternatives"]),
    "Alternatives is blocking this save. No other field needs attention.",
  );
  // It takes the failures the validator produced, in that shape, too.
  assert.equal(
    decisionEntrySummary(validateDecisionEntry({ ...COMPLETE, title: "", owner: "" })),
    "Title is blocking this save. 1 more field needs attention.",
  );
  // A headline, not a second copy of the field messages.
  for (const message of Object.values(DECISION_ENTRY_ERRORS).map((entry) => entry.missing)) {
    assert.ok(!decisionEntrySummary(DECISION_ENTRY_FIELDS).includes(message), "the summary repeats a field message");
  }
});

test("the record-write path refuses in the same words the form uses", () => {
  // createDecision() is the only way a decision is persisted. Called directly,
  // bypassing the form, it must refuse exactly what the form refuses and say
  // exactly what the form says — otherwise a record could reach storage in a
  // state the recorder would never have accepted.
  const over = "c".repeat(DECISION_ENTRY_LIMITS.context + 63);
  assert.throws(
    () => createDecision({ ...COMPLETE, context: over }),
    (error) => error instanceof TypeError
      && error.message === decisionEntryFieldError("context", over)
      && error.message === DECISION_ENTRY_ERRORS.context.tooLong(over.length),
  );
  assert.throws(
    () => createDecision({ ...COMPLETE, alternatives: "   " }),
    (error) => error.message === DECISION_ENTRY_ERRORS.alternatives.missing,
  );
  assert.throws(
    () => createDecision({ ...COMPLETE, status: "shipped" }),
    (error) => error.message === DECISION_ENTRY_ERRORS.status.invalid,
  );
  // The first failure in form order is the one reported, matching the field the
  // form moves focus to.
  assert.throws(
    () => createDecision({ ...COMPLETE, title: "", owner: "" }),
    (error) => error.message === DECISION_ENTRY_ERRORS.title.missing,
  );
});

test("validateDecision answers ok, and its failures are the entry failures", () => {
  assert.deepEqual(validateDecision(COMPLETE), { ok: true, failures: [] });
  const refused = validateDecision({ ...COMPLETE, owner: "" });
  assert.equal(refused.ok, false);
  assert.deepEqual(refused.failures, validateDecisionEntry({ ...COMPLETE, owner: "" }));
  assert.equal(refused.failures[0].message, DECISION_ENTRY_ERRORS.owner.missing);
});

test("the recorded line names the decision, its status, and whether it is on screen", () => {
  const recorded = { title: "Adopt a durable job queue", status: "approved" };
  assert.equal(
    decisionRecordedSummary(recorded, { visible: true }),
    "Recorded “Adopt a durable job queue” as accepted. It is in the history below.",
    "the legacy stored status must read as the word the history shows",
  );
  assert.match(
    decisionRecordedSummary(recorded, { visible: false }),
    /clear the filters to see it/,
    "a record the active filters hide must not be reported as visible",
  );
});
