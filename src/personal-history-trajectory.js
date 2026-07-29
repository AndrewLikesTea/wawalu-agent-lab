// One prioritized trajectory finding: is the habit you were told to change
// first actually moving?
//
// WHAT THIS OWNS, AND WHAT IT REFUSES TO OWN
// ------------------------------------------
// `personal-history-carry-forward.js` decides whether two readings may be
// compared at all and, when they may, what the arithmetic is. Nothing here
// second-guesses that: every reason, sentence, and figure below either arrives
// on the comparison or is derived from it by a rule published in this file.
//
// This module answers the question that sits one step later, and that a
// comparison alone cannot answer honestly: *may a direction be reported to a
// person as a direction?* A signed number is not a trajectory. Two readings can
// differ by three hundredths of a point and be, in every sense a reader cares
// about, the same reading — and telling somebody their habit improved on that
// basis is the failure this whole workflow was built to avoid, arriving through
// the back door of a subtraction.
//
// SO THERE IS A MATERIALITY RULE, AND IT IS PUBLISHED
// ---------------------------------------------------
// `TRAJECTORY_MATERIALITY` is the whole of it: a movement is reported as a
// direction only when it clears both an absolute floor and a share of where the
// reader started. Under it, the finding is `no_meaningful_movement` — which is a
// real answer and is drawn as one, not as a missing result.
//
// AND A CONFIDENCE FLOOR
// ----------------------
// A comparison is only as good as its weaker end; the carry-forward module
// already says so and hands back `delta.basisConfidence`. Where that end earned
// no confidence at all, no direction is reported either. Where it is low, the
// direction is reported *with the caveat attached to it* rather than in a
// footnote a reader scrolls past.
//
// NOTHING PERSONAL LEAVES THIS MODULE. It reads a report and a comparison, both
// of which carry counts, ratios, and this repository's own rubric identifiers.
// There is no prompt text in either to render, no date is read, and this module
// touches no storage, no network, and no DOM.

import { PERSONAL_REPORT_STATE } from "./personal-history-contract.js";
import { PERSONAL_RUN_KIND } from "./personal-history-entry.js";
import {
  CARRY_FORWARD_DIRECTION, CARRY_FORWARD_STATE,
} from "./personal-history-carry-forward.js";
import { IMPROVEMENT_COPY, IMPROVEMENT_REWRITE } from "./prompt-coaching.js";

/** Bump when a state, the materiality rule, or the confidence floor changes. */
export const TRAJECTORY_VERSION = "personal-history-trajectory/1.0.0";

export const TRAJECTORY_QUESTION =
  "Is the one habit I was told to change first actually moving in my own history?";

/**
 * The six findings, exactly one of which applies to any reading.
 *
 * The first three are answers about a habit. The last three are answers about
 * the evidence, and they are answers rather than absences: "there is nothing to
 * compare this with" and "the two readings are not comparable" are different
 * facts, and a reader who cannot tell them apart cannot tell whether to keep
 * going or to fix their export.
 */
export const TRAJECTORY_STATE = Object.freeze({
  improved: "improved",
  worsened: "worsened",
  noMeaningfulMovement: "no_meaningful_movement",
  firstReading: "first_reading",
  incompatible: "incompatible",
  insufficientEvidence: "insufficient_evidence",
});

/**
 * When a difference is a direction, and when it is two readings of the same
 * habit.
 *
 * BOTH TESTS BIND. The absolute floor exists because the compared figure is
 * rounded to two decimals, so a hundredth of a point is inside the noise of the
 * rounding itself. The relative floor exists because a hundredth means something
 * different at 0.4 points per request than at 8 — a fixed floor would call a 12%
 * change immaterial for one reader and a 1% change material for another.
 *
 * WHY TEN PER CENT. This is a conservative product assumption, not an observed
 * noise estimate: no labelled repeated-export dataset exists here from which to
 * estimate natural variation. Ten per cent requires a visible proportional
 * change while the 0.05 floor protects the metric's two-decimal precision. The
 * value must be revisited against labelled repeated readings before anyone
 * describes it as empirically calibrated.
 */
export const TRAJECTORY_MATERIALITY = Object.freeze({
  absolutePoints: 0.05,
  shareOfPrevious: 0.1,
  operator: ">=",
  rule: "A movement is reported as a direction only when it is at least 0.05 points per scored "
    + "prompt AND at least 10% of what the same move cost per scored prompt in the previous "
    + "reading. Both bind.",
  assumption: "The 0.05-point floor protects a figure rounded to two decimals. The 10% floor is "
    + "a conservative product assumption used because these readings contain different prompts; "
    + "it is not an empirically estimated noise boundary.",
  why: "Until repeated exports are independently labelled, movement below both floors is treated "
    + "as unresolved. This avoids presenting a small arithmetic difference as improvement while "
    + "keeping the threshold and its unvalidated assumption visible.",
});

/**
 * The confidence a comparison must reach before a direction is reported at all,
 * and the level at which the direction is reported with its caveat attached.
 *
 * `floor` is the level that reports nothing. It is deliberately the bottom of
 * the scale rather than something stricter: the reader's own reading is already
 * confidence-graded and drawn beside this, and refusing a direction at low
 * confidence would throw away the only signal a light-usage reader can ever get.
 * The answer to a thin comparison is to say it is thin, in the same sentence.
 */
export const TRAJECTORY_CONFIDENCE_RULE = Object.freeze({
  floor: "none",
  caveatAt: "low",
  rule: "A comparison is held at the weaker of the two readings' confidence levels. At the floor "
    + "no direction is reported. At low confidence the direction is reported with the reason it "
    + "is weak attached to it.",
});

/** The sentence each low-confidence direction carries with it, never as a footnote. */
export const TRAJECTORY_CONFIDENCE_CAVEAT =
  "Held at low confidence, because a comparison is only as strong as its weaker reading and one "
  + "of these two was thin. The direction is the best reading of what you exported; it is not yet "
  + "a trend, and one more reading is what would make it one.";

/**
 * What each finding claims — and, in the same object, what it does not.
 *
 * `claims` is drawn on screen. `refuses` is drawn on screen too, beside it: a
 * page that reports a fall in a cost per request and leaves the reader to work
 * out on their own that nothing here establishes a cause has told them something
 * true in a way that reads as something stronger.
 */
export const TRAJECTORY_FINDING = Object.freeze({
  [TRAJECTORY_STATE.improved]: Object.freeze({
    headline: "The same move costs you less on an average request than it did last reading.",
    claims: "The same move, measured the same way, is worth fewer composite points on an average "
      + "request than it was in the reading this browser carried forward.",
    refuses: "It does not establish that anything you did caused the fall, and it is not a score "
      + "against anybody else. Two readings are two points, not a trend.",
  }),
  [TRAJECTORY_STATE.worsened]: Object.freeze({
    headline: "The same move costs you more on an average request than it did last reading.",
    claims: "The same move, measured the same way, is worth more composite points on an average "
      + "request than it was in the reading this browser carried forward.",
    refuses: "It does not establish that you got worse at anything. The two readings hold "
      + "different work, and harder work states less of what it wants.",
  }),
  [TRAJECTORY_STATE.noMeaningfulMovement]: Object.freeze({
    headline: "The same move costs you what it did last reading, to within what this comparison "
      + "can resolve.",
    claims: "The two readings are close enough that the difference between them is inside the "
      + "noise of the reading itself, so the honest answer is that the habit has not moved.",
    refuses: "It is not a failure and it is not a plateau. It is the answer that the evidence "
      + "supports, and it is the one this page would rather give than a direction it invented.",
  }),
  [TRAJECTORY_STATE.firstReading]: Object.freeze({
    headline: "This is the first reading there is anything to carry forward from.",
    claims: "A summary of this reading is now kept in this browser, so your next reading has "
      + "something to be compared with.",
    refuses: "Nothing is claimed about a direction, because there is no earlier reading. The move "
      + "above stands on its own and is complete without this.",
  }),
  [TRAJECTORY_STATE.incompatible]: Object.freeze({
    headline: "These two readings are not points on one line.",
    claims: "Something changed between the two readings that moves the figure without any habit "
      + "of yours moving, so the two are reported separately rather than subtracted.",
    refuses: "No direction is reported. A difference drawn across a changed rubric, a changed "
      + "contract, or a different leading move would be this product taking credit for its own "
      + "edit.",
  }),
  [TRAJECTORY_STATE.insufficientEvidence]: Object.freeze({
    headline: "There is not enough here to compare.",
    claims: "The reading you are looking at is unaffected. What is missing is the other end of a "
      + "comparison, not part of this result.",
    refuses: "No direction is reported and no improvement is implied. An answer assembled out of "
      + "one usable end would be a comparison with nothing behind it.",
  }),
});

/**
 * Which finding a carry-forward state maps to when no direction is drawn.
 *
 * The carry-forward module's four states already carve this correctly, so the
 * map is one-to-one and this module adds nothing to it. The three states a
 * direction can produce are decided below, from the delta.
 */
const FINDING_FOR_CARRY_STATE = Object.freeze({
  [CARRY_FORWARD_STATE.firstReading]: TRAJECTORY_STATE.firstReading,
  [CARRY_FORWARD_STATE.incompatible]: TRAJECTORY_STATE.incompatible,
  [CARRY_FORWARD_STATE.insufficientEvidence]: TRAJECTORY_STATE.insufficientEvidence,
});

const DIRECTION_FINDING = Object.freeze({
  [CARRY_FORWARD_DIRECTION.improving]: TRAJECTORY_STATE.improved,
  [CARRY_FORWARD_DIRECTION.worsening]: TRAJECTORY_STATE.worsened,
  [CARRY_FORWARD_DIRECTION.flat]: TRAJECTORY_STATE.noMeaningfulMovement,
});

/**
 * The materiality rule, applied.
 *
 * Pure and separately exported because "why did it say no movement when the
 * number visibly changed" is the question this artifact will be asked, and the
 * answer should be a function a reader can be shown rather than a branch.
 *
 * @param {number} points the signed change in points per scored prompt.
 * @param {number} previous what the same move cost per scored prompt before.
 * @returns {{material: boolean, magnitude: number, share: number|null, threshold: number}}
 */
export function movementMateriality(points, previous) {
  const magnitude = Math.abs(Number.isFinite(points) ? points : 0);
  const base = Number.isFinite(previous) && previous > 0 ? previous : 0;
  const relative = base * TRAJECTORY_MATERIALITY.shareOfPrevious;
  const threshold = Math.max(TRAJECTORY_MATERIALITY.absolutePoints, relative);
  return Object.freeze({
    material: magnitude >= threshold && magnitude > 0,
    magnitude: roundTo(magnitude, 2),
    share: base > 0 ? roundTo(magnitude / base, 4) : null,
    threshold: roundTo(threshold, 2),
  });
}

const roundTo = (value, places) => {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};

/**
 * Where each side of the comparison came from, in the reader's terms.
 *
 * The previous side is deliberately labelled as a *derived summary* rather than
 * as a reading: the file behind it is long gone, and a before/after that let a
 * reader believe their earlier export is still sitting in this browser would be
 * a privacy claim broken by an interface detail.
 */
export const TRAJECTORY_PROVENANCE = Object.freeze({
  previous: "A summary this browser kept from your last reading: counts, ratios, version strings, "
    + "and this repository's own move identifier. The export behind it was never stored and is "
    + "not here.",
  current: "The file you chose, read in this tab and dropped when the reading finished.",
  neither: "Neither side of this comparison was uploaded, sent for analysis, or joined to anybody "
    + "else's history.",
});

/**
 * One reading, one comparison, one finding.
 *
 * @param {object} report a report from `buildPersonalHistoryReport`.
 * @param {object|null} comparison a comparison from `compareWithCarriedSummary`.
 * @param {{kind?: string}} options the worked example is never given a
 *   trajectory: it is an invented person, and a before/after drawn on them would
 *   be the most misleading thing on the page.
 * @returns {object|null} frozen, or null where no trajectory section belongs.
 */
export function buildTrajectory(report, comparison, { kind = PERSONAL_RUN_KIND.file } = {}) {
  if (!comparison || kind === PERSONAL_RUN_KIND.preview) return null;
  if (report?.state !== PERSONAL_REPORT_STATE.prioritized) return null;

  const finding = findingFor(comparison);
  const movement = movementFor(comparison, finding);
  return Object.freeze({
    schemaVersion: TRAJECTORY_VERSION,
    question: TRAJECTORY_QUESTION,
    carryState: comparison.state,
    state: finding,
    directional: finding === TRAJECTORY_STATE.improved || finding === TRAJECTORY_STATE.worsened,
    finding: TRAJECTORY_FINDING[finding],
    // The carry-forward module's own sentence for why there is no comparison,
    // or null where there is one. Never re-worded here.
    reason: comparison.reason,
    reasonRule: comparison.reasonRule,
    movement,
    readings: Object.freeze({ previous: comparison.previous, current: comparison.current }),
    confidence: confidenceFor(comparison, report),
    provenance: TRAJECTORY_PROVENANCE,
    metric: comparison.metric,
    period: comparison.period,
    basis: comparison.basis,
    handoff: trajectoryHandoff(report),
  });
}

function findingFor(comparison) {
  if (!comparison.comparable) {
    return FINDING_FOR_CARRY_STATE[comparison.state] ?? TRAJECTORY_STATE.insufficientEvidence;
  }
  // A comparable pair whose weaker end earned no confidence at all is evidence
  // of nothing, whichever way the number went.
  if (comparison.delta?.basisConfidence === TRAJECTORY_CONFIDENCE_RULE.floor) {
    return TRAJECTORY_STATE.insufficientEvidence;
  }
  const materiality = movementMateriality(
    comparison.delta.pointsPerScoredPrompt, comparison.previous?.pointsPerScoredPrompt);
  if (!materiality.material) return TRAJECTORY_STATE.noMeaningfulMovement;
  return DIRECTION_FINDING[comparison.delta.direction] ?? TRAJECTORY_STATE.noMeaningfulMovement;
}

function movementFor(comparison, finding) {
  if (!comparison.comparable) return null;
  const { delta, previous } = comparison;
  const materiality = movementMateriality(delta.pointsPerScoredPrompt, previous?.pointsPerScoredPrompt);
  return Object.freeze({
    points: delta.pointsPerScoredPrompt,
    direction: delta.direction,
    arithmetic: delta.arithmetic,
    material: materiality.material,
    magnitude: materiality.magnitude,
    share: materiality.share,
    threshold: materiality.threshold,
    // Drawn only where it explains the finding: a reader told "no movement"
    // beside a number that changed is owed the rule that decided it.
    rule: finding === TRAJECTORY_STATE.noMeaningfulMovement ? TRAJECTORY_MATERIALITY.rule : null,
  });
}

function confidenceFor(comparison, report) {
  const level = comparison.comparable
    ? comparison.delta.basisConfidence
    : report.confidence.level;
  return Object.freeze({
    level,
    // The reading's own label, which is the word the confidence section above
    // already put on screen; the comparison never invents a second vocabulary.
    readingLabel: report.confidence.label,
    heldAt: comparison.comparable
      ? "the weaker of the two readings, because a comparison is only as good as its worse end"
      : "this reading alone, because there is no second reading to weaken it",
    caveat: comparison.comparable && level === TRAJECTORY_CONFIDENCE_RULE.caveatAt
      ? TRAJECTORY_CONFIDENCE_CAVEAT
      : null,
  });
}

// ---------------------------------------------------------------------------
// The handoff into the prompt coach
// ---------------------------------------------------------------------------

/**
 * Where a reader goes with the move this reading named.
 *
 * WHY THE COACH. The history page names one habit across weeks of prompts and
 * stops there; the coach grades one prompt and can be run again in thirty
 * seconds. The move is the thing that belongs in both, and the rubric's own
 * `rewrite` field is already a ready-to-edit prompt written against it — so the
 * handoff is not a summary of the finding, it is the next prompt.
 *
 * WHY NOTHING IS PUT IN THE LINK. This workflow's published boundary says
 * nothing you read here is put in a URL, and a deep link carrying which habit
 * somebody is working on would be exactly that, in a string that lands in a
 * browser history and survives a paste into a chat. The link is structural — it
 * names a field on the coach — and the move travels the way the coach's own
 * summary travels: as text the reader takes, on a control they press.
 */
export const TRAJECTORY_HANDOFF_HREF = "/coach.html#prompt-coaching-input";

export const TRAJECTORY_HANDOFF = Object.freeze({
  title: "Take this move to the prompt coach",
  lead: "The rubric writes one prompt against the move above. Copy it, open the coach, paste it "
    + "into the field, and grade it — the same rubric, on one prompt, in about a minute.",
  boundary: "The text copied is rubric wording and this reading's move identifier. It carries no "
    + "prompt you wrote, no count from your file, and no date, and the link puts nothing in a URL.",
  href: TRAJECTORY_HANDOFF_HREF,
  linkLabel: "Open the prompt coach",
});

/** The title of the brief, kept out of the builder so a test can name it. */
export const TRAJECTORY_BRIEF_TITLE = "Prompt coach — the move my own AI history named";

/**
 * The brief a reader carries to the coach.
 *
 * Every line is either authored rubric copy or a repository identifier. There is
 * nothing else available to put in it: the report this is built from carries no
 * prompt text at any depth, which is what `FORBIDDEN_REPORT_KEYS` and the marker
 * fixtures exist to keep true.
 *
 * @returns {string} plain text, newline separated, safe to paste anywhere.
 */
export function trajectoryBriefText(report) {
  const priority = safeHandoffPriority(report);
  if (!priority) return "";
  const rows = [
    TRAJECTORY_BRIEF_TITLE,
    "",
    `Move: ${priority.title}`,
    `Rubric identifier: ${priority.id}`,
    `Why it was named: ${priority.guidance}`,
  ];
  if (priority.rewrite) rows.push("", "Start from this prompt:", priority.rewrite);
  rows.push("", TRAJECTORY_HANDOFF.boundary);
  return rows.join("\n");
}

/**
 * The handoff as data, so the surface renders it and decides none of it.
 *
 * `available` is false wherever there is no move to carry — a refused reading
 * has nothing to hand anybody, and a control offering to carry it would be a
 * dead end drawn as an action.
 */
export function trajectoryHandoff(report) {
  const priority = safeHandoffPriority(report);
  const available = Boolean(priority);
  return Object.freeze({
    available,
    moveId: available ? priority.id : null,
    title: available ? priority.title : null,
    starter: available ? (priority.rewrite ?? null) : null,
    brief: available ? trajectoryBriefText(report) : "",
    href: TRAJECTORY_HANDOFF.href,
  });
}

/**
 * Resolve handoff copy from the bundled rubric, never from report strings.
 *
 * Reports produced by this repository already exclude prompt text. This second
 * boundary makes the exported handoff builder safe when called with an
 * unvalidated or later-version object: an unknown identifier or kind yields no
 * handoff, and poisoned title/guidance/rewrite fields are ignored.
 */
function safeHandoffPriority(report) {
  const candidate = report?.priority;
  if (report?.state !== PERSONAL_REPORT_STATE.prioritized || !candidate?.available) return null;
  const copy = IMPROVEMENT_COPY[candidate.id]?.[candidate.kind];
  const rewrite = IMPROVEMENT_REWRITE[candidate.id];
  if (!copy || typeof rewrite !== "string") return null;
  return Object.freeze({
    id: candidate.id,
    title: copy.title,
    guidance: copy.guidance,
    rewrite,
  });
}
