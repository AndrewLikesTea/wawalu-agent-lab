// The reproducibility disclosure, pinned against a labelled synthetic export.
//
// WHY THIS FILE EXISTS. A FinOps lead forwards one number to a director, and the
// director's first question is "which rows is this, and is it still the same
// file?" Nothing pinned the answer. This file does, three ways:
//
//   1. LABELLED FIXTURE. One invented provider export goes through the shipped
//      import path — `normalizeLocalFinops`, then `standHeadlineForImport` —
//      and the headline metric, the recommended action and the WHOLE department
//      ranking are asserted as exact literals. Not ranges, not shapes: if a
//      scoring rule moves by a cent, this file says so by name.
//   2. DETERMINISM. The same export imported twice produces a byte-identical
//      digest and an identical headline. The digest is asserted to be blind to
//      row order, to object key insertion order and to label whitespace, and
//      sensitive to a single cent — because a digest that moves on its own is
//      worse than no digest.
//   3. BOTH CASES, LABELLED. The disclosure renders for an import and for the
//      bundled fallback, and each says in plain words which one it is. A reader
//      may never mistake invented numbers for their own.
//
// PRIVACY. Every value below is invented. The provider is `syn-provider-one`,
// the org units are `psn_unit_synth_*`, and the amounts are round numbers chosen
// to make the arithmetic checkable by hand. Nothing here is copied from a
// customer, a provider price sheet, or Wawalu.
//
// THE FIXTURE IS GENERATED, NOT COMMITTED. It is built in-test from the shipped
// `provider-usage-billing/v1` contract fixture, so it moves with the schema
// rather than pinning a stale copy of it — the same convention
// tests/attribution-units.test.js follows.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseHtml, textOf } from "./support/browser.js";
import { normalizeLocalFinops } from "../src/local-finops.js";
import {
  STAND_DISCLOSURE, composeStandHeadline, standHeadlineForImport,
} from "../src/finops-stand.js";
import {
  applyStandHeadline, mountStandDisclosures, standDisclosureIds,
} from "../src/finops-stand-view.js";
import { installDeepLinkDisclosure } from "../src/deep-link-disclosure.js";
import {
  DISPLAY_LABEL_LIMIT, INPUT_RUBRIC_VERSION, NAMED_CONTRIBUTION_LIMIT, buildInputProvenance,
  canonicalInput, digestOf, normalizeInputRows,
} from "../src/finops-input-digest.js";

const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");
const CONTRACT = new URL(
  "../contracts/integrations/provider-usage-billing/v1/fixtures/valid.json", import.meta.url);

/**
 * One invented provider export, in the shape the import pipeline reads.
 *
 * Each row is `[org_unit_id, cost_amount_minor, tokens]`. Two rows share a unit
 * on purpose, so the department count (3) and the record count (4) differ and a
 * disclosure that confuses the two fails here.
 */
const FIXTURE_ROWS = Object.freeze([
  ["psn_unit_synth_00000001", 900_000, 300_000_000],
  ["psn_unit_synth_00000001", 300_000, 100_000_000],
  ["psn_unit_synth_00000002", 480_000, 160_000_000],
  ["psn_unit_synth_00000003", 210_000, 70_000_000],
]);

async function syntheticExport(rows = FIXTURE_ROWS) {
  const document = JSON.parse(await readFile(CONTRACT, "utf8"));
  const template = document.records[0];
  return {
    document: {
      ...document,
      export_id: "30000000-0000-4000-8000-00000000abcd",
      records: rows.map(([orgUnitId, amountMinor, quantity], index) => ({
        ...template,
        aggregate_id: `psn_aggregate_synth_${String(index).padStart(8, "0")}`,
        org_unit_id: orgUnitId,
        // Invented, so no real provider's name enters a fixture.
        provider: "syn-provider-one",
        usage: { ...template.usage, quantity },
        cost: { ...template.cost, amount_minor: amountMinor },
      })),
    },
  };
}

const analyzeFixture = async (rows) => normalizeLocalFinops({ provider: await syntheticExport(rows) });

const inputsDisclosure = (headline) =>
  headline.disclosures.find((item) => item.id === STAND_DISCLOSURE.inputs);

const detailFor = (headline, pattern) =>
  inputsDisclosure(headline).entries.find((row) => pattern.test(row.term))?.detail ?? null;

// ---------------------------------------------------------------------------
// 1. The labelled fixture. Exact values, or this file has no purpose.
// ---------------------------------------------------------------------------

/**
 * THE PINNED SCORE. Every literal below was read off the shipped modules on
 * 2026-07-30 and is asserted, not described. A change to the down-routing
 * reference rate, to the recoverable model, or to the ranking order fails here
 * with the old and new numbers side by side.
 */
const EXPECTED = Object.freeze({
  analyzedSpendUsd: 18_900,
  recoverableUsd: 9_450,
  headlineMetric: "$9,450 · 50% of analyzed spend",
  recommendedAction: "Pilot lower-cost routing for text-generation in Active unit …000001; "
    + "cap the pilot at 6000.00 USD and verify against a like-for-like period.",
  standAction: "Open the recommendation evidence",
  ranking: Object.freeze([
    { id: "psn_unit_synth_00000001", name: "Active unit …000001", spendUsd: 12_000, recoverableUsd: 6_000 },
    { id: "psn_unit_synth_00000002", name: "Active unit …000002", spendUsd: 4_800, recoverableUsd: 2_400 },
    { id: "psn_unit_synth_00000003", name: "Active unit …000003", spendUsd: 2_100, recoverableUsd: 1_050 },
  ]),
  digest: "ee1ce783a062c62c",
  rowCount: 3,
  recordCount: 4,
});

test("the labelled synthetic export scores to exactly the pinned headline, action and ranking", async () => {
  const analysis = await analyzeFixture();

  assert.equal(analysis.spendUsd, EXPECTED.analyzedSpendUsd);
  assert.equal(analysis.recoverableUsd, EXPECTED.recoverableUsd);
  assert.equal(analysis.action, EXPECTED.recommendedAction);
  // The WHOLE ranking, in order, with both figures per row. A reordering, a
  // dropped department, or a moved dollar all fail as a deep-equality diff.
  assert.deepEqual(
    analysis.rankedDepartments.map(({ id, name, spendUsd, recoverableUsd }) =>
      ({ id, name, spendUsd, recoverableUsd })),
    [...EXPECTED.ranking]);

  const headline = standHeadlineForImport({ analysis, eligibility: null });
  assert.equal(headline.recoverable.value, EXPECTED.headlineMetric);
  assert.equal(headline.action.available, true);
  assert.equal(headline.action.label, EXPECTED.standAction);
});

test("the disclosure names every contributing row and the weight it carries", async () => {
  const analysis = await analyzeFixture();
  const headline = standHeadlineForImport({ analysis, eligibility: null });

  // Named contributions: one line per department, with a weight that is the
  // row's own share of the headline. 6000/9450 = 0.63, 2400/9450 = 0.25.
  assert.equal(detailFor(headline, /Active unit …000001 · \$6,000/),
    "Weight 0.63 of the $9,450 headline · $12,000 analyzed spend in this row.");
  assert.equal(detailFor(headline, /Active unit …000002 · \$2,400/),
    "Weight 0.25 of the $9,450 headline · $4,800 analyzed spend in this row.");
  assert.equal(detailFor(headline, /Active unit …000003 · \$1,050/),
    "Weight 0.11 of the $9,450 headline · $2,100 analyzed spend in this row.");

  // The assumption behind the weight is stated where the weight is read. An
  // unexplained 0.63 in front of an executive is the defect this closes.
  const assumption = detailFor(headline, /^Assumption behind every weight$/);
  assert.match(assumption, /dollars, not headcount/);
  assert.match(assumption, /Seat count, request count and department size do not enter it/);
  assert.match(detailFor(headline, /^Assumption behind the recoverable model$/),
    /modelled, not measured/);

  // The rubric version is a named constant, shown verbatim, never a build stamp.
  assert.match(detailFor(headline, /^Scoring rules for this breakdown$/),
    new RegExp(INPUT_RUBRIC_VERSION.replace("/", "\\/")));
  assert.doesNotMatch(INPUT_RUBRIC_VERSION, /\d{4}-\d{2}-\d{2}|\d{10,}/,
    "the rubric version looks derived from a date or a timestamp");
});

// ---------------------------------------------------------------------------
// 2. The digest: stable across runs, blind to the things it must be blind to.
// ---------------------------------------------------------------------------

test("the same file imported twice gives a byte-identical digest and the same headline number", async () => {
  const first = buildInputProvenance({ analysis: await analyzeFixture(), source: "import" });
  const second = buildInputProvenance({ analysis: await analyzeFixture(), source: "import" });

  assert.equal(first.digest, second.digest);
  assert.equal(first.digest, EXPECTED.digest, "the digest for the pinned fixture has drifted");
  assert.equal(first.digestPrefix, EXPECTED.digest.slice(0, 8));
  assert.equal(first.canonical, second.canonical);
  assert.equal(first.rowCount, EXPECTED.rowCount);
  assert.equal(first.recordCount, EXPECTED.recordCount);
  assert.equal(first.totalRecoverableUsd, second.totalRecoverableUsd);
  assert.equal(first.totalRecoverableUsd, EXPECTED.recoverableUsd);

  // …and the whole rendered disclosure is identical, not only the digest.
  const analysis = await analyzeFixture();
  assert.deepEqual(
    inputsDisclosure(standHeadlineForImport({ analysis, eligibility: null })).entries,
    inputsDisclosure(standHeadlineForImport({ analysis: await analyzeFixture(), eligibility: null })).entries);
});

test("the digest depends on the rows and on nothing else", () => {
  const row = (id, spendUsd, recoverableUsd) => ({ id, name: `Team ${id}`, spendUsd, recoverableUsd });
  const base = { recoverableUsd: 30, rankedDepartments: [row("b", 100, 20), row("a", 50, 10)] };
  const digest = (analysis) => digestOf(canonicalInput(normalizeInputRows(analysis)));

  // Row order: the ranking may reorder between runs; the digest may not.
  assert.equal(digest(base),
    digest({ ...base, rankedDepartments: [...base.rankedDepartments].reverse() }));

  // Key insertion order on the row objects.
  assert.equal(digest(base), digest({
    ...base,
    rankedDepartments: base.rankedDepartments.map(({ recoverableUsd, spendUsd, name, id }) =>
      ({ recoverableUsd, spendUsd, name, id })),
  }));

  // Whitespace and control characters in a label are normalized away.
  assert.equal(
    digest({ ...base, rankedDepartments: [row("b", 100, 20), { ...row("a", 50, 10), id: " a " }] }),
    digest(base));

  // One cent, and it is a different input. This is the whole point.
  assert.notEqual(digest(base),
    digest({ ...base, rankedDepartments: [row("b", 100, 20.01), row("a", 50, 10)] }));
  // A renamed department with the same id and the same money is the same input:
  // the ranking joins on the id, so the digest does too.
  assert.equal(digest(base), digest({
    ...base,
    rankedDepartments: base.rankedDepartments.map((entry) => ({ ...entry, name: "Renamed" })),
  }));

  // No clock, no random source: the canonical payload holds only the tuple.
  assert.doesNotMatch(canonicalInput(normalizeInputRows(base)), /\d{4}-\d{2}-\d{2}T/);
  assert.equal(digestOf("").length, 16);
  assert.match(digest(base), /^[0-9a-f]{16}$/);
});

test("a long import names the top rows and sums the rest rather than dropping them", () => {
  const rankedDepartments = Array.from({ length: NAMED_CONTRIBUTION_LIMIT + 4 }, (unused, index) => ({
    id: `psn_unit_synth_${String(index).padStart(8, "0")}`,
    name: `Team ${index}`,
    spendUsd: 1000,
    recoverableUsd: 100 - index,
  }));
  const total = rankedDepartments.reduce((sum, entry) => sum + entry.recoverableUsd, 0);
  const provenance = buildInputProvenance({
    analysis: { spendUsd: 12_000, recoverableUsd: total, rankedDepartments }, source: "import" });

  assert.equal(provenance.rowCount, rankedDepartments.length);
  assert.equal(provenance.named.length, NAMED_CONTRIBUTION_LIMIT);
  assert.equal(provenance.remainder.rows, 4);
  // Nothing is lost: the named rows plus the remainder are the headline total.
  const named = provenance.named.reduce((sum, entry) => sum + entry.recoverableUsd, 0);
  assert.equal(named + provenance.remainder.recoverableUsd, total);
});

// ---------------------------------------------------------------------------
// 3. Both cases, plainly labelled, on the shipped surface.
// ---------------------------------------------------------------------------

/** Paint a composed headline into the shipped markup and read the disclosure. */
function rendered(headline) {
  const document = parseHtml(html);
  applyStandHeadline(document, headline);
  const list = document.getElementById(standDisclosureIds(STAND_DISCLOSURE.inputs).list);
  return { document, list, text: textOf(list) };
}

test("an imported answer says the number is the reader's own, and counts their rows", async () => {
  const analysis = await analyzeFixture();
  const { text } = rendered(standHeadlineForImport({ analysis, eligibility: null }));

  assert.match(text, /Derived from your imported file — 3 department rows covering 4 usage records/);
  assert.doesNotMatch(text, /built-in sample data/);
  // The full digest is readable, not only the prefix, so two runs can be compared.
  assert.match(text, new RegExp(EXPECTED.digest));
});

test("the bundled fallback says so in plain words and refuses to be forwarded as the reader's own", () => {
  const { text } = rendered(composeStandHeadline({
    analysis: { spendUsd: 100, recoverableUsd: 40, rankedDepartments: [
      { id: "psn_unit_synth_00000001", name: "Team one", spendUsd: 100, recoverableUsd: 40 },
    ] },
    source: "example",
  }));

  assert.match(text, /Derived from the built-in sample data — no file imported/);
  assert.match(text, /not your spend/);
  assert.doesNotMatch(text, /Derived from your imported file/,
    "the fallback reads as if the numbers were the reader's own");
});

test("a boardroom link straight into the mounted disclosure finds it and opens it", () => {
  const document = parseHtml(html);
  const ids = standDisclosureIds(STAND_DISCLOSURE.inputs);
  // The order the page entry uses: mount, THEN install the deep-link handler,
  // whose cold-load reveal runs immediately. Mounting later would leave a
  // pasted link pointing at nothing.
  mountStandDisclosures(document);
  const listeners = new Map();
  installDeepLinkDisclosure(document, {
    // The list inside it, which is how this handler reaches every other
    // disclosure on the page: it opens the ancestors of the fragment's target.
    location: { hash: `#${ids.list}` },
    addEventListener: (type, handler) => listeners.set(type, handler),
    removeEventListener: () => {},
  });

  assert.equal(document.getElementById(ids.details).hasAttribute("open"), true,
    "a link pasted straight into the reproducibility disclosure opened nothing");
});

test("an analysis with no rows says there is nothing to check rather than showing an empty digest", () => {
  const { text } = rendered(composeStandHeadline({
    analysis: { spendUsd: 0, recoverableUsd: 0, rankedDepartments: [] }, source: "import" }));
  assert.match(text, /no department rows/);
  assert.doesNotMatch(text, /Input digest/);
});

// ---------------------------------------------------------------------------
// 4. The reader's file is untrusted input.
// ---------------------------------------------------------------------------

/** Short enough to survive the display truncation, so the whole string is assertable. */
const HOSTILE_LABEL = '<img src=x onerror=alert(1)>&"Ops\' team"';

test("a department label carrying markup renders as literal text and builds no element", () => {
  const { list, text } = rendered(standHeadlineForImport({
    analysis: {
      spendUsd: 200,
      recoverableUsd: 100,
      rankedDepartments: [{ id: "psn_unit_synth_00000001", name: HOSTILE_LABEL, spendUsd: 200, recoverableUsd: 100 }],
    },
    eligibility: null,
  }));

  // Nothing the reader's file said became a node. The disclosure is dt/dd pairs
  // and their wrappers, and no img, script, or anchor is among them.
  assert.deepEqual(list.querySelectorAll("img,script,a,iframe,style"), []);
  // …and the characters are on screen as characters, angle brackets and quotes
  // included, which is only possible if nothing went through innerHTML.
  assert.ok(text.includes(HOSTILE_LABEL),
    `the hostile label did not survive as literal text: ${text}`);
});

test("an absurd label is truncated for display and hashed in full", () => {
  const long = `Team ${"a".repeat(400)}`;
  const other = `Team ${"a".repeat(399)}b`;
  const analysisFor = (name) => ({
    spendUsd: 200,
    recoverableUsd: 100,
    rankedDepartments: [{ name, spendUsd: 200, recoverableUsd: 100 }],
  });

  const provenance = buildInputProvenance({ analysis: analysisFor(long), source: "import" });
  assert.equal(provenance.named[0].displayLabel.length, DISPLAY_LABEL_LIMIT);
  assert.ok(provenance.named[0].displayLabel.endsWith("…"));
  assert.equal(provenance.named[0].label, long, "the untruncated label was not retained");

  // Two labels that differ only PAST the truncation point are different inputs,
  // which is only true if the digest saw the whole thing.
  assert.notEqual(provenance.digest,
    buildInputProvenance({ analysis: analysisFor(other), source: "import" }).digest);

  // And the rendered term carries the cut label, not four hundred characters.
  const { text } = rendered(standHeadlineForImport({ analysis: analysisFor(long), eligibility: null }));
  assert.doesNotMatch(text, new RegExp("a{100}"), "the disclosure printed an unbounded label");
});
