// Reading-experience regression for the imported prompt-literacy grade.
//
// Every assertion drives the shipped markup — src/evolution.html parsed by the
// same harness the import-flow and overspend suites use — and a real
// `analyzeQueryLiteracy` result built from rows authored here and run through
// `ingestQuerySample`. Nothing below hand-writes a payload to please the
// renderer: if the analysis stops producing a tier, a cohort, or a next action,
// these tests fail rather than pass against a fixture that agrees with the view.
//
// What is pinned is what a leader can actually take away — including a leader
// reading through a screen reader, or one who cannot separate the band hues:
//
//   * the four facts (grade, spend covered, confidence, the one department to
//     act on) are present as text, in that order, in every drawn state;
//   * a provisional or withheld letter carries its qualifier inside the same
//     element as the glyph, so a screenshot cannot crop the caveat off;
//   * every cohort row states its direction in a word and a signed number, not
//     only in a tint, and the decorative bar is out of the accessibility tree;
//   * the heading levels under the results section skip nothing;
//   * the disclosure is a real button with `aria-expanded`, its panel follows it
//     in DOM order, and the focus ring is declared against its own surface;
//   * an import replacing example data announces the new grade, coverage, and
//     confidence — not the word "updated";
//   * nothing on the panel can truncate the coverage figure or the next action.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHtml, tabSequence, textOf } from "./support/browser.js";
import {
  clearLiteracyGrade, literacyGradeReading, renderLiteracyGrade,
} from "../src/literacy-grade-view.js";
import { analyzeQueryLiteracy } from "../src/query-literacy.js";
import { ingestQuerySample } from "../src/query-sample.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const CSS = new URL("../src/evolution.css", import.meta.url);

// Six excerpts the classifier places in the reference class, and six it places
// out of scope. Lifted in spirit from tests/fixtures/query-sample so this suite
// and the analysis suite disagree about nothing, and generated per department so
// no fixture file grows for a rendering test.
const STRONG = [
  "Context: the billing service returns 500s under load. Constraints: must not change the schema. Acceptance criteria: a passing regression test.",
  "Background: nightly export job. Requirements: idempotent reruns. Expected output: a diff of changed rows.",
  "Given the following stack trace, do not use a retry loop. Definition of done: the handler returns 409.",
  "Context: migration 0007 is slow. Constraints: limited to one lock. Success looks like a sub-second apply.",
  "Here is the failing test. Requirements: keep the public signature. Expected output: the minimal patch.",
  "Context: retry budget exhausted. Constraints: must not exceed three attempts. Acceptance criteria: a bounded backoff.",
];
const WEAK = [
  "give me a recipe for a birthday dinner",
  "write me a poem about the sprint",
  "movie recommendation for tonight",
  "fantasy football waiver advice",
  "vacation policy horoscope joke",
  "tell me a joke about mondays",
];

/** One Anya-contract v1.1 provider record, at the grain the join reads. */
function billed(department, model, amountMinor) {
  return {
    org_unit_id: department,
    cost: { amount_minor: amountMinor, currency: "USD", status: "final" },
    model_raw: model, model_tier: null, request_count: null,
    input_tokens: 10_000, output_tokens: 1_000,
  };
}

function rowsFor(department, model, excerpts) {
  return excerpts.map((excerpt, index) => ({
    department, model, excerpt,
    timestamp: `2026-07-0${1 + (index % 8)}T09:0${index}:00Z`,
  }));
}

/**
 * Run the real ingest and the real analysis.
 *
 * @param {Array<{id: string, name: string, spendUsd: number, model: string,
 *   excerpts?: Array<string>, billed?: boolean}>} plan
 */
async function analyze(plan) {
  const rows = plan.flatMap((entry) =>
    (entry.excerpts ? rowsFor(entry.id, entry.model, entry.excerpts) : []));
  const providerRecords = plan
    .filter((entry) => entry.billed !== false)
    .map((entry) => billed(entry.id, entry.model, Math.round(entry.spendUsd * 100)));
  const sample = rows.length ? await ingestQuerySample(rows, { chunkRows: 8 }) : null;
  return analyzeQueryLiteracy({
    sample,
    providerRecords,
    departments: plan.map(({ id, name, spendUsd }) => ({ id, name, spendUsd })),
  });
}

const strongDepartment = (id, name, spendUsd) =>
  ({ id, name, spendUsd, model: "gpt-4o", excerpts: STRONG });
const weakDepartment = (id, name, spendUsd) =>
  ({ id, name, spendUsd, model: "gpt-4o-mini", excerpts: WEAK });

/** Three graded departments, all of their spend scored: a confident cohort. */
const CONFIDENT = [
  strongDepartment("psn_a", "Platform Engineering", 100),
  strongDepartment("psn_b", "Developer Experience", 100),
  strongDepartment("psn_c", "Data Services", 100),
];

/** The same cohort beside an unsampled department large enough to be a caveat. */
const PROVISIONAL = [
  ...CONFIDENT.map((entry) => ({ ...entry, spendUsd: 30 })),
  { id: "psn_d", name: "Machine Learning Platform", spendUsd: 110, model: "gpt-4o" },
];

/** Large enough that Noor's logic suppresses the letter entirely. */
const SUPPRESSED = [
  ...CONFIDENT.map((entry) => ({ ...entry, spendUsd: 30 })),
  { id: "psn_d", name: "Machine Learning Platform", spendUsd: 400, model: "gpt-4o" },
];

async function page() {
  return parseHtml(await readFile(PAGE, "utf8"));
}

/** Mount the panel the way the page mounts it: inside the revealed results. */
async function mount(state) {
  const doc = await page();
  doc.getElementById("local-results").hidden = false;
  const reading = renderLiteracyGrade(doc, state);
  return { doc, reading };
}

const panelText = (doc) => textOf(doc.getElementById("literacy-grade"));
const summaryText = (doc) => textOf(doc.getElementById("literacy-grade-summary"));
const toggle = (doc) => doc.getElementById("literacy-ungraded-toggle");

// --- the four facts --------------------------------------------------------

test("a confident import states grade, coverage, confidence, and one action in text", async () => {
  const literacy = await analyze(CONFIDENT);
  const { doc, reading } = await mount({ status: "ready", literacy });
  const section = doc.getElementById("literacy-grade");

  assert.equal(section.hidden, false);
  assert.equal(section.dataset.state, "ready");
  assert.equal(section.dataset.gradeState, "graded");
  assert.equal(reading.letter, "A");

  const summary = summaryText(doc);
  // 1. the grade — letter and number, never a tint alone.
  assert.match(summary, /Grade A/);
  assert.match(summary, /letter A · median of 3 graded departments/);
  // 2. how much spend it covers — percentage and both dollar figures, on screen.
  assert.match(summary, /100\.0% of imported spend scored · \$300 of \$300/);
  // 3. how confident it is — Noor's own label, plus her rule sentence.
  assert.match(summary, /high confidence/);
  assert.match(summary, /At least 80% of imported spend/);
  // 4. the one department to act on — terminal element of the block.
  const action = doc.getElementById("literacy-grade-action");
  assert.equal(action.textContent, literacy.eligibility.nextAction.text);
  assert.equal(action.dataset.available, "true");
});

test("the qualifier lives inside the letter, so a screenshot cannot crop it off", async () => {
  const literacy = await analyze(PROVISIONAL);
  const { doc, reading } = await mount({ status: "ready", literacy });
  assert.equal(literacy.eligibility.provisional, true);
  assert.equal(reading.state, "provisional");

  const letter = doc.querySelector(".literacy-grade-letter");
  // One element: glyph and caveat share a parent, a tint, and a bounding box.
  assert.match(textOf(letter), /^Grade A\s*Provisional grade$/);
  assert.equal(doc.getElementById("literacy-grade").dataset.gradeState, "provisional");
  // And the panel still names the department the caveat is about.
  assert.match(panelText(doc), /Machine Learning Platform/);
});

test("Noor suppressing the letter is a drawn state, not a blank box", async () => {
  const literacy = await analyze(SUPPRESSED);
  const { doc, reading } = await mount({ status: "ready", literacy });
  assert.equal(literacy.eligibility.showGrade, false);
  assert.equal(reading.state, "withheld");

  const letter = doc.querySelector(".literacy-grade-letter");
  assert.match(textOf(letter), /^Grade —\s*Grade withheld$/);
  const summary = summaryText(doc);
  assert.match(summary, /No letter is shown\./);
  assert.match(summary, /Under a quarter of spend was scored/);
  // The coverage figure and the action survive suppression: they are the two
  // things a leader can still act on.
  assert.match(summary, /% of imported spend scored/);
  assert.notEqual(doc.getElementById("literacy-grade-action").textContent, "—");
});

// --- colour is never the only channel --------------------------------------

test("every cohort row carries its position as a word and a signed number", async () => {
  const literacy = await analyze([
    strongDepartment("psn_a", "Platform Engineering", 100),
    { id: "psn_b", name: "Developer Experience", spendUsd: 100, model: "claude-sonnet-4", excerpts: [...STRONG.slice(0, 3), ...WEAK.slice(0, 3)] },
    weakDepartment("psn_c", "Data Services", 100),
  ]);
  const { doc } = await mount({ status: "ready", literacy });
  assert.equal(literacy.benchmark.state, "available");

  const rows = doc.querySelectorAll(".literacy-cohort-row");
  assert.equal(rows.length, literacy.benchmark.comparisons.length);
  const median = literacy.benchmark.cohort.medianScore;
  for (const [index, row] of rows.entries()) {
    const comparison = literacy.benchmark.comparisons[index];
    const text = textOf(row);
    // The grade chip is a letter and a number, both readable.
    assert.match(text, new RegExp(`grade [A-F] score ${comparison.score}`));
    // The direction is a word; the shape beside it is redundant, not load-bearing.
    assert.match(text, /(above|level with|below) the cohort median of /);
    assert.ok(text.includes(`${comparison.deltaPoints > 0 ? "+" : ""}${comparison.deltaPoints} points`));
    assert.ok(text.includes(String(median)));
    // Sample size without hover.
    assert.match(text, /\d+ of \d+ sampled quer(y|ies) scored/);
    assert.equal(row.dataset.position, comparison.position);
    assert.equal(row.querySelector(".literacy-cohort-bar").getAttribute("aria-hidden"), "true");
  }
});

test("the hero score card ships a band word beside the band tint", async () => {
  const doc = await page();
  assert.ok(doc.getElementById("score-band-label"), "the band word has a slot");
  assert.ok(doc.getElementById("score-qualifier"), "the qualifier has a slot beside the glyph");
  // The qualifier is inside the grade element, not a sibling footnote.
  assert.equal(doc.getElementById("score-qualifier").parentNode.id, "score-grade");
  assert.equal(doc.getElementById("score-grade-letter").parentNode.id, "score-grade");
  // The generated asterisk that used to carry "provisional" is gone: a `content`
  // mark has no accessible text and means nothing in a screenshot.
  const css = await readFile(CSS, "utf8");
  assert.ok(!css.includes('.score-grade::after'), "the ::after asterisk is retired");
  assert.match(css, /\.score-qualifier \{/);
});

// --- heading order and keyboard --------------------------------------------

test("headings under the results section skip no level", async () => {
  const literacy = await analyze(CONFIDENT);
  const { doc } = await mount({ status: "ready", literacy });
  const levels = doc.getElementById("local-results")
    .querySelectorAll("h1,h2,h3,h4,h5,h6")
    .map((node) => Number(node.tagName.slice(1)));
  assert.equal(levels[0], 3, "the section opens at h3");
  for (const [index, level] of levels.entries()) {
    if (index === 0) continue;
    assert.ok(level <= levels[index - 1] + 1,
      `heading level ${level} follows ${levels[index - 1]} with a skipped level`);
  }
  // The grade block itself nests h4 → h5 with nothing between.
  assert.equal(doc.getElementById("literacy-grade-question").tagName, "H4");
  assert.equal(doc.getElementById("literacy-cohort-title").tagName, "H5");
});

test("the disclosure is keyboard reachable, states its own expansion, and precedes its panel", async () => {
  const literacy = await analyze(PROVISIONAL);
  const { doc } = await mount({ status: "ready", literacy });
  const control = toggle(doc);
  const panel = doc.getElementById("literacy-ungraded-panel");

  assert.equal(control.hidden, false, "one department has no grade, so the control shows");
  assert.ok(tabSequence(doc).includes(control), "the control is in the tab sequence");
  assert.equal(control.getAttribute("aria-expanded"), "false");
  assert.equal(control.getAttribute("aria-controls"), "literacy-ungraded-panel");
  assert.match(control.textContent, /^Show 1 department with no grade$/);
  assert.equal(panel.hidden, true);

  // Reading order is DOM order: the revealed content follows the control.
  const siblings = control.parentNode.childElements;
  assert.ok(siblings.indexOf(control) < siblings.indexOf(panel));

  control.click();
  assert.equal(control.getAttribute("aria-expanded"), "true");
  assert.equal(panel.hidden, false);
  assert.match(control.textContent, /^Hide 1 department with no grade$/);
  assert.match(textOf(panel), /Machine Learning Platform/);
  // The reason is the analysis's own copy, not prose written at the surface.
  assert.match(textOf(panel), /No imported query sampled this department\./);

  control.click();
  assert.equal(control.getAttribute("aria-expanded"), "false");
  assert.equal(panel.hidden, true);
});

test("the disclosure declares a focus ring against its own surface", async () => {
  const css = await readFile(CSS, "utf8");
  assert.match(css, /\.literacy-ungraded-toggle:focus-visible \{ outline:3px solid var\(--focus-ring\)/);
  assert.match(css, /\.literacy-grade h4:focus-visible \{ outline:3px solid var\(--focus-ring\)/);
});

// --- the announcement ------------------------------------------------------

test("an import replacing example data announces the grade, coverage, and confidence", async () => {
  const doc = await page();
  doc.getElementById("local-results").hidden = false;
  const live = doc.getElementById("literacy-grade-live");
  assert.equal(live.getAttribute("role"), "status");
  assert.equal(live.getAttribute("aria-live"), "polite");

  renderLiteracyGrade(doc, { status: "empty", example: true });
  assert.match(live.textContent, /Example data is on screen/);

  const literacy = await analyze(PROVISIONAL);
  renderLiteracyGrade(doc, { status: "ready", literacy, example: false });
  const announcement = live.textContent;
  assert.match(announcement, /^Imported prompt-literacy grade ready\./);
  assert.match(announcement, /Grade A, provisional grade\./);
  assert.match(announcement, /% of imported spend scored/);
  assert.match(announcement, /provisional grade\./i);
  assert.match(announcement, /Next action: /);
  assert.ok(!/^updated$/i.test(announcement));
});

// --- every state, including the implausible ones ---------------------------

test("loading, empty, and error are each drawn and readable", async () => {
  for (const [state, pattern, band] of [
    [{ status: "loading" }, /Scoring the imported query sample/, "loading"],
    [{ status: "empty", example: true }, /Example data is on screen/, "empty"],
    [{ status: "empty", example: false }, /No query sample accompanied this import/, "empty"],
    [{ status: "error" }, /could not be scored/, "error"],
    [{ status: "error", message: "The query sample failed validation." },
      /The query sample failed validation\./, "error"],
  ]) {
    const { doc } = await mount(state);
    const section = doc.getElementById("literacy-grade");
    assert.equal(section.hidden, false, `${band} is shown, not collapsed`);
    assert.equal(section.dataset.state, band);
    assert.equal(section.getAttribute("aria-busy"), String(band === "loading"));
    assert.match(summaryText(doc), pattern);
    // Every held state still ends on a sentence a reader can act on.
    assert.notEqual(doc.getElementById("literacy-grade-action").textContent, "—");
    assert.equal(doc.getElementById("literacy-cohort").hidden, true);
    assert.match(doc.getElementById("literacy-grade-live").textContent, /^Prompt-literacy grade: /);
  }
});

test("0% coverage renders as a withheld grade, never as a grade of zero", async () => {
  // The sampled department is never billed, so no sample row joins: a measured
  // 0%, with a sample present and a spend baseline to divide by.
  const literacy = await analyze([
    { id: "psn_a", name: "Platform Engineering", spendUsd: 100, model: "gpt-4o", excerpts: STRONG, billed: false },
    { id: "psn_b", name: "Developer Experience", spendUsd: 100, model: "gpt-4o" },
  ]);
  const { doc, reading } = await mount({ status: "ready", literacy });
  assert.equal(literacy.available, true);
  assert.equal(reading.state, "withheld");
  assert.match(summaryText(doc), /0\.0% of imported spend scored/);
  // A withheld grade is a sentence, never a letter and never a zero.
  assert.equal(reading.letter, "—");
  assert.match(summaryText(doc), /No letter is shown\./);
  assert.ok(!/letter [A-F]/.test(summaryText(doc)), "no letter is printed at 0% coverage");
});

test("100% coverage reads as a confident grade with no caveat chip", async () => {
  const literacy = await analyze(CONFIDENT);
  const { doc, reading } = await mount({ status: "ready", literacy });
  assert.equal(reading.state, "graded");
  assert.equal(reading.qualifier, "Confident grade");
  assert.match(summaryText(doc), /100\.0% of imported spend scored/);
});

test("a single-row sample is legible and is never graded", async () => {
  const literacy = await analyze([
    { id: "psn_a", name: "Platform Engineering", spendUsd: 100, model: "gpt-4o", excerpts: STRONG.slice(0, 1) },
  ]);
  const { doc, reading } = await mount({ status: "ready", literacy });
  assert.equal(reading.state, "withheld");
  const summary = summaryText(doc);
  assert.match(summary, /1 of 1 sampled query classified/);
  assert.match(summary, /0 of 1 department graded/);
  const control = toggle(doc);
  control.click();
  assert.match(textOf(doc.getElementById("literacy-ungraded-panel")),
    /Fewer than 5 classified queries joined to billing/);
});

test("a very long department name wraps rather than clipping the row", async () => {
  const name = `Global Platform Reliability, Developer Experience and ${"Shared Services ".repeat(8)}Group`;
  const literacy = await analyze([
    { ...strongDepartment("psn_a", name, 100) },
    strongDepartment("psn_b", "Developer Experience", 100),
    strongDepartment("psn_c", "Data Services", 100),
  ]);
  const { doc } = await mount({ status: "ready", literacy });
  const row = doc.querySelectorAll(".literacy-cohort-name")
    .find((node) => node.textContent.startsWith("Global Platform"));
  assert.ok(row, "the long name is rendered in full");
  assert.equal(row.textContent, name, "and is not shortened at the surface");
  const css = await readFile(CSS, "utf8");
  assert.match(css, /\.literacy-cohort-name \{[^}]*overflow-wrap:anywhere/);
});

test("both ends of the scale draw, and neither borrows the other's word", async () => {
  const top = await mount({ status: "ready", literacy: await analyze(CONFIDENT) });
  assert.equal(top.reading.letter, "A");
  assert.equal(top.reading.band, "good");

  const bottom = await mount({
    status: "ready",
    literacy: await analyze([
      weakDepartment("psn_a", "Platform Engineering", 100),
      weakDepartment("psn_b", "Developer Experience", 100),
      weakDepartment("psn_c", "Data Services", 100),
    ]),
  });
  assert.equal(bottom.reading.letter, "F");
  assert.equal(bottom.reading.band, "poor");
  // A failing letter still reads as a grade, with its number beside it.
  assert.match(summaryText(bottom.doc), /letter F/);
  assert.equal(bottom.doc.querySelector(".literacy-grade-letter").dataset.band, "poor");
});

test("two graded departments carry no cohort letter, and the panel says so", async () => {
  const literacy = await analyze([
    strongDepartment("psn_a", "Platform Engineering", 100),
    strongDepartment("psn_b", "Developer Experience", 100),
  ]);
  const { doc, reading } = await mount({ status: "ready", literacy });
  assert.equal(literacy.benchmark.state, "unavailable");
  assert.equal(reading.state, "ungraded");
  assert.match(summaryText(doc), /A cohort median needs three graded departments and this import graded 2\./);
  // The section still explains itself rather than disappearing.
  assert.equal(doc.getElementById("literacy-cohort").hidden, false);
  assert.match(textOf(doc.getElementById("literacy-cohort-method")), /cohort needs 3 graded departments/);
});

test("one graded department is read as itself, named, not as a cohort median", async () => {
  const literacy = await analyze([
    strongDepartment("psn_a", "Platform Engineering", 100),
  ]);
  const { doc, reading } = await mount({ status: "ready", literacy });
  assert.equal(reading.state, "graded");
  assert.match(summaryText(doc), /the only graded department · Platform Engineering/);
});

test("clearing the panel returns it to its authored, hidden state", async () => {
  const literacy = await analyze(CONFIDENT);
  const { doc } = await mount({ status: "ready", literacy });
  clearLiteracyGrade(doc);
  const section = doc.getElementById("literacy-grade");
  assert.equal(section.hidden, true);
  assert.equal(section.dataset.state, "empty");
  assert.equal(section.dataset.gradeState, "none");
  assert.equal(summaryText(doc), "");
  assert.equal(doc.getElementById("literacy-grade-live").textContent, "");
});

// --- narrow widths ---------------------------------------------------------

test("nothing on the panel can truncate the coverage figure or the next action", async () => {
  const css = await readFile(CSS, "utf8");
  const rules = css.split("\n").filter((line) => line.includes(".literacy-"));
  assert.ok(rules.length > 20, "the panel has its own rules to inspect");
  for (const rule of rules) {
    assert.ok(!/text-overflow/.test(rule), `truncation declared: ${rule}`);
    assert.ok(!/ellipsis/.test(rule), `ellipsis declared: ${rule}`);
    assert.ok(!/white-space:\s*nowrap/.test(rule), `nowrap declared: ${rule}`);
  }
  // The two things that must wrap last, and never be clipped, say so.
  assert.match(css, /\.literacy-grade-action \{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.literacy-grade-facts dd \{[^}]*overflow-wrap:anywhere/);

  // At the narrowest width the site supports, the block reflows instead of
  // shrinking the facts below the scale's smallest reading role.
  const narrow = css.split("@media(max-width:640px)").at(-1);
  assert.match(narrow, /\.literacy-grade-block \{ grid-template-columns:1fr/);
  assert.match(narrow, /\.literacy-cohort-head \{[^}]*flex-direction:column/);
  assert.ok(!/\.literacy-grade-facts|\.literacy-grade-action/.test(narrow),
    "the coverage facts and the action keep their reading size at narrow widths");
});

// --- contrast --------------------------------------------------------------

const luminance = (hex) => {
  const channels = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((value) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
};
const ratio = (a, b) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
};

test("every grade state clears WCAG AA on the background it is actually drawn on", () => {
  // Normal text and meaningful non-text indicators, measured against the panel's
  // own surfaces rather than assumed to pass because they are system tokens.
  for (const [ink, background, floor, name] of [
    ["#17603a", "#ffffff", 4.5, "band good letter on the grade block"],
    ["#72520a", "#ffffff", 4.5, "band watch letter on the grade block"],
    ["#8a2b2b", "#ffffff", 4.5, "band poor letter on the grade block"],
    ["#614a12", "#ffffff", 4.5, "withheld letter on the grade block"],
    ["#17603a", "#dcefdc", 4.5, "good grade chip on its wash"],
    ["#72520a", "#fff0c7", 4.5, "watch grade chip on its wash"],
    ["#8a2b2b", "#f6dede", 4.5, "poor grade chip on its wash"],
    ["#614a12", "#fffaf0", 4.5, "qualifier chip on the warn wash"],
    ["#614a12", "#fdf4f3", 4.5, "unavailable action on the error wash"],
    ["#6f2821", "#fdf4f3", 4.5, "error copy on the error wash"],
    ["#6f6f69", "#ffffff", 4.5, "muted captions on the panel"],
    ["#244c3c", "#ffffff", 4.5, "live-region sentence on the panel"],
    ["#155f9e", "#ffffff", 3, "focus ring against the panel"],
    ["#155f9e", "#fffaf0", 3, "focus ring against the empty-state wash"],
    ["#17603a", "#f3f1eb", 3, "good cohort bar against its track"],
    ["#72520a", "#f3f1eb", 3, "watch cohort bar against its track"],
    ["#8a2b2b", "#f3f1eb", 3, "poor cohort bar against its track"],
    ["#6f6f69", "#f3f1eb", 3, "ungraded cohort bar against its track"],
  ]) {
    const measured = ratio(ink, background);
    assert.ok(measured >= floor,
      `${name}: ${measured.toFixed(2)}:1 is under the ${floor}:1 floor`);
  }
});

// --- the reading, on its own -----------------------------------------------

test("the reading never invents a letter the analysis did not publish", async () => {
  const literacy = await analyze(SUPPRESSED);
  const reading = literacyGradeReading(literacy);
  assert.equal(reading.letter, "—");
  assert.equal(reading.band, "review");
  assert.equal(reading.actionText, literacy.eligibility.nextAction.text);
  assert.equal(reading.confidenceText, literacy.eligibility.label);
  assert.equal(reading.confidenceRule, literacy.eligibility.rule);
});
