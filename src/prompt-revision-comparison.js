// Versioned, local-only comparison of two already-built coaching sessions.
// This module deliberately cannot accept prompt text: grading and the
// single-prompt envelope remain owned by prompt-coaching-contract.js.

import {
  COACHING_OUTCOME, COACHING_SESSION_ID_PATTERN, validateCoachingSession,
} from "./prompt-coaching-contract.js";
import { PROMPT_LITERACY_RUBRIC } from "./prompt-literacy-scoring.js";

export const PROMPT_REVISION_COMPARISON_VERSION = "prompt-revision-comparison/1.0.0";
export const PROMPT_REVISION_QUESTION = "Did my revised prompt improve?";

export const COMPARISON_FIELDS = Object.freeze([
  "schemaVersion", "comparisonId", "question", "compared", "reason",
  "baseline", "revision", "comparison", "boundary",
]);
export const COMPARISON_BODY_FIELDS = Object.freeze([
  "headline", "grade", "remainingWeakness", "nextAction",
]);
export const COMPARISON_BOUNDARY = Object.freeze({
  sentForComparison: "none",
  persisted: "none",
  retainsAnalyzedText: false,
  baselineRetainedAs: "session_envelope",
  integrationsContacted: "none",
});

export const COMPARISON_REASON = Object.freeze({
  baselineNotGraded: "baseline_not_graded",
  revisionNotGraded: "revision_not_graded",
  rubricChanged: "rubric_changed",
  tierChanged: "tier_changed",
});

const RECOVERY = Object.freeze({
  [COMPARISON_REASON.baselineNotGraded]: Object.freeze({
    title: "Grade a baseline first.",
    guidance: "Fix the baseline session refusal, then grade it again before comparing.",
    control: "prompt-coaching-baseline-input",
  }),
  [COMPARISON_REASON.revisionNotGraded]: Object.freeze({
    title: "Grade the revision first.",
    guidance: "Use the revision session's recovery guidance, then grade it again.",
    control: "prompt-coaching-revision-input",
  }),
  [COMPARISON_REASON.rubricChanged]: Object.freeze({
    title: "Re-grade both versions.",
    guidance: "Build both sessions with the same rubric and classifier versions.",
    control: "prompt-coaching-baseline-input",
  }),
  [COMPARISON_REASON.tierChanged]: Object.freeze({
    title: "Use one model tier.",
    guidance: "Select the same model tier for both versions, then grade both again.",
    control: "prompt-coaching-model",
  }),
});

function freeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) freeze(entry);
  return Object.freeze(value);
}

function assertSession(name, session) {
  const report = validateCoachingSession(session);
  if (!report.valid) {
    throw new TypeError(`prompt revision comparison: invalid ${name} session (${report.errors.map(({ code }) => code).join(", ")})`);
  }
}

function abstentionReason(baseline, revision) {
  if (baseline.outcome !== COACHING_OUTCOME.graded) return COMPARISON_REASON.baselineNotGraded;
  if (revision.outcome !== COACHING_OUTCOME.graded) return COMPARISON_REASON.revisionNotGraded;
  if (baseline.result.rubricVersionId !== revision.result.rubricVersionId
    || baseline.result.classifierVersion !== revision.result.classifierVersion) {
    return COMPARISON_REASON.rubricChanged;
  }
  if (baseline.input.modelTier !== revision.input.modelTier) return COMPARISON_REASON.tierChanged;
  return null;
}

function remainingWeakness(baseline, revision) {
  const current = revision.result.improvement;
  const previous = baseline.result.improvement;
  if (!current.available) {
    return freeze({
      status: "none", signalId: null, axis: null, title: null, guidance: null,
      rewrite: null, points: null,
      baselineSignalId: previous.available ? previous.id : null,
    });
  }
  const status = !previous.available
    ? "emerged"
    : previous.id === current.id ? "unaddressed" : "advanced";
  return freeze({
    status,
    signalId: current.id,
    axis: current.axis,
    title: current.title,
    guidance: current.guidance,
    rewrite: current.rewrite,
    points: current.points,
    baselineSignalId: previous.available ? previous.id : null,
  });
}

function nextAction(direction, weakness) {
  if (direction === "regressed") {
    return freeze({
      kind: "revert",
      title: "Keep the baseline.",
      guidance: "The revision scored lower. Restore the baseline before making another change.",
      control: "prompt-coaching-baseline-input",
    });
  }
  if (weakness.status !== "none") {
    return freeze({
      kind: "apply_remaining",
      title: weakness.title,
      guidance: weakness.guidance,
      rewrite: weakness.rewrite,
      control: "prompt-coaching-revision-input",
    });
  }
  return freeze({
    kind: "stop",
    title: "Stop iterating.",
    guidance: "The rubric has no higher-priority weakness left to name.",
    control: "prompt-coaching-revision-input",
  });
}

export function buildRevisionComparison({ comparisonId, baseline, revision } = {}) {
  if (typeof comparisonId !== "string" || !COACHING_SESSION_ID_PATTERN.test(comparisonId)) {
    throw new RangeError("prompt revision comparison: comparisonId must be 1–64 letters, numbers, dots, underscores, or hyphens");
  }
  assertSession("baseline", baseline);
  assertSession("revision", revision);
  if (baseline.sessionId === revision.sessionId) {
    throw new RangeError("prompt revision comparison: baseline and revision sessionIds must differ");
  }

  const reason = abstentionReason(baseline, revision);
  if (reason) {
    return freeze({
      schemaVersion: PROMPT_REVISION_COMPARISON_VERSION,
      comparisonId,
      question: PROMPT_REVISION_QUESTION,
      compared: false,
      reason,
      baseline,
      revision,
      comparison: {
        headline: null,
        grade: null,
        remainingWeakness: null,
        nextAction: { kind: "abstain_recovery", ...RECOVERY[reason] },
      },
      boundary: COMPARISON_BOUNDARY,
    });
  }

  const baselineScore = baseline.result.benchmark.score;
  const revisionScore = revision.result.benchmark.score;
  const delta = revisionScore - baselineScore;
  const direction = delta > 0 ? "improved" : delta < 0 ? "regressed" : "unchanged";
  const letters = PROMPT_LITERACY_RUBRIC.grades.map(({ letter }) => letter);
  const from = baseline.result.benchmark.grade;
  const to = revision.result.benchmark.grade;
  const bandDelta = letters.indexOf(from) - letters.indexOf(to);
  if (bandDelta !== 0 && Math.sign(bandDelta) !== Math.sign(delta)) {
    throw new RangeError("prompt revision comparison: grade movement opposes composite movement");
  }
  const weakness = remainingWeakness(baseline, revision);

  return freeze({
    schemaVersion: PROMPT_REVISION_COMPARISON_VERSION,
    comparisonId,
    question: PROMPT_REVISION_QUESTION,
    compared: true,
    reason: null,
    baseline,
    revision,
    comparison: {
      headline: {
        baselineScore,
        revisionScore,
        delta,
        direction,
        text: delta === 0
          ? `No change · ${baselineScore} → ${revisionScore} of 100.`
          : `${delta > 0 ? "+" : ""}${delta} points · ${baselineScore} → ${revisionScore} of 100.`,
      },
      grade: { from, to, bandDelta, moved: bandDelta !== 0 },
      remainingWeakness: weakness,
      nextAction: nextAction(direction, weakness),
    },
    boundary: COMPARISON_BOUNDARY,
  });
}
