// The fix pack behind one department's drill-down.
//
// Every corpus here is generated in-test and run through the shipped parser,
// classifier, aggregate and routing rule — there is no fixture of a result, so a
// change to the rubric, the classifier or the routing arithmetic shows up as a
// changed reading rather than as a stale expectation that still passes.
//
// The sentinel markers ("zzq-fixpack-...") appear in no other file in the
// repository, so the redaction assertions are an actual search for prompt text in
// the published pack, not a check that one named field is absent.

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEPARTMENT_FIX_PACK_VERSION, EXCLUSION_REASONS, FIX_PACK_ACTION_KINDS,
  FIX_PACK_INTERVENTIONS, FIX_PACK_STATE, UNPRICED_REASONS, WITHHELD_LABEL,
  departmentFixPack, fixPackAnnouncement, safeDepartmentLabel, safeModelId,
} from "../src/department-fix-pack.js";
import { departmentEvidenceModel, EVIDENCE_PROVENANCE } from "../src/department-evidence.js";
import { aggregateConversationLiteracy } from "../src/conversation-literacy.js";
import { parseConversationExport } from "../src/conversation-export.js";
import { classifyQuery } from "../src/query-classification.js";
import { evaluateUnitModelRouting } from "../src/down-routing-candidates.js";
import { RUBRIC_VERSION_ID } from "../src/prompt-literacy-scoring.js";

/** Prompts whose category the shipped classifier decides, each with a marker. */
const PROMPT = Object.freeze({
  highValue: "zzq-fixpack-alpha Context: the billing service. Constraints: must not change "
    + "the schema. Acceptance criteria: the suite passes.",
  inefficient: "zzq-fixpack-beta try again, that answer is wrong",
  overProvisioned: "zzq-fixpack-gamma fix the typo in this heading",
  outOfScope: "zzq-fixpack-delta give me a recipe for a birthday cake",
});
const SENTINEL = /zzq-fixpack/;

const PREMIUM = "gpt-4o";
const ECONOMY = "gpt-4o-mini";
const DEPARTMENT = "Atlas Platform";
const COLUMNS = ["conversation_id", "user_email", "department", "created_at", "role", "model", "message_text"];

const many = (count, turn) => Array.from({ length: count }, () => turn);

function parse(turns) {
  return parseConversationExport({
    columns: COLUMNS,
    rows: turns.map(([department, prompt, model], index) => [
      `conv-${1000 + index}`,
      "rowan.ash@example.invalid",
      department,
      `2026-06-${String((index % 28) + 1).padStart(2, "0")}T09:00:00Z`,
      "user",
      model ?? ECONOMY,
      prompt,
    ]),
  }, { classify: classifyQuery });
}

const rowFor = (turns, name = DEPARTMENT) =>
  aggregateConversationLiteracy({ parsed: parse(turns) })
    .departments.find((entry) => entry.department === name) ?? null;

/**
 * An evenly split department: 25 prompts in each of the four rubric categories,
 * so every share is exactly 0.25 and the apportioned arithmetic is checkable by
 * hand rather than by re-running the implementation.
 */
function evenDepartment(count = 25) {
  return [
    ...many(count, [DEPARTMENT, PROMPT.overProvisioned, PREMIUM]),
    ...many(count, [DEPARTMENT, PROMPT.inefficient, ECONOMY]),
    ...many(count, [DEPARTMENT, PROMPT.highValue, ECONOMY]),
    ...many(count, [DEPARTMENT, PROMPT.outOfScope, ECONOMY]),
  ];
}

/**
 * A scored routing result worth exactly $40.00.
 *
 * 4,000,000 tokens at 10,000 minor is 2,500 minor per million — above the premium
 * floor (2,000). 4,000 requests is 1,000 tokens per call, under the short-call
 * ceiling, and above the minimum volume. The standard tier prices the same tokens
 * at 6,000 minor, so the delta is 4,000 minor.
 */
function routingResult(overrides = {}) {
  return evaluateUnitModelRouting({
    unitId: "acct-zzq-unit-9812",
    modelUsage: [{
      orgUnitId: "acct-zzq-unit-9812",
      model: PREMIUM,
      provider: "openai",
      inputTokens: 3_000_000,
      outputTokens: 1_000_000,
      tokens: 4_000_000,
      requests: 4_000,
      spendMinor: 10_000,
      estimated: false,
      sourceRows: 12,
      ...overrides,
    }],
  });
}

const BASIS = Object.freeze({ spendUsd: 1_000, periodMonths: 1, source: "imported provider export" });

const byId = (pack, actionId) =>
  pack.interventions.find((intervention) => intervention.actionId === actionId) ?? null;

// --- the shape the contract promises ----------------------------------------

test("every declared intervention names an action kind, a signal and an id", () => {
  const ids = FIX_PACK_INTERVENTIONS.map((intervention) => intervention.actionId);
  assert.equal(new Set(ids).size, ids.length);
  for (const intervention of FIX_PACK_INTERVENTIONS) {
    assert.ok(FIX_PACK_ACTION_KINDS.includes(intervention.kind));
    assert.ok(intervention.name.length > 0);
  }
  // One routing, one rewrite, one training. No fourth kind, no duplicate.
  assert.deepEqual(FIX_PACK_INTERVENTIONS.map((intervention) => intervention.kind).sort(),
    ["rewrite", "routing", "training"]);
});

test("a ready intervention exposes action, savings, confidence, provenance and rationale", () => {
  const pack = departmentFixPack({
    department: rowFor(evenDepartment()), routing: routingResult(), basis: BASIS,
    provenance: "own_import",
  });
  assert.equal(pack.version, DEPARTMENT_FIX_PACK_VERSION);
  assert.equal(pack.state, FIX_PACK_STATE.ready);
  assert.equal(pack.department, DEPARTMENT);
  assert.equal(pack.interventions.length, 3);

  for (const intervention of pack.interventions) {
    assert.ok(FIX_PACK_ACTION_KINDS.includes(intervention.action.kind));
    assert.equal(typeof intervention.action.name, "string");
    assert.equal(typeof intervention.monthlySavingsUsd, "number");
    assert.ok(["High", "Medium", "Low"].includes(intervention.confidence.level));
    assert.equal(intervention.provenance.classifierVersion, "query-classifier/1.0.0");
    assert.equal(intervention.provenance.source, "own_import");
    assert.equal(intervention.provenance.rubricVersion, RUBRIC_VERSION_ID);
    assert.ok(intervention.provenance.evidence.some((ref) => ref.startsWith("signal:")));
    // Concise: one or two sentences, never a paragraph of narrative.
    assert.ok(intervention.rationale.length > 0 && intervention.rationale.length < 320);
  }
});

// --- ranking -----------------------------------------------------------------

test("interventions rank by monthly savings, dearest first, with unique ranks", () => {
  const pack = departmentFixPack({
    department: rowFor(evenDepartment()), routing: routingResult(), basis: BASIS,
  });
  assert.deepEqual(pack.interventions.map((intervention) => intervention.rank), [1, 2, 3]);
  // 25 of 100 inefficient at 0.6 recoverability over $1,000 is $150.00; 25 of 100
  // out-of-scope at 0.2 is $50.00; the routing rule's own delta is $40.00.
  assert.deepEqual(pack.interventions.map((intervention) => [
    intervention.action.kind, intervention.monthlySavingsUsd,
  ]), [["rewrite", 150], ["training", 50], ["routing", 40]]);
});

test("an unpriced action ranks below every priced one and is never treated as zero", () => {
  const pack = departmentFixPack({
    department: rowFor(evenDepartment()), routing: null, basis: BASIS,
  });
  const routing = byId(pack, "route_short_lookups_to_standard_tier");
  assert.equal(routing.monthlySavingsUsd, null);
  assert.equal(routing.rank, 3);
  assert.equal(routing.savings.unpricedReasonCode, UNPRICED_REASONS.noRoutingAnalysis);
  assert.deepEqual(pack.interventions.slice(0, 2).map((entry) => entry.monthlySavingsUsd),
    [150, 50]);
});

test("with nothing priced, the order is recoverable prompt-points and stays total", () => {
  const pack = departmentFixPack({ department: rowFor(evenDepartment()) });
  const points = pack.interventions.map((intervention) =>
    intervention.signal.recoverablePromptPoints);
  assert.equal(points.length, 3);
  assert.deepEqual([...points].sort((left, right) => right - left), points);
  // Deterministic: the same input twice is the same order, ids and all.
  const again = departmentFixPack({ department: rowFor(evenDepartment()) });
  assert.deepEqual(again.interventions.map((intervention) => intervention.actionId),
    pack.interventions.map((intervention) => intervention.actionId));
});

// --- savings aggregation -----------------------------------------------------

test("the total is the sum of priced actions in minor units, and says it is complete", () => {
  const pack = departmentFixPack({
    department: rowFor(evenDepartment()), routing: routingResult(), basis: BASIS,
  });
  assert.equal(pack.totals.monthlySavingsUsd, 240);
  assert.equal(pack.totals.pricedCount, 3);
  assert.equal(pack.totals.unpricedCount, 0);
  assert.equal(pack.totals.complete, true);
  assert.deepEqual(pack.totals.unpricedReasonCodes, []);
  assert.equal(
    pack.totals.monthlySavingsUsd,
    pack.interventions.reduce((sum, intervention) => sum + intervention.monthlySavingsUsd, 0),
  );
});

test("a multi-month window is divided once, and the window figure is kept beside it", () => {
  const pack = departmentFixPack({
    department: rowFor(evenDepartment()),
    routing: routingResult(),
    basis: { ...BASIS, periodMonths: 2 },
  });
  assert.deepEqual(pack.interventions.map((intervention) => intervention.monthlySavingsUsd),
    [75, 25, 20]);
  assert.deepEqual(pack.interventions.map((intervention) => intervention.savings.windowSavingsUsd),
    [150, 50, 40]);
  assert.equal(pack.totals.monthlySavingsUsd, 120);
});

test("unpriced actions are counted, never summed, and their reasons travel with the total", () => {
  const pack = departmentFixPack({ department: rowFor(evenDepartment()) });
  assert.equal(pack.totals.monthlySavingsUsd, 0);
  assert.equal(pack.totals.pricedCount, 0);
  assert.equal(pack.totals.unpricedCount, 3);
  assert.equal(pack.totals.complete, false);
  assert.deepEqual(pack.totals.unpricedReasonCodes,
    [UNPRICED_REASONS.noMonthlySpendBasis, UNPRICED_REASONS.noRoutingAnalysis]);
  // Recoverable prompt-points are still published: the finding survives the
  // absence of a price, which is the whole reason the two are separate fields.
  assert.ok(pack.totals.recoverablePromptPoints > 0);
});

// --- missing evidence --------------------------------------------------------

test("no department selected is its own state, not an empty pack", () => {
  const pack = departmentFixPack({});
  assert.equal(pack.state, FIX_PACK_STATE.unavailable);
  assert.equal(pack.reasonCode, "no_department_selected");
  assert.deepEqual(pack.interventions, []);
  assert.equal(pack.department, null);
});

test("a department below the grading floor withholds actions and says which ones", () => {
  const pack = departmentFixPack({
    department: rowFor(many(3, [DEPARTMENT, PROMPT.overProvisioned, PREMIUM])),
    routing: routingResult(),
    basis: BASIS,
  });
  assert.equal(pack.state, FIX_PACK_STATE.withheld);
  assert.deepEqual(pack.interventions, []);
  assert.equal(pack.excluded.length, FIX_PACK_INTERVENTIONS.length);
  for (const entry of pack.excluded) {
    assert.equal(entry.reasonCode, EXCLUSION_REASONS.departmentNotGraded);
    assert.ok(entry.name.length > 0);
  }
  // The routing money is real and is still not published: an action for a
  // department with no letter is an action nobody can defend.
  assert.equal(pack.totals.monthlySavingsUsd, 0);
});

test("a signal that did not fire is excluded by name rather than shown at zero", () => {
  // No out-of-scope prompt at all, so intent clarity has nothing behind it.
  const pack = departmentFixPack({
    department: rowFor([
      ...many(25, [DEPARTMENT, PROMPT.overProvisioned, PREMIUM]),
      ...many(25, [DEPARTMENT, PROMPT.inefficient, ECONOMY]),
      ...many(25, [DEPARTMENT, PROMPT.highValue, ECONOMY]),
    ]),
    routing: routingResult(),
    basis: BASIS,
  });
  assert.equal(pack.state, FIX_PACK_STATE.ready);
  assert.deepEqual(pack.excluded.map((entry) => entry.actionId), ["train_intent_framing"]);
  assert.deepEqual(pack.excluded.map((entry) => entry.reasonCode),
    [EXCLUSION_REASONS.signalDidNotFire]);
  assert.equal(byId(pack, "train_intent_framing"), null);
});

test("an insufficient-data routing result is unpriced with the routing rule's own reason", () => {
  const pack = departmentFixPack({
    department: rowFor(evenDepartment()),
    // No model identity on the row: the routing rule refuses to score it.
    routing: routingResult({ model: null }),
    basis: BASIS,
  });
  const routing = byId(pack, "route_short_lookups_to_standard_tier");
  assert.equal(routing.monthlySavingsUsd, null);
  assert.equal(routing.savings.unpricedReasonCode, UNPRICED_REASONS.routingInsufficientData);
  assert.equal(routing.confidence.level, "Low");
  assert.ok(routing.confidence.reasons.some((reason) => reason.code === "unpriced_saving"));
});

test("thin classification coverage costs a tier and names why", () => {
  // Half the prompts carry no signal the classifier can place, so coverage falls
  // below the floor while the department stays gradeable.
  const pack = departmentFixPack({
    department: rowFor([
      ...evenDepartment(),
      ...many(100, [DEPARTMENT, "zzq-fixpack-epsilon status update please", ECONOMY]),
    ]),
    routing: routingResult(),
    basis: BASIS,
  });
  const routing = byId(pack, "route_short_lookups_to_standard_tier");
  assert.equal(routing.confidence.level, "Medium");
  assert.deepEqual(routing.confidence.reasons.map((reason) => reason.code),
    ["thin_classification_coverage"]);
});

test("an apportioned saving is confidence-capped as an estimate, a measured one is not", () => {
  const pack = departmentFixPack({
    department: rowFor(evenDepartment()), routing: routingResult(), basis: BASIS,
  });
  assert.equal(byId(pack, "route_short_lookups_to_standard_tier").confidence.level, "High");
  assert.equal(byId(pack, "rewrite_re_prompt_spirals").confidence.level, "Medium");
  assert.ok(byId(pack, "rewrite_re_prompt_spirals").confidence.reasons
    .some((reason) => reason.code === "estimated_saving"));
});

// --- privacy -----------------------------------------------------------------

test("no prompt text reaches the pack, from any corpus and any state", () => {
  const department = rowFor(evenDepartment());
  for (const pack of [
    departmentFixPack({ department, routing: routingResult(), basis: BASIS }),
    departmentFixPack({ department }),
    departmentFixPack({ department: rowFor(many(3, [DEPARTMENT, PROMPT.outOfScope, ECONOMY])) }),
    departmentFixPack({}),
  ]) {
    assert.equal(SENTINEL.test(JSON.stringify(pack)), false);
  }
});

test("unknown input fields are dropped unread and named in the redaction block", () => {
  const pack = departmentFixPack({
    department: {
      ...rowFor(evenDepartment()),
      samplePrompts: [PROMPT.outOfScope],
      apiKey: "sk-zzq-fixpack-not-a-real-key",
      customerEmail: "buyer@customer.invalid",
    },
    routing: routingResult(),
    basis: BASIS,
  });
  const serialized = JSON.stringify(pack);
  assert.equal(SENTINEL.test(serialized), false);
  assert.equal(serialized.includes("buyer@customer.invalid"), false);
  assert.equal(serialized.includes("sk-zzq"), false);
  for (const field of ["department.apiKey", "department.customerEmail", "department.samplePrompts"]) {
    assert.ok(pack.redaction.droppedInputFields.includes(field),
      pack.redaction.droppedInputFields.join(","));
  }
  assert.ok(pack.redaction.statement.length > 0);
});

test("the raw org unit id is dropped; only the routing rule's redacted label ships", () => {
  const routing = routingResult();
  assert.equal(routing.unitId, "acct-zzq-unit-9812");
  const pack = departmentFixPack({
    department: rowFor(evenDepartment()), routing, basis: BASIS,
  });
  const serialized = JSON.stringify(pack);
  assert.equal(serialized.includes("acct-zzq-unit-9812"), false);
  assert.ok(pack.redaction.droppedInputFields.includes("routing.unitId"));
  assert.equal(byId(pack, "route_short_lookups_to_standard_tier").provenance.unitLabel,
    routing.unitLabel);
});

test("a department label that is not label-shaped is withheld, not echoed", () => {
  assert.equal(safeDepartmentLabel("Atlas Platform"), "Atlas Platform");
  assert.equal(safeDepartmentLabel("R&D (EMEA)"), "R&D (EMEA)");
  assert.equal(safeDepartmentLabel("rowan.ash@example.invalid"), WITHHELD_LABEL);
  assert.equal(safeDepartmentLabel("<img src=x onerror=alert(1)>"), WITHHELD_LABEL);
  assert.equal(safeDepartmentLabel(PROMPT.outOfScope), WITHHELD_LABEL);
  assert.equal(safeDepartmentLabel(""), WITHHELD_LABEL);

  const pack = departmentFixPack({
    department: { ...rowFor(evenDepartment()), department: "rowan.ash@example.invalid" },
  });
  assert.equal(pack.department, WITHHELD_LABEL);
  assert.equal(JSON.stringify(pack).includes("rowan.ash"), false);
});

test("a model identifier ships only through the rubric's own pattern", () => {
  assert.equal(safeModelId(PREMIUM), PREMIUM);
  assert.equal(safeModelId("a prompt that leaked into the model column"),
    safeModelId(undefined));
  const pack = departmentFixPack({
    department: rowFor(evenDepartment()),
    routing: routingResult(),
    basis: BASIS,
  });
  const models = byId(pack, "route_short_lookups_to_standard_tier").savings.models;
  assert.deepEqual(models.map((entry) => entry.model), [PREMIUM]);
  assert.equal(models[0].recoverableUsd, 40);
  // The rewrite and training actions name no model at all: they are not routing.
  assert.deepEqual(byId(pack, "rewrite_re_prompt_spirals").savings.models, []);
});

// --- the announcement --------------------------------------------------------

test("the announcement leads with the total and then the ranked actions", () => {
  const pack = departmentFixPack({
    department: rowFor(evenDepartment()), routing: routingResult(), basis: BASIS,
  });
  const spoken = fixPackAnnouncement(pack);
  assert.match(spoken, /^Atlas Platform: 3 prioritized interventions, 240\.00 USD a month\./);
  assert.ok(spoken.indexOf("1. Ship a re-prompt rewrite template")
    < spoken.indexOf("3. Route short lookups"));
  assert.equal(fixPackAnnouncement(departmentFixPack({})), "");
});

// --- the drill-down entry point ---------------------------------------------

test("the loaded department result carries its fix pack", () => {
  const model = departmentEvidenceModel({
    department: rowFor(evenDepartment()),
    routing: routingResult(),
    basis: BASIS,
    provenance: EVIDENCE_PROVENANCE.own.kind,
  });
  assert.equal(model.state, "graded");
  assert.equal(model.fixPack.state, FIX_PACK_STATE.ready);
  assert.equal(model.fixPack.department, DEPARTMENT);
  assert.equal(model.fixPack.totals.monthlySavingsUsd, 240);
  // The pack inherits the panel's provenance rather than deciding its own.
  assert.equal(model.fixPack.interventions[0].provenance.source, "own_import");
  assert.equal(SENTINEL.test(JSON.stringify(model.fixPack)), false);
});

test("a fix pack is still published when the drill-down was given no routing or spend", () => {
  const model = departmentEvidenceModel({ department: rowFor(evenDepartment()) });
  assert.equal(model.fixPack.state, FIX_PACK_STATE.ready);
  assert.equal(model.fixPack.totals.complete, false);
  assert.equal(model.fixPack.basis.spendUsd, null);
  assert.equal(model.fixPack.interventions[0].provenance.source, "bundled_sample");
});

test("a panel with no result has no fix pack rather than an empty one", () => {
  for (const status of ["loading", "error"]) {
    assert.equal(departmentEvidenceModel({ status }).fixPack, null);
  }
  assert.equal(departmentEvidenceModel({ department: null }).fixPack, null);
});
