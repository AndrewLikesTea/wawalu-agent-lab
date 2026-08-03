// The bundled example's ONE first action, derived once and read everywhere.
//
// THE DEFECT THIS CLOSES (#1020). With no provider export imported, the AI
// FinOps page held three regions that each answered "what do I do first?" and
// none of them agreed:
//
//   - the circulation decision block quoted a first action authored as a
//     sentence in the bundled seed, so no figure behind it was checkable;
//   - the "Where do I start this month?" evidence layer answered from an
//     unrelated invented journey fixture, naming a department and an amount
//     that appear nowhere in the analyzed spend the page reports;
//   - the "What do I do next, and what will tell me it worked?" evidence layer
//     answered "Nothing is retained in this browser yet", i.e. a dead end with
//     no step and no checkpoint at all.
//
// So the step is DERIVED here, from the same bundled dataset the rest of the
// page reports, and all three read this one record. Nothing is authored as a
// recommendation sentence in markup, and no journey record is invented to make
// an existing recommender answer.
//
// ---------------------------------------------------------------------------
// THE RULE, stated as an instruction rather than an intent
// ---------------------------------------------------------------------------
// candidates
//   Every `actionPlan.actions` entry with `isTopNextAction === true` — the
//   dataset's own declaration that this is its department's rank-1 action — a
//   named department, a named action, and a baseline carrying a finite numeric
//   value, a metric name and a unit. An entry missing any of those is not
//   ranked lower, it is not a candidate: a step whose figure cannot be quoted
//   is not a step a reader can act on.
//
// first_action
//   The candidate with the greatest `baseline.value`, i.e. the largest modelled
//   recoverable line in the example's action-baseline period. Ties break on
//   ascending `actionId`. The tiebreak is not cosmetic: without it a reordered
//   fixture changes the page's first action, and a recommendation that moves
//   when nothing moved is not a recommendation.
//
// checkpoint
//   The same action's `target` — its metric name, its value, its unit, its
//   comparison, and the period the target is measured over — read off the
//   record and never computed. A record with no readable target yields
//   `known: false` and says so; no date and no figure is invented.
//
// Every figure carries the unit and the period it was measured over, because a
// bare number in a recommendation is a number two readers will quote
// differently.
//
// HONESTY. Everything here describes what the EXAMPLE recommends. Nothing in
// this module may be phrased as the reader's own spend or as a realized saving:
// the figures are modelled, from invented records, and the sentences say so.
//
// Pure: no DOM, no storage, no clock, no network. The dataset arrives as an
// argument.

export const BUNDLED_NEXT_STEP_CONTRACT = "finops-bundled-next-step/1.0.0";

/**
 * Which records a next step was derived from. A NAMED state, resolved by
 * `nextStepDataState` and stamped on both regions, rather than truthiness on a
 * possibly-empty array: "imported but nothing readable in it" and "nothing
 * imported" produce very different sentences and must never collapse into one
 * silent fallback.
 */
export const NEXT_STEP_DATA_STATE = Object.freeze({
  bundledExample: "bundled_example",
  importedPeriods: "imported_periods",
  importedEmpty: "imported_empty",
});

const USD = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0,
});

const filled = (value) => typeof value === "string" && value.trim().length > 0;
const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));

/** A figure as words: the amount, its unit, and the period it was measured over. */
const amount = (value, unit) =>
  (unit === "USD" ? USD.format(value) : `${value} ${unit}`);

/** A trailing full stop, so a derived label can be dropped into a sentence. */
const clause = (sentence) => sentence.replace(/\s*\.\s*$/, "");

/** The period a `periodRef` names, from the dataset's own benchmark periods. */
function periodOf(plan, ref) {
  const found = (Array.isArray(plan?.benchmarkPeriods) ? plan.benchmarkPeriods : [])
    .find((period) => period?.periodId === ref);
  if (!isRecord(found) || !filled(found.label)) return null;
  return Object.freeze({
    id: found.periodId,
    label: found.label,
    start: filled(found.startDate) ? found.startDate : null,
    end: filled(found.endDate) ? found.endDate : null,
  });
}

const readable = (action) => isRecord(action)
  && action.isTopNextAction === true
  && filled(action.departmentName) && filled(action.action) && filled(action.actionId)
  && Number.isFinite(action.baseline?.value)
  && filled(action.baseline?.metricName) && filled(action.baseline?.unit);

/**
 * The checkpoint the example's step will be judged by, read off the record.
 *
 * The shape is `verificationCheckpoint`'s — `{known, due, expected, source,
 * note}` — so the journey view paints it with no branch of its own, plus the
 * metric name and period a reader needs to repeat the measurement.
 */
function checkpointOf(plan, action) {
  const target = isRecord(action?.target) ? action.target : null;
  const period = periodOf(plan, target?.periodRef);
  if (!target || !Number.isFinite(target.value) || !filled(target.metricName)
    || !filled(target.unit) || !period) {
    return Object.freeze({
      known: false,
      metricName: filled(target?.metricName) ? target.metricName : null,
      period: null,
      due: null,
      expected: null,
      source: null,
      note: "The bundled example records no measurable target for this step, so it schedules "
        + "no checkpoint. No date and no figure is invented in its place.",
    });
  }
  const expected = amount(target.value, target.unit);
  return Object.freeze({
    known: true,
    metricName: target.metricName,
    period: period.label,
    due: period.end,
    expected,
    source: `bundled example action ${action.actionId}`,
    note: `Re-measure ${target.metricName} for ${action.departmentName} over ${period.label}`
      + ` (through ${period.end}). The example treats its step as having worked when that`
      + ` figure is ${expected} or less. A modelled target on invented records, not a`
      + " realized saving.",
  });
}

/**
 * The bundled example's first action, as one structured recommendation.
 *
 * @param dataset the parsed bundled example dataset (`evolution-demo-data.json`
 *   shape): `actionPlan.actions` plus `actionPlan.benchmarkPeriods`.
 * @returns a frozen `finops-bundled-next-step/1.0.0` record, or null when the
 *   dataset carries no candidate this rule can rank. Null is the honest answer:
 *   the caller says so rather than painting a step nothing derived.
 */
export function bundledFirstAction(dataset) {
  const plan = isRecord(dataset?.actionPlan) ? dataset.actionPlan : null;
  const candidates = (Array.isArray(plan?.actions) ? plan.actions : []).filter(readable);
  if (!candidates.length) return null;
  const ranked = [...candidates].sort((left, right) =>
    right.baseline.value - left.baseline.value || left.actionId.localeCompare(right.actionId));
  const first = ranked[0];
  const period = periodOf(plan, first.baseline.periodRef);
  const figureText = amount(first.baseline.value, first.baseline.unit);
  return Object.freeze({
    contract: BUNDLED_NEXT_STEP_CONTRACT,
    state: NEXT_STEP_DATA_STATE.bundledExample,
    actionId: first.actionId,
    department: first.departmentName,
    accountableRole: filled(first.accountableRole) ? first.accountableRole : null,
    action: clause(first.action),
    figure: Object.freeze({
      metricName: first.baseline.metricName,
      value: first.baseline.value,
      unit: first.baseline.unit,
      currency: first.baseline.unit === "USD" ? "USD" : null,
      text: figureText,
      period: period?.label ?? null,
    }),
    rank: Object.freeze({ outranked: ranked.length - 1, rule: RANKING_RULE }),
    checkpoint: checkpointOf(plan, first),
    // The three sentences every surface draws from. Composed here so the page
    // cannot state the step three ways, and phrased throughout as what the
    // EXAMPLE recommends — never as the reader's spend, never as money saved.
    headline: `The bundled example's largest modelled recoverable line is ${first.departmentName}`
      + ` at ${figureText} of ${first.baseline.metricName}`
      + `${period ? ` over ${period.label}` : ""}, so the example recommends starting there.`,
    actionText: `${clause(first.action)} in ${first.departmentName}`,
    rationale: `Ranked first of ${ranked.length} example departments by ${first.baseline.metricName}`
      + ` in the example's baseline period. Invented records for an invented company: a modelled`
      + ` recoverable figure, not your spend and not a realized saving.`,
  });
}

/** The ranking rule, exported so a test pins the rule rather than a reading of it. */
export const RANKING_RULE = "Ranked by the example's own rank-1 department actions, descending by"
  + " baseline recoverable value, then ascending by action id.";

/**
 * The circulation decision block's first action, from the same record.
 *
 * The circulation block, the "where do I start" evidence layer and the journey
 * evidence layer all state one first action, so one function composes it. A
 * dataset with no rankable candidate returns null and the block falls back to
 * whatever the dataset authored, rather than this module inventing a sentence.
 */
export function bundledFirstActionSentence(recommendation) {
  if (!recommendation) return null;
  const { department, action, figure } = recommendation;
  return `First, in ${department}: ${clause(action).toLowerCase()}.`
    + ` The bundled example ranks it first on ${figure.text} of ${figure.metricName}`
    + `${figure.period ? ` over ${figure.period}` : ""} — a modelled figure from invented`
    + " records, not realized savings.";
}

/**
 * The same dataset with its circulation action replaced by the derived one, so
 * the page's build-time seed and its runtime paint read one source.
 *
 * Returns the record unchanged when nothing could be derived: a block that has
 * always stated an action must not lose it to a dataset shape this rule cannot
 * read.
 */
export function withDerivedFirstAction(bundledSeed) {
  const readinessRecord = isRecord(bundledSeed?.briefingReadiness)
    ? bundledSeed.briefingReadiness : null;
  const sentence = bundledFirstActionSentence(bundledFirstAction(bundledSeed));
  if (!readinessRecord || !sentence) return readinessRecord;
  return Object.freeze({ ...readinessRecord, recommendedAction: sentence });
}

/**
 * WHICH records a next step may be derived from, as a named state.
 *
 * Nothing imported is not the same thing as an import that produced no readable
 * period, and neither may be decided by the truthiness of an array that can be
 * present and empty. The empty-import case gets its own name so both regions
 * can stamp it and say it, instead of silently showing the bundled example as
 * though it were the reader's own file.
 */
export function nextStepDataState({ retainedAction = null, restored = null } = {}) {
  const imported = Boolean(retainedAction) || Boolean(restored?.carried)
    || isRecord(restored?.currentAnalysis);
  if (!imported) return NEXT_STEP_DATA_STATE.bundledExample;
  const periods = Array.isArray(restored?.currentAnalysis?.rankedDepartments)
    ? restored.currentAnalysis.rankedDepartments.length : 0;
  if (retainedAction || periods > 0) return NEXT_STEP_DATA_STATE.importedPeriods;
  return NEXT_STEP_DATA_STATE.importedEmpty;
}
