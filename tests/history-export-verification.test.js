// A reader can prove, on the page, that the export describes what they are
// looking at.
//
// THE GUARANTEE THESE TESTS PROTECT. Every other export suite in this
// repository is something a reader has to take on trust: the file is compared
// against a fixture, or against the rendered DOM, by a test they will never
// run. This one covers the control that answers the same question in their own
// browser, against their own records, with no download and no network. Press
// it and one sentence says matched or not matched, how many records were
// compared, and which filter was in effect. When it says not matched it names
// the first record that differs and the field that differs on it, and the
// per-record list is one disclosure away.
//
// WHAT THIS FILE ADDS to the suites beside it.
// tests/history-count-export-agreement.test.js pins the arithmetic of a
// filtered download, and tests/browsed-history-export-parity.test.js compares
// the downloaded bytes against the rendered DOM. Both are offline proofs. This
// file drives the on-page control instead: it seeds a disagreement the two
// sides cannot notice on their own (storage rewritten under a rendered view,
// which is what a second tab does) and holds the control to naming it.
//
// The control calls the same buildShiplogExport() the Download JSON button
// calls. That is asserted rather than assumed, by giving the check a filtered
// scope and reading back an export that is narrower than the store: a check
// that re-derived its own payload could not follow the filters that way.
//
// Determinism: fixed ids, fixed past timestamps, no network (the harness throws
// on an undeclared request), no sleeps. Ids are prefixed `verify-` so they
// cannot collide with another suite's storage during a parallel `npm test`.
// Every id is alphabetic, which is what lets the assertions below count the
// numbers in a sentence.
//
// Harness rules this file follows:
//   * Assertions are on counts, attributes, and text. Never `assert.equal(node,
//     null)` — comparing a harness node to null walks the whole parsed page and
//     outlives the per-test timeout.
//   * No descendant selectors ("details #id" throws). Containment is walked
//     through parentNode.
//   * The harness models no layout, so textOf reads straight through a closed
//     disclosure. A live region nested in one would pass every assertion here
//     and be silent in a real browser, so its ancestry is asserted directly.
//   * A harness select accepts any value, including one a real control would
//     refuse. The owner option is proved present before the filtered result it
//     produces is believed.

import test from "node:test";
import assert from "node:assert/strict";
import { initDecisionLog, STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { initShiplogExport } from "../src/shiplog-export.js";
import { initHistoryExportCheck } from "../src/history-export-check.js";
import { DomEvent, loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";

const DECISIONS_PAGE = new URL("../src/index.html", import.meta.url);

// The example records are a module constant the page composes in, not a fetch,
// so a history holding nothing but these fixtures hands the page an empty seed.
const NO_DEMO_DATA = { decisions: [], releases: [] };

// --- the fixture -------------------------------------------------------------
//
// Small on purpose: four records is enough to have two owners, both record
// kinds, and a record that is in the file only because of a link. Built here
// rather than committed so the suite carries its own data.

const DECISIONS = [
  {
    id: "verify-d-cache",
    title: "Cache the release index",
    context: "The index was recomputed on every history render.",
    alternatives: "Recompute on write.",
    owner: "Ari",
    status: "accepted",
    createdAt: "2026-03-02T09:00:00.000Z",
  },
  {
    id: "verify-d-queue",
    title: "Queue the ingest",
    context: "Ingest ran inline and blocked the recorder.",
    alternatives: "",
    owner: "Priya",
    status: "proposed",
    createdAt: "2026-03-03T09:00:00.000Z",
  },
  {
    id: "verify-d-audit",
    title: "Keep an audit trail",
    context: "Nothing recorded who changed a release window.",
    alternatives: "",
    owner: "Ari",
    status: "accepted",
    createdAt: "2026-03-04T09:00:00.000Z",
  },
];

const RELEASES = [
  {
    id: "verify-r-cache",
    version: "v1.4.0",
    title: "Cache rollout",
    description: "Shipped the cached release index.",
    owner: "Priya",
    status: "completed",
    createdAt: "2026-03-05T09:00:00.000Z",
    decisionIds: ["verify-d-cache"],
  },
];

const TOTAL_RECORDS = DECISIONS.length + RELEASES.length;

const browser = (decisions = DECISIONS, releases = RELEASES) => ({
  [STORAGE_KEY]: JSON.stringify(decisions),
  [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
});

async function openHistory(t) {
  const page = await loadPage(DECISIONS_PAGE, { storage: browser() });
  t.after(() => page.restore());
  // The module scripts src/index.html loads, in page order.
  await initDecisionLog(page.document, page.storage, { seed: NO_DEMO_DATA });
  initShiplogExport(page.document, page.storage);
  initHistoryExportCheck(page.document, page.storage);
  // Wait on state, not on time: the page marks itself ready once it rendered.
  assert.equal(
    page.document.documentElement.dataset.shiplog,
    "ready",
    "the history never finished rendering",
  );
  assert.equal(
    rows(page).length,
    TOTAL_RECORDS,
    `the unfiltered history does not show the fixture's ${TOTAL_RECORDS} records`,
  );
  return page;
}

// --- reading the page ---------------------------------------------------------

const rows = (page) => page.document.querySelectorAll(".decision-card,.release-card");
const button = (page) => page.document.querySelector("#verify-shiplog");
const resultText = (page) => textOf(page.document.querySelector("#verify-shiplog-result"));
const differenceItems = (page) => page.document.querySelector("#verify-shiplog-differences")
  .querySelectorAll("li");

/**
 * Press the control the way a keyboard reader presses it, and read the answer.
 *
 * Enter on a focused button is the path under test: a control that only answers
 * a synthesized click is not reachable by the readers this check exists for.
 * The download count is read either side because the check must not write a
 * file — a control that quietly downloads one to compare it is not the control
 * this page advertises.
 */
function check(page) {
  const control = button(page);
  assert.ok(control, "the history has no export-check control");
  const downloadsBefore = page.downloads.length;
  control.focus();
  assert.equal(page.document.activeElement, control, "the export-check control cannot take focus");
  pressEnter(page.document);
  assert.equal(
    page.downloads.length,
    downloadsBefore,
    "checking the export wrote a file, which the control promises it does not do",
  );
  return resultText(page);
}

/** How many material numbers a sentence states. */
const numbersIn = (sentence) => sentence.match(/\d+/g) ?? [];

/** Nothing between `node` and the page root is a disclosure, open or closed. */
function assertNotInsideDisclosure(node, label) {
  let ancestor = node?.parentNode;
  let depth = 0;
  while (ancestor && ancestor.nodeType === 1 && depth < 50) {
    assert.notEqual(
      ancestor.tagName,
      "DETAILS",
      `${label} sits inside a disclosure, so a real browser can hide it while every text assertion still passes`,
    );
    ancestor = ancestor.parentNode;
    depth += 1;
  }
}

function chooseOption(page, selector, value) {
  const select = page.document.querySelector(selector);
  assert.ok(select, `the history has no ${selector} control`);
  // A harness select accepts any value; a real one refuses a value no option
  // carries. So the option is proved present before the result it produces is
  // treated as a filtered view rather than as a silently ignored assignment.
  assert.ok(
    [...select.options].some((option) => option.value === value),
    `${selector} offers no option with value ${JSON.stringify(value)}, so a real control would refuse it`,
  );
  assert.equal(select.disabled, false, `${selector} is disabled, so a reader cannot set it`);
  select.value = value;
  select.dispatchEvent(new DomEvent("change", { bubbles: true }));
  return select;
}

// --- the control itself --------------------------------------------------------

test("the check is a button a keyboard reader reaches in the ordinary tab order", async (t) => {
  const page = await openHistory(t);
  const control = button(page);
  assert.ok(control, "the history has no export-check control");
  assert.equal(control.tagName, "BUTTON", "the export check is not a real button element");
  assert.equal(control.getAttribute("type"), "button", "the export check can submit a form");
  assert.equal(control.getAttribute("tabindex"), null, "the export check declares its own tab position");
  assert.equal(control.disabled, false, "the export check is disabled on arrival");
  assert.ok(
    tabSequence(page.document).includes(control),
    "the export check is not in the page's tab order, so a keyboard reader cannot reach it",
  );
  assert.ok(textOf(control).length > 0, "the export check has no visible label");
});

test("the answer is announced outside every disclosure, and only the per-record detail is inside one", async (t) => {
  const page = await openHistory(t);
  const region = page.document.querySelector("#verify-shiplog-result");
  assert.ok(region, "the export check announces its answer nowhere");
  assert.equal(region.getAttribute("role"), "status", "the answer is not announced");
  assert.equal(region.getAttribute("aria-live"), "polite", "the answer is not a live region");
  // The failure this pins: the harness reads straight through a closed
  // disclosure, so a live region nested in one passes every text assertion in
  // this file and says nothing at all in a browser.
  assertNotInsideDisclosure(region, "the export check's answer");

  const list = page.document.querySelector("#verify-shiplog-differences");
  assert.ok(list, "the export check has nowhere to put the per-record detail");
  let ancestor = list.parentNode;
  let disclosures = 0;
  while (ancestor && ancestor.nodeType === 1) {
    if (ancestor.tagName === "DETAILS") disclosures += 1;
    ancestor = ancestor.parentNode;
  }
  assert.equal(disclosures, 1, "the per-record detail is not behind exactly one disclosure");
});

// --- the four answers ----------------------------------------------------------

test("a history that agrees with its export reports a match and the number of records compared", async (t) => {
  const page = await openHistory(t);
  const sentence = check(page);

  assert.match(sentence, /^Matched\b/, `the check did not report a match: ${JSON.stringify(sentence)}`);
  assert.deepEqual(
    numbersIn(sentence),
    [String(TOTAL_RECORDS)],
    `the answer states numbers other than the compared-record count: ${JSON.stringify(sentence)}`,
  );
  assert.match(
    sentence,
    /no filters/i,
    `an unfiltered check does not say the view is unfiltered: ${JSON.stringify(sentence)}`,
  );
  assert.equal(differenceItems(page).length, 0, "a matching check listed per-record differences");
});

test("an export holding a different number of records reports no match and names the missing record", async (t) => {
  const page = await openHistory(t);
  // What a second tab does: the store loses a record while this view keeps
  // showing it. The rendered history and the file it would write now disagree,
  // and nothing on either side can notice that alone.
  page.storage.setItem(
    STORAGE_KEY,
    JSON.stringify(DECISIONS.filter((decision) => decision.id !== "verify-d-queue")),
  );
  const sentence = check(page);

  assert.match(sentence, /^Not matched\b/, `the check reported a match: ${JSON.stringify(sentence)}`);
  assert.deepEqual(
    numbersIn(sentence),
    [String(TOTAL_RECORDS)],
    `the answer states numbers other than the compared-record count: ${JSON.stringify(sentence)}`,
  );
  assert.ok(
    sentence.includes("verify-d-queue"),
    `the answer does not name the record the export lost: ${JSON.stringify(sentence)}`,
  );
  const listed = differenceItems(page).map(textOf);
  assert.equal(listed.length, 1, `the disclosure lists ${listed.length} differences, not the one that exists`);
  assert.ok(
    listed[0].includes("verify-d-queue"),
    `the listed difference does not name the record: ${JSON.stringify(listed[0])}`,
  );
});

test("a record whose field drifted reports no match and names the record and the field", async (t) => {
  const page = await openHistory(t);
  // Same count, one field different: the case a count check cannot see.
  page.storage.setItem(
    STORAGE_KEY,
    JSON.stringify(DECISIONS.map((decision) => (decision.id === "verify-d-cache"
      ? { ...decision, owner: "Zoe" }
      : decision))),
  );
  const sentence = check(page);

  assert.match(sentence, /^Not matched\b/, `the check reported a match: ${JSON.stringify(sentence)}`);
  assert.deepEqual(
    numbersIn(sentence),
    [String(TOTAL_RECORDS)],
    `the answer states numbers other than the compared-record count: ${JSON.stringify(sentence)}`,
  );
  assert.ok(
    sentence.includes("verify-d-cache"),
    `the answer does not name the record that differs: ${JSON.stringify(sentence)}`,
  );
  assert.ok(
    sentence.includes("owner"),
    `the answer does not name the field that differs: ${JSON.stringify(sentence)}`,
  );
  const listed = differenceItems(page).map(textOf);
  assert.equal(listed.length, 1, `the disclosure lists ${listed.length} differences, not the one that exists`);
  assert.ok(
    listed[0].includes("Ari") && listed[0].includes("Zoe"),
    `the listed difference does not print both sides: ${JSON.stringify(listed[0])}`,
  );
});

// The state a first visit is in: the history shows example rows the file
// deliberately does not carry, because the examples are a module constant that
// is never stored. A check that counted them would open with "not matched" on a
// page nobody has done anything to yet.
test("an example row is not counted against the export, and a stored one beside it still is", async (t) => {
  const stored = [DECISIONS[0]];
  const page = await loadPage(DECISIONS_PAGE, { storage: browser(stored, []) });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage, {
    seed: { decisions: [{ ...DECISIONS[1], id: "verify-d-example" }], releases: [] },
  });
  initShiplogExport(page.document, page.storage);
  initHistoryExportCheck(page.document, page.storage);

  assert.equal(rows(page).length, 2, "the history does not show the stored record beside the example one");
  // Counted per row rather than across the page: other panels badge an example
  // too, and it is the badge on a history row that decides what is compared.
  assert.equal(
    rows(page).filter((card) => card.querySelectorAll(".badge-example").length > 0).length,
    1,
    "no history row is badged as an example, so this test is not measuring an example row",
  );

  const sentence = check(page);
  assert.match(sentence, /^Matched\b/, `the example row was counted against the file: ${JSON.stringify(sentence)}`);
  assert.deepEqual(
    numbersIn(sentence),
    [String(stored.length)],
    `the answer counts rows the file does not carry: ${JSON.stringify(sentence)}`,
  );
  assert.equal(differenceItems(page).length, 0, "the example row was reported as a difference");
});

test("a filtered history checks the filtered export and the answer names the filter", async (t) => {
  const page = await openHistory(t);
  chooseOption(page, "#filter-owner", "Priya");
  const filtered = rows(page).length;
  assert.ok(
    filtered > 0 && filtered < TOTAL_RECORDS,
    `filtering to one owner left ${filtered} of ${TOTAL_RECORDS} rows, so this test is not measuring a filtered view`,
  );

  const sentence = check(page);
  assert.match(sentence, /^Matched\b/, `the filtered check did not report a match: ${JSON.stringify(sentence)}`);
  // The compared count is the filtered view, not the store. A check that
  // re-derived its own payload, or that ignored the published scope, would
  // report the whole history here.
  assert.deepEqual(
    numbersIn(sentence),
    [String(filtered)],
    `the filtered answer does not count the filtered view alone: ${JSON.stringify(sentence)}`,
  );
  assert.ok(
    sentence.includes("Owner") && sentence.includes("Priya"),
    `the answer does not say which filter was in effect: ${JSON.stringify(sentence)}`,
  );
  assert.equal(differenceItems(page).length, 0, "a matching filtered check listed per-record differences");

  // And the filtered view still notices a difference: a filter must narrow the
  // comparison, not switch it off.
  page.storage.setItem(
    STORAGE_KEY,
    JSON.stringify(DECISIONS.map((decision) => (decision.id === "verify-d-queue"
      ? { ...decision, status: "superseded" }
      : decision))),
  );
  const second = check(page);
  assert.match(second, /^Not matched\b/, `the filtered check missed a drifted field: ${JSON.stringify(second)}`);
  assert.ok(
    second.includes("verify-d-queue") && second.includes("status"),
    `the filtered answer does not name the record and field that differ: ${JSON.stringify(second)}`,
  );
});
