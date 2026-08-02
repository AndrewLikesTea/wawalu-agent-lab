// Inspectable, static compatibility contract for the provider-native CSV path.
// This registry mirrors the two direct-provider dialect profiles the intake
// already consumes. It does not parse files, connect to a vendor, or retain data.

export const NATIVE_PROVIDER_CONTRACT_VERSION = "native-provider-exports/1.0.0";

const behavior = Object.freeze({
  partial: "Valid rows are partial evidence; skipped rows are counted and totals are never labelled complete.",
  stale: "Freshness is unknown because native CSV files carry no trustworthy export timestamp.",
  malformed: "Invalid rows are skipped with a counted reason; invalid values never become zero.",
  reordered: "Columns are matched by normalized header name, never position.",
  unsupported: "Missing, ambiguous, or unknown shapes are rejected; the existing manual mapping remains available.",
});

export const NATIVE_PROVIDER_COMPATIBILITY = Object.freeze([
  Object.freeze({
    id: "openai-usage-export", label: "OpenAI organization usage export", adapterVersion: 1,
    format: "CSV · UTF-8 · header row",
    required: Object.freeze(["usage_date", "model", "project", "n_context_tokens_total", "amount"]),
    optional: Object.freeze(["currency", "n_generated_tokens_total", "api_key_name"]), behavior,
  }),
  Object.freeze({
    id: "anthropic-usage-export", label: "Anthropic Console usage export", adapterVersion: 1,
    format: "CSV · UTF-8 · header row",
    required: Object.freeze(["date", "model", "workspace", "input_tokens", "cost_usd"]),
    optional: Object.freeze(["currency", "output_tokens", "api_key"]), behavior,
  }),
]);

export const NATIVE_PROVIDER_BOUNDARY = Object.freeze([
  "No credentials or provider account access", "No network request during import",
  "No prompt content retained, rendered, logged, or exported", "No raw customer data persisted",
  "No live provider, HRIS, or identity connection",
]);
