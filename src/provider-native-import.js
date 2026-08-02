// Provider-native local export intake (#930). Pure and side-effect free: the
// text of one export in, one answerable finding out. No DOM, no network, no
// storage, no clock, no locale-sensitive formatting, no randomness.
//
// Nothing here re-declares a column name, a format, a signature field or a
// confidence threshold. The shapes come from browser-compat-contracts.js (#934),
// the parse from browser-compat-eligibility.js, and recognition and its gate
// from export-recognition.js (#928) — so a fourth published contract is read by
// this module without editing it.
//
// THE ONE QUESTION, and how the answer is built:
//   1. Parse the file, then recognize it. A file whose recognized provider is
//      not the one the reader chose never reaches the metric at all: it is an
//      unrecognized intake carrying the recovery guidance, which is a different
//      state from a low-confidence one.
//   2. Build the rate table: billed units and cost summed per model identity,
//      counting only records that carry BOTH a unit count above zero and a
//      readable cost. A record failing either cannot carry a rate.
//   3. If the rate table has no rows there is NO METRIC — metric is null. That
//      is an absent rate, never a rate of zero, and it is its own non-answer.
//      Recognition scores columns and signatures, not cell values, so a file can
//      clear the accepted gate and still land here: a zero-usage period, a
//      credit-only slice, or a blank unit-count column all do.
//   4. State is ANSWERED at or above the published accepted gate and PROVISIONAL
//      below it. That split is about CONFIDENCE and is independent of step 3:
//      an answered intake can still have no metric, and the view resolves the
//      metric sentence once, before the split, for exactly that reason.

import {
  BROWSER_COMPAT_MANIFEST, FIELD_ROLES, contractById,
} from "./browser-compat-contracts.js";
import { parseExportText } from "./browser-compat-eligibility.js";
import { ACCEPTED_MIN_CONFIDENCE, recognizeExport } from "./export-recognition.js";

export const INTAKE_STATES = Object.freeze({
  ANSWERED: "answered",
  PROVISIONAL: "provisional",
  UNRECOGNIZED: "unrecognized",
});

// One question, and it is answerable from a usage export alone: the reader does
// not have to know a price list, a commitment, or a peer benchmark to act on it.
export const COST_QUESTION =
  "Which model in this export costs the most per thousand billed units?";

// Said when the metric exists but the confidence is below the published gate.
// It is a PREFIX on the resolved sentence rather than a second sentence, so a
// provisional figure can never be read as a settled one.
export const PROVISIONAL_PREFIX = "Provisional, below the accepted recognition gate:";

// Said when there is no metric. Deliberately not "0.00 per 1,000 units": an
// export with nothing billable in it has no rate, and a zero would be a figure
// a reader could compare against, which this file does not have.
export const NO_RATE_SENTENCE = "No cost-per-unit rate can be computed from this "
  + "export: not one record in it carries both a billed unit count above zero and "
  + "a readable cost amount. That is a missing rate, not a rate of zero, so there "
  + "is nothing here to compare yet.";

// ---------------------------------------------------------------- helpers

const finite = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = String(value ?? "").trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
};

const byRole = (contract, role) =>
  contract.requiredFields.find((field) => field.role === role) ?? null;

// Locale-free on purpose: a figure a reader quotes in a review has to be the
// same figure on every machine, so no toLocaleString and no Intl anywhere here.
const usd = (value) => `$${value.toFixed(value >= 1 ? 2 : 4)}`;
const percent = (share) => `${Math.round(share * 100)}%`;

/** How many records carry a readable unit count AND a readable cost. */
export function readableRecordCount(records, contract) {
  if (!contract) return null;
  const units = byRole(contract, FIELD_ROLES.UNITS);
  const cost = byRole(contract, FIELD_ROLES.COST);
  return records.filter((record) =>
    finite(record?.[units.path]) !== null && finite(record?.[cost.path]) !== null).length;
}

// ---------------------------------------------------------------- rate table

/**
 * Billed units and cost per model identity, highest unit rate first.
 *
 * The model identity is used as a GROUPING KEY ONLY and is never returned: no
 * cell value from a reader's file leaves this function, so no caller can paint
 * one by accident. Rows carry counts, sums, a rate and a rank — figures the
 * page's privacy boundary already allows.
 */
export function rateTable(records, contract) {
  if (!contract) return Object.freeze([]);
  const model = byRole(contract, FIELD_ROLES.MODEL);
  const units = byRole(contract, FIELD_ROLES.UNITS);
  const cost = byRole(contract, FIELD_ROLES.COST);
  const groups = new Map();
  for (const record of records) {
    const billed = finite(record?.[units.path]);
    const amount = finite(record?.[cost.path]);
    // Both, and a unit count above zero: a rate needs a denominator. A record
    // that fails this is skipped and counted, never guessed at.
    if (billed === null || billed <= 0 || amount === null) continue;
    const key = String(record?.[model.path] ?? "");
    const group = groups.get(key) ?? { units: 0, costUsd: 0, records: 0 };
    group.units += billed;
    group.costUsd += amount;
    group.records += 1;
    groups.set(key, group);
  }
  const totalCost = [...groups.values()].reduce((sum, group) => sum + group.costUsd, 0);
  // Sorted by rate, then by cost, then by units: three total orders so two
  // models with the same rate still come out in the same order every run.
  const ordered = [...groups.values()]
    .map((group) => ({ ...group, ratePer1k: (group.costUsd / group.units) * 1000 }))
    .sort((left, right) => right.ratePer1k - left.ratePer1k
      || right.costUsd - left.costUsd || right.units - left.units);
  return Object.freeze(ordered.map((group, index) => Object.freeze({
    rank: index + 1,
    records: group.records,
    units: group.units,
    costUsd: group.costUsd,
    ratePer1k: group.ratePer1k,
    costShare: totalCost > 0 ? group.costUsd / totalCost : 0,
  })));
}

/**
 * The one material metric, or null when the rate table is empty.
 * @returns { rows, metric } — metric is null whenever rows is empty, and the
 *          callers treat that as a non-answer rather than a zero.
 */
export function costMetric(records, contract) {
  const rows = rateTable(records, contract);
  if (!rows.length) return Object.freeze({ rows, metric: null });
  const top = rows[0];
  const cheapest = rows.at(-1);
  const spread = rows.length > 1 && cheapest.ratePer1k > 0
    ? top.ratePer1k / cheapest.ratePer1k : null;
  const totalCostUsd = rows.reduce((sum, row) => sum + row.costUsd, 0);
  const statement = spread
    ? `The costliest model in this export runs at ${usd(top.ratePer1k)} per 1,000 billed `
      + `units — ${spread.toFixed(1)}× the cheapest of the ${rows.length} models in it — and `
      + `carries ${percent(top.costShare)} of the ${usd(totalCostUsd)} it covers.`
    : `One model carries a readable rate in this export: ${usd(top.ratePer1k)} per 1,000 `
      + `billed units across ${top.records} records, ${usd(totalCostUsd)} in total.`;
  return Object.freeze({
    rows,
    metric: Object.freeze({
      statement, ratePer1k: top.ratePer1k, spread, modelCount: rows.length, totalCostUsd,
    }),
  });
}

// ---------------------------------------------------------------- action

/**
 * One prioritized action, never a menu. The no-metric case is written ONCE,
 * here: callers reuse it rather than wording a second version of it.
 */
export function actionFor({ state, metric, rows, contract, recognition }) {
  const name = contract?.displayName ?? "the provider";
  if (state === INTAKE_STATES.UNRECOGNIZED) return recognition.nextAction;
  if (!metric) {
    return `Re-export from ${name} over a period that has billed usage in it, with the `
      + "unit-count column populated — every column this check needs is present, the unit "
      + "counts are not — then drop the file here again.";
  }
  if (state === INTAKE_STATES.PROVISIONAL) return recognition.nextAction;
  return rows.length > 1
    ? `Start with the highest-rate model: at ${usd(metric.ratePer1k)} per 1,000 units it is `
      + `the top row of the rate table below. Check in your ${name} console whether its `
      + "traffic can move to the cheapest row's model, and re-drop the next export to compare."
    : `Export a second period from ${name} and drop it here: one model at `
      + `${usd(metric.ratePer1k)} per 1,000 units is a rate with nothing to compare it to yet.`;
}

// ---------------------------------------------------------------- intakes

const provenanceFor = ({ contract, parsed, recordCount }) => Object.freeze({
  providerName: contract?.displayName ?? null,
  contractVersion: contract?.contractVersion ?? null,
  format: parsed.format ?? null,
  recordCount,
  // Null, not 0, when no contract names a unit and cost column: a count nobody
  // could have computed is absent, and the surface drops the clause rather than
  // printing a zero that reads as "nothing in your file was readable".
  readableRecords: readableRecordCount(parsed.records, contract),
});

/**
 * The file was not the provider the reader chose, or was not a published
 * provider at all. It is a recovery state, not a low-confidence one.
 *
 * The record count is the file's REAL one. An earlier version hardcoded zero
 * while naming the detected contract, so a file whose three records parsed
 * cleanly was told none of them had; on a surface whose whole job is trust,
 * that was the only false sentence on the page.
 */
function unrecognized({ parsed, recognition, chosen, detected, sourceLabel }) {
  const guidance = detected
    ? `This file matches the ${detected.displayName} contract, not the `
      + `${chosen?.displayName ?? "provider"} you chose. Choose ${detected.displayName} above `
      + "and drop it again, or drop the export you meant."
    : recognition.nextAction;
  return Object.freeze({
    state: INTAKE_STATES.UNRECOGNIZED,
    sourceLabel,
    question: COST_QUESTION,
    recognition,
    contract: detected,
    chosenContract: chosen,
    metric: null,
    rows: Object.freeze([]),
    guidance,
    provenance: provenanceFor({
      contract: detected, parsed, recordCount: parsed.records.length,
    }),
    action: actionFor({ state: INTAKE_STATES.UNRECOGNIZED, recognition, contract: detected }),
  });
}

/**
 * Reads one export into the finding the surface paints.
 * @param providerId  the contract the reader said they exported from. A file
 *                    recognized as a different contract is a recovery state.
 */
export function buildIntake({ text, fileName = "", providerId = null, sourceLabel = "" } = {}) {
  const parsed = parseExportText(text, fileName);
  const recognition = recognizeExport(parsed);
  const chosen = contractById(providerId);
  const detected = contractById(recognition.providerId);
  if (!detected || (chosen && detected.providerId !== chosen.providerId)) {
    return unrecognized({ parsed, recognition, chosen, detected, sourceLabel });
  }
  const { rows, metric } = costMetric(parsed.records, detected);
  // The gate is #928's published constant, not a number restated here.
  const state = recognition.confidence >= ACCEPTED_MIN_CONFIDENCE
    ? INTAKE_STATES.ANSWERED : INTAKE_STATES.PROVISIONAL;
  return Object.freeze({
    state,
    sourceLabel,
    question: COST_QUESTION,
    recognition,
    contract: detected,
    chosenContract: chosen ?? detected,
    metric,
    rows,
    guidance: null,
    provenance: provenanceFor({
      contract: detected, parsed, recordCount: parsed.records.length,
    }),
    action: actionFor({ state, metric, rows, contract: detected, recognition }),
  });
}

/** Every published contract, in manifest order — for a chooser, not a branch. */
export const importableContracts = () => BROWSER_COMPAT_MANIFEST.contracts;
