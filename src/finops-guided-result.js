// The guided-result composition contract for AI FinOps.
//
// THE ONE QUESTION
// ----------------
// Every executive surface in this product already answers a question. What none
// of them answered is the one a leader arrives with:
//
//   "What should we do now?"
//
// Nine panels, each individually honest, is not an answer to that. This module
// composes them into one: a single headline benchmark, a single prioritized
// action, a required trust verdict, and an ordered list of the panels a leader
// may open to check the answer. Nothing else has a slot here.
//
// WHAT THIS MODULE IS AND IS NOT
// ------------------------------
// It is pure selection and pure arithmetic over figures OTHER modules already
// published. There is no DOM, no fetch, no storage, no clock, no credential, no
// prompt text, and no network. It composes; it does not measure. In particular:
//
//   * the grade and its confidence are `imported-corpus-grade.js`'s, repeated;
//   * the coverage ratio is `finops-trust-verdict.js`'s, repeated;
//   * the month-over-month driver is `finops-leading-finding.js`'s, repeated;
//   * whether a supporting panel may show a figure at all is
//     `finops-panel-contract.js`'s, repeated.
//
// Recomputing any of those here is how two numbers on one screen disagree.
//
// PRECEDENCE IS ENFORCED, NOT DOCUMENTED
// --------------------------------------
// `composeGuidedResult({ imported, bundled })` reads exactly one side. When an
// imported analysis is present the bundled synthetic seed is not read at all —
// not for a fallback figure, not for a benchmark, not for an action. A leader
// looking at their own file must never be shown an invented number beside it.
//
// SYNTHETIC DATA IS NEVER DECISION-READY
// --------------------------------------
// The bundled sample walks the same analysis an import walks, so it can produce
// a spend figure and a routing recommendation. It is still invented. So the
// contract refuses to prioritize a spend action over it: on the synthetic path
// the prioritized action is always "import your own export", which is the only
// honest answer to "what should we do now?" when the numbers on screen are
// hand-authored. `decisionReady` says the same thing in one boolean.
//
// DELIBERATE OMISSIONS
// --------------------
// * No second benchmark. Two headline figures makes the reader decide which one
//   matters, and deciding that is this contract's whole job.
// * No second action. A ranked backlog is not a next step.
// * No new panel, chart, or metric. Every figure below already exists on the
//   page; what did not exist was an order over them.
// * No score for "how guided" a result is. A composition either names a primary
//   finding or says which input would let it.

import { leadingFinding } from "./finops-leading-finding.js";
import {
  EXECUTIVE_PANELS, MIN_ATTRIBUTED_SHARE, MIN_SCORED_PROMPTS, PANELS_BY_ID,
  panelFacts, panelState,
} from "./finops-panel-contract.js";

/**
 * Bump this when any slot's meaning, any enum value, any declared rank, or any
 * threshold below changes. Every consumer records the version it read.
 */
export const GUIDED_RESULT_VERSION = "finops-guided-result/1.0.0";

/** The primary leadership question. There is exactly one, and it is not derived. */
export const PRIMARY_QUESTION = "What should we do now?";

/**
 * Where the composition's figures came from.
 *
 * `imported` is a leader's own files, parsed in their browser. `synthetic` is
 * the bundled hand-authored sample. There is no third basis, and there is no
 * blend: a composition reads one side.
 */
export const RESULT_BASIS = Object.freeze({
  imported: "imported",
  synthetic: "synthetic",
});

// ---------------------------------------------------------------------------
// The trust verdict. Required: a composition without one does not publish.
// ---------------------------------------------------------------------------

/**
 * The four states the required trust slot may hold.
 *
 *   verified      an imported dataset whose dollar-weighted attributed share is
 *                 at or above `MIN_ATTRIBUTED_SHARE`. The only state that makes
 *                 a composition decision-ready.
 *   below_floor   an imported dataset with a defined coverage percentage under
 *                 that floor.
 *   unmeasurable  an imported dataset with NO coverage percentage: no rows
 *                 parsed, no spend to divide, or mixed currencies with no rate.
 *                 Not 0% — an undefined ratio, which is a different claim.
 *   synthetic     the bundled sample. Complete by construction and invented by
 *                 construction, so it is internally consistent and never
 *                 decision-grade.
 */
export const TRUST_STATE = Object.freeze({
  verified: "verified",
  belowFloor: "below_floor",
  unmeasurable: "unmeasurable",
  synthetic: "synthetic",
});

/** Which `trustVerdict()` states carry no coverage percentage at all. */
const UNMEASURABLE_VERDICT_STATES = Object.freeze(["empty", "zero_spend", "mixed_currency"]);

// ---------------------------------------------------------------------------
// Reason codes. Wire values: reword a sentence freely, changing a code is a
// version bump.
// ---------------------------------------------------------------------------

/**
 * The refusals this contract owns, as opposed to the ones it repeats.
 *
 * A missing declared input is the panel contract's refusal and is quoted from
 * it, so the same gap is named the same way here, on a KPI card, and in an
 * exported briefing. These four are refusals no panel fact can express.
 */
export const GUIDED_UNAVAILABLE_REASON = Object.freeze({
  /** Neither an import nor a bundled seed was supplied. */
  noResult: "no_result_composed",
  /** A required trust verdict was not supplied for an imported dataset. */
  noTrustVerdict: "no_trust_verdict_supplied",
  /** Every declared action candidate was ineligible. */
  noEligibleAction: "no_eligible_action_candidate",
  /** The analysis published no comparable prior period, so no driver exists. */
  noSpendDriver: "no_spend_driver_published",
});

// ---------------------------------------------------------------------------
// The prioritized action. One, selected from declared candidates by rank.
// ---------------------------------------------------------------------------

/**
 * The action candidates, highest priority first.
 *
 * `rank` is a unique integer, so selection is total: the eligible candidate
 * with the lowest rank wins and there is never a tie to break. Priority is a
 * property of this table rather than of the order a reader selected files in.
 *
 * WHY THIS ORDER. Repairing attribution outranks spending advice because advice
 * derived from a number a leader cannot trust is worse than no advice. The
 * month-over-month driver outranks the standing routing pilot because a change
 * is what a leader opened the page about. "Import your own export" is last
 * because it is only ever eligible when nothing on screen is the leader's.
 */
export const ACTION_CANDIDATES = Object.freeze([
  Object.freeze({
    id: "trust_repair", rank: 1,
    accountableRole: "FinOps Data Owner",
    effectLabel: "Spend this step would move into an attributed org unit",
  }),
  Object.freeze({
    id: "spend_driver", rank: 2,
    accountableRole: "Platform Engineering Lead",
    effectLabel: "Period-over-period increase the named department contributed",
  }),
  Object.freeze({
    id: "routing_pilot", rank: 3,
    accountableRole: "Platform Engineering Lead",
    effectLabel: "Recoverable spend in the top-ranked department (routing scenario, not a realized saving)",
  }),
  Object.freeze({
    id: "import_own_export", rank: 4,
    accountableRole: "FinOps Data Owner",
    effectLabel: null,
  }),
]);

const CANDIDATE_BY_ID = Object.freeze(Object.fromEntries(
  ACTION_CANDIDATES.map((candidate) => [candidate.id, candidate])));

// Ranks must be unique or "the lowest rank wins" is not a total rule.
{
  const ranks = new Set(ACTION_CANDIDATES.map((candidate) => candidate.rank));
  if (ranks.size !== ACTION_CANDIDATES.length) {
    throw new Error("guided result: action candidate ranks must be unique");
  }
}

// ---------------------------------------------------------------------------
// Progressive disclosure. Which existing panels are support, and in what order.
// ---------------------------------------------------------------------------

/**
 * The one executive panel permitted as primary content.
 *
 * It is the hero grade, because the headline benchmark this contract publishes
 * IS that panel's figure. Everything else on the page is support.
 */
export const PRIMARY_PANEL_ID = "hero-grade";

/**
 * Every other declared panel, in the order a leader should open them to check
 * the primary finding — and permitted ONLY at that depth.
 *
 * These panels are not demoted because they are wrong. They are demoted because
 * each answers a narrower question than "what should we do now?", and a page
 * that leads with nine narrow questions has answered none of them. The ranks
 * are unique integers, so the order is total and no tie-break is needed.
 *
 * The list is checked against the panel contract at module load: a panel added
 * there and not classified here fails immediately rather than shipping as
 * accidental primary content.
 */
export const SUPPORT_DISCLOSURES = Object.freeze([
  Object.freeze({ rank: 1, panelId: "spend-and-recovery" }),
  Object.freeze({ rank: 2, panelId: "department-priority" }),
  Object.freeze({ rank: 3, panelId: "spend-mix" }),
  Object.freeze({ rank: 4, panelId: "high-value-share" }),
  Object.freeze({ rank: 5, panelId: "model-overspend" }),
  Object.freeze({ rank: 6, panelId: "savings-portfolio" }),
  Object.freeze({ rank: 7, panelId: "recommendation-evidence" }),
  Object.freeze({ rank: 8, panelId: "peer-benchmark" }),
]);

{
  const declared = new Set([PRIMARY_PANEL_ID, ...SUPPORT_DISCLOSURES.map((entry) => entry.panelId)]);
  const ranks = new Set(SUPPORT_DISCLOSURES.map((entry) => entry.rank));
  if (ranks.size !== SUPPORT_DISCLOSURES.length) {
    throw new Error("guided result: disclosure ranks must be unique");
  }
  if (declared.size !== EXECUTIVE_PANELS.length) {
    throw new Error("guided result: disclosure list and panel contract disagree on panel count");
  }
  for (const panel of EXECUTIVE_PANELS) {
    if (!declared.has(panel.id)) {
      throw new Error(`guided result: panel "${panel.id}" is classified neither primary nor support`);
    }
  }
  for (const id of declared) {
    if (!PANELS_BY_ID[id]) throw new Error(`guided result: no declared panel "${id}"`);
  }
}

// ---------------------------------------------------------------------------
// Arithmetic helpers. Money is major USD, rounded once, at two decimals.
// ---------------------------------------------------------------------------

const usd = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : null);
const minorToUsd = (minor) => (Number.isInteger(minor) ? minor / 100 : null);

/** A reason quoted from the panel contract, or null when the panel is answerable. */
function panelGap(panelId, facts) {
  const state = panelState(PANELS_BY_ID[panelId], facts);
  if (!state.blocking) return null;
  return Object.freeze({
    reason: state.reason,
    needLabel: state.blocking.label,
    need: state.blocking.need,
  });
}

// ---------------------------------------------------------------------------
// The required trust slot.
// ---------------------------------------------------------------------------

/**
 * The trust verdict, restated as the one thing this composition needs from it:
 * may the figures beside it be acted on?
 *
 * @param verdict a `trustVerdict()` result, or null on the synthetic path.
 * @param basis `RESULT_BASIS.imported` or `RESULT_BASIS.synthetic`.
 *
 * Coverage is the verdict's own dollar-weighted attributed share, repeated as a
 * fraction in [0,1] and as a percentage to one decimal. It is never recomputed
 * and never row-weighted. An undefined ratio is null, not zero.
 */
export function composeTrust(verdict, basis) {
  if (basis === RESULT_BASIS.synthetic) {
    return Object.freeze({
      required: true,
      supplied: true,
      state: TRUST_STATE.synthetic,
      satisfied: true,
      question: "Can I trust this number?",
      answer: "No, and it is not asking you to. Every figure on screen is bundled hand-authored "
        + "sample data. It is internally complete, so nothing is missing from it — and nothing in "
        + "it happened.",
      coverage: null,
      coveragePercent: null,
      coverageFloor: MIN_ATTRIBUTED_SHARE,
      attributedUsd: null,
      totalUsd: null,
      findingCount: 0,
      unavailable: null,
    });
  }
  if (!verdict) {
    return Object.freeze({
      required: true,
      supplied: false,
      state: TRUST_STATE.unmeasurable,
      satisfied: false,
      question: "Can I trust this number?",
      answer: "No trust verdict was computed for this import, so nothing below may be acted on.",
      coverage: null,
      coveragePercent: null,
      coverageFloor: MIN_ATTRIBUTED_SHARE,
      attributedUsd: null,
      totalUsd: null,
      findingCount: 0,
      unavailable: Object.freeze({
        reason: GUIDED_UNAVAILABLE_REASON.noTrustVerdict,
        needLabel: "Post-import trust verdict",
        need: "Compute the trust verdict before composing a result. A figure with no coverage "
          + "statement behind it is a number nobody can audit.",
      }),
    });
  }
  const percent = verdict.headline?.coveragePercent;
  const measurable = !UNMEASURABLE_VERDICT_STATES.includes(verdict.state)
    && Number.isFinite(percent);
  const coverage = measurable ? percent / 100 : null;
  const state = !measurable
    ? TRUST_STATE.unmeasurable
    : coverage >= MIN_ATTRIBUTED_SHARE ? TRUST_STATE.verified : TRUST_STATE.belowFloor;
  return Object.freeze({
    required: true,
    supplied: true,
    state,
    satisfied: state === TRUST_STATE.verified,
    question: verdict.question ?? "Can I trust this number?",
    answer: verdict.answer ?? null,
    coverage,
    coveragePercent: measurable ? Math.round(percent * 10) / 10 : null,
    coverageFloor: MIN_ATTRIBUTED_SHARE,
    attributedUsd: minorToUsd(verdict.headline?.attributedMinor),
    totalUsd: minorToUsd(verdict.headline?.totalMinor),
    findingCount: Array.isArray(verdict.findings) ? verdict.findings.length : 0,
    unavailable: null,
  });
}

// ---------------------------------------------------------------------------
// The one headline benchmark.
// ---------------------------------------------------------------------------

/**
 * The single grade-backed benchmark.
 *
 *   metric        AI literacy composite: the prompt-literacy rubric's weighted
 *                 score over the scored records of the dataset on screen.
 *   unit          points on a 0–100 integer scale, with the rubric's own letter
 *                 grade beside it. Both are the rubric's; neither is rounded or
 *                 rebanded here.
 *   source        imported → `gradeImportedCorpus` over the reader's own query
 *                 sample. synthetic → the bundled seed's spend-weighted roll-up.
 *                 Never a blend, and never one filling in for the other.
 *   availability  published iff the grade result says `gradeable`. Otherwise the
 *                 reason is the hero panel's own, read off the panel contract
 *                 from the same scored-prompt count that decided the panel, so
 *                 the benchmark and the panel above it cannot refuse for two
 *                 different reasons.
 *
 * DELIBERATELY NOT GATED ON TRUST. The literacy composite is computed from
 * scored queries, not from attributed dollars, so a low attribution coverage is
 * not evidence against it. What a thin coverage does gate is `decisionReady` at
 * the top level, which is the honest place for that qualifier.
 */
export function composeBenchmark(grade, { basis } = {}) {
  const records = grade?.records ?? { source: 0, scored: 0 };
  const floor = grade?.eligibility?.minScoredRecords ?? MIN_SCORED_PROMPTS;
  if (!grade?.gradeable) {
    return Object.freeze({
      available: false,
      metricId: "ai_literacy_composite",
      label: "AI literacy",
      value: null,
      unit: "points (0-100)",
      letter: null,
      confidenceLevel: null,
      scoredRecords: records.scored ?? 0,
      sourceRecords: records.source ?? 0,
      floor,
      basis,
      rule: grade?.reasonRule ?? null,
      unavailable: panelGap(PRIMARY_PANEL_ID, { scoredPrompts: records.scored ?? 0 })
        ?? Object.freeze({
          reason: grade?.reason ?? GUIDED_UNAVAILABLE_REASON.noResult,
          needLabel: "Scored query sample",
          need: grade?.reasonRule ?? "No grade was published for this dataset.",
        }),
    });
  }
  return Object.freeze({
    available: true,
    metricId: "ai_literacy_composite",
    label: "AI literacy",
    value: grade.composite,
    unit: "points (0-100)",
    letter: grade.grade,
    confidenceLevel: grade.confidence?.level ?? null,
    scoredRecords: records.scored ?? 0,
    sourceRecords: records.source ?? 0,
    floor,
    basis,
    rule: `${grade.version} · ${grade.rubricVersionId}`
      + (grade.confidence?.basis?.arithmetic ? ` · ${grade.confidence.basis.arithmetic}` : ""),
    unavailable: null,
    // Named here so a caller does not have to know the panel contract to know
    // which panel this figure belongs to.
    panelId: PRIMARY_PANEL_ID,
  });
}

// ---------------------------------------------------------------------------
// The one prioritized action.
// ---------------------------------------------------------------------------

function action(candidate, { text, actionable, effectUsd = null, control = null, detail = null }) {
  return Object.freeze({
    available: true,
    id: candidate.id,
    rank: candidate.rank,
    text,
    actionable,
    accountableRole: candidate.accountableRole,
    expectedEffect: candidate.effectLabel === null || effectUsd === null ? null : Object.freeze({
      value: usd(effectUsd),
      unit: "USD",
      label: candidate.effectLabel,
    }),
    control,
    detail,
  });
}

/**
 * Select exactly one action.
 *
 * Every candidate is evaluated against declared eligibility; the eligible one
 * with the lowest `rank` is returned. Ranks are unique, so there is no tie and
 * no secondary comparator. When nothing is eligible the result is unavailable
 * with a reason, never a softened suggestion.
 */
export function composeAction({ basis, trust, decisionReady, verdict, analysis, finding }) {
  // Rank 1 — repair attribution. Eligible on any imported dataset whose trust
  // verdict is unsatisfied and which named a next step. `actionable` is the
  // verdict's own: some repairs (a quarantined period, two source instances)
  // are steps a human takes outside this product, and saying so is more useful
  // than linking to a control that would not fix them.
  if (!trust.satisfied && basis === RESULT_BASIS.imported && verdict?.nextAction) {
    const next = verdict.nextAction;
    return action(CANDIDATE_BY_ID.trust_repair, {
      text: next.text,
      actionable: next.available === true,
      effectUsd: minorToUsd(next.recoverableMinor),
      control: next.control ?? null,
      detail: `Attribution coverage is ${trust.coveragePercent === null
        ? "undefined" : `${trust.coveragePercent}%`} against a published floor of `
        + `${Math.round(MIN_ATTRIBUTED_SHARE * 100)}%.`,
    });
  }
  // Ranks 2 and 3 require a decision-ready composition: a leader's own file,
  // with attribution at or above the floor. Spend advice over invented data, or
  // over data the page has just said it cannot attribute, is not advice.
  if (decisionReady) {
    // Rank 2 — the month-over-month driver, when the analysis published one AND
    // its top-ranked recommendation names that same department. The pairing rule
    // is `leadingFinding`'s; this contract repeats its verdict rather than
    // re-deciding it.
    if (finding?.available && finding.action?.available) {
      return action(CANDIDATE_BY_ID.spend_driver, {
        text: finding.action.text,
        actionable: true,
        effectUsd: finding.driver?.deltaUsd ?? null,
        detail: finding.driverSentence ?? null,
      });
    }
    // Rank 3 — the standing routing pilot on the top-ranked department, when
    // that department has a recoverable figure at all.
    const top = analysis?.topDepartment ?? null;
    if (top && Number(top.recoverableUsd) > 0 && typeof analysis.action === "string") {
      return action(CANDIDATE_BY_ID.routing_pilot, {
        text: analysis.action,
        actionable: true,
        effectUsd: Number(top.recoverableUsd),
        detail: finding?.available
          ? null
          : "No comparable prior period, so this is the standing recommendation rather than a "
            + "response to a change.",
      });
    }
  }
  // Rank 4 — the only action a synthetic page may prioritize.
  if (basis === RESULT_BASIS.synthetic) {
    return action(CANDIDATE_BY_ID.import_own_export, {
      text: "Import one provider period export in the panel below. Every figure on this page is "
        + "bundled sample data until you do, so no action here is a recommendation about your "
        + "organization.",
      actionable: true,
      control: "local-finops-files",
      detail: "Files are parsed in this browser tab. Nothing is uploaded, stored, or transmitted.",
    });
  }
  return Object.freeze({
    available: false,
    id: null,
    rank: null,
    text: null,
    actionable: false,
    accountableRole: null,
    expectedEffect: null,
    control: null,
    unavailable: Object.freeze({
      reason: trust.satisfied
        ? GUIDED_UNAVAILABLE_REASON.noSpendDriver
        : GUIDED_UNAVAILABLE_REASON.noEligibleAction,
      needLabel: trust.satisfied ? "A ranked department with a recoverable figure" : "An attributable import",
      need: trust.satisfied
        ? "The analysis ranked no department with a recoverable figure and published no "
          + "period-over-period driver, so there is no spend action to prioritize."
        : "Nothing in this import can be attributed to a confirmed org unit, and the trust "
          + "verdict named no repair step. Open the data-quality warnings before acting.",
    }),
  });
}

// ---------------------------------------------------------------------------
// The ordered supporting disclosures.
// ---------------------------------------------------------------------------

/**
 * Every support-only panel, in declared rank order.
 *
 * `permitted` is the panel contract's own availability decision, repeated. A
 * panel that cannot be computed is still listed — with its question and the one
 * input that would answer it — because a leader has to be able to see that the
 * question exists and what it costs to answer.
 *
 * Order is `rank` ascending and nothing else. Ranks are unique integers, so two
 * engineers produce the same list in the same order from the same facts.
 */
export function composeDisclosures(facts) {
  const normalized = panelFacts(facts);
  return Object.freeze([...SUPPORT_DISCLOSURES]
    .sort((left, right) => left.rank - right.rank)
    .map((entry) => {
      const panel = PANELS_BY_ID[entry.panelId];
      const state = panelState(panel, normalized);
      return Object.freeze({
        rank: entry.rank,
        panelId: panel.id,
        elementId: panel.elementId,
        question: panel.question,
        metric: panel.metric,
        role: "support",
        permitted: state.available,
        unavailable: state.available ? null : Object.freeze({
          reason: state.reason,
          needLabel: state.blocking.label,
          need: state.blocking.need,
        }),
      });
    }));
}

// ---------------------------------------------------------------------------
// The composition.
// ---------------------------------------------------------------------------

function side(input, basis) {
  if (!input) return null;
  return {
    basis,
    grade: input.grade ?? null,
    analysis: input.analysis ?? null,
    verdict: input.verdict ?? null,
    facts: panelFacts(input.facts ?? {}),
  };
}

function unavailableResult() {
  return Object.freeze({
    version: GUIDED_RESULT_VERSION,
    state: "unavailable",
    basis: null,
    decisionReady: false,
    question: PRIMARY_QUESTION,
    primaryFinding: "No analysis is on screen, so there is nothing to act on yet.",
    benchmark: null,
    action: null,
    trust: null,
    disclosures: Object.freeze([]),
    unavailable: Object.freeze({
      reason: GUIDED_UNAVAILABLE_REASON.noResult,
      needLabel: "Provider period export",
      need: "Select one provider period export, or open the bundled example, to compose a result.",
    }),
  });
}

/**
 * Compose the guided result.
 *
 * @param input.imported `{ grade, analysis, verdict, facts }` from a leader's own
 *   files. When present it is the ONLY side read.
 * @param input.bundled `{ grade, analysis, facts }` from the hand-authored seed.
 *   Read only when `imported` is absent. Any `verdict` on this side is ignored:
 *   a synthetic dataset cannot earn a trust verdict.
 * @returns a frozen composition: one question, one benchmark, one action, a
 *   required trust slot, and the ordered support-only disclosures.
 */
export function composeGuidedResult({ imported = null, bundled = null } = {}) {
  const chosen = side(imported, RESULT_BASIS.imported) ?? side(bundled, RESULT_BASIS.synthetic);
  if (!chosen) return unavailableResult();

  const { basis, grade, analysis, facts } = chosen;
  // A synthetic side never reads a verdict, even if one was handed over: the
  // precedence rule has to hold in the data as well as in the prose.
  const verdict = basis === RESULT_BASIS.imported ? chosen.verdict : null;
  const trust = composeTrust(verdict, basis);
  const decisionReady = basis === RESULT_BASIS.imported && trust.state === TRUST_STATE.verified;
  const finding = analysis ? leadingFinding(analysis) : null;
  const benchmark = composeBenchmark(grade, { basis });
  const composed = composeAction({ basis, trust, decisionReady, verdict, analysis, finding });
  const disclosures = composeDisclosures(facts);

  return Object.freeze({
    version: GUIDED_RESULT_VERSION,
    state: "guided",
    basis,
    /**
     * True only for a leader's own import whose attributed share is at or above
     * the published floor. Everything else — an unattributable import, the
     * bundled sample — is readable and is not a basis for a decision.
     */
    decisionReady,
    question: PRIMARY_QUESTION,
    /** The one sentence that answers the question, or the reason there is none. */
    primaryFinding: composed.available ? composed.text : composed.unavailable.need,
    benchmark,
    action: composed,
    trust,
    disclosures,
    unavailable: null,
  });
}
