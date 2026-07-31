// The words the observatory uses, held to one name per concept.
//
// tests/agent-observatory-states.test.js pins that the states are told apart;
// this file pins what they are told apart *with*. A first-time visitor has to
// be able to answer three questions from the copy alone: which source is being
// checked, what the four rows are while that source is missing, and whether
// anything is being asked of them. Those answers only work if the page says
// "public GitHub activity" and "synthetic example" the same way every time, and
// if the three regions that speak at once — the hero card, the panel status,
// and the banner above the rows — each say something the others do not.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ACTIVITY_FALLBACK_REASONS,
  ACTIVITY_STATES,
  CONNECTION_LABELS,
  loadActivity,
  renderActivityState,
} from "../src/agents.js";
import { byClass, createElement, installDocument } from "./support/dom.js";
import { parseHtml, textOf } from "./support/browser.js";

installDocument();

const PAGE_URL = new URL("../src/agents.html", import.meta.url);
const STATES = ["loading", "live", "empty", "error"];
const REASONS = ["loading", "unavailable", "empty"];

// Every sentence the panel can put on screen, whichever state it lands in.
const STATE_COPY = STATES.flatMap((state) => {
  const copy = ACTIVITY_STATES[state];
  return [copy.chip, copy.title, copy.detail, copy.keptDetail, copy.action]
    .concat((copy.links ?? []).map((link) => link.label))
    .filter(Boolean);
});
const FALLBACK_COPY = REASONS.flatMap((reason) => {
  const copy = ACTIVITY_FALLBACK_REASONS[reason];
  return [copy.chip, copy.detail];
});

function activityRoot() {
  const nodes = {
    "#activity-list": createElement("ol"),
    "#activity-status": createElement("div"),
    ".signal-card": createElement("div"),
    "#connection-label": createElement("strong"),
    "#last-updated": createElement("span"),
    "#refresh-activity": createElement("button"),
  };
  nodes["#activity-list"].querySelector = () => null;
  return { nodes, querySelector: (selector) => nodes[selector] ?? null };
}

test("the source is named 'public GitHub activity' everywhere it is named at all", async () => {
  const page = await readFile(PAGE_URL, "utf8");
  // "public repository activity", "public activity", "the public feed" and
  // "live data" were four names for one source. The word "public" now only ever
  // introduces GitHub, so a reader meets the same source name every time.
  for (const sentence of [...STATE_COPY, ...FALLBACK_COPY, page]) {
    assert.doesNotMatch(sentence, /\bpublic\b(?! GitHub)/i,
      `"public" must name the source: ${sentence.match(/[^.\n]*\bpublic\b(?! GitHub)[^.\n]*/i)?.[0]?.trim()}`);
  }
  for (const sentence of [...STATE_COPY, ...FALLBACK_COPY])
    assert.doesNotMatch(sentence, /\blive data\b/i, `"live data" is a second name for the source: ${sentence}`);
  assert.match(page, /Retry public GitHub activity/, "the comment and the state model agree on the retry label");
});

test("the rows shown without live events are always called a synthetic example", async () => {
  const page = parseHtml(await readFile(PAGE_URL, "utf8"));
  for (const reason of REASONS)
    assert.match(ACTIVITY_FALLBACK_REASONS[reason].chip, /^Synthetic example/,
      `${reason}: the banner leads with what the rows are`);
  // The boundary paragraph names the same thing the banner names, so a reader
  // who reads only one of them still learns the same word for it.
  assert.match(textOf(page.querySelector(".privacy-note")), /synthetic examples/i);
  for (const state of ["loading", "empty", "error"])
    assert.match(ACTIVITY_STATES[state].detail, /synthetic example/i, `${state}: the status discloses the rows too`);
  // "representative example" was a third name for the same four rows.
  for (const sentence of [...STATE_COPY, ...FALLBACK_COPY, textOf(page.querySelector(".privacy-note"))])
    assert.doesNotMatch(sentence, /representative example/i, sentence);
});

test("the loading state asks nothing of the reader, and the banner never offers a rival action", () => {
  assert.match(ACTIVITY_STATES.loading.detail, /Nothing is needed from you/i);
  assert.match(ACTIVITY_STATES.loading.keptDetail, /Nothing is needed from you/i);
  // The one control lives beside the status. The banner used to say "use Retry
  // to ask again", which named a button that is not next to it and reads as an
  // instruction in a state where nothing has failed.
  for (const sentence of FALLBACK_COPY)
    assert.doesNotMatch(sentence, /\b(retry|refresh|click|press|tap)\b/i, sentence);
});

test("the three regions that speak at once during a check each say something different", async () => {
  const root = activityRoot();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  // loadActivity paints the loading copy synchronously, before it awaits the
  // request, so holding the fetch open freezes the page in the state a reader
  // actually sees first.
  const pending = loadActivity(root, async () => { await gate; throw new Error("released"); });

  const card = root.nodes["#connection-label"].textContent;
  const freshness = root.nodes["#last-updated"].textContent;
  const status = byClass(root.nodes["#activity-status"], "activity-state-title")[0].textContent;
  const detail = byClass(root.nodes["#activity-status"], "activity-state-detail")[0].textContent;
  const banner = byClass(root.nodes["#activity-list"], "activity-fallback")[0].textContent;

  const spoken = [card, freshness, status, detail];
  assert.equal(new Set(spoken).size, spoken.length, `a loading message is shown twice: ${spoken.join(" | ")}`);
  assert.equal(card, CONNECTION_LABELS.loading);
  // "Not updated yet" read as a verdict on stale data in the one state where
  // nothing had been fetched yet. The line reports freshness, so while the
  // request is in flight it reports the request, in the page's one loading verb.
  assert.equal(freshness, "Loading…", "the freshness line says a fetch is in flight, not that the data is stale");
  assert.notEqual(card, status, "the hero card must not repeat the panel heading");
  // The banner answers "what are these rows", so it must not restate the
  // request status the block above it already gave.
  assert.doesNotMatch(banner, /nothing is needed from you/i);
  assert.doesNotMatch(banner, /in flight/i);
  assert.match(banner, /Synthetic example/);

  release();
  await pending;
});

// The card is the shortest thing on the page and the first thing read, so it is
// where a vague word does the most damage. "Checking" did not say what was being
// checked, and "Synthetic example shown" did not say that GitHub had answered.
test("the hero card names the signal, and says when the rows are a synthetic example", () => {
  const labels = Object.values(CONNECTION_LABELS);
  assert.equal(new Set(labels).size, labels.length, "two states share a card label");
  for (const label of labels) {
    assert.doesNotMatch(label, /^(checking|loading|unavailable|failed)\.?$/i,
      `${label}: the card must name the check, not just its verb`);
    assert.ok(label.length <= 40, `${label}: the card line stays short enough to read at a glance`);
  }

  // Which source is being checked, in the state where nothing is on screen yet.
  assert.match(CONNECTION_LABELS.loading, /GitHub/);
  assert.match(CONNECTION_LABELS.loading, /^Loading/, "a request in flight reads as a request in flight");
  // Answered-with-nothing and failed are different facts, and the card tells
  // them apart before the panel below it repeats the distinction.
  assert.match(CONNECTION_LABELS.empty, /no GitHub events/i);
  assert.match(CONNECTION_LABELS.empty, /synthetic example/i, "the rows below are named for what they are");
  assert.match(CONNECTION_LABELS.error, /failed/i);
  assert.doesNotMatch(CONNECTION_LABELS.error, /synthetic example/i,
    "a failed check can keep the last live events, so the card must not call them an example");
});

test("the served markup is the loading state the script would render", async () => {
  const page = parseHtml(await readFile(PAGE_URL, "utf8"));
  const status = page.querySelector("#activity-status");

  assert.equal(textOf(status.querySelector(".activity-state-chip")), ACTIVITY_STATES.loading.chip);
  assert.equal(textOf(status.querySelector(".activity-state-title")), ACTIVITY_STATES.loading.title);
  assert.equal(textOf(status.querySelector(".activity-state-detail")), ACTIVITY_STATES.loading.detail);
  assert.equal(textOf(page.querySelector("#refresh-activity")), ACTIVITY_STATES.loading.action);
  assert.equal(textOf(page.querySelector("#connection-label")), CONNECTION_LABELS.loading);
  assert.equal(textOf(page.querySelector("#last-updated")), "Loading…");
});

test("every section label describes what is in the section", async () => {
  const page = parseHtml(await readFile(PAGE_URL, "utf8"));
  const eyebrows = page.querySelectorAll(".eyebrow").map(textOf);

  // "On the floor" was a metaphor for a list of persona profiles, and
  // "Repository signal" named a mechanism rather than what the panel holds.
  assert.deepEqual(eyebrows, ["Synthetic engineering team", "Synthetic team", "Public GitHub activity", "Two-layer handoff"]);
  for (const label of eyebrows) assert.doesNotMatch(label, /on the floor|repository signal/i);
});

test("no two states reuse a chip, a heading, or a sentence", () => {
  const rendered = { chip: new Set(), title: new Set(), detail: new Set() };
  for (const state of STATES) {
    const root = activityRoot();
    renderActivityState(root, state, { count: 2 });
    const panel = root.nodes["#activity-status"];
    rendered.chip.add(byClass(panel, "activity-state-chip")[0].textContent);
    rendered.title.add(byClass(panel, "activity-state-title")[0].textContent);
    rendered.detail.add(byClass(panel, "activity-state-detail")[0].textContent);
  }
  for (const [what, values] of Object.entries(rendered))
    assert.equal(values.size, STATES.length, `two states share a ${what}`);
});
