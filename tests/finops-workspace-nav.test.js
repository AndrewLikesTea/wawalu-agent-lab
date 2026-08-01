// The AI FinOps workspace rail: landmarks, keyboard destination changes, and the
// announcements that go with them.
//
// WHAT THESE ASSERTIONS ARE FOR. Everything here is an accessibility regression
// test, which on this surface means something narrower than "the markup looks
// right": each claim below is one a keyboard or screen-reader user would notice
// breaking, written as behaviour rather than as an inspection of source text
// wherever the harness can drive it.
//
//   * TWO NAVIGATION LANDMARKS, TOLD APART. The page already had a site nav. A
//     second one with no name of its own, or with the same name, gives a
//     screen-reader user two entries in the landmark list called "navigation"
//     and no way to choose between them.
//   * THE DESTINATION IS REACHED, NOT JUST SCROLLED TO. Both in-page doors point
//     into regions authored inside *collapsed* disclosures. A door that leaves
//     the panel shut, or that moves the scroll position without moving focus,
//     leaves the reader looking at one region and tabbing through another.
//   * THE CURRENT DESTINATION IS TEXT. It is asserted as the word "Current"
//     inside the link's own name and as `aria-current`, never as a fill: this
//     file would pass on a greyscale rendering, and that is the point.
//   * THE LIVE REGION IS QUIET. It says nothing on load and nothing when a
//     reader re-presses the door they are already standing in. A status region
//     that speaks on every press is one a reader learns to ignore, and then the
//     announcement that mattered is the one they miss.
//
// Nothing here reads a clock, a network, or a random source. The end-to-end case
// drives the shipped page entry, so a rail that is never wired into the page
// fails here rather than passing as an unused module.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { DomEvent, loadPage, parseHtml, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { loadWorkspaceDestinations, prioritizedDestination } from "../src/finops-destination-contract.js";
import {
  DEFAULT_DESTINATION, DESTINATION_FRAGMENT, DESTINATION_STATE_LABEL, NAV_DISCLOSURE_LABEL,
  WORKSPACE_DESTINATION, WORKSPACE_NAV_IDS, applyWorkspaceNav, bindWorkspaceNav,
  currentDestination, destinationHrefDrift, supersedeWorkspaceNavRanking, workspaceDestinations,
} from "../src/finops-workspace-nav.js";
// #819 collapsed the rail and the working-area switcher into this one control, so
// the module that drives a door press is the shell. The behaviour a reader meets
// on a press is asserted here against both, because one press is now one act.
import { WORKSPACE_SHELL_IDS, initWorkspaceShell } from "../src/finops-workspace-shell.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const CSS = new URL("../src/evolution.css", import.meta.url);
const DEMO_DATA = JSON.parse(
  await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));
const SERVED = {
  "/evolution-demo-data.json": DEMO_DATA,
  "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
};

const html = await readFile(PAGE, "utf8");
const css = await readFile(CSS, "utf8");
const loaded = loadWorkspaceDestinations();

const byId = (doc, id) => doc.getElementById(id);
const doors = (doc) => byId(doc, WORKSPACE_NAV_IDS.list).querySelectorAll("[data-destination-key]");
const doorFor = (doc, key) => doors(doc).find((link) => link.dataset.destinationKey === key);
// THE PAGE'S ONE LIVE REGION. The rail used to own a second, and a press wrote
// into both; #819 left one, and it is the shell's, because the shell is what
// knows which screen opened and what question it answers.
const live = (doc) => textOf(byId(doc, WORKSPACE_SHELL_IDS.live));

/** The control, painted from the shipped contract and bound, with nothing else run. */
async function railed() {
  const page = await loadPage(PAGE);
  applyWorkspaceNav(page.document, loaded);
  bindWorkspaceNav(page.document);
  return page;
}

/** The control with the shell behind it, which is what a reader actually presses. */
async function worked(hash = "") {
  const page = await loadPage(PAGE);
  const win = { location: { hash }, addEventListener() {}, removeEventListener() {} };
  applyWorkspaceNav(page.document, loaded, { hash });
  initWorkspaceShell(page.document, { win, loaded });
  bindWorkspaceNav(page.document);
  return page;
}

/* ---------------------------- landmarks and names -------------------------- */

test("the rail is a named navigation landmark, distinct from the site nav", () => {
  const document = parseHtml(html);
  const nav = byId(document, WORKSPACE_NAV_IDS.nav);
  assert.ok(nav, "the AI FinOps page ships no workspace rail");
  assert.equal(nav.tagName, "NAV", "the rail must be a navigation landmark, not a div");

  // Named by a heading that is on the page, so the name in the landmark list is
  // the name a sighted reader can see and a speech-control user can say.
  const title = byId(document, nav.getAttribute("aria-labelledby"));
  assert.ok(title, "the rail's aria-labelledby points at nothing");
  assert.equal(title.tagName, "H2");
  assert.ok(textOf(title).length > 0, "the rail's name is empty");

  const navs = document.querySelectorAll("nav");
  assert.equal(navs.length, 2, `the page exposes ${navs.length} navigation landmarks`);
  const names = navs.map((node) => node.getAttribute("aria-label")
    ?? textOf(byId(document, node.getAttribute("aria-labelledby")) ?? { textContent: "" }));
  assert.equal(new Set(names).size, 2, `two navigation landmarks share one name: ${names.join(" / ")}`);

  // It carries no figure and answers no decision question, so it is not marked
  // as a summary of one. The page still presents exactly one complete summary.
  assert.equal(nav.getAttribute("data-decision-summary"), null);
});

test("every in-page destination is a named landmark that can take focus", () => {
  const document = parseHtml(html);
  const names = [];
  for (const link of doors(document)) {
    // Act and verify names no single panel: its screen is several. Every other
    // destination leads into one named region that has to be reachable.
    if (!link.dataset.destinationTarget) continue;
    const target = byId(document, link.dataset.destinationTarget);
    assert.ok(target, `${link.dataset.destinationKey} points at no element on this page`);
    assert.equal(target.getAttribute("href"), null);
    // A section with an accessible name is a region landmark; without focus it
    // is a scroll position rather than a destination.
    const label = byId(document, target.getAttribute("aria-labelledby"));
    assert.ok(label, `${target.id} has no accessible name, so it is an unnamed landmark`);
    assert.equal(target.getAttribute("tabindex"), "-1",
      `${target.id} cannot take focus, so the door only scrolls`);
    names.push(textOf(label));
  }
  assert.equal(names.length, 4);
  assert.equal(new Set(names).size, 4, `two destinations share one name: ${names.join(" / ")}`);

  // Focusable, but never a tab stop of its own: a reader tabbing the page must
  // not walk three extra empty stops for the privilege.
  const sequence = tabSequence(document);
  for (const id of ["finops-first-run", "recommendation-evidence", "department-decision-panel"]) {
    assert.ok(!sequence.includes(byId(document, id)), `${id} became a tab stop`);
  }
});

test("the rail follows the decision it navigates away from, and does not restate it", () => {
  const document = parseHtml(html);
  // Question, then the metric that sizes it, then the ranked action, then the
  // ranked door — and only then a rail of four equal doors. Navigation above the
  // answer would be a menu handed to a reader who has not been given one.
  const order = ["finops-first-run", "finops-destinations", WORKSPACE_NAV_IDS.nav];
  const positions = order.map((id) => html.indexOf(`id="${id}"`));
  assert.deepEqual([...positions].sort((left, right) => left - right), positions,
    "the workspace rail is authored above the answer it navigates away from");

  // The brief's own three-part reading order is untouched by this work.
  const brief = byId(document, "finops-first-run");
  const briefText = textOf(brief);
  assert.ok(briefText.indexOf("Are we wasting money?") < briefText.indexOf("Potentially recoverable share"));
  assert.ok(briefText.indexOf("Potentially recoverable share") < briefText.indexOf("Recommended action · rank 1"));

  // The rail names places. It quotes no figure and asks no question of its own.
  assert.doesNotMatch(textOf(byId(document, WORKSPACE_NAV_IDS.nav)), /\$|%|\?/);
});

/* ------------------------- consuming Noor's contract ---------------------- */

test("the original four doors remain and monthly review is added", () => {
  const destinations = workspaceDestinations(loaded);
  assert.deepEqual(destinations.map((entry) => entry.key), [
    WORKSPACE_DESTINATION.answer, WORKSPACE_DESTINATION.evidence,
    WORKSPACE_DESTINATION.department, WORKSPACE_DESTINATION.actAndVerify,
    WORKSPACE_DESTINATION.monthlyReview,
  ]);

  // Every href, and every "what does this answer", comes from the record — not
  // from a second list in the view.
  for (const entry of destinations.filter((door) => door.role)) {
    const contract = loaded.record.destinations.find((door) => door.role === entry.role);
    assert.equal(entry.href, contract.href);
    assert.equal(entry.answers, contract.answers);
    assert.equal(entry.doesNotAnswer, contract.doesNotAnswer);
  }
  // The answer door is this page's own, so it carries its own two sentences.
  const answer = destinations[0];
  assert.equal(answer.role, null);
  assert.ok(answer.answers.length > 0 && answer.doesNotAnswer.length > 0);

  // Exactly one door is recommended, and it is the one the priority clause
  // promoted — the same door the ranked region above the rail draws.
  const recommended = destinations.filter((entry) => entry.recommended);
  assert.equal(recommended.length, 1);
  assert.equal(recommended[0].role, prioritizedDestination(loaded.record).role);

  // The authored markup and the contract must not drift.
  assert.deepEqual(destinationHrefDrift(loaded), []);
});

test("a record that failed its contract costs the ranking, never the doors", async () => {
  const { document } = await loadPage(PAGE);
  const broken = JSON.parse(JSON.stringify(loaded.record));
  delete broken.finding;
  const painted = applyWorkspaceNav(document, loadWorkspaceDestinations(broken));

  assert.equal(painted.length, Object.values(WORKSPACE_DESTINATION).length,
    "a failed record removed a destination");
  assert.equal(byId(document, WORKSPACE_NAV_IDS.nav).dataset.ranked, "false");
  assert.equal(painted.filter((entry) => entry.recommended).length, 0);
  // Still four operable anchors, and still the current destination marked.
  for (const link of doors(document)) assert.match(link.getAttribute("href"), /^(#|\/)\S+$/);
  assert.equal(currentDestination(document), DEFAULT_DESTINATION);
});

test("importing your own export retires the recommendation and keeps the doors", async () => {
  const { document } = await railed();
  assert.equal(byId(document, WORKSPACE_NAV_IDS.nav).dataset.ranked, "true");

  supersedeWorkspaceNavRanking(document, true);
  assert.equal(byId(document, WORKSPACE_NAV_IDS.nav).dataset.ranked, "false");
  assert.equal(doors(document).length, Object.values(WORKSPACE_DESTINATION).length);
  for (const link of doors(document)) {
    assert.equal(textOf(link).includes(DESTINATION_STATE_LABEL.recommended), false);
  }
  // The rail itself is not hidden with the ranked region: the places stay true.
  assert.equal(byId(document, WORKSPACE_NAV_IDS.nav).hidden, false);
});

/* -------------------- keyboard destination changes ------------------------ */

test("the current destination is a word and an aria state, on exactly one door", async () => {
  const { document } = await railed();
  const marked = doors(document).filter((link) => link.getAttribute("aria-current") === "true");
  assert.equal(marked.length, 1, `${marked.length} doors claim to be current`);
  assert.equal(marked[0].dataset.destinationKey, DEFAULT_DESTINATION);
  // The state is in the link's own accessible name, so it survives greyscale,
  // print, and a screen reader.
  assert.ok(textOf(marked[0]).includes(DESTINATION_STATE_LABEL.current));
  for (const link of doors(document)) {
    if (link === marked[0]) continue;
    assert.equal(textOf(link).includes(DESTINATION_STATE_LABEL.current), false);
  }
  // Nothing is announced on load: the reader arrived, they did not move.
  assert.equal(live(document), "");
});

test("this page lists each destination exactly once, in one navigation landmark", () => {
  // #819's whole point. There used to be two lists — this one and the working-area
  // switcher — so every destination on the page was named twice and only one of
  // the two copies changed what was on screen. The assertion is on the shipped
  // markup, with nothing having run: a reader meets one list before any script.
  const document = parseHtml(html);
  const keys = doors(document).map((link) => link.dataset.destinationKey);
  assert.deepEqual(keys, Object.values(WORKSPACE_DESTINATION),
    "the one navigation does not list the destinations in reading order");
  assert.equal(new Set(keys).size, keys.length, "a destination is listed twice");

  // And no second list of the same doors survives anywhere in the document.
  const everyDoor = document.querySelectorAll("[data-shell-destination]");
  assert.equal(everyDoor.length, Object.values(WORKSPACE_DESTINATION).length,
    `${everyDoor.length} destination controls ship, so the page still names a destination twice`);
  for (const door of everyDoor) {
    assert.equal(door.closest("nav")?.id, WORKSPACE_NAV_IDS.nav,
      "a destination control ships outside the navigation landmark");
  }
  // Exactly one is marked, and it is marked in words as well as in the tree.
  const marked = doors(document).filter((link) => link.getAttribute("aria-current") === "true");
  assert.equal(marked.length, 1);
  assert.equal(marked[0].dataset.destinationKey, DEFAULT_DESTINATION);
  assert.ok(textOf(marked[0]).includes(DESTINATION_STATE_LABEL.current));

  // Every door carries the destination it opens, not a panel inside it: that is
  // what makes the href a forwardable link to a screen.
  assert.deepEqual(doors(document).map((link) => link.getAttribute("href")),
    Object.values(WORKSPACE_DESTINATION).map((key) => DESTINATION_FRAGMENT[key]));
});

test("Enter on a door opens its screen, moves the keyboard to it, and says so once", async () => {
  const { document } = await worked();
  const door = doorFor(document, WORKSPACE_DESTINATION.evidence);

  door.focus();
  pressEnter(document);

  // The screen is on, marked here, and the keyboard is on its heading — not on
  // the door that was pressed and not on a region that is no longer rendered.
  assert.equal(currentDestination(document), WORKSPACE_DESTINATION.evidence);
  assert.equal(document.activeElement, byId(document, WORKSPACE_SHELL_IDS.screenTitle),
    "the keyboard did not move to the screen that opened");
  assert.equal(byId(document, "recommendation-evidence")
    .closest("[data-workspace-region]").dataset.workspaceActive, "true");

  // ONE announcement, in ONE region, naming the screen and the question it
  // answers. The rail used to write a rival sentence into a second live region
  // for the same press; a reader who hears two learns to ignore both.
  assert.match(live(document), /^Showing Evidence\./);
  assert.match(live(document), /It answers: /);

  // The default is never prevented, so the address bar still ends up holding the
  // fragment the reader can copy and the back button still returns them.
  assert.deepEqual(document.navigations, [DESTINATION_FRAGMENT[WORKSPACE_DESTINATION.evidence]]);
});

test("re-pressing the door you are standing in changes nothing", async () => {
  const { document } = await worked();
  const door = doorFor(document, WORKSPACE_DESTINATION.department);
  door.focus();
  pressEnter(document);
  const first = live(document);
  assert.match(first, /^Showing Departments\./);

  door.focus();
  pressEnter(document);
  assert.equal(live(document), first, "the live region said something new for an unchanged screen");
  assert.equal(currentDestination(document), WORKSPACE_DESTINATION.department);
  const marked = doors(document).filter((link) => link.getAttribute("aria-current") === "true");
  assert.equal(marked.length, 1);
});

test("act and verify is a destination on this page, and is markable like the rest", async () => {
  // It used to be the one off-page door, pointing at /savings-action-center.html
  // and refusing to be marked current. The shell has an in-page act-and-verify
  // screen, so the collapsed control opens that; the Action Center is still
  // reachable from the ranked door above, which is where the contract points it.
  const { document } = await worked();
  const door = doorFor(document, WORKSPACE_DESTINATION.actAndVerify);
  assert.equal(door.getAttribute("href"),
    DESTINATION_FRAGMENT[WORKSPACE_DESTINATION.actAndVerify]);
  assert.ok(!textOf(door).includes("another page"));

  door.focus();
  pressEnter(document);
  assert.equal(currentDestination(document), WORKSPACE_DESTINATION.actAndVerify);
  assert.ok(textOf(door).includes(DESTINATION_STATE_LABEL.current));
  assert.match(live(document), /^Showing Act and verify\./);

  // And the page a leader is sent to for the commitment itself is still linked.
  assert.ok(html.includes('href="/savings-action-center.html"'),
    "collapsing the door dropped the only link to the Savings Action Center");
});

test("arriving on a shared fragment marks where the reader actually is", async () => {
  const { document } = await loadPage(PAGE);
  applyWorkspaceNav(document, loaded, { hash: "#department-decision-panel" });
  assert.equal(currentDestination(document), WORKSPACE_DESTINATION.department);
  // Marked, not announced: nobody moved, so nothing interrupts.
  assert.equal(live(document), "");
});

test("every door is one ordinary tab stop, in reading order, with no trap", async () => {
  const { document } = await railed();
  const sequence = tabSequence(document);
  const railDoors = doors(document);
  for (const link of railDoors) {
    assert.ok(sequence.includes(link), `${link.dataset.destinationKey} is not keyboard reachable`);
    // No positive tabindex anywhere: a rail that reorders the page's tab
    // sequence is a rail that breaks every other region's focus order.
    assert.equal(link.getAttribute("tabindex"), null);
  }
  const indexes = railDoors.map((link) => sequence.indexOf(link));
  assert.deepEqual([...indexes].sort((left, right) => left - right), indexes,
    "the doors are not tabbed in the order they are read");

  // Tabbing forward off the last door leaves the rail, and shift-tabbing back off
  // the first door leaves it the other way: no cycle, nothing swallowed.
  railDoors.at(-1).focus();
  const after = pressTab(document);
  assert.ok(after && !railDoors.includes(after), "Tab is trapped inside the rail");
  railDoors[0].focus();
  const before = pressTab(document, { shift: true });
  assert.ok(before && !railDoors.includes(before), "Shift+Tab is trapped inside the rail");

  // And the rail's own disclosure is reachable and operable as a native control.
  const summary = byId(document, WORKSPACE_NAV_IDS.detailSummary);
  assert.equal(summary.tagName, "SUMMARY");
});

/* ------------------------------ the disclosure ---------------------------- */

test("the disclosure states expanded and collapsed in three channels, and stays quiet", async () => {
  const { document } = await railed();
  const details = byId(document, WORKSPACE_NAV_IDS.detail);
  const summary = byId(document, WORKSPACE_NAV_IDS.detailSummary);
  const state = byId(document, WORKSPACE_NAV_IDS.detailState);

  assert.equal(summary.getAttribute("aria-expanded"), "false");
  assert.equal(details.dataset.disclosure, "collapsed");
  assert.ok(textOf(state).includes(NAV_DISCLOSURE_LABEL.collapsed.word));

  details.open = true;
  details.dispatchEvent(new DomEvent("toggle"));
  assert.equal(summary.getAttribute("aria-expanded"), "true");
  assert.equal(details.dataset.disclosure, "expanded");
  assert.equal(state.dataset.disclosure, "expanded");
  assert.ok(textOf(state).includes(NAV_DISCLOSURE_LABEL.expanded.word));

  details.open = false;
  details.dispatchEvent(new DomEvent("toggle"));
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  assert.ok(textOf(state).includes(NAV_DISCLOSURE_LABEL.collapsed.word));

  // Opening a disclosure is not news. `aria-expanded` is the announcement, and
  // duplicating it into the status region is exactly the noise that teaches a
  // reader to stop listening to it.
  assert.equal(live(document), "");
  assert.equal(byId(document, WORKSPACE_NAV_IDS.nav).dataset.announcements, undefined);
});

test("the disclosure carries what each door answers and what it will not", async () => {
  const { document } = await railed();
  const groups = byId(document, WORKSPACE_NAV_IDS.detailList).querySelectorAll("[data-destination-key]");
  assert.equal(groups.length, Object.values(WORKSPACE_DESTINATION).length);
  for (const group of groups) {
    assert.ok(group.querySelector(".workspace-nav-answers"), `${group.dataset.destinationKey} says nothing`);
    assert.ok(group.querySelector(".workspace-nav-limit"),
      `${group.dataset.destinationKey} names no limit, so a reader cannot tell it is the wrong room`);
  }
  // The words are the contract's, not a paraphrase of them.
  for (const entry of loaded.record.destinations) {
    assert.ok(textOf(byId(document, WORKSPACE_NAV_IDS.detailList)).includes(entry.answers));
    assert.ok(textOf(byId(document, WORKSPACE_NAV_IDS.detailList)).includes(entry.doesNotAnswer));
  }
});

/* -------------------------- drawn states and contrast --------------------- */

// The declaration block a selector ships, read out of the stylesheet by exact
// selector text: a rule that is renamed or deleted fails here rather than
// silently making an assertion vacuous.
const rule = (selector) => {
  const literal = selector.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);
  const found = css.match(new RegExp(`^${literal} \\{([^}]*)\\}`, "m"));
  assert.ok(found, `evolution.css does not style ${selector}`);
  return found[1];
};

function relativeLuminance(hex) {
  const channels = hex.length === 4
    ? [...hex.slice(1)].map((digit) => parseInt(digit + digit, 16))
    : [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  const [r, g, b] = channels.map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground, background) {
  const [light, dark] = [relativeLuminance(foreground), relativeLuminance(background)]
    .sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

// The tokens this stylesheet declares, resolved from its own `:root` so a token
// edit is what fails here rather than a hard-coded copy of one.
const token = (name) => {
  const found = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{3,8})`, "i"));
  assert.ok(found, `evolution.css declares no --${name}`);
  return found[1];
};

test("every colour pair the rail draws clears 4.5:1, and the focus ring clears 3:1", () => {
  const inkOnSurface = [
    ["door label", token("import-ink"), "#fff"],
    ["current door label", token("import-ink"), token("import-wash")],
    ["current chip", "#fff", token("import-accent")],
    ["rail title", token("import-ink"), "#f7f6f1"],
    ["rail note", token("ink-muted"), "#f7f6f1"],
    ["what it answers", "#4c5650", "#f7f6f1"],
    ["what it will not", token("state-warn-ink"), "#f7f6f1"],
  ];
  for (const [what, foreground, background] of inkOnSurface) {
    const ratio = contrastRatio(foreground, background);
    assert.ok(ratio >= 4.5, `${what}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1`);
  }
  // The ring is a non-text indicator, so 3:1 against both surfaces it lands on.
  const ring = css.match(/--focus-ring:\s*(#[0-9a-f]{3,6})/i)?.[1] ?? "#155f9e";
  for (const background of ["#fff", "#f7f6f1"]) {
    const ratio = contrastRatio(ring, background);
    assert.ok(ratio >= 3, `the focus ring is ${ratio.toFixed(2)}:1 against ${background}`);
  }
});

test("the rail draws a visible focus ring and never rests on colour alone", () => {
  assert.match(rule(".workspace-dest:focus-visible"), /outline:\s*3px solid var\(--focus-ring\)/);
  assert.match(rule(".workspace-nav-detail>summary:focus-visible"), /outline:\s*3px solid var\(--focus-ring\)/);
  // The current state is drawn in a rule, a weight, and a fill — three channels
  // beside the word in the markup, so no one of them is load-bearing alone.
  const current = rule('.workspace-dest[aria-current="true"]');
  assert.match(current, /border-left:\s*5px solid/);
  assert.match(current, /font-weight:\s*7\d0/);
  // A 44px target, because a door nobody can hit is a door nobody can take.
  assert.match(rule(".workspace-dest"), /min-height:\s*44px/);
});

test("the rail and the decisive finding reflow instead of scrolling sideways", () => {
  const list = rule(".workspace-nav-list");
  assert.match(list, /flex-wrap:\s*wrap/, "the doors cannot wrap, so four of them push the page sideways");
  const door = rule(".workspace-dest");
  assert.doesNotMatch(door, /white-space:\s*nowrap/);
  assert.match(door, /min-width:\s*0/, "a flex item without min-width:0 refuses to shrink below its text");
  assert.match(door, /overflow-wrap:\s*anywhere/);

  // The decisive finding above the rail keeps the same property: fluid tracks
  // with a minimum, never a fixed column count that collapses on a phone.
  for (const selector of [".first-run-slots", ".first-run-support", ".first-run-actions"]) {
    assert.match(rule(selector), /grid-template-columns:\s*repeat\(auto-fit,minmax\(\d+px,1fr\)\)/);
  }
  assert.match(rule(".first-run"), /padding:\s*clamp\(/);
});

/* --------------------------------- the page ------------------------------- */

test("the shipped page entry paints and binds the rail, and the brief still answers", async () => {
  const page = await loadPage(PAGE, { routes: SERVED });
  try {
    await importPageModule("/evolution-page.js");
    const { document } = page;
    await waitFor(() => byId(document, WORKSPACE_NAV_IDS.detailList).children.length > 0,
      "the workspace rail was never painted by the page");

    // Painted from the contract by the page itself, and bound: a click works.
    assert.equal(byId(document, WORKSPACE_NAV_IDS.nav).dataset.ranked, "true");
    const recommended = doors(document)
      .filter((link) => textOf(link).includes(DESTINATION_STATE_LABEL.recommended));
    assert.equal(recommended.length, 1);
    assert.equal(recommended[0].dataset.destinationRole, prioritizedDestination(loaded.record).role);

    const door = doorFor(document, WORKSPACE_DESTINATION.department);
    door.focus();
    pressEnter(document);
    assert.equal(document.activeElement, byId(document, WORKSPACE_SHELL_IDS.screenTitle));
    assert.equal(currentDestination(document), WORKSPACE_DESTINATION.department);
    assert.match(live(document), /^Showing Departments\./);

    // And the work above the rail is untouched: the brief still answers the
    // question, and the ranked region still ranks a door.
    assert.equal(byId(document, "finops-first-run").dataset.state, "ready");
    assert.equal(byId(document, "finops-destinations").dataset.state, "ranked");
  } finally {
    page.restore();
  }
});
