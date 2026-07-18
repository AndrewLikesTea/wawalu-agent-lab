import test from "node:test";
import assert from "node:assert/strict";
import {
  newAlternative,
  removeAlternative,
  submissionValues,
  updateAlternative,
  validateDecisionForm,
} from "../src/decision-form-state.js";

test("required fields reject empty and whitespace-only values", () => {
  assert.deepEqual(Object.keys(validateDecisionForm({ title: "", context: "  ", owner: "" })), ["title", "context", "owner"]);
  assert.deepEqual(validateDecisionForm({ title: "Choice", context: "Why", owner: "Mina" }), {});
});

test("alternatives can be added, edited, and removed by stable identity", () => {
  const first = newAlternative(1);
  const second = newAlternative(2);
  const edited = updateAlternative([first, second], 2, "Use a queue");
  assert.equal(edited[1].value, "Use a queue");
  assert.deepEqual(removeAlternative(edited, 1), [{ id: 2, value: "Use a queue" }]);
});

test("submission trims and omits blank alternatives without mutating form state", () => {
  const values = { title: " Choice ", context: " Why ", owner: " Mina ", status: "pending" };
  const alternatives = [{ id: 1, value: "  Queue  " }, { id: 2, value: " " }, { id: 3, value: "Database" }];
  assert.equal(submissionValues(values, alternatives).alternatives, "Queue\nDatabase");
  assert.equal(alternatives[0].value, "  Queue  ");
});
