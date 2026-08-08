// The reading experience of the guided first analysis (#1394).
//
// WHAT THESE CAN AND CANNOT PIN. The harness is a DOM double: it models no
// layout, parses no markup, and computes no style. So nothing below claims to
// test contrast or a focus ring's appearance. What it can pin is the SOURCE of
// both — the class each node carries, and the fact that src/evolution.css
// declares a `:focus-visible` rule for that class — plus everything that is
// genuinely structural: DOM order, heading levels, the accessible name and
// expanded state of every disclosure, keyboard operability, and the rule that
// no cue is carried by colour alone. The measured ratios are in the PR body.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  GUIDED_STATE, GUIDED_STATE_COPY, guidedAnalysis, guidedConfidenceBand,
} from "../src/finops-guided-first-analysis.js";
import {
  GUIDED_IDS, applyGuidedScenario, installGuidedFirstAnalysis, renderGuidedChooser,
  renderGuidedLoading,
} from "../src/finops-guided-first-analysis-view.js";
import { parseHtml, pressEnter, tabSequence, textOf } from "./support/browser.js";

const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
const css = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");

const GOOGLE = "google-vertex-detailed-v1";
const byId = (document, id) => document.getElementById(id);
const text = (document, id) => textOf(byId(document, id));

/** Every element under `node`, in document order. The harness rejects `*` and
 * descendant selectors, so this recurses `children`; text nodes live there too
 * and carry no `tagName`, hence the guard. */
function walk(node, out = []) {
  for (const child of node.children ?? []) {
    if (!child?.tagName) continue;
    out.push(child);
    walk(child, out);
  }
  return out;
}

const headingsIn = (node) => walk(node).filter((el) => /^H[1-6]$/.test(el.tagName));

/** A ready page with one scenario applied. */
function page(scenarioId = GOOGLE) {
  const document = parseHtml(html);
  applyGuidedScenario(document, scenarioId);
  return document;
}

/** A model with fields overridden, for the extremes no bundled scenario has. */
const withModel = (overrides) => ({ ...guidedAnalysis(GOOGLE), ...overrides });

test("the four regions read scenario, finding, grounds, action — in the DOM, in that order", () => {
  const document = page();
  const order = byId(document, GUIDED_IDS.chooser).querySelectorAll("h3")
    .map((heading) => heading.getAttribute("id"));
  assert.deepEqual(order, [
    GUIDED_IDS.scenarioTitle, GUIDED_IDS.findingTitle,
    GUIDED_IDS.groundsTitle, GUIDED_IDS.actionTitle,
  ], "the reading order a screen reader and a Tab key both follow is the DOM order");

  // …and the paint follows it, because nothing here reorders: no `order`, no
  // `row-reverse`, no absolute positioning on any class this surface applies.
  for (const className of ["workspace-screen", "next-step", "next-step-head", "stand-entitlement"]) {
    const rule = css.match(new RegExp(`\\n\\.${className} \\{[^}]*\\}`))?.[0] ?? "";
    assert.doesNotMatch(rule, /[;{]\s*order:|position:absolute|direction:rtl|-reverse/,
      `.${className} moves content away from its DOM position`);
  }
});

test("one h2 for the analysis region, h3 under it, and no level skipped", () => {
  const document = page();
  const regions = [GUIDED_IDS.choice, GUIDED_IDS.evidence, GUIDED_IDS.department]
    .map((id) => byId(document, id));
  const levels = regions.flatMap((region) => headingsIn(region).map((h) => Number(h.tagName[1])));
  assert.equal(levels.filter((level) => level === 1).length, 0,
    "the analysis region must not open a second document-level heading");
  assert.equal(levels.filter((level) => level === 2).length, 1,
    "exactly one h2 is the analysis region's own top heading");
  assert.equal(levels.filter((level) => level !== 2 && level !== 3).length, 0,
    "every heading under the question is an h3 — no level is skipped");
  assert.equal(levels[0], 2, "the question comes before everything it heads");
  assert.equal(byId(document, "finops-guided-question").tagName, "H2");
  // Each section still names itself with the heading it is labelled by.
  for (const region of regions) {
    const labelledBy = region.getAttribute("aria-labelledby");
    assert.match(textOf(byId(document, labelledBy)), /\S/);
  }
  // The two panel titles take focus rather than a tab stop, and the class they
  // carry is one src/evolution.css gives a focus ring.
  for (const id of [GUIDED_IDS.evidenceTitle, GUIDED_IDS.departmentTitle]) {
    const title = byId(document, id);
    assert.equal(title.getAttribute("tabindex"), "-1");
    assert.equal(title.className, "workspace-screen-title");
  }
  assert.match(css, /\.workspace-screen-title:focus-visible \{ outline:3px solid var\(--focus-ring\)/);
});

test("the action is the one card, and its evidence is demoted rather than the action inflated", () => {
  const document = page();
  const action = byId(document, GUIDED_IDS.action);
  assert.equal(action.className, "next-step", "the action must carry the page's one card treatment");
  assert.equal(action.dataset.confidence, "ranked");
  // The action's heading is the largest type on the surface; the finding sits a
  // step below it and its grounds two steps below that. Read off the classes,
  // because those are what the stylesheet sizes.
  assert.equal(byId(document, GUIDED_IDS.actionTitle).tagName, "H3");
  assert.match(css, /\.next-step-head h2,\n\.next-step-head h3 \{[^}]*font-size:clamp\(19px,2\.5vw,25px\)/);
  assert.match(css, /\.next-step-headline \{[^}]*font-size:clamp\(15px,1\.8vw,17px\)/);
  assert.match(css, /\.next-step-detail \{[^}]*font-size:13px/);
  const finding = byId(document, GUIDED_IDS.findingTitle).parentNode;
  const findingNodes = walk(finding).filter((el) => el.tagName === "P");
  assert.equal(findingNodes[0].className, "next-step-headline", "the finding is one step below the action");
  for (const node of findingNodes.slice(1)) {
    assert.equal(node.className, "next-step-detail", "the finding's evidence must sit below the finding");
  }
  // No second card and no second primary control competes with it.
  assert.equal(walk(byId(document, GUIDED_IDS.summary))
    .filter((el) => el.className === "next-step").length, 1);
  assert.equal(walk(byId(document, GUIDED_IDS.summary))
    .filter((el) => el.className === "next-step-primary").length, 1);
  assert.match(css, /\.next-step-primary:focus-visible \{ outline:3px solid var\(--focus-ring\)/);
  assert.match(css, /\.answer-door:focus-visible \{ outline:3px solid var\(--focus-ring\)/);
});

test("every disclosure is a real summary, says what it reveals, and states its own open state", () => {
  const document = page();
  const controls = [
    ...byId(document, GUIDED_IDS.summary).querySelectorAll("details"),
    ...byId(document, GUIDED_IDS.departmentBody).querySelectorAll("details"),
  ];
  assert.equal(controls.length, 2, "assumptions and department assumptions each get one control");
  const names = [];
  for (const details of controls) {
    assert.equal(details.className, "first-run-method");
    const summary = details.querySelectorAll("summary")[0];
    assert.equal(summary.tagName, "SUMMARY", "a disclosure must not be a div with a click handler");
    const name = textOf(summary);
    names.push(name);
    assert.match(name, /^Show the assumptions behind/, "the name must say what it reveals");
    assert.doesNotMatch(name, /Show more|Details$/);
    // Collapsed: the word is in the control, not only the fill behind it.
    assert.equal(details.hasAttribute("open"), false);
    assert.match(name, /collapsed/);
    const chip = walk(summary).find((el) => el.className === "first-run-method-state");
    assert.equal(chip.dataset.disclosure, "collapsed");
  }
  assert.notEqual(names[0], names[1], "two controls must not share one accessible name");
  assert.match(css, /\.first-run-method>summary:focus-visible \{ outline:3px solid var\(--focus-ring\)/);
});

test("a disclosure opens from the keyboard, and its state chip follows", () => {
  const document = page();
  const details = byId(document, GUIDED_IDS.summary).querySelectorAll("details")[0];
  const summary = details.querySelectorAll("summary")[0];
  assert.ok(tabSequence(document).includes(summary), "the control must be reachable by Tab");

  summary.focus();
  pressEnter(document);
  assert.equal(details.hasAttribute("open"), true);
  const chip = walk(summary).find((el) => el.className === "first-run-method-state");
  assert.equal(chip.dataset.disclosure, "expanded");
  assert.match(textOf(summary), /expanded/);

  pressEnter(document);
  assert.equal(details.hasAttribute("open"), false);
  assert.equal(chip.dataset.disclosure, "collapsed");
  assert.match(textOf(summary), /collapsed/);
});

test("the flow's tab stops are inside the analysis region, in reading order", () => {
  const document = parseHtml(html);
  installGuidedFirstAnalysis(document, { location: { search: "", hash: "" }, history: {} });
  const sequence = tabSequence(document);
  const stops = [GUIDED_IDS.select, "answer-door", "first-run-method", "next-step-primary"];
  const positions = [
    sequence.indexOf(byId(document, GUIDED_IDS.select)),
    sequence.indexOf(walk(byId(document, GUIDED_IDS.summary))
      .find((el) => el.className === "answer-door")),
    sequence.indexOf(byId(document, GUIDED_IDS.summary)
      .querySelectorAll("details")[0].querySelectorAll("summary")[0]),
    sequence.indexOf(walk(byId(document, GUIDED_IDS.action))
      .find((el) => el.className === "next-step-primary")),
  ];
  for (const [index, position] of positions.entries()) {
    assert.ok(position >= 0, `${stops[index]} is not reachable by keyboard`);
  }
  // The disclosure sits inside region 3, the primary control closes region 4.
  assert.ok(positions[0] < positions[2] && positions[2] < positions[1]
    && positions[1] < positions[3], `tab order ${positions} does not follow the reading order`);
  // Nothing was added above the first-run region: every stop is inside the
  // analysis panels themselves.
  for (const id of [GUIDED_IDS.select, GUIDED_IDS.action]) {
    assert.equal(byId(document, id).closest("section").getAttribute("id"), GUIDED_IDS.choice);
  }
});

test("no cue is carried by colour alone", () => {
  const document = page();
  const chips = walk(byId(document, GUIDED_IDS.summary))
    .filter((el) => el.className === "confidence-chip");
  assert.equal(chips.length, 2, "confidence and provenance each get a chip");
  for (const chip of chips) {
    const label = walk(chip).find((el) => el.className === "confidence-chip-label");
    assert.match(textOf(label), /\S/, "a chip must state its level in words");
    const shape = walk(chip).find((el) => el.className === "confidence-chip-shape");
    assert.equal(shape.getAttribute("aria-hidden"), "true",
      "the glyph is decoration beside the word, never the word's replacement");
    assert.match(chip.dataset.confidence, /^(full|degraded|suppressed)$/);
  }
  assert.match(textOf(chips[0]), /confidence/);
  assert.match(textOf(chips[1]), /provenance/);
  // The words for the three bands, and a nonsense score that reads low rather
  // than reading as the best case.
  assert.equal(guidedConfidenceBand(90).label, "high confidence");
  assert.equal(guidedConfidenceBand(63).label, "moderate confidence");
  assert.equal(guidedConfidenceBand(10).label, "low confidence");
  assert.equal(guidedConfidenceBand(null).label, "low confidence");
  assert.equal(guidedConfidenceBand(90).shape !== guidedConfidenceBand(63).shape, true);
  // The action card's own state is a word before it is a wash.
  const document2 = parseHtml(html);
  renderGuidedChooser(document2, withModel({ material: false }));
  const action = byId(document2, GUIDED_IDS.action);
  assert.equal(action.dataset.confidence, "low");
  assert.match(text(document2, GUIDED_IDS.action), /Below the materiality floor/);
});

test("loading, empty and error are drawn — in all three panels, with the control still in reach", () => {
  const document = parseHtml(html);
  renderGuidedLoading(document);
  for (const id of [GUIDED_IDS.summary, GUIDED_IDS.evidenceBody, GUIDED_IDS.departmentBody]) {
    assert.match(text(document, id), /Reading the bundled provider export/);
  }
  assert.equal(byId(document, GUIDED_IDS.choice).dataset.guidedState, "loading");
  assert.ok(byId(document, GUIDED_IDS.select), "the chooser survives every non-ready state");

  applyGuidedScenario(document, null);
  assert.equal(byId(document, GUIDED_IDS.choice).dataset.guidedState, "empty");
  assert.match(text(document, GUIDED_IDS.summary), /Choose a bundled provider export to analyze/);

  applyGuidedScenario(document, "no-such-scenario", { announce: true });
  assert.equal(byId(document, GUIDED_IDS.choice).dataset.guidedState, "error");
  for (const id of [GUIDED_IDS.summary, GUIDED_IDS.evidenceBody, GUIDED_IDS.departmentBody]) {
    assert.match(text(document, id), /could not be produced|no finding was computed|shows the/);
  }
  assert.match(text(document, GUIDED_IDS.live), /could not be produced/,
    "a failure a reader did not see must still be one they hear");
  // Every state says its name in a word and a shape as well as a tint, and none
  // of it is folded into a disclosure.
  for (const state of [GUIDED_STATE.loading, GUIDED_STATE.empty, GUIDED_STATE.error]) {
    assert.match(GUIDED_STATE_COPY[state].eyebrow, /\S/);
    assert.match(GUIDED_STATE_COPY[state].shape, /\S/);
  }
  const live = byId(document, GUIDED_IDS.live);
  for (let node = live.parentNode; node; node = node.parentNode) {
    assert.notEqual(node.tagName, "DETAILS", "the status region is inside a disclosure");
  }
  // …and the flow recovers: a good id after a bad one paints the analysis again.
  applyGuidedScenario(document, GOOGLE);
  assert.equal(byId(document, GUIDED_IDS.choice).dataset.guidedState, "ready");
  assert.match(text(document, GUIDED_IDS.summary), /Data Platform/);
});

test("the implausible extremes are drawn, not degraded into", () => {
  // A finding of zero: below the floor, so the card takes the low variant and
  // says why in words rather than going quiet.
  const zero = parseHtml(html);
  renderGuidedChooser(zero, withModel({
    material: false, answer: "Data Platform has $0 in modelled recoverable spend.",
    impact: "$0 of $22,500 analyzed in Data Platform — 0% of that department's modelled spend.",
    whyItMatters: "Bundled demo materiality floor: $0 against the $1,000 floor — below the floor.",
  }));
  assert.equal(byId(zero, GUIDED_IDS.action).dataset.confidence, "low");
  assert.match(text(zero, GUIDED_IDS.summary), /\$0 in modelled recoverable spend/);
  assert.match(text(zero, GUIDED_IDS.summary), /below the floor/);

  // An enormous figure. It must not be clipped, and the classes it lands in are
  // the ones src/evolution.css lets break inside a word.
  const huge = parseHtml(html);
  const enormous = "$987,654,321,098";
  renderGuidedChooser(huge, withModel({
    answer: `Data Platform has ${enormous} in modelled recoverable spend.`,
    benchmark: `${enormous} of recoverable spend usd over 1–31 July 2026`,
  }));
  assert.match(text(huge, GUIDED_IDS.summary), /\$987,654,321,098/);
  for (const className of ["next-step-headline", "next-step-detail"]) {
    assert.match(css, new RegExp(`\\.${className} \\{[^}]*overflow-wrap:anywhere`),
      `a long value in .${className} would overflow its container`);
  }

  // A very long department name. It wraps everywhere it can, and in the one
  // control that cannot wrap it is clipped for the eye and whole for the
  // accessibility tree.
  const long = parseHtml(html);
  const name = "Developer Experience and Internal Platform Enablement Working Group";
  renderGuidedChooser(long, withModel({
    action: { ...guidedAnalysis(GOOGLE).action, team: name },
    departmentScope: `${name} is the only department in this export.`,
  }));
  const primary = walk(byId(long, GUIDED_IDS.action)).find((el) => el.className === "next-step-primary");
  assert.match(textOf(primary), new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    "the full name must survive for a screen reader");
  const shown = walk(primary).find((el) => el.getAttribute("aria-hidden") === "true");
  assert.match(textOf(shown), /…$/, "the visible half is clipped rather than pushing the card wide");
  assert.ok(textOf(shown).length < 40);
  assert.match(text(long, GUIDED_IDS.summary), new RegExp(`${name} is the only department`));

  // A scenario with one department names it as the whole scope rather than
  // implying a list was truncated.
  const single = guidedAnalysis(GOOGLE);
  assert.equal(single.departmentCount, 1);
  assert.match(single.departmentScope, /only department in this export/);
});
