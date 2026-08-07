// The versioned coaching session: what a client receives when it coaches one
// piece of text, and what it is guaranteed never to receive.
//
// WHY THIS EXISTS SEPARATELY FROM prompt-coaching.js.
// `gradeMyPrompt` answers the reader's question. This module answers the three
// questions someone asks *before* they paste anything into a box on the open
// internet, and it answers them in data rather than in prose a reader has to
// take on faith:
//
//   1. WHAT TEXT IS ANALYZED — `COACHING_SAMPLES` carries bundled, synthetic
//      text and `session.input` says exactly what was measured about it. The
//      measurements are counts; the text itself is never carried in a session.
//   2. WHAT RESULT FIELDS COME BACK — `SESSION_FIELDS`, `GRADED_RESULT_FIELDS`,
//      `REFUSAL_RESULT_FIELDS` and `RESULT_FIELD_MEANINGS` are the closed field
//      lists a consumer may rely on, and `validateCoachingSession` refuses a
//      session carrying anything outside them.
//   3. WHAT THE LOCAL-ONLY BOUNDARY EXCLUDES — `COACHING_LOCAL_ONLY_BOUNDARY`
//      pairs every claim with the property a reader can check it against, and
//      each of those properties is asserted in tests/prompt-coaching-contract.test.js.
//
// HOW THE ANALYSIS RUNS. Coaching is computed in the browser by bundled static
// client-side code: this module, the modules it imports, and the rubric JSON
// shipped beside them. No request is sent for coaching, and no persistence is
// implemented — there is no store to write to and no adapter that would. The
// wording is deliberate: this repository claims what it can demonstrate, and
// counting the files a build happens to emit demonstrates nothing.
//
// DETERMINISM. Every function here is pure and synchronous. No clock, no
// randomness, no identifier generation: a session's contents are a function of
// the submitted text and the named tier alone, so the same paste on two
// machines produces byte-identical JSON. A session therefore carries no
// timestamp — a "when" would be the one field two engineers could not compute
// the same way, and nothing downstream needs one because nothing stores one.

import {
  COACHING_QUESTION, COACHING_REASON, MODEL_TIER_EXAMPLES,
  gradeMyPrompt, parseCoachingInput,
} from "./prompt-coaching.js";

/** Bump when a field, an outcome, or the meaning of one changes. */
export const COACHING_SESSION_VERSION = "prompt-coaching-session/1.0.0";

/**
 * Session identifiers are opaque labels, not a second channel for prompt text
 * or identity data. Keep the alphabet deliberately boring and the value short
 * enough to inspect. The bundled sample ids already use this format.
 */
export const COACHING_SESSION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

/**
 * Every session version this build can read, oldest first. A session written by
 * anything else is refused rather than reinterpreted: a consumer that guesses at
 * an unknown version is a consumer that silently drops fields it cannot see.
 */
export const SUPPORTED_COACHING_SESSION_VERSIONS = Object.freeze([
  COACHING_SESSION_VERSION,
]);

// ---------------------------------------------------------------------------
// The decision states
// ---------------------------------------------------------------------------

/**
 * The four states a client switches on.
 *
 * The grading engine returns seven reason codes; a consumer building a screen
 * does not need seven branches, it needs to know whether it has an answer, an
 * empty box, an input the workflow will not accept, or text the rubric cannot
 * read. The reason code stays on the session for anyone who wants the finer
 * distinction — it is what a reader quotes when disputing a refusal.
 */
export const COACHING_OUTCOME = Object.freeze({
  graded: "graded",
  empty: "empty",
  invalidInput: "invalid_input",
  unsupportedContent: "unsupported_content",
});

/**
 * Reason code → outcome. Total over `COACHING_REASON`, and asserted so at load:
 * a reason added to the engine without a decision about which state it belongs
 * to fails the module rather than falling through to a default branch.
 *
 * `no_scorable_turn` is unsupported content rather than invalid input on
 * purpose. The paste was well-formed and within every ceiling; what the rubric
 * could not do is read a request out of code and carried-in logs. Telling a
 * reader their input was invalid when it was merely unreadable sends them to
 * fix the wrong thing.
 */
export const OUTCOME_BY_REASON = Object.freeze({
  [COACHING_REASON.emptyInput]: COACHING_OUTCOME.empty,
  [COACHING_REASON.noTurns]: COACHING_OUTCOME.empty,
  [COACHING_REASON.unsupportedInput]: COACHING_OUTCOME.invalidInput,
  [COACHING_REASON.tooLong]: COACHING_OUTCOME.invalidInput,
  [COACHING_REASON.tooManyTurns]: COACHING_OUTCOME.invalidInput,
  [COACHING_REASON.noUserTurn]: COACHING_OUTCOME.invalidInput,
  [COACHING_REASON.noScorableTurn]: COACHING_OUTCOME.unsupportedContent,
});

for (const reason of Object.values(COACHING_REASON)) {
  if (!OUTCOME_BY_REASON[reason]) {
    throw new RangeError(`prompt coaching session: reason "${reason}" has no outcome`);
  }
}

/**
 * The states, in the order a preview reads them: the one that answers the
 * question first, then the three that do not, each saying what the client gets
 * instead of an answer.
 */
export const COACHING_OUTCOME_STATES = Object.freeze([
  Object.freeze({
    outcome: COACHING_OUTCOME.graded,
    label: "Graded",
    meaning: "The rubric read at least one turn you wrote and answered the question.",
    delivers: "answer, benchmark, one prioritized rewrite, a model-tier recommendation, and the rubric detail behind them.",
    reasons: Object.freeze([]),
  }),
  Object.freeze({
    outcome: COACHING_OUTCOME.empty,
    label: "Nothing to grade",
    meaning: "The box was empty or held only whitespace.",
    delivers: "a reason code and the recovery guidance for it. No score, no grade, no partial result.",
    reasons: Object.freeze([COACHING_REASON.emptyInput, COACHING_REASON.noTurns]),
  }),
  Object.freeze({
    outcome: COACHING_OUTCOME.invalidInput,
    label: "Not accepted",
    meaning: "The submission was not text, exceeded a stated ceiling, or contained no turn you wrote.",
    delivers: "a reason code, recovery guidance, and the ceiling that was hit as a count — never an echo of the text.",
    reasons: Object.freeze([
      COACHING_REASON.unsupportedInput, COACHING_REASON.tooLong,
      COACHING_REASON.tooManyTurns, COACHING_REASON.noUserTurn,
    ]),
  }),
  Object.freeze({
    outcome: COACHING_OUTCOME.unsupportedContent,
    label: "Nothing the rubric can read",
    meaning: "The text was accepted, but every turn was code or carried-in material with no request in prose.",
    delivers: "a reason code, recovery guidance, and the classifier's per-turn codes for why each turn was skipped.",
    reasons: Object.freeze([COACHING_REASON.noScorableTurn]),
  }),
]);

// ---------------------------------------------------------------------------
// The closed field lists
// ---------------------------------------------------------------------------

export const SESSION_FIELDS = Object.freeze([
  "schemaVersion", "sessionId", "question", "outcome", "reason", "input",
  "result", "boundary",
]);

/**
 * What a session says about the analyzed text. Counts and identifiers only.
 *
 * DEFINITIONS, so two engineers compute them the same way:
 *   `source`      — where the text came from: bundled sample or reader input.
 *   `chars`       — `String.prototype.length` of the submitted text, in UTF-16
 *                   code units, before trimming. This is the same quantity the
 *                   `input_too_long` ceiling compares against. `null` when the
 *                   submission was not a string.
 *   `turns`       — turns produced by `parseCoachingInput`: one per role-labelled
 *                   line at the start of a line outside a fenced block, or one
 *                   turn for the whole paste when no label is found. `null` when
 *                   the submission was not a string.
 *   `labelled`    — whether any role label was found. False means the paste was
 *                   read as a single turn you wrote.
 *   `scoredTurns` — turns the classifier scored. Always 0 unless the outcome is
 *                   `graded`, because a refusal scores nothing.
 *   `modelTier`   — the tier named beside the box, or `null` for "not specified",
 *                   in which case the model-fit signals abstain.
 */
export const SESSION_INPUT_FIELDS = Object.freeze([
  "source", "chars", "turns", "labelled", "scoredTurns", "modelTier",
]);

export const COACHING_INPUT_SOURCE = Object.freeze({
  bundledSample: "bundled_sample",
  readerText: "reader_text",
});

export const GRADED_RESULT_FIELDS = Object.freeze([
  "version", "rubricVersionId", "classifierVersion", "question", "state",
  "scored", "reason", "answer", "benchmark", "improvement", "recommendation",
  "basis", "observed", "detail",
]);

export const REFUSAL_RESULT_FIELDS = Object.freeze([
  "version", "question", "state", "scored", "reason", "answer", "benchmark",
  "improvement", "recommendation", "basis", "recovery", "observed", "detail",
]);

/**
 * What each field of a graded result is, in the reader's words. This is the
 * answer to "what do I get back?" and it is rendered rather than described in a
 * document, so the list a reader sees is the list the contract enforces.
 */
export const RESULT_FIELD_MEANINGS = Object.freeze([
  Object.freeze({ field: "answer", meaning: "The plain answer to the one question, before any figure." }),
  Object.freeze({ field: "benchmark", meaning: "Composite score out of 100, the letter grade, and the distance to the next band." }),
  Object.freeze({ field: "improvement", meaning: "The single highest-value change, its guidance, a ready-to-edit rewrite, and what it is worth." }),
  Object.freeze({ field: "recommendation", meaning: "A model-tier reading, or an explicit abstention when no model-fit signal fired." }),
  Object.freeze({ field: "basis", meaning: "What this grade may be used for: one text, in this tab, never an organization's grade." }),
  Object.freeze({ field: "observed", meaning: "Counts about the submission: turns read, turns scored, whether roles were labelled, tier named." }),
  Object.freeze({ field: "detail", meaning: "The dispute material: axis subscores and weights, per-turn reason codes, ranked runners-up, rubric version." }),
  Object.freeze({ field: "recovery", meaning: "Refusals only: what to do about this reason code, and the control that acts on it." }),
]);

export const SESSION_BOUNDARY_FIELDS = Object.freeze([
  "sentForCoaching", "persisted", "retainsAnalyzedText", "integrationsContacted",
]);

/**
 * The boundary, as data. Constant for every session, because a boundary that
 * varied by session would be a setting rather than a boundary.
 */
export const SESSION_BOUNDARY = Object.freeze({
  sentForCoaching: "none",
  persisted: "none",
  retainsAnalyzedText: false,
  integrationsContacted: "none",
});

/**
 * Keys the session envelope may never carry at any depth. The rule behind the
 * list: the envelope carries measurements of the text, never the text.
 *
 * SCOPE, STATED RATHER THAN IMPLIED. The walk covers the envelope this contract
 * owns and stops at `result`, whose fields are the grading engine's and are
 * closed separately by `GRADED_RESULT_FIELDS` and `REFUSAL_RESULT_FIELDS`. A
 * graded result legitimately carries `benchmark.text` and `basis.text` — static
 * composed sentences, not anything pasted — and a key-name rule cannot tell
 * those apart from an echo. What can is the marker test in
 * tests/prompt-coaching-contract.test.js: it coaches text containing a unique
 * string and asserts that string appears nowhere in the serialized session.
 */
export const FORBIDDEN_SESSION_KEYS = Object.freeze([
  "text", "prompt", "body", "paste", "content", "excerpt", "transcript",
  "credential", "token", "cookie", "apiKey", "email",
]);

/**
 * The local-only boundary, one entry per class of thing this workflow excludes.
 *
 * `claim` is what the product says. `verify` is the property that makes the
 * claim checkable against the implementation rather than believable on tone —
 * each one is asserted mechanically in tests/prompt-coaching-contract.test.js,
 * so a change that breaks a claim fails a test rather than aging into a lie.
 */
export const COACHING_LOCAL_ONLY_BOUNDARY = Object.freeze([
  Object.freeze({
    id: "credentials",
    label: "Credentials and identities",
    claim: "No API key, token, cookie, account, or email address is read, required, or sent. The workflow has no sign-in and no notion of who you are.",
    verify: "No module reachable from the coaching page entry references a cookie, storage, or authorization API.",
  }),
  Object.freeze({
    id: "network",
    label: "Network submission",
    claim: "No request is sent for coaching. The grading runs in this browser tab, from the rubric shipped with the page, and the form has no action to submit to.",
    verify: "No module reachable from the coaching page entry references fetch, XMLHttpRequest, sendBeacon, WebSocket, or EventSource; the workflow's flow tests fail on any request.",
  }),
  Object.freeze({
    id: "prompt-storage",
    label: "Prompt storage",
    claim: "Nothing you type is stored. The text you type is read from the field, measured, and left in the field — it is not saved, exported, or put in a URL.",
    verify: "No module reachable from the coaching page entry references localStorage, sessionStorage, or IndexedDB, and a built session carries counts in place of the text.",
  }),
  Object.freeze({
    id: "retention",
    label: "Customer data retention",
    claim: "This workflow creates no stored or transmitted record of your text or coaching run. Your text remains only in the textarea until you clear it, replace it, or leave the page.",
    verify: "A session built from text containing a unique marker contains that marker in no field, at any depth, once serialized.",
  }),
  Object.freeze({
    id: "integrations",
    label: "Live integrations",
    claim: "No provider, billing, org-chart, or customer system is contacted or read. The samples below are synthetic text written for this preview.",
    verify: "Coaching imports only the bundled rubric and classifier modules; the samples are constants in this file and no dataset, import, or workspace is read.",
  }),
]);

// ---------------------------------------------------------------------------
// The bundled samples
// ---------------------------------------------------------------------------

/** Enough plain prose for the rubric to read the turn as substantive work. */
const LEDGER_BODY = Array.from({ length: 26 }, (unused, at) =>
  `Step ${at} of the ledger migration moves one table and leaves the read path untouched.`)
  .join(" ");

const TRANSCRIPT = Array.from({ length: 11 }, (unused, at) => [
  `User: Question ${at} about the checkout retry path.`,
  `Assistant: Answer ${at} about the checkout retry path.`,
].join("\n")).join("\n");

/**
 * One sample per decision state, so the preview demonstrates every branch
 * instead of describing four and showing one.
 *
 * Every string is hand-authored for this preview. No real prompt, customer,
 * provider, or telemetry data was available to this workflow and none is used.
 */
export const COACHING_SAMPLES = Object.freeze([
  Object.freeze({
    id: "underspecified-request",
    label: "An underspecified request",
    shows: "the graded state, with the one change worth making first",
    modelTier: "premium",
    text: "can you improve this and fix it somehow, make it better as needed",
  }),
  Object.freeze({
    id: "well-formed-request",
    label: "A request that states its context",
    shows: "the graded state at the top of the scale",
    modelTier: "standard",
    text: [
      "Context: we run a checkout service on Node 20 behind a CDN.",
      "Constraints: do not add a dependency and do not change the public API.",
      "A correct answer is a patch to one file plus the test that fails without it.",
      "",
      "1. Explain why the retry storm starts",
      "2. Propose the smallest fix",
      "",
      LEDGER_BODY,
    ].join("\n"),
  }),
  Object.freeze({
    id: "empty-box",
    label: "An empty box",
    shows: "the empty state",
    modelTier: null,
    text: "   \n  ",
  }),
  Object.freeze({
    id: "long-transcript",
    label: "A whole transcript",
    shows: "the not-accepted state, with the ceiling that was hit",
    modelTier: null,
    text: TRANSCRIPT,
  }),
  Object.freeze({
    id: "pasted-log-only",
    label: "A pasted log with no request",
    shows: "the unsupported-content state",
    modelTier: null,
    text: [
      "```",
      "2026-07-02T09:14:00Z ERROR checkout retry budget exhausted upstream=payments",
      "2026-07-02T09:14:01Z ERROR checkout retry budget exhausted upstream=payments",
      "2026-07-02T09:14:02Z ERROR checkout retry budget exhausted upstream=payments",
      "```",
    ].join("\n"),
  }),
]);

/** The sample the preview renders in full. */
export const PREVIEW_SAMPLE_ID = "underspecified-request";

export function coachingSample(id) {
  return COACHING_SAMPLES.find((sample) => sample.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Building a session
// ---------------------------------------------------------------------------

function summarizeInput(text, modelTier, source, result) {
  const string = typeof text === "string";
  const parsed = string ? parseCoachingInput(text) : null;
  return Object.freeze({
    source,
    chars: string ? text.length : null,
    turns: parsed ? parsed.turns.length : null,
    labelled: parsed ? parsed.labelled : false,
    scoredTurns: result.scored ? result.observed.scoredTurns : 0,
    modelTier: modelTier ?? null,
  });
}

/**
 * Grade one submission and wrap the answer in the versioned envelope a client
 * consumes.
 *
 * @param {{sessionId: string, text?: unknown, modelTier?: string|null,
 *   source?: string}} submission the text to analyze and the tier named beside
 *   the box. `sessionId` labels the run for a caller's own display; it is never
 *   derived from the text and never generated, so a session stays deterministic.
 * @returns {object} frozen, and closed over `SESSION_FIELDS`. The submitted text
 *   is measured into `input` and appears nowhere in the return value.
 */
export function buildCoachingSession({
  sessionId, text, modelTier = null, source = COACHING_INPUT_SOURCE.readerText,
} = {}) {
  const normalizedSessionId = String(sessionId ?? "coaching-session");
  if (!COACHING_SESSION_ID_PATTERN.test(normalizedSessionId)) {
    throw new RangeError("prompt coaching session: sessionId must be 1–64 letters, numbers, dots, underscores, or hyphens");
  }
  const result = gradeMyPrompt({ text, modelTier });
  return Object.freeze({
    schemaVersion: COACHING_SESSION_VERSION,
    sessionId: normalizedSessionId,
    question: COACHING_QUESTION,
    outcome: result.scored ? COACHING_OUTCOME.graded : OUTCOME_BY_REASON[result.reason],
    reason: result.scored ? null : result.reason,
    input: summarizeInput(text, modelTier, source, result),
    result,
    boundary: SESSION_BOUNDARY,
  });
}

/** The same envelope, built from a bundled sample rather than reader input. */
export function buildSampleCoachingSession(id = PREVIEW_SAMPLE_ID) {
  const sample = coachingSample(id);
  if (!sample) throw new RangeError(`prompt coaching session: no sample "${id}"`);
  return buildCoachingSession({
    sessionId: sample.id,
    text: sample.text,
    modelTier: sample.modelTier,
    source: COACHING_INPUT_SOURCE.bundledSample,
  });
}

/**
 * Every sample's outcome, computed rather than written down: the states table
 * in the preview is the engine's own behaviour, so a sample that stopped
 * producing the state it is filed under is visible on the page.
 */
export function summarizeSampleOutcomes() {
  return Object.freeze(COACHING_SAMPLES.map((sample) => {
    const session = buildSampleCoachingSession(sample.id);
    return Object.freeze({
      id: sample.id,
      label: sample.label,
      shows: sample.shows,
      outcome: session.outcome,
      reason: session.reason,
      headline: session.result.scored
        ? session.result.benchmark.text
        : session.result.recovery.title,
    });
  }));
}

export function serializeCoachingSessionPreview(id = PREVIEW_SAMPLE_ID) {
  return JSON.stringify(buildSampleCoachingSession(id), null, 2);
}

// ---------------------------------------------------------------------------
// Validating a session
// ---------------------------------------------------------------------------

function fieldsMatch(value, fields) {
  const keys = Object.keys(value ?? {});
  return keys.length === fields.length && fields.every((field) => keys.includes(field));
}

function forbiddenKeyIn(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_SESSION_KEYS.includes(key)) return key;
    const nested = forbiddenKeyIn(entry, seen);
    if (nested) return nested;
  }
  return null;
}

/**
 * Check a session against this contract.
 *
 * @returns {{valid: boolean, errors: ReadonlyArray<{code: string, detail: string}>}}
 *   every failure, not the first: a consumer fixing a producer wants the list.
 *   Codes are stable; a caller switches on them and never on a sentence.
 */
export function validateCoachingSession(session) {
  const errors = [];
  const fail = (code, detail) => errors.push(Object.freeze({ code, detail }));

  if (!session || typeof session !== "object" || Array.isArray(session)) {
    return Object.freeze({
      valid: false,
      errors: Object.freeze([Object.freeze({ code: "not_an_object", detail: "a session must be an object" })]),
    });
  }
  if (!SUPPORTED_COACHING_SESSION_VERSIONS.includes(session.schemaVersion)) {
    fail("unsupported_version", `this build reads ${SUPPORTED_COACHING_SESSION_VERSIONS.join(", ")}`);
  }
  if (!fieldsMatch(session, SESSION_FIELDS)) {
    fail("session_fields", `a session carries exactly: ${SESSION_FIELDS.join(", ")}`);
  }
  if (typeof session.sessionId !== "string" || !COACHING_SESSION_ID_PATTERN.test(session.sessionId)) {
    fail("session_id", "sessionId must be 1–64 letters, numbers, dots, underscores, or hyphens");
  }
  if (session.question !== COACHING_QUESTION) {
    fail("question", "a session answers the one question this workflow asks");
  }
  if (!Object.values(COACHING_OUTCOME).includes(session.outcome)) {
    fail("outcome", `outcome must be one of: ${Object.values(COACHING_OUTCOME).join(", ")}`);
  }
  if (!fieldsMatch(session.input, SESSION_INPUT_FIELDS)) {
    fail("input_fields", `input carries exactly: ${SESSION_INPUT_FIELDS.join(", ")}`);
  } else {
    const { chars, turns, labelled, scoredTurns, modelTier, source } = session.input;
    const count = (value) => value === null || (Number.isInteger(value) && value >= 0);
    if (!count(chars) || !count(turns) || !Number.isInteger(scoredTurns) || scoredTurns < 0) {
      fail("input_counts", "chars, turns and scoredTurns are non-negative integers or null");
    }
    if (typeof labelled !== "boolean") {
      fail("input_labelled", "labelled must be a boolean");
    }
    if (modelTier !== null && !Object.keys(MODEL_TIER_EXAMPLES).includes(modelTier)) {
      fail("input_tier", `modelTier is null or one of: ${Object.keys(MODEL_TIER_EXAMPLES).join(", ")}`);
    }
    if (!Object.values(COACHING_INPUT_SOURCE).includes(source)) {
      fail("input_source", `source is one of: ${Object.values(COACHING_INPUT_SOURCE).join(", ")}`);
    }
  }

  const result = session.result;
  if (!result || typeof result !== "object") {
    fail("result_missing", "a session always carries the result it wrapped");
  } else if (result.scored === true) {
    if (session.outcome !== COACHING_OUTCOME.graded) fail("outcome_mismatch", "a scored result is the graded outcome");
    if (session.reason !== null) fail("reason_mismatch", "a graded session carries no reason code");
    if (!fieldsMatch(result, GRADED_RESULT_FIELDS)) {
      fail("result_fields", `a graded result carries exactly: ${GRADED_RESULT_FIELDS.join(", ")}`);
    }
  } else if (result.scored === false) {
    if (session.reason !== result.reason) fail("reason_mismatch", "the session reason is the result's own reason code");
    if (OUTCOME_BY_REASON[result.reason] !== session.outcome) {
      fail("outcome_mismatch", `"${result.reason}" is the ${OUTCOME_BY_REASON[result.reason]} outcome`);
    }
    if (!fieldsMatch(result, REFUSAL_RESULT_FIELDS)) {
      fail("result_fields", `a refusal carries exactly: ${REFUSAL_RESULT_FIELDS.join(", ")}`);
    }
  } else {
    fail("result_scored", "result.scored must be a boolean");
  }

  if (!fieldsMatch(session.boundary, SESSION_BOUNDARY_FIELDS)
    || SESSION_BOUNDARY_FIELDS.some((field) => session.boundary[field] !== SESSION_BOUNDARY[field])) {
    fail("boundary", "the boundary is constant and stated in full on every session");
  }

  const envelope = { ...session };
  delete envelope.result;
  const forbidden = forbiddenKeyIn(envelope);
  if (forbidden) fail("forbidden_key", `"${forbidden}" would carry analyzed text or an identity`);

  return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}
