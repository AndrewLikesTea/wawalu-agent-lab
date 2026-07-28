// Whether the FinOps briefing reads as a board paper.
//
// `finops-briefing-contract.test.js` covers what the contract selects and
// `local-import-flow.test.js` covers that the page paints it. These cover the
// reading of it: the order a leader meets the slots in, the pair that must
// never come apart, the states that are not the demo state, and whether the
// thing survives a mono printer, a keyboard, and a briefing far outside the
// shape the fixture has.
//
// Contrast is measured from `src/evolution.css` itself rather than asserted
// from memory, so a future edit to a token or a pairing fails here instead of
// shipping a grade nobody can read. Ratios are printed with `diagnostic` so the
// numbers are in the run and not only in a summary somebody wrote once.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, textOf } from "./support/browser.js";
import {
  applyBriefing,
  applyBriefingState,
  BRIEFING_STATE_MESSAGE,
  briefingLines,
} from "../src/local-import-flow.js";
import {
  ABSENCE_REASON,
  ABSENCE_STATEMENT,
  ACCOUNTABLE_ROLE,
  BRIEFING_CONFIDENCE,
  BRIEFING_FIXTURE,
  CONTRACT_VERSION,
} from "../src/finops-briefing-contract.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const CSS = new URL("../src/evolution.css", import.meta.url);

const html = await readFile(PAGE, "utf8");
const css = await readFile(CSS, "utf8");

const openPage = () => loadPage(PAGE);
const byId = (document, id) => document.getElementById(id);

/** The briefing, with one slot dialled. Everything else stays the fixture's. */
function briefing(overrides = {}) {
  return Object.freeze({ ...BRIEFING_FIXTURE, ...overrides });
}

/** A coverage block the contract would have emitted for this ratio. */
function coverage(recordsAnalyzed, recordsTotal, confidence, missingInputs = []) {
  return Object.freeze({
    recordsAnalyzed,
    recordsTotal,
    coverageRatio: recordsTotal === 0 ? 0 : recordsAnalyzed / recordsTotal,
    confidence,
    missingInputs: Object.freeze(missingInputs),
  });
}

// --- A. reading order -------------------------------------------------------

// The order a leader meets the surface in. Authored in the markup, so this is
// an assertion about the DOM and therefore about the screen reader, the Tab
// key, and the printed sheet all at once.
const READING_ORDER = [
  "local-lead-question",       // 1. the question
  "local-lead-answer",         // 2. the answer block…
  "local-lead-metric",         //    …the material metric
  "local-lead-grade",          //    …the grade
  "local-lead-coverage",       //    …and the coverage it is bounded by
  "local-lead-next",           // 3. the prioritized action…
  "local-lead-action",
  "local-lead-role",           //    …and the role accountable for it
  "local-lead-support",        // 4. supporting detail, behind disclosure
  "local-lead-basis",          // 5. rubric version…
  "local-lead-provenance",     //    …and provenance, never disclosed
];

test("every contract slot is rendered, in the reading order the briefing claims", async () => {
  const positions = READING_ORDER.map((id) => {
    const at = html.indexOf(`id="${id}"`);
    assert.ok(at > 0, `${id} is missing from the authored markup`);
    return at;
  });
  assert.deepEqual([...positions].sort((left, right) => left - right), positions,
    "the markup order does not match the briefing's stated reading order");

  const { document } = await openPage();
  applyBriefing(document, BRIEFING_FIXTURE);
  const lines = briefingLines(BRIEFING_FIXTURE);

  // Each named slot of the contract, on the page, saying what the contract said.
  assert.equal(textOf(byId(document, "local-lead-question")), BRIEFING_FIXTURE.headlineQuestion);
  assert.match(textOf(byId(document, "local-lead-metric")), /5200\.00 USD/);
  assert.equal(textOf(byId(document, "local-lead-grade-label")), "High confidence");
  assert.equal(textOf(byId(document, "local-lead-grade-value")), "95.0% coverage");
  assert.match(textOf(byId(document, "local-lead-coverage")), /760 analyzed of 800/);
  assert.match(textOf(byId(document, "local-lead-arithmetic")), /recoverable_scenario_usd/);
  assert.match(textOf(byId(document, "local-lead-action")), /Pilot lower-cost routing/);
  assert.equal(textOf(byId(document, "local-lead-role")),
    `Accountable role: ${ACCOUNTABLE_ROLE.routing_pilot}`);
  assert.match(textOf(byId(document, "local-lead-rubric")), new RegExp(CONTRACT_VERSION));
  assert.match(textOf(byId(document, "local-lead-rubric")),
    new RegExp(BRIEFING_FIXTURE.rubricVersion));
  assert.equal(textOf(byId(document, "local-lead-provenance")), lines.provenance);
  assert.match(textOf(byId(document, "local-lead-provenance")), /browser|this tab/);
});

test("the visual order is the DOM order: no slot is moved by the stylesheet", () => {
  // Everything scoped to the briefing, so a reordering rule elsewhere on this
  // large stylesheet is not this test's business.
  const rules = [...css.matchAll(/([^{}]*\.local-lead-[^{}]*)\{([^}]*)\}/g)];
  assert.ok(rules.length > 10, "the briefing's own rules were not found");
  for (const [, selector, body] of rules) {
    for (const forbidden of [/(?:^|;)\s*order\s*:/, /flex-direction\s*:\s*\w+-reverse/,
      /flex-flow\s*:[^;]*reverse/, /grid-auto-flow\s*:[^;]*dense/, /direction\s*:\s*rtl/]) {
      assert.doesNotMatch(body, forbidden,
        `${selector.trim()} reorders the briefing in CSS; restructure the markup instead`);
    }
  }
});

// --- B. the structural invariant -------------------------------------------

test("a grade is never rendered without its confidence and coverage in the same group", async () => {
  const { document } = await openPage();
  const answer = byId(document, "local-lead-answer");
  // The invariant is structural, not a spacing coincidence: one container, one
  // accessible group, and the three slots are its descendants.
  assert.equal(answer.getAttribute("role"), "group");
  assert.equal(answer.getAttribute("aria-labelledby"), "local-lead-answer-title");
  for (const id of ["local-lead-metric", "local-lead-grade", "local-lead-grade-chip",
    "local-lead-grade-label", "local-lead-grade-value", "local-lead-coverage"]) {
    assert.ok(answer.querySelector(`#${id}`), `${id} sits outside the answer block`);
  }

  // And it holds through every confidence level the contract can emit, in both
  // the figure-bearing and the figure-less shape.
  for (const level of Object.values(BRIEFING_CONFIDENCE)) {
    for (const withMetric of [true, false]) {
      applyBriefing(document, briefing({
        coverage: coverage(level === "insufficient" ? 0 : 500, level === "insufficient" ? 0 : 800, level),
        ...(withMetric ? {} : {
          materialMetric: null,
          arithmeticInputs: null,
          absent: { materialMetric: { reason: ABSENCE_REASON.noAnalysis, statement: ABSENCE_STATEMENT[ABSENCE_REASON.noAnalysis] } },
        }),
      }));
      const chip = byId(document, "local-lead-grade-chip");
      assert.equal(chip.dataset.confidence, level);
      assert.ok(textOf(byId(document, "local-lead-grade-label")).length > 0,
        `the ${level} grade has no confidence word beside it`);
      assert.ok(textOf(byId(document, "local-lead-coverage")).length > 1,
        `the ${level} grade has no coverage line beside it`);
      assert.ok(byId(document, "local-lead-answer").querySelector("#local-lead-grade"));
    }
  }
});

test("the grade is never told by colour alone: a word, a value and a shape carry it too", async () => {
  const { document } = await openPage();
  const seen = new Map();
  for (const level of Object.values(BRIEFING_CONFIDENCE)) {
    applyBriefing(document, briefing({ coverage: coverage(500, 800, level) }));
    seen.set(level, {
      shape: textOf(byId(document, "local-lead-grade-shape")),
      label: textOf(byId(document, "local-lead-grade-label")),
    });
  }
  // Two channels that survive a greyscale print, and both are distinct per
  // level — which matters, because the four inks flatten to nearly the same
  // grey (measured in the contrast test below).
  const shapes = [...seen.values()].map((entry) => entry.shape);
  const labels = [...seen.values()].map((entry) => entry.label);
  assert.equal(new Set(shapes).size, shapes.length, "two confidence levels share one glyph");
  assert.equal(new Set(labels).size, labels.length, "two confidence levels share one word");
  for (const [level, entry] of seen) {
    assert.ok(entry.shape.length > 0 && entry.label.length > 0, `${level} is missing a channel`);
  }
  // The glyph is decoration for the eye; the word is what is announced.
  assert.match(html, /id="local-lead-grade-shape" aria-hidden="true"/);
});

// --- contrast, measured from the stylesheet --------------------------------

// Both stylesheets, because this surface composes with tokens from each:
// `--focus-ring` is the site-wide one in styles.css, and the import-flow roles
// are evolution.css's own. Reading them rather than restating them is what makes
// a future edit to either fail here instead of shipping.
const baseCss = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const TOKENS = new Map(
  [baseCss, css].flatMap((sheet) =>
    [...(sheet.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
      .map(([, name, value]) => [name, value.trim()])),
);

function color(value) {
  const named = String(value).match(/^var\((--[\w-]+)\)$/);
  return (named ? TOKENS.get(named[1]) : value)?.trim();
}

function declared(selector, property) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = css.match(new RegExp(`(?:^|[,}])\\s*${escaped}\\s*\\{([^}]*)\\}`, "m"));
  assert.ok(rule, `no rule for ${selector}`);
  const found = rule[1].match(new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`));
  return found ? found[1].trim() : null;
}

function channel(value) {
  const linear = value / 255;
  return linear <= 0.03928 ? linear / 12.92 : ((linear + 0.055) / 1.055) ** 2.4;
}

function expand(hex) {
  const digits = hex.replace("#", "");
  return `#${digits.length === 3 ? [...digits].map((digit) => digit + digit).join("") : digits}`;
}

function luminance(hex) {
  const n = parseInt(expand(hex).slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255)
    + 0.7152 * channel((n >> 8) & 255)
    + 0.0722 * channel(n & 255);
}

function ratio(foreground, background) {
  const [a, b] = [luminance(foreground), luminance(background)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** What a mono printer puts on the paper. */
function greyscale(hex) {
  const n = parseInt(expand(hex).slice(1), 16);
  const grey = Math.round(0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255));
  return `#${[grey, grey, grey].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

const PANEL = "#ffffff"; // .local-lead-finding

test("every grade chip clears WCAG AA against the fill it is actually drawn on", (t) => {
  const chip = (level) => [
    declared(`.local-lead-grade-chip[data-confidence="${level}"]`, "color"),
    declared(`.local-lead-grade-chip[data-confidence="${level}"]`, "background"),
  ];
  const pairs = [
    // The unset chip's fill is a 12% ink-muted wash; flattened onto the panel
    // that is #ededed, which is what a ratio has to be measured against.
    ["grade chip · unset", declared(".local-lead-grade-chip", "color"), "#ededed"],
    ["grade chip · high", ...chip("high")],
    ["grade chip · moderate", ...chip("moderate")],
    ["grade chip · low", ...chip("low")],
    ["grade chip · insufficient", ...chip("insufficient")],
    // The value, the coverage line and the question inherit the page ink.
    ["grade value and coverage line", "#171713", PANEL],
    ["material metric", declared(".local-lead-metric", "color"), PANEL],
    ["accountable role", declared(".local-lead-role", "color"), PANEL],
    ["disclosure summary label", declared(".local-lead-detail>summary", "color"), PANEL],
    ["method notes", declared(".local-lead-method", "color"), PANEL],
    ["arithmetic", declared(".local-lead-arithmetic", "color"), PANEL],
    ["rubric and provenance", declared(".local-lead-basis,.local-lead-provenance", "color"), PANEL],
    ["status line", declared(".local-lead-status", "color"), PANEL],
    ["error state line", declared('.local-lead-finding[data-state="error"] .local-lead-status', "color"), PANEL],
    ["empty state line", declared('.local-lead-finding[data-state="empty"] .local-lead-status', "color"), PANEL],
    ["absent-figure line", declared('.local-lead-finding[data-state="unavailable"] .local-lead-metric', "color"), PANEL],
    ["absent-action line", declared('.local-lead-action[data-available="false"]', "color"), PANEL],
  ];
  for (const [name, foreground, background] of pairs) {
    const measured = ratio(color(foreground), color(background));
    t.diagnostic(`text  ${measured.toFixed(2)}:1  ${name}`);
    assert.ok(measured >= 4.5, `${name} is ${measured.toFixed(2)}:1, below the 4.5:1 AA text floor`);
  }

  // The focus ring is a non-text indicator; 1.4.11's floor is 3:1.
  const ring = declared(".local-lead-detail>summary:focus-visible", "outline").split(" ").pop();
  const ringRatio = ratio(color(ring), PANEL);
  t.diagnostic(`shape ${ringRatio.toFixed(2)}:1  disclosure focus ring`);
  assert.ok(ringRatio >= 3, `the focus ring is ${ringRatio.toFixed(2)}:1, below the 3:1 floor`);
});

test("the grade survives a mono printer: legible in greyscale, and never tint-only", (t) => {
  const inks = [];
  for (const [level, selector] of [
    ["high", '.local-lead-grade-chip[data-confidence="high"]'],
    ["insufficient", '.local-lead-grade-chip[data-confidence="insufficient"]'],
  ]) {
    const ink = color(declared(selector, "color"));
    const fill = color(declared(selector, "background"));
    const measured = ratio(greyscale(ink), greyscale(fill));
    t.diagnostic(`grey  ${measured.toFixed(2)}:1  grade chip · ${level}`);
    assert.ok(measured >= 4.5,
      `the ${level} chip is ${measured.toFixed(2)}:1 in greyscale, below the 4.5:1 floor`);
    inks.push(greyscale(ink));
  }
  // …and the reason the glyph and the word are not optional: two levels that
  // are obviously different in colour are almost the same grey on paper.
  const separation = ratio(inks[0], inks[1]);
  t.diagnostic(`grey  ${separation.toFixed(2)}:1  separation between two grade inks`);
  assert.ok(separation < 3,
    "these two inks are separable in greyscale — if that ever becomes true, this "
    + "test should be re-read, not deleted: the shape and word channels stay either way");
});

// --- C. print ---------------------------------------------------------------

const PRINT = css.match(/@media print\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";

test("the print stylesheet produces a complete sheet, not a screenshot of a screen", () => {
  assert.ok(PRINT.length > 0, "there is no @media print block in the briefing's stylesheet");

  // The answer block cannot straddle a page break.
  assert.match(PRINT, /\.local-lead-answer[^{]*\{[^}]*break-inside\s*:\s*avoid/);
  // Disclosure content is revealed; the control that revealed it is not printed
  // as a control.
  // A closed `details` hides its content in the shadow wrapper, not on the
  // light-DOM children, so the rule that actually opens it is the one on
  // `::details-content`; the `display` rule is the fallback beneath it.
  assert.match(PRINT, /::details-content[^{]*\{[^}]*content-visibility\s*:\s*visible/);
  assert.match(PRINT, /\.local-lead-detail>\*[^{]*\{[^}]*display\s*:\s*revert/);
  assert.match(PRINT, /summary[^{]*\{[^}]*list-style\s*:\s*none/);
  // Interactive-only affordances go.
  assert.match(PRINT, /\.local-lead-finding button[\s\S]*?\{[^}]*display\s*:\s*none/);
  // Provenance and rubric stay.
  assert.match(PRINT, /\.local-lead-basis,\.local-lead-provenance[^{]*\{[^}]*display\s*:\s*block/);
  // Nothing viewport-bound survives: no clipping, no sticky, no fixed height.
  assert.match(PRINT, /overflow\s*:\s*visible/);
  assert.match(PRINT, /position\s*:\s*static/);
  assert.match(PRINT, /max-height\s*:\s*none/);
  // A long ranking overflows gracefully rather than being cropped to one page.
  assert.match(PRINT, /\.local-department-evidence,\.local-department-list>li[^{]*\{[^}]*break-inside\s*:\s*avoid/);
  assert.doesNotMatch(PRINT, /overflow\s*:\s*hidden/);
});

test("nothing is unmounted, so @media print has something to reveal", async () => {
  const { document } = await openPage();
  applyBriefing(document, BRIEFING_FIXTURE);
  // The disclosure content is in the DOM whether the disclosure is open or not.
  // A print rule cannot reveal a node that was never rendered.
  for (const [container, slot] of [
    ["local-lead-arithmetic-detail", "local-lead-arithmetic"],
    ["local-lead-method-detail", "local-lead-method"],
  ]) {
    const details = byId(document, container);
    assert.equal(details.tagName, "DETAILS");
    assert.equal(details.hasAttribute("open"), false, "the disclosure ships shut on screen");
    assert.ok(details.querySelector(`#${slot}`), `${slot} is not inside its disclosure`);
    assert.ok(textOf(byId(document, slot)).length > 0, `${slot} rendered no content to print`);
  }
  // The printed region carries what a forwarded briefing has to say for itself.
  const region = byId(document, "local-lead-finding");
  assert.ok(region.querySelector("#local-lead-basis"), "the rubric version is outside the sheet");
  assert.ok(region.querySelector("#local-lead-provenance"), "provenance is outside the sheet");
  for (const id of ["local-lead-basis", "local-lead-provenance"]) {
    assert.equal(byId(document, id).closest("details"), null,
      `${id} is behind a disclosure; it must be persistent`);
  }
});

// --- D. every state ---------------------------------------------------------

test("loading, empty and error are drawn — and none of them shows a stale figure", async () => {
  for (const state of ["loading", "empty", "error"]) {
    const { document } = await openPage();
    applyBriefing(document, BRIEFING_FIXTURE);            // a figure on screen…
    applyBriefingState(document, state);                  // …and then this state
    const region = byId(document, "local-lead-finding");
    assert.equal(region.dataset.state, state);
    assert.equal(region.hidden, false);
    const status = byId(document, "local-lead-status");
    assert.equal(status.hidden, false);
    assert.equal(textOf(status), BRIEFING_STATE_MESSAGE[state]);
    assert.equal(textOf(byId(document, "local-lead-metric")), "—",
      `the ${state} state still shows the previous figure`);
    assert.equal(byId(document, "local-lead-role").hidden, true);
    // The loading skeleton is drawn over the real slots rather than replacing
    // them, so the layout does not jump when the figures arrive.
    for (const id of ["local-lead-answer", "local-lead-next", "local-lead-support"]) {
      assert.ok(byId(document, id), `the ${state} state unmounted ${id}`);
    }
  }
  // Empty says how to make a briefing appear; error says what failed and what
  // to do next. Neither is a bare "something went wrong".
  assert.match(BRIEFING_STATE_MESSAGE.empty, /Import a provider export/);
  assert.match(BRIEFING_STATE_MESSAGE.error, /Check the column mapping/);
  assert.match(BRIEFING_STATE_MESSAGE.error, /Nothing was uploaded/);
  // And the skeleton exists in CSS rather than as a swapped-in panel.
  assert.match(css, /\[data-state="loading"\][\s\S]{0,600}color\s*:\s*transparent/);
});

test("partial attribution reads as bounded, not as broken", async () => {
  const { document } = await openPage();
  // The shape the attribution policy produces: a figure was still selected, but
  // coverage is partial and a required input is missing.
  const partial = briefing({
    coverage: coverage(430, 800, BRIEFING_CONFIDENCE.moderate, ["provider_completeness"]),
  });
  applyBriefing(document, partial);

  // The grade still shows. The bound is explicit beside it, in words.
  assert.equal(byId(document, "local-lead-finding").dataset.state, "available");
  assert.equal(textOf(byId(document, "local-lead-grade-label")), "Moderate confidence");
  assert.equal(textOf(byId(document, "local-lead-grade-value")), "53.8% coverage");
  assert.match(textOf(byId(document, "local-lead-coverage")), /430 analyzed of 800/);
  assert.match(textOf(byId(document, "local-lead-coverage")), /provider_completeness/);
  // Same vocabulary as the evidence panel's partial-attribution treatment: the
  // qualifier is a word beside the figure, not a colour on it.
  assert.match(textOf(byId(document, "local-lead-method")), /did not have/);
  // …and the figure is still a figure, not a dash or an apology.
  assert.match(textOf(byId(document, "local-lead-metric")), /5200\.00 USD/);
  assert.equal(byId(document, "local-lead-metric").dataset.available, "true");

  // A withheld figure is the other half of the same idea: the contract's own
  // statement of why, and the coverage still stated.
  const withheld = briefing({
    materialMetric: null,
    arithmeticInputs: null,
    rankedAction: null,
    coverage: coverage(120, 800, BRIEFING_CONFIDENCE.low),
    absent: {
      materialMetric: { reason: ABSENCE_REASON.attributionBelowFloor, statement: ABSENCE_STATEMENT[ABSENCE_REASON.attributionBelowFloor] },
      rankedAction: { reason: ABSENCE_REASON.noMaterialMetric, statement: ABSENCE_STATEMENT[ABSENCE_REASON.noMaterialMetric] },
    },
  });
  applyBriefing(document, withheld);
  assert.equal(textOf(byId(document, "local-lead-metric")),
    ABSENCE_STATEMENT[ABSENCE_REASON.attributionBelowFloor]);
  assert.equal(textOf(byId(document, "local-lead-grade-label")), "Low confidence");
  assert.match(textOf(byId(document, "local-lead-coverage")), /15\.0% of records/);
  // No arithmetic disclosure over an absent figure: a control that opens onto
  // nothing is a control that lies.
  assert.equal(byId(document, "local-lead-arithmetic-detail").hidden, true);
  assert.equal(byId(document, "local-lead-role").hidden, true);
});

test("the implausible extremes do not break the layout", async () => {
  const { document } = await openPage();

  // A question at the contract's own string ceiling, and a metric label to match.
  const longQuestion = `${"Is our AI spend justified by what it produced across every org unit, "
    .repeat(5)}and what should we do about it next?`.slice(0, 395);
  applyBriefing(document, briefing({ headlineQuestion: longQuestion }));
  assert.equal(textOf(byId(document, "local-lead-question")).length > 300, true);
  // Nothing about a long string is allowed to escape its box, and the rule that
  // guarantees that is on the slots that can hold one.
  for (const selector of [".local-lead-metric", ".local-lead-coverage", ".local-lead-method"]) {
    assert.equal(declared(selector, "overflow-wrap"), "anywhere", `${selector} can overflow`);
  }
  assert.match(declared(".local-lead-finding h4", "max-width"), /760px/);

  // 0% coverage and 100% coverage: the two ends of the grade.
  applyBriefing(document, briefing({ coverage: coverage(0, 0, BRIEFING_CONFIDENCE.insufficient, ["ranked_departments"]) }));
  assert.equal(textOf(byId(document, "local-lead-grade-value")), "no records to cover");
  assert.equal(textOf(byId(document, "local-lead-grade-label")), "Insufficient coverage");
  assert.match(textOf(byId(document, "local-lead-coverage")), /no records to cover/);

  applyBriefing(document, briefing({ coverage: coverage(800, 800, BRIEFING_CONFIDENCE.high) }));
  assert.equal(textOf(byId(document, "local-lead-grade-value")), "100.0% coverage");

  // A missing optional slot — no action, no role — leaves no empty line behind.
  applyBriefing(document, briefing({
    rankedAction: null,
    absent: { rankedAction: { reason: ABSENCE_REASON.noRankedDepartment, statement: ABSENCE_STATEMENT[ABSENCE_REASON.noRankedDepartment] } },
  }));
  assert.equal(byId(document, "local-lead-role").hidden, true);
  assert.equal(textOf(byId(document, "local-lead-role")), "");
  assert.equal(byId(document, "local-lead-action").dataset.available, "false");
  assert.equal(textOf(byId(document, "local-lead-action")),
    ABSENCE_STATEMENT[ABSENCE_REASON.noRankedDepartment]);

  // A department ranking with many rows is a print-pagination concern, not a
  // clipping one: every row is unsplittable and none is dropped.
  assert.match(PRINT, /\.local-department-list>li[^{]*\{[^}]*break-inside\s*:\s*avoid/);
});

// --- E. accessibility -------------------------------------------------------

test("headings nest without a skip and the briefing does not claim a second h1", () => {
  const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((match) => Number(match[1]));
  assert.equal(levels.filter((level) => level === 1).length, 1, "the page must have exactly one h1");
  for (let index = 1; index < levels.length; index += 1) {
    assert.ok(levels[index] - levels[index - 1] <= 1,
      `heading level jumps from h${levels[index - 1]} to h${levels[index]}`);
  }
  // The question is the fourth level of this page's outline and the largest
  // display step inside its panel. Hierarchy is carried by size; structure by
  // the level. Both are asserted, because getting one right by breaking the
  // other is the failure this surface is prone to.
  assert.match(html, /<h4 class="local-lead-question" id="local-lead-question">/);
  const question = declared(".local-lead-finding h4", "font-size");
  const metric = declared(".local-lead-metric", "font-size");
  const step = (value) => Number(value.match(/,\s*[\d.]+vw\s*,\s*(\d+)px/)?.[1]);
  assert.ok(step(question) > step(metric),
    `the question (${question}) does not outrank the figure (${metric})`);
  // The article is labelled by the question, so the region announces as it reads.
  assert.match(html, /id="local-lead-finding"[^>]*aria-labelledby="local-lead-question"/);
});

test("the disclosure controls are native, labelled with what they reveal, and focusable", async () => {
  const { document } = await openPage();
  const region = byId(document, "local-lead-finding");
  const summaries = region.querySelectorAll("summary");
  assert.equal(summaries.length, 2);
  for (const summary of summaries) {
    // Native <summary> inside <details>: keyboard operation with Enter and
    // Space, and the expanded/collapsed state, are the element's own. Nothing
    // here reimplements either, which is why there is no aria-expanded to keep
    // in sync and no keydown handler to get wrong.
    assert.equal(summary.closest("details")?.tagName, "DETAILS");
    const label = textOf(summary);
    assert.ok(label.length > 12, `"${label}" is too short to say what it reveals`);
    assert.doesNotMatch(label, /^(more|details|show|expand|…|▸|›)$/i);
    assert.match(label, /calculated|Method notes/);
  }
  // A visible ring, from the site's existing focus token.
  assert.match(declared(".local-lead-detail>summary:focus-visible", "outline"), /var\(--focus-ring\)/);
  // Nothing in the briefing is taken out of the tab order or given a positive
  // tabindex, so the reading order and the tab order are the same order.
  for (const node of region.querySelectorAll("[tabindex]")) {
    assert.ok(["-1", "0"].includes(node.getAttribute("tabindex")),
      "a positive tabindex would reorder the keyboard path away from the DOM");
  }
});

test("the painter writes text, never markup, into every slot it owns", async () => {
  const source = await readFile(new URL("../src/local-import-flow.js", import.meta.url), "utf8");
  const painter = source.slice(source.indexOf("export function applyBriefing"),
    source.indexOf("export function applyTrustVerdict"));
  assert.ok(painter.length > 0);
  for (const forbidden of [/innerHTML/, /insertAdjacentHTML/, /outerHTML/]) {
    assert.doesNotMatch(painter, forbidden, "a briefing slot must never become markup");
  }
});
