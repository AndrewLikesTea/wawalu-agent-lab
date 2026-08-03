// Correcting a derived name or figure in the bundled example brief (#1026).
//
// Every claim below is made on rendered text, on counts, or on an attribute
// string. Three harness properties shape how:
//
//   * asserting on an element OBJECT walks the whole parsed page, so absence is
//     asserted as a count of zero and never as `assert.equal(node, null)`;
//   * descendant selectors throw, so containment is answered by walking
//     `parentNode`;
//   * `textOf` reads through a shut details element, so nothing this feature
//     announces or attributes may live inside one — which the structural test
//     below pins by walking up from each of the three regions.

import test from "node:test";
import assert from "node:assert/strict";

import { loadPage, pressKey, textOf, typeText } from "./support/browser.js";
import {
  applyCorrection, confidenceText, CORRECTION_IDS, correctionControlId,
  correctionCounts, createCorrectionState, headlineText, mountFigureCorrections,
  openEditor, revertCorrection,
} from "../src/finops-figure-corrections.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

/** Every element under a node, in document order. */
function walk(node, found = []) {
  for (const child of node.children ?? []) {
    if (child.nodeType === 1) {
      found.push(child);
      walk(child, found);
    }
  }
  return found;
}

/** Is any ancestor of this node a details element? `parentNode`, never a
 *  descendant selector. */
function insideDetails(node) {
  for (let held = node?.parentNode; held; held = held.parentNode) {
    if (held.tagName === "DETAILS") return true;
  }
  return false;
}

const share = (document) =>
  Number(document.getElementById(CORRECTION_IDS.confidence).dataset.derivedShare);

const regionText = (document, id) => textOf(document.getElementById(id));

/** The lead row of the block, which is the one the headline sentence names. */
const LEAD = "answer";
const CORRECTED = "The recoverable-spend answer";

async function mounted() {
  const page = await loadPage(PAGE);
  const mount = mountFigureCorrections(page.document);
  assert.notEqual(mount, null, "the block must be authored in evolution.html");
  return { page, document: page.document, mount };
}

// --- the state, on its own --------------------------------------------------

test("a correction is supplied, not derived, and the share moves both ways", () => {
  const start = createCorrectionState();
  const before = correctionCounts(start);
  assert.ok(before.derivedCount > 0, "the example brief must publish derived values");
  assert.equal(before.correctedCount, 0);

  const corrected = applyCorrection(start, LEAD, "name", CORRECTED);
  const after = correctionCounts(corrected);
  assert.equal(after.correctedCount, 1);
  assert.equal(after.derivedCount, before.derivedCount - 1);
  assert.ok(after.derivedShare < before.derivedShare,
    "a reader-supplied value must lower the derived share, not leave it standing");

  // The derived value is kept in state, so revert restores it without reading
  // anything back off the page.
  const reverted = revertCorrection(corrected, LEAD, "name");
  assert.deepEqual(correctionCounts(reverted), before);
  assert.equal(headlineText(reverted), headlineText(start));
  assert.equal(confidenceText(reverted), confidenceText(start));
});

test("opening a second editor commits nothing and closes the first", () => {
  const first = openEditor(createCorrectionState(), LEAD, "name");
  assert.deepEqual(first.editing, { unitId: LEAD, field: "name" });
  const second = openEditor(first, "impact", "figure");
  assert.deepEqual(second.editing, { unitId: "impact", field: "figure" });
  assert.deepEqual(correctionCounts(second), correctionCounts(createCorrectionState()),
    "abandoning an edit to open another one must not write a correction");
});

// --- the page ---------------------------------------------------------------

test("the authored sentences are the ones the module paints", async () => {
  const { page, document } = await mounted();
  try {
    const state = createCorrectionState();
    assert.equal(regionText(document, CORRECTION_IDS.headline), headlineText(state));
    assert.equal(regionText(document, CORRECTION_IDS.confidence), confidenceText(state));
  } finally {
    page.restore();
  }
});

test("the announcement, the markers and the confidence sentence are not folded away", async () => {
  const { page, document } = await mounted();
  try {
    for (const id of [CORRECTION_IDS.headline, CORRECTION_IDS.confidence, CORRECTION_IDS.live]) {
      assert.equal(insideDetails(document.getElementById(id)), false,
        `${id} is inside a details element, where a real browser hides it`);
    }
    const rows = document.getElementById(CORRECTION_IDS.rows);
    assert.equal(insideDetails(rows), false);
    assert.equal(walk(rows).filter((node) => node.classList?.contains?.("brief-provenance")).length,
      correctionCounts(createCorrectionState()).total,
      "every value in the table carries its own provenance marker");
  } finally {
    page.restore();
  }
});

test("correcting a derived name moves the headline, the table cell, and the derived share", async () => {
  const { page, document } = await mounted();
  try {
    const before = share(document);
    const derivedHeadline = regionText(document, CORRECTION_IDS.headline);

    document.getElementById(correctionControlId(LEAD, "name", "edit")).click();
    const input = document.getElementById(correctionControlId(LEAD, "name", "input"));
    assert.equal(document.activeElement?.id, input.id, "the editor must take focus on open");
    input.value = "";
    typeText(document, CORRECTED);
    document.getElementById(correctionControlId(LEAD, "name", "commit")).click();

    // The table cell.
    const cell = document.querySelector(`#${correctionControlId(LEAD, "name", "edit")}`).parentNode;
    assert.ok(textOf(cell).includes(CORRECTED));
    assert.equal(cell.dataset.corrected, "true");
    assert.equal(cell.dataset.provenance, "corrected");

    // The headline sentence, from the same state and not a second write.
    const headline = regionText(document, CORRECTION_IDS.headline);
    assert.notEqual(headline, derivedHeadline);
    assert.ok(headline.includes(CORRECTED));

    // The confidence sentence, honestly recomputed.
    assert.ok(share(document) < before,
      "a reader-supplied value must lower the derived share the sentence prints");
    assert.match(regionText(document, CORRECTION_IDS.confidence), /corrected by a reader/);

    // Attributed in words, not by colour or an icon alone, and announced once.
    assert.match(textOf(cell), /Corrected by reader/);
    assert.match(regionText(document, CORRECTION_IDS.live), /Corrected the name for/);
    assert.ok(regionText(document, CORRECTION_IDS.live).includes(CORRECTED));

    // Focus lands on the corrected marker's own edit control, found by id after
    // the repaint rather than through the node the reader pressed.
    assert.equal(document.activeElement?.id, correctionControlId(LEAD, "name", "edit"));
  } finally {
    page.restore();
  }
});

test("one revert puts the derived name back in all three regions", async () => {
  const { page, document } = await mounted();
  try {
    const derivedHeadline = regionText(document, CORRECTION_IDS.headline);
    const derivedConfidence = regionText(document, CORRECTION_IDS.confidence);
    const derivedShare = share(document);
    const derivedCell = textOf(
      document.querySelector(`#${correctionControlId(LEAD, "name", "edit")}`).parentNode);

    document.getElementById(correctionControlId(LEAD, "name", "edit")).click();
    document.getElementById(correctionControlId(LEAD, "name", "input")).value = CORRECTED;
    document.getElementById(correctionControlId(LEAD, "name", "commit")).click();
    assert.notEqual(share(document), derivedShare);

    document.getElementById(correctionControlId(LEAD, "name", "revert")).click();

    assert.equal(regionText(document, CORRECTION_IDS.headline), derivedHeadline);
    assert.equal(regionText(document, CORRECTION_IDS.confidence), derivedConfidence);
    assert.equal(share(document), derivedShare);
    assert.equal(
      textOf(document.querySelector(`#${correctionControlId(LEAD, "name", "edit")}`).parentNode),
      derivedCell);
    assert.match(regionText(document, CORRECTION_IDS.live), /Reverted the name for/);
    // The revert control is gone with the correction it undid.
    assert.equal(
      document.querySelectorAll(`#${correctionControlId(LEAD, "name", "revert")}`).length, 0);
  } finally {
    page.restore();
  }
});

test("a correction carrying markup renders as text and creates no element", async () => {
  const { page, document } = await mounted();
  try {
    const injected = "<img src=x onerror=alert(1)> Northeast";
    document.getElementById(correctionControlId(LEAD, "name", "edit")).click();
    document.getElementById(correctionControlId(LEAD, "name", "input")).value = injected;
    document.getElementById(correctionControlId(LEAD, "name", "commit")).click();

    // The literal characters are on screen, in all three regions and in the
    // announcement, because the value is the reader's and this page renders it.
    for (const id of [CORRECTION_IDS.headline, CORRECTION_IDS.rows, CORRECTION_IDS.live]) {
      assert.ok(regionText(document, id).includes(injected),
        `${id} did not render the correction as literal text`);
    }
    // And nothing became markup: no injected element anywhere on the page, and
    // no element carrying the injected handler as an attribute.
    assert.equal(document.querySelectorAll("img").length, 0);
    assert.equal(walk(document).filter((node) => node.hasAttribute?.("onerror")).length, 0);
    // The page's own scripts carry a src; none of them carries the injected one.
    assert.equal(
      walk(document).filter((node) => node.getAttribute?.("src") === "x").length, 0);
  } finally {
    page.restore();
  }
});

test("Enter commits from inside the field and Escape discards the edit", async () => {
  const { page, document } = await mounted();
  try {
    const before = {
      headline: regionText(document, CORRECTION_IDS.headline),
      confidence: regionText(document, CORRECTION_IDS.confidence),
      rows: regionText(document, CORRECTION_IDS.rows),
      share: share(document),
    };

    // Escape first: the three regions must read exactly as they did.
    document.getElementById(correctionControlId(LEAD, "figure", "edit")).click();
    typeText(document, " and then some");
    pressKey(document, "Escape");
    assert.equal(regionText(document, CORRECTION_IDS.headline), before.headline);
    assert.equal(regionText(document, CORRECTION_IDS.confidence), before.confidence);
    assert.equal(regionText(document, CORRECTION_IDS.rows), before.rows);
    assert.equal(share(document), before.share);
    assert.equal(document.activeElement?.id, correctionControlId(LEAD, "figure", "edit"),
      "cancelling must put focus back on the control the editor was opened from");
    assert.equal(regionText(document, CORRECTION_IDS.live), "",
      "a discarded edit is not something to announce");

    // Then Enter, which commits.
    document.getElementById(correctionControlId(LEAD, "figure", "edit")).click();
    document.getElementById(correctionControlId(LEAD, "figure", "input")).value = "";
    typeText(document, "31% of analyzed AI spend is recoverable");
    pressKey(document, "Enter");
    assert.ok(regionText(document, CORRECTION_IDS.headline).includes("31% of analyzed AI spend"));
    assert.ok(share(document) < before.share);
    assert.equal(document.activeElement?.id, correctionControlId(LEAD, "figure", "edit"));
  } finally {
    page.restore();
  }
});

test("every edit and revert control names the value it acts on", async () => {
  const { page, document } = await mounted();
  try {
    const state = createCorrectionState();
    for (const unit of state.units) {
      for (const field of ["name", "figure"]) {
        const edit = document.getElementById(correctionControlId(unit.id, field, "edit"));
        const spoken = textOf(edit);
        assert.ok(spoken.includes(unit.derived.name),
          `the ${field} control for ${unit.id} does not say which value it edits: ${spoken}`);
        assert.notEqual(spoken, "Edit", "a bare Edit names nothing");
      }
    }
    document.getElementById(correctionControlId(LEAD, "name", "edit")).click();
    document.getElementById(correctionControlId(LEAD, "name", "input")).value = CORRECTED;
    document.getElementById(correctionControlId(LEAD, "name", "commit")).click();
    const revert = document.getElementById(correctionControlId(LEAD, "name", "revert"));
    assert.ok(textOf(revert).includes(CORRECTED),
      "the revert control must name the value it restores");
    assert.match(textOf(revert), /Restore derived name/);
  } finally {
    page.restore();
  }
});
