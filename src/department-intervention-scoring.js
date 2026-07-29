// Which single intervention a department should run next, and why.
//
// The drill-down already answers "how is this department scoring". It does not
// answer "so what do I do on Monday" unless the bundled fixture happens to carry
// a reviewed intervention. This module answers it by rule instead of by fixture:
// a pure function from one department's *aggregate* record to exactly one
// prioritized action, an estimated monthly dollar value, a confidence with the
// factor that capped it, provenance, and the pattern the recommendation rests
// on.
//
// Written to be disputed. Every number a director can argue with is either
// (a) read off their own aggregate record, (b) a weight declared in
// `INTERVENTION_WEIGHTS` below with its assumption written beside it, or
// (c) arithmetic reproduced verbatim in the output as a string. There is no
// fourth source. `docs/department-intervention-scoring.md` is the same table in
// prose for a reader who will not open a `.js` file.
//
// THREE THINGS THIS MODULE REFUSES TO DO.
//
//   1. It never reads prompt text, and structurally cannot. `normalizeInterventionInput`
//      copies a closed allowlist of numeric and enumerated fields off the caller's
//      object; every other key — top-level, nested, however it arrived — is dropped
//      before scoring. The only string that crosses the boundary is the department's
//      org-roster label, and that is charset-, word- and length-checked by
//      `sanitizeDepartmentLabel` before it is used.
//   2. It never breaks a tie it cannot defend. Two candidates inside the
//      ambiguity margin return `ambiguous` with both named, not a coin flip
//      dressed as a ranking.
//   3. It never scores a sample too thin to score. Below the grading floor the
//      answer is `insufficient_evidence` with the shortfall in whole prompts,
//      not a small number with a small confidence chip beside it.
//
// Determinism: no clock, no randomness, no iteration over an unordered map.
// Identical normalized input yields a byte-identical result, and
// `provenance.inputDigest` is the handle for saying so in a dispute.

import { QUERY_CATEGORIES, normalizeMix } from "./evolution.js";
import { RUBRIC_VERSION_ID } from "./prompt-literacy-scoring.js";
import { MIN_SCORED_PROMPTS } from "./finops-panel-contract.js";

/** Bump when a weight, a threshold, an outcome, or the output shape changes. */
export const DEPARTMENT_INTERVENTION_VERSION = "department-intervention/1.0.0";

/** The four outcomes. Three of them carry no recommendation, on purpose. */
export const INTERVENTION_OUTCOME = Object.freeze({
  recommended: "recommended",
  ambiguous: "ambiguous",
  insufficientEvidence: "insufficient_evidence",
  hold: "hold",
});

/**
 * The scored sample floor, borrowed rather than re-declared.
 *
 * ASSUMPTION: an intervention should not be recommended off a sample too thin to
 * publish a grade from. Reusing `MIN_SCORED_PROMPTS` means a director who has
 * already accepted the grading floor cannot be handed a second, quieter one.
 */
export const MIN_SCORED_PROMPTS_FOR_INTERVENTION = MIN_SCORED_PROMPTS;

/**
 * Below this the answer is "hold", not a recommendation.
 *
 * ASSUMPTION: an intervention costs a manager roughly half a day to schedule and
 * chase. Recommending one for less than $150/month of recoverable spend spends
 * more attention than it returns, and an executive who acts on three of them
 * learns to ignore the fourth.
 */
export const MIN_MATERIAL_MONTHLY_USD = 150;

/**
 * When two candidates are too close to separate.
 *
 * ASSUMPTION: the category mix is estimated from a few hundred scored prompts,
 * so its per-category share carries several points of sampling error. A gap
 * under 10% of the leader is inside that error; calling a winner there is false
 * precision, and the first director to re-run the sample would catch it. The
 * absolute floor stops the relative rule from declaring a $40-vs-$38 photo
 * finish meaningful on a small department.
 */
export const AMBIGUITY_RELATIVE_MARGIN = 0.1;
export const AMBIGUITY_ABSOLUTE_MARGIN_USD = 250;

/**
 * The month the dollar figure is stated in.
 *
 * ASSUMPTION: a 30-day month. Drill-down periods run 28–31 days, so this
 * restates spend by at most ~7%, and the restatement is printed in the
 * arithmetic rather than hidden inside the number.
 */
export const DAYS_PER_MONTH = 30;

/** Ordered weakest to strongest; a confidence is the weakest factor it has. */
export const CONFIDENCE_LEVELS = Object.freeze(["low", "medium", "high"]);

/**
 * The one sentence this surface repeats wherever a recommendation is shown.
 * Persistent, not a tooltip: a reader looking at a prompt-derived number is
 * always looking at the sentence that says what it was derived from.
 */
export const INTERVENTION_REDACTION_STATEMENT =
  "This recommendation is computed from aggregate category counts and spend "
  + "only. No prompt text, excerpt, or conversation identifier is read, scored, "
  + "stored, or shown.";

const CATEGORY_BY_KEY = new Map(QUERY_CATEGORIES.map((category) => [category.key, category]));

/**
 * The weight table. One row per intervention this module can recommend.
 *
 * `recoverableShare` is NOT re-declared here — it is read from `QUERY_CATEGORIES`
 * in `evolution.js`, so "how much of this slice is recoverable at all" keeps
 * exactly one definition across the product. What this table adds is
 * `attainment`: of the recoverable slice, how much a *specific* intervention
 * actually lands. Each one states its assumption, because that is the number a
 * director will contest first.
 *
 * `addressable` is the fraction of the category the intervention can even reach,
 * as a function of the aggregate pattern signals. Where a signal is unknown the
 * function returns null and the candidate is scored as an interval instead of a
 * point — see `candidateFor`.
 */
export const INTERVENTION_WEIGHTS = Object.freeze([
  Object.freeze({
    kind: "routing",
    categoryKey: "overProvisioned",
    label: "Automated down-routing",
    action: "Enable automated down-routing for short, low-context prompts.",
    patternLabel: "simple tasks answered by a frontier model",
    attainment: 0.9,
    assumption:
      "ASSUMPTION 0.90: down-routing is a gateway rule, not a behaviour change. "
      + "Nobody has to be persuaded, so it lands on nearly all of the recoverable "
      + "slice; the 10% held back is prompts a router misclassifies and escalates.",
    // Mechanical: a router reaches every over-provisioned prompt in the slice.
    addressable: () => 1,
  }),
  Object.freeze({
    kind: "rewrite",
    categoryKey: "inefficient",
    label: "Prompt template rewrite",
    action: "Rewrite the repeated prompt shapes behind this team's retry chains as a shared template.",
    patternLabel: "retry chains that repeat one prompt shape",
    attainment: 0.6,
    assumption:
      "ASSUMPTION 0.60: a template lands quickly for the shapes it covers, but "
      + "people paste around it. Six in ten of the repeats it targets are held; "
      + "the rest drift back to hand-written prompts within the quarter.",
    // Only the repeated shapes. A one-off retry chain has no template to write.
    addressable: (patterns) => patterns.repeatedShapeShare,
  }),
  Object.freeze({
    kind: "training_gap",
    categoryKey: "inefficient",
    label: "Prompt engineering workshop",
    action: "Schedule a prompt engineering workshop for this team.",
    patternLabel: "retry chains spread across many distinct prompt shapes",
    attainment: 0.35,
    assumption:
      "ASSUMPTION 0.35: taught behaviour decays. Roughly a third of a diffuse "
      + "retry gap closes and stays closed over a quarter — deliberately the "
      + "lowest attainment in the table, so coaching never outranks a mechanical "
      + "fix that addresses the same dollars.",
    // The share a template cannot reach: everything that is not a repeated shape.
    addressable: (patterns) => (patterns.repeatedShapeShare === null
      ? null : 1 - patterns.repeatedShapeShare),
  }),
  Object.freeze({
    kind: "access_policy",
    categoryKey: "outOfScope",
    label: "Acceptable-use routing",
    action: "Apply acceptable-use routing so personal queries leave the enterprise plan.",
    patternLabel: "non-business queries billed to the enterprise plan",
    attainment: 0.8,
    assumption:
      "ASSUMPTION 0.80: a policy block is mechanical like routing, but it is "
      + "adversarial — some traffic moves to a shape the policy does not match. "
      + "Scored below routing for that reason, never above it.",
    addressable: () => 1,
  }),
]);

/**
 * The closed allowlist. Every field the scorer will read, and nothing else.
 *
 * This is the redaction boundary in one place: a key not on this list never
 * reaches `scoreDepartmentIntervention`'s working state, so no amount of extra
 * payload on the caller's object can carry prompt text into a score, a log line,
 * a persisted record, or a rendered field.
 */
export const ALLOWED_INPUT_FIELDS = Object.freeze([
  "departmentId", "departmentLabel", "spendUsd", "periodDays",
  "mix.highValue", "mix.overProvisioned", "mix.inefficient", "mix.outOfScope",
  "sampling.status", "sampling.sampledQueries",
  "patterns.repeatedShapeShare",
]);

/** The only sampling status that means "there is a sample". */
const SAMPLING_AVAILABLE = "available";

/**
 * The org-unit label, and the only string allowed across the boundary.
 *
 * It is a roster label — "QA & Release" — not anything a person typed into a
 * model. It is still checked as if it were hostile, because the cheapest way for
 * prompt text to reach an executive view is through a field nobody guards:
 *
 *   - control characters are stripped and whitespace collapsed;
 *   - the charset is what an org chart uses, nothing more;
 *   - more than six words, or more than 64 characters, is prose rather than a
 *     department name, and prose is rejected outright.
 *
 * A rejected label becomes `FALLBACK_LABEL`. The score is unaffected — the label
 * is never an input to any number — so a bad label degrades one heading, not a
 * recommendation.
 */
export const MAX_LABEL_LENGTH = 64;
export const MAX_LABEL_WORDS = 6;
export const FALLBACK_LABEL = "This department";

const LABEL_CHARSET = /^[A-Za-z0-9 &,.\-/'()]+$/;

export function sanitizeDepartmentLabel(value) {
  if (typeof value !== "string") return FALLBACK_LABEL;
  // Whitespace, including tab and newline, collapses to a single word break.
  // Every other control character is left to fail the charset test below rather
  // than be silently erased into something that reads as a clean label.
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (!collapsed) return FALLBACK_LABEL;
  if (collapsed.length > MAX_LABEL_LENGTH) return FALLBACK_LABEL;
  if (collapsed.split(" ").length > MAX_LABEL_WORDS) return FALLBACK_LABEL;
  if (!LABEL_CHARSET.test(collapsed)) return FALLBACK_LABEL;
  return collapsed;
}

/** An id is a slug or it is nothing. Never rendered; used only for provenance. */
function sanitizeDepartmentId(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(trimmed) ? trimmed : null;
}

const finite = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
const nonNegative = (value) => {
  const number = finite(value);
  return number === null || number < 0 ? null : number;
};
const share = (value) => {
  const number = finite(value);
  return number === null || number < 0 || number > 1 ? null : number;
};

/**
 * Pull the allowlisted fields off a raw department record and nothing else.
 *
 * Exported because the boundary is worth testing directly: hand this function a
 * record salted with prompt text in every field and the result is still eleven
 * numbers, an enum, a slug and a checked label.
 */
export function normalizeInterventionInput(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const mix = normalizeMix(source.mix ?? {});
  // A sample size is a count, not a measurement. Do not round malformed
  // metadata across the evidence floor (for example, 24.6 must not become 25).
  const rawSampledQueries = nonNegative(source.sampling?.sampledQueries);
  const sampledQueries = Number.isInteger(rawSampledQueries) ? rawSampledQueries : 0;
  const samplingAvailable = source.sampling?.status === SAMPLING_AVAILABLE
    && Number.isInteger(rawSampledQueries);
  const periodDays = nonNegative(source.periodDays);
  const spendUsd = nonNegative(source.spendUsd) ?? 0;
  return Object.freeze({
    departmentId: sanitizeDepartmentId(source.departmentId ?? source.id),
    departmentLabel: sanitizeDepartmentLabel(source.departmentLabel ?? source.name),
    spendUsd,
    periodDays: periodDays && periodDays > 0 ? periodDays : null,
    monthlySpendUsd: periodDays && periodDays > 0
      ? Math.round((spendUsd * DAYS_PER_MONTH) / periodDays)
      : Math.round(spendUsd),
    mix: Object.freeze({ ...mix }),
    sampling: Object.freeze({
      status: samplingAvailable ? SAMPLING_AVAILABLE : "unavailable",
      sampledQueries,
    }),
    patterns: Object.freeze({
      repeatedShapeShare: share(source.patterns?.repeatedShapeShare),
    }),
  });
}

/**
 * A stable 32-bit FNV-1a over the normalized numbers, as eight hex digits.
 *
 * Not a security primitive and not claimed as one. It is a handle: two people
 * disputing a score can compare digests and know in one line whether they are
 * arguing about the same input or about two different exports. The label is
 * excluded because it is never an input to a number.
 */
export function interventionDigest(normalized) {
  const canonical = JSON.stringify([
    DEPARTMENT_INTERVENTION_VERSION,
    normalized.monthlySpendUsd,
    QUERY_CATEGORIES.map((category) => Math.round(normalized.mix[category.key] * 1e6)),
    normalized.sampling.status,
    normalized.sampling.sampledQueries,
    normalized.patterns.repeatedShapeShare === null
      ? null : Math.round(normalized.patterns.repeatedShapeShare * 1e6),
  ]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Score one candidate intervention.
 *
 * value = monthly spend × category share × recoverable share × attainment × addressable
 *
 * When `addressable` is unknown the point estimate is withheld — `valueUsd` is
 * null — and only the ceiling (`maxValueUsd`, at addressable = 1) is reported.
 * That is what lets the ranking below stay honest under partial information:
 * a leader still wins if it clears the *ceiling* of everything it is racing.
 */
function candidateFor(weight, normalized) {
  const category = CATEGORY_BY_KEY.get(weight.categoryKey);
  const categoryShare = normalized.mix[weight.categoryKey] ?? 0;
  const base = normalized.monthlySpendUsd * categoryShare
    * category.recoverableShare * weight.attainment;
  const addressable = weight.addressable(normalized.patterns);
  const determined = addressable !== null && addressable !== undefined;
  const valueUsd = determined ? Math.round(base * addressable) : null;
  const factors = `${formatUsd0(normalized.monthlySpendUsd)} × ${pct(categoryShare)} `
    + `× ${category.recoverableShare} recoverable × ${weight.attainment} attainment`;
  return Object.freeze({
    kind: weight.kind,
    label: weight.label,
    categoryKey: weight.categoryKey,
    categoryLabel: category.label,
    categoryShare,
    determined,
    addressable: determined ? addressable : null,
    valueUsd,
    maxValueUsd: Math.round(base),
    // What this candidate can hold against a leader. A measured candidate is
    // worth what it is worth; only an unmeasured one gets to argue from its
    // ceiling. Using the ceiling for both would let a candidate the signals
    // already priced at $270 block a $2,993 winner, which is not caution — it
    // is refusing to answer a question the evidence answered.
    blockingUsd: determined ? valueUsd : Math.round(base),
    arithmetic: determined
      ? `${factors} × ${pct(addressable)} addressable = ${formatUsd0(valueUsd)}/month`
      : `${factors} = at most ${formatUsd0(Math.round(base))}/month; the addressable `
        + "share is unknown because no repeated-shape signal was supplied",
    assumption: weight.assumption,
    patternLabel: weight.patternLabel,
    action: weight.action,
  });
}

const pct = (value) => `${(value * 100).toFixed(1)}%`;
const formatUsd0 = (value) => `$${Math.round(Number(value) || 0).toLocaleString("en-US")}`;

/** The margin the leader has to clear, in dollars. */
function requiredMargin(leaderUsd) {
  return Math.max(AMBIGUITY_ABSOLUTE_MARGIN_USD, leaderUsd * AMBIGUITY_RELATIVE_MARGIN);
}

const weakest = (levels) => CONFIDENCE_LEVELS.find((level) => levels.includes(level)) ?? "low";

function sampleFactor(sampledQueries) {
  const level = sampledQueries >= 400 ? "high" : sampledQueries >= 120 ? "medium" : "low";
  return Object.freeze({
    key: "sample",
    level,
    detail: `${sampledQueries.toLocaleString("en-US")} scored prompts in the sample `
      + "(400+ reads as high, 120+ as medium).",
  });
}

function separationFactor(leaderUsd, rivalUsd) {
  const gap = leaderUsd <= 0 ? 0 : (leaderUsd - rivalUsd) / leaderUsd;
  const level = gap >= 0.5 ? "high" : gap >= 0.2 ? "medium" : "low";
  return Object.freeze({
    key: "separation",
    level,
    detail: `The leading intervention is worth ${pct(gap)} more than the next `
      + "candidate's blocking value (a measured value, or an unmeasured candidate's "
      + "ceiling; 50%+ reads as high, 20%+ as medium).",
  });
}

function completenessFactor(patterns) {
  const complete = patterns.repeatedShapeShare !== null;
  return Object.freeze({
    key: "completeness",
    level: complete ? "high" : "medium",
    detail: complete
      ? "Every pattern signal the weight table reads was supplied."
      : "No repeated-shape signal was supplied, so the retry-chain split is bounded rather than measured.",
  });
}

function provenanceOf(normalized, basis) {
  return Object.freeze({
    scorerVersion: DEPARTMENT_INTERVENTION_VERSION,
    rubricVersion: RUBRIC_VERSION_ID,
    samplingStatus: normalized.sampling.status,
    sampledQueries: normalized.sampling.sampledQueries,
    monthlySpendUsd: normalized.monthlySpendUsd,
    periodDays: normalized.periodDays,
    basis,
    inputDigest: interventionDigest(normalized),
  });
}

function result(normalized, fields) {
  return Object.freeze({
    version: DEPARTMENT_INTERVENTION_VERSION,
    department: Object.freeze({
      id: normalized.departmentId,
      label: normalized.departmentLabel,
    }),
    recommendation: null,
    candidates: Object.freeze([]),
    reason: null,
    redaction: Object.freeze({
      statement: INTERVENTION_REDACTION_STATEMENT,
      allowedInputFields: ALLOWED_INPUT_FIELDS,
    }),
    ...fields,
  });
}

const reason = (code, text) => Object.freeze({ code, text });

/**
 * The whole rule, in the order a skeptical reader would check it.
 *
 * @param {object} raw one department's aggregate record — the same shape the
 *   drill-down already holds. Extra keys are dropped, not read.
 * @returns a frozen result carrying exactly one of: a recommendation, a named
 *   ambiguity, a named evidence shortfall, or a hold.
 */
export function scoreDepartmentIntervention(raw = {}) {
  const normalized = normalizeInterventionInput(raw);
  const basis = "aggregate category counts and department spend";

  // 1. Is there a sample at all?
  if (normalized.sampling.status !== SAMPLING_AVAILABLE) {
    return result(normalized, {
      outcome: INTERVENTION_OUTCOME.insufficientEvidence,
      provenance: provenanceOf(normalized, basis),
      reason: reason("sampling_unavailable",
        "No intervention is recommended: this department has no scored sample for the period, "
        + "so its category mix is not measured and any dollar figure would be invented."),
    });
  }

  // 2. Is the sample above the floor a grade already requires?
  if (normalized.sampling.sampledQueries < MIN_SCORED_PROMPTS_FOR_INTERVENTION) {
    const short = MIN_SCORED_PROMPTS_FOR_INTERVENTION - normalized.sampling.sampledQueries;
    return result(normalized, {
      outcome: INTERVENTION_OUTCOME.insufficientEvidence,
      provenance: provenanceOf(normalized, basis),
      reason: reason("sample_below_floor",
        `No intervention is recommended: ${normalized.sampling.sampledQueries} scored `
        + `prompt${normalized.sampling.sampledQueries === 1 ? "" : "s"} is ${short} short of the `
        + `${MIN_SCORED_PROMPTS_FOR_INTERVENTION} this scorer shares with the grading floor.`),
    });
  }

  // 3. Is there spend for an intervention to recover?
  if (normalized.monthlySpendUsd <= 0) {
    return result(normalized, {
      outcome: INTERVENTION_OUTCOME.insufficientEvidence,
      provenance: provenanceOf(normalized, basis),
      reason: reason("no_spend",
        "No intervention is recommended: this department reports no AI spend for the period, "
        + "so there is no recoverable value to rank interventions by."),
    });
  }

  const candidates = INTERVENTION_WEIGHTS.map((weight) => candidateFor(weight, normalized));
  const provenance = provenanceOf(normalized, basis);

  // 4. Rank. Only a candidate with a point estimate can lead; a candidate whose
  //    addressable share is unknown can still *block* a leader with its ceiling.
  const determined = candidates.filter((candidate) => candidate.determined && candidate.valueUsd > 0);
  const ranked = [...determined].sort((first, second) => (
    second.valueUsd - first.valueUsd || compareKind(first, second)
  ));
  const leader = ranked[0] ?? null;

  if (!leader) {
    return result(normalized, {
      outcome: INTERVENTION_OUTCOME.hold,
      candidates: Object.freeze(candidates),
      provenance,
      reason: reason("no_recoverable_spend",
        `Hold: no category in ${normalized.departmentLabel}'s mix carries recoverable spend, `
        + "so there is nothing for an intervention to recover."),
    });
  }

  // 5. Is the winner worth a manager's time? Asked before the tie-break,
  //    deliberately: whether two sub-threshold candidates are separated is a
  //    question about numbers nobody should act on either way.
  if (leader.valueUsd < MIN_MATERIAL_MONTHLY_USD) {
    return result(normalized, {
      outcome: INTERVENTION_OUTCOME.hold,
      candidates: Object.freeze(candidates),
      provenance,
      reason: reason("below_material_threshold",
        `Hold: the best available intervention is worth ${formatUsd0(leader.valueUsd)}/month, `
        + `below the ${formatUsd0(MIN_MATERIAL_MONTHLY_USD)} floor at which scheduling one `
        + "returns more than it costs to run."),
    });
  }

  // The strongest case any rival can make, given what is measured and what is not.
  const rivalCeiling = candidates
    .filter((candidate) => candidate.kind !== leader.kind)
    .reduce((highest, candidate) => Math.max(highest, candidate.blockingUsd), 0);
  const contenders = candidates
    .filter((candidate) => candidate.kind !== leader.kind
      && candidate.blockingUsd >= leader.valueUsd - requiredMargin(leader.valueUsd))
    .map((candidate) => candidate.kind);

  // 6. Is the leader separated from every rival by more than the margin?
  if (contenders.length > 0) {
    const named = [leader.kind, ...contenders];
    return result(normalized, {
      outcome: INTERVENTION_OUTCOME.ambiguous,
      candidates: Object.freeze(candidates),
      provenance,
      reason: reason("candidates_not_separated",
        `No single intervention is prioritized: ${named.length} candidates `
        + `(${named.join(", ")}) sit within ${formatUsd0(requiredMargin(leader.valueUsd))}/month `
        + "of the leader, inside this scorer's decision margin. Do not choose between "
        + "them from this result; resolve any missing pattern signal, then compare the "
        + "interventions' operating cost and reversibility."),
    });
  }

  const factors = Object.freeze([
    sampleFactor(normalized.sampling.sampledQueries),
    separationFactor(leader.valueUsd, rivalCeiling),
    completenessFactor(normalized.patterns),
  ]);

  return result(normalized, {
    outcome: INTERVENTION_OUTCOME.recommended,
    candidates: Object.freeze(candidates),
    provenance,
    recommendation: Object.freeze({
      kind: leader.kind,
      title: leader.label,
      action: leader.action,
      estimatedMonthlyValueUsd: leader.valueUsd,
      confidence: Object.freeze({
        // The weakest factor, not an average: a 5,000-prompt sample cannot rescue
        // a near-tie, and saying "high" because two of three factors were high is
        // how an unexplainable number reaches an executive view.
        level: weakest(factors.map((factor) => factor.level)),
        factors,
      }),
      rationale: Object.freeze({
        patternKey: leader.categoryKey,
        patternLabel: leader.patternLabel,
        categoryLabel: leader.categoryLabel,
        shareOfScoredPrompts: leader.categoryShare,
        text: `${pct(leader.categoryShare)} of ${normalized.departmentLabel}'s scored prompts `
          + `are ${leader.patternLabel}. ${leader.action}`,
        arithmetic: leader.arithmetic,
        assumptions: Object.freeze([leader.assumption]),
      }),
    }),
  });
}

/** Stable order for a dollar-exact tie: the weight table's own order. */
function compareKind(first, second) {
  const order = INTERVENTION_WEIGHTS.map((weight) => weight.kind);
  return order.indexOf(first.kind) - order.indexOf(second.kind);
}
