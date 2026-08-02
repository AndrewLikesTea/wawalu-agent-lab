// Bundled examples for the provider-native intake (#930). Deterministic: every
// value is a literal or is derived from a published contract, nothing reads a
// clock, a locale or a random source, so an example reaches the same finding on
// every machine on every day.
//
// The representative export per provider is REUSED from the compatibility
// check's fixtures rather than written a second time — two files claiming to be
// "a representative Bedrock export" and disagreeing is the drift this avoids.
//
// The one fixture written here is the case the surface got wrong: an export
// whose columns are all present and whose unit counts are unusable. It is not a
// broken file. It is what a zero-usage period, a credits-only slice, or an
// export configured without the usage column actually looks like, and it clears
// the recognition gate because recognition scores columns and signatures rather
// than cell values.

import { contractById } from "./browser-compat-contracts.js";
import { BROWSER_COMPAT_FIXTURES } from "./browser-compat-fixtures.js";

const example = (spec) => Object.freeze(spec);

// Built from the contract's own required-field order, so the header is complete
// by construction: no column list is typed out here to drift from the contract.
const BEDROCK = contractById("bedrock");
const HEADER = BEDROCK.requiredFields.map((field) => field.path);

// Column order follows HEADER: date, model, units, cost, currency, account.
// The unit counts are the only unusable cells — one blank, two zero, which are
// the two ways a real export loses them.
const NO_UNITS_ROWS = [
  ["2026-07-20", "anthropic.claude-sonnet", "0", "0.00", "USD", "000000000001"],
  ["2026-07-21", "amazon.titan-text", "", "0.00", "USD", "000000000001"],
  ["2026-07-22", "anthropic.claude-sonnet", "0", "0.00", "USD", "000000000001"],
];

const csv = (header, rows) => `${[header, ...rows].map((row) => row.join(",")).join("\n")}\n`;

/** The id of the fixture that clears the recognition gate with no usable rate. */
export const NO_UNIT_COUNT_EXAMPLE_ID = "bedrock-no-unit-counts";

export const NO_UNIT_COUNT_EXAMPLE = example({
  id: NO_UNIT_COUNT_EXAMPLE_ID,
  providerId: "bedrock",
  label: "Every column present, no billed units — a zero-usage period",
  fileName: "bedrock-no-unit-counts.csv",
  text: csv(HEADER, NO_UNITS_ROWS),
});

const REPRESENTATIVE_IDS = ["bedrock-supported", "vertex-ai-supported", "azure-openai-supported"];

const reused = REPRESENTATIVE_IDS
  .map((id) => BROWSER_COMPAT_FIXTURES.find((fixture) => fixture.id === id))
  .filter(Boolean)
  .map((fixture) => example({
    id: fixture.id,
    providerId: fixture.providerId,
    label: fixture.label,
    fileName: fixture.fileName,
    text: fixture.text,
  }));

export const NATIVE_IMPORT_EXAMPLES = Object.freeze([...reused, NO_UNIT_COUNT_EXAMPLE]);

export const nativeExampleById = (id) =>
  NATIVE_IMPORT_EXAMPLES.find((entry) => entry.id === id) ?? null;

export const nativeExamplesForProvider = (providerId) =>
  NATIVE_IMPORT_EXAMPLES.filter((entry) => entry.providerId === providerId);
