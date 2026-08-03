// Naming a reader's own org units from the export they dropped (#1023).
//
// What is pinned here is the derivation CONTRACT, not an object shape:
//
//   1. The recognized fields are a closed, ordered, versioned list. An unlisted
//      column is never a name source, and the precedence is asserted against
//      `LABEL_SOURCE_FIELDS` itself rather than against a list retyped here, so
//      a field added tomorrow is covered on the day it lands.
//   2. Every imperfect-data rule in the contract comment is exercised against a
//      fixture that actually carries the defect: a billing-only export with tag
//      labels and no project column, an export with no labels at all, one whose
//      rows disagree about a unit, and one where only some units are labelled.
//   3. Reader-typed names win. The page merges the derived map UNDER the
//      reader's own, and the merged map is what the one resolver reads.
//   4. The page says which COLUMN the names came from, in the shipped markup,
//      outside any fold — and a unit the export could not name is marked beside
//      its identifier rather than being silently indistinguishable.
//
// Fixtures are built in-test, in the CSV bytes a real export carries, and read
// through the real delimited reader — nothing about the column-matching rule is
// simulated. Assertions are on counts, attributes and text content: the harness
// reads text through a collapsed disclosure and its selects accept unlisted
// values, so visibility is never the subject of an assertion here.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHtml, textOf } from "./support/browser.js";
import { readDelimitedText } from "../src/delimited-text.js";
import { detectShape, normalizeHeader } from "../src/finops-tabular-import.js";
import { orgUnitPseudonym } from "../src/unit-pseudonym.js";
import { orgUnitDisplayName } from "../src/org-unit-display-label.js";
import {
  LABEL_DERIVATION_CONTRACT_VERSION, LABEL_DERIVATION_PRECEDENCE, LABEL_SOURCE_FIELDS,
  MAX_DERIVED_UNIT_NAME, NO_DERIVED_UNIT_NAMES, deriveOrgUnitNames, mergeOrgUnitNamings,
} from "../src/finops-export-unit-names.js";
import { applyImportedHeadline } from "../src/finops-imported-headline-view.js";
import { importedDepartmentDrilldown } from "../src/finops-imported-departments.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");

// --- fixtures ---------------------------------------------------------------
//
// Each one is the bytes of a small export, read by the real delimited reader and
// bound to its org-unit column the way the page binds it.

/** Read CSV bytes into the `{ columns, rows, unitColumn }` the derivation takes. */
function readExport(csv, { unitColumn = null } = {}) {
  const reading = readDelimitedText(csv);
  assert.equal(reading.ok, true, "the fixture must be readable by the shipped reader");
  const header = reading.header;
  const index = detectShape(header).bound?.orgUnit;
  return {
    columns: header,
    rows: reading.rows.map((row) => Object.fromEntries(
      header.map((name, position) => [name, row.values?.[position] ?? ""]))),
    unitColumn: unitColumn ?? (Number.isInteger(index) ? header[index] : null),
  };
}

/**
 * A billing export with NO project column: the unit is a cost-centre code and
 * the only readable words in the file are in a `tag:team` column.
 */
const BILLING_WITH_TAGS = [
  "lineItem/UsageStartDate,resourceTags/user:CostCenter,lineItem/ProductCode,lineItem/UnblendedCost,tag:team",
  "2026-06-01,cc-4471,AmazonBedrock,120.00,Platform Engineering",
  "2026-06-02,cc-4471,AmazonBedrock,80.00,Platform Engineering",
  "2026-06-01,cc-9902,AmazonBedrock,45.00,Customer Support",
  "",
].join("\n");

/** The same shape with nothing readable in it: codes all the way down. */
const BILLING_WITHOUT_LABELS = [
  "lineItem/UsageStartDate,lineItem/ResourceId,lineItem/ProductCode,lineItem/UnblendedCost",
  "2026-06-01,i-0aa1,AmazonBedrock,120.00",
  "2026-06-02,i-0bb2,AmazonBedrock,45.00",
  "",
].join("\n");

/** One unit, three rows, two spellings of its project — and one blank cell. */
const CONFLICTING_PROJECT = [
  "usage_date,cost_center,project_name,model,amount",
  "2026-06-01,cc-4471,Platform Engineering,gpt-4o,120.00",
  "2026-06-02,cc-4471,Platform Eng,gpt-4o,80.00",
  "2026-06-03,cc-4471,Platform Engineering,gpt-4o,60.00",
  "2026-06-04,cc-4471,   ,gpt-4o,10.00",
  "",
].join("\n");

/** Two units, one project column, and only one of them fills it in. */
const PARTIAL_COVERAGE = [
  "usage_date,unit_code,project_name,model,amount",
  "2026-06-01,cc-4471,Platform Engineering,gpt-4o,120.00",
  "2026-06-02,cc-9902,,gpt-4o,45.00",
  "",
].join("\n");

// --- 1. the contract itself -------------------------------------------------

test("the recognized fields are a closed, ordered, versioned list", () => {
  assert.equal(LABEL_DERIVATION_CONTRACT_VERSION, 1,
    "changing the recognized-field set or its order is a version bump");
  assert.deepEqual(LABEL_SOURCE_FIELDS.map((field) => field.id),
    ["project", "tag", "description", "cost_center"],
    "precedence is project, then tags, then description, then cost centre");
  assert.deepEqual(LABEL_DERIVATION_PRECEDENCE, LABEL_SOURCE_FIELDS.map((field) => field.label),
    "the precedence the page prints is the one the derivation applies");
  for (const field of LABEL_SOURCE_FIELDS) {
    for (const alias of field.aliases) {
      assert.equal(normalizeHeader(alias), alias,
        `"${alias}" must already be in the parser's normalized header form`);
    }
  }
});

test("an unlisted column is never a name source, however name-like it reads", () => {
  const naming = deriveOrgUnitNames(readExport([
    "usage_date,cost_center,owner_full_name,model,amount",
    "2026-06-01,cc-4471,Dana Okafor,gpt-4o,120.00",
    "",
  ].join("\n"), { unitColumn: "cost_center" }));
  // `cost_center` is itself a recognized field, so the unit is named from its
  // own column — and `owner_full_name` is read by nothing at all.
  assert.equal(naming.derivedCount, 1);
  assert.deepEqual(naming.sources, ["cost_center"]);
});

test("separator style and case do not change which column is read", () => {
  const names = ["project_name", "Project Name", "project-name"].map((header) => {
    const naming = deriveOrgUnitNames(readExport([
      `usage_date,unit_code,${header},model,amount`,
      "2026-06-01,cc-4471,Platform Engineering,gpt-4o,120.00",
      "",
    ].join("\n"), { unitColumn: "unit_code" }));
    return naming.names[orgUnitPseudonym("cc-4471")];
  });
  assert.deepEqual(names, ["Platform Engineering", "Platform Engineering", "Platform Engineering"]);
});

// --- 2. imperfect data ------------------------------------------------------

test("a billing-only export with tag labels names its units from the tag column", () => {
  const naming = deriveOrgUnitNames(readExport(BILLING_WITH_TAGS));
  assert.equal(naming.available, true);
  assert.equal(naming.unitCount, 2);
  assert.equal(naming.derivedCount, 2);
  assert.equal(naming.names[orgUnitPseudonym("cc-4471")], "Platform Engineering");
  assert.equal(naming.names[orgUnitPseudonym("cc-9902")], "Customer Support");
  assert.deepEqual(naming.sources, ["tag:team"],
    "an export with no project column is named from its tags, and says so");
  assert.match(naming.statement, /“tag:team” column \(2 units\)/);
});

test("a tags map column is read down to its first pair, not printed raw", () => {
  const naming = deriveOrgUnitNames(readExport([
    "usage_date,unit_code,tags,model,amount",
    "2026-06-01,cc-4471,team=Platform Engineering;env=prod,gpt-4o,120.00",
    "",
  ].join("\n"), { unitColumn: "unit_code" }));
  assert.equal(naming.names[orgUnitPseudonym("cc-4471")], "Platform Engineering");
});

test("an export with no labels at all leaves every unit opaque and says so", () => {
  const reading = readDelimitedText(BILLING_WITHOUT_LABELS);
  const naming = deriveOrgUnitNames({
    columns: reading.header,
    rows: reading.rows.map((row) => Object.fromEntries(
      reading.header.map((name, index) => [name, row.values?.[index] ?? ""]))),
    unitColumn: "lineItem/ResourceId",
  });
  assert.equal(naming.available, true, "the derivation ran; it simply found nothing");
  assert.equal(naming.unitCount, 2);
  assert.equal(naming.derivedCount, 0);
  assert.deepEqual(naming.names, {});
  assert.deepEqual(naming.units.map((unit) => unit.name), [null, null],
    "an underivable unit is null, never a blank string and never a placeholder");
  assert.match(naming.statement, /keeps the identifier the export used/);
});

test("rows that disagree about one unit resolve to the value on the most rows", () => {
  const naming = deriveOrgUnitNames(readExport(CONFLICTING_PROJECT, { unitColumn: "cost_center" }));
  const unitId = orgUnitPseudonym("cc-4471");
  assert.equal(naming.unitCount, 1);
  assert.equal(naming.names[unitId], "Platform Engineering", "two rows beat one");
  assert.equal(naming.byUnit[unitId].conflicted, true, "the disagreement is surfaced, not hidden");
  assert.equal(naming.conflictedCount, 1);
  assert.match(naming.statement, /had rows that disagreed/);
});

test("the resolution does not depend on the order the rows arrive in", () => {
  const lines = CONFLICTING_PROJECT.trim().split("\n");
  const header = lines[0];
  const body = lines.slice(1);
  const orders = [body, [...body].reverse(), [body[1], body[3], body[0], body[2]]];
  const resolved = orders.map((rows) => deriveOrgUnitNames(
    readExport([header, ...rows, ""].join("\n"), { unitColumn: "cost_center" }),
  ).names[orgUnitPseudonym("cc-4471")]);
  assert.deepEqual(resolved, ["Platform Engineering", "Platform Engineering", "Platform Engineering"]);
});

test("a higher-precedence field wins outright over a lower one", () => {
  const naming = deriveOrgUnitNames(readExport([
    "usage_date,unit_code,project_name,cost_center_name,model,amount",
    "2026-06-01,u-1,Platform Engineering,Shared Services,gpt-4o,120.00",
    "",
  ].join("\n"), { unitColumn: "unit_code" }));
  const unit = naming.byUnit[orgUnitPseudonym("u-1")];
  assert.equal(unit.name, "Platform Engineering");
  assert.equal(unit.sourceField, "project");
  assert.equal(unit.conflicted, false,
    "a cross-field difference is resolved by the stated precedence, not reported as a conflict");
});

test("empty, whitespace-only and over-long values fall through to the next field", () => {
  const naming = deriveOrgUnitNames(readExport([
    "usage_date,unit_code,project_name,description,model,amount",
    `2026-06-01,u-1,   ,${"n".repeat(MAX_DERIVED_UNIT_NAME + 1)},gpt-4o,120.00`,
    "2026-06-02,u-2,,Customer Support,gpt-4o,45.00",
    "",
  ].join("\n"), { unitColumn: "unit_code" }));
  assert.equal(naming.byUnit[orgUnitPseudonym("u-1")], undefined,
    "whitespace and an over-long value are both absent, so nothing names u-1");
  assert.equal(naming.names[orgUnitPseudonym("u-2")], "Customer Support",
    "an empty project falls through to the description");
});

test("partial coverage names the units it can and leaves the rest opaque", () => {
  const naming = deriveOrgUnitNames(readExport(PARTIAL_COVERAGE, { unitColumn: "unit_code" }));
  assert.equal(naming.unitCount, 2);
  assert.equal(naming.derivedCount, 1);
  assert.equal(naming.names[orgUnitPseudonym("cc-4471")], "Platform Engineering");
  assert.equal(naming.names[orgUnitPseudonym("cc-9902")], undefined);
  assert.equal(naming.units.filter((unit) => !unit.derived).length, 1);
  assert.match(naming.statement, /1 unit carried no usable label/);
});

test("a reading with no org-unit column derives nothing rather than guessing", () => {
  const { columns, rows } = readExport(PARTIAL_COVERAGE, { unitColumn: "unit_code" });
  const naming = deriveOrgUnitNames({ columns, rows });
  assert.equal(naming.available, false);
  assert.equal(naming.derivedCount, 0);
  assert.equal(naming.statement, "");
  assert.equal(deriveOrgUnitNames().available, false);
  assert.equal(NO_DERIVED_UNIT_NAMES.available, false);
});

test("merging two files' namings is first-wins per unit and recomposes the sentence", () => {
  const first = deriveOrgUnitNames(readExport(PARTIAL_COVERAGE, { unitColumn: "unit_code" }));
  const second = deriveOrgUnitNames(readExport([
    "usage_date,unit_code,project_name,model,amount",
    "2026-06-05,cc-4471,Renamed Later,gpt-4o,10.00",
    "2026-06-05,cc-9902,Customer Support,gpt-4o,10.00",
    "",
  ].join("\n"), { unitColumn: "unit_code" }));
  const merged = mergeOrgUnitNamings([first, second]);
  assert.equal(merged.names[orgUnitPseudonym("cc-4471")], "Platform Engineering",
    "the earlier file in the selection keeps the name");
  assert.equal(merged.names[orgUnitPseudonym("cc-9902")], "Customer Support",
    "a unit the first file could not name is named by the second");
  assert.equal(merged.derivedCount, 2);
  assert.equal(mergeOrgUnitNamings([]).available, false);
});

// --- 3. precedence against reader-typed names --------------------------------

test("a reader-typed name wins over a derived one, and clearing it falls back", () => {
  const naming = deriveOrgUnitNames(readExport(BILLING_WITH_TAGS));
  const unitId = orgUnitPseudonym("cc-4471");
  const pseudonym = `Department …${unitId.slice(-6)}`;
  // The page's own merge: derived underneath, reader-typed on top.
  const typed = Object.freeze({ ...naming.names, [unitId]: "Platform (EMEA)" });
  assert.equal(orgUnitDisplayName(typed, unitId, pseudonym), "Platform (EMEA)");
  assert.equal(orgUnitDisplayName({ ...naming.names }, unitId, pseudonym), "Platform Engineering",
    "with no reader name the derived one renders, never the pseudonym");
  assert.equal(orgUnitDisplayName({}, unitId, pseudonym), pseudonym,
    "and with neither, the unit renders exactly as it does today");
});

// --- 4. what the reader sees, in the shipped markup --------------------------

const analysisFor = (naming, names) => ({
  period: "2026-06-01 to 2026-07-01",
  currency: "USD",
  spendUsd: 245,
  recoverableUsd: 60,
  action: "Pilot lower-cost routing.",
  rankedDepartments: names.map(([raw, spendUsd, recoverableUsd]) => ({
    id: orgUnitPseudonym(raw),
    name: `Department …${orgUnitPseudonym(raw).slice(-6)}`,
    unit: { source: "provider-group" },
    spendUsd,
    recoverableUsd,
  })),
  history: {
    state: "available",
    periods: [{ period: "2026-06", spendUsd: 245, recoverableUsd: 60, completeness: "complete" }],
  },
  naming,
});

test("the page names the column the headline's unit names came from", () => {
  const document = parseHtml(html);
  const naming = deriveOrgUnitNames(readExport(BILLING_WITH_TAGS));
  const analysis = analysisFor(naming, [["cc-4471", 200, 50], ["cc-9902", 45, 10]]);
  applyImportedHeadline(document, analysis, { labels: naming.names, naming });
  const line = document.getElementById("finops-imported-headline-naming");
  const contract = document.getElementById("finops-imported-headline-naming-contract");
  assert.equal(line.hidden, false);
  assert.match(textOf(line), /“tag:team” column/,
    "the provenance names the actual column, not a generic 'names were derived'");
  assert.equal(line.dataset.derived, "2");
  assert.equal(line.dataset.units, "2");
  assert.equal(line.dataset.contractVersion, String(LABEL_DERIVATION_CONTRACT_VERSION));
  assert.match(textOf(contract), /project, tag, description, cost center/,
    "the recognized fields and their precedence are stated for the reader");
  // Both lines are direct children of the headline block and of no disclosure:
  // the harness reads through a closed fold and a real browser does not.
  for (const node of [line, contract]) {
    for (let walk = node.parentNode; walk; walk = walk.parentNode) {
      assert.notEqual(walk.tagName?.toLowerCase(), "details",
        "the reader-critical provenance sentence must not sit inside a fold");
    }
  }
});

test("an import with no derivation to report leaves both lines empty", () => {
  const document = parseHtml(html);
  const analysis = analysisFor(null, [["cc-4471", 200, 50]]);
  applyImportedHeadline(document, analysis, { labels: {}, naming: NO_DERIVED_UNIT_NAMES });
  const line = document.getElementById("finops-imported-headline-naming");
  assert.equal(textOf(line), "");
  assert.equal(line.hidden, true);
  assert.equal(document.getElementById("finops-imported-headline-slots").children.length, 10,
    "five slots still render: an absent naming costs the provenance line and nothing else");
});

test("a unit the export could not name is marked beside its identifier", () => {
  const naming = deriveOrgUnitNames(readExport(PARTIAL_COVERAGE, { unitColumn: "unit_code" }));
  const analysis = analysisFor(naming, [["cc-4471", 200, 50], ["cc-9902", 45, 10]]);
  const drilldown = importedDepartmentDrilldown(analysis, {
    labels: naming.names, readerLabels: {}, naming,
  });
  const rows = drilldown.rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Platform Engineering");
  assert.equal(rows[0].nameDerived, true);
  assert.equal(rows[1].nameDerived, false);
  assert.match(rows[1].name, /^Department …/,
    "an underivable unit keeps the identifier the analysis published, unchanged");
  assert.deepEqual(rows.map((row) => row.readerNamed), [false, false],
    "a derived name is not a name the reader typed, and must not read as one");
});

// --- 5. the whole path, on the shipped page ---------------------------------
//
// One drop, no second step: the file goes in and the headline sentence and the
// ranked unit rows come back naming units instead of digests. This boots the
// real page entry against the real markup, the way tests/finops-import-e2e.js
// does, because "the derivation is wired" is not something a unit test of the
// derivation can tell anybody.

const DEMO_DATA = JSON.parse(await readFile(
  new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(await readFile(
  new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

/** A one-file provider export whose units are named in its own project column. */
const DROPPED_EXPORT = [
  "usage_date,model,project,n_context_tokens_total,n_generated_tokens_total,amount,currency",
  "2026-06-01,gpt-4o,Platform Engineering,120000,14000,412.75,USD",
  "2026-06-02,gpt-4o-mini,Customer Support,92000,8800,31.40,USD",
  "",
].join("\n");

test("one drop names the units on the headline, with no second reader action", async () => {
  const { loadPage, DomEvent } = await import("./support/browser.js");
  const { importPageModule, waitFor } = await import("./support/page-module.js");
  const page = await loadPage(PAGE, {
    storage: {},
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  await importPageModule("/evolution-page.js");
  const { document } = page;
  try {
    await waitFor(() => document.documentElement.dataset.shiplogEvolution === "ready",
      "the bundled analysis to finish rendering");
    const input = document.getElementById("local-finops-files");
    input.files = [{
      name: "usage-export.csv", type: "text/csv", text: async () => DROPPED_EXPORT,
    }];
    input.dispatchEvent(new DomEvent("change", { bubbles: true }));
    await waitFor(() => !document.getElementById("local-results").hidden,
      "the dropped export to reach analysis");
    await waitFor(() => !document.getElementById("finops-imported-headline-naming").hidden,
      "the naming provenance line to be painted");
    const naming = document.getElementById("finops-imported-headline-naming");
    assert.match(textOf(naming), /“project” column/,
      "the page names the export column its unit names came from");
    assert.equal(naming.dataset.derived, "2");
    assert.match(textOf(document.getElementById("finops-imported-headline-naming-contract")),
      /project, tag, description, cost center/);
    const headline = textOf(document.getElementById("finops-imported-headline-slots"));
    assert.match(headline, /Platform Engineering/,
      "the headline names the unit the export named, not its pseudonym");
  } finally {
    page.restore();
  }
});
