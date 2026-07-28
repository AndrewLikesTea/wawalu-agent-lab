// The specimen, driven through the shipped markup of evolution.html.
//
// The page and the page entry are the real ones — not a fixture DOM and not a
// re-implementation of the wiring — so "a reviewer can read every state, and a
// keyboard user can open the evidence behind any of them" is a keystroke
// assertion rather than an inspection of the source. What this cannot model is
// layout: the responsive rules are CSS and belong in a browser.
//
// The harness's fetch throws on any request a test did not declare, and this
// file declares none. That is the network assertion for this surface.

import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { loadPage, parseHtml, pressEnter, pressSpace, pressTab, tabSequence, textOf } from "./support/browser.js";
import { importPageModule } from "./support/page-module.js";
import { PRESENTATION_ORDER, presentCoachingResult } from "../src/coaching-result-presentation.js";
import { renderCoachingResult } from "../src/coaching-result-view.js";
import { buildCoachingSpecimen } from "../src/coaching-specimen.js";
import { COACHING_SAMPLES } from "../src/prompt-coaching-contract.js";

const PAGE = fileURLToPath(new URL("../src/evolution.html", import.meta.url));

async function openSpecimen() {
  const page = await loadPage(PAGE);
  await importPageModule("/prompt-coaching-page.js");
  return page;
}

const body = (document) => document.getElementById("coaching-specimen-body");
const cases = (document) => body(document).querySelectorAll(".coaching-specimen-case");
const caseNamed = (document, id) => cases(document).find((node) => node.dataset.case === id);

/** Tab from wherever focus is until a control is reached; no mouse involved. */
function tabTo(document, id) {
  const stops = tabSequence(document).length;
  for (let step = 0; step <= stops; step += 1) {
    const focused = pressTab(document);
    if (focused?.id === id) return focused;
  }
  return assert.fail(`"${id}" is not reachable by Tab; a keyboard user cannot open it.`);
}

test("the specimen draws one case per state, each named in words", async () => {
  const page = await openSpecimen();
  const { document } = page;
  const drawn = cases(document);
  assert.equal(drawn.length, buildCoachingSpecimen().length);
  assert.deepEqual(drawn.map((node) => node.dataset.status), [
    "graded", "graded", "loading", "empty", "invalid_input", "unsupported_content", "graded",
  ]);
  for (const node of drawn) {
    const heading = node.querySelector("h3");
    assert.ok(textOf(heading).length, "a case with no heading is not reviewable");
    assert.ok(textOf(node.querySelector(".coaching-specimen-case-purpose")).length,
      "a specimen case says what a reviewer is looking at");
    // The result is labelled by the case's own heading rather than a second one.
    assert.equal(node.querySelector(".coaching-result").getAttribute("aria-labelledby"), heading.id);
  }
  page.restore();
});

test("each case reads grade, benchmark, one action, then the disclosures", async () => {
  const page = await openSpecimen();
  for (const node of cases(page.document)) {
    const regions = node.querySelectorAll(".coaching-result-region").map((region) => region.dataset.region);
    assert.deepEqual(regions, PRESENTATION_ORDER.filter((id) => regions.includes(id)),
      `${node.dataset.case} renders regions out of reading order: ${regions.join(" > ")}`);
    assert.equal(node.querySelectorAll(".coaching-result-action").length, 1,
      `${node.dataset.case} draws more than one next step`);
    // Document order is the reading order: the action never precedes the grade.
    assert.ok(regions.indexOf("grade") < regions.indexOf("action"));
  }
  page.restore();
});

test("headings nest under the section's own, and regions sit one level below the case", async () => {
  const page = await openSpecimen();
  const { document } = page;
  assert.equal(document.getElementById("prompt-coaching").querySelectorAll("h2").length, 1,
    "the section still owns the h2");
  for (const node of cases(document)) {
    assert.equal(node.querySelectorAll("h3").length, 1);
    for (const region of node.querySelectorAll(".coaching-result-region")) {
      assert.equal(region.firstChild.tagName, "H4",
        `${node.dataset.case}/${region.dataset.region} does not open with a heading below its case`);
    }
    assert.equal(node.querySelectorAll("h2").length + node.querySelectorAll("h5").length, 0,
      `${node.dataset.case} skips a heading level`);
  }
  page.restore();
});

test("a keyboard user opens a disclosure and keeps their place", async () => {
  const page = await openSpecimen();
  const { document } = page;
  const toggleId = "coaching-specimen-graded-rubric-toggle";
  const panel = document.getElementById("coaching-specimen-graded-rubric-panel");

  assert.equal(panel.hidden, true, "a result opens with its rubric closed");
  const toggle = tabTo(document, toggleId);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(toggle.getAttribute("aria-controls"), panel.id);
  assert.match(textOf(toggle), /^Show /);

  pressEnter(document);
  assert.equal(panel.hidden, false, "Enter did not open the panel");
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.match(textOf(toggle), /^Hide /);
  assert.equal(document.activeElement, toggle, "focus left the control the reader activated");
  assert.ok(textOf(panel).includes("Rubric literacy-mix"),
    "the disclosed panel carries the dispute material");
  assert.ok(textOf(panel.querySelector(".coaching-result-assumptions")).length > 100,
    "the disclosed panel drops the assumptions behind its weights and recommendations");

  pressSpace(document);
  assert.equal(panel.hidden, true, "Space did not close the panel again");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(document.activeElement, toggle);
  page.restore();
});

test("closed panels are out of the tab order, and open ones stay in document order", async () => {
  const page = await openSpecimen();
  const { document } = page;
  const reachable = tabSequence(document).map((node) => node.id)
    .filter((id) => id.startsWith("coaching-specimen-"));
  const drawn = body(document).querySelectorAll(".coaching-result-toggle").map((node) => node.id);
  // Every disclosure control is reachable, in the order it is read: a case's
  // evidence before its rubric detail, and each case before the next.
  assert.deepEqual(reachable, drawn);
  assert.deepEqual(drawn.slice(0, 2), [
    "coaching-specimen-graded-evidence-toggle", "coaching-specimen-graded-rubric-toggle",
  ]);

  const before = tabSequence(document).length;
  const toggle = document.getElementById("coaching-specimen-graded-evidence-toggle");
  toggle.click();
  assert.equal(tabSequence(document).length, before,
    "the disclosed evidence adds no control a reader has to tab past");
  page.restore();
});

test("no state is drawn by tint alone: every case prints its state as a word", async () => {
  const page = await openSpecimen();
  for (const node of cases(page.document)) {
    const status = node.querySelector(".coaching-result-status");
    assert.ok(textOf(status).length > 6, `${node.dataset.case} has no readable status line`);
    // The shape is decorative; the word beside it is the accessible name.
    assert.equal(status.querySelector(".coaching-result-shape").getAttribute("aria-hidden"), "true");
    assert.ok(textOf(status.querySelector(".coaching-result-status-value")).length);
    const mark = node.querySelector(".coaching-result-mark");
    if (mark) assert.equal(mark.getAttribute("aria-hidden"), "true", "the letter is announced twice");
  }
  page.restore();
});

test("the loading case draws every region it will fill, with placeholders and no figure", async () => {
  const page = await openSpecimen();
  const node = caseNamed(page.document, "loading");
  assert.equal(node.querySelector(".coaching-result").dataset.tone, "pending");
  assert.equal(node.querySelector(".coaching-result-mark"), null);
  const pending = node.querySelector(".coaching-result-benchmark")
    .querySelectorAll('dd[data-pending="true"]');
  assert.ok(pending.length >= 2, "a waiting benchmark keeps its labels and shows placeholders");
  assert.ok(pending.every((value) => textOf(value) === "—"));
  assert.equal(node.querySelectorAll(".coaching-result-toggle").length, 0,
    "there is nothing to disclose before there is a grade");
  page.restore();
});

test("the implausible case withholds the letter and marks the figure that broke", async () => {
  const page = await openSpecimen();
  const node = caseNamed(page.document, "implausible");
  assert.equal(node.querySelector(".coaching-result").dataset.implausible, "true");
  assert.equal(node.querySelector(".coaching-result-mark"), null, "a 4,200 composite still printed a letter");

  const notices = node.querySelector(".coaching-result-notices").querySelectorAll("li");
  assert.equal(notices.length, 4);
  assert.match(textOf(notices[0]), /Check this figure — Composite score: 4,200\./);
  const marked = node.querySelectorAll('dd[data-implausible="true"]');
  assert.ok(marked.length >= 1);
  assert.ok(marked.every((value) => textOf(value).includes("out of range")),
    "an out-of-range value says so in words, not only in a tint");
  // The evidence behind it is still readable — a bad figure is not a reason to
  // withhold the codes a reader needs to work out what happened.
  assert.equal(node.querySelectorAll(".coaching-result-toggle").length, 2);
  page.restore();
});

test("the specimen renders no prompt text, and never reads the reader's field", async () => {
  const page = await openSpecimen();
  const { document } = page;
  const rendered = textOf(body(document));
  for (const sample of COACHING_SAMPLES) {
    const words = sample.text.trim().split(/\s+/).slice(0, 6).join(" ");
    if (words.length > 12) {
      assert.ok(!rendered.includes(words), `the specimen echoed the "${sample.id}" sample text`);
    }
  }

  // Typing in the box changes nothing here: this surface has no path to the
  // field, and a repaint proves it rather than the module's imports implying it.
  const field = document.getElementById("prompt-coaching-input");
  field.value = "ZQX-marker-9f2a never leaves the textarea";
  const { applyCoachingSpecimen } = await importPageModule("/coaching-specimen-view.js");
  applyCoachingSpecimen(document);
  assert.equal(textOf(body(document)), rendered, "the specimen is not deterministic");
  assert.ok(!textOf(body(document)).includes("ZQX-marker"), "the specimen read the reader's field");
  page.restore();
});

test("every id the specimen writes is unique on the page", async () => {
  const page = await openSpecimen();
  // Seven results on one page is exactly the case the singleton-id surface
  // cannot do, so this is the property that makes the specimen possible:
  // unique within itself, and colliding with nothing already on the page.
  const collect = (root) => {
    const found = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (child.nodeType !== 1) continue;
        if (child.id) found.push(child.id);
        walk(child);
      }
    };
    walk(root);
    return found;
  };
  const written = collect(body(page.document));
  assert.ok(written.length > 20, "the specimen writes the ids its controls are wired through");
  assert.equal(new Set(written).size, written.length,
    `the specimen wrote a duplicate id: ${written.find((id, at) => written.indexOf(id) !== at)}`);

  const elsewhere = new Set(collect(page.document.getElementById("prompt-coaching-form")));
  for (const id of written) assert.ok(!elsewhere.has(id), `"${id}" collides with the entry flow`);
  page.restore();
});

test("a result rendered without a caller's heading writes its own", () => {
  const document = parseHtml("<!doctype html><html><body></body></html>");
  const model = presentCoachingResult({ session: null, status: "loading" });
  const node = renderCoachingResult(document, model, { idPrefix: "solo", headingLevel: 2 });
  const heading = node.querySelector("h2");
  assert.equal(node.getAttribute("aria-labelledby"), heading.id);
  assert.ok(textOf(heading).startsWith("Grading"));
  // Regions drop one level below the heading the result wrote for itself.
  const regions = node.querySelectorAll(".coaching-result-region");
  assert.equal(regions.length, model.regions.length);
  for (const region of regions) assert.equal(region.firstChild.tagName, "H3");
});
