// Carrying one personal AI-history reading forward to the next, and nothing else
// forward with it.
//
// ONE DECISION, and it is not the report's. `personal-history-contract.js`
// answers "what single improvement should I prioritize?" from one file. This
// module answers the only follow-up that file cannot answer on its own:
//
//     "Is the habit I was told to change first costing me less than it did?"
//
// WHY THIS IS A SEPARATE ARTIFACT FROM THE REPORT. The report is a reading of
// one export and its field list is closed; a report that grew a "last time"
// field would be a report making a claim about a file it never read. So the
// carried thing is its own object with its own version, its own closed field
// list, and its own validator, and the report is untouched by all of it. Two
// consequences fall out and both are deliberate: a report is still
// byte-identical for the same export no matter what is in storage, and a
// comparison can be refused whole without degrading the reading it sits beside.
//
// WHAT IS STORED, in full: a schema version, three provenance version pins, an
// origin, the export shape, a reading ordinal, the leading move's identifier,
// its cost per scored prompt, the scored-prompt and distinct-day counts behind
// that figure, the coverage ratio, and the confidence level. Fourteen scalars.
// That is the whole of it, `CARRY_FORWARD_SUMMARY_FIELDS` is closed, and
// `validateCarriedSummary` rejects anything carrying a fifteenth.
//
// WHAT IS NEVER STORED, and why each one was actually considered:
//
//   prompt text        the report never carries it, so there is none here to
//                      store. `assertNoCarriedPromptText` is the executable form.
//   calendar dates     a date range is refused by the report contract on its own
//                      terms (`PERSONAL_REQUIRED_FIELDS`: the date is read to
//                      make a floor checkable, "it is not shown as a range"), and
//                      a stored day is a fingerprint of when somebody works. The
//                      period is identified by an ordinal instead — see
//                      `CARRY_FORWARD_PERIOD`.
//   file names, sizes  nothing about the file is read into the report and
//                      nothing about it is stored.
//   a history          one slot. A run of readings is a chart, a chart wants a
//                      time axis, and a time axis is the calendar dates above.
//                      The previous summary is overwritten, not appended to.
//   anybody else       there is no second person in this, ever. See
//                      `CARRY_FORWARD_BASIS`.
//
// WHY AN ORDINAL AND NOT A TIMESTAMP. Two readings need to be told apart and put
// in order. A timestamp does both and also records when this person sat down at
// their computer, twice, which is a thing worth knowing about somebody and worth
// nothing to this comparison. An integer that counts up does both and records
// nothing else.
//
// DETERMINISM. Every function here is pure except the three that take a storage
// object as an argument, and those touch exactly one key. No clock, no
// randomness, no network, no identifier generation.

import { PROSE_CLASSIFIER_VERSION } from "./prompt-prose-classification.js";
import { RUBRIC_VERSION_ID } from "./prompt-literacy-scoring.js";
import {
  FORBIDDEN_REPORT_KEYS, PERSONAL_HISTORY_VERSION, PERSONAL_REPORT_STATE,
} from "./personal-history-contract.js";

/** Bump when a stored field, a state, a reason code, or a figure changes meaning. */
export const CARRY_FORWARD_VERSION = "personal-history-carry-forward/1.0.0";

/** The one question this artifact exists to answer. */
export const CARRY_FORWARD_QUESTION =
  "Is the habit I was told to change first costing me less than it did last time?";

const POINT_DECIMALS = 2;
const roundTo = (value, decimals) => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

// ---------------------------------------------------------------------------
// The boundary
// ---------------------------------------------------------------------------

/**
 * What storing a summary does and does not do, as data and constant, in the same
 * shape as `PERSONAL_BOUNDARY`.
 *
 * The report's boundary is a claim about a file. This is a claim about a browser,
 * which is a different claim and gets its own object rather than more fields on
 * that one. Both are true at once and a surface owes a reader both.
 */
export const CARRY_FORWARD_BOUNDARY = Object.freeze({
  storedWhere: "this browser profile only, under one key on this origin",
  storedWhat: "counts, ratios, version strings, and this repository's own move identifiers",
  slotsKept: 1,
  retainsPromptText: false,
  retainsDates: false,
  retainsFileDetails: false,
  uploaded: "none",
  sentForComparison: "none",
  clearedBy: "the workflow's own clear control, or clearing this site's browser storage",
});

export const CARRY_FORWARD_BOUNDARY_FIELDS = Object.freeze(Object.keys(CARRY_FORWARD_BOUNDARY));

/**
 * What a comparison is a claim about. `population: 1` for the same reason the
 * report says it: both readings are the same person's own history, so a
 * direction here is that person against themselves and can never be read as a
 * standing among anybody.
 */
export const CARRY_FORWARD_BASIS = Object.freeze({
  unit: "one person's own export, read twice",
  population: 1,
  comparisonsMade: "this reading against your own previous reading, and nothing else",
  claim: "This says whether the habit already named as your first priority is costing you more or "
    + "less on an average request than it did when you last read an export here.",
  refusal: "It is not a benchmark, a percentile, a peer cohort, a team score, or an organizational "
    + "grade, and no second person's history exists anywhere in this workflow to build one from.",
});

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * The one key, the one slot, and the ceiling on what may sit in it.
 *
 * WHY A BYTE CEILING ON FOURTEEN SCALARS. It cannot be reached by anything this
 * module writes, which is the point: a write that is over it is a bug that grew
 * a field, and failing the write is how that bug is discovered in a browser
 * rather than in a review. The read side has the same ceiling, so a key somebody
 * else's code stuffed is refused before it is parsed.
 *
 * The version rides in the key as well as in the payload. A v2 that read a v1
 * key would have to carry a migration for a derived figure nobody would miss;
 * a v2 key simply does not see it, and the v1 value ages out with the profile.
 */
export const CARRY_FORWARD_STORAGE = Object.freeze({
  key: "wawalu.personal-history.carry-forward.v1",
  slots: 1,
  maxBytes: 2048,
  scope: "one browser profile, one origin",
});

/**
 * The browser's own storage, or null, and the only place in this workflow that
 * names one.
 *
 * WHY IT IS HERE AND NOT AT THE CALL SITE. Every other module in the personal
 * history workflow is asserted to reference no storage API at all, and that
 * assertion is worth more than the one line it saves a caller: "which code can
 * write to this browser" is answered by this function's name appearing in
 * exactly one module. The page asks this module for a slot; it never reaches for
 * one itself.
 *
 * Reading the property can throw on its own under some privacy settings, before
 * any method is called, so even the lookup is guarded.
 */
export function browserCarryForwardStorage(scope = globalThis) {
  try {
    return scope?.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Why a storage call produced nothing. Null is a successful call. */
export const CARRY_FORWARD_FAULT = Object.freeze({
  unavailable: "storage_unavailable",
  oversize: "summary_over_byte_ceiling",
  rejected: "summary_rejected",
});

/** A storage object this module will talk to: the three methods it uses, callable. */
const usable = (storage) => Boolean(storage)
  && typeof storage.getItem === "function"
  && typeof storage.setItem === "function"
  && typeof storage.removeItem === "function";

/**
 * The stored summary, or nothing, and never a throw.
 *
 * EVERY BROWSER STORAGE CALL CAN THROW. Private browsing modes throw on
 * `getItem`, a full profile throws on `setItem`, and a policy can remove the
 * object entirely. A workflow whose reading of a person's own history dies
 * because a comparison could not be looked up has traded the answer for the
 * footnote, so every fault here is a returned value and the caller carries on.
 *
 * @param {{getItem: Function}} storage a Storage-shaped object.
 * @returns {{raw: string|null, fault: string|null}} the raw value, unparsed.
 */
export function readCarriedRaw(storage) {
  if (!usable(storage)) return Object.freeze({ raw: null, fault: CARRY_FORWARD_FAULT.unavailable });
  let raw = null;
  try {
    raw = storage.getItem(CARRY_FORWARD_STORAGE.key);
  } catch {
    return Object.freeze({ raw: null, fault: CARRY_FORWARD_FAULT.unavailable });
  }
  if (typeof raw !== "string" || !raw) return Object.freeze({ raw: null, fault: null });
  if (raw.length > CARRY_FORWARD_STORAGE.maxBytes) {
    return Object.freeze({ raw: null, fault: CARRY_FORWARD_FAULT.oversize });
  }
  return Object.freeze({ raw, fault: null });
}

/**
 * Write one summary, replacing whatever was in the slot.
 *
 * Validated before it is serialized, not after: a summary this module would
 * refuse to read back is a summary it must refuse to write, and the two checks
 * are the same function so they cannot drift.
 *
 * @returns {{written: boolean, fault: string|null}}
 */
export function writeCarriedSummary(storage, summary) {
  if (!usable(storage)) return Object.freeze({ written: false, fault: CARRY_FORWARD_FAULT.unavailable });
  if (!validateCarriedSummary(summary).valid) {
    return Object.freeze({ written: false, fault: CARRY_FORWARD_FAULT.rejected });
  }
  const serialized = JSON.stringify(summary);
  if (serialized.length > CARRY_FORWARD_STORAGE.maxBytes) {
    return Object.freeze({ written: false, fault: CARRY_FORWARD_FAULT.oversize });
  }
  try {
    storage.setItem(CARRY_FORWARD_STORAGE.key, serialized);
  } catch {
    return Object.freeze({ written: false, fault: CARRY_FORWARD_FAULT.unavailable });
  }
  return Object.freeze({ written: true, fault: null });
}

/**
 * Empty the slot. The way out, and the reason `clearedBy` on the boundary is a
 * control a reader can press rather than a browser setting they must find.
 */
export function clearCarriedSummary(storage) {
  if (!usable(storage)) return Object.freeze({ cleared: false, fault: CARRY_FORWARD_FAULT.unavailable });
  try {
    storage.removeItem(CARRY_FORWARD_STORAGE.key);
  } catch {
    return Object.freeze({ cleared: false, fault: CARRY_FORWARD_FAULT.unavailable });
  }
  return Object.freeze({ cleared: true, fault: null });
}

// ---------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------

/**
 * Where a summary came from. Only your own export is carried forward: the worked
 * example is an invented person, and a comparison of your history against a
 * fixture shipped in this repository would be the most misleading number on the
 * page.
 */
export const CARRY_FORWARD_ORIGIN = Object.freeze({
  ownExport: "own-export",
  workedExample: "worked-example",
});

/**
 * What identifies a period, given that no date is stored.
 *
 * `reading` counts up from 1 and orders two summaries. The two counts say how
 * much history the figure was drawn from, which is what a reader needs to know
 * whether a fall is a habit changing or a quiet month — and is exactly why the
 * compared figure below is per-prompt rather than a total.
 */
export const CARRY_FORWARD_PERIOD = Object.freeze({
  identifier: "reading",
  rule: "An integer counting your readings on this browser, starting at 1. A reading is only "
    + "counted when it named a move; a refusal does not advance it and does not replace the "
    + "summary already carried.",
  extent: Object.freeze(["scoredPrompts", "distinctDays"]),
  datesStored: "none",
  why: "A period needs an order and a size. A calendar date would give both and would also record "
    + "when this person works, which is a fact about them and not about the habit.",
});

export const CARRY_FORWARD_SUMMARY_FIELDS = Object.freeze([
  "schemaVersion", "reportVersion", "rubricVersion", "classifierVersion",
  "origin", "shape", "reading", "moveId", "pointsPerScoredPrompt",
  "scoredPrompts", "distinctDays", "coverage", "confidence",
]);

/**
 * The three version pins a comparison is only valid within, and the argument for
 * each.
 *
 * reportVersion      the coverage identity, the floors, and what counts as a
 *                    scored prompt are all defined there. A change to any of them
 *                    changes the denominator of the compared figure.
 * rubricVersion      the points are the rubric's. Reweighting an axis moves every
 *                    stored figure and none of the underlying habits.
 * classifierVersion  which moves fire in a prompt at all.
 *
 * A mismatch on any is `incompatible` rather than a silent comparison, because
 * the alternative is telling somebody they improved when what changed was this
 * repository.
 */
export const CARRY_FORWARD_VERSION_PINS = Object.freeze({
  report: PERSONAL_HISTORY_VERSION,
  rubric: RUBRIC_VERSION_ID,
  classifier: PROSE_CLASSIFIER_VERSION,
});

/**
 * The compared figure, defined once and computed nowhere else.
 *
 * NOT THE POINTS. A move's points are a sum over the prompts carrying it, so
 * they scale with how much you wrote. A quiet month would read as an improvement
 * and a busy one as a collapse, and neither would be about the habit. Points per
 * scored prompt is what that habit costs on an average request, which is the
 * figure that stays comparable when the size of the reading does not.
 */
export const CARRY_FORWARD_METRIC = Object.freeze({
  metric: "points_per_scored_prompt",
  definition: "priority.points / coverage.scoredPrompts, rounded to two decimals. The composite "
    + "points the leading move costs on an average request in that reading.",
  excludes: "Any total that scales with the size of the export, and any figure drawn from a "
    + "reading that named no move.",
});

/**
 * A report to the thing that may be carried forward, or null.
 *
 * Null, not a partial summary, in three cases: a reading that named no move has
 * no figure to carry; the worked example is not this reader's history; and an
 * origin this module does not recognize is not guessed at.
 *
 * @param {object} report a report from `buildPersonalHistoryReport`.
 * @param {{origin?: string, reading?: number}} options `reading` is the ordinal
 *   this summary takes, which is the caller's business because only the caller
 *   has seen the previous one. It defaults to the first.
 * @returns {object|null} frozen, closed over `CARRY_FORWARD_SUMMARY_FIELDS`.
 */
export function carryForwardSummary(report, { origin = CARRY_FORWARD_ORIGIN.ownExport, reading = 1 } = {}) {
  if (origin !== CARRY_FORWARD_ORIGIN.ownExport) return null;
  if (report?.state !== PERSONAL_REPORT_STATE.prioritized) return null;
  if (!Number.isInteger(reading) || reading < 1) return null;
  const scoredPrompts = report.coverage.scoredPrompts;
  if (!Number.isInteger(scoredPrompts) || scoredPrompts < 1) return null;

  const summary = Object.freeze({
    schemaVersion: CARRY_FORWARD_VERSION,
    reportVersion: report.schemaVersion,
    rubricVersion: CARRY_FORWARD_VERSION_PINS.rubric,
    classifierVersion: CARRY_FORWARD_VERSION_PINS.classifier,
    origin,
    shape: report.shape,
    reading,
    moveId: report.priority.id,
    pointsPerScoredPrompt: roundTo(report.priority.points / scoredPrompts, POINT_DECIMALS),
    scoredPrompts,
    distinctDays: report.coverage.distinctDays,
    coverage: report.coverage.ratio,
    confidence: report.confidence.level,
  });
  return validateCarriedSummary(summary).valid ? summary : null;
}

const isCount = (value) => Number.isInteger(value) && value >= 0;
const isRatio = (value) => Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * Check a value that came out of storage, or one about to go in.
 *
 * A CLOSED LIST AND NOT A SCHEMA CHECK. Browser storage is writable by anything
 * else running on this origin and by the reader themselves, so the value read
 * back is untrusted input in the ordinary sense. Every field is type-checked,
 * every extra field is a failure, and no string is ever handed to a surface
 * without arriving through here — which is what keeps a stuffed key from
 * painting somebody else's sentence on this page.
 *
 * @returns {{valid: boolean, errors: ReadonlyArray<{code: string, detail: string}>}}
 */
export function validateCarriedSummary(value) {
  const errors = [];
  const fail = (code, detail) => errors.push(Object.freeze({ code, detail }));

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze({
      valid: false,
      errors: Object.freeze([Object.freeze({ code: "not_an_object", detail: "a summary is an object" })]),
    });
  }
  const keys = Object.keys(value);
  if (keys.length !== CARRY_FORWARD_SUMMARY_FIELDS.length
    || !CARRY_FORWARD_SUMMARY_FIELDS.every((field) => keys.includes(field))) {
    fail("summary_fields", `a summary carries exactly: ${CARRY_FORWARD_SUMMARY_FIELDS.join(", ")}`);
  }
  if (value.schemaVersion !== CARRY_FORWARD_VERSION) {
    fail("unsupported_version", `this build reads ${CARRY_FORWARD_VERSION}`);
  }
  if (value.reportVersion !== CARRY_FORWARD_VERSION_PINS.report) {
    fail("report_version", `this build reads reports at ${CARRY_FORWARD_VERSION_PINS.report}`);
  }
  if (value.rubricVersion !== CARRY_FORWARD_VERSION_PINS.rubric) {
    fail("rubric_version", `this build scores at ${CARRY_FORWARD_VERSION_PINS.rubric}`);
  }
  if (value.classifierVersion !== CARRY_FORWARD_VERSION_PINS.classifier) {
    fail("classifier_version", `this build classifies at ${CARRY_FORWARD_VERSION_PINS.classifier}`);
  }
  if (value.origin !== CARRY_FORWARD_ORIGIN.ownExport) {
    fail("origin", "only your own export is carried forward");
  }
  if (typeof value.shape !== "string" || !value.shape) {
    fail("shape", "a summary names the export shape it was read from");
  }
  if (!Number.isInteger(value.reading) || value.reading < 1) {
    fail("reading", "the reading ordinal is an integer of at least 1");
  }
  if (typeof value.moveId !== "string" || !value.moveId) {
    fail("move_id", "a summary names the move it carried forward");
  }
  if (!Number.isFinite(value.pointsPerScoredPrompt) || value.pointsPerScoredPrompt < 0) {
    fail("points_per_scored_prompt", CARRY_FORWARD_METRIC.definition);
  }
  if (!isCount(value.scoredPrompts) || value.scoredPrompts < 1) {
    fail("scored_prompts", "a carried summary was drawn from at least one scored prompt");
  }
  if (!isCount(value.distinctDays)) fail("distinct_days", "distinct days is a non-negative integer");
  if (!isRatio(value.coverage)) fail("coverage", "coverage is a ratio in [0, 1]");
  if (typeof value.confidence !== "string" || !value.confidence) {
    fail("confidence", "a summary carries the confidence level of the reading behind it");
  }

  const forbidden = forbiddenKeyIn(value);
  if (forbidden) fail("forbidden_key", `"${forbidden}" would carry prompt text or a comparison`);

  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

function forbiddenKeyIn(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_REPORT_KEYS.includes(key)) return key;
    const nested = forbiddenKeyIn(entry, seen);
    if (nested) return nested;
  }
  return null;
}

/**
 * The never-carry rule as an executable assertion, in the same shape as
 * `assertNoPromptText`. Throws rather than returning false: a leak into storage
 * outlives the tab and is not a status.
 */
export function assertNoCarriedPromptText(summary, marker) {
  const serialized = JSON.stringify(summary);
  if (typeof marker === "string" && marker && serialized.includes(marker)) {
    throw new Error("the carried summary holds text from the export it was read from");
  }
  for (const key of FORBIDDEN_REPORT_KEYS) {
    if (new RegExp(`"${key}"\\s*:`).test(serialized)) {
      throw new Error(`the carried summary holds "${key}", which is outside its vocabulary`);
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// The comparison
// ---------------------------------------------------------------------------

/** The four states a surface switches on. Exactly one applies to any reading. */
export const CARRY_FORWARD_STATE = Object.freeze({
  firstReading: "first_reading",
  compatible: "compatible",
  incompatible: "incompatible",
  insufficientEvidence: "insufficient_evidence",
});

/** Why a comparison was not drawn. Null exactly in the compatible state. */
export const CARRY_FORWARD_REASON = Object.freeze({
  noPriorSummary: "no_prior_summary",
  storageUnavailable: "storage_unavailable",
  unreadablePriorSummary: "unreadable_prior_summary",
  schemaChanged: "summary_schema_changed",
  contractChanged: "report_contract_changed",
  rubricChanged: "rubric_changed",
  readingNamesNoMove: "reading_names_no_move",
  leadingMoveChanged: "leading_move_changed",
});

/** The published sentence behind each reason, so no surface writes copy of its own. */
export const CARRY_FORWARD_REASON_RULE = Object.freeze({
  [CARRY_FORWARD_REASON.noPriorSummary]:
    "This is the first reading this browser has carried forward, so there is nothing to compare it "
    + "with. The reading itself is unchanged and complete on its own.",
  [CARRY_FORWARD_REASON.storageUnavailable]:
    "This browser would not let the page look for a previous summary, so whether one exists is "
    + "unknown. Nothing was compared and nothing was stored.",
  [CARRY_FORWARD_REASON.unreadablePriorSummary]:
    "The stored summary is not a summary this build recognizes. It is discarded rather than read "
    + "loosely: a figure salvaged from an unrecognized value is a comparison with nothing behind it.",
  [CARRY_FORWARD_REASON.schemaChanged]:
    "The stored summary was written by a different version of this workflow. Its figures were "
    + "defined differently, so they are not points on one line.",
  [CARRY_FORWARD_REASON.contractChanged]:
    "The report contract has changed since that summary was stored. What counts as a scored prompt "
    + "is part of the compared figure's denominator, so the two readings are not comparable.",
  [CARRY_FORWARD_REASON.rubricChanged]:
    "The rubric or the classifier has changed since that summary was stored. The points would have "
    + "moved without any habit of yours moving, and reporting that as a change would be this "
    + "product taking credit for its own edit.",
  [CARRY_FORWARD_REASON.readingNamesNoMove]:
    "This reading named no move, so there is no cost per request to compare. The summary already "
    + "carried is left exactly as it was.",
  [CARRY_FORWARD_REASON.leadingMoveChanged]:
    "Your leading move is not the one carried forward. Two different habits' costs are not points "
    + "on one line, so no direction is reported — which is itself worth reading: the thing worth "
    + "changing first has changed.",
});

/** Which way the cost of the same habit moved. Falling is improving. */
export const CARRY_FORWARD_DIRECTION = Object.freeze({
  improving: "improving",
  worsening: "worsening",
  flat: "flat",
});

export const CARRY_FORWARD_COMPARISON_FIELDS = Object.freeze([
  "schemaVersion", "question", "state", "reason", "reasonRule", "comparable",
  "moveId", "previous", "current", "delta", "metric", "period", "basis", "boundary",
]);

/**
 * The declared precedence, in the order it is read, and it is total: exactly one
 * branch applies to any pair of a reading and a stored slot.
 *
 * Published as data because "why did this say first reading when I know I read
 * one last week" is the question this artifact will actually be asked, and the
 * answer should be a list a reader can walk rather than a branch they cannot.
 */
export const CARRY_FORWARD_PRECEDENCE = Object.freeze([
  CARRY_FORWARD_REASON.storageUnavailable,
  CARRY_FORWARD_REASON.noPriorSummary,
  CARRY_FORWARD_REASON.unreadablePriorSummary,
  CARRY_FORWARD_REASON.schemaChanged,
  CARRY_FORWARD_REASON.contractChanged,
  CARRY_FORWARD_REASON.rubricChanged,
  CARRY_FORWARD_REASON.readingNamesNoMove,
  CARRY_FORWARD_REASON.leadingMoveChanged,
]);

const STATE_FOR_REASON = Object.freeze({
  [CARRY_FORWARD_REASON.storageUnavailable]: CARRY_FORWARD_STATE.insufficientEvidence,
  [CARRY_FORWARD_REASON.noPriorSummary]: CARRY_FORWARD_STATE.firstReading,
  [CARRY_FORWARD_REASON.unreadablePriorSummary]: CARRY_FORWARD_STATE.incompatible,
  [CARRY_FORWARD_REASON.schemaChanged]: CARRY_FORWARD_STATE.incompatible,
  [CARRY_FORWARD_REASON.contractChanged]: CARRY_FORWARD_STATE.incompatible,
  [CARRY_FORWARD_REASON.rubricChanged]: CARRY_FORWARD_STATE.incompatible,
  [CARRY_FORWARD_REASON.readingNamesNoMove]: CARRY_FORWARD_STATE.insufficientEvidence,
  [CARRY_FORWARD_REASON.leadingMoveChanged]: CARRY_FORWARD_STATE.incompatible,
});

const side = (summary) => (summary === null ? null : Object.freeze({
  reading: summary.reading,
  pointsPerScoredPrompt: summary.pointsPerScoredPrompt,
  scoredPrompts: summary.scoredPrompts,
  distinctDays: summary.distinctDays,
  coverage: summary.coverage,
  confidence: summary.confidence,
}));

function comparison({ reason, moveId = null, previous = null, current = null, delta = null }) {
  return Object.freeze({
    schemaVersion: CARRY_FORWARD_VERSION,
    question: CARRY_FORWARD_QUESTION,
    state: reason === null ? CARRY_FORWARD_STATE.compatible : STATE_FOR_REASON[reason],
    reason,
    reasonRule: reason === null ? null : CARRY_FORWARD_REASON_RULE[reason],
    comparable: reason === null,
    moveId,
    previous,
    current,
    delta,
    metric: CARRY_FORWARD_METRIC,
    period: CARRY_FORWARD_PERIOD,
    basis: CARRY_FORWARD_BASIS,
    boundary: CARRY_FORWARD_BOUNDARY,
  });
}

/**
 * The stored slot read into either a summary or the reason it is not one.
 *
 * Split out from `compareWithCarriedSummary` so the precedence between "the
 * value is wrong" and "the versions moved" is stated once, in one place, in the
 * order `CARRY_FORWARD_PRECEDENCE` publishes.
 *
 * @returns {{summary: object|null, reason: string|null}}
 */
export function readCarriedSummary(storage) {
  const { raw, fault } = readCarriedRaw(storage);
  if (fault === CARRY_FORWARD_FAULT.unavailable) {
    return Object.freeze({ summary: null, reason: CARRY_FORWARD_REASON.storageUnavailable });
  }
  if (fault === CARRY_FORWARD_FAULT.oversize) {
    return Object.freeze({ summary: null, reason: CARRY_FORWARD_REASON.unreadablePriorSummary });
  }
  if (raw === null) return Object.freeze({ summary: null, reason: CARRY_FORWARD_REASON.noPriorSummary });

  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return Object.freeze({ summary: null, reason: CARRY_FORWARD_REASON.unreadablePriorSummary });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return Object.freeze({ summary: null, reason: CARRY_FORWARD_REASON.unreadablePriorSummary });
  }
  // The version checks come before the field check so a summary from an older
  // build is reported as a version change rather than as a corrupt value: the
  // two send a reader to different places, and only one of them is alarming.
  if (parsed.schemaVersion !== CARRY_FORWARD_VERSION) {
    return Object.freeze({ summary: null, reason: CARRY_FORWARD_REASON.schemaChanged });
  }
  if (parsed.reportVersion !== CARRY_FORWARD_VERSION_PINS.report) {
    return Object.freeze({ summary: null, reason: CARRY_FORWARD_REASON.contractChanged });
  }
  if (parsed.rubricVersion !== CARRY_FORWARD_VERSION_PINS.rubric
    || parsed.classifierVersion !== CARRY_FORWARD_VERSION_PINS.classifier) {
    return Object.freeze({ summary: null, reason: CARRY_FORWARD_REASON.rubricChanged });
  }
  if (!validateCarriedSummary(parsed).valid) {
    return Object.freeze({ summary: null, reason: CARRY_FORWARD_REASON.unreadablePriorSummary });
  }
  return Object.freeze({ summary: Object.freeze(parsed), reason: null });
}

/**
 * One reading against one stored slot.
 *
 * Pure: it takes the slot's already-resolved contents rather than a storage
 * object, so every state below is reachable in a test without a browser and the
 * decision is separable from the I/O that fed it.
 *
 * @param {object} report a report from `buildPersonalHistoryReport`.
 * @param {{summary: object|null, reason: string|null}} slot from `readCarriedSummary`.
 * @param {{origin?: string}} options the worked example is never compared and
 *   never carried: its history belongs to an invented person.
 * @returns {object} frozen, closed over `CARRY_FORWARD_COMPARISON_FIELDS`.
 */
export function compareWithCarriedSummary(report, slot, { origin = CARRY_FORWARD_ORIGIN.ownExport } = {}) {
  const named = report?.state === PERSONAL_REPORT_STATE.prioritized
    && origin === CARRY_FORWARD_ORIGIN.ownExport;
  const previous = slot?.summary ?? null;

  if (slot?.reason) return comparison({ reason: slot.reason });
  if (!previous) return comparison({ reason: CARRY_FORWARD_REASON.noPriorSummary });
  if (!named) return comparison({ reason: CARRY_FORWARD_REASON.readingNamesNoMove, previous: side(previous) });

  const now = carryForwardSummary(report, { origin, reading: previous.reading + 1 });
  if (!now) return comparison({ reason: CARRY_FORWARD_REASON.readingNamesNoMove, previous: side(previous) });
  if (now.moveId !== previous.moveId) {
    return comparison({
      reason: CARRY_FORWARD_REASON.leadingMoveChanged,
      previous: side(previous),
      current: side(now),
    });
  }

  const change = roundTo(now.pointsPerScoredPrompt - previous.pointsPerScoredPrompt, POINT_DECIMALS);
  return comparison({
    reason: null,
    moveId: now.moveId,
    previous: side(previous),
    current: side(now),
    delta: Object.freeze({
      pointsPerScoredPrompt: change,
      direction: change < 0 ? CARRY_FORWARD_DIRECTION.improving
        : change > 0 ? CARRY_FORWARD_DIRECTION.worsening
          : CARRY_FORWARD_DIRECTION.flat,
      // The weaker of the two levels, because a comparison is only as good as
      // its worse end. Not a confidence of its own and not an average of two:
      // averaging confidences would invent a level neither reading earned.
      basisConfidence: weaker(previous.confidence, now.confidence),
      arithmetic: `${now.pointsPerScoredPrompt} points per scored prompt this reading, against `
        + `${previous.pointsPerScoredPrompt} last reading, on the same move`,
    }),
  });
}

/** Low beats moderate beats high: the worse end of a comparison is the one that binds. */
const CONFIDENCE_ORDER = Object.freeze(["none", "low", "moderate", "high"]);
function weaker(left, right) {
  const at = (level) => {
    const index = CONFIDENCE_ORDER.indexOf(level);
    return index === -1 ? 0 : index;
  };
  return at(left) <= at(right) ? left : right;
}

/**
 * The whole of what a surface calls: compare this reading against the slot, then
 * carry this reading forward if it earned the right to be carried.
 *
 * WHEN THE SLOT IS REPLACED, and only then: the reading named a move and came
 * from the reader's own export. A refusal replaces nothing — a reader whose
 * second file was unreadable has not lost the summary from their first — and the
 * worked example replaces nothing, ever.
 *
 * WHEN NOTHING IS STORED AT ALL. If storage is unavailable the comparison says
 * so and the reading is unaffected. This is the case the workflow behaves in
 * today, and it is the case it must keep behaving correctly in: the reading is
 * the product, and the comparison is a line beside it.
 *
 * @returns {{comparison: object, stored: {written: boolean, fault: string|null}}}
 */
export function carryForward(report, storage, { origin = CARRY_FORWARD_ORIGIN.ownExport } = {}) {
  const slot = readCarriedSummary(storage);
  let result = compareWithCarriedSummary(report, slot, { origin });
  const reading = (slot.summary?.reading ?? 0) + 1;
  const summary = carryForwardSummary(report, { origin, reading });
  const stored = summary
    ? writeCarriedSummary(storage, summary)
    : Object.freeze({ written: false, fault: null });
  // "First reading" means the browser actually carried it forward. A storage
  // object can allow the lookup and still deny the write (quota, policy, or a
  // private-window restriction), so the successful empty lookup alone is not
  // enough to make that claim.
  if (result.reason === CARRY_FORWARD_REASON.noPriorSummary
    && stored.fault === CARRY_FORWARD_FAULT.unavailable) {
    result = comparison({ reason: CARRY_FORWARD_REASON.storageUnavailable });
  }
  return Object.freeze({ comparison: result, stored });
}
