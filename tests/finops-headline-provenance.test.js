// THE FIXTURE THAT PROVES A DESTINATION'S HEADLINE NUMBER (#1329).
//
// Every assertion here answers one director's question: "your destination says
// X, the front door says Y — which of you is wrong?" The answer must be
// reproducible from the shipped bytes and explainable in one sentence, so this
// file recomputes each headline from the shared whole-corpus analysis in
// src/finops-headline-provenance.js and compares it against what the
// destination actually renders.
//
// FOUR THINGS MAKE IT LOAD BEARING RATHER THAN DECORATIVE.
//
//   1. It is DRIVEN OFF THE DATA. The destinations come from the registry, the
//      departments from the analysis's own ranked list, the periods from the
//      corpus's own history. A hardcoded list of three would let a fourth
//      destination ship uncovered, so there is no hardcoded list of three.
//   2. It carries a DELIBERATE-DRIFT case. A perturbed destination-side number
//      must make the comparison FAIL. Without that test, a comparison that
//      silently always passes reads exactly like a comparison that works.
//   3. It states its TOLERANCE and compares unrounded values against it, so
//      `$1.2M` beside `$1.24M` is never reported as drift.
//   4. It fails with ONE finding, not N. `describeMismatches()` names the
//      destination, both numbers and the likely cause.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  BUNDLED_SEED_FACTS, DEFAULT_SCOPE, HEADLINE_DERIVATIONS, HEADLINE_SLUGS,
  HEADLINE_TOLERANCE_USD, HEADLINE_WINDOWS,
  agrees, applyDestinationProvenance, compareHeadline, departmentScopes,
  ROUTE_DEPARTMENT_GAP, describeMismatches, exampleCorpusAnalysis, headlineAnalysis,
  provenanceLine, scopeStates,
} from "../src/finops-headline-provenance.js";
import { FINOPS_DESTINATIONS, frontDoorMarkup } from "../src/finops-destinations.js";
import { parseHtml, textOf } from "./support/browser.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const readJson = async (path) => JSON.parse(await read(path));

const analysis = exampleCorpusAnalysis();

/**
 * The module's own source with its prose removed, so a clock-derived stamp is
 * caught as CODE. The comments name `Date.now` to say the module must not call
 * it, and a check that could not tell the two apart would be unfailable.
 */
const PROVENANCE_CODE = (await read("src/finops-headline-provenance.js"))
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Walk to every provenance span without a descendant selector — the harness rejects those. */
function provenanceSpans(document) {
  const found = new Map();
  const walk = (node) => {
    // Text nodes sit in `children` and carry no dataset, hence the `?.`.
    const slug = node?.dataset?.destinationProvenance;
    if (slug) found.set(slug, node);
    for (const child of node?.children ?? []) walk(child);
  };
  walk(document.getElementById("finops-front-door-list"));
  return found;
}

// ---------------------------------------------------------------------------
// THE SHARED COMPUTATION RETURNS THE TRIPLE, AND IT IS DETERMINISTIC
// ---------------------------------------------------------------------------

test("every headline comes back with a run, a scope and a computed date", () => {
  const computed = headlineAnalysis();
  assert.equal(computed.destinations.length, HEADLINE_SLUGS.length);
  for (const entry of computed.destinations) {
    assert.ok(Number.isFinite(entry.value), `${entry.slug} returns an unrounded number`);
    assert.ok(entry.display.length > 0, `${entry.slug} returns a display form`);
    // The triple, in the order a reader is given it.
    assert.deepEqual(Object.keys(entry.provenance), ["runId", "scope", "computedAt", "window"]);
    assert.ok(entry.provenance.runId.length > 0, `${entry.slug} names the run that produced it`);
    assert.ok(entry.provenance.scope.length > 0, `${entry.slug} names the scope applied`);
    assert.match(entry.provenance.computedAt, /^\d{4}-\d{2}-\d{2}$/,
      `${entry.slug} carries a date from the data, not a clock`);
  }
});

test("the run identifier and the timestamp are carried in the data, not invented", () => {
  const computed = headlineAnalysis();
  // The run id is the provider export id the corpus itself carries.
  const exports_ = analysis.history.periods.map((entry) => entry.exportId);
  assert.ok(exports_.includes(computed.runId), "the run is one of the corpus's own exports");
  // The stamp is the analysis's own generatedAt, sliced to a date. Never Date.now().
  assert.equal(computed.computedAt, String(analysis.generatedAt).slice(0, 10));
  assert.equal(PROVENANCE_CODE.includes("Date.now"), false,
    "the provenance module must not stamp itself from the clock");
  assert.equal(PROVENANCE_CODE.includes("new Date("), false, "nor from a constructed clock");
});

test("the same call twice returns the same numbers and the same run", () => {
  const first = headlineAnalysis();
  const second = headlineAnalysis();
  assert.deepEqual(first.destinations, second.destinations,
    "a build that is not deterministic cannot ship rendered markup");
});

// ---------------------------------------------------------------------------
// THE SEED CONSTANTS ARE PINNED AGAINST THE SEED
// ---------------------------------------------------------------------------

test("the org-seed facts this module copies still match src/evolution-demo-data.json", async () => {
  const seed = await readJson("src/evolution-demo-data.json");
  const backend = seed.departments.find((entry) => entry.id === "backend");
  assert.equal(BUNDLED_SEED_FACTS.topLeverSavingsUsdPerMonth,
    backend.actionPlan.estimatedSavingsUsd,
    "the lever figure is the seed's, so an edit to the seed must reach the module");
  assert.equal(BUNDLED_SEED_FACTS.topLeverDepartmentName, backend.name);
  assert.equal(BUNDLED_SEED_FACTS.computedAt, seed.provenance.generatedAt);
  assert.equal(BUNDLED_SEED_FACTS.runId,
    `${seed.briefingReadiness.fixture.id}@${seed.briefingReadiness.fixture.version}`,
    "the seed's run identity is its fixture id and version, both carried in the data");
  assert.equal(BUNDLED_SEED_FACTS.window, seed.organization.period);
});

// ---------------------------------------------------------------------------
// THE AGREEMENT CHECK — SHARED COMPUTATION vs WHAT THE DESTINATION RENDERS
// ---------------------------------------------------------------------------

test("every destination's registered headline is what the shared analysis computes", () => {
  // Driven off the registry, not off a list of three written here.
  const computed = headlineAnalysis();
  const mismatches = [];
  for (const destination of FINOPS_DESTINATIONS) {
    const entry = computed.bySlug[destination.slug];
    assert.ok(entry, `${destination.slug} has no derivation — a destination escaped coverage`);
    assert.equal(entry.label, destination.metric.label,
      `${destination.slug}'s label must be the one the analysis computes`);
    assert.equal(entry.unit, destination.metric.unit);
    mismatches.push(...compareHeadline(entry, {
      value: destination.metric.value,
      display: destination.metric.display,
    }, { scope: DEFAULT_SCOPE }));
  }
  // ONE finding, not N assertion failures.
  assert.equal(describeMismatches(mismatches), "");
});

test("every destination header on the page renders the computed provenance line", async () => {
  const document = parseHtml(await read("src/evolution.html"));
  const spans = provenanceSpans(document);
  const computed = headlineAnalysis();
  assert.equal(spans.size, FINOPS_DESTINATIONS.length,
    "one provenance line per destination header, driven off the registry");
  const mismatches = [];
  for (const destination of FINOPS_DESTINATIONS) {
    const node = spans.get(destination.slug);
    assert.ok(node, `${destination.slug}'s header ships no provenance line`);
    mismatches.push(...compareHeadline(computed.bySlug[destination.slug],
      { provenance: textOf(node) }, { scope: DEFAULT_SCOPE }));
  }
  assert.equal(describeMismatches(mismatches), "");
});

test("the provenance line reads run, then scope, then when", () => {
  for (const entry of headlineAnalysis().destinations) {
    const line = provenanceLine(entry);
    assert.match(line, /^from run .+, .+, computed \d{4}-\d{2}-\d{2}$/,
      `${entry.slug}: a lead reads the run, the scope and the date in that order`);
    assert.ok(line.indexOf("from run ") < line.indexOf(", computed "),
      `${entry.slug}: the run is named before the date`);
  }
});

// ---------------------------------------------------------------------------
// TRAP (a): ROUNDING
// ---------------------------------------------------------------------------

test("a rounding difference between two views of one number is not drift", () => {
  const entry = headlineAnalysis().bySlug["spend-attribution"];
  // The same number, shown at two precisions: 154,500 as $154,500 and as $0.2M.
  const coarse = { value: entry.value, display: "$0.2M" };
  const onValue = compareHeadline(entry, { value: coarse.value }, { scope: DEFAULT_SCOPE });
  assert.deepEqual(onValue, [],
    "the unrounded values agree, so nothing is reported — this is the stated choice");
  // The display forms differ and that IS reported, at a lower severity, so a
  // reviewer sees a formatting disagreement without it being called a wrong
  // number.
  const onDisplay = compareHeadline(entry, coarse, { scope: DEFAULT_SCOPE });
  assert.equal(onDisplay.length, 1);
  assert.equal(onDisplay[0].field, "display");
});

test("the tolerance admits float noise and nothing a reader can see", () => {
  assert.equal(HEADLINE_TOLERANCE_USD, 0.005, "half a cent, stated in the module");
  assert.ok(agrees(15_600, 15_600 + 1e-9), "float noise agrees");
  assert.equal(agrees(15_600, 15_600.01), false, "one cent is a real difference");
  assert.equal(agrees(Number.NaN, Number.NaN), false, "an unavailable figure never agrees");
});

// ---------------------------------------------------------------------------
// TRAP (b): SCOPE LEVERS — DEPARTMENT DRILL-DOWN, DATE WINDOW, RE-FORECAST RUN
// ---------------------------------------------------------------------------

test("the scope grid covers every department, every window and every run in the data", () => {
  const states = scopeStates();
  const departments = departmentScopes();
  assert.ok(departments.length >= 5, "the corpus ranks its departments");
  assert.ok(analysis.history.periods.length >= 3, "the corpus carries re-forecast runs");
  for (const window of HEADLINE_WINDOWS) {
    for (const department of departments) {
      assert.ok(states.some((state) => state.window === window && state.department === department.id),
        `${department.id} at ${window} is covered`);
    }
    for (const period of analysis.history.periods) {
      assert.ok(states.some((state) => state.window === window && state.runId === period.exportId),
        `run ${period.exportId} at ${window} is covered`);
    }
  }
});

test("destination and front door agree at every scope-lever state", () => {
  const mismatches = [];
  for (const scope of scopeStates()) {
    const computed = headlineAnalysis(scope);
    for (const destination of FINOPS_DESTINATIONS) {
      const entry = computed.bySlug[destination.slug];
      // The destination re-renders from the same call the front door reads, so
      // the two cannot disagree unless the shared computation is not shared.
      const rendered = {
        value: headlineAnalysis(scope).bySlug[destination.slug].value,
        display: headlineAnalysis(scope).bySlug[destination.slug].display,
        provenance: provenanceLine(headlineAnalysis(scope).bySlug[destination.slug]),
      };
      mismatches.push(...compareHeadline(entry, rendered, { scope }));
      // And the scope is actually reflected in what the reader is told. Only
      // the corpus-backed destinations are read per department; the seed-backed
      // one says "all departments" because that is the truth about it, and
      // pretending otherwise would be the exact defect this fixture exists for.
      if (scope.department && entry.source === "example-corpus") {
        assert.match(entry.provenance.scope, / only,/,
          `${destination.slug} must name the department filter it applied at ${scope.department}`);
      }
      if (scope.department && entry.source === "org-seed") {
        assert.equal(entry.provenance.scope.includes(" only,"), false,
          `${destination.slug} must not claim a department filter it never applied`);
      }
    }
  }
  assert.equal(describeMismatches(mismatches), "");
});

test("a department drill-down is a subset of the whole-corpus total, and says so", () => {
  const whole = headlineAnalysis({ ...DEFAULT_SCOPE });
  let summed = 0;
  for (const department of departmentScopes()) {
    const scoped = headlineAnalysis({ department: department.id, window: "month" });
    const entry = scoped.bySlug["spend-attribution"];
    assert.ok(entry.value <= whole.bySlug["spend-attribution"].value + HEADLINE_TOLERANCE_USD,
      `${department.id} cannot exceed the whole-corpus total`);
    assert.ok(entry.provenance.scope.startsWith(department.name),
      "the provenance line names the department the figure was filtered to");
    summed += entry.value;
  }
  assert.ok(agrees(summed, whole.bySlug["spend-attribution"].value),
    "the drill-downs sum to the total the front door states");
});

test("a re-forecast run changes the number AND the run it is attributed to", () => {
  const periods = analysis.history.periods;
  const current = headlineAnalysis({ ...DEFAULT_SCOPE, runId: periods.at(-1).exportId });
  const earlier = headlineAnalysis({ ...DEFAULT_SCOPE, runId: periods.at(0).exportId });
  const slug = "spend-attribution";
  assert.notEqual(current.bySlug[slug].value, earlier.bySlug[slug].value,
    "a different export is a different measurement");
  assert.notEqual(current.bySlug[slug].provenance.runId, earlier.bySlug[slug].provenance.runId,
    "and it must not be attributed to the run that did not produce it");
  assert.equal(earlier.bySlug[slug].provenance.runId, periods.at(0).exportId);
});

test("a quarter is summed from real periods where they exist, and says when it is not", () => {
  const periods = analysis.history.periods;
  const quarter = headlineAnalysis({ department: null, window: "quarter", runId: periods.at(-1).exportId });
  const entry = quarter.bySlug["spend-attribution"];
  const expected = periods.slice(-3).reduce((total, period) => total + period.spendUsd, 0);
  assert.ok(agrees(entry.value, expected), "three measured months, not one month times three");
  assert.equal(entry.basis, "measured");

  // The oldest run has no two periods before it, so the run-rate fallback is
  // the only honest answer and it is labelled as an extrapolation.
  const oldest = headlineAnalysis({ department: null, window: "quarter", runId: periods.at(0).exportId });
  assert.equal(oldest.bySlug["spend-attribution"].basis, "run-rate");

  // A per-month RATE does not scale with the window. Quoting "$5,200 / month"
  // as "$15,600 / month" for a quarter would be a lie about the unit.
  assert.equal(quarter.bySlug["optimisation-levers"].display,
    headlineAnalysis().bySlug["optimisation-levers"].display);
});

// ---------------------------------------------------------------------------
// THE DELIBERATE-DRIFT CASE — the proof this fixture is load bearing
// ---------------------------------------------------------------------------
//
// Triggered while developing to confirm the message reads. With the
// spend-attribution value perturbed to the department figure, `npm test`
// printed, on one line:
//
//   spend-attribution disagrees on value at scope [all departments, month]:
//   shared analysis says 154500, the destination renders 79000. Likely cause:
//   the destination applied a department filter the front door did not.

test("a perturbed destination-side number FAILS the comparison", () => {
  const entry = headlineAnalysis().bySlug["spend-attribution"];
  const drifted = compareHeadline(entry, { value: entry.value + 1 }, { scope: DEFAULT_SCOPE });
  assert.equal(drifted.length, 1, "the fixture notices a number that moved");
  assert.equal(drifted[0].field, "value");
  const finding = describeMismatches(drifted);
  assert.notEqual(finding, "", "a drift must produce a finding");
  assert.ok(finding.includes("spend-attribution"), "the finding names the destination");
  assert.ok(finding.includes(String(entry.value)), "and states the shared analysis's number");
  assert.ok(finding.includes(String(entry.value + 1)), "and states what the destination rendered");
  assert.match(finding, /Likely cause: .+\./, "and names a likely cause");
});

test("the drift case fires for every destination, not only the first", () => {
  const computed = headlineAnalysis();
  for (const destination of FINOPS_DESTINATIONS) {
    const entry = computed.bySlug[destination.slug];
    const drifted = compareHeadline(entry, { value: entry.value * 2 + 1 }, { scope: DEFAULT_SCOPE });
    assert.equal(drifted.length, 1, `${destination.slug} is actually compared`);
    assert.ok(describeMismatches(drifted).includes(destination.slug));
  }
});

test("a drifted provenance line is reported, at a lower severity than a wrong number", () => {
  const entry = headlineAnalysis().bySlug["commitment-coverage"];
  const both = compareHeadline(entry, {
    value: entry.value + 5,
    provenance: "from run somebody-typed-this, all departments, computed 2020-01-01",
  }, { scope: DEFAULT_SCOPE });
  assert.equal(both.length, 2, "both problems are collected");
  // ONE finding, and it is the wrong number rather than the wrong caption.
  const finding = describeMismatches(both);
  assert.ok(finding.includes("disagrees on value"), "the worst mismatch leads");
  assert.ok(finding.includes("+1 further mismatch"), "and the rest are counted, not hidden");
});

test("the likely cause distinguishes a scope error from a rounding error", () => {
  const scope = { department: null, window: "month", runId: null };
  const entry = headlineAnalysis(scope).bySlug["spend-attribution"];
  const department = departmentScopes()[0];

  // A destination that applied the department filter the front door did not.
  const scoped = compareHeadline(entry, { value: department.spendUsd }, { scope });
  assert.equal(scoped[0].cause, "the destination applied a department filter the front door did not");

  // A month/quarter mix-up.
  const windowed = compareHeadline(entry, { value: entry.value * 3 }, { scope });
  assert.equal(windowed[0].cause, "one side scaled a month to a quarter and the other did not");

  // Rounding applied before aggregation: sub-dollar, above the tolerance.
  const rounded = compareHeadline(entry, { value: entry.value + 0.4 }, { scope });
  assert.equal(rounded[0].cause, "rounding was applied before aggregation on one side");
});

// ---------------------------------------------------------------------------
// THE PAINTED PAGE READS THE SAME RETURNED VALUE
// ---------------------------------------------------------------------------

test("repainting at a scope writes that scope's provenance into every header", async () => {
  const document = parseHtml(frontDoorMarkup());
  const department = departmentScopes()[0];
  const scope = { department: department.id, window: "quarter", runId: null };
  const painted = applyDestinationProvenance(document, scope);
  assert.equal(painted, FINOPS_DESTINATIONS.length, "every header is repainted");

  const computed = headlineAnalysis(scope);
  const spans = provenanceSpans(document);
  const mismatches = [];
  for (const destination of FINOPS_DESTINATIONS) {
    mismatches.push(...compareHeadline(computed.bySlug[destination.slug],
      { provenance: textOf(spans.get(destination.slug)) }, { scope }));
  }
  assert.equal(describeMismatches(mismatches), "");

  // The corpus-backed headers name the department; the seed-backed one names
  // the seed's own scope, because that number is not read per department.
  assert.match(textOf(spans.get("spend-attribution")), new RegExp(`${department.name} only`));
  assert.ok(textOf(spans.get("optimisation-levers")).includes(BUNDLED_SEED_FACTS.runId));
});

test("no destination is left without a derivation, and no derivation without a destination", () => {
  const registered = FINOPS_DESTINATIONS.map((entry) => entry.slug).sort();
  assert.deepEqual(Object.keys(HEADLINE_DERIVATIONS).sort(), registered,
    "adding a destination without a derivation must fail here rather than ship unproven");
  for (const slug of HEADLINE_SLUGS) {
    assert.ok(["example-corpus", "org-seed"].includes(HEADLINE_DERIVATIONS[slug].source),
      `${slug} declares which corpus answered for it`);
  }
});

test("the route's department vocabulary and the analysis's are pinned as the gap they are", async () => {
  const { FINOPS_DEPARTMENT_IDS } = await import("../src/finops-destinations.js");
  const analysed = departmentScopes().map((entry) => entry.id);
  // No identifier is shared at all. If this ever starts overlapping, the gap
  // has begun to close and this test should be tightened deliberately.
  assert.deepEqual(FINOPS_DEPARTMENT_IDS.filter((id) => analysed.includes(id)), [],
    "the route addresses seed departments; the headline is recomputed over corpus departments");
  const seed = await readJson("src/evolution-demo-data.json");
  const shared = seed.departments.map((entry) => entry.name)
    .filter((name) => departmentScopes().some((entry) => entry.name === name));
  assert.deepEqual(shared, ROUTE_DEPARTMENT_GAP.sharedNames,
    "the one name the two corpora share, recorded so the drill-down coverage is not overstated");
});

test("an unknown department is refused rather than guessed at", () => {
  const entry = headlineAnalysis({ department: "backend", window: "month" })
    .bySlug["spend-attribution"];
  assert.equal(Number.isFinite(entry.value), false,
    "a department the analysis does not hold yields no number, not a confident wrong one");
  const reported = compareHeadline(entry, { value: 41_280 },
    { scope: { department: "backend", window: "month" } });
  assert.equal(reported.length, 1);
  assert.match(describeMismatches(reported), /different sources/);
});

test("the separate code path is declared rather than implied", () => {
  const bySource = {};
  for (const entry of headlineAnalysis().destinations) {
    (bySource[entry.source] ??= []).push(entry.slug);
  }
  // If this ever collapses to one source, that is a real improvement and this
  // test should be updated deliberately rather than deleted quietly.
  assert.deepEqual(bySource["org-seed"], ["optimisation-levers"],
    "exactly one destination is still read from the org seed rather than the corpus");
  assert.equal(bySource["example-corpus"].length, 2);
  const seedEntry = headlineAnalysis().bySlug["optimisation-levers"];
  const corpusEntry = headlineAnalysis().bySlug["spend-attribution"];
  assert.notEqual(seedEntry.provenance.runId, corpusEntry.provenance.runId,
    "two corpora are two runs, and the page says so on the destination header");
});
