// The overdue-decision finding on the history view (issue #622).
//
// Three layers, matching how the feature is split:
//   * the pure selection — which single decision is the finding and why — is
//     asserted directly against composed history records;
//   * the rendered panel is checked through the element stub;
//   * the parts a keyboard user feels are driven through the shipped markup in
//     src/index.html: the panel above the filters, the Tab order, and Enter on
//     the action opening the decision detail with the record's id.
//
// Determinism: no network, no sleeps, and no wall clock — every reference
// instant is passed in, so a test that passes today passes in a year. Fixtures
// are built here; nothing is inherited from the shipped example records unless a
// test asks for them.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initDecisionLog, toHistoryRecords } from "../src/app.js";
import {
  OVERDUE_ACTION_LABEL,
  OVERDUE_FINDING_KINDS,
  REVIEW_WINDOW_DAYS,
  UNTITLED_DECISION,
  decisionReviewAge,
  overdueDecisionFinding,
  selectOverdueDecision,
} from "../src/overdue-decision.js";
import { renderOverdueFinding } from "../src/overdue-decision-view.js";
import { byClass, first, installDocument } from "./support/dom.js";
import { loadPage, pressEnter, pressTab, tabSequence, textOf, typeText } from "./support/browser.js";

const DECISIONS_PAGE = new URL("../src/index.html", import.meta.url);
const STYLESHEET = new URL("../src/styles.css", import.meta.url);
const NO_DEMO_DATA = { decisions: [], releases: [] };

// One fixed "now". Every fixture below is dated relative to it in comments so
// the day counts in the assertions can be read without arithmetic.
const NOW = "2026-07-01T12:00:00.000Z";

const decision = (overrides) => ({
  id: "d-base",
  title: "A decision",
  context: "Why it was needed.",
  alternatives: "None considered.",
  owner: "Priya",
  status: "pending",
  createdAt: "2026-06-01T09:00:00.000Z",
  ...overrides,
});

// Composed the way the page composes its stream, so the finding is derived from
// the same records the list renders rather than from a second shape.
const records = (decisions, options = {}) =>
  toHistoryRecords(decisions, options.releases ?? [], { exampleIds: options.exampleIds ?? [] });

const findingFor = (decisions, options = {}) =>
  overdueDecisionFinding(records(decisions, options), { now: NOW, ...options });

// --- which decision is the finding -----------------------------------------

test("the open decision furthest past its review point is the finding, with its age, owner, and status", () => {
  const finding = findingFor([
    // 30 days open, 16 past a 14-day review point.
    decision({ id: "d-flags", title: "Introduce feature flags", owner: "Ari", status: "proposed", createdAt: "2026-06-01T09:00:00.000Z" }),
    // 20 days open, 6 past.
    decision({ id: "d-cache", title: "Cache the read path", owner: "Kai", status: "pending", createdAt: "2026-06-11T09:00:00.000Z" }),
  ]);

  assert.equal(finding.kind, OVERDUE_FINDING_KINDS.overdue);
  assert.equal(finding.decisionId, "d-flags");
  assert.equal(finding.overdueCount, 2);
  assert.equal(finding.windowDays, REVIEW_WINDOW_DAYS);

  // The material age benchmark: how long it has been open, against what, and
  // how far past it is. Every number a reader can count.
  assert.equal(finding.age.daysOpen, 30);
  assert.equal(finding.age.daysPast, 16);
  assert.equal(finding.age.source, "window");
  assert.match(finding.lead, /“Introduce feature flags” is 16 days past review\./);
  assert.match(finding.benchmark, /Open for 30 days as Proposed, against a 14-day review point — 16 days past it\./);

  // Owner and status travel with it, in the same order and words the list rows
  // and the detail page use.
  assert.deepEqual(finding.meta.map(({ label, value }) => [label, value]), [
    ["Status", "proposed"],
    ["Owner", "Ari"],
    ["Recorded", "2026-06-01T09:00:00.000Z"],
  ]);
  assert.equal(finding.meta[0].badge, "badge badge-proposed");

  // Why this one, stated rather than implied.
  assert.match(finding.priority, /Chosen from 2 open decisions past the review point/);
});

test("the most overdue decision wins regardless of provenance", () => {
  const finding = findingFor([
    decision({ id: "own", title: "Mine", createdAt: "2026-06-10T09:00:00.000Z" }),
    decision({ id: "demo", title: "Example", createdAt: "2026-01-01T09:00:00.000Z" }),
  ], { exampleIds: ["demo"] });

  assert.equal(finding.decisionId, "demo");
  assert.equal(finding.example, true);
  assert.match(finding.priority, /one furthest past it/);
});

test("an example finding is disclosed", () => {
  const finding = findingFor([
    decision({ id: "demo-a", createdAt: "2026-01-01T09:00:00.000Z" }),
    decision({ id: "demo-b", createdAt: "2026-02-01T09:00:00.000Z" }),
  ], { exampleIds: ["demo-a", "demo-b"] });

  assert.equal(finding.decisionId, "demo-a");
  assert.equal(finding.example, true);
  assert.match(finding.priority, /comes from the example records/);
});

test("ties break by Pending over Proposed, then oldest, then id — never by input order", () => {
  const sameDay = "2026-06-01T09:00:00.000Z";
  const forward = [
    decision({ id: "b-proposed", status: "proposed", createdAt: sameDay }),
    decision({ id: "a-pending", status: "pending", createdAt: sameDay }),
  ];
  assert.equal(findingFor(forward).decisionId, "a-pending", "Pending is the one somebody is waiting on");
  assert.equal(findingFor([...forward].reverse()).decisionId, "a-pending");

  // Same status and same age: the lower id wins, in either input order.
  const twins = [
    decision({ id: "z-twin", createdAt: sameDay }),
    decision({ id: "a-twin", createdAt: sameDay }),
  ];
  assert.equal(findingFor(twins).decisionId, "a-twin");
  assert.equal(findingFor([...twins].reverse()).decisionId, "a-twin");
});

test("settled and replaced decisions are never the finding", () => {
  const settled = [
    decision({ id: "d-accepted", status: "accepted", createdAt: "2026-01-01T09:00:00.000Z" }),
    decision({ id: "d-approved", status: "approved", createdAt: "2026-01-01T09:00:00.000Z" }),
    decision({ id: "d-superseded", status: "superseded", createdAt: "2026-01-01T09:00:00.000Z" }),
  ];
  assert.equal(selectOverdueDecision(records(settled), { now: NOW }), null);
  assert.equal(findingFor(settled).kind, OVERDUE_FINDING_KINDS.noneOpen);

  // Still Pending, but another decision names it under Replaces: the log
  // already treats it as not-current, so it is not chased for a review.
  const replaced = [
    decision({ id: "d-old", createdAt: "2026-01-01T09:00:00.000Z" }),
    decision({ id: "d-new", status: "accepted", createdAt: "2026-06-20T09:00:00.000Z", supersedes: "d-old" }),
  ];
  const finding = findingFor(replaced);
  assert.equal(finding.kind, OVERDUE_FINDING_KINDS.noneOpen);
  assert.equal(finding.openCount, 0);
});

// --- no overdue decision ----------------------------------------------------

test("an open decision inside its review point produces a calm no-overdue state", () => {
  // 6 days open against a 14-day review point.
  const finding = findingFor([decision({ createdAt: "2026-06-25T09:00:00.000Z" })]);

  assert.equal(finding.kind, OVERDUE_FINDING_KINDS.noneOverdue);
  assert.equal(finding.action, null, "there is nothing to chase, so there is no action");
  assert.equal(finding.decisionId, null);
  assert.equal(finding.lead, "No decision is past its review point.");
  assert.match(finding.benchmark, /1 open decision — Proposed or Pending — is inside the 14-day review point\./);
  assert.doesNotMatch(`${finding.heading} ${finding.lead} ${finding.benchmark}`,
    /\b(urgent|overdue|late|immediately|action required|attention)\b/i);
});

test("a log with nothing open, and an empty log, both say what would change the answer", () => {
  for (const finding of [
    findingFor([decision({ status: "accepted" })]),
    findingFor([]),
  ]) {
    assert.equal(finding.kind, OVERDUE_FINDING_KINDS.noneOpen);
    assert.equal(finding.action, null);
    assert.equal(finding.lead, "No decision is past its review point.");
    assert.match(finding.benchmark, /Nothing in this log is Proposed or Pending/);
    assert.match(finding.benchmark, /starts a 14-day review point/);
  }
});

// --- incomplete and unusual metadata ---------------------------------------

test("a recorded review date is used when the record carries one, and ignored when it is unreadable", () => {
  // Recorded 5 days ago — inside the window — but its recorded review date was
  // 3 days ago, so the recorded date is what decides.
  const recorded = findingFor([decision({ id: "d-review", createdAt: "2026-06-26T12:00:00.000Z", reviewBy: "2026-06-28T12:00:00.000Z" })]);
  assert.equal(recorded.kind, OVERDUE_FINDING_KINDS.overdue);
  assert.equal(recorded.age.source, "recorded");
  assert.equal(recorded.age.daysPast, 3);
  assert.match(recorded.benchmark, /Its recorded review date passed 3 days ago\./);

  // Unreadable, blank, and non-string values are not review dates: the window
  // rule decides instead, and the same record is inside it.
  for (const reviewBy of ["not-a-date", "", "   ", 20260628, null]) {
    const finding = findingFor([decision({ createdAt: "2026-06-26T12:00:00.000Z", reviewBy })]);
    assert.equal(finding.kind, OVERDUE_FINDING_KINDS.noneOverdue, `reviewBy ${JSON.stringify(reviewBy)}`);
  }
});

test("an open decision with no readable recorded date is never called late, and is reported", () => {
  assert.equal(decisionReviewAge(decision({ createdAt: "whenever" }), { now: NOW }), null);
  assert.equal(decisionReviewAge(decision(), { now: "not-a-time" }), null);

  // toHistoryRecords accepts what it is given, so an undated open record can
  // reach the finding even though loadDecisions would have refused it.
  const finding = overdueDecisionFinding(
    [{ type: "decision", id: "d-undated", status: "pending", superseded: false, decision: decision({ createdAt: "whenever" }) }],
    { now: NOW },
  );
  assert.equal(finding.kind, OVERDUE_FINDING_KINDS.noneOverdue);
  assert.equal(finding.undatedCount, 1);
  assert.match(finding.benchmark, /1 open decision carries no readable recorded date/);
});

test("a blank owner and a blank title still produce an openable finding", () => {
  const finding = findingFor([decision({ id: "d-bare", title: "   ", owner: "", createdAt: "2026-01-01T09:00:00.000Z" })]);

  assert.equal(finding.kind, OVERDUE_FINDING_KINDS.overdue);
  assert.equal(finding.meta[1].value, "Unassigned", "the same word the release view uses");
  assert.match(finding.lead, new RegExp(`“${UNTITLED_DECISION}”`));
  assert.equal(finding.action.href, "/decision.html?id=d-bare");
  assert.equal(finding.action.name, `${OVERDUE_ACTION_LABEL}: ${UNTITLED_DECISION}`);
});

test("a caller may state a different review point, and it is named in the copy", () => {
  const finding = findingFor([decision({ createdAt: "2026-06-25T09:00:00.000Z" })], { reviewWindowDays: 3 });
  assert.equal(finding.kind, OVERDUE_FINDING_KINDS.overdue);
  assert.equal(finding.windowDays, 3);
  assert.match(finding.benchmark, /against a 3-day review point/);

  // A nonsensical window falls back to the shipped one rather than dividing by
  // it: the panel always states a number a reader can act on.
  assert.equal(findingFor([decision()], { reviewWindowDays: 0 }).windowDays, REVIEW_WINDOW_DAYS);
});

// --- the rendered panel -----------------------------------------------------

test("the overdue panel is a labelled region whose action names the decision and where it goes", () => {
  installDocument();
  const container = document.createElement("div");
  const finding = findingFor([decision({ id: "d-flags", title: "Introduce feature flags", owner: "Ari" })]);

  const panel = renderOverdueFinding(container, finding);

  assert.equal(container.getAttribute("aria-busy"), "false");
  assert.equal(container.hidden, false);
  assert.equal(panel.tagName, "SECTION");
  const heading = first(panel, "overdue-finding-title");
  assert.equal(panel.getAttribute("aria-labelledby"), heading.id, "the region is named by its own heading");
  assert.equal(heading.textContent, "Past its review point");

  // Status, owner, and the recorded date, the last as a machine-readable time.
  const values = byClass(panel, "meta-value").map((node) => node.textContent);
  assert.ok(values.includes("proposed") || values.includes("pending"));
  assert.ok(values.includes("Ari"));
  const time = byClass(panel, "meta-value").find((node) => node.tagName === "TIME");
  assert.equal(time.dateTime, "2026-06-01T09:00:00.000Z");

  // One action: a real link, keyboard-operable by construction, with an
  // unambiguous accessible name and a description of what it opens.
  const action = first(panel, "overdue-finding-action");
  assert.equal(action.tagName, "A");
  assert.equal(action.href, "/decision.html?id=d-flags");
  assert.equal(action.getAttribute("aria-label"), `${OVERDUE_ACTION_LABEL}: Introduce feature flags`);
  const target = first(panel, "overdue-finding-target");
  assert.equal(action.getAttribute("aria-describedby"), target.id);
  assert.match(target.textContent, /Opens the full record for “Introduce feature flags”/);
  // The arrow is decoration, so it is not part of the name a reader hears.
  assert.equal(first(panel, "overdue-finding-arrow").getAttribute("aria-hidden"), "true");
});

test("the calm panel renders no action, and a finding drawn from an example says so", () => {
  installDocument();
  const calm = document.createElement("div");
  renderOverdueFinding(calm, findingFor([decision({ createdAt: "2026-06-25T09:00:00.000Z" })]));

  assert.equal(first(calm, "overdue-finding-action"), null, "nothing to chase, nothing to press");
  assert.match(textOf(calm), /No decision is past its review point/);
  assert.match(textOf(calm), /reads the whole log, not the filters below/);
  assert.ok(first(calm, "overdue-finding-none-overdue"), "the calm state is styled as its own state");

  const example = document.createElement("div");
  renderOverdueFinding(
    example,
    findingFor([decision({ id: "demo" })], { exampleIds: ["demo"] }),
    { exampleLabel: "Example record" },
  );
  assert.ok(first(example, "badge-example"), "an example-sourced finding carries the same badge as the rows");

  // A surface that cannot compute a finding shows nothing, not a stale one.
  renderOverdueFinding(example, null);
  assert.equal(example.hidden, true);
  assert.equal(example.children.length, 0);
});

// --- the shipped page -------------------------------------------------------

const openHistory = async (t, { decisions = [], now = NOW } = {}) => {
  const page = await loadPage(DECISIONS_PAGE, {
    storage: decisions.length > 0 ? { "shiplog.decisions.v1": JSON.stringify(decisions) } : {},
  });
  t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage, { seed: NO_DEMO_DATA, now, announceDelay: 0 });
  return page;
};

const findingPanel = (document) => document.querySelector("#overdue-decision");

test("the history view leads with the overdue decision, and Enter on its action opens that record", async (t) => {
  const page = await openHistory(t, {
    decisions: [
      decision({ id: "d-flags", title: "Introduce feature flags", owner: "Ari", status: "proposed", createdAt: "2026-06-01T09:00:00.000Z" }),
      decision({ id: "d-cache", title: "Cache the read path", owner: "Kai", createdAt: "2026-06-11T09:00:00.000Z" }),
    ],
  });
  const { document } = page;
  const panel = findingPanel(document);

  assert.equal(panel.getAttribute("aria-busy"), "false");
  assert.match(textOf(panel), /Past its review point/);
  assert.match(textOf(panel), /“Introduce feature flags” is 16 days past review/);
  assert.match(textOf(panel), /Ari/);
  assert.doesNotMatch(textOf(panel), /Checking the log/, "the static placeholder is replaced on the first paint");

  // It is read before the filters and the list it summarises.
  const html = textOf(document.querySelector(".list-panel"));
  assert.ok(html.indexOf("Past its review point") < html.indexOf("Search records"));

  // Keyboard: the action is a Tab stop, and Enter opens the decision detail
  // for that record — not the list, and not a generic recorder link.
  const action = panel.querySelector("a");
  assert.ok(tabSequence(document).includes(action), "the action is reachable by keyboard");
  for (let guard = 0; guard < 80 && document.activeElement !== action; guard += 1) pressTab(document);
  assert.equal(document.activeElement, action, "tabbing reaches the action");
  pressEnter(document);
  assert.deepEqual(page.navigations, ["/decision.html?id=d-flags"]);
});

test("filtering the history narrows the list without changing or breaking the finding", async (t) => {
  const page = await openHistory(t, {
    decisions: [
      decision({ id: "d-flags", title: "Introduce feature flags", owner: "Ari", status: "proposed", createdAt: "2026-06-01T09:00:00.000Z" }),
      decision({ id: "d-cache", title: "Cache the read path", owner: "Kai", createdAt: "2026-06-11T09:00:00.000Z" }),
    ],
  });
  const { document } = page;
  const before = textOf(findingPanel(document));

  const search = document.querySelector("#decision-search");
  search.focus();
  typeText(document, "cache");

  // The filter still works…
  const rows = document.querySelector("#decision-list").querySelectorAll(".history-card");
  assert.equal(rows.length, 1);
  assert.match(textOf(rows[0]), /Cache the read path/);
  assert.equal(textOf(document.querySelector("#decision-count")), "1 of 2 records");

  // …and the finding is unchanged: which decision is late is a property of the
  // log, not of the view, so a narrowed list cannot hide it or replace it.
  assert.equal(textOf(findingPanel(document)), before);
  assert.ok(tabSequence(document).includes(findingPanel(document).querySelector("a")));
});

test("a history with nothing past review shows the calm state on the shipped page", async (t) => {
  const page = await openHistory(t, {
    decisions: [decision({ id: "d-fresh", createdAt: "2026-06-25T09:00:00.000Z" })],
  });
  const panel = findingPanel(page.document);

  assert.match(textOf(panel), /Review check/);
  assert.match(textOf(panel), /No decision is past its review point/);
  assert.match(textOf(panel), /1 open decision — Proposed or Pending — is inside the 14-day review point/);
  assert.equal(panel.querySelector("a"), null, "a calm state offers nothing to press");
  assert.doesNotMatch(textOf(panel), /\b(urgent|late|immediately|action required)\b/i);

  // The rest of the history view is untouched.
  assert.equal(page.document.querySelector("#decision-list").querySelectorAll(".history-card").length, 1);
});

test("the empty log states what would start a review point, and the panel is still one region", async (t) => {
  const panel = findingPanel((await openHistory(t)).document);
  assert.match(textOf(panel), /Nothing in this log is Proposed or Pending/);
  assert.equal(panel.querySelectorAll("section").length, 1);
});

test("the action fills the measure once the panel is a single narrow column", async () => {
  const css = await readFile(STYLESHEET, "utf8");
  const narrow = css.split("\n").filter((line) => line.includes("max-width:520px") && line.includes(".overdue-finding-action"));
  assert.equal(narrow.length, 1, "the responsive rule for the action is missing");
  assert.match(narrow[0], /\.overdue-finding-action\{width:100%;justify-content:center\}/);
});
