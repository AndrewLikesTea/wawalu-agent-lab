import test from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_RELEASE_DRAFT,
  RELEASE_DRAFT_KEY,
  createRelease,
  isValidDateInput,
  loadReleaseDraft,
  reconcileDraftDecisions,
  saveReleaseDraft,
  validateReleaseDraft,
} from "../src/release-form.js";

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test("release validation explains every required correction", () => {
  assert.deepEqual(validateReleaseDraft({ ...EMPTY_RELEASE_DRAFT }), {
    version: "Enter a version number.",
    date: "Choose the release date.",
    decisionIds: "Select at least one decision that informed this release.",
  });
  assert.match(validateReleaseDraft({ version: "v1", date: "2026-02-30", decisionIds: ["d1"] }).version, /semantic versioning/);
  assert.match(validateReleaseDraft({ version: "1.0.0", date: "2026-02-30", decisionIds: ["d1"] }).date, /valid calendar date/);
});

test("calendar dates and semantic version releases are normalized", () => {
  assert.equal(isValidDateInput("2024-02-29"), true);
  assert.equal(isValidDateInput("2025-02-29"), false);
  const release = createRelease(
    { version: " 2.1.0-beta.1 ", date: "2026-07-18", description: " Shipped safely. ", decisionIds: ["d1"] },
    { id: "r1" },
  );
  assert.deepEqual(release, {
    id: "r1", version: "2.1.0-beta.1", description: "Shipped safely.", decisionIds: ["d1"],
    status: "completed", createdAt: "2026-07-18T12:00:00.000Z",
  });
});

test("a restored draft cannot associate decisions that no longer exist", () => {
  const decisions = [{ id: "d1" }, { id: "d2" }];
  const stale = { ...EMPTY_RELEASE_DRAFT, version: "1.0.0", decisionIds: ["d1", "gone", "d2"] };
  const cleaned = reconcileDraftDecisions(stale, decisions);
  assert.deepEqual(cleaned.decisionIds, ["d1", "d2"]);
  assert.equal(cleaned.version, "1.0.0");
  // An already-clean draft is returned by reference so mount can skip a re-write.
  const clean = { ...EMPTY_RELEASE_DRAFT, decisionIds: ["d1"] };
  assert.equal(reconcileDraftDecisions(clean, decisions), clean);
  assert.deepEqual(reconcileDraftDecisions(clean, []).decisionIds, []);
});

test("draft storage survives malformed and partial browser data", () => {
  const memory = storage();
  saveReleaseDraft(memory, { version: "1.0.0", date: "", description: "notes", decisionIds: ["d1"] });
  assert.deepEqual(loadReleaseDraft(memory), { version: "1.0.0", date: "", description: "notes", decisionIds: ["d1"] });
  assert.deepEqual(loadReleaseDraft(storage({ [RELEASE_DRAFT_KEY]: "{" })), { ...EMPTY_RELEASE_DRAFT });
});
