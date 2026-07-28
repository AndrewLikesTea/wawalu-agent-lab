// The reading order of a coached result, as data.
//
// WHY THIS EXISTS SEPARATELY FROM prompt-coaching-view.js.
// `prompt-coaching-view.js` paints one result into one place: the ids are
// singletons, the panel is the page's, and the reading order is expressed in
// the order of its `append` calls. That is fine for one surface and useless for
// three things this issue needs:
//
//   1. A SPECIMEN. Every state has to be drawable side by side, before the
//      entry flow is wired to any of it, which means more than one result on a
//      page and therefore no singleton ids.
//   2. STATES THE ENGINE DOES NOT RETURN. `gradeMyPrompt` is synchronous, so it
//      has no loading state and no out-of-range figure. A surface still has
//      both: a caller that grades off the main thread paints something while it
//      waits, and any figure crossing a module boundary can arrive wrong. A
//      state that is never drawn is a state that ships undesigned.
//   3. AN ASSERTABLE ORDER. "Grade, then benchmark, then one action, then the
//      evidence" is the whole design claim of this surface. Held as a list, it
//      is a test; held as call order in a paint function, it is a code review.
//
// THE ORDER, AND WHY IT IS THIS ONE. A reader arrives with one question and a
// piece of text. They get the answer (grade), the material that makes the
// answer mean something (benchmark), and exactly one thing to do about it
// (action). Everything else — the routing reading, the counts, the axis
// subscores, the per-turn codes — is dispute material, and dispute material
// read before the answer is noise. It goes behind disclosures, in that order.
//
// EXACTLY ONE ACTION. Not "the actions region": one. Two next steps of equal
// weight is the failure this surface is designed against — a reader who has to
// choose which of two things to do first has been handed the ranking job the
// rubric already did. `presentCoachingResult` throws if a model is ever built
// with a second one, because a silent second action reads as a design choice.
//
// PRIVACY. This module reads a session envelope, which carries measurements of
// the analyzed text and never the text (see prompt-coaching-contract.js). It
// therefore has no access to prompt content and produces none: every string
// below is either static copy, a count, or an identifier. Asserted in
// tests/coaching-result-presentation.test.js against a marker string.
//
// DETERMINISM. Pure and synchronous, no clock and no randomness, so the same
// session renders the same specimen on every machine.

import { COACHING_INPUT_LIMITS } from "./prompt-coaching.js";
import { COACHING_OUTCOME, COACHING_OUTCOME_STATES } from "./prompt-coaching-contract.js";

/**
 * The states a surface paints. The four the contract can return, plus the one
 * a surface owns rather than the engine: `loading`.
 */
export const PRESENTATION_STATUS = Object.freeze({
  loading: "loading",
  graded: COACHING_OUTCOME.graded,
  empty: COACHING_OUTCOME.empty,
  invalidInput: COACHING_OUTCOME.invalidInput,
  unsupportedContent: COACHING_OUTCOME.unsupportedContent,
});

/** The reading order, strongest claim first. Regions render in this sequence. */
export const PRESENTATION_ORDER = Object.freeze([
  "grade", "benchmark", "action", "evidence", "rubric",
]);

/**
 * Tone names, not colors. Each maps to a role already in evolution.css — the
 * import palette for an answer, the warn tokens for a recoverable state, the
 * error tokens for a rejected one — and no tone is ever the only carrier of its
 * meaning: every toned thing on this surface also has a word and a shape.
 */
export const PRESENTATION_TONE = Object.freeze({
  answer: "answer",
  pending: "pending",
  caution: "caution",
  blocked: "blocked",
});

const TONE_BY_STATUS = Object.freeze({
  [PRESENTATION_STATUS.loading]: PRESENTATION_TONE.pending,
  [PRESENTATION_STATUS.graded]: PRESENTATION_TONE.answer,
  [PRESENTATION_STATUS.empty]: PRESENTATION_TONE.caution,
  [PRESENTATION_STATUS.invalidInput]: PRESENTATION_TONE.blocked,
  [PRESENTATION_STATUS.unsupportedContent]: PRESENTATION_TONE.caution,
});

/**
 * The third cue, after the word and the value. Distinct silhouettes rather than
 * five weights of one dot: a reader scanning a column of specimens tells the
 * states apart at a glance, and a reader who cannot see color tells them apart
 * at all. Decorative in the DOM — the word beside each is the accessible name.
 */
const SHAPE_BY_STATUS = Object.freeze({
  [PRESENTATION_STATUS.loading]: "◌",
  [PRESENTATION_STATUS.graded]: "●",
  [PRESENTATION_STATUS.empty]: "○",
  [PRESENTATION_STATUS.invalidInput]: "■",
  [PRESENTATION_STATUS.unsupportedContent]: "◆",
});

/**
 * The word for each state. Read from the contract's own state table rather than
 * restated, so a label change lands in one place; `loading` is this module's,
 * because the contract has no loading state to name.
 */
const STATUS_LABEL = Object.freeze({
  [PRESENTATION_STATUS.loading]: "Grading",
  ...Object.fromEntries(COACHING_OUTCOME_STATES.map((state) => [state.outcome, state.label])),
});

const STATUS_MEANING = Object.freeze({
  [PRESENTATION_STATUS.loading]: "The rubric is reading the text in this tab. Nothing has been sent anywhere.",
  ...Object.fromEntries(COACHING_OUTCOME_STATES.map((state) => [state.outcome, state.meaning])),
});

const PENDING = "—";

/**
 * What stands in for the answer when a figure it rests on is out of range. The
 * letter is withheld rather than printed with a caveat beside it: a caveat is
 * cropped by every skim, and a grade nobody can trust is worse than no grade.
 */
const WITHHELD_ANSWER = "A figure behind this grade is outside the scale it is measured on, "
  + "so the letter is not shown. The evidence below is unchanged and still readable.";

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

const number = (value) => (Number.isFinite(value) ? value.toLocaleString("en-US") : String(value));

// ---------------------------------------------------------------------------
// The implausible-extreme audit
// ---------------------------------------------------------------------------

/**
 * Bounds every figure this surface prints has to satisfy to be worth printing.
 *
 * WHY A SURFACE CHECKS ITS OWN INPUTS. Nothing in the shipped engine produces
 * a composite of 4,000 or an estimate worth more points than the whole scale —
 * the rubric clamps, and the contract tests pin it. But this surface is a
 * primitive: it will be handed sessions by a caller, and the day one arrives
 * with a broken figure the honest thing to draw is "this figure is out of
 * range", not a confident letter beside a number that cannot be true. The
 * alternative — printing it — is how a wrong number becomes a decision.
 *
 * Each bound names the field, so a notice quotes something a reader can repeat.
 */
const FIGURE_BOUNDS = Object.freeze([
  Object.freeze({
    code: "score_out_of_range",
    label: "Composite score",
    read: (session) => session.result?.benchmark?.score,
    ok: (value) => Number.isFinite(value) && value >= 0 && value <= 100,
    guidance: "The composite is a 0–100 scale. This figure is outside it, so the letter beside it is not trustworthy either.",
  }),
  Object.freeze({
    code: "band_distance_negative",
    label: "Distance to the next band",
    read: (session) => session.result?.benchmark?.next?.pointsAway,
    ok: (value) => value === undefined || value === null || (Number.isFinite(value) && value >= 0),
    guidance: "A band above this one cannot already be reached. Read the letter, not the distance.",
  }),
  Object.freeze({
    code: "estimate_out_of_range",
    label: "What the change is worth",
    read: (session) => session.result?.improvement?.points,
    ok: (value) => value === undefined || (Number.isFinite(value) && value >= 0 && value <= 100),
    guidance: "An estimate is a share of the same 0–100 composite, so it cannot exceed it. The change may still be the right one; the figure is not.",
  }),
  Object.freeze({
    code: "turns_over_ceiling",
    label: "Turns read",
    // Graded sessions only. A refusal that read 22 turns is the ceiling doing
    // its job, and flagging it would call the workflow's own correct behaviour
    // an error on the one surface a reader consults to understand it.
    applies: (session) => session.outcome === COACHING_OUTCOME.graded,
    read: (session) => session.input?.turns,
    ok: (value) => value === null || value === undefined
      || (Number.isInteger(value) && value >= 0 && value <= COACHING_INPUT_LIMITS.maxTurns),
    guidance: `This workflow refuses more than ${COACHING_INPUT_LIMITS.maxTurns} turns, so a graded result cannot have read more.`,
  }),
  Object.freeze({
    code: "scored_turns_exceed_turns",
    label: "Turns the rubric scored",
    read: (session) => session.input?.scoredTurns,
    ok: (value, session) => !Number.isFinite(session.input?.turns)
      || (Number.isInteger(value) && value >= 0 && value <= session.input.turns),
    guidance: "More turns were scored than were read, so the counts disagree with each other.",
  }),
]);

/**
 * Every figure that fails its bound, in the order the bounds are declared.
 *
 * @returns {ReadonlyArray<{code: string, label: string, value: string, guidance: string}>}
 *   empty for every session the shipped engine produces.
 */
export function auditFigures(session) {
  if (!session || typeof session !== "object") return Object.freeze([]);
  return Object.freeze(FIGURE_BOUNDS
    .filter((bound) => !bound.applies || bound.applies(session))
    .map((bound) => ({ bound, value: bound.read(session) }))
    .filter(({ bound, value }) => value !== undefined && !bound.ok(value, session))
    .map(({ bound, value }) => Object.freeze({
      code: bound.code,
      label: bound.label,
      value: number(value),
      guidance: bound.guidance,
    })));
}

// ---------------------------------------------------------------------------
// Facts
// ---------------------------------------------------------------------------

/**
 * A labelled figure. The label is not decoration: it is what makes the value
 * readable out of context, in a screen reader, and in a column of specimens
 * where nothing but position would otherwise say what "38 / 100" is.
 */
function fact(label, value, { implausible = false, pending = false } = {}) {
  return Object.freeze({
    label, value: pending ? PENDING : value, implausible, pending,
  });
}

/** The audited figure, or the notice's replacement for it. Never both. */
function auditedFact(label, value, notices, code) {
  const notice = notices.find((entry) => entry.code === code);
  return notice
    ? fact(label, `out of range: ${notice.value}`, { implausible: true })
    : fact(label, value);
}

// ---------------------------------------------------------------------------
// The regions
// ---------------------------------------------------------------------------

function gradeRegion(status, session, notices) {
  const graded = status === PRESENTATION_STATUS.graded;
  const benchmark = session?.result?.benchmark;
  const scoreOk = graded && !notices.some((notice) => notice.code === "score_out_of_range");
  return Object.freeze({
    id: "grade",
    kind: "grade",
    rank: 1,
    heading: "The answer",
    disclosure: false,
    shape: SHAPE_BY_STATUS[status],
    // The big glyph, decorative in the DOM: `statusValue` and `answer` below
    // say the same thing in words, and a reader hearing both hears it twice.
    mark: scoreOk ? benchmark.grade : null,
    statusLabel: "Status",
    statusValue: STATUS_LABEL[status],
    answer: graded
      ? (scoreOk ? session.result.answer : WITHHELD_ANSWER)
      : STATUS_MEANING[status],
    // A refusal's stable code, printed because a reader disputing one quotes it.
    facts: Object.freeze(session?.reason
      ? [fact("Reason code", session.reason)]
      : []),
    notices,
  });
}

function benchmarkRegion(status, session, notices) {
  const region = { id: "benchmark", kind: "benchmark", rank: 2, heading: "What that is measured against", disclosure: false };
  if (status === PRESENTATION_STATUS.loading) {
    return Object.freeze({
      ...region,
      facts: Object.freeze([
        fact("Composite", "", { pending: true }),
        fact("Grade band", "", { pending: true }),
      ]),
      noteLabel: "Waiting",
      note: "The scale is 0–100 and the bands are the rubric's; neither depends on what you pasted.",
    });
  }
  if (status !== PRESENTATION_STATUS.graded) {
    // A refusal has a benchmark too: the ceiling it hit, as a count. It is the
    // one number that tells a reader what to trim to, so it is never buried.
    const observed = session?.result?.observed ?? {};
    const facts = [];
    if (Number.isFinite(observed.chars)) {
      facts.push(fact("Characters pasted", number(observed.chars)));
      facts.push(fact("Ceiling", number(observed.maxChars ?? COACHING_INPUT_LIMITS.maxChars)));
    }
    if (Number.isFinite(observed.turns)) {
      facts.push(fact("Turns read", number(observed.turns)));
      facts.push(fact("Ceiling", number(observed.maxTurns ?? COACHING_INPUT_LIMITS.maxTurns)));
    }
    if (!facts.length) facts.push(fact("Measured", "nothing the rubric could score"));
    return Object.freeze({
      ...region,
      facts: Object.freeze(facts),
      noteLabel: "Not scored",
      note: "No composite, no letter, and no partial grade: this workflow returns a state or an answer, never half of one.",
    });
  }
  const { benchmark, basis } = session.result;
  return Object.freeze({
    ...region,
    facts: Object.freeze([
      auditedFact("Composite", benchmark.scoreText, notices, "score_out_of_range"),
      fact("Grade band", `${benchmark.gradeText} · ${benchmark.bandRule}`),
      benchmark.next
        ? auditedFact(`To grade ${benchmark.next.letter}`,
          `${plural(benchmark.next.pointsAway, "point")} away (${benchmark.next.letter} starts at ${benchmark.next.minimumScore})`,
          notices, "band_distance_negative")
        : fact("Above this band", "nothing — this is the top of the scale"),
    ]),
    noteLabel: basis.label,
    note: basis.text,
  });
}

/**
 * The one thing to do. Exactly one, for every state including the ones with no
 * grade: a refusal's recovery guidance is a next action, and `control` names
 * the in-page control that acts on it so a surface can move focus rather than
 * describe a fix.
 */
function actionRegion(status, session) {
  const region = { id: "action", kind: "action", rank: 3, heading: "Do this first", disclosure: false };
  if (status === PRESENTATION_STATUS.loading) {
    return Object.freeze({
      ...region,
      available: false,
      shape: "◌",
      title: "Waiting for the grade before naming a first move.",
      guidance: "The rubric ranks every available change and names one. Naming a move before it has ranked them would be a guess.",
      rewrite: null,
      worth: null,
      control: null,
    });
  }
  if (status !== PRESENTATION_STATUS.graded) {
    const recovery = session.result.recovery;
    return Object.freeze({
      ...region,
      available: true,
      shape: "▶",
      title: recovery.title,
      guidance: recovery.guidance,
      rewrite: null,
      worth: null,
      control: recovery.control,
    });
  }
  const improvement = session.result.improvement;
  return Object.freeze({
    ...region,
    available: improvement.available,
    shape: improvement.available ? "▶" : "◇",
    title: improvement.title,
    guidance: improvement.guidance,
    rewrite: improvement.available ? improvement.rewrite : null,
    // "About", and rounded: the estimate does not model the score clamp, and
    // two decimals would claim it did.
    worth: improvement.available
      ? `${improvement.axis} axis · worth about ${plural(Math.round(improvement.points), "point")} of the 0–100 composite`
      : null,
    control: null,
  });
}

/**
 * The routing reading, the counts, and the boundary. Disclosed rather than
 * hoisted: the tier recommendation is an action for a different person than the
 * one reading a grade, and a second action beside the first is the thing this
 * surface is designed against.
 */
function evidenceRegion(status, session, notices) {
  if (status === PRESENTATION_STATUS.loading) return null;
  const region = {
    id: "evidence", kind: "evidence", rank: 4, heading: "Supporting evidence", disclosure: true,
  };
  const boundary = "Coaching ran in this browser tab. Nothing was sent, saved, or attached to an organization's grade.";
  if (status !== PRESENTATION_STATUS.graded) {
    const codes = session.result.observed?.turnReasonCodes ?? [];
    return Object.freeze({
      ...region,
      summary: codes.length ? plural(codes.length, "reason code") : "reason code and boundary",
      recommendation: null,
      facts: Object.freeze([
        fact("Reason code", session.reason),
        fact("Source", session.input.source),
        ...(codes.length ? [fact("Per-turn codes", codes.join(", "))] : []),
      ]),
      note: boundary,
    });
  }
  const { recommendation, observed } = session.result;
  return Object.freeze({
    ...region,
    summary: `model tier, ${plural(observed.turns, "turn")} read`,
    recommendation: Object.freeze({
      state: recommendation.state,
      evidenced: recommendation.evidenced,
      shape: recommendation.evidenced ? "▲" : "◇",
      label: recommendation.evidenced ? "Recommended" : "No change evidenced",
      title: recommendation.title,
      text: recommendation.text,
      basis: recommendation.evidenced
        ? `Evidence: ${recommendation.signalId} on turn ${recommendation.turn + 1}`
        : null,
    }),
    facts: Object.freeze([
      fact("Turns read", number(observed.turns)),
      auditedFact("Turns scored", number(observed.scoredTurns), notices, "scored_turns_exceed_turns"),
      fact("Role labels found", observed.labelled ? "yes" : "no"),
      fact("Model tier named", observed.modelTier ?? "not specified"),
    ]),
    note: boundary,
  });
}

/** The dispute material: axis subscores, per-turn codes, the runners-up. */
function rubricRegion(status, session) {
  if (status !== PRESENTATION_STATUS.graded) return null;
  const detail = session.result.detail;
  const signalAssumptions = Object.entries(detail.assumptions ?? {}).map(([key, text]) =>
    Object.freeze({ key, text }));
  return Object.freeze({
    id: "rubric",
    kind: "rubric",
    rank: 5,
    heading: "How this grade was reached",
    disclosure: true,
    summary: `${detail.axes.length} ${detail.axes.length === 1 ? "axis" : "axes"}, `
      + `${plural(detail.turns.length, "turn")}`,
    axes: Object.freeze(detail.axes.map((axis) => Object.freeze({
      label: `${axis.label} · ${axis.weightPercent}% of the composite`,
      value: `${axis.score} / 100`,
      assumption: axis.assumption,
    }))),
    // A percentage without its rationale is reproducible arithmetic but not an
    // explainable judgment. Keep the axis assumptions beside their weights,
    // then carry the keyed signal assumptions used by the ranked changes and
    // routing claim. Keys are intentionally visible so a disputed claim can be
    // quoted without relying on mutable prose.
    assumptions: Object.freeze([
      ...detail.axes.map((axis) => Object.freeze({
        key: `axis:${axis.key}`,
        text: axis.assumption,
      })),
      ...signalAssumptions,
    ]),
    turns: Object.freeze(detail.turns.map((turn) => Object.freeze({
      index: turn.index,
      label: `Turn ${turn.index + 1}`,
      role: turn.role,
      scored: turn.scored,
      scoredLabel: turn.scored ? "graded" : "not graded",
      read: `${turn.proseUnits} prose units, ${turn.codeBlocks} code, ${turn.pastedBlocks} pasted`,
      // The classifier's own identifiers, verbatim: a reader disputing a grade
      // quotes a code, and a prettified sentence is not quotable.
      codes: turn.reasonCodes.join(", "),
    }))),
    runnersUp: Object.freeze(detail.improvements.slice(1).map((entry) => Object.freeze({
      title: entry.title,
      worth: `${entry.axis} · about ${plural(Math.round(entry.points), "point")}`,
    }))),
    version: `Rubric ${detail.rubricVersionId} · aggregation ${detail.aggregation.rule}`,
  });
}

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

/**
 * Build the presentation model for one coaching session.
 *
 * @param {{status?: string, session?: object|null}} input `status` defaults to
 *   the session's own outcome; pass `loading` with no session to draw the state
 *   a caller paints while a grade is being computed.
 * @returns {object} frozen. `regions` is in reading order and always carries
 *   exactly one region of kind `action`.
 */
export function presentCoachingResult({ status, session = null } = {}) {
  const resolved = status ?? session?.outcome ?? PRESENTATION_STATUS.loading;
  if (!Object.values(PRESENTATION_STATUS).includes(resolved)) {
    throw new RangeError(`coaching presentation: unknown status "${resolved}"`);
  }
  if (resolved !== PRESENTATION_STATUS.loading && !session) {
    throw new RangeError(`coaching presentation: "${resolved}" needs a session to read`);
  }
  const notices = resolved === PRESENTATION_STATUS.loading ? Object.freeze([]) : auditFigures(session);
  const regions = [
    gradeRegion(resolved, session, notices),
    benchmarkRegion(resolved, session, notices),
    actionRegion(resolved, session),
    evidenceRegion(resolved, session, notices),
    rubricRegion(resolved, session),
  ].filter(Boolean);

  const actions = regions.filter((region) => region.kind === "action");
  if (actions.length !== 1) {
    throw new RangeError(`coaching presentation: ${actions.length} next actions, and this surface presents one`);
  }
  const ranks = regions.map((region) => region.rank);
  if (ranks.some((rank, at) => at > 0 && rank <= ranks[at - 1])) {
    throw new RangeError("coaching presentation: regions are out of reading order");
  }

  return Object.freeze({
    status: resolved,
    // An out-of-range figure drops the answer tone even on a graded result: the
    // surface should not look as confident as it does when the numbers hold.
    tone: notices.length ? PRESENTATION_TONE.caution : TONE_BY_STATUS[resolved],
    shape: SHAPE_BY_STATUS[resolved],
    statusLabel: STATUS_LABEL[resolved],
    sessionId: session?.sessionId ?? null,
    implausible: notices.length > 0,
    notices,
    regions: Object.freeze(regions),
  });
}
