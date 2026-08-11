// The front door of /evolution.html, and the registry it is rendered from.
//
// Four things are held here and nothing else: the slug set (a contract later
// routing and sharing work reads), the fact that exactly one action is
// prioritized and that the flag agrees with the rule that computes it, the
// front door's own four parts, and the page-wide rule that no question is asked
// twice.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CONFIDENCE_LEVELS, DESTINATION_CEILING, FINOPS_DESTINATIONS, FINOPS_FRONT_DOOR,
  FRONT_DOOR_QUESTION, FRONT_DOOR_QUESTION_ID,
  applyFinopsFrontDoor, frontDoorEvidence,
  frontDoorMarkup, prioritizedDestination, prioritizedSlug,
} from "../src/finops-destinations.js";
import { FINOPS_WORKSPACE_INDEX, indexRowText } from "../src/finops-workspace-index.js";
import { parseHtml, textOf } from "./support/browser.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// The exact set, in order. A rename is a diff here rather than a silent break
// in whatever reads a slug next.
const SLUGS = ["spend-attribution", "optimisation-levers", "commitment-coverage"];

test("the slug set is exact, ordered, and inside the ceiling", () => {
  assert.deepEqual(FINOPS_DESTINATIONS.map((entry) => entry.slug), SLUGS);
  assert.ok(FINOPS_DESTINATIONS.length >= 3 && FINOPS_DESTINATIONS.length <= DESTINATION_CEILING,
    "three or four destinations; a fifth is a menu");
  for (const slug of SLUGS) {
    assert.match(slug, /^[a-z]+(-[a-z]+)*$/, "slugs are stable and kebab-case");
  }
});

test("every destination carries one question and one material metric with its own provenance", () => {
  for (const entry of FINOPS_DESTINATIONS) {
    assert.ok(entry.name.length > 0, `${entry.slug} names where to go`);
    assert.ok(entry.question.endsWith("?"), `${entry.slug} states the question it answers`);
    assert.ok(entry.href.length > 0, `${entry.slug} says where the link goes`);
    assert.ok(entry.nextAction.length > 0, `${entry.slug} names what to do there`);
    // ONE metric, not a pair: a destination that needs two numbers to be
    // understood is two destinations.
    assert.deepEqual(Object.keys(entry.metric).sort(),
      ["display", "label", "provenance", "unit", "value"],
      `${entry.slug}'s metric carries a label, a value, a unit, a display form and a provenance`);
    assert.equal(typeof entry.metric.value, "number");
    assert.match(entry.metric.provenance, /, as of \d{4}-\d{2}-\d{2}$/,
      `${entry.slug}'s metric names its source of record and an as-of date`);
  }
});

test("exactly one action is prioritized, and the flag agrees with the rule", () => {
  const flagged = FINOPS_DESTINATIONS.filter((entry) => entry.prioritized);
  assert.equal(flagged.length, 1, "exactly one entry in the registry may be prioritized");
  assert.equal(flagged[0].slug, FINOPS_FRONT_DOOR.prioritizedSlug,
    "the front door points at the entry that carries the flag");
  assert.equal(prioritizedDestination().slug, flagged[0].slug);

  // The flag is not the source of the ranking: recompute it from recoverable
  // spend per unit of effort among actionable items and require agreement, so a
  // flag moved by hand without the numbers behind it fails here.
  assert.equal(prioritizedSlug(), flagged[0].slug,
    "the prioritized flag must be what the stated rule computes");
});

test("the prioritization rule ranks on recoverable spend per unit of effort", () => {
  const rate = (entry) => entry.recoverableUsd / entry.effortDays;
  const winner = FINOPS_DESTINATIONS.find((entry) => entry.prioritized);
  for (const other of FINOPS_DESTINATIONS) {
    if (other === winner) continue;
    assert.ok(rate(winner) > rate(other),
      `${winner.slug} must out-rank ${other.slug} on recoverable spend per effort day`);
  }

  // The rule does work rather than restating the list order: a cheaper lever
  // addressing the same spend takes the promotion.
  const rearranged = [
    ...FINOPS_DESTINATIONS,
    { slug: "faster-lever", recoverableUsd: winner.recoverableUsd, effortDays: 1 },
  ];
  assert.equal(prioritizedSlug(rearranged), "faster-lever");

  // Nothing actionable is an honest absence, not a promotion of the least bad.
  assert.equal(prioritizedSlug(FINOPS_DESTINATIONS.map(
    (entry) => ({ ...entry, recoverableUsd: 0 }))), null);
});

test("the front door states one question, one number, its confidence and its provenance", () => {
  assert.equal(FINOPS_FRONT_DOOR.question, FRONT_DOOR_QUESTION);
  assert.equal((FRONT_DOOR_QUESTION.match(/\?/g) ?? []).length, 1,
    "exactly one interrogative sentence");

  const { figure } = FINOPS_FRONT_DOOR;
  // Recoverable spend for the quarter: rounded to the nearest thousand, shown
  // with a leading $ and a k/M suffix, and never a projection.
  assert.equal(figure.valueUsd, 15_600);
  assert.equal(Math.round(figure.valueUsd / 1000), 16);
  assert.match(figure.display, /^\$\d+(\.\d)?[kM]$/);
  assert.ok(CONFIDENCE_LEVELS.includes(figure.confidence),
    "confidence is one of exactly three levels");
  assert.doesNotMatch(figure.confidence, /%/, "the word, never a percentage");
  assert.match(figure.provenance, /, as of \d{4}-\d{2}-\d{2}$/);

  // The synthetic-data boundary, stated once.
  assert.equal(FINOPS_FRONT_DOOR.boundary, "All figures are synthetic demo data.");
  const stated = frontDoorEvidence().map((entry) => entry.detail).join(" ");
  assert.equal((stated.match(/synthetic demo data/g) ?? []).length, 1);
});

test("the page ships the registry's markup and nothing hand-written beside it", async () => {
  const page = await read("src/evolution.html");
  const rendered = frontDoorMarkup();
  assert.ok(page.includes(rendered),
    "src/evolution.html must ship frontDoorMarkup() byte for byte");

  // No registry string may appear on the page anywhere except inside the
  // rendered region: a second copy is a copy that can drift.
  const outside = page.split(rendered).join("");
  for (const entry of FINOPS_DESTINATIONS) {
    assert.equal(outside.includes(entry.question), false,
      `${entry.slug}'s question is authored once`);
  }
  // Each row's metric, its window and its next action are stated once, in the
  // row, and nowhere else on the page — including inside this region's own
  // working disclosure, which no longer restates them (#1611).
  for (const row of FINOPS_WORKSPACE_INDEX) {
    assert.equal(outside.includes(indexRowText(row)), false,
      `${row.slug}'s index line is authored once`);
    assert.equal((page.match(new RegExp(row.nextAction.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length,
      row.slug === prioritizedDestination().slug ? 2 : 1,
      `${row.slug}'s next action is stated once, plus the page's one recommended action`);
  }
  assert.equal(outside.includes(FINOPS_FRONT_DOOR.boundary), false,
    "the synthetic-data boundary is stated once, at the front door");
});

test("the prioritized action is the move the answer region already names", async () => {
  const page = await read("src/evolution.html");
  const document = parseHtml(page);
  const action = document.getElementById("finops-recoverable-action");
  const winner = prioritizedDestination();
  assert.equal(textOf(action), winner.nextAction,
    "the page's one next action is the registry's prioritized action");
  assert.equal(action.getAttribute("href"), winner.href,
    "and it goes where that destination goes");
});

test("the rendered front door carries three operable doors and one recommendation", async () => {
  const document = parseHtml(await read("src/evolution.html"));
  const list = document.getElementById("finops-front-door-list");
  const doors = [...list.querySelectorAll("[data-front-door-slug]")];
  // The DOORS are in the index's urgency order, which is not the registry's
  // authoring order (#1611): the registry is ordered as the page's prose
  // introduces its destinations, the doors as a leader should read them.
  assert.deepEqual(doors.map((door) => door.dataset?.frontDoorSlug),
    FINOPS_WORKSPACE_INDEX.map((row) => row.slug));
  assert.deepEqual([...doors.map((door) => door.dataset?.frontDoorSlug)].sort(), [...SLUGS].sort(),
    "the doors are the registry's destinations, reordered and not re-chosen");
  assert.deepEqual(doors.map((door) => door.getAttribute("href")),
    FINOPS_WORKSPACE_INDEX.map((row) => row.href),
    "every door is a real anchor with a real href before any script runs");
  assert.equal(
    doors.filter((door) => door.dataset?.frontDoorPrioritized === "true").length, 1,
    "exactly one door is marked recommended");

  // The region names itself without a heading: a heading here would be a second
  // question at headline weight under the page's one question.
  const region = document.getElementById("finops-front-door");
  assert.equal(region.getAttribute("aria-labelledby"), "finops-front-door-label");
  const headings = [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter((heading) => {
    for (let node = heading; node; node = node.parentNode) if (node === region) return true;
    return false;
  });
  assert.equal(headings.length, 0);
});

test("the repaint writes the registry into the region rather than reading it back", async () => {
  const document = parseHtml(await read("src/evolution.html"));
  const swapped = FINOPS_DESTINATIONS.map((entry, index) => (index === 0
    ? { ...entry, name: "Renamed door", href: "/somewhere-else.html" }
    : entry));
  assert.equal(applyFinopsFrontDoor(document, FINOPS_FRONT_DOOR, swapped), true);

  const door = [...document.getElementById("finops-front-door-list")
    .querySelectorAll("[data-front-door-slug]")]
    .find((node) => node.dataset?.frontDoorSlug === "spend-attribution");
  assert.equal(textOf(door.querySelector("strong")), "Renamed door");
  assert.equal(door.getAttribute("href"), "/somewhere-else.html");

  // A page without the region is left alone rather than thrown at.
  assert.equal(applyFinopsFrontDoor(parseHtml(await read("src/index.html"))), false);
});

// ---------------------------------------------------------------------------
// ONE QUESTION, ASKED ONCE
// ---------------------------------------------------------------------------
//
// The defect this closes is the near-duplicate re-ask: the same question stated
// again a thousand lines down, so a reader who scrolls cannot tell whether they
// are being asked something new. The walk below collects every element whose
// own text is a question and requires the set to be unique.
//
// ONE PAIR IS ALLOWED AND NAMED. `#finops-answer-question` is the classification
// panel's heading and `#finops-workspace-screen-question` is the workspace
// rail's "Now showing" label pointed at that same panel. Both are repaint slots
// filled from `src/finops-screen-contract.js`, and a wayfinder that named a
// different question from the screen it points at would be worse than the
// repetition. Any other duplicate — including a third copy of that one — fails.
const RESTATED_LABEL_PAIR = ["finops-answer-question", "finops-workspace-screen-question"];

test("no question text appears twice on the page", async () => {
  const document = parseHtml(await read("src/evolution.html"));

  // The harness rejects the universal selector, so walk the tree. An element's
  // "own text" is the text it holds directly, which is what stops a section
  // from counting every question nested inside it.
  const asked = new Map();
  const walk = (node) => {
    for (const child of node.children ?? []) {
      if (child?.nodeType !== 1) continue;
      const own = (child.children ?? [])
        .filter((leaf) => leaf?.nodeType === 3)
        .map((leaf) => leaf.textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
      if (own.endsWith("?") && own.length > 1) {
        asked.set(own, [...(asked.get(own) ?? []), child.id || ""]);
      }
      walk(child);
    }
  };
  walk(document.getElementById("main-content"));

  assert.ok(asked.size > 10, "the walk must actually be finding the page's questions");

  const duplicates = [...asked.entries()].filter(([, ids]) => ids.length > 1);
  const allowed = duplicates.filter(([, ids]) =>
    ids.length === RESTATED_LABEL_PAIR.length
    && [...ids].sort().join("|") === [...RESTATED_LABEL_PAIR].sort().join("|"));
  assert.deepEqual(
    duplicates.filter((entry) => !allowed.includes(entry)).map(([question]) => question), [],
    "a question asked twice is a reader who cannot tell what is new");
  assert.ok(allowed.length <= 1, "the one allowed restatement is a pair, never a third copy");

  // And the page's one question is asked at the top, once.
  assert.deepEqual(asked.get(FRONT_DOOR_QUESTION), [FRONT_DOOR_QUESTION_ID],
    "the page's question is asked exactly once, by the heading the registry names");
});
