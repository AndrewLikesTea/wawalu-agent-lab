// Attribution units — one explicit unit type behind every published figure.
//
// The premise this module removes is that analysis needs an HRIS org file. A
// provider export already carries the column the provider bills by (Anya's
// `detectNativeGrouping` names it), and the JSON provider contract carries
// `org_unit_id` for the same reason. That value is the attribution unit. The org
// file becomes optional enrichment that *renames* units a leader already has.
//
// The one thing this module refuses to do is drop a row. Spend whose grouping
// value is missing, empty, or whitespace-only is not excluded from the mix and
// it is not folded into somebody else's number: it becomes exactly one reserved
// unit with `source: "unattributed"` that flows through the spend mix, the
// per-model overspend finding, and the ranked recoverable list. Silence about
// unattributed money reads as "we looked and there was none", which is a
// different and wrong claim.
//
// COLLISION, BY CONSTRUCTION RATHER THAN BY LUCK. Every attributed unit key is
// its source name, a colon, then the raw group value — `provider-group:atlas`,
// `org-mapped:Platform`. The reserved key is the bare token `unattributed`,
// which contains no colon, so no raw group value of any length or content can
// ever produce it. The tie-break a reader is owed: a provider export whose group
// column literally contains the string `unattributed` yields the key
// `provider-group:unattributed` — a real, visible, attributed unit that sits
// beside the reserved bucket and is never merged into it.
//
// THRESHOLDS ARE NOOR'S, IMPORTED RATHER THAN RESTATED. `COVERAGE_TIERS` and
// `NO_BASELINE_TIER` in `grade-eligibility.js` are the only degrade/suppress
// numbers in this product, and `sampledSpendCoverage` is the only zero-guarded
// ratio. Re-spelling either here is how the two would drift.
//
// No I/O of any kind: no fetch, no storage, no credential, no network.

import { COVERAGE_TIERS, NO_BASELINE_TIER, sampledSpendCoverage } from "./grade-eligibility.js";
import { orgUnitPseudonym } from "./unit-pseudonym.js";

/** Bump the minor when a field is added, the major when one changes meaning. */
export const ATTRIBUTION_VERSION = "attribution-unit/1.0.0";

/**
 * Where a unit's identity came from. Closed set; a consumer may switch on it.
 *
 * @typedef {"provider-group"|"unattributed"|"org-mapped"} AttributionSource
 */
export const ATTRIBUTION_SOURCES = Object.freeze({
  /** The grouping value the provider's own export carries. */
  providerGroup: "provider-group",
  /** The one reserved bucket: rows whose grouping value is blank. */
  unattributed: "unattributed",
  /** A provider group renamed by the optional org mapping. */
  orgMapped: "org-mapped",
});

/**
 * The reserved key. A bare token with no colon; see the collision note above.
 * Exported so a consumer can recognize the bucket without string-matching a
 * label, which is prose and may be reworded.
 */
export const UNATTRIBUTED_KEY = "unattributed";

/**
 * @typedef {object} AttributionUnit
 * @property {string} key    stable machine key; namespaced, see above
 * @property {string} label  renderable name; never switched on
 * @property {AttributionSource} source
 *
 * @typedef {object} Coverage
 * @property {number} attributedSpend    USD in units with a real group value
 * @property {number} unattributedSpend  USD in the reserved bucket
 * @property {number|null} attributedShare
 *   attributedSpend / (attributedSpend + unattributedSpend), in [0, 1]. `null`
 *   exactly when the denominator is not positive — a defined "no denominator"
 *   result rather than NaN or a fabricated 0.
 */

/** The reserved unit itself. One object, so identity comparison also works. */
export const UNATTRIBUTED_UNIT = Object.freeze({
  key: UNATTRIBUTED_KEY,
  label: "Unattributed spend",
  source: ATTRIBUTION_SOURCES.unattributed,
});

/**
 * The pseudonym a blank grouping cell already becomes upstream.
 *
 * `finops-tabular-import.js` runs every grouping label through
 * `orgUnitPseudonym`, and `unitKey` collapses a missing, empty, or
 * whitespace-only label to the empty string first — so all three arrive here as
 * this one id, wearing the same `psn_unit_` prefix a real unit wears. That is
 * precisely the silence this module exists to end: without naming the value, a
 * blank column reads downstream as a perfectly ordinary team.
 *
 * It is computed, never transcribed, so it cannot drift from the digest that
 * produces it. No non-blank label can produce it, because `unitKey` maps only
 * blanks to `""`; a hand-written literal equal to it is therefore reserved and
 * read as unattributed by definition.
 */
export const BLANK_GROUP_PSEUDONYM = orgUnitPseudonym("");

const isBlankGroup = (value) =>
  value === undefined || value === null || String(value).trim() === ""
  || String(value).trim() === BLANK_GROUP_PSEUDONYM;

const roundUsd = (usd) => Math.round(usd * 100) / 100;

/**
 * Build an attributed unit. `source` must not be `unattributed`: the reserved
 * bucket is `UNATTRIBUTED_UNIT` and is never constructed from a raw value.
 */
export function attributionUnit(source, value, label = null) {
  if (source === ATTRIBUTION_SOURCES.unattributed) {
    throw new TypeError("The unattributed unit is reserved; use UNATTRIBUTED_UNIT.");
  }
  const raw = String(value).trim();
  return Object.freeze({ key: `${source}:${raw}`, label: label ?? raw, source });
}

/** True for the one reserved bucket, without matching its prose label. */
export const isUnattributed = (unit) => unit?.source === ATTRIBUTION_SOURCES.unattributed;

/**
 * Coverage over already-bucketed entries. Computed from the same rows as the
 * figure it describes — callers pass that figure's own entries, never a global
 * total — so `attributedSpend + unattributedSpend` is that figure's total spend
 * by construction rather than by a second, drifting sum.
 *
 * @param {Array<{unit: AttributionUnit, spendUsd: number}>} entries
 * @returns {Coverage}
 */
export function coverageOf(entries) {
  let attributed = 0;
  let unattributed = 0;
  for (const entry of entries ?? []) {
    const spend = Number(entry?.spendUsd);
    if (!Number.isFinite(spend)) continue;
    if (isUnattributed(entry.unit)) unattributed += spend;
    else attributed += spend;
  }
  const attributedSpend = roundUsd(attributed);
  const unattributedSpend = roundUsd(unattributed);
  // The zero guard is Noor's: a non-positive denominator has no ratio at all,
  // and `null` is the value this codebase already publishes for that.
  const { ratio } = sampledSpendCoverage({
    coveredUsd: attributedSpend,
    totalUsd: roundUsd(attributedSpend + unattributedSpend),
  });
  return Object.freeze({ attributedSpend, unattributedSpend, attributedShare: ratio });
}

/**
 * Bucket rows into units, with exactly one reserved bucket for blank groups.
 *
 * @param {Array<T>} rows
 * @param {{groupOf: (row: T) => unknown, spendOf: (row: T) => number,
 *          source?: AttributionSource, labelOf?: (value: string) => string}} readers
 * @returns {{units: Array<{unit: AttributionUnit, spendUsd: number, records: number,
 *            rows: T[]}>, coverage: Coverage, totalSpendUsd: number}}
 *   Units are ordered by spend descending, then by key, so the same rows always
 *   produce the same list. The reserved bucket is present only when a blank row
 *   exists — an invented empty bucket would be a number a leader would act on.
 */
export function buildSpendMix(rows, {
  groupOf, spendOf, source = ATTRIBUTION_SOURCES.providerGroup, labelOf = null,
} = {}) {
  const buckets = new Map();
  for (const row of rows ?? []) {
    const raw = groupOf(row);
    const unit = isBlankGroup(raw)
      ? UNATTRIBUTED_UNIT
      : attributionUnit(source, raw, labelOf ? labelOf(String(raw).trim()) : null);
    const current = buckets.get(unit.key)
      ?? { unit, spendUsd: 0, records: 0, rows: [] };
    const spend = Number(spendOf(row));
    current.spendUsd += Number.isFinite(spend) ? spend : 0;
    current.records += 1;
    current.rows.push(row);
    buckets.set(unit.key, current);
  }
  const units = [...buckets.values()]
    .map((entry) => ({ ...entry, spendUsd: roundUsd(entry.spendUsd) }))
    .sort((left, right) => right.spendUsd - left.spendUsd
      || left.unit.key.localeCompare(right.unit.key));
  const coverage = coverageOf(units);
  return Object.freeze({
    units,
    coverage,
    totalSpendUsd: roundUsd(coverage.attributedSpend + coverage.unattributedSpend),
  });
}

// --- thresholds ------------------------------------------------------------

/**
 * Apply Noor's published tiers to an attributed share. No number in this file:
 * the floors, the states, and the rule sentences all come from
 * `grade-eligibility.js`, and adding one here would be adding a threshold.
 *
 * @param {Coverage} coverage
 * @returns {{state: string, tier: string, present: boolean, degraded: boolean,
 *            suppressed: boolean, reason: {code: string, tier: string,
 *            floor: number|null, observedShare: number|null, rule: string}}}
 *   `present` is false only when the finding is suppressed, and the reason
 *   travels either way — a suppressed finding is represented, never absent, so
 *   a surface can say why a ranking is missing instead of painting an empty
 *   list.
 */
export function coverageThreshold(coverage) {
  const share = coverage?.attributedShare ?? null;
  const tier = share === null
    ? NO_BASELINE_TIER
    : COVERAGE_TIERS.find((entry) => share >= entry.floor)
      ?? COVERAGE_TIERS[COVERAGE_TIERS.length - 1];
  return Object.freeze({
    state: tier.state,
    tier: tier.tier,
    // `showGrade` is the flag Noor's module publishes for exactly this; reading
    // it rather than re-deriving "is this tier good enough" keeps one decision.
    present: tier.showGrade,
    degraded: tier.state === "provisional",
    suppressed: !tier.showGrade,
    reason: Object.freeze({
      code: tier.reason,
      tier: tier.tier,
      floor: tier.floor,
      observedShare: share,
      rule: tier.rule,
    }),
  });
}

// --- optional enrichment, applied after the fact ---------------------------

/** Thrown for a malformed mapping. The input result is never modified. */
export class OrgMappingError extends Error {
  constructor(message, problems = []) {
    super(message);
    this.name = "OrgMappingError";
    this.code = "malformed_org_mapping";
    this.problems = Object.freeze([...problems]);
  }
}

/**
 * @typedef {Array<{unit: string, department: string}>} OrgMapping
 *   The same row shape `applyGroupingEnrichment` takes, so one mapping file
 *   feeds both the delimited path and this one.
 */

function readMapping(mapping) {
  if (!Array.isArray(mapping)) {
    throw new OrgMappingError("The org mapping is not a list of unit mappings.");
  }
  const problems = [];
  const byUnit = new Map();
  for (const [position, row] of mapping.entries()) {
    const unit = typeof row?.unit === "string" ? row.unit.trim() : "";
    const department = typeof row?.department === "string" ? row.department.trim() : "";
    if (!unit || !department) {
      problems.push(`Row ${position + 1} does not name both a unit and a department.`);
      continue;
    }
    // First row wins, so a duplicated unit is deterministic rather than
    // last-one-through, matching `applyGroupingEnrichment`.
    if (byUnit.has(unit)) {
      problems.push(`Row ${position + 1} repeats unit ${unit}; the first mapping stands.`);
      continue;
    }
    byUnit.set(unit, department);
  }
  // All-or-nothing: a mapping with any unusable row is a malformed file, not a
  // partial success. Returning a half-enriched object would publish a number
  // nobody can reproduce from the file they uploaded.
  if (problems.length) throw new OrgMappingError("The org mapping could not be read.", problems);
  if (!byUnit.size) throw new OrgMappingError("The org mapping names no unit.");
  return byUnit;
}

/** The raw group value behind an attributed key, or null for the reserved one. */
function rawValueOf(unit) {
  if (isUnattributed(unit)) return null;
  const separator = unit.key.indexOf(":");
  return separator < 0 ? unit.key : unit.key.slice(separator + 1);
}

function figureDelta(figure, before, after, rekeyed) {
  return Object.freeze({
    figure,
    before: roundUsd(before),
    after: roundUsd(after),
    difference: roundUsd(after - before),
    rekeyedUnits: Object.freeze(rekeyed),
  });
}

/**
 * Re-key an already-materialized analysis result to departments.
 *
 * Total and deterministic, and a *pure transform over the result object*: it
 * reads `result.attribution` and `result.rankedDepartments` and nothing else.
 * No file is re-read, no parser is called, and no extraction runs — adding an
 * org file later costs one function call over data already in memory.
 *
 * Three states, kept distinct on purpose:
 *   * mapped — the unit's group value has a mapping row; the unit is re-keyed
 *     to `org-mapped:<department>` and units sharing a department merge in the
 *     mix (summing already-computed per-unit spend, which changes no rate).
 *   * attributed-but-unmapped — no mapping row. The unit keeps its provider
 *     label and stays visible. It is *not* moved to the unattributed bucket:
 *     it was attributed, and conflating the two would hide real coverage.
 *   * unattributed — the reserved bucket is never re-keyed. It was never
 *     attributed, so no department can claim it.
 *
 * @param {object} result an analysis result carrying `attribution`
 * @param {OrgMapping} mapping
 * @returns {object} a new result; the input is not mutated
 * @throws {OrgMappingError} on a malformed mapping, before anything is built
 */
export function enrichWithOrgMapping(result, mapping) {
  const byUnit = readMapping(mapping);
  const attribution = result?.attribution;
  if (!attribution?.spendMix) {
    throw new OrgMappingError("The result carries no attribution to enrich.");
  }

  const rekeyed = [];
  const merged = new Map();
  for (const entry of attribution.spendMix.units) {
    const raw = rawValueOf(entry.unit);
    const department = raw === null ? undefined : byUnit.get(raw);
    const unit = department === undefined
      ? entry.unit
      : attributionUnit(ATTRIBUTION_SOURCES.orgMapped, department);
    if (department !== undefined) {
      rekeyed.push(Object.freeze({
        from: entry.unit.key, to: unit.key, department, spendUsd: entry.spendUsd,
      }));
    }
    const current = merged.get(unit.key) ?? { unit, spendUsd: 0, records: 0, rows: [] };
    current.spendUsd = roundUsd(current.spendUsd + entry.spendUsd);
    current.records += entry.records;
    current.rows = [...current.rows, ...(entry.rows ?? [])];
    merged.set(unit.key, current);
  }
  const units = [...merged.values()].sort((left, right) =>
    right.spendUsd - left.spendUsd || left.unit.key.localeCompare(right.unit.key));
  const coverage = coverageOf(units);
  const spendMix = Object.freeze({
    units,
    coverage,
    totalSpendUsd: roundUsd(coverage.attributedSpend + coverage.unattributedSpend),
  });

  const rekeyedByKey = new Map(rekeyed.map((entry) => [entry.from, entry]));
  const rankedDepartments = (result.rankedDepartments ?? []).map((department) => {
    const match = department.unit ? rekeyedByKey.get(department.unit.key) : undefined;
    if (!match) return department;
    // Only identity moves. `recoverableUsd`, `spendUsd`, and the whole
    // `downRouting` object are the arithmetic the fixtures pin, and they are
    // carried through untouched.
    return Object.freeze({
      ...department,
      unit: attributionUnit(ATTRIBUTION_SOURCES.orgMapped, match.department),
      name: match.department,
    });
  });

  const rankedRecoverable = attribution.rankedRecoverable;
  const modelOverspend = attribution.modelOverspend;
  return Object.freeze({
    ...result,
    rankedDepartments: Object.freeze(rankedDepartments),
    attribution: Object.freeze({
      ...attribution,
      spendMix,
      // Re-keying moves no money across the attributed/unattributed line, so
      // both remaining figures keep their coverage. Recomputing them from a
      // different row set is exactly the "pasted-on global figure" this design
      // rejects, so they are carried, and the delta below proves they held.
      orgMappingApplied: true,
    }),
    orgEnrichment: Object.freeze({
      version: ATTRIBUTION_VERSION,
      applied: rekeyed.length > 0,
      mappedUnits: Object.freeze(rekeyed),
      unmappedUnits: Object.freeze(units
        .filter((entry) => entry.unit.source === ATTRIBUTION_SOURCES.providerGroup)
        .map((entry) => entry.unit.key)),
      unknownMappingUnits: Object.freeze([...byUnit.keys()]
        .filter((raw) => !attribution.spendMix.units
          .some((entry) => rawValueOf(entry.unit) === raw))),
      deltas: Object.freeze([
        figureDelta("spendMix", attribution.spendMix.coverage.attributedSpend,
          spendMix.coverage.attributedSpend, rekeyed),
        figureDelta("modelOverspend", modelOverspend?.coverage.attributedSpend ?? 0,
          modelOverspend?.coverage.attributedSpend ?? 0, rekeyed),
        figureDelta("rankedRecoverable", rankedRecoverable?.recoverableUsd ?? 0,
          rankedRecoverable?.recoverableUsd ?? 0, rekeyed),
      ]),
    }),
  });
}
