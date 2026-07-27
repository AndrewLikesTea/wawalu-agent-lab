// The downloadable query-sample template.
//
// A leader who has never produced a query sample cannot start one from a
// schema. This module is the answer to that: a small, obviously synthetic
// gateway log in the delimited dialect, with the columns spelled the way a
// gateway spells them, exercising both the prompt-excerpt path and the
// pre-assigned-category path across several models and day buckets.
//
// Two rules hold, and both are asserted in the tests rather than promised here:
//   1. The bytes below go through `parseQuerySample` — the real validator, not
//      a hand-written copy of it. If the contract tightens, this template fails
//      with everything else.
//   2. Every `org_unit_id` is an active department in the HRIS export the
//      bundled example dataset already ships, so a downloaded template joins
//      the org tree a reader can already see rather than naming units that
//      exist nowhere. The ids are read out of that export here, so they cannot
//      drift apart.
//
// Everything is invented. No real company, person, prompt, model, or provider
// identifier appears in this file, and nothing here reaches a network.

import { exampleDatasetFiles } from "./example-dataset.js";
import { parseQuerySample } from "./query-sample-contract.js";

/** The file a reader downloads. Delimited, because that is what gateways emit. */
export const EXAMPLE_QUERY_SAMPLE_FILE = Object.freeze({
  fileName: "example-query-sample.csv",
  mediaType: "text/csv",
});

const HEADER = Object.freeze([
  "org_unit_id", "query_date", "model", "input_tokens", "output_tokens",
  "prompt_excerpt", "category",
]);

/** Active department unit ids from the bundled HRIS export, in export order. */
export function exampleDepartmentUnitIds() {
  const file = exampleDatasetFiles().find((entry) => entry.fileName === "example-hris-org.json");
  const hris = JSON.parse(file.text);
  return Object.freeze(hris.records
    .filter((record) => record.operation === "upsert" && record.active
      && record.unit_type === "department")
    .map((record) => record.unit_id));
}

// One row per query. `[dayOffset, model, inputTokens, outputTokens, excerpt,
// category]` — exactly one of the last two is filled, which is the contract's
// central rule made visible in the template itself.
const ROWS = Object.freeze([
  Object.freeze([0, 0, "acme-sonnet-1", 1200, 800, "", "highValue"]),
  Object.freeze([0, 0, "acme-opus-1", 90, 40, "rename this variable to something clearer", ""]),
  Object.freeze([0, 1, "acme-sonnet-1", 1500, 950, "", "highValue"]),
  Object.freeze([1, 0, "acme-haiku-1", 300, 260, "", "inefficient"]),
  Object.freeze([1, 1, "acme-opus-1", 140, 70, "what is the capital of a fictional country", ""]),
  Object.freeze([1, 2, "acme-haiku-1", 260, 180, "", "overProvisioned"]),
  Object.freeze([2, 1, "acme-sonnet-1", 1100, 700, "", "highValue"]),
  Object.freeze([2, 2, "acme-opus-1", 2000, 1400, "draft the migration plan with rollback steps", ""]),
  Object.freeze([2, 2, "acme-sonnet-1", 950, 620, "", "outOfScope"]),
]);

/** The three consecutive day buckets the template spans. */
const DAYS = Object.freeze(["2026-06-15", "2026-06-16", "2026-06-17"]);

/** The template as bytes, in the shape the delimited dialect accepts. */
export function exampleQuerySampleText() {
  const units = exampleDepartmentUnitIds();
  const lines = [HEADER.join(",")];
  for (const [day, unit, model, input, output, excerpt, category] of ROWS) {
    lines.push([
      units[unit], DAYS[day], model, String(input), String(output), excerpt, category,
    ].join(","));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * The template as a file, in the same `{ fileName, mediaType, text }` shape the
 * bundled example dataset hands the import surface.
 */
export function exampleQuerySampleFiles() {
  return [{ ...EXAMPLE_QUERY_SAMPLE_FILE, text: exampleQuerySampleText() }];
}

/** Translate the template with the real validator. No bypass branch exists. */
export function loadExampleQuerySample() {
  return parseQuerySample(exampleQuerySampleText());
}
