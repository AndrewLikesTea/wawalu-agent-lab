// The department selector a forwarded `?department=` link resolves through.
//
// THREE THINGS ARE UNDER TEST and they fail for different reasons, so they are
// asserted separately: slug RESOLUTION (which values name a department and which
// do not), the FALLBACK (what a reader gets when none of them does), and the
// SHAPE of the answer itself (five parts, present for every department in every
// period the record holds).
//
// The bundled record is committed; the two-period record is generated here
// rather than committed, because the only thing it needs to be is a record that
// holds one department twice, and a checked-in file of that would be a second
// dataset to keep in step with the first.
//
// No network, no credential, no browser, no clock.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  ANSWER_SCOPE, DEPARTMENT_RESOLUTION, DEPARTMENT_SLUGS,
  DEPARTMENT_VIEW_MODEL_VERSION, MAX_REQUESTED_SLUG_LENGTH, departmentViewModel,
  knownDepartmentSlugs, normalizeRequestedSlug, resolveDepartment,
} from "../src/finops-department-view-model.js";
import { FINOPS_DEPARTMENT_IDS } from "../src/finops-destinations.js";

const RECORD = JSON.parse(
  await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));

/** The five parts every answer carries, whichever scope it is about. */
const PARTS = ["headline", "spendMix", "trajectory", "peerPosition", "trainingGap", "verdict"];

/**
 * A record holding two departments across two periods.
 *
 * Built from the committed record so every figure below it is a real one: the
 * second period is the first with its spend moved and its own prior period
 * attached, which is the shape a returning month actually has.
 */
function twoPeriodRecord() {
  const pick = (id) => RECORD.departments.find((entry) => entry.id === id);
  const later = (entry) => ({
    ...entry,
    period: "25 Jul–25 Aug 2026",
    spendUsd: Math.round(entry.spendUsd * 1.2),
    previousPeriod: { period: entry.period, spendUsd: entry.spendUsd, score: 70 },
  });
  const backend = pick("backend");
  const quality = pick("quality");
  return {
    ...RECORD,
    departments: [backend, quality, later(backend), later(quality)],
  };
}

/* ------------------------------ slug resolution ---------------------------- */

test("the canonical slug list is the one the bundled analysis holds", () => {
  assert.deepEqual([...DEPARTMENT_SLUGS], [...knownDepartmentSlugs(RECORD)],
    "an addressable department the analysis does not hold is a link to an empty drill-down");
  assert.ok(DEPARTMENT_SLUGS.length >= 2);
});

test("the destination registry sources its department ids from the selector", () => {
  // Identity, not equality: a copy would drift, and the point of #1612 is that
  // there is one list.
  assert.equal(FINOPS_DEPARTMENT_IDS, DEPARTMENT_SLUGS);
});

test("a slug the record holds resolves to that department and no other", () => {
  for (const slug of DEPARTMENT_SLUGS) {
    const resolution = resolveDepartment(RECORD, slug);
    assert.equal(resolution.code, DEPARTMENT_RESOLUTION.resolved, slug);
    assert.equal(resolution.department.id, slug);
  }
});

test("case and surrounding space are read, arbitrary prose is not", () => {
  assert.equal(resolveDepartment(RECORD, "  QuaLity ").department.id, "quality");
  assert.equal(normalizeRequestedSlug("Quality").slug, "quality");
});

test("every value that is not a department name has its own reason code", () => {
  const code = (value) => resolveDepartment(RECORD, value).code;
  assert.equal(code(undefined), DEPARTMENT_RESOLUTION.missing);
  assert.equal(code(null), DEPARTMENT_RESOLUTION.missing);
  assert.equal(code(""), DEPARTMENT_RESOLUTION.missing);
  assert.equal(code("   "), DEPARTMENT_RESOLUTION.missing);
  // An array-valued `?department=a&department=b`, and anything else not text.
  assert.equal(code(["quality", "backend"]), DEPARTMENT_RESOLUTION.malformed);
  assert.equal(code(42), DEPARTMENT_RESOLUTION.malformed);
  assert.equal(code({ id: "quality" }), DEPARTMENT_RESOLUTION.malformed);
  // A percent escape the address bar mangled, and markup, neither of which is a
  // name — and neither of which may reach a sentence as it arrived.
  assert.equal(code("%E0%A4%A"), DEPARTMENT_RESOLUTION.malformed);
  assert.equal(code("<script>alert(1)</script>"), DEPARTMENT_RESOLUTION.malformed);
  assert.equal(code("qual ity"), DEPARTMENT_RESOLUTION.malformed);
  assert.equal(code("marketing"), DEPARTMENT_RESOLUTION.unknown);
  assert.equal(code("quality"), DEPARTMENT_RESOLUTION.resolved);
});

test("a record with no departments is unreadable rather than empty", () => {
  assert.equal(resolveDepartment(null, "quality").code, DEPARTMENT_RESOLUTION.unreadable);
  assert.equal(resolveDepartment({ departments: [] }, "quality").code,
    DEPARTMENT_RESOLUTION.unreadable);
  assert.equal(resolveDepartment({ departments: "nope" }, "quality").code,
    DEPARTMENT_RESOLUTION.unreadable);
});

test("a requested value is clamped before it is ever quoted back", () => {
  const long = "x".repeat(400);
  const model = departmentViewModel(RECORD, long);
  assert.ok(model.requestedSlug.length <= MAX_REQUESTED_SLUG_LENGTH);
  assert.ok(model.sentence.length < 200, "the reason stays one readable sentence");
});

test("a named period this record does not hold is unknown, never a silent swap", () => {
  const record = twoPeriodRecord();
  const may = resolveDepartment(record, "quality", { period: "25 May–24 Jun 2026" });
  assert.equal(may.code, DEPARTMENT_RESOLUTION.unknown,
    "a link forwarded for a month this record lacks must not be answered with another month");
  const july = resolveDepartment(record, "quality", { period: "25 Jul–25 Aug 2026" });
  assert.equal(july.code, DEPARTMENT_RESOLUTION.resolved);
  assert.equal(july.department.period, "25 Jul–25 Aug 2026");
});

/* --------------------------------- fallback -------------------------------- */

test("every fallback answers for the organization and says why, in one sentence", () => {
  for (const value of [undefined, "", "marketing", ["a", "b"], 42, "%E0%A4%A"]) {
    const model = departmentViewModel(RECORD, value);
    assert.equal(model.resolved, false);
    assert.equal(model.scope, ANSWER_SCOPE.organization);
    assert.equal(model.slug, null, "a fallback names no department");
    assert.equal(model.name, "the whole organization");
    assert.equal(model.sentence.split(". ").length, 1, `two sentences for ${String(value)}`);
    assert.match(model.sentence, /whole organization/);
    // Reader vocabulary: no identifier, no file name, no code, no jargon.
    assert.doesNotMatch(model.sentence, /[_/]|\.js|slug|param|null|undefined|error/i);
  }
});

test("an unknown name is quoted back, and nothing else is", () => {
  assert.match(departmentViewModel(RECORD, "marketing").sentence, /“marketing”/);
  // A value that is not name-shaped is described rather than repeated, so no
  // address bar can put its own prose in front of a reader.
  const mangled = departmentViewModel(RECORD, "<script>alert(1)</script>");
  assert.doesNotMatch(mangled.sentence, /script/);
});

test("a fallback carries the organization's own five parts, not a department's", () => {
  const model = departmentViewModel(RECORD, "marketing");
  for (const part of PARTS) assert.ok(model[part], `${part} is missing from the fallback`);
  assert.equal(model.spendMix.rows.length, 4);
  assert.equal(model.trajectory.available, true);
  assert.equal(model.peerPosition.available, true);
  assert.equal(model.trainingGap.available, true);
  // No verdict is invented for a scope no rubric scores.
  assert.equal(model.verdict.available, false);
  assert.equal(model.verdict.value, null);
  // And no department's figures are served under the requested name.
  const quality = departmentViewModel(RECORD, "quality");
  assert.notEqual(model.headline.display, quality.headline.display);
  for (const name of RECORD.departments.map((entry) => entry.name)) {
    assert.doesNotMatch(model.sentence, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("a record that cannot be read says so and does not offer organization figures", () => {
  const model = departmentViewModel({ departments: [] }, "quality");
  assert.equal(model.reasonCode, DEPARTMENT_RESOLUTION.unreadable);
  assert.match(model.sentence, /could not be read/);
  assert.equal(model.spendMix.rows.length, 4, "the shape is constant even here");
  assert.equal(model.spendMix.available, false);
  assert.equal(model.headline.value, 0);
});

test("no input throws, whatever it is", () => {
  const inputs = [undefined, null, "", 0, false, NaN, [], {}, Symbol("x"), () => {}];
  for (const record of [RECORD, null, undefined, {}, { departments: null }]) {
    for (const value of inputs) {
      assert.doesNotThrow(() => departmentViewModel(record, value),
        `record ${JSON.stringify(record)?.slice(0, 20)} value ${String(value)}`);
    }
  }
});

/* ------------------------------ view-model shape --------------------------- */

test("two departments across two periods each get the whole answer", () => {
  const record = twoPeriodRecord();
  const seen = new Set();
  for (const slug of ["backend", "quality"]) {
    for (const period of ["25 Jun–25 Jul 2026", "25 Jul–25 Aug 2026"]) {
      const model = departmentViewModel(record, slug, { period });
      assert.equal(model.resolved, true, `${slug} ${period}`);
      assert.equal(model.scope, ANSWER_SCOPE.department);
      assert.equal(model.slug, slug);
      assert.equal(model.period, period);
      assert.equal(model.version, DEPARTMENT_VIEW_MODEL_VERSION);

      for (const part of PARTS) assert.ok(model[part], `${part} missing for ${slug} ${period}`);
      assert.equal(model.spendMix.rows.length, 4);
      for (const row of model.spendMix.rows) {
        assert.match(row.share, /%$/);
        assert.match(row.spend, /^\$/);
        assert.ok(row.label.length > 0 && row.note.length > 0);
      }
      assert.match(model.headline.display, /^\$/);
      assert.match(model.trajectory.text, /Spend is (up|down|flat)/);
      assert.match(model.peerPosition.text, /quartile/);
      assert.ok(model.trainingGap.text.length > 0);
      assert.equal(model.verdict.available, true);
      assert.ok(model.verdict.value.length > 0);
      assert.ok(model.verdict.action.text.length > 0);
      assert.match(model.sentence, /the department this link named/);

      seen.add(`${slug}|${model.headline.display}|${model.trajectory.text}`);
    }
  }
  // Four distinct answers, not one answer served four times: a period that is
  // read but not used is exactly the bug this pins.
  assert.equal(seen.size, 4);
});

test("the model is JSON-serializable, all the way down", () => {
  for (const value of ["quality", "marketing", undefined]) {
    const model = departmentViewModel(RECORD, value);
    assert.deepEqual(JSON.parse(JSON.stringify(model)), model,
      "a model that does not survive a round trip cannot be carried in a brief");
  }
});

test("the answer for one department is never another department's", () => {
  const quality = departmentViewModel(RECORD, "quality");
  const backend = departmentViewModel(RECORD, "backend");
  assert.notEqual(quality.name, backend.name);
  assert.notEqual(quality.headline.value, backend.headline.value);
  assert.match(quality.sentence, new RegExp(quality.name.replace(/&/, "&")));
});
