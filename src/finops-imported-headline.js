// The headline an imported export earns, computed through a checked-in contract.
//
// WHAT THIS FIXES. The bundled example ships a complete headline — a figure, a
// position, a named department, one action. An import that could not supply one
// of those simply rendered fewer things, and a reader had no way to tell an
// irrelevant slot from a silently dropped one. Worse, the strings that covered
// the gaps were authored inline at the render site, so "what does this product
// say when a department column is missing?" had no answer anybody could read
// without reading a renderer.
//
// So the contract is a file: src/finops-imported-headline-fixture.json holds
// the five slots, their order, their labels, the exact fields each derives
// from, the sentence each prints when the export cannot supply it, the two
// provenance labels it may carry, and the metric definition itself. This module
// computes the five values and NOTHING ELSE — every word a reader reads comes
// off that fixture. A slot cannot ship without its fallback because the fixture
// is where a slot is added, and tests/finops-imported-headline.test.js reads
// the fixture rather than a list retyped in a test.
//
// WHAT IT NEVER DOES.
//
//   * Touch the example path. `buildStandHeadline` in finops-stand.js is
//     unchanged and does not read this file. Only the imported state routes
//     through here, which is why the two can differ in shape at all.
//   * Borrow a number. An unsupported slot prints the fixture's fallback. There
//     is no path on which the bundled example's figure reaches an imported
//     headline.
//   * Recompute an analysis. Every figure is read off the envelope
//     `normalizeLocalFinopsHistory` already published — the same envelope the
//     single-drop import path from #970/#974 hands the rest of the page.
//   * Build a node, read storage, open a request, or read a clock.
//
// THE TIER IS HONEST BY CONSTRUCTION. `confidence_tier` counts the four slots
// above it and nothing else, so an import that supported one of them reads
// `low` even though the page could have said something warmer. That is the
// point: a tier that can only be earned is a tier a leader can quote.

import FIXTURE from "./finops-imported-headline-fixture.json" with { type: "json" };
import { PEER_COHORTS } from "./peer-cohort-fixtures.js";
import { formatUsd } from "./evolution.js";
// The reader's own name for the unit this headline names, through the one
// resolver. No slot reads the label map directly.
import { orgUnitDisplayName } from "./org-unit-display-label.js";

/** Bump when a slot, an order, or a derivation rule changes meaning. */
export const IMPORTED_HEADLINE_VERSION = "finops-imported-headline/1.0.0";

/** The contract itself, exported so a caller reads the file rather than a copy. */
export const IMPORTED_HEADLINE_FIXTURE = Object.freeze(FIXTURE);

/** The five slot ids, in the order the fixture publishes them. */
export const IMPORTED_HEADLINE_SLOT_IDS = Object.freeze(
  FIXTURE.slots.map((slot) => slot.id));

/** The three tiers. There is no fourth, and none of them is a compliment. */
export const CONFIDENCE_TIER = Object.freeze({ high: "high", medium: "medium", low: "low" });

const list = (value) => (Array.isArray(value) ? value : []);

const money = (value) => (Number.isFinite(value) && value >= 0 ? value : null);

const filled = (value) => typeof value === "string" && value.trim() !== "";

const percent = (part, whole) => Math.round((part / whole) * 100);

// Money beside a named unit is rendered currency, not a bare figure with a code
// after it. Only USD goes through `formatUsd` — the contract admits USD alone,
// and an export declaring anything else keeps its own code rather than being
// silently restated in dollars.
const amount = (value, currency) => (currency === "USD"
  ? formatUsd(value)
  : `${Math.round(value).toLocaleString("en-US")} ${currency}`);

/**
 * The most recent COMPLETE billing month in the export.
 *
 * "Complete" is the period record's own `completeness`, not a judgement made
 * here: a partial month is skipped rather than summed, and it never stands in
 * for the complete one before it. Later entries win because
 * `normalizeLocalFinopsHistory` publishes periods oldest first.
 */
export function latestCompleteMonth(analysis) {
  let found = null;
  for (const entry of list(analysis?.history?.periods)) {
    if (entry?.completeness === "complete") found = entry;
  }
  return found;
}

/**
 * The department carrying the most recoverable spend.
 *
 * Absolute amount, then larger total spend, then name — the fixture's rule,
 * applied here and stated there. A group with no recoverable spend is not a
 * candidate: naming one would present a zero as a finding.
 */
export function topRecoverableDepartment(analysis) {
  const ranked = list(analysis?.rankedDepartments)
    .filter((entry) => filled(entry?.name) && money(entry?.recoverableUsd) > 0);
  if (ranked.length === 0) return null;
  return ranked.slice().sort((left, right) => (right.recoverableUsd - left.recoverableUsd)
    || ((money(right.spendUsd) ?? 0) - (money(left.spendUsd) ?? 0))
    || String(left.name).localeCompare(String(right.name)))[0];
}

/**
 * Where this recoverable share sits among the bundled cohort's published ones.
 *
 * The percentile is the share of members strictly below this one, so an export
 * that recovers more than everybody published reads 100 and one that recovers
 * less than everybody reads 0. The band is the quartile that percentile falls
 * in, named by the fixture rather than here.
 */
export function cohortBand(share) {
  const members = PEER_COHORTS.flatMap((cohort) => list(cohort.members))
    .map((member) => member.recoverableShare)
    .filter((value) => Number.isFinite(value));
  if (members.length === 0 || !Number.isFinite(share)) return null;
  const below = members.filter((value) => value < share).length;
  const percentile = Math.round((below / members.length) * 100);
  const bands = FIXTURE.cohort.bands;
  const index = Math.min(bands.length - 1, Math.floor((percentile / 100) * bands.length));
  return Object.freeze({
    percentile, band: bands[index], memberCount: members.length, label: FIXTURE.cohort.label,
  });
}

/** One rendered slot: the fixture's own words, plus the one value it earned. */
function slot(spec, { supported, value, detail = "" }) {
  return Object.freeze({
    id: spec.id,
    label: spec.label,
    supported,
    // The fallback IS the value when the export could not supply one. A slot is
    // never blank and never omitted, so the row count is five in every state.
    value: supported ? value : spec.fallback,
    detail: supported ? detail : "",
    provenance: supported ? spec.provenance_supported : spec.provenance_fallback,
    definition: spec.definition,
    fallback: spec.fallback,
    sourceFields: Object.freeze([...spec.source_fields]),
  });
}

const specFor = (id) => FIXTURE.slots.find((entry) => entry.id === id);

/**
 * The five-slot headline for one imported analysis.
 *
 * @param analysis an envelope from `normalizeLocalFinopsHistory`, or null.
 * @param {{labels?: object}} [options] the reader's own org-unit names, from
 *   page state. Absent leaves every slot exactly as it reads today.
 * @returns `{ version, contractVersion, question, tier, satisfiedCount, slots }`
 *   with exactly five slots, in fixture order, in every state including null.
 */
export function importedHeadline(analysis = null, { labels = null } = {}) {
  const month = latestCompleteMonth(analysis);
  const currency = filled(analysis?.currency) ? analysis.currency : FIXTURE.currencyDefault;
  const recoverable = money(month?.recoverableUsd);
  const spend = money(month?.spendUsd);

  const recoverableSlot = slot(specFor("recoverable_spend"), recoverable === null
    ? { supported: false }
    : {
      supported: true,
      value: `${Math.round(recoverable).toLocaleString("en-US")} ${currency}`,
      detail: `${month.period} · one complete billing month, not annualized.`,
    });

  const placement = recoverable !== null && spend !== null && spend > 0
    ? cohortBand(recoverable / spend) : null;
  const positionSlot = slot(specFor("peer_position"), placement === null
    ? { supported: false }
    : {
      supported: true,
      value: `${placement.band} · ${percent(recoverable, spend)}% of spend is recoverable`,
      detail: `Above ${placement.percentile}% of the ${placement.memberCount} members of `
        + `${placement.label}. A higher band is more headroom, not more efficiency.`,
    });

  const top = topRecoverableDepartment(analysis);
  // Resolved once, used by both slots below: the department slot and the action
  // that names the same department cannot disagree about what it is called.
  const topName = top === null ? "" : orgUnitDisplayName(labels, top.id, top.name);
  const departmentSlot = slot(specFor("top_department"), top === null
    ? { supported: false }
    : {
      supported: true,
      value: topName,
      detail: `${amount(top.recoverableUsd, currency)} recoverable, `
        + "the largest absolute amount of any group in this export.",
    });

  const actionSlot = slot(specFor("rank_1_action"), top === null || !filled(analysis?.action)
    ? { supported: false }
    : {
      supported: true,
      value: analysis.action,
      detail: `Ranked first by recoverable spend, which is ${topName}'s.`,
    });

  // THE ORDER IS THE FIXTURE'S, and the fixture's order is the reading order:
  // the figure the question asks for, the one action to take about it, then the
  // support. `$readingOrder` in the fixture states it; this array follows it, so
  // a slot cannot be reordered on the page without being reordered in the
  // contract. The tier is last because it is a fact about the four above it.
  const earned = [recoverableSlot, actionSlot, positionSlot, departmentSlot];
  const satisfiedCount = earned.filter((entry) => entry.supported).length;
  const tier = satisfiedCount >= 4 ? CONFIDENCE_TIER.high
    : satisfiedCount >= 2 ? CONFIDENCE_TIER.medium : CONFIDENCE_TIER.low;
  // The tier is a fact about the four slots above, so it is supported whenever
  // those four were evaluated at all. Only "no export was read" falls back —
  // and a read that satisfied nothing still reads `low` rather than hiding.
  const tierSlot = slot(specFor("confidence_tier"), analysis === null
    ? { supported: false }
    : {
      supported: true,
      value: tier,
      detail: `${satisfiedCount} of the 4 slots above came from your export.`,
    });

  return Object.freeze({
    version: IMPORTED_HEADLINE_VERSION,
    contractVersion: FIXTURE.contractVersion,
    available: analysis !== null,
    question: FIXTURE.question,
    tier: analysis === null ? null : tier,
    satisfiedCount,
    slots: Object.freeze([...earned, tierSlot]),
  });
}
