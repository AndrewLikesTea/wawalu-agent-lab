// Handing the AI FinOps answer over as text, qualifier included (#1195).
//
// THE DEFECT THIS EXISTS TO CATCH. A figure that leaves this page by hand leaves
// the sentence saying whose data it is behind. So the region offers the lines
// itself — and the property this file holds is that it cannot offer them
// WITHOUT the qualifier: the label is a line of every summary the builder can
// return, read off the same headline the visible label is painted from, so
// analyzing an export changes the copied text because it changed the headline.
//
// It also holds the boundary. The summary takes a composed headline, not an
// analysis and not a file, so a row, a record, or a filename has no path into it
// — and the assertions below run against a headline composed from an "imported"
// analysis, where such a path would exist if the builder had one.
//
// The DOM half is driven through the shipped markup rather than a fixture page:
// what a control can be wrong about is whether a keyboard reaches it, what the
// status line says after each outcome, and whether the box on screen holds the
// string that went to the clipboard. The parsed document has no `execCommand`,
// so the manual rung is what a test gets for free; the success path installs a
// clipboard, which is read at press time exactly as a browser's is.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, pressEnter, pressSpace, pressTab, tabSequence, textOf } from "./support/browser.js";
import {
  ANSWER_COPY_IDLE, ANSWER_COPY_IDS, ANSWER_COPY_LABEL, ANSWER_COPY_LINE, applyAnswerCopy,
  bindAnswerCopy, buildAnswerCopy,
} from "../src/finops-answer-copy.js";
import { COPY_MESSAGE, COPY_METHOD } from "../src/coaching-summary.js";
import { applyStandHeadline } from "../src/finops-stand-view.js";
import {
  STAND_LABEL, STAND_QUESTION, buildStandHeadline, composeStandHeadline, standHeadlineForImport,
} from "../src/finops-stand.js";
import { loadExampleDataset } from "../src/example-dataset.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");

const byId = (document, id) => document.getElementById(id);

/** The bundled state: the answer every reader lands on. */
const bundled = () => buildStandHeadline();

/**
 * The analyzed state, from the same records under a different window.
 *
 * Generated here rather than committed: what matters is that the composer ran
 * with `source: "import"` and a period of its own, which is exactly what
 * `standHeadlineForImport` does with a reader's parsed export.
 */
const imported = () => standHeadlineForImport({
  analysis: { ...loadExampleDataset(), period: "2026-03-01 to 2026-04-01" },
});

/** The shipped document, painted with one headline and its control wired. */
function painted(headline, deps = {}) {
  const document = parseHtml(html);
  bindAnswerCopy(document, deps);
  applyStandHeadline(document, headline, { announce: false });
  return document;
}

/** Press the control the way a keyboard user does, and let the copy settle. */
async function pressCopy(document, key = pressEnter) {
  for (let step = 0; step <= tabSequence(document).length; step += 1) {
    const focused = pressTab(document);
    if (focused?.id === ANSWER_COPY_IDS.button) {
      key(document);
      await new Promise((resolve) => { setImmediate(resolve); });
      return focused;
    }
  }
  return assert.fail(`"${ANSWER_COPY_IDS.button}" is not reachable by Tab.`);
}

// --- the summary -----------------------------------------------------------

test("the summary states the five things in the order the region reads them", () => {
  const headline = bundled();
  const summary = buildAnswerCopy(headline);
  assert.equal(summary.available, true, `nothing was composed to copy: ${summary.reason}`);

  const at = (needle) => {
    const index = summary.text.indexOf(needle);
    assert.notEqual(index, -1, `the summary never states ${JSON.stringify(needle)}`);
    return index;
  };
  const order = [
    at(STAND_QUESTION),
    at(headline.recoverable.value),
    at(headline.action.label),
    at(headline.team.name),
    at(STAND_LABEL.example),
  ];
  assert.deepEqual(order, [...order].sort((left, right) => left - right),
    `the five elements are out of order: ${JSON.stringify(summary.lines)}`);

  // The figure never travels as a bare number: the basis printed under it on the
  // page — the amount, the analyzed total, and the coverage qualifier — travels
  // with it, and so does the window it is as of.
  assert.match(summary.text, new RegExp(`${ANSWER_COPY_LINE.basis}: `));
  assert.ok(summary.text.includes(headline.recoverable.basis),
    "the figure is copied without the basis the page prints under it");
  assert.ok(summary.text.includes(headline.period),
    "the figure is copied without the period it covers");
});

test("the qualifying label is the state's own, and changes when an export is analyzed", () => {
  const example = buildAnswerCopy(bundled());
  const analyzed = buildAnswerCopy(imported());
  assert.equal(analyzed.available, true, `nothing was composed to copy: ${analyzed.reason}`);

  // Bundled: the label the region shows over invented figures, and the marker's
  // own "illustrative" sentence.
  assert.ok(example.text.includes(STAND_LABEL.example),
    `the bundled summary omits its label: ${example.text}`);
  assert.match(example.text, /Illustrative/);
  assert.ok(example.text.includes("June 2026"), "the bundled period is not stated");

  // Analyzed: the label CHANGED. Not "some label is present" — the bundled one
  // is gone, the imported one is there, and the period is the export's own.
  assert.ok(analyzed.text.includes(STAND_LABEL.import),
    `the analyzed summary omits its label: ${analyzed.text}`);
  assert.equal(analyzed.text.includes(STAND_LABEL.example), false,
    "an analyzed export is still copied as the bundled synthetic example");
  assert.ok(analyzed.text.includes("March 2026"), "the analyzed period is not stated");
  assert.equal(analyzed.text.includes("June 2026"), false,
    "the analyzed summary still carries the bundled window");
  assert.match(analyzed.text, /Nothing was uploaded/);
});

test("no state of this control copies a figure without a label", () => {
  // Every headline the composer can produce, including the degraded ones: a
  // summary is either unavailable, or it carries one of the two labels. There is
  // no third outcome, and no flag that could select the wrong one.
  const analysis = loadExampleDataset();
  const headlines = [
    bundled(), imported(),
    composeStandHeadline({}),
    composeStandHeadline({ analysis, source: "example" }),
    composeStandHeadline({ analysis, source: "import" }),
    standHeadlineForImport({ analysis: null }),
  ];
  for (const headline of headlines) {
    const summary = buildAnswerCopy(headline);
    if (!summary.available) {
      assert.equal(summary.text, "", `${summary.reason} still produced text`);
      continue;
    }
    const label = headline.source === "import" ? STAND_LABEL.import : STAND_LABEL.example;
    assert.ok(summary.text.includes(label),
      `a ${headline.source} summary was built without its label: ${summary.text}`);
  }
});

test("the analyzed summary carries no filename and no row-level value", () => {
  const analysis = { ...loadExampleDataset(), period: "2026-03-01 to 2026-04-01" };
  const { text } = buildAnswerCopy(standHeadlineForImport({ analysis }));

  // Nothing that names a file. The builder is handed a headline, so it has no
  // file to name; this is the assertion that keeps it that way.
  assert.doesNotMatch(text, /\.(csv|json|tsv|xlsx?)\b/i, `the summary names a file: ${text}`);

  // Nothing per-row. Every department but the named one stays out, and so does
  // every per-department record count and identifier.
  const named = analysis.rankedDepartments.filter((row) => !text.includes(row.name));
  assert.ok(named.length >= 1, "the fixture models only one department; the check is vacuous");
  for (const row of analysis.rankedDepartments) {
    assert.equal(text.includes(row.id), false, `the summary carries the row id ${row.id}`);
  }
  // …and what it does carry is the aggregate pair the region already prints.
  const headline = standHeadlineForImport({ analysis });
  assert.ok(text.includes(headline.recoverable.value), "the aggregate figure is missing");
  assert.equal(text.split("\n").length, 7, `the summary grew a line: ${text}`);
});

// --- the control in the shipped markup -------------------------------------

test("the control ships in the markup, hidden, with nothing to copy yet", () => {
  const document = parseHtml(html);
  const block = byId(document, ANSWER_COPY_IDS.block);
  assert.ok(block, "the copy control must ship in the page markup");
  assert.equal(block.hidden, true,
    "an authored-visible control here is a control above the brief with nothing behind it");
  assert.equal(tabSequence(document).filter((node) => node.closest("#finops-copy")).length, 0,
    "a hidden control must not be in the tab sequence");

  // It is not folded into a disclosure: a status region inside a shut details
  // element is read by this harness and never heard in a browser. Walked by
  // parent rather than selected, because the harness rejects a descendant
  // selector.
  for (const id of [ANSWER_COPY_IDS.status, ANSWER_COPY_IDS.text]) {
    for (let node = byId(document, id); node; node = node.parentNode) {
      assert.notEqual(node.tagName, "DETAILS", `#${id} is inside a disclosure`);
    }
  }
});

test("the control is labelled, described, and keyboard-reachable once composed", () => {
  const document = painted(bundled());
  const block = byId(document, ANSWER_COPY_IDS.block);
  assert.equal(block.hidden, false);
  assert.equal(block.dataset.reason, "composed");

  const button = byId(document, ANSWER_COPY_IDS.button);
  assert.equal(button.tagName, "BUTTON");
  assert.equal(button.getAttribute("type"), "button",
    "a button inside no form still must not be able to submit one");
  assert.equal(textOf(button), ANSWER_COPY_LABEL);
  assert.equal(button.getAttribute("aria-describedby"),
    `${ANSWER_COPY_IDS.lead} ${ANSWER_COPY_IDS.status}`);

  // The status line is a permanent, polite region, so an outcome written into it
  // is a change to a node assistive technology was already watching.
  const status = byId(document, ANSWER_COPY_IDS.status);
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.equal(status.getAttribute("aria-atomic"), "true");
  // Empty until the reader presses it. This page allows one announcer, and a
  // polite region seeded with a sentence about a control nobody has touched is a
  // second one — see tests/finops-answer-announcement.test.js.
  assert.equal(textOf(status), ANSWER_COPY_IDLE);
  assert.equal(ANSWER_COPY_IDLE, "");

  assert.equal(tabSequence(document).filter((node) => node.id === ANSWER_COPY_IDS.button).length, 1,
    "the control is not reachable by Tab");
});

test("the box on the page holds exactly what the button copies", async () => {
  const written = [];
  const document = painted(bundled(), {
    clipboard: { writeText: async (text) => { written.push(text); } },
  });
  const box = byId(document, ANSWER_COPY_IDS.text);
  const summary = buildAnswerCopy(bundled());

  // Readable and selectable before anything is pressed, and it is the same
  // string — one build, two readings.
  assert.equal(byId(document, ANSWER_COPY_IDS.fallback).hidden, false);
  assert.equal(box.getAttribute("readonly"), "");
  assert.equal(box.value, summary.text);

  await pressCopy(document);
  assert.deepEqual(written, [summary.text],
    "the clipboard and the box on the page were handed different strings");
});

test("a successful copy says so, from the keyboard, on Enter and on Space", async () => {
  const written = [];
  const clipboard = { writeText: async (text) => { written.push(text); } };

  for (const key of [pressEnter, pressSpace]) {
    written.length = 0;
    const document = painted(bundled(), { clipboard });
    const status = byId(document, ANSWER_COPY_IDS.status);

    await pressCopy(document, key);
    assert.equal(written.length, 1, "the press did not reach the clipboard");
    assert.equal(textOf(status), COPY_MESSAGE[COPY_METHOD.asyncClipboard]);
    assert.equal(status.dataset.outcome, "copied");
    // The control comes back: a press that leaves a disabled button behind is a
    // control a reader cannot use twice.
    assert.equal(byId(document, ANSWER_COPY_IDS.button).disabled, false);
  }
});

test("a clipboard that is absent or refuses is one visible failure, never silence", async () => {
  const refusing = { writeText: async () => { throw new Error("denied"); } };

  for (const clipboard of [undefined, null, refusing]) {
    const document = painted(bundled(), { clipboard });
    const status = byId(document, ANSWER_COPY_IDS.status);
    await pressCopy(document);

    // The same message either way, and it asks for the keystroke rather than
    // claiming a copy nothing performed.
    assert.equal(textOf(status), COPY_MESSAGE[COPY_METHOD.manual]);
    assert.equal(status.dataset.outcome, "manual");
    assert.match(textOf(status), /press Ctrl\+C/);
    // Focus follows the instruction: what copies is what is selected.
    assert.equal(document.activeElement?.id, ANSWER_COPY_IDS.text);
    assert.equal(byId(document, ANSWER_COPY_IDS.button).disabled, false);
  }
});

test("a repaint onto a different dataset retires the outcome it no longer describes", async () => {
  const written = [];
  const document = painted(bundled(), {
    clipboard: { writeText: async (text) => { written.push(text); } },
  });
  const status = byId(document, ANSWER_COPY_IDS.status);
  await pressCopy(document);
  assert.equal(status.dataset.outcome, "copied");

  // The same answer again: an outcome the reader can still see survives, because
  // retiring it would read as the copy having come undone.
  applyAnswerCopy(document, bundled());
  assert.equal(status.dataset.outcome, "copied");

  // A different one does not: "Copied." over figures it no longer describes is
  // the one way this control can lie.
  applyAnswerCopy(document, imported());
  assert.equal(status.dataset.outcome, undefined);
  assert.equal(textOf(status), ANSWER_COPY_IDLE);
  assert.equal(byId(document, ANSWER_COPY_IDS.text).value,
    buildAnswerCopy(imported()).text);
});

test("the control adds no rule to either stylesheet", async () => {
  const [evolution, styles] = await Promise.all([
    readFile(new URL("../src/evolution.css", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);
  for (const sheet of [evolution, styles]) {
    for (const id of Object.values(ANSWER_COPY_IDS)) {
      assert.equal(sheet.includes(`#${id}`), false,
        `#${id} was given a rule of its own; this control reuses what the page ships`);
    }
  }
  // What it reuses instead, so a rename of either class is caught here rather
  // than by a reader meeting an unstyled block.
  const document = parseHtml(html);
  const classes = byId(document, ANSWER_COPY_IDS.block).className.split(" ");
  assert.ok(classes.includes("prompt-coaching-copy"));
  assert.ok(evolution.includes(".prompt-coaching-copy {"));
  assert.ok(byId(document, ANSWER_COPY_IDS.button).classList.contains("secondary-button"));
  assert.ok(styles.includes(".secondary-button {"));
});
