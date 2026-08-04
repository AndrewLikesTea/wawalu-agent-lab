// Labelled declared-fact scenarios for the estimator (#1102).
//
// Each one exists to catch a specific way the estimator could go wrong, and
// says so on the record. The test file pins the exact figures every scenario
// produces, so a coefficient that moves fails a named case rather than a
// nameless number.
//
// These are DECLARED FACTS about invented organizations: no customer, tenant,
// provider, or visitor data, and nothing here is read from a file.

import { ORG_SIZE_BAND, PEER_INDUSTRY } from "./peer-cost-cohorts.js";

/**
 * The bundled example's own declared facts — the ones the first-run region
 * estimates from with no file imported.
 *
 * Spend is the example dataset's analyzed monthly total and headcount is the
 * declared engineer count behind the ledger's 4,900 terminal tasks; the two
 * cohort attributes are the example org's published profile. A test asserts the
 * spend here still equals the example dataset's own total, so the estimate and
 * the measured figure beside it can never describe two different companies.
 */
export const EXAMPLE_DECLARED_FACTS = Object.freeze({
  monthlySpendUsd: 154_500,
  engineers: 100,
  providerMix: Object.freeze({ frontier: 0.45, standard: 0.4, economy: 0.15 }),
  sizeBand: ORG_SIZE_BAND.enterprise,
  industry: PEER_INDUSTRY.saas,
});

/** Six labelled scenarios. `catches` is the reason the fixture exists. */
export const DECLARED_FACT_FIXTURES = Object.freeze([
  Object.freeze({
    name: "bundled-example-enterprise-saas",
    catches: "The figures the first-run region renders with no file imported.",
    facts: EXAMPLE_DECLARED_FACTS,
  }),
  Object.freeze({
    name: "frugal-small-saas",
    catches: "A cheap org must land in the top quartile, not merely below the median.",
    facts: Object.freeze({
      monthlySpendUsd: 9_000,
      engineers: 60,
      providerMix: Object.freeze({ frontier: 0.1, standard: 0.4, economy: 0.5 }),
      sizeBand: ORG_SIZE_BAND.small,
      industry: PEER_INDUSTRY.saas,
    }),
  }),
  Object.freeze({
    name: "mid-saas-middle-range",
    catches: "The middle band is reachable — a two-boundary table that only ever "
      + "emits top or bottom would pass a top-and-bottom-only fixture set.",
    facts: Object.freeze({
      monthlySpendUsd: 120_000,
      engineers: 150,
      providerMix: Object.freeze({ frontier: 0.3, standard: 0.5, economy: 0.2 }),
      sizeBand: ORG_SIZE_BAND.mid,
      industry: PEER_INDUSTRY.saas,
    }),
  }),
  Object.freeze({
    name: "zero-spend",
    catches: "A declared bill of zero must withhold the estimate, not publish "
      + "$0.00 per task and a flattering top quartile.",
    facts: Object.freeze({
      monthlySpendUsd: 0,
      engineers: 80,
      providerMix: Object.freeze({ frontier: 0.3, standard: 0.5, economy: 0.2 }),
      sizeBand: ORG_SIZE_BAND.enterprise,
      industry: PEER_INDUSTRY.saas,
    }),
  }),
  Object.freeze({
    name: "missing-headcount",
    catches: "No headcount means no denominator: the estimate must be withheld "
      + "rather than divided by a substituted org size.",
    facts: Object.freeze({
      monthlySpendUsd: 240_000,
      providerMix: Object.freeze({ frontier: 0.4, standard: 0.4, economy: 0.2 }),
      sizeBand: ORG_SIZE_BAND.enterprise,
      industry: PEER_INDUSTRY.financialServices,
    }),
  }),
  Object.freeze({
    name: "no-mix-no-cohort-attributes",
    catches: "Two independent degradations at once: the default mix is "
      + "substituted and the quartile is withheld, and the figure still stands "
      + "at a lowered tier.",
    facts: Object.freeze({
      monthlySpendUsd: 60_000,
      engineers: 45,
    }),
  }),
  Object.freeze({
    name: "implausible-declarations",
    catches: "Out-of-range spend and headcount are clamped to the published "
      + "plausible range and drop the tier, never used as declared.",
    facts: Object.freeze({
      monthlySpendUsd: 900_000_000,
      engineers: 400_000,
      providerMix: Object.freeze({ frontier: 0.5, standard: 0.5, economy: 0 }),
      sizeBand: ORG_SIZE_BAND.enterprise,
      industry: PEER_INDUSTRY.saas,
    }),
  }),
]);

/** Lookup by name, so a test names the scenario it is asserting on. */
export const declaredFactFixture = (name) =>
  DECLARED_FACT_FIXTURES.find((entry) => entry.name === name) ?? null;
