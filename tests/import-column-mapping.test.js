// The mapping model behind the column-review step.
//
// What this pins is the part a leader's trust rests on: every column of their
// own file is present with its header verbatim, the proposal is labelled as a
// proposal, a correction survives, two columns can never quietly claim the same
// field, and the binding that reaches the shipped normalizer is the one the
// reader confirmed — producing the same records the auto-detected path produces
// when the reader changes nothing.

import assert from "node:assert/strict";
import test from "node:test";
import { readDelimitedText } from "../src/delimited-text.js";
import { detectShape, parseDelimitedFinopsFile } from "../src/finops-tabular-import.js";
import {
  IGNORED_TARGET, MAPPING_TARGETS, claimsByField, createColumnMapping, mappingBinding,
  mappingIssues, mappingSummary, setColumnTarget, setMappingKind,
} from "../src/import-column-mapping.js";

const GENERATED_AT = "2026-07-26T00:00:00.000Z";

const OPENAI_CSV = [
  "date,project_name,model,n_context_tokens_total,n_generated_tokens_total,amount,currency",
  "2026-07-24,Atlas Platform,gpt-4o-mini,120000,18000,42.55,USD",
  "2026-07-25,Atlas Platform,text-embedding-3-large,240000,0,3.20,USD",
  "2026-07-25,Cinder Design,dall-e-3,0,0,7.05,USD",
].join("\n");

// Nothing in this header is a declared alias of anything, so detection returns
// nothing and the reader starts from an empty step.
const UNKNOWN_CSV = [
  "Buchungstag,Kostenstelle,Sprachmodell,Betrag,Notiz",
  "2026-07-24,Atlas Platform,gpt-4o-mini,42.55,",
  "2026-07-25,Cinder Design,gpt-4o,7.05,",
].join("\n");

function mappingFor(text, fileName = "export.csv") {
  const reading = readDelimitedText(text);
  assert.equal(reading.ok, true);
  return createColumnMapping({ reading, fileName, detection: detectShape(reading.header) });
}

const targetsOf = (state) => state.columns.map((column) => column.target);

// --- proposals -------------------------------------------------------------

test("a file matching a known shape arrives with every column proposed and labelled", () => {
  const state = mappingFor(OPENAI_CSV, "july-usage.csv");
  assert.equal(state.kind, "provider");
  assert.equal(state.kindOrigin, "detected");
  assert.equal(state.shapeId, "openai_usage");
  assert.equal(state.dataRowCount, 3);
  assert.deepEqual(targetsOf(state), [
    "date", "orgUnit", "model", "inputTokens", "outputTokens", "amount", "currency",
  ]);
  // Where a proposal came from is on the state, not implied by a tint.
  assert.deepEqual(new Set(state.columns.map((column) => column.origin)), new Set(["detected"]));
  // A real value out of the reader's own column, not a placeholder.
  assert.equal(state.columns[1].sample.value, "Atlas Platform");
  assert.equal(state.columns[5].sample.value, "42.55");
  const issues = mappingIssues(state);
  assert.equal(issues.confirmable, true);
  assert.deepEqual(issues.blockers, []);
  assert.match(mappingSummary(state).text, /Recognized as OpenAI usage export/);
});

test("confirming an unchanged proposal produces exactly what detection alone produces", () => {
  const state = mappingFor(OPENAI_CSV, "july-usage.csv");
  const detected = parseDelimitedFinopsFile(OPENAI_CSV, "july-usage.csv", { generatedAt: GENERATED_AT });
  const reviewed = parseDelimitedFinopsFile(OPENAI_CSV, "july-usage.csv", {
    generatedAt: GENERATED_AT, mapping: mappingBinding(state),
  });
  assert.equal(detected.ok, true);
  assert.equal(reviewed.ok, true);
  // Same normalized rows, same totals, same envelope: the step is a review, not
  // a second translator.
  assert.deepEqual(reviewed.parsed.document.records, detected.parsed.document.records);
  assert.deepEqual(reviewed.totals, detected.totals);
});

// --- nothing detected ------------------------------------------------------

test("an unrecognized file starts unset, is completable by hand, and says what is missing", () => {
  const state = mappingFor(UNKNOWN_CSV, "kosten.csv");
  assert.equal(state.shapeId, null);
  assert.equal(state.kindOrigin, "unset");
  assert.deepEqual(targetsOf(state), Array(5).fill(IGNORED_TARGET));
  assert.deepEqual(new Set(state.columns.map((column) => column.origin)), new Set(["unset"]));

  const issues = mappingIssues(state);
  assert.equal(issues.confirmable, false);
  assert.deepEqual(issues.blockers.map((issue) => issue.field), ["date", "orgUnit", "model", "amount"]);
  // The callout names the consequence in product terms, not "required field".
  const amount = issues.blockers.find((issue) => issue.field === "amount");
  assert.match(amount.consequence, /headline number and the recoverable scenario cannot be computed/);
  assert.match(amount.consequence, /analysis cannot run without it/);
  for (const issue of issues.blockers) assert.doesNotMatch(issue.consequence, /required field missing/i);

  // Mapped by hand, the same file completes and normalizes.
  const mapped = [["date", 0], ["orgUnit", 1], ["model", 2], ["amount", 3]]
    .reduce((next, [field, index]) => setColumnTarget(next, index, field), state);
  assert.equal(mappingIssues(mapped).confirmable, true);
  assert.equal(mapped.columns[0].origin, "chosen");
  const parsed = parseDelimitedFinopsFile(UNKNOWN_CSV, "kosten.csv", {
    generatedAt: GENERATED_AT, mapping: mappingBinding(mapped),
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.parsed.document.records.length, 2);
  assert.equal(parsed.totals.amountMinor, 4960);
});

test("an unmapped optional field is a warning naming the portion lost, not a blocker", () => {
  const state = mappingFor(UNKNOWN_CSV, "kosten.csv");
  const mapped = [["date", 0], ["orgUnit", 1], ["model", 2], ["amount", 3]]
    .reduce((next, [field, index]) => setColumnTarget(next, index, field), state);
  const issues = mappingIssues(mapped);
  assert.equal(issues.confirmable, true);
  const currency = issues.warnings.find((issue) => issue.field === "currency");
  assert.match(currency.consequence, /Every row is read as USD/);
  const quantity = issues.warnings.find((issue) => issue.field === "quantity");
  assert.match(quantity.consequence, /Spend still totals/);
});

// --- corrections -----------------------------------------------------------

test("a re-pointed column wins over the proposal, and an ignored one is dropped", () => {
  const state = mappingFor(OPENAI_CSV, "july-usage.csv");
  // The reader decides the generated-tokens column is not usage they want
  // counted, and that input tokens are the quantity.
  const corrected = setColumnTarget(
    setColumnTarget(state, 4, IGNORED_TARGET), 3, "quantity",
  );
  assert.equal(corrected.columns[3].target, "quantity");
  assert.equal(corrected.columns[4].target, IGNORED_TARGET);
  assert.equal(mappingIssues(corrected).confirmable, true);

  const parsed = parseDelimitedFinopsFile(OPENAI_CSV, "july-usage.csv", {
    generatedAt: GENERATED_AT, mapping: mappingBinding(corrected),
  });
  const detected = parseDelimitedFinopsFile(OPENAI_CSV, "july-usage.csv", { generatedAt: GENERATED_AT });
  const quantity = (result) => result.parsed.document.records
    .reduce((sum, record) => sum + record.usage.quantity, 0);
  // 120000 + 240000 + 0 counted once, rather than input plus output.
  assert.equal(quantity(parsed), 360_000);
  assert.equal(quantity(detected), 378_000);
  assert.equal(parsed.parsed.document.records[0].usage.unit, "provider-units");
});

test("correcting the kind keeps the targets that still exist and drops the rest", () => {
  const roster = mappingFor([
    "Department,Parent,Unit Type,Active",
    "Atlas Platform,Wawalu Labs,department,true",
  ].join("\n"), "roster.csv");
  assert.equal(roster.kind, "hris");
  assert.deepEqual(targetsOf(roster), ["orgUnit", "parent", "unitType", "active"]);

  const asProvider = setMappingKind(roster, "provider");
  assert.equal(asProvider.kind, "provider");
  assert.equal(asProvider.kindOrigin, "chosen");
  // `orgUnit` means the same thing in both vocabularies and survives; the rest
  // fall back to ignored rather than pointing at a field that no longer exists.
  assert.deepEqual(targetsOf(asProvider), ["orgUnit", IGNORED_TARGET, IGNORED_TARGET, IGNORED_TARGET]);
  assert.equal(mappingIssues(asProvider).confirmable, false);
});

// --- duplicates ------------------------------------------------------------

test("two columns claiming one field is surfaced and blocks; the last does not win", () => {
  const state = mappingFor(OPENAI_CSV, "july-usage.csv");
  const clashing = setColumnTarget(state, 4, "amount");
  assert.deepEqual(claimsByField(clashing).get("amount"), [4, 5]);

  const issues = mappingIssues(clashing);
  assert.equal(issues.confirmable, false);
  const duplicate = issues.blockers.find((issue) => issue.code === "duplicate_target");
  assert.deepEqual(duplicate.columns, [4, 5]);
  assert.match(duplicate.message, /Column 5 and Column 6 both become Cost amount/);
  assert.match(duplicate.consequence, /will not choose for you/);
  // And nothing can be handed to the parser while it stands.
  assert.equal(mappingBinding(clashing), null);
});

// --- the messy real files --------------------------------------------------

test("headers only, blank headers, duplicate headers, and ragged rows all survive", () => {
  const headerOnly = mappingFor("date,project_name,model,amount\n", "empty.csv");
  assert.equal(headerOnly.dataRowCount, 0);
  const emptyIssues = mappingIssues(headerOnly);
  assert.equal(emptyIssues.confirmable, false);
  const noRows = emptyIssues.blockers.find((issue) => issue.code === "no_data_rows");
  assert.match(noRows.consequence, /no number at all/);
  // Every column still says something rather than rendering a blank cell.
  for (const column of headerOnly.columns) {
    assert.equal(column.sample.available, false);
    assert.equal(column.sample.note, "This file has no data rows.");
  }

  const messy = mappingFor([
    "date,,amount,amount",
    "2026-07-24,,42.55",
    "2026-07-25,,7.05,7.05,extra",
  ].join("\n"), "messy.csv");
  assert.equal(messy.columns.length, 4);
  // A blank header is still a column, named by its position.
  assert.equal(messy.columns[1].header, "");
  assert.equal(messy.columns[1].blankHeader, true);
  assert.equal(messy.columns[1].label, "Column 2 (no header)");
  assert.equal(messy.columns[1].sample.note, "Every row is empty in this column.");
  // A repeated header is two columns, both listed, both correctable.
  assert.deepEqual(messy.columns.map((column) => column.header), ["date", "", "amount", "amount"]);
  const ragged = mappingIssues(messy).warnings.find((issue) => issue.code === "ragged_rows");
  assert.match(ragged.message, /2 of 2 rows carry a different number of cells/);
  assert.match(ragged.consequence, /reported and skipped/);
});

test("a long sample is shortened for display without losing the value or splitting a glyph", () => {
  const long = "Boreal Data Science and Platform Reliability Engineering, EMEA";
  const state = mappingFor(`unit,amount\n"${long}",42.55`, "long.csv");
  const sample = state.columns[0].sample;
  assert.equal(sample.value, long);
  assert.equal(sample.truncated, true);
  assert.ok(sample.display.length < long.length);
  assert.match(sample.display, /…$/);
  assert.ok(long.startsWith(sample.display.slice(0, -1)));

  // A cut that lands inside a flag or a skin-toned emoji would render as a
  // broken glyph, so the boundary walks back off the continuation.
  const emoji = `${"x".repeat(46)} 👍🏽 tail`;
  const glyphs = mappingFor(`unit,amount\n"${emoji}",1.00`, "emoji.csv");
  assert.doesNotMatch(glyphs.columns[0].sample.display, /\u{1f3fd}/u);
});

// --- the binding -----------------------------------------------------------

test("the binding names only mapped columns and carries what the file is", () => {
  const state = mappingFor(OPENAI_CSV, "july-usage.csv");
  const binding = mappingBinding(setColumnTarget(state, 6, IGNORED_TARGET));
  assert.equal(binding.kind, "provider");
  assert.equal(binding.shapeId, "openai_usage");
  assert.deepEqual(binding.bound, {
    date: 0, orgUnit: 1, model: 2, inputTokens: 3, outputTokens: 4, amount: 5,
  });
  // The vocabulary is closed: an unknown target is refused rather than stored.
  assert.equal(setColumnTarget(state, 0, "not_a_field"), state);
  assert.deepEqual(
    MAPPING_TARGETS.provider.filter((entry) => entry.required).map((entry) => entry.field),
    ["date", "orgUnit", "model", "amount"],
  );
});
