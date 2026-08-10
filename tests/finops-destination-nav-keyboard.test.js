// The persistent FinOps destination nav, driven from the keyboard (#1523).
//
// WHAT THESE ASSERTIONS ARE FOR. /evolution.html shows one destination at a time
// and the rail above the screen is how a reader moves between them and comes
// back. Every claim below is one a keyboard-only reader would notice breaking,
// and each is written as behaviour the harness actually drives rather than as an
// inspection of the markup:
//
//   * THE RAIL IS REACHABLE BY TAB, and it costs no *new* tab stop to be. The
//     doors were already the links; a rail that grew a control of its own above
//     the first-run region would push every other first-screen stop along, which
//     is what tests/finops-first-screen-*.test.js fail on.
//   * ENTER AND SPACE BOTH OPEN A DOOR. Enter is the browser's own activation
//     behaviour for a link and needs nothing from this page. Space is not: on a
//     plain anchor it scrolls the document. These five doors read as a switcher
//     — five peers, one marked `aria-current` — so a reader presses them with
//     Space, and until #1523 that scrolled the page a screen down and opened
//     nothing. Asserted separately, because the two travel different code paths.
//   * THE KEYBOARD GOES WITH THE READER. After either press, focus is on the
//     screen's own heading, so the next Tab continues inside the destination
//     that just opened rather than restarting at the top of a document this long.
//   * ONE DOOR IS MARKED, AND IT IS THE ONE YOU ARE IN. `aria-current` is the
//     statement of position, and exactly one door may carry it at a time.
//
// Nothing here reads a clock, a network, or a random source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, pressEnter, pressSpace, pressTab, tabSequence } from "./support/browser.js";
import { loadWorkspaceDestinations } from "../src/finops-destination-contract.js";
import {
  DEFAULT_DESTINATION, DESTINATION_FRAGMENT, WORKSPACE_DESTINATION, WORKSPACE_NAV_IDS,
  applyWorkspaceNav, bindWorkspaceNav,
} from "../src/finops-workspace-nav.js";
import {
  WORKSPACE_SHELL_IDS, currentWorkspaceDestination, initWorkspaceShell, regionsFor,
} from "../src/finops-workspace-shell.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const loaded = loadWorkspaceDestinations();

const byId = (doc, id) => doc.getElementById(id);
const doors = (doc) =>
  byId(doc, WORKSPACE_NAV_IDS.list).querySelectorAll("[data-destination-key]");
const doorFor = (doc, key) =>
  doors(doc).find((link) => link.dataset.destinationKey === key);

/** The rail with the shell behind it, which is what a reader actually presses. */
async function worked(hash = "") {
  const page = await loadPage(PAGE);
  const win = {
    location: { pathname: "/evolution.html", search: "", hash },
    addEventListener() {}, removeEventListener() {},
  };
  applyWorkspaceNav(page.document, loaded, { hash });
  initWorkspaceShell(page.document, { win, loaded });
  bindWorkspaceNav(page.document);
  return page;
}

/* ------------------------------ reachable by Tab --------------------------- */

test("every destination door is reachable by Tab, and the rail adds no stop of its own", async () => {
  const { document } = await worked();
  const sequence = tabSequence(document);
  for (const door of doors(document)) {
    assert.ok(sequence.includes(door),
      `the ${door.dataset.destinationKey} door is not in the tab sequence`);
  }

  // The rail itself is `tabindex="-1"` — a return target, not a stop — and the
  // screen heading the keyboard is handed on a change is the same. Neither may
  // become a stop a reader has to Tab past on every pass.
  for (const id of [WORKSPACE_NAV_IDS.nav, WORKSPACE_SHELL_IDS.screenTitle]) {
    assert.equal(byId(document, id).getAttribute("tabindex"), "-1");
    assert.ok(!sequence.includes(byId(document, id)),
      `#${id} must be focusable without being a tab stop`);
  }

  // And Tab from the first door lands on the next one, so the five read in the
  // order they are displayed rather than in the order the markup happened to
  // author them.
  doorFor(document, DEFAULT_DESTINATION).focus();
  assert.equal(pressTab(document), doorFor(document, WORKSPACE_DESTINATION.evidence));
});

/* --------------------------- Enter opens a door ---------------------------- */

test("Enter on a door opens that destination and hands the keyboard to its heading", async () => {
  const { document } = await worked();
  assert.equal(currentWorkspaceDestination(document), DEFAULT_DESTINATION);

  doorFor(document, WORKSPACE_DESTINATION.department).focus();
  pressEnter(document);

  assert.equal(currentWorkspaceDestination(document), WORKSPACE_DESTINATION.department);
  assert.equal(document.activeElement, byId(document, WORKSPACE_SHELL_IDS.screenTitle),
    "Enter moved the screen but left the keyboard on the door it was pressed from");
  assert.equal(byId(document, WORKSPACE_SHELL_IDS.screenTitle).textContent, "Departments");
});

/* --------------------------- Space opens a door ---------------------------- */

test("Space on a door opens that destination and hands the keyboard to its heading", async () => {
  const { document } = await worked();

  const door = doorFor(document, WORKSPACE_DESTINATION.evidence);
  door.focus();
  pressSpace(document);

  assert.equal(currentWorkspaceDestination(document), WORKSPACE_DESTINATION.evidence,
    "Space on a destination door must open it, not scroll the document past it");
  assert.equal(document.activeElement, byId(document, WORKSPACE_SHELL_IDS.screenTitle),
    "Space moved the screen but left the keyboard on the door it was pressed from");
  assert.equal(byId(document, WORKSPACE_SHELL_IDS.screenTitle).textContent, "Evidence");
});

test("Space on a link that is not a door is left to the browser", async () => {
  const { document } = await worked();

  // A deep link into a panel is an ordinary anchor and Space on it must keep
  // doing what Space does on an anchor: scroll. The page proves it did not
  // intercept by leaving the destination and the focus exactly as they were.
  const deep = document.querySelectorAll("a")
    .find((link) => link.getAttribute("href") === "#recommendation-evidence");
  assert.ok(deep, "the page must still ship a deep link to test the guard against");
  deep.focus();
  pressSpace(document);

  assert.equal(currentWorkspaceDestination(document), DEFAULT_DESTINATION);
  assert.equal(document.activeElement, deep);
});

/* ---------------------- one door marked, and the right one ------------------ */

test("exactly one door carries aria-current, on every destination in turn", async () => {
  const { document } = await worked();

  for (const key of Object.values(WORKSPACE_DESTINATION)) {
    doorFor(document, key).focus();
    pressSpace(document);

    const marked = doors(document).filter((link) => link.getAttribute("aria-current") === "true");
    assert.equal(marked.length, 1, `${key} left ${marked.length} doors marked current`);
    assert.equal(marked[0].dataset.destinationKey, key);
    // The mark is on the door whose href is that destination's own address, so
    // the rail, the URL a reader copies, and the screen on show are one fact.
    assert.equal(marked[0].getAttribute("href"), DESTINATION_FRAGMENT[key]);
  }
});

/* ------------------- the destination you left is off the page --------------- */

test("the destinations you are not in are out of the tab order and the a11y tree", async () => {
  const { document } = await worked();

  doorFor(document, WORKSPACE_DESTINATION.department).focus();
  pressSpace(document);

  // `hidden` rather than a stylesheet rule, which is the one mechanism that
  // takes a subtree out of BOTH the accessibility tree and sequential
  // navigation. Asserted on counts, never by comparing a node against null.
  const answerRegions = regionsFor(document, DEFAULT_DESTINATION);
  assert.ok(answerRegions.length > 0, "the answer destination declares no regions to check");
  const shown = answerRegions.filter((region) => region.hidden !== true);
  assert.equal(shown.length, 0,
    `${shown.length} answer region(s) are still rendered on the departments screen`);

  const sequence = tabSequence(document);
  const stranded = answerRegions
    .filter((region) => sequence.some((node) => node.closest("[data-workspace-region]") === region));
  assert.equal(stranded.length, 0,
    `${stranded.length} answer region(s) still hold a tab stop on the departments screen`);

  // And the departments screen itself is on, so the assertion above is about
  // where the reader is rather than about a page that hid everything.
  const departmentRegions = regionsFor(document, WORKSPACE_DESTINATION.department);
  assert.ok(departmentRegions.some((region) => region.hidden !== true),
    "the departments screen hid its own regions too");
});

/* --------------------- the rail ships in the document ---------------------- */

test("the rail is authored in evolution.html, not painted into it", () => {
  // A rail that only exists once a module runs is a rail that is missing on the
  // one load where a reader needs it most. Every door is a real anchor carrying
  // its destination's own address before any script has run.
  for (const fragment of Object.values(DESTINATION_FRAGMENT)) {
    assert.ok(html.includes(`href="${fragment}"`),
      `evolution.html ships no authored door for ${fragment}`);
  }
});
