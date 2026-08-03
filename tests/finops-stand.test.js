// The headline answer: what it composes, and what it refuses to say.
//
// The contract this holds is the one the region exists for: a FinOps lead
// reads ONE decisive block, the position in it is never a bare rank, and a
// position that cannot be shown becomes a path rather than a dead label.
//
// Nothing here recomputes a figure. Every assertion compares the headline
// against the module that already owns the number, so a headline that drifts
// from `resolveCostPosition`, `leadingFinding`, or `prioritizedDestination`
// fails here rather than on a screenshot nobody diffed.

import test from "node:test";
import assert from "node:assert/strict";

import {
  STAND_DISCLOSURE, STAND_DISCLOSURE_ORDER, STAND_LOAD_FAILED, STAND_QUESTION, STAND_RESOLUTION,
  STAND_RESOLUTION_ACTION, buildStandHeadline, composeStandHeadline, periodLabel,
  reconcileRecoverableSentence, standHeadlineForImport,
} from "../src/finops-stand.js";
import { gradeExport } from "../src/export-gradability.js";
import {
  EXAMPLE_ORG_COHORT_PROFILE, EXAMPLE_TASK_LEDGER, loadExampleDataset,
} from "../src/example-dataset.js";
import { leadingFinding } from "../src/finops-leading-finding.js";
import {
  COST_POSITION_REASON, COST_POSITION_WITHHELD, resolveCostPosition,
} from "../src/peer-cost-position.js";
import {
  loadWorkspaceDestinations, prioritizedDestination, supportingDestinations,
} from "../src/finops-destination-contract.js";
import { validateCohortAttribution } from "../src/cohort-attribution.js";
import {
  CONFIDENCE_LEVELS, CONFIDENCE_REASON, EVIDENCE_CLASS, PROVENANCE_KIND,
  SYNTHETIC_CLAIM_QUALIFIER,
} from "../src/finops-finding-resolver.js";
import { SPINE_CLAIM_KIND } from "../src/finops-spine-manifest.js";
import { PEER_COST_SNAPSHOT_ID } from "../src/peer-cost-position.js";
import { evaluateRankingReproducibility } from "../src/ranking-reproducibility.js";

const analysis = loadExampleDataset();

test("the bundled example composes a complete headline with no import and no stored state", () => {
  // No argument, no storage, no fetch. This is the first-load path.
  const headline = buildStandHeadline();
  assert.equal(headline.question, STAND_QUESTION);
  assert.equal(headline.available, true);
  assert.equal(headline.positioned, true);
  assert.equal(headline.withheld, null);
  // Five parts, all populated: position, its metric, the recoverable figure,
  // one named team, one action.
  assert.equal(headline.position.available, true);
  assert.equal(headline.recoverable.available, true);
  assert.equal(headline.team.available, true);
  assert.equal(headline.action.available, true);
});

test("the position is never a bare rank: the metric and its band boundaries travel with it", () => {
  const headline = buildStandHeadline();
  const position = resolveCostPosition({
    org: EXAMPLE_ORG_COHORT_PROFILE, spendUsd: analysis.spendUsd, tasks: EXAMPLE_TASK_LEDGER,
  });
  // Which quarter, in words that carry their own direction, and the metric it
  // is a quarter OF, in the same line.
  assert.match(headline.position.value, /^Most expensive quarter · \$\d+\.\d{2} per successful task$/);
  assert.ok(headline.position.value.includes(position.valueDisplay),
    "the headline value is the position module's own figure");
  // The basis carries the denominator: both quartile boundaries, the cohort it
  // was placed in, the direction, and how many successful tasks it divided by.
  assert.match(headline.position.basis, /less than \$18\.40 and a quarter spends more than \$31\.50/);
  assert.match(headline.position.basis, /4,000 successful tasks/);
  assert.match(headline.position.basis, /Lower cost per successful task is better\./);
  assert.ok(headline.position.basis.includes(position.cohort.label));
  // The published band name is still on the page for a reader who has to match
  // this claim to another surface — under the plain words, not instead of them.
  assert.ok(headline.position.basis.includes(position.bandLabel),
    "the published band name is not reachable from the headline");
});

test("the claim states position, comparison set, and period in one repeatable sentence", () => {
  const headline = buildStandHeadline();
  // Everything a lead needs to repeat it verbatim, with nothing to expand: the
  // period comes off the analysis rather than a clock or a literal.
  assert.equal(periodLabel(analysis), "June 2026");
  assert.match(headline.finding.claim,
    /^Your AI spend is in the most expensive quarter of organizations like yours, at \$38\.63 per successful task for June 2026\./);
  // The bundled path rests on hand-authored synthetic cohort boundaries, so the
  // sentence the region ASSERTS is that claim behind the resolver's qualifier.
  // The figures are unchanged; what changes is that it is not offered as a
  // measured peer position. See tests/finops-finding-winner-fixtures.test.js.
  assert.equal(headline.answer, `${SYNTHETIC_CLAIM_QUALIFIER} ${headline.finding.claim}`);
  // A window that is not one whole month is quoted rather than renamed.
  assert.equal(periodLabel({ period: "2026-04-01 to 2026-07-01" }), "2026-04-01 to 2026-07-01");
  assert.equal(periodLabel({}), null);
});

test("the recoverable figure sits in the headline beside the position, not in a card of its own", () => {
  const headline = buildStandHeadline();
  assert.match(headline.recoverable.value, /^\$51,254 · 33% of analyzed spend$/);
  assert.match(headline.recoverable.basis, /\$51,254 of \$154,500 analyzed/);
  // The answer sentence holds the position AND the recoverable AND the team, so
  // a reader who stops after one line has still read all three.
  assert.ok(headline.answer.includes("$38.63"));
  assert.ok(headline.answer.includes("$51,254"));
  assert.ok(headline.answer.includes(headline.team.name));
});

// ---------------------------------------------------------------------------
// #1019 — the recoverable figure and the coverage verdict, reconciled.
//
// The two panels read the same spend base and looked like they disagreed: a
// third of it modelled as recoverable, and a coverage line saying the rubric
// scored none of it and shows no letter. The helper below is the whole fix, so
// it is tested on its own rather than only through the composed headline.
// ---------------------------------------------------------------------------

test("the reconciling sentence reports zero scored coverage as zero, and says why no grade follows", () => {
  const sentence = reconcileRecoverableSentence({
    analyzedUsd: 154500, recoverableUsd: 51254, scoredUsd: 0, gradePublished: false,
  });
  assert.equal(sentence, "$51,254 is a model estimate over $154,500 of analyzed spend; "
    + "the rubric scored none of that spend, so no grade is shown.");
});

test("the reconciling sentence adapts to scored coverage rather than asserting a constant", () => {
  // Scored, and the tier publishes a letter: the sentence names the amount and
  // points at the grade instead of denying one.
  const graded = reconcileRecoverableSentence({
    analyzedUsd: 154500, recoverableUsd: 51254, scoredUsd: 139050, gradePublished: true,
  });
  assert.equal(graded, "$51,254 is a model estimate over $154,500 of analyzed spend; "
    + "the rubric scored $139,050 of it, which is what the grade rests on.");
  assert.doesNotMatch(graded, /none of that spend/);

  // Scored, but under the bar: neither "none" nor a grade that is not shown.
  const thin = reconcileRecoverableSentence({
    analyzedUsd: 154500, recoverableUsd: 51254, scoredUsd: 9000, gradePublished: false,
  });
  assert.match(thin, /the rubric scored \$9,000 of it — too little for a grade to be shown\./);

  // No operand, no sentence. A missing coverage measurement is not a measured
  // zero, so it gets no claim about what the rubric did or did not read.
  assert.equal(reconcileRecoverableSentence({
    analyzedUsd: 154500, recoverableUsd: 51254, scoredUsd: null, gradePublished: false }), null);
  assert.equal(reconcileRecoverableSentence({ scoredUsd: 0 }), null);
  assert.equal(reconcileRecoverableSentence(), null);
});

test("the headline's reconciliation is the verdict the answer block reads, not a second measurement", () => {
  const headline = buildStandHeadline();
  const verdict = gradeExport({ analysis, source: "example" });
  // Same operands, same sentence: the panel and the headline cannot drift.
  assert.equal(headline.recoverable.reconciliation, reconcileRecoverableSentence({
    analyzedUsd: analysis.spendUsd,
    recoverableUsd: analysis.recoverableUsd,
    scoredUsd: verdict.coveredUsd,
    gradePublished: verdict.showFigures,
  }));
  // And on the bundled path that is the zero-coverage reading, stated as zero.
  assert.equal(verdict.coveredUsd, 0);
  assert.match(headline.recoverable.reconciliation,
    /^\$51,254 is a model estimate over \$154,500 of analyzed spend; the rubric scored none/);
});

test("exactly one team is named, and it is the department the existing finding already ranked", () => {
  const headline = buildStandHeadline();
  const finding = leadingFinding(analysis);
  assert.equal(headline.team.name, finding.driver.name);
  assert.equal(headline.team.detail, finding.driverSentence);
  // Runners-up are not in the headline. They are in the disclosure, all of them.
  const ranked = headline.disclosures.find((entry) => entry.id === STAND_DISCLOSURE.departments);
  assert.equal(ranked.entries.length, analysis.rankedDepartments.length);
  for (const department of analysis.rankedDepartments.slice(1)) {
    assert.ok(!headline.answer.includes(department.name),
      `${department.name} is a runner-up and must not be in the headline`);
    assert.ok(ranked.entries.some((row) => row.term.includes(department.name)),
      `${department.name} must still be reachable in the department disclosure`);
  }
});

test("exactly one action is offered, and it is the destination contract's own rank 1", () => {
  const headline = buildStandHeadline();
  const record = loadWorkspaceDestinations().record;
  const top = prioritizedDestination(record);
  assert.equal(headline.action.href, top.href);
  assert.equal(headline.action.label, top.callToAction);
  // The prioritization is not re-decided here: the clause that promoted it is
  // quoted verbatim as the basis.
  assert.ok(headline.action.basis.includes(top.selectionBasis));
  // Every destination that did not win rank 1 is behind the disclosure, not gone.
  const others = headline.disclosures.find((entry) => entry.id === STAND_DISCLOSURE.otherActions);
  assert.equal(others.entries.length, supportingDestinations(record).length);
  assert.ok(others.entries.length > 0, "there are unpromoted destinations to disclose");
});

test("the five required disclosures are published, in one flat list", () => {
  const headline = buildStandHeadline();
  const ids = headline.disclosures.map((entry) => entry.id);
  assert.deepEqual(ids, [...STAND_DISCLOSURE_ORDER]);
  for (const key of [STAND_DISCLOSURE.cohort, STAND_DISCLOSURE.anonymization,
    STAND_DISCLOSURE.versions, STAND_DISCLOSURE.departments, STAND_DISCLOSURE.verification]) {
    const found = headline.disclosures.find((entry) => entry.id === key);
    assert.ok(found, `${key} must be disclosed`);
    assert.ok(found.entries.length > 0, `${key} discloses nothing`);
    assert.ok(found.summary.trim().length > 0, `${key} has no summary`);
  }
});

test("the disclosures carry the shipped cohort, anonymization, version and verification facts", () => {
  const headline = buildStandHeadline();
  const find = (key) => headline.disclosures.find((entry) => entry.id === key).entries;
  const flatten = (entries) => entries.map((row) => `${row.term}: ${row.detail}`).join("\n");

  // Cohort composition: how the peer set was built, and the matched record.
  assert.match(flatten(find(STAND_DISCLOSURE.cohort)),
    /Enterprise · 2,000\+ employees · Software-as-a-service/);
  // Anonymization: the note is the import contract's own, not a second copy.
  const note = validateCohortAttribution({}).note;
  assert.ok(flatten(find(STAND_DISCLOSURE.anonymization)).includes(note.text));
  // Rubric and snapshot versions.
  const versions = flatten(find(STAND_DISCLOSURE.versions));
  assert.match(versions, /down-routing-candidate\/1\.0\.0/);
  assert.match(versions, /Peer data published: 2026-06-30/);
  // Verification: the confidence score and the limit that keeps it below 1.00.
  const verification = flatten(find(STAND_DISCLOSURE.verification));
  assert.match(verification, /0\.85 of 1\.00/);
  assert.match(verification, /15 of 15 records analyzed/);
  assert.match(verification, /Not verified · missing_request_counts/);
});

// ---------------------------------------------------------------------------
// The headline is RESOLVED, not assembled. `answerSentence()` — which made the
// peer position the headline by construction — is gone; these assert that what
// replaced it is wired to this region and agrees with what the region renders.
// ---------------------------------------------------------------------------

test("the answer is the winning finding's claim, as that finding may assert it", () => {
  const headline = buildStandHeadline();
  assert.equal(headline.answer, headline.finding.assertedClaim);
  // The bundled path is synthetic, so the assertion is the claim qualified —
  // never a rewrite of it and never a different figure.
  assert.equal(headline.entitlement.evidenceClass, EVIDENCE_CLASS.syntheticCohort);
  assert.ok(headline.answer.endsWith(headline.finding.claim));
  // On the bundled example the position is material, reproducible, and the
  // manifest's first claim kind, so it leads.
  assert.equal(headline.finding.signalKind, SPINE_CLAIM_KIND.peerPosition);
  assert.equal(headline.finding.id, "peer-position");
  // The finding recommends exactly one action, and it is the one this region
  // actually renders. A headline that recommends an action the page does not
  // offer is a claim nobody can act on.
  assert.equal(headline.finding.recommendedAction, headline.action.label);
});

test("the bundled example's ranking confesses that it rests on synthetic cohorts", () => {
  const headline = buildStandHeadline();
  // The reproducibility result states the tier; the resolver drops it a level
  // because the quartile boundaries are published synthetic ones, not the
  // reader's own export.
  const reproducibility = evaluateRankingReproducibility({
    org: EXAMPLE_ORG_COHORT_PROFILE,
    spendUsd: Number(analysis.spendUsd),
    tasks: EXAMPLE_TASK_LEDGER,
    analysis,
  });
  assert.equal(headline.finding.confidence.statedLevel, reproducibility.confidence.tier);
  assert.equal(CONFIDENCE_LEVELS.indexOf(headline.finding.confidence.statedLevel)
    - CONFIDENCE_LEVELS.indexOf(headline.finding.confidence.level), 1);
  assert.ok(headline.finding.confidence.reasons
    .includes(CONFIDENCE_REASON.syntheticCohortBoundaries));
  // Traceable back to the snapshot that produced the boundaries.
  assert.equal(headline.finding.provenance.kind, PROVENANCE_KIND.synthetic);
  assert.equal(headline.finding.provenance.id, PEER_COST_SNAPSHOT_ID);
});

test("the runners-up are returned in rank order and rendered by nothing", () => {
  const headline = buildStandHeadline();
  assert.ok(headline.runnersUp.length > 0, "the example supports more than one finding");
  // Ordered, distinct, and none of them is the winner.
  const ids = headline.runnersUp.map((row) => row.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes(headline.finding.id));
  // No runner-up claim is on the surface: the region asserts one claim.
  for (const runnerUp of headline.runnersUp) {
    assert.notEqual(headline.answer, runnerUp.claim);
  }
  // And every signal that did not become a finding is reported, never dropped.
  assert.ok(Array.isArray(headline.rejectedSignals));
});

test("the same headline resolves to the same winner on every build", () => {
  const first = buildStandHeadline();
  const second = buildStandHeadline();
  assert.equal(first.finding.id, second.finding.id);
  assert.equal(first.answer, second.answer);
  assert.deepEqual(first.runnersUp.map((row) => row.id), second.runnersUp.map((row) => row.id));
});

test("an import with no placeable position still leads with its strongest finding", () => {
  // The reader's export is ineligible for a cohort, so the position is withheld
  // — and the region still answers with the best finding their own data
  // supports rather than with the reason it cannot place them.
  const eligibility = validateCohortAttribution({
    rows: [{ department_key: "atlas-platform", cost: "10" }],
  });
  const headline = standHeadlineForImport({ analysis, eligibility });
  assert.equal(headline.positioned, false);
  assert.notEqual(headline.finding, null);
  // Own-export evidence selects the unqualified template, so the reader's own
  // finding is asserted verbatim rather than degraded.
  assert.equal(headline.answer, headline.finding.assertedClaim);
  assert.equal(headline.answer, headline.finding.claim);
  assert.equal(headline.entitlement.evidenceClass, EVIDENCE_CLASS.ownExport);
  // Nothing cohort-derived can win here: there is no position and no ranking.
  assert.notEqual(headline.finding.signalKind, SPINE_CLAIM_KIND.peerPosition);
  // The reader's own export is the evidence, so no synthetic downgrade applies.
  assert.equal(headline.finding.provenance.kind, PROVENANCE_KIND.imported);
  assert.ok(!headline.finding.confidence.reasons
    .includes(CONFIDENCE_REASON.syntheticCohortBoundaries));
  // The withheld position is still explained; the finding did not replace it.
  assert.equal(headline.withheld.missing, eligibility.reasonText);
});

test("a headline with no evidence at all carries no finding and keeps its placeholder", () => {
  const thrown = () => { throw new Error("the example could not be loaded"); };
  const headline = buildStandHeadline(thrown, thrown);
  assert.equal(headline.finding, null);
  assert.deepEqual(headline.runnersUp, []);
  // The region's existing empty convention: the withheld sentence, not a blank
  // and not the word "Unavailable".
  assert.equal(headline.answer, headline.withheld.missing);
});

// ---------------------------------------------------------------------------
// The withheld path. This is the whole point of the region's second state.
// ---------------------------------------------------------------------------

const WITHHOLDING_INPUTS = [
  ["missing cohort attributes", { org: {}, spendUsd: 1000, tasks: EXAMPLE_TASK_LEDGER },
    COST_POSITION_WITHHELD.missingAttributes],
  ["no successful tasks", {
    org: EXAMPLE_ORG_COHORT_PROFILE, spendUsd: 1000, tasks: [],
  }, COST_POSITION_WITHHELD.noSuccessfulTasks],
  ["no spend total", {
    org: EXAMPLE_ORG_COHORT_PROFILE, spendUsd: null, tasks: EXAMPLE_TASK_LEDGER,
  }, COST_POSITION_WITHHELD.noSpendTotal],
];

for (const [name, input, code] of WITHHOLDING_INPUTS) {
  test(`a bundled position withheld for ${name} names what is missing and one step that resolves it`, () => {
    const position = resolveCostPosition(input);
    assert.equal(position.available, false);
    assert.equal(position.reasonCode, code);
    const headline = composeStandHeadline({ analysis, position, source: "example" });
    assert.equal(headline.positioned, false);
    assert.equal(headline.withheld.reasonCode, code);
    // The specific condition, in the position contract's own words.
    assert.equal(headline.withheld.missing, COST_POSITION_REASON[code]);
    // And a concrete step, not a restatement of the problem.
    assert.equal(headline.withheld.nextStep, STAND_RESOLUTION[code]);
    assert.equal(headline.withheld.actionLabel, STAND_RESOLUTION_ACTION.label);
    // The bare word is never the answer, in any slot of the withheld headline.
    const spoken = [headline.answer, headline.position.value, headline.position.basis,
      headline.withheld.missing, headline.withheld.nextStep].join(" ");
    assert.ok(!/\bUnavailable\b/.test(spoken), `"Unavailable" leaked into: ${spoken}`);
  });
}

test("an ineligible import is withheld in the import contract's own words and next step", () => {
  // An export with rows but no declared size band: the exact case Anya's
  // contract publishes a reason and a remedy for.
  const eligibility = validateCohortAttribution({
    rows: [{ department_key: "atlas-platform", cost: "10" }],
  });
  assert.equal(eligibility.eligible, false);
  const headline = standHeadlineForImport({ analysis, eligibility });
  assert.equal(headline.source, "import");
  assert.equal(headline.positioned, false);
  // Verbatim, both of them. Paraphrasing an eligibility decision here would be
  // a second eligibility rule wearing the first one's clothes.
  assert.equal(headline.withheld.missing, eligibility.reasonText);
  assert.equal(headline.withheld.nextStep, eligibility.nextStep);
  assert.equal(headline.withheld.reasonCode, eligibility.reason);
  assert.ok(!/\bUnavailable\b/.test(headline.withheld.missing));
  assert.ok(headline.withheld.nextStep.trim().length > 0, "a withheld import gets a real step");
});

test("an eligible import is placed against the cohort the import contract selected", () => {
  const eligibility = validateCohortAttribution({
    rows: [
      { department_key: "atlas-platform", org_size_band: "focused", industry: "saas" },
      { department_key: "boreal-support" },
    ],
  });
  assert.equal(eligibility.eligible, true);
  const headline = standHeadlineForImport({ analysis, eligibility });
  assert.equal(headline.positioned, true);
  assert.equal(headline.withheld, null);
  assert.ok(headline.position.value.includes(eligibility.position.label));
  // Still never a bare rank: the member count is the denominator and the
  // declared attributes are the basis.
  assert.ok(headline.position.basis.includes(String(eligibility.position.memberCount)));
  assert.ok(headline.position.basis.includes(eligibility.position.snapshotDate));
});

test("an unreadable input degrades to a withheld headline rather than throwing", () => {
  const thrown = () => { throw new Error("the example could not be loaded"); };
  const headline = buildStandHeadline(thrown, thrown);
  assert.equal(headline.question, STAND_QUESTION);
  assert.equal(headline.positioned, false);
  assert.equal(headline.available, false);
  // The disclosures and the resolving action survive the failure, because they
  // are exactly what is still useful when the figures are not.
  assert.equal(headline.disclosures.length, STAND_DISCLOSURE_ORDER.length);
  assert.ok(headline.withheld.nextStep.trim().length > 0);
});

test("a load failure reads as a load failure, not as a problem with the reader's data", () => {
  const thrown = () => { throw new Error("the example could not be loaded"); };
  const headline = buildStandHeadline(thrown, thrown);
  assert.equal(headline.withheld.reasonCode, STAND_LOAD_FAILED);
  // It names the cause and clears the reader of it, so nobody re-exports a file
  // to fix a page that failed to read its own example.
  assert.match(headline.withheld.missing, /could not be read in this browser/);
  assert.match(headline.withheld.missing, /Nothing in your own data caused this/);
  assert.equal(headline.withheld.nextStep, STAND_RESOLUTION[STAND_LOAD_FAILED]);
  // And it is a different sentence from the one an ineligible export gets.
  const ineligible = composeStandHeadline({
    analysis, source: "example",
    position: resolveCostPosition({ org: {}, spendUsd: 1000, tasks: EXAMPLE_TASK_LEDGER }),
  });
  assert.notEqual(headline.withheld.missing, ineligible.withheld.missing);
  assert.notEqual(headline.withheld.nextStep, ineligible.withheld.nextStep);
});
