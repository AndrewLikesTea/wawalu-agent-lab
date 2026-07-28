// The coaching session contract: shape, every decision state, and the boundary.
//
// The third group is the one that matters most. Every claim in
// `COACHING_LOCAL_ONLY_BOUNDARY` ships beside a `verify` sentence naming the
// property a reader can check it against, and each of those properties is
// checked here mechanically. A privacy claim whose check lives only in prose is
// a claim that ages into a lie between releases; these fail the build instead.
//
// No fixture is committed. Every session below is generated from bundled sample
// text or from strings hand-authored in this file. No real prompt, customer,
// provider, or telemetry data was available to this workflow and none is used.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  COACHING_INPUT_SOURCE, COACHING_LOCAL_ONLY_BOUNDARY, COACHING_OUTCOME,
  COACHING_OUTCOME_STATES, COACHING_SAMPLES, COACHING_SESSION_ID_PATTERN, COACHING_SESSION_VERSION,
  GRADED_RESULT_FIELDS, OUTCOME_BY_REASON, PREVIEW_SAMPLE_ID,
  REFUSAL_RESULT_FIELDS, RESULT_FIELD_MEANINGS, SESSION_BOUNDARY,
  SESSION_FIELDS, SESSION_INPUT_FIELDS, SUPPORTED_COACHING_SESSION_VERSIONS,
  buildCoachingSession, buildSampleCoachingSession, serializeCoachingSessionPreview,
  summarizeSampleOutcomes, validateCoachingSession,
} from "../src/prompt-coaching-contract.js";
import { COACHING_INPUT_LIMITS, COACHING_REASON } from "../src/prompt-coaching.js";

const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

test("a session is versioned, closed, and frozen", () => {
  const session = buildSampleCoachingSession(PREVIEW_SAMPLE_ID);
  assert.equal(session.schemaVersion, COACHING_SESSION_VERSION);
  assert.ok(SUPPORTED_COACHING_SESSION_VERSIONS.includes(session.schemaVersion));
  assert.deepEqual(Object.keys(session).sort(), [...SESSION_FIELDS].sort());
  assert.deepEqual(Object.keys(session.input).sort(), [...SESSION_INPUT_FIELDS].sort());
  assert.ok(Object.isFrozen(session), "a consumer must not be able to edit a session in place");
  assert.ok(Object.isFrozen(session.input));
  assert.deepEqual(session.boundary, SESSION_BOUNDARY);
});

test("a graded session and a refusal each carry their own closed result", () => {
  const graded = buildSampleCoachingSession("well-formed-request");
  assert.deepEqual(Object.keys(graded.result).sort(), [...GRADED_RESULT_FIELDS].sort());

  const refused = buildSampleCoachingSession("empty-box");
  assert.deepEqual(Object.keys(refused.result).sort(), [...REFUSAL_RESULT_FIELDS].sort());
  assert.equal(graded.result.recovery, undefined, "a graded result has nothing to recover from");
});

test("the same submission builds a byte-identical session twice", () => {
  const once = buildCoachingSession({ sessionId: "s", text: "Explain the retry storm.", modelTier: "standard" });
  const twice = buildCoachingSession({ sessionId: "s", text: "Explain the retry storm.", modelTier: "standard" });
  assert.equal(JSON.stringify(once), JSON.stringify(twice),
    "a session carries no clock, no randomness, and no generated id");
});

test("session identifiers are short opaque labels, never a prompt or identity channel", () => {
  for (const sessionId of ["sample-1", "run_2.3", "A"]) {
    assert.match(sessionId, COACHING_SESSION_ID_PATTERN);
    assert.equal(buildCoachingSession({ sessionId, text: "Explain retries." }).sessionId, sessionId);
  }
  for (const sessionId of [
    "person@example.com",
    "<img src=x onerror=alert(1)>",
    "x".repeat(65),
    "contains spaces",
  ]) {
    assert.throws(
      () => buildCoachingSession({ sessionId, text: "Explain retries." }),
      /sessionId must be 1–64/,
      `hostile or identifying session id was accepted: ${sessionId}`,
    );
  }
});

test("input measurements are the counts the contract defines", () => {
  const text = "User: one\nAssistant: two\nUser: three";
  const session = buildCoachingSession({ sessionId: "s", text, modelTier: "economy" });
  assert.equal(session.input.chars, text.length, "chars is the submitted string's own length");
  assert.equal(session.input.turns, 3);
  assert.equal(session.input.labelled, true);
  assert.equal(session.input.modelTier, "economy");
  assert.equal(session.input.source, COACHING_INPUT_SOURCE.readerText);

  const unlabelled = buildCoachingSession({ sessionId: "s", text: "Just the prompt, no labels." });
  assert.equal(unlabelled.input.turns, 1);
  assert.equal(unlabelled.input.labelled, false);
  assert.equal(unlabelled.input.modelTier, null, "an unnamed tier stays unnamed, never guessed");
});

test("every result field the preview promises is a field a session can carry", () => {
  const graded = buildSampleCoachingSession("well-formed-request");
  const refused = buildSampleCoachingSession("empty-box");
  const known = new Set([...GRADED_RESULT_FIELDS, ...REFUSAL_RESULT_FIELDS]);
  for (const entry of RESULT_FIELD_MEANINGS) {
    assert.ok(known.has(entry.field), `${entry.field} is promised but never delivered`);
    assert.ok(entry.meaning.length > 20, `${entry.field} needs a meaning, not a restatement`);
  }
  assert.ok(graded.result.answer && graded.result.benchmark && graded.result.detail);
  assert.ok(refused.result.recovery.guidance);
});

// ---------------------------------------------------------------------------
// The decision states
// ---------------------------------------------------------------------------

test("every reason code the engine can return maps to exactly one state", () => {
  const reasons = Object.values(COACHING_REASON);
  for (const reason of reasons) {
    const outcome = OUTCOME_BY_REASON[reason];
    assert.ok(Object.values(COACHING_OUTCOME).includes(outcome), `${reason} maps to no state`);
    const state = COACHING_OUTCOME_STATES.find((entry) => entry.outcome === outcome);
    assert.ok(state.reasons.includes(reason), `${reason} is not listed under ${outcome}`);
  }
  const listed = COACHING_OUTCOME_STATES.flatMap((state) => state.reasons);
  assert.equal(listed.length, new Set(listed).size, "a reason code belongs to one state only");
  assert.equal(listed.length, reasons.length, "the states list every reason code the engine has");
});

test("empty input is the empty state and never a zero score", () => {
  for (const text of ["", "   ", "\n\t \n"]) {
    const session = buildCoachingSession({ sessionId: "s", text });
    assert.equal(session.outcome, COACHING_OUTCOME.empty);
    assert.equal(session.reason, COACHING_REASON.emptyInput);
    assert.equal(session.result.benchmark, null, "an empty box has no grade, not a grade of F");
    assert.equal(session.input.scoredTurns, 0);
    assert.ok(session.result.recovery.control, "a refusal names the control that acts on it");
  }
});

test("invalid input is refused with the ceiling it hit, as a count", () => {
  const nonText = buildCoachingSession({ sessionId: "s", text: { file: "prompt.pdf" } });
  assert.equal(nonText.outcome, COACHING_OUTCOME.invalidInput);
  assert.equal(nonText.reason, COACHING_REASON.unsupportedInput);
  assert.equal(nonText.input.chars, null, "a non-string submission has no character count");

  const long = "a".repeat(COACHING_INPUT_LIMITS.maxChars + 1);
  const tooLong = buildCoachingSession({ sessionId: "s", text: long });
  assert.equal(tooLong.outcome, COACHING_OUTCOME.invalidInput);
  assert.equal(tooLong.result.observed.maxChars, COACHING_INPUT_LIMITS.maxChars);
  assert.equal(tooLong.result.observed.chars, long.length);

  const turns = Array.from({ length: COACHING_INPUT_LIMITS.maxTurns + 1 },
    (unused, at) => `User: turn ${at}`).join("\n");
  const tooMany = buildCoachingSession({ sessionId: "s", text: turns });
  assert.equal(tooMany.reason, COACHING_REASON.tooManyTurns);
  assert.equal(tooMany.result.observed.maxTurns, COACHING_INPUT_LIMITS.maxTurns);

  const modelOnly = buildCoachingSession({ sessionId: "s", text: "Assistant: here is the answer." });
  assert.equal(modelOnly.reason, COACHING_REASON.noUserTurn);
  assert.equal(modelOnly.outcome, COACHING_OUTCOME.invalidInput);
});

test("unsupported content is distinguished from invalid input", () => {
  const session = buildSampleCoachingSession("pasted-log-only");
  assert.equal(session.outcome, COACHING_OUTCOME.unsupportedContent);
  assert.equal(session.reason, COACHING_REASON.noScorableTurn);
  assert.ok(session.result.observed.turnReasonCodes.length,
    "the classifier's per-turn codes say why each turn was skipped");
  assert.notEqual(session.outcome, COACHING_OUTCOME.invalidInput,
    "well-formed text the rubric cannot read is not an invalid submission");
});

test("a graded session answers the question and carries the dispute material", () => {
  const session = buildSampleCoachingSession("well-formed-request");
  assert.equal(session.outcome, COACHING_OUTCOME.graded);
  assert.equal(session.reason, null);
  assert.ok(session.result.answer.length, "the answer comes before the figure");
  assert.ok(Number.isFinite(session.result.benchmark.score));
  assert.ok("ABCDF".includes(session.result.benchmark.grade));
  assert.ok(session.result.detail.axes.length, "a reader disputing the letter gets the axes");
  assert.ok(session.result.recommendation.state, "the tier reading always has a state");
  assert.equal(session.input.scoredTurns, session.result.observed.scoredTurns);
});

test("each bundled sample demonstrates the state it is filed under", () => {
  const outcomes = summarizeSampleOutcomes();
  assert.equal(outcomes.length, COACHING_SAMPLES.length);
  const demonstrated = new Set(outcomes.map((entry) => entry.outcome));
  for (const state of COACHING_OUTCOME_STATES) {
    assert.ok(demonstrated.has(state.outcome),
      `no bundled sample demonstrates the ${state.outcome} state`);
  }
  for (const entry of outcomes) assert.ok(entry.headline.length, `${entry.id} shows nothing`);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("every session this build produces validates", () => {
  for (const sample of COACHING_SAMPLES) {
    const report = validateCoachingSession(buildSampleCoachingSession(sample.id));
    assert.deepEqual(report.errors, [], `${sample.id} failed its own contract`);
    assert.equal(report.valid, true);
  }
});

test("validation refuses what a consumer must not be handed", () => {
  const session = buildSampleCoachingSession("well-formed-request");
  const codes = (broken) => validateCoachingSession(broken).errors.map((error) => error.code);

  assert.deepEqual(codes(null), ["not_an_object"]);
  assert.ok(codes({ ...session, schemaVersion: "prompt-coaching-session/9.0.0" })
    .includes("unsupported_version"), "an unknown version is refused, not reinterpreted");
  assert.ok(codes({ ...session, extra: true }).includes("session_fields"));
  assert.ok(codes({ ...session, sessionId: "" }).includes("session_id"));
  assert.ok(codes({ ...session, sessionId: "person@example.com" }).includes("session_id"));
  assert.ok(codes({ ...session, question: "how much do we spend?" }).includes("question"));
  assert.ok(codes({ ...session, outcome: "maybe" }).includes("outcome"));
  assert.ok(codes({ ...session, input: { ...session.input, text: "the paste" } })
    .includes("input_fields"), "an envelope field carrying text is not a session");
  assert.ok(codes({ ...session, input: { ...session.input, modelTier: "enormous" } })
    .includes("input_tier"));
  assert.ok(codes({ ...session, input: { ...session.input, chars: -1 } }).includes("input_counts"));
  assert.ok(codes({ ...session, input: { ...session.input, labelled: "yes" } })
    .includes("input_labelled"));
  assert.ok(codes({ ...session, boundary: { ...SESSION_BOUNDARY, persisted: "localStorage" } })
    .includes("boundary"), "the boundary is not a per-session setting");
  assert.ok(codes({ ...session, outcome: COACHING_OUTCOME.empty }).includes("outcome_mismatch"));
  assert.ok(codes({ ...session, reason: COACHING_REASON.emptyInput }).includes("reason_mismatch"));
  assert.ok(codes({ ...session, result: { ...session.result, scored: "yes" } })
    .includes("result_scored"));

  const refused = buildSampleCoachingSession("empty-box");
  assert.ok(codes({ ...refused, outcome: COACHING_OUTCOME.unsupportedContent })
    .includes("outcome_mismatch"), "a reason code fixes the state it belongs to");
});

test("a forbidden key anywhere in the envelope fails validation", () => {
  const session = buildSampleCoachingSession("well-formed-request");
  const report = validateCoachingSession({ ...session, input: { ...session.input, prompt: "x" } });
  assert.ok(report.errors.some((error) => error.code === "forbidden_key"
    || error.code === "input_fields"));
});

// ---------------------------------------------------------------------------
// The local-only boundary, checked against the implementation
// ---------------------------------------------------------------------------

/**
 * Reduce a module to the code that runs: comments and string literals removed.
 *
 * Both have to go, and for the same reason. This workflow's whole job is to
 * *name* the APIs it does not use — in a comment explaining the rule, and in the
 * boundary copy a reader reads on the page. A scan that counted those as uses
 * would force the product to stop saying what it does not do in order to keep
 * proving it, which is exactly backwards.
 */
function code(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

/**
 * Every module the coaching page entry can reach, by walking its static imports.
 * A list rather than a count: what matters is that the set is closed and that
 * nothing in it can leave the browser, not how many files it happens to be.
 */
async function coachingModules() {
  const seen = new Map();
  const queue = ["prompt-coaching-page.js"];
  while (queue.length) {
    const name = queue.pop();
    if (seen.has(name) || !name.endsWith(".js")) continue;
    const source = await readFile(join(SOURCE_ROOT, name), "utf8");
    seen.set(name, code(source));
    for (const match of source.matchAll(/from\s+"\.\/([^"]+)"/g)) queue.push(match[1]);
  }
  return seen;
}

test("no module the coaching workflow reaches can send a request", async () => {
  const modules = await coachingModules();
  assert.ok(modules.size > 1, "the import walk found nothing to check");
  const network = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource|navigator\.connection/;
  for (const [name, source] of modules) {
    assert.equal(network.test(source), false, `${name} references a network API`);
  }
});

test("no module the coaching workflow reaches can persist or read a credential", async () => {
  const modules = await coachingModules();
  const storage = /localStorage|sessionStorage|indexedDB|document\.cookie|Authorization|apiKey|api_key/i;
  for (const [name, source] of modules) {
    assert.equal(storage.test(source), false, `${name} references storage or a credential`);
  }
});

test("nothing pasted survives into a session", () => {
  const marker = "zqx-marker-7f3a";
  const session = buildCoachingSession({
    sessionId: "s",
    text: `Context: the ${marker} service drops retries. Constraint: do not add a dependency. `
      + "A correct answer is a patch plus the failing test.",
    modelTier: "premium",
  });
  assert.equal(session.outcome, COACHING_OUTCOME.graded, "the marker text must actually grade");
  assert.equal(JSON.stringify(session).includes(marker), false,
    "a session carries measurements of the text, never the text");
  assert.equal(session.result.improvement.rewrite?.includes(marker) ?? false, false,
    "even the rewrite is static copy, never an echo of the paste");
});

test("the boundary states a claim and a way to check it, for each excluded class", () => {
  const ids = COACHING_LOCAL_ONLY_BOUNDARY.map((entry) => entry.id);
  for (const required of ["credentials", "network", "prompt-storage", "retention", "integrations"]) {
    assert.ok(ids.includes(required), `the boundary does not exclude ${required}`);
  }
  for (const entry of COACHING_LOCAL_ONLY_BOUNDARY) {
    assert.ok(entry.claim.length > 40, `${entry.id} states no claim`);
    assert.ok(entry.verify.length > 40, `${entry.id} states no way to check its claim`);
  }
});

test("no claim on this surface counts files", () => {
  // The preview says how the analysis runs, not how many artifacts a build
  // emits. A file count is unverifiable from the page and says nothing about
  // where the text goes, which is the question the reader is actually asking.
  const claims = [
    ...COACHING_LOCAL_ONLY_BOUNDARY.flatMap((entry) => [entry.claim, entry.verify]),
    ...COACHING_OUTCOME_STATES.flatMap((state) => [state.meaning, state.delivers]),
  ];
  const counted = /\b(one|two|three|four|five|\d+)\s+(static\s+)?(files?|scripts?|modules?|assets?)\b/i;
  for (const claim of claims) {
    assert.equal(counted.test(claim), false, `a file-count claim is unverifiable: "${claim}"`);
  }
});

test("the serialized preview is the session a consumer would receive", () => {
  const parsed = JSON.parse(serializeCoachingSessionPreview());
  assert.deepEqual(parsed, JSON.parse(JSON.stringify(buildSampleCoachingSession(PREVIEW_SAMPLE_ID))));
  assert.equal(validateCoachingSession(buildSampleCoachingSession(PREVIEW_SAMPLE_ID)).valid, true);
  assert.equal(parsed.input.source, COACHING_INPUT_SOURCE.bundledSample);
});
