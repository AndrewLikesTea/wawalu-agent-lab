// The answer spine contract: one question, one number, one action, one file,
// and a role for every region beneath them.
//
// The assertions a future change has to survive:
//
//   * exactly one region holds role `answer`;
//   * every top-level FinOps region of the shipped page is classified, so a
//     region added tomorrow fails here rather than escaping classification;
//   * the document's reading order is the spine's order, not a coincidence;
//   * the pre-import page renders the declared no-data claim, never a number;
//   * no region can promote itself to "the summary" by editing an attribute.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml } from "./support/browser.js";
import {
  ANSWER_SPINE_CONTRACT_VERSION, EVIDENCE_LAYERS, FINOPS_ANSWER_SPINE, HEADLINE_METRIC,
  LAYER_ROLE, PRE_IMPORT_STATE, answerLayer, answerRegionId, completeSummaries, layerFor,
  orderedRegionIds, validateAnswerSpineContract,
} from "../src/finops-answer-spine.js";
import { applyAnswerSpineContract, LAYER_ORDER_ATTRIBUTE, LAYER_ROLE_ATTRIBUTE, SPINE_VIEW_IDS }
  from "../src/finops-answer-spine-view.js";
import { ANSWER_SPINE, renderedRegionIds } from "../src/finops/answer-spine-view.js";
import { STAND_PENDING, STAND_QUESTION } from "../src/finops-stand.js";
import { SUMMARY_ATTRIBUTE, SUMMARY_ROLE } from "../src/finops-decision-contract.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");

// ---------------------------------------------------------------------------
// 1. The spine itself.
// ---------------------------------------------------------------------------

test("the spine is internally valid", () => {
  const validation = validateAnswerSpineContract();
  assert.deepEqual(validation.errors, [], validation.errors.join("\n"));
  assert.equal(validation.valid, true);
  assert.equal(FINOPS_ANSWER_SPINE.contractVersion, ANSWER_SPINE_CONTRACT_VERSION);
});

test("exactly one region holds the answer role", () => {
  const answers = EVIDENCE_LAYERS.filter((layer) => layer.role === LAYER_ROLE.answer);
  assert.equal(answers.length, 1, `found: ${answers.map((a) => a.id).join(", ") || "none"}`);
  assert.equal(answerRegionId(), answers[0].id);
});

test("a second answer region is a failure, not a layout choice", () => {
  const rival = {
    ...FINOPS_ANSWER_SPINE,
    evidenceLayers: FINOPS_ANSWER_SPINE.evidenceLayers.map((layer, index) =>
      (index === 2 ? { ...layer, role: LAYER_ROLE.answer } : layer)),
  };
  const validation = validateAnswerSpineContract(rival);
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some((error) => /exactly one answer region/.test(error)));
});

test("the question is the answer region's own heading question", () => {
  assert.equal(FINOPS_ANSWER_SPINE.question, STAND_QUESTION);
  assert.equal(answerLayer().question, STAND_QUESTION);
});

// ---------------------------------------------------------------------------
// 2. Every region of the shipped page is classified.
// ---------------------------------------------------------------------------

test("every top-level FinOps region on the page appears in evidenceLayers with a valid role", () => {
  const document = parseHtml(html);
  const rendered = renderedRegionIds(document);
  assert.ok(rendered.length > 10, `expected the page's regions, found ${rendered.length}`);
  const roles = new Set(Object.values(LAYER_ROLE));
  for (const id of rendered) {
    const layer = layerFor(id);
    assert.ok(layer, `#${id} is a top-level region with no entry in the answer spine`);
    assert.ok(roles.has(layer.role), `#${id} carries an invalid role "${layer.role}"`);
    assert.ok(layer.adds, `#${id} does not say what it adds that the layer above does not`);
  }
});

test("a region added to the page without a spine entry fails classification", () => {
  const unknown = layerFor("a-region-nobody-classified");
  assert.equal(unknown, null);
});

test("a removed region is a tombstone, not a region still on the page", () => {
  const document = parseHtml(html);
  const removed = EVIDENCE_LAYERS.filter((layer) => layer.role === LAYER_ROLE.removed);
  assert.ok(removed.length >= 1, "the spine records no removed region");
  const rendered = renderedRegionIds(document);
  for (const layer of removed) {
    assert.ok(!rendered.includes(layer.id), `#${layer.id} is marked removed but is still a region`);
    assert.ok(layer.supersededBy, `#${layer.id} is removed without naming where its question went`);
  }
});

test("the spine classifies every entry the region manifest declares", () => {
  assert.deepEqual(EVIDENCE_LAYERS.map((layer) => layer.id), ANSWER_SPINE.map((entry) => entry.id));
});

// ---------------------------------------------------------------------------
// 3. Order comes from the spine, not from where an element happens to sit.
// ---------------------------------------------------------------------------

test("the rendered order of the page's regions is the spine's order", () => {
  const document = parseHtml(html);
  assert.deepEqual(renderedRegionIds(document), Array.from(orderedRegionIds()));
});

test("applying the spine stamps every region with its role and order and reports no mismatch", () => {
  const document = parseHtml(html);
  const result = applyAnswerSpineContract(document);
  assert.equal(result.applied, true);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.answerRegionId, answerRegionId());

  const answer = document.getElementById(answerRegionId());
  assert.equal(answer.getAttribute(LAYER_ROLE_ATTRIBUTE), LAYER_ROLE.answer);
  assert.equal(answer.getAttribute(LAYER_ORDER_ATTRIBUTE), "0");

  for (const id of orderedRegionIds()) {
    const region = document.getElementById(id);
    if (!region) continue;
    assert.equal(region.getAttribute(LAYER_ROLE_ATTRIBUTE), layerFor(id).role, `#${id}`);
    assert.equal(region.getAttribute(LAYER_ORDER_ATTRIBUTE), String(layerFor(id).order), `#${id}`);
  }
});

test("applying the spine renders the question, the metric label, the action, and the artifact", () => {
  const document = parseHtml(html);
  applyAnswerSpineContract(document);
  assert.equal(document.getElementById(SPINE_VIEW_IDS.question).textContent, FINOPS_ANSWER_SPINE.question);
  assert.equal(document.getElementById(SPINE_VIEW_IDS.metricLabel).textContent, HEADLINE_METRIC.label);
  assert.match(document.getElementById(SPINE_VIEW_IDS.action).textContent,
    new RegExp(FINOPS_ANSWER_SPINE.action.label.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const link = document.getElementById(SPINE_VIEW_IDS.artifactLink);
  assert.equal(link.textContent, FINOPS_ANSWER_SPINE.artifact.label);
  assert.equal(link.getAttribute("href"), `#${FINOPS_ANSWER_SPINE.artifact.control}`);
  assert.equal(document.getElementById(SPINE_VIEW_IDS.artifactNote).textContent,
    FINOPS_ANSWER_SPINE.artifact.recipientCanVerify[0]);
});

test("the forwardable artifact is the export the page already ships", () => {
  const artifact = FINOPS_ANSWER_SPINE.artifact;
  assert.ok(html.includes(`id="${artifact.control}"`),
    `the spine names #${artifact.control} but the page does not ship that control`);
  assert.match(artifact.producedBy, /finops-briefing-export\.js/);
});

// ---------------------------------------------------------------------------
// 4. The pre-import contract: a claim, never a number.
// ---------------------------------------------------------------------------

test("the metric definition names both terms, the window anchor, and the rounding rule", () => {
  assert.match(HEADLINE_METRIC.numerator, /recoverableUsd/);
  assert.match(HEADLINE_METRIC.denominator, /spendUsd/);
  assert.match(HEADLINE_METRIC.window.anchor, /never|browser clock/i);
  assert.match(HEADLINE_METRIC.rounding.share, /half-up/);
  assert.ok(HEADLINE_METRIC.inclusion.length >= 1 && HEADLINE_METRIC.exclusion.length >= 1);
  assert.ok(HEADLINE_METRIC.narrowing, "the narrowing is not recorded in the module");
});

test("the unavailable wording is the wording the answer region already ships", () => {
  assert.equal(HEADLINE_METRIC.unavailable.value, STAND_PENDING.recoverable);
  assert.ok(!/\d/.test(HEADLINE_METRIC.unavailable.value), "the unavailable state carries a digit");
  assert.ok(HEADLINE_METRIC.unavailable.conditions.length >= 3);
});

test("before any import the headline slot renders the declared claim rather than a number", () => {
  const document = parseHtml(html);
  applyAnswerSpineContract(document);
  const value = document.getElementById(SPINE_VIEW_IDS.metricValue);
  assert.equal(value.getAttribute("data-available"), "false");
  assert.equal(value.textContent, HEADLINE_METRIC.unavailable.value);
  assert.ok(!/\d/.test(value.textContent), `the pre-import headline showed "${value.textContent}"`);
  assert.equal(document.getElementById(SPINE_VIEW_IDS.metricBasis).textContent,
    HEADLINE_METRIC.unavailable.basis);
});

test("a painted figure is never overwritten by the unavailable wording", () => {
  const document = parseHtml(html);
  const value = document.getElementById(SPINE_VIEW_IDS.metricValue);
  value.dataset.available = "true";
  value.textContent = "$36,000 · 15% of analyzed spend";
  applyAnswerSpineContract(document);
  assert.equal(value.textContent, "$36,000 · 15% of analyzed spend");
});

test("the pre-import state says which figures are absent and which are labelled demo", () => {
  assert.equal(PRE_IMPORT_STATE.readerDataPresent, false);
  assert.ok(PRE_IMPORT_STATE.absent.length >= 1 && PRE_IMPORT_STATE.demo.length >= 1);
  for (const entry of PRE_IMPORT_STATE.absent) {
    assert.ok(entry.slot && entry.claim && entry.reason, `an absent slot is under-specified`);
    assert.ok(!/^\$?\d/.test(entry.claim), `absent slot ${entry.slot} claims a number`);
    assert.ok(html.includes(`id="${entry.slot}"`), `#${entry.slot} is not on the page`);
  }
  for (const entry of PRE_IMPORT_STATE.demo) {
    assert.ok(html.includes(`id="${entry.slot}"`), `#${entry.slot} is not on the page`);
    assert.ok(entry.label, `demo slot ${entry.slot} is unlabelled`);
  }
  assert.ok(PRE_IMPORT_STATE.onImport.changes.length >= 1);
  assert.ok(PRE_IMPORT_STATE.mustNotClaim.length >= 1);
});

test("the demo labels the pre-import state declares are the labels the page ships", () => {
  for (const entry of PRE_IMPORT_STATE.demo) {
    assert.ok(html.includes(entry.label),
      `#${entry.slot} is declared to carry "${entry.label}" and the page does not say it`);
  }
});

// ---------------------------------------------------------------------------
// 5. The referee reads the spine. No region promotes itself.
// ---------------------------------------------------------------------------

test("the page presents exactly one complete summary, and it is the spine's answer region", () => {
  const document = parseHtml(html);
  const summaries = completeSummaries(document);
  assert.equal(summaries.visible, 1, `found ${summaries.visibleIds.join(", ") || "none"}`);
  assert.deepEqual(summaries.visibleIds, [answerRegionId()]);
});

test("a region cannot promote itself to the complete summary by editing an attribute", () => {
  const document = parseHtml(html);
  const rival = document.createElement("section");
  rival.id = "rival-summary";
  rival.setAttribute(SUMMARY_ATTRIBUTE, SUMMARY_ROLE.complete);
  document.body.append(rival);
  const summaries = completeSummaries(document);
  assert.equal(summaries.visible, 1);
  assert.deepEqual(summaries.visibleIds, [answerRegionId()]);
});

test("a hidden answer region leaves the page with no complete summary rather than a stand-in", () => {
  const document = parseHtml(html);
  document.getElementById(answerRegionId()).hidden = true;
  const summaries = completeSummaries(document);
  assert.equal(summaries.visible, 0);
});

test("the shipped markup labels exactly the spine's answer region as complete", () => {
  const document = parseHtml(html);
  const complete = Array.from(document.querySelectorAll(`[${SUMMARY_ATTRIBUTE}="${SUMMARY_ROLE.complete}"]`));
  assert.deepEqual(complete.map((region) => region.id), [answerRegionId()]);
});
