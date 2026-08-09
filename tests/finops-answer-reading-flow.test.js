// The canonical FinOps answer as a READING FLOW (#1465).
//
// #1464 landed the contract: one annual figure, its benchmark, the action it
// implies, and the signals each came from. This file holds the surface that
// reads it — one dominant answer first, everything that qualifies it demoted
// behind a control, and all five states drawn rather than assumed.
//
// HARNESS NOTES, because the test DOM is a double and not a browser:
//   * `querySelectorAll("*")` throws at parse time and descendant selectors
//     throw, so structure is walked through `node.children` and `parentNode`.
//   * text nodes live in `children` and carry no `dataset`, hence `?.`.
//   * properties are not reflected to attributes, so `node.hidden` is asserted
//     rather than `getAttribute("hidden")`.
//   * `textOf` reads straight through a shut details element, which is exactly
//     why the live region is asserted to be OUTSIDE one: the harness cannot
//     tell the difference and a browser can.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadPage, parseHtml, pressEnter, pressSpace, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import { analysisReadiness } from "../src/finops-bundled-scenarios.js";
import { resolveFinopsAnswer, finopsAnswerSignals } from "../src/finops-answer-contract.js";
import {
  ANSWER_STATE, answerPlausibility, finopsAnswerState, renderFinopsAnswer,
} from "../src/finops-answer-contract-view.js";
import { analysisReadinessForDataset } from "../src/finops-analysis-readiness.js";
import { renderAnalysisReadiness } from "../src/finops-analysis-readiness-view.js";
import { applyGuidedScenario } from "../src/finops-guided-first-analysis-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const HTML = await readFile(PAGE, "utf8");
const DATA = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(await readFile(
  new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

const REGION = "finops-analysis-readiness";
const ANSWER = "finops-canonical-answer";
// The chooser that moves the analysis. It is part of the live analysis for the
// purposes of this file: what it renders competes with the briefing or supports
// it, and there is no third option.
const CHOOSER = "finops-guided-choice";
const GOOGLE = "google-vertex-detailed-v1";

const doc = () => parseHtml(HTML);
const byId = (document, id) => document.getElementById(id);
const slot = (document, suffix) => textOf(byId(document, `${ANSWER}-${suffix}`));

/** The bundled analysis, answered. The one path that has real numbers in it. */
const answered = () => resolveFinopsAnswer(finopsAnswerSignals(
  analysisReadiness({ scenarioId: "aws-bedrock-cur-v1" })));

/** A hand-built answered record, so an extreme can be posed without inventing a
 *  scenario file. Fields are the contract's, spelled out rather than spread from
 *  a fixture, so a rename in the contract fails here loudly. */
const record = (over = {}) => Object.freeze({
  contract: "finops-answer-contract/1.0.0",
  status: "answered",
  annualSavingsUsd: 43200,
  savingsPercent: 20,
  annualBaselineSpendUsd: 216000,
  benchmark: { sourceId: "finding.benchmark", label: "Peer median", value: 1000, unit: "USD" },
  primaryAction: {
    id: "act-1", label: "Pilot standard-model routing", monthlySavingsUsd: 3600,
    department: "Atlas Platform",
  },
  confidence: { level: "medium", value: 63 },
  readiness: { state: "illustrative", level: "illustrative_only" },
  sources: {
    annualSavingsUsd: ["a"], savingsPercent: ["a", "b"], benchmark: ["finding.benchmark"],
    primaryAction: ["a"], confidence: ["c"], readiness: ["r"],
  },
  withheldReason: null,
  ...over,
});

/** Element children only. The harness keeps text nodes in `children` too. */
const elements = (node) => [...(node?.children ?? [])].filter((child) => child?.tagName);

/** Depth-first element walk. `querySelectorAll("*")` throws in this harness. */
function walk(node, out = []) {
  for (const child of elements(node)) {
    out.push(child);
    walk(child, out);
  }
  return out;
}

/** True when `node` sits inside a details element anywhere above it. */
function insideDisclosure(node) {
  for (let up = node?.parentNode; up; up = up.parentNode) {
    if (up.tagName === "DETAILS") return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 1. One dominant answer, read from the contract and not recomputed
// ---------------------------------------------------------------------------

test("the answer region states one figure, its benchmark, one action and its provenance", () => {
  const document = doc();
  const answer = answered();
  renderFinopsAnswer(document, answer);

  // Every visible number is the contract's own field, formatted — never a value
  // this view arrived at on its own.
  assert.equal(byId(document, ANSWER).dataset.state, ANSWER_STATE.answered);
  assert.ok(slot(document, "figure").includes(`${answer.annualSavingsUsd.toLocaleString("en-US")}`),
    "the figure slot does not carry the contract's annualSavingsUsd");
  assert.ok(slot(document, "figure").includes(`${answer.savingsPercent}%`));
  assert.ok(slot(document, "figure")
    .includes(`${answer.annualBaselineSpendUsd.toLocaleString("en-US")}`));
  assert.ok(slot(document, "benchmark").includes(answer.benchmark.label),
    "the benchmark is the contract's, not a second comparison invented here");
  assert.ok(slot(document, "action").includes(answer.primaryAction.label));
  assert.ok(slot(document, "sources").includes(answer.sources.primaryAction[0]),
    "provenance names the signal the action came from");

  // EXACTLY ONE dominant figure. A second element in the page's largest role
  // inside this region is a second answer, whatever it is labelled.
  const dominant = walk(byId(document, REGION))
    .filter((node) => String(node.className ?? "").split(/\s+/).includes("stand-figure-value"));
  assert.equal(dominant.length, 1, "a second largest-role figure is a second answer");
  assert.equal(dominant[0].id, `${ANSWER}-figure`);
});

test("the answer is read before anything that qualifies it, and behind no control", () => {
  const document = doc();
  const order = walk(byId(document, REGION)).map((node) => node.id).filter(Boolean);
  const before = (first, second) => assert.ok(order.indexOf(first) < order.indexOf(second),
    `${second} is read before ${first}`);
  before(`${ANSWER}-figure`, `${ANSWER}-benchmark`);
  before(`${ANSWER}-benchmark`, `${ANSWER}-action`);
  before(`${ANSWER}-action`, "analysis-readiness-detail");
  before("analysis-readiness-detail", "analysis-readiness-how-we-know");

  // Nothing a reader needs to reach the answer may be a control they must open.
  for (const id of ["figure", "benchmark", "action", "sources"]) {
    assert.equal(insideDisclosure(byId(document, `${ANSWER}-${id}`)), false,
      `${id} sits inside a disclosure`);
  }
});

test("focus order follows the reading order: action, then the disclosures under it", () => {
  const document = doc();
  renderFinopsAnswer(document, answered());
  const stops = tabSequence(document).map((node) => node.id).filter(Boolean);
  const rank = (id) => stops.indexOf(id);
  assert.ok(rank(`${ANSWER}-action`) >= 0, "the action must be reachable by Tab");
  assert.ok(rank(`${ANSWER}-action`) < rank("analysis-readiness-detail-summary"));
  assert.ok(rank("analysis-readiness-detail-summary") >= 0);
});

// ---------------------------------------------------------------------------
// 1b. ONE answer for the whole live analysis (#1466)
//
// #1465 made this region read as one answer. It did not stop the surface BELOW
// it publishing a second one: the guided chooser painted its own headline
// finding, its own benchmark, its own confidence and its own "Prioritized next
// action", while the briefing above stayed frozen on a hard-coded scenario id.
// Two savings figures, and the one presented as canonical was the stale one.
// ---------------------------------------------------------------------------

const hasClass = (node, name) => String(node.className ?? "").split(/\s+/).includes(name);

/** Every element of the live analysis: the briefing, and the chooser under it. */
const liveNodes = (document) => [REGION, CHOOSER].flatMap((id) => walk(byId(document, id)));

/** A live analysis with both halves painted, as a reader meets it. */
function livePage(scenarioId = "aws-bedrock-cur-v1") {
  const document = doc();
  const analysis = analysisReadiness({ scenarioId });
  renderFinopsAnswer(document, resolveFinopsAnswer(finopsAnswerSignals(analysis)),
    { scenarioLabel: analysis.label });
  applyGuidedScenario(document, scenarioId);
  return document;
}

test("one element in the live analysis carries a savings figure at headline prominence", () => {
  const document = livePage();
  // The page's own largest type role, plus the two roles the chooser used to
  // compete in. A reintroduction of either fails here rather than in review.
  const headline = liveNodes(document).filter((node) => ["stand-figure-value",
    "guided-finding", "guided-action-text"].some((role) => hasClass(node, role)));
  assert.equal(headline.length, 1, "a second headline figure is a second answer");
  assert.equal(headline[0].id, `${ANSWER}-figure`);

  // And role-independently: every currency amount the chooser renders is
  // supporting evidence behind its disclosure, not a competing claim. Only
  // nodes that hold no disclosure of their own count — an ancestor reads its
  // descendants' text, and this harness reads straight through a shut one.
  const loose = walk(byId(document, CHOOSER))
    .filter((node) => node.tagName !== "DETAILS"
      && !walk(node).some((child) => child.tagName === "DETAILS"))
    .filter((node) => /\$[\d,]/.test(textOf(node)) && !insideDisclosure(node));
  assert.equal(loose.length, 0,
    `the chooser states ${loose.length} money figures outside its disclosure`);
});

test("exactly one control asks the reader to take the answer's next action", () => {
  const document = livePage();
  const label = resolveFinopsAnswer(finopsAnswerSignals(
    analysisReadiness({ scenarioId: "aws-bedrock-cur-v1" }))).primaryAction.label;
  const restating = liveNodes(document)
    .filter((node) => node.tagName === "A" || node.tagName === "BUTTON")
    .filter((node) => textOf(node).includes(label));
  assert.equal(restating.length, 1, "a second control restates the one next action");
  assert.equal(restating[0].id, `${ANSWER}-action`);
  assert.equal(restating[0].hidden, false, "the one action must be operable");
  // The chooser keeps its navigation, and none of it is an instruction: those
  // links go to evidence and to a department, which is not the action.
  const chooserLinks = walk(byId(document, CHOOSER)).filter((node) => node.tagName === "A");
  assert.equal(chooserLinks.length, 2, "the two destinations are the flow, not a call to action");
  for (const link of chooserLinks) assert.doesNotMatch(textOf(link), /^Pilot |^Route |^Default /);
});

test("the synthetic-data qualifier is read with the figure and behind no control", () => {
  const document = doc();
  const marker = byId(document, `${ANSWER}-synthetic`);
  assert.equal(insideDisclosure(marker), false,
    "a qualifier folded into a disclosure passes this harness and is unread in a browser");
  assert.match(textOf(marker), /Bundled synthetic example/);
  assert.match(textOf(marker), /not your spend/);

  // It is authored rather than painted, so it survives all five states — the
  // four a record decides, and the loading state the document ships in.
  for (const [answer, options] of [
    [null, { state: ANSWER_STATE.loading }], [answered(), {}],
    [resolveFinopsAnswer(null), {}], [null, {}],
  ]) {
    const page = doc();
    renderFinopsAnswer(page, answer, options);
    assert.match(textOf(byId(page, `${ANSWER}-synthetic`)), /Bundled synthetic example/,
      `the qualifier was lost in the ${byId(page, ANSWER).dataset.state} state`);
  }

  // …and it is read between the figure and the benchmark, so a reader cannot
  // reach the headline claim without it.
  const order = walk(byId(document, REGION)).map((node) => node.id).filter(Boolean);
  const at = (id) => order.indexOf(id);
  assert.ok(at(`${ANSWER}-figure`) < at(`${ANSWER}-synthetic`));
  assert.ok(at(`${ANSWER}-synthetic`) < at(`${ANSWER}-benchmark`));
});

test("the briefing names the analysis it is of, and two scenarios do not share one", () => {
  const bedrock = livePage();
  const google = livePage(GOOGLE);
  assert.match(slot(bedrock, "scenario"), /AWS Bedrock/);
  assert.match(slot(google, "scenario"), /Google Vertex AI/);
  // $3,600 and $4,500 a month, annualised. Different scenario, different answer.
  assert.ok(slot(bedrock, "figure").includes("$43,200"), slot(bedrock, "figure"));
  assert.ok(slot(google, "figure").includes("$54,000"), slot(google, "figure"));
});

// Booted for real, because the claim is about the PAGE's wiring: a hook the
// chooser calls and the entry ignores would pass every assertion above.
test("choosing another bundled export restates the briefing on the live page", async () => {
  const page = await loadPage(PAGE, {
    routes: { "/evolution-demo-data.json": DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES },
  });
  try {
    const document = page.document;
    await importPageModule("/evolution-page.js");
    await waitFor(() => byId(document, ANSWER).dataset.state === ANSWER_STATE.answered,
      "the briefing never resolved on a real boot");
    // Every start the page makes, not only the first: restoring the globals out
    // from under a request still in flight surfaces in whichever test runs next.
    await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready"
      || byId(document, "finops-load-state")?.dataset.state === "error",
    "the page never settled into a resolved load state");
    await waitFor(() => byId(document, "integration-contract-provenance")
      ?.textContent.trim().startsWith("Gateway completed"), "the static contract gateway to settle");
    await waitFor(() => byId(document, "finops-evaluation-result")
      ?.getAttribute("aria-busy") === "false", "the evaluation panel to settle");
    assert.match(slot(document, "scenario"), /AWS Bedrock/);
    const before = slot(document, "figure");
    assert.ok(before.includes("$43,200"), before);

    const select = byId(document, "finops-guided-select");
    select.value = GOOGLE;
    select.dispatchEvent({ type: "change", target: select, bubbles: true });

    assert.match(slot(document, "scenario"), /Google Vertex AI/,
      "the briefing kept naming the export the reader had already left");
    assert.ok(slot(document, "figure").includes("$54,000"), slot(document, "figure"));
    assert.notEqual(slot(document, "figure"), before);
    // The qualifiers on that figure move with it, rather than being left over
    // from the analysis before.
    assert.match(slot(document, "sources"), /readiness/);
    assert.match(textOf(byId(document, `${ANSWER}-live`)), /Answer resolved/);
  } finally {
    page.restore();
  }
});

// ---------------------------------------------------------------------------
// 2. Heading nesting
// ---------------------------------------------------------------------------

test("the region's headings nest without a skipped level", () => {
  const document = doc();
  const levels = walk(byId(document, REGION))
    .filter((node) => /^H[1-6]$/.test(node.tagName ?? ""))
    .map((node) => Number(node.tagName.slice(1)));
  assert.deepEqual(levels, [2, 3], "the answer sits one level under the region's own question");
  assert.equal(byId(document, "analysis-readiness-question").tagName, "H2");
  assert.equal(byId(document, `${ANSWER}-heading`).tagName, "H3");
});

// ---------------------------------------------------------------------------
// 3. The demoted regions: still here, named, and informative shut
// ---------------------------------------------------------------------------

test("the demoted readiness detail keeps every number and names what it holds", () => {
  const document = doc();
  const model = analysisReadinessForDataset(DATA);
  renderAnalysisReadiness(document, model);

  // Nothing was dropped: each line still exists, still painted by the same
  // module, and now lives under the disclosure.
  for (const id of ["verdict", "benchmark", "evidence", "limit", "action"]) {
    const node = byId(document, `analysis-readiness-${id}`);
    assert.equal(insideDisclosure(node), true, `${id} was not demoted`);
    assert.ok(textOf(node).length > 0, `${id} lost its content in the move`);
  }
  assert.ok(textOf(byId(document, "analysis-readiness-benchmark"))
    .includes(`${model.score.value}/100`), "the readiness score is still reachable");

  // The summary is the accessible name, and it says what is inside AND its
  // value, so shut it is still worth reading.
  const summary = byId(document, "analysis-readiness-detail-summary");
  const name = textOf(summary);
  assert.match(name, /Readiness verdict, evidence, and limits/);
  assert.ok(name.includes(`${model.score.value}/100`),
    `the summary is uninformative when collapsed: ${name}`);
});

test("every disclosure in the region is a real control with correct state exposure", () => {
  const document = doc();
  const summaries = walk(byId(document, REGION)).filter((node) => node.tagName === "SUMMARY");
  assert.equal(summaries.length, 3, "one demoted detail plus the two the region already had");
  const sequence = tabSequence(document);
  for (const summary of summaries) {
    assert.equal(summary.parentNode.tagName, "DETAILS", "a stray summary is not a control");
    assert.ok(textOf(summary).length > 12, "a disclosure must name what it holds");
    assert.ok(sequence.includes(summary), `${textOf(summary)} is not reachable by Tab`);
    assert.equal(summary.parentNode.hasAttribute("open"), false, "it must arrive shut");
  }

  // The one this change added declares its state and keeps it truthful under
  // both keys a native summary answers to.
  const added = byId(document, "analysis-readiness-detail-summary");
  const details = added.parentNode;
  assert.equal(added.getAttribute("aria-expanded"), "false");
  added.focus();
  pressEnter(document);
  assert.equal(details.hasAttribute("open"), true, "Enter expands");
  pressSpace(document);
  assert.equal(details.hasAttribute("open"), false, "Space collapses");
});

// ---------------------------------------------------------------------------
// 4. Every state is drawn
// ---------------------------------------------------------------------------

/** The state block's three non-colour channels, as a browser-independent tuple. */
const channels = (document) => ({
  word: slot(document, "word"),
  shape: slot(document, "shape"),
  silhouette: byId(document, `${ANSWER}-chip`).dataset.silhouette,
  tone: byId(document, `${ANSWER}-state`).dataset.tone,
});

test("the document ships in the loading state, with a placeholder in every slot", () => {
  const document = doc();
  // Authored, not painted: this is what a reader sees before any module runs.
  assert.equal(byId(document, ANSWER).dataset.state, ANSWER_STATE.loading);
  // A determinate placeholder in each slot the answer will occupy, so the block
  // holds its height and nothing below it jumps on first paint.
  for (const id of ["figure", "benchmark", "action-basis", "reason", "sources"]) {
    assert.ok(slot(document, id).length > 0, `${id} is blank while loading, so the block jumps`);
  }
  assert.equal(channels(document).word, "Reading");
  // The module agrees with the markup when asked for the same state.
  renderFinopsAnswer(document, null, { state: ANSWER_STATE.loading });
  assert.equal(byId(document, ANSWER).dataset.state, ANSWER_STATE.loading);
  assert.match(slot(document, "figure"), /Resolving the annual figure/);
  assert.equal(byId(document, `${ANSWER}-action`).hidden, true,
    "a link with no action behind it must not take a tab stop");
});

test("no data reads as empty, names what is missing, and says what brings it", () => {
  const document = doc();
  const empty = resolveFinopsAnswer(null);
  assert.equal(finopsAnswerState(empty), ANSWER_STATE.empty);
  renderFinopsAnswer(document, empty);
  assert.equal(byId(document, ANSWER).dataset.state, ANSWER_STATE.empty);
  assert.equal(channels(document).word, "No records");
  assert.match(slot(document, "reason"), /input this answer is defined from is missing/);
  assert.match(slot(document, "reason"), /import a provider export/,
    "an empty state that does not say what to do is a dead end");
  assert.equal(slot(document, "figure"), "", "no figure survives an empty answer");
});

test("a rule that refuses the figure reads as withheld, not as damage", () => {
  const document = doc();
  const withheld = resolveFinopsAnswer({
    recommendedActions: [],
    baseline: { sourceId: "b", monthlySpendUsd: 10000 },
    benchmark: { sourceId: "f", label: "Peer median", value: 1000, unit: "USD" },
    confidence: { sourceId: "c", value: 63 },
    readiness: { sourceId: "r", level: "illustrative_only" },
  });
  renderFinopsAnswer(document, withheld);
  const marks = channels(document);
  assert.equal(byId(document, ANSWER).dataset.state, ANSWER_STATE.withheld);
  assert.equal(marks.word, "Awaiting input");
  assert.equal(marks.tone, "neutral", "a refused figure must not be painted as an error");
  assert.equal(marks.silhouette, "outline", "a classification is outlined, per the design mirror");
  assert.match(slot(document, "reason"), /no prioritized action to imply/);
});

test("an analysis that failed to load reads as an error and offers the page's own retry", () => {
  const document = doc();
  renderFinopsAnswer(document, answered());
  renderFinopsAnswer(document, null);
  const marks = channels(document);
  assert.equal(byId(document, ANSWER).dataset.state, ANSWER_STATE.error);
  assert.equal(marks.word, "Could not compute");
  assert.equal(marks.tone, "error");
  assert.match(slot(document, "reason"), /did not load/);
  assert.match(slot(document, "reason"), /Retry bundled analysis/,
    "the error must name the recovery this page already ships");
  // And that control is really on the page, rather than a promise in prose.
  assert.equal(byId(document, "finops-data-retry").tagName, "BUTTON");
  assert.equal(slot(document, "figure"), "", "the previous figure is cleared, not left stale");
});

test("the five states are distinguishable with no colour at all", () => {
  const seen = new Map();
  for (const [state, answer] of [
    [ANSWER_STATE.loading, null],
    [ANSWER_STATE.answered, answered()],
    [ANSWER_STATE.empty, resolveFinopsAnswer(null)],
    [ANSWER_STATE.error, null],
  ]) {
    const document = doc();
    renderFinopsAnswer(document, answer,
      state === ANSWER_STATE.loading ? { state } : {});
    const marks = channels(document);
    assert.ok(marks.word.length > 0, `${state} carries no word`);
    assert.ok(marks.shape.length > 0, `${state} carries no shape`);
    assert.ok(["filled", "outline"].includes(marks.silhouette));
    assert.equal(seen.has(marks.word), false, `${state} reuses the word "${marks.word}"`);
    seen.set(marks.word, state);
    // The tone is never the only thing that changed.
    assert.ok(slot(document, "state-summary").length > 0);
  }
});

// ---------------------------------------------------------------------------
// 5. The three implausible extremes
// ---------------------------------------------------------------------------

test("a very large figure renders as one legible sentence and wraps rather than overflows", () => {
  const document = doc();
  const huge = record({
    annualSavingsUsd: 9_876_543_210, annualBaselineSpendUsd: 50_000_000_000, savingsPercent: 19.8,
  });
  renderFinopsAnswer(document, huge);
  const figure = slot(document, "figure");
  assert.ok(figure.includes("$9,876,543,210 a year"), figure);
  assert.ok(figure.includes("19.8% of the $50,000,000,000"), figure);
  assert.ok(figure.endsWith("analyzed baseline."), "the sentence is truncated or broken");
  assert.equal(answerPlausibility(huge).implausible, false,
    "large is not the same as impossible; only a saving above its own baseline is");
});

// Wrapping is a stylesheet promise, so it is pinned where the promise is made
// rather than inferred from a harness that models no layout at all.
test("the largest-role figure is allowed to wrap, so a ten-digit number cannot overflow", async () => {
  const css = await readFile(new URL("../src/evolution.css", import.meta.url), "utf8");
  assert.match(css, /\.stand-figure-value \{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /\.stand-answer \{[^}]*overflow-wrap:anywhere/);
});

test("a zero or negative saving is stated, not poured into a broken sentence", () => {
  for (const [value, expected] of [[0, false], [-14400, true]]) {
    const document = doc();
    const degenerate = record({ annualSavingsUsd: value, savingsPercent: 0 });
    renderFinopsAnswer(document, degenerate);
    const figure = slot(document, "figure");
    assert.match(figure, /^No annual saving is modelled/,
      `a ${value} saving still reads as "X a year — Y% of": ${figure}`);
    assert.ok(figure.includes(value < 0 ? "-$14,400" : "$0"), figure);
    assert.equal(answerPlausibility(degenerate).implausible, expected);
    // Either way the reader is told, in words, what the number means.
    assert.ok(slot(document, "caveat").length > 0, "a degenerate figure is left unexplained");
    assert.equal(byId(document, `${ANSWER}-caveat`).hidden, false);
  }
});

test("a saving larger than its own baseline is flagged, in words as well as in tone", () => {
  const document = doc();
  const impossible = record({ annualSavingsUsd: 400000, savingsPercent: 185 });
  renderFinopsAnswer(document, impossible);
  assert.equal(byId(document, ANSWER).dataset.implausible, "true");
  assert.match(slot(document, "caveat"), /Check this/,
    "the mark must be words, not only a dotted rule");
  assert.match(slot(document, "caveat"), /larger than the analyzed baseline/);
  // And it clears once the figure is plausible again — a stale warning on a good
  // number is the same defect pointing the other way.
  renderFinopsAnswer(document, record());
  assert.equal(byId(document, ANSWER).dataset.implausible, undefined);
  assert.equal(byId(document, `${ANSWER}-caveat`).hidden, true);
});

test("a figure with no benchmark behind it is never published as an answer", () => {
  const document = doc();
  const unsupported = resolveFinopsAnswer({
    recommendedActions: [{ id: "a", sourceId: "a", label: "A", monthlySavingsUsd: 900 }],
    baseline: { sourceId: "b", monthlySpendUsd: 10000 },
    benchmark: null,
    confidence: { sourceId: "c", value: 63 },
    readiness: { sourceId: "r", level: "illustrative_only" },
  });
  assert.equal(unsupported.withheldReason.code, "unsupported-benchmark");
  renderFinopsAnswer(document, unsupported);
  assert.equal(slot(document, "figure"), "", "an unsupported figure is not shown at all");
  assert.match(slot(document, "benchmark"), /nothing for a benchmark to support/,
    "the benchmark slot must explain its own absence rather than sit blank");
  assert.match(slot(document, "reason"), /No benchmark accompanies this figure/);
});

// ---------------------------------------------------------------------------
// 6. The announcement, and no status carried by colour alone
// ---------------------------------------------------------------------------

test("the answer's live region is outside every disclosure in the region", () => {
  const document = doc();
  const live = byId(document, `${ANSWER}-live`);
  assert.equal(live.getAttribute("role"), "status");
  assert.equal(live.getAttribute("aria-live"), "polite");
  // The harness reads text straight through a shut details element, so this
  // assertion is about the ancestry rather than about what textOf can see.
  assert.equal(insideDisclosure(live), false,
    "a live region folded into a disclosure passes here and is silent in a browser");
  renderFinopsAnswer(document, answered());
  assert.match(textOf(live), /Answer resolved/);
  renderFinopsAnswer(document, null);
  assert.match(textOf(live), /Could not compute/, "the failure is announced, not only drawn");
});

test("no state in the region is told by a class or a colour on its own", () => {
  for (const [answer, options] of [
    [null, { state: ANSWER_STATE.loading }],
    [answered(), {}],
    [resolveFinopsAnswer(null), {}],
    [null, {}],
  ]) {
    const document = doc();
    renderFinopsAnswer(document, answer, options);
    const region = byId(document, ANSWER);
    const state = region.dataset.state;
    // Every state attribute this region sets has a word beside it in the DOM.
    const text = textOf(region);
    assert.ok(channels(document).word.length > 0, `${state} has no status word`);
    assert.ok(text.includes(channels(document).word),
      `${state}'s word is not in the region's own text`);
    assert.ok(channels(document).shape.length > 0, `${state} has no status shape`);
    // And the shape is decorative, so a screen reader hears the word once.
    assert.equal(byId(document, `${ANSWER}-shape`).getAttribute("aria-hidden"), "true");
  }
});
