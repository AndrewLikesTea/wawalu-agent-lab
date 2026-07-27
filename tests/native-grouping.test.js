// Executable contract for native grouping detection.
//
// One case per shipped dialect, driven off the *committed* vendor fixtures under
// `contracts/integrations/tabular-dialects/v1/fixtures/`, so a profile whose
// grouping candidates drift away from the export it claims to read fails here.
// Every other table is generated in this file — synthetic rows only, no real
// customer, account, project, or key name appears anywhere.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  DIALECT_PROFILES, GROUPING_UNIT_PRECEDENCE, PROVIDER_GROUPING_UNITS,
  assertProfileRegistry, rankedGroupingCandidates,
} from "../src/dialect-profiles.js";
import {
  CANDIDATE_REJECTIONS, ENRICHMENT_CODES, GROUPING_STATUS, NATIVE_GROUPING_VERSION,
  applyGroupingEnrichment, assertNativeGrouping, detectNativeGrouping,
} from "../src/native-grouping.js";
import { orgUnitPseudonym } from "../src/unit-pseudonym.js";
import { createColumnMapping, mappingSummary } from "../src/import-column-mapping.js";
import { parseDelimitedFinopsFile } from "../src/finops-tabular-import.js";
import { readTable, reorderColumns } from "./support/tabular.js";

const FIXTURES = new URL("../contracts/integrations/tabular-dialects/v1/fixtures/", import.meta.url);

const fixtureTable = async (profileId) =>
  readTable(await readFile(new URL(`${profileId}.csv`, FIXTURES), "utf8"));

/** A table literal: first array is the header, the rest are data rows. */
const table = ([columns, ...rows]) => ({ columns, rows });

/** The pseudonyms a set of synthetic labels must produce. */
const pseudonyms = (...labels) => labels.map(orgUnitPseudonym).sort();

// --- one case per dialect ---------------------------------------------------

/**
 * Fixture in -> detected dialect, chosen grouping column, and the resulting unit
 * labels, asserted whole. `beat` names the candidates that were present and lost.
 */
const PER_DIALECT = Object.freeze([
  Object.freeze({
    profileId: "openai-usage-export", unit: "project", header: "project",
    beat: ["api_key"], labels: ["atlas-platform", "boreal-support", "cinder-research"],
  }),
  Object.freeze({
    profileId: "anthropic-usage-export", unit: "workspace", header: "workspace",
    beat: ["api_key"], labels: ["atlas-platform", "boreal-support", "ember-design"],
  }),
  Object.freeze({
    profileId: "aws-cost-and-usage-report", unit: "account",
    header: "line_item_usage_account_id",
    beat: [], labels: ["acct-atlas", "acct-boreal", "acct-cinder"],
  }),
  Object.freeze({
    profileId: "azure-cost-management-export", unit: "resource_group", header: "ResourceGroup",
    beat: ["account"], labels: ["rg-atlas-platform", "rg-boreal-support", "rg-cinder-research"],
  }),
  Object.freeze({
    profileId: "google-cloud-billing-export", unit: "project", header: "project.id",
    beat: [], labels: ["atlas-platform", "boreal-support", "quartz-data"],
  }),
]);

for (const expected of PER_DIALECT) {
  test(`${expected.profileId}: the export's own grouping column is recognized`, async () => {
    const grouping = detectNativeGrouping(await fixtureTable(expected.profileId));
    assertNativeGrouping(grouping);
    assert.equal(grouping.version, NATIVE_GROUPING_VERSION);
    assert.equal(grouping.status, GROUPING_STATUS.native);
    assert.equal(grouping.dialect.id, expected.profileId);
    assert.equal(grouping.column.header, expected.header);
    assert.equal(grouping.unit, expected.unit);
    assert.deepEqual([...grouping.precedence.beat], expected.beat);
    assert.deepEqual([...grouping.units.labels], pseudonyms(...expected.labels));
    assert.equal(grouping.units.distinct, expected.labels.length);
    assert.deepEqual({ ...grouping.rows },
      { total: 3, grouped: 3, ungrouped: 0 });
    // The precedence reason is machine-readable, not a prose blob.
    assert.equal(grouping.precedence.code,
      expected.beat.length ? "outranked_others" : "sole_candidate");
    assert.deepEqual([...grouping.precedence.order], GROUPING_UNIT_PRECEDENCE);
  });
}

test("every usage profile is covered by a case, and a roster groups nothing", async () => {
  assertProfileRegistry();
  const usage = DIALECT_PROFILES.filter((profile) => profile.kind === "usage").map((p) => p.id);
  assert.deepEqual(usage.sort(), PER_DIALECT.map((entry) => entry.profileId).sort(),
    "a usage profile without a grouping case is a profile nobody has proved reads");

  const roster = detectNativeGrouping(await fixtureTable("generic-hris-roster"));
  assertNativeGrouping(roster);
  assert.equal(roster.status, GROUPING_STATUS.none);
  assert.equal(roster.unit, null);
  assert.match(roster.text, /enrichment file/);
});

test("the precedence order is one total ranking of every grouping unit", () => {
  assert.equal(GROUPING_UNIT_PRECEDENCE.length, PROVIDER_GROUPING_UNITS.length);
  assert.equal(new Set(GROUPING_UNIT_PRECEDENCE).size, GROUPING_UNIT_PRECEDENCE.length);
  // The stated criterion, pinned: an authored cost tag beats a project, a
  // project beats a key alias, and the linked account is always last.
  assert.ok(GROUPING_UNIT_PRECEDENCE.indexOf("tag") < GROUPING_UNIT_PRECEDENCE.indexOf("project"));
  assert.ok(GROUPING_UNIT_PRECEDENCE.indexOf("project") < GROUPING_UNIT_PRECEDENCE.indexOf("api_key"));
  assert.equal(GROUPING_UNIT_PRECEDENCE.at(-1), "account");
  for (const profile of DIALECT_PROFILES) {
    const ranked = rankedGroupingCandidates(profile).map((candidate) => candidate.rank);
    assert.deepEqual(ranked, [...ranked].sort((left, right) => left - right),
      `${profile.id}: candidates must arrive already ranked`);
  }
});

// --- the defensive cases ----------------------------------------------------

/** An AWS CUR carrying both a cost-allocation tag and the linked account. */
const CUR_WITH_TAG = (tagCells) => table([
  ["bill_billing_period_start_date", "line_item_usage_start_date",
    "line_item_usage_account_id", "resourceTags/user:CostCenter", "line_item_product_code",
    "line_item_usage_amount", "line_item_unblended_cost", "line_item_currency_code"],
  ["2026-06-01", "2026-06-05T00:00:00Z", "acct-one", tagCells[0], "AmazonBedrock", "10", "1.00", "USD"],
  ["2026-06-01", "2026-06-06T00:00:00Z", "acct-one", tagCells[1], "AmazonBedrock", "20", "2.00", "USD"],
  ["2026-06-01", "2026-06-07T00:00:00Z", "acct-two", tagCells[2], "AmazonBedrock", "30", "3.00", "USD"],
]);

test("multiple candidates present: the precedence order decides, not column order", () => {
  const grouping = detectNativeGrouping(CUR_WITH_TAG(["cc-platform", "cc-platform", "cc-support"]));
  assert.equal(grouping.unit, "tag");
  assert.equal(grouping.column.header, "resourceTags/user:CostCenter");
  assert.deepEqual([...grouping.precedence.beat], ["account"]);
  assert.equal(grouping.units.distinct, 2);

  // The losing candidate is reported with its reason, so the review UI can show
  // its work rather than silently dropping the column it did not use.
  const account = grouping.candidates.find((candidate) => candidate.unit === "account");
  assert.equal(account.status, "rejected");
  assert.equal(account.code, CANDIDATE_REJECTIONS.outranked);
  assert.equal(account.header, "line_item_usage_account_id");
  assert.match(account.text, /outranks/);

  // Reordering the columns cannot change any of it.
  const source = CUR_WITH_TAG(["cc-platform", "cc-platform", "cc-support"]);
  const reversed = reorderColumns(source, [...source.columns.keys()].reverse());
  const after = detectNativeGrouping(reversed);
  assert.equal(after.unit, grouping.unit);
  assert.equal(after.column.header, grouping.column.header);
  assert.deepEqual([...after.units.labels], [...grouping.units.labels]);
});

test("a candidate column present but entirely empty falls through to the next", () => {
  const grouping = detectNativeGrouping(CUR_WITH_TAG(["", "  ", ""]));
  assert.equal(grouping.unit, "account", "an empty tag column names no team");
  assert.equal(grouping.column.header, "line_item_usage_account_id");
  const tag = grouping.candidates.find((candidate) => candidate.unit === "tag");
  assert.equal(tag.code, CANDIDATE_REJECTIONS.empty);
  assert.equal(tag.blankRows, 3);
  assert.equal(tag.valueRows, 0);
  assert.match(tag.text, /every row is blank/);
});

test("some blank cells are counted and reported, never bucketed into a fake unit", () => {
  const grouping = detectNativeGrouping(CUR_WITH_TAG(["cc-platform", "", "cc-support"]));
  assert.equal(grouping.unit, "tag");
  assert.deepEqual({ ...grouping.rows }, { total: 3, grouped: 2, ungrouped: 1 });
  assert.equal(grouping.units.distinct, 2, "a blank row must not become a third unit");
  assert.deepEqual([...grouping.units.labels], pseudonyms("cc-platform", "cc-support"));
});

test("no candidate at all is a clean result, not a throw and not a missing-org-file message", () => {
  // Every declared candidate removed; the profile still matches on its required
  // columns because `owner_id` is supplied by an accepted alias spelling.
  const noCandidates = table([
    ["date", "workspace_name", "model", "input_tokens", "output_tokens", "cost_usd"],
    ["2026-06-05", "", "acme-opus", "10", "5", "1.00"],
  ]);
  const grouping = detectNativeGrouping(noCandidates);
  assertNativeGrouping(grouping);
  assert.equal(grouping.status, GROUPING_STATUS.none);
  assert.equal(grouping.column, null);
  assert.equal(grouping.unit, null);
  assert.equal(grouping.precedence.code, "no_candidate");
  assert.doesNotMatch(grouping.text, /org file|HRIS|missing/i);
  assert.match(grouping.text, /no grouping column/i);
  assert.deepEqual({ ...grouping.rows }, { total: 1, grouped: 0, ungrouped: 1 });
});

test("headers are normalized: whitespace, case, separators, and duplicates", () => {
  const shifted = table([
    ["  Usage_Date ", "MODEL", " Project ", "N Context Tokens Total", "N Generated Tokens Total",
      "Amount", "Currency", "project"],
    ["2026-06-05", "acme-4o", "atlas-platform", "100", "50", "1.00", "USD", "shadow-copy"],
    ["2026-06-06", "acme-4o", "boreal-support", "200", "90", "2.00", "USD", "shadow-copy"],
  ]);
  const grouping = detectNativeGrouping(shifted);
  assert.equal(grouping.status, GROUPING_STATUS.native);
  assert.equal(grouping.unit, "project");
  // The leftmost copy of a repeated header wins, deterministically, and the
  // header is republished exactly as the file spelled it — padding included.
  assert.equal(grouping.column.header, " Project ");
  assert.equal(grouping.column.normalized, "project");
  assert.deepEqual([...grouping.units.labels], pseudonyms("atlas-platform", "boreal-support"));
});

test("an unmatched file yields the stated absence, never an undefined unit", () => {
  const grouping = detectNativeGrouping(table([["alpha", "beta"], ["1", "2"]]));
  assertNativeGrouping(grouping);
  assert.equal(grouping.status, GROUPING_STATUS.unidentified);
  assert.equal(grouping.unit, null);
  assert.deepEqual([...grouping.candidates], []);
  assert.equal(detectNativeGrouping(null).status, GROUPING_STATUS.unidentified);
  assert.equal(detectNativeGrouping(undefined).unit, null);
});

// --- pseudonymization -------------------------------------------------------

/** Every string anywhere inside a value, however deeply nested. */
function everyString(value, found = []) {
  if (typeof value === "string") found.push(value);
  else if (Array.isArray(value)) for (const entry of value) everyString(entry, found);
  else if (value && typeof value === "object") for (const entry of Object.values(value)) everyString(entry, found);
  return found;
}

test("no raw grouping label survives on the native-grouping path", async () => {
  const grouping = detectNativeGrouping(await fixtureTable("openai-usage-export"));
  const strings = everyString(grouping);
  for (const label of ["atlas-platform", "boreal-support", "cinder-research"]) {
    assert.ok(!strings.some((text) => text.includes(label)),
      `the customer's own project name ${label} must not appear on the result`);
    assert.ok(strings.includes(orgUnitPseudonym(label)),
      "the unit must be present, as a pseudonym");
  }
  // The header is a header, not a cell value: it is published, and the review
  // step already shows the reader their own header row.
  assert.ok(strings.includes("project"));

  // The same rule holds through the shipped delimited importer, which is where
  // an artifact is actually produced. One pseudonym helper, one digest.
  const text = await readFile(new URL("openai-usage-export.csv", FIXTURES), "utf8");
  const result = parseDelimitedFinopsFile(text, "export.csv", { generatedAt: "2026-06-30T00:00:00Z" });
  assert.equal(result.ok, true);
  const exported = everyString(result.parsed.document);
  for (const label of ["atlas-platform", "boreal-support", "cinder-research"]) {
    assert.ok(!exported.some((entry) => entry.includes(label)),
      "no raw grouping label may enter the exported envelope");
  }
  assert.ok(result.parsed.document.records.every((record) =>
    record.org_unit_id.startsWith("psn_unit_")));
  // The grouping contract travels with the result for the attribution consumer.
  assert.equal(result.nativeGrouping.unit, "project");
  assert.equal(result.nativeGrouping.column.header, "project");
});

test("a grouping column outside the importer's own aliases still attributes the export", () => {
  // `project_id` is a declared OpenAI grouping candidate spelling, and it is in
  // no `SHAPES` org-unit alias list — so before this change the export was
  // rejected as unattributable. It is now attributed by its own grouping column.
  const text = [
    "usage_date,model,project_id,n_context_tokens_total,amount,currency",
    "2026-06-05,acme-4o,svc-billing,100,1.00,USD",
    "2026-06-06,acme-4o,svc-search,200,2.00,USD",
  ].join("\n");
  const result = parseDelimitedFinopsFile(text, "export.csv", { generatedAt: "2026-06-30T00:00:00Z" });
  assert.equal(result.nativeGrouping.unit, "project");
  assert.equal(result.ok, true, "an export with a native grouping column must not be rejected");
  assert.equal(result.orgUnitOrigin, "native_grouping");
  assert.deepEqual(
    [...new Set(result.parsed.document.records.map((record) => record.org_unit_id))].sort(),
    pseudonyms("svc-billing", "svc-search"));
});

// --- the review surface -----------------------------------------------------

test("the review step shows the grouping column and why it beat the others", () => {
  const source = CUR_WITH_TAG(["cc-platform", "cc-platform", "cc-support"]);
  const reading = {
    header: source.columns,
    rows: source.rows.map((values, row) => ({ row: row + 2, values })),
  };
  const state = createColumnMapping({ reading, fileName: "cur.csv" });
  assert.equal(state.nativeGrouping.unit, "tag");
  const sentence = mappingSummary(state).grouping;
  assert.match(sentence, /resourceTags\/user:CostCenter/);
  assert.match(sentence, /outranks/);
  assert.doesNotMatch(sentence, /org file|HRIS/i);
  // No raw tag value reaches the sentence; only the header and the counts do.
  assert.doesNotMatch(sentence, /cc-platform|cc-support/);
});

test("a file with no grouping column tells the reader no org file is needed", () => {
  const reading = { header: ["alpha", "beta"], rows: [{ row: 2, values: ["1", "2"] }] };
  const state = createColumnMapping({ reading, fileName: "unknown.csv" });
  assert.equal(state.nativeGrouping.status, GROUPING_STATUS.unidentified);
  assert.equal(mappingSummary(state).grouping, "");
});

// --- optional enrichment ----------------------------------------------------

const GROUPED = () => detectNativeGrouping(CUR_WITH_TAG(["cc-platform", "cc-platform", "cc-support"]));

test("enrichment is optional: absent leaves the native grouping whole", () => {
  const grouping = GROUPED();
  assert.equal(grouping.enrichment.status, ENRICHMENT_CODES.absent);
  assert.equal(applyGroupingEnrichment(grouping, null), grouping);
  assert.equal(applyGroupingEnrichment(grouping, undefined).enrichment.applied, false);
});

test("units absent from the enrichment file keep their native label", () => {
  const enriched = applyGroupingEnrichment(GROUPED(), [
    { unit: "cc-platform", department: "Platform Engineering" },
  ]);
  assert.equal(enriched.enrichment.status, ENRICHMENT_CODES.partial);
  assert.equal(enriched.enrichment.applied, true);
  assert.deepEqual(enriched.enrichment.mapped.map((entry) => entry.department),
    ["Platform Engineering"]);
  assert.deepEqual([...enriched.enrichment.unmapped], [orgUnitPseudonym("cc-support")]);
  // The native grouping is untouched by enrichment; it only gains a name.
  assert.deepEqual([...enriched.units.labels], [...GROUPED().units.labels]);
});

test("an enrichment row naming an unknown unit is reported, not fatal", () => {
  const enriched = applyGroupingEnrichment(GROUPED(), [
    { unit: "cc-platform", department: "Platform Engineering" },
    { unit: "cc-support", department: "Support" },
    { unit: "cc-retired", department: "Closed Team" },
  ]);
  assert.equal(enriched.enrichment.status, ENRICHMENT_CODES.partial);
  assert.equal(enriched.enrichment.mapped.length, 2);
  assert.deepEqual(enriched.enrichment.unknown.map((entry) => entry.code),
    [ENRICHMENT_CODES.unknownUnit]);
  assert.deepEqual([...enriched.enrichment.unmapped], []);
});

test("a malformed enrichment file leaves the native grouping intact", () => {
  for (const rows of [["not a row"], [{ unit: "", department: "" }], "a string", 7]) {
    const enriched = applyGroupingEnrichment(GROUPED(), rows);
    assert.equal(enriched.enrichment.status, ENRICHMENT_CODES.malformed,
      `${JSON.stringify(rows)} must be reported as malformed`);
    assert.equal(enriched.enrichment.applied, false);
    assert.equal(enriched.unit, "tag", "a bad org file must never cost the drop");
    assert.deepEqual([...enriched.units.labels], [...GROUPED().units.labels]);
    assert.ok(enriched.enrichment.problems.length > 0);
  }
});

test("a complete enrichment file maps every unit, and duplicates are deterministic", () => {
  const enriched = applyGroupingEnrichment(GROUPED(), [
    { unit: "cc-platform", department: "Platform Engineering" },
    { unit: "CC-Platform", department: "Second Answer" },
    { unit: "cc-support", department: "Support" },
  ]);
  assert.equal(enriched.enrichment.status, ENRICHMENT_CODES.complete);
  // Case-insensitive join through the same pseudonym helper, first row wins.
  const platform = enriched.enrichment.mapped
    .find((entry) => entry.unit === orgUnitPseudonym("cc-platform"));
  assert.equal(platform.department, "Platform Engineering");
  assert.equal(enriched.enrichment.problems.length, 1);
});
