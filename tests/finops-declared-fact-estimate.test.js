// The declared-fact estimator: pinned figures, degradation, and the one thing
// it must never be able to say (#1102).
//
// Every scenario is a named fixture with a stated reason for existing, and the
// expectations below are EXACT. A coefficient that moves fails a named case
// with a number beside it, which is what a director disputing this score gets
// to read.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml } from "./support/browser.js";
import {
  CONFIDENCE_TIER, DEFAULT_PROVIDER_MIX, ESTIMATE_MARKER, ESTIMATE_NOTE,
  PLAUSIBLE_ENGINEER_HEADCOUNT, PLAUSIBLE_MONTHLY_SPEND_USD, PROVENANCE,
  PROVIDER_TIER_SUCCESS_RATE, RECOVERABLE_SHARE_BAND, TASKS_ATTEMPTED_PER_ENGINEER_MONTH,
  estimateDetail, estimateFromDeclaredFacts, estimateHeadline,
} from "../src/finops-declared-fact-estimate.js";
import {
  DECLARED_FACT_FIXTURES, EXAMPLE_DECLARED_FACTS, declaredFactFixture,
} from "../src/finops-declared-fact-fixtures.js";
import { RESULT_BASIS, TRUST_STATE, composeTrust } from "../src/finops-guided-result.js";
import { loadExampleDataset } from "../src/example-dataset.js";
import { ORG_SIZE_BAND, PEER_INDUSTRY } from "../src/peer-cost-cohorts.js";
import { applyDeclaredFactEstimate, ESTIMATE_HEADING } from "../src/finops-first-run-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const MODULE = new URL("../src/finops-declared-fact-estimate.js", import.meta.url);
const html = await readFile(PAGE, "utf8");

/**
 * The pinned figures, one row per labelled fixture.
 *
 * `cost` is the display string a reader sees, `tasks` the integer denominator
 * they can reproduce, `band` the quartile or null where it is withheld, and
 * `recoverable` the modelled monthly range or null.
 */
const PINNED = Object.freeze({
  "bundled-example-enterprise-saas": {
    tier: CONFIDENCE_TIER.modelled, cost: "$39.81", tasks: 3881,
    band: "bottom_quartile", recoverable: [20_772, 49_854], notes: [],
  },
  "frugal-small-saas": {
    tier: CONFIDENCE_TIER.modelled, cost: "$4.32", tasks: 2082,
    band: "top_quartile", recoverable: [0, 0], notes: [],
  },
  "mid-saas-middle-range": {
    tier: CONFIDENCE_TIER.modelled, cost: "$21.15", tasks: 5674,
    band: "middle_range", recoverable: [11_914, 28_594], notes: [],
  },
  "zero-spend": {
    tier: CONFIDENCE_TIER.insufficient, cost: null, tasks: null,
    band: null, recoverable: null, notes: [ESTIMATE_NOTE.noSpend],
  },
  "missing-headcount": {
    tier: CONFIDENCE_TIER.insufficient, cost: null, tasks: null,
    band: null, recoverable: null, notes: [ESTIMATE_NOTE.noHeadcount],
  },
  "no-mix-no-cohort-attributes": {
    tier: CONFIDENCE_TIER.directional, cost: "$34.82", tasks: 1723,
    band: null, recoverable: null,
    notes: [ESTIMATE_NOTE.defaultMix, ESTIMATE_NOTE.missingCohortAttributes],
  },
  "implausible-declarations": {
    tier: CONFIDENCE_TIER.directional, cost: "$2.49", tasks: 2_009_000,
    band: "top_quartile", recoverable: [0, 0],
    notes: [ESTIMATE_NOTE.clampedSpend, ESTIMATE_NOTE.clampedHeadcount],
  },
});

test("every fixture is labelled, says what it catches, and is pinned", () => {
  assert.ok(DECLARED_FACT_FIXTURES.length >= 6,
    "fewer than six scenarios cannot cover the tier ladder and the two withheld cases");
  const names = DECLARED_FACT_FIXTURES.map((entry) => entry.name);
  assert.equal(new Set(names).size, names.length, "two fixtures share a name");
  for (const entry of DECLARED_FACT_FIXTURES) {
    assert.ok(entry.catches.length > 30, `${entry.name} does not say what it catches`);
    assert.ok(PINNED[entry.name], `${entry.name} has no pinned expectation`);
  }
  assert.ok(names.includes("zero-spend") && names.includes("missing-headcount"),
    "the two degradation cases the issue names must both be fixtures");
});

test("each fixture produces exactly the pinned figures", () => {
  for (const entry of DECLARED_FACT_FIXTURES) {
    const expected = PINNED[entry.name];
    const estimate = estimateFromDeclaredFacts(entry.facts);
    const where = `${entry.name}: ${entry.catches}`;
    assert.equal(estimate.confidence.tier, expected.tier, where);
    assert.deepEqual([...estimate.notes], expected.notes, where);
    assert.equal(estimate.costPerSuccessfulTask.display ?? null, expected.cost, where);
    assert.equal(estimate.costPerSuccessfulTask.successfulTasks ?? null, expected.tasks, where);
    assert.equal(estimate.quartile.band ?? null, expected.band, where);
    const recoverable = estimate.recoverableMonthlyUsd.available
      ? [estimate.recoverableMonthlyUsd.low, estimate.recoverableMonthlyUsd.high]
      : null;
    assert.deepEqual(recoverable, expected.recoverable, where);
  }
});

test("the same facts produce an identical result on every run", () => {
  for (const entry of DECLARED_FACT_FIXTURES) {
    const once = estimateFromDeclaredFacts(entry.facts);
    const twice = estimateFromDeclaredFacts(entry.facts);
    assert.notEqual(once, twice, "a cached object would hide a mutation, not prove determinism");
    assert.deepEqual(JSON.parse(JSON.stringify(once)), JSON.parse(JSON.stringify(twice)),
      `${entry.name} is not deterministic`);
    assert.equal(estimateHeadline(once), estimateHeadline(twice));
  }
});

test("higher spend at a fixed headcount never lowers cost per successful task", () => {
  const base = { ...EXAMPLE_DECLARED_FACTS };
  let previous = 0;
  for (const spend of [1_000, 25_000, 154_500, 400_000, 1_200_000]) {
    const estimate = estimateFromDeclaredFacts({ ...base, monthlySpendUsd: spend });
    const value = estimate.costPerSuccessfulTask.value;
    assert.ok(value > previous,
      `cost per task fell from ${previous} to ${value} when spend rose to ${spend}`);
    previous = value;
  }
  // The denominator moves the other way for the same reason, and that claim is
  // worth pinning too: more engineers over the same bill is a cheaper task.
  let cheaper = Infinity;
  for (const engineers of [10, 50, 100, 500]) {
    const estimate = estimateFromDeclaredFacts({ ...base, engineers });
    assert.ok(estimate.costPerSuccessfulTask.value < cheaper);
    cheaper = estimate.costPerSuccessfulTask.value;
  }
});

// --- degradation ------------------------------------------------------------

test("an unusable numerator or denominator withholds the figure instead of publishing one", () => {
  for (const facts of [
    {}, { monthlySpendUsd: 0, engineers: 10 }, { monthlySpendUsd: -5, engineers: 10 },
    { monthlySpendUsd: Number.NaN, engineers: 10 }, { monthlySpendUsd: Infinity, engineers: 10 },
    { monthlySpendUsd: 10_000 }, { monthlySpendUsd: 10_000, engineers: 0 },
    { monthlySpendUsd: 10_000, engineers: -3 }, { monthlySpendUsd: 10_000, engineers: "twelve" },
  ]) {
    const estimate = estimateFromDeclaredFacts(facts);
    assert.equal(estimate.confidence.tier, CONFIDENCE_TIER.insufficient, JSON.stringify(facts));
    assert.equal(estimate.costPerSuccessfulTask.available, false);
    assert.equal(estimate.quartile.available, false);
    assert.equal(estimate.recoverableMonthlyUsd.available, false);
    assert.ok(estimate.costPerSuccessfulTask.reason.length > 20,
      "a withheld figure must carry the reason it was withheld");
    assert.match(estimateHeadline(estimate), /^Estimated · unavailable/);
  }
});

test("a missing provider mix substitutes the published default and drops the tier", () => {
  const declared = declaredFactFixture("bundled-example-enterprise-saas").facts;
  const without = estimateFromDeclaredFacts({ ...declared, providerMix: undefined });
  assert.equal(without.confidence.tier, CONFIDENCE_TIER.directional);
  assert.ok(without.notes.includes(ESTIMATE_NOTE.defaultMix));
  assert.deepEqual({ ...without.inputs.providerMix }, { ...DEFAULT_PROVIDER_MIX });
  assert.equal(without.inputs.providerMixDeclared, false);
  assert.equal(without.costPerSuccessfulTask.available, true,
    "a substituted mix lowers confidence; it does not remove the figure");

  // A mix whose shares do not sum to 1 is refused rather than renormalized: the
  // reader meant something this module cannot recover.
  const nonsense = estimateFromDeclaredFacts({
    ...declared, providerMix: { frontier: 0.5, standard: 0.5, economy: 0.5 },
  });
  assert.ok(nonsense.notes.includes(ESTIMATE_NOTE.defaultMix));
  assert.deepEqual({ ...nonsense.inputs.providerMix }, { ...DEFAULT_PROVIDER_MIX });
});

test("out-of-range declarations are clamped to the published range, never used as declared", () => {
  const estimate = estimateFromDeclaredFacts(declaredFactFixture("implausible-declarations").facts);
  assert.equal(estimate.inputs.monthlySpendUsd, PLAUSIBLE_MONTHLY_SPEND_USD.max);
  assert.equal(estimate.inputs.engineers, PLAUSIBLE_ENGINEER_HEADCOUNT.max);
  assert.equal(estimate.confidence.tier, CONFIDENCE_TIER.directional);
  const tiny = estimateFromDeclaredFacts({ ...EXAMPLE_DECLARED_FACTS, monthlySpendUsd: 12 });
  assert.equal(tiny.inputs.monthlySpendUsd, PLAUSIBLE_MONTHLY_SPEND_USD.min);
  assert.ok(tiny.notes.includes(ESTIMATE_NOTE.clampedSpend));
});

test("an unplaceable org keeps its figure and loses only the quartile", () => {
  for (const [facts, note] of [
    [{ sizeBand: null, industry: null }, ESTIMATE_NOTE.missingCohortAttributes],
    [{ sizeBand: "titanic", industry: PEER_INDUSTRY.saas }, ESTIMATE_NOTE.missingCohortAttributes],
    [{ sizeBand: ORG_SIZE_BAND.mid, industry: PEER_INDUSTRY.financialServices },
      ESTIMATE_NOTE.noMatchingCohort],
  ]) {
    const estimate = estimateFromDeclaredFacts({ ...EXAMPLE_DECLARED_FACTS, ...facts });
    assert.equal(estimate.costPerSuccessfulTask.available, true);
    assert.equal(estimate.quartile.available, false);
    assert.equal(estimate.recoverableMonthlyUsd.available, false,
      "a recoverable range with no cohort boundary behind it is a guess");
    assert.ok(estimate.notes.includes(note));
    assert.equal(estimate.confidence.tier, CONFIDENCE_TIER.directional);
  }
});

// --- provenance -------------------------------------------------------------

test("the estimator can only say 'estimated', on every figure and every path", () => {
  assert.deepEqual(Object.values(PROVENANCE), ["estimated"],
    "a second member is a second thing this module could claim to be");
  const paths = [
    ...DECLARED_FACT_FIXTURES.map((entry) => entry.facts),
    // Adversarial: facts that try to carry a provenance of their own.
    { ...EXAMPLE_DECLARED_FACTS, provenance: "verified" },
    { ...EXAMPLE_DECLARED_FACTS, costPerSuccessfulTask: { provenance: "verified", value: 1 } },
    { ...EXAMPLE_DECLARED_FACTS, confidence: { tier: "verified" }, trustState: "verified" },
    null, undefined, "verified", 42, [],
  ];
  for (const facts of paths) {
    const estimate = estimateFromDeclaredFacts(facts);
    const serialized = JSON.stringify(estimate);
    assert.equal(estimate.provenance, PROVENANCE.estimated);
    assert.ok(!serialized.includes("verified"),
      `an estimate emitted the word "verified" for ${serialized.slice(0, 80)}`);
    for (const figure of [
      estimate.costPerSuccessfulTask, estimate.quartile, estimate.recoverableMonthlyUsd,
    ]) {
      assert.equal(figure.provenance, PROVENANCE.estimated);
    }
    assert.ok(Object.isFrozen(estimate), "a result a caller can rewrite is not a provenance claim");
  }
  assert.equal(ESTIMATE_MARKER.provenance, PROVENANCE.estimated);
});

test("'verified' is reachable only from an imported basis whose coverage cleared the floor", () => {
  const covered = {
    state: "ok", headline: { coveragePercent: 96, attributedMinor: 100, totalMinor: 104 },
    findings: [],
  };
  assert.equal(composeTrust(covered, RESULT_BASIS.imported).state, TRUST_STATE.verified,
    "the only path to verified is an import that cleared the coverage floor");
  assert.equal(composeTrust(covered, RESULT_BASIS.synthetic).state, TRUST_STATE.synthetic,
    "bundled facts are synthetic however complete they are");
  assert.equal(composeTrust({ ...covered, headline: { coveragePercent: 12 } },
    RESULT_BASIS.imported).state, TRUST_STATE.belowFloor);
  // And the estimator is not on that path at all: it exports no basis, takes no
  // import, and its vocabulary has one member.
  assert.equal(Object.values(PROVENANCE).includes(TRUST_STATE.verified), false);
});

test("declared strings are matched against the published enumerations, never echoed", () => {
  const hostile = "<img src=x onerror=alert(1)>Software";
  const estimate = estimateFromDeclaredFacts({
    ...EXAMPLE_DECLARED_FACTS, industry: hostile, sizeBand: `${hostile} enterprise`,
  });
  const serialized = JSON.stringify(estimate);
  assert.ok(!serialized.includes("onerror"), "a declared string reached the result");
  assert.ok(!serialized.includes("<img"), "a declared string reached the result");
  assert.equal(estimate.inputs.industry, null);
  assert.equal(estimate.inputs.sizeBand, null);
  assert.equal(estimate.quartile.available, false);
  for (const line of estimate.workings) {
    assert.ok(!line.detail.includes("<"), "the working quoted a declared string");
  }
});

// --- the weights ------------------------------------------------------------

test("every coefficient states the assumption it encodes and who disputes it", async () => {
  const source = await readFile(MODULE, "utf8");
  const assumptions = source.match(/ASSUMPTION:/g) ?? [];
  assert.ok(assumptions.length >= 5,
    `only ${assumptions.length} coefficients state an assumption; the model has five`);
  assert.equal(assumptions.length, (source.match(/WHO DISPUTES IT:/g) ?? []).length,
    "an assumption nobody is named as disputing has not been stress-tested");
  // The named constants themselves, so a rename cannot silently drop one.
  assert.equal(TASKS_ATTEMPTED_PER_ENGINEER_MONTH, 49);
  assert.deepEqual({ ...PROVIDER_TIER_SUCCESS_RATE },
    { frontier: 0.86, standard: 0.78, economy: 0.62 });
  assert.deepEqual({ ...RECOVERABLE_SHARE_BAND }, { low: 0.25, high: 0.6 });
  const mixTotal = Object.values(DEFAULT_PROVIDER_MIX).reduce((sum, share) => sum + share, 0);
  assert.ok(Math.abs(mixTotal - 1) < 1e-9, "the default mix does not sum to one whole traffic");
});

test("the working reconstructs the figure by hand, in order", () => {
  const estimate = estimateFromDeclaredFacts(EXAMPLE_DECLARED_FACTS);
  assert.deepEqual(estimate.workings.map((line) => line.term), [
    "Inputs used", "Tasks attempted", "Tasks that succeed", "Cost per successful task",
    "Cohort basis", "Recoverable range",
  ]);
  const [, attempted, succeed, cost] = estimate.workings;
  assert.match(attempted.detail, /100 engineers at 49 attempted tasks each per month = 4,900/);
  assert.match(succeed.detail, /4,900 attempted at 79\.2% = 3,881 successful tasks/);
  assert.match(cost.detail, /\$154,500 ÷ 3,881 successful tasks = \$39\.81\./);
  assert.equal(Math.round(4900 * 0.792), 3881, "the printed rate must reproduce the denominator");
});

// --- the declared facts behind the bundled example --------------------------

test("the example's declared spend is the example dataset's own analyzed total", () => {
  assert.equal(EXAMPLE_DECLARED_FACTS.monthlySpendUsd, loadExampleDataset().spendUsd,
    "the estimate and the measured figures beside it must describe one company");
});

// --- the rendered spine -----------------------------------------------------

test("the estimate is authored on the page, subordinate, and marked estimated", () => {
  const document = parseHtml(html);
  const estimate = estimateFromDeclaredFacts(EXAMPLE_DECLARED_FACTS);
  const block = document.getElementById("finops-first-run-estimate");
  assert.ok(block, "the estimate spine is not on the page before any script runs");
  assert.equal(block.dataset.provenance, "estimated");

  const value = document.getElementById("finops-first-run-estimate-value");
  assert.equal(value.textContent, estimateHeadline(estimate),
    "the authored figure and the module's figure have drifted");
  assert.equal(document.getElementById("finops-first-run-estimate-detail").textContent,
    estimateDetail(estimate));
  assert.equal(document.getElementById("finops-first-run-estimate-heading").textContent,
    ESTIMATE_HEADING);
  // SUBORDINATE BY TYPE STEP: the estimate never takes the display weight the
  // derived figures own, so the two cannot be confused at a glance.
  assert.equal(value.className, "first-run-detail");
  assert.equal(document.getElementById("finops-first-run-peer-value").className,
    "first-run-value");

  const host = document.getElementById("finops-first-run-estimate-source");
  assert.equal(host.tagName.toLowerCase(), "details");
  assert.notEqual(host.open, true, "the working ships open");
  assert.equal(host.dataset.disclosure, "collapsed");
  assert.equal(host.dataset.source, "estimated");
  const summary = document.getElementById("finops-first-run-estimate-source-summary");
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  assert.equal(summary.getAttribute("aria-controls"), "finops-first-run-estimate-source-detail");
  // The claim about the marker is made on its attributes and its words, not on
  // a colour: dashed silhouette, warn tone, and the words that stand alone.
  const chip = document.getElementById("finops-first-run-estimate-marker");
  assert.equal(chip.dataset.provenance, "estimated");
  assert.equal(chip.dataset.silhouette, ESTIMATE_MARKER.silhouette);
  assert.equal(chip.dataset.tone, ESTIMATE_MARKER.tone);
  assert.ok(summary.textContent.includes(ESTIMATE_MARKER.label));
  // The value and the detail are OUTSIDE the disclosure: a reader meets the
  // figure without opening anything, and only the working is behind it.
  assert.equal(value.parentNode.id, "finops-first-run-estimate");
  assert.equal(document.getElementById("finops-first-run-estimate-source-detail")
    .querySelectorAll("dt").length, estimate.workings.length);
});

test("the view repaints the authored estimate with the same words", () => {
  const document = parseHtml(html);
  const painted = applyDeclaredFactEstimate(document);
  assert.equal(painted.provenance, "estimated");
  assert.equal(document.getElementById("finops-first-run-estimate-value").textContent,
    estimateHeadline(painted));
  assert.equal(document.getElementById("finops-first-run-estimate").dataset.tier,
    CONFIDENCE_TIER.modelled);
  assert.equal(document.getElementById("finops-first-run-estimate-source-detail")
    .querySelectorAll("dd").length, painted.workings.length);
  // A withheld estimate paints the absence rather than a stale figure.
  const withheld = applyDeclaredFactEstimate(document, { monthlySpendUsd: 0, engineers: 10 });
  assert.equal(withheld.confidence.tier, CONFIDENCE_TIER.insufficient);
  assert.equal(document.getElementById("finops-first-run-estimate-value").dataset.available,
    "false");
  assert.equal(document.getElementById("finops-first-run-estimate").dataset.tier,
    CONFIDENCE_TIER.insufficient);
});
