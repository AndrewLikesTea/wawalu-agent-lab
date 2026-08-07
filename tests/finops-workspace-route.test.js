// One destination at a time, and a rail that agrees with the address bar.
//
// #1328. The shell already showed one destination and hid the rest — with a
// stylesheet rule, which is a statement to a sighted reader and to nobody else.
// A screen-reader user still walked every panel of all five destinations and Tab
// still stopped on every control inside them. These assertions hold the four
// facts that make "one destination at a time" true rather than drawn:
//
//   1. THE CLOSED DESTINATIONS ARE OUT OF THE READING FLOW. `hidden`, on the
//      regions themselves, which is what removes a subtree from the
//      accessibility tree and from sequential navigation. Asserted through
//      `tabSequence`, so it is the tab order that is checked and not an
//      attribute that is merely present.
//   2. THE THREE STATEMENTS AGREE. The rail's current-location label, the
//      destination the address names, and the visible screen heading say the
//      same thing — on a press, after a step back, and on a cold landing
//      straight onto a non-default destination.
//   3. ONE PRESS, ONE SENTENCE. Counted on the live region itself, and the
//      region counted as well, because the failure mode is two speakers as often
//      as it is two writes.
//   4. A DEEP LINK STILL OPENS WHAT IT POINTS AT, and now opens the destination
//      around it first. Focusing a target inside a hidden container is how this
//      change could quietly break the thing #822 fixed.
//
// The window and the History are doubles: the harness has neither, and the shell
// takes both as parameters precisely so this can be driven without a browser.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, tabSequence, textOf } from "./support/browser.js";
import { loadWorkspaceDestinations } from "../src/finops-destination-contract.js";
import { SCREEN_CONTRACT } from "../src/finops-screen-contract.js";
import {
  WORKSPACE_DESTINATION, currentDestination, currentDestinationLabel,
} from "../src/finops-workspace-nav.js";
import { installDeepLinkDisclosure } from "../src/deep-link-disclosure.js";
import {
  DESTINATION_FRAGMENT, HIDDEN_BY, WORKSPACE_SHELL_IDS,
  currentWorkspaceDestination, initWorkspaceShell, regionsFor, workspaceRegions,
  workspaceRouteAddress,
} from "../src/finops-workspace-shell.js";

const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
const loaded = loadWorkspaceDestinations();
const KEYS = Object.values(WORKSPACE_DESTINATION);
const byId = (doc, id) => doc.getElementById(id);
const nameOf = (key) => SCREEN_CONTRACT.find((entry) => entry.shellDestination === key).name;

/**
 * A window with a real Location, a real History and real listeners.
 *
 * `pushState` records the entry and moves the address, exactly as a browser
 * does, so a test can assert that a step back pushed nothing and that the
 * address the shell wrote is the one it then reads back.
 */
function fakeWindow(url = "/evolution.html") {
  const listeners = new Map();
  const win = {
    location: { pathname: "/evolution.html", search: "", hash: "" },
    entries: [],
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== handler));
    },
    /** What the browser does on back and forward: move the address, then fire. */
    go(address, type = "popstate") {
      win.at(address);
      for (const handler of listeners.get(type) ?? []) handler();
    },
    at(address) {
      const [before, hash = ""] = String(address).split("#");
      const [pathname, search = ""] = before.split("?");
      win.location.pathname = pathname || "/evolution.html";
      win.location.search = search ? `?${search}` : "";
      win.location.hash = hash ? `#${hash}` : "";
      return win.location;
    },
  };
  win.history = {
    pushState(state, _title, next) {
      win.entries.push({ state, next });
      win.at(next);
    },
  };
  win.at(url);
  return win;
}

function booted(url = "/evolution.html") {
  const document = parseHtml(html);
  const win = fakeWindow(url);
  const shell = initWorkspaceShell(document, {
    win, loaded, history: win.history, location: win.location,
  });
  return { document, win, shell };
}

const doorFor = (doc, key) => byId(doc, WORKSPACE_SHELL_IDS.switchList)
  .querySelectorAll("[data-shell-destination]")
  .find((door) => door.dataset.shellDestination === key);

const announceCount = (doc) =>
  Number(byId(doc, WORKSPACE_SHELL_IDS.live).getAttribute("data-announce-count") ?? 0);

/** Every focusable inside any region belonging to a destination other than `key`. */
function strandedTabStops(doc, key) {
  const closed = new Set(workspaceRegions(doc)
    .filter((region) => region.dataset.workspaceRegion !== key));
  return tabSequence(doc).filter((node) => {
    let current = node;
    while (current) {
      if (closed.has(current)) return true;
      current = current.parentNode;
    }
    return false;
  });
}

/* --------------------- one destination in the reading flow ----------------- */

test("switching destinations takes the previous one out of the reading flow", () => {
  const { document } = booted();

  doorFor(document, WORKSPACE_DESTINATION.department).click();

  for (const region of regionsFor(document, WORKSPACE_DESTINATION.department)) {
    assert.notEqual(region.getAttribute("data-workspace-hidden"), HIDDEN_BY.shell,
      `${region.id} is in the open destination and still held back by the shell`);
  }
  // The destination the reader left is `hidden`, region by region, and says
  // whose hiding it is. A region the authored document already ships hidden is
  // holding its OWN empty state and is marked `panel`; everything else was held
  // back by this switch and is marked `shell`, which is what the print sheet
  // restores and what re-opening the destination reveals.
  const authored = parseHtml(html);
  const left = regionsFor(document, WORKSPACE_DESTINATION.evidence);
  assert.ok(left.length > 0);
  let heldBack = 0;
  for (const region of left) {
    assert.equal(region.hidden, true, `${region.id} stayed in the flow after the switch`);
    const own = byId(authored, region.id)?.hidden ?? false;
    assert.equal(region.getAttribute("data-workspace-hidden"),
      own ? HIDDEN_BY.panel : HIDDEN_BY.shell, `${region.id} attributes its hiding to the wrong owner`);
    if (!own) heldBack += 1;
  }
  assert.ok(heldBack > 0, "the switch held nothing back, so nothing can be restored on paper");
  assert.equal(strandedTabStops(document, WORKSPACE_DESTINATION.department).length, 0,
    "Tab still stops inside a destination that is not open");
});

test("a cold open leaves no closed destination in the tab order", () => {
  const { document } = booted();
  assert.equal(strandedTabStops(document, WORKSPACE_DESTINATION.answer).length, 0,
    "the page opens with every destination's controls still tabbable");
  // And the frame is never held back: it carries the heading, the answer and the
  // way between destinations, so it is reachable from every destination.
  for (const frame of document.querySelectorAll("[data-workspace-frame]")) {
    assert.equal(frame.getAttribute("data-workspace-hidden"), null,
      `${frame.id} is frame chrome and was hidden as though it were a destination`);
  }
  assert.equal(byId(document, "finops-front-door").hidden, false,
    "the front door is not reachable from the destination the page opens in");
});

test("a panel holding its own empty state is never revealed by opening its destination", () => {
  const { document } = booted();
  // `#graded-sample` ships hidden: nobody has imported a sample. Opening the
  // destination it belongs to must not present an empty panel as evidence.
  const sample = byId(document, "graded-sample");
  assert.equal(sample.dataset.workspaceRegion, WORKSPACE_DESTINATION.evidence);
  doorFor(document, WORKSPACE_DESTINATION.evidence).click();
  assert.equal(sample.hidden, true, "an empty panel was shown as though it had content");
  assert.equal(sample.getAttribute("data-workspace-hidden"), HIDDEN_BY.panel);
});

/* ------------------- the rail, the address and the heading ----------------- */

/** The three statements #1328 requires to agree, read off the live document. */
const stated = (doc, win) => ({
  rail: currentDestinationLabel(doc),
  address: win.location.hash,
  heading: textOf(byId(doc, WORKSPACE_SHELL_IDS.screenTitle)),
});

test("the rail label, the address and the visible heading agree on a press", () => {
  const { document, win } = booted();
  for (const key of [WORKSPACE_DESTINATION.evidence, WORKSPACE_DESTINATION.actAndVerify]) {
    doorFor(document, key).click();
    assert.deepEqual(stated(document, win), {
      rail: nameOf(key), address: DESTINATION_FRAGMENT[key], heading: nameOf(key),
    }, `the rail, the URL and the heading disagree after opening ${key}`);
    assert.equal(currentDestination(document), key);
    assert.equal(currentWorkspaceDestination(document), key);
  }
});

test("landing directly on a non-default destination renders it, with no interaction", () => {
  for (const key of KEYS.filter((entry) => entry !== WORKSPACE_DESTINATION.answer)) {
    const { document, win } = booted(`/evolution.html${DESTINATION_FRAGMENT[key]}`);
    assert.deepEqual(stated(document, win), {
      rail: nameOf(key), address: DESTINATION_FRAGMENT[key], heading: nameOf(key),
    }, `a forwarded link onto ${key} did not arrive there`);
    // Focus is on the screen's heading, and the destination is genuinely open.
    assert.equal(document.activeElement, byId(document, WORKSPACE_SHELL_IDS.screenTitle));
    assert.equal(strandedTabStops(document, key).length, 0);
    assert.equal(announceCount(document), 1, "arriving said nothing, or said it twice");
    // Nothing was pushed: the reader is on the address they opened.
    assert.equal(win.entries.length, 0, "a cold landing wrote a history entry");
  }
});

test("browser back returns to the prior destination without pushing an entry", () => {
  const { document, win } = booted();

  doorFor(document, WORKSPACE_DESTINATION.evidence).click();
  doorFor(document, WORKSPACE_DESTINATION.department).click();
  assert.equal(win.entries.length, 2, "two presses did not write two history entries");
  const pushed = announceCount(document);

  // Back: the browser moves the address and fires `popstate`. Nothing may push.
  win.go(`/evolution.html${DESTINATION_FRAGMENT[WORKSPACE_DESTINATION.evidence]}`);

  assert.deepEqual(stated(document, win), {
    rail: nameOf(WORKSPACE_DESTINATION.evidence),
    address: DESTINATION_FRAGMENT[WORKSPACE_DESTINATION.evidence],
    heading: nameOf(WORKSPACE_DESTINATION.evidence),
  }, "a step back left the reader on content the address no longer describes");
  assert.equal(document.activeElement, byId(document, WORKSPACE_SHELL_IDS.screenTitle),
    "a step back repainted without handing anyone the keyboard");
  assert.equal(win.entries.length, 2, "restoring state wrote state");
  assert.equal(announceCount(document), pushed + 1, "a step back announced twice, or not at all");
});

test("the route is written through the serializer, so other parameters survive", () => {
  // #1326's own address, carried across a move between workspace destinations,
  // plus a parameter belonging to somebody else. Neither may be dropped by a
  // control that only knew about fragments.
  const { document, win } = booted(
    "/evolution.html?destination=spend-attribution&department=backend&utm=mail");
  doorFor(document, WORKSPACE_DESTINATION.actAndVerify).click();

  assert.equal(win.location.search, "?destination=spend-attribution&department=backend&utm=mail");
  assert.equal(win.location.hash, DESTINATION_FRAGMENT[WORKSPACE_DESTINATION.actAndVerify]);
  assert.equal(win.entries.at(-1).next,
    `/evolution.html?destination=spend-attribution&department=backend&utm=mail${
      DESTINATION_FRAGMENT[WORKSPACE_DESTINATION.actAndVerify]}`);

  // The serializer is the one that answered, so a qualifier the destination does
  // not carry is dropped rather than round-tripped as junk.
  assert.equal(
    workspaceRouteAddress(
      { pathname: "/evolution.html", search: "?destination=commitment-coverage&scope=month", hash: "" },
      WORKSPACE_DESTINATION.evidence),
    `/evolution.html?destination=commitment-coverage${
      DESTINATION_FRAGMENT[WORKSPACE_DESTINATION.evidence]}`);
});

/* --------------------------- exactly one sentence -------------------------- */

test("a destination change is announced exactly once, by one region", () => {
  const { document } = booted();
  assert.equal(announceCount(document), 0, "a cold open announced a destination nobody chose");

  doorFor(document, WORKSPACE_DESTINATION.department).click();
  assert.equal(announceCount(document), 1, "one press did not produce exactly one sentence");
  assert.match(textOf(byId(document, WORKSPACE_SHELL_IDS.live)), /^Showing Departments\./);

  // The same door again is not a change, and a press is not two writes.
  doorFor(document, WORKSPACE_DESTINATION.department).click();
  assert.equal(announceCount(document), 1, "re-opening the open destination spoke again");

  doorFor(document, WORKSPACE_DESTINATION.evidence).click();
  assert.equal(announceCount(document), 2);

  // ONE SPEAKER, structurally. Two polite regions describing one press is how a
  // screen-reader user learns to ignore both, so the count of regions is held
  // here as well as the count of writes.
  const polite = document.querySelectorAll("[aria-live]")
    .filter((node) => node.getAttribute("aria-live") === "polite"
      && node.closest("[data-workspace-frame]")?.id === "finops-workspace-switch");
  assert.equal(polite.length, 1, "the switch grew a second live region");
  assert.equal(polite[0].id, WORKSPACE_SHELL_IDS.live);
});

/* ------------------------ the deep link still opens ------------------------ */

test("a deep link opens its collapsed panel before focus, inside the open destination", () => {
  const { document, win } = booted();
  installDeepLinkDisclosure(document, win);
  doorFor(document, WORKSPACE_DESTINATION.evidence).click();

  const disclosure = byId(document, "disclosure-recommendation-evidence");
  assert.equal(disclosure.hasAttribute("open"), false, "the panel was already open");

  const link = document.createElement("a");
  link.setAttribute("href", "#recommendation-evidence");
  byId(document, "finops-workspace-screen").append(link);
  link.click();

  assert.equal(disclosure.hasAttribute("open"), true,
    "focus was sent to a target still folded inside a collapsed panel");
  assert.equal(document.activeElement?.id, "recommendation-evidence");
});

test("a deep link into another destination activates it first, then opens and focuses", () => {
  const { document, win } = booted();
  installDeepLinkDisclosure(document, win);
  assert.equal(currentWorkspaceDestination(document), WORKSPACE_DESTINATION.answer);

  const target = byId(document, "spend-mix-panel");
  const disclosure = target.closest("[data-workspace-region]");
  assert.equal(disclosure.dataset.workspaceRegion, WORKSPACE_DESTINATION.department);
  assert.equal(disclosure.hidden, true, "a closed destination's panel was in the reading flow");

  const link = document.createElement("a");
  link.setAttribute("href", "#spend-mix-panel");
  byId(document, "finops-workspace-screen").append(link);
  link.click();

  // The destination, then the panel, then the keyboard — in that order, because
  // a target inside a hidden container cannot be focused at all.
  assert.equal(currentWorkspaceDestination(document), WORKSPACE_DESTINATION.department);
  assert.equal(disclosure.hidden, false, "the target is still inside a hidden container");
  assert.equal(disclosure.hasAttribute("open"), true);
  assert.equal(document.activeElement?.id, "spend-mix-panel");
  // It moved the reader between destinations, so it said so — once.
  assert.equal(announceCount(document), 1);
  assert.equal(currentDestinationLabel(document), nameOf(WORKSPACE_DESTINATION.department));
});
