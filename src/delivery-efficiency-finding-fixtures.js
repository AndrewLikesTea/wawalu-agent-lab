/**
 * Labelled fixtures for the delivery-finding scoring layer: one per reachable
 * classification, each carrying the label a human assigned it before the code ran.
 *
 * The label is the point. A rubric that is only ever compared against its own
 * output cannot be shown to agree with anything, so every fixture below declares
 * `expected` — the classification and reason a reviewer reading the numbers by
 * hand would assign — and a test asserts the module reproduces it. When the two
 * disagree, exactly one of them is wrong and the disagreement is visible in the
 * test name.
 *
 * Two rules keep this from becoming a fixture library:
 *
 *   1. **Every fixture goes through the shipped path.** Each is a provider
 *      analysis envelope plus release records, assembled by the same
 *      `spendPerDeliveryInput` the page calls, derived by the same
 *      `spendPerDeliveryDecision`, and scored by the same
 *      `deliveryEfficiencyFinding`. Nothing here hand-writes a finding, so a
 *      fixture cannot demonstrate an outcome the code cannot produce.
 *   2. **One fixture per classification, plus the one boundary that matters.**
 *      The sixth fixture is the band between the two thresholds, which is the only
 *      place the two thresholds can disagree with each other.
 *
 * The labels use the commissioning issue's words — "material deterioration",
 * "material improvement" — so the issue can be traced to the case it asked for.
 * They are fixture metadata and reach no reader: the findings these inputs produce
 * describe a recorded ratio moving up or down and call neither direction good.
 *
 * Every value is invented: no provider account, customer, or personnel data.
 */

import { deliveryEfficiencyFinding } from "./delivery-efficiency-finding.js";
import { spendPerDeliveryDecision, spendPerDeliveryInput } from "./spend-per-delivery.js";

/** Shiplog release shape, reduced to the fields the adapter reads. */
const release = (version, createdAt) => Object.freeze({
  id: `syn-release-${version}`,
  version,
  createdAt,
  status: "completed",
  decisionIds: Object.freeze([]),
});

/** Three completed releases inside a calendar month: the floor, exactly. */
const APRIL = Object.freeze([
  release("2026.4.0", "2026-04-08T00:00:00.000Z"),
  release("2026.4.1", "2026-04-21T00:00:00.000Z"),
  release("2026.4.2", "2026-04-29T00:00:00.000Z"),
]);
const MAY = Object.freeze([
  release("2026.5.0", "2026-05-06T00:00:00.000Z"),
  release("2026.5.1", "2026-05-19T00:00:00.000Z"),
  release("2026.5.2", "2026-05-27T00:00:00.000Z"),
]);
const JUNE = Object.freeze([
  release("2026.6.0", "2026-06-03T00:00:00.000Z"),
  release("2026.6.1", "2026-06-11T00:00:00.000Z"),
  release("2026.6.2", "2026-06-24T00:00:00.000Z"),
]);

const THREE_MONTHS_OF_RELEASES = Object.freeze([...APRIL, ...MAY, ...JUNE]);

const period = (start, end, spendUsd, exportId) => Object.freeze({
  period: `${start} to ${end}`, spendUsd, exportId, completeness: "complete",
});

/** A local-finops history envelope, reduced to the fields the adapter reads. */
const analysis = (periods) => Object.freeze({
  period: periods.at(-1).period,
  spendUsd: periods.at(-1).spendUsd,
  history: Object.freeze({ periods: Object.freeze(periods) }),
});

/**
 * The two trailing periods every comparison fixture shares. Three releases each,
 * so the trailing baseline is the mean of 96 000 / 3 and 98 000 / 3 — a shade over
 * 32 333 USD per recorded release. Every headline below is chosen against that
 * one number, so the arithmetic behind each expected label can be checked by hand.
 */
const TRAILING = Object.freeze([
  period("2026-04-01", "2026-05-01", 96_000, "syn-export-04"),
  period("2026-05-01", "2026-06-01", 98_000, "syn-export-05"),
]);

const headline = (spendUsd) => period("2026-06-01", "2026-07-01", spendUsd, "syn-export-06");

const withHeadline = (spendUsd, releases = THREE_MONTHS_OF_RELEASES) => spendPerDeliveryInput({
  analysis: analysis([...TRAILING, headline(spendUsd)]),
  releases,
  origin: "example",
  source: "Bundled synthetic spend periods and release records.",
});

export const DELIVERY_FINDING_FIXTURES = Object.freeze({
  /**
   * Material rise. 145 500 USD over the same three releases is 48 500 per
   * recorded release: +50.0% on a 32 333 baseline. That clears the 15% material
   * threshold and the 25% swing one more recorded release would cause at the
   * three-release floor, so a direction may be published — as a movement in two
   * recorded counts, and nothing more.
   */
  materialIncrease: Object.freeze({
    label: "material deterioration in the ratio: spend per recorded release rose materially",
    input: withHeadline(145_500),
    expected: Object.freeze({
      classification: "material_ratio_increase",
      reasonCode: "material_move_past_both_thresholds",
      direction: "higher",
      priorityRank: 2,
    }),
  }),

  /**
   * Material fall. 58 500 USD over three releases is 19 500 each: −39.7% on the
   * same baseline, past both thresholds in the other direction. Ranked
   * identically to the rise, because neither direction is labelled good or bad.
   */
  materialDecrease: Object.freeze({
    label: "material improvement in the ratio: spend per recorded release fell materially",
    input: withHeadline(58_500),
    expected: Object.freeze({
      classification: "material_ratio_decrease",
      reasonCode: "material_move_past_both_thresholds",
      direction: "lower",
      priorityRank: 2,
    }),
  }),

  /**
   * Stable. 99 000 USD over three releases is 33 000 each: +2.1%, well under the
   * material threshold. The finding says no material change and immediately says
   * that is not a claim that nothing changed.
   */
  stable: Object.freeze({
    label: "stable ratio: the move is inside the material band",
    input: withHeadline(99_000),
    expected: Object.freeze({
      classification: "stable_ratio",
      reasonCode: "within_material_band",
      direction: null,
      priorityRank: 4,
    }),
  }),

  /**
   * The band between the thresholds, and the only fixture where they disagree.
   * 116 400 USD over three releases is 38 800 each: +20.0%, past the 15% material
   * threshold — and inside the 25% one unrecorded release would move it by. No
   * direction is published, because the cheapest explanation for the move is a
   * release nobody wrote down.
   */
  indeterminate: Object.freeze({
    label: "insufficient evidence: the move is past the material threshold but inside the"
      + " single-release swing",
    input: withHeadline(116_400),
    expected: Object.freeze({
      classification: "insufficient_evidence",
      reasonCode: "within_single_release_sensitivity",
      direction: null,
      priorityRank: 3,
    }),
  }),

  /**
   * Low volume. Two completed releases in the headline month, so the derivation
   * withholds the ratio itself and this layer has no move to classify.
   */
  lowVolume: Object.freeze({
    label: "insufficient evidence: fewer completed releases in the headline period than the floor",
    input: withHeadline(125_500, Object.freeze([...APRIL, ...MAY, JUNE[0], JUNE[1]])),
    expected: Object.freeze({
      classification: "insufficient_evidence",
      reasonCode: "too_few_deliveries_in_period",
      direction: null,
      priorityRank: 3,
    }),
  }),

  /**
   * Invalid period alignment. Two of the three billing periods overlap, so the
   * same days of spend would be counted twice. Both sides carry records and the
   * arithmetic would still divide; the window it would describe does not exist.
   */
  invalidAlignment: Object.freeze({
    label: "invalid period alignment: overlapping billing periods",
    input: spendPerDeliveryInput({
      analysis: analysis([
        period("2026-04-01", "2026-05-01", 96_000, "syn-export-04"),
        period("2026-04-15", "2026-05-15", 98_000, "syn-export-04b"),
        headline(125_500),
      ]),
      releases: THREE_MONTHS_OF_RELEASES,
      origin: "example",
      source: "Bundled synthetic spend periods with an overlapping export.",
    }),
    expected: Object.freeze({
      classification: "invalid_period_alignment",
      reasonCode: "overlapping_spend_periods",
      direction: null,
      priorityRank: 1,
    }),
  }),
});

/** The scored fixture, through the shipped derivation and the shipped scorer. */
export function deliveryFindingFixture(name) {
  const fixture = DELIVERY_FINDING_FIXTURES[name];
  if (!fixture) throw new TypeError(`No delivery-finding fixture named ${name}.`);
  return deliveryEfficiencyFinding(spendPerDeliveryDecision(fixture.input));
}
