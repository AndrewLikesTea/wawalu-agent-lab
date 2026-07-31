// Four addressable screens on /evolution.html, and the properties a forwarded
// link has to have.
//
// THE FAILURE THIS FILE EXISTS FOR. The first attempt at this change moved the
// destinations into a client-side router and left the shipped document with no
// marked destination at all: before any script ran, `/evolution.html` was a page
// that could not say where the reader was. The first two tests here parse the
// static markup with no script execution whatsoever, which is the state a
// browser paints first, a crawler reads, and a reader with JavaScript off keeps.
//
// AND THE REST OF THE CONTRACT. One control rather than two lists of the same
// four names; an address per destination that opens that destination cold; a
// fallback that renders rather than errors; back and forward that restore the
// destination *and* how far down it the reader had got; the legacy anchors this
// page shipped before it had addresses; and no other destination's content
// sitting rendered in the document while one is open.
//
// No clock, no network, no sleeps.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import { SCREEN_CONTRACT } from "../src/finops-screen-contract.js";
import {
  DESTINATION_ORDER, DESTINATION_STATE_LABEL, DESTINATION_URL, WORKSPACE_DESTINATION,
  WORKSPACE_NAV_IDS,
} from "../src/finops-workspace-nav.js";
import {
  LEGACY_ANCHOR, currentWorkspaceDestination, destinationForAddress, initWorkspaceShell,
  workspaceRegions,
} from "../src/finops-workspace-shell.js";
import { loadWorkspaceDestinations } from "../src/finops-destination-contract.js";

const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
const css = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
const loaded = loadWorkspaceDestinations();

const byId = (doc, id) => doc.getElementById(id);
const doors = (doc) => byId(doc, WORKSPACE_NAV_IDS.list).querySelectorAll("[data-destination-key]");
const activeKeys = (doc) => [...new Set(workspaceRegions(doc)
  .filter((region) => region.dataset.workspaceActive === "true")
  .map((region) => region.dataset.workspaceRegion))];

/**
 * A window with real history: an entry stack, per-entry state, a scroll offset,
 * and back/forward that replay them the way a browser does.
 *
 * Written out rather than mocked away because the assertions below are about
 * exactly this — that the offset is stamped on the entry being left, and read
 * back off the entry being returned to.
 */
function historyWindow(hash = "") {
  const win = {
    location: { hash },
    scrollY: 0,
    scrollTo(_x, y) { this.scrollY = y; },
    listeners: new Map(),
    entries: [{ hash, state: null }],
    index: 0,
    addEventListener(type, handler) {
      if (!this.listeners.has(type)) this.listeners.set(type, []);
      this.listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      this.listeners.set(type, (this.listeners.get(type) ?? []).filter((one) => one !== handler));
    },
    emit(type, event) {
      for (const handler of [...(this.listeners.get(type) ?? [])]) handler(event);
    },
    /** Back or forward. `step` is -1 or 1, as `history.go` takes it. */
    travel(step) {
      const next = this.index + step;
      if (next < 0 || next >= this.entries.length) return;
      this.index = next;
      this.location.hash = this.entries[next].hash;
      this.emit("popstate", { state: this.entries[next].state });
    },
  };
  win.history = {
    scrollRestoration: "auto",
    get state() { return win.entries[win.index].state; },
    replaceState(state, _title, url) {
      win.entries[win.index] = { hash: url ?? win.entries[win.index].hash, state };
      if (url) win.location.hash = url;
    },
    pushState(state, _title, url) {
      win.entries.length = win.index + 1;
      win.entries.push({ hash: url ?? win.location.hash, state });
      win.index = win.entries.length - 1;
      if (url) win.location.hash = url;
    },
  };
  return win;
}

const opened = (hash = "") => {
  const document = parseHtml(html);
  const win = historyWindow(hash);
  const shell = initWorkspaceShell(document, { win, loaded });
  return { document, win, shell };
};

/* ------------------------- before any script runs -------------------------- */

test("the shipped document already marks one destination current, with no script", () => {
  // This is the assertion attempt 1 failed. `parseHtml` runs nothing: what it
  // sees is the byte stream a browser paints before it has executed a line.
  const document = parseHtml(html);
  const marked = doors(document).filter((door) => door.getAttribute("aria-current") === "true");
  assert.equal(marked.length, 1, `${marked.length} doors are marked current in the static markup`);
  assert.equal(marked[0].dataset.destinationKey, WORKSPACE_DESTINATION.answer,
    "the document opens on a destination other than the answer");

  // Marked in the markup, in words, and visibly — not painted on afterwards.
  const state = marked[0].querySelector(".workspace-dest-state");
  assert.equal(textOf(state), DESTINATION_STATE_LABEL.current);
  assert.notEqual(state.hidden, true, "the word Current is hidden until a script unhides it");

  // And every door is an ordinary anchor with a real address, so the whole
  // control is operable with no script at all.
  for (const door of doors(document)) {
    assert.equal(door.tagName, "A");
    assert.equal(door.getAttribute("href"), DESTINATION_URL[door.dataset.destinationKey]);
  }
});

test("one control lists each destination exactly once, in the contract's order", () => {
  const document = parseHtml(html);
  const keys = doors(document).map((door) => door.dataset.destinationKey);
  assert.deepEqual(keys, [...DESTINATION_ORDER],
    "the control's doors are not the contract's destinations in the contract's order");
  assert.deepEqual(doors(document).map((door) => textOf(door.querySelector(".workspace-dest-name"))),
    SCREEN_CONTRACT.map((screen) => screen.name),
    "a door's name was re-typed instead of read from the screen contract");

  // The working-area switcher is gone from the document — not hidden in it. A
  // second copy left behind is still a second tab stop, a second thing a screen
  // reader reads out, and a second place the two can disagree.
  assert.equal(byId(document, "finops-workspace-switch"), null,
    "the retired working-area switcher is still in the document");
  assert.doesNotMatch(html, /workspace-switch-door|data-shell-destination/,
    "markup from the retired second control survives");

  // And nothing else on the page duplicates the list: every element that names a
  // destination key is inside the one control.
  const claimed = [...document.querySelectorAll("[data-destination-key]")]
    .filter((node) => !node.closest(`#${WORKSPACE_NAV_IDS.list}`));
  assert.deepEqual(claimed, [], "a second list of the destinations is still in the document");
});

/* ------------------------------- addresses -------------------------------- */

test("each destination has its own address that opens it cold, under the same headline", () => {
  for (const key of DESTINATION_ORDER) {
    const { document, shell } = opened(DESTINATION_URL[key]);
    assert.equal(shell.destination, key, `${DESTINATION_URL[key]} opened ${shell.destination}`);
    assert.deepEqual(activeKeys(document), [key]);
    assert.equal(currentWorkspaceDestination(document), key);

    // The answer block is the frame, not a screen's content: its headline is on
    // screen in all four, which is what makes a forwarded link readable to
    // someone who never saw the destination it came from.
    const headline = byId(document, "finops-first-run");
    assert.equal(headline.getAttribute("data-workspace-frame"), "true");
    assert.equal(headline.dataset.workspaceActive, undefined,
      "the answer block is held back on some destination");
    assert.equal(headline.hidden, false);
  }
});

test("an unknown, malformed, or empty address falls back to the answer and renders it", () => {
  for (const hash of ["", "#", "#workspace-", "#workspace-nope", "#not-a-thing", "#%zz"]) {
    const { document, shell, win } = opened(hash);
    assert.equal(shell.destination, WORKSPACE_DESTINATION.answer, `"${hash}" opened ${shell.destination}`);
    assert.deepEqual(activeKeys(document), [WORKSPACE_DESTINATION.answer],
      `"${hash}" left the page with no screen on it`);
    // It falls back; it does not redirect. Nothing rewrites the address, so
    // there is no entry to bounce off and no loop to get into.
    assert.equal(win.location.hash, hash, `"${hash}" was rewritten instead of resolved`);
    assert.equal(win.entries.length, 1, `"${hash}" pushed a history entry on a cold load`);
  }
  assert.equal(destinationForAddress(parseHtml(html), null), WORKSPACE_DESTINATION.answer);
});

test("every anchor this page shipped before it had addresses opens its destination", () => {
  const document = parseHtml(html);
  for (const [anchor, key] of Object.entries(LEGACY_ANCHOR)) {
    assert.ok(byId(document, anchor.slice(1)), `${anchor} names nothing on this page any more`);
    assert.equal(destinationForAddress(document, anchor), key,
      `${anchor} no longer lands a reader in ${key}`);
  }
  // The three the rail itself pointed at before this change, spelled out: these
  // are the ones already in address bars and in forwarded mail.
  assert.equal(LEGACY_ANCHOR["#finops-first-run"], WORKSPACE_DESTINATION.answer);
  assert.equal(LEGACY_ANCHOR["#recommendation-evidence"], WORKSPACE_DESTINATION.evidence);
  assert.equal(LEGACY_ANCHOR["#department-decision-panel"], WORKSPACE_DESTINATION.department);
  // An anchor nobody mapped is not a broken page: it is the answer.
  assert.equal(destinationForAddress(document, "#some-anchor-from-2024"),
    WORKSPACE_DESTINATION.answer);

  // The anchor stays in the address bar rather than being replaced, so the
  // page's own deep-link handler can still unfold and reveal the panel it names.
  const { win } = opened("#department-decision-panel");
  assert.equal(win.location.hash, "#department-decision-panel");
});

/* ---------------------------- back and forward ---------------------------- */

test("back and forward restore the destination and how far down it the reader was", () => {
  const { document, win } = opened();
  assert.equal(win.history.scrollRestoration, "manual",
    "the browser is still restoring scroll for a page that is four screens");

  // Read a way into the answer, then open Evidence from the control.
  win.scrollY = 900;
  doors(document).find((door) => door.dataset.destinationKey === WORKSPACE_DESTINATION.evidence).click();
  assert.deepEqual(activeKeys(document), [WORKSPACE_DESTINATION.evidence]);
  assert.equal(win.location.hash, DESTINATION_URL[WORKSPACE_DESTINATION.evidence],
    "the address bar does not carry the destination the reader is in");
  assert.equal(win.entries.length, 2, "the press did not land one entry in session history");
  assert.equal(win.scrollY, 0, "a newly opened destination started part-way down");

  // Read a way into Evidence, then open Departments.
  win.scrollY = 450;
  doors(document).find((door) => door.dataset.destinationKey === WORKSPACE_DESTINATION.department).click();
  assert.deepEqual(activeKeys(document), [WORKSPACE_DESTINATION.department]);

  win.travel(-1);
  assert.deepEqual(activeKeys(document), [WORKSPACE_DESTINATION.evidence], "back lost the destination");
  assert.equal(win.scrollY, 450, "back returned the reader to the top of a screen they had read");

  win.travel(-1);
  assert.deepEqual(activeKeys(document), [WORKSPACE_DESTINATION.answer]);
  assert.equal(win.scrollY, 900, "back lost how far into the answer the reader had got");

  win.travel(1);
  assert.deepEqual(activeKeys(document), [WORKSPACE_DESTINATION.evidence], "forward lost the destination");
  assert.equal(win.scrollY, 450);
});

test("no reload, no focus theft, and one announcement on a restore", () => {
  const { document, win } = opened();
  document.activeElement = null;

  doors(document).find((door) => door.dataset.destinationKey === WORKSPACE_DESTINATION.department).click();
  // Routed, not navigated: the shell handled it in-page rather than letting the
  // browser fetch the document again.
  assert.deepEqual(document.navigations, [], "opening a destination reloaded the page");

  win.travel(-1);
  assert.equal(document.activeElement, null,
    "back moved the keyboard, which is not what a reader who pressed back asked for");
  // A destination the reader did not press for still has to be said out loud.
  assert.match(textOf(byId(document, WORKSPACE_NAV_IDS.live)), /^Current destination: The answer\./);
});

test("nothing is announced and no focus is taken on the cold open of any destination", () => {
  for (const key of DESTINATION_ORDER) {
    const { document } = opened(DESTINATION_URL[key]);
    assert.equal(textOf(byId(document, WORKSPACE_NAV_IDS.live)), "",
      `opening ${key} directly talked over the page's own heading`);
    assert.equal(document.activeElement, null, `opening ${key} directly stole the keyboard`);
  }
});

/* --------------------------- one screen at a time -------------------------- */

test("the other three destinations' content is not rendered work in the document", () => {
  const { document } = opened(DESTINATION_URL[WORKSPACE_DESTINATION.department]);
  const held = workspaceRegions(document)
    .filter((region) => region.dataset.workspaceActive === "false");
  assert.ok(held.length >= 9, `only ${held.length} regions were held back`);

  for (const region of held) {
    // `display:none` on the attribute the stylesheet keys off — not `hidden`,
    // which several of these regions manage themselves for their own empty
    // state, and not a visual-only class, which would leave the content in the
    // accessibility tree for a screen reader to walk through anyway.
    assert.equal(region.dataset.workspaceActive, "false");
    assert.notEqual(region.dataset.workspaceRegion, WORKSPACE_DESTINATION.department);
  }
  assert.match(css, /\[data-workspace-region\]\[data-workspace-active="false"\] \{ display:none; \}/,
    "a held-back destination is only visually hidden, so a screen reader still walks it");
});
