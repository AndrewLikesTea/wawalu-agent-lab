// The metric definitions behind the leading finding.
//
// These are the numbers an executive repeats out loud, so the tests pin the
// definition rather than the wording: which month is the reporting period, what
// the change is against, when a percentage does not exist at all, which
// department counts as the driver when two grew by the same amount, and what
// the finding refuses to claim when the history cannot support it.

import assert from "node:assert/strict";
import test from "node:test";
import { loadExampleDataset } from "../src/example-dataset.js";
import { leadingFinding } from "../src/finops-leading-finding.js";

/** A minimal envelope in the shape `normalizeLocalFinopsHistory` returns. */
function envelope({ periods, departments, action = "Do the prioritized thing.", state = "available" }) {
  return {
    period: periods.at(-1).period,
    action,
    rankedDepartments: departments,
    history: {
      state,
      message: "History is unavailable.",
      periodCount: periods.length,
      currentPeriod: periods.at(-1).period,
      previousPeriod: periods.at(-2)?.period ?? null,
      periods,
    },
  };
}

const period = (start, end, spendUsd) => ({ period: `${start} to ${end}`, spendUsd });
const department = (id, name, spendUsd, previousSpendUsd, recoverableUsd = 0) =>
  ({ id, name, spendUsd, previousSpendUsd, recoverableUsd });

// --- the definitions -------------------------------------------------------

test("the reporting period is the newest month and the change is against the one before it", () => {
  const finding = leadingFinding(envelope({
    periods: [
      period("2026-04-01", "2026-05-01", 100),
      period("2026-05-01", "2026-06-01", 200),
      period("2026-06-01", "2026-07-01", 250),
    ],
    departments: [department("a", "Alpha", 250, 200)],
  }));
  assert.equal(finding.available, true);
  assert.equal(finding.reportingPeriod, "2026-06-01 to 2026-07-01");
  assert.equal(finding.reportingLabel, "June 2026");
  assert.equal(finding.priorPeriod, "2026-05-01 to 2026-06-01");
  assert.equal(finding.priorLabel, "May 2026");
  assert.equal(finding.totalSpendUsd, 250);
  assert.equal(finding.priorTotalSpendUsd, 200);
  assert.equal(finding.changeUsd, 50);
  assert.equal(finding.changePercent, 25);
  assert.equal(finding.question, "Why did spend rise in June 2026?");
  // Rendered currency through the repo's own `formatSignedUsd`, and the panel's
  // existing one-decimal percent, which drops a trailing zero rather than
  // inventing precision the analysis did not claim. The MODEL is unchanged —
  // `changeUsd` above is still the full-precision number.
  assert.equal(finding.metric, "+$50 (+25%) versus May 2026");
});

test("a zero prior period yields an amount and no percentage at all", () => {
  const finding = leadingFinding(envelope({
    periods: [period("2026-05-01", "2026-06-01", 0), period("2026-06-01", "2026-07-01", 900)],
    departments: [department("a", "Alpha", 900, 0)],
  }));
  assert.equal(finding.changeUsd, 900);
  assert.equal(finding.changePercent, null, "a percentage of nothing does not exist");
  assert.match(finding.metric, /\+\$900/);
  // No divide-by-zero artefact reaches the reader in any form.
  for (const text of [finding.metric, finding.driverSentence, finding.question])
    assert.doesNotMatch(text, /NaN|Infinity|∞/);
  assert.doesNotMatch(finding.metric, /%/);
});

test("a falling or flat month suppresses the driver share rather than misstating it", () => {
  const falling = leadingFinding(envelope({
    periods: [period("2026-05-01", "2026-06-01", 500), period("2026-06-01", "2026-07-01", 400)],
    // Alpha still grew; the organization shrank. Its share of a fall is meaningless.
    departments: [department("a", "Alpha", 120, 100), department("b", "Beta", 280, 400)],
  }));
  assert.equal(falling.changeUsd, -100);
  assert.equal(falling.changePercent, -20);
  assert.equal(falling.question, "Why did spend fall in June 2026?");
  assert.equal(falling.driverContributionPercent, null);
  assert.doesNotMatch(falling.driverSentence, /%/);

  const flat = leadingFinding(envelope({
    periods: [period("2026-05-01", "2026-06-01", 500), period("2026-06-01", "2026-07-01", 500)],
    departments: [department("a", "Alpha", 300, 200), department("b", "Beta", 200, 300)],
  }));
  assert.equal(flat.changeUsd, 0);
  assert.equal(flat.changePercent, 0);
  assert.equal(flat.question, "Why was spend flat in June 2026?");
  assert.equal(flat.driverContributionPercent, null);
});

test("the top driver breaks ties deterministically, never arbitrarily", () => {
  const periods = [period("2026-05-01", "2026-06-01", 100), period("2026-06-01", "2026-07-01", 220)];
  // Equal deltas: higher reporting-period spend wins.
  const bySpend = leadingFinding(envelope({
    periods,
    departments: [
      department("d-1", "Bravo", 90, 30),
      department("d-2", "Alpha", 130, 70),
    ],
  }));
  assert.equal(bySpend.driver.name, "Alpha");

  // Equal deltas and equal spend: department name ascending wins.
  const byName = leadingFinding(envelope({
    periods,
    departments: [
      department("d-2", "Zulu", 110, 50),
      department("d-1", "Alpha", 110, 50),
    ],
  }));
  assert.equal(byName.driver.name, "Alpha");

  // Input order never decides. The same rows reversed produce the same driver.
  const reversed = leadingFinding(envelope({
    periods,
    departments: [
      department("d-1", "Alpha", 110, 50),
      department("d-2", "Zulu", 110, 50),
    ],
  }));
  assert.equal(reversed.driver.id, byName.driver.id);
});

test("no department growing leaves the finding without a driver instead of inventing one", () => {
  const finding = leadingFinding(envelope({
    periods: [period("2026-05-01", "2026-06-01", 500), period("2026-06-01", "2026-07-01", 300)],
    departments: [department("a", "Alpha", 300, 500)],
  }));
  assert.equal(finding.driver, null);
  assert.equal(finding.driverContributionPercent, null);
  assert.equal(finding.action.available, false);
  assert.match(finding.action.text, /No department grew/);
});

test("an action that names a different department is refused, not quietly paired", () => {
  const finding = leadingFinding(envelope({
    periods: [period("2026-05-01", "2026-06-01", 100), period("2026-06-01", "2026-07-01", 200)],
    departments: [
      // Rank 1 by the analysis's own ordering, but not the driver of the rise.
      department("a", "Alpha", 60, 55, 40),
      department("b", "Bravo", 140, 45, 10),
    ],
    action: "Pilot lower-cost routing in Alpha.",
  }));
  assert.equal(finding.driver.name, "Bravo");
  assert.equal(finding.action.available, false);
  assert.match(finding.action.text, /names Alpha, not the driver/);
});

test("an unusable history states why instead of producing a number", () => {
  const single = leadingFinding(envelope({
    periods: [period("2026-06-01", "2026-07-01", 400)],
    departments: [department("a", "Alpha", 400, null)],
  }));
  assert.equal(single.available, false);
  assert.equal(single.changeUsd, null);
  assert.equal(single.metric, "Unavailable");

  const incompatible = leadingFinding(envelope({
    state: "incompatible",
    periods: [period("2026-03-01", "2026-04-01", 100), period("2026-06-01", "2026-07-01", 400)],
    departments: [department("a", "Alpha", 400, 100)],
  }));
  assert.equal(incompatible.available, false);
  assert.equal(incompatible.reason, "History is unavailable.");

  assert.equal(leadingFinding(null).available, false);
  assert.equal(leadingFinding({}).available, false);
});

// --- the shipped example ---------------------------------------------------

test("the example dataset produces one unambiguous finding through the real path", () => {
  const finding = leadingFinding(loadExampleDataset());

  assert.equal(finding.available, true);
  assert.equal(finding.question, "Why did spend rise in June 2026?");
  assert.equal(finding.totalSpendUsd, 154_500);
  assert.equal(finding.priorTotalSpendUsd, 115_300);
  assert.equal(finding.changeUsd, 39_200);
  assert.equal(Math.round(finding.changePercent * 10) / 10, 34);
  assert.equal(finding.metric, "+$39,200 (+34%) versus May 2026");

  assert.equal(finding.driver.name, "Atlas Platform");
  assert.equal(finding.driver.deltaUsd, 34_500);
  assert.equal(Math.round(finding.driverContributionPercent * 10) / 10, 88);
  assert.match(finding.driverSentence, /Atlas Platform contributed \+\$34,500 /);
  assert.match(finding.driverSentence, /88% of it/);

  // The prioritized action is the analysis's own, and it names the same driver.
  assert.equal(finding.action.available, true);
  assert.match(finding.action.text, /Atlas Platform/);
  assert.equal(finding.action.text, loadExampleDataset().action);
});
