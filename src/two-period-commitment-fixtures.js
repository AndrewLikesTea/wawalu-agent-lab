// Portable, privacy-safe inputs for the committed-saving verdict.
//
// These records contain only canonical synthetic ids, calendar months, scope,
// and integer USD minor units. They deliberately contain no prompts, labels,
// provider payloads, credentials, timestamps, or row-level usage. A fixture can
// therefore cross a test/browser boundary without sending untrusted text to a
// scorer (and this evaluator has no judge or provider call to send it to).

const fixture = (id, followUpSpendMinor, options = {}) => Object.freeze({
  schemaVersion: "redacted-two-period-commitment/1.0.0",
  id,
  redacted: true,
  scope: "synthetic-example",
  commitment: Object.freeze({
    id: `${id}-commitment`,
    period: "2026-06",
    savingMinor: 10_000,
    scope: "synthetic-example",
  }),
  periods: Object.freeze([
    Object.freeze({ period: "2026-06", spendMinor: 100_000 }),
    ...(followUpSpendMinor === null ? []
      : [Object.freeze({ period: options.period ?? "2026-07", spendMinor: followUpSpendMinor })]),
  ]),
  followUpPeriod: options.period ?? "2026-07",
  expected: Object.freeze(options.expected),
});

export const TWO_PERIOD_COMMITMENT_FIXTURES = Object.freeze({
  verified: fixture("synthetic-verified", 90_000, {
    expected: { verdict: "met", movementMinor: 10_000 },
  }),
  unmet: fixture("synthetic-unmet", 99_000, {
    expected: { verdict: "missed", movementMinor: 1_000 },
  }),
  insufficientEvidence: fixture("synthetic-insufficient", null, {
    expected: { verdict: "not_enough_evidence", movementMinor: null },
  }),
});

