// Browser-only compatibility contracts for the three hyperscaler AI usage and
// billing exports. This module is DATA: plain frozen objects, no I/O, no clock,
// no DOM. The evaluator (browser-compat-eligibility.js) and the workspace
// surface (browser-compat-view.js) both read it, so a shape claim a reader sees
// on screen and the rule the evaluator applies cannot drift apart.
//
// The three contracts intentionally share one field vocabulary. The shape below
// is the whole of it; every contract conforms, and a fourth would too.
//
// CONTRACT SHAPE
//   providerId        stable slug, never renamed once published
//   displayName       what the buyer's console calls this export
//   contractVersion   semver for THIS provider's shape, independent of
//                     manifestVersion, so one export can revise alone
//   description       one line: what the export is
//   exportShape       { format, encoding, topLevelStructure, recordLocation,
//                       signatureFields, freshnessWindowDays }
//                     signatureFields are the field paths that identify the
//                     provider. Detection uses format + these, and nothing
//                     else — no if-chain duplicates this knowledge.
//   requiredFields    [{ path, type, role, meaning }]  absent -> not eligible
//   optionalFields    [{ path, type, role, meaning, degradesWithout }]
//   unsupportedCases  [{ code, reason, remedy }]        -> rejected
//   degradedCases     [{ code, signal, behavior, resultStatus }]
//                     resultStatus says where the case lands: "degraded" for a
//                     confidence reduction, "supported" for a shape that is
//                     recognized and fully handled (record ordering). Both are
//                     enumerated here because both are shapes a real export
//                     arrives in; only the first one lowers the verdict.
//   localOnlyHandling { read, retained, discarded }
//
// FIELD ROLES — the closed vocabulary the evaluator reasons about.
export const FIELD_ROLES = Object.freeze({
  MODEL: "model-identity",
  UNITS: "unit-count",
  COST: "cost-amount",
  CURRENCY: "currency",
  TIMESTAMP: "timestamp",
  SCOPE: "account-scope",
});

// Case codes are stable and shared across contracts on purpose: the buyer-facing
// reason and remedy differ per provider, the machine-readable code does not, so
// a caller can branch once instead of three times.
export const UNSUPPORTED_CODES = Object.freeze({
  WRONG_PROVIDER: "wrong_provider_export",
  UNMODELED_VARIANT: "unmodeled_schema_variant",
  PROMPT_CONTENT: "prompt_content_present",
  ROLLUP_ONLY: "aggregated_rollup_only",
  EMPTY: "empty_or_header_only",
});

export const DEGRADED_CODES = Object.freeze({
  PARTIAL: "partial_period_coverage",
  STALE: "stale_export",
  MALFORMED_ROWS: "malformed_rows_skipped",
  REORDERED: "non_chronological_records",
});

// The prohibitions are one object, not three copies. Keys are stable for tests
// and branching; statements are what the page renders.
export const PRIVACY_POLICY = Object.freeze({
  positiveStatement: "Every file you choose is parsed in this browser tab. "
    + "No byte of it leaves this page, and no provider account is contacted.",
  prohibitions: Object.freeze([
    Object.freeze({
      key: "no_credentials",
      statement: "No credential is accepted or stored. There is no field for an "
        + "API key, access key, service-account file, or tenant login.",
    }),
    Object.freeze({
      key: "no_customer_data_transmitted",
      statement: "No customer data and no prompt or completion text is transmitted anywhere.",
    }),
    Object.freeze({
      key: "no_body_retention",
      statement: "No prompt or response body is retained after parsing. A record "
        + "carrying one is rejected rather than stripped.",
    }),
    Object.freeze({
      key: "no_live_provider_calls",
      statement: "No live provider API call is made. Compatibility is decided "
        + "from the file alone.",
    }),
    Object.freeze({
      key: "local_parse_only",
      statement: "All parsing happens in the browser; nothing is uploaded, "
        + "logged, or written to browser storage.",
    }),
  ]),
  // Field names whose presence means the export carries conversation bodies.
  // Shared because the prohibition is shared: it is not a per-provider judgment.
  prohibitedFieldNames: Object.freeze([
    "prompt", "prompt_text", "completion", "completion_text", "input_text",
    "output_text", "messages", "request_body", "response_body",
  ]),
});

// Written once, referenced by all three. Restating it per provider would be
// three chances to say something slightly different about the same rule.
const LOCAL_ONLY_HANDLING = Object.freeze({
  read: "Read from a file you select with the browser file picker, parsed in this tab.",
  retained: "Only the verdict: matched contract, status, case code, and counts.",
  discarded: "The file text, every field value, and every record are discarded "
    + "when the check returns. Nothing is written to storage or the network.",
});

const contract = (spec) => Object.freeze({
  ...spec,
  exportShape: Object.freeze({ ...spec.exportShape,
    signatureFields: Object.freeze(spec.exportShape.signatureFields) }),
  requiredFields: Object.freeze(spec.requiredFields.map((field) => Object.freeze(field))),
  optionalFields: Object.freeze(spec.optionalFields.map((field) => Object.freeze(field))),
  unsupportedCases: Object.freeze(spec.unsupportedCases.map((entry) => Object.freeze(entry))),
  degradedCases: Object.freeze(spec.degradedCases.map((entry) => Object.freeze(entry))),
  localOnlyHandling: LOCAL_ONLY_HANDLING,
});

// The degraded set is identical in structure for all three; only the signal
// wording that names provider-specific field paths differs, so it is built.
const degradedCases = ({ dateField, windowDays }) => [
  {
    code: DEGRADED_CODES.PARTIAL,
    signal: `The calendar days present in ${dateField} skip at least one day between the earliest and latest record.`,
    behavior: "Accepted as partial evidence. The count of missing days is reported and no total is labelled complete.",
    resultStatus: "degraded",
  },
  {
    code: DEGRADED_CODES.STALE,
    signal: `The latest ${dateField} is more than ${windowDays} days before the reference date supplied by the caller.`,
    behavior: "Accepted with the age in days reported. Freshness is measured against a caller-supplied reference date, never the wall clock.",
    resultStatus: "degraded",
  },
  {
    code: DEGRADED_CODES.MALFORMED_ROWS,
    signal: "Individual records are missing a required field or carry an unreadable date or number, while other records read cleanly.",
    behavior: "Those records are skipped, the skipped count is reported, and the rest of the export is still evaluated. The file is not rejected whole.",
    resultStatus: "degraded",
  },
  {
    code: DEGRADED_CODES.REORDERED,
    signal: `Records are not in ascending ${dateField} order.`,
    behavior: "Accepted at full confidence. Every rule is applied to a date-sorted copy, so record order is never assumed and a reordered export reaches the same verdict as a chronological one.",
    resultStatus: "supported",
  },
];

// Reason and remedy are per provider because the remedy names a real screen in
// that provider's console; the codes above are what callers branch on.
const unsupportedCases = ({ displayName, export: exportName, variant, rollup, empty }) => [
  {
    code: UNSUPPORTED_CODES.WRONG_PROVIDER,
    // Deliberately does not name a specific other provider: the evaluator
    // appends the one it actually detected, and a contract that guessed here
    // would be wrong as soon as a fourth contract is added.
    reason: `The file matches a different provider's contract, not ${displayName}.`,
    remedy: `Re-run the check against the provider the file came from, or choose the ${displayName} ${exportName} export you meant.`,
  },
  {
    code: UNSUPPORTED_CODES.UNMODELED_VARIANT,
    reason: "The file has this provider's shape but is missing a field this contract requires, so it is a schema variant the contract does not model.",
    remedy: variant,
  },
  {
    code: UNSUPPORTED_CODES.PROMPT_CONTENT,
    reason: "The export carries prompt or completion text. It is refused on privacy grounds, not because it failed to parse.",
    remedy: "Export the usage or billing view rather than an invocation or audit log. This contract never accepts conversation bodies.",
  },
  {
    code: UNSUPPORTED_CODES.ROLLUP_ONLY,
    reason: "The export is an aggregated rollup with no per-model breakdown, so no model can be attributed a cost.",
    remedy: rollup,
  },
  {
    code: UNSUPPORTED_CODES.EMPTY,
    reason: "The file has no usable usage records — it is empty, it is a header with nothing under it, or every record was unreadable.",
    remedy: empty,
  },
];

export const MANIFEST_VERSION = "browser-compatibility-contracts/1.0.0";

export const BROWSER_COMPAT_MANIFEST = Object.freeze({
  manifestVersion: MANIFEST_VERSION,
  generatedFor: "AI FinOps workspace · local export eligibility check (/evolution.html)",
  privacyPolicy: PRIVACY_POLICY,
  contracts: Object.freeze([
    contract({
      providerId: "bedrock",
      displayName: "AWS Bedrock",
      contractVersion: "1.0.0",
      description: "The Bedrock slice of an AWS Cost and Usage Report, exported as CSV.",
      exportShape: {
        format: "csv",
        encoding: "UTF-8",
        topLevelStructure: "One CSV table with a single header row.",
        recordLocation: "One usage record per data row under the header.",
        signatureFields: ["lineItem/UsageAccountId", "lineItem/UnblendedCost"],
        freshnessWindowDays: 35,
      },
      requiredFields: [
        { path: "lineItem/UsageStartDate", type: "ISO date", role: FIELD_ROLES.TIMESTAMP,
          meaning: "Calendar day the usage was recorded against." },
        { path: "product/model_id", type: "string", role: FIELD_ROLES.MODEL,
          meaning: "Bedrock model identifier the charge belongs to." },
        { path: "lineItem/UsageAmount", type: "number", role: FIELD_ROLES.UNITS,
          meaning: "Billed units — tokens or invocations, per the usage type." },
        { path: "lineItem/UnblendedCost", type: "number", role: FIELD_ROLES.COST,
          meaning: "Cost for the row in the billing currency." },
        { path: "lineItem/CurrencyCode", type: "ISO 4217 code", role: FIELD_ROLES.CURRENCY,
          meaning: "Currency the cost is stated in." },
        { path: "lineItem/UsageAccountId", type: "string", role: FIELD_ROLES.SCOPE,
          meaning: "AWS account the charge landed in." },
      ],
      optionalFields: [
        { path: "lineItem/UsageType", type: "string", role: FIELD_ROLES.UNITS,
          meaning: "Which meter the units came from.",
          degradesWithout: "Input and output tokens cannot be separated; units are reported as one total." },
        { path: "product/region", type: "string", role: FIELD_ROLES.SCOPE,
          meaning: "Region the model was invoked in.",
          degradesWithout: "Regional cost splits are unavailable." },
      ],
      unsupportedCases: unsupportedCases({
        displayName: "AWS Bedrock", export: "Cost and Usage Report",
        variant: "Re-export the Cost and Usage Report with the Bedrock columns above included; a report configured without cost or currency columns cannot be read.",
        rollup: "Export the Cost and Usage Report at resource level rather than a monthly service summary.",
        empty: "Widen the report period, or confirm Bedrock usage exists in the account you exported.",
      }),
      degradedCases: degradedCases({ dateField: "lineItem/UsageStartDate", windowDays: 35 }),
    }),
    contract({
      providerId: "vertex-ai",
      displayName: "Google Vertex AI",
      contractVersion: "1.0.0",
      description: "A Cloud Billing detailed-usage export for Vertex AI, one JSON object per line.",
      exportShape: {
        format: "jsonl",
        encoding: "UTF-8",
        topLevelStructure: "Newline-delimited JSON: one complete object per line, no wrapping array.",
        recordLocation: "Each line is one usage record.",
        signatureFields: ["usage_start_time", "project.id"],
        freshnessWindowDays: 35,
      },
      requiredFields: [
        { path: "usage_start_time", type: "ISO date", role: FIELD_ROLES.TIMESTAMP,
          meaning: "Start of the usage window for the record." },
        { path: "sku.model_id", type: "string", role: FIELD_ROLES.MODEL,
          meaning: "Vertex model the SKU maps to." },
        { path: "usage.amount", type: "number", role: FIELD_ROLES.UNITS,
          meaning: "Billed units in usage.unit." },
        { path: "cost", type: "number", role: FIELD_ROLES.COST,
          meaning: "Cost for the record." },
        { path: "currency", type: "ISO 4217 code", role: FIELD_ROLES.CURRENCY,
          meaning: "Currency the cost is stated in." },
        { path: "project.id", type: "string", role: FIELD_ROLES.SCOPE,
          meaning: "Cloud project the usage was billed to." },
      ],
      optionalFields: [
        { path: "usage.unit", type: "string", role: FIELD_ROLES.UNITS,
          meaning: "Unit the amount is counted in.",
          degradesWithout: "Units are reported as a bare count with no stated unit." },
        { path: "sku.description", type: "string", role: FIELD_ROLES.MODEL,
          meaning: "Human-readable SKU name.",
          degradesWithout: "Findings name the model id rather than the SKU a buyer sees on the invoice." },
      ],
      unsupportedCases: unsupportedCases({
        displayName: "Google Vertex AI", export: "detailed usage cost",
        variant: "Use the detailed usage cost export rather than the standard usage cost export; the standard export omits fields this contract requires.",
        rollup: "Export detailed usage cost, which carries a row per SKU, rather than a project-level cost summary.",
        empty: "Confirm the export period covers days with Vertex AI usage.",
      }),
      degradedCases: degradedCases({ dateField: "usage_start_time", windowDays: 35 }),
    }),
    contract({
      providerId: "azure-openai",
      displayName: "Azure OpenAI",
      contractVersion: "1.0.0",
      description: "An Azure Cost Management actual-cost export for Azure OpenAI, as a JSON envelope.",
      exportShape: {
        format: "json",
        encoding: "UTF-8",
        topLevelStructure: "One JSON object with a properties.rows array.",
        recordLocation: "properties.rows — one object per usage record.",
        // Chosen so that every rejected shape is still ATTRIBUTED to Azure: a
        // rollup with no meterName must be reported as Azure's rollup case, not
        // as an anonymous no-match, so meterName cannot be a signature field.
        signatureFields: ["resourceId", "costInBillingCurrency"],
        freshnessWindowDays: 35,
      },
      requiredFields: [
        { path: "date", type: "ISO date", role: FIELD_ROLES.TIMESTAMP,
          meaning: "Day the charge was accrued." },
        { path: "meterName", type: "string", role: FIELD_ROLES.MODEL,
          meaning: "Meter naming the deployed model and token direction." },
        { path: "quantity", type: "number", role: FIELD_ROLES.UNITS,
          meaning: "Billed units for the meter." },
        { path: "costInBillingCurrency", type: "number", role: FIELD_ROLES.COST,
          meaning: "Cost for the row in the billing currency." },
        { path: "billingCurrency", type: "ISO 4217 code", role: FIELD_ROLES.CURRENCY,
          meaning: "Currency the cost is stated in." },
        { path: "resourceId", type: "string", role: FIELD_ROLES.SCOPE,
          meaning: "Azure resource the deployment lives on." },
      ],
      optionalFields: [
        { path: "resourceGroup", type: "string", role: FIELD_ROLES.SCOPE,
          meaning: "Resource group the deployment belongs to.",
          degradesWithout: "Costs cannot be grouped below subscription level." },
        { path: "meterSubCategory", type: "string", role: FIELD_ROLES.MODEL,
          meaning: "Model family behind the meter.",
          degradesWithout: "Model-family rollups fall back to the raw meter name." },
      ],
      unsupportedCases: unsupportedCases({
        displayName: "Azure OpenAI", export: "actual cost",
        variant: "Export actual cost with the columns above selected; an amortized export configured without a currency column cannot be read.",
        rollup: "Export at meter granularity rather than a subscription-level monthly total.",
        empty: "Check that the export scope includes the subscription the Azure OpenAI resource lives in.",
      }),
      degradedCases: degradedCases({ dateField: "date", windowDays: 35 }),
    }),
  ]),
});

export const contractById = (providerId) =>
  BROWSER_COMPAT_MANIFEST.contracts.find((entry) => entry.providerId === providerId) ?? null;
