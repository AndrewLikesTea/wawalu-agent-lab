// The declared-rate contract, the provenance it recomputes, and the intake that
// renders it (#1481).
//
// Four groups, each checking a different claim:
//
//   1. THE SCHEMA. Version, enum, and per-field rejection messages that name the
//      line and the field. Every problem in one submission, never only the first,
//      and one bad record rejects the whole paste.
//   2. THE AWKWARD CASES the module's header commits to: duplicates resolved by
//      last effective date and rejected on a tie, unmatched models reported
//      rather than dropped, a stale card accepted and surfaced, and a reordered
//      paste producing a byte-identical result.
//   3. THE PROVENANCE. Label AND score together, on the same 0–100 scale the
//      #1266 surface already publishes, for a fully declared cohort, a partially
//      declared one, and no declaration at all — where the score must be exactly
//      the one the page shipped before this module existed.
//   4. THE SURFACE. The shipped markup carries the form, and the real page entry
//      binds it, moves the three answer-region slots, and clears the #1263
//      readiness blocker. A test that only checked the module would pass on a
//      page that renders none of it.
//
// The declarations are built here rather than committed: a variant's interesting
// part is the one field that differs from the last one.
//
// Nothing here reads a clock, a network, or a random source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { DomEvent, loadPage, parseHtml, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  DECLARED_RATE_SCHEMA_VERSION, DECLARED_RATE_UNITS, PROVENANCE_LABELS, RATE_MAX,
  SYNTHETIC_BOUNDARY, parseRateDeclaration, rateCardFromDeclaration, recomputeProvenance,
} from "../src/finops-declared-rate-contract.js";
import {
  BUNDLED_PRICING_PROVENANCE, PRICED_DESTINATIONS,
} from "../src/finops-pricing-provenance.js";
import { PRICING_PROVENANCE_IDS } from "../src/finops-pricing-provenance-view.js";
import { RATE_CARD_IDS } from "../src/finops-rate-card-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const SOURCE = await readFile(PAGE, "utf8");
const DEMO_DATA = JSON.parse(
  await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));

/** The analysis date every case is judged against. Passed in; never a clock. */
const AS_OF = "2026-07-01";
const [PREMIUM, STANDARD] = PRICED_DESTINATIONS;
const [INPUT_UNIT, OUTPUT_UNIT] = DECLARED_RATE_UNITS;
const SOURCE_LABEL = "MSA 2026 Schedule B";

/** One record as a pasted line. */
const line = (model, unit, rate, date = "2026-05-01", label = SOURCE_LABEL) =>
  `${model}, ${unit}, ${rate}, ${date}, ${label}`;

/** Both rates for one destination. */
const pair = (model, input, output, date) =>
  [line(model, INPUT_UNIT, input, date), line(model, OUTPUT_UNIT, output, date)];

const FULL = [...pair(PREMIUM, 14, 16), ...pair(STANDARD, 9, 11)].join("\n");
const PARTIAL = pair(PREMIUM, 14, 16).join("\n");

const messages = (result) => result.errors.map((error) => error.message);

// --- 1. the schema -------------------------------------------------------

test("a parsed declaration carries its schema version and one record per line", () => {
  const parsed = parseRateDeclaration(FULL);
  assert.equal(parsed.schemaVersion, DECLARED_RATE_SCHEMA_VERSION,
    "the version is what makes a later shape change detectable rather than mis-read");
  assert.equal(parsed.valid, true);
  assert.equal(parsed.records.length, 4);
  assert.deepEqual(parsed.records[0],
    { line: 1, model: PREMIUM, unit: INPUT_UNIT, rate: 14, effectiveDate: "2026-05-01",
      sourceLabel: SOURCE_LABEL });
});

test("the three input forms read to the same records", () => {
  const typed = parseRateDeclaration({
    model: PREMIUM, unit: INPUT_UNIT, rate: "14", effectiveDate: "2026-05-01",
    sourceLabel: SOURCE_LABEL,
  });
  const pasted = parseRateDeclaration(line(PREMIUM, INPUT_UNIT, 14));
  const json = parseRateDeclaration(JSON.stringify([{
    model: PREMIUM, unit: INPUT_UNIT, rate: 14, effectiveDate: "2026-05-01",
    sourceLabel: SOURCE_LABEL,
  }]));
  assert.deepEqual(typed.records, pasted.records);
  assert.deepEqual(json.records, pasted.records);
});

test("a source label may carry a comma, because contracts have schedules", () => {
  const parsed = parseRateDeclaration(line(PREMIUM, INPUT_UNIT, 14, "2026-05-01", "MSA 2026, Sch B"));
  assert.equal(parsed.records[0].sourceLabel, "MSA 2026, Sch B");
});

test("every malformed field is rejected by name, and one bad record rejects the paste", () => {
  const parsed = parseRateDeclaration([
    line(PREMIUM, INPUT_UNIT, 14),
    ["", "per-hour", "-3", "2026-02-30", ""].join(", "),
  ].join("\n"));
  assert.equal(parsed.valid, false);
  assert.deepEqual(parsed.records, [], "no record survives a submission with a bad one in it");
  const said = messages(parsed);
  assert.deepEqual(said, [
    "Line 2, model: a destination model identifier is required.",
    `Line 2, unit: "per-hour" is not an accepted unit — state one of ${INPUT_UNIT} or ${OUTPUT_UNIT}.`,
    `Line 2, rate: "-3" is not a usable rate — state a positive number of US dollars, at most ${RATE_MAX}.`,
    'Line 2, effective date: "2026-02-30" is not a real ISO calendar date — state it as YYYY-MM-DD.',
    "Line 2, source label: name the contract this rate comes from, so a reader outside this browser "
      + "can check it.",
  ], "every problem is reported, so the paste is fixed once rather than once per line");
});

test("a line with too few fields says how many it needed and how many it found", () => {
  const parsed = parseRateDeclaration(`${PREMIUM}, ${INPUT_UNIT}, 14`);
  assert.deepEqual(messages(parsed), [
    "Line 1: expected 5 comma-separated fields — model, unit, rate, effective date, source label "
      + "— but found 3.",
  ]);
});

test("a rate over the contract's own ceiling is unusable, not silently priced", () => {
  const parsed = parseRateDeclaration(line(PREMIUM, INPUT_UNIT, RATE_MAX + 1));
  assert.equal(parsed.valid, false);
  assert.match(messages(parsed)[0], /is not a usable rate/);
});

test("credential-shaped and contact-shaped text is refused, saying the boundary is synthetic", () => {
  const parsed = parseRateDeclaration([
    line(PREMIUM, INPUT_UNIT, 14, "2026-05-01", "bearer sk-live-abc"),
    line(STANDARD, INPUT_UNIT, 9, "2026-05-01", "lead@example.com"),
  ].join("\n"));
  assert.equal(parsed.valid, false);
  const said = messages(parsed);
  assert.equal(said.length, 2);
  assert.match(said[0], /^Line 1, source label: refused — this reads like a credential\./);
  assert.match(said[1], /^Line 2, source label: refused — this reads like an email address\./);
  for (const message of said) {
    assert.ok(message.endsWith(SYNTHETIC_BOUNDARY),
      "a refusal must say the boundary is synthetic and locally held, not merely refuse");
  }
});

test("text that starts like JSON but is not JSON is rejected, never evaluated", () => {
  const parsed = parseRateDeclaration('[{"model": ');
  assert.deepEqual(messages(parsed), [
    "Line 1: this starts like JSON but is not valid JSON, so no record could be read.",
  ]);
});

test("an empty declaration is not an error; it is the state the page ships in", () => {
  const parsed = parseRateDeclaration("   \n # a comment \n");
  assert.equal(parsed.valid, false);
  assert.deepEqual(parsed.errors, []);
});

// --- 2. the awkward cases ------------------------------------------------

test("a duplicated model and unit resolves to the last effective date, keeping the loser", () => {
  const parsed = parseRateDeclaration([
    line(PREMIUM, INPUT_UNIT, 20, "2025-01-01"),
    line(PREMIUM, INPUT_UNIT, 14, "2026-05-01"),
  ].join("\n"));
  assert.equal(parsed.valid, true);
  assert.deepEqual(parsed.records.map((record) => record.rate), [14]);
  assert.deepEqual(parsed.superseded.map((record) => record.rate), [20],
    "the superseded record is reported, never dropped in silence");
});

test("two declarations for one model, unit and date are ambiguous and reject the paste", () => {
  const parsed = parseRateDeclaration([
    line(PREMIUM, INPUT_UNIT, 20, "2026-05-01"),
    line(PREMIUM, INPUT_UNIT, 14, "2026-05-01"),
  ].join("\n"));
  assert.equal(parsed.valid, false);
  assert.deepEqual(messages(parsed), [
    `Lines 1 and 2, effective date: ${PREMIUM} ${INPUT_UNIT} is declared more than once as of `
      + "2026-05-01, so which rate is contracted is ambiguous. Remove one, or date them apart.",
  ]);
});

test("a record for a model this analysis does not price is reported, not dropped", () => {
  const declaration = parseRateDeclaration([
    ...pair(PREMIUM, 14, 16), ...pair(STANDARD, 9, 11), ...pair("vision-preview", 30, 40),
  ].join("\n"));
  assert.equal(declaration.records.length, 6);
  const result = recomputeProvenance({ declaration, asOf: AS_OF });
  assert.deepEqual(result.unmatched, ["vision-preview"]);
  assert.equal(result.label, PROVENANCE_LABELS[2], "an extra line does not spoil a full cohort");
  assert.match(result.attribution,
    /vision-preview was declared but this analysis prices no such destination/);
});

test("a stale declaration is accepted and its age is surfaced, not refused", () => {
  const declaration = parseRateDeclaration(
    [...pair(PREMIUM, 14, 16, "2023-01-01"), ...pair(STANDARD, 9, 11, "2023-01-01")].join("\n"));
  const result = recomputeProvenance({ declaration, asOf: AS_OF });
  assert.equal(result.label, PROVENANCE_LABELS[2]);
  assert.match(result.attribution, /effective 2023-01-01\./);
  assert.match(result.attribution, /The oldest declared rate is 42 months old/);
  assert.ok(result.score < recomputeProvenance({
    declaration: parseRateDeclaration(FULL), asOf: AS_OF,
  }).score, "an expired card scores below a current one on the same label");
});

test("a reordered paste is the same declaration, byte for byte", () => {
  const forward = parseRateDeclaration(FULL);
  const reversed = parseRateDeclaration(FULL.split("\n").reverse().join("\n"));
  assert.deepEqual(reversed.records.map(({ line: _, ...rest }) => rest),
    forward.records.map(({ line: _, ...rest }) => rest));
  assert.equal(recomputeProvenance({ declaration: reversed, asOf: AS_OF }).score,
    recomputeProvenance({ declaration: forward, asOf: AS_OF }).score);
});

test("half a pair of rates is not a contracted price; the model falls back to list", () => {
  const declaration = parseRateDeclaration(line(PREMIUM, INPUT_UNIT, 14));
  assert.equal(rateCardFromDeclaration(declaration), null);
  const result = recomputeProvenance({ declaration, asOf: AS_OF });
  assert.equal(result.label, PROVENANCE_LABELS[0]);
  assert.deepEqual(result.fallback, [...PRICED_DESTINATIONS]);
});

// --- 3. the provenance ---------------------------------------------------

test("no declaration leaves the score exactly where the page already had it", () => {
  const result = recomputeProvenance({ asOf: AS_OF });
  assert.equal(result.label, PROVENANCE_LABELS[0]);
  assert.equal(result.score, BUNDLED_PRICING_PROVENANCE.subScore,
    "the no-declaration path is the published-list reference card, unchanged");
  assert.equal(result.ratingLabel, "Limited confidence");
  assert.equal(result.confidence.marker, "Illustrative");
  assert.match(result.attribution, /priced at the published list — a ceiling, not your contract\./);
});

test("a fully declared cohort reads Declared, scores above the ceiling, and is attributed", () => {
  const result = recomputeProvenance({ declaration: parseRateDeclaration(FULL), asOf: AS_OF });
  assert.equal(result.label, PROVENANCE_LABELS[2]);
  assert.equal(result.score, 88);
  assert.equal(result.ratingLabel, "High confidence");
  assert.deepEqual(result.fallback, []);
  assert.equal(result.attribution,
    `Priced at declared contracted rates from ${SOURCE_LABEL}, effective 2026-05-01.`);
  assert.equal(result.confidence.marker, "Declared",
    "the #1263 readiness blocker clears: the figure is no longer a list-price ceiling");
});

test("a partly declared cohort reads Partial, names what still falls back, and scores between", () => {
  const result = recomputeProvenance({ declaration: parseRateDeclaration(PARTIAL), asOf: AS_OF });
  assert.equal(result.label, PROVENANCE_LABELS[1]);
  assert.equal(result.score, 71.8);
  assert.deepEqual(result.declared, [PREMIUM]);
  assert.deepEqual(result.fallback, [STANDARD]);
  assert.match(result.attribution,
    new RegExp(`${STANDARD} is still priced at the published list`));
  const none = recomputeProvenance({ asOf: AS_OF }).score;
  const full = recomputeProvenance({ declaration: parseRateDeclaration(FULL), asOf: AS_OF }).score;
  assert.ok(none < result.score && result.score < full,
    "the score moves with the label on one scale, not two");
});

test("malformed input leaves the page priced at list, with every rejection reported", () => {
  const declaration = parseRateDeclaration(["", "per-hour", "-3", "nope", ""].join(", "));
  const result = recomputeProvenance({ declaration, asOf: AS_OF });
  assert.equal(result.label, PROVENANCE_LABELS[0]);
  assert.equal(result.score, BUNDLED_PRICING_PROVENANCE.subScore);
  assert.equal(declaration.errors.length, 5);
});

// --- 4. the surface ------------------------------------------------------

test("the shipped markup carries the labelled form, the boundary line, and both buttons", () => {
  const document = parseHtml(SOURCE);
  const input = document.getElementById("declared-rates-input");
  assert.ok(input, "the intake is not authored on the page at all");
  assert.equal(input.tagName, "TEXTAREA");
  const label = document.querySelector('label[for="declared-rates-input"]');
  assert.ok(label && textOf(label).trim() !== "", "the control has no visible label");
  for (const id of ["declared-rates-submit", "declared-rates-clear"]) {
    assert.equal(document.getElementById(id)?.tagName, "BUTTON", `#${id} is not a button`);
  }
  const status = document.getElementById("declared-rates-status");
  assert.equal(status.getAttribute("role"), "status");
  assert.equal(status.getAttribute("aria-live"), "polite");
  assert.match(textOf(document.getElementById("declared-rates")),
    /synthetic and held locally only: nothing is uploaded, no credential or contact detail is accepted/,
    "the page must state the boundary the contract enforces");
});

test("the intake sits below the first-run region, where the tab stops are", () => {
  assert.ok(SOURCE.indexOf('id="declared-rates"') > SOURCE.indexOf('id="finops-first-run"'),
    "a control above the first answer is a gate on an answer the page already has");
  // Focus order is the document's own: field, apply, clear, in that sequence and
  // with nothing of this region's between them.
  const order = tabSequence(parseHtml(SOURCE)).map((node) => node.id)
    .filter((id) => id.startsWith("declared-rates"));
  assert.deepEqual(order, ["declared-rates-input", "declared-rates-submit", "declared-rates-clear"]);
});

test("declaring rates on the real page moves the answer region's own slots", async () => {
  const page = await loadPage(PAGE, {
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  const { document } = page;
  await importPageModule("/evolution-page.js");
  await waitFor(() => document.getElementById("declared-rates-form") !== null,
    "the declared-rate form never appeared");

  const before = textOf(document.getElementById(PRICING_PROVENANCE_IDS.score));
  assert.match(before, /Pricing provenance: Limited confidence \(67\/100\)/,
    "the served page prices at the published list before anything is declared");

  document.getElementById("declared-rates-input").value = FULL;
  document.getElementById("declared-rates-form").dispatchEvent(
    new DomEvent("submit", { bubbles: true }));

  assert.match(textOf(document.getElementById(PRICING_PROVENANCE_IDS.score)),
    /Pricing provenance: High confidence \(88\/100\)/);
  assert.match(textOf(document.getElementById(RATE_CARD_IDS.marker)), /Declared/);
  assert.doesNotMatch(textOf(document.getElementById(RATE_CARD_IDS.nextStep)),
    /list-price ceiling/, "the readiness blocker must clear once the rates are declared");
  assert.match(textOf(document.getElementById("declared-rates-status")),
    /4 declared rates applied\. Pricing provenance is now Declared — 88\.0 of 100\./);
  assert.match(textOf(document.getElementById("declared-rates-attribution")),
    new RegExp(SOURCE_LABEL));

  document.getElementById("declared-rates-clear").dispatchEvent(
    new DomEvent("click", { bubbles: true }));
  assert.equal(textOf(document.getElementById(PRICING_PROVENANCE_IDS.score)), before,
    "clearing the declaration returns the figure to exactly what the page shipped with");
});

test("a rejected paste announces every problem and changes no figure", async () => {
  const page = await loadPage(PAGE, {
    routes: {
      "/evolution-demo-data.json": DEMO_DATA,
      "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
    },
  });
  const { document } = page;
  await importPageModule("/evolution-page.js");
  await waitFor(() => document.getElementById("declared-rates-form") !== null,
    "the declared-rate form never appeared");
  const before = textOf(document.getElementById(PRICING_PROVENANCE_IDS.score));

  document.getElementById("declared-rates-input").value =
    line(PREMIUM, "per-hour", "-3", "2026-02-30", "");
  document.getElementById("declared-rates-form").dispatchEvent(
    new DomEvent("submit", { bubbles: true }));

  const status = document.getElementById("declared-rates-status");
  assert.equal(status.dataset.state, "rejected");
  assert.match(textOf(status), /4 of these lines were refused, so none were applied\./);
  assert.match(textOf(status), /is not an accepted unit/);
  assert.match(textOf(status), /is not a usable rate/);
  assert.match(textOf(status), /is not a real ISO calendar date/);
  assert.match(textOf(status), /name the contract this rate comes from/);
  assert.equal(textOf(document.getElementById(PRICING_PROVENANCE_IDS.score)), before,
    "a refused paste leaves the figure exactly where it was");
});
