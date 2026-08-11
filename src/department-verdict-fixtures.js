// The committed expectations both verdict paths are pinned to.
//
// WHAT A PIN IS FOR. The organization-wide review and the per-department screen
// must answer one department and one period the same way, and "they call the
// same function today" is not a proof — it is a fact about one commit. These
// four cells are the proof: two synthetic departments across two periods, each
// with the verdict string, the confidence and the evidence count a reviewer
// says the rule should produce, written from the pattern the cell is built to
// represent. `src/department-verdict.js` checks a computed verdict against the
// cell it belongs to and refuses to publish one that disagrees, and
// `tests/department-verdict-parity.test.js` asserts the screen's RENDERED
// values against both the org computation and these pins. A drift on either
// side alone reds CI.
//
// SYNTHETIC AND AGGREGATE ONLY. No credential, no provider call, no customer
// record, no prompt text, no excerpt, no conversation id. Two obviously
// invented departments — "Sample Platform Team", "Sample Analytics Team" —
// carrying round invented dollars. The scorer could not read a prompt out of
// these records if one were planted here; see `ALLOWED_INPUT_FIELDS`.
//
// THE ASSUMPTIONS ARE PART OF THE FIXTURE. Every weight and threshold the
// verdict rule reads is listed below with the value it currently has and a
// short statement of why it is that value. The values are IMPORTED from the
// modules that own them rather than retyped, so this table cannot quietly go
// stale; the prose is written here rather than reused, so changing a weight
// forces its assumption to be re-argued in review instead of inherited.

import { QUERY_CATEGORIES } from "./evolution.js";
import {
  AMBIGUITY_ABSOLUTE_MARGIN_USD,
  AMBIGUITY_RELATIVE_MARGIN,
  DAYS_PER_MONTH,
  INTERVENTION_WEIGHTS,
  MIN_MATERIAL_MONTHLY_USD,
  MIN_SCORED_PROMPTS_FOR_INTERVENTION,
} from "./department-intervention-scoring.js";

/** Bump alongside a cell edit so a stale expectation cannot pass quietly. */
export const VERDICT_FIXTURES_VERSION = "department-verdict-fixtures/1.0.0";

const attainment = (kind) =>
  INTERVENTION_WEIGHTS.find((weight) => weight.kind === kind).attainment;
const recoverable = (key) =>
  QUERY_CATEGORIES.find((category) => category.key === key).recoverableShare;

/**
 * Every weight and threshold behind a pinned verdict, and why it is what it is.
 *
 * One row per number a director can dispute. `value` is read from the module
 * that owns it; `assumption` is this fixture's own plain-prose reason, in one
 * or two sentences, stated so an executive can disagree with the sentence
 * rather than with an opaque coefficient.
 */
export const VERDICT_WEIGHT_ASSUMPTIONS = Object.freeze([
  Object.freeze({
    key: "attainment.routing", value: attainment("routing"),
    assumption: "Down-routing is a gateway rule, not a behaviour change, so nobody "
      + "has to be persuaded and it lands on nearly all of the recoverable slice. "
      + "The tenth held back is what a router misclassifies and escalates.",
  }),
  Object.freeze({
    key: "attainment.access_policy", value: attainment("access_policy"),
    assumption: "A policy block is mechanical like routing but adversarial: some "
      + "traffic moves to a shape the policy does not match. Scored below routing "
      + "for that reason and never above it.",
  }),
  Object.freeze({
    key: "attainment.rewrite", value: attainment("rewrite"),
    assumption: "A shared template holds for the prompt shapes it covers, but "
      + "people paste around it. Six in ten of the repeats it targets stay fixed; "
      + "the rest drift back to hand-written prompts inside a quarter.",
  }),
  Object.freeze({
    key: "attainment.training_gap", value: attainment("training_gap"),
    assumption: "Taught behaviour decays, so about a third of a diffuse retry gap "
      + "closes and stays closed. Deliberately the lowest weight in the table, so "
      + "coaching can never outrank a mechanical fix on the same dollars.",
  }),
  Object.freeze({
    key: "recoverable.overProvisioned", value: recoverable("overProvisioned"),
    assumption: "A simple task answered by a frontier model still has to be "
      + "answered. Seven tenths of the bill is the model premium and is "
      + "recoverable; the rest is the work itself and is not.",
  }),
  Object.freeze({
    key: "recoverable.inefficient", value: recoverable("inefficient"),
    assumption: "A retry chain contains one real question. Compressing the chain "
      + "removes about four tenths of its spend; the underlying question remains "
      + "and is not counted as a saving.",
  }),
  Object.freeze({
    key: "recoverable.outOfScope", value: recoverable("outOfScope"),
    assumption: "Non-business use has no business value to lose, so all of it is "
      + "recoverable. This is the only weight in the table set to 1, and it is why "
      + "leakage must never be reported as a prompt-skill problem.",
  }),
  Object.freeze({
    key: "recoverable.highValue", value: recoverable("highValue"),
    assumption: "High-value spend is the product working. Nothing is claimed "
      + "against it, so a department that is simply expensive and effective can "
      + "never be shown a recoverable figure it did not earn.",
  }),
  Object.freeze({
    key: "evidenceFloor", value: MIN_SCORED_PROMPTS_FOR_INTERVENTION,
    assumption: "The same scored-prompt floor a published grade already uses. A "
      + "second, quieter floor for recommendations would be indefensible: a "
      + "director who accepted one would be handed the other without being told.",
  }),
  Object.freeze({
    key: "materialityFloorUsd", value: MIN_MATERIAL_MONTHLY_USD,
    assumption: "An intervention costs a manager roughly half a day to schedule "
      + "and chase. Below $150 a month of recoverable spend it costs more "
      + "attention than it returns, and an executive who acts on three of them "
      + "learns to ignore the fourth.",
  }),
  Object.freeze({
    key: "ambiguityRelativeMargin", value: AMBIGUITY_RELATIVE_MARGIN,
    assumption: "The category mix is estimated from a few hundred scored prompts, "
      + "so each share carries several points of sampling error. A gap under a "
      + "tenth of the leader is inside that error, and naming a winner there is "
      + "false precision the first re-run would catch.",
  }),
  Object.freeze({
    key: "ambiguityAbsoluteMarginUsd", value: AMBIGUITY_ABSOLUTE_MARGIN_USD,
    assumption: "A floor under the relative margin, so a small department's "
      + "$40-against-$38 photo finish is not reported as a decision.",
  }),
  Object.freeze({
    key: "daysPerMonth", value: DAYS_PER_MONTH,
    assumption: "Every dollar figure is stated per 30-day month. Reporting "
      + "periods run 28 to 31 days, so this restates spend by at most about 7%, "
      + "and the restatement is printed in the arithmetic rather than hidden "
      + "inside the number.",
  }),
  Object.freeze({
    key: "confidence.sampleHigh", value: 400,
    assumption: "Four hundred scored prompts is where a per-category share stops "
      + "moving materially between re-runs of the same period, so it is where "
      + "sample size stops being the binding constraint on confidence.",
  }),
  Object.freeze({
    key: "confidence.sampleMedium", value: 120,
    assumption: "Above the grading floor but well short of stable. Enough to rank "
      + "interventions, not enough to call the ranking settled.",
  }),
  Object.freeze({
    key: "confidence.separationHigh", value: 0.5,
    assumption: "A leader worth half again what its nearest rival can claim "
      + "survives any plausible re-estimate of the mix, so the ranking is not what "
      + "limits confidence.",
  }),
  Object.freeze({
    key: "confidence.separationMedium", value: 0.2,
    assumption: "A fifth clear of the next candidate is a real ordering but one a "
      + "resampled month could narrow, so the ranking caps confidence at medium.",
  }),
  Object.freeze({
    key: "confidence.rule", value: "weakest-factor",
    assumption: "Confidence is the weakest of sample size, separation and signal "
      + "completeness — never an average. A five-thousand-prompt sample cannot "
      + "rescue a near-tie, and calling a verdict high because two of three "
      + "factors were high is how an unexplainable number reaches an executive.",
  }),
]);

/**
 * Two departments, two periods each. Every `expect` was written from the
 * pattern the cell represents before the arithmetic was run.
 */
export const DEPARTMENT_VERDICT_FIXTURES = Object.freeze([
  Object.freeze({
    cellId: "sample-platform/2026-05",
    note: "Over-provisioning dominates a large bill and every rival is far back. "
      + "A mechanical routing fix, at the sample size where confidence stops "
      + "being capped by evidence.",
    record: Object.freeze({
      departmentId: "sample-platform", id: "sample-platform",
      departmentLabel: "Sample Platform Team", name: "Sample Platform Team",
      periodId: "2026-05", period: "May 2026",
      spendUsd: 30000, periodDays: 30,
      mix: Object.freeze({ highValue: 0.5, overProvisioned: 0.35, inefficient: 0.1, outOfScope: 0.05 }),
      sampling: Object.freeze({ status: "available", sampledQueries: 500 }),
      patterns: Object.freeze({ repeatedShapeShare: 0.5 }),
    }),
    expect: Object.freeze({
      verdict: "Automated down-routing",
      confidence: "high",
      evidenceCount: 500,
      rubricBasisId: "spend-intervention",
      rubricVersion: 1,
    }),
  }),
  Object.freeze({
    cellId: "sample-platform/2026-06",
    note: "The month after routing landed: over-provisioning is gone and retry "
      + "chains are the largest line, nine in ten repeating one shape. A "
      + "template, not a workshop — and a thinner sample, so the same "
      + "department's confidence must move even though its department did not.",
    record: Object.freeze({
      departmentId: "sample-platform", id: "sample-platform",
      departmentLabel: "Sample Platform Team", name: "Sample Platform Team",
      periodId: "2026-06", period: "June 2026",
      spendUsd: 24000, periodDays: 30,
      mix: Object.freeze({ highValue: 0.55, overProvisioned: 0.05, inefficient: 0.38, outOfScope: 0.02 }),
      sampling: Object.freeze({ status: "available", sampledQueries: 180 }),
      patterns: Object.freeze({ repeatedShapeShare: 0.9 }),
    }),
    expect: Object.freeze({
      verdict: "Prompt template rewrite",
      confidence: "medium",
      evidenceCount: 180,
      rubricBasisId: "spend-intervention",
      rubricVersion: 1,
    }),
  }),
  Object.freeze({
    cellId: "sample-analytics/2026-05",
    note: "A quarter of scored prompts are non-business. Fully recoverable and "
      + "untouched by any prompt technique; a coaching verdict here would blame "
      + "the team for the wrong thing.",
    record: Object.freeze({
      departmentId: "sample-analytics", id: "sample-analytics",
      departmentLabel: "Sample Analytics Team", name: "Sample Analytics Team",
      periodId: "2026-05", period: "May 2026",
      spendUsd: 18000, periodDays: 30,
      mix: Object.freeze({ highValue: 0.6, overProvisioned: 0.05, inefficient: 0.1, outOfScope: 0.25 }),
      sampling: Object.freeze({ status: "available", sampledQueries: 420 }),
      patterns: Object.freeze({ repeatedShapeShare: 0.5 }),
    }),
    expect: Object.freeze({
      verdict: "Acceptable-use routing",
      confidence: "high",
      evidenceCount: 420,
      rubricBasisId: "spend-intervention",
      rubricVersion: 1,
    }),
  }),
  Object.freeze({
    cellId: "sample-analytics/2026-06",
    note: "The sampler barely ran. Twelve scored prompts is under the floor a "
      + "published grade already uses, so the honest verdict is the named "
      + "shortfall — and both surfaces must state it rather than one of them "
      + "quietly ranking twelve prompts.",
    record: Object.freeze({
      departmentId: "sample-analytics", id: "sample-analytics",
      departmentLabel: "Sample Analytics Team", name: "Sample Analytics Team",
      periodId: "2026-06", period: "June 2026",
      spendUsd: 16000, periodDays: 30,
      mix: Object.freeze({ highValue: 0.62, overProvisioned: 0.06, inefficient: 0.24, outOfScope: 0.08 }),
      sampling: Object.freeze({ status: "available", sampledQueries: 12 }),
      patterns: Object.freeze({ repeatedShapeShare: 0.5 }),
    }),
    expect: Object.freeze({
      verdict: "Not enough evidence to prioritize an intervention",
      confidence: "not_scored",
      evidenceCount: 12,
      rubricBasisId: "spend-intervention",
      rubricVersion: 1,
    }),
  }),
]);

const PINS = new Map(DEPARTMENT_VERDICT_FIXTURES.map((cell) => [cell.cellId, cell.expect]));

/**
 * The committed expectation for one department and period, or null.
 *
 * Null is not a pass — it means no cell covers this department and period, and
 * the caller publishes what the rule computed. Only a cell that exists and
 * disagrees withholds a verdict.
 */
export function pinnedVerdictFor(departmentId, periodKey) {
  if (!departmentId || !periodKey) return null;
  return PINS.get(`${departmentId}/${periodKey}`) ?? null;
}
