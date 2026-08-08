// Executive eligibility for one locally validated provider export.
//
// The question is deliberately narrower than the rest of the analysis:
// "What money fact can a leader act on from this export alone?" Only model
// identifiers, billed cost, the export's period declaration, and request counts
// are read. Prompt content, credentials, model quality, and external rate cards
// are outside this decision.

import { readUsageDetail } from "./provider-usage-record.js";

export const IMPORT_ELIGIBILITY_VERSION = "imported-export-eligibility/1.0.0";

export const IMPORT_ELIGIBILITY_STATE = Object.freeze({
  COST_PER_REQUEST: "eligible_cost_per_request",
  MODEL_SPEND: "eligible_model_spend",
  INSUFFICIENT_PERIOD: "insufficient_period_coverage",
  INSUFFICIENT_MODEL: "insufficient_model_identifier",
  INSUFFICIENT_COST: "insufficient_cost_evidence",
});

const usd = (value) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2,
}).format(value);

function result(state, fields) {
  return Object.freeze({
    version: IMPORT_ELIGIBILITY_VERSION,
    question: "What money fact can a leader act on from this export alone?",
    state,
    ...fields,
    boundary: "Uses export model identifiers, final USD cost, declared period coverage, and request counts only. It makes no claim about prompt content, credentials, model quality, or savings.",
  });
}

function insufficient(state, answer, field, reason) {
  return result(state, {
    eligible: false, answer, metric: null, confidence: null, provenance: null,
    nextAction: `Add export field ${field}. ${reason}`,
    requiredField: field,
  });
}

/**
 * Determine the single strongest money answer supported by export fields.
 *
 * Period coverage is complete iff the export declares `complete`, reports zero
 * omitted records and no issues, and has an ordered [start, end) date range.
 * Cost evidence is observed iff every accepted row has a non-negative integer
 * USD minor-unit amount with status `final`. Request volume qualifies the unit
 * metric iff every row has a non-negative integer count and their sum is > 0.
 */
export function determineImportedExportEligibility(document) {
  const snapshot = document?.snapshot ?? {};
  const records = Array.isArray(document?.records) ? document.records : [];
  const orderedPeriod = typeof snapshot.period_start === "string"
    && typeof snapshot.period_end === "string" && snapshot.period_start < snapshot.period_end;
  if (!orderedPeriod) return insufficient(
    IMPORT_ELIGIBILITY_STATE.INSUFFICIENT_PERIOD,
    "No money metric is publishable because the export does not establish a complete period.",
    "snapshot.period_end",
    "Supply an exclusive period end later than period_start.",
  );
  if (snapshot.completeness !== "complete") return insufficient(
    IMPORT_ELIGIBILITY_STATE.INSUFFICIENT_PERIOD,
    "No money metric is publishable because the export declares a partial period.",
    "snapshot.completeness", "Set it to complete when the provider finalizes the period.");
  if (snapshot.omitted_record_count !== 0) return insufficient(
    IMPORT_ELIGIBILITY_STATE.INSUFFICIENT_PERIOD,
    "No money metric is publishable because the export declares omitted records.",
    "snapshot.omitted_record_count", "Re-export with zero omitted records.");
  if (!Array.isArray(snapshot.issues) || snapshot.issues.length !== 0) return insufficient(
    IMPORT_ELIGIBILITY_STATE.INSUFFICIENT_PERIOD,
    "No money metric is publishable because the export declares period issues.",
    "snapshot.issues", "Re-export after the provider resolves every declared issue.");

  if (!records.length || records.some((row) => readUsageDetail(row).model_raw === null)) {
    return insufficient(
      IMPORT_ELIGIBILITY_STATE.INSUFFICIENT_MODEL,
      "No model-level money metric is publishable because at least one billed row has no model identifier.",
      "records[].model_raw",
      "Supply the provider model identifier on every billed row.",
    );
  }

  const pricedUsd = records.every((row) => Number.isInteger(row?.cost?.amount_minor)
    && row.cost.amount_minor >= 0 && row.cost.currency === "USD");
  if (!pricedUsd) return insufficient(
    IMPORT_ELIGIBILITY_STATE.INSUFFICIENT_COST,
    "No observed money metric is publishable because final USD cost is absent or provisional.",
    "records[].cost.amount_minor",
    "Supply a non-negative final USD minor-unit amount on every billed row.",
  );
  if (records.some((row) => row.cost.status !== "final")) return insufficient(
    IMPORT_ELIGIBILITY_STATE.INSUFFICIENT_COST,
    "No observed money metric is publishable because at least one charge is provisional.",
    "records[].cost.status", "Set every row to final after the provider finalizes charges.");

  const amountMinor = records.reduce((sum, row) => sum + row.cost.amount_minor, 0);
  const counts = records.map((row) => readUsageDetail(row).request_count);
  const completeCounts = counts.every((count) => Number.isInteger(count) && count >= 0);
  const requests = completeCounts ? counts.reduce((sum, count) => sum + count, 0) : 0;
  if (completeCounts && requests > 0) {
    const perRequest = amountMinor / 100 / requests;
    return result(IMPORT_ELIGIBILITY_STATE.COST_PER_REQUEST, {
      eligible: true,
      answer: `${usd(perRequest)} observed cost per request across the complete export period.`,
      metric: Object.freeze({ id: "observed_cost_per_request_usd", valueUsd: perRequest,
        display: `${usd(perRequest)} per request`,
        definition: "Sum of final USD amount_minor ÷ 100 ÷ sum of request_count across all accepted rows in the complete [period_start, period_end) period." }),
      confidence: "High for this export period: all accepted model rows carry final USD cost and request counts.",
      provenance: `${records.length} accepted provider-export rows; ${requests} requests; browser-local deterministic sum.`,
      nextAction: "Review the highest-cost model outside this view, then require an owner to validate whether its observed cost per request warrants a routing change.",
      requiredField: null,
    });
  }

  return result(IMPORT_ELIGIBILITY_STATE.MODEL_SPEND, {
    eligible: true,
    answer: `${usd(amountMinor / 100)} observed model spend across the complete export period.`,
    metric: Object.freeze({ id: "observed_model_spend_usd", valueUsd: amountMinor / 100,
      display: usd(amountMinor / 100),
      definition: "Sum of final USD amount_minor across all model-identified accepted rows in the complete [period_start, period_end) period, divided by 100 once." }),
    confidence: "High for observed spend in this export period; no per-request benchmark is claimed.",
    provenance: `${records.length} accepted provider-export rows; browser-local deterministic sum.`,
    nextAction: "Prioritize review of the highest-spend model outside this view before changing routing.",
    requiredField: null,
    upgrade: Object.freeze({ field: "records[].request_count",
      reason: "A non-negative count on every row, with a total above zero, would support observed cost per request." }),
  });
}
