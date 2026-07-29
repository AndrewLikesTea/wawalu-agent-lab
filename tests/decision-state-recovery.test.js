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

test("the served first screen is already a labelled loading state with a way back", async (t) => {
  const page = await loadPage(DECISION_PAGE, { storage: {}, location: { search: "?id=anything" } });
  t.after(() => page.restore());

  const container = page.document.querySelector("#decision-detail");
  const panel = container.querySelector(".detail-state");
  assert.equal(panel.dataset.state, "loading");
  assert.equal(panel.dataset.recoverable, "false", "nothing has failed yet, so nothing offers a retry");
  assert.equal(panel.getAttribute("role"), "status");
  assert.equal(page.document.querySelectorAll(".detail-retry").length, 0);

  const chip = page.document.querySelector(".detail-state-label");
  assert.ok(chip.classList.contains("detail-state-chip"), "the served status label is the same chip the render draws");
  assert.match(textOf(chip), /Decision status/);
  assert.match(textOf(page.document.querySelector("#decision-state-title")), /Loading decision/);

  const back = container.querySelector(".detail-back");
  assert.equal(back.getAttribute("href"), "/");
  assert.ok(tabSequence(page.document).includes(back), "the route back works before any script runs");
});
