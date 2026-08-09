# Synthetic benchmark cohorts v1

This local-only contract supplies invented aggregate reference bands to the
bundled provider-scenario entry point. It is not a connection contract: release
review replaces the checked-in snapshot, and runtime code makes no provider or
HRIS request.

Only the schema's organization-size and industry categories, member count, and
monthly-spend percentiles are approved. Unknown fields fail closed. In
particular, identifiers (except the required publication `snapshot.id`),
credentials, prompts or responses, provider account IDs, employee/HRIS records,
and raw or customer data produce no cohort projection.

Delivery behavior is deterministic:

- Complete compatible snapshots validate as a whole and expose every validation
  reason. Partial or missing input is ineligible; no valid-looking rows leak out.
- Staleness is controlled by the published snapshot month, not the visitor's
  clock. A new month is a reviewed fixture/version update; runtime never falls
  back to live data. The ID month must equal `generatedAt`'s month.
- Malformed fields, invalid calendar date-times, incompatible versions, duplicate
  cohort keys, and prohibited fields make the whole snapshot ineligible.
- Cohort arrival order has no meaning. Eligible output is sorted by `cohortKey`,
  so reordered deliveries produce the same comparison input.

