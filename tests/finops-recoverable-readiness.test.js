// One tier, one metric, and the invariant the "every dollar" sentence rests on.
//
// WHAT THESE ASSERTIONS ARE FOR (#1480).
//
//   * ONE TIER REACHES THE DOM. The word beside the money and the word in the
//     readiness line are the same string because they are the same string, not
//     because two functions agree. The render half of that is asserted at the
//     bottom of this file, against the shipped document, at two different tiers
//     so a re-hard-coded chip fails rather than passes by luck — and once more
//     over the REGION AS PAINTED, with the bundled example analysis in hand and
//     every one of the region's painters run, which is the exact contradiction
//     the first attempt at this was rejected for.
//   * THE METRIC IS COMPUTED, NOT ASSERTED OF. `eligibleSharePct` is checked
//     against hand-worked numerators and denominators, including the case where
//     one line fails two gates at once.
//   * `state === "complete"` IS `eligibleSharePct === 100`. Both directions,
//     including the rounding case that would otherwise print 100 over a
//     department nobody graded.
//   * THE DENOMINATOR IS THE PUBLISHED TOTAL. So the invariant that the ranked
//     lines sum to it is asserted over the bundled dataset rather than assumed —
//     and residual spend is a blocker in its own right, so the "every dollar"
//     sentence cannot ship if the invariant ever breaks. An analysis whose rows
//     do not sum to its total is run through the real adapter to prove it.
//   * THE LITERACY JOIN IS PINNED IN BOTH DIRECTIONS.
//     `literacy.departments[].departmentId` and `rankedDepartments[].id` are two
//     key spaces. A divergence would collapse the metric to zero silently, which
//     looks exactly like a real coverage failure, so a graded department is
//     asserted to read scored AND an ungraded one to read unscored.
//
// Harness notes: no descendant selectors, no `querySelectorAll("*")`, and no
// assertion on a harness element itself — counts, attributes and text only.
//
// No clock, no network, no sleeps.

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import { UNATTRIBUTED_KEY } from "../src/attribution-units.js";
import {
  BLOCKER_ORDER, INSUFFICIENT_RUNG, NEXT_ACTION_SENTENCE, READINESS_STATE,
  RECOVERABLE_READINESS_CONTRACT, RESIDUAL_EPSILON_USD, SHARE_CEILING_PCT, TIER_WORDS,
  finopsReadinessSignals, readinessSentence, resolveRecoverableReadiness, usd,
} from "../src/finops-recoverable-readiness.js";
import {
  BUNDLED_RATE_CARD_CONFIDENCE, confidenceFor, rateCardMarker,
} from "../src/finops-rate-card-contract.js";
import { RATE_CARD_IDS, applyRateCardLadder, readinessFor } from "../src/finops-rate-card-view.js";
import { analysisDateOf, scorePricingProvenance } from "../src/finops-pricing-provenance.js";
import {
  PRICING_PROVENANCE_IDS, applyPricingProvenance,
} from "../src/finops-pricing-provenance-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const doc = () => parseHtml(html);

/** A ranked line, eligible unless a gate is switched off. */
const line = (id, spendUsd, gates = {}) => ({
  id, spendUsd, attributed: true, scored: true, priced: true, ...gates,
});

/** Signals over a set of lines, with the published total defaulting to their sum. */
const signalsFor = (lines, total = null, verdict = BUNDLED_RATE_CARD_CONFIDENCE) => ({
  verdict,
  totalSpendUsd: total ?? lines.reduce((sum, entry) => sum + entry.spendUsd, 0),
  lines,
});

/** A card with every one of the four inputs declared: the ladder's top rung. */
const fullyDeclaredCard = () => ({
  contractVersion: "finops-rate-card/1.0.0",
  cardId: "declared",
  source: "contracted",
  models: [
    {
      model: "premium-text", label: "the premium text tier", source: "contracted",
      contractedInputRate: 18, contractedOutputRate: 18, currency: "USD",
      effectiveDate: "2026-01-01", committedUseDiscountPct: 10, permitted: true,
    },
    {
      model: "standard-text", label: "the standard text tier", source: "contracted",
      contractedInputRate: 12, contractedOutputRate: 12, currency: "USD",
      effectiveDate: "2026-01-01", committedUseDiscountPct: 10, permitted: true,
    },
  ],
});

const TOP_RUNG = confidenceFor(fullyDeclaredCard(), { asOf: "2026-08-09" });

// ---------------------------------------------------------------------------
// 1. Coverage not yet known is not coverage failed.
// ---------------------------------------------------------------------------

test("with no analysis the contract publishes the rate card's own rung, verbatim", () => {
  const read = resolveRecoverableReadiness(null);
  assert.equal(read.contract, RECOVERABLE_READINESS_CONTRACT);
  assert.equal(read.state, READINESS_STATE.unknown);
  assert.equal(read.marker, rateCardMarker(BUNDLED_RATE_CARD_CONFIDENCE));
  assert.equal(read.eligibleSharePct, null);
  assert.equal(read.blockers.length, 0);
  // And the sentence says which question it is answering, rather than implying
  // a coverage verdict nobody has computed.
  assert.match(readinessSentence(read), /grades the rate card only; coverage is graded/);
});

// ---------------------------------------------------------------------------
// 2. The metric, computed against hand-worked arithmetic.
// ---------------------------------------------------------------------------

test("eligibleSharePct is eligible spend over the published total, to one decimal", () => {
  // 300 of 1,000 fails a gate: 700/1000 = 70.0%.
  const read = resolveRecoverableReadiness(signalsFor([
    line("platform", 700),
    line("research", 300, { scored: false }),
  ]));
  assert.equal(read.eligibleSharePct, 70);
  assert.equal(read.eligibleSpendUsd, 700);
  assert.equal(read.totalSpendUsd, 1000);
  assert.equal(read.state, READINESS_STATE.partial);
});

test("a line failing two gates is counted against each and never twice against the share", () => {
  const read = resolveRecoverableReadiness(signalsFor([
    line("platform", 900),
    line(UNATTRIBUTED_KEY, 100, { attributed: false, scored: false }),
  ]));
  // One line, 100 dollars, withheld once: 900/1000.
  assert.equal(read.eligibleSharePct, 90);
  const codes = read.blockers.map((blocker) => blocker.code);
  assert.deepEqual(codes, ["unattributed-spend", "unscored-departments"]);
  for (const blocker of read.blockers) assert.equal(blocker.spendUsd, 100);
});

test("blockers are ordered by the published order, whatever order the lines arrive in", () => {
  const read = resolveRecoverableReadiness(signalsFor([
    line("a", 100, { priced: false }),
    line("b", 100, { scored: false }),
    line("c", 100, { attributed: false }),
    line("d", 100),
  ]));
  const codes = read.blockers.map((blocker) => blocker.code);
  assert.deepEqual(codes,
    BLOCKER_ORDER.filter((code) => codes.includes(code)),
    "blockers are not in the contract's published order");
  // And the one next action is the first of them, not a second opinion.
  assert.equal(read.nextAction, read.blockers[0].sentence);
});

// ---------------------------------------------------------------------------
// 3. `complete` is `100%`, in both directions.
// ---------------------------------------------------------------------------

test("state complete and a 100% share are the same claim", () => {
  const complete = resolveRecoverableReadiness(signalsFor([line("a", 500), line("b", 500)]));
  assert.equal(complete.state, READINESS_STATE.complete);
  assert.equal(complete.eligibleSharePct, 100);
  assert.equal(complete.blockers.length, 0);

  // The rounding case: 99.996% would print 100.0 without the clamp, over a
  // department nobody graded. It prints the ceiling instead, and stays partial.
  const nearly = resolveRecoverableReadiness(signalsFor([
    line("a", 999_960), line("b", 40, { scored: false }),
  ]));
  assert.equal(nearly.state, READINESS_STATE.partial);
  assert.equal(nearly.eligibleSharePct, SHARE_CEILING_PCT);
  assert.notEqual(nearly.eligibleSharePct, 100);
});

test("an export with no spend is insufficient and says so, rather than vacuously complete", () => {
  const read = resolveRecoverableReadiness(signalsFor([], 0));
  assert.equal(read.state, READINESS_STATE.empty);
  assert.equal(read.tier, INSUFFICIENT_RUNG.tier);
  assert.equal(read.eligibleSharePct, 0);
  assert.deepEqual(read.blockers.map((blocker) => blocker.code), ["no-spend"]);
});

// ---------------------------------------------------------------------------
// 4. The "every dollar" sentence, and what it may not ship on.
// ---------------------------------------------------------------------------

test("the every-dollar sentence needs complete coverage AND a fully declared card", () => {
  const lines = [line("a", 500), line("b", 500)];
  // Complete coverage, list prices: the ask is the rate card's, not "nothing".
  const listPriced = resolveRecoverableReadiness(signalsFor(lines));
  assert.equal(listPriced.state, READINESS_STATE.complete);
  assert.notEqual(listPriced.nextAction, NEXT_ACTION_SENTENCE);
  assert.match(listPriced.nextAction, /State contracted input and output rates/);

  // Both gates passed: nothing further, and only then.
  const declared = resolveRecoverableReadiness(signalsFor(lines, null, TOP_RUNG));
  assert.equal(declared.nextAction, NEXT_ACTION_SENTENCE);
  assert.equal(declared.marker, "Declared");

  // Top rung, incomplete coverage: the figure is Insufficient and the sentence
  // is unreachable, because the claim it makes is about every dollar.
  const partial = resolveRecoverableReadiness(signalsFor([
    line("a", 500), line("b", 500, { scored: false }),
  ], null, TOP_RUNG));
  assert.equal(partial.marker, INSUFFICIENT_RUNG.marker);
  assert.notEqual(partial.nextAction, NEXT_ACTION_SENTENCE);
});

test("residual spend blocks complete, so the sentence cannot ship on an unproven sum", () => {
  // The lines sum to 900; the published total is 1,000. The 100 nobody
  // represents is a blocker of its own and complete is unreachable — even on the
  // top rung, where every other gate has passed.
  const read = resolveRecoverableReadiness(signalsFor([line("a", 900)], 1000, TOP_RUNG));
  assert.equal(read.state, READINESS_STATE.partial);
  assert.equal(read.marker, INSUFFICIENT_RUNG.marker);
  assert.notEqual(read.nextAction, NEXT_ACTION_SENTENCE);
  assert.ok(read.eligibleSharePct < 100,
    "a share below 100 was published beside a state that claims completeness");
  const residual = read.blockers.find((blocker) => blocker.code === "residual-spend");
  assert.equal(residual.spendUsd, 100);
  assert.match(residual.sentence, /represented by no department line at all/);
  assert.equal(read.nextAction, residual.sentence);
  // …and a difference inside the stated epsilon is arithmetic, not a missing row.
  const rounded = resolveRecoverableReadiness(
    signalsFor([line("a", 1000 - RESIDUAL_EPSILON_USD)], 1000));
  assert.equal(rounded.state, READINESS_STATE.complete);
});

test("an ANALYSIS whose ranked rows do not sum to its total never says every dollar", () => {
  // THE SAME PROPERTY THROUGH THE REAL ADAPTER, not through hand-built signals.
  // This is the shape the page hands the contract: an analysis record. Every
  // ranked row here is named, graded and priced, and the card is on the top
  // rung, so every gate the module checks over the LINES passes. The only thing
  // wrong is that the rows account for 900 of a published 1,000 — which is
  // exactly the case the "every dollar" sentence would otherwise be published
  // over while `eligibleSharePct` sat under 100.
  const analysis = {
    spendUsd: 1000,
    modelRouting: { rateCardConfidence: TOP_RUNG },
    literacy: { available: true, departments: [{ departmentId: "platform" }] },
    rankedDepartments: [{ id: "platform", spendUsd: 900, downRouting: { recoverableUsd: 10 } }],
  };
  const read = resolveRecoverableReadiness(finopsReadinessSignals(analysis));

  assert.notEqual(read.state, READINESS_STATE.complete,
    "unrepresented spend left the contract claiming complete coverage");
  assert.notEqual(read.nextAction, NEXT_ACTION_SENTENCE);
  assert.doesNotMatch(read.nextAction, /Every dollar of exported spend/,
    "the every-dollar sentence was published over spend no ranked row represents");
  assert.ok(read.eligibleSharePct < 100,
    `a ${read.eligibleSharePct}% share was published beside a state claiming completeness`);
  // …and the sentence the page actually paints does not imply it either.
  assert.doesNotMatch(readinessSentence(read), /nothing is outstanding/);
  assert.equal(read.blockers.at(-1).code, "residual-spend");

  // The control: the same analysis with the missing 100 restored IS complete,
  // so the assertions above fail on the residual and not on something else.
  const whole = resolveRecoverableReadiness(finopsReadinessSignals({
    ...analysis,
    rankedDepartments: [{ id: "platform", spendUsd: 1000, downRouting: { recoverableUsd: 10 } }],
  }));
  assert.equal(whole.state, READINESS_STATE.complete);
  assert.equal(whole.nextAction, NEXT_ACTION_SENTENCE);
});

// ---------------------------------------------------------------------------
// 5. One currency formatter.
// ---------------------------------------------------------------------------

test("every sentence quoting dollars formats them the same way", () => {
  assert.equal(usd(1234.4), "$1,234");
  assert.equal(usd(1234.6), "$1,235");
  const read = resolveRecoverableReadiness(signalsFor([
    line("a", 1_000_000), line("b", 12_345.67, { scored: false }),
  ]));
  const blocker = read.blockers[0];
  assert.match(blocker.sentence, new RegExp(usd(blocker.spendUsd).replace("$", "\\$")),
    "a blocker sentence formats money with a formatter of its own");
});

// ---------------------------------------------------------------------------
// 6. The adapter, against the real analysis shape.
// ---------------------------------------------------------------------------

test("the adapter reads the analysis's own keys, and pins the literacy join", async () => {
  const { loadExampleDataset } = await import("../src/example-dataset.js");
  const analysis = loadExampleDataset();

  const signals = finopsReadinessSignals(analysis);
  assert.equal(signals.lines.length, analysis.rankedDepartments.length,
    "a ranked line went missing between the analysis and the contract");

  // THE INVARIANT THE DENOMINATOR RESTS ON. The lines sum to the published
  // total, to the cent — so `eligibleSharePct` is a share of the spend the page
  // quotes and not of a subset of it. Asserted, because the "every dollar"
  // sentence is only honest if this holds.
  const summed = signals.lines.reduce((sum, entry) => sum + entry.spendUsd, 0);
  assert.ok(Math.abs(summed - analysis.spendUsd) <= RESIDUAL_EPSILON_USD,
    `the ranked lines sum to ${summed} against a published total of ${analysis.spendUsd}`);

  // THE JOIN, BOTH WAYS. Literacy entries are keyed on departmentId and lines on
  // id. If those key spaces ever diverge every line reads unscored and the
  // metric collapses to zero, which is indistinguishable from a real coverage
  // failure; if `scored` were ever wired to a constant the metric would never
  // fall at all. So a department the record grades must read scored, and the
  // same department with its literacy entry withdrawn must read unscored.
  assert.equal(analysis.literacy.available, true,
    "the example dataset no longer carries a graded query sample");
  assert.ok(signals.lines.some((entry) => entry.scored === true),
    "no ranked line reads scored: the literacy join has diverged from the ranked-line ids");
  const graded = analysis.literacy.departments[0].departmentId;
  assert.equal(signals.lines.find((entry) => entry.id === graded)?.scored, true,
    `the literacy-graded department ${graded} does not read scored on its ranked line`);

  const withoutOne = finopsReadinessSignals({
    ...analysis,
    literacy: {
      ...analysis.literacy,
      departments: analysis.literacy.departments
        .filter((entry) => entry.departmentId !== graded),
    },
  });
  assert.equal(withoutOne.lines.find((entry) => entry.id === graded)?.scored, false,
    `${graded} reads scored with no literacy entry: scored is not read from the join`);
  for (const entry of withoutOne.lines) {
    if (entry.id !== graded) {
      assert.equal(entry.scored, true, `${entry.id} lost its score when another was withdrawn`);
    }
  }

  // And every line is priced, because every line went through the rate card.
  assert.equal(signals.lines.filter((entry) => entry.priced).length, signals.lines.length);
});

// ---------------------------------------------------------------------------
// 7. THE ANTI-CONTRADICTION PROPERTY, on the shipped document.
// ---------------------------------------------------------------------------

/** The tier word a rendered string carries, or null. The closed set, in one place. */
const tierWordIn = (text) => TIER_WORDS.find((word) => String(text).includes(word)) ?? null;

test("the marker beside the money and the readiness line carry the SAME tier word", () => {
  for (const analysis of [null, {
    // A second case, at a different tier: complete coverage on a declared card,
    // so the contract resolves above insufficient and the marker cannot be a
    // hard-coded constant and still pass both halves of this test.
    spendUsd: 1000,
    modelRouting: { rateCardConfidence: TOP_RUNG },
    literacy: { available: true, departments: [{ departmentId: "platform" }] },
    rankedDepartments: [{ id: "platform", spendUsd: 1000, downRouting: { recoverableUsd: 10 } }],
  }]) {
    const document = doc();
    applyRateCardLadder(document, analysis?.modelRouting?.rateCardConfidence, analysis);
    const contract = readinessFor(analysis?.modelRouting?.rateCardConfidence, analysis);

    const marker = textOf(document.getElementById(RATE_CARD_IDS.marker)).trim();
    const readiness = textOf(document.getElementById(RATE_CARD_IDS.readiness)).trim();
    assert.equal(marker, contract.marker,
      "the marker chip states a tier the contract did not resolve");
    assert.equal(tierWordIn(readiness), contract.marker,
      "the readiness line states a tier the contract did not resolve");
    assert.equal(tierWordIn(marker), tierWordIn(readiness),
      "the figure and the readiness line disagree about the same number");
  }
});

test("the bundled example, painted through every one of the region's painters, states ONE tier",
  async () => {
    // THE REJECTION, REPRODUCED AS AN ASSERTION. The first attempt at #1480 left
    // the marker chip resolving one tier while the readiness line directly below
    // it resolved another over the same number: a lead read "Illustrative" in the
    // figure paragraph and "… Insufficient." one press away. This paints the
    // shipped document with the BUNDLED EXAMPLE ANALYSIS — the state a reader
    // reaches by pressing "Try the bundled example" — through every painter the
    // answer region runs, and holds the whole region to one tier.
    const { loadExampleDataset } = await import("../src/example-dataset.js");
    const analysis = loadExampleDataset();
    const document = doc();
    const verdict = analysis?.modelRouting?.rateCardConfidence;
    applyRateCardLadder(document, verdict, analysis);
    applyPricingProvenance(document, scorePricingProvenance({
      card: analysis?.rateCard ?? null, asOf: analysisDateOf(analysis?.period ?? null),
    }));
    const contract = readinessFor(verdict, analysis);

    const marker = textOf(document.getElementById(RATE_CARD_IDS.marker)).trim();
    const readiness = textOf(document.getElementById(RATE_CARD_IDS.readiness)).trim();
    // NOT "each is individually well-formed" — the same string, both places.
    assert.equal(marker, contract.marker);
    assert.equal(tierWordIn(readiness), marker,
      `the figure says "${marker}" and the readiness line says `
      + `"${tierWordIn(readiness)}" about the same number`);

    // THE SECOND RUBRIC STATES NO TIER. The pricing-provenance chip and its one
    // sentence answer a different question — whose prices these are — on a
    // disjoint vocabulary out of 100. Keeping it beside this tier is only safe
    // while it stays wordless about trust, so that is asserted rather than
    // assumed: if it ever grew a tier word it would be a second answer to the
    // question the contract owns, and this fails.
    for (const id of [PRICING_PROVENANCE_IDS.score, PRICING_PROVENANCE_IDS.reason]) {
      assert.equal(tierWordIn(textOf(document.getElementById(id))), null,
        `#${id} states a tier the readiness contract did not resolve`);
    }

    // And the region carries no OTHER tier claim about the present figure: every
    // slot in it that names a tier names the resolved one. `contract-next` is
    // exempt from equality because a next action legitimately names the rung the
    // figure would MOVE TO — but only when the resolved tier is not the blocker
    // set, which is asserted above by `nextAction` being a blocker's sentence.
    for (const id of [RATE_CARD_IDS.marker, RATE_CARD_IDS.readiness, RATE_CARD_IDS.hedge]) {
      const word = tierWordIn(textOf(document.getElementById(id)));
      if (word !== null) {
        assert.equal(word, contract.marker, `#${id} states a tier the contract did not resolve`);
      }
    }
  });

test("the default bundled render states Illustrative in both places, in full", () => {
  // THE SHIPPED DEFAULT STATE, WORD FOR WORD, before any analysis is asked for.
  // Both exact strings are pinned, so either one drifting fails here.
  const document = doc();
  applyRateCardLadder(document);
  assert.equal(textOf(document.getElementById(RATE_CARD_IDS.marker)).trim(), "Illustrative");
  assert.equal(textOf(document.getElementById(RATE_CARD_IDS.readiness)).trim(),
    "Readiness: Illustrative. This grades the rate card only; coverage is graded once an "
    + "export of your own is analyzed.");
});

test("the two cases actually land on different tiers, so the pin has teeth", () => {
  const unknown = readinessFor();
  const declared = readinessFor(TOP_RUNG, {
    spendUsd: 1000,
    literacy: { available: true, departments: [{ departmentId: "platform" }] },
    rankedDepartments: [{ id: "platform", spendUsd: 1000, downRouting: {} }],
  });
  assert.equal(unknown.marker, "Illustrative");
  assert.equal(declared.marker, "Declared");
  assert.notEqual(unknown.marker, declared.marker);
});

test("no module in src/ derives a tier word outside the readiness contract", async () => {
  // STRUCTURAL, not stylistic, and over ALL of src/ rather than the one view —
  // the header of finops-recoverable-readiness.js claims exactly this property,
  // and a comment asserting a property the code does not have is what the first
  // attempt at #1480 was called out for. `rateCardMarker`, `rateCardHedge` and
  // `rateCardNextStep` are the three functions that can produce a tier word;
  // reintroducing one anywhere but the contract fails here, by file and name.
  const root = new URL("../src/", import.meta.url);
  const files = (await readdir(root)).filter((name) => name.endsWith(".js"));
  const owner = "finops-recoverable-readiness.js";
  const producer = "finops-rate-card-contract.js";
  let callers = 0;
  for (const name of files) {
    const source = await readFile(new URL(name, root), "utf8");
    const body = source.split("\n").filter((row) => !row.trimStart().startsWith("//")).join("\n");
    for (const forbidden of ["rateCardMarker", "rateCardHedge", "rateCardNextStep"]) {
      if (!body.includes(forbidden)) continue;
      assert.ok(name === owner || name === producer,
        `src/${name} calls ${forbidden}; a tier word must come through the contract`);
      if (name === owner) callers += 1;
    }
  }
  assert.equal(callers, 3, "the readiness contract stopped calling the ladder it grades");

  // …and the paint hard-codes none of the three words itself.
  const view = await readFile(new URL("finops-rate-card-view.js", root), "utf8");
  const body = view.split("\n").filter((row) => !row.trimStart().startsWith("//")).join("\n");
  for (const tier of TIER_WORDS) {
    assert.ok(!body.includes(`"${tier}"`), `the paint hard-codes the tier word ${tier}`);
  }
});

test("the served markup authors no tier word for the render to contradict", () => {
  // The other half of the same property: a hand-kept "Illustrative" in the
  // source would be a second answer that survives the day the inputs change.
  const document = doc();
  for (const id of [RATE_CARD_IDS.marker, RATE_CARD_IDS.nextStep, RATE_CARD_IDS.readiness]) {
    assert.equal(tierWordIn(textOf(document.getElementById(id))), null,
      `#${id} authors a tier word the contract owns`);
  }
});
