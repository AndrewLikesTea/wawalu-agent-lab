// The AI FinOps workspace shell: one destination on screen, the answer first, and
// a URL that can be shared and walked back.
//
// WHAT THESE ASSERTIONS ARE FOR.
//
//   * NOT A MONOLITH ON OPEN. The defect was a fifteen-hundred-line document that
//     rendered every panel at once. The first test here fails if a cold open shows
//     panels from more than one destination.
//   * NOTHING WAS DROPPED IN THE SPLIT. Every region of this page belongs to
//     exactly one destination, and every panel a reader could work through before
//     is still reachable — asserted by resolving the panel's own fragment, which
//     is what a saved link or a rail door actually carries.
//   * THE CONTROLS SWITCH, and the switch is a word plus `aria-current`, never a
//     fill.
//   * THE URL IS THE STATE. An owned fragment selects a destination; back and
//     forward repaint; and an unknown fragment changes nothing at all, because a
//     stale shared link is a link to this page and not an instruction to empty it.
//
// No clock, no network, no sleeps. The end-to-end case boots the shipped page
// entry, so a shell that is never wired into the page fails here.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, parseHtml, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { loadWorkspaceDestinations } from "../src/finops-destination-contract.js";
import {
  DESTINATION_STATE_LABEL, WORKSPACE_DESTINATION, WORKSPACE_NAV_IDS,
} from "../src/finops-workspace-nav.js";
import {
  CONTEXT_TERMS, DESTINATION_FRAGMENT, WORKSPACE_SHELL_IDS,
  applyWorkspaceDestination, currentWorkspaceDestination, destinationForFragment,
  initWorkspaceShell, paintWorkspaceContext, regionsFor, workspaceRegions,
} from "../src/finops-workspace-shell.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const loaded = loadWorkspaceDestinations();
const KEYS = Object.values(WORKSPACE_DESTINATION);

const byId = (doc, id) => doc.getElementById(id);
// #819 retired the shell's own switcher: the rail is the one control, so these
// read its doors. A second list of the same four destinations is the defect.
const doors = (doc) => byId(doc, WORKSPACE_NAV_IDS.list).querySelectorAll("[data-destination-key]");
const doorFor = (doc, key) => doors(doc).find((door) => door.dataset.destinationKey === key);
const live = (doc) => textOf(byId(doc, WORKSPACE_NAV_IDS.live));
const activeKeys = (doc) => new Set(workspaceRegions(doc)
  .filter((region) => region.dataset.workspaceActive === "true")
  .map((region) => region.dataset.workspaceRegion));

/** A window whose hash a test can move, with real listeners. */
function fakeWindow(hash = "") {
  const listeners = new Map();
  return {
    location: { hash },
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      listeners.set(type, (listeners.get(type) ?? []).filter((entry) => entry !== handler));
    },
    /** What a browser does when a fragment link is followed, or back is pressed. */
    go(hash, type = "hashchange") {
      this.location.hash = hash;
      for (const handler of listeners.get(type) ?? []) handler();
    },
  };
}

async function shelled(hash = "") {
  const document = parseHtml(html);
  const win = fakeWindow(hash);
  const shell = initWorkspaceShell(document, { win, loaded });
  return { document, win, shell };
}

/* ------------------------------- the split -------------------------------- */

test("a cold open shows the answer only, not every panel at once", async () => {
  const { document, shell } = await shelled();

  assert.equal(shell.destination, WORKSPACE_DESTINATION.answer);
  assert.deepEqual([...activeKeys(document)], [WORKSPACE_DESTINATION.answer],
    "a cold open renders panels from more than one destination");
  const inactive = workspaceRegions(document)
    .filter((region) => region.dataset.workspaceActive === "false");
  assert.ok(inactive.length >= 3 * 3,
    `only ${inactive.length} regions were held back, so the page still opens as a monolith`);
  // The frame is never held back: it carries the heading, the answer, the status,
  // and the way between destinations.
  for (const frame of document.querySelectorAll("[data-workspace-frame]")) {
    assert.equal(frame.dataset.workspaceActive, undefined,
      `${frame.id || frame.className} is both frame and destination content`);
  }
});

test("every region of this page belongs to exactly one destination", () => {
  const document = parseHtml(html);
  const regions = workspaceRegions(document);
  assert.ok(regions.length >= 20, `only ${regions.length} regions were assigned`);
  for (const region of regions) {
    assert.ok(KEYS.includes(region.dataset.workspaceRegion),
      `${region.id || region.className} claims destination "${region.dataset.workspaceRegion}"`);
    assert.equal(region.getAttribute("data-workspace-frame"), null,
      `${region.id || region.className} is declared as frame and as destination content`);
    assert.equal(region.closest("[data-workspace-region]"), region,
      `${region.id || region.className} is nested inside another region`);
  }
  // Every destination has content. A named door onto nothing is worse than no
  // door: the reader presses it and concludes the page is broken.
  for (const key of KEYS) {
    assert.ok(regionsFor(document, key).length > 0, `destination ${key} holds no panel`);
  }
  // The commitment surface belongs with the acting, not with the evidence.
  assert.equal(byId(document, "disclosure-savings-portfolio").dataset.workspaceRegion,
    WORKSPACE_DESTINATION.actAndVerify);
  assert.equal(byId(document, "savings-portfolio-panel").closest("[data-workspace-region]").id,
    "disclosure-savings-portfolio");
});

test("every workflow that was reachable before is still reachable, by its own fragment", () => {
  const document = parseHtml(html);
  // Each of these is a panel a reader worked through on the monolith. The value
  // is the destination it now lives in; resolving the fragment is exactly what a
  // saved link, a rail door, and this page's own cross-panel links do.
  const expected = {
    "finops-first-run": WORKSPACE_DESTINATION.answer,
    "finops-destinations": WORKSPACE_DESTINATION.answer,
    "guided-result": WORKSPACE_DESTINATION.answer,
    "local-results": WORKSPACE_DESTINATION.answer,
    "workspace-restore": WORKSPACE_DESTINATION.answer,
    "restored-briefing": WORKSPACE_DESTINATION.answer,
    "import-mapping": WORKSPACE_DESTINATION.answer,
    "score-card": WORKSPACE_DESTINATION.evidence,
    "finops-headline": WORKSPACE_DESTINATION.evidence,
    "kpi-row": WORKSPACE_DESTINATION.evidence,
    "graded-sample": WORKSPACE_DESTINATION.evidence,
    "spend-per-delivery": WORKSPACE_DESTINATION.evidence,
    "recommendation-evidence": WORKSPACE_DESTINATION.evidence,
    "department-decision-panel": WORKSPACE_DESTINATION.department,
    "department-evidence": WORKSPACE_DESTINATION.department,
    "department-fix-pack": WORKSPACE_DESTINATION.department,
    "spend-mix-panel": WORKSPACE_DESTINATION.department,
    "savings-portfolio-panel": WORKSPACE_DESTINATION.actAndVerify,
    "prompt-coaching": WORKSPACE_DESTINATION.actAndVerify,
    "finops-contact": WORKSPACE_DESTINATION.actAndVerify,
  };
  for (const [id, key] of Object.entries(expected)) {
    assert.ok(byId(document, id), `${id} is no longer on the page at all`);
    assert.equal(destinationForFragment(document, `#${id}`), key,
      `#${id} no longer resolves to ${key}`);
  }
});

/* ------------------------------ the fragments ------------------------------ */

test("an owned fragment opens its destination on a cold load", async () => {
  for (const key of KEYS) {
    const { document } = await shelled(DESTINATION_FRAGMENT[key]);
    assert.deepEqual([...activeKeys(document)], [key],
      `${DESTINATION_FRAGMENT[key]} did not open ${key}`);
    assert.equal(currentWorkspaceDestination(document), key);
  }
});

test("a fragment this page does not own leaves the destination alone", async () => {
  const { document, win } = await shelled("#not-a-thing-on-this-page");
  assert.deepEqual([...activeKeys(document)], [WORKSPACE_DESTINATION.answer],
    "an unknown fragment changed what was on screen");

  applyWorkspaceDestination(document, WORKSPACE_DESTINATION.evidence);
  win.go("#also-not-a-thing");
  assert.deepEqual([...activeKeys(document)], [WORKSPACE_DESTINATION.evidence],
    "an unknown fragment emptied the destination the reader was working in");
  assert.equal(destinationForFragment(document, "#also-not-a-thing"), null);
  assert.equal(destinationForFragment(document, "/savings-action-center.html"), null,
    "an off-page href was read as a destination");
});

test("back and forward walk the destinations", async () => {
  const { document, win } = await shelled();

  win.go(DESTINATION_FRAGMENT[WORKSPACE_DESTINATION.department]);
  assert.deepEqual([...activeKeys(document)], [WORKSPACE_DESTINATION.department]);
  win.go(DESTINATION_FRAGMENT[WORKSPACE_DESTINATION.actAndVerify]);
  assert.deepEqual([...activeKeys(document)], [WORKSPACE_DESTINATION.actAndVerify]);

  // Back, twice: the same derivation runs for `popstate`, so a step back never
  // leaves the reader on content the address bar no longer describes.
  win.go(DESTINATION_FRAGMENT[WORKSPACE_DESTINATION.department], "popstate");
  assert.deepEqual([...activeKeys(document)], [WORKSPACE_DESTINATION.department]);
  // Back to the bare URL is back to the answer — the destination a cold load of
  // that same URL opens. Anything else leaves the address bar describing one
  // destination while another is on screen.
  win.go("", "popstate");
  assert.deepEqual([...activeKeys(document)], [WORKSPACE_DESTINATION.answer],
    "the bare URL and a cold load of it disagree about which destination it names");
});

/* ------------------------------- the controls ------------------------------ */

test("pressing a control switches the destination, in a word and in aria-current", async () => {
  const { document } = await shelled();
  const door = doorFor(document, WORKSPACE_DESTINATION.actAndVerify);

  // A real anchor with a real href, so the fragment reaches the address bar and
  // the entry reaches session history. It points at a panel on this page rather
  // than at a fragment nothing renders: #819 brought act-and-verify in-page.
  assert.equal(door.tagName, "A");
  assert.equal(door.getAttribute("href"), "#savings-portfolio-panel");

  door.click();

  assert.deepEqual([...activeKeys(document)], [WORKSPACE_DESTINATION.actAndVerify],
    "the control did not switch what is on screen");
  assert.equal(door.getAttribute("aria-current"), "true");
  assert.ok(textOf(door).includes(DESTINATION_STATE_LABEL.current),
    `the open destination is not stated in words: "${textOf(door)}"`);
  for (const other of doors(document).filter((entry) => entry !== door)) {
    assert.equal(other.getAttribute("aria-current"), null,
      "two controls claim to be the open destination");
    assert.ok(!textOf(other).includes(DESTINATION_STATE_LABEL.current));
  }
});

test("the shell says nothing on load and leaves the press to the rail to announce", async () => {
  const { document } = await shelled();
  assert.equal(live(document), "",
    "a destination the reader did not choose was announced");

  // The shell's capture-phase listener switches first; the rail's own handler
  // runs on the way back up and is the one that speaks, because it knows where
  // it put the keyboard. One press, one sentence, one live region.
  const railDoor = doorFor(document, WORKSPACE_DESTINATION.department);
  railDoor.click();
  assert.deepEqual([...activeKeys(document)], [WORKSPACE_DESTINATION.department],
    "a rail door no longer switches the destination it points into");
  assert.equal(live(document), "", "the shell announced a press the rail owns");
});

/* --------------------------- the carried figures --------------------------- */

test("the five figures a leader is judging against survive leaving the answer", async () => {
  const { document } = await shelled();
  const context = byId(document, WORKSPACE_SHELL_IDS.context);
  assert.equal(context.hidden, true, "the answer shows the brief and a copy of it");

  applyWorkspaceDestination(document, WORKSPACE_DESTINATION.evidence);
  assert.equal(context.hidden, false, "leaving the answer left the figures behind");
  assert.equal(context.dataset.state, "ready");
  const terms = byId(document, WORKSPACE_SHELL_IDS.contextList)
    .querySelectorAll("dt").map((term) => textOf(term));
  assert.deepEqual(terms, [...CONTEXT_TERMS]);
  const carried = textOf(context);
  assert.ok(carried.includes("33.2%"), `the benchmark share is not carried: ${carried}`);
  assert.ok(carried.includes("51,254 USD"), "the impact figure is not carried");
  assert.ok(carried.includes("moderate"), "the confidence band is not carried");
  assert.ok(carried.includes(loaded.record.finding.whyItMatters), "why it matters is not carried");
  assert.ok(carried.includes(loaded.record.finding.provenance.sourceLabel),
    "the provenance is not carried");
});

test("a record that failed its contract carries a labelled unavailable state, not a figure", () => {
  const document = parseHtml(html);
  paintWorkspaceContext(document, { valid: false, record: null, errors: ["benchmark: missing"] });
  const context = byId(document, WORKSPACE_SHELL_IDS.context);
  assert.equal(context.dataset.state, "unavailable");
  assert.match(textOf(context), /Unavailable —/);
  assert.ok(!/USD/.test(textOf(context)), "an unvalidated figure was carried anyway");
});

/* --------------------------------- the page -------------------------------- */

test("the shipped page entry brings the shell up, before the rail is bound", async () => {
  const entry = await readFile(new URL("../src/evolution-page.js", import.meta.url), "utf8");
  assert.match(entry, /import \{ initWorkspaceShell \} from "\/finops-workspace-shell\.js";/,
    "the shipped page entry does not load the shell");
  const shell = entry.indexOf("initWorkspaceShell(document");
  const rail = entry.indexOf("bindWorkspaceNav(document)");
  assert.ok(shell > 0, "the shipped page entry never brings the shell up");
  assert.ok(shell < rail,
    "the shell is brought up after the rail is bound, so a door moves focus into a hidden region");

  // And the markup it drives is the shipped markup: ONE control, four doors, in
  // contract order, each resolving to the destination it names.
  const document = parseHtml(html);
  assert.deepEqual(
    doors(document).map((door) => destinationForFragment(document, door.getAttribute("href"))),
    KEYS, "the one control no longer lists the four destinations in order");
});
