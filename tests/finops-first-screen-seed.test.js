// The AI FinOps first screen, as the build ships it.
//
// THE DEFECT (#944). /evolution.html opened on three stacked empty states —
// "Results will appear here", "Nothing has been read yet, so there is no
// coverage, grade, or residue to report", six "not checked" rows, and "Waiting
// for compatible bundled analysis" — while the bundled example analysis it was
// waiting for is composed by modules in this repository and stated in full two
// screens further down the same document. scripts/seed-first-screen.mjs renders
// that answer into the document at build time.
//
// WHAT THIS FILE OWNS, and it is the property the change lives or dies on: the
// seeded document and the painted page say the SAME THING. Every seeded slot is
// compared against what the real page entry paints into the same slot at boot,
// so a figure cannot drift between the served HTML and the render. The seed
// holds no figure of its own — it reads the modules the page reads — and this
// suite is what proves that claim rather than restating it.
//
// tests/finops-pre-analysis-empty-state.test.js still owns what a paint with no
// payload may say, and it is unchanged: the pending wording did not go away, it
// moved from "what the page opens with" to "what an in-flight or failed
// analysis falls back to". The last test here pins that move.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, parseHtml, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  escapeText, firstScreenEdits, loadBundledSeed, seedDocument,
} from "../scripts/seed-first-screen.mjs";
import { ANSWER_ANNOUNCER_ID, announceAnswer } from "../src/finops-answer-announcement.js";
import { PROJECTION_STATUS_PREFIX } from "../src/executive-briefing-projection-view.js";
import { DECISION_SUMMARY } from "../src/finops-screen-contract.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const SOURCE = await readFile(PAGE, "utf8");
const BUNDLED = await loadBundledSeed();
const SEEDED = seedDocument(SOURCE, firstScreenEdits(BUNDLED));

const DEMO_DATA = JSON.parse(
  await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

/**
 * The pending strings the page used to open on. Each one is still the right
 * thing to say in some state; none of them may be the state a visitor lands in.
 */
const PENDING = Object.freeze([
  "Results will appear here",
  "Nothing has been read yet, so there is no coverage, grade, or unclassified spend to report.",
  "Headline finding not checked.",
  "Benchmark not checked.",
  "Action not checked.",
  "Confidence not checked.",
  "Source period not checked.",
  "Exclusions not checked.",
  "Checking required evidence…",
  "Waiting for compatible bundled analysis.",
]);

/** Every slot whose text the build seeds, in document order. */
const SEEDED_TEXT = Object.freeze([
  "finops-stand-claim",
  "finops-answer-label", "finops-answer-value", "finops-answer-direction",
  "finops-answer-basis", "finops-answer-confidence", "finops-answer-action",
  "briefing-readiness-verdict", "briefing-readiness-finding", "briefing-readiness-benchmark",
  "briefing-readiness-action", "briefing-readiness-confidence", "briefing-readiness-period",
  "briefing-readiness-boundary",
  "finops-stand-answer",
  "finops-stand-evidence", "finops-stand-confidence",
  "finops-stand-recoverable-value", "finops-stand-recoverable-basis",
  "finops-stand-position-value", "finops-stand-position-basis",
  "finops-stand-team-name", "finops-stand-team-detail",
  "finops-stand-action", "finops-stand-action-basis",
  ANSWER_ANNOUNCER_ID,
]);

/** Every state attribute the build seeds: the element, and the attribute on it. */
const SEEDED_STATE = Object.freeze([
  ["finops-stand", "data-state"], ["finops-stand", "data-position"],
  ["finops-stand", "data-source"], ["finops-stand", "data-finding"],
  ["finops-answer", "data-state"], ["finops-answer", "data-available"],
  ["briefing-readiness", "data-state"],
  ["executive-briefing-projection", "data-state"],
  ["finops-stand-entitlement", "data-available"],
  ["finops-stand-entitlement", "data-evidence"],
  ["finops-stand-entitlement", "data-confidence"],
  ["finops-stand-position-value", "data-available"],
  ["finops-stand-recoverable-value", "data-available"],
  ["finops-stand-team", "data-available"],
]);

const seededDocument = () => parseHtml(SEEDED);

/**
 * The real page, booted from the real entry, with its two bundled fixtures.
 *
 * `markup` is what the build serves; omitting it boots the authored source. Both
 * are exercised below, because the two questions are different: does the seed
 * agree with the paint, and does the paint survive landing on a seeded document.
 */
async function bootedPage(markup = null) {
  const page = await loadPage(PAGE, {
    markup,
    storage: {},
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  return page.document;
}

test("every seeded slot matches the authored markup exactly once", () => {
  // seedDocument throws by name when a `find` matches zero or two elements, so
  // reaching here is the assertion. The count is stated so a slot cannot be
  // quietly dropped from the seed and leave this suite still green.
  const edits = firstScreenEdits(BUNDLED);
  // 34 through #1183, plus the three money-bearing slots of the answer region
  // the build now derives instead of the markup authoring (#1184).
  assert.equal(edits.length, 37, "the seed covers 37 first-screen slots");
  for (const { slot, find } of edits) {
    assert.equal(SOURCE.split(find).length - 1, 1, `${slot} matches the authored markup once`);
  }
});

test("the shipped first screen opens on the bundled example, not on a pending state", () => {
  const document = seededDocument();
  const stand = textOf(document.getElementById("finops-stand"));
  for (const pending of PENDING) {
    assert.equal(SEEDED.includes(pending), false,
      `"${pending}" may not be what a visitor lands on`);
  }
  // The headline share and the figure behind it, on the first screen, with no
  // interaction and no script.
  assert.match(textOf(document.getElementById("finops-stand-recoverable-value")),
    /^\$[\d,]+ · \d+% of analyzed spend$/);
  assert.match(textOf(document.getElementById("finops-stand-recoverable-basis")),
    /^\$[\d,]+ of \$[\d,]+ analyzed\./);
  // No slot may be left carrying a fragment of a value that never arrived.
  for (const id of SEEDED_TEXT) {
    const text = textOf(document.getElementById(id));
    assert.notEqual(text, "", `${id} is seeded with a value`);
    assert.doesNotMatch(text, /undefined|NaN|\bnull\b/, `${id} carries no absent value`);
  }
  // The four circulation rows the panel used to report as "not checked" now
  // carry their bundled value, and the region says so in a channel that is not
  // colour: the verdict is a sentence and the state is an attribute.
  assert.equal(document.getElementById("briefing-readiness").getAttribute("data-state"),
    "complete");
  assert.equal(textOf(document.getElementById("briefing-readiness-verdict")),
    "Ready to circulate");
  // The briefing's own entry points are authored anchors and still are.
  assert.equal(stand.includes("Bundled synthetic example"), true,
    "the synthetic-data marker is on the first screen with the figures it qualifies");
});

test("the seeded document and the booted page say the same thing", async () => {
  const seeded = seededDocument();
  const painted = await bootedPage();
  for (const id of SEEDED_TEXT) {
    const before = textOf(seeded.getElementById(id));
    const after = textOf(painted.getElementById(id));
    assert.equal(before, after, `${id} drifted between the seed and the paint`);
  }
  for (const [id, attribute] of SEEDED_STATE) {
    assert.equal(seeded.getElementById(id).getAttribute(attribute),
      painted.getElementById(id).getAttribute(attribute),
      `${id}[${attribute}] drifted between the seed and the paint`);
  }
  // The one seeded string that is a prefix rather than a whole sentence: the
  // payload status carries the instant the reader's own browser regenerated the
  // briefing, and no clock may be written into the shipped document.
  const status = textOf(painted.getElementById("executive-briefing-projection-status"));
  const seededStatus = textOf(seeded.getElementById("executive-briefing-projection-status"));
  assert.equal(seededStatus, PROJECTION_STATUS_PREFIX("executive-briefing/1.0.0"));
  assert.equal(status.startsWith(seededStatus), true,
    "the paint completes the seeded status rather than replacing it");
  // The action the block ends on is one anchor with a real destination in both.
  assert.equal(seeded.getElementById("finops-answer-action").getAttribute("href"),
    painted.getElementById("finops-answer-action").getAttribute("href"));
});

test("the first screen's figures are the Example result section's figures", async () => {
  const painted = await bootedPage();
  const seeded = seededDocument();
  // The two sections are painted from different composers over one fixture, so
  // the money and the share they state have to be the same money and share.
  const example = textOf(painted.getElementById("finops-first-run-benchmark-detail"));
  const amount = example.match(/\$[\d,]+ of \$[\d,]+ analyzed/)?.[0];
  const share = textOf(painted.getElementById("finops-first-run-benchmark-value"))
    .match(/\d+%/)?.[0];
  assert.ok(amount, "the Example result section states the analyzed amount");
  assert.ok(share, "the Example result section states the recoverable share");
  assert.equal(
    textOf(seeded.getElementById("finops-stand-recoverable-basis")).startsWith(amount), true,
    "the seeded first screen states the Example result section's amount");
  assert.equal(
    textOf(seeded.getElementById("finops-stand-recoverable-value")).includes(share), true,
    "the seeded first screen states the Example result section's share");
});

test("the page booting onto the served document changes nothing on it", async () => {
  // The document a visitor is actually served, driven by the real page entry.
  // A seeded slot that the boot paint doubles, blanks, or reverts to its pending
  // wording is a first screen that flickers on every load, and it is invisible
  // to any test that only ever boots the authored source.
  const seeded = seededDocument();
  const painted = await bootedPage(SEEDED);
  for (const id of SEEDED_TEXT) {
    assert.equal(textOf(painted.getElementById(id)), textOf(seeded.getElementById(id)),
      `${id} changed when the page booted onto the served document`);
  }
  for (const [id, attribute] of SEEDED_STATE) {
    assert.equal(painted.getElementById(id).getAttribute(attribute),
      seeded.getElementById(id).getAttribute(attribute),
      `${id}[${attribute}] changed when the page booted onto the served document`);
  }
  // The four blocks the source ships `hidden` carry figures now, so none of them
  // may still be out of the layout and out of the accessibility tree.
  assert.equal(painted.getElementById("finops-stand-team").hidden, false);
  assert.equal(painted.getElementById("finops-stand-evidence").hidden, false);
  // …and the withheld path, which has nothing to resolve, stays out of it.
  assert.equal(painted.getElementById("finops-stand-withheld").hidden, true);
  // One sentence in the announcer, not two: the boot paint left it alone.
  assert.equal(textOf(painted.getElementById(ANSWER_ANNOUNCER_ID)).match(/Where do we stand/g).length,
    1);
});

test("the pending wording moved to the in-flight state rather than going away", () => {
  // The four slots of the answer figure fall back to the contract's authored
  // pending words when a paint arrives with nothing in them — which is what an
  // analysis that is still being read, or one that was rejected, leaves on
  // screen. They are read off the contract rather than off the document now, so
  // seeding the document could not have taken them with it.
  const slots = DECISION_SUMMARY.parts.find((part) => part.role === "metric").slots;
  assert.equal(slots.value.authored, "Results will appear here");
  assert.equal(slots.direction.authored, "Results will appear when preparation is complete");
  // And the seeded document still escapes every value it writes, so a fixture
  // string can never become markup.
  assert.equal(escapeText('<img src=x onerror="1">'),
    "&lt;img src=x onerror=\"1\"&gt;");
});

test("a boot paint of the answer the document already carries announces nothing", () => {
  const document = seededDocument();
  const region = document.getElementById(ANSWER_ANNOUNCER_ID);
  const seededSentence = textOf(region);
  let writes = 0;
  const counting = {
    getElementById: (id) => (id === ANSWER_ANNOUNCER_ID
      ? { get textContent() { return seededSentence; }, set textContent(_value) { writes += 1; } }
      : document.getElementById(id)),
  };
  announceAnswer(counting, seededSentence, { announce: false });
  assert.equal(writes, 0, "an unchanged sentence is not rewritten, so nothing is spoken");
  announceAnswer(counting, `${seededSentence} And one more thing.`, { announce: false });
  assert.equal(writes, 1, "a boot that composed a different sentence still gets it, written once");
  announceAnswer(counting, seededSentence);
  assert.equal(writes, 3, "a real answer change is still blanked and re-set, so it is spoken");
});

// ---------------------------------------------------------------------------
// THE LEAD FINDING (#956). One region, one number, one department, one action.
//
// The page used to answer "how much of our AI spend is recoverable, and what
// should we do first?" twice over: the classification verdict led with "Not
// enough scored to stand behind", and the recoverable figure — the answer to
// the question actually being asked — sat three cards below it at card weight,
// while #finops-first-run stated it again at full headline weight two screens
// down. These assertions hold the order the served document now ships in, and
// they hold it on the SEEDED markup rather than on a paint, because what a
// leader lands on is the bytes, not the render.
// ---------------------------------------------------------------------------

/** Where an id sits in the served document, as a byte offset. Order, not layout. */
const positionOf = (id) => SEEDED.indexOf(`id="${id}"`);

test("the lead finding leads with the recoverable figure, its department, and one action", () => {
  const document = seededDocument();
  // The one material number, on load, formatted the way the page formats it.
  assert.match(textOf(document.getElementById("finops-stand-recoverable-value")),
    /^\$[\d,]+ · \d+% of analyzed spend$/);
  // The department driving it, named in text.
  assert.ok(textOf(document.getElementById("finops-stand-team-name")).trim().length > 0,
    "the driving department is named in the served document");
  assert.equal(document.getElementById("finops-stand-team").dataset.available, "true");
  // One action, and it is a real anchor the reader can take before any script
  // runs. The `hidden` it ships with is dropped by the same seed edit that gives
  // it its label, so an action that never composed stays out of the tree rather
  // than shipping empty.
  const action = document.getElementById("finops-stand-action");
  assert.equal(action.hasAttribute("hidden"), false);
  assert.ok(action.getAttribute("href"), "the action is a real link, not a scripted control");
  const label = textOf(action).trim();
  assert.ok(label.length > 0, "the action carries its label in the served bytes");
  for (const placeholder of PENDING) assert.notEqual(label, placeholder);
  assert.equal(/^(—|-|…)$/.test(label), false, "the action is never a dash or an ellipsis");
  assert.ok(textOf(document.getElementById("finops-stand-action-basis")).trim().length > 0,
    "and the reason to take it travels with it");

  // And the order: the answer sentence, the number, the department, the action —
  // every one of them ahead of the classification verdict that used to lead.
  const lead = ["finops-stand-answer", "finops-stand-recoverable-value",
    "finops-stand-team-name", "finops-stand-action"].map(positionOf);
  assert.deepEqual(lead, [...lead].sort((left, right) => left - right),
    "the lead finding is in the order it is spoken");
  assert.ok(Math.max(...lead) < positionOf("finops-answer-value"),
    "the classification verdict follows the finding rather than leading it");
  assert.ok(Math.max(...lead) < positionOf("briefing-readiness-verdict"),
    "the circulation checklist follows the finding too");
});

test("the provenance label in the lead finding names the bundled sample on load", () => {
  const document = seededDocument();
  const marker = document.getElementById("finops-stand-sample");
  assert.equal(marker.dataset.source ?? "example", "example");
  assert.match(textOf(marker), /Bundled synthetic example/);
  // The eyebrow above the question says the same thing, and neither of them
  // claims the reader imported anything.
  assert.match(textOf(document.getElementById("finops-stand-label")),
    /Bundled synthetic example/);
  assert.equal(/Imported/.test(textOf(marker)), false);
});

test("every demoted signal keeps its id and its computed value", () => {
  const document = seededDocument();
  // Nothing was dropped when the finding moved above it. Each of these is the
  // same node with the same id, still carrying the value the build computed for
  // it, one step below the finding instead of level with it.
  const demoted = {
    "finops-answer-value": /\S/,
    "finops-answer-label": /\S/,
    "finops-answer-confidence": /\S/,
    "finops-stand-position-value": /per successful task$/,
    "finops-stand-position-basis": /\S/,
    "finops-stand-evidence": /\S/,
    "finops-stand-confidence": /\S/,
    "briefing-readiness-verdict": /\S/,
    "finops-stand-answer": /\S/,
  };
  for (const [id, shape] of Object.entries(demoted)) {
    const node = document.getElementById(id);
    assert.equal(node?.id, id, `${id} is still in the document`);
    assert.match(textOf(node), shape, `${id} still carries its computed value`);
  }
  // The position figure is still declared available, so it was demoted in
  // reading order rather than suppressed.
  assert.equal(document.getElementById("finops-stand-position-value").dataset.available, "true");
});
