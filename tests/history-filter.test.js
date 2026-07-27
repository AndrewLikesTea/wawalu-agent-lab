// Filtering the Shiplog history by record type and decision status.
//
// The pure selection layer is tested directly; the render layer is tested with
// the shared element stub so the composed count, the empty state, and the row
// context are pinned without a browser. The filter controls themselves are
// asserted against the page markup — they are native form controls, so what
// matters is that each has a programmatically associated visible label and
// stays keyboard operable.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  RECORD_TYPES,
  createCountAnnouncer,
  historyCountMessage,
  renderHistory,
  selectHistory,
  toHistoryRecords,
} from "../src/app.js";
import { byClass, createElement, first, installDocument, tags, walk } from "./support/dom.js";

installDocument();

const decisions = [
  { id: "queue", title: "Adopt a durable queue", context: "Retries are required", alternatives: "Poll the database", owner: "Kai", status: "approved", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "cache", title: "Approve edge cache", context: "Reduce latency", owner: "Mina", status: "pending", createdAt: "2026-03-01T00:00:00.000Z" },
  { id: "flags", title: "Feature flags first", context: "Ship behind a flag", owner: "Priya", status: "accepted", createdAt: "2026-02-01T00:00:00.000Z" },
];

const releases = [
  { id: "r-1-3-0", version: "v1.3.0", title: "Throughput and latency", description: "The durable queue shipped with a read cache.", status: "completed", owner: "Kai", createdAt: "2026-04-01T00:00:00.000Z", decisionIds: ["queue", "cache"] },
  { id: "r-1-4-0", version: "v1.4.0", title: "Delivery hardening", description: "Flags and structured logs.", status: "planned", owner: "Priya", createdAt: "2026-05-01T00:00:00.000Z", decisionIds: ["flags", "missing-id"] },
];

const records = toHistoryRecords(decisions, releases);
const ids = (selected) => selected.map((record) => record.id);

test("the history stream carries both record kinds with a normalized shape", () => {
  assert.deepEqual(RECORD_TYPES, ["all", "decision", "release"]);
  assert.equal(records.length, 5);
  const release = records.find((record) => record.id === "r-1-3-0");
  assert.equal(release.type, "release");
  assert.equal(release.title, "Throughput and latency");
  assert.equal(release.owner, "Kai");
  assert.equal(release.status, "completed");
  // Linked decisions resolve for search and for the row's context summary.
  assert.deepEqual(release.release.decisions.map((decision) => decision.id), ["queue", "cache"]);
  assert.deepEqual(records.find((record) => record.id === "r-1-4-0").release.missingIds, ["missing-id"]);
});

test("filtering by record type narrows the list", () => {
  assert.deepEqual(ids(selectHistory(records, { type: "decision" })), ["cache", "flags", "queue"]);
  assert.deepEqual(ids(selectHistory(records, { type: "release" })), ["r-1-4-0", "r-1-3-0"]);
  assert.equal(selectHistory(records, { type: "all" }).length, 5);
  assert.equal(selectHistory(records, { type: "nonsense" }).length, 5);
});

test("filtering by decision status narrows the list and implies decisions", () => {
  // "queue" is stored under the retired "approved". It reads as accepted, so
  // the accepted filter returns it and the legacy value resolves to the same
  // set rather than to a status no record can carry.
  assert.deepEqual(ids(selectHistory(records, { status: "accepted" })), ["flags", "queue"]);
  assert.deepEqual(ids(selectHistory(records, { status: "approved" })), ["flags", "queue"]);
  // A status can only describe a decision, so releases drop out even though the
  // type filter is still "all records".
  assert.deepEqual(ids(selectHistory(records, { status: "pending", type: "all" })), ["cache"]);
  // "completed" is a release status, not a decision status: it is not a valid
  // value for this control and degrades to "no status filter".
  assert.equal(selectHistory(records, { status: "completed" }).length, 5);
});

test("type and status compose, including the contradictory combination", () => {
  assert.deepEqual(ids(selectHistory(records, { type: "decision", status: "accepted" })), ["flags", "queue"]);
  assert.deepEqual(selectHistory(records, { type: "release", status: "accepted" }), []);
});

test("filters and search AND together without resetting one another", () => {
  // Search alone spans both kinds: the release matches on its own copy.
  assert.deepEqual(ids(selectHistory(records, { query: "queue" })), ["r-1-3-0", "queue"]);
  // The same search, narrowed by type, keeps the search term applied.
  assert.deepEqual(ids(selectHistory(records, { query: "queue", type: "decision" })), ["queue"]);
  assert.deepEqual(ids(selectHistory(records, { query: "queue", type: "release" })), ["r-1-3-0"]);
  // And narrowed by status on top of the search.
  assert.deepEqual(ids(selectHistory(records, { query: "queue", status: "approved" })), ["queue"]);
  assert.deepEqual(selectHistory(records, { query: "queue", status: "pending" }), []);
  // A release is searchable by version and by the titles of linked decisions.
  assert.deepEqual(ids(selectHistory(records, { query: "v1.4.0" })), ["r-1-4-0"]);
  assert.deepEqual(ids(selectHistory(records, { query: "feature flags" })), ["r-1-4-0", "flags"]);
});

test("owner and sort still compose across the mixed stream", () => {
  assert.deepEqual(ids(selectHistory(records, { owner: "Kai" })), ["r-1-3-0", "queue"]);
  assert.deepEqual(
    ids(selectHistory(records, { sort: "title" })),
    ["queue", "cache", "r-1-4-0", "flags", "r-1-3-0"],
  );
  assert.equal(selectHistory([], { type: "decision" }).length, 0);
});

test("selection never mutates the source stream", () => {
  const before = ids(records);
  selectHistory(records, { sort: "title", type: "decision" });
  assert.deepEqual(ids(records), before);
});

function render(view) {
  const container = createElement("div");
  const count = createElement("span");
  const visible = renderHistory(container, count, records, view);
  return { container, count, visible };
}

test("the visible count matches the number of rendered rows", () => {
  const all = render({});
  assert.equal(all.visible, 5);
  assert.equal(all.count.textContent, "5 records");
  assert.equal(byClass(all.container, "history-card").length, 5);

  const decisionsOnly = render({ type: "decision" });
  assert.equal(decisionsOnly.visible, 3);
  assert.equal(decisionsOnly.count.textContent, "3 of 5 records");
  assert.equal(byClass(decisionsOnly.container, "history-card").length, 3);
  assert.equal(byClass(decisionsOnly.container, "release-card").length, 0);

  const oneStatus = render({ status: "approved", query: "queue" });
  assert.equal(oneStatus.visible, 1);
  assert.equal(oneStatus.count.textContent, "1 of 5 records");
  assert.equal(byClass(oneStatus.container, "history-card").length, 1);
});

test("the announced count reflects the composed result, not the total", () => {
  assert.equal(historyCountMessage(5, 5), "Showing all 5 records.");
  assert.equal(historyCountMessage(1, 5), "Showing 1 of 5 records.");
  assert.equal(historyCountMessage(0, 5), "No records match the current filters.");
  assert.equal(historyCountMessage(0, 0), "No records recorded yet.");
});

test("the count announcement is debounced to one settled message per burst", () => {
  const node = createElement("p");
  const timers = [];
  const announce = createCountAnnouncer(node, {
    delay: 500,
    setTimer: (callback) => timers.push(callback) && timers.length,
    clearTimer: (handle) => { timers[handle - 1] = null; },
  });

  announce("Showing 5 of 5 records.");
  announce("Showing 2 of 5 records.");
  announce("Showing 1 of 5 records.");
  assert.equal(node.textContent, "", "nothing is announced mid-burst");

  for (const callback of timers) callback?.();
  assert.equal(node.textContent, "Showing 1 of 5 records.");
  assert.equal(timers.filter(Boolean).length, 1, "only the last keystroke survives");
});

test("a filtered-empty result offers exactly one primary action: reset filters", () => {
  const { container, count, visible } = render({ query: "nothing matches this" });
  assert.equal(visible, 0);
  assert.equal(count.textContent, "0 of 5 records");
  assert.match(container.textContent, /No records match your filters/);
  assert.equal(tags(container, "OL").length, 0);

  const actions = walk(container, (node) => node.tagName === "BUTTON");
  assert.equal(actions.length, 1);
  const [reset] = actions;
  assert.equal(reset.textContent, "Reset filters");
  assert.equal(reset.type, "button");
  assert.equal(reset.dataset.action, "reset-filters");
  assert.equal(reset.getAttribute("aria-controls"), "decision-list");
  // Reusing the #251 empty-state component, not a second one.
  assert.ok(reset.classes.includes("empty-action"));
  assert.ok(first(container, "list-state-empty"));
});

test("no-records-at-all stays a different message from no-matches", () => {
  const container = createElement("div");
  const count = createElement("span");
  assert.equal(renderHistory(container, count, [], { type: "release" }), 0);
  assert.equal(count.textContent, "0 records");
  assert.match(container.textContent, /No decisions yet/);
  assert.equal(byClass(container, "history-reset-action").length, 0);
  assert.equal(byClass(container, "decision-empty-action").length, 1);
});

test("a filtered row keeps its full record context and its open affordance", () => {
  const { container } = render({ type: "release", query: "v1.3.0" });
  const [card] = byClass(container, "release-card");
  assert.equal(card.tagName, "A");
  assert.equal(card.href, "/release.html?id=r-1-3-0");
  assert.match(card.textContent, /v1\.3\.0 · Throughput and latency/);
  assert.match(card.textContent, /Type: Release/);
  assert.match(card.textContent, /Status: completed/);
  assert.match(card.textContent, /The durable queue shipped with a read cache\./);
  assert.match(card.textContent, /Linked decisions/);
  assert.match(card.textContent, /2 decisions · 1 pending, 1 accepted/);
  assert.match(card.textContent, /Owner Kai/);
  assert.match(card.textContent, /View release details/);
  assert.equal(card.getAttribute("aria-labelledby"), "release-title-0");
  assert.equal(card.getAttribute("aria-describedby"), "release-summary-0");

  const decisionCard = byClass(render({ type: "decision", query: "durable" }).container, "decision-card")[0];
  assert.equal(decisionCard.href, "/decision.html?id=queue");
  assert.match(decisionCard.textContent, /Type: Decision/);
  assert.match(decisionCard.textContent, /Status: accepted/);
  assert.match(decisionCard.textContent, /Retries are required/);
  assert.match(decisionCard.textContent, /Alternatives.*Poll the database/s);
  assert.match(decisionCard.textContent, /Owner Kai/);
  assert.match(decisionCard.textContent, /View decision details/);
});

test("filter controls are native, labelled, and keyboard operable", async () => {
  const page = await readFile(new URL("../src/index.html", import.meta.url), "utf8");

  // A real fieldset/legend, not a div pretending to be a group.
  assert.match(page, /<fieldset class="filter filter-group">\s*<legend>Record type<\/legend>/);
  for (const [id, value, label] of [
    ["record-type-all", "all", "All records"],
    ["record-type-decision", "decision", "Decisions"],
    ["record-type-release", "release", "Releases"],
  ]) {
    assert.match(page, new RegExp(`<input id="${id}" name="record-type" type="radio" value="${value}"`));
    assert.match(page, new RegExp(`<label for="${id}">${label}</label>`));
  }
  assert.match(page, /<input id="record-type-all"[^>]*checked/);

  // The status select keeps a visible label and an associated hint stating the
  // coupling rule, so the behaviour is not signalled by position or colour.
  assert.match(page, /<label for="filter-status">Decision status:<\/label>/);
  assert.match(page, /<select id="filter-status" aria-describedby="filter-status-hint">/);
  assert.match(page, /id="filter-status-hint">Applies to decisions\. Choosing a status shows decision records only\./);
  assert.match(page, /<label for="decision-search">Search records<\/label>/);
  assert.doesNotMatch(page, /role="listbox"|role="combobox"/);
});

test("the type filter drives the status control's availability", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  // Disabled is a native state assistive tech reports; the hint text changes
  // with it, and the stale selection is cleared rather than left inert.
  assert.match(source, /statusFilter\.disabled = unavailable;/);
  assert.match(source, /const unavailable = view\.type === "release";/);
  assert.match(source, /statusHint\.textContent = unavailable \? STATUS_HINT_UNAVAILABLE : STATUS_HINT/);
  assert.match(source, /view\.status = "all";\s*\n\s*statusFilter\.value = "all";/);
  // One reset path shared by the toolbar button and the empty-state action.
  assert.match(source, /clearFilters\?\.addEventListener\("click", resetFilters\)/);
  assert.match(source, /trigger\?\.dataset\.action === "reset-filters"\) resetFilters\(\)/);
  // Filter state lives in one object the render function reads from.
  assert.match(source, /const view = \{\s*\n\s*query: "",\s*\n\s*type: "all",\s*\n\s*status: "all",/);
});
