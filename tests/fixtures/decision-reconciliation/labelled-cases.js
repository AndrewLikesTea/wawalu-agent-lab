// Labelled decision-to-outcome reconciliation cases: one per required status.
//
// Each case is a stored decision, the releases it links to, the months a reader
// opened in the import flow, and the exact result the reconciliation must
// produce — written down as numbers so a disagreement about a status is a
// failing test rather than an argument in a review.
//
// EVERYTHING IS BUILT, NOTHING IS COMMITTED
// -----------------------------------------
// The briefings come out of `briefingFile` — the same call the AI FinOps export
// button makes — over envelopes from `analyzeModelRouting`, and the decision
// comes out of `buildCommitmentDecision` — the same call the record button
// makes. A committed JSON fixture agrees with itself forever. These fail the
// moment either seam moves, which is the only way a fixture keeps being
// evidence.
//
// THE ARITHMETIC THE LABELS ASSUME
// --------------------------------
// The reference row is 10,000,000 tokens at 3,000 minor per million observed
// against a 1,500 standard reference: a 300.00 USD baseline month repriced to a
// 150.00 USD projection, so the commitment projects exactly 15,000 minor units
// of monthly saving. A later month saves by moving traffic off the committed
// route at the same unit price, so halving the tokens halves the spend.
//
//   observed monthly saving = baseline monthly cost − observed monthly cost
//   variance                = observed saving − projected saving
//   attainment              = round(observed / projected × 100)
//
// Those three lines are `verifyCommitment`'s, quoted here so a reader of the
// expectations below can check them by hand.

import { analyzeModelRouting } from "../../../src/down-routing-candidates.js";
import { briefingFile } from "../../../src/finops-briefing-export.js";
import { previewFromCommitmentBlock } from "../../../src/commitment-handoff.js";
import { readEvidenceFile } from "../../../src/savings-evidence.js";
import { buildCommitmentDecision } from "../../../src/finops-commitment-decision.js";
import { RECONCILIATION_STATUS } from "../../../src/decision-reconciliation.js";

/** The committed route: one org unit, one model, one price. */
export function usageRow(overrides = {}) {
  return {
    orgUnitId: "psn_example_unit_atlas0",
    model: "Vendor-Large-2026",
    provider: "openai",
    inputTokens: 6_000_000,
    outputTokens: 4_000_000,
    tokens: 10_000_000,
    requests: 5_000,
    spendMinor: 30_000,
    estimated: false,
    sourceRows: 12,
    ...overrides,
  };
}

function nextMonth(month) {
  const [year, index] = month.split("-").map(Number);
  return index === 12 ? `${year + 1}-01` : `${year}-${String(index + 1).padStart(2, "0")}`;
}

function envelope(month, rows) {
  const unitIds = [...new Set(rows.map((row) => row.orgUnitId))];
  const next = nextMonth(month);
  return {
    schemaVersion: "local-finops/1.0.0",
    generatedAt: `${next}-02T09:15:00.000Z`,
    period: `${month}-01 to ${next}-01`,
    spendUsd: 1_000,
    recoverableUsd: 150,
    rankedDepartments: unitIds.map((id) => ({
      id,
      name: "Atlas Platform",
      spendUsd: 500,
      recoverableUsd: 150,
      records: 12,
      downRouting: { ruleVersion: "down-routing-candidate/1.0.0", recoverableUsd: 150 },
    })),
    modelRouting: analyzeModelRouting({ modelUsage: rows, unitIds }),
    quality: { joinedRecords: 12, quarantinedRecords: 0, providerCompleteness: "complete" },
    action: "Pilot lower-cost routing for text-generation in Atlas Platform.",
    topDepartment: { id: unitIds[0], recoverableUsd: 150 },
  };
}

/**
 * One month, exported as the AI FinOps page exports it and read back through the
 * evidence reader the import flow uses.
 *
 * @returns the opened entry, exactly as `readEvidenceFiles` would hand it over.
 */
export function openedMonth(month, { rows = [usageRow()], dataset = "user" } = {}) {
  const file = briefingFile(envelope(month, rows), {
    dataset, exportedAt: `${nextMonth(month)}-02T09:20:00.000Z`,
  });
  const read = readEvidenceFile({
    name: `briefing-${month}.json`, text: file.text, byteSize: file.text.length,
  });
  if (read.opened.length !== 1) {
    throw new Error(`a briefing this build wrote was not readable: ${JSON.stringify(read.rejected)}`);
  }
  return read.opened[0];
}

/** Half the traffic at the same unit price: 150.00 observed, exactly on plan. */
export const HALF_TRAFFIC = () => [usageRow({
  tokens: 5_000_000, inputTokens: 3_000_000, outputTokens: 2_000_000,
  requests: 2_500, spendMinor: 15_000,
})];

/** A fifth of the traffic moved: 60.00 observed against a 150.00 plan. */
export const LIGHT_MIGRATION = () => [usageRow({
  tokens: 8_000_000, inputTokens: 4_800_000, outputTokens: 3_200_000,
  requests: 4_000, spendMinor: 24_000,
})];

/** A different org unit entirely, so a different stable commitment identifier. */
export const OTHER_UNIT = () => [usageRow({ orgUnitId: "psn_example_unit_boreal" })];

/** The decision a June commitment is recorded as, through the shipped builder. */
export function recordedDecision(month = "2026-06", { approvedBy = "Director of Platform" } = {}) {
  const entry = openedMonth(month);
  const preview = previewFromCommitmentBlock(entry.commitment);
  if (!preview) throw new Error("the baseline month proposed no commitment to record");
  return buildCommitmentDecision({
    preview, approvedBy, approvedAt: `${nextMonth(month)}-03T10:00:00.000Z`,
  });
}

/** A release that says the decision shipped, recorded before the observed month. */
export function shippedRelease(decision, { createdAt = "2026-06-28T12:00:00.000Z" } = {}) {
  return {
    id: "rel-atlas-routing",
    version: "2026.06.28",
    title: "Route Atlas Platform text generation to the standard model",
    owner: "Director of Platform",
    status: "completed",
    createdAt,
    decisionIds: [decision.id],
  };
}

/** The instant every case reconciles at. Stated, never read from a clock. */
export const RECONCILED_AT = "2026-08-03T09:00:00.000Z";

/**
 * The four labelled cases, one per required status.
 *
 * `expected` is the label written down. `amounts` are USD minor units and are
 * the values a drift check compares against; `null` means the case must produce
 * no figure at all, which is a stronger claim than a zero.
 */
export function labelledCases() {
  const decision = recordedDecision();
  const release = shippedRelease(decision);
  return [
    {
      label: "verified — the month after the baseline landed exactly on the projected saving",
      decisions: [decision],
      releases: [release],
      entries: [openedMonth("2026-07", { rows: HALF_TRAFFIC() })],
      expected: {
        status: RECONCILIATION_STATUS.verified,
        verdict: "achieved",
        reason: null,
        observedMonth: "2026-07",
        // The commitment's own band, undropped: it shipped, the baseline record
        // ids are present, and the month is the reader's own import.
        confidence: "high",
        amounts: {
          projectedMonthlySavingsMinor: 15_000,
          observedMonthlySavingsMinor: 15_000,
          varianceMinor: 0,
          attainmentPercent: 100,
        },
      },
    },
    {
      label: "underperforming — the route got cheaper, by 60.00 against a 150.00 plan",
      decisions: [decision],
      releases: [release],
      entries: [openedMonth("2026-07", { rows: LIGHT_MIGRATION() })],
      expected: {
        status: RECONCILIATION_STATUS.underperforming,
        verdict: "under_realized",
        reason: null,
        observedMonth: "2026-07",
        confidence: "high",
        amounts: {
          projectedMonthlySavingsMinor: 15_000,
          observedMonthlySavingsMinor: 6_000,
          varianceMinor: -9_000,
          attainmentPercent: 40,
        },
      },
    },
    {
      // The comparison IS computed here and IS shown; what is withheld is the
      // claim. A cost that fell in a month when nothing is recorded as having
      // shipped is not this decision's result, so the figures are stated and the
      // status is held. Reading this row as "verified" is the mistake the whole
      // status ladder exists to prevent.
      label: "no_comparable_data — the month lands on plan, but nothing records having shipped it",
      decisions: [decision],
      releases: [],
      entries: [openedMonth("2026-07", { rows: HALF_TRAFFIC() })],
      expected: {
        status: RECONCILIATION_STATUS.noComparableData,
        verdict: "achieved",
        reason: "release_not_recorded",
        observedMonth: "2026-07",
        // One rung below the commitment's own band, because nothing shipped.
        confidence: "medium",
        amounts: {
          projectedMonthlySavingsMinor: 15_000,
          observedMonthlySavingsMinor: 15_000,
          varianceMinor: 0,
          attainmentPercent: 100,
        },
      },
    },
    {
      label: "no_comparable_data — no month is open at all, so there is no figure to state",
      decisions: [decision],
      releases: [release],
      entries: [],
      expected: {
        status: RECONCILIATION_STATUS.noComparableData,
        verdict: null,
        reason: "no_observation",
        observedMonth: null,
        confidence: "high",
        amounts: {
          projectedMonthlySavingsMinor: null,
          observedMonthlySavingsMinor: null,
          varianceMinor: null,
          attainmentPercent: null,
        },
      },
    },
    {
      label: "unmatched_commitment — the import describes a different org unit's route",
      decisions: [decision],
      releases: [release],
      entries: [openedMonth("2026-07", { rows: OTHER_UNIT() })],
      expected: {
        status: RECONCILIATION_STATUS.unmatchedCommitment,
        verdict: null,
        reason: "commitment_not_observed",
        observedMonth: null,
        confidence: "high",
        amounts: {
          projectedMonthlySavingsMinor: null,
          observedMonthlySavingsMinor: null,
          varianceMinor: null,
          attainmentPercent: null,
        },
      },
    },
  ];
}
