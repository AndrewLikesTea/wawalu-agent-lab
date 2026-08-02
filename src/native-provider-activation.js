// Decides whether one already-read table can enter analysis through a
// versioned native-provider adapter. This module does not parse bytes or retain
// rows; it only compares the header with the compatibility registry.

import { detectDialect, scoreProfile } from "./dialect-detection.js";
import { profileById } from "./dialect-profiles.js";
import { NATIVE_PROVIDER_COMPATIBILITY } from "./native-provider-compatibility.js";

export const NATIVE_ACTIVATION_STATUS = Object.freeze({
  SUPPORTED: "supported",
  INCOMPLETE: "incomplete",
  NOT_NATIVE: "not-native",
});

export const NATIVE_REQUIRED_FIELD_CODE = "native_required_field_invalid";

const normalizedHeader = (value) => String(value ?? "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/**
 * The single test for "this file is one supported native export": every column
 * the contract names as required is present under that contract name, for
 * exactly one provider. Aliases are deliberately not consulted here — an
 * aliased header is still welcome in the reviewed mapping flow, but only the
 * named shape may skip review, and only the named shape is then held to the
 * all-or-nothing row gate the import module applies.
 *
 * Returns the compatibility entry, or null when no provider or more than one
 * provider matches.
 */
export function nativeContractForHeader(header) {
  const present = new Set((header ?? []).map(normalizedHeader));
  const exact = NATIVE_PROVIDER_COMPATIBILITY.filter(({ required }) =>
    required.every((name) => present.has(normalizedHeader(name))));
  return exact.length === 1 ? exact[0] : null;
}

const profiles = () => NATIVE_PROVIDER_COMPATIBILITY
  .map(({ id }) => profileById(id))
  .filter(Boolean);

export function assessNativeProviderActivation(reading) {
  const table = {
    columns: reading?.header ?? [],
    rows: (reading?.rows ?? []).map((row) => row?.values ?? []),
    delimiter: reading?.delimiterName ?? null,
    headerRowIndex: reading?.headerRow ?? null,
  };
  const supportedProfiles = profiles();
  const detection = detectDialect(table, supportedProfiles);
  // Dialect profiles also match column aliases, which the reviewed manual
  // mapping workflow wants. Native activation is narrower on purpose: only a
  // header naming the contract's own required columns may bypass review, so a
  // matched-by-alias file stays on the mapping path rather than inheriting a
  // direct-analysis promise the row gate was never asked about.
  const provider = nativeContractForHeader(table.columns);
  if (provider) {
    const agreed = detection.status === "matched" && detection.profileId === provider.id;
    const confidence = agreed ? detection.confidence : 1;
    return Object.freeze({
      status: NATIVE_ACTIVATION_STATUS.SUPPORTED,
      providerId: provider.id,
      providerLabel: provider.label,
      adapterVersion: provider.adapterVersion,
      confidence,
      // One sentence for both the reading and the ready state, so it is still
      // true once the analysis it describes is on screen.
      message: `${provider.label} is compatible with adapter v${provider.adapterVersion} `
        + `(${Math.round(confidence * 100)}% header confidence). This export is `
        + "analyzed directly; manual column mapping is not required.",
    });
  }
  if (detection.status === "matched") {
    return Object.freeze({ status: NATIVE_ACTIVATION_STATUS.NOT_NATIVE, confidence: 0 });
  }

  // A native-looking header that is missing a required field is an incomplete
  // export, not an invitation to guess. Optional signals establish that the
  // file resembles exactly one provider before we use that provider's recovery.
  const candidates = supportedProfiles.map((profile) => {
    const score = scoreProfile(profile, table.columns);
    const normalized = new Set(table.columns.map(normalizedHeader));
    const optionalHits = profile.columns.filter((column) => !column.required
      && [column.source, ...(column.aliases ?? [])].some((name) => normalized.has(normalizedHeader(name)))).length;
    const missingCount = score.reason.startsWith("missing required")
      ? score.reason.split(",").length : Number.POSITIVE_INFINITY;
    return { profile, score, optionalHits, missingCount };
  }).filter(({ score, optionalHits }) => score.reason.startsWith("missing required") && optionalHits > 0);

  const closest = candidates.sort((left, right) => left.missingCount - right.missingCount
    || right.optionalHits - left.optionalHits);
  if (closest.length && (closest.length === 1
    || closest[0].missingCount < closest[1].missingCount
    || closest[0].optionalHits > closest[1].optionalHits)) {
    const [{ profile, score }] = closest;
    const provider = NATIVE_PROVIDER_COMPATIBILITY.find(({ id }) => id === profile.id);
    return Object.freeze({
      status: NATIVE_ACTIVATION_STATUS.INCOMPLETE,
      providerId: provider.id,
      providerLabel: provider.label,
      confidence: 0,
      message: `${provider.label} looks incomplete: ${score.reason}. Export the complete usage `
        + "table and choose it again. No analysis was run.",
    });
  }
  return Object.freeze({ status: NATIVE_ACTIVATION_STATUS.NOT_NATIVE, confidence: 0 });
}
