// Makes the canonical FinOps answer REPRODUCIBLE: one named finding in, four
// surfaced values out, and a validation status that says which of the three
// evidence classes the input fell into.
//
// #1463 shipped the contract that decides whether an annual figure may be
// stated at all. What it could not show is that the figure a leader reads, the
// benchmark under it, the confidence beside it and the action after it all came
// from the SAME finding. This layer supplies that: it selects exactly one
// finding, hands the contract a signal set built only from that finding's
// fields, and republishes the contract's own record together with the finding id
// it was derived from. Nothing here re-derives a number the contract already
// derived — `headline`, `benchmark` and `nextAction` below are reads of the
// contract record, so there is no second copy of a figure to drift.
//
// THREE RULES, WRITTEN DOWN BEFORE THEY WERE NEEDED:
//
//   1. INCOMPLETE beats everything. If any finding in the evidence set is
//      missing a field this answer is defined from, the set is incomplete — the
//      complete sibling is not silently promoted, and no figure is stated.
//   2. CONFLICTING resolves to the LOWER claim. Two findings disagreeing on the
//      same dimension is not a tie to be broken by array order: the lower annual
//      figure is the answer, the higher one is named as superseded, and
//      confidence loses the declared conflict deduction.
//   3. Free text never reaches the reader. An action label, a department and a
//      benchmark label are looked up from the allowlists below by id. Prose
//      carried on a finding — a statement, a narrative, a reason — is read by
//      nothing in this module.
//
// Every weight and every deduction carries the one-line assumption behind its
// value, because a confidence number an executive cannot interrogate is an
// unexplainable number, and those do not belong on this page.
//
// Pure: no DOM, no storage, no clock, no network. Fixtures live beside this in
// finops-evidence-fixtures.js and go through this same path.

import {
  ANSWER_STATUS, CONFIDENCE_THRESHOLD, resolveFinopsAnswer,
} from "./finops-answer-contract.js";

export const FINOPS_EVIDENCE_CONTRACT = "finops-evidence-answer/1.0.0";

/** The labelled classes a fixture declares and this module computes. A fixture
 *  whose declared class differs from the computed one is a disagreement between
 *  a human label and the code, and the fixture test names it. */
export const EVIDENCE_CLASS = Object.freeze({
  eligible: "ELIGIBLE", incomplete: "INCOMPLETE", conflicting: "CONFLICTING",
});

export const VALIDATION_STATUS = Object.freeze({
  complete: "complete", incomplete: "incomplete", conflicted: "conflicted",
});

/** Evaluation order. Published so two readers agree on the status an evidence
 *  set that trips more than one rule reports. */
export const VALIDATION_ORDER = Object.freeze([
  VALIDATION_STATUS.incomplete, VALIDATION_STATUS.conflicted, VALIDATION_STATUS.complete,
]);

export const CONFLICT_RULE = "Where two findings state different annual savings for the same"
  + " scenario, the LOWER figure is the answer, the higher finding is named as superseded, and"
  + " confidence loses the declared conflict deduction. No figure is picked by array order.";

// The weights are the analysis's own evidence categories, restated here with the
// assumption behind each value. Score = round half up the sum, over the
// categories the evidence carries, of weight × reliability. A test pins these
// ids, weights and reliabilities against EVIDENCE_CATEGORIES, so the table
// cannot drift away from the model it claims to explain.
export const CONFIDENCE_WEIGHTS = Object.freeze([
  Object.freeze({
    id: "usage_cost", weight: 35, reliability: 1,
    assumption: "Per-department spend is the only category that can locate the money at all, so"
      + " it carries the largest weight; without it there is nothing to be confident about.",
  }),
  Object.freeze({
    id: "workload_classification", weight: 30, reliability: 0.75,
    assumption: "Classification decides which spend is recoverable, so it is weighted just below"
      + " spend itself, and discounted to 0.75 because it is a sampled scoring, not a census.",
  }),
  Object.freeze({
    id: "applicable_pricing", weight: 20, reliability: 0.25,
    assumption: "Contracted pricing changes the size of a saving but not its existence, so it is"
      + " weighted lower, and heavily discounted because billed spend implies only a blended rate.",
  }),
  Object.freeze({
    id: "observed_validation", weight: 15, reliability: 1,
    assumption: "A post-change measurement is worth the least because a modelled figure is still"
      + " statable without it, but it is undiscounted because it is an observation, not a model.",
  }),
]);

export const CONFIDENCE_DEDUCTIONS = Object.freeze([
  Object.freeze({
    id: "incomplete-evidence", points: 100,
    assumption: "Evidence missing a field the answer is defined from cannot support ANY confidence"
      + " in a figure, so an incomplete set reports zero rather than what its remainder would earn.",
  }),
  Object.freeze({
    id: "conflicting-findings", points: 25,
    assumption: "A resolved conflict still means one of two findings was wrong about the same"
      + " scenario; a quarter of the scale drops a fully-evidenced set one band, which is the"
      + " smallest reduction a reader can actually see.",
  }),
]);

export const CONFIDENCE_RULE = "Round half up the sum, over the evidence categories the finding"
  + " carries, of weight × reliability; then subtract the declared deductions, floored at zero."
  + " Banded by the contract's published cut: high at 75, medium at 50, low below 50.";

// Allowlists. The reader only ever sees a string that is a VALUE in one of these
// tables, chosen by an id, so no prose travelling on a finding can be printed.
export const ACTION_LABEL = Object.freeze({
  "aws-bedrock-cur-v1-rank-1": "Pilot standard-model routing for routine requests.",
  "google-vertex-detailed-v1-rank-1": "Route low-complexity batch requests to the lower-cost model.",
  "azure-openai-cost-v1-rank-1": "Default one-step transformations to the mini deployment.",
  "syn-action-retire-idle-endpoints": "Retire the idle inference endpoints.",
  "syn-action-consolidate-duplicates": "Consolidate the duplicated summarization workload.",
});

export const BENCHMARK_LABEL = Object.freeze({
  "bundled-demo-materiality-floor": "Bundled demo materiality floor",
  "syn-peer-median-recoverable": "Synthetic peer median recoverable spend",
});

/** Departments a label may name. An unrecognised one is dropped rather than
 *  printed: an answer reads perfectly well without a department, and a
 *  department is exactly the field an injected string would arrive in. */
export const DEPARTMENT_ALLOWLIST = Object.freeze([
  "Platform Engineering", "Data Platform", "Developer Experience", "Model Operations",
]);

// Two annual figures are a conflict when they differ by more than a dollar or
// half a percent, whichever is wider — the same tolerance the contract uses, so
// a pair it would call conflicting is not called agreeing here.
const CONFLICT_ABSOLUTE_USD = 1;
const CONFLICT_RELATIVE = 0.005;

const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const filled = (value) => typeof value === "string" && value.trim().length > 0;
const positive = (value) => Number.isFinite(value) && value > 0;
const roundHalfUp = (value) => Math.floor(value + 0.5);
const list = (value) => (Array.isArray(value) ? value : []);

const band = (score) => (score >= CONFIDENCE_THRESHOLD.high ? "high"
  : score >= CONFIDENCE_THRESHOLD.medium ? "medium" : "low");

/**
 * A finding reduced to the fields this answer is defined from, plus the names of
 * whichever of them are missing. Nothing free-text survives: the three labels
 * are allowlist lookups and everything else is a number or an id.
 */
function readFinding(finding) {
  const missing = [];
  const id = isRecord(finding) && filled(finding.id) ? finding.id : null;
  if (!id) missing.push("id");
  const actionLabel = ACTION_LABEL[finding?.actionKey] ?? null;
  if (!actionLabel) missing.push("actionKey");
  const monthlySavingsUsd = positive(finding?.monthlySavingsUsd) ? finding.monthlySavingsUsd : null;
  if (monthlySavingsUsd === null) missing.push("monthlySavingsUsd");
  const baseline = positive(finding?.baseline?.monthlySpendUsd)
    && filled(finding?.baseline?.sourceId) ? finding.baseline : null;
  if (!baseline) missing.push("baseline");
  const benchmarkLabel = BENCHMARK_LABEL[finding?.benchmark?.key] ?? null;
  const benchmark = benchmarkLabel && Number.isFinite(finding?.benchmark?.value)
    && filled(finding?.benchmark?.unit) && filled(finding?.benchmark?.sourceId)
    ? Object.freeze({
      sourceId: finding.benchmark.sourceId, label: benchmarkLabel,
      value: finding.benchmark.value, unit: finding.benchmark.unit,
    }) : null;
  if (!benchmark) missing.push("benchmark");
  if (!filled(finding?.readinessLevel)) missing.push("readinessLevel");
  return {
    id, actionLabel, monthlySavingsUsd, baseline, benchmark,
    actionKey: finding?.actionKey ?? null,
    readinessLevel: finding?.readinessLevel ?? null,
    savingsSourceId: filled(finding?.savingsSourceId)
      ? finding.savingsSourceId : `${id}.monthlySavingsUsd`,
    department: DEPARTMENT_ALLOWLIST.includes(finding?.department) ? finding.department : null,
    evidence: isRecord(finding?.evidence) ? finding.evidence : {},
    missing: Object.freeze(missing),
  };
}

/** Score before deductions: weight × reliability over the categories held. */
export function confidenceScore(evidence) {
  return roundHalfUp(CONFIDENCE_WEIGHTS.reduce((sum, category) =>
    sum + (evidence?.[category.id] === true ? category.weight * category.reliability : 0), 0));
}

const deduction = (id) => CONFIDENCE_DEDUCTIONS.find((item) => item.id === id);

/** Annual figures, ascending, for the findings that carry one. */
const annualFigures = (findings) => findings
  .filter((finding) => finding.monthlySavingsUsd !== null)
  .map((finding) => finding.monthlySavingsUsd * 12);

function figuresConflict(figures) {
  if (figures.length < 2) return false;
  const low = Math.min(...figures);
  const high = Math.max(...figures);
  return high - low > Math.max(CONFLICT_ABSOLUTE_USD, Math.abs(high) * CONFLICT_RELATIVE);
}

/** Rule 2, applied: lowest annual figure, then ascending id. Never array order. */
const selectLowest = (findings) => [...findings].sort((left, right) =>
  left.monthlySavingsUsd - right.monthlySavingsUsd
  || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))[0];

function confidenceRecord(score, applied) {
  const points = applied.reduce((sum, item) => sum + item.points, 0);
  const value = Math.max(0, score - points);
  return Object.freeze({
    label: band(value), value, scoreBeforeDeductions: score, rule: CONFIDENCE_RULE,
    weights: CONFIDENCE_WEIGHTS,
    deductions: Object.freeze(applied.map((item) => Object.freeze({
      id: item.id, points: item.points, assumption: item.assumption,
    }))),
  });
}

function result(fields) {
  return Object.freeze({
    contract: FINOPS_EVIDENCE_CONTRACT,
    evidenceClass: fields.evidenceClass,
    validationStatus: fields.validationStatus,
    provenance: Object.freeze({
      evidenceId: fields.evidenceId, findingId: fields.findingId,
      findingIds: Object.freeze(fields.findingIds),
      supersededFindingIds: Object.freeze(fields.superseded ?? []),
      missingFields: Object.freeze(fields.missingFields ?? []),
      sourceIds: Object.freeze(fields.sourceIds ?? []),
    }),
    confidence: fields.confidence,
    // Reads of the contract record, never a second derivation of the same
    // number. A withheld answer therefore has no headline to suppress: there
    // was never one to state.
    headline: fields.answer?.status === ANSWER_STATUS.answered ? Object.freeze({
      annualSavingsUsd: fields.answer.annualSavingsUsd,
      savingsPercent: fields.answer.savingsPercent,
      annualBaselineSpendUsd: fields.answer.annualBaselineSpendUsd,
      verified: fields.validationStatus === VALIDATION_STATUS.complete,
    }) : null,
    benchmark: fields.answer?.benchmark ?? null,
    nextAction: fields.answer?.primaryAction ?? null,
    answer: fields.answer,
  });
}

/**
 * Resolve one evidence set to one answer, one finding id and one status.
 *
 * @param evidence `{ id, findings: [finding] }`. A finding carries an id, an
 *   `actionKey` and `benchmark.key` in the allowlists above, a positive
 *   `monthlySavingsUsd`, a `baseline`, a `readinessLevel` and the boolean
 *   evidence categories the confidence weights are scored over. Free-text
 *   fields may be present and are never read.
 * @returns a frozen `finops-evidence-answer/1.0.0` record. Always a record: a
 *   caller never has to tell null from incomplete.
 */
export function resolveEvidenceAnswer(evidence) {
  const findings = list(evidence?.findings).map(readFinding);
  const evidenceId = filled(evidence?.id) ? evidence.id : null;
  const findingIds = findings.map((finding) => finding.id).filter(Boolean);
  const incomplete = findings.filter((finding) => finding.missing.length > 0);

  // Rule 1. An empty set is incomplete for the same reason: the finding this
  // answer would cite does not exist.
  if (!findings.length || incomplete.length) {
    const first = incomplete[0];
    return result({
      evidenceClass: EVIDENCE_CLASS.incomplete,
      validationStatus: VALIDATION_STATUS.incomplete,
      evidenceId, findingId: first?.id ?? null, findingIds,
      missingFields: first ? [...first.missing] : ["findings"],
      confidence: confidenceRecord(confidenceScore(first?.evidence),
        [deduction("incomplete-evidence")]),
      // The contract's own withheld record, resolved from nothing, so an
      // incomplete set reaches the view as a stated refusal with a reason code
      // rather than as an absence the view has to invent a sentence for.
      answer: resolveFinopsAnswer(null),
    });
  }

  // Rule 2.
  const conflicting = figuresConflict(annualFigures(findings));
  const selected = selectLowest(findings);
  const applied = conflicting ? [deduction("conflicting-findings")] : [];
  const confidence = confidenceRecord(confidenceScore(selected.evidence), applied);

  const answer = resolveFinopsAnswer({
    recommendedActions: [{
      id: selected.actionKey, sourceId: selected.savingsSourceId,
      label: selected.actionLabel, department: selected.department,
      monthlySavingsUsd: selected.monthlySavingsUsd,
    }],
    baseline: selected.baseline,
    benchmark: selected.benchmark,
    confidence: { sourceId: `${selected.id}.evidence × declared weights`, value: confidence.value },
    readiness: { sourceId: `${selected.id}.readinessLevel`, level: selected.readinessLevel },
    statedAnnualSavingsUsd: [],
    statedSavingsPercent: null,
  });

  // The contract may still withhold on a rule of its own — a blocked readiness,
  // a benchmark it will not accept. Its refusal is an incomplete answer here
  // too: what a reader must not see is a figure, and there is none either way.
  const withheld = answer.status !== ANSWER_STATUS.answered;
  return result({
    evidenceClass: conflicting ? EVIDENCE_CLASS.conflicting
      : withheld ? EVIDENCE_CLASS.incomplete : EVIDENCE_CLASS.eligible,
    validationStatus: withheld ? VALIDATION_STATUS.incomplete
      : conflicting ? VALIDATION_STATUS.conflicted : VALIDATION_STATUS.complete,
    evidenceId, findingId: selected.id, findingIds,
    superseded: findings.filter((finding) => finding.id !== selected.id)
      .map((finding) => finding.id),
    missingFields: withheld ? [answer.withheldReason.code] : [],
    confidence: withheld
      ? confidenceRecord(confidence.scoreBeforeDeductions, [deduction("incomplete-evidence")])
      : confidence,
    sourceIds: [...new Set(Object.values(answer.sources).flat())].sort(),
    answer,
  });
}

/**
 * The page's bundled analysis, read as one evidence set.
 *
 * The source ids are the ones the analysis itself publishes, so a reader can
 * follow the figure back to the record it came from rather than to this module.
 * The finding's own statement is deliberately not carried: the action label is
 * looked up from the action id instead.
 */
export function bundledFinopsEvidence(analysis) {
  if (!isRecord(analysis) || analysis.ok !== true) return null;
  const readiness = analysis.readiness;
  const step = readiness?.recommendation;
  const departments = list(analysis.sample?.departments)
    .filter((row) => Number.isFinite(row?.spendUsd));
  const evidence = {};
  for (const category of list(readiness?.categories)) evidence[category.id] = category.present;
  return {
    id: analysis.scenarioId,
    findings: [{
      id: analysis.finding?.id,
      actionKey: step?.id,
      savingsSourceId: "readiness.recommendation.figure.value",
      department: step?.department,
      monthlySavingsUsd: step?.figure?.unit === "USD" ? step.figure.value : null,
      baseline: {
        sourceId: "sample.departments[].spendUsd",
        monthlySpendUsd: departments.reduce((sum, row) => sum + row.spendUsd, 0),
      },
      // The bundled analysis states one benchmark — the materiality floor its
      // registry defines — so the key is named here rather than matched on the
      // benchmark's own printed name.
      benchmark: {
        key: "bundled-demo-materiality-floor", sourceId: "finding.benchmark",
        value: analysis.finding?.benchmark?.value, unit: analysis.finding?.benchmark?.currency,
      },
      readinessLevel: readiness?.level,
      evidence,
    }],
  };
}
