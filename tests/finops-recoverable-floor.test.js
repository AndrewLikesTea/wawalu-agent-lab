// The graded floor: the recoverable figure that survives the coverage caveat.
//
// The modelled recoverable figure is taken over ALL analyzed spend while the
// trust panel beside it admits how little of that spend the rubric scored. This
// file holds the smaller number that survives the admission — recoverable spend
// summed only from scored departments — to three things: it is filtered, it is
// never a zero when nothing was scored, and it never reads as a total.
//
// Nothing here recomputes a figure. Every expected sum is built from the same
// analysis envelope the module reads, so a fixture that moves under this file
// fails it rather than silently agreeing with a stale constant.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import {
  FLOOR_LABEL, FLOOR_PUBLISH_BAR, FLOOR_UNSCORED_REASON, RECOVERABLE_FLOOR_VERSION,
  STAND_DISCLOSURE, STAND_IDS,
  STAND_MOUNTED_DISCLOSURES, STAND_PENDING, buildStandHeadline, composeStandHeadline,
  gradedRecoverableFloor, standHeadlineForImport,
} from "../src/finops-stand.js";
import { applyStandHeadline, standDisclosureIds } from "../src/finops-stand-view.js";
import { loadExampleDataset } from "../src/example-dataset.js";
import { validateCohortAttribution } from "../src/cohort-attribution.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");
const byId = (document, id) => document.getElementById(id);
const shownText = (document, id) => textOf(byId(document, id));

const analysis = loadExampleDataset();
/** The ids the rubric scored, read off the envelope rather than typed here. */
const scoredIds = new Set(analysis.literacy.departments
  .filter((row) => row.gradeable === true).map((row) => row.departmentId));
const scoredRows = analysis.rankedDepartments.filter((row) => scoredIds.has(row.id));

/**
 * An analysis envelope shaped like the one an imported provider export produces,
 * generated here rather than committed. `scored` names the departments the
 * rubric graded; every other department is present, spends money, and is
 * deliberately outside the floor.
 */
function importedAnalysis({ scored = [], unscored = [] } = {}) {
  const all = [...scored, ...unscored];
  return {
    schemaVersion: "finops-analysis/test",
    period: "2026-06-01 to 2026-07-01",
    spendUsd: all.reduce((sum, row) => sum + row.spendUsd, 0),
    recoverableUsd: all.reduce((sum, row) => sum + row.recoverableUsd, 0),
    rankedDepartments: all.map(({ id, name, spendUsd, recoverableUsd }) => ({
      id, name, spendUsd, recoverableUsd,
    })),
    literacy: {
      departments: [
        ...scored.map((row) => ({
          departmentId: row.id, name: row.name, gradeable: true, score: row.score, reason: null,
          spend: { totalUsd: row.spendUsd },
        })),
        ...unscored.map((row) => ({
          departmentId: row.id, name: row.name, gradeable: false, score: null,
          reason: "no_sampled_queries", spend: { totalUsd: row.spendUsd },
        })),
      ],
      eligibility: null,
      missingInput: null,
    },
  };
}

// ---------------------------------------------------------------------------
// 1. The derivation.
// ---------------------------------------------------------------------------

test("the floor is summed from scored departments only, over the spend they carry", () => {
  const floor = gradedRecoverableFloor(analysis);
  assert.equal(floor.version, RECOVERABLE_FLOOR_VERSION);
  assert.equal(floor.scored, true);
  assert.equal(floor.reason, null);

  // The expected figures are summed from the envelope's own rows, so this holds
  // the module to the arithmetic rather than to a number somebody typed.
  const expectedFloor = Math.round(
    scoredRows.reduce((sum, row) => sum + row.recoverableUsd, 0));
  const expectedSpend = Math.round(scoredRows.reduce((sum, row) => sum + row.spendUsd, 0));
  assert.equal(floor.floorUsd, expectedFloor);
  assert.equal(floor.scoredSpendUsd, expectedSpend);

  // …and it is genuinely SMALLER than the modelled figure over a genuinely
  // smaller base. A floor equal to the modelled figure would mean the filter
  // never ran.
  assert.ok(floor.floorUsd < analysis.recoverableUsd,
    "the floor is not below the modelled recoverable figure, so nothing was filtered out");
  assert.ok(floor.scoredSpendUsd < analysis.spendUsd);

  // Every contribution, in the ranked order the envelope published, and nothing
  // the rubric did not score.
  assert.deepEqual(floor.contributions.map((row) => row.id), scoredRows.map((row) => row.id));
  for (const row of floor.contributions) {
    assert.ok(scoredIds.has(row.id), `${row.name} is in the floor but the rubric did not score it`);
    assert.equal(typeof row.name, "string");
    assert.ok(Number.isFinite(row.score));
    assert.ok(Number.isFinite(row.recoverableUsd));
    assert.ok(Number.isFinite(row.spendUsd));
  }
  const ungraded = analysis.rankedDepartments.filter((row) => !scoredIds.has(row.id));
  assert.ok(ungraded.length > 0, "the bundled example must carry an ungraded department to exclude");
  for (const row of ungraded) {
    assert.equal(floor.contributions.some((entry) => entry.id === row.id), false,
      `${row.name} carries no rubric score and must contribute nothing to the floor`);
  }
});

test("nothing scored returns a stated state, never a floor of zero", () => {
  // Two ways to have nothing: no departments at all, and departments the rubric
  // has not reached. Both are facts about the rubric, so both are stated.
  const empty = gradedRecoverableFloor({ rankedDepartments: [], literacy: { departments: [] } });
  assert.equal(empty.scored, false);
  assert.equal(empty.floorUsd, null, "a zero here would read as $0 recoverable");
  assert.equal(empty.scoredSpendUsd, null);
  assert.deepEqual(empty.contributions, []);
  assert.equal(empty.reason, FLOOR_UNSCORED_REASON.noDepartments);

  const none = gradedRecoverableFloor(importedAnalysis({
    unscored: [{ id: "d1", name: "Support", spendUsd: 4000, recoverableUsd: 900 }],
  }));
  assert.equal(none.scored, false);
  assert.equal(none.floorUsd, null);
  assert.equal(none.reason, FLOOR_UNSCORED_REASON.noneScored);
  assert.match(none.reason, /not a recoverable floor of \$0/);

  // A malformed or absent analysis resolves to the same stated state rather
  // than throwing: the figure beside it stays on the screen either way.
  for (const input of [null, undefined, {}, { rankedDepartments: "nope" }]) {
    assert.equal(gradedRecoverableFloor(input).scored, false);
    assert.equal(gradedRecoverableFloor(input).floorUsd, null);
  }
});

// ---------------------------------------------------------------------------
// 2. The two figures, and the bases they name.
// ---------------------------------------------------------------------------

test("both figures name their own base and the floor is never called a total", () => {
  const headline = buildStandHeadline();
  const floor = headline.recoverableFloor;
  assert.equal(floor.available, true);
  assert.equal(floor.label, FLOOR_LABEL);

  // The floor states the SCORED amount it is taken over…
  const scoredSpend = floor.floor.scoredSpendUsd.toLocaleString("en-US");
  assert.match(floor.value, new RegExp(`\\$${scoredSpend}`),
    "the floor does not name the scored spend it is taken over");
  // …and the modelled figure states the FULL in-scope amount, unchanged.
  assert.match(headline.recoverable.basis,
    new RegExp(`\\$${headline.recoverable.basis.match(/of (\$[\d,]+) analyzed/)?.[1].slice(1)}`));
  assert.match(headline.recoverable.basis, /of \$[\d,]+ analyzed/);

  // The floor is a floor in words, in both the value line and the basis. "Total"
  // is the one word it may not be labelled with.
  assert.match(floor.label, /floor/i);
  assert.match(floor.basis, /not a total/i);
  assert.equal(/\btotal\b/i.test(floor.value), false,
    `the floor's value line reads as a total: "${floor.value}"`);
  // And it says out loud that the figure beside it answers over a different base.
  assert.match(floor.basis, /the full analyzed spend/);
});

test("the empty floor renders a stated sentence, not a blank, a dash, or $0", () => {
  const document = parseHtml(html);
  applyStandHeadline(document, composeStandHeadline({
    analysis: importedAnalysis({
      unscored: [{ id: "d1", name: "Support", spendUsd: 4000, recoverableUsd: 900 }],
    }),
    source: "import",
  }));
  const value = shownText(document, STAND_IDS.floorValue);
  const basis = shownText(document, STAND_IDS.floorBasis);
  assert.equal(value, STAND_PENDING.floor);
  assert.match(value, /scored/i);
  assert.ok(value.trim().length > 0 && basis.trim().length > 0);
  // No figure is printed in the figure's place: not a zero, not a dash.
  assert.equal(/\$/.test(value), false, `the empty floor printed a dollar figure: "${value}"`);
  assert.equal(/—/.test(value) || /—/.test(basis), false, "the empty floor printed an em dash");
  assert.equal(basis, FLOOR_UNSCORED_REASON.noneScored);
  // The basis names $0 exactly once, to refuse it. That refusal is the point.
  assert.match(basis, /Nothing scored is not a recoverable floor of \$0\.$/);
  // The state is in the attribute channel too, beside the sentence.
  assert.equal(byId(document, STAND_IDS.floorValue).dataset.available, "false");
});

test("the document authors the floor's label with the same words the module publishes", () => {
  // One string, two files. The shipped markup is what a reader whose script
  // failed meets, so the label there cannot drift from the one composed above it.
  const document = parseHtml(html);
  const labels = [...document.querySelectorAll(".stand-figure-label")].map((node) => textOf(node));
  assert.ok(labels.includes(FLOOR_LABEL),
    `the document authors no "${FLOOR_LABEL}" label beside the modelled figure`);
  // Both figures are in the same figure group, so neither is a card of its own.
  const region = byId(document, STAND_IDS.region);
  const order = [...region.querySelectorAll("[id]")].map((node) => node.id);
  assert.ok(order.indexOf(STAND_IDS.recoverableValue) > -1);
  assert.ok(order.indexOf(STAND_IDS.floorValue) > order.indexOf(STAND_IDS.recoverableValue),
    "the floor is read after the modelled figure it qualifies, not before it");
  assert.ok(order.indexOf(STAND_IDS.floorValue) < order.indexOf(STAND_IDS.positionValue),
    "the floor belongs beside the recoverable figure, not after the peer position");
});

// ---------------------------------------------------------------------------
// 3. The disclosure: the floor's arithmetic, one row per scored department.
// ---------------------------------------------------------------------------

test("the disclosure lists every scored department and the sum they make", () => {
  const document = parseHtml(html);
  const headline = buildStandHeadline();
  applyStandHeadline(document, headline);

  const ids = standDisclosureIds(STAND_DISCLOSURE.floor);
  const details = byId(document, ids.details);
  assert.ok(details, "the floor disclosure was never mounted");
  // Built to the same shape an authored disclosure ships in — the structure a
  // reader interacts with, asserted rather than inferred from its text, because
  // the harness reads through a closed details element.
  assert.equal(details.tagName.toLowerCase(), "details");
  assert.equal(details.dataset.disclosure, "collapsed");
  assert.equal(details.dataset.mounted, "true");
  assert.ok(STAND_MOUNTED_DISCLOSURES.includes(STAND_DISCLOSURE.floor));
  const summary = byId(document, ids.summary);
  assert.equal(summary.tagName.toLowerCase(), "summary");
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  assert.equal(summary.getAttribute("aria-controls"), ids.list);
  assert.equal(textOf(byId(document, ids.heading)), "How the graded floor was computed");
  // One step from the headline: no disclosure ancestor above this one.
  let node = details.parentNode;
  while (node && node !== byId(document, STAND_IDS.region)) {
    assert.notEqual(node.tagName?.toLowerCase(), "details",
      "the floor disclosure is nested inside another, so it is two interactions away");
    node = node.parentNode;
  }

  // One row per scored department, plus the sum. Counted on the list, so a row
  // silently dropped fails here rather than reading as a smaller floor.
  const list = byId(document, ids.list);
  assert.equal(list.querySelectorAll("dt").length, scoredRows.length + 1);
  const rows = headline.disclosures.find((item) => item.id === STAND_DISCLOSURE.floor).entries;
  for (const department of scoredRows) {
    const row = rows.find((item) => item.term.startsWith(department.name));
    assert.ok(row, `${department.name} was scored but is not in the floor's working`);
    // Rounded to whole dollars, as every printed amount on this page is: the
    // envelope carries half-dollar recoverable figures and the working shows
    // what a reader sees, not the unrounded term behind it.
    assert.match(row.detail,
      new RegExp(`\\$${Math.round(department.recoverableUsd).toLocaleString("en-US")}`));
  }
  const sum = rows.at(-1);
  assert.equal(sum.term, "Sum");
  assert.match(sum.detail,
    new RegExp(`= \\$${headline.recoverableFloor.floor.floorUsd.toLocaleString("en-US")},`));
  // The ungraded departments are named nowhere in this working, by construction.
  for (const department of analysis.rankedDepartments.filter((row) => !scoredIds.has(row.id))) {
    assert.equal(rows.some((row) => row.term.startsWith(department.name)), false,
      `${department.name} carries no score and must not appear in the floor's arithmetic`);
  }
});

// ---------------------------------------------------------------------------
// 4. Import parity: one composition, two sources.
// ---------------------------------------------------------------------------

test("an imported export recomputes both figures from its own envelope", () => {
  // There is no second wiring: `composeStandHeadline` computes the floor beside
  // the modelled figure, and the imported path runs through that same composer.
  // So this drives one document from the bundled state into an imported one and
  // reads both figures off the same nodes, before and after.
  const document = parseHtml(html);
  applyStandHeadline(document, buildStandHeadline());
  const bundled = {
    modelled: shownText(document, STAND_IDS.recoverableValue),
    floor: shownText(document, STAND_IDS.floorValue),
  };

  const imported = importedAnalysis({
    scored: [
      { id: "u-alpha", name: "Alpha", spendUsd: 40000, recoverableUsd: 9000, score: 61 },
      { id: "u-beta", name: "Beta", spendUsd: 10000, recoverableUsd: 2500, score: 77 },
    ],
    unscored: [{ id: "u-gamma", name: "Gamma", spendUsd: 50000, recoverableUsd: 20000 }],
  });
  const eligibility = validateCohortAttribution({
    rows: [{ department_key: "alpha", cost: "10" }],
  });
  const headline = standHeadlineForImport({ analysis: imported, eligibility });
  applyStandHeadline(document, headline);

  // Both figures moved, and both moved to the reader's own arithmetic.
  assert.equal(headline.source, "import");
  assert.equal(headline.recoverableFloor.floor.floorUsd, 11500);
  assert.equal(headline.recoverableFloor.floor.scoredSpendUsd, 50000);
  assert.deepEqual(headline.recoverableFloor.floor.contributions.map((row) => row.name),
    ["Alpha", "Beta"]);
  assert.match(shownText(document, STAND_IDS.recoverableValue), /\$31,500/);
  assert.match(shownText(document, STAND_IDS.floorValue), /\$11,500/);
  assert.match(shownText(document, STAND_IDS.floorValue), /\$50,000/);
  assert.notEqual(shownText(document, STAND_IDS.recoverableValue), bundled.modelled);
  assert.notEqual(shownText(document, STAND_IDS.floorValue), bundled.floor);
  assert.equal(byId(document, STAND_IDS.floorValue).dataset.available, "true");

  // …and the imported figures carry the same provenance marker the region
  // applies to every figure in it, so neither is read as the bundled example.
  assert.equal(byId(document, STAND_IDS.region).dataset.source, "import");

  // The floor's working is recomputed with them, not left on the bundled rows.
  const rows = headline.disclosures.find((item) => item.id === STAND_DISCLOSURE.floor).entries;
  assert.deepEqual(rows.map((row) => row.term),
    ["Alpha · rubric score 61", "Beta · rubric score 77", "Sum"]);
});

// ---------------------------------------------------------------------------
// 5. Reproducibility (#1482). The figure is a literal, the contributing set is a
//    literal, and neither moves when the rows arrive in a different order.
// ---------------------------------------------------------------------------

/**
 * The flagship figure, written out rather than re-summed.
 *
 * Every other assertion in this file derives its expectation from the envelope,
 * which proves the module agrees with itself. This one does not: it is the
 * number a reader is shown, typed here, so that a fixture edit that moves the
 * published figure has to be acknowledged in this file rather than absorbed by
 * an expectation that moved with it.
 */
const FLAGSHIP_FLOOR = Object.freeze({
  floorUsd: 48_829,
  scoredSpendUsd: 143_500,
  totalSpendUsd: 154_500,
  coveragePercent: 93,
  barPercent: 50,
  departmentIds: Object.freeze([
    "psn_example_unit_atlas0",
    "psn_example_unit_boreal",
    "psn_example_unit_cinder",
    "psn_example_unit_quartz",
  ]),
});

/**
 * The same envelope with every ordered input reversed.
 *
 * Reversing both the ranked departments and the rubric's own rows is the whole
 * point: a sum that depended on load order, and a contributing set that
 * depended on iteration order, would both move here and nowhere else.
 */
function reversedAnalysis(source) {
  return {
    ...source,
    rankedDepartments: [...source.rankedDepartments].reverse(),
    literacy: { ...source.literacy, departments: [...source.literacy.departments].reverse() },
  };
}

test("the flagship floor is the published figure, over the published set, at the published coverage", () => {
  const floor = gradedRecoverableFloor(analysis);
  assert.equal(floor.scored, true);
  assert.equal(floor.publishable, true, "the flagship example no longer clears the publishing bar");
  assert.equal(floor.floorUsd, FLAGSHIP_FLOOR.floorUsd);
  assert.equal(floor.scoredSpendUsd, FLAGSHIP_FLOOR.scoredSpendUsd);
  assert.equal(floor.totalSpendUsd, FLAGSHIP_FLOOR.totalSpendUsd);
  assert.equal(floor.coveragePercent, FLAGSHIP_FLOOR.coveragePercent);
  assert.equal(floor.barPercent, FLAGSHIP_FLOOR.barPercent);
  // The set, exactly: an extra contributor and a missing one both fail here.
  assert.deepEqual([...floor.departmentIds], [...FLAGSHIP_FLOOR.departmentIds]);
  // Sorted, and sorted by the stable key rather than by whatever order they
  // arrived in — so the set is a set, not a rendering of one traversal.
  assert.deepEqual([...floor.departmentIds], [...floor.departmentIds].sort());
  // Coverage clears the bar the page publishes at, and the two are the same
  // published number rather than one typed here.
  assert.ok(floor.coverage >= floor.bar);
  assert.equal(floor.bar, FLOOR_PUBLISH_BAR);
});

test("the floor is identical when the fixture rows are permuted", () => {
  const natural = gradedRecoverableFloor(analysis);
  const permuted = gradedRecoverableFloor(reversedAnalysis(analysis));

  // The figure, byte for byte, and the set it derives from — not merely the
  // same call twice on the same input, which would prove only that the function
  // is a function.
  assert.equal(permuted.floorUsd, natural.floorUsd);
  assert.equal(permuted.floorUsd, FLAGSHIP_FLOOR.floorUsd);
  assert.equal(permuted.scoredSpendUsd, natural.scoredSpendUsd);
  assert.equal(permuted.coveragePercent, natural.coveragePercent);
  assert.deepEqual([...permuted.departmentIds], [...natural.departmentIds]);

  // The permutation really did change the input, so the equality above is a
  // result rather than an accident of the two arrays being the same array.
  assert.notDeepEqual(
    reversedAnalysis(analysis).rankedDepartments.map((row) => row.id),
    analysis.rankedDepartments.map((row) => row.id));
  // …and it changed the DISPLAY order, which is allowed to follow the envelope.
  assert.notDeepEqual(permuted.contributions.map((row) => row.id),
    natural.contributions.map((row) => row.id));
  // The rendered value line is the same string either way, which is what a
  // reader would compare between two runs.
  assert.equal(
    composeStandHeadline({ analysis: reversedAnalysis(analysis) }).recoverableFloor.value,
    composeStandHeadline({ analysis }).recoverableFloor.value);
});

// ---------------------------------------------------------------------------
// 6. Non-retroactivity. These scores were published before #1482 widened the
//    sample; this test exists to prove a rubric or fixture edit cannot move a
//    score that has already been shown to the department it grades. A change
//    that moves one of these numbers is not necessarily wrong — it is a change
//    that has to be argued for in review rather than absorbed silently.
// ---------------------------------------------------------------------------

/** Read off the fixture output before the sample was widened, and pinned since. */
const SCORES_BEFORE_1482 = Object.freeze({
  psn_example_unit_cinder: 54,
  psn_example_unit_quartz: 74,
  psn_example_unit_boreal: 82,
});

test("widening the scored sample did not move an already-published score", () => {
  const scores = new Map(analysis.literacy.departments
    .filter((row) => row.gradeable === true).map((row) => [row.departmentId, row.score]));
  for (const [id, score] of Object.entries(SCORES_BEFORE_1482)) {
    assert.equal(scores.get(id), score,
      `${id} was published at ${score} before the sample was widened and now scores `
      + `${scores.get(id)}; a rubric change must not be retroactive`);
  }
  // The floor quotes the same numbers it filtered on, so a score that moved in
  // one place and not the other fails here too.
  const floor = gradedRecoverableFloor(analysis);
  for (const row of floor.contributions) {
    if (row.id in SCORES_BEFORE_1482) assert.equal(row.score, SCORES_BEFORE_1482[row.id]);
  }
  // The newly scored department is genuinely new, and genuinely scored.
  const added = floor.contributions.find((row) => !(row.id in SCORES_BEFORE_1482));
  assert.ok(added, "#1482 added no newly scored department to the floor");
  assert.ok(Number.isFinite(added.score));
});

test("every contributing department carries its dimensions, its marks, and a written rationale", () => {
  const floor = gradedRecoverableFloor(analysis);
  for (const row of floor.contributions) {
    // The rubric's own axes, all of them, with the weight each carries.
    assert.deepEqual(row.subscores.map((axis) => axis.key), ["intent", "efficiency", "modelFit"]);
    assert.deepEqual(row.subscores.map((axis) => axis.weightPercent), [50, 30, 20]);
    for (const axis of row.subscores) assert.ok(Number.isFinite(axis.score));
    // …and a sentence, not a bare number: the score, the dimensions behind it,
    // and the mix it was taken over.
    assert.match(row.rationale, new RegExp(`Scored ${row.score} of 100`));
    assert.match(row.rationale, /Dimensions: Intent \d+ \(weight 50%\)/);
    assert.match(row.rationale, /Mix behind it: /);
  }
  // The rationale reaches the page, beside the row it explains.
  const entries = buildStandHeadline().disclosures
    .find((item) => item.id === STAND_DISCLOSURE.floor).entries;
  assert.match(entries[0].detail, /Scored \d+ of 100 on rubric literacy-mix\/1\.0\.0/);
  // The sum states the coverage it was computed at, in the same row.
  assert.match(entries.at(-1).detail, new RegExp(`${FLAGSHIP_FLOOR.coveragePercent}% of the `));
});

// ---------------------------------------------------------------------------
// 7. Below the bar: the shortfall, never a number dressed up as a graded one.
// ---------------------------------------------------------------------------

test("below the publishing bar the slot states the shortfall and prints no currency", () => {
  // A quarter of the spend scored — departments were graded, so an amount does
  // exist; it is simply not one this page will publish under a graded label.
  const belowBar = importedAnalysis({
    scored: [{ id: "u-alpha", name: "Alpha", spendUsd: 25000, recoverableUsd: 9000, score: 61 }],
    unscored: [
      { id: "u-gamma", name: "Gamma", spendUsd: 50000, recoverableUsd: 20000 },
      { id: "u-delta", name: "Delta", spendUsd: 25000, recoverableUsd: 5000 },
    ],
  });
  const floor = gradedRecoverableFloor(belowBar);
  assert.equal(floor.scored, true, "the fixture must actually score a department");
  assert.equal(floor.publishable, false);
  assert.equal(floor.coveragePercent, 25);
  assert.ok(floor.coverage < floor.bar);

  const document = parseHtml(html);
  applyStandHeadline(document, composeStandHeadline({ analysis: belowBar, source: "import" }));
  const value = shownText(document, STAND_IDS.floorValue);
  const basis = shownText(document, STAND_IDS.floorBasis);

  // Never empty. The slot always says something.
  assert.ok(value.trim().length > 0 && basis.trim().length > 0);
  // The shortfall, in both directions: where coverage is, and where the bar is.
  assert.match(value, /25% of analyzed spend is scored/);
  assert.match(value, /under the 50% bar/);
  assert.match(basis, /published only once the rubric has scored 50%/);
  // …and what would clear it, by name.
  assert.match(basis, /Score Gamma, Delta to clear it\./);

  // NO CURRENCY. Not the withheld floor, not the scored spend, not a zero. A
  // dollar figure under a "Graded floor" label is read as graded whatever the
  // sentence beside it says, which is the entire reason this branch exists.
  assert.equal(/\$/.test(value), false, `the below-bar slot printed currency: "${value}"`);
  assert.equal(/\$/.test(basis), false, `the below-bar basis printed currency: "${basis}"`);
  assert.equal(byId(document, STAND_IDS.floorValue).dataset.available, "false");

  // The arithmetic is withheld from the headline, not destroyed: the working is
  // still one interaction away, which is what keeps this a stated refusal
  // rather than a missing figure.
  const rows = composeStandHeadline({ analysis: belowBar, source: "import" })
    .disclosures.find((item) => item.id === STAND_DISCLOSURE.floor).entries;
  assert.equal(rows.at(-1).term, "Sum");
  assert.match(rows.at(-1).detail, /\$9,000/);
});
