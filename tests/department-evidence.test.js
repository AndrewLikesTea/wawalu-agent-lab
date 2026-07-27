// The evidence panel behind one department's grade.
//
// Every corpus here is generated in-test from the sentinel prompts below and run
// through the shipped parser, classifier and aggregate — there is no fixture of
// a result, so a change to the rubric or the classifier shows up here as a
// changed reading rather than as a stale expectation that still passes.
//
// The sentinel markers ("zzq-...") appear in no other file in the repository, so
// the redaction walk is an actual search for prompt text in the model and in the
// painted DOM, not a check that one named field is absent.

import assert from "node:assert/strict";
import test from "node:test";

import { loadPage, pressEnter, pressTab, tabSequence, textOf } from "./support/browser.js";
import {
  EVIDENCE_PROVENANCE, NO_PROMPT_TEXT_STATEMENT, departmentEvidenceModel, evidenceAnnouncement,
} from "../src/department-evidence.js";
import {
  applyDepartmentEvidence, clearDepartmentEvidence,
} from "../src/department-evidence-view.js";
import {
  MAX_SKETCH_SIGNATURES, aggregateConversationLiteracy, lengthBandFor,
} from "../src/conversation-literacy.js";
import { parseConversationExport } from "../src/conversation-export.js";
import { classifyQuery } from "../src/query-classification.js";
import { promptGradingEligibility } from "../src/prompt-grading-eligibility.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);

/** Prompts whose category the shipped classifier decides, each with a marker. */
const PROMPT = Object.freeze({
  highValue: "zzq-sentinel-alpha Context: the billing service. Constraints: must not change the "
    + "schema. Acceptance criteria: the suite passes.",
  inefficient: "zzq-sentinel-beta try again, that answer is wrong",
  overProvisioned: "zzq-sentinel-gamma fix the typo in this heading",
  outOfScope: "zzq-sentinel-delta give me a recipe for a birthday cake",
});
const SENTINEL = /zzq-sentinel/;

const PREMIUM = "gpt-4o";
const ECONOMY = "gpt-4o-mini";
const COLUMNS = ["conversation_id", "user_email", "department", "created_at", "role", "model", "message_text"];

/** Each turn is `[department, prompt, model]`; timestamps span a full month. */
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

const many = (count, turn) => Array.from({ length: count }, () => turn);

function aggregate(turns) {
  return aggregateConversationLiteracy({ parsed: parse(turns) });
}

const row = (result, name) =>
  result.departments.find((entry) => entry.department === name) ?? null;

/** Noor's verdict for the same corpus, built from the parse she consumes. */
function grading(parsed) {
  const prompts = parsed.records.map((record, index) => ({
    department: record.department,
    timestamp: record.occurred_at,
    classified: parsed.classifications[index]?.classified === true,
  }));
  return promptGradingEligibility({ prompts });
}

/** A department with a clear over-provisioning weakness and enough volume. */
function weakDepartment(count = 40) {
  return [
    ...many(count, ["Atlas Platform", PROMPT.overProvisioned, PREMIUM]),
    ...many(12, ["Atlas Platform", PROMPT.highValue, PREMIUM]),
    ...many(6, ["Atlas Platform", PROMPT.inefficient, ECONOMY]),
  ];
}

const openPage = () => loadPage(PAGE);

// --- what the data layer now retains ----------------------------------------

test("a prompt reaches the panel as four keys and a count, never as text", () => {
  const result = aggregate(weakDepartment());
  const atlas = row(result, "Atlas Platform");

  assert.ok(atlas.sketches.signatureCount > 0);
  for (const signature of atlas.sketches.signatures) {
    assert.deepEqual(Object.keys(signature).sort(), [
      "count", "intentClass", "intentClassLabel", "key", "lengthBand", "lengthBandLabel",
      "modelTier", "share", "signal", "signalLabel",
    ]);
    assert.equal(typeof signature.count, "number");
    assert.ok(["premium", "standard", "economy", "unrecognized", null].includes(signature.modelTier));
  }
  // Counts, not character counts: the band is the only length that leaves.
  assert.equal(JSON.stringify(atlas.sketches).includes("prompt_chars"), false);
  assert.ok(!SENTINEL.test(JSON.stringify(atlas)));
});

test("length bands cover every count, including zero and an implausible one", () => {
  assert.equal(lengthBandFor(0).key, "empty");
  assert.equal(lengthBandFor(1).key, "one_line");
  assert.equal(lengthBandFor(120).key, "one_line");
  assert.equal(lengthBandFor(121).key, "paragraph");
  assert.equal(lengthBandFor(1601).key, "long_form");
  assert.equal(lengthBandFor(9_000_000).key, "long_form");
  assert.equal(lengthBandFor(Number.NaN).key, "empty");
});

test("the score distribution names all four categories, including the empty ones", () => {
  const atlas = row(aggregate(many(30, ["Atlas Platform", PROMPT.overProvisioned, PREMIUM])),
    "Atlas Platform");
  assert.deepEqual(atlas.distribution.map((entry) => entry.key),
    ["highValue", "overProvisioned", "inefficient", "outOfScope"]);
  const concentrated = atlas.distribution.find((entry) => entry.key === "overProvisioned");
  assert.equal(concentrated.share, 1);
  // A category with no prompts is a row that says zero, never a missing row.
  assert.equal(atlas.distribution.find((entry) => entry.key === "outOfScope").count, 0);
});

// --- the reading order ------------------------------------------------------

test("the announcement is grade, then confidence, then coverage, then the action", () => {
  const parsed = parse(weakDepartment());
  const result = aggregateConversationLiteracy({ parsed });
  const model = departmentEvidenceModel({
    department: row(result, "Atlas Platform"),
    grading: grading(parsed),
    provenance: EVIDENCE_PROVENANCE.own.kind,
  });
  const spoken = evidenceAnnouncement(model);

  const grade = spoken.indexOf("grade ");
  const confidence = spoken.indexOf("Confidence:");
  const coverage = spoken.indexOf("Coverage:");
  const action = spoken.indexOf("Next:");
  assert.ok(grade >= 0 && confidence > grade, spoken);
  assert.ok(coverage > confidence, spoken);
  assert.ok(action > coverage, spoken);
});

test("an own-import finding outranks the bundled sample in scale, not in hue", async () => {
  const { document } = await openPage();
  const result = aggregate(weakDepartment());
  const department = row(result, "Atlas Platform");

  const own = applyDepartmentEvidence(document,
    departmentEvidenceModel({ department, provenance: EVIDENCE_PROVENANCE.own.kind }));
  const section = document.getElementById("department-evidence");
  assert.equal(own.provenance.rank, "primary");
  assert.equal(section.dataset.provenance, "own_import");
  assert.match(textOf(section), /Your import/);

  const sample = applyDepartmentEvidence(document,
    departmentEvidenceModel({ department, provenance: EVIDENCE_PROVENANCE.sample.kind }));
  assert.equal(sample.provenance.rank, "secondary");
  assert.match(textOf(section), /Bundled sample/);
  // The rank is a data attribute the type scale keys off, and the label is a
  // word in the text — neither is a colour.
  assert.equal(document.querySelector('[data-rank="secondary"]') !== null, true);
});

// --- the disclosure ---------------------------------------------------------

test("the disclosure is a button that says what it opens and owns its region", async () => {
  const { document } = await openPage();
  const result = aggregate(weakDepartment());
  applyDepartmentEvidence(document, departmentEvidenceModel({
    department: row(result, "Atlas Platform"), provenance: EVIDENCE_PROVENANCE.own.kind,
  }));

  const toggle = document.getElementById("department-evidence-toggle");
  const panel = document.getElementById("department-evidence-panel");
  assert.equal(toggle.tagName, "BUTTON");
  assert.equal(toggle.getAttribute("type"), "button");
  assert.equal(toggle.getAttribute("aria-controls"), "department-evidence-panel");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(panel.hidden, true);
  assert.equal(panel.getAttribute("role"), "region");
  assert.match(panel.getAttribute("aria-label"), /Atlas Platform/);
  // The accessible name says what expands, not "Details".
  assert.match(textOf(toggle), /counts, rubric signals, score distribution/);
  assert.match(textOf(toggle), /Atlas Platform/);
});

test("keyboard alone opens it, the state is announced, and focus is not lost", async () => {
  const { document } = await openPage();
  const result = aggregate(weakDepartment());
  applyDepartmentEvidence(document, departmentEvidenceModel({
    department: row(result, "Atlas Platform"), provenance: EVIDENCE_PROVENANCE.own.kind,
  }));

  // Reachable by Tab from the top of the document, in document order.
  const sequence = tabSequence(document).map((node) => node.id);
  assert.ok(sequence.includes("department-evidence-toggle"), sequence.join(","));
  let guard = 0;
  while (document.activeElement?.id !== "department-evidence-toggle" && guard < 200) {
    pressTab(document);
    guard += 1;
  }
  assert.equal(document.activeElement.id, "department-evidence-toggle");

  pressEnter(document);
  const opened = document.getElementById("department-evidence-toggle");
  assert.equal(opened.getAttribute("aria-expanded"), "true");
  assert.equal(document.getElementById("department-evidence-panel").hidden, false);
  assert.match(textOf(opened), /^Hide the evidence/);
  // Focus survives the repaint, on the same control the reader pressed.
  assert.equal(document.activeElement.id, "department-evidence-toggle");

  pressEnter(document);
  assert.equal(document.getElementById("department-evidence-toggle").getAttribute("aria-expanded"),
    "false");
  assert.equal(document.getElementById("department-evidence-panel").hidden, true);
  assert.equal(document.activeElement.id, "department-evidence-toggle");
});

test("the expanded region reads counts, signals, distribution, sketches — in that order", async () => {
  const { document } = await openPage();
  const result = aggregate(weakDepartment());
  applyDepartmentEvidence(document, departmentEvidenceModel({
    department: row(result, "Atlas Platform"), provenance: EVIDENCE_PROVENANCE.own.kind,
  }));
  document.getElementById("department-evidence-toggle").focus();
  pressEnter(document);

  const panel = document.getElementById("department-evidence-panel");
  const text = textOf(panel);
  const order = ["Counts", "Rubric signals", "Score distribution", "Redacted prompt sketches"];
  let cursor = -1;
  for (const heading of order) {
    const at = text.indexOf(heading);
    assert.ok(at > cursor, `${heading} is out of reading order`);
    cursor = at;
  }
  // Numerator and denominator travel together, so no share is unanchored.
  assert.match(text, /\d+ of \d+/);
});

// --- the promise ------------------------------------------------------------

test("the no-prompt-text statement is visible whether the disclosure is open or closed", async () => {
  const { document } = await openPage();
  const result = aggregate(weakDepartment());
  applyDepartmentEvidence(document, departmentEvidenceModel({
    department: row(result, "Atlas Platform"), provenance: EVIDENCE_PROVENANCE.own.kind,
  }));
  const section = document.getElementById("department-evidence");

  assert.match(textOf(section), /No prompt text is shown here, and none is stored/);
  const promise = document.querySelector(".evidence-privacy");
  assert.equal(promise.hidden, false, "the promise is never hidden");
  assert.equal(promise.parent?.id ?? promise.parentNode?.id, "department-evidence-body");

  document.getElementById("department-evidence-toggle").focus();
  pressEnter(document);
  assert.match(textOf(section), /No prompt text is shown here, and none is stored/);
  assert.equal(document.querySelector(".evidence-privacy").hidden, false);
  // And it is one sentence, authored once.
  assert.match(NO_PROMPT_TEXT_STATEMENT, /^No prompt text is shown here/);
});

test("no prompt text reaches the rendered output, expanded or collapsed", async () => {
  const { document } = await openPage();
  const parsed = parse(weakDepartment());
  const result = aggregateConversationLiteracy({ parsed });
  const model = departmentEvidenceModel({
    department: row(result, "Atlas Platform"),
    grading: grading(parsed),
    provenance: EVIDENCE_PROVENANCE.own.kind,
  });
  assert.ok(!SENTINEL.test(JSON.stringify(model)), "the model carries prompt text");

  applyDepartmentEvidence(document, model);
  const section = document.getElementById("department-evidence");
  assert.ok(!SENTINEL.test(textOf(section)));
  document.getElementById("department-evidence-toggle").focus();
  pressEnter(document);
  const opened = textOf(section);
  assert.ok(!SENTINEL.test(opened), "an expanded panel leaked prompt text");
  // Nor the two other free-form things the parse held.
  assert.ok(!opened.includes("@example.invalid"));
  assert.ok(!/conv-\d{4}/.test(opened));
});

test("redaction is drawn in the neutral chip idiom, never the error palette", async () => {
  const { document } = await openPage();
  const result = aggregate(weakDepartment());
  applyDepartmentEvidence(document, departmentEvidenceModel({
    department: row(result, "Atlas Platform"), provenance: EVIDENCE_PROVENANCE.own.kind,
  }));
  document.getElementById("department-evidence-toggle").focus();
  pressEnter(document);

  const sketch = document.querySelector(".evidence-sketch");
  assert.ok(sketch, "a weak department has sketches");
  const text = textOf(sketch);
  assert.match(text, /text withheld/);
  assert.match(text, /prompts/);
  // The four structural values, and nothing else that could be a prompt.
  assert.match(text, /characters|no prompt body/);
  assert.match(text, /Over-provisioned/);
  assert.match(text, /tier|model not named/);
  assert.match(text, /signal: model fit/);
  // The error role is reserved for "we could not read your file".
  assert.equal(document.querySelector(".evidence-sketch-redaction").classList.contains("evidence-error"),
    false);
  assert.equal(document.getElementById("department-evidence").dataset.state, "graded");
});

// --- every state ------------------------------------------------------------

test("loading, empty and error each carry their own word, shape and sentence", async () => {
  const { document } = await openPage();
  const seen = new Map();
  for (const status of ["loading", "error"]) {
    const model = departmentEvidenceModel({ status });
    applyDepartmentEvidence(document, model);
    const section = document.getElementById("department-evidence");
    assert.equal(section.dataset.state, status);
    assert.equal(section.getAttribute("aria-busy"), status === "loading" ? "true" : "false");
    // No figure is drawn for a state that has none.
    assert.equal(document.getElementById("department-evidence-toggle"), null);
    assert.match(textOf(section), /No prompt text is shown here/);
    seen.set(status, `${model.mark.word}${model.mark.shape}`);
  }
  const empty = departmentEvidenceModel({ status: "ready", department: null });
  applyDepartmentEvidence(document, empty);
  seen.set("empty", `${empty.mark.word}${empty.mark.shape}`);
  assert.equal(new Set(seen.values()).size, 3, "two states share a word and a shape");

  clearDepartmentEvidence(document);
  assert.equal(document.getElementById("department-evidence").hidden, true);
  assert.equal(textOf(document.getElementById("department-evidence-body")), "");
});

test("the partial state reads as trustworthy-with-gaps, not as a failure", async () => {
  const { document } = await openPage();
  // Atlas clears the per-department floor; Boreal does not, which is exactly
  // Noor's partial: a graded department beside a named gap.
  const turns = [...weakDepartment(60), ...many(4, ["Boreal Support", PROMPT.outOfScope, ECONOMY])];
  const parsed = parse(turns);
  const verdict = grading(parsed);
  assert.equal(verdict.state, "partial");

  const model = departmentEvidenceModel({
    department: row(aggregateConversationLiteracy({ parsed }), "Atlas Platform"),
    grading: verdict,
    provenance: EVIDENCE_PROVENANCE.own.kind,
  });
  applyDepartmentEvidence(document, model);

  assert.equal(model.state, "partial");
  assert.equal(model.mark.word, "partial");
  assert.equal(model.mark.shape, "◑");
  const section = document.getElementById("department-evidence");
  // A letter is still published: partial is not withheld.
  assert.ok(model.head.grade);
  assert.match(textOf(section), /partial/i);
  // And it is distinguishable from the error state by word and shape, not hue.
  const failed = departmentEvidenceModel({ status: "error" });
  assert.notEqual(failed.mark.word, model.mark.word);
  assert.notEqual(failed.mark.shape, model.mark.shape);
});

test("a department below the floor withholds the letter and says how far short it is", async () => {
  const { document } = await openPage();
  const result = aggregate(many(1, ["Cinder Research", PROMPT.outOfScope, ECONOMY]));
  const model = departmentEvidenceModel({ department: row(result, "Cinder Research") });
  applyDepartmentEvidence(document, model);

  assert.equal(model.state, "withheld");
  assert.equal(model.head.grade, null);
  assert.match(model.head.gradeLine, /no grade published/);
  assert.match(model.head.impact, /1 classified prompt —/);
  assert.match(model.head.action.text, /more classified prompt/);
  // The counts a reader disputes are still disclosed.
  document.getElementById("department-evidence-toggle").focus();
  pressEnter(document);
  assert.match(textOf(document.getElementById("department-evidence-panel")), /Prompts imported/);
});

// --- implausible extremes ---------------------------------------------------

test("tens of thousands of prompts stay one panel, with the truncation stated", async () => {
  const { document } = await openPage();
  const turns = [
    ...many(30_000, ["Atlas Platform", PROMPT.overProvisioned, PREMIUM]),
    ...many(9_000, ["Atlas Platform", PROMPT.inefficient, ECONOMY]),
    ...many(3_000, ["Atlas Platform", PROMPT.outOfScope, PREMIUM]),
  ];
  const model = departmentEvidenceModel({
    department: row(aggregate(turns), "Atlas Platform"),
    provenance: EVIDENCE_PROVENANCE.own.kind,
  });
  applyDepartmentEvidence(document, model);
  document.getElementById("department-evidence-toggle").focus();
  pressEnter(document);

  const rows = document.querySelectorAll(".evidence-sketch");
  assert.ok(rows.length <= MAX_SKETCH_SIGNATURES, `${rows.length} sketch rows`);
  const text = textOf(document.getElementById("department-evidence-panel"));
  // Separators, so 42,000 cannot be misread as 42.
  assert.match(text, /42,000/);
  assert.match(text, /shapes? cover|Showing the/);
});

test("a single-signal concentration and a silent signal both read as counts", async () => {
  const { document } = await openPage();
  const model = departmentEvidenceModel({
    department: row(aggregate(many(30, ["Atlas Platform", PROMPT.overProvisioned, PREMIUM])),
      "Atlas Platform"),
    provenance: EVIDENCE_PROVENANCE.own.kind,
  });
  applyDepartmentEvidence(document, model);
  document.getElementById("department-evidence-toggle").focus();
  pressEnter(document);
  const text = textOf(document.getElementById("department-evidence-panel"));
  assert.match(text, /100%/);
  // The two signals that did not fire are rows that say so, not absences.
  assert.equal(document.querySelectorAll('[data-fired="false"]').length, 2);
  assert.match(text, /no prompts · 0%/);
});

test("a department with no weakness signal says so instead of drawing an empty list", async () => {
  const { document } = await openPage();
  const model = departmentEvidenceModel({
    department: row(aggregate(many(30, ["Atlas Platform", PROMPT.highValue, ECONOMY])),
      "Atlas Platform"),
    provenance: EVIDENCE_PROVENANCE.own.kind,
  });
  applyDepartmentEvidence(document, model);
  assert.match(model.head.impact, /no weakness signal fired/);
  document.getElementById("department-evidence-toggle").focus();
  pressEnter(document);
  assert.match(textOf(document.getElementById("department-evidence-panel")),
    /nothing to sketch/);
});

test("an unusually long department name wraps rather than escaping the layout", async () => {
  const { document } = await openPage();
  const name = `Platform Reliability and Developer Experience ${"Extended ".repeat(12)}Group`;
  const model = departmentEvidenceModel({
    department: row(aggregate(many(30, [name, PROMPT.overProvisioned, PREMIUM])), name),
    provenance: EVIDENCE_PROVENANCE.own.kind,
  });
  applyDepartmentEvidence(document, model);
  // The name is a text node, never an attribute the layout depends on, and the
  // disclosure's accessible name still names it.
  assert.match(textOf(document.getElementById("department-evidence")), /Extended/);
  assert.match(textOf(document.getElementById("department-evidence-toggle")), /Extended/);
});
