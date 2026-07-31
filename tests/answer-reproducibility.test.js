// The reproducibility disclosure: what it claims, and what makes it fail.
//
// WHAT THIS FILE PINS.
//
//   1. THE FIXTURE'S ANSWER, in three literals — the headline metric, the
//      recommended action, and the department ranking. Any one of the three
//      drifting fails here rather than in a screenshot nobody diffed. These are
//      assertions ON the existing scoring path; nothing in this change was
//      allowed to move them.
//   2. DETERMINISM WITHIN A SESSION. The same fixture imported twice into the
//      same held answer gives the same fingerprint and the same headline.
//   3. THE FALLBACK SAYS IT IS THE FALLBACK. Both sources fill the same four
//      slots, and the two never read alike.
//   4. THE NEGATIVE. A variant with changed figures changes the fingerprint AND
//      the headline. A digest that did not move when the data did would be
//      worse than no digest, because it would be quoted as proof.
//
// Everything in the fixtures below is invented. There is no real customer,
// provider, organization, or Wawalu figure in this file: the department names
// are nonsense words, and so are the provider names attached to them.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  CONTRIBUTION_WEIGHT, NAME_LIMIT, REMAINDER_LABEL, REPRODUCTION_SOURCE,
  REPRODUCTION_SOURCE_STATEMENT, REPRODUCTION_VERSION, UNNAMED_DEPARTMENT, answerContributions,
  displayName, fingerprint, normalizeAnswerInput, reproductionEntries,
} from "../src/answer-reproducibility.js";
import {
  STAND_DISCLOSURE, buildStandHeadline, standHeadlineForImport,
} from "../src/finops-stand.js";
import { applyStandHeadline, standDisclosureIds } from "../src/finops-stand-view.js";
import { createAnswerState } from "../src/answer-state.js";
import { validateCohortAttribution } from "../src/cohort-attribution.js";
import { parseHtml, textOf } from "./support/browser.js";

const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");

/**
 * A representative synthetic provider export, in the shape the import pipeline
 * publishes an analysis in.
 *
 * SYNTHETIC. Every department name, provider name, and figure below is
 * fabricated for this test. The three departments' modelled recoverable sums to
 * the analysis total exactly, which is the ordinary case; the unattributed
 * remainder is exercised separately below.
 *
 * Built by a function rather than held as a frozen constant so that a test which
 * mutates a copy cannot leak into the next one.
 */
const syntheticExport = (overrides = {}) => ({
  schemaVersion: "local-finops-history/1.0.0",
  period: "2026-05-01 to 2026-06-01",
  spendUsd: 120_000,
  recoverableUsd: 30_000,
  rankedDepartments: [
    {
      name: "Nimbus Widgetworks",
      provider: "Fabricated Cloud Alpha",
      spendUsd: 60_000,
      recoverableUsd: 18_000,
      records: 4,
      previousSpendUsd: 50_000,
    },
    {
      name: "Quokka Labs Sandbox",
      provider: "Fabricated Cloud Beta",
      spendUsd: 40_000,
      recoverableUsd: 9_000,
      records: 3,
      previousSpendUsd: 41_000,
    },
    {
      name: "Pretend Provider Ops",
      provider: "Fabricated Cloud Gamma",
      spendUsd: 20_000,
      recoverableUsd: 3_000,
      records: 2,
      previousSpendUsd: 20_000,
    },
  ],
  ...overrides,
});

const parsed = (analysis) => ({ analysis, eligibility: validateCohortAttribution({}) });

const disclosureOf = (headline) =>
  headline.disclosures.find((item) => item.id === STAND_DISCLOSURE.inputs);

const flatten = (item) => item.entries.map((row) => `${row.term} ${row.detail}`).join("\n");

const detailFor = (headline, term) =>
  disclosureOf(headline).entries.find((row) => row.term === term)?.detail ?? "";

/** The sixteen characters, lifted back out of the rendered entry. */
const renderedFingerprint = (headline) =>
  /^([0-9a-f]{16}) /.exec(detailFor(headline, "Input fingerprint"))?.[1] ?? null;

// ---------------------------------------------------------------------------
// 1. The fixture's answer, pinned in three places.
// ---------------------------------------------------------------------------

test("the synthetic export fixture pins its headline, its action, and its ranking", () => {
  const headline = standHeadlineForImport(parsed(syntheticExport()));

  // The headline metric.
  assert.equal(headline.recoverable.available, true);
  assert.equal(headline.recoverable.value, "$30,000 · 25% of analyzed spend");

  // The recommended action — one, and the same one the destination contract
  // ranks first. Pinned by label AND href so a silently re-pointed action fails.
  assert.equal(headline.action.available, true);
  assert.equal(headline.action.label, "Open the recommendation evidence");
  assert.equal(headline.action.href, "#recommendation-evidence");

  // The department ranking, in order, by name.
  const ranking = headline.disclosures
    .find((item) => item.id === STAND_DISCLOSURE.departments).entries.map((row) => row.term);
  assert.deepEqual(ranking, [
    "1. Nimbus Widgetworks", "2. Quokka Labs Sandbox", "3. Pretend Provider Ops",
  ]);
});

test("the named contributions add up to the headline figure, to the cent", () => {
  const analysis = syntheticExport();
  const normalized = normalizeAnswerInput(analysis);
  const contributions = answerContributions(normalized);

  assert.equal(contributions.length, 3, "three departments, three lines, no remainder line");
  assert.equal(contributions.reduce((sum, row) => sum + row.cents, 0), normalized.recoverableCents);
  assert.deepEqual(contributions.map((row) => row.name),
    ["Nimbus Widgetworks", "Quokka Labs Sandbox", "Pretend Provider Ops"],
    "ordered by contribution, largest first");
  // Every line carries the one weight, and it is stated rather than implied.
  assert.deepEqual([...new Set(contributions.map((row) => row.weight))], [CONTRIBUTION_WEIGHT]);

  const disclosure = disclosureOf(standHeadlineForImport(parsed(analysis)));
  const rendered = flatten(disclosure);
  assert.match(rendered, /\$18,000\.00 · 60\.0% of the headline figure · weight 1\.00/);
  assert.match(rendered, /\$9,000\.00 · 30\.0% of the headline figure · weight 1\.00/);
  assert.match(rendered, /\$3,000\.00 · 10\.0% of the headline figure · weight 1\.00/);
  // The rows read total is the sum of the per-department counts it names.
  assert.match(rendered, /9 rows across 3 departments/);
  // …and the rubric version is the named constant, not a literal typed here.
  assert.ok(rendered.includes(REPRODUCTION_VERSION));
});

test("a shortfall between the named lines and the headline is shown, not dropped", () => {
  // Same three departments, a headline that claims $2,000 more than they
  // account for. The disclosure must show the gap rather than a list that looks
  // complete: this is exactly the case a director would find.
  const analysis = syntheticExport({ recoverableUsd: 32_000 });
  const contributions = answerContributions(normalizeAnswerInput(analysis));
  assert.equal(contributions.length, 4);
  assert.equal(contributions.at(-1).name, REMAINDER_LABEL);
  assert.equal(contributions.at(-1).cents, 200_000);
  assert.equal(contributions.reduce((sum, row) => sum + row.cents, 0), 3_200_000);
});

// ---------------------------------------------------------------------------
// 2. Determinism within one session.
// ---------------------------------------------------------------------------

test("importing the same fixture twice in one session gives one digest and one headline", () => {
  const state = createAnswerState();

  assert.equal(state.setImport(parsed(syntheticExport())).committed, true);
  const firstDigest = renderedFingerprint(state.getHeadline());
  const firstMetric = state.getAnswer().metric.value;
  assert.match(firstDigest ?? "", /^[0-9a-f]{16}$/, "the digest renders as sixteen hex digits");

  assert.equal(state.setImport(parsed(syntheticExport())).committed, true);
  assert.equal(renderedFingerprint(state.getHeadline()), firstDigest);
  assert.equal(state.getAnswer().metric.value, firstMetric);

  // …and the whole disclosure is identical entry for entry, not merely the two
  // values compared above.
  assert.deepEqual(disclosureOf(state.getHeadline()),
    disclosureOf(standHeadlineForImport(parsed(syntheticExport()))));
});

test("the digest is over the normalized rows, so re-ordering and re-spacing do not move it", () => {
  const base = normalizeAnswerInput(syntheticExport());

  // Row order is not part of the identity: an export re-sorted in a spreadsheet
  // is the same input.
  const reordered = syntheticExport();
  reordered.rankedDepartments = [...reordered.rankedDepartments].reverse();
  assert.equal(fingerprint(normalizeAnswerInput(reordered)), fingerprint(base));

  // Neither is the case or the spacing of a department name.
  const respaced = syntheticExport();
  respaced.rankedDepartments[0].name = "  nimbus   WIDGETWORKS ";
  assert.equal(fingerprint(normalizeAnswerInput(respaced)), fingerprint(base));

  // The period IS part of it: the same rows for a different month are not the
  // same input, and a fingerprint that said otherwise would be quoted as proof.
  const moved = syntheticExport({ period: "2026-04-01 to 2026-05-01" });
  assert.notEqual(fingerprint(normalizeAnswerInput(moved)), fingerprint(base));
});

// ---------------------------------------------------------------------------
// 3. The negative: changed data must change both the digest and the answer.
// ---------------------------------------------------------------------------

test("a fixture variant with changed values changes the digest and the headline", () => {
  const base = syntheticExport();
  // One department's recoverable doubled, and the total moved with it. This is
  // a different input and a different answer, and both must say so.
  const variant = syntheticExport({ recoverableUsd: 48_000 });
  variant.rankedDepartments[0].recoverableUsd = 36_000;

  const baseHeadline = standHeadlineForImport(parsed(base));
  const variantHeadline = standHeadlineForImport(parsed(variant));

  assert.notEqual(renderedFingerprint(variantHeadline), renderedFingerprint(baseHeadline));
  assert.equal(baseHeadline.recoverable.value, "$30,000 · 25% of analyzed spend");
  assert.equal(variantHeadline.recoverable.value, "$48,000 · 40% of analyzed spend");
  assert.match(flatten(disclosureOf(variantHeadline)), /\$36,000\.00 · 75\.0% of the headline/);
});

test("a single changed cent moves the digest", () => {
  const base = normalizeAnswerInput(syntheticExport());
  const nudged = syntheticExport();
  nudged.rankedDepartments[2].spendUsd = 20_000.01;
  assert.notEqual(fingerprint(normalizeAnswerInput(nudged)), fingerprint(base));
});

// ---------------------------------------------------------------------------
// 4. The fallback path, and the two sources that must not read alike.
// ---------------------------------------------------------------------------

test("the fallback disclosure renders and says it is the built-in sample", () => {
  const disclosure = disclosureOf(buildStandHeadline());
  assert.ok(disclosure, "the bundled path composes the disclosure too");

  // The same four elements are present for the sample as for an import.
  const terms = disclosure.entries.map((row) => row.term);
  for (const required of ["What this describes", "Scoring rules", "Rows read",
    "Input fingerprint", "Headline figure"]) {
    assert.ok(terms.includes(required), `the fallback is missing "${required}"`);
  }

  const statement = detailFor(buildStandHeadline(), "What this describes");
  assert.equal(statement, REPRODUCTION_SOURCE_STATEMENT[REPRODUCTION_SOURCE.synthetic]);
  assert.match(statement, /built-in sample/);
  assert.match(statement, /not yours/);
});

test("the imported and fallback statements are different prose, not one noun swapped", () => {
  const imported = detailFor(standHeadlineForImport(parsed(syntheticExport())),
    "What this describes");
  const fallback = detailFor(buildStandHeadline(), "What this describes");
  assert.notEqual(imported, fallback);
  assert.equal(imported, REPRODUCTION_SOURCE_STATEMENT[REPRODUCTION_SOURCE.imported]);
  assert.match(imported, /Your own imported export/);
  // No shared sentence between them: a reader skimming one line must land on a
  // claim that is true only of the source they are actually looking at.
  const shared = imported.split(". ").filter((line) => fallback.includes(line));
  assert.deepEqual(shared, []);
});

test("an unrecognized source is described as the sample, never as the reader's own", () => {
  const entries = reproductionEntries({ analysis: syntheticExport(), source: "something-else" });
  assert.equal(entries[0].detail, REPRODUCTION_SOURCE_STATEMENT[REPRODUCTION_SOURCE.synthetic]);
});

// ---------------------------------------------------------------------------
// 5. Untrusted input: bounded before it reaches the DOM.
// ---------------------------------------------------------------------------

test("a hostile department name is truncated and flattened, and reaches the DOM as text", () => {
  const analysis = syntheticExport();
  analysis.rankedDepartments[0].name = `<img src=x onerror=alert(1)>${"A".repeat(400)}\nsecond line`;
  analysis.rankedDepartments[1].name = "   ";

  const long = displayName(analysis.rankedDepartments[0].name);
  assert.ok(long.length <= NAME_LIMIT + 20, "an over-long name is cut, not passed through");
  assert.match(long, /name shortened/);
  assert.equal(long.includes("\n"), false, "a newline would look like a second entry");
  assert.equal(displayName(analysis.rankedDepartments[1].name), UNNAMED_DEPARTMENT);

  // …and the view inserts it as text: the markup is visible characters in the
  // painted node rather than an element.
  const document = parseHtml(html);
  applyStandHeadline(document, standHeadlineForImport(parsed(analysis)));
  const list = document.getElementById(standDisclosureIds(STAND_DISCLOSURE.inputs).list);
  assert.ok(list.querySelectorAll("dt").length > 0, "the disclosure painted no entries");
  assert.equal(list.querySelectorAll("img").length, 0, "an element was built from a name");
  assert.match(textOf(list), /<img src=x onerror=alert\(1\)>/);
});

test("an input that publishes no row counts says so rather than claiming zero rows", () => {
  const analysis = syntheticExport();
  for (const department of analysis.rankedDepartments) delete department.records;
  const entries = reproductionEntries({ analysis, source: REPRODUCTION_SOURCE.imported });
  const detail = entries.find((row) => row.term === "Rows read").detail;
  assert.match(detail, /Not published by this input · 3 departments/);
  assert.equal(/^0 rows/.test(detail), false, '"0 rows" is a false claim about a real file');
  // …and the contribution lines make the same admission rather than "0 rows".
  assert.match(entries.find((row) => row.term === "1. Nimbus Widgetworks").detail,
    /published no count of them/);
});

test("an input with no recoverable total claims no breakdown", () => {
  const entries = reproductionEntries({
    analysis: syntheticExport({ recoverableUsd: null }),
    source: REPRODUCTION_SOURCE.imported,
  });
  const detail = entries.find((row) => row.term === "Named contributions")?.detail ?? "";
  assert.match(detail, /no headline figure to break down/);
  assert.equal(entries.some((row) => /^\d+\. /.test(row.term)), false,
    "no contribution line may be published without a total to contribute to");
});
