// The consolidated AI FinOps journey, as one model.
//
// A FinOps lead doing the monthly review has to cross three surfaces to finish
// one thought: the briefing holds the evidence, the next-step contract holds the
// recommendation, and the action center holds the verification loop. This module
// is the join, and it is the *only* new thing in that chain: it decides nothing
// those contracts already decided.
//
// WHAT IT READS, AND WHAT IT REFUSES TO RE-DERIVE
// ----------------------------------------------
//   evidence and prior results  → `restoreJourneySnapshot` (Rowan's carried
//     local review) and `assembleRecurringReview` (Theo's recurring comparison).
//   the one prioritized action  → `selectNextStep` on the journey state
//     `chooseJourneyState` picks (Noor's contract), with its own clock injected.
//   the five scannable signals  → `journeySignals` (Iris's chip contract).
//
// No scoring, no CSV parsing, no benchmark arithmetic, and no recommendation
// ranking happens here. Every figure below is a field one of those four already
// published; where none of them publishes one, this module says so in words
// rather than computing a replacement.
//
// THE ONE THING IT DOES DERIVE, AND WHY IT IS HERE
// -----------------------------------------------
// `verificationCheckpoint` — the date the next checkpoint falls on and the
// figure it will be judged against. Neither contract publishes it: the next-step
// contract names VERIFICATION_DUE but keeps the due date inside its headline
// sentence, and the recurring review carries the baseline but not the deadline.
// Both facts sit on the retained monthly action record, so this reads them off
// that record and states which record they came from. It is an adapter, not a
// second opinion: it computes nothing, and if the record is absent the checkpoint
// says it is not scheduled instead of inventing a date.
//
// Pure. No DOM, no storage, no fetch, and no clock: `now` is injected, exactly as
// `selectNextStep` takes it, so the same records always produce the same journey.

import { assembleRecurringReview } from "./recurring-review-readiness.js";
import { journeySignals, money } from "./finops-journey-signals.js";
import { neutralizeRecordText } from "./finops-journey-redaction.js";
import {
  JOURNEY_STATE, NEXT_STEP_CONTRACT, PRIMARY_ACTION, selectNextStep,
} from "./finops-next-step.js";
import { SAMPLE_LABEL, chooseJourneyState } from "./finops-next-step-source.js";
import { ACTION_TARGET } from "./finops-next-step-view.js";

export const CONSOLIDATED_JOURNEY_CONTRACT = "finops-consolidated-journey/1.0.0";

/**
 * The one question this view answers, and it is deliberately neither of the two
 * its inputs answer. The briefing's next-step region asks "where do I start this
 * month?" and the action center asks "is this month's review ready to act on?".
 * Repeating either here would put two regions with one question on one page. The
 * journey's own question is the arc between them: the step, and the thing that
 * will later say whether the step worked.
 */
export const JOURNEY_QUESTION = "What do I do next, and what will tell me it worked?";

/**
 * The three states a lead actually arrives in, plus the one this module is not
 * allowed to hide. They are mutually exclusive and resolved in this order.
 */
export const JOURNEY_PHASE = Object.freeze({
  degraded: "degraded",
  verificationReady: "verification_ready",
  resumed: "resumed_review",
  bundledExample: "bundled_example",
  new: "new_review",
});

/** The state as a word, beside the tint, so the phase never travels as colour. */
export const PHASE_LABEL = Object.freeze({
  [JOURNEY_PHASE.new]: "New review",
  [JOURNEY_PHASE.bundledExample]: "Bundled synthetic example",
  [JOURNEY_PHASE.resumed]: "Review in progress",
  [JOURNEY_PHASE.verificationReady]: "Awaiting verification",
  [JOURNEY_PHASE.degraded]: "Records unreadable",
});

/** What each phase says about where the lead is, in one sentence. */
export const PHASE_COPY = Object.freeze({
  [JOURNEY_PHASE.new]:
    "Nothing is retained in this browser yet, so this review starts from the one step below.",
  [JOURNEY_PHASE.bundledExample]:
    "Nothing of yours is imported, so the step and the checkpoint below are the ones the "
    + "bundled synthetic example recommends for its own invented company.",
  [JOURNEY_PHASE.resumed]:
    "A review is already under way here. What was decided and what is still open are both below.",
  [JOURNEY_PHASE.verificationReady]:
    "The action was committed and its expected effect is now the open question. The checkpoint is below.",
  [JOURNEY_PHASE.degraded]:
    "Part of this journey could not be read. Everything still readable is shown; nothing has been guessed.",
});

const freeze = Object.freeze;
const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const filled = (value) => typeof value === "string" && value.trim().length > 0;

/**
 * Every row this view paints from a stored record, on its way to the screen.
 *
 * The strings a record carries — an action label, an owner title, a department
 * name — are free text a visitor or a file they were handed wrote, and they land
 * inside sentences a reader will paste somewhere else. Nothing here is derived
 * from them, so redacting cannot change a finding; it only stops one record's
 * free text from reading as an instruction to whoever reads it next.
 */
const displayRows = (list) => freeze(list.map(([label, value]) =>
  freeze([label, neutralizeRecordText(value)])));

/** A value that is genuinely absent, said as such rather than as a dash. */
const stated = (value, unit) =>
  (value === null || value === undefined ? null : `${value}${unit ? ` ${unit}` : ""}`);

/**
 * Where the one prioritized action goes from the surface it is painted on.
 *
 * The kinds and their targets are the next-step view's, imported rather than
 * restated. The only thing added is the surface: an in-page fragment on the
 * briefing is another page's fragment from the review, and a link that silently
 * resolves to nothing is worse than no link at all.
 */
export function actionHref(kind, surface = "briefing") {
  const target = ACTION_TARGET[kind] ?? "#local-import-title";
  if (surface === "briefing" || !target.startsWith("#")) return target;
  return `/evolution.html${target}`;
}

/**
 * The checkpoint this journey is waiting on — the one derived field in this
 * module, read off the retained monthly action record and nowhere else.
 *
 * @param retainedAction the `monthly-department-action/1.0.0` record, or null.
 * @returns a checkpoint that is always readable: `known:false` and a reason when
 *   no record schedules one, never a placeholder date.
 */
export function verificationCheckpoint(retainedAction) {
  const target = isRecord(retainedAction) ? retainedAction.target : null;
  const due = filled(target?.deadline) ? target.deadline : null;
  const expected = stated(target?.value ?? null, target?.unit ?? null);
  if (!due && !expected) {
    return freeze({
      known: false,
      due: null,
      expected: null,
      source: null,
      note: "No checkpoint is scheduled: no retained action in this browser carries a deadline.",
    });
  }
  return freeze({
    known: Boolean(due),
    due,
    expected,
    source: filled(retainedAction?.actionId)
      ? `retained monthly action ${retainedAction.actionId}`
      : "the retained monthly action",
    note: due
      ? `Measured against ${expected ?? "the retained target"}, on or after ${due}.`
      : "A target is recorded but no date is, so this checkpoint has no due day to report.",
  });
}

/**
 * The one material figure that answers the question above it.
 *
 * Local measured change first, because a lead comparing this month against their
 * own retained baseline is reading a measurement; the recommendation's priced
 * impact second, because it is a projection; and a stated absence third. Never a
 * zero, and never a dash.
 */
function materialMetric(review, recommendation) {
  if (review?.current?.value !== null && review?.benchmark?.value !== null) {
    return freeze({
      known: true,
      label: "Current vs retained baseline",
      value: `${money(review.current.value)} vs ${money(review.benchmark.value)}`,
      comparison: `${review.current.period ?? "current period unavailable"} · baseline `
        + `${review.benchmark.period ?? "unavailable"} · ${review.current.unit}`,
    });
  }
  if (recommendation?.impact?.stated) {
    return freeze({
      known: true,
      label: "Impact of the step below",
      value: `${money(recommendation.impact.monthlyUsd)} per month`,
      comparison: `${money(recommendation.impact.annualizedUsd)} annualized (monthly × 12, no `
        + `growth assumed) · ${recommendation.provenance}`,
    });
  }
  return freeze({
    known: false,
    label: "Material figure",
    value: "Not stated",
    comparison: review?.evidenceBoundary?.gaps?.length
      ? `No comparable figure yet: ${review.evidenceBoundary.gaps.join(", ")}.`
      : "Nothing priced or comparable is attached to this review yet.",
  });
}

/** What was already settled here, in the words the records themselves carry. */
function decided(review, retainedAction, checkpoint) {
  const rows = [];
  if (retainedAction) {
    rows.push(["Action chosen", retainedAction.actionLabel ?? "Not named on the retained record"]);
    rows.push(["Owner accountable", retainedAction.ownerLabel ?? "Not recorded"]);
    rows.push(["Committed", retainedAction.committedAt ?? "Not recorded"]);
    rows.push(["Department", retainedAction.department ?? "Not recorded"]);
  }
  if (checkpoint.due) rows.push(["Checkpoint due", checkpoint.due]);
  if (review?.provenance?.analysisContract) {
    rows.push(["Evidence contract", review.provenance.analysisContract]);
  }
  return displayRows(rows);
}

/** And what is still open, taken from the recommendation rather than restated. */
function remaining(review, recommendation, checkpoint) {
  const rows = [["Next step", recommendation.headline]];
  if (recommendation.state === JOURNEY_STATE.verificationDue) {
    rows.push(["Checkpoint", checkpoint.note]);
  }
  if (!review?.ready && review?.evidenceBoundary?.gaps?.length) {
    rows.push(["Evidence still missing", review.evidenceBoundary.gaps.join(", ")]);
  }
  if (recommendation.unknowns.length) {
    rows.push([`Not known here (${recommendation.unknowns.length})`,
      recommendation.unknowns.join("; ")]);
  }
  return displayRows(rows);
}

/**
 * The prior results this browser already carried across, from the snapshot's own
 * provenance block. An absent or refused snapshot returns nothing at all rather
 * than an empty-looking table.
 */
function priorResults(restored) {
  const carried = restored?.carried ?? null;
  if (!carried) return [];
  const { provenance, verification, departmentReferences: departments } = carried;
  return [
    ["Carried from import", `${provenance.importSourceId} · ${provenance.fileCount} file`
      + `${provenance.fileCount === 1 ? "" : "s"}, ${provenance.rows} row`
      + `${provenance.rows === 1 ? "" : "s"} · ${provenance.importedAt}`],
    ["Departments carried", departments.length
      ? `${departments.length} reference${departments.length === 1 ? "" : "s"}: ${departments.join(", ")}`
      : "None"],
    ["Prior verification", verification.state
      ? `${verification.state} · ${stated(verification.rows, "measured rows") ?? "row count not stated"}`
      : "Not verified"],
    ["Prior action confidence", carried.confidence.action ?? "Not recorded"],
  ];
}

/**
 * Where a journey's records came from, as data.
 *
 * A bundled example reaches this module through the same restore a visitor's own
 * records do — which is the point of bundling it, and exactly why the reader has
 * to be told which they are looking at. The marker travels on the model, so the
 * distinction survives an export, a test, and a screen reader; the view paints
 * it, it does not invent it. An absent or malformed marker means local records,
 * because a claim about provenance is only ever made from a stated one.
 */
function provenanceMarker(provenance) {
  if (!isRecord(provenance) || !filled(provenance.kind) || !filled(provenance.label)) return null;
  return freeze({
    kind: provenance.kind,
    label: neutralizeRecordText(provenance.label),
    note: filled(provenance.note) ? neutralizeRecordText(provenance.note) : null,
  });
}

/** The sample line a marked journey carries instead of the source's own. */
const provenanceSample = (marker) =>
  `◇ ${marker.label} — ${marker.note ?? "Bundled with this app."}`;

/** And the row that says the same thing inside the supporting detail. */
const provenanceRow = (marker) => [
  "Evidence provenance",
  `${marker.label}. ${marker.note ?? ""} These records ship with this app and are not `
  + "your own imported evidence.",
];

/**
 * Which phase this journey is in.
 *
 * "Has this browser got anything of its own?" is asked FIRST, and deliberately.
 * With no local records the next-step contract answers from the bundled
 * synthetic fixture, which happens to be VERIFICATION_DUE — so checking the
 * recommendation's state before checking for local evidence would tell a
 * first-time visitor they were awaiting verification of an action they never
 * took. A phase is a claim about the reader's own journey, so it may only be
 * made from the reader's own records.
 */
function phaseOf({ recommendation, restored, retainedAction, example }) {
  if (!retainedAction && !restored?.carried && !restored?.currentAnalysis) {
    // #1020: a reader with nothing imported used to be told there was nothing
    // to recommend from, on a page whose whole first screen is a worked
    // example. The example's own first action answers instead — when one was
    // derived. Without one this is still honestly empty rather than invented.
    return example ? JOURNEY_PHASE.bundledExample : JOURNEY_PHASE.new;
  }
  if (recommendation.state === JOURNEY_STATE.verificationDue
    && recommendation.primaryAction.kind === PRIMARY_ACTION.verifyAction) {
    return JOURNEY_PHASE.verificationReady;
  }
  return JOURNEY_PHASE.resumed;
}

/**
 * The onboarding state, and why it does not simply paint the bundled example.
 *
 * A visitor with nothing retained has no journey yet. The next-step contract
 * still answers — from the synthetic fixture, correctly labelled — but a
 * synthetic figure in the material-metric slot and a synthetic action in the
 * priority-1 slot is a first screen that tells a reader what *someone else*
 * should do next. So this state names its own single step, states no figure at
 * all, and says which records are missing. The example remains on the briefing's
 * own first-run block, which is where it belongs.
 */
function onboarding(surface) {
  return freeze({
    sample: "◇ Nothing imported yet — no record in this browser has been read, so this journey "
      + "states no figure of its own.",
    headline: "Nothing is retained in this browser yet, so there is no local evidence to "
      + "recommend from. One provider export starts this month's review.",
    metric: freeze({
      known: false,
      label: "Material figure",
      value: "Not stated",
      comparison: "No figure is claimed before an import: this journey reports only records "
        + "this browser already holds, and it holds none.",
    }),
    action: freeze({
      known: true,
      kind: PRIMARY_ACTION.collectEvidence,
      label: "Import a provider export to start this review",
      href: actionHref(PRIMARY_ACTION.collectEvidence, surface),
      rationale: "Importing one provider export is the only step that produces the evidence "
        + "every panel here reads. Files are read in the browser and are not uploaded.",
    }),
  });
}

/**
 * The readable fallback. A contract that is present but malformed costs this
 * view its figures and nothing else: the question, the phase, the reason, and a
 * step the reader can still take all survive, so no panel is ever blank and no
 * unreadable record reaches a reader as a thrown error.
 */
/**
 * The bundled-example state: what the WORKED EXAMPLE recommends, and what would
 * tell that example it worked.
 *
 * Every field is read off the one derived `finops-bundled-next-step/1.0.0`
 * record — the same record the circulation decision block states its first
 * action from — so this surface cannot name a second first action. It states no
 * figure of the reader's, because there is none: the metric is the example's
 * modelled recoverable line, labelled as modelled and as invented.
 */
function bundledExample(example, surface) {
  return freeze({
    sample: "◇ Bundled synthetic example — the step and the checkpoint below are what this "
      + "invented company's records recommend. Not your spend and not realized savings.",
    headline: example.headline,
    metric: freeze({
      known: true,
      label: "Figure the example's step came from",
      value: `${example.figure.text} ${example.figure.metricName}`,
      comparison: `${example.figure.unit}${example.figure.period ? ` · ${example.figure.period}` : ""}`
        + ` · ${example.department} · modelled from invented records, not a realized saving`,
    }),
    action: freeze({
      known: true,
      kind: PRIMARY_ACTION.collectEvidence,
      label: example.actionText,
      href: actionHref(PRIMARY_ACTION.collectEvidence, surface),
      rationale: `${example.rationale} Import one provider export to get the same step derived `
        + "from your own periods.",
    }),
  });
}

function degraded(reason, surface, marker = null) {
  return freeze({
    contract: CONSOLIDATED_JOURNEY_CONTRACT,
    phase: JOURNEY_PHASE.degraded,
    phaseLabel: PHASE_LABEL[JOURNEY_PHASE.degraded],
    phaseCopy: PHASE_COPY[JOURNEY_PHASE.degraded],
    source: "local",
    provenance: marker,
    sample: marker ? provenanceSample(marker) : null,
    question: JOURNEY_QUESTION,
    // #1669: names what failed in the reader's words — "journey" is this
    // module's name for the thing, "this month's saved records" is theirs — and
    // ends on the action slot below rather than inventing a rival to it.
    headline: "This month's saved records could not be read, so no step is recommended. "
      + "Importing a provider export again rebuilds them.",
    metric: freeze({
      known: false,
      label: "Material figure",
      value: "Not stated",
      comparison: "No figure is claimed from records this build could not read.",
    }),
    action: freeze({
      known: false,
      kind: PRIMARY_ACTION.collectEvidence,
      label: "Import a provider export to rebuild this review",
      href: actionHref(PRIMARY_ACTION.collectEvidence, surface),
      rationale: "Re-importing rebuilds the local records this journey reads. Nothing stored "
        + "in this browser was changed or deleted by the failed read.",
    }),
    decided: freeze([]),
    remaining: displayRows([["Why this is degraded", reason]]),
    checkpoint: verificationCheckpoint(null),
    signals: freeze([]),
    priorResults: displayRows(marker ? [provenanceRow(marker)] : []),
    departments: freeze([]),
    notice: null,
    reason,
  });
}

/**
 * One consolidated journey: evidence, the prioritized action, and the
 * verification checkpoint, composed from contracts that already decided them.
 *
 * @param input.restored `restoreJourneySnapshot` output. Its three record fields
 *   are the local evidence; the snapshot itself is the carried provenance.
 * @param input.now the injected clock, handed straight to `selectNextStep`.
 * @param input.surface `"briefing"` or `"review"` — which page the action link is
 *   painted on. It changes the href and nothing else.
 * @param input.provenance an optional `{kind, label, note}` marker for records
 *   that are not the reader's own — a bundled example loaded through this same
 *   restore. It labels the journey and changes nothing else about it: no figure,
 *   no phase, no confidence, and no recommendation is derived from it.
 * @returns one frozen `finops-consolidated-journey/1.0.0` model. Never throws:
 *   an unreadable input resolves to the degraded phase with its reason named.
 */
export function consolidateJourney({
  restored = null, now = new Date(), surface = "briefing", provenance = null, example = null,
} = {}) {
  const marker = provenanceMarker(provenance);
  if (restored !== null && !isRecord(restored)) {
    return degraded("The restored journey is not a record this view can read.", surface, marker);
  }
  let review = null;
  let recommendation = null;
  let chosen = null;
  const retainedAction = isRecord(restored?.retainedAction) ? restored.retainedAction : null;
  try {
    review = assembleRecurringReview({
      retainedAction,
      currentAnalysis: restored?.currentAnalysis ?? null,
      theoVerdict: restored?.theoVerdict ?? null,
    });
    chosen = chooseJourneyState({ retainedAction });
    recommendation = selectNextStep(chosen.journeyState, now);
  } catch (error) {
    return degraded(
      `A local record could not be read: ${error?.message ?? String(error)}`, surface, marker);
  }
  if (!isRecord(review) || recommendation?.contract !== NEXT_STEP_CONTRACT) {
    return degraded(
      "A journey contract answered in a shape this view does not support.", surface, marker);
  }

  const derived = isRecord(example) ? example : null;
  const phase = phaseOf({ recommendation, restored, retainedAction, example: derived });
  // The example's step carries the example's own checkpoint. Every other phase
  // reads the one the retained record schedules, which may be none.
  const checkpoint = phase === JOURNEY_PHASE.bundledExample
    ? derived.checkpoint : verificationCheckpoint(retainedAction);
  // The onboarding state answers from nothing, so it answers for itself. Every
  // other phase reads the recommendation the contract already published.
  const first = phase === JOURNEY_PHASE.bundledExample ? bundledExample(derived, surface)
    : phase === JOURNEY_PHASE.new ? onboarding(surface) : {
    sample: SAMPLE_LABEL[chosen.source] ?? null,
    headline: recommendation.headline,
    metric: materialMetric(review, recommendation),
    action: freeze({
      known: true,
      kind: recommendation.primaryAction.kind,
      label: recommendation.primaryAction.label,
      href: actionHref(recommendation.primaryAction.kind, surface),
      rationale: recommendation.rationale.rule,
    }),
  };
  return freeze({
    contract: CONSOLIDATED_JOURNEY_CONTRACT,
    phase,
    phaseLabel: PHASE_LABEL[phase],
    phaseCopy: PHASE_COPY[phase],
    source: phase === JOURNEY_PHASE.new ? "none" : chosen.source,
    // Marked records say so in the sample line, over the source's own label: a
    // bundled example read through the local path would otherwise introduce
    // itself as "your own retained records", which is the one thing it is not.
    provenance: marker,
    sample: marker ? provenanceSample(marker) : first.sample,
    question: JOURNEY_QUESTION,
    headline: neutralizeRecordText(first.headline),
    metric: first.metric,
    action: freeze({ ...first.action, label: neutralizeRecordText(first.action.label) }),
    decided: decided(review, retainedAction, checkpoint),
    remaining: phase === JOURNEY_PHASE.bundledExample
      ? displayRows([
        ["Next step", derived.actionText],
        ["Checkpoint", derived.checkpoint.note],
        ["Nothing of yours is imported yet",
          "No provider export, no retained monthly action, and no evidence verdict are held "
          + "in this browser. Importing one export derives this same step from your periods."],
      ])
      : phase === JOURNEY_PHASE.new
      ? displayRows([["Nothing retained yet",
        "No provider export, no retained monthly action, and no evidence verdict are held "
        + "in this browser. Importing one export fills all three."]])
      : remaining(review, recommendation, checkpoint),
    checkpoint,
    // Iris's five chips, unchanged: the same words, tones, and shapes the action
    // center already paints, so one journey does not describe itself twice.
    signals: journeySignals(review, { retainedAction }),
    // Provenance leads the carried block: which records these are is the first
    // thing a reader needs before any figure carried with them means anything.
    priorResults: displayRows([
      ...(marker ? [provenanceRow(marker)] : []), ...priorResults(restored),
    ]),
    departments: displayRows([
      ["Department", review.current.department ?? retainedAction?.department ?? "Not identified in this evidence"],
      ["Metric definition", review.current.definition],
      ["Current value", stated(review.current.value, review.current.unit) ?? "Not available"],
      ["Retained benchmark", stated(review.benchmark.value, review.benchmark.unit) ?? "Not available"],
      ["Attribution coverage", review.confidence.coveragePercent === null
        ? "Not measured" : `${review.confidence.coveragePercent.toFixed(1)}%`],
      ["Recurring verdict", `${review.verdict.verdict} · ${review.verdict.confidence.level} confidence`],
      // The boundary belongs to the recommendation, so it travels only where the
      // recommendation does. In the onboarding state it would be the bundled
      // fixture's boundary describing accounts the reader has never imported.
      ["Evidence boundary", phase === JOURNEY_PHASE.bundledExample
        ? "Covers the bundled example's invented departments over its own baseline period only. "
        + "Nothing you imported is inside it, because nothing is imported."
        : phase === JOURNEY_PHASE.new
        ? "No boundary is stated: no imported evidence exists here to bound."
        : recommendation.evidenceBoundary],
    ]),
    notice: restored?.notice ?? null,
    reason: null,
  });
}

/**
 * Everything the painted journey depends on, in one comparable string.
 *
 * Both surfaces repaint this region whenever anything else on them moves.
 * Rebuilding a journey that has not changed would close the disclosures a reader
 * opened and take the keyboard with them, so an unchanged journey is left
 * standing — the same rule the recurring review already runs on.
 */
export const consolidatedJourneyPaintKey = (journey) => [
  journey.contract, journey.phase, journey.source,
  journey.provenance?.label ?? "own-records", journey.headline,
  journey.metric.value, journey.action.label, journey.action.href,
  journey.checkpoint.due, journey.checkpoint.expected,
  journey.decided.length, journey.remaining.length, journey.priorResults.length,
  journey.notice ?? "none", journey.reason ?? "none",
].join("|");
