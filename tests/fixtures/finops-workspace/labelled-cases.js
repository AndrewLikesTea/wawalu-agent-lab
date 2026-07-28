// Labelled cases for the FinOps history this browser has actually kept.
//
// WHAT IS BEING GRADED
// --------------------
// Not the ephemeral analysis — that already has fixtures — but the part of it
// that *survives*: the commitment decisions Rowan's `recordCommitmentDecision`
// writes into `shiplog.decisions.v1`, the reconciliation blocks
// `persistReconciliations` writes beside them, and the JSON backup those two
// travel in. Every claim below is about what is in the store afterwards.
//
// EVERYTHING IS BUILT, NOTHING IS COMMITTED
// -----------------------------------------
// The retained periods come from the two shipped contract fixtures under
// `contracts/integrations/`, cloned and re-dated here. The commitments come out
// of `briefingFile` → `readEvidenceFile` → `previewFromCommitmentBlock` →
// `buildCommitmentDecision`, which is the same chain the page runs. A committed
// JSON blob of expected output would agree with itself forever; these fail the
// moment a seam moves, which is the only way a fixture stays evidence.
//
// THE ASSUMPTIONS BEHIND EVERY EXPECTED NUMBER
// --------------------------------------------
// 1. RETAINED PERIODS. Three months are retained, each one export of the same
//    source instance, each a calendar month, each carrying the single provider
//    aggregate the shipped fixture carries. Spend is set by hand to 10.00,
//    12.50, and 15.00 USD so the two trends a reader can compute are exact
//    integers rather than rounded decimals:
//        June  vs May  = (1250 − 1000) / 1000 = +25.0%
//        July  vs June = (1500 − 1250) / 1250 = +20.0%
//    `normalizeLocalFinopsHistory` compares the newest two periods only, so the
//    published organization trend over all three retained months is +20.0% and
//    the +25.0% is deliberately *not* published. That is the assumption a
//    director is most likely to dispute, so it is written down here.
// 2. BENCHMARK. No query sample is imported by any of these periods, so the
//    peer cohort is empty and the benchmark must be an explicit refusal rather
//    than a zero. The expected reason code is pinned below.
// 3. COMMITMENT ARITHMETIC. Inherited unchanged from the reconciliation
//    fixture next door: a 10,000,000-token month at 3,000 minor per million
//    observed against the 1,500 standard reference is a 300.00 USD baseline
//    repriced to 150.00 USD, so the commitment projects exactly 15,000 minor
//    of monthly saving. Halving the tokens at the same unit price lands the
//    observed saving on exactly 15,000 too, which is why the verified case
//    reads 100% attainment and not "about 100%".
// 4. SENTINELS. The redaction cases inject values that are prohibited by
//    `FORBIDDEN_FIELD_PATTERN` and `FORBIDDEN_VALUE_PATTERNS` in the briefing
//    contract. They are synthetic strings chosen to be unmistakable in a
//    substring scan; none of them is derived from a real person or account.

import { readFile } from "node:fs/promises";

import { buildCommitmentDecision } from "../../../src/finops-commitment-decision.js";
import { previewFromCommitmentBlock } from "../../../src/commitment-handoff.js";
import { RETENTION, WORKSPACE_KEY } from "../../../src/local-retention.js";
import {
  HALF_TRAFFIC, OTHER_UNIT, openedMonth, usageRow,
} from "../decision-reconciliation/labelled-cases.js";

const CONTRACTS = new URL("../../../contracts/integrations/", import.meta.url);

/* ------------------------------- the storage ------------------------------- */

/**
 * A browser store stand-in. `data` is exposed so a case can write a hostile
 * entry straight into the key, which is the only way one gets there: every
 * shipped writer refuses to.
 */
export function memoryWorkspace(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    data: values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

/** A store that has explicitly opted in, so a refused write is never the reason. */
export function retainingWorkspace(initial = {}) {
  return memoryWorkspace({
    [WORKSPACE_KEY]: JSON.stringify({
      retention: RETENTION.retaining,
      decidedAt: "2026-05-01T08:00:00.000Z",
      exportedAt: null,
      erasedAt: null,
    }),
    ...initial,
  });
}

/* --------------------------- the retained periods -------------------------- */

async function contractFixture(path) {
  return JSON.parse(await readFile(new URL(path, CONTRACTS), "utf8"));
}

/**
 * The three months this browser has retained, oldest first.
 *
 * Each is the shipped provider fixture re-dated to a calendar month and given
 * its own export id, so the only thing that varies across them is the spend.
 * `hris` is the shipped org roster, unchanged.
 */
export async function retainedPeriods() {
  const template = await contractFixture("provider-usage-billing/v1/fixtures/valid.json");
  const hris = { document: await contractFixture("hris-org/v1/fixtures/valid.json") };
  const periods = RETAINED_PERIOD_PLAN.map((plan) => {
    const document = structuredClone(template);
    document.export_id = plan.exportId;
    document.snapshot.generated_at = plan.generatedAt;
    document.snapshot.period_start = plan.periodStart;
    document.snapshot.period_end = plan.periodEnd;
    document.records[0].usage_date = plan.periodStart;
    document.records[0].cost.amount_minor = plan.amountMinor;
    return { document };
  });
  return { periods, hris };
}

/**
 * The plan the numbers above come from. `amountMinor` is the whole of what
 * varies between the three retained months; every other field is the shipped
 * fixture's, so a change to the contract fixture surfaces here rather than
 * being masked by a hand-written copy.
 */
export const RETAINED_PERIOD_PLAN = Object.freeze([
  Object.freeze({
    month: "2026-05",
    exportId: "11111111-1111-4111-8111-111111111111",
    generatedAt: "2026-06-01T01:00:00Z",
    periodStart: "2026-05-01",
    periodEnd: "2026-06-01",
    amountMinor: 1000,
  }),
  Object.freeze({
    month: "2026-06",
    exportId: "22222222-2222-4222-8222-222222222222",
    generatedAt: "2026-07-01T01:00:00Z",
    periodStart: "2026-06-01",
    periodEnd: "2026-07-01",
    amountMinor: 1250,
  }),
  Object.freeze({
    month: "2026-07",
    exportId: "33333333-3333-4333-8333-333333333333",
    generatedAt: "2026-08-01T01:00:00Z",
    periodStart: "2026-07-01",
    periodEnd: "2026-08-01",
    amountMinor: 1500,
  }),
]);

/**
 * What the retained history must publish, written down as numbers.
 *
 * `organizationSpendChangePercent` is the newest pair only — see assumption 1.
 * `benchmarkReasonCode` is a refusal, not an absence: a benchmark that silently
 * disappeared would be indistinguishable from one that scored zero.
 */
export const RETAINED_HISTORY_EXPECTATION = Object.freeze({
  label: "three retained calendar months from one source publish the newest pair's trend and refuse a benchmark",
  historyState: "available",
  periodCount: 3,
  currentPeriod: "2026-07-01 to 2026-08-01",
  previousPeriod: "2026-06-01 to 2026-07-01",
  // 1500 vs 1250 minor. The 2026-05 month is retained and reported in
  // `history.periods`, and is deliberately not part of this figure.
  organizationSpendChangePercent: 20,
  organizationTrendAvailable: true,
  spendUsd: 15,
  previousSpendUsd: 12.5,
  benchmarkState: "unavailable",
  benchmarkEligible: false,
  benchmarkReasonCode: "no_compatible_cohort",
  // Every retained month keeps its own spend line, so a reader can check the
  // published trend against the periods it was taken from.
  periodSpendUsd: Object.freeze([10, 12.5, 15]),
});

/* ---------------------------- the commitments ------------------------------ */

/** The instant every case reconciles at. Stated, never read from a clock. */
export const RECONCILED_AT = "2026-08-03T09:00:00.000Z";

/** The month every commitment below takes its baseline from. */
export const BASELINE_MONTH = "2026-06";

/** The month every commitment below is observed in. */
export const OBSERVED_MONTH = "2026-07";

/**
 * One approval, through the shipped chain: the baseline month is exported as
 * the page exports it, read back by the evidence reader the import flow uses,
 * and its commitment block handed to the preview adapter.
 *
 * @param rows the per-model usage the baseline month billed.
 */
export function commitmentApproval({
  rows = [usageRow()], approvedBy = "Director of Platform",
} = {}) {
  const entry = openedMonth(BASELINE_MONTH, { rows });
  const preview = previewFromCommitmentBlock(entry.commitment);
  if (!preview) throw new Error("the baseline month proposed no commitment to record");
  return { preview, approvedBy, approvedAt: "2026-07-03T10:00:00.000Z" };
}

/** The decision that approval becomes. Pure: no storage, no clock. */
export function commitmentDecision(options = {}) {
  return buildCommitmentDecision(commitmentApproval(options));
}

/** The release that says a commitment shipped, dated before the observed month. */
export function shippedRelease(decisions, { createdAt = "2026-06-28T12:00:00.000Z" } = {}) {
  return {
    id: "rel-retained-routing",
    version: "2026.06.28",
    title: "Route the committed workloads to the standard model",
    owner: "Director of Platform",
    status: "completed",
    createdAt,
    decisionIds: decisions.map((decision) => decision.id),
  };
}

/**
 * The two commitments this browser retains, and the exact reconciliation each
 * must produce against the single observed month.
 *
 * The pair is chosen so the two halves of the ladder are both exercised by one
 * store: Atlas is observed and lands on plan, Boreal is recorded and simply not
 * present in the month that was opened. A store where every row settles the
 * same way cannot show that a hostile entry left the *other* rows alone.
 */
export function retainedCommitments() {
  const atlas = commitmentDecision({ rows: [usageRow()] });
  const boreal = commitmentDecision({ rows: OTHER_UNIT() });
  return {
    decisions: [atlas, boreal],
    release: shippedRelease([atlas, boreal]),
    // Half the traffic on Atlas at the same unit price; Boreal is absent.
    entries: [openedMonth(OBSERVED_MONTH, { rows: HALF_TRAFFIC() })],
    expected: [
      Object.freeze({
        label: "verified — Atlas shipped and the observed month landed exactly on the projected saving",
        decisionId: atlas.id,
        commitmentId: atlas.finopsCommitment.commitmentId,
        status: "verified",
        reason: null,
        observedMonth: OBSERVED_MONTH,
        amounts: Object.freeze({
          projectedMonthlySavingsMinor: 15_000,
          observedMonthlySavingsMinor: 15_000,
          varianceMinor: 0,
          attainmentPercent: 100,
        }),
      }),
      Object.freeze({
        label: "unmatched_commitment — Boreal is retained but the opened month describes another unit's route",
        decisionId: boreal.id,
        commitmentId: boreal.finopsCommitment.commitmentId,
        status: "unmatched_commitment",
        reason: "commitment_not_observed",
        observedMonth: null,
        amounts: Object.freeze({
          projectedMonthlySavingsMinor: null,
          observedMonthlySavingsMinor: null,
          varianceMinor: null,
          attainmentPercent: null,
        }),
      }),
    ],
  };
}

/* ------------------------------ hostile entries ---------------------------- */

/**
 * Values that must never reach the store, and the shape of the source field
 * each one arrives on. Every string is deliberately unmistakable in a substring
 * scan of the serialized workspace.
 *
 * These are synthetic. `@example.invalid` is a reserved non-resolving domain and
 * `sk-` here is a made-up literal, not a key that was ever issued.
 */
export const SENTINELS = Object.freeze({
  promptExcerpt: "SENTINEL-PROMPT summarise the attached customer contract",
  email: "sentinel.person@example.invalid",
  apiKey: "sk-SENTINEL0000000000000000",
  ipAddress: "203.0.113.77",
  customerName: "SENTINEL Northwind Traders",
});

/**
 * Per-model usage rows carrying every prohibited source field at once.
 *
 * The extra keys are the ones a provider console would happily emit next to the
 * ones the contract declares. Nothing downstream is told about them: they are
 * here to be dropped, and the test asserts they were.
 */
export function taintedUsageRows() {
  return [usageRow({
    promptExcerpt: SENTINELS.promptExcerpt,
    userEmail: SENTINELS.email,
    apiKey: SENTINELS.apiKey,
    callerIpAddress: SENTINELS.ipAddress,
    customerName: SENTINELS.customerName,
    conversation: [{ role: "user", content: SENTINELS.promptExcerpt }],
  })];
}

/**
 * Entries that can only get into `shiplog.decisions.v1` by hand, one per
 * required failure mode.
 *
 * `expectation` is what the store must do with the entry. `kept` says whether
 * the entry survives `loadDecisions`; `reconciledRow` says whether it becomes a
 * reconciliation row. In every case the two valid commitments above must
 * reconcile to byte-identical rows, which is the claim the regression exists
 * for — a bad entry may cost itself, never its neighbours.
 */
export function hostileEntries(valid) {
  const template = valid[0];
  return [
    {
      label: "corrupted — one entry in the array is not an object at all",
      entry: "not-a-decision",
      kept: false,
      reconciledRow: false,
      because: "isDecision rejects a non-object, so the entry is dropped and counted as unreadable.",
    },
    {
      label: "corrupted — the entry is an object missing the fields a decision is defined by",
      entry: { id: "corrupt-missing-fields", finopsCommitment: template.finopsCommitment },
      kept: false,
      reconciledRow: false,
      because: "A record with no title, owner, status, or createdAt is not a decision, "
        + "and a commitment block cannot make it one.",
    },
    {
      label: "duplicate — a second decision claims the commitment id the first already carries",
      entry: { ...structuredClone(template), id: `${template.id}-copy` },
      kept: true,
      // The honest answer, written down rather than wished away: nothing in the
      // reader de-duplicates by commitment id, so a hand-written duplicate does
      // produce a second row. The shipped writers refuse to create one — see the
      // `recordCommitmentDecision` and `prepareShiplogImport` cases in the suite
      // — and this row is the evidence for what the hand-edit costs.
      reconciledRow: true,
      because: "Both the writer and the importer refuse a second link; only a hand-edited "
        + "store can hold one, and it settles as its own row without touching the first.",
    },
    {
      label: "stale — the commitment block declares a schema version this build never wrote",
      entry: {
        ...structuredClone(template),
        id: "stale-schema-commitment",
        finopsCommitment: {
          ...structuredClone(template.finopsCommitment),
          schemaVersion: "shiplog-finops-commitment/0.9.0",
          commitmentId: "stale-schema-route",
        },
      },
      kept: true,
      reconciledRow: true,
      because: "The decision itself is well formed, so the log keeps it; the stale block is "
        + "still read for its commitment id and settles with a stated reason rather than a claim.",
    },
    {
      label: "unsupported — the entry is a record kind this build has no reader for",
      entry: {
        kind: "wawalu.integration.provider-usage-billing",
        export_id: "44444444-4444-4444-8444-444444444444",
        records: [{ aggregate_id: "psn_unit_demo_00000002", cost: { amount_minor: 999 } }],
      },
      kept: false,
      reconciledRow: false,
      because: "A provider envelope stored in the decision key is not a decision; it is "
        + "dropped whole rather than partially interpreted.",
    },
  ];
}
