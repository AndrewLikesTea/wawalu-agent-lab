// Labelled fixtures pinning which finding wins, what it is worth, and what it
// rests on.
//
// THE DISPUTE THIS SUITE IS WRITTEN FOR
// -------------------------------------
// A FinOps lead repeats the one sentence at the top of /evolution.html. The
// director whose team it grades asks two questions: why is THAT the finding you
// led with, and is it my data or your demo data? Neither question is answerable
// by reading the sentence. So each fixture below is a labelled input set with
// three pinned answers about the resolver's output — which finding wins, its
// confidence tier after the provenance rule, and its evidence class — plus the
// exact sentence the headline would assert.
//
// THE FIXTURES ARE AN ORACLE, NOT A SECOND IMPLEMENTATION
// ------------------------------------------------------
// Nothing here restates a ranking rule, a threshold, or a comparator. Every
// assertion is against `resolveFinding`'s actual output. A fixture that
// re-derived the winner would agree with a broken resolver, which is the one
// thing a fixture must never do. The `why` line on each fixture explains the
// answer in prose for a reader; the test does not consult it.
//
// WHAT IS NOT HERE. No department name, no tenant, no provider, no credential,
// no network, and no text out of anyone's file: the signals are invented
// sentences over invented figures, authored in
// tests/fixtures/finding-winner-fixtures.json.

import test from "node:test";
import assert from "node:assert/strict";

import {
  WINNER_FIXTURES, allWinnerDrift, resolveFixture, winnerDrift, winnerFixtures,
} from "./support/finding-fixtures.js";
import {
  CLAIM_TEMPLATE, CONFIDENCE_LEVELS, EVIDENCE_CLASS, PROVENANCE_KIND, SYNTHETIC_CLAIM_QUALIFIER,
  claimTemplateFor, evidenceClassOf,
} from "../src/finops-finding-resolver.js";
import { MEASURED_BENCHMARK_LANGUAGE } from "../src/finops/answer-spine-view.js";

const byName = (name) => winnerFixtures().find((fixture) => fixture.name === name);

// ---------------------------------------------------------------------------
// 1. Every fixture, on its three pinned answers.
// ---------------------------------------------------------------------------

for (const fixture of winnerFixtures()) {
  test(`fixture "${fixture.name}" resolves to the winner, tier, and evidence class it pins`, () => {
    const problems = winnerDrift(fixture);
    assert.deepEqual(problems, [], problems.join("\n"));
  });
}

test("the fixture set covers the cases a reader would dispute", () => {
  const names = winnerFixtures().map((fixture) => fixture.name);
  for (const required of ["clear-own-export-winner", "near-tie-provenance-tiebreak",
    "synthetic-only-degrades-the-wording", "insufficient-signal"]) {
    assert.ok(names.includes(required),
      `the fixture set no longer covers "${required}"; a case was dropped rather than re-pinned`);
  }
  // Every fixture says what it pins and why, because a pin nobody can explain is
  // a number this page is not allowed to show.
  for (const fixture of winnerFixtures()) {
    assert.ok((fixture.pins ?? "").length > 40, `fixture "${fixture.name}" does not say what it pins`);
    assert.ok((fixture.expected?.why ?? "").length > 40,
      `fixture "${fixture.name}" pins an outcome it does not explain`);
  }
  // And the assumptions behind every weight these fixtures depend on are stated
  // beside them rather than left implicit in a number.
  for (const key of ["materialityThresholds", "confidenceLadder", "syntheticDowngrade",
    "evidenceClassDefault", "provenanceTiebreak"]) {
    assert.ok((WINNER_FIXTURES.assumptions?.[key] ?? "").includes("ASSUMPTION"),
      `the fixtures depend on ${key} but state no assumption behind it`);
  }
});

// ---------------------------------------------------------------------------
// 2. The tier and the evidence class are the RESOLVER's, not this file's.
// ---------------------------------------------------------------------------

test("every published tier is on the resolver's own ladder and matches the winner's level", () => {
  for (const fixture of winnerFixtures()) {
    const { winner } = resolveFixture(fixture);
    if (!winner) continue;
    assert.ok(CONFIDENCE_LEVELS.includes(winner.confidenceTier),
      `fixture "${fixture.name}" produced a tier that is not on the confidence ladder`);
    // One source of truth: the published tier IS the post-downgrade level, and
    // the level the signal asked for is still traceable beside it.
    assert.equal(winner.confidenceTier, winner.confidence.level,
      `fixture "${fixture.name}" publishes a tier that disagrees with its own confidence level`);
    assert.ok(CONFIDENCE_LEVELS.includes(winner.confidence.statedLevel));
  }
});

test("the evidence class is derived from provenance in one place", () => {
  for (const fixture of winnerFixtures()) {
    const { winner, runnersUp } = resolveFixture(fixture);
    for (const finding of [winner, ...runnersUp].filter(Boolean)) {
      assert.equal(finding.evidenceClass, evidenceClassOf(finding.provenance),
        `fixture "${fixture.name}" carries a finding whose evidence class was not derived from `
        + "its provenance");
    }
  }
  // The unsafe direction is the one that matters: an unknown provenance is never
  // presented as the reader's own export.
  assert.equal(evidenceClassOf(null), EVIDENCE_CLASS.syntheticCohort);
  assert.equal(evidenceClassOf({ kind: "something_new" }), EVIDENCE_CLASS.syntheticCohort);
  assert.equal(evidenceClassOf({ kind: PROVENANCE_KIND.imported }), EVIDENCE_CLASS.ownExport);
});

// ---------------------------------------------------------------------------
// 3. Synthetic-only degrades the wording, and the degradation lives in the
//    resolver rather than in a view.
// ---------------------------------------------------------------------------

test("a synthetic-only winner is asserted behind the qualifier, not as a measured position", () => {
  const fixture = byName("synthetic-only-degrades-the-wording");
  const { winner, runnersUp } = resolveFixture(fixture);
  // Every available signal in this fixture rests on synthetic cohort boundaries.
  for (const finding of [winner, ...runnersUp]) {
    assert.equal(finding.evidenceClass, EVIDENCE_CLASS.syntheticCohort);
  }
  assert.equal(winner.claimTemplate, CLAIM_TEMPLATE.syntheticCohort);
  assert.ok(winner.assertedClaim.startsWith(SYNTHETIC_CLAIM_QUALIFIER),
    "a synthetic-only claim reached the headline without the qualifier in front of it");
  // The number itself is untouched: the wording degrades, the figure does not
  // widen, and a vaguer number over the same invented boundaries is never
  // offered as a safer one.
  assert.ok(winner.assertedClaim.endsWith(winner.claim),
    "the claim template rewrote the sentence instead of qualifying it");
  assert.equal(winner.impact.value, 2);
  // And it claims no measured population, in the page's own vocabulary.
  for (const phrase of MEASURED_BENCHMARK_LANGUAGE) {
    assert.ok(!winner.assertedClaim.toLowerCase().includes(phrase),
      `the degraded claim asserts a measured population ("${phrase}")`);
  }
});

test("the claim template is selected by evidence class, in the resolver, as a table", () => {
  // Own-export evidence asserts the authored sentence verbatim.
  const own = byName("clear-own-export-winner");
  const ownWinner = resolveFixture(own).winner;
  assert.equal(ownWinner.claimTemplate, CLAIM_TEMPLATE.ownExport);
  assert.equal(ownWinner.assertedClaim, ownWinner.claim);
  // The selection is a lookup any caller can make, so no surface needs a branch.
  assert.equal(claimTemplateFor(EVIDENCE_CLASS.ownExport).id, CLAIM_TEMPLATE.ownExport);
  assert.equal(claimTemplateFor(EVIDENCE_CLASS.syntheticCohort).id, CLAIM_TEMPLATE.syntheticCohort);
  // An evidence class nobody declared falls to the qualified template rather
  // than to the unqualified one.
  assert.equal(claimTemplateFor("invented-later").id, CLAIM_TEMPLATE.syntheticCohort);
});

// ---------------------------------------------------------------------------
// 4. Insufficient signal is a state, not an error — and not a tier.
// ---------------------------------------------------------------------------

test("with nothing that qualified there is no winner, no tier, and no evidence class", () => {
  const resolved = resolveFixture(byName("insufficient-signal"));
  assert.equal(resolved.winner, null);
  assert.deepEqual([...resolved.runnersUp], []);
  // The unavailable signal is skipped rather than reported as a failure: it is
  // not evidence that broke, it is evidence that was not there.
  assert.ok(!resolved.rejected.some((row) => row.id === "peer-position"));
  // Everything else is reported with its reason. Nothing is silently dropped.
  assert.equal(resolved.rejected.length, byName("insufficient-signal").expected.rejected.length);
});

// ---------------------------------------------------------------------------
// 5. The fixtures are inert: no order dependence, no stored prompt text.
// ---------------------------------------------------------------------------

test("a fixture's winner does not depend on the order its signals were authored in", () => {
  for (const fixture of winnerFixtures()) {
    const forward = resolveFixture(fixture);
    const reversed = resolveFixture({ ...fixture, signals: [...fixture.signals].reverse() });
    assert.equal(reversed.winner?.id ?? null, forward.winner?.id ?? null,
      `fixture "${fixture.name}" resolves a different winner when its signals are reversed`);
    assert.equal(reversed.winner?.assertedClaim ?? null, forward.winner?.assertedClaim ?? null);
  }
});

test("no fixture input carries instruction text, a real name, or anything fetched", () => {
  const serialized = JSON.stringify(WINNER_FIXTURES).toLowerCase();
  for (const forbidden of ["ignore all previous", "ignore previous", "system prompt",
    "http://", "https://", "api key", "bearer ", "psn_"]) {
    assert.ok(!serialized.includes(forbidden),
      `the fixture file carries "${forbidden}", which is untrusted or fetched content`);
  }
});

// ---------------------------------------------------------------------------
// 6. The drift check itself fails, and says what moved.
//
// A check that cannot fail is not a check. This perturbs a pinned value in
// memory — the file on disk is untouched — and asserts that the message names
// the fixture, the field, the expected value, and the actual one.
// ---------------------------------------------------------------------------

test("a perturbed pin fails the drift check with a message naming what moved", () => {
  assert.deepEqual(allWinnerDrift(), [], "the shipped fixtures already drift");

  const fixture = byName("synthetic-only-degrades-the-wording");
  const perturbedTier = winnerDrift({
    ...fixture, expected: { ...fixture.expected, confidenceTier: "high" },
  });
  assert.equal(perturbedTier.length, 1);
  assert.match(perturbedTier[0], /synthetic-only-degrades-the-wording/);
  assert.match(perturbedTier[0], /the confidence tier drifted/);
  assert.match(perturbedTier[0], /pins "high"/);
  assert.match(perturbedTier[0], /produced "moderate"/);

  const perturbedClaim = winnerDrift({
    ...fixture, expected: { ...fixture.expected, assertedClaim: "Something a director was told." },
  });
  assert.equal(perturbedClaim.length, 1);
  assert.match(perturbedClaim[0], /the rendered claim drifted/);
  assert.match(perturbedClaim[0], /Something a director was told\./);
  assert.match(perturbedClaim[0], new RegExp(SYNTHETIC_CLAIM_QUALIFIER.slice(0, 30)));
});
