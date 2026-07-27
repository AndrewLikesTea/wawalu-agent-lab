// What one provider export may claim — pinned at the boundaries.
//
// Two halves. The first is arithmetic: `attributedSpendShare` over line items,
// including the two cases a share can be wrong in a way nobody notices — a zero
// denominator, and the PROVIDER_ONLY case where the numerator is 0 by
// construction. The second is the policy: the classification table at 0.49,
// 0.50, 0.79 and 0.80, and the promise that below the floor no ranked savings
// figure is rendered anywhere on the shipped markup.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseHtml, textOf } from "./support/browser.js";
import {
  ATTRIBUTION_FULL_CONFIDENCE_MIN, ATTRIBUTION_RANKED_FINDING_FLOOR,
  attributedSpendShare, attributionShareFromTotals, classifyFinding, classifyFindings,
  CLASSIFICATION_TABLE, CONFIDENCE, FINDING_CATEGORIES, INPUT_STATES,
  largestConcentrationLine, ORG_MAPPING_REQUIREMENT_STATUS, PRE_UPLOAD_STATEMENTS,
  providerExportInputState, suppressedSavingsFallback, toWholePercent, unattributedShare,
  unattributedShareText,
} from "../src/finops-attribution-policy.js";
import {
  applyAttributionNote, applyPreUploadDisclosure, applySuppressedSavings,
} from "../src/finops-attribution-view.js";
import { mappingRequirements } from "../src/local-import-flow.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const page = async () => parseHtml(await readFile(PAGE, "utf8"));

const item = (cost, groupingKey = null, provider = "openai", service = "chat") =>
  ({ cost, groupingKey, provider, service });

/** Line items whose attributed share is exactly `share`, over 1000 of spend. */
const itemsWithShare = (share) => [
  item(1000 * share, "unit-a"),
  item(1000 * (1 - share), null),
];

// --- the metric ------------------------------------------------------------

test("attributed spend share divides attributed cost by every line item's cost", () => {
  const share = attributedSpendShare([
    item(600, "unit-a"), item(150, "unit-b"), item(250, ""),
  ]);
  assert.equal(share.share, 0.75);
  assert.equal(share.attributedCost, 750);
  assert.equal(share.totalCost, 1000);
  assert.equal(share.attributedRows, 2);
  assert.equal(share.totalRows, 3);
});

test("the denominator excludes nothing — not credits, taxes, or zero-cost rows", () => {
  // A credit is a negative cost row and a tax line carries no grouping value.
  // Both are spend the export contains, so both are in the denominator.
  const share = attributedSpendShare([
    item(1000, "unit-a"), item(-200, "unit-a"), item(200, ""), item(0, ""),
  ]);
  assert.equal(share.totalCost, 1000);
  assert.equal(share.attributedCost, 800);
  assert.equal(share.share, 0.8);
  assert.equal(share.totalRows, 4, "a zero-cost row is still a row in the export");
});

test("a zero denominator makes the share undefined, and undefined is below the floor", () => {
  const empty = attributedSpendShare([]);
  assert.equal(empty.share, null);
  assert.equal(empty.defined, false);

  const zeroCost = attributedSpendShare([item(0, "unit-a"), item(0, null)]);
  assert.equal(zeroCost.share, null, "0 / 0 is not a share of zero, and not a share of one");

  // The page must treat it as below the floor, not as an unknown to be waved
  // through: the headline is suppressed and no savings figure is offered.
  const classification = classifyFinding(
    FINDING_CATEGORIES.RECOVERABLE_SAVINGS, INPUT_STATES.PROVIDER_PLUS_GROUPING, empty.share,
  );
  assert.equal(classification.confidence, CONFIDENCE.SUPPRESSED);
  assert.equal(classification.showsRankedSavings, false);
});

test("PROVIDER_ONLY has a numerator of 0 by construction, so its share is 0", () => {
  const share = attributedSpendShare([item(400, null), item(600, "   ")]);
  assert.equal(share.share, 0);
  assert.equal(share.defined, true, "0 is measured here — the spend exists, the grouping does not");
  assert.equal(share.totalCost, 1000);
  assert.equal(
    classifyFinding(FINDING_CATEGORIES.RECOVERABLE_SAVINGS, INPUT_STATES.PROVIDER_ONLY, share.share)
      .confidence,
    CONFIDENCE.SUPPRESSED,
  );
});

test("a grouping key that resolves to no known group is not attributed", () => {
  const items = [item(500, "unit-a"), item(500, "unit-ghost")];
  assert.equal(attributedSpendShare(items).share, 1, "with no roster, the export's own keys are the groups");
  assert.equal(attributedSpendShare(items, { knownGroups: ["unit-a"] }).share, 0.5);
});

test("share from totals is the same ratio, clamped against an impossible numerator", () => {
  assert.equal(attributionShareFromTotals({ attributedCost: 40, totalCost: 50 }).share, 0.8);
  assert.equal(attributionShareFromTotals({ attributedCost: 0, totalCost: 0 }).share, null);
  assert.equal(attributionShareFromTotals({ attributedCost: 90, totalCost: 50 }).share, 1,
    "attributed above total is a defect upstream, never a share above 1");
});

// --- the unattributed figure a degraded finding must carry -----------------

test("unattributed share is the complement, rounded to whole percent, half up", () => {
  assert.equal(unattributedShare(0.625), 0.375);
  assert.equal(toWholePercent(0.375), 38, "37.5% rounds up, not to even");
  assert.equal(toWholePercent(0.005), 1);
  assert.equal(toWholePercent(0.5049), 50);
  assert.equal(toWholePercent(0.505), 51);
  assert.equal(unattributedShareText(0.625), "38% of spend is unattributed");
  assert.equal(unattributedShareText(0.79), "21% of spend is unattributed");
});

test("an undefined share has no complement to print", () => {
  assert.equal(unattributedShare(null), null);
  assert.equal(toWholePercent(null), null);
  assert.equal(unattributedShareText(null), null);
});

// --- the input states ------------------------------------------------------

test("the three input states are decided by the grouping column and the org file", () => {
  assert.equal(providerExportInputState({ hasProviderExport: false }), null);
  assert.equal(
    providerExportInputState({ hasProviderExport: true }),
    INPUT_STATES.PROVIDER_ONLY,
  );
  assert.equal(
    providerExportInputState({ hasProviderExport: true, hasGroupingColumn: true }),
    INPUT_STATES.PROVIDER_PLUS_GROUPING,
  );
  assert.equal(
    providerExportInputState({
      hasProviderExport: true, hasGroupingColumn: true, hasOrgMapping: true,
    }),
    INPUT_STATES.PROVIDER_PLUS_ORG_MAPPING,
  );
  // An org file with no grouping column has nothing to rename.
  assert.equal(
    providerExportInputState({ hasProviderExport: true, hasOrgMapping: true }),
    INPUT_STATES.PROVIDER_ONLY,
  );
});

// --- the classification table ----------------------------------------------

test("concentration and mix are full confidence in all three states", () => {
  for (const category of [FINDING_CATEGORIES.SPEND_CONCENTRATION, FINDING_CATEGORIES.MODEL_SERVICE_MIX]) {
    for (const state of Object.values(INPUT_STATES)) {
      assert.equal(CLASSIFICATION_TABLE[category][state], CONFIDENCE.FULL);
      // Even with no attribution at all: these findings need only line items.
      assert.equal(classifyFinding(category, state, 0).confidence, CONFIDENCE.FULL);
    }
  }
});

test("a team, owner, or cost-center claim is gated by the state, not by the share", () => {
  const team = FINDING_CATEGORIES.TEAM_ATTRIBUTION;
  assert.equal(classifyFinding(team, INPUT_STATES.PROVIDER_ONLY, 1).confidence, CONFIDENCE.SUPPRESSED);
  const degraded = classifyFinding(team, INPUT_STATES.PROVIDER_PLUS_GROUPING, 0.7);
  assert.equal(degraded.confidence, CONFIDENCE.DEGRADED);
  assert.equal(degraded.unattributedText, "30% of spend is unattributed",
    "a degraded finding carries the figure, never a bare word");
  assert.equal(
    classifyFinding(team, INPUT_STATES.PROVIDER_PLUS_ORG_MAPPING, 0.7).confidence,
    CONFIDENCE.FULL,
  );
});

test("the recoverable headline is classified at each published boundary", () => {
  const at = (share) => classifyFinding(
    FINDING_CATEGORIES.RECOVERABLE_SAVINGS, INPUT_STATES.PROVIDER_PLUS_GROUPING, share,
  );
  assert.equal(ATTRIBUTION_RANKED_FINDING_FLOOR, 0.50);
  assert.equal(ATTRIBUTION_FULL_CONFIDENCE_MIN, 0.80);

  assert.equal(at(0.49).confidence, CONFIDENCE.SUPPRESSED);
  assert.equal(at(0.49).showsRankedSavings, false);
  assert.equal(at(0.49).render, false);

  // The comparison is `>=` at the floor, so 0.50 itself is degraded.
  assert.equal(at(0.50).confidence, CONFIDENCE.DEGRADED);
  assert.equal(at(0.50).showsRankedSavings, true);
  assert.equal(at(0.50).unattributedPercent, 50);
  assert.equal(at(0.50).unattributedText, "50% of spend is unattributed");

  assert.equal(at(0.79).confidence, CONFIDENCE.DEGRADED);
  assert.equal(at(0.79).unattributedPercent, 21);

  // And `>=` at the top boundary, so 0.80 itself is full confidence.
  assert.equal(at(0.80).confidence, CONFIDENCE.FULL);
  assert.equal(at(0.80).showsRankedSavings, true);
  assert.equal(at(0.80).unattributedText, null,
    "a full-confidence finding carries no degradation figure");
  assert.equal(at(1).confidence, CONFIDENCE.FULL);
});

test("the boundaries hold when the share is measured rather than passed in", () => {
  const state = INPUT_STATES.PROVIDER_PLUS_GROUPING;
  const confidenceAt = (share) => classifyFinding(
    FINDING_CATEGORIES.RECOVERABLE_SAVINGS, state, attributedSpendShare(itemsWithShare(share)).share,
  ).confidence;
  assert.equal(confidenceAt(0.49), CONFIDENCE.SUPPRESSED);
  assert.equal(confidenceAt(0.50), CONFIDENCE.DEGRADED);
  assert.equal(confidenceAt(0.79), CONFIDENCE.DEGRADED);
  assert.equal(confidenceAt(0.80), CONFIDENCE.FULL);
});

test("every category is classified for every state, with no gap to fall through", () => {
  for (const state of Object.values(INPUT_STATES)) {
    const all = classifyFindings(state, 0.9);
    assert.deepEqual(
      Object.keys(all).sort(), Object.values(FINDING_CATEGORIES).sort(),
    );
    for (const classification of Object.values(all)) {
      assert.ok(Object.values(CONFIDENCE).includes(classification.confidence));
      assert.ok(classification.rule.length > 0, "every classification says why");
    }
  }
});

// --- the concentration line and the below-floor fallback -------------------

test("the largest concentration line is the costliest provider and service pair", () => {
  const line = largestConcentrationLine([
    item(400, null, "openai", "gpt-4o"), item(500, null, "openai", "embeddings"),
    item(200, null, "openai", "gpt-4o"),
  ]);
  assert.equal(line.available, true);
  assert.equal(line.label, "openai · gpt-4o", "500 in one line loses to 400 + 200 in another");
  assert.equal(line.cost, 600);
  assert.equal(line.share, 600 / 1100);

  // A tie breaks on the label, so the same file always names the same line.
  const tied = largestConcentrationLine([
    item(100, null, "aws", "bedrock"), item(100, null, "azure", "openai"),
  ]);
  assert.equal(tied.label, "aws · bedrock");
  assert.equal(largestConcentrationLine([]).available, false);
});

test("the below-floor fallback names spend and concentration, and no savings figure", () => {
  const items = [item(700, null, "openai", "gpt-4o"), item(300, null, "openai", "embeddings")];
  const fallback = suppressedSavingsFallback({
    inputState: INPUT_STATES.PROVIDER_ONLY, share: 0, lineItems: items,
  });
  assert.equal(fallback.showsRankedSavings, false);
  assert.equal(fallback.totalCost, 1000);
  assert.equal(fallback.concentration.label, "openai · gpt-4o");
  assert.equal(fallback.unattributedPercent, 100);
  assert.match(fallback.raiseConfidence, /grouping column|org mapping file/);
  // The only money on this object is spend observed and the concentration line.
  // No savings figure, no range, no hedged amount — there is no field that could
  // carry one, so a consuming surface has nothing to render as recoverable.
  const money = Object.entries(fallback)
    .filter(([, value]) => typeof value === "number" && value !== 0)
    .map(([key]) => key);
  assert.deepEqual(money, ["totalCost", "unattributedShare", "unattributedPercent"],
    "spend observed, and the share that is not attributed — no third amount");
  assert.equal("recoverableCost" in fallback, false);
  assert.equal("savingsRange" in fallback, false);
  assert.deepEqual(Object.keys(fallback.concentration).sort(),
    ["available", "cost", "label", "share", "totalCost"]);
});

// --- what the reader actually sees on the shipped markup -------------------

test("the page states what one export answers before any file is selected", async () => {
  const doc = await page();
  const painted = applyPreUploadDisclosure(doc);
  const list = doc.getElementById("pre-upload-disclosure");
  const statements = doc.querySelectorAll("li")
    .filter((node) => node.className === "pre-upload-statement");
  assert.equal(painted.length, 3, "three statements: the question, the metric, the action");
  assert.deepEqual(statements.map((node) => textOf(node)), [...PRE_UPLOAD_STATEMENTS]);
  assert.match(textOf(list), /which model or service line/);
  assert.match(textOf(list), /recoverable spend/);
  assert.match(textOf(list), /one prioritized action/);
  // It is three sentences in the panel that already exists — not a new section,
  // panel, or expander.
  assert.equal(list.tagName.toLowerCase(), "ul");
  assert.equal(doc.querySelectorAll("details")
    .filter((node) => node.className === "pre-upload-disclosure").length, 0);
});

test("below the floor the page shows spend and concentration, never a savings number", async () => {
  const doc = await page();
  const items = [item(700, null, "openai", "gpt-4o"), item(300, null, "openai", "embeddings")];
  const share = attributedSpendShare(items);
  const classification = classifyFinding(
    FINDING_CATEGORIES.RECOVERABLE_SAVINGS, INPUT_STATES.PROVIDER_ONLY, share.share,
  );
  applyAttributionNote(doc, classification);
  applySuppressedSavings(doc, suppressedSavingsFallback({
    inputState: INPUT_STATES.PROVIDER_ONLY, share: share.share, lineItems: items,
  }), { formatMoney: (value) => `${value.toFixed(2)} USD` });

  const region = doc.getElementById("local-attribution-fallback");
  assert.equal(region.hidden, false);
  assert.equal(region.dataset.state, "suppressed");
  const text = textOf(region);
  assert.match(text, /Total spend observed: 1000\.00 USD/);
  assert.match(text, /Largest concentration line: openai · gpt-4o at 700\.00 USD/);
  assert.match(text, /grouping column/);
  // No ranked savings figure is rendered. Exactly two amounts appear — the spend
  // observed and the concentration line — so there is no third number a reader
  // could take away as recoverable, hedged or otherwise.
  assert.deepEqual(text.match(/[\d.]+ USD/g), ["1000.00 USD", "700.00 USD"]);
  const note = doc.getElementById("local-attribution-note");
  assert.equal(note.hidden, false);
  assert.match(textOf(note), /Suppressed/);
  assert.equal(doc.getElementById("local-recoverable").dataset.confidence, "SUPPRESSED");
});

test("a degraded finding is shown with its unattributed share beside the number", async () => {
  const doc = await page();
  const classification = classifyFinding(
    FINDING_CATEGORIES.RECOVERABLE_SAVINGS, INPUT_STATES.PROVIDER_PLUS_GROUPING, 0.62,
  );
  applyAttributionNote(doc, classification);
  applySuppressedSavings(doc, null);
  const note = doc.getElementById("local-attribution-note");
  assert.equal(note.dataset.state, "degraded");
  assert.match(textOf(note), /Degraded confidence · 38% of spend is unattributed/);
  assert.equal(doc.getElementById("local-attribution-fallback").hidden, true,
    "a degraded finding still shows its number, so no fallback stands in for it");
});

test("a full-confidence finding carries no qualifier at all", async () => {
  const doc = await page();
  applyAttributionNote(doc, classifyFinding(
    FINDING_CATEGORIES.RECOVERABLE_SAVINGS, INPUT_STATES.PROVIDER_PLUS_ORG_MAPPING, 0.95,
  ));
  const note = doc.getElementById("local-attribution-note");
  assert.equal(note.hidden, true);
  assert.equal(textOf(note), "");
  assert.equal(doc.getElementById("local-recoverable").dataset.confidence, "FULL_CONFIDENCE");
});

// --- the requirement the policy demotes ------------------------------------

test("the org mapping requirement reads as optional and blocks nothing", () => {
  const rows = mappingRequirements({ providers: 1, hris: false });
  const orgMapping = rows.find((row) => row.id === "hris");
  assert.equal(orgMapping.required, false);
  assert.equal(orgMapping.state, "optional");
  assert.match(orgMapping.status, new RegExp(ORG_MAPPING_REQUIREMENT_STATUS));
  assert.equal(rows.filter((row) => row.state === "missing").length, 0,
    "with a provider export in hand, nothing is missing");
});
