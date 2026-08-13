// The headline an imported export earns, contract and rendered states.
//
// What is pinned here is the product rule, not an object shape:
//
//   1. Five slots, always five. A rich import earns all five from its own
//      figures; a minimal one still renders five, and the four it cannot supply
//      carry the fixture's fallback sentence and its fallback provenance label.
//   2. The tier is earned, never awarded: 4 satisfied reads high, 2–3 medium,
//      0–1 low, and an import that supported almost nothing reads low.
//   3. No slot may ship without its fallback, its definition, and both
//      provenance labels — asserted against the checked-in fixture itself, so a
//      sixth slot added tomorrow is covered by this test on the day it lands.
//   4. The bundled example's headline is not this block. Passing no analysis
//      takes it off screen.
//
// Envelopes are built in-test in the shape `normalizeLocalFinopsHistory`
// publishes — the approach tests/finops-portfolio-brief.test.js takes — so a
// minimal export a real reader reaches rarely is covered directly.
//
// Assertions are on counts, attributes, and substrings. The harness reads text
// through collapsed containers and its selects accept unlisted values, so
// "this slot fell back" is held on `data-supported` and the rendered provenance
// label rather than on visibility.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseHtml } from "./support/browser.js";
import {
  CONFIDENCE_TIER, IMPORTED_HEADLINE_FIXTURE, IMPORTED_HEADLINE_SLOT_IDS, importedHeadline,
} from "../src/finops-imported-headline.js";
import {
  applyImportedHeadline, clearImportedHeadline,
} from "../src/finops-imported-headline-view.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const html = await readFile(PAGE, "utf8");

// --- fixtures ---------------------------------------------------------------

/** Every slot supported: a complete month, both figures, grouped, with an action. */
function richImport(overrides = {}) {
  return {
    period: "2026-01-01 to 2026-02-01",
    spendUsd: 240_000,
    recoverableUsd: 36_000,
    rankedDepartments: [
      { id: "unit-a", name: "Platform", spendUsd: 120_000, recoverableUsd: 21_000 },
      { id: "unit-b", name: "Support", spendUsd: 80_000, recoverableUsd: 9_000 },
    ],
    action: "Pilot lower-cost routing for text-generation in Platform; cap the pilot at 21000.00 USD.",
    history: {
      state: "available",
      periods: [
        { period: "2025-12", spendUsd: 210_000, recoverableUsd: 30_000, completeness: "complete" },
        { period: "2026-01", spendUsd: 240_000, recoverableUsd: 36_000, completeness: "complete" },
      ],
    },
    ...overrides,
  };
}

/** A total-only export: no grouping, no per-item recoverable classification. */
const minimalImport = {
  period: "2026-01-01 to 2026-02-01",
  spendUsd: 240_000,
  rankedDepartments: [],
  action: "Resolve data-quality gaps before selecting a cost action.",
  history: {
    state: "unavailable",
    periods: [{ period: "2026-01", spendUsd: 240_000, completeness: "partial" }],
  },
};

const slotOf = (headline, id) => headline.slots.find((entry) => entry.id === id);

// --- 1. the contract itself -------------------------------------------------

test("no slot in the contract may ship without its fallback, definition and labels", () => {
  const slots = IMPORTED_HEADLINE_FIXTURE.slots;
  // The order is the READING order (#981): the figure the question asks for,
  // the one action to take about it, then the support. It changed here when the
  // block was made readable in one pass, and it changed in the fixture — which
  // is the property this assertion exists to hold, not the old sequence.
  assert.deepEqual(slots.map((slot) => slot.id), [
    "recoverable_spend", "rank_1_action", "peer_position", "top_department", "confidence_tier",
  ], "the five slots are ordered by the contract, and the renderer follows it");
  assert.ok(IMPORTED_HEADLINE_FIXTURE.question.trim().length > 0,
    "the imported state has its own answerable question line");
  for (const slot of slots) {
    for (const field of ["label", "fallback", "definition",
      "provenance_supported", "provenance_fallback"]) {
      assert.equal(typeof slot[field], "string", `${slot.id}.${field} is not a string`);
      assert.ok(slot[field].trim().length > 0, `${slot.id} ships with an empty ${field}`);
    }
    assert.ok(Array.isArray(slot.source_fields) && slot.source_fields.length > 0,
      `${slot.id} names no field in the parsed import that it derives from`);
    // A fallback states what the analysis did with the data it has. An
    // imperative back to the reader is the thing this contract exists to keep
    // out of the headline.
    assert.doesNotMatch(slot.fallback, /\b(try again|re-?import|add a column|unsupported format)\b/i,
      `${slot.id}'s fallback instructs the reader instead of stating what was computed`);
  }
});

// --- 2. a rich import -------------------------------------------------------

test("a rich import earns all five slots from its own figures and reads high", () => {
  const headline = importedHeadline(richImport());
  assert.equal(headline.slots.length, 5);
  assert.deepEqual(headline.slots.map((slot) => slot.id), [...IMPORTED_HEADLINE_SLOT_IDS]);
  assert.equal(headline.satisfiedCount, 4);
  assert.equal(headline.tier, CONFIDENCE_TIER.high);
  assert.equal(headline.slots.every((slot) => slot.supported), true,
    "every slot this export supports must be marked supported");
  // The most recent COMPLETE month, whole units, not annualized and not summed
  // across the two months present.
  assert.equal(slotOf(headline, "recoverable_spend").value, "36,000 USD");
  // The largest ABSOLUTE recoverable amount, not the largest percentage:
  // Support recovers a larger share of its own spend than Platform does.
  assert.equal(slotOf(headline, "top_department").value, "Platform");
  assert.match(slotOf(headline, "peer_position").value, /% of spend is recoverable/);
  assert.equal(slotOf(headline, "confidence_tier").value, "high");
  for (const slot of headline.slots) {
    assert.notEqual(slot.value, slot.fallback, `${slot.id} printed its fallback anyway`);
  }
});

test("the top department is the largest absolute recoverable amount, and ties are broken", () => {
  const tied = importedHeadline(richImport({
    rankedDepartments: [
      { name: "Zeta", spendUsd: 40_000, recoverableUsd: 9_000 },
      { name: "Alpha", spendUsd: 90_000, recoverableUsd: 9_000 },
    ],
  }));
  assert.equal(slotOf(tied, "top_department").value, "Alpha",
    "an equal recoverable amount breaks on the larger total spend");
});

// --- 3. a minimal import ----------------------------------------------------

test("a total-only export still renders five slots, with the contract's own sentences", () => {
  const headline = importedHeadline(minimalImport);
  assert.equal(headline.slots.length, 5, "a thin export gets five rows, never four");
  assert.equal(headline.satisfiedCount, 0);
  assert.equal(headline.tier, CONFIDENCE_TIER.low,
    "an import that supported nothing must read low rather than a warmer tier");
  for (const id of ["recoverable_spend", "peer_position", "top_department", "rank_1_action"]) {
    const slot = slotOf(headline, id);
    assert.equal(slot.supported, false, `${id} claimed support it does not have`);
    assert.equal(slot.value, slot.fallback, `${id} did not print the contract's fallback`);
    assert.equal(slot.provenance, IMPORTED_HEADLINE_FIXTURE.slots
      .find((entry) => entry.id === id).provenance_fallback);
  }
  assert.equal(slotOf(headline, "confidence_tier").value, "low");
});

// --- 4. a partial import ----------------------------------------------------

test("a partial import lands in medium and states which slots came from the export", () => {
  // A complete month with both figures — so the figure and the placement are
  // the reader's own — but no grouping column, so no department and no ranked
  // action can be derived from it.
  const headline = importedHeadline(richImport({ rankedDepartments: [], action: "" }));
  assert.equal(headline.satisfiedCount, 2);
  assert.equal(headline.tier, CONFIDENCE_TIER.medium);
  const supported = headline.slots.filter((slot) => slot.supported).map((slot) => slot.id);
  assert.deepEqual(supported, ["recoverable_spend", "peer_position", "confidence_tier"]);
  const labels = new Set(headline.slots.map((slot) => slot.provenance));
  assert.ok(labels.size > 1, "a mixed import must show both provenance labels, not one of them");
  assert.equal(slotOf(headline, "top_department").provenance,
    IMPORTED_HEADLINE_FIXTURE.slots
      .find((entry) => entry.id === "top_department").provenance_fallback);
});

// --- 5. the rendered surface ------------------------------------------------

test("the shipped page paints five slot rows on import, in contract order", () => {
  const document = parseHtml(html);
  const painted = applyImportedHeadline(document, richImport());
  const region = document.getElementById("finops-imported-headline");
  assert.equal(region.hidden, false);
  assert.equal(region.dataset.state, "imported");
  assert.equal(region.dataset.tier, "high");
  assert.equal(document.getElementById("finops-imported-headline-question").textContent,
    IMPORTED_HEADLINE_FIXTURE.question, "the question line renders above the slots");
  const rows = document.querySelectorAll("dd.imported-headline-slot");
  assert.equal(rows.length, 5);
  assert.deepEqual([...rows].map((row) => row.dataset.slot), [...IMPORTED_HEADLINE_SLOT_IDS]);
  assert.equal([...rows].filter((row) => row.dataset.supported === "true").length, 5);
  assert.equal(painted.tier, "high");
});

test("a minimal import paints five rows carrying the fallback strings and labels", () => {
  const document = parseHtml(html);
  applyImportedHeadline(document, minimalImport);
  const rows = document.querySelectorAll("dd.imported-headline-slot");
  assert.equal(rows.length, 5, "a slot the export cannot support is never omitted");
  const fallen = [...rows].filter((row) => row.dataset.supported === "false");
  assert.equal(fallen.length, 4);
  const painted = document.getElementById("finops-imported-headline-slots").textContent;
  for (const id of ["recoverable_spend", "peer_position", "top_department", "rank_1_action"]) {
    const slot = IMPORTED_HEADLINE_FIXTURE.slots.find((entry) => entry.id === id);
    assert.ok(painted.includes(slot.fallback), `${id}'s fallback sentence never reached the page`);
    assert.ok(painted.includes(slot.provenance_fallback),
      `${id}'s fallback provenance label never reached the page`);
  }
  assert.equal(document.getElementById("finops-imported-headline").dataset.tier, "low");
  // No figure from the bundled example may stand in for a slot this export
  // could not supply.
  assert.equal(painted.includes("Bundled synthetic example"), false);
});

test("clearing the import takes the block off screen and leaves no stale row", () => {
  const document = parseHtml(html);
  applyImportedHeadline(document, richImport());
  clearImportedHeadline(document);
  const region = document.getElementById("finops-imported-headline");
  assert.equal(region.hidden, true);
  assert.equal(region.dataset.state, "unavailable");
  assert.equal(document.querySelectorAll("dd.imported-headline-slot").length, 0);
  assert.equal(document.getElementById("finops-imported-headline-question").textContent, "");
});

test("the example headline's own nodes are untouched by this block", () => {
  const document = parseHtml(html);
  const before = document.getElementById("finops-stand-answer").textContent;
  applyImportedHeadline(document, richImport());
  assert.equal(document.getElementById("finops-stand-answer").textContent, before);
  assert.equal(document.getElementById("finops-stand-question").textContent,
    "Evidence behind the recoverable AI spend answer");
});
