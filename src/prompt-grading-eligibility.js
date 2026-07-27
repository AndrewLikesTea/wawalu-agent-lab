// Prompt-grading eligibility — is the reader's own prompt corpus substantial
// enough to own the headline?
//
// `grade-eligibility.js` already answers a different question: is the grade
// representative of our *spend*? That one weighs dollars, because a department
// burning $40k that nobody sampled matters more than five hundred sampled
// queries in a team spending pocket change. It cannot answer this one. A leader
// who imports a conversation export is asking whether the letter on the page is
// *theirs* or the bundled example's, and a corpus of nine prompts over one
// afternoon does not become theirs by arriving. This module settles that, and
// refuses to answer a third question.
//
// This module decides eligibility only. It does not render, and it does not
// take the headline over — the surface that does reads `state` from here.
//
// ---------------------------------------------------------------------------
// Metric definitions. Two engineers reading this must produce the same number.
// ---------------------------------------------------------------------------
//
//   totalPrompts        count of prompt records in the parsed import, after the
//                       export parser's own validity filtering and before any
//                       classification. A record `parseQuerySample` rejected as
//                       malformed is not counted here or anywhere else: it never
//                       became a prompt record.
//
//   classifiedPrompts   count of those records the classifier assigned to
//                       exactly one department. A record with no department, or
//                       with an ambiguous or unknown one, is unclassified. A
//                       record is counted once or not at all; it is never
//                       counted under two departments.
//
//   classifiedPromptShare
//                       classifiedPrompts / totalPrompts. When totalPrompts is
//                       0 the share is 0 — not NaN, and emphatically not 1. An
//                       empty corpus has classified nothing, and a 0/0 that
//                       printed as "100% classified" would be the single worst
//                       number this page could show.
//
//   departmentPromptCounts
//                       department -> count of its classified prompts. Sums to
//                       classifiedPrompts exactly, because each classified
//                       record belongs to one department.
//
//   gradedDepartments   departments whose count >= minPromptsPerDepartment.
//   ungradedDepartments departments present in the import but under that floor.
//                       These are the NAMED GAPS a partial state discloses; the
//                       shortfall is the floor minus the count, so the gap is
//                       stated as a number of prompts, not as "more data".
//
//   historyWindowDays   floor of (latest timestamp - earliest timestamp) in
//                       whole days, over ALL totalPrompts records that carry a
//                       timestamp. A record with no timestamp is excluded from
//                       the window and still counted in totalPrompts — dropping
//                       it from the denominator would quietly flatter the share.
//                       A single-day import is 0 days, not 1: the span between
//                       one moment and itself is zero.
//
//   departmentsCovered  gradedDepartments.length. This is the M in "graded from
//                       your file, N prompts, M departments" — the count of
//                       departments actually graded, never the count merely
//                       present. A department with three prompts in it is not a
//                       department this file can speak for.
//
// ---------------------------------------------------------------------------
// Deliberate omissions
// ---------------------------------------------------------------------------
//
// * No fourth threshold. Recency, per-model coverage, and prompt length all
//   exist upstream and none of them changes whether the corpus can carry a
//   grade. They would be surface.
// * No numeric confidence score. The status is the repository's existing
//   three-value state enum with a published rule per member, following the
//   trust verdict's and the coverage tiers' refusal to invent one.
// * No English sentences for the next action. The action is returned as data
//   with a `kind`, a named subject, and the size of the gap; the surface writes
//   the sentence. `grade-eligibility.js` ships pre-baked copy because it is the
//   only text its surface has; the headline this feeds has its own copy deck.

import { formatCount } from "./evolution.js";
import { TRUST_LABEL } from "./finops-display.js";

/** Bump this when a `state` or a `reason` changes meaning. */
export const PROMPT_GRADING_VERSION = "prompt-grading-eligibility/1.0.0";

/**
 * The three tunable numbers, and only three. Published as data because the
 * number a reader disputes should be visible without reading a branch, and read
 * at runtime by every surface — no page may hardcode a duplicate or reimplement
 * the comparison.
 *
 * Every threshold is read with `>=`, so a boundary value passes. That is the
 * same direction `COVERAGE_TIERS` reads its floors, and a rule that flipped the
 * comparison between two modules would be a bug nobody could see.
 */
export const PROMPT_GRADING_THRESHOLDS = Object.freeze({
  /**
   * Unit: fraction in [0, 1]. Minimum share of imported prompts the classifier
   * placed in a department.
   *
   * Under 0.6 the majority of the corpus is unreadable, so every department
   * count below is an undercount of unknown size and the mix between
   * departments is not measured — it is a sample of whatever happened to
   * classify. Above it, the unclassified remainder can move a department's
   * count but not the shape of the answer.
   */
  minClassifiedPromptShare: 0.6,
  /**
   * Unit: whole prompts. Minimum classified prompts a department needs before
   * THAT department is graded at all.
   *
   * 25 is the point at which one unusual week stops being the whole picture: a
   * single outlying prompt moves a 10-prompt department by ten points and a
   * 25-prompt department by four. Below it the department is named as a gap
   * rather than graded badly.
   */
  minPromptsPerDepartment: 25,
  /**
   * Unit: whole days spanned by the import, earliest timestamp to latest.
   *
   * 14 days covers two full working weeks, so a sprint boundary, a launch, or a
   * quiet Friday cannot be the entire history the grade is drawn from. It is a
   * span, not a count of active days: a fortnight with a silent middle is still
   * a fortnight of evidence about how the team works.
   */
  minHistoryWindowDays: 14,
});

/**
 * The three states, named once. Callers switch on these constants rather than
 * on a string literal, so the spelling is this module's to change.
 */
export const PROMPT_GRADING_STATE = Object.freeze({
  /** No import, or nothing in it is gradeable. The headline stays the sample. */
  sampleOnly: "sample_only",
  /** At least one department graded, at least one dimension short. */
  partial: "partial",
  /** Every dimension clears. The headline is the reader's. */
  ownGrade: "own_grade",
});

/**
 * Why a state was chosen. Stable codes; a surface switches on these and never
 * string-matches a label.
 */
export const PROMPT_GRADING_REASON = Object.freeze({
  noImport: "no_import",
  noDepartmentAboveFloor: "no_department_above_floor",
  shareBelowFloor: "classified_share_below_floor",
  windowBelowFloor: "history_window_below_floor",
  ungradedDepartments: "departments_below_floor",
  allDimensionsClear: "all_dimensions_clear",
});

/**
 * The next action's kinds, in the precedence they are chosen. Exported so the
 * order is testable as data rather than inferred from a chain of `if`s.
 *
 * 1. `classify_more_prompts` — the classified share is under its floor. This
 *    outranks everything: while most of the corpus is unreadable, every
 *    department count is an undercount, so closing this gap can graduate
 *    several departments at once and can only ever help the other two.
 * 2. `extend_history_window` — the span is under its floor. A short window
 *    makes the grade a claim about one week, which no amount of per-department
 *    depth repairs.
 * 3. `cover_department` — a named department is under the per-department floor.
 *    Last because it is the narrowest fix: it graduates exactly one department
 *    and moves nothing else.
 *
 * Ties inside step 3 break on the largest shortfall, then lexicographically on
 * the department key, so the same import always yields the same action.
 */
export const PROMPT_GRADING_ACTION_PRECEDENCE = Object.freeze([
  "classify_more_prompts",
  "extend_history_window",
  "cover_department",
]);

/**
 * How this dimension speaks in the repository's existing status vocabulary.
 * `state` here is the same three-value enum `COVERAGE_TIERS` publishes, and the
 * label is built from `TRUST_LABEL` — the words this codebase already uses for
 * "show it as a fact", "show it, marked incomplete", and "withhold it". Prompt
 * grading is a *dimension* of that vocabulary, not a second badge beside it.
 */
export const PROMPT_GRADING_STATUS = Object.freeze({
  [PROMPT_GRADING_STATE.sampleOnly]: Object.freeze({
    state: "not_gradeable",
    strength: 0,
    showOwnGrade: false,
    label: `${TRUST_LABEL.needsReview} · sample grade shown`,
    rule: "No import is present, or no department in it reached the per-department floor, so the grade on the page is the bundled sample, not yours.",
  }),
  [PROMPT_GRADING_STATE.partial]: Object.freeze({
    state: "provisional",
    strength: 1,
    showOwnGrade: true,
    label: `${TRUST_LABEL.partial} · partial prompt coverage`,
    rule: "At least one department is graded from your own file; the named gaps below are not.",
  }),
  [PROMPT_GRADING_STATE.ownGrade]: Object.freeze({
    state: "graded",
    strength: 2,
    showOwnGrade: true,
    label: `${TRUST_LABEL.available} · graded from your file`,
    rule: "Classified share, history window, and every department present clear their floors.",
  }),
});

/** The two dimensions a combined status is resolved across. */
export const GRADING_DIMENSION = Object.freeze({
  spendMix: "spend_mix",
  promptGrading: "prompt_grading",
});

/** How the shared state enum ranks, weakest first. Read by `weakerOf` only. */
const STATE_STRENGTH = Object.freeze({ not_gradeable: 0, provisional: 1, graded: 2 });

const MS_PER_DAY = 86_400_000;
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A prompt timestamp as milliseconds, or null when the record carries none.
 *
 * A bare `YYYY-MM-DD` is the day bucket Anya's contract states, and it is read
 * at UTC midnight so a reader's own timezone cannot widen or narrow a window by
 * a day. Anything that does not parse is treated as absent rather than as zero:
 * an unparseable date at epoch 0 would stretch every window to fifty years.
 */
function timestampMs(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const text = value.trim();
  const parsed = Date.parse(CALENDAR_DAY.test(text) ? `${text}T00:00:00Z` : text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The department a prompt is attributed to, or null when it carries none. */
function departmentKey(value) {
  const key = typeof value === "string" ? value.trim() : "";
  return key || null;
}

/**
 * The signal shape this rule consumes, built from Anya's conversation-export
 * contract. Kept as an adapter rather than a parameter list so the rule itself
 * never learns the contract's field names.
 *
 * @param samples `[{ parsed, classified }]` — `parseQuerySample` output paired
 *   with the `classifyQuerySample` output derived from it.
 * @returns `{ prompts: [{ department, timestamp, classified }] }`
 *
 * WHY IT READS CLASSIFICATION BACKWARDS. `classifyQuerySample` returns derived
 * records with no row number — deliberately, since a derived record is built
 * from an allowlist so it cannot carry anything the redaction boundary refuses.
 * Its `unclassified` list *does* carry one located issue per record it set
 * aside. So the classified set is the parsed records minus those rows, which is
 * exact: the classifier emits one issue per record it dropped and drops none
 * silently. Nothing here reaches for prompt text, and there is none to reach
 * for by this point.
 */
export function promptGradingSignals(samples = []) {
  const prompts = [];
  for (const sample of Array.isArray(samples) ? samples : []) {
    const records = sample?.parsed?.records ?? [];
    const setAside = new Set((sample?.classified?.unclassified ?? []).map((issue) => issue?.row));
    for (const record of records) {
      prompts.push(Object.freeze({
        department: departmentKey(record?.orgUnitId),
        timestamp: record?.queryDate ?? null,
        classified: !setAside.has(record?.row),
      }));
    }
  }
  return Object.freeze({ prompts: Object.freeze(prompts) });
}

/**
 * The window, on its own, so the arithmetic can be disputed without a corpus.
 * Records with no timestamp are excluded here and counted by the caller.
 */
function historyWindow(prompts) {
  let earliest = null;
  let latest = null;
  let timestamped = 0;
  for (const prompt of prompts) {
    const ms = timestampMs(prompt?.timestamp);
    if (ms === null) continue;
    timestamped += 1;
    if (earliest === null || ms < earliest) earliest = ms;
    if (latest === null || ms > latest) latest = ms;
  }
  // No timestamp anywhere is a window of 0, the same as a single-day import:
  // neither one is evidence of a span, and neither is a null the surface would
  // have to render as something.
  const days = earliest === null ? 0 : Math.floor((latest - earliest) / MS_PER_DAY);
  return { days, timestamped, earliest, latest };
}

/**
 * The next action, chosen by `PROMPT_GRADING_ACTION_PRECEDENCE`. Returned as
 * data: a kind, the subject it names, and how far short that subject is.
 */
function nextActionFor(state, metrics, thresholds) {
  if (state === PROMPT_GRADING_STATE.sampleOnly) {
    return Object.freeze({
      kind: "import_conversation_export",
      dimension: null,
      department: null,
      // No single number closes this gap: an import either exists and reaches a
      // department floor or it does not, so a shortfall would be invented.
      shortfall: null,
      observed: metrics.totalPrompts,
      target: thresholds.minPromptsPerDepartment,
    });
  }
  if (state === PROMPT_GRADING_STATE.ownGrade) {
    // The coaching move is implied by the reader's own worst graded department,
    // and "worst" is a score this module is not given. When the caller supplies
    // per-department scores it is named; when it does not, the action says so
    // rather than naming an arbitrary department as the one to coach.
    const worst = metrics.worstGradedDepartment;
    return Object.freeze({
      kind: "coach_department",
      dimension: null,
      department: worst?.department ?? null,
      available: Boolean(worst),
      score: worst?.score ?? null,
      shortfall: null,
      observed: null,
      target: null,
    });
  }
  if (metrics.classifiedPromptShare < thresholds.minClassifiedPromptShare) {
    return Object.freeze({
      kind: "classify_more_prompts",
      dimension: "classifiedPromptShare",
      department: null,
      // How many more of the same prompts would have to classify to clear the
      // floor, so the surface can say "42 more", not "add more data".
      shortfall: Math.max(0, Math.ceil(
        thresholds.minClassifiedPromptShare * metrics.totalPrompts,
      ) - metrics.classifiedPrompts),
      observed: metrics.classifiedPromptShare,
      target: thresholds.minClassifiedPromptShare,
    });
  }
  if (metrics.historyWindowDays < thresholds.minHistoryWindowDays) {
    return Object.freeze({
      kind: "extend_history_window",
      dimension: "historyWindowDays",
      department: null,
      shortfall: thresholds.minHistoryWindowDays - metrics.historyWindowDays,
      observed: metrics.historyWindowDays,
      target: thresholds.minHistoryWindowDays,
    });
  }
  const gap = metrics.ungradedDepartments[0] ?? null;
  return Object.freeze({
    kind: "cover_department",
    dimension: "departmentPromptCounts",
    department: gap?.department ?? null,
    shortfall: gap?.shortfall ?? null,
    observed: gap?.prompts ?? null,
    target: thresholds.minPromptsPerDepartment,
  });
}

/**
 * The rule. Pure: no clock, no storage, no network, no randomness.
 *
 * @param signals `{ prompts: [{ department, timestamp, classified }] }`, as
 *   `promptGradingSignals` builds it. A bare array of prompts is accepted too,
 *   so a test fixture does not have to wrap itself.
 * @param options.departmentScores optional `{ [department]: number }` — the
 *   composite the reader's own grading produced per department, used only to
 *   name the worst graded department in the `own_grade` next action.
 * @param options.thresholds override for tests. Production reads the exported
 *   constant; nothing else may hold a second copy of these numbers.
 */
export function promptGradingEligibility(signals = {}, options = {}) {
  const thresholds = Object.freeze({ ...PROMPT_GRADING_THRESHOLDS, ...(options.thresholds ?? {}) });
  const prompts = Array.isArray(signals) ? signals : (signals?.prompts ?? []);
  const list = Array.isArray(prompts) ? prompts : [];

  const totalPrompts = list.length;
  const counts = new Map();
  let classifiedPrompts = 0;
  for (const prompt of list) {
    const department = departmentKey(prompt?.department);
    // Exactly one department, or none. A record with no department is
    // unclassified however confidently the classifier reported a category.
    if (!department || prompt?.classified !== true) continue;
    classifiedPrompts += 1;
    counts.set(department, (counts.get(department) ?? 0) + 1);
  }
  const classifiedPromptShare = totalPrompts === 0 ? 0 : classifiedPrompts / totalPrompts;

  const window = historyWindow(list);
  const historyWindowDays = window.days;

  const ranked = [...counts.entries()].sort(
    ([leftKey, left], [rightKey, right]) => right - left || leftKey.localeCompare(rightKey),
  );
  const gradedDepartments = ranked
    .filter(([, prompts_]) => prompts_ >= thresholds.minPromptsPerDepartment)
    .map(([department]) => department);
  const ungradedDepartments = ranked
    .filter(([, prompts_]) => prompts_ < thresholds.minPromptsPerDepartment)
    .map(([department, prompts_]) => Object.freeze({
      department,
      prompts: prompts_,
      shortfall: thresholds.minPromptsPerDepartment - prompts_,
    }))
    // The largest gap first, so the surface's "close the biggest gap" is a read
    // of position 0 rather than a second sort somewhere else.
    .sort((left, right) => right.shortfall - left.shortfall
      || left.department.localeCompare(right.department));
  const departmentPromptCounts = Object.freeze(Object.fromEntries(ranked));
  const departmentsCovered = gradedDepartments.length;

  const shareShort = classifiedPromptShare < thresholds.minClassifiedPromptShare;
  const windowShort = historyWindowDays < thresholds.minHistoryWindowDays;
  const gapsPresent = ungradedDepartments.length > 0;

  const reasons = [];
  let state;
  if (totalPrompts === 0) {
    state = PROMPT_GRADING_STATE.sampleOnly;
    reasons.push(PROMPT_GRADING_REASON.noImport);
  } else if (departmentsCovered === 0) {
    state = PROMPT_GRADING_STATE.sampleOnly;
    reasons.push(PROMPT_GRADING_REASON.noDepartmentAboveFloor);
  } else if (shareShort || windowShort || gapsPresent) {
    state = PROMPT_GRADING_STATE.partial;
  } else {
    state = PROMPT_GRADING_STATE.ownGrade;
    reasons.push(PROMPT_GRADING_REASON.allDimensionsClear);
  }
  // The short dimensions are reported for every state that has them, including
  // sample_only: "no department cleared the floor" and "and only a third of the
  // file classified" are two different conversations.
  if (shareShort && totalPrompts > 0) reasons.push(PROMPT_GRADING_REASON.shareBelowFloor);
  if (windowShort && totalPrompts > 0) reasons.push(PROMPT_GRADING_REASON.windowBelowFloor);
  if (gapsPresent) reasons.push(PROMPT_GRADING_REASON.ungradedDepartments);

  const scores = options.departmentScores ?? null;
  const scoredGraded = gradedDepartments
    .filter((department) => Number.isFinite(scores?.[department]))
    .sort((left, right) => scores[left] - scores[right] || left.localeCompare(right));
  const worstGradedDepartment = scoredGraded.length
    ? Object.freeze({ department: scoredGraded[0], score: scores[scoredGraded[0]] })
    : null;

  const status = PROMPT_GRADING_STATUS[state];
  const metrics = {
    totalPrompts, classifiedPrompts, classifiedPromptShare, historyWindowDays,
    ungradedDepartments, worstGradedDepartment,
  };

  return Object.freeze({
    version: PROMPT_GRADING_VERSION,
    question: "Is this reader's own prompt corpus substantial enough to own the headline?",
    dimension: GRADING_DIMENSION.promptGrading,
    state,
    /** The shared enum, so a combined status can rank this against spend mix. */
    status: status.state,
    label: status.label,
    rule: status.rule,
    /** True exactly when the headline may be the reader's rather than the sample's. */
    showOwnGrade: status.showOwnGrade,
    /**
     * Whether the reader has an import of their own at all — the question every
     * surface used to answer inline with a truthiness check on the file list.
     * It is not the same question as `showOwnGrade`: an import can exist and
     * still be too thin to grade.
     */
    hasOwnImport: totalPrompts > 0,
    reasons: Object.freeze(reasons),
    // The material numbers, so callers render from data instead of re-deriving.
    totalPrompts,
    classifiedPrompts,
    classifiedPromptShare,
    departmentsCovered,
    historyWindowDays,
    gradedDepartments: Object.freeze(gradedDepartments),
    ungradedDepartments: Object.freeze(ungradedDepartments),
    thresholds,
    /**
     * The at-a-glance disclosure a partial state owes the reader. Provenance is
     * the fixed form the page already uses: N is `classifiedPrompts` and M is
     * `departmentsCovered`, never the count of departments merely present.
     */
    disclosure: Object.freeze({
      provenance: totalPrompts === 0
        ? "Graded from the bundled sample. Nothing of yours has been imported."
        : `Graded from your file, ${formatCount(classifiedPrompts)} prompt`
          + `${classifiedPrompts === 1 ? "" : "s"}, ${formatCount(departmentsCovered)} department`
          + `${departmentsCovered === 1 ? "" : "s"}`,
      confidence: status.label,
      impact: status.showOwnGrade
        ? `${formatCount(departmentsCovered)} of ${formatCount(ranked.length)} departments in your file are graded from your own prompts.`
        : "The grade on this page is the bundled sample's, not yours.",
      whyItMatters: status.showOwnGrade
        ? "A grade drawn from your own prompts is a claim about your team; the gaps named below are not covered by it."
        : "A sample grade describes an example organization. Acting on it would be acting on someone else's data.",
    }),
    /**
     * Progressive disclosure. Marked as detail because it belongs behind a
     * control, not in the headline — the frontend owns that control; this
     * module only refuses to hide the numbers from it.
     */
    detail: Object.freeze({
      progressive: true,
      departmentPromptCounts,
      departmentsPresent: ranked.length,
      ungradedDepartments: Object.freeze(ungradedDepartments),
      promptsWithTimestamp: window.timestamped,
      promptsWithoutTimestamp: totalPrompts - window.timestamped,
    }),
    nextAction: nextActionFor(state, metrics, thresholds),
  });
}

/**
 * One status across both dimensions, resolved to the weaker of the two, naming
 * which one is weak.
 *
 * An import can be eligible for spend mix and not for prompt grading, and two
 * badges disagreeing beside one letter is not a status — it is a puzzle the
 * reader has to solve before reading their own number. Both dimensions already
 * speak the same three-value state enum, so the resolution is a comparison, not
 * a translation, and the weaker one wins because a status is a floor on what
 * may be claimed.
 *
 * @param spendMix a `gradeEligibility*` verdict, or null when none was computed.
 * @param promptGrading a `promptGradingEligibility` verdict, or null likewise.
 */
export function combinedGradingStatus({ spendMix = null, promptGrading = null } = {}) {
  const dimensions = [];
  if (spendMix) {
    dimensions.push({
      dimension: GRADING_DIMENSION.spendMix,
      status: spendMix.state,
      strength: STATE_STRENGTH[spendMix.state] ?? 0,
      label: spendMix.label,
      rule: spendMix.rule,
    });
  }
  if (promptGrading) {
    dimensions.push({
      dimension: GRADING_DIMENSION.promptGrading,
      status: promptGrading.status,
      strength: STATE_STRENGTH[promptGrading.status] ?? 0,
      label: promptGrading.label,
      rule: promptGrading.rule,
    });
  }
  if (!dimensions.length) {
    return Object.freeze({
      version: PROMPT_GRADING_VERSION,
      status: "not_gradeable",
      weakestDimension: null,
      label: `${TRUST_LABEL.needsReview} · nothing measured`,
      rule: "Neither spend mix nor prompt grading was measured, so no status is claimed.",
      dimensions: Object.freeze([]),
    });
  }
  // Ties resolve to the dimension declared first, which is spend mix: it is the
  // older claim on the page, so a tie changes no wording a reader has seen.
  const weakest = dimensions.reduce((left, right) => (right.strength < left.strength ? right : left));
  return Object.freeze({
    version: PROMPT_GRADING_VERSION,
    status: weakest.status,
    weakestDimension: weakest.dimension,
    label: weakest.label,
    rule: weakest.rule,
    /** True when the two dimensions do not agree, so the surface names the weak one. */
    dimensionsDisagree: dimensions.some((entry) => entry.strength !== weakest.strength),
    dimensions: Object.freeze(dimensions.map((entry) => Object.freeze(entry))),
  });
}
