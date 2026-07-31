// What a decision page offers a reader who did not get a decision.
//
// Three ways to arrive with nothing on screen — the read threw, the id is not in
// this browser, no id was named — and they are not the same fact. Only the first
// one can be answered by trying again, so only the first one is allowed to offer
// a Retry: a button that cannot change the outcome is a promise the page cannot
// keep, and a reader who presses it twice learns the page is lying rather than
// that the record is gone.
//
// These run against the shipped markup and the shipped page module, on the
// keyboard, because the ordering and the focus move are the parts that regress
// silently.

import assert from "node:assert/strict";
import test from "node:test";
import { renderDecisionDetailSkeleton } from "../src/decision-detail.js";
import { initDecisionDetail } from "../src/decision-page.js";
import { loadPage, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";

const DECISION_PAGE = new URL("../src/decision.html", import.meta.url);

const RECORD = {
  id: "decision-recovered",
  title: "Adopt a bounded retry",
  status: "accepted",
  owner: "Mina",
  context: "The first read can fail without the record being gone.",
  alternatives: "",
  createdAt: "2026-07-01T00:00:00.000Z",
};

const emptyLog = () => ({
  decisions: [],
  releases: [],
  publicDecisionIds: new Set(),
  exampleDecisionIds: new Set(),
});

// A read that throws on its first N attempts, exactly the way a corrupt or
// unreadable store does, and then answers. `attempts` is the proof that Retry
// re-ran the read rather than redrawing the last one.
function flakyLog(failures, decisions = [RECORD]) {
  const calls = { attempts: 0 };
  const loadData = () => {
    calls.attempts += 1;
    if (calls.attempts <= failures) throw new Error("decision log unreadable");
    return { ...emptyLog(), decisions };
  };
  return { calls, loadData };
}

async function decisionPage(t, { search, loadData }) {
  const page = await loadPage(DECISION_PAGE, { storage: {}, location: { search } });
  t.after(() => page.restore());
  await initDecisionDetail({ loadData, detailSeeds: [] });
  const { document } = page;
  const container = document.querySelector("#decision-detail");
  return {
    document,
    container,
    get panel() { return container.querySelector(".detail-state"); },
    get retry() { return container.querySelector(".detail-retry"); },
    get back() { return container.querySelector(".detail-back"); },
  };
}

test("a read that failed says so once, and offers a labelled retry after the reason", async (t) => {
  const { calls, loadData } = flakyLog(1);
  const page = await decisionPage(t, { search: "?id=decision-recovered", loadData });

  assert.equal(calls.attempts, 1);
  assert.equal(page.panel.dataset.state, "error");
  assert.equal(page.panel.dataset.recoverable, "true");
  assert.equal(page.panel.getAttribute("role"), "alert");
  assert.equal(page.document.title, "Decision unavailable · Shiplog");

  // One heading on the first screen, and it is the state.
  const headings = page.container.querySelectorAll("h1");
  assert.equal(headings.length, 1);
  assert.match(textOf(headings[0]), /Decision couldn’t be loaded/);
  assert.match(textOf(page.panel), /trying again is safe/);

  // Reading order: the way back, then the state, then the recovery it explains.
  const rendered = textOf(page.container);
  assert.ok(rendered.indexOf("Back to Decisions") < rendered.indexOf("Decision couldn’t be loaded"));
  assert.ok(rendered.indexOf("trying again is safe") < rendered.indexOf("Retry loading this decision"));
});

test("the keyboard meets the route back before the retry, and Enter re-runs the read", async (t) => {
  const { calls, loadData } = flakyLog(1);
  const page = await decisionPage(t, { search: "?id=decision-recovered", loadData });
  const { document } = page;

  const sequence = tabSequence(document);
  assert.ok(sequence.includes(page.back), "the route back is reachable by keyboard");
  assert.ok(sequence.includes(page.retry), "the retry is reachable by keyboard");
  assert.ok(sequence.indexOf(page.back) < sequence.indexOf(page.retry),
    "the labelled route back comes before the recovery, in reading order");

  const retry = page.retry;
  for (let guard = 0; guard < 40 && document.activeElement !== retry; guard += 1) pressTab(document);
  assert.equal(document.activeElement, retry, "tabbing reaches the retry control");

  pressEnter(document);

  assert.equal(calls.attempts, 2, "Enter on the retry ran the read again");
  assert.equal(page.panel, null, "the failure state is gone");
  assert.match(textOf(page.container), /Adopt a bounded retry/);
  assert.equal(document.title, "Adopt a bounded retry · Decisions · Shiplog");
  // The button the reader was standing on no longer exists, so focus was moved
  // onto the record they asked for rather than back to the top of the document.
  assert.equal(document.activeElement, document.querySelector(".decision-detail"));
});

test("a retry that fails again keeps the reader on the state that explains it", async (t) => {
  const { calls, loadData } = flakyLog(Number.POSITIVE_INFINITY);
  const page = await decisionPage(t, { search: "?id=decision-recovered", loadData });

  page.retry.click();

  assert.equal(calls.attempts, 2);
  assert.equal(page.panel.dataset.state, "error");
  assert.ok(page.retry, "the retry is still offered, because it can still succeed");
  assert.equal(page.document.activeElement, page.panel, "focus lands on the state, not the document top");
  assert.equal(page.panel.getAttribute("tabindex"), "-1", "the landing is script-only, not a new tab stop");
});

test("an id this browser does not have offers the route back and refuses to promise a retry", async (t) => {
  const page = await decisionPage(t, { search: "?id=not-a-real-decision", loadData: emptyLog });

  assert.equal(page.panel.dataset.state, "not-found");
  assert.equal(page.panel.dataset.recoverable, "false");
  assert.equal(page.panel.getAttribute("role"), "status");
  assert.equal(page.retry, null, "trying again cannot find a record that is not here");
  assert.equal(page.document.title, "Decision not found · Shiplog");

  assert.match(textOf(page.panel), /Trying again will not find it/);
  assert.equal(page.back.getAttribute("href"), "/");
  assert.match(textOf(page.back), /Back to Decisions/);
  assert.ok(tabSequence(page.document).includes(page.back));
});

test("arriving with no id names the route back as the way on, and offers nothing else", async (t) => {
  const page = await decisionPage(t, { search: "", loadData: emptyLog });

  assert.equal(page.panel.dataset.state, "empty");
  assert.equal(page.panel.dataset.recoverable, "false");
  assert.equal(page.retry, null);
  assert.match(textOf(page.panel), /No decision was specified/);
  assert.match(textOf(page.panel), /Back to Decisions/, "the state names the route it is pointing at");
  assert.equal(page.back.getAttribute("href"), "/");
});

test("the served first screen is a drawn skeleton in the record's slot, with a way back", async (t) => {
  const page = await loadPage(DECISION_PAGE, { storage: {}, location: { search: "?id=anything" } });
  t.after(() => page.restore());

  const container = page.document.querySelector("#decision-detail");
  const skeleton = container.querySelector(".detail-skeleton");
  assert.ok(skeleton, "the wait is drawn, not described");
  assert.equal(skeleton.dataset.state, "loading");
  assert.equal(skeleton.dataset.recoverable, "false", "nothing has failed yet, so nothing offers a retry");
  assert.equal(skeleton.getAttribute("aria-busy"), "true");
  assert.equal(page.document.querySelectorAll(".detail-retry").length, 0);
  assert.equal(container.querySelector(".detail-state"), null, "no prose state stands in for the record");

  // The reassurance that used to be the first words on the page is gone. A
  // visitor arriving from Decisions came to read a decision, not a paragraph
  // about a failure that has not happened.
  const rendered = textOf(container);
  assert.doesNotMatch(rendered, /No action is needed/i);
  assert.doesNotMatch(rendered, /Loading this decision/i);

  // One thing is said out loud, politely, and it names the region. It is also
  // the page's one heading until the record's own arrives, so a screen-reader
  // user can still navigate by headings while the shapes are on screen.
  const status = skeleton.querySelector("[role=status]");
  assert.equal(textOf(status), "Loading decision record");
  assert.ok(status.classList.contains("visually-hidden"));
  const headings = container.querySelectorAll("h1");
  assert.equal(headings.length, 1, "one heading, offscreen, and no second thing to read");
  assert.equal(headings[0].parentNode, status);

  // The shapes themselves announce nothing: a screen reader hears the line
  // above, not a list of empty boxes.
  const shapes = skeleton.querySelector(".decision-detail-skeleton");
  assert.equal(shapes.getAttribute("aria-hidden"), "true");
  assert.ok(shapes.querySelectorAll(".skeleton-line").length >= 8,
    "blocks stand in for the heading, the metadata line, and the alternatives");
  assert.equal(textOf(shapes), "", "a drawn block carries no words to read");
  // Drawn in the record's own layout, so nothing jumps when the record lands.
  assert.ok(shapes.classList.contains("decision-detail"));
  assert.ok(shapes.querySelector(".decision-detail-header"));
  assert.ok(shapes.querySelector(".detail-meta"));
  assert.equal(shapes.querySelectorAll(".alternative-card").length, 2);

  // Nothing in the skeleton is a keyboard stop of its own.
  const sequence = tabSequence(page.document);
  assert.equal(sequence.filter((node) => node.closest?.(".detail-skeleton")).length, 0);

  const back = container.querySelector(".detail-back");
  assert.equal(back.getAttribute("href"), "/");
  assert.ok(sequence.includes(back), "the route back works before any script runs");
});

test("the served skeleton and the rendered one are the same drawing", async (t) => {
  const page = await loadPage(DECISION_PAGE, { storage: {}, location: { search: "?id=anything" } });
  t.after(() => page.restore());

  const container = page.document.querySelector("#decision-detail");
  const shapeOf = (node) => ({
    tag: node.tagName,
    className: node.className,
    text: textOf(node),
    children: node.childElements.map(shapeOf),
  });
  const served = shapeOf(container.querySelector(".detail-skeleton"));

  // decision.html duplicates the skeleton so the panel is never an empty box
  // before the module runs, and two hand-kept copies of one drawing drift apart
  // silently. This is the assertion that notices.
  renderDecisionDetailSkeleton(container);
  assert.deepEqual(shapeOf(container.querySelector(".detail-skeleton")), served);
});
