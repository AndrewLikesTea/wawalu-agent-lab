// Per-department AI-literacy grades from a conversation export.
//
// Four things are pinned here and nothing else is: department resolution order,
// the recoverable-impact formula, eligibility, and the export's redaction. The
// scores themselves belong to `prompt-literacy-scoring.test.js` and the
// categories to `query-classification.test.js`; asserting them again here would
// mean two files to change when the rubric moves.
//
// Every prompt cell in this file is a sentinel string that exists nowhere else
// in the repository, so the redaction walk below is an actual search rather than
// a check that one named field is absent.

import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPANY_COVERAGE_COPY, CONVERSATION_NOT_GRADEABLE_REASONS, DEPARTMENT_SOURCES,
  RUBRIC_SIGNALS, UNATTRIBUTED_DEPARTMENT, aggregateConversationLiteracy,
  analyzeConversationExportText, companyGrade, conversationLiteracyJson,
  conversationLiteracyPayload, resolveDepartment, rosterDepartments, signalImpact,
} from "../src/conversation-literacy.js";
import { assertClassificationsClean, parseConversationExport } from "../src/conversation-export.js";
import { categoryScoreWeight } from "../src/prompt-literacy-scoring.js";
import {
  QUERY_CLASSIFICATION_RULES, UNCLASSIFIED_REASONS, classifyQuery,
} from "../src/query-classification.js";
import { MIN_JOINED_RECORDS_FOR_GRADE } from "../src/query-literacy.js";
import { PROMPT_LITERACY_RUBRIC } from "../src/prompt-literacy-scoring.js";

// --- sentinel prompts -------------------------------------------------------

/**
 * Prompts whose category is decided by the shipped classifier, each carrying a
 * marker string ("zzl-...") that appears in no other file. The classifier never
 * reads the marker; it is there so a leak is findable.
 */
const PROMPT = Object.freeze({
  highValue: "zzl-sentinel-alpha Context: the billing service. Constraints: must not change the schema. "
    + "Acceptance criteria: the suite passes.",
  inefficient: "zzl-sentinel-beta try again, that answer is wrong",
  overProvisioned: "zzl-sentinel-gamma fix the typo in this heading",
  outOfScope: "zzl-sentinel-delta give me a recipe for a birthday cake",
  unclassified: "zzl-sentinel-epsilon hello",
});
const SENTINELS = Object.freeze(["zzl-sentinel-alpha", "zzl-sentinel-beta", "zzl-sentinel-gamma",
  "zzl-sentinel-delta", "zzl-sentinel-epsilon"]);

const PREMIUM = "gpt-4o";
const ECONOMY = "gpt-4o-mini";

const COLUMNS = ["conversation_id", "user_email", "department", "created_at", "role", "model", "message_text"];

/** A ChatGPT-shaped table. Each turn is `[department, email, prompt, model]`. */
function tableOf(turns) {
  return {
    columns: COLUMNS,
    rows: turns.map(([department, email, prompt, model], index) => [
      `conv-${1000 + index}`,
      email,
      department,
      `2026-06-${String((index % 27) + 1).padStart(2, "0")}T09:00:00Z`,
      "user",
      model ?? ECONOMY,
      prompt,
    ]),
  };
}

const parse = (turns) => parseConversationExport(tableOf(turns), { classify: classifyQuery });

/** `count` identical turns, so a department's mix is stated as counts. */
const many = (count, turn) => Array.from({ length: count }, () => turn);

const departmentNamed = (result, name) =>
  result.departments.find((department) => department.department === name) ?? null;

// --- department resolution --------------------------------------------------

test("the export's own department column wins over the roster", () => {
  const roster = [{ email: "rowan.ash@example.invalid", department: "Roster Says Otherwise" }];
  const resolved = resolveDepartment(
    { department: "Atlas Platform", actor_id: "rowan.ash@example.invalid" },
    rosterDepartments(roster),
  );
  assert.deepEqual(resolved, { department: "Atlas Platform", source: DEPARTMENT_SOURCES.exportColumn });
});

test("the roster answers when the export named no department", () => {
  const lookup = rosterDepartments([
    { email: "Rowan.Ash@Example.Invalid", department: " Atlas Platform " },
    { email: "rowan.ash@example.invalid", department: "Ignored Duplicate" },
    { email: "", department: "No Email" },
    { person_id: "p-1", department: "No Email Either" },
  ]);
  // Emails normalize and trim; the first row for a person wins, so file order
  // does not move a department.
  assert.equal(lookup.get("rowan.ash@example.invalid"), "Atlas Platform");
  assert.equal(lookup.size, 1);

  const record = { department: "(ungrouped)", actor_id: "rowan.ash@example.invalid" };
  assert.deepEqual(resolveDepartment(record, lookup),
    { department: "Atlas Platform", source: DEPARTMENT_SOURCES.roster });
});

test("a record neither source can name lands in an explicit bucket, never dropped", () => {
  const parsed = parse([
    ...many(6, ["", "wren.holt@example.invalid", PROMPT.highValue]),
    ...many(6, ["Atlas Platform", "rowan.ash@example.invalid", PROMPT.highValue]),
  ]);
  const result = aggregateConversationLiteracy({ parsed, roster: [] });

  const unattributed = departmentNamed(result, UNATTRIBUTED_DEPARTMENT);
  assert.ok(unattributed, "the unattributed bucket is returned, not omitted");
  assert.equal(unattributed.prompts.total, 6);
  assert.equal(unattributed.gradeable, false);
  assert.equal(unattributed.reasonCode, CONVERSATION_NOT_GRADEABLE_REASONS.unattributedRecords);
  assert.equal(unattributed.score, null, "an unnameable department is not a zero");

  // Every record is accounted for exactly once across the buckets.
  const counted = result.departments.reduce((sum, department) => sum + department.prompts.total, 0);
  assert.equal(counted, parsed.records.length);
  assert.equal(result.attribution.total, 12);
  assert.equal(result.attribution.export_column, 6);
  assert.equal(result.attribution.unattributed, 6);
  assert.equal(result.attribution.resolved, 0.5);
});

test("all three sources are used, in order, in one import", () => {
  const parsed = parse([
    ...many(6, ["Atlas Platform", "rowan.ash@example.invalid", PROMPT.highValue]),
    ...many(6, ["", "juno.vale@example.invalid", PROMPT.highValue]),
    ...many(6, ["", "nobody@example.invalid", PROMPT.highValue]),
  ]);
  const result = aggregateConversationLiteracy({
    parsed,
    roster: [{ email: "juno.vale@example.invalid", department: "Boreal Support" }],
  });
  assert.deepEqual(result.departments.map((department) => department.department),
    ["(unattributed)", "Atlas Platform", "Boreal Support"]);
  assert.deepEqual(departmentNamed(result, "Boreal Support").attribution, [DEPARTMENT_SOURCES.roster]);
  assert.deepEqual(departmentNamed(result, "Atlas Platform").attribution, [DEPARTMENT_SOURCES.exportColumn]);
  assert.equal(result.attribution.roster, 6);
});

// --- recoverable impact -----------------------------------------------------

test("the impact formula is volume x rubric severity x recoverability", () => {
  for (const signal of RUBRIC_SIGNALS) {
    const gap = (100 - categoryScoreWeight(signal.category)) / 100;
    assert.equal(signalImpact(10, signal), 10 * gap * signal.recoverability);
    // Volume is linear and a zero-volume signal is worth nothing, so a category
    // nobody triggered cannot contribute to a ranking.
    assert.equal(signalImpact(0, signal), 0);
    assert.equal(signalImpact(20, signal), 2 * signalImpact(10, signal));
  }
  // The severity term is the rubric's own published gap, not a second scale.
  const modelFit = RUBRIC_SIGNALS.find((signal) => signal.key === "model_fit");
  assert.equal(categoryScoreWeight("overProvisioned"), 55);
  assert.equal(signalImpact(100, modelFit), 45);
});

test("a bad score on trivial volume does not top the ranking", () => {
  const parsed = parse([
    // Six out-of-scope prompts: the worst possible score, on nothing.
    ...many(6, ["Tiny Team", "wren.holt@example.invalid", PROMPT.outOfScope]),
    // Forty prompts, half of them a routing mistake: a far better score, and
    // the only place an hour of work recovers anything.
    ...many(20, ["Broad Platform", "rowan.ash@example.invalid", PROMPT.overProvisioned, PREMIUM]),
    ...many(20, ["Broad Platform", "rowan.ash@example.invalid", PROMPT.highValue]),
  ]);
  const result = aggregateConversationLiteracy({ parsed });

  const tiny = departmentNamed(result, "Tiny Team");
  const broad = departmentNamed(result, "Broad Platform");
  assert.equal(tiny.score, 0, "the trivial department really does score worst");
  assert.ok(broad.score > tiny.score);
  // Six prompts x the full 100-point gap x 0.2 recoverable, reported to two
  // places; twenty prompts x a 45-point gap x all of it recoverable.
  assert.equal(tiny.impact, 1.2);
  assert.equal(broad.impact, 9);
  assert.deepEqual(result.ranking, ["Broad Platform", "Tiny Team"],
    "ranking is by recoverable impact, not by score");
});

test("ties break by volume and then by name, so the order never depends on input order", () => {
  const turns = [
    ...many(10, ["Zephyr Ops", "rowan.ash@example.invalid", PROMPT.overProvisioned, PREMIUM]),
    ...many(10, ["Atlas Platform", "juno.vale@example.invalid", PROMPT.overProvisioned, PREMIUM]),
  ];
  const forwards = aggregateConversationLiteracy({ parsed: parse(turns) });
  const backwards = aggregateConversationLiteracy({ parsed: parse([...turns].reverse()) });

  const [first, second] = forwards.ranking;
  assert.equal(departmentNamed(forwards, first).impact, departmentNamed(forwards, second).impact,
    "the two departments really are tied on impact");
  assert.deepEqual(forwards.ranking, ["Atlas Platform", "Zephyr Ops"]);
  assert.deepEqual(backwards.ranking, forwards.ranking);

  // A tie on impact broken by volume, before the name is consulted at all.
  const byVolume = aggregateConversationLiteracy({
    parsed: parse([
      // 20 inefficient prompts: 20 x 0.65 x 0.6 = 7.8
      ...many(20, ["Zephyr Ops", "rowan.ash@example.invalid", PROMPT.inefficient]),
      // 26 out-of-scope prompts: 26 x 1.0 x 0.2 = 5.2 ... not a tie; use the
      // pair that is: 39 out-of-scope prompts are 7.8 as well.
      ...many(39, ["Atlas Platform", "juno.vale@example.invalid", PROMPT.outOfScope]),
    ]),
  });
  assert.equal(departmentNamed(byVolume, "Zephyr Ops").impact,
    departmentNamed(byVolume, "Atlas Platform").impact);
  assert.deepEqual(byVolume.ranking, ["Atlas Platform", "Zephyr Ops"],
    "39 classified prompts outrank 20 at equal impact");
});

test("exactly one driving signal, carrying its own numerator and denominator", () => {
  const parsed = parse([
    ...many(13, ["Atlas Platform", "rowan.ash@example.invalid", PROMPT.overProvisioned, PREMIUM]),
    ...many(4, ["Atlas Platform", "rowan.ash@example.invalid", PROMPT.inefficient]),
    ...many(4, ["Atlas Platform", "rowan.ash@example.invalid", PROMPT.highValue]),
  ]);
  const atlas = departmentNamed(aggregateConversationLiteracy({ parsed }), "Atlas Platform");

  assert.equal(atlas.driver.key, "model_fit");
  assert.equal(atlas.driver.numerator, 13);
  assert.equal(atlas.driver.denominator, 21);
  assert.equal(atlas.driver.share, 0.619);
  // The sentence a surface renders, assembled here from the counts rather than
  // rebuilt from a rounded share at the render layer.
  assert.equal(atlas.driver.text,
    "Support: model fit, 62% of prompts route a lookup to the top-tier model (13 of 21)");
  assert.equal(atlas.signals.length, RUBRIC_SIGNALS.length);
  assert.deepEqual(atlas.signals[0], atlas.driver, "the driver is the strongest signal, not a fourth thing");

  // A department with nothing but reference-class work has no driver at all,
  // rather than a signal reported at zero.
  const clean = departmentNamed(aggregateConversationLiteracy({
    parsed: parse(many(8, ["Boreal Support", "juno.vale@example.invalid", PROMPT.highValue])),
  }), "Boreal Support");
  assert.equal(clean.driver, null);
  assert.equal(clean.impact, 0);
  assert.equal(clean.grade, "A");
});

// --- eligibility ------------------------------------------------------------

test("a department under the minimum sample is ungraded with a code, never a low score", () => {
  const parsed = parse([
    ...many(MIN_JOINED_RECORDS_FOR_GRADE - 1, ["Small Team", "wren.holt@example.invalid", PROMPT.outOfScope]),
    ...many(8, ["Atlas Platform", "rowan.ash@example.invalid", PROMPT.highValue]),
  ]);
  const result = aggregateConversationLiteracy({ parsed });
  const small = departmentNamed(result, "Small Team");

  assert.equal(small.gradeable, false);
  assert.equal(small.score, null);
  assert.equal(small.grade, null);
  assert.equal(small.reasonCode, CONVERSATION_NOT_GRADEABLE_REASONS.insufficientJoinedSample);
  assert.match(small.reasonText, new RegExp(`Fewer than ${MIN_JOINED_RECORDS_FOR_GRADE} classified prompts`));
  // Present in the result set, so a surface cannot render it as absent.
  assert.ok(result.departments.some((department) => department.department === "Small Team"));
  assert.ok(!result.ranking.includes("Small Team"), "an ungraded department is not ranked");
  // Its prompts still count against the company denominator.
  assert.equal(result.company.totalPrompts, MIN_JOINED_RECORDS_FOR_GRADE - 1 + 8);
});

test("a department nothing could be classified for is ungraded with its own code", () => {
  const parsed = parse(many(9, ["Quiet Team", "wren.holt@example.invalid", PROMPT.unclassified]));
  const quiet = departmentNamed(aggregateConversationLiteracy({ parsed }), "Quiet Team");
  assert.equal(quiet.reasonCode, CONVERSATION_NOT_GRADEABLE_REASONS.noClassifiedQueries);
  assert.equal(quiet.coverage, 0);
  assert.equal(quiet.confidence, null);
  assert.equal(quiet.prompts.unclassified, 9);
  assert.equal(parse([])?.records.length, 0);
});

test("the company grade is withheld with a reason while the rows are still returned", () => {
  const parsed = parse([
    ...many(3, ["Small Team", "wren.holt@example.invalid", PROMPT.highValue]),
    ...many(3, ["Other Team", "juno.vale@example.invalid", PROMPT.highValue]),
  ]);
  const result = aggregateConversationLiteracy({ parsed });

  assert.equal(result.company.state, "withheld");
  assert.equal(result.company.showGrade, false);
  assert.equal(result.company.grade, null);
  assert.equal(result.company.score, null);
  assert.equal(result.company.reason, "no_prompt_baseline");
  assert.equal(result.company.rule, COMPANY_COVERAGE_COPY.no_baseline);
  assert.equal(result.company.basis, "prompts");
  // The per-department rows are still there, each ungraded with its reason.
  assert.equal(result.departments.length, 2);
  assert.ok(result.departments.every((department) => department.gradeable === false
    && department.reasonCode === CONVERSATION_NOT_GRADEABLE_REASONS.insufficientJoinedSample));
});

test("thin coverage withholds the letter at Noor's floor, and better coverage publishes it", () => {
  // 8 graded prompts against 100 imported is 8% — under the 25% floor.
  const thin = companyGrade([
    { gradeable: true, score: 90, prompts: { classified: 8 } },
  ], 100);
  assert.equal(thin.showGrade, false);
  assert.equal(thin.state, "withheld");
  assert.equal(thin.tier, "insufficient");
  assert.equal(thin.reason, "insufficient_coverage");
  assert.equal(thin.coverage, 0.08);

  const covered = companyGrade([
    { gradeable: true, score: 90, prompts: { classified: 40 } },
    { gradeable: true, score: 40, prompts: { classified: 60 } },
  ], 100);
  assert.equal(covered.showGrade, true);
  assert.equal(covered.tier, "high");
  // Prompt-weighted, not a mean of means: (90x40 + 40x60) / 100 = 60.
  assert.equal(covered.score, 60);
  assert.equal(covered.grade, "D");

  const provisional = companyGrade([
    { gradeable: true, score: 90, prompts: { classified: 30 } },
  ], 100);
  assert.equal(provisional.tier, "provisional");
  assert.equal(provisional.provisional, true);
  assert.equal(provisional.showGrade, true);
});

// --- export safety ----------------------------------------------------------

/** Every string leaf of a serialized value, with the path that reached it. */
function walkStrings(value, path = "$", found = []) {
  if (typeof value === "string") found.push({ path, value });
  else if (Array.isArray(value)) value.forEach((item, index) => walkStrings(item, `${path}[${index}]`, found));
  else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) walkStrings(nested, `${path}.${key}`, found);
  }
  return found;
}

test("the export carries scores, counts, signals and reasons — and no prompt-derived string", () => {
  const parsed = parse([
    ...many(9, ["Atlas Platform", "rowan.ash@example.invalid", PROMPT.overProvisioned, PREMIUM]),
    ...many(7, ["Atlas Platform", "rowan.ash@example.invalid", PROMPT.inefficient]),
    ...many(6, ["Boreal Support", "juno.vale@example.invalid", PROMPT.outOfScope]),
    ...many(3, ["Boreal Support", "juno.vale@example.invalid", PROMPT.unclassified]),
    ...many(4, ["", "nobody@example.invalid", PROMPT.highValue]),
  ]);
  const result = aggregateConversationLiteracy({ parsed });
  const json = conversationLiteracyJson(result);
  const payload = JSON.parse(json);

  // The figures a leader reads are present, so this is not vacuously clean.
  assert.equal(payload.departments.length, 3);
  assert.equal(payload.departments.find((row) => row.department === "Atlas Platform").driver.numerator, 9);
  assert.ok(payload.ranking.length >= 1);
  assert.ok(Number.isFinite(payload.company.coverage));

  // The walk: every string leaf, not one hand-picked field.
  const strings = walkStrings(payload);
  assert.ok(strings.length > 20, "the walk actually reached the payload's strings");
  const authored = new Set([
    ...RUBRIC_SIGNALS.flatMap((signal) => [signal.key, signal.label, signal.axis, signal.category]),
    ...PROMPT_LITERACY_RUBRIC.categories.map((category) => category.key),
    ...PROMPT_LITERACY_RUBRIC.axes.map((axis) => axis.key),
  ]);
  for (const { path, value } of strings) {
    for (const sentinel of SENTINELS) {
      assert.ok(!value.includes(sentinel), `${path} carries prompt text: ${value}`);
    }
    // Nothing in the payload is a long free-form string either: the longest
    // authored value is a support sentence, and a leaked prompt would be the
    // only way to exceed it.
    assert.ok(value.length <= 200, `${path} is longer than any authored string: ${value}`);
    // And no leaf is an email or a conversation identifier — the two other
    // free-form things the parse holds.
    assert.ok(!value.includes("@"), `${path} carries an actor identifier: ${value}`);
    assert.ok(!/^conv-\d+$/.test(value), `${path} carries a conversation identifier`);
    assert.ok(value !== "", `${path} is an empty string, which is never a published value`);
  }
  // Departments and signal names are the only vocabulary in there, plus copy.
  assert.ok(authored.size > 0);
  assert.equal(json.includes("prompt_excerpt"), false);
  assert.equal(json.includes("message_text"), false);

  // The classification array the aggregate reads is itself closed vocabulary.
  assert.doesNotThrow(() => assertClassificationsClean(parsed.classifications, {
    categories: [...PROMPT_LITERACY_RUBRIC.categories.map((category) => category.key), "unclassified"],
    reasons: Object.values(UNCLASSIFIED_REASONS),
    ruleIds: QUERY_CLASSIFICATION_RULES.map((rule) => rule.id),
  }));
});

test("the payload is built from an allowlist, so an added internal field cannot ride out", () => {
  const parsed = parse(many(8, ["Atlas Platform", "rowan.ash@example.invalid", PROMPT.highValue]));
  const result = aggregateConversationLiteracy({ parsed });
  const smuggled = {
    ...result,
    secretInternalNote: PROMPT.highValue,
    departments: result.departments.map((department) => ({ ...department, leaked: PROMPT.highValue })),
  };
  const payload = conversationLiteracyPayload(smuggled);
  assert.equal(payload.secretInternalNote, undefined);
  assert.equal(payload.departments[0].leaked, undefined);
  assert.ok(!JSON.stringify(payload).includes("zzl-sentinel"));
});

// --- text in, result out ----------------------------------------------------

test("the whole pipeline runs from file text, and reports what it read", () => {
  const rows = [
    ...many(9, ["Atlas Platform", "rowan.ash@example.invalid", PROMPT.overProvisioned, PREMIUM]),
    ...many(6, ["Boreal Support", "juno.vale@example.invalid", PROMPT.highValue]),
  ];
  const table = tableOf(rows);
  const text = [table.columns.join(","), ...table.rows.map((row) =>
    row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))].join("\n");

  const { parse: read, literacy } = analyzeConversationExportText(text);
  assert.equal(read.status, "matched");
  assert.equal(read.dialect, "chatgpt-enterprise-conversation-export");
  assert.equal(read.recordCount, 15);
  assert.equal(read.skippedRowCount, 0);
  assert.equal(literacy.departments.length, 2);
  assert.equal(departmentNamed(literacy, "Atlas Platform").driver.key, "model_fit");
  assert.equal(departmentNamed(literacy, "Boreal Support").grade, "A");
  assert.equal(literacy.ranking[0], "Atlas Platform");
  assert.ok(!conversationLiteracyJson(literacy).includes("zzl-sentinel"));
});

test("an unreadable file fails with a code, not an exception nobody can render", () => {
  assert.throws(() => analyzeConversationExportText(""), (error) => {
    assert.equal(typeof error.code, "string");
    assert.ok(Array.isArray(error.problems) && error.problems.length === 1);
    return true;
  });
});
