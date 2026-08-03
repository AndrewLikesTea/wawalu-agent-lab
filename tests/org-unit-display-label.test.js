// The display-label layer over the pseudonymous org-unit identity (#1007).
//
// These hold the properties the layer exists for: one resolver, keyed on the
// identity rather than on a rank, clearing restores the pseudonym, and naming a
// unit never reaches the imported data. The currency helper is here too because
// "+$34,500" and "Platform Engineering" are the same sentence's two halves.

import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

import {
  parseHtml, pressEnter, pressTab, tabSequence, textOf, typeText,
} from "./support/browser.js";
import {
  ORG_UNIT_LABEL_FIELD_LIMIT, applyFirstRunResult, applyFirstRunSupersession,
  orgUnitLabelFieldId,
} from "../src/finops-first-run-view.js";
import { buildFirstRunResult, FIRST_RUN_IDS } from "../src/finops-first-run.js";
import {
  MAX_ORG_UNIT_DISPLAY_LABEL, NO_ORG_UNIT_LABELS,
  hasOrgUnitDisplayLabel, orgUnitDisplayName, withOrgUnitDisplayLabel,
} from "../src/org-unit-display-label.js";
import { formatSignedUsd } from "../src/evolution.js";
import { importedDepartmentDrilldown } from "../src/finops-imported-departments.js";
import { importedHeadline } from "../src/finops-imported-headline.js";
import { leadingFinding } from "../src/finops-leading-finding.js";

const ATLAS = "psn_example_unit_atlas0";
const BOREAL = "psn_example_unit_boreal";

test("a unit with no label renders the pseudonym the analysis carried", () => {
  assert.equal(orgUnitDisplayName(NO_ORG_UNIT_LABELS, ATLAS, "Department …atlas0"),
    "Department …atlas0");
  assert.equal(orgUnitDisplayName(null, ATLAS, "Department …atlas0"), "Department …atlas0");
  assert.equal(hasOrgUnitDisplayLabel(NO_ORG_UNIT_LABELS, ATLAS), false);
});

test("a label a reader supplied is what renders", () => {
  const labels = withOrgUnitDisplayLabel(NO_ORG_UNIT_LABELS, ATLAS, "Platform Engineering");
  assert.equal(orgUnitDisplayName(labels, ATLAS, "Department …atlas0"), "Platform Engineering");
  assert.equal(hasOrgUnitDisplayLabel(labels, ATLAS), true);
});

test("whitespace is trimmed, and a whitespace-only label is no label at all", () => {
  const padded = withOrgUnitDisplayLabel(NO_ORG_UNIT_LABELS, ATLAS, "  Platform Engineering  ");
  assert.equal(orgUnitDisplayName(padded, ATLAS, "Department …atlas0"), "Platform Engineering");
  const blank = withOrgUnitDisplayLabel(NO_ORG_UNIT_LABELS, ATLAS, "   \t \n ");
  assert.equal(orgUnitDisplayName(blank, ATLAS, "Department …atlas0"), "Department …atlas0",
    "a field of spaces is an empty field, not a name made of spaces");
  assert.equal(hasOrgUnitDisplayLabel(blank, ATLAS), false);
});

test("an over-long label is refused rather than truncated into a different name", () => {
  const long = "x".repeat(MAX_ORG_UNIT_DISPLAY_LABEL + 1);
  const labels = withOrgUnitDisplayLabel(NO_ORG_UNIT_LABELS, ATLAS, long);
  assert.equal(orgUnitDisplayName(labels, ATLAS, "Department …atlas0"), "Department …atlas0");
});

test("clearing a label restores the pseudonym and leaves the other units alone", () => {
  const named = withOrgUnitDisplayLabel(
    withOrgUnitDisplayLabel(NO_ORG_UNIT_LABELS, ATLAS, "Platform Engineering"),
    BOREAL, "Research");
  const cleared = withOrgUnitDisplayLabel(named, ATLAS, "");
  assert.equal(orgUnitDisplayName(cleared, ATLAS, "Department …atlas0"), "Department …atlas0");
  assert.equal(orgUnitDisplayName(cleared, BOREAL, "Department …boreal"), "Research");
  // Pure: the map that was handed in still says what it said.
  assert.equal(orgUnitDisplayName(named, ATLAS, "Department …atlas0"), "Platform Engineering");
});

// --- the label is bound to the identity ------------------------------------

const department = (id, name, spendUsd, recoverableUsd) => ({
  id, name, unit: { id, label: name, source: "provider-group" }, spendUsd, recoverableUsd,
});

const envelope = (departments) => ({
  currency: "USD",
  rankedDepartments: departments,
  history: { periods: [], currentPeriod: "2026-06-01 to 2026-07-01" },
});

test("a label stays on its unit when the ranking is re-sorted underneath it", () => {
  const labels = withOrgUnitDisplayLabel(NO_ORG_UNIT_LABELS, ATLAS, "Platform Engineering");
  const rows = (departments) => importedDepartmentDrilldown(envelope(departments), { labels })
    .rows.map((row) => [row.unitId, row.name]);
  // Same two units, opposite input order, and then the amounts swapped so the
  // RANK itself moves. The name follows the id in every one of them.
  const forward = rows([
    department(ATLAS, "Department …atlas0", 100_000, 30_000),
    department(BOREAL, "Department …boreal", 50_000, 10_000),
  ]);
  const reversed = rows([
    department(BOREAL, "Department …boreal", 50_000, 10_000),
    department(ATLAS, "Department …atlas0", 100_000, 30_000),
  ]);
  assert.deepEqual(forward, reversed, "input order does not move a name");
  assert.deepEqual(forward[0], [ATLAS, "Platform Engineering"]);
  const outranked = rows([
    department(ATLAS, "Department …atlas0", 100_000, 5_000),
    department(BOREAL, "Department …boreal", 50_000, 40_000),
  ]);
  assert.deepEqual(outranked, [
    [BOREAL, "Department …boreal"],
    [ATLAS, "Platform Engineering"],
  ], "the label rode the identity down the ranking, not the first row");
});

test("naming a unit does not discard or mutate the imported analysis", () => {
  const departments = [
    department(ATLAS, "Department …atlas0", 100_000, 30_000),
    department(BOREAL, "Department …boreal", 50_000, 10_000),
  ];
  const analysis = envelope(departments);
  const before = JSON.stringify(analysis);
  const labels = withOrgUnitDisplayLabel(NO_ORG_UNIT_LABELS, ATLAS, "Platform Engineering");
  const named = importedDepartmentDrilldown(analysis, { labels });
  const bare = importedDepartmentDrilldown(analysis);
  assert.equal(JSON.stringify(analysis), before, "the envelope is read, never written");
  assert.equal(named.count, bare.count, "no row was dropped by naming one of them");
  assert.deepEqual(named.rows.map((row) => row.recoverableUsd),
    bare.rows.map((row) => row.recoverableUsd), "every figure survived the rename");
  assert.deepEqual(named.rows.map((row) => row.pseudonym),
    bare.rows.map((row) => row.name), "the pseudonym is still carried under the label");
});

test("the headline and the drill-down name the unit the same way", () => {
  const analysis = envelope([
    department(ATLAS, "Department …atlas0", 100_000, 30_000),
    department(BOREAL, "Department …boreal", 50_000, 10_000),
  ]);
  const labels = withOrgUnitDisplayLabel(NO_ORG_UNIT_LABELS, ATLAS, "Platform Engineering");
  const slot = importedHeadline(analysis, { labels })
    .slots.find((entry) => entry.id === "top_department");
  assert.equal(slot.value, "Platform Engineering");
  assert.equal(importedDepartmentDrilldown(analysis, { labels }).rows[0].name,
    "Platform Engineering");
  // And the money beside the named unit is rendered currency, not a raw float.
  assert.match(slot.detail, /^\$30,000 recoverable, /);
});

// --- the driver sentence ----------------------------------------------------

const period = (start, end, spendUsd) => ({
  period: `${start} to ${end}`, spendUsd, recoverableUsd: 0, completeness: "complete",
});

const movement = (labels) => leadingFinding({
  currency: "USD",
  action: "",
  rankedDepartments: [
    { ...department(ATLAS, "Department …atlas0", 100_000, 30_000), deltaUsd: 34_500 },
  ],
  history: {
    state: "available",
    currentPeriod: "2026-06-01 to 2026-07-01",
    periods: [period("2026-05-01", "2026-06-01", 100_000), period("2026-06-01", "2026-07-01", 134_500)],
    departments: [{ id: ATLAS, name: "Department …atlas0", deltaUsd: 34_500, spendUsd: 100_000 }],
  },
}, { labels });

test("the driver sentence names the reader's unit and formats the money", () => {
  const named = movement(withOrgUnitDisplayLabel(NO_ORG_UNIT_LABELS, ATLAS, "Platform Engineering"));
  assert.match(named.driverSentence, /^Platform Engineering contributed \+\$[\d,]+ of the /);
  assert.doesNotMatch(named.driverSentence, /atlas0/, "the pseudonym is replaced, not appended");
  assert.doesNotMatch(named.driverSentence, /\d\.\d\d USD/, "no raw float reaches the sentence");
  // Unnamed, the same envelope reads exactly as it does today apart from the money.
  const bare = movement(NO_ORG_UNIT_LABELS);
  assert.match(bare.driverSentence, /^Department …atlas0 contributed \+\$[\d,]+ of the /);
  // The model is untouched: same numbers, whatever the sentence calls the unit.
  assert.equal(named.driver.deltaUsd, bare.driver.deltaUsd);
  assert.equal(named.changeUsd, bare.changeUsd);
  assert.equal(named.changeUsd, 34_500);
});

// --- the field, on the shipped page ----------------------------------------
//
// The harness models no layout, so `textOf` reads straight through a collapsed
// details element. "The field is present" is therefore NOT evidence that it is
// reachable — every assertion below is on the tab sequence, on the accessible
// name a `label for` composes, and on what the commit actually did.

const PAGE = new URL("../src/evolution.html", import.meta.url);

const unit = (id, name, spendUsd, recoverableUsd) => ({
  id, name, spendUsd, recoverableUsd,
  unit: { key: `provider-group:${id}`, label: name, source: "provider-group" },
});

const SIX_UNITS = [
  unit(ATLAS, "Department …atlas0", 100_000, 30_000),
  unit(BOREAL, "Department …boreal", 90_000, 25_000),
  unit("psn_c", "Department …cirrus", 80_000, 20_000),
  unit("psn_d", "Department …delta0", 70_000, 15_000),
  unit("psn_e", "Department …echo00", 60_000, 10_000),
  unit("psn_f", "Department …fresco", 50_000, 5_000),
];

/**
 * The page's own wiring, in miniature: one label map in local state, repainted
 * from the SAME envelope every time. This is what evolution-page.js does.
 */
async function labelledRegion(analysis) {
  const document = parseHtml(await readFile(PAGE, "utf8"));
  applyFirstRunResult(document, buildFirstRunResult());
  let labels = NO_ORG_UNIT_LABELS;
  const paint = () => applyFirstRunSupersession(document, true, {
    ownData: importedDepartmentDrilldown(analysis, { labels }),
    onOrgUnitLabel: (unitId, label) => {
      labels = withOrgUnitDisplayLabel(labels, unitId, label);
      paint();
    },
  });
  paint();
  return { document, labels: () => labels };
}

const envelopeOf = (departments) => ({
  schemaVersion: "local-finops/1.0.0",
  currency: "USD",
  rankedDepartments: departments,
  history: { periods: [], currentPeriod: "2026-06-01 to 2026-07-01" },
});

test("the top five units get a named, keyboard-reachable field and the sixth does not", async () => {
  const { document } = await labelledRegion(envelopeOf(SIX_UNITS));
  const fields = document.querySelectorAll(".first-run-unit-label-input");
  assert.equal(fields.length, ORG_UNIT_LABEL_FIELD_LIMIT,
    "five fields for six ranked units — the limit is the contract, not a coincidence");

  // Each field has a real accessible name that says WHICH unit, because five
  // fields called "Name" are five fields a screen-reader user cannot tell apart.
  for (const [index, field] of fields.entries()) {
    const id = orgUnitLabelFieldId(index + 1);
    assert.equal(field.getAttribute("id"), id);
    const name = document.querySelector(`label[for="${id}"]`);
    assert.equal(textOf(name), `Your name for ${SIX_UNITS[index].name}`);
    assert.equal(field.dataset.unitId, SIX_UNITS[index].id,
      "the field is bound to the identity, not to its position in the list");
  }

  // Reachable, in reading order, and each one paired with its own Save. The
  // harness reads through a closed disclosure, so this — not the text — is the
  // evidence that a keyboard reader can get to them.
  const sequence = tabSequence(document).map((node) => node.getAttribute("id") ?? "");
  const ranks = [1, 2, 3, 4, 5].map((rank) => sequence.indexOf(orgUnitLabelFieldId(rank)));
  assert.equal(ranks.some((position) => position < 0), false, "every field is in the tab order");
  assert.deepEqual(ranks.slice().sort((left, right) => left - right), ranks,
    "the fields tab in rank order");
  assert.equal(document.querySelectorAll(".first-run-unit-label-save").length,
    ORG_UNIT_LABEL_FIELD_LIMIT);
});

test("Enter in the field renames the unit everywhere and keeps the reader's place", async () => {
  const { document, labels } = await labelledRegion(envelopeOf(SIX_UNITS));
  const first = document.getElementById(orgUnitLabelFieldId(1));
  first.focus();
  assert.equal(document.activeElement, first, "the field takes focus");
  typeText(document, "Platform Engineering");
  // Tab to the Save beside it and press Enter on that. Nothing in this view
  // intercepts a key — the native button is what answers Enter and Space.
  pressTab(document);
  assert.equal(document.activeElement?.className, "first-run-unit-label-save",
    "Save is the next stop after the field it belongs to");
  pressEnter(document);

  assert.equal(labels()[ATLAS], "Platform Engineering");
  // Renamed in the row, and the field the reader was standing in still has the
  // ring: the commit repainted the list out from under them.
  assert.match(textOf(document.getElementById(FIRST_RUN_IDS.methodList)),
    /1\. Platform Engineering/);
  assert.equal(document.activeElement?.getAttribute("id"), orgUnitLabelFieldId(1));
  // And it names one unit, not two: rank 2 is untouched.
  assert.match(textOf(document.getElementById(FIRST_RUN_IDS.methodList)),
    /2\. Department …boreal/);
});

test("clearing the field restores the pseudonym and keeps every ranked row", async () => {
  const { document, labels } = await labelledRegion(envelopeOf(SIX_UNITS));
  const rows = () => document.getElementById(FIRST_RUN_IDS.methodList).querySelectorAll("dt").length;
  const before = rows();
  document.getElementById(orgUnitLabelFieldId(1)).focus();
  typeText(document, "Platform Engineering");
  pressTab(document);
  pressEnter(document);
  assert.equal(rows(), before, "naming a unit did not add or drop a row");

  const named = document.getElementById(orgUnitLabelFieldId(1));
  assert.equal(named.value, "Platform Engineering", "the field shows the name that is rendering");
  named.focus();
  // Selected the name and typed spaces over it, which is how a reader clears a
  // field they have already filled.
  named.value = "   ";
  pressTab(document);
  pressEnter(document);

  assert.equal(ATLAS in labels(), false, "a field of spaces cleared the entry outright");
  assert.match(textOf(document.getElementById(FIRST_RUN_IDS.methodList)),
    /1\. Department …atlas0/);
  assert.equal(rows(), before, "the import survived the clear intact");
});

test("formatSignedUsd keeps the copy's own sign convention", () => {
  assert.equal(formatSignedUsd(34_500), "+$34,500");
  assert.equal(formatSignedUsd(34_499.62), "+$34,500");
  assert.equal(formatSignedUsd(-120), "−$120");
  assert.equal(formatSignedUsd(0), "$0");
  assert.equal(formatSignedUsd(Number.NaN), "$0", "no reader ever reads NaN");
  assert.equal(formatSignedUsd(Number.POSITIVE_INFINITY), "$0");
});
