// End-to-end wiring for the history filters: the controls, the composed render,
// the debounced announcement, and the empty state's reset path, driven through
// initDecisionLog rather than the pure selection layer.
import test from "node:test";
import assert from "node:assert/strict";
import { initDecisionLog } from "../src/app.js";
import { createHistoryHarness } from "./support/decision-log.js";
import { byClass, first } from "./support/dom.js";

const demo = {
  decisions: [
    { id: "queue", title: "Adopt a durable queue", context: "Retries are required", alternatives: "Poll the database", owner: "Kai", status: "approved", createdAt: "2026-01-01T00:00:00.000Z" },
    { id: "cache", title: "Approve edge cache", context: "Reduce latency", owner: "Mina", status: "pending", createdAt: "2026-03-01T00:00:00.000Z" },
  ],
  releases: [
    { id: "r-1-3-0", version: "v1.3.0", title: "Throughput and latency", description: "The durable queue shipped.", status: "completed", owner: "Kai", createdAt: "2026-04-01T00:00:00.000Z", decisionIds: ["queue"] },
  ],
};

const titles = (harness) => byClass(harness.list, "history-card").map((card) => card.children[0].textContent);
const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

async function boot() {
  const harness = createHistoryHarness(demo);
  // The example records reach the page as a seed now, not a fetch, so this
  // fixture is handed over the same way the real one is.
  await initDecisionLog(harness.root, harness.storage, { announceDelay: 0, seed: demo });
  return harness;
}

test("the history opens with every record and an accurate count", async () => {
  const harness = await boot();
  assert.deepEqual(titles(harness), [
    "v1.3.0 · Throughput and latency",
    "Approve edge cache",
    "Adopt a durable queue",
  ]);
  assert.equal(harness.count.textContent, "3 records");
  await settle();
  assert.equal(harness.announcement.textContent, "Showing all 3 records.");
});

test("the record type filter narrows the list and updates the count and announcement", async () => {
  const harness = await boot();

  harness.chooseType("release");
  assert.deepEqual(titles(harness), ["v1.3.0 · Throughput and latency"]);
  assert.equal(harness.count.textContent, "1 of 3 records");
  await settle();
  assert.equal(harness.announcement.textContent, "Showing 1 of 3 records.");

  harness.chooseType("decision");
  assert.deepEqual(titles(harness), ["Approve edge cache", "Adopt a durable queue"]);
  assert.equal(harness.count.textContent, "2 of 3 records");

  harness.chooseType("all");
  assert.equal(harness.count.textContent, "3 records");
});

test("selecting Releases disables the decision status filter and clears its value", async () => {
  const harness = await boot();

  harness.chooseStatus("approved");
  assert.deepEqual(titles(harness), ["Adopt a durable queue"]);
  assert.equal(harness.status.disabled, false);

  harness.chooseType("release");
  assert.equal(harness.status.disabled, true, "a release can never carry a decision status");
  assert.equal(harness.status.value, "all", "the inapplicable selection is cleared, not left inert");
  assert.match(harness.statusHint.textContent, /Unavailable while the record type is set to Releases/);
  assert.deepEqual(titles(harness), ["v1.3.0 · Throughput and latency"]);

  harness.chooseType("all");
  assert.equal(harness.status.disabled, false);
  assert.match(harness.statusHint.textContent, /Choosing a status shows decision records only/);
  assert.equal(harness.count.textContent, "3 records");
});

test("filters and the search term compose and never reset one another", async () => {
  const harness = await boot();

  harness.type("queue");
  assert.deepEqual(titles(harness), ["v1.3.0 · Throughput and latency", "Adopt a durable queue"]);

  harness.chooseType("decision");
  assert.equal(harness.search.value, "queue", "changing a filter must not clear the search");
  assert.deepEqual(titles(harness), ["Adopt a durable queue"]);

  harness.chooseStatus("approved");
  assert.deepEqual(titles(harness), ["Adopt a durable queue"]);

  harness.type("cache");
  assert.equal(harness.radios.find((radio) => radio.checked).value, "decision", "typing must not reset the filters");
  assert.equal(harness.status.value, "approved");
  assert.equal(byClass(harness.list, "history-card").length, 0, "search AND status AND type");

  harness.chooseStatus("pending");
  assert.deepEqual(titles(harness), ["Approve edge cache"]);
  assert.equal(harness.count.textContent, "1 of 3 records");
});

test("no matches shows the reset empty state, and reset restores the previous list", async () => {
  const harness = await boot();

  harness.type("nothing matches this");
  harness.chooseType("release");
  assert.equal(byClass(harness.list, "history-card").length, 0);
  assert.match(harness.list.textContent, /No records match your filters/);
  await settle();
  assert.equal(harness.announcement.textContent, "No records match the current filters.");

  const reset = first(harness.list, "history-reset-action");
  assert.equal(reset.textContent, "Reset filters");
  harness.click(reset);

  assert.equal(harness.search.value, "");
  assert.equal(harness.radios.find((radio) => radio.checked).value, "all");
  assert.equal(harness.status.value, "all");
  assert.equal(harness.status.disabled, false);
  assert.equal(harness.count.textContent, "3 records");
  assert.deepEqual(titles(harness), [
    "v1.3.0 · Throughput and latency",
    "Approve edge cache",
    "Adopt a durable queue",
  ]);
  // Focus cannot stay on the button that was just re-rendered away.
  assert.equal(harness.search.focused, 1);
});

test("the owner filter spans both record kinds", async () => {
  const harness = await boot();
  assert.deepEqual(
    harness.elements["#filter-owner"].options.map((option) => option.value),
    ["all", "Kai", "Mina"],
  );

  harness.elements["#filter-owner"].value = "Kai";
  harness.elements["#filter-owner"].dispatch("change");
  assert.deepEqual(titles(harness), ["v1.3.0 · Throughput and latency", "Adopt a durable queue"]);
});
