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
  standHeadlineForImport,
} from "../src/finops-stand.js";
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
  assert.match(headline.answer,
    /^Your AI spend is in the most expensive quarter of organizations like yours, at \$38\.63 per successful task for June 2026\./);
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
