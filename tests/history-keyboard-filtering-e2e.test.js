// Keyboard-only regression coverage for the decision and release history.
//
// These tests boot the shipped decisions page with fixed browser-local records.
// They use no network, sleeps, clock thresholds, or retries. The DOM harness
// exercises native tab, radio, select, link, and keyboard events; the final
// test reads the shipped stylesheet for the paint/layout promises the harness
// deliberately cannot simulate.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { initDecisionLog, STORAGE_KEY } from "../src/app.js";
import { RELEASE_STORAGE_KEY } from "../src/releases.js";
import {
  loadPage,
  pressEnter,
  pressKey,
  pressTab,
  tabSequence,
  textOf,
  typeText,
} from "./support/browser.js";

const PAGE = new URL("../src/index.html", import.meta.url);
const CSS = new URL("../src/styles.css", import.meta.url);
const NO_EXAMPLES = { decisions: [], releases: [] };

const DECISIONS = [
  {
    id: "keyboard-cache",
    title: "Cache the read path",
    context: "Reduce latency for repeated reads.",
    alternatives: "Tune every query.",
    owner: "Ari",
    status: "accepted",
    createdAt: "2026-01-04T09:00:00.000Z",
  },
  {
    id: "keyboard-flags",
    title: "Introduce feature flags",
    context: "Separate deployment from release.",
    alternatives: "Keep release branches.",
    owner: "Priya",
    status: "pending",
    createdAt: "2026-01-05T09:00:00.000Z",
  },
  {
    id: "keyboard-queue",
    title: "Adopt a durable queue",
    context: "Protect work during restarts.",
    alternatives: "Retry in process.",
    owner: "Ari",
    status: "proposed",
    createdAt: "2026-01-06T09:00:00.000Z",
  },
];

const RELEASES = [
  {
    id: "keyboard-r-1",
    version: "v1.1.0",
    title: "Read path",
    description: "The read cache shipped.",
    owner: "Ari",
    status: "completed",
    createdAt: "2026-01-07T09:00:00.000Z",
    decisionIds: ["keyboard-cache"],
  },
  {
    id: "keyboard-r-2",
    version: "v1.2.0",
    title: "Flag controls",
    description: "The flag controls are planned.",
    owner: "Priya",
    status: "planned",
    createdAt: "2026-01-08T09:00:00.000Z",
    decisionIds: ["keyboard-flags"],
  },
];

const STORAGE = {
  [STORAGE_KEY]: JSON.stringify(DECISIONS),
  [RELEASE_STORAGE_KEY]: JSON.stringify(RELEASES),
};

async function openHistory(t, { search = "", restore = true } = {}) {
  const location = { pathname: "/", search, origin: "https://labs.wawalu.org" };
  const writes = [];
  const history = {
    pushState(_state, _unused, path) {
      writes.push({ method: "push", path });
      location.search = new URL(path, location.origin).search;
    },
    replaceState(_state, _unused, path) {
      writes.push({ method: "replace", path });
      location.search = new URL(path, location.origin).search;
    },
  };
  const page = await loadPage(PAGE, { storage: STORAGE, location });
  if (restore) t.after(() => page.restore());
  await initDecisionLog(page.document, page.storage, {
    seed: NO_EXAMPLES,
    location,
    history,
    window: globalThis.window,
    announceDelay: 0,
    now: Date.parse("2026-02-01T00:00:00.000Z"),
  });
  assert.equal(page.document.documentElement.dataset.shiplog, "ready");
  return { ...page, location, writes };
}

const rows = (page) => page.document.querySelectorAll(".history-card");
const titles = (page) => rows(page).map((row) => textOf(row.querySelector("h3")));
const count = (page) => textOf(page.document.querySelector("#decision-count"));

// The count a screen reader hears, which is not the count on screen: the visible
// #decision-count is rewritten synchronously on every keystroke, while
// #history-announcement is debounced so a reader is not interrupted mid-word.
// `announceDelay: 0` above still routes through a timer, so these tests wait for
// one — a filter change that never reaches this region is a filter change a
// keyboard-only reader cannot confirm, however correct the list beneath it is.
const settle = () => new Promise((resolve) => { setTimeout(resolve, 0); });
const announced = (page) => textOf(page.document.querySelector("#history-announcement"));
const chips = (page) => page.document.querySelectorAll(".filter-chip");

function tabTo(page, selector) {
  const target = page.document.querySelector(selector);
  assert.ok(target, `${selector} is absent`);
  for (let steps = 0; steps <= tabSequence(page.document).length; steps += 1) {
    if (page.document.activeElement === target) return target;
    pressTab(page.document);
  }
  assert.fail(`${selector} is not reachable in the tab order`);
}

function visibleLabel(page, control) {
  if (control.getAttribute("aria-label")) return control.getAttribute("aria-label");
  if (control.tagName === "BUTTON") return textOf(control);
  const label = page.document.querySelector(`label[for="${control.id}"]`);
  if (label) return textOf(label);
  const fieldset = control.closest("fieldset");
  return fieldset ? textOf(fieldset.querySelector("legend")) : "";
}

test("keyboard users reach named filters, change criteria, and see only matching records", async (t) => {
  const page = await openHistory(t);
  const search = tabTo(page, "#decision-search");
  assert.equal(visibleLabel(page, search), "Search records");

  const all = tabTo(page, "#record-type-all");
  assert.equal(visibleLabel(page, all), "All records");
  pressKey(page.document, "ArrowDown");
  assert.equal(page.document.activeElement.id, "record-type-decision");
  assert.equal(visibleLabel(page, page.document.activeElement), "Decisions");
  assert.deepEqual(titles(page), ["Adopt a durable queue", "Introduce feature flags", "Cache the read path"]);
  assert.equal(count(page), "3 of 5 records");
  await settle();
  assert.equal(announced(page), "Showing 3 of 5 records.");

  const status = tabTo(page, "#filter-status");
  assert.equal(visibleLabel(page, status), "Decision status:");
  pressKey(page.document, "ArrowDown"); // all -> proposed
  assert.deepEqual(titles(page), ["Adopt a durable queue"]);
  assert.equal(count(page), "1 of 5 records");

  // Changing an earlier criterion predictably clears the contradictory status.
  page.document.querySelector("#record-type-decision").focus();
  pressKey(page.document, "ArrowDown");
  assert.equal(page.document.activeElement.id, "record-type-release");
  assert.equal(status.disabled, true);
  assert.equal(status.value, "all");
  // Disabled is not enough on its own: a control that still takes a tab stop is
  // a stop the keyboard pays for and cannot use.
  assert.ok(
    !tabSequence(page.document).includes(status),
    "the inapplicable status filter is disabled but still holds a tab stop",
  );
  assert.deepEqual(titles(page), ["v1.2.0 · Flag controls", "v1.1.0 · Read path"]);
  assert.equal(count(page), "2 of 5 records");
  await settle();
  assert.equal(announced(page), "Showing 2 of 5 records.");

  pressKey(page.document, "ArrowDown"); // release -> all
  const owner = tabTo(page, "#filter-owner");
  assert.equal(visibleLabel(page, owner), "Filter by owner:");
  pressKey(page.document, "ArrowDown"); // all -> Ari
  assert.deepEqual(titles(page), ["v1.1.0 · Read path", "Adopt a durable queue", "Cache the read path"]);
  assert.equal(count(page), "3 of 5 records");
});

test("a keyboard-created zero-result state clears predictably and returns focus to search", async (t) => {
  const page = await openHistory(t);
  const owner = tabTo(page, "#filter-owner");
  pressKey(page.document, "ArrowDown"); // Ari
  const search = tabTo(page, "#decision-search");
  typeText(page.document, "feature flags");

  assert.deepEqual(titles(page), []);
  assert.equal(count(page), "0 of 5 records");
  await settle();
  assert.equal(announced(page), "No records match the current filters.");
  const empty = page.document.querySelector(".list-state-empty");
  assert.equal(textOf(empty.querySelector("h3")), "No records match your filters");
  assert.match(textOf(empty), /feature flags/);
  assert.match(textOf(empty), /Ari/);

  const clear = tabTo(page, "#clear-decision-filters");
  assert.equal(visibleLabel(page, clear), "Clear filters");
  pressEnter(page.document);
  assert.equal(page.document.activeElement, search, "clearing did not return focus to the search control");
  assert.equal(search.value, "");
  assert.equal(page.document.querySelector("#filter-owner").value, "all");
  assert.equal(count(page), "5 records");
  await settle();
  assert.equal(announced(page), "Showing all 5 records.");
  assert.deepEqual(titles(page), [
    "v1.2.0 · Flag controls",
    "v1.1.0 · Read path",
    "Adopt a durable queue",
    "Introduce feature flags",
    "Cache the read path",
  ]);
});

// Clearing every filter at once is one of two ways out, and the coarser one. The
// chips are the other: they drop one criterion and leave the rest composed, which
// is what an engineering lead narrowing a release review actually reaches for.
// Each chip is a button that deletes itself, so the interesting question is not
// whether the filter goes but where the keyboard is standing afterwards — a
// control that removes itself and drops focus to the top of the document costs a
// keyboard-only reviewer the whole page every time they narrow a criterion.
test("a chip drops one criterion under the keyboard and hands focus to a control, never to the document", async (t) => {
  const page = await openHistory(t);
  tabTo(page, "#record-type-all");
  pressKey(page.document, "ArrowDown"); // all -> decision
  tabTo(page, "#filter-owner");
  pressKey(page.document, "ArrowDown"); // all -> Ari
  assert.deepEqual(
    chips(page).map((chip) => chip.getAttribute("aria-label")),
    ["Remove record type filter: Decisions", "Remove owner filter: Ari"],
  );

  const first = tabTo(page, ".filter-chip");
  assert.equal(first.dataset.filter, "type");
  pressEnter(page.document);

  // One criterion gone, the other still composed — and the control that named it
  // is back in its neutral state, so the chips and the filter bar cannot disagree.
  assert.deepEqual(chips(page).map((chip) => chip.dataset.filter), ["owner"]);
  assert.equal(page.document.querySelector("#record-type-all").checked, true);
  assert.deepEqual(titles(page), ["v1.1.0 · Read path", "Adopt a durable queue", "Cache the read path"]);
  assert.equal(count(page), "3 of 5 records");
  assert.equal(page.document.activeElement?.dataset.filter, "owner", "focus did not follow the chip row");
  await settle();
  assert.equal(announced(page), "Showing 3 of 5 records.");

  // Removing the last chip empties the row, so focus has nowhere to land inside
  // it. It must still land on something operable rather than being dropped.
  pressEnter(page.document);
  assert.equal(chips(page).length, 0);
  assert.equal(page.document.querySelector("#history-filter-chips").hidden, true);
  assert.equal(count(page), "5 records");
  const landed = page.document.activeElement;
  assert.ok(landed, "removing the last chip dropped focus to the document");
  assert.ok(
    tabSequence(page.document).includes(landed),
    `focus landed on ${landed.id || landed.tagName}, which is not in the tab order`,
  );
});

test("keyboard navigation traverses filtered decision and release results and opens the focused record", async (t) => {
  const page = await openHistory(t);
  const search = tabTo(page, "#decision-search");
  typeText(page.document, "read");
  assert.deepEqual(titles(page), ["v1.1.0 · Read path", "Cache the read path"]);

  const first = tabTo(page, ".release-history-link");
  assert.match(first.getAttribute("aria-labelledby"), /^release-title-/);
  assert.match(first.getAttribute("aria-describedby"), /^release-summary-/);
  pressKey(page.document, "End");
  assert.equal(textOf(page.document.activeElement.querySelector("h3")), "Cache the read path");
  pressKey(page.document, "ArrowUp");
  assert.equal(page.document.activeElement, first);
  // Home and End are half of what the hint under the filters promises, so both
  // are exercised from the far end of the filtered stream, not just End.
  pressKey(page.document, "End");
  pressKey(page.document, "Home");
  assert.equal(page.document.activeElement, first);
  pressKey(page.document, "ArrowDown");
  pressEnter(page.document);
  assert.deepEqual(page.navigations, ["/decision.html?id=keyboard-cache"]);
});

test("active keyboard filters survive refresh and the loading state is honest before boot", async (t) => {
  const before = await openHistory(t, { restore: false });
  tabTo(before, "#record-type-all");
  pressKey(before.document, "ArrowDown");
  const owner = tabTo(before, "#filter-owner");
  pressKey(before.document, "ArrowDown");
  assert.deepEqual(titles(before), ["Adopt a durable queue", "Cache the read path"]);
  assert.equal(before.location.search, "?type=decision&owner=Ari");
  before.restore();

  const pending = await loadPage(PAGE, { storage: STORAGE, location: { search: before.location.search } });
  t.after(() => pending.restore());
  assert.equal(pending.document.querySelector("#decision-list").getAttribute("aria-busy"), "true");
  assert.equal(textOf(pending.document.querySelector(".list-state-loading").querySelector("h3")), "Loading decisions");
  await initDecisionLog(pending.document, pending.storage, {
    seed: NO_EXAMPLES,
    location: globalThis.window.location,
    window: globalThis.window,
    announceDelay: 0,
    now: Date.parse("2026-02-01T00:00:00.000Z"),
  });
  assert.equal(pending.document.querySelector("#decision-list").getAttribute("aria-busy"), "false");
  assert.deepEqual(titles(pending), ["Adopt a durable queue", "Cache the read path"]);
  assert.equal(pending.document.querySelector("#record-type-decision").checked, true);
  assert.equal(pending.document.querySelector("#filter-owner").value, "Ari");
});

test("the shipped responsive layout preserves full-width filters and visible keyboard focus", async () => {
  const css = await readFile(CSS, "utf8");
  assert.match(
    css,
    /input:focus-visible,textarea:focus-visible,select:focus-visible,button:focus-visible,a:focus-visible\s*\{[^}]*outline:3px solid var\(--focus-ring\)/,
    "interactive filter controls lost their visible focus treatment",
  );
  assert.match(
    css,
    /\.decision-card:focus-visible,\.release-card:focus-visible\s*\{[^}]*outline:3px solid var\(--focus-ring\)/,
    "decision and release result links lost their visible focus treatment",
  );
  const mobile = css.slice(css.indexOf("@media(max-width:520px) { main,.page"));
  assert.ok(mobile.startsWith("@media(max-width:520px)"), "the history has no phone layout breakpoint");
  assert.match(mobile, /\.filters,\.social-toolbar\{[^}]*flex-direction:column/);
  assert.match(mobile, /\.filter\{[^}]*width:100%[^}]*min-width:0/);
  assert.match(mobile, /\.clear-filters\{[^}]*width:100%/);
});
