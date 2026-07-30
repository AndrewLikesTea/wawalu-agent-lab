// Which of the three journeys a FinOps lead is standing in, and the one thing
// to do next in it.
//
// READ-ONLY, AND DELIBERATELY THIN. Nothing here scores, parses, ranks, or
// re-derives. Every input is already decided somewhere else and is repeated:
//
//   * readiness and its named gaps are `assembleRecurringReview`'s
//     (`recurring-review-readiness.js`);
//   * the carried-import provenance and its rejection are
//     `restoreJourneySnapshot`'s (`finops-journey-snapshot.js`);
//   * the next action's label, its call to action, its target, and what it does
//     and does not answer are the workspace-destination contract's
//     (`finops-destination-contract.js`), read by role and never re-ranked here.
//
// What this module adds is the one thing none of them held: which of the three
// journeys those facts describe. A lead arrives in exactly one of them —
//
//   new_review          nothing is being tracked yet, so the cycle starts by
//                       choosing where to act;
//   resumed_review      an action is tracked and prior evidence carried over,
//                       but the comparison is not available yet;
//   verification_ready  the tracked action has a comparable later period behind
//                       it, so the checkpoint is due.
//
// — and each one changes the question, the action, and the checkpoint. A badge
// that changed and left the three the same would be a state nobody can act on.

import { DESTINATION_ROLE, loadWorkspaceDestinations } from "./finops-destination-contract.js";
import { money } from "./finops-journey-signals.js";

export const JOURNEY_STAGE = Object.freeze({
  new: "new_review",
  resumed: "resumed_review",
  verification: "verification_ready",
});

/** One answerable question per stage, and only one. */
export const STAGE_QUESTION = Object.freeze({
  new_review: "Which department should we act on this cycle?",
  resumed_review: "What does this review still need before we can act?",
  verification_ready: "Did the action we tracked move this department’s spend?",
});

/**
 * The state, in words. Never a colour and never a shape alone: this string is
 * what a greyscale reader, a printed page, and a screen reader all get.
 */
export const STAGE_LABEL = Object.freeze({
  new_review: "New review",
  resumed_review: "Review in progress",
  verification_ready: "Verification due",
});

/**
 * Which destination role each stage sends the reader to.
 *
 * The roles and their order are the contract's; this table only says which of
 * the three a journey in a given stage needs first. Choose the unit before
 * committing to it, check the evidence a held review is waiting on, and go to
 * the act-and-verify surface once there is a measured change to sign off.
 */
const STAGE_ROLE = Object.freeze({
  new_review: DESTINATION_ROLE.departmentDetail,
  resumed_review: DESTINATION_ROLE.evidence,
  verification_ready: DESTINATION_ROLE.actAndVerify,
});

/** The pages the contract's hrefs are authored against, and this view's own. */
export const JOURNEY_PAGE = "/savings-action-center.html";
const BRIEFING_PAGE = "/evolution.html";
/** Where a same-page destination lands instead of reloading the page a reader is on. */
export const CHECKPOINT_FRAGMENT = "#sac-checkpoint";

/** The evidence-boundary gaps, named as the section of the journey they blank. */
const GAP_SECTION = Object.freeze({
  retained_action_missing: "Tracked action",
  current_analysis_missing: "Current local analysis",
  theo_verdict_missing: "Evidence verdict",
  department_scope_mismatch: "Department scope",
  metric_unit_mismatch: "Metric unit",
  later_period_missing: "Comparable later period",
  theo_evidence_insufficient: "Attribution coverage",
});

const freeze = Object.freeze;

/**
 * The stage, from readiness alone.
 *
 * `absent_action` is the assembler's own word for "nothing is being tracked",
 * and `ready` is its own word for "comparable". Neither is recomputed here, so
 * this cannot disagree with the review it labels.
 */
export function stageOf(review) {
  if (!review || review.code === "absent_action") return JOURNEY_STAGE.new;
  return review.ready ? JOURNEY_STAGE.verification : JOURNEY_STAGE.resumed;
}

/**
 * A contract href, from wherever this view is being rendered.
 *
 * The contract authors its in-page fragments against the briefing, so a
 * fragment read anywhere else is the briefing's fragment and is prefixed with
 * it. A destination that is the page the reader is already on becomes that
 * page's checkpoint region: reloading someone onto the screen they are reading
 * is not a next step.
 */
export function resolveTarget(href, here) {
  const target = String(href ?? "");
  if (!target) return null;
  if (target.startsWith("#")) return here === BRIEFING_PAGE ? target : `${BRIEFING_PAGE}${target}`;
  return target === here ? CHECKPOINT_FRAGMENT : target;
}

/**
 * Why the step cannot be taken yet, or null when it can.
 *
 * One case, and it is a real one: a resumed review whose browser holds no
 * current analysis has no evidence screen to open, so the control says so
 * rather than sending the reader to an empty panel.
 */
function blockedReason(stage, review) {
  if (stage === JOURNEY_STAGE.resumed && review?.code === "analysis_missing") {
    return "No current local analysis is on this browser yet, so there is no evidence to open. "
      + "Analyse a later provider period first.";
  }
  return null;
}

function nextActionFor(stage, review, loaded, here) {
  const role = STAGE_ROLE[stage];
  const entry = (loaded?.valid ? loaded.record?.destinations ?? [] : [])
    .find((destination) => destination?.role === role) ?? null;
  // A record that failed its own contract offers no target. The control says
  // that in its own words and stays on screen disabled, because a journey with
  // no visible next step reads as a journey that ended.
  if (!entry) {
    return freeze({
      role,
      id: null,
      label: "No next step is available",
      callToAction: "No next step is available",
      href: null,
      enabled: false,
      disabledReason: "The workspace destination contract could not be read in this build, "
        + "so no target is offered. Nothing else on this page depends on it.",
      answers: null,
      doesNotAnswer: null,
      contractVersion: null,
    });
  }
  const blocked = blockedReason(stage, review);
  return freeze({
    role,
    id: entry.id ?? null,
    label: entry.label,
    // The rank-1 destination carries an imperative; the others carry only the
    // label. Repeating the label is honest when there is no second string.
    callToAction: entry.callToAction ?? entry.label,
    href: resolveTarget(entry.href, here),
    enabled: blocked === null,
    disabledReason: blocked,
    answers: entry.answers ?? null,
    doesNotAnswer: entry.doesNotAnswer ?? null,
    contractVersion: loaded?.record?.contractVersion ?? null,
  });
}

/**
 * The door into this journey, for the surfaces that are not it.
 *
 * The briefing and the local workspace both need one link in, and both should
 * call it what the contract calls it rather than inventing two names for one
 * page. A record that failed its contract still yields a working door: the
 * journey is a place, and a place does not stop existing because a ranking
 * could not be read — the same rule the workspace rail already runs on.
 */
export function journeyEntryLink(destinations = loadWorkspaceDestinations()) {
  const entry = (destinations?.valid ? destinations.record?.destinations ?? [] : [])
    .find((destination) => destination?.role === DESTINATION_ROLE.actAndVerify) ?? null;
  return freeze({
    label: entry?.label ?? "Open the consolidated AI FinOps journey",
    href: entry?.href ?? JOURNEY_PAGE,
    answers: entry?.answers ?? null,
  });
}

/** The measured change, in the one sentence the verdict permits. */
function changeSentence(review) {
  const change = review?.recommendation?.change;
  if (!Number.isFinite(change)) return "No comparable change was measured.";
  if (change < 0) {
    return `Recoverable spend is ${money(Math.abs(change))} lower than the retained baseline.`;
  }
  if (change > 0) {
    return `Recoverable spend is ${money(change)} higher than the retained baseline.`;
  }
  return "Recoverable spend is unchanged from the retained baseline.";
}

/**
 * The checkpoint region's own state.
 *
 * It is a region and not a badge: each stage gives it a different status word,
 * a different sentence, and a different due date, because "when do I check this
 * worked?" is a different question in each of the three.
 */
function checkpointFor(stage, review, retainedAction) {
  const due = retainedAction?.target?.deadline ?? null;
  if (stage === JOURNEY_STAGE.new) {
    return freeze({
      status: "not_scheduled",
      statusLabel: "Not scheduled",
      due: null,
      detail: "No action is being tracked in this browser, so there is nothing to verify yet. "
        + "Tracking one from the department detail schedules its checkpoint.",
      measuredChange: null,
    });
  }
  if (stage === JOURNEY_STAGE.resumed) {
    return freeze({
      status: "waiting",
      statusLabel: "Waiting on evidence",
      due,
      detail: `The checkpoint stays open until the named evidence arrives: ${
        listed(review?.evidenceBoundary?.gaps?.map((gap) => GAP_SECTION[gap] ?? gap), "reason not recorded")
      }. Nothing retained was discarded while it waits.`,
      measuredChange: null,
    });
  }
  return freeze({
    status: "due",
    statusLabel: "Due now",
    due,
    detail: `${review.verdict.wording} ${changeSentence(review)}`,
    measuredChange: Number.isFinite(review?.recommendation?.change)
      ? review.recommendation.change : null,
  });
}

const listed = (values, empty) => (values?.length ? values.join(", ") : empty);

/**
 * Which sections of this journey are missing or mismatched, named.
 *
 * A degraded journey states its holes rather than drawing an empty panel over
 * them. A refused snapshot is one of them: the review still stands on the
 * browser's own records, but the carried import detail is genuinely gone.
 */
function degradedSections(review, snapshot) {
  const sections = (review?.evidenceBoundary?.gaps ?? []).map((gap) => GAP_SECTION[gap] ?? gap);
  if (snapshot?.status === "rejected") sections.push("Carried import detail");
  return freeze(sections);
}

/**
 * The whole journey, in one frozen object.
 *
 * @param input.review `assembleRecurringReview` output.
 * @param input.retainedAction the monthly action record, when one exists.
 * @param input.snapshot `restoreJourneySnapshot` output, when one was read.
 * @param input.here the page this is being rendered on, so a destination that
 *   is this page resolves to its checkpoint instead of to itself.
 * @param input.destinations `loadWorkspaceDestinations` output; injectable so a
 *   test can hand it a refused record without a second fixture.
 */
export function journeyStage({
  review = null, retainedAction = null, snapshot = null, here = JOURNEY_PAGE,
  destinations = loadWorkspaceDestinations(),
} = {}) {
  const stage = stageOf(review);
  return freeze({
    stage,
    stageLabel: STAGE_LABEL[stage],
    question: STAGE_QUESTION[stage],
    nextAction: nextActionFor(stage, review, destinations, here),
    checkpoint: checkpointFor(stage, review, retainedAction),
    degraded: degradedSections(review, snapshot),
    // No tracked action and no comparable figure at all: the honest empty
    // state, and the one the view draws a start-here journey for.
    empty: stage === JOURNEY_STAGE.new && !Number.isFinite(review?.current?.value),
  });
}
