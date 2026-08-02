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
    { id: "r-1-3-0", version: "v1.3.0", title: "Throughput and latency", description: "The durable queue shipped.", status: "completed", owner: "Kai", createdAt: "2026-04-01T00:00:00.000Z", decisionIds: ["queue", "cache"] },
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

// The same page, opened at a URL — a pasted link, or a reload of one. The
// harness carries a location, a history stack, and the popstate the browser
// fires when Back unwinds it, so the page is driven through the API it calls in
// production rather than through its handlers.
async function open(search = "", { clipboard } = {}) {
  const harness = createHistoryHarness(demo, { search, clipboard });
  await initDecisionLog(harness.root, harness.storage, {
    announceDelay: 0,
    seed: demo,
    ...harness.browser,
  });
  return harness;
}

const chipText = (harness) => harness.chipButtons().map((chip) => chip.textContent.replace(" ×", ""));

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

// Both controls narrow the stream to decisions, so a type filter asking for
// releases contradicts either one. The pair must not compose into a
// guaranteed-empty list that nothing on screen explains.
test("selecting Releases disables the decision-only filters and clears their values", async () => {
  const harness = await open();
  const releaseHint = harness.elements["#filter-release-hint"];

  harness.chooseStatus("approved");
  harness.chooseRelease("r-1-3-0");
  assert.deepEqual(titles(harness), ["Adopt a durable queue"]);
  assert.equal(harness.status.disabled, false);
  assert.equal(harness.elements["#filter-release"].disabled, false);

  harness.chooseType("release");
  assert.equal(harness.status.disabled, true, "a release can never carry a decision status");
  assert.equal(harness.status.value, "all", "the inapplicable selection is cleared, not left inert");
  assert.match(harness.statusHint.textContent, /Unavailable while the record type is set to Releases/);
  assert.equal(harness.elements["#filter-release"].disabled, true, "a release row is never one of its own decisions");
  assert.equal(harness.elements["#filter-release"].value, "all");
  assert.match(releaseHint.textContent, /Unavailable while the record type is set to Releases/);
  assert.deepEqual(titles(harness), ["v1.3.0 · Throughput and latency"]);
  assert.equal(harness.url, "?type=release", "the cleared filters leave the link too");

  harness.chooseType("all");
  assert.equal(harness.status.disabled, false);
  assert.match(harness.statusHint.textContent, /Choosing a status shows decision records only/);
  assert.equal(harness.elements["#filter-release"].disabled, false);
  assert.match(releaseHint.textContent, /Shows decisions associated with the selected release/);
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

test("a release filter shows its decisions and one prioritized non-final follow-up", async () => {
  const harness = await open();
  harness.chooseRelease("r-1-3-0");

  assert.deepEqual(titles(harness), ["Approve edge cache", "Adopt a durable queue"]);
  assert.equal(harness.url, "?release=r-1-3-0");
  assert.equal(harness.summary.textContent, "2 of 3 records");
  assert.deepEqual(chipText(harness), ["Release: r-1-3-0"]);

  const followUp = harness.elements["#history-release-followup"];
  assert.equal(followUp.hidden, false);
  assert.match(followUp.textContent, /Prioritized follow-up.*Approve edge cache.*Owner: Mina.*Status: pending.*Settle/);

  harness.elements["#clear-decision-filters"].dispatch("click");
  assert.equal(harness.elements["#filter-release"].value, "all");
  assert.equal(followUp.hidden, true);
  assert.equal(harness.url, "");
  assert.equal(harness.search.focused, 1, "clearing keeps keyboard focus on a stable control");
});

test("a dangling reference on the selected release does not stand in for its open decision", async () => {
  const data = {
    decisions: demo.decisions,
    releases: [{ ...demo.releases[0], decisionIds: ["queue", "erased", "cache"] }],
  };
  const harness = createHistoryHarness(data);
  await initDecisionLog(harness.root, harness.storage, { announceDelay: 0, seed: data });
  harness.chooseRelease("r-1-3-0");

  // The release detail page ranks the broken link above an unsettled decision,
  // and rightly: a reference that resolves to nothing cannot be reviewed at
  // all. This panel answers a narrower question — which decision here is not
  // final — and the one thing it must not do is answer it with silence.
  const followUp = harness.elements["#history-release-followup"];
  assert.equal(followUp.hidden, false);
  assert.match(followUp.textContent, /Approve edge cache.*Owner: Mina.*Status: pending/);
  assert.deepEqual(titles(harness), ["Approve edge cache", "Adopt a durable queue"]);
});

/* ------------------------ the URL is the filter state ------------------------- */

test("every filter reaches the URL under its own name as it is set", async () => {
  const harness = await open();
  assert.equal(harness.url, "", "an unfiltered history is the clean base path");

  harness.chooseType("decision");
  assert.equal(harness.url, "?type=decision");

  harness.chooseStatus("pending");
  assert.equal(harness.url, "?type=decision&status=pending");

  harness.elements["#filter-owner"].value = "Mina";
  harness.elements["#filter-owner"].dispatch("change");
  assert.equal(harness.url, "?type=decision&status=pending&owner=Mina");

  harness.type("cache");
  assert.equal(harness.url, "?q=cache&type=decision&status=pending&owner=Mina");

  harness.chooseDates("2026-02-01", "2026-04-30");
  assert.equal(harness.url, "?q=cache&type=decision&status=pending&owner=Mina&from=2026-02-01&to=2026-04-30");
  assert.deepEqual(titles(harness), ["Approve edge cache"]);
});

test("a filtered link opens on the identical filter state and the identical rows", async () => {
  const filtered = await open("?owner=Kai&from=2026-02-01");
  assert.deepEqual(titles(filtered), ["v1.3.0 · Throughput and latency"]);
  assert.equal(filtered.count.textContent, "1 of 3 records");
  // The controls agree with the link: nothing filters by a value the page does
  // not also show.
  assert.equal(filtered.elements["#filter-owner"].value, "Kai");
  assert.equal(filtered.elements["#filter-from"].value, "2026-02-01");
  assert.equal(filtered.url, "?owner=Kai&from=2026-02-01", "reloading must not rewrite the link");

  // Reloading is opening the same URL again.
  const reloaded = await open(filtered.url);
  assert.deepEqual(titles(reloaded), titles(filtered));
  assert.equal(reloaded.url, filtered.url);
});

test("a malformed link renders the nearest valid view, not a crash or an empty one", async () => {
  // An unknown status, an unknown record type, an impossible date, an end
  // before the start, and a parameter this view does not own — beside one
  // filter that is perfectly good.
  const harness = await open(
    "?status=completed&type=deleted&from=2026-01-01&to=2020-06-01&bad=2026-13-45&owner=Kai&utm_source=slack",
  );
  // Every unusable piece degrades on its own; the good ones survive.
  assert.deepEqual(titles(harness), ["v1.3.0 · Throughput and latency", "Adopt a durable queue"]);
  assert.equal(harness.status.value, "all");
  assert.equal(harness.radios.find((radio) => radio.checked).value, "all");
  assert.equal(harness.elements["#filter-to"].value, "", "an end before the start is not a window");
  // And the address bar is corrected to the state actually on screen, without
  // a history entry standing between the visitor and the page they came from.
  assert.equal(harness.url, "?owner=Kai&from=2026-01-01");
  assert.deepEqual(harness.entries, ["?owner=Kai&from=2026-01-01"]);
});

test("an owner this log has never held falls back to the whole history", async () => {
  const harness = await open("?owner=Nobody");
  assert.equal(harness.count.textContent, "3 records");
  assert.equal(harness.url, "");
});

/* --------------------------- the summary and the chips ------------------------ */

test("the summary line is the headline of the list and the chips are its filters", async () => {
  const harness = await open();
  assert.equal(harness.summary.textContent, "3 records");
  assert.equal(harness.chips.hidden, true, "there is nothing to dismiss yet");

  harness.chooseType("decision");
  harness.chooseDates("2026-01-01", "2026-03-31");
  assert.equal(harness.summary.textContent, "2 of 3 records · decisions · Jan 1 – Mar 31");
  assert.equal(harness.summary.dataset.filtered, "true");
  assert.equal(harness.chips.hidden, false);
  assert.deepEqual(chipText(harness), ["Record type: Decisions", "From: Jan 1, 2026", "To: Mar 31, 2026"]);
});

test("a script-like search term is rendered as text in the summary row", async () => {
  const harness = await open(`?q=${encodeURIComponent("<script>alert(1)</script>")}`);
  assert.equal(harness.search.value, "<script>alert(1)</script>");
  assert.deepEqual(chipText(harness), ["Search: <script>alert(1)</script>"]);
  assert.equal(harness.chips.querySelectorAll("SCRIPT").length, 0, "the query is text, not markup");
  assert.equal(harness.summary.textContent, "0 of 3 records");
});

test("dismissing a chip removes only that filter, updates the URL, and keeps focus", async () => {
  const harness = await open("?type=decision&owner=Kai");
  assert.deepEqual(chipText(harness), ["Record type: Decisions", "Owner: Kai"]);
  assert.deepEqual(titles(harness), ["Adopt a durable queue"]);

  harness.removeChip("type");
  assert.deepEqual(chipText(harness), ["Owner: Kai"], "the other filter is still composed");
  assert.equal(harness.url, "?owner=Kai");
  assert.deepEqual(titles(harness), ["v1.3.0 · Throughput and latency", "Adopt a durable queue"]);
  assert.equal(harness.radios.find((radio) => radio.checked).value, "all", "the control follows the chip");
  // Focus cannot be lost to the top of the document: it lands on the chip that
  // took the removed one's place.
  assert.equal(harness.chipButtons()[0].focused, 1);

  harness.removeChip("owner");
  assert.deepEqual(chipText(harness), []);
  assert.equal(harness.url, "");
  assert.equal(harness.count.textContent, "3 records");
  // With no chip left to hold it, focus moves to the next control along.
  assert.equal(harness.elements["#copy-history-link"].focused, 1);
});

test("clear all returns to the clean base path and the unfiltered history", async () => {
  const harness = await open("?q=queue&type=decision&owner=Kai&from=2026-01-01&current=only");
  assert.equal(harness.count.textContent, "1 of 3 records");

  harness.elements["#clear-decision-filters"].dispatch("click");

  assert.equal(harness.url, "", "no filter parameter may be left behind");
  assert.equal(harness.count.textContent, "3 records");
  assert.equal(harness.summary.textContent, "3 records");
  assert.deepEqual(chipText(harness), []);
  assert.equal(harness.search.value, "");
  assert.equal(harness.elements["#filter-from"].value, "");
  assert.equal(harness.search.focused, 1);
});

/* ---------------------------------- history ---------------------------------- */

test("Back steps through the prior filter states and re-renders each one", async () => {
  const harness = await open();
  harness.chooseType("decision");
  harness.chooseStatus("pending");
  assert.deepEqual(harness.entries, ["", "?type=decision", "?type=decision&status=pending"]);
  assert.deepEqual(titles(harness), ["Approve edge cache"]);

  harness.back();
  assert.equal(harness.url, "?type=decision");
  assert.equal(harness.status.value, "all", "the controls step back with the results");
  assert.deepEqual(titles(harness), ["Approve edge cache", "Adopt a durable queue"]);
  assert.equal(harness.count.textContent, "2 of 3 records");
  assert.deepEqual(chipText(harness), ["Record type: Decisions"]);

  harness.back();
  assert.equal(harness.url, "");
  assert.equal(harness.radios.find((radio) => radio.checked).value, "all");
  assert.equal(harness.count.textContent, "3 records");
  assert.deepEqual(chipText(harness), []);
});

test("a filter change that changes nothing does not stack a history entry", async () => {
  const harness = await open("?type=decision");
  harness.chooseType("decision");
  harness.chooseStatus("all");
  harness.type("");
  assert.deepEqual(harness.entries, ["?type=decision"], "Back would appear to do nothing");
});

/* -------------------------------- copy the link ------------------------------- */

test("copying the link writes the absolute filtered URL and confirms in its own region", async () => {
  const written = [];
  const harness = await open("", { clipboard: { writeText: async (value) => { written.push(value); } } });
  harness.chooseType("release");

  harness.elements["#copy-history-link"].dispatch("click");
  await settle();

  assert.deepEqual(written, ["https://labs.wawalu.org/?type=release"]);
  assert.match(harness.copyStatus.textContent, /Link copied/);
  // Two live regions, so the confirmation and the record count cannot overwrite
  // each other mid-announcement.
  assert.equal(harness.announcement.textContent, "Showing 1 of 3 records.");
});

test("a refused or missing clipboard says so instead of failing silently", async () => {
  const refused = await open("", { clipboard: { writeText: async () => { throw new Error("denied"); } } });
  refused.elements["#copy-history-link"].dispatch("click");
  await settle();
  assert.match(refused.copyStatus.textContent, /Could not copy the link/);
  assert.match(refused.copyStatus.textContent, /address bar/);

  const missing = await open("", { clipboard: null });
  missing.elements["#copy-history-link"].dispatch("click");
  await settle();
  assert.match(missing.copyStatus.textContent, /Could not copy the link/);
});
