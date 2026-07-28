// Turn an imported analysis into one portable commitment, carried in the
// briefing file.
//
// WHAT THIS IS FOR
// ----------------
// A briefing already answers "is our AI spend justified, and what should we do
// next?" as a sentence. It does not answer it as a *commitment*: one department,
// one routing change, one baseline month, one projected monthly saving, one
// confidence, and the provenance of the records the figure came from. Noor's
// `savings-commitment.js` defines exactly that object and refuses to build a
// half-populated one. What it does not have is a way to get one out of an
// analysis the visitor actually imported — its only input today is a bundled
// fixture.
//
// This module is that adapter, and nothing else. It reads an analysis envelope,
// projects it into the `savings-commitment-input/1.0.0` envelope Noor's contract
// already validates, and hands it to `buildSavingsCommitment`. Every rule about
// what a commitment *is* — the arithmetic, the eligibility floor, the ranking,
// the confidence band, the refusal to carry a credential — stays in Noor's
// module. There is deliberately no second commitment model here, and no fixture:
// a parallel model is the fork the briefing contract already exists to prevent.
//
// WHAT IT READS
// -------------
// `COMMITMENT_INPUT_FIELDS` names every field of the envelope this derivation
// touches. It is a short list of aggregates, and it is the whole list. In
// particular this module never reads a credential, never contacts a provider or
// a rate card, never reads a prompt, a completion, a query sample, or a
// conversation, and never reads storage, a cookie, a URL, a clock, or a random
// source. Two calls on the same envelope return equal objects, in this process
// and in the next one — which is what makes the block safe to put in a file
// whose whole claim is that it is reproducible.
//
// The instant the commitment records is the analysis envelope's own, never
// today's: see `IMPORTED_AT_BASIS`.
//
// WHY THE RAW MODEL STRING IS NOT CARRIED
// ---------------------------------------
// A model identifier arrives from a visitor's own import and is bounded but
// otherwise unconstrained text. The briefing *reader* (`parseSavedBriefing`)
// refuses a whole file that contains markup anywhere in it, so carrying a raw
// vendor string verbatim would let one odd cell in a CSV produce a file that
// cannot be reopened. Routes therefore carry a canonical id derived from the
// string plus the tier the rule classified it into. A model that cannot be
// canonicalized is not guessed at — its candidate is dropped.
//
// UNAVAILABLE IS A STATE, NOT AN EMPTY OBJECT
// -------------------------------------------
// Most real imports cannot support a commitment: a JSON provider export carries
// no model dimension at all, and an analysis over a non-monthly window has no
// monthly baseline to commit against. Those are answers, not failures, and each
// one is reported as a code with an authored sentence beside it. The one thing
// this module will not do is fill the shape in with a plausible number.

import { ACCOUNTABLE_ROLE } from "./finops-briefing-contract.js";
import { MODEL_ROUTING_RULE_VERSION } from "./down-routing-candidates.js";
import {
  SAVINGS_COMMITMENT_INPUT_VERSION,
  SAVINGS_COMMITMENT_QUESTION,
  SAVINGS_COMMITMENT_VERSION,
  buildSavingsCommitment,
  validateCandidate,
  validateSavingsCommitment,
} from "./savings-commitment.js";

/**
 * This adapter's own version, separate from the commitment contract's. Bump it
 * when the projection below changes what it reads or how it names a route; leave
 * `SAVINGS_COMMITMENT_VERSION` to Noor.
 */
export const COMMITMENT_DERIVATION_VERSION = "finops-briefing-commitment/1.0.0";

/**
 * Every envelope field this derivation reads. Stated as data rather than as
 * prose so a test can assert the list and a reviewer can check it against the
 * code in one pass.
 */
export const COMMITMENT_INPUT_FIELDS = Object.freeze([
  "schemaVersion",
  "generatedAt",
  "period",
  "rankedDepartments[].id",
  "rankedDepartments[].name",
  "modelRouting.ranked[].unitId",
  "modelRouting.ranked[].unitLabel",
  "modelRouting.ranked[].ruleVersion",
  "modelRouting.ranked[].confidence.level",
  "modelRouting.ranked[].confidence.reasons[].code",
  "modelRouting.ranked[].candidates[].model",
  "modelRouting.ranked[].candidates[].tier",
  "modelRouting.ranked[].candidates[].proposedTier",
  "modelRouting.ranked[].candidates[].calls",
  "modelRouting.ranked[].candidates[].currentSpendUsd",
  "modelRouting.ranked[].candidates[].projectedSpendUsd",
  "modelRouting.ranked[].candidates[].inputs.tokens",
  "modelRouting.ranked[].excludedModels[].model",
]);

/** Exactly one of these is reported. `unavailable` is this module's addition. */
export const COMMITMENT_STATUS = Object.freeze({
  ok: "ok",
  noCommitment: "no_commitment",
  unavailable: "unavailable",
});

/**
 * Why no commitment could be *derived* at all — which is a different statement
 * from "we derived candidates and none of them saves money". That second one is
 * Noor's `no_commitment`, and conflating the two would tell a reader the
 * analysis was checked when it was never checkable.
 *
 * Each sentence names what is missing and what would supply it. None of them
 * quotes the import's own content back.
 */
export const COMMITMENT_UNAVAILABLE_REASON = Object.freeze({
  noAnalysis: "no_analysis",
  attributionWithheld: "attribution_withheld",
  noModelDimension: "no_model_dimension",
  periodNotACalendarMonth: "period_not_a_calendar_month",
  noIdentifiableWorkload: "no_identifiable_workload",
  ambiguousIdentifiers: "ambiguous_identifiers",
  contractRejected: "contract_rejected",
  notInFile: "not_in_file",
  unsupportedVersion: "unsupported_version",
});

export const COMMITMENT_UNAVAILABLE_STATEMENT = Object.freeze({
  [COMMITMENT_UNAVAILABLE_REASON.noAnalysis]:
    "No analysis has been computed, so there is nothing to commit to. Import a provider export first.",
  [COMMITMENT_UNAVAILABLE_REASON.attributionWithheld]:
    "Too little of this spend is attributed to name a figure, so no commitment is proposed from it. "
    + "A commitment carries a monthly saving, and this analysis is not allowed to state one.",
  [COMMITMENT_UNAVAILABLE_REASON.noModelDimension]:
    "This import carries no per-model usage the routing rule could score, so there is no model to move "
    + "traffic away from. Import an export that names a model, tokens, and spend per org unit.",
  [COMMITMENT_UNAVAILABLE_REASON.periodNotACalendarMonth]:
    "A commitment states a monthly saving against a monthly baseline, and this analysis observes a window "
    + "that is not one calendar month. Analyze a single calendar month to propose one.",
  [COMMITMENT_UNAVAILABLE_REASON.noIdentifiableWorkload]:
    "This import's per-model figures could not be tied to an identifiable org unit and model, so no "
    + "commitment could be built from them without guessing what they name.",
  [COMMITMENT_UNAVAILABLE_REASON.ambiguousIdentifiers]:
    "Two of this import's org units or models reduce to the same identifier, so a commitment built from "
    + "them could name the wrong one. None is proposed.",
  [COMMITMENT_UNAVAILABLE_REASON.contractRejected]:
    "A commitment was derived from this analysis but did not satisfy the savings-commitment contract, so it "
    + "is withheld rather than shown unvalidated.",
  [COMMITMENT_UNAVAILABLE_REASON.notInFile]:
    "This briefing was written before commitments were carried in the file, so it states none. Export the "
    + "analysis again to include one.",
  [COMMITMENT_UNAVAILABLE_REASON.unsupportedVersion]:
    "This briefing carries a commitment written against a different version of the contract, so this build "
    + "cannot read it without risking a wrong figure. Export the analysis again.",
});

/**
 * What the recorded instant means. Noor's contract requires one and this module
 * has no clock, so the instant is always the analysis's own — never today's —
 * and the block says which of the two the analysis supplied.
 *
 * `analysis_period_end` is the fallback for an envelope whose `generatedAt` is
 * not an ISO-8601 UTC instant. It is the exclusive end boundary of the window
 * the analysis observed: the earliest moment at which the imported figures were
 * complete. Naming the basis is what keeps the fallback from reading as a claim
 * about when somebody pressed Import.
 */
export const IMPORTED_AT_BASIS = Object.freeze({
  generatedAt: "analysis_generated_at",
  periodEnd: "analysis_period_end",
});

/**
 * The confidence the imported analysis graded a unit at, as the integer percent
 * Noor's contract stores. The analysis publishes a three-value ladder and no
 * percentage, so the mapping is declared here rather than invented per call.
 *
 * The values are placed to land in the contract's own bands (high >= 75,
 * medium >= 50, low otherwise) with room on either side, so a band never changes
 * because a threshold moved by a point.
 */
export const CONFIDENCE_PERCENT_BY_LEVEL = Object.freeze({
  High: 80,
  Medium: 60,
  Low: 30,
});

// ---------------------------------------------------------------------------
// Primitives.
// ---------------------------------------------------------------------------

const CANONICAL_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_ID_LENGTH = 64;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const PERIOD_STRING = /^(\d{4})-(\d{2})-(\d{2}) to (\d{4})-(\d{2})-(\d{2})$/;

/**
 * A display label safe to put in a file that a markup-refusing reader will open
 * again. Deliberately narrow: a name that does not match is not escaped or
 * trimmed, it is replaced by the redacted unit label the routing rule already
 * publishes.
 */
const DISPLAY_NAME = /^[A-Za-z0-9][A-Za-z0-9 .,'()&/-]{0,119}$/;

function canonical(value, max = MAX_ID_LENGTH) {
  const slug = String(value ?? "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug && slug.length <= max && CANONICAL_ID.test(slug) ? slug : null;
}

/** Dollars to integer minor units, or null when the value is not money. */
function minorUnits(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  const minor = Math.round(number * 100);
  return Number.isSafeInteger(minor) ? minor : null;
}

function integer(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

/** A non-negative whole count, or 0. Never null: a count has no absent state. */
function count(value) {
  return Math.max(0, integer(value) ?? 0);
}

/** "2026-06-01 to 2026-07-01" to "2026-06", or null when it is not one month. */
export function calendarMonth(period) {
  const match = PERIOD_STRING.exec(String(period ?? "").trim());
  if (!match) return null;
  const [, startYear, startMonth, startDay, endYear, endMonth, endDay] = match;
  if (startDay !== "01" || endDay !== "01") return null;
  if (Number(startMonth) < 1 || Number(startMonth) > 12) return null;
  const start = Number(startYear) * 12 + Number(startMonth);
  const end = Number(endYear) * 12 + Number(endMonth);
  if (end - start !== 1) return null;
  return `${startYear}-${startMonth}`;
}

function periodEndInstant(period) {
  const match = PERIOD_STRING.exec(String(period ?? "").trim());
  return match ? `${match[4]}-${match[5]}-${match[6]}T00:00:00Z` : null;
}

function unavailable(reason, extra = {}) {
  return Object.freeze({
    derivationVersion: COMMITMENT_DERIVATION_VERSION,
    contractVersion: SAVINGS_COMMITMENT_VERSION,
    question: SAVINGS_COMMITMENT_QUESTION,
    status: COMMITMENT_STATUS.unavailable,
    reason,
    statement: COMMITMENT_UNAVAILABLE_STATEMENT[reason],
    designation: null,
    importedAtBasis: null,
    source: null,
    commitment: null,
    consideredCount: 0,
    eligibleCount: 0,
    excluded: Object.freeze([]),
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// The projection: analysis envelope to `savings-commitment-input/1.0.0`.
// ---------------------------------------------------------------------------

/**
 * A stable id for the per-model usage row a figure was computed from.
 *
 * These are the records the commitment cites, and they are precisely that: the
 * folded per-model usage rows the analysis publishes, one per org unit and
 * model. They are not provider record ids — a provider record id is not carried
 * on a folded row and inventing one would put a citation in the file that points
 * at nothing.
 */
function usageRecordId(unitId, modelId) {
  return `usage-${unitId}-${modelId}`;
}

function departmentName(analysis, unitId, unitLabel) {
  const ranked = Array.isArray(analysis?.rankedDepartments) ? analysis.rankedDepartments : [];
  const name = ranked.find((department) => department?.id === unitId)?.name;
  if (typeof name === "string" && DISPLAY_NAME.test(name.trim())) return name.trim();
  return typeof unitLabel === "string" && DISPLAY_NAME.test(unitLabel.trim())
    ? unitLabel.trim() : `Org unit ${unitId}`;
}

function confidenceBasis(unit) {
  const level = unit?.confidence?.level ?? "Low";
  const reasons = Array.isArray(unit?.confidence?.reasons) ? unit.confidence.reasons : [];
  const codes = reasons.map((reason) => reason?.code).filter((code) => typeof code === "string");
  const tail = codes.length
    ? `Lowered by: ${codes.slice(0, 4).join(", ")}.`
    : "No confidence penalty applied.";
  return `The imported analysis graded this org unit's per-model routing ${level} under rule `
    + `${MODEL_ROUTING_RULE_VERSION}. ${tail}`;
}

/**
 * One candidate commitment per (org unit, model) the routing rule scored.
 *
 * A pair is the right grain because a commitment names one routing change, and
 * the rule's own unit of decision is one model's traffic inside one unit. A
 * candidate whose ids, money, or tiers cannot be read is dropped rather than
 * defaulted; the counts of what was dropped travel on the block.
 */
function projectCandidates(analysis, month) {
  const ranked = Array.isArray(analysis?.modelRouting?.ranked) ? analysis.modelRouting.ranked : [];
  const candidates = [];
  // Canonical record id to the raw (unit, model) pair it was reduced from. Two
  // distinct pairs reaching one id would put the wrong department's name on
  // somebody's commitment, so the collision is detected here and reported; it is
  // never resolved by picking one.
  const recordSources = new Map();
  let scoredModels = 0;
  let ambiguous = false;

  for (const unit of ranked) {
    const unitId = canonical(unit?.unitId);
    const rows = Array.isArray(unit?.candidates) ? unit.candidates : [];
    // The full record index: every per-model row this unit published, scored or
    // excluded, so a commitment's cited ids are a subset of a set the analysis
    // really holds rather than of the rows that happened to win.
    for (const row of [...rows, ...(Array.isArray(unit?.excludedModels) ? unit.excludedModels : [])]) {
      const modelId = canonical(row?.model);
      if (!unitId || !modelId) continue;
      const id = usageRecordId(unitId, modelId);
      const pair = `${unit?.unitId} ${row?.model}`;
      if ((recordSources.get(id) ?? pair) !== pair) ambiguous = true;
      recordSources.set(id, pair);
    }
    for (const row of rows) {
      scoredModels += 1;
      const modelId = canonical(row?.model);
      const proposedTier = canonical(row?.proposedTier);
      const baselineMinor = minorUnits(row?.currentSpendUsd);
      const projectedMinor = minorUnits(row?.projectedSpendUsd);
      const percent = CONFIDENCE_PERCENT_BY_LEVEL[unit?.confidence?.level];
      if (!unitId || !modelId || !proposedTier || baselineMinor === null
        || projectedMinor === null || !Number.isInteger(percent)) {
        continue;
      }
      const proposedModelId = `${proposedTier}-tier-reference`;
      const recordId = usageRecordId(unitId, modelId);
      const name = departmentName(analysis, unit?.unitId, unit?.unitLabel);
      const tokens = integer(row?.inputs?.tokens);
      const calls = integer(row?.calls);
      const candidateId = canonical(`${unitId}-${modelId}`);
      if (!candidateId) continue;
      candidates.push({
        candidateId,
        workloadScope: {
          workloadId: candidateId,
          description: `Text-generation traffic on ${modelId} in ${name}`.slice(0, 400),
          period: month,
        },
        department: { departmentId: unitId, name },
        accountableOwner: { role: ACCOUNTABLE_ROLE.routing_pilot },
        recordIds: [recordId],
        routing: {
          workloadId: candidateId,
          currentRoute: { modelId, tier: canonical(row?.tier) },
          // The contract this product imports carries no target model
          // identifier, only a cheaper tier and its reference price, so the
          // proposed route names the tier rather than pretending to name a
          // model nobody supplied.
          proposedRoute: { modelId: proposedModelId, tier: proposedTier },
          rationale: `The imported analysis prices this model above the premium-tier floor and reprices `
            + `its ${tokens === null ? "observed" : tokens} tokens at the ${proposedTier}-tier `
            + `reference rate. The saving is a scenario, not a measured reduction.`,
          evidence: [{
            recordId,
            statement: `Imported per-model usage for ${modelId}: `
              + `${tokens === null ? "token count not reported" : `${tokens} tokens`}, `
              + `${calls === null ? "call count not reported" : `${calls} calls`}, `
              + `${(baselineMinor / 100).toFixed(2)} USD observed spend in ${month}.`,
          }],
        },
        baseline: { monthlyCostMinor: baselineMinor, workloadId: candidateId, period: month },
        projected: { monthlyCostMinor: projectedMinor, workloadId: candidateId, period: month },
        confidence: { percent, basis: confidenceBasis(unit) },
      });
    }
  }

  const seen = new Set();
  for (const candidate of candidates) {
    if (seen.has(candidate.candidateId)) ambiguous = true;
    seen.add(candidate.candidateId);
  }
  return { candidates, recordIds: [...recordSources.keys()].sort(), scoredModels, ambiguous };
}

/**
 * Build the `savings-commitment-input/1.0.0` envelope for an analysis, or say
 * why there is none.
 *
 * @returns `{ input }` or `{ reason }`.
 */
export function commitmentInputFor(analysis, { designation = "imported" } = {}) {
  if (!analysis || typeof analysis !== "object") {
    return { reason: COMMITMENT_UNAVAILABLE_REASON.noAnalysis };
  }
  const month = calendarMonth(analysis.period);
  if (!month) return { reason: COMMITMENT_UNAVAILABLE_REASON.periodNotACalendarMonth };

  const generatedAt = typeof analysis.generatedAt === "string" && INSTANT.test(analysis.generatedAt)
    ? analysis.generatedAt : null;
  const importedAt = generatedAt ?? periodEndInstant(analysis.period);
  const importedAtBasis = generatedAt ? IMPORTED_AT_BASIS.generatedAt : IMPORTED_AT_BASIS.periodEnd;
  if (!importedAt) return { reason: COMMITMENT_UNAVAILABLE_REASON.noAnalysis };

  const projected = projectCandidates(analysis, month);
  if (projected.ambiguous) return { reason: COMMITMENT_UNAVAILABLE_REASON.ambiguousIdentifiers };
  if (!projected.scoredModels) return { reason: COMMITMENT_UNAVAILABLE_REASON.noModelDimension };

  // Noor's own per-candidate rules decide what is carryable. Applying them here
  // rather than restating them is what keeps this adapter from becoming a second
  // opinion about the contract it feeds.
  const known = new Set(projected.recordIds);
  const usable = projected.candidates.filter((candidate) => {
    try {
      validateCandidate(candidate, known);
      return true;
    } catch {
      return false;
    }
  });
  if (!usable.length) return { reason: COMMITMENT_UNAVAILABLE_REASON.noIdentifiableWorkload };

  return {
    importedAtBasis,
    input: {
      schemaVersion: SAVINGS_COMMITMENT_INPUT_VERSION,
      source: {
        sourceId: `${designation}-analysis-${month}`,
        importedAt,
        analysisPeriod: month,
        designation,
        currency: "USD",
        unit: "usd_minor",
        recordIds: projected.recordIds,
      },
      candidates: usable,
    },
  };
}

// ---------------------------------------------------------------------------
// The block the briefing file carries.
// ---------------------------------------------------------------------------

/**
 * Noor's preview, minus the two fields a file has no business repeating.
 *
 * `schemaVersion` and `downstream` are build-time constants of the contract, not
 * facts about this analysis, and `downstream.note` is longer than the briefing
 * file's own 400-character ceiling for any single string. They are re-added from
 * this build's constants when a saved block is validated on the way back in, so
 * nothing is lost — see `readSavedCommitment`.
 */
function blockFromPreview(preview, { importedAtBasis }) {
  return Object.freeze({
    derivationVersion: COMMITMENT_DERIVATION_VERSION,
    contractVersion: SAVINGS_COMMITMENT_VERSION,
    question: preview.question,
    status: preview.status,
    reason: null,
    statement: preview.status === COMMITMENT_STATUS.ok
      ? preview.commitment.headline : preview.reason,
    designation: preview.designation,
    importedAtBasis,
    source: preview.source,
    commitment: preview.commitment,
    // Counts, not figures, and the contract does not validate them — so they are
    // coerced here rather than trusted, which matters on the way back in from a
    // file somebody could have hand-edited.
    consideredCount: count(preview.consideredCount),
    eligibleCount: count(preview.eligibleCount),
    excluded: preview.excluded,
  });
}

/**
 * Derive the portable commitment for an analysis.
 *
 * Pure and total: no DOM, no fetch, no storage, no clock, no randomness, and it
 * never throws. A contract refusal becomes an `unavailable` block, because a
 * briefing file that fails to write because one optional block would not build
 * is a worse artifact than one that says plainly it carries no commitment.
 *
 * @param analysis an envelope from `normalizeLocalFinops` or
 *   `normalizeLocalFinopsHistory`, or null when nothing has been analyzed.
 * @param options.dataset "user" or "example"; decides the designation the
 *   commitment is stamped with, so a bundled figure is never read as an
 *   imported one.
 * @param options.attributionWithheld true when the attribution policy already
 *   suppressed the money figure on screen. A commitment states a saving, so a
 *   withheld analysis proposes none rather than routing the figure around the
 *   decision that withheld it.
 */
export function deriveBriefingCommitment(analysis, { dataset, attributionWithheld = false } = {}) {
  if (attributionWithheld) return unavailable(COMMITMENT_UNAVAILABLE_REASON.attributionWithheld);
  const designation = dataset === "example" ? "demo" : "imported";
  let derived;
  try {
    derived = commitmentInputFor(analysis, { designation });
  } catch {
    return unavailable(COMMITMENT_UNAVAILABLE_REASON.contractRejected);
  }
  if (derived.reason) return unavailable(derived.reason);
  try {
    return blockFromPreview(buildSavingsCommitment(derived.input),
      { importedAtBasis: derived.importedAtBasis });
  } catch {
    return unavailable(COMMITMENT_UNAVAILABLE_REASON.contractRejected);
  }
}

// ---------------------------------------------------------------------------
// Reading one back out of a saved file.
// ---------------------------------------------------------------------------

/**
 * The commitment a saved briefing carries, validated against the contract before
 * a single figure of it is believed.
 *
 * A file is untrusted input, so the block is not read field by field and trusted
 * — it is reassembled into a full `savings-commitment/1.0.0` preview using this
 * build's own constants and put through `validateSavingsCommitment`, which
 * re-checks the arithmetic, the confidence band, the provenance record count,
 * and the absence of credential or prompt content at any depth. Anything it
 * refuses becomes `unavailable`, never a partially-believed commitment.
 *
 * A briefing written before this block existed is not an error: it reports
 * `not_in_file`, which is what keeps every previously exported file readable.
 *
 * @returns a block in exactly the shape `deriveBriefingCommitment` returns, so a
 *   restored surface and a live one cannot present two different objects.
 */
export function readSavedCommitment(payload) {
  const block = payload && typeof payload === "object" ? payload.savingsCommitment : null;
  if (block === null || block === undefined) {
    return unavailable(COMMITMENT_UNAVAILABLE_REASON.notInFile);
  }
  if (typeof block !== "object" || Array.isArray(block)) {
    return unavailable(COMMITMENT_UNAVAILABLE_REASON.contractRejected);
  }
  if (block.contractVersion !== SAVINGS_COMMITMENT_VERSION
    || block.derivationVersion !== COMMITMENT_DERIVATION_VERSION) {
    return unavailable(COMMITMENT_UNAVAILABLE_REASON.unsupportedVersion);
  }
  if (block.status === COMMITMENT_STATUS.unavailable) {
    return COMMITMENT_UNAVAILABLE_STATEMENT[block.reason]
      ? unavailable(block.reason)
      : unavailable(COMMITMENT_UNAVAILABLE_REASON.contractRejected);
  }
  if (block.status !== COMMITMENT_STATUS.ok && block.status !== COMMITMENT_STATUS.noCommitment) {
    return unavailable(COMMITMENT_UNAVAILABLE_REASON.contractRejected);
  }
  const preview = {
    schemaVersion: SAVINGS_COMMITMENT_VERSION,
    question: SAVINGS_COMMITMENT_QUESTION,
    status: block.status,
    designation: block.designation,
    source: block.source,
    commitment: block.status === COMMITMENT_STATUS.ok ? block.commitment : null,
    reason: block.status === COMMITMENT_STATUS.ok ? null : block.statement,
    consideredCount: block.consideredCount,
    eligibleCount: block.eligibleCount,
    excluded: block.excluded,
    downstream: { dependsOnContract: SAVINGS_COMMITMENT_VERSION },
  };
  try {
    validateSavingsCommitment(preview);
  } catch {
    return unavailable(COMMITMENT_UNAVAILABLE_REASON.contractRejected);
  }
  return blockFromPreview(preview, {
    importedAtBasis: Object.values(IMPORTED_AT_BASIS).includes(block.importedAtBasis)
      ? block.importedAtBasis : null,
  });
}

// ---------------------------------------------------------------------------
// The sentences a surface writes. Authored once, here.
// ---------------------------------------------------------------------------

/**
 * The commitment as the three lines a view paints, in the order it paints them.
 *
 * Every state produces all three keys — there is no shape a caller has to branch
 * on to avoid `undefined` in a slot — and `detail` is null exactly when there is
 * nothing to say beyond the headline. An unavailable block is therefore rendered
 * by the same code path as a proposed commitment, which is what stops "no
 * commitment yet" from being painted as an empty box.
 */
export function commitmentLines(block) {
  const question = block?.question ?? SAVINGS_COMMITMENT_QUESTION;
  if (!block || block.status !== COMMITMENT_STATUS.ok) {
    return Object.freeze({
      question,
      headline: block?.statement ?? COMMITMENT_UNAVAILABLE_STATEMENT.no_analysis,
      detail: null,
    });
  }
  const { commitment } = block;
  const saving = commitment.projectedMonthlySavings.amountUsd.toFixed(2);
  return Object.freeze({
    question,
    headline: commitment.headline,
    detail: `${commitment.department.name} · ${saving} USD a month · `
      + `${commitment.confidence.band} confidence (${commitment.confidence.percent}%) · `
      + `${commitment.baseline.period} baseline · ${commitment.accountableOwner.role} accountable · `
      + `${commitment.provenance.recordCount} imported record`
      + `${commitment.provenance.recordCount === 1 ? "" : "s"}.`,
  });
}
