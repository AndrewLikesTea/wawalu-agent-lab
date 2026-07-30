/**
 * The three states of the spend-per-delivery comparison, as local fixtures.
 *
 * Two rules keep this file from growing into a fixture library:
 *
 *   1. **One fixture per publishable state, and no more.** Eligible, insufficient,
 *      and mismatched-period are the three states the surface renders; anything
 *      else a reader could hit is a reason code inside one of them, and a reason
 *      code is asserted by building the input in the test that needs it.
 *   2. **They go through the shipped path.** Each fixture is a provider-analysis
 *      envelope plus release records, assembled by the same
 *      `spendPerDeliveryInput` adapter the page calls and scored by the same
 *      `spendPerDeliveryDecision`. Nothing here hand-writes a decision record, so
 *      a fixture cannot demonstrate a state the calculation cannot produce.
 *
 * Every value is invented. No provider account, customer, or personnel data is
 * involved, and `EXAMPLE_DELIVERY_RELEASES` is the release evidence the FinOps
 * tab pairs with its bundled example dataset — synthetic on both sides, so the
 * example never borrows a reader's own release log to make a figure look ready.
 */

import { spendPerDeliveryDecision, spendPerDeliveryInput } from "./spend-per-delivery.js";

/** Shiplog release shape, reduced to the four fields the adapter reads. */
const release = (version, createdAt) => Object.freeze({
  id: `syn-release-${version}`,
  version,
  createdAt,
  status: "completed",
  decisionIds: Object.freeze([]),
});

/**
 * Synthetic delivery evidence for the bundled example dataset, whose provider
 * periods are the six calendar months of 2026-01 to 2026-06. Releases sit in the
 * last three of those months: the newest month is the headline, the two before it
 * are the trailing baseline, and the three months with no releases demonstrate
 * that a period which fails the floor is excluded from the baseline rather than
 * counted as zero.
 */
export const EXAMPLE_DELIVERY_RELEASES = Object.freeze([
  release("2026.4.0", "2026-04-08T00:00:00.000Z"),
  release("2026.4.1", "2026-04-21T00:00:00.000Z"),
  release("2026.4.2", "2026-04-29T00:00:00.000Z"),
  release("2026.5.0", "2026-05-06T00:00:00.000Z"),
  release("2026.5.1", "2026-05-19T00:00:00.000Z"),
  release("2026.5.2", "2026-05-27T00:00:00.000Z"),
  release("2026.6.0", "2026-06-03T00:00:00.000Z"),
  release("2026.6.1", "2026-06-11T00:00:00.000Z"),
  release("2026.6.2", "2026-06-24T00:00:00.000Z"),
]);

/** A local-finops history envelope, reduced to the fields the adapter reads. */
const analysis = (periods) => Object.freeze({
  period: periods.at(-1).period,
  spendUsd: periods.at(-1).spendUsd,
  history: Object.freeze({ periods: Object.freeze(periods) }),
});

const period = (start, end, spendUsd, exportId) => Object.freeze({
  period: `${start} to ${end}`, spendUsd, exportId, completeness: "complete",
});

const THREE_MONTHS = Object.freeze([
  period("2026-04-01", "2026-05-01", 96_000, "syn-export-04"),
  period("2026-05-01", "2026-06-01", 98_000, "syn-export-05"),
  period("2026-06-01", "2026-07-01", 125_500, "syn-export-06"),
]);

export const SPEND_PER_DELIVERY_FIXTURES = Object.freeze({
  /**
   * Eligible. Three consecutive complete months of spend and three completed
   * releases in each — the floor exactly, which is also how the surface shows that
   * the floor is inclusive. Spend rises sharply in the newest month while the
   * release count holds, so the headline ratio sits above the trailing baseline.
   * That is the case a leader most needs to read correctly: it is a fact about two
   * recorded counts, not a verdict on the team.
   */
  eligible: Object.freeze(spendPerDeliveryInput({
    analysis: analysis(THREE_MONTHS),
    releases: EXAMPLE_DELIVERY_RELEASES,
    origin: "example",
    source: "Bundled synthetic spend periods and release records.",
  })),

  /**
   * Insufficient, with no delivery evidence at all — the state a first-time
   * reader is actually in, and the one that carries the prioritized next action.
   * Spend is present and complete; there is simply nothing to divide it by.
   */
  insufficient: Object.freeze(spendPerDeliveryInput({
    analysis: analysis(THREE_MONTHS),
    releases: [],
    origin: "example",
    source: "Bundled synthetic spend periods with an empty release log.",
  })),

  /**
   * Mismatched period. Both sides carry records, and they describe different
   * windows: every recorded release shipped in 2026-01, months before the billing
   * periods that were read. The arithmetic would still divide; the result would
   * mean nothing, so no ratio is published.
   */
  mismatched: Object.freeze(spendPerDeliveryInput({
    analysis: analysis(THREE_MONTHS),
    releases: Object.freeze([
      release("2026.1.0", "2026-01-09T00:00:00.000Z"),
      release("2026.1.1", "2026-01-18T00:00:00.000Z"),
      release("2026.1.2", "2026-01-27T00:00:00.000Z"),
    ]),
    origin: "example",
    source: "Bundled synthetic spend periods with releases from an earlier window.",
  })),
});

/** The scored fixture, through the shipped calculation. */
export function spendPerDeliveryFixture(name) {
  const input = SPEND_PER_DELIVERY_FIXTURES[name];
  if (!input) throw new TypeError(`No spend-per-delivery fixture named ${name}.`);
  return spendPerDeliveryDecision(input);
}
