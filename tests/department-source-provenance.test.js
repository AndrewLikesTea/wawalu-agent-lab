// The per-department source projection, and the screen that renders it.
//
// The projection half runs over committed synthetic declarations; the render
// half runs through the shipped page, its entry module and its view, because a
// projection nothing paints is not a provenance line a director can read.
//
// The harness models no layout and reads straight through a shut disclosure, so
// every claim about the incomplete case is asserted on the at-a-glance line
// OUTSIDE the disclosure — which is the property the issue is about, not a
// concession to the harness.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPage, textOf } from "./support/browser.js";
import { importPageModule } from "./support/page-module.js";
import {
  SOURCE_ABSENCE, SOURCE_COMPLETENESS, SOURCE_NAME, departmentSourceProvenance,
} from "../src/department-source-provenance.js";
import { departmentScreenModel } from "../src/department-screen.js";

const PAGE = new URL("../src/departments.html", import.meta.url);
const DATA_URL = "/evolution-demo-data.json";
const dataset = JSON.parse(await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const fixtures = JSON.parse(await readFile(
  new URL("./fixtures/department-source-declarations.json", import.meta.url), "utf8"));

const projectionFor = (document, departmentId, now = null) => departmentSourceProvenance({
  organization: document.organization,
  provenance: document.provenance,
  departments: document.departments,
  departmentId,
  now,
});

const shown = (document, id) => textOf(document.getElementById(id));

async function open(search, routes) {
  const page = await loadPage(PAGE, { routes: { [DATA_URL]: routes ?? dataset }, location: { search } });
  const module = await importPageModule("/department-screen-page.js");
  return { ...page, module };
}

/* ------------------------------- the projection ---------------------------- */

test("a department both declarations cover reports every field and no absence", () => {
  const projection = projectionFor(fixtures.declared, "platform", "2026-07-18");

  assert.equal(projection.status, SOURCE_COMPLETENESS.complete);
  assert.equal(projection.reason, null);
  assert.equal(projection.providerExport,
    "hand-authored provider aggregate fixture (OpenAI, Anthropic)");
  assert.equal(projection.hrisSource, "Workday · synthetic sync");
  assert.equal(projection.period, "2026-06");
  // Freshness is the declaration's own day, expressed against the date the
  // caller supplied. Nothing here reads a clock: the same input is the same
  // sentence on every run.
  assert.equal(projection.asOf, "2026-07-01");
  assert.equal(projection.freshness,
    "as of 2026-07-01, 17 days before the date this screen was read for");
  assert.deepEqual(projection.absent, []);
  assert.match(projection.line, /Both declared sources cover this department/);
  assert.deepEqual(projection.rows.map((row) => row.term),
    ["Provider export", "HRIS headcount source", "Period covered", "Freshness"]);
});

test("with no date supplied, freshness states the day and claims no distance from it", () => {
  const projection = projectionFor(fixtures.declared, "platform");
  assert.equal(projection.freshness, "as of 2026-07-01");
  assert.equal(projection.status, SOURCE_COMPLETENESS.complete);
});

test("a department the HRIS mapping does not carry is partial, and names what is absent", () => {
  const projection = projectionFor(fixtures.declared, "contractors", "2026-07-01");

  assert.equal(projection.status, SOURCE_COMPLETENESS.partial);
  assert.equal(projection.reason, SOURCE_ABSENCE.noHris);
  assert.equal(projection.providerExport,
    "hand-authored provider aggregate fixture (OpenAI, Anthropic)");
  assert.equal(projection.hrisSource, null, "an absent source was reported as present");
  assert.deepEqual(projection.absent, [SOURCE_NAME.hris]);
  // The named absent source, and what the figure rests on instead.
  assert.match(projection.line, /no HRIS headcount source is declared/);
  assert.match(projection.line, /rests on hand-authored provider aggregate fixture .+ alone/);
  assert.doesNotMatch(projection.line, /Both declared sources/);
  assert.match(projection.rows[1].detail, /^None\. No HRIS headcount source is declared/);
});

test("a document declaring neither source states so rather than assuming one", () => {
  const projection = projectionFor(fixtures.undeclared, "platform", "2026-07-01");

  assert.equal(projection.status, SOURCE_COMPLETENESS.unavailable);
  assert.equal(projection.reason, SOURCE_ABSENCE.noneDeclared);
  assert.equal(projection.providerExport, null);
  assert.equal(projection.hrisSource, null);
  assert.deepEqual(projection.absent, [SOURCE_NAME.provider, SOURCE_NAME.hris]);
  assert.match(projection.line, /Neither a provider usage and billing export nor an HRIS/);
});

test("an unknown department, an empty block and a malformed one each answer without throwing", () => {
  const unknown = projectionFor(fixtures.declared, "marketing", "2026-07-01");
  assert.equal(unknown.status, SOURCE_COMPLETENESS.unavailable);
  assert.equal(unknown.reason, SOURCE_ABSENCE.unknownDepartment);
  assert.equal(unknown.providerExport, null);
  assert.match(unknown.line, /holds no department under the name in this link/);
  // The address bar's own text is never quoted back into a sentence.
  const hostile = projectionFor(fixtures.declared, "<script>alert(1)</script>", null);
  assert.doesNotMatch(hostile.line, /script|alert/);

  for (const input of [undefined, {}, { departments: "not a list" },
    { organization: { hrisSource: 12 }, provenance: { billingSource: [] },
      departments: [{ id: "platform", spendUsd: "many", headcount: null }], departmentId: "platform" }]) {
    const projection = departmentSourceProvenance(input);
    assert.notEqual(projection.status, SOURCE_COMPLETENESS.complete,
      "a malformed declaration block was reported as a complete basis");
    assert.equal(projection.providerExport, null);
    assert.equal(projection.hrisSource, null);
  }
  const noDay = departmentSourceProvenance({ ...fixtures.declared, departmentId: "platform",
    provenance: { billingSource: "an export", generatedAt: "2026-02-30" } });
  assert.equal(noDay.asOf, null, "a day that does not exist became a freshness claim");
  assert.equal(noDay.freshness, "as of an unrecorded date");
});

/* -------------------------------- the screen ------------------------------- */

test("the screen states the basis beside the figure, with the detail behind a disclosure", async () => {
  const page = await open("?department=quality");
  try {
    await page.module.ready;
    const { document } = page;

    // At a glance, outside every disclosure, beside the recoverable figure.
    const line = shown(document, "department-sources-line");
    assert.match(line, /^Sources: hand-authored provider aggregate fixture/);
    assert.match(line, /Workday · demo sync/);
    assert.match(line, /as of 2026-07-25/);
    assert.match(line, /Both declared sources cover this department/);
    for (let node = document.getElementById("department-sources-line").parentNode; node; node = node.parentNode) {
      assert.notEqual(node.tagName, "DETAILS", "the at-a-glance basis is folded inside a disclosure");
    }

    // The per-source detail, shut on arrival like every other reading here.
    const disclosure = document.getElementById("department-sources");
    assert.equal(disclosure.tagName, "DETAILS");
    assert.ok(!disclosure.open, "the source detail is open on arrival");
    assert.match(shown(document, "department-sources-provider"), /^hand-authored provider aggregate fixture \(OpenAI/);
    assert.equal(shown(document, "department-sources-hris"), "Workday · demo sync");
    assert.match(shown(document, "department-sources-period"), /^25 Jun\s*–\s*25 Jul 2026$/);
    assert.match(shown(document, "department-sources-freshness"), /^As of 2026-07-25/);
  } finally {
    page.restore();
  }
});

test("an incomplete basis names the absent source in the line, not only in the disclosure", async () => {
  // The same bundled analysis with one department's HRIS headcount withheld —
  // the partial case a real export produces when a unit is missing from the
  // org mapping.
  const partial = structuredClone(dataset);
  delete partial.departments.find((entry) => entry.id === "quality").headcount;

  const page = await open("?department=quality", partial);
  try {
    await page.module.ready;
    const { document } = page;

    const line = shown(document, "department-sources-line");
    assert.match(line, /no HRIS headcount source is declared for this department/);
    assert.match(line, /alone/);
    assert.doesNotMatch(line, /Both declared sources/,
      "an incomplete basis was presented as complete");
    // The figure itself is still stated: an absent source withholds the claim
    // about people, not the money the provider export does carry.
    assert.equal(shown(document, "department-metric-value"), "$4,530");
    assert.match(shown(document, "department-sources-hris"), /^None\./);
  } finally {
    page.restore();
  }
});

test("an unavailable screen carries no earlier department's declared sources", () => {
  const resolved = departmentScreenModel({
    departments: dataset.departments, benchmark: dataset.benchmark,
    organization: dataset.organization, provenance: dataset.provenance, slug: "quality",
  });
  assert.equal(resolved.sources.status, SOURCE_COMPLETENESS.complete);
  const unknown = departmentScreenModel({
    departments: dataset.departments, benchmark: dataset.benchmark,
    organization: dataset.organization, provenance: dataset.provenance, slug: "marketing",
  });
  assert.equal(unknown.sources, null, "an unresolved screen kept a source projection");
});
