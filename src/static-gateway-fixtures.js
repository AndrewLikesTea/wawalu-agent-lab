// Browser-native copies of Anya's reviewed v1 valid fixtures. Keeping this
// allowlisted projection in the immutable site artifact makes the simulation
// asynchronous without introducing a runtime API, credential, or live source.

export const STATIC_GATEWAY_FIXTURES = Object.freeze({
  hris: Object.freeze({
    schema_version: "1.0",
    kind: "wawalu.integration.hris-org",
    export_id: "10000000-0000-4000-8000-000000000001",
    snapshot: Object.freeze({
      generated_at: "2026-07-25T12:00:00Z",
      completeness: "complete",
    }),
    records: Object.freeze([
      Object.freeze({ operation: "upsert", active: true, unit_type: "company" }),
      Object.freeze({ operation: "upsert", active: true, unit_type: "department" }),
    ]),
  }),
  provider: Object.freeze({
    schema_version: "1.0",
    kind: "wawalu.integration.provider-usage-billing",
    export_id: "30000000-0000-4000-8000-000000000001",
    snapshot: Object.freeze({
      generated_at: "2026-07-25T12:00:00Z",
      period_start: "2026-07-24",
      period_end: "2026-07-25",
      completeness: "complete",
    }),
    privacy: Object.freeze({ minimum_group_size: 10 }),
    records: Object.freeze([Object.freeze({ provider: "openai" })]),
  }),
});
