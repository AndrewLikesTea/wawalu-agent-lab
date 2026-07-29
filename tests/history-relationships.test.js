// The decision–release relationship inside the filtered history.
//
// Filtering the history is what makes the link easy to lose: narrow to
// Decisions and every release row leaves the list, narrow to Accepted and half
// the decisions do. These tests pin the rule that the relationship belongs to
// the records, not to the view — a row names its counterparts under every
// filter, links to them, and says plainly when one is not in the current list.
//
// The pure layer is asserted directly; the render layer runs against the shared
// element stub, so the row structure, the link targets, and the counted rows are
// pinned without a browser.
import test from "node:test";
import assert from "node:assert/strict";
import {
  HIDDEN_LINK_NOTE,
  RELATIONSHIP_COPY,
  renderHistory,
  toHistoryRecords,
} from "../src/app.js";
import { createHistoryHarness } from "./support/decision-log.js";
import { initDecisionLog } from "../src/app.js";
import { byClass, createElement, first, installDocument } from "./support/dom.js";

installDocument();

const decisions = [
  { id: "queue", title: "Adopt a durable queue", context: "Retries are required", alternatives: "Poll the database", owner: "Kai", status: "approved", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "cache", title: "Approve edge cache", context: "Reduce latency", owner: "Mina", status: "pending", createdAt: "2026-03-01T00:00:00.000Z" },
  { id: "solo", title: "Retire the cron worker", context: "Nothing ships this yet", owner: "Priya", status: "proposed", createdAt: "2026-02-01T00:00:00.000Z" },
];

const releases = [
  // "queue" is carried by two releases, so the reverse index has to hold a list
  // rather than a single answer.
  { id: "r-1-3-0", version: "v1.3.0", title: "Throughput and latency", description: "The durable queue shipped with a read cache.", status: "completed", owner: "Kai", createdAt: "2026-04-01T00:00:00.000Z", decisionIds: ["queue", "cache"] },
  { id: "r-1-4-0", version: "v1.4.0", title: "Delivery hardening", description: "Structured logs.", status: "planned", owner: "Priya", createdAt: "2026-05-01T00:00:00.000Z", decisionIds: ["queue", "gone-id"] },
];

const records = toHistoryRecords(decisions, releases);
const record = (id) => records.find((candidate) => candidate.id === id);
const labels = (node) => byClass(node, "record-link-label").map((label) => label.textContent);

function render(view) {
  const container = createElement("div");
  const count = createElement("span");
  const visible = renderHistory(container, count, records, view);
  return { container, count, visible };
}

// The row for a record, addressed the way a reader finds it: by its title.
function rowFor(container, title) {
  const card = byClass(container, "history-card")
    .find((candidate) => candidate.children[0].textContent === title);
  assert.ok(card, `no history row is titled "${title}"`);
  return card.parent;
}

test("every record carries its counterparts, in both directions", () => {
  assert.deepEqual(record("queue").links, [
    { type: "release", id: "r-1-3-0", label: "v1.3.0", href: "/release.html?id=r-1-3-0", missing: false },
    { type: "release", id: "r-1-4-0", label: "v1.4.0", href: "/release.html?id=r-1-4-0", missing: false },
  ]);
  assert.deepEqual(record("solo").links, [], "a decision no release carried has no links, not a wrong one");
  assert.deepEqual(record("r-1-3-0").links.map(({ id, label }) => [id, label]), [
    ["queue", "Adopt a durable queue"],
    ["cache", "Approve edge cache"],
  ]);
  // A release that names the same decision twice is still one release in that
  // decision's history, so the decision side states it once rather than
  // repeating a link to the same record.
  const repeated = toHistoryRecords(decisions, [{ ...releases[0], decisionIds: ["queue", "queue"] }]);
  assert.deepEqual(repeated.find(({ id }) => id === "queue").links.map(({ id }) => id), ["r-1-3-0"]);
  // A dangling reference is named and carries no target: there is no record to
  // open, and dropping it would make the row disagree with the release's own
  // "1 missing" count.
  assert.deepEqual(record("r-1-4-0").links.at(-1), {
    type: "decision",
    id: "gone-id",
    label: "Unavailable decision",
    href: "",
    missing: true,
  });
});

test("a decision row names the releases that shipped it, each as its own link", () => {
  const { container } = render({});
  const row = rowFor(container, "Adopt a durable queue");
  const relationship = first(row, "record-links");
  assert.ok(relationship, "the decision row states no relationship at all");
  assert.match(relationship.textContent, new RegExp(RELATIONSHIP_COPY.decision.label));
  assert.deepEqual(labels(relationship), ["v1.3.0", "v1.4.0"]);
  assert.deepEqual(
    byClass(relationship, "record-link").map((link) => [link.tagName, link.href]),
    [["A", "/release.html?id=r-1-3-0"], ["A", "/release.html?id=r-1-4-0"]],
  );

  // Not nested inside the card's own link: an anchor cannot contain an anchor,
  // and arrow-key navigation walks `.history-card`, so the counterparts stay
  // out of it and the established list navigation is unchanged.
  const [card] = byClass(row, "history-card");
  assert.equal(byClass(card, "record-link").length, 0);
  assert.equal(relationship.parent.tagName, "ARTICLE");

  const none = first(rowFor(container, "Retire the cron worker"), "record-link-empty");
  assert.equal(none.textContent, RELATIONSHIP_COPY.decision.empty);
});

test("a release row links every decision it carried, and names a lost one without a dead link", () => {
  const { container } = render({});
  const relationship = first(rowFor(container, "v1.4.0 · Delivery hardening"), "record-links");
  assert.notEqual(RELATIONSHIP_COPY.release.label, "Linked decisions",
    "the linking row must not repeat the card's own count line");
  assert.match(relationship.textContent, new RegExp(RELATIONSHIP_COPY.release.label));
  assert.deepEqual(labels(relationship), ["Adopt a durable queue"]);
  assert.deepEqual(
    byClass(relationship, "record-link").map((link) => link.href ?? ""),
    ["/decision.html?id=queue", ""],
  );

  const missing = first(relationship, "record-link-missing");
  assert.equal(missing.tagName, "SPAN", "a reference with no record must not render as a link");
  assert.equal(missing.textContent, "Unavailable decision");
  // The row and the release's own summary agree about what is missing.
  assert.match(rowFor(container, "v1.4.0 · Delivery hardening").textContent, /2 decisions · 1 accepted, 1 missing/);

  // A release with nothing linked says so once, on its own card, rather than
  // twice: no second line repeats it.
  const bare = createElement("div");
  renderHistory(bare, createElement("span"),
    toHistoryRecords([], [{ ...releases[0], id: "r-2-0-0", version: "v2.0.0", decisionIds: [] }]), {});
  assert.equal(byClass(bare, "record-links").length, 0);
  assert.match(bare.textContent, /Linked decisions\s*No linked decisions/);
});

test("filtering hides rows, never relationships — and says which counterparts left the list", () => {
  const decisionsOnly = render({ type: "decision" });
  assert.equal(decisionsOnly.visible, 3, "the filter still selects rows, not links");
  assert.equal(decisionsOnly.count.textContent, "3 of 5 records", "a relationship link must never be counted as a record");
  assert.equal(byClass(decisionsOnly.container, "history-card").length, 3);

  const row = rowFor(decisionsOnly.container, "Adopt a durable queue");
  assert.deepEqual(labels(row), ["v1.3.0", "v1.4.0"], "the releases that shipped it are still named");
  const hidden = byClass(row, "record-link-hidden");
  assert.equal(hidden.length, 2, "both releases left the list, so both links say so");
  assert.equal(first(row, "record-link-note").textContent, HIDDEN_LINK_NOTE);
  assert.deepEqual(hidden.map((link) => link.href), ["/release.html?id=r-1-3-0", "/release.html?id=r-1-4-0"],
    "a counterpart outside the view is still openable");

  // Unfiltered, every counterpart is on screen, so no row carries the note.
  assert.equal(byClass(render({}).container, "record-link-hidden").length, 0);

  // A narrower filter marks only the counterparts it actually removed: the
  // pending "cache" decision is gone from the list, the accepted "queue" is not.
  const accepted = render({ status: "accepted" });
  const release = rowFor(render({ type: "release" }).container, "v1.3.0 · Throughput and latency");
  assert.equal(byClass(release, "record-link-hidden").length, 2);
  assert.equal(accepted.count.textContent, "1 of 5 records");
  assert.deepEqual(labels(rowFor(accepted.container, "Adopt a durable queue")), ["v1.3.0", "v1.4.0"]);
});

test("the relationship survives the live filter and the empty-state reset", async () => {
  const demo = { decisions, releases };
  const harness = createHistoryHarness(demo);
  await initDecisionLog(harness.root, harness.storage, { announceDelay: 0, seed: demo });

  assert.equal(byClass(harness.list, "record-link-hidden").length, 0, "an unfiltered history hides nothing");
  const shippedIn = () => labels(rowFor(harness.list, "Adopt a durable queue"));
  assert.deepEqual(shippedIn(), ["v1.3.0", "v1.4.0"]);

  harness.chooseType("decision");
  assert.deepEqual(shippedIn(), ["v1.3.0", "v1.4.0"], "narrowing to decisions dropped the release links");
  // Both releases left the list, so every link to one is marked: two on the
  // queue decision, one on the cache decision.
  assert.equal(byClass(harness.list, "record-link-hidden").length, 3);
  assert.equal(harness.count.textContent, "3 of 5 records");

  // No match at all: the one action is the reset, and it restores the rows and
  // their relationships together.
  harness.type("nothing matches this");
  assert.equal(byClass(harness.list, "record-link").length, 0);
  const reset = first(harness.list, "history-reset-action");
  harness.click(reset);
  assert.equal(harness.count.textContent, "5 records");
  assert.deepEqual(shippedIn(), ["v1.3.0", "v1.4.0"]);
  assert.equal(byClass(harness.list, "record-link-hidden").length, 0);
});
