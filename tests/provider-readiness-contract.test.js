// The provider-readiness contract (#1062): the errand a reader hands to whoever
// owns the billing account, and the one-row sample that proves the errand was
// stated correctly.
//
// The load-bearing test in this file is the round trip. A guidance card is a
// claim about what the importer accepts, and prose cannot be checked against
// code — so every sample is serialized to the exact bytes the download control
// produces and fed back through the SHIPPING recognition entry point. If a card
// names a column set no importer would recognize, this fails.
//
// The list is driven from the contract, never enumerated here, so a sixth
// provider is covered by these tests on the day it is added.

import test from "node:test";
import assert from "node:assert/strict";

import {
  PROVIDER_READINESS, STATIC_DEMO_DISCLOSURE, assertProviderSetsAgree,
  providerReadinessById, serializeProviderSample,
} from "../src/provider-readiness-contract.js";
import {
  DETECTABLE_PROVIDER_IDS, PROVIDER_ORDER, detectAndNormalizeExport,
} from "../src/export-provider-detection.js";
import { contractById } from "../src/browser-compat-contracts.js";

const detectionEntry = (id) => PROVIDER_ORDER.find((entry) => entry.provider === id);

test("every recognized provider has an errand, in the recognition source's order", () => {
  assert.deepEqual(PROVIDER_READINESS.map((entry) => entry.id), [...DETECTABLE_PROVIDER_IDS]);
  assert.equal(PROVIDER_READINESS.length, 5, "the demo accepts five provider exports");
});

test("a provider in one source and not the other fails loudly rather than shipping a gap", () => {
  assert.equal(assertProviderSetsAgree(), true, "the shipped pair agrees");
  assert.throws(() => assertProviderSetsAgree([...DETECTABLE_PROVIDER_IDS, "sixth-provider"]),
    /Recognized but undescribed: sixth-provider/);
  assert.throws(() => assertProviderSetsAgree(DETECTABLE_PROVIDER_IDS.slice(1)),
    /Described but unrecognized: /);
});

test("required columns are the recognition source's own columns, not a retyped list", () => {
  for (const provider of PROVIDER_READINESS) {
    const entry = detectionEntry(provider.id);
    const declared = new Set([...entry.signature, ...Object.values(entry.roles)]);
    assert.deepEqual([...provider.requiredColumns].sort(), [...declared].sort(),
      `${provider.id} must require exactly what detection scores it on`);
    // Every billing role the importer reads is named, in reading order.
    assert.ok(provider.requiredColumns.length >= 6, `${provider.id} names all six billing roles`);
  }
});

test("required columns match the published browser-compat contract where there is one", () => {
  for (const provider of PROVIDER_READINESS) {
    const contract = contractById(provider.id);
    if (!contract) {
      // The two exports with no published contract claim no optional columns
      // rather than an invented set: an optional column nothing publishes is a
      // claim this contract has no source for.
      assert.deepEqual(provider.optionalColumns, [],
        `${provider.id} has no published contract, so it may claim no optional columns`);
      continue;
    }
    assert.deepEqual(provider.requiredColumns,
      contract.requiredFields.map((field) => field.path),
      `${provider.id} required columns must be the contract's required fields`);
    assert.deepEqual(provider.optionalColumns,
      contract.optionalFields.map((field) => field.path),
      `${provider.id} optional columns must be the contract's optional fields`);
    for (const path of contract.exportShape.signatureFields) {
      assert.ok(provider.requiredColumns.includes(path),
        `${provider.id} must require its signature column ${path}`);
    }
  }
});

test("the sample is the format that provider's adapter parses, with a matching filename", () => {
  const extension = (name) => name.slice(name.lastIndexOf(".") + 1);
  for (const provider of PROVIDER_READINESS) {
    assert.equal(provider.sampleFormat, detectionEntry(provider.id).format,
      `${provider.id} must not be offered a sample in a format its adapter does not parse`);
    assert.equal(extension(provider.sampleFilename), provider.sampleFormat);
    assert.ok(provider.sampleMediaType, `${provider.id} needs a media type for its download`);
  }
  // The five are NOT all CSV, which is the whole reason the format is declared.
  assert.deepEqual([...new Set(PROVIDER_READINESS.map((entry) => entry.sampleFormat))].sort(),
    ["csv", "json", "jsonl"]);
});

test("the sample row carries a value for every required column and nothing else", () => {
  for (const provider of PROVIDER_READINESS) {
    assert.deepEqual(Object.keys(provider.sampleRow), [...provider.requiredColumns]);
    for (const column of provider.requiredColumns) {
      const value = provider.sampleRow[column];
      assert.ok(value !== undefined && value !== null && String(value) !== "",
        `${provider.id} must give ${column} a plausible value`);
    }
  }
});

// --- the round trip ---------------------------------------------------------

test("every generated sample is recognized as its own provider by the shipping code", () => {
  for (const provider of PROVIDER_READINESS) {
    const text = serializeProviderSample(provider);
    const verdict = detectAndNormalizeExport(text);
    assert.equal(verdict.provider, provider.id,
      `${provider.id}'s sample must be recognized as ${provider.id}, not `
      + `${verdict.provider} (${verdict.reason.code})`);
    assert.equal(verdict.displayName, detectionEntry(provider.id).displayName);
    assert.equal(verdict.normalizedProjection.rowCount, 1, "the sample is one row");
    assert.equal(verdict.normalizedProjection.missingRoles.length, 0,
      `${provider.id}'s sample must carry every billing role`);
  }
});

test("the two AWS-family samples are told apart, not scored apart", () => {
  const bedrock = detectAndNormalizeExport(serializeProviderSample("bedrock"));
  const aws = detectAndNormalizeExport(serializeProviderSample("aws"));
  assert.equal(bedrock.provider, "bedrock");
  assert.equal(aws.provider, "aws");
  // The general report's sample must not name Bedrock anywhere: the family
  // discriminator reads the text, so a Bedrock token in a cell would silently
  // relabel this file.
  assert.doesNotMatch(serializeProviderSample("aws").toLowerCase(), /bedrock/);
});

// --- serialization ----------------------------------------------------------

test("a CSV sample is a header row and one data row, in the declared column order", () => {
  const provider = PROVIDER_READINESS.find((entry) => entry.sampleFormat === "csv");
  const [header, row, trailing] = serializeProviderSample(provider).split("\n");
  assert.deepEqual(header.split(","), [...provider.requiredColumns]);
  assert.equal(row.split(",").length, provider.requiredColumns.length);
  assert.equal(trailing, "", "the file ends with a newline");
});

test("a CSV cell carrying a delimiter or a quote is quoted rather than shipped raw", () => {
  const provider = PROVIDER_READINESS.find((entry) => entry.sampleFormat === "csv");
  const column = provider.requiredColumns[1];
  const awkward = {
    ...provider,
    sampleRow: { ...provider.sampleRow, [column]: 'gpt-4o, "mini"' },
  };
  const [, row] = serializeProviderSample(awkward).split("\n");
  assert.match(row, /"gpt-4o, ""mini"""/);
});

test("a JSONL sample is one complete object on one line, with dotted paths nested", () => {
  const provider = PROVIDER_READINESS.find((entry) => entry.sampleFormat === "jsonl");
  const text = serializeProviderSample(provider);
  assert.equal(text.split("\n").filter(Boolean).length, 1);
  const record = JSON.parse(text);
  for (const column of provider.requiredColumns) {
    const value = column.split(".").reduce((node, key) => node?.[key], record);
    assert.equal(value, provider.sampleRow[column], `${column} must survive nesting`);
  }
});

test("a JSON sample puts its record where the provider's contract says records live", () => {
  const provider = PROVIDER_READINESS.find((entry) => entry.sampleFormat === "json");
  const envelope = JSON.parse(serializeProviderSample(provider));
  const contract = contractById(provider.id);
  assert.ok(contract.exportShape.recordLocation.startsWith(provider.recordPath),
    "the declared record path must be the one the published contract documents");
  const rows = provider.recordPath.split(".").reduce((node, key) => node?.[key], envelope);
  assert.equal(Array.isArray(rows), true, "records live in an array");
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], provider.sampleRow);
});

test("an unknown provider id serializes to nothing rather than throwing", () => {
  assert.equal(serializeProviderSample("not-a-provider"), "");
  assert.equal(providerReadinessById("not-a-provider"), null);
});

// --- the guidance a reader acts on ------------------------------------------

test("every provider states where the export lives and which period to pull", () => {
  for (const provider of PROVIDER_READINESS) {
    assert.ok(provider.displayName.length > 2, `${provider.id} needs a human name`);
    assert.ok(provider.consoleLocation.length > 60,
      `${provider.id} must state a navigation path, not a console name`);
    assert.match(provider.consoleLocation, /→/,
      `${provider.id} must state the path as steps a non-engineer can follow`);
    assert.ok(provider.dateRangeGuidance.length > 40,
      `${provider.id} must say which date range to pull`);
  }
});

test("the disclosure names all three of the promises this demo makes", () => {
  assert.match(STATIC_DEMO_DISCLOSURE, /static demo/i);
  assert.match(STATIC_DEMO_DISCLOSURE, /no credential is requested/i);
  assert.match(STATIC_DEMO_DISCLOSURE, /no provider account is connected/i);
  assert.match(STATIC_DEMO_DISCLOSURE, /no file is transmitted anywhere/i);
});
