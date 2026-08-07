// The front door of /evolution.html, read as an answer rather than as a
// paragraph (#1327).
//
// Four things are held here: the page's heading and landmark outline, the
// finding → evidence → action reading order, all four states of the finding,
// and the disclosure — that it opens from the keyboard, and that no live region
// is folded inside it.
//
// HARNESS NOTES, so the next person does not rediscover them. The parser
// rejects `*` and descendant selectors like `"details #id"`, so containment is
// walked through `parentNode` and `children`. Text nodes appear in `children`
// and carry no `dataset`, so every read of one is optional-chained. Asserting
// `assert.equal(node, null)` on a harness element inspects the whole parsed page
// and hangs for minutes, so absence is asserted as a count. Properties are not
// reflected to attributes, so `hidden` is read as a property.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CONFIDENCE_BASIS, CONFIDENCE_LEVELS, FINOPS_DESTINATIONS, FINOPS_FRONT_DOOR,
  FRONT_DOOR_STATES, applyFrontDoorState, bindFrontDoorWorking,
  formatRecoverableUsd, frontDoorEvidence, frontDoorFinding,
} from "../src/finops-destinations.js";
import { parseHtml, pressEnter, pressSpace, textOf } from "./support/browser.js";

const page = () => readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
const doc = async () => parseHtml(await page());

const REGION = "finops-front-door";

/** Containment without a descendant selector: walk up from the node. */
const within = (node, host) => {
  for (let step = node; step; step = step.parentNode) if (step === host) return true;
  return false;
};

/** Every element in document order, by walking `children` rather than `*`. */
const elements = (root, seen = []) => {
  for (const child of root.children ?? []) {
    if (child?.nodeType !== 1) continue;
    seen.push(child);
    elements(child, seen);
  }
  return seen;
};

// ---------------------------------------------------------------------------
// 1. One heading, one main, named landmarks.
// ---------------------------------------------------------------------------

test("the document has exactly one h1 and skips no heading level under it", async () => {
  const document = await doc();
  const main = document.getElementById("main-content");
  assert.equal(main.tagName, "MAIN", "the page content is in a single main landmark");

  const headings = elements(main).filter((node) => /^H[1-6]$/.test(node.tagName));
  const levels = headings.map((node) => Number(node.tagName.slice(1)));
  assert.equal(levels.filter((level) => level === 1).length, 1,
    "the page names itself once; a second h1 is a second document");
  assert.equal(levels[0], 1, "the h1 is emitted before every heading it outranks");

  // No skipped level anywhere: a jump from h2 to h4 is an outline with a hole in
  // it, and heading navigation is how a screen-reader user reads this page's
  // length. Going back up any number of levels is fine; going down is by one.
  for (let index = 1; index < levels.length; index += 1) {
    assert.ok(levels[index] - levels[index - 1] <= 1,
      `heading level ${levels[index]} follows ${levels[index - 1]} at "`
      + `${textOf(headings[index]).trim().slice(0, 60)}" — a level was skipped`);
  }
});

test("every nav landmark on the page carries a name, and the doors are one of them", async () => {
  const document = await doc();
  const navs = document.querySelectorAll("nav");
  assert.ok(navs.length >= 2, "the site nav and the destination nav are both landmarks");
  for (const nav of navs) {
    const named = nav.getAttribute("aria-label") || nav.getAttribute("aria-labelledby");
    assert.ok(named, "a repeated landmark with no name cannot be told from the others");
  }

  const doors = document.getElementById("finops-front-door-nav");
  assert.equal(doors.tagName, "NAV");
  assert.equal(doors.getAttribute("aria-label"), "Destinations");
  assert.ok(within(doors, document.getElementById(REGION)));
  assert.equal(within(doors, document.getElementById("finops-front-door-working")), false,
    "the doors are not folded inside the working");
});

test("each door is labelled with its own registry question, once", async () => {
  const document = await doc();
  const doors = [...document.getElementById("finops-front-door-list")
    .querySelectorAll("[data-front-door-slug]")];
  assert.equal(doors.length, FINOPS_DESTINATIONS.length);

  for (const destination of FINOPS_DESTINATIONS) {
    const door = doors.find((node) => node.dataset?.frontDoorSlug === destination.slug);
    const name = textOf(door).replace(/\s+/g, " ").trim();
    assert.ok(name.startsWith(destination.name),
      `${destination.slug}'s link is named after the destination first`);
    assert.ok(name.includes(destination.question),
      `${destination.slug}'s link does not say which question it answers`);
    assert.equal(door.getAttribute("href"), destination.href);
    // The name is the visible text; an aria-label here would be a second copy
    // that can drift from the words on screen.
    assert.equal(door.hasAttribute("aria-label"), false);
  }
});

test("the in-page door lands focus on its target rather than only scrolling", async () => {
  const document = await doc();
  const inPage = FINOPS_DESTINATIONS.filter((entry) => entry.href.startsWith("#"));
  assert.ok(inPage.length >= 1, "at least one destination is on this page");
  for (const destination of inPage) {
    const target = document.getElementById(destination.href.slice(1));
    assert.equal(target.getAttribute("tabindex"), "-1",
      `#${destination.href.slice(1)} is not focusable, so the jump only scrolls`);
  }
});

// ---------------------------------------------------------------------------
// 2. Finding, then evidence, then action.
// ---------------------------------------------------------------------------

test("the finding is read first, at the page's figure weight, and the action last", async () => {
  const document = await doc();
  const region = document.getElementById(REGION);
  const order = elements(region);
  const at = (id) => order.findIndex((node) => node.id === id);

  assert.ok(at("finops-front-door-value") < at("finops-front-door-evidence"),
    "the number is stated before anything qualifying it");
  assert.ok(at("finops-front-door-evidence") < at("finops-front-door-nav"),
    "the evidence is read before the reader is asked to move");
  assert.ok(at("finops-front-door-nav") < at("finops-front-door-working"),
    "the working is last; it is detail, not the answer");

  // The figure roles, not a heading used for size: the region still carries no
  // heading, because a heading here would be a second question at headline
  // weight under the page's one question.
  const value = document.getElementById("finops-front-door-value");
  assert.ok(value.className.includes("stand-figure-value"));
  assert.equal(order.filter((node) => /^H[1-6]$/.test(node.tagName)).length, 0);
});

test("impact, confidence and provenance are labelled rows, and confidence is a word", async () => {
  const document = await doc();
  const list = document.getElementById("finops-front-door-evidence");
  assert.equal(list.tagName, "DL");
  const terms = list.querySelectorAll("dt").map((node) => textOf(node).trim());
  assert.deepEqual(terms, ["Impact", "Confidence", "Provenance"]);
  const details = list.querySelectorAll("dd");
  assert.equal(details.length, terms.length, "a labelled row with nothing in it");

  const confidence = textOf(details[1]);
  assert.ok(CONFIDENCE_LEVELS.some((level) => confidence.startsWith(level)),
    "the grade is the word, so it survives greyscale, print and a screen reader");
  assert.ok(confidence.includes(CONFIDENCE_BASIS[FINOPS_FRONT_DOOR.figure.confidence]),
    "the grade arrives without the rule that earned it");
  assert.doesNotMatch(confidence, /%/, "a percentage invites arithmetic on a grade");

  // Provenance says whose numbers these are and the synthetic boundary, once.
  const provenance = textOf(details[2]);
  assert.ok(provenance.includes(FINOPS_FRONT_DOOR.figure.provenance));
  assert.ok(provenance.includes(FINOPS_FRONT_DOOR.boundary));
});

test("exactly one door is the action, and it is the only filled control", async () => {
  const document = await doc();
  const doors = [...document.getElementById("finops-front-door-list")
    .querySelectorAll("[data-front-door-slug]")];
  const promoted = doors.filter((door) => door.dataset?.frontDoorPrioritized === "true");
  assert.equal(promoted.length, 1);
  assert.ok(promoted[0].className.includes("stand-action"),
    "the recommendation does not carry the page's action silhouette");
  for (const door of doors) {
    if (door === promoted[0]) continue;
    assert.ok(door.className.includes("workspace-dest"),
      "a door that is not the recommendation is drawn as an equal competitor");
    assert.equal(door.className.includes("stand-action"), false);
  }
  // And the promotion is readable as words, not only as a fill.
  assert.ok(textOf(promoted[0]).includes("Recommended first"));
});

// ---------------------------------------------------------------------------
// 3. Four states, all drawn.
// ---------------------------------------------------------------------------

test("every state keeps a label, a non-blank value and a sentence saying why", () => {
  assert.deepEqual([...FRONT_DOOR_STATES], ["ready", "loading", "empty", "error"]);
  for (const state of FRONT_DOOR_STATES) {
    const finding = frontDoorFinding(FINOPS_FRONT_DOOR, state);
    assert.equal(finding.state, state);
    assert.equal(finding.label, FINOPS_FRONT_DOOR.figure.label,
      `${state} drops the label, so the number is unnamed`);
    assert.ok(finding.display.trim().length > 0, `${state} collapses to a blank`);
    assert.equal(finding.available, state === "ready");
    if (state === "ready") continue;
    assert.ok(finding.note.length > 40, `${state} shows a value and will not say why`);
    // The honest non-empty pattern: the last real figure WITH when it was taken.
    assert.equal(finding.display, FINOPS_FRONT_DOOR.lastMeasured.display);
    assert.ok(finding.note.includes(FINOPS_FRONT_DOOR.lastMeasured.takenAt),
      `${state} shows a carried-over figure without saying when it was taken`);
  }
});

test("with nothing ever measured, no state is a dash and every one says what to do", () => {
  const fresh = { ...FINOPS_FRONT_DOOR, lastMeasured: null };
  for (const state of FRONT_DOOR_STATES.filter((entry) => entry !== "ready")) {
    const finding = frontDoorFinding(fresh, state);
    assert.ok(finding.display.length > 1, `${state} is a bare placeholder`);
    assert.doesNotMatch(finding.display, /^[-–—]$/, `${state} shows a dash and nothing else`);
    assert.ok(finding.note.length > 40);
  }
  assert.match(frontDoorFinding(fresh, "empty").note, /Import a provider export/);
});

test("an implausible figure cannot widen the layout, at either sign", () => {
  assert.equal(formatRecoverableUsd(15_600), FINOPS_FRONT_DOOR.figure.display,
    "the bundled figure must still round to the shipped display form");
  assert.equal(formatRecoverableUsd(0), "$0");
  assert.equal(formatRecoverableUsd(-5_200), "-$5k");
  assert.equal(formatRecoverableUsd(4_100_000), "$4.1M");
  assert.equal(formatRecoverableUsd(-987_654_321_000), "-$987.7B");
  assert.equal(formatRecoverableUsd(Number.NaN), "Unavailable");

  // The layout defence is the formatter, not a stylesheet rule: nothing this
  // slot can be handed is longer than one short line.
  for (const value of [1e15, -1e15, 999_999_999_999, -0.4]) {
    assert.ok(formatRecoverableUsd(value).length <= 12,
      `${value} renders as ${formatRecoverableUsd(value)}, wide enough to break the row`);
  }
});

test("painting a state moves the words, the availability mark and the region", async () => {
  const document = await doc();
  const region = document.getElementById(REGION);
  const value = document.getElementById("finops-front-door-value");
  const note = document.getElementById("finops-front-door-note");

  // The served bytes are the ready state, and it hides the note rather than
  // leaving an empty paragraph behind.
  assert.equal(region.getAttribute("data-state"), "ready");
  assert.equal(value.getAttribute("data-available"), "true");
  assert.equal(note.hidden, true);

  applyFrontDoorState(document, FINOPS_FRONT_DOOR, "error");
  assert.equal(region.getAttribute("data-state"), "error");
  assert.equal(value.getAttribute("data-available"), "false",
    "a stale figure is not marked as one, so it reads as a fresh measurement");
  assert.equal(note.hidden, false);
  assert.ok(textOf(note).includes("could not be read"));

  applyFrontDoorState(document, FINOPS_FRONT_DOOR, "ready");
  assert.equal(value.getAttribute("data-available"), "true");
  assert.equal(textOf(value), FINOPS_FRONT_DOOR.figure.display);
  assert.equal(note.hidden, true);
});

// ---------------------------------------------------------------------------
// 4. The disclosure, and what may not be inside it.
// ---------------------------------------------------------------------------

test("the working opens and closes from the keyboard, with no script of its own", async () => {
  const document = await doc();
  const details = document.getElementById("finops-front-door-working");
  const summary = document.getElementById("finops-front-door-working-summary");
  assert.equal(details.tagName, "DETAILS");
  assert.equal(summary.tagName, "SUMMARY");
  assert.equal(details.hasAttribute("open"), false, "the working ships open");

  // A self-describing control: it names what is inside rather than saying "More".
  const label = textOf(summary).replace(/[▸▾\s]+/g, " ").trim();
  assert.ok(label.includes(FINOPS_FRONT_DOOR.figure.display) && label.length > 20,
    `the control reads "${label}", which does not say what opening it gives you`);
  assert.equal(summary.hasAttribute("aria-label"), false);
  assert.equal(summary.getAttribute("tabindex"), null,
    "the one control was taken out of the natural tab order");

  bindFrontDoorWorking(document);
  summary.focus();
  assert.equal(document.activeElement, summary, "the control is not focusable");
  pressEnter(document);
  assert.equal(details.hasAttribute("open"), true, "Enter does not open the working");
  assert.equal(summary.getAttribute("aria-expanded"), "true");
  assert.equal(details.getAttribute("data-disclosure"), "expanded");
  pressSpace(document);
  assert.equal(details.hasAttribute("open"), false, "Space does not close the working");
  assert.equal(summary.getAttribute("aria-expanded"), "false");
});

test("the working holds the arithmetic and every destination's own source", async () => {
  const document = await doc();
  const list = document.getElementById("finops-front-door-working-detail");
  const terms = list.querySelectorAll("dt").map((node) => textOf(node).trim());
  assert.deepEqual(terms, [`How ${FINOPS_FRONT_DOOR.figure.display} was computed`,
    ...FINOPS_DESTINATIONS.map((entry) => entry.name)]);
  for (const definition of list.querySelectorAll("dd")) {
    assert.ok(textOf(definition).trim().length > 40, "a labelled part that says nothing");
  }
  // Each destination's own provenance travels with its own figure.
  const rows = list.querySelectorAll("dd").map((node) => textOf(node));
  for (const [index, destination] of FINOPS_DESTINATIONS.entries()) {
    assert.ok(rows[index + 1].includes(destination.metric.provenance),
      `${destination.slug}'s figure is stated with no source`);
  }
});

test("nothing announced is inside the working, on any surface that writes here", async () => {
  const document = await doc();
  const details = document.getElementById("finops-front-door-working");
  const region = document.getElementById(REGION);

  // Authored: no live region, no status role inside the disclosure. A harness
  // reads through a shut `details`, so a live region folded in here would pass
  // every text assertion on this page while being silent for a real reader.
  assert.equal(details.querySelectorAll("[aria-live]").length, 0);
  assert.equal(details.querySelectorAll("[role]").length, 0);

  // And painted: destination-route-view.js inserts the region's route status on
  // demand. It must land outside the disclosure — as the region's first child,
  // which is where it says it puts it.
  const { applyDestinationRoute, ROUTE_MESSAGE_ID } =
    await import("../src/destination-route-view.js");
  applyDestinationRoute(document, "?destination=commitment-coverage&department=data-ml");
  const message = document.getElementById(ROUTE_MESSAGE_ID);
  assert.equal(message.getAttribute("role"), "status");
  assert.ok(within(message, region), "the route status left the region it describes");
  assert.equal(within(message, details), false,
    "the route status was folded into a shut disclosure, where nobody is told it");
  assert.equal(region.querySelectorAll("[aria-live]").length, 0,
    "a second live region joined the one this region already has");
});
