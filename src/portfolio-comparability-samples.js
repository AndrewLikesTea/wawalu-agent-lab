// Four local sample portfolios, and what each one teaches a reader.
//
// These exist so a FinOps lead can see what this page's judgment *does* before
// they have assembled a portfolio of their own — including the three ways it
// says "not yet", which are the interesting cases and the ones a happy-path
// demo never shows.
//
// EVERY VALUE HERE IS INVENTED. There is no customer, no account, no key, no
// prompt, no cost, and no file: a sample is a provider id, a window, a currency,
// a count of delivered requests, and a provenance *label* describing what kind
// of export such a record would have come from. The provider ids match the
// adapters the intake already reads, so the vocabulary on the page is one
// vocabulary — but nothing here opens an adapter or claims a reading of one.
//
// The counts are deliberately unremarkable. A sample built to look impressive
// invites a reader to compare providers, which is a question this contract does
// not answer and refuses to imply.
//
// THE CLOSED FIELD SET IS CHECKED HERE TOO, not only in the contract. Every
// bundled sample is screened against `PORTFOLIO_SAMPLE_FIELDS` on the way out of
// `evaluateSample`, and `screenBundledSamples` states the same thing for the
// whole list so a test can hold the shipped fixtures to it. A sample is the one
// input to this contract that ships inside the product, so it is the one that
// must never be the reason an undeclared field reaches a reader.

import {
  PORTFOLIO_SAMPLE_FIELDS, evaluatePortfolioComparability, screenPortfolioSample,
} from "./portfolio-comparability.js";

/** The window every sample declares. One month, half-open. */
const PERIOD = Object.freeze({ start: "2026-06-01", end: "2026-07-01" });

/** The providers every sample expects, in declaration order. */
const REQUIRED = Object.freeze(["openai", "anthropic", "aws"]);

/**
 * Build one sample record. `overrides` may only re-state a declared record
 * field: a helper that let a fixture author spell `internalNote` would be the
 * hole the contract closes, one layer above the contract.
 */
const record = (providerId, deliveryCount, label, overrides = {}) => {
  for (const field of Object.keys(overrides)) {
    if (!PORTFOLIO_SAMPLE_FIELDS.record.includes(field)) {
      throw new TypeError(`sample record override "${field}" is not a declared record field`);
    }
  }
  return Object.freeze({
    providerId,
    periodStart: PERIOD.start,
    periodEnd: PERIOD.end,
    currencyCode: "USD",
    deliveryCount,
    provenance: Object.freeze({ label }),
    ...overrides,
  });
};

const OPENAI = record("openai", 1841206, "OpenAI organization usage export");
const ANTHROPIC = record("anthropic", 962480, "Anthropic workspace usage export");
const AWS = record("aws", 415933, "Bedrock cost-and-usage export");

const portfolio = (portfolioId, records) => Object.freeze({
  portfolioId,
  currencyCode: "USD",
  requiredPeriodStart: PERIOD.start,
  requiredPeriodEnd: PERIOD.end,
  requiredProviders: REQUIRED,
  records: Object.freeze(records),
});

/**
 * The samples, in the order the chooser offers them: the answerable case first,
 * then the three refusals in remediation-tier order, so a reader stepping down
 * the list walks down the priority rule itself.
 */
export const PORTFOLIO_SAMPLES = Object.freeze([
  Object.freeze({
    id: "complete",
    label: "Complete portfolio",
    teaches: "What a defensible combination looks like: three providers, one window, "
      + "one currency, one record each.",
    portfolio: portfolio("sample-complete", [OPENAI, ANTHROPIC, AWS]),
  }),
  Object.freeze({
    id: "missing-provider",
    label: "A provider never arrived",
    teaches: "The absence nobody sees. Two providers look perfect; the portfolio is "
      + "two thirds of itself, and the total would be quietly low.",
    portfolio: portfolio("sample-missing-provider", [OPENAI, AWS]),
  }),
  Object.freeze({
    id: "overlapping-period",
    label: "One provider reported twice, overlapping",
    teaches: "Full coverage and still not combinable: every provider is present, but "
      + "one supplies a second window straddling the month, and the overlap cannot "
      + "be subtracted out.",
    portfolio: portfolio("sample-overlapping-period", [
      OPENAI,
      ANTHROPIC,
      AWS,
      record("anthropic", 118204, "Anthropic workspace usage export",
        { periodStart: "2026-06-15", periodEnd: "2026-07-15" }),
    ]),
  }),
  Object.freeze({
    id: "incompatible-currency",
    label: "One provider is billed in another currency",
    teaches: "The refusal to convert. A rate this product cannot obtain locally would "
      + "produce a figure nobody could reproduce, so the provider is held out and named.",
    portfolio: portfolio("sample-incompatible-currency", [
      OPENAI,
      ANTHROPIC,
      record("aws", 415933, "Bedrock cost-and-usage export", { currencyCode: "EUR" }),
    ]),
  }),
]);

/** The sample the panel opens on. The answerable one — the rest are chosen. */
export const DEFAULT_SAMPLE_ID = "complete";

/** Look up a sample by id, falling back to the default rather than to nothing. */
export function portfolioSample(id = DEFAULT_SAMPLE_ID) {
  return PORTFOLIO_SAMPLES.find((sample) => sample.id === id)
    ?? PORTFOLIO_SAMPLES.find((sample) => sample.id === DEFAULT_SAMPLE_ID);
}

/**
 * Screen every bundled sample against the closed field set. Returns the samples
 * that fail and why, so the answer to "do the shipped fixtures honour the
 * contract?" is a value a test asserts on rather than a claim in a comment.
 */
export function screenBundledSamples() {
  return Object.freeze(PORTFOLIO_SAMPLES
    .map((sample) => ({ id: sample.id, screening: screenPortfolioSample(sample.portfolio) }))
    .filter((entry) => !entry.screening.ok)
    .map((entry) => Object.freeze({ id: entry.id, defects: entry.screening.defects })));
}

/** Evaluate a sample by id. The one call the page makes. */
export function evaluateSample(id = DEFAULT_SAMPLE_ID) {
  const sample = portfolioSample(id);
  return Object.freeze({
    sample,
    result: evaluatePortfolioComparability(sample.portfolio),
  });
}
