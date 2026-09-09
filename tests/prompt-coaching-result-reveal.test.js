// When the prompt coach's result area is allowed to show anything at all.
//
// The rule this file holds: a result action exists because there is a result to
// act on, never because a load finished. Between those two things sits the state
// a first-time visitor actually reads — the bundled example loading — and in it
// the region says one sentence and offers nothing.
//
// WHY SOME OF THIS IS ASSERTED AGAINST THE STYLESHEET. The DOM harness models no
// layout, so `hidden` always hides here and a block that a browser paints anyway
// still passes every attribute assertion. The blocks in this region each set
// their own `display`, which outranks the browser's `[hidden]` rule, so the guard
// that keeps them off the page is a line of CSS — and a line of CSS is the thing
// that can be deleted without a single DOM assertion noticing.
//
// The harness's fetch throws on any request a test did not declare, and this
// file declares none: nothing in this workflow may become a request.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { loadPage, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { applyCoachingFirstRun } from "../src/prompt-coaching-entry-view.js";
import { coachingSample } from "../src/prompt-coaching-contract.js";

const PAGE = fileURLToPath(new URL("../src/coach.html", import.meta.url));
const CSS = new URL("../src/evolution.css", import.meta.url);

const WEAK = coachingSample("underspecified-request").text;
const STRONG = coachingSample("well-formed-request").text;

const byId = (document, id) => document.getElementById(id);
const RESULT_BLOCKS = ["prompt-coaching-change", "prompt-coaching-result", "prompt-coaching-copy"];

/** The shipped page, wired as the browser wires it. */
async function openCoach() {
  const page = await loadPage(PAGE);
  await importPageModule("/prompt-coaching-page.js");
  return page;
}

/**
 * The same page with the bundled example's load held open, so the loading state
 * can be read. The page entry mounts itself on import, so it is imported against
 * a document this helper discards and the page under test is wired by hand — the
 * shipped loader paints in the turn it is called in and leaves nothing to read.
 */
async function openCoachLoading() {
  const booted = await loadPage(PAGE);
  const { initPromptCoaching } = await importPageModule("/prompt-coaching-page.js");
  booted.restore();
  const page = await loadPage(PAGE);
  let paint;
  initPromptCoaching(page.document, {
    loadBundledExample: (document) => new Promise((resolve) => {
      paint = () => resolve(applyCoachingFirstRun(document));
    }),
  });
  return { page, paint: () => paint() };
}

function tabTo(document, id) {
  for (let step = 0; step <= tabSequence(document).length; step += 1) {
    const focused = pressTab(document);
    if (focused?.id === id) return focused;
  }
  return assert.fail(`"${id}" is not reachable by Tab; a keyboard user cannot use the workflow.`);
}

function gradeText(document, text) {
  const field = byId(document, "prompt-coaching-input");
  field.value = text;
  tabTo(document, "prompt-coaching-grade");
  pressEnter(document);
}

/** The result blocks that are on the page, in document order. */
function revealedBlocks(document) {
  const panel = byId(document, "prompt-coaching");
  const order = [];
  for (const node of panel.children) {
    const id = node.getAttribute?.("id");
    if (RESULT_BLOCKS.includes(id) && !node.hidden) order.push(id);
  }
  return order;
}

/* ----------------------------- while it loads ----------------------------- */

test("the loading region says one thing and offers nothing to act on", async () => {
  const { page } = await openCoachLoading();
  const { document } = page;

  // One status, and it is the region's own sentence rather than a heading, a
  // figure, or a spinner with no words in it.
  const status = byId(document, "prompt-coach-sample-status");
  assert.match(textOf(status), /^Loading the bundled example\./);
  assert.equal(byId(document, "prompt-coach-sample-body").dataset.loadState, "loading");
  assert.equal(document.querySelectorAll(".prompt-coach-sample-lead").length, 1,
    "a second loading line is a second answer to the same question");

  // No result heading, and above all not the one over the copy control: a
  // "Coaching summary" with no summary under it is a promise the page cannot
  // keep, and its button copies an empty box.
  assert.doesNotMatch(textOf(byId(document, "prompt-coach-sample")), /Coaching summary/);
  assert.deepEqual(revealedBlocks(document), [],
    "no result block may be on the page before a result is");
  for (const id of RESULT_BLOCKS) assert.equal(byId(document, id).hidden, true);
  assert.equal(textOf(byId(document, "prompt-coaching-result")), "");
  assert.equal(textOf(byId(document, "prompt-coaching-change")), "");

  // Nothing contentless in the tab order: not the copy control, and not the
  // manual-copy box, which has nothing in it to select.
  const sequence = tabSequence(document);
  assert.equal(sequence.includes(byId(document, "prompt-coaching-copy-button")), false);
  assert.equal(sequence.includes(byId(document, "prompt-coaching-copy-text")), false);
  assert.equal(byId(document, "prompt-coaching-copy-text").value, "");
  page.restore();
});

test("the loading status is announced from a permanent live region, once", async () => {
  const { page, paint } = await openCoachLoading();
  const { document } = page;
  const status = byId(document, "prompt-coach-sample-status");

  // The treatment this product uses for a dynamic status, and the same one the
  // copy control's line carries: a polite, atomic status region.
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(status.getAttribute("aria-atomic"), "true");
  assert.equal(byId(document, "prompt-coach-sample-body").getAttribute("aria-busy"), "true");

  // It is not inside the region that gets replaced, so painting the result
  // cannot remount the node assistive technology is watching — and it is emptied
  // rather than removed, so the settled page announces nothing a second time.
  paint();
  await waitFor(() => byId(document, "prompt-coach-sample-body").dataset.loadState === "ready",
    "the bundled example to finish grading");
  assert.equal(byId(document, "prompt-coach-sample-status"), status,
    "the status node was replaced, so a reader may never hear the next one");
  assert.equal(textOf(status), "");
  assert.equal(byId(document, "prompt-coach-sample-body").getAttribute("aria-busy"), null);
  page.restore();
});

test("the bundled example arrives without taking focus off the reader", async () => {
  const { page, paint } = await openCoachLoading();
  const { document } = page;

  // A visitor who did not wait: they are typing while the example loads.
  const field = byId(document, "prompt-coaching-input");
  field.focus();
  assert.equal(document.activeElement, field);

  paint();
  await waitFor(() => byId(document, "prompt-coach-sample-body").dataset.loadState === "ready",
    "the bundled example to finish grading");
  assert.equal(document.activeElement, field,
    "the example load moved focus out of the field a visitor was typing in");
  page.restore();
});

/* ------------------------------ once graded ------------------------------- */

test("a compared grade reveals the score, the comparison, and the copy action in that order", async () => {
  const page = await openCoach();
  const { document } = page;

  gradeText(document, WEAK);
  gradeText(document, STRONG);

  // Reading order: what changed, the grade it is a change to, then the record
  // of both — the action last, after everything it is an action on.
  assert.deepEqual(revealedBlocks(document),
    ["prompt-coaching-change", "prompt-coaching-result", "prompt-coaching-copy"]);

  // Each required part is there, named in words rather than by tint alone.
  assert.match(textOf(byId(document, "prompt-coaching-result")), /\d+ \/ 100/);
  assert.match(textOf(byId(document, "prompt-coaching-change")), /What changed since your last grade/);
  assert.match(textOf(byId(document, "prompt-coaching-copy")), /Coaching summary/);
  assert.ok(byId(document, "prompt-coaching-copy-text").value.length > 0,
    "the copy control is offered over a summary with something in it");

  // And tab order follows it: the copy control is the last thing reached, after
  // the disclosures inside the comparison and the result above it.
  const sequence = tabSequence(document);
  const button = byId(document, "prompt-coaching-copy-button");
  const resultToggle = byId(document, "prompt-coaching-result").querySelector("button");
  assert.ok(sequence.includes(button), "a keyboard reader must reach the copy control");
  assert.ok(sequence.indexOf(button) > sequence.indexOf(resultToggle),
    "a keyboard reader reaches the copy action before the result it summarises");
  page.restore();
});

test("the copy action waits for a summary, not for the page to finish loading", async () => {
  const page = await openCoach();
  const { document } = page;

  // The bundled example has loaded and a grade is on screen: loading is over.
  // There is still nothing to copy, because one grade is not a comparison.
  gradeText(document, WEAK);
  assert.equal(byId(document, "prompt-coach-sample-body").dataset.loadState, "ready");
  assert.equal(byId(document, "prompt-coaching-result").hidden, false);
  assert.equal(byId(document, "prompt-coaching-copy").hidden, true);
  assert.equal(byId(document, "prompt-coaching-copy").dataset.reason, "not_compared");
  assert.equal(tabSequence(document).includes(byId(document, "prompt-coaching-copy-button")), false);

  gradeText(document, STRONG);
  assert.equal(byId(document, "prompt-coaching-copy").hidden, false);
  assert.equal(byId(document, "prompt-coaching-copy").dataset.reason, "compared");

  // And it withdraws with the content it acted on.
  tabTo(document, "prompt-coaching-clear");
  pressEnter(document);
  assert.deepEqual(revealedBlocks(document), []);
  assert.equal(byId(document, "prompt-coaching-copy-text").value, "");
  page.restore();
});

/* ------------------------- what the DOM cannot say ------------------------ */

test("every result block that sets its own display is hidden in the stylesheet too", async () => {
  const css = await readFile(CSS, "utf8");
  for (const selector of [".prompt-coaching-result", ".prompt-coaching-change"]) {
    assert.match(css, new RegExp(`\\${selector}\\[hidden\\]`),
      `${selector} sets display, so [hidden] alone leaves it on the page`);
  }
  for (const selector of ["#prompt-coaching-copy", "#prompt-coaching-copy-fallback"]) {
    assert.match(css, new RegExp(`${selector}\\[hidden\\]`),
      `${selector} sets display, so [hidden] alone leaves it on the page`);
  }
  // The guards are one rule, and it is display:none rather than a visual trick
  // that leaves the control in the tab order.
  assert.match(css, /\.prompt-coaching-result\[hidden\][^{}]*\{ display:none; \}/);
});
