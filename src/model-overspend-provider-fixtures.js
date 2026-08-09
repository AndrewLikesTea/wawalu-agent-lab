// Labelled, synthetic v1.1 provider exports used to dispute the routing score.
// The JSON files contain only contract fields; assumptions live here so a
// reviewer can test the policy without allowing metadata into the importer.
export const MODEL_OVERSPEND_PROVIDER_FIXTURE_VERSION =
  "model-overspend-provider-fixtures/1.0.0";

export const MODEL_OVERSPEND_PROVIDER_FIXTURES = Object.freeze([
  Object.freeze({
    id: "eligible",
    url: "/model-overspend-provider-eligible.json",
    assumption: "A model is a routing candidate only when this same segment records at least "
      + "1,000 requests on it and on a cheaper observed model. Savings use the nearest cheaper "
      + "observed cost per request; no quality equivalence is assumed.",
    expected: Object.freeze({ metricAvailable: true, withholding: Object.freeze([]),
      amountMinor: 232500, confidence: "low" }),
  }),
  Object.freeze({
    id: "missing-model",
    url: "/model-overspend-provider-missing-model.json",
    assumption: "A null model identifier cannot be assigned a rate, so recoverable spend is "
      + "withheld instead of treating the row as zero opportunity.",
    expected: Object.freeze({ metricAvailable: false,
      withholding: Object.freeze(["model_identifier_missing"]), confidence: "low" }),
  }),
  Object.freeze({
    id: "insufficient-observed-cost",
    url: "/model-overspend-provider-no-cost.json",
    assumption: "At least one positive USD minor unit is required to observe a paid rate; zero "
      + "cost is not evidence of free usage and cannot support recoverable-spend arithmetic.",
    expected: Object.freeze({ metricAvailable: false,
      withholding: Object.freeze(["insufficient_observed_cost"]), confidence: "low" }),
  }),
]);

export const ELIGIBLE_MODEL_OVERSPEND_PROVIDER_FIXTURE = MODEL_OVERSPEND_PROVIDER_FIXTURES[0];
