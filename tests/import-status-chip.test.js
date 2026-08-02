// Expanded-provider import evidence: the chip vocabulary, and the four things a
// reader who does not see colour needs from it (#931).
//
// The regression this file guards hardest is not a chip at all. The previous
// attempt at this issue put a fixed pixel width into `evolution.css` below the
// `.spend-per-delivery` rule, and two tests in
// `tests/spend-per-delivery-surface.test.js` — which slice the stylesheet from
// that rule to the end of the file — went red on a panel this work never
// touched. So the width discipline is asserted here too, over the block this
// change actually adds, rather than being left to a neighbour's test to catch.
//
// Everything else here is drawn from the shipped markup and the shipped tokens:
// no colour is transcribed, and no contrast figure is asserted by eye.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, pressEnter, tabSequence, textOf } from "./support/browser.js";
import {
  MAX_CONFIDENCE, RECOGNITION_BANDS, RECOGNITION_OUTCOMES,
} from "../src/export-recognition.js";
import { RECOGNITION_FIXTURES } from "../src/export-recognition-fixtures.js";
import { INTAKE_STATES, buildIntake } from "../src/provider-native-import.js";
import { nativeExampleById } from "../src/provider-native-import-fixtures.js";
import {
  CHIP_KINDS, IMPORT_STATUS, IMPORT_STATUS_CHIPS, importStatusChip, intakeStatus, isUnsettled,
  recognitionStatus,
} from "../src/import-status-chip.js";
import {
  RESOLVE_ID, renderProviderImport,
} from "../src/provider-native-import-view.js";
import { initExportRecognition, renderExportRecognition } from "../src/export-recognition-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const STYLESHEET = new URL("../src/evolution.css", import.meta.url);
const css = await readFile(STYLESHEET, "utf8");

const STATUS_ID = "provider-native-status";
const EVIDENCE_ID = "provider-native-evidence";
const FINDING_ID = "provider-native-finding";
const RESULT_ID = "export-recognition-result";

/* ------------------------------ the vocabulary ------------------------------ */

test("every state says its own name, so deleting the mark and the tint loses nothing", () => {
  const shapes = new Map();
  for (const [status, chip] of Object.entries(IMPORT_STATUS_CHIPS)) {
    assert.equal(chip.status, status, `${status} is filed under another key`);
    assert.ok(chip.label.length > 0, `${status} has no word of its own`);
    assert.ok(["neutral", "ok", "warn", "error"].includes(chip.tone), `${status} invents a tone`);
    // One mark, one meaning. Two states sharing a silhouette is the defect the
    // page's glyph table exists to prevent, and a shared chip helper is exactly
    // where it comes back.
    assert.ok(!shapes.has(chip.shape),
      `${status} draws ${chip.shape}, already used by ${shapes.get(chip.shape)}`);
    shapes.set(chip.shape, status);
    // The rendered text is the label and the figure. It never contains the
    // mark, so a screen reader is not read a geometric character.
    const painted = importStatusChip(status, { confidence: 42 });
    assert.ok(!painted.text.includes(chip.shape), `${status} speaks its decoration`);
    assert.ok(painted.text.startsWith(chip.label));
  }
  assert.equal(shapes.size, Object.keys(IMPORT_STATUS_CHIPS).length);
});

test("an unsettled import states what is uncertain and what the reader does next", () => {
  for (const status of Object.values(IMPORT_STATUS)) {
    const chip = IMPORT_STATUS_CHIPS[status];
    if (status === IMPORT_STATUS.RECOGNIZED) {
      // A settled reading owes no caveat, and inventing one would teach a
      // reader to distrust the state that is actually fine.
      assert.equal(chip.uncertainty, "");
      assert.equal(chip.next, "");
      continue;
    }
    assert.ok(chip.uncertainty.length > 20, `${status} does not say what is uncertain`);
    assert.ok(chip.next.length > 20, `${status} does not say what to do next`);
  }
  assert.deepEqual(Object.values(IMPORT_STATUS).filter(isUnsettled),
    [IMPORT_STATUS.PARTIAL, IMPORT_STATUS.AMBIGUOUS, IMPORT_STATUS.REJECTED]);
});

test("a confidence is written once, here, so two surfaces cannot word it differently", () => {
  const chip = importStatusChip(IMPORT_STATUS.AMBIGUOUS, { confidence: 75 });
  assert.equal(chip.value, `75 of ${MAX_CONFIDENCE}`);
  assert.equal(chip.kind, CHIP_KINDS.SIGNAL);
  // No confidence is a chip without a figure, never a chip with a zero in it.
  assert.equal(importStatusChip(IMPORT_STATUS.PENDING).value, "");
  assert.equal(importStatusChip(IMPORT_STATUS.PENDING).text,
    IMPORT_STATUS_CHIPS[IMPORT_STATUS.PENDING].label);
});

test("every band, outcome and intake state lands on exactly one chip", () => {
  assert.equal(recognitionStatus(RECOGNITION_BANDS.ACCEPTED, RECOGNITION_OUTCOMES.RECOGNIZED),
    IMPORT_STATUS.RECOGNIZED);
  assert.equal(recognitionStatus(RECOGNITION_BANDS.REJECTED, RECOGNITION_OUTCOMES.INCOMPATIBLE),
    IMPORT_STATUS.REJECTED);
  assert.equal(recognitionStatus(RECOGNITION_BANDS.ATTENTION, RECOGNITION_OUTCOMES.AMBIGUOUS),
    IMPORT_STATUS.AMBIGUOUS);
  assert.equal(recognitionStatus(RECOGNITION_BANDS.ATTENTION, RECOGNITION_OUTCOMES.INCOMPLETE),
    IMPORT_STATUS.PARTIAL);
  // Every band the recognizer can actually produce is claimed by the table.
  for (const band of Object.values(RECOGNITION_BANDS)) {
    for (const outcome of Object.values(RECOGNITION_OUTCOMES)) {
      assert.ok(IMPORT_STATUS_CHIPS[recognitionStatus(band, outcome)], `${band}/${outcome}`);
    }
  }
  // An export that was recognized but produced no rate is PARTLY parsed. Saying
  // "Recognized" over a missing figure is the one thing this table must not do.
  assert.equal(intakeStatus(INTAKE_STATES.ANSWERED, true), IMPORT_STATUS.RECOGNIZED);
  assert.equal(intakeStatus(INTAKE_STATES.ANSWERED, false), IMPORT_STATUS.PARTIAL);
  assert.equal(intakeStatus(INTAKE_STATES.PROVISIONAL, true), IMPORT_STATUS.AMBIGUOUS);
  assert.equal(intakeStatus(INTAKE_STATES.UNRECOGNIZED, false), IMPORT_STATUS.REJECTED);
});

/* --------------------------- the stylesheet block --------------------------- */

const block = css.slice(css.indexOf("expanded-provider import evidence (#931)"));
// A breakpoint is a viewport question, not a box width, so the media condition
// is taken off before the declarations are read.
const declarations = block.replace(/@media[^{]*\{/g, "{");

test("nothing this change adds pins a content-bearing box to a pixel width", () => {
  assert.ok(block.length > 500, "the block did not parse out of the stylesheet");
  // The exact shape the spend-per-delivery tests reject, asserted at the source
  // rather than three thousand lines downstream.
  assert.ok(!/[^-]width:\s*\d+px/.test(declarations),
    "a fixed pixel width would clip a long amount");
  assert.ok(!/max-width:\s*\d+px/.test(declarations),
    "a fixed maximum clips a long provider name");
  assert.ok(!/min-width:\s*\d+px/.test(declarations),
    "a floor in pixels is a floor a phone cannot meet");
  // And the same discipline over the whole slice the neighbouring tests read,
  // so this block cannot be moved above `.spend-per-delivery` and pass here
  // while breaking there.
  const slice = css.slice(css.indexOf(".spend-per-delivery {"));
  assert.ok(!/[^-]width:\s*\d+px/.test(slice), "the spend-per-delivery slice grew a fixed width");
});

test("chips wrap, rows give way, and long strings break rather than push", () => {
  for (const [selector, property] of [
    [".import-chip", "flex-wrap:wrap"], [".import-chip", "min-width:0"],
    [".import-chip", "overflow-wrap:anywhere"],
    [".provider-native-status", "flex-wrap:wrap"], [".provider-native-status", "min-width:0"],
    [".provider-native-uncertainty", "overflow-wrap:anywhere"],
    [".export-recognition-chips", "flex-wrap:wrap"],
    [".export-recognition-uncertainty", "overflow-wrap:anywhere"],
    [".export-recognition-detail-summary", "overflow-wrap:anywhere"],
  ]) {
    const rule = block.match(new RegExp(`\\${selector} \\{([^}]*)\\}`));
    assert.ok(rule, `no rule for ${selector}`);
    assert.ok(rule[1].includes(property), `${selector} is missing ${property}`);
  }
});

test("both new controls are a real target and draw the page's own focus ring", () => {
  for (const selector of [".provider-native-resolve", ".export-recognition-detail-summary"]) {
    const rule = block.match(new RegExp(`\\${selector} \\{([^}]*)\\}`));
    assert.ok(rule[1].includes("min-height:44px"), `${selector} is under the target floor`);
    const focus = block.match(new RegExp(`\\${selector}:focus-visible \\{([^}]*)\\}`));
    assert.ok(focus && focus[1].includes("var(--focus-ring)"),
      `${selector} invents its own focus treatment`);
  }
});

/* ------------------------------- the contrast ------------------------------- */

const TOKENS = Object.fromEntries([...css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")))
  .matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,6})/g)].map(([, name, hex]) => [name, hex]));

const channel = (pair) => {
  const value = Number.parseInt(pair, 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
};

function relativeLuminance(hex) {
  const full = hex.length === 4
    ? `#${[...hex.slice(1)].map((ch) => ch + ch).join("")}` : hex;
  return 0.2126 * channel(full.slice(1, 3))
    + 0.7152 * channel(full.slice(3, 5)) + 0.0722 * channel(full.slice(5, 7));
}

function contrastRatio(foreground, background) {
  const [light, dark] = [relativeLuminance(foreground), relativeLuminance(background)]
    .sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/** One declaration off one rule in the block, with `var(--token)` resolved. */
function declared(selector, property, { surface }) {
  const rule = block.match(new RegExp(`${selector.replace(/[.[\]"=]/g, "\\$&")} \\{([^}]*)\\}`));
  assert.ok(rule, `no rule for ${selector}`);
  const found = rule[1].match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  assert.ok(found, `${selector} declares no ${property}`);
  const value = found[1].trim();
  if (value === "transparent") return surface;
  const token = value.match(/^var\(--([\w-]+)\)$/);
  if (!token) return value;
  assert.ok(TOKENS[token[1]], `--${token[1]} is not a declared token`);
  return TOKENS[token[1]];
}

// The two surfaces a chip is ever drawn on, both already in this stylesheet.
const SURFACES = ["#fbfcfa", "#ffffff"];

test("every chip pairing clears its contrast floor, computed from the tokens", () => {
  const selectors = [
    '.import-chip[data-kind="classification"]',
    '.import-chip[data-kind="signal"][data-tone="neutral"]',
    '.import-chip[data-kind="signal"][data-tone="ok"]',
    '.import-chip[data-kind="signal"][data-tone="warn"]',
    '.import-chip[data-kind="signal"][data-tone="error"]',
  ];
  for (const selector of selectors) {
    for (const surface of SURFACES) {
      const background = declared(selector, "background", { surface });
      const ink = declared(selector, "color", { surface });
      const edge = declared(selector, "border-color", { surface });
      // Chip text is caption-sized and never large text, so the floor is 4.5.
      const text = contrastRatio(ink, background);
      assert.ok(text >= 4.5,
        `${selector} on ${surface}: text ${text.toFixed(2)}:1 is under 4.5:1`);
      // The edge is what separates a filled chip from an outline one, so it is
      // a meaningful non-text boundary at 3:1.
      const border = contrastRatio(edge, background);
      assert.ok(border >= 3,
        `${selector} on ${surface}: edge ${border.toFixed(2)}:1 is under 3:1`);
    }
  }
});

test("the two uncertainty lines are readable on the panel they sit on", () => {
  for (const [selector, surface] of [
    [".provider-native-uncertainty", "#ffffff"],
    [".export-recognition-uncertainty", "#ffffff"],
    [".provider-native-resolve", "#ffffff"],
  ]) {
    const ink = declared(selector, "color", { surface });
    const ratio = contrastRatio(ink, surface);
    assert.ok(ratio >= 4.5, `${selector}: ${ratio.toFixed(2)}:1 is under 4.5:1`);
  }
});

/* ------------------------------- the surfaces ------------------------------- */

const REJECTED = nativeExampleById("bedrock-supported");

async function paintImport(intake) {
  const page = await loadPage(PAGE);
  renderProviderImport(page.document, intake);
  return page;
}

/** Walks up from a node, so "outside every disclosure" is checked, not assumed. */
function foldedAway(node) {
  for (let step = node.parentNode; step; step = step.parentNode) {
    if (step.tagName === "DETAILS") return true;
  }
  return false;
}

test("the status is always rendered, outside every disclosure, above the finding", async () => {
  // Read against the wrong provider on purpose: a rejected intake is the state
  // where the reader most needs the row and is least likely to open anything.
  const intake = buildIntake({
    text: REJECTED.text, fileName: REJECTED.fileName, providerId: "azure-openai",
    sourceLabel: "bundled example",
  });
  const page = await paintImport(intake);
  try {
    const { document } = page;
    const status = document.getElementById(STATUS_ID);
    assert.equal(foldedAway(status), false, "the status row is inside a disclosure");
    assert.equal(status.dataset.status, IMPORT_STATUS.REJECTED);
    assert.equal(status.dataset.unsettled, "true");
    // The word is there without the mark: strip the decoration and the row
    // still says which provider, which verdict, and how sure.
    const text = textOf(status);
    assert.ok(text.includes(IMPORT_STATUS_CHIPS[IMPORT_STATUS.REJECTED].label));
    assert.ok(text.includes(`of ${MAX_CONFIDENCE}`), "the confidence has no figure beside it");
    assert.ok(text.includes(IMPORT_STATUS_CHIPS[IMPORT_STATUS.REJECTED].uncertainty),
      "a rejected import does not say what is uncertain");
    // Two chips: the provider it was read against, and the verdict.
    assert.equal(status.querySelectorAll(".import-chip").length, 2);
    assert.equal(status.querySelectorAll('.import-chip[data-kind="classification"]').length, 1);
    // Every mark is decoration over a label that stands alone.
    for (const shape of status.querySelectorAll(".import-chip-shape")) {
      assert.equal(shape.getAttribute("aria-hidden"), "true");
    }
    // The announcement stays where it already was: the finding below, which is
    // always rendered and is the only live region for this reading.
    const finding = document.getElementById(FINDING_ID);
    assert.equal(finding.getAttribute("aria-live"), "polite");
    assert.equal(foldedAway(finding), false);
    assert.equal(status.getAttribute("aria-live"), null, "two live regions, one event");
    assert.ok(textOf(finding).length > 0, "the live region was left empty");
  } finally {
    page.restore();
  }
});

test("a settled reading carries the chip and no caveat, and folds its evidence", async () => {
  const clean = nativeExampleById("bedrock-supported");
  const page = await paintImport(buildIntake({
    text: clean.text, fileName: clean.fileName, providerId: clean.providerId,
    sourceLabel: "bundled example",
  }));
  try {
    const { document } = page;
    const status = document.getElementById(STATUS_ID);
    assert.equal(status.dataset.status, IMPORT_STATUS.RECOGNIZED);
    assert.equal(status.dataset.unsettled, "false");
    // Assert on counts, never on a node being null: reading a node out of the
    // whole parsed page to compare it against null walks everything and hangs.
    assert.equal(status.querySelectorAll(".provider-native-uncertainty").length, 0);
    assert.equal(status.querySelectorAll(`#${RESOLVE_ID}`).length, 0,
      "a settled reading offers a control for a problem it does not have");
    assert.equal(document.getElementById(EVIDENCE_ID).open, false);
  } finally {
    page.restore();
  }
});

test("the path from an unsettled state to its evidence is one key press", async () => {
  const page = await paintImport(buildIntake({
    text: REJECTED.text, fileName: REJECTED.fileName, providerId: "azure-openai",
    sourceLabel: "bundled example",
  }));
  try {
    const { document } = page;
    const button = document.getElementById(RESOLVE_ID);
    assert.equal(button.tagName, "BUTTON");
    // Explicitly typed: a bare button inside a form submits it, and this one
    // must only ever open the evidence.
    assert.equal(button.type, "button");
    // It is a real tab stop on the shipped page, not a click target only.
    const sequence = tabSequence(document);
    assert.ok(sequence.includes(button), "the resolve control is not reachable by keyboard");
    // Reading order is focus order: the provider chooser and the file control
    // come before the control that resolves the state they produced.
    const evidence = document.getElementById(EVIDENCE_ID);
    const summary = evidence.querySelector("summary");
    assert.ok(sequence.indexOf(document.getElementById("provider-native-file"))
      < sequence.indexOf(button), "the action is offered before the input that causes it");
    assert.ok(sequence.indexOf(button) < sequence.indexOf(summary),
      "the evidence control comes before the action that opens it");

    button.focus();
    assert.equal(document.activeElement, button);
    pressEnter(document);
    assert.equal(evidence.open, true, "Enter on the control did not open the evidence");
    assert.equal(document.activeElement, summary,
      "focus was left behind on a control whose panel is now open");
    assert.ok(textOf(evidence).length > 0);
  } finally {
    page.restore();
  }
});

test("the review reading is chip, verdict, caveat, folded evidence, then action", async () => {
  const page = await loadPage(PAGE);
  try {
    const { document } = page;
    assert.equal(initExportRecognition(document), true);
    const result = document.getElementById(RESULT_ID);
    for (const fixture of RECOGNITION_FIXTURES) {
      renderExportRecognition(document, fixture.id);
      const status = result.dataset.status;
      assert.ok(IMPORT_STATUS_CHIPS[status], `${fixture.id} painted an unknown status`);
      // The chips lead, and the action is last: a reader scanning top-down meets
      // the provider and the confidence before the sentence that spends them.
      const classes = result.children.map((child) => child.className);
      assert.equal(classes[0], "export-recognition-chips", `${fixture.id} buried the chips`);
      assert.equal(classes.at(-2), "export-recognition-action", `${fixture.id} moved the action`);
      // The evidence is behind a disclosure whose summary says what is inside.
      const detail = result.querySelector(".export-recognition-detail");
      assert.equal(detail.tagName, "DETAILS");
      assert.equal(detail.children[0].tagName, "SUMMARY");
      assert.match(textOf(detail.children[0]), /signal/);
      // Open when the reading is unsettled, folded when it is not: a reader is
      // not made to click for the reason they were refused.
      assert.equal(detail.open, isUnsettled(status), `${fixture.id} folded the wrong way`);
      // And the caveat is present exactly when there is one to state.
      assert.equal(result.querySelectorAll(".export-recognition-uncertainty").length,
        IMPORT_STATUS_CHIPS[status].uncertainty ? 1 : 0, fixture.id);
    }
  } finally {
    page.restore();
  }
});

/* -------------------------------- the extremes ------------------------------- */

test("a very long name, a huge amount, a negative one, and an empty file all fit", async () => {
  // Generated here rather than committed: the point is the shape of the string,
  // not a fixture anyone has to maintain.
  const model = `anthropic.${"claude-sonnet-extended-context".repeat(6)}-v9:0`;
  const rows = [
    { model, units: 9_999_999_999, cost: 12_345_678.9 },
    { model: "m2", units: 1, cost: -4321.5 },
  ];
  const text = JSON.stringify({ version: "1", records: rows.map((row) => ({
    lineItemProductCode: "AmazonBedrock", modelId: row.model,
    usageQuantity: row.units, unblendedCost: row.cost, usageStartDate: "2026-01-01",
  })) });
  const page = await loadPage(PAGE);
  try {
    const { document } = page;
    for (const input of [text, JSON.stringify({ version: "1", records: [] }), "{}"]) {
      const intake = buildIntake({
        text: input, fileName: "export.json", providerId: "aws-bedrock",
        sourceLabel: "your file export.json",
      });
      assert.equal(renderProviderImport(document, intake), true);
      const status = document.getElementById(STATUS_ID);
      // Whatever came back, the row still names a state and still offers the
      // reader somewhere to go. No input leaves it blank.
      assert.ok(IMPORT_STATUS_CHIPS[status.dataset.status], "an input produced no state");
      assert.ok(textOf(status).length > 0, "the status row went blank");
      assert.ok(textOf(document.getElementById(FINDING_ID)).length > 0,
        "the live region went blank");
      // No reader-supplied identifier is ever painted, however long it is.
      assert.ok(!textOf(document.body).includes(model), "a model id reached the page");
    }
  } finally {
    page.restore();
  }
});
