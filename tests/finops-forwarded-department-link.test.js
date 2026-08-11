// A forwarded `evolution.html?department=<slug>` link, applied to the page that
// ships.
//
// The selector next door decides WHAT the answer is; this file pins WHERE it
// lands. The promise a forwarded link makes is physical: the department region
// is open, it has the reader's attention, and the department the link named is
// the one selected. A link that resolves correctly into a collapsed disclosure
// at the bottom of a long page has kept none of it.
//
// The markup is the shipped document, parsed as it is served. The ranked
// controls are appended here rather than booted, because the page paints them
// from a fetch and what is under test is the press, not the fetch.
//
// No network, no credential, no clock.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  DEPARTMENT_PANEL_ID, FORWARDED_DEPARTMENT_NOTE_ID, applyForwardedDepartment,
  readForwardedDepartment,
} from "../src/finops-forwarded-department-view.js";
import { DEPARTMENT_RESOLUTION, DEPARTMENT_SLUGS } from "../src/finops-department-view-model.js";
import { parseHtml, textOf } from "./support/browser.js";

const HTML = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
const RECORD = JSON.parse(
  await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));

/** The disclosure the department decision region is folded inside. */
const REGION_ID = "disclosure-department-priority";

const page = () => parseHtml(HTML);

/**
 * The ranked controls the drill-down paints once the seed has arrived, and a
 * counter, because "pressed nothing" is a claim about activations and this
 * harness does not count them on its own.
 */
function paintRankedControls(document) {
  const list = document.getElementById("department-priority");
  list.replaceChildren();
  const clicks = { count: 0 };
  for (const slug of DEPARTMENT_SLUGS) {
    const button = document.createElement("button");
    button.setAttribute("type", "button");
    button.dataset.departmentId = slug;
    button.setAttribute("aria-pressed", String(slug === DEPARTMENT_SLUGS[0]));
    button.addEventListener("click", () => {
      clicks.count += 1;
      for (const other of list.querySelectorAll("button")) {
        other.setAttribute("aria-pressed", String(other === button));
      }
    });
    list.append(button);
  }
  list.clicks = clicks;
  return list;
}

const pressedIds = (list) => [...list.querySelectorAll("button")]
  .filter((button) => button.getAttribute("aria-pressed") === "true")
  .map((button) => button.dataset.departmentId);

/* ------------------------------ the query string --------------------------- */

test("the parameter is read on its own, and a second value is not collapsed away", () => {
  assert.equal(readForwardedDepartment("?department=quality"), "quality");
  assert.equal(readForwardedDepartment("?destination=department&department=sre"), "sre");
  assert.equal(readForwardedDepartment("?department=data%2Dml"), "data-ml");
  assert.equal(readForwardedDepartment(""), undefined);
  assert.equal(readForwardedDepartment("?brief=eyJhIjoxfQ"), undefined);
  assert.deepEqual(readForwardedDepartment("?department=a&department=b"), ["a", "b"]);
  // A neighbouring parameter that will not decode must not lose this one.
  assert.equal(readForwardedDepartment("?brief=%E0%A4%A&department=quality"), "quality");
  // …and a broken escape on this one is handed back as it arrived, so the
  // reader is told the name could not be read rather than that none was given.
  assert.equal(readForwardedDepartment("?department=%E0%A4%A"), "%E0%A4%A");
});

/* ------------------------------ the landing ------------------------------- */

test("the department region is folded away before any link is applied", () => {
  const document = page();
  // A closed details reports `open` as undefined in this harness, so the
  // assertion is on falsiness rather than on the literal false.
  assert.ok(!document.getElementById(REGION_ID).open);
  assert.equal(document.activeElement, null);
});

test("a forwarded slug opens the department region and hands it the attention", () => {
  const document = page();
  const list = paintRankedControls(document);

  const applied = applyForwardedDepartment(document, {
    search: "?department=quality", record: RECORD,
  });

  assert.equal(applied.model.resolved, true);
  assert.equal(applied.model.slug, "quality");
  assert.equal(document.getElementById(REGION_ID).open, true,
    "the region is a details element and it is open on arrival");
  assert.equal(document.activeElement?.id, DEPARTMENT_PANEL_ID,
    "focus is moved to the region rather than left at the top of the document");
  assert.equal(applied.pressed, true);
  assert.deepEqual(pressedIds(list), ["quality"],
    "exactly the forwarded department is selected, and no other");
  assert.equal(document.getElementById(DEPARTMENT_PANEL_ID)
    .getAttribute("data-forwarded-department"), "quality");
});

test("the region says which department is on screen, once", () => {
  const document = page();
  paintRankedControls(document);
  applyForwardedDepartment(document, { search: "?department=sre", record: RECORD });

  const note = document.getElementById(FORWARDED_DEPARTMENT_NOTE_ID);
  assert.equal(note.getAttribute("role"), "status");
  assert.equal(note.getAttribute("data-department-resolution"), DEPARTMENT_RESOLUTION.resolved);
  assert.match(textOf(note), /the department this link named/);
  // Inside the decision region, not beside it: a paragraph parked at the top
  // level of this document would be a region no registry declares.
  assert.equal(note.parentNode.id, DEPARTMENT_PANEL_ID);
});

test("applying the same link twice writes one note and presses nothing new", () => {
  const document = page();
  const list = paintRankedControls(document);
  const options = { search: "?department=mobile", record: RECORD };
  applyForwardedDepartment(document, options);
  assert.equal(list.clicks.count, 1, "the forwarded department is pressed once");
  applyForwardedDepartment(document, options);

  let notes = 0;
  const walk = (node) => {
    for (const child of node.children ?? []) {
      if (child.nodeType !== 1) continue;
      if (child.id === FORWARDED_DEPARTMENT_NOTE_ID) notes += 1;
      walk(child);
    }
  };
  walk(document.getElementById(DEPARTMENT_PANEL_ID));
  assert.equal(notes, 1, "the live region is emptied and rewritten, never duplicated");
  assert.deepEqual(pressedIds(list), ["mobile"]);
  assert.equal(list.clicks.count, 1, "an already-applied link presses nothing");
});

/* ------------------------------- the fallback ------------------------------ */

test("an unknown slug states the reason and leaves the ranking as painted", () => {
  const document = page();
  const list = paintRankedControls(document);

  const applied = applyForwardedDepartment(document, {
    search: "?department=marketing", record: RECORD,
  });

  assert.equal(applied.model.resolved, false);
  assert.equal(applied.pressed, false);
  assert.deepEqual(pressedIds(list), [DEPARTMENT_SLUGS[0]],
    "no substitute is pressed under the requested name");
  const note = document.getElementById(FORWARDED_DEPARTMENT_NOTE_ID);
  assert.equal(note.getAttribute("data-department-resolution"), DEPARTMENT_RESOLUTION.unknown);
  assert.match(textOf(note), /no department called “marketing”/i);
  assert.match(textOf(note), /whole organization/);
  // The reader still lands somewhere they can act: the region is open and
  // focused, with the reason at the top of it.
  assert.equal(document.getElementById(REGION_ID).open, true);
  assert.equal(document.activeElement?.id, DEPARTMENT_PANEL_ID);
});

test("a malformed value never reaches the page as it arrived", () => {
  const document = page();
  paintRankedControls(document);
  applyForwardedDepartment(document, {
    search: "?department=%3Cscript%3Ealert(1)%3C%2Fscript%3E", record: RECORD,
  });
  const note = document.getElementById(FORWARDED_DEPARTMENT_NOTE_ID);
  assert.equal(note.getAttribute("data-department-resolution"), DEPARTMENT_RESOLUTION.malformed);
  assert.doesNotMatch(textOf(note), /script|alert/i);
  assert.match(textOf(note), /could not be read/);
});

test("an address with no department parameter changes nothing at all", () => {
  const document = page();
  const list = paintRankedControls(document);
  const applied = applyForwardedDepartment(document, { search: "?destination=answer", record: RECORD });

  assert.equal(applied.model, null);
  assert.equal(applied.pressed, false);
  assert.ok(!document.getElementById(REGION_ID).open, "an unrelated address opens nothing");
  assert.equal(document.activeElement, null, "…and steals no focus");
  assert.deepEqual(pressedIds(list), [DEPARTMENT_SLUGS[0]]);
  assert.equal(document.getElementById(DEPARTMENT_PANEL_ID)
    .getAttribute("data-forwarded-department"), null);
});

test("a late paint presses the department without moving the reader again", () => {
  const document = page();
  // The boot order: the link is applied before the seed arrives, so there is
  // nothing to press yet, and again after the ranked controls exist.
  const first = applyForwardedDepartment(document, {
    search: "?department=security", record: RECORD,
  });
  assert.equal(first.model.resolved, true);
  assert.equal(first.pressed, false, "there was no control to press yet");
  assert.equal(first.revealed, true);

  document.activeElement?.blur?.();
  const list = paintRankedControls(document);
  const second = applyForwardedDepartment(document, {
    search: "?department=security", record: RECORD, move: false,
  });
  assert.equal(second.pressed, true);
  assert.deepEqual(pressedIds(list), ["security"]);
  assert.equal(second.revealed, false);
  assert.equal(document.activeElement, null,
    "a reader who has started reading is not thrown back up the page");
});

test("a record that never loaded says so and sends nobody anywhere", () => {
  const document = page();
  const applied = applyForwardedDepartment(document, {
    search: "?department=quality", record: null,
  });
  assert.equal(applied.model.reasonCode, DEPARTMENT_RESOLUTION.unreadable);
  assert.equal(applied.revealed, false);
  assert.equal(document.activeElement, null);
  assert.match(textOf(document.getElementById(FORWARDED_DEPARTMENT_NOTE_ID)), /could not be read/);
});

/* ------------------------ no new top-level region -------------------------- */

test("the note is a child of a declared region and adds no region of its own", () => {
  const document = page();
  const before = [...document.getElementById("main-content").children]
    .filter((child) => child.nodeType === 1 && child.id).length;
  applyForwardedDepartment(document, { search: "?department=quality", record: RECORD });
  const after = [...document.getElementById("main-content").children]
    .filter((child) => child.nodeType === 1 && child.id).length;
  assert.equal(after, before,
    "the page's top-level region census is closed; this change may not add to it");
});
