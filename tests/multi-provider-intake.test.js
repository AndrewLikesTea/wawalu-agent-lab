// The multi-provider intake contract: three adapters, one billing window.
//
// Every provider export in here is generated from the adapter's own declared
// shape rather than committed as a fixture, so a header spelling cannot drift
// away from the contract that claims to read it. Nothing in this file reaches
// the network, a credential, or a real export.

import assert from "node:assert/strict";
import test from "node:test";

import { DIALECT_PROFILES, columnNames, normalizeColumnName } from "../src/dialect-profiles.js";
import { parseLocalImportFile } from "../src/finops-tabular-import.js";
import { createColumnMapping } from "../src/import-column-mapping.js";
import { readDelimitedText } from "../src/delimited-text.js";
import { normalizeLocalFinopsHistory, parseLocalFinopsFile } from "../src/local-finops.js";
import {
  INTAKE_CODES, MULTI_PROVIDER_INTAKE_CONTRACT_ID, MULTI_PROVIDER_SOURCE_INSTANCE_ID,
  PROVIDER_ADAPTERS, SENSITIVITY_POLICY, adapterForProvider, adapterForShape,
  planMultiProviderIntake, screenSensitiveColumns,
} from "../src/multi-provider-intake.js";

// --- deterministic exports, one per adapter --------------------------------

const OPENAI_HEADER = "usage_date,project,model,n_context_tokens_total,n_generated_tokens_total,amount,currency";
const ANTHROPIC_HEADER = "date,workspace,model,input_tokens,output_tokens,cost_usd,currency";
const BEDROCK_HEADER = "line_item_usage_start_date,resourceTags/user:CostCenter,line_item_product_code,line_item_usage_amount,line_item_unblended_cost,line_item_currency_code";

/** One provider's export for one month, with a stable per-day amount. */
function openaiCsv({ month = "2026-01", days = 3, amount = "120.00", currency = "USD" } = {}) {
  const rows = Array.from({ length: days }, (_, index) =>
    `${month}-0${index + 1},Platform,gpt-5,1000,500,${amount},${currency}`);
  return [OPENAI_HEADER, ...rows].join("\n");
}

function anthropicCsv({ month = "2026-01", days = 3, amount = "80.00", currency = "USD" } = {}) {
  const rows = Array.from({ length: days }, (_, index) =>
    `${month}-0${index + 1},Platform,claude-sonnet-5,900,400,${amount},${currency}`);
  return [ANTHROPIC_HEADER, ...rows].join("\n");
}

function bedrockCsv({ month = "2026-01", days = 3, amount = "40.00", currency = "USD" } = {}) {
  const rows = Array.from({ length: days }, (_, index) =>
    `${month}-0${index + 1}T00:00:00Z,Platform,AmazonBedrock,1200,${amount},${currency}`);
  return [BEDROCK_HEADER, ...rows].join("\n");
}

const parse = (text, fileName) => parseLocalImportFile(text, fileName, "text/csv");

const openai = (options) => parse(openaiCsv(options), "openai.csv");
const anthropic = (options) => parse(anthropicCsv(options), "anthropic.csv");
const bedrock = (options) => parse(bedrockCsv(options), "bedrock.csv");

const spendMinor = (result) => result.rankedDepartments
  .reduce((sum, department) => sum + Math.round(department.spendUsd * 100), 0);

// --- the registry itself ----------------------------------------------------

test("every adapter declares a complete, versioned contract", () => {
  const shapes = new Set();
  for (const adapter of PROVIDER_ADAPTERS) {
    assert.match(adapter.adapterVersion, /^\d+\.\d+$/, `${adapter.id} needs an adapter version`);
    assert.ok(adapter.label && adapter.provider && adapter.packageId, `${adapter.id} is half-declared`);
    assert.equal(adapter.billingCurrency, "USD");
    assert.ok(adapter.comparability.costBasis && adapter.comparability.note);
    for (const key of ["partial", "stale", "malformed", "reordered", "incomplete", "mixedCurrency"]) {
      assert.ok(adapter.failureBehavior[key], `${adapter.id} does not state ${key} behaviour`);
    }
    assert.ok(adapter.sensitiveFields.length >= 3, `${adapter.id} declares too little sensitivity`);
    for (const shape of adapter.shapes) {
      assert.equal(shapes.has(shape), false, `${shape} is claimed by two adapters`);
      shapes.add(shape);
      assert.equal(adapterForShape(shape).id, adapter.id);
    }
    // Every declared dialect exists; an adapter cannot name a reader nobody has.
    for (const dialect of adapter.dialects) {
      assert.ok(DIALECT_PROFILES.some((profile) => profile.id === dialect), dialect);
    }
    assert.equal(adapterForProvider(adapter.provider).id, adapter.id);
  }
  assert.deepEqual([...PROVIDER_ADAPTERS].map((adapter) => adapter.provider),
    ["openai", "anthropic", "aws"], "declared order is the tie-break order");
});

test("a redacted column maps to no normalized field in any dialect profile", () => {
  const mapped = new Set(DIALECT_PROFILES
    .flatMap((profile) => profile.columns)
    .filter((column) => column.field)
    .flatMap((column) => columnNames(column))
    .map(normalizeColumnName));
  for (const adapter of PROVIDER_ADAPTERS) {
    for (const field of adapter.sensitiveFields) {
      if (field.policy !== SENSITIVITY_POLICY.redact) continue;
      for (const name of [field.name, ...field.aliases]) {
        assert.equal(mapped.has(normalizeColumnName(name)), false,
          `${adapter.id} calls “${name}” redacted, but a profile maps it`);
      }
    }
  }
});

// --- per-provider intake ----------------------------------------------------

test("each provider's own export imports on its own, unchanged", () => {
  for (const [label, entry] of [["openai", openai()], ["anthropic", anthropic()],
    ["bedrock", bedrock()]]) {
    const plan = planMultiProviderIntake({ providers: [entry] });
    assert.equal(plan.rejections.length, 0, label);
    assert.equal(plan.accepted.length, 1);
    // Byte-identical passthrough: the reconciler reads the same object.
    assert.equal(plan.accepted[0], entry, `${label} was rewritten on a single-provider path`);
    assert.equal(plan.summary.comparability.state, "single_provider");
    assert.equal(plan.summary.providers.length, 1);
    assert.match(plan.summary.provenance.adapters[0], /\/1\.0$/);
  }
});

test("provenance order is stable when the same files are selected in reverse", () => {
  const entries = [openai(), openai({ month: "2026-02" })];
  const forward = planMultiProviderIntake({ providers: entries });
  const reverse = planMultiProviderIntake({ providers: [...entries].reverse() });
  assert.deepEqual(reverse.summary.provenance, forward.summary.provenance);
  assert.equal(reverse.accepted[0], entries[1],
    "single-provider analysis still receives the untouched selection order");
});

test("three providers over one window become one combined period", () => {
  const plan = planMultiProviderIntake({
    providers: [openai(), anthropic(), bedrock()],
  });
  assert.equal(plan.rejections.length, 0);
  assert.equal(plan.accepted.length, 1, "one billing window, one period");
  assert.equal(plan.summary.comparability.state, "combined_bounded",
    "the CUR's unblended basis is a stated bound, not a silent one");
  assert.ok(plan.summary.comparability.notes.some((note) => /unblended/.test(note)));
  assert.equal(plan.summary.providerCount, 3);
  assert.deepEqual(plan.summary.providers.map((entry) => entry.provider),
    ["openai", "anthropic", "aws"]);
  const merged = plan.accepted[0].document;
  assert.equal(merged.snapshot.source_instance_id, MULTI_PROVIDER_SOURCE_INSTANCE_ID);
  assert.deepEqual([...new Set(merged.records.map((record) => record.provider))].sort(),
    ["anthropic", "aws", "openai"]);
  // The merged envelope is still a v1 contract document, not a private shape.
  const revalidated = parseLocalFinopsFile(JSON.stringify(merged), "merged.json", "application/json");
  assert.equal(revalidated.type, "provider");
  assert.equal(plan.summary.provenance.acceptedExportIds.length, 3);
  assert.equal(plan.summary.contractVersion, MULTI_PROVIDER_INTAKE_CONTRACT_ID);
});

test("the combined analysis adds every provider's spend", () => {
  const single = normalizeLocalFinopsHistory({ providers: [openai()] });
  const combined = normalizeLocalFinopsHistory({
    providers: [openai(), anthropic(), bedrock()],
  });
  // 3 days × (120 + 80 + 40).
  assert.equal(spendMinor(combined), 72_000);
  assert.equal(spendMinor(single), 36_000);
  assert.equal(combined.multiProvider.providerCount, 3);
  assert.deepEqual(combined.validation.quarantinedExportIds, [],
    "a well-formed multi-provider selection quarantines nothing");
});

test("the same window from one provider twice is still a duplicate period", () => {
  const plan = planMultiProviderIntake({
    providers: [
      openai(),
      // A different file, same provider, same window: the duplicate the
      // reconciler always refused, still refused under the same code.
      parse(openaiCsv({ amount: "121.00" }), "openai-second-export.csv"),
      anthropic(),
    ],
  });
  const codes = plan.rejections.map((entry) => entry.code);
  assert.deepEqual(codes, [INTAKE_CODES.DUPLICATE_PERIOD]);
  assert.equal(plan.rejections[0].provider, "openai");
  assert.match(plan.rejections[0].action, /repeated period/i);
  assert.equal(plan.accepted.length, 1);
});

test("overlapping-but-different windows are held out, not summed", () => {
  const january = openai();
  const straddling = parse([ANTHROPIC_HEADER,
    "2026-01-02,Platform,claude-sonnet-5,900,400,80.00,USD",
    "2026-02-02,Platform,claude-sonnet-5,900,400,80.00,USD",
  ].join("\n"), "anthropic-straddle.csv");
  const plan = planMultiProviderIntake({ providers: [january, straddling] });
  assert.deepEqual(plan.rejections.map((entry) => entry.code), [INTAKE_CODES.MISALIGNED_PERIOD]);
  assert.equal(plan.rejections[0].provider, "anthropic");
  assert.ok(plan.rejections[0].action.length > 0, "a rejection always carries its recovery");
  assert.equal(plan.accepted.length, 1);
});

test("a non-USD export is held out of the total rather than converted", () => {
  // The delimited path quarantines the foreign rows per row; the file itself
  // then carries no usable row at all, which is the deterministic refusal.
  assert.throws(() => anthropic({ currency: "EUR" }), (error) => {
    assert.equal(error.code, "unsupported_currency");
    return true;
  });
  // A v1 envelope that reached the planner in another currency is refused by
  // the contract itself, named by provider, with the adapter's own recovery.
  const usd = openai();
  const foreign = {
    document: {
      ...usd.document,
      export_id: "11111111-1111-4111-8111-111111111111",
      records: usd.document.records.map((record) => ({
        ...record, provider: "anthropic", cost: { ...record.cost, currency: "EUR" },
      })),
    },
  };
  const plan = planMultiProviderIntake({ providers: [usd, foreign] });
  assert.deepEqual(plan.rejections.map((entry) => entry.code),
    [INTAKE_CODES.UNSUPPORTED_CURRENCY]);
  assert.equal(plan.rejections[0].provider, "anthropic");
  assert.match(plan.rejections[0].message, /EUR/);
  assert.match(plan.rejections[0].action, /USD|own/i);
  assert.equal(plan.summary.comparability.state, "single_provider");
});

test("a mixed-currency file keeps USD evidence and reports the held-out row", () => {
  const mixed = parse([ANTHROPIC_HEADER,
    "2026-01-01,Platform,claude-sonnet-5,900,400,80.00,USD",
    "2026-01-02,Platform,claude-sonnet-5,900,400,75.00,EUR",
  ].join("\n"), "anthropic-mixed-currency.csv");
  assert.equal(mixed.document.records.length, 1);
  assert.equal(mixed.document.records[0].cost.currency, "USD");
  assert.ok(mixed.problems.some((problem) => problem.code === "unsupported_currency"),
    "the excluded currency must remain visible as remediation evidence");
  assert.equal(mixed.document.snapshot.completeness, "partial",
    "dropping a priced row must bound the retained total");
  assert.equal(mixed.document.snapshot.omitted_record_count, 1);
});

test("a partial or provisional export bounds the combined figure by name", () => {
  const settled = openai();
  const partial = anthropic();
  const bounded = {
    ...partial,
    document: {
      ...partial.document,
      snapshot: { ...partial.document.snapshot, completeness: "partial" },
    },
  };
  const plan = planMultiProviderIntake({ providers: [settled, bounded] });
  assert.equal(plan.summary.comparability.state, "combined_bounded");
  assert.ok(plan.summary.comparability.notes.some((note) => /floor/.test(note)));
  const anthropicEntry = plan.summary.providers.find((entry) => entry.provider === "anthropic");
  assert.equal(anthropicEntry.state, "partial_export");
  // The weakest claim wins: a merge never upgrades a partial input.
  assert.equal(plan.accepted[0].document.snapshot.completeness, "partial");
});

test("a stale export generated before its window closed is read as provisional", () => {
  const settled = openai();
  const early = anthropic();
  const provisional = {
    ...early,
    document: {
      ...early.document,
      snapshot: { ...early.document.snapshot, generated_at: "2026-01-02T00:00:00.000Z" },
    },
  };
  const plan = planMultiProviderIntake({ providers: [settled, provisional] });
  assert.equal(plan.summary.comparability.state, "combined_bounded");
  assert.ok(plan.summary.comparability.notes.some((note) => /provisional/.test(note)));
  // The merged snapshot carries the oldest generation time, not the newest.
  assert.equal(plan.accepted[0].document.snapshot.generated_at, "2026-01-02T00:00:00.000Z");
});

test("two source instances of one provider are still incompatible", () => {
  const first = openai();
  const second = {
    document: {
      ...first.document,
      export_id: "22222222-2222-4222-8222-222222222222",
      snapshot: { ...first.document.snapshot, source_instance_id: "psn_other_openai_source_0001" },
    },
  };
  const plan = planMultiProviderIntake({ providers: [first, second, anthropic()] });
  assert.deepEqual(plan.rejections.map((entry) => entry.code), [INTAKE_CODES.INCOMPATIBLE_SOURCE]);
  assert.equal(plan.rejections[0].provider, "openai");
});

test("a window only one provider covered still joins a combined selection", () => {
  const plan = planMultiProviderIntake({
    providers: [openai(), anthropic(), openai({ month: "2026-02" })],
  });
  assert.equal(plan.rejections.length, 0);
  assert.equal(plan.accepted.length, 2, "January and February both survive");
  for (const entry of plan.accepted) {
    assert.equal(entry.document.snapshot.source_instance_id, MULTI_PROVIDER_SOURCE_INSTANCE_ID,
      "a combined selection declares one source instance across its windows");
  }
  const analysis = normalizeLocalFinopsHistory({ providers: [
    openai(), anthropic(), openai({ month: "2026-02" }),
  ] });
  assert.equal(analysis.history.periodCount, 2);
  assert.equal(analysis.validation.quarantinedExportIds.length, 0);
});

// --- sensitive fields -------------------------------------------------------

test("a prompt column is refused at the header row", () => {
  const withPrompt = [`${OPENAI_HEADER},prompt`,
    "2026-01-01,Platform,gpt-5,1000,500,120.00,USD,how do I reduce spend"].join("\n");
  assert.throws(() => parse(withPrompt, "openai-with-prompt.csv"), (error) => {
    assert.equal(error.code, "sensitive_field_present");
    assert.match(error.message, /prompt/);
    // The column name, never the cell.
    assert.equal(/how do I reduce spend/.test(error.message), false);
    return true;
  });
  assert.equal(screenSensitiveColumns(["usage_date", "completion_text"]).ok, false);
  assert.equal(screenSensitiveColumns(["usage_date", "project", "amount"]).ok, true);
});

test("a redacted column is listed for mapping but never sampled", () => {
  const withEmail = [`${OPENAI_HEADER},user_email`,
    "2026-01-01,Platform,gpt-5,1000,500,120.00,USD,lead@example.com"].join("\n");
  const reading = readDelimitedText(withEmail);
  const state = createColumnMapping({ reading, fileName: "openai.csv" });
  const column = state.columns.find((entry) => entry.header === "user_email");
  assert.ok(column, "the column is still listed so the reader can correct it");
  assert.equal(column.sample.available, false);
  assert.equal(/lead@example\.com/.test(JSON.stringify(state)), false,
    "no address reaches the review state");
  // And it never reaches the normalized evidence either.
  const parsed = parse(withEmail, "openai-with-email.csv");
  assert.equal(/lead@example\.com/.test(JSON.stringify(parsed)), false);
});

// --- malformed, reordered, and the original single-provider path ------------

test("malformed rows are located and skipped; the rest of the file imports", () => {
  const broken = [OPENAI_HEADER,
    "2026-01-01,Platform,gpt-5,1000,500,120.00,USD",
    "not-a-date,Platform,gpt-5,1000,500,120.00,USD",
    "2026-01-03,Platform,gpt-5,1000,500,not-a-number,USD",
  ].join("\n");
  const parsed = parse(broken, "openai-broken.csv");
  assert.ok(parsed.problems.length >= 2);
  const codes = new Set(parsed.problems.map((problem) => problem.code));
  assert.ok(codes.has("invalid_amount") && codes.has("unparseable_date"));
  assert.equal(parsed.document.records.length, 1, "the readable row still imports");
  const plan = planMultiProviderIntake({ providers: [parsed] });
  assert.equal(plan.rejections.length, 0, "a partly-read file is still a readable provider");
  // Skipped rows shrink the window, so the same file beside another provider's
  // full month is a misalignment — reported, with its recovery, never summed.
  const beside = planMultiProviderIntake({ providers: [parsed, anthropic()] });
  assert.deepEqual(beside.rejections.map((entry) => entry.code), [INTAKE_CODES.MISALIGNED_PERIOD]);
  assert.ok(beside.rejections[0].action.length > 0);
});

test("a reordered header imports identically", () => {
  const reordered = ["currency,amount,project,model,n_context_tokens_total,n_generated_tokens_total,usage_date",
    "USD,120.00,Platform,gpt-5,1000,500,2026-01-01"].join("\n");
  const straight = parse([OPENAI_HEADER,
    "2026-01-01,Platform,gpt-5,1000,500,120.00,USD"].join("\n"), "openai.csv");
  const shuffled = parse(reordered, "openai.csv");
  assert.deepEqual(shuffled.document.records.map((record) => record.cost.amount_minor),
    straight.document.records.map((record) => record.cost.amount_minor));
});

test("the original single-provider import path is unchanged", () => {
  const january = openai();
  const february = openai({ month: "2026-02" });
  const analysis = normalizeLocalFinopsHistory({ providers: [january, february] });
  assert.equal(analysis.history.periodCount, 2);
  // Two three-day windows a month apart are not contiguous, and the shipped
  // trend rule says so exactly as it did before this contract existed.
  assert.equal(analysis.history.state, "incompatible");
  assert.equal(analysis.multiProvider.comparability.state, "single_provider");
  assert.equal(analysis.multiProvider.providerCount, 1);
  // The documents the analysis read are the documents that were selected: no
  // merge, no restamped source instance, no rewritten export id.
  assert.equal(analysis.decisionInputs.provenance.providerSourceInstanceId,
    january.document.snapshot.source_instance_id);
  assert.deepEqual(analysis.decisionInputs.provenance.acceptedProviderExportIds,
    [january.document.export_id, february.document.export_id]);
});

test("an empty selection still fails on the contract it always failed on", () => {
  assert.throws(() => normalizeLocalFinopsHistory({ providers: [] }), (error) => {
    assert.equal(error.code, "missing_provider");
    return true;
  });
});
