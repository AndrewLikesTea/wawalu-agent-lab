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
  DECISION_PICKER_LOADING_STATUS_TEXT,
  DECISION_PICKER_LOADING_TEXT,
  RECORD_DECISION_HREF,
  RELEASE_FORM_ERRORS,
  createRelease,
  mountDecisionPicker,
  pruneSelection,
  recordedSummaryText,
  releaseDateToIso,
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

// Every field issue #533 requires: a name, a date, a summary, and at least one
// existing decision. A fixture missing any of them is a rejection case below.
const VALID = {
  version: "v1.4.0",
  owner: "Priya",
  status: "completed",
  releasedOn: "2026-07-02",
  description: "Short-lived credentials shipped.",
  decisionIds: ["d-queue"],
};

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

test("a release date is a calendar day, stored as one unambiguous instant", () => {
  assert.equal(releaseDateToIso("2026-07-02"), "2026-07-02T00:00:00.000Z");
  assert.equal(releaseDateToIso("  2026-07-02  "), "2026-07-02T00:00:00.000Z");
  // Not a calendar day at all.
  assert.equal(releaseDateToIso(""), null);
  assert.equal(releaseDateToIso(undefined), null);
  assert.equal(releaseDateToIso("07/02/2026"), null);
  assert.equal(releaseDateToIso("2026-07-02T09:00:00.000Z"), null);
  // Well formed but unreal: Date would roll these forward silently, which would
  // store a date the user never typed.
  assert.equal(releaseDateToIso("2026-02-31"), null);
  assert.equal(releaseDateToIso("2026-13-01"), null);
  assert.equal(releaseDateToIso("2026-00-10"), null);
  // A real leap day still resolves.
  assert.equal(releaseDateToIso("2028-02-29"), "2028-02-29T00:00:00.000Z");
});

test("createRelease writes the shape the release views already read", () => {
  const release = createRelease({
    ...VALID,
    title: "Security hardening",
    decisionIds: ["d-flags", "d-queue"],
  }, { decisions: DECISIONS, id: "r-1" });

  assert.deepEqual(release, {
    id: "r-1",
    version: "v1.4.0",
    owner: "Priya",
    status: "completed",
    // Derived from the calendar day the form collected, not from "now".
    createdAt: "2026-07-02T00:00:00.000Z",
    decisionIds: ["d-flags", "d-queue"],
    title: "Security hardening",
    description: "Short-lived credentials shipped.",
  });
});

test("createRelease keeps the association order and drops repeats", () => {
  const release = createRelease({ ...VALID, decisionIds: ["d-flags", "d-queue", "d-flags"] }, { decisions: DECISIONS });
  assert.deepEqual(release.decisionIds, ["d-flags", "d-queue"]);
  // Generated values are asserted by shape, never by value.
  assert.match(createRelease(VALID, { decisions: DECISIONS }).id, /\S/);
});

test("createRelease omits an absent title rather than storing an empty string", () => {
  const release = createRelease({ ...VALID, title: "  " }, { decisions: DECISIONS });
  assert.equal("title" in release, false);
  // The summary is required, so it is always present and always trimmed.
  assert.equal(createRelease({ ...VALID, description: "  Shipped.  " }, { decisions: DECISIONS }).description, "Shipped.");
});

test("createRelease refuses an incomplete, oversized, or dangling record", () => {
  const rejects = (values, message) => assert.throws(
    () => createRelease(values, { decisions: DECISIONS }),
    { message },
  );
  const { required, length, invalidDate, unknownDecision } = RELEASE_FORM_ERRORS;

  rejects({ ...VALID, version: "   " }, required);
  rejects({ ...VALID, owner: "" }, required);
  rejects({ ...VALID, status: "shipped" }, required);
  // A date and summary are required; decision associations are optional.
  rejects({ ...VALID, releasedOn: "" }, required);
  rejects({ ...VALID, description: "   " }, required);
  rejects({ ...VALID, releasedOn: "2026-02-31" }, invalidDate);
  assert.deepEqual(createRelease({ ...VALID, decisionIds: [] }, { decisions: DECISIONS }).decisionIds, []);
  assert.deepEqual(createRelease({ ...VALID, decisionIds: undefined }, { decisions: DECISIONS }).decisionIds, []);

  rejects({ ...VALID, version: "v".repeat(MAX_VERSION_LENGTH + 1) }, length);
  // An id that no longer resolves must not be written as a dangling reference.
  rejects({ ...VALID, decisionIds: ["d-queue", "ghost"] }, unknownDecision);
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

test("the loading picker announces loading without showing the empty state", (t) => {
  const document = withDocument(t);
  const container = document.querySelector("#picker");
  const summary = document.querySelector("#summary");
  const picker = mountDecisionPicker(container, { state: "loading", summary });

  // Two elements state the wait: the visible placeholder inside the picker and
  // the status line beside it. They must not say it in the same words, or the
  // form stacks one sentence twice and a screen reader reads it twice.
  assert.equal(textOf(container), DECISION_PICKER_LOADING_TEXT);
  assert.equal(textOf(summary), DECISION_PICKER_LOADING_STATUS_TEXT);
  assert.notEqual(textOf(summary), textOf(container), "the status line repeats the placeholder word for word");
  assert.equal(container.querySelector(".decision-picker-loading").getAttribute("aria-hidden"), "true");
  assert.equal(container.querySelector(".decision-picker-empty:not(.decision-picker-loading)"), null);
  assert.equal(container.querySelector("a"), null, "loading introduced a focusable empty-state action");
  assert.deepEqual(picker.selectedIds(), []);

  picker.setDecisions(DECISIONS);
  assert.equal(options(container).length, 3);
  assert.equal(textOf(summary), "No decisions linked yet. 3 available.");

  picker.setLoading();
  assert.equal(textOf(summary), DECISION_PICKER_LOADING_STATUS_TEXT);
  assert.equal(container.querySelector(".decision-picker-empty:not(.decision-picker-loading)"), null);
  // An empty log states its own thing, and it is neither loading sentence.
  picker.setDecisions([]);
  assert.equal(textOf(summary), "No decisions are available to link yet.");
  assert.ok(container.querySelector(".decision-picker-empty"));
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
  assert.equal(textOf(action), "Record a decision");
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
  // The head of that order is the governing decision, and the summary names it:
  // that sentence is how the recorder learns which one it just chose.
  assert.equal(textOf(summary), "2 of 3 decisions linked. “Introduce feature flags” is the first linked decision.");

  checks(container)[2].click();
  assert.deepEqual(picker.selectedIds(), ["d-queue"]);
  assert.equal(textOf(summary), "1 of 3 decisions linked. “Adopt a durable job queue” is the first linked decision.");

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
  assert.match(page, /<legend>Decisions included in this release <span class="label-optional">\(optional\)<\/span><\/legend>/);
  assert.match(page, /Select every decision included in this release, or leave all unchecked\./);
  assert.match(page, /The first linked decision you select is summarised in its own section on the release page, above the other linked decisions\./);
  // One name for the relationship, page-wide: the recorder, the filters and the
  // list all say "linked decision", and no reader meets a second word for it.
  assert.doesNotMatch(page, /governing/i, "the Releases page reintroduces a second name for a linked decision");
  assert.match(page, /A completed release implemented its selected decisions\. A planned or cancelled release only names them\./);
  assert.doesNotMatch(page, /Only a completed release shipped what it carried/);
  assert.doesNotMatch(page, /Tick every decision this release carried/);
  // The three required fields issue #533 adds. The date is a native date
  // control, so the platform supplies the picker and the format hint; the
  // summary is required in the markup as well as in createRelease().
  assert.match(page, /id="release-released-on" name="releasedOn" type="date" required/);
  assert.match(page, /<label for="release-released-on">Release date <span class="label-optional label-required">\(required\)<\/span><\/label>/);
  assert.match(page, /<label for="release-description">Summary <span class="label-optional label-required">\(required\)<\/span><\/label>/);
  assert.match(page, /id="release-description" name="description"[^>]*\srequired/);
  // `required` is absent because linking decisions is optional.
  assert.doesNotMatch(page, /class="decision-picker-check"/);
  assert.match(page, /id="release-decisions-field" aria-describedby="release-decisions-hint release-decisions-summary"/);
  assert.match(page, /id="release-decisions-summary" role="status" aria-live="polite" aria-atomic="true">No decisions can be linked until the list loads\.<\/p>/);
  assert.match(page, /class="decision-picker-empty decision-picker-loading" aria-hidden="true">\s*<p class="decision-picker-empty-title">Loading decisions to link…<\/p>/);
  // The wait is stated once. The status line beside the picker used to repeat
  // the placeholder verbatim, which painted the sentence twice in the form.
  assert.equal(page.match(/Loading decisions to link…/g).length, 1, "the recorder states the wait twice");
  assert.match(page, /id="release-form-error" role="alert" hidden/);
  assert.match(page, /id="release-storage-notice" role="alert" hidden/);
  assert.match(page, /<button type="submit">Record release<\/button>/);
  // The filter select and the form's status select must stay distinct controls.
  assert.match(page, /id="release-form-status" name="status"/);
  assert.doesNotMatch(`${form}\n${wiring}`, /innerHTML/);
});
