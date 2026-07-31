// A forwardable link to /evolution.html, and the one control that keeps it honest.
//
// #819: a FinOps lead reads the department drill-down, copies the URL, and sends
// it to the person who owns that spend. What arrives has to open on the drill-down
// — with the answer's headline still above it, so the recipient knows what figure
// they are looking at the departments *of*.
//
// The invariants below are the ones that were not already held anywhere:
//
//   * ONE CONTROL. The rail and the working-area switcher used to list the same
//     four destinations twice, in two vocabularies, and disagree about
//     act-and-verify. The switcher is gone; these tests fail if a second list of
//     the destinations comes back.
//   * THE ORDER IS THE CONTRACT'S. `finops-screen-contract.js` is the shipped
//     screen contract, and the hand-written markup cannot drift from it — the
//     names and the order are asserted against it rather than pinned to a copy.
//   * A DIRECT LOAD LANDS. Every destination, by the fragment it owns and by the
//     href its door actually carries.
//   * AN UNUSABLE DESTINATION FALLS BACK. Unknown, malformed, empty — the answer,
//     never a throw and never an empty shell.
//   * BACK AND FORWARD REPAINT, in the page, with no document navigation.
//
// No clock, no network, no sleeps.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import { SCREEN_CONTRACT } from "../src/finops-screen-contract.js";
import { WORKSPACE_DESTINATION, WORKSPACE_NAV_IDS } from "../src/finops-workspace-nav.js";
import {
  DESTINATION_FRAGMENT, currentWorkspaceDestination, destinationForFragment,
  initWorkspaceShell, workspaceRegions,
} from "../src/finops-workspace-shell.js";

const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");

const byId = (doc, id) => doc.getElementById(id);
/** The doors of the one control, as anchors. The detail list below it is prose. */
const doors = (doc) => byId(doc, WORKSPACE_NAV_IDS.list).querySelectorAll("a[data-destination-key]");
const activeKeys = (doc) => [...new Set(workspaceRegions(doc)
  .filter((region) => region.dataset.workspaceActive === "true")
  .map((region) => region.dataset.workspaceRegion))];

/** A window whose hash a test can move, with real listeners. */
function fakeWindow(hash = "") {
  const listeners = new Map();
  return {
    location: { hash },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener() {},
    /** What a browser does when a fragment link is followed, or back is pressed. */
    go(next, type = "hashchange") {
      this.location.hash = next;
      for (const handler of listeners.get(type) ?? []) handler();
    },
  };
}

const opened = (hash = "") => {
  const document = parseHtml(html);
  const win = fakeWindow(hash);
  const shell = initWorkspaceShell(document, { win });
  return { document, win, shell };
};

/* --------------------------------- one control ---------------------------- */

test("one control lists each destination exactly once, and it is the only one", () => {
  const document = parseHtml(html);

  // The retired switcher, by id and by its data attribute: a second control that
  // came back under a new name would still be caught by the second assertion.
  assert.equal(byId(document, "finops-workspace-switch"), null,
    "the working-area switcher is back, so the page lists its destinations twice");
  assert.equal(document.querySelectorAll("[data-shell-destination]").length, 0,
    "a second control is authored with the retired switcher's vocabulary");

  const keys = doors(document).map((door) => door.dataset.destinationKey);
  assert.equal(keys.length, 4, `the one control has ${keys.length} doors`);
  assert.equal(new Set(keys).size, 4, `a destination is listed twice: ${keys.join(", ")}`);

  // Every door is in the one control, so there is no fifth door authored loose
  // in the document beside it.
  assert.equal(document.querySelectorAll("a[data-destination-key]").length, 4,
    "a destination door is authored outside the one control");
});

test("the markup's destinations are the screen contract's, in the contract's order", () => {
  const document = parseHtml(html);
  const authored = doors(document);

  assert.deepEqual(authored.map((door) => door.dataset.destinationKey),
    SCREEN_CONTRACT.map((entry) => entry.shellDestination),
    "the hand-written rail and the screen contract disagree about the destinations");

  // The visible names too, from the same source. A door that reads differently
  // from the contract is a door a reader cannot match to the document.
  const names = authored.map((door) =>
    textOf(door.querySelector(".workspace-dest-name")));
  assert.deepEqual(names, SCREEN_CONTRACT.map((entry) => entry.name));
  for (const door of authored) {
    assert.equal(door.dataset.destinationName,
      SCREEN_CONTRACT.find((entry) => entry.shellDestination === door.dataset.destinationKey).name);
  }

  // And the alias table the rest of the page keys off is the same four, in the
  // same order, so `WORKSPACE_DESTINATION` cannot become a fifth opinion.
  assert.deepEqual(Object.values(WORKSPACE_DESTINATION),
    SCREEN_CONTRACT.map((entry) => entry.shellDestination));
});

/* ------------------------------ the forwarded link ------------------------- */

test("a forwarded link opens its destination, with the answer's headline above it", () => {
  for (const entry of SCREEN_CONTRACT) {
    const key = entry.shellDestination;
    // Both URLs a reader can end up holding: the fragment the destination owns,
    // and the href its own door carries into the address bar.
    const document = parseHtml(html);
    const door = doors(document).find((link) => link.dataset.destinationKey === key);
    for (const hash of [DESTINATION_FRAGMENT[key], door.getAttribute("href")]) {
      const { document: doc } = opened(hash);
      assert.deepEqual(activeKeys(doc), [key], `${hash} did not open ${key}`);
      assert.equal(currentWorkspaceDestination(doc), key, `${hash} left the control marking another door`);

      // The answer block is frame, not destination content: it is above every
      // destination, so a recipient always knows which figure this is about.
      const headline = byId(doc, "finops-answer-question");
      assert.ok(headline && textOf(headline).length > 0,
        `${hash} opened without the answer's headline`);
      assert.equal(headline.closest("[data-workspace-region]"), null,
        "the answer's headline is inside a destination, so three of four hide it");
    }
  }
});

test("an unknown, malformed, or empty destination falls back to the answer", () => {
  // Never a throw, and never an empty shell: every one of these renders the
  // answer, which is what a cold load of the bare URL renders.
  for (const hash of ["", "#", "#not-a-destination", "#workspace-", "#%%%", "workspace-evidence"]) {
    const { document, shell } = opened(hash);
    assert.equal(shell.destination, WORKSPACE_DESTINATION.answer, `"${hash}" did not fall back`);
    assert.deepEqual(activeKeys(document), [WORKSPACE_DESTINATION.answer]);
    assert.equal(currentWorkspaceDestination(document), WORKSPACE_DESTINATION.answer);
    assert.ok(workspaceRegions(document).some((region) => region.dataset.workspaceActive === "true"),
      `"${hash}" rendered an empty shell`);
  }
});

test("a link saved before the split still lands on the destination that holds it", () => {
  const document = parseHtml(html);
  // Mid-page fragments a reader saved off the old monolith. Each resolves through
  // the region that now contains it rather than 404ing into the answer.
  for (const [id, key] of Object.entries({
    "recommendation-evidence": WORKSPACE_DESTINATION.evidence,
    "department-fix-pack": WORKSPACE_DESTINATION.department,
    "prompt-coaching": WORKSPACE_DESTINATION.actAndVerify,
  })) {
    assert.ok(byId(document, id), `#${id} is no longer on the page`);
    assert.equal(destinationForFragment(document, `#${id}`), key);
    assert.deepEqual(activeKeys(opened(`#${id}`).document), [key],
      `#${id} no longer opens ${key}`);
  }
});

/* -------------------------------- back and forward ------------------------- */

test("back and forward walk the destinations without a document navigation", () => {
  const { document, win } = opened();
  const order = [WORKSPACE_DESTINATION.evidence, WORKSPACE_DESTINATION.department,
    WORKSPACE_DESTINATION.actAndVerify];

  for (const key of order) {
    win.go(DESTINATION_FRAGMENT[key]);
    assert.deepEqual(activeKeys(document), [key]);
  }
  // Back through what was visited, then forward again — `popstate`, which is what
  // a browser fires for both, and the same derivation runs for each.
  for (const key of [...order].reverse().slice(1)) {
    win.go(DESTINATION_FRAGMENT[key], "popstate");
    assert.deepEqual(activeKeys(document), [key]);
    assert.equal(currentWorkspaceDestination(document), key);
  }
  win.go(DESTINATION_FRAGMENT[WORKSPACE_DESTINATION.actAndVerify], "popstate");
  assert.deepEqual(activeKeys(document), [WORKSPACE_DESTINATION.actAndVerify]);

  // Nothing here asked the browser to fetch the document again: the whole walk
  // is fragment changes repainted in place.
  assert.deepEqual(document.navigations ?? [], [],
    "a step back reloaded the page instead of repainting it");
});
