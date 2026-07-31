// One strong finding, chosen by a rule a reader can check.
//
// THE PROBLEM THIS SOLVES. The AI FinOps page computes a set of signals — where
// this organization stands against its peers, which way spend moved, the widest
// internal department gap, the department driving it, what is modelled as
// recoverable — and the headline picked one of them by construction: the
// composer assembled the peer position into a sentence because that is what the
// code said to do. There was no ranking, so there was nothing to disagree with,
// nothing to test, and no way for a stronger finding to win.
//
// This module ranks them. It is deterministic and it is pure:
//
//   * It NEVER recomputes a signal. Every number it reads was computed by the
//     module that owns it and handed in. There is no arithmetic here beyond
//     `Math.abs` on a value that was already final.
//   * It reads no DOM, opens no network, touches no storage, and calls neither
//     `Date.now()` nor `Math.random()`. The same input is the same output on
//     every machine and in every input order.
//   * It decides nothing about what the headline may say. `finops-spine-
//     manifest.js` owns that; this consumes it and refuses what it forbids.
//
// The ranking rules are DATA — an ordered comparator chain, below — because the
// question "why did this finding win?" has to be answerable by reading a list,
// not by tracing branches.
//
// INPUT. A signal is a plain object the caller adapts from an already-computed
// result:
//
//   {
//     id: "peer-position",                    // stable, unique, the final tiebreak
//     signalKind: SPINE_CLAIM_KIND.peerPosition,
//     available: true,                        // false is skipped, not rejected
//     claim: "…the sentence the headline would assert…",
//     impact: { value: 2, unit: SPINE_UNIT.quartilesFromCheapest,
//               direction: SPINE_DIRECTION.worseThanPeers },
//     confidence: { level: "high", reasons: ["ranking_reproducible"] },
//     provenance: { kind: PROVENANCE_KIND.synthetic, label: "…", id: "2026-06-30" },
//     recommendedAction: "…exactly one action…",
//   }
//
// OUTPUT. `{ winner, runnersUp, rejected, ruleOrder }`. `winner` is null and
// `runnersUp` is empty when no signal qualified; that is a state, not an error,
// and this never throws for it.

import {
  FINOPS_SPINE_MANIFEST, headlineClaimKind, headlineKindPriority,
} from "./finops-spine-manifest.js";

/** Bump when the finding shape, the rule chain, or a reason code changes meaning. */
export const FINDING_RESOLVER_VERSION = "finops-finding-resolver/1.0.0";

/**
 * The confidence ladder, weakest first. The index IS the rank, and a downgrade
 * is one step down it — so "drops a level" has exactly one meaning in this
 * codebase. The names are the ones the journey signals already publish.
 */
export const CONFIDENCE_LEVELS = Object.freeze(["unavailable", "low", "moderate", "high"]);

/** The rank of a level, or 0 for a level this module does not publish. */
export const confidenceRank = (level) => {
  const index = CONFIDENCE_LEVELS.indexOf(level);
  return index < 0 ? 0 : index;
};

/**
 * Where a finding's numbers came from.
 *
 * These are the two states the page already distinguishes everywhere else: the
 * bundled synthetic cohorts (`PEER_COST_PROVENANCE`, the `sample`/`example`
 * source) and a reader's own analyzed export (the `user`/`import` source). No
 * third marker is invented here; callers map their existing one onto these.
 */
export const PROVENANCE_KIND = Object.freeze({
  synthetic: "synthetic_cohort",
  imported: "imported_export",
});

/** Imported evidence outranks synthetic evidence when everything else ties. */
const PROVENANCE_RANK = Object.freeze({
  [PROVENANCE_KIND.imported]: 2,
  [PROVENANCE_KIND.synthetic]: 1,
});

/**
 * What class of evidence a finding rests on, in the two words a reader uses.
 *
 * This is `provenance.kind` said the way the page says it, and it is derived
 * HERE rather than in a view or a test so there is one answer to "is this mine
 * or is it invented?" — the surface renders it, the fixtures assert it, and
 * neither one re-derives it.
 *
 * ASSUMPTION: anything not positively marked as the reader's own import is
 * synthetic-cohort evidence. The two failures are not symmetric — labelling the
 * reader's own export as synthetic understates a claim they can check, while
 * labelling synthetic cohort boundaries as their own export tells a lead they
 * measured something they did not. So an unknown, absent, or unrecognised
 * provenance kind falls to `syntheticCohort`.
 * WHAT WOULD INVALIDATE IT: a third provenance that is neither — a customer's
 * measured peer panel, say. That is a new `PROVENANCE_KIND` and a new evidence
 * class declared beside these two, not a silent reuse of either.
 */
export const EVIDENCE_CLASS = Object.freeze({
  ownExport: "own-export",
  syntheticCohort: "synthetic-cohort",
});

/** The evidence class of a provenance record. Total: every input has an answer. */
export function evidenceClassOf(provenance) {
  return provenance?.kind === PROVENANCE_KIND.imported
    ? EVIDENCE_CLASS.ownExport
    : EVIDENCE_CLASS.syntheticCohort;
}

/**
 * The lead-in a synthetic-cohort claim is asserted behind.
 *
 * A quartile drawn against invented peers is a real comparison against a
 * made-up peer set. The claim sentence itself is authored by the module that
 * owns the figure and is NOT rewritten here; what changes with the evidence
 * class is what the claim is asserted AS, and this clause is that. It carries
 * no terminator, so it qualifies the sentence rather than becoming a second one.
 *
 * ASSUMPTION: degrading the wording is the whole obligation for synthetic
 * evidence — the number is not withheld and not widened, because a vaguer
 * number over the same invented boundaries is the same claim with the evidence
 * for it removed. WHO DISPUTES IT: a reviewer who would rather show no peer
 * position at all on the bundled path. They would also remove the only thing
 * this page can demonstrate before a reader imports anything.
 */
export const SYNTHETIC_CLAIM_QUALIFIER =
  "Illustrative only, from hand-authored synthetic cohort boundaries rather than your own export:";

/** The claim template ids. Stable strings; asserted by the fixtures. */
export const CLAIM_TEMPLATE = Object.freeze({
  ownExport: "measured-from-own-export",
  syntheticCohort: "illustrative-from-synthetic-cohort",
});

/**
 * Which template an evidence class selects, as a table rather than an `if` in a
 * view. A surface that wants to know why the headline reads the way it does
 * reads this; it never special-cases a string.
 */
const CLAIM_TEMPLATES = Object.freeze({
  [EVIDENCE_CLASS.ownExport]: Object.freeze({
    id: CLAIM_TEMPLATE.ownExport,
    qualifier: null,
    render: (claim) => claim,
  }),
  [EVIDENCE_CLASS.syntheticCohort]: Object.freeze({
    id: CLAIM_TEMPLATE.syntheticCohort,
    qualifier: SYNTHETIC_CLAIM_QUALIFIER,
    render: (claim) => `${SYNTHETIC_CLAIM_QUALIFIER} ${claim}`,
  }),
});

/** The template for an evidence class, falling to the qualified one when unknown. */
export function claimTemplateFor(evidenceClass) {
  return CLAIM_TEMPLATES[evidenceClass] ?? CLAIM_TEMPLATES[EVIDENCE_CLASS.syntheticCohort];
}

/**
 * Why a finding's confidence is what it is. Codes, not sentences: they are
 * asserted in tests, logged, and rendered through copy the surface owns.
 */
export const CONFIDENCE_REASON = Object.freeze({
  /** The reader's own imported export produced this number. */
  importedExport: "imported_export_evidence",
  /**
   * The number rests on published synthetic cohort boundaries rather than the
   * reader's own export. THIS IS THE DOWNGRADE. A quartile drawn against
   * invented peers is a real comparison against a made-up peer set, and a lead
   * about to repeat it to a director is owed that distinction in the level,
   * not only in a badge under the sentence.
   */
  syntheticCohortBoundaries: "synthetic_cohort_boundaries",
  /** The signal named no level, so none is claimed on its behalf. */
  notStated: "confidence_not_stated",
  /** The ladder floor was already reached, so the downgrade had nowhere to go. */
  alreadyAtFloor: "confidence_at_floor",
});

/** Why a signal never became a finding. Every rejection is reported, never dropped. */
export const FINDING_REJECTED = Object.freeze({
  noId: "no_signal_id",
  duplicateId: "duplicate_signal_id",
  kindNotPermitted: "claim_kind_not_permitted",
  unitNotPermitted: "impact_unit_not_permitted",
  directionNotPermitted: "impact_direction_not_permitted",
  impactNotNumeric: "impact_value_not_numeric",
  noClaim: "no_claim_sentence",
  claimTooLong: "claim_over_sentence_limit",
  noAction: "no_recommended_action",
});

/** Materiality, weakest first: the index is the rank, same convention as above. */
export const MATERIALITY_LEVELS = Object.freeze(["none", "minor", "major"]);

const text = (value) => (typeof value === "string" ? value.trim() : "");
const finite = (value) => Number.isFinite(Number(value));

/** Sentences in an authored claim. Terminators, not a natural-language parser. */
export function sentenceCount(claim) {
  return (text(claim).match(/[.!?](?=\s|$)/g) ?? []).length || (text(claim) ? 1 : 0);
}

/**
 * Apply the provenance rule to a stated confidence level.
 *
 * One step down the ladder for synthetic cohort boundaries, with the reason
 * code recorded beside the level so the downgrade is traceable and not merely
 * visible in the outcome. Imported evidence is not upgraded — it keeps the
 * level the signal stated, and records why it kept it.
 *
 * @returns {{ level: string, reasons: string[], statedLevel: string }}
 */
export function applyProvenanceConfidence(confidence, provenance) {
  const stated = CONFIDENCE_LEVELS.includes(confidence?.level) ? confidence.level : null;
  const reasons = [...(Array.isArray(confidence?.reasons) ? confidence.reasons : [])]
    .map(text).filter(Boolean);
  const statedLevel = stated ?? "unavailable";
  if (!stated) reasons.push(CONFIDENCE_REASON.notStated);

  if (provenance?.kind !== PROVENANCE_KIND.synthetic) {
    if (provenance?.kind === PROVENANCE_KIND.imported) reasons.push(CONFIDENCE_REASON.importedExport);
    return Object.freeze({ level: statedLevel, statedLevel, reasons: Object.freeze(reasons) });
  }
  const rank = confidenceRank(statedLevel);
  reasons.push(CONFIDENCE_REASON.syntheticCohortBoundaries);
  if (rank === 0) reasons.push(CONFIDENCE_REASON.alreadyAtFloor);
  return Object.freeze({
    level: CONFIDENCE_LEVELS[Math.max(0, rank - 1)],
    statedLevel,
    reasons: Object.freeze(reasons),
  });
}

/**
 * Is this number big enough to lead with?
 *
 * The threshold is the manifest's, per claim kind, in that kind's own unit —
 * which is what makes a dollar figure and a quartile distance comparable at
 * all. Anything above the threshold is `major`, anything non-zero below it is
 * `minor`, and an exactly-zero impact is `none`.
 */
export function materialityOf(impact, spec) {
  if (!spec || !finite(impact?.value)) return "none";
  const magnitude = Math.abs(Number(impact.value));
  if (magnitude >= Number(spec.majorAt)) return "major";
  return magnitude > 0 ? "minor" : "none";
}

const rule = (code, statement, compare) => Object.freeze({ code, statement, compare });

/**
 * THE RANKING RULES, in order. The first rule that separates two findings picks
 * the winner; the last one is total, so there is always exactly one winner.
 *
 * Read top to bottom, this says: lead with something that matters, that you can
 * stand behind, that answers the question this page asks first, and when two
 * findings are still level, prefer the bigger number in the same unit, then the
 * reader's own data over invented peers, then the lower signal id — which is
 * arbitrary but fixed, and an arbitrary fixed answer is what "deterministic"
 * costs when everything a reader could care about has already tied.
 */
export const RANKING_RULES = Object.freeze([
  rule("materiality",
    "A material finding outranks an immaterial one, measured against the manifest's "
    + "per-kind threshold in that kind's own unit.",
    (left, right) => right.materialityRank - left.materialityRank),
  rule("confidence",
    "Higher confidence outranks lower, after the provenance downgrade has been applied. "
    + "A number you cannot stand behind does not lead the page.",
    (left, right) => right.confidenceRank - left.confidenceRank),
  rule("claim_kind_priority",
    "The manifest's declared order of headline claim kinds. Where we stand comes before "
    + "which way spend moved, which comes before the widest internal gap.",
    (left, right) => left.kindPriority - right.kindPriority),
  rule("impact_magnitude",
    "The larger absolute impact, and ONLY between two findings stated in the same unit. "
    + "Dollars are never compared with quartiles.",
    (left, right) => (left.impact.unit === right.impact.unit
      ? Math.abs(right.impact.value) - Math.abs(left.impact.value) : 0)),
  rule("provenance",
    "The reader's own imported export outranks published synthetic cohorts.",
    (left, right) => right.provenanceRank - left.provenanceRank),
  rule("signal_id",
    "Signal id ascending. Total by construction: ids are unique, so this rule always "
    + "separates, and the winner cannot depend on input order.",
    (left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
]);

/** The rule codes, in order, for a caller that wants to publish the chain. */
export const RANKING_RULE_ORDER = Object.freeze(RANKING_RULES.map((entry) => entry.code));

/**
 * Compare two normalized findings. Exported so a test can assert the chain
 * directly rather than inferring it from a sorted array.
 *
 * @returns a negative number when `left` ranks first, positive when `right` does.
 */
export function compareFindings(left, right) {
  for (const entry of RANKING_RULES) {
    const verdict = entry.compare(left, right);
    if (verdict !== 0) return verdict;
  }
  return 0;
}

/** The rule that actually separated two findings, for tracing a winner. */
export function decidingRule(left, right) {
  for (const entry of RANKING_RULES) {
    if (entry.compare(left, right) !== 0) return entry.code;
  }
  return null;
}

function reject(signal, code, index) {
  return Object.freeze({ id: text(signal?.id) || `signal-${index}`, code });
}

/**
 * Turn one signal into a finding, or say why it cannot be one.
 *
 * Every check here is a manifest check. Nothing is rejected for being weak —
 * weak findings rank last, they do not disappear — only for asserting something
 * the headline region is not permitted to assert, or for arriving malformed.
 */
function normalize(signal, index, manifest) {
  const id = text(signal?.id);
  if (!id) return { rejected: reject(signal, FINDING_REJECTED.noId, index) };

  const spec = headlineClaimKind(signal?.signalKind, manifest);
  if (!spec) return { rejected: reject(signal, FINDING_REJECTED.kindNotPermitted, index) };
  if (!finite(signal?.impact?.value)) {
    return { rejected: reject(signal, FINDING_REJECTED.impactNotNumeric, index) };
  }
  if (signal.impact.unit !== spec.unit) {
    return { rejected: reject(signal, FINDING_REJECTED.unitNotPermitted, index) };
  }
  if (!spec.directions.includes(signal.impact.direction)) {
    return { rejected: reject(signal, FINDING_REJECTED.directionNotPermitted, index) };
  }
  const claim = text(signal?.claim);
  if (!claim) return { rejected: reject(signal, FINDING_REJECTED.noClaim, index) };
  if (sentenceCount(claim) > manifest.headline.maxSentences) {
    return { rejected: reject(signal, FINDING_REJECTED.claimTooLong, index) };
  }
  const recommendedAction = text(signal?.recommendedAction);
  if (!recommendedAction) return { rejected: reject(signal, FINDING_REJECTED.noAction, index) };

  const impact = Object.freeze({
    value: Number(signal.impact.value),
    unit: signal.impact.unit,
    direction: signal.impact.direction,
  });
  const provenance = Object.freeze({
    kind: signal?.provenance?.kind ?? null,
    label: text(signal?.provenance?.label) || null,
    id: signal?.provenance?.id ?? null,
    /** The contract or snapshot the number is traceable through, when there is one. */
    detail: text(signal?.provenance?.detail) || null,
  });
  const confidence = applyProvenanceConfidence(signal?.confidence, provenance);
  const materiality = materialityOf(impact, spec);
  const evidenceClass = evidenceClassOf(provenance);
  const template = claimTemplateFor(evidenceClass);
  return {
    finding: Object.freeze({
      id,
      signalKind: spec.kind,
      claim,
      impact,
      confidence,
      provenance,
      recommendedAction,
      materiality,
      /**
       * Entitlement, as structured output rather than as something a surface
       * infers from `provenance.kind` and a level buried in an object. These
       * three fields are what the labelled fixtures pin and what the headline
       * renders; nothing downstream re-derives any of them.
       *
       * `confidenceTier` is `confidence.level` AFTER the provenance downgrade —
       * the tier the reader is actually entitled to, not the one the signal
       * asked for. `confidence.statedLevel` still holds what was asked for, so
       * the downgrade stays traceable.
       */
      evidenceClass,
      confidenceTier: confidence.level,
      claimTemplate: template.id,
      /** The claim as the headline may assert it, under this evidence class. */
      assertedClaim: template.render(claim),
      /** Ranking inputs, published so a winner can be explained without re-deriving it. */
      materialityRank: MATERIALITY_LEVELS.indexOf(materiality),
      confidenceRank: confidenceRank(confidence.level),
      kindPriority: headlineKindPriority(spec.kind, manifest),
      provenanceRank: PROVENANCE_RANK[provenance.kind] ?? 0,
    }),
  };
}

/** The empty result. A shape, in every case, so no caller branches on undefined. */
const empty = (rejected = []) => Object.freeze({
  version: FINDING_RESOLVER_VERSION,
  winner: null,
  runnersUp: Object.freeze([]),
  rejected: Object.freeze(rejected),
  ruleOrder: RANKING_RULE_ORDER,
});

/**
 * Rank the signals and return the one the headline should assert.
 *
 * @param signals an iterable of already-computed signals. Anything that is not
 *   iterable is treated as no evidence — the empty result, not a throw.
 * @param manifest the spine manifest. Injectable for tests; production passes
 *   the shipped one.
 * @returns {{ winner: object|null, runnersUp: object[], rejected: object[] }}
 *   `runnersUp` is the rest of the ranking, in the same order and the same
 *   shape as the winner. It is returned for progressive disclosure; whether any
 *   of it is rendered is the surface's decision, not this module's.
 */
export function resolveFinding(signals, { manifest = FINOPS_SPINE_MANIFEST } = {}) {
  const list = Array.isArray(signals) ? signals
    : (signals && typeof signals[Symbol.iterator] === "function" ? [...signals] : []);
  if (!list.length) return empty();

  // A repeated id would make the final tiebreak non-total, and a non-total
  // tiebreak is a winner that depends on input order. Both sides of an
  // ambiguous id are refused rather than silently resolved by position.
  const counts = new Map();
  for (const signal of list) {
    const id = text(signal?.id);
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const findings = [];
  const rejected = [];
  list.forEach((signal, index) => {
    if (signal?.available === false) return;
    if (counts.get(text(signal?.id)) > 1) {
      rejected.push(reject(signal, FINDING_REJECTED.duplicateId, index));
      return;
    }
    const outcome = normalize(signal, index, manifest);
    if (outcome.rejected) rejected.push(outcome.rejected);
    else findings.push(outcome.finding);
  });
  if (!findings.length) return empty(rejected);

  // Sorting a copy, with a total comparator: no reliance on sort stability and
  // no mutation of the caller's array.
  const ranked = [...findings].sort(compareFindings);
  return Object.freeze({
    version: FINDING_RESOLVER_VERSION,
    winner: ranked[0],
    runnersUp: Object.freeze(ranked.slice(1)),
    rejected: Object.freeze(rejected),
    ruleOrder: RANKING_RULE_ORDER,
  });
}
