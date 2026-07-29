// The coaching decision selected from a local organizational query sample, and
// the bundled synthetic sample it is demonstrated with.
//
// WHAT THIS FILE ASSERTS, AND WHAT IT REFUSES TO.
// ----------------------------------------------
// Nothing here transcribes a grade, a score, a share, or a digest. Every
// expectation is derived from the literacy model the shipped scorer produced for
// the sample under test, so moving a rubric weight moves the model and the
// assertion together and this file cannot bless a number nobody recomputed.
//
// The bundled example goes through `parseQuerySample` — the shipped validator —
// exactly as a reader's chosen file does. There is no bypass path to test.
//
// The sentinel ("zzq-coaching-...") appears in no other file in the repository,
// so the redaction walk below is an actual search for prompt text in the selected
// state rather than a promise that none is there.

import assert from "node:assert/strict";
import test from "node:test";

import {
  COACHING_QUESTION, COACHING_RANK_RULE, DISCLOSURE_IDS, DISCLOSURE_ORDER,
  ORG_QUERY_DECISION_STATE, ORG_QUERY_DECISION_VERSION, orgQueryCoachingDecision,
} from "../src/org-query-decision.js";
import {
  EXAMPLE_ORG_QUERY_SAMPLE_FILE, exampleOrgQuerySampleText, loadExampleOrgQuerySample,
} from "../src/org-query-example.js";
import { exampleDepartmentUnitIds, loadExampleQuerySample } from "../src/query-sample-example.js";
import { orgQuerySampleResult } from "../src/org-query-source.js";
import {
  ORG_CLASSIFIED_RECORD_KEYS, ORG_QUERY_SCORING_CODES, orgQueryDepartmentLiteracy,
} from "../src/org-query-scoring.js";
import { parseQuerySample } from "../src/query-sample-contract.js";

const SENTINEL = "zzq-coaching-sentinel";

/** The literacy model for one already-parsed sample, through the shipped path. */
function literacyOf(parsed) {
  assert.equal(parsed.ok, true, `the sample did not parse: ${parsed.problem?.code}`);
  const sample = orgQuerySampleResult(parsed);
  assert.ok(sample, "no declared source reads this sample's dialect");
  return orgQueryDepartmentLiteracy({ results: [sample] });
}

const gradedLiteracy = () => literacyOf(loadExampleOrgQuerySample());
/** The nine-row downloadable template: read, classified, and under every floor. */
const templateLiteracy = () => literacyOf(loadExampleQuerySample());

/* ------------------------------- the example -------------------------------- */

test("the bundled example parses with the shipped validator and clears the floors", () => {
  const parsed = loadExampleOrgQuerySample();
  assert.equal(parsed.ok, true);
  const literacy = literacyOf(parsed);
  // The whole reason this file exists beside the nine-row template: it can be
  // graded, so the front door can demonstrate the reading and not only its
  // refusal. Both facts are asserted, because either one alone is a trap.
  assert.equal(literacy.gradeable, true);
  assert.equal(templateLiteracy().gradeable, false);
  // Enough units for a priority order to mean something, and letters that differ.
  const graded = literacy.departments.filter((row) => row.gradeable);
  assert.ok(graded.length >= 3, "an example with fewer than three graded units ranks nothing");
  assert.ok(new Set(graded.map((row) => row.grade)).size > 1,
    "every unit graded the same, so the priority list is alphabetical noise");
});

test("every example unit is an active department in the bundled HRIS export", () => {
  const declared = new Set(exampleDepartmentUnitIds());
  for (const record of loadExampleOrgQuerySample().records) {
    assert.ok(declared.has(record.orgUnitId),
      `${record.orgUnitId} is not a department in the bundled org export`);
  }
});

test("the example is deterministic, so its input digest is a usable handle", () => {
  assert.equal(exampleOrgQuerySampleText(), exampleOrgQuerySampleText());
  assert.equal(gradedLiteracy().provenance.inputDigest, gradedLiteracy().provenance.inputDigest);
  assert.match(EXAMPLE_ORG_QUERY_SAMPLE_FILE.fileName, /\.csv$/);
});

/* ------------------------------- graded state -------------------------------- */

test("the graded state answers the question with the ranked department and its grade", () => {
  const literacy = gradedLiteracy();
  const state = orgQueryCoachingDecision(literacy, { origin: "example" });

  assert.equal(state.version, ORG_QUERY_DECISION_VERSION);
  assert.equal(state.state, ORG_QUERY_DECISION_STATE.graded);
  assert.equal(state.question, COACHING_QUESTION);
  // The named department is the coaching gap's — the recoverable-points ranking
  // the surface quotes — and not the lowest letter, unless they coincide.
  const named = literacy.coachingGap.department;
  assert.ok(state.answer.includes(named));
  assert.equal(state.rule, COACHING_RANK_RULE);
  const row = literacy.departments.find((entry) => entry.department === named);
  assert.equal(state.benchmark.grade, row.grade);
  assert.equal(state.benchmark.score, row.score);
  assert.ok(state.benchmark.text.includes(String(row.score)));
  assert.ok(state.benchmark.text.includes(literacy.provenance.rubricVersion));
  // The roll-up is a comparator, and the surface must say it is not a peer cohort.
  assert.equal(state.benchmark.companyGrade, literacy.company.grade);
  assert.match(state.benchmark.rule, /No peer cohort/);
});

test("the graded state carries the confidence level, its rule, and the capping factor", () => {
  const literacy = gradedLiteracy();
  const state = orgQueryCoachingDecision(literacy);
  assert.equal(state.confidence.level, literacy.confidence.level);
  assert.equal(state.confidence.rule, literacy.confidence.rule);
  assert.equal(state.confidence.factors.length, literacy.confidence.factors.length);
  // One factor is marked as the one that capped the level, and its own sentence
  // is what the headline confidence line reads.
  const capping = state.confidence.factors.filter((factor) => factor.capping);
  assert.equal(capping.length, 1);
  assert.equal(capping[0].level, literacy.confidence.level);
  assert.ok(state.confidence.text.includes(capping[0].detail));
});

test("one prioritized action, named from the signal, and no money invented for it", () => {
  const literacy = gradedLiteracy();
  const state = orgQueryCoachingDecision(literacy);
  assert.equal(state.action.available, true);
  assert.ok(state.action.title.includes(literacy.coachingGap.department));
  assert.ok(state.action.title.includes(literacy.coachingGap.signalLabel));
  assert.equal(state.action.detail, literacy.coachingGap.text);
  assert.ok(state.action.basis.includes(String(literacy.coachingGap.impact)));
  // A query sample carries no cost. The action says so rather than apportioning
  // dollars out of token counts, which is the one thing this path must not do.
  assert.match(state.action.money, /No savings figure is stated/);
});

test("provenance names the origin, the versions, and where the grading ran", () => {
  const literacy = gradedLiteracy();
  const own = orgQueryCoachingDecision(literacy, { origin: "import", fileNames: ["mine.csv"] });
  const example = orgQueryCoachingDecision(literacy, { origin: "example" });

  assert.match(own.provenance.label, /Your file/);
  assert.deepEqual([...own.provenance.files], ["mine.csv"]);
  assert.match(example.provenance.label, /Bundled synthetic/);
  // An example graded as the reader's own is the mislabelling per-panel
  // provenance exists to end, and the announcement carries the same distinction.
  assert.match(example.announcement, /Bundled synthetic example/);
  assert.match(own.announcement, /Your imported query sample/);
  for (const state of [own, example]) {
    assert.equal(state.provenance.digest, literacy.provenance.inputDigest);
    assert.ok(state.provenance.detail.includes(literacy.provenance.scorerVersion));
    assert.ok(state.provenance.detail.includes(literacy.provenance.classifierVersion));
    assert.match(state.provenance.local, /browser tab/);
  }
});

test("provenance neutralizes hostile filename controls at the selector boundary", () => {
  const state = orgQueryCoachingDecision(gradedLiteracy(), {
    fileNames: ["quarterly\u202Efdp.csv\u0000", "", null],
  });

  assert.deepEqual([...state.provenance.files], ["quarterly\uFFFDfdp.csv\uFFFD"]);
  assert.doesNotMatch(state.provenance.files[0],
    /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u);
});

/* ------------------------------- disclosures --------------------------------- */

test("four disclosures, in one order, each with rows a reader can check", () => {
  const literacy = gradedLiteracy();
  const state = orgQueryCoachingDecision(literacy);
  assert.deepEqual(state.disclosures.map((entry) => entry.id),
    DISCLOSURE_ORDER.map((entry) => entry.id));
  for (const disclosure of state.disclosures) {
    assert.ok(disclosure.question.length > 0);
    assert.ok(disclosure.chip.length > 0, `${disclosure.id} offers no reason to open it`);
    assert.ok(disclosure.rows.length > 0, `${disclosure.id} is an empty panel`);
    for (const row of disclosure.rows) {
      assert.ok(row.term.length > 0 && row.detail.length > 0);
    }
  }

  const find = (id) => state.disclosures.find((entry) => entry.id === id);
  // The mix is the rubric's own categories plus the unclassified remainder, so
  // the shares a reader adds up account for every classified row.
  const mix = find(DISCLOSURE_IDS.mix);
  assert.equal(mix.rows.length, literacy.mix.length + 1);
  assert.equal(mix.rows.at(-1).term, "Not classified");
  assert.ok(mix.rows.at(-1).detail.includes(String(literacy.prompts.unclassified)));
  // Every unit appears, graded or not: a unit hidden because it could not be
  // graded is a department a leader never learns they have no reading for.
  const evidence = find(DISCLOSURE_IDS.evidence);
  assert.equal(evidence.rows.length, literacy.departments.length);
  for (const row of literacy.departments) {
    assert.ok(evidence.rows.some((entry) => entry.term === row.department));
  }
  // The limits panel carries all three confidence factors and both floors.
  const sampling = find(DISCLOSURE_IDS.sampling);
  const samplingText = sampling.rows.map((row) => `${row.term} ${row.detail}`).join(" ");
  for (const factor of literacy.confidence.factors) assert.ok(samplingText.includes(factor.detail));
  assert.ok(samplingText.includes(String(literacy.provenance.letterFloor)));
  assert.ok(samplingText.includes(String(literacy.provenance.publishableFloor)));
  assert.match(samplingText, /No cost, no trend, and no peer comparison/);
  // The redaction panel is the statement the scorer owns, the field allowlist,
  // and the digest — not a second promise written here.
  const redaction = find(DISCLOSURE_IDS.redaction);
  const redactionText = redaction.rows.map((row) => row.detail).join(" ");
  assert.ok(redactionText.includes(literacy.redaction.statement));
  for (const key of ORG_CLASSIFIED_RECORD_KEYS) assert.ok(redactionText.includes(key));
  assert.ok(redactionText.includes(literacy.provenance.inputDigest));
});

/* -------------------------------- redaction ---------------------------------- */

test("no prompt text reaches the selected state, even when the file carries excerpts", () => {
  const units = exampleDepartmentUnitIds();
  const header = "org_unit_id,query_date,model,input_tokens,output_tokens,prompt_excerpt,category";
  const rows = [];
  // Thirty rows in one unit, twenty-eight declared and two carrying a sentinel
  // excerpt: enough to grade, and enough for an excerpt to have somewhere to leak.
  for (let index = 0; index < 30; index += 1) {
    const day = `2026-06-${String(1 + (index % 20)).padStart(2, "0")}`;
    const excerpt = index < 2 ? `${SENTINEL} rewrite this paragraph for me` : "";
    rows.push([units[0], day, "acme-sonnet-1", "900", "500", excerpt,
      excerpt ? "" : ["highValue", "inefficient", "overProvisioned"][index % 3]].join(","));
  }
  const parsed = parseQuerySample(`${[header, ...rows].join("\n")}\n`);
  const literacy = literacyOf(parsed);
  // The sentinel is in the file the reader chose…
  assert.ok(parsed.records.some((record) => String(record.promptExcerpt ?? "").includes(SENTINEL)));
  // …and in nothing this surface selects from it.
  const state = orgQueryCoachingDecision(literacy);
  assert.ok(!JSON.stringify(state).includes(SENTINEL),
    "prompt text reached the coaching decision state");
});

/* ------------------------- absent and ungradeable ---------------------------- */

test("no sample is the absent state, and it claims nothing", () => {
  const state = orgQueryCoachingDecision(null);
  assert.equal(state.state, ORG_QUERY_DECISION_STATE.absent);
  assert.equal(state.question, COACHING_QUESTION);
  assert.equal(state.answer, undefined);
  assert.equal(state.benchmark, undefined);
  assert.equal(state.disclosures, undefined);
});

test("a read sample with no gradeable unit publishes no letter and says which floor it missed", () => {
  const literacy = templateLiteracy();
  const state = orgQueryCoachingDecision(literacy, { origin: "example" });

  assert.equal(state.state, ORG_QUERY_DECISION_STATE.ungradeable);
  assert.equal(state.reason.code, ORG_QUERY_SCORING_CODES.NO_GRADEABLE_UNIT);
  // No figure of any kind: a benchmark or a priority order here would be a claim
  // about departments the scorer refused to grade.
  assert.equal(state.benchmark, undefined);
  assert.equal(state.answer, "No department can be named yet.");
  assert.equal(state.action.available, false);
  assert.ok(state.action.title.length > 0, "a refusal with no next step is a dead end");
  assert.ok(state.action.basis.includes(String(literacy.prompts.total)));
  // The disclosures stay, because that is where a reader checks the refusal, and
  // the evidence rows name every unit with the reason it was not graded.
  assert.equal(state.disclosures.length, DISCLOSURE_ORDER.length);
  const evidence = state.disclosures.find((entry) => entry.id === DISCLOSURE_IDS.evidence);
  assert.equal(evidence.rows.length, literacy.departments.length);
  for (const row of evidence.rows) {
    assert.equal(row.gradeable, false);
    assert.match(row.detail, /^Not graded/);
  }
});

test("a selection with no readable row is its own reason, not the same one", () => {
  const literacy = orgQueryDepartmentLiteracy({ results: [] });
  const state = orgQueryCoachingDecision(literacy);
  assert.equal(state.state, ORG_QUERY_DECISION_STATE.ungradeable);
  assert.equal(state.reason.code, ORG_QUERY_SCORING_CODES.NO_RECORDS);
  assert.notEqual(state.reason.label,
    orgQueryCoachingDecision(templateLiteracy()).reason.label);
});

test("selection is deterministic: the same model twice is the same state", () => {
  const literacy = gradedLiteracy();
  assert.deepEqual(orgQueryCoachingDecision(literacy), orgQueryCoachingDecision(literacy));
});
