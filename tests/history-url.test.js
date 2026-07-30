// The history's filter state as a shareable URL.
//
// Two properties are pinned here and nowhere else. First, the round trip:
// every state the controls can produce survives state → URL → state unchanged,
// so a pasted link and a reload open the view it was copied from. Second,
// totality: everything in this file arrives off somebody's clipboard, so no
// input may throw and no invalid piece may take a valid one down with it. The
// wiring — controls, chips, Back — is driven through the page in
// tests/history-filter-flow.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_HISTORY_FILTERS,
  absoluteHistoryUrl,
  historyFilterChips,
  historyFilterSearch,
  historyFiltersActive,
  historySummaryLine,
  normalizeFilterDate,
  normalizeHistoryRange,
  parseHistoryFilters,
} from "../src/history-filters.js";
import { selectHistory, toHistoryRecords } from "../src/app.js";
import {
  COPY_LINK_FAILURE,
  COPY_LINK_SUCCESS,
  copyHistoryLink,
  renderHistoryFilterChips,
  renderHistorySummary,
} from "../src/history-filter-view.js";
import { byClass, createElement, first, installDocument } from "./support/dom.js";

installDocument();

const FILTERED = {
  query: "queue",
  type: "decision",
  status: "accepted",
  owner: "Kai",
  from: "2026-04-01",
  to: "2026-06-30",
  currentOnly: true,
};

const decisions = [
  { id: "queue", title: "Adopt a durable queue", context: "Retries are required", owner: "Kai", status: "approved", createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "cache", title: "Approve edge cache", context: "Reduce latency", owner: "Mina", status: "pending", createdAt: "2026-05-15T00:00:00.000Z" },
  { id: "flags", title: "Feature flags first", context: "Ship behind a flag", owner: "Priya", status: "accepted", createdAt: "2026-06-30T23:30:00.000Z" },
];
const releases = [
  { id: "r-1-3-0", version: "v1.3.0", title: "Throughput", description: "The queue shipped.", status: "completed", owner: "Kai", createdAt: "2026-04-01T00:00:00.000Z", decisionIds: ["queue"] },
];
const records = toHistoryRecords(decisions, releases);
const ids = (view) => selectHistory(records, view).map((record) => record.id);

/* --------------------------------- state → URL -------------------------------- */

test("each filter serializes under one canonical parameter name", () => {
  assert.equal(historyFilterSearch({ query: "edge cache" }), "?q=edge+cache");
  assert.equal(historyFilterSearch({ type: "release" }), "?type=release");
  assert.equal(historyFilterSearch({ status: "accepted" }), "?status=accepted");
  assert.equal(historyFilterSearch({ owner: "Kai" }), "?owner=Kai");
  assert.equal(historyFilterSearch({ from: "2026-04-01" }), "?from=2026-04-01");
  assert.equal(historyFilterSearch({ to: "2026-06-30" }), "?to=2026-06-30");
  assert.equal(historyFilterSearch({ currentOnly: true }), "?current=only");
});

test("the combined state is one stable string, in one order", () => {
  assert.equal(
    historyFilterSearch(FILTERED),
    "?q=queue&type=decision&status=accepted&owner=Kai&from=2026-04-01&to=2026-06-30&current=only",
  );
  // The same state written twice is the same link twice: a shared URL is
  // diffable, and no filter changes place because a control was touched first.
  assert.equal(historyFilterSearch({ ...FILTERED }), historyFilterSearch(FILTERED));
});

test("an unfiltered view is the clean base path, not a trail of empty parameters", () => {
  assert.equal(historyFilterSearch({}), "");
  assert.equal(historyFilterSearch(DEFAULT_HISTORY_FILTERS), "");
  assert.equal(historyFilterSearch({ query: "   ", type: "all", status: "all", owner: "all", from: "", to: "" }), "");
  assert.equal(historyFiltersActive({}), false);
  assert.equal(historyFiltersActive({ owner: "Kai" }), true);
  assert.equal(absoluteHistoryUrl({ pathname: "/", origin: "https://labs.wawalu.org" }, {}), "https://labs.wawalu.org/");
  assert.equal(
    absoluteHistoryUrl({ pathname: "/", origin: "https://labs.wawalu.org" }, { owner: "Kai" }),
    "https://labs.wawalu.org/?owner=Kai",
  );
  // No origin to hang the link off (a file:// document) still yields a usable
  // path rather than the string "undefined/?owner=Kai".
  assert.equal(absoluteHistoryUrl({ pathname: "/" }, { owner: "Kai" }), "/?owner=Kai");
});

/* --------------------------------- URL → state -------------------------------- */

test("every filter survives the round trip unchanged", () => {
  assert.deepEqual(parseHistoryFilters(historyFilterSearch(FILTERED)), FILTERED);
  for (const [key, value] of Object.entries(FILTERED)) {
    const one = { ...DEFAULT_HISTORY_FILTERS, [key]: value };
    assert.deepEqual(parseHistoryFilters(historyFilterSearch(one)), one, `the ${key} filter did not round trip`);
  }
});

test("a filtered link opens on the identical result set", () => {
  const view = { type: "decision", from: "2026-04-01", to: "2026-06-30" };
  const restored = parseHistoryFilters(historyFilterSearch(view));
  assert.deepEqual(ids(restored), ids(view));
  assert.deepEqual(ids(restored), ["flags", "cache"]);
  // Both bounds are inclusive: the release is recorded at the exact start of
  // the window, the decision half an hour before the end of the last day.
  assert.deepEqual(ids(parseHistoryFilters("?from=2026-04-01&to=2026-06-30")), ["flags", "cache", "r-1-3-0"]);
  assert.deepEqual(ids(parseHistoryFilters("?from=2026-06-30")), ["flags"]);
  assert.deepEqual(ids(parseHistoryFilters("?to=2026-01-01")), ["queue"]);
});

test("the retired status word resolves to the one the view filters by", () => {
  // An old link says approved; the view has one word for that state now, and
  // the link keeps working rather than filtering by a status no record carries.
  assert.equal(parseHistoryFilters("?status=approved").status, "accepted");
  assert.deepEqual(ids(parseHistoryFilters("?status=approved")), ["flags", "queue"]);
});

/* ------------------------------ malformed input ------------------------------- */

test("an unknown parameter is ignored and never disturbs a valid one", () => {
  const filters = parseHistoryFilters("?owner=Kai&utm_source=slack&sort=chaos&=&q");
  assert.equal(filters.owner, "Kai");
  assert.deepEqual(ids(filters), ["r-1-3-0", "queue"]);
  // Round-tripping drops what this view does not own, so the canonical link is
  // the one the page shows in the address bar.
  assert.equal(historyFilterSearch(filters), "?owner=Kai");
});

test("an unknown enum value means no filter, not an empty history", () => {
  for (const search of ["?status=completed", "?status=", "?status=DROP+TABLE", "?type=deleted", "?type=all"]) {
    const filters = parseHistoryFilters(search);
    assert.doesNotThrow(() => selectHistory(records, filters));
    assert.equal(selectHistory(records, filters).length, records.length, `${search} emptied the history`);
  }
  assert.equal(parseHistoryFilters("?status=completed").status, "all");
  assert.equal(parseHistoryFilters("?type=deleted").type, "all");
});

test("an unparseable or impossible date is dropped, and the rest of the link stands", () => {
  assert.equal(normalizeFilterDate("2026-02-31"), "", "a day that does not exist is not a bound");
  assert.equal(normalizeFilterDate("last tuesday"), "");
  assert.equal(normalizeFilterDate("2026-6-30"), "", "one canonical encoding, not several");
  assert.equal(normalizeFilterDate("2026-06-30T00:00:00.000Z"), "");
  assert.equal(normalizeFilterDate(null), "");

  const filters = parseHistoryFilters("?owner=Kai&from=2026-13-45&to=nonsense");
  assert.equal(filters.from, "");
  assert.equal(filters.to, "");
  assert.equal(filters.owner, "Kai", "one bad date must not take the owner filter with it");
  assert.deepEqual(ids(filters), ["r-1-3-0", "queue"]);
});

test("an end before the start is repaired, not rendered as an empty window", () => {
  assert.deepEqual(normalizeHistoryRange("2026-06-30", "2026-04-01"), { from: "2026-06-30", to: "" });
  const filters = parseHistoryFilters("?from=2026-06-30&to=2026-04-01");
  assert.equal(filters.to, "");
  assert.deepEqual(ids(filters), ["flags"]);
  // And the same repair applies to a caller that hands the selector the
  // inverted range directly, so the two paths cannot disagree.
  assert.deepEqual(ids({ from: "2026-06-30", to: "2026-04-01" }), ["flags"]);
});

test("a repeated or array-shaped parameter takes its first value and never throws", () => {
  assert.doesNotThrow(() => parseHistoryFilters("?owner=Kai&owner=Mina&type[]=decision&q=a&q=b"));
  const filters = parseHistoryFilters("?owner=Kai&owner=Mina&type[]=decision&q=a&q=b");
  assert.equal(filters.owner, "Kai");
  assert.equal(filters.query, "a");
  assert.equal(filters.type, "all", "type[] is not the parameter this view owns");
});

test("nothing about a hostile or absent query string throws", () => {
  for (const search of ["", "?", "???", "?%", "?q=%E0%A4%A", "?q=<script>alert(1)</script>", undefined, null, 7, {}]) {
    assert.doesNotThrow(() => parseHistoryFilters(search), `parsing ${String(search)} threw`);
    assert.doesNotThrow(() => selectHistory(records, parseHistoryFilters(search)));
  }
  assert.deepEqual(parseHistoryFilters(undefined), { ...DEFAULT_HISTORY_FILTERS });
});

/* --------------------------------- the words ---------------------------------- */

test("the summary line states the match count out of the unfiltered total", () => {
  assert.equal(
    historySummaryLine(7, 41, { type: "decision", from: "2026-04-01", to: "2026-06-30" }),
    "7 of 41 records · decisions · Apr 1 – Jun 30",
  );
  assert.equal(historySummaryLine(3, 41, { type: "release" }), "3 of 41 records · releases");
  assert.equal(historySummaryLine(1, 41, { owner: "Kai" }), "1 of 41 records");
  assert.equal(historySummaryLine(41, 41, {}), "41 records", "an unfiltered view claims no window");
  assert.equal(historySummaryLine(1, 1, {}), "1 record");
  assert.equal(historySummaryLine(0, 41, { query: "nothing" }), "0 of 41 records");
  // Open-ended windows read as sentences, and a window crossing a year states
  // both years rather than two ambiguous month-and-day pairs.
  assert.equal(historySummaryLine(2, 41, { from: "2026-04-01" }), "2 of 41 records · from Apr 1, 2026");
  assert.equal(historySummaryLine(2, 41, { to: "2026-06-30" }), "2 of 41 records · through Jun 30, 2026");
  assert.equal(
    historySummaryLine(2, 41, { from: "2025-11-01", to: "2026-02-01" }),
    "2 of 41 records · Nov 1, 2025 – Feb 1, 2026",
  );
});

test("every active filter becomes a chip whose remove control names it", () => {
  assert.deepEqual(historyFilterChips({}), []);
  const chips = historyFilterChips(FILTERED);
  assert.deepEqual(chips.map((chip) => chip.key), ["query", "type", "status", "owner", "from", "to", "currentOnly"]);
  assert.deepEqual(chips.map((chip) => chip.text), [
    "Search: queue",
    "Record type: Decisions",
    "Status: accepted",
    "Owner: Kai",
    "From: Apr 1, 2026",
    "To: Jun 30, 2026",
    "Current only",
  ]);
  // Not a row of buttons all called "Remove": each one says what it drops.
  assert.deepEqual(chips.map((chip) => chip.remove).slice(0, 4), [
    "Remove search filter: queue",
    "Remove record type filter: Decisions",
    "Remove status filter: accepted",
    "Remove owner filter: Kai",
  ]);
});

/* --------------------------------- rendering ---------------------------------- */

test("the summary and the chips render the query as text, never as markup", () => {
  const hostile = '<img src=x onerror="alert(1)">';
  const summary = createElement("p");
  renderHistorySummary(summary, { visible: 0, total: 4, filters: { query: hostile } });
  assert.equal(summary.textContent, "0 of 4 records");
  assert.equal(summary.dataset.filtered, "true");

  const list = createElement("ul");
  renderHistoryFilterChips(list, { query: hostile });
  const chip = first(list, "filter-chip");
  // The whole string is one text node's content — the ordinary escaping path —
  // and no element was created from it.
  assert.equal(first(list, "filter-chip-text").textContent, `Search: ${hostile}`);
  assert.equal(chip.getAttribute("aria-label"), `Remove search filter: ${hostile}`);
  assert.equal(list.querySelectorAll("IMG").length, 0);
});

test("the chip list disappears when nothing is filtered, and each chip removes one filter", () => {
  const list = createElement("ul");
  const removed = [];
  const buttons = renderHistoryFilterChips(list, { owner: "Kai", type: "release" }, {
    onRemove: (key) => removed.push(key),
  });
  assert.equal(list.hidden, false);
  assert.equal(buttons.length, 2);
  assert.deepEqual(buttons.map((button) => button.dataset.filter), ["type", "owner"]);
  assert.equal(buttons[0].type, "button", "a chip is a button, not a link to nowhere");
  assert.equal(byClass(list, "filter-chip-dismiss")[0].getAttribute("aria-hidden"), "true");

  buttons[1].dispatch("click");
  assert.deepEqual(removed, ["owner"], "a chip removes its own filter and no other");

  renderHistoryFilterChips(list, {});
  assert.equal(list.hidden, true);
  assert.equal(byClass(list, "filter-chip").length, 0);
});

/* --------------------------------- the clipboard ------------------------------ */

test("copying the link confirms, and every clipboard failure says so instead of throwing", async () => {
  const written = [];
  const working = { writeText: async (value) => { written.push(value); } };
  assert.deepEqual(
    await copyHistoryLink("https://labs.wawalu.org/?owner=Kai", { clipboard: working }),
    { copied: true, message: COPY_LINK_SUCCESS },
  );
  assert.deepEqual(written, ["https://labs.wawalu.org/?owner=Kai"]);

  const refused = { writeText: async () => { throw new Error("denied"); } };
  assert.deepEqual(await copyHistoryLink("/", { clipboard: refused }), { copied: false, message: COPY_LINK_FAILURE });
  // No clipboard API at all (an insecure origin, an older engine) is the same
  // recovery, and still a message rather than a silent no-op.
  assert.deepEqual(await copyHistoryLink("/", { clipboard: {} }), { copied: false, message: COPY_LINK_FAILURE });
  assert.deepEqual(await copyHistoryLink("/", { clipboard: null }), { copied: false, message: COPY_LINK_FAILURE });
  assert.match(COPY_LINK_FAILURE, /address bar/, "the failure has to leave the visitor a way through");
});
