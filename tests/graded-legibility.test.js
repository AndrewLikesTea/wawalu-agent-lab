// Whether a leader can read confidence and coverage before they act.
//
// The tests in `graded-sample-view.test.js` cover what the graded panels say.
// These cover whether the saying survives the conditions a real reader meets:
// a monochrome screenshot, a screen reader, a keyboard, a 320px phone, and the
// extremes — 0% and 100% coverage, a cohort of one, a department name long
// enough to break a row, and a sample thin enough to sit on the confidence
// floor.
//
// Contrast is measured here rather than asserted from memory: the ratios come
// out of `src/evolution.css` itself, so a future edit to a token or a pairing
// fails this file instead of shipping a grade nobody can read. The measured
// ratios are printed with `diagnostic` so the numbers are in the run, not only
// in a summary somebody wrote once.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";
import { applyGradedSample, clearGradedSample } from "../src/graded-sample-view.js";
import { gradedSampleFigures, querySampleEligibility } from "../src/graded-sample-figures.js";
import { classifyQuerySample, parseQuerySample } from "../src/query-sample-contract.js";
import { scorePromptLiteracy } from "../src/prompt-literacy-scoring.js";
import { exampleDepartmentUnitIds, exampleQuerySampleText } from "../src/query-sample-example.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const CSS = new URL("../src/evolution.css", import.meta.url);
const UNITS = exampleDepartmentUnitIds();

const byId = (document, id) => document.getElementById(id);
const openPage = () => loadPage(PAGE);

/**
 * A graded model from the real validator, classifier, rubric and eligibility
 * verdict. `coveredUsd / totalUsd` is the only dial: it is what decides whether
 * the surface is confident, provisional, or refuses to publish a letter.
 */
function model(coveredUsd, totalUsd, { files = ["june-sample.csv"], other = "Cinder Research" } = {}) {
  const classified = classifyQuerySample(parseQuerySample(exampleQuerySampleText()));
  const departments = [{ id: UNITS[0], name: "Atlas Platform", spendUsd: coveredUsd }];
  if (totalUsd - coveredUsd > 0) {
    departments.push({ id: "psn_absent", name: other, spendUsd: totalUsd - coveredUsd });
  }
  return gradedSampleFigures({
    scored: scorePromptLiteracy(classified.records),
    eligibility: querySampleEligibility({
      orgUnitIds: classified.records.map((record) => record.orgUnitId),
      departments,
      totalUsd,
    }),
    recordCounts: {
      total: classified.records.length + classified.unclassified.length,
      unclassified: classified.unclassified.length,
    },
    files,
    spendUsd: totalUsd,
    recoverableUsd: 120,
    period: "2026-06-01 to 2026-06-30",
  });
}

// --- contrast ---------------------------------------------------------------

const css = await readFile(CSS, "utf8");

const TOKENS = new Map(
  [...(css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "").matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)]
    .map(([, name, value]) => [name, value.trim()]),
);

/** Resolve `var(--x)` one level deep — the depth this stylesheet actually uses. */
function color(value) {
  const named = value.match(/^var\((--[\w-]+)\)$/);
  return (named ? TOKENS.get(named[1]) : value)?.trim();
}

/** The declared value of one property on one selector, top-level rules only. */
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

/** `#fff` and `#ffffff` are the same colour; the stylesheet uses both spellings. */
function expand(hex) {
  const digits = hex.replace("#", "");
  return `#${digits.length === 3 ? [...digits].map((d) => d + d).join("") : digits}`;
}

function luminance(hex) {
  const n = parseInt(expand(hex).slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255)
    + 0.7152 * channel((n >> 8) & 255)
    + 0.0722 * channel(n & 255);
}

/** Flatten a translucent layer onto an opaque one, so a ratio means something. */
function over(top, bottom, alpha) {
  const parts = (hex) => [1, 3, 5].map((at) => parseInt(expand(hex).slice(at, at + 2), 16));
  const [f, b] = [parts(top), parts(bottom)];
  return `#${f.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha))
    .toString(16).padStart(2, "0")).join("")}`;
}

function ratio(foreground, background) {
  const [a, b] = [luminance(foreground), luminance(background)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const PAGE_BG = "#f3f1eb";               // the tab's own page fill
const PANEL_BG = "#ffffff";              // .graded-sample
const KPI_BG = over("#ffffff", PAGE_BG, 0.68);   // .kpi is 68% white over the page
const HATCH = over("#000000", "#fffaf0", 0.14);  // the provisional figure's darkest stripe

test("every grade state clears WCAG AA against the background it is actually drawn on", (t) => {
  const text = [
    ["confident grade letter", declared(".graded-letter", "color"), declared(".graded-headline", "background")],
    ["confident chip word", declared(".graded-status-chip", "color"), declared(".graded-status-chip", "background")],
    ["provisional grade letter", declared('.graded-letter[data-grade-status="provisional"]', "color"),
      declared('.graded-headline[data-grade-status="provisional"]', "background")],
    ["provisional letter over its own hatch", declared('.graded-letter[data-grade-status="provisional"]', "color"), HATCH],
    ["provisional chip word", declared('.graded-status-chip[data-grade-status="provisional"]', "color"),
      declared(".graded-status-chip", "background")],
    ["coverage label on the confident block", declared(".graded-coverage-label", "color"),
      declared(".graded-headline", "background")],
    ["coverage label on the provisional block", declared(".graded-coverage-label", "color"),
      declared('.graded-headline[data-grade-status="provisional"]', "background")],
    ["unmeasured KPI chip", declared(".kpi-flag", "color"), declared(".kpi-flag", "background")],
    ["unmeasured KPI value", declared('.kpi[data-available="false"] .kpi-value', "color"),
      declared('.kpi[data-available="false"]', "background")],
    ["measured KPI note", declared(".kpi-note", "color"), KPI_BG],
    ["disclosure toggle label", declared(".graded-disclosure-toggle", "color"),
      declared(".graded-disclosure-toggle", "background")],
    ["provenance line", declared(".graded-provenance", "color"), PANEL_BG],
  ];
  for (const [name, foreground, background] of text) {
    const measured = ratio(color(foreground), color(background));
    t.diagnostic(`text  ${measured.toFixed(2)}:1  ${name}`);
    assert.ok(measured >= 4.5, `${name} is ${measured.toFixed(2)}:1, below the 4.5:1 AA text floor`);
  }

  // 1.4.11: the edge that says "this is a control" and the edge that says
  // "provisional" both have to be visible on their own.
  const nonText = [
    ["disclosure toggle border", declared(".graded-disclosure-toggle", "border").split(" ").pop(), PANEL_BG],
    ["focus ring on the toggle", declared(".graded-disclosure-toggle:focus-visible", "outline").split(" ").pop(), PANEL_BG],
    ["confident block border", declared(".graded-headline", "border").split(" ").pop(), PANEL_BG],
    ["provisional block border", declared('.graded-headline[data-grade-status="provisional"]', "border").split(" ").pop(), PANEL_BG],
    ["unmeasured KPI card border", declared('.kpi[data-available="false"]', "border-color"), PAGE_BG],
  ];
  for (const [name, foreground, background] of nonText) {
    const measured = ratio(color(foreground), color(background));
    t.diagnostic(`shape ${measured.toFixed(2)}:1  ${name}`);
    assert.ok(measured >= 3, `${name} is ${measured.toFixed(2)}:1, below the 3:1 AA non-text floor`);
  }
});

test("no grade state is told by tint alone: the border style and the glyph differ too", async () => {
  const confident = (await openPage()).document;
  applyGradedSample(confident, model(1000, 1000));
  const provisional = (await openPage()).document;
  applyGradedSample(provisional, model(300, 1000));

  const shapeOf = (document, selector) =>
    textOf(document.querySelector(selector).querySelector(".graded-shape"));

  // Channel one: the glyph, which is a shape and not a colour.
  assert.notEqual(shapeOf(confident, ".graded-status-chip"), shapeOf(provisional, ".graded-status-chip"));
  assert.notEqual(shapeOf(confident, ".graded-grade-line"), shapeOf(provisional, ".graded-grade-line"));

  // Channel two: the words, in the chip as well as in the announced line.
  assert.equal(textOf(confident.querySelector(".graded-status-word")), "Confident grade");
  assert.equal(textOf(provisional.querySelector(".graded-status-word")), "Provisional grade");

  // Channel three: the border style of the block the letter sits in — a static
  // property, so it holds in a screenshot with no hover, motion, or tooltip.
  assert.match(declared(".graded-headline", "border"), /solid/);
  assert.match(declared('.graded-headline[data-grade-status="provisional"]', "border"), /dashed/);
  assert.match(declared('.graded-status-chip[data-grade-status="provisional"]', "border"), /dashed/);

  // And the qualifier is inside the block with the letter, not a stat beside it.
  const block = provisional.querySelector(".graded-headline");
  assert.ok(textOf(block).includes("Provisional grade"));
  assert.ok(textOf(block).includes("of imported spend scored"));

  // Opacity is never the signal: a faded grade reads as de-emphasised.
  for (const selector of [".graded-letter", '.graded-letter[data-grade-status="provisional"]',
    ".graded-headline", '.graded-headline[data-grade-status="provisional"]',
    ".graded-status-chip", '.graded-status-chip[data-grade-status="provisional"]']) {
    assert.equal(declared(selector, "opacity"), null, `${selector} must not signal with opacity`);
  }
});

test("a KPI the import could not fill says so in a word and a shape, not only a tint", async () => {
  const { document } = await openPage();
  // A query sample carries no cost field, so peer position has no figure.
  applyGradedSample(document, model(1000, 1000));

  assert.equal(byId(document, "kpi-peer").dataset.available, "false");
  assert.equal(byId(document, "kpi-peer-flag").hidden, false);
  assert.match(textOf(byId(document, "kpi-peer-flag")), /^○ unmeasured$/);
  assert.equal(byId(document, "kpi-peer-value").textContent, "Unavailable");

  // A card that does have a figure carries no marker at all.
  assert.equal(byId(document, "kpi-spend").dataset.available, "true");
  assert.equal(byId(document, "kpi-spend-flag").hidden, true);

  // The cohort statement carries the same distinction on its own block.
  const cohort = document.querySelector(".graded-cohort");
  assert.equal(cohort.dataset.available, "false");
  assert.equal(textOf(cohort.querySelector(".graded-shape")), "○");
  assert.match(textOf(cohort), /No peer cohort in your import\./);
  assert.match(declared('.graded-cohort[data-available="false"]', "border-left-style"), /dashed/);

  // And handing the page back restores every card, marker included.
  clearGradedSample(document);
  assert.equal(byId(document, "kpi-peer-flag").hidden, true);
  assert.equal(byId(document, "kpi-peer").dataset.available, undefined);
});

test("the import announces the new grade, coverage and confidence — once", async () => {
  const { document } = await openPage();
  applyGradedSample(document, model(300, 1000));

  const live = byId(document, "graded-sample-live");
  assert.equal(live.getAttribute("aria-live"), "polite");
  assert.equal(live.getAttribute("role"), "status");
  assert.equal(live.getAttribute("aria-atomic"), "true");
  const announced = textOf(live);
  assert.match(announced, /Bundled synthetic example replaced by your import\./,
    "it says the example numbers are gone");
  assert.match(announced, /Grade [A-F]/, "the grade");
  assert.match(announced, /30\.0% of imported spend scored/, "the coverage");
  assert.match(announced, /Provisional grade/, "the confidence");

  // Opening and closing the disclosure repaints the panel. The sentence has not
  // changed, so the region must not be written again — a status region rewritten
  // with the same string announces the whole grade a second time.
  const before = live.textContent;
  let writes = 0;
  Object.defineProperty(live, "textContent", {
    configurable: true,
    get: () => before,
    set: () => { writes += 1; },
  });
  byId(document, "graded-subscores-toggle").click();
  byId(document, "graded-subscores-toggle").click();
  assert.equal(writes, 0, "the disclosure must not re-announce the grade");
  delete live.textContent;

  // A second, different import is a second announcement.
  applyGradedSample(document, model(1000, 1000));
  assert.match(textOf(byId(document, "graded-sample-live")), /Confident grade/);
});

test("the graded panel is reachable and operable from the keyboard alone", async () => {
  const { document } = await openPage();
  applyGradedSample(document, model(1000, 1000));

  const toggle = byId(document, "graded-subscores-toggle");
  assert.equal(toggle.tagName, "BUTTON", "a disclosure trigger is a button, never a click-handled div");
  assert.equal(toggle.getAttribute("type"), "button");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");

  // The tab order through the graded region, recorded rather than assumed.
  const order = tabSequence(document).map((node) => node.id || node.tagName);
  const at = order.indexOf("graded-subscores-toggle");
  assert.ok(at >= 0, "the trigger is in the document's tab order");

  let focused = null;
  for (let step = 0; step <= order.length && focused?.id !== "graded-subscores-toggle"; step += 1) {
    focused = pressTab(document);
  }
  assert.equal(focused?.id, "graded-subscores-toggle");
  pressEnter(document);
  assert.equal(byId(document, "graded-subscores-toggle").getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement?.id, "graded-subscores-toggle", "focus is never stranded by the repaint");

  // Nothing inside the opened panel takes focus, so Tab continues past it.
  const opened = byId(document, "graded-subscores-panel");
  assert.equal(opened.hidden, false);
  assert.equal(declared(".graded-disclosure-toggle:focus-visible", "outline").startsWith("3px solid"), true,
    "the focus indicator is a 3px ring, not a 1px hairline");
});

test("the graded region joins the page outline with no skipped heading level", async () => {
  const { document } = await openPage();
  applyGradedSample(document, model(1000, 1000));

  const title = byId(document, "graded-sample-title");
  assert.equal(title.tagName, "H2", "the section is a sibling of the page's other h2 panels");
  assert.equal(byId(document, "graded-sample").getAttribute("aria-labelledby"), "graded-sample-title");

  const inner = byId(document, "graded-sample-body").querySelectorAll("h3").map((node) => textOf(node));
  assert.deepEqual(inner, ["Cohort comparison", "Prioritized next action"],
    "the blocks inside the section head themselves one level down, with nothing skipped");
});

test("nothing on this surface truncates: no ellipsis, no nowrap, and the payload wraps", () => {
  const graded = [...css.matchAll(/(?:^|\})\s*([^{}]*(?:graded-|kpi-|\.kpi)[^{}]*)\{([^}]*)\}/g)];
  assert.ok(graded.length > 10, "the graded selectors were found");
  for (const [, selector, body] of graded) {
    assert.equal(/text-overflow/.test(body), false, `${selector.trim()} truncates with an ellipsis`);
    assert.equal(/white-space\s*:\s*nowrap/.test(body), false, `${selector.trim()} refuses to wrap`);
  }

  // The coverage figure and the prioritized next action are the payload: both
  // break rather than overflow, whatever a department is called.
  for (const selector of [".graded-coverage-value", ".graded-action-text", ".graded-cohort-answer",
    ".graded-category-label", ".graded-provenance", ".kpi-value"]) {
    assert.equal(declared(selector, "overflow-wrap"), "anywhere", `${selector} must break rather than overflow`);
  }

  // At 320px the KPI row and the mix legend collapse to one column instead of
  // holding a track wider than the viewport, and the axis list stacks.
  assert.match(declared(".kpi-row", "grid-template-columns"), /min\(100%,\s*220px\)/);
  assert.match(declared(".mix-legend", "grid-template-columns"), /min\(100%,\s*230px\)/);
  const narrow = css.match(/@media\(max-width:640px\)\s*\{([\s\S]*?)\n\}/g).join("\n");
  assert.match(narrow, /\.graded-axes\s*\{\s*grid-template-columns:minmax\(0,1fr\)/,
    "the two auto columns of the axis list would push a 320px page sideways");
});

test("extremes · 100% and 0% coverage are both drawn, and neither is drawn as the other", async () => {
  const full = (await openPage()).document;
  applyGradedSample(full, model(1000, 1000));
  assert.equal(full.querySelector(".graded-headline").dataset.gradeStatus, "confident");
  assert.match(textOf(full.querySelector(".graded-coverage")), /100\.0% of imported spend scored/);
  assert.equal(byId(full, "kpi-row").hidden, false);

  // Nothing scored: the surface publishes no letter at all rather than an F.
  const none = (await openPage()).document;
  applyGradedSample(none, model(0, 1000));
  assert.equal(none.querySelector(".graded-letter"), null, "0% coverage must not produce a letter");
  assert.equal(none.querySelector(".graded-coverage"), null);
  assert.equal(byId(none, "kpi-row").hidden, true, "a half-filled KPI row would read as graded");
  assert.equal(byId(none, "spend-mix-panel").hidden, true);
  assert.match(textOf(byId(none, "graded-sample-body")), /insufficient coverage/);
  assert.match(textOf(byId(none, "graded-sample-live")),
    /Bundled synthetic example replaced by your import\./);

  // The one next action still has to be there — it is the way out of this state.
  const action = none.querySelector(".graded-action");
  assert.ok(textOf(action).length > 0);
  assert.match(textOf(action), /Prioritized next action/);
});

test("extremes · a sample on the confidence floor is marked, not rounded up", async () => {
  const { document } = await openPage();
  // 25% is the exact floor of the provisional tier, read with `>=` upstream.
  applyGradedSample(document, model(250, 1000));

  assert.equal(document.querySelector(".graded-headline").dataset.gradeStatus, "provisional");
  assert.equal(textOf(document.querySelector(".graded-status-word")), "Provisional grade");
  assert.match(textOf(document.querySelector(".graded-coverage")), /25\.0% of imported spend scored/);
  assert.match(textOf(document.querySelector(".graded-coverage")), /provisional grade/);
  // The rule that produced the qualifier is on the first screen, not disclosed.
  assert.match(textOf(document.querySelector(".graded-coverage-rule")), /not actionable alone/);
  assert.equal(byId(document, "graded-subscores-panel").hidden, true, "the detail still starts closed");
});

test("extremes · a cohort of one, and a department name long enough to break a row", async () => {
  const { document } = await openPage();
  const long = `Global ${"Platform".repeat(24)} Engineering`;
  applyGradedSample(document, model(300, 1000, { other: long }));

  // Only one department is in the sample, so there is nothing to compare with —
  // and the surface says which, rather than drawing an empty comparison.
  const cohort = document.querySelector(".graded-cohort");
  assert.equal(cohort.dataset.available, "false");
  assert.match(textOf(cohort), /No peer cohort in your import\./);
  assert.match(textOf(cohort), /no peer cohort and no benchmark methodology/);

  // The long name arrives whole. Nothing clipped it, and nothing shortened it.
  const action = textOf(document.querySelector(".graded-action-text"));
  assert.ok(action.includes(long), "the department name reaches the page in full");
  assert.equal(action.includes("…"), false, "a name is wrapped, never ellipsised");
  assert.equal(action.includes("..."), false);

  // And it is one text node, so a name made of markup stays a name.
  const words = document.querySelector(".graded-action-words");
  assert.deepEqual(words.children.map((child) => child.tagName), ["#text"]);
});

test("extremes · an imported department name made of markup is text, never a node", async () => {
  const { document } = await openPage();
  // The page's own module scripts, counted before the injection: the claim is
  // that the hostile string produced no script node, not that the page ships a
  // particular number of them.
  const shipped = document.querySelectorAll("script").length;
  const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  applyGradedSample(document, model(300, 1000, { other: hostile }));

  assert.match(textOf(document.querySelector(".graded-action-text")), /<img src=x onerror="alert\(1\)">/);
  assert.equal(document.querySelectorAll("img").length, 0);
  assert.equal(document.querySelectorAll("script").length, shipped, "only the page's own module scripts exist");
});
