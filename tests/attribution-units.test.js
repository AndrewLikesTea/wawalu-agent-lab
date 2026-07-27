import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ATTRIBUTION_SOURCES, BLANK_GROUP_PSEUDONYM, coverageOf, coverageThreshold,
  enrichWithOrgMapping, isUnattributed, OrgMappingError, UNATTRIBUTED_KEY,
} from "../src/attribution-units.js";
import { COVERAGE_TIERS } from "../src/grade-eligibility.js";
import * as localFinops from "../src/local-finops.js";
import { normalizeLocalFinops } from "../src/local-finops.js";

const FIXTURES = new URL("../contracts/integrations/", import.meta.url);

/**
 * Money is compared with the codebase's own cent grain: every published figure
 * is rounded to two decimals by `Math.round(x * 100) / 100`, so half a cent is
 * the widest gap two agreeing sums can have.
 */
const CENT = 0.005;

async function providerDocument() {
  return JSON.parse(await readFile(new URL(
    "provider-usage-billing/v1/fixtures/valid.json", FIXTURES), "utf8"));
}

/**
 * A provider export built in-test from the shipped one-record fixture. Each
 * entry is `[org_unit_id, amount_minor]`; a null id is a row whose grouping
 * value the export never carried.
 */
async function providerOnly(rows, modelUsage = null) {
  const document = await providerDocument();
  const template = document.records[0];
  return {
    ...(modelUsage ? { modelUsage } : {}),
    document: {
      ...document,
      records: rows.map(([orgUnitId, amountMinor], index) => ({
        ...template,
        aggregate_id: `psn_aggregate_row_${String(index).padStart(8, "0")}`,
        org_unit_id: orgUnitId === null ? BLANK_GROUP_PSEUDONYM : orgUnitId,
        usage: { ...template.usage },
        cost: { ...template.cost, amount_minor: amountMinor },
      })),
    },
  };
}

const unitOf = (result, key) =>
  result.attribution.spendMix.units.find((entry) => entry.unit.key === key) ?? null;

/** The invariant every figure owes: its two halves add up to its own total. */
function assertCoverageIdentity(figure, label) {
  assert.ok(Math.abs(
    figure.coverage.attributedSpend + figure.coverage.unattributedSpend - figure.totalSpendUsd,
  ) <= CENT, `${label}: attributed + unattributed must equal that figure's total spend`);
}

test("a provider export alone runs; no org file is required", async () => {
  const provider = await providerOnly([
    ["psn_unit_demo_00000002", 1234],
    ["psn_unit_demo_00000003", 766],
  ]);
  const result = normalizeLocalFinops({ provider });

  assert.equal(result.spendUsd, 20);
  assert.equal(result.attribution.spendMix.units.length, 2);
  assert.ok(result.attribution.spendMix.units
    .every((entry) => entry.unit.source === ATTRIBUTION_SOURCES.providerGroup));
  // 100% attributed, so nothing is degraded and nothing is suppressed.
  assert.equal(result.attribution.spendMix.coverage.attributedShare, 1);
  assert.equal(result.attribution.spendMix.coverage.unattributedSpend, 0);
  assert.equal(result.attribution.rankedRecoverable.threshold.suppressed, false);
  assert.equal(result.attribution.rankedRecoverable.threshold.degraded, false);
  assert.equal(result.attribution.rankedRecoverable.threshold.tier, "high");
  assertCoverageIdentity(result.attribution.spendMix, "spend mix");
  assertCoverageIdentity(result.attribution.rankedRecoverable, "ranked recoverable");
  // The org file is optional, and the result says which run it was.
  assert.equal(result.quality.hrisCompleteness, null);
  assert.match(result.provenance, /No org file was supplied/);
});

test("partially attributed spend keeps the unattributed bucket in every figure", async () => {
  const provider = await providerOnly([
    ["psn_unit_demo_00000002", 6000],
    ["psn_unit_demo_00000003", 2000],
    [null, 2000],
    [null, 0],
  ], [
    { orgUnitId: "psn_unit_demo_00000002", model: "syn-large-1", tokens: 2_000_000, requests: 4000, spendMinor: 6000 },
    { orgUnitId: BLANK_GROUP_PSEUDONYM, model: "syn-large-1", tokens: 700_000, requests: 1400, spendMinor: 2000 },
  ]);
  const result = normalizeLocalFinops({ provider });

  const bucket = unitOf(result, UNATTRIBUTED_KEY);
  assert.ok(bucket, "the reserved bucket must appear in the mix");
  assert.equal(bucket.spendUsd, 20);
  assert.equal(bucket.records, 2, "both blank rows roll into exactly one unit");
  assert.ok(isUnattributed(bucket.unit));

  // Present in the ranked savings list, not filtered out of it.
  const ranked = result.rankedDepartments.find((entry) => entry.id === UNATTRIBUTED_KEY);
  assert.ok(ranked, "the reserved bucket must survive into the ranked list");
  assert.equal(ranked.name, "Unattributed spend");
  assert.equal(ranked.spendUsd, 20);

  for (const [label, figure] of [
    ["spend mix", result.attribution.spendMix],
    ["ranked recoverable", result.attribution.rankedRecoverable],
    ["per-model overspend", result.attribution.modelOverspend],
  ]) assertCoverageIdentity(figure, label);

  assert.equal(result.attribution.spendMix.coverage.attributedSpend, 80);
  assert.equal(result.attribution.spendMix.coverage.unattributedSpend, 20);
  assert.equal(result.attribution.spendMix.coverage.attributedShare, 0.8);
  // 80% is exactly Noor's top floor, read with `>=`, so the boundary is shown.
  assert.equal(result.attribution.rankedRecoverable.threshold.tier, "high");
  assert.equal(result.attribution.rankedRecoverable.threshold.suppressed, false);

  // The per-model finding carries its own coverage, from its own rows: the
  // model-usage rows split 60/20, not the 80/20 of the billing rows above.
  const perModel = result.attribution.modelOverspend;
  assert.equal(perModel.coverage.attributedSpend, 60);
  assert.equal(perModel.coverage.unattributedSpend, 20);
  assert.equal(perModel.coverage.attributedShare, 0.75);
  assert.equal(perModel.threshold.tier, "moderate");
  assert.equal(perModel.threshold.reason.observedShare, 0.75);
  assert.notEqual(perModel.coverage.attributedShare,
    result.attribution.spendMix.coverage.attributedShare,
    "each figure's coverage is computed from its own rows, not pasted on globally");
});

test("fully unattributed spend suppresses the ranking with a machine-readable reason", async () => {
  const provider = await providerOnly([[null, 5000], [null, 5000]]);
  const result = normalizeLocalFinops({ provider });

  const figure = result.attribution.rankedRecoverable;
  assert.equal(figure.coverage.attributedSpend, 0);
  assert.equal(figure.coverage.unattributedSpend, 100);
  assert.equal(figure.coverage.attributedShare, 0);
  assertCoverageIdentity(figure, "ranked recoverable");

  // Suppressed, and represented: the reason names the threshold and the share.
  assert.equal(figure.threshold.suppressed, true);
  assert.equal(figure.threshold.present, false);
  assert.equal(figure.threshold.tier, "insufficient");
  assert.equal(figure.threshold.reason.code, "insufficient_coverage");
  assert.equal(figure.threshold.reason.observedShare, 0);
  assert.equal(figure.threshold.reason.floor,
    COVERAGE_TIERS.at(-1).floor, "the floor must be Noor's, not a new one");
  assert.match(figure.threshold.reason.rule, /quarter of spend/);
  // The spend itself is still reported. Suppression hides a ranking claim, not
  // the money the reader asked about.
  assert.equal(result.spendUsd, 100);
  assert.ok(unitOf(result, UNATTRIBUTED_KEY));
});

test("the degraded band is Noor's provisional tier, applied to the attributed share", () => {
  // 30% attributed: below the 0.50 moderate floor, at or above the 0.25 one.
  const degraded = coverageThreshold(coverageOf([
    { unit: { source: ATTRIBUTION_SOURCES.providerGroup }, spendUsd: 30 },
    { unit: { source: ATTRIBUTION_SOURCES.unattributed }, spendUsd: 70 },
  ]));
  assert.equal(degraded.tier, "provisional");
  assert.equal(degraded.degraded, true);
  assert.equal(degraded.suppressed, false);
  assert.equal(degraded.reason.code, "provisional_coverage");
  assert.equal(degraded.reason.observedShare, 0.3);

  // No spend at all is not a coverage of zero: it has no denominator, and the
  // share is a defined null rather than NaN.
  const empty = coverageOf([]);
  assert.equal(empty.attributedShare, null);
  assert.ok(!Number.isNaN(empty.attributedShare));
  assert.equal(coverageThreshold(empty).tier, "no_baseline");
  assert.equal(coverageThreshold(empty).reason.code, "no_spend_baseline");
});

test("a provider value that spells the reserved key stays its own attributed unit", async () => {
  const provider = await providerOnly([
    [`psn_unit_${UNATTRIBUTED_KEY}_0000`, 1000],
    [null, 1000],
  ]);
  const result = normalizeLocalFinops({ provider });

  const collider = unitOf(result, `provider-group:psn_unit_${UNATTRIBUTED_KEY}_0000`);
  assert.ok(collider, "a real group value is namespaced and cannot become the bucket");
  assert.equal(collider.unit.source, ATTRIBUTION_SOURCES.providerGroup);
  assert.notEqual(collider.unit.key, UNATTRIBUTED_KEY);
  assert.equal(unitOf(result, UNATTRIBUTED_KEY).spendUsd, 10);
  assert.equal(result.attribution.spendMix.units.length, 2, "the two never merge");
});

test("an org mapping applied afterwards re-keys units without re-parsing anything", async () => {
  const provider = await providerOnly([
    ["psn_unit_demo_00000002", 6000],
    ["psn_unit_demo_00000003", 2000],
    [null, 2000],
  ]);
  const result = normalizeLocalFinops({ provider });

  // By construction, two ways. First, a counter on the only thing a re-parse
  // could read: the source records are swapped for a counting accessor *after*
  // the result exists, so a second trip through extraction cannot go unseen.
  const records = provider.document.records;
  let sourceReads = 0;
  Object.defineProperty(provider.document, "records", {
    configurable: true,
    get() { sourceReads += 1; return records; },
  });
  // Second, the enrichment is handed a materialized result and nothing else —
  // no file text, no document, no parser handle — so re-parsing is impossible
  // rather than merely unobserved.
  const materialized = structuredClone(result);
  const enriched = enrichWithOrgMapping(materialized, [
    { unit: "psn_unit_demo_00000002", department: "Platform" },
    { unit: "psn_unit_demo_00000003", department: "Platform" },
  ]);
  assert.equal(sourceReads, 0, "enrichment must not re-read the provider file");
  assert.equal(typeof localFinops.parseLocalFinopsFile, "function",
    "the parser exists and was simply never reached");

  // Two provider groups, one department: they merge, and the money is conserved.
  const platform = enriched.attribution.spendMix.units
    .find((entry) => entry.unit.key === "org-mapped:Platform");
  assert.ok(platform);
  assert.equal(platform.unit.source, ATTRIBUTION_SOURCES.orgMapped);
  assert.equal(platform.unit.label, "Platform");
  assert.equal(platform.spendUsd, 80);
  assert.equal(platform.records, 2);
  assertCoverageIdentity(enriched.attribution.spendMix, "enriched spend mix");

  // The bucket is never claimed by a department.
  const bucket = enriched.attribution.spendMix.units
    .find((entry) => entry.unit.key === UNATTRIBUTED_KEY);
  assert.equal(bucket.spendUsd, 20);
  assert.equal(enriched.attribution.spendMix.coverage.attributedShare, 0.8);

  // The delta is inspectable per figure, and re-keying moves no money.
  const byFigure = new Map(enriched.orgEnrichment.deltas.map((delta) => [delta.figure, delta]));
  assert.deepEqual([...byFigure.keys()], ["spendMix", "modelOverspend", "rankedRecoverable"]);
  assert.equal(byFigure.get("spendMix").before, 80);
  assert.equal(byFigure.get("spendMix").after, 80);
  assert.equal(byFigure.get("spendMix").difference, 0);
  assert.deepEqual(byFigure.get("spendMix").rekeyedUnits.map((entry) => entry.to),
    ["org-mapped:Platform", "org-mapped:Platform"]);
  assert.equal(byFigure.get("rankedRecoverable").difference, 0);
  // The input result is untouched: enrichment returns a new value.
  assert.equal(unitOf(materialized, "org-mapped:Platform"), null);
  assert.equal(materialized.attribution.spendMix.units.length, 3);
});

test("a partial mapping leaves attributed-but-unmapped units visible and attributed", async () => {
  const provider = await providerOnly([
    ["psn_unit_demo_00000002", 6000],
    ["psn_unit_demo_00000003", 2000],
    [null, 2000],
  ]);
  const result = normalizeLocalFinops({ provider });
  const enriched = enrichWithOrgMapping(result, [
    { unit: "psn_unit_demo_00000002", department: "Platform" },
    { unit: "psn_unit_never_exported", department: "Ghost" },
  ]);

  const survivor = enriched.attribution.spendMix.units
    .find((entry) => entry.unit.key === "provider-group:psn_unit_demo_00000003");
  assert.ok(survivor, "an unmapped unit must survive enrichment");
  assert.equal(survivor.unit.source, ATTRIBUTION_SOURCES.providerGroup,
    "attributed-but-unmapped is its own state, not unattributed");
  assert.equal(survivor.spendUsd, 20);
  assert.deepEqual(enriched.orgEnrichment.unmappedUnits,
    ["provider-group:psn_unit_demo_00000003"]);
  assert.deepEqual(enriched.orgEnrichment.unknownMappingUnits, ["psn_unit_never_exported"]);
  // Coverage is unchanged: re-keying never moves money across the line.
  assert.equal(enriched.attribution.spendMix.coverage.attributedShare,
    result.attribution.spendMix.coverage.attributedShare);
  assertCoverageIdentity(enriched.attribution.spendMix, "partially enriched spend mix");
});

test("a malformed mapping throws and leaves the input result untouched", async () => {
  const provider = await providerOnly([["psn_unit_demo_00000002", 6000], [null, 2000]]);
  const result = normalizeLocalFinops({ provider });
  const before = structuredClone(result.attribution.spendMix);

  for (const mapping of [
    "not-a-list",
    [{ unit: "psn_unit_demo_00000002" }],
    [{ unit: "psn_unit_demo_00000002", department: "  " }],
    [],
  ]) {
    assert.throws(() => enrichWithOrgMapping(result, mapping),
      (error) => error instanceof OrgMappingError && error.code === "malformed_org_mapping");
  }
  assert.deepEqual(structuredClone(result.attribution.spendMix), before,
    "a rejected mapping must never half-enrich the result it was handed");
});
