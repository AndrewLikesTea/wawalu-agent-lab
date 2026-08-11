// The department selector (#1612) and the forwarded link that lands on it.
//
// Two halves, tested apart: the selector is pure and is exercised over records
// built in this file, and the wiring is exercised against the parsed document.
// The fixtures below are authored here rather than committed as files because
// what they have to be is small and legible — two departments over two periods,
// plus the malformed shapes a URL can produce.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEPARTMENT_RESOLUTION, DEPARTMENT_VIEW_MODEL_VERSION, BUNDLED_ANALYSIS_RECORD,
  departmentViewModel, knownDepartmentSlugs, resolveDepartmentSlug,
} from "../src/finops-department-view-model.js";
import { FINOPS_DEPARTMENT_IDS } from "../src/finops-destinations.js";
import { destinationSelections } from "../src/finops-destination-regions.js";
import {
  FORWARDED_DEPARTMENT_NOTE_ID, applyForwardedDepartment, readForwardedDepartment,
} from "../src/finops-forwarded-department-view.js";
import { parseHtml, textOf } from "./support/browser.js";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../src/evolution.html", import.meta.url), "utf8");

/**
 * One department, over one period. Every figure the view model reads has a
 * value here, so an assertion that a slot is unavailable is about the shape it
 * was given and not about a field somebody forgot.
 */
const department = (id, name, period, overrides = {}) => ({
  id,
  name,
  spendUsd: 40_000,
  queries: 50_000,
  period,
  periodDays: 31,
  previousPeriod: { period: "25 Apr–24 May 2026", spendUsd: 38_000, score: 70 },
  sampling: {
    status: "available", sampledQueries: 400, sampledThrough: "2026-07-25",
    freshnessLabel: "current through period end",
  },
  actionPlan: {
    status: "planned",
    title: `Route ${name}'s short requests to the standard model`,
    rationale: "Over-provisioning is this department's largest recoverable line.",
    impact: "Reduce monthly spend by an estimated 8%",
    confidence: "Medium · 400-query scored sample",
    accountableRole: "AI platform owner",
    provenance: "Synthetic fixture",
    baselineUsd: 4_000, targetUsd: 1_200, estimatedSavingsUsd: 2_800,
    diagnosis: "A one-line transformation is routed to a frontier model.",
  },
  peerPercentile: 68,
  mix: { highValue: 0.6, overProvisioned: 0.2, inefficient: 0.1, outOfScope: 0.1 },
  ...overrides,
});

/** A record for one reporting period, holding the same two departments. */
const recordFor = (period, spend) => ({
  organization: { name: "Northwind Technology", period, peerPercentile: 66, peerMedianScore: 61 },
  benchmark: { medianScore: 61, rubricVersion: "literacy-mix/1.0.0" },
  departments: [
    department("backend", "Backend", period, { spendUsd: spend }),
    department("quality", "Quality Engineering", period, {
      spendUsd: Math.round(spend * 0.4),
      peerPercentile: 34,
      mix: { highValue: 0.4, overProvisioned: 0.3, inefficient: 0.2, outOfScope: 0.1 },
    }),
  ],
});

const JUNE = recordFor("25 May–24 Jun 2026", 30_000);
const JULY = recordFor("25 Jun–25 Jul 2026", 40_000);

// ---------------------------------------------------------------------------
// 1. The slug list is derived, and the registry is sourced from it
// ---------------------------------------------------------------------------

test("known slugs come off the record, in the record's own order", () => {
  assert.deepEqual([...knownDepartmentSlugs(JULY)], ["backend", "quality"]);
  assert.deepEqual([...knownDepartmentSlugs(BUNDLED_ANALYSIS_RECORD)],
    BUNDLED_ANALYSIS_RECORD.departments.map((entry) => entry.id));
  // A record that holds no departments is answered, not thrown at.
  assert.deepEqual([...knownDepartmentSlugs({})], []);
  assert.deepEqual([...knownDepartmentSlugs(null)], []);
  assert.deepEqual([...knownDepartmentSlugs({ departments: [{ id: "a" }, { id: "a" }, {}] })], ["a"]);
});

test("the destination registry's department slugs ARE the selector's known slugs", () => {
  // The drift criterion, enforced rather than described: the registry, the
  // per-destination selection ids the workspace shell reads, and the selector
  // are one list.
  assert.deepEqual([...FINOPS_DEPARTMENT_IDS], [...knownDepartmentSlugs()]);
  assert.deepEqual([...destinationSelections("department")], [...knownDepartmentSlugs()]);
  assert.ok(FINOPS_DEPARTMENT_IDS.length >= 2, "the bundled record holds departments to address");
});

// ---------------------------------------------------------------------------
// 2. Resolution is total
// ---------------------------------------------------------------------------

test("a valid slug resolves to that department and nothing else", () => {
  const resolved = resolveDepartmentSlug(JULY, "quality");
  assert.equal(resolved.ok, true);
  assert.equal(resolved.slug, "quality");
  assert.equal(resolved.reasonCode, DEPARTMENT_RESOLUTION.resolved);
  assert.equal(resolved.reason, "");
  assert.equal(resolved.department.name, "Quality Engineering");
});

test("every refusal is a reason code and a sentence, and never another department", () => {
  const cases = [
    ["nope", DEPARTMENT_RESOLUTION.unknown],
    [undefined, DEPARTMENT_RESOLUTION.absent],
    [null, DEPARTMENT_RESOLUTION.absent],
    ["", DEPARTMENT_RESOLUTION.empty],
    ["   ", DEPARTMENT_RESOLUTION.empty],
    [42, DEPARTMENT_RESOLUTION.notText],
    [{ id: "backend" }, DEPARTMENT_RESOLUTION.notText],
    [["backend"], DEPARTMENT_RESOLUTION.notText],
  ];
  for (const [slug, code] of cases) {
    const resolved = resolveDepartmentSlug(JULY, slug);
    assert.equal(resolved.reasonCode, code, `${String(slug)} resolves as ${code}`);
    assert.equal(resolved.ok, false);
    assert.equal(resolved.slug, null, "a refusal never names a department");
    assert.equal(resolved.department, null);
    assert.ok(resolved.reason.length > 20, "a refusal states a reason in words");
  }
});

test("a malformed record is unreadable rather than an exception", () => {
  for (const record of [null, undefined, 42, "backend", {}, { departments: "backend" }]) {
    const resolved = resolveDepartmentSlug(record, "backend");
    assert.equal(resolved.reasonCode, DEPARTMENT_RESOLUTION.unreadable);
    assert.equal(resolved.slug, null);
  }
});

test("a very long slug is clamped before it reaches a sentence", () => {
  const resolved = resolveDepartmentSlug(JULY, "x".repeat(400));
  assert.equal(resolved.reasonCode, DEPARTMENT_RESOLUTION.unknown);
  assert.equal(resolved.requestedSlug.length, 80);
  assert.ok(resolved.reason.includes(resolved.requestedSlug));
});

// ---------------------------------------------------------------------------
// 3. The view model: two departments, two periods
// ---------------------------------------------------------------------------

const SLOTS = ["spendMix", "trajectory", "peerPosition", "trainingGap", "interventionVerdict"];

for (const [label, record] of [["June", JUNE], ["July", JULY]]) {
  for (const slug of ["backend", "quality"]) {
    test(`${slug} in ${label} states all five parts of its answer`, () => {
      const vm = departmentViewModel(record, slug);
      assert.equal(vm.version, DEPARTMENT_VIEW_MODEL_VERSION);
      assert.equal(vm.scope, "department");
      assert.equal(vm.resolved, true);
      assert.equal(vm.slug, slug);
      assert.equal(vm.period, record.organization.period);
      for (const slot of SLOTS) {
        assert.equal(vm[slot].available, true, `${slug}/${label} states ${slot}`);
        assert.equal(vm[slot].reason, null);
      }
      assert.equal(vm.spendMix.spendUsd,
        record.departments.find((entry) => entry.id === slug).spendUsd);
      assert.equal(vm.spendMix.categories.length, 4);
      assert.ok(vm.spendMix.recoverableUsd > 0);
      assert.equal(vm.trajectory.period, record.organization.period);
      assert.equal(vm.trajectory.comparisonPeriod, "25 Apr–24 May 2026");
      assert.ok(["rising", "falling", "flat"].includes(vm.trajectory.direction));
      assert.equal(vm.peerPosition.cohortMedianScore, 61);
      assert.equal(vm.trainingGap.sampledQueries, 400);
      assert.equal(vm.interventionVerdict.status, "planned");
      assert.equal(vm.interventionVerdict.estimatedSavingsUsd, 2_800);
    });
  }
}

test("the two departments are answered with their own numbers, not each other's", () => {
  const backend = departmentViewModel(JULY, "backend");
  const quality = departmentViewModel(JULY, "quality");
  assert.notEqual(backend.spendMix.spendUsd, quality.spendMix.spendUsd);
  assert.notEqual(backend.peerPosition.percentile, quality.peerPosition.percentile);
  assert.notEqual(backend.trainingGap.score, quality.trainingGap.score);
});

test("the same department over two periods differs only where the record does", () => {
  const june = departmentViewModel(JUNE, "backend");
  const july = departmentViewModel(JULY, "backend");
  assert.notEqual(june.period, july.period);
  assert.equal(june.spendMix.spendUsd, 30_000);
  assert.equal(july.spendMix.spendUsd, 40_000);
  // The rubric did not move, so the score did not.
  assert.equal(june.trainingGap.score, july.trainingGap.score);
});

test("a view model is JSON, all the way down", () => {
  for (const slug of ["backend", "quality", "nope", "", null]) {
    const vm = departmentViewModel(JULY, slug);
    assert.deepEqual(JSON.parse(JSON.stringify(vm)), vm,
      `${String(slug)} round-trips through JSON unchanged`);
  }
});

test("an unresolved slug falls back to the org answer, with the reason attached", () => {
  const vm = departmentViewModel(JULY, "engineering");
  assert.equal(vm.scope, "organization");
  assert.equal(vm.resolved, false);
  assert.equal(vm.slug, null);
  assert.equal(vm.reasonCode, DEPARTMENT_RESOLUTION.unknown);
  assert.ok(vm.reason.includes("engineering"));
  assert.equal(vm.name, "Northwind Technology");
  for (const slot of SLOTS) {
    assert.ok(Object.hasOwn(vm[slot], "available"), `${slot} is present in the fallback too`);
  }
  // The org total is the sum, and no department's plan is promoted to be the
  // organization's.
  assert.equal(vm.spendMix.spendUsd, 40_000 + 16_000);
  assert.equal(vm.interventionVerdict.available, false);
  assert.equal(vm.interventionVerdict.title, null);
});

test("an unreadable record empties every slot instead of inventing one", () => {
  const vm = departmentViewModel({ departments: null }, "backend");
  assert.equal(vm.scope, "organization");
  assert.equal(vm.reasonCode, DEPARTMENT_RESOLUTION.unreadable);
  for (const slot of SLOTS) assert.equal(vm[slot].available, false);
  assert.deepEqual(JSON.parse(JSON.stringify(vm)), vm);
});

test("no visible sentence carries a code, a field path or a stack trace", () => {
  for (const slug of ["engineering", "", 42, null, "../../etc/passwd"]) {
    const { reason } = departmentViewModel(JULY, slug);
    assert.ok(reason.length > 0, "every fallback says why");
    assert.doesNotMatch(reason, /undefined|null|TypeError|record\.|reasonCode|_/,
      `"${reason}" is reader vocabulary`);
  }
});

// ---------------------------------------------------------------------------
// 4. The forwarded link, on the page
// ---------------------------------------------------------------------------

test("the parameter is read off the query and nobody else's is disturbed", () => {
  assert.equal(readForwardedDepartment("?department=quality"), "quality");
  assert.equal(readForwardedDepartment("department=quality&brief=abc"), "quality");
  assert.equal(readForwardedDepartment("?brief=abc&department=data-ml"), "data-ml");
  assert.equal(readForwardedDepartment("?department=on%20call"), "on call");
  // A broken escape is handed back as it arrived rather than losing the address.
  assert.equal(readForwardedDepartment("?department=%E0%A4%A"), "%E0%A4%A");
  assert.equal(readForwardedDepartment("?department="), "");
  assert.equal(readForwardedDepartment("?destination=spend-attribution"), undefined);
  assert.equal(readForwardedDepartment(""), undefined);
  assert.equal(readForwardedDepartment(undefined), undefined);
});

const openPage = () => parseHtml(html);
const note = (document) => document.getElementById(FORWARDED_DEPARTMENT_NOTE_ID);

test("a forwarded department opens, selects and focuses the decision region", () => {
  const document = openPage();
  const disclosure = document.getElementById("disclosure-department-priority");
  assert.ok(!disclosure.open, "the region ships collapsed");
  const applied = applyForwardedDepartment(document, { search: "?department=quality" });
  assert.equal(applied.viewModel.slug, "quality");
  assert.equal(applied.revealed, true);
  assert.equal(disclosure.getAttribute("open"), "");
  assert.equal(document.activeElement?.id, "department-decision-panel");
  assert.equal(document.getElementById("department-decision-panel")
    .getAttribute("data-forwarded-department"), "quality");
  assert.match(textOf(note(document)), /^Showing /);
});

test("the sentence lives inside the decision region, not beside it", () => {
  const document = openPage();
  applyForwardedDepartment(document, { search: "?department=quality" });
  // Walked rather than selected: the harness rejects descendant selectors, and
  // the point of the assertion is the parent chain anyway. A new TOP-LEVEL
  // region would have to be declared in the spine and the destination map.
  let parent = note(document).parentNode;
  const chain = [];
  while (parent && parent.nodeType === 1) {
    if (parent.id) chain.push(parent.id);
    parent = parent.parentNode;
  }
  assert.equal(chain[0], "department-decision-panel");
  assert.ok(chain.includes("disclosure-department-priority"),
    "the note is a child of an already-declared region");
  assert.ok(!chain.includes("main-content") || chain.indexOf("main-content") > 1,
    "the note is never a direct child of main");
});

test("an unrecognised department states the org answer and its reason, in copy", () => {
  const document = openPage();
  const applied = applyForwardedDepartment(document, { search: "?department=engineering" });
  assert.equal(applied.viewModel.scope, "organization");
  assert.equal(applied.pressed, false);
  const text = textOf(note(document));
  assert.match(text, /engineering/);
  assert.match(text, /whole organization’s answer/);
  assert.doesNotMatch(text, /Error|undefined|null|reasonCode/);
  assert.equal(note(document).getAttribute("data-department-resolution"), "unknown_department");
  // The reader is still put on the region, so the reason is where they landed.
  assert.equal(document.activeElement?.id, "department-decision-panel");
});

test("an empty or malformed department says so without naming a substitute", () => {
  for (const [search, code] of [
    ["?department=", "empty_department"],
    ["?department=%E0%A4%A", "unknown_department"],
    ["?department=../../etc/passwd", "unknown_department"],
  ]) {
    const document = openPage();
    const applied = applyForwardedDepartment(document, { search });
    assert.equal(applied.viewModel.slug, null, `${search} names no department`);
    assert.equal(note(document).getAttribute("data-department-resolution"), code);
    assert.equal(document.getElementById("department-decision-panel")
      .getAttribute("data-forwarded-department"), "");
  }
});

test("an address with no department parameter changes nothing", () => {
  const document = openPage();
  const applied = applyForwardedDepartment(document, { search: "?destination=spend-attribution" });
  assert.equal(applied.viewModel, null);
  assert.equal(applied.revealed, false);
  assert.equal(document.getElementById("disclosure-department-priority").hasAttribute("open"), false);
  // Nothing was created, so nothing has to be declared anywhere.
  assert.equal(document.querySelectorAll(`#${FORWARDED_DEPARTMENT_NOTE_ID}`).length, 0);
});

test("applying twice leaves one sentence and one note", () => {
  const document = openPage();
  applyForwardedDepartment(document, { search: "?department=quality" });
  applyForwardedDepartment(document, { search: "?department=quality", move: false });
  assert.equal(document.querySelectorAll(`#${FORWARDED_DEPARTMENT_NOTE_ID}`).length, 1);
  assert.match(textOf(note(document)), /^Showing /);
});
