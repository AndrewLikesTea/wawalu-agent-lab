// Browser-native projection of Anya's reviewed provider contract fixtures.
// Keep this deliberately metadata-only: the demo needs neither provider content
// nor a runtime request to read the fixture files.
export const STATIC_GATEWAY_FIXTURES = Object.freeze([
  Object.freeze({
    fixture: "provider-usage-billing/v1/fixtures/valid.json",
    state: "completed",
    sourceType: "daily-org-unit-service",
    sampleWindow: "2026-07-24 through 2026-07-25",
    freshness: "Generated 2026-07-25 12:00 UTC · current",
    failureState: "none",
    sampleCount: 1,
  }),
  Object.freeze({
    fixture: "provider-usage-billing/v1/fixtures/partial.json",
    state: "unavailable",
    sourceType: "daily-org-unit-service",
    sampleWindow: "2026-07-24 through 2026-07-25",
    freshness: "Generated 2026-07-25 12:15 UTC · current",
    failureState: "group_suppressed · 3 records omitted · retry unavailable",
    sampleCount: 0,
  }),
  Object.freeze({
    fixture: "provider-usage-billing/v1/fixtures/stale.json",
    state: "unavailable",
    sourceType: "daily-org-unit-service",
    sampleWindow: "2026-07-18 through 2026-07-19",
    freshness: "Generated 2026-07-20 12:00 UTC · stale",
    failureState: "stale_snapshot · last complete sample retained",
    sampleCount: 0,
  }),
]);
