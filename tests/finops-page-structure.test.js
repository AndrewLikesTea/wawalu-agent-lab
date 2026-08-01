// The shipped page's top-level structure, audited against the answer spine.
//
// WHY THIS IS A SEPARATE FILE FROM tests/finops-answer-spine.test.js. That file
// checks the manifest: its roles, its wording guards, its pointers. This one
// checks the DOCUMENT — the regions a reader actually meets — and the two
// failure modes it exists for are ones a manifest check cannot see:
//
//   1. A section nobody declared. Iterating the declarations finds every
//      declared region and, by construction, no undeclared one. The audit walks
//      `#main-content`'s element children instead, so a section that was added
//      to the markup and to nothing else is a failure rather than a silence.
//
//   2. A region the manifest retired that is still on the page. Retirement here
//      means deletion. Hiding it, demoting its heading, or moving it inside
//      another region all still fail, because the check is over the document's
//      real top-level children.
//
// Both are asserted below by CONSTRUCTING the failing document, not by
// describing it: the audit is only worth having if it goes red on the shape it
// was written to catch.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import { DECISION_SUMMARY, auditDecisionSummary } from "../src/finops-screen-contract.js";
import {
  ANSWER_SPINE, MAIN_REGION_ID, ROLE,
  auditPageStructure, liveRegionIds, namingHeading, normalizeQuestion,
  renderedRegionIds, retiredRegionIds, validateAnswerSpine,
} from "../src/finops/answer-spine-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");

/** The shipped markup with extra regions spliced in just above `</main>`. */
const pageWith = (markup) => html.replace("</main>", `${markup}\n</main>`);

/** The manifest with one entry replaced — never the frozen original. */
const withEntry = (id, patch) => ANSWER_SPINE.map(
  (entry) => (entry.id === id ? { ...entry, ...patch } : entry));

// ---------------------------------------------------------------------------
// 1. The live set IS the page. This is the mechanism a retirement flips.
// ---------------------------------------------------------------------------

test("the page's top-level regions are exactly the manifest's live set, in order", () => {
  const rendered = renderedRegionIds(parseHtml(html));
  assert.deepEqual(rendered, liveRegionIds(ANSWER_SPINE),
    "the shipped document and the manifest's live regions must be the same list, in the same order");
});

test("every region the manifest retired is gone from the page, not hidden on it", () => {
  const retired = retiredRegionIds(ANSWER_SPINE);
  assert.ok(retired.length > 0, "the role is declared because the page retired one; keep it honest");
  for (const id of retired) {
    assert.ok(!html.includes(`id="${id}"`),
      `${id} is declared retired but is still authored in evolution.html`);
  }
});

test("flipping one manifest entry to retired fails until the markup is deleted", () => {
  const rendered = renderedRegionIds(parseHtml(html));
  const flipped = withEntry("score-card", { role: ROLE.retired, supersededBy: "finops-stand" });
  const problems = validateAnswerSpine(flipped, { rendered });

  // This is the whole point of the mark. Before this change a retired entry was
  // held to the same "must be on the page" rule as a live one, so flipping a
  // role changed nothing at all and the label was decoration.
  assert.ok(problems.some((problem) => problem.includes("score-card")
    && problem.includes("still on the page")),
  `expected a retired-but-shipped problem, got: ${problems.join(" | ")}`);
});

test("a retired region is not stamped, numbered, or counted as missing", () => {
  const rendered = renderedRegionIds(parseHtml(html));
  // The retired entries stay declared as the record of where their question
  // went, and that record must not itself become a problem.
  assert.deepEqual(
    validateAnswerSpine(ANSWER_SPINE, { rendered }).filter((problem) => problem.includes("retired")),
    [], "a tombstone is not a defect");
});

// ---------------------------------------------------------------------------
// 2. The audit walks the document, so an undeclared section cannot hide in it.
// ---------------------------------------------------------------------------

test("the shipped page passes the structure audit", () => {
  assert.deepEqual(auditPageStructure(parseHtml(html)), []);
});

test("an undeclared section with a duplicate-question heading fails the audit", () => {
  // The exact shape the audit exists for: nobody declared it, and it asks the
  // question the headline region already answers. A check that iterated the
  // manifest would never look at it.
  const document = parseHtml(pageWith(
    '<section id="finops-shadow-answer" aria-labelledby="finops-shadow-answer-title">'
    + '<h2 id="finops-shadow-answer-title">Where do we stand on AI spend?</h2>'
    + "<p>A second answer, added to the markup and to nothing else.</p></section>"));

  const problems = auditPageStructure(document);
  assert.ok(problems.some((problem) => problem.includes("finops-shadow-answer")
    && problem.includes("no role")),
  `expected an undeclared-region problem, got: ${problems.join(" | ")}`);
  assert.ok(problems.some((problem) => problem.includes("same question")
    && problem.includes("Where do we stand on AI spend?")),
  `expected a duplicate-question problem, got: ${problems.join(" | ")}`);
});

test("a section with no id at all is still audited", () => {
  // An undeclared region cannot be declared, because a region with no id cannot
  // be named. The audit reports it by tag and class rather than skipping it.
  const problems = auditPageStructure(parseHtml(pageWith(
    '<section class="quiet-extra"><h2>What else should I know?</h2></section>')));
  assert.ok(problems.some((problem) => problem.includes("quiet-extra") && problem.includes("no role")),
    `expected an id-less region to be reported, got: ${problems.join(" | ")}`);
});

test("the audit reports a retired region that is still in the document", () => {
  const document = parseHtml(pageWith(
    '<aside id="finops-first-run-conversion"><p>Want help with your own analysis?</p></aside>'));
  const problems = auditPageStructure(document);
  assert.ok(problems.some((problem) => problem.includes("finops-first-run-conversion")
    && problem.includes("Retirement here is deletion")),
  `expected a retired-but-present problem, got: ${problems.join(" | ")}`);
});

test("a second h1 in the main content fails the audit", () => {
  const problems = auditPageStructure(parseHtml(pageWith(
    '<section id="finops-hero-again"><h1>Know what your AI spend is buying.</h1></section>')));
  assert.ok(problems.some((problem) => problem.includes("h1")),
    `expected an h1-count problem, got: ${problems.join(" | ")}`);
});

// ---------------------------------------------------------------------------
// 3. One question, one region — on the page and in the manifest.
// ---------------------------------------------------------------------------

test("no two top-level regions of the shipped page ask the same visible question", () => {
  const document = parseHtml(html);
  const main = document.getElementById(MAIN_REGION_ID);
  const asked = new Map();
  for (const region of [...main.children]) {
    if (region?.nodeType !== 1) continue;
    const heading = namingHeading(region, document);
    const key = normalizeQuestion(heading?.textContent);
    if (!key) continue;
    assert.equal(asked.get(key), undefined,
      `"${asked.get(key)}" and "${region.id}" both ask ${heading.textContent.trim()}`);
    asked.set(key, region.id);
  }
  assert.ok(asked.size >= 10, `expected the page's questions to be found, got ${asked.size}`);
});

test("two manifest entries asking one question fail before the second heading is authored", () => {
  const problems = validateAnswerSpine(
    // #742 folded this region into a disclosure; the census declares the wrapper.
    withEntry("disclosure-next-step", { question: "Where do we stand on AI spend?" }));
  assert.ok(problems.some((problem) => problem.includes("same question")),
    `expected a duplicate-question problem, got: ${problems.join(" | ")}`);
});

test("a heading that is hidden from sighted readers is not a competing question", () => {
  // #finops-first-run carries a visually-hidden "Two ways to go on" heading, and
  // the page is full of visually-hidden live regions. None of them is a question
  // a reader meets, so none of them may collide with one.
  const document = parseHtml(html);
  const firstRun = document.getElementById("finops-first-run");
  assert.equal(namingHeading(firstRun, document)?.id, "finops-first-run-title");
});

// ---------------------------------------------------------------------------
// 4. ONE DECISION SUMMARY, and it states all four things.
//
// The failure this section exists for is #831's: a first-time reader met the
// question, a number, an action and a hedge more than once on one screen, in
// regions that were each painted from the same verdict, and nothing failed when
// a second one was authored. The rule is now declared in
// src/finops-screen-contract.js and checked here against the shipped document —
// and, as everywhere else in this file, against a CONSTRUCTED failing one.
// ---------------------------------------------------------------------------

test("the shipped page carries exactly one decision summary, and it is the declared one", () => {
  const document = parseHtml(html);
  assert.deepEqual(auditDecisionSummary(document), []);

  const marked = document.querySelectorAll(
    `[${DECISION_SUMMARY.attribute}="${DECISION_SUMMARY.claim}"]`);
  assert.deepEqual([...marked].map((element) => element.id), [DECISION_SUMMARY.regionId],
    "exactly one region may claim to answer the question on its own");
});

test("a second decision-summary region fails the audit", () => {
  // A competing answer, authored the way a well-meaning second one would be:
  // its own question, its own number, its own action, its own hedge.
  const problems = auditDecisionSummary(parseHtml(pageWith(
    `<section id="finops-second-answer" ${DECISION_SUMMARY.attribute}="${DECISION_SUMMARY.claim}">`
    + "<h2>Is our AI spend classification trustworthy enough to act on?</h2>"
    + "<p>62.0% of spend in scope</p><p>Confidence: moderate.</p>"
    + '<a href="#local-import">Analyze a provider export</a></section>')));
  assert.ok(problems.some((problem) => problem.includes("2 regions claim to be the decision summary")
    && problem.includes("#finops-second-answer")),
  `expected a second-summary problem, got: ${problems.join(" | ")}`);
});

test("the one decision summary names its question, its number, and its one next action", () => {
  const document = parseHtml(html);
  const region = document.getElementById(DECISION_SUMMARY.regionId);
  assert.ok(region, "the decision summary must be in the shipped markup, not painted into it");

  // Each part is read as the question a leader is asking, and the wording is the
  // contract's: a page that authored its own copy here could drift from the
  // module every downstream reader paints from.
  const authored = (id) => textOf(document.getElementById(id));
  const part = (role) => DECISION_SUMMARY.parts.find((entry) => entry.role === role);

  assert.equal(authored(part("question").elementId), part("question").authored,
    "the region must name what this page decides, in the contract's words");
  assert.equal(authored(part("metric").slots.label.elementId),
    part("metric").slots.label.authored, "the number must be labelled with its metric");
  assert.equal(authored(part("metric").slots.value.elementId),
    part("metric").slots.value.authored);
  assert.equal(authored(part("metric").slots.basis.elementId),
    part("metric").slots.basis.authored, "a number with no period is not checkable");
  assert.equal(authored(part("confidence").elementId), part("confidence").authored,
    "the hedge ships with the figure, not after it");

  // EXACTLY ONE ACTION. A second one at the same weight is the ranking decision
  // being handed back to the reader.
  const actions = region.querySelectorAll("a");
  assert.deepEqual([...actions].map((link) => link.id), [part("action").elementId],
    "the decision summary carries one next action; a second belongs in disclosure");
  assert.equal(authored(part("action").elementId), part("action").authored);
  assert.equal(document.getElementById(part("action").elementId).getAttribute("href"),
    part("action").href, "the one action is operable before any script runs");
});

test("a decision summary that lost a part is a reported problem", () => {
  // Deleting the confidence sentence is the regression that reads best: the
  // number stays, the action stays, and the reader is no longer told how far to
  // trust either. The audit has to see the absence.
  const confidence = DECISION_SUMMARY.parts.find((part) => part.role === "confidence");
  const stripped = html.replace(new RegExp(
    `<p class="answer-confidence" id="${confidence.elementId}">[^<]*</p>`), "");
  assert.notEqual(stripped, html, "this assertion needs the confidence line to have been removed");

  const problems = auditDecisionSummary(parseHtml(stripped));
  assert.ok(problems.some((problem) => problem.includes("states no confidence")
    && problem.includes(confidence.answers)),
  `expected a missing-part problem, got: ${problems.join(" | ")}`);
});

// ---------------------------------------------------------------------------
// 5. The audit is total: a document it cannot read is a reported problem.
// ---------------------------------------------------------------------------

test("auditPageStructure never throws on a document it cannot read", () => {
  assert.deepEqual(auditPageStructure(null), [
    `There is no "#${MAIN_REGION_ID}", so the page has no top-level regions to audit.`]);
  assert.deepEqual(auditPageStructure({ getElementById: () => null }), [
    `There is no "#${MAIN_REGION_ID}", so the page has no top-level regions to audit.`]);
});
