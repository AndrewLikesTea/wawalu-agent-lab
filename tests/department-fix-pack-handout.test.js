// The department fix pack as something a reader can check, keyboard, and hand on.
//
// Two things are proved here and nothing else is duplicated from the scorer's
// own suite:
//
//   1. **Keyboard disclosure behaviour** — on the shipped markup, through the
//      page entry, driven by real key events. A control that reports the wrong
//      expanded state, loses its place in the tab order, or paints its content
//      only after being pressed is a defect this file fails on.
//   2. **Print-ready output and order** — the five slots of the handout appear
//      in the declared order in the DOM, and `@media print` shows the evidence
//      whether or not the reader opened it.
//
// Every figure asserted is derived from the scorer in the test, so a weight
// change moves the expectation and the assertion together.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, pressEnter, pressSpace, pressTab, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { scoreDepartmentIntervention } from "../src/department-intervention-scoring.js";
import {
  computedFixPackEvidence, FIX_PACK_READING_ORDER, reviewedFixPackEvidence,
  unavailableFixPackEvidence,
} from "../src/department-fix-pack-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const load = async (name) => JSON.parse(await readFile(new URL(`../src/${name}`, import.meta.url), "utf8"));

const DEMO_DATA = await load("evolution-demo-data.json");
const EVALUATION_FIXTURES = await load("finops-evaluation-fixtures.json");
const OVERSPEND_FIXTURE = await load("model-overspend-finding-fixture.json");
const CSS = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
const HTML = await readFile(PAGE, "utf8");

const UNREVIEWED = DEMO_DATA.departments.find(
  (department) => department.actionPlan?.status === "unavailable");
const REVIEWED = DEMO_DATA.departments.find(
  (department) => department.actionPlan?.status === "completed");

async function openPage(data = DEMO_DATA) {
  const page = await loadPage(PAGE, {
    routes: {
      "/evolution-demo-data.json": data,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
      "/model-overspend-finding-fixture.json": OVERSPEND_FIXTURE,
    },
  });
  await importPageModule("/evolution-page.js");
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");
  return page;
}

function drillInto(document, departmentId) {
  const button = [...document.getElementById("department-priority").querySelectorAll("button")]
    .find((candidate) => candidate.dataset.departmentId === departmentId);
  assert.ok(button, `no priority-list button for ${departmentId}`);
  button.click();
  return button;
}

// ---------------------------------------------------------------------------
// 1. Keyboard disclosure behaviour
// ---------------------------------------------------------------------------

test("the pattern-evidence control is a button that reports its own state", async () => {
  const page = await openPage();
  const { document } = page;
  drillInto(document, UNREVIEWED.id);

  const toggle = document.getElementById("action-evidence-toggle");
  const panel = document.getElementById("action-evidence-panel");
  assert.equal(toggle.tagName, "BUTTON");
  assert.equal(toggle.getAttribute("type"), "button");
  // It owns the region by id, so the relationship survives the two of them not
  // being siblings on a future layout.
  assert.equal(toggle.getAttribute("aria-controls"), "action-evidence-panel");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(panel.hidden, true);
  // Closed, the label still says what pressing it opens and how much of it.
  assert.match(textOf(toggle), /^Show pattern evidence \(\d+ items?\)$/);
});

test("Enter and Space open and close it, and focus never leaves the control", async () => {
  const page = await openPage();
  const { document } = page;
  drillInto(document, UNREVIEWED.id);

  const toggle = document.getElementById("action-evidence-toggle");
  const panel = document.getElementById("action-evidence-panel");
  toggle.focus();
  assert.equal(document.activeElement, toggle);

  pressEnter(document);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(panel.hidden, false);
  assert.match(textOf(toggle), /^Hide pattern evidence \(\d+ items?\)$/);
  // The reader's place is where they left it: nothing around the button is
  // rebuilt when it is pressed, so focus is never dropped at the document top.
  assert.equal(document.activeElement, toggle);

  pressSpace(document);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(panel.hidden, true);
  assert.equal(document.activeElement, toggle);
});

test("the control is reachable by Tab and stays in the sequence in every state", async () => {
  const page = await openPage();
  const { document } = page;
  drillInto(document, UNREVIEWED.id);
  const toggle = document.getElementById("action-evidence-toggle");

  assert.equal(toggle.hasAttribute("disabled"), false);
  assert.equal(toggle.getAttribute("tabindex"), null);

  // From the department button a reader pressed, forward: the evidence control
  // is reached by Tab alone, in document order, with no trap in between.
  document.getElementById("department-priority").querySelectorAll("button")[0].focus();
  let reached = false;
  for (let step = 0; step < 40 && !reached; step += 1) reached = pressTab(document) === toggle;
  assert.ok(reached, "Tab never reaches the pattern-evidence control");

  // And it survives the state a reader is most likely to meet it in: an
  // unavailable department still offers the control, which then explains itself
  // rather than vanishing and taking a tab stop with it.
  drillInto(document, REVIEWED.id);
  assert.equal(document.getElementById("action-evidence-toggle").hasAttribute("disabled"), false);
});

test("selecting another department repaints the evidence without reopening it", async () => {
  const page = await openPage();
  const { document } = page;
  drillInto(document, UNREVIEWED.id);
  const toggle = document.getElementById("action-evidence-toggle");
  const panel = document.getElementById("action-evidence-panel");
  const computed = textOf(panel);

  drillInto(document, REVIEWED.id);
  // A reviewed department's evidence is its own, and the disclosure does not
  // spring open behind the reader's back.
  assert.notEqual(textOf(panel), computed);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(panel.hidden, true);
  assert.match(textOf(panel), /reviewed intervention/i);
});

// ---------------------------------------------------------------------------
// 2. The reading order, on screen and on paper
// ---------------------------------------------------------------------------

test("the shipped markup carries the five handout slots in the declared order", () => {
  const positions = FIX_PACK_READING_ORDER.map((id) => {
    const at = HTML.indexOf(`id="${id}"`);
    assert.ok(at >= 0, `the page does not ship #${id}`);
    return at;
  });
  const sorted = [...positions].sort((first, second) => first - second);
  assert.deepEqual(positions, sorted,
    `the DOM order is not ${FIX_PACK_READING_ORDER.join(" → ")}`);
});

test("the painted card reads action, value, confidence, provenance, evidence", async () => {
  const page = await openPage();
  const { document } = page;
  drillInto(document, UNREVIEWED.id);

  const expected = computedFixPackEvidence(scoreDepartmentIntervention(UNREVIEWED));
  assert.equal(textOf(document.getElementById("action-evidence-summary")), expected.summary);
  // Every slot before the evidence says something; a handout with a blank in
  // the sequence is a handout that lost the step it was meant to justify.
  for (const id of FIX_PACK_READING_ORDER.slice(0, 4)) {
    assert.notEqual(textOf(document.getElementById(id)).trim(), "");
  }
  const panel = textOf(document.getElementById("action-evidence-panel"));
  for (const row of expected.rows) assert.ok(panel.includes(row.label), `missing row: ${row.label}`);
  // The promise travels with the numbers, in the panel, in every state.
  assert.match(panel, /Prompt text withheld/);
});

test("a reviewed plan answers monthly value in the same unit and time basis", async () => {
  const page = await openPage();
  const { document } = page;
  drillInto(document, REVIEWED.id);

  assert.equal(textOf(document.getElementById("action-impact")),
    `${new Intl.NumberFormat("en-US", {
      style: "currency", currency: "USD", maximumFractionDigits: 0,
    }).format(REVIEWED.actionPlan.estimatedSavingsUsd)} per 30-day month`);
});

test("the evidence panel is painted while it is still closed, so print can show it", async () => {
  const page = await openPage();
  const { document } = page;
  drillInto(document, UNREVIEWED.id);
  const panel = document.getElementById("action-evidence-panel");

  assert.equal(panel.hidden, true);
  // Content first, disclosure second. Evidence that only exists after a press
  // is evidence a printed handout would lose.
  assert.ok(textOf(panel).length > 80, "the closed panel is empty, so print would print nothing");
  assert.ok(panel.querySelectorAll("dt").length >= 3);
});

// --- the stylesheet --------------------------------------------------------

const withoutComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const CLEAN = withoutComments(CSS);

/** The `@media print` block, brace-balanced, without its wrapper. */
function printBlock(sheet) {
  const start = sheet.indexOf("@media print");
  assert.ok(start >= 0, "the sheet has no @media print block at all");
  let depth = 0;
  for (let i = sheet.indexOf("{", start); i < sheet.length; i += 1) {
    if (sheet[i] === "{") depth += 1;
    else if (sheet[i] === "}") {
      depth -= 1;
      if (depth === 0) return sheet.slice(sheet.indexOf("{", start) + 1, i);
    }
  }
  throw new Error("unbalanced @media print block");
}

const PRINT = printBlock(CLEAN);

test("print shows the evidence whether or not the reader opened it", () => {
  // The `hidden` attribute is a user-agent `display:none`; an author rule of any
  // specificity outranks it, so this needs no `!important` and reverts nothing.
  assert.match(PRINT, /\.action-evidence-panel\[hidden\][^{]*\{[^}]*display\s*:\s*grid/);
  // And the dead control goes, rather than printing as something the reader
  // failed to press.
  assert.match(PRINT, /\.action-evidence-toggle[^{]*\{[^}]*display\s*:\s*none/);
});

test("print opens the disclosure the drill-down lives inside", () => {
  // Without this the whole handout prints as one collapsed summary line.
  assert.match(PRINT, /\.support-disclosure::details-content[^{]*\{[^}]*content-visibility\s*:\s*visible/);
  assert.match(PRINT, /\.support-disclosure:not\(\[open\]\)>\*:not\(summary\)[^{]*\{[^}]*display\s*:\s*block/);
});

test("nothing essential is split across a sheet or left tinted", () => {
  assert.match(PRINT, /\.action-result[^{]*\{[^}]*break-inside\s*:\s*avoid/);
  assert.match(PRINT, /\.action-result[^{]*\{[^}]*background\s*:\s*#fff/);
  // The lead and its facts stay with the figure they qualify.
  assert.match(PRINT, /\.action-lead,\.action-rationale[^{]*\{[^}]*break-after\s*:\s*avoid/);
  assert.match(PRINT, /\.action-evidence-rows>dt,\.action-evidence-value[^{]*\{[^}]*break-inside\s*:\s*avoid/);
});

// --- contrast and the no-colour-alone rule ---------------------------------

function channel(part) {
  const value = part / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(first, second) {
  const [high, low] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

test("every colour this block introduces clears its contrast floor", () => {
  const panel = "#f3f8f5";  // .action-result
  const white = "#ffffff";  // .action-evidence-panel
  // Body and caption text, 4.5:1.
  assert.ok(contrast("#244c3c", panel) >= 4.5, "the evidence toggle ink fails on the card");
  assert.ok(contrast("#6f6f69", white) >= 4.5, "the row note fails on the panel");
  assert.ok(contrast("#3f3f3a", white) >= 4.5, "the redaction line fails on the panel");
  assert.ok(contrast("#245643", "#dceae3") >= 4.5, "the status word fails in its chip");
  // The control's own edge is the only thing that says "control": 3:1 non-text.
  assert.ok(contrast("#315f50", panel) >= 3, "the toggle edge fails the non-text floor");
});

test("the status is a word and a shape, never a tint alone", async () => {
  const page = await openPage();
  const { document } = page;
  drillInto(document, REVIEWED.id);

  const shape = document.getElementById("action-status-shape");
  assert.equal(shape.getAttribute("aria-hidden"), "true", "the shape is announced as well as seen");
  assert.notEqual(shape.textContent.trim(), "");
  assert.notEqual(textOf(document.getElementById("action-status")).trim(), "");
  // The word changes with the state, not only the glyph beside it.
  const reviewedWord = textOf(document.getElementById("action-status"));
  const reviewedShape = shape.textContent;
  drillInto(document, UNREVIEWED.id);
  assert.notEqual(textOf(document.getElementById("action-status")), reviewedWord);
  assert.notEqual(document.getElementById("action-status-shape").textContent, reviewedShape);
});

// ---------------------------------------------------------------------------
// 3. The states that do not demo well
// ---------------------------------------------------------------------------

test("an unavailable department still reads as a state, not a blank", () => {
  const model = unavailableFixPackEvidence("The bundled example never loaded.");
  assert.equal(model.state, "unavailable");
  assert.match(model.summary, /never loaded/);
  assert.ok(model.rows.length >= 1, "an unavailable state with no rows is a blank box");
  assert.match(model.redaction, /No prompt text/);
});

test("a refusal to score names the candidates rather than shrugging", () => {
  // A department below the grading floor: the scorer refuses, and the evidence
  // has to say what it refused and why, not print a small number quietly.
  const thin = { ...UNREVIEWED, sampling: { ...UNREVIEWED.sampling, sampledQueries: 3 } };
  const scored = scoreDepartmentIntervention(thin);
  const model = computedFixPackEvidence(scored);
  assert.equal(scored.outcome, "insufficient_evidence");
  assert.match(model.summary, /No intervention is recommended/);
  assert.ok(model.rows.some((row) => row.label === "Why there is no action"));
  assert.ok(model.chips.includes("no dollar value claimed"));
  assert.equal(model.arithmetic, null, "a refusal must not publish arithmetic for a figure it withheld");
});

test("an implausible extreme is still a readable row, never NaN or Infinity", () => {
  // A pasted invoice off by six orders of magnitude, a period of one day, and a
  // mix that is entirely one category. The handout has to stay a handout.
  const extreme = {
    ...UNREVIEWED,
    spendUsd: 9.9e12,
    periodDays: 1,
    mix: { highValue: 0, overProvisioned: 1, inefficient: 0, outOfScope: 0 },
    sampling: { status: "available", sampledQueries: 4_000_000 },
    patterns: { repeatedShapeShare: 1 },
  };
  const model = computedFixPackEvidence(scoreDepartmentIntervention(extreme));
  const printed = [model.summary, ...model.rows.map((row) => `${row.value} ${row.note ?? ""}`)].join(" ");
  assert.doesNotMatch(printed, /NaN|Infinity|undefined|null/);
  for (const row of model.rows) assert.equal(typeof row.value, "string");
});

test("a zero-spend department claims no dollar figure at all", () => {
  const broke = { ...UNREVIEWED, spendUsd: 0, sampling: { status: "available", sampledQueries: 900 } };
  const model = computedFixPackEvidence(scoreDepartmentIntervention(broke));
  assert.match(model.summary, /no AI spend|no recoverable/i);
  assert.ok(model.rows.every((row) => !/\$\d/.test(row.value) || /\$0/.test(row.value)),
    "a department with no spend was handed a dollar figure anyway");
});

test("a reviewed plan's evidence is its own arithmetic, with no computed rival", () => {
  const action = {
    available: true, status: "completed", statusLabel: "Simulation completed",
    baselineUsd: 42000, targetUsd: 31000, estimatedSavingsUsd: 11000,
    realizedSavingsUsd: 9400, accountableRole: "AI Platform product owner",
    provenance: "Reviewed intervention record", diagnosis: "Routing rule shipped in week 2.",
  };
  const model = reviewedFixPackEvidence(action, "Platform Engineering");
  assert.match(model.summary, /reviewed intervention/i);
  assert.ok(model.chips.includes("no computed candidates"));
  assert.ok(model.rows.some((row) => row.label === "Baseline"));
  assert.equal(model.rows.find((row) => row.label === "Expected monthly value").value,
    "$11,000 per 30-day month");
  assert.ok(model.rows.some((row) => row.label === "Simulated realized"));
  assert.ok(model.rows.every((row) => !row.label.startsWith("Candidate")),
    "a rule's candidates leaked into a human's reviewed result");
  assert.match(model.arithmetic, /baseline/);
});

test("an unsimulated reviewed plan says so rather than printing a zero", () => {
  const model = reviewedFixPackEvidence({
    available: true, status: "planned", statusLabel: "Planned",
    baselineUsd: 1000, targetUsd: 800, estimatedSavingsUsd: 200, realizedSavingsUsd: null,
  }, "Mobile");
  const realized = model.rows.find((row) => row.label === "Simulated realized");
  assert.equal(realized.value, "Not simulated");
  assert.match(realized.note, /no realized figure is claimed/);
});

// ---------------------------------------------------------------------------
// 4. The duplicate id this change removed
// ---------------------------------------------------------------------------

test("the drill-down evidence list no longer shares an id with the evidence panel", async () => {
  assert.equal(HTML.split('id="department-evidence"').length - 1, 1,
    "two elements share the id department-evidence again");
  const page = await openPage();
  const { document } = page;
  drillInto(document, REVIEWED.id);
  // The panel further up the page keeps the slots its own view paints into;
  // the drill-down list is filled instead of emptying them.
  assert.ok(document.getElementById("department-evidence-body"),
    "the evidence panel's body was destroyed by the drill-down again");
  assert.ok(document.getElementById("department-evidence-list"));
});
