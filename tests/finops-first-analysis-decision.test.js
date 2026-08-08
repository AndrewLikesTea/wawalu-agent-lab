// THE FIRST-ANALYSIS DECISION, read as a reader meets it (#1394).
//
// These are accessibility and hierarchy regressions, not model arithmetic —
// tests/finops-analysis-readiness.test.js owns the numbers. What is pinned here
// is the reading order, the heading outline, the disclosure's keyboard contract,
// the rule that no cue carries its meaning in colour alone, and the four states
// besides the happy one.
//
// HARNESS NOTES, so a later change does not relearn them the slow way. The
// harness parses no markup and models no layout, so `textOf` reads straight
// through a shut disclosure: "hidden when collapsed" proves nothing and is not
// asserted — the `open` attribute is. It reflects no property to an attribute,
// so a property is read as a property. It rejects descendant and universal
// selectors, so children are recursed. Text nodes sit in `node.children` with no
// `dataset`, so every dataset read is guarded. And nothing is compared for
// identity against an element: `assert.equal(node, null)` walks the whole parsed
// page and outlives the test timeout.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseHtml, pressKey, tabSequence, textOf } from "./support/browser.js";
import { analysisReadinessForDataset } from "../src/finops-analysis-readiness.js";
import { analyzeBundledScenario, BUNDLED_SCENARIO_IDS } from "../src/finops-bundled-scenarios.js";
import {
  DECISION_ORDER, DECISION_STATE, PLAUSIBLE_MAX_USD, firstAnalysisDecision, implausibleFigure,
} from "../src/finops-first-analysis-decision.js";
import { renderAnalysisReadiness } from "../src/finops-analysis-readiness-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const REGION = "finops-analysis-readiness";
const shippedPage = async () => parseHtml(await readFile(PAGE, "utf8"));

/** Every element under `root`, in DOM order. Text nodes carry no tagName. */
function descendants(root) {
  const out = [];
  for (const child of root.children ?? []) {
    if (!child.tagName || typeof child.getAttribute !== "function") continue;
    out.push(child);
    out.push(...descendants(child));
  }
  return out;
}

const elementChildren = (node) => (node.children ?? []).filter((child) => child.tagName);

/** Is `node` inside a disclosure? Walked, because descendant selectors throw. */
function insideDetails(node) {
  for (let walk = node?.parentNode; walk; walk = walk.parentNode) {
    if (walk.tagName === "DETAILS") return true;
  }
  return false;
}

const readyOutcome = () => analyzeBundledScenario({ scenarioId: BUNDLED_SCENARIO_IDS[0] });

/** One bundled-shaped dataset, generated here rather than committed. */
function dataset({ department = "Platform Engineering", recoverable = 3600, actions = true } = {}) {
  const period = { periodId: "p", label: "1–31 July 2026" };
  return {
    provenance: { label: "Bundled synthetic fixture", source: "invented records" },
    departments: [{ name: department, spendUsd: 18000, queries: 240000 }],
    evidence: [{ sampleId: "s-1", category: "Over-provisioned" }],
    actionPlan: {
      benchmarkPeriods: [period],
      actions: actions
        ? [{
          actionId: "a-1", departmentName: department, isTopNextAction: true,
          action: "Pilot standard-model routing for routine requests.",
          baseline: {
            metricName: "recoverable_spend_usd", value: recoverable, unit: "USD",
            periodRef: period.periodId,
          },
          confidence: { value: 0.75, scale: "0_to_1" },
        }]
        : [],
    },
  };
}

async function rendered(outcome) {
  const document = await shippedPage();
  renderAnalysisReadiness(document, outcome, { scenarioIds: BUNDLED_SCENARIO_IDS });
  return document;
}

// ---------------------------------------------------------------------------
// A. ONE READING ORDER, AND IT IS THE DOM'S.
// ---------------------------------------------------------------------------

test("the five regions ship in the one declared reading order", async () => {
  const document = await shippedPage();
  const region = document.getElementById(REGION);
  const ordered = elementChildren(region)
    .map((child) => child.id)
    .filter((id) => DECISION_ORDER.includes(id));
  assert.deepEqual(ordered, [...DECISION_ORDER],
    "scenario, the one finding, its cues, the action, then the working");
  // The order survives a paint: the view moves no node, it only writes text.
  const painted = await rendered(readyOutcome());
  assert.deepEqual(
    elementChildren(painted.getElementById(REGION)).map((child) => child.id)
      .filter((id) => DECISION_ORDER.includes(id)),
    [...DECISION_ORDER]);
});

// A narrow viewport must reflow this sequence, not reorder it. The harness models
// no layout, so the property is pinned at its cause: the region declares no
// `order`, no `position:absolute`, no reversed flex direction and no `float`,
// either inline or in the two stylesheets that could reach these classes.
test("nothing desynchronizes the visual order from the DOM order", async () => {
  const document = await shippedPage();
  const region = document.getElementById(REGION);
  for (const node of [region, ...descendants(region)]) {
    const style = node.getAttribute("style") ?? "";
    assert.doesNotMatch(style, /(^|;)\s*order\s*:/, `${node.id || node.tagName} orders itself`);
    assert.doesNotMatch(style, /position\s*:\s*absolute|flex-direction\s*:\s*[a-z-]*reverse|float\s*:/,
      `${node.id || node.tagName} lifts itself out of the flow`);
  }
  const classes = new Set();
  for (const node of [region, ...descendants(region)]) {
    for (const name of node.className?.split(/\s+/) ?? []) if (name) classes.add(name);
  }
  const sheets = await Promise.all(["evolution.css", "styles.css"].map((name) =>
    readFile(new URL(`../src/${name}`, PAGE), "utf8")));
  for (const sheet of sheets) {
    for (const [selector, body] of sheet.matchAll(/([^{}]+)\{([^}]*)\}/g)
      .map((match) => [match[1], match[2]])) {
      if (!/(^|;)\s*(order|float)\s*:|position\s*:\s*absolute|flex-direction\s*:\s*[a-z-]*reverse/
        .test(body)) continue;
      for (const name of classes) {
        // `.visually-hidden` is the exception and it is the point of it: the
        // status paragraph is taken out of the flow because it has no visual
        // place in the reading order at all, only an announced one.
        if (name === "visually-hidden") continue;
        assert.ok(!selector.includes(`.${name}`) || /:hover|::|\[hidden\]/.test(selector),
          `.${name} is reordered or taken out of the flow by "${selector.trim()}"`);
      }
    }
  }
});

test("the heading outline is one H2 and skips no level around it", async () => {
  const document = await shippedPage();
  const region = document.getElementById(REGION);
  const own = descendants(region).filter((node) => /^H[1-6]$/.test(node.tagName));
  assert.deepEqual(own.map((node) => node.tagName), ["H2"],
    "the region contributes exactly one heading");
  assert.equal(own[0].id, "analysis-readiness-question");
  assert.equal(region.getAttribute("aria-labelledby"), "analysis-readiness-question");

  const main = document.getElementById("main-content");
  const outline = descendants(main).filter((node) => /^H[1-6]$/.test(node.tagName));
  const at = outline.indexOf(own[0]);
  assert.ok(at > 0, "the region's heading is not the first heading in <main>");
  // A SKIP IS ONLY EVER A DESCENT. Coming back UP the outline — H3 then H2 — is
  // correct, so the rule is that no step deeper may jump more than one level.
  const level = (node) => Number(node.tagName.slice(1));
  assert.ok(level(own[0]) - level(outline[at - 1]) <= 1,
    `${outline[at - 1].tagName} then H2 skips a level`);
  assert.ok(level(outline[at + 1]) - level(own[0]) <= 1,
    `H2 then ${outline[at + 1].tagName} skips a level`);
});

// The action is drawn in its own marked block, at a step BELOW the finding, so
// "what to do" and "why we think so" are told apart without reading the prose.
test("the finding leads the type scale and the action is a distinct block", async () => {
  const document = await rendered(readyOutcome());
  const value = document.getElementById("analysis-readiness-finding-value");
  assert.ok(value.className.includes("stand-figure-value"),
    "the finding is not on this surface's lead figure step");
  assert.equal(value.dataset?.available, "true");
  const action = document.getElementById("analysis-readiness-action");
  assert.ok(action.className.includes("stand-answer"),
    "the action is not on the answer step below the figure");
  const block = document.getElementById("analysis-readiness-act");
  assert.ok(block.className.includes("stand-figure"),
    "the action has no marked block of its own");
  assert.equal(action.parentNode.id, "analysis-readiness-act");
  assert.match(textOf(document.getElementById("analysis-readiness-act-label")),
    /Recommended next action/);
  // And the action is not styled prose pretending to be a control: this region
  // ships none, because the page's one operable action is above it and the first
  // screen has no spare tab stop. The basis says where to act.
  assert.match(textOf(document.getElementById("analysis-readiness-act-basis")),
    /action control/);
});

// ---------------------------------------------------------------------------
// B. NO CUE CARRIES ITS MEANING IN COLOUR ALONE.
// ---------------------------------------------------------------------------

test("every severity, confidence and provenance cue ships a word and a value", async () => {
  for (const outcome of [null, readyOutcome(), analyzeBundledScenario({ scenarioId: "nope" }),
    analysisReadinessForDataset(dataset({ actions: false }))]) {
    const document = await rendered(outcome);
    const region = document.getElementById(REGION);
    const toned = descendants(region).filter((node) => node.dataset?.tone !== undefined);
    assert.ok(toned.length >= 1, "a state with no cue at all tells a reader nothing");
    for (const cue of toned) {
      const words = textOf(cue).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      assert.ok(words.length > 3, `a cue with a tone and no words: "${textOf(cue)}"`);
      assert.match(words, /\p{L}/u, `a cue whose only text is a glyph: "${textOf(cue)}"`);
      assert.ok(["signal", "classification"].includes(cue.dataset.kind),
        `chip silhouette "${cue.dataset.kind}" is neither a signal nor a classification`);
      const shapes = elementChildren(cue).filter((child) =>
        child.className?.includes("import-chip-shape"));
      assert.equal(shapes.length, 1, "a cue with no shape leans on its tone");
      assert.equal(shapes[0].getAttribute("aria-hidden"), "true",
        "the decorative glyph is announced as if it were a word");
    }
    // The degraded figure step is a colour change too, so it carries words.
    const value = document.getElementById("analysis-readiness-finding-value");
    assert.match(textOf(value).trim(), /\p{L}/u);
  }
});

test("the readiness cue states the level in words beside its score", async () => {
  const document = await rendered(readyOutcome());
  const level = document.getElementById("analysis-readiness-level");
  assert.equal(level.dataset.kind, "signal", "a live readiness reading is a signal, not a class");
  assert.equal(level.dataset.tone, "warn");
  assert.match(textOf(level), /illustrative only/);
  assert.match(textOf(level), /50\/100/);
  // Provenance is a static classification, so it is the outline silhouette —
  // the Claude Design foundations rule, not a second chip vocabulary.
  const provenance = document.getElementById("analysis-readiness-provenance-cue");
  assert.equal(provenance.dataset.kind, "classification");
  assert.match(textOf(provenance), /Provenance/);
});

// ---------------------------------------------------------------------------
// C. THE DISCLOSURES WORK FROM THE KEYBOARD.
// ---------------------------------------------------------------------------

test("the disclosures are the region's only tab stops, named and toggleable", async () => {
  const document = await rendered(readyOutcome());
  const region = document.getElementById(REGION);
  const stops = tabSequence(document).filter((node) => node.closest(`#${REGION}`));
  assert.deepEqual(stops.map((node) => node.tagName), ["SUMMARY", "SUMMARY"],
    "the region grew a control the first screen has no tab stop for");
  assert.equal(region.querySelectorAll("button").length, 0);
  assert.equal(region.querySelectorAll("input").length, 0);
  assert.equal(region.querySelectorAll("a").length, 0);

  for (const summary of stops) {
    const details = summary.parentNode;
    assert.equal(details.tagName, "DETAILS", "a summary outside a disclosure controls nothing");
    // An accessible name that says WHAT expands, not "more".
    assert.match(textOf(summary), /figure|evidence|assumption/i);
    assert.ok(textOf(summary).replace(/[^\p{L}]+/gu, "").length > 12,
      `"${textOf(summary)}" does not name what it opens`);
    // Native control: no tabindex override, no role, no aria-expanded a script
    // would have to keep in step with the `open` attribute.
    assert.equal(summary.getAttribute("tabindex"), null);
    assert.equal(summary.getAttribute("role"), null);
    assert.equal(summary.getAttribute("aria-expanded"), null);
    // Collapsed by default, and the state is exposed as `open`. Asserted on the
    // attribute, because textOf reads through a shut disclosure regardless.
    assert.equal(details.hasAttribute("open"), false);
    summary.focus();
    assert.equal(document.activeElement.id, summary.id || document.activeElement.id);
    pressKey(document, "Enter");
    assert.equal(details.hasAttribute("open"), true, "Enter did not expand the disclosure");
    pressKey(document, " ");
    assert.equal(details.hasAttribute("open"), false, "Space did not collapse it again");
  }
});

test("the live status is never folded into a disclosure", async () => {
  const document = await rendered(readyOutcome());
  const live = document.getElementById("analysis-readiness-live");
  assert.equal(live.getAttribute("role"), "status");
  assert.equal(live.getAttribute("aria-live"), "polite");
  assert.equal(insideDetails(live), false,
    "a live region inside a shut details is announced by nothing");
  assert.match(textOf(live), /Recommended next action/);
  // The limitation is a claim about the figure, so it stays outside too.
  assert.equal(insideDetails(document.getElementById("analysis-readiness-limit")), false);
  const region = document.getElementById(REGION);
  const order = elementChildren(region).map((child) => child.id);
  assert.ok(order.indexOf("analysis-readiness-live") > order.indexOf("analysis-readiness-act"),
    "the status is announced before the action it describes has been drawn");
});

// ---------------------------------------------------------------------------
// D. EVERY STATE IS DRAWN.
// ---------------------------------------------------------------------------

test("the shipped document is the loading state, drawn in full", async () => {
  const document = await shippedPage();
  const region = document.getElementById(REGION);
  assert.equal(region.dataset.state, "loading");
  for (const id of DECISION_ORDER) {
    assert.equal(region.querySelectorAll(`#${id}`).length, 1, `${id} is not authored`);
  }
  assert.match(textOf(document.getElementById("analysis-readiness-finding-value")), /\p{L}/u);
  assert.equal(document.getElementById("analysis-readiness-finding-value").dataset.available,
    "false", "the loading state claims a figure it has not read");
  assert.match(textOf(document.getElementById("analysis-readiness-action")), /No action is quoted/);
  assert.equal(firstAnalysisDecision(null).state, DECISION_STATE.LOADING);
  assert.equal(firstAnalysisDecision({ ok: true }).state, DECISION_STATE.LOADING,
    "an envelope with no readiness model must not be painted as a result");
});

test("a scenario with no eligible finding draws the empty state", async () => {
  const model = analysisReadinessForDataset(dataset({ actions: false }));
  const view = firstAnalysisDecision(model);
  assert.equal(view.state, DECISION_STATE.EMPTY);
  const document = await rendered(model);
  const region = document.getElementById(REGION);
  assert.equal(region.dataset.state, "empty");
  assert.equal(document.getElementById("analysis-readiness-finding-value").dataset.available,
    "false");
  assert.match(textOf(document.getElementById("analysis-readiness-finding-value")),
    /No finding met the eligibility rule/);
  assert.match(textOf(document.getElementById("analysis-readiness-action")), /^None\./);
  assert.match(textOf(document.getElementById("analysis-readiness-action-cue")),
    /no action to score/);
  assert.match(textOf(document.getElementById("analysis-readiness-live")), /Zero findings/);
  assert.ok(document.getElementById("analysis-readiness-upgrades")
    .querySelectorAll("li").length >= 3, "the empty state names nothing that would fix it");
});

test("a refused analysis draws the error state and recommends nothing", async () => {
  const refusal = analyzeBundledScenario({ scenarioId: "not-a-scenario" });
  assert.equal(refusal.ok, false);
  const document = await rendered(refusal);
  const region = document.getElementById(REGION);
  assert.equal(region.dataset.state, "error");
  assert.equal(region.dataset.level, "insufficient");
  const level = document.getElementById("analysis-readiness-level");
  assert.equal(level.dataset.tone, "error");
  assert.match(textOf(level), /failed · unknown_bundled_scenario/);
  assert.match(textOf(document.getElementById("analysis-readiness-finding-value")),
    /did not complete/);
  assert.match(textOf(document.getElementById("analysis-readiness-action")),
    /A failed analysis recommends nothing/);
  assert.match(textOf(document.getElementById("analysis-readiness-live")), /did not complete/);
  // A partial read is the same treatment: a refusal that names a scenario says so.
  const partial = firstAnalysisDecision({ ok: false, error: { code: "partial", scenarioId: "x" } });
  assert.match(partial.scenario, /asked for x/);
});

test("an implausible figure is labelled, kept whole, and does not displace the action", async () => {
  assert.equal(implausibleFigure(PLAUSIBLE_MAX_USD + 1), true);
  assert.equal(implausibleFigure(-1), true);
  assert.equal(implausibleFigure(Number.NaN), true);
  assert.equal(implausibleFigure(3600), false);

  const long = "Developer Experience, Platform Reliability and Internal Tooling"
    + " (formerly Shared Services Engineering, EMEA and APAC)";
  for (const recoverable of [987654321, -4200]) {
    const model = analysisReadinessForDataset(dataset({ department: long, recoverable }));
    const view = firstAnalysisDecision(model);
    assert.equal(view.state, DECISION_STATE.READY);
    assert.equal(view.figureFlagged, true);
    const document = await rendered(model);
    // The name is never shortened: a truncated department is a finding about a
    // department nobody can identify. It wraps instead — `.stand-figure-value`
    // already ships overflow-wrap:anywhere, so no rule is added for it.
    const value = textOf(document.getElementById("analysis-readiness-finding-value"));
    assert.ok(value.includes(long), "the department name was truncated");
    assert.doesNotMatch(value, /…|\.\.\./);
    const flag = document.getElementById("analysis-readiness-figure-cue");
    assert.equal(flag.dataset.tone, "warn");
    assert.match(textOf(flag), recoverable < 0 ? /negative recoverable spend/
      : /outside the plausible demo range/);
    // The flag is a cue, so it sits in the cue row — never between the finding
    // and the action, and never in front of the finding.
    assert.equal(flag.parentNode.id, "analysis-readiness-cues");
    const order = elementChildren(document.getElementById(REGION)).map((child) => child.id);
    assert.ok(order.indexOf("analysis-readiness-finding") < order.indexOf("analysis-readiness-act"),
      "an extreme value reordered the region");
    assert.match(textOf(document.getElementById("analysis-readiness-action")),
      /Pilot standard-model routing/);
  }
});

// ---------------------------------------------------------------------------
// E. A SELF-CONTAINED DEMO SURFACE.
// ---------------------------------------------------------------------------

test("the region names its scenario and asks for nothing", async () => {
  const document = await rendered(readyOutcome());
  const scenario = textOf(document.getElementById("analysis-readiness-scenario"));
  assert.match(scenario, /Bundled scenario 1 of 3/);
  assert.match(scenario, new RegExp(BUNDLED_SCENARIO_IDS[0]));
  assert.match(scenario, /provider-export shape/);
  assert.match(scenario, /no customer data/);
  const region = document.getElementById(REGION);
  assert.doesNotMatch(textOf(region),
    /api[- ]?key|credential|password|sign in|connect your|upload your/i,
    "the region asks for something a self-contained demo must never ask for");
  assert.equal(region.querySelectorAll("form").length, 0);
  assert.equal(region.querySelectorAll("select").length, 0);
  assert.equal(region.querySelectorAll("textarea").length, 0);
});
