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
  FLOOR_LABEL, FLOOR_UNSCORED_REASON, RECOVERABLE_FLOOR_VERSION, STAND_DISCLOSURE, STAND_IDS,
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
    assert.match(row.detail, new RegExp(`\\$${department.recoverableUsd.toLocaleString("en-US")}`));
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
