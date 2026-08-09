# Synthetic cohort contract v1

This contract is checked-in synthetic reference data for the bundled AI FinOps
provider-scenario analysis. It is local-only and introduces no provider, HRIS,
credential, upload, storage, or customer-data connection.

The closed schema permits only industry, organization-size and task-volume
bands; anonymized cost/performance measures; minimum aggregate member count;
snapshot publication metadata; and contract metadata. Unknown fields fail the
whole input closed. Direct identifiers, credentials, prompt/response content,
provider account identifiers, employee/HRIS records, and raw customer data are
prohibited.

Version mismatch is `incompatible_version`; partial input is `missing_data`;
unknown shapes, invalid calendar timestamps, duplicates, and future timestamps
are `malformed_input`; prohibited keys are `prohibited_field`; and snapshots
older than 90 days are `stale_input`. Reordering is immaterial because accepted
rows are sorted canonically. Fixtures are exported by
`src/synthetic-cohort-fixtures.js`; evaluation is deterministic because the
reference timestamp is supplied, with a pinned default for the bundled demo.
