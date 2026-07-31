// The answer spine, against the page it classifies.
//
// The spine is a declaration: one question, one metric, one action, one
// artifact, and a role for every other top-level region. A declaration that is
// only checked against itself is a wish, so every test here that can be run
// against the SHIPPED markup is run against it — the ids come out of
// src/evolution.html, not out of the module under test.
//
// The four assertions the issue asks for are sections 1 and 4: every top-level
// region on the page is classified, every classification is one of three
// values, exactly one region is the answer, and the pre-import state does not
// present the bundled synthetic example as the reader's own numbers.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml } from "./support/browser.js";
import {
  FINOPS_SPINE, FINOPS_SPINE_VERSION, REGION_CLASS, SPINE_CLASS_ATTRIBUTE,
  SPINE_EVIDENCE_RANK_ATTRIBUTE, SPINE_STATE, SPINE_STATE_ATTRIBUTE,
  answerRegionId, applyFinopsSpine, completeSummaryClaimantIds, computeHeadlineMetric,
  defaultCompleteSummaryId, evidenceOrder, evidenceRegionIds, regionClass,
  removedRegionIds, spineStateFor, validateFinopsSpine,
} from "../src/finops-spine.js";
import {
  ANSWER_SPINE, ROLE, renderedRegionIds, validateAnswerSpine,
} from "../src/finops/answer-spine-view.js";
import {
  ENTITLED_SUMMARY_IDS, FRONT_DOOR_SUMMARY_ID, SUMMARY_ATTRIBUTE, SUMMARY_ROLE,
  recoverableShare, refereeCompleteSummaries,
} from "../src/finops-decision-contract.js";
import { STAND_QUESTION } from "../src/finops-stand.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const openPage = () => parseHtml(html);

// ---------------------------------------------------------------------------
// 1. Every region on the page is classified, and exactly one is the answer.
// ---------------------------------------------------------------------------

test("every top-level region on the shipped page is classified by the spine", () => {
  const rendered = renderedRegionIds(openPage());
  assert.ok(rendered.length > 0, "the page rendered no top-level regions to classify");
  for (const id of rendered) {
    assert.ok(regionClass(id), `#${id} is a top-level region of the page but the spine gives it no class`);
  }
});

test("every classification is one of exactly answer, evidence, or removed", () => {
  const allowed = new Set(Object.values(REGION_CLASS));
  assert.deepEqual([...allowed].sort(), ["answer", "evidence", "removed"]);
  const values = Object.values(FINOPS_SPINE.regions);
  assert.ok(values.length > 0, "the spine classifies nothing");
  for (const [id, value] of Object.entries(FINOPS_SPINE.regions)) {
    assert.ok(allowed.has(value), `#${id} is classified "${value}"`);
  }
});

test("exactly one region is the answer, and it is the region the spine names", () => {
  const answers = Object.keys(FINOPS_SPINE.regions)
    .filter((id) => FINOPS_SPINE.regions[id] === REGION_CLASS.answer);
  assert.equal(answers.length, 1, `expected one answer region, found: ${answers.join(", ") || "none"}`);
  assert.equal(answers[0], answerRegionId(FINOPS_SPINE));
  assert.equal(answerRegionId(FINOPS_SPINE), "finops-stand");
});

test("a second answer region is a failure, not a layout choice", () => {
  const problems = validateFinopsSpine({
    ...FINOPS_SPINE,
    regions: { ...FINOPS_SPINE.regions, "finops-first-run": REGION_CLASS.answer },
  });
  assert.ok(problems.some((line) => line.includes("Exactly one region is the answer")),
    `expected a two-answer failure, got: ${problems.join(" | ") || "no problems"}`);
});

test("a region classified removed is gone from the markup, not hidden in it", () => {
  const removed = removedRegionIds(FINOPS_SPINE);
  assert.ok(removed.length > 0, "the class is declared because the page removed one; keep it honest");
  const rendered = renderedRegionIds(openPage());
  for (const id of removed) {
    assert.ok(!rendered.includes(id), `${id} is classified removed but is still a top-level region`);
    assert.ok(!html.includes(`id="${id}"`), `${id} is classified removed but is still authored in the page`);
  }
});

test("the spine validates clean against the shipped page", () => {
  const problems = validateFinopsSpine(FINOPS_SPINE, { rendered: renderedRegionIds(openPage()) });
  assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------------------
// 2. One question, and the page asks it in those words.
// ---------------------------------------------------------------------------

test("the spine's question is the question the answer region's heading asks", () => {
  const doc = openPage();
  const heading = doc.getElementById(FINOPS_SPINE.answerRegion.headingId);
  assert.equal(heading.textContent.trim(), FINOPS_SPINE.question);
  // …and the composer that paints that heading agrees, without importing it.
  assert.equal(FINOPS_SPINE.question, STAND_QUESTION);
  assert.match(FINOPS_SPINE_VERSION, /^finops-spine\//);
});

// ---------------------------------------------------------------------------
// 3. One metric, defined so two engineers compute the same number.
// ---------------------------------------------------------------------------

test("the metric names its numerator, denominator, unit, window, and sources", () => {
  const metric = FINOPS_SPINE.metric;
  assert.equal(metric.numerator.field, "recoverableUsd");
  assert.equal(metric.denominator.field, "spendUsd");
  assert.equal(metric.unit, "ratio_of_analyzed_spend");
  assert.deepEqual([...metric.timeWindow.fields], ["period.start", "period.end"]);
  assert.deepEqual([...metric.sourceFields].sort(),
    ["period.end", "period.start", "recoverableUsd", "spendUsd"]);
  for (const field of ["definition", "rounding"]) {
    assert.ok(metric[field].trim().length > 20, `the metric's ${field} says nothing usable`);
  }
  // The definition is a modelled ceiling and says so; a realized-saving claim
  // here is the one thing this page may never make.
  assert.match(metric.definition, /modell?ed|model/i);
  assert.doesNotMatch(metric.definition, /invoiced saving|realized saving(?!,)/i);
});

test("computeFrom is the one accessor, and it agrees with the contract's own share", () => {
  const analysis = {
    recoverableUsd: 36000, spendUsd: 240000,
    period: { start: "2026-01-01", end: "2026-06-30" },
  };
  const computed = computeHeadlineMetric(analysis);
  assert.equal(computed.available, true);
  assert.equal(computed.share, 0.15);
  assert.equal(computed.share, recoverableShare(analysis.recoverableUsd, analysis.spendUsd));
  assert.equal(computed.recoverableUsd, 36000);
  assert.equal(computed.spendUsd, 240000);
  assert.deepEqual(computed.window, { start: "2026-01-01", end: "2026-06-30" });

  // Rounding is half-up to four places, stated in the definition and true of
  // the accessor: 1/3 of the analyzed spend is 0.3333, not 0.33 and not 1/3.
  assert.equal(computeHeadlineMetric({ recoverableUsd: 1, spendUsd: 3 }).share, 0.3333);
});

test("a metric with nothing to divide by is withheld, never reported as zero", () => {
  for (const [data, reason] of [
    [null, "no_analyzed_spend_total"],
    [{ recoverableUsd: 100, spendUsd: 0 }, "no_analyzed_spend_total"],
    [{ recoverableUsd: 100, spendUsd: -5 }, "no_analyzed_spend_total"],
    [{ spendUsd: 240000 }, "no_recoverable_total"],
    [{ recoverableUsd: -1, spendUsd: 240000 }, "no_recoverable_total"],
  ]) {
    const computed = computeHeadlineMetric(data);
    assert.equal(computed.available, false);
    assert.equal(computed.share, null, "a withheld metric must not be a zero");
    assert.equal(computed.unavailableReason, reason);
    assert.ok(FINOPS_SPINE.metric.unavailableWhen.some((entry) => entry.reason === reason),
      `${reason} is returned but not declared`);
  }
});

// ---------------------------------------------------------------------------
// 4. What the page may claim before the lead has imported anything.
// ---------------------------------------------------------------------------

test("the pre-import state does not present synthetic data as the lead's own", () => {
  const state = spineStateFor({ imported: false });
  assert.equal(state.id, SPINE_STATE.preImport);
  assert.equal(state.readerDataPresent, false);
  assert.equal(state.presentsSyntheticAsReaderData, false);
  assert.equal(state.metricAvailable, false);
  assert.equal(state.metricValue, null, "a page that has read nothing has no value of the reader's");
  assert.equal(state.metricSource, "bundled-synthetic-example");
  assert.match(state.claim, /no figure on this page is yours yet/i);
  assert.match(state.claim, /synthetic|invented/i);
  assert.match(state.sourceLabel, /synthetic example/i);
  // The one thing it does ask for, and it is the import — not a figure.
  assert.equal(state.action, "import-your-own-export");
  assert.equal(state.artifactScope.includes("example"), true);
});

test("a pre-import state that claimed the reader's own numbers fails validation", () => {
  const problems = validateFinopsSpine({
    ...FINOPS_SPINE,
    preImportState: { ...FINOPS_SPINE.preImportState, readerDataPresent: true, metricValue: 0.15 },
  });
  assert.ok(problems.some((line) => line.includes("pre-import state")),
    `expected a pre-import failure, got: ${problems.join(" | ") || "no problems"}`);
});

test("the post-import state is the reader's own export and says what changed", () => {
  const state = spineStateFor({ imported: true });
  assert.equal(state.id, SPINE_STATE.postImport);
  assert.equal(state.readerDataPresent, true);
  assert.equal(state.headlineSource, "reader-import");
  assert.equal(state.presentsSyntheticAsReaderData, false);
  assert.match(state.claim, /this browser read/i);
  assert.match(state.claim, /not uploaded/i);
});

// ---------------------------------------------------------------------------
// 5. One action, one artifact, and evidence in declared layers.
// ---------------------------------------------------------------------------

test("one action, with the condition it is shown under and the one it falls back to", () => {
  const action = FINOPS_SPINE.action;
  assert.equal(action.condition.requires, "ranked-action-available");
  assert.equal(action.condition.state, SPINE_STATE.postImport);
  assert.equal(action.fallback.condition.state, SPINE_STATE.preImport);
  assert.equal(FINOPS_SPINE.preImportState.action, action.fallback.id);
  assert.equal(FINOPS_SPINE.postImportState.action, action.id);
  // Both point at a region the page actually has.
  const doc = openPage();
  assert.ok(doc.getElementById(action.regionId), `#${action.regionId} is not on the page`);
  assert.ok(doc.getElementById(action.fallback.regionId), `#${action.fallback.regionId} is not on the page`);
});

test("one artifact, and it names both what it carries and what it never carries", () => {
  const artifact = FINOPS_SPINE.artifact;
  assert.ok(openPage().getElementById(artifact.regionId), `#${artifact.regionId} is not on the page`);
  assert.ok(artifact.contains.length >= 3);
  const excluded = artifact.excludes.join(" ").toLowerCase();
  for (const forbidden of ["credential", "customer data", "prompt"]) {
    assert.ok(excluded.includes(forbidden), `the artifact does not exclude ${forbidden}`);
  }
});

test("every evidence region sits in exactly one declared layer", () => {
  const order = evidenceOrder(FINOPS_SPINE);
  assert.deepEqual([...order].sort(), [...evidenceRegionIds(FINOPS_SPINE)].sort(),
    "the layers and the classification name different sets of evidence regions");
  assert.equal(new Set(order).size, order.length, "a region is in two layers");
  for (const layer of FINOPS_SPINE.evidenceLayers) {
    assert.ok(layer.question.trim().endsWith("?"), `layer "${layer.id}" declares no question`);
  }
});

// ---------------------------------------------------------------------------
// 6. The referee: entitlement comes from the spine, not from markup.
// ---------------------------------------------------------------------------

test("the decision contract reads its precedence from the spine", () => {
  assert.equal(FRONT_DOOR_SUMMARY_ID, defaultCompleteSummaryId(FINOPS_SPINE));
  assert.deepEqual([...ENTITLED_SUMMARY_IDS], completeSummaryClaimantIds(FINOPS_SPINE));
  assert.ok(ENTITLED_SUMMARY_IDS.includes(FRONT_DOOR_SUMMARY_ID));
});

test("the shipped page has no complete-summary violations", () => {
  const verdict = refereeCompleteSummaries(openPage());
  assert.deepEqual([...verdict.violations], []);
  assert.equal(verdict.holder, FRONT_DOOR_SUMMARY_ID,
    "before an import the bundled example holds the record; after one it steps down");
});

test("a region cannot declare itself the complete summary", () => {
  const doc = openPage();
  const rival = doc.createElement("section");
  rival.id = "rival-summary";
  rival.setAttribute(SUMMARY_ATTRIBUTE, SUMMARY_ROLE.complete);
  doc.body.append(rival);

  const verdict = refereeCompleteSummaries(doc);
  assert.equal(verdict.violations.length, 1);
  assert.match(verdict.violations[0], /rival-summary/);
  assert.match(verdict.violations[0], /cannot\s+declare itself the answer/);
  // The self-declaration did not make it the answer: the holder is unchanged.
  assert.equal(verdict.holder, FRONT_DOOR_SUMMARY_ID);
});

test("two entitled regions showing at once is a violation, in precedence order", () => {
  const doc = openPage();
  doc.getElementById("guided-result").hidden = false;
  const verdict = refereeCompleteSummaries(doc);
  assert.equal(verdict.violations.length, 1);
  assert.match(verdict.violations[0], /Precedence is/);
  // The reader's own result outranks the example's, so it is the holder.
  assert.equal(verdict.holder, "guided-result");
});

// ---------------------------------------------------------------------------
// 7. The region census and the spine are one decision.
// ---------------------------------------------------------------------------

test("the region census agrees with the spine, region for region", () => {
  const problems = validateAnswerSpine(ANSWER_SPINE, { rendered: renderedRegionIds(openPage()) });
  assert.deepEqual(problems, []);
  for (const entry of ANSWER_SPINE) {
    const expected = entry.role === ROLE.retired
      ? REGION_CLASS.removed
      : (entry.role === ROLE.headline ? REGION_CLASS.answer : REGION_CLASS.evidence);
    assert.equal(regionClass(entry.id), expected, `#${entry.id} disagrees between the two files`);
  }
});

test("a census role with no classification in the spine fails", () => {
  const problems = validateAnswerSpine(ANSWER_SPINE, {
    // The id is the census's, and the census declares the journey layer by its
    // disclosure wrapper since #742 folded the section inside one.
    spine: { ...FINOPS_SPINE, regions: { ...FINOPS_SPINE.regions, "disclosure-journey": undefined } },
  });
  assert.ok(problems.some((line) => line.includes("disclosure-journey")),
    `expected a classification failure, got: ${problems.join(" | ") || "no problems"}`);
});

// ---------------------------------------------------------------------------
// 8. What the page ends up carrying.
// ---------------------------------------------------------------------------

test("applying the spine stamps the classification and the state on the document", () => {
  const doc = openPage();
  const result = applyFinopsSpine(doc);

  const answer = doc.getElementById(answerRegionId(FINOPS_SPINE));
  assert.equal(answer.getAttribute(SPINE_CLASS_ATTRIBUTE), REGION_CLASS.answer);
  assert.equal(answer.getAttribute(SPINE_STATE_ATTRIBUTE), SPINE_STATE.preImport);
  assert.equal(answer.getAttribute(SPINE_EVIDENCE_RANK_ATTRIBUTE), null,
    "the answer is not one of the evidence layers beneath it");

  const first = evidenceOrder(FINOPS_SPINE)[0];
  assert.equal(doc.getElementById(first).getAttribute(SPINE_CLASS_ATTRIBUTE), REGION_CLASS.evidence);
  assert.equal(doc.getElementById(first).getAttribute(SPINE_EVIDENCE_RANK_ATTRIBUTE), "1");

  // The headline metric's label is rendered from the definition, not authored.
  assert.equal(doc.getElementById("finops-stand-metric-label").textContent,
    FINOPS_SPINE.metric.name);
  assert.ok(result.applied.includes(answerRegionId(FINOPS_SPINE)));
  assert.deepEqual(result.missing, [], `regions the spine classifies are missing: ${result.missing.join(", ")}`);
  assert.equal(result.state, SPINE_STATE.preImport);
});

test("an imported paint moves the answer region to the post-import state", () => {
  const doc = openPage();
  applyFinopsSpine(doc, { imported: true });
  assert.equal(doc.getElementById(answerRegionId(FINOPS_SPINE)).getAttribute(SPINE_STATE_ATTRIBUTE),
    SPINE_STATE.postImport);
});

test("applying the spine to a document missing every region throws nothing", () => {
  const doc = parseHtml("<!doctype html><html><body><main id=\"main-content\"></main></body></html>");
  const result = applyFinopsSpine(doc);
  assert.deepEqual(result.applied, []);
  assert.equal(result.missing.length, evidenceRegionIds(FINOPS_SPINE).length + 1);
});
