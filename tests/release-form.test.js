// Unit coverage for the release recorder: the validation core, the selection
// state that has to survive a rejected submit, and the picker's three states
// (options, empty, and the metadata each option carries).
//
// The core tests touch no DOM at all. The render tests stand up the same
// dependency-free document the page flow tests use, so what they assert is the
// structure a browser would build, not a stub's approximation of it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  MAX_VERSION_LENGTH,
  RECORD_DECISION_HREF,
  RELEASE_FORM_ERRORS,
  createRelease,
  mountDecisionPicker,
  pruneSelection,
  recordedSummaryText,
  renderDecisionPicker,
  selectionSummaryText,
  toggleDecisionSelection,
} from "../src/release-form.js";
import { parseHtml, textOf } from "./support/browser.js";

const DECISIONS = [
  { id: "d-queue", title: "Adopt a durable job queue", context: "c", owner: "Kai", status: "accepted", createdAt: "2026-05-02T00:00:00.000Z" },
  { id: "d-cache", title: "Cache the read path", context: "c", owner: "Ari", status: "approved", createdAt: "2026-05-20T00:00:00.000Z" },
  { id: "d-flags", title: "Introduce feature flags", context: "c", owner: "Priya", status: "proposed", createdAt: "2026-06-01T00:00:00.000Z" },
];

const VALID = { version: "v1.4.0", owner: "Priya", status: "completed" };

// The render layer reads the global `document`, so each test that needs one
// installs it and hands it back afterwards.
function withDocument(t) {
  const document = parseHtml('<html><body><div id="picker"></div><p id="summary"></p></body></html>');
  const saved = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { value: document, writable: true, configurable: true });
  t.after(() => {
    if (saved) Object.defineProperty(globalThis, "document", saved);
    else delete globalThis.document;
  });
  return document;
}

const options = (root) => root.querySelectorAll(".decision-picker-option");
const checks = (root) => root.querySelectorAll(".decision-picker-check");

// --- selection state -------------------------------------------------------

test("toggling a decision keeps the selection ordered and de-duplicated", () => {
  let selected = toggleDecisionSelection([], "d-cache", true);
  selected = toggleDecisionSelection(selected, "d-queue", true);
  selected = toggleDecisionSelection(selected, "d-cache", true);
  assert.deepEqual(selected, ["d-cache", "d-queue"], "a repeated tick added the same id twice");

  selected = toggleDecisionSelection(selected, "d-cache", false);
  assert.deepEqual(selected, ["d-queue"]);
  // Unticking something that was never ticked is a no-op, not an error.
  assert.deepEqual(toggleDecisionSelection(selected, "ghost", false), ["d-queue"]);
  // Without an explicit state the call flips what is there.
  assert.deepEqual(toggleDecisionSelection(["d-queue"], "d-queue"), []);
});

test("a selection is pruned to the decisions that still exist", () => {
  assert.deepEqual(pruneSelection(["d-flags", "ghost", "d-queue"], DECISIONS), ["d-flags", "d-queue"]);
  assert.deepEqual(pruneSelection(["d-queue"], []), []);
  assert.deepEqual(pruneSelection(undefined, DECISIONS), []);
});

test("the selection summary counts against what is offered", () => {
  assert.equal(selectionSummaryText(0, 0), "No decisions are available to link yet.");
  assert.equal(selectionSummaryText(0, 3), "No decisions linked yet. 3 available.");
  assert.equal(selectionSummaryText(2, 3), "2 of 3 decisions linked.");
  assert.equal(selectionSummaryText(1, 1), "1 of 1 decision linked.");
});

// --- the record ------------------------------------------------------------

test("createRelease writes the shape the release views already read", () => {
  const release = createRelease({
    ...VALID,
    title: "Security hardening",
    description: "Short-lived credentials shipped.",
    decisionIds: ["d-flags", "d-queue"],
  }, { decisions: DECISIONS, id: "r-1", createdAt: "2026-07-02T00:00:00.000Z" });

  assert.deepEqual(release, {
    id: "r-1",
    version: "v1.4.0",
    owner: "Priya",
    status: "completed",
    createdAt: "2026-07-02T00:00:00.000Z",
    decisionIds: ["d-flags", "d-queue"],
    title: "Security hardening",
    description: "Short-lived credentials shipped.",
  });
});

test("createRelease keeps the association order and drops repeats", () => {
  const release = createRelease({ ...VALID, decisionIds: ["d-flags", "d-queue", "d-flags"] }, { decisions: DECISIONS });
  assert.deepEqual(release.decisionIds, ["d-flags", "d-queue"]);
  // A release with nothing linked is valid: infrastructure work ships too.
  assert.deepEqual(createRelease(VALID, { decisions: DECISIONS }).decisionIds, []);
  // Generated values are asserted by shape, never by value.
  assert.match(createRelease(VALID, { decisions: DECISIONS }).id, /\S/);
  assert.ok(!Number.isNaN(Date.parse(createRelease(VALID, { decisions: DECISIONS }).createdAt)));
});

test("createRelease omits optional copy rather than storing empty strings", () => {
  const release = createRelease({ ...VALID, title: "  ", description: "  " }, { decisions: DECISIONS });
  assert.equal("title" in release, false);
  assert.equal("description" in release, false);
});

test("createRelease refuses an incomplete, oversized, or dangling record", () => {
  const rejected = (values) => assert.throws(
    () => createRelease(values, { decisions: DECISIONS }),
    (error) => Object.values(RELEASE_FORM_ERRORS).includes(error.message),
  );
  rejected({ ...VALID, version: "   " });
  rejected({ ...VALID, owner: "" });
  rejected({ ...VALID, status: "shipped" });
  rejected({ ...VALID, version: "v".repeat(MAX_VERSION_LENGTH + 1) });
  // The one failure a native form cannot express: an id that no longer resolves
  // must not be written as a dangling reference.
  assert.throws(
    () => createRelease({ ...VALID, decisionIds: ["d-queue", "ghost"] }, { decisions: DECISIONS }),
    { message: RELEASE_FORM_ERRORS.unknownDecision },
  );
});

test("the recorded announcement names the release and what it linked", () => {
  assert.equal(
    recordedSummaryText({ version: "v1.4.0", decisionIds: ["d-queue"] }),
    "Recorded v1.4.0 with 1 linked decision.",
  );
  assert.equal(
    recordedSummaryText({ version: "v1.4.0", decisionIds: ["d-queue", "d-cache"] }),
    "Recorded v1.4.0 with 2 linked decisions.",
  );
  assert.equal(recordedSummaryText({ version: "v2.0.0", decisionIds: [] }), "Recorded v2.0.0 with no linked decisions.");
});

// --- the picker ------------------------------------------------------------

test("each option is a labelled checkbox describing its decision", (t) => {
  const document = withDocument(t);
  const container = document.querySelector("#picker");
  renderDecisionPicker(container, DECISIONS, ["d-cache"]);

  assert.equal(options(container).length, 3);
  const [first, second] = options(container);
  const input = first.querySelector("input");
  const label = first.querySelector("label");
  assert.equal(input.type, "checkbox");
  assert.equal(input.getAttribute("name"), "decisionIds");
  assert.equal(input.getAttribute("value"), "d-queue");
  // The label is tied to the control, so its whole text is a click target and
  // the accessible name is the decision's title.
  assert.equal(label.getAttribute("for"), input.id);
  assert.equal(textOf(label), "Adopt a durable job queue");

  // Status, owner, and identifier are described by the control rather than left
  // as loose text a screen reader would never associate with it.
  const meta = first.querySelector(".decision-picker-meta");
  assert.equal(input.getAttribute("aria-describedby"), meta.id);
  assert.match(textOf(meta.querySelector(".badge")), /^accepted$/);
  assert.match(textOf(meta.querySelector(".decision-picker-owner")), /^Owner\s*Kai$/);
  assert.match(textOf(meta.querySelector(".decision-picker-identifier")), /^ID\s*d-queue$/);
  assert.equal(textOf(first.querySelector("code")), "d-queue");
  // The option is one tab stop: no link rides along inside the group.
  assert.equal(first.querySelectorAll("a").length, 0);

  // A legacy "approved" record is offered under the word the rest of the log
  // uses for it.
  assert.match(textOf(second.querySelector(".badge")), /^accepted$/);
  // The rendered state matches the selection it was given.
  assert.deepEqual(checks(container).map((check) => check.checked), [false, true, false]);
});

test("the picker states there is nothing to link and routes to the decision recorder", (t) => {
  const document = withDocument(t);
  const container = document.querySelector("#picker");
  renderDecisionPicker(container, [], []);

  assert.equal(checks(container).length, 0);
  const empty = container.querySelector(".decision-picker-empty");
  assert.ok(empty, "no empty state was rendered");
  assert.match(textOf(empty), /No decisions to link yet\./);
  const action = empty.querySelector("a");
  assert.equal(action.href, RECORD_DECISION_HREF);
  assert.match(textOf(action), /Record a decision first/);
});

test("the mounted picker tracks ticks, announces the count, and survives new data", (t) => {
  const document = withDocument(t);
  const container = document.querySelector("#picker");
  const summary = document.querySelector("#summary");
  const picker = mountDecisionPicker(container, { decisions: DECISIONS, summary });

  assert.equal(textOf(summary), "No decisions linked yet. 3 available.");
  checks(container)[2].click();
  checks(container)[0].click();
  assert.deepEqual(picker.selectedIds(), ["d-flags", "d-queue"], "ticks are not recorded in the order they happened");
  assert.equal(textOf(summary), "2 of 3 decisions linked.");

  checks(container)[2].click();
  assert.deepEqual(picker.selectedIds(), ["d-queue"]);
  assert.equal(textOf(summary), "1 of 3 decisions linked.");

  // Fresh data redraws the group without losing a selection that still
  // resolves, and drops one that no longer does.
  picker.setDecisions(DECISIONS.slice(0, 2));
  assert.deepEqual(picker.selectedIds(), ["d-queue"]);
  assert.deepEqual(checks(container).map((check) => check.checked), [true, false]);
  picker.setDecisions([DECISIONS[1]]);
  assert.deepEqual(picker.selectedIds(), []);
  assert.equal(textOf(summary), "No decisions linked yet. 1 available.");

  picker.setDecisions([]);
  assert.equal(textOf(summary), "No decisions are available to link yet.");
  assert.ok(container.querySelector(".decision-picker-empty"));
});

test("clearing the picker unticks every option", (t) => {
  const document = withDocument(t);
  const container = document.querySelector("#picker");
  const picker = mountDecisionPicker(container, { decisions: DECISIONS, selected: ["d-queue", "ghost"] });
  // An id handed in that no longer resolves never reaches the DOM.
  assert.deepEqual(picker.selectedIds(), ["d-queue"]);

  picker.clear();
  assert.deepEqual(picker.selectedIds(), []);
  assert.deepEqual(checks(container).map((check) => check.checked), [false, false, false]);
  // The checked attribute is never written, so a native form reset cannot
  // restore a tick the user has cleared.
  assert.equal(checks(container).some((check) => check.hasAttribute("checked")), false);
});

test("the recorder markup groups the picker and never builds HTML from stored text", async () => {
  const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const [page, form, wiring] = await Promise.all([
    read("src/releases.html"), read("src/release-form.js"), read("src/releases-page.js"),
  ]);
  assert.match(page, /id="release-form"/);
  assert.match(page, /id="release-decisions"/);
  assert.match(page, /<legend>Link decisions to this release/);
  assert.match(page, /id="release-decisions-summary" role="status" aria-live="polite"/);
  assert.match(page, /id="release-form-error" role="alert" hidden/);
  assert.match(page, /id="release-storage-notice" role="alert" hidden/);
  assert.match(page, /<button type="submit">Record release<\/button>/);
  // The filter select and the form's status select must stay distinct controls.
  assert.match(page, /id="release-form-status" name="status"/);
  assert.doesNotMatch(`${form}\n${wiring}`, /innerHTML/);
});
