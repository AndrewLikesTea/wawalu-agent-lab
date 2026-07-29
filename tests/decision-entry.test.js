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

test("a field over its limit is reported as too long, not as missing", () => {
  for (const [field, limit] of Object.entries(DECISION_ENTRY_LIMITS)) {
    assert.equal(decisionEntryFieldError(field, "x".repeat(limit)), null, `${field} at its limit`);
    assert.equal(
      decisionEntryFieldError(field, "x".repeat(limit + 1)),
      DECISION_ENTRY_ERRORS[field].tooLong,
      `${field} one character over its limit`,
    );
    assert.match(DECISION_ENTRY_ERRORS[field].tooLong, new RegExp(String(limit)));
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

test("the form-level line counts the failures and never restates them", () => {
  assert.equal(decisionEntrySummary(0), "");
  assert.match(decisionEntrySummary(1), /^One field/);
  assert.match(decisionEntrySummary(5), /^5 fields/);
  for (const message of Object.values(DECISION_ENTRY_ERRORS).map((entry) => entry.missing)) {
    assert.ok(!decisionEntrySummary(5).includes(message), "the summary repeats a field message");
  }
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
