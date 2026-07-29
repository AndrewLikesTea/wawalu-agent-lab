// The canonical AI FinOps decision: one question, seven fields, one summary.
//
// THE PROBLEM THIS SOLVES. The AI FinOps front door had grown several regions
// that each read like "the" answer — a first-run brief, a guided result, a
// headline grade card, a restored briefing — and no single place said what a
// complete decision *is*. So "recoverable share", "impact", and "confidence"
// were each computed by whichever region needed them, and nothing in the
// codebase stated the question all of them exist to answer.
//
// This module states it once:
//
//     Are we wasting money?
//
// A surface may answer that question completely, or it may support the answer
// with evidence. It may not do both, and exactly one region on the page may do
// the former. That is `SUMMARY_ROLE` and `countCompleteSummaries` below.
//
// ---------------------------------------------------------------------------
// THE SEVEN FIELDS, AND WHY EACH ONE IS REQUIRED
// ---------------------------------------------------------------------------
//
// A decision record is incomplete — and therefore invalid — without all seven.
// Each exists because a leader cannot act without it:
//
//   question          What is being decided. Fixed; see `DECISION_QUESTION`.
//   benchmark         The material comparison baseline and the window it was
//                     measured over. Without a baseline a figure is a number,
//                     not a judgement.
//   prioritizedAction The single highest-ranked intervention, and the role
//                     accountable for it. Rank 1 only; a list is not a decision.
//   impact            Estimated cost reduction, with currency, period, and the
//                     calculation basis. "Estimated" is structural: `realized`
//                     is always false here, because nothing on this page has
//                     been invoiced.
//   confidence        A bounded score in [0,1] *and* the stated basis for it. A
//                     score without a basis is a vibe with a decimal point.
//   provenance        Which synthetic local source produced this and when. The
//                     front door ships invented data; a reader must be able to
//                     tell that from the record itself, not from surrounding
//                     copy.
//   evidence          Progressive-disclosure support, explicitly distinct from
//                     the summary. Evidence that restates the summary is a
//                     second summary wearing a disclosure triangle.
//
// ---------------------------------------------------------------------------
// EXACT METRIC SEMANTICS
// ---------------------------------------------------------------------------
//
// Stated so that two engineers compute the same number. `docs/finops-decision-
// contract.md` carries the same rules in prose; this file is the one that runs.
//
// * MEASUREMENT WINDOW. A half-open interval [start, end): `start` inclusive,
//   `end` exclusive, both RFC-3339 instants in UTC. Every figure in one record
//   covers the same window. A record whose benchmark window and impact period
//   differ is invalid, because the two figures would not be comparable.
//
// * BENCHMARK COMPARISON (recoverable share). `observed ÷ baseline`, where
//   `baseline` is analyzed AI spend in USD over the window and `observed` is
//   the modelled recoverable spend in USD over the same window. Unrounded
//   quotient, stored rounded half-up to 4 decimal places, displayed rounded
//   half-up to whole percent. Unavailable — null, never 0 — when the baseline
//   is not a finite positive number.
//
// * IMPACT. `estimatedCostReductionUsd` is the sum of the per-department
//   routing scenarios over the ranked departments, in whole USD, over the
//   window. It is a ceiling on what re-routing could recover under the stated
//   rule version, not a realized, invoiced, or promised saving.
//
// * CONFIDENCE SCORE. Bounded [0, 1], rounded half-up to 2 decimal places:
//
//       score = clamp(coverageRatio
//                     − 0.15 × (required aggregate inputs missing)
//                     − 0.15 × (distinct lowered-confidence reasons on the
//                               rank-1 action's routing candidate), 0, 1)
//
//   `coverageRatio` is `recordsAnalyzed ÷ recordsTotal` from the briefing
//   contract. The two penalties are deliberately equal and deliberately blunt:
//   a missing input and an unverifiable call shape both mean the same thing to
//   a leader — part of the basis for this number was not checked. The band is
//   read off the same thresholds the briefing contract publishes (high ≥ 0.90,
//   moderate ≥ 0.60, low > 0, insufficient = 0), so the two never disagree
//   about what "high" means. Note that decision confidence can sit a band below
//   briefing coverage confidence: coverage asks how many records were read,
//   this asks how much of the recommendation was verified.
//
// ---------------------------------------------------------------------------
// THE PRIVACY BOUNDARY
// ---------------------------------------------------------------------------
//
// A decision record is a demo artifact. It may hold invented aggregates and
// nothing else. `validateDecisionRecord` walks the whole record and rejects it
// if any key or string value looks like a credential, an address, a stored
// prompt, or a live integration endpoint. This is a validator, not a scrubber:
// a record that trips it fails, it is not quietly cleaned, because a cleaned
// record hides the code path that put the value there.

import { COVERAGE_THRESHOLDS, BRIEFING_CONFIDENCE } from "./finops-briefing-contract.js";
import CANONICAL_DECISION_FIXTURE from "./finops-decision-fixture.json" with { type: "json" };

/** Bump when a field, a metric rule, or a boundary rule changes meaning. */
export const DECISION_CONTRACT_VERSION = "finops-decision/1.0.0";

/**
 * The one question this product's front door answers.
 *
 * Authored here and nowhere else. A surface that wants to ask a different
 * question is a different surface and needs its own contract.
 */
export const DECISION_QUESTION = "Are we wasting money?";

/** The seven fields a complete decision record must carry. */
export const REQUIRED_FIELDS = Object.freeze([
  "question", "benchmark", "prioritizedAction", "impact",
  "confidence", "provenance", "evidence",
]);

/**
 * The two roles a region on the page may play.
 *
 * `complete` — answers the decision question on its own.
 * `evidence`  — supports an answer given elsewhere and must not restate it.
 *
 * Regions declare their role in markup with `data-decision-summary`, so the
 * single-summary rule is checkable against the shipped document rather than
 * against a description of it.
 */
export const SUMMARY_ROLE = Object.freeze({ complete: "complete", evidence: "evidence" });

/** The markup attribute that carries a region's role. */
export const SUMMARY_ATTRIBUTE = "data-decision-summary";

/** The region that carries the complete summary before anything is imported. */
export const FRONT_DOOR_SUMMARY_ID = "finops-first-run";

/** The only source a decision record on this page may claim. */
export const SYNTHETIC_SOURCE = "synthetic-local";

/** The only impact kind this contract models. */
export const IMPACT_KIND = "estimated_cost_reduction";

// ---------------------------------------------------------------------------
// The privacy boundary, as data.
// ---------------------------------------------------------------------------

/**
 * Key names a decision record may never carry, matched case-insensitively as
 * substrings so `providerApiKey` and `api_key` both trip.
 */
export const FORBIDDEN_KEY_PATTERNS = Object.freeze([
  "password", "passwd", "secret", "token", "apikey", "api_key", "credential",
  "authorization", "cookie", "session", "bearer", "privatekey", "private_key",
  "email", "customer", "prompt", "conversation", "messagetext", "transcript",
]);

/**
 * Value shapes a decision record may never carry. Each is a thing that could
 * only have arrived from outside the bundled synthetic dataset.
 */
export const FORBIDDEN_VALUE_PATTERNS = Object.freeze([
  Object.freeze({ code: "email_address", pattern: /[\w.+-]+@[\w-]+\.[\w.-]+/ }),
  Object.freeze({ code: "bearer_token", pattern: /\b(?:sk|pk|ghp|gho|xoxb)[-_][A-Za-z0-9]{8,}/ }),
  Object.freeze({ code: "remote_endpoint", pattern: /\bhttps?:\/\//i }),
  Object.freeze({ code: "authorization_header", pattern: /\bBearer\s+[A-Za-z0-9._-]{8,}/ }),
]);

// ---------------------------------------------------------------------------
// Small numeric helpers, each with one rounding rule.
// ---------------------------------------------------------------------------

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
const isNonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));

/** Half-up rounding to `places`, so 0.845 → 0.85 rather than 0.84. */
export function roundHalfUp(value, places) {
  if (!isFiniteNumber(value)) return null;
  const factor = 10 ** places;
  return Math.round((value * factor).toPrecision(15) * 1) / factor;
}

/**
 * The benchmark comparison: modelled recoverable spend as a share of analyzed
 * spend. Null — never 0 — when there is no positive baseline to divide by.
 */
export function recoverableShare(observedUsd, baselineUsd) {
  if (!isFiniteNumber(observedUsd) || observedUsd < 0) return null;
  if (!isFiniteNumber(baselineUsd) || baselineUsd <= 0) return null;
  return roundHalfUp(observedUsd / baselineUsd, 4);
}

/**
 * The bounded confidence score. See the metric semantics above; the two
 * penalties are named rather than inlined so a caller can report which one
 * moved the number.
 */
export function confidenceScore({ coverageRatio = 0, missingInputs = 0, unverifiedReasons = 0 } = {}) {
  const base = isFiniteNumber(coverageRatio) ? coverageRatio : 0;
  const raw = base - 0.15 * Math.max(0, missingInputs) - 0.15 * Math.max(0, unverifiedReasons);
  return roundHalfUp(Math.min(1, Math.max(0, raw)), 2);
}

/** The band for a score, on the thresholds the briefing contract publishes. */
export function confidenceBand(score) {
  if (!isFiniteNumber(score) || score <= 0) return BRIEFING_CONFIDENCE.insufficient;
  if (score >= COVERAGE_THRESHOLDS.high) return BRIEFING_CONFIDENCE.high;
  if (score >= COVERAGE_THRESHOLDS.moderate) return BRIEFING_CONFIDENCE.moderate;
  return BRIEFING_CONFIDENCE.low;
}

// ---------------------------------------------------------------------------
// Validation.
// ---------------------------------------------------------------------------

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** A half-open UTC window, both ends present, start strictly before end. */
function windowErrors(where, window) {
  const errors = [];
  if (!window || typeof window !== "object") return [`${where}: missing window`];
  if (!INSTANT.test(String(window.start ?? ""))) errors.push(`${where}.start: not a UTC instant`);
  if (!INSTANT.test(String(window.end ?? ""))) errors.push(`${where}.end: not a UTC instant`);
  if (window.endExclusive !== true) errors.push(`${where}.endExclusive: must be true`);
  if (!errors.length && !(String(window.start) < String(window.end))) {
    errors.push(`${where}: start must precede end`);
  }
  return errors;
}

const sameWindow = (a, b) => Boolean(a && b && a.start === b.start && a.end === b.end);

/**
 * Walk every key and string value in the record against the boundary rules.
 * Returns the violations rather than throwing, so a test can report all of them
 * at once instead of one per run.
 */
export function privacyViolations(value, path = "record", seen = new Set()) {
  const out = [];
  if (value === null || value === undefined) return out;
  if (typeof value === "string") {
    for (const { code, pattern } of FORBIDDEN_VALUE_PATTERNS) {
      if (pattern.test(value)) out.push(`${path}: ${code}`);
    }
    return out;
  }
  if (typeof value !== "object") return out;
  if (seen.has(value)) return out;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => out.push(...privacyViolations(item, `${path}[${index}]`, seen)));
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    const lowered = key.toLowerCase();
    const forbidden = FORBIDDEN_KEY_PATTERNS.find((needle) => lowered.includes(needle));
    if (forbidden) out.push(`${path}.${key}: forbidden key "${forbidden}"`);
    out.push(...privacyViolations(child, `${path}.${key}`, seen));
  }
  return out;
}

/**
 * Validate a decision record against every rule in this file.
 *
 * @returns `{ valid, errors }`. Never throws: a malformed input is a list of
 *   errors, because the caller is usually a page that must still render its
 *   labelled unavailable state.
 */
export function validateDecisionRecord(record) {
  const errors = [];
  const fail = (message) => errors.push(message);

  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return Object.freeze({ valid: false, errors: Object.freeze(["record: not an object"]) });
  }

  if (record.contractVersion !== DECISION_CONTRACT_VERSION) {
    fail(`contractVersion: expected ${DECISION_CONTRACT_VERSION}`);
  }
  for (const field of REQUIRED_FIELDS) {
    if (record[field] === undefined || record[field] === null) fail(`${field}: missing`);
  }

  if (record.question !== DECISION_QUESTION) fail("question: not the canonical decision question");

  // benchmark — a baseline, an observation, the comparison between them, and
  // the window all three were measured over.
  const benchmark = record.benchmark;
  if (record.benchmark !== undefined && record.benchmark !== null && !isRecord(benchmark)) {
    fail("benchmark: must be an object");
  } else if (isRecord(benchmark)) {
    if (!isNonEmptyString(benchmark.baselineName)) fail("benchmark.baselineName: missing");
    if (!isFiniteNumber(benchmark.baselineUsd) || benchmark.baselineUsd <= 0) {
      fail("benchmark.baselineUsd: must be a positive number");
    }
    if (!isFiniteNumber(benchmark.observedUsd) || benchmark.observedUsd < 0) {
      fail("benchmark.observedUsd: must be a non-negative number");
    }
    if (benchmark.currency !== "USD") fail("benchmark.currency: must be USD");
    if (!isNonEmptyString(benchmark.basis)) fail("benchmark.basis: missing");
    errors.push(...windowErrors("benchmark.window", benchmark.window));
    const expected = recoverableShare(benchmark.observedUsd, benchmark.baselineUsd);
    if (expected === null) {
      if (benchmark.comparisonShare !== null) fail("benchmark.comparisonShare: must be null when no baseline");
    } else if (benchmark.comparisonShare !== expected) {
      fail(`benchmark.comparisonShare: expected ${expected}`);
    }
  }

  // prioritizedAction — rank 1, one statement, one accountable role.
  const action = record.prioritizedAction;
  if (record.prioritizedAction !== undefined && record.prioritizedAction !== null && !isRecord(action)) {
    fail("prioritizedAction: must be an object");
  } else if (isRecord(action)) {
    if (action.rank !== 1) fail("prioritizedAction.rank: must be 1");
    if (!isNonEmptyString(action.statement)) fail("prioritizedAction.statement: missing");
    if (!isNonEmptyString(action.accountableRole)) fail("prioritizedAction.accountableRole: missing");
    if (!isNonEmptyString(action.basis)) fail("prioritizedAction.basis: missing");
  }

  // impact — estimated, never realized, with currency, period, and basis.
  const impact = record.impact;
  if (record.impact !== undefined && record.impact !== null && !isRecord(impact)) {
    fail("impact: must be an object");
  } else if (isRecord(impact)) {
    if (impact.kind !== IMPACT_KIND) fail(`impact.kind: must be ${IMPACT_KIND}`);
    if (!isFiniteNumber(impact.value) || impact.value < 0) fail("impact.value: must be a non-negative number");
    if (impact.currency !== "USD") fail("impact.currency: must be USD");
    if (impact.realized !== false) fail("impact.realized: must be false");
    if (!isNonEmptyString(impact.calculationBasis)) fail("impact.calculationBasis: missing");
    errors.push(...windowErrors("impact.period", impact.period));
    if (isRecord(benchmark) && !sameWindow(benchmark.window, impact.period)) {
      fail("impact.period: must be the same window as benchmark.window");
    }
  }

  // confidence — bounded score plus the stated basis for that score.
  const confidence = record.confidence;
  if (record.confidence !== undefined && record.confidence !== null && !isRecord(confidence)) {
    fail("confidence: must be an object");
  } else if (isRecord(confidence)) {
    const score = confidence.score;
    if (!isFiniteNumber(score) || score < 0 || score > 1) fail("confidence.score: must be within [0, 1]");
    if (confidence.scaleMin !== 0 || confidence.scaleMax !== 1) fail("confidence: scale must be 0 to 1");
    if (!isNonEmptyString(confidence.basis)) fail("confidence.basis: missing");
    if (isFiniteNumber(score) && confidence.band !== confidenceBand(score)) {
      fail(`confidence.band: expected ${confidenceBand(score)} for ${score}`);
    }
    if (!Array.isArray(confidence.limits)) fail("confidence.limits: must be an array");
  }

  // provenance — synthetic, local, and dated without reading a clock.
  const provenance = record.provenance;
  if (record.provenance !== undefined && record.provenance !== null && !isRecord(provenance)) {
    fail("provenance: must be an object");
  } else if (isRecord(provenance)) {
    if (provenance.source !== SYNTHETIC_SOURCE) fail(`provenance.source: must be ${SYNTHETIC_SOURCE}`);
    if (!isNonEmptyString(provenance.datasetId)) fail("provenance.datasetId: missing");
    if (!isNonEmptyString(provenance.generator)) fail("provenance.generator: missing");
    if (!INSTANT.test(String(provenance.generatedAt ?? ""))) fail("provenance.generatedAt: not a UTC instant");
    if (!isNonEmptyString(provenance.generatedAtBasis)) fail("provenance.generatedAtBasis: missing");
    if (!isNonEmptyString(provenance.executionContext)) fail("provenance.executionContext: missing");
  }

  // evidence — progressive disclosure, and distinct from the summary.
  const evidence = record.evidence;
  if (record.evidence !== undefined && record.evidence !== null && !isRecord(evidence)) {
    fail("evidence: must be an object");
  } else if (isRecord(evidence)) {
    if (evidence.disclosure !== "progressive") fail("evidence.disclosure: must be progressive");
    if (evidence.distinctFromSummary !== true) {
      fail("evidence.distinctFromSummary: must be true");
    }
    const entries = evidence.entries;
    if (!Array.isArray(entries) || entries.length === 0) {
      fail("evidence.entries: must hold at least one entry");
    } else {
      const summaryText = new Set([
        record.prioritizedAction?.statement,
        record.impact?.headline,
        record.benchmark?.headline,
      ].filter(isNonEmptyString).map((text) => text.trim()));
      entries.forEach((entry, index) => {
        if (!isNonEmptyString(entry?.term)) fail(`evidence.entries[${index}].term: missing`);
        if (!isNonEmptyString(entry?.detail)) fail(`evidence.entries[${index}].detail: missing`);
        if (summaryText.has(String(entry?.detail).trim())) {
          fail(`evidence.entries[${index}]: restates the summary`);
        }
      });
    }
  }

  errors.push(...privacyViolations(record));
  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

// ---------------------------------------------------------------------------
// The canonical fixture, and the derivation that keeps it honest.
// ---------------------------------------------------------------------------

/**
 * The canonical synthetic decision the front door presents.
 *
 * It is a static local fixture rather than a first-paint computation: the front
 * door must be able to state its answer before any analysis runs, and a demo
 * whose figures depend on when it was opened is not reproducible. It does not
 * get to drift, though — `deriveDecisionRecord` below rebuilds the same record
 * from the bundled dataset, and a test holds the two together.
 *
 * @returns `{ decision, valid, errors }`. `decision` is null when the fixture
 *   fails its own contract, so a caller renders an unavailable state rather
 *   than an unvalidated claim.
 */
export function loadCanonicalDecision(fixture = CANONICAL_DECISION_FIXTURE) {
  const validation = validateDecisionRecord(fixture);
  return Object.freeze({
    decision: validation.valid ? Object.freeze(fixture) : null,
    valid: validation.valid,
    errors: validation.errors,
  });
}

/** The distinct reasons the rank-1 routing candidate was down-graded, if any. */
function unverifiedReasonsOf(analysis) {
  const reasons = analysis?.topDepartment?.downRouting?.confidence?.reasons;
  if (!Array.isArray(reasons)) return [];
  const seen = new Set();
  return reasons.filter((reason) => {
    const code = reason?.code;
    if (!isNonEmptyString(code) || seen.has(code)) return false;
    seen.add(code);
    return true;
  });
}

/**
 * Rebuild the decision record from an analysis envelope and its briefing.
 *
 * This is the arithmetic the fixture was authored from. It exists so a contract
 * change under the bundled dataset fails a test instead of leaving a stale
 * number on the landing surface — the same rule `finops-first-run.js` follows.
 *
 * The non-derivable parts — the wording of a basis, the provenance labels, the
 * evidence terms — are taken from `framing`, which defaults to the fixture.
 * Those are editorial, not measured, and pretending to compute them would be
 * the drift this function exists to catch.
 */
export function deriveDecisionRecord(analysis, briefing, framing = CANONICAL_DECISION_FIXTURE) {
  const baselineUsd = Number(analysis?.spendUsd);
  const observedUsd = Number(analysis?.recoverableUsd);
  const period = briefing?.materialMetric?.period ?? null;
  const window = period
    ? { start: period.start, end: period.end, endExclusive: true }
    : null;
  const coverage = briefing?.coverage ?? {};
  const reasons = unverifiedReasonsOf(analysis);
  const score = confidenceScore({
    coverageRatio: Number(coverage.coverageRatio),
    missingInputs: Array.isArray(coverage.missingInputs) ? coverage.missingInputs.length : 0,
    unverifiedReasons: reasons.length,
  });

  return Object.freeze({
    contractVersion: DECISION_CONTRACT_VERSION,
    question: DECISION_QUESTION,
    benchmark: Object.freeze({
      baselineName: framing.benchmark.baselineName,
      baselineUsd,
      observedUsd,
      currency: "USD",
      comparisonShare: recoverableShare(observedUsd, baselineUsd),
      window,
      basis: framing.benchmark.basis,
      headline: framing.benchmark.headline,
    }),
    prioritizedAction: Object.freeze({
      rank: 1,
      statement: briefing?.rankedAction?.action ?? null,
      accountableRole: briefing?.rankedAction?.accountableRole ?? null,
      basis: framing.prioritizedAction.basis,
    }),
    impact: Object.freeze({
      kind: IMPACT_KIND,
      value: observedUsd,
      currency: "USD",
      period: window,
      realized: false,
      calculationBasis: framing.impact.calculationBasis,
      headline: framing.impact.headline,
    }),
    confidence: Object.freeze({
      score,
      scaleMin: 0,
      scaleMax: 1,
      band: confidenceBand(score),
      basis: framing.confidence.basis,
      limits: Object.freeze(reasons.map((reason) => Object.freeze({
        code: reason.code,
        detail: reason.detail,
      }))),
    }),
    provenance: framing.provenance,
    evidence: framing.evidence,
  });
}

// ---------------------------------------------------------------------------
// The single-summary rule, checkable against a document.
// ---------------------------------------------------------------------------

/** True when an element is hidden or has been explicitly superseded. */
function isRetired(element) {
  if (!element) return true;
  if (element.hidden === true || element.hasAttribute?.("hidden")) return true;
  if (element.dataset?.superseded === "true") return true;
  let parent = element.parentElement;
  while (parent) {
    if (parent.hidden === true || parent.hasAttribute?.("hidden")) return true;
    parent = parent.parentElement;
  }
  return false;
}

/**
 * Every region claiming to answer the decision question on its own, split into
 * the ones a reader can currently see and the ones the page has retired.
 *
 * The rule is about what is *presented*, not what is authored: the front door
 * ships its own complete summary and the reader's own result is also a complete
 * summary, but the page retires the first the moment the second appears. One
 * visible complete summary at a time; everything else is evidence.
 */
export function countCompleteSummaries(doc) {
  const selector = `[${SUMMARY_ATTRIBUTE}="${SUMMARY_ROLE.complete}"]`;
  const all = Array.from(doc?.querySelectorAll?.(selector) ?? []);
  const visible = all.filter((element) => !isRetired(element));
  return Object.freeze({
    total: all.length,
    visible: visible.length,
    visibleIds: Object.freeze(visible.map((element) => element.id)),
    ids: Object.freeze(all.map((element) => element.id)),
  });
}
