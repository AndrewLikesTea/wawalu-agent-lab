// The one place a department's intervention verdict, its confidence, and the
// count of evidence behind it are produced.
//
// WHY THIS FILE EXISTS. Two surfaces answer the same question for the same
// department: the organization-wide review on evolution.html, and the
// per-department screen a forwarded `?department=` link opens. Until now the
// screen composed its own next move out of `recommendationFor`, while the org
// review ran `scoreDepartmentIntervention`. Two derivations of one verdict is
// two verdicts: a CTO forwarded a deep link could be told to run a workshop on
// a department the org review had already refused to prioritize, and neither
// number would be wrong on its own page.
//
// So neither page derives one any more. Both call `departmentVerdict`, and the
// three values a reader acts on — the verdict string, the confidence, and how
// many scored prompts stand behind them — exist in exactly one function.
// `tests/department-verdict-parity.test.js` asserts the screen's RENDERED
// values against this function's, so a change to either side alone reds CI.
//
// WHAT IS PINNED, AND WHAT THAT BUYS. `department-verdict-fixtures.js` commits
// the expected verdict, confidence and evidence count for four synthetic
// department/period cells. This function looks up the cell it was handed and
// refuses to publish a verdict that disagrees with its committed expectation:
// the surface says the verdict is withheld and why, rather than showing an
// executive a number no committed expectation backs. The check runs here, in
// the shared function, so both entry points get it — a pin cannot be enforced
// on one surface and skipped on the other.
//
// NO PROMPT TEXT. The only input is the aggregate record
// `scoreDepartmentIntervention` already allowlists down to numbers, an enum, a
// slug and a charset-checked org label. Nothing this file returns carries a
// file name, module name, fixture id or test id, because these strings are read
// by a CTO on an executive screen.

import {
  DEPARTMENT_INTERVENTION_VERSION,
  INTERVENTION_OUTCOME,
  scoreDepartmentIntervention,
} from "./department-intervention-scoring.js";
import { pinnedVerdictFor } from "./department-verdict-fixtures.js";

/**
 * The rubric a reader is told about, in a reader's vocabulary.
 *
 * ASSUMPTION: an executive asked to accept a verdict will ask what produced it,
 * and "spend-intervention rubric, version 1" is an answer they can quote back at
 * the team that owns it. The scorer's own version string —
 * `department-intervention/1.0.0` — is a build identifier, not a sentence, so
 * only its major number is shown. A weight or threshold change bumps that
 * version, and this sentence changes with it.
 */
export const VERDICT_RUBRIC_BASIS_ID = "spend-intervention";
export const VERDICT_RUBRIC_VERSION =
  Number(DEPARTMENT_INTERVENTION_VERSION.split("/")[1].split(".")[0]) || 1;
export const VERDICT_RUBRIC_SENTENCE =
  `Scored against the ${VERDICT_RUBRIC_BASIS_ID} rubric, version ${VERDICT_RUBRIC_VERSION}.`;

/** The confidence value when no intervention was ranked, so none was scored. */
export const CONFIDENCE_NOT_SCORED = "not_scored";
/** The confidence value when a committed expectation disagrees with the rule. */
export const CONFIDENCE_WITHHELD = "withheld";

/** One verdict string per outcome that carries no recommendation. */
const OUTCOME_VERDICT = Object.freeze({
  [INTERVENTION_OUTCOME.ambiguous]: "Two candidate interventions could not be separated",
  [INTERVENTION_OUTCOME.insufficientEvidence]: "Not enough evidence to prioritize an intervention",
  [INTERVENTION_OUTCOME.hold]: "Hold — no intervention clears the materiality floor",
});

const WITHHELD_VERDICT =
  "Verdict withheld — the committed expectation for this department and period "
  + "disagrees with what the rubric computed";
const WITHHELD_DETAIL =
  "Not shown. A verdict that does not match the expectation committed for this "
  + "department and period is withheld rather than published.";

/**
 * The period a record belongs to, as a key a URL can carry and a pin can match.
 *
 * Lowercased and reduced to the slug charset so "25 Jun–25 Jul 2026" and a
 * committed `periodId` of "2026-05" both address one cell without either page
 * having to know which shape the dataset used.
 */
export function periodKeyOf(record) {
  const raw = String(record?.periodId ?? record?.period ?? "").trim().toLowerCase();
  const key = raw.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return key === "" ? null : key;
}

/**
 * The confidence line, naming the factor that capped the level.
 *
 * A bare "Medium" is a number a director cannot argue with and therefore does
 * not believe. The factor that set it is printed beside it, so "what would make
 * this high?" has an answer on the same line.
 */
function confidenceDetail(recommendation) {
  const { level, factors } = recommendation.confidence;
  const capping = factors.find((factor) => factor.level === level) ?? factors[0];
  return `${level[0].toUpperCase()}${level.slice(1)} · capped by ${capping.key}: ${capping.detail}`;
}

function notScoredDetail(result) {
  return result.candidates.length
    ? `Not scored. Candidates considered: ${result.candidates.map((candidate) => candidate.kind).join(", ")}.`
    : "Not scored: no candidate was ranked.";
}

/** How many scored prompts stand behind the verdict, as a sentence. */
function evidenceSentence(count) {
  return count === 0
    ? "No scored prompts stand behind this verdict for this period."
    : `${count.toLocaleString("en-US")} scored prompt${count === 1 ? "" : "s"} `
      + "stand behind this verdict for this period.";
}

/**
 * The verdict for one already-scored result.
 *
 * Split from `departmentVerdict` so the org review, which holds the scorer's
 * result already, reads the same three values without scoring twice.
 *
 * @param {object} result a frozen `scoreDepartmentIntervention` result.
 * @param {object} record the aggregate record it was scored from, for the pin.
 */
export function departmentVerdictFromResult(result, record = {}) {
  const recommendation = result.recommendation;
  const evidenceCount = result.provenance.sampledQueries;
  const computed = {
    verdict: recommendation
      ? recommendation.title
      : OUTCOME_VERDICT[result.outcome] ?? "No intervention prioritized",
    confidence: recommendation ? recommendation.confidence.level : CONFIDENCE_NOT_SCORED,
    confidenceDetail: recommendation ? confidenceDetail(recommendation) : notScoredDetail(result),
    evidenceCount,
  };

  const pin = pinnedVerdictFor(record?.departmentId ?? record?.id, periodKeyOf(record));
  const agrees = !pin || (pin.verdict === computed.verdict
    && pin.confidence === computed.confidence
    && pin.evidenceCount === computed.evidenceCount);

  const published = agrees ? computed : {
    verdict: WITHHELD_VERDICT,
    confidence: CONFIDENCE_WITHHELD,
    confidenceDetail: WITHHELD_DETAIL,
    evidenceCount,
  };

  return Object.freeze({
    ...published,
    outcome: result.outcome,
    evidence: evidenceSentence(published.evidenceCount),
    rubricBasisId: VERDICT_RUBRIC_BASIS_ID,
    rubricVersion: VERDICT_RUBRIC_VERSION,
    rubricSentence: VERDICT_RUBRIC_SENTENCE,
    // Whether a committed expectation covers this cell at all, and whether it
    // held. `pinned: false` is not a pass — it means nothing was pinned here.
    pinned: Boolean(pin),
    withheld: !agrees,
    // The recommendation's own fields, for a surface that states the move as
    // well as the verdict. Read, never re-derived.
    action: recommendation && agrees ? Object.freeze({
      text: recommendation.action,
      valueUsd: recommendation.estimatedMonthlyValueUsd,
      patternLabel: recommendation.rationale.patternLabel,
      shareOfScoredPrompts: recommendation.rationale.shareOfScoredPrompts,
    }) : null,
    reason: result.reason?.text ?? null,
    result,
  });
}

/**
 * The verdict for one department's aggregate record.
 *
 * @param {object} record one department/period aggregate, the shape the
 *   drill-down and the department screen both already hold.
 */
export function departmentVerdict(record = {}) {
  return departmentVerdictFromResult(scoreDepartmentIntervention(record), record);
}
