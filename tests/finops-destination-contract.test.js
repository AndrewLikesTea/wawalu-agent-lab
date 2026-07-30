// The workspace-destination contract, and the front door that consumes it.
//
// Two groups, and they check different claims:
//
//   1. THE FIXTURE AND THE RULES. Every required field is present, every
//      threshold is the published one, and the ranking is recomputed rather
//      than transcribed. The clause variants are built by mutating the shipped
//      fixture in-test — a second and third committed fixture would be two more
//      files to keep in agreement with the first, and the interesting part of a
//      variant is the one field that differs.
//
//   2. THE FRONT DOOR. The shipped markup of src/evolution.html carries the
//      region, and the real page entry paints a prioritized destination into it
//      that a reader can act on without opening anything. That is the defect
//      this work exists to fix: three doors scattered through a monolith with
//      no ranking. A test that only checked the module would pass on a page
//      that renders none of it.
//
// Nothing here reads a clock, a network, or a random source.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { loadPage, parseHtml, tabSequence, textOf } from "./support/browser.js";
import { importPageModule, waitFor } from "./support/page-module.js";
import {
  DESTINATION_CONTRACT_VERSION, DESTINATION_QUESTION, DESTINATION_ROLE, MATERIALITY,
  PRIORITY_CLAUSES, PRIORITY_RULE_VERSION, RANKING_BASIS, REQUIRED_FIELDS, ROLE_ORDER,
  loadWorkspaceDestinations, materiality, prioritizedDestination, priorityClauseFor,
  rankedRoles, supportingDestinations, validateDestinationRecord,
} from "../src/finops-destination-contract.js";
import {
  DESTINATION_BODY_ID, DESTINATION_SECTION_ID, DESTINATION_STATE,
  applyWorkspaceDestinations, supersedeWorkspaceDestinations,
} from "../src/finops-destination-view.js";
import { loadCanonicalDecision } from "../src/finops-decision-contract.js";

const PAGE = new URL("../src/evolution.html", import.meta.url);
const DEMO_DATA = JSON.parse(
  await readFile(new URL("../src/evolution-demo-data.json", import.meta.url), "utf8"));
const EVALUATION_FIXTURES = JSON.parse(
  await readFile(new URL("../src/finops-evaluation-fixtures.json", import.meta.url), "utf8"));
const SERVED = {
  "/evolution-demo-data.json": DEMO_DATA,
  "/finops-evaluation-fixtures.json": EVALUATION_FIXTURES,
};

const html = await readFile(PAGE, "utf8");
const loaded = loadWorkspaceDestinations();
const clone = (value) => JSON.parse(JSON.stringify(value));
const byId = (document, id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// 1. The fixture and the rules.
// ---------------------------------------------------------------------------

test("the shipped fixture satisfies its own contract", () => {
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.valid, true);
  assert.ok(loaded.record);
  assert.equal(loaded.record.contractVersion, DESTINATION_CONTRACT_VERSION);
  assert.equal(loaded.record.priorityRuleVersion, PRIORITY_RULE_VERSION);
  assert.equal(loaded.record.question, DESTINATION_QUESTION);
});

test("every required field is present, and removing any one of them fails", () => {
  for (const field of REQUIRED_FIELDS) {
    const broken = clone(loaded.record);
    delete broken[field];
    const result = validateDestinationRecord(broken);
    assert.equal(result.valid, false, `${field} is not required`);
    assert.ok(result.errors.some((error) => error.startsWith(field)),
      `dropping ${field} was not reported against ${field}: ${result.errors.join("; ")}`);
  }
});

test("the finding is one consolidated finding, not a list of them", () => {
  const record = loaded.record;
  assert.equal(Array.isArray(record.finding), false);
  for (const key of ["id", "statement", "whyItMatters", "confidence", "provenance", "evidence"]) {
    assert.ok(record.finding[key], `the finding carries no ${key}`);
  }
  // Why it matters is a leader's stake, not a restatement of the statement.
  assert.notEqual(record.finding.whyItMatters, record.finding.statement);
  // Confidence, provenance, and disclosed evidence all hang off that one finding.
  assert.equal(record.finding.confidence.scaleMin, 0);
  assert.equal(record.finding.confidence.scaleMax, 1);
  assert.equal(record.finding.confidence.band, "moderate");
  assert.equal(record.finding.provenance.source, "synthetic-local");
  assert.equal(record.finding.evidence.disclosure, "progressive");
  assert.ok(record.finding.evidence.entries.length >= 3);

  const asList = clone(record);
  asList.finding = [clone(record.finding)];
  const result = validateDestinationRecord(asList);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /finding: must be one consolidated finding/.test(error)));
});

test("evidence that restates the finding or the action is rejected", () => {
  for (const restatement of [loaded.record.finding.statement, loaded.record.rankedAction.statement]) {
    const broken = clone(loaded.record);
    broken.finding.evidence.entries[0].detail = restatement;
    const result = validateDestinationRecord(broken);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((error) => /restates the summary/.test(error)));
  }
});

test("materiality needs both tests, and the record cannot claim a verdict it did not earn", () => {
  // The published thresholds, as the numbers somebody can be asked to defend.
  assert.equal(MATERIALITY.minShare, 0.05);
  assert.equal(MATERIALITY.minObservedUsd, 10000);

  const shipped = materiality(51254, 154500);
  assert.equal(shipped.share, 0.3317);
  assert.deepEqual(
    { meetsShare: shipped.meetsShare, meetsFloor: shipped.meetsFloor, material: shipped.material },
    { meetsShare: true, meetsFloor: true, material: true });

  // A big share of a tiny baseline is not material, and neither is a large
  // figure that is a rounding error of the baseline it came from.
  const tinyBaseline = materiality(80, 400);
  assert.deepEqual({ meetsShare: tinyBaseline.meetsShare, material: tinyBaseline.material },
    { meetsShare: true, material: false });
  const hugeBaseline = materiality(10000, 50000000);
  assert.deepEqual({ meetsFloor: hugeBaseline.meetsFloor, material: hugeBaseline.material },
    { meetsFloor: true, material: false });
  // No baseline is an unavailable share, never a zero one.
  assert.equal(materiality(1000, 0).share, null);

  const lying = clone(loaded.record);
  lying.benchmark.observedUsd = 400;
  const result = validateDestinationRecord(lying);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /benchmark.material: expected false/.test(error)));
});

test("the action ranking is a total order, declared rather than implied", () => {
  assert.deepEqual({ ...loaded.record.rankedAction.rankingBasis }, { ...RANKING_BASIS });
  assert.equal(loaded.record.rankedAction.rank, 1);
  assert.equal(loaded.record.rankedAction.capUsd > 0, true);
  // A tie-break key is what makes the order independent of input row order.
  assert.equal(RANKING_BASIS.tieBreak, "department_pseudonym_ascending");

  const undeclared = clone(loaded.record);
  undeclared.rankedAction.rankingBasis.tieBreak = "whatever_came_first";
  assert.equal(validateDestinationRecord(undeclared).valid, false);

  const unranked = clone(loaded.record);
  unranked.rankedAction.rank = 2;
  assert.ok(validateDestinationRecord(unranked).errors.some((e) => /rankedAction.rank/.test(e)));
});

test("each priority clause promotes its own role, and exactly one always fires", () => {
  assert.equal(PRIORITY_CLAUSES.length, ROLE_ORDER.length);
  assert.deepEqual(PRIORITY_CLAUSES.map((clause) => clause.code),
    ["unchecked_basis", "unscoped_action", "ready_to_commit"]);

  // The shipped fixture: one unchecked limit, so the evidence door comes first.
  assert.equal(loaded.clause.code, "unchecked_basis");
  assert.equal(prioritizedDestination(loaded.record).role, DESTINATION_ROLE.evidence);

  // Clear the limit and the same rule promotes the act-and-verify loop.
  const checked = clone(loaded.record);
  checked.finding.confidence.limits = [];
  assert.equal(priorityClauseFor({
    confidence: checked.finding.confidence, rankedAction: checked.rankedAction,
  }).code, "ready_to_commit");

  // Clear the limit but lose the department scope and the drill-down wins.
  const unscoped = clone(checked);
  unscoped.rankedAction.departmentScope = "   ";
  assert.equal(priorityClauseFor({
    confidence: unscoped.finding.confidence, rankedAction: unscoped.rankedAction,
  }).code, "unscoped_action");

  // A weak band is an unchecked basis even with no limit listed.
  for (const band of ["low", "insufficient"]) {
    assert.equal(priorityClauseFor({
      confidence: { limits: [], band }, rankedAction: checked.rankedAction,
    }).code, "unchecked_basis");
  }

  // Every clause yields a full ranking of all three roles, rank 1 first.
  for (const clause of PRIORITY_CLAUSES) {
    const roles = rankedRoles(clause);
    assert.equal(roles[0], clause.role);
    assert.deepEqual([...roles].sort(), [...ROLE_ORDER].sort());
  }
});

test("the fixture's ranks are recomputed from the rule, not transcribed", () => {
  const expected = rankedRoles(loaded.clause);
  for (const destination of loaded.record.destinations) {
    assert.equal(destination.rank, expected.indexOf(destination.role) + 1,
      `${destination.id} carries a rank the rule did not give it`);
  }
  // Swapping two ranks by hand is a failure, not a layout preference.
  const swapped = clone(loaded.record);
  swapped.destinations[0].rank = 3;
  swapped.destinations[2].rank = 1;
  const result = validateDestinationRecord(swapped);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => /rank: expected/.test(error)));
});

test("the three roles are the only three, each declared once with its own limits", () => {
  const record = loaded.record;
  assert.deepEqual(record.destinations.map((entry) => entry.role).sort(), [...ROLE_ORDER].sort());
  for (const entry of record.destinations) {
    assert.ok(entry.answers.trim().length > 0, `${entry.id} answers nothing`);
    // A door labelled only with what it offers is how a reader ends up in the
    // wrong room, so what it will not tell you is required too.
    assert.ok(entry.doesNotAnswer.trim().length > 0, `${entry.id} claims no limit`);
    assert.equal(entry.disclosure, "progressive");
  }
  assert.equal(supportingDestinations(record).map((entry) => entry.rank).join(","), "2,3");

  const fourth = clone(record);
  fourth.destinations.push({ ...clone(record.destinations[0]), id: "x", rank: 4 });
  assert.equal(validateDestinationRecord(fourth).valid, false);

  const duplicated = clone(record);
  duplicated.destinations[1].role = duplicated.destinations[0].role;
  assert.ok(validateDestinationRecord(duplicated).errors.some((e) => /duplicated/.test(e)));

  const missingLimit = clone(record);
  delete missingLimit.destinations[2].doesNotAnswer;
  assert.ok(validateDestinationRecord(missingLimit).errors.some((e) => /doesNotAnswer/.test(e)));
});

test("a destination may only name a surface of this origin", () => {
  for (const entry of loaded.record.destinations) {
    assert.match(entry.href, /^(?:#|\/)/);
  }
  for (const href of ["https://vendor.example/console", "//vendor.example/x", "javascript:alert(1)"]) {
    const broken = clone(loaded.record);
    broken.destinations[0].href = href;
    const result = validateDestinationRecord(broken);
    assert.equal(result.valid, false, `${href} was accepted as a destination`);
  }
});

test("a credential, an address, or a stored prompt anywhere in the record fails it", () => {
  const cases = [
    (record) => { record.destinations[0].apiKey = "sk-live-000111222333"; },
    (record) => { record.finding.customerEmail = "lead@example.com"; },
    (record) => { record.finding.promptText = "summarise the invoice"; },
    (record) => { record.benchmark.basis += " See https://vendor.example/report."; },
  ];
  for (const mutate of cases) {
    const broken = clone(loaded.record);
    mutate(broken);
    assert.equal(validateDestinationRecord(broken).valid, false,
      "the boundary walk let a forbidden value through");
  }
});

test("the ranking is scoped to the same window and the same figures as the answer above it", () => {
  const decision = loadCanonicalDecision().decision;
  assert.ok(decision, "the decision fixture is invalid, so agreement cannot be checked");
  // One month, one baseline, one recoverable figure, one accountable role: a
  // region that routed off a different month than the brief it sits under would
  // be recommending a first step for a number the reader cannot see.
  assert.deepEqual(loaded.record.benchmark.window, decision.benchmark.window);
  assert.deepEqual(loaded.record.rankedAction.window, decision.benchmark.window);
  assert.equal(loaded.record.benchmark.baselineUsd, decision.benchmark.baselineUsd);
  assert.equal(loaded.record.benchmark.observedUsd, decision.benchmark.observedUsd);
  assert.equal(loaded.record.benchmark.comparisonShare, decision.benchmark.comparisonShare);
  assert.equal(loaded.record.rankedAction.statement, decision.prioritizedAction.statement);
  assert.equal(loaded.record.rankedAction.accountableRole, decision.prioritizedAction.accountableRole);
  assert.equal(loaded.record.finding.confidence.score, decision.confidence.score);

  const drifted = clone(loaded.record);
  drifted.rankedAction.window = { start: "2026-05-01T00:00:00Z", end: "2026-06-01T00:00:00Z", endExclusive: true };
  assert.ok(validateDestinationRecord(drifted).errors
    .some((error) => /rankedAction.window: must be the same window/.test(error)));
});

test("an invalid record loads as null rather than as an unvalidated claim", () => {
  const broken = clone(loaded.record);
  delete broken.finding;
  const result = loadWorkspaceDestinations(broken);
  assert.equal(result.record, null);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

// ---------------------------------------------------------------------------
// 2. The front door.
// ---------------------------------------------------------------------------

test("the region is authored in the shipped markup, below the brief and as evidence", () => {
  const document = parseHtml(html);
  const section = byId(document, DESTINATION_SECTION_ID);
  assert.ok(section, "the AI FinOps page ships no destination region");
  // Evidence, not a second complete summary: it answers a different question.
  assert.equal(section.getAttribute("data-decision-summary"), "evidence");
  assert.equal(section.dataset.state, DESTINATION_STATE.unavailable);
  assert.ok(byId(document, DESTINATION_BODY_ID), "the region has no body to paint into");
  // The question is the heading, in the words the contract publishes.
  assert.equal(textOf(byId(document, "finops-destinations-title")), DESTINATION_QUESTION);
  // Below the answer it routes, above the quieter conversion offer.
  assert.ok(html.indexOf('id="finops-first-run"') < html.indexOf(`id="${DESTINATION_SECTION_ID}"`));
  assert.ok(html.indexOf(`id="${DESTINATION_SECTION_ID}"`)
    < html.indexOf('id="finops-first-run-conversion"'));
  // And it says whose data ranked it before it says anything else.
  assert.match(textOf(byId(document, "finops-destinations-sample")), /bundled example/i);
});

test("painting the region makes the prioritized destination actionable in one link", async () => {
  const { document } = await loadPage(PAGE);
  const painted = applyWorkspaceDestinations(document, loaded);
  assert.ok(painted, "the region painted nothing");
  const section = byId(document, DESTINATION_SECTION_ID);
  assert.equal(section.dataset.state, DESTINATION_STATE.ranked);
  assert.equal(section.dataset.priorityClause, loaded.clause.code);

  const primary = prioritizedDestination(loaded.record);
  const link = byId(document, "finops-destination-primary");
  assert.ok(link, "no prioritized destination was rendered");
  assert.equal(link.tagName.toLowerCase(), "a");
  assert.equal(link.getAttribute("href"), primary.href);
  assert.equal(link.dataset.destinationRank, "1");
  assert.equal(link.dataset.destinationRole, primary.role);
  assert.ok(textOf(link).includes(primary.callToAction));

  // The rank, the label, the question it answers, and why it outranked the
  // others are all visible — none of the four is behind a disclosure, because a
  // recommendation a reader has to open is a recommendation they have to find.
  const block = document.querySelector(".dest-primary-block");
  assert.match(textOf(block), /rank 1 of 3/);
  assert.ok(textOf(block).includes(primary.label));
  assert.ok(textOf(block).includes(primary.answers));
  assert.ok(textOf(block).includes(loaded.clause.because));
  for (const node of [block, link]) {
    assert.equal(node.closest("details"), null, "the prioritized destination is behind a disclosure");
  }

  // The finding leads, and it never appears as a score with no basis.
  assert.equal(textOf(document.querySelector(".dest-finding")), loaded.record.finding.statement);
  assert.equal(textOf(document.querySelector(".dest-why")), loaded.record.finding.whyItMatters);
  assert.match(textOf(document.querySelector(".dest-confidence")), /0\.85 of 1\.00 · moderate/);
  assert.equal(textOf(document.querySelector(".dest-confidence-basis")),
    loaded.record.finding.confidence.basis);
});

test("the other two doors and the derivation stay behind progressive disclosure", async () => {
  const { document } = await loadPage(PAGE);
  applyWorkspaceDestinations(document, loaded);
  const body = byId(document, DESTINATION_BODY_ID);
  const disclosures = body.querySelectorAll("details.dest-disclosure");
  assert.equal(disclosures.length, 2);
  for (const details of disclosures) {
    // Native `details`, so it is keyboard-operable and state-bearing with no
    // script at all, and shut on arrival so the region is four lines by default.
    assert.equal(details.hasAttribute("open"), false);
    const summary = details.querySelector("summary");
    assert.ok(summary, "a disclosure with no summary cannot be operated");
    assert.equal(summary.querySelectorAll("h3").length, 1);
    assert.match(textOf(summary), /Show detail/);
  }

  const others = body.querySelectorAll("li.dest-other");
  assert.equal(others.length, 2);
  others.forEach((item, index) => {
    const entry = supportingDestinations(loaded.record)[index];
    assert.equal(item.dataset.destinationRank, String(entry.rank));
    const link = item.querySelector("a.dest-other-link");
    assert.equal(link.getAttribute("href"), entry.href);
    assert.ok(textOf(item).includes(entry.answers));
    assert.ok(textOf(item).includes(entry.doesNotAnswer));
    assert.ok(item.closest("details"), "a supporting door escaped its disclosure");
  });

  // The derivation carries the clause, the arithmetic, the thresholds, and the
  // provenance — everything needed to argue with the order rather than accept it.
  const derivation = textOf(document.querySelector(".dest-derivation"));
  assert.ok(derivation.includes(prioritizedDestination(loaded.record).selectionBasis));
  assert.ok(derivation.includes(PRIORITY_RULE_VERSION));
  assert.ok(derivation.includes(loaded.record.benchmark.basis));
  assert.ok(derivation.includes(loaded.record.rankedAction.priorityBasis));
  assert.ok(derivation.includes(loaded.record.finding.confidence.limits[0].detail));
  assert.ok(derivation.includes(loaded.record.finding.provenance.generatedAt));
  for (const entry of loaded.record.finding.evidence.entries) {
    assert.ok(derivation.includes(entry.detail), `evidence "${entry.term}" was not disclosed`);
  }
});

test("a record that failed its contract paints the withheld state, not half a ranking", async () => {
  const { document } = await loadPage(PAGE);
  const broken = clone(loaded.record);
  delete broken.destinations;
  const painted = applyWorkspaceDestinations(document, loadWorkspaceDestinations(broken));
  assert.equal(painted, null);
  const section = byId(document, DESTINATION_SECTION_ID);
  assert.equal(section.dataset.state, DESTINATION_STATE.unavailable);
  assert.equal(byId(document, "finops-destination-primary"), null);
  assert.match(textOf(document.querySelector(".dest-unavailable")), /No destination is ranked/);
  assert.match(textOf(document.querySelector(".dest-unavailable")), /contract check/);
});

test("the region retires with the example it was ranked from", async () => {
  const { document } = await loadPage(PAGE);
  applyWorkspaceDestinations(document, loaded);
  supersedeWorkspaceDestinations(document, true);
  const section = byId(document, DESTINATION_SECTION_ID);
  assert.equal(section.hidden, true);
  assert.equal(section.dataset.superseded, "true");
  supersedeWorkspaceDestinations(document, false);
  assert.equal(section.hidden, false);
  assert.equal(section.dataset.superseded, "false");
});

test("the shipped page entry paints the ranking with no fetch of its own", async () => {
  const { document } = await loadPage(PAGE, { routes: SERVED });
  await importPageModule("/evolution-page.js");
  await waitFor(() => byId(document, "finops-destination-primary") !== null,
    "the page entry never painted a prioritized destination");

  const link = byId(document, "finops-destination-primary");
  const primary = prioritizedDestination(loaded.record);
  assert.equal(link.getAttribute("href"), primary.href);
  assert.equal(byId(document, DESTINATION_SECTION_ID).dataset.state, DESTINATION_STATE.ranked);
  // The whole point of the region: the destination is reachable by keyboard
  // without opening a disclosure or scanning the rest of the document.
  assert.ok(tabSequence(document).includes(link),
    "the prioritized destination is not in the natural tab order");

  // The in-page doors name regions this document actually ships, so neither
  // link is a dead end a reader is told is evidence.
  for (const entry of loaded.record.destinations) {
    if (!entry.href.startsWith("#")) continue;
    assert.ok(byId(document, entry.href.slice(1)),
      `${entry.id} points at #${entry.href.slice(1)}, which this page does not have`);
  }
});
