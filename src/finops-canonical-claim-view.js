// The canonical claim's provenance, validation status and stated assumptions,
// painted into the answer region's existing "how we know this" disclosure.
//
// THREE SLOTS, NO NEW DISCLOSURE, NO NEW CONTROL. The three sentences go into
// the three labelled parts the region already ships — Provenance, Basis, Limits
// — so the pattern keeps its three dt terms and the first screen keeps its tab
// order. Nothing here is live: this is prose a reader opens, not an
// announcement, which is why it is allowed to sit behind a shut disclosure.
//
// IT DERIVES NOTHING. Every string below is a field of the record
// `deriveCanonicalClaim` returned. A withheld record says why and shows no
// figure at all, rather than dimming one or leaving the last one on screen.
//
// EVERY STRING IS WRITTEN WITH `textContent`. Finding text was already
// neutralised by `redactClaimText` inside the contract; this layer never
// assembles markup, so a hostile label reaches the DOM as text or not at all.

import { CLAIM_STATUS, FINOPS_CANONICAL_CLAIM, deriveCanonicalClaim } from "./finops-canonical-claim.js";
import { PUBLISHED_FIXTURE } from "./finops-canonical-claim-fixtures.js";

/** The three slots the answer region authors for this claim. */
export const CANONICAL_CLAIM_IDS = Object.freeze({
  provenance: "finops-canonical-claim-provenance",
  basis: "finops-canonical-claim-basis",
  assumptions: "finops-canonical-claim-assumptions",
});

/** The claim the served document is authored from. */
export const BUNDLED_CANONICAL_CLAIM = deriveCanonicalClaim(PUBLISHED_FIXTURE.evidence);

const listSentences = (entries) => entries.map((entry) => entry.sentence).join(" ");

/** Which case this claim came from, and whether it may be published. */
export function claimProvenanceSentence(claim) {
  const { caseId, caseLabel, findingCount } = claim.provenance;
  const source = `Every figure in this answer is derived by one contract from one named`
    + ` synthetic case: ${caseId} — "${caseLabel}", ${findingCount === 1
      ? "one finding" : `${findingCount} findings`}.`;
  if (claim.status === CLAIM_STATUS.eligible) {
    return `${source} Validation status: eligible — the case states every field the contract`
      + " is defined over, so the figure above is publishable.";
  }
  if (claim.status === CLAIM_STATUS.conflicted) {
    return `${source} Validation status: conflicted — no figure is published, and the`
      + ` disagreement is named rather than resolved. ${listSentences(claim.disagreements)}`;
  }
  return `${source} Validation status: insufficient — no figure is published.`
    + ` ${listSentences(claim.shortfalls)}`;
}

/** The two supporting claims, and the contract that produced all four. */
export function claimBasisSentence(claim) {
  if (claim.status !== CLAIM_STATUS.eligible) {
    return `No benchmark or confidence statement is published for a case validated`
      + ` ${claim.status}, under ${FINOPS_CANONICAL_CLAIM}.`;
  }
  return `Supported by ${claim.claims.materialBenchmark.text}`
    + ` ${claim.claims.confidence.text} The annual figure is`
    + ` ${claim.claims.annualHeadline.basis} All four claims come out of`
    + ` ${FINOPS_CANONICAL_CLAIM}; none is written by hand.`;
}

/** Each weight this claim applied, followed by the assumption behind it. */
export function claimAssumptionsSentence(claim) {
  return `Weights this answer applies, each with the assumption it rests on.`
    + ` ${claim.appliedWeights.map((weight) => weight.assumption).join(" ")}`;
}

/**
 * Paint the three slots.
 *
 * Total, like the region's other painters: a document missing a slot is left
 * alone rather than throwing through the boot of the first figure a reader
 * meets. The default claim is the bundled one — the same record the authored
 * document states — so an ordinary open repaints what the page already says.
 */
export function applyCanonicalClaim(doc, claim = BUNDLED_CANONICAL_CLAIM) {
  const sentences = {
    provenance: claimProvenanceSentence(claim),
    basis: claimBasisSentence(claim),
    assumptions: claimAssumptionsSentence(claim),
  };
  let painted = null;
  for (const [slot, id] of Object.entries(CANONICAL_CLAIM_IDS)) {
    const node = doc?.getElementById?.(id) ?? null;
    if (!node) continue;
    node.textContent = sentences[slot];
    if (slot === "provenance") {
      node.dataset.validation = claim.status;
      node.dataset.claimCase = claim.provenance.caseId;
      painted = node;
    }
  }
  return painted;
}
