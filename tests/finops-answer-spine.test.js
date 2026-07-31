// The answer spine: the classification, the guards that fail the build, and the
// one crash the shared test harness cannot see.
//
// WHY THIS FILE CONSTRUCTS ITS OWN DOM SHAPES. tests/support/browser.js gives
// every element a plain Array for `children`. A real browser gives a live
// `HTMLCollection`: iterable and indexable, with none of `Array.prototype` on
// it. So a module that calls `children.some(...)` passes every suite in this
// repository and throws `TypeError` on the first heading it meets in a browser
// — and because `applyAnswerSpine(document)` runs before every paint in
// `init()`, that throw ships the page inert. The harness is not wrong, it is
// simply not evidence for this defect class, so the assertions below build a
// genuine browser-shaped collection and drive the real module against it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, parseHtml } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  ANSWER_SPINE, HEADLINE_REGION_ID, MEASURED_BENCHMARK_LANGUAGE, ROLE,
  ROLE_ATTRIBUTE, STEP_ATTRIBUTE, SUPERSEDED_BY_ATTRIBUTE, SYNTHETIC_COHORT_BASIS,
  applyAnswerSpine, renderedRegionIds, validateAnswerSpine,
} from "../src/finops/answer-spine-view.js";
import { STAND_IDS, STAND_QUESTION } from "../src/finops-stand.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const DEMO_DATA = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(await readFile(
  new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

/** The manifest with one entry replaced or added — never the frozen original. */
const withEntry = (id, patch) => ANSWER_SPINE.map(
  (entry) => (entry.id === id ? { ...entry, ...patch } : entry));

// ---------------------------------------------------------------------------
// 1. A real HTMLCollection. This is the assertion the retry exists for.
// ---------------------------------------------------------------------------

/**
 * A collection shaped like `Element.children` in a browser: `length`, indexed
 * access, `item()`, iterable — and no `Array.prototype`, so `.some`, `.map`,
 * `.filter` and friends are simply not there. `Object.create(null)` is the
 * point: inheriting from `Object.prototype` would still be too generous.
 */
function htmlCollection(...elements) {
  const collection = Object.create(null);
  elements.forEach((element, index) => { collection[index] = element; });
  collection.length = elements.length;
  collection.item = (index) => collection[index] ?? null;
  collection[Symbol.iterator] = function* iterate() {
    for (let index = 0; index < this.length; index += 1) yield this[index];
  };
  return collection;
}

/** A minimal document holding the headline region and its heading, browser-shaped. */
function browserShapedDocument({ headingChildren = [], headingText = "" } = {}) {
  const written = new Map();
  const region = {
    nodeType: 1,
    id: HEADLINE_REGION_ID,
    setAttribute: (name, value) => { written.set(name, value); },
    removeAttribute: (name) => { written.delete(name); },
  };
  const heading = {
    nodeType: 1,
    id: STAND_IDS.question,
    children: htmlCollection(...headingChildren),
    textContent: headingText,
    setAttribute: () => {},
    removeAttribute: () => {},
  };
  const nodes = new Map([[region.id, region], [heading.id, heading]]);
  return { doc: { getElementById: (id) => nodes.get(id) ?? null }, written, heading };
}

test("applyAnswerSpine tolerates a real HTMLCollection heading", () => {
  const span = { nodeType: 1, tagName: "SPAN" };
  const { doc, written, heading } = browserShapedDocument({ headingChildren: [span] });

  // The fixture is only worth anything if it genuinely lacks the array methods
  // whose use on a live collection is the defect being pinned.
  for (const method of ["some", "map", "filter", "find", "forEach", "reduce", "includes", "flatMap"]) {
    assert.equal(typeof heading.children[method], "undefined",
      `a browser HTMLCollection has no ${method}(); this fixture must not either`);
  }
  assert.equal(heading.children.length, 1);
  assert.deepEqual([...heading.children], [span], "it is iterable, so spreading is the safe read");

  // The real module, over the real manifest, against that shape. Any array
  // method called on `children` throws here, and nothing below would run.
  const result = applyAnswerSpine(doc);

  assert.equal(written.get(ROLE_ATTRIBUTE), ROLE.headline,
    "the headline region is classified, which means the walk completed");
  assert.deepEqual(result.applied, [HEADLINE_REGION_ID]);
  assert.equal(result.headline, HEADLINE_REGION_ID);
  assert.ok(result.missing.length > 0, "the other declared regions are absent, and that is not an error");
});

test("a heading composed of element markup keeps its contents under real DOM semantics", () => {
  const { doc, heading } = browserShapedDocument({
    headingChildren: [{ nodeType: 1, tagName: "SPAN" }],
    headingText: "",
  });
  applyAnswerSpine(doc);
  assert.equal(heading.textContent, "",
    "another module owns this heading's contents; the spine must not overwrite them");
});

test("an empty heading is given the question its region answers", () => {
  const { doc, heading } = browserShapedDocument({ headingChildren: [], headingText: "  " });
  applyAnswerSpine(doc);
  assert.equal(heading.textContent, STAND_QUESTION,
    "a listed region with no label is a blank block in the reading order");
});

test("a heading that already reads is left exactly as authored", () => {
  const { doc, heading } = browserShapedDocument({
    headingChildren: [], headingText: "Where do we stand on AI spend?",
  });
  applyAnswerSpine(doc);
  assert.equal(heading.textContent, "Where do we stand on AI spend?");
});

// ---------------------------------------------------------------------------
// 2. The manifest against the page that ships.
// ---------------------------------------------------------------------------

test("every region of the shipped page is declared, in the order it is read", () => {
  const document = parseHtml(html);
  const rendered = renderedRegionIds(document);

  assert.ok(rendered.includes(HEADLINE_REGION_ID), "the page still carries the headline region");
  assert.ok(rendered.length >= 30, `expected the full top-level region list, got ${rendered.length}`);
  assert.deepEqual(validateAnswerSpine(ANSWER_SPINE, { rendered }), [],
    "the manifest and the shipped document must agree");
});

test("the four added ids are additive: nothing that had one was renamed", () => {
  const document = parseHtml(html);
  const rendered = renderedRegionIds(document);
  for (const id of ["finops-hero", "local-import", "finops-proof-point", "finops-privacy"]) {
    assert.ok(rendered.includes(id), `${id} is a top-level region on the page`);
  }
  // Ids the rest of the page and its tests already depend on, unchanged.
  for (const id of ["finops-stand", "finops-first-run", "finops-next-step", "finops-headline",
    "finops-contact", "score-card", "kpi-row"]) {
    assert.ok(html.includes(`id="${id}"`), `${id} is still authored on the page`);
  }
});

test("exactly one region is declared the headline, and it is the stand region", () => {
  const headlines = ANSWER_SPINE.filter((entry) => entry.role === ROLE.headline);
  assert.equal(headlines.length, 1);
  assert.equal(headlines[0].id, HEADLINE_REGION_ID);
  assert.equal(headlines[0].question, STAND_QUESTION,
    "the headline's question comes from the module that owns it, so the two cannot drift");
});

test("a second declared headline fails the build", () => {
  const problems = validateAnswerSpine(withEntry("finops-first-run", { role: ROLE.headline }));
  assert.ok(problems.some((problem) => problem.includes("exactly one headline")),
    `expected a headline-count problem, got: ${problems.join(" | ")}`);
});

test("a rendered region that is not declared fails the build", () => {
  const rendered = [...renderedRegionIds(parseHtml(html)), "finops-surprise-panel"];
  const problems = validateAnswerSpine(ANSWER_SPINE, { rendered });
  assert.ok(problems.some((problem) => problem.includes("finops-surprise-panel")
    && problem.includes("not declared")),
  `expected an unlisted-region problem, got: ${problems.join(" | ")}`);
});

test("a declared region that the page does not render fails the build", () => {
  const rendered = renderedRegionIds(parseHtml(html)).filter((id) => id !== "score-card");
  const problems = validateAnswerSpine(ANSWER_SPINE, { rendered });
  assert.ok(problems.some((problem) => problem.includes("score-card") && problem.includes("not on the page")),
    `expected a missing-region problem, got: ${problems.join(" | ")}`);
});

// ---------------------------------------------------------------------------
// 3. Retirement stays mechanical.
// ---------------------------------------------------------------------------

test("every retired region names a live region that took its question", () => {
  const document = parseHtml(html);
  const rendered = renderedRegionIds(document);
  const retired = ANSWER_SPINE.filter((entry) => entry.role === ROLE.retired);
  assert.ok(retired.length > 0, "the role is declared because the page has one; keep it honest");
  for (const entry of retired) {
    const replacement = ANSWER_SPINE.find((candidate) => candidate.id === entry.supersededBy);
    assert.ok(replacement, `${entry.id} points at a declared region`);
    assert.notEqual(replacement.role, ROLE.retired, `${entry.id} does not point at another retired region`);
    assert.ok(rendered.includes(replacement.id), `${entry.id} points at a region still on the page`);
  }
});

test("a supersededBy pointer that does not resolve to a live region fails the build", () => {
  const rendered = renderedRegionIds(parseHtml(html));
  const dangling = validateAnswerSpine(
    withEntry("finops-first-run-conversion", { supersededBy: "finops-deleted-panel" }), { rendered });
  assert.ok(dangling.some((problem) => problem.includes("finops-deleted-panel")),
    `expected a dangling-pointer problem, got: ${dangling.join(" | ")}`);

  const chained = validateAnswerSpine(
    withEntry("finops-contact", { role: ROLE.retired, supersededBy: "finops-first-run" }), { rendered });
  assert.ok(chained.some((problem) => problem.includes("itself retired")),
    `expected a chained-retirement problem, got: ${chained.join(" | ")}`);
});

// ---------------------------------------------------------------------------
// 4. Wording guards. This page ships invented data and may not sound measured.
// ---------------------------------------------------------------------------

test("measured-benchmark wording anywhere in the manifest fails the build", () => {
  for (const phrase of MEASURED_BENCHMARK_LANGUAGE) {
    const problems = validateAnswerSpine(withEntry("finops-hero", {
      entitledToAssert: `Spend compared to the ${phrase} for this size of organization.`,
    }));
    assert.ok(problems.some((problem) => problem.includes(phrase)),
      `"${phrase}" must fail the build`);
  }
  assert.deepEqual(validateAnswerSpine(ANSWER_SPINE).filter(
    (problem) => problem.includes("measured-benchmark")), []);
});

test("a peer claim without the synthetic-cohort basis, verbatim, fails the build", () => {
  const headline = ANSWER_SPINE.find((entry) => entry.id === HEADLINE_REGION_ID);
  assert.ok(headline.entitledToAssert.includes(SYNTHETIC_COHORT_BASIS),
    "the headline's peer position states where the cohort boundaries came from");

  const paraphrased = withEntry(HEADLINE_REGION_ID, {
    entitledToAssert: "A peer position on analyzed AI spend. The cohort is synthetic.",
  });
  assert.ok(validateAnswerSpine(paraphrased).some((problem) => problem.includes("synthetic-cohort basis")),
    "a paraphrase is how hand-authored quietly becomes measured");
});

// ---------------------------------------------------------------------------
// 5. The validator reports everything, not the first thing.
// ---------------------------------------------------------------------------

test("validateAnswerSpine returns the full problem list rather than throwing on the first", () => {
  const broken = [
    { id: "finops-hero", role: "decorative", question: "", headingId: null },
    { id: "finops-hero", role: ROLE.step, question: "Duplicated?", entitledToAssert: "Nothing." },
    { id: "finops-orphan", role: ROLE.retired, question: "Gone where?", supersededBy: "finops-nowhere" },
  ];
  const problems = validateAnswerSpine(broken);
  const joined = problems.join(" | ");

  assert.ok(problems.length >= 5, `expected every problem at once, got: ${joined}`);
  assert.ok(joined.includes("not one of"), "the unknown role is reported");
  assert.ok(joined.includes("declared more than once"), "the duplicate id is reported");
  assert.ok(joined.includes("declares no question"), "the empty question is reported");
  assert.ok(joined.includes("exactly one headline"), "the missing headline is reported");
  assert.ok(joined.includes("finops-nowhere"), "the dangling pointer is reported");
  assert.deepEqual(validateAnswerSpine([]), [
    "The answer spine is empty; every region must be declared.",
    "The page must declare exactly one headline region; it declares 0.",
  ]);
});

// ---------------------------------------------------------------------------
// 6. The surface. The classification has to be true of the page a reader gets.
// ---------------------------------------------------------------------------

test("the shipped page carries its roles and its reading order after init", async () => {
  const page = await loadPage(PAGE, {
    storage: {},
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  // Reaching "ready" is itself the regression assertion at the page level: it
  // is set on the last line of `init()`, and a throw from `applyAnswerSpine` on
  // the first line would leave the page inert with every paint unrun.
  await waitFor(() => page.document.documentElement.dataset.shiplogEvolution === "ready",
    "the bundled analysis to finish rendering");

  const { document } = page;
  const roleOf = (id) => document.getElementById(id)?.getAttribute(ROLE_ATTRIBUTE);
  const stepOf = (id) => document.getElementById(id)?.getAttribute(STEP_ATTRIBUTE);

  assert.equal(roleOf(HEADLINE_REGION_ID), ROLE.headline);
  assert.equal(stepOf("finops-hero"), "1", "the hero states the promise, above the answer");
  assert.equal(stepOf(HEADLINE_REGION_ID), "2", "the answer is the second thing on the page");
  assert.equal(roleOf("finops-privacy"), ROLE.detail);
  assert.equal(stepOf("finops-privacy"), null, "a supporting region takes no place in the reading order");
  // A retired region is not stamped, because it is not there to stamp: the mark
  // is a deletion instruction and the deletion happened. What must still be on
  // the page is the region that took its question.
  assert.equal(document.getElementById("finops-first-run-conversion"), null,
    "a retired region is deleted, not stamped and shipped");
  assert.equal(roleOf("finops-contact"), ROLE.detail,
    "the region that took the retired ask is live and classified");
  assert.equal(document.getElementById("finops-contact")
    .getAttribute(SUPERSEDED_BY_ATTRIBUTE), null,
  "the successor carries no supersession mark of its own");

  // The paints that run after the spine, which a throw on the first line of
  // init() would have skipped: the headline's own answer slot, and the shell.
  assert.notEqual(document.getElementById(STAND_IDS.answer)?.textContent.trim(), "");
  assert.ok(document.getElementById("finops-workspace-nav")?.getAttribute("data-ranked"),
    "the workspace rail was reached and bound");
});
