// The labelled winner fixtures, and the drift check over them.
//
// One loader and one comparison, shared by the fixture suite that pins winner
// selection and by the reproducibility suite from #721 that re-runs those pins.
// Two copies of this comparison would be two definitions of "drifted", and the
// point of a reproducibility check is that there is exactly one.
//
// WHAT THIS IS NOT. It re-implements no ranking rule. It calls
// `resolveFinding` on a fixture's own signals and compares the result with what
// that fixture pinned — nothing here knows why a finding wins, only whether the
// answer moved.
//
// The failure message is the deliverable. "expected 'moderate', got 'low'" sends
// a maintainer to a debugger; the message below names the fixture, the field,
// the pinned value, and the produced one, so the diff is readable from CI output
// alone.

import { readFile } from "node:fs/promises";

import { resolveFinding } from "../../src/finops-finding-resolver.js";

export const WINNER_FIXTURES = JSON.parse(await readFile(
  new URL("../fixtures/finding-winner-fixtures.json", import.meta.url), "utf8"));

/** Every labelled fixture, in the order it is authored. */
export const winnerFixtures = () => WINNER_FIXTURES.fixtures;

/** Recompute one fixture from its own inputs. No manifest override: the shipped one. */
export function resolveFixture(fixture) {
  return resolveFinding(fixture.signals);
}

/**
 * The four values a fixture pins about the winning finding, and the field name
 * each is reported under. `assertedClaim` is the sentence the headline would
 * render, so a wording change that nobody re-checked fails here by name.
 */
const PINNED = Object.freeze([
  ["the winning finding's id", "winnerId", (winner) => winner?.id ?? null],
  ["the confidence tier", "confidenceTier", (winner) => winner?.confidenceTier ?? null],
  ["the evidence class", "evidenceClass", (winner) => winner?.evidenceClass ?? null],
  ["the claim template", "claimTemplate", (winner) => winner?.claimTemplate ?? null],
  ["the rendered claim", "assertedClaim", (winner) => winner?.assertedClaim ?? null],
]);

const show = (value) => (value === null ? "nothing" : JSON.stringify(value));

/**
 * Every pinned value that moved, as a sentence a maintainer can act on.
 *
 * Returns the FULL list rather than the first drift: a check that stops at the
 * first one sends whoever fixes it back around the loop for the second.
 *
 * @returns {string[]} problems, empty when nothing drifted
 */
export function winnerDrift(fixture, resolved = resolveFixture(fixture)) {
  const problems = [];
  const expected = fixture?.expected ?? {};
  const { winner } = resolved;

  for (const [label, field, read] of PINNED) {
    const actual = read(winner);
    if (actual !== (expected[field] ?? null)) {
      problems.push(`fixture "${fixture.name}": ${label} drifted — the fixture pins `
        + `${show(expected[field] ?? null)}, the resolver produced ${show(actual)}.`);
    }
  }

  // A fixture that pins rejections pins all of them, in order: a signal that
  // silently stopped being reported is the same defect as one that started.
  if (Array.isArray(expected.rejected)) {
    const actual = resolved.rejected.map((row) => `${row.id}:${row.code}`);
    const pinned = expected.rejected.map((row) => `${row.id}:${row.code}`);
    if (actual.join(", ") !== pinned.join(", ")) {
      problems.push(`fixture "${fixture.name}": the rejected signals drifted — the fixture pins `
        + `[${pinned.join(", ")}], the resolver produced [${actual.join(", ")}].`);
    }
  }
  return problems;
}

/** Every fixture's drift, flattened. Empty is the whole assertion. */
export function allWinnerDrift(fixtures = winnerFixtures()) {
  return fixtures.flatMap((fixture) => winnerDrift(fixture));
}
