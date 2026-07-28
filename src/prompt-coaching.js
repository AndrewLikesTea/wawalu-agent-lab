// "Grade my prompt": one pasted prompt in, one coaching answer out.
//
// THE ONE QUESTION
// ----------------
// Every prompt-literacy surface on this page grades a *corpus*: an imported
// conversation export, scored, attributed to the org chart, and gated by
// `prompt-grading-eligibility.js` before it is allowed near the headline. None
// of them answers the question a reader arrives with the first time they see a
// letter grade:
//
//   "Would a model answer this prompt well?"
//
// This module answers exactly that, for exactly the text in the box, and
// refuses to answer a second question. It is the composition layer for the
// in-tab coaching workflow: it selects and ranks, it does not measure.
//
//   * the three dimension scores, the composite and the letter are
//     `prompt-prose-classification.js`'s, repeated;
//   * the rubric bands, axis weights and rounding are
//     `prompt-literacy-rubric.json`'s, read through `prompt-literacy-scoring.js`;
//   * the words for "show it as a fact" and "show it, marked incomplete" are
//     `finops-display.js`'s;
//   * the floor a *corpus* has to clear before a grade may speak for a team is
//     `prompt-grading-eligibility.js`'s, quoted so this surface can say what it
//     is not.
//
// Recomputing any of those here is how two numbers on one screen disagree.
//
// WHAT THIS RESULT IS NOT
// -----------------------
// It is not an organization grade and it never becomes one. A pasted prompt is
// one prompt; Noor's contract puts the floor for grading a single department at
// `minPromptsPerDepartment` classified prompts, and this module says so in the
// basis line rather than letting a reader carry a letter from a text box into a
// conversation about their team.
//
// EXECUTION AND PRIVACY
// ---------------------
// Pure, synchronous, dependency-free beyond the local imports: no clock, no
// randomness, no network, no storage, no credential, no worker. The pasted text
// is an argument and a local; it is never returned, never stored, never copied
// into a message, an error, or a nested field at any depth. Every string this
// module emits is either a static literal declared below or a number this
// module computed. That is asserted in tests/prompt-coaching.test.js rather
// than promised here.

import {
  PROMPT_LITERACY_RUBRIC, letterGradeForScore,
} from "./prompt-literacy-scoring.js";
import {
  CONVERSATION_REASON_CODES, DIMENSION_BASELINES, PROSE_SIGNALS, SIGNAL_ASSUMPTIONS,
  SUBSTANTIVE_PROSE_UNITS, TRIVIAL_PROSE_UNITS, TURN_REASON_CODES,
  classifyConversation,
} from "./prompt-prose-classification.js";
import { MODEL_TIERS, UNRECOGNIZED_TIER, classifyModelTier } from "./provider-usage-record.js";
import { PROMPT_GRADING_THRESHOLDS } from "./prompt-grading-eligibility.js";
import { TRUST_LABEL } from "./finops-display.js";

/** Bump when a state, a reason code, or the ranking rule changes meaning. */
export const PROMPT_COACHING_VERSION = "prompt-coaching/1.0.0";

/** The one question. Not derived, not configurable, not one of several. */
export const COACHING_QUESTION = "Would a model answer this prompt well?";

/**
 * The two ceilings on what may be pasted.
 *
 * ASSUMPTION, 20,000 characters: about eight pages, which is longer than any
 * prompt or short conversation this workflow is for, and short enough that the
 * whole grade is computed between two keystrokes on a slow laptop. Refusing is
 * kinder than a browser tab that stops responding, and the refusal names the
 * number so a reader can trim to it.
 *
 * ASSUMPTION, 20 turns: this workflow grades a prompt or the exchange around
 * it. Past twenty turns a reader is asking for a corpus grade, and the answer
 * to that is the conversation-export import above — which is what the recovery
 * guidance for this refusal says.
 */
export const COACHING_INPUT_LIMITS = Object.freeze({
  maxChars: 20_000,
  maxTurns: 20,
});

/**
 * Why a paste could not be graded. Stable wire codes; a surface switches on
 * these and never string-matches a sentence.
 *
 * The last two are quoted from the classifier rather than restated, so the same
 * refusal is named the same way here and in the reasons payload.
 */
export const COACHING_REASON = Object.freeze({
  emptyInput: "empty_input",
  unsupportedInput: "unsupported_input",
  tooLong: "input_too_long",
  tooManyTurns: "too_many_turns",
  noUserTurn: "no_user_turn",
  noTurns: CONVERSATION_REASON_CODES.noTurns,
  noScorableTurn: CONVERSATION_REASON_CODES.noScorableTurn,
});

/**
 * What the reader does about each refusal. Static copy, and deliberately never
 * an echo of what they pasted: recovery guidance that quoted the input would be
 * the one path prompt text could leave this module by.
 *
 * `control` names the in-page control that acts on the guidance, so the surface
 * can move focus to something operable instead of describing a fix in prose.
 */
export const COACHING_RECOVERY = Object.freeze({
  [COACHING_REASON.emptyInput]: Object.freeze({
    title: "There is nothing to grade yet.",
    guidance: "Paste the prompt you sent, or the exchange around it, into the box and grade it again.",
    control: "prompt-coaching-input",
  }),
  [COACHING_REASON.unsupportedInput]: Object.freeze({
    title: "That input could not be read as text.",
    guidance: "This workflow grades pasted text only. Copy the prompt itself — not a file, an image, or a link — into the box.",
    control: "prompt-coaching-input",
  }),
  [COACHING_REASON.tooLong]: Object.freeze({
    title: "That paste is longer than this workflow grades.",
    guidance: "Trim it to the prompt you want coached and grade that. A whole month of conversations is a corpus, and the import above grades corpora.",
    control: "prompt-coaching-input",
  }),
  [COACHING_REASON.tooManyTurns]: Object.freeze({
    title: "That is a transcript, not a prompt.",
    guidance: "Grade a prompt or the few turns around it. For a whole history, use the conversation-export import above, which grades it against the org chart.",
    control: "prompt-coaching-input",
  }),
  [COACHING_REASON.noUserTurn]: Object.freeze({
    title: "Every turn in that paste is labelled as the model's.",
    guidance: "This workflow grades what you wrote. Include at least one turn labelled “User:”, or paste the prompt on its own with no labels at all.",
    control: "prompt-coaching-input",
  }),
  [COACHING_REASON.noTurns]: Object.freeze({
    title: "There is nothing to grade yet.",
    guidance: "Paste the prompt you sent, or the exchange around it, into the box and grade it again.",
    control: "prompt-coaching-input",
  }),
  [COACHING_REASON.noScorableTurn]: Object.freeze({
    title: "That paste is all code and carried-in material.",
    guidance: "Add the request itself in prose — what you want, under what constraints, and what a correct answer looks like. Code and pasted logs are context; they are not the ask.",
    control: "prompt-coaching-input",
  }),
});

/**
 * The plain answer to the one question, by letter.
 *
 * ASSUMPTION: a reader who has to convert a letter into a decision is doing the
 * surface's job. The bands are the rubric's own, so a wording change here can
 * never move a cutoff, and a cutoff change here is a rubric change.
 */
export const COACHING_ANSWER = Object.freeze({
  A: "Yes. This prompt says what it needs.",
  B: "Yes, with one thing left implicit.",
  C: "Probably — but it leaves the model a choice to make.",
  D: "Not reliably. Too much of the ask is left for the model to choose.",
  F: "No. As written, this states almost nothing the rubric asks a request for.",
});

/**
 * THE SENTENCE THAT BOUNDS EVERY ROUTING CLAIM.
 *
 * Appended verbatim to every piece of copy that tells a reader to change model
 * tiers, rather than reworded per surface, so a director who disputes it has
 * disputed all of them and there is no second, softer version of it.
 *
 * ASSUMPTION: a routing recommendation is the one coaching claim that costs a
 * reader money to act on, so it is the one that will be disputed first, and a
 * single unbacked clause beside it invalidates the backed part along with
 * itself. The model-fit axis observes exactly two things — the tier the reader
 * named and how much prose or pasted code a turn carried — so those two things
 * are the whole of what may be said. Nothing in this repository measures the
 * answer a model gave, whether a follow-up turn happened, or what anything
 * cost, and therefore nothing here may claim any of the three.
 */
export const ROUTING_CLAIM_LIMIT = "This workflow reads the text you pasted and the tier "
  + "you named. It measures no answer, no follow-up turn, and no spend, and claims none.";

/**
 * The tier a reader picks, expressed as an identifier the shared model
 * classifier already reads. There is no second tier table in this repository,
 * and the test asserts each value classifies to the tier it is filed under.
 *
 * `null` is the honest default: when a reader does not say which model they
 * used, the model-fit signals abstain rather than assume a tier.
 */
export const MODEL_TIER_EXAMPLES = Object.freeze({
  premium: "ultra",
  standard: "pro",
  economy: "mini",
});

const AXES = PROMPT_LITERACY_RUBRIC.axes;
const AXIS_WEIGHT = new Map(AXES.map((axis) => [axis.key, axis.weightPercent / 100]));
const AXIS_LABEL = new Map(AXES.map((axis) => [axis.key, axis.label]));
const GRADES = PROMPT_LITERACY_RUBRIC.grades;
const CONTRIBUTION_DECIMALS = PROMPT_LITERACY_RUBRIC.reporting.contributionDecimals;

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Reading the box into turns
// ---------------------------------------------------------------------------

/**
 * Role labels a pasted conversation uses, at the start of a line.
 *
 * ASSUMPTION: people paste conversations the way chat surfaces print them —
 * "User:", "Assistant:", "Me:". Two lists, not a guess: a label outside both is
 * not a role marker, so an ordinary sentence beginning "Note:" stays prose.
 *
 * The consequence is stated rather than hidden: a prompt containing a line that
 * begins "Response:" is split into two turns. Credit signals fire once per turn
 * on presence, so a wrong split costs a well-formed prompt very little, and a
 * reader who sees the turn count in the disclosure can remove the label.
 */
const USER_MARKERS = Object.freeze(["user", "me", "human", "prompt", "requester"]);
const OTHER_MARKERS = Object.freeze([
  "assistant", "ai", "model", "bot", "reply", "response", "system", "chatgpt", "claude",
]);
const ROLE_MARKER = new RegExp(
  `^[ \\t]*(${[...USER_MARKERS, ...OTHER_MARKERS].join("|")})[ \\t]*:[ \\t]*`, "i",
);
const FENCE = /^[ \t]*(```|~~~)/;

/**
 * Split pasted text into turns.
 *
 * Fence-aware, because a role label inside a fenced code block is code and
 * splitting on it would cut a block in half. The fence rule is the segmenter's
 * own, so a block this splitter keeps whole is a block that module also reads
 * as code.
 *
 * @param {string} text the pasted text. Untrusted; never retained by the result
 *   of `gradeMyPrompt`, which is the only exported consumer of the bodies here.
 * @returns {{turns: Array<{role: string, body: string}>, labelled: boolean}}
 *   `labelled` is false when no marker was found, in which case the whole paste
 *   is one user turn — the common case, and the one a reader gets by pasting a
 *   single prompt with nothing around it.
 */
export function parseCoachingInput(text) {
  const raw = typeof text === "string" ? text : "";
  const lines = raw.split(/\r?\n/);
  const turns = [];
  let current = null;
  let inFence = false;
  let labelled = false;
  for (const line of lines) {
    if (FENCE.test(line)) inFence = !inFence;
    const marker = inFence ? null : line.match(ROLE_MARKER);
    if (marker) {
      labelled = true;
      const label = marker[1].toLowerCase();
      current = {
        role: USER_MARKERS.includes(label) ? "user" : "assistant",
        lines: [line.slice(marker[0].length)],
      };
      turns.push(current);
      continue;
    }
    if (!current) {
      current = { role: "user", lines: [] };
      turns.push(current);
    }
    current.lines.push(line);
  }
  return Object.freeze({
    turns: Object.freeze(turns.map((turn) => Object.freeze({
      role: turn.role, body: turn.lines.join("\n"),
    }))),
    labelled,
  });
}

// ---------------------------------------------------------------------------
// The one prioritized improvement
// ---------------------------------------------------------------------------

/**
 * What to do about each signal, in the reader's words.
 *
 * `fix` is what a fired debit asks for; `add` is what an unfired credit asks
 * for. Every signal declares whichever of the two its weight can produce, and
 * the module refuses to load if one is missing — the same shape the classifier
 * uses to refuse a signal that states no assumption.
 */
export const IMPROVEMENT_COPY = Object.freeze({
  "intent-states-context": Object.freeze({
    add: Object.freeze({
      title: "State the setting before the ask.",
      guidance: "One line of context — what you are building, what is already true, what broke — is the largest single move available on the axis worth half the grade.",
    }),
  }),
  "intent-states-constraints": Object.freeze({
    add: Object.freeze({
      title: "Say what the answer may not do.",
      guidance: "Name the boundaries: what must not change, which approach is out, how long the answer may be. Constraints are how a model narrows a wide question without guessing.",
    }),
  }),
  "intent-states-acceptance": Object.freeze({
    add: Object.freeze({
      title: "Say what a correct answer looks like.",
      guidance: "Write the acceptance criterion — the shape of the output, the case it has to handle, the thing you will check first. It is the difference between one pass and three.",
    }),
  }),
  "intent-structured-layout": Object.freeze({
    add: Object.freeze({
      title: "Break the request into labelled parts.",
      guidance: "Two labelled lines or a short numbered list. Layout is the one intent signal that survives translation, so it lifts a request written in any language.",
    }),
  }),
  "intent-pasted-context": Object.freeze({
    add: Object.freeze({
      title: "Paste the material you are talking about.",
      guidance: "The error, the row, the paragraph. It is worth less than saying what the material is for, so pair it with a sentence naming the question.",
    }),
  }),
  "intent-vague-request": Object.freeze({
    fix: Object.freeze({
      title: "Replace the placeholder words with the thing itself.",
      guidance: "“Something”, “improve this”, “as needed” hand the model the decision you were asking it to check. Name the object and the change you want.",
    }),
  }),
  "intent-out-of-scope": Object.freeze({
    fix: Object.freeze({
      title: "This reads as personal, not work.",
      guidance: "The rubric scores work traffic. Non-business requests earn no credit on any axis, so grade a work prompt here — and keep personal use off the corporate gateway.",
    }),
  }),
  "efficiency-repeated-request": Object.freeze({
    fix: Object.freeze({
      title: "Fold the repeat back into the first request.",
      guidance: "Asking again costs a whole call. Whatever the retry added — the failing case, the format, the constraint — belongs in the opening turn instead.",
    }),
  }),
  "efficiency-corrected-request": Object.freeze({
    fix: Object.freeze({
      title: "Say what you meant, once, up front.",
      guidance: "A correction turn is a call spent restating the question. The correction itself is usually the missing constraint; put it in the first ask.",
    }),
  }),
  "efficiency-scattered-questions": Object.freeze({
    fix: Object.freeze({
      title: "Ask one question at a time.",
      guidance: "Four questions in a short turn produce one answer that addresses none of them fully. Send the one that blocks you and keep the rest for the next turn.",
    }),
  }),
  "model-fit-trivial-on-premium": Object.freeze({
    fix: Object.freeze({
      title: "Send mechanical edits to a smaller model.",
      guidance: "A rename, a reformat, a typo fix does not need a frontier model. This is the routing error the model-fit axis exists to name, and it is the largest debit on it.",
    }),
  }),
  "model-fit-substantive-on-economy": Object.freeze({
    fix: Object.freeze({
      // ROUTE-UP GUIDANCE, DELIBERATELY NARROW. An earlier draft of this entry
      // said the mismatch "costs quality rather than money, and the cost lands
      // on you in re-prompts". Nothing in this repository measures answer
      // quality, a re-prompt caused by a tier, or a dollar, so that sentence was
      // an outcome claim with no signal behind it — the kind of number a
      // director is right to throw out along with everything beside it. What the
      // rubric actually observed is one boolean: a turn at or above the
      // substantive-work threshold on a tier the reader named as economy. This
      // copy states that and stops.
      title: "Route this request up a tier.",
      guidance: "You named an economy model, and this request is at or above the rubric's "
        + "substantive-work threshold in prose length or pasted code. That is the whole of "
        + `what fired the signal. ${ROUTING_CLAIM_LIMIT}`,
    }),
  }),
  "model-fit-substantive-on-premium": Object.freeze({
    add: Object.freeze({
      title: "Give the premium model something substantial to do.",
      guidance: "Length is the only evidence of substance that survives translation, so this credit is earned by a request that carries its own detail rather than by asking for more.",
    }),
  }),
});

/**
 * A ready-to-edit rewrite for every move the ranker can put first.
 *
 * These are deliberately static templates rather than interpolations of the
 * paste. That makes the recommendation immediately usable while preserving
 * the stronger privacy contract above: prompt text never enters the result
 * object or gets copied into a second DOM node.
 */
export const IMPROVEMENT_REWRITE = Object.freeze({
  "intent-states-context":
    "Context: I’m working on [system or task]. [Relevant current state or failure].\nRequest: [specific outcome you need].",
  "intent-states-constraints":
    "Please [specific outcome]. Keep [thing that must remain unchanged], do not [excluded approach], and limit the response to [length or format].",
  "intent-states-acceptance":
    "Please [specific outcome]. A correct answer must [observable check], handle [important case], and return [required format].",
  "intent-structured-layout":
    "Context: [what is already true]\nRequest: [one specific outcome]\nConstraints: [boundaries]\nSuccess: [what you will verify]",
  "intent-pasted-context":
    "Context: [what you are trying to do]\nMaterial:\n[paste the error, row, or paragraph]\nQuestion: [one thing you need answered about it]",
  "intent-vague-request":
    "Change [named object] from [current behavior] to [required behavior]. Keep [constraint]. I’ll verify it by [specific check].",
  "intent-out-of-scope":
    "For this work task, help me [specific business outcome]. Use [work context] and return [work-ready format].",
  "efficiency-repeated-request":
    "The earlier attempt failed because [specific case]. Please [complete request] and make sure the result [acceptance check].",
  "efficiency-corrected-request":
    "Please [corrected request]. By [ambiguous term], I mean [precise meaning]. Keep [constraint] and return [format].",
  "efficiency-scattered-questions":
    "First question: [the single question blocking progress]. Answer with [format or decision needed].",
  "model-fit-trivial-on-premium":
    "Using a smaller model: [make the exact mechanical edit]. Return only [changed text or requested format].",
  "model-fit-substantive-on-economy":
    "Using a stronger model: Context: [relevant system]. Request: [substantive outcome]. Constraints: [boundaries]. Success: [checks].",
  "model-fit-substantive-on-premium":
    "Context: [relevant system and current state]. Request: [substantive outcome]. Constraints: [boundaries]. Success: [checks].",
});

for (const signal of PROSE_SIGNALS) {
  const copy = IMPROVEMENT_COPY[signal.id];
  if (!copy || !(signal.weight > 0 ? copy.add : copy.fix)
    || !IMPROVEMENT_REWRITE[signal.id]) {
    throw new RangeError(`prompt coaching: ${signal.id} has no coaching copy`);
  }
}

/**
 * Signals a reader can act on by rewriting, as opposed to by routing.
 *
 * ASSUMPTION: credits are only *suggested* on the intent axis, because it is
 * the only axis the rubric says a person moves by rewriting the request.
 * Efficiency is lost and never earned — no prompt can prove it would not have
 * needed a second turn — and the one model-fit credit is earned by the work
 * being substantial, not by asking for it. Debits are suggested on every axis:
 * a fired debit is measured evidence, whichever axis it landed on.
 */
const SUGGESTABLE_CREDIT_AXIS = "intent";

/**
 * Would the classifier have let this signal read this turn?
 *
 * Mirrors the classifier's own eligibility rule for a *credit*: a derived or
 * language-agnostic signal always reads, a vocabulary signal reads a turn the
 * script check did not flag, and in a mixed turn credits still read because
 * there is Latin prose in it. Stated here so an unfired credit is never
 * suggested to a reader whose turn the vocabulary table cannot read at all.
 */
function creditCouldFire(signal, turn) {
  if (signal.requiresModelTier && signal.requiresModelTier !== turn.modelTier) return false;
  if (signal.languageAgnostic || signal.derived) return true;
  return !turn.segments.languageUncertain || turn.segments.languageMixed;
}

/**
 * Rank every candidate improvement by the composite points it is worth, and
 * return the first.
 *
 * THE ESTIMATE, STATED PLAINLY. A candidate's `points` is its weight on the
 * composite scale: the signal's own weight, times its axis's share of the
 * composite, times the turn's share of the conversation's prose-length weight —
 * the same weights `aggregateTurnScores` used, read from its payload rather
 * than recomputed. A credit is additionally capped by the headroom left on that
 * axis in that turn, so a suggestion is never worth more than the axis can
 * still gain. It is an estimate and is labelled one: dimension scores clamp at
 * 0 and 100, so a debit that drove an axis to the floor cost less than its
 * weight, and this ranking does not model the clamp.
 *
 * Ties break measured-before-projected (a fired debit is evidence; an unfired
 * credit is a projection), then on the signal id, so the same paste always
 * yields the same first move.
 */
export function rankImprovements(reasons) {
  const aggregation = reasons?.aggregation;
  const turns = (reasons?.turns ?? []).filter((turn) => turn?.scored);
  if (!aggregation || !turns.length) return Object.freeze([]);
  const weights = aggregation.turnWeights ?? [];
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;

  const candidates = [];
  turns.forEach((turn, at) => {
    const turnShare = (weights[at] ?? 0) / totalWeight;
    for (const signal of PROSE_SIGNALS) {
      const axisWeight = AXIS_WEIGHT.get(signal.dimension) ?? 0;
      const dimension = turn.dimensions[signal.dimension];
      const fired = dimension.signals.find((entry) => entry.id === signal.id);
      if (signal.weight < 0) {
        if (!fired) continue;
        candidates.push({
          id: signal.id,
          kind: "fix",
          measured: true,
          dimension: signal.dimension,
          turn: turn.index,
          points: roundTo(Math.abs(fired.contribution) * axisWeight * turnShare, CONTRIBUTION_DECIMALS),
        });
        continue;
      }
      if (fired || signal.dimension !== SUGGESTABLE_CREDIT_AXIS) continue;
      if (!creditCouldFire(signal, turn)) continue;
      const headroom = Math.max(0, 100 - dimension.score);
      candidates.push({
        id: signal.id,
        kind: "add",
        measured: false,
        dimension: signal.dimension,
        turn: turn.index,
        points: roundTo(Math.min(signal.weight, headroom) * axisWeight * turnShare,
          CONTRIBUTION_DECIMALS),
      });
    }
  });

  return Object.freeze(candidates
    .filter((candidate) => candidate.points > 0)
    .sort((left, right) => right.points - left.points
      || Number(right.measured) - Number(left.measured)
      || left.id.localeCompare(right.id))
    .map((candidate) => Object.freeze({
      ...candidate,
      axis: AXIS_LABEL.get(candidate.dimension) ?? candidate.dimension,
      assumptionKey: PROSE_SIGNALS.find((signal) => signal.id === candidate.id).assumptionKey,
      ...(candidate.kind === "fix"
        ? IMPROVEMENT_COPY[candidate.id].fix : IMPROVEMENT_COPY[candidate.id].add),
      rewrite: IMPROVEMENT_REWRITE[candidate.id],
    })));
}

/** The improvement slot when the ranking is empty. Never a blank panel. */
const NOTHING_TO_IMPROVE = Object.freeze({
  available: false,
  kind: "none",
  id: null,
  dimension: null,
  axis: null,
  turn: null,
  points: 0,
  assumptionKey: null,
  title: "There is no higher-value change left to name.",
  guidance: "Nothing this rubric penalises fired, and no further intent credit is both available and worth points on this text. Grade a harder prompt, or import a conversation export to see how a whole team's traffic scores.",
  rewrite: null,
});

// ---------------------------------------------------------------------------
// The one benchmark
// ---------------------------------------------------------------------------

/**
 * The score, the letter, and the one comparison that makes them mean something:
 * the next band up and the distance to it. One benchmark, because deciding
 * which of two headline figures matters is this composition's job, not the
 * reader's.
 */
export function composeBenchmark(composite) {
  const score = Number.isFinite(composite) ? composite : 0;
  const letter = letterGradeForScore(score);
  const at = GRADES.findIndex((grade) => grade.letter === letter);
  const band = GRADES[at];
  const next = at > 0 ? GRADES[at - 1] : null;
  return Object.freeze({
    score,
    grade: letter,
    scoreText: `${score} / 100`,
    gradeText: `Grade ${letter}`,
    bandRule: `${letter} starts at ${band.minimumScore}.`,
    next: next ? Object.freeze({
      letter: next.letter,
      minimumScore: next.minimumScore,
      pointsAway: roundTo(next.minimumScore - score, 0),
    }) : null,
    text: next
      ? `${score} / 100 · grade ${letter}. ${next.letter} starts at ${next.minimumScore}: `
        + `${roundTo(next.minimumScore - score, 0)} point`
        + `${roundTo(next.minimumScore - score, 0) === 1 ? "" : "s"} away.`
      : `${score} / 100 · grade ${letter}. Nothing above this band.`,
  });
}

/**
 * What this letter may be used for, in the vocabulary the rest of the page
 * already uses for a figure that is real but incomplete.
 *
 * A pasted prompt is always `Partial result`: it is one text, and the floor for
 * grading even a single department from a reader's own prompts is Noor's
 * `minPromptsPerDepartment`. Quoting that number is the difference between "not
 * a team grade" and a reader deciding for themselves how far to carry it.
 */
function composeBasis(scoredTurns) {
  return Object.freeze({
    label: `${TRUST_LABEL.partial} · this text only`,
    text: `Graded from the ${scoredTurns} turn${scoredTurns === 1 ? "" : "s"} you pasted, `
      + "in this browser tab. Nothing was uploaded, saved, or attached to your organization's grade — "
      + `that needs ${PROMPT_GRADING_THRESHOLDS.minPromptsPerDepartment} classified prompts in a `
      + "department before it speaks for one.",
  });
}

// ---------------------------------------------------------------------------
// The one routing recommendation
// ---------------------------------------------------------------------------
//
// WHAT MAY BE SAID ABOUT ROUTING, AND WHAT MAY NOT.
//
// The model-fit axis observes exactly two things: the tier the reader named
// beside the box, and how much prose or pasted code a turn carried. From those
// two it fires one of three signals. Everything this block says is a restatement
// of one of those signals plus the constants it fired against; nothing here
// measures the answer a model gave, whether a follow-up turn happened, or what
// anything cost, and therefore nothing here may claim any of the three.
//
// That is not a stylistic preference. A routing recommendation is the one
// coaching claim that costs a reader money to act on, so it is the one a
// director will dispute first, and a single unbacked clause beside it
// ("...and the cost lands on you in re-prompts") invalidates the backed part
// along with itself. The rule enforced in tests is: every sentence rendered here
// traces to a signal id, a rubric constant, or the tier the reader typed.

/** The routing decision each model-fit signal is evidence for. */
const MODEL_FIT_SIGNAL = Object.freeze({
  routeDown: "model-fit-trivial-on-premium",
  routeUp: "model-fit-substantive-on-economy",
  fitEvidenced: "model-fit-substantive-on-premium",
});

/** Stable wire states. A surface switches on these, never on a sentence. */
export const RECOMMENDATION_STATE = Object.freeze({
  noTierStated: "no_tier_stated",
  routeDown: "route_down",
  routeUp: "route_up",
  fitEvidenced: "fit_evidenced",
  noEvidence: "no_routing_evidence",
});

/**
 * The tiers this workflow can move between, strongest first.
 *
 * ASSUMPTION: the rubric evidences a *direction*, never a destination — no
 * signal here compares two tiers on anything. So a recommendation names the
 * adjacent tier, which is the smallest move that stops the fired signal reading
 * this turn at all (both routing debits are gated on one specific tier). Naming
 * the adjacent tier rather than "the cheapest one that would do" is the whole
 * of the restraint: the second is a claim about model capability, and this
 * repository holds no evidence about model capability.
 */
export const RECOMMENDATION_TIER_LADDER = Object.freeze(
  MODEL_TIERS.filter((tier) => tier !== UNRECOGNIZED_TIER),
);

// The billing contract's vocabulary already lists its tiers strongest first,
// and this ladder is that list minus the member that is not a tier. Read rather
// than restated, so a tier added there cannot leave a stale ladder here — but
// asserted too, because reading a list in the right order is a property of that
// list and not of this line.
if (RECOMMENDATION_TIER_LADDER.join(">") !== "premium>standard>economy") {
  throw new RangeError("prompt coaching: the model tier ladder is not strongest-first");
}

/**
 * Which routing reading is reported when more than one fires across turns.
 *
 * ASSUMPTION: largest absolute weight first, which is also worst-reading-first
 * — the same habit `deriveTurnCategory` uses, so an ambiguous conversation is
 * never described as the better of its readings. Ordered from the signal table
 * rather than by hand, so a weight change reorders this and cannot leave a
 * stale precedence behind.
 */
const MODEL_FIT_AXIS = PROSE_SIGNALS
  .find((signal) => signal.id === MODEL_FIT_SIGNAL.routeUp).dimension;
const MODEL_FIT_TABLE = PROSE_SIGNALS.filter((signal) => signal.dimension === MODEL_FIT_AXIS);
// `step` is an offset into RECOMMENDATION_TIER_LADDER, which runs strongest
// first: routing *down* a tier moves one place later in it, routing up moves one
// place earlier. `direction` is declared beside it rather than derived from its
// sign, because the two read in opposite directions and a reader checking this
// table should not have to hold that in their head.
const ROUTING_PRECEDENCE = Object.freeze([
  {
    state: RECOMMENDATION_STATE.routeDown, id: MODEL_FIT_SIGNAL.routeDown,
    step: 1, direction: "down",
  },
  {
    state: RECOMMENDATION_STATE.routeUp, id: MODEL_FIT_SIGNAL.routeUp,
    step: -1, direction: "up",
  },
  {
    state: RECOMMENDATION_STATE.fitEvidenced, id: MODEL_FIT_SIGNAL.fitEvidenced,
    step: 0, direction: "none",
  },
].sort((left, right) => Math.abs(weightOf(right.id)) - Math.abs(weightOf(left.id))));

function weightOf(id) {
  return MODEL_FIT_TABLE.find((signal) => signal.id === id)?.weight ?? 0;
}

for (const entry of ROUTING_PRECEDENCE) {
  if (!weightOf(entry.id)) {
    throw new RangeError(`prompt coaching: ${entry.id} is not a model-fit signal`);
  }
}

/** The tier a step moves to, or the same tier when the step is zero. */
function tierAfterStep(tier, step) {
  const at = RECOMMENDATION_TIER_LADDER.indexOf(tier);
  if (at < 0) return null;
  return RECOMMENDATION_TIER_LADDER[Math.min(
    RECOMMENDATION_TIER_LADDER.length - 1, Math.max(0, at + step),
  )] ?? null;
}

/** "a premium model" / "an economy model". The tier names are a closed set. */
const article = (tier) => (/^[aeiou]/.test(tier) ? "an" : "a");

function firedRecommendation(entry, tier, turn, fired) {
  const to = tierAfterStep(tier, entry.step);
  const points = Math.abs(fired.contribution);
  const copy = entry.state === RECOMMENDATION_STATE.routeDown
    ? {
      title: `Route this one down to ${to}.`,
      text: `You named ${article(tier)} ${tier} model, and this request is at or below the rubric's `
        + `mechanical-errand threshold of ${TRIVIAL_PROSE_UNITS} prose units with a `
        + `mechanical-edit phrasing in it. That fired ${entry.id}, which took ${points} `
        + `points off the ${AXIS_LABEL.get(MODEL_FIT_AXIS)} axis. ${to} is the smallest `
        + `move that stops the signal reading this turn. ${ROUTING_CLAIM_LIMIT}`,
    }
    : entry.state === RECOMMENDATION_STATE.routeUp
      ? {
        title: `Route this one up to ${to}.`,
        text: `You named ${article(tier)} ${tier} model, and this request is at or above the rubric's `
          + `substantive-work threshold of ${SUBSTANTIVE_PROSE_UNITS} prose units, or the `
          + `pasted-code equivalent. That fired ${entry.id}, which took ${points} points `
          + `off the ${AXIS_LABEL.get(MODEL_FIT_AXIS)} axis. ${to} is the smallest move `
          + `that stops the signal reading this turn. ${ROUTING_CLAIM_LIMIT}`,
      }
      : {
        title: `Keep this one on ${tier}.`,
        text: `You named ${article(tier)} ${tier} model, and this request is at or above the rubric's `
          + `substantive-work threshold of ${SUBSTANTIVE_PROSE_UNITS} prose units. That `
          + `fired ${entry.id}, the one routing credit the rubric awards, worth `
          + `${points} points on the ${AXIS_LABEL.get(MODEL_FIT_AXIS)} axis. No routing `
          + "change is evidenced.",
      };
  return Object.freeze({
    state: entry.state,
    from: tier,
    to,
    direction: entry.direction,
    evidenced: true,
    signalId: entry.id,
    assumptionKey: fired.assumptionKey,
    turn: turn.index,
    points: roundTo(points, CONTRIBUTION_DECIMALS),
    ...copy,
  });
}

function abstained(state, tier) {
  return Object.freeze({
    state,
    from: state === RECOMMENDATION_STATE.noTierStated ? null : tier,
    to: null,
    direction: "none",
    evidenced: false,
    signalId: null,
    assumptionKey: null,
    turn: null,
    points: 0,
    ...(state === RECOMMENDATION_STATE.noTierStated
      ? {
        title: "No tier was named, so none is recommended.",
        text: "The model-fit signals read the tier you name beside the box. Without one "
          + "they abstain rather than assume, so this grade carries no routing "
          + "recommendation and the model-fit axis kept its baseline of "
          + `${DIMENSION_BASELINES.modelFit}.`,
      }
      : {
        title: "No routing change is evidenced.",
        text: `You named ${article(tier)} ${tier} model and no model-fit signal fired on this text, so `
          + `the ${AXIS_LABEL.get(MODEL_FIT_AXIS)} axis kept its baseline of `
          + `${DIMENSION_BASELINES.modelFit}. This workflow names a tier only when a `
          + "model-fit signal fired, never on the shape of a request alone.",
      }),
  });
}

/**
 * The routing recommendation for one classified conversation.
 *
 * @param {object} reasons the classifier's reasons payload. Read, never
 *   recomputed: the fired signal and its contribution are the classifier's.
 * @param {string} tier the tier the reader named, already classified through
 *   `classifyModelTier`. Anything outside the ladder abstains.
 * @returns {object} frozen. Always present on a graded result, always carrying
 *   a state, and carrying a `signalId` exactly when `evidenced` is true.
 */
export function composeRecommendation(reasons, tier) {
  if (!RECOMMENDATION_TIER_LADDER.includes(tier)) {
    return abstained(RECOMMENDATION_STATE.noTierStated, tier);
  }
  const turns = (reasons?.turns ?? []).filter((turn) => turn?.scored);
  for (const entry of ROUTING_PRECEDENCE) {
    for (const turn of turns) {
      const fired = turn.dimensions[MODEL_FIT_AXIS].signals
        .find((signal) => signal.id === entry.id);
      if (fired) return firedRecommendation(entry, tier, turn, fired);
    }
  }
  return abstained(RECOMMENDATION_STATE.noEvidence, tier);
}

// ---------------------------------------------------------------------------
// The result
// ---------------------------------------------------------------------------

function refusal(reason, detail = {}) {
  return Object.freeze({
    version: PROMPT_COACHING_VERSION,
    question: COACHING_QUESTION,
    state: "not_gradeable",
    scored: false,
    reason,
    answer: null,
    benchmark: null,
    improvement: null,
    recommendation: null,
    basis: null,
    recovery: COACHING_RECOVERY[reason],
    observed: Object.freeze({ ...detail }),
    detail: null,
  });
}

/**
 * The turn-level disclosure: what the classifier could and could not read,
 * carried as counts and reason codes and nothing else.
 */
function composeTurnDetail(reasons) {
  return Object.freeze((reasons?.turns ?? []).map((turn) => Object.freeze({
    index: turn.index,
    role: turn.role,
    scored: turn.scored,
    modelTier: turn.modelTier,
    proseUnits: turn.segments.proseUnits,
    codeBlocks: turn.segments.codeBlocks,
    pastedBlocks: turn.segments.pastedBlocks,
    reasonCodes: turn.reasonCodes,
    category: turn.category,
  })));
}

/**
 * Grade one pasted prompt or short conversation.
 *
 * @param {{text?: string, modelTier?: string|null}} input the pasted text and,
 *   optionally, which tier of model the reader used. An unrecognized or absent
 *   tier makes the model-fit signals abstain — they never assume one.
 * @returns {object} frozen. Either a graded result — one answer, one benchmark,
 *   one prioritized improvement, and a progressive-disclosure detail block — or
 *   a refusal carrying a stable reason code and its recovery guidance. Never
 *   both, and never a partially filled result.
 */
export function gradeMyPrompt({ text, modelTier = null } = {}) {
  if (text !== undefined && text !== null && typeof text !== "string") {
    return refusal(COACHING_REASON.unsupportedInput);
  }
  const raw = typeof text === "string" ? text : "";
  if (!raw.trim()) return refusal(COACHING_REASON.emptyInput);
  if (raw.length > COACHING_INPUT_LIMITS.maxChars) {
    return refusal(COACHING_REASON.tooLong, {
      chars: raw.length, maxChars: COACHING_INPUT_LIMITS.maxChars,
    });
  }

  const { turns, labelled } = parseCoachingInput(raw);
  if (turns.length > COACHING_INPUT_LIMITS.maxTurns) {
    return refusal(COACHING_REASON.tooManyTurns, {
      turns: turns.length, maxTurns: COACHING_INPUT_LIMITS.maxTurns,
    });
  }
  if (!turns.some((turn) => turn.role === "user")) {
    return refusal(COACHING_REASON.noUserTurn, { turns: turns.length });
  }

  const model = MODEL_TIER_EXAMPLES[modelTier] ?? null;
  const graded = classifyConversation({ turns, model });
  if (!graded.scored) {
    return refusal(COACHING_REASON[graded.reason === CONVERSATION_REASON_CODES.noTurns
      ? "noTurns" : "noScorableTurn"], {
      turns: turns.length,
      // Which refusal the classifier made, per turn, so the recovery guidance
      // above is checkable rather than asserted.
      turnReasonCodes: Object.freeze((graded.reasons?.turns ?? [])
        .flatMap((turn) => turn.reasonCodes)
        .filter((code, at, all) => all.indexOf(code) === at)),
    });
  }

  const ranked = rankImprovements(graded.reasons);
  const scoredTurns = (graded.reasons?.turns ?? []).filter((turn) => turn.scored);
  const benchmark = composeBenchmark(graded.composite);
  const tier = classifyModelTier(model);
  const recommendation = composeRecommendation(graded.reasons, tier);
  return Object.freeze({
    version: PROMPT_COACHING_VERSION,
    rubricVersionId: graded.rubricVersionId,
    classifierVersion: graded.version,
    question: COACHING_QUESTION,
    state: "graded",
    scored: true,
    reason: null,
    /** The answer to the one question, before any figure. */
    answer: COACHING_ANSWER[benchmark.grade],
    benchmark,
    improvement: ranked[0]
      ? Object.freeze({ available: true, ...ranked[0] })
      : NOTHING_TO_IMPROVE,
    /**
     * The routing answer, separate from the rewrite answer because they are
     * acted on by different people: a reader rewrites the prompt, a platform
     * owner moves the tier. Always present, and abstaining out loud when no
     * model-fit signal fired.
     */
    recommendation,
    basis: composeBasis(scoredTurns.length),
    observed: Object.freeze({
      turns: turns.length,
      scoredTurns: scoredTurns.length,
      labelled,
      modelTier: tier,
    }),
    /**
     * Progressive disclosure. Everything a reader needs to dispute the letter,
     * and nothing they need to read it: the axis subscores, the rubric version,
     * the runners-up in the ranking, and the per-turn reason codes.
     */
    detail: Object.freeze({
      progressive: true,
      rubricVersionId: graded.rubricVersionId,
      axes: Object.freeze(AXES.map((axis) => Object.freeze({
        key: axis.key,
        label: axis.label,
        weightPercent: axis.weightPercent,
        score: graded.dimensions[axis.key],
        assumption: axis.assumption,
      }))),
      category: graded.category,
      improvements: ranked,
      // Every assumption behind a claim this result displays, keyed so a reader
      // disputing one can quote the key. The routing recommendation's is in
      // here too when it fired: a tier recommendation with no stated assumption
      // behind it is the shape of claim this workflow refuses to make.
      assumptions: Object.freeze(Object.fromEntries([
        ...ranked.map((entry) => entry.assumptionKey),
        recommendation.assumptionKey,
      ]
        .filter((key) => Boolean(key && SIGNAL_ASSUMPTIONS[key]))
        .map((key) => [key, SIGNAL_ASSUMPTIONS[key]]))),
      turns: composeTurnDetail(graded.reasons),
      unreadableCodes: Object.freeze([TURN_REASON_CODES.languageUncertain,
        TURN_REASON_CODES.languageMixed]),
      aggregation: graded.reasons.aggregation,
    }),
  });
}
