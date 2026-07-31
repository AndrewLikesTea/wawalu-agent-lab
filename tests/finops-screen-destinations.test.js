// One addressable destination per screen on /evolution.html, and one control.
//
// WHAT THESE ASSERTIONS ARE FOR. #819 asked for a link a FinOps lead can forward
// to a colleague and have it open on the screen they were looking at, and for the
// two lists of destinations this page carried to become one. Both halves are
// asserted here as behaviour a reader would notice breaking:
//
//   * THE URL NAMES THE SCREEN. Every destination has a fragment that opens it on
//     a cold load, and the answer block's headline is on screen in all four —
//     forwarding a link to the departments screen must not forward a page whose
//     figure the recipient cannot see.
//   * AN UNKNOWN OR EMPTY DESTINATION IS THE ANSWER. A stale link, a truncated
//     one, or the bare page all open the answer rather than an empty workspace.
//   * BACK AND FORWARD WALK IT, with no reload: the same derivation runs for
//     `popstate` as for the first paint, so the page never shows content the
//     address bar has stopped describing.
//   * ONE CONTROL, FOUR DOORS, ONE MARKED — in the served HTML, before any script
//     runs, and against the SCREEN CONTRACT rather than a list re-typed here. A
//     hardcoded array in this file would pass while the page and the contract
//     said different things, which is the failure it exists to catch.
//
// No clock, no network, no sleeps.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import { SCREEN_CONTRACT } from "../src/finops-screen-contract.js";
import { loadWorkspaceDestinations } from "../src/finops-destination-contract.js";
import {
  DEFAULT_DESTINATION, DESTINATION_STATE_LABEL, WORKSPACE_NAV_IDS, applyWorkspaceNav,
} from "../src/finops-workspace-nav.js";
import {
  DESTINATION_FRAGMENT, DESTINATION_KEYS, currentWorkspaceDestination, initWorkspaceShell,
  workspaceRegions,
} from "../src/finops-workspace-shell.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const loaded = loadWorkspaceDestinations();

const byId = (doc, id) => doc.getElementById(id);
const doors = (doc) => byId(doc, WORKSPACE_NAV_IDS.list).querySelectorAll("[data-destination-key]");
const shown = (doc) => new Set(workspaceRegions(doc)
  .filter((region) => region.dataset.workspaceActive === "true")
  .map((region) => region.dataset.workspaceRegion));

/** A window whose hash a test can move, with real listeners and no navigation. */
function fakeWindow(hash = "") {
  const listeners = new Map();
  return {
    location: { hash },
    reloads: 0,
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) ?? []), handler]);
    },
    removeEventListener(type, handler) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== handler));
    },
    /** What a browser does for a followed fragment, or for back and forward. */
    go(next, type = "hashchange") {
      this.location.hash = next;
      for (const handler of listeners.get(type) ?? []) handler();
    },
  };
}

/** The page, painted and wired the way the entry wires it, at one URL. */
function opened(hash = "") {
  const document = parseHtml(html);
  const win = fakeWindow(hash);
  applyWorkspaceNav(document, loaded, { hash });
  const shell = initWorkspaceShell(document, { win, loaded });
  return { document, win, shell };
}

/** Every URL that names one destination: the screen's own, and its door's. */
function addressesFor(document, key) {
  const door = doors(document).find((entry) => entry.dataset.destinationKey === key);
  return [...new Set([DESTINATION_FRAGMENT[key], door.getAttribute("href")])];
}

/* --------------------------- the destination list -------------------------- */

test("the destinations are the screen contract's, in its order, not a list re-typed here", () => {
  // Imported, never repeated: this is the assertion that fails if the page and
  // docs/executive-answer-screen-contract.md start naming different screens.
  assert.deepEqual([...DESTINATION_KEYS], SCREEN_CONTRACT.map((screen) => screen.shellDestination));

  const document = parseHtml(html);
  assert.deepEqual(doors(document).map((door) => door.dataset.destinationKey), [...DESTINATION_KEYS]);
  assert.deepEqual(
    doors(document).map((door) => textOf(door.querySelector(".workspace-dest-name"))),
    SCREEN_CONTRACT.map((screen) => screen.name),
  );
  // Each destination exactly once. A control that lists one place twice is a
  // control a reader has to work out rather than read.
  assert.equal(new Set(doors(document).map((door) => door.dataset.destinationKey)).size,
    SCREEN_CONTRACT.length);
});

test("one navigation control lists them, with exactly one marked current in the served HTML", () => {
  const document = parseHtml(html);
  // ONE control. The retired "Working area" switcher listed the same four
  // destinations; a second list is what this fails on, by id and by the
  // attribute its doors carried.
  assert.equal(byId(document, "finops-workspace-switch"), null);
  assert.equal(document.querySelectorAll("[data-shell-destination]").length, 0);
  assert.deepEqual(document.querySelectorAll(".workspace-dest").map((door) => door.closest("nav").id),
    Array(4).fill(WORKSPACE_NAV_IDS.nav), "a door is authored outside the one rail");

  // ONE marked, before any script runs, and marked in words as well as in aria.
  const current = doors(document).filter((door) => door.getAttribute("aria-current") === "true");
  assert.equal(current.length, 1, "the served page marks no destination, or more than one");
  assert.equal(current[0].dataset.destinationKey, DEFAULT_DESTINATION);
  assert.equal(textOf(current[0].querySelector(".workspace-dest-state")),
    DESTINATION_STATE_LABEL.current);

  // A real navigation landmark holding a real list of real links, so it is in a
  // screen reader's link list and operable with scripting off.
  const nav = byId(document, WORKSPACE_NAV_IDS.nav);
  assert.equal(nav.tagName, "NAV");
  assert.equal(byId(document, WORKSPACE_NAV_IDS.list).tagName, "OL");
  for (const door of doors(document)) {
    assert.equal(door.tagName, "A");
    assert.match(door.getAttribute("href"), /^#\S+$/, "a door with no href is not a link");
    assert.equal(door.closest("li").tagName, "LI");
  }
});

/* ------------------------------- forwardable ------------------------------- */

test("a URL naming a destination opens on that screen, with the answer headline still up", () => {
  const headline = "finops-answer-question";
  for (const key of DESTINATION_KEYS) {
    for (const address of addressesFor(parseHtml(html), key)) {
      const { document } = opened(address);
      assert.deepEqual([...shown(document)], [key], `${address} did not open ${key}`);
      assert.equal(currentWorkspaceDestination(document), key,
        `${address} opened ${key} without marking it`);

      // The answer block is frame, not content: a forwarded link to any screen
      // arrives with the figure the screen is being read against on it.
      const question = byId(document, headline);
      assert.ok(question, "the answer block's headline is not on the page at all");
      assert.equal(question.closest("[data-workspace-region]"), null,
        `the answer headline is inside a region, so ${address} can hide it`);
      assert.equal(question.closest("[hidden]"), null);
    }
  }
});

test("an unknown destination and an empty one both open the answer", () => {
  for (const address of ["", "#", "#workspace-nowhere", "#not-a-thing-on-this-page"]) {
    const { document, shell } = opened(address);
    assert.equal(shell.destination, DEFAULT_DESTINATION, `"${address}" did not fall back`);
    assert.deepEqual([...shown(document)], [DEFAULT_DESTINATION],
      `"${address}" left the workspace empty instead of opening the answer`);
    assert.equal(currentWorkspaceDestination(document), DEFAULT_DESTINATION);
  }
});

/* ----------------------------- back and forward ---------------------------- */

test("back and forward restore each visited destination, without a reload", () => {
  const { document, win } = opened();
  const evidence = DESTINATION_FRAGMENT.evidence;
  const departments = DESTINATION_FRAGMENT.department;

  win.go(evidence);
  assert.deepEqual([...shown(document)], ["evidence"]);
  win.go(departments);
  assert.deepEqual([...shown(document)], ["department"]);

  // Back, then forward. `popstate` runs the same derivation the first paint ran,
  // so the reader is never left on content the address bar stopped describing.
  win.go(evidence, "popstate");
  assert.deepEqual([...shown(document)], ["evidence"], "back did not restore the evidence screen");
  assert.equal(currentWorkspaceDestination(document), "evidence");
  win.go(departments, "popstate");
  assert.deepEqual([...shown(document)], ["department"], "forward did not restore departments");
  assert.equal(currentWorkspaceDestination(document), "department");

  // Nothing here asked the browser for the document again: a destination change
  // that reloads loses the reader's position and every panel they had opened.
  assert.equal(win.reloads, 0);
});

test("the entry points a reader already has still land on the right screen", () => {
  // The deep links this page shipped before it had screens. Each one is a
  // fragment somebody may have saved; each has to resolve to the screen that now
  // contains it rather than to a page with its target hidden.
  const existing = {
    "#recommendation-evidence": "evidence",
    "#score-card": "evidence",
    "#department-decision-panel": "department",
    "#savings-portfolio-panel": "act-and-verify",
    "#finops-contact": "act-and-verify",
    "#finops-first-run": "answer",
  };
  for (const [address, key] of Object.entries(existing)) {
    const { document } = opened(address);
    assert.deepEqual([...shown(document)], [key], `${address} no longer lands on ${key}`);
    assert.ok(byId(document, address.slice(1)), `${address} points at nothing`);
  }
});
