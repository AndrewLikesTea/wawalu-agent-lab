// The workspace index: the ordered rows the first screen of /evolution.html is
// read as, and the pins that stop it disagreeing with anything else on the page.
//
// Four things are held here. The record SHAPE (exactly five fields, and a metric
// that is a value, a unit and an explicit window). The ORDER, checked against the
// rule rather than against itself. The JOIN to src/finops-destinations.js, field
// by field, which is what earns the right to restate those strings rather than
// import them. And the page: every row is rendered above the fold, outside any
// disclosure, pointing at something that exists.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  FINOPS_WORKSPACE_INDEX, INDEX_ORDER,
  formatIndexMetric, indexRowText, urgencyOrder, workspaceIndexRow,
} from "../src/finops-workspace-index.js";
import { FINOPS_DESTINATIONS } from "../src/finops-destinations.js";
import { parseHtml, textOf } from "./support/browser.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

const FIELDS = ["slug", "question", "metric", "nextAction", "href"];
const METRIC_FIELDS = ["value", "unit", "period"];

test("each row carries exactly the five fields, and one metric with a window", () => {
  assert.ok(FINOPS_WORKSPACE_INDEX.length > 0, "the index is not empty");
  for (const row of FINOPS_WORKSPACE_INDEX) {
    assert.deepEqual(Object.keys(row).sort(), [...FIELDS].sort(),
      `${row.slug} carries exactly the five fields and no others`);
    assert.deepEqual(Object.keys(row.metric).sort(), [...METRIC_FIELDS].sort(),
      `${row.slug}'s metric is a value, a unit and a period and nothing else`);

    assert.match(row.slug, /^[a-z]+(-[a-z]+)*$/, "slugs are stable and kebab-case");
    // The row states the LEADER's question, not a feature name.
    assert.ok(row.question.endsWith("?"), `${row.slug} states a question`);
    assert.equal(typeof row.metric.value, "number");
    assert.ok(Number.isFinite(row.metric.value), `${row.slug}'s value is a real number`);
    assert.ok(row.metric.unit.length > 0 && row.metric.unit.length <= 12,
      `${row.slug}'s unit is short enough to read inside a link`);
    // An explicit window, not a relative phrase: "last 30 days" moves under a
    // reader between two openings of the same page and a dated range does not.
    assert.match(row.metric.period, /\d{4}/, `${row.slug}'s period names a year`);
    assert.ok(row.nextAction.length > 0, `${row.slug} names one thing to do next`);
    assert.ok(row.href.length > 0, `${row.slug} says where it goes`);
  }

  // One metric per destination, never an array, and one row per destination.
  const slugs = FINOPS_WORKSPACE_INDEX.map((row) => row.slug);
  assert.equal(new Set(slugs).size, slugs.length, "no destination is indexed twice");
  assert.deepEqual(INDEX_ORDER, slugs);
  assert.equal(workspaceIndexRow(slugs[0]).slug, slugs[0]);
  assert.equal(workspaceIndexRow("no-such-destination"), null);
});

test("the order is the urgency rule's, not a hand-made list", () => {
  assert.deepEqual(INDEX_ORDER, urgencyOrder(FINOPS_DESTINATIONS),
    "recoverable spend descending, then effort ascending, then slug");

  // The rule does work rather than restating whatever order it is handed: a
  // destination that recovers more moves to the front, and an equal-recovery
  // destination that costs less effort outranks one that costs more.
  const moved = FINOPS_DESTINATIONS.map((entry) => (entry.slug === INDEX_ORDER.at(-1)
    ? { ...entry, recoverableUsd: Number.MAX_SAFE_INTEGER } : entry));
  assert.equal(urgencyOrder(moved)[0], INDEX_ORDER.at(-1));
  assert.deepEqual(
    urgencyOrder([
      { slug: "b", recoverableUsd: 10, effortDays: 9 },
      { slug: "a", recoverableUsd: 10, effortDays: 2 },
      { slug: "c", recoverableUsd: 10, effortDays: 2 },
    ]),
    ["a", "c", "b"], "effort breaks a recovery tie, and slug breaks an effort tie");
});

test("the index restates the registry and never disagrees with it", () => {
  for (const row of FINOPS_WORKSPACE_INDEX) {
    const destination = FINOPS_DESTINATIONS.find((entry) => entry.slug === row.slug);
    assert.ok(destination, `${row.slug} is a destination the registry actually has`);
    assert.equal(row.question, destination.question, `${row.slug}'s question is the registry's`);
    assert.equal(row.nextAction, destination.nextAction, `${row.slug}'s action is the registry's`);
    assert.equal(row.href, destination.href, `${row.slug}'s target is the registry's`);
  }
  assert.deepEqual([...INDEX_ORDER].sort(), FINOPS_DESTINATIONS.map((e) => e.slug).sort(),
    "every destination is indexed, and the index invents none");
});

test("a metric is formatted once, at the unit it is displayed in", () => {
  assert.equal(formatIndexMetric({ value: 154_500, unit: "USD" }), "$154,500");
  assert.equal(formatIndexMetric({ value: 5_200, unit: "USD/month" }), "$5,200/month");
  assert.equal(formatIndexMetric({ value: 100, unit: "%" }), "100%");
  assert.equal(formatIndexMetric({ value: 3.4, unit: "days" }), "3 days");
  for (const row of FINOPS_WORKSPACE_INDEX) {
    const text = indexRowText(row);
    assert.ok(text.includes(row.metric.period), `${row.slug}'s window is on screen`);
    assert.ok(text.includes(row.nextAction), `${row.slug}'s next action is on screen`);
  }
});

test("every row is rendered above the fold, outside any disclosure", async () => {
  const page = await read("src/evolution.html");
  const document = parseHtml(page);
  const list = document.getElementById("finops-front-door-list");
  const doors = [...list.querySelectorAll("[data-front-door-slug]")];

  assert.deepEqual(doors.map((door) => door.dataset?.frontDoorSlug), INDEX_ORDER,
    "the document ships the rows in the index's order before any script runs");

  for (const row of FINOPS_WORKSPACE_INDEX) {
    const door = doors.find((node) => node.dataset?.frontDoorSlug === row.slug);
    assert.equal(door.getAttribute("href"), row.href);
    const reading = door.querySelector(`[data-index-reading="${row.slug}"]`);
    assert.equal(textOf(reading), indexRowText(row),
      `${row.slug}'s metric, window and next action are in the row itself`);

    // NOT INSIDE A DISCLOSURE. The harness reads through a shut `details`
    // element, so the DOM ancestry is what has to be asserted: a row folded into
    // one is silent for a scanning reader while every text assertion above still
    // passes.
    for (let node = door; node; node = node.parentNode) {
      assert.notEqual(node.tagName?.toLowerCase?.(), "details",
        `${row.slug}'s row must not be behind a disclosure`);
    }
  }
});

test("no row is a dead end", async () => {
  const page = await read("src/evolution.html");
  const document = parseHtml(page);
  for (const row of FINOPS_WORKSPACE_INDEX) {
    if (row.href.startsWith("#")) {
      // An in-page destination resolves to a region this document actually has.
      assert.ok(document.getElementById(row.href.slice(1)),
        `${row.href} must be an anchor src/evolution.html ships`);
      continue;
    }
    assert.match(row.href, /^\/[a-z0-9-]+\.html$/, `${row.slug} points at a page`);
    await assert.doesNotReject(read(`src/${row.href.slice(1)}`),
      `${row.href} must be a page this repository ships`);
  }
});
