// The personal AI-history grading contract: what a person's own export may be,
// what this product reads out of it, and what it refuses to say about them.
//
// ONE DECISION. This contract exists to answer exactly one question:
//
//     "What single improvement should I prioritize in my own AI usage?"
//
// Not "how good are my prompts" — that is `prompt-coaching.js`, and it answers it
// about one paste. Not "how does my team compare" — that is the conversation
// export path, which needs a department column this shape does not have and must
// not grow. A personal history is one person's messages, and the only thing worth
// reading out of a stack of them is the habit worth changing first.
//
// WHY THIS IS A SEPARATE CONTRACT FROM conversation-export.js. The organizational
// reader is built around a department and an actor: it groups, it rolls up, and
// its coverage metric is measured in money. A personal export has one actor
// (you), no department, and no spend, so every one of those fields would be a
// column of nulls a surface could still print. What replaces them is a date —
// required for a *product* reason stated in `PERSONAL_REQUIRED_FIELDS`.
//
// WHAT THIS CONTRACT DELIBERATELY LEAVES OUT, and will keep leaving out:
// comparisons of any kind (no percentile, cohort, peer, team, or organizational
// grade); provider credential connection; upload and storage; attachment
// analysis; customer data; persistent prompt capture. `PERSONAL_BASIS` and
// `PERSONAL_HISTORY_EXCLUSIONS` state each refusal, and `FORBIDDEN_REPORT_KEYS`
// makes the first one mechanical: a report that grew a comparison field fails
// validation rather than shipping.
//
// DETERMINISM. Everything here is data or a pure function. No clock, no
// randomness, no identifier generation, so the same export read twice produces a
// byte-identical report and two engineers computing a figure by hand from
// `PERSONAL_METRIC_DEFINITIONS` get the number the code got.

/** Bump when a field, a reason code, a state, or a metric changes meaning. */
export const PERSONAL_HISTORY_VERSION = "personal-history-report/1.0.0";

/** The one question. A report that answers a different one is not this report. */
export const PERSONAL_HISTORY_QUESTION =
  "What single improvement should I prioritize in my own AI usage?";

// ---------------------------------------------------------------------------
// The supported export shapes
// ---------------------------------------------------------------------------

/**
 * The shapes this product reads, declared as data so a reader can check their
 * own file against the list before pasting it anywhere.
 *
 * Two, not five. Each one is a shape a person can actually obtain for
 * themselves: the JSON an assistant hands back from "export my data", and a
 * table anyone can produce from a spreadsheet. A vendor shape nobody can export
 * without an admin seat belongs to the organizational reader, not here.
 *
 * `detect` is the human-readable rule; the executable form is
 * `detectPersonalExportShape` in personal-history-report.js, and the two are
 * pinned to each other by tests/personal-history-report.test.js.
 */
export const PERSONAL_EXPORT_SHAPES = Object.freeze([
  Object.freeze({
    id: "personal-conversation-json",
    label: "Personal conversation export (JSON)",
    container: "json",
    detect: "The file parses as JSON and is either an array of conversations or an object "
      + "carrying a `conversations` array. Each conversation carries a `messages` array.",
    promptEntry: "One message whose role is user, human, or you. Assistant, system, and tool "
      + "messages are read for nothing at all — not counted, not measured, not classified.",
    dateFields: Object.freeze(["create_time", "created_at", "createdAt", "timestamp", "time", "date"]),
    textFields: Object.freeze(["text", "content", "message", "body", "parts"]),
    dateFallback: "A message with no date of its own inherits its conversation's date. A "
      + "conversation with no date leaves its messages undated, which is a counted drop and "
      + "never a guess.",
  }),
  Object.freeze({
    id: "personal-prompt-table",
    label: "Personal prompt log (CSV or TSV)",
    container: "delimited",
    detect: "The file reads as delimited text whose header carries one recognized date column "
      + "and one recognized prompt column. A header missing either is not this shape.",
    promptEntry: "One data row. A prompt log has no roles in it, so every row is taken as "
      + "something you wrote.",
    dateFields: Object.freeze(["date", "created_at", "create_time", "timestamp", "time", "when", "day"]),
    textFields: Object.freeze(["prompt", "message", "text", "content", "message_text", "request"]),
    dateFallback: "None. A table row carries its own date or it is a counted drop.",
  }),
]);

/**
 * The two fields a personal export must carry, and the product reason for each.
 *
 * A schema requirement with no product reason behind it is a field somebody
 * deletes in a year. These two have reasons a reader can argue with:
 *
 *   date    the report names a habit. A habit is a thing you do across days, and
 *           without a date twenty prompts from one bad afternoon are
 *           indistinguishable from twenty prompts across a month. The
 *           `minDistinctDays` floor below is what the date is *for*; it is not
 *           collected to display a range.
 *   prompt  there is nothing to grade without the text you wrote. It is read,
 *           measured, classified, and dropped inside one function call — see the
 *           prompt-storage row of `PERSONAL_HISTORY_EXCLUSIONS`.
 *
 * Everything else an export carries — titles, model names, identifiers,
 * assistant replies, attachments, ratings, share links — is not read. Not
 * "read and discarded": there is no branch that looks at them.
 */
export const PERSONAL_REQUIRED_FIELDS = Object.freeze([
  Object.freeze({
    field: "date",
    required: true,
    why: "The report claims a habit, and a habit is measured across distinct days. The date is "
      + "what makes `minDistinctDays` checkable; it is not shown as a range and no time of day "
      + "is read from it.",
    granularity: "A UTC calendar date, YYYY-MM-DD. The clock time in a timestamp is discarded "
      + "on read, because nothing this report answers depends on the hour and an hour is a "
      + "fingerprint.",
  }),
  Object.freeze({
    field: "prompt",
    required: true,
    why: "The text you wrote is the only evidence of how you ask. It is classified into this "
      + "repository's own move identifiers and never retained.",
    granularity: "The message body as a string. Empty after trimming is a counted drop, not an "
      + "error and not a zero score.",
  }),
]);

// ---------------------------------------------------------------------------
// The boundary and the exclusions
// ---------------------------------------------------------------------------

/**
 * The boundary, as data, and constant. A boundary that varied per report would
 * be a setting rather than a boundary. It rides on *every* report this contract
 * produces — the eligible ones, the ineligible ones, and the refusals — because
 * the state a reader most wants the boundary restated in is the one where the
 * product just told them it could not read their file.
 */
export const PERSONAL_BOUNDARY = Object.freeze({
  readIn: "this browser tab",
  analysisCode: "bundled static client-side modules",
  sentForAnalysis: "none",
  uploaded: "none",
  persisted: "none",
  retainsPromptText: false,
  attachmentsRead: false,
  providerAccountsConnected: "none",
  integrationsContacted: "none",
});

export const PERSONAL_BOUNDARY_FIELDS = Object.freeze(Object.keys(PERSONAL_BOUNDARY));

/**
 * Each class of thing this workflow excludes, paired with the property that
 * makes the claim checkable rather than believable on tone. Every `verify`
 * sentence is asserted mechanically in tests/personal-history-contract.test.js,
 * so a change that breaks a claim fails a test instead of aging into a lie.
 */
export const PERSONAL_HISTORY_EXCLUSIONS = Object.freeze([
  Object.freeze({
    id: "credentials",
    label: "Credentials and provider accounts",
    claim: "No API key, token, cookie, password, or assistant account is read, required, or "
      + "connected. There is no sign-in, no OAuth step, and no provider to connect to — the "
      + "input is a file you exported for yourself.",
    verify: "No module reachable from the personal-history reader references a cookie, a "
      + "storage API, an authorization header, or any provider endpoint.",
  }),
  Object.freeze({
    id: "upload",
    label: "Upload and storage",
    claim: "Your export is read in this tab. Nothing is uploaded, nothing is written to "
      + "browser storage, and nothing is put in a URL.",
    verify: "No module reachable from the reader references fetch, XMLHttpRequest, sendBeacon, "
      + "WebSocket, EventSource, localStorage, sessionStorage, or IndexedDB.",
  }),
  Object.freeze({
    id: "prompt-storage",
    label: "Persistent prompt capture",
    claim: "No prompt text is kept. Each message is measured and classified inside one call "
      + "and the report carries counts and move identifiers in its place.",
    verify: "A report built from an export whose every prompt contains a unique marker string "
      + "contains that marker in no field, at any depth, once serialized.",
  }),
  Object.freeze({
    id: "attachments",
    label: "Attachments",
    claim: "Files, images, and other non-text parts are counted so the coverage figure is "
      + "honest, and are never opened, decoded, named, or measured.",
    verify: "The reader records attachments as an integer count only; no filename, MIME type, "
      + "byte length, or content of an attachment appears in a report.",
  }),
  Object.freeze({
    id: "customer-data",
    label: "Customer and organizational data",
    claim: "No Wawalu production system, customer record, billing dataset, org chart, or "
      + "telemetry source is read, joined, or contacted.",
    verify: "The reader imports only the bundled rubric, classifier, and delimited-text "
      + "modules; no dataset, roster, workspace, or import fixture is read.",
  }),
  Object.freeze({
    id: "comparison",
    label: "Benchmarking against other people",
    claim: "This is a reading of one person's own export. It is never a percentile, a peer "
      + "cohort position, a team score, or an organizational grade.",
    verify: "`FORBIDDEN_REPORT_KEYS` rejects a report carrying a comparison, benchmark, "
      + "percentile, cohort, peer, team, or organization field at any depth.",
  }),
]);

/**
 * What the report is a claim about, restated on every report.
 *
 * `population: 1` is the whole argument. A grade drawn from one person's history
 * describes that person's habits and nothing else; the moment it is read as a
 * standard it becomes a number about people who were never measured.
 */
export const PERSONAL_BASIS = Object.freeze({
  unit: "one person's own export",
  population: 1,
  comparisonsMade: "none",
  claim: "This names the habit worth changing first in the prompts you wrote. It is a reading "
    + "of your own history at the grain of one person.",
  refusal: "It is not a benchmark. Nothing here is a percentile, a peer comparison, a team "
    + "score, or an organizational grade, and a report of one person must never be presented "
    + "as one.",
});

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

/**
 * The two floors a history clears before any move is prioritized, read with
 * `>=` so a history sitting exactly on a floor is reported.
 *
 * WHY TWENTY PROMPTS. At twenty, one prompt is a twentieth of the evidence, so
 * the leading move cannot flip on a single message. Below it the ranking reads
 * an afternoon, and telling somebody to change how they work on that basis is
 * worse than telling them nothing.
 *
 * WHY FIVE DAYS. This is the floor the date field exists to serve. Twenty
 * prompts in one sitting are twenty samples of one mood; five days is the
 * smallest span in which a repeated shape is a habit. It is deliberately not a
 * *calendar* span — five distinct days scattered over three months qualify,
 * because the claim is about recurrence and not recency.
 *
 * Both bind, and the reason code says which failed: "grade more prompts" and
 * "come back after a few more days" send a reader to different places.
 */
export const PERSONAL_ELIGIBILITY = Object.freeze({
  minScoredPrompts: 20,
  minDistinctDays: 5,
  operator: ">=",
});

/**
 * The in-tab ceiling. Reading is synchronous and single-threaded, and a report
 * that locks a tab for a minute is a report nobody waits for. Stated as a
 * refusal with its own reason code rather than a silent truncation: a report
 * drawn from the first N prompts of a larger file is a coverage figure that
 * quietly lies.
 */
export const PERSONAL_READER_LIMITS = Object.freeze({
  maxPromptEntries: 2000,
  maxChars: 12_000_000,
});

/**
 * Why no move was prioritized. A closed set; a surface switches on the code and
 * never on a sentence.
 *
 * Precedence is the declared order and it is total — exactly one applies.
 */
export const PERSONAL_NOT_ELIGIBLE = Object.freeze({
  unsupportedInput: "unsupported_input",
  exportTooLarge: "export_too_large",
  unrecognizedShape: "unrecognized_export_shape",
  noPromptEntries: "no_prompt_entries",
  noDatedPrompts: "no_dated_prompts",
  tooFewScoredPrompts: "too_few_scored_prompts",
  tooFewDistinctDays: "too_few_distinct_days",
});

/** The published sentence behind each reason, so no surface writes copy of its own. */
export const PERSONAL_NOT_ELIGIBLE_RULE = Object.freeze({
  [PERSONAL_NOT_ELIGIBLE.unsupportedInput]:
    "An export is read as text. Nothing else was handed in, so there was nothing to read.",
  [PERSONAL_NOT_ELIGIBLE.exportTooLarge]:
    `This file is over the in-tab ceiling of ${PERSONAL_READER_LIMITS.maxPromptEntries} prompts. `
    + "Reading part of it would produce a coverage figure that describes a file you did not "
    + "hand in, so nothing is read. Split the export and read one part at a time.",
  [PERSONAL_NOT_ELIGIBLE.unrecognizedShape]:
    "This file matched neither supported personal export shape. Check it against the two shapes "
    + "this product reads; a shape it does not recognize is not guessed at.",
  [PERSONAL_NOT_ELIGIBLE.noPromptEntries]:
    "The shape was recognized and it carries no message you wrote. Assistant replies are not "
    + "read, so an export of replies alone has nothing in it to grade.",
  [PERSONAL_NOT_ELIGIBLE.noDatedPrompts]:
    "Prompts were found and none of them carried a date this reader could parse. The date is "
    + "required because the report claims a habit across days, and a habit cannot be measured "
    + "without one.",
  [PERSONAL_NOT_ELIGIBLE.tooFewScoredPrompts]:
    `Fewer than ${PERSONAL_ELIGIBILITY.minScoredPrompts} of your prompts could be scored. Below `
    + "that floor one message is more than a twentieth of the evidence, and the move that ranks "
    + "first can flip on a single prompt.",
  [PERSONAL_NOT_ELIGIBLE.tooFewDistinctDays]:
    `Your scored prompts fall on fewer than ${PERSONAL_ELIGIBILITY.minDistinctDays} distinct `
    + "days. That is a session, not a habit, and this report only names habits.",
});

// ---------------------------------------------------------------------------
// The result states
// ---------------------------------------------------------------------------

/**
 * The three states a client switches on, in the order a surface reads them: the
 * one that answers the question, the one that says there is nothing to answer,
 * and the one that says the question cannot be asked of this file yet.
 *
 * Each `boundary` line restates what was and was not done with the file *in that
 * state*, because the boundary is the thing a reader is owed most exactly when
 * the product has just refused them.
 */
export const PERSONAL_REPORT_STATE = Object.freeze({
  prioritized: "prioritized",
  noMoveAvailable: "no_move_available",
  notEligible: "not_eligible",
});

const READ_BOUNDARY = "Your export was read in this tab and is gone from memory when you leave "
  + "the page. Nothing was uploaded and nothing was stored.";

export const PERSONAL_REPORT_STATES = Object.freeze([
  Object.freeze({
    state: PERSONAL_REPORT_STATE.prioritized,
    label: "One move, prioritized",
    meaning: "Your history cleared both floors and one move ranks ahead of the rest.",
    delivers: "the single move, what it is worth across your history, how many of your prompts "
      + "it applies to, a ready-to-edit rewrite, the runner-up it beat, and a named confidence.",
    boundary: READ_BOUNDARY,
  }),
  Object.freeze({
    state: PERSONAL_REPORT_STATE.noMoveAvailable,
    label: "Nothing to prioritize",
    meaning: "Enough of your prompts scored, and the rubric found no move worth points in any.",
    delivers: "the coverage and confidence figures, and an explicit statement that no move was "
      + "found — never a filler suggestion.",
    boundary: READ_BOUNDARY,
  }),
  Object.freeze({
    state: PERSONAL_REPORT_STATE.notEligible,
    label: "Not enough to answer this yet",
    meaning: "The file could not be read, or it was read and does not meet a declared floor.",
    delivers: "a reason code, the published sentence behind it, and every count that was "
      + "measured on the way — no move, no grade, no partial answer.",
    boundary: "Whatever was read was read in this tab and is already gone. A refusal stores "
      + "nothing, and nothing was uploaded in order to produce it.",
  }),
]);

// ---------------------------------------------------------------------------
// The metric definitions
// ---------------------------------------------------------------------------

/**
 * Every derived figure a report publishes, defined precisely enough that two
 * engineers compute it the same way, and published as data so a reader disputing
 * a number reads the definition rather than a branch.
 *
 * The drop buckets have a declared precedence and are mutually exclusive, which
 * is what makes `IDENTITY` below hold. Without it a prompt that is both empty
 * and undated could be counted twice and the coverage denominator would stop
 * reconciling.
 */
const metric = (name, definition, excludes) => Object.freeze({ metric: name, definition, excludes });

export const PERSONAL_METRIC_DEFINITIONS = Object.freeze([
  metric("prompt_entries",
    "The number of prompt entries the recognized shape identified, before any validation. "
      + "This is the coverage denominator.",
    "Assistant, system, and tool messages, and entries that carry only attachments."),
  metric("attachments_skipped",
    "The number of non-text parts and attachment entries encountered. An integer count and "
      + "nothing else.",
    "Filenames, MIME types, byte sizes, and content — none of which are read."),
  metric("dropped.empty",
    "Prompt entries whose text is empty after trimming. Precedence 1.",
    "Entries that also lack a date; they are counted here and not again."),
  metric("dropped.undated",
    "Non-empty prompt entries with no date this reader could parse. Precedence 2.",
    "Empty entries, which are counted at precedence 1."),
  metric("dropped.unreadable",
    "Dated, non-empty prompt entries the rubric returned no score for — code with no request "
      + "in it, or text the classifier cannot read. Precedence 3.",
    "Entries dropped at an earlier precedence."),
  metric("scored_prompts",
    "Prompt entries that produced a graded result.",
    "Everything in a drop bucket."),
  metric("distinct_days",
    "The number of distinct UTC calendar dates (YYYY-MM-DD) across scored prompts. The clock "
      + "time in a timestamp is discarded before the date is taken.",
    "Days on which only dropped entries fall."),
  metric("coverage",
    "scored_prompts / prompt_entries, as a raw ratio in [0, 1]. Null exactly when prompt_entries "
      + "is 0, which is the absence of a denominator and not a coverage of zero.",
    "Any weighting. Every prompt counts once — a personal history has no spend to weight by and "
      + "inventing one would be a number with nothing behind it."),
  metric("prompts_affected(move)",
    "The number of scored prompts in which that move is available — the rubric either penalised "
      + "its absence or found a credit it could still earn.",
    "Prompts where the move is already satisfied."),
  metric("priority_points(move)",
    "The sum, over the scored prompts where the move is available, of that prompt's own points "
      + "for it, rounded to two decimals at the end. A prompt's points are the rubric's: the "
      + "move's weight on the composite, times its axis's share of the composite. The unit is "
      + "composite points this move could recover across your whole history.",
    "Any invented severity scale. The weights are the published rubric's, so a reader disputing "
      + "a ranking disputes one JSON file."),
  metric("lead_margin",
    "(priority_points(first) - priority_points(second)) / priority_points(first), a ratio in "
      + "[0, 1]. It is 1 when there is no runner-up and 0 when the top two are worth the same.",
    "Third place onward. The decision is between the move being recommended and the one it beat; "
      + "nothing below that changes what to do on Monday."),
]);

/**
 * The reconciliation a consumer can run on any coverage block. Published because
 * it is the cheapest possible check that the drop buckets are exclusive and the
 * denominator is honest, and asserted in both test files.
 */
export const PERSONAL_COVERAGE_IDENTITY =
  "prompt_entries = scored_prompts + dropped.empty + dropped.undated + dropped.unreadable";

/**
 * The ranking rule, in full, so that "which move came first" is never a matter
 * of reading a comparator.
 *
 * WHY POINTS AND NOT FREQUENCY. A move that applies to every prompt but is worth
 * little is not the thing to change first. Points already carry frequency — they
 * are a sum over the prompts a move applies to — so ranking by points ranks by
 * recurrence *and* by what the rubric says the move is worth.
 *
 * WHY MEASURED BEATS PROJECTED ONLY AS A TIE-BREAK. Evidence deserves the tie
 * and not the ranking: two vague requests in forty prompts are real, and still
 * not the thing to fix ahead of a habit costing points on every message.
 */
export const PERSONAL_RANKING_RULE = Object.freeze({
  primary: "priority_points, highest first",
  tieBreaks: Object.freeze([
    "prompts_affected, highest first",
    "measured before projected — a fired penalty outranks an unfired credit",
    "move identifier, lexicographic, so the same export always yields the same move",
  ]),
});

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

/**
 * Confidence in *this decision*, which is a different question from confidence
 * in a score. The decision is "prioritize this move over the next one", so the
 * two things that can make it wrong are: too little of your history to see a
 * habit, and a runner-up too close to call.
 *
 * Both are required at every level above the floor. A wide margin over eight
 * prompts is a coincidence; a hundred prompts with two moves worth the same is a
 * coin toss. Read high to low with `>=`, first match wins.
 *
 * WHY THESE NUMBERS. At the floor of 20 scored prompts one prompt is worth 5
 * margin points, so a 25-point margin cannot be told from noise there — which is
 * why `high` also requires four times the floor, where one prompt moves the
 * margin by about 1.25 points. `moderate` pairs twice the floor with a 10-point
 * margin for the same reason.
 *
 * NOT A 0-1 SCORE. This repository has refused to invent one three times (the
 * trust verdict, grade eligibility, the imported-corpus grade) and refuses again
 * here: a reader can dispute "your top two moves are worth within a tenth of
 * each other" and cannot dispute "0.62".
 */
export const PERSONAL_CONFIDENCE_TIERS = Object.freeze([
  Object.freeze({
    level: "high",
    label: "High confidence",
    minFloorMultiple: 4,
    minLeadMargin: 0.25,
    rule: `At least ${PERSONAL_ELIGIBILITY.minScoredPrompts * 4} scored prompts and a leading `
      + "move worth at least a quarter more than the runner-up. No single prompt can change "
      + "which move comes first.",
  }),
  Object.freeze({
    level: "moderate",
    label: "Moderate confidence",
    minFloorMultiple: 2,
    minLeadMargin: 0.10,
    rule: `At least ${PERSONAL_ELIGIBILITY.minScoredPrompts * 2} scored prompts and a leading `
      + "move worth at least a tenth more than the runner-up. The order is stable against a "
      + "prompt or two either way.",
  }),
  Object.freeze({
    level: "low",
    label: "Low confidence",
    minFloorMultiple: 1,
    minLeadMargin: 0,
    rule: `At least ${PERSONAL_ELIGIBILITY.minScoredPrompts} scored prompts — the declared `
      + "floor, and no further. The move named is the one your history ranks first; treat the "
      + "runner-up beside it as an equally reasonable place to start.",
  }),
]);

/** The confidence of a report that names no move. Named, so the field is never absent. */
export const PERSONAL_CONFIDENCE_NONE = Object.freeze({
  level: "none",
  label: "No move to be confident in",
  rule: "No move was prioritized, so there is no confidence in one. Confidence is a statement "
    + "about a recommendation, never a consolation number offered in place of one.",
  // Null rather than absent, and null rather than zeroes. A basis full of zeroes
  // is arithmetic a surface can print beside a refusal as though it meant
  // something; the field exists so `confidence` has one shape everywhere.
  basis: null,
});

/**
 * The coverage floor below which a confidence level is downgraded one step,
 * never below `low`.
 *
 * WHY A DOWNGRADE AND NOT A REFUSAL. The scored prompts were scored correctly;
 * what is unknown is whether the quarter this reader could not read holds a
 * different leading move. That weakens the recommendation without invalidating
 * the arithmetic, which is exactly what a confidence level is for.
 */
export const PERSONAL_COVERAGE_FLOOR = 0.75;

// ---------------------------------------------------------------------------
// The closed field lists
// ---------------------------------------------------------------------------

export const PERSONAL_REPORT_FIELDS = Object.freeze([
  "schemaVersion", "question", "shape", "state", "reason", "reasonRule",
  "eligibility", "coverage", "confidence", "priority", "basis", "boundary",
]);

export const PERSONAL_COVERAGE_FIELDS = Object.freeze([
  "ratio", "promptEntries", "scoredPrompts", "distinctDays", "dropped",
  "attachmentsSkipped", "identity",
]);

export const PERSONAL_DROPPED_FIELDS = Object.freeze(["empty", "undated", "unreadable"]);

export const PERSONAL_ELIGIBILITY_FIELDS = Object.freeze([
  "minScoredPrompts", "minDistinctDays", "operator", "scoredPrompts",
  "distinctDays", "met", "boundary",
]);

export const PERSONAL_CONFIDENCE_FIELDS = Object.freeze([
  "level", "label", "rule", "basis",
]);

export const PERSONAL_PRIORITY_FIELDS = Object.freeze([
  "available", "id", "kind", "evidence", "axis", "title", "guidance", "rewrite",
  "promptsAffected", "promptShare", "points", "leadMargin", "runnerUp",
]);

/**
 * Keys a report may never carry at any depth, and the two rules behind the list.
 *
 * PROMPT TEXT: the report carries measurements of what you wrote, never what you
 * wrote. A key-name rule is not sufficient on its own — the marker test in
 * tests/personal-history-contract.test.js is what actually proves it — but it
 * catches the shape of mistake that gets made under deadline.
 *
 * COMPARISON: a one-person report that grew a percentile is the exact failure
 * this contract was written to prevent, so the field names that would carry one
 * are refused mechanically rather than reviewed for.
 */
export const FORBIDDEN_REPORT_KEYS = Object.freeze([
  "text", "prompt", "body", "content", "message", "excerpt", "transcript",
  "attachment", "attachments", "filename", "conversationId",
  "credential", "token", "cookie", "apiKey", "email", "account",
  "percentile", "cohort", "peer", "benchmark", "team", "organization", "org",
  "comparison", "rank", "average", "median",
]);

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function fieldsMatch(value, fields) {
  const keys = Object.keys(value ?? {});
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
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

const isCount = (value) => Number.isInteger(value) && value >= 0;

/**
 * Check a report against this contract.
 *
 * @returns {{valid: boolean, errors: ReadonlyArray<{code: string, detail: string}>}}
 *   every failure, not the first: a consumer fixing a producer wants the list.
 *   Codes are stable; a caller switches on them and never on a sentence.
 */
export function validatePersonalHistoryReport(report) {
  const errors = [];
  const fail = (code, detail) => errors.push(Object.freeze({ code, detail }));

  if (!report || typeof report !== "object" || Array.isArray(report)) {
    return Object.freeze({
      valid: false,
      errors: Object.freeze([Object.freeze({ code: "not_an_object", detail: "a report must be an object" })]),
    });
  }
  if (report.schemaVersion !== PERSONAL_HISTORY_VERSION) {
    fail("unsupported_version", `this build reads ${PERSONAL_HISTORY_VERSION}`);
  }
  if (!fieldsMatch(report, PERSONAL_REPORT_FIELDS)) {
    fail("report_fields", `a report carries exactly: ${PERSONAL_REPORT_FIELDS.join(", ")}`);
  }
  if (report.question !== PERSONAL_HISTORY_QUESTION) {
    fail("question", "a report answers the one question this product asks of a personal history");
  }
  if (!Object.values(PERSONAL_REPORT_STATE).includes(report.state)) {
    fail("state", `state must be one of: ${Object.values(PERSONAL_REPORT_STATE).join(", ")}`);
  }

  const eligible = report.state !== PERSONAL_REPORT_STATE.notEligible;
  if (eligible && report.reason !== null) {
    fail("reason_mismatch", "an eligible report carries no reason code");
  }
  if (!eligible && !Object.values(PERSONAL_NOT_ELIGIBLE).includes(report.reason)) {
    fail("reason", `an ineligible report names a reason from: ${Object.values(PERSONAL_NOT_ELIGIBLE).join(", ")}`);
  }
  if (report.reason !== null && report.reasonRule !== PERSONAL_NOT_ELIGIBLE_RULE[report.reason]) {
    fail("reason_rule", "the published sentence travels with the reason code");
  }

  if (!fieldsMatch(report.coverage, PERSONAL_COVERAGE_FIELDS)) {
    fail("coverage_fields", `coverage carries exactly: ${PERSONAL_COVERAGE_FIELDS.join(", ")}`);
  } else if (!fieldsMatch(report.coverage.dropped, PERSONAL_DROPPED_FIELDS)) {
    fail("dropped_fields", `dropped carries exactly: ${PERSONAL_DROPPED_FIELDS.join(", ")}`);
  } else {
    const { ratio, promptEntries, scoredPrompts, distinctDays, dropped, attachmentsSkipped } = report.coverage;
    const counts = [promptEntries, scoredPrompts, distinctDays, attachmentsSkipped,
      ...PERSONAL_DROPPED_FIELDS.map((field) => dropped[field])];
    if (!counts.every(isCount)) fail("coverage_counts", "every coverage figure is a non-negative integer");
    else if (promptEntries !== scoredPrompts + dropped.empty + dropped.undated + dropped.unreadable) {
      fail("coverage_identity", PERSONAL_COVERAGE_IDENTITY);
    }
    if (promptEntries === 0 ? ratio !== null : !(Number.isFinite(ratio) && ratio >= 0 && ratio <= 1)) {
      fail("coverage_ratio", "coverage is a ratio in [0, 1], and null exactly when there are no prompt entries");
    }
    if (report.coverage.identity !== PERSONAL_COVERAGE_IDENTITY) {
      fail("coverage_identity_text", "the reconciliation travels with the figures it reconciles");
    }
  }

  if (!fieldsMatch(report.eligibility, PERSONAL_ELIGIBILITY_FIELDS)) {
    fail("eligibility_fields", `eligibility carries exactly: ${PERSONAL_ELIGIBILITY_FIELDS.join(", ")}`);
  } else if (report.eligibility.met !== eligible) {
    fail("eligibility_met", "eligibility.met and the report state say the same thing");
  } else if (typeof report.eligibility.boundary !== "string" || !report.eligibility.boundary) {
    fail("eligibility_boundary", "eligibility restates what was done with the file");
  }

  if (!fieldsMatch(report.confidence, PERSONAL_CONFIDENCE_FIELDS)) {
    fail("confidence_fields", `confidence carries exactly: ${PERSONAL_CONFIDENCE_FIELDS.join(", ")}`);
  } else {
    const levels = [...PERSONAL_CONFIDENCE_TIERS.map((tier) => tier.level), PERSONAL_CONFIDENCE_NONE.level];
    if (!levels.includes(report.confidence.level)) {
      fail("confidence_level", `confidence.level must be one of: ${levels.join(", ")}`);
    }
    const named = report.state === PERSONAL_REPORT_STATE.prioritized;
    if (!named && report.confidence.level !== PERSONAL_CONFIDENCE_NONE.level) {
      fail("confidence_without_move", "a report naming no move carries no confidence level");
    }
  }

  if (!fieldsMatch(report.priority, PERSONAL_PRIORITY_FIELDS)) {
    fail("priority_fields", `priority carries exactly: ${PERSONAL_PRIORITY_FIELDS.join(", ")}`);
  } else if (report.priority.available !== (report.state === PERSONAL_REPORT_STATE.prioritized)) {
    fail("priority_available", "a move is available exactly in the prioritized state");
  } else if (report.priority.available && typeof report.priority.id !== "string") {
    fail("priority_id", "a prioritized move names the rubric move it is");
  }

  if (!fieldsMatch(report.boundary, PERSONAL_BOUNDARY_FIELDS)
    || PERSONAL_BOUNDARY_FIELDS.some((field) => report.boundary[field] !== PERSONAL_BOUNDARY[field])) {
    fail("boundary", "the boundary is constant and stated in full on every report, refusals included");
  }
  if (report.basis?.population !== 1 || report.basis?.comparisonsMade !== "none") {
    fail("basis", "a report is a claim about one person and makes no comparison");
  }

  const forbidden = forbiddenKeyIn(report);
  if (forbidden) fail("forbidden_key", `"${forbidden}" would carry prompt text or a comparison`);

  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
