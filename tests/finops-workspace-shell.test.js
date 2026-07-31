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

import { loadPage, parseHtml, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { loadWorkspaceDestinations } from "../src/finops-destination-contract.js";
import { SCREEN_CONTRACT } from "../src/finops-screen-contract.js";
import { WORKSPACE_DESTINATION } from "../src/finops-workspace-nav.js";
import {
  CONTEXT_TERMS, DESTINATION_FRAGMENT, SHELL_STATE_LABEL, WORKSPACE_SHELL_IDS,
  applyWorkspaceDestination, currentWorkspaceDestination, destinationForFragment,
  initWorkspaceShell, paintWorkspaceContext, regionsFor, workspaceRegions,
} from "../src/finops-workspace-shell.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const cssText = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
const sharedCss = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const loaded = loadWorkspaceDestinations();
const KEYS = Object.values(WORKSPACE_DESTINATION);

const byId = (doc, id) => doc.getElementById(id);
const doors = (doc) => byId(doc, WORKSPACE_SHELL_IDS.switchList)
  .querySelectorAll("[data-shell-destination]");
const doorFor = (doc, key) => doors(doc).find((door) => door.dataset.shellDestination === key);
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
  win.go("", "popstate");
  assert.deepEqual([...activeKeys(document)], [WORKSPACE_DESTINATION.department],
    "returning to the bare page emptied the destination instead of leaving it");
});

/* ------------------------------- the controls ------------------------------ */

test("pressing a control switches the destination, in a word and in aria-current", async () => {
  const { document } = await shelled();
  const door = doorFor(document, WORKSPACE_DESTINATION.actAndVerify);

  // A real anchor with a real href, so the fragment reaches the address bar and
  // the entry reaches session history.
  assert.equal(door.tagName, "A");
  assert.equal(door.getAttribute("href"), DESTINATION_FRAGMENT[WORKSPACE_DESTINATION.actAndVerify]);

  door.click();

  assert.deepEqual([...activeKeys(document)], [WORKSPACE_DESTINATION.actAndVerify],
    "the control did not switch what is on screen");
  assert.equal(door.getAttribute("aria-current"), "true");
  assert.ok(textOf(door).includes(SHELL_STATE_LABEL.current),
    `the open destination is not stated in words: "${textOf(door)}"`);
  for (const other of doors(document).filter((entry) => entry !== door)) {
    assert.equal(other.getAttribute("aria-current"), null,
      "two controls claim to be the open destination");
    assert.ok(!textOf(other).includes(SHELL_STATE_LABEL.current));
  }
  assert.match(textOf(byId(document, WORKSPACE_SHELL_IDS.live)), /^Showing Act and verify\. \d+ panels?\./);
});

test("the shell says nothing on load and nothing for a rail door", async () => {
  const { document } = await shelled();
  assert.equal(textOf(byId(document, WORKSPACE_SHELL_IDS.live)), "",
    "the shell announced a destination the reader did not choose");

  // The rail's doors point at panels rather than at the shell's own fragments.
  // They still switch — but the rail announces them, and two live regions
  // describing one press is how a reader learns to ignore both.
  const railDoor = byId(document, "finops-workspace-nav-list")
    .querySelectorAll("a").find((link) => link.getAttribute("href") === "#department-decision-panel");
  assert.ok(railDoor, "the rail no longer carries a door to the department panel");
  railDoor.click();
  assert.deepEqual([...activeKeys(document)], [WORKSPACE_DESTINATION.department],
    "a rail door no longer switches the destination it points into");
  assert.equal(textOf(byId(document, WORKSPACE_SHELL_IDS.live)), "");
});

/* ------------------------- the keyboard and the voice ---------------------- */

// #822. A switch that only repaints is one a sighted reader has already used and
// everyone else is still hunting for. Four things are held here, and each one is
// a way the switch could look correct and be unusable off a mouse.

test("a destination change lands the keyboard on the new screen's heading, and says where", async () => {
  const { document } = await shelled();
  const heading = byId(document, WORKSPACE_SHELL_IDS.screenTitle);
  const contract = SCREEN_CONTRACT.find((entry) => entry.shellDestination
    === WORKSPACE_DESTINATION.department);

  doorFor(document, WORKSPACE_DESTINATION.department).click();

  // Not `<body>`, not the top of the document, not the control that was pressed:
  // the heading of the screen that is now on.
  assert.equal(document.activeElement, heading,
    `the change left focus on ${document.activeElement?.id || document.activeElement?.tagName
      || "nothing"}`);
  assert.equal(textOf(heading), contract.name);
  assert.equal(textOf(byId(document, WORKSPACE_SHELL_IDS.screenQuestion)), contract.question);
  assert.equal(byId(document, WORKSPACE_SHELL_IDS.screen).dataset.destination,
    WORKSPACE_DESTINATION.department);

  // A heading is not a tab stop. Focus was moved there; it was not inserted into
  // the sequence for everyone to Tab past on every pass.
  assert.equal(heading.getAttribute("tabindex"), "-1");
  assert.ok(!tabSequence(document).includes(heading));

  // The live region carries the destination NAME and the question that screen
  // answers — not a bare "changed", and not a sentence assembled at announce
  // time in a container that did not exist a moment ago.
  const live = byId(document, WORKSPACE_SHELL_IDS.live);
  assert.equal(live.getAttribute("aria-live"), "polite");
  assert.ok(textOf(live).includes(contract.name), `the destination is not named: "${textOf(live)}"`);
  assert.ok(textOf(live).includes(contract.question),
    `the question this screen answers is not announced: "${textOf(live)}"`);
});

test("the live region and the heading are in the shipped document before anything changes", () => {
  // A live region created at announce time is one a screen reader was never
  // watching, and a heading created when data resolves is a focus target that is
  // not there on the slow load it exists for. Both are asserted against the
  // authored markup, with no script having run.
  const document = parseHtml(html);
  const live = byId(document, WORKSPACE_SHELL_IDS.live);
  assert.equal(live.getAttribute("aria-live"), "polite");
  assert.equal(textOf(live), "", "the region ships with a sentence nobody asked for");
  const heading = byId(document, WORKSPACE_SHELL_IDS.screenTitle);
  assert.equal(heading.getAttribute("tabindex"), "-1");
  assert.equal(heading.getAttribute("aria-describedby"), WORKSPACE_SHELL_IDS.screenQuestion);
  assert.ok(textOf(heading).length > 0, "the authored focus target announces as blank");
});

test("focus is never left on a control the switch has just unrendered", async () => {
  const { document } = await shelled(DESTINATION_FRAGMENT[WORKSPACE_DESTINATION.evidence]);
  // A reader standing inside the outgoing screen — the shape of this is a retry
  // button, a disclosure summary, any control in a region about to go.
  const standing = byId(document, "destination-retry-evidence");
  assert.equal(standing.closest("[data-workspace-region]").dataset.workspaceRegion,
    WORKSPACE_DESTINATION.evidence);
  standing.focus();

  applyWorkspaceDestination(document, WORKSPACE_DESTINATION.department);

  assert.equal(document.activeElement, byId(document, WORKSPACE_SHELL_IDS.screenTitle),
    "focus was left inside a region that is no longer rendered");
  assert.notEqual(document.activeElement, document.body);
});

test("the heading names the destination in the loading, empty and errored states alike", async () => {
  // The heading is painted from the screen contract, which is authored copy —
  // not from a destination's dataset, which may be in flight, empty, or failed.
  // So it is asserted with no module loaded at all: the loader below never
  // resolves, which is exactly the slow load a focus target has to survive.
  const stalled = {
    stateOf: () => "loading", value: () => null, readyKeys: () => [], seed: () => {},
    load: () => new Promise(() => {}),
  };
  const document = parseHtml(html);
  for (const key of KEYS) {
    applyWorkspaceDestination(document, key, { announce: true, loader: stalled });
    const contract = SCREEN_CONTRACT.find((entry) => entry.shellDestination === key);
    const spoken = textOf(byId(document, WORKSPACE_SHELL_IDS.screenTitle));
    assert.equal(spoken, contract.name, `${key} announces "${spoken}" while it is still loading`);
    assert.doesNotMatch(spoken, /undefined|null|^\s*$/);
    assert.ok(textOf(byId(document, WORKSPACE_SHELL_IDS.live)).includes(contract.question),
      `${key} announced no question while its module was in flight`);
  }
  // And the region that reports the wait is on screen, not a blank pane.
  assert.equal(byId(document, "destination-load-act-and-verify").hidden, false);
});

test("a forwarded link onto a non-default screen arrives with focus and a sentence", async () => {
  const { document } = await shelled(DESTINATION_FRAGMENT[WORKSPACE_DESTINATION.actAndVerify]);
  assert.equal(document.activeElement, byId(document, WORKSPACE_SHELL_IDS.screenTitle),
    "a link forwarded into a screen opened it and left the keyboard at the document top");
  assert.ok(textOf(byId(document, WORKSPACE_SHELL_IDS.live)).includes("Act and verify"));

  // An ordinary cold open is still silent and still moves nothing: the reader
  // did not ask to be anywhere but the top of the page they typed in.
  const { document: cold } = await shelled();
  assert.equal(cold.activeElement, null);
  assert.equal(textOf(byId(cold, WORKSPACE_SHELL_IDS.live)), "");
});

test("the open destination is told apart by more than a hue, and every door takes a ring", () => {
  const css = cssText;
  const rule = (selector) => {
    const found = css.match(new RegExp(
      `^${selector.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`)} \\{([^}]*)\\}`, "m"));
    assert.ok(found, `evolution.css does not style ${selector}`);
    return found[1];
  };
  const luminance = (hex) => {
    const channels = (hex.length === 4
      ? [...hex.slice(1)].map((digit) => parseInt(digit + digit, 16))
      : [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16))).map((v) => v / 255);
    const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
  };
  const token = (name) => {
    const found = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{3,8})`, "i"));
    assert.ok(found, `evolution.css declares no --${name}`);
    return found[1];
  };

  // Weight, a second border, and a rule under the word — three channels beside
  // the word "Showing" in the markup and `aria-current` in the tree. Take the
  // hue away and the open destination is still the one that is obviously open.
  const current = rule('.workspace-switch-door[data-shell-current="true"]');
  assert.match(current, /font-weight:\s*800/);
  assert.match(current, /text-decoration:\s*underline/);
  assert.match(current, /border-width:\s*2px/);
  // And no rule scopes the ring away from the selected door: it is declared on
  // the door, not on the unselected door.
  assert.match(rule(".workspace-switch-door:focus-visible"),
    /outline:\s*3px solid var\(--focus-ring\)/);
  assert.match(rule(".workspace-screen-title:focus-visible"),
    /outline:\s*3px solid var\(--focus-ring\)/);
  // A 44px target, the size the rail's own doors already ship.
  assert.match(rule(".workspace-switch-door"), /min-height:\s*44px/);
  // Four doors on a 320px column wrap and shrink rather than push sideways.
  assert.match(rule(".workspace-switch-list"), /flex-wrap:\s*wrap/);
  for (const property of [/min-width:\s*0/, /overflow-wrap:\s*anywhere/]) {
    assert.match(rule(".workspace-switch-door"), property);
  }

  // Both states, against the surface each one actually sits on. The ring token
  // is declared on the shared sheet, so it is resolved from there.
  const ring = sharedCss.match(/--focus-ring:\s*(#[0-9a-f]{3,8})/i)?.[1];
  assert.ok(ring, "styles.css declares no --focus-ring");
  for (const [what, foreground, background, floor] of [
    ["unselected door", "#22221f", "#fff", 4.5],
    ["selected door", "#22221f", "#fff", 4.5],
    ["the Showing chip", token("import-ink"), token("import-wash"), 4.5],
    ["the screen question", token("ink-muted"), "#fff", 4.5],
    ["the focus ring", ring, "#fff", 3],
  ]) {
    const measured = ratio(foreground, background);
    assert.ok(measured >= floor,
      `${what}: ${foreground} on ${background} is ${measured.toFixed(2)}:1, under ${floor}:1`);
  }
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

  // And the markup it drives is the shipped markup: four controls, four owned
  // fragments, in the page a reader opens.
  const document = parseHtml(html);
  assert.deepEqual(doors(document).map((door) => door.getAttribute("href")),
    KEYS.map((key) => DESTINATION_FRAGMENT[key]));
});
