// What a first-time visitor arriving from Decisions meets, in the order they
// meet it.
//
// They clicked a decision, so the page owes them the decision: the record, then
// what was recorded about how it turned out. The export tool is a thing most of
// them will never have — a JSON file they would have had to build on the AI
// FinOps page first — and it used to stand between the back link and the answer,
// three paragraphs and a file input deep. It is second now, and closed.
//
// These run against the shipped markup and the shipped page modules, on the
// keyboard, because DOM order, the collapsed default, and which slot a failure
// lands in are exactly the things that regress without anything looking wrong.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { initDecisionDetail } from "../src/decision-page.js";
import { initDecisionOutcome } from "../src/decision-outcome-page.js";
import { loadPage, pressEnter, pressSpace, pressTab, tabSequence, textOf } from "./support/browser.js";

const DECISION_PAGE = new URL("../src/decision.html", import.meta.url);

const RECORD = {
  id: "decision-record-first",
  title: "Route summarisation to the cheaper model",
  status: "accepted",
  owner: "Mina",
  context: "The cheap model answers the summarisation prompt as well as the expensive one.",
  alternatives: "",
  createdAt: "2026-07-01T00:00:00.000Z",
};

const LINKED_RELEASE = {
  id: "release-record-first",
  version: "v2.1.0",
  title: "Cheaper summarisation",
  status: "completed",
  createdAt: "2026-07-14T00:00:00.000Z",
  decisionIds: [RECORD.id],
};

const emptyLog = () => ({
  decisions: [],
  releases: [],
  publicDecisionIds: new Set(),
  exampleDecisionIds: new Set(),
});

const goodLog = () => ({ ...emptyLog(), decisions: [RECORD], releases: [LINKED_RELEASE] });

async function decisionPage(t, { loadData = goodLog, boot = true } = {}) {
  const page = await loadPage(DECISION_PAGE, { storage: {}, location: { search: `?id=${RECORD.id}` } });
  t.after(() => page.restore());
  if (boot) await initDecisionDetail({ loadData, detailSeeds: [] });
  const { document } = page;
  return {
    document,
    get record() { return document.querySelector("#decision-detail"); },
    get outcome() { return document.querySelector("#decision-outcome"); },
    get disclosure() { return document.querySelector("#dout-export"); },
    get summary() { return document.querySelector(".dout-export-summary"); },
    get file() { return document.querySelector("#dout-file"); },
    get back() { return document.querySelector(".detail-back"); },
    get retry() { return document.querySelector(".detail-retry"); },
    get skeleton() { return document.querySelector(".detail-skeleton"); },
  };
}

// Document position, computed from the tree rather than from a string, so a
// stylesheet cannot make this pass while the reading order says otherwise.
function documentOrder(root) {
  const order = [];
  const visit = (node) => {
    for (const child of node.childElements) { order.push(child); visit(child); }
  };
  visit(root);
  return order;
}

const positionOf = (order, node) => {
  const index = order.indexOf(node);
  assert.notEqual(index, -1, "node is not in the document");
  return index;
};

/* ------------------------- the record is the page -------------------------- */

test("the record and its recorded outcome come before the export, in source order", async (t) => {
  const page = await decisionPage(t);
  const order = documentOrder(page.document.querySelector("main"));

  assert.ok(positionOf(order, page.back) < positionOf(order, page.record.querySelector(".decision-detail")),
    "the way back is still the first thing after the panel opens");
  assert.ok(positionOf(order, page.record) < positionOf(order, page.outcome),
    "the recorded decision comes before what was recorded about its outcome");
  assert.ok(positionOf(order, page.outcome) < positionOf(order, page.disclosure),
    "the export tool is last: it is optional, and most visitors do not have one");

  // The record's own words — context, alternatives, owner, status — are read
  // before the export is even named.
  const rendered = textOf(page.document.querySelector("main"));
  assert.ok(rendered.indexOf("Context and rationale") < rendered.indexOf("Open a later month"));
  assert.ok(rendered.indexOf("Alternatives considered") < rendered.indexOf("Open a later month"));
  assert.ok(rendered.indexOf("Owner") < rendered.indexOf("Open a later month"));
});

test("visual order is source order: nothing is reshuffled by the stylesheet", async () => {
  const [html, css] = await Promise.all([
    readFile(DECISION_PAGE, "utf8"),
    readFile(new URL("../src/decision-outcome.css", import.meta.url), "utf8"),
  ]);

  assert.ok(html.indexOf('id="decision-detail"') < html.indexOf('id="decision-outcome"'));
  assert.ok(html.indexOf('id="decision-outcome"') < html.indexOf('id="dout-export"'));
  // The move was made in the markup. A CSS `order` or an absolute position here
  // would put a sighted reader and a keyboard reader on two different pages.
  assert.doesNotMatch(css, /(^|[\s;{])order\s*:/);
  assert.doesNotMatch(css, /position\s*:\s*absolute/);
});

/* --------------------------- closed on arrival ----------------------------- */

test("the export explainer is a disclosure, closed on first render", async (t) => {
  const page = await decisionPage(t);

  assert.equal(page.disclosure.tagName, "DETAILS");
  assert.equal(page.disclosure.hasAttribute("open"), false, "closed by default");
  assert.equal(page.summary.tagName, "SUMMARY");
  assert.equal(page.summary.parentNode, page.disclosure);

  // One line, naming what opening it would add.
  const summary = textOf(page.summary);
  assert.match(summary, /Open a later month’s decision export/);
  assert.match(summary, /what the month actually cost/);
  assert.equal(summary.includes("\n"), false);

  // Everything the export needs is inside it, including the empty state, which
  // describes the export and not the record.
  for (const inside of ["#dout-file", "#dout-file-intro", "#dout-file-note", "#dout-file-status"]) {
    assert.ok(page.disclosure.querySelector(inside), `${inside} belongs to the export`);
  }
  assert.match(textOf(page.disclosure.querySelector("#dout-file-status")), /No decision export opened yet/);
  assert.match(textOf(page.disclosure), /no upload, no credentials, no network transfer/);
});

/* ------------------------- a failure keeps the slot ------------------------ */

test("a failed read fills the record's own slot and leaves the export closed", async (t) => {
  const page = await decisionPage(t, { loadData: () => { throw new Error("decision log unreadable"); } });

  const panel = page.record.querySelector(".detail-state");
  assert.equal(panel.dataset.state, "error");
  assert.equal(panel.getAttribute("role"), "alert");
  assert.ok(page.retry, "a read that failed can be tried again");
  assert.equal(page.record.querySelector(".detail-skeleton"), null, "the skeleton gave its slot to the failure");

  // Same slot: the failure is inside the record's container, above the outcome
  // and above the export, exactly where the skeleton was.
  const order = documentOrder(page.document.querySelector("main"));
  assert.equal(panel.parentNode, page.record);
  assert.ok(positionOf(order, panel) < positionOf(order, page.outcome));
  assert.ok(positionOf(order, panel) < positionOf(order, page.disclosure));

  // A record that would not load is not a reason to open a tool the visitor
  // cannot use yet.
  assert.equal(page.disclosure.hasAttribute("open"), false);
});

test("Retry re-runs the same read and puts the skeleton back while it is in flight", async (t) => {
  // Each entry records what the record's slot held at the moment the read ran.
  // The read is synchronous, so that instant is the whole of "in flight", and it
  // is the only place this can be observed at all.
  const duringRead = [];
  const page = await decisionPage(t, { boot: false });
  const loadData = () => {
    duringRead.push(Boolean(page.record.querySelector(".detail-skeleton")));
    if (duringRead.length === 1) throw new Error("decision log unreadable");
    return goodLog();
  };

  await initDecisionDetail({ loadData, detailSeeds: [] });

  assert.deepEqual(duringRead, [true], "the first read runs with the skeleton in the record's slot");
  assert.ok(page.retry, "the failed read offers a retry");

  page.retry.click();

  assert.deepEqual(duringRead, [true, true],
    "Retry ran the same read again, and the slot went back to the skeleton to do it");
  assert.equal(page.record.querySelector(".detail-state"), null, "the second read resolved");
  assert.equal(page.record.querySelector(".detail-skeleton"), null, "and the skeleton stood down again");
  assert.match(textOf(page.record), /Route summarisation to the cheaper model/);
  assert.equal(page.disclosure.hasAttribute("open"), false, "recovering the record did not open the export");
});

/* ------------------------------- the keyboard ------------------------------ */

test("tabbing forward from the back link meets the record, then the disclosure, then the file", async (t) => {
  const page = await decisionPage(t);
  initDecisionOutcome({ loadData: goodLog, detailSeeds: [] });
  const { document } = page;

  const recordLink = page.record.querySelector(".linked-release-link");
  assert.ok(recordLink, "this record has an interactive element of its own");

  const closed = tabSequence(document);
  assert.ok(closed.indexOf(page.back) < closed.indexOf(recordLink),
    "the way back comes before the record it leads away from");
  assert.ok(closed.indexOf(recordLink) < closed.indexOf(page.summary),
    "the record's own links come before the optional tool");
  assert.ok(closed.includes(page.summary), "the disclosure summary is reachable by keyboard");
  // The file input is inside the disclosure, so in a browser it is out of the
  // sequence entirely while the disclosure is closed. This harness does not
  // model that containment (see tests/support/browser.js), so what is asserted
  // here is the part it can honestly answer: the input is a descendant of the
  // disclosure, and it never precedes the summary that reveals it.
  assert.equal(page.file.closest("details"), page.disclosure);
  assert.ok(closed.indexOf(page.summary) < closed.indexOf(page.file));

  // Walked, not indexed: tab forward from the back link and see where it lands.
  page.back.focus();
  for (let guard = 0; guard < 40 && document.activeElement !== page.summary; guard += 1) pressTab(document);
  assert.equal(document.activeElement, page.summary, "tabbing forward reaches the summary");

  // Enter opens it, and leaves the reader exactly where they were standing.
  pressEnter(document);
  assert.equal(page.disclosure.hasAttribute("open"), true);
  assert.equal(document.activeElement, page.summary, "opening a disclosure must not move focus");

  const open = tabSequence(document);
  assert.ok(open.indexOf(page.summary) < open.indexOf(page.file), "the file input follows the summary");
  assert.equal(pressTab(document), page.file, "one tab forward from the summary reaches the file input");
  assert.equal(pressTab(document, { shift: true }), page.summary, "and one tab back returns to it: no trap");

  // Space closes it again, from the same key position.
  pressSpace(document);
  assert.equal(page.disclosure.hasAttribute("open"), false);
  assert.equal(document.activeElement, page.summary);
});
