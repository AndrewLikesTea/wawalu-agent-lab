// The personal AI-history contract: the one question, the closed shape, and the
// exclusions checked against the implementation rather than taken on trust.
//
// The last group is the one that matters. Every claim in
// `PERSONAL_HISTORY_EXCLUSIONS` ships beside a `verify` sentence naming the
// property a reader can check it against, and each is checked here mechanically.
// A privacy or scope claim whose check lives only in prose ages into a lie
// between releases; these fail the build instead.
//
// No fixture is committed. Every export below is generated from the bundled
// synthetic preview or from strings hand-authored in this file. No real prompt,
// provider, customer, or telemetry data was available and none is used.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  FORBIDDEN_REPORT_KEYS, PERSONAL_BASIS, PERSONAL_BOUNDARY, PERSONAL_CONFIDENCE_NONE,
  PERSONAL_CONFIDENCE_TIERS, PERSONAL_COVERAGE_IDENTITY, PERSONAL_ELIGIBILITY,
  PERSONAL_EXPORT_SHAPES, PERSONAL_HISTORY_EXCLUSIONS, PERSONAL_HISTORY_QUESTION,
  PERSONAL_HISTORY_VERSION, PERSONAL_METRIC_DEFINITIONS, PERSONAL_NOT_ELIGIBLE,
  PERSONAL_NOT_ELIGIBLE_RULE, PERSONAL_REPORT_FIELDS, PERSONAL_REPORT_STATE,
  PERSONAL_REPORT_STATES, PERSONAL_REQUIRED_FIELDS, validatePersonalHistoryReport,
} from "../src/personal-history-contract.js";
import {
  assertNoPromptText, buildPersonalHistoryReport,
} from "../src/personal-history-report.js";
import {
  PERSONAL_PREVIEW_DAYS, personalHistoryPreviewJson,
} from "../src/personal-history-fixture.js";

const SOURCE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

const preview = () => buildPersonalHistoryReport(personalHistoryPreviewJson());

// ---------------------------------------------------------------------------
// The one question and the closed shape
// ---------------------------------------------------------------------------

test("a report answers one question and carries exactly the declared fields", () => {
  const report = preview();
  assert.equal(report.schemaVersion, PERSONAL_HISTORY_VERSION);
  assert.equal(report.question, PERSONAL_HISTORY_QUESTION);
  assert.match(report.question, /single improvement should I prioritize/);
  assert.deepEqual(Object.keys(report).sort(), [...PERSONAL_REPORT_FIELDS].sort());
  assert.ok(Object.isFrozen(report), "a consumer must not edit a report in place");
  assert.ok(Object.isFrozen(report.coverage) && Object.isFrozen(report.priority));
  assert.deepEqual(validatePersonalHistoryReport(report).errors, []);
});

test("the two states a reader meets are reachable, and every state restates the boundary", () => {
  // `no_move_available` is deliberately not asserted reachable: it is the state
  // for a history the rubric finds nothing worth points in, which no synthetic
  // corpus here produces. It exists so that case is a stated answer rather than
  // a blank panel, and it is validated like the other two.
  const reached = new Set([
    preview().state,
    buildPersonalHistoryReport("not an export").state,
  ]);
  assert.ok(reached.has(PERSONAL_REPORT_STATE.prioritized));
  assert.ok(reached.has(PERSONAL_REPORT_STATE.notEligible));
  assert.equal(PERSONAL_REPORT_STATES.length, Object.keys(PERSONAL_REPORT_STATE).length);
  for (const entry of PERSONAL_REPORT_STATES) {
    assert.ok(Object.values(PERSONAL_REPORT_STATE).includes(entry.state));
    assert.match(entry.boundary, /tab/, `${entry.state} does not say where the file was read`);
    assert.match(entry.boundary, /stor|upload/, `${entry.state} does not say what was kept`);
  }
});

test("the boundary rides on a refusal, not only on an answer", () => {
  const refused = buildPersonalHistoryReport("not an export");
  assert.equal(refused.state, PERSONAL_REPORT_STATE.notEligible);
  assert.deepEqual(refused.boundary, PERSONAL_BOUNDARY);
  assert.equal(refused.eligibility.met, false);
  assert.match(refused.eligibility.boundary, /gone/);
  assert.deepEqual(validatePersonalHistoryReport(refused).errors, []);
});

// ---------------------------------------------------------------------------
// Shapes, required fields, and the metric definitions
// ---------------------------------------------------------------------------

test("both supported shapes declare how they are detected and what a prompt entry is", () => {
  assert.equal(PERSONAL_EXPORT_SHAPES.length, 2);
  for (const shape of PERSONAL_EXPORT_SHAPES) {
    assert.ok(shape.id && shape.label && shape.detect && shape.promptEntry);
    assert.ok(shape.dateFields.length > 0 && shape.textFields.length > 0);
    assert.ok(shape.dateFallback, "a shape says what happens when a date is missing");
  }
});

test("the required fields are date and prompt, each with a product reason", () => {
  assert.deepEqual(PERSONAL_REQUIRED_FIELDS.map((entry) => entry.field), ["date", "prompt"]);
  for (const entry of PERSONAL_REQUIRED_FIELDS) {
    assert.equal(entry.required, true);
    assert.ok(entry.why.length > 40 && entry.granularity.length > 20);
  }
  // The date is required for the habit floor, not for display. If that ever
  // stops being true the floor has gone and the field has no reason to exist.
  assert.match(PERSONAL_REQUIRED_FIELDS[0].why, /minDistinctDays/);
  assert.ok(PERSONAL_ELIGIBILITY.minDistinctDays > 1);
});

test("every published figure has a definition, and the definitions reconcile", () => {
  const defined = new Set(PERSONAL_METRIC_DEFINITIONS.map((entry) => entry.metric));
  for (const metric of [
    "prompt_entries", "attachments_skipped", "dropped.empty", "dropped.undated",
    "dropped.unreadable", "scored_prompts", "distinct_days", "coverage",
    "prompts_affected(move)", "priority_points(move)", "lead_margin",
  ]) {
    assert.ok(defined.has(metric), `${metric} is published with no definition`);
  }
  for (const entry of PERSONAL_METRIC_DEFINITIONS) {
    assert.ok(entry.definition.length > 40, `${entry.metric} is defined too loosely to compute`);
    assert.ok(entry.excludes.length > 10, `${entry.metric} does not say what it leaves out`);
  }
  const report = preview();
  const { promptEntries, scoredPrompts, dropped } = report.coverage;
  assert.equal(promptEntries, scoredPrompts + dropped.empty + dropped.undated + dropped.unreadable,
    PERSONAL_COVERAGE_IDENTITY);
  assert.equal(report.coverage.identity, PERSONAL_COVERAGE_IDENTITY);
});

test("every reason code has a published sentence and every sentence a code", () => {
  const codes = Object.values(PERSONAL_NOT_ELIGIBLE);
  assert.deepEqual(Object.keys(PERSONAL_NOT_ELIGIBLE_RULE).sort(), [...codes].sort());
  for (const code of codes) assert.ok(PERSONAL_NOT_ELIGIBLE_RULE[code].length > 40);
});

test("confidence is a named ladder, never an invented number", () => {
  const levels = PERSONAL_CONFIDENCE_TIERS.map((tier) => tier.level);
  assert.deepEqual(levels, ["high", "moderate", "low"]);
  for (const tier of PERSONAL_CONFIDENCE_TIERS) {
    assert.equal(typeof tier.minFloorMultiple, "number");
    assert.equal(typeof tier.minLeadMargin, "number");
    assert.ok(tier.rule.length > 40, `${tier.level} publishes no rule a reader can dispute`);
  }
  // Both requirements tighten together going up the ladder: a wide margin over a
  // handful of prompts and a huge sample with a photo-finish are both weak, and
  // a ladder that relaxed either one going up would let one of them through.
  for (let at = 1; at < PERSONAL_CONFIDENCE_TIERS.length; at += 1) {
    assert.ok(PERSONAL_CONFIDENCE_TIERS[at - 1].minFloorMultiple
      >= PERSONAL_CONFIDENCE_TIERS[at].minFloorMultiple);
    assert.ok(PERSONAL_CONFIDENCE_TIERS[at - 1].minLeadMargin
      >= PERSONAL_CONFIDENCE_TIERS[at].minLeadMargin);
  }
  assert.equal(PERSONAL_CONFIDENCE_NONE.level, "none");
});

// ---------------------------------------------------------------------------
// One person, never a benchmark
// ---------------------------------------------------------------------------

test("a report states it is one person's history and refuses to be a benchmark", () => {
  const report = preview();
  assert.equal(report.basis.population, 1);
  assert.equal(report.basis.comparisonsMade, "none");
  assert.match(report.basis.refusal, /not a benchmark/i);
  assert.match(report.basis.refusal, /percentile/);
  assert.deepEqual(report.basis, PERSONAL_BASIS);

  const codes = (broken) => validatePersonalHistoryReport(broken).errors.map((error) => error.code);
  assert.ok(codes({ ...report, basis: { ...PERSONAL_BASIS, population: 240 } }).includes("basis"),
    "a report about 240 people is not this report");
  assert.ok(codes({ ...report, basis: { ...PERSONAL_BASIS, comparisonsMade: "peer cohort" } })
    .includes("basis"));
});

test("a comparison field anywhere in a report fails validation", () => {
  const report = preview();
  for (const key of ["percentile", "cohort", "peer", "benchmark", "team", "organization"]) {
    assert.ok(FORBIDDEN_REPORT_KEYS.includes(key), `${key} is not refused`);
    const codes = validatePersonalHistoryReport({
      ...report,
      confidence: { ...report.confidence, basis: { ...report.confidence.basis, [key]: 0.4 } },
    }).errors.map((error) => error.code);
    assert.ok(codes.includes("forbidden_key"), `a ${key} field survived validation`);
  }
});

test("validation refuses what a consumer must not be handed", () => {
  const report = preview();
  const codes = (broken) => validatePersonalHistoryReport(broken).errors.map((error) => error.code);

  assert.deepEqual(codes(null), ["not_an_object"]);
  assert.ok(codes({ ...report, schemaVersion: "personal-history-report/9.0.0" })
    .includes("unsupported_version"), "an unknown version is refused, not reinterpreted");
  assert.ok(codes({ ...report, extra: true }).includes("report_fields"));
  assert.ok(codes({ ...report, question: "how do I compare?" }).includes("question"));
  assert.ok(codes({ ...report, state: "fine" }).includes("state"));
  assert.ok(codes({ ...report, reason: PERSONAL_NOT_ELIGIBLE.noPromptEntries })
    .includes("reason_mismatch"), "an answered report carries no refusal code");
  assert.ok(codes({
    ...report,
    coverage: { ...report.coverage, scoredPrompts: report.coverage.scoredPrompts + 1 },
  }).includes("coverage_identity"), "the drop buckets have to reconcile with the denominator");
  assert.ok(codes({ ...report, coverage: { ...report.coverage, ratio: 1.4 } })
    .includes("coverage_ratio"));
  assert.ok(codes({ ...report, coverage: { ...report.coverage, identity: "trust me" } })
    .includes("coverage_identity_text"));
  assert.ok(codes({ ...report, eligibility: { ...report.eligibility, met: false } })
    .includes("eligibility_met"));
  assert.ok(codes({ ...report, boundary: { ...PERSONAL_BOUNDARY, persisted: "localStorage" } })
    .includes("boundary"), "the boundary is not a per-report setting");
  assert.ok(codes({ ...report, priority: { ...report.priority, available: false } })
    .includes("priority_available"));
  assert.ok(codes({ ...report, confidence: { ...report.confidence, level: "certain" } })
    .includes("confidence_level"));

  const refused = buildPersonalHistoryReport("not an export");
  assert.ok(codes({ ...refused, reasonRule: "because" }).includes("reason_rule"));
  assert.ok(codes({ ...refused, confidence: report.confidence })
    .includes("confidence_without_move"), "a refusal is not confident in anything");
});

// ---------------------------------------------------------------------------
// The exclusions, checked against the implementation
// ---------------------------------------------------------------------------

/**
 * Reduce a module to the code that runs: comments and string literals removed.
 *
 * Both have to go, and for the same reason. This contract's whole job is to
 * *name* the things it does not do — in a comment explaining a rule, and in the
 * exclusion copy a reader reads on the page. A scan that counted those as uses
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

/** Every module the personal-history reader can reach, by walking static imports. */
async function readerModules() {
  const seen = new Map();
  const queue = ["personal-history-report.js"];
  while (queue.length) {
    const name = queue.pop();
    if (seen.has(name) || !name.endsWith(".js")) continue;
    const source = await readFile(join(SOURCE_ROOT, name), "utf8");
    seen.set(name, code(source));
    for (const match of source.matchAll(/from\s+"\.\/([^"]+)"/g)) queue.push(match[1]);
  }
  return seen;
}

test("every exclusion ships a claim and the property that checks it", () => {
  const ids = PERSONAL_HISTORY_EXCLUSIONS.map((entry) => entry.id);
  for (const id of ["credentials", "upload", "prompt-storage", "attachments",
    "customer-data", "comparison"]) {
    assert.ok(ids.includes(id), `${id} is excluded nowhere`);
  }
  for (const entry of PERSONAL_HISTORY_EXCLUSIONS) {
    assert.ok(entry.claim.length > 60, `${entry.id} claims too little to check`);
    assert.ok(entry.verify.length > 40, `${entry.id} names no checkable property`);
  }
});

test("no module the reader reaches can upload, store, or authenticate", async () => {
  const modules = await readerModules();
  assert.ok(modules.size > 3, "the import walk found nothing to check");
  const network = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/;
  const storage = /localStorage|sessionStorage|indexedDB|IDBFactory/;
  const credential = /document\.cookie|Authorization|api[_-]?key|access[_-]?token/i;
  for (const [name, source] of modules) {
    assert.equal(network.test(source), false, `${name} references a network API`);
    assert.equal(storage.test(source), false, `${name} references a storage API`);
    assert.equal(credential.test(source), false, `${name} references a credential`);
  }
});

test("the reader reaches no dataset, roster, workspace, or committed import fixture", async () => {
  const modules = await readerModules();
  const forbidden = /demo-data|seed-records|example-dataset|fixtures?|workspace|roster|leads|social|images|posts/;
  for (const name of modules.keys()) {
    if (name === "personal-history-report.js") continue;
    assert.equal(forbidden.test(name), false, `${name} is a data source the reader must not read`);
  }
});

test("a marker in every prompt appears nowhere in the report", () => {
  const marker = "zq7-marker-not-in-any-report";
  const conversations = PERSONAL_PREVIEW_DAYS.flatMap((date) => Array.from({ length: 4 }, (unused, at) => ({
    create_time: `${date}T09:0${at}:00Z`,
    messages: [{
      role: "user",
      content: `Context: ${marker} number ${at}.\nRequest: draft the note about ${marker}.`,
    }],
  })));
  const report = buildPersonalHistoryReport(JSON.stringify({ conversations }));
  assert.equal(report.state, PERSONAL_REPORT_STATE.prioritized);
  assert.equal(JSON.stringify(report).includes(marker), false,
    "the report carries text from the export it read");
  assert.equal(assertNoPromptText(report, marker), true);
  assert.deepEqual(validatePersonalHistoryReport(report).errors, []);
});

test("attachments are a count and nothing else", () => {
  const report = buildPersonalHistoryReport(JSON.stringify({
    conversations: [{
      create_time: `${PERSONAL_PREVIEW_DAYS[0]}T09:00:00Z`,
      messages: [{
        role: "user",
        attachments: [{ name: "payroll-export.xlsx", mime: "application/vnd.ms-excel", bytes: 41_233 }],
      }],
    }],
  }));
  assert.equal(report.coverage.attachmentsSkipped, 1);
  const serialized = JSON.stringify(report);
  for (const leak of ["payroll-export", "vnd.ms-excel", "41233"]) {
    assert.equal(serialized.includes(leak), false, `an attachment's ${leak} reached the report`);
  }
  assert.equal(report.coverage.promptEntries, 0,
    "an attachment-only message is not a prompt entry");
});
