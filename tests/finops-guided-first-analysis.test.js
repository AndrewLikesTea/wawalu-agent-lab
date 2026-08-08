// The guided first analysis, model and page.
//
// THE REGRESSION THESE PIN. A previous attempt marked the chosen scenario on a
// node and changed nothing else: Google and Azure opened identical evidence and
// identical department detail. So an attribute assertion proves nothing here.
// Every test below reads RENDERED TEXT out of the two destinations, or the
// address a destination link points at, and the central pair asserts that two
// scenarios differ in exactly those places.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  DEFAULT_GUIDED_SCENARIO, GUIDED_DESTINATION, GUIDED_SCENARIOS,
  guidedAnalysis, guidedScenarioAddress, guidedScenarioFromAddress,
} from "../src/finops-guided-first-analysis.js";
import {
  GUIDED_IDS, GUIDED_VIEW_STATE, applyGuidedScenario, installGuidedFirstAnalysis,
  renderGuidedChooser, renderGuidedState, selectedGuidedScenario,
} from "../src/finops-guided-first-analysis-view.js";
import { parseHtml, pressEnter, tabSequence, textOf } from "./support/browser.js";

const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");

const GOOGLE = "google-vertex-detailed-v1";
const AZURE = "azure-openai-cost-v1";

const byId = (document, id) => document.getElementById(id);
const text = (document, id) => textOf(byId(document, id));

/** A Location and a History double, the shape the page hands the installer. */
function addressDouble(search = "", hash = "") {
  const location = { search, hash, pathname: "/evolution.html" };
  const written = [];
  const history = {
    replaceState: (state, title, url) => { written.push(url); location.search = url.split("#")[0]; },
    get written() { return [...written]; },
  };
  return { location, history };
}

const choose = (document, scenarioId) => {
  const select = byId(document, GUIDED_IDS.select);
  select.value = scenarioId;
  select.dispatchEvent({ type: "change", target: select, bubbles: true });
};

test("the chooser offers every bundled provider-export shape, by the shape it stands for", () => {
  assert.equal(GUIDED_SCENARIOS.length, 3);
  for (const scenario of GUIDED_SCENARIOS) {
    assert.match(scenario.label, /\S/);
    assert.ok(scenario.providerId && scenario.format);
  }
});

test("an address carries the choice, and an unregistered one opens the flow anyway", () => {
  assert.equal(guidedScenarioFromAddress(`?scenario=${AZURE}`), AZURE);
  assert.equal(guidedScenarioFromAddress(`?scenario=${GOOGLE}#workspace-evidence`), GOOGLE);
  assert.equal(guidedScenarioFromAddress("?scenario=not-registered"), DEFAULT_GUIDED_SCENARIO);
  assert.equal(guidedScenarioFromAddress("?other=1"), DEFAULT_GUIDED_SCENARIO);
  assert.equal(guidedScenarioFromAddress(""), DEFAULT_GUIDED_SCENARIO);
  assert.equal(guidedScenarioAddress(GOOGLE, GUIDED_DESTINATION.evidence),
    `?scenario=${GOOGLE}#workspace-evidence`);
});

test("two scenarios do not produce the same model", () => {
  const google = guidedAnalysis(GOOGLE);
  const azure = guidedAnalysis(AZURE);
  for (const key of ["answer", "benchmark", "provenance", "impact", "announcement"]) {
    assert.notEqual(google[key], azure[key], `${key} is identical for both scenarios`);
  }
  assert.notEqual(google.action.text, azure.action.text);
  assert.notEqual(google.action.team, azure.action.team);
  assert.notEqual(google.department.spend, azure.department.spend);
  assert.equal(guidedAnalysis("not-registered"), null);
});

test("the evidence destination renders the chosen scenario, and a second choice replaces it", () => {
  const document = parseHtml(html);
  applyGuidedScenario(document, GOOGLE);
  const googleEvidence = text(document, GUIDED_IDS.evidenceBody);
  const googleTitle = text(document, GUIDED_IDS.evidenceTitle);
  assert.match(googleEvidence, /Data Platform/);
  assert.match(googleEvidence, /\$4,500/);
  assert.match(googleEvidence, /vertex-ai/);
  assert.match(googleEvidence, /computed locally in this browser/);
  assert.match(googleEvidence, /vertex-sanitized-1/);
  assert.match(googleEvidence, /Evidence confidence \d+\/100/);
  assert.match(googleEvidence, /No real data is entered, uploaded or transmitted/);

  applyGuidedScenario(document, AZURE);
  const azureEvidence = text(document, GUIDED_IDS.evidenceBody);
  assert.notEqual(azureEvidence, googleEvidence,
    "the evidence view is the same text for two different provider exports");
  assert.notEqual(text(document, GUIDED_IDS.evidenceTitle), googleTitle);
  assert.match(azureEvidence, /Developer Experience/);
  assert.match(azureEvidence, /\$3,000/);
  assert.match(azureEvidence, /azure-openai/);
  assert.doesNotMatch(azureEvidence, /Data Platform/);
  assert.doesNotMatch(azureEvidence, /vertex/);
});

test("the department destination renders the chosen scenario's department and its one action", () => {
  const document = parseHtml(html);
  applyGuidedScenario(document, GOOGLE);
  const google = text(document, GUIDED_IDS.departmentBody);
  assert.match(google, /Data Platform/);
  assert.match(google, /\$22,500/);
  assert.match(google, /375,000 queries/);
  assert.match(google, /Route low-complexity batch requests/);
  assert.match(google, /Owner: Data Platform/);
  assert.match(text(document, GUIDED_IDS.departmentTitle), /Data Platform/);

  applyGuidedScenario(document, AZURE);
  const azure = text(document, GUIDED_IDS.departmentBody);
  assert.notEqual(azure, google, "the department detail is a shared generic list");
  assert.match(azure, /Developer Experience/);
  assert.match(azure, /\$15,000/);
  assert.match(azure, /Default one-step transformations/);
  assert.doesNotMatch(azure, /Data Platform/);
  assert.match(text(document, GUIDED_IDS.departmentTitle), /Developer Experience/);
});

test("the destination links point at the chosen scenario in the named destination", () => {
  const document = parseHtml(html);
  applyGuidedScenario(document, GOOGLE);
  const links = byId(document, GUIDED_IDS.chooser).querySelectorAll("a");
  assert.equal(links.length, 2, "the flow must offer both destinations");
  assert.deepEqual(links.map((link) => link.getAttribute("href")), [
    `?scenario=${GOOGLE}#workspace-evidence`, `?scenario=${GOOGLE}#workspace-departments`,
  ]);
  applyGuidedScenario(document, AZURE);
  assert.deepEqual(
    byId(document, GUIDED_IDS.chooser).querySelectorAll("a")
      .map((link) => link.getAttribute("href")),
    [`?scenario=${AZURE}#workspace-evidence`, `?scenario=${AZURE}#workspace-departments`],
    "a link kept pointing at the scenario the reader had already left");
});

test("a guided deep link opens that scenario in that destination, with the keyboard in it", () => {
  const document = parseHtml(html);
  const { location, history } = addressDouble(`?scenario=${AZURE}`, "#workspace-evidence");
  installGuidedFirstAnalysis(document, { location, history });
  assert.equal(selectedGuidedScenario(), AZURE);
  assert.match(text(document, GUIDED_IDS.evidenceBody), /Developer Experience/);
  assert.match(text(document, GUIDED_IDS.departmentBody), /Developer Experience/);
  assert.equal(document.activeElement?.getAttribute("id"), GUIDED_IDS.evidenceTitle,
    "the destination swapped in without the keyboard following it");
});

test("an ordinary open is silent, and choosing announces the change and the recommendation", () => {
  const document = parseHtml(html);
  const { location, history } = addressDouble();
  installGuidedFirstAnalysis(document, { location, history });
  assert.equal(text(document, GUIDED_IDS.live), "",
    "a live region that speaks on a cold open is one a reader learns to ignore");
  assert.equal(document.activeElement, null, "a cold open must not steal the keyboard");

  choose(document, GOOGLE);
  const announcement = text(document, GUIDED_IDS.live);
  assert.match(announcement, /Google Vertex AI/);
  assert.match(announcement, /Data Platform/);
  assert.match(announcement, /Recommended first/);
  assert.match(text(document, GUIDED_IDS.evidenceBody), /Data Platform/);
  assert.deepEqual(history.written, [`?scenario=${GOOGLE}`],
    "the choice must be in the address, so the deep link is real");

  // …and again, because a control replaced on repaint is a control that answers
  // exactly once.
  choose(document, AZURE);
  assert.equal(selectedGuidedScenario(), AZURE);
  assert.match(text(document, GUIDED_IDS.live), /Azure OpenAI/);
  assert.match(text(document, GUIDED_IDS.evidenceBody), /Developer Experience/);
});

test("the primary surface answers one question and states one prioritized action", () => {
  const document = parseHtml(html);
  applyGuidedScenario(document, AZURE);
  assert.match(text(document, "finops-guided-question"), /\?$/);
  const summary = text(document, GUIDED_IDS.summary);
  assert.match(summary, /Prioritized next action.*Developer Experience is the team that should take it first\./);
  assert.match(summary, /Evidence confidence/);
  assert.match(summary, /computed locally in this browser/);
  assert.match(summary, /% of that department's modelled spend/);
  assert.equal(byId(document, GUIDED_IDS.summary).querySelectorAll(".guided-action").length, 1,
    "a second action region is a second ranking");
});

test("the semantic and visual reading order is finding, trust, action, then support", () => {
  const document = parseHtml(html);
  applyGuidedScenario(document, GOOGLE);
  const summary = byId(document, GUIDED_IDS.summary);
  const positions = [".guided-finding", ".guided-trust", ".guided-action", ".guided-support"]
    .map((selector) => summary.children.indexOf(summary.querySelector(selector)));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.ok(positions.every((position) => position >= 0));
  const support = summary.querySelector(".guided-support");
  assert.equal(support.tagName, "DETAILS");
  assert.equal(support.querySelector("summary")?.tagName, "SUMMARY");
});

test("the native support disclosure is keyboard reachable and exposes open and closed states", () => {
  const document = parseHtml(html);
  applyGuidedScenario(document, GOOGLE);
  const details = byId(document, GUIDED_IDS.summary).querySelector("details");
  const summary = details.querySelector("summary");
  assert.ok(tabSequence(document).includes(summary));
  assert.equal(details.hasAttribute("open"), false);
  summary.focus();
  pressEnter(document);
  assert.equal(details.hasAttribute("open"), true);
  pressEnter(document);
  assert.equal(details.hasAttribute("open"), false);
});

test("loading, empty, error, and implausible extremes replace numbers with a named remedy", () => {
  const cases = [
    [GUIDED_VIEW_STATE.loading, /Waiting for the page result.*finding and action/],
    [GUIDED_VIEW_STATE.empty, /No bundled scenarios.*Choose a scenario/],
    [GUIDED_VIEW_STATE.error, /could not be analyzed.*Try the analysis again/],
  ];
  for (const [state, expected] of cases) {
    const document = parseHtml(html);
    renderGuidedState(document, state);
    const host = byId(document, GUIDED_IDS.chooser);
    assert.equal(host.dataset.state, state);
    assert.match(textOf(host), expected);
    assert.equal(host.getAttribute("aria-busy"), state === GUIDED_VIEW_STATE.loading ? "true" : "false");
    assert.match(text(document, GUIDED_IDS.evidenceTitle), state === GUIDED_VIEW_STATE.loading
      ? /loading/ : /unavailable/);
    assert.match(text(document, GUIDED_IDS.departmentBody), expected);
  }

  const retryDocument = parseHtml(html);
  let retries = 0;
  renderGuidedState(retryDocument, GUIDED_VIEW_STATE.error, { onRetry: () => { retries += 1; } });
  const retry = byId(retryDocument, GUIDED_IDS.chooser).querySelector("button");
  assert.ok(tabSequence(retryDocument).includes(retry));
  retry.click();
  assert.equal(retries, 1);

  const document = parseHtml(html);
  const ordinary = guidedAnalysis(GOOGLE);
  renderGuidedChooser(document, {
    ...ordinary, department: { ...ordinary.department, recoverable: "$1,000,000,000,001" },
  });
  const host = byId(document, GUIDED_IDS.chooser);
  assert.equal(host.dataset.state, GUIDED_VIEW_STATE.extreme);
  assert.match(textOf(host), /outside the supported display range.*Choose another scenario/);
  assert.doesNotMatch(textOf(host), /1,000,000,000,001/);
});

// Whitespace is dropped, not collapsed: authored markup carries the newlines
// between its elements and a built node carries none, and that difference is
// the one difference between these two that nobody has to be told about.
const flat = (node) => textOf(node).replace(/\s+/g, "");

test("the pending state served in the document is the module's own, not a second copy of it", () => {
  // #944's rule for this page's first screen: what a reader gets before the
  // entry runs is composed by the module that paints the region, so it cannot
  // drift from it. This block is authored by hand — it is the ONE state no
  // module can have painted yet — so the drift has to be caught here instead.
  const authored = byId(parseHtml(html), GUIDED_IDS.chooser);
  const painted = parseHtml(html);
  renderGuidedState(painted, GUIDED_VIEW_STATE.loading);
  assert.equal(authored.dataset.state, GUIDED_VIEW_STATE.loading);
  assert.equal(authored.getAttribute("aria-busy"), "true");
  assert.equal(flat(authored), flat(byId(painted, GUIDED_IDS.chooser)),
    "the served pending copy must be the wording renderGuidedState paints");
});

test("a withheld extreme keeps the control its own remedy tells the reader to use", () => {
  const document = parseHtml(html);
  const { location, history } = addressDouble();
  installGuidedFirstAnalysis(document, { location, history });
  const ordinary = guidedAnalysis(GOOGLE);
  renderGuidedChooser(document, {
    ...ordinary, department: { ...ordinary.department, recoverable: "$1,000,000,000,001" },
  });
  const select = byId(document, GUIDED_IDS.select);
  assert.ok(select && tabSequence(document).includes(select),
    "the state that says 'choose another scenario' must not delete the chooser");
  // And the control still works: the listener install attached went with the
  // node, so proving the node survived is only half of proving the way out did.
  choose(document, AZURE);
  assert.equal(byId(document, GUIDED_IDS.chooser).dataset.state, GUIDED_VIEW_STATE.ready);
  assert.match(text(document, GUIDED_IDS.summary), /Prioritized next action/);
});

test("the control is labelled, and the assumptions are behind the disclosure, not the status", () => {
  const document = parseHtml(html);
  applyGuidedScenario(document, GOOGLE);
  const label = byId(document, GUIDED_IDS.chooser).querySelector("label");
  assert.equal(label.getAttribute("for"), GUIDED_IDS.select);
  assert.match(textOf(label), /\S/);
  assert.equal(byId(document, GUIDED_IDS.select).querySelectorAll("option").length, 3);

  const live = byId(document, GUIDED_IDS.live);
  assert.equal(live.getAttribute("aria-live"), "polite");
  assert.equal(live.getAttribute("role"), "status");
  // A live region folded into a collapsed disclosure is never announced. The
  // harness reads through a closed one, so this walks the ancestry instead.
  for (let node = live.parentNode; node; node = node.parentNode) {
    assert.notEqual(node.tagName, "DETAILS", "the status region is inside a disclosure");
  }
  const details = byId(document, GUIDED_IDS.summary).querySelectorAll("details");
  assert.equal(details.length, 1, "secondary calculations belong behind one disclosure");
  assert.match(textOf(details[0]), /Assumption 1/);
  assert.match(textOf(details[0]), /Ranked first/);
});
