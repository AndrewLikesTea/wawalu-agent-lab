// One computation behind every headline number on /evolution.html, and the
// provenance triple that says where each one came from.
//
// ---------------------------------------------------------------------------
// THE DISPUTE THIS EXISTS TO SETTLE
// ---------------------------------------------------------------------------
//
// #1325 gave the page a front door with three destinations, each carrying its
// own material metric. #1326 made a destination addressable. #1328 rendered one
// destination at a time. What none of them did was say WHERE a destination's
// number came from, and the numbers were frozen constants in the registry in
// src/finops-destinations.js. A director whose team the number grades has one
// reasonable question — "which run, over what scope, computed when?" — and
// before this module the honest answer was "a constant somebody typed".
//
// So every headline on this page is computed HERE, once, and returned with a
// provenance triple beside it. Two readers consume the same returned value: the
// destination header in src/evolution.html (through `frontDoorMarkup()`) and the
// fixture in tests/finops-headline-provenance.test.js. Nothing computes a
// display number in a template.
//
// ---------------------------------------------------------------------------
// WHERE THE NUMBERS ACTUALLY COME FROM — AND THEY DO NOT ALL COME FROM ONE PLACE
// ---------------------------------------------------------------------------
//
// Stated plainly rather than papered over, because a reader who finds this out
// from a disagreement instead of from a comment will not believe the next
// number either. This page carries TWO corpora:
//
//   THE EXAMPLE CORPUS — `loadExampleDataset()` in src/example-dataset.js. Six
//   monthly provider exports and one HRIS export, translated and analyzed by
//   the real parser and the real analyzer. This is the whole-corpus analysis:
//   `spendUsd` 154,500 over 2026-06-01 to 2026-07-01, five named departments,
//   six periods of history each with its own provider `exportId`. Two of the
//   three destinations are recomputed from it here.
//
//   THE ORG SEED — src/evolution-demo-data.json. Seven departments, a different
//   naming scheme (`backend`, `data-ml`, …) and a hand-authored action plan.
//   `optimisation-levers`' $5,200-a-month figure is that seed's
//   `departments[backend].actionPlan.estimatedSavingsUsd` and it is NOT in the
//   example corpus at all.
//
// The two do not agree and are not meant to: they describe different invented
// companies. That is a REAL separate code path and this module does not hide it
// — `source` on every entry says which corpus answered, the provenance line a
// reader sees names a different run for the seed-backed destination, and the
// fixture pins the seed constants below against the JSON so the duplication
// cannot drift silently. Collapsing the two into one corpus is a bigger change
// than proving a number, and it is not what #1329 asked for.
//
// The `?department=` vocabulary is the same split. src/destination-route.js
// accepts the SEED's seven ids; the whole-corpus analysis ranks the EXAMPLE
// corpus's five. `departmentScopes()` below is driven off the analysis, so the
// drill-downs the fixture covers are the ones the number can actually be
// recomputed for, and `ROUTE_DEPARTMENT_GAP` records the disagreement.
//
// ---------------------------------------------------------------------------
// THE THREE ASSUMPTIONS A READER WOULD OTHERWISE HAVE TO GUESS
// ---------------------------------------------------------------------------
//
// WHAT THE TIMESTAMP MEANS. `computedAt` is WHEN THE ANALYSIS RAN, not when the
// underlying usage was collected. For the example corpus it is
// `analysis.generatedAt` (2026-07-01T00:00:00Z) — the projection's own stamp,
// carried in the data, deterministic, and NEVER `Date.now()`: a build that
// stamps itself from the clock produces different bytes on every run and the
// byte-for-byte markup check in tests/finops-destinations.test.js would fail on
// a Tuesday. WHEN THE DATA WAS COLLECTED is a different fact and it is the
// `window` on the same triple: the reporting period 2026-06-01 to 2026-07-01.
// The two are one day apart here and would be weeks apart on real billing data,
// which is exactly why they are separate fields.
//
// WHAT COUNTS AS "THE SAME RUN". Two figures are from the same run when their
// `runId` strings are equal. For the example corpus a run is ONE PROVIDER EXPORT
// — `history.periods[].exportId` — because that is the identifier the data
// itself carries per period and the unit the analyzer re-reads. Two figures over
// the same period from the same export are the same run even if computed in
// different browser sessions; two figures over the same period from different
// exports are NOT, which is the case a re-forecast produces.
//
// WHAT THE TOLERANCE IS. See `HEADLINE_TOLERANCE_USD`.

import { loadExampleDataset } from "./example-dataset.js";

/**
 * The comparison tolerance, and the choice behind it.
 *
 * WE ASSERT ON THE UNROUNDED COMPUTED VALUE, with a half-cent absolute
 * tolerance, and compare display strings separately as strings.
 *
 * Why unrounded: the front door shows `$16k` for 15,600 and a destination shows
 * `$154,500` for the same corpus. Comparing display forms would report that as
 * drift, and a rounding difference between two views of the same number is a
 * LEGITIMATE disagreement — `$1.2M` beside `$1.24M` is one number shown at two
 * precisions, not two numbers.
 *
 * Why not zero: recoverable spend carries cents (35,074.20) and is reached by
 * summing floats, so two orderings of the same addition differ in the last bits.
 * Half a cent is below the smallest unit any of these figures is ever quoted in,
 * so nothing a reader can see hides inside it.
 *
 * Percentages use the same number because they are compared as percentage
 * POINTS and every share here is quoted to whole points.
 */
export const HEADLINE_TOLERANCE_USD = 0.005;

/** Absolute agreement, at the stated tolerance. */
export const agrees = (left, right) =>
  Number.isFinite(left) && Number.isFinite(right)
  && Math.abs(left - right) <= HEADLINE_TOLERANCE_USD;

/**
 * The facts this module reads out of src/evolution-demo-data.json.
 *
 * Copied rather than imported so the front door does not pull a 100 KiB seed
 * document into a markup function, and pinned field by field against the real
 * JSON in tests/finops-headline-provenance.test.js — an edit to the seed that
 * does not reach here is a failing test, not a silent disagreement.
 *
 * `runId` is the seed's own fixture identity (`briefingReadiness.fixture.id`
 * and `.version`); `computedAt` is `provenance.generatedAt`. Both are carried in
 * the data and both are deterministic.
 */
export const BUNDLED_SEED_FACTS = Object.freeze({
  runId: "evolution-demo-data@2026-07-25.1",
  computedAt: "2026-07-25",
  window: "25 Jun – 25 Jul 2026",
  // departments[id=backend].actionPlan.estimatedSavingsUsd
  topLeverSavingsUsdPerMonth: 5_200,
  topLeverDepartmentName: "Atlas Platform",
});

/** The date windows a headline may be read over. The page has exactly two. */
export const HEADLINE_WINDOWS = Object.freeze(["month", "quarter"]);

/** Months in each window, used only where a run-rate fallback is unavoidable. */
const WINDOW_MONTHS = Object.freeze({ month: 1, quarter: 3 });

/**
 * How a metric responds to the date-window lever, declared per destination
 * rather than inferred from its unit.
 *
 * `flow`  — an amount accumulated over the window. A quarter is the SUM OF THE
 *           LAST THREE REAL PERIODS when history carries them, and only falls
 *           back to three times the month when it does not. Summing real periods
 *           rather than multiplying is the difference between a measurement and
 *           an extrapolation, and `basis` on the result says which one happened.
 * `rate`  — a per-month rate. A rate does not scale with the window; quoting
 *           "$5,200 / month" as "$15,600 / month" for a quarter would be a lie
 *           about the unit.
 * `share` — a ratio. Also does not scale.
 */
const METRIC_KIND = Object.freeze({ flow: "flow", rate: "rate", share: "share" });

const round2 = (value) => Math.round(value * 100) / 100;

const usd = (value) => `$${Math.round(value).toLocaleString("en-US")}`;

/** The example corpus, analyzed once. Deterministic, so caching it is safe. */
let cachedCorpus = null;
export const exampleCorpusAnalysis = () => (cachedCorpus ??= loadExampleDataset());

/** Only for tests that need to prove the cache is not the thing under test. */
export const resetCorpusCache = () => { cachedCorpus = null; };

/** The periods the corpus carries, oldest first, each one a run. */
const periodsOf = (analysis) => (Array.isArray(analysis?.history?.periods)
  ? analysis.history.periods : []);

/** The period a scope selects: the named `runId`, or the reporting period. */
function periodFor(analysis, runId) {
  const periods = periodsOf(analysis);
  if (runId) return periods.find((entry) => entry.exportId === runId) ?? null;
  return periods.at(-1) ?? null;
}

/**
 * Every department the whole-corpus analysis can be drilled into, driven off
 * the analysis rather than listed here. A department added to the corpus is
 * covered by the fixture the moment it appears; a hardcoded list of five would
 * let the sixth escape.
 */
export const departmentScopes = (analysis = exampleCorpusAnalysis()) =>
  Object.freeze((analysis?.rankedDepartments ?? []).map((entry) => Object.freeze({
    id: entry.id, name: entry.name, spendUsd: entry.spendUsd,
  })));

/**
 * The department vocabularies that do not line up, recorded rather than fixed.
 *
 * `?department=` on a destination address is validated against the ORG SEED's
 * seven identifiers (src/destination-route.js reads `FINOPS_DEPARTMENT_IDS`).
 * The whole-corpus analysis ranks the EXAMPLE corpus's five, under different
 * identifiers and — with one exception — different names. So a route-carried
 * department cannot currently be resolved to a recomputable headline, and this
 * module refuses to guess: `headlineAnalysis()` only accepts a department the
 * analysis actually holds.
 *
 * Reconciling the two corpora is a larger change than proving a number and is
 * deliberately not in #1329. What is in scope is saying so out loud, here and
 * in the fixture, so nobody reads the drill-down coverage as wider than it is.
 */
export const ROUTE_DEPARTMENT_GAP = Object.freeze({
  routeVocabulary: "src/finops-destinations.js FINOPS_DEPARTMENT_IDS (the org seed)",
  analysisVocabulary: "loadExampleDataset().rankedDepartments (the example corpus)",
  sharedNames: Object.freeze(["Atlas Platform"]),
});

/**
 * The full scope-lever grid: every combination the fixture parametrises over.
 *
 * Driven off the analysis and off `HEADLINE_WINDOWS`, so a new department, a new
 * period or a third window widens coverage automatically.
 *
 * DEPARTMENT × NON-CURRENT PERIOD IS DELIBERATELY ABSENT. The corpus carries
 * per-department figures for the reporting period only; history is
 * organization-wide. Emitting those combinations would mean inventing a
 * department split for a past export, which is the kind of quiet extrapolation
 * this module exists to make impossible.
 */
export function scopeStates(analysis = exampleCorpusAnalysis()) {
  const periods = periodsOf(analysis);
  const current = periods.at(-1)?.exportId ?? null;
  const states = [];
  for (const window of HEADLINE_WINDOWS) {
    for (const period of periods) {
      states.push({ department: null, window, runId: period.exportId });
    }
    for (const department of departmentScopes(analysis)) {
      states.push({ department: department.id, window, runId: current });
    }
  }
  return Object.freeze(states.map((state) => Object.freeze(state)));
}

/** The default scope: every department, one month, the reporting period. */
export const DEFAULT_SCOPE = Object.freeze({ department: null, window: "month", runId: null });

const normalizeScope = (scope) => Object.freeze({
  department: scope?.department ?? null,
  window: HEADLINE_WINDOWS.includes(scope?.window) ? scope.window : "month",
  runId: scope?.runId ?? null,
});

/**
 * The scope, in the words a non-technical lead reads: the department filter,
 * then the date window it was read over.
 */
function scopeLabel(scope, analysis, period) {
  const named = (departmentScopes(analysis).find((entry) => entry.id === scope.department));
  const who = scope.department
    ? `${named?.name ?? scope.department} only`
    : "all departments";
  const when = scope.window === "quarter"
    ? `the quarter ending ${String(period?.period ?? "").split(" to ").at(-1) || "the reporting period"}`
    : `${period?.period ?? "the reporting period"}`;
  return `${who}, ${when}`;
}

/**
 * Sum a flow metric over the window.
 *
 * Returns the value and the BASIS that produced it, because "three real months
 * added up" and "one month times three" are different claims and a reader who
 * is told the second is a measurement has been misled.
 */
function overWindow(monthly, window, analysis, period, pick) {
  if (window !== "quarter") return { value: monthly, basis: "measured" };
  const periods = periodsOf(analysis);
  const at = periods.findIndex((entry) => entry.exportId === period?.exportId);
  const slice = at >= 2 ? periods.slice(at - 2, at + 1) : [];
  if (slice.length === 3 && pick) {
    return { value: round2(slice.reduce((total, entry) => total + pick(entry), 0)), basis: "measured" };
  }
  return { value: round2(monthly * WINDOW_MONTHS.quarter), basis: "run-rate" };
}

/**
 * The one place a destination's headline metric is defined.
 *
 * Each entry states its corpus (`source`), how the window applies (`kind`), and
 * the arithmetic. Keyed by the registry's slug so the two cannot be joined by
 * position, and exported so the fixture drives itself off this list rather than
 * off a copy of it.
 */
export const HEADLINE_DERIVATIONS = Object.freeze({
  "spend-attribution": Object.freeze({
    slug: "spend-attribution",
    source: "example-corpus",
    kind: METRIC_KIND.flow,
    unit: "USD",
    label: "Analyzed AI spend in the reporting month",
    /**
     * Total analyzed spend, or one department's share of it. The department
     * branch reads the analyzer's own ranked figure rather than re-summing the
     * records, so the drill-down and the total are the same arithmetic.
     */
    compute(analysis, scope, period) {
      if (scope.department) {
        const found = (analysis?.rankedDepartments ?? [])
          .find((entry) => entry.id === scope.department);
        const monthly = Number(found?.spendUsd ?? Number.NaN);
        const { value, basis } = overWindow(monthly, scope.window, analysis, period, null);
        return { value, basis, display: usd(value) };
      }
      const monthly = Number(period?.spendUsd ?? analysis?.spendUsd ?? Number.NaN);
      const { value, basis } = overWindow(
        monthly, scope.window, analysis, period, (entry) => Number(entry.spendUsd));
      return { value, basis, display: usd(value) };
    },
  }),
  "optimisation-levers": Object.freeze({
    slug: "optimisation-levers",
    // THE SEPARATE CODE PATH, named. This figure is the org seed's, not the
    // example corpus's, so its provenance triple names the seed's run and the
    // seed's date — a reader comparing it with the destination above will see
    // two different runs, which is the truth.
    source: "org-seed",
    kind: METRIC_KIND.rate,
    unit: "USD per month",
    label: "Monthly saving from the highest-ranked lever",
    compute(_analysis, _scope, _period, seed = BUNDLED_SEED_FACTS) {
      const value = Number(seed.topLeverSavingsUsdPerMonth);
      // A rate is per month at every window; only the front door's own
      // quarter figure multiplies it, and it says so where it does.
      return { value, basis: "measured", display: `${usd(value)} / month` };
    },
  }),
  "commitment-coverage": Object.freeze({
    slug: "commitment-coverage",
    source: "example-corpus",
    kind: METRIC_KIND.share,
    unit: "percent",
    label: "Share of the quarter's analyzed spend priced at published list rates",
    /**
     * The share of analyzed spend that no declared contracted rate covers.
     *
     * ASSUMPTION, stated because a reader would otherwise have to guess: spend
     * is "priced at list" unless the corpus declares a contracted rate for it.
     * The example corpus declares none — `contractedSpendUsd` is absent on
     * every department — so the honest answer is 100%, and it becomes a smaller
     * number the moment a rate is declared rather than staying pinned by a
     * constant. A corpus with no spend at all has no share to report, and this
     * returns NaN rather than a confident 100%.
     */
    compute(analysis, scope, period) {
      const departments = analysis?.rankedDepartments ?? [];
      const scoped = scope.department
        ? departments.filter((entry) => entry.id === scope.department)
        : departments;
      const total = scoped.reduce((sum, entry) => sum + Number(entry.spendUsd ?? 0), 0);
      const contracted = scoped.reduce(
        (sum, entry) => sum + Number(entry.contractedSpendUsd ?? 0), 0);
      if (!(total > 0)) return { value: Number.NaN, basis: "unavailable", display: "Unavailable" };
      const value = round2(((total - contracted) / total) * 100);
      return { value, basis: "measured", display: `${Math.round(value)}%` };
    },
  }),
});

/** The slugs this module can recompute, in registry order. */
export const HEADLINE_SLUGS = Object.freeze(Object.keys(HEADLINE_DERIVATIONS));

/**
 * The whole-corpus analysis, with a provenance triple beside every destination's
 * headline metric. THIS IS THE ONE RETURNED VALUE both the destination header
 * and the fixture read.
 *
 * The triple, in the order a reader gets it: `runId` (which run produced it),
 * `scope` (which lever state was applied) and `computedAt` (when the run was
 * computed). `window` rides beside them because when the DATA WAS COLLECTED is a
 * different fact from when the ANALYSIS RAN and conflating the two is how a
 * "stale" argument starts.
 */
export function headlineAnalysis(scope = DEFAULT_SCOPE, {
  analysis = exampleCorpusAnalysis(), seed = BUNDLED_SEED_FACTS,
} = {}) {
  const applied = normalizeScope(scope);
  const period = periodFor(analysis, applied.runId);
  const label = scopeLabel(applied, analysis, period);
  const destinations = HEADLINE_SLUGS.map((slug) => {
    const derivation = HEADLINE_DERIVATIONS[slug];
    const computed = derivation.compute(analysis, applied, period, seed);
    const fromSeed = derivation.source === "org-seed";
    return Object.freeze({
      slug,
      label: derivation.label,
      unit: derivation.unit,
      kind: derivation.kind,
      source: derivation.source,
      // The unrounded computed value. Everything compares on this.
      value: computed.value,
      // The rounded string a reader sees. Compared as a string, never as a
      // number, so precision differences never read as drift.
      display: computed.display,
      basis: computed.basis,
      provenance: Object.freeze({
        runId: fromSeed ? seed.runId : (period?.exportId ?? "unidentified-run"),
        scope: fromSeed ? `all departments, ${seed.window}` : label,
        computedAt: fromSeed ? seed.computedAt : String(analysis?.generatedAt ?? "").slice(0, 10),
        window: fromSeed ? seed.window : (period?.period ?? null),
      }),
    });
  });
  return Object.freeze({
    scope: applied,
    scopeLabel: label,
    runId: period?.exportId ?? null,
    computedAt: String(analysis?.generatedAt ?? "").slice(0, 10),
    window: period?.period ?? null,
    totalSpendUsd: Number(period?.spendUsd ?? analysis?.spendUsd ?? Number.NaN),
    destinations: Object.freeze(destinations),
    bySlug: Object.freeze(Object.fromEntries(destinations.map((entry) => [entry.slug, entry]))),
  });
}

/**
 * The provenance triple as one plain sentence: run, then scope, then when — in
 * that order, because that is the order the question is asked in.
 *
 * No markup and no control: this is static text inside the destination header,
 * so it costs no tab stop on a first screen that has none to spare.
 */
export const provenanceLine = (entry) =>
  `from run ${entry.provenance.runId}, ${entry.provenance.scope}, computed ${entry.provenance.computedAt}`;

/** The provenance sentence for one slug at one scope. */
export function destinationProvenanceText(slug, scope = DEFAULT_SCOPE, options = {}) {
  const entry = headlineAnalysis(scope, options).bySlug[slug];
  return entry ? provenanceLine(entry) : "";
}

// ---------------------------------------------------------------------------
// DISAGREEMENT REPORTING
// ---------------------------------------------------------------------------
//
// A fixture that fires N assertions produces N equal-weight failures and a
// reader who has to rank them. This produces ONE finding: the worst mismatch,
// named, with both numbers and the likeliest cause. Callers assert once against
// `describeMismatches()`.

/** Ordered worst first. A wrong number outranks a wrong label. */
const SEVERITY = Object.freeze({ value: 3, display: 2, provenance: 1 });

/**
 * Why two numbers for one destination usually differ, in the order a reviewer
 * should check. Each rule is a predicate over the pair, so the finding names a
 * cause rather than restating the numbers.
 */
function likelyCause(mismatch) {
  const { expected, actual, slug, kind, scope } = mismatch;
  if (Number.isFinite(expected) && Number.isFinite(actual)) {
    // Checked before anything else, because these two are the SPECIFIC answers:
    // the rendered number is exactly what the shared computation returns at a
    // neighbouring lever state, which names the lever that was misapplied.
    if (agrees(actual, mismatch.otherWindowExpected)) {
      return "one side read the other date window and the other did not";
    }
    if (scope?.department && agrees(actual, mismatch.unscopedExpected)) {
      return "the destination applied no department filter while the front door did";
    }
    const ratio = expected === 0 ? Number.NaN : actual / expected;
    if (agrees(ratio, 3) || agrees(ratio, 1 / 3)) {
      return "one side scaled a month to a quarter and the other did not";
    }
    if (!scope?.department && actual < expected && kind !== "share") {
      return "the destination applied a department filter the front door did not";
    }
    if (Math.abs(expected - actual) < 1 && kind !== "share") {
      return "rounding was applied before aggregation on one side";
    }
  }
  return `the two sides read different sources for ${slug}`;
}

/**
 * Compare what the shared computation says against what a destination renders.
 *
 * `rendered` is `{ value, display, provenance }` read off the page or off the
 * registry. Anything absent is skipped rather than reported as zero: a missing
 * field is a coverage gap and `missing` names it.
 */
export function compareHeadline(entry, rendered, { scope = DEFAULT_SCOPE, options = {} } = {}) {
  const found = [];
  // What this destination's headline would be at each NEIGHBOURING lever state,
  // computed here rather than asked of the caller: the whole point of a
  // one-finding report is that a reader does not have to work out which lever
  // moved, and a caller who already knew would not need the report.
  const at = (next) => {
    try { return headlineAnalysis(next, options).bySlug[entry.slug]?.value ?? Number.NaN; }
    catch { return Number.NaN; }
  };
  const base = {
    slug: entry.slug, kind: entry.kind, scope, label: entry.label,
    unscopedExpected: scope?.department ? at({ ...scope, department: null }) : Number.NaN,
    otherWindowExpected: at({ ...scope, window: scope?.window === "quarter" ? "month" : "quarter" }),
  };
  if (rendered?.value !== undefined && rendered?.value !== null
    && !agrees(entry.value, Number(rendered.value))) {
    found.push({
      ...base, field: "value", severity: SEVERITY.value,
      expected: entry.value, actual: Number(rendered.value),
    });
  }
  if (typeof rendered?.display === "string" && rendered.display !== entry.display) {
    found.push({
      ...base, field: "display", severity: SEVERITY.display,
      expected: entry.display, actual: rendered.display,
    });
  }
  if (typeof rendered?.provenance === "string" && rendered.provenance !== provenanceLine(entry)) {
    found.push({
      ...base, field: "provenance", severity: SEVERITY.provenance,
      expected: provenanceLine(entry), actual: rendered.provenance,
    });
  }
  return found.map((mismatch) => Object.freeze({ ...mismatch, cause: likelyCause(mismatch) }));
}

/**
 * ONE finding from however many mismatches were collected: the highest-severity
 * one described in full, with a count of the rest so nothing is hidden.
 *
 * Returns "" when there is nothing to report, so a caller can
 * `assert.equal(describeMismatches(all), "")` and get a readable failure.
 */
export function describeMismatches(mismatches) {
  if (!mismatches?.length) return "";
  const worst = [...mismatches].sort((a, b) => (b.severity - a.severity)
    || String(a.slug).localeCompare(String(b.slug)))[0];
  const where = worst.scope?.department
    ? `department ${worst.scope.department}` : "all departments";
  const rest = mismatches.length > 1
    ? ` (+${mismatches.length - 1} further mismatch${mismatches.length > 2 ? "es" : ""})` : "";
  return `${worst.slug} disagrees on ${worst.field} at scope [${where}, ${worst.scope?.window ?? "month"}`
    + `${worst.scope?.runId ? `, run ${worst.scope.runId}` : ""}]: `
    + `shared analysis says ${worst.expected}, the destination renders ${worst.actual}. `
    + `Likely cause: ${likelyCause(worst)}.${rest}`;
}

/**
 * Repaint each destination header's provenance line from the shared computation.
 *
 * The document already ships these sentences — `frontDoorMarkup()` renders them
 * and tests/finops-destinations.test.js compares the two byte for byte — so on
 * an ordinary open this changes nothing. It is what makes the header read FROM
 * the analysis when a scope lever moves, and it never throws on a page that does
 * not carry the region.
 */
export function applyDestinationProvenance(document, scope = DEFAULT_SCOPE, options = {}) {
  const computed = headlineAnalysis(scope, options);
  let painted = 0;
  const list = document?.getElementById?.("finops-front-door-list");
  for (const node of [...(list?.querySelectorAll?.("[data-destination-provenance]") ?? [])]) {
    const entry = computed.bySlug[node.dataset?.destinationProvenance];
    if (!entry) continue;
    node.textContent = provenanceLine(entry);
    painted += 1;
  }
  return painted;
}
