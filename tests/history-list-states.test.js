// The home history's four distinct states — loading, empty, no-match, failed —
// and the recovery each settled one offers (issue #2573).
//
// Driven through the shipped src/index.html and src/app.js. What these tests are
// for is telling the states APART: the shape this replaced drew a first-run
// "No decisions yet", complete with a "Record your first decision" button, over
// a decision log the browser had refused to hand over, and stated the wait twice
// ("Loading decisions" over "Loading all decisions…") in a region that lists
// releases as well as decisions. So each state's words are counted across the
// whole document rather than merely found, and every assertion names the other
// states' copy as absent.
//
// Determinism: no network, no clock, no sleeps beyond draining the announcer's
// own zero-delay timer. Each test seeds its own storage, and the storage double
// records every setItem by key so "nothing was written" is an observation.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  HISTORY_LOADING_TEXT,
  HISTORY_UNREAD_ANNOUNCEMENT,
  HISTORY_UNREAD_SAVE,
  STORAGE_KEY,
  initDecisionLog,
} from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import { DomEvent, loadPage, textOf, typeText } from "./support/browser.js";

const PAGE = new URL("../src/index.html", import.meta.url);
const CSS = new URL("../src/styles.css", import.meta.url);
// The examples are a module constant on this page, so a test that wants to see
// the first-run state has to stand the page up without them.
const NO_EXAMPLES = { decisions: [], releases: [] };
const NOW = Date.parse("2026-04-01T00:00:00.000Z");

const LOADING = HISTORY_LOADING_TEXT;
const EMPTY = "No decisions yet";
const NO_MATCH = "No records match your filters";
const FAILED = "Couldn’t load your history";

const DECISIONS = [
  {
    id: "d-cache",
    title: "Cache the read path",
    context: "Reduce latency for repeated reads.",
    alternatives: "Tune every query.",
    owner: "Ari",
    status: "accepted",
    createdAt: "2026-01-04T09:00:00.000Z",
  },
];
const RELEASES = [
  {
    id: "r-one",
    version: "v1.0.0",
    title: "First cut",
    description: "The cache shipped.",
    owner: "Ari",
    status: "completed",
    createdAt: "2026-02-01T09:00:00.000Z",
    decisionIds: ["d-cache"],
  },
];

// `control.refuse` makes the decision key's read throw, the way a blocked or
// partitioned store does. It is a mutable flag rather than a constructor
// argument so one page can fail, then recover, under a Retry.
async function openPage(t, { decisions = DECISIONS, releases = RELEASES, refuse = false, boot = true } = {}) {
  const page = await loadPage(PAGE, {
    storage: {
      [STORAGE_KEY]: JSON.stringify(decisions),
      [RELEASE_STORAGE_KEY]: JSON.stringify(releases),
    },
  });
  t.after(() => page.restore());
  const { getItem, setItem } = page.storage;
  const control = { refuse, writes: [], raw: () => getItem(STORAGE_KEY) };
  page.storage.getItem = (key) => {
    if (key === STORAGE_KEY && control.refuse) throw new Error("storage refused the read");
    return getItem(key);
  };
  page.storage.setItem = (key, value) => {
    control.writes.push(key);
    return setItem(key, value);
  };
  if (boot) await bootLog(page);
  return { page, control };
}

const bootLog = (page) => initDecisionLog(page.document, page.storage, {
  seed: NO_EXAMPLES,
  announceDelay: 0,
  now: NOW,
});

// The announcer is debounced through setTimeout, so its live region is written
// one macrotask after the render that asked for it.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const byId = (page, id) => page.document.querySelector(`#${id}`);
const list = (page) => byId(page, "decision-list");
const rows = (page) => page.document.querySelectorAll(".history-card").length;
const activeId = (page) => page.document.activeElement?.getAttribute?.("id") ?? null;
const heading = (page, state) => textOf(list(page).querySelector(`.list-state-${state}`)?.querySelector("h3") ?? list(page));

// How many elements anywhere on the page carry exactly this text, counted by
// walking children: the harness rejects the universal selector, and a state
// drawn or stated twice is what this file exists to catch. Only the innermost
// element holding the words scores, so an ancestor that contains nothing else is
// not counted as a second copy.
function countText(node, text) {
  let inChildren = 0;
  for (const child of node.children ?? []) {
    if (child.getAttribute) inChildren += countText(child, text);
  }
  if (inChildren > 0) return inChildren;
  return textOf(node) === text ? 1 : 0;
}
const onPage = (page, text) => countText(page.document.body, text);

// The one control the current state offers, read from the list region.
const action = (page) => list(page).querySelector("button");

const fill = (page, id, value) => {
  byId(page, id).focus();
  typeText(page.document, value);
};
const click = (node) => node.dispatchEvent(new DomEvent("click", { bubbles: true }));

// --- the wait, stated once -------------------------------------------------

test("the history states its wait once, for both kinds of record, before any module runs", async (t) => {
  const { page } = await openPage(t, { boot: false });
  assert.equal(list(page).getAttribute("aria-busy"), "true");
  // One line, not a heading and a paragraph repeating it.
  assert.equal(onPage(page, LOADING), 1);
  assert.equal(heading(page, "loading"), LOADING);
  assert.equal(list(page).querySelector(".list-state-loading").querySelectorAll("p").length, 0);
  // The sentence names what the region actually holds. The replaced copy said
  // "decisions" twice on a list that carries releases too.
  assert.match(LOADING, /decisions and releases/);
  // A wait offers nothing to press: there is no failure to recover from yet.
  assert.equal(list(page).querySelectorAll("button").length, 0);
});

test("a log that loads replaces the wait rather than standing beside it", async (t) => {
  const { page } = await openPage(t);
  assert.equal(rows(page), 2);
  assert.equal(onPage(page, LOADING), 0);
  assert.equal(list(page).getAttribute("aria-busy"), "false");
  // Rows are not a state to announce: the count above the list already says how
  // many there are, so no state panel is drawn at all.
  assert.equal(list(page).querySelectorAll(".list-state").length, 0);
  assert.equal(onPage(page, EMPTY) + onPage(page, NO_MATCH) + onPage(page, FAILED), 0);
});

// --- empty: nothing stored -------------------------------------------------

test("an empty browser log offers recording, and says nothing about filters or failure", async (t) => {
  const { page } = await openPage(t, { decisions: [], releases: [] });
  assert.equal(rows(page), 0);
  assert.equal(heading(page, "empty"), EMPTY);
  assert.equal(onPage(page, NO_MATCH), 0);
  assert.equal(onPage(page, FAILED), 0);
  assert.equal(onPage(page, LOADING), 0);
  // The next step is recording, and it is a real button that moves focus into
  // the recorder rather than a link dressed as one.
  const button = action(page);
  assert.equal(button.tagName, "BUTTON");
  assert.equal(textOf(button), "Record your first decision");
  assert.equal(button.getAttribute("data-action"), "record-decision");
  assert.equal(button.getAttribute("aria-controls"), "decision-form");
  click(button);
  assert.equal(activeId(page), "title");
});

// --- empty: the filters match nothing --------------------------------------

test("a filter that matches nothing offers clearing, not recording", async (t) => {
  const { page } = await openPage(t);
  fill(page, "decision-search", "nothing matches this");
  assert.equal(rows(page), 0);
  assert.equal(heading(page, "empty"), NO_MATCH);
  // The two empty states are different copy with different next steps. A
  // narrowed view that said "No decisions yet" would be telling a visitor their
  // log is empty when it is their own search that emptied the view.
  assert.equal(onPage(page, EMPTY), 0);
  assert.equal(onPage(page, FAILED), 0);
  const button = action(page);
  assert.equal(button.tagName, "BUTTON");
  assert.equal(textOf(button), "Reset filters");
  assert.equal(button.getAttribute("data-action"), "reset-filters");
  assert.equal(button.getAttribute("aria-controls"), "decision-list");
  // The filters in effect are named in their own values, so the dead end is
  // attributable to the choice that produced it.
  assert.match(textOf(list(page).querySelector(".empty-state-filters")), /nothing matches this/);
  click(button);
  assert.equal(rows(page), 2);
  assert.equal(onPage(page, NO_MATCH), 0);
});

// --- failed ----------------------------------------------------------------

test("a refused read is its own state: the wait is gone, nothing is counted, and Retry is offered", async (t) => {
  const { page } = await openPage(t, { refuse: true });
  await settle();
  // The loading copy is out of the DOM, not merely covered by the panel that
  // replaced it: a hidden sentence is still a sentence a screen reader can reach.
  assert.equal(onPage(page, LOADING), 0);
  assert.equal(heading(page, "error"), FAILED);
  assert.equal(list(page).getAttribute("aria-busy"), "false");
  // Never the other two. An empty-looking history over a failed read is the bug
  // this state exists to end.
  assert.equal(onPage(page, EMPTY), 0);
  assert.equal(onPage(page, NO_MATCH), 0);
  // Nothing is shown, so nothing is counted, split or described — including the
  // module-constant examples, which would otherwise read as this visitor's log.
  assert.equal(rows(page), 0);
  assert.equal(textOf(byId(page, "decision-count")), "");
  assert.equal(textOf(byId(page, "decision-provenance")), "");
  assert.equal(textOf(byId(page, "release-coverage")), "");
  assert.equal(textOf(byId(page, "history-filter-summary")), "");
  // Said in words, never by the tinted panel alone, and announced through the
  // page's own live region — which no state render replaces, so the sentence is
  // not competing with a node that has just been rebuilt.
  assert.match(textOf(list(page).querySelector(".list-state-error")), /could not be read/);
  assert.equal(textOf(byId(page, "history-announcement")), HISTORY_UNREAD_ANNOUNCEMENT);
  assert.match(HISTORY_UNREAD_ANNOUNCEMENT, /Retry/);
  // Announced without being focused. The state change moves nothing: a failure
  // that pulled focus to a panel below the fold would take a reader off whatever
  // they were doing to tell them about it.
  assert.equal(activeId(page), null);
  assert.equal(textOf(page.document.activeElement ?? list(page)) === "Retry", false);
});

test("the recovery control is a real, keyboard-reachable button inside the history region", async (t) => {
  const { page } = await openPage(t, { refuse: true });
  const button = action(page);
  assert.equal(button.tagName, "BUTTON");
  assert.equal(textOf(button), "Retry");
  // A button, not an anchor styled as one, and not opted out of the tab order.
  // Read as a property: this harness reflects nothing back into attributes, so
  // getAttribute("type") is null here on a control a browser types correctly.
  assert.equal(button.type, "button");
  assert.equal(button.getAttribute("href"), null);
  assert.equal(button.getAttribute("tabindex"), null);
  assert.equal(button.getAttribute("data-action"), "retry");
  assert.equal(button.getAttribute("aria-controls"), "decision-list");
  // Reachable means no ancestor hides it and no disclosure can be closed over
  // it: a live region folded inside a closed details element is silent in real
  // browsers even though this harness reads straight through one.
  for (let node = button.parentNode; node && node.getAttribute; node = node.parentNode) {
    assert.equal(node.getAttribute("hidden"), null, `an ancestor hides the Retry: ${node.tagName}`);
    assert.notEqual(node.tagName, "DETAILS", "the Retry sits inside a disclosure");
  }
  // It is drawn in the history region and nowhere else. index.html's first
  // screen is at its tab-stop budget — the coach link is stop 29 of 30 — so a
  // recovery control added above it would push that link out of reach.
  assert.equal(onPage(page, "Retry"), 1);
  assert.equal(list(page).querySelectorAll("button").length, 1);
});

test("Retry re-reads the log: a read that lands restores the history and its figures", async (t) => {
  const { page, control } = await openPage(t, { refuse: true });
  control.refuse = false;
  click(action(page));
  await settle();
  assert.equal(rows(page), 2);
  assert.equal(onPage(page, FAILED), 0);
  // The wait the retry painted is gone too: it was replaced, in the same node.
  assert.equal(onPage(page, LOADING), 0);
  assert.equal(list(page).querySelectorAll(".list-state").length, 0);
  assert.match(textOf(byId(page, "decision-count")), /records?$/);
  assert.match(textOf(byId(page, "history-announcement")), /^Showing/);
  // Focus lands on the log's own heading, which is what the press was for, and
  // is not left on a button the re-render has removed.
  assert.equal(activeId(page), "decisions-title");
});

test("a Retry that fails again says so and hands the same control back", async (t) => {
  const { page } = await openPage(t, { refuse: true });
  click(action(page));
  await settle();
  assert.equal(heading(page, "error"), FAILED);
  assert.equal(onPage(page, FAILED), 1);
  assert.equal(onPage(page, LOADING), 0);
  assert.equal(rows(page), 0);
  assert.equal(textOf(byId(page, "history-announcement")), HISTORY_UNREAD_ANNOUNCEMENT);
  // The keyboard is not dropped to the top of the document by a button that a
  // re-render took out from under it.
  assert.equal(textOf(page.document.activeElement), "Retry");
});

test("a decision recorded while the log is unread is never written over it", async (t) => {
  const { page, control } = await openPage(t, { refuse: true });
  fill(page, "title", "Adopt a durable queue");
  fill(page, "context", "Retries are lost on restart.");
  fill(page, "alternatives", "None considered.");
  fill(page, "owner", "Priya");
  byId(page, "decision-form").dispatchEvent(new DomEvent("submit", { bubbles: true }));
  // The stored log is untouched, and that is observed rather than inferred: a
  // save here would have put this one decision over every decision in the store.
  assert.deepEqual(control.writes.filter((key) => key === STORAGE_KEY), []);
  assert.equal(control.raw(), JSON.stringify(DECISIONS));
  assert.equal(textOf(byId(page, "storage-notice")), HISTORY_UNREAD_SAVE);
  assert.match(HISTORY_UNREAD_SAVE, /Retry/);
  // Nothing typed is lost, so the record survives a retry.
  assert.equal(byId(page, "title").value, "Adopt a durable queue");
});

// --- 390px, and the focus ring, expressed where they actually live ----------

test("the state panels and their actions are fluid enough for a 390px screen", async () => {
  const css = await readFile(CSS, "utf8");
  // No module on this page reads matchMedia or innerWidth, so a harness
  // viewport shim would assert only itself. The narrow-screen promise lives in
  // the stylesheet, so it is read there.
  const rules = [...css.matchAll(/([^{}]*list-state[^{}]*)\{([^}]*)\}/g)];
  assert.ok(rules.length >= 3, "the list-state panels have no rules to check");
  for (const [, selector, body] of rules) {
    // Pseudo-elements are exempt: the loading state's spinner is a 10px dot
    // drawn beside its heading, which cannot widen anything.
    if (selector.includes("::")) continue;
    // A fixed or minimum pixel width is what puts a panel wider than a 390px
    // screen and produces a horizontal scrollbar; nowrap is what clips its text.
    assert.doesNotMatch(body, /white-space\s*:\s*nowrap/, `${selector.trim()} refuses to wrap`);
    assert.doesNotMatch(body, /(^|;)\s*(min-)?width\s*:\s*\d+px/, `${selector.trim()} is a fixed width`);
  }
  // The one action each state offers sizes to its label rather than to the
  // viewport, and carries a visible ring when a keyboard reaches it.
  assert.match(css, /\.empty-action \{[^}]*width:auto/);
  assert.match(css, /\.empty-action:focus-visible \{ outline:3px solid var\(--focus-ring\)/);
  // Every state's guidance wraps as prose rather than being truncated.
  assert.match(css, /\.empty-state p,\.list-state p \{[^}]*line-height:1\.55/);
});
