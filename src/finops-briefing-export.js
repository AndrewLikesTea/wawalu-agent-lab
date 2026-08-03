// The briefing file a finished analysis is downloaded as.
//
// WHAT THIS REPLACES
// ------------------
// The download used to be `JSON.stringify(wholeEnvelope)`: a raw dump whose
// contents were whatever the analysis happened to hold that day, whose bytes
// changed between two clicks on the same result (the envelope carries a
// `generatedAt`, and the wrapper stamped a fresh `exportedAt`), and which
// shipped the quarantine rows — actual provider records — inside `quality`.
//
// This module writes a *selected* file instead. Three properties are the point:
//
//   1. SELF-CONTAINED. Every headline figure travels with the operands it was
//      computed from, so a reader can re-derive the number instead of trusting
//      it. A formula string is not an operand and never stands in for one.
//   2. DETERMINISTIC. Same analysis in, same bytes out — across two clicks and
//      across two page loads. Nothing here reads a clock, a URL, storage, or a
//      random source, and `serializeBriefing` sorts every key.
//   3. ALLOWLISTED. `results` is projected field by field. A field this module
//      does not name cannot reach the file, so a new key on the envelope is
//      absent by default rather than leaked by default. That is the opposite of
//      the blocklist the raw dump implied, and it is why the quarantine rows,
//      the query sample, and the per-model detail are simply not here.
//
// PURITY IS A SIGNATURE CONSTRAINT, NOT A CONVENTION
// --------------------------------------------------
// `buildBriefing(analysis, { dataset, exportedAt })` reads nothing ambient. The
// one value a briefing file needs that is not in the analysis — when it was
// written — is an argument. The caller holds the clock; this module does not.
// Omit it and the file is still valid, but the #392 reader will refuse to
// reopen it, because a briefing that cannot say when it was written cannot be
// shown as a past briefing.
//
// THE FILE SHAPE IS THE READER'S
// ------------------------------
// `finops-briefing-restore.js` (#392) already reads
// `{ exportedAt, dataset, briefingContractVersion, datasetNotice?, results }`
// and rebuilds the above-the-fold slots by calling `buildFinopsBriefing` on
// `results`. This file keeps all five keys and adds `briefing`, `figures`, and
// `scenario` alongside them. The projection below is therefore not free: it has
// to carry every field `buildFinopsBriefing` and `leadingFinding` read, or a
// reopened briefing would say something different from the one that was saved.
// `tests/finops-briefing-export.test.js` asserts exactly that equality.

import {
  buildFinopsBriefing,
  CONTRACT_VERSION,
  COVERAGE_THRESHOLDS,
  FORBIDDEN_FIELD_PATTERN,
  FORBIDDEN_VALUE_PATTERNS,
  MAX_STRING_LENGTH,
  validateBriefing,
} from "./finops-briefing-contract.js";
import {
  DOWN_ROUTING_ASSUMPTIONS,
  DOWN_ROUTING_CONSTANTS,
  DOWN_ROUTING_RULE_VERSION,
} from "./down-routing-candidates.js";
import { deriveBriefingCommitment } from "./finops-briefing-commitment.js";
// The same record shape the answer block on /evolution.html publishes beside its
// headline metric. One shape, so a reader who learned to read provenance on the
// screen reads it in the file without learning a second vocabulary.
import { AGGREGATION, figureProvenance } from "./finops-figure-provenance.js";

/**
 * The file's own version, separate from the briefing contract's. The contract
 * governs the three above-the-fold slots; this governs the envelope around them
 * — `figures`, `scenario`, and the shape of the `results` projection. Bump it
 * when one of those changes meaning, and leave `CONTRACT_VERSION` to Noor.
 */
export const BRIEFING_FILE_VERSION = "finops-briefing-file/1.1.0";

/**
 * THE ONE FIELD A READER IS BRANCHED ON.
 *
 * `briefingFileVersion` above is prose for a human reading the file; this is an
 * integer a reader compares. `finops-briefing-restore.js` selects its branch on
 * this and on nothing else — never on whether `unitNaming` happens to be
 * present, because "the key is missing" and "the key is missing because that
 * build did not write it" are the same observation and only one of them is a
 * fact about the file's schema.
 *
 * 0 IS A REAL VERSION, not an error: every briefing written before this field
 * existed is version 0, and the reader is required to open one.
 */
export const BRIEFING_EXPORT_SCHEMA_VERSION = 1;
export const LEGACY_EXPORT_SCHEMA_VERSION = 0;

/**
 * The ceiling a derived or reader-typed unit name is written under.
 *
 * The same 60 `finops-export-unit-names.js` derives under and
 * `org-unit-display-label.js` renders under, restated here rather than imported
 * so that writing a file pulls in no part of the derivation graph. A name longer
 * than this is not truncated — truncating a team name invents a different team —
 * it is dropped, and the unit is written as carrying no name.
 */
export const MAX_EXPORTED_UNIT_NAME = 60;

/** No more units than a reader ever names by hand, so the file stays bounded. */
export const MAX_EXPORTED_UNITS = 200;

export const BRIEFING_FILE_NAME = Object.freeze({
  user: "local-finops-briefing.json",
  example: "example-finops-briefing.json",
});

export const BRIEFING_FILE_MEDIA_TYPE = "application/json";

/**
 * Carried verbatim from the writer this replaces, so an example-data briefing
 * says the same thing it always said, in the same words, in a file whose whole
 * point is that its figures are reproducible.
 */
export const EXAMPLE_DATASET_NOTICE =
  "EXAMPLE DATA — computed from a bundled synthetic provider export and org roster. "
  + "Not your data and not a report about any real organization.";

/**
 * WHEN A HEADLINE FIGURE MAY READ AS COMPLETE.
 *
 * A figure is `complete: true` only when *both* hold:
 *
 *   * the briefing contract graded coverage `high` — which is its own rule:
 *     analyzed/total records >= COVERAGE_THRESHOLDS.high (0.90) **and** no
 *     required input missing; and
 *   * the attributed share of analyzed spend is 1 — every dollar the figure was
 *     summed over sits in a department the rubric could score.
 *
 * Either one short and the figure is `complete: false` with a `qualifier` that
 * names both fractions. The second condition is the one that matters for this
 * file: record coverage can be 100% while a fifth of the spend sits in the
 * unattributed bucket, and a figure summed over four-fifths of the money that
 * presents itself as a total is a wrong number wearing a right one's clothes.
 *
 * The rule is deliberately stricter than the contract's `high` grade rather
 * than a second opinion about it: this module never re-grades coverage, it
 * reads `briefing.coverage.confidence` and adds the attribution condition.
 */
export const COMPLETE_REQUIRES_FULL_ATTRIBUTION = true;

/** Attribution shares are compared at cent-scale; float noise is not a gap. */
const ATTRIBUTION_EPSILON = 1e-9;

/**
 * Ratios are the only values this module rounds, and they round here, once, to
 * six places. Money is carried exactly as the analysis computed it — re-rounding
 * a total that was already rounded to cents is how a re-derived figure ends up a
 * cent away from the headline it was supposed to reproduce.
 */
function roundRatio(value) {
  return Number.isFinite(value) ? Math.round(value * 1e6) / 1e6 : 0;
}

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** A fixed one-decimal percent, so a qualifier's bytes are stable. */
function percentText(ratio) {
  return `${(roundRatio(ratio) * 100).toFixed(1)}%`;
}

// ---------------------------------------------------------------------------
// The `results` projection. Allowlist, field by field.
// ---------------------------------------------------------------------------

/**
 * One department, reduced to the aggregates a figure is re-derived from.
 *
 * `downRouting` keeps its rule version (the #392 reader reads the *file's* rule
 * version off this field, not off today's build) and its numeric operands, and
 * drops `decisionReason`, `unitLabel`, and the confidence object's reason prose.
 * A decision code is a fact about the rule; the sentence explaining it is a
 * rendering, and it is authored on the page from the same code.
 */
function projectDepartment(department, rank) {
  const routing = department?.downRouting ?? null;
  return {
    downRouting: routing
      ? {
        candidateSpendUsd: finite(routing.candidateSpendUsd),
        candidateTokens: finite(routing.candidateTokens),
        confidenceLevel: routing.confidence?.level ?? null,
        decisionCode: routing.decisionCode ?? null,
        flagged: Boolean(routing.flagged),
        observedMinorPerMillionTokens: finite(routing.observedMinorPerMillionTokens),
        recoverableUsd: finite(routing.recoverableUsd, 0),
        referenceMinorPerMillionTokens: finite(routing.referenceMinorPerMillionTokens),
        requests: finite(routing.requests),
        routableSpendUsd: finite(routing.routableSpendUsd),
        ruleVersion: routing.ruleVersion ?? null,
        tokensPerCall: finite(routing.tokensPerCall),
      }
      : null,
    id: department?.id ?? null,
    name: department?.name ?? null,
    previousSpendUsd: finite(department?.previousSpendUsd),
    // The rank the analysis published, carried as a field rather than implied by
    // array position, so the ordering survives a consumer that re-sorts.
    rank,
    records: finite(department?.records, 0),
    recoverableUsd: finite(department?.recoverableUsd, 0),
    spendChangePercent: finite(department?.spendChangePercent),
    spendChangeUsd: finite(department?.spendChangeUsd),
    spendUsd: finite(department?.spendUsd, 0),
    trendAvailable: Boolean(department?.trendAvailable),
  };
}

/**
 * Ranked departments in the analysis's own order, then sorted by that order
 * explicitly.
 *
 * The rank is assigned from the envelope's array position — that array *is* the
 * ranking, and re-ranking it here would fork the analysis. The sort is therefore
 * a no-op today, and that is the point: it makes the file's order a stated
 * property of the `rank` field rather than an inherited accident, with `id`
 * ascending as the tiebreak so two entries at one rank can never swap.
 */
function projectDepartments(result) {
  const ranked = Array.isArray(result?.rankedDepartments) ? result.rankedDepartments : [];
  return ranked
    .map((department, index) => projectDepartment(department, index + 1))
    .sort((left, right) => left.rank - right.rank
      || String(left.id).localeCompare(String(right.id)));
}

function projectHistory(result) {
  const history = result?.history;
  if (!history || typeof history !== "object") return null;
  const periods = Array.isArray(history.periods) ? history.periods : [];
  return {
    currentPeriod: history.currentPeriod ?? null,
    message: history.message ?? null,
    organizationSpendChangePercent: finite(history.organizationSpendChangePercent),
    organizationTrendAvailable: Boolean(history.organizationTrendAvailable),
    periodCount: finite(history.periodCount, periods.length),
    // Order is the analysis's chronological order and `leadingFinding` reads the
    // last two entries positionally, so this list is carried as given and never
    // re-sorted. Sorting it by period string would be the same order today and a
    // silent reinterpretation the day a period label changes shape.
    periods: periods.map((entry) => ({
      completeness: entry?.completeness ?? null,
      period: entry?.period ?? null,
      recoverableUsd: finite(entry?.recoverableUsd, 0),
      spendUsd: finite(entry?.spendUsd, 0),
    })),
    previousPeriod: history.previousPeriod ?? null,
    state: history.state ?? null,
  };
}

/**
 * The analysis, reduced to what the briefing states and what the #392 reader
 * needs to rebuild it. Everything else — the quarantine rows, the query sample,
 * the literacy grades, the per-model routing detail, the free-text provenance
 * and warnings — is absent because it is not named here.
 */
function projectResults(result, departments) {
  const quality = result?.quality ?? {};
  return {
    action: typeof result?.action === "string" ? result.action : "",
    confidence: result?.confidence ?? null,
    history: projectHistory(result),
    period: result?.period ?? null,
    quality: {
      hrisCompleteness: quality.hrisCompleteness ?? null,
      // Integers, because the reader type-checks them as integers and because a
      // fractional record count is not a thing.
      joinedRecords: Math.max(0, Math.trunc(finite(quality.joinedRecords, 0))),
      providerCompleteness: quality.providerCompleteness ?? null,
      quarantinedRecords: Math.max(0, Math.trunc(finite(quality.quarantinedRecords, 0))),
    },
    rankedDepartments: departments,
    recoverableUsd: finite(result?.recoverableUsd, 0),
    schemaVersion: result?.schemaVersion ?? null,
    spendUsd: finite(result?.spendUsd, 0),
    topDepartment: departments.length ? departments[0] : null,
  };
}

// ---------------------------------------------------------------------------
// Derived unit names, their provenance, and the corrections a reader made.
// ---------------------------------------------------------------------------
//
// WHY THIS IS IN THE FILE AT ALL. Until now a briefing file carried the figures
// and left the words behind: reopen one and every unit came back as
// `Department …atlas0`, because the readable name was derived from a column in a
// CSV the file does not contain. A brief that cannot say what its own units are
// called is not self-sufficient, and a reader who corrected one of those names
// lost the correction and the fact that there had been something to correct.
//
// WHAT CHANGED ABOUT WHERE NAMES GO — STATED, BECAUSE IT IS A REVERSAL.
// `finops-export-unit-names.js` and `org-unit-display-label.js` both say a name
// is never put in an export. That was a rule about EGRESS: no request, no URL,
// no digest, no third party, and none of that changes here. This block is
// written into the file the reader themselves clicked download on, in their own
// browser, out of labels their own file already carried — the same act as saving
// the CSV. Nothing on this path opens a connection.
//
// WHAT IS NOT WRITTEN. A name longer than the display ceiling, a name carrying
// something the briefing contract forbids anywhere in a payload (an address, a
// token, an address-shaped project label), or a column header of the same. Those
// units are written with `withheld: true` and no name, so the file states that
// it declined rather than looking as though the export had no name for the unit.
// The alternative — refusing to write the whole briefing over one odd project
// label — would cost a finance lead their brief for a cell they did not choose.

/** A string this file may carry, or "" — never a truncation of one. */
function safeText(value, maxLength) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || trimmed.length > Math.min(maxLength, MAX_STRING_LENGTH)) return "";
  // A control character in a billing cell is a broken export, not a team name.
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return "";
  if (FORBIDDEN_VALUE_PATTERNS.some(({ pattern }) => pattern.test(trimmed))) return "";
  return trimmed;
}

/** The empty naming block. A file always carries one, so a reader never guesses. */
export const NO_EXPORTED_UNIT_NAMING = Object.freeze({
  available: false,
  contractVersion: null,
  conflictedCount: 0,
  correctedCount: 0,
  derivedCount: 0,
  precedenceStatement: "",
  statement: "",
  unitCount: 0,
  units: Object.freeze([]),
  withheldCount: 0,
});

/**
 * One unit's name, where the name came from, and what the reader did about it.
 *
 * A correction is recorded as a correction — the derived name it replaced stays
 * beside it — so a reopened brief can say "derived from the project column, then
 * corrected by a reader" instead of collapsing to a name with no history, which
 * is the one shape that would let a typed name pass for something the export
 * supplied.
 */
function projectNamedUnit(unit, correction) {
  const derivedName = unit.derived ? safeText(unit.name, MAX_EXPORTED_UNIT_NAME) : "";
  const column = safeText(unit.sourceColumn, MAX_EXPORTED_UNIT_NAME);
  return {
    conflicted: Boolean(unit.conflicted),
    correction: correction
      ? { name: correction, replacedDerivedName: derivedName || null }
      : null,
    derived: Boolean(unit.derived),
    derivedName: derivedName || null,
    sourceColumn: column || null,
    sourceField: safeText(unit.sourceField, MAX_EXPORTED_UNIT_NAME) || null,
    sourceFieldLabel: safeText(unit.sourceFieldLabel, MAX_EXPORTED_UNIT_NAME) || null,
    unitId: unit.unitId,
    // True when this file declined to carry a name the page had. Distinct from
    // `derived: false`, which is the export never having named the unit at all.
    withheld: Boolean(unit.derived) && !derivedName,
  };
}

/**
 * The naming block, from the in-memory shapes the rendered brief already reads.
 *
 * @param naming a `deriveOrgUnitNames`/`mergeOrgUnitNamings` result, or null.
 * @param readerLabels the page's `{ [unitId]: label }` map of reader-typed names.
 *
 * A unit the reader named that the derivation never saw is carried too, as
 * `derived: false` with a correction on it: dropping it would lose a name the
 * reader typed, which is the thing this block exists to bring back.
 */
export function projectUnitNaming(naming, readerLabels) {
  const units = Array.isArray(naming?.units) ? naming.units : [];
  const labels = readerLabels && typeof readerLabels === "object" && !Array.isArray(readerLabels)
    ? readerLabels : {};
  const corrected = new Map();
  for (const [unitId, label] of Object.entries(labels)) {
    const id = safeText(unitId, 128);
    const name = safeText(label, MAX_EXPORTED_UNIT_NAME);
    if (id && name) corrected.set(id, name);
  }

  const projected = [];
  const seen = new Set();
  for (const unit of units) {
    const id = safeText(unit?.unitId, 128);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    projected.push(projectNamedUnit({ ...unit, unitId: id }, corrected.get(id) ?? null));
  }
  for (const [id, name] of corrected) {
    if (seen.has(id)) continue;
    seen.add(id);
    projected.push(projectNamedUnit({ unitId: id, derived: false }, name));
  }
  if (projected.length === 0) return NO_EXPORTED_UNIT_NAMING;

  // Sorted by identity, so two files built from the same analysis are the same
  // bytes whatever order the imports finished in.
  projected.sort((left, right) => left.unitId.localeCompare(right.unitId));
  const kept = projected.slice(0, MAX_EXPORTED_UNITS);
  return {
    available: true,
    // The derivation's own version, carried rather than restated: a file written
    // under contract 1 says 1 even when this build has moved on.
    contractVersion: Number.isInteger(naming?.contractVersion) ? naming.contractVersion : null,
    conflictedCount: kept.filter((unit) => unit.conflicted).length,
    correctedCount: kept.filter((unit) => unit.correction).length,
    derivedCount: kept.filter((unit) => unit.derivedName).length,
    precedenceStatement: safeText(naming?.precedenceStatement, MAX_STRING_LENGTH),
    statement: safeText(naming?.statement, MAX_STRING_LENGTH),
    unitCount: kept.length,
    units: kept,
    withheldCount: kept.filter((unit) => unit.withheld).length,
  };
}

// ---------------------------------------------------------------------------
// The figures, each with its operands.
// ---------------------------------------------------------------------------

/**
 * The scenario's numeric parameters, as named fields, beside the assumption
 * text that says what each one asserts and that it has no source.
 *
 * The parameters and the assumptions both come from `down-routing-candidates.js`
 * — a briefing that restated either would be a second rate card. The pairing is
 * declared here by index rather than inferred, so reordering the assumption list
 * upstream fails a test instead of silently re-labelling a threshold.
 */
const SCENARIO_PARAMETERS = Object.freeze([
  Object.freeze({
    assumptionIndex: 0,
    name: "premium_tier_floor_minor_per_million_tokens",
    unit: "currency_minor_per_million_tokens",
    value: DOWN_ROUTING_CONSTANTS.PREMIUM_TIER_MIN_MINOR_PER_MILLION_TOKENS,
  }),
  Object.freeze({
    assumptionIndex: 1,
    name: "standard_tier_reference_minor_per_million_tokens",
    unit: "currency_minor_per_million_tokens",
    value: DOWN_ROUTING_CONSTANTS.STANDARD_TIER_REFERENCE_MINOR_PER_MILLION_TOKENS,
  }),
  Object.freeze({
    assumptionIndex: 2,
    name: "short_call_max_tokens_per_call",
    unit: "tokens_per_call",
    value: DOWN_ROUTING_CONSTANTS.SHORT_CALL_MAX_TOKENS_PER_CALL,
  }),
  Object.freeze({
    assumptionIndex: 3,
    name: "min_candidate_requests",
    unit: "requests",
    value: DOWN_ROUTING_CONSTANTS.MIN_CANDIDATE_REQUESTS,
  }),
]);

function scenarioBlock() {
  return {
    parameters: SCENARIO_PARAMETERS.map((parameter) => ({
      assumption: DOWN_ROUTING_ASSUMPTIONS[parameter.assumptionIndex] ?? null,
      name: parameter.name,
      unit: parameter.unit,
      value: parameter.value,
    })),
    // The substitution and scope assumptions, which qualify the figure without
    // carrying a threshold of their own.
    qualifications: DOWN_ROUTING_ASSUMPTIONS.slice(SCENARIO_PARAMETERS.length),
    ruleVersion: DOWN_ROUTING_RULE_VERSION,
  };
}

/**
 * Attributed spend versus total, as amounts and as counts.
 *
 * Both denominators are carried because they answer different questions and can
 * disagree: `attributedSpendUsd / (attributed + unattributed)` is how much of
 * the *money* the rubric could score, and `analyzedRecords / totalRecords` is
 * how much of the *record set* was analyzed at all.
 */
function attributedShareFigure(result, coverage) {
  const rankedRecoverable = result?.attribution?.rankedRecoverable ?? null;
  const attributed = finite(rankedRecoverable?.coverage?.attributedSpend, 0);
  const unattributed = finite(rankedRecoverable?.coverage?.unattributedSpend, 0);
  const total = attributed + unattributed;
  return {
    inputs: {
      analyzedRecords: coverage.recordsAnalyzed,
      attributedSpendUsd: attributed,
      attributionFloor: finite(rankedRecoverable?.threshold?.reason?.floor),
      attributionVersion: result?.attribution?.version ?? null,
      excludedRecords: Math.max(0, coverage.recordsTotal - coverage.recordsAnalyzed),
      totalRecords: coverage.recordsTotal,
      totalSpendUsd: total,
      unattributedRecoverableUsd: finite(rankedRecoverable?.unattributedRecoverableUsd, 0),
      unattributedSpendUsd: unattributed,
    },
    unit: "ratio",
    // attributedSpendUsd ÷ (attributedSpendUsd + unattributedSpendUsd), with a
    // non-positive denominator defined as 0 — the same zero-denominator rule the
    // briefing contract applies to record coverage.
    value: total > 0 ? roundRatio(attributed / total) : 0,
  };
}

/**
 * Recoverable spend, with the per-department amounts it is the sum of.
 *
 * `value` is the analysis's own total, not a re-summation: this file reports the
 * figure the page showed. The operands are beside it so a reader can add them up
 * and see that they agree.
 */
function recoverableSpendFigure(result, departments) {
  const analyzedSpendUsd = finite(result?.spendUsd, 0);
  const recoverableUsd = finite(result?.recoverableUsd, 0);
  return {
    inputs: {
      analyzedSpendUsd,
      perDepartmentRecoverableUsd: departments.map((department) => ({
        id: department.id,
        rank: department.rank,
        recoverableUsd: department.recoverableUsd,
        spendUsd: department.spendUsd,
      })),
      rankedDepartmentCount: departments.length,
      // recoverableScenarioUsd ÷ analyzedSpendUsd. Carried as a field because the
      // page states it as a percentage and a reader should not have to guess
      // which of the two spend totals it was taken against.
      recoverableShareOfAnalyzedSpend: analyzedSpendUsd > 0
        ? roundRatio(recoverableUsd / analyzedSpendUsd) : 0,
    },
    unit: "USD",
    value: recoverableUsd,
  };
}

/**
 * The completeness marker every figure carries. See
 * COMPLETE_REQUIRES_FULL_ATTRIBUTION above for the rule.
 */
function completenessOf(coverage, attributedShare) {
  const fullyAttributed = attributedShare >= 1 - ATTRIBUTION_EPSILON;
  const complete = coverage.confidence === "high" && fullyAttributed;
  return {
    attributedShare,
    complete,
    confidence: coverage.confidence,
    coverageRatio: coverage.coverageRatio,
    coverageThresholdForComplete: COVERAGE_THRESHOLDS.high,
    qualifier: complete
      ? null
      : `Partial: this figure was computed over ${percentText(coverage.coverageRatio)} of the analyzed `
        + `records and ${percentText(attributedShare)} of the analyzed spend. It is not a complete total.`,
  };
}

// ---------------------------------------------------------------------------
// Forbidden content, checked over the whole file rather than the briefing alone.
// ---------------------------------------------------------------------------

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * The contract's own rules — its field pattern, its value patterns, its length
 * ceiling — applied to the entire payload. `validateBriefing` walks the briefing
 * object; a briefing *file* also carries `results`, `figures`, and `scenario`,
 * and those are exactly where a leak would arrive.
 *
 * Total: it returns violations and never throws, so a caller can report them.
 */
export function scanBriefingPayload(payload) {
  const violations = [];
  const stack = [{ value: payload, path: "" }];
  while (stack.length) {
    const { value, path } = stack.pop();
    if (Array.isArray(value)) {
      value.forEach((item, index) => stack.push({ value: item, path: `${path}[${index}]` }));
      continue;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        const here = path ? `${path}.${key}` : key;
        if (FORBIDDEN_FIELD_PATTERN.test(normalizeKey(key))) {
          violations.push({ path: here, code: "forbidden_field", detail: key });
        }
        stack.push({ value: child, path: here });
      }
      continue;
    }
    if (typeof value !== "string") continue;
    if (value.length > MAX_STRING_LENGTH) {
      violations.push({ path, code: "free_form_text", detail: `${value.length} characters` });
    }
    for (const { code, pattern } of FORBIDDEN_VALUE_PATTERNS) {
      if (pattern.test(value)) violations.push({ path, code, detail: code });
    }
  }
  return Object.freeze({ valid: violations.length === 0, violations: Object.freeze(violations) });
}

/** Thrown rather than written. A file that would carry a leak is not written. */
export class BriefingContentError extends Error {
  constructor(violations) {
    super(`Briefing withheld: ${violations.length} forbidden-content violation(s).`);
    this.name = "BriefingContentError";
    this.violations = violations;
  }
}

/** Contract validity and forbidden content in one answer, for callers and tests. */
export function validateBriefingPayload(payload) {
  const contract = validateBriefing(payload?.briefing);
  const content = scanBriefingPayload(payload);
  const violations = [
    ...contract.violations.map((violation) => ({ ...violation, path: `briefing.${violation.path}` })),
    ...content.violations,
  ];
  return Object.freeze({ valid: violations.length === 0, violations: Object.freeze(violations) });
}

// ---------------------------------------------------------------------------
// The generator.
// ---------------------------------------------------------------------------

/**
 * Build the briefing payload for a finished analysis.
 *
 * Pure: no DOM, no fetch, no storage, no clock, no randomness. Two calls on the
 * same envelope return equal payloads, in this process and in the next one.
 *
 * @param analysis an envelope from `normalizeLocalFinops` or
 *   `normalizeLocalFinopsHistory`, or null when nothing has been analyzed.
 * @param options.dataset "user" or "example"; anything else reads as "user",
 *   because a file that cannot prove it is example data must not claim to be.
 * @param options.exportedAt an ISO-8601 timestamp *supplied by the caller*. This
 *   module has no clock. Omit it and the key is absent from the payload — the
 *   file stays valid and deterministic, and the #392 reader will decline to
 *   reopen it for want of a written date.
 * @param options.attributionWithheld passed through to the contract, which
 *   honours the page's decision to suppress the money figure rather than
 *   re-deriving it.
 * @param options.unitNaming the naming the page is rendering — a
 *   `deriveOrgUnitNames`/`mergeOrgUnitNamings` result — or null when the units
 *   were never named from a dropped export. Serialized as it stands rather than
 *   re-derived: this module has no rows to derive from and must not appear to.
 * @param options.readerLabels the page's `{ [unitId]: label }` map of names the
 *   reader typed over the derived ones.
 * @throws {BriefingContentError} when the payload would carry forbidden content.
 *   Refusing to write beats writing a leak, and a silent redaction would leave a
 *   file that looks whole.
 */
export function buildBriefing(analysis, {
  dataset, exportedAt, attributionWithheld = false, unitNaming = null, readerLabels = null,
} = {}) {
  const result = analysis && typeof analysis === "object" ? analysis : null;
  const briefing = buildFinopsBriefing(result, { attributionWithheld });
  const departments = projectDepartments(result);
  const attributedShare = attributedShareFigure(result, briefing.coverage);
  const completeness = completenessOf(briefing.coverage, attributedShare.value);
  const recoverableSpend = recoverableSpendFigure(result, departments);

  const payload = {
    // The contract's three slots, selected by the contract and copied here
    // whole. This module never re-decides one of them.
    briefing,
    briefingContractVersion: CONTRACT_VERSION,
    briefingFileVersion: BRIEFING_FILE_VERSION,
    dataset: dataset === "example" ? "example" : "user",
    ...(dataset === "example" ? { datasetNotice: EXAMPLE_DATASET_NOTICE } : {}),
    // The integer a reader branches on. Written unconditionally, including for a
    // briefing whose naming block turns out empty: "this file was written by a
    // build that records name provenance" is a fact about the schema, and a
    // reader that had to infer it from an empty block would infer it wrongly.
    exportSchemaVersion: BRIEFING_EXPORT_SCHEMA_VERSION,
    ...(typeof exportedAt === "string" && exportedAt ? { exportedAt } : {}),
    // Each figure with its operands, its completeness marker, and — keyed under
    // the figure it explains rather than in a list a reader would have to
    // position-match — the record that says where it came from. `inputs` is
    // derived from the figure's OWN operand object, so an operand added above
    // appears in the record with no edit here. `computedAt` is the caller's
    // `exportedAt`: this module still has no clock, and a file written without
    // one reports no computation time rather than inventing it.
    figures: {
      attributedShare: {
        ...attributedShare,
        completeness,
        provenance: figureProvenance({
          figure: "attributedShare",
          label: "Attributed share of analyzed spend",
          inputs: attributedShare.inputs,
          sampleCount: briefing.coverage.recordsAnalyzed,
          sampleUnit: "analyzed record",
          aggregation: AGGREGATION.ratioOfSums,
          rule: result?.attribution?.version ?? null,
          computedAt: exportedAt ?? null,
        }),
      },
      recoverableSpend: {
        ...recoverableSpend,
        completeness,
        provenance: figureProvenance({
          figure: "recoverableSpend",
          label: "Recoverable spend under the routing scenario",
          inputs: recoverableSpend.inputs,
          sampleCount: departments.length,
          sampleUnit: "ranked department",
          aggregation: AGGREGATION.publishedTotal,
          rule: DOWN_ROUTING_RULE_VERSION,
          computedAt: exportedAt ?? null,
        }),
      },
    },
    // No new provenance key: the contract already carries the client-side
    // statement at `briefing.provenance`, and a second copy under a second name
    // is the fork this whole seam exists to prevent.
    results: projectResults(result, departments),
    // The one commitment this analysis supports, or a stated reason it supports
    // none. It sits beside `results` rather than inside it because it is not a
    // projection of the analysis: it is Noor's savings-commitment contract
    // applied to the analysis, and it carries its own contract version. The
    // `results` projection deliberately does not carry the per-model routing
    // detail this is derived from, so a reader that reopens the file reads the
    // commitment rather than rebuilding it — which is what makes it portable.
    savingsCommitment: deriveBriefingCommitment(result, { dataset, attributionWithheld }),
    scenario: scenarioBlock(),
    // What this analysis's units are called, where each name was inferred from,
    // and which of them a reader corrected. Beside `results` rather than inside
    // it for the reason the commitment is: the projection is of the analysis
    // envelope, and a derived name is not in that envelope — it comes off the
    // dropped file's own label columns, which the envelope never carried.
    //
    // The derived-input confidence is deliberately NOT copied here. It already
    // travels twice: as `briefing.coverage.provenance` — the contract's own
    // object, with the counts, the score, the floor and the ceiling the
    // confidence sentence is composed from — and implicitly in `results`, which
    // carries every field that classification is made against, so a reader that
    // rebuilds the briefing gets the same grade rather than a stored one.
    unitNaming: projectUnitNaming(unitNaming, readerLabels),
  };

  const content = scanBriefingPayload(payload);
  if (!content.valid) throw new BriefingContentError(content.violations);
  return payload;
}

/**
 * Serialize a payload to bytes that depend only on its values.
 *
 * The replacer rebuilds every object with its keys in sorted order, so two
 * payloads that differ only in insertion order serialize identically. Arrays
 * keep their order — the collections in this file are ordered by `projectDepartments`
 * and by the analysis's own chronology, both of which are stated properties, not
 * incidental ones.
 */
export function serializeBriefing(payload) {
  return `${JSON.stringify(payload, (key, value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    const sorted = {};
    for (const name of Object.keys(value).sort()) sorted[name] = value[name];
    return sorted;
  }, 2)}\n`;
}

/**
 * The one call the export button makes: envelope in, `{ fileName, mediaType,
 * text }` out. The component holds the clock and the download mechanism; every
 * figure decision is above this line.
 */
export function briefingFile(analysis, options = {}) {
  const payload = buildBriefing(analysis, options);
  return Object.freeze({
    fileName: BRIEFING_FILE_NAME[payload.dataset],
    mediaType: BRIEFING_FILE_MEDIA_TYPE,
    text: serializeBriefing(payload),
  });
}
