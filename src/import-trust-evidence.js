// Result-associated trust evidence for one browser-local provider analysis.
// This is data only: it owns no DOM, file bytes, clock, storage, or network.

import { providerExportPreflight } from "./provider-export-projection.js";

export const IMPORT_TRUST_EVIDENCE_VERSION = "import-trust-evidence/1.0.0";

const freezeFact = (fact) => Object.freeze({ ...fact });

/**
 * Collapse the five intake judgments into one immutable result companion.
 * A validated projection is required: rejected files have recovery diagnostics,
 * not trust evidence for a result that does not exist.
 */
export function importTrustEvidence({ projection, intakeConfidence, mapping = null } = {}) {
  if (!projection?.ok) return null;
  const preflight = providerExportPreflight(projection);
  const partial = !preflight.sufficient || projection.confidence.level !== "bounded";
  const mapped = mapping ? mapping.columns.filter((column) => column.target !== "ignored") : [];
  const facts = Object.freeze([
    freezeFact({ id: "readiness", label: "Parser readiness",
      status: partial ? "limited" : "ready",
      detail: `${preflight.verdict}. ${preflight.coverage.coveredRows} of ${preflight.coverage.totalRows} accepted rows carry department attribution.` }),
    freezeFact({ id: "recognition", label: "Export recognition", status: "ready",
      detail: `Accepted as provider usage schema ${projection.input.schemaVersion}; the provider was read from validated content, not the file name.` }),
    freezeFact({ id: "mapping", label: "Column mapping", status: "ready",
      detail: mapping
        ? `${mapped.length} of ${mapping.columns.length} columns were mapped after review; ${mapping.kindOrigin === "chosen" ? "the reader changed or confirmed the file kind" : "the detected file kind was retained"}.`
        : "The versioned JSON envelope supplied named contract fields, so no manual column mapping was required." }),
    freezeFact({ id: "compatibility", label: "Compatibility", status: "ready",
      detail: `The provider-usage ${projection.input.schemaVersion} contract accepted the envelope and its USD spend rows.` }),
    freezeFact({ id: "provenance", label: "Provenance", status: "ready",
      detail: `${projection.provenance.recordCount} rows were analyzed in browser memory only; ${projection.provenance.supersededRows} superseded and ${projection.provenance.conflictingRevisions} conflicting revisions were not counted.` }),
  ]);
  return Object.freeze({
    version: IMPORT_TRUST_EVIDENCE_VERSION,
    state: partial ? "partial" : "success",
    outcome: preflight.outcome,
    confidence: intakeConfidence ?? null,
    facts,
    limitations: Object.freeze([...projection.confidence.limitations,
      projection.classificationEvidence.limitation]),
    nextAction: projection.actions[0].text,
  });
}

/** Keep trust evidence inseparable from the analysis consumed by result views. */
export function resultWithTrustEvidence(result, trustEvidence) {
  if (!result || !trustEvidence) return result;
  return Object.freeze({ ...result, trustEvidence });
}
