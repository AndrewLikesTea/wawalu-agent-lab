// Regression coverage for executive briefing-ready records.
//
// Noor's suite proves the contract builds its own canonical sample. This one
// asks the question a director asks when the number grades their team: is this
// figure reproducible from the same local derived records, and is every claim
// beside it — the confidence, the provenance, the limitation, the recommended
// action — consistent with the same records and with each other?
//
// The labelled cases live in `tests/support/executive-briefing-cases.js`, one
// per state a presentation consumer renders differently: eligible and ineligible
// grades, low-confidence findings, all three unavailable-benchmark reasons, and
// two kinds of tie — a tied period selection and a tied action ranking.
//
// HOW TO RUN
// ----------
//   node --test tests/executive-briefing-fixtures.test.js   # this file
//   npm test                                                 # the whole suite
//   npm run check                                            # tests + build + verify
//
// Every expected number is a literal in the case file. A number that changes
// here is a contract change, and it fails a test rather than quietly restating
// itself in a briefing an executive already read.

import assert from "node:assert/strict";
import test from "node:test";

import {
  BENCHMARK_MATERIAL_VARIANCE_PPM, BENCHMARK_STANDING, CONFIDENCE_LADDER, CONFIDENCE_MEANING,
  EXECUTIVE_ABSENCE_STATEMENT, FORBIDDEN_LINK_PATTERN, FULL_COVERAGE_PPM, LIMITATION,
  LIMITATION_STATEMENT, NEXT_ACTION, buildExecutiveBriefing, recoverableSharePpm,
  validateExecutiveBriefing,
} from "../src/executive-finops-briefing.js";
import { FINOPS_PERIOD_FIELDS } from "../src/finops-workspace-contract.js";
import { scanRetainedContent } from "../src/finops-workspace.js";
import {
  ALWAYS_ON_LIMITATIONS, EXECUTIVE_BRIEFING_CASES, briefingClaims, gaplessHistory, retained,
} from "./support/executive-briefing-cases.js";

const caseById = (id) => {
  const found = EXECUTIVE_BRIEFING_CASES.find((entry) => entry.id === id);
  assert.ok(found, `no labelled case named ${id}`);
  return found;
};

/** Every ordering of a small array, so "input order cannot matter" is not one sample. */
function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) => permutations(
    [...items.slice(0, index), ...items.slice(index + 1)],
  ).map((rest) => [item, ...rest]));
}

/** Every leaf string in a value, with the path it sits at. */
function leafStrings(value, path = "", found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => leafStrings(item, `${path}[${index}]`, found));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      leafStrings(child, path ? `${path}.${key}` : key, found);
    }
  } else if (typeof value === "string") {
    found.push({ path, value });
  }
  return found;
}

function keyNames(value, found = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) keyNames(item, found);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      found.add(key);
      keyNames(child, found);
    }
  }
  return found;
}

/* ------------------------- the labelled fixture set ------------------------- */

test("the labelled set covers every state a consumer has to render differently", () => {
  const ids = EXECUTIVE_BRIEFING_CASES.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, "case ids must be unique");

  const grades = new Set(EXECUTIVE_BRIEFING_CASES.map((entry) => entry.grade));
  assert.deepEqual([...grades].sort(), ["eligible", "ineligible"]);

  const built = EXECUTIVE_BRIEFING_CASES.map((entry) => buildExecutiveBriefing(entry.periods));
  const benchmarkReasons = new Set(
    built.filter((briefing) => briefing.benchmark && !briefing.benchmark.eligible)
      .map((briefing) => briefing.benchmark.reason),
  );
  for (const reason of ["insufficient_history", "period_gap", "null_spend"]) {
    assert.ok(benchmarkReasons.has(reason), `no case shows the ${reason} benchmark absence`);
  }

  const actions = new Set(built.map((briefing) => briefing.nextAction?.id).filter(Boolean));
  for (const action of NEXT_ACTION) {
    assert.ok(actions.has(action.id), `no case reaches the ${action.id} action`);
  }

  const confidences = new Set(built.map((briefing) => briefing.confidence.level));
  for (const level of CONFIDENCE_LADDER) {
    assert.ok(confidences.has(level), `no case shows ${level} confidence`);
  }

  const tieBreaks = new Set(built.map((briefing) => briefing.selection.tieBreakApplied));
  assert.ok(tieBreaks.has("period_id_ascending"), "no case exercises a tied period selection");
});

for (const entry of EXECUTIVE_BRIEFING_CASES) {
  test(`${entry.id}: the briefing reproduces its pinned claims`, () => {
    const briefing = buildExecutiveBriefing(entry.periods);
    assert.deepEqual(briefingClaims(briefing), entry.expected, entry.label);
    assert.deepEqual(validateExecutiveBriefing(briefing).violations, []);
  });

  test(`${entry.id}: the same records produce the same briefing in any order`, () => {
    const expected = briefingClaims(buildExecutiveBriefing(entry.periods));
    assert.deepEqual(briefingClaims(buildExecutiveBriefing(entry.periods)), expected,
      "a second build of the same input differs, so the briefing is not reproducible");
    for (const ordering of permutations(entry.periods)) {
      assert.deepEqual(briefingClaims(buildExecutiveBriefing(ordering)), expected,
        `input order changed the briefing: ${ordering.map((p) => p.periodId).join(" ")}`);
    }
    // A briefing that survives a JSON round trip is one an export can carry
    // without a second derivation of any figure.
    const round = JSON.parse(JSON.stringify(buildExecutiveBriefing(entry.periods)));
    assert.deepEqual(briefingClaims(round), expected);
  });
}

/* ------------------------- internal consistency ----------------------------- */

test("every claim is internally consistent with the records it was built from", () => {
  for (const entry of EXECUTIVE_BRIEFING_CASES) {
    const briefing = buildExecutiveBriefing(entry.periods);
    const where = entry.id;

    // The primary metric is the retained figure, and its share is that figure
    // over that period's own analyzed spend — never over another period's.
    if (briefing.recoverable) {
      const source = entry.periods.find(
        (period) => period.periodId === briefing.reportingPeriod.periodId,
      );
      assert.equal(briefing.recoverable.valueMinor, source.recoverableScenarioMinor, where);
      assert.equal(briefing.recoverable.analyzedSpendMinor, source.analyzedSpendMinor, where);
      assert.equal(
        briefing.recoverable.sharePpm,
        recoverableSharePpm(source.recoverableScenarioMinor, source.analyzedSpendMinor),
        where,
      );
      assert.equal(briefing.primaryFinding.orgUnitId, source.topDepartmentId, where);
      assert.equal(briefing.primaryFinding.periodId, briefing.reportingPeriod.periodId, where);
      assert.equal(briefing.provenance.sourceFingerprint, source.sourceFingerprint, where);
      assert.equal(briefing.provenance.derivedAt, source.derivedAt, where);
      assert.equal(briefing.provenance.periodIds.at(-1), briefing.reportingPeriod.periodId, where);
      assert.equal(briefing.confidence.periodConfidence, source.confidence, where);
    }

    // The benchmark's variance is its own baseline subtracted from the headline
    // share, and its standing is the band applied to that variance.
    const benchmark = briefing.benchmark;
    if (benchmark?.eligible) {
      assert.equal(
        benchmark.varianceSharePpm, briefing.recoverable.sharePpm - benchmark.baselineSharePpm, where,
      );
      const expected = Math.abs(benchmark.varianceSharePpm) <= BENCHMARK_MATERIAL_VARIANCE_PPM
        ? BENCHMARK_STANDING.inLine
        : benchmark.varianceSharePpm > 0 ? BENCHMARK_STANDING.more : BENCHMARK_STANDING.less;
      assert.equal(benchmark.standing, expected, where);
      assert.equal(benchmark.priorPeriods.length, benchmark.priorPeriodCount, where);
      assert.equal(briefing.provenance.periodIds.length, benchmark.priorPeriodCount + 1, where);
    } else if (benchmark) {
      assert.equal(benchmark.baselineSharePpm, null, where);
      assert.equal(benchmark.standing, null, where);
    }

    // Every prior that fed the baseline is from the reporting period's own
    // dataset and sorts strictly before it.
    for (const label of benchmark?.priorPeriods ?? []) {
      assert.ok(label < briefing.reportingPeriod.period, `${where}: prior ${label} is not earlier`);
    }
    for (const id of briefing.provenance.periodIds) {
      const period = entry.periods.find((candidate) => candidate.periodId === id);
      assert.equal(period.dataset, briefing.provenance.dataset, where);
    }

    // Confidence is the weakest of the period's own level and the ceilings, and
    // its meaning is the catalog's sentence for that level, never a paraphrase.
    assert.equal(briefing.confidence.meaning, CONFIDENCE_MEANING[briefing.confidence.level], where);
    if (briefing.confidence.periodConfidence) {
      assert.ok(
        CONFIDENCE_LADDER.indexOf(briefing.confidence.level)
        <= CONFIDENCE_LADDER.indexOf(briefing.confidence.periodConfidence),
        `${where}: the briefing claims more confidence than the record it read`,
      );
    }
    assert.equal(briefing.confidence.ceilingReason !== null, briefing.confidence.ceiling !== null,
      `${where}: a ceiling without a reason is a number nobody can dispute`);

    // The recommended action is the catalog's entry verbatim, and only a capped
    // action carries a cap — capped at the reporting period's own scenario.
    const action = briefing.nextAction;
    if (action) {
      const catalogued = NEXT_ACTION.find((candidate) => candidate.id === action.id);
      assert.ok(catalogued, `${where}: ${action.id} is not in the catalog`);
      assert.equal(action.statement, catalogued.statement, where);
      assert.equal(action.precondition, catalogued.precondition, where);
      assert.equal(action.accountableRole, catalogued.accountableRole, where);
      assert.equal(action.capMinor, catalogued.capped ? briefing.recoverable.valueMinor : null, where);
      assert.equal(action.capCurrency, catalogued.capped ? "USD" : null, where);
      assert.ok(action.evidence.length >= 3, where);
      assert.ok(
        action.evidence.some((line) => line.includes(String(briefing.recoverable.valueMinor))),
        `${where}: the action cites no figure a reader can check`,
      );
    } else {
      // An absent slot names why, in a sentence the contract authored.
      for (const [slot, absence] of Object.entries(briefing.absent)) {
        assert.equal(absence.statement, EXECUTIVE_ABSENCE_STATEMENT[absence.reason], `${where}.${slot}`);
      }
      assert.ok(Object.keys(briefing.absent).length >= 4, where);
    }
  }
});

test("limitation language is the catalog's, and every conditional one is earned", () => {
  for (const entry of EXECUTIVE_BRIEFING_CASES) {
    const briefing = buildExecutiveBriefing(entry.periods);
    const codes = briefing.limitations.map((limitation) => limitation.code);
    const where = entry.id;

    // Wording is never composed here: a limitation is its catalog sentence or it
    // is a sentence nobody reviewed.
    for (const limitation of briefing.limitations) {
      assert.equal(limitation.statement, LIMITATION_STATEMENT[limitation.code], where);
    }
    assert.deepEqual(codes.slice(0, ALWAYS_ON_LIMITATIONS.length), ALWAYS_ON_LIMITATIONS, where);
    assert.equal(new Set(codes).size, codes.length, `${where}: a limitation ships twice`);

    const reporting = entry.periods.find(
      (period) => period.periodId === briefing.reportingPeriod?.periodId,
    );
    assert.equal(
      codes.includes(LIMITATION.benchmarkUnavailable),
      !briefing.benchmark?.eligible,
      `${where}: the benchmark absence is not stated`,
    );
    assert.equal(
      codes.includes(LIMITATION.exampleDataset),
      Boolean(reporting) && reporting.dataset !== "user",
      where,
    );
    assert.equal(
      codes.includes(LIMITATION.partialCoverage),
      Boolean(reporting) && reporting.coverageRatioPpm < FULL_COVERAGE_PPM,
      where,
    );
    assert.equal(
      codes.includes(LIMITATION.missingInputs),
      Boolean(reporting) && reporting.missingInputs.length > 0,
      where,
    );
    assert.equal(
      codes.includes(LIMITATION.mixedDatasetHistory),
      entry.periods.some((period) => reporting && period.dataset !== reporting.dataset),
      where,
    );
  }
});

/* --------------------------- deterministic ordering ------------------------- */

test("a tied action ranking resolves to the lowest rank, and only to it", () => {
  // The three cases below differ from each other in exactly the fields named
  // here. Every other input is identical, so the action each one produces is
  // attributable to the stated field and to nothing else.
  const tied = caseById("action-rank-tie-all-preconditions");
  const rankTwo = caseById("eligible-benchmark-less-verify");
  const rankThree = caseById("eligible-benchmarked-in-line");
  const reportingOf = (entry) => entry.periods.at(-1);

  assert.deepEqual(
    Object.entries(reportingOf(tied)).filter(
      ([key, value]) => reportingOf(rankTwo)[key] !== value,
    ).map(([key]) => key),
    ["confidence"],
  );
  assert.deepEqual(
    Object.entries(reportingOf(rankTwo)).filter(
      ([key, value]) => reportingOf(rankThree)[key] !== value,
    ).map(([key]) => key),
    ["recoverableScenarioMinor"],
  );

  // In the tied case all three preconditions hold at once: low period
  // confidence (rank 1), a standing below the baseline (rank 2), and a named
  // org unit with a positive scenario (rank 3).
  const tiedBriefing = buildExecutiveBriefing(tied.periods);
  assert.equal(tiedBriefing.confidence.periodConfidence, "low");
  assert.equal(tiedBriefing.benchmark.standing, BENCHMARK_STANDING.less);
  assert.ok(tiedBriefing.recoverable.valueMinor > 0);
  assert.ok(tiedBriefing.primaryFinding.orgUnitId);

  assert.deepEqual(NEXT_ACTION.map((action) => action.rank), [1, 2, 3]);
  assert.equal(tiedBriefing.nextAction.id, NEXT_ACTION[0].id);
  assert.equal(buildExecutiveBriefing(rankTwo.periods).nextAction.id, NEXT_ACTION[1].id);
  assert.equal(buildExecutiveBriefing(rankThree.periods).nextAction.id, NEXT_ACTION[2].id);

  // Exactly one action, never a list, and never a second one alongside it.
  assert.equal(Array.isArray(tiedBriefing.nextAction), false);
  assert.equal(typeof tiedBriefing.nextAction.id, "string");
});

test("each tie-break step is reachable and names itself", () => {
  const both = (left, right) => {
    const forward = buildExecutiveBriefing([left, right]);
    const backward = buildExecutiveBriefing([right, left]);
    assert.deepEqual(briefingClaims(backward), briefingClaims(forward),
      "arrival order decided the winner, so the order is not total");
    return forward;
  };
  const twin = (overrides) => ({ ...retained(), ...overrides });

  const byRecoverable = both(
    twin({ periodId: "user:2026-06#a", recoverableScenarioMinor: 480_000 }),
    twin({ periodId: "user:2026-06#b", recoverableScenarioMinor: 620_000 }),
  );
  assert.equal(byRecoverable.selection.tieBreakApplied, "recoverable_scenario_descending");
  assert.equal(byRecoverable.reportingPeriod.periodId, "user:2026-06#b");

  const byRecords = both(
    twin({ periodId: "user:2026-06#a", recordsAnalyzed: 1536 }),
    twin({ periodId: "user:2026-06#b", recordsAnalyzed: 1590 }),
  );
  assert.equal(byRecords.selection.tieBreakApplied, "records_analyzed_descending");
  assert.equal(byRecords.reportingPeriod.periodId, "user:2026-06#b");

  const byDerivedAt = both(
    twin({ periodId: "user:2026-06#a", derivedAt: "2026-07-02T09:14:00Z" }),
    twin({ periodId: "user:2026-06#b", derivedAt: "2026-07-09T09:14:00Z" }),
  );
  assert.equal(byDerivedAt.selection.tieBreakApplied, "derived_at_descending");
  assert.equal(byDerivedAt.reportingPeriod.periodId, "user:2026-06#b");

  const byPeriodId = both(twin({ periodId: "user:2026-06#b" }), twin({ periodId: "user:2026-06#a" }));
  assert.equal(byPeriodId.selection.tieBreakApplied, "period_id_ascending");
  assert.equal(byPeriodId.reportingPeriod.periodId, "user:2026-06#a");

  // The newest month still wins before any of the above is consulted.
  const newest = buildExecutiveBriefing([
    retained({ period: "2026-05", recoverableScenarioMinor: 3_000_000 }),
    retained({ period: "2026-06" }),
  ]);
  assert.equal(newest.selection.tieBreakApplied, "period_descending");
  assert.equal(newest.reportingPeriod.period, "2026-06");
});

/* ------------------------ redaction and the allowlist ----------------------- */

// Values that must never reach an executive artifact, each a different kind of
// leak: a prompt, an imported row, a file name, a credential, an identity, and a
// provider payload. They are searched for by value, so a slot that renames them
// still fails.
const SENTINEL = Object.freeze({
  prompt: "Rewrite this refund note for the account owner, and keep the apology short.",
  rawRow: "2026-06-04,premium-model,17,1188,acme-invoices-october",
  fileName: "acme-invoices-october.csv",
  credential: "sk-live9f2b7c4d8e1a6b3c",
  identity: "dana.okonkwo@acme-invoices.example",
  providerPayload: '{"model":"premium","messages":[{"role":"user"}],"usage":{"tokens":1188}}',
});

/** A retained period with every forbidden kind of content bolted onto it. */
function poisonedPeriod() {
  return {
    ...retained({ period: "2026-06" }),
    promptText: SENTINEL.prompt,
    conversationExcerpt: SENTINEL.prompt,
    importedRows: [{ line: SENTINEL.rawRow, customerEmail: SENTINEL.identity }],
    sourceFileName: SENTINEL.fileName,
    apiKey: SENTINEL.credential,
    providerResponse: { authorization: `Bearer ${SENTINEL.credential}`, body: SENTINEL.providerPayload },
  };
}

test("the redaction check is not vacuous: the poisoned record is itself refused", () => {
  const scan = scanRetainedContent(poisonedPeriod());
  assert.equal(scan.ok, false);
  const codes = new Set(scan.violations.map((violation) => violation.code));
  assert.ok(codes.has("forbidden_field"));
  assert.ok(codes.has("email_address"));
});

test("briefing-ready data carries no imported row, prompt, credential, or provider payload", () => {
  const periods = [...gaplessHistory().slice(0, 2), poisonedPeriod()];
  const briefing = buildExecutiveBriefing(periods);
  const serialized = JSON.stringify(briefing);

  for (const [kind, value] of Object.entries(SENTINEL)) {
    assert.equal(serialized.includes(value), false, `the briefing carries ${kind}`);
  }
  for (const key of ["promptText", "conversationExcerpt", "importedRows", "sourceFileName",
    "apiKey", "providerResponse", "customerEmail", "authorization"]) {
    assert.equal(keyNames(briefing).has(key), false, `the briefing carries a ${key} field`);
  }

  // The briefing's own scanners agree, and so does its validator.
  assert.deepEqual(scanRetainedContent(briefing).violations, []);
  assert.deepEqual(validateExecutiveBriefing(briefing).violations, []);

  // The figures are still the reporting period's own, so the redaction is not
  // an artifact of the briefing having refused the record wholesale.
  assert.equal(briefing.reportingPeriod.periodId, "user:2026-06");
  assert.equal(briefing.recoverable.valueMinor, 480_000);
});

test("only fields the retained-period contract declares can reach a briefing", () => {
  const briefing = buildExecutiveBriefing(gaplessHistory());
  // The method block names what it read; every name in it is a field of the
  // closed retained-period record, so no import-shaped field is even nameable.
  for (const field of briefing.method.readFields) {
    assert.ok(FINOPS_PERIOD_FIELDS.includes(field), `${field} is not a retained-period field`);
  }
  // Provenance emits two further period fields; both are in the same closed set.
  for (const field of ["periodId", "sourceFingerprint"]) {
    assert.ok(FINOPS_PERIOD_FIELDS.includes(field));
  }
  const poisoned = poisonedPeriod();
  const undeclared = Object.keys(poisoned).filter((key) => !FINOPS_PERIOD_FIELDS.includes(key));
  assert.ok(undeclared.length >= 5, "the poisoned record no longer carries undeclared fields");
});

test("no briefing in the set can carry a link, and none holds free-form prose", () => {
  for (const entry of EXECUTIVE_BRIEFING_CASES) {
    const briefing = buildExecutiveBriefing(entry.periods);
    for (const { path, value } of leafStrings(briefing)) {
      // `mustNotCarry` names the forbidden kinds; it is prose about links, not
      // a link, and the briefing itself has no such allowance.
      assert.equal(FORBIDDEN_LINK_PATTERN.test(value), false, `${entry.id}: ${path} carries a link`);
      assert.ok(value.length <= 400, `${entry.id}: ${path} is free-form prose`);
    }
    assert.equal(briefing.safety.shareableLinkSupported, false);
    assert.equal(briefing.safety.readsImportedRecords, false);
    assert.equal(briefing.safety.readsLiveProviderEndpoints, false);
  }
});

test("a poisoned value inside a declared field fails the validator rather than shipping", () => {
  // Allowlisting a field *name* is not the same as sanitizing its *value*: the
  // fingerprint and the org unit id are read verbatim, so a workspace that
  // stored a credential or an identity in one produces a briefing that fails
  // validation. Consumers must render only a briefing the validator accepted.
  const briefing = buildExecutiveBriefing([
    retained({ period: "2026-06", sourceFingerprint: SENTINEL.credential, topDepartmentId: SENTINEL.identity }),
  ]);
  const verdict = validateExecutiveBriefing(briefing);
  assert.equal(verdict.valid, false);
  const codes = new Set(verdict.violations.map((violation) => violation.code));
  assert.ok(codes.has("bearer_token"), "a credential in the fingerprint was not caught");
  assert.ok(codes.has("email_address"), "an identity in the org unit id was not caught");

  const prose = buildExecutiveBriefing([retained({ topDepartmentId: "syn-".padEnd(500, "x") })]);
  assert.ok(validateExecutiveBriefing(prose).violations.some(
    (violation) => violation.code === "free_form_text",
  ));
});

test("a low-confidence briefing still names an action, and the pairing is deliberate", () => {
  // The rank-1 precondition reads the period's *own* stored confidence; the
  // briefing's `confidence.level` additionally applies the dataset and benchmark
  // ceilings. So a briefing can read `low` while recommending a capped pilot —
  // as the example-dataset case does — and a consumer must render
  // `confidence.meaning` beside `nextAction` rather than either alone.
  const demo = buildExecutiveBriefing(caseById("example-dataset-mixed-history").periods);
  assert.equal(demo.confidence.level, "low");
  assert.equal(demo.confidence.periodConfidence, "high");
  assert.equal(demo.nextAction.id, "pilot_routing");
  assert.equal(demo.confidence.meaning, CONFIDENCE_MEANING.low);
  assert.ok(demo.limitations.some((limitation) => limitation.code === LIMITATION.exampleDataset));
});
