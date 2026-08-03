// The versioned FinOps briefing contract.
//
// THE ONE QUESTION
// ----------------
// A briefing answers exactly one question:
//
//   "Is our AI spend justified by what it produced, and what should we do
//    about it next?"
//
// Everything in this contract serves that question. A field that does not help
// a leader answer it does not have a slot here, and a slot that could only be
// filled by quoting a visitor's own content stays absent — the briefing never
// quotes to fill a hole.
//
// WHAT THIS MODULE IS AND IS NOT
// ------------------------------
// It is pure selection: an analysis envelope in, a briefing object out. There
// is no DOM, no fetch, no storage, no clock, and no formatting. Rendering a
// figure as "$5,200.00" is a view decision and lives in the view layer; this
// module emits `{ value: 5200, unit: "USD" }` and stops.
//
// It is deliberately *not* a second source of truth. The month-over-month
// arithmetic is `leadingFinding()`, unchanged; the routing scenario and its
// rule version are `down-routing-candidates.js`, unchanged; the record set is
// the analysis envelope's own `quality` counts, which is the same record set
// the JSON export ships. Nothing below recomputes any of those from raw input.
//
// FORKING IS THE FAILURE MODE THIS FILE EXISTS TO PREVENT
// ------------------------------------------------------
// Export, print render, re-open, and reproducibility all read the same three
// above-the-fold slots. If each one selects them for itself, four surfaces
// drift and a leader is shown four different "the" figures. So: consumers
// import `CONTRACT_VERSION` and `buildFinopsBriefing`, and every emitted
// artifact records the version it was built against.
//
// DELIBERATE OMISSIONS
// --------------------
// * No second metric. Two figures above the fold makes the reader decide which
//   one matters; deciding that is the briefing's whole job, and it already did
//   it in `selectMaterialMetric`.
// * No per-record detail, no chart series, no trend history, no cohort. Those
//   answer other questions and belong to other surfaces.
// * No "partially guessed" state. A slot is computed from available aggregates
//   or it is absent with a machine-readable reason.

import { leadingFinding } from "./finops-leading-finding.js";
import { DOWN_ROUTING_RULE_VERSION } from "./down-routing-candidates.js";

/**
 * Bump this when any slot's meaning, any enum value, or any threshold below
 * changes. Every consumer records the version it read.
 */
export const CONTRACT_VERSION = "finops-briefing/1.0.0";

// ---------------------------------------------------------------------------
// headlineQuestion — derived from the analysis type, never free-typed.
// ---------------------------------------------------------------------------

/**
 * One question per analysis type. There is exactly one analysis type today and
 * therefore exactly one question; the map exists so a second analysis type has
 * to declare its own question rather than inherit this one by accident.
 */
export const HEADLINE_QUESTION = Object.freeze({
  "local-finops/1.0.0":
    "Is our AI spend justified by what it produced, and what should we do about it next?",
  "local-finops-history/1.0.0":
    "Is our AI spend justified by what it produced, and what should we do about it next?",
});

/** The question a briefing carries when the analysis type is unknown or absent. */
export const DEFAULT_HEADLINE_QUESTION =
  "Is our AI spend justified by what it produced, and what should we do about it next?";

export function questionForAnalysis(schemaVersion) {
  return HEADLINE_QUESTION[schemaVersion] ?? DEFAULT_HEADLINE_QUESTION;
}

// ---------------------------------------------------------------------------
// coverage — an enum with numeric rules, not a free-form score.
// ---------------------------------------------------------------------------

/**
 * The coverage ratio each confidence level requires. Stated here as data, not
 * in a comment, so a consumer can read the rule as well as apply it.
 *
 *   high        ratio >= 0.90 AND every required input was present
 *   moderate    ratio >= 0.60
 *   low         ratio  > 0
 *   insufficient ratio === 0 (including the zero-denominator case)
 *
 * `high` is the only level that also requires complete inputs: a briefing may
 * cover 95% of the records and still be missing the figure that sizes the
 * action, and calling that "high" would be a claim about the wrong thing.
 */
export const COVERAGE_THRESHOLDS = Object.freeze({
  high: 0.9,
  moderate: 0.6,
  low: 0,
});

export const BRIEFING_CONFIDENCE = Object.freeze({
  high: "high",
  moderate: "moderate",
  low: "low",
  insufficient: "insufficient",
});

/**
 * The inputs a complete briefing needs. Named as aggregates, so a missing-input
 * list can be rendered and exported without naming anything of the reader's.
 */
export const REQUIRED_INPUTS = Object.freeze([
  "analyzed_spend_usd",
  "recoverable_scenario_usd",
  "ranked_departments",
  "provider_completeness",
]);

/**
 * `recordsAnalyzed / recordsTotal`, with 0/0 defined as **0**.
 *
 * A briefing with no records has covered nothing. Defining the empty case as 1
 * would let an import that joined nothing claim full coverage, and defining it
 * as null would push the decision onto every consumer.
 */
export function coverageRatio(recordsAnalyzed, recordsTotal) {
  if (!Number.isFinite(recordsTotal) || recordsTotal <= 0) return 0;
  if (!Number.isFinite(recordsAnalyzed) || recordsAnalyzed <= 0) return 0;
  return recordsAnalyzed / recordsTotal;
}

function coverageConfidence(ratio, missingInputs = []) {
  if (!(ratio > COVERAGE_THRESHOLDS.low)) return BRIEFING_CONFIDENCE.insufficient;
  if (ratio >= COVERAGE_THRESHOLDS.high && missingInputs.length === 0) {
    return BRIEFING_CONFIDENCE.high;
  }
  if (ratio >= COVERAGE_THRESHOLDS.moderate) return BRIEFING_CONFIDENCE.moderate;
  return BRIEFING_CONFIDENCE.low;
}

// ---------------------------------------------------------------------------
// Input provenance — was this brief supplied, or did we work it out ourselves?
// ---------------------------------------------------------------------------
//
// Coverage answers "how many records did we read?". It cannot answer "how much
// of what you are reading did you give us?", and until now the grade treated a
// number the finance lead can point at in their own bill exactly like a number
// this build modelled. Those are not the same evidence, and a director disputing
// the letter is entitled to see which of the two they are arguing with.
//
// THE RULE, IN ONE LINE. Confidence is the coverage level, CAPPED by the input
// mix: each required input scores 100 supplied, 60 derived, 0 missing; if that
// average falls below 90 the brief may not publish "high".
//
// The cap only ever lowers. Coverage and provenance are two independent gates on
// the same letter and passing one does not excuse the other, so a brief made
// entirely of supplied inputs keeps exactly the letter it had before this rule
// existed — the score is then 100, the ceiling is `high`, and the cap is a
// no-op. Every existing all-supplied briefing is therefore unchanged by
// construction, not by coincidence.
//
// DETERMINISM. Every term is an integer count of a fixed-length, fixed-order
// list (`REQUIRED_INPUTS`), the weights are integers, and the score is one
// truncated integer division. No clock, no randomness, no object iteration, and
// no float accumulation whose order could move a boundary.

export const INPUT_PROVENANCE = Object.freeze({
  /** Present verbatim in the source export, or entered by the reader. */
  supplied: "supplied",
  /** Computed, inferred, defaulted, or carried over from another field. */
  derived: "derived",
  /** Absent, with no derivation available. */
  missing: "missing",
});

/**
 * What one input contributes to the provenance score, out of 100.
 *
 * EVERY WEIGHT CARRIES THE ASSUMPTION IT RESTS ON. A director who disputes the
 * confidence disputes one of these three lines, and each says what it assumes
 * rather than only what it costs.
 */
export const PROVENANCE_WEIGHT = Object.freeze({
  // 100 — ASSUMES a value the reader can point at in their own file needs no
  // assumption of ours to be believed. It is the reference the other two are
  // discounted against, so an all-supplied brief scores exactly 100 and is
  // capped at nothing.
  supplied: 100,
  // 60 — ASSUMES a derived value is still evidence, because the rule that
  // produced it is published and re-checkable ("check the math" re-runs it), and
  // ASSUMES it is weaker evidence than a supplied one, because it is this
  // build's arithmetic rather than a number in the reader's bill. 60 is not a
  // tuned constant: it is `COVERAGE_THRESHOLDS.moderate` on the same 0–100
  // scale, so a brief that is mostly derived lands where a brief that is mostly
  // uncovered lands.
  derived: 60,
  // 0 — ASSUMES a missing input contributes no evidence: there is nothing to
  // re-check and nothing to reproduce. Deliberately not negative, which would
  // assume a missing input makes the inputs that ARE present less true.
  missing: 0,
});

/**
 * The score a brief must reach before it may publish "high" confidence.
 *
 * Not a new constant either: it is `COVERAGE_THRESHOLDS.high` expressed on the
 * 0–100 scale, rounded to an integer so the comparison is integer-to-integer and
 * cannot be moved by float representation. The assumption is that the bar for
 * "how much of this was yours" should be the same bar this contract already sets
 * for "how many of your records did we read".
 */
export const PROVENANCE_HIGH_FLOOR = Math.round(COVERAGE_THRESHOLDS.high * 100);

/**
 * The floor of the cap. Provenance can cost a brief the top level and no more:
 * `low` and `insufficient` are statements about record coverage, and the input
 * mix has measured nothing about that.
 */
export const PROVENANCE_CEILING_FLOOR = BRIEFING_CONFIDENCE.moderate;

/** Worst to best. Capping is `min` over this order, so it can only lower. */
const CONFIDENCE_ORDER = Object.freeze([
  BRIEFING_CONFIDENCE.insufficient, BRIEFING_CONFIDENCE.low,
  BRIEFING_CONFIDENCE.moderate, BRIEFING_CONFIDENCE.high,
]);

/**
 * Classify one required input against the analysis envelope.
 *
 * Each branch states the evidence it reads, because "which fields were derived?"
 * is answerable only if every answer names the field it was decided from.
 */
function provenanceOf(input, result) {
  const quality = result?.quality ?? {};
  if (input === "analyzed_spend_usd") {
    // Supplied: the money column is in the provider export. Totalling a column
    // the file already carries restates the reader's own money; it introduces no
    // assumption they could dispute.
    return Number.isFinite(Number(result?.spendUsd))
      ? INPUT_PROVENANCE.supplied : INPUT_PROVENANCE.missing;
  }
  if (input === "recoverable_scenario_usd") {
    // Always derived when present. It is a routing scenario priced by this
    // build's rubric against reference rates — never a number in anyone's bill,
    // so there is no envelope shape that would make it supplied.
    return Number.isFinite(Number(result?.recoverableUsd))
      ? INPUT_PROVENANCE.derived : INPUT_PROVENANCE.missing;
  }
  if (input === "ranked_departments") {
    if (!(result?.rankedDepartments?.length > 0)) return INPUT_PROVENANCE.missing;
    // An org file read means the reader supplied the unit identities. Without
    // one the units are the export's own billing key regrouped and labelled
    // here, which is an org structure inferred from a field that was never an
    // org structure — derived, and the one a plain billing export hits.
    return quality.hrisCompleteness == null
      ? INPUT_PROVENANCE.derived : INPUT_PROVENANCE.supplied;
  }
  // provider_completeness — declared by the export's own snapshot, so it is the
  // provider's statement about their file rather than ours about their file.
  return quality.providerCompleteness ? INPUT_PROVENANCE.supplied : INPUT_PROVENANCE.missing;
}

/**
 * The input mix behind one brief, as data rather than as a number.
 *
 * `derived` and `missing` are name lists so a reader — or a test — can ask which
 * fields were derived and get the answer back, instead of being handed a score
 * and asked to trust it. Every name is a `REQUIRED_INPUTS` member, which is
 * repository-authored: no export field name, label, or cell value reaches this
 * object, so nothing here can carry a reader's content onward.
 */
export function briefInputProvenance(result) {
  const inputs = REQUIRED_INPUTS.map((name) => Object.freeze({ name, state: provenanceOf(name, result) }));
  const count = (state) => inputs.filter((input) => input.state === state).length;
  const supplied = count(INPUT_PROVENANCE.supplied);
  const derived = count(INPUT_PROVENANCE.derived);
  const missing = count(INPUT_PROVENANCE.missing);
  const total = inputs.length;
  // Integer arithmetic over integer counts: same inputs, same score, always.
  const score = total === 0 ? PROVENANCE_WEIGHT.supplied : Math.trunc(
    (supplied * PROVENANCE_WEIGHT.supplied
      + derived * PROVENANCE_WEIGHT.derived
      + missing * PROVENANCE_WEIGHT.missing) / total,
  );
  return Object.freeze({
    inputs: Object.freeze(inputs),
    total,
    suppliedCount: supplied,
    derivedCount: derived,
    missingCount: missing,
    derived: Object.freeze(inputs.filter((input) => input.state === INPUT_PROVENANCE.derived)
      .map((input) => input.name)),
    missing: Object.freeze(inputs.filter((input) => input.state === INPUT_PROVENANCE.missing)
      .map((input) => input.name)),
    score,
    floor: PROVENANCE_HIGH_FLOOR,
    ceiling: score >= PROVENANCE_HIGH_FLOOR ? BRIEFING_CONFIDENCE.high : PROVENANCE_CEILING_FLOOR,
  });
}

/**
 * Names may only ever be `REQUIRED_INPUTS` members on the way to a reader or a
 * judge. The lists this module builds satisfy that by construction, but a brief
 * reopened from a file is untrusted input carrying a field name someone else
 * wrote — so anything unrecognised is replaced by a fixed placeholder rather
 * than echoed. A surface renders the return of this function, never its argument.
 */
export function redactInputNames(names) {
  return (Array.isArray(names) ? names : [])
    .map((name) => (REQUIRED_INPUTS.includes(name) ? name : "unnamed_input"));
}

/**
 * @param ratio the record coverage ratio.
 * @param missingInputs the required inputs this brief did not have.
 * @param provenance a `briefInputProvenance` object, or null for a brief that
 *   carries none — treated as all-supplied, so an older payload grades exactly
 *   as it did before this rule existed.
 */
export function confidenceFor(ratio, missingInputs = [], provenance = null) {
  const level = coverageConfidence(ratio, missingInputs);
  const ceiling = provenance?.ceiling;
  if (!CONFIDENCE_ORDER.includes(ceiling)) return level;
  return CONFIDENCE_ORDER.indexOf(ceiling) < CONFIDENCE_ORDER.indexOf(level) ? ceiling : level;
}

// ---------------------------------------------------------------------------
// Absence — machine-readable, with the statement authored once.
// ---------------------------------------------------------------------------

/**
 * Why a slot is absent. Downstream consumers render `ABSENCE_STATEMENT[reason]`
 * rather than inventing their own sentence, which is how the page, the export,
 * and a re-opened briefing say the same thing about the same hole.
 */
export const ABSENCE_REASON = Object.freeze({
  noAnalysis: "no_analysis",
  noAttributedSpend: "no_attributed_spend",
  attributionBelowFloor: "attribution_below_floor",
  noComparablePriorPeriod: "no_comparable_prior_period",
  noMovementToReport: "no_movement_to_report",
  noMaterialMetric: "no_material_metric",
  noRankedDepartment: "no_ranked_department",
  actionDoesNotNameDriver: "action_does_not_name_driver",
});

export const ABSENCE_STATEMENT = Object.freeze({
  [ABSENCE_REASON.noAnalysis]:
    "No analysis has been computed, so there is no figure to show. Import a provider export to compute one.",
  [ABSENCE_REASON.noAttributedSpend]:
    "No provider spend joined an org unit, so no figure can be computed from this import.",
  [ABSENCE_REASON.attributionBelowFloor]:
    "Too little of this spend is attributed to name a figure, so none is shown.",
  [ABSENCE_REASON.noComparablePriorPeriod]:
    "Only one provider period was analyzed, so no change against a prior period can be computed.",
  [ABSENCE_REASON.noMovementToReport]:
    "Every candidate figure computes to zero, so this analysis has no material figure to report.",
  [ABSENCE_REASON.noMaterialMetric]:
    "This analysis is insufficient to prioritize an action: no material figure could be computed to size one.",
  [ABSENCE_REASON.noRankedDepartment]:
    "This analysis is insufficient to prioritize an action: no department was ranked from the joined records.",
  [ABSENCE_REASON.actionDoesNotNameDriver]:
    "This analysis is insufficient to prioritize an action: the highest-ranked recommendation names a department "
    + "other than the driver of the change.",
});

// ---------------------------------------------------------------------------
// materialMetric — exactly one figure, chosen by a total order.
// ---------------------------------------------------------------------------

/**
 * "Material" means: the single figure that, if it moved, would change the
 * recommended action.
 *
 * Two candidates qualify against this analysis type, in this materiality order:
 *
 *   1. `recoverable_scenario` — the routing scenario for the reporting period.
 *      The rank-1 action *is* sized by this number (the pilot is capped at it),
 *      so a change in it changes the action directly.
 *   2. `spend_change` — the change against the prior period. It changes which
 *      department is the driver, and therefore which action is prioritized,
 *      but not the size of the action itself.
 *
 * SELECTION IS A TOTAL ORDER, so two engineers pick the same figure:
 *
 *   1. materiality rank ascending (the list above);
 *   2. then absolute value descending;
 *   3. then the longer period (exclusive end minus inclusive start) first;
 *   4. then candidate id ascending, which makes the order total.
 *
 * Steps 2–4 are the documented tie-break. They are reachable only if a future
 * candidate shares a materiality rank; they are implemented rather than
 * described because an unimplemented tie-break is a coin flip.
 */
export const MATERIAL_CANDIDATE = Object.freeze({
  recoverableScenario: "recoverable_scenario",
  spendChange: "spend_change",
});

const MATERIALITY_RANK = Object.freeze({
  [MATERIAL_CANDIDATE.recoverableScenario]: 1,
  [MATERIAL_CANDIDATE.spendChange]: 2,
});

/** "2026-06-01 to 2026-07-01" → inclusive start, exclusive end, as ISO-8601. */
export function periodFromEnvelopeString(period) {
  const match = /^(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})$/.exec(String(period ?? "").trim());
  if (!match) return null;
  // The provider contract's snapshot dates form a half-open period, so the end
  // date is already exclusive and is carried through as such.
  return Object.freeze({ start: `${match[1]}T00:00:00Z`, end: `${match[2]}T00:00:00Z` });
}

function periodLengthMs(period) {
  if (!period) return 0;
  const start = Date.parse(period.start);
  const end = Date.parse(period.end);
  return Number.isFinite(start) && Number.isFinite(end) ? end - start : 0;
}

/**
 * Both candidates, each either eligible with its figure and arithmetic, or
 * ineligible with the reason it is.
 */
function materialCandidates(result, { attributionWithheld }) {
  const period = periodFromEnvelopeString(result?.period);
  const ranked = Array.isArray(result?.rankedDepartments) ? result.rankedDepartments : [];
  const analyzedSpendUsd = Number(result?.spendUsd);
  const recoverableUsd = Number(result?.recoverableUsd);

  let recoverable;
  if (attributionWithheld) {
    recoverable = { id: MATERIAL_CANDIDATE.recoverableScenario, reason: ABSENCE_REASON.attributionBelowFloor };
  } else if (!ranked.length || !Number.isFinite(recoverableUsd) || !Number.isFinite(analyzedSpendUsd) || !period) {
    recoverable = { id: MATERIAL_CANDIDATE.recoverableScenario, reason: ABSENCE_REASON.noAttributedSpend };
  } else if (recoverableUsd === 0) {
    recoverable = { id: MATERIAL_CANDIDATE.recoverableScenario, reason: ABSENCE_REASON.noMovementToReport };
  } else {
    recoverable = {
      id: MATERIAL_CANDIDATE.recoverableScenario,
      metric: {
        value: recoverableUsd,
        unit: "USD",
        period,
        label: "Recoverable AI spend in the reporting period (routing scenario, not a realized saving)",
      },
      arithmetic: {
        operation:
          "recoverable_scenario_usd = Σ(per-department routing scenario over ranked_departments); "
          + "recoverable_share = recoverable_scenario_usd ÷ analyzed_spend_usd",
        inputs: [
          { name: "analyzed_spend_usd", value: analyzedSpendUsd, unit: "USD" },
          { name: "recoverable_scenario_usd", value: recoverableUsd, unit: "USD" },
          { name: "ranked_departments", value: ranked.length, unit: "count" },
        ],
      },
    };
  }

  const finding = leadingFinding(result);
  let change;
  if (!finding.available || !Number.isFinite(finding.changeUsd)) {
    change = { id: MATERIAL_CANDIDATE.spendChange, reason: ABSENCE_REASON.noComparablePriorPeriod };
  } else if (finding.changeUsd === 0) {
    change = { id: MATERIAL_CANDIDATE.spendChange, reason: ABSENCE_REASON.noMovementToReport };
  } else {
    change = {
      id: MATERIAL_CANDIDATE.spendChange,
      metric: {
        value: finding.changeUsd,
        unit: "USD",
        period: periodFromEnvelopeString(finding.reportingPeriod),
        label: "Change in analyzed AI spend against the immediately preceding period",
      },
      arithmetic: {
        operation: "spend_change_usd = reporting_period_spend_usd − prior_period_spend_usd",
        inputs: [
          { name: "reporting_period_spend_usd", value: finding.totalSpendUsd, unit: "USD" },
          { name: "prior_period_spend_usd", value: finding.priorTotalSpendUsd, unit: "USD" },
        ],
      },
    };
  }
  return { candidates: [recoverable, change], finding };
}

/**
 * The one figure, or the reason there is none.
 *
 * When no candidate is eligible the reported reason is the highest-ranked
 * candidate's, skipping `no_movement_to_report` — "everything computed to zero"
 * is only the honest answer when it is the answer for every candidate, and a
 * missing prior period tells the reader more than a zero does.
 */
export function selectMaterialMetric(candidates) {
  const eligible = candidates.filter((candidate) => candidate.metric);
  if (eligible.length) {
    eligible.sort((left, right) =>
      MATERIALITY_RANK[left.id] - MATERIALITY_RANK[right.id]
      || Math.abs(right.metric.value) - Math.abs(left.metric.value)
      || periodLengthMs(right.metric.period) - periodLengthMs(left.metric.period)
      || left.id.localeCompare(right.id));
    return { chosen: eligible[0], reason: null };
  }
  const informative = candidates.find((candidate) => candidate.reason !== ABSENCE_REASON.noMovementToReport);
  return { chosen: null, reason: (informative ?? candidates[0])?.reason ?? ABSENCE_REASON.noAnalysis };
}

// ---------------------------------------------------------------------------
// rankedAction — one action, one rank, one accountable role.
// ---------------------------------------------------------------------------

/**
 * The role accountable for each kind of action. A role, never a person: this
 * briefing is built in a browser that has no roster of people in it, and a
 * named individual in an executive artifact is an identifier, not a decision.
 */
export const ACCOUNTABLE_ROLE = Object.freeze({
  routing_pilot: "Platform Engineering Lead",
  data_quality: "FinOps Data Owner",
});

/**
 * Which kind of action the envelope produced, decided from the aggregate that
 * produced it rather than by matching the action's own prose.
 */
function actionKind(result) {
  return Number(result?.topDepartment?.recoverableUsd) > 0 ? "routing_pilot" : "data_quality";
}

// ---------------------------------------------------------------------------
// Forbidden content. Enforced, not merely documented.
// ---------------------------------------------------------------------------

/**
 * Field names a briefing may never carry, matched against a lowercased,
 * punctuation-stripped form of the key so `prompt_text`, `promptText`, and
 * `PromptText` are all the same field.
 */
export const FORBIDDEN_FIELD_PATTERN =
  /(prompt|excerpt|transcript|conversation|messagebody|rawcontent|completion|email|firstname|lastname|fullname|username|displayname|personname|accountid|customerid|userid|ipaddress|apikey|accesstoken|bearertoken|credential|password|secret|authorization)/;

/** Value shapes that are a leak wherever they appear, whatever the key is called. */
export const FORBIDDEN_VALUE_PATTERNS = Object.freeze([
  { code: "email_address", pattern: /[\w.+-]+@[\w-]+\.[\w.-]+/ },
  { code: "ip_address", pattern: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/ },
  { code: "bearer_token", pattern: /\b(?:bearer\s+[\w.-]{12,}|sk-[A-Za-z0-9]{12,}|ghp_[A-Za-z0-9]{20,})/i },
]);

/**
 * The longest string any slot may hold. A briefing is aggregates and authored
 * sentences; anything longer than this is prose, and prose in a briefing is how
 * a visitor's own words arrive in an executive artifact.
 */
export const MAX_STRING_LENGTH = 400;

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function walk(value, path, violations) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, violations));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const here = path ? `${path}.${key}` : key;
      if (FORBIDDEN_FIELD_PATTERN.test(normalizeKey(key))) {
        violations.push({ path: here, code: "forbidden_field", detail: key });
      }
      walk(child, here, violations);
    }
    return;
  }
  if (typeof value !== "string") return;
  if (value.length > MAX_STRING_LENGTH) {
    violations.push({ path, code: "free_form_text", detail: `${value.length} characters` });
  }
  for (const { code, pattern } of FORBIDDEN_VALUE_PATTERNS) {
    if (pattern.test(value)) violations.push({ path, code, detail: code });
  }
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/**
 * Reject a briefing that is malformed or that carries forbidden content.
 *
 * @returns `{ valid, violations: [{ path, code, detail }] }`. Total: it never
 *   throws, because a validator that throws is one a consumer skips.
 */
export function validateBriefing(briefing) {
  const violations = [];
  const fail = (path, code, detail = "") => violations.push({ path, code, detail });
  if (!briefing || typeof briefing !== "object" || Array.isArray(briefing)) {
    return Object.freeze({ valid: false, violations: Object.freeze([{ path: "", code: "not_an_object", detail: "" }]) });
  }
  if (briefing.contractVersion !== CONTRACT_VERSION) {
    fail("contractVersion", "wrong_contract_version", String(briefing.contractVersion));
  }
  if (typeof briefing.headlineQuestion !== "string" || !briefing.headlineQuestion.trim().endsWith("?")) {
    fail("headlineQuestion", "missing_question");
  }
  if (typeof briefing.rubricVersion !== "string" || !briefing.rubricVersion) {
    fail("rubricVersion", "missing_rubric_version");
  }
  const { provenance } = briefing;
  if (!provenance || provenance.displayOnly !== true || typeof provenance.text !== "string"
    || !/client|browser|this tab/i.test(provenance.text)) {
    fail("provenance", "missing_client_side_provenance");
  }

  const { coverage } = briefing;
  if (!coverage || typeof coverage !== "object") {
    fail("coverage", "coverage_absent");
  } else {
    if (!Number.isInteger(coverage.recordsAnalyzed) || coverage.recordsAnalyzed < 0) {
      fail("coverage.recordsAnalyzed", "not_a_record_count");
    }
    if (!Number.isInteger(coverage.recordsTotal) || coverage.recordsTotal < 0) {
      fail("coverage.recordsTotal", "not_a_record_count");
    }
    const expected = coverageRatio(coverage.recordsAnalyzed, coverage.recordsTotal);
    if (!Number.isFinite(coverage.coverageRatio) || Math.abs(coverage.coverageRatio - expected) > 1e-9) {
      fail("coverage.coverageRatio", "ratio_not_computed_from_counts", String(coverage.coverageRatio));
    }
    if (!Object.values(BRIEFING_CONFIDENCE).includes(coverage.confidence)) {
      fail("coverage.confidence", "confidence_not_in_enum", String(coverage.confidence));
      // Checked against the brief's OWN provenance, not a re-classification: a
      // validator that re-derives the mix would pass a payload whose stated mix
      // disagrees with the confidence printed beside it.
    } else if (coverage.confidence
      !== confidenceFor(expected, coverage.missingInputs ?? [], coverage.provenance ?? null)) {
      fail("coverage.confidence", "confidence_contradicts_thresholds", String(coverage.confidence));
    }
  }

  const metric = briefing.materialMetric;
  if (metric !== null && metric !== undefined) {
    if (!Number.isFinite(metric.value)) fail("materialMetric.value", "not_a_number");
    if (typeof metric.unit !== "string" || !metric.unit) fail("materialMetric.unit", "missing_unit");
    if (typeof metric.label !== "string" || !metric.label) fail("materialMetric.label", "missing_label");
    const period = metric.period;
    if (!period || !ISO_TIMESTAMP.test(String(period.start)) || !ISO_TIMESTAMP.test(String(period.end))) {
      fail("materialMetric.period", "period_not_iso_8601");
    } else if (!(Date.parse(period.start) < Date.parse(period.end))) {
      fail("materialMetric.period", "period_end_not_after_start");
    }
    if (!briefing.arithmeticInputs?.operation || !Array.isArray(briefing.arithmeticInputs?.inputs)
      || !briefing.arithmeticInputs.inputs.length) {
      fail("arithmeticInputs", "figure_without_arithmetic");
    } else if (briefing.arithmeticInputs.inputs.some((input) => !Number.isFinite(input?.value))) {
      fail("arithmeticInputs.inputs", "non_aggregate_input");
    }
  } else if (!ABSENCE_STATEMENT[briefing.absent?.materialMetric?.reason]) {
    fail("absent.materialMetric", "absent_slot_without_reason");
  }

  const action = briefing.rankedAction;
  if (action !== null && action !== undefined) {
    if (typeof action.action !== "string" || !action.action.trim()) fail("rankedAction.action", "missing_action");
    if (!Number.isInteger(action.rank) || action.rank < 1) fail("rankedAction.rank", "rank_not_1_based");
    if (!Object.values(ACCOUNTABLE_ROLE).includes(action.accountableRole)) {
      fail("rankedAction.accountableRole", "role_not_in_table", String(action.accountableRole));
    }
  } else if (!ABSENCE_STATEMENT[briefing.absent?.rankedAction?.reason]) {
    fail("absent.rankedAction", "absent_slot_without_reason");
  }

  walk(briefing, "", violations);
  return Object.freeze({ valid: violations.length === 0, violations: Object.freeze(violations) });
}

// ---------------------------------------------------------------------------
// The briefing itself.
// ---------------------------------------------------------------------------

export const CLIENT_SIDE_PROVENANCE =
  "This analysis ran in your browser. No prompt, conversation content, or file left this tab; "
  + "nothing was uploaded. Derived monthly figures are stored only if you opted in to the local "
  + "workspace; otherwise nothing from this analysis remains after this page is closed.";

function absence(reason) {
  return Object.freeze({ reason, statement: ABSENCE_STATEMENT[reason] });
}

function coverageOf(result) {
  const quality = result?.quality ?? {};
  const analyzed = Number(quality.joinedRecords);
  const quarantined = Number(quality.quarantinedRecords);
  const recordsAnalyzed = Number.isFinite(analyzed) ? Math.max(0, Math.trunc(analyzed)) : 0;
  const recordsExcluded = Number.isFinite(quarantined) ? Math.max(0, Math.trunc(quarantined)) : 0;
  // Total is the record set the analysis was handed: what joined plus what it
  // set aside. It is the same set the JSON export ships, so a reader comparing
  // the two is comparing the same denominator.
  const recordsTotal = recordsAnalyzed + recordsExcluded;
  // One classification, two consumers. The missing list is the `missing` half of
  // the provenance rather than a second predicate beside it, so the sentence a
  // reader is shown and the list the confidence was computed from cannot drift.
  const provenance = briefInputProvenance(result);
  const missingInputs = [...provenance.missing];
  const ratio = coverageRatio(recordsAnalyzed, recordsTotal);
  return Object.freeze({
    recordsAnalyzed,
    recordsTotal,
    coverageRatio: ratio,
    confidence: confidenceFor(ratio, missingInputs, provenance),
    missingInputs: Object.freeze(missingInputs),
    provenance,
  });
}

/**
 * Select a briefing from an analysis envelope.
 *
 * @param result an envelope from `normalizeLocalFinops` or
 *   `normalizeLocalFinopsHistory`, or null when nothing has been analyzed.
 * @param options.attributionWithheld true when the attribution policy has
 *   already suppressed the money figure on screen. The briefing does not
 *   re-derive that decision; it honours it, because a figure the page withheld
 *   must not reappear in the briefing built from the same analysis.
 * @returns a frozen briefing. `headlineQuestion` and `coverage` are always
 *   present; `materialMetric` and `rankedAction` may be absent, and when they
 *   are, `absent[slot]` carries the reason enum and its authored statement.
 */
export function buildFinopsBriefing(result, { attributionWithheld = false } = {}) {
  const headlineQuestion = questionForAnalysis(result?.schemaVersion);
  const coverage = coverageOf(result);
  const base = {
    contractVersion: CONTRACT_VERSION,
    analysisSchemaVersion: result?.schemaVersion ?? null,
    headlineQuestion,
    coverage,
    rubricVersion: DOWN_ROUTING_RULE_VERSION,
    provenance: Object.freeze({ text: CLIENT_SIDE_PROVENANCE, displayOnly: true }),
  };

  if (!result || typeof result !== "object") {
    return Object.freeze({
      ...base,
      materialMetric: null,
      arithmeticInputs: null,
      rankedAction: null,
      absent: Object.freeze({
        materialMetric: absence(ABSENCE_REASON.noAnalysis),
        rankedAction: absence(ABSENCE_REASON.noMaterialMetric),
      }),
    });
  }

  const { candidates, finding } = materialCandidates(result, { attributionWithheld });
  const { chosen, reason } = selectMaterialMetric(candidates);

  let rankedAction = null;
  let actionReason = null;
  if (!chosen) {
    actionReason = ABSENCE_REASON.noMaterialMetric;
  } else if (!result.topDepartment || typeof result.action !== "string" || !result.action.trim()) {
    actionReason = ABSENCE_REASON.noRankedDepartment;
  } else if (chosen.id === MATERIAL_CANDIDATE.spendChange && !finding.action?.available) {
    // `leadingFinding` already decided whether the top-ranked recommendation
    // names the driver of the change. Deciding it again here is exactly the
    // fork this contract exists to prevent.
    actionReason = ABSENCE_REASON.actionDoesNotNameDriver;
  } else {
    rankedAction = Object.freeze({
      action: result.action,
      rank: 1,
      accountableRole: ACCOUNTABLE_ROLE[actionKind(result)],
    });
  }

  const absent = {};
  if (!chosen) absent.materialMetric = absence(reason);
  if (!rankedAction) absent.rankedAction = absence(actionReason);

  return Object.freeze({
    ...base,
    materialMetric: chosen ? Object.freeze({ ...chosen.metric, candidate: chosen.id }) : null,
    arithmeticInputs: chosen
      ? Object.freeze({
        operation: chosen.arithmetic.operation,
        inputs: Object.freeze(chosen.arithmetic.inputs.map((input) => Object.freeze({ ...input }))),
      })
      : null,
    rankedAction,
    absent: Object.freeze(absent),
  });
}

// ---------------------------------------------------------------------------
// The fixture: a complete briefing, built only from aggregate figures.
//
// Executable rather than prose, so a change to the contract that this object no
// longer satisfies fails a test instead of leaving a stale example in a comment.
// ---------------------------------------------------------------------------

export const BRIEFING_FIXTURE = Object.freeze({
  contractVersion: CONTRACT_VERSION,
  analysisSchemaVersion: "local-finops-history/1.0.0",
  headlineQuestion: DEFAULT_HEADLINE_QUESTION,
  materialMetric: Object.freeze({
    value: 5200,
    unit: "USD",
    period: Object.freeze({ start: "2026-06-01T00:00:00Z", end: "2026-07-01T00:00:00Z" }),
    label: "Recoverable AI spend in the reporting period (routing scenario, not a realized saving)",
    candidate: MATERIAL_CANDIDATE.recoverableScenario,
  }),
  arithmeticInputs: Object.freeze({
    operation:
      "recoverable_scenario_usd = Σ(per-department routing scenario over ranked_departments); "
      + "recoverable_share = recoverable_scenario_usd ÷ analyzed_spend_usd",
    inputs: Object.freeze([
      Object.freeze({ name: "analyzed_spend_usd", value: 7430, unit: "USD" }),
      Object.freeze({ name: "recoverable_scenario_usd", value: 5200, unit: "USD" }),
      Object.freeze({ name: "ranked_departments", value: 4, unit: "count" }),
    ]),
  }),
  coverage: Object.freeze({
    recordsAnalyzed: 760,
    recordsTotal: 800,
    coverageRatio: 0.95,
    confidence: BRIEFING_CONFIDENCE.high,
    missingInputs: Object.freeze([]),
  }),
  rankedAction: Object.freeze({
    action: "Pilot lower-cost routing for text-generation in the highest-spend org unit, "
      + "capped at 5200.00 USD, and verify against a like-for-like period.",
    rank: 1,
    accountableRole: ACCOUNTABLE_ROLE.routing_pilot,
  }),
  rubricVersion: DOWN_ROUTING_RULE_VERSION,
  provenance: Object.freeze({ text: CLIENT_SIDE_PROVENANCE, displayOnly: true }),
  absent: Object.freeze({}),
});
